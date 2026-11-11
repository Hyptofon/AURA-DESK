#!/usr/bin/env python3
"""Regression tests for verify-one-file-history.py.

Tests:
1. Valid single-file commits (PASS)
2. Invalid multi-file commit (FAIL)
3. Valid two-parent PR merge commit (PASS)
4. Invalid octopus merge commit (FAIL)
5. Invalid merge subject format (FAIL)
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from pathlib import Path

# Add repo root to import path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "scripts"))

from importlib.machinery import SourceFileLoader

validator = SourceFileLoader(
    "verify_one_file_history",
    str(root / "scripts" / "verify-one-file-history.py")
).load_module()


class TestVerifyOneFileHistory(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="aura_test_repo_")
        self._git(["init", "-b", "main"])
        self._git(["config", "user.name", "Test Runner"])
        self._git(["config", "user.email", "test@example.com"])
        # Disable commit hooks in test sandbox
        self._git(["config", "core.hooksPath", ""])

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def _git(self, args):
        cmd = ["git", "-C", self.test_dir] + args
        return subprocess.check_output(cmd, text=True).strip()

    def _write_file(self, filename, content):
        path = os.path.join(self.test_dir, filename)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def test_valid_single_file_commits(self):
        self._write_file("file1.txt", "hello")
        self._git(["add", "file1.txt"])
        self._git(["commit", "-m", "chore(test): add file1"])

        self._write_file("file2.txt", "world")
        self._git(["add", "file2.txt"])
        self._git(["commit", "-m", "chore(test): add file2"])

        passed, issues, summary = validator.audit_history(n=10, git_dir=self.test_dir)
        self.assertTrue(passed, f"Expected PASS, got issues: {issues}")
        self.assertEqual(len(issues), 0)
        self.assertIn("2 single-file commits", summary)

    def test_invalid_multi_file_commit(self):
        self._write_file("file1.txt", "one")
        self._write_file("file2.txt", "two")
        self._git(["add", "file1.txt", "file2.txt"])
        self._git(["commit", "-m", "chore(test): add two files at once"])

        passed, issues, summary = validator.audit_history(n=10, git_dir=self.test_dir)
        self.assertFalse(passed, "Expected FAIL for multi-file commit")
        self.assertEqual(len(issues), 1)
        self.assertIn("2 changed paths", issues[0])

    def test_valid_two_parent_merge_commit(self):
        self._write_file("base.txt", "base")
        self._git(["add", "base.txt"])
        self._git(["commit", "-m", "chore(test): base commit"])

        self._git(["checkout", "-b", "feature"])
        self._write_file("feat.txt", "feature content")
        self._git(["add", "feat.txt"])
        self._git(["commit", "-m", "feat(test): add feat"])

        self._git(["checkout", "main"])
        self._write_file("main_update.txt", "main update")
        self._git(["add", "main_update.txt"])
        self._git(["commit", "-m", "chore(test): update main"])

        # Merge feature into main with standard PR merge subject
        self._git(["merge", "--no-ff", "feature", "-m", "Merge pull request #1 from feature"])

        passed, issues, summary = validator.audit_history(n=10, git_dir=self.test_dir)
        self.assertTrue(passed, f"Expected PASS for valid PR merge, got issues: {issues}")
        self.assertEqual(len(issues), 0)
        self.assertIn("1 approved two-parent merge commits", summary)

    def test_invalid_octopus_merge_commit(self):
        self._write_file("base.txt", "base")
        self._git(["add", "base.txt"])
        self._git(["commit", "-m", "chore(test): base"])

        self._git(["checkout", "-b", "feat1"])
        self._write_file("f1.txt", "f1")
        self._git(["add", "f1.txt"])
        self._git(["commit", "-m", "feat(test): f1"])

        self._git(["checkout", "main"])
        self._git(["checkout", "-b", "feat2"])
        self._write_file("f2.txt", "f2")
        self._git(["add", "f2.txt"])
        self._git(["commit", "-m", "feat(test): f2"])

        self._git(["checkout", "main"])
        self._write_file("main_diverged.txt", "main diverged")
        self._git(["add", "main_diverged.txt"])
        self._git(["commit", "-m", "chore(test): main diverged"])

        # Octopus merge (3 parents)
        self._git(["merge", "feat1", "feat2", "-m", "Merge branches 'feat1' and 'feat2'"])

        passed, issues, summary = validator.audit_history(n=10, git_dir=self.test_dir)
        self.assertFalse(passed, "Expected FAIL for octopus merge")
        self.assertTrue(any("octopus merge" in i for i in issues))

    def test_invalid_merge_subject(self):
        self._write_file("base.txt", "base")
        self._git(["add", "base.txt"])
        self._git(["commit", "-m", "chore(test): base"])

        self._git(["checkout", "-b", "feat"])
        self._write_file("f.txt", "f")
        self._git(["add", "f.txt"])
        self._git(["commit", "-m", "feat(test): f"])

        self._git(["checkout", "main"])
        # Merge with non-conforming subject
        self._git(["merge", "--no-ff", "feat", "-m", "random non-merge subject"])

        passed, issues, summary = validator.audit_history(n=10, git_dir=self.test_dir)
        self.assertFalse(passed, "Expected FAIL for non-conforming merge subject")
        self.assertTrue(any("merge commit subject does not follow merge convention" in i for i in issues))


if __name__ == "__main__":
    unittest.main()

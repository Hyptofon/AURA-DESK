#!/usr/bin/env python3
"""Audit recent Git history for single-file commit discipline and valid merge commits.

Usage: python scripts/verify-one-file-history.py [number-of-commits] [revision]
"""
import re
import subprocess
import sys


def audit_history(n=30, rev="HEAD", git_dir=None):
    cmd_prefix = ["git"]
    if git_dir:
        cmd_prefix = ["git", "-C", git_dir]

    ids_cmd = cmd_prefix + ["rev-list", "--max-count", str(n), rev]
    try:
        ids = subprocess.check_output(ids_cmd, text=True).splitlines()
    except subprocess.CalledProcessError as e:
        return False, [f"git rev-list failed: {e}"]

    issues = []
    single_file_count = 0
    merge_count = 0

    for sha in ids:
        parent_cmd = cmd_prefix + ["rev-list", "--parents", "-n", "1", sha]
        parent_tokens = subprocess.check_output(parent_cmd, text=True).strip().split()
        num_parents = len(parent_tokens) - 1  # first token is the commit itself

        if num_parents > 1:
            # Merge commit validation
            if num_parents > 2:
                issues.append(f"{sha[:8]}: octopus merge with {num_parents} parents is forbidden")
                continue

            # Standard 2-parent merge commit: verify subject convention
            msg_cmd = cmd_prefix + ["log", "-1", "--format=%s", sha]
            subject = subprocess.check_output(msg_cmd, text=True).strip()
            merge_pattern = r"^(Merge pull request #\d+|Merge branch |Merge remote-tracking branch |Merge )"
            if not re.search(merge_pattern, subject):
                issues.append(f"{sha[:8]}: merge commit subject does not follow merge convention: {subject!r}")
                continue

            merge_count += 1
            continue

        # Regular non-merge commit (root or single parent): strictly 1 changed path
        paths_cmd = cmd_prefix + ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha]
        paths = subprocess.check_output(paths_cmd, text=True).splitlines()
        if len(paths) != 1:
            issues.append(f"{sha[:8]}: {len(paths)} changed paths: {paths}")
        else:
            single_file_count += 1

    summary = (
        f"Audited {len(ids)} commits "
        f"({single_file_count} single-file commits, {merge_count} approved two-parent merge commits)"
    )
    return len(issues) == 0, issues, summary


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    rev = sys.argv[2] if len(sys.argv) > 2 else "HEAD"

    passed, issues, summary = audit_history(n=n, rev=rev)
    print(summary)
    if not passed:
        for issue in issues:
            print("FAIL:", issue)
        sys.exit(1)
    print("PASS: all audited commits conform to policy")


if __name__ == "__main__":
    main()

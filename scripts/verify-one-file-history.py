#!/usr/bin/env python3
"""Audit recent Git history for single-file commit discipline and valid merge commits.

Usage: python scripts/verify-one-file-history.py [number-of-commits] [revision]
"""
import re
import subprocess
import sys

# Pattern for structurally valid merge commits created by GitHub PR merges or standard branch merges.
# NOTE: Structural validity does NOT equal user authorization or independent review approval.
# Actual approval must be confirmed through the PR review procedure and explicit user consent.
MERGE_SUBJECT_PATTERN = (
    r"^(Merge pull request #\d+(?: from [A-Za-z0-9_\-./]+)?(?:\s+into\s+[A-Za-z0-9_\-./]+)?|"
    r"Merge branch '[^']+'(?:\s+into\s+[^'\s]+)?|"
    r"Merge remote-tracking branch '[^']+'(?:\s+into\s+[^'\s]+)?)$"
)


def audit_history(n=30, rev="HEAD", git_dir=None):
    cmd_prefix = ["git"]
    if git_dir:
        cmd_prefix = ["git", "-C", git_dir]

    ids_cmd = cmd_prefix + ["rev-list", "--max-count", str(n), rev]
    try:
        res = subprocess.run(
            ids_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        ids = res.stdout.splitlines()
    except subprocess.CalledProcessError as e:
        err_msg = e.stderr.strip() if e.stderr else str(e)
        return False, [f"git rev-list failed for revision {rev!r}: {err_msg}"], f"Failed to audit revision {rev!r}"

    issues = []
    single_file_count = 0
    merge_count = 0

    for sha in ids:
        parent_cmd = cmd_prefix + ["rev-list", "--parents", "-n", "1", sha]
        try:
            parent_tokens = subprocess.check_output(parent_cmd, text=True, stderr=subprocess.PIPE).strip().split()
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr.strip() if e.stderr else str(e)
            issues.append(f"{sha[:8]}: failed to resolve parents: {err_msg}")
            continue

        num_parents = len(parent_tokens) - 1  # first token is the commit itself

        if num_parents > 1:
            # Merge commit structural validation
            if num_parents > 2:
                issues.append(f"{sha[:8]}: octopus merge with {num_parents} parents is forbidden")
                continue

            # Standard 2-parent merge commit: verify documented merge subject convention
            msg_cmd = cmd_prefix + ["log", "-1", "--format=%s", sha]
            try:
                subject = subprocess.check_output(msg_cmd, text=True, stderr=subprocess.PIPE).strip()
            except subprocess.CalledProcessError as e:
                err_msg = e.stderr.strip() if e.stderr else str(e)
                issues.append(f"{sha[:8]}: failed to read commit subject: {err_msg}")
                continue

            if not re.match(MERGE_SUBJECT_PATTERN, subject):
                issues.append(f"{sha[:8]}: merge commit subject does not follow merge convention: {subject!r}")
                continue

            merge_count += 1
            continue

        # Regular non-merge commit (root or single parent): strictly 1 changed path
        paths_cmd = cmd_prefix + ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha]
        try:
            paths = subprocess.check_output(paths_cmd, text=True, stderr=subprocess.PIPE).splitlines()
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr.strip() if e.stderr else str(e)
            issues.append(f"{sha[:8]}: failed to read changed paths: {err_msg}")
            continue

        if len(paths) != 1:
            issues.append(f"{sha[:8]}: {len(paths)} changed paths: {paths}")
        else:
            single_file_count += 1

    summary = (
        f"Audited {len(ids)} commits "
        f"({single_file_count} single-file commits, {merge_count} structurally valid two-parent merge commits)"
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

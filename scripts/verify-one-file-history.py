#!/usr/bin/env python3
"""Audit recent Git history. Usage: python scripts/verify-one-file-history.py [number-of-commits]"""
import subprocess, sys
n = int(sys.argv[1]) if len(sys.argv) > 1 else 30
# We audit each commit; merges are deliberately flagged. Exclude the exact first
# commit if it has no parent? Git diff-tree --root handles it.
ids = subprocess.check_output(['git','rev-list','--max-count',str(n),'HEAD'],text=True).splitlines()
issues=[]
for sha in ids:
    parent_lines=subprocess.check_output(['git','rev-list','--parents','-n','1',sha],text=True).strip().split()
    if len(parent_lines)>2:
        issues.append(f'{sha[:8]}: merge commit requires explicit manual history audit')
        continue
    paths=subprocess.check_output(['git','diff-tree','--root','--no-commit-id','--name-only','-r',sha],text=True).splitlines()
    if len(paths)!=1:
        issues.append(f'{sha[:8]}: {len(paths)} changed paths: {paths}')
print(f'Audited {len(ids)} commits')
if issues:
    for i in issues: print('FAIL',i)
    sys.exit(1)
print('PASS: every audited non-merge commit touches exactly one path')

---
name: atomic-git-commits
description: "Enforces exactly one changed file per Git commit with hook validation, safe staging, meaningful conventional messages and separate progress documentation commits."
---

# Atomic Git Commits — STRICT USER REQUIREMENT

## Preflight
1. Confirm `git status --short`, branch and any user modifications. Never discard or stage unrelated user work.
2. Check hooks are active: `git config --get core.hooksPath` must be `.githooks`; otherwise advise setup.
3. If task changes N files, prepare N commits in dependency order. Do not bypass to simplify.

## Exact procedure for EACH file

```bash
git add -- path/to/exact-file
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(capture): add monitor enumeration"
git show --stat --oneline HEAD
```

- Stage must contain **exactly one path**. If hook rejects, stop and resolve without `--no-verify`.
- Commit subject format `feat|fix|refactor|test|docs|chore|build|style|perf|ci(scope): description`.
- No blanket `git add .`, `git add -A`, `git commit -am`, multi-file amend or manual alternate Git index tricks.
- Renames with complex status counts: validate hook behavior; if rejected, use staged separate file operations and clearly explain history.
- After code+test commits, update `docs/ROADMAP.md` separately, then `docs/PROGRESS.md` separately with evidence. No combined status+code commit.
- Untracked user files are NEVER staged. Ignore VS Code user settings unless approved.

## Known tradeoff
One logical feature requiring several files becomes multiple **one-file** commits; partial intermediate states may not build. Work on a short-lived feature branch; do not claim every intermediate commit is release-ready. Check builds at task completion and before merge, keep contracts compatible where feasible.

## Self-check
Before reporting, run `git log -n 12 --name-only --pretty=format:'%h %s'` and verify one changed path per new commit; provide SHA/path mapping.

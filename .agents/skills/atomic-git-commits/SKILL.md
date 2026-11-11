---
name: atomic-git-commits
description: "Enforces exactly one changed file per Git commit with hook validation, safe staging, meaningful conventional messages, PR merge commit verification rules and separate progress documentation commits."
---

# Atomic Git Commits — STRICT USER REQUIREMENT

## Core Invariants
1. **One file per regular commit:** Every standard commit (feature, fix, test, refactor, chore, docs) changes strictly one path in the repository index.
2. **Never bypass hooks:** Git hooks in `.githooks/` (`pre-commit`, `commit-msg`) are mandatory. Never use `--no-verify`, never disable hooks, and never alter hook configuration to evade checks.
3. **No history rewriting:** `git push --force`, `rebase`, `squash`, and multi-file amend are strictly prohibited. History must remain forensic, sequential, and auditable.

## Preflight
1. Confirm `git status --short`, branch and any user modifications. Never discard or stage unrelated user work.
2. Check hooks are active: `git config --get core.hooksPath` must be `.githooks`; otherwise run `powershell -ExecutionPolicy Bypass -File scripts/setup-git-hooks.ps1`.
3. If task changes N files, prepare N commits in dependency order. Do not bypass to simplify.

## Exact Procedure for EACH File

```bash
git add -- path/to/exact-file
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(scope): concise description"
git show --stat --oneline HEAD
```

- Stage must contain **exactly one path**. If hook rejects, stop and resolve without `--no-verify`.
- Commit subject format: `feat|fix|refactor|test|docs|chore|build|style|perf|ci(scope): description`.
- No blanket `git add .`, `git add -A`, `git commit -am`, or manual index manipulations.
- Renames/deletions: ensure status counts as one logical path in pre-commit hook; if ambiguous, stage separate operations.
- Update `docs/ROADMAP.md` separately, then `docs/PROGRESS.md` separately with verified evidence. Never combine status updates with implementation code.
- Untracked user files are NEVER staged. Ignore editor/workspace files unless explicitly approved.

## Merge Commits as a Distinct Integration Case
1. **Separation of concerns:** GitHub Merge Commits are integration artifacts connecting an approved PR branch into `main`. They are not individual file modification commits.
2. **Structural validation criteria:**
   - Evaluated by dedicated criteria in `scripts/verify-one-file-history.py`.
   - Exactly two parents (`len(parents) == 2`).
   - Octopus merges (`len(parents) > 2`) are strictly rejected.
   - Must follow documented PR merge conventions (`Merge pull request #<num>...` or `Merge branch '<name>'...`). Arbitrary messages (e.g. `Merge arbitrary changes`) are strictly rejected.
3. **Structural validity vs. approval:**
   - A conforming merge commit subject proves only structural compliance with Git/GitHub conventions; it does NOT prove independent code review or user authorization.
   - Actual approval requires completed independent review (ChatGPT) and explicit user permission prior to merge.
4. **Validator resilience & regression testing:**
   - History validation tools must handle invalid or missing Git revisions gracefully, returning uniform `(passed, issues, summary)` tuples and exiting with non-zero exit codes without unhandled exceptions (`ValueError`).
   - Positive and negative regression tests in `scripts/test-verify-one-file-history.py` are mandatory for all structural commit patterns (single-file, multi-file, 2-parent PR merge, octopus merge, invalid merge subjects, and invalid git revisions).

## Known Tradeoff
One logical feature requiring several files becomes multiple **one-file** commits; partial intermediate states may not build. Work on a short-lived feature branch; do not claim every intermediate commit is release-ready. Check builds at task completion and before merge, keeping contracts compatible where feasible.

## Self-check
Before reporting, run:
```bash
py -3 scripts/verify-one-file-history.py 30
git log -n 12 --name-only --pretty=format:'%h %s'
```
Verify exactly one changed path per new regular commit and provide SHA/path mapping in the report.

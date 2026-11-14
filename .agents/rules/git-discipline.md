---
trigger: always_on
description: Mandatory one-file-per-commit Git policy, clean staging discipline, and separate roadmap commits for the entire AURA DESK project.
---

# Mandatory Git discipline — no exceptions

1. Exactly ONE changed path in Git index per commit, including initial bootstrap, generated config, tests, docs, lockfiles. No combined commits. **Never** `git add .`, `git add -A`, `git commit -am`.
2. Before edit: `git status --short`; do not revert/overwrite user work, and don't assume unrelated changes belong to you.
3. Before commit: `git add -- path/to/one-file` → `git diff --cached --name-status` → run appropriate scoped checks → `git commit -m "type(scope): concise description"` → `git show --stat --oneline HEAD`.
4. Conventional Commits: feat/fix/refactor/test/docs/chore/build/style/perf/ci with scope. One file path includes renames/deletions as one logical path only when hook counts it accordingly; prefer separate operations if rename requires two.
5. `pre-commit` and `commit-msg` hooks in `.githooks/` are mandatory local enforcement. Never `--no-verify`, never disable hooks, never force-push or amend other people's commits.
6. When code requires a new test file, do two distinct commits (e.g. test file first, then implementation; can be on a working feature branch). Ensure current build/test checkpoint can be explained; if incomplete mark it as such and don't merge early.
7. Update `docs/ROADMAP.md` and `docs/PROGRESS.md` **each in separate commits** after genuine verification. These two files cannot be included in implementation commit.
8. If formatting/codegen touches more files, split into individual reviewed commits; don't use one giant formatting command to modify the repo carelessly.
9. If a tool stages more than one file, unstage only your own paths and correct the index. Do not mutate or unstage pre-existing user changes without approval.
10. Abort commit if hook rejects it; never use a loophole or manual alternate Git index.
11. Feature branch & PR workflow: each task must be developed in a dedicated feature branch (`feat/`, `fix/`, `docs/`, etc.) branched from up-to-date `main`. See `docs/DEVELOPMENT_WORKFLOW.md`. Direct commits and pushes of new tasks to `main` are strictly forbidden.
12. Pushing & Merge Policy: Feature branches are pushed to `origin` for Pull Request creation. For regular roadmap and refactoring tasks, the agent is authorized to autonomously merge the PR into `main` via Merge Commit (`gh pr merge <num> --merge`) once all required local checks pass and internal self-review / security review show no blocking risks. Independent code review (ChatGPT) may be conducted at user discretion. Explicit user pre-approval is required only for irreversible, paid, or major security/privacy changes. Never force-push, squash, or rebase merge.

**Rationale:** User explicitly wants forensic, auditable single-file history even at the cost of many commits. This is intentional, not general Git best-practice advice.

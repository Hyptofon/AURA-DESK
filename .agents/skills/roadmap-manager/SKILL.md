---
name: roadmap-manager
description: "Maintains trustworthy AURA DESK roadmap and progress states from verified evidence, captures blockers and handles roadmap updates as separate one-file commits."
---

# Roadmap/Progress Manager

## Workflow
1. Read `docs/ROADMAP.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`; correlate acceptance/tests and latest commits.
2. `TODO` → `IN PROGRESS` when work started (in PROGRESS), `VERIFIED` only when acceptance evidence exists. An implementation file without manual display/audio test remains `NEEDS MANUAL VERIFICATION`.
3. Update `docs/ROADMAP.md` checkboxes (one file → one commit) **after** actual verification.
4. Update `docs/PROGRESS.md` with date, task ID, changed paths+SHAs, exact test commands/results, device evidence, risks and next task (another one-file commit).
5. Keep backlog blockers transparent. Do not rewrite historical status to appear completed; never fabricate successful Windows tests.
6. If task blocked by user action or live API spend, list reproducible command, what it will prove, and stop at gate.

## Template
Use completed-work section inside `docs/PROGRESS.md`. If a status update is all that changed, only the progress document is committed. No automatic modifying 2 docs in one commit.

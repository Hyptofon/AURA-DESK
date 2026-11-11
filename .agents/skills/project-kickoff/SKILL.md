---
name: project-kickoff
description: "Bootstraps the AURA DESK Electron/React Windows application from its existing project specification, without premature implementation or unverifiable claims."
---

# Project Kickoff

## Trigger
Empty/new repository, initial setup, package selection, dev shell, base scripts, Git hooks.

## Workflow
1. Read `AGENTS.md`, `README.md`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/PROGRESS.md` and current file tree.
2. Inspect `git status` and existing package versions. Never delete an existing workspace or regenerate unrelated files.
3. Establish Windows/Node/npm/Electron compatibility and minimal `electron-vite` React/TS setup **one file at a time**.
4. Add build scripts one by one; lockfile receives its own separate commit. Keep strict TypeScript from first compile.
5. Secure BrowserWindow defaults and minimal typed preload before handling credentials/capture; never expose Node to renderer.
6. Bootstrap only the current milestone `P0.1` unless user explicitly requests more. Avoid stuffing all planned folders with placeholders.
7. Install `.githooks` and demonstrate the single-file staging policy separately after Git exists.
8. Verify with `npm run dev` **on actual Windows UI** if environment supports it; otherwise label manual needed, provide exact steps.
9. Record evidence; roadmap/progress updated in their own 1-file commits.

## Anti-patterns
- Do not claim `npm run dev` works because files look correct.
- Do not introduce cloud auth, Docker, backend, Python server or arbitrary dependencies.
- Do not run massive tests, download models, create a `.exe` without permission.

## Deliverable
File-by-file commit sequence, baseline scripts, exact checked commands, real blocker list, next task P0.x.

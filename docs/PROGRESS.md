# Progress — source of truth for current implementation

**Last verified:** 2026-11-11. **Current status:** `M0 COMPLETED, M1 IN PROGRESS`.

## Summary

- [x] Documentation/specification assembled for initial agent workflow.
- [x] Application repository initialized and bootable (P0.1).
- [x] Runtime code implemented (M0/P0.1 minimal shell).
- [x] Test and lint infrastructure configured and verified green (P0.3).
- [ ] Any Windows hardware or OpenRouter integration tested.
- [ ] Product acceptance criteria verified.

## Current milestone

**M1 — Real Windows capture spike** (Milestone M0 completed and verified: P0.1, P0.2, P0.3, P0.4).

## Verified deliverables

- Documentation pack: README, specification, architecture, UX/design, privacy, tests, roadmap, agent rules/skills, Git hooks (P0.2).
- Git hooks configuration: `.githooks/pre-commit` and `commit-msg` active via `core.hooksPath`; single-file commit policy strictly enforced and tested.
- P0.1 Skeleton: `electron-vite`, React 18, TypeScript strict, `tsconfig.node.json`, `tsconfig.web.json`, secure Electron main process with sandbox and CSP, preload typed bridge, and Quiet Instrument styled React App.
- P0.3 Testing & Quality Stack: Vitest, React Testing Library, ESLint 9 flat config, jsdom DOM environment, baseline contract test ([test/unit/preload-api.test.ts](file:///e:/Windows_AI_Copilot/test/unit/preload-api.test.ts)) and UI component test ([src/renderer/src/__tests__/App.test.tsx](file:///e:/Windows_AI_Copilot/src/renderer/src/__tests__/App.test.tsx)).
- Workflow & PR Governance: established feature branch and mandatory Pull Request policy with independent code review (ChatGPT) in `docs/DEVELOPMENT_WORKFLOW.md`.
- History Validator & Review Fixes: updated `scripts/verify-one-file-history.py` to support structurally valid two-parent GitHub PR merge commits (`Merge pull request #...`) while strictly rejecting octopus merges, arbitrary merge subjects, and local branch merges; ensured uniform `(passed, issues, summary)` error handling on invalid Git revisions; added 9-case regression test suite `scripts/test-verify-one-file-history.py` (9/9 PASS); enriched `.agents/skills/atomic-git-commits/SKILL.md` and `docs/DEVELOPMENT_WORKFLOW.md` to mandate SHA verification discipline and align with GitHub PR workflow.
- P0.4 Typed IPC Bridge & Secure BrowserWindow (COMPLETED & MERGED, PR #2): Zod runtime validation at IPC boundary (`CaptureSelectionSchema`, `SessionStatusSchema`, `AppInfoSchema`), strict channel allowlist, main process validated handlers with dispatch gate, typed preload bridge with narrow invoke methods, BrowserWindow security hardening (sandbox, contextIsolation, nodeIntegration: false, webSecurity, navigation controls, window open handler action: 'deny'), and 32 unit/contract tests across 4 test suites passing green.
- P0.4 Security & Code Review Fixes (MERGED via PR #2): resolved all findings from independent code review (P1 external URL validation, P1 BrowserWindow navigation restriction, P1 fail-closed sender/frame authorization, P2 preload sandboxing with 0 zod imports, P2 schema strengthening, P2 preload bridge unit tests).
- P1.1 Windows Display Enumeration & Hotplug Lifecycle (IN REVIEW, PR #3):
  * Contracts (`src/shared/contracts/channels.ts` & `src/shared/contracts/ipc.ts`): added `DISPLAYS_GET_ALL` channel, pure interfaces (`DisplayBounds`, `DisplayInfo`, `DisplayConfiguration`), and strict Zod validation schemas (`DisplayBoundsSchema`, `DisplayInfoSchema`, `DisplayConfigurationSchema`). Added 10 contract tests.
  * Core Manager (`src/main/displays/display-manager.ts`): implemented `DisplayManager` supporting single/dual/multi-monitor setups, display normalization (converting IDs to string, calculating geometry, workArea, scaleFactor, rotation, primary flag), hotplug event lifecycle (`display-added`, `display-removed`, `display-metrics-changed`) with listener cleanup, event deduplication, and non-mutating `selectedDisplayLost: true` detection when a selected display disconnects without automatic fallback.
  * IPC Handler (`src/main/ipc/register-handlers.ts`): wired `DISPLAYS_GET_ALL` handler protected by fail-closed sender context validation and Zod output schema validation.
  * Preload Bridge (`src/preload/index.ts`): exposed typed `getDisplays(): Promise<DisplayConfiguration>` with zero-dependency pure contracts in preload.
  * Main Process Lifecycle (`src/main/index.ts`): integrated `DisplayManager` initialization and clean teardown upon window close.
  * Host Hardware Verification: verified target Windows host with two physical 1080p monitors (`DISPLAY1` primary at 0,0, `DISPLAY2` secondary at -1920,1) via .NET Windows.Forms enumeration.
  * Unit & Contract Tests: 93 tests total across 6 test suites passing green (`display-manager.test.ts` [11], `ipc-contracts.test.ts` [26], `ipc-handlers.test.ts` [25], `navigation-guard.test.ts` [17], `preload-api.test.ts` [10], `App.test.tsx` [4]).

## Latest evidence

- `py -3 scripts/test-verify-one-file-history.py`: PASS (9 regression tests covering single-file commits, multi-file rejection, 2-parent merges, octopus merges, arbitrary merge subjects, non-conforming formats, local branch merges, non-existent revision handling, and CLI exit code).
- `py -3 scripts/validate-blueprint.py`: PASS (18 skills, 5 rules, 12 expected files).
- `py -3 scripts/verify-one-file-history.py 100`: PASS (all 100 audited commits touch exactly 1 file: 98 single-file commits + 2 valid 2-parent PR merges).
- `git diff --check main...HEAD`: PASS (0 whitespace / formatting issues).
- `npm run typecheck`: PASS (0 errors across node and web targets).
- `npm run lint`: PASS (0 errors, 0 warnings).
- `npm run test`: PASS (93 tests total across 6 suites: display-manager [11], navigation-guard [17], preload-api [10], ipc-contracts [26], ipc-handlers [25], App.test.tsx [4]).
- `npm run build`: PASS (electron-vite built main, preload 1.55 kB with 0 zod dependencies, and renderer).
- Manual Windows check: run `npm run dev` in PowerShell/terminal to observe the desktop window.

## Next recommended task

P1.2: Capture Single display only; validate no leakage from other physical display (Milestone M1).

## Completed work template (fill after genuine verification)

```md
Date/Task ID:
Changed file(s) and commit SHAs (exactly one file per commit):
Tests performed (command, result):
Manual Windows check (device, action, observation):
Risks / blockers:
Next task:
```

## Active blockers / decisions

- Windows audio loopback API must be validated on target hardware (ADR-006).
- Local vs remote transcription route to decide based on test (ADR-007).
- Electron SQLite native adapter and OpenRouter endpoint capabilities should be verified (ADR-005/004).

## Progress update rule

Only after actual implementation + verification. Update this file as a **separate one-file commit**, not inside a code commit. Keep roadmap checkboxes in `docs/ROADMAP.md` consistent using another **separate one-file commit** if necessary. Every claimed feature needs a test/demo evidence line; do not check boxes based on code being written alone.

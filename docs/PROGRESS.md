# Progress — source of truth for current implementation

**Last verified:** 2026-11-12. **Current status:** `M0 COMPLETED, M1 IN PROGRESS (P1.1 COMPLETED, P1.2 IN REVIEW)`.

## Summary

- [x] Documentation/specification assembled for initial agent workflow.
- [x] Application repository initialized and bootable (P0.1).
- [x] Runtime code implemented (M0/P0.1 minimal shell).
- [x] Test and lint infrastructure configured and verified green (P0.3).
- [ ] Any Windows hardware or OpenRouter integration tested.
- [ ] Product acceptance criteria verified.

## Current milestone

**M1 — Real Windows capture spike** (Milestone M0 completed and verified: P0.1, P0.2, P0.3, P0.4; Task P1.1 completed and merged; Task P1.2 implemented and in review).

## Verified deliverables

- Documentation pack: README, specification, architecture, UX/design, privacy, tests, roadmap, agent rules/skills, Git hooks (P0.2).
- Git hooks configuration: `.githooks/pre-commit` and `commit-msg` active via `core.hooksPath`; single-file commit policy strictly enforced and tested.
- P0.1 Skeleton: `electron-vite`, React 18, TypeScript strict, `tsconfig.node.json`, `tsconfig.web.json`, secure Electron main process with sandbox and CSP, preload typed bridge, and Quiet Instrument styled React App.
- P0.3 Testing & Quality Stack: Vitest, React Testing Library, ESLint 9 flat config, jsdom DOM environment, baseline contract test ([test/unit/preload-api.test.ts](file:///e:/Windows_AI_Copilot/test/unit/preload-api.test.ts)) and UI component test ([src/renderer/src/__tests__/App.test.tsx](file:///e:/Windows_AI_Copilot/src/renderer/src/__tests__/App.test.tsx)).
- Workflow & PR Governance: established feature branch and mandatory Pull Request policy with independent code review (ChatGPT) in `docs/DEVELOPMENT_WORKFLOW.md`.
- History Validator & Review Fixes: updated `scripts/verify-one-file-history.py` to support structurally valid two-parent GitHub PR merge commits (`Merge pull request #...`) while strictly rejecting octopus merges, arbitrary merge subjects, and local branch merges; ensured uniform `(passed, issues, summary)` error handling on invalid Git revisions; added 9-case regression test suite `scripts/test-verify-one-file-history.py` (9/9 PASS); enriched `.agents/skills/atomic-git-commits/SKILL.md` and `docs/DEVELOPMENT_WORKFLOW.md` to mandate SHA verification discipline and align with GitHub PR workflow.
- P0.4 Typed IPC Bridge & Secure BrowserWindow (COMPLETED & MERGED, PR #2): Zod runtime validation at IPC boundary (`CaptureSelectionSchema`, `SessionStatusSchema`, `AppInfoSchema`), strict channel allowlist, main process validated handlers with dispatch gate, typed preload bridge with narrow invoke methods, BrowserWindow security hardening (sandbox, contextIsolation, nodeIntegration: false, webSecurity, navigation controls, window open handler action: 'deny'), and 32 unit/contract tests across 4 test suites passing green.
- P0.4 Security & Code Review Fixes (MERGED via PR #2): resolved all findings from independent code review (P1 external URL validation, P1 BrowserWindow navigation restriction, P1 fail-closed sender/frame authorization, P2 preload sandboxing with 0 zod imports, P2 schema strengthening, P2 preload bridge unit tests).
- P1.1 Windows Display Enumeration & Hotplug Lifecycle (COMPLETED & MERGED, PR #3, merge commit 433e60f):
  * Contracts (`src/shared/contracts/channels.ts` & `src/shared/contracts/ipc.ts`): added `DISPLAYS_GET_ALL` and `DISPLAYS_CHANGED` channels, pure interfaces (`DisplayBounds`, `DisplayInfo`, `DisplayConfiguration`), and strict Zod validation schemas (`DisplayBoundsSchema`, `DisplayInfoSchema`, `DisplayConfigurationSchema`). Added 10 contract tests.
  * Core Manager (`src/main/displays/display-manager.ts`): implemented `DisplayManager` supporting single/dual/multi-monitor setups, display normalization (converting IDs to string, calculating geometry, workArea, scaleFactor, rotation, primary flag), hotplug event lifecycle (`display-added`, `display-removed`, `display-metrics-changed`) with listener cleanup, deterministic ID sorting, comprehensive deduplication key including `workArea`, `label`, `isPrimary`, and non-mutating `selectedDisplayLost: true` detection when a selected display disconnects without automatic fallback.
  * Event Forwarder & IPC Handlers (`src/main/displays/display-manager.ts`, `src/main/ipc/register-handlers.ts`, `src/main/index.ts`): implemented `forwardDisplayEvents` validating display configuration against `DisplayConfigurationSchema` before dispatching to `mainWindow.webContents`, suppressing messages if window is destroyed, and cleaning up listeners on window close. Registered `DISPLAYS_GET_ALL` with fail-closed sender context validation.
  * Preload Bridge (`src/preload/index.ts`): exposed typed `getDisplays(): Promise<DisplayConfiguration>` and `onDisplaysChanged(callback): () => void` returning dedicated unsubscribe cleanup function, keeping preload bundle free of external dependencies (0 zod imports).
  * Skill Governance: updated `.agents/skills/screen-capture/SKILL.md` with explicit rules for real consumer connection, narrow typed IPC bridge, mandatory unsubscribe, comprehensive deduplication, and distinction between mock tests and physical hardware reality.
  * Host Hardware Verification: host machine verified with two physical 1080p monitors (`DISPLAY1` primary at 0,0, `DISPLAY2` secondary at -1920,1) via .NET Windows.Forms enumeration.
  * Unit & Contract Tests: 108 tests total across 6 test suites passing green (`display-manager.test.ts` [20], `ipc-contracts.test.ts` [26], `ipc-handlers.test.ts` [28], `navigation-guard.test.ts` [17], `preload-api.test.ts` [13], `App.test.tsx` [4]).
- External AI & Codex Review Policy Governance: permanently banned autonomous Codex review triggers (`@codex review`), Codex Cloud tasks, and paid external AI reviews across `AGENTS.md`, `docs/DEVELOPMENT_WORKFLOW.md`, and `.agents/skills/code-review/SKILL.md`. Formalized that independent code review is conducted exclusively by ChatGPT in standard conversational chat initiated by the user.
- P1.2 Single Display Capture Isolation & Hotplug Abort (IN REVIEW, PR #4):
  * Capture Contracts (`src/shared/contracts/capture.ts`, `src/shared/contracts/channels.ts`, `src/shared/contracts/ipc.ts`): defined pure `CapturedFrame`, `FrameBufferOptions`, `FrameBufferStats`, and `ScreenCapturePort` contracts. Added `SESSION_START`, `SESSION_STOP`, and `SESSION_STATUS_CHANGED` channels. Implemented strict runtime Zod schemas (`SessionStartRequestSchema`, `SessionStartResponseSchema`, `SessionStopResponseSchema`, `CaptureStatusSchema`). Added 9 new contract unit tests (35 tests total in `ipc-contracts.test.ts`).
  * In-Memory Bounded Ring Buffer (`src/main/capture/frame-buffer.ts`): implemented `FrameRingBuffer` enforcing strict bounds (`maxFrames`, `maxBytes`, duration TTL). Non-negotiable invariant: enforces cross-display isolation by rejecting any frame with mismatched `displayId`. Buffers flushed completely on stop. Added 8 unit tests (`frame-buffer.test.ts`).
  * Fail-Closed Source Resolver (`src/main/capture/source-resolver.ts`): prioritized 4-tier resolution mapping logical display ID to Electron `desktopCapturer` source ID. Fails closed with structured errors (`DISPLAY_NOT_FOUND`, `NO_MATCHING_SOURCE`, `AMBIGUOUS_SOURCE_MATCH`) if display is absent, ambiguous, or unmapped. Added 8 unit tests (`source-resolver.test.ts`).
  * Isolated Capturer (`src/main/capture/single-display-capturer.ts`): implemented `SingleDisplayCapturer` adhering strictly to single-display invariant. Samples ONLY the chosen display; the other display is never initialized, captured, or buffered. Subscribes to `DisplayManager` hotplug stream; if `selectedDisplayLost: true`, immediately aborts capture and flushes buffers with NO automatic fallback to primary. Fully idempotent `stop()` clears timers, subscriptions, and buffers. Added 7 unit tests (`single-display-capturer.test.ts`).
  * IPC Handlers & Lifecycle Wiring (`src/main/ipc/register-handlers.ts`, `src/main/index.ts`): registered `SESSION_START` and `SESSION_STOP` handlers guarded by fail-closed sender context validation. Wired `SingleDisplayCapturer` instance to `mainWindow` lifecycle with automatic teardown on window `closed`. Added 6 new IPC handler unit tests (34 tests total in `ipc-handlers.test.ts`).
  * Preload Bridge (`src/preload/index.ts`): exposed typed `startSession` and `stopSession` methods in `window.api` with 0 external dependencies (0 zod imports in preload bundle). Added 2 new unit tests (15 tests total in `preload-api.test.ts`).
  * Unit & Contract Tests: 148 tests total across 9 test suites passing green (`frame-buffer.test.ts` [8], `source-resolver.test.ts` [8], `single-display-capturer.test.ts` [7], `ipc-contracts.test.ts` [35], `ipc-handlers.test.ts` [34], `preload-api.test.ts` [15], `display-manager.test.ts` [20], `navigation-guard.test.ts` [17], `App.test.tsx` [4]).

## Latest evidence

- `py -3 scripts/test-verify-one-file-history.py`: PASS (9 regression tests covering single-file commits, multi-file rejection, 2-parent merges, octopus merges, arbitrary merge subjects, non-conforming formats, local branch merges, non-existent revision handling, and CLI exit code).
- `py -3 scripts/validate-blueprint.py`: PASS (18 skills, 5 rules, 12 expected files).
- `py -3 scripts/verify-one-file-history.py 100`: PASS (all 100 audited commits touch exactly 1 file: 97 single-file commits + 3 valid 2-parent PR merges).
- `git diff --check main...HEAD`: PASS (0 whitespace / formatting issues).
- `npm run typecheck`: PASS (0 errors across node and web targets).
- `npm run lint`: PASS (0 errors, 0 warnings).
- `npm run test`: PASS (148 tests total across 9 suites: frame-buffer [8], source-resolver [8], single-display-capturer [7], display-manager [20], navigation-guard [17], preload-api [15], ipc-contracts [35], ipc-handlers [34], App.test.tsx [4]).
- `npm run build`: PASS (electron-vite built main, preload 1.76 kB with 0 zod dependencies, and renderer).
- Physical dual-monitor configuration: PASS (host verified with two physical 1080p monitors via .NET enumeration).
- Real Electron physical cable disconnect/reconnect hotplug: NEEDS MANUAL TEST (mock tests verify protocol correctness; manual Windows test procedure documented below).
- Real physical display frame capture: NEEDS MANUAL TEST (mock tests verify single-source isolation, memory bounds, and hotplug abort; manual Windows test procedure documented below).

### Reproducible Windows Manual Test Instructions:
1. Run `npm run dev` in PowerShell to launch the desktop application.
2. Open DevTools (`Ctrl+Shift+I`) and inspect `window.api`:
   - Execute: `const config = await window.api.getDisplays()` → verifies physical displays enumerated with bounds and workArea.
   - Execute: `const displayId = config.displays[0].id`
   - Execute: `const startRes = await window.api.startSession({ mode: 'single', displayId })` → verifies session start response `ok: true`.
   - Execute: `const stopRes = await window.api.stopSession()` → verifies session stop response `ok: true`.
3. Test hotplug abort during capture:
   - Start session on secondary monitor: `await window.api.startSession({ mode: 'single', displayId: config.displays[1].id })`
   - Turn off or disconnect secondary monitor.
   - Observe capture aborts immediately, buffers are flushed, and no fallback occurs to primary monitor.

## Next recommended task

Independent Code Review of PR #4 (Task P1.2); then Task P1.3 (Dual Display Simultaneous Capture).

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

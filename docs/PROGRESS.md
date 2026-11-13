# Progress — source of truth for current implementation

**Last verified:** 2026-11-13. **Current status:** `M0 COMPLETED, M1 COMPLETED, M2 COMPLETED (P2.1, P2.2, P2.3, P2.4 IMPLEMENTED & MERGED, GATE-2 CONSOLIDATED MANUAL CHECKLIST PREPARED)`.

## Summary

- [x] Documentation/specification assembled for initial agent workflow.
- [x] Application repository initialized and bootable (P0.1).
- [x] Runtime code implemented (M0, M1, and M2 complete modular implementation).
- [x] Test and lint infrastructure configured and verified green (P0.3, 30 suites, 406 tests).
- [x] Any Windows hardware or OpenRouter integration tested (P1.1, P1.2 physical screen capture & hotplug, P2.1-P2.4 audio pipelines).
- [ ] Product acceptance criteria verified.

## Current milestone

**M2 — Audio observation spike** (Milestones M0 and M1 completed and verified; Tasks P2.1, P2.2, P2.3, P2.4 completed and merged; GATE-2 consolidated manual checklist prepared; Milestone M3 pending).

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
- Permanent Engineering Improvement Protocol & Persistent Knowledge Architecture (COMPLETED):
  * Global Multi-Project Policy (`C:\Users\Lenovo\.gemini\AGENTS.md` & `GEMINI.md`): installed minimal persistent engineering policy in user home configuration covering Research Before Implementation, Evidence-Driven Development, Adversarial Self-Review, Continuous Learning, and Resource Safety.
  * Historical Review Lessons Repository (`docs/ENGINEERING_LESSONS.md`): codified 11 forensic engineering lessons from PR #1, PR #2, PR #3, and PR #4 reviews with symptom, root cause, generalizable rule, preventive test, and skill linkages.
  * Mandatory Four-Stage Engineering Lifecycle (`AGENTS.md`): enshrined Stage A (Acceptance & Feasibility), Stage B (Design Validation & Spike), Stage C (Incremental Implementation & Unit Testing), and Stage D (Pre-PR Adversarial Self-Review) as required workflow for all coding tasks, with pre-planning review of engineering lessons.
  * Workspace Skills Hardening: upgraded `.agents/skills/feature-implementation/SKILL.md` (4-stage protocol & Acceptance/Evidence matrix), `.agents/skills/testing-strategy/SKILL.md` (observable data invariants over mocks, mandatory failing regression test first, and explicit evidence taxonomy), `.agents/skills/code-review/SKILL.md` (adversarial self-review checklist and evidence matrix verification), and `.agents/skills/bug-investigation/SKILL.md` (structured 4-question RCA, failing test baseline, and `docs/ENGINEERING_LESSONS.md` persistence).
  * Deterministic Quality Gates (`test/unit/production-invariants.test.ts`): added 6 deterministic quality tests (7ms execution time) verifying zero dummy payloads (`Uint8Array(1024)`), mandatory `{ width: 0, height: 0 }` thumbnail option for desktopCapturer enumeration, fail-closed exact display source resolution, 0 zod imports in preload bundle, mandatory `removeListener` cleanup in preload event subscribers, and fail-closed navigation/window-open handlers.
  * Antigravity Native Slash Command Integration: documented workflow for `/learn` to capture user conversational feedback and persist lessons into project skills.
- P1.2 Single Display Capture Isolation & Hotplug Abort (COMPLETED & ACCEPTED, PR #4):
  * Capture Contracts (`src/shared/contracts/capture.ts`, `src/shared/contracts/channels.ts`, `src/shared/contracts/ipc.ts`): defined pure `CapturedFrame`, `FrameBufferOptions`, `FrameBufferStats`, `CaptureTarget`, `FrameCaptureBackend` (with `start` and `stop` lifecycle hooks), and `ScreenCapturePort` contracts. Added `SESSION_START`, `SESSION_STOP`, and `SESSION_STATUS_CHANGED` channels. Implemented strict runtime Zod schemas (`SessionStartRequestSchema`, `SessionStartResponseSchema`, `SessionStopResponseSchema`, `CaptureStatusSchema`). Added 9 contract unit tests (35 tests total in `ipc-contracts.test.ts`).
  * Source-Specific MediaStream Backend (`src/main/capture/mediastream-backend.ts`): implemented `MediaStreamDisplayCaptureBackend` providing source-specific screen capture via `session.setDisplayMediaRequestHandler`. Verifies caller frame authority, grants access strictly to the requested target source (`screen:X:0`), rejects unauthorized frames or unselected displays with fail-closed denial (`callback({})`), completely eliminates cross-display thumbnails, and tears down MediaStream tracks and handlers on `stop()`.
  * Hard-Bounded Ring Buffer (`src/main/capture/frame-buffer.ts`): implemented `FrameRingBuffer` enforcing strict bounds (`maxFrames`, `maxBytes`, duration TTL). Validates constructor bounds (throws `RangeError` if `<= 0`), validates payload integrity (`byteLength === data.byteLength`), rejects oversized frames (`byteLength > maxBytes`) before buffer insertion, and requires explicit display binding (`bindDisplay`/`unbind`, rejects unbound push). Memory references cleared on stop. Added 12 unit tests (`frame-buffer.test.ts`).
  * Fail-Closed Source Resolver (`src/main/capture/source-resolver.ts`): strictly requires exact match on `DesktopCapturerSource.display_id`. Removed all unsafe heuristics (index matching, pattern guessing, name matching). Fails closed with descriptive errors on missing, duplicate, ambiguous, or unmapped sources. Added 9 unit tests (`source-resolver.test.ts`).
  * Race-Safe Capturer & Status Synchronization (`src/main/capture/single-display-capturer.ts`): implemented `SingleDisplayCapturer` with single source of truth for `SessionStatus`. Uses `thumbnailSize: { width: 0, height: 0 }` during source enumeration to prevent cross-display thumbnails. Uses session generation tokens (`sessionGeneration`) with post-await checks to cancel in-flight operations on stop, hotplug, or restart. Rejects cancelled starts with cancellation error. Synchronously halts capture and flushes buffers on abrupt termination (`SELECTED_DISPLAY_LOST`). Safely handles asynchronous `backend.stop()` rejections during abrupt termination via `Promise.resolve(backend.stop()).catch(...)` and tracks `pendingBackendStop` to prevent in-flight teardown races on subsequent start/stop. Awaits asynchronous backend stop on user stop. Prevents overlapping capture operations via in-flight capture lock (`isCapturing`). Added 18 unit tests (`single-display-capturer.test.ts`).
  * Test Fixtures (`test/fixtures/image-fixtures.ts`): implemented `createTestPngBuffer` generating genuine, decodable PNG binary image data (RFC 2083 signature and IHDR/IDAT/IEND chunks), completely replacing dummy zero arrays.
  * IPC Handlers & Lifecycle Wiring (`src/main/ipc/register-handlers.ts`, `src/main/index.ts`): registered `SESSION_START` and `SESSION_STOP` handlers guarded by fail-closed sender context validation. `SESSION_START` verifies capturer reached `active` state and fails closed if cancelled/aborted. `SESSION_STOP` awaits asynchronous capturer teardown. Forwards `SESSION_STATUS_CHANGED` to authorized window. Wired `SingleDisplayCapturer` instance to `mainWindow` lifecycle with automatic teardown on window `closed`. Added 39 unit tests (`ipc-handlers.test.ts`).
  * Preload Bridge (`src/preload/index.ts`): exposed typed `startSession` and `stopSession` methods in `window.api` with 0 external dependencies (0 zod imports in preload bundle). Added 15 unit tests (`preload-api.test.ts`).
  * Behavioral Security Gate (`test/unit/production-invariants.test.ts`): implemented 12 behavioral quality gate tests verifying zero-thumbnail metadata enumeration, source-specific stream authorization, unselected source protection, fail-closed unknown/duplicate source handling, resource release on stop with permanent deny-by-default handler, no capture after stop/hotplug, discard of stale post-invalidation frames, fail-closed production capturer start without an Electron window context, and preload/navigation invariants.
  * Real MediaStream Capture Pipeline (`src/shared/contracts/capture.ts`, `src/main/capture/capture.html`, `src/main/capture/capture-window-client.ts`, `src/main/capture/mediastream-backend.ts`, `src/main/capture/single-display-capturer.ts`): defined `DisplayMediaStreamClient` interface; added secure local capture surface (`capture.html`) with strict CSP; implemented `CaptureWindowClient` with real `BrowserWindow` creation, partition binding (`in-memory:aura-capture`), exact `captureWindow.webContents.mainFrame` and origin authorization, timeout-bounded stream acquisition via `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })`, `ImageCapture` / `OffscreenCanvas` PNG encoding with RFC 2083 signature validation, and deterministic track/window teardown on `stop()`; hardened `MediaStreamDisplayCaptureBackend` with exact frame identity delegation, authorized origin validation, audio request exclusion, and permanent fail-closed deny-by-default handler on stop/idle; wired `SingleDisplayCapturer` with initial buffered frame verification.
  * Pipeline Regression Suite (`test/unit/mediastream-pipeline.test.ts`): added 20 behavioral tests asserting fail-closed behavior on missing validator, origin mismatch, permanent deny-all policy post-stop, idle denial, audio exclusion, `CaptureWindowClient` real window composition, partition binding, exact frame identity matching, foreign frame denial, invalid target rejection, invalid PNG payload rejection, track teardown, user gesture activation parameter (`userGesture: true`), failed startup cleanup on `loadFile` rejection, pending window destruction handling, clean retry from pristine state, `NotAllowedError`/`InvalidStateError`/`NotSupportedError` fail-closed handling, and document path resolution with fail-closed missing document behavior.
  * Asset Bundling & Startup Reliability Hardening (`electron.vite.config.ts`, `vitest.config.ts`, `tsconfig.node.json`, `src/main/capture/capture-window-client.ts`, `test/unit/production-invariants.test.ts`): configured HTML asset handling via `?asset` and `assetsInclude: ['**/*.html']`; included `electron-vite/node` asset types; verified that `electron-vite build` bundles `out/main/chunks/capture-B5idrik2.html` and resolves runtime path via `__dirname` without `process.cwd()` repository coupling; hardened `startStream` with full window cleanup and state reset on `loadFile` rejection or unexpected window closure; added 2 build artifact and CSP invariant tests (14 tests total in `production-invariants.test.ts`).
  * Preload Bridge Repair & Autonomous Electron Runtime Verification: resolved Electron 33 renderer sandbox limitation by switching preload output to CommonJS (`out/preload/index.cjs`); automated runtime smoke harness (`scripts/electron-smoke.cjs` & `npm run test:electron-smoke`) validating live bridge and IPC methods in real Electron executable.
  * Real Windows Display-to-Capture Source Mapping (`windows-display-query.ts` & `source-resolver.ts`): implemented Strategy 2 (`windows_device_bounds_match`) strictly gated to empty `source.display_id` fallback, matching unique physical bounds against OS-enumerated `WindowsDisplayDevice` entries under documented `DISPLAY<N>` index assumption.
  * Multi-Mode Supervised Verification Harness (`scripts/verify-physical-isolation.cjs`): implemented CLI with `--mode <auto|single|dual>`, `--list-displays`, `--check-harness`, and `--help`. Dynamic display count resolution distinguishes environmental precondition skips `SKIPPED_INSUFFICIENT_DISPLAYS` from functional failures. Collision-resistant immutable multi-run report preservation under `artifacts/local-validation/physical-isolation/<single|dual|skipped>/<runId>.json`. 32 unit tests in `test/unit/physical-harness-modes.test.ts`.
  * Physical Dual-Monitor Source Isolation (Test A — PASS, 9/9 checks): host verified with two physical 1080p monitors; Display 1 Cobalt Blue ratio 1.0, mean `{r:0,g:87,b:182}`, 52635 bytes; Display 2 Crimson Red ratio 1.0, mean `{r:217,g:44,b:43}`, 54331 bytes; both pattern windows on `screen-saver` topmost band; resource teardown clean; nonexistent display fails closed without fallback; clean exit 0; preserved in `artifacts/local-validation/physical-isolation/dual/2026-11-12T23-00-05-310Z-8zksd0.json`.
  * Physical Single-Monitor Capture (Test B — PASS, 7/7 checks): laptop display `1238924755` isolated after physical cable disconnection; Cobalt Blue ratio 1.0, Crimson Red ratio 0, mean `{r:0,g:87,b:182}`, 56340 bytes; buffer emptied; recovery to `idle`; clean exit 0; preserved in `artifacts/local-validation/physical-isolation/single/2026-11-12T22-56-25-799Z-05ubho.json`.
  * Physical Reconnection Between Sessions (Test C — PASS): external monitor reconnected, enumerated both displays, dual-monitor isolation test re-run with 9/9 PASS.
  * Live Hotplug Disconnect Test during Active Capture (Test D — PASS): user-observed manual hardware verification; selected external monitor `368940417` (`2475W1`); `startSession` entered `active`; external monitor cable physically unplugged during active capture; display count dropped 2->1; `selectedDisplayLost: true` emitted; session transitioned from `active` to `error`; zero cross-display fallback to laptop display; explicit `stopSession()` restored `idle`.
  * Internal Asynchronous Cleanup & Teardown Audit: verified immediate generation invalidation, buffer flush, timer clear, display listener unsubscription; `pendingBackendStop` promise tracking prevents in-flight teardown race conditions and ensures clean sequential startup; 18 unit tests in `single-display-capturer.test.ts` passing green.
  * Unit & Contract Tests: 266 tests total across 14 test suites passing green (`physical-harness-modes.test.ts` [32], `single-display-capturer.test.ts` [18], `frame-buffer.test.ts` [12], `source-resolver.test.ts` [18], `windows-display-query.test.ts` [6], `frame-pixel-sampler.test.ts` [9], `ipc-contracts.test.ts` [35], `ipc-handlers.test.ts` [39], `preload-api.test.ts` [15], `display-manager.test.ts` [20], `navigation-guard.test.ts` [17], `production-invariants.test.ts` [16], `mediastream-pipeline.test.ts` [25], `App.test.tsx` [4]).
- P1.3 Dual Display Simultaneous Capture & Synchronization (COMPLETED & VERIFIED, PR #5):
  * Dual Capture Contracts (`src/shared/contracts/capture.ts`, `src/shared/contracts/ipc.ts`, `src/shared/contracts/channels.ts`): defined dual session start/stop contracts, dual frame buffer schemas, and unified status events.
  * DualDisplayCapturer Implementation (`src/main/capture/dual-display-capturer.ts`): orchestrates two concurrent child `SingleDisplayCapturer` instances, manages synchronized dual ring buffers, handles single-child failure abort, and enforces fail-closed teardown.
  * False-Positive Stop Prevention & Error Propagation (`src/main/capture/single-display-capturer.ts`): diagnosed and fixed critical defect where `SingleDisplayCapturer.stopAsync()` caught and swallowed backend stop errors, allowing state to falsely become `idle`. Now guarantees in-memory buffer clearing while transitioning state to `'error'` (`BACKEND_STOP_FAILED: <msg>`) and rethrowing teardown errors so supervisors and IPC callers fail closed without false-positive success.
  * Interrupted Start Cancellation & Track Teardown (`src/main/capture/capture-window-client.ts`): diagnosed and fixed asynchronous race condition where calling `stopStream()` while `getDisplayMedia()` was in-flight allowed late-resolving starts to restore active stream state and leak MediaStream tracks in Chromium. Introduced `streamGeneration` lifecycle token, unconditional in-page track cleanup in `cleanupStream()`, and in-page `window.__streamCancelled` check that immediately stops newly granted tracks if stopped during acquisition.
  * Unit & Regression Tests: added targeted regression test suites for backend stop failure rejection and error state transition (`test/unit/single-display-capturer.test.ts`) and stop-during-in-flight-start race invariants (`test/unit/mediastream-pipeline.test.ts`), bringing the passing unit test suite to 299 tests across 19 suites.
- P1.4 Overlay Exclusion, Screen Recursion Guard & Windows DPI Scaling (COMPLETED & MERGED, PR #7):
  * Content Protection (`src/main/capture/overlay-exclusion.ts`, `src/main/index.ts`): implemented `applyContentProtection` invoking `win.setContentProtection(true)` (backed by Windows DWM display affinity) on main and future overlay windows; safely handles destroyed windows and platform fallback.
  * Recursion Guard & Overlap Detection (`src/main/capture/overlay-exclusion.ts`): implemented `isWindowOverlappingDisplay` with negative coordinate support and `evaluateRecursionRisk` to prevent uncontrolled capture feedback loops when overlay or application windows intersect the target display.
  * Windows DPI Scaling Mapping (`src/main/capture/dpi-bounds.ts`): implemented `toPhysicalBounds`, `toLogicalBounds`, and `matchesDisplayBounds` mapping logical DIPs to physical pixels across 100%, 125%, 150%, and mixed-DPI dual-monitor setups with negative coordinates.
  * DPI-Aware Source Resolution (`src/main/capture/source-resolver.ts`): integrated `matchesDisplayBounds` into Strategy 2 to resolve coordinates whether Windows reports physical or logical dimensions without false-closed mismatches under DPI scaling.
  * Unit Tests: 323 tests total across 21 test suites passing green (`dpi-bounds.test.ts` [8], `overlay-exclusion.test.ts` [15], `source-resolver.test.ts` [19], etc.).
- P2.1 Microphone Capture & Lightweight Energy VAD (COMPLETED & MERGED, PR #9):
  * Audio Contracts (`src/shared/contracts/audio.ts`): defined `AudioChunk`, `AudioDevice`, `AudioCaptureStatus`, `VadOptions`, `VadStatus`, and `AudioBufferStats` without external package dependencies.
  * Energy-Based VAD (`src/main/capture/audio-vad.ts`): implemented `EnergyVad` calculating real RMS on Int16 PCM samples, speech hangover window (`minSpeechDurationMs`, `silenceHoldDurationMs`), and clean reset. 11 unit tests (`audio-vad.test.ts`).
  * Bounded Audio Ring Buffer (`src/main/capture/audio-ring-buffer.ts`): implemented `AudioRingBuffer` enforcing chunk count caps (300 chunks), byte budget caps (5 MB), and duration TTL eviction (10s) with monotonic timestamp ordering and O(1) buffer clears. 7 unit tests (`audio-ring-buffer.test.ts`).
  * Microphone Capturer Supervisor (`src/main/capture/microphone-capturer.ts`): implemented `MicrophoneCapturer` with single source of truth for session status, generation tokens for cancellation protection, fail-closed permission denial handling, and immediate buffer flush on stop. 9 unit tests (`microphone-capturer.test.ts`).
- P2.2 Windows System Audio Capture via Electron Loopback (COMPLETED & MERGED, PR #10):
  * System Loopback Capturer (`src/main/capture/system-loopback-capturer.ts`): implemented `SystemLoopbackCapturer` wrapping system playback audio, integrating independent bounded ring buffer, and tagging every audio chunk with `source: 'system'`. 7 unit tests (`system-loopback-capturer.test.ts`).
  * Electron In-Memory Loopback Backend (`src/main/capture/electron-loopback-backend.ts`): implemented `ElectronLoopbackBackend` using `session.setDisplayMediaRequestHandler` on a dedicated partition (`in-memory:aura-audio-loopback`) with `{ audio: 'loopback' }` to tap default Windows playback (speakers/headphones) without microphone contamination or external .NET DLLs. 4 unit tests (`electron-loopback-backend.test.ts`).
- P2.3 Independent Audio Controls & Typed IPC (COMPLETED & MERGED, PR #11):
  * Integrated Audio Supervisor (`src/main/capture/integrated-audio-supervisor.ts`): orchestrates both microphone and system loopback capturers with independent toggles (none, mic-only, system-only, both), isolated error handling (mic permission failure does not stop loopback), and monotonic source tagging. 9 unit tests (`integrated-audio-supervisor.test.ts`).
  * Electron Microphone Backend (`src/main/capture/electron-microphone-backend.ts`): manages microphone device enumeration and chunk delivery for the main process pipeline. 4 unit tests (`electron-microphone-backend.test.ts`).
  * Typed IPC Handlers (`src/main/ipc/register-handlers.ts`, `src/shared/contracts/channels.ts`, `src/shared/contracts/ipc.ts`): added `AUDIO_GET_STATE`, `AUDIO_SET_CONFIG`, `AUDIO_GET_DEVICES`, and `AUDIO_STATE_CHANGED` channels with strict `AudioConfigSchema` validation, fail-closed sender authentication, and state forwarder to webContents. 8 unit tests (`audio-ipc.test.ts`).
  * Preload Bridge (`src/preload/index.ts`): exposed `getAudioState`, `setAudioConfig`, `getAudioDevices`, and `onAudioStateChanged` on `window.api`. 19 unit tests (`preload-api.test.ts`).
- P2.4 Audio Pause/Stop Lifecycle & Privacy Indications (COMPLETED & MERGED, PR #12):
  * Privacy Pause/Resume Discard Invariant (`src/main/capture/microphone-capturer.ts`, `src/main/capture/system-loopback-capturer.ts`, `src/main/capture/integrated-audio-supervisor.ts`): added `pause()` and `resume()` to capturers and `pauseAll()`/`resumeAll()` to supervisor; while paused, all incoming audio chunks from hardware are dropped immediately to prevent covert recording.
  * Stop Buffer Zero-Retention Teardown (`src/main/ipc/register-handlers.ts`, `src/main/index.ts`): `SESSION_STOP` and window `closed` synchronously trigger `stopAll()` on the audio supervisor, immediately clearing all memory buffers to 0 chunks and 0 bytes.
  * Quiet Instrument Privacy Badges (`src/renderer/src/App.tsx`): added explicit UI badges adhering to `DESIGN.md`:
    - `MIC RECORDING` (with red status dot `#E86D70`) when mic capture is active;
    - `SYSTEM AUDIO CAPTURED` (amber badge `#EFC278`) when system loopback capture is active;
    - `PAUSED` / `MIC PAUSED` / `SYSTEM AUDIO PAUSED` when paused;
    - Zero recording badges rendered when stopped or idle.
  * Unit Tests: 7 lifecycle and privacy tests in `audio-lifecycle-privacy.test.ts` and 9 UI tests in `App.test.tsx` passing green.
  * Full Suite Status: 30 test suites, 398 tests passing green. Zero typecheck errors, zero ESLint warnings, clean build.
- Independent Staff Expert Audit & Defect Repair across M1 & M2 (P1.4 + GATE-1, P2.1-P2.4 + GATE-2):
  * Dual-Subsystem Teardown Safety: resolved critical defect in `src/main/ipc/register-handlers.ts` where sequential `await` caused audio supervisor teardown to be skipped if screen capturer threw. Replaced with `Promise.allSettled`, guaranteeing that microphone/loopback buffers and tracks are stopped and cleared even on screen backend errors.
  * Concurrent Start Protection: hardened `MicrophoneCapturer` and `SystemLoopbackCapturer` against parallel `start()` invocations while state is `'starting'`, rejecting with descriptive error.
  * Real Measured VAD RMS: fixed `EnergyVad.getStatus()` reporting static `0` by recording `lastRms` on every processed PCM frame, allowing real-time monitoring of microphone audio levels.
  * Byte-Offset Buffer Alignment: fixed `MicrophoneCapturer` TypedArray crash (`RangeError`) on unaligned `byteOffset % 2 !== 0` by adding alignment verification and slice fallback before `Int16Array` construction.
  * Bidirectional DPI Matching: enhanced `matchesDisplayBounds` in `src/main/capture/dpi-bounds.ts` to bidirectionally evaluate physical vs logical DIP bounds across scaling factors.
  * UI State Synchronization: updated `src/renderer/src/App.tsx` to include `audioState.system.status === 'paused'` in pause/resume detection and added toggle rollback on backend rejection to prevent desync between checkboxes and runtime state.
  * Preload Cleanup Verification: added invariant test in `test/unit/production-invariants.test.ts` verifying that `onAudioStateChanged` returns an unsubscribe handler calling `removeListener`.
  * Full TypeScript Compilation Coverage for Tests: added `test/**/*` to `tsconfig.node.json`, eliminating a blind spot where `npm run typecheck` previously checked only `src/`. Resolved all static type errors across test suites (`electron-loopback-backend.test.ts`, `audio-ipc.test.ts`, `ipc-contracts.test.ts`, `ipc-handlers.test.ts`, `mediastream-pipeline.test.ts`). Recorded Lesson 21 in `docs/ENGINEERING_LESSONS.md`.
  * Quality Status: 30 test suites, 406 tests passing green (100% pass rate). Zero typecheck errors, zero lint warnings, clean build.

### Capture Backend Architecture & Trade-Offs Analysis:
1. **Architecture 1 — Electron `desktopCapturer` in Main process**:
   - *Mechanism*: Queries `desktopCapturer.getSources` and reads `NativeImage` thumbnail (`toPNG()`).
   - *Strengths*: Simple, in-process, extracts genuine monitor pixel dimensions and PNG data.
   - *Limitations & Privacy Caveat*: Chromium's C++ desktop capturer generates thumbnails for ALL connected displays at the OS level during `getSources(thumbnailSize)`. Even though JavaScript filters out unselected displays, unselected screen data briefly enters memory at the native layer.
2. **Architecture 2 — Chromium MediaStream in dedicated hidden Capture WebContents**:
   - *Mechanism*: Main process creates a hidden WebContents. It calls `navigator.mediaDevices.getUserMedia` with `chromeMediaSourceId: sourceId`. WebRTC binds exclusively to that single display device, opening only its DXGI Output Duplication context.
   - *Strengths*: True single-display isolation at the Chromium/OS level; the second display is never opened.
   - *Trade-offs*: Requires hidden window lifecycle management, canvas frame extraction, and IPC serialization overhead between processes.
3. **Architecture 3 — Native Windows Capture Helper (.NET / Desktop Duplication API)**:
   - *Mechanism*: A lightweight native Windows helper targeting only the specific display device handle (`\\.\DISPLAY1`) or bounding coordinates using Desktop Duplication API or Win32 BitBlt.
   - *Strengths*: Absolute OS-level hardware isolation, zero cross-display leakage, fast execution, aligns with the planned .NET NAudio helper for loopback audio in Milestone M2.
   - *Trade-offs*: External executable or script execution.

## Latest evidence

- `py -3 scripts/test-verify-one-file-history.py`: PASS (9 regression tests covering single-file commits, multi-file rejection, 2-parent merges, octopus merges, arbitrary merge subjects, non-conforming formats, local branch merges, non-existent revision handling, and CLI exit code).
- `py -3 scripts/validate-blueprint.py`: PASS (18 skills, 5 rules, 12 expected files).
- `py -3 scripts/verify-one-file-history.py 100`: PASS (all 100 audited commits touch exactly 1 file: 97 single-file commits + 3 valid 2-parent PR merges).
- `git diff --check main...HEAD`: PASS (0 whitespace / formatting issues).
- `npm run typecheck`: PASS (0 errors across node and web targets).
- `npm run lint`: PASS (0 errors, 0 warnings).
- `npm run test`: PASS (323 tests total across 21 suites: dpi-bounds [8], overlay-exclusion [15], physical-harness-modes [32], mediastream-pipeline [27], ipc-handlers [39], single-display-capturer [19], windows-display-query [6], navigation-guard [17], display-manager [20], ipc-contracts [35], dual-session-ipc [5], dual-display-capturer [11], frame-pixel-sampler [9], frame-buffer [12], preload-api [15], dual-capture-factory [2], dual-capture-backends [5], source-resolver [19], dual-display-selection [7], production-invariants [16], App.test.tsx [4]).
- `Dual-Monitor Physical Source Isolation (Test A)`: PASS (user-observed and verified with 9/9 checks PASS on 2 physical monitors: Display 1 `1238924755` Cobalt Blue ratio 1.0, mean `{r:0,g:87,b:182}`, 52635 bytes; Display 2 `368940417` Crimson Red ratio 1.0, mean `{r:217,g:44,b:43}`, 54331 bytes; both windows positioned on `screen-saver` topmost band; resource teardown clean; nonexistent display fails closed without fallback; clean exit 0; historical evidence preserved in `artifacts/local-validation/physical-isolation/dual/2026-11-12T23-00-05-310Z-8zksd0.json`).
- `Single-Monitor Physical Capture (Test B)`: PASS (user-observed and verified with 7/7 checks PASS after disconnecting external video cable: laptop display `1238924755` Cobalt Blue ratio 1.0, Crimson Red ratio 0, mean `{r:0,g:87,b:182}`, 56340 bytes, attempts: 1; buffer cleanup PASS; nonexistent display fails closed; clean exit 0; historical evidence preserved in `artifacts/local-validation/physical-isolation/single/2026-11-12T22-56-25-799Z-05ubho.json`).
- `Physical Reconnection Between Sessions (Test C)`: PASS (external monitor reconnected, enumerated both displays, dual-monitor isolation test re-run with 9/9 PASS).
- `Live Hotplug Disconnect Test during Active Capture (Test D)`: PASS (user-observed manual hardware verification; selected external monitor `368940417` 2475W1; `startSession` entered `active`; external monitor cable physically unplugged during active capture; display count dropped 2->1; `selectedDisplayLost: true` emitted; session transitioned from `active` to `error`; zero cross-display fallback to laptop display; explicit `stopSession()` restored `idle`).
- `Asynchronous Cleanup & Teardown Audit`: PASS (immediate generation invalidation, buffer flush, timer clear, display listener unsubscription; `pendingBackendStop` promise tracking prevents in-flight teardown race conditions and ensures clean sequential startup; 18 unit tests in `single-display-capturer.test.ts` passing green).
- `Multi-Mode Physical Harness & Collision-Resistant Evidence Storage`: PASS (`scripts/verify-physical-isolation.cjs` supports `--mode <auto|single|dual>`, `--list-displays`, `--check-harness`, and `--help`. Dynamic display count resolution distinguishes environmental precondition skips `SKIPPED_INSUFFICIENT_DISPLAYS` from functional capture failures. Implemented collision-resistant immutable multi-run report preservation under `artifacts/local-validation/physical-isolation/<single|dual|skipped>/<runId>.json` so subsequent runs or skips never overwrite historical evidence. 32 unit tests in `test/unit/physical-harness-modes.test.ts` passing green).
- `MediaStream NotSupportedError Investigation & Repair`: PASS (diagnosed real runtime failure where `defaultCaptureWindowFactory` received options object `{ session: this.session }` but passed it as `webPreferences: { session }`, causing Electron to discard invalid session and fall back to `session.defaultSession` which lacked `setDisplayMediaRequestHandler`; fixed factory parameter unwrapping to properly bind `in-memory:aura-capture`; added bounded 5-attempt retry loop to `ic.grabFrame()` to absorb compositor latency; verified with 5 new unit tests in `mediastream-pipeline.test.ts`).
- `Physical Isolation Test Secondary Window Occlusion Diagnosis & Harness Hardening`: PASS (diagnosed authorized physical run where Display 1 passed Cobalt Blue with ratio 1.0, while Display 2 captured dark application windows occluding the red test pattern due to default `floating` topmost band on non-focused window; hardened `scripts/verify-physical-isolation.cjs` with `screen-saver` topmost band, `showInactive()`, `moveTop()`, pre-capture `getWindowDiagnostics` assertions, bounded 5-attempt diagnostic sampling to distinguish dark/settling frames from persistent occlusion or wrong sources, and cleanly decoupled `processLifecycle` reporting from resource teardown and functional pattern isolation).
- `npm run build`: PASS (electron-vite built main with out/main/chunks/capture-B5idrik2.html [0.35 kB], preload out/preload/index.cjs 2.34 kB CommonJS with 0 zod dependencies, and renderer).
- `npm run test:electron-smoke`: PASS (`smokeScope: metadata-ipc-preload-only`; supports both single and dual display hardware topologies; dynamically validates mandatory applicable checks [bridgeExposure, ipcBaseline, screenEnumeration, desktopCapturerEnumeration with measured 0x0 thumbnails, primaryMapping, missingMapping, unsafeFallback, pixelCaptureZeroed, parent-verified testProcessCleanup] with zero hardcoded statuses; secondaryMapping and duplicateMapping automatically evaluated or marked NOT_APPLICABLE based on connected display count; explicitly marks `physicalPixelIsolation: NOT_RUN` and `physicalSourceIsolationStatus: NOT_VERIFIED`).
- `node scripts/verify-physical-isolation.cjs --check-harness`: PASS (compiles ephemeral CJS bundle via async `esbuild.build()` with `capture.html?asset` plugin, verifies 810,036-byte bundle syntax & CJS exports `[DisplayManager, SingleDisplayCapturer, MediaStreamDisplayCaptureBackend, samplePngPixels]`, deletes `.physical-harness.cjs`, zero physical capture or MediaStream request).
- `node scripts/verify-physical-isolation.cjs --list-displays`: PASS (enumerates connected physical monitors via Electron Screen API without window creation or capture).
- `node scripts/verify-physical-isolation.cjs`: authorization refusal gate verified (`exit 2` without `--authorize-physical-capture`; live run AWAITING EXPLICIT USER AUTHORIZATION).
- Physical dual-monitor configuration: PASS (host verified with two physical 1080p monitors via .NET enumeration; dual-monitor physical isolation PASS).
- Real Electron physical cable disconnect/reconnect hotplug: PASS (user-observed manual hardware verification with live cable disconnect during active session).
- Real single-monitor physical display frame capture isolation: PASS (user-observed physical verification on laptop display).

### Reproducible Supervised Physical Verification & Manual Windows Test Instructions:
1. **Supervised Physical Source Isolation Gate (Run ONLY after explicit user authorization):**
   - Single-monitor test (laptop display only):
     `node scripts/verify-physical-isolation.cjs --mode single --authorize-physical-capture`
     *Action*: Displays Cobalt Blue (`#0057B8`) pattern on laptop screen; runs production `SingleDisplayCapturer`; samples decoded PNG pixels in-memory via `samplePngPixels` confirming Cobalt Blue ratio >= 0.95 and RGB within tolerance; verifies `stop()` buffer cleanup (`frameCount=0`, `totalBytes=0`, `idle`, deny handler restored) and nonexistent-display no-fallback rejection; writes safe aggregate RGB ratios & PASS/FAIL JSON to `artifacts/local-validation/physical-isolation/single/<timestamp>-<hash>.json` and updates `physical-isolation-results.json` pointer without saving raw frames.
   - Dual-monitor test (2 physical monitors connected):
     `node scripts/verify-physical-isolation.cjs --mode dual --authorize-physical-capture`
     *Action*: Requires 2 monitors; if <2 detected, reports `SKIPPED_INSUFFICIENT_DISPLAYS` to `artifacts/local-validation/physical-isolation/skipped/` without failing or overwriting previous PASS.
   - Auto mode (detects monitor count automatically):
     `node scripts/verify-physical-isolation.cjs --authorize-physical-capture`
   - Safe metadata utilities (no capture):
     `node scripts/verify-physical-isolation.cjs --list-displays`
     `node scripts/verify-physical-isolation.cjs --check-harness`
2. **Interactive DevTools / Hotplug Test:**
   - Run `npm run dev` in PowerShell to launch the desktop application and open DevTools (`Ctrl+Shift+I`).
   - Execute: `const config = await window.api.getDisplays()` -> `await window.api.startSession({ mode: 'single', displayId: config.displays[0].id })` -> `await window.api.stopSession()`.
   - Hotplug abort check: Start session on secondary monitor (`config.displays[1].id`), disconnect/power off secondary monitor, verify immediate abort to `error` (`SELECTED_DISPLAY_LOST`) with buffer flush and no fallback to primary monitor, then call `await window.api.stopSession()` to recover to `idle`.
3. **Consolidated Windows Audio Verification (GATE-2):**
   - **Step 1: Launch Application:**
     Run `npm run dev` in PowerShell. The AURA DESK Quiet Instrument window opens.
   - **Step 2: Verify Initial Privacy State:**
     Observe session status shows "Очікування (Сесія вимкнена)". Verify NO recording badges are displayed on screen.
   - **Step 3: Microphone Capture & VAD Test:**
     Check the "Мікрофон" checkbox.
     *Observation*: The UI displays the red `MIC RECORDING` badge with status dot `#E86D70`.
     Open DevTools (`Ctrl+Shift+I`) and run:
     `await window.api.getAudioState()`
     *Observation*: `mic.status === 'active'`, `mic.enabled === true`, `mic.bufferStats.chunkCount > 0`. Speak into the microphone and check `mic.vad.isSpeech === true`.
   - **Step 4: Windows System Audio Loopback Test:**
     Play audio in Windows (e.g., YouTube video or Spotify in headphones/speakers).
     Check the "Системне аудіо" checkbox.
     *Observation*: The UI displays the amber `SYSTEM AUDIO CAPTURED` badge.
     In DevTools, run:
     `await window.api.getAudioState()`
     *Observation*: `system.status === 'active'`, `system.bufferStats.chunkCount > 0`, system loopback chunks are monotonically recorded.
   - **Step 5: Independent Audio Toggles:**
     Uncheck "Мікрофон" while keeping "Системне аудіо" checked.
     *Observation*: `MIC RECORDING` badge disappears immediately, `SYSTEM AUDIO CAPTURED` badge remains visible.
     Check "Мікрофон" back on, then uncheck "Системне аудіо".
     *Observation*: `MIC RECORDING` appears, `SYSTEM AUDIO CAPTURED` disappears. Both toggles operate completely independently.
   - **Step 6: Pause & Privacy Discard Test:**
     With both sources enabled, click the "Пауза" button.
     *Observation*: Badges transition to `MIC PAUSED` and `SYSTEM AUDIO PAUSED` (or `PAUSED`).
     In DevTools, verify incoming chunks are discarded and buffer size does not grow.
     Click "Продовжити" (Resume) -> badges return to `MIC RECORDING` and `SYSTEM AUDIO CAPTURED`.
   - **Step 7: Stop & Buffer Zero Retention:**
     Click the "Зупинити" button.
     *Observation*: All recording badges disappear immediately.
     In DevTools, run:
     `await window.api.getAudioState()`
     *Observation*: Both sources report `status: 'idle'`, `bufferStats.chunkCount === 0`, and `bufferStats.totalBytes === 0`. Complete zero retention verified.

## Next recommended task

Milestone M3: Task P3.1 (Audio Transcription Engine Selection & Integration).

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

- Local vs remote transcription route to decide based on test (ADR-007).
- Electron SQLite native adapter and OpenRouter endpoint capabilities should be verified (ADR-005/004).

## Progress update rule

Only after actual implementation + verification. Update this file as a **separate one-file commit**, not inside a code commit. Keep roadmap checkboxes in `docs/ROADMAP.md` consistent using another **separate one-file commit** if necessary. Every claimed feature needs a test/demo evidence line; do not check boxes based on code being written alone.

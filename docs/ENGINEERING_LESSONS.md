# Engineering Lessons — AURA DESK

This document is the persistent repository of hard-won engineering lessons from actual code reviews, audits, and hardware spikes in AURA DESK. Every entry captures a concrete root cause and a generalizable rule to prevent recurring mistakes across subsequent milestones.

---

## Lesson 1: Real Git History Verification vs Fabricated Report References
- **Symptom:** Implementation reports claimed commits were single-file atomic commits or valid PR merges, but the git history validator failed or rejected merge subjects that did not match GitHub's exact format.
- **Root Cause:** Commits and reports were assembled without running automated SHA and diff-tree checks, and validator regular expressions were initially either too strict (rejecting all merges) or too permissive (allowing arbitrary `Merge ` subjects).
- **Generalizable Engineering Rule:** Every git audit and status report must be verified against actual `git log` and `git diff-tree` output. Automated history validators must strictly enforce canonical 2-parent GitHub PR merge commit subjects (`Merge pull request #<num> from <branch>`) while rejecting arbitrary local merges and octopus merges.
- **Preventive Test / Check:** `scripts/verify-one-file-history.py` run on the commit range + 9-case unit regression suite in `scripts/test-verify-one-file-history.py`.
- **Relevant Skill / Rule:** `.agents/rules/git-discipline.md`, `.agents/skills/atomic-git-commits/SKILL.md`.

---

## Lesson 2: Electron IPC Security Requires Real Sender/Frame Authorization
- **Symptom:** Preload IPC invoke handlers validated payload structures using Zod schemas, but privileged handlers could be invoked by unauthorized senders, nested iframes, or mismatched origins.
- **Root Cause:** Assuming that runtime input schema validation is sufficient for IPC security, neglecting the sender identity and frame hierarchy check at the IPC boundary.
- **Generalizable Engineering Rule:** IPC payload validation is secondary to sender authorization. Every privileged `ipcMain.handle` endpoint must enforce fail-closed sender validation: checking that `event.sender` matches the authorized `BrowserWindow.webContents`, `event.senderFrame` matches the top `mainFrame`, frame URLs match the authorized origin, and iframes (`parent !== null`) are rejected.
- **Preventive Test / Check:** 8-scenario authorization matrix in `test/unit/ipc-handlers.test.ts` (testing missing frame, destroyed frame, empty URL, mismatched sender, nested iframe, untrusted origin).
- **Relevant Skill / Rule:** `.agents/rules/architecture.md`, `.agents/rules/safety-privacy.md`, `.agents/skills/security-audit/SKILL.md`.

---

## Lesson 3: Electron Window Navigation and External URLs Must Fail-Closed
- **Symptom:** `setWindowOpenHandler` passed arbitrary URLs directly to `shell.openExternal()`, and `will-navigate` allowed unrecognized dev/renderer URLs.
- **Root Cause:** Permissive defaults assuming that standard URLs are safe to open in system default browsers.
- **Generalizable Engineering Rule:** All window creation and navigation handlers must be fail-closed by default. `setWindowOpenHandler` must return `{ action: 'deny' }` for all unvetted external URLs. `will-navigate` must prevent navigation to any destination outside the explicit expected application bundle path (`file://...`) or vetted dev server origin.
- **Preventive Test / Check:** `test/unit/navigation-guard.test.ts` covering file URLs, localhost origins, external schemes (`javascript:`, `data:`, `http:`), and edge protocols.
- **Relevant Skill / Rule:** `.agents/rules/safety-privacy.md`, `.agents/skills/security-audit/SKILL.md`.

---

## Lesson 4: OS Event Subscriptions Must Reach a Real Consumer and Support Cleanup
- **Symptom:** Display manager subscribed to Electron `screen` events, but the events were not dispatched to the renderer window or cleaned up when windows closed.
- **Root Cause:** Implementing internal state tracking without wiring the complete pipeline to a consumer or managing subscription lifecycles.
- **Generalizable Engineering Rule:** Never register an OS-level listener without a verified downstream consumer and an idempotent unsubscribe teardown function. Forwarders must check window destruction state prior to sending (`!webContents.isDestroyed()`), and close events must unregister forwarders to prevent memory leaks and duplicate dispatches.
- **Preventive Test / Check:** Dedicated unit tests for listener registration, window close teardown, and suppressed delivery on destroyed WebContents in `test/unit/ipc-handlers.test.ts`.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/feature-implementation/SKILL.md`.

---

## Lesson 5: Display Deduplication Must Include All Consumer-Visible Properties
- **Symptom:** Display metrics change events fired repeatedly for identical layouts or failed to trigger when taskbars were moved or scaling changed.
- **Root Cause:** Deduplication keys only inspected display ID, width, and height, ignoring `workArea`, `scaleFactor`, `rotation`, and `isPrimary`.
- **Generalizable Engineering Rule:** State deduplication must inspect the complete tuple of consumer-visible properties: `id`, `bounds`, `workArea`, `scaleFactor`, `rotation`, `isPrimary`, and `selectedDisplayLost`. Collections must be sorted deterministically before equality comparison.
- **Preventive Test / Check:** `test/unit/display-manager.test.ts` verifying deduplication against identical metrics, workArea changes, scaling changes, and reordered displays.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`.

---

## Lesson 6: Mocked Display Enumeration Does Not Prove Real Hardware Behavior
- **Symptom:** Display enumeration unit tests passed 100% green against mock objects, but physical monitor hotplug and stable ID behavior on Windows was unverified.
- **Root Cause:** Conflating unit test pass with physical hardware verification.
- **Generalizable Engineering Rule:** Unit and mock tests prove protocol correctness, schema validation, and boundary safety, but do NOT prove physical hardware behavior. Physical verification must be explicitly reported as `NEEDS MANUAL TEST` or `NOT VERIFIED` until tested on target Windows hardware with real monitors.
- **Preventive Test / Check:** Separate reporting categories: `UNIT TEST PASS`, `INTEGRATION TEST PASS`, `PHYSICAL WINDOWS TEST — NEEDS MANUAL TEST`.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/testing-strategy/SKILL.md`.

---

## Lesson 7: Fake Screenshot Bytes Must Never Be Reported as Successful Real Capture
- **Symptom:** Production capturer generated `new Uint8Array(1024)` dummy arrays and claimed real single-display capture feature was complete.
- **Root Cause:** Using a test placeholder in production code to achieve mock test green status without building the real capture pipeline.
- **Generalizable Engineering Rule:** Production code must NEVER emit dummy arrays or synthetic placeholders masquerading as real media. Decouple metadata resolution from frame capture via dedicated ports (`FrameCaptureBackend`). Production backends must extract genuine pixel data and factual dimensions, while fake adapters belong strictly in test fixtures.
- **Preventive Test / Check:** `test/fixtures/image-fixtures.ts` emitting valid PNG binary buffers with authentic RFC 2083 headers, combined with automated checks against dummy byte allocations.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/feature-implementation/SKILL.md`.

---

## Lesson 8: Privacy-Sensitive Display Mapping Cannot Rely on Unverified Heuristics
- **Symptom:** Display resolver attempted fallbacks using screen array indices, `screen:<index>:0` pattern guessing, and display label matching.
- **Root Cause:** Assuming that display indices or names remain stable and correlate between Electron `screen` and `desktopCapturer`.
- **Generalizable Engineering Rule:** Privacy-sensitive resource mapping must be strictly fail-closed. When mapping a selected display to a capture source, only exact `DesktopCapturerSource.display_id === targetDisplay.id` is permitted. If `display_id` is missing, unmapped, duplicate, or ambiguous, fail closed immediately. Never fallback to index, name, or primary display.
- **Preventive Test / Check:** `test/unit/source-resolver.test.ts` asserting rejection of index fallbacks, name fallbacks, duplicate IDs, and disconnected targets.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/rules/safety-privacy.md`.

---

## Lesson 9: Async Capture Operations Require Cancellation or Generation Validation
- **Symptom:** Calling `stop()` or experiencing hotplug while `getSources()` or `captureFrame()` was in-flight allowed late-arriving frames to be pushed into memory or intervals to be recreated after stop.
- **Root Cause:** Asynchronous calls (`await`) returning after component teardown or state change without checking whether the triggering session was still valid.
- **Generalizable Engineering Rule:** Every multi-step asynchronous operation must be protected by an incrementing session generation token. After every `await`, re-validate `this.sessionGeneration === currentGen && this.status === 'active'`. If invalidated, discard results, do not modify buffers, do not schedule timers, and return immediately.
- **Preventive Test / Check:** Race regression tests in `test/unit/single-display-capturer.test.ts` (Stop while getSources pending, Stop while frame capture pending, concurrent Starts, no timer recreation).
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/feature-implementation/SKILL.md`.

---

## Lesson 10: Resource and Memory Limits Must Be Guaranteed, Even for Extreme Inputs
- **Symptom:** Ring buffer eviction loop allowed a single oversized frame exceeding `maxBytes` to remain in the buffer indefinitely.
- **Root Cause:** Evicting previous frames without validating whether the incoming frame itself fits within the maximum memory budget.
- **Generalizable Engineering Rule:** Input limits must be checked prior to buffer modification. Validate options (positive finite numbers), check payload integrity (`byteLength === data.byteLength`), and reject any single oversized frame (`byteLength > maxBytes`) immediately. Eviction loops must ensure `totalBytes <= maxBytes` at all times.
- **Preventive Test / Check:** `test/unit/frame-buffer.test.ts` verifying rejection of oversized frames, negative options, and payload length mismatches.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/rules/safety-privacy.md`.

---

## Lesson 11: Session State Must Reflect Actual Underlying Component State
- **Symptom:** When display capturer encountered `SELECTED_DISPLAY_LOST` or source disappearance, it stopped internally, but the IPC layer still returned `status: 'active'` to consumers.
- **Root Cause:** Decoupled duplicate state variables where the IPC module maintained its own status independently of the underlying capturer.
- **Generalizable Engineering Rule:** There must be a single authoritative source of truth for component lifecycle state. IPC handlers must query the underlying supervisor/port directly (`capturer.getStatus()`), and asynchronous failure events must dispatch status change notifications (`SESSION_STATUS_CHANGED`) to all consumers.
- **Preventive Test / Check:** `test/unit/ipc-handlers.test.ts` verifying that unexpected termination updates `SESSION_GET_STATE` immediately to `'error'` and that `SESSION_STOP` recovers to `'idle'`.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/rules/architecture.md`.

---

## Lesson 12: A Source-Code Pattern Assertion Is Not a Substitute for a Behavioral Security Invariant
- **Symptom:** PR #4 review correctly rejected `ElectronDesktopCapturerBackend.captureFrame()` for acquiring cross-display thumbnails across all monitors at the OS level, despite a dedicated quality gate (`test/unit/production-invariants.test.ts`) passing green.
- **Root Cause & Detection Gap:** The quality gate used static regex pattern assertions against source code text (`toMatch(/thumbnailSize:\s*\{\s*width:\s*0,\s*height:\s*0\s*\}/)` and `not.toMatch(/Uint8Array\(\s*1024\s*\)/)`). Because `start()` contained a zero-size thumbnail call for metadata enumeration, the regex passed, but it failed to detect that `captureFrame()` in the same file was calling `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })` with non-zero dimensions, triggering Chromium to render thumbnails of all connected screens at runtime.
- **Generalizable Engineering Rule:** Static string matching or syntax regexes cannot guarantee behavioral, privacy, or architectural invariants. Critical security boundaries must be verified through deterministic behavioral tests using realistic mock boundaries that intercept actual method invocations, assert parameter values across all execution branches, verify access denial to unauthorized callers, and prove full resource teardown.
- **Preventive Test / Check:** `test/unit/production-invariants.test.ts` behavioral suite spying on `desktopCapturer.getSources` (asserting `thumbnailSize` is strictly 0x0 across enumeration) and `MediaStreamDisplayCaptureBackend` (asserting `setDisplayMediaRequestHandler` grants exclusively the selected target source and rejects unauthorized frames or unselected displays with fail-closed denial).
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/testing-strategy/SKILL.md`.

---

## Lesson 13: Permission Configuration Is Not the Same as an Implemented Data Pipeline
- **Symptom:** PR #4 review identified that production `MediaStreamDisplayCaptureBackend.captureFrame()` threw at runtime because `frameExtractor` was not injected, and no production component actually invoked `navigator.mediaDevices.getDisplayMedia()` or extracted frames from WebContents. Tests had passed green because test suites had injected fake backends or fake frame extractors.
- **Root Cause & Detection Gap:** The permission gate (`session.setDisplayMediaRequestHandler`) was correctly implemented and tested, but permission authorization was mistaken for an active data capture pipeline. Because unit tests mocked the backend boundary (`fakeBackend`), the absence of a real capture client capable of running inside an isolated WebContents was masked. Furthermore, calling `setDisplayMediaRequestHandler(null)` on `stop()` restored Chromium's default permission prompt / system picker rather than enforcing a permanent deny-by-default policy.
- **Generalizable Engineering Rule:** Authorizing access to a resource does not equal retrieving or processing data from that resource. A data capture subsystem requires both a secure permission gate and an active extraction pipeline (`DisplayMediaStreamClient`). In Electron main process, DOM media APIs (`navigator.mediaDevices.getDisplayMedia`) require a dedicated execution context (e.g. isolated in-memory partition `in-memory:aura-capture`); on session stop or idle, security gates must install an explicit fail-closed deny handler (`callback(null)`) rather than resetting to `null`.
- **Preventive Test / Check:** `test/unit/mediastream-pipeline.test.ts` behavioral regression tests asserting permanent fail-closed post-stop handler, missing-validator rejection, origin checking, and `CaptureWindowClient` lifecycle / frame extraction; `test/unit/production-invariants.test.ts` asserting fail-closed denials and 2-phase handler registration.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/architecture-design/SKILL.md`, `.agents/rules/safety-privacy.md`.

---

## Lesson 14: Verification Reports Must Never Hardcode PASS or Mistake Metadata Mapping for Pixel Proof
- **Symptom:** The Electron runtime smoke test hardcoded `verificationStatus: 'PASS'` and `PASS` statuses for several evidence items even when checks degraded to `'WARN'`; additionally, Windows coordinate resolution assumed `\\.\DISPLAY<N>` maps 1:1 to `screen:<N-1>:0` and presented metadata matching as sufficient before inspecting actual captured pixels.
- **Root Cause & Detection Gap:** Hardcoded evidence statuses bypass overall failure gating, while platform-specific enumerations (`DISPLAY<N>` -> WebRTC index) remain working assumptions unless verified against physical pixel output on the target machine. Furthermore, allowing fallback resolution when any source provides a reliable `display_id` risks cross-display hijacking.
- **Generalizable Engineering Rule:** Verification harnesses must compute every check status from live runtime observations, compute overall `PASS` strictly from all applicable mandatory checks (failing closed on any failure), and explicitly separate `metadata` pass status from unverified `physical pixel isolation` (`NOT_VERIFIED` until supervised pixel-pattern capture succeeds). Platform heuristics must be explicitly documented as unverified assumptions, gated strictly to cases where direct `display_id` metadata is absent across all sources, and confirmed via non-sensitive in-memory pixel pattern verification without persisting raw screen frames.
- **Preventive Test / Check:** `scripts/electron-smoke.cjs` dynamic `evaluateOverallStatus`, `test/unit/source-resolver.test.ts` rejecting coordinate fallback when `display_id` is populated and rejecting duplicate display bounds, and supervised `scripts/verify-physical-isolation.cjs` using `samplePngPixels`.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/testing-strategy/SKILL.md`, `.agents/rules/safety-privacy.md`.

---

## Lesson 15: Factory Parameter Wrapping vs Direct Argument Mismatches Silently Break Electron Session Isolation
- **Symptom:** In production runtime on physical Windows, `await window.api.startSession({ mode: 'single', displayId: '...' })` failed with `[CAPTURE_START_FAILED] CaptureWindowClient failed to initialize capture window: Stream acquisition failed [NotSupportedError]: NotSupportedError: Not supported`.
- **Root Cause & Detection Gap:** `CaptureWindowClient` called its window factory with an options object `this.windowFactory({ session: this.session })`. However, `defaultCaptureWindowFactory(session: unknown)` expected `session` as its direct parameter and passed `webPreferences: { session }` to `new BrowserWindow(...)`. As a result, Electron received `webPreferences: { session: { session: this.session } }`. Because Electron's internal native argument validator expects `webPreferences.session` to be an Electron `Session` instance, it silently discarded the invalid object and fell back to `session.defaultSession`. Meanwhile, `MediaStreamDisplayCaptureBackend` had registered `setDisplayMediaRequestHandler` on the isolated partition session `session.fromPartition('in-memory:aura-capture')`. When the hidden capture window called `navigator.mediaDevices.getDisplayMedia(...)`, Chromium checked `session.defaultSession`, where no display media request handler was registered, and immediately rejected with `NotSupportedError: Not supported`. Because unit tests used mock window factories that extracted `({ session })`, this mismatch was masked in unit testing.
- **Generalizable Engineering Rule:** Electron window factories must robustly normalize options parameters: unwrap `options?.session` when receiving an options object and fall back to the direct argument if passed as a session. Factory contracts must be exercised by unit tests using realistic window creation options assertions. Furthermore, frame extraction pipelines must account for OS compositor latency: calling `ImageCapture.grabFrame()` synchronously immediately after `getDisplayMedia()` can race with the OS rasterizer before the first frame is ready, requiring a bounded, defensive retry loop.
- **Preventive Test / Check:** `test/unit/mediastream-pipeline.test.ts` suite `defaultCaptureWindowFactory session unwrapping & isolation invariants` testing both object options and direct argument passing with strict property assertions; and `CaptureWindowClient` bounded retry loop for `ic.grabFrame()`.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/architecture-design/SKILL.md`, `.agents/rules/architecture.md`.

---

## Lesson 16: Multi-Monitor Test Overlays Must Enforce Topmost Bands and Bounded Diagnostic Sampling
- **Symptom:** In supervised dual-monitor physical verification, Display 1 (Primary) passed Cobalt Blue pattern isolation, but Display 2 (Secondary) failed with `crimsonRedRatio = 0`, `meanRgb = {r:17, g:17, b:17}`, and a 225 kB frame. Visual inspection confirmed the Crimson Red pattern was on the secondary desktop but occluded behind open application windows.
- **Root Cause & Detection Gap:** In Electron on Windows, `alwaysOnTop: true` with `focusable: false` defaults to the standard `floating` topmost band. On secondary monitors with negative coordinates, Windows DWM does not automatically raise a non-focusable window above pre-existing topmost windows or active foreground applications without calling `setAlwaysOnTop(true, 'screen-saver')` (the highest topmost band), `showInactive()`, and `moveTop()`. Furthermore, taking a single immediate frame without diagnostic sampling could not distinguish a transient dark compositor frame from persistent occlusion or wrong source mapping. Finally, a failed color check caused `processCleanup` to be marked FAIL simply because the child exited with code 1, confounding test assertion failure with resource leakage.
- **Generalizable Engineering Rule:** Test-pattern windows intended to cover an entire display must be explicitly raised to `screen-saver` topmost band, shown via `showInactive()`, ordered with `moveTop()`, and validated prior to capture (`boundsMatch`, `isVisible`, `isAlwaysOnTop`, `!isMinimized`). If windows fail placement or visibility verification, the test must fail closed immediately to avoid capturing private applications. Verification pipelines must use bounded diagnostic sampling (checking up to 5 samples over ~1s, logging timing, dimensions, and mean RGB), failing fast if the opposite monitor's pattern is detected, and separating process lifecycle reporting (exit code, signals, timeouts) from resource teardown (tracks, buffers, windows) and functional pattern isolation.
- **Preventive Test / Check:** `scripts/verify-physical-isolation.cjs` pre-capture `getWindowDiagnostics` assertions, `setAlwaysOnTop(true, 'screen-saver')`, `moveTop()`, bounded `samplePatternWithDiagnostics`, and separated `processLifecycle` vs `patternWindowsDestroyed` / `stopAndBufferCleanup` checks.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/testing-strategy/SKILL.md`, `.agents/rules/safety-privacy.md`.

---

## Lesson 17: Capturer Stop Failures Must Transition to Error State and Propagate to Supervisors
- **Symptom:** In `SingleDisplayCapturer.stopAsync()`, errors thrown by `backend.stop()` (or `pendingBackendStop`) were caught and logged via `console.error`, but swallowed, allowing the capturer status to still become `'idle'`. In `DualDisplayCapturer`, `stopChildren()` called `SingleDisplayCapturer.stop()` on both children. Because the child's `stop()` resolved without error, `DualDisplayCapturer` reported a clean successful stop even though a child backend had failed to release underlying MediaStreams or native handles.
- **Root Cause & Detection Gap:** A misplaced assumption that teardown operations should always return smoothly to allow clean recovery, without distinguishing in-memory cleanup (buffer clearing, target unbinding) from OS/backend release failure. In-memory buffers were cleared, but masking the backend failure created a false sense of security that media tracks were stopped.
- **Generalizable Engineering Rule:** While in-memory buffers and target bindings must be flushed immediately to prevent memory/data leaks even when teardown fails, a teardown failure in underlying resources (OS handles, MediaStreams, windows) must NOT transition the capturer to `'idle'`. The status must transition to `'error'` (e.g. `BACKEND_STOP_FAILED: <msg>`), and the teardown error must be rethrown so that higher-level orchestrators (`DualDisplayCapturer`, IPC handlers) fail closed, detect that underlying resources may remain allocated, and never report a false-positive successful stop.
- **Preventive Test / Check:** `test/unit/single-display-capturer.test.ts` verifying that `stop()` rejects when `backend.stop()` throws, transitions state to `'error'`, preserves the error message, flushes the ring buffer, and allows subsequent clean retry.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/rules/architecture.md`, `.agents/rules/safety-privacy.md`.

---

## Lesson 18: Asynchronous Stream Acquisition Must Support Immediate Cancellation and Track Teardown
- **Symptom:** If `stopSession()` or window destruction occurred while `navigator.mediaDevices.getDisplayMedia()` was in-flight (waiting for user gesture, permission, or OS initialization), the pending acquisition could resolve after the stop call. In `CaptureWindowClient`, `startStream()` unconditionally set `this.active = true` upon script completion without checking if stop was called in the interim. Moreover, `cleanupStream()` checked `if (executor && this.active)`, skipping the in-page track teardown script because `this.active` had not yet become `true`. As a result, late-resolving MediaStream tracks could remain active indefinitely in Chromium without being stopped.
- **Root Cause & Detection Gap:** MediaStream acquisition is inherently asynchronous and can take several seconds. Relying solely on `this.active` to gate track teardown meant that an interrupted or cancelled start slipped past cleanup, and missing an incrementing stream generation lifecycle token allowed late-resolving starts to resuscitate an already-stopped capture client.
- **Generalizable Engineering Rule:** Asynchronous resource acquisition must be protected by lifecycle generation tokens (`streamGeneration`) and a cancellation flag in the execution context (`window.__streamCancelled = true`). Teardown functions (`cleanupStream`) must execute track cleanup unconditionally whenever the execution context is present, without requiring `this.active === true`. In-page scripts must check `window.__streamCancelled` immediately after `getDisplayMedia()` resolves: if cancelled, all newly acquired tracks must be stopped immediately (`t.stop()`) and rejected with `AbortError`. If an acquisition resolves after generation invalidation, the main process must immediately invoke cleanup and throw a cancellation error, ensuring no orphaned MediaStream tracks survive.
- **Preventive Test / Check:** `test/unit/mediastream-pipeline.test.ts` race invariants suite verifying that Stop during in-flight `getDisplayMedia()` stops tracks, aborts start, keeps `isStreamActive() === false`, fails closed on `grabFrame()`, and destroys the window cleanly.
- **Relevant Skill / Rule:** `.agents/skills/screen-capture/SKILL.md`, `.agents/skills/testing-strategy/SKILL.md`, `.agents/rules/safety-privacy.md`.

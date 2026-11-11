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

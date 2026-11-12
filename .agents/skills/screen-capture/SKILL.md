---
name: screen-capture
description: "Implements and tests Windows screen enumeration, explicit both/single monitor capture, privacy controls, device hotplug and bounded frame buffers."
---

# Screen Capture (Windows, two explicit modes)

## Required invariant
ONLY `both` or `single(displayId)`. The chosen mode controls **actual capture**, not merely which screenshots are forwarded. No active-window auto-selection.

## Steps
1. Read `FR-02`, `docs/ARCHITECTURE.md` and Electron `screen`/`desktopCapturer` API docs for actual installed version.
2. Write a minimal hardware spike: enumerate physical display IDs, sizes and primary; map to capturer sources. Manually verify monitor 1/2 identity.
3. Add `ScreenCapturePort` and a supervisor owning track handles. On `single`, never create or retain other-display track.
4. On `both`, run two time-stamped low-frequency sample loops with max RAM bytes/frames and debounced change detection.
5. Changing both→single: stop unselected source FIRST; discard its ring-buffer frames before new inference.
6. On hotplug/missing chosen ID: pause/error; never auto-substitute a different display.
7. Exclude own overlay if supported (`setContentProtection` is not universal guarantee); confirm experimentally and document workaround.
8. Ensure Stop and Pause free frames/tracks/timers. Add deterministic tests for IDs/race/bounds.

## Display Enumeration, Hotplug & IPC Delivery Rules
1. **Real consumers required**: Merely subscribing to OS screen events is insufficient; every handled event must be connected to a validated application consumer and forwarded to the renderer.
2. **Narrow typed IPC bridge**: Display configuration and hotplug notifications must pass through narrow typed contracts (`aura:displays-changed`, `getDisplays()`). Never expose raw `ipcRenderer`, universal `on`, `send`, or Node APIs to renderer code.
3. **Strict unsubscribe and teardown**: Every subscription must return a dedicated unsubscribe function; listeners must be unregistered when windows close or destroy to prevent listener leaks and duplicate dispatches.
4. **Comprehensive deduplication key**: Deduplication of display events must inspect all consumer-visible fields: `workArea`, `label`, `bounds`, `scaleFactor`, `rotation`, `isPrimary`, `count`, `primaryId`, and `selectedDisplayLost`. Sorting must be canonical (by ID).
5. **No auto-fallback on display loss**: When a previously selected display is disconnected, report `selectedDisplayLost: true` to the consumer; never silently mutate or automatically substitute another display.
6. **Mocked hotplug vs hardware reality**: Unit and mock tests prove protocol correctness and boundary behavior, but do not equal real Windows hardware testing. Claim hardware verification only with physical unplug/replug evidence.
7. **Display ID stability caveat**: Electron display IDs are normalized strings and must never be treated as immutable hardware serial numbers across reboot, dock, or driver restarts.

## Single Display Capture Isolation & Privacy Invariants
1. **Real image data required in production**: Production capture must yield genuine decoded/encoded image data with factual dimensions and format; synthetic or dummy zero arrays (`new Uint8Array(1024)`) labeled as image formats are strictly forbidden in production.
2. **Fake frames belong only in tests**: Controlled fake frames with verifiable PNG binary signatures, valid dimensions, and known byte lengths are restricted exclusively to test adapters and fixtures.
3. **Zero-thumbnail metadata enumeration & thumbnail ban**: When querying `desktopCapturer.getSources` for display metadata mapping, always set `thumbnailSize: { width: 0, height: 0 }` and `fetchWindowIcons: false`. Requesting non-zero thumbnail dimensions forces Chromium to capture screenshots of all connected monitors simultaneously at the OS level; using `getSources` with non-zero thumbnail dimensions for frame acquisition is strictly forbidden in production.
4. **No unsafe source fallbacks**: Mapping an enumerated display to a desktopCapturer source must require an exact match on `DesktopCapturerSource.display_id`. Unsafe heuristics (matching by array index, `screen:<index>:0` pattern, or fuzzy screen names) are prohibited for privacy-sensitive capture and must fail closed.
5. **Async cancellation and generation tokens**: All asynchronous capture workflows (`getSources`, `captureFrame`, `start`, `stop`) must bind to an incrementing session generation token. After every `await`, re-validate that the session generation, state, and active display have not changed before modifying state, scheduling timers, or pushing frames.
6. **Idempotent stop and stale frame rejection**: `stop()` must immediately invalidate in-flight operations, cancel interval timers, clear buffer frames, and unbind displays. Late-arriving frames from a cancelled generation must be discarded.
7. **Authoritative session state synchronization**: The capture supervisor or capturer port is the sole source of truth for session lifecycle status (`idle`, `starting`, `active`, `stopping`, `error`). Unexpected terminations (e.g. display loss or source disappearance) must transition state to `error` and notify listeners via `SESSION_STATUS_CHANGED`.
8. **Hard frame buffer bounds**: Memory limits must be enforced unconditionally. Frame buffers must validate payload integrity (`byteLength === data.byteLength`), reject oversized frames (`byteLength > maxBytes`) prior to insertion, and require explicit display binding.
9. **Source-specific capture via MediaStream**: Production capture must route through source-specific APIs (such as `session.setDisplayMediaRequestHandler` granting exclusively the target source ID and validating caller frame authority). Unselected screens must never have capture handles opened.
10. **Behavioral quality gates required**: Capture privacy and isolation must be proven with deterministic behavioral unit and integration tests (asserting zero thumbnails during enumeration, zero calls to unselected sources, and fail-closed denial for unknown/unauthorized callers). Never rely on static string regex checks as a substitute for behavioral proof.
11. **Physical hardware isolation boundary**: Mocked unit tests prove protocol correctness and handler safety, but cannot verify physical OS-level multi-monitor isolation. Real physical isolation on Windows requires dedicated manual hardware verification with two connected monitors.
12. **Dedicated in-memory capture partition**: Production capture must execute within an isolated in-memory session partition (`in-memory:aura-capture`, cache disabled). Never share or expose the default application session to capture handlers.
13. **Permanent deny-by-default handler**: `stop()` and initialization must establish a permanent fail-closed handler (`(req, cb) => cb(null)`); never reset to `null`, as `setDisplayMediaRequestHandler(null)` restores Chromium's default permission prompt / picker.
14. **Caller frame and origin validation**: MediaStream requests must validate caller frame hierarchy (`WebFrameMain`, reject child/nested frames) and enforce authorized origin. Requests without validation or from unauthorized frames/origins must fail closed immediately.
15. **Stream client track lifecycle & hardware release**: The capture client owns the active `MediaStream` and tracks. On `stopStream()`, it must explicitly stop each video track (`track.stop()`) and nullify references to release OS/hardware display capture handles.
16. **Active pipeline vs permission configuration**: Configuring `setDisplayMediaRequestHandler` only authorizes stream creation; it does not extract frames. Production capture requires an active extraction pipeline (`DisplayMediaStreamClient`) capable of obtaining real frames without mocks.

## Proof
- Fake-port unit for `T-SCR-01..04`; real Windows two-monitor testing for `A-02..04` and overlay recursion.
- Record display resolutions/scale and actual observed results; no simulated pass.

## Failure exits
Unknown source mapping, screen permission denied or inconsistent ID = BLOCKED; do not proceed to full AI feature as if working.

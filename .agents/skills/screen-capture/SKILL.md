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

## Proof
- Fake-port unit for `T-SCR-01..04`; real Windows two-monitor testing for `A-02..04` and overlay recursion.
- Record display resolutions/scale and actual observed results; no simulated pass.

## Failure exits
Unknown source mapping, screen permission denied or inconsistent ID = BLOCKED; do not proceed to full AI feature as if working.

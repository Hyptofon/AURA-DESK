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

## Proof
- Fake-port unit for `T-SCR-01..04`; real Windows two-monitor testing for `A-02..04` and overlay recursion.
- Record display resolutions/scale and actual observed results; no simulated pass.

## Failure exits
Unknown source mapping, screen permission denied or inconsistent ID = BLOCKED; do not proceed to full AI feature as if working.

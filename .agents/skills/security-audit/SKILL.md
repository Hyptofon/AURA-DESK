---
name: security-audit
description: "Audits microphone/screen consent, Electron hardening, untrusted prompt content, secure OpenRouter key handling, retention and cancellation/privacy safety in AURA DESK."
---

# Security & Privacy Audit

## Checklist
1. Explicit Start/Pause/Stop state, REC visibility, actual tracks and worker cleanup; no covert recording.
2. Single-display mode ensures other display is not sampled/retained/transmitted even under race or hotplug.
3. Mic/system sound independent; no audio source enabled by UI illusion only; respect people recorded in meetings.
4. Main/preload/renderer boundary: contextIsolation, Node disabled, CSP, narrow IPC, Zod validation, no keys in renderer or logs.
5. IPC sender and frame validation: all IPC handlers must verify `event.sender` belongs to the authorized `BrowserWindow` and `event.senderFrame` is top-level (`parent === null`, `top === senderFrame`) matching the trusted origin. Invocations from iframes or unauthorized senders must be denied immediately (`UNAUTHORIZED_SENDER`, `UNAUTHORIZED_FRAME`).
6. Safe external URL opening: deny new window creation by default in `setWindowOpenHandler`; strictly validate URLs before calling `shell.openExternal()` — permit only HTTPS with valid hostnames and no embedded credentials; reject dangerous protocols (`file:`, `javascript:`, `data:`, `shell:`, OS handlers); catch errors safely to prevent unhandled promise rejections.
7. Navigation restrictions: enforce `will-navigate` guards — restrict dev mode to `ELECTRON_RENDERER_URL` origin; restrict production mode strictly to the exact application HTML document path; reject arbitrary local `file:` traversal and external origins.
8. Fail-closed preload sandboxing: if `process.contextIsolated` is disabled, fail closed (throw error); never fall back to exposing APIs on `globalThis`. Keep sandboxed preload bundles free of Node modules or runtime schema libraries (like `zod`) by using zero-dependency contract modules (`channels.ts`).
9. Real boundary testing: test actual exported preload bridges and handlers with Electron mocks (`vi.mock('electron')`) rather than synthetic local mock objects. Include negative security tests for untrusted senders, child iframes, dangerous protocols, and extra payload keys.
10. API key encrypted using current Electron supported safeStorage async calls or OS mechanism; degraded mode refuses plaintext.
11. Untrusted screen/transcripts/files/web + model output may NOT execute commands, alter agent instructions or open arbitrary URLs.
12. Sanitized Markdown and path allowlist. File import handles secrets, symlink/traversal, malformed PDFs.
13. Bounded rolling buffers and retention deletion; cloud request budgets and visible model/provider data routing.
14. Test budget failures, cancellation, 401/429 and data erasure on Stop; report findings with severity and concrete remediation.
15. Do not claim compliance/privacy guarantees from assumptions. Use actual current official Electron/OpenRouter docs and measured implementation behavior.

## Report
Blocker first, then high/medium/low, exact file/line, exploit scenario, tests run/not run, one-file repair commit plan.

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
5. IPC fail-closed authorization: privileged IPC handler registration must require an explicit authorization context. Handlers must fail closed on missing `event`, missing/untrusted `sender`, missing/null/destroyed `senderFrame`, empty `frame.url`, or mismatched `trustedWebContents.mainFrame`. Never treat optional or lifecycle-destroyed frame data as implicitly authorized.
6. Safe external link policy: generic HTTPS validity is not equivalent to user permission. Deny new window creation by default in `setWindowOpenHandler` (`action: 'deny'`); never automatically dispatch `shell.openExternal()` without explicit user consent. When invoked upon user action, validate HTTPS protocol, domain, and absence of embedded credentials.
7. Complete production document identity: navigation guards (`will-navigate`) must validate the complete trusted document identity — protocol (`file:`), hostname (strictly reject `file://remote-host/...` even if pathname matches), exact file path, and reject unexpected query parameters (`?injected=true`) while preserving in-document hash navigation (`#/path`). Never load `ELECTRON_RENDERER_URL` in packaged production apps.
8. Fail-closed preload sandboxing: if `process.contextIsolated` is disabled, fail closed (throw error); never fall back to exposing APIs on `globalThis`. Keep sandboxed preload bundles free of Node modules or runtime schema libraries (like `zod`) by using zero-dependency contract modules (`channels.ts`).
9. Real boundary and omitted-metadata testing: test actual exported preload bridges and handlers with Electron mocks (`vi.mock('electron')`). Negative tests must cover omitted security metadata (missing context, null `event`, null `senderFrame`, empty URL, wrong `mainFrame`), not merely malformed values.
10. API key encrypted using current Electron supported safeStorage async calls or OS mechanism; degraded mode refuses plaintext.
11. Untrusted screen/transcripts/files/web + model output may NOT execute commands, alter agent instructions or open arbitrary URLs.
12. Sanitized Markdown and path allowlist. File import handles secrets, symlink/traversal, malformed PDFs.
13. Bounded rolling buffers and retention deletion; cloud request budgets and visible model/provider data routing.
14. Test budget failures, cancellation, 401/429 and data erasure on Stop; report findings with severity and concrete remediation.
15. Do not claim compliance/privacy guarantees from assumptions. Use actual current official Electron/OpenRouter docs and measured implementation behavior.

## Report
Blocker first, then high/medium/low, exact file/line, exploit scenario, tests run/not run, one-file repair commit plan.

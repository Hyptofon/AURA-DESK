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
5. API key encrypted using current Electron supported safeStorage async calls or OS mechanism; degraded mode refuses plaintext.
6. Untrusted screen/transcripts/files/web + model output may NOT execute commands, alter agent instructions or open arbitrary URLs.
7. Sanitized Markdown and path allowlist. File import handles secrets, symlink/traversal, malformed PDFs.
8. Bounded rolling buffers and retention deletion; cloud request budgets and visible model/provider data routing.
9. Test budget failures, cancellation, 401/429 and data erasure on Stop; report findings with severity and concrete remediation.
10. Do not claim compliance/privacy guarantees from assumptions. Use actual current official Electron/OpenRouter docs and measured implementation behavior.

## Report
Blocker first, then high/medium/low, exact file/line, exploit scenario, tests run/not run, one-file repair commit plan.

---
trigger: model_decision
description: Apply when designing, adding, refactoring, or reviewing Electron/TypeScript modules, IPC, screen/audio capture, data storage, model adapters or cross-module APIs.
---

# Architecture policy

- Modular monolith; main/preload/renderer/core strict boundaries as in `docs/ARCHITECTURE.md`.
- Core pure TypeScript; OS and network behind small ports; Zod runtime validation at IPC and file/profile boundaries.
- No networking or Node API directly from renderer; no capture in UI component.
- One session supervisor owns cancellation/lifecycle; async work respects AbortSignal, backpressure, bounded buffers.
- Avoid premature generic plugin frameworks, service locators, event buses and deep inheritance. Keep test fakes simple.
- Record any architectural divergence as ADR in `docs/DECISIONS.md` **separate one-file commit**.
- Before adding dep: explain why built-ins or current dependency cannot solve it; check license/Windows packaging.

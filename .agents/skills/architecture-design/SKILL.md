---
name: architecture-design
description: "Designs or reviews modular-monolith boundaries, typed ports, Electron main/preload/renderer contracts, session lifecycles and narrowly scoped architecture decision records."
---

# Architecture Design

## Trigger
New component boundaries, IPC shape, persistent schema, display/audio lifecycle, OpenRouter adapter or complicated cross-feature change.

## Procedure
1. Read `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` and privacy rules. Name specific responsibilities, owners and trust boundaries.
2. Draw event/data flow from device → main → pure core → model → renderer. Explicitly mark what leaves machine.
3. Define smallest TS interface and Zod schemas at untrusted boundaries. Enforce `.strict()` and validation on inputs.
4. Guarantee renderer never receives API secret or unrestricted file-system/OS capability.
5. Secure Electron Main/Preload/Renderer boundaries:
   - **Zero-dependency Preload**: Separate IPC channel constants and pure types (`channels.ts`) from runtime validation schemas (`ipc.ts`), ensuring sandboxed preload bundles never import Node modules or `zod`.
   - **Fail-closed Preload**: Preload must throw an explicit security error if `process.contextIsolated` is false; never fall back to exposing bridges on `globalThis`.
   - **IPC Sender and Frame Verification**: Main process handlers must verify that `event.sender` matches the authorized window and `event.senderFrame` is a top-level frame (`parent === null`, `top === senderFrame`) matching the trusted origin. Reject nested iframes and untrusted senders.
   - **Navigation & External Links**: Deny new window creation by default in `setWindowOpenHandler`; validate external links strictly as HTTPS before calling `safeOpenExternal()`. Enforce `will-navigate` guards to prevent arbitrary in-app navigation.
6. Evaluate SOLID pragmatically: dependencies go inward, one interface per distinct consumer, no abstract factory before two implementations needed.
7. Consider performance: image/audio memory caps, backpressure, reentrancy and concurrent Stop.
8. If decision differs from spec, record reason, trade-off, migration in `docs/DECISIONS.md` in **separate 1-file commit**.
9. Add contract tests using fakes and test real exported preload bridges with `vi.mock('electron')`; compare with implementation and accept only evidence-backed claims.

## Rejection criteria
Massive common-utils classes, `any`-based IPC, Electron imports in core, unbounded global event bus, unvalidated IPC senders/frames, fallback on unisolated globals, cloud server added without user need.

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
3. Define smallest TS interface and Zod schemas at untrusted boundaries. Decide cancellation, timeouts, retention, errors and partial failure.
4. Guarantee renderer never receives API secret or unrestricted file-system/OS capability.
5. Evaluate SOLID pragmatically: dependencies go inward, one interface per distinct consumer, no abstract factory before two implementations needed.
6. Consider performance: image/audio memory caps, backpressure, reentrancy and concurrent Stop.
7. If decision differs from spec, record reason, trade-off, migration in `docs/DECISIONS.md` in **separate 1-file commit**.
8. Add contract tests using fakes; compare with implementation and accept only evidence-backed claims.

## Rejection criteria
Massive common-utils classes, `any`-based IPC, Electron imports in core, unbounded global event bus, cloud server added without user need.

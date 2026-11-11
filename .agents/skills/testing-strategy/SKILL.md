---
name: testing-strategy
description: "Designs focused Vitest/React Testing Library tests and staged Electron/Windows manual verification with honest PASS/FAIL/NOT RUN reporting and low token/runtime cost."
---

# Testing Strategy

## Choose tier by risk
- Pure core change -> unit tests, fake clock and controlled ports.
- Renderer change -> RTL role/keyboard/error states.
- Contract/IPC change -> strict Zod shape tests and fake IPC bridge.
- Real screen/audio/OpenRouter integration -> mocked tests for contract, **manual Windows/live API only with user approval**.

## Core testing principles
1. **Observable outcomes and data invariants over mock counts**:
   - Verify actual data payloads (e.g. non-empty valid image formats, correct byte lengths, valid schemas, accurate state transitions) rather than merely checking if a mock function was called.
   - Avoid tests that pass on dummy placeholders (e.g. `Uint8Array(1024)`) while failing on real formats. Test invariants, error bounds, and schema contracts.
2. **Failing regression test before bug fix**:
   - For every confirmed defect, missing requirement, or review finding, write or identify the failing regression test *before* altering implementation code.
   - Verify the test fails for the expected reason, then implement the fix and verify it passes.
3. **Hermetic and offline test fixtures**:
   - Keep fixtures deterministic and offline. Never require live network access, real API keys, or private user files.
   - Respect user privacy: never capture real screen pixels or record live microphone audio during automated test runs without explicit user consent.

## Procedure
1. Read `docs/TEST_STRATEGY.md`, `docs/ENGINEERING_LESSONS.md`, acceptance criteria, changed behavior, and existing tests.
2. Write descriptive Arrange/Act/Assert with positive, negative, cancellation, and edge paths. Avoid output snapshots full of incidental markup.
3. Run smallest test first with scoped test commands (e.g. `npm test -- test/unit/target.test.ts`). Run wider suite only at milestone checkpoints or explicit user request.
4. If test fails, isolate root cause; never delete, skip, or manipulate test assertions to manufacture false PASS.
5. Report evidence using explicit taxonomy:
   - `UNIT TEST PASS`: Scoped Vitest unit tests passed with command and counts.
   - `INTEGRATION TEST PASS`: IPC, preload, or cross-module integration tests passed.
   - `BUILD PASS`: `npm run typecheck`, `npm run lint`, or `npm run build` passed.
   - `PHYSICAL WINDOWS TEST — NEEDS MANUAL TEST`: Requires physical Windows OS device access; report exact minimal manual command/steps.
   - `REAL CAPTURE ISOLATION — NOT VERIFIED`: Explicitly disclaim when real OS screen capture / private user pixels were not captured to respect privacy.
6. If script or harness does not exist, state `NOT AVAILABLE`. Do not claim unverified manual or E2E tests ran.

## Non-negotiable regression matrix
Single display isolation, both mapping, hotplug, pause/stop teardown, source-specific STT, question dedup, provider capability/budget, injected file data, safe IPC, local document delete, and UI focus.

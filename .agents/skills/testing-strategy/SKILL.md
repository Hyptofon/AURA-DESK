---
name: testing-strategy
description: "Designs focused Vitest/React Testing Library tests and staged Electron/Windows manual verification with honest PASS/FAIL/NOT RUN reporting and low token/runtime cost."
---

# Testing Strategy

## Choose tier by risk
- Pure core change → unit tests, fake clock and controlled ports.
- Renderer change → RTL role/keyboard/error states.
- Contract/IPC change → strict Zod shape tests and fake IPC bridge.
- Real screen/audio/OpenRouter integration → mocked tests for contract, **manual Windows/live API only with user approval**.

## Procedure
1. Read `docs/TEST_STRATEGY.md`, acceptance ID, changed behavior and existing tests.
2. Write descriptive Arrange/Act/Assert with positive, negative, cancel and edge paths. No output snapshots full of incidental markup.
3. Keep fixture deterministic and offline; do not use actual API keys or sensitive user files in CI/tests.
4. Run smallest test first. Run wider suite only at milestone or explicit user request.
5. If test fails, isolate real cause; never delete, skip or manipulate test to manufacture PASS.
6. Report exact command, exit code, number passed/failed/skipped when available; differentiate mocked from device verification.
7. If script does not exist say `NOT AVAILABLE`. Do not claim expensive full E2E ran without command evidence.

## Non-negotiable regression matrix
Single display isolation, both mapping, hotplug, pause/stop teardown, source-specific STT, question dedup, provider capability/budget, injected file data, safe IPC, local document delete and UI focus.

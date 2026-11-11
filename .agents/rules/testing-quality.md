---
trigger: model_decision
description: Apply whenever implementing functionality, fixing bugs, adding tests, running test commands, verifying behavior, reviewing changes or marking roadmap done.
---

# Test and review policy

- First map changed behavior to focused tests in `docs/TEST_STRATEGY.md`.
- Start with scoped unit/RTL and typecheck if relevant; do not launch slow hardware/E2E/integration/live API automatically.
- Real Windows 2-display/audio features cannot be marked PASS from mocks. Provide reproduction instructions.
- Test positive, negative, cancellation, race, and privacy boundary where relevant.
- Never turn off failing tests; label unavailable tools/scripts, avoid false PASS.
- Code review for correctness, privacy, security, model capability, perf and design, with severity.
- Mark completed roadmap items only after evidence; docs updated separately per one-file rule.

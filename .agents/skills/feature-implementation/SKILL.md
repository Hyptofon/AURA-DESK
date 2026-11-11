---
name: feature-implementation
description: "Implements a single AURA DESK feature in small typed increments with clear scope, SOLID/KISS/YAGNI, focused tests and one-file Git commits."
---

# Feature Implementation

## Process
1. Verify current roadmap task and reading context. Identify expected states, boundary cases, privacy effects and test ID.
2. Read relevant feature and neighboring interfaces; avoid duplicating existing functionality.
3. If bug-sensitive, introduce a failing test in **its own one-file commit**; otherwise add smallest code file first then test separately.
4. Write TypeScript strict, simple explicit functions; injected adapters for network/OS only. Every async operation has cancellation/cleanup where relevant.
5. Stage one path, review `git diff --cached`, run small relevant test, create one conventional commit. Repeat for subsequent files.
6. After implementation, test disabled/error/unknown sources, invalid data, memory/cost caps and Stop behavior.
7. Review UX if user-visible: loading/empty/error, keyboard states, design tokens.
8. Do not run paid API calls or real device/E2E without approval; give exact manual command.
9. Report SHA for every file, verification results, risks. Update Progress/Roadmap as separate commits only after proof.

## Guardrails
- Keep one responsibility per module, not necessarily artificial <=100 lines.
- No silent fixes in unrelated area, no blanket formatting.
- Never mark `Done` based on a compile alone for real Windows media functionality.

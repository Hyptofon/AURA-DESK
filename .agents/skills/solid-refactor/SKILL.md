---
name: solid-refactor
description: "Refactors existing modules without changing observable behavior using SOLID/KISS/DRY/YAGNI, characterization tests, small diffs and individual commits."
---

# SOLID Refactoring

## Before changes
1. Identify real pain: duplicated ownership, huge component, circular deps, unreadable test, leaked Electron import. Avoid cosmetic abstraction for its own sake.
2. Map existing public behavior and edge cases; add characterization tests in 1-file commits if not already captured.
3. Draw responsibility split: core logic, OS adapter, view, storage. Ensure no behavior change, unchanged user settings/preferences.
4. Keep API compatible unless explicitly approved, migrate callers in separate commits.
5. Every commit touches ONE file; verify each intended staging state, avoid half-migrated merge to main.
6. Run scoped regression tests and broader check when integration cross-cutting; report tests not run.

## SOLID smell heuristics
- **S:** service doing capture+HTTP+UI? split.
- **O/D:** adding OpenRouter model requires rewriting core? introduce port at edge.
- **L:** fake adapter cannot replace production without changing caller? improve contract.
- **I:** giant `AgentService` method bag? small purpose-specific interfaces.
- **KISS/YAGNI:** too many layers, data mappers or abstract factories? remove.
- **DRY:** duplicated business rules across main/preload? centralize validated contract.

Stop if requested change actually requires changed behavior; call that out and separate the feature.

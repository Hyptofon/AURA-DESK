# Task planning template

## Header
Task ID: P?.? · Owner: Antigravity agent · Status: TODO/IN PROGRESS/BLOCKED/VERIFIED

## Why this task
Concrete user-visible outcome + dependency/milestone. Link to `docs/PRODUCT_SPEC.md` requirement (FR-xx) and acceptance (A-xx).

## Scope
Exact expected file paths. If >1 file, list intended sequence of **separate one-file commits**. Explicit out-of-scope.

## Contracts / constraints
Screen selection, audio consent, model capability, privacy, IPC, budget, design or other relevant invariants.

## Implementation steps
- First minimal change and corresponding 1-file commit
- Remaining steps in file-by-file order, each separately committed
- Targeted tests and manual real Windows gate, if applicable

## Evidence before Done
Commands/results, screenshots only if taken by actual tool/user, commit SHAs, acceptance check outcome. `NOT RUN`/`MANUAL REQUIRED` states explicit.

## Follow-up
Remaining risks, next task ID, docs updates in separate commits.

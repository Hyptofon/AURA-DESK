---
name: task-planning
description: "Plans one scoped roadmap task at a time, checks dependencies and acceptance criteria, and decomposes implementation into one-file commits and focused tests."
---

# Task Planning

## Inputs
`docs/ROADMAP.md`, `docs/PROGRESS.md`, `docs/PRODUCT_SPEC.md`, `docs/TEST_STRATEGY.md`, current code, user constraints.

## Workflow
1. Find first incomplete non-blocked task (or user-selected ID). Check prior gate evidence; if gate missing stop and report.
2. Map task → FR-xx / A-xx / test IDs, define desired user-visible behavior and out-of-scope.
3. List files in dependency order. Each file becomes an **independent commit**; do not design a giant feature commit.
4. Identify OS API/capability assumptions, privacy data being handled, cancellation and API cost.
5. Propose minimal verification tier: unit/RTL automatically where possible; hardware/paid/exhaustive E2E only on user's approval.
6. State how roadmap/progress will be committed separately after verification.
7. Produce a concise plan using `docs/TASK_TEMPLATE.md`; avoid endless speculative future backlog.

## Decision tree
- OS capability unknown → first small hardware spike and hold integration.
- Pure TypeScript logic → isolated unit test then implementation file.
- Cross-module contract → architecture review first.
- Visible UI → read DESIGN.md, make small wireframe then implement.

## Exit
One scoped task with concrete DoD and no hidden dependencies.

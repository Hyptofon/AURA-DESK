---
name: feature-implementation
description: "Implements a single AURA DESK feature in small typed increments with clear scope, SOLID/KISS/YAGNI, focused tests and one-file Git commits."
---

# Feature Implementation

Follow the four mandatory engineering stages for all feature tasks:

## Stage A — Acceptance & Feasibility
Before writing code, answer:
1. What exact user-visible or system-level behavior must work?
2. What proves that behavior?
3. Which APIs and contracts are involved?
4. What working assumptions need explicit verification against installed packages/docs?
5. What could fail regarding security, privacy/isolation, concurrency, or resource cleanup?
6. Which tests can verify the behavior independently without sharing the implementation's assumptions?
Assemble a compact acceptance/evidence matrix. Do not spend excessive tokens on trivial edits.

## Stage B — Design Validation
Before implementing complex, privacy-sensitive, or high-risk behavior:
- Verify actual supported APIs against installed versions; never guess undocumented flags.
- Inspect existing architecture, typed contracts, and `docs/ENGINEERING_LESSONS.md`.
- Identify trust boundaries, resource ownership, and platform limitations.
- Select the simplest viable implementation (SOLID/KISS/YAGNI).
- Define failure behavior and recovery strategies.
- For privacy-sensitive or hardware-dependent behavior, reject speculative fallback heuristics (e.g. index/name guessing); fail closed instead.

## Stage C — Incremental Implementation & Testing
Implement strictly using **1 FILE = 1 COMMIT** (`.agents/rules/git-discipline.md`):
- When fixing a defect or replacing an assumption, write a failing regression test first.
- For every substantive behavioral change, add positive and relevant negative tests.
- Verify failure paths, cancellation tokens, lifecycle transitions, and idempotent cleanup.
- Test observable outcomes and data invariants, not merely mocked internal interactions.
- A green test suite is NOT proof of complete functionality if the tests omit the critical behavioral invariant.

## Stage D — Pre-PR Adversarial Audit
Before declaring a feature implemented or opening a PR, conduct an explicit self-review:
- *Placeholders*: Is there any placeholder, hardcoded fake, dummy byte array, or simulated success?
- *Edge inputs*: Can different inputs, unusual screen counts, or missing devices produce incorrect behavior?
- *Races & Leaks*: Can async operations complete after `stop()` or component unmount? Are buffers and timers freed?
- *Trust & Status*: Can untrusted senders invoke privileged operations? Does reported status match actual component state?
- *Evidence Fidelity*: For every high-risk criterion, document:
  `Criterion | Implementation | Test/Evidence | Status | Residual Risk`
- If any critical criterion is unsupported, the task must remain `BLOCKED` or `INCOMPLETE`. Never conceal limitations behind false `PASS` results.

## Guardrails
- Keep one responsibility per module, not artificial <=100 line limits.
- No silent fixes in unrelated areas; no blanket multi-file formatting.
- Never mark Done based on mock tests alone for real Windows media/hardware functionality.

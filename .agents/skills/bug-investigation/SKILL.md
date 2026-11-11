---
name: bug-investigation
description: "Reproduces and fixes Windows AI-agent defects with evidence, minimal scope, regression tests, cancellation checks and single-file commits."
---

# Bug Investigation

1. Get reproducible steps, environment/version/source, expected vs actual. Avoid guessing fix from error summary.
2. Read related code and recent commit history. Capture safe redacted logs, never raw audio/screen secrets.
3. Form 1–3 concrete hypotheses; create minimal deterministic reproduction with a test in its own commit where feasible.
4. Distinguish platform hardware vs model API issue; use fake-port tests first, Windows/manual when required.
5. Fix smallest root cause; no unrelated refactor or dependency upgrade. Commit only changed file.
6. Re-run failing case and nearby tests. Audit cancellation, cleanup, privacy and cost side effects.
7. Report reproduction, exact test result, fix SHA/path and remaining uncertainty; update roadmap/progress separately if task is verified.

**Never** suppress error, increase timeout randomly, or flip assertion simply to get green.

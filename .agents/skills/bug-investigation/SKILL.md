---
name: bug-investigation
description: "Reproduces and fixes Windows AI-agent defects with evidence, minimal scope, regression tests, cancellation checks and single-file commits."
---

# Bug Investigation

## 1. Reproduce & Isolate
1. Obtain exact reproduction steps, environment/version, expected vs actual behavior. Avoid guessing the fix from an error summary.
2. Inspect related code, recent commit history, and `docs/ENGINEERING_LESSONS.md` to identify whether a known defect pattern is recurring.
3. Capture safe redacted logs; never log or persist raw screen frames, audio buffers, or secrets.

## 2. Mandatory Failing Reproduction Test
1. Before modifying any production implementation, construct a minimal, deterministic reproduction test.
2. Run the test and verify it fails with the exact observed failure mode.
3. Commit the reproduction test in its own single-file commit when feasible or maintain it as the verification baseline.

## 3. Structured Root Cause Analysis (RCA)
Answer these four questions during investigation:
1. **Direct Cause**: What exact condition, assertion, or state mutation triggered the failure?
2. **Defect Origin**: Which architectural assumption, edge condition, or contract ambiguity allowed the bug to be introduced?
3. **Detection Gap**: *Why did existing unit, integration, and type checks fail to catch this defect earlier?* (e.g., test asserted mock invocation rather than payload bytes; test fixture used simulated placeholder data; cancellation timing was unexercised).
4. **Systemic Prevention**: What deterministic test, invariant check, or lint rule will prevent this class of bug across all modules permanently?

## 4. Minimal Targeted Remediation
1. Fix the smallest root cause; do not introduce unrelated refactoring, speculative abstractions, or new dependencies.
2. Commit each changed file individually under the 1 FILE = 1 COMMIT policy.
3. Re-run the reproduction test and nearby unit suites to verify complete resolution.

## 5. Engineering Lesson Persistence
1. For every confirmed defect, design oversight, or external review rejection, formulate a generalizable rule.
2. Append the new lesson to `docs/ENGINEERING_LESSONS.md` in its own commit:
   - Issue / Symptom
   - Root Cause & Detection Gap
   - Generalizable Rule
   - Preventive Test / Quality Gate
   - Relevant Updated Skill / Rule

## 6. Verification & Reporting
1. Report reproduction evidence, exact test execution command, exit code, and pass counts.
2. Verify cancellation, privacy, resource bounds, and status consistency.
3. **Never** suppress errors, increase timeouts arbitrarily, or flip assertions simply to manufacture green test runs.

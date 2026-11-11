---
name: code-review
description: "Reviews AURA DESK diffs for correctness, privacy, session races, architecture, tests and design; reports concrete findings by severity before approvals."
---

# Code Review

## Checklist
1. **Correctness:** What does FR/acceptance demand? Is happy path and negative path handled?
2. **Screen isolation:** Does SINGLE truly stop other display; what happens on hotplug/switch?
3. **Session:** Are event listeners/streams/AbortController cleaned on Stop, Pause and window close? Bounded queue/memory?
4. **Security:** Key in main protected store? IPC validation? File/search/model injection? Markdown sanitized? No leaked logs?
5. **OpenRouter:** Supported model/route? Budget cap, rate limit, cancellation, sources, fallback gating?
6. **Architecture:** Pure core, narrow ports, no overengineering, no `any` at trust boundary.
7. **UI:** DESIGN tokens, keyboard, loading/empty/error states, text legibility, genuine screen/audio indicators.
8. **Tests:** Real execution evidence vs stubs, negative/boundary test coverage; heavy integration manual policy honored.
9. **Git:** each commit one file, meaningful message, no unrelated diff, docs update in separate commits.

## Adversarial Self-Review Audit Questions
Prior to submitting any PR or completing implementation, audit against these adversarial probes:
1. **Placeholders & Dummy Payloads**: Are there any hardcoded buffers, dummy byte arrays (e.g. `Uint8Array(1024)`), stubbed strings, or simulated responses in production paths?
2. **Silent Fallbacks & Insecure Defaults**: Does any source resolver, selector, or config parser silently fall back to an arbitrary default (e.g. first display, index 0, loose substring) when target is missing or malformed? All lookups must fail-closed.
3. **Async Race Conditions & Cancellation**: What happens if `stop()`, `pause()`, or window close fires while an asynchronous operation (capture, IPC roundtrip, provider request) is pending? Does the completed promise write to an already stopped/torn-down state? Are session generations checked before applying results?
4. **Trust Boundary Hardening**: Does renderer or preload code import Node modules or privileged main utilities? Is sender validation fail-closed on every IPC channel? Are untrusted inputs sanitized and Zod-parsed?
5. **State Inconsistency**: Is there any divergence between module internal state, IPC status getters, and UI presentation? Is there a single authoritative source of truth?
6. **Resource Footprint & Performance**: Are background operations requesting unnecessary heavy assets (e.g. non-zero enumeration thumbnails)? Are queues and frame buffers strictly bounded by capacity and TTL?

## Review Evidence Matrix Verification
Every PR review or implementation result must evaluate the Acceptance & Evidence Matrix:
| Criterion | Implementation | Test/Evidence | Status | Residual Risk |
|---|---|---|---|---|
- Explicitly verify that every row marked `PASS` has concrete test evidence (`UNIT TEST PASS`, `INTEGRATION TEST PASS`, `BUILD PASS`).
- Never mark physical Windows OS device operations as passed without live execution evidence; mark them `PHYSICAL WINDOWS TEST — NEEDS MANUAL TEST` or `NOT VERIFIED`.

## Output format
- Findings in severity order: BLOCKER/HIGH/MEDIUM/LOW with `path:line`, risk, minimal suggestion.
- If no findings, explicitly list unverified surfaces and residual risks. Don't certify real screen/audio without physical test.
- Do not make silent fixes during review unless user asked; if asked, one-file commits.

## Independent Review & External AI Policy
- **Strict Codex & Paid AI Ban**: Never post `@codex review`, `@codex security review`, `@codex address that feedback`, or invoke external paid cloud AI review mechanisms autonomously.
- **Standard Review Flow**: Independent review is conducted by ChatGPT in standard conversational chat initiated by the user.
- **No Codex Blocker**: Absence of a GitHub Codex review is never a blocker for PR review or merge authorization.
- **Historical Context**: Past Codex comments can be consulted as historical context, but no new automated AI review triggers may be submitted.

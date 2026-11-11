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

## Output format
- Findings in severity order: BLOCKER/HIGH/MEDIUM/LOW with `path:line`, risk, minimal suggestion.
- If no findings, explicitly list unverified surfaces and residual risks. Don't certify real screen/audio without physical test.
- Do not make silent fixes during review unless user asked; if asked, one-file commits.

## Independent Review & External AI Policy
- **Strict Codex & Paid AI Ban**: Never post `@codex review`, `@codex security review`, `@codex address that feedback`, or invoke external paid cloud AI review mechanisms autonomously.
- **Standard Review Flow**: Independent review is conducted by ChatGPT in standard conversational chat initiated by the user.
- **No Codex Blocker**: Absence of a GitHub Codex review is never a blocker for PR review or merge authorization.
- **Historical Context**: Past Codex comments can be consulted as historical context, but no new automated AI review triggers may be submitted.

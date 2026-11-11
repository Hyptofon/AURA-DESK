# Тестова стратегія і budget-aware test execution

## Goals

Виявляти race conditions у захопленні, контекстні помилки двох екранів, leakage, помилкові auto-questions, UI regressions і недійсні API routes. Без production overengineering, без запуску дорогої інтеграції на кожний коміт.

## Test pyramid

| Layer | Tool | When | Default authority |
|---|---|---|---|
| Pure core/unit | Vitest | changed logic | agent MAY run |
| UI component | RTL/Vitest | changed TSX | agent MAY run |
| Typecheck + ESLint | TS/ESLint | milestone or changed contract | agent MAY run |
| Local contract | Fake ports / mock HTTP/IPC | provider changes | agent MAY run, scoped |
| Electron smoke | Playwright `_electron` | UI/window boundary milestone | user approval before heavy |
| Real Windows 2-screen, audio | manual scripts/commands | M1/M2/M4/M7 gate | user runs; never fake |
| Full E2E, installer, stress | Playwright / 30–60 min | milestone/release | MUST ask first |

## Test style

- Arrange–Act–Assert; test behavioral contracts and edge cases not implementation details.
- Prefer factory fixtures with synthetic screenshots/audio/transcripts, fake clock and deterministic providers; real OS device tests manual.
- Every defect: write a failing regression test first if feasible; then smallest fix.
- Negative paths: invalid displayId; hotplug; duplicate audio; empty mic; Stop during request; model lacks vision; budget exceeded; invalid API key; injected PDF prompt; malformed IPC; missing file; disconnected net.
- `describe` by module, `it` by user-visible behavior; no snapshots for massive arbitrary HTML.
- Tests must verify teardown (`stop` closed tracks, abort, buffers cleared).

## Representative unit test cases (IDs)

| Case | Scenario | Expected |
|---|---|---|
| T-SCR-01 | single display 2 | zero frames from display 1 |
| T-SCR-02 | both displays with timestamps | only 2 allowed streams; sources traceable |
| T-SCR-03 | disconnect selected display | stop capture, prompt reselect; no fallback leak |
| T-SCR-04 | switch both→single | old frames from disabled screen erased |
| T-AUD-01 | mic off, system on | only system transcript; no mic request |
| T-AUD-02 | Stop while VAD active | no more transcript work |
| T-Q-01 | speech question repeated | at most one auto request within cooldown |
| T-Q-02 | rhetorical conversation | low confidence doesn't automatically answer |
| T-CTX-01 | code on D1 + slide D2 | relevant frames labelled correctly |
| T-CTX-02 | 5 min idle | bounded frame/audio RAM |
| T-MDL-01 | text-only model selected for vision | blocked with actionable error |
| T-MDL-02 | 429/timeout/abort | no infinite retry; UI recovers |
| T-SEC-01 | injection in file/screenshot | no key disclosure/tools invoked |
| T-SEC-02 | invalid IPC payload | validated and rejected |
| T-KNW-01 | remove file | chunks + FTS removed |
| T-UI-01 | screen mode radios | exactly one selected |
| T-UI-02 | keyboard overlay | accessible buttons/esc/focus |

## Commands intended AFTER scaffold (not yet available)

Project must implement scripts with these stable names:

```bash
npm run typecheck
npm run lint
npm run test:unit -- --run
npm run test:ui -- --run
npm run test:contracts -- --run
npm run test:e2e # only with approval
npm run package:win # only with approval
```

Do not claim they already run. On every task report exact commands, exit codes, and what was intentionally not run. If a package/script is absent, report `NOT AVAILABLE`, not PASS.

## Manual device checklist (Windows)

1. Two physical monitors attached, different resolutions/scaling if possible; enumeration should show both.
2. Single D1 and Single D2: show a distinctive text on each; confirm no cross-capture.
3. Both: simultaneous updates in each stream, overlay doesn't recursively echo.
4. Disconnect/reconnect monitor during active session; verify graceful stop/reselect.
5. Mic speech then browser/Meet audio through headphones; confirm distinct sources.
6. Pause/Stop while media audio plays: no further callback/transcript/API call.
7. Simulate API network failure, invalid API key, rate limit.
8. 30–60 min session: monitor CPU/RAM, app responsiveness, volume of network requests, real spend.

## Test budget policy

- Changes confined to docs ⇒ no app test needed; static validation enough.
- Pure core ⇒ related unit spec + typecheck if contract touched.
- UI ⇒ affected RTL tests + accessibility checks.
- OS/API integration ⇒ mocked contract tests automatically; real live tests require user's explicit approval (and may incur costs).
- Never quietly run all full integration tests to inflate apparent confidence. Give user a command and risk/time/cost context for manual run when necessary.
- Never disable/rewrite failing tests merely to achieve green.

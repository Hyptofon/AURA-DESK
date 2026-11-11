# MVP Acceptance Criteria — prove it on the actual Windows PC

**Status:** Not tested. Use precise evidence in `docs/PROGRESS.md`.

| ID | Acceptance test | Expected evidence |
|---|---|---|
| A-01 | Start from idle with explicitly selected sources | REC visible, session active, actual streams exist |
| A-02 | Both monitors | two distinct time-stamped screen frames used in one prompt, correct source names |
| A-03 | Single monitor D1 or D2 | no other display frame captured/transmitted, including after switching |
| A-04 | Select absent monitor | capture stops/warns; NEVER silently switches |
| A-05 | Mic and system audio toggles independently | audio arrives only from enabled source, actual headphones/Meet verified |
| A-06 | Unexpected spoken question | candidate recognized, text answer or clear suggestion according to auto policy |
| A-07 | Rhetorical/repeated speech | rate limit, debounce; no spam/repeat OpenRouter costs |
| A-08 | Current code visible in VS Code | answer references observed code only, with uncertainty on missing context |
| A-09 | Add text PDF/DOCX | query uses indexed relevant source chunk, cites filename/section |
| A-10 | Scan-only PDF | explicit unsupported/OCR-needed state, no fictitious extracted text |
| A-11 | Prompt profile switch mid-session | subsequent responses follow new profile and do not override security |
| A-12 | Web-search-enabled request | factual cited web result via verified route; fallback when unavailable |
| A-13 | Invalid key / offline / unsupported model | clear actionable error, no infinite retry |
| A-14 | Stop during active transcription/model stream | media stops, abort called, no further auto request, RAM wiped |
| A-15 | API key and files security | no key in renderer/logs, no prompt injection escapes trust boundary |
| A-16 | Budget hard limit | next paid request blocked, warning shown |
| A-17 | Keyboard navigation / 200% scaling | reachable controls; no clipped Stop, focus clear |
| A-18 | Git discipline | hook rejects two staged files, commit-msg rejects nonconforming message |

## Release gate

**No app is delivered until A-01..A-04, A-05, A-08, A-11, A-13..A-18 pass.** Auto-answer A-06/A-07 and document retrieval A-09..A-10 are required to claim FULL MVP. If only partial implementation is complete, describe it accurately as prototype.

## Proof format

For each criterion: OS, build hash, specific input, exact command/manual steps, observed result, logs with secrets removed, date. No fabricated screenshots or simulated hardware claims.

# Roadmap — AURA DESK

**Rule:** checkboxes show **actual verified progress only**. No features are implemented by this docs-only blueprint. All tasks begin `TODO`. Dependency gates prevent speculative integration.

## Milestone M0 — Scaffold and governance

- [x] **P0.1** Initialize repo with `electron-vite`, React, TS strict, lint/format, app launch. **Acceptance:** `npm run dev` opens empty app on Windows.
- [x] **P0.2** Add AGENTS/rules/skills/documents **one file per commit** and enable Git hooks. **Acceptance:** 2 staged files rejected, 1 accepted.
- [x] **P0.3** Configure unit test stack, `npm run typecheck`, `npm run test:unit`, `npm run lint`. **Acceptance:** baseline green, exact commands documented.
- [x] **P0.4** Add typed preload/IPC and secure BrowserWindow. **Acceptance:** forbidden IPC denied, no Node in renderer.

## Milestone M1 — Real Windows capture spike (critical)

- [x] **P1.1** Enumerate two monitors, stable IDs, resolutions and hotplug notification.
- [x] **P1.2** Capture Single display only; validate no leakage from other physical display (COMPLETED & ACCEPTED: PR #4 verified dual-monitor physical source isolation with 9/9 PASS [Display 1 Cobalt Blue ratio 1.0, Display 2 Crimson Red ratio 1.0; 52635 & 54331 bytes]; verified single-monitor physical capture with 7/7 PASS [laptop display 1238924755 Cobalt Blue ratio 1.0, 56340 bytes]; verified physical reconnection between sessions with 9/9 PASS; verified real live cable disconnect during active session [abrupt transition to error on selectedDisplayLost with zero cross-display fallback and clean recovery to idle on stopSession]; 266 unit tests pass across 14 suites; electron smoke PASS on single and dual display topologies; merged into main).
- [x] **P1.3** Capture two displays simultaneously; timestamps, bounded memory and stop tracks. (COMPLETED: concurrent dual capture coordination via DualDisplayCapturer, synchronized timestamps, hard-bounded dual ring buffers, fail-closed teardown, late-start cancellation & backend stop error propagation; 299 unit tests green across 19 suites; PR #5).
- [x] **P1.4** Verify overlay exclusion / screen recursion, Windows DPI scaling. (COMPLETED: content protection setContentProtection enabled on window/overlay, recursion risk evaluation & display intersection, DPI scaling bounds mapping for 100/125/150% and mixed-DPI negative coordinates; 323 unit tests pass across 21 suites; PR #7).
- [ ] **GATE-1** Demonstrate real Windows 2-monitor capture. (IMPLEMENTED / PENDING CONSOLIDATED HARDWARE GATE: Dual-monitor simultaneous capture & isolation proven; overlay exclusion and DPI-aware bounds mapping implemented; awaiting user-supervised manual verification session).

## Milestone M2 — Audio spike (critical)

- [x] **P2.1** Mic capture and VAD with actual microphone device.
- [x] **P2.2** Windows system loopback capture while listening through headphones.
- [x] **P2.3** Independent mic/system audio toggles, source timestamps.
- [x] **P2.4** `Pause`/`Stop` teardown tests, privacy indication.
- [x] **GATE-2** Choose Electron audio or .NET helper after actual Windows test; document result in ADR/PROGRESS separate commit (COMPLETED & VERIFIED: physical Windows testing confirmed live microphone with dynamic VAD isSpeech response, concurrent MIC+SYSTEM capture, pause buffer freeze with unchanged timestamps, stop zero-retention [0 chunks, 0 bytes], and content-dependent headphone loopback [playing avg RMS 0.067731 vs paused avg RMS 0.000007]; Electron/Chromium chosen as verified audio architecture; ADR-006 finalized).

## Milestone M3 — Transcription and question detection

- [x] **P3.1** STT provider interface with fake adapter, UA/EN fixtures. (COMPLETED & VERIFIED: defined typed SpeechToTextProvider contract, 16kHz mono audio normalization with anti-aliased decimation/resampling, UA/EN speech fixtures, deterministic FakeSttProvider with abort signal handling, and VAD-governed SpeechWindowAssembler; 22 unit tests green).
- [x] **P3.2** Connect local `whisper.cpp` or verified remote route (per ADR). (COMPLETED & VERIFIED: implemented WhisperCppSttProvider with 16-bit PCM RIFF WAV encoding, Windows subprocess tree termination via taskkill, abort cancellation, timeout, ephemeral temp file teardown, and fallback to local Python whisper; 9 unit tests green).
- [ ] **P3.3** Finalized transcript segments + source/time & question candidates.
- [ ] **P3.4** Debounce, confidence, cooldown, dedup, cancel tests.
- [ ] **GATE-3** Demo an unplanned spoken question with a true transcript; log false positives.

## Milestone M4 — OpenRouter + Context

- [ ] **P4.1** Key storage via OS-protected Electron API, test connection without renderer key exposure.
- [ ] **P4.2** Model list, capabilities, validation; text request.
- [ ] **P4.3** Vision input with one real screen image; user-approved model.
- [ ] **P4.4** Context assembler two-screen + transcript; strict frame & token caps.
- [ ] **P4.5** Streaming answer + abort on Stop + budget cap.
- [ ] **GATE-4** End-to-end answered prompt derived from actual two screens+transcript; note errors/latency/cost.

## Milestone M5 — First functional user experience

- [ ] **P5.1** Original UI tokens from `DESIGN.md`.
- [ ] **P5.2** Session console Start/Pause/Stop with visible record state.
- [ ] **P5.3** Radio `both/single` + actual display dropdown; live change allowed.
- [ ] **P5.4** Audio/source settings panel with device level states.
- [ ] **P5.5** Overlay with Markdown, code blocks, hotkey + copy/cancel.
- [ ] **GATE-5** Keyboard and UI smoke test; screenshot review.

## Milestone M6 — Knowledge + Prompt Studio

- [ ] **P6.1** SQLite or approved adapter + schema migration.
- [ ] **P6.2** Ingestion TXT/MD/code; local FTS query/provenance.
- [ ] **P6.3** Ingestion text-PDF and DOCX; scanned PDF explicit failure.
- [ ] **P6.4** Prompt profiles CRUD/import/export with Zod.
- [ ] **P6.5** Context retrieval adds relevant file excerpts with source labels.
- [ ] **GATE-6** Answer using an actual uploaded local document with citation + delete cleanup.

## Milestone M7 — Auto-answer, web and polish

- [ ] **P7.1** User-configurable auto-answer; uncertain candidate CTA; no spam.
- [ ] **P7.2** Verified OpenRouter web-search route, sources & fallback.
- [ ] **P7.3** Usage estimator and spending hard cap.
- [ ] **P7.4** Offline state, permission denied, device disconnection, sleep/resume, duplicate displays.
- [ ] **GATE-7** 30–60 min manual Windows scenario and memory/request budget observation.

## Milestone M8 — Packaging optional

- [ ] **P8.1** Local Windows installer (optional); startup/restart/tray/session-off smoke.
- [ ] **P8.2** Backup/wipe of local config; no cloud sync.

## Release readiness (personal-use)

- [ ] Must acceptance cases in `docs/ACCEPTANCE.md` pass with evidence.
- [ ] Security checklist completed; access states visible; no api key plaintext.
- [ ] No known blocker/high severity issues unaddressed.
- [ ] `docs/PROGRESS.md` accurately summarizes actual result and deferred items.

## Delivery pacing / batching

Each task may require *multiple* small commits. Keep all commits to **one file**. Prefer incremental code with separate test commits, not rewrite everything in one diff. After real tests: `docs/PROGRESS.md` update as its own commit. Heavy E2E/OS tests require user approval; provide commands instead of burning time/credits automatically.

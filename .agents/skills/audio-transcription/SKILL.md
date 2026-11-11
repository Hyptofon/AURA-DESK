---
name: audio-transcription
description: "Builds mic and Windows system-audio capture, optional NAudio helper, VAD, speech transcription, per-source timestamps and complete session teardown."
---

# Audio Capture & Transcription

## Scope
Mic is NOT system audio; teacher audio in headphones may require loopback. Sources have independent toggles and provenance.

## Procedure
1. Read `FR-03`, `ADR-006/007`; test current Electron loopback on target Windows **before** adding .NET helper.
2. Prototype mic only; check device selection, media track stop, permissions, muted states.
3. Prototype browser/meeting system sound in headphones. If Electron loopback unsupported, propose thin .NET 8 + NAudio helper with a documented protocol; no helper by assumption.
4. Implement bounded audio chunk buffers and VAD; preserve source ID + timestamps; do not write raw audio to disk.
5. TranscriberPort with controlled provider `local-whisper` or verified remote supported route; redact and obtain explicit consent for remote STT.
6. Address duplicated speech heard in both inputs with source-aware dedup; do not fabricate perfect diarization.
7. Teardown tracks, worker, pending chunks on Pause/Stop and device change. Add tests for audio off/abort.
8. Manual Windows demonstration with headphones, local mic and meeting audio. Ask before live API or downloading models.

## Results
Show true device status, latency/cpu findings, negative paths, choice for ADR-006/007, and one-file commits.

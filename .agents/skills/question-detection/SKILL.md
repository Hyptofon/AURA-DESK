---
name: question-detection
description: "Detects unexpected spoken questions from finalized transcripts using confidence, cooldown, deduplication and safe opt-in automatic answers."
---

# Question Detection

## Goal
Recognize likely spoken questions without continually spamming LLM or assuming a question targets the user.

## Process
1. Work on finalized transcript segments (with source/time), not unstable partial text alone.
2. Normalize text, reject silence/empty fragments, merge near duplicates, track most recent candidate.
3. Prototype inexpensive heuristics for UA/EN interrogatives; consider small classifier only if offline fixture metrics justify it.
4. Typed result `{text, source, startMs, endMs, confidence, reason}`; `reason` must be safe to log, no secret transcript dump.
5. Apply threshold and cooldown (initial 10–30s configurable) and queue max 1. Keep manual questions higher priority.
6. If uncertain, passive suggestion `Відповісти?`, not automatic paid call. Auto-answer must be explicitly enabled.
7. Stop/Paused kills future question triggers, cancels pending auto task.
8. Test rhetorical Q, duplicated mic/system audio, nested/ambiguous phrase, 2 simultaneous questions, screen change during answer.

## Evidence
Precision/false-positive examples on **consented synthetic** transcript fixtures. Real meeting behavior must be labeled manual, not unit verified.

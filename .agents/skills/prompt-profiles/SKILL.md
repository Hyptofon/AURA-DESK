---
name: prompt-profiles
description: "Implements locally editable prompt profiles, safe instruction hierarchy, import/export validation and reliable profile switching for code explanations and learning."
---

# Prompt Profiles

## Goal
User can customize answer behavior without touching developer code. See `docs/DEFAULT_PROMPT_PROFILES.md`.

## Procedure
1. Define Zod schema for profile ID/name/instructions/language/length/auto/web/source flags/model override. Keep reasonable max length.
2. CRUD/duplicate/import/export JSON locally, with error messages; store change timestamp and avoid silent data loss.
3. Provide seeds: Code Mentor, Lecture Helper, Quick Answer, Deep Analysis, Bug Triage.
4. Compose immutable app privacy/safety rules before editable profile and then untrusted screen/transcript/file/web context. Never treat imported content as a developer instruction.
5. Switching profiles during active session affects future requests only; current streaming request retains its snapshot.
6. In `Code Mentor`, explain algorithm, rationale, alternatives and test steps; do NOT promise hidden raw model chain-of-thought.
7. UI form follows DESIGN.md and keyboard accessibility. Test modified/duplicate/import-invalid states.

## Done
Save/reload profile test, switch-in-session test, prompt injection separation test, one-file commits per component/schema/test.

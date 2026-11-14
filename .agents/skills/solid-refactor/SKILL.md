---
name: solid-refactor
description: "Apply to every AURA DESK implementation, modification, and refactor. Enforce single-responsibility modules, clear Electron boundaries, SOLID/KISS/DRY/YAGNI, isolated prompts and model registries, regression safety, and exactly one changed file per commit."
---

# Clean Architecture & SOLID Refactoring — AURA DESK

## When to use

Use for **all code-writing tasks**, not only explicit refactor requests or `/solid-refactor`. Follow `AGENTS.md`, project contracts, privacy invariants, and repository Git rules first. Produce clean code; do not substitute design lectures for implementation.

A refactor preserves **observable behavior**. If a task requires behavior changes, distinguish the feature from refactor work, identify the changed acceptance criteria, and avoid presenting new behavior as behavior-preserving.

## Non-negotiable design rules

1. **Single Responsibility (highest priority):** each module/file has one cohesive responsibility and one primary reason to change. Keep related small helpers together; do **not** enforce one function per file or split files solely to reduce line count. Split when responsibilities evolve for different reasons (prompt wording vs supported models vs HTTP transport vs classification decisions).
2. **SOLID pragmatically:** prefer small contracts, substitutable adapters, dependency direction toward contracts, and extension at boundaries. Do not add interfaces, factories, inheritance, service containers, or adapters without a concrete consumer or change pressure.
3. **KISS/YAGNI:** favor straightforward TypeScript, pure functions where useful, and the fewest necessary layers. No speculative plugin framework or premature generalization.
4. **DRY:** centralize real business rules and validated contracts, not coincidentally similar lines. Never duplicate model IDs, thresholds, prompt text, or request policy across production paths.
5. **Cohesion and naming:** use domain-specific file names and feature folders. Avoid `misc.ts`, `helpers.ts`, `utils.ts`, `common.ts`, and all-purpose `*Service` bags unless an existing cohesive contract justifies one.
6. **Keep boundaries honest:** `src/main` owns privileged Electron/OS access, secrets, OpenRouter/network calls and lifecycle orchestration; `src/preload` is the minimal validated bridge; `src/renderer` owns UI/presentation; `src/shared` contains runtime-independent contracts/validation. Never leak Electron/Node or credentials into renderer.
7. **Dependency safety:** dependencies flow through explicit inputs or small ports where useful; keep imports acyclic. Prefer importing from the owning feature rather than duplicating logic or building generic abstraction layers.
8. **Maintainability:** keep public APIs stable, use TypeScript strict types, handle failure and cancellation explicitly, and keep resource cleanup with the component that owns the resource. A small file is not automatically a good file.

## Module placement decision

Before making files or folders:
- Identify the single changing concern, its callers, and its lifecycle owner.
- Put code near the feature that owns it, not in a global directory for convenience.
- If a feature has several independent concerns, use a clear local feature directory (e.g. `transcription/intent-classifier/`), but avoid deep directories with only one trivial file each.
- Keep orchestration thin: it selects dependencies, sequences operations, and returns results; it should not also maintain prompt copy, model catalogs, HTTP transport, parsing policy, and UI state.
- Preserve existing import paths via a compatible facade/re-export when needed; migrate callers in their own commits.
- Do not reorganize unrelated packages while completing a targeted task.

## Mandatory OpenRouter intent-classifier guidance

Inspect the actual local `src/main/transcription/openrouter-intent-classifier.ts` and its callers before deciding the final layout. Treat these as **candidate responsibilities**, not a demand to create empty boilerplate:

- **Prompt definitions**: move `SYSTEM_PROMPT` and other independently maintained prompt templates to a clearly named feature-local module such as `intent-classifier-prompts.ts`. Keep original wording, interpolation, escaping, message order, and prompt semantics unchanged during refactoring.
- **Model registry**: move `SUPPORTED_CLASSIFIER_MODELS` and model metadata to a feature-local `intent-classifier-models.ts`. Make candidate registration easy to extend and validate without editing classification orchestration. Preserve existing model IDs, order, allowed/default selection, settings compatibility, and fallback behavior.
- **Provider transport**: separate HTTP request formation, timeout/abort/retry, error handling and response parsing from decision logic **only where the current code mixes those responsibilities**. Avoid a new transport layer if an existing adapter already owns it.
- **Classification policy**: keep thresholds, interpretation, normalization and result contracts separate from prompt/model metadata when they change for different reasons. Maintain identical public input/output shape, failure mapping, logging and cancellation behavior.
- **Evaluation/benchmarks**: keep experiment fixtures, candidate lists, scoring, latency statistics and test runners separate from production configuration. Adding an experimental model must **not** silently switch the production default or send user data anywhere.
- Live paid/API evaluations require explicit user authorization and a clear budget. Run offline, deterministic fixtures automatically; do not transmit real transcripts, captured screens, API keys, or private user content in benchmarks.

Do not invent model identifiers, assume remote endpoints work, or treat a model's presence in a registry as proof of capability. If this file does not exist in the current branch, locate the actual implementation before applying these patterns.

## Behavior-preserving refactor workflow

1. **Inspect first:** read `AGENTS.md`, relevant `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/PROGRESS.md`, nearest files/tests, and `git status --short`. Do not overwrite an existing dirty worktree or unrelated changes.
2. **Identify pain:** name concrete reasons for change (mixed ownership, prompt embedded in orchestration, hard-coded model catalog, circular import, unsafe process boundary, impossible tests). Skip cosmetic abstraction.
3. **Characterize behavior:** trace exported functions, call sites, IPC/persistence contracts and UA/EN scenarios. Record initial tests and defaults. Add focused characterization tests in independent one-file commits when missing.
4. **Plan responsibilities:** show a short before/after file map, each file's ownership, API compatibility strategy, minimal file-by-file sequence and likely regression risks. No sprawling rewrite.
5. **Implement incrementally:** extract definitions, adjust imports and introduce compatibility facades in separate commits. Prefer small complete slices. Intermediate feature-branch commits may be transitional; the final PR must compile and pass relevant checks before merge.
6. **Preserve invariants:** current prompts, model choices/defaults, settings, IPC, capture consent, Pause/Stop semantics, abort, timeout, error/fallback paths, security, user-visible behavior and performance characteristics unless the task explicitly approves change.
7. **Review each diff:** reject unrelated renames, duplicate logic, unnecessary wrappers, changed defaults, unused exports, import cycles, accidentally exposed secrets, and dead code. Never weaken types or remove a negative-path check to make tests pass.
8. **Verify:** run cheap scoped unit tests first; run `npm run typecheck` and appropriate lint/other affordable checks when feasible. Expensive OS hardware, Electron E2E, live OpenRouter, large integration suites or paid external evaluation require user approval; give exact reproducible commands and mark NOT RUN.
9. **Report honestly:** summarize responsibility split, exact files/one-file commit SHAs, test commands/results, unchanged behavior evidenced vs unverified areas, and PR status. Do not claim a live Windows or API test was run without evidence.

## One file = one commit (mandatory)

- Start from updated `main` on a **dedicated feature branch**, in accordance with `docs/DEVELOPMENT_WORKFLOW.md`. Never push directly to `main`.
- **Exactly one changed path in each commit**, including tests, docs, configuration, and moves. Stage only that path; confirm using `git diff --cached --name-only` and `git diff --cached --check`.
- Use Conventional Commits: `refactor(scope): ...`, `test(scope): ...`, `docs(scope): ...`, etc. Never use `git add .`, `--no-verify`, or broad multi-file commits.
- Commit the extracted file, integration changes, tests, and documentation **individually**. Preserve a clean, tested final branch state; never merge partially migrated code.
- Do not autonomously invoke Codex/paid review. Respect the repository's PR, review and merge authorization rules.

## Comments and technical documentation

Write self-explanatory names and code first. Add comments/JSDoc **only** for non-obvious behavior, invariants, contract semantics, OS quirks, security boundaries, compatibility or tricky algorithms. Do not insert meta-comments like "SRP", "SOLID", "clean code", "single responsibility", "this file has one job", or commentary about the refactoring process into source code. Avoid redundant line-by-line explanations. Architectural rationale belongs in a concise PR description or an approved design/ADR document, not in production comments.

## Definition of done

A task is done only if each changed file has a clear owner, actual behavior changes are distinguished from refactors, production defaults and privacy are preserved, no unnecessary layer is introduced, targeted checks have credible results, each commit touches one path, and the final branch/PR state is reported accurately. Stop and flag any requirement that conflicts with observable behavior or product/security constraints.

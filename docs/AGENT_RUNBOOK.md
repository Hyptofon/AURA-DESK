# Agent workflow / how to use skills in Antigravity

Antigravity docs: `AGENTS.md` is an always-active rule; `.agents/rules/*.md` require YAML trigger; `.agents/skills/<name>/SKILL.md` have name/description frontmatter and load when relevant. Keep the always-on layer short, heavy workflows in skills.

## Execution cycle

1. `git status --short` and inspect README, roadmap, progress and target code; verify no uncommitted user changes are clobbered.
2. Choose one roadmap task ID; confirm dependencies/gates.
3. Plan narrowly: objective, touched files, acceptance, tests, risks, estimated paid API calls; identify which skills are useful.
4. If hardware or API capability uncertain, do a **spike** and do not build a large feature against assumptions.
5. Implement a small self-contained file change and review diff; one file = one commit. Repeat as necessary.
6. Run scoped cheap tests, no fictitious results; stop at user approval gate for heavy tests/live hardware.
7. Review severity; fix blockers in new single-file commits.
8. Update roadmap + progress individually in separate one-file commits after real evidence.
9. Report changed paths + commit SHAs + exact tested/not tested evidence + next task.

## Skill menu (discovery descriptions and explicit invocation)

| Skill | When |
|---|---|
| `project-kickoff` | new empty repository/bootstrap |
| `task-planning` | break milestone into atomic steps |
| `feature-implementation` | build any scoped feature |
| `architecture-design` | cross-module contracts and ADR |
| `screen-capture` | physical display enumeration and both/single selection |
| `audio-transcription` | mic/system loopback, VAD/STT |
| `question-detection` | detect spoken unexpected questions |
| `openrouter-provider` | model list, capabilities, vision/text/tools |
| `document-context` | ingestion, retrieval, provenance |
| `prompt-profiles` | editable user prompts |
| `frontend-design` | UI/UX layouts, tokens, accessibility |
| `testing-strategy` | write/execute scoped tests |
| `bug-investigation` | reproduce and fix defect |
| `code-review` | code audit and issue severity |
| `solid-refactor` | clean architecture without behavior change |
| `atomic-git-commits` | every single-file change and commit |
| `roadmap-manager` | truthful progress updates |
| `security-audit` | permission and leak checks |

Slash invocation where supported: `/screen-capture`, `/code-review` etc. For some IDE surfaces, mention skill by name in the prompt if slash invocation is not exposed.

## Prompt discipline

- Do not dump all skill bodies into every request. Relevant skill is enough.
- Do not ask model to "do the entire project in one run". Use M0/P0.1 then review quality; proceed by gates.
- Do not produce 15 files and call it 1 commit. Force per-path Git commit.
- Avoid speculative modifications outside current task even if they look helpful.
- On unexpected blocker, diagnose and present options or create a small verified workaround within permission boundaries.

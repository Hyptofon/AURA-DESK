---
name: local-first-mvp
description: "Lightweight personal-use implementation workflow: complete submodules, 1-file commits, focused tests, authorized PR merges, and consolidated hardware verification."
---

# Local-First MVP Implementation Workflow

## Purpose
Establishes an agile, pragmatic engineering cadence for personal-use AURA DESK. Eliminates enterprise overhead, repetitive audits, and artificial checkpoints while upholding essential privacy and functional correctness.

## Core Rules
1. **Pragmatic Engineering**: Follow KISS, YAGNI, and pragmatic SOLID. Prefer native Electron and web standard APIs over external dependencies. Build full working submodules rather than tiny fragments.
2. **Strict Git Discipline**: Exactly ONE changed path in Git index per commit. Conventional commit messages. Never squash away history or force-push.
3. **Dedicated Feature Branches**: Every submodule gets its own branch (`feat/p1-4-...`, `feat/p2-1-...`).
4. **Authorized Autonomous PR Merge**: For tasks within user-authorized scope (e.g. P1.4, P2.1–P2.4), once code-level checks (typecheck, lint, unit tests, build, smoke) pass and internal self-review confirms no privacy/functional defect, create standard GitHub merge commit via PR and advance autonomously to the next submodule.
5. **Focused Verification**: Run targeted unit and contract tests during development. Run full test suite and production build once at milestone completion.
6. **Consolidated Hardware Verification**: Group physical hardware validations (mic, loopback, monitors) into one consolidated session per milestone rather than interrupting after every single commit.
7. **Honest Evidence**: Distinguish `IMPLEMENTED / PENDING HARDWARE GATE` from fully verified hardware reality. Never claim synthetic or mock tests represent physical Windows reality.
8. **Minimal Documentation**: Update `docs/ROADMAP.md` and `docs/PROGRESS.md` in separate 1-file commits at milestone milestones without repetitive prose.

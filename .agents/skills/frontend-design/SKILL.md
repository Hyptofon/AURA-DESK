---
name: frontend-design
description: "Designs and implements AURA DESK desktop UI using original DESIGN.md tokens, shadcn primitives, compact overlays, accessible states and visual screenshot review."
---

# Frontend Design

## Inputs
`DESIGN.md` and `docs/UI_SCREENS.md` are source-of-truth; actual product states and terminology from PRD.

## Two passes
1. **Design brief:** summarize user action, state model, layout, palette, typography, signature SignalRail and compact answer overlay.
2. **Critique:** reject generic rounded SaaS cards, gradients/glow, decorative counters, fake AI waveform, cramped 12px body copy.
3. **Implement:** establish semantic CSS vars then one primitive / one screen at a time; use shadcn UI only where helpful, no `add --all` unless justified.
4. **Verify:** keyboard focus, aria labels, contrast of color pairs, reduced-motion, 900×600 main app and 360px overlay, 200% Windows scale.
5. **Render review:** only claim visual fidelity after actual screenshot/GUI validation. If screenshot tooling unavailable ask user to provide screenshot in manual gate.
6. **States:** default/active/paused/error/disconnected/loading/offline + clear UX copy.
7. **Source indicators:** show real capture and cloud request state; never fake working audio indicators.

## Screens
Session Console, Display & Audio Controls, Prompt Studio, Knowledge Library, Model Settings, Overlay, Privacy/History.

## Output
Specific design decision, 1-file commits, scoped RTL checks, visual review notes and corrected issues.

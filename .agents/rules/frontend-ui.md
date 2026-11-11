---
trigger: glob
description: UI coding standards for React and TSX files, including AURA DESK design system and accessibility.
globs: "**/*.tsx, **/*.css"
---

# Frontend rules

- Read `DESIGN.md`, `docs/UI_SCREENS.md` before UI changes.
- Reuse local shadcn primitives; semantic design variables, not arbitrary colors; keyboard navigation and focused states.
- Distinguish Record status from audio mute; controls actionable, actual status not simulated.
- Don't use giant rounded cards, decorative AI gradient/glows, fake waveform or marketing language.
- UI doesn't own OS capture or OpenRouter key. Use narrow preload typed API and cleanup subscriptions.
- Test empty/error/loading/offline/session states; responsive overlay with system scaling and reduced motion.

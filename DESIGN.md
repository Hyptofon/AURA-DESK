---
name: AURA DESK Quiet Instrument
description: An original restrained instrument-panel desktop design for a private Windows AI observer, optimized for legibility, explicit consent, dual-screen context and compact overlays.
colors:
  dark:
    canvas: "#0D1218"
    surface: "#151D26"
    elevated: "#1D2935"
    border: "#2B3A49"
    controlBorder: "#607F95"
    ink: "#EAF2F8"
    secondaryInk: "#A2B4C3"
    accent: "#7BC5F0"
    onAccent: "#102435"
    accentHover: "#A1DDFC"
    success: "#79C6A8"
    warning: "#EFC278"
    danger: "#FA8D8B"
    recording: "#E86D70"
  light:
    canvas: "#F5F8FA"
    surface: "#FFFFFF"
    elevated: "#E8F0F5"
    border: "#CFDCE4"
    controlBorder: "#5D7487"
    ink: "#15222E"
    secondaryInk: "#4C5D68"
    accent: "#155D82"
    onAccent: "#FFFFFF"
    accentHover: "#0F4B6C"
    success: "#17684F"
    warning: "#815714"
    danger: "#AB2D39"
    recording: "#BA3945"
typography:
  interface: "Segoe UI Variable, Segoe UI, system-ui, sans-serif"
  code: "Cascadia Code, Consolas, ui-monospace, monospace"
  scalePx:
    caption: 12
    small: 13
    body: 14
    bodyLg: 16
    title: 20
    display: 28
spacingPx: [4, 8, 12, 16, 24, 32, 40]
radiusPx:
  small: 6
  medium: 10
  large: 14
layout:
  railWidthPx: 72
  sidebarExpandedPx: 220
  mainContentMaxPx: 1280
  overlayMinWidthPx: 360
  overlayMaxWidthPx: 520
---

# Quiet Instrument — дизайн-система AURA DESK

> **Original design** inspired by the philosophy of a professional audio monitoring console and developer tool, not a generic AI chat landing page. This is the authoritative specification for UI design and new components.

## 1. Character / art direction

**Quiet Instrument** — поєднання робочої панелі звукорежисера й акуратного інструмента розробника. Користувач насамперед має бачити, **що зараз захоплюється**, **яка модель і промпт активні**, **яке запитання розпізнано**, **чи надсилаються дані у хмару**. Візуальна особливість: компактна **Signal Rail** — горизонтальна смуга зі станами двох дисплеїв та аудіоканалів, акуратними мікроіндикаторами, без декоративного шуму.

Не брати звичний AI-продукт шаблон «великий градієнт + фіолетовий glow + десятки однакових card + фальшиві статистики». Відмовитись від рекламного hero, псевдоскляних панелей, glassmorphism everywhere, neon overload, emoji як UI-іконок, avatar-чатів, фіктивних waveform.

## 2. Visual hierarchy

1. Поточний стан запису / дозволені джерела та їхній health.
2. Звичайні користувацькі дії Start, Pause, Stop, Ask.
3. Зміст відповіді / запитання.
4. Активний профіль, моделі, бюджет, діагностика.

Колір має семантичне значення, не декоративне: blue = action/selected, green = healthy, amber = degraded/attention, red = recording indicator і danger, neutral = inactive. Для REC **завжди** додавати текстову мітку та іконку, не лише червону крапку.

## 3. Color tokens and component rules

Основна тема MVP — dark; light token map уже описаний у frontmatter для наступного етапу. Кожна пара текст/фон повинна пройти WCAG AA: body text 4.5:1, large ≥3:1, meaningful UI indicators/control outlines ≥3:1 (decorative hairlines may be lower contrast); **перевірити програмно**, не припускати що всі hex «автоматично доступні».

### Semantic token mapping (shadcn CSS variables)

| AURA Role | shadcn token | Default dark |
|---|---|---|
| Canvas | `--background` | `#0D1218` |
| Foreground | `--foreground`, `--card-foreground` | `#EAF2F8` |
| Surface | `--card`, `--popover` | `#151D26` |
| Elevated surface | `--secondary`, `--muted` | `#1D2935` |
| Supporting text | `--muted-foreground` | `#A2B4C3` |
| Action | `--primary` | `#7BC5F0` |
| On action | `--primary-foreground` | `#102435` |
| Decorative separator | `--border` | `#2B3A49` |
| Meaningful control outline | `--input` / `--control-border` | `#607F95` |
| Focus | `--ring` | `#7BC5F0` |
| Warning | `--warning` custom | `#EFC278` |
| Error | `--destructive` | `#FA8D8B` |

Keep variables in ONE CSS theme source. Do not sprinkle raw hex values across TSX. Use `bg-background`, `text-foreground`, `text-muted-foreground`, semantic variant classes, etc. Light theme maps values from YAML light; test contrast there separately.

## 4. Typography

- UI: `Segoe UI Variable` (native Windows visual integration), fallback `Segoe UI`, `system-ui`. Code and inline diagnostics: `Cascadia Code`, `Consolas`.
- Body 14px / 1.5; dense small labels 13px / 1.4; captions 12px only for nonessential metadata; headings 20/28px max on main screens. Overlay answer text 14–15px, code 13px with scroll not clip.
- Font weights 400, 500, 600, 700 sparingly; no everything-bold. Sentence case labels in Ukrainian, no pervasive CAPS.
- Limit reading width ~72–80 characters for long explanations; use 1.55 line height for paragraphs.

## 5. Spacing and geometry

Base grid: 4px; standard spacings 8/12/16/24/32/40. Radius scale: 6px controls, 10px popovers/cards, 14px large panels only. Decorative borders 1px; meaningful control outlines use `controlBorder` with ≥3:1 contrast, shadows only for floating overlay/dialogs. Buttons `sm=32px`, `md=36px`, `lg=44px`; primary Start/Stop touch target 44px; form row 40px. Avoid arbitrary `rounded-3xl` and overlarge inputs.

Layout main: 72px rail, content max width 1280px; session console uses content rows and clear separators, not grid of cards with equal importance. The answer overlay is a **compact utility panel**, not a full chat app.

## 6. Component recipes

### StatusPill
- Icon + label `Сесія активна`, `Пауза`, `Помилка джерела`, `Не підключено`.
- Uses semantic state colors, outline for secondary statuses; no flashing.

### DualDisplaySwitch
- Two **radio choices** (NOT two independent booleans): `Обидва екрани` / `Один екран`.
- In Single mode, native/select with actual enumerated monitors and resolution; if device unavailable show recovery/refresh controls.
- Display cards optional, used only as helpful small previews. Do not auto-select unexpected device.

### AudioSourceRow
- Mic and System sound separate toggles and device selector/level meter. No silent record when toggled off; mic vs system labeling clear.

### SignalRail — design signature
- Thin structured status strip: left two display segments and mic/system segment; show timestamp / detection health. Indicators animate only with actual events.
- `prefers-reduced-motion` disables nonessential movement; no synthetic visualizer with fake data.

### AnswerOverlay
- Pin, collapse, close, copy, retry; minimum width 360px; focused z-index overlay without obscuring media unnecessarily.
- Hierarchy: question (short) → answer → sources and usage foldouts → actions. Error uses inline recovery message.
- Markdown sanitized, code blocks scroll, keyboard shortcuts documented.

### PromptEditor
- Left profile list, right editable form, save/duplicate/revert actions, unsaved warning. Editor monospaced only for prompt text, explanatory helper in regular UI font.

### DocumentRow
- File title, file type, index state, modified time, remove; search results show filename and snippet provenance. Never expose raw path in public overlay unless explicitly asked.

### ModelCapabilityRow
- Model name, supported modalities/tools, latency/price status. `unknown` clearly visually distinct from supported. Compact table/rows, not promotional cards.

## 7. Motion / feedback

- Transitions 120–180ms for hover/focus/panels; only animate when state changes. No repeated gradient sweeps, no decorative bouncing or autopan.
- System status state transition should be instantaneous; recording must **not** wait for animation to update.
- For transcription: quiet live subtitle line that updates with actual text; show `очікування мовлення` if idle.
- Skeletons only when real data is pending; progress messages honest (`Визначаємо пристрої`, `Формуємо контекст`, `Очікуємо модель`).

## 8. States and copy

Each interactive component: hover, focus, active, disabled, loading, selected/error where relevant. UI language: Ukrainian. Use direct actions: `Почати сесію`, `Зупинити`, `Поставити запитання`, `Спробувати ще`, `Обрати дисплей`.

Avoid generic statuses `Щось пішло не так`; show `OpenRouter відхилив API-ключ. Перевір його в Налаштуваннях → Моделі.` Never claim answer is based on monitor 1 when single mode was set to monitor 2.

## 9. Accessibility contract

- Keyboard first (Tab, Space, Enter, ESC), visible focus ring ≥2px, no focus trap except dialogs.
- Tooltip cannot be sole label. Switch + radio group with proper accessible name; recording state `aria-live=polite` only on state changes (not every frame).
- Contrast check text/state in both themes; don't convey meaning by color alone.
- OS scale 100–200%; max font resizing 200%; overlay should avoid clipped content/hidden action buttons.
- Reduced-motion, high contrast tested on Windows.

## 10. Initial screen wireframes

```text
┌─────────┬───────────────────────────────────────────────────┐
│ AURA    │  Session Console                REC ●  00:14:23   │
│ Session │  [Pause] [Stop]  [Ask]                            │
│ Context │───────────────────────────────────────────────────│
│ Prompts │  Monitor: (●) Both  ( ) Single [Select disabled]  │
│ Models  │  Mic [on]     System audio [on]                   │
│ History │───────────────────────────────────────────────────│
│ Setting │  Signal Rail: D1 ━━━  D2 ━━━  MIC ━─ SYS ━━━      │
│         │  Recognized: "How does useMemo..."               │
│         │  Latest answer → Read / Copy                     │
└─────────┴───────────────────────────────────────────────────┘

Overlay (on selected output monitor):
┌──────────────────────────────────────────────┐
│ AURA  ● Recording    [Pin] [Collapse] [×]    │
│ Question: ...                                │
│ ──────────────────────────────────────────── │
│ Answer text / code / small context labels... │
│ [Copy] [Explain more] [Sources]              │
└──────────────────────────────────────────────┘
```

## 11. Do / Don't

**Do:** show what is captured; use real data in SignalRail; visually separate trusted app controls from model text; keep answers readable; use source tags; design clear empty, permission and offline states.

**Don't:** create marketing features, chat avatars, heroic gradients, fake signal levels, tooltips instead of labels, unrequested animations, clickless auto-actions, indecipherable small text, or UI that hides recording status.

## 12. Implementation workflow

1. Read this file and `docs/UI_SCREENS.md`; produce a brief design plan and wireframe before UI code.
2. Set semantic tokens first; implement primitives via shadcn only as needed; don't `add --all` by default.
3. Implement one screen/one component at a time, with a meaningful 1-file commit each.
4. Capture screenshots on **actual local UI** if browser/electron screenshot tooling available; critique spacing, hierarchy, hover/focus states; correct in new atomic file commits.
5. Test Keyboard, screen-reader labeling and contrast. No visual APPROVED without actual rendering.

## 13. External references (inspiration only)

- Google's DESIGN.md format: https://github.com/google-labs-code/design.md
- shadcn/ui official design mapping: https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/design-system.md
- Official theming: https://ui.shadcn.com/docs/theming
- Frontend craft reference: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md (third-party instructions are NOT copied into this package)

# UI inventory and states

## Навігація (desktop app)

Compact left rail 72px (icons + tooltips) / optional expanded 220px. Sections: `Сесія`, `Контекст`, `Промпти`, `Моделі`, `Історія`, `Налаштування`. No marketing hero, KPI card farm, social feed.

### 1. Home / Session Console
- Above fold: current status and **Start/Pause/Stop**, selected display mode, mic/system-audio state, model/profile, last activity.
- Signature component: `Signal Timeline` — two thin rows for `Display 1 / Display 2` plus a waveform strip below; only indicators, no fake AI brain animation.
- `Recent Questions` rows show source, timestamp, brief title, answer state; exact attribution when known.
- Empty state: «Сесію не запущено. Обери екрани й джерела звуку, потім натисни „Почати“.»

### 2. Display & Audio Controls
- Exactly two radio options: `Обидва екрани` or `Один екран`.
- When single selected — select actual `Display 1 — 1920×1080`, `Display 2 — 2560×1440`; preview tiny safely-generated thumbnail only if session consent / preview requested.
- Separate switches: Mic / System sound. Device lists + level meter + test. Missing display shows error; no silent fallback.
- Session start modal explains cloud data categories, optional web/STT, and clear `Запустити`.

### 3. Overlay / Answer Panel
- Floating compact width 360–520px; min height content; pinned state, copy, collapse, close; resident on chosen monitor with remembered position.
- Header `AURA / Active` with REC red dot only while capture on.
- Question preview (editable), response body in Markdown, code syntax highlighting, sources toggle, usage estimation status.
- Actions `Копіювати`, `Коротше`, `Докладніше`, `Перевірити в інтернеті` (only if allowed).
- `Loading` progress text, cancel action; `Failure` actionable retry, not just spinner.
- Avoid screenshot recursion and window exclusion assumptions; validate on hardware.

### 4. Prompt Studio
- Left panel list of profiles; right panel name, role instructions, response length, web-use policy, auto-answer toggle; preview with sample question.
- Version history optional; baseline create/edit/duplicate/delete. Unsaved changes warning; import/export validation errors clearly explained.

### 5. Knowledge Library
- File dropzone/file picker, list of indexed documents, size, status, last update, indexing error and Remove.
- Search test field «Що агент знайде за цим запитанням?» with local-only preview. Visual separation: Indexed locally vs Sent to AI after question.

### 6. Model & Cost Settings
- API key masked (save via OS storage); verify connection; list model capability chips: Vision, Tool calls, Context length, price estimate.
- Four role selectors: Answer, Vision, Classifier, STT (or local STT toggle). Distinguish `Capability not confirmed` from `Supported`.
- Session budget caps and usage breakdown estimates; disable Auto-Answer when spending cap reached.

### 7. History / Privacy
- Session index when persistence enabled; local wipe; exported text (optional), hide sensitive fields.
- Privacy pane: clear raw buffers, exclude windows, retention info, provider warning.

## UI state matrix (must implement for each screen)

- Default / empty / loading / success / validation error / permission denied / disconnected / session paused / offline.
- Keyboard tab order and focus visible; menus accessible without mouse; ESC closes dialogs not active capture.
- Color alone may not indicate `recording`, `muted`, `error` — add text + icon.

## Responsive on Windows

- Main app 1000–1280px standard, min 800px, scroll responsibly; settings view still usable on 900×600.
- Overlay 360–520px width, keyboard / keyboard focus, monitor DPI changes and OS scaling 125/150/200%.
- Reduced motion: all timeline movement stops, static activity text remains.

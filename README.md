# AURA DESK — Windows Personal AI Agent

> **Статус:** документація та правила для старту розробки; це **не готовий застосунок**.
> **Призначення:** персональний асистент для Windows, який під час явно активованої сесії спостерігає за дозволеними екранами й аудіо, розуміє запитання, користується файлами/вебпошуком і відповідає **текстом**.

## Почни тут

1. Прочитай `docs/PRODUCT_SPEC.md` — чіткі функції, сценарії, критерії приймання.
2. Прочитай `docs/ARCHITECTURE.md` — системні межі, потоки, типи, технічні рішення.
3. Прочитай `DESIGN.md` — оригінальна дизайн-система Quiet Instrument.
4. Прочитай `docs/ROADMAP.md` + `docs/PROGRESS.md` — етапи й правдива поточна готовність.
5. `AGENTS.md` діє постійно. `.agents/rules/*.md` задають додаткові обов'язкові інваріанти.
6. `.agents/skills/*/SKILL.md` — окремі процедури; застосовуй до відповідного завдання.
7. Для старту в Google Antigravity встав `prompts/START_HERE.md`.

## Що є в архіві

- Повне ТЗ і межі MVP: `docs/PRODUCT_SPEC.md`.
- Архітектура, контракти, безпека, дані: `docs/ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md`.
- Дизайн, компонентні вимоги, UX-сценарії: `DESIGN.md`, `docs/UI_SCREENS.md`.
- Плани й критерії тестів: `docs/ROADMAP.md`, `docs/TEST_STRATEGY.md`, `docs/ACCEPTANCE.md`, `docs/PROGRESS.md`.
- Критерії якості та ADR: `docs/ENGINEERING_STANDARDS.md`, `docs/DECISIONS.md`.
- Бібліотека промптів: `docs/DEFAULT_PROMPT_PROFILES.md`.
- Процедури для Antigravity: `.agents/skills/`.
- Жорсткий git-hook та інсталяція: `.githooks/pre-commit`, `.githooks/commit-msg`, `scripts/setup-git-hooks.ps1`.

## Дуже важливе правило Git

**Рівно один змінений шлях у кожному коміті. Без винятків.**
- Новий файл коду + новий тест = **два коміти**, у зручному порядку; перевірки узгоджуй відповідно.
- Зміна коду + оновлення roadmap = **два окремі коміти**.
- Початкове заповнення репозиторію також відбувається **одним файлом за коміт**.
- Хуки встановлюються локально `powershell -ExecutionPolicy Bypass -File scripts/setup-git-hooks.ps1` з Git Bash/Git for Windows доступним у PATH.
- Гіт-хуки не можна вважати криптографічним захистом — `--no-verify` їх обходить. Агента зобов'язано **не обходити** політику.

## Налаштування, які зафіксовані в цьому ТЗ

- **Windows 10/11**, одна людина, одна локальна машина, без бекенду чи акаунтів у застосунку.
- **OpenRouter** — основний провайдер моделей; вибір конкретних моделей у налаштуваннях, з capability check.
- **Два режими екрана:** обидва монітори або лише вибраний один із них. Немає розумного третього режиму.
- **Постійне локальне спостереження тільки під час активної сесії**; аудіо мікрофона й (за ввімкненням) системний звук.
- **Текстові відповіді** в overlay; синтез голосу не входить до MVP.
- **Власні профілі промптів**, довільна деталізація та використання локальних файлів.
- **Детекція неочікуваних запитань** + явне ручне «Запитати агента».
- **Локальна пам'ять** і контроль того, які дані надсилаються назовні.

## Сумісність Antigravity

Згідно з офіційною документацією, workspace skills читаються з `.agents/skills/<skill>/SKILL.md` із YAML `name` / `description`. Профіль `AGENTS.md` — постійне правило; файли `.agents/rules/*.md` повинні мати `trigger`. Це **не** `@document` чи інший внутрішній формат.

## Технологічний напрям

Electron + electron-vite + React + TypeScript (strict) + Tailwind CSS + shadcn/ui (як локальні вихідні компоненти) + Lucide + Zod + SQLite/FTS5 + Vitest/RTL + Playwright Electron. Модуль для системного звуку — Electron loopback за перевіреної підтримки, інакше компактний Windows .NET/NAudio helper. **Не брати** мікросервіси, Kubernetes, хмарну БД або окремий API-сервер для MVP.

## Що архів навмисно НЕ містить

Реального Electron-коду, двійкових застосунків, ключів OpenRouter, скриншотів комп'ютера або готової до встановлення `.exe`. Це blueprint для coding-агента. Спочатку пройти технічні спайки з roadmap, потім реалізовувати функції. Не заявляти, що Windows audio/video capability працює, доки не перевірено на реальній машині.

## Досліджені першоджерела

- Antigravity skills: https://antigravity.google/docs/skills/
- Antigravity rules: https://antigravity.google/docs/rules/
- Google DESIGN.md: https://github.com/google-labs-code/design.md
- shadcn/ui theming: https://ui.shadcn.com/docs/theming
- Electron screen: https://www.electronjs.org/docs/latest/api/screen
- Electron desktop capture: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- OpenRouter API reference: https://openrouter.ai/docs/api_reference/overview
- OpenRouter image understanding: https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
- OpenRouter web search: https://openrouter.ai/docs/guides/features/plugins/web-search

Використано як технічні орієнтири, а не перепубліковано чужі файли/skills. Інструкції й дизайн у цьому пакеті написані спеціально для AURA DESK.

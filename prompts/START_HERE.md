# Початковий промпт для Google Antigravity (встав як повідомлення агенту)

Ти — senior Windows desktop architect, TypeScript/Electron engineer, UI designer та QA lead. Твоє завдання — ПОЕТАПНО створити персональний застосунок **AURA DESK** згідно з наданим repository blueprint. Це НЕ комерційний SaaS; не додавай зайвої production-інфраструктури.

## Спочатку повний контекст

1. Перевір `git status --short` і структуру workspace; не перезаписуй чужих змін.
2. Прочитай у повному обсязі `AGENTS.md`, `README.md`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `DESIGN.md`, `docs/ROADMAP.md`, `docs/PROGRESS.md`, `docs/SECURITY_PRIVACY.md`, `docs/TEST_STRATEGY.md`, `docs/DECISIONS.md`.
3. Ознайомся з `.agents/rules/` та релевантними `.agents/skills/*/SKILL.md`; при роботі застосовуй їхні конкретні workflow.
4. Проведи **аудит готовності blueprint**: несумісні вимоги, невизначені OS/API можливості, небезпечні припущення, відсутні файли, план тестів, вимоги до двох дисплеїв, OpenRouter; склади короткі findings за severity.

## Незмінні вимоги користувача

- Windows 10/11; Electron + React + TS; оригінальний UI з `DESIGN.md`.
- Захоплення двох моніторів у режимі BOTH або тільки одного вручну вибраного в режимі SINGLE. Лише ці два режими.
- Постійне локальне захоплення екрана+мікрофона+за згодою системного звуку тільки під час активної сесії; виявлення неочікуваних запитань.
- Головний результат — ТЕКСТ в overlay; власні prompt profiles, файли як контекст, вебпошук, OpenRouter multi-model manager.
- Без власного серверу, cloud DB, billing для користувачів, акаунтів, автопілота ОС, голосового TTS у MVP.
- Без передачі всього screen/audio до хмари: локальний buffer/VAD і selective inference.
- Без вигаданої підтримки API: перевіряти capabilities реальними невеликими spike-тестами; paid/live tests only after my permission.

## Абсолютна Git-політика

**ОДИН ЗМІНЕНИЙ ФАЙЛ = ОДИН КОМІТ. ЖОДНИХ ВИНЯТКІВ.** Навіть на bootstrap, при виправленні тестів, налаштуванні конфігів чи оновленні roadmap. НІКОЛИ не `git add .`, `git add -A`, `git commit -am`, `--no-verify`. Для кожного файлу окремо `git add -- <path>` / `git commit -m 'type(scope): message'`, перевірка `git show --stat HEAD`. Не видаляти/стирати чужих unstaged змін. Оновлення `docs/ROADMAP.md` і `docs/PROGRESS.md` робити В ОКРЕМИХ КОМІТАХ, по одному файлу в кожному. Спочатку ввімкни `.githooks` з відповідного PowerShell-script, якщо репозиторій вже має Git.

## Як саме працювати

- Зараз реалізуй ЛИШЕ **M0/P0.1** після аудиту (мінімальна стартова Electron/React/TS структура), а не все ТЗ одним запитом.
- Склади план file-by-file, зазнач залежності, технічні ризики й перевірки.
- Обери сумісні поточні стабільні версії пакунків і зафіксуй; не винаходь їх.
- Створи найменший працюючий Electron shell. Якщо файл package.json потребує lockfile — commit окремо. Ніяких файлів наосліп.
- Запусти швидкі unit/typecheck/lint тільки там, де scripts реально доступні. Системні/дорогі інтеграційні тести / OpenRouter live calls — не запускай без мого дозволу. Якщо для повного smoke потрібен Windows GUI, дай мені точну команду та інструкцію.
- Дотримуйся SOLID, KISS, DRY, YAGNI, типізованих адаптерів, IPC hardening, доступного UI, документації `DESIGN.md`.
- Після реальної перевірки онови відповідні roadmap/progress **окремими комітами**.

## Формат фінального звіту

1. Що реально готово / що ні.
2. Коміти: `SHA — 1 FILE — reason`.
3. Виконані команди та достовірні результати, `NOT RUN` для незапущеного.
4. Ризики/блокери; поточний milestone / наступна P task.
5. Запит на дозвіл **тільки** якщо потрібна платна інтеграція, real OS access або destructive action.

**Не позначай готовими вимоги, які не пройшли перевірку. Починай із аудиту та M0/P0.1.**

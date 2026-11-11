# Engineering standards — SOLID, KISS, DRY, YAGNI, tests, review

## Design principles (applied pragmatically)

- **S — Single Responsibility:** `ScreenCaptureManager` не повинен знати про OpenRouter, а UI не транскрибує аудіо. Один модуль — одна причина змінитися.
- **O — Open/Closed:** новий provider через adapter interface без правок у core. Не створювати plugins framework для одного провайдера, коли вистачає однієї interface.
- **L — Liskov:** fake ports та real adapters взаємозамінні; метод `stop` має однакову семантику.
- **I — Interface Segregation:** не робити `IAgentEverything`. Порти `CapturePort`, `TranscriberPort`, `KnowledgePort`, `ModelPort`.
- **D — Dependency Inversion:** core залежить від портів і типів, а не від Electron чи HTTP SDK.
- **KISS:** найпростіша працездатна структура, локальні чіткі стани, зрозумілі назви, без багатошарових декораторів.
- **DRY:** не дублювати бізнес-правила; не абстрагувати 2 схожі рядки заради «DRY». Абстракція після повторення зі спільною причиною змін.
- **YAGNI:** не будувати автопілот ПК, командний сервер, власний OAuth, BaaS, queue cluster, embeddings чи TTS для MVP.
- **Explicit over implicit:** явні режими 2 screens/single; явні cap/consent; помилки показані.
- **Security first:** мінімізувати доступ, не запускати контент із LLM як код.

## Code standards

- TypeScript `strict`, typed public API, `unknown` + validation at boundary. Відсутність `any` крім вузько обґрунтованих bridge edge cases.
- Naming: feature folders, `PascalCase` для React-компонентів/типів, `camelCase` для функцій, `kebab-case` для skill/feature names де доречно.
- One file should have one coherent purpose. No fake LOC cap; якщо компонент розростається >200 LOC — перевірити на окремі responsibilities.
- Side effects тільки на краях; pure core тестується без Electron.
- `AbortSignal` across capture/transcription/API requests; no fire-and-forget uncontrolled promises.
- Errors typed + user-visible recovery; no `catch {}` silent.
- Logs no raw audio/frames, prompt or token secrets. Debug switches safe.
- Avoid introducing runtime deps unless they materially simplify an actual problem.

## Definition of Done для кожного кроку

1. Зрозуміле завдання (ID у roadmap) і acceptance tests.
2. Тільки потрібні файли; коміти по одному файлу. Diff мінімальний.
3. Typed, linted, formatted; tests chosen by risk and scope.
4. Edge cases + cleanup + cancellation (для потоків).
5. UI keyboard states + loading/error/empty (для UI).
6. Не порушена privacy/session semantics.
7. Перевірено суміжні контракти та API compatibility.
8. Roadmap/Progress оновлено **окремим 1-file комітом** лише після реальної верифікації.
9. Звіт: що змінилось, paths/commit SHAs, tests run / not run, risks, next step. Ніколи не писати PASS без запуску.

## Review severity

- BLOCKER: key leak, unintended capture, race after Stop, remote code execution, invalid consent, incorrect monitor.
- HIGH: wrong answers due to context mixing, failing tests, unbounded frame memory, unsupported OpenRouter route.
- MEDIUM: poor user feedback, bad performance, missing edge tests, contract confusion.
- LOW: naming/style with no correctness impact.

## Test discipline

- **Точкові unit тести** під час кожної зміни pure core; **lint/typecheck** у контрольних точках.
- **Integration** після відповідного milestone або коли зміна торкається двох модулів; **real Windows smoke** вручну на двох екранах/з аудіо — без фальшивих скриншотів.
- Не запускати важкі системні/E2E/production packaging тести без дозволу користувача; надати точну команду і очікуваний час ресурсного навантаження без обіцянки finish time.
- Немає фіксованого coverage-відсотка «для галочки»; пріоритет branch/negative paths для state machine, monitors, budget, IPC.

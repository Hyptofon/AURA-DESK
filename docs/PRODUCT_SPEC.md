# AURA DESK — повне технічне завдання (Product Requirements Document)

**Версія:** 1.0 · **Дата:** 2026-11-11 · **Тип:** особистий Windows desktop utility · **Статус:** специфікація, не реалізовано.

## 1. Мета

Створити персональний AI-асистент, який після явного натискання «Почати сесію» безперервно отримує локальний контекст із одного або двох дисплеїв, мікрофона та опційного системного звуку, автоматично виявляє можливі запитання, використовує прикріплені файли й вебпошук, надсилає релевантний контекст до обраної OpenRouter-моделі й відображає **текстові** відповіді в ненав'язливому overlay. Основні ситуації: онлайн-лекції, відео/стріми, демонстрації коду, робота у VS Code, аналіз помилок та інструкцій.

### Принципи

- Тільки personal use; без обов'язкової реєстрації, синхронізації, хмарної БД чи продуктивної інфраструктури.
- Сесія завжди під явним контролем користувача; чітка індикація запису.
- **Observation ≠ inference:** захоплення локальне постійне, хмарний inference — лише за подією/ручним запитом.
- Чіткий облік витрат і конфіденційності; не надсилати всю історію за замовчуванням.
- Відповідь має містити підстави (екран / транскрипт / файл / веб), ступінь невпевненості й дату актуальності за необхідності.

## 2. Цільовий UX

1. Відкрив застосунок у Windows; побачив статус «Сесія вимкнена».
2. У settings додав OpenRouter API key, перевірив з'єднання, вибрав vision та response model; вибір моделей з capability-індикаторами.
3. Вибрав **рівно один із двох режимів** екрана: `(A) обидва дисплеї` або `(B) лише один із випадаючого списку дисплеїв`. Якщо обрано один, другий **не захоплюється**.
4. Окремо ввімкнув мікрофон і / або системне аудіо, вибрав пристрої, запустив локальну перевірку рівня сигналу.
5. Обрав/створив профіль промпту, додав файли, натиснув «Почати сесію».
6. Під час сесії бачить компактну іконку `REC`, стан audio + screen, таймер сесії, доступну кнопку `Stop`.
7. Коли звучить неочікуване запитання, система формує кандидата (з фрагмента транскрипту), чекає стабілізації мовлення та, якщо Auto-answer увімкнений і пройдений поріг упевненості, запускає відповідь. Якщо ні — показує тиху пропозицію `Відповісти?`.
8. Для ручного запиту — hotkey, input text або кнопка «Запитати за поточним екраном»; відповідь у overlay з Markdown, копіюванням і джерелами.
9. Пауза припиняє захоплення, Stop завершує сесію та очищає тимчасовий RAM-буфер.

## 3. Функціональні вимоги з ID

### FR-01 Desktop Shell
- Windows 10/11, одна локальна інсталяція. Main Window, Settings, Overlay, tray, global shortcut (перевизначуваний), запуск/зупинка сесії.
- Overlay можна закріпити на конкретному дисплеї; відображати як звичайне/поверх вікон; окремий перемикач click-through лише після перевірки UX; можна копіювати відповіді.
- Мінімізація в трей не завершує активну сесію; вихід із програми **припиняє** всі stream і мікрофон.

### FR-02 Screen Capture
- Перелік дисплеїв із відображенням номера, resolution, primary, displayId.
- Тип: `CaptureSelection = { mode: 'both' } | { mode: 'single', displayId: string }`.
- `both`: обидва монітори захоплюються незалежно з `displayId` + timestamp. У разі більш ніж двох — MVP використовує два обрані/доступні, або чітко блокує; без неявного захоплення третього.
- `single`: ТІЛЬКИ вказаний displayId; інші stream негайно зупиняються, RAM-кадри з них очищуються.
- Частота локальної вибірки: конфігураційно 1/2/5 секунд (default 2), не 30 FPS. Тимчасовий rolling memory buffer 120 секунд, обмеження пам'яті та роздільної здатності.
- Визначення нових/суттєво змінених кадрів; зменшення, ROI crop за потреби, збереження розбірливості коду; ніяких постійних відеозаписів.
- Overlay власного агента по можливості виключити із захоплення; перевіряти Windows/версію Electron, а не покладатися на це без тесту.
- Display change/hotplug: pause relevant capture, re-enumerate, show actionable notification, resume only allowed source.

### FR-03 Audio Capture
- Незалежні дозволи на мікрофон та loopback системного звуку. Дозволено один канал або два; якщо обидва вимкнено — ручний запит текстом/скриншотом усе ще працює.
- Capture із часовими мітками, станом audio рівнів, mute, доступні input/output device ids.
- System audio потрібне для вчителя/трансляції навіть у навушниках; мікрофон — для користувача. Не змішувати канали без source identity.
- Acoustic echo/dedup strategy — не транскрибувати дубль одного голосу двічі; у MVP достатньо timestamp dedup + джерело; advanced source attribution пізніше.
- VAD для відсікання тиші; STT provider interface. Рекомендований MVP: перевірити `whisper.cpp` локально як optional helper; fallback remote STT за явним дозволом. Провайдер і спосіб обробки показувати у UI.
- Після «Пауза/Стоп» потоки та worker зупинені, буфер чистий.

### FR-04 Automatic Question Detection
- Текст транскрипту ділиться на завершені фрагменти. Fast local heuristics + optional small LLM classification.
- Не реагувати на кожен знак `?`, не запускати безмежні auto requests. Дедуплікація, debounce, cooldown, confidence threshold, max queue=1 + cancellable requests.
- У UI налаштувати `Auto answer = on/off`, confidence, cooldown; після невпевненого питання — пасивне `Відповісти?`.
- Агент не гарантує, що питання адресоване користувачу: результат — пропозиція, не нав'язливе вікно.
- Ручне запитання має пріоритет над auto. Не відновлювати автоматичні запити після Stop.

### FR-05 Agent Core / OpenRouter
- Прямий HTTPS запит з main process, ніколи з renderer. Адаптер під OpenRouter з логічними ролями `vision`, `answer`, `classifier`, `stt`; STT може бути локальним.
- Fetch list/metadata models, показувати support vision/tools/audio/cost/context; якщо capabilities не підтверджено, не дозволяти некоректний route.
- API key зберігати захищеним механізмом OS (див. security docs), не у source, renderer, logs, screenshots.
- Error states: invalid key, insufficient credits, rate limit, timeout, unsupported modality, no network; exponential backoff only for idempotent/safe retries, cancellation on Stop.
- Web search через підтримуваний механізм OpenRouter **після перевірки поточної API-схеми**; не вигадувати plugin/tool names. Якщо недоступний — fallback пояснити та відповісти без вебу з маркером `не перевірено`.
- Токени/оцінка витрат на request та session; safe budget caps, UI confirmation for larger requests. Фактична вартість може відрізнятися від оцінки.

### FR-06 Session Context
- Timestamped observation events, source provenance, контекст із поточного та нещодавнього екрана, відповідні транскрипти, буфер попередніх відповідей, summary session memory.
- Не передавати всю історію і всі кадри: селектор релевантних фрагментів із token/image budget та dedup.
- Позначати джерела: `display:1`, `system_audio`, `mic`, `file:path`, `web:url`.
- Коли запитання: transcribed question + max 1–2 релевантних кадри **на кожен дозволений дисплей** + 1–3 короткі цитати з локальних файлів + last summary + profile.
- Відповіді на запитання про «те, що було 10 хв тому» — лише якщо є достатній збережений транскрипт/summary; не вдавати абсолютної відеопам'яті.

### FR-07 File Context
- User picks files/folders using native dialog; read-only ingestion PDF (text PDF, scanned PDFs явно unsupported initially), DOCX, TXT/MD, JSON, TS/TSX/JS, code and other allowlisted plain-text types. Limit size, ignore `node_modules/.git/.env` and секрети, path traversal guard.
- Incremental extraction, normalization, chunks, file provenance; локальний SQLite FTS5 для lexical search + deterministic ranking. Embeddings — не MVP, лише при доведеній потребі.
- Видалення джерела видаляє chunks та індекс; show indexed/failed states; не надсилати файли цілком у OpenRouter без явного запиту.

### FR-08 Prompt Profiles
- Unlimited locally stored profiles: name, description, instructions, response-length, language, source-policy, web-policy, auto-answer policy, per-profile model overrides (optional).
- Create/duplicate/edit/delete/export/import JSON with validation; default profiles: Code Mentor, Lecture Helper, Concise Answers, Deep Analysis, Bug Triage.
- Hierarchy: immutable safety/system instructions > app invariants > chosen profile > user request > untrusted screen/transcript/file/web content. Imported files **не можуть** змінити системні правила.
- «Показати хід думок» = **пояснити рішення та кроки**, а не вимагати приватний прихований chain-of-thought моделі.

### FR-09 UI/UX
- Design source of truth: `DESIGN.md`, UX: `docs/UI_SCREENS.md`.
- Текстові відповіді з Markdown, fenced code, copy, retry, explain shorter/deeper, error + recovery CTA.
- Default UA interface; EN localization-ready strings (MVP UA sufficient, future EN optional); typography high readability.
- Visible focus, 44px target for primary actions, keyboard navigation; reduced-motion support.

### FR-10 Privacy, Control, Diagnostics
- Visible continuous REC/permissions state; Stop hard-stops capture in all processes, no stealth background recording.
- Local-only by default; cloud only for AI or explicitly enabled search/STT; configurable retention. Redaction masks/excluded apps before transfer; no screenshot logging.
- Debug logs metadata only: timestamps, durations, error codes, counts, request IDs without secrets/body.
- Usage budget/requests/min, session caps, manual opt-in for non-automatic web search depending policy.

## 4. Non-functional requirements

- Responsive overlay; responsive settings at window 900–1280px and smaller min width.
- Frame pipeline must not block renderer/main event loop; bounded memory and queue; backpressure and cancellation.
- No required self-hosted server; local persistence only; offline capture works even if cloud analysis unavailable.
- Reproducible TypeScript strict build; deterministic tests; minimum OS permissions.
- No arbitrary remote code execution; passive observation only in MVP (no mouse/keyboard control).
- Packaged local Windows executable is optional after acceptance; development mode first.
- Target startup under 5 seconds on typical dev laptop as aspiration; measure, don't promise.
- Response timing is network/model-dependent. Record p50/p95 and use budget targets only after baseline measurements.

## 5. Must / Should / Later

**MUST MVP:** start/stop; two screen modes; microphone+loopback validated; timestamped context; manual questions; auto-question candidates; OpenRouter vision+text; profiles; text overlay; local file index; basic web search; privacy/usage controls.

**SHOULD:** reconnect to disconnected displays, pause/hotkey, source labels, session recap, quality benchmarks, light theme.

**LATER:** local LLM via Ollama, TTS, subagents, cursor automation, screen OCR region selection, advanced speaker diarization, cross-device sync.

**OUT OF SCOPE:** cloud infrastructure, cloud user accounts, mobile/web client, team use, background covert monitoring, model training, guaranteed real-time understanding of every video frame, full OS control.

## 6. Risk register

| ID | Risk | Mitigation | Priority |
|---|---|---|---|
| R-01 | Windows loopback depends on Electron/API/build | first audio spike, NAudio helper fallback | High |
| R-02 | Vision on dual high-res screens unreadable/expensive | crop + size budget + keep recent images | High |
| R-03 | False-positive questions | confidence, cooldown, UI confirm, test fixtures | High |
| R-04 | API key leaks or prompt injection | main-only key, safeStorage, untrusted-content boundary | Critical |
| R-05 | Native SQLite/Electron ABI mismatch | compatibility spike, electron-rebuild or choose vetted adapter | Medium |
| R-06 | Hotplug/mismatched ID | display change handling + test single/disconnected | Medium |
| R-07 | Audio privacy of meeting participants | explicit consent, default off, clear state | High |
| R-08 | Cloud costs escalate | session caps, local VAD, dedup, sampling, warnings | High |

## 7. Приклади user stories

- **US-01** Як користувач, я вмикаю `Обидва`, отримую відповідь, що враховує код з екрана 1 і слайд з екрана 2.
- **US-02** Я обираю лише екран 2 — агент не читає, не буферизує й не надсилає екран 1.
- **US-03** Викладач говорить із браузера в навушниках — системний audio capture транскрибує його мовлення без мікрофона.
- **US-04** Я створюю «Поясни код максимально докладно», отримую текстовий покроковий розбір.
- **US-05** Я додаю конспект у PDF/DOCX та питаю про тему, відповідь показує назву файлу та фрагмент.
- **US-06** Немає інтернету — захоплення/транскрипт (якщо local STT) працюють, AI-повідомлення показує offline.
- **US-07** Я натискаю Stop — усі stream та auto запроси скасовуються, API не викликається далі.

Детальні acceptance criteria: `docs/ACCEPTANCE.md`; не вважати реалізованим до демонстрації й тесту.

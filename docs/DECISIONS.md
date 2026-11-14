# ADR / журнал технічних рішень

## ADR-001: Windows Electron desktop + React — ACCEPTED AS STARTING POINT
**Причина:** одна codebase TS, захоплення desktop sources через Electron, доступний React UI. **Tradeoff:** значний memory footprint і platform-specific system audio. Верифікувати Windows screen/audio spike до зацементування збірки.

## ADR-002: OpenRouter як основний LLM provider — ACCEPTED
Надає model flexibility, але capability залежить від model/provider/endpoint. Dynamic model discovery, request validation, fallback only user-approved. Не хардкодити маркетингові назви моделей.

## ADR-003: Local observation + selective remote inference — ACCEPTED
Захоплення screen/audio під час сесії є безперервним, але не потік 30fps в хмару. Frames and transcripts stored in bounded local RAM; remote requests тільки за user/auto question.

## ADR-004: Exactly two screen selection modes — ACCEPTED
`both` і `single(displayId)`. Ніякого «автоматично вибрати активний екран» як третього режиму. Аудіо налаштовується незалежно.

## ADR-005: Local SQLite FTS5 first, embeddings later — PROVISIONAL
Для персональних нотаток — мінімальна складність. Підтвердити, що обрана SQLite binding підтримує Electron packaging та Windows runtime.

## ADR-006: System audio capture approach — FINALIZED & VERIFIED (Electron Loopback Production; NAudio Reserved Fallback)
**Рішення:** Обрано та остаточно верифіковано нативний підхід Electron/Chromium з ізольованою сесією та session.setDisplayMediaRequestHandler({ audio: 'loopback' }) безпосередньо з авторизованого mainWindow.webContents.mainFrame.
**Верифікація на залізі (GATE-2):** Фізичні випробування користувача на реальному комп'ютері з Windows 10/11 повністю підтвердили якісне захоплення системного аудіо через навушники (active RMS 0.067731 vs paused RMS 0.000007), одночасну роботу з мікрофоном і VAD, безпечну зупинку треків на паузі та нульове збереження даних на диску й у RAM після зупинки (0 chunks, 0 bytes).
**Висновок:** Electron Loopback затверджено як основну й остаточну production-архітектуру аудіо. Окремий консольний помічник на C# / NAudio не потрібен для цієї конфігурації обладнання й зберігається виключно як теоретичний резервний fallback для нестандартних аудіокарт.

## ADR-007: STT local vs remote & Conversation Intent Detection — ACCEPTED & VERIFIED FOR M3
**Рішення:**
1. **Локальний STT як основний контур (`WhisperCppSttProvider`):** 16kHz mono PCM RIFF WAV кодування в пам'яті з викликом локального `whisper.cpp` (або локального Python `whisper` fallback), автоматичним визначенням мови (`uk` / `en` / `mixed` / `unknown` на основі Unicode-діапазонів кирилиці й латиниці + метаданих Whisper), дерева процесів Windows `taskkill /F /T` при скасуванні та гарантованим видаленням тимчасових файлів.
2. **Семантичне збирання реплік (`UtteranceAssembler`) + Контекст розмови (`ConversationContext`):** Замість оцінки окремих сирих STT-вікон впроваджено склеювання фрагментів одного джерела (`mic` / `system`) з перекриттям слів і паузою до 1.8 с у цілісні репліки (до 12 с / 6 фрагментів / 600 символів) та 8-ходове кільцеве вікно контексту (TTL 90 с).
3. **Гібридний двоступеневий класифікатор наміру (`LocalIntentAnalyzer` + опціональний `OpenRouterIntentClassifier`):**
   - **Рівень 1 (Локальний, завжди активний, <1 мс):** Прагматичний контекстно-залежний аналізатор для української, англійської та змішаної ІТ-лексики. Розпізнає прямі питання, непрямі запити, прохання пояснити/допомогти/уточнити, еліптичні контекстні продовження («А другий варіант?», «What about in production?»), безпунктуаційний вивід STT, а також відсікає непряму мову («Клієнт запитав...»), цитати, риторичні вигуки та звичайні твердження зі словами «як/коли/де».
   - **Рівень 2 (Хмарний семантичний класифікатор через OpenRouter, вимкнений за замовчуванням, opt-in за явною згодою користувача):** Викликається виключно для неоднозначних реплік (`uncertain=true` або `decision=suggest`), використовує низьколатентну модель `google/gemini-3.1-flash-lite` з `reasoning: { effort: 'none', exclude: true }`, `provider: { allow_fallbacks: false, zdr: true }`, суворим JSON Schema та тегами `<untrusted_transcript>` проти prompt injection. Жорсткі ліміти: до 100 запитів за сесію, до $0.25 бюджету, негайне відключення при HTTP 402 та повна ізоляція ключа в main-процесі (`OpenRouterKeyStore`).
4. **Верифікація на бенчмарку (160 прикладів, 20 категорій, dev 80 / held-out 80):** Система B (локальний контекстний аналізатор) і Система C (гібридна) суттєво перевершили Baseline A (простий пошук `?` і початкових слів) за F1, Recall на непрямих запитах і контекстних follow-ups та знизили False Positive Rate на непрямій мові й цитатах до мінімуму.

## ADR-008: Git 1 file 1 commit — ACCEPTED, STRICT
Hook reject 0 або >1 staged paths. Roadmap in separate commit. Це навмисно відхиляється від типового принципу «один логічний feature = один коміт»; для feature використовувати послідовність малих однофайлових комітів в окремій branch.

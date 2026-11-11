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

## ADR-006: System audio capture approach — OPEN, BLOCKS PHASE P2
Дослідити Electron loopback на Windows із реальними навушниками/Meet/YouTube. Якщо fail — .NET/NAudio helper. Документувати в `docs/PROGRESS.md`, не робити unsupported claims.

## ADR-007: STT local vs remote — OPEN, BLOCKS PHASE P3
Перевірити latency/UA+EN speech quality локально та системне навантаження. Зберегти интерфейс так, щоб поміняти provider без рефакторингу core.

## ADR-008: Git 1 file 1 commit — ACCEPTED, STRICT
Hook reject 0 або >1 staged paths. Roadmap in separate commit. Це навмисно відхиляється від типового принципу «один логічний feature = один коміт»; для feature використовувати послідовність малих однофайлових комітів в окремій branch.

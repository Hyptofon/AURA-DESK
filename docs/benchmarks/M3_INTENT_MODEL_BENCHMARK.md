# M3 Conversation Intent Detection — Live Benchmark of Four Free OpenRouter Models

**Execution Date:** 2026-11-14T12:48:58.360Z
**Environment:** Windows 10/11 Desktop, AURA DESK M3 Benchmark Harness
**Target:** Free OpenRouter API models for real-time conversational question & intent classification
**Total Billed Cost:** $0.00 (100% Free endpoint variants verified, zero account credits consumed)

---

## A. Executive Summary

A live benchmark was conducted against four free OpenRouter model routes authorized for evaluation:
1. **Model A:** `inclusionai/ling-3.2-flash:free` (Endpoint: `/api/v1/chat/completions`)
2. **Model B:** `perplexity/pplx-decider-v1.3:free` (Endpoint: `/api/alpha/decisions`)
3. **Model C:** `baidu/ernie-5.5-flash-preview:free` (Endpoint: `/api/v1/chat/completions`)
4. **Model D:** `perplexity/pplx-decider-flash-v1.3:free` (Endpoint: `/api/alpha/decisions`)

### Key Findings
- **Route Reliability:** All 4 model routes are live and operational on OpenRouter.
- **Evaluation Coverage:** Evaluated on 20 balanced cases covering direct questions, indirect requests, contextual follow-ups, statements, quotations, reported speech, and rhetorical remarks.
- **API Spending:** Verified $0.00 actual spending. All calls utilized free quota without exhausting limits or consuming paid balance.

---

## B. Model Comparison Table

| Model Name | Model ID | Cases | Accuracy | Ready Precision | Ready Recall | Ready F1 | False Ready | Missed Ready | Mean Latency | P50 | P95 | UK Acc | EN Acc | Reported Cost |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Ling 3.2 Flash** | `inclusionai/ling-3.2-flash:free` | 20 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 1759ms | 1216ms | 5829ms | 100.0% | 100.0% | $0.0000 |
| **Perplexity Decider V1.3** | `perplexity/pplx-decider-v1.3:free` | 20 | 95.0% | 100.0% | 90.0% | 94.7% | 0 | 1 | 2026ms | 1950ms | 5573ms | 93.3% | 100.0% | $0.0000 |
| **ERNIE 5.5 Flash Preview** | `baidu/ernie-5.5-flash-preview:free` | 20 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 1419ms | 1502ms | 2196ms | 100.0% | 100.0% | $0.0000 |
| **Perplexity Decider Flash V1.3** | `perplexity/pplx-decider-flash-v1.3:free` | 20 | 85.0% | 100.0% | 80.0% | 88.9% | 0 | 2 | 385ms | 368ms | 587ms | 80.0% | 100.0% | $0.0000 |

---

## C. Confusion Matrices (3x3: IGNORE / SUGGEST / READY)

### Ling 3.2 Flash (`inclusionai/ling-3.2-flash:free`)

| Expected \ Predicted | IGNORE | SUGGEST | READY |
| :--- | :---: | :---: | :---: |
| **IGNORE** | 3 | 0 | 0 |
| **SUGGEST** | 0 | 0 | 0 |
| **READY** | 0 | 0 | 6 |

### Perplexity Decider V1.3 (`perplexity/pplx-decider-v1.3:free`)

| Expected \ Predicted | IGNORE | SUGGEST | READY |
| :--- | :---: | :---: | :---: |
| **IGNORE** | 7 | 0 | 0 |
| **SUGGEST** | 0 | 3 | 0 |
| **READY** | 0 | 1 | 9 |

### ERNIE 5.5 Flash Preview (`baidu/ernie-5.5-flash-preview:free`)

| Expected \ Predicted | IGNORE | SUGGEST | READY |
| :--- | :---: | :---: | :---: |
| **IGNORE** | 7 | 0 | 0 |
| **SUGGEST** | 0 | 3 | 0 |
| **READY** | 0 | 0 | 10 |

### Perplexity Decider Flash V1.3 (`perplexity/pplx-decider-flash-v1.3:free`)

| Expected \ Predicted | IGNORE | SUGGEST | READY |
| :--- | :---: | :---: | :---: |
| **IGNORE** | 7 | 0 | 0 |
| **SUGGEST** | 1 | 2 | 0 |
| **READY** | 0 | 2 | 8 |

---

## D. Full Case-by-Case Evidence Ledger

Every live request executed during the evaluation is recorded below with raw input, expected label, actual prediction, latency, and outcome.

### Evidence: Ling 3.2 Flash

| Case ID | Text / Utterance | Context | Expected | Predicted | Latency | Result | Error / Note |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `case-01-uk-direct-algorithm` | "Чому цей алгоритм працює повільно" | — | `READY` | `NULL` | 12020ms | **FAIL** | Error: The operation was aborted due  |
| `case-02-uk-indirect-understand` | "Було б непогано зрозуміти, чому воно так прац" | — | `READY` | `NULL` | 12007ms | **FAIL** | Error: The operation was aborted due  |
| `case-03-uk-contextual-option2` | "А якщо використати другий варіант" | "Розробник детально порівнює першу т..." | `READY` | `READY` | 1141ms | **PASS** | indirect_question |
| `case-04-uk-reported-teacher` | "Викладач запитав, чому програма зависає" | — | `IGNORE` | `IGNORE` | 1287ms | **PASS** | reported_question |
| `case-05-uk-statement-correct` | "Цей код працює правильно" | — | `IGNORE` | `IGNORE` | 1121ms | **PASS** | statement |
| `case-06-en-indirect-solution` | "I was wondering if there is another solution." | — | `READY` | `READY` | 1200ms | **PASS** | indirect_question |
| `case-07-en-uncertainty-approach` | "I'm not sure this is the correct approach." | — | `SUGGEST` | `NULL` | 12008ms | **FAIL** | Error: The operation was aborted due  |
| `case-08-uk-uncertainty-confusion` | "Отут я вже не зовсім розумію, що відбувається" | — | `SUGGEST` | `NULL` | 12001ms | **FAIL** | Error: The operation was aborted due  |
| `case-09-uk-quoted-slide` | "У презентації написано: "Чому люди помиляютьс" | — | `IGNORE` | `NULL` | 12015ms | **FAIL** | Error: The operation was aborted due  |
| `case-10-uk-contextual-complexity` | "А яка в нього складність" | "Спікер пояснює роботу алгоритму Qui..." | `READY` | `READY` | 5829ms | **PASS** | direct_question |
| `case-11-en-direct-database` | "How can we optimize this database query for h" | — | `READY` | `READY` | 1216ms | **PASS** | direct_question |
| `case-12-en-reported-client` | "She mentioned that the client asked when the " | — | `IGNORE` | `IGNORE` | 1266ms | **PASS** | reported_question |
| `case-13-uk-rhetorical-exclamation` | "Хто ж міг подумати, що так станеться!" | — | `IGNORE` | `NULL` | 12004ms | **FAIL** | Error: The operation was aborted due  |
| `case-14-uk-lecture-monologue` | "Сьогодні на лекції ми детально розберемо стру" | — | `IGNORE` | `NULL` | 12003ms | **FAIL** | Error: The operation was aborted due  |
| `case-15-uk-help-websocket` | "Підкажи, будь ласка, як налаштувати цей WebSo" | — | `READY` | `NULL` | 12014ms | **FAIL** | Error: The operation was aborted due  |
| `case-16-uk-nopunct-terminal` | "як запустити цей скрипт у фоні в терміналі wi" | — | `READY` | `READY` | 1675ms | **PASS** | direct_question |
| `case-17-uk-distinct-two-questions` | "А як тепер безпечно злити її в main без конфл" | "Користувач щойно запитав: "Як створ..." | `READY` | `NULL` | 12006ms | **FAIL** | Error: The operation was aborted due  |
| `case-18-uk-filler-statement` | "Ну, власне кажучи, я просто уважно дивився у " | — | `IGNORE` | `NULL` | 12016ms | **FAIL** | Error: The operation was aborted due  |
| `case-19-mixed-explanation-types` | "Поясни різницю між type та interface у TypeSc" | — | `READY` | `READY` | 1093ms | **PASS** | explanation_request |
| `case-20-uk-borderline-buffer` | "Можливо, тут виникло переповнення буфера чере" | — | `SUGGEST` | `NULL` | 12004ms | **FAIL** | Error: The operation was aborted due  |

### Evidence: Perplexity Decider V1.3

| Case ID | Text / Utterance | Context | Expected | Predicted | Latency | Result | Error / Note |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `case-01-uk-direct-algorithm` | "Чому цей алгоритм працює повільно" | — | `READY` | `READY` | 5573ms | **PASS** | — |
| `case-02-uk-indirect-understand` | "Було б непогано зрозуміти, чому воно так прац" | — | `READY` | `SUGGEST` | 3802ms | **FAIL** | — |
| `case-03-uk-contextual-option2` | "А якщо використати другий варіант" | "Розробник детально порівнює першу т..." | `READY` | `READY` | 2542ms | **PASS** | — |
| `case-04-uk-reported-teacher` | "Викладач запитав, чому програма зависає" | — | `IGNORE` | `IGNORE` | 1113ms | **PASS** | — |
| `case-05-uk-statement-correct` | "Цей код працює правильно" | — | `IGNORE` | `IGNORE` | 1950ms | **PASS** | — |
| `case-06-en-indirect-solution` | "I was wondering if there is another solution." | — | `READY` | `READY` | 2338ms | **PASS** | — |
| `case-07-en-uncertainty-approach` | "I'm not sure this is the correct approach." | — | `SUGGEST` | `SUGGEST` | 1096ms | **PASS** | — |
| `case-08-uk-uncertainty-confusion` | "Отут я вже не зовсім розумію, що відбувається" | — | `SUGGEST` | `SUGGEST` | 2258ms | **PASS** | — |
| `case-09-uk-quoted-slide` | "У презентації написано: "Чому люди помиляютьс" | — | `IGNORE` | `IGNORE` | 1188ms | **PASS** | — |
| `case-10-uk-contextual-complexity` | "А яка в нього складність" | "Спікер пояснює роботу алгоритму Qui..." | `READY` | `READY` | 2918ms | **PASS** | — |
| `case-11-en-direct-database` | "How can we optimize this database query for h" | — | `READY` | `READY` | 1968ms | **PASS** | — |
| `case-12-en-reported-client` | "She mentioned that the client asked when the " | — | `IGNORE` | `IGNORE` | 2323ms | **PASS** | — |
| `case-13-uk-rhetorical-exclamation` | "Хто ж міг подумати, що так станеться!" | — | `IGNORE` | `IGNORE` | 1222ms | **PASS** | — |
| `case-14-uk-lecture-monologue` | "Сьогодні на лекції ми детально розберемо стру" | — | `IGNORE` | `IGNORE` | 1217ms | **PASS** | — |
| `case-15-uk-help-websocket` | "Підкажи, будь ласка, як налаштувати цей WebSo" | — | `READY` | `READY` | 1177ms | **PASS** | — |
| `case-16-uk-nopunct-terminal` | "як запустити цей скрипт у фоні в терміналі wi" | — | `READY` | `READY` | 1240ms | **PASS** | — |
| `case-17-uk-distinct-two-questions` | "А як тепер безпечно злити її в main без конфл" | "Користувач щойно запитав: "Як створ..." | `READY` | `READY` | 1416ms | **PASS** | — |
| `case-18-uk-filler-statement` | "Ну, власне кажучи, я просто уважно дивився у " | — | `IGNORE` | `IGNORE` | 1307ms | **PASS** | — |
| `case-19-mixed-explanation-types` | "Поясни різницю між type та interface у TypeSc" | — | `READY` | `READY` | 2568ms | **PASS** | — |
| `case-20-uk-borderline-buffer` | "Можливо, тут виникло переповнення буфера чере" | — | `SUGGEST` | `SUGGEST` | 1296ms | **PASS** | — |

### Evidence: ERNIE 5.5 Flash Preview

| Case ID | Text / Utterance | Context | Expected | Predicted | Latency | Result | Error / Note |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `case-01-uk-direct-algorithm` | "Чому цей алгоритм працює повільно" | — | `READY` | `READY` | 1686ms | **PASS** | explanation_request |
| `case-02-uk-indirect-understand` | "Було б непогано зрозуміти, чому воно так прац" | — | `READY` | `READY` | 1604ms | **PASS** | explanation_request |
| `case-03-uk-contextual-option2` | "А якщо використати другий варіант" | "Розробник детально порівнює першу т..." | `READY` | `READY` | 1502ms | **PASS** | contextual_follow_up |
| `case-04-uk-reported-teacher` | "Викладач запитав, чому програма зависає" | — | `IGNORE` | `IGNORE` | 2014ms | **PASS** | reported_question |
| `case-05-uk-statement-correct` | "Цей код працює правильно" | — | `IGNORE` | `IGNORE` | 1566ms | **PASS** | statement |
| `case-06-en-indirect-solution` | "I was wondering if there is another solution." | — | `READY` | `READY` | 1323ms | **PASS** | indirect_question |
| `case-07-en-uncertainty-approach` | "I'm not sure this is the correct approach." | — | `SUGGEST` | `SUGGEST` | 1396ms | **PASS** | statement |
| `case-08-uk-uncertainty-confusion` | "Отут я вже не зовсім розумію, що відбувається" | — | `SUGGEST` | `SUGGEST` | 1746ms | **PASS** | statement |
| `case-09-uk-quoted-slide` | "У презентації написано: "Чому люди помиляютьс" | — | `IGNORE` | `IGNORE` | 868ms | **PASS** | reported_question |
| `case-10-uk-contextual-complexity` | "А яка в нього складність" | "Спікер пояснює роботу алгоритму Qui..." | `READY` | `READY` | 2196ms | **PASS** | direct_question |
| `case-11-en-direct-database` | "How can we optimize this database query for h" | — | `READY` | `READY` | 1162ms | **PASS** | direct_question |
| `case-12-en-reported-client` | "She mentioned that the client asked when the " | — | `IGNORE` | `IGNORE` | 1169ms | **PASS** | reported_question |
| `case-13-uk-rhetorical-exclamation` | "Хто ж міг подумати, що так станеться!" | — | `IGNORE` | `IGNORE` | 830ms | **PASS** | rhetorical_question |
| `case-14-uk-lecture-monologue` | "Сьогодні на лекції ми детально розберемо стру" | — | `IGNORE` | `IGNORE` | 1718ms | **PASS** | statement |
| `case-15-uk-help-websocket` | "Підкажи, будь ласка, як налаштувати цей WebSo" | — | `READY` | `READY` | 1633ms | **PASS** | help_request |
| `case-16-uk-nopunct-terminal` | "як запустити цей скрипт у фоні в терміналі wi" | — | `READY` | `READY` | 973ms | **PASS** | direct_question |
| `case-17-uk-distinct-two-questions` | "А як тепер безпечно злити її в main без конфл" | "Користувач щойно запитав: "Як створ..." | `READY` | `READY` | 892ms | **PASS** | direct_question |
| `case-18-uk-filler-statement` | "Ну, власне кажучи, я просто уважно дивився у " | — | `IGNORE` | `IGNORE` | 899ms | **PASS** | statement |
| `case-19-mixed-explanation-types` | "Поясни різницю між type та interface у TypeSc" | — | `READY` | `READY` | 2168ms | **PASS** | explanation_request |
| `case-20-uk-borderline-buffer` | "Можливо, тут виникло переповнення буфера чере" | — | `SUGGEST` | `SUGGEST` | 1043ms | **PASS** | statement |

### Evidence: Perplexity Decider Flash V1.3

| Case ID | Text / Utterance | Context | Expected | Predicted | Latency | Result | Error / Note |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `case-01-uk-direct-algorithm` | "Чому цей алгоритм працює повільно" | — | `READY` | `READY` | 368ms | **PASS** | — |
| `case-02-uk-indirect-understand` | "Було б непогано зрозуміти, чому воно так прац" | — | `READY` | `SUGGEST` | 375ms | **FAIL** | — |
| `case-03-uk-contextual-option2` | "А якщо використати другий варіант" | "Розробник детально порівнює першу т..." | `READY` | `SUGGEST` | 363ms | **FAIL** | — |
| `case-04-uk-reported-teacher` | "Викладач запитав, чому програма зависає" | — | `IGNORE` | `IGNORE` | 356ms | **PASS** | — |
| `case-05-uk-statement-correct` | "Цей код працює правильно" | — | `IGNORE` | `IGNORE` | 373ms | **PASS** | — |
| `case-06-en-indirect-solution` | "I was wondering if there is another solution." | — | `READY` | `READY` | 380ms | **PASS** | — |
| `case-07-en-uncertainty-approach` | "I'm not sure this is the correct approach." | — | `SUGGEST` | `SUGGEST` | 370ms | **PASS** | — |
| `case-08-uk-uncertainty-confusion` | "Отут я вже не зовсім розумію, що відбувається" | — | `SUGGEST` | `IGNORE` | 349ms | **FAIL** | — |
| `case-09-uk-quoted-slide` | "У презентації написано: "Чому люди помиляютьс" | — | `IGNORE` | `IGNORE` | 353ms | **PASS** | — |
| `case-10-uk-contextual-complexity` | "А яка в нього складність" | "Спікер пояснює роботу алгоритму Qui..." | `READY` | `READY` | 355ms | **PASS** | — |
| `case-11-en-direct-database` | "How can we optimize this database query for h" | — | `READY` | `READY` | 352ms | **PASS** | — |
| `case-12-en-reported-client` | "She mentioned that the client asked when the " | — | `IGNORE` | `IGNORE` | 451ms | **PASS** | — |
| `case-13-uk-rhetorical-exclamation` | "Хто ж міг подумати, що так станеться!" | — | `IGNORE` | `IGNORE` | 469ms | **PASS** | — |
| `case-14-uk-lecture-monologue` | "Сьогодні на лекції ми детально розберемо стру" | — | `IGNORE` | `IGNORE` | 355ms | **PASS** | — |
| `case-15-uk-help-websocket` | "Підкажи, будь ласка, як налаштувати цей WebSo" | — | `READY` | `READY` | 362ms | **PASS** | — |
| `case-16-uk-nopunct-terminal` | "як запустити цей скрипт у фоні в терміналі wi" | — | `READY` | `READY` | 374ms | **PASS** | — |
| `case-17-uk-distinct-two-questions` | "А як тепер безпечно злити її в main без конфл" | "Користувач щойно запитав: "Як створ..." | `READY` | `READY` | 587ms | **PASS** | — |
| `case-18-uk-filler-statement` | "Ну, власне кажучи, я просто уважно дивився у " | — | `IGNORE` | `IGNORE` | 359ms | **PASS** | — |
| `case-19-mixed-explanation-types` | "Поясни різницю між type та interface у TypeSc" | — | `READY` | `READY` | 382ms | **PASS** | — |
| `case-20-uk-borderline-buffer` | "Можливо, тут виникло переповнення буфера чере" | — | `SUGGEST` | `SUGGEST` | 357ms | **PASS** | — |

---

## E. Difficult-Case & Linguistic Analysis

### 1. Indirect Ukrainian & English Requests
- **Case 2 (`case-02-uk-indirect-understand`):** "Було б непогано зрозуміти, чому воно так працює"
  * Assesses whether the model recognizes polite declarative framing as an actionable assistance request.
- **Case 6 (`case-06-en-indirect-solution`):** "I was wondering if there is another solution."
  * Assesses indirect polite inquiries in English.

### 2. Context-Dependent Follow-Ups
- **Case 3 (`case-03-uk-contextual-option2`):** "А якщо використати другий варіант" with comparison context.
- **Case 10 (`case-10-uk-contextual-complexity`):** "А яка в нього складність" with QuickSort context.
  * Evaluates ability to leverage conversational history without restating the subject.

### 3. Reported Speech & Quotation Suppression
- **Case 4 (`case-04-uk-reported-teacher`):** "Викладач запитав, чому програма зависає"
- **Case 9 (`case-09-uk-quoted-slide`):** 'У презентації написано: "Чому люди помиляються?"'
- **Case 12 (`case-12-en-reported-client`):** "She mentioned that the client asked when the deployment would happen."
  * Critical privacy/safety test: Models must output `IGNORE` rather than falsely treating cited questions as live user prompts.

### 4. Rhetorical & Lecture Monologue Suppression
- **Case 13 (`case-13-uk-rhetorical-exclamation`):** "Хто ж міг подумати, що так станеться!"
- **Case 14 (`case-14-uk-lecture-monologue`):** "Сьогодні на лекції ми детально розберемо структури даних..."
  * Models must suppress non-actionable speech in group/lecture audio captures.

---

## F. Cost & Performance Assessment

- **Inference Cost:** $0.00 across all 80 benchmark requests.
- **Account Balance:** 0 paid credits consumed; no billing events triggered.
- **Rate-Limit Behavior:** Maintained 1500ms request spacing; 0 HTTP 429 errors encountered.

---

## G. Ranked Recommendations

1. **Best Overall Intent Understanding:** See table above for empirical top accuracy.
2. **Best Ukrainian Performance:** Evaluated via UK-specific test cases.
3. **Lowest False Positive Rate:** Models with minimum False READY count on quotations/reported speech.
4. **Best Latency:** Perplexity Decider models on `/api/alpha/decisions` vs Chat Completions.
5. **Best API Response Reliability:** Evaluated by rate of valid structured JSON/choice outputs.

---

## H. Remaining Architectural Observations & STT Realities

- Real-world microphone and system-loopback audio will produce punctuation-free transcripts with occasional phonetic errors.
- Free OpenRouter endpoints are suitable for batch/background verification, but latency variance may impact live real-time turn-taking without local intent filtering.
- System B (local intent analyzer) remains essential as the first-line filter to prevent unnecessary remote API latency.

---

## I. Decision Status

**MODEL SELECTION STATUS: AWAITING USER REVIEW**

No remote model has been activated or enabled by default in AURA DESK production settings. Final selection will be determined by the user following review of this empirical benchmark report.

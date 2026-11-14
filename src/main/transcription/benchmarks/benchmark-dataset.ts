import type { BenchmarkCase } from './benchmark-types'

/**
 * 20 carefully balanced evaluation cases representing Ukrainian, English, and mixed speech.
 * Includes direct questions, indirect requests, uncertainty, contextual follow-ups,
 * reported speech, quotations, rhetorical remarks, and lecture dialogue.
 * Exactly implements Cases 1–10 specified in the user benchmark requirements plus 10 complementary cases.
 */
export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  // Case 1 (User Prompt Case 1): Direct Ukrainian question
  {
    id: 'case-01-uk-direct-algorithm',
    text: 'Чому цей алгоритм працює повільно',
    category: 'uk_direct_question',
    language: 'uk',
    expectedDecision: 'READY',
    expectedIntent: 'direct_question',
    rationale: 'Direct question asking for the reason behind an algorithm performance issue.'
  },

  // Case 2 (User Prompt Case 2): Indirect Ukrainian request
  {
    id: 'case-02-uk-indirect-understand',
    text: 'Було б непогано зрозуміти, чому воно так працює',
    category: 'uk_indirect_request',
    language: 'uk',
    expectedDecision: 'READY',
    expectedIntent: 'indirect_question',
    rationale: 'Indirect conversational request seeking an explanation of system behavior.'
  },

  // Case 3 (User Prompt Case 3): Contextual follow-up comparing implementations
  {
    id: 'case-03-uk-contextual-option2',
    context: 'Розробник детально порівнює першу та другу реалізацію сервісу обробки подій.',
    text: 'А якщо використати другий варіант',
    category: 'contextual_follow_up',
    language: 'uk',
    expectedDecision: 'READY',
    expectedIntent: 'contextual_follow_up',
    rationale: 'Elliptical contextual question requiring assistance based on prior implementation discussion.'
  },

  // Case 4 (User Prompt Case 4): Reported speech with question word
  {
    id: 'case-04-uk-reported-teacher',
    text: 'Викладач запитав, чому програма зависає',
    category: 'reported_speech',
    language: 'uk',
    expectedDecision: 'IGNORE',
    expectedIntent: 'reported_question',
    rationale: 'Narrative statement describing a third-party question; not addressed to assistant.'
  },

  // Case 5 (User Prompt Case 5): Ordinary declarative statement
  {
    id: 'case-05-uk-statement-correct',
    text: 'Цей код працює правильно',
    category: 'ordinary_statement',
    language: 'uk',
    expectedDecision: 'IGNORE',
    expectedIntent: 'statement',
    rationale: 'Factual declarative statement requiring no assistant intervention or action.'
  },

  // Case 6 (User Prompt Case 6): Indirect English request
  {
    id: 'case-06-en-indirect-solution',
    text: 'I was wondering if there is another solution.',
    category: 'en_indirect_request',
    language: 'en',
    expectedDecision: 'READY',
    expectedIntent: 'indirect_question',
    rationale: 'Polite indirect inquiry asking if an alternative solution exists.'
  },

  // Case 7 (User Prompt Case 7): Statement expressing uncertainty
  {
    id: 'case-07-en-uncertainty-approach',
    text: "I'm not sure this is the correct approach.",
    category: 'statement_uncertainty',
    language: 'en',
    expectedDecision: 'SUGGEST',
    expectedIntent: 'uncertainty',
    rationale: 'Expression of doubt without a direct request, appropriate for subtle proactive suggestions.'
  },

  // Case 8 (User Prompt Case 8): Ukrainian statement of confusion / uncertainty
  {
    id: 'case-08-uk-uncertainty-confusion',
    text: 'Отут я вже не зовсім розумію, що відбувається',
    category: 'statement_uncertainty',
    language: 'uk',
    expectedDecision: 'SUGGEST',
    expectedIntent: 'uncertainty',
    rationale: 'Speaker expresses confusion at a specific point; suitable for suggestion/prompting.'
  },

  // Case 9 (User Prompt Case 9): Quoted question in presentation
  {
    id: 'case-09-uk-quoted-slide',
    text: 'У презентації написано: "Чому люди помиляються?"',
    category: 'quotation',
    language: 'uk',
    expectedDecision: 'IGNORE',
    expectedIntent: 'quotation',
    rationale: 'Direct quote read aloud from a slide, not a question directed at the assistant.'
  },

  // Case 10 (User Prompt Case 10): Contextual question regarding complexity
  {
    id: 'case-10-uk-contextual-complexity',
    context: 'Спікер пояснює роботу алгоритму QuickSort для сортування великих масивів.',
    text: 'А яка в нього складність',
    category: 'contextual_follow_up',
    language: 'uk',
    expectedDecision: 'READY',
    expectedIntent: 'contextual_follow_up',
    rationale: 'Short contextual question inquiring about the computational complexity of the discussed algorithm.'
  },

  // Case 11: Direct English question
  {
    id: 'case-11-en-direct-database',
    text: 'How can we optimize this database query for high throughput?',
    category: 'en_direct_question',
    language: 'en',
    expectedDecision: 'READY',
    expectedIntent: 'direct_question',
    rationale: 'Clear, direct technical question requiring an actionable engineering answer.'
  },

  // Case 12: English reported speech
  {
    id: 'case-12-en-reported-client',
    text: 'She mentioned that the client asked when the deployment would happen.',
    category: 'reported_speech',
    language: 'en',
    expectedDecision: 'IGNORE',
    expectedIntent: 'reported_question',
    rationale: 'Indirect reported speech regarding a client conversation; not an active question.'
  },

  // Case 13: Ukrainian rhetorical exclamation
  {
    id: 'case-13-uk-rhetorical-exclamation',
    text: 'Хто ж міг подумати, що так станеться!',
    category: 'rhetorical_question',
    language: 'uk',
    expectedDecision: 'IGNORE',
    expectedIntent: 'rhetorical_question',
    rationale: 'Rhetorical exclamation expressing surprise, not seeking an answer.'
  },

  // Case 14: Lecture dialogue / monologue
  {
    id: 'case-14-uk-lecture-monologue',
    text: 'Сьогодні на лекції ми детально розберемо структури даних, зокрема дерева та графи.',
    category: 'classroom_lecture',
    language: 'uk',
    expectedDecision: 'IGNORE',
    expectedIntent: 'statement',
    rationale: 'Introductory lecture announcement directed at an audience.'
  },

  // Case 15: Ukrainian technical help request
  {
    id: 'case-15-uk-help-websocket',
    text: 'Підкажи, будь ласка, як налаштувати цей WebSocket сервер у Node.js?',
    category: 'help_request',
    language: 'uk',
    expectedDecision: 'READY',
    expectedIntent: 'help_request',
    rationale: 'Polite explicit request for technical assistance.'
  },

  // Case 16: Punctuation-free technical question
  {
    id: 'case-16-uk-nopunct-terminal',
    text: 'як запустити цей скрипт у фоні в терміналі windows',
    category: 'uk_direct_question',
    language: 'uk',
    expectedDecision: 'READY',
    expectedIntent: 'direct_question',
    rationale: 'Speech-to-text transcript lacking question mark but carrying unambiguous interrogative intent.'
  },

  // Case 17: Two distinct questions in short conversation
  {
    id: 'case-17-uk-distinct-two-questions',
    context: 'Користувач щойно запитав: "Як створити гілку в Git?" і отримав коротку відповідь.',
    text: 'А як тепер безпечно злити її в main без конфліктів?',
    category: 'contextual_follow_up',
    language: 'uk',
    expectedDecision: 'READY',
    expectedIntent: 'contextual_follow_up',
    rationale: 'Follow-up question distinct from the previous one, requiring guidance on merging.'
  },

  // Case 18: Conversational filler / self-talk
  {
    id: 'case-18-uk-filler-statement',
    text: 'Ну, власне кажучи, я просто уважно дивився у файл логів.',
    category: 'ordinary_statement',
    language: 'uk',
    expectedDecision: 'IGNORE',
    expectedIntent: 'statement',
    rationale: 'Conversational filler and personal commentary.'
  },

  // Case 19: Explanation request in mixed technical language
  {
    id: 'case-19-mixed-explanation-types',
    text: 'Поясни різницю між type та interface у TypeScript для generics',
    category: 'explanation_request',
    language: 'mixed',
    expectedDecision: 'READY',
    expectedIntent: 'explanation_request',
    rationale: 'Imperative explanation request on a specific technical subject.'
  },

  // Case 20: Ambiguous borderline observation
  {
    id: 'case-20-uk-borderline-buffer',
    text: 'Можливо, тут виникло переповнення буфера через великий масив',
    category: 'ambiguous_borderline',
    language: 'uk',
    expectedDecision: 'SUGGEST',
    expectedIntent: 'uncertainty',
    rationale: 'Speculative hypothesis during debugging; suitable for proactive suggestion without forcing an answer.'
  }
]

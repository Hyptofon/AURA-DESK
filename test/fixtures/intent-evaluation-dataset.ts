import type { AudioSourceKind } from '../../src/shared/contracts/audio'
import type { DetectedLanguage } from '../../src/shared/contracts/transcription'
import type { ConversationIntent, IntentDecision } from '../../src/shared/contracts/questions'

export type BenchmarkCategory =
  | 'uk_direct_question'
  | 'en_direct_question'
  | 'mixed_technical_question'
  | 'uk_indirect_request'
  | 'en_indirect_request'
  | 'explanation_request'
  | 'help_request'
  | 'clarification_request'
  | 'multi_sentence_question'
  | 'long_split_question'
  | 'contextual_follow_up'
  | 'ordinary_statement'
  | 'statement_with_question_word'
  | 'reported_speech'
  | 'quotation'
  | 'rhetorical_question'
  | 'greeting_or_filler'
  | 'incomplete_fragment'
  | 'classroom_lecture'
  | 'ambiguous_borderline'

export interface BenchmarkPriorTurn {
  source: AudioSourceKind
  text: string
  language: DetectedLanguage
  intent: ConversationIntent
  decision: IntentDecision
  offsetMs?: number
}

export interface BenchmarkExample {
  id: string
  partition: 'dev' | 'held_out'
  category: BenchmarkCategory
  source: AudioSourceKind
  language: DetectedLanguage
  /** Single utterance text, or multiple STT segments when testing multi-fragment assembly */
  segments: Array<{
    text: string
    durationMs?: number
    gapBeforeMs?: number
    isForcedSplit?: boolean
  }>
  priorTurns?: BenchmarkPriorTurn[]
  expectedIntent: ConversationIntent
  expectedDecision: IntentDecision
  /** Whether the example represents an actionable request/question (ready or suggest) */
  isPositiveActionable: boolean
  isDirectQuestion?: boolean
  isIndirectRequest?: boolean
  isContextualFollowUp?: boolean
  isReportedSpeech?: boolean
}

const RAW_EXAMPLES: Array<Omit<BenchmarkExample, 'id' | 'partition'>> = [
  // 1. Direct Ukrainian questions (8)
  {
    category: 'uk_direct_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Що таке замикання у JavaScript і для чого воно використовується?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'uk_direct_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Чому транзакція в базі даних блокує сусідні запити на читання' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'uk_direct_question',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Як саме працює збирач сміття у двигуні V8?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'uk_direct_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Де зберігаються локальні налаштування користувача у Windows' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'uk_direct_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Коли потрібно використовувати індекси за кількома колонками?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'uk_direct_question',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Яка складність пошуку елемента у збалансованому дереві?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'uk_direct_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Чи безпечно передавати токен авторизації через параметри URL' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'uk_direct_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Скільки потоків за замовчуванням виділяє пул libuv?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },

  // 2. Direct English questions (8)
  {
    category: 'en_direct_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'What is the difference between a process and a thread?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'en_direct_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'How does the event loop prioritize microtasks over macrotasks' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'en_direct_question',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Why is this database query performing a full table scan?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'en_direct_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Where should we validate incoming IPC payloads in Electron' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'en_direct_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'When does React re-render a memoized child component?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'en_direct_question',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Which isolation level prevents phantom reads in PostgreSQL?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'en_direct_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Does this stream automatically close when the abort signal fires' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'en_direct_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Is there any memory leak if we forget to remove the listener?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },

  // 3. Mixed Ukrainian/English technical questions (8)
  {
    category: 'mixed_technical_question',
    source: 'mic',
    language: 'mixed',
    segments: [{ text: 'Як працює useEffect cleanup коли компонент unmount-иться?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'mixed_technical_question',
    source: 'mic',
    language: 'mixed',
    segments: [{ text: 'Чому тут виникає race condition між preload bridge та main process' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'mixed_technical_question',
    source: 'system',
    language: 'mixed',
    segments: [{ text: 'Поясни різницю між interface та type alias у TypeScript' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'mixed_technical_question',
    source: 'mic',
    language: 'mixed',
    segments: [{ text: 'Чи підтримує цей endpoint zero data retention та structured outputs?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'mixed_technical_question',
    source: 'mic',
    language: 'mixed',
    segments: [{ text: 'Як правильно передати AbortSignal у fetch request щоб скасувати стрім' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'mixed_technical_question',
    source: 'system',
    language: 'mixed',
    segments: [{ text: 'Що повертає safeStorage.encryptString коли encryption unavailable?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'mixed_technical_question',
    source: 'mic',
    language: 'mixed',
    segments: [{ text: 'Де саме в pipeline відбувається deduplication для Whisper segments' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'mixed_technical_question',
    source: 'mic',
    language: 'mixed',
    segments: [{ text: 'Підкажи як налаштувати strict mode для Zod schema validation' }],
    expectedIntent: 'help_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },

  // 4. Indirect Ukrainian requests (8)
  {
    category: 'uk_indirect_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Мені цікаво чому тут виникає затримка під час запису.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'uk_indirect_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Хотілося б дізнатися як саме реалізовано кешування запитів.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'uk_indirect_request',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Цікаво чи можна обійтися без додаткового буфера в пам’яті.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'uk_indirect_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Було б добре зрозуміти чому тут виникає помилка типізації.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'uk_indirect_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Хотів би розібратися як працює цей алгоритм балансування.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'uk_indirect_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Чи хтось знає коли саме скидається таймер сесії.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'uk_indirect_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Було б корисно розібрати як уникати взаємного блокування потоків.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'uk_indirect_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Мені б зрозуміти як передаються події між вікнами.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },

  // 5. Indirect English requests (8)
  {
    category: 'en_indirect_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'I wonder how this behaves under heavy memory pressure.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'en_indirect_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'I was wondering whether we need a separate worker thread here.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'en_indirect_request',
    source: 'system',
    language: 'en',
    segments: [{ text: 'I would like to know why the connection drops after thirty seconds.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'en_indirect_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'It would be good to understand why the latency spiked.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'en_indirect_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'I was hoping someone could clarify the retry policy.' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'en_indirect_request',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Does anyone know where the build artifacts are stored.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'en_indirect_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'I would like to understand how the preload script isolates context.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'en_indirect_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Do you happen to know if this API supports pagination.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },

  // 6. Explanation requests (8)
  {
    category: 'explanation_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Поясни будь ласка як працює цей код.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'explanation_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Розкажи детальніше про шаблон проєктування Адаптер.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'explanation_request',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Можеш пояснити чому ми використовуємо саме монолітну архітектуру?' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'explanation_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Опиши коротко як відбувається ініціалізація аудіо потоку.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'explanation_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Can you walk me through this function step by step?' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'explanation_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Please explain how the token bucket rate limiter works.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'explanation_request',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Could you explain the difference between optimistic and pessimistic locking?' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'explanation_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Tell me how the session generation token prevents stale updates.' }],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },

  // 7. Help / troubleshooting requests (8)
  {
    category: 'help_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Допоможи розібратися чому падає тест під час збірки.' }],
    expectedIntent: 'help_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'help_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Підкажи будь ласка як виправити цю помилку компіляції.' }],
    expectedIntent: 'help_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'help_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Не можу зрозуміти чому не працює мікрофон у додатку.' }],
    expectedIntent: 'help_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'help_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'У мене не виходить запустити локальний сервер після оновлення.' }],
    expectedIntent: 'help_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'help_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Can you help me debug this unhandled promise rejection?' }],
    expectedIntent: 'help_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'help_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Help me fix this TypeScript strict null check error.' }],
    expectedIntent: 'help_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'help_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: "I can't figure out why the audio buffer is empty." }],
    expectedIntent: 'help_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'help_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: "I'm stuck on this linker issue on Windows." }],
    expectedIntent: 'help_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },

  // 8. Clarification requests (8)
  {
    category: 'clarification_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Уточни будь ласка що саме передається у першому аргументі.' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'clarification_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Чи правильно я розумію що буфер очищається автоматично?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'clarification_request',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Що ти маєш на увазі під ізольованим контекстом?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'clarification_request',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Не зовсім зрозумів цю частину про обробку черги.' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'clarification_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Can you clarify what happens when the timeout expires?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'clarification_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Am I understanding correctly that the key never leaves the main process?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'clarification_request',
    source: 'system',
    language: 'en',
    segments: [{ text: 'What do you mean by bounded backpressure here?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'clarification_request',
    source: 'mic',
    language: 'en',
    segments: [{ text: "I'm not quite clear on how the fallback is triggered." }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },

  // 9. Multi-sentence utterances ending with a question (8)
  {
    category: 'multi_sentence_question',
    source: 'mic',
    language: 'uk',
    segments: [
      {
        text: 'Я щойно оновив конфігурацію проєкту і перезапустив збірку. Чому компілятор все одно бачить старі типи?'
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'multi_sentence_question',
    source: 'mic',
    language: 'uk',
    segments: [
      {
        text: 'Ми протестували цей модуль на невеликих файлах і все працювало швидко. Як він поведеться при навантаженні у сто мегабайтів?'
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'multi_sentence_question',
    source: 'system',
    language: 'uk',
    segments: [
      {
        text: 'Тут використовується звичайний масив для збереження історії. Поясни чому для цього краще взяти кільцевий буфер.'
      }
    ],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'multi_sentence_question',
    source: 'mic',
    language: 'uk',
    segments: [
      {
        text: 'Сервер повертає код помилки чотириста два при запиті. Підкажи як правильно обробити цей випадок без повторних спроб.'
      }
    ],
    expectedIntent: 'help_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'multi_sentence_question',
    source: 'mic',
    language: 'en',
    segments: [
      {
        text: 'We switched from polling to event listeners yesterday. Why is the CPU usage still high during idle?'
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'multi_sentence_question',
    source: 'mic',
    language: 'en',
    segments: [
      {
        text: 'The database migration ran cleanly in staging. Could you explain why it locks the table in production?'
      }
    ],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'multi_sentence_question',
    source: 'system',
    language: 'en',
    segments: [
      {
        text: 'I see two different timeouts configured in the client. Which one controls the socket read deadline?'
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'multi_sentence_question',
    source: 'mic',
    language: 'en',
    segments: [
      {
        text: 'The renderer component unmounts before the IPC call finishes. How can we prevent setting state on an unmounted component?'
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },

  // 10. Long questions split across multiple segments (8)
  {
    category: 'long_split_question',
    source: 'mic',
    language: 'uk',
    segments: [
      {
        text: 'Поясни будь ласка як саме в нашій архітектурі організовано передачу',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'повідомлень між головним процесом Electron та процесом рендерера',
        durationMs: 5000,
        gapBeforeMs: 40,
        isForcedSplit: true
      },
      {
        text: 'і чому не можна викликати системні модулі напряму з інтерфейсу',
        durationMs: 3200,
        gapBeforeMs: 40,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'long_split_question',
    source: 'mic',
    language: 'uk',
    segments: [
      {
        text: 'Коли користувач натискає кнопку зупинки під час активного розпізнавання',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'мовлення і одночасно виконується запит до віддаленої моделі',
        durationMs: 5000,
        gapBeforeMs: 50,
        isForcedSplit: true
      },
      {
        text: 'як гарантується що запізніла відповідь не потрапить у стан сесії?',
        durationMs: 3000,
        gapBeforeMs: 50,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'long_split_question',
    source: 'system',
    language: 'uk',
    segments: [
      {
        text: 'Чому при обробці довгих речень які тривають понад п’ять секунд',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'важливо об’єднувати окремі фрагменти транскрипції перед тим як',
        durationMs: 5000,
        gapBeforeMs: 30,
        isForcedSplit: true
      },
      {
        text: 'передавати їх у класифікатор намірів користувача',
        durationMs: 2800,
        gapBeforeMs: 30,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'long_split_question',
    source: 'mic',
    language: 'uk',
    segments: [
      {
        text: 'Підкажи як правильно налаштувати обмеження черги аудіо вікон',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'щоб під час пікового навантаження інтерфейс залишався чутливим',
        durationMs: 4200,
        gapBeforeMs: 40,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'help_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'long_split_question',
    source: 'mic',
    language: 'en',
    segments: [
      {
        text: 'Could you explain how the speech window assembler and the semantic',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'utterance assembler work together when a speaker talks continuously',
        durationMs: 5000,
        gapBeforeMs: 40,
        isForcedSplit: true
      },
      {
        text: 'for more than ten seconds without a long pause?',
        durationMs: 2600,
        gapBeforeMs: 40,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'explanation_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'long_split_question',
    source: 'system',
    language: 'en',
    segments: [
      {
        text: 'If two distinct questions are asked within a single second while',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'the debounce timer for the first question is still active',
        durationMs: 5000,
        gapBeforeMs: 40,
        isForcedSplit: true
      },
      {
        text: 'how does the pending candidate queue ensure neither question is lost?',
        durationMs: 3100,
        gapBeforeMs: 40,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'long_split_question',
    source: 'mic',
    language: 'en',
    segments: [
      {
        text: 'What happens to the in-memory conversation context and pending',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'timers when the user clicks the stop button mid-session',
        durationMs: 3500,
        gapBeforeMs: 40,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'long_split_question',
    source: 'mic',
    language: 'mixed',
    segments: [
      {
        text: 'Як саме OpenRouterIntentClassifier перевіряє відповідь від моделі',
        durationMs: 5000,
        isForcedSplit: true
      },
      {
        text: 'за допомогою strict Zod schema та захищається від prompt injection',
        durationMs: 4000,
        gapBeforeMs: 40,
        isForcedSplit: false
      }
    ],
    expectedIntent: 'direct_question',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isDirectQuestion: true
  },

  // 11. Short contextual follow-ups (8)
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'uk',
    priorTurns: [
      {
        source: 'mic',
        text: 'Поясни як працює перший варіант кешування у пам’яті.',
        language: 'uk',
        intent: 'explanation_request',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'А цей варіант?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'uk',
    priorTurns: [
      {
        source: 'mic',
        text: 'Що буде якщо передати синхронний колбек у функцію?',
        language: 'uk',
        intent: 'direct_question',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'А якщо навпаки?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'uk',
    priorTurns: [
      {
        source: 'system',
        text: 'Коли ліміт запитів вичерпується, сервер повертає помилку.',
        language: 'uk',
        intent: 'statement',
        decision: 'ignore'
      },
      {
        source: 'mic',
        text: 'Як система реагує на помилку чотириста два?',
        language: 'uk',
        intent: 'direct_question',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'І що тоді?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'uk',
    priorTurns: [
      {
        source: 'mic',
        text: 'Як налаштувати збірку для стандартного оточення?',
        language: 'uk',
        intent: 'direct_question',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'А в моєму випадку?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'en',
    priorTurns: [
      {
        source: 'mic',
        text: 'Can you explain the first indexing strategy for this table?',
        language: 'en',
        intent: 'explanation_request',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'What about the second approach?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'en',
    priorTurns: [
      {
        source: 'mic',
        text: 'How does the latest version handle schema migrations?',
        language: 'en',
        intent: 'direct_question',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'And the previous one?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'en',
    priorTurns: [
      {
        source: 'mic',
        text: 'We used a WeakMap to cache object metadata in the browser.',
        language: 'en',
        intent: 'statement',
        decision: 'ignore'
      },
      {
        source: 'mic',
        text: 'How does WeakMap prevent memory leaks in DOM nodes?',
        language: 'en',
        intent: 'direct_question',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'Would that work here?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },
  {
    category: 'contextual_follow_up',
    source: 'mic',
    language: 'en',
    priorTurns: [
      {
        source: 'mic',
        text: 'How fast is the lookup for a sorted array?',
        language: 'en',
        intent: 'direct_question',
        decision: 'ready'
      }
    ],
    segments: [{ text: 'What about for a linked list?' }],
    expectedIntent: 'contextual_follow_up',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isContextualFollowUp: true
  },

  // 12. Ordinary statements (8)
  {
    category: 'ordinary_statement',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Я вже оновив залежності та запустив локальну збірку проєкту.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'ordinary_statement',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Цей модуль відповідає за збереження конфігурації на диску.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'ordinary_statement',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Усі модульні тести пройшли успішно без жодної помилки.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'ordinary_statement',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Далі ми перейдемо до налаштування прав доступу для таблиць.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'ordinary_statement',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'I have pushed the feature branch and opened a pull request.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'ordinary_statement',
    source: 'system',
    language: 'en',
    segments: [{ text: 'The application uses SQLite with full-text search enabled.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'ordinary_statement',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'We decided to keep the state management simple and local.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'ordinary_statement',
    source: 'system',
    language: 'en',
    segments: [{ text: 'All temporary audio files are deleted immediately after transcription.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },

  // 13. Statements beginning with question words (8)
  {
    category: 'statement_with_question_word',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Як ми бачимо на діаграмі, черга працює за принципом FIFO.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'statement_with_question_word',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Коли система стартує, вона автоматично перевіряє наявність моделі.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'statement_with_question_word',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Як я вже казав раніше, цей метод не змінює вхідний масив.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'statement_with_question_word',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Що важливо зазначити, усі секретні ключі залишаються в головному процесі.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'statement_with_question_word',
    source: 'system',
    language: 'en',
    segments: [{ text: 'When the server starts, it loads the configuration from disk.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'statement_with_question_word',
    source: 'system',
    language: 'en',
    segments: [{ text: 'As we can see in the logs, the request completed in ten milliseconds.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'statement_with_question_word',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'What I meant earlier is that the buffer size is strictly bounded.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'statement_with_question_word',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Where this pattern really shines is in decoupled testing.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },

  // 14. Reported speech (8)
  {
    category: 'reported_speech',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Він спитав, коли буде реліз нової версії.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'reported_speech',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Вчора клієнт запитав, чому звіт генерується так довго.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'reported_speech',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Колега поцікавився, як ми тестуємо обробку помилок.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'reported_speech',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Менеджер питав, скільки часу займе міграція бази даних.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'reported_speech',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'They asked how we handle authentication in the desktop app.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'reported_speech',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'She asked why the build failed on the integration server.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'reported_speech',
    source: 'system',
    language: 'en',
    segments: [{ text: 'The reviewer wondered whether we had benchmarked the memory usage.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'reported_speech',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'He was asking when the next deployment window starts.' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },

  // 15. Quotations (8)
  {
    category: 'quotation',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'У презентації написано: «Що таке штучний інтелект?»' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'quotation',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'На слайді написано: «Як забезпечити надійність розподіленої системи?»' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'quotation',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'У документації сказано: «Коли варто використовувати транзакції?»' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'quotation',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Термінал виводить повідомлення: «Чи бажаєте ви продовжити встановлення?»' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'quotation',
    source: 'system',
    language: 'en',
    segments: [{ text: 'In the documentation it says "How to configure your environment?"' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'quotation',
    source: 'system',
    language: 'en',
    segments: [{ text: 'On the slide it reads "What is a microservice architecture?"' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'quotation',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'The prompt asks "Are you sure you want to delete this file?"' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },
  {
    category: 'quotation',
    source: 'system',
    language: 'en',
    segments: [{ text: 'The book chapter is titled "Why do software projects fail?"' }],
    expectedIntent: 'reported_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false,
    isReportedSpeech: true
  },

  // 16. Rhetorical remarks (8)
  {
    category: 'rhetorical_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Ну хіба так можна писати продакшн код?' }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'rhetorical_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'І кому взагалі потрібна така складна конфігурація?' }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'rhetorical_question',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Та скільки ж можна виправляти один і той самий баг?' }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'rhetorical_question',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Хто ж не любить розбирати чужий легасі код у п’ятницю ввечері?' }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'rhetorical_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: "Who doesn't love debugging race conditions at midnight?" }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'rhetorical_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Why on earth would anyone hardcode credentials in a repository?' }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'rhetorical_question',
    source: 'system',
    language: 'en',
    segments: [{ text: 'How hard can it really be to center a div?' }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'rhetorical_question',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'What could possibly go wrong with deploying on a Friday?' }],
    expectedIntent: 'rhetorical_question',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },

  // 17. Greetings and filler phrases (8)
  {
    category: 'greeting_or_filler',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Привіт усім, дякую що приєдналися.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'greeting_or_filler',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Так, добре, зрозуміло, дякую.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'greeting_or_filler',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Угу, окей, гаразд.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'greeting_or_filler',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Раз раз, як мене чути, перевірка зв’язку.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'greeting_or_filler',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Hello everyone, thanks for joining the call.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'greeting_or_filler',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Yeah, okay, got it, thank you.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'greeting_or_filler',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Can you hear me okay? Mic check one two.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'greeting_or_filler',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Um, well, let me share my screen first.' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },

  // 18. Incomplete STT fragments (8)
  {
    category: 'incomplete_fragment',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Що' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'incomplete_fragment',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Ну і коли ми...' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'incomplete_fragment',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Як то кажуть в...' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'incomplete_fragment',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'А якщо' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'incomplete_fragment',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'What' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'incomplete_fragment',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'And when the...' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'incomplete_fragment',
    source: 'system',
    language: 'en',
    segments: [{ text: 'How to' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'incomplete_fragment',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'Why is' }],
    expectedIntent: 'other',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },

  // 19. Classroom / lecture speech (8)
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Сьогодні на лекції ми розглянемо питання масштабування реляційних баз даних.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Перше питання яке ми обговоримо стосується нормалізації таблиць.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Тепер подивіться на третій слайд де показано графік затримки.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'uk',
    segments: [{ text: 'Скажіть, студенти, хто з вас уже працював із контейнерами Docker?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isDirectQuestion: true
  },
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'en',
    segments: [{ text: 'In today lecture we will explore the question of distributed consensus.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'en',
    segments: [{ text: 'The next question on the exam covers binary search trees.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Let us now turn to chapter four and examine the memory model.' }],
    expectedIntent: 'statement',
    expectedDecision: 'ignore',
    isPositiveActionable: false
  },
  {
    category: 'classroom_lecture',
    source: 'system',
    language: 'en',
    segments: [{ text: 'Class, can anyone in the room tell me what ACID stands for?' }],
    expectedIntent: 'direct_question',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isDirectQuestion: true
  },

  // 20. Ambiguous borderline cases (8)
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Я вже годину дивлюся на цей код і не розумію, де помилка.' }],
    expectedIntent: 'help_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Не впевнений, що цей підхід правильний.' }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Тобто це означає, що кеш не інвалідується після оновлення?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'uk',
    segments: [{ text: 'Можливо варто перевірити ще один варіант конфігурації?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'en',
    segments: [{ text: "I'm not sure this approach is correct." }],
    expectedIntent: 'indirect_question',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'en',
    segments: [{ text: "I've been staring at this code for an hour and don't understand where the bug is." }],
    expectedIntent: 'help_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'So does that mean the transaction rolls back automatically?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'suggest',
    isPositiveActionable: true,
    isIndirectRequest: true
  },
  {
    category: 'ambiguous_borderline',
    source: 'mic',
    language: 'en',
    segments: [{ text: 'We only need to validate the token once per session?' }],
    expectedIntent: 'clarification_request',
    expectedDecision: 'ready',
    isPositiveActionable: true,
    isIndirectRequest: true
  }
]

/**
 * Complete 160-example evaluation dataset split deterministically into
 * 80 'dev' examples (even indices per category) and 80 'held_out' examples (odd indices per category).
 */
export const INTENT_EVALUATION_DATASET: readonly BenchmarkExample[] = RAW_EXAMPLES.map(
  (example, idx) => ({
    ...example,
    id: `eval-${String(idx + 1).padStart(3, '0')}`,
    partition: idx % 2 === 0 ? 'dev' : 'held_out'
  })
)

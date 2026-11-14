import { describe, it, expect } from 'vitest'
import {
  UtteranceAssembler,
  mergeFragmentTextsWithOverlapDedup
} from '@/main/transcription/utterance-assembler'
import type { TranscriptSegment } from '@/shared/contracts/transcription'

function makeSegment(
  overrides: Partial<TranscriptSegment> & { text: string; startTimestamp: number; endTimestamp: number }
): TranscriptSegment {
  return {
    id: overrides.id ?? `seg-${overrides.startTimestamp}`,
    source: overrides.source ?? 'mic',
    startTimestamp: overrides.startTimestamp,
    endTimestamp: overrides.endTimestamp,
    text: overrides.text,
    language: overrides.language,
    confidence: overrides.confidence ?? 0.9,
    isFinal: overrides.isFinal ?? true,
    isForcedSplit: overrides.isForcedSplit
  }
}

describe('UtteranceAssembler — Context-Safe Semantic Utterance Assembly', () => {
  it('1. assembles one long question (> 5s) split across three STT segments into a single semantic utterance', () => {
    const assembler = new UtteranceAssembler({
      silenceBoundaryMs: 900,
      continuationSilenceMs: 2000
    })

    // Segment 1: 0s - 5s (forced split at 5000ms window boundary)
    const emitted1 = assembler.ingestSegment(
      makeSegment({
        id: 'seg-1',
        source: 'mic',
        startTimestamp: 1000,
        endTimestamp: 6000,
        text: 'Підкажіть будь ласка чому коли ми запускаємо локальну збірку в',
        isForcedSplit: true
      })
    )
    expect(emitted1).toHaveLength(0)

    // Segment 2: 5s - 10s (forced split at 5000ms window boundary)
    const emitted2 = assembler.ingestSegment(
      makeSegment({
        id: 'seg-2',
        source: 'mic',
        startTimestamp: 6100,
        endTimestamp: 11100,
        text: 'режимі розробки для двомоніторної конфігурації у нас виникає',
        isForcedSplit: true
      })
    )
    expect(emitted2).toHaveLength(0)

    // Segment 3: 10s - 13s (natural completion with mixed English technical phrase)
    const emitted3 = assembler.ingestSegment(
      makeSegment({
        id: 'seg-3',
        source: 'mic',
        startTimestamp: 11200,
        endTimestamp: 14000,
        text: 'помилка ізоляції контексту в preload bundle скрипті',
        isForcedSplit: false
      })
    )
    expect(emitted3).toHaveLength(0)

    // Silence settles after 14000 + 950ms
    const finalized = assembler.flushReady(15000)
    expect(finalized).toHaveLength(1)

    const utt = finalized[0]
    expect(utt.source).toBe('mic')
    expect(utt.startTimestamp).toBe(1000)
    expect(utt.endTimestamp).toBe(14000)
    expect(utt.fragmentCount).toBe(3)
    expect(utt.segmentIds).toEqual(['seg-1', 'seg-2', 'seg-3'])
    expect(utt.language).toBe('mixed')
    expect(utt.text).toBe(
      'Підкажіть будь ласка чому коли ми запускаємо локальну збірку в режимі розробки для двомоніторної конфігурації у нас виникає помилка ізоляції контексту в preload bundle скрипті'
    )
  })

  it('2. separates two consecutive independent questions without merging them into one', () => {
    const assembler = new UtteranceAssembler({
      silenceBoundaryMs: 900
    })

    // Case A: Two consecutive segments that are independent questions
    const e1 = assembler.ingestSegment(
      makeSegment({
        id: 'seg-q1',
        source: 'mic',
        startTimestamp: 1000,
        endTimestamp: 3500,
        text: 'Чому цей метод повертає порожній масив'
      })
    )
    expect(e1).toHaveLength(0)

    // Second distinct question arrives 400ms later (within silenceBoundaryMs, but syntactically a new question)
    const e2 = assembler.ingestSegment(
      makeSegment({
        id: 'seg-q2',
        source: 'mic',
        startTimestamp: 3900,
        endTimestamp: 6500,
        text: 'А де знаходиться конфігурація бази даних'
      })
    )

    // First question is immediately finalized upon detecting the second independent question
    expect(e2).toHaveLength(1)
    expect(e2[0].text).toBe('Чому цей метод повертає порожній масив')
    expect(e2[0].flushReason).toBe('sentence_boundary')

    const rest = assembler.flushReady(7500)
    expect(rest).toHaveLength(1)
    expect(rest[0].text).toBe('А де знаходиться конфігурація бази даних')

    // Case B: Single STT segment containing two distinct questions with question marks
    const e3 = assembler.ingestSegment(
      makeSegment({
        id: 'seg-both',
        source: 'system',
        startTimestamp: 10000,
        endTimestamp: 14000,
        text: 'Why does the build fail here? Can you check the compiler options?'
      })
    )
    const restB = assembler.flushAll()
    const allB = [...e3, ...restB]
    expect(allB).toHaveLength(2)
    expect(allB[0].text).toBe('Why does the build fail here?')
    expect(allB[1].text).toBe('Can you check the compiler options?')
  })

  it('3. preserves speech with brief internal pauses when first clause is incomplete or setup statement', () => {
    const assembler = new UtteranceAssembler({
      silenceBoundaryMs: 900,
      continuationSilenceMs: 2000
    })

    // First fragment ends with continuation conjunction "тому що" and a 1200ms pause
    assembler.ingestSegment(
      makeSegment({
        id: 'seg-p1',
        source: 'mic',
        startTimestamp: 1000,
        endTimestamp: 3000,
        text: 'Чи потрібно нам змінювати цей інтерфейс тому що'
      })
    )

    // 1300ms pause (> 900ms standard, but <= 2000ms continuationSilenceMs because of trailing "тому що")
    const midFlush = assembler.flushReady(4300)
    expect(midFlush).toHaveLength(0)

    assembler.ingestSegment(
      makeSegment({
        id: 'seg-p2',
        source: 'mic',
        startTimestamp: 4300,
        endTimestamp: 6500,
        text: 'старі тести використовують інший формат'
      })
    )

    const finalFlush = assembler.flushReady(7600)
    expect(finalFlush).toHaveLength(1)
    expect(finalFlush[0].text).toBe(
      'Чи потрібно нам змінювати цей інтерфейс тому що старі тести використовують інший формат'
    )
  })

  it('4. emits short contextual follow-up after an earlier discussion settles', () => {
    const assembler = new UtteranceAssembler({ silenceBoundaryMs: 800 })

    assembler.ingestSegment(
      makeSegment({
        id: 'seg-disc-1',
        source: 'system',
        startTimestamp: 1000,
        endTimestamp: 4000,
        text: 'Перший підхід використовує рекурсивний обхід дерева.'
      })
    )
    const first = assembler.flushReady(5000)
    expect(first).toHaveLength(1)

    // Short follow-up 2 seconds later
    assembler.ingestSegment(
      makeSegment({
        id: 'seg-followup',
        source: 'mic',
        startTimestamp: 6000,
        endTimestamp: 7200,
        text: 'А якщо навпаки'
      })
    )
    const second = assembler.flushReady(8100)
    expect(second).toHaveLength(1)
    expect(second[0].text).toBe('А якщо навпаки')
    expect(second[0].source).toBe('mic')
  })

  it('5. ignores silence artifacts and empty/punctuation-only fragments', () => {
    const assembler = new UtteranceAssembler()

    expect(
      assembler.ingestSegment(
        makeSegment({ startTimestamp: 100, endTimestamp: 500, text: '   ' })
      )
    ).toHaveLength(0)
    expect(
      assembler.ingestSegment(
        makeSegment({ startTimestamp: 600, endTimestamp: 1000, text: '[BLANK_AUDIO]' })
      )
    ).toHaveLength(0)
    expect(
      assembler.ingestSegment(
        makeSegment({ startTimestamp: 1100, endTimestamp: 1500, text: '...' })
      )
    ).toHaveLength(0)
    expect(assembler.hasPending()).toBe(false)
  })

  it('6. isolates MIC and SYSTEM sources so concurrent/alternating speakers never merge', () => {
    const assembler = new UtteranceAssembler({ silenceBoundaryMs: 1000 })

    assembler.ingestSegment(
      makeSegment({
        id: 'sys-1',
        source: 'system',
        startTimestamp: 1000,
        endTimestamp: 3000,
        text: 'Лектор пояснює теорему Байєса'
      })
    )

    assembler.ingestSegment(
      makeSegment({
        id: 'mic-1',
        source: 'mic',
        startTimestamp: 1500,
        endTimestamp: 3200,
        text: 'Як застосувати цю формулу на практиці'
      })
    )

    const flushed = assembler.flushAll()
    expect(flushed).toHaveLength(2)

    const sysUtt = flushed.find((u) => u.source === 'system')!
    const micUtt = flushed.find((u) => u.source === 'mic')!
    expect(sysUtt.text).toBe('Лектор пояснює теорему Байєса')
    expect(micUtt.text).toBe('Як застосувати цю формулу на практиці')
  })

  it('7. discards unfinished utterance cleanly on reset() during Pause/Stop', () => {
    const assembler = new UtteranceAssembler()

    assembler.ingestSegment(
      makeSegment({
        id: 'unfinished-1',
        source: 'mic',
        startTimestamp: 1000,
        endTimestamp: 4000,
        text: 'Я хотів запитати про',
        isForcedSplit: true
      })
    )
    expect(assembler.hasPending('mic')).toBe(true)

    assembler.reset()
    expect(assembler.hasPending()).toBe(false)
    expect(assembler.flushAll()).toHaveLength(0)
  })

  it('8. deduplicates repeated overlapping STT fragments at window boundaries', () => {
    expect(
      mergeFragmentTextsWithOverlapDedup(
        'Скажіть будь ласка чому цей код',
        'чому цей код не працює в продакшені'
      )
    ).toBe('Скажіть будь ласка чому цей код не працює в продакшені')

    expect(
      mergeFragmentTextsWithOverlapDedup(
        'How does the event loop handle',
        'How does the event loop handle microtasks in Node'
      )
    ).toBe('How does the event loop handle microtasks in Node')

    const assembler = new UtteranceAssembler({ silenceBoundaryMs: 1000 })
    assembler.ingestSegment(
      makeSegment({
        id: 'ov-1',
        source: 'mic',
        startTimestamp: 1000,
        endTimestamp: 5000,
        text: 'Поясніть будь ласка як працює цей алгоритм',
        isForcedSplit: true
      })
    )
    assembler.ingestSegment(
      makeSegment({
        id: 'ov-2',
        source: 'mic',
        startTimestamp: 4800,
        endTimestamp: 7500,
        text: 'як працює цей алгоритм при великих масивах даних'
      })
    )

    const flushed = assembler.flushAll()
    expect(flushed).toHaveLength(1)
    expect(flushed[0].text).toBe(
      'Поясніть будь ласка як працює цей алгоритм при великих масивах даних'
    )
  })

  it('9. prevents indefinite accumulation during continuous lectures by enforcing maxFragments and maxUtteranceDurationMs', () => {
    const assembler = new UtteranceAssembler({
      silenceBoundaryMs: 1000,
      maxFragments: 3,
      maxUtteranceDurationMs: 12000
    })

    const e1 = assembler.ingestSegment(
      makeSegment({
        id: 'lec-1',
        source: 'system',
        startTimestamp: 0,
        endTimestamp: 4000,
        text: 'Сьогодні ми розглядаємо архітектуру операційних систем і керування пам’яттю',
        isForcedSplit: true
      })
    )
    expect(e1).toHaveLength(0)

    const e2 = assembler.ingestSegment(
      makeSegment({
        id: 'lec-2',
        source: 'system',
        startTimestamp: 4000,
        endTimestamp: 8000,
        text: 'зокрема віртуальні адресні простори та таблиці сторінок процесора',
        isForcedSplit: true
      })
    )
    expect(e2).toHaveLength(0)

    const e3 = assembler.ingestSegment(
      makeSegment({
        id: 'lec-3',
        source: 'system',
        startTimestamp: 8000,
        endTimestamp: 12000,
        text: 'які дозволяють ізолювати процеси один від одного',
        isForcedSplit: true
      })
    )

    // Reached maxUtteranceDurationMs (12000ms) / maxFragments (3) -> automatically flushed!
    expect(e3).toHaveLength(1)
    expect(e3[0].flushReason).toBe('max_duration')
    expect(e3[0].fragmentCount).toBe(3)
    expect(assembler.hasPending('system')).toBe(false)
  })
})

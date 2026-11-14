import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QuestionControls } from '@/main/transcription/question-controls'
import type { QuestionCandidate } from '@/shared/contracts/questions'

describe('QuestionControls — Debounce, Confidence, Cooldown, and Cancellation', () => {
  let currentTime = 1000000

  const createCandidate = (overrides: Partial<QuestionCandidate> = {}): QuestionCandidate => ({
    id: `q-${Math.random().toString(36).substring(2, 7)}`,
    segmentId: 'seg-1',
    source: 'mic',
    timestamp: currentTime,
    text: 'Що таке квантовий комп’ютер?',
    language: 'uk',
    confidence: 0.9,
    status: 'detected',
    ...overrides
  })

  beforeEach(() => {
    currentTime = 1000000
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes text stripping punctuation, whitespace, and case', () => {
    const controls = new QuestionControls()
    const raw = '  «Що, таке... КВАНТОВИЙ комп’ютер?!»  '
    expect(controls.normalizeText(raw)).toBe('що таке квантовий компютер')
  })

  it('rejects candidate if confidence is below minConfidence threshold', () => {
    const controls = new QuestionControls({ minConfidence: 0.8 })
    const candidate = createCandidate({ confidence: 0.7 })

    const res = controls.filterCandidate(candidate)
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('low_confidence')
    expect(res.candidate.status).toBe('filtered')
  })

  it('accepts candidate if confidence meets minConfidence threshold', () => {
    const controls = new QuestionControls({ minConfidence: 0.8 })
    const candidate = createCandidate({ confidence: 0.85 })

    const res = controls.filterCandidate(candidate)
    expect(res.accepted).toBe(true)
    expect(res.candidate.status).toBe('detected')
  })

  it('filters duplicate question within cooldown window on same source', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      cooldownMs: 5000,
      debounceMs: 0,
      clock
    })

    const onReady = vi.fn()
    const onFiltered = vi.fn()

    const q1 = createCandidate({ text: 'What is Antigravity?' })
    controls.submitCandidate(q1, onReady, onFiltered)

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'What is Antigravity?', status: 'ready' })
    )

    // Submit identical question 2 seconds later (within 5s cooldown)
    currentTime += 2000
    const q2 = createCandidate({ text: 'what is antigravity?!' })
    controls.submitCandidate(q2, onReady, onFiltered)

    expect(onReady).toHaveBeenCalledTimes(1) // Still 1
    expect(onFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'filtered' }),
      'cooldown_active'
    )
  })

  it('filters duplicate question across different sources within cooldown window', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      cooldownMs: 5000,
      debounceMs: 0,
      clock
    })

    const onReady = vi.fn()
    const onFiltered = vi.fn()

    const micQ = createCandidate({ source: 'mic', text: 'Чому це працює?' })
    controls.submitCandidate(micQ, onReady, onFiltered)
    expect(onReady).toHaveBeenCalledTimes(1)

    // Same question captured on system loopback 1s later
    currentTime += 1000
    const sysQ = createCandidate({ source: 'system', text: 'Чому це працює?' })
    controls.submitCandidate(sysQ, onReady, onFiltered)

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'filtered' }),
      'cross_source_duplicate'
    )
  })

  it('allows identical question after cooldown expires', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      cooldownMs: 5000,
      debounceMs: 0,
      clock
    })

    const onReady = vi.fn()

    const q1 = createCandidate({ text: 'What is the capital of Ukraine?' })
    controls.submitCandidate(q1, onReady)
    expect(onReady).toHaveBeenCalledTimes(1)

    // Advance beyond cooldown (5001ms)
    currentTime += 5001
    const q2 = createCandidate({ text: 'What is the capital of Ukraine?' })
    controls.submitCandidate(q2, onReady)

    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('debounces candidate and emits ready status only after debounceMs settles', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 1000,
      clock
    })

    const onReady = vi.fn()
    const q = createCandidate({ text: 'Is this debounced?' })

    controls.submitCandidate(q, onReady)
    expect(onReady).not.toHaveBeenCalled()
    expect(controls.hasPending()).toBe(true)

    // Advance 500ms - still not emitted
    vi.advanceTimersByTime(500)
    expect(onReady).not.toHaveBeenCalled()

    // Advance remaining 500ms
    vi.advanceTimersByTime(500)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Is this debounced?', status: 'ready' })
    )
    expect(controls.hasPending()).toBe(false)
  })

  it('resets debounce window when newer candidate arrives before timer fires', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 1000,
      clock
    })

    const onReady = vi.fn()
    const q1 = createCandidate({ text: 'Що таке' })
    const q2 = createCandidate({ text: 'Що таке штучний інтелект?' })

    controls.submitCandidate(q1, onReady)
    vi.advanceTimersByTime(600)
    expect(onReady).not.toHaveBeenCalled()

    // q2 arrives replacing q1
    controls.submitCandidate(q2, onReady)
    vi.advanceTimersByTime(600)
    expect(onReady).not.toHaveBeenCalled()

    // Advance remaining 400ms for q2
    vi.advanceTimersByTime(400)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Що таке штучний інтелект?', status: 'ready' })
    )
  })

  it('cancel() discards pending candidate and prevents late emission on stop/pause', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 1000,
      clock
    })

    const onReady = vi.fn()
    const q = createCandidate({ text: 'Will this be cancelled?' })

    controls.submitCandidate(q, onReady)
    expect(controls.hasPending()).toBe(true)

    // Stop/pause called
    controls.cancel()
    expect(controls.hasPending()).toBe(false)

    // Advance timers well beyond debounce window
    vi.advanceTimersByTime(2000)
    expect(onReady).not.toHaveBeenCalled()
  })

  it('reset() cancels pending candidate and clears cooldown history', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 0,
      cooldownMs: 5000,
      clock
    })

    const onReady = vi.fn()
    const q = createCandidate({ text: 'Reset test question' })

    controls.submitCandidate(q, onReady)
    expect(controls.getHistorySize()).toBe(1)

    controls.reset()
    expect(controls.getHistorySize()).toBe(0)
    expect(controls.hasPending()).toBe(false)

    // Same question can now be immediately submitted again
    controls.submitCandidate(q, onReady)
    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('caps history size to maxHistory', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 0,
      cooldownMs: 100000,
      maxHistory: 3,
      clock
    })

    const onReady = vi.fn()
    controls.submitCandidate(createCandidate({ text: 'Q1' }), onReady)
    controls.submitCandidate(createCandidate({ text: 'Q2' }), onReady)
    controls.submitCandidate(createCandidate({ text: 'Q3' }), onReady)
    expect(controls.getHistorySize()).toBe(3)

    controls.submitCandidate(createCandidate({ text: 'Q4' }), onReady)
    expect(controls.getHistorySize()).toBe(3)
  })

  it('rejects cross-source duplicate while original candidate is pending in debounce', () => {
    vi.useFakeTimers()
    try {
      const clock = () => currentTime
      const controls = new QuestionControls({
        debounceMs: 1000,
        clock
      })

      const onReady = vi.fn()
      const onFiltered = vi.fn()

      const qSystem = createCandidate({
        source: 'system',
        text: 'What does this function do?'
      })
      const qMic = createCandidate({
        source: 'mic',
        text: 'What does this function do?'
      })

      controls.submitCandidate(qSystem, onReady, onFiltered)
      expect(controls.hasPending()).toBe(true)

      // Cross-source duplicate arrives while qSystem is debouncing
      currentTime += 200
      controls.submitCandidate(qMic, onReady, onFiltered)

      expect(onFiltered).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'filtered' }),
        'cross_source_duplicate'
      )

      // Advance timer past debounce delay: only the original system candidate emits
      vi.advanceTimersByTime(1000)

      expect(onReady).toHaveBeenCalledTimes(1)
      expect(onReady).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'system', text: 'What does this function do?' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves two genuinely distinct questions asked in quick succession without overwriting the first', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 1000,
      clock
    })

    const onReady = vi.fn()
    const q1 = createCandidate({
      id: 'q-1',
      text: 'Чому не працює цикл подій у Node.js?'
    })
    const q2 = createCandidate({
      id: 'q-2',
      text: 'І де налаштувати ліміт пам’яті для процесу?'
    })

    controls.submitCandidate(q1, onReady)
    vi.advanceTimersByTime(300)
    currentTime += 300

    // Second distinct question arrives while q1 is still debouncing
    controls.submitCandidate(q2, onReady)
    expect(controls.getPendingCount()).toBe(2)

    // After 700ms more, q1 settles and emits while q2 is still pending
    vi.advanceTimersByTime(700)
    currentTime += 700
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'q-1', text: 'Чому не працює цикл подій у Node.js?' })
    )
    expect(controls.getPendingCount()).toBe(1)

    // After remaining 300ms, q2 settles and emits
    vi.advanceTimersByTime(300)
    currentTime += 300
    expect(onReady).toHaveBeenCalledTimes(2)
    expect(onReady).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'q-2', text: 'І де налаштувати ліміт пам’яті для процесу?' })
    )
    expect(controls.hasPending()).toBe(false)
  })

  it('does not overwrite distinct questions that share a polite or interrogative opening prefix', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 1000,
      clock
    })

    const onReady = vi.fn()
    const q1 = createCandidate({
      id: 'q-closures',
      text: 'Can you explain closures?',
      language: 'en'
    })
    const q2 = createCandidate({
      id: 'q-promises',
      text: 'Can you explain promises?',
      language: 'en'
    })
    const q3 = createCandidate({
      id: 'q-uk-1',
      text: 'Можеш будь ласка пояснити замикання?'
    })
    const q4 = createCandidate({
      id: 'q-uk-2',
      text: 'Можеш будь ласка пояснити проміси?'
    })

    controls.submitCandidate(q1, onReady)
    controls.submitCandidate(q2, onReady)
    controls.submitCandidate(q3, onReady)
    controls.submitCandidate(q4, onReady)

    expect(controls.getPendingCount()).toBe(4)

    vi.advanceTimersByTime(1000)
    currentTime += 1000

    expect(onReady).toHaveBeenCalledTimes(4)
    expect(onReady.mock.calls.map((c) => c[0].id)).toEqual([
      'q-closures',
      'q-promises',
      'q-uk-1',
      'q-uk-2'
    ])
  })

  it('treats mid-word STT prefix revision as a continuation of the same question', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 1000,
      clock
    })

    const onReady = vi.fn()
    const partial = createCandidate({
      id: 'q-part',
      text: 'Що таке штуч'
    })
    const expanded = createCandidate({
      id: 'q-full',
      text: 'Що таке штучний інтелект?'
    })

    controls.submitCandidate(partial, onReady)
    expect(controls.getPendingCount()).toBe(1)

    vi.advanceTimersByTime(400)
    controls.submitCandidate(expanded, onReady)
    expect(controls.getPendingCount()).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q-full', text: 'Що таке штучний інтелект?' })
    )
  })

  it('enforces bounded pending queue with explicit queue_overflow diagnostics', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      debounceMs: 1000,
      maxPendingCandidates: 2,
      clock
    })

    const onReady = vi.fn()
    const onFiltered = vi.fn()

    controls.submitCandidate(
      createCandidate({ id: 'q-1', text: 'Як працює віртуальний DOM у React?' }),
      onReady,
      onFiltered
    )
    controls.submitCandidate(
      createCandidate({ id: 'q-2', text: 'Куди зберігається кеш бази даних SQLite?' }),
      onReady,
      onFiltered
    )
    expect(controls.getPendingCount()).toBe(2)

    // Third distinct candidate exceeds maxPendingCandidates=2
    controls.submitCandidate(
      createCandidate({ id: 'q-3', text: 'Коли оновлюється токен авторизації сесії?' }),
      onReady,
      onFiltered
    )

    expect(controls.getPendingCount()).toBe(2)
    expect(controls.getDroppedCount()).toBe(1)
    expect(controls.getLastDropReason()).toBe('queue_overflow')
    expect(onFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q-3', status: 'filtered' }),
      'queue_overflow'
    )
  })

  it('accepts suggest candidates above minSuggestConfidence and preserves suggest status on emission', () => {
    const clock = () => currentTime
    const controls = new QuestionControls({
      minConfidence: 0.75,
      minSuggestConfidence: 0.5,
      debounceMs: 200,
      clock
    })

    const onReady = vi.fn()
    const suggestCandidate = createCandidate({
      id: 'q-suggest',
      text: 'Цікаво, чи можна це спростити.',
      confidence: 0.62,
      decision: 'suggest',
      status: 'suggest'
    })

    controls.submitCandidate(suggestCandidate, onReady)
    vi.advanceTimersByTime(200)

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'q-suggest',
        status: 'suggest',
        decision: 'suggest'
      })
    )
  })
})

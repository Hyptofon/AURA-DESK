import { describe, it, expect, vi } from 'vitest'
import { TranscriptionPipeline } from '@/main/transcription/transcription-pipeline'
import { FakeSttProvider } from '@/main/transcription/fake-stt-provider'
import { FakeIntentClassifier } from '@/main/transcription/intent-classifier'
import type { AudioChunk } from '@/shared/contracts/audio'
import type { QuestionCandidate } from '@/shared/contracts/questions'

describe('TranscriptionPipeline', () => {
  function makeChunk(
    source: 'mic' | 'system',
    timestamp: number,
    durationMs: number,
    isSpeech: boolean
  ): AudioChunk {
    const sampleCount = Math.floor((durationMs / 1000) * 16000)
    return {
      id: `chunk-${timestamp}`,
      source,
      timestamp,
      durationMs,
      sampleRate: 16000,
      channels: 1,
      data: new Uint8Array(sampleCount * 2),
      rms: isSpeech ? 0.05 : 0.001,
      isSpeech
    }
  }

  it('assembles speech window, transcribes via provider, and emits question candidate', async () => {
    const fakeProvider = new FakeSttProvider({
      defaultText: 'Що таке алгоритм сортування?'
    })
    const pipeline = new TranscriptionPipeline({
      provider: fakeProvider,
      windowOptions: { minSpeechDurationMs: 300, silenceHangoverMs: 200 },
      controlsOptions: { debounceMs: 0 }
    })

    const emittedQuestions: QuestionCandidate[] = []
    pipeline.onQuestionDetected((q) => emittedQuestions.push(q))

    // Ingest 400ms speech + 200ms silence
    for (let i = 0; i < 4; i++) {
      await pipeline.ingestChunk(makeChunk('mic', 1000 + i * 100, 100, true))
    }
    await pipeline.ingestChunk(makeChunk('mic', 1400, 100, false))
    await pipeline.ingestChunk(makeChunk('mic', 1500, 100, false)) // Triggers window

    const state = pipeline.getState()
    expect(state.segmentCount).toBe(1)
    expect(state.latestSegment?.text).toBe('Що таке алгоритм сортування?')
    expect(state.latestSegment?.source).toBe('mic')
    expect(state.latestSegment?.startTimestamp).toBe(1000)

    expect(state.questionCount).toBe(1)
    expect(state.latestQuestion?.text).toBe('Що таке алгоритм сортування?')
    expect(state.latestQuestion?.language).toBe('uk')
    expect(state.latestQuestion?.status).toBe('ready')

    expect(emittedQuestions).toHaveLength(1)
    expect(emittedQuestions[0].text).toBe('Що таке алгоритм сортування?')
    expect(emittedQuestions[0].status).toBe('ready')
  })

  it('transcribes non-question statements without emitting question candidate', async () => {
    const fakeProvider = new FakeSttProvider({
      defaultText: 'The quick brown fox jumps over the lazy dog.'
    })
    const pipeline = new TranscriptionPipeline({
      provider: fakeProvider,
      windowOptions: { minSpeechDurationMs: 200, silenceHangoverMs: 100 }
    })

    const emittedQuestions: QuestionCandidate[] = []
    pipeline.onQuestionDetected((q) => emittedQuestions.push(q))

    await pipeline.ingestChunk(makeChunk('system', 2000, 100, true))
    await pipeline.ingestChunk(makeChunk('system', 2100, 100, true))
    await pipeline.ingestChunk(makeChunk('system', 2200, 100, false))

    const state = pipeline.getState()
    expect(state.segmentCount).toBe(1)
    expect(state.questionCount).toBe(0)
    expect(state.latestQuestion).toBeNull()
    expect(emittedQuestions).toHaveLength(0)
  })

  it('enforces bounded retention for segments and questions', async () => {
    const fakeProvider = new FakeSttProvider({
      defaultText: 'Can you explain this?'
    })
    const pipeline = new TranscriptionPipeline({
      provider: fakeProvider,
      maxSegments: 2,
      maxQuestions: 2,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
      controlsOptions: { debounceMs: 0, cooldownMs: 0 }
    })

    // Produce 3 speech utterances
    for (let u = 0; u < 3; u++) {
      const baseTime = 1000 + u * 1000
      await pipeline.ingestChunk(makeChunk('mic', baseTime, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', baseTime + 100, 50, false))
    }

    const state = pipeline.getState()
    expect(state.segmentCount).toBe(2) // Capped at maxSegments: 2
    expect(state.questionCount).toBe(2) // Capped at maxQuestions: 2
  })

  it('debounces question candidate emission until debounce delay completes', async () => {
    vi.useFakeTimers()
    try {
      const fakeProvider = new FakeSttProvider({
        defaultText: 'What is this function doing?'
      })
      const pipeline = new TranscriptionPipeline({
        provider: fakeProvider,
        windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
        controlsOptions: { debounceMs: 500 }
      })

      const emitted: QuestionCandidate[] = []
      pipeline.onQuestionDetected((q) => emitted.push(q))

      await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))

      expect(emitted).toHaveLength(0)

      // Advance timers by debounce duration (500ms)
      vi.advanceTimersByTime(500)

      expect(emitted).toHaveLength(1)
      expect(emitted[0].text).toBe('What is this function doing?')
      expect(emitted[0].status).toBe('ready')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels pending debounced question candidate on stop()', async () => {
    vi.useFakeTimers()
    try {
      const fakeProvider = new FakeSttProvider({
        defaultText: 'Will this question be cancelled on stop?'
      })
      const pipeline = new TranscriptionPipeline({
        provider: fakeProvider,
        windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
        controlsOptions: { debounceMs: 500 }
      })

      const emitted: QuestionCandidate[] = []
      pipeline.onQuestionDetected((q) => emitted.push(q))

      await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))

      expect(emitted).toHaveLength(0)

      // Stop before debounce timer fires
      pipeline.stop()

      // Advance timers past debounce delay
      vi.advanceTimersByTime(1000)

      // Candidate must be dropped, not emitted
      expect(emitted).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts in-flight inference on stop() without throwing unhandled error', async () => {
    const fakeProvider = new FakeSttProvider({
      latencyMs: 300,
      defaultText: 'Why is this happening?'
    })
    const pipeline = new TranscriptionPipeline({
      provider: fakeProvider,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 }
    })

    const ingestPromise = (async () => {
      await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))
    })()

    // Stop during in-flight inference
    await new Promise((r) => setTimeout(r, 20))
    pipeline.stop()

    await ingestPromise
    const state = pipeline.getState()
    expect(state.isTranscribing).toBe(false)
    expect(state.segmentCount).toBe(0)
    expect(state.questionCount).toBe(0)
  })

  it('pauses and resumes transcription lifecycle, dropping audio chunks while paused', async () => {
    const fakeProvider = new FakeSttProvider({
      defaultText: 'Speech during paused state'
    })
    const pipeline = new TranscriptionPipeline({
      provider: fakeProvider,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
      controlsOptions: { debounceMs: 0 }
    })

    pipeline.pause()

    // Ingest chunks while paused
    await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))

    expect(pipeline.getState().segmentCount).toBe(0)
    expect(fakeProvider.transcribeCallCount).toBe(0)

    // Resume pipeline
    pipeline.resume()

    // Ingest chunks after resume
    await pipeline.ingestChunk(makeChunk('mic', 2000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 2100, 50, false))

    expect(pipeline.getState().segmentCount).toBe(1)
    expect(fakeProvider.transcribeCallCount).toBe(1)
  })

  it('drops late inference result if provider completes after stop()', async () => {
    // Custom provider that ignores abort signal and resolves late
    let resolveInference!: () => void
    const slowProvider = {
      id: 'slow-stt',
      name: 'Slow STT Provider',
      transcribe: vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveInference = () =>
            resolve({
              text: 'Late question after stop?',
              language: 'uk',
              confidence: 0.9,
              durationMs: 1000
            })
        })
      })
    }

    const pipeline = new TranscriptionPipeline({
      provider: slowProvider,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
      controlsOptions: { debounceMs: 0 }
    })

    const ingestPromise = (async () => {
      await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))
    })()

    await new Promise((r) => setTimeout(r, 20))
    expect(pipeline.getState().isTranscribing).toBe(true)

    // Session stops
    pipeline.stop()
    expect(pipeline.getState().segmentCount).toBe(0)

    // STT resolves after stop()
    resolveInference()
    await ingestPromise

    // Late result MUST NOT be stored
    expect(pipeline.getState().segmentCount).toBe(0)
    expect(pipeline.getState().questionCount).toBe(0)
  })

  it('filters whitespace-only STT results without adding empty segments', async () => {
    const fakeProvider = new FakeSttProvider({
      defaultText: '   \n\t  '
    })
    const pipeline = new TranscriptionPipeline({
      provider: fakeProvider,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 }
    })

    await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))

    expect(pipeline.getState().segmentCount).toBe(0)
  })

  it('cleans up and removes subscribers on dispose()', () => {
    const fakeProvider = new FakeSttProvider()
    const pipeline = new TranscriptionPipeline({ provider: fakeProvider })

    const stateSpy = vi.fn()
    pipeline.onStateChanged(stateSpy)

    pipeline.dispose()
    expect(pipeline.getState().segmentCount).toBe(0)
  })

  it('processes overlapping speech window via bounded queue once active inference completes', async () => {
    let callCount = 0
    let resolveFirstInference!: () => void
    const queuedProvider = {
      id: 'queued-stt',
      name: 'Queued STT Provider',
      transcribe: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return new Promise((resolve) => {
            resolveFirstInference = () =>
              resolve({
                text: 'First question?',
                language: 'en',
                confidence: 0.9,
                durationMs: 1000
              })
          })
        }
        return Promise.resolve({
          text: 'Second question?',
          language: 'en',
          confidence: 0.9,
          durationMs: 1000
        })
      })
    }

    const pipeline = new TranscriptionPipeline({
      provider: queuedProvider,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
      controlsOptions: { debounceMs: 0 }
    })

    // Ingest first window -> triggers first inference (now in-flight)
    const ingest1 = (async () => {
      await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))
    })()

    await new Promise((r) => setTimeout(r, 20))
    expect(pipeline.getState().isTranscribing).toBe(true)

    // Ingest second window while first is still in-flight
    await pipeline.ingestChunk(makeChunk('mic', 2000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 2100, 50, false))

    // Second window must not be dropped; it should be queued in pendingAudioWindow
    expect(queuedProvider.transcribe).toHaveBeenCalledTimes(1)

    // Resolve first inference
    resolveFirstInference()
    await ingest1

    // Allow queued window to be picked up in finally
    await new Promise((r) => setTimeout(r, 30))

    expect(queuedProvider.transcribe).toHaveBeenCalledTimes(2)
    expect(pipeline.getState().segmentCount).toBe(2)
    expect(pipeline.getState().latestSegment?.text).toBe('Second question?')
  })

  it('discards queued pending audio window on stop()', async () => {
    let resolveFirstInference!: () => void
    const queuedProvider = {
      id: 'queued-stt',
      name: 'Queued STT Provider',
      transcribe: vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveFirstInference = () =>
            resolve({
              text: 'First question?',
              language: 'en',
              confidence: 0.9,
              durationMs: 1000
            })
        })
      })
    }

    const pipeline = new TranscriptionPipeline({
      provider: queuedProvider,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
      controlsOptions: { debounceMs: 0 }
    })

    const ingest1 = (async () => {
      await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))
    })()

    await new Promise((r) => setTimeout(r, 20))
    expect(pipeline.getState().isTranscribing).toBe(true)

    // Ingest second window while first is in-flight
    await pipeline.ingestChunk(makeChunk('mic', 2000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 2100, 50, false))

    // Stop session before first inference completes
    pipeline.stop()

    resolveFirstInference()
    await ingest1
    await new Promise((r) => setTimeout(r, 30))

    // Queued window was discarded by stop(); transcribe was never invoked for second window
    expect(queuedProvider.transcribe).toHaveBeenCalledTimes(1)
    expect(pipeline.getState().segmentCount).toBe(0)
  })

  it('assembles a long question split by 5-second maxWindowDurationMs into a single semantic utterance', async () => {
    let windowCall = 0
    const multiPartProvider = {
      id: 'multipart-stt',
      name: 'Multipart STT Provider',
      transcribe: vi.fn().mockImplementation(() => {
        windowCall += 1
        if (windowCall === 1) {
          return Promise.resolve({
            text: 'Поясни будь ласка як саме в нашому проєкті організовано передачу повідомлень',
            language: 'uk' as const,
            confidence: 0.92,
            durationMs: 5000
          })
        }
        return Promise.resolve({
          text: 'між головним процесом Electron та ізольованим процесом рендерера',
          language: 'uk' as const,
          confidence: 0.94,
          durationMs: 2500
        })
      })
    }

    const pipeline = new TranscriptionPipeline({
      provider: multiPartProvider,
      windowOptions: {
        minSpeechDurationMs: 200,
        silenceHangoverMs: 200,
        maxWindowDurationMs: 1000 // Force split at 1000ms for fast deterministic test
      },
      controlsOptions: { debounceMs: 0 }
    })

    const emittedQuestions: QuestionCandidate[] = []
    pipeline.onQuestionDetected((q) => emittedQuestions.push(q))

    // First 1000ms of continuous speech -> force-splits window 1 (isForcedSplit = true)
    for (let i = 0; i < 5; i++) {
      await pipeline.ingestChunk(makeChunk('mic', 1000 + i * 200, 200, true))
    }

    // Because window 1 was a forced duration split, utterance is held awaiting continuation
    expect(pipeline.getState().segmentCount).toBe(1)
    expect(emittedQuestions).toHaveLength(0)

    // Continuation speech (400ms) followed by silence hangover (200ms) -> natural end of utterance
    await pipeline.ingestChunk(makeChunk('mic', 2000, 200, true))
    await pipeline.ingestChunk(makeChunk('mic', 2200, 200, true))
    await pipeline.ingestChunk(makeChunk('mic', 2400, 200, false))

    const state = pipeline.getState()
    expect(state.segmentCount).toBe(2)
    expect(state.latestUtterance?.fragmentCount).toBe(2)
    expect(state.latestUtterance?.text).toBe(
      'Поясни будь ласка як саме в нашому проєкті організовано передачу повідомлень між головним процесом Electron та ізольованим процесом рендерера'
    )
    expect(emittedQuestions).toHaveLength(1)
    expect(emittedQuestions[0].intent).toBe('explanation_request')
    expect(emittedQuestions[0].status).toBe('ready')
  })

  it('tracks bounded STT queue backpressure and records stt_queue_overflow when capacity is exceeded', async () => {
    let resolveFirst!: () => void
    let callIdx = 0
    const slowProvider = {
      id: 'slow-queue-stt',
      name: 'Slow Queue STT',
      transcribe: vi.fn().mockImplementation(() => {
        callIdx += 1
        if (callIdx === 1) {
          return new Promise((resolve) => {
            resolveFirst = () =>
              resolve({
                text: 'Window 1',
                language: 'en' as const,
                confidence: 0.9,
                durationMs: 100
              })
          })
        }
        return Promise.resolve({
          text: `Window ${callIdx}`,
          language: 'en' as const,
          confidence: 0.9,
          durationMs: 100
        })
      })
    }

    const pipeline = new TranscriptionPipeline({
      provider: slowProvider,
      maxPendingWindows: 2,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
      controlsOptions: { debounceMs: 0 }
    })

    // Start window 1 (in-flight)
    const p1 = (async () => {
      await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))
    })()

    await new Promise((r) => setTimeout(r, 20))

    // Queue windows 2, 3, and 4 while window 1 is in-flight (maxPendingWindows = 2 -> 1 overflow)
    for (let w = 2; w <= 4; w++) {
      const base = w * 1000
      await pipeline.ingestChunk(makeChunk('mic', base, 100, true))
      await pipeline.ingestChunk(makeChunk('mic', base + 100, 50, false))
    }

    const midState = pipeline.getState()
    expect(midState.diagnostics?.queuedWindowCount).toBe(2)
    expect(midState.diagnostics?.droppedWindowCount).toBe(1)
    expect(midState.diagnostics?.lastDropReason).toBe('stt_queue_overflow')

    resolveFirst()
    await p1
    await new Promise((r) => setTimeout(r, 40))

    expect(slowProvider.transcribe).toHaveBeenCalledTimes(3)
  })

  it('resolves contextual follow-up across turns and supports opt-in semantic classification', async () => {
    const texts = [
      'Поясни як працює черга повідомлень у головному процесі Electron.',
      'А якщо вона переповниться?',
      'Не впевнений, що цей підхід правильний.'
    ]
    let idx = 0
    const provider = {
      id: 'seq-stt',
      name: 'Sequential STT',
      transcribe: vi.fn().mockImplementation(() => {
        const text = texts[idx++] ?? ''
        return Promise.resolve({
          text,
          language: 'uk' as const,
          confidence: 0.9,
          durationMs: 500
        })
      })
    }

    const fakeClassifier = new FakeIntentClassifier(
      () => ({
        intent: 'indirect_question',
        decision: 'ready',
        requiresResponse: true,
        addressee: 'assistant_or_user',
        evidence: ['indirect_wonder_phrase'],
        contextDependent: true,
        uncertain: false
      }),
      { enabled: false, userConsentGranted: false }
    )

    const pipeline = new TranscriptionPipeline({
      provider,
      classifier: fakeClassifier,
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 },
      controlsOptions: { debounceMs: 0, cooldownMs: 0 }
    })

    const emitted: QuestionCandidate[] = []
    pipeline.onQuestionDetected((q) => emitted.push(q))

    // Turn 1: Direct explanation request
    await pipeline.ingestChunk(makeChunk('mic', 1000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 1100, 50, false))
    expect(emitted).toHaveLength(1)
    expect(emitted[0].intent).toBe('explanation_request')

    // Turn 2: Short elliptical follow-up ("А якщо вона переповниться?")
    await pipeline.ingestChunk(makeChunk('mic', 3000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 3100, 50, false))
    expect(emitted).toHaveLength(2)
    expect(emitted[1].contextUsed).toBe(true)
    expect(emitted[1].status).toBe('ready')

    // Enable semantic classifier with consent for Turn 3 (ambiguous indirect phrase)
    pipeline.setClassifierConfig({ enabled: true, userConsentGranted: true })
    expect(pipeline.getState().semanticClassifier?.enabled).toBe(true)

    await pipeline.ingestChunk(makeChunk('mic', 5000, 100, true))
    await pipeline.ingestChunk(makeChunk('mic', 5100, 50, false))

    expect(emitted).toHaveLength(3)
    expect(emitted[2].route).toBe('openrouter')
    expect(emitted[2].intent).toBe('indirect_question')
    expect(emitted[2].status).toBe('ready')
  })
})

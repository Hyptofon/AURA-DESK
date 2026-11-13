import { describe, it, expect, vi } from 'vitest'
import { TranscriptionPipeline } from '@/main/transcription/transcription-pipeline'
import { FakeSttProvider } from '@/main/transcription/fake-stt-provider'
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
      windowOptions: { minSpeechDurationMs: 300, silenceHangoverMs: 200 }
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
    expect(state.latestQuestion?.status).toBe('detected')

    expect(emittedQuestions).toHaveLength(1)
    expect(emittedQuestions[0].text).toBe('Що таке алгоритм сортування?')
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
      windowOptions: { minSpeechDurationMs: 100, silenceHangoverMs: 50 }
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
  })

  it('cleans up and removes subscribers on dispose()', () => {
    const fakeProvider = new FakeSttProvider()
    const pipeline = new TranscriptionPipeline({ provider: fakeProvider })

    const stateSpy = vi.fn()
    pipeline.onStateChanged(stateSpy)

    pipeline.dispose()
    expect(pipeline.getState().segmentCount).toBe(0)
  })
})

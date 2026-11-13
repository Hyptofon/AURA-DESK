import { describe, it, expect } from 'vitest'
import { FakeSttProvider } from '@/main/transcription/fake-stt-provider'
import { SpeechWindowAssembler } from '@/main/transcription/speech-window'
import {
  UA_TEST_PHRASES,
  EN_TEST_PHRASES,
  createSyntheticAudioBuffer
} from '../../test/fixtures/stt-fixtures'
import type { AudioChunk } from '@/shared/contracts/audio'

describe('SpeechToTextProvider Contract & Speech Windowing', () => {
  describe('FakeSttProvider Contract & Fixture Routing', () => {
    it('transcribes Ukrainian audio buffer and preserves source metadata and timestamps', async () => {
      const provider = new FakeSttProvider({ defaultText: UA_TEST_PHRASES.questionCode })
      const audio = createSyntheticAudioBuffer({
        durationMs: 1500,
        sampleRate: 16000,
        channels: 1,
        source: 'mic',
        startTimestamp: 1700000000000
      })

      const result = await provider.transcribe({ audio, language: 'uk' })

      expect(result.text).toBe(UA_TEST_PHRASES.questionCode)
      expect(result.language).toBe('uk')
      expect(result.confidence).toBeGreaterThan(0.9)
      expect(result.segments).toHaveLength(1)

      const segment = result.segments![0]
      expect(segment.source).toBe('mic')
      expect(segment.startTimestamp).toBe(1700000000000)
      expect(segment.endTimestamp).toBe(1700000001500)
      expect(segment.isFinal).toBe(true)
    })

    it('transcribes English audio from system loopback source with correct language routing', async () => {
      const provider = new FakeSttProvider({ defaultText: EN_TEST_PHRASES.questionFunction })
      const audio = createSyntheticAudioBuffer({
        durationMs: 2000,
        sampleRate: 48000,
        channels: 2,
        source: 'system',
        startTimestamp: 1700000010000
      })

      const result = await provider.transcribe({ audio, language: 'en' })

      expect(result.text).toBe(EN_TEST_PHRASES.questionFunction)
      expect(result.language).toBe('en')
      expect(result.segments![0].source).toBe('system')
      expect(result.segments![0].startTimestamp).toBe(1700000010000)
      expect(result.segments![0].endTimestamp).toBe(1700000012000)
    })

    it('immediately aborts if request signal is already aborted', async () => {
      const provider = new FakeSttProvider()
      const audio = createSyntheticAudioBuffer()
      const controller = new AbortController()
      controller.abort()

      await expect(
        provider.transcribe({ audio, signal: controller.signal })
      ).rejects.toThrow(/aborted/)
    })

    it('cancels in-flight async transcription when abort signal triggers during latency', async () => {
      const provider = new FakeSttProvider({ latencyMs: 200 })
      const audio = createSyntheticAudioBuffer()
      const controller = new AbortController()

      const transcribePromise = provider.transcribe({ audio, signal: controller.signal })

      // Abort after 50ms while transcribe is in-flight
      setTimeout(() => controller.abort(), 50)

      await expect(transcribePromise).rejects.toThrow(/aborted/)
    })

    it('propagates provider failure when shouldFail is enabled', async () => {
      const provider = new FakeSttProvider({
        shouldFail: true,
        failureMessage: 'Native whisper execution failed'
      })
      const audio = createSyntheticAudioBuffer()

      await expect(provider.transcribe({ audio })).rejects.toThrow(
        /Native whisper execution failed/
      )
    })

    it('rejects calls after dispose()', async () => {
      const provider = new FakeSttProvider()
      provider.dispose()

      const audio = createSyntheticAudioBuffer()
      await expect(provider.transcribe({ audio })).rejects.toThrow(/disposed/)
    })
  })

  describe('SpeechWindowAssembler', () => {
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

    it('ignores chunks from mismatched sources', () => {
      const assembler = new SpeechWindowAssembler('mic')
      const systemChunk = makeChunk('system', 1000, 100, true)
      expect(assembler.ingest(systemChunk)).toBeNull()
      expect(assembler.getAccumulatedSpeechDurationMs()).toBe(0)
    })

    it('discards initial silence chunks prior to speech', () => {
      const assembler = new SpeechWindowAssembler('mic')
      expect(assembler.ingest(makeChunk('mic', 1000, 100, false))).toBeNull()
      expect(assembler.ingest(makeChunk('mic', 1100, 100, false))).toBeNull()
      expect(assembler.getAccumulatedSpeechDurationMs()).toBe(0)
    })

    it('batches consecutive speech chunks and flushes on silence hangover', () => {
      const assembler = new SpeechWindowAssembler('mic', {
        minSpeechDurationMs: 400,
        silenceHangoverMs: 300
      })

      // Ingest 500ms of speech (5 chunks x 100ms)
      for (let i = 0; i < 5; i++) {
        const res = assembler.ingest(makeChunk('mic', 1000 + i * 100, 100, true))
        expect(res).toBeNull() // Still accumulating
      }
      expect(assembler.getAccumulatedSpeechDurationMs()).toBe(500)

      // Ingest 200ms of silence (less than 300ms hangover)
      expect(assembler.ingest(makeChunk('mic', 1500, 100, false))).toBeNull()
      expect(assembler.ingest(makeChunk('mic', 1600, 100, false))).toBeNull()

      // Ingest final 100ms silence (reaches 300ms hangover) -> triggers finalization!
      const window = assembler.ingest(makeChunk('mic', 1700, 100, false))
      expect(window).not.toBeNull()
      expect(window!.source).toBe('mic')
      expect(window!.startTimestamp).toBe(1000)
      expect(window!.endTimestamp).toBe(1800) // 1000 to 1800
      expect(window!.sampleRate).toBe(16000)
      expect(window!.channels).toBe(1)
      expect(window!.data.length).toBeGreaterThan(0)
    })

    it('discards short noise bursts below minSpeechDurationMs upon silence', () => {
      const assembler = new SpeechWindowAssembler('mic', {
        minSpeechDurationMs: 400,
        silenceHangoverMs: 200
      })

      // Only 100ms of speech (e.g. click or pop)
      assembler.ingest(makeChunk('mic', 1000, 100, true))

      // 200ms silence
      assembler.ingest(makeChunk('mic', 1100, 100, false))
      const res = assembler.ingest(makeChunk('mic', 1200, 100, false))

      // Discarded because speech duration (100ms) < minSpeechDurationMs (400ms)
      expect(res).toBeNull()
      expect(assembler.getAccumulatedSpeechDurationMs()).toBe(0)
    })

    it('forces flush when accumulated window reaches maxWindowDurationMs', () => {
      const assembler = new SpeechWindowAssembler('system', {
        minSpeechDurationMs: 200,
        maxWindowDurationMs: 1000
      })

      // Feed 10 chunks of 100ms speech = 1000ms
      let window = null
      for (let i = 0; i < 10; i++) {
        window = assembler.ingest(makeChunk('system', 2000 + i * 100, 100, true))
      }

      expect(window).not.toBeNull()
      expect(window!.source).toBe('system')
      expect(window!.startTimestamp).toBe(2000)
      expect(window!.endTimestamp).toBe(3000)
    })

    it('manual flush() returns current valid speech window and resets', () => {
      const assembler = new SpeechWindowAssembler('mic', { minSpeechDurationMs: 200 })

      assembler.ingest(makeChunk('mic', 1000, 150, true))
      assembler.ingest(makeChunk('mic', 1150, 150, true))

      const window = assembler.flush()
      expect(window).not.toBeNull()
      expect(window!.startTimestamp).toBe(1000)
      expect(window!.endTimestamp).toBe(1300)

      // Subsequent flush is null
      expect(assembler.flush()).toBeNull()
    })

    it('accurately handles chunks with odd byte offsets without throwing or corrupting sample data', () => {
      const assembler = new SpeechWindowAssembler('mic', { minSpeechDurationMs: 200 })

      // Create a buffer with known 16-bit values starting at an odd byte offset (offset 1)
      const raw = Buffer.alloc(1 + 1600 * 2)
      raw[0] = 0x7f // padding byte making subarray offset odd
      for (let i = 0; i < 1600; i++) {
        raw.writeInt16LE(i * 10, 1 + i * 2)
      }

      // Slice from offset 1 so byteOffset is 1 (odd)
      const oddChunkData = raw.subarray(1)
      expect(oddChunkData.byteOffset % 2).toBe(1)

      const oddChunk: AudioChunk = {
        id: 'odd-chunk-1',
        source: 'mic',
        timestamp: 1000,
        durationMs: 200,
        sampleRate: 16000,
        channels: 1,
        data: oddChunkData,
        rms: 0.05,
        isSpeech: true
      }

      assembler.ingest(oddChunk)
      const window = assembler.flush()

      expect(window).not.toBeNull()
      expect(window!.data.length).toBe(1600)
      expect(window!.data[0]).toBe(0)
      expect(window!.data[1]).toBe(10)
      expect(window!.data[50]).toBe(500)
      expect(window!.data[1599]).toBe(15990)
    })
  })
})

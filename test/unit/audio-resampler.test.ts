import { describe, it, expect } from 'vitest'
import {
  downmixToMono,
  resamplePcm16,
  prepareAudioForStt
} from '@/main/transcription/audio-resampler'
import { createSyntheticAudioBuffer } from '../../test/fixtures/stt-fixtures'

describe('audio-resampler: downmixToMono & resamplePcm16', () => {
  describe('downmixToMono', () => {
    it('throws RangeError if channels is 0 or negative', () => {
      expect(() => downmixToMono(new Int16Array([100]), 0)).toThrow(RangeError)
      expect(() => downmixToMono(new Int16Array([100]), -1)).toThrow(RangeError)
    })

    it('returns a copy of samples when channels is 1', () => {
      const input = new Int16Array([100, 200, -300])
      const mono = downmixToMono(input, 1)
      expect(Array.from(mono)).toEqual([100, 200, -300])
      expect(mono).not.toBe(input)
    })

    it('correctly downmixes interleaved stereo (2-channel) samples', () => {
      // Left = 1000, Right = 2000 -> Mean = 1500
      // Left = -1000, Right = 1000 -> Mean = 0
      const stereo = new Int16Array([1000, 2000, -1000, 1000, 500, 500])
      const mono = downmixToMono(stereo, 2)
      expect(mono.length).toBe(3)
      expect(Array.from(mono)).toEqual([1500, 0, 500])
    })

    it('handles multi-channel quad audio (4 channels)', () => {
      const quad = new Int16Array([100, 200, 300, 400])
      const mono = downmixToMono(quad, 4)
      expect(mono.length).toBe(1)
      expect(mono[0]).toBe(250) // (100+200+300+400)/4 = 250
    })
  })

  describe('resamplePcm16', () => {
    it('throws RangeError on non-positive sample rates', () => {
      expect(() => resamplePcm16(new Int16Array([10]), 0, 16000)).toThrow(RangeError)
      expect(() => resamplePcm16(new Int16Array([10]), 16000, -16000)).toThrow(RangeError)
    })

    it('returns an identical copy when sample rates match', () => {
      const input = new Int16Array([1, 2, 3])
      const resampled = resamplePcm16(input, 16000, 16000)
      expect(Array.from(resampled)).toEqual([1, 2, 3])
    })

    it('correctly decimates 48000Hz to 16000Hz (3:1 integer decimation)', () => {
      // 6 samples at 48kHz -> exactly 2 samples at 16kHz
      const input = new Int16Array([100, 200, 300, 400, 500, 600])
      const resampled = resamplePcm16(input, 48000, 16000)
      expect(resampled.length).toBe(2)
      // Block 1: (100 + 200 + 300) / 3 = 200
      // Block 2: (400 + 500 + 600) / 3 = 500
      expect(resampled[0]).toBe(200)
      expect(resampled[1]).toBe(500)
    })

    it('resamples arbitrary non-integer rate conversions via linear interpolation', () => {
      const input = new Int16Array([0, 1000, 2000, 3000, 4000])
      // 44100 to 16000
      const resampled = resamplePcm16(input, 44100, 16000)
      const expectedLength = Math.round((5 * 16000) / 44100)
      expect(resampled.length).toBe(expectedLength)
    })
  })

  describe('prepareAudioForStt', () => {
    it('handles empty audio gracefully', () => {
      const empty = {
        data: new Int16Array(0),
        sampleRate: 48000,
        channels: 2,
        source: 'system' as const,
        startTimestamp: 1000,
        endTimestamp: 2000
      }
      const prepared = prepareAudioForStt(empty)
      expect(prepared.sampleRate).toBe(16000)
      expect(prepared.channels).toBe(1)
      expect(prepared.data.length).toBe(0)
    })

    it('converts 48kHz stereo system audio buffer into 16kHz mono buffer with metadata preserved', () => {
      const buffer = createSyntheticAudioBuffer({
        durationMs: 1000,
        sampleRate: 48000,
        channels: 2,
        source: 'system',
        frequency: 440
      })

      expect(buffer.channels).toBe(2)
      expect(buffer.sampleRate).toBe(48000)
      expect(buffer.data.length).toBe(48000 * 2)

      const prepared = prepareAudioForStt(buffer)

      expect(prepared.channels).toBe(1)
      expect(prepared.sampleRate).toBe(16000)
      expect(prepared.data.length).toBe(16000) // 1 second mono at 16kHz
      expect(prepared.source).toBe('system')
      expect(prepared.startTimestamp).toBe(buffer.startTimestamp)
      expect(prepared.endTimestamp).toBe(buffer.endTimestamp)
    })
  })
})

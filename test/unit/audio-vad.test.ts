import { describe, it, expect } from 'vitest'
import { calculateRms, EnergyVad } from '../../src/main/capture/audio-vad'

describe('EnergyVad & RMS Audio Processing', () => {
  describe('calculateRms', () => {
    it('returns 0 for empty array', () => {
      expect(calculateRms(new Float32Array(0))).toBe(0)
    })

    it('returns 0 for digital silence (all zeros)', () => {
      const silence = new Float32Array(100)
      expect(calculateRms(silence)).toBe(0)
    })

    it('calculates correct RMS for constant DC offset Float32', () => {
      const signal = new Float32Array([0.5, 0.5, 0.5, 0.5])
      expect(calculateRms(signal)).toBeCloseTo(0.5, 4)
    })

    it('calculates correct RMS for alternating square wave', () => {
      const signal = new Float32Array([0.2, -0.2, 0.2, -0.2])
      expect(calculateRms(signal)).toBeCloseTo(0.2, 4)
    })

    it('normalizes Int16Array samples correctly', () => {
      const intSilence = new Int16Array([0, 0, 0, 0])
      expect(calculateRms(intSilence)).toBe(0)

      const intHalfScale = new Int16Array([16384, -16384])
      expect(calculateRms(intHalfScale)).toBeCloseTo(0.5, 2)
    })
  })

  describe('EnergyVad state machine', () => {
    const silenceChunk = new Float32Array(100) // RMS 0
    const speechChunk = new Float32Array(100).fill(0.1) // RMS 0.1 (well above default 0.015 threshold)

    it('starts in inactive silence state', () => {
      const vad = new EnergyVad({ energyThreshold: 0.015, minSpeechDurationMs: 100, silenceHoldDurationMs: 300 })
      const status = vad.getStatus()
      expect(status.isSpeech).toBe(false)
      expect(status.speechDurationMs).toBe(0)
      expect(status.silenceDurationMs).toBe(0)
    })

    it('rejects transient clicks shorter than minSpeechDurationMs', () => {
      const vad = new EnergyVad({ energyThreshold: 0.015, minSpeechDurationMs: 100, silenceHoldDurationMs: 300 })
      // Single 20ms speech-like chunk
      const res = vad.process(speechChunk, 20)
      expect(res.isSpeech).toBe(false)
      expect(res.speechDurationMs).toBe(20)

      // Followed by silence
      const resAfter = vad.process(silenceChunk, 20)
      expect(resAfter.isSpeech).toBe(false)
    })

    it('transitions to isSpeech: true after reaching minSpeechDurationMs', () => {
      const vad = new EnergyVad({ energyThreshold: 0.015, minSpeechDurationMs: 100, silenceHoldDurationMs: 300 })

      // Process 4 chunks of 20ms = 80ms -> still false
      for (let i = 0; i < 4; i++) {
        const res = vad.process(speechChunk, 20)
        expect(res.isSpeech).toBe(false)
      }

      // 5th chunk reaches 100ms -> activates speech
      const fifthRes = vad.process(speechChunk, 20)
      expect(fifthRes.isSpeech).toBe(true)
      expect(fifthRes.speechDurationMs).toBe(100)
    })

    it('preserves speech state during brief pauses shorter than silenceHoldDurationMs (hangover)', () => {
      const vad = new EnergyVad({ energyThreshold: 0.015, minSpeechDurationMs: 100, silenceHoldDurationMs: 300 })

      // Establish speech state (100ms)
      for (let i = 0; i < 5; i++) {
        vad.process(speechChunk, 20)
      }
      expect(vad.getStatus().isSpeech).toBe(true)

      // 200ms of silence (less than 300ms hangover)
      for (let i = 0; i < 10; i++) {
        const res = vad.process(silenceChunk, 20)
        expect(res.isSpeech).toBe(true)
        expect(res.silenceDurationMs).toBe((i + 1) * 20)
      }
    })

    it('transitions back to isSpeech: false after full silenceHoldDurationMs', () => {
      const vad = new EnergyVad({ energyThreshold: 0.015, minSpeechDurationMs: 100, silenceHoldDurationMs: 300 })

      // Establish speech state
      for (let i = 0; i < 5; i++) {
        vad.process(speechChunk, 20)
      }

      // Process 15 chunks of 20ms = 300ms of silence
      let lastRes = vad.getStatus()
      for (let i = 0; i < 15; i++) {
        lastRes = vad.process(silenceChunk, 20)
      }

      expect(lastRes.isSpeech).toBe(false)
      expect(lastRes.speechDurationMs).toBe(0)
    })

    it('reset() immediately clears all accumulators and speech state', () => {
      const vad = new EnergyVad({ energyThreshold: 0.015, minSpeechDurationMs: 100, silenceHoldDurationMs: 300 })

      // Establish speech
      for (let i = 0; i < 5; i++) {
        vad.process(speechChunk, 20)
      }
      expect(vad.getStatus().isSpeech).toBe(true)
      expect(vad.getStatus().rms).toBeGreaterThan(0.015)

      vad.reset()
      const resetStatus = vad.getStatus()
      expect(resetStatus.isSpeech).toBe(false)
      expect(resetStatus.rms).toBe(0)
      expect(resetStatus.speechDurationMs).toBe(0)
      expect(resetStatus.silenceDurationMs).toBe(0)
    })
  })
})

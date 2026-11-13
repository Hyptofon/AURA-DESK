import type { VadOptions, VadStatus } from '@/shared/contracts/audio'

/**
 * Calculates Root-Mean-Square (RMS) energy level of PCM audio samples.
 * Supports Float32Array (-1.0 to 1.0) and Int16Array (-32768 to 32767).
 * Returns normalized value between 0.0 and 1.0.
 */
export function calculateRms(samples: Float32Array | Int16Array): number {
  if (!samples || samples.length === 0) {
    return 0
  }

  let sumSquares = 0
  const isInt16 = samples instanceof Int16Array

  for (let i = 0; i < samples.length; i++) {
    const normalized = isInt16 ? samples[i] / 32768 : samples[i]
    sumSquares += normalized * normalized
  }

  return Math.sqrt(sumSquares / samples.length)
}

/**
 * Lightweight energy/RMS-based Voice Activity Detection (VAD).
 * Pragmatic, deterministic, zero-model algorithm designed for local-first desktop MVP.
 * Enforces minimum speech duration to reject transient clicks, and silence hold (hangover)
 * to avoid clipping natural inter-word pauses.
 */
export class EnergyVad {
  private readonly energyThreshold: number
  private readonly minSpeechDurationMs: number
  private readonly silenceHoldDurationMs: number

  private isSpeechActive = false
  private speechDurationMs = 0
  private silenceDurationMs = 0
  private lastRms = 0

  constructor(options?: VadOptions) {
    this.energyThreshold = options?.energyThreshold ?? 0.015
    this.minSpeechDurationMs = options?.minSpeechDurationMs ?? 100
    this.silenceHoldDurationMs = options?.silenceHoldDurationMs ?? 300
  }

  /**
   * Processes a chunk of audio samples and updates internal speech state.
   */
  process(samples: Float32Array | Int16Array, chunkDurationMs: number): VadStatus {
    const duration = Number.isFinite(chunkDurationMs) && chunkDurationMs > 0 ? chunkDurationMs : 20
    const rms = calculateRms(samples)
    this.lastRms = rms

    if (rms >= this.energyThreshold) {
      this.speechDurationMs += duration
      this.silenceDurationMs = 0

      if (this.speechDurationMs >= this.minSpeechDurationMs) {
        this.isSpeechActive = true
      }
    } else {
      this.silenceDurationMs += duration

      if (this.silenceDurationMs >= this.silenceHoldDurationMs) {
        this.isSpeechActive = false
        this.speechDurationMs = 0
      }
    }

    return {
      isSpeech: this.isSpeechActive,
      rms,
      speechDurationMs: this.speechDurationMs,
      silenceDurationMs: this.silenceDurationMs
    }
  }

  /**
   * Resets VAD state and accumulator timers.
   */
  reset(): void {
    this.isSpeechActive = false
    this.speechDurationMs = 0
    this.silenceDurationMs = 0
    this.lastRms = 0
  }

  getStatus(): VadStatus {
    return {
      isSpeech: this.isSpeechActive,
      rms: this.lastRms,
      speechDurationMs: this.speechDurationMs,
      silenceDurationMs: this.silenceDurationMs
    }
  }
}

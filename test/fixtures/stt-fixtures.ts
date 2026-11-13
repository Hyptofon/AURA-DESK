/**
 * Speech-to-text test fixtures for Ukrainian and English transcription testing.
 * Provides deterministic PCM audio buffers and expected transcription targets.
 */

import type { AudioPcmBuffer } from '@/shared/contracts/transcription'

export const UA_TEST_PHRASES = {
  greeting: 'Привіт, як справи?',
  questionAlgorithm: 'Що таке алгоритм сортування?',
  questionCode: 'Можеш пояснити цей код?',
  statement: 'Сьогодні гарна погода для програмування.'
} as const

export const EN_TEST_PHRASES = {
  greeting: 'Hello, how are you?',
  questionFunction: 'What does this function do?',
  questionError: 'Why is this error happening?',
  statement: 'The quick brown fox jumps over the lazy dog.'
} as const

export interface SyntheticBufferOptions {
  durationMs?: number
  sampleRate?: number
  channels?: number
  frequency?: number
  amplitude?: number
  source?: 'mic' | 'system'
  startTimestamp?: number
}

/**
 * Generates deterministic non-zero Int16 PCM test audio.
 */
export function createSyntheticAudioBuffer(options: SyntheticBufferOptions = {}): AudioPcmBuffer {
  const durationMs = options.durationMs ?? 1000
  const sampleRate = options.sampleRate ?? 16000
  const channels = options.channels ?? 1
  const frequency = options.frequency ?? 440
  const amplitude = options.amplitude ?? 0.5
  const source = options.source ?? 'mic'
  const startTimestamp = options.startTimestamp ?? Date.now()

  const sampleCount = Math.floor((durationMs / 1000) * sampleRate) * channels
  const data = new Int16Array(sampleCount)

  for (let i = 0; i < sampleCount / channels; i++) {
    const t = i / sampleRate
    const sample = Math.round(Math.sin(2 * Math.PI * frequency * t) * amplitude * 32767)
    for (let c = 0; c < channels; c++) {
      data[i * channels + c] = sample
    }
  }

  return {
    data,
    sampleRate,
    channels,
    source,
    startTimestamp,
    endTimestamp: startTimestamp + durationMs
  }
}

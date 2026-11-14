/**
 * Zero-dependency transcription contracts and interfaces.
 * Safe to import across main, preload, renderer, and test environments.
 */

import type { AudioSourceKind } from './audio'

export type TranscriptionLanguage = 'uk' | 'en' | 'auto'

export type DetectedLanguage = 'uk' | 'en' | 'mixed' | 'unknown'

export interface AudioPcmBuffer {
  data: Int16Array
  sampleRate: number
  channels: number
  source: AudioSourceKind
  startTimestamp: number
  endTimestamp: number
  /** True when the audio window was force-flushed due to maxWindowDurationMs rather than silence hangover */
  isForcedSplit?: boolean
}

export interface TranscriptionRequest {
  audio: AudioPcmBuffer
  language?: TranscriptionLanguage
  signal?: AbortSignal
}

export interface TranscriptSegment {
  id: string
  source: AudioSourceKind
  startTimestamp: number
  endTimestamp: number
  text: string
  language?: DetectedLanguage
  confidence?: number
  isFinal: boolean
  /** True when produced from a force-split audio window before natural silence hangover */
  isForcedSplit?: boolean
}

export interface TranscriptionResult {
  text: string
  language?: DetectedLanguage
  confidence?: number
  segments?: TranscriptSegment[]
  durationMs: number
}

export interface SpeechToTextProvider {
  readonly id: string
  readonly name: string
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>
  dispose?(): Promise<void> | void
}

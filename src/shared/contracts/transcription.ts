/**
 * Zero-dependency transcription contracts and interfaces.
 * Safe to import across main, preload, renderer, and test environments.
 */

import type { AudioSourceKind } from './audio'

export type TranscriptionLanguage = 'uk' | 'en' | 'auto'

export interface AudioPcmBuffer {
  data: Int16Array
  sampleRate: number
  channels: number
  source: AudioSourceKind
  startTimestamp: number
  endTimestamp: number
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
  language?: 'uk' | 'en'
  confidence?: number
  isFinal: boolean
}

export interface TranscriptionResult {
  text: string
  language?: 'uk' | 'en'
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

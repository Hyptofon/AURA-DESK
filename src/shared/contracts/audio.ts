/**
 * Zero-dependency audio contracts and types.
 * Safe to import across main, preload, and test code without pulling external packages.
 */

export type AudioSourceKind = 'mic' | 'system'

export interface AudioDevice {
  id: string
  label: string
  isDefault?: boolean
}

export interface AudioChunk {
  id: string
  source: AudioSourceKind
  timestamp: number
  durationMs: number
  sampleRate: number
  channels: number
  data: Uint8Array
  rms: number
  isSpeech: boolean
}

export interface VadOptions {
  /** RMS threshold above which audio is considered potential speech. Default: 0.015 */
  energyThreshold?: number
  /** Minimum consecutive speech audio duration in ms before triggering speech state. Default: 100ms */
  minSpeechDurationMs?: number
  /** Hangover duration in ms to hold speech state after energy drops below threshold. Default: 300ms */
  silenceHoldDurationMs?: number
}

export interface VadStatus {
  isSpeech: boolean
  rms: number
  speechDurationMs: number
  silenceDurationMs: number
}

export type AudioCaptureStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'error'

export interface AudioBufferStats {
  chunkCount: number
  totalBytes: number
  oldestTimestamp: number | null
  newestTimestamp: number | null
}

export interface AudioBufferOptions {
  maxChunks: number
  maxBytes: number
  ttlMs: number
}

export interface AudioConfig {
  mic: boolean
  system: boolean
  micDeviceId?: string
}

export interface AudioSourceState {
  enabled: boolean
  status: AudioCaptureStatus
  bufferStats: AudioBufferStats
  errorMessage?: string | null
}

export interface MicSourceState extends AudioSourceState {
  deviceId: string | null
  vad: VadStatus
}

export interface AudioSessionState {
  mic: MicSourceState
  system: AudioSourceState
}

import type {
  AudioCaptureStatus,
  AudioChunk,
  AudioDevice,
  AudioBufferStats,
  VadStatus
} from '../../shared/contracts/audio'
import { EnergyVad } from './audio-vad'
import { AudioRingBuffer } from './audio-ring-buffer'

export interface MicrophoneBackend {
  enumerateDevices(): Promise<AudioDevice[]>
  start(deviceId?: string): Promise<{ sampleRate: number; channels: number }>
  stop(): Promise<void>
  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void
}

export interface MicrophoneCapturerOptions {
  maxChunks?: number
  maxBytes?: number
  ttlMs?: number
  vadEnergyThreshold?: number
  vadMinSpeechDurationMs?: number
  vadSilenceHoldDurationMs?: number
}

/**
 * Microphone audio capture supervisor with integrated Voice Activity Detection (VAD)
 * and hard-bounded in-memory ring buffer.
 *
 * Invariants:
 * - Session status is the authoritative single source of truth.
 * - Multi-step asynchronous operations protected by session generation tokens.
 * - Stop failures propagate to caller and transition to 'error' without false 'idle'.
 * - Stop flushes all audio buffers immediately to guarantee zero memory or audio retention.
 */
export class MicrophoneCapturer {
  private readonly backend: MicrophoneBackend
  private readonly buffer: AudioRingBuffer
  private readonly vad: EnergyVad

  private status: AudioCaptureStatus = 'idle'
  private sessionGeneration = 0
  private selectedDeviceId: string | null = null
  private currentErrorMessage: string | null = null

  private unsubscribeBackendChunk: (() => void) | null = null
  private statusListeners = new Set<(status: AudioCaptureStatus) => void>()
  private chunkListeners = new Set<(chunk: AudioChunk) => void>()
  private levelListeners = new Set<(rms: number, isSpeech: boolean) => void>()

  constructor(backend: MicrophoneBackend, options?: MicrophoneCapturerOptions) {
    this.backend = backend
    this.buffer = new AudioRingBuffer({
      maxChunks: options?.maxChunks ?? 300,
      maxBytes: options?.maxBytes ?? 5 * 1024 * 1024,
      ttlMs: options?.ttlMs ?? 10000
    })
    this.vad = new EnergyVad({
      energyThreshold: options?.vadEnergyThreshold,
      minSpeechDurationMs: options?.vadMinSpeechDurationMs,
      silenceHoldDurationMs: options?.vadSilenceHoldDurationMs
    })
  }

  getStatus(): AudioCaptureStatus {
    return this.status
  }

  getSelectedDeviceId(): string | null {
    return this.selectedDeviceId
  }

  getErrorMessage(): string | null {
    return this.currentErrorMessage
  }

  getBufferStats(): AudioBufferStats {
    return this.buffer.getStats()
  }

  getVadStatus(): VadStatus {
    return this.vad.getStatus()
  }

  async enumerateDevices(): Promise<AudioDevice[]> {
    return this.backend.enumerateDevices()
  }

  /**
   * Starts microphone capture with optional explicit device selection.
   */
  async start(deviceId?: string): Promise<void> {
    if (this.status === 'active') {
      throw new Error('Microphone capture is already active')
    }

    const currentGen = ++this.sessionGeneration
    this.setStatus('starting')
    this.currentErrorMessage = null
    this.selectedDeviceId = deviceId ?? null

    try {
      // Subscribe to backend chunk emitter
      this.unsubscribeBackendChunk = this.backend.onAudioChunk((rawChunk) => {
        if (this.sessionGeneration !== currentGen || this.status !== 'active') {
          return
        }
        this.handleIncomingChunk(rawChunk)
      })

      await this.backend.start(deviceId)

      if (this.sessionGeneration !== currentGen || this.status === 'stopping') {
        await this.backend.stop().catch(() => {})
        this.unsubscribeBackendChunk?.()
        this.unsubscribeBackendChunk = null
        throw new Error('Microphone capture start was cancelled')
      }

      this.setStatus('active')
    } catch (err) {
      if (this.sessionGeneration === currentGen) {
        this.unsubscribeBackendChunk?.()
        this.unsubscribeBackendChunk = null
        this.buffer.clear()
        this.vad.reset()
        this.currentErrorMessage = err instanceof Error ? err.message : String(err)
        this.setStatus('error')
      }
      throw err
    }
  }

  /**
   * Stops microphone capture, halts hardware tracks, flushes buffers, and resets VAD.
   */
  async stop(): Promise<void> {
    if (this.status === 'idle') {
      return
    }

    ++this.sessionGeneration
    this.setStatus('stopping')

    this.unsubscribeBackendChunk?.()
    this.unsubscribeBackendChunk = null

    // Flush memory buffers and reset VAD immediately
    this.buffer.clear()
    this.vad.reset()

    let teardownError: Error | null = null
    try {
      await this.backend.stop()
    } catch (err) {
      teardownError = err instanceof Error ? err : new Error(String(err))
    }

    if (teardownError) {
      this.currentErrorMessage = `BACKEND_STOP_FAILED: ${teardownError.message}`
      this.setStatus('error')
      throw teardownError
    }

    this.currentErrorMessage = null
    this.selectedDeviceId = null
    this.setStatus('idle')
  }

  /**
   * Pauses microphone capture without tearing down the underlying hardware connection.
   * Incoming audio chunks are discarded immediately to guarantee privacy.
   */
  pause(): void {
    if (this.status === 'active') {
      this.vad.reset()
      this.setStatus('paused')
    }
  }

  /**
   * Resumes microphone capture from paused state.
   */
  resume(): void {
    if (this.status === 'paused') {
      this.setStatus('active')
    }
  }

  private handleIncomingChunk(rawChunk: AudioChunk): void {
    if (this.status !== 'active') {
      return
    }

    // Process chunk through VAD using Int16 view of PCM bytes
    const sampleCount = Math.floor(rawChunk.data.byteLength / 2)
    const int16Samples = new Int16Array(
      rawChunk.data.buffer,
      rawChunk.data.byteOffset,
      sampleCount
    )

    const vadResult = this.vad.process(int16Samples, rawChunk.durationMs)

    const processedChunk: AudioChunk = {
      ...rawChunk,
      source: 'mic',
      rms: vadResult.rms,
      isSpeech: vadResult.isSpeech
    }

    this.buffer.push(processedChunk)

    // Notify listeners
    for (const listener of this.chunkListeners) {
      try {
        listener(processedChunk)
      } catch {
        // Listener error ignored
      }
    }

    for (const listener of this.levelListeners) {
      try {
        listener(vadResult.rms, vadResult.isSpeech)
      } catch {
        // Listener error ignored
      }
    }
  }

  private setStatus(newStatus: AudioCaptureStatus): void {
    if (this.status === newStatus) {
      return
    }
    this.status = newStatus
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus)
      } catch {
        // Listener error ignored
      }
    }
  }

  onStatusChanged(callback: (status: AudioCaptureStatus) => void): () => void {
    this.statusListeners.add(callback)
    return () => this.statusListeners.delete(callback)
  }

  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.chunkListeners.add(callback)
    return () => this.chunkListeners.delete(callback)
  }

  onAudioLevel(callback: (rms: number, isSpeech: boolean) => void): () => void {
    this.levelListeners.add(callback)
    return () => this.levelListeners.delete(callback)
  }
}

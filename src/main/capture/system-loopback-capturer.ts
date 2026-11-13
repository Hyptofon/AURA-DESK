import type {
  AudioCaptureStatus,
  AudioChunk,
  AudioBufferStats
} from '../../shared/contracts/audio'
import { AudioRingBuffer } from './audio-ring-buffer'

export interface SystemLoopbackBackend {
  start(): Promise<{ sampleRate: number; channels: number }>
  stop(): Promise<void>
  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void
}

export interface SystemLoopbackOptions {
  maxChunks?: number
  maxBytes?: number
  ttlMs?: number
}

/**
 * Windows System Audio Loopback Capturer.
 * Captures audio output being played by Windows applications (e.g. video, meetings)
 * while the user listens through headphones or speakers.
 *
 * Invariants:
 * - Operates independently of microphone capture without cross-source contamination.
 * - Enforces session generation tokens to cancel in-flight asynchronous operations.
 * - Propagates stop failures to callers and enters 'error' state rather than false 'idle'.
 * - Guaranteed immediate memory flush on stop.
 */
export class SystemLoopbackCapturer {
  private readonly backend: SystemLoopbackBackend
  private readonly buffer: AudioRingBuffer

  private status: AudioCaptureStatus = 'idle'
  private sessionGeneration = 0
  private currentErrorMessage: string | null = null

  private unsubscribeBackendChunk: (() => void) | null = null
  private statusListeners = new Set<(status: AudioCaptureStatus) => void>()
  private chunkListeners = new Set<(chunk: AudioChunk) => void>()

  constructor(backend: SystemLoopbackBackend, options?: SystemLoopbackOptions) {
    this.backend = backend
    this.buffer = new AudioRingBuffer({
      maxChunks: options?.maxChunks ?? 300,
      maxBytes: options?.maxBytes ?? 5 * 1024 * 1024,
      ttlMs: options?.ttlMs ?? 10000
    })
  }

  getStatus(): AudioCaptureStatus {
    return this.status
  }

  getErrorMessage(): string | null {
    return this.currentErrorMessage
  }

  getBufferStats(): AudioBufferStats {
    return this.buffer.getStats()
  }

  getBufferedChunks(): AudioChunk[] {
    return this.buffer.getChunks()
  }

  /**
   * Starts Windows system audio loopback capture.
   */
  async start(): Promise<void> {
    if (this.status === 'active') {
      throw new Error('System audio loopback capture is already active')
    }

    const currentGen = ++this.sessionGeneration
    this.setStatus('starting')
    this.currentErrorMessage = null

    try {
      this.unsubscribeBackendChunk = this.backend.onAudioChunk((rawChunk) => {
        if (this.sessionGeneration !== currentGen || this.status !== 'active') {
          return
        }
        this.handleIncomingChunk(rawChunk)
      })

      await this.backend.start()

      if (this.sessionGeneration !== currentGen || this.status === 'stopping') {
        await this.backend.stop().catch(() => {})
        this.unsubscribeBackendChunk?.()
        this.unsubscribeBackendChunk = null
        throw new Error('System audio loopback capture start was cancelled')
      }

      this.setStatus('active')
    } catch (err) {
      if (this.sessionGeneration === currentGen) {
        this.unsubscribeBackendChunk?.()
        this.unsubscribeBackendChunk = null
        this.buffer.clear()
        this.currentErrorMessage = err instanceof Error ? err.message : String(err)
        this.setStatus('error')
      }
      throw err
    }
  }

  /**
   * Stops loopback capture, releases audio handles, and flushes all buffered chunks.
   */
  async stop(): Promise<void> {
    if (this.status === 'idle') {
      return
    }

    ++this.sessionGeneration
    this.setStatus('stopping')

    this.unsubscribeBackendChunk?.()
    this.unsubscribeBackendChunk = null

    // Flush memory buffers immediately
    this.buffer.clear()

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
    this.setStatus('idle')
  }

  private handleIncomingChunk(rawChunk: AudioChunk): void {
    const taggedChunk: AudioChunk = {
      ...rawChunk,
      source: 'system'
    }

    this.buffer.push(taggedChunk)

    for (const listener of this.chunkListeners) {
      try {
        listener(taggedChunk)
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
}

import type { AudioChunk } from '../../shared/contracts/audio'
import type { SystemLoopbackBackend } from './system-loopback-capturer'

export interface SessionWithDisplayMediaHandler {
  setDisplayMediaRequestHandler(
    handler:
      | ((
          request: { frame?: unknown; audioRequested?: boolean },
          callback: (response: { audio?: 'loopback' }) => void
        ) => void)
      | null
  ): void
}

export interface ElectronLoopbackBackendOptions {
  session?: SessionWithDisplayMediaHandler
  sampleRate?: number
  channels?: number
}

/**
 * Electron/Chromium Windows System Audio Loopback Backend.
 * Uses session.setDisplayMediaRequestHandler on an isolated partition
 * ('in-memory:aura-audio-loopback') with audio: 'loopback' to tap into Windows
 * default playback device (speakers or headphones) without microphone contamination.
 */
export class ElectronLoopbackBackend implements SystemLoopbackBackend {
  private readonly session: SessionWithDisplayMediaHandler | null
  private readonly sampleRate: number
  private readonly channels: number

  private isStarted = false
  private chunkCallback: ((chunk: AudioChunk) => void) | null = null

  constructor(options?: ElectronLoopbackBackendOptions) {
    this.session = options?.session ?? null
    this.sampleRate = options?.sampleRate ?? 48000
    this.channels = options?.channels ?? 2
  }

  async start(): Promise<{ sampleRate: number; channels: number }> {
    if (this.isStarted) {
      throw new Error('ElectronLoopbackBackend is already started')
    }

    this.isStarted = true

    if (this.session) {
      // Register fail-closed loopback request handler
      this.session.setDisplayMediaRequestHandler((_request, callback) => {
        if (!this.isStarted) {
          callback({})
          return
        }
        // Authorize exclusive loopback audio without video
        callback({ audio: 'loopback' })
      })
    }

    return { sampleRate: this.sampleRate, channels: this.channels }
  }

  async stop(): Promise<void> {
    this.isStarted = false

    if (this.session) {
      // Enforce permanent fail-closed deny-all handler on stop
      this.session.setDisplayMediaRequestHandler((_request, callback) => {
        callback({})
      })
    }

    this.chunkCallback = null
  }

  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.chunkCallback = callback
    return () => {
      this.chunkCallback = null
    }
  }

  /**
   * Internal/test hook to deliver loopback PCM chunks to supervisor.
   */
  emitChunk(chunk: AudioChunk): void {
    if (this.isStarted && this.chunkCallback) {
      this.chunkCallback(chunk)
    }
  }

  isActive(): boolean {
    return this.isStarted
  }
}

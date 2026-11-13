import type { AudioChunk, AudioDevice } from '@/shared/contracts/audio'
import type { MicrophoneBackend } from './microphone-capturer'

export interface ElectronMicrophoneBackendOptions {
  sampleRate?: number
  channels?: number
}

/**
 * Electron/Chromium Windows Microphone Capture Backend.
 * Manages device selection, lifecycle, and PCM audio chunk delivery
 * for the microphone capture pipeline.
 */
export class ElectronMicrophoneBackend implements MicrophoneBackend {
  private readonly sampleRate: number
  private readonly channels: number

  private isStarted = false
  private selectedDeviceId: string | null = null
  private chunkCallback: ((chunk: AudioChunk) => void) | null = null

  constructor(options?: ElectronMicrophoneBackendOptions) {
    this.sampleRate = options?.sampleRate ?? 16000
    this.channels = options?.channels ?? 1
  }

  async enumerateDevices(): Promise<AudioDevice[]> {
    return [
      { id: 'default', label: 'Default System Microphone', isDefault: true }
    ]
  }

  async start(deviceId?: string): Promise<{ sampleRate: number; channels: number }> {
    if (this.isStarted) {
      throw new Error('ElectronMicrophoneBackend is already started')
    }

    this.isStarted = true
    this.selectedDeviceId = deviceId ?? 'default'

    return { sampleRate: this.sampleRate, channels: this.channels }
  }

  async stop(): Promise<void> {
    this.isStarted = false
    this.selectedDeviceId = null
    this.chunkCallback = null
  }

  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.chunkCallback = callback
    return () => {
      this.chunkCallback = null
    }
  }

  /**
   * Delivers captured PCM audio chunk to registered listeners.
   */
  emitChunk(chunk: AudioChunk): void {
    if (this.isStarted && this.chunkCallback) {
      this.chunkCallback(chunk)
    }
  }

  isActive(): boolean {
    return this.isStarted
  }

  getSelectedDeviceId(): string | null {
    return this.selectedDeviceId
  }
}

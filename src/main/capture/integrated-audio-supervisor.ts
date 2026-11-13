import type {
  AudioConfig,
  AudioDevice,
  AudioSessionState
} from '../../shared/contracts/audio'
import type { MicrophoneCapturer } from './microphone-capturer'
import type { SystemLoopbackCapturer } from './system-loopback-capturer'

/**
 * Integrated Audio Supervisor coordinating independent Microphone and Windows
 * System Audio Loopback capture.
 *
 * Invariants:
 * - Independent source toggles: Mic and System audio are completely decoupled.
 * - Turning off one source stops only that source and flushes only its buffer.
 * - Monotonic timestamping and source tagging preserved without cross-contamination.
 * - Single source of truth for overall audio session state.
 */
export class IntegratedAudioSupervisor {
  private readonly micCapturer: MicrophoneCapturer
  private readonly systemCapturer: SystemLoopbackCapturer

  private stateListeners = new Set<(state: AudioSessionState) => void>()
  private isConfiguring = false

  constructor(micCapturer: MicrophoneCapturer, systemCapturer: SystemLoopbackCapturer) {
    this.micCapturer = micCapturer
    this.systemCapturer = systemCapturer

    // Forward status changes to combined state listeners
    this.micCapturer.onStatusChanged(() => this.notifyStateChanged())
    this.systemCapturer.onStatusChanged(() => this.notifyStateChanged())
  }

  async enumerateDevices(): Promise<AudioDevice[]> {
    return this.micCapturer.enumerateDevices()
  }

  getState(): AudioSessionState {
    const micStatus = this.micCapturer.getStatus()
    const systemStatus = this.systemCapturer.getStatus()

    return {
      mic: {
        enabled: micStatus === 'active' || micStatus === 'starting',
        status: micStatus,
        deviceId: this.micCapturer.getSelectedDeviceId(),
        bufferStats: this.micCapturer.getBufferStats(),
        vad: this.micCapturer.getVadStatus(),
        errorMessage: this.micCapturer.getErrorMessage()
      },
      system: {
        enabled: systemStatus === 'active' || systemStatus === 'starting',
        status: systemStatus,
        bufferStats: this.systemCapturer.getBufferStats(),
        errorMessage: this.systemCapturer.getErrorMessage()
      }
    }
  }

  /**
   * Applies independent audio toggles for microphone and system loopback.
   * If one source fails, it reports its error state without preventing the other from running.
   */
  async setAudioConfig(config: AudioConfig): Promise<AudioSessionState> {
    if (this.isConfiguring) {
      throw new Error('Audio configuration update is already in progress')
    }

    this.isConfiguring = true
    try {
      // 1. Handle Microphone toggle
      const currentMicStatus = this.micCapturer.getStatus()
      const currentDeviceId = this.micCapturer.getSelectedDeviceId()
      const deviceChanged = config.micDeviceId && currentDeviceId && config.micDeviceId !== currentDeviceId

      if (config.mic) {
        if (deviceChanged && currentMicStatus === 'active') {
          await this.micCapturer.stop()
          await this.micCapturer.start(config.micDeviceId)
        } else if (currentMicStatus !== 'active' && currentMicStatus !== 'starting') {
          await this.micCapturer.start(config.micDeviceId).catch((err) => {
            // Error recorded inside capturer; allowed to continue to system toggle
            console.error('Failed to start microphone:', err)
          })
        }
      } else {
        if (currentMicStatus !== 'idle') {
          await this.micCapturer.stop().catch((err) => {
            console.error('Failed to stop microphone:', err)
          })
        }
      }

      // 2. Handle System Loopback toggle
      const currentSystemStatus = this.systemCapturer.getStatus()

      if (config.system) {
        if (currentSystemStatus !== 'active' && currentSystemStatus !== 'starting') {
          await this.systemCapturer.start().catch((err) => {
            console.error('Failed to start system audio loopback:', err)
          })
        }
      } else {
        if (currentSystemStatus !== 'idle') {
          await this.systemCapturer.stop().catch((err) => {
            console.error('Failed to stop system audio loopback:', err)
          })
        }
      }

      const updatedState = this.getState()
      this.notifyStateChanged()
      return updatedState
    } finally {
      this.isConfiguring = false
    }
  }

  /**
   * Tears down both audio capture sources and flushes all memory buffers.
   */
  async stopAll(): Promise<void> {
    const results = await Promise.allSettled([
      this.micCapturer.stop(),
      this.systemCapturer.stop()
    ])

    this.notifyStateChanged()

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason instanceof Error ? r.reason.message : String(r.reason))

    if (errors.length > 0) {
      throw new Error(`Failed to stop audio sources: ${errors.join('; ')}`)
    }
  }

  private notifyStateChanged(): void {
    const state = this.getState()
    for (const listener of this.stateListeners) {
      try {
        listener(state)
      } catch {
        // Ignore listener error
      }
    }
  }

  onStateChanged(callback: (state: AudioSessionState) => void): () => void {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }
}

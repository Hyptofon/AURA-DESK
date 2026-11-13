import { describe, it, expect } from 'vitest'
import { IntegratedAudioSupervisor } from '@/main/capture/integrated-audio-supervisor'
import { MicrophoneCapturer, type MicrophoneBackend } from '@/main/capture/microphone-capturer'
import { SystemLoopbackCapturer, type SystemLoopbackBackend } from '@/main/capture/system-loopback-capturer'
import type { AudioChunk, AudioDevice } from '@/shared/contracts/audio'

class MockMicBackend implements MicrophoneBackend {
  public lastStartedDeviceId: string | undefined = undefined
  public shouldFailStart = false
  public shouldFailStop = false

  async enumerateDevices(): Promise<AudioDevice[]> {
    return [
      { id: 'mic-1', label: 'Built-in Microphone', isDefault: true },
      { id: 'mic-2', label: 'Headset Mic', isDefault: false }
    ]
  }

  async start(deviceId?: string): Promise<{ sampleRate: number; channels: number }> {
    this.lastStartedDeviceId = deviceId
    if (this.shouldFailStart) {
      throw new Error('NotAllowedError: Mic permission denied')
    }
    return { sampleRate: 16000, channels: 1 }
  }

  async stop(): Promise<void> {
    if (this.shouldFailStop) {
      throw new Error('Failed to release mic')
    }
  }

  onAudioChunk(_callback: (chunk: AudioChunk) => void): () => void {
    return () => {}
  }
}

class MockLoopbackBackend implements SystemLoopbackBackend {
  public shouldFailStart = false
  public shouldFailStop = false

  async start(): Promise<{ sampleRate: number; channels: number }> {
    if (this.shouldFailStart) {
      throw new Error('Loopback not supported')
    }
    return { sampleRate: 48000, channels: 2 }
  }

  async stop(): Promise<void> {
    if (this.shouldFailStop) {
      throw new Error('Failed to release loopback')
    }
  }

  onAudioChunk(_callback: (chunk: AudioChunk) => void): () => void {
    return () => {}
  }
}

describe('IntegratedAudioSupervisor — Independent Audio Controls', () => {
  it('initializes with both audio sources disabled and idle (OFF / OFF)', () => {
    const micCapturer = new MicrophoneCapturer(new MockMicBackend())
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    const state = supervisor.getState()
    expect(state.mic.enabled).toBe(false)
    expect(state.mic.status).toBe('idle')
    expect(state.system.enabled).toBe(false)
    expect(state.system.status).toBe('idle')
  })

  it('exercises Mic ON + System OFF combination', async () => {
    const micBackend = new MockMicBackend()
    const micCapturer = new MicrophoneCapturer(micBackend)
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    const state = await supervisor.setAudioConfig({ mic: true, system: false, micDeviceId: 'mic-1' })
    expect(state.mic.enabled).toBe(true)
    expect(state.mic.status).toBe('active')
    expect(state.mic.deviceId).toBe('mic-1')
    expect(state.system.enabled).toBe(false)
    expect(state.system.status).toBe('idle')
    expect(micBackend.lastStartedDeviceId).toBe('mic-1')
  })

  it('exercises Mic OFF + System ON combination', async () => {
    const micCapturer = new MicrophoneCapturer(new MockMicBackend())
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    const state = await supervisor.setAudioConfig({ mic: false, system: true })
    expect(state.mic.enabled).toBe(false)
    expect(state.mic.status).toBe('idle')
    expect(state.system.enabled).toBe(true)
    expect(state.system.status).toBe('active')
  })

  it('exercises Mic ON + System ON combination simultaneously', async () => {
    const micCapturer = new MicrophoneCapturer(new MockMicBackend())
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    const state = await supervisor.setAudioConfig({ mic: true, system: true, micDeviceId: 'mic-2' })
    expect(state.mic.enabled).toBe(true)
    expect(state.mic.status).toBe('active')
    expect(state.system.enabled).toBe(true)
    expect(state.system.status).toBe('active')
  })

  it('turning off only microphone keeps system loopback active without disruption', async () => {
    const micCapturer = new MicrophoneCapturer(new MockMicBackend())
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    // Start both
    await supervisor.setAudioConfig({ mic: true, system: true })
    expect(supervisor.getState().mic.enabled).toBe(true)
    expect(supervisor.getState().system.enabled).toBe(true)

    // Turn off mic only
    const state = await supervisor.setAudioConfig({ mic: false, system: true })
    expect(state.mic.enabled).toBe(false)
    expect(state.mic.status).toBe('idle')
    expect(state.system.enabled).toBe(true)
    expect(state.system.status).toBe('active')
  })

  it('turning off only system loopback keeps microphone active without disruption', async () => {
    const micCapturer = new MicrophoneCapturer(new MockMicBackend())
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    // Start both
    await supervisor.setAudioConfig({ mic: true, system: true })

    // Turn off system only
    const state = await supervisor.setAudioConfig({ mic: true, system: false })
    expect(state.mic.enabled).toBe(true)
    expect(state.mic.status).toBe('active')
    expect(state.system.enabled).toBe(false)
    expect(state.system.status).toBe('idle')
  })

  it('changing mic device id restarts microphone with newly selected device', async () => {
    const micBackend = new MockMicBackend()
    const micCapturer = new MicrophoneCapturer(micBackend)
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    await supervisor.setAudioConfig({ mic: true, system: false, micDeviceId: 'mic-1' })
    expect(micBackend.lastStartedDeviceId).toBe('mic-1')

    await supervisor.setAudioConfig({ mic: true, system: false, micDeviceId: 'mic-2' })
    expect(micBackend.lastStartedDeviceId).toBe('mic-2')
    expect(supervisor.getState().mic.deviceId).toBe('mic-2')
  })

  it('isolated error handling: mic permission denial does not block system loopback', async () => {
    const micBackend = new MockMicBackend()
    micBackend.shouldFailStart = true
    const micCapturer = new MicrophoneCapturer(micBackend)
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    const state = await supervisor.setAudioConfig({ mic: true, system: true })
    expect(state.mic.status).toBe('error')
    expect(state.mic.errorMessage).toContain('Mic permission denied')
    // System audio succeeds independently
    expect(state.system.enabled).toBe(true)
    expect(state.system.status).toBe('active')
  })

  it('stopAll() tears down both sources cleanly', async () => {
    const micCapturer = new MicrophoneCapturer(new MockMicBackend())
    const loopbackCapturer = new SystemLoopbackCapturer(new MockLoopbackBackend())
    const supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

    await supervisor.setAudioConfig({ mic: true, system: true })
    await supervisor.stopAll()

    const state = supervisor.getState()
    expect(state.mic.status).toBe('idle')
    expect(state.system.status).toBe('idle')
  })
})

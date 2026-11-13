import { describe, it, expect, vi } from 'vitest'
import {
  MicrophoneCapturer,
  type MicrophoneBackend
} from '../../src/main/capture/microphone-capturer'
import type { AudioChunk, AudioDevice } from '../../src/shared/contracts/audio'

function createFakePcmChunk(rmsApprox: number, durationMs = 20): AudioChunk {
  // 16000 Hz, 16-bit mono -> 320 samples for 20ms = 640 bytes
  const sampleCount = Math.round((16000 * durationMs) / 1000)
  const int16Array = new Int16Array(sampleCount)
  const sampleVal = Math.round(rmsApprox * 32768)
  int16Array.fill(sampleVal)

  return {
    id: `chunk-${Date.now()}-${Math.random()}`,
    source: 'mic',
    timestamp: Date.now(),
    durationMs,
    sampleRate: 16000,
    channels: 1,
    data: new Uint8Array(int16Array.buffer),
    rms: rmsApprox,
    isSpeech: false
  }
}

class FakeMicrophoneBackend implements MicrophoneBackend {
  private chunkCallback: ((chunk: AudioChunk) => void) | null = null
  public startDelayMs = 0
  public shouldFailStart = false
  public shouldFailStop = false
  public lastRequestedDeviceId: string | undefined = undefined

  async enumerateDevices(): Promise<AudioDevice[]> {
    return [
      { id: 'default', label: 'Default Microphone', isDefault: true },
      { id: 'mic-usb-1', label: 'USB Audio Device', isDefault: false }
    ]
  }

  async start(deviceId?: string): Promise<{ sampleRate: number; channels: number }> {
    this.lastRequestedDeviceId = deviceId
    if (this.startDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.startDelayMs))
    }
    if (this.shouldFailStart) {
      throw new Error('NotAllowedError: Permission denied by operating system')
    }
    return { sampleRate: 16000, channels: 1 }
  }

  async stop(): Promise<void> {
    if (this.shouldFailStop) {
      throw new Error('Device release failed')
    }
  }

  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.chunkCallback = callback
    return () => {
      this.chunkCallback = null
    }
  }

  emitChunk(chunk: AudioChunk): void {
    this.chunkCallback?.(chunk)
  }
}

describe('MicrophoneCapturer Supervisor', () => {
  it('enumerates available audio input devices', async () => {
    const backend = new FakeMicrophoneBackend()
    const capturer = new MicrophoneCapturer(backend)

    const devices = await capturer.enumerateDevices()
    expect(devices).toHaveLength(2)
    expect(devices[0].id).toBe('default')
  })

  it('starts and transitions status from idle -> starting -> active', async () => {
    const backend = new FakeMicrophoneBackend()
    const capturer = new MicrophoneCapturer(backend)

    const statusUpdates: string[] = []
    capturer.onStatusChanged((s) => statusUpdates.push(s))

    expect(capturer.getStatus()).toBe('idle')
    await capturer.start('mic-usb-1')

    expect(capturer.getStatus()).toBe('active')
    expect(capturer.getSelectedDeviceId()).toBe('mic-usb-1')
    expect(statusUpdates).toEqual(['starting', 'active'])
  })

  it('rejects start if already active', async () => {
    const backend = new FakeMicrophoneBackend()
    const capturer = new MicrophoneCapturer(backend)

    await capturer.start()
    await expect(capturer.start()).rejects.toThrow(/already active/)
  })

  it('fails closed and enters error state when permission is denied', async () => {
    const backend = new FakeMicrophoneBackend()
    backend.shouldFailStart = true
    const capturer = new MicrophoneCapturer(backend)

    await expect(capturer.start()).rejects.toThrow(/Permission denied/)
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.getErrorMessage()).toContain('Permission denied')
  })

  it('stops and flushes in-memory buffers and VAD state', async () => {
    const backend = new FakeMicrophoneBackend()
    const capturer = new MicrophoneCapturer(backend)

    await capturer.start()

    // Emit speech chunks
    for (let i = 0; i < 5; i++) {
      backend.emitChunk(createFakePcmChunk(0.1, 20))
    }

    expect(capturer.getBufferStats().chunkCount).toBe(5)
    expect(capturer.getVadStatus().isSpeech).toBe(true)

    await capturer.stop()

    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.getBufferStats().chunkCount).toBe(0)
    expect(capturer.getVadStatus().isSpeech).toBe(false)
  })

  it('repeated stop() when already idle is safe no-op', async () => {
    const backend = new FakeMicrophoneBackend()
    const capturer = new MicrophoneCapturer(backend)

    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')
  })

  it('rethrows and transitions to error state when backend.stop() fails', async () => {
    const backend = new FakeMicrophoneBackend()
    const capturer = new MicrophoneCapturer(backend)

    await capturer.start()
    backend.shouldFailStop = true

    await expect(capturer.stop()).rejects.toThrow(/Device release failed/)
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.getErrorMessage()).toContain('BACKEND_STOP_FAILED: Device release failed')
    // Buffers must still be cleared even on teardown failure
    expect(capturer.getBufferStats().chunkCount).toBe(0)
  })

  it('stop during in-flight start aborts startup and prevents late activation', async () => {
    const backend = new FakeMicrophoneBackend()
    backend.startDelayMs = 50
    const capturer = new MicrophoneCapturer(backend)

    const startPromise = capturer.start()
    // Immediately stop while start is pending
    await capturer.stop()

    await expect(startPromise).rejects.toThrow(/cancelled/)
    expect(capturer.getStatus()).toBe('idle')
  })

  it('dispatches processed audio chunks with VAD metadata to listeners', async () => {
    const backend = new FakeMicrophoneBackend()
    const capturer = new MicrophoneCapturer(backend)

    const receivedChunks: AudioChunk[] = []
    const levelEvents: Array<{ rms: number; isSpeech: boolean }> = []

    capturer.onAudioChunk((c) => receivedChunks.push(c))
    capturer.onAudioLevel((rms, isSpeech) => levelEvents.push({ rms, isSpeech }))

    await capturer.start()

    // Emit 5 chunks of 20ms = 100ms with energy > threshold
    for (let i = 0; i < 5; i++) {
      backend.emitChunk(createFakePcmChunk(0.1, 20))
    }

    expect(receivedChunks).toHaveLength(5)
    expect(levelEvents).toHaveLength(5)
    // By the 5th chunk (100ms), VAD activates speech
    expect(receivedChunks[4].isSpeech).toBe(true)
    expect(receivedChunks[4].rms).toBeGreaterThan(0.015)
    expect(capturer.getVadStatus().isSpeech).toBe(true)

    await capturer.stop()
  })
})

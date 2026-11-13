import { describe, it, expect } from 'vitest'
import {
  SystemLoopbackCapturer,
  type SystemLoopbackBackend
} from '../../src/main/capture/system-loopback-capturer'
import type { AudioChunk } from '../../src/shared/contracts/audio'

function createFakeLoopbackChunk(durationMs = 20): AudioChunk {
  return {
    id: `loopback-${Date.now()}-${Math.random()}`,
    source: 'system',
    timestamp: Date.now(),
    durationMs,
    sampleRate: 48000,
    channels: 2,
    data: new Uint8Array(1920), // 48000 * 2ch * 2bytes/sample * 0.02s = 1920 bytes
    rms: 0.12,
    isSpeech: false
  }
}

class FakeLoopbackBackend implements SystemLoopbackBackend {
  private chunkCallback: ((chunk: AudioChunk) => void) | null = null
  public startDelayMs = 0
  public shouldFailStart = false
  public shouldFailStop = false

  async start(): Promise<{ sampleRate: number; channels: number }> {
    if (this.startDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.startDelayMs))
    }
    if (this.shouldFailStart) {
      throw new Error('NotSupportedError: Audio loopback is not supported on this platform')
    }
    return { sampleRate: 48000, channels: 2 }
  }

  async stop(): Promise<void> {
    if (this.shouldFailStop) {
      throw new Error('WASAPI loopback release failed')
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

describe('SystemLoopbackCapturer Supervisor', () => {
  it('starts and transitions status from idle -> starting -> active', async () => {
    const backend = new FakeLoopbackBackend()
    const capturer = new SystemLoopbackCapturer(backend)

    const statusUpdates: string[] = []
    capturer.onStatusChanged((s) => statusUpdates.push(s))

    expect(capturer.getStatus()).toBe('idle')
    await capturer.start()

    expect(capturer.getStatus()).toBe('active')
    expect(statusUpdates).toEqual(['starting', 'active'])
  })

  it('rejects start if already active', async () => {
    const backend = new FakeLoopbackBackend()
    const capturer = new SystemLoopbackCapturer(backend)

    await capturer.start()
    await expect(capturer.start()).rejects.toThrow(/already active/)
  })

  it('fails closed and enters error state when loopback start fails', async () => {
    const backend = new FakeLoopbackBackend()
    backend.shouldFailStart = true
    const capturer = new SystemLoopbackCapturer(backend)

    await expect(capturer.start()).rejects.toThrow(/NotSupportedError/)
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.getErrorMessage()).toContain('NotSupportedError')
  })

  it('stops and flushes in-memory buffers immediately', async () => {
    const backend = new FakeLoopbackBackend()
    const capturer = new SystemLoopbackCapturer(backend)

    await capturer.start()
    backend.emitChunk(createFakeLoopbackChunk())
    backend.emitChunk(createFakeLoopbackChunk())

    expect(capturer.getBufferStats().chunkCount).toBe(2)

    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.getBufferStats().chunkCount).toBe(0)
  })

  it('rethrows and enters error state when backend.stop() throws', async () => {
    const backend = new FakeLoopbackBackend()
    const capturer = new SystemLoopbackCapturer(backend)

    await capturer.start()
    backend.shouldFailStop = true

    await expect(capturer.stop()).rejects.toThrow(/WASAPI loopback release failed/)
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.getErrorMessage()).toContain('BACKEND_STOP_FAILED: WASAPI loopback release failed')
    expect(capturer.getBufferStats().chunkCount).toBe(0)
  })

  it('cancels start when stop() is called during in-flight startup', async () => {
    const backend = new FakeLoopbackBackend()
    backend.startDelayMs = 50
    const capturer = new SystemLoopbackCapturer(backend)

    const startPromise = capturer.start()
    await capturer.stop()

    await expect(startPromise).rejects.toThrow(/cancelled/)
    expect(capturer.getStatus()).toBe('idle')
  })

  it('tags chunks with source: system and notifies listeners without microphone data', async () => {
    const backend = new FakeLoopbackBackend()
    const capturer = new SystemLoopbackCapturer(backend)

    const chunksReceived: AudioChunk[] = []
    capturer.onAudioChunk((c) => chunksReceived.push(c))

    await capturer.start()
    backend.emitChunk(createFakeLoopbackChunk())
    backend.emitChunk(createFakeLoopbackChunk())

    expect(chunksReceived).toHaveLength(2)
    expect(chunksReceived[0].source).toBe('system')
    expect(chunksReceived[1].source).toBe('system')
    expect(capturer.getBufferStats().chunkCount).toBe(2)

    await capturer.stop()
  })
})

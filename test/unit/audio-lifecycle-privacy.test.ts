import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MicrophoneCapturer,
  type MicrophoneBackend
} from '../../src/main/capture/microphone-capturer'
import {
  SystemLoopbackCapturer,
  type SystemLoopbackBackend
} from '../../src/main/capture/system-loopback-capturer'
import { IntegratedAudioSupervisor } from '../../src/main/capture/integrated-audio-supervisor'
import type { AudioChunk, AudioDevice } from '../../src/shared/contracts/audio'

function createFakeChunk(source: 'mic' | 'system', durationMs = 20): AudioChunk {
  const sampleCount = Math.round((16000 * durationMs) / 1000)
  const int16 = new Int16Array(sampleCount)
  int16.fill(1000)
  return {
    id: `chunk-${Date.now()}-${Math.random()}`,
    source,
    timestamp: Date.now(),
    durationMs,
    sampleRate: 16000,
    channels: 1,
    data: new Uint8Array(int16.buffer),
    rms: 0.05,
    isSpeech: false
  }
}

class MockMicBackend implements MicrophoneBackend {
  private chunkCallback: ((chunk: AudioChunk) => void) | null = null
  public stopCallCount = 0

  async enumerateDevices(): Promise<AudioDevice[]> {
    return [{ id: 'mic-1', label: 'Default Mic', isDefault: true }]
  }

  async start(): Promise<{ sampleRate: number; channels: number }> {
    return { sampleRate: 16000, channels: 1 }
  }

  async stop(): Promise<void> {
    this.stopCallCount++
    this.chunkCallback = null
  }

  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.chunkCallback = callback
    return () => {
      this.chunkCallback = null
    }
  }

  emit(chunk: AudioChunk): void {
    this.chunkCallback?.(chunk)
  }
}

class MockLoopbackBackend implements SystemLoopbackBackend {
  private chunkCallback: ((chunk: AudioChunk) => void) | null = null
  public stopCallCount = 0

  async start(): Promise<{ sampleRate: number; channels: number }> {
    return { sampleRate: 48000, channels: 2 }
  }

  async stop(): Promise<void> {
    this.stopCallCount++
    this.chunkCallback = null
  }

  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.chunkCallback = callback
    return () => {
      this.chunkCallback = null
    }
  }

  emit(chunk: AudioChunk): void {
    this.chunkCallback?.(chunk)
  }
}

describe('P2.4 Audio Lifecycle & Privacy Invariants', () => {
  let micBackend: MockMicBackend
  let loopbackBackend: MockLoopbackBackend
  let micCapturer: MicrophoneCapturer
  let loopbackCapturer: SystemLoopbackCapturer
  let supervisor: IntegratedAudioSupervisor

  beforeEach(() => {
    micBackend = new MockMicBackend()
    loopbackBackend = new MockLoopbackBackend()
    micCapturer = new MicrophoneCapturer(micBackend)
    loopbackCapturer = new SystemLoopbackCapturer(loopbackBackend)
    supervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)
  })

  describe('Microphone Privacy & Pause Lifecycle', () => {
    it('discards all incoming audio chunks while paused to prevent covert monitoring', async () => {
      await micCapturer.start()
      expect(micCapturer.getStatus()).toBe('active')

      // Emit chunk while active -> should be recorded
      const chunk1 = createFakeChunk('mic')
      micBackend.emit(chunk1)
      expect(micCapturer.getBufferStats().chunkCount).toBe(1)

      // Pause capture
      micCapturer.pause()
      expect(micCapturer.getStatus()).toBe('paused')

      // Emit chunk while paused -> MUST be discarded immediately
      const chunk2 = createFakeChunk('mic')
      micBackend.emit(chunk2)
      expect(micCapturer.getBufferStats().chunkCount).toBe(1) // Still 1, chunk2 discarded

      // Resume capture
      micCapturer.resume()
      expect(micCapturer.getStatus()).toBe('active')

      // Emit chunk while resumed -> should be recorded
      const chunk3 = createFakeChunk('mic')
      micBackend.emit(chunk3)
      expect(micCapturer.getBufferStats().chunkCount).toBe(2)
    })

    it('flushes memory buffers to zero retention on stop', async () => {
      await micCapturer.start()
      micBackend.emit(createFakeChunk('mic'))
      micBackend.emit(createFakeChunk('mic'))
      expect(micCapturer.getBufferStats().chunkCount).toBe(2)
      expect(micCapturer.getBufferStats().totalBytes).toBeGreaterThan(0)

      await micCapturer.stop()
      expect(micCapturer.getStatus()).toBe('idle')
      expect(micCapturer.getBufferStats().chunkCount).toBe(0)
      expect(micCapturer.getBufferStats().totalBytes).toBe(0)
      expect(micCapturer.getBufferStats().newestTimestamp).toBeNull()
      expect(micBackend.stopCallCount).toBe(1)
    })
  })

  describe('System Loopback Privacy & Pause Lifecycle', () => {
    it('discards all loopback chunks while paused to preserve privacy', async () => {
      await loopbackCapturer.start()
      expect(loopbackCapturer.getStatus()).toBe('active')

      loopbackBackend.emit(createFakeChunk('system'))
      expect(loopbackCapturer.getBufferStats().chunkCount).toBe(1)

      loopbackCapturer.pause()
      expect(loopbackCapturer.getStatus()).toBe('paused')

      // Emitting while paused must be dropped
      loopbackBackend.emit(createFakeChunk('system'))
      expect(loopbackCapturer.getBufferStats().chunkCount).toBe(1)

      loopbackCapturer.resume()
      expect(loopbackCapturer.getStatus()).toBe('active')

      loopbackBackend.emit(createFakeChunk('system'))
      expect(loopbackCapturer.getBufferStats().chunkCount).toBe(2)
    })

    it('flushes loopback buffers to zero retention on stop', async () => {
      await loopbackCapturer.start()
      loopbackBackend.emit(createFakeChunk('system'))
      expect(loopbackCapturer.getBufferStats().chunkCount).toBe(1)

      await loopbackCapturer.stop()
      expect(loopbackCapturer.getStatus()).toBe('idle')
      expect(loopbackCapturer.getBufferStats().chunkCount).toBe(0)
      expect(loopbackCapturer.getBufferStats().totalBytes).toBe(0)
      expect(loopbackBackend.stopCallCount).toBe(1)
    })
  })

  describe('IntegratedAudioSupervisor Lifecycle Coordination', () => {
    it('pauses and resumes all active sources together via pauseAll / resumeAll', async () => {
      await supervisor.setAudioConfig({ mic: true, system: true })
      expect(supervisor.getState().mic.status).toBe('active')
      expect(supervisor.getState().system.status).toBe('active')

      const stateChanges: string[] = []
      supervisor.onStateChanged((s) => stateChanges.push(`${s.mic.status}/${s.system.status}`))

      supervisor.pauseAll()
      expect(supervisor.getState().mic.status).toBe('paused')
      expect(supervisor.getState().system.status).toBe('paused')
      expect(supervisor.getState().mic.enabled).toBe(true)
      expect(supervisor.getState().system.enabled).toBe(true)

      supervisor.resumeAll()
      expect(supervisor.getState().mic.status).toBe('active')
      expect(supervisor.getState().system.status).toBe('active')

      expect(stateChanges).toContain('paused/paused')
      expect(stateChanges).toContain('active/active')
    })

    it('pauses and resumes via setAudioConfig with paused parameter', async () => {
      await supervisor.setAudioConfig({ mic: true, system: true })

      await supervisor.setAudioConfig({ mic: true, system: true, paused: true })
      expect(supervisor.getState().mic.status).toBe('paused')
      expect(supervisor.getState().system.status).toBe('paused')

      await supervisor.setAudioConfig({ mic: true, system: true, paused: false })
      expect(supervisor.getState().mic.status).toBe('active')
      expect(supervisor.getState().system.status).toBe('active')
    })

    it('teardown stops both audio backends and resets states on stopAll', async () => {
      await supervisor.setAudioConfig({ mic: true, system: true })
      micBackend.emit(createFakeChunk('mic'))
      loopbackBackend.emit(createFakeChunk('system'))

      await supervisor.stopAll()

      const state = supervisor.getState()
      expect(state.mic.status).toBe('idle')
      expect(state.system.status).toBe('idle')
      expect(state.mic.bufferStats.chunkCount).toBe(0)
      expect(state.system.bufferStats.chunkCount).toBe(0)
      expect(micBackend.stopCallCount).toBe(1)
      expect(loopbackBackend.stopCallCount).toBe(1)
    })
  })
})

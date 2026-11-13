import { describe, it, expect, vi } from 'vitest'
import { ElectronMicrophoneBackend } from '@/main/capture/electron-microphone-backend'
import type { AudioChunk } from '@/shared/contracts/audio'

describe('ElectronMicrophoneBackend', () => {
  it('enumerates available default microphone device', async () => {
    const backend = new ElectronMicrophoneBackend()
    const devices = await backend.enumerateDevices()
    expect(devices).toHaveLength(1)
    expect(devices[0].id).toBe('default')
    expect(devices[0].isDefault).toBe(true)
  })

  it('starts capture with default or explicit device ID', async () => {
    const backend = new ElectronMicrophoneBackend({ sampleRate: 16000, channels: 1 })
    expect(backend.isActive()).toBe(false)
    expect(backend.getSelectedDeviceId()).toBeNull()

    const meta = await backend.start('custom-mic-id')
    expect(meta.sampleRate).toBe(16000)
    expect(meta.channels).toBe(1)
    expect(backend.isActive()).toBe(true)
    expect(backend.getSelectedDeviceId()).toBe('custom-mic-id')
  })

  it('rejects duplicate start while active fail-closed', async () => {
    const backend = new ElectronMicrophoneBackend()
    await backend.start()
    await expect(backend.start()).rejects.toThrow('ElectronMicrophoneBackend is already started')
  })

  it('delivers chunks to listeners when active and stops delivering after stop', async () => {
    const backend = new ElectronMicrophoneBackend()
    await backend.start()

    const chunkListener = vi.fn()
    backend.onAudioChunk(chunkListener)

    const fakeChunk: AudioChunk = {
      id: 'chunk-1',
      source: 'mic',
      timestamp: 1000,
      durationMs: 20,
      sampleRate: 16000,
      channels: 1,
      data: new Uint8Array([0, 1, 2, 3]),
      rms: 0.05,
      isSpeech: false
    }

    backend.emitChunk(fakeChunk)
    expect(chunkListener).toHaveBeenCalledWith(fakeChunk)

    await backend.stop()
    expect(backend.isActive()).toBe(false)
    expect(backend.getSelectedDeviceId()).toBeNull()

    // Emitting chunk after stop should not trigger listener
    backend.emitChunk(fakeChunk)
    expect(chunkListener).toHaveBeenCalledOnce()
  })
})

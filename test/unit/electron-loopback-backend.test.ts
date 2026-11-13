import { describe, it, expect, vi } from 'vitest'
import {
  ElectronLoopbackBackend,
  type SessionWithDisplayMediaHandler
} from '../../src/main/capture/electron-loopback-backend'
import type { AudioChunk } from '../../src/shared/contracts/audio'

describe('ElectronLoopbackBackend', () => {
  it('registers displayMediaRequestHandler with audio: loopback on start', async () => {
    let registeredHandler:
      | ((
          request: { frame?: unknown; audioRequested?: boolean },
          callback: (response: { audio?: 'loopback' }) => void
        ) => void)
      | null = null

    const mockSession: SessionWithDisplayMediaHandler = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler
      })
    }

    const backend = new ElectronLoopbackBackend({ session: mockSession, sampleRate: 48000, channels: 2 })
    expect(backend.isActive()).toBe(false)

    const initResult = await backend.start()
    expect(initResult).toEqual({ sampleRate: 48000, channels: 2 })
    expect(backend.isActive()).toBe(true)
    expect(mockSession.setDisplayMediaRequestHandler).toHaveBeenCalledTimes(1)

    // Test handler authorization
    const callbackSpy = vi.fn()
    expect(registeredHandler).not.toBeNull()
    registeredHandler!({}, callbackSpy)
    expect(callbackSpy).toHaveBeenCalledWith({ audio: 'loopback' })
  })

  it('rejects concurrent start calls', async () => {
    const backend = new ElectronLoopbackBackend()
    await backend.start()
    await expect(backend.start()).rejects.toThrow(/already started/)
    await backend.stop()
  })

  it('installs fail-closed deny handler on stop and unregisters listeners', async () => {
    let currentHandler:
      | ((
          request: { frame?: unknown; audioRequested?: boolean },
          callback: (response: { audio?: 'loopback' }) => void
        ) => void)
      | null = null

    const mockSession: SessionWithDisplayMediaHandler = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        currentHandler = handler
      })
    }

    const backend = new ElectronLoopbackBackend({ session: mockSession })
    await backend.start()
    await backend.stop()

    expect(backend.isActive()).toBe(false)
    // On stop, handler must deny any subsequent request
    const callbackSpy = vi.fn()
    expect(currentHandler).not.toBeNull()
    currentHandler!({}, callbackSpy)
    expect(callbackSpy).toHaveBeenCalledWith({})
  })

  it('delivers chunks to subscriber when active, ignores when stopped', async () => {
    const backend = new ElectronLoopbackBackend()
    const received: AudioChunk[] = []
    const unsubscribe = backend.onAudioChunk((c) => received.push(c))

    await backend.start()

    const fakeChunk: AudioChunk = {
      id: 'test-c1',
      source: 'system',
      timestamp: Date.now(),
      durationMs: 20,
      sampleRate: 48000,
      channels: 2,
      data: new Uint8Array(100),
      rms: 0.08,
      isSpeech: false
    }

    backend.emitChunk(fakeChunk)
    expect(received).toHaveLength(1)

    unsubscribe()
    backend.emitChunk(fakeChunk)
    expect(received).toHaveLength(1)

    await backend.stop()
  })
})

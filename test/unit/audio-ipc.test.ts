import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerIpcHandlers,
  unregisterIpcHandlers,
  type IpcMainLike
} from '../../src/main/ipc/register-handlers'
import { IPC_CHANNELS, type IpcResponse } from '../../src/shared/contracts/ipc'
import type { AudioSessionState, AudioDevice, AudioConfig } from '../../src/shared/contracts/audio'
import type { IntegratedAudioSupervisor } from '../../src/main/capture/integrated-audio-supervisor'
import type { DisplayManager } from '../../src/main/displays/display-manager'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0', isPackaged: false },
  ipcMain: {},
  screen: {
    getAllDisplays: () => [],
    getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    on: () => {},
    removeListener: () => {}
  },
  desktopCapturer: {
    getSources: vi.fn(async () => [])
  }
}))

class FakeIpc implements IpcMainLike {
  handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>()

  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown) {
    this.handlers.set(channel, handler)
  }

  removeHandler(channel: string) {
    this.handlers.delete(channel)
  }

  async invoke<T>(channel: string, payload?: unknown, event: unknown = 'authorized'): Promise<IpcResponse<T>> {
    const fn = this.handlers.get(channel)
    if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
    return fn(event, payload) as Promise<IpcResponse<T>>
  }
}

describe('P2.3 Audio IPC Registration and Validation', () => {
  let ipc: FakeIpc
  let mockSupervisor: {
    getState: ReturnType<typeof vi.fn>
    setAudioConfig: ReturnType<typeof vi.fn>
    enumerateDevices: ReturnType<typeof vi.fn>
    stopAll: ReturnType<typeof vi.fn>
    onStateChanged: ReturnType<typeof vi.fn>
  }
  let mockWebContents: {
    send: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
  }
  let stateListenerCallback: ((state: AudioSessionState) => void) | null = null

  const defaultAudioState: AudioSessionState = {
    mic: {
      enabled: false,
      status: 'idle',
      deviceId: null,
      bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null },
      vad: { isSpeech: false, rms: 0, speechDurationMs: 0, silenceDurationMs: 0 },
      errorMessage: null
    },
    system: {
      enabled: false,
      status: 'idle',
      bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null },
      errorMessage: null
    }
  }

  beforeEach(() => {
    ipc = new FakeIpc()
    stateListenerCallback = null
    mockSupervisor = {
      getState: vi.fn(() => defaultAudioState),
      setAudioConfig: vi.fn(async (config: AudioConfig): Promise<AudioSessionState> => {
        return {
          mic: {
            ...defaultAudioState.mic,
            enabled: Boolean(config.mic),
            status: config.mic ? 'active' : 'idle'
          },
          system: {
            ...defaultAudioState.system,
            enabled: Boolean(config.system),
            status: config.system ? 'active' : 'idle'
          }
        }
      }),
      enumerateDevices: vi.fn(async (): Promise<AudioDevice[]> => [
        { id: 'default', label: 'Default Microphone', isDefault: true }
      ]),
      stopAll: vi.fn(async () => {}),
      onStateChanged: vi.fn((cb: (state: AudioSessionState) => void) => {
        stateListenerCallback = cb
        return () => {
          stateListenerCallback = null
        }
      })
    }

    mockWebContents = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }
  })

  it('rejects unauthorized senders across all audio IPC channels fail-closed', async () => {
    registerIpcHandlers(
      ipc,
      { validate: (event: unknown) => ({ valid: event === 'authorized' }) },
      undefined,
      undefined,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    const getStateRes = await ipc.invoke(IPC_CHANNELS.AUDIO_GET_STATE, undefined, 'unauthorized')
    expect(getStateRes.ok).toBe(false)
    if (!getStateRes.ok) {
      expect(getStateRes.error.code).toBe('UNAUTHORIZED_SENDER')
    }

    const setConfigRes = await ipc.invoke(
      IPC_CHANNELS.AUDIO_SET_CONFIG,
      { mic: true, system: false },
      'unauthorized'
    )
    expect(setConfigRes.ok).toBe(false)
    if (!setConfigRes.ok) {
      expect(setConfigRes.error.code).toBe('UNAUTHORIZED_SENDER')
    }

    const getDevicesRes = await ipc.invoke(IPC_CHANNELS.AUDIO_GET_DEVICES, undefined, 'unauthorized')
    expect(getDevicesRes.ok).toBe(false)
    if (!getDevicesRes.ok) {
      expect(getDevicesRes.error.code).toBe('UNAUTHORIZED_SENDER')
    }
  })

  it('returns current audio session state on AUDIO_GET_STATE', async () => {
    registerIpcHandlers(
      ipc,
      { validate: () => ({ valid: true }) },
      undefined,
      undefined,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    const res = await ipc.invoke<AudioSessionState>(IPC_CHANNELS.AUDIO_GET_STATE)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toEqual(defaultAudioState)
    }
    expect(mockSupervisor.getState).toHaveBeenCalledOnce()
  })

  it('applies valid audio configuration and returns updated state', async () => {
    registerIpcHandlers(
      ipc,
      { validate: () => ({ valid: true }) },
      undefined,
      undefined,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    const config: AudioConfig = { mic: true, system: true }
    const res = await ipc.invoke<AudioSessionState>(IPC_CHANNELS.AUDIO_SET_CONFIG, config)

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.mic.enabled).toBe(true)
      expect(res.data.mic.status).toBe('active')
      expect(res.data.system.enabled).toBe(true)
      expect(res.data.system.status).toBe('active')
    }
    expect(mockSupervisor.setAudioConfig).toHaveBeenCalledWith(config)
  })

  it('fails closed when AUDIO_SET_CONFIG receives invalid schema payload', async () => {
    registerIpcHandlers(
      ipc,
      { validate: () => ({ valid: true }) },
      undefined,
      undefined,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    const invalidPayload = { mic: 'not-a-boolean' }
    const res = await ipc.invoke(IPC_CHANNELS.AUDIO_SET_CONFIG, invalidPayload)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_AUDIO_CONFIG')
    }
    expect(mockSupervisor.setAudioConfig).not.toHaveBeenCalled()
  })

  it('enumerates audio input devices on AUDIO_GET_DEVICES', async () => {
    registerIpcHandlers(
      ipc,
      { validate: () => ({ valid: true }) },
      undefined,
      undefined,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    const res = await ipc.invoke<AudioDevice[]>(IPC_CHANNELS.AUDIO_GET_DEVICES)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1)
      expect(res.data[0].id).toBe('default')
    }
    expect(mockSupervisor.enumerateDevices).toHaveBeenCalledOnce()
  })

  it('returns fail-closed error when audio supervisor is not provided', async () => {
    registerIpcHandlers(
      ipc,
      { validate: () => ({ valid: true }) },
      undefined,
      undefined,
      undefined,
      undefined // No supervisor
    )

    const getStateRes = await ipc.invoke(IPC_CHANNELS.AUDIO_GET_STATE)
    expect(getStateRes.ok).toBe(false)
    if (!getStateRes.ok) {
      expect(getStateRes.error.code).toBe('AUDIO_UNAVAILABLE')
    }

    const setConfigRes = await ipc.invoke(IPC_CHANNELS.AUDIO_SET_CONFIG, { mic: true, system: false })
    expect(setConfigRes.ok).toBe(false)
    if (!setConfigRes.ok) {
      expect(setConfigRes.error.code).toBe('AUDIO_UNAVAILABLE')
    }

    const getDevicesRes = await ipc.invoke<AudioDevice[]>(IPC_CHANNELS.AUDIO_GET_DEVICES)
    expect(getDevicesRes.ok).toBe(true)
    if (getDevicesRes.ok) {
      expect(getDevicesRes.data).toEqual([])
    }
  })

  it('forwards audio state changes to trusted webContents when registered with validation context', () => {
    registerIpcHandlers(
      ipc,
      {
        trustedWebContents: mockWebContents as unknown as Electron.WebContents,
        isAllowedOrigin: () => true
      },
      undefined as unknown as DisplayManager,
      undefined,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    expect(stateListenerCallback).not.toBeNull()
    const updatedState: AudioSessionState = {
      ...defaultAudioState,
      mic: { ...defaultAudioState.mic, enabled: true, status: 'active' }
    }

    stateListenerCallback!(updatedState)

    expect(mockWebContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.AUDIO_STATE_CHANGED,
      updatedState
    )
  })

  it('unregisters audio supervisor listener on unregisterIpcHandlers', () => {
    registerIpcHandlers(
      ipc,
      {
        trustedWebContents: mockWebContents as unknown as Electron.WebContents,
        isAllowedOrigin: () => true
      },
      undefined as unknown as DisplayManager,
      undefined,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    expect(stateListenerCallback).not.toBeNull()
    unregisterIpcHandlers(ipc)
    expect(stateListenerCallback).toBeNull()
  })

  it('guarantees audio teardown via stopAll on SESSION_STOP even if screen capturer stop throws', async () => {
    const failingCapturer = {
      stop: vi.fn(async () => {
        throw new Error('Screen backend hardware release failed')
      }),
      getStatus: () => 'error' as const,
      onStatusChange: () => () => {},
      getActiveDisplayId: () => null,
      getBufferStats: () => ({ frameCount: 0, totalBytes: 0, newestTimestamp: null })
    }

    registerIpcHandlers(
      ipc,
      { validate: () => ({ valid: true }) },
      undefined,
      failingCapturer as never,
      undefined,
      mockSupervisor as unknown as IntegratedAudioSupervisor
    )

    const res = await ipc.invoke(IPC_CHANNELS.SESSION_STOP)

    // Stop must fail closed with error from the failed screen capturer
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CAPTURE_STOP_FAILED')
      expect(res.error.message).toContain('Screen backend hardware release failed')
    }

    // Audio supervisor stopAll must still have been called to guarantee zero retention
    expect(mockSupervisor.stopAll).toHaveBeenCalledOnce()
  })
})

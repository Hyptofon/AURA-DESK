import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
const mockExposeInMainWorld = vi.fn()
const mockOn = vi.fn()
const mockRemoveListener = vi.fn()

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: (...args: unknown[]) => mockInvoke(...args),
    on: (...args: unknown[]) => mockOn(...args),
    removeListener: (...args: unknown[]) => mockRemoveListener(...args)
  },
  contextBridge: {
    exposeInMainWorld: (...args: unknown[]) => mockExposeInMainWorld(...args)
  }
}))

import { auraApi, exposeAuraApi } from '../../src/preload/index'
import { IPC_CHANNELS } from '../../src/shared/contracts/channels'

describe('Real Preload AuraApi and Context Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Real auraApi object shape and security boundaries', () => {
    it('has expected metadata properties', () => {
      expect(auraApi.platform).toBe(process.platform)
      expect(auraApi.version).toBe('0.1.0')
      expect(typeof auraApi.getAppInfo).toBe('function')
      expect(typeof auraApi.getSessionState).toBe('function')
      expect(typeof auraApi.setCaptureSelection).toBe('function')
      expect(typeof auraApi.getDisplays).toBe('function')
      expect(typeof auraApi.onDisplaysChanged).toBe('function')
      expect(typeof auraApi.startSession).toBe('function')
      expect(typeof auraApi.stopSession).toBe('function')
    })

    it('does not expose raw Node or Electron APIs on auraApi', () => {
      const apiRecord = auraApi as unknown as Record<string, unknown>
      const forbiddenProperties = [
        'ipcRenderer',
        'require',
        'process',
        'fs',
        'child_process',
        'send',
        'invoke',
        'on',
        'removeAllListeners'
      ]

      for (const prop of forbiddenProperties) {
        expect(apiRecord[prop]).toBeUndefined()
      }
    })
  })

  describe('Real auraApi method invocations via ipcRenderer', () => {
    it('calls APP_GET_INFO channel and unwraps successful data', async () => {
      const expectedData = {
        name: 'aura-desk',
        version: '0.1.0',
        platform: 'win32',
        isPackaged: false
      }
      mockInvoke.mockResolvedValueOnce({ ok: true, data: expectedData })

      const result = await auraApi.getAppInfo()

      expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.APP_GET_INFO, undefined)
      expect(result).toEqual(expectedData)
    })

    it('calls SESSION_GET_STATE channel and unwraps state data', async () => {
      mockInvoke.mockResolvedValueOnce({ ok: true, data: { status: 'idle' } })

      const result = await auraApi.getSessionState()

      expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_GET_STATE, undefined)
      expect(result).toEqual({ status: 'idle' })
    })

    it('calls SESSION_SET_SELECTION channel with payload and returns selection', async () => {
      const selection = { mode: 'single' as const, displayId: 'disp-01' }
      mockInvoke.mockResolvedValueOnce({
        ok: true,
        data: { success: true, selection }
      })

      const result = await auraApi.setCaptureSelection(selection)

      expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_SET_SELECTION, selection)
      expect(result.success).toBe(true)
      expect(result.selection).toEqual(selection)
    })

    it('calls SESSION_START channel with optional selection and unwraps response', async () => {
      const selection = { mode: 'single' as const, displayId: 'disp-01' }
      mockInvoke.mockResolvedValueOnce({
        ok: true,
        data: { success: true, status: 'active', displayId: 'disp-01' }
      })

      const result = await auraApi.startSession!(selection)

      expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_START, { selection })
      expect(result).toEqual({ success: true, status: 'active', displayId: 'disp-01' })
    })

    it('calls SESSION_STOP channel and unwraps response', async () => {
      mockInvoke.mockResolvedValueOnce({
        ok: true,
        data: { success: true, status: 'idle' }
      })

      const result = await auraApi.stopSession!()

      expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_STOP, undefined)
      expect(result).toEqual({ success: true, status: 'idle' })
    })

    it('calls DISPLAYS_GET_ALL channel and unwraps display configuration data', async () => {
      const mockConfig = {
        displays: [
          {
            id: '1',
            label: 'Display 1 (Primary)',
            isPrimary: true,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1.0,
            rotation: 0
          }
        ],
        primaryId: '1',
        count: 1,
        isMultiDisplay: false,
        selectedDisplayLost: false
      }
      mockInvoke.mockResolvedValueOnce({ ok: true, data: mockConfig })

      const result = await auraApi.getDisplays!()

      expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.DISPLAYS_GET_ALL, undefined)
      expect(result).toEqual(mockConfig)
    })

    describe('onDisplaysChanged subscription and cleanup', () => {
      it('registers listener on DISPLAYS_CHANGED channel and delivers events to subscriber', () => {
        const subscriber = vi.fn()
        const unsubscribe = auraApi.onDisplaysChanged!(subscriber)

        expect(mockOn).toHaveBeenCalledTimes(1)
        expect(mockOn).toHaveBeenCalledWith(IPC_CHANNELS.DISPLAYS_CHANGED, expect.any(Function))

        const registeredHandler = mockOn.mock.calls[0][1]

        const eventPayload = {
          displays: [],
          primaryId: '1',
          count: 1,
          isMultiDisplay: false,
          selectedDisplayLost: true
        }

        // Simulate IPC event from main process
        registeredHandler({}, eventPayload)

        expect(subscriber).toHaveBeenCalledTimes(1)
        expect(subscriber).toHaveBeenCalledWith(eventPayload)

        unsubscribe()
      })

      it('returns working unsubscribe function that removes the listener from ipcRenderer', () => {
        const subscriber = vi.fn()
        const unsubscribe = auraApi.onDisplaysChanged!(subscriber)

        const registeredHandler = mockOn.mock.calls[0][1]

        unsubscribe()

        expect(mockRemoveListener).toHaveBeenCalledTimes(1)
        expect(mockRemoveListener).toHaveBeenCalledWith(
          IPC_CHANNELS.DISPLAYS_CHANGED,
          registeredHandler
        )
      })

      it('safely catches errors thrown in subscriber callback without breaking', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const throwingSubscriber = vi.fn().mockImplementation(() => {
          throw new Error('Subscriber runtime error')
        })

        const unsubscribe = auraApi.onDisplaysChanged!(throwingSubscriber)
        const registeredHandler = mockOn.mock.calls[0][1]

        expect(() => registeredHandler({}, { count: 0 })).not.toThrow()
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error in onDisplaysChanged callback:',
          expect.any(Error)
        )

        consoleErrorSpy.mockRestore()
        unsubscribe()
      })
    })

    it('throws typed Error when main process returns an error response', async () => {
      mockInvoke.mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'UNAUTHORIZED_SENDER',
          message: 'Sender is not authorized'
        }
      })

      await expect(auraApi.getAppInfo()).rejects.toThrow(
        '[UNAUTHORIZED_SENDER] Sender is not authorized'
      )
    })

    it('throws generic IPC_ERROR when response is empty or malformed', async () => {
      mockInvoke.mockResolvedValueOnce(null)

      await expect(auraApi.getSessionState()).rejects.toThrow(
        '[IPC_ERROR] IPC request failed'
      )
    })
  })

  describe('Fail-Closed Context Isolation', () => {
    it('throws security error if context isolation is disabled', () => {
      const mockBridge = { exposeInMainWorld: vi.fn() }

      expect(() => exposeAuraApi(mockBridge as never, false)).toThrow(
        /Security violation: contextIsolation must be enabled/
      )
      expect(mockBridge.exposeInMainWorld).not.toHaveBeenCalled()
    })

    it('calls exposeInMainWorld with api when context isolation is enabled', () => {
      const mockBridge = { exposeInMainWorld: vi.fn() }

      expect(() => exposeAuraApi(mockBridge as never, true)).not.toThrow()
      expect(mockBridge.exposeInMainWorld).toHaveBeenCalledWith('api', auraApi)
    })
  })
})

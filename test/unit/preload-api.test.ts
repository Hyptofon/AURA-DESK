import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
const mockExposeInMainWorld = vi.fn()

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: (...args: unknown[]) => mockInvoke(...args)
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

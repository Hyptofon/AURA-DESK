import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerIpcHandlers,
  unregisterIpcHandlers,
  dispatchIpcCall,
  setSessionStatus,
  type IpcMainLike
} from '../../src/main/ipc/register-handlers'
import { IPC_CHANNELS, type IpcResponse } from '../../src/shared/contracts/ipc'

class MockIpcMain implements IpcMainLike {
  public handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>()

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown): void {
    this.handlers.set(channel, listener)
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel)
  }
}

describe('Main Process IPC Handlers', () => {
  let mockIpc: MockIpcMain

  beforeEach(() => {
    mockIpc = new MockIpcMain()
    setSessionStatus('idle')
    registerIpcHandlers(mockIpc)
  })

  it('registers all required allowed channels', () => {
    expect(mockIpc.handlers.has(IPC_CHANNELS.APP_GET_INFO)).toBe(true)
    expect(mockIpc.handlers.has(IPC_CHANNELS.SESSION_GET_STATE)).toBe(true)
    expect(mockIpc.handlers.has(IPC_CHANNELS.SESSION_SET_SELECTION)).toBe(true)
  })

  it('handles APP_GET_INFO and returns valid metadata', async () => {
    const handler = mockIpc.handlers.get(IPC_CHANNELS.APP_GET_INFO)!
    const res = (await handler(null)) as IpcResponse<{ name: string; version: string; platform: string }>

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.name).toBe('aura-desk')
      expect(res.data.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(res.data.platform).toBe(process.platform)
    }
  })

  it('handles SESSION_GET_STATE and returns current status', async () => {
    setSessionStatus('active')
    const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
    const res = (await handler(null)) as IpcResponse<{ status: string }>

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.status).toBe('active')
    }
  })

  describe('SESSION_SET_SELECTION validation', () => {
    it('accepts valid both mode selection', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(null, { mode: 'both' })) as IpcResponse<{ success: boolean; selection: { mode: string } }>

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.success).toBe(true)
        expect(res.data.selection.mode).toBe('both')
      }
    })

    it('accepts valid single mode selection with displayId', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(null, {
        mode: 'single',
        displayId: 'display-1'
      })) as IpcResponse<{ success: boolean; selection: { mode: string; displayId: string } }>

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.success).toBe(true)
        expect(res.data.selection.mode).toBe('single')
        expect(res.data.selection.displayId).toBe('display-1')
      }
    })

    it('rejects invalid single mode missing displayId with Zod error', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(null, { mode: 'single' })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })

    it('rejects invalid mode with Zod error', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(null, { mode: 'unknown-mode' })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })
  })

  describe('Channel authorization and dispatch gate', () => {
    it('denies execution on forbidden channels', async () => {
      const res = await dispatchIpcCall('shell:exec', { cmd: 'calc' }, mockIpc.handlers)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('FORBIDDEN_CHANNEL')
        expect(res.error.message).toContain('shell:exec')
      }
    })

    it('executes allowed channel successfully through dispatcher', async () => {
      const res = await dispatchIpcCall(IPC_CHANNELS.SESSION_GET_STATE, null, mockIpc.handlers)
      expect(res.ok).toBe(true)
    })
  })

  it('unregisters handlers cleanly on teardown', () => {
    unregisterIpcHandlers(mockIpc)
    expect(mockIpc.handlers.size).toBe(0)
  })
})

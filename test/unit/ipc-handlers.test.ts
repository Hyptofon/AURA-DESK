import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerIpcHandlers,
  unregisterIpcHandlers,
  dispatchIpcCall,
  setSessionStatus,
  type IpcMainLike,
  type IpcInvokeEventLike
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

    it('rejects invalid single mode with whitespace-only displayId', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(null, { mode: 'single', displayId: '   ' })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })

    it('rejects payload with unexpected extra keys in strict schema', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(null, { mode: 'both', injectedKey: true })) as IpcResponse<unknown>

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

  describe('Sender and Frame Authorization', () => {
    const trustedWebContents = { id: 1, name: 'main-window-webcontents' }
    const untrustedWebContents = { id: 99, name: 'evil-webcontents' }
    const trustedOrigin = 'http://localhost:5173'

    let securedIpc: MockIpcMain

    beforeEach(() => {
      securedIpc = new MockIpcMain()
      registerIpcHandlers(securedIpc, {
        trustedWebContents,
        trustedOrigin
      })
    })

    it('allows invocation from trusted WebContents and top-level frame matching trusted origin', async () => {
      const handler = securedIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const validEvent: IpcInvokeEventLike = {
        sender: trustedWebContents,
        senderFrame: {
          url: 'http://localhost:5173/index.html',
          parent: null
        }
      }

      const res = (await handler(validEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(true)
    })

    it('denies invocation from untrusted WebContents sender', async () => {
      const handler = securedIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const invalidSenderEvent: IpcInvokeEventLike = {
        sender: untrustedWebContents,
        senderFrame: {
          url: 'http://localhost:5173/index.html',
          parent: null
        }
      }

      const res = (await handler(invalidSenderEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_SENDER')
        expect(res.error.message).toContain('untrusted WebContents')
      }
    })

    it('denies invocation when event is missing or null when trusted sender is configured', async () => {
      const handler = securedIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const res = (await handler(null)) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_SENDER')
      }
    })

    it('denies invocation from nested frame / iframe with parent !== null', async () => {
      const handler = securedIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const iframeEvent: IpcInvokeEventLike = {
        sender: trustedWebContents,
        senderFrame: {
          url: 'http://localhost:5173/embed.html',
          parent: { id: 'parent-frame' }
        }
      }

      const res = (await handler(iframeEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
        expect(res.error.message).toContain('nested frame or iframe is prohibited')
      }
    })

    it('denies invocation when frame.top does not match frame', async () => {
      const handler = securedIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const frameObj = { url: 'http://localhost:5173/sub.html', parent: null }
      const iframeEvent: IpcInvokeEventLike = {
        sender: trustedWebContents,
        senderFrame: {
          ...frameObj,
          top: { id: 'different-root-frame' }
        }
      }

      const res = (await handler(iframeEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
      }
    })

    it('denies invocation when frame URL origin does not match trustedOrigin', async () => {
      const handler = securedIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const untrustedOriginEvent: IpcInvokeEventLike = {
        sender: trustedWebContents,
        senderFrame: {
          url: 'https://attacker.example.com/exploit.html',
          parent: null
        }
      }

      const res = (await handler(untrustedOriginEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
        expect(res.error.message).toContain('untrusted frame origin')
      }
    })

    it('validates payload only after sender authorization passes', async () => {
      const handler = securedIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const validSenderInvalidPayload: IpcInvokeEventLike = {
        sender: trustedWebContents,
        senderFrame: {
          url: 'http://localhost:5173/',
          parent: null
        }
      }

      // With trusted sender, invalid payload yields INVALID_PAYLOAD (not UNAUTHORIZED_SENDER)
      const res = (await handler(validSenderInvalidPayload, { mode: 'invalid' })) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }

      // With untrusted sender, even invalid payload yields UNAUTHORIZED_SENDER
      const untrustedSenderEvent: IpcInvokeEventLike = {
        sender: untrustedWebContents,
        senderFrame: {
          url: 'http://localhost:5173/',
          parent: null
        }
      }
      const resUntrusted = (await handler(untrustedSenderEvent, { mode: 'invalid' })) as IpcResponse<unknown>
      expect(resUntrusted.ok).toBe(false)
      if (!resUntrusted.ok) {
        expect(resUntrusted.error.code).toBe('UNAUTHORIZED_SENDER')
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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerIpcHandlers,
  unregisterIpcHandlers,
  dispatchIpcCall,
  setSessionStatus,
  type IpcMainLike,
  type IpcInvokeEventLike,
  type FrameLike
} from '../../src/main/ipc/register-handlers'
import {
  IPC_CHANNELS,
  type IpcResponse,
  type DisplayConfiguration
} from '../../src/shared/contracts/ipc'
import { DisplayManager } from '../../src/main/displays/display-manager'

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
  const defaultMainFrame: FrameLike = {
    url: 'http://localhost:5173/index.html',
    parent: null
  }
  const defaultWebContents = {
    id: 1,
    name: 'main-window-webcontents',
    mainFrame: defaultMainFrame
  }
  const defaultContext = {
    trustedWebContents: defaultWebContents,
    trustedOrigin: 'http://localhost:5173'
  }

  const makeValidEvent = (): IpcInvokeEventLike => ({
    sender: defaultWebContents,
    senderFrame: defaultMainFrame
  })

  const mockScreenApi = {
    getAllDisplays: () => [
      {
        id: 1,
        label: 'Display 1 (Primary)',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1.0,
        rotation: 0
      }
    ],
    getPrimaryDisplay: () => ({
      id: 1,
      label: 'Display 1 (Primary)',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1.0,
      rotation: 0
    }),
    on: vi.fn(),
    removeListener: vi.fn()
  }

  let defaultDisplayManager: DisplayManager

  beforeEach(() => {
    mockIpc = new MockIpcMain()
    setSessionStatus('idle')
    defaultDisplayManager = new DisplayManager(mockScreenApi as never)
    registerIpcHandlers(mockIpc, defaultContext, defaultDisplayManager)
  })

  it('fails closed and throws error if registered without authorization context', () => {
    const unconfiguredIpc = new MockIpcMain()
    expect(() => registerIpcHandlers(unconfiguredIpc)).toThrow(
      /registerIpcHandlers requires an explicit authorization validator or context/
    )
  })

  it('registers all required allowed channels', () => {
    expect(mockIpc.handlers.has(IPC_CHANNELS.APP_GET_INFO)).toBe(true)
    expect(mockIpc.handlers.has(IPC_CHANNELS.SESSION_GET_STATE)).toBe(true)
    expect(mockIpc.handlers.has(IPC_CHANNELS.SESSION_SET_SELECTION)).toBe(true)
    expect(mockIpc.handlers.has(IPC_CHANNELS.DISPLAYS_GET_ALL)).toBe(true)
  })

  it('handles DISPLAYS_GET_ALL and returns valid display configuration when event is valid', async () => {
    const handler = mockIpc.handlers.get(IPC_CHANNELS.DISPLAYS_GET_ALL)!
    const res = (await handler(makeValidEvent())) as IpcResponse<DisplayConfiguration>

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(Array.isArray(res.data.displays)).toBe(true)
      expect(typeof res.data.primaryId).toBe('string')
      expect(typeof res.data.count).toBe('number')
      expect(typeof res.data.isMultiDisplay).toBe('boolean')
    }
  })

  it('uses custom display manager instance when provided to registerIpcHandlers', async () => {
    const mockScreen = {
      getAllDisplays: () => [
        {
          id: 42,
          label: 'Primary Test Screen',
          bounds: { x: 0, y: 0, width: 2560, height: 1440 },
          workArea: { x: 0, y: 0, width: 2560, height: 1400 },
          scaleFactor: 1.25,
          rotation: 0
        }
      ],
      getPrimaryDisplay: () => ({
        id: 42,
        label: 'Primary Test Screen',
        bounds: { x: 0, y: 0, width: 2560, height: 1440 },
        workArea: { x: 0, y: 0, width: 2560, height: 1400 },
        scaleFactor: 1.25,
        rotation: 0
      }),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const customManager = new DisplayManager(mockScreen as never)
    const customIpc = new MockIpcMain()
    registerIpcHandlers(customIpc, defaultContext, customManager)

    const handler = customIpc.handlers.get(IPC_CHANNELS.DISPLAYS_GET_ALL)!
    const res = (await handler(makeValidEvent())) as IpcResponse<DisplayConfiguration>

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.count).toBe(1)
      expect(res.data.primaryId).toBe('42')
      expect(res.data.displays[0].id).toBe('42')
      expect(res.data.displays[0].bounds.width).toBe(2560)
    }
  })

  it('handles APP_GET_INFO and returns valid metadata when event is valid', async () => {
    const handler = mockIpc.handlers.get(IPC_CHANNELS.APP_GET_INFO)!
    const res = (await handler(makeValidEvent())) as IpcResponse<{
      name: string
      version: string
      platform: string
    }>

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.name).toBe('aura-desk')
      expect(res.data.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(res.data.platform).toBe(process.platform)
    }
  })

  it('handles SESSION_GET_STATE and returns current status when event is valid', async () => {
    setSessionStatus('active')
    const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
    const res = (await handler(makeValidEvent())) as IpcResponse<{ status: string }>

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.status).toBe('active')
    }
  })

  describe('SESSION_SET_SELECTION validation', () => {
    it('accepts valid both mode selection with valid event', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), { mode: 'both' })) as IpcResponse<{
        success: boolean
        selection: { mode: string }
      }>

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.success).toBe(true)
        expect(res.data.selection.mode).toBe('both')
      }
    })

    it('accepts valid single mode selection with displayId and valid event', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), {
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

    it('rejects invalid single mode missing displayId with Zod error after authorization passes', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), { mode: 'single' })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })

    it('rejects invalid single mode with whitespace-only displayId', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), {
        mode: 'single',
        displayId: '   '
      })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })

    it('rejects payload with unexpected extra keys in strict schema', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), {
        mode: 'both',
        injectedKey: true
      })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })

    it('rejects invalid mode with Zod error', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), { mode: 'unknown-mode' })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })
  })

  describe('Fail-Closed Sender and Frame Authorization', () => {
    const untrustedWebContents = { id: 99, name: 'evil-webcontents' }

    it('Scenario 1: denies invocation when senderFrame is missing (undefined)', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const missingFrameEvent: IpcInvokeEventLike = {
        sender: defaultWebContents
      }

      const res = (await handler(missingFrameEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
        expect(res.error.message).toContain('senderFrame is missing, null, or destroyed')
      }
    })

    it('Scenario 2: denies invocation when senderFrame is explicitly null', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const nullFrameEvent: IpcInvokeEventLike = {
        sender: defaultWebContents,
        senderFrame: null
      }

      const res = (await handler(nullFrameEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
        expect(res.error.message).toContain('senderFrame is missing, null, or destroyed')
      }
    })

    it('Scenario 3: denies invocation when senderFrame.url is empty or whitespace', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const emptyUrlEvent: IpcInvokeEventLike = {
        sender: defaultWebContents,
        senderFrame: { url: '   ', parent: null }
      }

      const res = (await handler(emptyUrlEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
        expect(res.error.message).toContain('senderFrame URL is missing or empty')
      }
    })

    it('Scenario 4: denies invocation when senderFrame does not match trustedWebContents.mainFrame', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const wrongMainFrameEvent: IpcInvokeEventLike = {
        sender: defaultWebContents,
        senderFrame: {
          url: 'http://localhost:5173/index.html',
          parent: null
        }
      }

      const res = (await handler(wrongMainFrameEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
        expect(res.error.message).toContain('does not match trustedWebContents.mainFrame')
      }
    })

    it('Scenario 5: denies invocation when event is null or not an object', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const res = (await handler(null)) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_SENDER')
        expect(res.error.message).toContain('requires a valid event with authorized sender')
      }
    })

    it('Scenario 6: allows invocation with valid trusted mainFrame + valid payload', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), { mode: 'both' })) as IpcResponse<{
        success: boolean
        selection: { mode: string }
      }>

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.success).toBe(true)
        expect(res.data.selection.mode).toBe('both')
      }
    })

    it('Scenario 7: returns INVALID_PAYLOAD with valid trusted mainFrame + invalid payload', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_SET_SELECTION)!
      const res = (await handler(makeValidEvent(), { mode: 'invalid-mode' })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_PAYLOAD')
      }
    })

    it('denies invocation from untrusted WebContents sender', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const invalidSenderEvent: IpcInvokeEventLike = {
        sender: untrustedWebContents,
        senderFrame: defaultMainFrame
      }

      const res = (await handler(invalidSenderEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_SENDER')
        expect(res.error.message).toContain('untrusted or missing WebContents sender')
      }
    })

    it('denies invocation from nested frame / iframe with parent !== null', async () => {
      // Create a webContents with no fixed mainFrame reference to test structural hierarchy
      const dynamicWebContents = { id: 2 }
      const customIpc = new MockIpcMain()
      registerIpcHandlers(customIpc, { trustedWebContents: dynamicWebContents })

      const handler = customIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const iframeEvent: IpcInvokeEventLike = {
        sender: dynamicWebContents,
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

    it('denies invocation when frame URL origin does not match trustedOrigin', async () => {
      const untrustedOriginFrame: FrameLike = {
        url: 'https://attacker.example.com/exploit.html',
        parent: null
      }
      const webContentsWithAttackerFrame = {
        id: 3,
        mainFrame: untrustedOriginFrame
      }
      const customIpc = new MockIpcMain()
      registerIpcHandlers(customIpc, {
        trustedWebContents: webContentsWithAttackerFrame,
        trustedOrigin: 'http://localhost:5173'
      })

      const handler = customIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const untrustedOriginEvent: IpcInvokeEventLike = {
        sender: webContentsWithAttackerFrame,
        senderFrame: untrustedOriginFrame
      }

      const res = (await handler(untrustedOriginEvent)) as IpcResponse<unknown>
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_FRAME')
        expect(res.error.message).toContain('untrusted frame origin')
      }
    })
  })

  describe('Channel authorization and dispatch gate', () => {
    it('denies execution on forbidden channels', async () => {
      const res = await dispatchIpcCall('shell:exec', { cmd: 'calc' }, mockIpc.handlers, makeValidEvent())
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('FORBIDDEN_CHANNEL')
        expect(res.error.message).toContain('shell:exec')
      }
    })

    it('executes allowed channel successfully through dispatcher with valid event', async () => {
      const res = await dispatchIpcCall(IPC_CHANNELS.SESSION_GET_STATE, null, mockIpc.handlers, makeValidEvent())
      expect(res.ok).toBe(true)
    })
  })

  it('unregisters handlers cleanly on teardown', () => {
    unregisterIpcHandlers(mockIpc)
    expect(mockIpc.handlers.size).toBe(0)
  })
})

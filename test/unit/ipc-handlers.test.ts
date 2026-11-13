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
  DisplayConfigurationSchema,
  type IpcResponse,
  type DisplayConfiguration,
  type SessionStatus
} from '../../src/shared/contracts/ipc'
import type { ScreenCapturePort } from '../../src/shared/contracts/capture'
import type { SingleDisplayCapturer } from '../../src/main/capture/single-display-capturer'
import { DisplayManager, forwardDisplayEvents } from '../../src/main/displays/display-manager'

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

  describe('SESSION_START and SESSION_STOP IPC Handlers', () => {
    let mockCapturer: {
      start: ReturnType<typeof vi.fn>
      stop: ReturnType<typeof vi.fn>
      isActive: ReturnType<typeof vi.fn>
      getActiveDisplayId: ReturnType<typeof vi.fn>
      getStatus: ReturnType<typeof vi.fn>
      getLastError: ReturnType<typeof vi.fn>
      onStatusChange: ReturnType<typeof vi.fn>
    }
    let currentMockStatus: string
    let statusListener: ((status: string, error?: string) => void) | null = null

    beforeEach(() => {
      currentMockStatus = 'idle'
      statusListener = null

      mockCapturer = {
        start: vi.fn().mockImplementation(async (id: string) => {
          if (id === 'error-id') {
            currentMockStatus = 'error'
            throw new Error('Display not found')
          }
          currentMockStatus = 'active'
        }),
        stop: vi.fn().mockImplementation(async () => {
          currentMockStatus = 'idle'
        }),
        isActive: vi.fn().mockImplementation(() => currentMockStatus === 'active'),
        getActiveDisplayId: vi.fn().mockReturnValue(null),
        getStatus: vi.fn().mockImplementation(() => currentMockStatus),
        getLastError: vi.fn().mockReturnValue(null),
        onStatusChange: vi.fn().mockImplementation((fn) => {
          statusListener = fn
          return () => {
            statusListener = null
          }
        })
      }

      registerIpcHandlers(
        mockIpc,
        defaultContext,
        defaultDisplayManager,
        mockCapturer as never
      )
    })

    it('starts single display capture session successfully', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_START)!
      const res = (await handler(makeValidEvent(), {
        selection: { mode: 'single', displayId: '101' }
      })) as IpcResponse<{ success: boolean; status: string; displayId: string }>

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.success).toBe(true)
        expect(res.data.status).toBe('active')
        expect(res.data.displayId).toBe('101')
      }
      expect(mockCapturer.start).toHaveBeenCalledWith('101')
    })

    it('rejects mode both with UNSUPPORTED_MODE for milestone P1.2', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_START)!
      const res = (await handler(makeValidEvent(), {
        selection: { mode: 'both' }
      })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNSUPPORTED_MODE')
        expect(res.error.message).toContain('P1.3')
      }
      expect(mockCapturer.start).not.toHaveBeenCalled()
    })

    it('returns CAPTURE_START_FAILED when capturer fails to start', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_START)!
      const res = (await handler(makeValidEvent(), {
        selection: { mode: 'single', displayId: 'error-id' }
      })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('CAPTURE_START_FAILED')
        expect(res.error.message).toContain('Display not found')
      }
    })

    it('stops active session cleanly and transitions status to idle', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_STOP)!
      const res = (await handler(makeValidEvent())) as IpcResponse<{
        success: boolean
        status: string
      }>

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.success).toBe(true)
        expect(res.data.status).toBe('idle')
      }
      expect(mockCapturer.stop).toHaveBeenCalledTimes(1)
    })

    it('denies SESSION_START when sender is unauthorized', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_START)!
      const res = (await handler({ sender: { id: 999 } })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_SENDER')
      }
    })

    it('denies SESSION_STOP when sender is unauthorized', async () => {
      const handler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_STOP)!
      const res = (await handler({ sender: { id: 999 } })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('UNAUTHORIZED_SENDER')
      }
    })

    it('SESSION_GET_STATE queries capturer status as authoritative single source of truth', async () => {
      const getStateHandler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const startHandler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_START)!

      // Initially idle
      let stateRes = (await getStateHandler(makeValidEvent())) as IpcResponse<{ status: string }>
      expect(stateRes.ok).toBe(true)
      if (stateRes.ok) {
        expect(stateRes.data.status).toBe('idle')
      }

      // Start session -> becomes active
      await startHandler(makeValidEvent(), {
        selection: { mode: 'single', displayId: '101' }
      })

      stateRes = (await getStateHandler(makeValidEvent())) as IpcResponse<{ status: string }>
      expect(stateRes.ok).toBe(true)
      if (stateRes.ok) {
        expect(stateRes.data.status).toBe('active')
      }
    })

    it('synchronizes status to error when capturer stops unexpectedly and recovers on stop', async () => {
      const getStateHandler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_GET_STATE)!
      const startHandler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_START)!
      const stopHandler = mockIpc.handlers.get(IPC_CHANNELS.SESSION_STOP)!

      // Start session
      await startHandler(makeValidEvent(), {
        selection: { mode: 'single', displayId: '101' }
      })

      // Simulate unexpected stop (e.g. display loss or source disappeared)
      currentMockStatus = 'error'

      const stateRes = (await getStateHandler(makeValidEvent())) as IpcResponse<{ status: string }>
      expect(stateRes.ok).toBe(true)
      if (stateRes.ok) {
        expect(stateRes.data.status).toBe('error')
      }

      // Recovery via explicit stop call
      const stopRes = (await stopHandler(makeValidEvent())) as IpcResponse<{ status: string }>
      expect(stopRes.ok).toBe(true)
      if (stopRes.ok) {
        expect(stopRes.data.status).toBe('idle')
      }
    })

    it('fails closed and returns error if capturer.start() does not reach active state', async () => {
      let mockStatus = 'idle'
      const customCapturer: ScreenCapturePort = {
        start: vi.fn().mockImplementation(async () => {
          mockStatus = 'idle'
        }),
        stop: vi.fn().mockImplementation(async () => {
          mockStatus = 'idle'
        }),
        getStatus: () => mockStatus as SessionStatus,
        getLastError: () => null,
        onStatusChange: () => () => {},
        getLatestFrame: () => null,
        getFrameHistory: () => [],
        getBufferStats: () => ({ frameCount: 0, totalBytes: 0, oldestTimestamp: null, newestTimestamp: null, displayId: null }),
        isActive: () => mockStatus === 'active',
        getActiveDisplayId: () => null
      }

      const customIpc = new MockIpcMain()
      registerIpcHandlers(
        customIpc,
        { trustedWebContents: defaultWebContents },
        undefined,
        customCapturer as unknown as SingleDisplayCapturer
      )

      const startHandler = customIpc.handlers.get(IPC_CHANNELS.SESSION_START)!
      const res = (await startHandler(makeValidEvent(), {
        selection: { mode: 'single', displayId: '101' }
      })) as IpcResponse<unknown>

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('CAPTURE_START_ABORTED')
        expect(res.error.message).toContain('did not reach active state')
      }
    })

    it('properly awaits asynchronous stop before returning response', async () => {
      let stopAwaited = false
      const customCapturer: ScreenCapturePort = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          stopAwaited = true
        }),
        getStatus: () => 'idle',
        getLastError: () => null,
        onStatusChange: () => () => {},
        getLatestFrame: () => null,
        getFrameHistory: () => [],
        getBufferStats: () => ({ frameCount: 0, totalBytes: 0, oldestTimestamp: null, newestTimestamp: null, displayId: null }),
        isActive: () => false,
        getActiveDisplayId: () => null
      }

      const customIpc = new MockIpcMain()
      registerIpcHandlers(
        customIpc,
        { trustedWebContents: defaultWebContents },
        undefined,
        customCapturer as unknown as SingleDisplayCapturer
      )

      const stopHandler = customIpc.handlers.get(IPC_CHANNELS.SESSION_STOP)!
      const res = (await stopHandler(makeValidEvent())) as IpcResponse<{ success: boolean; status: string }>

      expect(stopAwaited).toBe(true)
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.success).toBe(true)
        expect(res.data.status).toBe('idle')
      }
    })

    it('forwards SESSION_STATUS_CHANGED event to trusted webContents on unexpected termination', () => {
      const mockWebContentsWithSend = {
        id: 1,
        mainFrame: defaultMainFrame,
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn()
      }

      registerIpcHandlers(
        mockIpc,
        {
          trustedWebContents: mockWebContentsWithSend,
          trustedOrigin: 'http://localhost:5173'
        },
        defaultDisplayManager,
        mockCapturer as never
      )

      expect(statusListener).not.toBeNull()
      statusListener!('error', 'SELECTED_DISPLAY_LOST')

      expect(mockWebContentsWithSend.send).toHaveBeenCalledWith(
        IPC_CHANNELS.SESSION_STATUS_CHANGED,
        { status: 'error', error: 'SELECTED_DISPLAY_LOST' }
      )
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

  describe('Display Hotplug Event Forwarding Pipeline', () => {
    it('pipeline delivers validated aura:displays-changed message from screen mock to WebContents', () => {
      const mockWebContents = {
        id: 1,
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn()
      }

      const screenApi = {
        displays: [
          {
            id: 1,
            label: 'Monitor 1',
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1.0,
            rotation: 0
          }
        ],
        primaryDisplay: null as unknown,
        listeners: {} as Record<string, ((...args: unknown[]) => void)[]>,
        getAllDisplays() {
          return this.displays
        },
        getPrimaryDisplay() {
          return this.displays[0]
        },
        on(event: string, fn: (...args: unknown[]) => void) {
          if (!this.listeners[event]) this.listeners[event] = []
          this.listeners[event].push(fn)
          return this
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((l) => l !== fn)
          }
          return this
        }
      }

      const manager = new DisplayManager(screenApi as never)
      const stopForwarding = forwardDisplayEvents(mockWebContents, manager)

      // Simulate a hotplug addition
      screenApi.displays.push({
        id: 2,
        label: 'Monitor 2',
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1.0,
        rotation: 0
      })

      // Trigger the screen listener
      screenApi.listeners['display-added']?.[0]?.({}, screenApi.displays[1])

      expect(mockWebContents.send).toHaveBeenCalledTimes(1)
      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.DISPLAYS_CHANGED,
        expect.anything()
      )

      // Verify the sent payload strictly conforms to DisplayConfigurationSchema
      const sentPayload = mockWebContents.send.mock.calls[0][1]
      const validationResult = DisplayConfigurationSchema.safeParse(sentPayload)
      expect(validationResult.success).toBe(true)
      if (validationResult.success) {
        expect(validationResult.data.count).toBe(2)
        expect(validationResult.data.isMultiDisplay).toBe(true)
      }

      stopForwarding()
    })

    it('suppresses event delivery if WebContents is destroyed', () => {
      const destroyedWebContents = {
        isDestroyed: vi.fn().mockReturnValue(true),
        send: vi.fn()
      }

      const screenApi = {
        displays: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1.0
          }
        ],
        listeners: {} as Record<string, ((...args: unknown[]) => void)[]>,
        getAllDisplays() {
          return this.displays
        },
        getPrimaryDisplay() {
          return this.displays[0]
        },
        on(event: string, fn: (...args: unknown[]) => void) {
          if (!this.listeners[event]) this.listeners[event] = []
          this.listeners[event].push(fn)
          return this
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((l) => l !== fn)
          }
          return this
        }
      }

      const manager = new DisplayManager(screenApi as never)
      const stopForwarding = forwardDisplayEvents(destroyedWebContents, manager)

      screenApi.displays.push({
        id: 2,
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1.0
      })
      screenApi.listeners['display-added']?.[0]?.({}, screenApi.displays[1])

      expect(destroyedWebContents.send).not.toHaveBeenCalled()
      stopForwarding()
    })

    it('window recreation does not duplicate listeners when cleaned up on close', () => {
      const webContents1 = {
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn()
      }
      const webContents2 = {
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn()
      }

      const screenApi = {
        displays: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1.0
          }
        ],
        listeners: {} as Record<string, ((...args: unknown[]) => void)[]>,
        getAllDisplays() {
          return this.displays
        },
        getPrimaryDisplay() {
          return this.displays[0]
        },
        on(event: string, fn: (...args: unknown[]) => void) {
          if (!this.listeners[event]) this.listeners[event] = []
          this.listeners[event].push(fn)
          return this
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((l) => l !== fn)
          }
          return this
        }
      }

      const manager = new DisplayManager(screenApi as never)

      // First window creation
      const stop1 = forwardDisplayEvents(webContents1, manager)

      // First window closes
      stop1()

      // Second window created (recreation)
      const stop2 = forwardDisplayEvents(webContents2, manager)

      // Hotplug event
      screenApi.displays.push({
        id: 2,
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1.0
      })
      screenApi.listeners['display-added']?.[0]?.({}, screenApi.displays[1])

      // webContents1 must not be called; webContents2 called exactly once
      expect(webContents1.send).not.toHaveBeenCalled()
      expect(webContents2.send).toHaveBeenCalledTimes(1)

      stop2()
    })
  })

  it('unregisters handlers cleanly on teardown', () => {
    unregisterIpcHandlers(mockIpc)
    expect(mockIpc.handlers.size).toBe(0)
  })
})

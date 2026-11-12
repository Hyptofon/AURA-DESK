import { describe, it, expect, vi } from 'vitest'
import {
  MediaStreamDisplayCaptureBackend,
  type MediaStreamSessionLike,
  type DisplayMediaRequest,
  type DisplayStreams
} from '../../src/main/capture/mediastream-backend'
import {
  CaptureWindowClient,
  resolveCaptureHtmlPath,
  type BrowserWindowLike,
  type WebContentsLike
} from '../../src/main/capture/capture-window-client'
import type { CaptureTarget } from '../../src/shared/contracts/capture'
import { createValidCapturedFrame } from '../fixtures/image-fixtures'

class MockCaptureWindow implements BrowserWindowLike {
  public webContents: WebContentsLike
  public loadedFiles: string[] = []
  public destroyed = false
  public listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  public windowOpenHandler?: (details: { url: string }) => { action: 'deny' }
  public loadFileError: Error | null = null
  public destroyOnLoadFile = false

  constructor(
    mainFrame: unknown,
    executor: (script: string, userGesture?: boolean) => Promise<unknown>
  ) {
    this.webContents = {
      mainFrame,
      executeJavaScript: vi.fn().mockImplementation(executor),
      setWindowOpenHandler: (handler) => {
        this.windowOpenHandler = handler
      },
      on: (ev, fn) => {
        if (!this.listeners[ev]) this.listeners[ev] = []
        this.listeners[ev].push(fn)
      },
      removeListener: (ev, fn) => {
        if (this.listeners[ev]) {
          this.listeners[ev] = this.listeners[ev].filter((l) => l !== fn)
        }
      }
    }
  }

  async loadFile(filePath: string): Promise<void> {
    if (this.destroyOnLoadFile) {
      this.destroy()
      throw new Error('Window was destroyed during loadFile')
    }
    if (this.loadFileError) {
      throw this.loadFileError
    }
    this.loadedFiles.push(filePath)
  }

  async loadURL(): Promise<void> {}

  destroy(): void {
    this.destroyed = true
    const closedListeners = this.listeners['closed']
    if (closedListeners) {
      for (const listener of closedListeners) {
        listener()
      }
    }
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  on(ev: string, fn: (...args: unknown[]) => void): void {
    if (!this.listeners[ev]) this.listeners[ev] = []
    this.listeners[ev].push(fn)
  }

  removeListener(ev: string, fn: (...args: unknown[]) => void): void {
    if (this.listeners[ev]) {
      this.listeners[ev] = this.listeners[ev].filter((l) => l !== fn)
    }
  }
}

describe('MediaStream Pipeline & Authorization Gate Regression Suite', () => {
  const sampleTarget: CaptureTarget = {
    sourceId: 'screen:0:0',
    displayId: '101',
    sourceName: 'Primary Monitor'
  }

  const createMockClient = (frameMock: unknown = { processId: 1, routingId: 1 }) => {
    const fakePngBase64 = Buffer.from(
      createValidCapturedFrame({ displayId: '101' }).data
    ).toString('base64')

    return new CaptureWindowClient({
      windowFactory: () =>
        new MockCaptureWindow(frameMock, async (script) => {
          if (script.includes('navigator.mediaDevices.getDisplayMedia')) {
            return { ok: true, trackId: 'track-1' }
          }
          if (script.includes('ImageCapture') || script.includes('grabFrame')) {
            return { ok: true, base64: fakePngBase64, width: 1920, height: 1080 }
          }
          return null
        })
    })
  }

  it('fails closed when trustedFrameValidator is missing (never default to allow-all)', async () => {
    let registeredHandler:
      | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void)
      | null = null

    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler
      })
    }

    // Backend created WITHOUT a trusted frame validator
    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      client: createMockClient()
    })

    await backend.start(sampleTarget)
    expect(registeredHandler).not.toBeNull()

    let grantedStreams: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    registeredHandler!(
      {
        frame: { id: 'unvalidated-frame' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: false,
        userGesture: true
      },
      (streams) => {
        grantedStreams = streams
      }
    )

    // MUST fail closed! If validator is missing or doesn't match client frame, permission must NEVER be granted
    expect(grantedStreams).toBeNull()
    await backend.stop()
  })

  it('enforces authorizedOrigin and denies requests from mismatched origins', async () => {
    let registeredHandler:
      | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void)
      | null = null

    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler
      })
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      client: createMockClient(),
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: (_frame, origin) => origin === 'http://localhost:5173',
      frameExtractor: async (t) => createValidCapturedFrame({ displayId: t.displayId })
    })

    await backend.start(sampleTarget)
    expect(registeredHandler).not.toBeNull()

    let grantedStreams: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    registeredHandler!(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'https://attacker.example.com',
        videoRequested: true,
        audioRequested: false,
        userGesture: true
      },
      (streams) => {
        grantedStreams = streams
      }
    )

    // Must be rejected with null
    expect(grantedStreams).toBeNull()
    await backend.stop()
  })

  it('stop() establishes a permanent deny-by-default policy rather than resetting handler to null', async () => {
    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn()
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      client: createMockClient(),
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: () => true,
      frameExtractor: async (t) => createValidCapturedFrame({ displayId: t.displayId })
    })

    await backend.start(sampleTarget)
    await backend.stop()

    // Electron documentation states setDisplayMediaRequestHandler(null) restores default system picker.
    // To prevent unauthorized capture after stop, it must NOT set null, but set an explicit deny-all handler!
    const calls = vi.mocked(mockSession.setDisplayMediaRequestHandler).mock.calls
    const lastCallArg = calls[calls.length - 1][0]

    expect(lastCallArg).not.toBeNull()
    expect(typeof lastCallArg).toBe('function')

    // Calling the post-stop handler must deny requests with null
    let response: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    lastCallArg!(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: false,
        userGesture: false
      },
      (streams: DisplayStreams | null) => {
        response = streams
      }
    )

    expect(response).toBeNull()
  })

  it('idle backend denies any media requests before start is called', () => {
    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn()
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: () => true
    })

    // Handler invoked before start()
    let response: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    backend.handleDisplayMediaRequest(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: false,
        userGesture: false
      },
      (streams) => {
        response = streams
      }
    )

    expect(response).toBeNull()
  })

  it('rejects audio requests through display media handler (independent audio capture invariant)', async () => {
    let registeredHandler:
      | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void)
      | null = null

    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler
      })
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      client: createMockClient(),
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: () => true,
      frameExtractor: async (t) => createValidCapturedFrame({ displayId: t.displayId })
    })

    await backend.start(sampleTarget)

    let grantedStreams: DisplayStreams | null = null
    registeredHandler!(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: true, // Audio requested
        userGesture: true
      },
      (streams) => {
        grantedStreams = streams
      }
    )

    expect(grantedStreams).not.toBeNull()
    // Audio must be strictly undefined/omitted
    expect(grantedStreams!.audio).toBeUndefined()
    await backend.stop()
  })

  describe('CaptureWindowClient Production Composition & Invariants', () => {
    it('fails immediately when starting stream without a valid Electron capture context', async () => {
      // In the old broken code, startStream() with no options marked active = true!
      // In production, when Electron BrowserWindow is not available, it must throw immediately and leave active = false.
      const client = new CaptureWindowClient({
        windowFactory: () => {
          throw new Error('Electron BrowserWindow is not available in node test harness')
        }
      })

      expect(client.isStreamActive()).toBe(false)
      await expect(client.startStream(sampleTarget)).rejects.toThrow(
        /CaptureWindowClient failed to initialize capture window/
      )
      // Must NOT be active!
      expect(client.isStreamActive()).toBe(false)
    })

    it('creates capture window with partition binding, loads capture.html, and sets up security guards', async () => {
      let createdWindow: MockCaptureWindow | null = null
      let receivedSession: unknown = null

      const fakePngBase64 = Buffer.from(
        createValidCapturedFrame({ displayId: '101' }).data
      ).toString('base64')

      const mainFrameMock = { processId: 42, routingId: 1 }

      const client = new CaptureWindowClient({
        session: 'in-memory:aura-capture',
        windowFactory: ({ session }) => {
          receivedSession = session
          createdWindow = new MockCaptureWindow(mainFrameMock, async (script) => {
            if (script.includes('navigator.mediaDevices.getDisplayMedia')) {
              return { ok: true, trackId: 'track-101' }
            }
            if (script.includes('ImageCapture') || script.includes('grabFrame')) {
              return { ok: true, base64: fakePngBase64, width: 1920, height: 1080 }
            }
            return null
          })
          return createdWindow
        }
      })

      await client.startStream(sampleTarget)
      expect(client.isStreamActive()).toBe(true)
      expect(receivedSession).toBe('in-memory:aura-capture')
      expect(createdWindow).not.toBeNull()
      expect(createdWindow!.loadedFiles.length).toBe(1)
      expect(createdWindow!.loadedFiles[0]).toContain('capture.html')
      expect(createdWindow!.windowOpenHandler).toBeDefined()
      expect(createdWindow!.windowOpenHandler!({ url: 'https://evil.com' })).toEqual({
        action: 'deny'
      })

      // Frame grab returns valid authentic frame
      const frame = await client.grabFrame(sampleTarget)
      expect(frame.displayId).toBe('101')
      expect(frame.format).toBe('png')
      expect(frame.data[0]).toBe(0x89)

      // Stop destroys capture window and resets active
      await client.stopStream()
      expect(client.isStreamActive()).toBe(false)
      expect(createdWindow!.destroyed).toBe(true)
    })

    it('authorizes ONLY the exact capture window mainFrame and expected origin, rejecting generic top-level frames', async () => {
      const mainFrameMock = { processId: 42, routingId: 1 }

      const client = new CaptureWindowClient({
        expectedOrigin: 'file:///',
        windowFactory: () =>
          new MockCaptureWindow(mainFrameMock, async () => ({ ok: true }))
      })

      // Before start, window is not created: fails closed
      expect(client.isAuthorizedFrame(mainFrameMock, 'file:///')).toBe(false)

      await client.startStream(sampleTarget)

      // 1. Exact mainFrame object and exact origin -> PASS
      expect(client.isAuthorizedFrame(mainFrameMock, 'file:///')).toBe(true)

      // 2. Same processId and routingId -> PASS
      expect(client.isAuthorizedFrame({ processId: 42, routingId: 1 }, 'file:///')).toBe(true)

      // 3. Different frame from another window (e.g. main application window) -> FAIL
      expect(client.isAuthorizedFrame({ processId: 99, routingId: 1 }, 'file:///')).toBe(false)

      // 4. Nested child frame / iframe -> FAIL
      expect(client.isAuthorizedFrame({ processId: 42, routingId: 999 }, 'file:///')).toBe(false)

      // 5. Wrong origin -> FAIL
      expect(client.isAuthorizedFrame(mainFrameMock, 'https://evil.com')).toBe(false)
      expect(client.isAuthorizedFrame(mainFrameMock, 'http://localhost:5173')).toBe(false)

      // 6. After stop, window destroyed -> FAIL
      await client.stopStream()
      expect(client.isAuthorizedFrame(mainFrameMock, 'file:///')).toBe(false)
    })

    it('fails closed and does not mark active if media stream script returns error', async () => {
      let createdWindow: MockCaptureWindow | null = null

      const client = new CaptureWindowClient({
        windowFactory: () => {
          createdWindow = new MockCaptureWindow({ processId: 1, routingId: 1 }, async () => {
            return { ok: false, error: 'OS display permission denied' }
          })
          return createdWindow
        }
      })

      await expect(client.startStream(sampleTarget)).rejects.toThrow(
        /Stream acquisition failed: OS display permission denied/
      )

      expect(client.isStreamActive()).toBe(false)
      expect(createdWindow).not.toBeNull()
      expect(createdWindow!.destroyed).toBe(true)
    })

    it('rejects frame extraction if returned payload has invalid PNG header', async () => {
      const corruptedBase64 = Buffer.from('NOT_A_PNG_FILE_HEADER').toString('base64')

      const client = new CaptureWindowClient({
        windowFactory: () =>
          new MockCaptureWindow({ processId: 1, routingId: 1 }, async (script) => {
            if (script.includes('navigator.mediaDevices.getDisplayMedia')) {
              return { ok: true }
            }
            if (script.includes('ImageCapture') || script.includes('grabFrame')) {
              return { ok: true, base64: corruptedBase64, width: 100, height: 100 }
            }
            return null
          })
      })

      await client.startStream(sampleTarget)
      await expect(client.grabFrame(sampleTarget)).rejects.toThrow(
        /Frame extraction failed: decoded payload is not a valid PNG/
      )
      await client.stopStream()
    })

    it('rejects frame grab when stream is inactive', async () => {
      const client = new CaptureWindowClient({
        windowFactory: () => new MockCaptureWindow({}, async () => ({ ok: true }))
      })
      await expect(client.grabFrame(sampleTarget)).rejects.toThrow(
        /Cannot grab frame: capture stream is not active/
      )
    })

    it('rejects startStream when target is invalid', async () => {
      const client = new CaptureWindowClient()
      await expect(
        client.startStream({ sourceId: '', displayId: '' })
      ).rejects.toThrow(/invalid target/)
    })

    it('invokes stream startup script with userGesture set to true (P1 user activation invariant)', async () => {
      let createdWindow: MockCaptureWindow | null = null
      let passedUserGesture: boolean | undefined

      const client = new CaptureWindowClient({
        windowFactory: () => {
          createdWindow = new MockCaptureWindow(
            { processId: 1, routingId: 1 },
            async (script, userGesture) => {
              if (script.includes('getDisplayMedia')) {
                passedUserGesture = userGesture
                return { ok: true, trackId: 'track-activation-1' }
              }
              return null
            }
          )
          return createdWindow
        }
      })

      await client.startStream(sampleTarget)
      expect(client.isStreamActive()).toBe(true)
      expect(passedUserGesture).toBe(true)
      expect(createdWindow!.webContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('getDisplayMedia'),
        true
      )
      await client.stopStream()
    })

    it('cleans up capture window and resets state if loadFile fails (P2 failed startup cleanup)', async () => {
      let createdWindow: MockCaptureWindow | null = null

      const client = new CaptureWindowClient({
        windowFactory: () => {
          createdWindow = new MockCaptureWindow({ processId: 1, routingId: 1 }, async () => ({ ok: true }))
          createdWindow.loadFileError = new Error('ERR_FILE_NOT_FOUND: capture.html is missing')
          return createdWindow
        }
      })

      await expect(client.startStream(sampleTarget)).rejects.toThrow(
        /CaptureWindowClient failed to initialize capture window: ERR_FILE_NOT_FOUND/
      )

      expect(client.isStreamActive()).toBe(false)
      expect(client.getActiveTarget()).toBeNull()
      expect(client.getCaptureWindow()).toBeNull()
      expect(createdWindow).not.toBeNull()
      expect(createdWindow!.destroyed).toBe(true)
    })

    it('handles unexpected window destruction while startup is pending and cleans up', async () => {
      let createdWindow: MockCaptureWindow | null = null

      const client = new CaptureWindowClient({
        windowFactory: () => {
          createdWindow = new MockCaptureWindow({ processId: 1, routingId: 1 }, async () => ({ ok: true }))
          createdWindow.destroyOnLoadFile = true
          return createdWindow
        }
      })

      await expect(client.startStream(sampleTarget)).rejects.toThrow(
        /CaptureWindowClient failed to initialize capture window/
      )

      expect(client.isStreamActive()).toBe(false)
      expect(client.getCaptureWindow()).toBeNull()
      expect(createdWindow!.destroyed).toBe(true)
    })

    it('allows clean retry after a failed startup attempt', async () => {
      let attempt = 0
      const windows: MockCaptureWindow[] = []

      const client = new CaptureWindowClient({
        windowFactory: () => {
          attempt++
          const win = new MockCaptureWindow(
            { processId: attempt, routingId: 1 },
            async (script) => {
              if (script.includes('getDisplayMedia')) {
                return { ok: true, trackId: `track-${attempt}` }
              }
              return null
            }
          )
          if (attempt === 1) {
            win.loadFileError = new Error('Simulated transient startup failure')
          }
          windows.push(win)
          return win
        }
      })

      // Attempt 1 fails
      await expect(client.startStream(sampleTarget)).rejects.toThrow(
        /Simulated transient startup failure/
      )
      expect(client.isStreamActive()).toBe(false)
      expect(windows[0].destroyed).toBe(true)

      // Attempt 2 succeeds cleanly from fresh state
      await client.startStream(sampleTarget)
      expect(client.isStreamActive()).toBe(true)
      expect(client.getCaptureWindow()).toBe(windows[1])
      expect(windows[1].destroyed).toBe(false)

      await client.stopStream()
      expect(client.isStreamActive()).toBe(false)
      expect(windows[1].destroyed).toBe(true)
    })

    it('handles NotAllowedError and leaves capture window cleanly destroyed', async () => {
      let createdWindow: MockCaptureWindow | null = null

      const client = new CaptureWindowClient({
        windowFactory: () => {
          createdWindow = new MockCaptureWindow({ processId: 1, routingId: 1 }, async () => {
            return {
              ok: false,
              error: 'NotAllowedError: Permission denied by user or policy',
              errorName: 'NotAllowedError'
            }
          })
          return createdWindow
        }
      })

      await expect(client.startStream(sampleTarget)).rejects.toThrow(
        /Stream acquisition failed \[NotAllowedError\]: NotAllowedError: Permission denied by user or policy/
      )

      expect(client.isStreamActive()).toBe(false)
      expect(createdWindow!.destroyed).toBe(true)
      expect(client.getCaptureWindow()).toBeNull()
    })

    it('handles InvalidStateError and NotSupportedError fail closed', async () => {
      const clientInvalidState = new CaptureWindowClient({
        windowFactory: () =>
          new MockCaptureWindow({ processId: 1, routingId: 1 }, async () => ({
            ok: false,
            error: 'InvalidStateError: Acquired video track is not live',
            errorName: 'InvalidStateError'
          }))
      })

      await expect(clientInvalidState.startStream(sampleTarget)).rejects.toThrow(
        /Stream acquisition failed \[InvalidStateError\]/
      )
      expect(clientInvalidState.isStreamActive()).toBe(false)

      const clientNotSupported = new CaptureWindowClient({
        windowFactory: () =>
          new MockCaptureWindow({ processId: 1, routingId: 1 }, async () => ({
            ok: false,
            error: 'NotSupportedError: navigator.mediaDevices.getDisplayMedia is not available',
            errorName: 'NotSupportedError'
          }))
      })

      await expect(clientNotSupported.startStream(sampleTarget)).rejects.toThrow(
        /Stream acquisition failed \[NotSupportedError\]/
      )
      expect(clientNotSupported.isStreamActive()).toBe(false)
    })

    it('resolves capture.html path in development/build and fails closed if document is missing', () => {
      // 1. Production / dev resolution finds existing capture surface document
      const resolved = resolveCaptureHtmlPath()
      expect(resolved).toBeTruthy()
      expect(resolved).toContain('capture.html')

      // 2. Fails closed with descriptive error if explicitly missing or non-existent path
      expect(() =>
        resolveCaptureHtmlPath('/nonexistent/path/completely_missing_capture.html')
      ).toThrow(
        /Capture surface document \(capture\.html\) could not be resolved at specified path/
      )
    })
  })

  describe('MediaStreamDisplayCaptureBackend Integration with Real Client', () => {
    it('integrates backend with capture window client to enforce exact frame and origin gate', async () => {
      let registeredHandler:
        | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void)
        | null = null

      const mockSession: MediaStreamSessionLike = {
        setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
          registeredHandler = handler
        })
      }

      const fakePngBase64 = Buffer.from(
        createValidCapturedFrame({ displayId: '101' }).data
      ).toString('base64')

      const captureFrameMock = { processId: 77, routingId: 2 }

      const client = new CaptureWindowClient({
        session: mockSession,
        expectedOrigin: 'file:///',
        windowFactory: () =>
          new MockCaptureWindow(captureFrameMock, async (script) => {
            if (script.includes('navigator.mediaDevices.getDisplayMedia')) {
              return { ok: true }
            }
            if (script.includes('ImageCapture') || script.includes('grabFrame')) {
              return { ok: true, base64: fakePngBase64, width: 1920, height: 1080 }
            }
            return null
          })
      })

      const backend = new MediaStreamDisplayCaptureBackend({
        session: mockSession,
        client
      })

      await backend.start(sampleTarget)
      expect(registeredHandler).not.toBeNull()

      // 1. Authorized frame requesting display media
      let grantedStreams: DisplayStreams | null = null
      registeredHandler!(
        {
          frame: captureFrameMock,
          securityOrigin: 'file:///',
          videoRequested: true,
          audioRequested: false,
          userGesture: false
        },
        (streams) => {
          grantedStreams = streams
        }
      )

      expect(grantedStreams).not.toBeNull()
      expect(grantedStreams!.video?.id).toBe('screen:0:0')
      expect(grantedStreams!.video?.name).toBe('Primary Monitor')

      // 2. Foreign frame requesting display media -> denied fail-closed
      let deniedStreams: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
      registeredHandler!(
        {
          frame: { processId: 99, routingId: 99 },
          securityOrigin: 'file:///',
          videoRequested: true,
          audioRequested: false,
          userGesture: false
        },
        (streams) => {
          deniedStreams = streams
        }
      )
      expect(deniedStreams).toBeNull()

      // 3. Frame grab produces valid PNG
      const frame = await backend.captureFrame(sampleTarget)
      expect(frame.displayId).toBe('101')
      expect(frame.format).toBe('png')
      expect(frame.data[0]).toBe(0x89)

      // 4. Stop tears down client and installs deny handler
      await backend.stop()
      expect(client.isStreamActive()).toBe(false)
    })
  })
})

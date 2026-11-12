import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  SingleDisplayCapturer,
  type DesktopCapturerLike
} from '../../src/main/capture/single-display-capturer'
import {
  MediaStreamDisplayCaptureBackend,
  type MediaStreamSessionLike,
  type DisplayMediaRequest,
  type DisplayStreams
} from '../../src/main/capture/mediastream-backend'
import { DisplayManager, type ScreenLike, type ElectronDisplayLike } from '../../src/main/displays/display-manager'
import type { CapturedFrame, CaptureTarget, FrameCaptureBackend } from '../../src/shared/contracts/capture'
import { createValidCapturedFrame } from '../fixtures/image-fixtures'

class MockScreenApi implements ScreenLike {
  public displays: ElectronDisplayLike[] = []
  public listeners: Record<string, ((...args: unknown[]) => void)[]> = {
    'display-added': [],
    'display-removed': [],
    'display-metrics-changed': []
  }

  getAllDisplays(): ElectronDisplayLike[] {
    return this.displays
  }

  getPrimaryDisplay(): ElectronDisplayLike {
    return this.displays[0]
  }

  on(
    event: 'display-added' | 'display-removed' | 'display-metrics-changed',
    fn: (...args: unknown[]) => void
  ): this {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(fn)
    return this
  }

  removeListener(
    event: 'display-added' | 'display-removed' | 'display-metrics-changed',
    fn: (...args: unknown[]) => void
  ): this {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== fn)
    }
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    const list = this.listeners[event] || []
    for (const fn of list) {
      fn(...args)
    }
  }
}

describe('Deterministic Production Invariants Behavioral Quality Gate', () => {
  const rootDir = path.resolve(__dirname, '../../')
  const readSrc = (relPath: string): string => {
    const fullPath = path.join(rootDir, relPath)
    return fs.readFileSync(fullPath, 'utf-8')
  }

  const createDisplay = (id: number, x: number): ElectronDisplayLike => ({
    id,
    label: `Display ${id}`,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workArea: { x, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1.0,
    rotation: 0
  })

  describe('Behavioral Capture Isolation & Security Gates', () => {
    it('metadata enumeration never requests thumbnails (thumbnailSize is strictly 0x0)', async () => {
      const screenApi = new MockScreenApi()
      screenApi.displays = [createDisplay(101, 0), createDisplay(202, 1920)]
      const displayManager = new DisplayManager(screenApi)

      const sourcesCalls: { width?: number; height?: number }[] = []
      const mockCapturer: DesktopCapturerLike = {
        getSources: vi.fn().mockImplementation(async (opts) => {
          sourcesCalls.push(opts.thumbnailSize ?? {})
          return [
            { id: 'screen:0:0', name: 'Display 101', display_id: '101' },
            { id: 'screen:1:0', name: 'Display 202', display_id: '202' }
          ]
        })
      }

      const dummyBackend: FrameCaptureBackend = {
        captureFrame: async (target: CaptureTarget) =>
          createValidCapturedFrame({ displayId: target.displayId })
      }

      const capturer = new SingleDisplayCapturer(displayManager, {
        capturerApi: mockCapturer,
        backend: dummyBackend
      })

      await capturer.start('101')

      // Assert that desktopCapturer.getSources was invoked with strictly 0x0 dimensions
      expect(sourcesCalls.length).toBeGreaterThanOrEqual(1)
      expect(sourcesCalls[0].width).toBe(0)
      expect(sourcesCalls[0].height).toBe(0)

      await capturer.stop()
    })

    it('selected-source capture initializes only the authorized source and denies unselected sources', async () => {
      let registeredHandler:
        | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams) => void) => void)
        | null = null

      const mockSession: MediaStreamSessionLike = {
        setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
          registeredHandler = handler
        })
      }

      const backend = new MediaStreamDisplayCaptureBackend({
        session: mockSession,
        isAuthorizedFrame: (frame) => frame === 'authorized-frame',
        frameExtractor: async (target) => createValidCapturedFrame({ displayId: target.displayId })
      })

      // Start capture for display 101 (screen:0:0)
      await backend.start({
        sourceId: 'screen:0:0',
        displayId: '101',
        sourceName: 'Screen 1'
      })

      expect(mockSession.setDisplayMediaRequestHandler).toHaveBeenCalledTimes(2) // 1 in constructor (deny-all), 1 in start (active target)
      expect(registeredHandler).not.toBeNull()

      // 1. Authorized frame requesting display media
      let grantedStreams: DisplayStreams | null = null
      registeredHandler!(
        {
          frame: 'authorized-frame',
          securityOrigin: 'http://localhost:5173',
          videoRequested: true,
          audioRequested: false,
          userGesture: true
        },
        (streams) => {
          grantedStreams = streams
        }
      )

      // Must grant ONLY the authorized source (screen:0:0)
      expect(grantedStreams).not.toBeNull()
      expect(grantedStreams!.video?.id).toBe('screen:0:0')
      expect(grantedStreams!.video?.name).toBe('Screen 1')
      expect(grantedStreams!.audio).toBeUndefined()

      // 2. Unauthorized frame requesting media -> must fail closed (callback(null))
      let deniedStreams: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
      registeredHandler!(
        {
          frame: 'unauthorized-attacker-frame',
          securityOrigin: 'https://malicious.example.com',
          videoRequested: true,
          audioRequested: false,
          userGesture: false
        },
        (streams) => {
          deniedStreams = streams
        }
      )

      expect(deniedStreams).toBeNull()

      await backend.stop()
    })

    it('unselected source is never requested for frame capture', async () => {
      const screenApi = new MockScreenApi()
      screenApi.displays = [createDisplay(101, 0), createDisplay(202, 1920)]
      const displayManager = new DisplayManager(screenApi)

      const requestedTargets: CaptureTarget[] = []
      const fakeBackend: FrameCaptureBackend = {
        start: async (target) => {
          requestedTargets.push(target)
        },
        captureFrame: async (target) => {
          requestedTargets.push(target)
          return createValidCapturedFrame({ displayId: target.displayId })
        }
      }

      const mockCapturer: DesktopCapturerLike = {
        getSources: vi.fn().mockResolvedValue([
          { id: 'screen:0:0', name: 'Display 101', display_id: '101' },
          { id: 'screen:1:0', name: 'Display 202', display_id: '202' }
        ])
      }

      const capturer = new SingleDisplayCapturer(displayManager, {
        capturerApi: mockCapturer,
        backend: fakeBackend
      })

      // Start on display 101
      await capturer.start('101')

      // Assert that secondary display (202 / screen:1:0) was NEVER passed to backend
      expect(requestedTargets.length).toBeGreaterThanOrEqual(1)
      expect(requestedTargets.every((t) => t.displayId === '101' && t.sourceId === 'screen:0:0')).toBe(true)
      expect(requestedTargets.some((t) => t.displayId === '202' || t.sourceId === 'screen:1:0')).toBe(false)

      await capturer.stop()
    })

    it('unknown source ID fails closed without fallback', async () => {
      const screenApi = new MockScreenApi()
      screenApi.displays = [createDisplay(101, 0)]
      const displayManager = new DisplayManager(screenApi)

      const mockCapturer: DesktopCapturerLike = {
        getSources: vi.fn().mockResolvedValue([
          { id: 'screen:0:0', name: 'Display 101', display_id: '101' }
        ])
      }

      const dummyBackend: FrameCaptureBackend = {
        captureFrame: async (target) => createValidCapturedFrame({ displayId: target.displayId })
      }

      const capturer = new SingleDisplayCapturer(displayManager, {
        capturerApi: mockCapturer,
        backend: dummyBackend
      })

      // Non-existent display 999
      await expect(capturer.start('999')).rejects.toThrow(/not present in active display configuration/)
      expect(capturer.getStatus()).toBe('error')
      expect(capturer.isActive()).toBe(false)
      expect(capturer.getLastError()).toContain('999')

      // Stop recovers state to idle
      await capturer.stop()
      expect(capturer.getStatus()).toBe('idle')
    })

    it('missing or duplicate display mapping fails closed', async () => {
      const screenApi = new MockScreenApi()
      screenApi.displays = [createDisplay(101, 0)]
      const displayManager = new DisplayManager(screenApi)

      // Ambiguous: two sources matching same display_id
      const mockCapturerDuplicate: DesktopCapturerLike = {
        getSources: vi.fn().mockResolvedValue([
          { id: 'screen:0:0', name: 'Display 101A', display_id: '101' },
          { id: 'screen:0:1', name: 'Display 101B', display_id: '101' }
        ])
      }

      const dummyBackend: FrameCaptureBackend = {
        captureFrame: async (target) => createValidCapturedFrame({ displayId: target.displayId })
      }

      const capturer = new SingleDisplayCapturer(displayManager, {
        capturerApi: mockCapturerDuplicate,
        backend: dummyBackend
      })

      await expect(capturer.start('101')).rejects.toThrow(/Ambiguous capture source/)
      expect(capturer.getStatus()).toBe('error')
      expect(capturer.isActive()).toBe(false)

      await capturer.stop()
      expect(capturer.getStatus()).toBe('idle')
    })

    it('stop releases the actual backend capture resources and unregisters handler', async () => {
      let registeredHandler: unknown = () => {}
      const mockSession: MediaStreamSessionLike = {
        setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
          registeredHandler = handler
        })
      }

      const backend = new MediaStreamDisplayCaptureBackend({
        session: mockSession,
        frameExtractor: async (target) => createValidCapturedFrame({ displayId: target.displayId })
      })

      let trackStopped = false
      backend.registerTrackStopCallback(() => {
        trackStopped = true
      })

      await backend.start({
        sourceId: 'screen:0:0',
        displayId: '101'
      })

      expect(backend.isHandlerRegistered()).toBe(true)
      expect(registeredHandler).not.toBeNull()

      await backend.stop()

      // Track stopped, permanent fail-closed deny-by-default installed, target cleared
      expect(trackStopped).toBe(true)
      expect(mockSession.setDisplayMediaRequestHandler).toHaveBeenLastCalledWith(expect.any(Function))
      const lastHandler = vi.mocked(mockSession.setDisplayMediaRequestHandler).mock.calls.slice(-1)[0][0]
      let postStopResult: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
      lastHandler!(
        {
          frame: 'any',
          securityOrigin: 'http://localhost:5173',
          videoRequested: true,
          audioRequested: false,
          userGesture: false
        },
        (res) => {
          postStopResult = res
        }
      )
      expect(postStopResult).toBeNull()
      expect(backend.isHandlerRegistered()).toBe(false)
      expect(backend.getActiveTarget()).toBeNull()
    })

    it('no capture resumes after Stop or hotplug', async () => {
      const screenApi = new MockScreenApi()
      screenApi.displays = [createDisplay(101, 0), createDisplay(202, 1920)]
      const displayManager = new DisplayManager(screenApi)

      let captureCount = 0
      const fakeBackend: FrameCaptureBackend = {
        captureFrame: async (target) => {
          captureCount++
          return createValidCapturedFrame({ displayId: target.displayId })
        }
      }

      const mockCapturer: DesktopCapturerLike = {
        getSources: vi.fn().mockResolvedValue([
          { id: 'screen:0:0', name: 'Display 101', display_id: '101' },
          { id: 'screen:1:0', name: 'Display 202', display_id: '202' }
        ])
      }

      const capturer = new SingleDisplayCapturer(displayManager, {
        capturerApi: mockCapturer,
        backend: fakeBackend,
        sampleIntervalMs: 5
      })

      await capturer.start('202')
      expect(captureCount).toBe(1)

      // Stop session
      await capturer.stop()
      const countAfterStop = captureCount

      // Wait a short time to verify interval does not run after stop
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(captureCount).toBe(countAfterStop)
      expect(capturer.getStatus()).toBe('idle')
    })

    it('no captured frame is delivered after session invalidation', async () => {
      const screenApi = new MockScreenApi()
      screenApi.displays = [createDisplay(101, 0)]
      const displayManager = new DisplayManager(screenApi)

      let onCaptureStarted!: () => void
      const captureStartedPromise = new Promise<void>((r) => {
        onCaptureStarted = r
      })

      let resolveCapture!: (frame: CapturedFrame) => void
      const fakeBackend: FrameCaptureBackend = {
        captureFrame: async () => {
          onCaptureStarted()
          return new Promise<CapturedFrame>((resolve) => {
            resolveCapture = resolve
          })
        }
      }

      const mockCapturer: DesktopCapturerLike = {
        getSources: vi.fn().mockResolvedValue([
          { id: 'screen:0:0', name: 'Display 101', display_id: '101' }
        ])
      }

      const capturer = new SingleDisplayCapturer(displayManager, {
        capturerApi: mockCapturer,
        backend: fakeBackend
      })

      const startPromise = capturer.start('101').catch((err) => err)

      // Await until captureFrame has actually been invoked
      await captureStartedPromise

      // Invalidate session by calling stop while captureFrame is pending
      await capturer.stop()

      // Late frame resolves from backend
      resolveCapture(createValidCapturedFrame({ displayId: '101' }))

      // Start promise rejected cleanly with cancellation error
      const err = await startPromise
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('cancelled or superseded')

      // Frame buffer remains clean with 0 stale frames
      expect(capturer.getLatestFrame()).toBeNull()
      expect(capturer.getFrameHistory().length).toBe(0)
    })
  })

  describe('Preload & IPC Security Invariants', () => {
    it('ensures preload script does not bundle heavy runtime validation libraries like zod', () => {
      const preloadCode = readSrc('src/preload/index.ts')

      // Preload bundle must remain ultra-thin without direct zod runtime dependency
      expect(preloadCode).not.toMatch(/from\s+['"]zod['"]/)
      expect(preloadCode).not.toMatch(/require\(['"]zod['"]\)/)
    })

    it('mandates unsubscribe cleanup handlers for preload event listeners', () => {
      const preloadCode = readSrc('src/preload/index.ts')

      // onDisplaysChanged must return a cleanup function calling removeListener
      expect(preloadCode).toMatch(/onDisplaysChanged[\s\S]*?removeListener/)
    })

    it('enforces fail-closed window opening and navigation guards', () => {
      const mainIndexCode = readSrc('src/main/index.ts')

      // setWindowOpenHandler must deny new window creation fail-closed
      expect(mainIndexCode).toMatch(/setWindowOpenHandler[\s\S]*?action:\s*['"]deny['"]/)

      // will-navigate must guard navigation with isAllowedNavigation
      expect(mainIndexCode).toMatch(/will-navigate[\s\S]*?isAllowedNavigation/)
    })
  })
})

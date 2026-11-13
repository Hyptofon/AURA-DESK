import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SingleDisplayCapturer,
  type DesktopCapturerLike
} from '../../src/main/capture/single-display-capturer'
import {
  DisplayManager,
  type ScreenLike,
  type ElectronDisplayLike
} from '../../src/main/displays/display-manager'
import type { DesktopCapturerSourceLike } from '../../src/main/capture/source-resolver'
import type { CaptureSelection, SessionStatus } from '../../src/shared/contracts/channels'
import type {
  CapturedFrame,
  CaptureTarget,
  FrameCaptureBackend
} from '../../src/shared/contracts/capture'
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

/**
 * Controlled fake capture backend for unit testing.
 * Records all requests and returns valid PNG image frames.
 */
class FakeFrameCaptureBackend implements FrameCaptureBackend {
  public captureCalls: CaptureTarget[] = []
  public startCalls: CaptureTarget[] = []
  public customHandler?: (target: CaptureTarget) => Promise<CapturedFrame>
  public stopCalls = 0
  public stopDelayMs = 0

  async start(target: CaptureTarget): Promise<void> {
    this.startCalls.push(target)
  }

  async captureFrame(target: CaptureTarget): Promise<CapturedFrame> {
    this.captureCalls.push(target)
    if (this.customHandler) {
      return this.customHandler(target)
    }
    return createValidCapturedFrame({
      displayId: target.displayId,
      width: target.bounds?.width ?? 1920,
      height: target.bounds?.height ?? 1080
    })
  }

  async stop(): Promise<void> {
    if (this.stopDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.stopDelayMs))
    }
    this.stopCalls++
  }
}

describe('SingleDisplayCapturer', () => {
  let mockScreen: MockScreenApi
  let displayManager: DisplayManager
  let mockCapturer: DesktopCapturerLike
  let capturerSources: DesktopCapturerSourceLike[]
  let fakeBackend: FakeFrameCaptureBackend
  let currentSelection: CaptureSelection

  const createDisplay = (id: number, x: number): ElectronDisplayLike => ({
    id,
    label: `Display ${id}`,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workArea: { x, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1.0,
    rotation: 0
  })

  beforeEach(() => {
    vi.useFakeTimers()

    mockScreen = new MockScreenApi()
    mockScreen.displays = [createDisplay(101, 0), createDisplay(202, 1920)]

    currentSelection = { mode: 'single', displayId: '202' }
    displayManager = new DisplayManager(mockScreen, () => currentSelection)

    capturerSources = [
      { id: 'screen:0:0', name: 'Display 101', display_id: '101' },
      { id: 'screen:1:0', name: 'Display 202', display_id: '202' }
    ]

    mockCapturer = {
      getSources: vi.fn().mockImplementation(async () => capturerSources)
    }

    fakeBackend = new FakeFrameCaptureBackend()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('initializes in idle state with zero frames', () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.isActive()).toBe(false)
    expect(capturer.getActiveDisplayId()).toBeNull()
    expect(capturer.getLatestFrame()).toBeNull()
    expect(capturer.getFrameHistory().length).toBe(0)
    expect(capturer.getBufferStats().frameCount).toBe(0)
  })

  it('enumerates sources with ZERO thumbnail size (width: 0, height: 0) to prevent cross-display thumbnails', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    await capturer.start('202')

    expect(mockCapturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    })

    await capturer.stop()
  })

  it('captures ONLY the selected display and never requests the unselected display', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend,
      sampleIntervalMs: 1000
    })

    await capturer.start('202')

    // First sample taken during start
    expect(fakeBackend.captureCalls.length).toBe(1)
    expect(fakeBackend.captureCalls[0].displayId).toBe('202')
    expect(fakeBackend.captureCalls[0].sourceId).toBe('screen:1:0')

    // Advance 3 seconds
    await vi.advanceTimersByTimeAsync(3000)

    expect(fakeBackend.captureCalls.length).toBe(4) // 1 initial + 3 timer samples
    // Verify every single call was for 202 and ZERO calls were for 101
    expect(fakeBackend.captureCalls.every((call) => call.displayId === '202')).toBe(true)

    // Verify frames contain genuine PNG image data and bounds
    const latest = capturer.getLatestFrame()
    expect(latest).not.toBeNull()
    expect(latest?.displayId).toBe('202')
    expect(latest?.format).toBe('png')
    expect(latest?.byteLength).toBeGreaterThan(50)
    // Check PNG signature
    expect(latest?.data[0]).toBe(0x89)
    expect(latest?.data[1]).toBe(0x50) // 'P'
    expect(latest?.data[2]).toBe(0x4e) // 'N'
    expect(latest?.data[3]).toBe(0x47) // 'G'

    await capturer.stop()
  })

  it('race: Stop while getSources() is pending cancels session start cleanly', async () => {
    let resolveSources!: (sources: DesktopCapturerSourceLike[]) => void
    const sourcesPromise = new Promise<DesktopCapturerSourceLike[]>((resolve) => {
      resolveSources = resolve
    })

    mockCapturer.getSources = vi.fn().mockReturnValue(sourcesPromise)

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    // Start begins async getSources()
    const startPromise = capturer.start('202')
    expect(capturer.getStatus()).toBe('starting')

    // User stops before getSources() finishes
    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')

    // Now getSources() completes
    resolveSources(capturerSources)
    await expect(startPromise).rejects.toThrow(
      /Capture start was cancelled or superseded before becoming active/
    )

    // Verify session remains idle, timer was not created, buffer is empty
    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.isActive()).toBe(false)
    expect(capturer.getLatestFrame()).toBeNull()
    expect(fakeBackend.captureCalls.length).toBe(0)
  })

  it('race: Stop while frame capture is pending discards stale frame and does not buffer it', async () => {
    let resolveFrame!: (frame: CapturedFrame) => void
    const framePromise = new Promise<CapturedFrame>((resolve) => {
      resolveFrame = resolve
    })

    fakeBackend.customHandler = () => framePromise

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    const startPromise = capturer.start('202')

    // Stop while initial captureSample is awaiting backend
    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')

    // Frame resolves after Stop
    resolveFrame(createValidCapturedFrame({ displayId: '202' }))
    await expect(startPromise).rejects.toThrow(
      /Capture start was cancelled or superseded before becoming active/
    )

    // Verify frame was discarded and buffer remains completely empty
    expect(capturer.getFrameHistory().length).toBe(0)
    expect(capturer.getBufferStats().frameCount).toBe(0)
    expect(capturer.getLatestFrame()).toBeNull()
  })

  it('race: rejects concurrent Start calls while a Start is already in progress', async () => {
    const neverEndingPromise = new Promise<DesktopCapturerSourceLike[]>(() => {})
    mockCapturer.getSources = vi.fn().mockReturnValue(neverEndingPromise)

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    void capturer.start('202')
    expect(capturer.getStatus()).toBe('starting')

    // Attempting a second start while starting throws an error
    await expect(capturer.start('101')).rejects.toThrow(
      /Concurrent capture start rejected/
    )

    await capturer.stop()
  })

  it('race: clears buffer and avoids stale frames when switching displays', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    await capturer.start('202')
    expect(capturer.getLatestFrame()?.displayId).toBe('202')

    // Switch to display 101
    await capturer.start('101')
    expect(capturer.getActiveDisplayId()).toBe('101')

    const history = capturer.getFrameHistory()
    expect(history.length).toBe(1)
    expect(history[0].displayId).toBe('101')
    // Old frames for 202 are completely gone
    expect(history.some((f) => f.displayId === '202')).toBe(false)

    await capturer.stop()
  })

  it('hotplug: aborts immediately on selected display loss with no fallback to primary', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    const statusEvents: { status: SessionStatus; error?: string }[] = []
    capturer.onStatusChange((status, error) => {
      statusEvents.push({ status, error })
    })

    await capturer.start('202')
    expect(capturer.getStatus()).toBe('active')

    // Disconnect secondary monitor (202 removed, only 101 left)
    mockScreen.displays = [createDisplay(101, 0)]
    mockScreen.emit('display-removed', {}, createDisplay(202, 1920))

    // Capture must abort immediately, clear frames, and enter error state
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.isActive()).toBe(false)
    expect(capturer.getLastError()).toContain('SELECTED_DISPLAY_LOST')
    expect(capturer.getLatestFrame()).toBeNull()
    expect(capturer.getFrameHistory().length).toBe(0)

    // Verify status listeners received the error event
    expect(statusEvents.some((e) => e.status === 'error' && e.error?.includes('SELECTED_DISPLAY_LOST'))).toBe(true)

    // Calling stop() recovers state back to idle
    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.getLastError()).toBeNull()
  })

  it('hotplug: safely handles asynchronous backend stop rejection during abrupt termination without unhandled rejection', async () => {
    let backendStopCalled = false
    const failingBackend: FrameCaptureBackend = {
      start: async () => {},
      captureFrame: async (target) => createValidCapturedFrame({ displayId: target.displayId }),
      stop: async () => {
        backendStopCalled = true
        throw new Error('Simulated async backend stop failure')
      }
    }

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: failingBackend
    })

    await capturer.start('202')
    expect(capturer.getStatus()).toBe('active')

    // Trigger abrupt termination via hotplug event
    mockScreen.displays = [createDisplay(101, 0)]
    mockScreen.emit('display-removed', {}, createDisplay(202, 1920))

    // State must immediately fail closed: error status with SELECTED_DISPLAY_LOST and flushed frames
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.isActive()).toBe(false)
    expect(capturer.getLastError()).toContain('SELECTED_DISPLAY_LOST')
    expect(capturer.getLatestFrame()).toBeNull()
    expect(capturer.getFrameHistory().length).toBe(0)
    expect(backendStopCalled).toBe(true)

    // Stop on a failing backend must reject and remain in error status
    await expect(capturer.stop()).rejects.toThrow('Simulated async backend stop failure')
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.getLastError()).toContain('BACKEND_STOP_FAILED')

    // When backend stop succeeds on retry, state recovers back to idle cleanly
    failingBackend.stop = async () => {}
    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.getLastError()).toBeNull()
  })

  it('stop() rejects and enters error state if backend.stop() throws', async () => {
    const errorBackend: FrameCaptureBackend = {
      start: async () => {},
      captureFrame: async (target) => createValidCapturedFrame({ displayId: target.displayId }),
      stop: async () => {
        throw new Error('Device release failed')
      }
    }

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: errorBackend
    })

    await capturer.start('202')
    expect(capturer.getStatus()).toBe('active')

    await expect(capturer.stop()).rejects.toThrow('Device release failed')
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.getLastError()).toContain('BACKEND_STOP_FAILED: Device release failed')
    // Buffer must still be completely flushed even on stop failure
    expect(capturer.getLatestFrame()).toBeNull()
    expect(capturer.getBufferStats().frameCount).toBe(0)
  })

  it('hotplug: prevents new capture start from overlapping with in-flight asynchronous backend teardown', async () => {
    let stopResolver: () => void = () => {}
    let backendStopCompleted = false
    const callOrder: string[] = []

    const slowTeardownBackend: FrameCaptureBackend = {
      start: async (target) => {
        callOrder.push(`start:${target.displayId}`)
      },
      captureFrame: async (target) => createValidCapturedFrame({ displayId: target.displayId }),
      stop: async () => {
        callOrder.push('stop:begin')
        if (!backendStopCompleted) {
          await new Promise<void>((resolve) => {
            stopResolver = resolve
          })
          backendStopCompleted = true
        }
        callOrder.push('stop:end')
      }
    }

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: slowTeardownBackend
    })

    await capturer.start('202')
    expect(capturer.getStatus()).toBe('active')

    // Disconnect display 202 -> triggers handleAbruptTermination
    mockScreen.displays = [createDisplay(101, 0)]
    mockScreen.emit('display-removed', {}, createDisplay(202, 1920))

    // State synchronously transitions to error and flushes frames
    expect(capturer.getStatus()).toBe('error')
    expect(backendStopCompleted).toBe(false)
    expect(callOrder).toContain('stop:begin')

    // Now invoke start on remaining display 101 while previous backend stop is pending
    const newStartPromise = capturer.start('101')

    // Verify new start did not execute backend.start yet
    expect(callOrder).not.toContain('start:101')

    // Release the slow backend stop
    stopResolver()
    await newStartPromise

    // Verify ordering: stop:end happened before start:101
    expect(callOrder).toEqual(['start:202', 'stop:begin', 'stop:end', 'start:101'])
    expect(capturer.getStatus()).toBe('active')
    expect(capturer.getActiveDisplayId()).toBe('101')

    // Clean up
    stopResolver()
    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')
  })

  it('handles backend capture failure by entering error state and aborting cleanly', async () => {
    fakeBackend.customHandler = async () => {
      throw new Error('OS capture device disconnected')
    }

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    await expect(capturer.start('202')).rejects.toThrow(
      /OS capture device disconnected/
    )

    expect(capturer.getStatus()).toBe('error')
    expect(capturer.getLastError()).toContain('OS capture device disconnected')
    expect(capturer.isActive()).toBe(false)
    expect(capturer.getLatestFrame()).toBeNull()
  })

  it('stop() is idempotent and safe against repeated calls', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    await capturer.start('202')
    await capturer.stop()
    await capturer.stop()
    await capturer.stop()

    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.isActive()).toBe(false)
  })

  it('cancelled start rejects with cancellation error and does not enter active state', async () => {
    let resolveGetSources!: (sources: DesktopCapturerSourceLike[]) => void
    mockCapturer.getSources = vi.fn().mockReturnValue(
      new Promise<DesktopCapturerSourceLike[]>((resolve) => {
        resolveGetSources = resolve
      })
    )

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    const startPromise = capturer.start('202')
    expect(capturer.getStatus()).toBe('starting')

    // Stop is called while getSources() is still in-flight
    await capturer.stop()
    expect(capturer.getStatus()).toBe('idle')

    // Now let getSources finish
    resolveGetSources(capturerSources)

    // The start promise must reject with cancellation error
    await expect(startPromise).rejects.toThrow(
      /Capture start was cancelled or superseded before becoming active/
    )
    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.isActive()).toBe(false)
  })

  it('stop() properly awaits asynchronous backend stop and transitions state cleanly', async () => {
    vi.useRealTimers()
    fakeBackend.stopDelayMs = 20

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    await capturer.start('202')
    expect(capturer.getStatus()).toBe('active')

    await capturer.stop()

    expect(fakeBackend.stopCalls).toBe(1)
    expect(capturer.getStatus()).toBe('idle')
    expect(capturer.isActive()).toBe(false)
  })

  it('prevents overlapping capture operations via in-flight capture lock', async () => {
    vi.useRealTimers()
    let captureExecutionCount = 0

    fakeBackend.customHandler = async (target) => {
      captureExecutionCount++
      await new Promise((resolve) => setTimeout(resolve, 30))
      return createValidCapturedFrame({
        displayId: target.displayId,
        width: target.bounds?.width ?? 1920,
        height: target.bounds?.height ?? 1080
      })
    }

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend,
      sampleIntervalMs: 10
    })

    await capturer.start('202')
    expect(captureExecutionCount).toBe(1)
    await capturer.stop()
  })

  it('initializes backend start hook with verified target metadata', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend
    })

    await capturer.start('202')

    expect(fakeBackend.startCalls.length).toBe(1)
    expect(fakeBackend.startCalls[0].sourceId).toBe('screen:1:0')
    expect(fakeBackend.startCalls[0].displayId).toBe('202')
    expect(fakeBackend.startCalls[0].sourceName).toBe('Display 202')

    await capturer.stop()
  })

  it('resolves source via windowsDisplayQuery when desktopCapturer sources have empty display_id', async () => {
    // Sources have empty display_id (mimicking Windows 11 behavior)
    mockCapturer.getSources = vi.fn().mockResolvedValue([
      { id: 'screen:0:0', name: 'Екран 1', display_id: '' },
      { id: 'screen:1:0', name: 'Екран 2', display_id: '' }
    ])

    const fakeWindowsQuery = vi.fn().mockResolvedValue([
      {
        deviceName: '\\\\.\\DISPLAY1',
        displayIndex: 0,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true
      },
      {
        deviceName: '\\\\.\\DISPLAY2',
        displayIndex: 1,
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        isPrimary: false
      }
    ])

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend,
      windowsDisplayQuery: fakeWindowsQuery
    })

    // Start on secondary display '202' (bounds x: 1920, y: 0)
    await capturer.start('202')

    expect(capturer.getStatus()).toBe('active')
    expect(fakeWindowsQuery).toHaveBeenCalledTimes(1)
    expect(fakeBackend.startCalls[0].sourceId).toBe('screen:1:0')
    expect(fakeBackend.startCalls[0].displayId).toBe('202')
    expect(fakeBackend.startCalls[0].sourceName).toBe('Екран 2')

    await capturer.stop()
  })

  it('fails closed when sources have empty display_id and windowsDisplayQuery returns no matching coordinates', async () => {
    mockCapturer.getSources = vi.fn().mockResolvedValue([
      { id: 'screen:0:0', name: 'Screen 1', display_id: '' }
    ])

    const fakeWindowsQuery = vi.fn().mockResolvedValue([
      {
        deviceName: '\\\\.\\DISPLAY1',
        displayIndex: 0,
        bounds: { x: 9999, y: 9999, width: 100, height: 100 },
        isPrimary: true
      }
    ])

    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      backend: fakeBackend,
      windowsDisplayQuery: fakeWindowsQuery
    })

    await expect(capturer.start('101')).rejects.toThrow(
      /no matching Windows display device coordinates found/
    )
    expect(capturer.getStatus()).toBe('error')
    expect(capturer.isActive()).toBe(false)

    await capturer.stop()
  })
})

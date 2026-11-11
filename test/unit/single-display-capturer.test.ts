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
import type { CaptureSelection } from '../../src/shared/contracts/channels'

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

describe('SingleDisplayCapturer', () => {
  let mockScreen: MockScreenApi
  let displayManager: DisplayManager
  let mockCapturer: DesktopCapturerLike
  let capturerSources: DesktopCapturerSourceLike[]
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('initializes in inactive state with zero frames', () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer
    })

    expect(capturer.isActive()).toBe(false)
    expect(capturer.getActiveDisplayId()).toBeNull()
    expect(capturer.getLatestFrame()).toBeNull()
    expect(capturer.getFrameHistory().length).toBe(0)
    expect(capturer.getBufferStats().frameCount).toBe(0)
  })

  it('captures ONLY the selected display and does not touch the unselected display', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer,
      sampleIntervalMs: 2000
    })

    await capturer.start('202')

    expect(capturer.isActive()).toBe(true)
    expect(capturer.getActiveDisplayId()).toBe('202')

    // Initial frame captured immediately
    const frame = capturer.getLatestFrame()
    expect(frame).not.toBeNull()
    expect(frame?.displayId).toBe('202')

    // Advance timer 4 seconds (2 sample cycles)
    await vi.advanceTimersByTimeAsync(4000)

    const history = capturer.getFrameHistory()
    expect(history.length).toBe(3) // 1 initial + 2 interval samples

    // All frames MUST belong to display 202; none to 101
    for (const f of history) {
      expect(f.displayId).toBe('202')
    }

    await capturer.stop()
  })

  it('rejects invalid or missing displayId with error and sets lastError', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer
    })

    await expect(capturer.start('')).rejects.toThrow(/invalid or empty displayId/)
    await expect(capturer.start('non-existent-id')).rejects.toThrow(
      /is not present in active display configuration/
    )
    expect(capturer.getLastError()).toBe('DISPLAY_NOT_FOUND')
    expect(capturer.isActive()).toBe(false)
  })

  it('monitor disconnect cancels capture immediately with NO automatic fallback to primary', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer
    })

    await capturer.start('202')
    expect(capturer.isActive()).toBe(true)
    expect(capturer.getLatestFrame()).not.toBeNull()

    // Disconnect display 202
    mockScreen.displays = [mockScreen.displays[0]] // only 101 remains
    capturerSources = [capturerSources[0]]

    // Notify displayManager via screen event
    mockScreen.emit('display-removed', {}, { id: 202 })

    // Capture must be stopped immediately
    expect(capturer.isActive()).toBe(false)
    expect(capturer.getActiveDisplayId()).toBeNull()
    expect(capturer.getLastError()).toBe('SELECTED_DISPLAY_LOST')

    // Frame buffer must be flushed immediately to prevent stale cross-display data
    expect(capturer.getLatestFrame()).toBeNull()
    expect(capturer.getFrameHistory().length).toBe(0)
    expect(capturer.getBufferStats().frameCount).toBe(0)
  })

  it('stop() releases all timers, memory buffers, and subscriptions immediately', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer
    })

    await capturer.start('202')
    expect(capturer.isActive()).toBe(true)
    expect(capturer.getBufferStats().frameCount).toBe(1)

    await capturer.stop()

    expect(capturer.isActive()).toBe(false)
    expect(capturer.getActiveDisplayId()).toBeNull()
    expect(capturer.getLatestFrame()).toBeNull()
    expect(capturer.getFrameHistory().length).toBe(0)
    expect(capturer.getBufferStats().frameCount).toBe(0)

    // Advancing timers after stop must NOT generate new frames
    await vi.advanceTimersByTimeAsync(10000)
    expect(capturer.getBufferStats().frameCount).toBe(0)
  })

  it('repeated stop() calls remain completely safe and idempotent', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer
    })

    await capturer.start('202')
    await capturer.stop()
    await expect(capturer.stop()).resolves.toBeUndefined()
    await expect(capturer.stop()).resolves.toBeUndefined()
  })

  it('switching from display A to display B wipes display A frames before starting B', async () => {
    const capturer = new SingleDisplayCapturer(displayManager, {
      capturerApi: mockCapturer
    })

    await capturer.start('101')
    expect(capturer.getActiveDisplayId()).toBe('101')
    expect(capturer.getLatestFrame()?.displayId).toBe('101')

    // Switch to 202
    await capturer.start('202')
    expect(capturer.getActiveDisplayId()).toBe('202')
    expect(capturer.getLatestFrame()?.displayId).toBe('202')

    // All frames in buffer must strictly be 202; none 101
    for (const f of capturer.getFrameHistory()) {
      expect(f.displayId).toBe('202')
    }

    await capturer.stop()
  })
})

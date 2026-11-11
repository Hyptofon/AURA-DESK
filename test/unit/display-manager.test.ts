import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DisplayManager,
  type ScreenLike,
  type ElectronDisplayLike
} from '../../src/main/displays/display-manager'
import type { CaptureSelection } from '../../src/shared/contracts/channels'

class MockScreen implements ScreenLike {
  public displays: ElectronDisplayLike[] = []
  public primaryDisplay: ElectronDisplayLike | null = null

  public listeners: Record<string, ((...args: unknown[]) => void)[]> = {
    'display-added': [],
    'display-removed': [],
    'display-metrics-changed': []
  }

  getAllDisplays(): ElectronDisplayLike[] {
    return this.displays
  }

  getPrimaryDisplay(): ElectronDisplayLike {
    if (this.primaryDisplay) return this.primaryDisplay
    if (this.displays.length > 0) return this.displays[0]
    throw new Error('No displays available')
  }

  on(
    event: 'display-added' | 'display-removed' | 'display-metrics-changed',
    listener: (...args: unknown[]) => void
  ): this {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(listener)
    return this
  }

  removeListener(
    event: 'display-added' | 'display-removed' | 'display-metrics-changed',
    listener: (...args: unknown[]) => void
  ): this {
    if (!this.listeners[event]) return this
    this.listeners[event] = this.listeners[event].filter((l) => l !== listener)
    return this
  }

  emit(event: 'display-added' | 'display-removed' | 'display-metrics-changed', ...args: unknown[]): void {
    const list = this.listeners[event] || []
    for (const listener of list) {
      listener(...args)
    }
  }
}

describe('DisplayManager', () => {
  let mockScreen: MockScreen
  let mockSelection: CaptureSelection

  const createDisplay = (
    id: number,
    x: number,
    y: number,
    width = 1920,
    height = 1080,
    label?: string
  ): ElectronDisplayLike => ({
    id,
    label,
    bounds: { x, y, width, height },
    workArea: { x, y, width, height: height - 40 },
    scaleFactor: 1.0,
    rotation: 0
  })

  beforeEach(() => {
    mockScreen = new MockScreen()
    mockSelection = { mode: 'both' }
  })

  describe('Display Enumeration & Normalization', () => {
    it('enumerates single monitor configuration correctly', () => {
      const disp1 = createDisplay(101, 0, 0, 1920, 1080, 'Dell U2415')
      mockScreen.displays = [disp1]
      mockScreen.primaryDisplay = disp1

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const config = manager.getDisplayConfiguration()

      expect(config.count).toBe(1)
      expect(config.isMultiDisplay).toBe(false)
      expect(config.primaryId).toBe('101')
      expect(config.displays[0].id).toBe('101')
      expect(config.displays[0].label).toBe('Dell U2415')
      expect(config.displays[0].isPrimary).toBe(true)
      expect(config.displays[0].bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
      expect(config.displays[0].scaleFactor).toBe(1.0)
    })

    it('enumerates dual monitor setup with deterministic sorting (primary first)', () => {
      const primaryDisp = createDisplay(101, 0, 0, 1920, 1080, 'Main Monitor')
      const secondaryDisp = createDisplay(102, -1920, 0, 1920, 1080, 'Left Monitor')

      // Screen returns them in reverse order
      mockScreen.displays = [secondaryDisp, primaryDisp]
      mockScreen.primaryDisplay = primaryDisp

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const config = manager.getDisplayConfiguration()

      expect(config.count).toBe(2)
      expect(config.isMultiDisplay).toBe(true)
      expect(config.primaryId).toBe('101')

      // Primary is first in the list
      expect(config.displays[0].id).toBe('101')
      expect(config.displays[0].isPrimary).toBe(true)

      // Secondary is second
      expect(config.displays[1].id).toBe('102')
      expect(config.displays[1].isPrimary).toBe(false)
      expect(config.displays[1].bounds.x).toBe(-1920)
    })

    it('assigns fallback labels when Electron display label is missing or empty', () => {
      const disp1 = createDisplay(1, 0, 0, 1920, 1080, '')
      const disp2 = createDisplay(2, 1920, 0, 1920, 1080, '   ')

      mockScreen.displays = [disp1, disp2]
      mockScreen.primaryDisplay = disp1

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const config = manager.getDisplayConfiguration()

      expect(config.displays[0].label).toBe('Display 1 (Primary)')
      expect(config.displays[1].label).toBe('Display 2')
    })
  })

  describe('Selected Display Loss Detection Invariant', () => {
    it('does not flag loss when selection mode is both', () => {
      const disp1 = createDisplay(1, 0, 0)
      mockScreen.displays = [disp1]
      mockScreen.primaryDisplay = disp1
      mockSelection = { mode: 'both' }

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const config = manager.getDisplayConfiguration()

      expect(config.selectedDisplayLost).toBe(false)
    })

    it('does not flag loss when chosen displayId exists in enumerated displays', () => {
      const disp1 = createDisplay(1, 0, 0)
      const disp2 = createDisplay(2, 1920, 0)
      mockScreen.displays = [disp1, disp2]
      mockScreen.primaryDisplay = disp1
      mockSelection = { mode: 'single', displayId: '2' }

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const config = manager.getDisplayConfiguration()

      expect(config.selectedDisplayLost).toBe(false)
    })

    it('flags selectedDisplayLost when chosen displayId is no longer present', () => {
      const disp1 = createDisplay(1, 0, 0)
      mockScreen.displays = [disp1] // disp2 was unplugged
      mockScreen.primaryDisplay = disp1
      mockSelection = { mode: 'single', displayId: '2' }

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const config = manager.getDisplayConfiguration()

      expect(config.selectedDisplayLost).toBe(true)
      // Invariant: manager did NOT mutate selection or auto-switch to disp1
      expect(mockSelection).toEqual({ mode: 'single', displayId: '2' })
    })
  })

  describe('Hotplug Notifications & Event Deduplication', () => {
    it('notifies listeners when a display is added', () => {
      const disp1 = createDisplay(1, 0, 0)
      mockScreen.displays = [disp1]
      mockScreen.primaryDisplay = disp1

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const listenerSpy = vi.fn()
      manager.addListener(listenerSpy)

      // Simulate hotplug add
      const disp2 = createDisplay(2, 1920, 0)
      mockScreen.displays = [disp1, disp2]
      mockScreen.emit('display-added', {}, disp2)

      expect(listenerSpy).toHaveBeenCalledTimes(1)
      expect(listenerSpy.mock.calls[0][0].count).toBe(2)
      expect(listenerSpy.mock.calls[0][0].isMultiDisplay).toBe(true)
    })

    it('notifies listeners when a display is removed', () => {
      const disp1 = createDisplay(1, 0, 0)
      const disp2 = createDisplay(2, 1920, 0)
      mockScreen.displays = [disp1, disp2]
      mockScreen.primaryDisplay = disp1

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const listenerSpy = vi.fn()
      manager.addListener(listenerSpy)

      // Simulate hotplug remove
      mockScreen.displays = [disp1]
      mockScreen.emit('display-removed', {}, disp2)

      expect(listenerSpy).toHaveBeenCalledTimes(1)
      expect(listenerSpy.mock.calls[0][0].count).toBe(1)
      expect(listenerSpy.mock.calls[0][0].isMultiDisplay).toBe(false)
    })

    it('notifies listeners when display metrics change', () => {
      const disp1 = createDisplay(1, 0, 0, 1920, 1080)
      mockScreen.displays = [disp1]
      mockScreen.primaryDisplay = disp1

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const listenerSpy = vi.fn()
      manager.addListener(listenerSpy)

      // Resolution changed to 2560x1440
      const updatedDisp1 = createDisplay(1, 0, 0, 2560, 1440)
      mockScreen.displays = [updatedDisp1]
      mockScreen.primaryDisplay = updatedDisp1
      mockScreen.emit('display-metrics-changed', {}, updatedDisp1, ['bounds'])

      expect(listenerSpy).toHaveBeenCalledTimes(1)
      expect(listenerSpy.mock.calls[0][0].displays[0].bounds.width).toBe(2560)
    })

    it('deduplicates identical configurations to avoid redundant listener calls', () => {
      const disp1 = createDisplay(1, 0, 0, 1920, 1080)
      mockScreen.displays = [disp1]
      mockScreen.primaryDisplay = disp1

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const listenerSpy = vi.fn()
      manager.addListener(listenerSpy)

      // Emit metrics changed without actual change
      mockScreen.emit('display-metrics-changed', {}, disp1, [])
      mockScreen.emit('display-metrics-changed', {}, disp1, [])

      expect(listenerSpy).not.toHaveBeenCalled()
    })

    it('unsubscribes cleanly and releases screen API listeners on stopListening', () => {
      const disp1 = createDisplay(1, 0, 0)
      mockScreen.displays = [disp1]
      mockScreen.primaryDisplay = disp1

      const manager = new DisplayManager(mockScreen, () => mockSelection)
      const listenerSpy = vi.fn()
      const unsubscribe = manager.addListener(listenerSpy)

      expect(mockScreen.listeners['display-added'].length).toBe(1)
      expect(mockScreen.listeners['display-removed'].length).toBe(1)
      expect(mockScreen.listeners['display-metrics-changed'].length).toBe(1)

      // Unsubscribe single listener
      unsubscribe()

      expect(mockScreen.listeners['display-added'].length).toBe(0)
      expect(mockScreen.listeners['display-removed'].length).toBe(0)
      expect(mockScreen.listeners['display-metrics-changed'].length).toBe(0)
    })
  })
})

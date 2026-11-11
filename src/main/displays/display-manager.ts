import { screen } from 'electron'
import {
  IPC_CHANNELS,
  type DisplayBounds,
  type DisplayInfo,
  type DisplayConfiguration,
  type CaptureSelection
} from '../../shared/contracts/channels'
import { DisplayConfigurationSchema } from '../../shared/contracts/ipc'
import { getCurrentCaptureSelection } from '../ipc/register-handlers'

export interface ElectronDisplayLike {
  id: number
  label?: string
  bounds: DisplayBounds
  workArea: DisplayBounds
  scaleFactor: number
  rotation?: number
}

export interface ScreenLike {
  getAllDisplays(): ElectronDisplayLike[]
  getPrimaryDisplay(): ElectronDisplayLike
  on(
    event: 'display-added' | 'display-removed' | 'display-metrics-changed',
    listener: (...args: unknown[]) => void
  ): this
  removeListener(
    event: 'display-added' | 'display-removed' | 'display-metrics-changed',
    listener: (...args: unknown[]) => void
  ): this
}

export type DisplayChangeListener = (configuration: DisplayConfiguration) => void

/**
 * Display Manager for Windows monitor enumeration, metric tracking, and hotplug lifecycle.
 * Invariant: never auto-substitutes a display when a selected display is removed.
 * Electron display IDs are normalized to strings; they are not assumed to be immutable hardware identifiers.
 */
export class DisplayManager {
  private screenApi: ScreenLike
  private getCaptureSelection: () => CaptureSelection
  private listeners = new Set<DisplayChangeListener>()
  private isListening = false
  private lastSerializedConfig = ''

  private onDisplayAddedHandler: () => void
  private onDisplayRemovedHandler: () => void
  private onDisplayMetricsChangedHandler: () => void

  constructor(
    screenApi: ScreenLike = screen,
    getCaptureSelection: () => CaptureSelection = getCurrentCaptureSelection
  ) {
    this.screenApi = screenApi
    this.getCaptureSelection = getCaptureSelection

    this.onDisplayAddedHandler = () => this.handleDisplayChangeEvent()
    this.onDisplayRemovedHandler = () => this.handleDisplayChangeEvent()
    this.onDisplayMetricsChangedHandler = () => this.handleDisplayChangeEvent()
  }

  /**
   * Normalizes an Electron display into the typed DisplayInfo contract.
   */
  public normalizeDisplay(
    display: ElectronDisplayLike,
    primaryId: number,
    index: number
  ): DisplayInfo {
    const isPrimary = display.id === primaryId
    const fallbackLabel = isPrimary ? `Display ${index + 1} (Primary)` : `Display ${index + 1}`
    const label = display.label?.trim() ? display.label.trim() : fallbackLabel

    return {
      id: String(display.id),
      label,
      isPrimary,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      },
      workArea: {
        x: display.workArea.x,
        y: display.workArea.y,
        width: display.workArea.width,
        height: display.workArea.height
      },
      scaleFactor: display.scaleFactor > 0 ? display.scaleFactor : 1,
      rotation: display.rotation ?? 0
    }
  }

  /**
   * Returns current display configuration, detecting whether the currently chosen
   * single display was removed, without mutating or auto-switching the selection.
   */
  public getDisplayConfiguration(): DisplayConfiguration {
    const rawDisplays = this.screenApi.getAllDisplays() || []
    let primaryId = 0
    try {
      primaryId = this.screenApi.getPrimaryDisplay()?.id ?? 0
    } catch {
      primaryId = rawDisplays[0]?.id ?? 0
    }

    // Sort deterministically: primary first, then by X-coordinate
    const sorted = [...rawDisplays].sort((a, b) => {
      if (a.id === primaryId) return -1
      if (b.id === primaryId) return 1
      return a.bounds.x - b.bounds.x
    })

    const displays = sorted.map((d, index) => this.normalizeDisplay(d, primaryId, index))

    // Check if previously chosen single display was lost
    const selection = this.getCaptureSelection()
    let selectedDisplayLost = false

    if (selection.mode === 'single') {
      const exists = displays.some((d) => d.id === selection.displayId)
      if (!exists) {
        selectedDisplayLost = true
      }
    }

    return {
      displays,
      primaryId: String(primaryId),
      count: displays.length,
      isMultiDisplay: displays.length > 1,
      selectedDisplayLost
    }
  }

  /**
   * Subscribes to display change events with deduplication.
   */
  public addListener(listener: DisplayChangeListener): () => void {
    this.listeners.add(listener)
    this.ensureListening()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.stopListening()
      }
    }
  }

  public ensureListening(): void {
    if (this.isListening) return
    this.isListening = true

    this.screenApi.on('display-added', this.onDisplayAddedHandler)
    this.screenApi.on('display-removed', this.onDisplayRemovedHandler)
    this.screenApi.on('display-metrics-changed', this.onDisplayMetricsChangedHandler)

    const initialConfig = this.getDisplayConfiguration()
    this.lastSerializedConfig = this.serializeConfig(initialConfig)
  }

  public stopListening(): void {
    if (!this.isListening) return
    this.isListening = false

    this.screenApi.removeListener('display-added', this.onDisplayAddedHandler)
    this.screenApi.removeListener('display-removed', this.onDisplayRemovedHandler)
    this.screenApi.removeListener('display-metrics-changed', this.onDisplayMetricsChangedHandler)

    this.listeners.clear()
  }

  private handleDisplayChangeEvent(): void {
    const config = this.getDisplayConfiguration()
    const serialized = this.serializeConfig(config)

    // Deduplicate identical configurations
    if (serialized === this.lastSerializedConfig) {
      return
    }

    this.lastSerializedConfig = serialized

    for (const listener of this.listeners) {
      try {
        listener(config)
      } catch (err) {
        console.error('Error in display change listener:', err)
      }
    }
  }

  private serializeConfig(config: DisplayConfiguration): string {
    // Sort displays deterministically by ID to guarantee canonical ordering
    const sortedDisplays = [...config.displays].sort((a, b) => a.id.localeCompare(b.id))

    return JSON.stringify({
      count: config.count,
      primaryId: config.primaryId,
      selectedDisplayLost: Boolean(config.selectedDisplayLost),
      displays: sortedDisplays.map((d) => ({
        id: d.id,
        label: d.label,
        isPrimary: d.isPrimary,
        bounds: {
          x: d.bounds.x,
          y: d.bounds.y,
          width: d.bounds.width,
          height: d.bounds.height
        },
        workArea: {
          x: d.workArea.x,
          y: d.workArea.y,
          width: d.workArea.width,
          height: d.workArea.height
        },
        scaleFactor: d.scaleFactor,
        rotation: d.rotation
      }))
    })
  }
}

export interface WebContentsSenderLike {
  isDestroyed?: () => boolean
  send(channel: string, ...args: unknown[]): void
}

/**
 * Sets up safe, validated display change forwarding from DisplayManager to WebContents.
 * - Enforces Zod schema validation before sending to renderer.
 * - Suppresses sending if target WebContents is destroyed or missing.
 * - Returns an unsubscribe teardown function.
 */
export function forwardDisplayEvents(
  target: WebContentsSenderLike | null | undefined,
  displayManager: DisplayManager
): () => void {
  if (!target || typeof target.send !== 'function') {
    return () => {}
  }

  const listener = (config: DisplayConfiguration): void => {
    if (typeof target.isDestroyed === 'function' && target.isDestroyed()) {
      return
    }

    try {
      const validated = DisplayConfigurationSchema.parse(config)
      target.send(IPC_CHANNELS.DISPLAYS_CHANGED, validated)
    } catch (err) {
      console.error('Failed to validate or forward display configuration:', err)
    }
  }

  return displayManager.addListener(listener)
}

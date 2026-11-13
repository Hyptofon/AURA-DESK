import { desktopCapturer } from 'electron'
import type {
  CapturedFrame,
  FrameBufferOptions,
  FrameBufferStats,
  FrameCaptureBackend,
  ScreenCapturePort
} from '@/shared/contracts/capture'
import type { DisplayBounds, SessionStatus } from '@/shared/contracts/channels'
import type { DisplayManager } from '../displays/display-manager'
import { FrameRingBuffer } from './frame-buffer'
import { MediaStreamDisplayCaptureBackend } from './mediastream-backend'
import {
  resolveSourceForDisplay,
  type DesktopCapturerSourceLike
} from './source-resolver'
import {
  queryWindowsDisplayDevices,
  type WindowsDisplayDevice
} from './windows-display-query'

export interface DesktopCapturerLike {
  getSources(options: {
    types: string[]
    thumbnailSize?: { width: number; height: number }
    fetchWindowIcons?: boolean
  }): Promise<DesktopCapturerSourceLike[]>
}

export interface SingleDisplayCapturerOptions extends FrameBufferOptions {
  sampleIntervalMs?: number
  capturerApi?: DesktopCapturerLike
  backend?: FrameCaptureBackend
  windowsDisplayQuery?: () => Promise<WindowsDisplayDevice[]>
}

const DEFAULT_SAMPLE_INTERVAL_MS = 2000 // 2 seconds per spec FR-02

/**
 * Single Display Capturer.
 * Non-negotiable Invariants:
 * 1. Only the explicitly selected display is captured.
 * 2. The other physical display is never initialized, captured, or buffered.
 * 3. On disconnect or ID loss, capture aborts immediately with no fallback to primary.
 * 4. In-flight async operations are cancelled via session generation tokens on Stop/hotplug/restart.
 * 5. Lifecycle state is authoritative and synchronized with listeners (single source of truth).
 * 6. Overlapping capture operations are prevented via in-flight capture lock.
 */
export class SingleDisplayCapturer implements ScreenCapturePort {
  private status: SessionStatus = 'idle'
  private sessionGeneration = 0
  private activeDisplayId: string | null = null
  private activeDisplayBounds?: DisplayBounds
  private resolvedSourceId: string | null = null
  private sampleTimer: ReturnType<typeof setInterval> | null = null
  private unsubscribeDisplayManager: (() => void) | null = null
  private lastError: string | null = null
  private isCapturing = false
  private pendingBackendStop: Promise<void> | null = null
  private readonly statusListeners = new Set<(status: SessionStatus, error?: string) => void>()

  private readonly buffer: FrameRingBuffer
  private readonly sampleIntervalMs: number
  private readonly capturerApi: DesktopCapturerLike
  private readonly backend: FrameCaptureBackend
  private readonly displayManager: DisplayManager
  private readonly windowsDisplayQuery: () => Promise<WindowsDisplayDevice[]>

  constructor(
    displayManager: DisplayManager,
    options: SingleDisplayCapturerOptions = {}
  ) {
    this.displayManager = displayManager
    this.buffer = new FrameRingBuffer(options)
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS
    this.capturerApi = options.capturerApi ?? desktopCapturer
    this.backend = options.backend ?? new MediaStreamDisplayCaptureBackend()
    this.windowsDisplayQuery = options.windowsDisplayQuery ?? queryWindowsDisplayDevices
  }

  /**
   * Starts capture for an explicit display ID.
   * Fails closed if display does not exist, sources cannot be resolved,
   * or a concurrent start is already in progress.
   */
  public async start(displayId: string): Promise<void> {
    if (!displayId || typeof displayId !== 'string' || displayId.trim() === '') {
      throw new Error('Capture initialization failed: invalid or empty displayId')
    }

    const trimmedId = displayId.trim()

    // If already active on the same display, no-op
    if (this.status === 'active' && this.activeDisplayId === trimmedId) {
      return
    }

    // Protect against concurrent start invocations
    if (this.status === 'starting') {
      throw new Error(
        'Concurrent capture start rejected: another capture session is currently starting'
      )
    }

    // If active on a different display, stop previous session first
    if (this.status === 'active') {
      await this.stop()
    }

    // Await any pending background stop from a previous abrupt termination
    if (this.pendingBackendStop) {
      try {
        await this.pendingBackendStop
      } catch {
        // Logged and handled in pendingBackendStop handler
      }
    }

    const currentGen = ++this.sessionGeneration
    this.status = 'starting'
    this.setStatus('starting')

    try {
      // 1. Verify display exists in current configuration
      const config = this.displayManager.getDisplayConfiguration()
      const targetDisplay = config.displays.find((d) => d.id === trimmedId)
      if (!targetDisplay) {
        throw new Error(
          `Cannot start capture: display "${trimmedId}" is not present in active display configuration`
        )
      }

      // 2. Query capturer metadata with ZERO thumbnail dimensions (avoids cross-display thumbnails)
      const sources = await this.capturerApi.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      })

      // Check if session was stopped or invalidated while getSources() was pending
      if (this.sessionGeneration !== currentGen || this.status !== 'starting') {
        throw new Error('Capture start was cancelled or superseded before becoming active')
      }

      // 3. Resolve mapping: if sources have empty display_id and on Windows, query physical device coordinates
      let windowsDevices: WindowsDisplayDevice[] | undefined
      const hasPopulatedDisplayId = sources.some(
        (s) => s.display_id !== undefined && s.display_id !== null && s.display_id.trim() !== ''
      )

      if (!hasPopulatedDisplayId && process.platform === 'win32') {
        windowsDevices = await this.windowsDisplayQuery()
      }

      // Check if session was stopped or invalidated while windowsDisplayQuery was pending
      if (this.sessionGeneration !== currentGen || this.status !== 'starting') {
        throw new Error('Capture start was cancelled or superseded before becoming active')
      }

      const resolved = resolveSourceForDisplay(trimmedId, config.displays, sources, windowsDevices)

      this.resolvedSourceId = resolved.sourceId
      this.activeDisplayId = trimmedId
      this.activeDisplayBounds = targetDisplay.bounds

      // 4. Bind buffer to the selected display (enforces hard single-display isolation)
      this.buffer.bindDisplay(trimmedId)

      // 5. Initialize backend for selected source
      if (this.backend.start) {
        await this.backend.start({
          sourceId: this.resolvedSourceId,
          displayId: trimmedId,
          bounds: this.activeDisplayBounds,
          sourceName: resolved.sourceName
        })
      }

      // Check if session was stopped or invalidated while backend.start was pending
      if (this.sessionGeneration !== currentGen || this.status !== 'starting') {
        throw new Error('Capture start was cancelled or superseded before becoming active')
      }

      // 6. Listen to display configuration changes (hotplug and loss detection)
      this.unsubscribeDisplayManager = this.displayManager.addListener((newConfig) => {
        if (this.sessionGeneration !== currentGen || this.status !== 'active') {
          return
        }
        const stillPresent = newConfig.displays.some((d) => d.id === this.activeDisplayId)
        if (!stillPresent || newConfig.selectedDisplayLost) {
          // Disconnect detected: stop immediately, flush memory, do not switch to another display
          this.handleAbruptTermination('SELECTED_DISPLAY_LOST')
        }
      })

      // 7. Take an immediate sample before scheduling interval
      await this.captureSample(currentGen, true)

      // Check if session was stopped or invalidated while initial sample was pending
      if (this.sessionGeneration !== currentGen || this.status !== 'starting') {
        throw new Error('Capture start was cancelled or superseded before becoming active')
      }

      // Ensure that initial sample was successfully buffered
      if (!this.buffer.getLatest()) {
        throw new Error('Capture initialization failed: initial frame was not obtained')
      }

      // 8. Transition to active state
      this.setStatus('active')

      // Schedule subsequent sample interval
      this.sampleTimer = setInterval(() => {
        this.captureSample(currentGen).catch((err) => {
          console.error('Error in capture sample loop:', err)
        })
      }, this.sampleIntervalMs)
    } catch (err: unknown) {
      if (this.sessionGeneration === currentGen) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        try {
          await this.stopAsync('error', errorMsg)
        } catch {
          // Teardown failure is recorded in status and lastError by stopAsync
        }
      }
      throw err
    }
  }

  /**
   * Stops capture immediately and releases all timers, memory buffers, and subscriptions.
   * Completely idempotent and safe against repeated calls.
   */
  public async stop(): Promise<void> {
    await this.stopAsync('idle')
  }

  public getStatus(): SessionStatus {
    return this.status
  }

  public getLastError(): string | null {
    return this.lastError
  }

  public onStatusChange(
    listener: (status: SessionStatus, error?: string) => void
  ): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  public isActive(): boolean {
    return this.status === 'active'
  }

  public getActiveDisplayId(): string | null {
    return this.activeDisplayId
  }

  public getLatestFrame(): CapturedFrame | null {
    if (this.status !== 'active') return null
    return this.buffer.getLatest()
  }

  public getFrameHistory(): CapturedFrame[] {
    if (this.status !== 'active') return []
    return this.buffer.getAll()
  }

  public getBufferStats(): FrameBufferStats {
    return this.buffer.getStats()
  }

  public getBackend(): FrameCaptureBackend {
    return this.backend
  }

  private async captureSample(expectedGen: number, rethrow = false): Promise<void> {
    if (
      this.isCapturing ||
      this.sessionGeneration !== expectedGen ||
      (this.status !== 'starting' && this.status !== 'active') ||
      !this.activeDisplayId ||
      !this.resolvedSourceId
    ) {
      return
    }

    this.isCapturing = true
    const targetId = this.activeDisplayId
    const sourceId = this.resolvedSourceId
    const bounds = this.activeDisplayBounds

    try {
      // Delegate frame capture to backend (backend receives only the target source and displayId)
      const frame = await this.backend.captureFrame({
        sourceId,
        displayId: targetId,
        bounds
      })

      // Post-await race validation: verify generation, state, and active display have not changed
      if (
        this.sessionGeneration !== expectedGen ||
        (this.status !== 'starting' && this.status !== 'active') ||
        this.activeDisplayId !== targetId
      ) {
        // Discard stale frame! Session was stopped, restarted, or switched during capture
        return
      }

      if (!frame) return

      // Validate frame displayId strictly matches active display
      if (frame.displayId !== targetId) {
        throw new Error(
          `Cross-display isolation violation from backend: expected "${targetId}", got "${frame.displayId}"`
        )
      }

      this.buffer.push(frame)
    } catch (err: unknown) {
      if (this.sessionGeneration !== expectedGen) {
        // Session was already cancelled or superseded
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      this.handleAbruptTermination('SOURCE_DISAPPEARED', msg)
      if (rethrow) {
        throw err
      }
    } finally {
      this.isCapturing = false
    }
  }

  private handleAbruptTermination(code: string, message?: string): void {
    const errorText = message ? `${code}: ${message}` : code
    this.sessionGeneration++

    if (this.sampleTimer) {
      clearInterval(this.sampleTimer)
      this.sampleTimer = null
    }

    if (this.unsubscribeDisplayManager) {
      this.unsubscribeDisplayManager()
      this.unsubscribeDisplayManager = null
    }

    // Flush all frame memory immediately
    this.buffer.clear()

    this.activeDisplayId = null
    this.resolvedSourceId = null
    this.activeDisplayBounds = undefined

    this.setStatus('error', errorText)

    if (this.backend.stop) {
      try {
        let stopErr: unknown = null
        const stopPromise = Promise.resolve(this.backend.stop())
          .catch((err) => {
            console.error('Asynchronous error during abrupt capture backend stop:', err)
            stopErr = err
          })
          .then(() => {
            if (stopErr) throw stopErr
          })
          .finally(() => {
            if (this.pendingBackendStop === stopPromise) {
              this.pendingBackendStop = null
            }
          })
        // Attach noop handler to prevent unhandled rejection warning in Node runtime
        stopPromise.catch(() => {})
        this.pendingBackendStop = stopPromise
      } catch (err) {
        console.error('Synchronous error invoking capture backend stop:', err)
      }
    }
  }

  private async stopAsync(finalStatus: SessionStatus = 'idle', error?: string): Promise<void> {
    // Invalidate in-flight capture operations
    this.sessionGeneration++

    if (this.sampleTimer) {
      clearInterval(this.sampleTimer)
      this.sampleTimer = null
    }

    if (this.unsubscribeDisplayManager) {
      this.unsubscribeDisplayManager()
      this.unsubscribeDisplayManager = null
    }

    let teardownError: unknown = null

    // Await any pending background stop from a previous abrupt termination first
    if (this.pendingBackendStop) {
      try {
        await this.pendingBackendStop
      } catch (err) {
        teardownError = err
      }
    }

    // Idempotent check: if already idle and finalStatus is idle, return
    if (this.status === 'idle' && finalStatus === 'idle' && !teardownError) {
      return
    }

    if (finalStatus === 'idle') {
      this.setStatus('stopping')
    }

    // Await asynchronous backend teardown
    if (this.backend.stop) {
      try {
        await this.backend.stop()
      } catch (err) {
        console.error('Error stopping capture backend:', err)
        teardownError = teardownError ?? err
      }
    }

    // Flush all frame memory immediately
    this.buffer.clear()

    this.activeDisplayId = null
    this.resolvedSourceId = null
    this.activeDisplayBounds = undefined

    if (teardownError) {
      const msg = teardownError instanceof Error ? teardownError.message : String(teardownError)
      const combinedError = error
        ? `${error}; BACKEND_STOP_FAILED: ${msg}`
        : `BACKEND_STOP_FAILED: ${msg}`
      this.setStatus('error', combinedError)
      throw teardownError
    }

    this.setStatus(finalStatus, error)
  }

  private setStatus(newStatus: SessionStatus, error?: string): void {
    if (this.status === newStatus && (!error || error === this.lastError)) {
      return
    }

    this.status = newStatus
    if (error !== undefined) {
      this.lastError = error
    } else if (newStatus === 'idle') {
      this.lastError = null
    }

    for (const listener of this.statusListeners) {
      try {
        listener(newStatus, this.lastError ?? undefined)
      } catch (err) {
        console.error('Error in status change listener:', err)
      }
    }
  }
}

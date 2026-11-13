import type { CapturedFrame, ScreenCapturePort } from '../../shared/contracts/capture'
import type { DisplayConfiguration, DisplayInfo, SessionStatus } from '../../shared/contracts/channels'
import { selectDualDisplayIds } from './dual-display-selection'

/** Narrow dependency: no Electron session, window, or pixels are created by this coordinator. */
export interface DualDisplayManager {
  getDisplayConfiguration(): DisplayConfiguration
  addListener(listener: (config: DisplayConfiguration) => void): () => void
}

export interface DualBufferStats {
  readonly frameCount: number
  readonly totalBytes: number
  readonly byDisplay: readonly [
    { readonly displayId: string; readonly frameCount: number; readonly totalBytes: number; readonly newestTimestamp: number | null; readonly status: SessionStatus },
    { readonly displayId: string; readonly frameCount: number; readonly totalBytes: number; readonly newestTimestamp: number | null; readonly status: SessionStatus }
  ]
}

/**
 * Owns the lifecycle of exactly two separately constructed SingleDisplayCapturer ports.
 * The ports MUST use independent MediaStream backends/partitions (P1.3 step 2).
 * This coordinator does not create streams or grant capture permission itself.
 *
 * On partial startup failure, lost display or child failure, BOTH children stop.
 * After an unexpected loss, recovery requires an explicit stop() and new start().
 */
export class DualDisplayCapturer {
  private status: SessionStatus = 'idle'
  private lastError: string | null = null
  private generation = 0
  private selectedIds: readonly [string, string] | null = null
  private displaySignature: string | null = null
  private unsubscribeDisplays: (() => void) | null = null
  private unsubscribeChildren: Array<() => void> = []
  private pendingCleanup: Promise<void> | null = null
  private readonly listeners = new Set<(status: SessionStatus, error?: string) => void>()

  constructor(
    private readonly displays: DualDisplayManager,
    private readonly children: readonly [ScreenCapturePort, ScreenCapturePort]
  ) {
    if (children[0] === children[1]) {
      throw new Error('Dual capture requires two distinct capture ports')
    }
  }

  public async start(): Promise<void> {
    if (this.status !== 'idle') {
      throw new Error(`Dual capture cannot start from status "${this.status}"; stop first`)
    }
    if (this.pendingCleanup) await this.pendingCleanup

    const configuration = this.displays.getDisplayConfiguration()
    const ids = selectDualDisplayIds(configuration)
    const generation = ++this.generation
    this.selectedIds = ids
    this.displaySignature = this.signature(configuration, ids)
    this.setStatus('starting')

    try {
      this.unsubscribeDisplays = this.displays.addListener((updated) => {
        if (generation !== this.generation || this.status === 'idle' || this.status === 'stopping') return
        try {
          if (this.signature(updated, ids) !== this.displaySignature) {
            this.abort('SELECTED_DISPLAY_CONFIGURATION_CHANGED')
          }
        } catch {
          this.abort('SELECTED_DISPLAY_LOST')
        }
      })

      this.unsubscribeChildren = this.children.map((child, index) =>
        child.onStatusChange((status, error) => {
          if (generation !== this.generation || this.status !== 'active' || status === 'active') return
          this.abort(`DISPLAY_${index + 1}_CAPTURE_TERMINATED: ${error ?? status}`)
        })
      )

      // Both starts overlap: this is NOT sequential frame capture.
      const started = await Promise.allSettled([
        this.children[0].start(ids[0]),
        this.children[1].start(ids[1])
      ])
      // Wait for BOTH initializations to settle before rollback. Promise.all
      // rejects early and can leave its sibling opening a stream after cleanup.
      const rejected = started.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (rejected && generation === this.generation) throw rejected.reason

      if (generation !== this.generation || this.getStatus() !== 'starting') {
        throw new Error('Dual capture start was cancelled')
      }
      if (this.signature(this.displays.getDisplayConfiguration(), ids) !== this.displaySignature) {
        throw new Error('Display configuration changed during dual capture startup')
      }

      for (let i = 0; i < 2; i++) {
        const child = this.children[i]
        const frame = child.getLatestFrame()
        if (
          child.getStatus() !== 'active' ||
          child.getActiveDisplayId() !== ids[i] ||
          !frame ||
          frame.displayId !== ids[i] ||
          !Number.isFinite(frame.timestamp) ||
          frame.timestamp <= 0
        ) {
          throw new Error(`Display ${i + 1} did not produce an active, correctly identified timestamped frame`)
        }
      }
      this.setStatus('active')
    } catch (error) {
      if (generation === this.generation) {
        this.abort(`DUAL_START_FAILED: ${this.message(error)}`)
        try {
          await this.pendingCleanup
        } catch {
          // The cleanup error is recorded in this.lastError by abort().
        }
      }
      throw error
    }
  }

  /** Explicit Stop: abort work, await both track teardowns, then return to idle. */
  public async stop(): Promise<void> {
    if (this.status === 'idle' && !this.pendingCleanup) return
    const generation = ++this.generation
    this.detachListeners()
    this.selectedIds = null
    this.displaySignature = null
    this.setStatus('stopping')

    try {
      // Retry both child stops even if a prior emergency cleanup failed.
      if (this.pendingCleanup) {
        try {
          await this.pendingCleanup
        } catch (error) {
          console.error('Previous dual capture cleanup failed; retrying Stop:', error)
        }
      }
      await this.stopChildren()
      if (generation === this.generation) this.setStatus('idle')
    } catch (error) {
      if (generation === this.generation) this.setStatus('error', `DUAL_STOP_FAILED: ${this.message(error)}`)
      throw error
    }
  }

  public getStatus(): SessionStatus {
    return this.status
  }

  public getLastError(): string | null {
    return this.lastError
  }

  public getActiveDisplayIds(): readonly [string, string] | null {
    return this.status === 'active' ? this.selectedIds : null
  }

  public onStatusChange(listener: (status: SessionStatus, error?: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public getLatestFrames(): readonly [CapturedFrame | null, CapturedFrame | null] {
    if (this.status !== 'active' || !this.selectedIds) return [null, null]
    const frames = [this.children[0].getLatestFrame(), this.children[1].getLatestFrame()] as const
    if (frames.some((frame, i) => frame !== null && frame.displayId !== this.selectedIds?.[i])) {
      this.abort('CROSS_DISPLAY_FRAME_MISMATCH')
      return [null, null]
    }
    return frames
  }

  /** Aggregate is diagnostic only; actual limits must be configured on BOTH child ring buffers. */
  public getBufferStats(): DualBufferStats {
    const [a, b] = this.children.map((child) => child.getBufferStats())
    const ids = this.selectedIds
    return {
      frameCount: a.frameCount + b.frameCount,
      totalBytes: a.totalBytes + b.totalBytes,
      byDisplay: [
        { displayId: ids?.[0] ?? '', frameCount: a.frameCount, totalBytes: a.totalBytes, newestTimestamp: a.newestTimestamp, status: this.children[0].getStatus() },
        { displayId: ids?.[1] ?? '', frameCount: b.frameCount, totalBytes: b.totalBytes, newestTimestamp: b.newestTimestamp, status: this.children[1].getStatus() }
      ]
    }
  }

  /** Emergency path invalidates status synchronously; OS track release is asynchronous. */
  private abort(reason: string): void {
    if (this.status === 'idle' || this.status === 'stopping' || this.status === 'error') return
    const generation = ++this.generation
    this.detachListeners()
    this.selectedIds = null
    this.displaySignature = null
    this.setStatus('error', reason)

    const cleanup = this.stopChildren()
    this.pendingCleanup = cleanup
    void cleanup
      .catch((error) => {
        if (generation === this.generation) {
          this.setStatus('error', `${reason}; TEARDOWN_FAILED: ${this.message(error)}`)
        }
      })
      .finally(() => {
        if (this.pendingCleanup === cleanup) this.pendingCleanup = null
      })
  }

  private async stopChildren(): Promise<void> {
    const results = await Promise.allSettled(this.children.map((child) => child.stop()))
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length) {
      throw new Error(`Failed to stop ${failures.length} of 2 display capture ports: ${failures.map((x) => this.message(x.reason)).join('; ')}`)
    }
  }

  private detachListeners(): void {
    this.unsubscribeDisplays?.()
    this.unsubscribeDisplays = null
    for (const unsubscribe of this.unsubscribeChildren) unsubscribe()
    this.unsubscribeChildren = []
  }

  private signature(config: DisplayConfiguration, expected: readonly [string, string]): string {
    const current = selectDualDisplayIds(config)
    if (current[0] !== expected[0] || current[1] !== expected[1] || config.selectedDisplayLost) {
      throw new Error('Dual display selection no longer matches the authorized capture sources')
    }
    const signatureOf = (display: DisplayInfo): string =>
      JSON.stringify([display.id, display.bounds, display.scaleFactor, display.rotation])
    return expected.map((id) => signatureOf(config.displays.find((d) => d.id === id)!)).join('|')
  }

  private setStatus(status: SessionStatus, error?: string): void {
    this.status = status
    this.lastError = error ?? (status === 'idle' ? null : this.lastError)
    for (const listener of this.listeners) {
      try {
        listener(status, this.lastError ?? undefined)
      } catch (err) {
        console.error('Dual capture status listener failed:', err)
      }
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}

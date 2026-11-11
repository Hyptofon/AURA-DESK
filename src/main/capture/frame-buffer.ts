import type {
  CapturedFrame,
  FrameBufferOptions,
  FrameBufferStats
} from '../../shared/contracts/capture'

const DEFAULT_MAX_FRAMES = 60 // 120 seconds at 2s interval
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB RAM budget
const DEFAULT_MAX_DURATION_MS = 120 * 1000 // 120 seconds rolling window

/**
 * Bounded in-memory frame ring buffer.
 * Strictly maintains frames for a single active display.
 * Rejects or clears frames when switching or stopping to prevent cross-display leakage.
 */
export class FrameRingBuffer {
  private frames: CapturedFrame[] = []
  private totalBytes = 0
  private boundDisplayId: string | null = null

  private readonly maxFrames: number
  private readonly maxBytes: number
  private readonly maxDurationMs: number

  constructor(options: FrameBufferOptions = {}) {
    this.maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  }

  /**
   * Sets or binds the buffer to an explicit display ID.
   * If the display ID changes, previous frames are wiped immediately.
   */
  public setDisplayId(displayId: string | null): void {
    if (this.boundDisplayId !== displayId) {
      this.clear()
      this.boundDisplayId = displayId
    }
  }

  public getDisplayId(): string | null {
    return this.boundDisplayId
  }

  /**
   * Pushes a new frame into the buffer.
   * Fails closed if the frame's displayId does not match the bound displayId.
   */
  public push(frame: CapturedFrame): void {
    if (!this.boundDisplayId) {
      this.boundDisplayId = frame.displayId
    } else if (frame.displayId !== this.boundDisplayId) {
      throw new Error(
        `Cross-display isolation violation: Attempted to buffer frame for display "${frame.displayId}" in buffer bound to "${this.boundDisplayId}"`
      )
    }

    this.frames.push(frame)
    this.totalBytes += frame.byteLength

    this.evictOldFrames(frame.timestamp)
  }

  /**
   * Returns the most recent frame, or null if buffer is empty.
   */
  public getLatest(): CapturedFrame | null {
    if (this.frames.length === 0) return null
    return this.frames[this.frames.length - 1]
  }

  /**
   * Returns a copy of all buffered frames.
   */
  public getAll(): CapturedFrame[] {
    return [...this.frames]
  }

  /**
   * Clears all frames and releases memory references immediately.
   */
  public clear(): void {
    this.frames = []
    this.totalBytes = 0
    this.boundDisplayId = null
  }

  /**
   * Returns current buffer statistics.
   */
  public getStats(): FrameBufferStats {
    return {
      frameCount: this.frames.length,
      totalBytes: this.totalBytes,
      oldestTimestamp: this.frames.length > 0 ? this.frames[0].timestamp : null,
      newestTimestamp: this.frames.length > 0 ? this.frames[this.frames.length - 1].timestamp : null,
      displayId: this.boundDisplayId
    }
  }

  private evictOldFrames(currentTimestamp: number): void {
    // 1. Evict by duration TTL
    const cutoff = currentTimestamp - this.maxDurationMs
    while (this.frames.length > 0 && this.frames[0].timestamp < cutoff) {
      const evicted = this.frames.shift()!
      this.totalBytes -= evicted.byteLength
    }

    // 2. Evict by frame count limit
    while (this.frames.length > this.maxFrames) {
      const evicted = this.frames.shift()!
      this.totalBytes -= evicted.byteLength
    }

    // 3. Evict by memory byte limit
    while (this.totalBytes > this.maxBytes && this.frames.length > 1) {
      const evicted = this.frames.shift()!
      this.totalBytes -= evicted.byteLength
    }
  }
}

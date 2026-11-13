import type {
  CapturedFrame,
  FrameBufferOptions,
  FrameBufferStats
} from '@/shared/contracts/capture'

const DEFAULT_MAX_FRAMES = 60 // 120 seconds at 2s interval
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB RAM budget
const DEFAULT_MAX_DURATION_MS = 120 * 1000 // 120 seconds rolling window

/**
 * Bounded in-memory frame ring buffer.
 * Strictly maintains frames for an explicitly bound active display.
 * Rejects or clears frames when switching or stopping to prevent cross-display leakage.
 *
 * Retention & Security Note:
 * clear() releases all frame object and buffer references from the ring buffer for
 * garbage collection; in JavaScript runtimes, physical zeroization of dereferenced
 * TypedArrays is managed by the V8 garbage collector and OS memory allocator.
 */
export class FrameRingBuffer {
  private frames: CapturedFrame[] = []
  private totalBytes = 0
  private boundDisplayId: string | null = null

  private readonly maxFrames: number
  private readonly maxBytes: number
  private readonly maxDurationMs: number

  constructor(options: FrameBufferOptions = {}) {
    if (
      options.maxFrames !== undefined &&
      (!Number.isFinite(options.maxFrames) || options.maxFrames <= 0)
    ) {
      throw new RangeError('FrameRingBuffer options.maxFrames must be a positive number')
    }
    if (
      options.maxBytes !== undefined &&
      (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0)
    ) {
      throw new RangeError('FrameRingBuffer options.maxBytes must be a positive number')
    }
    if (
      options.maxDurationMs !== undefined &&
      (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0)
    ) {
      throw new RangeError('FrameRingBuffer options.maxDurationMs must be a positive number')
    }

    this.maxFrames = Math.floor(options.maxFrames ?? DEFAULT_MAX_FRAMES)
    this.maxBytes = Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES)
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  }

  /**
   * Binds the buffer to an explicit display ID.
   * If the display ID changes, previous frames are wiped immediately.
   */
  public bindDisplay(displayId: string): void {
    if (!displayId || typeof displayId !== 'string') {
      throw new Error('FrameRingBuffer.bindDisplay requires a valid non-empty displayId string')
    }
    if (this.boundDisplayId !== displayId) {
      this.clear()
      this.boundDisplayId = displayId
    }
  }

  /**
   * Unbinds the buffer from the active display and flushes all buffered frames.
   */
  public unbind(): void {
    this.clear()
  }

  /**
   * Compatibility setter: binds to displayId or unbinds if null.
   */
  public setDisplayId(displayId: string | null): void {
    if (displayId) {
      this.bindDisplay(displayId)
    } else {
      this.unbind()
    }
  }

  public getDisplayId(): string | null {
    return this.boundDisplayId
  }

  /**
   * Pushes a new frame into the buffer.
   * Fails closed if the buffer is not explicitly bound, or if the frame's displayId
   * does not match the bound displayId. Rejects oversized frames and invalid payloads.
   */
  public push(frame: CapturedFrame): void {
    if (!this.boundDisplayId) {
      throw new Error(
        'Buffer is not bound to an active display; call bindDisplay() before pushing frames'
      )
    }

    if (frame.displayId !== this.boundDisplayId) {
      throw new Error(
        `Cross-display isolation violation: Attempted to buffer frame for display "${frame.displayId}" in buffer bound to "${this.boundDisplayId}"`
      )
    }

    if (!frame.data || !(frame.data instanceof Uint8Array)) {
      throw new TypeError('CapturedFrame.data must be a valid Uint8Array')
    }

    if (!Number.isFinite(frame.byteLength) || frame.byteLength <= 0) {
      throw new RangeError('CapturedFrame.byteLength must be a positive number')
    }

    if (frame.data.byteLength !== frame.byteLength) {
      throw new Error(
        `Frame payload length mismatch: declared byteLength (${frame.byteLength}) does not match actual data.byteLength (${frame.data.byteLength})`
      )
    }

    // Reject oversized frame before modifying buffer
    if (frame.byteLength > this.maxBytes) {
      throw new RangeError(
        `Frame byteLength (${frame.byteLength}) exceeds hard buffer maxBytes limit (${this.maxBytes})`
      )
    }

    // 1. Evict by duration TTL
    const cutoff = frame.timestamp - this.maxDurationMs
    while (this.frames.length > 0 && this.frames[0].timestamp < cutoff) {
      const evicted = this.frames.shift()!
      this.totalBytes -= evicted.byteLength
    }

    // 2. Evict oldest frames to ensure frame count and byte capacity limits
    while (
      this.frames.length >= this.maxFrames ||
      this.totalBytes + frame.byteLength > this.maxBytes
    ) {
      const evicted = this.frames.shift()!
      this.totalBytes -= evicted.byteLength
    }

    this.frames.push(frame)
    this.totalBytes += frame.byteLength
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
      newestTimestamp:
        this.frames.length > 0 ? this.frames[this.frames.length - 1].timestamp : null,
      displayId: this.boundDisplayId
    }
  }
}

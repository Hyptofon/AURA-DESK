import type { AudioBufferOptions, AudioBufferStats, AudioChunk } from '../../shared/contracts/audio'

/**
 * Hard-bounded in-memory ring buffer for audio chunks.
 * Enforces strict limits on chunk count, memory bytes, and time-to-live (TTL).
 * Guarantees zero unbounded memory growth and immediate memory erasure on Stop/clear.
 */
export class AudioRingBuffer {
  private readonly maxChunks: number
  private readonly maxBytes: number
  private readonly ttlMs: number

  private chunks: AudioChunk[] = []
  private totalBytes = 0

  constructor(options: AudioBufferOptions) {
    if (!Number.isFinite(options.maxChunks) || options.maxChunks <= 0) {
      throw new RangeError('maxChunks must be a positive finite number')
    }
    if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive finite number')
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new RangeError('ttlMs must be a positive finite number')
    }

    this.maxChunks = options.maxChunks
    this.maxBytes = options.maxBytes
    this.ttlMs = options.ttlMs
  }

  /**
   * Pushes a new audio chunk into the buffer.
   * Evicts expired or overflow chunks to maintain strict memory bounds.
   */
  push(chunk: AudioChunk): void {
    const chunkBytes = chunk.data.byteLength

    // Reject single oversized chunk that exceeds total buffer capacity
    if (chunkBytes > this.maxBytes) {
      throw new RangeError(
        `Audio chunk size (${chunkBytes} bytes) exceeds maximum buffer capacity (${this.maxBytes} bytes)`
      )
    }

    const now = chunk.timestamp

    // Evict expired chunks based on TTL
    this.evictExpired(now)

    // Evict oldest chunks until within maxChunks and maxBytes limits
    while (
      this.chunks.length > 0 &&
      (this.chunks.length >= this.maxChunks || this.totalBytes + chunkBytes > this.maxBytes)
    ) {
      const removed = this.chunks.shift()
      if (removed) {
        this.totalBytes -= removed.data.byteLength
      }
    }

    this.chunks.push(chunk)
    this.totalBytes += chunkBytes
  }

  /**
   * Evicts chunks whose age exceeds ttlMs relative to the reference timestamp.
   */
  private evictExpired(referenceTimestamp: number): void {
    const expiryThreshold = referenceTimestamp - this.ttlMs

    while (this.chunks.length > 0 && this.chunks[0].timestamp < expiryThreshold) {
      const removed = this.chunks.shift()
      if (removed) {
        this.totalBytes -= removed.data.byteLength
      }
    }
  }

  /**
   * Returns current buffer usage statistics.
   */
  getStats(): AudioBufferStats {
    return {
      chunkCount: this.chunks.length,
      totalBytes: this.totalBytes,
      oldestTimestamp: this.chunks.length > 0 ? this.chunks[0].timestamp : null,
      newestTimestamp: this.chunks.length > 0 ? this.chunks[this.chunks.length - 1].timestamp : null
    }
  }

  /**
   * Returns a copy of the current buffered audio chunks.
   */
  getChunks(): AudioChunk[] {
    return [...this.chunks]
  }

  /**
   * Immediately clears all buffered audio chunks from memory and resets statistics.
   */
  clear(): void {
    this.chunks = []
    this.totalBytes = 0
  }
}

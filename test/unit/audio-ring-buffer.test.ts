import { describe, it, expect } from 'vitest'
import { AudioRingBuffer } from '../../src/main/capture/audio-ring-buffer'
import type { AudioChunk } from '../../src/shared/contracts/audio'

function createFakeChunk(id: string, timestamp: number, byteLength: number): AudioChunk {
  return {
    id,
    source: 'mic',
    timestamp,
    durationMs: 20,
    sampleRate: 16000,
    channels: 1,
    data: new Uint8Array(byteLength),
    rms: 0.05,
    isSpeech: true
  }
}

describe('AudioRingBuffer', () => {
  it('throws RangeError for non-positive or invalid constructor options', () => {
    expect(() => new AudioRingBuffer({ maxChunks: 0, maxBytes: 1000, ttlMs: 1000 })).toThrow(RangeError)
    expect(() => new AudioRingBuffer({ maxChunks: 10, maxBytes: -1, ttlMs: 1000 })).toThrow(RangeError)
    expect(() => new AudioRingBuffer({ maxChunks: 10, maxBytes: 1000, ttlMs: 0 })).toThrow(RangeError)
  })

  it('pushes chunks and maintains accurate statistics', () => {
    const buffer = new AudioRingBuffer({ maxChunks: 5, maxBytes: 1000, ttlMs: 5000 })
    buffer.push(createFakeChunk('c1', 1000, 100))
    buffer.push(createFakeChunk('c2', 1020, 150))

    const stats = buffer.getStats()
    expect(stats.chunkCount).toBe(2)
    expect(stats.totalBytes).toBe(250)
    expect(stats.oldestTimestamp).toBe(1000)
    expect(stats.newestTimestamp).toBe(1020)
    expect(buffer.getChunks()).toHaveLength(2)
  })

  it('evicts oldest chunk when maxChunks limit is exceeded', () => {
    const buffer = new AudioRingBuffer({ maxChunks: 2, maxBytes: 1000, ttlMs: 5000 })
    buffer.push(createFakeChunk('c1', 1000, 100))
    buffer.push(createFakeChunk('c2', 1020, 100))
    buffer.push(createFakeChunk('c3', 1040, 100))

    const stats = buffer.getStats()
    expect(stats.chunkCount).toBe(2)
    expect(stats.totalBytes).toBe(200)
    expect(stats.oldestTimestamp).toBe(1020)
    expect(stats.newestTimestamp).toBe(1040)
    expect(buffer.getChunks().map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('evicts oldest chunks when maxBytes limit is exceeded', () => {
    const buffer = new AudioRingBuffer({ maxChunks: 10, maxBytes: 250, ttlMs: 5000 })
    buffer.push(createFakeChunk('c1', 1000, 100))
    buffer.push(createFakeChunk('c2', 1020, 100))
    // Pushing c3 (100 bytes) would make 300 > 250 -> evicts c1
    buffer.push(createFakeChunk('c3', 1040, 100))

    const stats = buffer.getStats()
    expect(stats.chunkCount).toBe(2)
    expect(stats.totalBytes).toBe(200)
    expect(buffer.getChunks().map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('rejects a single oversized chunk that exceeds total buffer capacity', () => {
    const buffer = new AudioRingBuffer({ maxChunks: 10, maxBytes: 200, ttlMs: 5000 })
    expect(() => buffer.push(createFakeChunk('c-oversized', 1000, 250))).toThrow(RangeError)
    expect(buffer.getStats().chunkCount).toBe(0)
  })

  it('evicts expired chunks according to TTL', () => {
    const buffer = new AudioRingBuffer({ maxChunks: 10, maxBytes: 1000, ttlMs: 200 })
    buffer.push(createFakeChunk('c1', 1000, 50))
    buffer.push(createFakeChunk('c2', 1100, 50))

    // Chunk arriving at t=1250: c1 (t=1000) is older than 1250 - 200 = 1050 -> evicted!
    buffer.push(createFakeChunk('c3', 1250, 50))

    const chunks = buffer.getChunks()
    expect(chunks.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(buffer.getStats().totalBytes).toBe(100)
  })

  it('clear() flushes all chunks and resets memory immediately', () => {
    const buffer = new AudioRingBuffer({ maxChunks: 10, maxBytes: 1000, ttlMs: 5000 })
    buffer.push(createFakeChunk('c1', 1000, 100))
    buffer.push(createFakeChunk('c2', 1020, 100))

    buffer.clear()
    const stats = buffer.getStats()
    expect(stats.chunkCount).toBe(0)
    expect(stats.totalBytes).toBe(0)
    expect(stats.oldestTimestamp).toBeNull()
    expect(stats.newestTimestamp).toBeNull()
    expect(buffer.getChunks()).toHaveLength(0)
  })
})

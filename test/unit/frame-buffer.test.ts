import { describe, it, expect, beforeEach } from 'vitest'
import { FrameRingBuffer } from '@/main/capture/frame-buffer'
import type { CapturedFrame } from '@/shared/contracts/capture'

describe('FrameRingBuffer', () => {
  let buffer: FrameRingBuffer

  const createValidFrame = (
    displayId: string,
    timestamp: number,
    byteLength = 1024
  ): CapturedFrame => {
    const data = new Uint8Array(byteLength)
    for (let i = 0; i < byteLength; i++) {
      data[i] = (i + timestamp) % 256
    }
    return {
      displayId,
      timestamp,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      data,
      byteLength,
      format: 'png',
      hash: `hash-${timestamp}`
    }
  }

  beforeEach(() => {
    buffer = new FrameRingBuffer({
      maxFrames: 5,
      maxBytes: 10 * 1024,
      maxDurationMs: 10000
    })
    buffer.bindDisplay('1')
  })

  it('initializes empty with zero stats when unbound', () => {
    const fresh = new FrameRingBuffer()
    const stats = fresh.getStats()
    expect(stats.frameCount).toBe(0)
    expect(stats.totalBytes).toBe(0)
    expect(stats.oldestTimestamp).toBeNull()
    expect(stats.newestTimestamp).toBeNull()
    expect(stats.displayId).toBeNull()
    expect(fresh.getLatest()).toBeNull()
  })

  it('rejects invalid constructor options', () => {
    expect(() => new FrameRingBuffer({ maxFrames: 0 })).toThrow(RangeError)
    expect(() => new FrameRingBuffer({ maxFrames: -5 })).toThrow(RangeError)
    expect(() => new FrameRingBuffer({ maxBytes: 0 })).toThrow(RangeError)
    expect(() => new FrameRingBuffer({ maxBytes: -100 })).toThrow(RangeError)
    expect(() => new FrameRingBuffer({ maxDurationMs: 0 })).toThrow(RangeError)
    expect(() => new FrameRingBuffer({ maxDurationMs: -1000 })).toThrow(RangeError)
  })

  it('throws if push is called on an unbound buffer', () => {
    const unbound = new FrameRingBuffer()
    const frame = createValidFrame('1', 1000, 100)
    expect(() => unbound.push(frame)).toThrow(
      /Buffer is not bound to an active display/
    )
  })

  it('stores frames for the bound display and updates stats', () => {
    const frame = createValidFrame('1', 1000, 2048)
    buffer.push(frame)

    expect(buffer.getLatest()).toEqual(frame)
    const stats = buffer.getStats()
    expect(stats.frameCount).toBe(1)
    expect(stats.totalBytes).toBe(2048)
    expect(stats.oldestTimestamp).toBe(1000)
    expect(stats.newestTimestamp).toBe(1000)
    expect(stats.displayId).toBe('1')
  })

  it('rejects frame from a different display and throws isolation error', () => {
    buffer.push(createValidFrame('1', 1000))

    expect(() => buffer.push(createValidFrame('2', 2000))).toThrow(
      /Cross-display isolation violation/
    )
  })

  it('rejects frame payload length mismatch', () => {
    const invalidFrame = createValidFrame('1', 1000, 500)
    invalidFrame.byteLength = 1000 // mismatch!

    expect(() => buffer.push(invalidFrame)).toThrow(
      /Frame payload length mismatch/
    )
  })

  it('rejects an oversized frame exceeding maxBytes before modifying buffer', () => {
    const smallBuffer = new FrameRingBuffer({ maxBytes: 4000, maxFrames: 5 })
    smallBuffer.bindDisplay('1')

    // Frame of 4001 bytes exceeds maxBytes 4000
    const oversizedFrame = createValidFrame('1', 1000, 4001)
    expect(() => smallBuffer.push(oversizedFrame)).toThrow(RangeError)

    // Verify buffer was not modified at all
    expect(smallBuffer.getStats().frameCount).toBe(0)
    expect(smallBuffer.getStats().totalBytes).toBe(0)
  })

  it('evicts oldest frames when maxFrames count limit is exceeded', () => {
    for (let i = 1; i <= 7; i++) {
      buffer.push(createValidFrame('1', 1000 * i, 100))
    }

    const all = buffer.getAll()
    expect(all.length).toBe(5)
    expect(all[0].timestamp).toBe(3000) // 1000 and 2000 evicted
    expect(all[4].timestamp).toBe(7000)
  })

  it('evicts oldest frames when maxBytes memory limit is exceeded and never exceeds maxBytes', () => {
    const smallBuffer = new FrameRingBuffer({ maxBytes: 5000, maxFrames: 10 })
    smallBuffer.bindDisplay('1')

    // Push 3 frames of 2000 bytes each (total attempted 6000 > 5000)
    smallBuffer.push(createValidFrame('1', 1000, 2000))
    smallBuffer.push(createValidFrame('1', 2000, 2000))
    smallBuffer.push(createValidFrame('1', 3000, 2000))

    const stats = smallBuffer.getStats()
    expect(stats.totalBytes).toBeLessThanOrEqual(5000)
    expect(stats.frameCount).toBe(2) // First frame evicted
    expect(stats.totalBytes).toBe(4000)
  })

  it('evicts frames exceeding maxDurationMs TTL', () => {
    buffer.push(createValidFrame('1', 1000))
    buffer.push(createValidFrame('1', 5000))
    // Push frame at 12000 (cutoff is 12000 - 10000 = 2000, so frame at 1000 is evicted)
    buffer.push(createValidFrame('1', 12000))

    const all = buffer.getAll()
    expect(all.length).toBe(2)
    expect(all[0].timestamp).toBe(5000)
    expect(all[1].timestamp).toBe(12000)
  })

  it('clears all frames and memory references on clear() and rejects frames after clear', () => {
    buffer.push(createValidFrame('1', 1000, 4096))
    buffer.clear()

    const stats = buffer.getStats()
    expect(stats.frameCount).toBe(0)
    expect(stats.totalBytes).toBe(0)
    expect(stats.displayId).toBeNull()
    expect(buffer.getLatest()).toBeNull()

    // Cannot push into cleared/unbound buffer without re-binding
    expect(() => buffer.push(createValidFrame('1', 2000, 1000))).toThrow(
      /Buffer is not bound to an active display/
    )
  })

  it('wipes previous frames when setDisplayId changes to another display', () => {
    buffer.push(createValidFrame('1', 1000, 2048))
    expect(buffer.getStats().frameCount).toBe(1)

    // Switch display to '2'
    buffer.setDisplayId('2')

    expect(buffer.getStats().frameCount).toBe(0)
    expect(buffer.getStats().displayId).toBe('2')

    // Now pushing display '2' works without error
    expect(() => buffer.push(createValidFrame('2', 2000, 1024))).not.toThrow()
    expect(buffer.getLatest()?.displayId).toBe('2')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { FrameRingBuffer } from '../../src/main/capture/frame-buffer'
import type { CapturedFrame } from '../../src/shared/contracts/capture'

describe('FrameRingBuffer', () => {
  let buffer: FrameRingBuffer

  const createDummyFrame = (
    displayId: string,
    timestamp: number,
    byteLength = 1024
  ): CapturedFrame => ({
    displayId,
    timestamp,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    data: new Uint8Array(byteLength),
    byteLength,
    format: 'jpeg',
    hash: `hash-${timestamp}`
  })

  beforeEach(() => {
    buffer = new FrameRingBuffer({
      maxFrames: 5,
      maxBytes: 10 * 1024,
      maxDurationMs: 10000
    })
  })

  it('initializes empty with zero stats', () => {
    const stats = buffer.getStats()
    expect(stats.frameCount).toBe(0)
    expect(stats.totalBytes).toBe(0)
    expect(stats.oldestTimestamp).toBeNull()
    expect(stats.newestTimestamp).toBeNull()
    expect(stats.displayId).toBeNull()
    expect(buffer.getLatest()).toBeNull()
  })

  it('stores frames for the bound display and updates stats', () => {
    const frame = createDummyFrame('1', 1000, 2048)
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
    buffer.push(createDummyFrame('1', 1000))

    expect(() => buffer.push(createDummyFrame('2', 2000))).toThrow(
      /Cross-display isolation violation/
    )
  })

  it('evicts oldest frames when maxFrames count limit is exceeded', () => {
    for (let i = 1; i <= 7; i++) {
      buffer.push(createDummyFrame('1', 1000 * i, 100))
    }

    const all = buffer.getAll()
    expect(all.length).toBe(5)
    expect(all[0].timestamp).toBe(3000) // 1000 and 2000 evicted
    expect(all[4].timestamp).toBe(7000)
  })

  it('evicts oldest frames when maxBytes memory limit is exceeded', () => {
    const smallBuffer = new FrameRingBuffer({ maxBytes: 5000, maxFrames: 10 })
    // Push 3 frames of 2000 bytes each (total 6000 > 5000)
    smallBuffer.push(createDummyFrame('1', 1000, 2000))
    smallBuffer.push(createDummyFrame('1', 2000, 2000))
    smallBuffer.push(createDummyFrame('1', 3000, 2000))

    const stats = smallBuffer.getStats()
    expect(stats.totalBytes).toBeLessThanOrEqual(5000)
    expect(stats.frameCount).toBe(2) // First frame evicted
  })

  it('evicts frames exceeding maxDurationMs TTL', () => {
    buffer.push(createDummyFrame('1', 1000))
    buffer.push(createDummyFrame('1', 5000))
    // Push frame at 12000 (cutoff is 12000 - 10000 = 2000, so frame at 1000 is evicted)
    buffer.push(createDummyFrame('1', 12000))

    const all = buffer.getAll()
    expect(all.length).toBe(2)
    expect(all[0].timestamp).toBe(5000)
    expect(all[1].timestamp).toBe(12000)
  })

  it('clears all frames and memory references on clear()', () => {
    buffer.push(createDummyFrame('1', 1000, 4096))
    buffer.clear()

    const stats = buffer.getStats()
    expect(stats.frameCount).toBe(0)
    expect(stats.totalBytes).toBe(0)
    expect(stats.displayId).toBeNull()
    expect(buffer.getLatest()).toBeNull()
  })

  it('wipes previous frames when setDisplayId changes to another display', () => {
    buffer.push(createDummyFrame('1', 1000, 2048))
    expect(buffer.getStats().frameCount).toBe(1)

    // Switch display to '2'
    buffer.setDisplayId('2')

    expect(buffer.getStats().frameCount).toBe(0)
    expect(buffer.getStats().displayId).toBe('2')

    // Now pushing display '2' works without error
    expect(() => buffer.push(createDummyFrame('2', 2000, 1024))).not.toThrow()
    expect(buffer.getLatest()?.displayId).toBe('2')
  })
})

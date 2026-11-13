import { describe, expect, it, vi } from 'vitest'
import { DualDisplayCapturer, type DualDisplayManager } from '../../src/main/capture/dual-display-capturer'
import type { CapturedFrame, FrameBufferStats, ScreenCapturePort } from '../../src/shared/contracts/capture'
import type { DisplayConfiguration, DisplayInfo, SessionStatus } from '../../src/shared/contracts/channels'
import { createValidCapturedFrame } from '../fixtures/image-fixtures'

const makeDisplay = (id: string, isPrimary: boolean, x: number): DisplayInfo => ({
  id, isPrimary, label: id,
  bounds: { x, y: 0, width: 1920, height: 1080 },
  workArea: { x, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1, rotation: 0
})

const config = (count = 2): DisplayConfiguration => {
  const displays = [makeDisplay('laptop', true, 0), makeDisplay('external', false, -1920)]
  if (count === 1) displays.pop()
  if (count === 3) displays.push(makeDisplay('extra', false, 1920))
  return { displays, count, primaryId: 'laptop', isMultiDisplay: count > 1 }
}

class FakeDisplayManager implements DualDisplayManager {
  public current = config()
  public listeners = new Set<(value: DisplayConfiguration) => void>()
  getDisplayConfiguration(): DisplayConfiguration { return this.current }
  addListener(listener: (value: DisplayConfiguration) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(updated: DisplayConfiguration): void {
    this.current = updated
    for (const listener of [...this.listeners]) listener(updated)
  }
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

class FakeCapturePort implements ScreenCapturePort {
  public status: SessionStatus = 'idle'
  public id: string | null = null
  public frame: CapturedFrame | null = null
  public startCalls: string[] = []
  public stopCalls = 0
  public startGate?: Promise<void>
  public stopGate?: Promise<void>
  public startError?: Error
  public stopError?: Error
  private readonly listeners = new Set<(status: SessionStatus, error?: string) => void>()

  async start(id: string): Promise<void> {
    this.startCalls.push(id)
    this.transition('starting')
    if (this.startGate) await this.startGate
    if (this.status !== 'starting') throw new Error('Child start cancelled')
    if (this.startError) throw this.startError
    this.id = id
    this.frame = createValidCapturedFrame({ displayId: id, width: 1920, height: 1080 })
    this.transition('active')
  }

  async stop(): Promise<void> {
    this.stopCalls++
    if (this.stopGate) await this.stopGate
    if (this.stopError) throw this.stopError
    this.id = null
    this.frame = null
    this.transition('idle')
  }

  fail(reason: string): void { this.transition('error', reason) }
  private transition(status: SessionStatus, error?: string): void {
    this.status = status
    for (const listener of [...this.listeners]) listener(status, error)
  }
  getStatus(): SessionStatus { return this.status }
  getLastError(): string | null { return this.status === 'error' ? 'child failure' : null }
  onStatusChange(listener: (status: SessionStatus, error?: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getLatestFrame(): CapturedFrame | null { return this.frame }
  getFrameHistory(): CapturedFrame[] { return this.frame ? [this.frame] : [] }
  getBufferStats(): FrameBufferStats {
    return { frameCount: this.frame ? 1 : 0, totalBytes: this.frame?.byteLength ?? 0,
      oldestTimestamp: this.frame?.timestamp ?? null, newestTimestamp: this.frame?.timestamp ?? null, displayId: this.id }
  }
  isActive(): boolean { return this.status === 'active' }
  getActiveDisplayId(): string | null { return this.id }
}

const setup = () => {
  const displays = new FakeDisplayManager()
  const first = new FakeCapturePort()
  const second = new FakeCapturePort()
  const dual = new DualDisplayCapturer(displays, [first, second])
  return { displays, first, second, dual }
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('DualDisplayCapturer lifecycle', () => {
  it('starts both ports concurrently, labels frames by source and retains their timestamps', async () => {
    const { dual, first, second } = setup()
    const gate = deferred()
    first.startGate = gate.promise
    second.startGate = gate.promise
    const starting = dual.start()

    expect(dual.getStatus()).toBe('starting')
    expect(first.startCalls).toEqual(['laptop'])
    expect(second.startCalls).toEqual(['external'])
    expect(dual.getLatestFrames()).toEqual([null, null])

    gate.release()
    await starting
    expect(dual.getStatus()).toBe('active')
    expect(dual.getActiveDisplayIds()).toEqual(['laptop', 'external'])
    const frames = dual.getLatestFrames()
    expect(frames[0]?.displayId).toBe('laptop')
    expect(frames[1]?.displayId).toBe('external')
    expect(frames[0]?.timestamp).toBeGreaterThan(0)
    expect(frames[1]?.timestamp).toBeGreaterThan(0)
    expect(frames[0]?.data).not.toBe(frames[1]?.data)
    const stats = dual.getBufferStats()
    expect(stats.frameCount).toBe(2)
    expect(stats.totalBytes).toBe((frames[0]?.byteLength ?? 0) + (frames[1]?.byteLength ?? 0))
    await dual.stop()
    expect(dual.getStatus()).toBe('idle')
    expect(dual.getBufferStats().totalBytes).toBe(0)
  })

  it('rejects invalid one/three display topologies before opening either port', async () => {
    const { displays, dual, first, second } = setup()
    displays.current = config(1)
    await expect(dual.start()).rejects.toThrow(/exactly two/)
    displays.current = config(3)
    await expect(dual.start()).rejects.toThrow(/exactly two/)
    expect(dual.getStatus()).toBe('idle')
    expect(first.startCalls).toHaveLength(0)
    expect(second.startCalls).toHaveLength(0)
  })

  it('rolls back BOTH ports when one startup fails; requires explicit Stop for retry', async () => {
    const { dual, first, second } = setup()
    second.startError = new Error('external permission denied')
    await expect(dual.start()).rejects.toThrow(/external permission denied/)
    expect(dual.getStatus()).toBe('error')
    expect(first.stopCalls).toBeGreaterThan(0)
    expect(second.stopCalls).toBeGreaterThan(0)
    expect(dual.getLatestFrames()).toEqual([null, null])
    await expect(dual.start()).rejects.toThrow(/stop first/)
    await dual.stop()
    expect(dual.getStatus()).toBe('idle')
    second.startError = undefined
    await dual.start()
    expect(dual.getStatus()).toBe('active')
    await dual.stop()
  })

  it('waits for both concurrent starts to settle before rolling back a partial failure', async () => {
    const { dual, first, second } = setup()
    const gate = deferred()
    first.startGate = gate.promise
    second.startError = new Error('external permission denied')
    const start = dual.start()
    await flush()
    // The second port has already failed, but the first is still starting.
    // A premature rollback would allow first.start() to reopen after its stop().
    expect(first.stopCalls).toBe(0)
    gate.release()
    await expect(start).rejects.toThrow(/external permission denied/)
    expect(first.stopCalls).toBeGreaterThan(0)
    expect(second.stopCalls).toBeGreaterThan(0)
    expect(dual.getStatus()).toBe('error')
    await dual.stop()
  })

  it('aborts BOTH ports on live display loss and never substitutes laptop', async () => {
    const { displays, dual, first, second } = setup()
    await dual.start()
    const observed = vi.fn()
    dual.onStatusChange(observed)
    displays.emit(config(1))
    expect(dual.getStatus()).toBe('error')
    expect(dual.getLastError()).toMatch(/SELECTED_DISPLAY_LOST/)
    expect(dual.getLatestFrames()).toEqual([null, null])
    await flush()
    expect(first.stopCalls).toBeGreaterThan(0)
    expect(second.stopCalls).toBeGreaterThan(0)
    expect(first.startCalls).toEqual(['laptop'])
    expect(second.startCalls).toEqual(['external'])
    expect(observed).toHaveBeenCalledWith('error', expect.stringMatching(/SELECTED_DISPLAY_LOST/))
    await dual.stop()
    expect(dual.getStatus()).toBe('idle')
  })

  it('aborts sibling when one capture port unexpectedly terminates', async () => {
    const { dual, first, second } = setup()
    await dual.start()
    second.fail('SOURCE_DISAPPEARED')
    expect(dual.getStatus()).toBe('error')
    expect(dual.getLastError()).toMatch(/DISPLAY_2_CAPTURE_TERMINATED/)
    await flush()
    expect(first.stopCalls).toBe(1)
    expect(second.stopCalls).toBe(1)
    await dual.stop()
  })

  it('cancels pending concurrent startup when Stop is requested', async () => {
    const { dual, first, second } = setup()
    const gate = deferred()
    second.startGate = gate.promise
    const starting = dual.start()
    await dual.stop()
    expect(dual.getStatus()).toBe('idle')
    gate.release()
    await expect(starting).rejects.toThrow(/cancelled/)
    expect(dual.getStatus()).toBe('idle')
    expect(dual.getLatestFrames()).toEqual([null, null])
    expect(first.stopCalls).toBeGreaterThan(0)
  })

  it('rejects a frame whose display ID differs from the authorized port', async () => {
    const { dual, second } = setup()
    await dual.start()
    second.frame = createValidCapturedFrame({ displayId: 'laptop' })
    expect(dual.getLatestFrames()).toEqual([null, null])
    expect(dual.getStatus()).toBe('error')
    expect(dual.getLastError()).toMatch(/CROSS_DISPLAY_FRAME_MISMATCH/)
    await dual.stop()
  })

  it('fails closed if monitor geometry changes while streams are active', async () => {
    const { displays, dual, first, second } = setup()
    await dual.start()
    const moved = config()
    moved.displays[1].bounds.x = -1600
    displays.emit(moved)
    expect(dual.getStatus()).toBe('error')
    await flush()
    expect(first.stopCalls).toBeGreaterThan(0)
    expect(second.stopCalls).toBeGreaterThan(0)
    await dual.stop()
  })

  it('keeps error state if a track owner refuses to stop; supports subsequent cleanup retry', async () => {
    const { dual, second } = setup()
    await dual.start()
    second.stopError = new Error('teardown failed')
    await expect(dual.stop()).rejects.toThrow(/teardown failed/)
    expect(dual.getStatus()).toBe('error')
    second.stopError = undefined
    await dual.stop()
    expect(dual.getStatus()).toBe('idle')
  })

  it('rejects a duplicated capture port to prevent double ownership', () => {
    const displays = new FakeDisplayManager()
    const duplicate = new FakeCapturePort()
    expect(() => new DualDisplayCapturer(displays, [duplicate, duplicate])).toThrow(/two distinct/)
  })
})

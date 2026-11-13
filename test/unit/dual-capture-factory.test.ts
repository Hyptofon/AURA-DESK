import { describe, expect, it, vi } from 'vitest'
import { createDualDisplayCapturer, DUAL_CAPTURE_BUFFER_BUDGET_BYTES, PER_DISPLAY_BUFFER_BYTES } from '../../src/main/capture/dual-capture-factory'
import type { DisplayManager } from '../../src/main/displays/display-manager'
import type { FrameCaptureBackend, CaptureTarget } from '../../src/shared/contracts/capture'
import type { DisplayConfiguration } from '../../src/shared/contracts/channels'
import { createValidCapturedFrame } from '../fixtures/image-fixtures'

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() }, session: {} }))

const config: DisplayConfiguration = {
  primaryId: '101', count: 2, isMultiDisplay: true,
  displays: [
    { id: '101', label: 'Laptop', isPrimary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, rotation: 0 },
    { id: '202', label: 'External', isPrimary: false, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, rotation: 0 }
  ]
}

const makeBackend = () => {
  const targets: CaptureTarget[] = []
  let stops = 0
  const backend: FrameCaptureBackend = {
    start: async (target) => { targets.push(target) },
    captureFrame: async (target) => createValidCapturedFrame({ displayId: target.displayId, timestamp: Date.now(), bounds: target.bounds }),
    stop: async () => { stops++ }
  }
  return { backend, targets, getStops: () => stops }
}

describe('createDualDisplayCapturer production composition', () => {
  it('runs independent real single-display loops with separate targets and bounded ring buffers', async () => {
    const left = makeBackend()
    const right = makeBackend()
    const displayManager = {
      getDisplayConfiguration: () => config,
      addListener: () => () => {}
    } as unknown as DisplayManager
    const capturerApi = {
      getSources: vi.fn().mockResolvedValue([
        { id: 'screen:0:0', name: 'Laptop', display_id: '101' },
        { id: 'screen:1:0', name: 'External', display_id: '202' }
      ])
    }
    const dual = createDualDisplayCapturer(displayManager, {
      backends: [left.backend, right.backend], capturerApi
    })
    await dual.start()
    expect(dual.getStatus()).toBe('active')
    expect(left.targets[0].displayId).toBe('101')
    expect(right.targets[0].displayId).toBe('202')
    expect(left.targets[0].sourceId).not.toBe(right.targets[0].sourceId)
    expect(dual.getLatestFrames().map((frame) => frame?.displayId)).toEqual(['101', '202'])
    expect(dual.getBufferStats().totalBytes).toBeLessThanOrEqual(DUAL_CAPTURE_BUFFER_BUDGET_BYTES)
    expect(PER_DISPLAY_BUFFER_BYTES * 2).toBe(DUAL_CAPTURE_BUFFER_BUDGET_BYTES)
    expect(capturerApi.getSources).toHaveBeenCalledTimes(2)
    for (const [args] of capturerApi.getSources.mock.calls) {
      expect(args.thumbnailSize).toEqual({ width: 0, height: 0 })
    }
    await dual.stop()
    expect(left.getStops()).toBeGreaterThan(0)
    expect(right.getStops()).toBeGreaterThan(0)
    expect(dual.getBufferStats().totalBytes).toBe(0)
  })

  it('rejects aliasing of capture backends before starting any stream', () => {
    const shared = makeBackend()
    const manager = { getDisplayConfiguration: () => config, addListener: () => () => {} } as unknown as DisplayManager
    expect(() => createDualDisplayCapturer(manager, { backends: [shared.backend, shared.backend] })).toThrow(/independently owned/)
    expect(shared.targets).toHaveLength(0)
  })
})

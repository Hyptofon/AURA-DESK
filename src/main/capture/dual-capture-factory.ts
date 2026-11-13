import { SingleDisplayCapturer, type DesktopCapturerLike } from './single-display-capturer'
import type { DisplayManager } from '../displays/display-manager'
import type { FrameCaptureBackend } from '@/shared/contracts/capture'
import { createDualCaptureBackends } from './dual-capture-backends'
import { DualDisplayCapturer } from './dual-display-capturer'

/** Hard cap on retained PNG bytes across BOTH physical displays (not process RSS). */
export const DUAL_CAPTURE_BUFFER_BUDGET_BYTES = 50 * 1024 * 1024
export const PER_DISPLAY_BUFFER_BYTES = DUAL_CAPTURE_BUFFER_BUDGET_BYTES / 2
export const DUAL_CAPTURE_MAX_FRAMES_PER_DISPLAY = 60
export const DUAL_CAPTURE_RETENTION_MS = 120_000
export const DUAL_CAPTURE_SAMPLE_INTERVAL_MS = 2000

export interface DualCaptureFactoryOptions {
  /** Only inject actual production backends from createDualCaptureBackends in the application. */
  backends?: readonly [FrameCaptureBackend, FrameCaptureBackend]
  /** Test-only metadata seam. Production uses desktopCapturer 0x0 enumeration. */
  capturerApi?: DesktopCapturerLike
  sampleIntervalMs?: number
}

/** Construct once when the Electron app is ready, reuse until window shutdown. */
export function createDualDisplayCapturer(
  displays: DisplayManager,
  options: DualCaptureFactoryOptions = {}
): DualDisplayCapturer {
  const [primaryBackend, secondaryBackend] = options.backends ?? createDualCaptureBackends()
  if (primaryBackend === secondaryBackend) {
    throw new Error('Dual display capture requires two independently owned backends')
  }
  const settings = {
    maxBytes: PER_DISPLAY_BUFFER_BYTES,
    maxFrames: DUAL_CAPTURE_MAX_FRAMES_PER_DISPLAY,
    maxDurationMs: DUAL_CAPTURE_RETENTION_MS,
    sampleIntervalMs: options.sampleIntervalMs ?? DUAL_CAPTURE_SAMPLE_INTERVAL_MS,
    ...(options.capturerApi ? { capturerApi: options.capturerApi } : {})
  }
  return new DualDisplayCapturer(displays, [
    new SingleDisplayCapturer(displays, { ...settings, backend: primaryBackend }),
    new SingleDisplayCapturer(displays, { ...settings, backend: secondaryBackend })
  ])
}

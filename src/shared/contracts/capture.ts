/**
 * Pure TypeScript contracts for Screen Capture.
 * Free of external npm dependencies to allow safe import in sandboxed preload or core modules.
 */

import type { DisplayBounds } from './channels'

/**
 * Metadata and payload of a captured screen frame.
 * Raw pixel data is stored in memory as Uint8Array (JPEG or PNG format).
 */
export interface CapturedFrame {
  displayId: string
  timestamp: number
  bounds: DisplayBounds
  data: Uint8Array
  byteLength: number
  format: 'jpeg' | 'png'
  hash?: string
}

/**
 * Ring buffer configuration options.
 */
export interface FrameBufferOptions {
  maxFrames?: number
  maxBytes?: number
  maxDurationMs?: number
}

/**
 * Ring buffer status statistics.
 */
export interface FrameBufferStats {
  frameCount: number
  totalBytes: number
  oldestTimestamp: number | null
  newestTimestamp: number | null
  displayId: string | null
}

/**
 * Screen capture service port interface.
 */
export interface ScreenCapturePort {
  start(displayId: string): Promise<void>
  stop(): Promise<void>
  getLatestFrame(): CapturedFrame | null
  getFrameHistory(): CapturedFrame[]
  getBufferStats(): FrameBufferStats
  isActive(): boolean
  getActiveDisplayId(): string | null
}

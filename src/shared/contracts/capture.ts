/**
 * Pure TypeScript contracts for Screen Capture.
 * Free of external npm dependencies to allow safe import in sandboxed preload or core modules.
 */

import type { DisplayBounds, SessionStatus } from './channels'

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
 * Target descriptor for a single frame capture request.
 */
export interface CaptureTarget {
  sourceId: string
  displayId: string
  bounds?: DisplayBounds
}

/**
 * Pluggable frame capture backend port.
 * Allows decoupling source resolution from the underlying capture mechanism
 * (e.g. MediaStream, Windows native helper, or test adapter).
 */
export interface FrameCaptureBackend {
  captureFrame(target: CaptureTarget): Promise<CapturedFrame>
  stop?(): Promise<void> | void
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
  getStatus(): SessionStatus
  getLastError(): string | null
  onStatusChange(listener: (status: SessionStatus, error?: string) => void): () => void
  getLatestFrame(): CapturedFrame | null
  getFrameHistory(): CapturedFrame[]
  getBufferStats(): FrameBufferStats
  isActive(): boolean
  getActiveDisplayId(): string | null
}

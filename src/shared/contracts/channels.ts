/**
 * Zero-dependency IPC channel constants and pure TypeScript contracts.
 * Safe to import in sandboxed preload scripts without pulling in external npm modules (e.g. Zod).
 */

export const IPC_CHANNELS = {
  APP_GET_INFO: 'aura:app-get-info',
  SESSION_GET_STATE: 'aura:session-get-state',
  SESSION_SET_SELECTION: 'aura:session-set-selection',
  SESSION_START: 'aura:session-start',
  SESSION_STOP: 'aura:session-stop',
  SESSION_STATUS_CHANGED: 'aura:session-status-changed',
  DISPLAYS_GET_ALL: 'aura:displays-get-all',
  DISPLAYS_CHANGED: 'aura:displays-changed',
  AUDIO_GET_STATE: 'aura:audio-get-state',
  AUDIO_SET_CONFIG: 'aura:audio-set-config',
  AUDIO_STATE_CHANGED: 'aura:audio-state-changed',
  AUDIO_GET_DEVICES: 'aura:audio-get-devices',
  AUDIO_SUBMIT_CHUNK: 'aura:audio-submit-chunk'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export const ALLOWED_IPC_CHANNELS: readonly string[] = Object.values(IPC_CHANNELS)

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return ALLOWED_IPC_CHANNELS.includes(channel)
}

/**
 * Capture Selection contract: EXACTLY two modes per product specification.
 */
export type CaptureSelection =
  | { mode: 'both' }
  | { mode: 'single'; displayId: string }

/**
 * Session status state machine values.
 */
export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'error'

/** Metadata-only capture diagnostics: never expose pixel bytes over IPC. */
export interface SessionCaptureSource {
  displayId: string
  status: SessionStatus
  frameCount: number
  totalBytes: number
  newestTimestamp: number | null
}

export interface SessionState {
  status: SessionStatus
  capture?: {
    mode: 'single' | 'both'
    totalBytes: number
    sources: SessionCaptureSource[]
  }
}

/**
 * Application metadata contract.
 */
export interface AppInfo {
  name: string
  version: string
  platform: string
  isPackaged: boolean
}

/**
 * Display coordinates and dimensions contract.
 */
export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Normalized display metadata.
 * Note: Electron display IDs are normalized to strings; they may change on system reconfiguration.
 */
export interface DisplayInfo {
  id: string
  label: string
  isPrimary: boolean
  bounds: DisplayBounds
  workArea: DisplayBounds
  scaleFactor: number
  rotation: number
}

/**
 * Overall display configuration contract.
 */
export interface DisplayConfiguration {
  displays: DisplayInfo[]
  primaryId: string
  count: number
  isMultiDisplay: boolean
  selectedDisplayLost?: boolean
}

/**
 * Structured IPC response pattern.
 */
export interface IpcSuccess<T> {
  ok: true
  data: T
}

export interface IpcError {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type IpcResponse<T> = IpcSuccess<T> | IpcError

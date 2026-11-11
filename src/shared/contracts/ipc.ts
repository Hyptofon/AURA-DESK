import { z } from 'zod'

/**
 * Strict allowlist of IPC channel identifiers for AURA DESK.
 * Renderer and Main communicate solely through these typed channels.
 */
export const IPC_CHANNELS = {
  APP_GET_INFO: 'aura:app-get-info',
  SESSION_GET_STATE: 'aura:session-get-state',
  SESSION_SET_SELECTION: 'aura:session-set-selection'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export const ALLOWED_IPC_CHANNELS: readonly string[] = Object.values(IPC_CHANNELS)

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return ALLOWED_IPC_CHANNELS.includes(channel)
}

/**
 * Capture Selection Schema: EXACTLY two modes per product specification:
 * - 'both': captures both permitted displays
 * - 'single': captures explicitly chosen displayId
 */
export const CaptureSelectionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('both')
  }),
  z.object({
    mode: z.literal('single'),
    displayId: z.string().min(1, 'displayId must not be empty')
  })
])

export type CaptureSelection = z.infer<typeof CaptureSelectionSchema>

/**
 * Pure session lifecycle state per ARCHITECTURE.md:
 * idle -> starting -> active <-> paused -> stopping -> idle
 */
export const SessionStatusSchema = z.enum([
  'idle',
  'starting',
  'active',
  'paused',
  'stopping',
  'error'
])

export type SessionStatus = z.infer<typeof SessionStatusSchema>

/**
 * Application information payload schema.
 */
export const AppInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.string().min(1),
  isPackaged: z.boolean()
})

export type AppInfo = z.infer<typeof AppInfoSchema>

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

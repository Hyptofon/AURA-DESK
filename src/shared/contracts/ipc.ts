import { z } from 'zod'

export {
  IPC_CHANNELS,
  type IpcChannel,
  ALLOWED_IPC_CHANNELS,
  isAllowedIpcChannel,
  type CaptureSelection,
  type SessionStatus,
  type AppInfo,
  type DisplayBounds,
  type DisplayInfo,
  type DisplayConfiguration,
  type IpcSuccess,
  type IpcError,
  type IpcResponse
} from './channels'

/**
 * Capture Selection Schema: EXACTLY two modes per product specification.
 * - 'both': captures both permitted displays
 * - 'single': captures explicitly chosen displayId (non-empty, non-whitespace-only)
 * Strict evaluation ensures no arbitrary or unknown extra properties are accepted.
 */
export const CaptureSelectionSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('both')
    })
    .strict(),
  z
    .object({
      mode: z.literal('single'),
      displayId: z.string().trim().min(1, 'displayId must not be empty or whitespace only')
    })
    .strict()
])

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

/**
 * Application information payload schema.
 */
export const AppInfoSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    platform: z.string().min(1),
    isPackaged: z.boolean()
  })
  .strict()

/**
 * Display bounds schema.
 */
export const DisplayBoundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative()
  })
  .strict()

/**
 * Normalized display information schema.
 */
export const DisplayInfoSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    isPrimary: z.boolean(),
    bounds: DisplayBoundsSchema,
    workArea: DisplayBoundsSchema,
    scaleFactor: z.number().positive(),
    rotation: z.number()
  })
  .strict()

/**
 * Display configuration schema.
 */
export const DisplayConfigurationSchema = z
  .object({
    displays: z.array(DisplayInfoSchema),
    primaryId: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
    isMultiDisplay: z.boolean(),
    selectedDisplayLost: z.boolean().optional()
  })
  .strict()

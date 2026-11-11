import { app, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  isAllowedIpcChannel,
  CaptureSelectionSchema,
  AppInfoSchema,
  DisplayConfigurationSchema,
  SessionStartRequestSchema,
  SessionStartResponseSchema,
  SessionStopResponseSchema,
  type CaptureSelection,
  type SessionStatus,
  type DisplayConfiguration,
  type IpcResponse
} from '../../shared/contracts/ipc'
import { DisplayManager } from '../displays/display-manager'
import { SingleDisplayCapturer } from '../capture/single-display-capturer'

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
  ): void
  removeHandler(channel: string): void
}

export interface FrameLike {
  url?: string
  parent?: unknown | null
  top?: unknown
}

export interface WebContentsLike {
  id?: number
  mainFrame?: FrameLike | null
}

export interface IpcInvokeEventLike {
  sender?: unknown
  senderFrame?: FrameLike | null
}

export interface IpcSenderValidationContext {
  trustedWebContents: unknown
  trustedOrigin?: string
  isAllowedOrigin?: (url: string) => boolean
}

export interface IpcSenderValidator {
  validate(event: unknown): {
    valid: boolean
    errorCode?: 'UNAUTHORIZED_SENDER' | 'UNAUTHORIZED_FRAME'
    message?: string
  }
}

/**
 * Creates a strict fail-closed sender validator.
 * Rejects missing events, untrusted senders, missing or destroyed frames, empty URLs,
 * mismatched mainFrames, and untrusted origins.
 */
export function createSenderValidator(
  context: IpcSenderValidationContext
): IpcSenderValidator {
  if (!context || !context.trustedWebContents) {
    throw new Error('Security violation: IpcSenderValidationContext requires trustedWebContents')
  }

  return {
    validate(event: unknown) {
      if (!event || typeof event !== 'object') {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_SENDER',
          message: 'IPC invocation requires a valid event with authorized sender'
        }
      }

      const invokeEvent = event as IpcInvokeEventLike

      // 1. Verify sender webContents exists and matches trustedWebContents
      if (!invokeEvent.sender || invokeEvent.sender !== context.trustedWebContents) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_SENDER',
          message: 'IPC request originates from an untrusted or missing WebContents sender'
        }
      }

      // 2. Reject missing, null, or destroyed senderFrame (fail-closed)
      if (!invokeEvent.senderFrame) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: 'IPC invocation rejected: senderFrame is missing, null, or destroyed'
        }
      }

      const frame = invokeEvent.senderFrame

      // 3. Reject missing or empty frame URL
      if (!frame.url || typeof frame.url !== 'string' || frame.url.trim() === '') {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: 'IPC invocation rejected: senderFrame URL is missing or empty'
        }
      }

      // 4. Verify senderFrame matches trustedWebContents.mainFrame when available
      const trustedWebContents = context.trustedWebContents as WebContentsLike
      if (trustedWebContents.mainFrame !== undefined && trustedWebContents.mainFrame !== null) {
        if (frame !== trustedWebContents.mainFrame) {
          return {
            valid: false,
            errorCode: 'UNAUTHORIZED_FRAME',
            message: 'IPC invocation rejected: senderFrame does not match trustedWebContents.mainFrame'
          }
        }
      }

      // 5. Verify top-level frame hierarchy (reject nested iframes)
      const isChildFrame = frame.parent !== null && frame.parent !== undefined
      const isNotTop = frame.top !== undefined && frame.top !== frame

      if (isChildFrame || isNotTop) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: 'IPC invocation from nested frame or iframe is prohibited'
        }
      }

      // 6. Verify frame origin if trustedOrigin is specified
      if (context.trustedOrigin) {
        try {
          const frameOrigin = new URL(frame.url).origin
          const expectedOrigin = new URL(context.trustedOrigin).origin
          if (frameOrigin !== expectedOrigin) {
            return {
              valid: false,
              errorCode: 'UNAUTHORIZED_FRAME',
              message: `IPC invocation from untrusted frame origin '${frameOrigin}'`
            }
          }
        } catch {
          return {
            valid: false,
            errorCode: 'UNAUTHORIZED_FRAME',
            message: 'Malformed frame URL in IPC event'
          }
        }
      }

      // 7. Verify frame URL against custom origin policy if provided
      if (context.isAllowedOrigin && !context.isAllowedOrigin(frame.url)) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: `Frame URL '${frame.url}' rejected by origin policy`
        }
      }

      return { valid: true }
    }
  }
}

/**
 * Ephemeral session state for M0 scaffold.
 * Full state supervisor will manage this in subsequent milestones.
 */
let currentSessionStatus: SessionStatus = 'idle'
let currentCaptureSelection: CaptureSelection = { mode: 'both' }
let activeDisplayManager: DisplayManager | null = null

export function getCurrentSessionStatus(): SessionStatus {
  return activeCapturer ? activeCapturer.getStatus() : currentSessionStatus
}

export function setSessionStatus(status: SessionStatus): void {
  currentSessionStatus = status
}

export function getCurrentCaptureSelection(): CaptureSelection {
  return currentCaptureSelection
}

export function getDisplayManager(): DisplayManager {
  if (!activeDisplayManager) {
    activeDisplayManager = new DisplayManager()
  }
  return activeDisplayManager
}

export function setDisplayManager(manager: DisplayManager | null): void {
  activeDisplayManager = manager
}

let activeCapturer: SingleDisplayCapturer | null = null
let activeStatusUnsubscribe: (() => void) | null = null

export function getSingleDisplayCapturer(
  manager: DisplayManager = getDisplayManager()
): SingleDisplayCapturer {
  if (!activeCapturer) {
    activeCapturer = new SingleDisplayCapturer(manager)
  }
  return activeCapturer
}

export function setSingleDisplayCapturer(capturer: SingleDisplayCapturer | null): void {
  activeCapturer = capturer
}

/**
 * Safe IPC Handler registration.
 * Fails closed if authorization context is missing.
 * Validates sender authorization, frame hierarchy, channel authorization, and input payloads with Zod schemas.
 */
export function registerIpcHandlers(
  ipc: IpcMainLike = ipcMain,
  validatorOrContext?: IpcSenderValidator | IpcSenderValidationContext,
  displayManager?: DisplayManager,
  singleDisplayCapturer?: SingleDisplayCapturer
): void {
  if (!validatorOrContext) {
    throw new Error(
      'Security violation: registerIpcHandlers requires an explicit authorization validator or context'
    )
  }

  // Unregister first if previously registered
  unregisterIpcHandlers(ipc)

  const validator: IpcSenderValidator =
    'validate' in validatorOrContext
      ? validatorOrContext
      : createSenderValidator(validatorOrContext)

  const manager = displayManager ?? getDisplayManager()
  const capturer = singleDisplayCapturer ?? getSingleDisplayCapturer(manager)

  // Forward validated session status transitions from capturer to trusted window
  const webContents =
    'trustedWebContents' in validatorOrContext
      ? (validatorOrContext.trustedWebContents as {
          isDestroyed?(): boolean
          send?(channel: string, ...args: unknown[]): void
        })
      : null

  if (webContents?.send) {
    activeStatusUnsubscribe = capturer.onStatusChange((status, error) => {
      if (!webContents.isDestroyed || !webContents.isDestroyed()) {
        try {
          webContents.send!(IPC_CHANNELS.SESSION_STATUS_CHANGED, { status, error })
        } catch (err) {
          console.error('Failed to forward session status change event:', err)
        }
      }
    })
  }

  ipc.handle(IPC_CHANNELS.APP_GET_INFO, async (event: unknown): Promise<IpcResponse<unknown>> => {
    const auth = validator.validate(event)
    if (!auth.valid) {
      return {
        ok: false,
        error: {
          code: auth.errorCode ?? 'UNAUTHORIZED_SENDER',
          message: auth.message ?? 'Unauthorized IPC invocation'
        }
      }
    }

    const rawInfo = {
      name: 'aura-desk',
      version: app ? app.getVersion() || '0.1.0' : '0.1.0',
      platform: process.platform,
      isPackaged: app ? app.isPackaged : false
    }

    const parsed = AppInfoSchema.safeParse(rawInfo)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_APP_INFO',
          message: parsed.error.message
        }
      }
    }

    return {
      ok: true,
      data: parsed.data
    }
  })

  ipc.handle(
    IPC_CHANNELS.SESSION_GET_STATE,
    async (event: unknown): Promise<IpcResponse<{ status: SessionStatus }>> => {
      const auth = validator.validate(event)
      if (!auth.valid) {
        return {
          ok: false,
          error: {
            code: auth.errorCode ?? 'UNAUTHORIZED_SENDER',
            message: auth.message ?? 'Unauthorized IPC invocation'
          }
        }
      }

      return {
        ok: true,
        data: {
          status: capturer.getStatus()
        }
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.SESSION_SET_SELECTION,
    async (
      event: unknown,
      payload: unknown
    ): Promise<IpcResponse<{ success: boolean; selection: CaptureSelection }>> => {
      const auth = validator.validate(event)
      if (!auth.valid) {
        return {
          ok: false,
          error: {
            code: auth.errorCode ?? 'UNAUTHORIZED_SENDER',
            message: auth.message ?? 'Unauthorized IPC invocation'
          }
        }
      }

      const parsed = CaptureSelectionSchema.safeParse(payload)
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          }
        }
      }

      currentCaptureSelection = parsed.data
      return {
        ok: true,
        data: {
          success: true,
          selection: currentCaptureSelection
        }
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.SESSION_START,
    async (event: unknown, payload?: unknown): Promise<IpcResponse<unknown>> => {
      const auth = validator.validate(event)
      if (!auth.valid) {
        return {
          ok: false,
          error: {
            code: auth.errorCode ?? 'UNAUTHORIZED_SENDER',
            message: auth.message ?? 'Unauthorized IPC invocation'
          }
        }
      }

      if (payload !== undefined && payload !== null) {
        const parsed = SessionStartRequestSchema.safeParse(payload)
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: 'INVALID_PAYLOAD',
              message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
            }
          }
        }
        if (parsed.data?.selection) {
          currentCaptureSelection = parsed.data.selection
        }
      }

      if (currentCaptureSelection.mode === 'both') {
        return {
          ok: false,
          error: {
            code: 'UNSUPPORTED_MODE',
            message:
              'Simultaneous both-display capture is scheduled for Milestone M1 Task P1.3; please select a single display'
          }
        }
      }

      try {
        await capturer.start(currentCaptureSelection.displayId)

        const responsePayload = {
          success: true,
          status: capturer.getStatus(),
          displayId: currentCaptureSelection.displayId
        }
        return {
          ok: true,
          data: SessionStartResponseSchema.parse(responsePayload)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          error: {
            code: 'CAPTURE_START_FAILED',
            message: msg
          }
        }
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.SESSION_STOP,
    async (event: unknown): Promise<IpcResponse<unknown>> => {
      const auth = validator.validate(event)
      if (!auth.valid) {
        return {
          ok: false,
          error: {
            code: auth.errorCode ?? 'UNAUTHORIZED_SENDER',
            message: auth.message ?? 'Unauthorized IPC invocation'
          }
        }
      }

      await capturer.stop()

      const responsePayload = {
        success: true,
        status: capturer.getStatus()
      }
      }
      return {
        ok: true,
        data: SessionStopResponseSchema.parse(responsePayload)
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.DISPLAYS_GET_ALL,
    async (event: unknown): Promise<IpcResponse<DisplayConfiguration>> => {
      const auth = validator.validate(event)
      if (!auth.valid) {
        return {
          ok: false,
          error: {
            code: auth.errorCode ?? 'UNAUTHORIZED_SENDER',
            message: auth.message ?? 'Unauthorized IPC invocation'
          }
        }
      }

      const config = manager.getDisplayConfiguration()
      const parsed = DisplayConfigurationSchema.safeParse(config)
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'INVALID_DISPLAY_CONFIG',
            message: parsed.error.message
          }
        }
      }

      return {
        ok: true,
        data: parsed.data
      }
    }
  )
}

/**
 * Clean teardown of registered handlers.
 */
export function unregisterIpcHandlers(ipc: IpcMainLike = ipcMain): void {
  if (activeStatusUnsubscribe) {
    activeStatusUnsubscribe()
    activeStatusUnsubscribe = null
  }
  for (const channel of Object.values(IPC_CHANNELS)) {
    try {
      ipc.removeHandler(channel)
    } catch {
      // Ignored if handler was not registered
    }
  }
}

/**
 * Direct channel dispatcher helper for testing authorization gates.
 */
export async function dispatchIpcCall(
  channel: string,
  payload: unknown,
  handlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>,
  event: unknown = null
): Promise<IpcResponse<unknown>> {
  if (!isAllowedIpcChannel(channel)) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_CHANNEL',
        message: `IPC channel '${channel}' is not registered or unauthorized`
      }
    }
  }

  const handler = handlers.get(channel)
  if (!handler) {
    return {
      ok: false,
      error: {
        code: 'HANDLER_NOT_FOUND',
        message: `No handler registered for channel ${channel}`
      }
    }
  }

  const result = await handler(event, payload)
  return result as IpcResponse<unknown>
}

import { app, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  isAllowedIpcChannel,
  CaptureSelectionSchema,
  AppInfoSchema,
  type CaptureSelection,
  type SessionStatus,
  type IpcResponse
} from '../../shared/contracts/ipc'

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

export interface IpcInvokeEventLike {
  sender?: unknown
  senderFrame?: FrameLike | null
}

export interface IpcSenderValidationContext {
  trustedWebContents?: unknown
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

export function createSenderValidator(
  context?: IpcSenderValidationContext
): IpcSenderValidator {
  return {
    validate(event: unknown) {
      // If a context was provided with a required sender, event must be present
      if (context?.trustedWebContents !== undefined) {
        if (!event || typeof event !== 'object') {
          return {
            valid: false,
            errorCode: 'UNAUTHORIZED_SENDER',
            message: 'IPC invocation requires a valid event with authorized sender'
          }
        }
        const invokeEvent = event as IpcInvokeEventLike
        if (invokeEvent.sender !== context.trustedWebContents) {
          return {
            valid: false,
            errorCode: 'UNAUTHORIZED_SENDER',
            message: 'IPC request originates from an untrusted WebContents sender'
          }
        }
      }

      if (event && typeof event === 'object') {
        const invokeEvent = event as IpcInvokeEventLike

        // Validate senderFrame if present
        if (invokeEvent.senderFrame) {
          const frame = invokeEvent.senderFrame
          const isChildFrame = frame.parent !== null && frame.parent !== undefined
          const isNotTop = frame.top !== undefined && frame.top !== frame

          if (isChildFrame || isNotTop) {
            return {
              valid: false,
              errorCode: 'UNAUTHORIZED_FRAME',
              message: 'IPC invocation from nested frame or iframe is prohibited'
            }
          }

          if (frame.url) {
            if (context?.trustedOrigin) {
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

            if (context?.isAllowedOrigin && !context.isAllowedOrigin(frame.url)) {
              return {
                valid: false,
                errorCode: 'UNAUTHORIZED_FRAME',
                message: `Frame URL '${frame.url}' rejected by origin policy`
              }
            }
          }
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

export function getCurrentSessionStatus(): SessionStatus {
  return currentSessionStatus
}

export function setSessionStatus(status: SessionStatus): void {
  currentSessionStatus = status
}

export function getCurrentCaptureSelection(): CaptureSelection {
  return currentCaptureSelection
}

/**
 * Safe IPC Handler registration.
 * Validates sender authorization, frame hierarchy, channel authorization, and input payloads with Zod schemas.
 */
export function registerIpcHandlers(
  ipc: IpcMainLike = ipcMain,
  validatorOrContext?: IpcSenderValidator | IpcSenderValidationContext
): void {
  // Unregister first if previously registered
  unregisterIpcHandlers(ipc)

  const validator: IpcSenderValidator =
    validatorOrContext && 'validate' in validatorOrContext
      ? validatorOrContext
      : createSenderValidator(validatorOrContext)

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
          status: currentSessionStatus
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
}

/**
 * Clean teardown of registered handlers.
 */
export function unregisterIpcHandlers(ipc: IpcMainLike = ipcMain): void {
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

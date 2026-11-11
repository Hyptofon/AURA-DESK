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
 * Validates channel authorization and input payloads with Zod schemas.
 */
export function registerIpcHandlers(ipc: IpcMainLike = ipcMain): void {
  // Unregister first if previously registered
  unregisterIpcHandlers(ipc)

  ipc.handle(IPC_CHANNELS.APP_GET_INFO, async (): Promise<IpcResponse<unknown>> => {
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

  ipc.handle(IPC_CHANNELS.SESSION_GET_STATE, async (): Promise<IpcResponse<{ status: SessionStatus }>> => {
    return {
      ok: true,
      data: {
        status: currentSessionStatus
      }
    }
  })

  ipc.handle(
    IPC_CHANNELS.SESSION_SET_SELECTION,
    async (_event: unknown, payload: unknown): Promise<IpcResponse<{ success: boolean; selection: CaptureSelection }>> => {
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
  handlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>
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

  const result = await handler(null, payload)
  return result as IpcResponse<unknown>
}

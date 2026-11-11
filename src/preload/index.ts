import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppInfo,
  type CaptureSelection,
  type SessionStatus,
  type IpcResponse
} from '../shared/contracts/ipc'

export interface AuraApi {
  platform: string
  version: string
  getAppInfo(): Promise<AppInfo>
  getSessionState(): Promise<{ status: SessionStatus }>
  setCaptureSelection(
    selection: CaptureSelection
  ): Promise<{ success: boolean; selection: CaptureSelection }>
}

/**
 * Safely invoke allowlisted IPC channel and unwrap typed response.
 */
async function invokeChannel<T>(channel: string, payload?: unknown): Promise<T> {
  const response = (await ipcRenderer.invoke(channel, payload)) as IpcResponse<T>
  if (!response || !response.ok) {
    const errorMsg = response?.error?.message || 'IPC request failed'
    const errorCode = response?.error?.code || 'IPC_ERROR'
    const error = new Error(`[${errorCode}] ${errorMsg}`)
    ;(error as { code?: string }).code = errorCode
    throw error
  }
  return response.data
}

export const auraApi: AuraApi = {
  platform: process.platform,
  version: '0.1.0',
  getAppInfo: () => invokeChannel<AppInfo>(IPC_CHANNELS.APP_GET_INFO),
  getSessionState: () => invokeChannel<{ status: SessionStatus }>(IPC_CHANNELS.SESSION_GET_STATE),
  setCaptureSelection: (selection: CaptureSelection) =>
    invokeChannel<{ success: boolean; selection: CaptureSelection }>(
      IPC_CHANNELS.SESSION_SET_SELECTION,
      selection
    )
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', auraApi)
  } catch (error) {
    console.error('Failed to expose api to main world', error)
  }
} else {
  ;(globalThis as { api?: AuraApi }).api = auraApi
}

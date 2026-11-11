import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppInfo,
  type CaptureSelection,
  type SessionStatus,
  type DisplayConfiguration,
  type IpcResponse
} from '../shared/contracts/channels'

export interface AuraApi {
  platform: string
  version: string
  getAppInfo(): Promise<AppInfo>
  getSessionState(): Promise<{ status: SessionStatus }>
  setCaptureSelection(
    selection: CaptureSelection
  ): Promise<{ success: boolean; selection: CaptureSelection }>
  getDisplays?(): Promise<DisplayConfiguration>
}

/**
 * Safely invoke allowlisted IPC channel and unwrap typed response.
 */
export async function invokeChannel<T>(channel: string, payload?: unknown): Promise<T> {
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
    ),
  getDisplays: () => invokeChannel<DisplayConfiguration>(IPC_CHANNELS.DISPLAYS_GET_ALL)
}

/**
 * Exposes the Aura API bridge in main world with strict fail-closed context isolation.
 */
export function exposeAuraApi(
  bridge = contextBridge,
  isContextIsolated = process.contextIsolated
): void {
  if (!isContextIsolated) {
    throw new Error('Security violation: contextIsolation must be enabled to expose Aura API')
  }
  bridge.exposeInMainWorld('api', auraApi)
}

try {
  exposeAuraApi()
} catch (error) {
  console.error('Failed to initialize preload API:', error)
}

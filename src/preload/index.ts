import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppInfo,
  type CaptureSelection,
  type SessionStatus,
  type SessionState,
  type DisplayConfiguration,
  type IpcResponse
} from '@/shared/contracts/channels'
import type { AudioConfig, AudioSessionState, AudioDevice } from '@/shared/contracts/audio'
import type { TranscriptionSessionState } from '@/shared/contracts/questions'

export interface AuraApi {
  platform: string
  version: string
  getAppInfo(): Promise<AppInfo>
  getSessionState(): Promise<SessionState>
  setCaptureSelection(
    selection: CaptureSelection
  ): Promise<{ success: boolean; selection: CaptureSelection }>
  startSession?(
    selection?: CaptureSelection
  ): Promise<{ success: boolean; status: SessionStatus; displayId?: string }>
  stopSession?(): Promise<{ success: boolean; status: SessionStatus }>
  onSessionStatusChanged?(
    callback: (event: { status: SessionStatus; error?: string }) => void
  ): () => void
  getDisplays?(): Promise<DisplayConfiguration>
  onDisplaysChanged?(callback: (config: DisplayConfiguration) => void): () => void
  getAudioState?(): Promise<AudioSessionState>
  setAudioConfig?(config: AudioConfig): Promise<AudioSessionState>
  getAudioDevices?(): Promise<AudioDevice[]>
  onAudioStateChanged?(callback: (state: AudioSessionState) => void): () => void
  submitAudioChunk?(chunk: {
    source: 'mic' | 'system'
    data: Uint8Array
    timestamp: number
    durationMs: number
    sampleRate?: number
    channels?: number
  }): Promise<{ accepted: boolean }>
  getTranscriptionState?(): Promise<TranscriptionSessionState>
  onTranscriptionStateChanged?(
    callback: (state: TranscriptionSessionState) => void
  ): () => void
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
  getSessionState: () => invokeChannel<SessionState>(IPC_CHANNELS.SESSION_GET_STATE),
  setCaptureSelection: (selection: CaptureSelection) =>
    invokeChannel<{ success: boolean; selection: CaptureSelection }>(
      IPC_CHANNELS.SESSION_SET_SELECTION,
      selection
    ),
  startSession: (selection?: CaptureSelection) =>
    invokeChannel<{ success: boolean; status: SessionStatus; displayId?: string }>(
      IPC_CHANNELS.SESSION_START,
      selection ? { selection } : undefined
    ),
  stopSession: () =>
    invokeChannel<{ success: boolean; status: SessionStatus }>(IPC_CHANNELS.SESSION_STOP),
  onSessionStatusChanged: (
    callback: (event: { status: SessionStatus; error?: string }) => void
  ): (() => void) => {
    const listener = (_event: unknown, data: unknown) => {
      try {
        callback(data as { status: SessionStatus; error?: string })
      } catch (err) {
        console.error('Error in onSessionStatusChanged callback:', err)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.SESSION_STATUS_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SESSION_STATUS_CHANGED, listener)
    }
  },
  getDisplays: () => invokeChannel<DisplayConfiguration>(IPC_CHANNELS.DISPLAYS_GET_ALL),
  onDisplaysChanged: (callback: (config: DisplayConfiguration) => void): (() => void) => {
    const listener = (_event: unknown, data: unknown) => {
      try {
        callback(data as DisplayConfiguration)
      } catch (err) {
        console.error('Error in onDisplaysChanged callback:', err)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.DISPLAYS_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DISPLAYS_CHANGED, listener)
    }
  },
  getAudioState: () => invokeChannel<AudioSessionState>(IPC_CHANNELS.AUDIO_GET_STATE),
  setAudioConfig: (config: AudioConfig) =>
    invokeChannel<AudioSessionState>(IPC_CHANNELS.AUDIO_SET_CONFIG, config),
  getAudioDevices: () => invokeChannel<AudioDevice[]>(IPC_CHANNELS.AUDIO_GET_DEVICES),
  onAudioStateChanged: (callback: (state: AudioSessionState) => void): (() => void) => {
    const listener = (_event: unknown, data: unknown) => {
      try {
        callback(data as AudioSessionState)
      } catch (err) {
        console.error('Error in onAudioStateChanged callback:', err)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.AUDIO_STATE_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_STATE_CHANGED, listener)
    }
  },
  submitAudioChunk: (chunk: {
    source: 'mic' | 'system'
    data: Uint8Array
    timestamp: number
    durationMs: number
    sampleRate?: number
    channels?: number
  }) =>
    invokeChannel<{ accepted: boolean }>(IPC_CHANNELS.AUDIO_SUBMIT_CHUNK, chunk),
  getTranscriptionState: () =>
    invokeChannel<TranscriptionSessionState>(IPC_CHANNELS.TRANSCRIPTION_GET_STATE),
  onTranscriptionStateChanged: (
    callback: (state: TranscriptionSessionState) => void
  ): (() => void) => {
    const listener = (_event: unknown, data: unknown) => {
      try {
        callback(data as TranscriptionSessionState)
      } catch (err) {
        console.error('Error in onTranscriptionStateChanged callback:', err)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.TRANSCRIPTION_STATE_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TRANSCRIPTION_STATE_CHANGED, listener)
    }
  }
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

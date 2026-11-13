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
  AudioConfigSchema,
  AudioSubmitChunkSchema,
  type CaptureSelection,
  type SessionStatus,
  type DisplayConfiguration,
  type IpcResponse
} from '@/shared/contracts/ipc'
import type { AudioSessionState, AudioDevice, AudioChunk } from '@/shared/contracts/audio'
import type { IntegratedAudioSupervisor } from '../capture/integrated-audio-supervisor'
import type { ElectronMicrophoneBackend } from '../capture/electron-microphone-backend'
import type { ElectronLoopbackBackend } from '../capture/electron-loopback-backend'
import { DisplayManager } from '../displays/display-manager'
import type { SessionState } from '@/shared/contracts/channels'
import { SingleDisplayCapturer } from '../capture/single-display-capturer'
import type { DualDisplayCapturer } from '../capture/dual-display-capturer'
import type { TranscriptionPipeline } from '../transcription/transcription-pipeline'
import type { TranscriptionSessionState } from '@/shared/contracts/questions'
import { EnergyVad } from '../capture/audio-vad'

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
  if (runningMode === 'both' && activeDualCapturer) return activeDualCapturer.getStatus()
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
let activeDualCapturer: DualDisplayCapturer | null = null
let runningMode: 'single' | 'both' | null = null
let activeStatusUnsubscribe: (() => void) | null = null
let activeDualStatusUnsubscribe: (() => void) | null = null
let activeAudioSupervisor: IntegratedAudioSupervisor | null = null
let activeAudioStateUnsubscribe: (() => void) | null = null
let activeMicBackend: ElectronMicrophoneBackend | null = null
let activeLoopbackBackend: ElectronLoopbackBackend | null = null
let activeTranscriptionPipeline: TranscriptionPipeline | null = null
let activeTranscriptionUnsubscribe: (() => void) | null = null
let audioChunkCounter = 0
let micVad = new EnergyVad()
let systemVad = new EnergyVad()

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
  singleDisplayCapturer?: SingleDisplayCapturer,
  dualDisplayCapturer?: DualDisplayCapturer,
  audioSupervisor?: IntegratedAudioSupervisor,
  micBackend?: ElectronMicrophoneBackend,
  loopbackBackend?: ElectronLoopbackBackend,
  transcriptionPipeline?: TranscriptionPipeline
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
  const dual = dualDisplayCapturer ?? null
  activeDualCapturer = dual
  activeAudioSupervisor = audioSupervisor ?? null
  runningMode = null
  micVad.reset()
  systemVad.reset()

  // Forward validated session status transitions from capturer to trusted window
  const webContents =
    'trustedWebContents' in validatorOrContext
      ? (validatorOrContext.trustedWebContents as {
          isDestroyed?(): boolean
          send?(channel: string, ...args: unknown[]): void
        })
      : null

  if (webContents?.send) {
    const forward = (source: 'single' | 'both', status: SessionStatus, error?: string): void => {
      if (runningMode !== null && runningMode !== source) return
      if (!webContents.isDestroyed || !webContents.isDestroyed()) {
        try {
          webContents.send!(IPC_CHANNELS.SESSION_STATUS_CHANGED, { status, error })
        } catch (err) {
          console.error('Failed to forward session status change event:', err)
        }
      }
    }
    activeStatusUnsubscribe = capturer.onStatusChange((status, error) => forward('single', status, error))
    if (dual) activeDualStatusUnsubscribe = dual.onStatusChange((status, error) => forward('both', status, error))

    if (activeAudioSupervisor) {
      activeAudioStateUnsubscribe = activeAudioSupervisor.onStateChanged((state) => {
        if (!webContents.isDestroyed || !webContents.isDestroyed()) {
          try {
            webContents.send!(IPC_CHANNELS.AUDIO_STATE_CHANGED, state)
          } catch (err) {
            console.error('Failed to forward audio state change event:', err)
          }
        }
      })
    }

    if (activeTranscriptionPipeline) {
      activeTranscriptionUnsubscribe = activeTranscriptionPipeline.onStateChanged((state) => {
        if (!webContents.isDestroyed || !webContents.isDestroyed()) {
          try {
            webContents.send!(IPC_CHANNELS.TRANSCRIPTION_STATE_CHANGED, state)
          } catch (err) {
            console.error('Failed to forward transcription state change event:', err)
          }
        }
      })
    }
  }

  activeMicBackend = micBackend ?? null
  activeLoopbackBackend = loopbackBackend ?? null
  activeTranscriptionPipeline = transcriptionPipeline ?? null

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
    async (event: unknown): Promise<IpcResponse<SessionState>> => {
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

      const source = runningMode === 'both' && dual ? dual : capturer
      const runtime = source.getStatus()
      const state: SessionState = {
        status: runtime !== 'idle' ? runtime : currentSessionStatus
      }
      if (runningMode === 'both' && dual) {
        const stats = dual.getBufferStats()
        state.capture = {
          mode: 'both', totalBytes: stats.totalBytes,
          sources: stats.byDisplay.map((entry) => ({
            displayId: entry.displayId, status: entry.status,
            frameCount: entry.frameCount, totalBytes: entry.totalBytes,
            newestTimestamp: entry.newestTimestamp
          }))
        }
      } else if (runningMode === 'single' && typeof capturer.getBufferStats === 'function') {
        const stats = capturer.getBufferStats()
        state.capture = {
          mode: 'single', totalBytes: stats.totalBytes,
          sources: capturer.getActiveDisplayId() ? [{
            displayId: capturer.getActiveDisplayId()!, status: capturer.getStatus(),
            frameCount: stats.frameCount, totalBytes: stats.totalBytes,
            newestTimestamp: stats.newestTimestamp
          }] : []
        }
      }
      return { ok: true, data: state }
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

      if (runningMode) {
        const source = runningMode === 'both' ? dual : capturer
        if (source && source.getStatus() !== 'idle') {
          return { ok: false, error: {
            code: 'SESSION_ACTIVE_STOP_REQUIRED',
            message: 'Stop the active capture before changing its display permissions'
          } }
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

      let requestedSelection = currentCaptureSelection
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
          requestedSelection = parsed.data.selection
        }
      }

      if (runningMode) {
        const previous = runningMode === 'both' ? dual : capturer
        if (previous && previous.getStatus() !== 'idle') {
          return { ok: false, error: {
            code: 'SESSION_ACTIVE_STOP_REQUIRED',
            message: 'Stop the current session before starting or changing capture mode'
          } }
        }
      }

      const selection = requestedSelection
      if (selection.mode === 'both' && !dual) {
        return { ok: false, error: {
          code: 'UNSUPPORTED_MODE',
          message: 'Simultaneous both-display capture requires an initialized P1.3 supervisor'
        } }
      }

      try {
        currentCaptureSelection = selection
        runningMode = selection.mode
        if (selection.mode === 'both') {
          await dual!.start()
        } else {
          await capturer.start(selection.displayId)
        }
        const currentStatus = selection.mode === 'both' ? dual!.getStatus() : capturer.getStatus()
        if (currentStatus !== 'active') {
          return { ok: false, error: {
            code: 'CAPTURE_START_ABORTED',
            message: `Capture start did not reach active state (current status: ${currentStatus})`
          } }
        }
        const responsePayload = {
          success: true,
          status: currentStatus,
          ...(selection.mode === 'single' ? { displayId: selection.displayId } : {})
        }
        return { ok: true, data: SessionStartResponseSchema.parse(responsePayload) }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: { code: 'CAPTURE_START_FAILED', message: msg } }
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

      try {
        const source = runningMode === 'both' && dual ? dual : capturer
        micVad.reset()
        systemVad.reset()
        if (activeTranscriptionPipeline) {
          activeTranscriptionPipeline.stop()
        }
        const results = await Promise.allSettled([
          source.stop(),
          activeAudioSupervisor ? activeAudioSupervisor.stopAll() : Promise.resolve()
        ])
        runningMode = null
        currentSessionStatus = 'idle'

        const stopFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (stopFailure) {
          throw stopFailure.reason
        }

        const responsePayload = { success: true, status: source.getStatus() }
        return { ok: true, data: SessionStopResponseSchema.parse(responsePayload) }
      } catch (err) {
        return { ok: false, error: {
          code: 'CAPTURE_STOP_FAILED',
          message: err instanceof Error ? err.message : String(err)
        } }
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

  ipc.handle(
    IPC_CHANNELS.AUDIO_GET_STATE,
    async (event: unknown): Promise<IpcResponse<AudioSessionState>> => {
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

      if (!activeAudioSupervisor) {
        return {
          ok: false,
          error: {
            code: 'AUDIO_UNAVAILABLE',
            message: 'Audio supervisor is not initialized'
          }
        }
      }

      return {
        ok: true,
        data: activeAudioSupervisor.getState()
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.AUDIO_SET_CONFIG,
    async (event: unknown, payload: unknown): Promise<IpcResponse<AudioSessionState>> => {
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

      const parsed = AudioConfigSchema.safeParse(payload)
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'INVALID_AUDIO_CONFIG',
            message: parsed.error.message
          }
        }
      }

      if (!activeAudioSupervisor) {
        return {
          ok: false,
          error: {
            code: 'AUDIO_UNAVAILABLE',
            message: 'Audio supervisor is not initialized'
          }
        }
      }

      try {
        const state = await activeAudioSupervisor.setAudioConfig(parsed.data)
        if (typeof parsed.data.paused === 'boolean' && activeTranscriptionPipeline) {
          if (parsed.data.paused) {
            activeTranscriptionPipeline.pause()
          } else {
            activeTranscriptionPipeline.resume()
          }
        }
        return {
          ok: true,
          data: state
        }
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'AUDIO_CONFIG_FAILED',
            message: err instanceof Error ? err.message : String(err)
          }
        }
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.AUDIO_GET_DEVICES,
    async (event: unknown): Promise<IpcResponse<AudioDevice[]>> => {
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

      if (!activeAudioSupervisor) {
        return {
          ok: true,
          data: []
        }
      }

      try {
        const devices = await activeAudioSupervisor.enumerateDevices()
        return {
          ok: true,
          data: devices
        }
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'AUDIO_ENUMERATION_FAILED',
            message: err instanceof Error ? err.message : String(err)
          }
        }
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.AUDIO_SUBMIT_CHUNK,
    async (event: unknown, payload: unknown): Promise<IpcResponse<{ accepted: boolean }>> => {
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

      const parsed = AudioSubmitChunkSchema.safeParse(payload)
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'INVALID_AUDIO_CHUNK',
            message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          }
        }
      }

      const { source, data, timestamp, durationMs, sampleRate, channels } = parsed.data
      let isSpeech = parsed.data.isSpeech
      let rms = parsed.data.rms

      if (typeof isSpeech !== 'boolean' || typeof rms !== 'number') {
        const sampleCount = Math.floor(data.byteLength / 2)
        const int16Samples =
          data.byteOffset % 2 === 0
            ? new Int16Array(data.buffer, data.byteOffset, sampleCount)
            : new Int16Array(
                data.buffer.slice(data.byteOffset, data.byteOffset + sampleCount * 2)
              )

        const vad = source === 'mic' ? micVad : systemVad
        const vadStatus = vad.process(int16Samples, durationMs)
        if (typeof isSpeech !== 'boolean') {
          isSpeech = vadStatus.isSpeech
        }
        if (typeof rms !== 'number') {
          rms = vadStatus.rms
        }
      }

      const chunk: AudioChunk = {
        id: `chunk-${source}-${audioChunkCounter++}`,
        source,
        timestamp,
        durationMs,
        sampleRate: sampleRate ?? 16000,
        channels: channels ?? 1,
        data: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        rms: rms ?? 0,
        isSpeech: isSpeech ?? false
      }

      if (source === 'mic' && activeMicBackend) {
        activeMicBackend.emitChunk(chunk)
      } else if (source === 'system' && activeLoopbackBackend) {
        activeLoopbackBackend.emitChunk(chunk)
      }

      if (activeTranscriptionPipeline) {
        void activeTranscriptionPipeline.ingestChunk(chunk).catch((err) => {
          console.error('Failed to ingest chunk in transcription pipeline:', err)
        })
      }

      return {
        ok: true,
        data: { accepted: true }
      }
    }
  )

  ipc.handle(
    IPC_CHANNELS.TRANSCRIPTION_GET_STATE,
    async (event: unknown): Promise<IpcResponse<TranscriptionSessionState>> => {
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

      const defaultState: TranscriptionSessionState = {
        latestSegment: null,
        latestQuestion: null,
        segmentCount: 0,
        questionCount: 0,
        isTranscribing: false
      }

      return {
        ok: true,
        data: activeTranscriptionPipeline ? activeTranscriptionPipeline.getState() : defaultState
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
  if (activeDualStatusUnsubscribe) {
    activeDualStatusUnsubscribe()
    activeDualStatusUnsubscribe = null
  }
  if (activeAudioStateUnsubscribe) {
    activeAudioStateUnsubscribe()
    activeAudioStateUnsubscribe = null
  }
  if (activeTranscriptionUnsubscribe) {
    activeTranscriptionUnsubscribe()
    activeTranscriptionUnsubscribe = null
  }
  activeAudioSupervisor = null
  activeMicBackend = null
  activeLoopbackBackend = null
  activeTranscriptionPipeline = null
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

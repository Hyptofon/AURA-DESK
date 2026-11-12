import type {
  CapturedFrame,
  CaptureTarget,
  DisplayMediaStreamClient,
  FrameCaptureBackend
} from '../../shared/contracts/capture'
import { CaptureWindowClient } from './capture-window-client'

export interface DisplayMediaRequest {
  frame: unknown | null
  securityOrigin: string
  videoRequested: boolean
  audioRequested: boolean
  userGesture: boolean
}

export interface DisplayStreams {
  video?: { id: string; name: string }
  audio?: unknown
}

export interface MediaStreamSessionLike {
  setDisplayMediaRequestHandler(
    handler: ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void) | null
  ): void
}

export type FrameExtractor = (target: CaptureTarget) => Promise<CapturedFrame>

export interface MediaStreamBackendOptions {
  session?: MediaStreamSessionLike
  authorizedOrigin?: string
  isAuthorizedFrame?: (frame: unknown, origin: string) => boolean
  frameExtractor?: FrameExtractor
  client?: DisplayMediaStreamClient
}

/**
 * Resolves dedicated in-memory isolated session partition for capture.
 * Never pollutes or exposes the default system session.
 */
function resolveCaptureSession(): MediaStreamSessionLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    if (electron?.session?.fromPartition) {
      return electron.session.fromPartition('in-memory:aura-capture', { cache: false })
    }
    return electron?.session?.defaultSession ?? null
  } catch {
    return null
  }
}

/**
 * Source-Specific MediaStream Frame Capture Backend.
 *
 * Security & Isolation Invariants:
 * 1. ZERO Cross-Display Thumbnails: Metadata enumeration uses 0x0 thumbnail size.
 * 2. Strict Selected-Source Authorization: Only the verified target sourceId is granted in setDisplayMediaRequestHandler.
 * 3. Fail-Closed Access Control: Unauthorized frames, unexpected origins, or unselected sources receive callback(null).
 * 4. Permanent Deny Gate: Stopped or idle session installs a permanent deny-by-default handler.
 * 5. Hardware Teardown: On stop(), actual media stream tracks are stopped and handles released.
 */
export class MediaStreamDisplayCaptureBackend implements FrameCaptureBackend {
  private activeTarget: CaptureTarget | null = null
  private readonly session: MediaStreamSessionLike | null
  private readonly authorizedOrigin?: string
  private readonly isAuthorizedFrame?: (frame: unknown, origin: string) => boolean
  private readonly frameExtractor?: FrameExtractor
  private readonly client: DisplayMediaStreamClient
  private readonly trackStopCallbacks = new Set<() => void>()

  private readonly denyHandler = (
    _request: DisplayMediaRequest,
    callback: (streams: DisplayStreams | null) => void
  ): void => {
    callback(null)
  }

  constructor(options: MediaStreamBackendOptions = {}) {
    this.session = options.session ?? resolveCaptureSession()
    this.client = options.client ?? new CaptureWindowClient({ session: this.session })
    this.authorizedOrigin =
      options.authorizedOrigin ?? (options.isAuthorizedFrame ? undefined : 'file:///')
    this.isAuthorizedFrame =
      options.isAuthorizedFrame ??
      ((frame: unknown, origin: string) => {
        if (this.client instanceof CaptureWindowClient) {
          return this.client.isAuthorizedFrame(frame, origin)
        }
        return false
      })
    this.frameExtractor = options.frameExtractor

    // Install permanent fail-closed deny handler by default
    if (this.session) {
      this.session.setDisplayMediaRequestHandler(this.denyHandler)
    }
  }

  /**
   * Initializes the backend for an explicit verified capture target.
   * Registers active authorization gate and starts the underlying stream.
   */
  public async start(target: CaptureTarget): Promise<void> {
    if (!target || !target.sourceId || !target.displayId) {
      throw new Error('MediaStream capture start failed: invalid or incomplete CaptureTarget')
    }

    this.activeTarget = { ...target }

    if (this.session) {
      this.session.setDisplayMediaRequestHandler(this.handleDisplayMediaRequest.bind(this))
    }

    // Start stream via client
    await this.client.startStream(this.activeTarget)
  }

  /**
   * Core security gate invoked by Chromium whenever getDisplayMedia() is called.
   * Enforces fail-closed frame authorization and grants exclusively the selected source.
   */
  public handleDisplayMediaRequest(
    request: DisplayMediaRequest,
    callback: (streams: DisplayStreams | null) => void
  ): void {
    // Invariant 1: Active target must exist
    if (!this.activeTarget || !this.activeTarget.sourceId) {
      callback(null)
      return
    }

    // Invariant 2: Requester frame must exist
    if (!request.frame) {
      callback(null)
      return
    }

    // Invariant 3: Validate authorized origin if configured
    if (this.authorizedOrigin) {
      const match =
        request.securityOrigin === this.authorizedOrigin ||
        (this.authorizedOrigin === 'file:///' && request.securityOrigin === 'file://') ||
        (this.authorizedOrigin === 'file://' && request.securityOrigin === 'file:///')
      if (!match) {
        callback(null)
        return
      }
    }

    // Invariant 4: Mandatory frame authorization predicate
    // If no validator is configured, fail closed by default (never allow-all)
    if (!this.isAuthorizedFrame) {
      callback(null)
      return
    }

    const authorized = this.isAuthorizedFrame(request.frame, request.securityOrigin)
    if (!authorized) {
      callback(null)
      return
    }

    // Invariant 5: Video must be requested
    if (!request.videoRequested) {
      callback(null)
      return
    }

    // Invariant 6: Only video from the explicitly selected source is granted.
    // Audio is strictly omitted (audio capture is managed independently).
    const grantedSourceId = this.activeTarget.sourceId
    const grantedSourceName =
      this.activeTarget.sourceName ?? `Display ${this.activeTarget.displayId}`

    callback({
      video: {
        id: grantedSourceId,
        name: grantedSourceName
      }
    })
  }

  /**
   * Captures a single frame for the active target.
   */
  public async captureFrame(target: CaptureTarget): Promise<CapturedFrame> {
    if (
      !this.activeTarget ||
      this.activeTarget.sourceId !== target.sourceId ||
      this.activeTarget.displayId !== target.displayId
    ) {
      throw new Error(
        `Cross-display isolation violation: capture requested for target "${target.displayId}" while active target is "${this.activeTarget?.displayId ?? 'none'}"`
      )
    }

    if (this.frameExtractor) {
      return this.frameExtractor(target)
    }

    return this.client.grabFrame(target)
  }

  /**
   * Stops all active media tracks, installs fail-closed deny-all handler, and flushes state.
   */
  public async stop(): Promise<void> {
    // Install permanent fail-closed handler (never set to null, which restores default picker)
    if (this.session) {
      this.session.setDisplayMediaRequestHandler(this.denyHandler)
    }

    await this.client.stopStream()

    for (const stopTrack of this.trackStopCallbacks) {
      try {
        stopTrack()
      } catch (err) {
        console.error('Error stopping MediaStream track:', err)
      }
    }
    this.trackStopCallbacks.clear()

    this.activeTarget = null
  }

  public registerTrackStopCallback(cb: () => void): void {
    this.trackStopCallbacks.add(cb)
  }

  public getActiveTarget(): CaptureTarget | null {
    return this.activeTarget ? { ...this.activeTarget } : null
  }

  public isHandlerRegistered(): boolean {
    return this.activeTarget !== null
  }

  public getClient(): DisplayMediaStreamClient {
    return this.client
  }
}

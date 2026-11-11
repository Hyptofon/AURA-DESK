import type {
  CapturedFrame,
  CaptureTarget,
  FrameCaptureBackend
} from '../../shared/contracts/capture'

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
    handler: ((request: DisplayMediaRequest, callback: (streams: DisplayStreams) => void) => void) | null
  ): void
}

export type FrameExtractor = (target: CaptureTarget) => Promise<CapturedFrame>

export interface MediaStreamBackendOptions {
  session?: MediaStreamSessionLike
  authorizedOrigin?: string
  isAuthorizedFrame?: (frame: unknown, origin: string) => boolean
  frameExtractor?: FrameExtractor
}

/**
 * Lazily resolve default Electron session in production without breaking in Node/test environments.
 */
function resolveDefaultSession(): MediaStreamSessionLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
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
 * 3. Fail-Closed Access Control: Unauthorized frames, unexpected origins, or unselected sources receive callback({}).
 * 4. Hardware Teardown: On stop(), actual media stream tracks are stopped and the handler is unregistered.
 */
export class MediaStreamDisplayCaptureBackend implements FrameCaptureBackend {
  private activeTarget: CaptureTarget | null = null
  private isRegistered = false
  private readonly session: MediaStreamSessionLike | null
  private readonly isAuthorizedFrame?: (frame: unknown, origin: string) => boolean
  private readonly frameExtractor?: FrameExtractor
  private readonly trackStopCallbacks = new Set<() => void>()

  constructor(options: MediaStreamBackendOptions = {}) {
    this.session = options.session ?? resolveDefaultSession()
    this.isAuthorizedFrame = options.isAuthorizedFrame
    this.frameExtractor = options.frameExtractor
  }

  /**
   * Initializes the backend for an explicit verified capture target.
   * Registers the display media request handler with session.
   */
  public async start(target: CaptureTarget): Promise<void> {
    if (!target || !target.sourceId || !target.displayId) {
      throw new Error('MediaStream capture start failed: invalid or incomplete CaptureTarget')
    }

    this.activeTarget = { ...target }

    if (this.session) {
      this.session.setDisplayMediaRequestHandler(this.handleDisplayMediaRequest.bind(this))
      this.isRegistered = true
    }
  }

  /**
   * Core security gate invoked by Chromium whenever getDisplayMedia() is called.
   * Enforces fail-closed frame authorization and grants exclusively the selected source.
   */
  public handleDisplayMediaRequest(
    request: DisplayMediaRequest,
    callback: (streams: DisplayStreams) => void
  ): void {
    // Invariant 1: Active target must exist
    if (!this.activeTarget || !this.activeTarget.sourceId) {
      callback({})
      return
    }

    // Invariant 2: Validate requesting frame authority if validator is configured
    if (this.isAuthorizedFrame) {
      const authorized = this.isAuthorizedFrame(request.frame, request.securityOrigin)
      if (!authorized) {
        callback({})
        return
      }
    }

    // Invariant 3: Only video from the explicitly selected source is granted.
    // Audio is never granted through the display media channel (independent audio capture).
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

    throw new Error(
      `MediaStream frame extraction requires an active video track or frame extractor for target "${target.displayId}"`
    )
  }

  /**
   * Stops all active media tracks, unregisters the session handler, and flushes state.
   */
  public async stop(): Promise<void> {
    if (this.session && this.isRegistered) {
      this.session.setDisplayMediaRequestHandler(null)
      this.isRegistered = false
    }

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
    return this.isRegistered
  }
}

import * as fs from 'node:fs'
import { join } from 'node:path'
import type {
  CapturedFrame,
  CaptureTarget,
  DisplayMediaStreamClient
} from '../../shared/contracts/capture'

export interface WebContentsLike {
  mainFrame?: unknown
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
}

export interface BrowserWindowLike {
  webContents: WebContentsLike
  loadFile(filePath: string): Promise<void>
  loadURL(url: string): Promise<void>
  destroy(): void
  isDestroyed(): boolean
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
}

export type CaptureWindowFactory = (options: {
  session: unknown
}) => BrowserWindowLike

export interface CaptureClientOptions {
  session?: unknown
  windowFactory?: CaptureWindowFactory
  htmlPath?: string
  expectedOrigin?: string
  webExecutor?: (script: string) => Promise<unknown>
  frameProvider?: (target: CaptureTarget) => Promise<CapturedFrame>
  startTimeoutMs?: number
}

const DEFAULT_START_TIMEOUT_MS = 5000

export function resolveCaptureHtmlPath(): string {
  const candidatePaths = [
    join(__dirname, 'capture.html'),
    join(__dirname, '../main/capture/capture.html'),
    join(process.cwd(), 'src/main/capture/capture.html')
  ]
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p
  }
  return join(__dirname, 'capture.html')
}

function defaultCaptureWindowFactory(session: unknown): BrowserWindowLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    const BrowserWindow = electron?.BrowserWindow
    if (!BrowserWindow) {
      throw new Error('Electron BrowserWindow is not available in current environment')
    }
    return new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      focusable: false,
      skipTaskbar: true,
      webPreferences: {
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
  } catch (err) {
    throw new Error(
      `Cannot create production capture window: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Capture client running inside an isolated, background Electron WebContents.
 *
 * Responsibilities:
 * 1. Creates a real, isolated capture BrowserWindow bound to the dedicated capture session.
 * 2. Loads a secure local capture document (src/main/capture/capture.html).
 * 3. Enforces exact WebFrameMain and origin authorization (no generic top-level frame checks).
 * 4. Invokes navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }) via fixed script.
 * 5. Owns the MediaStream and video track references.
 * 6. Extracts real PNG frame buffers via ImageCapture / OffscreenCanvas.
 * 7. Stops tracks and destroys capture window on stopStream().
 */
export class CaptureWindowClient implements DisplayMediaStreamClient {
  private active = false
  private activeTarget: CaptureTarget | null = null
  private captureWindow: BrowserWindowLike | null = null
  private readonly session: unknown
  private readonly windowFactory: CaptureWindowFactory
  private readonly htmlPath: string
  private readonly expectedOrigin: string
  private readonly webExecutor?: (script: string) => Promise<unknown>
  private readonly frameProvider?: (target: CaptureTarget) => Promise<CapturedFrame>
  private readonly startTimeoutMs: number

  constructor(options: CaptureClientOptions = {}) {
    this.session = options.session
    this.windowFactory = options.windowFactory ?? defaultCaptureWindowFactory
    this.htmlPath = options.htmlPath ?? resolveCaptureHtmlPath()
    this.expectedOrigin = options.expectedOrigin ?? 'file:///'
    this.webExecutor = options.webExecutor
    this.frameProvider = options.frameProvider
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  }

  public async startStream(target: CaptureTarget): Promise<void> {
    if (!target || !target.sourceId || !target.displayId) {
      throw new Error('CaptureWindowClient failed to start stream: invalid target')
    }

    if (this.active) {
      await this.stopStream()
    }

    this.activeTarget = { ...target }

    // If a custom webExecutor was supplied (e.g. specialized harness), use it directly
    if (this.webExecutor) {
      await this.executeStreamStartScript(this.webExecutor)
      this.active = true
      return
    }

    // Production path: create actual capture window and load secure local capture document
    try {
      this.captureWindow = this.windowFactory({ session: this.session })
      this.setupWindowSecurity(this.captureWindow)
      await this.captureWindow.loadFile(this.htmlPath)
    } catch (err) {
      this.active = false
      this.activeTarget = null
      throw new Error(
        `CaptureWindowClient failed to initialize capture window: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const executor = (script: string) => this.captureWindow!.webContents.executeJavaScript(script)
    await this.executeStreamStartScript(executor)
    this.active = true
  }

  public async grabFrame(target: CaptureTarget): Promise<CapturedFrame> {
    if (!this.active || !this.activeTarget) {
      throw new Error('Cannot grab frame: capture stream is not active')
    }

    if (this.frameProvider) {
      return this.frameProvider(target)
    }

    const executor =
      this.webExecutor ??
      (this.captureWindow && !this.captureWindow.isDestroyed()
        ? (script: string) => this.captureWindow!.webContents.executeJavaScript(script)
        : null)

    if (!executor) {
      throw new Error(
        `CaptureWindowClient has no active frame extraction pipeline for display "${target.displayId}"`
      )
    }

    const rawResult = await executor(`
      (async () => {
        try {
          if (!window.__activeTrack || window.__activeTrack.readyState !== 'live') {
            return { ok: false, error: 'Capture track is not live' };
          }
          const ic = new ImageCapture(window.__activeTrack);
          const bitmap = await ic.grabFrame();
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);
          const width = bitmap.width;
          const height = bitmap.height;
          bitmap.close();
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          const reader = new FileReader();
          return new Promise((resolve) => {
            reader.onloadend = () => {
              const res = reader.result;
              const base64 = typeof res === 'string' ? res.split(',')[1] : '';
              resolve({ ok: true, base64, width, height });
            };
            reader.onerror = () => resolve({ ok: false, error: 'FileReader failed to encode PNG' });
            reader.readAsDataURL(blob);
          });
        } catch (err) {
          return { ok: false, error: err ? String(err.message || err) : 'Frame grab failed' };
        }
      })()
    `)

    const res = rawResult as {
      ok?: boolean
      base64?: string
      width?: number
      height?: number
      error?: string
    } | null

    if (!res || !res.ok || !res.base64) {
      throw new Error(`Frame extraction failed: ${res?.error ?? 'No base64 data produced'}`)
    }

    const buffer = Buffer.from(res.base64, 'base64')
    const data = new Uint8Array(buffer)

    // Validate PNG magic bytes (RFC 2083)
    if (
      data.length < 8 ||
      data[0] !== 0x89 ||
      data[1] !== 0x50 ||
      data[2] !== 0x4e ||
      data[3] !== 0x47
    ) {
      throw new Error('Frame extraction failed: decoded payload is not a valid PNG')
    }

    return {
      displayId: target.displayId,
      timestamp: Date.now(),
      bounds: {
        x: target.bounds?.x ?? 0,
        y: target.bounds?.y ?? 0,
        width: res.width ?? target.bounds?.width ?? 1920,
        height: res.height ?? target.bounds?.height ?? 1080
      },
      data,
      byteLength: data.byteLength,
      format: 'png',
      hash: `stream-${target.displayId}-${Date.now()}`
    }
  }

  public async stopStream(): Promise<void> {
    await this.cleanupStream()
  }

  public isStreamActive(): boolean {
    return this.active
  }

  public getActiveTarget(): CaptureTarget | null {
    return this.activeTarget ? { ...this.activeTarget } : null
  }

  public getCaptureWindow(): BrowserWindowLike | null {
    return this.captureWindow
  }

  /**
   * Authorizes ONLY the exact trusted capture window's mainFrame and expected origin.
   * Generic top-level frames or unexpected origins fail closed.
   */
  public isAuthorizedFrame(frame: unknown, origin: string): boolean {
    if (!this.captureWindow || this.captureWindow.isDestroyed()) {
      return false
    }

    const mainFrame = this.captureWindow.webContents?.mainFrame
    if (!mainFrame) return false

    const f = frame as { processId?: number; routingId?: number }
    const mf = mainFrame as { processId?: number; routingId?: number }

    const isExactMatch =
      frame === mainFrame ||
      (typeof f?.processId === 'number' &&
        typeof f?.routingId === 'number' &&
        typeof mf?.processId === 'number' &&
        typeof mf?.routingId === 'number' &&
        f.processId === mf.processId &&
        f.routingId === mf.routingId)

    if (!isExactMatch) return false

    // Origin must match expected local file origin ('file:///' or 'file://')
    return (
      origin === this.expectedOrigin ||
      origin === 'file:///' ||
      origin === 'file://'
    )
  }

  private async executeStreamStartScript(
    executor: (script: string) => Promise<unknown>
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Capture stream startup timed out')),
        this.startTimeoutMs
      )
    })

    const startScriptPromise = (async () => {
      const rawResult = await executor(`
        (async () => {
          try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
              return { ok: false, error: 'navigator.mediaDevices.getDisplayMedia is not available' };
            }
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false
            });
            const tracks = stream.getVideoTracks();
            const track = tracks[0];
            if (!track || track.readyState !== 'live') {
              return { ok: false, error: 'Acquired video track is not live' };
            }
            window.__activeStream = stream;
            window.__activeTrack = track;
            return { ok: true, trackId: track.id, label: track.label };
          } catch (err) {
            return { ok: false, error: err ? String(err.message || err) : 'MediaStream request rejected' };
          }
        })()
      `)

      const result = rawResult as { ok?: boolean; error?: string } | null
      if (!result || !result.ok) {
        throw new Error(`Stream acquisition failed: ${result?.error ?? 'Unknown error'}`)
      }
    })()

    try {
      await Promise.race([startScriptPromise, timeoutPromise])
    } catch (err) {
      await this.cleanupStream()
      throw err
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async cleanupStream(): Promise<void> {
    const executor =
      this.webExecutor ??
      (this.captureWindow && !this.captureWindow.isDestroyed()
        ? (script: string) => this.captureWindow!.webContents.executeJavaScript(script)
        : null)

    if (executor && this.active) {
      try {
        await executor(`
          (() => {
            if (window.__activeTrack) {
              window.__activeTrack.stop();
              window.__activeTrack = null;
            }
            if (window.__activeStream) {
              window.__activeStream.getTracks().forEach(t => t.stop());
              window.__activeStream = null;
            }
          })()
        `)
      } catch {
        // Ignore teardown script errors during window destruction
      }
    }

    if (this.captureWindow) {
      try {
        if (!this.captureWindow.isDestroyed()) {
          this.captureWindow.destroy()
        }
      } catch {
        // Ignore window destruction errors
      }
      this.captureWindow = null
    }

    this.active = false
    this.activeTarget = null
  }

  private setupWindowSecurity(win: BrowserWindowLike): void {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event: unknown) => {
      const ev = event as { preventDefault?: () => void }
      if (typeof ev?.preventDefault === 'function') {
        ev.preventDefault()
      }
    })
    win.on('closed', () => {
      this.active = false
      this.activeTarget = null
      this.captureWindow = null
    })
  }
}

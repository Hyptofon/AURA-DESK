import * as fs from 'node:fs'
import { join } from 'node:path'
import captureHtmlAsset from './capture.html?asset'
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
  webExecutor?: (script: string, userGesture?: boolean) => Promise<unknown>
  frameProvider?: (target: CaptureTarget) => Promise<CapturedFrame>
  startTimeoutMs?: number
}

const DEFAULT_START_TIMEOUT_MS = 5000

/**
 * Resolves the absolute path to the capture surface document (capture.html).
 *
 * Checks:
 * 1. Explicit asset path or electron-vite bundled asset (with content hash).
 * 2. Query-stripped local path (for Vite dev / SSR).
 * 3. Relative path from CWD (for development layout).
 * 4. Standard fallback paths relative to __dirname.
 *
 * Fails closed with a clear error if the document cannot be found.
 */
export function resolveCaptureHtmlPath(assetPathOverride?: string): string {
  // If an explicit override path was passed, validate it strictly and do not fall back
  if (typeof assetPathOverride === 'string' && assetPathOverride.length > 0) {
    if (fs.existsSync(assetPathOverride)) {
      return assetPathOverride
    }
    const cleaned = assetPathOverride.replace(/\?.*$/, '')
    if (fs.existsSync(cleaned)) {
      return cleaned
    }
    throw new Error(
      `Capture surface document (capture.html) could not be resolved at specified path: "${assetPathOverride}"`
    )
  }

  const assetCandidate = captureHtmlAsset

  if (typeof assetCandidate === 'string' && assetCandidate.length > 0) {
    // 1. Direct path check (emitted by electron-vite in production build)
    if (fs.existsSync(assetCandidate)) {
      return assetCandidate
    }

    // 2. Strip query parameters (e.g. "?asset" in development / test environments)
    const cleaned = assetCandidate.replace(/\?.*$/, '')
    if (fs.existsSync(cleaned)) {
      return cleaned
    }

    // 3. Dev server / SSR virtual path relative to current working directory
    const relativeToRoot = cleaned.replace(/^[/\\]+/, '')
    const fromCwd = join(process.cwd(), relativeToRoot)
    if (fs.existsSync(fromCwd)) {
      return fromCwd
    }
  }

  // 4. Candidate locations relative to __dirname and process.cwd()
  const candidatePaths = [
    join(__dirname, 'capture.html'),
    join(__dirname, 'chunks/capture.html'),
    join(__dirname, '../main/capture/capture.html'),
    join(process.cwd(), 'src/main/capture/capture.html')
  ]
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p
  }

  // 5. Fail closed if the capture surface document is genuinely missing
  throw new Error(
    'Capture surface document (capture.html) could not be resolved in build artifacts or development layout'
  )
}

export function defaultCaptureWindowFactory(
  optionsOrSession?: { session?: unknown } | unknown
): BrowserWindowLike {
  try {
    const session =
      optionsOrSession && typeof optionsOrSession === 'object' && 'session' in optionsOrSession
        ? (optionsOrSession as { session: unknown }).session
        : optionsOrSession

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
 * 4. Invokes navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }) with user gesture.
 * 5. Owns the MediaStream and video track references.
 * 6. Extracts real PNG frame buffers via ImageCapture / OffscreenCanvas.
 * 7. Stops tracks and destroys capture window on stopStream().
 * 8. Ensures guaranteed window cleanup and state reset on any startup failure.
 */
export class CaptureWindowClient implements DisplayMediaStreamClient {
  private active = false
  private activeTarget: CaptureTarget | null = null
  private captureWindow: BrowserWindowLike | null = null
  private readonly session: unknown
  private readonly windowFactory: CaptureWindowFactory
  private readonly htmlPath: string
  private readonly expectedOrigin: string
  private readonly webExecutor?: (script: string, userGesture?: boolean) => Promise<unknown>
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

    // If a custom webExecutor was supplied (e.g. specialized test harness), use it directly
    if (this.webExecutor) {
      try {
        await this.executeStreamStartScript((s, ug = true) => this.webExecutor!(s, ug))
        this.active = true
        return
      } catch (err) {
        await this.cleanupStream()
        throw err
      }
    }

    // Production path: create actual capture window and load secure local capture document
    try {
      const win = this.windowFactory({ session: this.session })
      this.captureWindow = win
      this.setupWindowSecurity(win)

      if (win.isDestroyed()) {
        throw new Error('Capture window was destroyed immediately after creation')
      }

      await win.loadFile(this.htmlPath)

      if (win.isDestroyed() || !this.captureWindow) {
        throw new Error('Capture window was destroyed during document loading')
      }

      const executor = (script: string, userGesture = true) => {
        if (!this.captureWindow || this.captureWindow.isDestroyed()) {
          throw new Error('Capture window is destroyed')
        }
        return this.captureWindow.webContents.executeJavaScript(script, userGesture)
      }

      await this.executeStreamStartScript(executor)
      this.active = true
    } catch (err) {
      await this.cleanupStream()
      throw new Error(
        `CaptureWindowClient failed to initialize capture window: ${err instanceof Error ? err.message : String(err)}`
      )
    }
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
        ? (script: string) => this.captureWindow!.webContents.executeJavaScript(script, false)
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
          let bitmap = null;
          let lastErr = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              bitmap = await ic.grabFrame();
              if (bitmap) break;
            } catch (e) {
              lastErr = e;
              await new Promise((r) => setTimeout(r, 60));
            }
          }
          if (!bitmap) {
            return {
              ok: false,
              error: 'ImageCapture.grabFrame failed: ' + (lastErr ? String(lastErr.message || lastErr) : 'no bitmap produced')
            };
          }
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
    executor: (script: string, userGesture?: boolean) => Promise<unknown>
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Capture stream startup timed out')),
        this.startTimeoutMs
      )
    })

    const startScriptPromise = (async () => {
      const rawResult = await executor(
        `
        (async () => {
          try {
            if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
              return { ok: false, error: 'navigator.mediaDevices.getDisplayMedia is not available', errorName: 'NotSupportedError' };
            }
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false
            });
            const tracks = stream.getVideoTracks();
            const track = tracks[0];
            if (!track || track.readyState !== 'live') {
              return { ok: false, error: 'Acquired video track is not live', errorName: 'InvalidStateError' };
            }
            window.__activeStream = stream;
            window.__activeTrack = track;
            return { ok: true, trackId: track.id, label: track.label };
          } catch (err) {
            const name = (err && typeof err === 'object' && 'name' in err) ? String(err.name) : 'Error';
            const message = (err && typeof err === 'object' && 'message' in err) ? String(err.message) : String(err);
            return { ok: false, error: name + ': ' + message, errorName: name };
          }
        })()
      `,
        true
      )

      const result = rawResult as { ok?: boolean; error?: string; errorName?: string } | null
      if (!result || !result.ok) {
        throw new Error(
          `Stream acquisition failed${result?.errorName ? ` [${result.errorName}]` : ''}: ${result?.error ?? 'Unknown error'}`
        )
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
        ? (script: string) => this.captureWindow!.webContents.executeJavaScript(script, false)
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

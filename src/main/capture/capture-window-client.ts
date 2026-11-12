import type {
  CapturedFrame,
  CaptureTarget,
  DisplayMediaStreamClient
} from '../../shared/contracts/capture'

export interface CaptureClientOptions {
  session?: unknown
  windowFactory?: () => unknown
  webExecutor?: (script: string) => Promise<unknown>
  frameProvider?: (target: CaptureTarget) => Promise<CapturedFrame>
}

/**
 * Capture client running inside an isolated, background Electron WebContents.
 *
 * Responsibilities:
 * 1. Invokes navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).
 * 2. Owns the MediaStream and video track references.
 * 3. Extracts real PNG frame buffers via OffscreenCanvas / ImageCapture.
 * 4. Stops tracks and tears down hardware handles on stopStream().
 */
export class CaptureWindowClient implements DisplayMediaStreamClient {
  private active = false
  private activeTarget: CaptureTarget | null = null
  private readonly webExecutor?: (script: string) => Promise<unknown>
  private readonly frameProvider?: (target: CaptureTarget) => Promise<CapturedFrame>

  constructor(options: CaptureClientOptions = {}) {
    this.webExecutor = options.webExecutor
    this.frameProvider = options.frameProvider
  }

  public async startStream(target: CaptureTarget): Promise<void> {
    if (!target || !target.sourceId || !target.displayId) {
      throw new Error('CaptureWindowClient failed to start stream: invalid target')
    }

    this.activeTarget = { ...target }

    if (this.webExecutor) {
      // Execute stream initialization script in WebContents
      await this.webExecutor(`
        (async () => {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
          });
          const track = stream.getVideoTracks()[0];
          if (!track || track.readyState !== 'live') {
            throw new Error('Capture track failed to become live');
          }
          window.__activeStream = stream;
          window.__activeTrack = track;
          return { ready: true };
        })()
      `)
    }

    this.active = true
  }

  public async grabFrame(target: CaptureTarget): Promise<CapturedFrame> {
    if (!this.active || !this.activeTarget) {
      throw new Error('Cannot grab frame: capture stream is not active')
    }

    if (this.frameProvider) {
      return this.frameProvider(target)
    }

    if (this.webExecutor) {
      const base64Data = (await this.webExecutor(`
        (async () => {
          if (!window.__activeTrack) throw new Error('No active track');
          const imageCapture = new ImageCapture(window.__activeTrack);
          const bitmap = await imageCapture.grabFrame();
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          const reader = new FileReader();
          return new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })()
      `)) as string

      const buffer = Buffer.from(base64Data, 'base64')
      const data = new Uint8Array(buffer)

      return {
        displayId: target.displayId,
        timestamp: Date.now(),
        bounds: target.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 },
        data,
        byteLength: data.byteLength,
        format: 'png',
        hash: `stream-${target.displayId}-${Date.now()}`
      }
    }

    throw new Error(
      `CaptureWindowClient has no active frame extraction pipeline for display "${target.displayId}"`
    )
  }

  public async stopStream(): Promise<void> {
    if (this.webExecutor && this.active) {
      try {
        await this.webExecutor(`
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
      } catch (err) {
        console.error('Error stopping capture window media tracks:', err)
      }
    }

    this.active = false
    this.activeTarget = null
  }

  public isStreamActive(): boolean {
    return this.active
  }

  public getActiveTarget(): CaptureTarget | null {
    return this.activeTarget ? { ...this.activeTarget } : null
  }
}

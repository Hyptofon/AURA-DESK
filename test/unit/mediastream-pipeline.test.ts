import { describe, it, expect, vi } from 'vitest'
import {
  MediaStreamDisplayCaptureBackend,
  type MediaStreamSessionLike,
  type DisplayMediaRequest,
  type DisplayStreams
} from '../../src/main/capture/mediastream-backend'
import { CaptureWindowClient } from '../../src/main/capture/capture-window-client'
import type { CaptureTarget } from '../../src/shared/contracts/capture'
import { createValidCapturedFrame } from '../fixtures/image-fixtures'

describe('MediaStream Pipeline & Authorization Gate Regression Suite', () => {
  const sampleTarget: CaptureTarget = {
    sourceId: 'screen:0:0',
    displayId: '101',
    sourceName: 'Primary Monitor'
  }

  it('fails closed when trustedFrameValidator is missing (never default to allow-all)', async () => {
    let registeredHandler:
      | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void)
      | null = null

    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler
      })
    }

    // Backend created WITHOUT a trusted frame validator
    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession
    })

    await backend.start(sampleTarget)
    expect(registeredHandler).not.toBeNull()

    let grantedStreams: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    registeredHandler!(
      {
        frame: { id: 'unvalidated-frame' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: false,
        userGesture: true
      },
      (streams) => {
        grantedStreams = streams
      }
    )

    // MUST fail closed! If validator is missing, permission must NEVER be granted
    expect(grantedStreams).toBeNull()
  })

  it('enforces authorizedOrigin and denies requests from mismatched origins', async () => {
    let registeredHandler:
      | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void)
      | null = null

    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler
      })
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: (_frame, origin) => origin === 'http://localhost:5173'
    })

    await backend.start(sampleTarget)
    expect(registeredHandler).not.toBeNull()

    let grantedStreams: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    registeredHandler!(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'https://attacker.example.com',
        videoRequested: true,
        audioRequested: false,
        userGesture: true
      },
      (streams) => {
        grantedStreams = streams
      }
    )

    // Must be rejected with null
    expect(grantedStreams).toBeNull()
  })

  it('stop() establishes a permanent deny-by-default policy rather than resetting handler to null', async () => {
    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn()
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: () => true
    })

    await backend.start(sampleTarget)
    await backend.stop()

    // Electron documentation states setDisplayMediaRequestHandler(null) restores default system picker.
    // To prevent unauthorized capture after stop, it must NOT set null, but set an explicit deny-all handler!
    const calls = vi.mocked(mockSession.setDisplayMediaRequestHandler).mock.calls
    const lastCallArg = calls[calls.length - 1][0]

    expect(lastCallArg).not.toBeNull()
    expect(typeof lastCallArg).toBe('function')

    // Calling the post-stop handler must deny requests with null
    let response: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    lastCallArg!(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: false,
        userGesture: false
      },
      (streams: DisplayStreams | null) => {
        response = streams
      }
    )

    expect(response).toBeNull()
  })

  it('idle backend denies any media requests before start is called', () => {
    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn()
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: () => true
    })

    // Handler invoked before start()
    let response: DisplayStreams | null = 'sentinel' as unknown as DisplayStreams
    backend.handleDisplayMediaRequest(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: false,
        userGesture: false
      },
      (streams) => {
        response = streams
      }
    )

    expect(response).toBeNull()
  })

  it('rejects audio requests through display media handler (independent audio capture invariant)', async () => {
    let registeredHandler:
      | ((request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void)
      | null = null

    const mockSession: MediaStreamSessionLike = {
      setDisplayMediaRequestHandler: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler
      })
    }

    const backend = new MediaStreamDisplayCaptureBackend({
      session: mockSession,
      authorizedOrigin: 'http://localhost:5173',
      isAuthorizedFrame: () => true
    })

    await backend.start(sampleTarget)

    let grantedStreams: DisplayStreams | null = null
    registeredHandler!(
      {
        frame: { id: 'frame-1' },
        securityOrigin: 'http://localhost:5173',
        videoRequested: true,
        audioRequested: true, // Audio requested
        userGesture: true
      },
      (streams) => {
        grantedStreams = streams
      }
    )

    expect(grantedStreams).not.toBeNull()
    // Audio must be strictly undefined/omitted
    expect(grantedStreams!.audio).toBeUndefined()
  })

  describe('CaptureWindowClient Lifecycle & Frame Extraction', () => {
    it('executes stream acquisition and extracts frames via webExecutor', async () => {
      const executedScripts: string[] = []
      const fakePngBase64 = Buffer.from(
        createValidCapturedFrame({ displayId: '101' }).data
      ).toString('base64')

      const client = new CaptureWindowClient({
        webExecutor: async (script) => {
          executedScripts.push(script)
          if (script.includes('navigator.mediaDevices.getDisplayMedia')) {
            return { ready: true }
          }
          if (script.includes('imageCapture.grabFrame')) {
            return fakePngBase64
          }
          return null
        }
      })

      expect(client.isStreamActive()).toBe(false)
      expect(client.getActiveTarget()).toBeNull()

      await client.startStream(sampleTarget)
      expect(client.isStreamActive()).toBe(true)
      expect(client.getActiveTarget()?.displayId).toBe('101')
      expect(
        executedScripts.some((s) => s.includes('navigator.mediaDevices.getDisplayMedia'))
      ).toBe(true)

      const frame = await client.grabFrame(sampleTarget)
      expect(frame.displayId).toBe('101')
      expect(frame.format).toBe('png')
      expect(frame.data.byteLength).toBeGreaterThan(0)
      expect(frame.data[0]).toBe(0x89) // PNG signature
      expect(
        executedScripts.some((s) => s.includes('imageCapture.grabFrame'))
      ).toBe(true)

      await client.stopStream()
      expect(client.isStreamActive()).toBe(false)
      expect(client.getActiveTarget()).toBeNull()
      expect(
        executedScripts.some((s) => s.includes('window.__activeTrack.stop()'))
      ).toBe(true)
    })

    it('rejects frame grab when stream is inactive', async () => {
      const client = new CaptureWindowClient()
      await expect(client.grabFrame(sampleTarget)).rejects.toThrow(
        /Cannot grab frame: capture stream is not active/
      )
    })

    it('rejects startStream when target is invalid', async () => {
      const client = new CaptureWindowClient()
      await expect(
        client.startStream({ sourceId: '', displayId: '' })
      ).rejects.toThrow(/invalid target/)
    })

    it('delegates to frameProvider when injected', async () => {
      const expectedFrame = createValidCapturedFrame({ displayId: '101' })
      const client = new CaptureWindowClient({
        frameProvider: async () => expectedFrame
      })

      await client.startStream(sampleTarget)
      const frame = await client.grabFrame(sampleTarget)
      expect(frame).toBe(expectedFrame)
      await client.stopStream()
    })
  })
})

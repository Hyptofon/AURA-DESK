import { describe, it, expect, vi } from 'vitest'
import {
  MediaStreamDisplayCaptureBackend,
  type MediaStreamSessionLike,
  type DisplayMediaRequest,
  type DisplayStreams
} from '../../src/main/capture/mediastream-backend'
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
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDualCaptureBackends, type CaptureSessionFactory } from '../../src/main/capture/dual-capture-backends'
import type {
  DisplayMediaRequest,
  DisplayStreams,
  MediaStreamSessionLike
} from '../../src/main/capture/mediastream-backend'
import type { CaptureTarget } from '../../src/shared/contracts/capture'
import { CaptureWindowClient } from '../../src/main/capture/capture-window-client'

type MediaHandler = (request: DisplayMediaRequest, callback: (streams: DisplayStreams | null) => void) => void

class FakeSession implements MediaStreamSessionLike {
  handler: MediaHandler | null = null
  setDisplayMediaRequestHandler(handler: MediaHandler | null): void {
    this.handler = handler
  }
  request(): DisplayStreams | null {
    if (!this.handler) throw new Error('Capture request handler is missing')
    let result: DisplayStreams | null = null
    this.handler({
      frame: { processId: 1, routingId: 1 },
      securityOrigin: 'file:///',
      videoRequested: true,
      audioRequested: false,
      userGesture: true
    }, (streams) => {
      result = streams
    })
    return result
  }
}

function setupFactory(): { factory: CaptureSessionFactory; sessions: FakeSession[]; partitions: string[] } {
  const sessions: FakeSession[] = []
  const partitions: string[] = []
  return {
    sessions,
    partitions,
    factory: {
      fromPartition(partition, options) {
        expect(options).toEqual({ cache: false })
        partitions.push(partition)
        const created = new FakeSession()
        sessions.push(created)
        return created
      }
    }
  }
}

afterEach(() => vi.restoreAllMocks())

describe('createDualCaptureBackends', () => {
  it('creates exactly two distinct nonpersistent partitions with cache disabled', () => {
    const { factory, sessions, partitions } = setupFactory()
    const backends = createDualCaptureBackends(factory)

    expect(backends).toHaveLength(2)
    expect(backends[0]).not.toBe(backends[1])
    expect(sessions[0]).not.toBe(sessions[1])
    expect(partitions).toHaveLength(2)
    expect(partitions[0]).toMatch(/^in-memory:aura-capture-dual-[a-f\d-]+-primary$/)
    expect(partitions[1]).toBe(partitions[0].replace(/-primary$/, '-secondary'))
    expect(partitions.every((value) => !value.startsWith('persist:'))).toBe(true)
    expect(backends[0].getClient()).not.toBe(backends[1].getClient())
    // Idle permission handlers must reject media requests.
    expect(sessions[0].request()).toBeNull()
    expect(sessions[1].request()).toBeNull()
  })

  it('does not reuse the same capture sessions across separate supervisor instances', () => {
    const { factory, partitions } = setupFactory()
    createDualCaptureBackends(factory)
    createDualCaptureBackends(factory)
    expect(new Set(partitions).size).toBe(4)
  })

  it('fails closed if the session provider aliases both partitions', () => {
    const shared = new FakeSession()
    const factory: CaptureSessionFactory = { fromPartition: () => shared }
    expect(() => createDualCaptureBackends(factory)).toThrow(/two distinct/)
    expect(shared.handler).toBeNull() // No backend was constructed.
  })

  it('fails closed when a partition does not yield a usable session', () => {
    const factory = {
      fromPartition: vi.fn().mockReturnValueOnce(new FakeSession()).mockReturnValueOnce(null)
    } as unknown as CaptureSessionFactory
    expect(() => createDualCaptureBackends(factory)).toThrow(/valid in-memory/)
  })

  it('keeps concurrent permission handlers independent through a partial Stop', async () => {
    const { factory, sessions } = setupFactory()
    const [first, second] = createDualCaptureBackends(factory)
    const firstClient = first.getClient() as CaptureWindowClient
    const secondClient = second.getClient() as CaptureWindowClient

    for (const client of [firstClient, secondClient]) {
      // Hardware and window behavior is tested separately; this case checks
      // the real permission-gate composition with controlled capture clients.
      vi.spyOn(client, 'startStream').mockResolvedValue(undefined)
      vi.spyOn(client, 'stopStream').mockResolvedValue(undefined)
      vi.spyOn(client, 'isAuthorizedFrame').mockReturnValue(true)
    }

    const laptop: CaptureTarget = { displayId: 'laptop', sourceId: 'screen:0:0' }
    const external: CaptureTarget = { displayId: 'external', sourceId: 'screen:1:0' }
    await Promise.all([first.start(laptop), second.start(external)])

    expect(sessions[0].request()?.video?.id).toBe('screen:0:0')
    expect(sessions[1].request()?.video?.id).toBe('screen:1:0')

    await first.stop()
    expect(sessions[0].request()).toBeNull()
    expect(sessions[1].request()?.video?.id).toBe('screen:1:0')
    expect(second.getActiveTarget()?.displayId).toBe('external')

    await second.stop()
    expect(sessions[1].request()).toBeNull()
  })
})

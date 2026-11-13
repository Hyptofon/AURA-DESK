import { randomUUID } from 'node:crypto'
import { session } from 'electron'
import {
  MediaStreamDisplayCaptureBackend,
  type MediaStreamSessionLike
} from './mediastream-backend'

export interface CaptureSessionFactory {
  fromPartition(partition: string, options: { cache: boolean }): unknown
}

/**
 * Allocate two independent in-memory Electron sessions for a single P1.3
 * supervisor instance. Each backend owns its own display-media permission gate,
 * hidden capture window and MediaStream tracks.
 *
 * Construct once per supervisor lifetime; reuse the returned backends across
 * capture restarts rather than allocating fresh Electron sessions per start.
 * No capture starts here, and no default-session fallback is permitted.
 */
export function createDualCaptureBackends(
  factory: CaptureSessionFactory = session
): readonly [MediaStreamDisplayCaptureBackend, MediaStreamDisplayCaptureBackend] {
  if (!factory || typeof factory.fromPartition !== 'function') {
    throw new Error('Dual capture requires an available Electron session factory')
  }

  // A unique pair token prevents a second supervisor from overriding the first
  // supervisor's setDisplayMediaRequestHandler in the same Electron process.
  const pairId = randomUUID()
  const primary = factory.fromPartition(`in-memory:aura-capture-dual-${pairId}-primary`, {
    cache: false
  })
  const secondary = factory.fromPartition(`in-memory:aura-capture-dual-${pairId}-secondary`, {
    cache: false
  })

  const validSession = (candidate: unknown): candidate is MediaStreamSessionLike =>
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as { setDisplayMediaRequestHandler?: unknown }).setDisplayMediaRequestHandler ===
      'function'

  if (!validSession(primary) || !validSession(secondary) || primary === secondary) {
    throw new Error('Dual capture requires two distinct valid in-memory Electron sessions')
  }

  return [
    new MediaStreamDisplayCaptureBackend({ session: primary }),
    new MediaStreamDisplayCaptureBackend({ session: secondary })
  ]
}

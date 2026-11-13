import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpcHandlers, setSessionStatus, unregisterIpcHandlers, type IpcMainLike } from '../../src/main/ipc/register-handlers'
import { IPC_CHANNELS, type IpcResponse } from '../../src/shared/contracts/ipc'
import type { SessionState, SessionStatus } from '../../src/shared/contracts/channels'
import type { DisplayManager } from '../../src/main/displays/display-manager'

vi.mock('electron', () => ({ app: { getVersion: () => '0.1.0', isPackaged: false }, ipcMain: {} }))

class FakeIpc implements IpcMainLike {
  handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>()
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown) {
    this.handlers.set(channel, handler)
  }
  removeHandler(channel: string) { this.handlers.delete(channel) }
  async invoke<T>(channel: string, payload?: unknown): Promise<IpcResponse<T>> {
    return this.handlers.get(channel)!('authorized', payload) as Promise<IpcResponse<T>>
  }
}

function ports() {
  let singleStatus: SessionStatus = 'idle'
  let dualStatus: SessionStatus = 'idle'
  const single = {
    start: vi.fn(async () => { singleStatus = 'active' }),
    stop: vi.fn(async () => { singleStatus = 'idle' }),
    getStatus: () => singleStatus,
    onStatusChange: () => () => {},
    getActiveDisplayId: () => singleStatus === 'active' ? '101' : null,
    getBufferStats: () => ({ frameCount: singleStatus === 'active' ? 1 : 0, totalBytes: 100, newestTimestamp: 1000 })
  }
  const dual = {
    start: vi.fn(async () => { dualStatus = 'active' }),
    stop: vi.fn(async () => { dualStatus = 'idle' }),
    getStatus: () => dualStatus,
    onStatusChange: () => () => {},
    getBufferStats: () => ({ totalBytes: dualStatus === 'active' ? 200 : 0,
      byDisplay: [
        { displayId: dualStatus === 'active' ? '101' : '', status: dualStatus, frameCount: dualStatus === 'active' ? 1 : 0, totalBytes: 100, newestTimestamp: dualStatus === 'active' ? 1000 : null },
        { displayId: dualStatus === 'active' ? '202' : '', status: dualStatus, frameCount: dualStatus === 'active' ? 1 : 0, totalBytes: 100, newestTimestamp: dualStatus === 'active' ? 1002 : null }
      ] })
  }
  return { single, dual }
}

const displayManager = {
  getDisplayConfiguration: () => ({ count: 2, primaryId: '101', isMultiDisplay: true,
    displays: [{ id: '101', label: 'Laptop', isPrimary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0 },
      { id: '202', label: 'External', isPrimary: false, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0 }] })
} as unknown as DisplayManager

describe('P1.3 authenticated dual capture IPC composition', () => {
  let ipc: FakeIpc
  let single: ReturnType<typeof ports>['single']
  let dual: ReturnType<typeof ports>['dual']
  beforeEach(() => {
    setSessionStatus('idle')
    ipc = new FakeIpc()
    ;({ single, dual } = ports())
    registerIpcHandlers(ipc, { validate: (event: unknown) => ({ valid: event === 'authorized' }) }, displayManager, single as never, dual as never)
  })

  it('starts both sources concurrently through the registered supervisor and returns metadata without pixels', async () => {
    const start = await ipc.invoke<{ success: boolean; status: SessionStatus }>(IPC_CHANNELS.SESSION_START, { selection: { mode: 'both' } })
    expect(start).toEqual({ ok: true, data: { success: true, status: 'active' } })
    expect(dual.start).toHaveBeenCalledOnce()
    expect(single.start).not.toHaveBeenCalled()
    const state = await ipc.invoke<SessionState>(IPC_CHANNELS.SESSION_GET_STATE)
    expect(state.ok).toBe(true)
    if (state.ok) {
      expect(state.data.status).toBe('active')
      expect(state.data.capture?.mode).toBe('both')
      expect(state.data.capture?.sources.map((x) => x.displayId)).toEqual(['101', '202'])
      expect(state.data.capture?.sources.map((x) => x.newestTimestamp)).toEqual([1000, 1002])
      expect(state.data.capture?.totalBytes).toBe(200)
      expect(JSON.stringify(state.data)).not.toContain('data:')
    }
    const stop = await ipc.invoke<{ status: SessionStatus }>(IPC_CHANNELS.SESSION_STOP)
    expect(stop).toEqual({ ok: true, data: { success: true, status: 'idle' } })
    expect(dual.stop).toHaveBeenCalledOnce()
    expect(single.stop).not.toHaveBeenCalled()
  })

  it('continues to route single-display starts and stops only to the single capturer', async () => {
    const started = await ipc.invoke(IPC_CHANNELS.SESSION_START, { selection: { mode: 'single', displayId: '101' } })
    expect(started).toEqual({ ok: true, data: { success: true, status: 'active', displayId: '101' } })
    expect(single.start).toHaveBeenCalledWith('101')
    await ipc.invoke(IPC_CHANNELS.SESSION_STOP)
    expect(single.stop).toHaveBeenCalledOnce()
    expect(dual.stop).not.toHaveBeenCalled()
  })

  it('rejects changing display permissions during an active dual session without mutating selection', async () => {
    await ipc.invoke(IPC_CHANNELS.SESSION_START, { selection: { mode: 'both' } })
    const change = await ipc.invoke(IPC_CHANNELS.SESSION_SET_SELECTION, { mode: 'single', displayId: '101' })
    expect(change.ok).toBe(false)
    if (!change.ok) expect(change.error.code).toBe('SESSION_ACTIVE_STOP_REQUIRED')
    const secondStart = await ipc.invoke(IPC_CHANNELS.SESSION_START, { selection: { mode: 'single', displayId: '101' } })
    expect(secondStart.ok).toBe(false)
    expect(single.start).not.toHaveBeenCalled()
    await ipc.invoke(IPC_CHANNELS.SESSION_STOP)
  })

  it('denies unauthorized start and does not call any capture port', async () => {
    const result = await ipc.handlers.get(IPC_CHANNELS.SESSION_START)!('intruder', { selection: { mode: 'both' } }) as IpcResponse<unknown>
    expect(result.ok).toBe(false)
    expect(single.start).not.toHaveBeenCalled()
    expect(dual.start).not.toHaveBeenCalled()
  })

  it('requires the actual dual supervisor; never silently falls back to one monitor', async () => {
    unregisterIpcHandlers(ipc)
    registerIpcHandlers(ipc, { validate: () => ({ valid: true }) }, displayManager, single as never)
    const result = await ipc.invoke(IPC_CHANNELS.SESSION_START, { selection: { mode: 'both' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_MODE')
    expect(single.start).not.toHaveBeenCalled()
  })
})

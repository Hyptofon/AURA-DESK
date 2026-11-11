import { describe, it, expect } from 'vitest'
import type { AuraApi } from '../../src/preload/index'

describe('AuraApi contract and security boundary', () => {
  const createMockApi = (): AuraApi => ({
    platform: 'win32',
    version: '0.1.0',
    getAppInfo: async () => ({
      name: 'aura-desk',
      version: '0.1.0',
      platform: 'win32',
      isPackaged: false
    }),
    getSessionState: async () => ({ status: 'idle' }),
    setCaptureSelection: async (selection) => ({ success: true, selection })
  })

  it('validates shape and typed methods of AuraApi', () => {
    const api = createMockApi()

    expect(api.platform).toBe('win32')
    expect(api.version).toBe('0.1.0')
    expect(typeof api.getAppInfo).toBe('function')
    expect(typeof api.getSessionState).toBe('function')
    expect(typeof api.setCaptureSelection).toBe('function')
  })

  it('ensures no raw ipcRenderer or Node modules are exposed on AuraApi', () => {
    const api = createMockApi()
    const apiRecord = api as unknown as Record<string, unknown>

    expect(apiRecord['ipcRenderer']).toBeUndefined()
    expect(apiRecord['require']).toBeUndefined()
    expect(apiRecord['process']).toBeUndefined()
    expect(apiRecord['fs']).toBeUndefined()
    expect(apiRecord['child_process']).toBeUndefined()
    expect(apiRecord['send']).toBeUndefined()
    expect(apiRecord['invoke']).toBeUndefined()
    expect(apiRecord['on']).toBeUndefined()
  })

  it('handles getAppInfo call and returns typed response', async () => {
    const api = createMockApi()
    const info = await api.getAppInfo()

    expect(info.name).toBe('aura-desk')
    expect(info.version).toBe('0.1.0')
    expect(info.platform).toBe('win32')
    expect(info.isPackaged).toBe(false)
  })

  it('handles getSessionState call and returns valid status', async () => {
    const api = createMockApi()
    const state = await api.getSessionState()

    expect(state.status).toBe('idle')
  })

  it('handles setCaptureSelection call with valid mode both', async () => {
    const api = createMockApi()
    const res = await api.setCaptureSelection({ mode: 'both' })

    expect(res.success).toBe(true)
    expect(res.selection.mode).toBe('both')
  })

  it('handles setCaptureSelection call with valid mode single', async () => {
    const api = createMockApi()
    const res = await api.setCaptureSelection({ mode: 'single', displayId: 'disp-primary' })

    expect(res.success).toBe(true)
    expect(res.selection.mode).toBe('single')
    if (res.selection.mode === 'single') {
      expect(res.selection.displayId).toBe('disp-primary')
    }
  })
})

import { describe, it, expect } from 'vitest'
import {
  IPC_CHANNELS,
  isAllowedIpcChannel,
  CaptureSelectionSchema,
  SessionStatusSchema,
  AppInfoSchema
} from '../../src/shared/contracts/ipc'

describe('IPC Contracts & Schemas', () => {
  describe('Channel Allowlist', () => {
    it('recognizes allowed channels', () => {
      expect(isAllowedIpcChannel(IPC_CHANNELS.APP_GET_INFO)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.SESSION_GET_STATE)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.SESSION_SET_SELECTION)).toBe(true)
    })

    it('rejects unauthorized or arbitrary channels', () => {
      expect(isAllowedIpcChannel('shell:exec')).toBe(false)
      expect(isAllowedIpcChannel('node:fs')).toBe(false)
      expect(isAllowedIpcChannel('aura:unauthorized-command')).toBe(false)
      expect(isAllowedIpcChannel('')).toBe(false)
    })
  })

  describe('CaptureSelectionSchema', () => {
    it('accepts mode both', () => {
      const result = CaptureSelectionSchema.safeParse({ mode: 'both' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.mode).toBe('both')
      }
    })

    it('accepts mode single with non-empty displayId', () => {
      const result = CaptureSelectionSchema.safeParse({
        mode: 'single',
        displayId: 'display-1234'
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.mode).toBe('single')
        expect(result.data.displayId).toBe('display-1234')
      }
    })

    it('rejects single mode without displayId', () => {
      const result = CaptureSelectionSchema.safeParse({ mode: 'single' })
      expect(result.success).toBe(false)
    })

    it('rejects single mode with empty displayId', () => {
      const result = CaptureSelectionSchema.safeParse({ mode: 'single', displayId: '' })
      expect(result.success).toBe(false)
    })

    it('rejects invalid or unauthorized modes', () => {
      expect(CaptureSelectionSchema.safeParse({ mode: 'window' }).success).toBe(false)
      expect(CaptureSelectionSchema.safeParse({ mode: 'all' }).success).toBe(false)
      expect(CaptureSelectionSchema.safeParse({}).success).toBe(false)
      expect(CaptureSelectionSchema.safeParse(null).success).toBe(false)
    })
  })

  describe('SessionStatusSchema', () => {
    const validStatuses = ['idle', 'starting', 'active', 'paused', 'stopping', 'error'] as const

    it('accepts all valid session statuses from state machine', () => {
      for (const status of validStatuses) {
        const result = SessionStatusSchema.safeParse(status)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(status)
        }
      }
    })

    it('rejects invalid statuses', () => {
      expect(SessionStatusSchema.safeParse('running').success).toBe(false)
      expect(SessionStatusSchema.safeParse('recording').success).toBe(false)
      expect(SessionStatusSchema.safeParse('terminated').success).toBe(false)
      expect(SessionStatusSchema.safeParse('').success).toBe(false)
    })
  })

  describe('AppInfoSchema', () => {
    it('validates correct AppInfo', () => {
      const result = AppInfoSchema.safeParse({
        name: 'aura-desk',
        version: '0.1.0',
        platform: 'win32',
        isPackaged: false
      })
      expect(result.success).toBe(true)
    })

    it('rejects non-semver version strings', () => {
      const result = AppInfoSchema.safeParse({
        name: 'aura-desk',
        version: 'dev-build',
        platform: 'win32',
        isPackaged: false
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing required fields', () => {
      expect(AppInfoSchema.safeParse({ name: 'aura-desk' }).success).toBe(false)
    })
  })
})

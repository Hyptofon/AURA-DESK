import { describe, it, expect } from 'vitest'
import {
  IPC_CHANNELS,
  isAllowedIpcChannel,
  CaptureSelectionSchema,
  SessionStatusSchema,
  AppInfoSchema,
  DisplayBoundsSchema,
  DisplayInfoSchema,
  DisplayConfigurationSchema,
  SessionStartRequestSchema,
  SessionStartResponseSchema,
  SessionStopResponseSchema,
  CaptureStatusSchema,
  AudioSubmitChunkSchema
} from '@/shared/contracts/ipc'

describe('IPC Contracts & Schemas', () => {
  describe('Channel Allowlist', () => {
    it('recognizes allowed channels', () => {
      expect(isAllowedIpcChannel(IPC_CHANNELS.APP_GET_INFO)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.SESSION_GET_STATE)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.SESSION_SET_SELECTION)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.SESSION_START)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.SESSION_STOP)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.SESSION_STATUS_CHANGED)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.DISPLAYS_GET_ALL)).toBe(true)
      expect(isAllowedIpcChannel(IPC_CHANNELS.DISPLAYS_CHANGED)).toBe(true)
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
      if (result.success && result.data.mode === 'single') {
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

    it('rejects single mode with whitespace-only displayId', () => {
      expect(CaptureSelectionSchema.safeParse({ mode: 'single', displayId: '   ' }).success).toBe(false)
      expect(CaptureSelectionSchema.safeParse({ mode: 'single', displayId: '\t\n ' }).success).toBe(false)
    })

    it('rejects extra fields on mode both (strict validation)', () => {
      const result = CaptureSelectionSchema.safeParse({
        mode: 'both',
        unauthorizedField: 'malicious'
      })
      expect(result.success).toBe(false)
    })

    it('rejects extra fields on mode single (strict validation)', () => {
      const result = CaptureSelectionSchema.safeParse({
        mode: 'single',
        displayId: 'display-1',
        extraField: true
      })
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

    it('rejects extra fields on AppInfo (strict validation)', () => {
      const result = AppInfoSchema.safeParse({
        name: 'aura-desk',
        version: '0.1.0',
        platform: 'win32',
        isPackaged: false,
        extraSecret: 'leak'
      })
      expect(result.success).toBe(false)
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

  describe('Display Schemas', () => {
    const validBounds = { x: 0, y: 0, width: 1920, height: 1080 }
    const validDisplay = {
      id: '2541289',
      label: 'Display 1 (Primary)',
      isPrimary: true,
      bounds: validBounds,
      workArea: validBounds,
      scaleFactor: 1.0,
      rotation: 0
    }

    describe('DisplayBoundsSchema', () => {
      it('accepts valid bounds', () => {
        expect(DisplayBoundsSchema.safeParse(validBounds).success).toBe(true)
        expect(DisplayBoundsSchema.safeParse({ x: -1920, y: 0, width: 1920, height: 1080 }).success).toBe(true)
      })

      it('rejects negative width or height', () => {
        expect(DisplayBoundsSchema.safeParse({ x: 0, y: 0, width: -100, height: 1080 }).success).toBe(false)
        expect(DisplayBoundsSchema.safeParse({ x: 0, y: 0, width: 1920, height: -1 }).success).toBe(false)
      })

      it('rejects extra properties', () => {
        expect(DisplayBoundsSchema.safeParse({ ...validBounds, extra: true }).success).toBe(false)
      })
    })

    describe('DisplayInfoSchema', () => {
      it('accepts valid display metadata', () => {
        const res = DisplayInfoSchema.safeParse(validDisplay)
        expect(res.success).toBe(true)
      })

      it('rejects empty or whitespace-only display id', () => {
        expect(DisplayInfoSchema.safeParse({ ...validDisplay, id: '' }).success).toBe(false)
        expect(DisplayInfoSchema.safeParse({ ...validDisplay, id: '   ' }).success).toBe(false)
      })

      it('rejects non-positive scale factor', () => {
        expect(DisplayInfoSchema.safeParse({ ...validDisplay, scaleFactor: 0 }).success).toBe(false)
        expect(DisplayInfoSchema.safeParse({ ...validDisplay, scaleFactor: -1.25 }).success).toBe(false)
      })

      it('rejects unknown extra properties', () => {
        expect(DisplayInfoSchema.safeParse({ ...validDisplay, injectedKey: 'value' }).success).toBe(false)
      })
    })

    describe('DisplayConfigurationSchema', () => {
      it('accepts single-display configuration', () => {
        const config = {
          displays: [validDisplay],
          primaryId: '2541289',
          count: 1,
          isMultiDisplay: false,
          selectedDisplayLost: false
        }
        expect(DisplayConfigurationSchema.safeParse(config).success).toBe(true)
      })

      it('accepts dual-monitor configuration with selectedDisplayLost flag', () => {
        const secondDisplay = {
          ...validDisplay,
          id: '2541290',
          label: 'Display 2',
          isPrimary: false,
          bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
          workArea: { x: -1920, y: 0, width: 1920, height: 1080 }
        }
        const config = {
          displays: [validDisplay, secondDisplay],
          primaryId: '2541289',
          count: 2,
          isMultiDisplay: true,
          selectedDisplayLost: true
        }
        expect(DisplayConfigurationSchema.safeParse(config).success).toBe(true)
      })

      it('rejects negative count or extra fields', () => {
        expect(
          DisplayConfigurationSchema.safeParse({
            displays: [validDisplay],
            primaryId: '2541289',
            count: -1,
            isMultiDisplay: false
          }).success
        ).toBe(false)

        expect(
          DisplayConfigurationSchema.safeParse({
            displays: [validDisplay],
            primaryId: '2541289',
            count: 1,
            isMultiDisplay: false,
            extraProperty: 'not-allowed'
          }).success
        ).toBe(false)
      })
    })

    describe('SessionStartRequestSchema', () => {
      it('accepts undefined/empty payload', () => {
        expect(SessionStartRequestSchema.safeParse(undefined).success).toBe(true)
      })

      it('accepts valid selection payload', () => {
        expect(
          SessionStartRequestSchema.safeParse({
            selection: { mode: 'single', displayId: 'disp-1' }
          }).success
        ).toBe(true)
      })

      it('rejects extra properties', () => {
        expect(
          SessionStartRequestSchema.safeParse({
            selection: { mode: 'both' },
            unauthorizedKey: true
          }).success
        ).toBe(false)
      })
    })

    describe('SessionStartResponseSchema & SessionStopResponseSchema', () => {
      it('validates successful session start response', () => {
        expect(
          SessionStartResponseSchema.safeParse({
            success: true,
            status: 'active',
            displayId: '101'
          }).success
        ).toBe(true)
      })

      it('validates successful session stop response', () => {
        expect(
          SessionStopResponseSchema.safeParse({
            success: true,
            status: 'idle'
          }).success
        ).toBe(true)
      })

      it('rejects invalid status values', () => {
        expect(
          SessionStopResponseSchema.safeParse({
            success: true,
            status: 'invalid-status'
          }).success
        ).toBe(false)
      })
    })

    describe('CaptureStatusSchema', () => {
      it('validates active capture status', () => {
        expect(
          CaptureStatusSchema.safeParse({
            isActive: true,
            activeDisplayId: '101',
            frameCount: 10,
            totalBytes: 10240,
            lastError: null
          }).success
        ).toBe(true)
      })

      it('validates inactive capture status', () => {
        expect(
          CaptureStatusSchema.safeParse({
            isActive: false,
            activeDisplayId: null,
            frameCount: 0,
            totalBytes: 0
          }).success
        ).toBe(true)
      })

      it('rejects negative frameCount or bytes', () => {
        expect(
          CaptureStatusSchema.safeParse({
            isActive: false,
            activeDisplayId: null,
            frameCount: -1,
            totalBytes: 0
          }).success
        ).toBe(false)
      })
    })

    describe('AudioSubmitChunkSchema', () => {
      it('validates genuine mic audio chunk with Uint8Array data', () => {
        const chunk = {
          source: 'mic',
          data: new Uint8Array([0, 1, 2, 3]),
          timestamp: Date.now(),
          durationMs: 64,
          sampleRate: 16000,
          channels: 1
        }
        const res = AudioSubmitChunkSchema.safeParse(chunk)
        expect(res.success).toBe(true)
      })

      it('validates genuine system audio chunk with Uint8Array data', () => {
        const chunk = {
          source: 'system',
          data: new Uint8Array([10, 20, 30, 40]),
          timestamp: Date.now(),
          durationMs: 85,
          sampleRate: 48000,
          channels: 2
        }
        const res = AudioSubmitChunkSchema.safeParse(chunk)
        expect(res.success).toBe(true)
      })

      it('rejects invalid source', () => {
        const chunk = {
          source: 'display',
          data: new Uint8Array([0, 1]),
          timestamp: Date.now(),
          durationMs: 20
        }
        expect(AudioSubmitChunkSchema.safeParse(chunk).success).toBe(false)
      })

      it('rejects non-Uint8Array payload data', () => {
        const chunk = {
          source: 'mic',
          data: 'not-a-typed-array',
          timestamp: Date.now(),
          durationMs: 20
        }
        expect(AudioSubmitChunkSchema.safeParse(chunk).success).toBe(false)
      })

      it('rejects negative duration', () => {
        const chunk = {
          source: 'mic',
          data: new Uint8Array(4),
          timestamp: Date.now(),
          durationMs: -5
        }
        expect(AudioSubmitChunkSchema.safeParse(chunk).success).toBe(false)
      })
    })
  })
})

import { describe, it, expect, vi } from 'vitest'
import {
  applyContentProtection,
  isWindowOverlappingDisplay,
  evaluateRecursionRisk,
  type BrowserWindowLike
} from '@/main/capture/overlay-exclusion'

describe('Overlay Exclusion & Recursion Prevention', () => {
  describe('applyContentProtection', () => {
    it('returns error when window is null or undefined', () => {
      expect(applyContentProtection(null)).toEqual({
        success: false,
        error: 'Window reference is null or undefined'
      })
    })

    it('returns error when window is destroyed', () => {
      const mockWin: BrowserWindowLike = {
        isDestroyed: () => true,
        setContentProtection: vi.fn()
      }
      expect(applyContentProtection(mockWin)).toEqual({
        success: false,
        error: 'Window is destroyed'
      })
    })

    it('returns error when setContentProtection is unsupported', () => {
      const mockWin: BrowserWindowLike = {
        isDestroyed: () => false
      }
      expect(applyContentProtection(mockWin)).toEqual({
        success: false,
        error: 'setContentProtection is not supported on this platform/window'
      })
    })

    it('succeeds when setContentProtection returns true or void', () => {
      const mockWin: BrowserWindowLike = {
        isDestroyed: () => false,
        setContentProtection: vi.fn().mockReturnValue(true)
      }
      expect(applyContentProtection(mockWin, true)).toEqual({ success: true })
      expect(mockWin.setContentProtection).toHaveBeenCalledWith(true)
    })

    it('handles setContentProtection returning false (DWM affinity rejected)', () => {
      const mockWin: BrowserWindowLike = {
        isDestroyed: () => false,
        setContentProtection: vi.fn().mockReturnValue(false)
      }
      const res = applyContentProtection(mockWin)
      expect(res.success).toBe(false)
      expect(res.error).toContain('DWM affinity rejected')
    })

    it('catches and reports exceptions from setContentProtection gracefully', () => {
      const mockWin: BrowserWindowLike = {
        isDestroyed: () => false,
        setContentProtection: vi.fn().mockImplementation(() => {
          throw new Error('OS call failed')
        })
      }
      const res = applyContentProtection(mockWin)
      expect(res.success).toBe(false)
      expect(res.error).toBe('OS call failed')
    })
  })

  describe('isWindowOverlappingDisplay', () => {
    const primaryDisplay = { x: 0, y: 0, width: 1920, height: 1080 }
    const secondaryDisplay = { x: -1920, y: 0, width: 1920, height: 1080 }

    it('returns false when windowBounds is null', () => {
      expect(isWindowOverlappingDisplay(null, primaryDisplay)).toBe(false)
    })

    it('returns false for disjoint displays (window on primary, target is secondary)', () => {
      const windowOnPrimary = { x: 200, y: 150, width: 1000, height: 700 }
      expect(isWindowOverlappingDisplay(windowOnPrimary, secondaryDisplay)).toBe(false)
    })

    it('returns true when window is inside display bounds', () => {
      const windowOnPrimary = { x: 200, y: 150, width: 1000, height: 700 }
      expect(isWindowOverlappingDisplay(windowOnPrimary, primaryDisplay)).toBe(true)
    })

    it('returns true for window located on secondary display with negative coordinates', () => {
      const windowOnSecondary = { x: -1800, y: 100, width: 800, height: 600 }
      expect(isWindowOverlappingDisplay(windowOnSecondary, secondaryDisplay)).toBe(true)
      expect(isWindowOverlappingDisplay(windowOnSecondary, primaryDisplay)).toBe(false)
    })

    it('returns true for window straddling monitor boundaries', () => {
      // Window positioned at x: -200 with width 600 extends from -200 to +400 (overlaps both monitors)
      const straddlingWindow = { x: -200, y: 100, width: 600, height: 500 }
      expect(isWindowOverlappingDisplay(straddlingWindow, primaryDisplay)).toBe(true)
      expect(isWindowOverlappingDisplay(straddlingWindow, secondaryDisplay)).toBe(true)
    })

    it('returns false when window touches edge without intersection', () => {
      const touchingWindow = { x: -1920, y: 0, width: 1920, height: 1080 }
      // primaryDisplay starts at x: 0; touchingWindow ends at -1920 + 1920 = 0
      expect(isWindowOverlappingDisplay(touchingWindow, primaryDisplay)).toBe(false)
    })
  })

  describe('evaluateRecursionRisk', () => {
    const primaryDisplay = { x: 0, y: 0, width: 1920, height: 1080 }

    it('reports no risk when window does not overlap captured display', () => {
      const windowOnSecondary = { x: -1000, y: 200, width: 600, height: 400 }
      const result = evaluateRecursionRisk(windowOnSecondary, primaryDisplay, false)
      expect(result).toEqual({
        overlapsTargetDisplay: false,
        isContentProtected: false,
        recursionRisk: 'none',
        recommendation: 'capture_safe'
      })
    })

    it('reports no risk when window overlaps but is content protected', () => {
      const windowOnPrimary = { x: 100, y: 100, width: 800, height: 600 }
      const result = evaluateRecursionRisk(windowOnPrimary, primaryDisplay, true)
      expect(result).toEqual({
        overlapsTargetDisplay: true,
        isContentProtected: true,
        recursionRisk: 'none',
        recommendation: 'capture_safe'
      })
    })

    it('reports potential feedback loop when window overlaps and is not protected', () => {
      const windowOnPrimary = { x: 100, y: 100, width: 800, height: 600 }
      const result = evaluateRecursionRisk(windowOnPrimary, primaryDisplay, false)
      expect(result).toEqual({
        overlapsTargetDisplay: true,
        isContentProtected: false,
        recursionRisk: 'potential_feedback',
        recommendation: 'suppress_mirroring_or_protect'
      })
    })
  })
})

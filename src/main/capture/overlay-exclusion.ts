import type { DisplayBounds } from '../../shared/contracts/channels'

export interface BrowserWindowLike {
  isDestroyed?(): boolean
  setContentProtection?(enable: boolean): boolean | void
  getBounds?(): DisplayBounds
}

export interface ContentProtectionResult {
  success: boolean
  error?: string
}

export interface RecursionCheckResult {
  overlapsTargetDisplay: boolean
  isContentProtected: boolean
  recursionRisk: 'none' | 'potential_feedback'
  recommendation: 'capture_safe' | 'suppress_mirroring_or_protect'
}

/**
 * Applies OS-level content protection (SetWindowDisplayAffinity on Windows)
 * to prevent the window/overlay from being captured by screen recording or capturers.
 * Fails safely without throwing if the window is destroyed or the API is unsupported.
 */
export function applyContentProtection(
  window: BrowserWindowLike | null | undefined,
  enable = true
): ContentProtectionResult {
  if (!window) {
    return { success: false, error: 'Window reference is null or undefined' }
  }

  if (typeof window.isDestroyed === 'function' && window.isDestroyed()) {
    return { success: false, error: 'Window is destroyed' }
  }

  if (typeof window.setContentProtection !== 'function') {
    return { success: false, error: 'setContentProtection is not supported on this platform/window' }
  }

  try {
    const result = window.setContentProtection(enable)
    // If the method returns a boolean, respect it; otherwise void implies successful call
    if (typeof result === 'boolean' && !result) {
      return { success: false, error: 'setContentProtection returned false (DWM affinity rejected)' }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Checks whether a window rectangle overlaps with a target display's bounds.
 * Properly accounts for negative monitor coordinates (e.g. secondary displays at x: -1920).
 */
export function isWindowOverlappingDisplay(
  windowBounds: DisplayBounds | null | undefined,
  displayBounds: DisplayBounds
): boolean {
  if (!windowBounds) {
    return false
  }

  // Two rectangles do not intersect if one is strictly to the left, right, above, or below the other
  const isSeparated =
    windowBounds.x + windowBounds.width <= displayBounds.x ||
    windowBounds.x >= displayBounds.x + displayBounds.width ||
    windowBounds.y + windowBounds.height <= displayBounds.y ||
    windowBounds.y >= displayBounds.y + displayBounds.height

  return !isSeparated
}

/**
 * Evaluates whether capturing the target display creates a screen recursion / feedback risk
 * from the application's own window or overlay.
 */
export function evaluateRecursionRisk(
  windowBounds: DisplayBounds | null | undefined,
  targetDisplayBounds: DisplayBounds,
  isContentProtected: boolean
): RecursionCheckResult {
  const overlaps = isWindowOverlappingDisplay(windowBounds, targetDisplayBounds)

  if (!overlaps) {
    return {
      overlapsTargetDisplay: false,
      isContentProtected,
      recursionRisk: 'none',
      recommendation: 'capture_safe'
    }
  }

  // Window overlaps display: if content protection is active, DWM excludes it
  if (isContentProtected) {
    return {
      overlapsTargetDisplay: true,
      isContentProtected: true,
      recursionRisk: 'none',
      recommendation: 'capture_safe'
    }
  }

  // Overlaps and content protection is unavailable/inactive -> potential screen feedback loop
  return {
    overlapsTargetDisplay: true,
    isContentProtected: false,
    recursionRisk: 'potential_feedback',
    recommendation: 'suppress_mirroring_or_protect'
  }
}

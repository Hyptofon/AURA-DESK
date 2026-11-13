import type { DisplayInfo } from '@/shared/contracts/channels'
import type { WindowsDisplayDevice } from './windows-display-query'
import { matchesDisplayBounds } from './dpi-bounds'

export interface DesktopCapturerSourceLike {
  id: string
  name: string
  display_id?: string
}

export type SourceResolutionStrategy = 'exact_display_id_match' | 'windows_device_bounds_match'

export interface ResolvedSourceResult {
  sourceId: string
  sourceName: string
  displayId: string
  strategy: SourceResolutionStrategy
}

/**
 * Resolves a DesktopCapturerSource for an explicit DisplayInfo.
 *
 * Strategy 1 (Preferred / Cross-platform):
 * Matches DesktopCapturerSource.display_id against targetDisplayId when display_id is non-empty.
 *
 * Strategy 2 (Windows Fallback ONLY when reliable direct display_id mapping is unavailable):
 * Used strictly when NO enumerated source provides a non-empty display_id (e.g. Electron/Chromium
 * #42747 under Windows GDI fallback). Matches unique targetDisplay.bounds against OS-enumerated
 * WindowsDisplayDevice physical coordinates and maps candidate `\\.\DISPLAY<N>` (`N - 1`) to
 * source ID `"screen:<index>:0"`.
 *
 * Working Assumption (NOT universally proven): Assumes `DISPLAY<N>` numbering corresponds 1:1
 * to WebRTC's 0-based `screen:<index>:0` index on the host. This correspondence is an observed
 * heuristic on tested setups rather than a universal OS invariant and must be verified on target
 * hardware by physical test-pattern isolation checks.
 *
 * Invariants:
 * - Strategy 2 never runs when any source provides a non-empty direct display_id.
 * - Unsafe fallbacks (arbitrary array indexing, name/label-only matching, synthetic pattern guessing,
 *   or silent primary fallback) are strictly prohibited to prevent cross-display capture leakage.
 * - Fails closed if the display is not found, sources are empty, bounds are invalid or shared by
 *   multiple displays, coordinates are ambiguous, or mapping cannot be matched uniquely.
 */
export function resolveSourceForDisplay(
  targetDisplayId: string,
  allDisplays: DisplayInfo[],
  sources: DesktopCapturerSourceLike[],
  windowsDevices?: WindowsDisplayDevice[]
): ResolvedSourceResult {
  if (!targetDisplayId || typeof targetDisplayId !== 'string') {
    throw new Error('Cannot resolve capture source: targetDisplayId must be a non-empty string')
  }

  const targetDisplay = allDisplays.find((d) => d.id === targetDisplayId)
  if (!targetDisplay) {
    throw new Error(
      `Cannot resolve capture source: target display "${targetDisplayId}" not found in enumerated displays`
    )
  }

  if (!sources || sources.length === 0) {
    throw new Error('Cannot resolve capture source: no desktopCapturer sources available')
  }

  // Strategy 1: Exact display_id match when present and non-empty
  const displayIdMatches = sources.filter(
    (s) =>
      s.display_id !== undefined &&
      s.display_id !== null &&
      s.display_id.trim() !== '' &&
      String(s.display_id).trim() === targetDisplayId
  )

  if (displayIdMatches.length === 1) {
    return {
      sourceId: displayIdMatches[0].id,
      sourceName: displayIdMatches[0].name,
      displayId: targetDisplayId,
      strategy: 'exact_display_id_match'
    }
  }

  if (displayIdMatches.length > 1) {
    throw new Error(
      `Ambiguous capture source: multiple sources matched display_id "${targetDisplayId}"`
    )
  }

  const hasReliableDisplayIds = sources.some(
    (s) => s.display_id !== undefined && s.display_id !== null && String(s.display_id).trim() !== ''
  )

  // Strategy 2: Windows display device coordinate matching ONLY when reliable direct display_id mapping is unavailable
  if (!hasReliableDisplayIds && windowsDevices && windowsDevices.length > 0) {
    if (targetDisplay.bounds.width <= 0 || targetDisplay.bounds.height <= 0) {
      throw new Error(
        `Cannot resolve capture source: target display "${targetDisplayId}" has invalid bounds (${targetDisplay.bounds.width}x${targetDisplay.bounds.height})`
      )
    }

    const displaysWithSameBounds = allDisplays.filter((d) =>
      matchesDisplayBounds(d.bounds, targetDisplay)
    )

    if (displaysWithSameBounds.length > 1) {
      throw new Error(
        `Ambiguous capture source: multiple enumerated displays share coordinates (${targetDisplay.bounds.x}, ${targetDisplay.bounds.y}, ${targetDisplay.bounds.width}x${targetDisplay.bounds.height}) for display "${targetDisplayId}"`
      )
    }

    const matchedDevices = windowsDevices.filter((wd) =>
      matchesDisplayBounds(wd.bounds, targetDisplay)
    )

    if (matchedDevices.length > 1) {
      throw new Error(
        `Ambiguous capture source: multiple Windows display devices matched coordinates (${targetDisplay.bounds.x}, ${targetDisplay.bounds.y}, ${targetDisplay.bounds.width}x${targetDisplay.bounds.height}) for display "${targetDisplayId}"`
      )
    }

    if (matchedDevices.length === 1) {
      const matchedDevice = matchedDevices[0]
      if (!Number.isInteger(matchedDevice.displayIndex) || matchedDevice.displayIndex < 0) {
        throw new Error(
          `Cannot resolve capture source for display "${targetDisplayId}": invalid Windows device index (${matchedDevice.displayIndex})`
        )
      }

      const expectedSourceId = `screen:${matchedDevice.displayIndex}:0`
      const matchingSources = sources.filter((s) => s.id === expectedSourceId)
      if (matchingSources.length === 1) {
        return {
          sourceId: matchingSources[0].id,
          sourceName: matchingSources[0].name,
          displayId: targetDisplayId,
          strategy: 'windows_device_bounds_match'
        }
      }

      if (matchingSources.length > 1) {
        throw new Error(
          `Ambiguous capture source: multiple desktopCapturer sources matched source ID "${expectedSourceId}" for display "${targetDisplayId}"`
        )
      }

      throw new Error(
        `Cannot resolve capture source for display "${targetDisplayId}": matched Windows device "${matchedDevice.deviceName}" (source ID "${expectedSourceId}") not found in desktopCapturer sources`
      )
    }
  }

  // Fail-closed: No fallback to index, label or screen:index:0 pattern guessing
  throw new Error(
    `Cannot resolve capture source for display "${targetDisplayId}": no desktopCapturer source with matching display_id found and no matching Windows display device coordinates found (unsafe index/name fallbacks are prohibited)`
  )
}

import type { DisplayInfo } from '../../shared/contracts/channels'
import type { WindowsDisplayDevice } from './windows-display-query'

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
 * Strategy 2 (Windows Fallback when display_id is empty due to Chromium/Electron #42747):
 * Matches targetDisplay.bounds against OS-enumerated WindowsDisplayDevice physical coordinates.
 * Relies on the deterministic 1:1 hardware coordinate mapping between Windows display devices
 * (\\.\DISPLAY<N+1>, index N) and WebRTC capturer source ID ("screen:N:0").
 *
 * Invariants:
 * Unsafe fallbacks (arbitrary array indexing, name/label-only matching, synthetic pattern guessing,
 * or silent primary fallback) are strictly prohibited to prevent cross-display capture leakage.
 *
 * Fails closed if the display is not found, sources are empty, coordinates are ambiguous,
 * duplicates exist, or mapping cannot be proven.
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

  // Strategy 2: Windows display device physical coordinate matching when sources have empty display_id
  if (windowsDevices && windowsDevices.length > 0) {
    const matchedDevices = windowsDevices.filter(
      (wd) =>
        wd.bounds.x === targetDisplay.bounds.x &&
        wd.bounds.y === targetDisplay.bounds.y &&
        wd.bounds.width === targetDisplay.bounds.width &&
        wd.bounds.height === targetDisplay.bounds.height
    )

    if (matchedDevices.length > 1) {
      throw new Error(
        `Ambiguous capture source: multiple Windows display devices matched coordinates (${targetDisplay.bounds.x}, ${targetDisplay.bounds.y}, ${targetDisplay.bounds.width}x${targetDisplay.bounds.height}) for display "${targetDisplayId}"`
      )
    }

    if (matchedDevices.length === 1) {
      const matchedDevice = matchedDevices[0]
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

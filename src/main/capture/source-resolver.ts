import type { DisplayInfo } from '../../shared/contracts/channels'

export interface DesktopCapturerSourceLike {
  id: string
  name: string
  display_id?: string
}

export type SourceResolutionStrategy = 'exact_display_id_match'

export interface ResolvedSourceResult {
  sourceId: string
  sourceName: string
  displayId: string
  strategy: SourceResolutionStrategy
}

/**
 * Resolves a DesktopCapturerSource for an explicit DisplayInfo.
 * Strictly requires an exact match on DesktopCapturerSource.display_id.
 * Unsafe fallbacks (screen index, name/label matching, pattern guessing) are strictly forbidden
 * to prevent cross-display capture leakage.
 *
 * Fails closed if the display is not found, sources are empty, display_id is missing,
 * duplicates exist, or mapping is ambiguous.
 */
export function resolveSourceForDisplay(
  targetDisplayId: string,
  allDisplays: DisplayInfo[],
  sources: DesktopCapturerSourceLike[]
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

  // Exact display_id match only
  const displayIdMatches = sources.filter(
    (s) =>
      s.display_id !== undefined &&
      s.display_id !== null &&
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

  // Fail-closed: No fallback to index, label or screen:index:0 pattern
  throw new Error(
    `Cannot resolve capture source for display "${targetDisplayId}": no desktopCapturer source with matching display_id found (unsafe index/name fallbacks are prohibited)`
  )
}

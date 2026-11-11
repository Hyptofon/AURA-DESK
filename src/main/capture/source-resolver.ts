import type { DisplayInfo } from '../../shared/contracts/channels'

export interface DesktopCapturerSourceLike {
  id: string
  name: string
  display_id?: string
}

export type SourceResolutionStrategy =
  | 'display_id_match'
  | 'id_pattern_match'
  | 'screen_index_match'
  | 'label_match'

export interface ResolvedSourceResult {
  sourceId: string
  sourceName: string
  displayId: string
  strategy: SourceResolutionStrategy
}

/**
 * Resolves a DesktopCapturerSource for an explicit DisplayInfo.
 * Evaluates candidates using prioritized matching strategies.
 * Fails closed if display is not found, sources are empty, or matches are ambiguous.
 */
export function resolveSourceForDisplay(
  targetDisplayId: string,
  allDisplays: DisplayInfo[],
  sources: DesktopCapturerSourceLike[]
): ResolvedSourceResult {
  const targetDisplay = allDisplays.find((d) => d.id === targetDisplayId)
  if (!targetDisplay) {
    throw new Error(
      `Cannot resolve capture source: target display "${targetDisplayId}" not found in enumerated displays`
    )
  }

  if (!sources || sources.length === 0) {
    throw new Error('Cannot resolve capture source: no desktopCapturer sources available')
  }

  // Strategy 1: Exact display_id match
  const displayIdMatches = sources.filter(
    (s) => s.display_id !== undefined && String(s.display_id) === targetDisplayId
  )
  if (displayIdMatches.length === 1) {
    return {
      sourceId: displayIdMatches[0].id,
      sourceName: displayIdMatches[0].name,
      displayId: targetDisplayId,
      strategy: 'display_id_match'
    }
  }
  if (displayIdMatches.length > 1) {
    throw new Error(
      `Ambiguous capture source: multiple sources matched display_id "${targetDisplayId}"`
    )
  }

  // Strategy 2: ID pattern match (source.id === targetDisplayId or `screen:${targetDisplayId}:0`)
  const patternMatches = sources.filter(
    (s) => s.id === targetDisplayId || s.id === `screen:${targetDisplayId}:0`
  )
  if (patternMatches.length === 1) {
    return {
      sourceId: patternMatches[0].id,
      sourceName: patternMatches[0].name,
      displayId: targetDisplayId,
      strategy: 'id_pattern_match'
    }
  }

  // Strategy 3: Screen index match (source.id === `screen:${targetIndex}:0`)
  const targetIndex = allDisplays.findIndex((d) => d.id === targetDisplayId)
  if (targetIndex >= 0) {
    const indexMatches = sources.filter((s) => s.id === `screen:${targetIndex}:0`)
    if (indexMatches.length === 1) {
      return {
        sourceId: indexMatches[0].id,
        sourceName: indexMatches[0].name,
        displayId: targetDisplayId,
        strategy: 'screen_index_match'
      }
    }
  }

  // Strategy 4: Label / Name match
  if (targetDisplay.label && targetDisplay.label.trim()) {
    const targetLabel = targetDisplay.label.trim().toLowerCase()
    const nameMatches = sources.filter(
      (s) => s.name && s.name.trim().toLowerCase() === targetLabel
    )
    if (nameMatches.length === 1) {
      return {
        sourceId: nameMatches[0].id,
        sourceName: nameMatches[0].name,
        displayId: targetDisplayId,
        strategy: 'label_match'
      }
    }
  }

  // Fail-closed
  throw new Error(
    `Cannot resolve capture source for display "${targetDisplayId}": no matching desktopCapturer source found`
  )
}

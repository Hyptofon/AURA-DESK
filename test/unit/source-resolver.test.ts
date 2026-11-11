import { describe, it, expect } from 'vitest'
import {
  resolveSourceForDisplay,
  type DesktopCapturerSourceLike
} from '../../src/main/capture/source-resolver'
import type { DisplayInfo } from '../../src/shared/contracts/channels'

describe('Display Source Resolver', () => {
  const mockDisplays: DisplayInfo[] = [
    {
      id: '101',
      label: 'Dell Primary',
      isPrimary: true,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1.0,
      rotation: 0
    },
    {
      id: '202',
      label: 'Samsung Secondary',
      isPrimary: false,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1.0,
      rotation: 0
    }
  ]

  it('resolves source via exact display_id match', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1', display_id: '101' },
      { id: 'screen:1:0', name: 'Screen 2', display_id: '202' }
    ]

    const result = resolveSourceForDisplay('202', mockDisplays, sources)

    expect(result.sourceId).toBe('screen:1:0')
    expect(result.displayId).toBe('202')
    expect(result.strategy).toBe('display_id_match')
  })

  it('fails closed when multiple sources have identical display_id (ambiguous)', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1A', display_id: '101' },
      { id: 'screen:1:0', name: 'Screen 1B', display_id: '101' }
    ]

    expect(() => resolveSourceForDisplay('101', mockDisplays, sources)).toThrow(
      /Ambiguous capture source/
    )
  })

  it('resolves source via ID pattern match when display_id is not set on source', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:101:0', name: 'Screen A' },
      { id: 'screen:202:0', name: 'Screen B' }
    ]

    const result = resolveSourceForDisplay('101', mockDisplays, sources)

    expect(result.sourceId).toBe('screen:101:0')
    expect(result.strategy).toBe('id_pattern_match')
  })

  it('resolves source via screen index match as fallback', () => {
    // 101 is at index 0, 202 is at index 1
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Main Display' },
      { id: 'screen:1:0', name: 'Second Display' }
    ]

    const result = resolveSourceForDisplay('202', mockDisplays, sources)

    expect(result.sourceId).toBe('screen:1:0')
    expect(result.strategy).toBe('screen_index_match')
  })

  it('resolves source via label/name match when IDs do not align', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'src-alpha', name: 'dell primary' },
      { id: 'src-beta', name: 'samsung secondary' }
    ]

    const result = resolveSourceForDisplay('202', mockDisplays, sources)

    expect(result.sourceId).toBe('src-beta')
    expect(result.strategy).toBe('label_match')
  })

  it('throws error when target displayId is not in enumerated displays', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1', display_id: '101' }
    ]

    expect(() => resolveSourceForDisplay('999', mockDisplays, sources)).toThrow(
      /target display "999" not found/
    )
  })

  it('throws error when sources array is empty', () => {
    expect(() => resolveSourceForDisplay('101', mockDisplays, [])).toThrow(
      /no desktopCapturer sources available/
    )
  })

  it('fails closed when no strategy can unambiguously resolve the display', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'window:999:0', name: 'Not A Screen' }
    ]

    expect(() => resolveSourceForDisplay('101', mockDisplays, sources)).toThrow(
      /no matching desktopCapturer source found/
    )
  })
})

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

  it('resolves source via valid exact display_id mapping', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1', display_id: '101' },
      { id: 'screen:1:0', name: 'Screen 2', display_id: '202' }
    ]

    const result = resolveSourceForDisplay('202', mockDisplays, sources)

    expect(result.sourceId).toBe('screen:1:0')
    expect(result.sourceName).toBe('Screen 2')
    expect(result.displayId).toBe('202')
    expect(result.strategy).toBe('exact_display_id_match')
  })

  it('correctly maps target display even when sources are reordered', () => {
    // Reverse order: source for 202 is first, source for 101 is second
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:1:0', name: 'Screen 2', display_id: '202' },
      { id: 'screen:0:0', name: 'Screen 1', display_id: '101' }
    ]

    const result = resolveSourceForDisplay('101', mockDisplays, sources)
    expect(result.sourceId).toBe('screen:0:0')
    expect(result.displayId).toBe('101')
    expect(result.strategy).toBe('exact_display_id_match')
  })

  it('fails closed when sources have missing display_id and rejects index/name fallback', () => {
    // Sources have similar names and matching screen:indices, but missing display_id
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Dell Primary' },
      { id: 'screen:1:0', name: 'Samsung Secondary' }
    ]

    expect(() => resolveSourceForDisplay('101', mockDisplays, sources)).toThrow(
      /no desktopCapturer source with matching display_id found/
    )
  })

  it('fails closed when source has empty string or whitespace display_id', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1', display_id: '' },
      { id: 'screen:1:0', name: 'Screen 2', display_id: '   ' }
    ]

    expect(() => resolveSourceForDisplay('101', mockDisplays, sources)).toThrow(
      /no desktopCapturer source with matching display_id found/
    )
  })

  it('distinguishes different display IDs with identical or similar names', () => {
    // Both screens called "Generic PnP Monitor"
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Generic PnP Monitor', display_id: '101' },
      { id: 'screen:1:0', name: 'Generic PnP Monitor', display_id: '202' }
    ]

    const result101 = resolveSourceForDisplay('101', mockDisplays, sources)
    expect(result101.sourceId).toBe('screen:0:0')
    expect(result101.displayId).toBe('101')

    const result202 = resolveSourceForDisplay('202', mockDisplays, sources)
    expect(result202.sourceId).toBe('screen:1:0')
    expect(result202.displayId).toBe('202')
  })

  it('fails closed when multiple sources have duplicate display_id (ambiguous)', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1A', display_id: '101' },
      { id: 'screen:1:0', name: 'Screen 1B', display_id: '101' }
    ]

    expect(() => resolveSourceForDisplay('101', mockDisplays, sources)).toThrow(
      /Ambiguous capture source: multiple sources matched display_id "101"/
    )
  })

  it('throws error when target display is disconnected/not in enumerated displays', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1', display_id: '101' }
    ]

    // Display '999' is not connected
    expect(() => resolveSourceForDisplay('999', mockDisplays, sources)).toThrow(
      /target display "999" not found in enumerated displays/
    )
  })

  it('throws error when sources array is empty', () => {
    expect(() => resolveSourceForDisplay('101', mockDisplays, [])).toThrow(
      /no desktopCapturer sources available/
    )
  })

  it('rejects invalid or empty targetDisplayId arguments', () => {
    const sources: DesktopCapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1', display_id: '101' }
    ]

    expect(() => resolveSourceForDisplay('', mockDisplays, sources)).toThrow(
      /targetDisplayId must be a non-empty string/
    )
  })
})

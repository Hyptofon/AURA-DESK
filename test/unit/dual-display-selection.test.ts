import { describe, expect, it } from 'vitest'
import { selectDualDisplayIds } from '@/main/capture/dual-display-selection'
import type { DisplayConfiguration, DisplayInfo } from '@/shared/contracts/channels'

const display = (id: string, isPrimary: boolean, x: number): DisplayInfo => ({
  id,
  label: `Display ${id}`,
  isPrimary,
  bounds: { x, y: 0, width: 1920, height: 1080 },
  workArea: { x, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  rotation: 0
})

const configuration = (displays: DisplayInfo[]): DisplayConfiguration => ({
  displays,
  count: displays.length,
  primaryId: displays.find((item) => item.isPrimary)?.id ?? '',
  isMultiDisplay: displays.length > 1
})

const laptop = (): DisplayInfo => display('laptop', true, 0)
const external = (): DisplayInfo => display('external', false, -1920)

describe('selectDualDisplayIds', () => {
  it('selects both distinct displays in primary-first order, regardless of enumeration order', () => {
    expect(selectDualDisplayIds(configuration([external(), laptop()]))).toEqual([
      'laptop',
      'external'
    ])
  })

  it('rejects zero, one, or more than two displays instead of silently picking sources', () => {
    expect(() => selectDualDisplayIds(configuration([]))).toThrow(/exactly two/)
    expect(() => selectDualDisplayIds(configuration([laptop()]))).toThrow(/exactly two/)
    expect(() =>
      selectDualDisplayIds(configuration([laptop(), external(), display('third', false, 1920)]))
    ).toThrow(/exactly two/)
  })

  it('rejects inconsistent enumeration metadata', () => {
    const wrongCount = { ...configuration([laptop(), external()]), count: 1 }
    const wrongMultiFlag = { ...configuration([laptop(), external()]), isMultiDisplay: false }
    expect(() => selectDualDisplayIds(wrongCount)).toThrow(/exactly two/)
    expect(() => selectDualDisplayIds(wrongMultiFlag)).toThrow(/exactly two/)
  })

  it('rejects duplicate and empty display IDs', () => {
    expect(() =>
      selectDualDisplayIds(configuration([laptop(), display('laptop', false, -1920)]))
    ).toThrow(/distinct/)
    expect(() =>
      selectDualDisplayIds(configuration([laptop(), display('', false, -1920)]))
    ).toThrow(/distinct/)
  })

  it('rejects ambiguous primary selection', () => {
    const noPrimary = configuration([display('a', false, 0), display('b', false, -1920)])
    const twoPrimaries = configuration([laptop(), display('external', true, -1920)])
    const wrongPrimaryId = { ...configuration([laptop(), external()]), primaryId: 'external' }
    expect(() => selectDualDisplayIds(noPrimary)).toThrow(/primary/)
    expect(() => selectDualDisplayIds(twoPrimaries)).toThrow(/primary/)
    expect(() => selectDualDisplayIds(wrongPrimaryId)).toThrow(/primary/)
  })

  it('rejects mirrored or invalid display bounds', () => {
    expect(() =>
      selectDualDisplayIds(configuration([laptop(), display('external', false, 0)]))
    ).toThrow(/mirrored or ambiguous/)

    const invalidExternal = external()
    invalidExternal.bounds.width = 0
    expect(() => selectDualDisplayIds(configuration([laptop(), invalidExternal]))).toThrow(
      /valid bounds/
    )
  })

  it('does not modify display IDs or the input configuration', () => {
    const config = configuration([external(), laptop()])
    const before = JSON.stringify(config)
    expect(selectDualDisplayIds(config)).toEqual(['laptop', 'external'])
    expect(JSON.stringify(config)).toBe(before)
  })
})

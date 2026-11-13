import { describe, it, expect } from 'vitest'
import {
  toPhysicalBounds,
  toLogicalBounds,
  matchesDisplayBounds
} from '../../src/main/capture/dpi-bounds'

describe('DPI Bounds Mapping & Windows Scaling', () => {
  it('toPhysicalBounds: scales 100% (1.0) without changing dimensions', () => {
    const logical = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(toPhysicalBounds(logical, 1.0)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('toPhysicalBounds: scales 125% (1.25) accurately', () => {
    const logical = { x: 0, y: 0, width: 1536, height: 864 }
    expect(toPhysicalBounds(logical, 1.25)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('toPhysicalBounds: scales 150% (1.5) with negative coordinates', () => {
    const logical = { x: -1280, y: 0, width: 1280, height: 720 }
    expect(toPhysicalBounds(logical, 1.5)).toEqual({
      x: -1920,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('toLogicalBounds: converts physical pixels to logical DIPs', () => {
    const physical = { x: 1920, y: 0, width: 1920, height: 1080 }
    expect(toLogicalBounds(physical, 1.25)).toEqual({
      x: 1536,
      y: 0,
      width: 1536,
      height: 864
    })
  })

  it('matchesDisplayBounds: matches exact logical DIP coordinates at 100%', () => {
    const target = {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1.0
    }
    const candidate = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(matchesDisplayBounds(candidate, target)).toBe(true)
  })

  it('matchesDisplayBounds: matches physical pixel coordinates under 125% scaling', () => {
    const target = {
      bounds: { x: 0, y: 0, width: 1536, height: 864 },
      scaleFactor: 1.25
    }
    // Candidate Windows device reports unscaled physical pixels
    const candidate = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(matchesDisplayBounds(candidate, target)).toBe(true)
  })

  it('matchesDisplayBounds: matches negative coordinates in mixed-DPI dual monitor', () => {
    // Secondary monitor on left with 100% scale at x: -1920
    const secondary = {
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1.0
    }
    expect(matchesDisplayBounds({ x: -1920, y: 0, width: 1920, height: 1080 }, secondary)).toBe(true)

    // Primary monitor at 150% scale
    const primary = {
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      scaleFactor: 1.5
    }
    expect(matchesDisplayBounds({ x: 0, y: 0, width: 1920, height: 1080 }, primary)).toBe(true)
  })

  it('matchesDisplayBounds: bidirectionally matches logical candidate when target is physical', () => {
    const targetPhysical = {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1.25
    }
    const candidateLogical = { x: 0, y: 0, width: 1536, height: 864 }
    expect(matchesDisplayBounds(candidateLogical, targetPhysical)).toBe(true)
  })

  it('matchesDisplayBounds: returns false for mismatched coordinates', () => {
    const target = {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1.0
    }
    const candidate = { x: 1920, y: 0, width: 1920, height: 1080 }
    expect(matchesDisplayBounds(candidate, target)).toBe(false)
  })
})

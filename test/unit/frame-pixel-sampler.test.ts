import { deflateSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import { samplePngPixels } from '../../src/main/capture/frame-pixel-sampler'

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function buildTestPng(options: {
  width: number
  height: number
  colorType: 2 | 6
  r: number
  g: number
  b: number
  filterType?: 0 | 1 | 2 | 3 | 4
}): Uint8Array {
  const { width, height, colorType, r, g, b, filterType = 0 } = options
  const bpp = colorType === 6 ? 4 : 3
  const rowBytes = width * bpp

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bitDepth
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rawRows: Buffer[] = []
  const expectedRow = Buffer.alloc(rowBytes)
  for (let x = 0; x < width; x++) {
    const px = x * bpp
    expectedRow[px] = r
    expectedRow[px + 1] = g
    expectedRow[px + 2] = b
    if (bpp === 4) expectedRow[px + 3] = 255
  }

  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(rowBytes + 1)
    row[0] = filterType
    for (let x = 0; x < rowBytes; x++) {
      const curr = expectedRow[x]
      const left = x >= bpp ? expectedRow[x - bpp] : 0
      const up = y > 0 ? expectedRow[x] : 0
      const upLeft = x >= bpp && y > 0 ? expectedRow[x - bpp] : 0

      let encoded = curr
      if (filterType === 1) encoded = (curr - left) & 0xff
      else if (filterType === 2) encoded = (curr - up) & 0xff
      else if (filterType === 3) encoded = (curr - ((left + up) >> 1)) & 0xff
      else if (filterType === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        encoded = (curr - pred) & 0xff
      }
      row[1 + x] = encoded
    }
    rawRows.push(row)
  }

  const idat = deflateSync(Buffer.concat(rawRows))
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(
    Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', idat), makeChunk('IEND', Buffer.alloc(0))])
  )
}

describe('Frame Pixel Sampler', () => {
  it('samples Pattern 1 (Cobalt Blue) RGBA PNG accurately without opposite-pattern leakage', () => {
    const png = buildTestPng({
      width: 64,
      height: 48,
      colorType: 6,
      r: 0,
      g: 87,
      b: 184
    })

    const summary = samplePngPixels(png)

    expect(summary.width).toBe(64)
    expect(summary.height).toBe(48)
    expect(summary.colorType).toBe(6)
    expect(summary.sampleCount).toBe(192)
    expect(summary.meanRgb).toEqual({ r: 0, g: 87, b: 184 })
    expect(summary.cobaltBlueRatio).toBe(1)
    expect(summary.crimsonRedRatio).toBe(0)
    expect(summary.anchors).toHaveLength(5)
    for (const anchor of summary.anchors) {
      expect({ r: anchor.r, g: anchor.g, b: anchor.b }).toEqual({ r: 0, g: 87, b: 184 })
    }
  })

  it('samples Pattern 2 (Crimson Red) RGB PNG accurately without opposite-pattern leakage', () => {
    const png = buildTestPng({
      width: 64,
      height: 48,
      colorType: 2,
      r: 217,
      g: 43,
      b: 43
    })

    const summary = samplePngPixels(png)

    expect(summary.colorType).toBe(2)
    expect(summary.meanRgb).toEqual({ r: 217, g: 43, b: 43 })
    expect(summary.crimsonRedRatio).toBe(1)
    expect(summary.cobaltBlueRatio).toBe(0)
  })

  it.each([0, 1, 2, 3, 4] as const)(
    'correctly reconstructs PNG scanline filter type %i',
    (filterType) => {
      const png = buildTestPng({
        width: 32,
        height: 24,
        colorType: 6,
        r: 12,
        g: 95,
        b: 205,
        filterType
      })

      const summary = samplePngPixels(png)
      expect(summary.meanRgb).toEqual({ r: 12, g: 95, b: 205 })
      expect(summary.cobaltBlueRatio).toBe(1)
    }
  )

  it('fails closed on invalid PNG signature or truncated chunks', () => {
    expect(() => samplePngPixels(new Uint8Array([1, 2, 3, 4]))).toThrow(/missing RFC 2083 signature/)

    const valid = buildTestPng({ width: 16, height: 16, colorType: 6, r: 0, g: 87, b: 184 })
    const truncated = valid.slice(0, 24)
    expect(() => samplePngPixels(truncated)).toThrow(/truncated payload/)
  })

  it('refuses oversized PNG dimensions before allocating decode buffer', () => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(20000, 0)
    ihdr.writeUInt32BE(20000, 4)
    ihdr[8] = 8
    ihdr[9] = 6
    const fakeIdat = deflateSync(Buffer.from([0, 0, 0, 0, 0]))
    const bombPng = new Uint8Array(
      Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', fakeIdat), makeChunk('IEND', Buffer.alloc(0))])
    )

    expect(() => samplePngPixels(bombPng)).toThrow(/oversized PNG buffer/)
  })
})

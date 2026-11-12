import { inflateSync } from 'node:zlib'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_DECODED_BYTES = 64 * 1024 * 1024 // 64 MiB safety cap

export interface SampledAnchorPoint {
  region: 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right'
  x: number
  y: number
  r: number
  g: number
  b: number
}

export interface FramePixelSampleSummary {
  width: number
  height: number
  colorType: number
  sampleCount: number
  meanRgb: { r: number; g: number; b: number }
  cobaltBlueRatio: number
  crimsonRedRatio: number
  anchors: SampledAnchorPoint[]
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function hasValidPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

function parsePngChunks(bytes: Uint8Array): {
  width: number
  height: number
  bitDepth: number
  colorType: number
  compressedIdat: Buffer
} {
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let seenIhdr = false
  const idatChunks: Buffer[] = []

  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset)
    const length = view.getUint32(0, false)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    )

    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`Invalid PNG chunk "${type}": truncated payload`)
    }

    if (type === 'IHDR') {
      if (length !== 13) {
        throw new Error(`Invalid PNG IHDR length: expected 13, got ${length}`)
      }
      width = view.getUint32(8, false)
      height = view.getUint32(12, false)
      bitDepth = bytes[dataStart + 8]
      colorType = bytes[dataStart + 9]
      const compression = bytes[dataStart + 10]
      const filterMethod = bytes[dataStart + 11]
      const interlace = bytes[dataStart + 12]

      if (compression !== 0 || filterMethod !== 0 || interlace !== 0) {
        throw new Error(
          `Unsupported PNG encoding flags (compression=${compression}, filter=${filterMethod}, interlace=${interlace})`
        )
      }
      seenIhdr = true
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(bytes.subarray(dataStart, dataEnd)))
    } else if (type === 'IEND') {
      break
    }

    offset = dataEnd + 4 // skip 4-byte CRC
  }

  if (!seenIhdr || width <= 0 || height <= 0) {
    throw new Error('Invalid PNG: missing or invalid IHDR dimensions')
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `Unsupported PNG pixel format (bitDepth=${bitDepth}, colorType=${colorType}); expected 8-bit RGB or RGBA`
    )
  }
  if (idatChunks.length === 0) {
    throw new Error('Invalid PNG: no IDAT chunks found')
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    compressedIdat: Buffer.concat(idatChunks)
  }
}

function unfilterScanlines(
  inflated: Buffer,
  width: number,
  height: number,
  bpp: number
): Uint8Array {
  const rowBytes = width * bpp
  const expectedInflatedLength = (rowBytes + 1) * height
  if (inflated.length < expectedInflatedLength) {
    throw new Error(
      `Invalid PNG IDAT stream: expected at least ${expectedInflatedLength} bytes, got ${inflated.length}`
    )
  }

  const pixels = new Uint8Array(rowBytes * height)

  for (let y = 0; y < height; y++) {
    const srcRowStart = y * (rowBytes + 1)
    const filterType = inflated[srcRowStart]
    const dstRowStart = y * rowBytes
    const prevRowStart = (y - 1) * rowBytes

    for (let x = 0; x < rowBytes; x++) {
      const raw = inflated[srcRowStart + 1 + x]
      const a = x >= bpp ? pixels[dstRowStart + x - bpp] : 0
      const b = y > 0 ? pixels[prevRowStart + x] : 0
      const c = x >= bpp && y > 0 ? pixels[prevRowStart + x - bpp] : 0

      let recon: number
      switch (filterType) {
        case 0:
          recon = raw
          break
        case 1:
          recon = (raw + a) & 0xff
          break
        case 2:
          recon = (raw + b) & 0xff
          break
        case 3:
          recon = (raw + ((a + b) >> 1)) & 0xff
          break
        case 4:
          recon = (raw + paethPredictor(a, b, c)) & 0xff
          break
        default:
          throw new Error(`Unsupported PNG scanline filter type: ${filterType}`)
      }
      pixels[dstRowStart + x] = recon
    }
  }

  return pixels
}

/**
 * Decodes an in-memory PNG frame and returns safe aggregate color metrics across
 * a uniform interior sampling grid plus 5 fixed anchor coordinates.
 * Never persists, logs, or returns raw image bytes.
 */
export function samplePngPixels(pngBytes: Uint8Array): FramePixelSampleSummary {
  if (!hasValidPngSignature(pngBytes)) {
    throw new Error('Invalid PNG payload: missing RFC 2083 signature')
  }

  const { width, height, colorType, compressedIdat } = parsePngChunks(pngBytes)
  const bpp = colorType === 6 ? 4 : 3
  const estimatedDecodedBytes = (width * bpp + 1) * height

  if (estimatedDecodedBytes > MAX_DECODED_BYTES) {
    throw new Error(
      `Refusing to decode oversized PNG buffer (${estimatedDecodedBytes} bytes exceeds ${MAX_DECODED_BYTES} limit)`
    )
  }

  const inflated = inflateSync(compressedIdat)
  const pixels = unfilterScanlines(inflated, width, height, bpp)

  const readRgb = (px: number, py: number): { r: number; g: number; b: number } => {
    const cx = Math.min(Math.max(0, px), width - 1)
    const cy = Math.min(Math.max(0, py), height - 1)
    const idx = (cy * width + cx) * bpp
    return {
      r: pixels[idx],
      g: pixels[idx + 1],
      b: pixels[idx + 2]
    }
  }

  // Sample uniform 16x12 grid across interior [12%..88%] to exclude OS taskbar/window borders
  const cols = Math.min(16, width)
  const rows = Math.min(12, height)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let cobaltBlueCount = 0
  let crimsonRedCount = 0
  let sampleCount = 0

  for (let row = 0; row < rows; row++) {
    const fy = rows === 1 ? 0.5 : 0.12 + (0.76 * row) / (rows - 1)
    const y = Math.floor(fy * (height - 1))
    for (let col = 0; col < cols; col++) {
      const fx = cols === 1 ? 0.5 : 0.12 + (0.76 * col) / (cols - 1)
      const x = Math.floor(fx * (width - 1))
      const { r, g, b } = readRgb(x, y)

      sumR += r
      sumG += g
      sumB += b
      sampleCount++

      // Cobalt Blue test pattern class (#0057B8 -> RGB 0, 87, 184)
      if (b >= 130 && r <= 75 && b - r >= 70) {
        cobaltBlueCount++
      }

      // Crimson Red test pattern class (#D92B2B -> RGB 217, 43, 43)
      if (r >= 150 && b <= 75 && r - b >= 80) {
        crimsonRedCount++
      }
    }
  }

  const anchorSpecs: Array<{
    region: SampledAnchorPoint['region']
    fx: number
    fy: number
  }> = [
    { region: 'top-left', fx: 0.15, fy: 0.15 },
    { region: 'top-right', fx: 0.85, fy: 0.15 },
    { region: 'center', fx: 0.5, fy: 0.5 },
    { region: 'bottom-left', fx: 0.15, fy: 0.85 },
    { region: 'bottom-right', fx: 0.85, fy: 0.85 }
  ]

  const anchors: SampledAnchorPoint[] = anchorSpecs.map((spec) => {
    const x = Math.floor(spec.fx * (width - 1))
    const y = Math.floor(spec.fy * (height - 1))
    const { r, g, b } = readRgb(x, y)
    return { region: spec.region, x, y, r, g, b }
  })

  return {
    width,
    height,
    colorType,
    sampleCount,
    meanRgb: {
      r: Math.round(sumR / sampleCount),
      g: Math.round(sumG / sampleCount),
      b: Math.round(sumB / sampleCount)
    },
    cobaltBlueRatio: Number((cobaltBlueCount / sampleCount).toFixed(4)),
    crimsonRedRatio: Number((crimsonRedCount / sampleCount).toFixed(4)),
    anchors
  }
}

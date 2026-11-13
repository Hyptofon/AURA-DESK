import zlib from 'node:zlib'
import type { CapturedFrame } from '@/shared/contracts/capture'

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const chunkType = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([chunkType, data])))
  return Buffer.concat([len, chunkType, data, crc])
}

/**
 * Creates a genuine, decodable PNG binary image buffer for test fixtures.
 * Complies with the PNG specification (RFC 2083) with valid IHDR, IDAT, and IEND chunks.
 */
export function createTestPngBuffer(
  width = 2,
  height = 2,
  color: { r: number; g: number; b: number } = { r: 64, g: 128, b: 192 }
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // IHDR: width (4), height (4), bit depth (1), color type (1), compression (1), filter (1), interlace (1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 8 bits per sample
  ihdr[9] = 2 // RGB truecolor
  ihdr[10] = 0 // deflate compression
  ihdr[11] = 0 // standard adaptive filtering
  ihdr[12] = 0 // non-interlaced

  // Uncompressed scanlines: each line starts with filter byte 0, followed by 3 bytes per pixel
  const rawScanlines: number[] = []
  for (let y = 0; y < height; y++) {
    rawScanlines.push(0) // filter type: None
    for (let x = 0; x < width; x++) {
      rawScanlines.push(color.r, color.g, color.b)
    }
  }

  const idat = zlib.deflateSync(Buffer.from(rawScanlines))

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * Factory for creating a realistic CapturedFrame with a genuine PNG binary payload.
 */
export function createValidCapturedFrame(options: {
  displayId: string
  timestamp?: number
  width?: number
  height?: number
  bounds?: { x: number; y: number; width: number; height: number }
  color?: { r: number; g: number; b: number }
}): CapturedFrame {
  const width = options.width ?? 1920
  const height = options.height ?? 1080
  const pngBuffer = createTestPngBuffer(
    width > 8 ? 4 : width,
    height > 8 ? 4 : height,
    options.color
  )
  const data = new Uint8Array(pngBuffer)

  return {
    displayId: options.displayId,
    timestamp: options.timestamp ?? Date.now(),
    bounds: options.bounds ?? { x: 0, y: 0, width, height },
    data,
    byteLength: data.byteLength,
    format: 'png',
    hash: `valid-png-${options.displayId}-${data.byteLength}`
  }
}

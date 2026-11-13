/**
 * In-memory RIFF/WAVE header and audio encoder for 16-bit PCM.
 * Produces standard uncompressed WAV files compatible with whisper.cpp and standard audio tools.
 */

import type { AudioPcmBuffer } from '@/shared/contracts/transcription'

/**
 * Encodes an AudioPcmBuffer into a standard 16-bit PCM RIFF/WAVE Buffer.
 */
export function encodePcm16ToWav(buffer: AudioPcmBuffer): Buffer {
  const numChannels = buffer.channels || 1
  const sampleRate = buffer.sampleRate || 16000
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8

  const pcmBytes = buffer.data.byteLength
  const totalLength = 44 + pcmBytes
  const wavBuffer = Buffer.alloc(totalLength)

  // 0-3: "RIFF"
  wavBuffer.write('RIFF', 0, 'ascii')
  // 4-7: File size minus 8 bytes
  wavBuffer.writeUInt32LE(36 + pcmBytes, 4)
  // 8-11: "WAVE"
  wavBuffer.write('WAVE', 8, 'ascii')

  // 12-15: "fmt "
  wavBuffer.write('fmt ', 12, 'ascii')
  // 16-19: Subchunk1Size (16 for PCM)
  wavBuffer.writeUInt32LE(16, 16)
  // 20-21: AudioFormat (1 = PCM)
  wavBuffer.writeUInt16LE(1, 20)
  // 22-23: NumChannels
  wavBuffer.writeUInt16LE(numChannels, 22)
  // 24-27: SampleRate
  wavBuffer.writeUInt32LE(sampleRate, 24)
  // 28-31: ByteRate = SampleRate * NumChannels * BitsPerSample / 8
  const byteRate = sampleRate * numChannels * bytesPerSample
  wavBuffer.writeUInt32LE(byteRate, 28)
  // 32-33: BlockAlign = NumChannels * BitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  wavBuffer.writeUInt16LE(blockAlign, 32)
  // 34-35: BitsPerSample
  wavBuffer.writeUInt16LE(bitsPerSample, 34)

  // 36-39: "data"
  wavBuffer.write('data', 36, 'ascii')
  // 40-43: Subchunk2Size
  wavBuffer.writeUInt32LE(pcmBytes, 40)

  // 44+: Raw PCM samples
  const rawBytes = Buffer.from(buffer.data.buffer, buffer.data.byteOffset, buffer.data.byteLength)
  rawBytes.copy(wavBuffer, 44)

  return wavBuffer
}

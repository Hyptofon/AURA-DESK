import { describe, it, expect } from 'vitest'
import { encodePcm16ToWav } from '@/main/transcription/wav-encoder'
import { createSyntheticAudioBuffer } from '../../test/fixtures/stt-fixtures'

describe('wav-encoder: encodePcm16ToWav', () => {
  it('creates valid 44-byte standard RIFF/WAVE header and appends PCM payload', () => {
    const audio = createSyntheticAudioBuffer({
      durationMs: 100,
      sampleRate: 16000,
      channels: 1
    })

    const wav = encodePcm16ToWav(audio)
    const expectedPcmBytes = audio.data.byteLength

    expect(wav.length).toBe(44 + expectedPcmBytes)

    // RIFF identifier
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    // File size - 8
    expect(wav.readUInt32LE(4)).toBe(36 + expectedPcmBytes)
    // WAVE format
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')

    // fmt subchunk
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.readUInt32LE(16)).toBe(16) // Subchunk1Size
    expect(wav.readUInt16LE(20)).toBe(1) // AudioFormat = PCM
    expect(wav.readUInt16LE(22)).toBe(1) // NumChannels = 1
    expect(wav.readUInt32LE(24)).toBe(16000) // SampleRate = 16000
    expect(wav.readUInt32LE(28)).toBe(32000) // ByteRate = 16000 * 1 * 2 = 32000
    expect(wav.readUInt16LE(32)).toBe(2) // BlockAlign = 1 * 2 = 2
    expect(wav.readUInt16LE(34)).toBe(16) // BitsPerSample = 16

    // data subchunk
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(expectedPcmBytes)

    // Payload verification
    const rawExpected = Buffer.from(audio.data.buffer, audio.data.byteOffset, audio.data.byteLength)
    const rawActual = wav.subarray(44)
    expect(rawActual.equals(rawExpected)).toBe(true)
  })

  it('handles multi-channel audio format correctly', () => {
    const audio = createSyntheticAudioBuffer({
      durationMs: 50,
      sampleRate: 48000,
      channels: 2
    })

    const wav = encodePcm16ToWav(audio)
    expect(wav.readUInt16LE(22)).toBe(2) // NumChannels = 2
    expect(wav.readUInt32LE(24)).toBe(48000) // SampleRate = 48000
    // ByteRate = 48000 * 2 * 2 = 192000
    expect(wav.readUInt32LE(28)).toBe(192000)
    expect(wav.readUInt16LE(32)).toBe(4) // BlockAlign = 2 * 2 = 4
  })
})

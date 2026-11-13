/**
 * Pure PCM audio format conversion, downmixing and resampling utilities.
 * Prepares raw microphone and system loopback PCM for STT engines (16kHz, 1 channel mono, 16-bit signed PCM).
 */

import type { AudioPcmBuffer } from '@/shared/contracts/transcription'

/**
 * Downmixes multi-channel interleaved Int16 PCM samples to single-channel mono.
 */
export function downmixToMono(samples: Int16Array, channels: number): Int16Array {
  if (channels <= 0) {
    throw new RangeError(`Channels must be a positive integer, received: ${channels}`)
  }
  if (channels === 1) {
    return new Int16Array(samples)
  }

  const frameCount = Math.floor(samples.length / channels)
  const mono = new Int16Array(frameCount)

  for (let i = 0; i < frameCount; i++) {
    let sum = 0
    const offset = i * channels
    for (let c = 0; c < channels; c++) {
      sum += samples[offset + c]
    }
    mono[i] = Math.round(sum / channels)
  }

  return mono
}

/**
 * Resamples single-channel Int16 PCM audio using band-safe linear interpolation.
 */
export function resamplePcm16(
  samples: Int16Array,
  fromRate: number,
  toRate: number
): Int16Array {
  if (fromRate <= 0 || toRate <= 0) {
    throw new RangeError(
      `Sample rates must be positive numbers. fromRate: ${fromRate}, toRate: ${toRate}`
    )
  }

  if (fromRate === toRate || samples.length === 0) {
    return new Int16Array(samples)
  }

  // Fast exact decimation for common integer ratios (e.g. 48000Hz -> 16000Hz = ratio 3)
  const ratio = fromRate / toRate
  if (Number.isInteger(ratio) && ratio > 1) {
    const factor = ratio
    const outLength = Math.floor(samples.length / factor)
    const out = new Int16Array(outLength)
    // Box-car averaging decimation filter to prevent aliasing
    for (let i = 0; i < outLength; i++) {
      let sum = 0
      const start = i * factor
      for (let j = 0; j < factor; j++) {
        sum += samples[start + j]
      }
      out[i] = Math.round(sum / factor)
    }
    return out
  }

  // General linear interpolation
  const outLength = Math.round((samples.length * toRate) / fromRate)
  const out = new Int16Array(outLength)

  for (let i = 0; i < outLength; i++) {
    const srcPos = (i * fromRate) / toRate
    const srcIndex = Math.floor(srcPos)
    const frac = srcPos - srcIndex

    const s0 = samples[Math.min(srcIndex, samples.length - 1)]
    const s1 = samples[Math.min(srcIndex + 1, samples.length - 1)]

    const interpolated = (1 - frac) * s0 + frac * s1
    out[i] = Math.max(-32768, Math.min(32767, Math.round(interpolated)))
  }

  return out
}

/**
 * Converts any AudioPcmBuffer into standard 16kHz mono PCM required by STT engines.
 */
export function prepareAudioForStt(
  audio: AudioPcmBuffer,
  targetSampleRate = 16000
): AudioPcmBuffer {
  if (!audio.data || audio.data.length === 0) {
    return {
      ...audio,
      data: new Int16Array(0),
      sampleRate: targetSampleRate,
      channels: 1
    }
  }

  // Step 1: Downmix to mono if multi-channel (e.g. 48kHz stereo system loopback)
  const mono = audio.channels > 1 ? downmixToMono(audio.data, audio.channels) : audio.data

  // Step 2: Resample to target rate if different (e.g. 48kHz -> 16kHz)
  const resampled =
    audio.sampleRate !== targetSampleRate
      ? resamplePcm16(mono, audio.sampleRate, targetSampleRate)
      : mono

  return {
    ...audio,
    data: resampled,
    sampleRate: targetSampleRate,
    channels: 1
  }
}

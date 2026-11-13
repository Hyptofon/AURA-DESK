/**
 * Speech Window Assembler.
 * Aggregates incoming small AudioChunks (e.g. 85-128ms) into meaningful speech utterance windows
 * for transcription, utilizing VAD speech/silence transitions without arbitrary tiny chunk dispatch.
 */

import type { AudioChunk, AudioSourceKind } from '@/shared/contracts/audio'
import type { AudioPcmBuffer } from '@/shared/contracts/transcription'

export interface SpeechWindowOptions {
  /** Minimum speech audio duration in ms before emitting a window. Default: 400ms */
  minSpeechDurationMs?: number
  /** Maximum audio duration in ms before forcing a window flush. Default: 5000ms */
  maxWindowDurationMs?: number
  /** Silence hangover in ms following speech before finalizing utterance. Default: 500ms */
  silenceHangoverMs?: number
}

export class SpeechWindowAssembler {
  private readonly source: AudioSourceKind
  private readonly minSpeechDurationMs: number
  private readonly maxWindowDurationMs: number
  private readonly silenceHangoverMs: number

  private accumulatedChunks: AudioChunk[] = []
  private hasDetectedSpeech = false
  private accumulatedSpeechMs = 0
  private trailingSilenceMs = 0

  constructor(source: AudioSourceKind, options: SpeechWindowOptions = {}) {
    this.source = source
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 400
    this.maxWindowDurationMs = options.maxWindowDurationMs ?? 5000
    this.silenceHangoverMs = options.silenceHangoverMs ?? 500
  }

  /**
   * Ingests an audio chunk and returns an assembled AudioPcmBuffer when an utterance is ready.
   */
  public ingest(chunk: AudioChunk): AudioPcmBuffer | null {
    if (chunk.source !== this.source) {
      return null
    }

    if (chunk.isSpeech) {
      this.hasDetectedSpeech = true
      this.accumulatedSpeechMs += chunk.durationMs
      this.trailingSilenceMs = 0
      this.accumulatedChunks.push(chunk)
    } else if (this.hasDetectedSpeech) {
      // Trailing silence after active speech
      this.trailingSilenceMs += chunk.durationMs
      this.accumulatedChunks.push(chunk)

      // End of speech utterance reached
      if (this.trailingSilenceMs >= this.silenceHangoverMs) {
        if (this.accumulatedSpeechMs >= this.minSpeechDurationMs) {
          return this.finalizeBuffer()
        }
        this.reset()
        return null
      }
    }

    // Force flush if window duration limit reached
    const totalDuration = this.getTotalDurationMs()
    if (totalDuration >= this.maxWindowDurationMs) {
      if (this.accumulatedSpeechMs >= this.minSpeechDurationMs) {
        return this.finalizeBuffer()
      }
      this.reset()
      return null
    }

    return null
  }

  /**
   * Manually flushes and finalizes currently accumulated speech audio.
   */
  public flush(): AudioPcmBuffer | null {
    if (this.hasDetectedSpeech && this.accumulatedSpeechMs >= this.minSpeechDurationMs) {
      return this.finalizeBuffer()
    }
    this.reset()
    return null
  }

  /**
   * Resets and clears accumulated state.
   */
  public reset(): void {
    this.accumulatedChunks = []
    this.hasDetectedSpeech = false
    this.accumulatedSpeechMs = 0
    this.trailingSilenceMs = 0
  }

  public getAccumulatedSpeechDurationMs(): number {
    return this.accumulatedSpeechMs
  }

  private getTotalDurationMs(): number {
    return this.accumulatedChunks.reduce((acc, c) => acc + c.durationMs, 0)
  }

  private finalizeBuffer(): AudioPcmBuffer {
    const chunks = this.accumulatedChunks
    const firstChunk = chunks[0]
    const lastChunk = chunks[chunks.length - 1]

    const sampleRate = firstChunk.sampleRate
    const channels = firstChunk.channels
    const startTimestamp = firstChunk.timestamp
    const endTimestamp = lastChunk.timestamp + lastChunk.durationMs

    // Calculate total sample count across all chunks
    let totalSamples = 0
    for (const c of chunks) {
      totalSamples += Math.floor(c.data.byteLength / 2)
    }

    const mergedData = new Int16Array(totalSamples)
    let offset = 0

    for (const c of chunks) {
      // Respect byte alignment
      const sampleCount = Math.floor(c.data.byteLength / 2)
      const int16View =
        c.data.byteOffset % 2 === 0
          ? new Int16Array(c.data.buffer, c.data.byteOffset, sampleCount)
          : new Int16Array(c.data.slice().buffer, 0, sampleCount)

      mergedData.set(int16View, offset)
      offset += sampleCount
    }

    this.reset()

    return {
      data: mergedData,
      sampleRate,
      channels,
      source: this.source,
      startTimestamp,
      endTimestamp
    }
  }
}

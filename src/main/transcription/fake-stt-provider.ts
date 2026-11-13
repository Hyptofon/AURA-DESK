/**
 * Deterministic Fake Speech-to-Text Provider.
 * Used for unit and contract testing without requiring native binaries or live models.
 */

import type {
  SpeechToTextProvider,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptSegment
} from '@/shared/contracts/transcription'
import { prepareAudioForStt } from './audio-resampler'

export interface FakeSttOptions {
  id?: string
  name?: string
  latencyMs?: number
  shouldFail?: boolean
  failureMessage?: string
  defaultText?: string
  language?: 'uk' | 'en'
  confidence?: number
}

export class FakeSttProvider implements SpeechToTextProvider {
  public readonly id: string
  public readonly name: string
  public latencyMs: number
  public shouldFail: boolean
  public failureMessage: string
  public defaultText: string
  public language: 'uk' | 'en'
  public confidence: number
  public isDisposed = false

  public transcribeCallCount = 0
  public lastRequest: TranscriptionRequest | null = null

  constructor(options: FakeSttOptions = {}) {
    this.id = options.id ?? 'fake-stt'
    this.name = options.name ?? 'Fake STT Test Adapter'
    this.latencyMs = options.latencyMs ?? 0
    this.shouldFail = options.shouldFail ?? false
    this.failureMessage = options.failureMessage ?? 'Simulated STT provider inference error'
    this.defaultText = options.defaultText ?? ''
    this.language = options.language ?? 'uk'
    this.confidence = options.confidence ?? 0.95
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    if (this.isDisposed) {
      throw new Error('FakeSttProvider is disposed')
    }

    this.transcribeCallCount++
    this.lastRequest = request

    // Check abort signal immediately
    if (request.signal?.aborted) {
      throw new Error('Transcription request was aborted')
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage)
    }

    // Validate audio input
    if (!request.audio || !request.audio.data) {
      throw new Error('Invalid audio: missing PCM data')
    }

    // Simulate async inference latency with abort listener
    if (this.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, this.latencyMs)

        const onAbort = (): void => {
          cleanup()
          clearTimeout(timer)
          reject(new Error('Transcription request was aborted'))
        }

        const cleanup = (): void => {
          if (request.signal) {
            request.signal.removeEventListener('abort', onAbort)
          }
        }

        if (request.signal) {
          request.signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    }

    // Convert audio to standard 16kHz mono PCM
    const sttAudio = prepareAudioForStt(request.audio)

    const durationMs =
      sttAudio.data.length > 0
        ? (sttAudio.data.length / sttAudio.sampleRate) * 1000
        : request.audio.endTimestamp - request.audio.startTimestamp

    const lang = request.language === 'en' ? 'en' : request.language === 'uk' ? 'uk' : this.language
    const recognizedText = this.defaultText || (lang === 'en' ? 'What does this function do?' : 'Що таке алгоритм сортування?')

    const segment: TranscriptSegment = {
      id: `seg-${Date.now()}-${this.transcribeCallCount}`,
      source: request.audio.source,
      startTimestamp: request.audio.startTimestamp,
      endTimestamp: request.audio.endTimestamp,
      text: recognizedText,
      language: lang,
      confidence: this.confidence,
      isFinal: true
    }

    return {
      text: recognizedText,
      language: lang,
      confidence: this.confidence,
      segments: [segment],
      durationMs
    }
  }

  dispose(): void {
    this.isDisposed = true
  }
}

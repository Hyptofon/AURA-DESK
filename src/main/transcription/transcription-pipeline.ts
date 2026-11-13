/**
 * Transcription Pipeline.
 * Orchestrates audio chunk ingestion, speech window aggregation, STT provider inference,
 * timestamp-preserved transcript segmentation, and question candidate detection.
 */

import type { AudioChunk } from '@/shared/contracts/audio'
import type {
  SpeechToTextProvider,
  TranscriptSegment
} from '@/shared/contracts/transcription'
import type {
  QuestionCandidate,
  TranscriptionSessionState
} from '@/shared/contracts/questions'
import { SpeechWindowAssembler, type SpeechWindowOptions } from './speech-window'
import { evaluateSegmentForQuestion } from './question-detector'
import { QuestionControls, type QuestionControlsOptions } from './question-controls'

export interface TranscriptionPipelineOptions {
  provider: SpeechToTextProvider
  windowOptions?: SpeechWindowOptions
  controlsOptions?: QuestionControlsOptions
  maxSegments?: number
  maxQuestions?: number
}

export class TranscriptionPipeline {
  private readonly provider: SpeechToTextProvider
  private readonly micAssembler: SpeechWindowAssembler
  private readonly systemAssembler: SpeechWindowAssembler
  private readonly questionControls: QuestionControls
  private readonly maxSegments: number
  private readonly maxQuestions: number

  private segments: TranscriptSegment[] = []
  private questions: QuestionCandidate[] = []
  private isTranscribing = false
  private currentAbortController: AbortController | null = null

  private stateSubscribers = new Set<(state: TranscriptionSessionState) => void>()
  private questionSubscribers = new Set<(question: QuestionCandidate) => void>()

  constructor(options: TranscriptionPipelineOptions) {
    this.provider = options.provider
    this.maxSegments = options.maxSegments ?? 50
    this.maxQuestions = options.maxQuestions ?? 20

    this.micAssembler = new SpeechWindowAssembler('mic', options.windowOptions)
    this.systemAssembler = new SpeechWindowAssembler('system', options.windowOptions)
    this.questionControls = new QuestionControls(options.controlsOptions)
  }

  public async ingestChunk(chunk: AudioChunk): Promise<void> {
    const assembler = chunk.source === 'mic' ? this.micAssembler : this.systemAssembler
    const window = assembler.ingest(chunk)

    if (window && window.data.length > 0) {
      await this.processAudioWindow(window)
    }
  }

  public getState(): TranscriptionSessionState {
    return {
      latestSegment: this.segments[this.segments.length - 1] ?? null,
      latestQuestion: this.questions[this.questions.length - 1] ?? null,
      segmentCount: this.segments.length,
      questionCount: this.questions.length,
      isTranscribing: this.isTranscribing
    }
  }

  public onStateChanged(callback: (state: TranscriptionSessionState) => void): () => void {
    this.stateSubscribers.add(callback)
    return () => {
      this.stateSubscribers.delete(callback)
    }
  }

  public onQuestionDetected(callback: (question: QuestionCandidate) => void): () => void {
    this.questionSubscribers.add(callback)
    return () => {
      this.questionSubscribers.delete(callback)
    }
  }

  public stop(): void {
    this.micAssembler.reset()
    this.systemAssembler.reset()
    this.questionControls.cancel()

    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }

    this.isTranscribing = false
    this.notifyStateChanged()
  }

  public dispose(): void {
    this.stop()
    this.questionControls.reset()
    this.stateSubscribers.clear()
    this.questionSubscribers.clear()
    this.segments = []
    this.questions = []
    if (this.provider.dispose) {
      void this.provider.dispose()
    }
  }

  private async processAudioWindow(window: NonNullable<ReturnType<SpeechWindowAssembler['ingest']>>): Promise<void> {
    if (this.isTranscribing) {
      // Avoid concurrency explosion; drop or skip overlapping in-flight window
      return
    }

    this.isTranscribing = true
    this.currentAbortController = new AbortController()
    this.notifyStateChanged()

    try {
      const result = await this.provider.transcribe({
        audio: window,
        signal: this.currentAbortController.signal
      })

      if (result.text && result.text.length > 0) {
        const segments = result.segments && result.segments.length > 0
          ? result.segments
          : [
              {
                id: `seg-${Date.now()}`,
                source: window.source,
                startTimestamp: window.startTimestamp,
                endTimestamp: window.endTimestamp,
                text: result.text,
                language: result.language,
                confidence: result.confidence,
                isFinal: true
              }
            ]

        for (const segment of segments) {
          this.addSegment(segment)

          const questionCandidate = evaluateSegmentForQuestion(segment)
          if (questionCandidate) {
            this.questionControls.submitCandidate(
              questionCandidate,
              (readyCandidate) => {
                this.addQuestion(readyCandidate)
                this.notifyStateChanged()
              }
            )
          }
        }
      }
    } catch (err) {
      // Abort is expected during stop/pause
      if (err instanceof Error && err.message.includes('aborted')) {
        return
      }
      console.error('Transcription inference error:', err)
    } finally {
      this.isTranscribing = false
      this.currentAbortController = null
      this.notifyStateChanged()
    }
  }

  private addSegment(segment: TranscriptSegment): void {
    this.segments.push(segment)
    if (this.segments.length > this.maxSegments) {
      this.segments.shift()
    }
  }

  private addQuestion(candidate: QuestionCandidate): void {
    this.questions.push(candidate)
    if (this.questions.length > this.maxQuestions) {
      this.questions.shift()
    }
    for (const sub of this.questionSubscribers) {
      try {
        sub(candidate)
      } catch {
        // Ignored
      }
    }
  }

  private notifyStateChanged(): void {
    const state = this.getState()
    for (const sub of this.stateSubscribers) {
      try {
        sub(state)
      } catch {
        // Ignored
      }
    }
  }
}

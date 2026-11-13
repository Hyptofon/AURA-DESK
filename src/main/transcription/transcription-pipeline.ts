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
  private isPaused = false
  private sessionGeneration = 0
  private currentAbortController: AbortController | null = null
  private pendingAudioWindow: NonNullable<ReturnType<SpeechWindowAssembler['ingest']>> | null = null

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
    if (this.isPaused) {
      return
    }

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

  /**
   * Pauses transcription pipeline. Drops incoming chunks, cancels debounce timers,
   * and aborts any active in-flight STT inference immediately.
   */
  public pause(): void {
    this.isPaused = true
    this.sessionGeneration++
    this.pendingAudioWindow = null
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

  /**
   * Resumes transcription pipeline from paused state.
   */
  public resume(): void {
    this.isPaused = false
    this.sessionGeneration++
    this.notifyStateChanged()
  }

  public stop(): void {
    this.isPaused = false
    this.sessionGeneration++
    this.pendingAudioWindow = null
    this.micAssembler.reset()
    this.systemAssembler.reset()
    this.questionControls.cancel()
    this.questionControls.reset()
    this.segments = []
    this.questions = []

    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }

    this.isTranscribing = false
    this.notifyStateChanged()
  }

  public dispose(): void {
    this.stop()
    this.stateSubscribers.clear()
    this.questionSubscribers.clear()
    if (this.provider.dispose) {
      void this.provider.dispose()
    }
  }

  private async processAudioWindow(window: NonNullable<ReturnType<SpeechWindowAssembler['ingest']>>): Promise<void> {
    if (this.isPaused) {
      return
    }

    if (this.isTranscribing) {
      // Bounded queue: buffer at most 1 pending speech window while STT inference is busy
      this.pendingAudioWindow = window
      return
    }

    const currentGen = this.sessionGeneration
    const abortController = new AbortController()
    this.currentAbortController = abortController
    this.isTranscribing = true
    this.notifyStateChanged()

    try {
      const result = await this.provider.transcribe({
        audio: window,
        signal: abortController.signal
      })

      // Stale generation check: discard if session stopped or paused during inference
      if (
        this.sessionGeneration !== currentGen ||
        abortController.signal.aborted ||
        this.isPaused
      ) {
        return
      }

      const trimmedText = result.text?.trim()
      if (trimmedText && trimmedText.length > 0) {
        const rawSegments = result.segments && result.segments.length > 0
          ? result.segments
          : [
              {
                id: `seg-${Date.now()}`,
                source: window.source,
                startTimestamp: window.startTimestamp,
                endTimestamp: window.endTimestamp,
                text: trimmedText,
                language: result.language,
                confidence: result.confidence,
                isFinal: true
              }
            ]

        const validSegments = rawSegments.filter((s) => s.text && s.text.trim().length > 0)

        for (const segment of validSegments) {
          this.addSegment(segment)

          const questionCandidate = evaluateSegmentForQuestion(segment)
          if (questionCandidate) {
            this.questionControls.submitCandidate(
              questionCandidate,
              (readyCandidate) => {
                if (this.sessionGeneration === currentGen && !this.isPaused) {
                  this.addQuestion(readyCandidate)
                  this.notifyStateChanged()
                }
              }
            )
          }
        }
      }
    } catch (err) {
      if (
        abortController.signal.aborted ||
        this.sessionGeneration !== currentGen ||
        (err instanceof Error && (err.name === 'AbortError' || err.message.toLowerCase().includes('abort')))
      ) {
        return
      }
      console.error('Transcription inference error:', err)
    } finally {
      if (this.sessionGeneration === currentGen) {
        this.isTranscribing = false
        this.currentAbortController = null
        this.notifyStateChanged()

        if (this.pendingAudioWindow && !this.isPaused) {
          const nextWindow = this.pendingAudioWindow
          this.pendingAudioWindow = null
          void this.processAudioWindow(nextWindow)
        }
      }
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

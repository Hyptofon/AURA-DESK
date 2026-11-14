/**
 * Transcription & Conversation Intent Detection Pipeline.
 * Orchestrates audio chunk ingestion, bounded speech window aggregation,
 * bounded STT backpressure queue, semantic utterance assembly, multi-turn conversation
 * context, hybrid local/OpenRouter intent classification, and question candidate controls.
 */

import type { AudioChunk, AudioSourceKind } from '@/shared/contracts/audio'
import type {
  AudioPcmBuffer,
  DetectedLanguage,
  SpeechToTextProvider,
  TranscriptSegment
} from '@/shared/contracts/transcription'
import type {
  AssembledUtterance,
  IntentEvaluationRecord,
  QuestionCandidate,
  SemanticClassifierConfig,
  TranscriptionSessionState
} from '@/shared/contracts/questions'
import { SpeechWindowAssembler, type SpeechWindowOptions } from './speech-window'
import {
  UtteranceAssembler,
  normalizeUtteranceText,
  type UtteranceAssemblerOptions
} from './utterance-assembler'
import { ConversationContext, type ConversationContextOptions } from './conversation-context'
import { LocalIntentAnalyzer } from './local-intent-analyzer'
import type { IntentClassifier } from './intent-classifier'
import { IntentDecisionEngine } from './intent-decision-engine'
import { QuestionControls, type QuestionControlsOptions } from './question-controls'
import { detectTranscriptLanguage } from './whisper-cpp-provider'

export interface TranscriptionPipelineOptions {
  provider: SpeechToTextProvider
  windowOptions?: SpeechWindowOptions
  utteranceOptions?: UtteranceAssemblerOptions
  contextOptions?: ConversationContextOptions
  controlsOptions?: QuestionControlsOptions
  classifier?: IntentClassifier | null
  maxSegments?: number
  maxUtterances?: number
  maxEvaluations?: number
  maxQuestions?: number
  /** Maximum pending audio windows buffered while STT is busy. Default: 6 */
  maxPendingWindows?: number
  /** Silence settle timeout (ms) for forced-split or incomplete utterances. Default: 1200ms */
  utteranceSettleMs?: number
}

const INCOMPLETE_TAIL_WORDS = new Set([
  'і',
  'й',
  'та',
  'а',
  'але',
  'бо',
  'тому',
  'що',
  'щоб',
  'якщо',
  'коли',
  'де',
  'куди',
  'звідки',
  'для',
  'від',
  'до',
  'на',
  'у',
  'в',
  'з',
  'про',
  'при',
  'чи',
  'або',
  'and',
  'or',
  'but',
  'because',
  'since',
  'while',
  'when',
  'if',
  'which',
  'that',
  'to',
  'for',
  'with',
  'from',
  'into',
  'of',
  'in',
  'on',
  'at',
  'by',
  'about'
])

function hasIncompleteTrailingClause(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || /[.!?…]$/.test(trimmed)) return false
  if (/[,:—–-]$/.test(trimmed)) return true
  const words = normalizeUtteranceText(trimmed).split(' ').filter(Boolean)
  if (words.length === 0) return false
  return INCOMPLETE_TAIL_WORDS.has(words[words.length - 1])
}

export class TranscriptionPipeline {
  private readonly provider: SpeechToTextProvider
  private readonly micAssembler: SpeechWindowAssembler
  private readonly systemAssembler: SpeechWindowAssembler
  private readonly utteranceAssembler: UtteranceAssembler
  private readonly decisionEngine: IntentDecisionEngine
  private readonly questionControls: QuestionControls
  private readonly maxSegments: number
  private readonly maxUtterances: number
  private readonly maxEvaluations: number
  private readonly maxQuestions: number
  private readonly maxPendingWindows: number
  private readonly utteranceSettleMs: number

  private segments: TranscriptSegment[] = []
  private utterances: AssembledUtterance[] = []
  private evaluations: IntentEvaluationRecord[] = []
  private questions: QuestionCandidate[] = []

  private isProcessingWindow = false
  private isTranscribing = false
  private currentTranscribingSource: AudioSourceKind | null = null
  private isClassifying = false
  private isPaused = false
  private sessionGeneration = 0
  private currentAbortController: AbortController | null = null
  private activeClassifierAbortControllers = new Set<AbortController>()
  private utteranceSettleTimers = new Map<AudioSourceKind, NodeJS.Timeout>()

  private pendingAudioWindows: AudioPcmBuffer[] = []
  private droppedWindowCount = 0
  private lastDropReason: string | null = null

  private stateSubscribers = new Set<(state: TranscriptionSessionState) => void>()
  private questionSubscribers = new Set<(question: QuestionCandidate) => void>()

  constructor(options: TranscriptionPipelineOptions) {
    this.provider = options.provider
    this.maxSegments = options.maxSegments ?? 50
    this.maxUtterances = options.maxUtterances ?? 40
    this.maxEvaluations = options.maxEvaluations ?? 40
    this.maxQuestions = options.maxQuestions ?? 20
    this.maxPendingWindows = Math.max(1, options.maxPendingWindows ?? 6)
    this.utteranceSettleMs = Math.max(50, options.utteranceSettleMs ?? 1200)

    this.micAssembler = new SpeechWindowAssembler('mic', options.windowOptions)
    this.systemAssembler = new SpeechWindowAssembler('system', options.windowOptions)
    this.utteranceAssembler = new UtteranceAssembler(options.utteranceOptions)
    this.decisionEngine = new IntentDecisionEngine({
      context: new ConversationContext(options.contextOptions),
      localAnalyzer: new LocalIntentAnalyzer(),
      classifier: options.classifier ?? null
    })
    this.questionControls = new QuestionControls(options.controlsOptions)
  }

  public async ingestChunk(chunk: AudioChunk): Promise<void> {
    if (this.isPaused) {
      return
    }

    if (
      chunk.isSpeech &&
      this.utteranceSettleTimers.has(chunk.source) &&
      this.utteranceAssembler.hasPending(chunk.source)
    ) {
      this.scheduleUtteranceSettleFlush(chunk.source, this.sessionGeneration)
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
      latestUtterance: this.utterances[this.utterances.length - 1] ?? null,
      latestEvaluation: this.evaluations[this.evaluations.length - 1] ?? null,
      latestQuestion: this.questions[this.questions.length - 1] ?? null,
      segmentCount: this.segments.length,
      questionCount: this.questions.length,
      isTranscribing: this.isTranscribing,
      isClassifying: this.isClassifying,
      semanticClassifier: this.decisionEngine.getClassifierStatus(),
      diagnostics: {
        queuedWindowCount: this.pendingAudioWindows.length,
        droppedWindowCount: this.droppedWindowCount,
        lastDropReason: this.lastDropReason,
        pendingCandidateCount: this.questionControls.getPendingCount(),
        droppedCandidateCount: this.questionControls.getDroppedCount(),
        lastCandidateDropReason: this.questionControls.getLastDropReason(),
        utteranceCount: this.utterances.length
      }
    }
  }

  public setClassifierConfig(
    config: Partial<SemanticClassifierConfig>
  ): TranscriptionSessionState {
    this.decisionEngine.setClassifierConfig(config)
    this.notifyStateChanged()
    return this.getState()
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
   * Pauses transcription pipeline. Drops incoming chunks, cancels debounce/settle timers,
   * and aborts any active in-flight STT or semantic classifier inference immediately.
   */
  public pause(): void {
    this.isPaused = true
    this.sessionGeneration++
    if (this.pendingAudioWindows.length > 0) {
      this.droppedWindowCount += this.pendingAudioWindows.length
      this.lastDropReason = 'paused_or_stopped'
      this.pendingAudioWindows = []
    }
    this.clearUtteranceSettleTimer()
    this.micAssembler.reset()
    this.systemAssembler.reset()
    this.utteranceAssembler.reset()
    this.questionControls.cancel()

    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
    this.abortAllClassifiers()

    this.isProcessingWindow = false
    this.isTranscribing = false
    this.currentTranscribingSource = null
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
    this.pendingAudioWindows = []
    this.droppedWindowCount = 0
    this.lastDropReason = null
    this.clearUtteranceSettleTimer()
    this.micAssembler.reset()
    this.systemAssembler.reset()
    this.utteranceAssembler.reset()
    this.decisionEngine.reset()
    this.questionControls.cancel()
    this.questionControls.reset()
    this.segments = []
    this.utterances = []
    this.evaluations = []
    this.questions = []

    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
    this.abortAllClassifiers()

    this.isProcessingWindow = false
    this.isTranscribing = false
    this.currentTranscribingSource = null
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

  private async processAudioWindow(window: AudioPcmBuffer): Promise<void> {
    if (this.isPaused) {
      this.droppedWindowCount += 1
      this.lastDropReason = 'paused_or_stopped'
      return
    }

    if (this.isProcessingWindow) {
      if (this.pendingAudioWindows.length >= this.maxPendingWindows) {
        // Explicit bounded backpressure: evict oldest stale window and record overflow reason
        this.pendingAudioWindows.shift()
        this.droppedWindowCount += 1
        this.lastDropReason = 'stt_queue_overflow'
      }
      this.pendingAudioWindows.push(window)
      this.notifyStateChanged()
      return
    }

    const currentGen = this.sessionGeneration
    const abortController = new AbortController()
    this.currentAbortController = abortController
    this.isProcessingWindow = true
    this.isTranscribing = true
    this.currentTranscribingSource = window.source
    this.notifyStateChanged()

    try {
      const result = await this.provider.transcribe({
        audio: window,
        signal: abortController.signal
      })

      if (
        this.sessionGeneration !== currentGen ||
        abortController.signal.aborted ||
        this.isPaused
      ) {
        return
      }

      this.isTranscribing = false
      this.currentAbortController = null
      this.currentTranscribingSource = null

      const trimmedText = result.text?.trim()
      if (trimmedText && trimmedText.length > 0) {
        const resolvedLanguage: DetectedLanguage =
          result.language && result.language !== 'unknown'
            ? result.language
            : detectTranscriptLanguage(trimmedText)

        const rawSegments =
          result.segments && result.segments.length > 0
            ? result.segments.map((seg, idx, arr) => ({
                ...seg,
                language:
                  seg.language && seg.language !== 'unknown'
                    ? seg.language
                    : detectTranscriptLanguage(seg.text),
                isForcedSplit:
                  idx === arr.length - 1
                    ? Boolean(seg.isForcedSplit ?? window.isForcedSplit)
                    : Boolean(seg.isForcedSplit)
              }))
            : [
                {
                  id: `seg-${window.startTimestamp}-${Math.random().toString(36).slice(2, 6)}`,
                  source: window.source,
                  startTimestamp: window.startTimestamp,
                  endTimestamp: window.endTimestamp,
                  text: trimmedText,
                  language: resolvedLanguage,
                  confidence: result.confidence,
                  isFinal: true,
                  isForcedSplit: Boolean(window.isForcedSplit)
                }
              ]

        const validSegments = rawSegments.filter((s) => s.text && s.text.trim().length > 0)

        for (let i = 0; i < validSegments.length; i++) {
          const segment = validSegments[i]
          this.addSegment(segment)

          const emittedUtterances = this.utteranceAssembler.ingestSegment(segment)
          const isLastSegmentInWindow = i === validSegments.length - 1
          const hasMoreQueuedForSameSource = this.pendingAudioWindows.some(
            (w) => w.source === segment.source
          )

          const shouldHoldForContinuation =
            Boolean(segment.isForcedSplit) ||
            hasIncompleteTrailingClause(segment.text) ||
            (isLastSegmentInWindow && hasMoreQueuedForSameSource)

          if (!shouldHoldForContinuation && this.utteranceAssembler.hasPending(segment.source)) {
            this.clearUtteranceSettleTimer(segment.source)
            const flushed = this.utteranceAssembler.flushSource(
              segment.source,
              'silence_boundary'
            )
            if (flushed) {
              emittedUtterances.push(flushed)
            }
          } else if (this.utteranceAssembler.hasPending(segment.source)) {
            this.scheduleUtteranceSettleFlush(segment.source, currentGen)
          } else {
            this.clearUtteranceSettleTimer(segment.source)
          }

          for (const utterance of emittedUtterances) {
            await this.evaluateAndDispatchUtterance(utterance, currentGen)
          }
        }
      }
    } catch (err) {
      if (
        abortController.signal.aborted ||
        this.sessionGeneration !== currentGen ||
        (err instanceof Error &&
          (err.name === 'AbortError' || err.message.toLowerCase().includes('abort')))
      ) {
        return
      }
      console.error('Transcription inference error:', err)
    } finally {
      if (this.sessionGeneration === currentGen) {
        this.isProcessingWindow = false
        this.isTranscribing = false
        this.currentTranscribingSource = null
        this.currentAbortController = null
        this.notifyStateChanged()

        if (this.pendingAudioWindows.length > 0 && !this.isPaused) {
          const nextWindow = this.pendingAudioWindows.shift()!
          void this.processAudioWindow(nextWindow)
        }
      }
    }
  }

  private isSourceBusyWithSpeechOrStt(source: AudioSourceKind): boolean {
    const assembler = source === 'mic' ? this.micAssembler : this.systemAssembler
    if (assembler.getAccumulatedSpeechDurationMs() > 0) {
      return true
    }
    if (this.currentTranscribingSource === source) {
      return true
    }
    return this.pendingAudioWindows.some((w) => w.source === source)
  }

  private scheduleUtteranceSettleFlush(source: AudioSourceKind, expectedGen: number): void {
    this.clearUtteranceSettleTimer(source)
    const timer = setTimeout(() => {
      this.utteranceSettleTimers.delete(source)
      if (this.sessionGeneration !== expectedGen || this.isPaused) {
        return
      }
      if (!this.utteranceAssembler.hasPending(source)) {
        return
      }
      if (this.isSourceBusyWithSpeechOrStt(source)) {
        this.scheduleUtteranceSettleFlush(source, expectedGen)
        return
      }
      const flushed = this.utteranceAssembler.flushSource(source, 'silence_boundary')
      if (flushed) {
        void this.evaluateAndDispatchUtterance(flushed, expectedGen)
      }
    }, this.utteranceSettleMs)
    this.utteranceSettleTimers.set(source, timer)
  }

  private clearUtteranceSettleTimer(source?: AudioSourceKind): void {
    if (source) {
      const timer = this.utteranceSettleTimers.get(source)
      if (timer) {
        clearTimeout(timer)
        this.utteranceSettleTimers.delete(source)
      }
      return
    }
    for (const timer of this.utteranceSettleTimers.values()) {
      clearTimeout(timer)
    }
    this.utteranceSettleTimers.clear()
  }

  private abortAllClassifiers(): void {
    for (const controller of this.activeClassifierAbortControllers) {
      controller.abort()
    }
    this.activeClassifierAbortControllers.clear()
    this.isClassifying = false
  }

  private async evaluateAndDispatchUtterance(
    utterance: AssembledUtterance,
    expectedGen: number
  ): Promise<void> {
    if (this.sessionGeneration !== expectedGen || this.isPaused) {
      return
    }

    this.addUtterance(utterance)

    const classifierAbort = new AbortController()
    this.activeClassifierAbortControllers.add(classifierAbort)
    this.isClassifying = true
    this.notifyStateChanged()

    try {
      const outcome = await this.decisionEngine.evaluateUtterance(
        utterance,
        classifierAbort.signal
      )

      if (
        !outcome ||
        this.sessionGeneration !== expectedGen ||
        classifierAbort.signal.aborted ||
        this.isPaused
      ) {
        return
      }

      this.addEvaluation(outcome.evaluation)

      if (outcome.candidate) {
        this.questionControls.submitCandidate(
          outcome.candidate,
          (readyOrSuggestCandidate) => {
            if (this.sessionGeneration === expectedGen && !this.isPaused) {
              this.addQuestion(readyOrSuggestCandidate)
              this.notifyStateChanged()
            }
          },
          () => {
            if (this.sessionGeneration === expectedGen && !this.isPaused) {
              this.notifyStateChanged()
            }
          }
        )
      }
    } finally {
      this.activeClassifierAbortControllers.delete(classifierAbort)
      if (this.sessionGeneration === expectedGen) {
        this.isClassifying = this.activeClassifierAbortControllers.size > 0
        this.notifyStateChanged()
      }
    }
  }

  private addSegment(segment: TranscriptSegment): void {
    this.segments.push(segment)
    if (this.segments.length > this.maxSegments) {
      this.segments.shift()
    }
  }

  private addUtterance(utterance: AssembledUtterance): void {
    this.utterances.push(utterance)
    if (this.utterances.length > this.maxUtterances) {
      this.utterances.shift()
    }
  }

  private addEvaluation(evaluation: IntentEvaluationRecord): void {
    this.evaluations.push(evaluation)
    if (this.evaluations.length > this.maxEvaluations) {
      this.evaluations.shift()
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

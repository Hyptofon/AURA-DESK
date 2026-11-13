/**
 * Question Candidate Controls.
 * Enforces debounce settling, confidence filtering, cooldown intervals,
 * cross-source deduplication, bounded memory, and instant cancellation on stop/pause.
 */

import type { QuestionCandidate, QuestionCandidateStatus } from '@/shared/contracts/questions'

export interface QuestionControlsOptions {
  minConfidence?: number // Minimum confidence threshold, default: 0.75
  debounceMs?: number // Delay to allow speech utterance to settle, default: 1200ms
  cooldownMs?: number // Cooldown interval before allowing duplicate/similar questions, default: 5000ms
  maxHistory?: number // Maximum recent questions retained for deduplication, default: 30
  clock?: () => number // Injectable clock for deterministic tests
}

export type CandidateFilterReason =
  | 'low_confidence'
  | 'cooldown_active'
  | 'cross_source_duplicate'

export interface FilterResult {
  accepted: boolean
  reason?: CandidateFilterReason
  candidate: QuestionCandidate
}

interface HistoryEntry {
  normalizedText: string
  timestamp: number
  source: string
}

export class QuestionControls {
  private readonly minConfidence: number
  private readonly debounceMs: number
  private readonly cooldownMs: number
  private readonly maxHistory: number
  private readonly clock: () => number

  private pendingTimer: NodeJS.Timeout | null = null
  private pendingCandidate: QuestionCandidate | null = null
  private history: HistoryEntry[] = []

  constructor(options: QuestionControlsOptions = {}) {
    this.minConfidence = options.minConfidence ?? 0.75
    this.debounceMs = options.debounceMs ?? 1200
    this.cooldownMs = options.cooldownMs ?? 5000
    this.maxHistory = options.maxHistory ?? 30
    this.clock = options.clock ?? (() => Date.now())
  }

  /**
   * Normalizes text for reliable deduplication:
   * trims whitespace, strips punctuation, collapses spaces, and converts to lowercase.
   */
  public normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"«»„“”’‘ʼ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Evaluates a question candidate against confidence threshold and cooldown history.
   */
  public filterCandidate(candidate: QuestionCandidate): FilterResult {
    const now = this.clock()

    // 1. Check confidence threshold
    if (candidate.confidence < this.minConfidence) {
      return {
        accepted: false,
        reason: 'low_confidence',
        candidate: { ...candidate, status: 'filtered' }
      }
    }

    const normalized = this.normalizeText(candidate.text)
    if (normalized.length === 0) {
      return {
        accepted: false,
        reason: 'low_confidence',
        candidate: { ...candidate, status: 'filtered' }
      }
    }

    // 2. Check pending candidate duplicate (prevents cross-source duplicate from hijacking debounce)
    if (this.pendingCandidate && this.normalizeText(this.pendingCandidate.text) === normalized) {
      const isCrossSource = this.pendingCandidate.source !== candidate.source
      return {
        accepted: false,
        reason: isCrossSource ? 'cross_source_duplicate' : 'cooldown_active',
        candidate: { ...candidate, status: 'filtered' }
      }
    }

    // 3. Check cooldown and deduplication history
    // Expire entries older than cooldownMs
    this.history = this.history.filter((entry) => now - entry.timestamp < this.cooldownMs)

    for (const entry of this.history) {
      if (entry.normalizedText === normalized) {
        const isCrossSource = entry.source !== candidate.source
        return {
          accepted: false,
          reason: isCrossSource ? 'cross_source_duplicate' : 'cooldown_active',
          candidate: { ...candidate, status: 'filtered' }
        }
      }
    }

    return {
      accepted: true,
      candidate
    }
  }

  /**
   * Submits a candidate through debounce control.
   * If accepted, cancels any previously pending debounce timer and schedules emission.
   */
  public submitCandidate(
    candidate: QuestionCandidate,
    onReady: (readyCandidate: QuestionCandidate) => void,
    onFiltered?: (filteredCandidate: QuestionCandidate, reason: CandidateFilterReason) => void
  ): void {
    const filter = this.filterCandidate(candidate)

    if (!filter.accepted) {
      if (onFiltered && filter.reason) {
        onFiltered(filter.candidate, filter.reason)
      }
      return
    }

    // Cancel pending debounce timer if a newer candidate arrives
    this.cancelPendingTimer()

    this.pendingCandidate = candidate

    // If debounceMs is 0 or negative, emit synchronously
    if (this.debounceMs <= 0) {
      this.emitReady(candidate, onReady)
      return
    }

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      if (this.pendingCandidate) {
        const toEmit = this.pendingCandidate
        this.pendingCandidate = null
        this.emitReady(toEmit, onReady)
      }
    }, this.debounceMs)
  }

  /**
   * Cancels in-flight debounce timer and discards pending candidate immediately.
   * Must be called on stop() and pause() to prevent unexpected late emissions.
   */
  public cancel(): void {
    this.cancelPendingTimer()
    this.pendingCandidate = null
  }

  /**
   * Resets both pending timer and deduplication history.
   */
  public reset(): void {
    this.cancel()
    this.history = []
  }

  public getHistorySize(): number {
    return this.history.length
  }

  public hasPending(): boolean {
    return this.pendingTimer !== null || this.pendingCandidate !== null
  }

  private emitReady(
    candidate: QuestionCandidate,
    onReady: (readyCandidate: QuestionCandidate) => void
  ): void {
    this.pendingCandidate = null
    const now = this.clock()
    const readyCandidate: QuestionCandidate = {
      ...candidate,
      status: 'ready' as QuestionCandidateStatus
    }

    // Record in cooldown history
    this.history.push({
      normalizedText: this.normalizeText(candidate.text),
      timestamp: now,
      source: candidate.source
    })

    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    onReady(readyCandidate)
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }
}

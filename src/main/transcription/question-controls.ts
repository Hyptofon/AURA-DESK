/**
 * Question Candidate Controls.
 * Enforces debounce settling, confidence/evidence filtering, cooldown intervals,
 * continuation vs near-duplicate vs distinct-question disambiguation,
 * bounded pending queue with explicit overflow diagnostics, and instant cancellation on stop/pause.
 */

import type { QuestionCandidate, QuestionCandidateStatus } from '@/shared/contracts/questions'

export interface QuestionControlsOptions {
  /** Minimum confidence threshold for 'ready'/'detected' candidates, default: 0.75 */
  minConfidence?: number
  /** Minimum confidence threshold for 'suggest' candidates, default: 0.50 */
  minSuggestConfidence?: number
  /** Delay to allow speech utterance to settle, default: 1200ms */
  debounceMs?: number
  /** Cooldown interval before allowing duplicate/similar questions, default: 5000ms */
  cooldownMs?: number
  /** Maximum recent questions retained for deduplication, default: 30 */
  maxHistory?: number
  /** Maximum distinct questions concurrently pending in debounce queue, default: 5 */
  maxPendingCandidates?: number
  /** Injectable clock for deterministic tests */
  clock?: () => number
}

export type CandidateFilterReason =
  | 'low_confidence'
  | 'cooldown_active'
  | 'cross_source_duplicate'
  | 'queue_overflow'

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

interface PendingEntry {
  id: string
  normalizedText: string
  candidate: QuestionCandidate
  timer: NodeJS.Timeout | null
}

export class QuestionControls {
  private readonly minConfidence: number
  private readonly minSuggestConfidence: number
  private readonly debounceMs: number
  private readonly cooldownMs: number
  private readonly maxHistory: number
  private readonly maxPendingCandidates: number
  private readonly clock: () => number

  private pendingQueue: PendingEntry[] = []
  private history: HistoryEntry[] = []
  private droppedCandidateCount = 0
  private lastCandidateDropReason: CandidateFilterReason | null = null

  constructor(options: QuestionControlsOptions = {}) {
    this.minConfidence = options.minConfidence ?? 0.75
    this.minSuggestConfidence = options.minSuggestConfidence ?? 0.5
    this.debounceMs = options.debounceMs ?? 1200
    this.cooldownMs = options.cooldownMs ?? 5000
    this.maxHistory = options.maxHistory ?? 30
    this.maxPendingCandidates = Math.max(1, options.maxPendingCandidates ?? 5)
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
   * Determines whether `incoming` is an incremental continuation or revision of `existing`
   * (e.g. "Що таке" -> "Що таке штучний інтелект?" or "Що таке штуч" -> "Що таке штучний інтелект?").
   * Never treats two distinct complete questions sharing only a polite/interrogative prefix
   * (e.g. "Can you explain closures?" vs "Can you explain promises?") as continuations.
   */
  public isContinuation(existingNormalized: string, incomingNormalized: string): boolean {
    if (!existingNormalized || !incomingNormalized) return false
    if (existingNormalized === incomingNormalized) return false

    if (
      incomingNormalized.startsWith(`${existingNormalized} `) ||
      existingNormalized.startsWith(`${incomingNormalized} `)
    ) {
      return true
    }

    const existingWords = existingNormalized.split(' ')
    const incomingWords = incomingNormalized.split(' ')
    if (incomingWords.length > existingWords.length && existingWords.length >= 2) {
      let allButLastMatch = true
      for (let i = 0; i < existingWords.length - 1; i++) {
        if (existingWords[i] !== incomingWords[i]) {
          allButLastMatch = false
          break
        }
      }
      const lastExisting = existingWords[existingWords.length - 1]
      const correspondingIncoming = incomingWords[existingWords.length - 1]
      if (
        allButLastMatch &&
        lastExisting.length >= 2 &&
        correspondingIncoming.startsWith(lastExisting)
      ) {
        return true
      }
    }

    return false
  }

  /**
   * Determines whether two normalized strings represent the exact or near-duplicate question.
   */
  public isNearDuplicate(a: string, b: string): boolean {
    if (!a || !b) return false
    if (a === b) return true

    const wordsA = a.split(' ').filter((w) => w.length >= 2)
    const wordsB = b.split(' ').filter((w) => w.length >= 2)
    if (wordsA.length < 3 || wordsB.length < 3) {
      return false
    }

    const setA = new Set(wordsA)
    const setB = new Set(wordsB)
    let intersection = 0
    for (const w of setA) {
      if (setB.has(w)) {
        intersection += 1
      }
    }
    const union = new Set([...setA, ...setB]).size
    return union > 0 && intersection / union >= 0.85
  }

  /**
   * Evaluates a question candidate against confidence threshold, pending duplicates, and cooldown history.
   */
  public filterCandidate(candidate: QuestionCandidate): FilterResult {
    const now = this.clock()
    const isSuggest = candidate.decision === 'suggest' || candidate.status === 'suggest'
    const threshold = isSuggest
      ? Math.min(this.minConfidence, this.minSuggestConfidence)
      : this.minConfidence

    if (candidate.confidence < threshold) {
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

    // Check against pending candidates for exact or near-duplicate (excluding same-source continuations)
    for (const pending of this.pendingQueue) {
      if (this.isNearDuplicate(pending.normalizedText, normalized)) {
        const isCrossSource = pending.candidate.source !== candidate.source
        return {
          accepted: false,
          reason: isCrossSource ? 'cross_source_duplicate' : 'cooldown_active',
          candidate: { ...candidate, status: 'filtered' }
        }
      }
    }

    // Expire cooldown entries older than cooldownMs
    this.history = this.history.filter((entry) => now - entry.timestamp < this.cooldownMs)

    for (const entry of this.history) {
      if (this.isNearDuplicate(entry.normalizedText, normalized)) {
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
   * Submits a candidate through debounce and queue control.
   * - Same-source continuation updates the matching pending entry and resets its timer.
   * - Distinct questions are preserved in `pendingQueue` up to `maxPendingCandidates`.
   * - Overflowing candidates are rejected with explicit `queue_overflow` reason.
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

    const normalized = this.normalizeText(candidate.text)

    // Check if incoming candidate is a continuation/revision of a pending candidate on the same source
    const continuationIdx = this.pendingQueue.findIndex(
      (entry) =>
        entry.candidate.source === candidate.source &&
        this.isContinuation(entry.normalizedText, normalized)
    )

    if (continuationIdx !== -1) {
      const existing = this.pendingQueue[continuationIdx]
      if (existing.timer) {
        clearTimeout(existing.timer)
        existing.timer = null
      }
      existing.candidate = candidate
      existing.normalizedText = normalized

      if (this.debounceMs <= 0) {
        this.pendingQueue.splice(continuationIdx, 1)
        this.emitReady(candidate, onReady)
        return
      }

      existing.timer = setTimeout(() => {
        this.removePendingById(existing.id)
        this.emitReady(existing.candidate, onReady)
      }, this.debounceMs)
      return
    }

    // Genuinely distinct question
    if (this.debounceMs <= 0) {
      this.emitReady(candidate, onReady)
      return
    }

    if (this.pendingQueue.length >= this.maxPendingCandidates) {
      this.droppedCandidateCount += 1
      this.lastCandidateDropReason = 'queue_overflow'
      if (onFiltered) {
        onFiltered({ ...candidate, status: 'filtered' }, 'queue_overflow')
      }
      return
    }

    const entry: PendingEntry = {
      id: candidate.id,
      normalizedText: normalized,
      candidate,
      timer: null
    }

    entry.timer = setTimeout(() => {
      this.removePendingById(entry.id)
      this.emitReady(entry.candidate, onReady)
    }, this.debounceMs)

    this.pendingQueue.push(entry)
  }

  /**
   * Cancels all in-flight debounce timers and discards pending candidates immediately.
   * Must be called on stop() and pause() to prevent unexpected late emissions.
   */
  public cancel(): void {
    for (const entry of this.pendingQueue) {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
    }
    this.pendingQueue = []
  }

  /**
   * Resets pending timers, deduplication history, and overflow counters.
   */
  public reset(): void {
    this.cancel()
    this.history = []
    this.droppedCandidateCount = 0
    this.lastCandidateDropReason = null
  }

  public getHistorySize(): number {
    return this.history.length
  }

  public hasPending(): boolean {
    return this.pendingQueue.length > 0
  }

  public getPendingCount(): number {
    return this.pendingQueue.length
  }

  public getDroppedCount(): number {
    return this.droppedCandidateCount
  }

  public getLastDropReason(): CandidateFilterReason | null {
    return this.lastCandidateDropReason
  }

  private removePendingById(id: string): void {
    const idx = this.pendingQueue.findIndex((entry) => entry.id === id)
    if (idx !== -1) {
      const [removed] = this.pendingQueue.splice(idx, 1)
      if (removed?.timer) {
        clearTimeout(removed.timer)
      }
    }
  }

  private emitReady(
    candidate: QuestionCandidate,
    onReady: (readyCandidate: QuestionCandidate) => void
  ): void {
    const now = this.clock()
    const targetStatus: QuestionCandidateStatus =
      candidate.decision === 'suggest' || candidate.status === 'suggest' ? 'suggest' : 'ready'

    const emittedCandidate: QuestionCandidate = {
      ...candidate,
      status: targetStatus
    }

    this.history.push({
      normalizedText: this.normalizeText(candidate.text),
      timestamp: now,
      source: candidate.source
    })

    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    onReady(emittedCandidate)
  }
}

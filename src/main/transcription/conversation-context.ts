/**
 * Bounded Ephemeral Conversation Context Window.
 * Maintains recent finalized utterances in RAM to resolve elliptical follow-ups
 * and topic continuity without claiming speaker identity or persisting to disk.
 */

import type { AudioSourceKind } from '@/shared/contracts/audio'
import type { DetectedLanguage } from '@/shared/contracts/transcription'
import type {
  AssembledUtterance,
  ConversationIntent,
  IntentDecision
} from '@/shared/contracts/questions'

export interface ConversationTurn {
  utteranceId: string
  source: AudioSourceKind
  startTimestamp: number
  endTimestamp: number
  text: string
  language: DetectedLanguage
  intent: ConversationIntent
  decision: IntentDecision
  wasQuestionOrRequest: boolean
  topicKeywords: string[]
  estimatedTokens: number
}

export interface ConversationContextSnapshot {
  turns: readonly ConversationTurn[]
  lastTurn: ConversationTurn | null
  timeSinceLastTurnMs: number | null
  hasRecentQuestionOrRequest: boolean
  hasRecentTechnicalDiscussion: boolean
  sharedTopicKeywords: string[]
  totalEstimatedTokens: number
}

export interface ConversationContextOptions {
  /** Maximum number of recent finalized turns kept in context. Default: 6 */
  maxTurns?: number
  /** Maximum age of a context turn in milliseconds before expiry. Default: 180000ms (3 min) */
  maxAgeMs?: number
  /** Maximum estimated token budget across all retained context turns. Default: 400 */
  maxTokens?: number
  /** Maximum age in ms for a previous question/request to boost a short follow-up. Default: 90000ms (90s) */
  followUpWindowMs?: number
}

const STOPWORDS = new Set([
  // Ukrainian common function words
  'що',
  'як',
  'де',
  'коли',
  'чому',
  'хто',
  'чи',
  'це',
  'цей',
  'ця',
  'це',
  'ці',
  'той',
  'та',
  'ті',
  'мій',
  'моє',
  'моя',
  'мої',
  'твій',
  'наш',
  'ваш',
  'він',
  'вона',
  'воно',
  'вони',
  'ми',
  'ви',
  'ти',
  'я',
  'не',
  'ні',
  'так',
  'але',
  'або',
  'бо',
  'тому',
  'якщо',
  'щоб',
  'при',
  'про',
  'для',
  'від',
  'до',
  'на',
  'по',
  'за',
  'під',
  'над',
  'між',
  'без',
  'через',
  'після',
  'перед',
  'тут',
  'там',
  'тоді',
  'зараз',
  'дуже',
  'ще',
  'вже',
  'тільки',
  'лише',
  'будь',
  'ласка',
  'можна',
  'треба',
  'потрібно',
  // English common function words
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'have',
  'has',
  'had',
  'not',
  'are',
  'was',
  'were',
  'been',
  'will',
  'would',
  'could',
  'should',
  'can',
  'what',
  'why',
  'how',
  'where',
  'when',
  'who',
  'which',
  'about',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'there',
  'here',
  'then',
  'than',
  'very',
  'just',
  'only',
  'also',
  'please',
  'does',
  'did',
  'your',
  'our',
  'their',
  'some',
  'any'
])

export function estimateTextTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  // Conservative token approximation for Ukrainian/English text (~3.5 chars per token)
  return Math.max(1, Math.ceil(trimmed.length / 3.5))
}

export function extractTopicKeywords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"«»„“”’‘ʼ[\]\\|<>]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))

  return Array.from(new Set(cleaned)).slice(0, 10)
}

export function isQuestionOrRequestIntent(
  intent: ConversationIntent,
  decision: IntentDecision
): boolean {
  if (decision === 'ready' || decision === 'suggest') {
    return true
  }
  return (
    intent === 'direct_question' ||
    intent === 'indirect_question' ||
    intent === 'explanation_request' ||
    intent === 'help_request' ||
    intent === 'clarification_request' ||
    intent === 'contextual_follow_up'
  )
}

export class ConversationContext {
  private readonly maxTurns: number
  private readonly maxAgeMs: number
  private readonly maxTokens: number
  private readonly followUpWindowMs: number

  private turns: ConversationTurn[] = []

  constructor(options: ConversationContextOptions = {}) {
    this.maxTurns = options.maxTurns ?? 6
    this.maxAgeMs = options.maxAgeMs ?? 180000
    this.maxTokens = options.maxTokens ?? 400
    this.followUpWindowMs = options.followUpWindowMs ?? 90000
  }

  /**
   * Records a finalized utterance and its classification outcome into the bounded context window.
   */
  public recordTurn(
    utterance: AssembledUtterance,
    intent: ConversationIntent,
    decision: IntentDecision
  ): void {
    const referenceNow = utterance.endTimestamp
    this.pruneExpired(referenceNow)

    const cleanText = utterance.text.trim().slice(0, 400)
    if (!cleanText) return

    const turn: ConversationTurn = {
      utteranceId: utterance.id,
      source: utterance.source,
      startTimestamp: utterance.startTimestamp,
      endTimestamp: utterance.endTimestamp,
      text: cleanText,
      language: utterance.language,
      intent,
      decision,
      wasQuestionOrRequest: isQuestionOrRequestIntent(intent, decision),
      topicKeywords: extractTopicKeywords(cleanText),
      estimatedTokens: estimateTextTokens(cleanText)
    }

    this.turns.push(turn)
    this.enforceBounds()
  }

  /**
   * Produces a read-only snapshot of relevant recent context for evaluating `currentUtterance`.
   */
  public getSnapshot(currentUtterance: AssembledUtterance): ConversationContextSnapshot {
    const nowMs = currentUtterance.startTimestamp
    this.pruneExpired(nowMs)

    if (this.turns.length === 0) {
      return {
        turns: [],
        lastTurn: null,
        timeSinceLastTurnMs: null,
        hasRecentQuestionOrRequest: false,
        hasRecentTechnicalDiscussion: false,
        sharedTopicKeywords: [],
        totalEstimatedTokens: 0
      }
    }

    const lastTurn = this.turns[this.turns.length - 1]
    const timeSinceLastTurnMs = Math.max(0, nowMs - lastTurn.endTimestamp)

    const recentTurnsInWindow = this.turns.filter(
      (t) => nowMs - t.endTimestamp <= this.followUpWindowMs
    )

    const hasRecentQuestionOrRequest = recentTurnsInWindow.some((t) => t.wasQuestionOrRequest)
    const hasRecentTechnicalDiscussion =
      recentTurnsInWindow.length > 0 &&
      recentTurnsInWindow.some((t) => t.topicKeywords.length >= 1 || t.wasQuestionOrRequest)

    const currentKeywords = new Set(extractTopicKeywords(currentUtterance.text))
    const contextKeywordSet = new Set<string>()
    for (const t of recentTurnsInWindow) {
      for (const kw of t.topicKeywords) {
        if (currentKeywords.has(kw)) {
          contextKeywordSet.add(kw)
        }
      }
    }

    const totalEstimatedTokens = this.turns.reduce((acc, t) => acc + t.estimatedTokens, 0)

    return {
      turns: [...this.turns],
      lastTurn,
      timeSinceLastTurnMs,
      hasRecentQuestionOrRequest,
      hasRecentTechnicalDiscussion,
      sharedTopicKeywords: Array.from(contextKeywordSet),
      totalEstimatedTokens
    }
  }

  public getTurnCount(): number {
    return this.turns.length
  }

  public clear(): void {
    this.turns = []
  }

  private pruneExpired(nowMs: number): void {
    this.turns = this.turns.filter((t) => nowMs - t.endTimestamp <= this.maxAgeMs)
  }

  private enforceBounds(): void {
    while (this.turns.length > this.maxTurns) {
      this.turns.shift()
    }

    let totalTokens = this.turns.reduce((sum, t) => sum + t.estimatedTokens, 0)
    while (this.turns.length > 1 && totalTokens > this.maxTokens) {
      const removed = this.turns.shift()
      if (removed) {
        totalTokens -= removed.estimatedTokens
      }
    }
  }
}

/**
 * Intent-Focused Question & Request Detector for Ukrainian, English, and Mixed Speech.
 * Replaces legacy first-word keyword heuristics with LocalIntentAnalyzer and ConversationContext.
 * Also exports `detectLegacyQuestionBaseline` strictly for empirical benchmarking (Section 11).
 */

import type { DetectedLanguage, TranscriptSegment } from '@/shared/contracts/transcription'
import type {
  AddresseeAssessment,
  AssembledUtterance,
  ConversationIntent,
  EvidenceStrength,
  IntentDecision,
  QuestionCandidate
} from '@/shared/contracts/questions'
import type { ConversationContextSnapshot } from './conversation-context'
import { LocalIntentAnalyzer, type LocalIntentAnalysisResult } from './local-intent-analyzer'
import { normalizeUtteranceText } from './utterance-assembler'

const defaultAnalyzer = new LocalIntentAnalyzer()

export interface DetectionResult {
  isQuestion: boolean
  intent: ConversationIntent
  decision: IntentDecision
  evidenceStrength: EvidenceStrength
  /** Heuristic evidence score [0, 1] derived from evidenceStrength; NOT a calibrated probability */
  confidence: number
  language: DetectedLanguage
  requiresResponse: boolean
  addressee: AddresseeAssessment
  contextUsed: boolean
  evidence: string[]
  uncertain: boolean
  isAmbiguous: boolean
  matchedPattern?: string
}

/**
 * Maps categorical heuristic evidence strength to a transparent numeric score for candidate sorting/compatibility.
 * Avoids arbitrary 0.95/0.85 punctuation inflation.
 */
export function evidenceStrengthToHeuristicScore(
  strength: EvidenceStrength,
  decision: IntentDecision
): number {
  if (decision === 'ignore' || strength === 'none') return 0
  if (strength === 'strong') return 0.9
  if (strength === 'moderate') return decision === 'ready' ? 0.8 : 0.75
  return 0.5
}

/**
 * Evaluates text (with optional recent conversation context) using the intent-focused analyzer.
 */
export function detectQuestionInText(
  text: string,
  context?: ConversationContextSnapshot
): DetectionResult {
  const analysis: LocalIntentAnalysisResult = defaultAnalyzer.analyze(
    {
      text,
      source: 'mic',
      language: 'unknown'
    },
    context
  )

  const isActionableOrSuggested = analysis.decision === 'ready' || analysis.decision === 'suggest'
  const confidence = evidenceStrengthToHeuristicScore(analysis.evidenceStrength, analysis.decision)

  return {
    isQuestion: isActionableOrSuggested,
    intent: analysis.intent,
    decision: analysis.decision,
    evidenceStrength: analysis.evidenceStrength,
    confidence,
    language: analysis.language,
    requiresResponse: analysis.requiresResponse,
    addressee: analysis.addressee,
    contextUsed: analysis.contextUsed,
    evidence: analysis.evidence,
    uncertain: analysis.uncertain,
    isAmbiguous: analysis.isAmbiguous,
    matchedPattern: analysis.matchedPattern
  }
}

/**
 * Evaluates an AssembledUtterance (or finalized TranscriptSegment) and creates a QuestionCandidate
 * when the decision is 'ready' or 'suggest'.
 */
export function evaluateUtteranceForQuestion(
  utterance: AssembledUtterance,
  context?: ConversationContextSnapshot
): { candidate: QuestionCandidate | null; analysis: LocalIntentAnalysisResult } {
  const analysis = defaultAnalyzer.analyze(utterance, context)
  if (analysis.decision === 'ignore') {
    return { candidate: null, analysis }
  }

  const confidence = evidenceStrengthToHeuristicScore(analysis.evidenceStrength, analysis.decision)
  const primarySegmentId = utterance.segmentIds[utterance.segmentIds.length - 1] ?? utterance.id

  const candidate: QuestionCandidate = {
    id: `q-${utterance.id}`,
    segmentId: primarySegmentId,
    source: utterance.source,
    timestamp: utterance.startTimestamp,
    endTimestamp: utterance.endTimestamp,
    text: utterance.text,
    language: analysis.language,
    confidence,
    evidenceStrength: analysis.evidenceStrength,
    intent: analysis.intent,
    decision: analysis.decision,
    route: 'local',
    contextUsed: analysis.contextUsed,
    requiresResponse: analysis.requiresResponse,
    addressee: analysis.addressee,
    evidence: analysis.evidence,
    uncertain: analysis.uncertain,
    status: analysis.decision === 'suggest' ? 'suggest' : 'detected',
    matchedPattern: analysis.matchedPattern
  }

  return { candidate, analysis }
}

/**
 * Evaluates a finalized TranscriptSegment and creates a QuestionCandidate if detected.
 */
export function evaluateSegmentForQuestion(
  segment: TranscriptSegment,
  context?: ConversationContextSnapshot
): QuestionCandidate | null {
  if (!segment.isFinal || !segment.text) {
    return null
  }

  const utterance: AssembledUtterance = {
    id: segment.id,
    source: segment.source,
    startTimestamp: segment.startTimestamp,
    endTimestamp: segment.endTimestamp,
    text: segment.text,
    normalizedText: normalizeUtteranceText(segment.text),
    language: segment.language ?? 'unknown',
    segmentIds: [segment.id],
    fragmentCount: 1,
    isComplete: true,
    flushReason: 'silence_boundary'
  }

  const { candidate } = evaluateUtteranceForQuestion(utterance, context)
  return candidate
}

/**
 * Legacy keyword-based detector preserved strictly as Baseline A for empirical evaluation (Section 11).
 * Do NOT use in production pipeline.
 */
export function detectLegacyQuestionBaseline(text: string): {
  isQuestion: boolean
  decision: IntentDecision
  confidence: number
} {
  const trimmed = text.trim()
  if (trimmed.length < 3) {
    return { isQuestion: false, decision: 'ignore', confidence: 0 }
  }
  const lower = trimmed.toLowerCase()
  const hasQuestionMark = trimmed.includes('?')
  const words = lower
    .replace(/["'«»“”„’`?.,/#!$%^&*;:{}=\-_~()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const firstWord = words[0] || ''
  const secondWord = words[1] || ''

  const ukWords = [
    'що',
    'чому',
    'як',
    'де',
    'коли',
    'хто',
    'який',
    'яка',
    'яке',
    'які',
    'чи',
    'навіщо',
    'скільки',
    'куди',
    'звідки'
  ]
  const enWords = ['what', 'why', 'how', 'where', 'when', 'who', 'which', 'whose', 'whom']
  const prefixes = ['а', 'і', 'та', 'ну', 'от', 'тож', 'and', 'so', 'well', 'now', 'then', 'but']

  if (
    ukWords.includes(firstWord) ||
    enWords.includes(firstWord) ||
    (prefixes.includes(firstWord) && (ukWords.includes(secondWord) || enWords.includes(secondWord)))
  ) {
    return { isQuestion: true, decision: 'ready', confidence: hasQuestionMark ? 0.95 : 0.85 }
  }

  if (hasQuestionMark && words.length >= 2) {
    return { isQuestion: true, decision: 'ready', confidence: 0.8 }
  }

  return { isQuestion: false, decision: 'ignore', confidence: 0 }
}

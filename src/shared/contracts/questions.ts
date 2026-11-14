/**
 * Zero-dependency contracts for Conversation Intent Detection, Question Candidates,
 * Utterance Assembly, and Transcription Session State.
 */

import type { AudioSourceKind } from './audio'
import type { DetectedLanguage, TranscriptSegment } from './transcription'

export type ConversationIntent =
  | 'direct_question'
  | 'indirect_question'
  | 'explanation_request'
  | 'help_request'
  | 'clarification_request'
  | 'contextual_follow_up'
  | 'statement'
  | 'reported_question'
  | 'rhetorical_question'
  | 'other'
  | 'uncertain'

export type IntentDecision = 'ignore' | 'suggest' | 'ready'

export type ClassificationRoute = 'local' | 'openrouter'

export type AddresseeAssessment =
  | 'assistant_or_user'
  | 'group_or_classroom'
  | 'third_party'
  | 'self_talk'
  | 'unknown'

export type EvidenceStrength = 'none' | 'weak' | 'moderate' | 'strong'

export type UtteranceFlushReason =
  | 'silence_boundary'
  | 'sentence_boundary'
  | 'max_duration'
  | 'max_fragments'
  | 'max_characters'
  | 'source_switch'
  | 'manual_flush'

export interface AssembledUtterance {
  id: string
  source: AudioSourceKind
  startTimestamp: number
  endTimestamp: number
  text: string
  normalizedText: string
  language: DetectedLanguage
  segmentIds: string[]
  fragmentCount: number
  isComplete: boolean
  flushReason: UtteranceFlushReason
}

export interface IntentEvaluationRecord {
  utteranceId: string
  source: AudioSourceKind
  startTimestamp: number
  endTimestamp: number
  text: string
  language: DetectedLanguage
  intent: ConversationIntent
  decision: IntentDecision
  route: ClassificationRoute
  evidenceStrength: EvidenceStrength
  requiresResponse: boolean
  addressee: AddresseeAssessment
  contextUsed: boolean
  evidence: string[]
  uncertain: boolean
  latencyMs: number
  modelId?: string
  providerError?: string
}

export type SupportedClassifierModel =
  | 'google/gemini-3.1-flash-lite'
  | 'google/gemini-2.5-flash-lite'
  | 'google/gemini-3.5-flash-lite'

export interface SemanticClassifierConfig {
  enabled: boolean
  userConsentGranted: boolean
  model?: SupportedClassifierModel
  preferZdr?: boolean
}

export interface SemanticClassifierStatus {
  enabled: boolean
  userConsentGranted: boolean
  providerAvailable: boolean
  configuredModel: SupportedClassifierModel
  zdrPreferred: boolean
  requestCount: number
  maxRequests: number
  totalSpentUsd: number
  budgetUsd: number
  lastError: string | null
}

export interface PipelineDiagnostics {
  queuedWindowCount: number
  droppedWindowCount: number
  lastDropReason: string | null
  pendingCandidateCount: number
  droppedCandidateCount: number
  lastCandidateDropReason: string | null
  utteranceCount: number
}

export type QuestionCandidateStatus = 'detected' | 'filtered' | 'suggest' | 'ready'

export interface QuestionCandidate {
  id: string
  segmentId: string
  source: AudioSourceKind
  timestamp: number
  endTimestamp?: number
  text: string
  language: DetectedLanguage
  /** Heuristic evidence score in range [0, 1]; not a calibrated probability */
  confidence: number
  evidenceStrength?: EvidenceStrength
  intent?: ConversationIntent
  decision?: IntentDecision
  route?: ClassificationRoute
  contextUsed?: boolean
  requiresResponse?: boolean
  addressee?: AddresseeAssessment
  evidence?: string[]
  uncertain?: boolean
  status: QuestionCandidateStatus
  matchedPattern?: string
}

export interface TranscriptionSessionState {
  latestSegment: TranscriptSegment | null
  latestUtterance?: AssembledUtterance | null
  latestEvaluation?: IntentEvaluationRecord | null
  latestQuestion: QuestionCandidate | null
  segmentCount: number
  questionCount: number
  isTranscribing: boolean
  isClassifying?: boolean
  semanticClassifier?: SemanticClassifierStatus
  diagnostics?: PipelineDiagnostics
}

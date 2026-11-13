/**
 * Zero-dependency contracts for Question Candidates and Transcription State.
 */

import type { AudioSourceKind } from './audio'
import type { TranscriptSegment } from './transcription'

export type QuestionCandidateStatus = 'detected' | 'filtered' | 'ready'

export interface QuestionCandidate {
  id: string
  segmentId: string
  source: AudioSourceKind
  timestamp: number
  text: string
  language: 'uk' | 'en' | 'unknown'
  confidence: number // Heuristic confidence in range [0, 1]
  status: QuestionCandidateStatus
  matchedPattern?: string
}

export interface TranscriptionSessionState {
  latestSegment: TranscriptSegment | null
  latestQuestion: QuestionCandidate | null
  segmentCount: number
  questionCount: number
  isTranscribing: boolean
}

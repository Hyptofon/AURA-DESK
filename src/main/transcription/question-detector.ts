/**
 * Local Heuristic Question Candidate Detector for Ukrainian and English.
 * Evaluates finalized transcript text for interrogative words, sentence structure,
 * question marks, and request patterns without relying solely on punctuation.
 */

import type { TranscriptSegment } from '@/shared/contracts/transcription'
import type { QuestionCandidate } from '@/shared/contracts/questions'

const UK_INTERROGATIVE_WORDS = [
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

const UK_CONVERSATIONAL_PREFIXES = ['а', 'і', 'та', 'ну', 'от', 'тож']

const UK_REQUEST_PATTERNS = [
  'можеш пояснити',
  'можете пояснити',
  'чи можеш',
  'чи можете',
  'підкажи',
  'підкажіть',
  'поясни',
  'поясніть',
  'розкажи',
  'розкажіть',
  'допоможи',
  'допоможіть',
  'як зробити',
  'як це зробити',
  'скажи',
  'скажіть'
]

const EN_INTERROGATIVE_WORDS = [
  'what',
  'why',
  'how',
  'where',
  'when',
  'who',
  'which',
  'whose',
  'whom'
]

const EN_CONVERSATIONAL_PREFIXES = ['and', 'so', 'well', 'now', 'then', 'but']

const EN_REQUEST_PATTERNS = [
  'can you',
  'could you',
  'would you',
  'can someone',
  'could anyone',
  'is there',
  'are there',
  'do you',
  'does this',
  'did you',
  'will this',
  'should we',
  'explain this',
  'please explain',
  'tell me'
]

export interface DetectionResult {
  isQuestion: boolean
  confidence: number // Heuristic confidence in range [0, 1]
  language: 'uk' | 'en' | 'unknown'
  matchedPattern?: string
}

/**
 * Detects whether a text segment represents a question candidate.
 */
export function detectQuestionInText(text: string): DetectionResult {
  const trimmed = text.trim()
  if (trimmed.length < 3) {
    return { isQuestion: false, confidence: 0, language: 'unknown' }
  }

  // Detect predominant alphabet
  const hasCyrillic = /[\u0400-\u04FF]/.test(trimmed)
  const hasLatin = /[a-zA-Z]/.test(trimmed)
  const language: 'uk' | 'en' | 'unknown' = hasCyrillic ? 'uk' : hasLatin ? 'en' : 'unknown'

  const lower = trimmed.toLowerCase()
  const hasQuestionMark = trimmed.endsWith('?') || trimmed.includes('?')

  // Normalize tokens: strip quotes, brackets, and punctuation safely
  const words = lower
    .replace(/["'«»“”„’`?.,/#!$%^&*;:{}=\-_~()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const firstWord = words[0] || ''
  const secondWord = words[1] || ''

  // 1. Ukrainian detection
  if (language === 'uk' || language === 'unknown') {
    if (UK_INTERROGATIVE_WORDS.includes(firstWord)) {
      return {
        isQuestion: true,
        confidence: hasQuestionMark ? 0.95 : 0.85,
        language: 'uk',
        matchedPattern: firstWord
      }
    }

    if (UK_CONVERSATIONAL_PREFIXES.includes(firstWord) && UK_INTERROGATIVE_WORDS.includes(secondWord)) {
      return {
        isQuestion: true,
        confidence: hasQuestionMark ? 0.95 : 0.85,
        language: 'uk',
        matchedPattern: `${firstWord} ${secondWord}`
      }
    }

    for (const pattern of UK_REQUEST_PATTERNS) {
      if (lower.startsWith(pattern) || lower.includes(pattern)) {
        return {
          isQuestion: true,
          confidence: hasQuestionMark ? 0.95 : 0.9,
          language: 'uk',
          matchedPattern: pattern
        }
      }
    }
  }

  // 2. English detection
  if (language === 'en' || language === 'unknown') {
    if (EN_INTERROGATIVE_WORDS.includes(firstWord)) {
      return {
        isQuestion: true,
        confidence: hasQuestionMark ? 0.95 : 0.85,
        language: 'en',
        matchedPattern: firstWord
      }
    }

    if (EN_CONVERSATIONAL_PREFIXES.includes(firstWord) && EN_INTERROGATIVE_WORDS.includes(secondWord)) {
      return {
        isQuestion: true,
        confidence: hasQuestionMark ? 0.95 : 0.85,
        language: 'en',
        matchedPattern: `${firstWord} ${secondWord}`
      }
    }

    for (const pattern of EN_REQUEST_PATTERNS) {
      if (lower.startsWith(pattern) || lower.includes(pattern)) {
        return {
          isQuestion: true,
          confidence: hasQuestionMark ? 0.95 : 0.9,
          language: 'en',
          matchedPattern: pattern
        }
      }
    }
  }

  // 3. Fallback: Ending question mark on meaningful sentences (>= 3 words)
  if (hasQuestionMark && words.length >= 2) {
    return {
      isQuestion: true,
      confidence: 0.8,
      language,
      matchedPattern: '?'
    }
  }

  return { isQuestion: false, confidence: 0, language }
}

/**
 * Evaluates a finalized TranscriptSegment and creates a QuestionCandidate if detected.
 */
export function evaluateSegmentForQuestion(segment: TranscriptSegment): QuestionCandidate | null {
  if (!segment.isFinal || !segment.text) {
    return null
  }

  const detection = detectQuestionInText(segment.text)
  if (!detection.isQuestion) {
    return null
  }

  return {
    id: `q-${segment.id}`,
    segmentId: segment.id,
    source: segment.source,
    timestamp: segment.startTimestamp,
    text: segment.text,
    language: detection.language,
    confidence: detection.confidence,
    status: 'detected',
    matchedPattern: detection.matchedPattern
  }
}

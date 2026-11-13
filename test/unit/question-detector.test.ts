import { describe, it, expect } from 'vitest'
import {
  detectQuestionInText,
  evaluateSegmentForQuestion
} from '@/main/transcription/question-detector'
import type { TranscriptSegment } from '@/shared/contracts/transcription'

describe('question-detector: detectQuestionInText & evaluateSegmentForQuestion', () => {
  describe('detectQuestionInText — Ukrainian', () => {
    it('detects Ukrainian interrogative with question mark (high confidence)', () => {
      const res = detectQuestionInText('Що таке алгоритм сортування?')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('uk')
      expect(res.confidence).toBe(0.95)
      expect(res.matchedPattern).toBe('що')
    })

    it('detects Ukrainian question with request pattern without question mark', () => {
      const res = detectQuestionInText('Можеш пояснити цей код')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('uk')
      expect(res.confidence).toBe(0.9)
      expect(res.matchedPattern).toBe('можеш пояснити')
    })

    it('detects Ukrainian question why without question mark', () => {
      const res = detectQuestionInText('Чому виникає ця помилка у збірці')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('uk')
      expect(res.confidence).toBe(0.85)
      expect(res.matchedPattern).toBe('чому')
    })

    it('rejects ordinary Ukrainian statements', () => {
      const res = detectQuestionInText('Сьогодні гарна погода для програмування на комп’ютері.')
      expect(res.isQuestion).toBe(false)
      expect(res.confidence).toBe(0)
    })

    it('detects Ukrainian question wrapped in guillemets/quotes', () => {
      const res = detectQuestionInText('«Що таке алгоритм сортування?»')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('що')
    })

    it('detects conversational Ukrainian prefix followed by interrogative', () => {
      const res = detectQuestionInText('А що це означає у коді')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('а що')
    })

    it('detects polite Ukrainian request patterns', () => {
      const res = detectQuestionInText('Підкажіть, будь ласка, як це працює')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('підкажіть')
    })

    it('rejects Ukrainian statement containing що in non-question position', () => {
      const res = detectQuestionInText('Я точно знаю, що ця функція повертає число.')
      expect(res.isQuestion).toBe(false)
    })
  })

  describe('detectQuestionInText — English', () => {
    it('detects English 5W1H question with question mark', () => {
      const res = detectQuestionInText('What does this function do?')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('en')
      expect(res.confidence).toBe(0.95)
      expect(res.matchedPattern).toBe('what')
    })

    it('detects English request pattern without question mark', () => {
      const res = detectQuestionInText('Can you explain this')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('en')
      expect(res.confidence).toBe(0.9)
      expect(res.matchedPattern).toBe('can you')
    })

    it('detects English why question without question mark', () => {
      const res = detectQuestionInText('Why is this happening in production')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('en')
      expect(res.confidence).toBe(0.85)
      expect(res.matchedPattern).toBe('why')
    })

    it('detects conversational English prefix followed by interrogative', () => {
      const res = detectQuestionInText('So what does this function do')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('so what')
    })

    it('detects polite English requests', () => {
      const res = detectQuestionInText('Could anyone explain this issue')
      expect(res.isQuestion).toBe(true)
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('could anyone')
    })

    it('rejects ordinary English statements containing what in subordinate clause', () => {
      const res = detectQuestionInText('The engineer knows what needs to be changed.')
      expect(res.isQuestion).toBe(false)
    })

    it('rejects ordinary English statements', () => {
      const res = detectQuestionInText('The quick brown fox jumps over the lazy dog.')
      expect(res.isQuestion).toBe(false)
      expect(res.confidence).toBe(0)
    })
  })

  describe('detectQuestionInText — Edge Cases & Noise Rejection', () => {
    it('rejects short fragments and filler words', () => {
      expect(detectQuestionInText('').isQuestion).toBe(false)
      expect(detectQuestionInText('um').isQuestion).toBe(false)
      expect(detectQuestionInText('ok').isQuestion).toBe(false)
      expect(detectQuestionInText('так').isQuestion).toBe(false)
    })

    it('detects generic question mark fallback on multi-word sentence', () => {
      const res = detectQuestionInText('Really now?')
      expect(res.isQuestion).toBe(true)
      expect(res.confidence).toBe(0.8)
    })
  })

  describe('evaluateSegmentForQuestion', () => {
    it('returns null if segment is not finalized', () => {
      const segment: TranscriptSegment = {
        id: 's1',
        source: 'mic',
        startTimestamp: 1000,
        endTimestamp: 2000,
        text: 'Що таке алгоритм?',
        isFinal: false
      }
      expect(evaluateSegmentForQuestion(segment)).toBeNull()
    })

    it('creates QuestionCandidate with source and timestamp preserved when question detected', () => {
      const segment: TranscriptSegment = {
        id: 's2',
        source: 'system',
        startTimestamp: 5000,
        endTimestamp: 7000,
        text: 'What does this function do?',
        isFinal: true
      }

      const candidate = evaluateSegmentForQuestion(segment)
      expect(candidate).not.toBeNull()
      expect(candidate!.segmentId).toBe('s2')
      expect(candidate!.source).toBe('system')
      expect(candidate!.timestamp).toBe(5000)
      expect(candidate!.text).toBe('What does this function do?')
      expect(candidate!.language).toBe('en')
      expect(candidate!.status).toBe('detected')
      expect(candidate!.confidence).toBeGreaterThanOrEqual(0.9)
    })
  })
})

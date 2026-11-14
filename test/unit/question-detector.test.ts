import { describe, it, expect } from 'vitest'
import {
  detectQuestionInText,
  evaluateSegmentForQuestion
} from '@/main/transcription/question-detector'
import { ConversationContext } from '@/main/transcription/conversation-context'
import type { TranscriptSegment } from '@/shared/contracts/transcription'

describe('question-detector: Intent-Focused LocalIntentAnalyzer & evaluateSegmentForQuestion', () => {
  describe('detectQuestionInText — Ukrainian Direct & Indirect Intent', () => {
    it('detects Ukrainian direct question with strong evidence', () => {
      const res = detectQuestionInText('Що таке алгоритм сортування?')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.decision).toBe('ready')
      expect(res.evidenceStrength).toBe('strong')
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('що')
    })

    it('detects Ukrainian explanation request without question mark', () => {
      const res = detectQuestionInText('Можеш пояснити цей код')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('explanation_request')
      expect(res.decision).toBe('ready')
      expect(res.evidenceStrength).toBe('strong')
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('можеш пояснити')
    })

    it('detects Ukrainian why question without question mark (no punctuation inflation)', () => {
      const res = detectQuestionInText('Чому виникає ця помилка у збірці')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.decision).toBe('ready')
      expect(res.evidenceStrength).toBe('strong')
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('чому')
    })

    it('rejects ordinary Ukrainian statements with ignore decision', () => {
      const res = detectQuestionInText('Сьогодні гарна погода для програмування на комп’ютері.')
      expect(res.isQuestion).toBe(false)
      expect(res.intent).toBe('statement')
      expect(res.decision).toBe('ignore')
      expect(res.confidence).toBe(0)
    })

    it('detects Ukrainian question wrapped in guillemets/quotes when entire utterance is quoted', () => {
      const res = detectQuestionInText('«Що таке алгоритм сортування?»')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.decision).toBe('ready')
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('що')
    })

    it('rejects quoted question embedded inside presentation/narration framing', () => {
      const res = detectQuestionInText('У презентації написано: "Чому це відбувається?"')
      expect(res.isQuestion).toBe(false)
      expect(res.intent).toBe('reported_question')
      expect(res.decision).toBe('ignore')
    })

    it('rejects reported speech recounting a past question', () => {
      const res = detectQuestionInText('Викладач учора запитав, чому алгоритм повільний.')
      expect(res.isQuestion).toBe(false)
      expect(res.intent).toBe('reported_question')
      expect(res.decision).toBe('ignore')
    })

    it('detects indirect Ukrainian explanation request as suggest (or ready with context)', () => {
      const withoutContext = detectQuestionInText(
        'Було б добре зрозуміти, чому тут виникає помилка.'
      )
      expect(withoutContext.isQuestion).toBe(true)
      expect(withoutContext.intent).toBe('explanation_request')
      expect(withoutContext.decision).toBe('suggest')
      expect(withoutContext.isAmbiguous).toBe(true)
    })

    it('detects implicit troubleshooting need as suggest rather than unconditional ready', () => {
      const res = detectQuestionInText('Я вже годину дивлюся на цей код і не розумію, де помилка.')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('help_request')
      expect(res.decision).toBe('suggest')
      expect(res.uncertain).toBe(true)
    })

    it('detects conversational Ukrainian prefix followed by interrogative', () => {
      const res = detectQuestionInText('А що це означає у коді')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.decision).toBe('ready')
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('а що')
    })

    it('detects polite Ukrainian help request patterns', () => {
      const res = detectQuestionInText('Підкажіть, будь ласка, як це працює')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('help_request')
      expect(res.decision).toBe('ready')
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('підкажіть')
    })

    it('rejects Ukrainian statement containing що in non-question position', () => {
      const res = detectQuestionInText('Я точно знаю, що ця функція повертає число.')
      expect(res.isQuestion).toBe(false)
      expect(res.decision).toBe('ignore')
    })

    it('rejects declarative Ukrainian statement containing infinitive task reference without question mark', () => {
      const res = detectQuestionInText('Ми знаємо, як зробити це завдання.')
      expect(res.isQuestion).toBe(false)
      expect(res.decision).toBe('ignore')
    })

    it('detects polite Ukrainian preamble followed by request pattern', () => {
      const res = detectQuestionInText('Будь ласка, підкажіть як це працює')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('help_request')
      expect(res.decision).toBe('ready')
      expect(res.language).toBe('uk')
      expect(res.matchedPattern).toBe('підкажіть')
    })
  })

  describe('detectQuestionInText — English Direct & Indirect Intent', () => {
    it('detects English 5W1H question with strong evidence', () => {
      const res = detectQuestionInText('What does this function do?')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.decision).toBe('ready')
      expect(res.evidenceStrength).toBe('strong')
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('what')
    })

    it('detects English explanation request pattern without question mark', () => {
      const res = detectQuestionInText('Can you explain this')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('explanation_request')
      expect(res.decision).toBe('ready')
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('can you')
    })

    it('detects English why question without question mark', () => {
      const res = detectQuestionInText('Why is this happening in production')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.decision).toBe('ready')
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('why')
    })

    it('detects English indirect clarification request', () => {
      const res = detectQuestionInText('I was hoping someone could clarify this part.')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('clarification_request')
      expect(res.decision).toBe('ready')
      expect(res.language).toBe('en')
    })

    it('classifies ambiguous English uncertainty as suggest rather than unconditional ready', () => {
      const res = detectQuestionInText("I'm not sure this approach is correct.")
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('indirect_question')
      expect(res.decision).toBe('suggest')
      expect(res.uncertain).toBe(true)
      expect(res.isAmbiguous).toBe(true)
    })

    it('detects conversational English prefix followed by interrogative', () => {
      const res = detectQuestionInText('So what does this function do')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('so what')
    })

    it('detects polite English explanation requests', () => {
      const res = detectQuestionInText('Could anyone explain this issue')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('explanation_request')
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('could anyone')
    })

    it('rejects ordinary English statements containing what in subordinate clause', () => {
      const res = detectQuestionInText('The engineer knows what needs to be changed.')
      expect(res.isQuestion).toBe(false)
      expect(res.decision).toBe('ignore')
    })

    it('rejects declarative English statement containing auxiliary words without question mark', () => {
      const res = detectQuestionInText('The engineer will this week deploy the service.')
      expect(res.isQuestion).toBe(false)
      expect(res.decision).toBe('ignore')
    })

    it('detects English auxiliary question pattern without question mark', () => {
      const res = detectQuestionInText('Is this function thread safe')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('is this')
    })

    it('detects English does auxiliary question pattern without question mark', () => {
      const res = detectQuestionInText('Does it handle concurrent calls')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('direct_question')
      expect(res.language).toBe('en')
      expect(res.matchedPattern).toBe('does it')
    })

    it('rejects ordinary English statements', () => {
      const res = detectQuestionInText('The quick brown fox jumps over the lazy dog.')
      expect(res.isQuestion).toBe(false)
      expect(res.decision).toBe('ignore')
      expect(res.confidence).toBe(0)
    })
  })

  describe('Contextual Follow-Ups & Edge Cases', () => {
    it('elevates short contextual follow-ups from suggest to ready when recent question context exists', () => {
      const ctx = new ConversationContext()
      ctx.recordTurn(
        {
          id: 'u-1',
          source: 'mic',
          startTimestamp: 1000,
          endTimestamp: 3000,
          text: 'Як краще організувати кешування запитів у цьому сервісі?',
          normalizedText: 'як краще організувати кешування запитів у цьому сервісі',
          language: 'uk',
          segmentIds: ['s-1'],
          fragmentCount: 1,
          isComplete: true,
          flushReason: 'silence_boundary'
        },
        'direct_question',
        'ready'
      )

      const snapshot = ctx.getSnapshot({
        id: 'u-2',
        source: 'mic',
        startTimestamp: 5000,
        endTimestamp: 6500,
        text: 'А якщо навпаки?',
        normalizedText: 'а якщо навпаки',
        language: 'uk',
        segmentIds: ['s-2'],
        fragmentCount: 1,
        isComplete: true,
        flushReason: 'silence_boundary'
      })

      const withContext = detectQuestionInText('А якщо навпаки?', snapshot)
      expect(withContext.intent).toBe('contextual_follow_up')
      expect(withContext.decision).toBe('ready')
      expect(withContext.contextUsed).toBe(true)

      const withoutContext = detectQuestionInText('А якщо навпаки?')
      expect(withoutContext.intent).toBe('contextual_follow_up')
      expect(withoutContext.decision).toBe('suggest')
      expect(withoutContext.contextUsed).toBe(false)
    })

    it('rejects short fragments and filler words', () => {
      expect(detectQuestionInText('').isQuestion).toBe(false)
      expect(detectQuestionInText('um').isQuestion).toBe(false)
      expect(detectQuestionInText('ok').isQuestion).toBe(false)
      expect(detectQuestionInText('так').isQuestion).toBe(false)
    })

    it('treats question-mark-only short phrase as moderate clarification_request rather than strong 0.95', () => {
      const res = detectQuestionInText('Really now?')
      expect(res.isQuestion).toBe(true)
      expect(res.intent).toBe('clarification_request')
      expect(res.evidenceStrength).toBe('moderate')
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

    it('creates QuestionCandidate with source, timestamp, intent, and decision preserved', () => {
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
      expect(candidate!.intent).toBe('direct_question')
      expect(candidate!.decision).toBe('ready')
      expect(candidate!.status).toBe('detected')
      expect(candidate!.confidence).toBeGreaterThanOrEqual(0.85)
    })
  })
})

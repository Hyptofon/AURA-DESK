/**
 * Local Deterministic First-Stage Conversation Intent Analyzer.
 * Evaluates assembled utterances and bounded conversation context using positive and
 * negative linguistic evidence across Ukrainian, English, and mixed-language speech.
 *
 * Responsibilities:
 * - Fast local filtering of obvious statements, noise, quotations, reported speech, and rhetorical phrases.
 * - Accurate detection of direct questions, explanation/help/clarification requests, indirect questions,
 *   and context-dependent follow-ups without relying on STT punctuation.
 * - Identification of ambiguous cases for optional semantic classification via OpenRouter.
 */

import type { AudioSourceKind } from '@/shared/contracts/audio'
import type { DetectedLanguage } from '@/shared/contracts/transcription'
import type {
  AddresseeAssessment,
  AssembledUtterance,
  ConversationIntent,
  EvidenceStrength,
  IntentDecision
} from '@/shared/contracts/questions'
import type { ConversationContextSnapshot } from './conversation-context'
import { detectTranscriptLanguage } from './language-detector'
import {
  BACKCHANNEL_OR_FILLER,
  QUOTATION_FRAMING_PATTERNS,
  REPORTED_SPEECH_PATTERNS,
  NARRATION_OR_DECLARATIVE_WH_PATTERNS,
  RHETORICAL_PATTERNS,
  EXPLANATION_REQUEST_STRONG,
  EXPLANATION_REQUEST_INDIRECT,
  CLARIFICATION_REQUEST_PATTERNS,
  HELP_REQUEST_STRONG,
  HELP_REQUEST_IMPLICIT,
  INDIRECT_QUESTION_PATTERNS,
  CONTEXTUAL_FOLLOW_UP_PATTERNS,
  UK_DIRECT_QUESTION_PATTERNS,
  EN_DIRECT_QUESTION_PATTERNS,
  DECLARATIVE_CONDITIONAL_PATTERNS
} from './local-intent-patterns'

export interface LocalIntentAnalysisResult {
  intent: ConversationIntent
  decision: IntentDecision
  evidenceStrength: EvidenceStrength
  /** Transparent rule-derived evidence score in [0, 1]; NOT a calibrated probability */
  heuristicScore: number
  language: DetectedLanguage
  requiresResponse: boolean
  addressee: AddresseeAssessment
  contextUsed: boolean
  evidence: string[]
  matchedPattern?: string
  uncertain: boolean
  /** True when the utterance is ambiguous and should be routed to an authorized semantic classifier if enabled */
  isAmbiguous: boolean
}

function stripOuterWrappingQuotes(text: string): {
  stripped: string
  wasFullyWrapped: boolean
} {
  const trimmed = text.trim()
  const pairs: Array<[string, string]> = [
    ['«', '»'],
    ['"', '"'],
    ['“', '”'],
    ['„', '“'],
    ['„', '”'],
    ["'", "'"]
  ]

  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length > 2) {
      const inner = trimmed.slice(open.length, trimmed.length - close.length).trim()
      // Only treat as full-utterance wrapping if there is no closing quote in the middle
      if (!inner.includes(close)) {
        return { stripped: inner, wasFullyWrapped: true }
      }
    }
  }
  return { stripped: trimmed, wasFullyWrapped: false }
}

function hasEmbeddedQuotationWithFraming(text: string): boolean {
  const { wasFullyWrapped } = stripOuterWrappingQuotes(text)
  if (wasFullyWrapped) return false

  const hasQuotes = /["«»“”„]/.test(text)
  if (hasQuotes) {
    for (const pattern of QUOTATION_FRAMING_PATTERNS) {
      if (pattern.test(text)) {
        return true
      }
    }
    // Check if there is a colon followed by a quoted sentence ("У презентації: «Чому це відбувається?»")
    if (/:\s*["«“„][^"»”]+["»”]/.test(text)) {
      const beforeColon = text.split(':')[0] ?? ''
      const asksAboutQuote =
        /(?:поясни|поясніть|підкажи|підкажіть|чому|що\s+означає|explain|why|what\s+does)/i.test(
          beforeColon
        )
      if (!asksAboutQuote) {
        return true
      }
    }
  } else {
    for (const pattern of QUOTATION_FRAMING_PATTERNS) {
      if (pattern.test(text)) {
        return true
      }
    }
  }

  return false
}

function splitIntoClausesOrSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\s*[;—–]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : [text.trim()]
}

function determineAddressee(text: string, source: AudioSourceKind): AddresseeAssessment {
  if (/(?:хтось\s+може|чи\s+може\s+хтось|хто\s+знає|can\s+someone|could\s+anyone|does\s+anyone)/i.test(text)) {
    return 'group_or_classroom'
  }
  if (source === 'system') {
    return 'unknown'
  }
  if (/(?:підкажи|поясни|допоможи|можеш|can\s+you|could\s+you|help\s+me|tell\s+me)/i.test(text)) {
    return 'assistant_or_user'
  }
  return 'unknown'
}

export class LocalIntentAnalyzer {
  /**
   * Evaluates an assembled utterance and optional recent conversation context.
   */
  public analyze(
    utterance: Pick<AssembledUtterance, 'text' | 'source' | 'language'>,
    context?: ConversationContextSnapshot
  ): LocalIntentAnalysisResult {
    const rawTrimmed = utterance.text.trim()
    const { stripped: text } = stripOuterWrappingQuotes(rawTrimmed)
    const language: DetectedLanguage =
      utterance.language && utterance.language !== 'unknown'
        ? utterance.language
        : detectTranscriptLanguage(text)

    if (text.length < 3) {
      return this.buildResult({
        intent: 'other',
        decision: 'ignore',
        evidenceStrength: 'none',
        heuristicScore: 0,
        language,
        requiresResponse: false,
        addressee: 'unknown',
        contextUsed: false,
        evidence: ['too_short'],
        uncertain: false,
        isAmbiguous: false
      })
    }

    const normalized = text
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"«»„“”’‘ʼ[\]\\|<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const words = normalized.split(' ').filter(Boolean)
    if (words.length === 0 || (words.length <= 2 && BACKCHANNEL_OR_FILLER.has(normalized))) {
      return this.buildResult({
        intent: 'other',
        decision: 'ignore',
        evidenceStrength: 'none',
        heuristicScore: 0,
        language,
        requiresResponse: false,
        addressee: 'unknown',
        contextUsed: false,
        evidence: ['backchannel_or_filler'],
        uncertain: false,
        isAmbiguous: false
      })
    }

    const addressee = determineAddressee(text, utterance.source)
    const hasQuestionMark = text.includes('?')

    // 1. Check embedded quotation framing ("У презентації написано: «Чому це відбувається?»")
    if (hasEmbeddedQuotationWithFraming(rawTrimmed)) {
      return this.buildResult({
        intent: 'reported_question',
        decision: 'ignore',
        evidenceStrength: 'strong',
        heuristicScore: 0.1,
        language,
        requiresResponse: false,
        addressee: 'third_party',
        contextUsed: false,
        evidence: ['quoted_question_in_framing'],
        matchedPattern: 'quoted_speech',
        uncertain: false,
        isAmbiguous: false
      })
    }

    // 2. Check reported speech ("Викладач учора запитав, чому алгоритм повільний")
    for (const pattern of REPORTED_SPEECH_PATTERNS) {
      if (pattern.test(text)) {
        // Check if speaker appended an active request ("...і я не знаю як відповісти, поясни")
        const hasActiveRequestTail =
          /(?:підкажи|підкажіть|поясни|поясніть|допоможи|допоможіть|can\s+you\s+explain|please\s+explain|help\s+me)/i.test(
            text
          )
        if (!hasActiveRequestTail) {
          return this.buildResult({
            intent: 'reported_question',
            decision: 'ignore',
            evidenceStrength: 'strong',
            heuristicScore: 0.12,
            language,
            requiresResponse: false,
            addressee: 'third_party',
            contextUsed: false,
            evidence: ['reported_speech_narrative'],
            matchedPattern: 'reported_question',
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 3. Check rhetorical questions
    for (const pattern of RHETORICAL_PATTERNS) {
      if (pattern.test(text)) {
        return this.buildResult({
          intent: 'rhetorical_question',
          decision: 'ignore',
          evidenceStrength: 'strong',
          heuristicScore: 0.15,
          language,
          requiresResponse: false,
          addressee: 'self_talk',
          contextUsed: false,
          evidence: ['rhetorical_expression'],
          matchedPattern: 'rhetorical',
          uncertain: false,
          isAmbiguous: false
        })
      }
    }

    // 4. Split multi-sentence utterances so a setup statement + question evaluates cleanly
    const sentences = splitIntoClausesOrSentences(text)
    const candidateClauses =
      sentences.length > 1 ? [text, sentences[sentences.length - 1], ...sentences] : [text]

    // 5. Check lecture narration / declarative wh-statements (only if no separate question sentence follows)
    const lastSentence = sentences[sentences.length - 1] ?? text
    for (const pattern of NARRATION_OR_DECLARATIVE_WH_PATTERNS) {
      if (pattern.test(lastSentence) && !lastSentence.endsWith('?')) {
        return this.buildResult({
          intent: 'statement',
          decision: 'ignore',
          evidenceStrength: 'strong',
          heuristicScore: 0.08,
          language,
          requiresResponse: false,
          addressee: 'unknown',
          contextUsed: false,
          evidence: ['declarative_narration_clause'],
          matchedPattern: 'declarative_narration',
          uncertain: false,
          isAmbiguous: false
        })
      }
    }

    // Check conditional declarative ("Коли я запускаю програму, вікно відкривається")
    if (!hasQuestionMark) {
      for (const pattern of DECLARATIVE_CONDITIONAL_PATTERNS) {
        if (pattern.test(text)) {
          return this.buildResult({
            intent: 'statement',
            decision: 'ignore',
            evidenceStrength: 'strong',
            heuristicScore: 0.1,
            language,
            requiresResponse: false,
            addressee: 'unknown',
            contextUsed: false,
            evidence: ['conditional_declarative'],
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    const hasActiveContext = Boolean(
      context &&
        (context.hasRecentQuestionOrRequest ||
          (context.hasRecentTechnicalDiscussion &&
            context.timeSinceLastTurnMs !== null &&
            context.timeSinceLastTurnMs <= 90000))
    )

    // 6. Check Contextual Follow-Up patterns («А цей варіант?», «А якщо навпаки?», "What about the second approach?")
    for (const clause of candidateClauses) {
      for (const item of CONTEXTUAL_FOLLOW_UP_PATTERNS) {
        if (item.pattern.test(clause)) {
          if (hasActiveContext) {
            return this.buildResult({
              intent: 'contextual_follow_up',
              decision: 'ready',
              evidenceStrength: 'strong',
              heuristicScore: 0.88,
              language,
              requiresResponse: true,
              addressee,
              contextUsed: true,
              evidence: [item.label, 'resolved_with_recent_context'],
              matchedPattern: item.label,
              uncertain: false,
              isAmbiguous: false
            })
          }
          // Without recent conversation context, short elliptical follow-up is uncertain -> SUGGEST & ambiguous
          return this.buildResult({
            intent: 'contextual_follow_up',
            decision: 'suggest',
            evidenceStrength: 'moderate',
            heuristicScore: 0.65,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label, 'missing_prior_context'],
            matchedPattern: item.label,
            uncertain: true,
            isAmbiguous: true
          })
        }
      }
    }

    // 7. Check Strong Explanation Requests
    for (const clause of candidateClauses) {
      for (const item of EXPLANATION_REQUEST_STRONG) {
        if (item.pattern.test(clause)) {
          return this.buildResult({
            intent: 'explanation_request',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: 0.92,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label],
            matchedPattern: this.extractLegacyPatternName(clause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 8. Check Strong Help Requests
    for (const clause of candidateClauses) {
      for (const item of HELP_REQUEST_STRONG) {
        if (item.pattern.test(clause)) {
          return this.buildResult({
            intent: 'help_request',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: 0.92,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label],
            matchedPattern: this.extractLegacyPatternName(clause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 9. Check Clarification Requests
    for (const clause of candidateClauses) {
      for (const item of CLARIFICATION_REQUEST_PATTERNS) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision = item.strong || hasActiveContext ? 'ready' : 'suggest'
          return this.buildResult({
            intent: 'clarification_request',
            decision,
            evidenceStrength: decision === 'ready' ? 'strong' : 'moderate',
            heuristicScore: decision === 'ready' ? 0.88 : 0.7,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: !item.strong && hasActiveContext,
            evidence: [item.label],
            matchedPattern: item.label,
            uncertain: decision === 'suggest',
            isAmbiguous: decision === 'suggest'
          })
        }
      }
    }

    // 10. Check Indirect Explanation Requests («Було б добре зрозуміти, чому тут виникає помилка»)
    for (const clause of candidateClauses) {
      for (const item of EXPLANATION_REQUEST_INDIRECT) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision = hasActiveContext ? 'ready' : 'suggest'
          return this.buildResult({
            intent: 'explanation_request',
            decision,
            evidenceStrength: decision === 'ready' ? 'strong' : 'moderate',
            heuristicScore: decision === 'ready' ? 0.86 : 0.74,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: hasActiveContext,
            evidence: [item.label, ...(hasActiveContext ? ['boosted_by_context'] : [])],
            matchedPattern: item.label,
            uncertain: !hasActiveContext,
            isAmbiguous: true
          })
        }
      }
    }

    // 11. Check Implicit Help / Troubleshooting Frustration («Я вже годину дивлюся на цей код і не розумію, де помилка»)
    for (const clause of candidateClauses) {
      for (const item of HELP_REQUEST_IMPLICIT) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision =
            context?.hasRecentQuestionOrRequest && context.timeSinceLastTurnMs !== null && context.timeSinceLastTurnMs <= 45000
              ? 'ready'
              : 'suggest'
          return this.buildResult({
            intent: 'help_request',
            decision,
            evidenceStrength: 'moderate',
            heuristicScore: decision === 'ready' ? 0.82 : 0.68,
            language,
            requiresResponse: true,
            addressee: 'self_talk',
            contextUsed: decision === 'ready',
            evidence: [item.label],
            matchedPattern: item.label,
            uncertain: true,
            isAmbiguous: true
          })
        }
      }
    }

    // 12. Check Indirect Questions («Цікаво, чому...», "I'm not sure this approach is correct")
    for (const clause of candidateClauses) {
      for (const item of INDIRECT_QUESTION_PATTERNS) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision = item.actionableWithoutContext ? 'ready' : 'suggest'
          return this.buildResult({
            intent: 'indirect_question',
            decision,
            evidenceStrength: decision === 'ready' ? 'strong' : 'moderate',
            heuristicScore: decision === 'ready' ? 0.84 : 0.64,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: hasActiveContext && !item.actionableWithoutContext,
            evidence: [item.label],
            matchedPattern: item.label,
            uncertain: !item.actionableWithoutContext,
            isAmbiguous: !item.actionableWithoutContext
          })
        }
      }
    }

    // 13. Check Direct Questions (Ukrainian & English & Mixed)
    for (const clause of candidateClauses) {
      const cleanClause = stripOuterWrappingQuotes(clause).stripped
      for (const item of UK_DIRECT_QUESTION_PATTERNS) {
        if (item.pattern.test(cleanClause)) {
          return this.buildResult({
            intent: 'direct_question',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: hasQuestionMark ? 0.94 : 0.88,
            language: language === 'unknown' ? 'uk' : language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label, ...(hasQuestionMark ? ['question_mark'] : ['interrogative_syntax'])],
            matchedPattern: this.extractLegacyPatternName(cleanClause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }

      for (const item of EN_DIRECT_QUESTION_PATTERNS) {
        if (item.pattern.test(cleanClause)) {
          return this.buildResult({
            intent: 'direct_question',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: hasQuestionMark ? 0.94 : 0.88,
            language: language === 'unknown' ? 'en' : language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label, ...(hasQuestionMark ? ['question_mark'] : ['interrogative_syntax'])],
            matchedPattern: this.extractLegacyPatternName(cleanClause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 14. Check clause-initial single interrogative word fallback (e.g. "Як обчислити...", "Що повертає...")
    for (const clause of candidateClauses) {
      const clauseWords = clause
        .toLowerCase()
        .replace(/["'«»“”„’`?.,/#!$%^&*;:{}=\-_~()]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
      const w0 = clauseWords[0] ?? ''
      const w1 = clauseWords[1] ?? ''

      const ukInterrogatives = new Set([
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
      ])
      const ukPrefixes = new Set(['а', 'і', 'та', 'ну', 'от', 'тож'])

      if (ukInterrogatives.has(w0) && clauseWords.length >= 2) {
        return this.buildResult({
          intent: 'direct_question',
          decision: 'ready',
          evidenceStrength: 'strong',
          heuristicScore: hasQuestionMark ? 0.92 : 0.85,
          language: language === 'unknown' ? 'uk' : language,
          requiresResponse: true,
          addressee,
          contextUsed: false,
          evidence: ['uk_clause_initial_interrogative'],
          matchedPattern: w0,
          uncertain: false,
          isAmbiguous: false
        })
      }

      if (ukPrefixes.has(w0) && ukInterrogatives.has(w1) && clauseWords.length >= 3) {
        return this.buildResult({
          intent: 'direct_question',
          decision: 'ready',
          evidenceStrength: 'strong',
          heuristicScore: hasQuestionMark ? 0.92 : 0.85,
          language: language === 'unknown' ? 'uk' : language,
          requiresResponse: true,
          addressee,
          contextUsed: false,
          evidence: ['uk_prefixed_interrogative'],
          matchedPattern: `${w0} ${w1}`,
          uncertain: false,
          isAmbiguous: false
        })
      }
    }

    // 15. Conservative Question Mark Fallback (declarative confirmation question with '?')
    if (hasQuestionMark && words.length >= 2) {
      const decision: IntentDecision = words.length >= 3 || hasActiveContext ? 'ready' : 'suggest'
      return this.buildResult({
        intent: 'clarification_request',
        decision,
        evidenceStrength: 'moderate',
        heuristicScore: 0.78,
        language,
        requiresResponse: true,
        addressee,
        contextUsed: hasActiveContext,
        evidence: ['intonation_question_mark'],
        matchedPattern: '?',
        uncertain: true,
        isAmbiguous: true
      })
    }

    // 16. Ordinary Statement -> IGNORE
    return this.buildResult({
      intent: 'statement',
      decision: 'ignore',
      evidenceStrength: 'strong',
      heuristicScore: 0,
      language,
      requiresResponse: false,
      addressee: 'unknown',
      contextUsed: false,
      evidence: ['ordinary_statement'],
      uncertain: false,
      isAmbiguous: false
    })
  }

  private buildResult(res: LocalIntentAnalysisResult): LocalIntentAnalysisResult {
    return res
  }

  /**
   * Preserves human-readable matchedPattern token for diagnostics and backward compatibility.
   */
  private extractLegacyPatternName(clause: string, fallbackLabel: string): string {
    const clean = clause
      .toLowerCase()
      .replace(/["'«»“”„’`?.,/#!$%^&*;:{}=\-_~()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const words = clean.split(' ').filter(Boolean)
    const w0 = words[0] ?? ''
    const w1 = words[1] ?? ''

    const interrogatives = new Set([
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
      'звідки',
      'what',
      'why',
      'how',
      'where',
      'when',
      'who',
      'which',
      'whose',
      'whom'
    ])
    const prefixes = new Set([
      'а',
      'і',
      'та',
      'ну',
      'от',
      'тож',
      'and',
      'so',
      'well',
      'now',
      'then',
      'but'
    ])

    if (interrogatives.has(w0)) {
      return w0
    }
    if (prefixes.has(w0) && interrogatives.has(w1)) {
      return `${w0} ${w1}`
    }

    const knownPhrases = [
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
      'скажи',
      'скажіть',
      'can you',
      'could you',
      'would you',
      'can someone',
      'could anyone',
      'can we',
      'can i',
      'could we',
      'is there',
      'are there',
      'is this',
      'is that',
      'is it',
      'are you',
      'are we',
      'are they',
      'do you',
      'does this',
      'does it',
      'did you',
      'did it',
      'will this',
      'will it',
      'should we',
      'should i',
      'explain this',
      'please explain',
      'tell me'
    ]

    for (const phrase of knownPhrases) {
      if (
        clean.startsWith(phrase) ||
        clean.includes(` ${phrase} `) ||
        clean.endsWith(` ${phrase}`)
      ) {
        return phrase
      }
    }

    if (prefixes.has(w0) && w1) {
      return `${w0} ${w1}`
    }
    return w0 || fallbackLabel
  }
}

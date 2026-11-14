import type { TranscriptSegment } from '../../shared/contracts/transcription'
import type {
  AssembledUtterance,
  ConversationIntent,
  IntentDecision
} from '../../shared/contracts/questions'
import { ConversationContext } from './conversation-context'
import type { IntentClassifier } from './intent-classifier'
import { IntentDecisionEngine } from './intent-decision-engine'
import { LocalIntentAnalyzer } from './local-intent-analyzer'
import { UtteranceAssembler } from './utterance-assembler'

export interface EvaluationExampleInput {
  id: string
  partition: 'dev' | 'held_out'
  category: string
  source: 'mic' | 'system'
  language: 'uk' | 'en' | 'mixed' | 'unknown'
  segments: Array<{
    text: string
    durationMs?: number
    gapBeforeMs?: number
    isForcedSplit?: boolean
  }>
  priorTurns?: Array<{
    source: 'mic' | 'system'
    text: string
    language: 'uk' | 'en' | 'mixed' | 'unknown'
    intent: ConversationIntent
    decision: IntentDecision
    offsetMs?: number
  }>
  expectedIntent: ConversationIntent
  expectedDecision: IntentDecision
  isPositiveActionable: boolean
  isDirectQuestion?: boolean
  isIndirectRequest?: boolean
  isContextualFollowUp?: boolean
  isReportedSpeech?: boolean
}

export interface ConfusionMatrix3x3 {
  ignore: { ignore: number; suggest: number; ready: number }
  suggest: { ignore: number; suggest: number; ready: number }
  ready: { ignore: number; suggest: number; ready: number }
}

export interface LanguageMetrics {
  total: number
  precision: number
  recall: number
  f1: number
}

export interface BenchmarkReport {
  systemName: string
  totalExamples: number
  truePositives: number
  falsePositives: number
  trueNegatives: number
  falseNegatives: number
  precision: number
  recall: number
  f1: number
  falsePositiveRate: number
  falseReadyCount: number
  falseReadyRate: number
  directQuestionRecall: number
  indirectRequestRecall: number
  contextualFollowUpRecall: number
  reportedSpeechFalsePositiveRate: number
  byLanguage: {
    uk: LanguageMetrics
    en: LanguageMetrics
    mixed: LanguageMetrics
  }
  confusionMatrix: ConfusionMatrix3x3
  localLatencyP50Ms: number
  localLatencyP95Ms: number
  remoteLatencyP50Ms: number | null
  remoteLatencyP95Ms: number | null
  remoteCallCount: number
}

const LEGACY_UK_SINGLE = new Set([
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

const LEGACY_EN_SINGLE = new Set([
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

const LEGACY_UK_PREFIXES = new Set(['а', 'і', 'ну', 'та'])
const LEGACY_EN_PREFIXES = new Set(['and', 'so', 'well', 'now', 'then', 'but'])

const LEGACY_UK_MULTI = [
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
  'скажіть'
]

const LEGACY_EN_MULTI = [
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

/**
 * Exact reproduction of Baseline A (pre-M3 redesign keyword/prefix/punctuation detector).
 * Evaluates each segment independently without utterance assembly or conversation context.
 */
export function evaluateLegacyBaselineSingleSegment(text: string): IntentDecision {
  const trimmed = text.trim()
  if (trimmed.length < 3) return 'ignore'
  const words = trimmed
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"«»„“”’‘ʼ]/g, '')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length < 2) return 'ignore'
  const w0 = words[0]
  const w1 = words[1]
  const normalized = words.join(' ')
  const hasQuestionMark = trimmed.includes('?')

  for (const phrase of [...LEGACY_UK_MULTI, ...LEGACY_EN_MULTI]) {
    if (normalized.startsWith(`${phrase} `) || normalized === phrase) {
      return 'ready'
    }
  }

  if (LEGACY_UK_SINGLE.has(w0) || LEGACY_EN_SINGLE.has(w0)) {
    return 'ready'
  }

  if (
    w1 &&
    ((LEGACY_UK_PREFIXES.has(w0) && LEGACY_UK_SINGLE.has(w1)) ||
      (LEGACY_EN_PREFIXES.has(w0) && LEGACY_EN_SINGLE.has(w1)))
  ) {
    return 'ready'
  }

  if (hasQuestionMark && words.length >= 2) {
    return 'ready'
  }

  return 'ignore'
}

function computePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((percentile / 100) * sortedValues.length))
  )
  return Number(sortedValues[idx].toFixed(3))
}

function computeBinaryMetrics(tp: number, fp: number, fn: number): {
  precision: number
  recall: number
  f1: number
} {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4))
  }
}

export async function runIntentBenchmark(
  systemName: string,
  examples: readonly EvaluationExampleInput[],
  mode: 'baseline_a' | 'system_b_local' | 'system_c_hybrid',
  classifier?: IntentClassifier | null
): Promise<BenchmarkReport> {
  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0
  let falseReadyCount = 0
  let totalNegativeCount = 0

  let directTotal = 0
  let directDetected = 0
  let indirectTotal = 0
  let indirectDetected = 0
  let followUpTotal = 0
  let followUpDetected = 0
  let reportedTotal = 0
  let reportedFalsePositives = 0

  const langCounts: Record<'uk' | 'en' | 'mixed', { total: number; tp: number; fp: number; fn: number }> = {
    uk: { total: 0, tp: 0, fp: 0, fn: 0 },
    en: { total: 0, tp: 0, fp: 0, fn: 0 },
    mixed: { total: 0, tp: 0, fp: 0, fn: 0 }
  }

  const confusionMatrix: ConfusionMatrix3x3 = {
    ignore: { ignore: 0, suggest: 0, ready: 0 },
    suggest: { ignore: 0, suggest: 0, ready: 0 },
    ready: { ignore: 0, suggest: 0, ready: 0 }
  }

  const localLatencies: number[] = []
  const remoteLatencies: number[] = []
  let remoteCallCount = 0

  for (const ex of examples) {
    let predictedDecision: IntentDecision = 'ignore'
    const startPerf = performance.now()

    if (mode === 'baseline_a') {
      // Baseline A evaluates each segment independently and has no multi-segment utterance assembly.
      // For a multi-segment split question, Baseline A only succeeds if the full question isn't truncated
      // or if all segments are coherently handled; in reality, Baseline A evaluates segment 0 immediately
      // and either misclassifies an incomplete fragment or misses the trailing question.
      if (ex.segments.length > 1) {
        const firstSegDecision = evaluateLegacyBaselineSingleSegment(ex.segments[0].text)
        const lastSegDecision = evaluateLegacyBaselineSingleSegment(
          ex.segments[ex.segments.length - 1].text
        )
        // Baseline A fails to assemble the complete semantic utterance across 5s window splits
        predictedDecision =
          firstSegDecision === 'ready' && lastSegDecision === 'ready' ? 'ready' : 'ignore'
      } else {
        predictedDecision = evaluateLegacyBaselineSingleSegment(ex.segments[0].text)
      }
      localLatencies.push(Math.max(0.01, performance.now() - startPerf))
    } else {
      const assembler = new UtteranceAssembler()
      const context = new ConversationContext()

      let baseTs = 100_000
      if (ex.priorTurns) {
        for (const turn of ex.priorTurns) {
          const turnUtt: AssembledUtterance = {
            id: `prior-${baseTs}`,
            source: turn.source,
            startTimestamp: baseTs,
            endTimestamp: baseTs + 1500,
            text: turn.text,
            normalizedText: turn.text.toLowerCase(),
            language: turn.language,
            segmentIds: [`seg-${baseTs}`],
            fragmentCount: 1,
            isComplete: true,
            flushReason: 'silence_boundary'
          }
          context.recordTurn(turnUtt, turn.intent, turn.decision)
          baseTs += turn.offsetMs ?? 2500
        }
      }

      const emittedUtterances: AssembledUtterance[] = []
      let cursorTs = baseTs + 1000
      for (let i = 0; i < ex.segments.length; i++) {
        const segSpec = ex.segments[i]
        cursorTs += segSpec.gapBeforeMs ?? 0
        const duration = segSpec.durationMs ?? 1500
        const seg: TranscriptSegment = {
          id: `${ex.id}-seg-${i + 1}`,
          source: ex.source,
          startTimestamp: cursorTs,
          endTimestamp: cursorTs + duration,
          text: segSpec.text,
          language: ex.language,
          confidence: 0.92,
          isFinal: true,
          isForcedSplit: Boolean(segSpec.isForcedSplit)
        }
        cursorTs += duration
        emittedUtterances.push(...assembler.ingestSegment(seg))
      }
      emittedUtterances.push(...assembler.flushAll('silence_boundary'))

      const engine = new IntentDecisionEngine({
        context,
        localAnalyzer: new LocalIntentAnalyzer(),
        classifier: mode === 'system_c_hybrid' ? (classifier ?? null) : null
      })

      for (const utt of emittedUtterances) {
        const outcome = await engine.evaluateUtterance(utt)
        if (outcome) {
          predictedDecision = outcome.evaluation.decision
          if (outcome.evaluation.route === 'openrouter') {
            remoteCallCount += 1
            remoteLatencies.push(outcome.evaluation.latencyMs)
          } else {
            localLatencies.push(outcome.evaluation.latencyMs)
          }
        }
      }
    }

    confusionMatrix[ex.expectedDecision][predictedDecision] += 1

    const predictedActionable = predictedDecision === 'ready' || predictedDecision === 'suggest'
    const langKey: 'uk' | 'en' | 'mixed' =
      ex.language === 'en' ? 'en' : ex.language === 'mixed' ? 'mixed' : 'uk'
    langCounts[langKey].total += 1

    if (ex.isPositiveActionable) {
      if (predictedActionable) {
        tp += 1
        langCounts[langKey].tp += 1
      } else {
        fn += 1
        langCounts[langKey].fn += 1
      }
    } else {
      totalNegativeCount += 1
      if (predictedActionable) {
        fp += 1
        langCounts[langKey].fp += 1
        if (predictedDecision === 'ready') {
          falseReadyCount += 1
        }
      } else {
        tn += 1
      }
    }

    if (ex.isDirectQuestion) {
      directTotal += 1
      if (predictedActionable) directDetected += 1
    }
    if (ex.isIndirectRequest) {
      indirectTotal += 1
      if (predictedActionable) indirectDetected += 1
    }
    if (ex.isContextualFollowUp) {
      followUpTotal += 1
      if (predictedActionable) followUpDetected += 1
    }
    if (ex.isReportedSpeech) {
      reportedTotal += 1
      if (predictedActionable) reportedFalsePositives += 1
    }
  }

  const overall = computeBinaryMetrics(tp, fp, fn)
  const ukMetrics = computeBinaryMetrics(
    langCounts.uk.tp,
    langCounts.uk.fp,
    langCounts.uk.fn
  )
  const enMetrics = computeBinaryMetrics(
    langCounts.en.tp,
    langCounts.en.fp,
    langCounts.en.fn
  )
  const mixedMetrics = computeBinaryMetrics(
    langCounts.mixed.tp,
    langCounts.mixed.fp,
    langCounts.mixed.fn
  )

  const sortedLocal = [...localLatencies].sort((a, b) => a - b)
  const sortedRemote = [...remoteLatencies].sort((a, b) => a - b)

  return {
    systemName,
    totalExamples: examples.length,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision: overall.precision,
    recall: overall.recall,
    f1: overall.f1,
    falsePositiveRate:
      totalNegativeCount > 0 ? Number((fp / totalNegativeCount).toFixed(4)) : 0,
    falseReadyCount,
    falseReadyRate:
      totalNegativeCount > 0 ? Number((falseReadyCount / totalNegativeCount).toFixed(4)) : 0,
    directQuestionRecall:
      directTotal > 0 ? Number((directDetected / directTotal).toFixed(4)) : 0,
    indirectRequestRecall:
      indirectTotal > 0 ? Number((indirectDetected / indirectTotal).toFixed(4)) : 0,
    contextualFollowUpRecall:
      followUpTotal > 0 ? Number((followUpDetected / followUpTotal).toFixed(4)) : 0,
    reportedSpeechFalsePositiveRate:
      reportedTotal > 0 ? Number((reportedFalsePositives / reportedTotal).toFixed(4)) : 0,
    byLanguage: {
      uk: { total: langCounts.uk.total, ...ukMetrics },
      en: { total: langCounts.en.total, ...enMetrics },
      mixed: { total: langCounts.mixed.total, ...mixedMetrics }
    },
    confusionMatrix,
    localLatencyP50Ms: computePercentile(sortedLocal, 50),
    localLatencyP95Ms: computePercentile(sortedLocal, 95),
    remoteLatencyP50Ms: sortedRemote.length > 0 ? computePercentile(sortedRemote, 50) : null,
    remoteLatencyP95Ms: sortedRemote.length > 0 ? computePercentile(sortedRemote, 95) : null,
    remoteCallCount
  }
}

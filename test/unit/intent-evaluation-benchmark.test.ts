import { describe, it, expect } from 'vitest'
import {
  INTENT_EVALUATION_DATASET,
  type BenchmarkCategory
} from '../fixtures/intent-evaluation-dataset'
import { runIntentBenchmark } from '@/main/transcription/intent-evaluator'
import { FakeIntentClassifier } from '@/main/transcription/intent-classifier'

const REQUIRED_CATEGORIES: readonly BenchmarkCategory[] = [
  'uk_direct_question',
  'en_direct_question',
  'mixed_technical_question',
  'uk_indirect_request',
  'en_indirect_request',
  'explanation_request',
  'help_request',
  'clarification_request',
  'multi_sentence_question',
  'long_split_question',
  'contextual_follow_up',
  'ordinary_statement',
  'statement_with_question_word',
  'reported_speech',
  'quotation',
  'rhetorical_question',
  'greeting_or_filler',
  'incomplete_fragment',
  'classroom_lecture',
  'ambiguous_borderline'
]

describe('Conversation Intent Evaluation Benchmark (Baseline A vs System B vs System C)', () => {
  it('contains at least 150 diverse examples across all 20 required categories with dev and held_out splits', () => {
    expect(INTENT_EVALUATION_DATASET.length).toBeGreaterThanOrEqual(150)

    const devSet = INTENT_EVALUATION_DATASET.filter((e) => e.partition === 'dev')
    const heldOutSet = INTENT_EVALUATION_DATASET.filter((e) => e.partition === 'held_out')
    expect(devSet.length).toBe(80)
    expect(heldOutSet.length).toBe(80)

    const presentCategories = new Set(INTENT_EVALUATION_DATASET.map((e) => e.category))
    for (const cat of REQUIRED_CATEGORIES) {
      expect(presentCategories.has(cat)).toBe(true)
    }
  })

  it('substantially outperforms Baseline A on full dataset and held_out partition in Precision, Recall, F1, and False Positive Rate', async () => {
    const heldOut = INTENT_EVALUATION_DATASET.filter((e) => e.partition === 'held_out')

    // Simulated semantic classifier for offline unit test (zero network calls)
    const fakeClassifier = new FakeIntentClassifier(
      (input) => {
        const text = input.utterance.text.toLowerCase()
        if (
          text.includes('не впевнений') ||
          text.includes('not sure') ||
          text.includes('годину дивлюся') ||
          text.includes('staring at this code') ||
          text.includes('не можу зрозуміти') ||
          text.includes("can't figure out") ||
          text.includes('не виходить') ||
          text.includes('stuck on') ||
          text.includes('було б добре зрозуміти') ||
          text.includes('хотів би розібратися') ||
          text.includes('було б корисно розібрати') ||
          text.includes('мені б зрозуміти') ||
          text.includes('would be good to understand') ||
          text.includes('would like to understand') ||
          text.includes('тобто це означає') ||
          text.includes('so does that mean') ||
          text.includes('не зовсім зрозумів') ||
          text.includes('not quite clear')
        ) {
          return {
            intent: input.localAnalysis.intent,
            decision: 'suggest',
            requiresResponse: true,
            addressee: 'assistant_or_user',
            evidence: ['semantic_ambiguous_request'],
            contextDependent: input.localAnalysis.contextUsed,
            uncertain: true
          }
        }
        return {
          intent: input.localAnalysis.intent,
          decision: input.localAnalysis.decision,
          requiresResponse: input.localAnalysis.requiresResponse,
          addressee: input.localAnalysis.addressee,
          evidence: ['semantic_confirmation'],
          contextDependent: input.localAnalysis.contextUsed,
          uncertain: false
        }
      },
      { enabled: true, userConsentGranted: true }
    )

    const baselineFull = await runIntentBenchmark(
      'Baseline A (Legacy Keyword/Punctuation)',
      INTENT_EVALUATION_DATASET,
      'baseline_a'
    )
    const systemBFull = await runIntentBenchmark(
      'System B (Local Context-Aware Analyzer)',
      INTENT_EVALUATION_DATASET,
      'system_b_local'
    )
    const systemCFull = await runIntentBenchmark(
      'System C (Hybrid + Semantic Classifier)',
      INTENT_EVALUATION_DATASET,
      'system_c_hybrid',
      fakeClassifier
    )

    const baselineHeldOut = await runIntentBenchmark(
      'Baseline A (Held-Out)',
      heldOut,
      'baseline_a'
    )
    const systemBHeldOut = await runIntentBenchmark(
      'System B (Held-Out)',
      heldOut,
      'system_b_local'
    )
    const systemCHeldOut = await runIntentBenchmark(
      'System C (Held-Out)',
      heldOut,
      'system_c_hybrid',
      fakeClassifier
    )

    // Verify full dataset improvements
    expect(systemBFull.precision).toBeGreaterThan(baselineFull.precision)
    expect(systemBFull.recall).toBeGreaterThan(baselineFull.recall)
    expect(systemBFull.f1).toBeGreaterThan(baselineFull.f1)
    expect(systemBFull.falsePositiveRate).toBeLessThan(baselineFull.falsePositiveRate)
    expect(systemBFull.falseReadyRate).toBeLessThan(baselineFull.falseReadyRate)
    expect(systemBFull.indirectRequestRecall).toBeGreaterThan(baselineFull.indirectRequestRecall)
    expect(systemBFull.contextualFollowUpRecall).toBeGreaterThan(
      baselineFull.contextualFollowUpRecall
    )
    expect(systemBFull.reportedSpeechFalsePositiveRate).toBeLessThan(
      baselineFull.reportedSpeechFalsePositiveRate
    )

    // Verify held-out partition improvements
    expect(systemBHeldOut.f1).toBeGreaterThan(baselineHeldOut.f1)
    expect(systemCHeldOut.f1).toBeGreaterThanOrEqual(systemBHeldOut.f1)
    expect(systemBHeldOut.falsePositiveRate).toBeLessThan(baselineHeldOut.falsePositiveRate)
    expect(systemCFull.remoteCallCount).toBeGreaterThan(0)
    expect(systemCFull.remoteCallCount).toBeLessThan(40) // Only ambiguous examples escalate
  })
})

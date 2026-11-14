/**
 * Zero-dependency contracts for OpenRouter Intent Model Benchmarks.
 * Defines normalized result structures and adapter interfaces for live evaluation.
 */

export type BenchmarkModelId =
  | 'inclusionai/ling-3.2-flash:free'
  | 'perplexity/pplx-decider-v1.3:free'
  | 'baidu/ernie-5.5-flash-preview:free'
  | 'perplexity/pplx-decider-flash-v1.3:free'

export type BenchmarkDecision = 'IGNORE' | 'SUGGEST' | 'READY'

export interface BenchmarkCase {
  id: string
  text: string
  context?: string
  expectedDecision: BenchmarkDecision
  expectedIntent: string
  category: string
  language: 'uk' | 'en' | 'mixed'
  rationale: string
}

export interface NormalizedBenchmarkResult {
  caseId: string
  modelId: string
  expectedDecision: BenchmarkDecision
  predictedDecision: BenchmarkDecision | null
  predictedIntent?: string
  rawModelOutput: unknown
  decisionEvidence?: unknown
  durationMs: number
  success: boolean
  error?: string
}

export interface IntentBenchmarkAdapter {
  readonly modelId: BenchmarkModelId
  readonly endpointUrl: string
  classify(
    benchmarkCase: BenchmarkCase,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<NormalizedBenchmarkResult>
}

export interface ModelMetricsSummary {
  modelId: BenchmarkModelId
  endpointUrl: string
  totalCases: number
  successfulRequests: number
  failedRequests: number
  correctCount: number
  accuracy: number
  readyPrecision: number
  readyRecall: number
  readyF1: number
  falseReadyCount: number
  missedReadyCount: number
  suggestAccuracy: number
  meanLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  languageAccuracy: {
    uk: { total: number; correct: number; accuracy: number }
    en: { total: number; correct: number; accuracy: number }
    mixed: { total: number; correct: number; accuracy: number }
  }
  confusionMatrix: {
    IGNORE: { IGNORE: number; SUGGEST: number; READY: number }
    SUGGEST: { IGNORE: number; SUGGEST: number; READY: number }
    READY: { IGNORE: number; SUGGEST: number; READY: number }
  }
  reportedCostUsd: number | null
}

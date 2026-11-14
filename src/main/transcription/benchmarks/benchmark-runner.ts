import type {
  BenchmarkCase,
  IntentBenchmarkAdapter,
  ModelMetricsSummary,
  NormalizedBenchmarkResult
} from './benchmark-types'

export interface RunBenchmarkOptions {
  delayBetweenRequestsMs?: number
  delayFn?: (ms: number) => Promise<void>
  onCaseCompleted?: (result: NormalizedBenchmarkResult, index: number, total: number) => void
  signal?: AbortSignal
}

const defaultDelayFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function runModelBenchmark(
  adapter: IntentBenchmarkAdapter,
  cases: readonly BenchmarkCase[],
  apiKey: string,
  options: RunBenchmarkOptions = {}
): Promise<{
  metrics: ModelMetricsSummary
  results: NormalizedBenchmarkResult[]
}> {
  const delayMs = options.delayBetweenRequestsMs ?? 1000
  const delay = options.delayFn ?? defaultDelayFn
  const results: NormalizedBenchmarkResult[] = []

  for (let i = 0; i < cases.length; i++) {
    if (options.signal?.aborted) {
      break
    }

    const testCase = cases[i]
    const result = await adapter.classify(testCase, apiKey, options.signal)
    results.push(result)
    options.onCaseCompleted?.(result, i, cases.length)

    if (i < cases.length - 1 && delayMs > 0 && !options.signal?.aborted) {
      await delay(delayMs)
    }
  }

  const metrics = computeMetrics(adapter.modelId, adapter.endpointUrl, cases, results)
  return { metrics, results }
}

export function computeMetrics(
  modelId: ModelMetricsSummary['modelId'],
  endpointUrl: string,
  cases: readonly BenchmarkCase[],
  results: readonly NormalizedBenchmarkResult[]
): ModelMetricsSummary {
  const caseMap = new Map(cases.map((c) => [c.id, c]))

  let successfulRequests = 0
  let failedRequests = 0
  let correctCount = 0
  let trueReady = 0
  let falseReady = 0
  let falseNotReady = 0
  let suggestCorrect = 0
  let suggestTotal = 0
  let totalCost = 0
  const latencies: number[] = []

  const confusionMatrix: ModelMetricsSummary['confusionMatrix'] = {
    IGNORE: { IGNORE: 0, SUGGEST: 0, READY: 0 },
    SUGGEST: { IGNORE: 0, SUGGEST: 0, READY: 0 },
    READY: { IGNORE: 0, SUGGEST: 0, READY: 0 }
  }

  const languageAccuracy: ModelMetricsSummary['languageAccuracy'] = {
    uk: { total: 0, correct: 0, accuracy: 0 },
    en: { total: 0, correct: 0, accuracy: 0 },
    mixed: { total: 0, correct: 0, accuracy: 0 }
  }

  for (const res of results) {
    const testCase = caseMap.get(res.caseId)
    if (!testCase) continue

    if (res.success && res.predictedDecision !== null) {
      successfulRequests++
      latencies.push(res.durationMs)

      const expected = res.expectedDecision
      const predicted = res.predictedDecision

      confusionMatrix[expected][predicted]++

      const isCorrect = expected === predicted
      if (isCorrect) correctCount++

      const lang = testCase.language
      if (languageAccuracy[lang]) {
        languageAccuracy[lang].total++
        if (isCorrect) languageAccuracy[lang].correct++
      }

      if (expected === 'READY') {
        if (predicted === 'READY') {
          trueReady++
        } else {
          falseNotReady++
        }
      } else if (predicted === 'READY') {
        falseReady++
      }

      if (expected === 'SUGGEST') {
        suggestTotal++
        if (predicted === 'SUGGEST') suggestCorrect++
      }

      const cost = extractCost(res.rawModelOutput)
      if (cost !== null) totalCost += cost
    } else {
      failedRequests++
    }
  }

  // Calculate per-language accuracies
  for (const lang of ['uk', 'en', 'mixed'] as const) {
    const data = languageAccuracy[lang]
    data.accuracy = data.total > 0 ? Number((data.correct / data.total).toFixed(4)) : 0
  }

  latencies.sort((a, b) => a - b)
  const totalValid = successfulRequests
  const accuracy = totalValid > 0 ? Number((correctCount / totalValid).toFixed(4)) : 0

  const readyPrecision =
    trueReady + falseReady > 0
      ? Number((trueReady / (trueReady + falseReady)).toFixed(4))
      : 0

  const readyRecall =
    trueReady + falseNotReady > 0
      ? Number((trueReady / (trueReady + falseNotReady)).toFixed(4))
      : 0

  const readyF1 =
    readyPrecision + readyRecall > 0
      ? Number(((2 * readyPrecision * readyRecall) / (readyPrecision + readyRecall)).toFixed(4))
      : 0

  const suggestAccuracy =
    suggestTotal > 0 ? Number((suggestCorrect / suggestTotal).toFixed(4)) : 0

  const meanLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0

  const p50LatencyMs =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0

  const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
  const p95LatencyMs = latencies.length > 0 ? latencies[p95Index] : 0

  return {
    modelId,
    endpointUrl,
    totalCases: cases.length,
    successfulRequests,
    failedRequests,
    correctCount,
    accuracy,
    readyPrecision,
    readyRecall,
    readyF1,
    falseReadyCount: falseReady,
    missedReadyCount: falseNotReady,
    suggestAccuracy,
    meanLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    languageAccuracy,
    confusionMatrix,
    reportedCostUsd: totalCost > 0 ? Number(totalCost.toFixed(6)) : 0
  }
}

function extractCost(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as {
    usage?: { cost?: number; cost_details?: { upstream_inference_cost?: number } }
  }
  if (typeof obj.usage?.cost === 'number') {
    return obj.usage.cost
  }
  if (typeof obj.usage?.cost_details?.upstream_inference_cost === 'number') {
    return obj.usage.cost_details.upstream_inference_cost
  }
  return null
}

export function formatConfusionMatrixMarkdown(
  matrix: ModelMetricsSummary['confusionMatrix']
): string {
  return [
    '| Expected \\ Predicted | IGNORE | SUGGEST | READY |',
    '| :--- | :---: | :---: | :---: |',
    `| **IGNORE** | ${matrix.IGNORE.IGNORE} | ${matrix.IGNORE.SUGGEST} | ${matrix.IGNORE.READY} |`,
    `| **SUGGEST** | ${matrix.SUGGEST.IGNORE} | ${matrix.SUGGEST.SUGGEST} | ${matrix.SUGGEST.READY} |`,
    `| **READY** | ${matrix.READY.IGNORE} | ${matrix.READY.SUGGEST} | ${matrix.READY.READY} |`
  ].join('\n')
}

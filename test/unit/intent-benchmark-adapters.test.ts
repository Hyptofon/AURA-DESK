import { describe, it, expect, vi } from 'vitest'
import { ChatCompletionsBenchmarkAdapter } from '../../src/main/transcription/benchmarks/chat-completions-adapter'
import { DecisionsApiBenchmarkAdapter } from '../../src/main/transcription/benchmarks/decisions-api-adapter'
import {
  computeMetrics,
  formatConfusionMatrixMarkdown,
  runModelBenchmark
} from '../../src/main/transcription/benchmarks/benchmark-runner'
import type {
  BenchmarkCase,
  NormalizedBenchmarkResult
} from '../../src/main/transcription/benchmarks/benchmark-types'

const MOCK_CASE_READY: BenchmarkCase = {
  id: 'test-case-ready',
  text: 'Чому цей алгоритм повільний?',
  category: 'uk_direct_question',
  language: 'uk',
  expectedDecision: 'READY',
  expectedIntent: 'direct_question',
  rationale: 'Direct question'
}

const MOCK_CASE_IGNORE: BenchmarkCase = {
  id: 'test-case-ignore',
  text: 'Цей код працює.',
  category: 'ordinary_statement',
  language: 'uk',
  expectedDecision: 'IGNORE',
  expectedIntent: 'statement',
  rationale: 'Ordinary statement'
}

describe('ChatCompletionsBenchmarkAdapter', () => {
  it('parses raw JSON response correctly and normalizes decision', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"decision":"READY","intent":"direct_question","reasoning":"clear question"}'
            }
          }
        ],
        usage: { total_tokens: 45, cost: 0 }
      })
    })

    const adapter = new ChatCompletionsBenchmarkAdapter('inclusionai/ling-3.2-flash:free', {
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const res = await adapter.classify(MOCK_CASE_READY, 'dummy-key')

    expect(res.success).toBe(true)
    expect(res.predictedDecision).toBe('READY')
    expect(res.predictedIntent).toBe('direct_question')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer dummy-key'
        })
      })
    )
  })

  it('strips markdown code fences from LLM output', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n{"decision":"IGNORE","intent":"statement"}\n```'
            }
          }
        ]
      })
    })

    const adapter = new ChatCompletionsBenchmarkAdapter('baidu/ernie-5.5-flash-preview:free', {
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const res = await adapter.classify(MOCK_CASE_IGNORE, 'dummy-key')
    expect(res.success).toBe(true)
    expect(res.predictedDecision).toBe('IGNORE')
  })

  it('handles HTTP error gracefully with fail-closed result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded'
    })

    const adapter = new ChatCompletionsBenchmarkAdapter('inclusionai/ling-3.2-flash:free', {
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const res = await adapter.classify(MOCK_CASE_READY, 'dummy-key')
    expect(res.success).toBe(false)
    expect(res.predictedDecision).toBeNull()
    expect(res.error).toContain('HTTP 429')
  })

  it('handles invalid JSON format gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Not a JSON object' } }]
      })
    })

    const adapter = new ChatCompletionsBenchmarkAdapter('inclusionai/ling-3.2-flash:free', {
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const res = await adapter.classify(MOCK_CASE_READY, 'dummy-key')
    expect(res.success).toBe(false)
    expect(res.error).toContain('JSON_PARSE_ERROR')
  })
})

describe('DecisionsApiBenchmarkAdapter', () => {
  it('sends typed choice question to /api/alpha/decisions and parses probabilities', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'perplexity/pplx-decider-v1.3:free',
        answers: {
          intent_decision: {
            type: 'choice',
            choice: 'READY',
            probabilities: { READY: 0.95, IGNORE: 0.05 },
            confidence: 0.95
          }
        },
        usage: { input_tokens: 60, output_tokens: 1, cost: 0 }
      })
    })

    const adapter = new DecisionsApiBenchmarkAdapter('perplexity/pplx-decider-v1.3:free', {
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const res = await adapter.classify(MOCK_CASE_READY, 'dummy-key')

    expect(res.success).toBe(true)
    expect(res.predictedDecision).toBe('READY')
    expect(res.decisionEvidence).toEqual({
      probabilities: { READY: 0.95, IGNORE: 0.05 },
      confidence: 0.95,
      usage: { input_tokens: 60, output_tokens: 1, cost: 0 }
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/alpha/decisions',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('handles invalid choice value gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        answers: {
          intent_decision: {
            choice: 'UNKNOWN_OPTION'
          }
        }
      })
    })

    const adapter = new DecisionsApiBenchmarkAdapter('perplexity/pplx-decider-flash-v1.3:free', {
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const res = await adapter.classify(MOCK_CASE_READY, 'dummy-key')
    expect(res.success).toBe(false)
    expect(res.predictedDecision).toBeNull()
    expect(res.error).toContain('INVALID_CHOICE_VALUE')
  })
})

describe('Benchmark Metrics Computation', () => {
  it('calculates accuracy, F1, and confusion matrix accurately', () => {
    const cases: BenchmarkCase[] = [
      {
        id: 'c1',
        text: 'q1',
        category: 'uk_direct_question',
        language: 'uk',
        expectedDecision: 'READY',
        expectedIntent: 'direct_question',
        rationale: ''
      },
      {
        id: 'c2',
        text: 'q2',
        category: 'en_direct_question',
        language: 'en',
        expectedDecision: 'READY',
        expectedIntent: 'direct_question',
        rationale: ''
      },
      {
        id: 'c3',
        text: 's1',
        category: 'statement_uncertainty',
        language: 'uk',
        expectedDecision: 'SUGGEST',
        expectedIntent: 'uncertainty',
        rationale: ''
      },
      {
        id: 'c4',
        text: 's2',
        category: 'ordinary_statement',
        language: 'en',
        expectedDecision: 'IGNORE',
        expectedIntent: 'statement',
        rationale: ''
      }
    ]

    const results: NormalizedBenchmarkResult[] = [
      {
        caseId: 'c1',
        modelId: 'inclusionai/ling-3.2-flash:free',
        expectedDecision: 'READY',
        predictedDecision: 'READY',
        rawModelOutput: { usage: { cost: 0 } },
        durationMs: 100,
        success: true
      },
      {
        caseId: 'c2',
        modelId: 'inclusionai/ling-3.2-flash:free',
        expectedDecision: 'READY',
        predictedDecision: 'SUGGEST', // missed ready
        rawModelOutput: { usage: { cost: 0 } },
        durationMs: 150,
        success: true
      },
      {
        caseId: 'c3',
        modelId: 'inclusionai/ling-3.2-flash:free',
        expectedDecision: 'SUGGEST',
        predictedDecision: 'SUGGEST',
        rawModelOutput: { usage: { cost: 0 } },
        durationMs: 200,
        success: true
      },
      {
        caseId: 'c4',
        modelId: 'inclusionai/ling-3.2-flash:free',
        expectedDecision: 'IGNORE',
        predictedDecision: 'IGNORE',
        rawModelOutput: { usage: { cost: 0 } },
        durationMs: 50,
        success: true
      }
    ]

    const metrics = computeMetrics(
      'inclusionai/ling-3.2-flash:free',
      'https://openrouter.ai/api/v1/chat/completions',
      cases,
      results
    )

    expect(metrics.totalCases).toBe(4)
    expect(metrics.successfulRequests).toBe(4)
    expect(metrics.correctCount).toBe(3)
    expect(metrics.accuracy).toBe(0.75)
    expect(metrics.readyPrecision).toBe(1.0) // 1 true ready, 0 false ready
    expect(metrics.readyRecall).toBe(0.5) // 1 true ready out of 2 expected ready
    expect(metrics.missedReadyCount).toBe(1)
    expect(metrics.falseReadyCount).toBe(0)
    expect(metrics.suggestAccuracy).toBe(1.0)
    expect(metrics.meanLatencyMs).toBe(125)
    expect(metrics.p50LatencyMs).toBe(150)

    const markdown = formatConfusionMatrixMarkdown(metrics.confusionMatrix)
    expect(markdown).toContain('| **IGNORE** | 1 | 0 | 0 |')
    expect(markdown).toContain('| **SUGGEST** | 0 | 1 | 0 |')
    expect(markdown).toContain('| **READY** | 0 | 1 | 1 |')
  })

  it('runs benchmark harness and honors signal abort', async () => {
    const mockAdapter = {
      modelId: 'inclusionai/ling-3.2-flash:free' as const,
      endpointUrl: 'https://openrouter.ai/api/v1/chat/completions',
      classify: vi.fn().mockResolvedValue({
        caseId: 'c1',
        modelId: 'inclusionai/ling-3.2-flash:free',
        expectedDecision: 'READY',
        predictedDecision: 'READY',
        rawModelOutput: null,
        durationMs: 10,
        success: true
      })
    }

    const controller = new AbortController()
    controller.abort()

    const { results } = await runModelBenchmark(mockAdapter, [MOCK_CASE_READY], 'key', {
      signal: controller.signal
    })

    expect(results.length).toBe(0)
  })
})

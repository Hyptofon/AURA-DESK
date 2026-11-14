import type {
  BenchmarkCase,
  BenchmarkDecision,
  BenchmarkModelId,
  IntentBenchmarkAdapter,
  NormalizedBenchmarkResult
} from './benchmark-types'

export class DecisionsApiBenchmarkAdapter implements IntentBenchmarkAdapter {
  public readonly endpointUrl = 'https://openrouter.ai/api/alpha/decisions'
  public readonly modelId: BenchmarkModelId
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(
    modelId: BenchmarkModelId,
    options: { fetchFn?: typeof fetch; timeoutMs?: number } = {}
  ) {
    this.modelId = modelId
    this.fetchFn = options.fetchFn ?? fetch
    this.timeoutMs = options.timeoutMs ?? 12000
  }

  public async classify(
    benchmarkCase: BenchmarkCase,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<NormalizedBenchmarkResult> {
    const startTime = Date.now()

    const requestPayload = {
      model: this.modelId,
      questions: {
        intent_decision: {
          type: 'choice',
          instructions:
            'Determine whether the speaker is asking for assistance or an answer (READY), expressing hesitation or uncertainty (SUGGEST), or speaking ordinary statements, quotes, reported speech, or rhetorical remarks not requiring assistant help (IGNORE).',
          criteria: {
            READY:
              'Direct or indirect questions, clear assistance requests, or actionable follow-ups requiring an answer.',
            SUGGEST:
              'Subtle uncertainty, exploratory remarks, or context-dependent requests that might benefit from assistance.',
            IGNORE:
              'Ordinary statements, quotes, reported speech, rhetorical questions, or irrelevant comments not asking for assistant help.'
          }
        }
      },
      state: {
        transcript: benchmarkCase.text,
        context: benchmarkCase.context ?? ''
      }
    }

    const effectiveSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs)

    try {
      const response = await this.fetchFn(this.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://aura-desk.local',
          'X-Title': 'AURA DESK Benchmark'
        },
        body: JSON.stringify(requestPayload),
        signal: effectiveSignal
      })

      const durationMs = Date.now() - startTime

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          caseId: benchmarkCase.id,
          modelId: this.modelId,
          expectedDecision: benchmarkCase.expectedDecision,
          predictedDecision: null,
          rawModelOutput: { status: response.status, body: errorText },
          durationMs,
          success: false,
          error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`
        }
      }

      const data = (await response.json()) as {
        model?: string
        answers?: {
          intent_decision?: {
            type?: string
            choice?: string
            probabilities?: Record<string, number>
            confidence?: number
          }
        }
        usage?: {
          input_tokens?: number
          output_tokens?: number
          cost?: number
          cost_details?: unknown
        }
      }

      const decisionAnswer = data.answers?.intent_decision
      const rawChoice = decisionAnswer?.choice
      const normalizedDecision = this.normalizeDecision(rawChoice)

      return {
        caseId: benchmarkCase.id,
        modelId: this.modelId,
        expectedDecision: benchmarkCase.expectedDecision,
        predictedDecision: normalizedDecision,
        rawModelOutput: data,
        decisionEvidence: {
          probabilities: decisionAnswer?.probabilities,
          confidence: decisionAnswer?.confidence,
          usage: data.usage
        },
        durationMs,
        success: normalizedDecision !== null,
        error: normalizedDecision === null ? `INVALID_CHOICE_VALUE: ${rawChoice}` : undefined
      }
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime
      const errorMessage = err instanceof Error ? err.message : String(err)
      return {
        caseId: benchmarkCase.id,
        modelId: this.modelId,
        expectedDecision: benchmarkCase.expectedDecision,
        predictedDecision: null,
        rawModelOutput: null,
        durationMs,
        success: false,
        error: errorMessage
      }
    }
  }

  private normalizeDecision(val: unknown): BenchmarkDecision | null {
    if (typeof val !== 'string') return null
    const upper = val.toUpperCase().trim()
    if (upper === 'READY' || upper === 'SUGGEST' || upper === 'IGNORE') {
      return upper as BenchmarkDecision
    }
    return null
  }
}

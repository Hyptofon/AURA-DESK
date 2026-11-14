import type {
  BenchmarkCase,
  BenchmarkDecision,
  BenchmarkModelId,
  IntentBenchmarkAdapter,
  NormalizedBenchmarkResult
} from './benchmark-types'

const CHAT_SYSTEM_PROMPT = `You are an expert conversational intent classifier for an AI desktop assistant.
Classify whether the speaker's utterance is an actionable request for assistant response.

Decision rubrics:
- READY: Direct or indirect questions, help requests, explanation requests, or clear conversational follow-ups requiring an answer from the assistant.
- SUGGEST: Utterances expressing hesitation, confusion, or subtle uncertainty that might benefit from proactive assistance, but not a direct command.
- IGNORE: Ordinary statements, quotations, reported speech (e.g. "he asked why..."), rhetorical remarks, conversational filler, or self-talk not requesting assistant action.

You MUST respond ONLY with a raw JSON object adhering to:
{
  "decision": "IGNORE" | "SUGGEST" | "READY",
  "intent": "direct_question" | "indirect_question" | "explanation_request" | "help_request" | "clarification_request" | "contextual_follow_up" | "statement" | "reported_question" | "rhetorical_question" | "other",
  "reasoning": "brief 1-sentence rationale"
}
Do not output markdown code blocks or explanatory prose outside the JSON.`

export class ChatCompletionsBenchmarkAdapter implements IntentBenchmarkAdapter {
  public readonly endpointUrl = 'https://openrouter.ai/api/v1/chat/completions'
  private readonly fetchFn: typeof fetch

  constructor(
    public readonly modelId: BenchmarkModelId,
    options: { fetchFn?: typeof fetch } = {}
  ) {
    this.fetchFn = options.fetchFn ?? fetch
  }

  public async classify(
    benchmarkCase: BenchmarkCase,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<NormalizedBenchmarkResult> {
    const startTime = Date.now()

    const userMessageContent = benchmarkCase.context
      ? `Prior Context:\n${benchmarkCase.context}\n\nLatest Utterance:\n"${benchmarkCase.text}"`
      : `Latest Utterance:\n"${benchmarkCase.text}"`

    const requestPayload = {
      model: this.modelId,
      messages: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        { role: 'user', content: userMessageContent }
      ],
      max_tokens: 150,
      temperature: 0.1
    }

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
        signal
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
        choices?: Array<{ message?: { content?: string; reasoning?: string } }>
        usage?: { total_tokens?: number; cost?: number }
      }

      const rawContent = data.choices?.[0]?.message?.content ?? ''
      const cleanedJson = this.cleanJsonContent(rawContent)

      let parsed: { decision?: string; intent?: string; reasoning?: string } = {}
      try {
        parsed = JSON.parse(cleanedJson)
      } catch {
        return {
          caseId: benchmarkCase.id,
          modelId: this.modelId,
          expectedDecision: benchmarkCase.expectedDecision,
          predictedDecision: null,
          rawModelOutput: data,
          decisionEvidence: { rawContent },
          durationMs,
          success: false,
          error: `JSON_PARSE_ERROR: Failed to parse "${rawContent.slice(0, 100)}"`
        }
      }

      const normalizedDecision = this.normalizeDecision(parsed.decision)

      return {
        caseId: benchmarkCase.id,
        modelId: this.modelId,
        expectedDecision: benchmarkCase.expectedDecision,
        predictedDecision: normalizedDecision,
        predictedIntent: parsed.intent,
        rawModelOutput: data,
        decisionEvidence: {
          parsed,
          reasoning: data.choices?.[0]?.message?.reasoning ?? parsed.reasoning,
          usage: data.usage
        },
        durationMs,
        success: normalizedDecision !== null,
        error: normalizedDecision === null ? `INVALID_DECISION_VALUE: ${parsed.decision}` : undefined
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

  private cleanJsonContent(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed.startsWith('```')) {
      const withoutFences = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      return withoutFences.trim()
    }
    return trimmed
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

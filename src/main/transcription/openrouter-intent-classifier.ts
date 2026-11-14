import type {
  SemanticClassifierConfig,
  SemanticClassifierStatus,
  SupportedClassifierModel
} from '../../shared/contracts/questions'
import { OpenRouterKeyStore, redactSecrets } from '../security/openrouter-key-store'
import {
  SEMANTIC_CLASSIFICATION_JSON_SCHEMA,
  SemanticClassificationResponseSchema,
  type IntentClassificationInput,
  type IntentClassificationResult,
  type IntentClassifier
} from './intent-classifier'
import {
  DEFAULT_CLASSIFIER_MODEL,
  SUPPORTED_CLASSIFIER_MODELS,
  calculateModelCostUsd,
  getModelSpec,
  isSupportedClassifierModel,
  type ModelPricingAndCapabilities
} from './intent-classifier-models'
import {
  CLASSIFIER_SYSTEM_PROMPT,
  buildClassifierUserPrompt,
  stripMarkdownFences
} from './intent-classifier-prompts'

export {
  SUPPORTED_CLASSIFIER_MODELS,
  type ModelPricingAndCapabilities
}

export interface OpenRouterIntentClassifierOptions {
  keyStore?: OpenRouterKeyStore
  enabled?: boolean
  userConsentGranted?: boolean
  model?: SupportedClassifierModel
  preferZdr?: boolean
  maxRequestsPerSession?: number
  maxRequestsPerMinute?: number
  maxBudgetUsd?: number
  timeoutMs?: number
  maxContextTurns?: number
  maxUtteranceChars?: number
  endpointUrl?: string
  fetchFn?: typeof fetch
  nowFn?: () => number
}

export class OpenRouterIntentClassifier implements IntentClassifier {
  private readonly keyStore: OpenRouterKeyStore
  private enabled: boolean
  private userConsentGranted: boolean
  private model: SupportedClassifierModel
  private preferZdr: boolean
  private readonly maxRequestsPerSession: number
  private readonly maxRequestsPerMinute: number
  private readonly maxBudgetUsd: number
  private readonly timeoutMs: number
  private readonly maxContextTurns: number
  private readonly maxUtteranceChars: number
  private readonly endpointUrl: string
  private readonly fetchFn: typeof fetch
  private readonly nowFn: () => number

  private requestCount = 0
  private totalSpentUsd = 0
  private creditsExhausted = false
  private lastError: string | null = null
  private recentRequestTimestamps: number[] = []

  constructor(options: OpenRouterIntentClassifierOptions = {}) {
    this.keyStore = options.keyStore ?? new OpenRouterKeyStore()
    this.enabled = options.enabled ?? false
    this.userConsentGranted = options.userConsentGranted ?? false
    this.model =
      options.model && isSupportedClassifierModel(options.model)
        ? options.model
        : DEFAULT_CLASSIFIER_MODEL
    this.preferZdr = options.preferZdr ?? true
    this.maxRequestsPerSession = Math.min(100, Math.max(1, options.maxRequestsPerSession ?? 100))
    this.maxRequestsPerMinute = Math.max(1, options.maxRequestsPerMinute ?? 15)
    this.maxBudgetUsd = Math.min(1.0, Math.max(0.001, options.maxBudgetUsd ?? 0.25))
    this.timeoutMs = Math.max(500, options.timeoutMs ?? 4000)
    this.maxContextTurns = Math.min(6, Math.max(1, options.maxContextTurns ?? 4))
    this.maxUtteranceChars = Math.min(1200, Math.max(100, options.maxUtteranceChars ?? 600))
    this.endpointUrl = options.endpointUrl ?? 'https://openrouter.ai/api/v1/chat/completions'
    this.fetchFn = options.fetchFn ?? fetch
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  public getStatus(): SemanticClassifierStatus {
    return {
      enabled: this.enabled,
      userConsentGranted: this.userConsentGranted,
      providerAvailable: this.keyStore.hasApiKey() && !this.creditsExhausted,
      configuredModel: this.model,
      zdrPreferred: this.preferZdr,
      requestCount: this.requestCount,
      maxRequests: this.maxRequestsPerSession,
      totalSpentUsd: Number(this.totalSpentUsd.toFixed(6)),
      budgetUsd: this.maxBudgetUsd,
      lastError: this.lastError
    }
  }

  public setConfig(config: Partial<SemanticClassifierConfig>): SemanticClassifierStatus {
    if (typeof config.enabled === 'boolean') {
      this.enabled = config.enabled
    }
    if (typeof config.userConsentGranted === 'boolean') {
      this.userConsentGranted = config.userConsentGranted
    }
    if (config.model && isSupportedClassifierModel(config.model)) {
      this.model = config.model
    }
    if (typeof config.preferZdr === 'boolean') {
      this.preferZdr = config.preferZdr
    }
    return this.getStatus()
  }

  public reset(): void {
    this.requestCount = 0
    this.totalSpentUsd = 0
    this.creditsExhausted = false
    this.lastError = null
    this.recentRequestTimestamps = []
  }

  public async classify(
    input: IntentClassificationInput
  ): Promise<IntentClassificationResult | null> {
    if (!this.enabled || !this.userConsentGranted) {
      return null
    }
    if (input.signal?.aborted) {
      this.lastError = 'aborted'
      return null
    }
    if (this.creditsExhausted) {
      this.lastError = 'credits_exhausted'
      return null
    }

    const apiKey = this.keyStore.getApiKey()
    if (!apiKey) {
      this.lastError = 'missing_api_key'
      return null
    }

    if (this.requestCount >= this.maxRequestsPerSession) {
      this.lastError = 'session_request_cap_reached'
      return null
    }

    if (this.totalSpentUsd >= this.maxBudgetUsd) {
      this.lastError = 'session_budget_cap_reached'
      return null
    }

    const now = this.nowFn()
    this.recentRequestTimestamps = this.recentRequestTimestamps.filter((ts) => now - ts < 60_000)
    if (this.recentRequestTimestamps.length >= this.maxRequestsPerMinute) {
      this.lastError = 'rate_limit_exceeded'
      return null
    }

    const modelSpec = getModelSpec(this.model)
    const userMessage = buildClassifierUserPrompt(input, {
      maxContextTurns: this.maxContextTurns,
      maxUtteranceChars: this.maxUtteranceChars
    })

    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs)
    const onCallerAbort = (): void => timeoutController.abort()
    input.signal?.addEventListener('abort', onCallerAbort, { once: true })

    const startPerf = performance.now()
    this.recentRequestTimestamps.push(now)

    try {
      const providerRouting: Record<string, unknown> = {
        allow_fallbacks: false
      }
      if (this.preferZdr && modelSpec.hasZdrEndpoint) {
        providerRouting.zdr = true
      }

      const requestBody = {
        model: modelSpec.id,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        temperature: 0,
        max_tokens: 180,
        reasoning: modelSpec.reasoningConfig,
        provider: providerRouting,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'conversation_intent',
            strict: true,
            schema: SEMANTIC_CLASSIFICATION_JSON_SCHEMA
          }
        }
      }

      const response = await this.fetchFn(this.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/Hyptofon/AURA-DESK',
          'X-Title': 'AURA DESK Intent Classifier'
        },
        body: JSON.stringify(requestBody),
        signal: timeoutController.signal
      })

      if (input.signal?.aborted) {
        this.lastError = 'aborted'
        return null
      }

      if (response.status === 402) {
        this.creditsExhausted = true
        this.lastError = 'openrouter_credits_exhausted_402'
        return null
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        const scrubbed = this.keyStore.sanitizeErrorMessage(errBody.slice(0, 160))
        this.lastError = `http_${response.status}${scrubbed ? `: ${scrubbed}` : ''}`
        return null
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          cost?: number
        }
      }

      if (input.signal?.aborted) {
        this.lastError = 'aborted'
        return null
      }

      const rawContent = payload.choices?.[0]?.message?.content
      if (!rawContent || typeof rawContent !== 'string') {
        this.lastError = 'empty_model_response'
        return null
      }

      const cleanJsonText = stripMarkdownFences(rawContent)
      const parsedJson: unknown = JSON.parse(cleanJsonText)
      const validated = SemanticClassificationResponseSchema.safeParse(parsedJson)
      if (!validated.success) {
        this.lastError = 'invalid_schema_response'
        return null
      }

      const promptTokens = payload.usage?.prompt_tokens ?? 160
      const completionTokens = payload.usage?.completion_tokens ?? 45
      const computedCostUsd =
        typeof payload.usage?.cost === 'number' && payload.usage.cost >= 0
          ? payload.usage.cost
          : calculateModelCostUsd(this.model, promptTokens, completionTokens)

      this.requestCount += 1
      this.totalSpentUsd = Number((this.totalSpentUsd + computedCostUsd).toFixed(8))
      this.lastError = null

      const latencyMs = Math.max(0.1, Number((performance.now() - startPerf).toFixed(2)))

      return {
        response: validated.data,
        modelId: modelSpec.id,
        latencyMs,
        promptTokens,
        completionTokens,
        costUsd: Number(computedCostUsd.toFixed(8))
      }
    } catch (err) {
      if (input.signal?.aborted) {
        this.lastError = 'aborted'
      } else if (timeoutController.signal.aborted) {
        this.lastError = 'timeout'
      } else {
        const rawMessage = err instanceof Error ? err.message : String(err)
        this.lastError = redactSecrets(this.keyStore.sanitizeErrorMessage(rawMessage), apiKey)
      }
      return null
    } finally {
      clearTimeout(timeoutId)
      input.signal?.removeEventListener('abort', onCallerAbort)
    }
  }
}

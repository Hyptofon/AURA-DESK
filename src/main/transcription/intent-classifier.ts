import { z } from 'zod'
import type {
  AddresseeAssessment,
  AssembledUtterance,
  ConversationIntent,
  IntentDecision,
  SemanticClassifierConfig,
  SemanticClassifierStatus,
  SupportedClassifierModel
} from '../../shared/contracts/questions'
import type { ConversationContextSnapshot } from './conversation-context'
import type { LocalIntentAnalysis } from './local-intent-analyzer'

export const CONVERSATION_INTENT_VALUES: readonly [ConversationIntent, ...ConversationIntent[]] = [
  'direct_question',
  'indirect_question',
  'explanation_request',
  'help_request',
  'clarification_request',
  'contextual_follow_up',
  'statement',
  'reported_question',
  'rhetorical_question',
  'other',
  'uncertain'
]

export const INTENT_DECISION_VALUES: readonly [IntentDecision, ...IntentDecision[]] = [
  'ignore',
  'suggest',
  'ready'
]

export const ADDRESSEE_ASSESSMENT_VALUES: readonly [
  AddresseeAssessment,
  ...AddresseeAssessment[]
] = ['assistant_or_user', 'group_or_classroom', 'third_party', 'self_talk', 'unknown']

export const SemanticClassificationResponseSchema = z
  .object({
    intent: z.enum(CONVERSATION_INTENT_VALUES),
    decision: z.enum(INTENT_DECISION_VALUES),
    requiresResponse: z.boolean(),
    addressee: z.enum(ADDRESSEE_ASSESSMENT_VALUES),
    evidence: z.array(z.string().max(120)).max(6),
    contextDependent: z.boolean(),
    uncertain: z.boolean()
  })
  .strict()

export type SemanticClassificationResponse = z.infer<typeof SemanticClassificationResponseSchema>

export const SEMANTIC_CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'decision',
    'requiresResponse',
    'addressee',
    'evidence',
    'contextDependent',
    'uncertain'
  ],
  properties: {
    intent: {
      type: 'string',
      enum: [...CONVERSATION_INTENT_VALUES]
    },
    decision: {
      type: 'string',
      enum: [...INTENT_DECISION_VALUES]
    },
    requiresResponse: {
      type: 'boolean'
    },
    addressee: {
      type: 'string',
      enum: [...ADDRESSEE_ASSESSMENT_VALUES]
    },
    evidence: {
      type: 'array',
      items: { type: 'string' }
    },
    contextDependent: {
      type: 'boolean'
    },
    uncertain: {
      type: 'boolean'
    }
  }
} as const

export interface IntentClassificationInput {
  utterance: AssembledUtterance
  context: ConversationContextSnapshot
  localAnalysis: LocalIntentAnalysis
  signal?: AbortSignal
}

export interface IntentClassificationResult {
  response: SemanticClassificationResponse
  modelId: SupportedClassifierModel
  latencyMs: number
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export interface IntentClassifier {
  classify(input: IntentClassificationInput): Promise<IntentClassificationResult | null>
  getStatus(): SemanticClassifierStatus
  setConfig(config: Partial<SemanticClassifierConfig>): SemanticClassifierStatus
  reset(): void
}

export type FakeClassifierHandler = (
  input: IntentClassificationInput
) => SemanticClassificationResponse | Promise<SemanticClassificationResponse | null> | null

/**
 * Deterministic in-memory semantic classifier for unit and benchmark tests.
 */
export class FakeIntentClassifier implements IntentClassifier {
  private enabled: boolean
  private userConsentGranted: boolean
  private providerAvailable: boolean
  private model: SupportedClassifierModel
  private zdrPreferred: boolean
  private requestCount = 0
  private maxRequests = 100
  private totalSpentUsd = 0
  private budgetUsd = 0.25
  private lastError: string | null = null
  private readonly handler: FakeClassifierHandler

  constructor(
    handler: FakeClassifierHandler,
    initial?: Partial<SemanticClassifierConfig> & { providerAvailable?: boolean }
  ) {
    this.handler = handler
    this.enabled = initial?.enabled ?? false
    this.userConsentGranted = initial?.userConsentGranted ?? false
    this.providerAvailable = initial?.providerAvailable ?? true
    this.model = initial?.model ?? 'google/gemini-3.1-flash-lite'
    this.zdrPreferred = initial?.preferZdr ?? true
  }

  async classify(input: IntentClassificationInput): Promise<IntentClassificationResult | null> {
    if (!this.enabled || !this.userConsentGranted || !this.providerAvailable) {
      return null
    }
    if (input.signal?.aborted) {
      this.lastError = 'aborted'
      return null
    }
    if (this.requestCount >= this.maxRequests) {
      this.lastError = 'request_cap_reached'
      return null
    }

    const start = performance.now()
    try {
      const raw = await this.handler(input)
      if (!raw || input.signal?.aborted) {
        return null
      }
      const parsed = SemanticClassificationResponseSchema.parse(raw)
      this.requestCount += 1
      const costUsd = 0.0001
      this.totalSpentUsd = Number((this.totalSpentUsd + costUsd).toFixed(6))
      this.lastError = null
      return {
        response: parsed,
        modelId: this.model,
        latencyMs: Math.max(0.1, Number((performance.now() - start).toFixed(2))),
        promptTokens: 120,
        completionTokens: 45,
        costUsd
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'fake_classifier_error'
      return null
    }
  }

  getStatus(): SemanticClassifierStatus {
    return {
      enabled: this.enabled,
      userConsentGranted: this.userConsentGranted,
      providerAvailable: this.providerAvailable,
      configuredModel: this.model,
      zdrPreferred: this.zdrPreferred,
      requestCount: this.requestCount,
      maxRequests: this.maxRequests,
      totalSpentUsd: this.totalSpentUsd,
      budgetUsd: this.budgetUsd,
      lastError: this.lastError
    }
  }

  setConfig(config: Partial<SemanticClassifierConfig>): SemanticClassifierStatus {
    if (typeof config.enabled === 'boolean') {
      this.enabled = config.enabled
    }
    if (typeof config.userConsentGranted === 'boolean') {
      this.userConsentGranted = config.userConsentGranted
    }
    if (config.model) {
      this.model = config.model
    }
    if (typeof config.preferZdr === 'boolean') {
      this.zdrPreferred = config.preferZdr
    }
    return this.getStatus()
  }

  reset(): void {
    this.requestCount = 0
    this.totalSpentUsd = 0
    this.lastError = null
  }
}

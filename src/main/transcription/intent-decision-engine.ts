import type {
  AssembledUtterance,
  EvidenceStrength,
  IntentDecision,
  IntentEvaluationRecord,
  QuestionCandidate,
  SemanticClassifierConfig,
  SemanticClassifierStatus
} from '../../shared/contracts/questions'
import { ConversationContext, type ConversationContextSnapshot } from './conversation-context'
import type { IntentClassifier } from './intent-classifier'
import { LocalIntentAnalyzer, type LocalIntentAnalysisResult } from './local-intent-analyzer'

export interface IntentDecisionEngineOptions {
  context?: ConversationContext
  localAnalyzer?: LocalIntentAnalyzer
  classifier?: IntentClassifier | null
}

export interface IntentDecisionOutcome {
  evaluation: IntentEvaluationRecord
  candidate: QuestionCandidate | null
  localAnalysis: LocalIntentAnalysisResult
  contextSnapshot: ConversationContextSnapshot
}

function decisionToStrength(decision: IntentDecision, uncertain: boolean): EvidenceStrength {
  if (decision === 'ready') {
    return uncertain ? 'moderate' : 'strong'
  }
  if (decision === 'suggest') {
    return uncertain ? 'weak' : 'moderate'
  }
  return 'none'
}

function strengthToHeuristicConfidence(
  strength: EvidenceStrength,
  decision: IntentDecision,
  fallbackScore: number
): number {
  if (decision === 'ready') {
    return Math.max(0.78, fallbackScore)
  }
  if (decision === 'suggest') {
    return Math.min(0.74, Math.max(0.52, fallbackScore))
  }
  if (strength === 'weak') {
    return Math.min(0.45, fallbackScore)
  }
  return Math.min(0.25, fallbackScore)
}

export class IntentDecisionEngine {
  private readonly context: ConversationContext
  private readonly localAnalyzer: LocalIntentAnalyzer
  private readonly classifier: IntentClassifier | null

  constructor(options: IntentDecisionEngineOptions = {}) {
    this.context = options.context ?? new ConversationContext()
    this.localAnalyzer = options.localAnalyzer ?? new LocalIntentAnalyzer()
    this.classifier = options.classifier ?? null
  }

  public async evaluateUtterance(
    utterance: AssembledUtterance,
    signal?: AbortSignal
  ): Promise<IntentDecisionOutcome | null> {
    if (signal?.aborted) {
      return null
    }

    const startTime = performance.now()
    const contextSnapshot = this.context.getSnapshot(utterance)
    const localAnalysis = this.localAnalyzer.analyze(utterance, contextSnapshot)

    let finalIntent = localAnalysis.intent
    let finalDecision = localAnalysis.decision
    let finalRoute: 'local' | 'openrouter' = 'local'
    let finalStrength = localAnalysis.evidenceStrength
    let finalRequiresResponse = localAnalysis.requiresResponse
    let finalAddressee = localAnalysis.addressee
    let finalContextUsed = localAnalysis.contextUsed
    let finalEvidence = [...localAnalysis.evidence]
    let finalUncertain = localAnalysis.uncertain
    let modelId: string | undefined
    let providerError: string | undefined

    const shouldEscalate = this.shouldCallSemanticClassifier(localAnalysis)

    if (shouldEscalate && this.classifier) {
      const remoteResult = await this.classifier.classify({
        utterance,
        context: contextSnapshot,
        localAnalysis,
        signal
      })

      if (signal?.aborted) {
        return null
      }

      if (remoteResult) {
        finalRoute = 'openrouter'
        finalIntent = remoteResult.response.intent
        finalDecision = remoteResult.response.decision
        finalRequiresResponse = remoteResult.response.requiresResponse
        finalAddressee = remoteResult.response.addressee
        finalContextUsed = localAnalysis.contextUsed || remoteResult.response.contextDependent
        finalUncertain = remoteResult.response.uncertain
        finalStrength = decisionToStrength(finalDecision, finalUncertain)
        finalEvidence = [
          ...localAnalysis.evidence,
          ...remoteResult.response.evidence.map((e) => `llm:${e}`)
        ].slice(0, 8)
        modelId = remoteResult.modelId
      } else {
        const status = this.classifier.getStatus()
        providerError = status.lastError ?? 'classifier_unavailable'
        // Conservative fallback on remote failure: never escalate ambiguous speech to 'ready'
        if (finalDecision === 'ready') {
          finalDecision = 'suggest'
        }
        finalEvidence = [...localAnalysis.evidence, `fallback:${providerError}`]
      }
    }

    if (signal?.aborted) {
      return null
    }

    // Record finalized turn into bounded conversation context
    this.context.recordTurn(utterance, finalIntent, finalDecision)

    const latencyMs = Math.max(0.05, Number((performance.now() - startTime).toFixed(2)))

    const evaluation: IntentEvaluationRecord = {
      utteranceId: utterance.id,
      source: utterance.source,
      startTimestamp: utterance.startTimestamp,
      endTimestamp: utterance.endTimestamp,
      text: utterance.text,
      language: localAnalysis.language,
      intent: finalIntent,
      decision: finalDecision,
      route: finalRoute,
      evidenceStrength: finalStrength,
      requiresResponse: finalRequiresResponse,
      addressee: finalAddressee,
      contextUsed: finalContextUsed,
      evidence: finalEvidence,
      uncertain: finalUncertain,
      latencyMs,
      ...(modelId ? { modelId } : {}),
      ...(providerError ? { providerError } : {})
    }

    if (finalDecision === 'ignore') {
      return {
        evaluation,
        candidate: null,
        localAnalysis,
        contextSnapshot
      }
    }

    const candidateConfidence = strengthToHeuristicConfidence(
      finalStrength,
      finalDecision,
      localAnalysis.heuristicScore
    )

    const primarySegmentId =
      utterance.segmentIds[utterance.segmentIds.length - 1] ?? utterance.id

    const candidate: QuestionCandidate = {
      id: `q-${utterance.id}`,
      segmentId: primarySegmentId,
      source: utterance.source,
      timestamp: utterance.startTimestamp,
      endTimestamp: utterance.endTimestamp,
      text: utterance.text,
      language: localAnalysis.language,
      confidence: Number(candidateConfidence.toFixed(2)),
      evidenceStrength: finalStrength,
      intent: finalIntent,
      decision: finalDecision,
      route: finalRoute,
      contextUsed: finalContextUsed,
      requiresResponse: finalRequiresResponse,
      addressee: finalAddressee,
      evidence: finalEvidence,
      uncertain: finalUncertain,
      status: finalDecision === 'ready' ? 'ready' : 'suggest',
      matchedPattern: localAnalysis.matchedPattern
    }

    return {
      evaluation,
      candidate,
      localAnalysis,
      contextSnapshot
    }
  }

  public getClassifierStatus(): SemanticClassifierStatus | undefined {
    return this.classifier?.getStatus()
  }

  public setClassifierConfig(
    config: Partial<SemanticClassifierConfig>
  ): SemanticClassifierStatus | undefined {
    return this.classifier?.setConfig(config)
  }

  public getContext(): ConversationContext {
    return this.context
  }

  public reset(): void {
    this.context.clear()
    this.classifier?.reset()
  }

  private shouldCallSemanticClassifier(localAnalysis: LocalIntentAnalysisResult): boolean {
    if (!this.classifier) {
      return false
    }
    const status = this.classifier.getStatus()
    if (!status.enabled || !status.userConsentGranted || !status.providerAvailable) {
      return false
    }
    return localAnalysis.isAmbiguous
  }
}

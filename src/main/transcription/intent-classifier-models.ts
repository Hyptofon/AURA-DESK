import type { SupportedClassifierModel } from '../../shared/contracts/questions'

export interface ModelPricingAndCapabilities {
  id: SupportedClassifierModel
  promptPricePerMillionUsd: number
  completionPricePerMillionUsd: number
  hasZdrEndpoint: boolean
  reasoningConfig: Record<string, unknown>
}

export const SUPPORTED_CLASSIFIER_MODELS: Readonly<
  Record<SupportedClassifierModel, ModelPricingAndCapabilities>
> = {
  'google/gemini-3.1-flash-lite': {
    id: 'google/gemini-3.1-flash-lite',
    promptPricePerMillionUsd: 0.25,
    completionPricePerMillionUsd: 1.5,
    hasZdrEndpoint: true,
    reasoningConfig: { effort: 'none', exclude: true }
  },
  'google/gemini-2.5-flash-lite': {
    id: 'google/gemini-2.5-flash-lite',
    promptPricePerMillionUsd: 0.1,
    completionPricePerMillionUsd: 0.4,
    hasZdrEndpoint: false,
    reasoningConfig: { enabled: false, exclude: true }
  },
  'google/gemini-3.5-flash-lite': {
    id: 'google/gemini-3.5-flash-lite',
    promptPricePerMillionUsd: 0.3,
    completionPricePerMillionUsd: 2.5,
    hasZdrEndpoint: true,
    reasoningConfig: { effort: 'minimal', exclude: true }
  }
}

export const DEFAULT_CLASSIFIER_MODEL: SupportedClassifierModel = 'google/gemini-3.1-flash-lite'

export function isSupportedClassifierModel(model: unknown): model is SupportedClassifierModel {
  return typeof model === 'string' && Object.prototype.hasOwnProperty.call(SUPPORTED_CLASSIFIER_MODELS, model)
}

export function getModelSpec(model: SupportedClassifierModel): ModelPricingAndCapabilities {
  return SUPPORTED_CLASSIFIER_MODELS[model] ?? SUPPORTED_CLASSIFIER_MODELS[DEFAULT_CLASSIFIER_MODEL]
}

export function calculateModelCostUsd(
  model: SupportedClassifierModel,
  promptTokens: number,
  completionTokens: number
): number {
  const spec = getModelSpec(model)
  const cost =
    (promptTokens / 1_000_000) * spec.promptPricePerMillionUsd +
    (completionTokens / 1_000_000) * spec.completionPricePerMillionUsd
  return Number(cost.toFixed(8))
}

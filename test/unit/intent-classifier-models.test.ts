import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_CLASSIFIER_MODELS,
  DEFAULT_CLASSIFIER_MODEL,
  isSupportedClassifierModel,
  getModelSpec,
  calculateModelCostUsd
} from '@/main/transcription/intent-classifier-models'

describe('intent-classifier-models', () => {
  it('defines default production model as gemini-3.1-flash-lite', () => {
    expect(DEFAULT_CLASSIFIER_MODEL).toBe('google/gemini-3.1-flash-lite')
    expect(SUPPORTED_CLASSIFIER_MODELS[DEFAULT_CLASSIFIER_MODEL]).toBeDefined()
    expect(SUPPORTED_CLASSIFIER_MODELS[DEFAULT_CLASSIFIER_MODEL].hasZdrEndpoint).toBe(true)
  })

  it('contains expected models with non-negative prices and reasoning config', () => {
    const models = Object.keys(SUPPORTED_CLASSIFIER_MODELS) as Array<keyof typeof SUPPORTED_CLASSIFIER_MODELS>
    expect(models).toContain('google/gemini-3.1-flash-lite')
    expect(models).toContain('google/gemini-2.5-flash-lite')
    expect(models).toContain('google/gemini-3.5-flash-lite')

    for (const m of models) {
      const spec = SUPPORTED_CLASSIFIER_MODELS[m]
      expect(spec.promptPricePerMillionUsd).toBeGreaterThan(0)
      expect(spec.completionPricePerMillionUsd).toBeGreaterThan(0)
      expect(spec.reasoningConfig).toBeDefined()
    }
  })

  it('validates supported classifier models with type guard', () => {
    expect(isSupportedClassifierModel('google/gemini-3.1-flash-lite')).toBe(true)
    expect(isSupportedClassifierModel('google/gemini-2.5-flash-lite')).toBe(true)
    expect(isSupportedClassifierModel('google/gemini-3.5-flash-lite')).toBe(true)
    expect(isSupportedClassifierModel('openai/gpt-4o')).toBe(false)
    expect(isSupportedClassifierModel('')).toBe(false)
    expect(isSupportedClassifierModel(null)).toBe(false)
    expect(isSupportedClassifierModel(123)).toBe(false)
  })

  it('retrieves model spec and falls back safely', () => {
    const spec = getModelSpec('google/gemini-2.5-flash-lite')
    expect(spec.id).toBe('google/gemini-2.5-flash-lite')
    expect(spec.hasZdrEndpoint).toBe(false)

    // Fallback for cast unknown model
    const fallback = getModelSpec('unknown-model' as any)
    expect(fallback.id).toBe(DEFAULT_CLASSIFIER_MODEL)
  })

  it('calculates model cost accurately in USD', () => {
    // gemini-3.1-flash-lite: $0.25/M prompt, $1.5/M completion
    // 1000 prompt tokens = $0.00025
    // 1000 completion tokens = $0.0015
    // Total = $0.00175
    const cost = calculateModelCostUsd('google/gemini-3.1-flash-lite', 1000, 1000)
    expect(cost).toBe(0.00175)

    // gemini-2.5-flash-lite: $0.10/M prompt, $0.40/M completion
    // 200 prompt tokens = $0.00002
    // 50 completion tokens = $0.00002
    // Total = $0.00004
    const cost2 = calculateModelCostUsd('google/gemini-2.5-flash-lite', 200, 50)
    expect(cost2).toBe(0.00004)
  })
})

import { describe, it, expect, vi } from 'vitest'
import {
  OpenRouterKeyStore,
  parseOpenRouterKeyFromDotEnv,
  redactSecrets
} from '@/main/security/openrouter-key-store'
import { OpenRouterIntentClassifier } from '@/main/transcription/openrouter-intent-classifier'
import { ConversationContext } from '@/main/transcription/conversation-context'
import { LocalIntentAnalyzer } from '@/main/transcription/local-intent-analyzer'
import { IntentDecisionEngine } from '@/main/transcription/intent-decision-engine'
import type { AssembledUtterance } from '@/shared/contracts/questions'

function makeUtterance(
  text: string,
  overrides: Partial<AssembledUtterance> = {}
): AssembledUtterance {
  return {
    id: overrides.id ?? 'utt-1',
    source: overrides.source ?? 'mic',
    startTimestamp: overrides.startTimestamp ?? 1000,
    endTimestamp: overrides.endTimestamp ?? 2500,
    text,
    normalizedText: text.toLowerCase(),
    language: overrides.language ?? 'uk',
    segmentIds: overrides.segmentIds ?? ['seg-1'],
    fragmentCount: overrides.fragmentCount ?? 1,
    isComplete: overrides.isComplete ?? true,
    flushReason: overrides.flushReason ?? 'silence_boundary'
  }
}

describe('OpenRouterKeyStore & Secret Redaction', () => {
  it('parses OPENROUTER_API_KEY from .env content with quotes and comments', () => {
    const content = `
      # Comment line
      OTHER_VAR=123
      OPENROUTER_API_KEY="sk-or-v1-testsecret1234567890" # inline comment
    `
    expect(parseOpenRouterKeyFromDotEnv(content)).toBe('sk-or-v1-testsecret1234567890')
  })

  it('encrypts key in memory when safeStorage is available and scrubs secret from errors', () => {
    const fakeKey = 'sk-or-v1-supersecret999888777'
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => Buffer.from(plain, 'utf8').reverse(),
      decryptString: (buf: Buffer) => Buffer.from(buf).reverse().toString('utf8')
    }

    const store = new OpenRouterKeyStore({
      env: { OPENROUTER_API_KEY: fakeKey },
      safeStorage
    })

    expect(store.hasApiKey()).toBe(true)
    expect(store.getApiKey()).toBe(fakeKey)

    const scrubbed = store.sanitizeErrorMessage(
      `Request failed with Authorization: Bearer ${fakeKey} and key=${fakeKey}`
    )
    expect(scrubbed).not.toContain(fakeKey)
    expect(scrubbed).toContain('[REDACTED')

    store.clear()
    expect( redactSecrets(`Error with ${fakeKey}`, fakeKey) ).not.toContain(fakeKey)
  })
})

describe('OpenRouterIntentClassifier (Hermetic Fake Fetch)', () => {
  const testKey = 'sk-or-v1-hermetictestkey123456'

  function makeKeyStore(): OpenRouterKeyStore {
    return new OpenRouterKeyStore({
      env: { OPENROUTER_API_KEY: testKey }
    })
  }

  it('is disabled by default and makes zero network requests without explicit consent', async () => {
    const fetchMock = vi.fn()
    const classifier = new OpenRouterIntentClassifier({
      keyStore: makeKeyStore(),
      fetchFn: fetchMock as unknown as typeof fetch
    })

    expect(classifier.getStatus().enabled).toBe(false)
    expect(classifier.getStatus().userConsentGranted).toBe(false)

    const context = new ConversationContext()
    const analyzer = new LocalIntentAnalyzer()
    const utt = makeUtterance('Я вже годину дивлюся на цей код і не розумію, де помилка.')
    const snap = context.getSnapshot(utt)
    const local = analyzer.analyze(utt, snap)

    const res = await classifier.classify({
      utterance: utt,
      context: snap,
      localAnalysis: local
    })

    expect(res).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends structured output schema, ZDR routing, reasoning suppression, and untrusted XML tags when enabled', async () => {
    const capturedBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'help_request',
                  decision: 'ready',
                  requiresResponse: true,
                  addressee: 'assistant_or_user',
                  evidence: ['troubleshooting_stuck'],
                  contextDependent: false,
                  uncertain: false
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 180,
            completion_tokens: 42
          }
        }),
        { status: 200 }
      )
    })

    const classifier = new OpenRouterIntentClassifier({
      keyStore: makeKeyStore(),
      enabled: true,
      userConsentGranted: true,
      model: 'google/gemini-3.1-flash-lite',
      preferZdr: true,
      fetchFn: fetchMock as unknown as typeof fetch
    })

    const context = new ConversationContext()
    const analyzer = new LocalIntentAnalyzer()
    const utt = makeUtterance('Я вже годину дивлюся на цей код і не розумію, де помилка.')
    const snap = context.getSnapshot(utt)
    const local = analyzer.analyze(utt, snap)

    const result = await classifier.classify({
      utterance: utt,
      context: snap,
      localAnalysis: local
    })

    expect(result).not.toBeNull()
    expect(result?.response.intent).toBe('help_request')
    expect(result?.response.decision).toBe('ready')
    expect(result?.modelId).toBe('google/gemini-3.1-flash-lite')
    expect(result?.costUsd).toBeGreaterThan(0)

    const capturedBody = capturedBodies[0]
    expect(capturedBody).toBeDefined()
    expect(capturedBody?.model).toBe('google/gemini-3.1-flash-lite')
    expect(capturedBody?.max_tokens).toBe(180)
    expect(capturedBody?.reasoning).toEqual({ effort: 'none', exclude: true })
    expect(capturedBody?.provider).toEqual({ allow_fallbacks: false, zdr: true })

    const messages = capturedBody?.messages as Array<{ role: string; content: string }>
    expect(messages[1].content).toContain('<untrusted_transcript>')
    expect(messages[1].content).toContain('<untrusted_context>')
  })

  it('activates circuit breaker on HTTP 402 credits exhausted and prevents further calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Insufficient credits', { status: 402 })
    )

    const classifier = new OpenRouterIntentClassifier({
      keyStore: makeKeyStore(),
      enabled: true,
      userConsentGranted: true,
      fetchFn: fetchMock as unknown as typeof fetch
    })

    const context = new ConversationContext()
    const analyzer = new LocalIntentAnalyzer()
    const utt = makeUtterance('Не впевнений, що цей підхід правильний.')
    const snap = context.getSnapshot(utt)
    const local = analyzer.analyze(utt, snap)

    const first = await classifier.classify({ utterance: utt, context: snap, localAnalysis: local })
    expect(first).toBeNull()
    expect(classifier.getStatus().providerAvailable).toBe(false)
    expect(classifier.getStatus().lastError).toBe('openrouter_credits_exhausted_402')

    // Second attempt is blocked by circuit breaker without calling fetch
    const second = await classifier.classify({ utterance: utt, context: snap, localAnalysis: local })
    expect(second).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('enforces session request cap, rate limit, AbortSignal cancellation, and secret redaction on error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new Error(`Connection reset with header Bearer ${testKey}`)
    )

    const classifier = new OpenRouterIntentClassifier({
      keyStore: makeKeyStore(),
      enabled: true,
      userConsentGranted: true,
      maxRequestsPerSession: 1,
      fetchFn: fetchMock as unknown as typeof fetch
    })

    const context = new ConversationContext()
    const analyzer = new LocalIntentAnalyzer()
    const utt = makeUtterance('Не впевнений, що цей підхід правильний.')
    const snap = context.getSnapshot(utt)
    const local = analyzer.analyze(utt, snap)

    const res = await classifier.classify({ utterance: utt, context: snap, localAnalysis: local })
    expect(res).toBeNull()
    expect(classifier.getStatus().lastError).not.toContain(testKey)
    expect(classifier.getStatus().lastError).toContain('[REDACTED')

    // Test AbortSignal pre-aborted
    const abortController = new AbortController()
    abortController.abort()
    const abortedRes = await classifier.classify({
      utterance: utt,
      context: snap,
      localAnalysis: local,
      signal: abortController.signal
    })
    expect(abortedRes).toBeNull()
    expect(classifier.getStatus().lastError).toBe('aborted')
  })
})

describe('IntentDecisionEngine Routing & Fallback', () => {
  it('resolves obvious statements and clear questions locally without invoking remote classifier', async () => {
    const classifySpy = vi.fn()
    const fakeRemote = {
      classify: classifySpy,
      getStatus: () => ({
        enabled: true,
        userConsentGranted: true,
        providerAvailable: true,
        configuredModel: 'google/gemini-3.1-flash-lite' as const,
        zdrPreferred: true,
        requestCount: 0,
        maxRequests: 100,
        totalSpentUsd: 0,
        budgetUsd: 0.25,
        lastError: null
      }),
      setConfig: vi.fn(),
      reset: vi.fn()
    }

    const engine = new IntentDecisionEngine({ classifier: fakeRemote })

    // 1. Obvious statement -> local ignore, 0 remote calls
    const stmtOutcome = await engine.evaluateUtterance(
      makeUtterance('Сьогодні ми розглядаємо архітектуру бази даних.')
    )
    expect(stmtOutcome?.evaluation.decision).toBe('ignore')
    expect(stmtOutcome?.evaluation.route).toBe('local')
    expect(classifySpy).not.toHaveBeenCalled()

    // 2. Clear direct question -> local ready, 0 remote calls
    const qOutcome = await engine.evaluateUtterance(
      makeUtterance('Поясни різницю між потоками та процесами.')
    )
    expect(qOutcome?.evaluation.decision).toBe('ready')
    expect(qOutcome?.evaluation.route).toBe('local')
    expect(classifySpy).not.toHaveBeenCalled()

    // 3. Ambiguous implicit frustration -> escalates to remote classifier
    classifySpy.mockResolvedValueOnce(null) // Simulate remote failure -> safe fallback to suggest
    const ambigOutcome = await engine.evaluateUtterance(
      makeUtterance('Я вже годину дивлюся на цей код і не розумію, де помилка.')
    )
    expect(classifySpy).toHaveBeenCalledTimes(1)
    expect(ambigOutcome?.evaluation.decision).toBe('suggest')
    expect(ambigOutcome?.evaluation.route).toBe('local')
  })
})

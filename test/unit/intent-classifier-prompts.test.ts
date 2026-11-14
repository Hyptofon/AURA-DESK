import { describe, it, expect } from 'vitest'
import {
  CLASSIFIER_SYSTEM_PROMPT,
  buildClassifierUserPrompt,
  stripMarkdownFences
} from '@/main/transcription/intent-classifier-prompts'
import type { IntentClassificationInput } from '@/main/transcription/intent-classifier'
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

function makeInput(
  utteranceText: string,
  turns: Array<{
    source: 'mic' | 'system'
    language: 'uk' | 'en' | 'mixed' | 'unknown'
    intent: string
    decision: string
    text: string
  }> = []
): IntentClassificationInput {
  const utt = makeUtterance(utteranceText)
  return {
    utterance: utt,
    context: {
      turns: turns.map((t, idx) => ({
        id: `turn-${idx + 1}`,
        source: t.source,
        language: t.language as 'uk' | 'en' | 'mixed' | 'unknown',
        intent: t.intent as any,
        decision: t.decision as any,
        text: t.text,
        timestamp: 1000 + idx * 1000,
        requiresResponse: false
      })),
      recentTopics: [],
      dominantLanguage: 'uk',
      lastSpokenTimestamp: 1500
    },
    localAnalysis: {
      intent: 'explanation_request',
      decision: 'suggest',
      strength: 'moderate',
      confidence: 0.65,
      isQuestion: true,
      positiveEvidence: ['intent:explanation_request'],
      negativeEvidence: [],
      candidateCategory: 'explanation_request'
    }
  }
}

describe('intent-classifier-prompts', () => {
  it('defines CLASSIFIER_SYSTEM_PROMPT with security invariant and required taxonomy', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('<untrusted_transcript>')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('<untrusted_context>')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('SECURITY INVARIANT:')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('direct_question')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('indirect_question')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('explanation_request')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('help_request')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('clarification_request')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('contextual_follow_up')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('statement')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('reported_question')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('rhetorical_question')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('ready')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('suggest')
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('ignore')
  })

  it('builds user prompt with untrusted XML tags and formats context turns', () => {
    const input = makeInput('Як налаштувати IPC у Electron?', [
      {
        source: 'mic',
        language: 'uk',
        intent: 'statement',
        decision: 'ignore',
        text: 'Розглядаємо архітектуру проєкту.'
      }
    ])

    const prompt = buildClassifierUserPrompt(input)
    expect(prompt).toContain('<untrusted_context>')
    expect(prompt).toContain('source=mic lang=uk intent=statement decision=ignore: Розглядаємо архітектуру проєкту.')
    expect(prompt).toContain('</untrusted_context>')
    expect(prompt).toContain('<untrusted_transcript>')
    expect(prompt).toContain('source=mic language=uk flushReason=silence_boundary')
    expect(prompt).toContain('localHintIntent=explanation_request localHintDecision=suggest')
    expect(prompt).toContain('text: Як налаштувати IPC у Electron?')
    expect(prompt).toContain('</untrusted_transcript>')
  })

  it('handles empty context turns gracefully', () => {
    const input = makeInput('Якесь питання без контексту.')
    const prompt = buildClassifierUserPrompt(input)
    expect(prompt).toContain('<untrusted_context>\nnone\n</untrusted_context>')
  })

  it('truncates turns and utterance according to options bounds', () => {
    const input = makeInput('A'.repeat(500), [
      { source: 'mic', language: 'uk', intent: 'statement', decision: 'ignore', text: 'Turn 1' },
      { source: 'mic', language: 'uk', intent: 'statement', decision: 'ignore', text: 'Turn 2' },
      { source: 'mic', language: 'uk', intent: 'statement', decision: 'ignore', text: 'Turn 3' },
      { source: 'mic', language: 'uk', intent: 'statement', decision: 'ignore', text: 'Turn 4' },
      { source: 'mic', language: 'uk', intent: 'statement', decision: 'ignore', text: 'Turn 5' }
    ])

    const prompt = buildClassifierUserPrompt(input, {
      maxContextTurns: 2,
      maxUtteranceChars: 150
    })

    expect(prompt).not.toContain('Turn 1')
    expect(prompt).not.toContain('Turn 2')
    expect(prompt).not.toContain('Turn 3')
    expect(prompt).toContain('Turn 4')
    expect(prompt).toContain('Turn 5')
    expect(prompt).toContain(`text: ${'A'.repeat(150)}`)
    expect(prompt).not.toContain('A'.repeat(151))
  })

  it('strips markdown fences from JSON output', () => {
    expect(stripMarkdownFences('```json\n{"intent":"statement"}\n```')).toBe('{"intent":"statement"}')
    expect(stripMarkdownFences('```\n{"intent":"direct_question"}\n```')).toBe('{"intent":"direct_question"}')
    expect(stripMarkdownFences('{"intent":"direct_question"}')).toBe('{"intent":"direct_question"}')
    expect(stripMarkdownFences('   {"decision":"ready"}   ')).toBe('{"decision":"ready"}')
  })
})

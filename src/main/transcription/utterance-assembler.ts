/**
 * Context-Safe Semantic Utterance Assembler.
 * Combines related finalized STT fragments from the same audio source into complete
 * semantic utterances while handling 5-second forced STT window splits, boundary
 * overlaps, internal pauses, consecutive independent questions, and lecture bounds.
 */

import type { AudioSourceKind } from '@/shared/contracts/audio'
import type { DetectedLanguage, TranscriptSegment } from '@/shared/contracts/transcription'
import type { AssembledUtterance, UtteranceFlushReason } from '@/shared/contracts/questions'
import { detectTranscriptLanguage } from './whisper-cpp-provider'

export interface UtteranceAssemblerOptions {
  /** Standard silence gap (ms) to consider an utterance complete. Default: 900ms */
  silenceBoundaryMs?: number
  /** Extended silence gap (ms) when a fragment was force-split at max window duration or ends mid-clause. Default: 2000ms */
  continuationSilenceMs?: number
  /** Maximum total duration (ms) of an assembled utterance before forced flush during continuous lectures. Default: 20000ms */
  maxUtteranceDurationMs?: number
  /** Maximum number of STT fragments merged into a single utterance. Default: 6 */
  maxFragments?: number
  /** Maximum character length of a single assembled utterance. Default: 1000 */
  maxCharacters?: number
}

interface PendingUtteranceBuffer {
  source: AudioSourceKind
  startTimestamp: number
  endTimestamp: number
  texts: string[]
  assembledText: string
  segmentIds: string[]
  languages: DetectedLanguage[]
  lastFragmentForcedSplit: boolean
}

const NOISE_ARTIFACT_PATTERNS = [
  /^\[blank_audio\]$/i,
  /^\[music\]$/i,
  /^\[silence\]$/i,
  /^\[applause\]$/i,
  /^\(музика\)$/i,
  /^\(тиша\)$/i,
  /^\(шум\)$/i,
  /^[.,!?\-—–…\s]+$/
]

const CONTINUATION_TRAILING_WORDS = new Set([
  // Ukrainian conjunctions, prepositions, relative pronouns indicating incomplete clause
  'і',
  'й',
  'та',
  'а',
  'але',
  'бо',
  'тому',
  'що',
  'щоб',
  'якщо',
  'коли',
  'який',
  'яка',
  'яке',
  'які',
  'якого',
  'якій',
  'яких',
  'де',
  'куди',
  'звідки',
  'через',
  'після',
  'перед',
  'для',
  'від',
  'до',
  'на',
  'у',
  'в',
  'з',
  'із',
  'зі',
  'про',
  'при',
  'над',
  'під',
  'між',
  'без',
  'чи',
  'або',
  // English conjunctions, prepositions, relative pronouns, auxiliaries indicating incomplete clause
  'and',
  'or',
  'but',
  'because',
  'since',
  'while',
  'when',
  'if',
  'unless',
  'until',
  'although',
  'though',
  'which',
  'that',
  'who',
  'whose',
  'whom',
  'where',
  'whether',
  'to',
  'for',
  'with',
  'without',
  'from',
  'into',
  'during',
  'before',
  'after',
  'between',
  'under',
  'over',
  'of',
  'in',
  'on',
  'at',
  'by',
  'about',
  'as',
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'will',
  'would',
  'can',
  'could',
  'should',
  'does',
  'do',
  'did',
  'has',
  'have',
  'had'
])

const NEW_QUESTION_STARTERS = [
  // Ukrainian independent question/request starters (avoid \b after Cyrillic; use (?=\s|$|[.,!?;:]))
  /^(?:а\s+|і\s+|та\s+|ну\s+|друге\s+питання\s+|ще\s+питання\s+)?(?:чому|навіщо|скільки|куди|звідки)(?=\s|$|[.,!?;:])/i,
  /^(?:а\s+|і\s+|та\s+|ну\s+)?(?:як\s+(?:саме|мені|нам|це|працює|виправити|зробити|налаштувати|уникнути|використовувати|запустити))(?=\s|$|[.,!?;:])/i,
  /^(?:а\s+|і\s+|та\s+|ну\s+)?(?:що\s+(?:таке|означає|робить|робити|буде|відбувається|саме|тут|це))(?=\s|$|[.,!?;:])/i,
  /^(?:а\s+|і\s+|та\s+|ну\s+)?(?:де\s+(?:саме|знаходиться|лежить|знайти|шукати|помилка|налаштування|тут))(?=\s|$|[.,!?;:])/i,
  /^(?:а\s+|і\s+|та\s+|ну\s+)?(?:коли\s+(?:саме|потрібно|варто|використовувати|викликається|краще))(?=\s|$|[.,!?;:])/i,
  /^(?:а\s+|і\s+|та\s+|ну\s+)?(?:який|яка|яке|які)\s+\S+/i,
  /^(?:а\s+|і\s+|та\s+|ну\s+)?(?:чи\s+(?:можна|можеш|можете|потрібно|варто|працює|є|має|буде))(?=\s|$|[.,!?;:])/i,
  /^(?:будь\s+ласка\s+)?(?:підкажи|підкажіть|поясни|поясніть|розкажи|розкажіть|допоможи|допоможіть|уточни|уточніть)(?=\s|$|[.,!?;:])/i,
  /^(?:а\s+)?(?:можеш|можете|хтось\s+може)\s+(?:пояснити|підказати|показати|допомогти|уточнити)(?=\s|$|[.,!?;:])/i,
  // English independent question/request starters
  /^(?:and\s+|so\s+|also\s+|second\s+question\s+|another\s+question\s+)?(?:why|where|when|who|whose|whom)\s+(?:is|are|was|were|do|does|did|can|could|should|would|will|has|have)\b/i,
  /^(?:and\s+|so\s+|also\s+)?(?:what|which)\s+\S+/i,
  /^(?:and\s+|so\s+|also\s+)?(?:how)\s+(?:do|does|did|can|could|should|would|will|is|are|to|many|much|long|often)\b/i,
  /^(?:and\s+|so\s+|also\s+|please\s+)?(?:can|could|would)\s+(?:you|someone|anyone|we|i)\b/i,
  /^(?:and\s+|so\s+)?(?:is|are|does|do|did|will|should)\s+(?:this|that|it|there|you|we|they)\b/i,
  /^(?:please\s+)?(?:explain|clarify|help\s+me|tell\s+me)\b/i
]

const SUBORDINATE_CONTINUATION_STARTERS = [
  /^(?:бо|тому\s+що|оскільки|якщо|коли\s+я|коли\s+ми|коли\s+воно|який|яка|яке|які|щоб|проте|однак|або|чи\s+ні)(?=\s|$|[.,!?;:])/i,
  /^(?:because|since|when\s+i|when\s+we|when\s+it|if\s+i|if\s+we|if\s+it|which|that|where\s+it|although|though|or\s+not)\b/i
]

export function normalizeUtteranceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"«»„“”’‘ʼ[\]\\|<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeWords(text: string): string[] {
  const norm = normalizeUtteranceText(text)
  return norm.length > 0 ? norm.split(' ') : []
}

function isNoiseOrEmptyFragment(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  for (const pattern of NOISE_ARTIFACT_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  const words = tokenizeWords(trimmed)
  return words.length === 0
}

function looksLikeCompleteQuestionOrRequest(text: string): boolean {
  const trimmed = text.trim()
  const words = tokenizeWords(trimmed)
  if (words.length < 3) return false
  if (trimmed.endsWith('?')) return true
  for (const pattern of NEW_QUESTION_STARTERS) {
    if (pattern.test(trimmed)) {
      const lastWord = words[words.length - 1] ?? ''
      if (!CONTINUATION_TRAILING_WORDS.has(lastWord)) {
        return true
      }
    }
  }
  return false
}

function startsNewIndependentQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (SUBORDINATE_CONTINUATION_STARTERS.some((pattern) => pattern.test(trimmed))) {
    return false
  }
  for (const pattern of NEW_QUESTION_STARTERS) {
    if (pattern.test(trimmed)) {
      return true
    }
  }
  return false
}

function endsWithIncompleteContinuation(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/[.!?…]$/.test(trimmed)) return false
  if (/[,:—–-]$/.test(trimmed)) return true
  const words = tokenizeWords(trimmed)
  if (words.length === 0) return false
  const lastWord = words[words.length - 1]
  return CONTINUATION_TRAILING_WORDS.has(lastWord)
}

/**
 * Merges two consecutive transcript fragments, deduplicating boundary word overlaps
 * caused by sliding or adjacent STT windows.
 */
export function mergeFragmentTextsWithOverlapDedup(existingText: string, nextText: string): string {
  const cleanExisting = existingText.trim()
  const cleanNext = nextText.trim()
  if (!cleanExisting) return cleanNext
  if (!cleanNext) return cleanExisting

  const normExisting = normalizeUtteranceText(cleanExisting)
  const normNext = normalizeUtteranceText(cleanNext)

  // 1. Exact duplicate or next is already a suffix of existing
  if (normExisting === normNext || normExisting.endsWith(normNext)) {
    return cleanExisting
  }

  // 2. Existing is a strict prefix of next (STT re-emitted expanded window)
  if (normNext.startsWith(normExisting)) {
    return cleanNext
  }

  // 3. Check boundary word overlap (1 to 6 words at the tail of existing matching head of next)
  const existingRawWords = cleanExisting.split(/\s+/)
  const nextRawWords = cleanNext.split(/\s+/)
  const existingNormWords = existingRawWords.map((w) => normalizeUtteranceText(w)).filter(Boolean)
  const nextNormWords = nextRawWords.map((w) => normalizeUtteranceText(w)).filter(Boolean)

  const maxOverlap = Math.min(6, existingNormWords.length, nextNormWords.length)
  let bestOverlap = 0

  for (let k = maxOverlap; k >= 1; k--) {
    let matches = true
    for (let i = 0; i < k; i++) {
      if (existingNormWords[existingNormWords.length - k + i] !== nextNormWords[i]) {
        matches = false
        break
      }
    }
    if (matches) {
      // Avoid deduplicating a single common 1-letter conjunction unless identical token
      if (k === 1 && existingNormWords[existingNormWords.length - 1].length <= 1) {
        continue
      }
      bestOverlap = k
      break
    }
  }

  if (bestOverlap > 0) {
    const remainingNextWords = nextRawWords.slice(bestOverlap)
    if (remainingNextWords.length === 0) {
      return cleanExisting
    }
    return `${cleanExisting} ${remainingNextWords.join(' ')}`.replace(/\s+/g, ' ').trim()
  }

  return `${cleanExisting} ${cleanNext}`.replace(/\s+/g, ' ').trim()
}

/**
 * Splits a single STT segment text ONLY when it contains two or more distinct independent questions.
 * Preserves setup-statement + question ("Я запустив код. Чому він падає?") as a single utterance.
 */
function splitMultiQuestionText(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed.includes('?')) {
    return [trimmed]
  }

  // Split after question marks that are followed by space and another clause
  const parts = trimmed
    .split(/(?<=\?)\s+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length <= 1) {
    return [trimmed]
  }

  const results: string[] = []
  let current = parts[0]

  for (let i = 1; i < parts.length; i++) {
    const nextPart = parts[i]
    const currentIsQuestion = looksLikeCompleteQuestionOrRequest(current)
    const nextIsQuestion =
      looksLikeCompleteQuestionOrRequest(nextPart) || startsNewIndependentQuestion(nextPart)

    if (currentIsQuestion && nextIsQuestion) {
      results.push(current)
      current = nextPart
    } else {
      current = `${current} ${nextPart}`
    }
  }

  if (current) {
    results.push(current)
  }

  return results
}

export class UtteranceAssembler {
  private readonly silenceBoundaryMs: number
  private readonly continuationSilenceMs: number
  private readonly maxUtteranceDurationMs: number
  private readonly maxFragments: number
  private readonly maxCharacters: number

  private readonly buffers = new Map<AudioSourceKind, PendingUtteranceBuffer>()
  private utteranceCounter = 0

  constructor(options: UtteranceAssemblerOptions = {}) {
    this.silenceBoundaryMs = options.silenceBoundaryMs ?? 900
    this.continuationSilenceMs = options.continuationSilenceMs ?? 2000
    this.maxUtteranceDurationMs = options.maxUtteranceDurationMs ?? 20000
    this.maxFragments = options.maxFragments ?? 6
    this.maxCharacters = options.maxCharacters ?? 1000
  }

  /**
   * Ingests a finalized STT segment and returns any completed semantic utterances.
   * Note: An utterance may remain buffered awaiting possible continuation fragments
   * until silenceBoundaryMs elapses or flushReady/flushSource/flushAll is called.
   */
  public ingestSegment(segment: TranscriptSegment): AssembledUtterance[] {
    if (!segment || !segment.isFinal || isNoiseOrEmptyFragment(segment.text)) {
      return []
    }

    const subTexts = splitMultiQuestionText(segment.text)
    if (subTexts.length > 1) {
      const emitted: AssembledUtterance[] = []
      const totalDuration = Math.max(100, segment.endTimestamp - segment.startTimestamp)
      const stepDuration = Math.floor(totalDuration / subTexts.length)

      subTexts.forEach((subText, idx) => {
        const subStart = segment.startTimestamp + idx * stepDuration
        const subEnd =
          idx === subTexts.length - 1 ? segment.endTimestamp : subStart + stepDuration
        const subSeg: TranscriptSegment = {
          ...segment,
          id: `${segment.id}-part-${idx + 1}`,
          startTimestamp: subStart,
          endTimestamp: subEnd,
          text: subText,
          isForcedSplit: idx === subTexts.length - 1 ? segment.isForcedSplit : false
        }
        emitted.push(...this.ingestSingleSegment(subSeg))
        if (idx < subTexts.length - 1) {
          const flushed = this.flushSource(segment.source, 'sentence_boundary')
          if (flushed) emitted.push(flushed)
        }
      })
      return emitted
    }

    return this.ingestSingleSegment(segment)
  }

  /**
   * Flushes any pending source buffer whose silence gap up to `nowMs` has reached its boundary.
   */
  public flushReady(nowMs: number): AssembledUtterance[] {
    const emitted: AssembledUtterance[] = []
    for (const [source, buf] of this.buffers.entries()) {
      const effectiveBoundary = this.getEffectiveSilenceBoundaryMs(buf)
      if (nowMs - buf.endTimestamp >= effectiveBoundary) {
        const utterance = this.finalizeBuffer(source, 'silence_boundary')
        if (utterance) emitted.push(utterance)
      }
    }
    return emitted
  }

  /**
   * Returns the minimum remaining time (ms) until any pending buffer is ready to flush,
   * or null if no buffers are pending.
   */
  public getNextFlushDelayMs(nowMs?: number): number | null {
    if (this.buffers.size === 0) return null
    let minDelay = Infinity
    for (const buf of this.buffers.values()) {
      const effectiveBoundary = this.getEffectiveSilenceBoundaryMs(buf)
      const referenceNow = nowMs ?? buf.endTimestamp
      const elapsed = Math.max(0, referenceNow - buf.endTimestamp)
      const remaining = Math.max(10, effectiveBoundary - elapsed)
      if (remaining < minDelay) {
        minDelay = remaining
      }
    }
    return Number.isFinite(minDelay) ? minDelay : null
  }

  public flushSource(
    source: AudioSourceKind,
    reason: UtteranceFlushReason = 'manual_flush'
  ): AssembledUtterance | null {
    return this.finalizeBuffer(source, reason)
  }

  public flushAll(reason: UtteranceFlushReason = 'manual_flush'): AssembledUtterance[] {
    const emitted: AssembledUtterance[] = []
    for (const source of Array.from(this.buffers.keys())) {
      const utterance = this.finalizeBuffer(source, reason)
      if (utterance) emitted.push(utterance)
    }
    return emitted
  }

  public hasPending(source?: AudioSourceKind): boolean {
    if (source) return this.buffers.has(source)
    return this.buffers.size > 0
  }

  public reset(): void {
    this.buffers.clear()
  }

  private ingestSingleSegment(segment: TranscriptSegment): AssembledUtterance[] {
    const emitted: AssembledUtterance[] = []
    const source = segment.source
    const existing = this.buffers.get(source)
    const segLang: DetectedLanguage =
      segment.language ?? detectTranscriptLanguage(segment.text)

    if (!existing) {
      this.buffers.set(source, {
        source,
        startTimestamp: segment.startTimestamp,
        endTimestamp: Math.max(segment.startTimestamp, segment.endTimestamp),
        texts: [segment.text.trim()],
        assembledText: segment.text.trim(),
        segmentIds: [segment.id],
        languages: [segLang],
        lastFragmentForcedSplit: Boolean(segment.isForcedSplit)
      })
      return emitted
    }

    const silenceGapMs = segment.startTimestamp - existing.endTimestamp
    const effectiveBoundary = this.getEffectiveSilenceBoundaryMs(existing)

    // 1. Check if silence gap exceeds boundary -> flush previous utterance first
    if (silenceGapMs > effectiveBoundary) {
      const prev = this.finalizeBuffer(source, 'silence_boundary')
      if (prev) emitted.push(prev)

      this.buffers.set(source, {
        source,
        startTimestamp: segment.startTimestamp,
        endTimestamp: Math.max(segment.startTimestamp, segment.endTimestamp),
        texts: [segment.text.trim()],
        assembledText: segment.text.trim(),
        segmentIds: [segment.id],
        languages: [segLang],
        lastFragmentForcedSplit: Boolean(segment.isForcedSplit)
      })
      return emitted
    }

    // 2. Check if existing is already a complete question and new segment starts a distinct independent question
    const mergedPreview = mergeFragmentTextsWithOverlapDedup(existing.assembledText, segment.text)
    const isExactOrOverlapDuplicate =
      normalizeUtteranceText(mergedPreview) === normalizeUtteranceText(existing.assembledText)

    if (
      !isExactOrOverlapDuplicate &&
      !existing.lastFragmentForcedSplit &&
      !endsWithIncompleteContinuation(existing.assembledText) &&
      looksLikeCompleteQuestionOrRequest(existing.assembledText) &&
      startsNewIndependentQuestion(segment.text)
    ) {
      const prev = this.finalizeBuffer(source, 'sentence_boundary')
      if (prev) emitted.push(prev)

      this.buffers.set(source, {
        source,
        startTimestamp: segment.startTimestamp,
        endTimestamp: Math.max(segment.startTimestamp, segment.endTimestamp),
        texts: [segment.text.trim()],
        assembledText: segment.text.trim(),
        segmentIds: [segment.id],
        languages: [segLang],
        lastFragmentForcedSplit: Boolean(segment.isForcedSplit)
      })
      return emitted
    }

    // 3. Merge into current pending utterance buffer
    existing.assembledText = mergedPreview
    existing.endTimestamp = Math.max(existing.endTimestamp, segment.endTimestamp)
    if (!isExactOrOverlapDuplicate) {
      existing.texts.push(segment.text.trim())
    }
    if (!existing.segmentIds.includes(segment.id)) {
      existing.segmentIds.push(segment.id)
    }
    existing.languages.push(segLang)
    existing.lastFragmentForcedSplit = Boolean(segment.isForcedSplit)

    // 4. Enforce lecture accumulation bounds (duration, fragment count, character length)
    const totalDuration = existing.endTimestamp - existing.startTimestamp
    if (totalDuration >= this.maxUtteranceDurationMs) {
      const flushed = this.finalizeBuffer(source, 'max_duration')
      if (flushed) emitted.push(flushed)
    } else if (existing.texts.length >= this.maxFragments) {
      const flushed = this.finalizeBuffer(source, 'max_fragments')
      if (flushed) emitted.push(flushed)
    } else if (existing.assembledText.length >= this.maxCharacters) {
      const flushed = this.finalizeBuffer(source, 'max_characters')
      if (flushed) emitted.push(flushed)
    }

    return emitted
  }

  private getEffectiveSilenceBoundaryMs(buf: PendingUtteranceBuffer): number {
    if (buf.lastFragmentForcedSplit || endsWithIncompleteContinuation(buf.assembledText)) {
      return this.continuationSilenceMs
    }
    return this.silenceBoundaryMs
  }

  private finalizeBuffer(
    source: AudioSourceKind,
    flushReason: UtteranceFlushReason
  ): AssembledUtterance | null {
    const buf = this.buffers.get(source)
    if (!buf) return null
    this.buffers.delete(source)

    const text = buf.assembledText.trim()
    const normalizedText = normalizeUtteranceText(text)
    if (!text || !normalizedText) {
      return null
    }

    const resolvedLang = this.resolveLanguage(text, buf.languages)
    const id = `utt-${source}-${++this.utteranceCounter}-${buf.startTimestamp}`

    return {
      id,
      source: buf.source,
      startTimestamp: buf.startTimestamp,
      endTimestamp: buf.endTimestamp,
      text,
      normalizedText,
      language: resolvedLang,
      segmentIds: [...buf.segmentIds],
      fragmentCount: buf.texts.length,
      isComplete: !endsWithIncompleteContinuation(text),
      flushReason
    }
  }

  private resolveLanguage(text: string, fragmentLanguages: DetectedLanguage[]): DetectedLanguage {
    const fromFullText = detectTranscriptLanguage(text)
    if (fromFullText !== 'unknown') {
      return fromFullText
    }
    const nonUnknown = fragmentLanguages.filter((l) => l !== 'unknown')
    if (nonUnknown.includes('mixed')) return 'mixed'
    const hasUk = nonUnknown.includes('uk')
    const hasEn = nonUnknown.includes('en')
    if (hasUk && hasEn) return 'mixed'
    if (hasUk) return 'uk'
    if (hasEn) return 'en'
    return 'unknown'
  }
}

import type {
  DetectedLanguage,
  TranscriptionLanguage
} from '@/shared/contracts/transcription'

/**
 * Conservatively determines transcript language from explicit request hints,
 * Whisper subprocess language detection headers, and script composition.
 * Never defaults automatic-language results to Ukrainian without evidence.
 */
export function detectTranscriptLanguage(
  text: string,
  requestedLanguage?: TranscriptionLanguage,
  rawSubprocessOutput?: string
): DetectedLanguage {
  const trimmed = text.trim()
  const tokens = trimmed
    .replace(/[0-9_.,/#!$%^&*;:{}=\-`~()?'"«»„“”’‘ʼ[\]\\|<>+@]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  let cyrillicWords = 0
  let latinWords = 0
  let cyrillicChars = 0
  let latinChars = 0

  for (const token of tokens) {
    const cyr = (token.match(/[\u0400-\u04FF]/g) ?? []).length
    const lat = (token.match(/[a-zA-Z]/g) ?? []).length
    cyrillicChars += cyr
    latinChars += lat
    if (cyr > 0 && lat === 0) {
      cyrillicWords++
    } else if (lat > 0 && cyr === 0) {
      latinWords++
    } else if (cyr > 0 && lat > 0) {
      cyrillicWords++
      latinWords++
    }
  }

  const totalLetters = cyrillicChars + latinChars

  // Mixed-language detection: substantial presence of both Ukrainian (Cyrillic) and English (Latin)
  if (
    cyrillicWords >= 1 &&
    latinWords >= 1 &&
    totalLetters >= 4 &&
    (latinWords >= 2 || (latinChars / totalLetters >= 0.22 && cyrillicChars / totalLetters >= 0.22))
  ) {
    return 'mixed'
  }

  // Check if Whisper explicitly reported detected language in stdout/stderr
  let whisperReported: DetectedLanguage | null = null
  if (rawSubprocessOutput) {
    const langMatch =
      rawSubprocessOutput.match(/detected language:\s*([a-zA-Z]+)/i) ??
      rawSubprocessOutput.match(/auto-detected language:\s*([a-zA-Z]+)/i) ??
      rawSubprocessOutput.match(/lang\s*=\s*([a-zA-Z]{2})\b/i)
    if (langMatch?.[1]) {
      const code = langMatch[1].toLowerCase()
      if (code === 'uk' || code === 'ukrainian') {
        whisperReported = 'uk'
      } else if (code === 'en' || code === 'english') {
        whisperReported = 'en'
      } else {
        whisperReported = 'unknown'
      }
    }
  }

  if (requestedLanguage === 'uk' || requestedLanguage === 'en') {
    if (requestedLanguage === 'uk' && latinWords >= 2 && cyrillicWords === 0) {
      return 'en'
    }
    if (requestedLanguage === 'en' && cyrillicWords >= 2 && latinWords === 0) {
      return 'uk'
    }
    return requestedLanguage
  }

  if (cyrillicWords > 0 && latinWords === 0) {
    return 'uk'
  }

  if (cyrillicWords > 0 && cyrillicChars > latinChars * 3) {
    return 'uk'
  }

  if (whisperReported) {
    return whisperReported
  }

  if (latinWords >= 2 && cyrillicWords === 0) {
    return 'en'
  }

  return 'unknown'
}

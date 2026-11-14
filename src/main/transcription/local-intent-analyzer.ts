/**
 * Local Deterministic First-Stage Conversation Intent Analyzer.
 * Evaluates assembled utterances and bounded conversation context using positive and
 * negative linguistic evidence across Ukrainian, English, and mixed-language speech.
 *
 * Responsibilities:
 * - Fast local filtering of obvious statements, noise, quotations, reported speech, and rhetorical phrases.
 * - Accurate detection of direct questions, explanation/help/clarification requests, indirect questions,
 *   and context-dependent follow-ups without relying on STT punctuation.
 * - Identification of ambiguous cases for optional semantic classification via OpenRouter.
 */

import type { AudioSourceKind } from '@/shared/contracts/audio'
import type { DetectedLanguage } from '@/shared/contracts/transcription'
import type {
  AddresseeAssessment,
  AssembledUtterance,
  ConversationIntent,
  EvidenceStrength,
  IntentDecision
} from '@/shared/contracts/questions'
import type { ConversationContextSnapshot } from './conversation-context'
import { detectTranscriptLanguage } from './whisper-cpp-provider'

export interface LocalIntentAnalysisResult {
  intent: ConversationIntent
  decision: IntentDecision
  evidenceStrength: EvidenceStrength
  /** Transparent rule-derived evidence score in [0, 1]; NOT a calibrated probability */
  heuristicScore: number
  language: DetectedLanguage
  requiresResponse: boolean
  addressee: AddresseeAssessment
  contextUsed: boolean
  evidence: string[]
  matchedPattern?: string
  uncertain: boolean
  /** True when the utterance is ambiguous and should be routed to an authorized semantic classifier if enabled */
  isAmbiguous: boolean
}

const BACKCHANNEL_OR_FILLER = new Set([
  'так',
  'ні',
  'ага',
  'угу',
  'ок',
  'окей',
  'добре',
  'гаразд',
  'зрозуміло',
  'ясно',
  'дякую',
  'спасибі',
  'привіт',
  'вітаю',
  'алло',
  'ну',
  'от',
  'тож',
  'yes',
  'no',
  'yeah',
  'yep',
  'nope',
  'ok',
  'okay',
  'sure',
  'right',
  'alright',
  'thanks',
  'thank',
  'thank you',
  'got it',
  'i see',
  'hello',
  'hi',
  'hey',
  'um',
  'uh',
  'hmm'
])

// Framing phrases introducing quoted text that is NOT a live user question
const QUOTATION_FRAMING_PATTERNS: RegExp[] = [
  /(?:у|в)\s+(?:презентації|документації|коді|консолі|помилці|лог(?:ах|у)|слайді|книзі|завданні|тексті|повідомленні)\s+(?:написано|сказано|вказано|є\s+питання|питається|пише)/i,
  /(?:на\s+слайді|на\s+екрані|тут)\s+(?:написано|сказано|вказано|бачимо\s+напис|є\s+заголовок)/i,
  /(?:помилка|лог|термінал|компілятор)\s+(?:каже|пише|виводить|повідомляє)/i,
  /(?:in\s+the|the)\s+(?:presentation|slide|documentation|docs|error|console|log|book|prompt|text|message)\s+(?:it\s+)?(?:says|reads|states|asks|is\s+written)/i,
  /(?:on\s+the\s+screen|here\s+it)\s+(?:says|reads|states)/i
]

// Reported speech framing where a speaker recounts someone else's past/indirect question
const REPORTED_SPEECH_PATTERNS: RegExp[] = [
  /(?:^|\s)(?:викладач|лектор|професор|вчитель|студент|колега|клієнт|замовник|менеджер|інтерв['’ʼ]?юер|він|вона|вони|хтось)\s+(?:учора\s+|вчора\s+|минулого\s+разу\s+|раніше\s+|щойно\s+|тоді\s+)?(?:запитав|запитала|запитали|спитав|спитала|спитали|питав|питала|питали|поцікавився|поцікавилася)(?=\s|$|[.,!?;:])/i,
  /(?:^|\s)(?:мене|нас|його|її)\s+(?:учора\s+|вчора\s+|на\s+співбесіді\s+|на\s+лекції\s+|раніше\s+)?(?:запитали|спитали|питали)(?=\s|$|[.,!?;:])/i,
  /(?:^|\s)(?:ми|вони)\s+(?:учора\s+|вчора\s+|раніше\s+|вже\s+)?(?:обговорювали|розглядали|дискутували)\s*[d,]?\s*(?:чому|як|де|коли|чи|що)(?=\s|$|[.,!?;:])/i,
  /(?:^|\s)(?:питання|запитання)\s+(?:було\s+сформульовано|звучало|формулювалося|полягало\s+в\s+тому)\s+(?:як|так|чому|чи)(?=\s|$|[.,!?;:])/i,
  /\b(?:the\s+)?(?:professor|teacher|instructor|lecturer|student|colleague|client|manager|interviewer|author|speaker|he|she|they)\s+(?:yesterday\s+|earlier\s+|previously\s+|already\s+)?(?:asked|wondered|inquired|questioned)\s+(?:me\s+|us\s+|him\s+|her\s+)?(?:why|how|what|where|when|whether|if)\b/i,
  /\b(?:i\s+was|we\s+were)\s+(?:asked|questioned)\s+(?:yesterday\s+|earlier\s+|in\s+the\s+interview\s+)?(?:why|how|what|where|when|whether|if)\b/i,
  /\b(?:we|they)\s+(?:already\s+|yesterday\s+|earlier\s+)?(?:discussed|talked\s+about|debated)\s+(?:why|how|what|where|when|whether)\b/i,
  /\b(?:discussing|explained)\s+how\s+(?:the\s+|a\s+)?question\s+was\s+formulated\b/i
]

// Lecture narration / declarative statements containing embedded wh-words
const NARRATION_OR_DECLARATIVE_WH_PATTERNS: RegExp[] = [
  /^(?:зараз\s+я|давайте\s+(?:ми\s+)?|тепер\s+ми|сьогодні\s+ми|далі\s+ми)\s+(?:покажу|розглянемо|подивимося|розберемо|побачимо|проаналізуємо|поясню)\s*[.,]?\s*(?:чому|як|де|коли|що|яким\s+чином)(?=\s|$|[.,!?;:])/i,
  /^(?:я|ми)\s+(?:вже\s+|точно\s+|добре\s+|прекрасно\s+)?(?:знаю|знаємо|розумію|розуміємо|пам['’ʼ]?ятаю|пам['’ʼ]?ятаємо|бачимо|пояснював|пояснювали|показав)\s*[.,]?\s*(?:що|чому|як|де|коли|який|яка|яке|які)(?=\s|$|[.,!?;:])/i,
  /^(?:тут|у\s+цьому\s+файлі|в\s+цьому\s+модулі|у\s+цій\s+функції|на\s+цьому\s+слайді)\s+(?:описано|показано|видно|пояснюється|реалізовано)\s*[.,]?\s*(?:як|чому|де|коли|що)(?=\s|$|[.,!?;:])/i,
  /^(?:відповідь\s+на\s+(?:це\s+)?питання|причина\s+того)\s*[.,]?\s*(?:чому|як|у\s+чому)/i,
  /^(?:let\s+me|let['’]s|now\s+i\s+will|today\s+we\s+will|next\s+we)\s+(?:show\s+you|look\s+at|examine|see|explore|demonstrate|explain)\s+(?:why|how|what|where|when)\b/i,
  /^(?:i|we|the\s+engineer|the\s+developer|the\s+team)\s+(?:already\s+|clearly\s+|definitely\s+)?(?:know|knows|knew|understand|understands|remember|see|explained|showed)\s+(?:what|why|how|where|when|which)\b/i,
  /^(?:this\s+(?:section|slide|module|function|file|code|diagram))\s+(?:shows|explains|demonstrates|describes|illustrates)\s+(?:how|why|what|where|when)\b/i
]

// Rhetorical questions and non-request exclamations
const RHETORICAL_PATTERNS: RegExp[] = [
  /^(?:ну\s+)?(?:хіба\s+це\s+не|хіба\s+не)\s+(?:очевидно|чудово|дивно|смішно|прекрасно|зрозуміло)(?=\s|$|[.,!?;:])/i,
  /^(?:ну\s+|і\s+)?(?:хто\s+ж\s+так\s+пише|кому\s+це\s+(?:взагалі\s+)?потрібно|що\s+за\s+(?:дурниця|нісенітниця|маячня))(?=\s|$|[.,!?;:])/i,
  /^(?:isn['’]t\s+(?:that|it)\s+(?:obvious|great|ironic|funny|amazing|ridiculous))\b/i,
  /^(?:who\s+(?:even\s+)?cares(?:\s+about\s+that)?|who\s+writes\s+code\s+like\s+that|what\s+kind\s+of\s+nonsense\s+is\s+(?:this|that))\b/i
]

// Explicit explanation requests (strong READY)
const EXPLANATION_REQUEST_STRONG: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /(?:^|[,;:.!?]\s*)(?:а\s+|і\s+|та\s+|ну\s+|будь\s+ласка\s+|привіт\s+|слухай\s+|слухайте\s+)?(?:можеш\s+пояснити|можете\s+пояснити|чи\s+можеш\s+пояснити|чи\s+можете\s+пояснити|хтось\s+може\s+пояснити|чи\s+може\s+хтось\s+пояснити|поясни|поясніть|розкажи\s+(?:детальніше|про|як|чому)|розкажіть\s+(?:детальніше|про|як|чому)|прокоментуй|прокоментуйте)(?=\s|$|[.,!?;:])/i,
    label: 'uk_explanation_request'
  },
  {
    pattern:
      /(?:^|[,;:.!?]\s*)(?:and\s+|so\s+|please\s+|hey\s+|hi\s+)?(?:can\s+you\s+explain|could\s+you\s+explain|would\s+you\s+explain|can\s+someone\s+explain|could\s+anyone\s+explain|please\s+explain|explain\s+(?:this|how|why|what|the)|walk\s+me\s+through|help\s+me\s+understand)\b/i,
    label: 'en_explanation_request'
  }
]

// Indirect / polite explanation requests (moderate-to-strong, context-sensitive)
const EXPLANATION_REQUEST_INDIRECT: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /(?:було\s+б\s+(?:добре|чудово|корисно|непогано)\s+(?:зрозуміти|розібратися|дізнатися)|хотілося\s+б\s+(?:зрозуміти|розібратися|почути\s+пояснення)|хочу\s+(?:зрозуміти|розібратися)\s*[.,]?\s*(?:чому|як|де|у\s+чому|в\s+чому)|цікаво\s+зрозуміти\s*[.,]?\s*(?:чому|як))/i,
    label: 'uk_indirect_explanation'
  },
  {
    pattern:
      /\b(?:it\s+would\s+be\s+(?:good|great|helpful|useful)\s+to\s+(?:understand|know|see\s+why|figure\s+out)|i\s+would\s+(?:like|love)\s+to\s+understand|i['’]d\s+like\s+to\s+understand\s+(?:why|how|what)|trying\s+to\s+understand\s+(?:why|how))\b/i,
    label: 'en_indirect_explanation'
  }
]

// Clarification requests
const CLARIFICATION_REQUEST_PATTERNS: Array<{
  pattern: RegExp
  label: string
  strong: boolean
}> = [
  {
    pattern:
      /(?:^|[,;:.!?]\s*)(?:а\s+|будь\s+ласка\s+)?(?:уточни|уточніть|можеш\s+уточнити|можете\s+уточнити|можна\s+уточнити|поясни\s+точніше|що\s+(?:ти\s+|ви\s+)?маєш\s+на\s+увазі|що\s+ви\s+маєте\s+на\s+увазі|що\s+мається\s+на\s+увазі|чи\s+правильно\s+я\s+(?:розумію|зрозумів|зрозуміла)|правильно\s+я\s+(?:розумію|зрозумів|зрозуміла))(?=\s|$|[.,!?;:])/i,
    label: 'uk_clarification_direct',
    strong: true
  },
  {
    pattern:
      /(?:тобто\s+це\s+означає\s*,?\s*що|не\s+зовсім\s+(?:зрозумів|зрозуміла|зрозуміло)\s+(?:цю\s+частину|цей\s+момент|як|чому)|не\s+до\s+кінця\s+зрозуміло\s*,?\s*(?:чому|як|де|що)|можна\s+ще\s+раз\s+про)/i,
    label: 'uk_clarification_implicit',
    strong: false
  },
  {
    pattern:
      /\b(?:can\s+you\s+clarify|could\s+you\s+clarify|could\s+someone\s+clarify|please\s+clarify|i\s+was\s+hoping\s+(?:someone|you)\s+could\s+clarify|what\s+do\s+you\s+mean\s+by|what\s+is\s+meant\s+by|am\s+i\s+understanding\s+correctly|do\s+i\s+understand\s+correctly)\b/i,
    label: 'en_clarification_direct',
    strong: true
  },
  {
    pattern:
      /\b(?:so\s+does\s+(?:that|this)\s+mean|does\s+that\s+mean\s+that|i['’]m\s+not\s+(?:entirely\s+|quite\s+)?(?:clear|sure)\s+on\s+(?:this\s+part|how|why|what)|could\s+we\s+go\s+over\s+that\s+part\s+again)\b/i,
    label: 'en_clarification_implicit',
    strong: false
  }
]

// Explicit help requests (strong READY)
const HELP_REQUEST_STRONG: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /(?:^|[,;:.!?]\s*)(?:а\s+|і\s+|будь\s+ласка\s+)?(?:допоможи|допоможіть|можеш\s+допомогти|можете\s+допомогти|підкажи|підкажіть|можеш\s+підказати|можете\s+підказати|чи\s+можеш\s+підказати|чи\s+можете\s+підказати|не\s+підкажете|не\s+підкажеш|скажи\s+будь\s+ласка|скажіть\s+будь\s+ласка|як\s+(?:мені\s+|нам\s+)?(?:виправити|пофіксити|вирішити|обійти)\s+(?:цю|цей|це)|що\s+(?:мені\s+|нам\s+)?робити\s+з\s+(?:цією|цим))(?=\s|$|[.,!?;:])/i,
    label: 'uk_help_request_direct'
  },
  {
    pattern:
      /(?:^|[,;:.!?]\s*)(?:and\s+|so\s+|please\s+)?(?:can\s+you\s+help|could\s+you\s+help|would\s+you\s+help|can\s+someone\s+help|please\s+help|help\s+me\s+(?:fix|solve|debug|with)|how\s+(?:do\s+i|can\s+i|can\s+we|should\s+i)\s+(?:fix|resolve|solve|work\s+around)|what\s+should\s+i\s+do\s+to\s+fix)\b/i,
    label: 'en_help_request_direct'
  }
]

// Implicit help / troubleshooting frustration (SUGGEST by default unless strong context)
const HELP_REQUEST_IMPLICIT: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /(?:(?:вже\s+годину|довго)\s+дивлюся\s+на\s+цей\s+код\s+і\s+не\s+розумію|не\s+розумію\s*,?\s*(?:де\s+(?:тут\s+)?(?:помилка|баг|проблема)|чому\s+(?:воно|це|код|тест|збірка)\s+(?:не\s+працює|падає|фейлиться))|не\s+можу\s+(?:зрозуміти|розібратися|знайти)\s*,?\s*(?:де\s+помилка|чому\s+не\s+працює|чому\s+падає|як\s+це\s+виправити)|у\s+мене\s+не\s+виходить\s+(?:запустити|зібрати|налаштувати)|застряг\s+на\s+цій\s+помилці)/i,
    label: 'uk_help_implicit'
  },
  {
    pattern:
      /\b(?:i(?:\s+have|'ve)\s+been\s+(?:looking\s+at|staring\s+at)\s+this\s+code.*?(?:don['’]t|do\s+not)\s+understand|i\s+(?:don['’]t|do\s+not)\s+understand\s+(?:where\s+the\s+(?:bug|error|mistake|issue)\s+is|why\s+(?:this|it)\s+(?:is\s+failing|fails|doesn['’]t\s+work))|i\s+can['’]t\s+figure\s+out\s+(?:why|where|how\s+to\s+fix)|i['’]m\s+stuck\s+on\s+this\s+(?:error|bug|issue))\b/i,
    label: 'en_help_implicit'
  }
]

// Indirect questions & uncertain statements
const INDIRECT_QUESTION_PATTERNS: Array<{
  pattern: RegExp
  label: string
  actionableWithoutContext: boolean
}> = [
  {
    pattern:
      /(?:^|[,;:.!?]\s*)(?:мені\s+)?(?:цікаво|хотілося\s+б\s+дізнатися|хочу\s+дізнатися|було\s+б\s+цікаво\s+дізнатися|хто\s+знає|чи\s+хтось\s+знає)\s*,?\s*(?:чому|як|де|коли|чи|скільки|який|яка|яке|які|що\s+буде)(?=\s|$|[.,!?;:])/i,
    label: 'uk_indirect_inquiry',
    actionableWithoutContext: true
  },
  {
    pattern:
      /(?:^|[,;:.!?]\s*)(?:я\s+)?(?:не\s+впевнений|не\s+впевнена|сумніваюся|не\s+знаю)\s*,?\s*(?:чи\s+(?:цей|такий|це|воно|правильно)|як\s+саме\s+це\s+має\s+працювати|чому\s+тут\s+так)(?=\s|$|[.,!?;:])/i,
    label: 'uk_uncertain_indirect',
    actionableWithoutContext: false
  },
  {
    pattern:
      /\b(?:i\s+wonder|i\s+was\s+wondering|i['’]d\s+like\s+to\s+know|i\s+would\s+like\s+to\s+know|do\s+you\s+happen\s+to\s+know|does\s+anyone\s+know|any\s+idea)\s+(?:why|how|where|when|whether|if|what|which)\b/i,
    label: 'en_indirect_inquiry',
    actionableWithoutContext: true
  },
  {
    pattern:
      /\b(?:i['’]m\s+not\s+sure|i\s+am\s+not\s+sure|not\s+sure|i\s+doubt)\s+(?:if\s+|whether\s+|that\s+)?(?:this\s+(?:approach|solution|method|code|way)\s+is\s+(?:correct|right|safe|optimal)|this\s+will\s+work|how\s+this\s+works)\b/i,
    label: 'en_uncertain_indirect',
    actionableWithoutContext: false
  }
]

// Short context-dependent follow-ups
const CONTEXTUAL_FOLLOW_UP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /^(?:ну\s+)?(?:а\s+|і\s+|та\s+)?(?:цей\s+варіант|другий\s+варіант|перший\s+варіант|інший\s+варіант|інший\s+підхід|другий\s+підхід|попередній\s+варіант|попередній\s+підхід|наступний\s+варіант)(?=\s|$|[.,!?;:])/i,
    label: 'uk_followup_option'
  },
  {
    pattern:
      /^(?:ну\s+)?(?:а\s+|і\s+|та\s+)?(?:якщо\s+навпаки|якщо\s+так|якщо\s+без\s+цього|якщо\s+використати|якщо\s+замінити|якщо\s+передати|якщо\s+прибрати|якщо\s+додати|якщо\s+зробити\s+інакше|якщо\s+через)(?=\s|$|[.,!?;:])/i,
    label: 'uk_followup_conditional'
  },
  {
    pattern:
      /^(?:ну\s+)?(?:а\s+|і\s+|та\s+)?(?:що\s+тоді|тоді\s+що|як\s+тоді|чому\s+тоді|в\s+моєму\s+випадку|у\s+моєму\s+випадку|в\s+нашому\s+випадку|для\s+масиву|для\s+об['’ʼ]?єкта|для\s+асинхронної\s+функції|тут\s+чому|чому\s+ні|як\s+щодо)(?=\s|$|[.,!?;:])/i,
    label: 'uk_followup_ellipsis'
  },
  {
    pattern:
      /^(?:well\s+|so\s+)?(?:and\s+|but\s+)?(?:what\s+about|how\s+about)\s+(?:the\s+|this\s+|that\s+|a\s+|an\s+|using\s+|with\s+|in\s+)?\S+/i,
    label: 'en_followup_what_about'
  },
  {
    pattern:
      /^(?:well\s+|so\s+)?(?:and\s+|but\s+)?(?:the\s+previous\s+one|the\s+second\s+one|the\s+first\s+one|the\s+other\s+approach|the\s+second\s+approach|in\s+my\s+case|in\s+our\s+case|if\s+we\s+do\s+the\s+opposite|what\s+if\s+we\s+use|what\s+if\s+it['’]?s|would\s+that\s+work\s+here|will\s+that\s+work\s+here|does\s+that\s+apply\s+here|and\s+then\s+what|why\s+not\s+the)\b/i,
    label: 'en_followup_ellipsis'
  }
]

// Direct Ukrainian interrogative clause patterns
const UK_DIRECT_QUESTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /^(?:а\s+|і\s+|та\s+|ну\s+|от\s+|тож\s+|скажи\s+|скажіть\s+)?(?:чому|навіщо|скільки|куди|звідки)(?=\s|$|[.,!?;:])/i,
    label: 'uk_interrogative_strong'
  },
  {
    pattern:
      /^(?:а\s+|і\s+|та\s+|ну\s+|от\s+|тож\s+)?(?:що\s+(?:таке|це|означає|робить|робити|буде|відбувається|саме|тут|за|мені|нам|повертає|спричиняє|означають|містить))(?=\s|$|[.,!?;:])/i,
    label: 'uk_what_question'
  },
  {
    pattern:
      /^(?:а\s+|і\s+|та\s+|ну\s+|от\s+|тож\s+)?(?:як\s+(?:саме|мені|нам|це|тут|воно|працює|виправити|зробити|налаштувати|уникнути|використовувати|запустити|перевірити|передати|отримати|реалізувати|написати|краще|правильно))(?=\s|$|[.,!?;:])/i,
    label: 'uk_how_question'
  },
  {
    pattern:
      /^(?:а\s+|і\s+|та\s+|ну\s+|от\s+|тож\s+)?(?:де\s+(?:саме|знаходиться|лежить|знайти|шукати|помилка|налаштування|тут|вказано|зберігається|викликається|оголошено))(?=\s|$|[.,!?;:])/i,
    label: 'uk_where_question'
  },
  {
    pattern:
      /^(?:а\s+|і\s+|та\s+|ну\s+|от\s+|тож\s+)?(?:коли\s+(?:саме|потрібно|варто|краще|використовувати|викликається|спрацьовує|відбувається|починається))(?=\s|$|[.,!?;:])/i,
    label: 'uk_when_question'
  },
  {
    pattern:
      /^(?:а\s+|і\s+|та\s+|ну\s+|от\s+|тож\s+)?(?:хто\s+(?:відповідає|викликає|створює|керує|знає|може)|який\s+\S+|яка\s+\S+|яке\s+\S+|які\s+\S+|якого\s+\S+|яким\s+чином|у\s+чому\s+різниця|в\s+чому\s+(?:різниця|причина|проблема|суть)|від\s+чого\s+залежить)(?=\s|$|[.,!?;:])/i,
    label: 'uk_which_who_question'
  },
  {
    pattern:
      /^(?:а\s+|і\s+|та\s+|ну\s+|от\s+|тож\s+)?(?:чи\s+(?:можна|можеш|можете|може|потрібно|треба|варто|працює|є|має|буде|підтримує|впливає|безпечно|обов['’ʼ]?язково|дозволено|вистачить))(?=\s|$|[.,!?;:])/i,
    label: 'uk_yesno_чи_question'
  }
]

// Direct English interrogative clause patterns
const EN_DIRECT_QUESTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /^(?:and\s+|so\s+|well\s+|now\s+|then\s+|but\s+)?(?:what|why|where|whose|whom|which)\s+\S+/i,
    label: 'en_wh_question'
  },
  {
    pattern:
      /^(?:and\s+|so\s+|well\s+|now\s+|then\s+|but\s+)?(?:how)\s+(?:do|does|did|can|could|should|would|will|is|are|was|were|to|many|much|long|often|far|come)\b/i,
    label: 'en_how_question'
  },
  {
    pattern:
      /^(?:and\s+|so\s+|well\s+|now\s+|then\s+|but\s+)?(?:when|who)\s+(?:is|are|was|were|do|does|did|can|could|should|would|will|has|have|handles|calls|creates)\b/i,
    label: 'en_when_who_question'
  },
  {
    pattern:
      /^(?:and\s+|so\s+|well\s+|now\s+|then\s+|but\s+)?(?:is|are|was|were|does|do|did|will|would|should|can|could|has|have)\s+(?:this|that|it|there|you|we|they|i|these|those|the|a|an|any|someone|anyone)\b/i,
    label: 'en_auxiliary_question'
  }
]

// Temporal/conditional declarative openers ("Коли я натискаю кнопку, дані зберігаються." / "When I run the app, it starts.")
const DECLARATIVE_CONDITIONAL_PATTERNS: RegExp[] = [
  /^(?:коли|якщо)\s+(?:я|ми|він|вона|вони|користувач|сервер|програма|система)\s+[^?]+,\s*(?:то\s+)?(?:воно|він|вона|вони|це|система|програма|вікно|дані|файл|сервер)\s+[^?]+$/i,
  /^(?:when|if|whenever)\s+(?:i|we|you|they|the\s+user|the\s+app|the\s+server)\s+[^?]+,\s*(?:it|they|the\s+\w+|this)\s+[^?]+$/i
]

function stripOuterWrappingQuotes(text: string): {
  stripped: string
  wasFullyWrapped: boolean
} {
  const trimmed = text.trim()
  const pairs: Array<[string, string]> = [
    ['«', '»'],
    ['"', '"'],
    ['“', '”'],
    ['„', '“'],
    ['„', '”'],
    ["'", "'"]
  ]

  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length > 2) {
      const inner = trimmed.slice(open.length, trimmed.length - close.length).trim()
      // Only treat as full-utterance wrapping if there is no closing quote in the middle
      if (!inner.includes(close)) {
        return { stripped: inner, wasFullyWrapped: true }
      }
    }
  }
  return { stripped: trimmed, wasFullyWrapped: false }
}

function hasEmbeddedQuotationWithFraming(text: string): boolean {
  const { wasFullyWrapped } = stripOuterWrappingQuotes(text)
  if (wasFullyWrapped) return false

  const hasQuotes = /["«»“”„]/.test(text)
  if (hasQuotes) {
    for (const pattern of QUOTATION_FRAMING_PATTERNS) {
      if (pattern.test(text)) {
        return true
      }
    }
    // Check if there is a colon followed by a quoted sentence ("У презентації: «Чому це відбувається?»")
    if (/:\s*["«“„][^"»”]+["»”]/.test(text)) {
      const beforeColon = text.split(':')[0] ?? ''
      const asksAboutQuote =
        /(?:поясни|поясніть|підкажи|підкажіть|чому|що\s+означає|explain|why|what\s+does)/i.test(
          beforeColon
        )
      if (!asksAboutQuote) {
        return true
      }
    }
  } else {
    for (const pattern of QUOTATION_FRAMING_PATTERNS) {
      if (pattern.test(text)) {
        return true
      }
    }
  }

  return false
}

function splitIntoClausesOrSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\s*[;—–]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : [text.trim()]
}

function determineAddressee(text: string, source: AudioSourceKind): AddresseeAssessment {
  if (/(?:хтось\s+може|чи\s+може\s+хтось|хто\s+знає|can\s+someone|could\s+anyone|does\s+anyone)/i.test(text)) {
    return 'group_or_classroom'
  }
  if (source === 'system') {
    return 'unknown'
  }
  if (/(?:підкажи|поясни|допоможи|можеш|can\s+you|could\s+you|help\s+me|tell\s+me)/i.test(text)) {
    return 'assistant_or_user'
  }
  return 'unknown'
}

export class LocalIntentAnalyzer {
  /**
   * Evaluates an assembled utterance and optional recent conversation context.
   */
  public analyze(
    utterance: Pick<AssembledUtterance, 'text' | 'source' | 'language'>,
    context?: ConversationContextSnapshot
  ): LocalIntentAnalysisResult {
    const rawTrimmed = utterance.text.trim()
    const { stripped: text } = stripOuterWrappingQuotes(rawTrimmed)
    const language: DetectedLanguage =
      utterance.language && utterance.language !== 'unknown'
        ? utterance.language
        : detectTranscriptLanguage(text)

    if (text.length < 3) {
      return this.buildResult({
        intent: 'other',
        decision: 'ignore',
        evidenceStrength: 'none',
        heuristicScore: 0,
        language,
        requiresResponse: false,
        addressee: 'unknown',
        contextUsed: false,
        evidence: ['too_short'],
        uncertain: false,
        isAmbiguous: false
      })
    }

    const normalized = text
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"«»„“”’‘ʼ[\]\\|<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const words = normalized.split(' ').filter(Boolean)
    if (words.length === 0 || (words.length <= 2 && BACKCHANNEL_OR_FILLER.has(normalized))) {
      return this.buildResult({
        intent: 'other',
        decision: 'ignore',
        evidenceStrength: 'none',
        heuristicScore: 0,
        language,
        requiresResponse: false,
        addressee: 'unknown',
        contextUsed: false,
        evidence: ['backchannel_or_filler'],
        uncertain: false,
        isAmbiguous: false
      })
    }

    const addressee = determineAddressee(text, utterance.source)
    const hasQuestionMark = text.includes('?')

    // 1. Check embedded quotation framing ("У презентації написано: «Чому це відбувається?»")
    if (hasEmbeddedQuotationWithFraming(rawTrimmed)) {
      return this.buildResult({
        intent: 'reported_question',
        decision: 'ignore',
        evidenceStrength: 'strong',
        heuristicScore: 0.1,
        language,
        requiresResponse: false,
        addressee: 'third_party',
        contextUsed: false,
        evidence: ['quoted_question_in_framing'],
        matchedPattern: 'quoted_speech',
        uncertain: false,
        isAmbiguous: false
      })
    }

    // 2. Check reported speech ("Викладач учора запитав, чому алгоритм повільний")
    for (const pattern of REPORTED_SPEECH_PATTERNS) {
      if (pattern.test(text)) {
        // Check if speaker appended an active request ("...і я не знаю як відповісти, поясни")
        const hasActiveRequestTail =
          /(?:підкажи|підкажіть|поясни|поясніть|допоможи|допоможіть|can\s+you\s+explain|please\s+explain|help\s+me)/i.test(
            text
          )
        if (!hasActiveRequestTail) {
          return this.buildResult({
            intent: 'reported_question',
            decision: 'ignore',
            evidenceStrength: 'strong',
            heuristicScore: 0.12,
            language,
            requiresResponse: false,
            addressee: 'third_party',
            contextUsed: false,
            evidence: ['reported_speech_narrative'],
            matchedPattern: 'reported_question',
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 3. Check rhetorical questions
    for (const pattern of RHETORICAL_PATTERNS) {
      if (pattern.test(text)) {
        return this.buildResult({
          intent: 'rhetorical_question',
          decision: 'ignore',
          evidenceStrength: 'strong',
          heuristicScore: 0.15,
          language,
          requiresResponse: false,
          addressee: 'self_talk',
          contextUsed: false,
          evidence: ['rhetorical_expression'],
          matchedPattern: 'rhetorical',
          uncertain: false,
          isAmbiguous: false
        })
      }
    }

    // 4. Split multi-sentence utterances so a setup statement + question evaluates cleanly
    const sentences = splitIntoClausesOrSentences(text)
    const candidateClauses =
      sentences.length > 1 ? [text, sentences[sentences.length - 1], ...sentences] : [text]

    // 5. Check lecture narration / declarative wh-statements (only if no separate question sentence follows)
    const lastSentence = sentences[sentences.length - 1] ?? text
    for (const pattern of NARRATION_OR_DECLARATIVE_WH_PATTERNS) {
      if (pattern.test(lastSentence) && !lastSentence.endsWith('?')) {
        return this.buildResult({
          intent: 'statement',
          decision: 'ignore',
          evidenceStrength: 'strong',
          heuristicScore: 0.08,
          language,
          requiresResponse: false,
          addressee: 'unknown',
          contextUsed: false,
          evidence: ['declarative_narration_clause'],
          matchedPattern: 'declarative_narration',
          uncertain: false,
          isAmbiguous: false
        })
      }
    }

    // Check conditional declarative ("Коли я запускаю програму, вікно відкривається")
    if (!hasQuestionMark) {
      for (const pattern of DECLARATIVE_CONDITIONAL_PATTERNS) {
        if (pattern.test(text)) {
          return this.buildResult({
            intent: 'statement',
            decision: 'ignore',
            evidenceStrength: 'strong',
            heuristicScore: 0.1,
            language,
            requiresResponse: false,
            addressee: 'unknown',
            contextUsed: false,
            evidence: ['conditional_declarative'],
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    const hasActiveContext = Boolean(
      context &&
        (context.hasRecentQuestionOrRequest ||
          (context.hasRecentTechnicalDiscussion &&
            context.timeSinceLastTurnMs !== null &&
            context.timeSinceLastTurnMs <= 90000))
    )

    // 6. Check Contextual Follow-Up patterns («А цей варіант?», «А якщо навпаки?», "What about the second approach?")
    for (const clause of candidateClauses) {
      for (const item of CONTEXTUAL_FOLLOW_UP_PATTERNS) {
        if (item.pattern.test(clause)) {
          if (hasActiveContext) {
            return this.buildResult({
              intent: 'contextual_follow_up',
              decision: 'ready',
              evidenceStrength: 'strong',
              heuristicScore: 0.88,
              language,
              requiresResponse: true,
              addressee,
              contextUsed: true,
              evidence: [item.label, 'resolved_with_recent_context'],
              matchedPattern: item.label,
              uncertain: false,
              isAmbiguous: false
            })
          }
          // Without recent conversation context, short elliptical follow-up is uncertain -> SUGGEST & ambiguous
          return this.buildResult({
            intent: 'contextual_follow_up',
            decision: 'suggest',
            evidenceStrength: 'moderate',
            heuristicScore: 0.65,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label, 'missing_prior_context'],
            matchedPattern: item.label,
            uncertain: true,
            isAmbiguous: true
          })
        }
      }
    }

    // 7. Check Strong Explanation Requests
    for (const clause of candidateClauses) {
      for (const item of EXPLANATION_REQUEST_STRONG) {
        if (item.pattern.test(clause)) {
          return this.buildResult({
            intent: 'explanation_request',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: 0.92,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label],
            matchedPattern: this.extractLegacyPatternName(clause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 8. Check Strong Help Requests
    for (const clause of candidateClauses) {
      for (const item of HELP_REQUEST_STRONG) {
        if (item.pattern.test(clause)) {
          return this.buildResult({
            intent: 'help_request',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: 0.92,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label],
            matchedPattern: this.extractLegacyPatternName(clause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 9. Check Clarification Requests
    for (const clause of candidateClauses) {
      for (const item of CLARIFICATION_REQUEST_PATTERNS) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision = item.strong || hasActiveContext ? 'ready' : 'suggest'
          return this.buildResult({
            intent: 'clarification_request',
            decision,
            evidenceStrength: decision === 'ready' ? 'strong' : 'moderate',
            heuristicScore: decision === 'ready' ? 0.88 : 0.7,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: !item.strong && hasActiveContext,
            evidence: [item.label],
            matchedPattern: item.label,
            uncertain: decision === 'suggest',
            isAmbiguous: decision === 'suggest'
          })
        }
      }
    }

    // 10. Check Indirect Explanation Requests («Було б добре зрозуміти, чому тут виникає помилка»)
    for (const clause of candidateClauses) {
      for (const item of EXPLANATION_REQUEST_INDIRECT) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision = hasActiveContext ? 'ready' : 'suggest'
          return this.buildResult({
            intent: 'explanation_request',
            decision,
            evidenceStrength: decision === 'ready' ? 'strong' : 'moderate',
            heuristicScore: decision === 'ready' ? 0.86 : 0.74,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: hasActiveContext,
            evidence: [item.label, ...(hasActiveContext ? ['boosted_by_context'] : [])],
            matchedPattern: item.label,
            uncertain: !hasActiveContext,
            isAmbiguous: true
          })
        }
      }
    }

    // 11. Check Implicit Help / Troubleshooting Frustration («Я вже годину дивлюся на цей код і не розумію, де помилка»)
    for (const clause of candidateClauses) {
      for (const item of HELP_REQUEST_IMPLICIT) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision =
            context?.hasRecentQuestionOrRequest && context.timeSinceLastTurnMs !== null && context.timeSinceLastTurnMs <= 45000
              ? 'ready'
              : 'suggest'
          return this.buildResult({
            intent: 'help_request',
            decision,
            evidenceStrength: 'moderate',
            heuristicScore: decision === 'ready' ? 0.82 : 0.68,
            language,
            requiresResponse: true,
            addressee: 'self_talk',
            contextUsed: decision === 'ready',
            evidence: [item.label],
            matchedPattern: item.label,
            uncertain: true,
            isAmbiguous: true
          })
        }
      }
    }

    // 12. Check Indirect Questions («Цікаво, чому...», "I'm not sure this approach is correct")
    for (const clause of candidateClauses) {
      for (const item of INDIRECT_QUESTION_PATTERNS) {
        if (item.pattern.test(clause)) {
          const decision: IntentDecision = item.actionableWithoutContext ? 'ready' : 'suggest'
          return this.buildResult({
            intent: 'indirect_question',
            decision,
            evidenceStrength: decision === 'ready' ? 'strong' : 'moderate',
            heuristicScore: decision === 'ready' ? 0.84 : 0.64,
            language,
            requiresResponse: true,
            addressee,
            contextUsed: hasActiveContext && !item.actionableWithoutContext,
            evidence: [item.label],
            matchedPattern: item.label,
            uncertain: !item.actionableWithoutContext,
            isAmbiguous: !item.actionableWithoutContext
          })
        }
      }
    }

    // 13. Check Direct Questions (Ukrainian & English & Mixed)
    for (const clause of candidateClauses) {
      const cleanClause = stripOuterWrappingQuotes(clause).stripped
      for (const item of UK_DIRECT_QUESTION_PATTERNS) {
        if (item.pattern.test(cleanClause)) {
          return this.buildResult({
            intent: 'direct_question',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: hasQuestionMark ? 0.94 : 0.88,
            language: language === 'unknown' ? 'uk' : language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label, ...(hasQuestionMark ? ['question_mark'] : ['interrogative_syntax'])],
            matchedPattern: this.extractLegacyPatternName(cleanClause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }

      for (const item of EN_DIRECT_QUESTION_PATTERNS) {
        if (item.pattern.test(cleanClause)) {
          return this.buildResult({
            intent: 'direct_question',
            decision: 'ready',
            evidenceStrength: 'strong',
            heuristicScore: hasQuestionMark ? 0.94 : 0.88,
            language: language === 'unknown' ? 'en' : language,
            requiresResponse: true,
            addressee,
            contextUsed: false,
            evidence: [item.label, ...(hasQuestionMark ? ['question_mark'] : ['interrogative_syntax'])],
            matchedPattern: this.extractLegacyPatternName(cleanClause, item.label),
            uncertain: false,
            isAmbiguous: false
          })
        }
      }
    }

    // 14. Check clause-initial single interrogative word fallback (e.g. "Як обчислити...", "Що повертає...")
    for (const clause of candidateClauses) {
      const clauseWords = clause
        .toLowerCase()
        .replace(/["'«»“”„’`?.,/#!$%^&*;:{}=\-_~()]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
      const w0 = clauseWords[0] ?? ''
      const w1 = clauseWords[1] ?? ''

      const ukInterrogatives = new Set([
        'що',
        'чому',
        'як',
        'де',
        'коли',
        'хто',
        'який',
        'яка',
        'яке',
        'які',
        'чи',
        'навіщо',
        'скільки',
        'куди',
        'звідки'
      ])
      const ukPrefixes = new Set(['а', 'і', 'та', 'ну', 'от', 'тож'])

      if (ukInterrogatives.has(w0) && clauseWords.length >= 2) {
        return this.buildResult({
          intent: 'direct_question',
          decision: 'ready',
          evidenceStrength: 'strong',
          heuristicScore: hasQuestionMark ? 0.92 : 0.85,
          language: language === 'unknown' ? 'uk' : language,
          requiresResponse: true,
          addressee,
          contextUsed: false,
          evidence: ['uk_clause_initial_interrogative'],
          matchedPattern: w0,
          uncertain: false,
          isAmbiguous: false
        })
      }

      if (ukPrefixes.has(w0) && ukInterrogatives.has(w1) && clauseWords.length >= 3) {
        return this.buildResult({
          intent: 'direct_question',
          decision: 'ready',
          evidenceStrength: 'strong',
          heuristicScore: hasQuestionMark ? 0.92 : 0.85,
          language: language === 'unknown' ? 'uk' : language,
          requiresResponse: true,
          addressee,
          contextUsed: false,
          evidence: ['uk_prefixed_interrogative'],
          matchedPattern: `${w0} ${w1}`,
          uncertain: false,
          isAmbiguous: false
        })
      }
    }

    // 15. Conservative Question Mark Fallback (declarative confirmation question with '?')
    if (hasQuestionMark && words.length >= 2) {
      const decision: IntentDecision = words.length >= 3 || hasActiveContext ? 'ready' : 'suggest'
      return this.buildResult({
        intent: 'clarification_request',
        decision,
        evidenceStrength: 'moderate',
        heuristicScore: 0.78,
        language,
        requiresResponse: true,
        addressee,
        contextUsed: hasActiveContext,
        evidence: ['intonation_question_mark'],
        matchedPattern: '?',
        uncertain: true,
        isAmbiguous: true
      })
    }

    // 16. Ordinary Statement -> IGNORE
    return this.buildResult({
      intent: 'statement',
      decision: 'ignore',
      evidenceStrength: 'strong',
      heuristicScore: 0,
      language,
      requiresResponse: false,
      addressee: 'unknown',
      contextUsed: false,
      evidence: ['ordinary_statement'],
      uncertain: false,
      isAmbiguous: false
    })
  }

  private buildResult(res: LocalIntentAnalysisResult): LocalIntentAnalysisResult {
    return res
  }

  /**
   * Preserves human-readable matchedPattern token for diagnostics and backward compatibility.
   */
  private extractLegacyPatternName(clause: string, fallbackLabel: string): string {
    const clean = clause
      .toLowerCase()
      .replace(/["'«»“”„’`?.,/#!$%^&*;:{}=\-_~()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const knownPhrases = [
      'можеш пояснити',
      'можете пояснити',
      'чи можеш',
      'чи можете',
      'підкажи',
      'підкажіть',
      'поясни',
      'поясніть',
      'розкажи',
      'розкажіть',
      'допоможи',
      'допоможіть',
      'скажи',
      'скажіть',
      'can you',
      'could you',
      'would you',
      'can someone',
      'could anyone',
      'can we',
      'can i',
      'could we',
      'is there',
      'are there',
      'is this',
      'is that',
      'is it',
      'are you',
      'are we',
      'are they',
      'do you',
      'does this',
      'does it',
      'did you',
      'did it',
      'will this',
      'will it',
      'should we',
      'should i',
      'explain this',
      'please explain',
      'tell me'
    ]

    for (const phrase of knownPhrases) {
      if (
        clean.startsWith(phrase) ||
        clean.includes(` ${phrase} `) ||
        clean.endsWith(` ${phrase}`)
      ) {
        return phrase
      }
    }

    const words = clean.split(' ').filter(Boolean)
    const w0 = words[0] ?? ''
    const w1 = words[1] ?? ''
    const prefixes = new Set(['а', 'і', 'та', 'ну', 'от', 'тож', 'and', 'so', 'well', 'now', 'then', 'but'])
    if (prefixes.has(w0) && w1) {
      return `${w0} ${w1}`
    }
    return w0 || fallbackLabel
  }
}

import React from 'react'
import type { TranscriptionSessionState } from '@/shared/contracts/questions'

export interface TranscriptionDiagnosticsProps {
  transcriptionState: TranscriptionSessionState | null
  onToggleSemanticClassifier: (enabled: boolean) => void
}

export function TranscriptionDiagnostics({
  transcriptionState,
  onToggleSemanticClassifier
}: TranscriptionDiagnosticsProps): React.JSX.Element {
  const activeUtterance =
    transcriptionState?.latestUtterance ?? transcriptionState?.latestSegment ?? null
  const evaluation = transcriptionState?.latestEvaluation ?? null

  return (
    <div
      data-testid="transcription-diagnostics"
      style={{
        marginTop: '24px',
        padding: '16px',
        backgroundColor: '#16202A',
        borderRadius: '6px',
        border: '1px solid #2B3A49'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}
      >
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            color: '#A2B4C3',
            textTransform: 'uppercase'
          }}
        >
          Транскрипт та розпізнавання наміру розмови
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {transcriptionState?.isTranscribing && (
            <span
              data-testid="transcription-active-indicator"
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: '#1E3A2F',
                color: '#5BE38C',
                border: '1px solid #5BE38C'
              }}
            >
              ОБРОБКА МОВЛЕННЯ...
            </span>
          )}
          {transcriptionState?.isClassifying && (
            <span
              data-testid="classifier-active-indicator"
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: '#1F2D3D',
                color: '#7BC5F0',
                border: '1px solid #7BC5F0'
              }}
            >
              АНАЛІЗ НАМІРУ...
            </span>
          )}
        </div>
      </div>

      {/* Latest Assembled Utterance / Transcript Segment */}
      <div
        style={{
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: '#1D2935',
          borderRadius: '6px',
          border: '1px solid #2B3A49'
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px'
          }}
        >
          <span style={{ fontSize: '11px', color: '#607F95', fontWeight: 600 }}>ОСТАННЯ РЕПЛІКА:</span>
          {activeUtterance ? (
            <>
              <span
                data-testid="transcript-source"
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#263545',
                  color: '#7BC5F0'
                }}
              >
                {activeUtterance.source === 'mic' ? 'MIC' : 'SYSTEM'}
              </span>
              <span
                data-testid="transcript-language"
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#263545',
                  color: '#A2B4C3'
                }}
              >
                {(activeUtterance.language ?? 'uk').toUpperCase()}
              </span>
              <span
                data-testid="transcript-timestamp"
                style={{ fontSize: '11px', color: '#607F95' }}
              >
                {new Date(activeUtterance.startTimestamp).toLocaleTimeString()}
              </span>
            </>
          ) : null}
          {evaluation ? (
            <>
              <span
                data-testid="intent-category"
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#202E3B',
                  color: '#EAF2F8',
                  border: '1px solid #2B3A49'
                }}
              >
                {evaluation.intent}
              </span>
              <span
                data-testid="intent-decision"
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor:
                    evaluation.decision === 'ready'
                      ? '#1E3A2F'
                      : evaluation.decision === 'suggest'
                      ? '#2C2719'
                      : '#263545',
                  color:
                    evaluation.decision === 'ready'
                      ? '#5BE38C'
                      : evaluation.decision === 'suggest'
                      ? '#EFC278'
                      : '#A2B4C3'
                }}
              >
                {evaluation.decision.toUpperCase()}
              </span>
              <span
                data-testid="intent-route"
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#263545',
                  color: '#7BC5F0'
                }}
              >
                {evaluation.route === 'openrouter' ? 'semantic_classifier' : 'local'}
              </span>
              <span
                data-testid="intent-context-used"
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#263545',
                  color: evaluation.contextUsed ? '#EFC278' : '#607F95'
                }}
              >
                {evaluation.contextUsed ? 'CONTEXT: YES' : 'CONTEXT: NO'}
              </span>
            </>
          ) : null}
        </div>

        {activeUtterance ? (
          <p
            data-testid="transcript-text"
            style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: '#EAF2F8' }}
          >
            {activeUtterance.text}
          </p>
        ) : (
          <p
            data-testid="transcript-empty"
            style={{ margin: 0, fontSize: '13px', color: '#607F95', fontStyle: 'italic' }}
          >
            Очікування мовлення...
          </p>
        )}
      </div>

      {/* Detected Question Candidate */}
      <div
        style={{
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: '#1D2935',
          borderRadius: '6px',
          border: '1px solid #2B3A49'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', color: '#607F95', fontWeight: 600 }}>КАНДИДАТ У ПИТАННЯ:</span>
          {transcriptionState?.latestQuestion ? (
            <>
              <span
                data-testid="question-candidate-badge"
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#2C2719',
                  color: '#EFC278',
                  border: '1px solid #EFC278'
                }}
              >
                ВИЯВЛЕНО
              </span>
              {transcriptionState.latestQuestion.decision && (
                <span
                  data-testid="question-decision-badge"
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: '#263545',
                    color: '#5BE38C'
                  }}
                >
                  {transcriptionState.latestQuestion.decision.toUpperCase()}
                </span>
              )}
              <span
                data-testid="question-confidence"
                style={{ fontSize: '11px', color: '#EFC278', fontWeight: 600 }}
              >
                {Math.round(transcriptionState.latestQuestion.confidence * 100)}%
              </span>
            </>
          ) : null}
        </div>

        {transcriptionState?.latestQuestion ? (
          <p
            data-testid="question-text"
            style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: '#EAF2F8', fontWeight: 500 }}
          >
            {transcriptionState.latestQuestion.text}
          </p>
        ) : (
          <p
            data-testid="question-empty"
            style={{ margin: 0, fontSize: '13px', color: '#607F95', fontStyle: 'italic' }}
          >
            Питань не виявлено
          </p>
        )}
      </div>

      {/* Optional Cloud Semantic Classifier Controls */}
      <div
        data-testid="semantic-classifier-controls"
        style={{
          padding: '12px',
          backgroundColor: '#1D2935',
          borderRadius: '6px',
          border: '1px solid #2B3A49'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <input
              type="checkbox"
              data-testid="toggle-semantic-classifier"
              checked={Boolean(
                transcriptionState?.semanticClassifier?.enabled &&
                  transcriptionState?.semanticClassifier?.userConsentGranted
              )}
              onChange={(e) => onToggleSemanticClassifier(e.target.checked)}
              aria-label="Хмарний семантичний аналіз намірів"
            />
            <span style={{ color: '#EAF2F8', fontWeight: 500 }}>
              Хмарний семантичний аналіз (OpenRouter, opt-in)
            </span>
          </label>

          <span
            data-testid="classifier-provider-status"
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: '#263545',
              color: transcriptionState?.semanticClassifier?.providerAvailable ? '#5BE38C' : '#A2B4C3'
            }}
          >
            {transcriptionState?.semanticClassifier?.providerAvailable ? 'KEY READY' : 'LOCAL ONLY'}
          </span>
        </div>

        <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#A2B4C3', lineHeight: 1.4 }}>
          Вимкнено за замовчуванням. Коли увімкнено за вашою згодою, лише неоднозначні текстові репліки класифікуються через низьколатентну модель без передачі сирого аудіо.
        </p>

        {transcriptionState?.semanticClassifier?.lastError && (
          <p
            data-testid="classifier-last-error"
            style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#FA8D8B' }}
          >
            Помилка класифікатора: {transcriptionState.semanticClassifier.lastError}
          </p>
        )}
      </div>
    </div>
  )
}

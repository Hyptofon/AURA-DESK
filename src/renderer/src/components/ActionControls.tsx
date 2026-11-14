import React from 'react'
import type { SessionStatus } from '@/shared/contracts/channels'

export interface ActionControlsProps {
  canStart: boolean
  sessionStatus: SessionStatus
  isMicActive?: boolean
  isMicPaused?: boolean
  isSystemActive?: boolean
  isSystemPaused?: boolean
  onStart: () => void
  onPauseResume: () => void
  onStop: () => void
}

export function ActionControls({
  canStart,
  sessionStatus,
  isMicActive,
  isMicPaused,
  isSystemActive,
  isSystemPaused,
  onStart,
  onPauseResume,
  onStop
}: ActionControlsProps): React.JSX.Element {
  const isSessionPaused = sessionStatus === 'paused'
  const isAnyAudioActive = Boolean(isMicActive || isSystemActive)
  const isAnyAudioPaused = Boolean(isMicPaused || isSystemPaused)

  const isStartDisabled = !canStart || sessionStatus !== 'idle'
  const isPauseDisabled =
    sessionStatus !== 'active' &&
    sessionStatus !== 'paused' &&
    !isAnyAudioActive &&
    !isAnyAudioPaused

  const isStopDisabled =
    sessionStatus === 'idle' &&
    !isAnyAudioActive &&
    !isAnyAudioPaused

  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <button
        type="button"
        disabled={isStartDisabled}
        onClick={onStart}
        style={{
          padding: '8px 16px',
          borderRadius: '6px',
          backgroundColor: !isStartDisabled ? '#7BC5F0' : '#1D2935',
          color: !isStartDisabled ? '#102435' : '#607F95',
          border: '1px solid #2B3A49',
          fontSize: '13px',
          fontWeight: 600,
          cursor: !isStartDisabled ? 'pointer' : 'not-allowed'
        }}
      >
        Почати сесію
      </button>

      <button
        type="button"
        disabled={isPauseDisabled}
        onClick={onPauseResume}
        style={{
          padding: '8px 16px',
          borderRadius: '6px',
          backgroundColor: '#1D2935',
          color: sessionStatus === 'active' || isAnyAudioActive ? '#EAF2F8' : '#607F95',
          border: '1px solid #2B3A49',
          fontSize: '13px',
          fontWeight: 600,
          cursor: !isPauseDisabled ? 'pointer' : 'not-allowed'
        }}
      >
        {isSessionPaused || isAnyAudioPaused ? 'Продовжити' : 'Пауза'}
      </button>

      <button
        type="button"
        disabled={isStopDisabled}
        onClick={onStop}
        style={{
          padding: '8px 16px',
          borderRadius: '6px',
          backgroundColor: '#1D2935',
          color: sessionStatus !== 'idle' || isAnyAudioActive || isAnyAudioPaused ? '#FA8D8B' : '#607F95',
          border: '1px solid #2B3A49',
          fontSize: '13px',
          fontWeight: 600,
          cursor: !isStopDisabled ? 'pointer' : 'not-allowed'
        }}
      >
        Зупинити
      </button>
    </div>
  )
}

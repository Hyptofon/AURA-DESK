import React from 'react'

export interface PrivacyBadgesProps {
  isMicActive?: boolean
  isMicPaused?: boolean
  isSystemActive?: boolean
  isSystemPaused?: boolean
  isSessionPaused?: boolean
}

export function PrivacyBadges({
  isMicActive,
  isMicPaused,
  isSystemActive,
  isSystemPaused,
  isSessionPaused
}: PrivacyBadgesProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {isMicActive && (
        <span
          data-testid="mic-recording-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: '#2C1B1E',
            color: '#E86D70',
            border: '1px solid #E86D70'
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#E86D70'
            }}
            aria-hidden="true"
          />
          MIC RECORDING
        </span>
      )}

      {isMicPaused && (
        <span
          data-testid="mic-paused-badge"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: '#2C2719',
            color: '#EFC278',
            border: '1px solid #EFC278'
          }}
        >
          MIC PAUSED
        </span>
      )}

      {isSystemActive && (
        <span
          data-testid="system-recording-badge"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: '#2C2719',
            color: '#EFC278',
            border: '1px solid #EFC278'
          }}
        >
          SYSTEM AUDIO CAPTURED
        </span>
      )}

      {isSystemPaused && (
        <span
          data-testid="system-paused-badge"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: '#2C2719',
            color: '#EFC278',
            border: '1px solid #EFC278'
          }}
        >
          SYSTEM AUDIO PAUSED
        </span>
      )}

      {isSessionPaused && !isMicPaused && !isSystemPaused && (
        <span
          data-testid="session-paused-badge"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: '#2C2719',
            color: '#EFC278',
            border: '1px solid #EFC278'
          }}
        >
          PAUSED
        </span>
      )}
    </div>
  )
}

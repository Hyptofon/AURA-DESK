import React from 'react'
import type { AudioConfig } from '@/shared/contracts/audio'

export interface AudioTogglesProps {
  audioConfig: AudioConfig
  onToggleMic: (enabled: boolean) => void
  onToggleSystem: (enabled: boolean) => void
}

export function AudioToggles({
  audioConfig,
  onToggleMic,
  onToggleSystem
}: AudioTogglesProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: '20px',
        marginBottom: '20px',
        padding: '12px',
        backgroundColor: '#1D2935',
        borderRadius: '6px',
        border: '1px solid #2B3A49'
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <input
          type="checkbox"
          data-testid="toggle-mic"
          checked={audioConfig.mic}
          onChange={(e) => onToggleMic(e.target.checked)}
          aria-label="Мікрофон"
        />
        <span style={{ color: audioConfig.mic ? '#EAF2F8' : '#A2B4C3' }}>Мікрофон</span>
      </label>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <input
          type="checkbox"
          data-testid="toggle-system-audio"
          checked={audioConfig.system}
          onChange={(e) => onToggleSystem(e.target.checked)}
          aria-label="Системне аудіо"
        />
        <span style={{ color: audioConfig.system ? '#EAF2F8' : '#A2B4C3' }}>Системне аудіо</span>
      </label>
    </div>
  )
}

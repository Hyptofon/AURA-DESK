import React from 'react'

export interface AppHeaderProps {
  version: string
  platform: string
}

export function AppHeader({ version, platform }: AppHeaderProps): React.JSX.Element {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #2B3A49',
        paddingBottom: '16px',
        marginBottom: '24px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, letterSpacing: '0.02em' }}>
          AURA DESK
        </h1>
        <span
          style={{
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '6px',
            backgroundColor: '#1D2935',
            color: '#A2B4C3',
            border: '1px solid #2B3A49'
          }}
        >
          Quiet Instrument · v{version}
        </span>
      </div>
      <div style={{ fontSize: '12px', color: '#A2B4C3' }}>
        Платформа: <strong style={{ color: '#EAF2F8' }}>{platform}</strong>
      </div>
    </header>
  )
}

import React from 'react'

export function App(): React.JSX.Element {
  const platform = typeof window !== 'undefined' && window.api ? window.api.platform : 'windows'
  const version = typeof window !== 'undefined' && window.api ? window.api.version : '0.1.0'

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '24px',
        backgroundColor: '#0D1218',
        color: '#EAF2F8',
        fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
      }}
    >
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

      {/* Signal Rail preview / Session state */}
      <section
        aria-label="Панель стану сесії"
        style={{
          backgroundColor: '#151D26',
          border: '1px solid #2B3A49',
          borderRadius: '10px',
          padding: '20px',
          maxWidth: '640px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#607F95'
            }}
            aria-hidden="true"
          />
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#A2B4C3' }}>
            Статус сесії: <span style={{ color: '#EAF2F8' }}>Очікування (Сесія вимкнена)</span>
          </span>
        </div>

        <p style={{ fontSize: '13px', lineHeight: 1.5, color: '#A2B4C3', margin: '0 0 20px 0' }}>
          AURA DESK спостерігає за дозволеними екранами та аудіо виключно під час активної сесії після явного натискання «Почати сесію».
        </p>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            disabled
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: '#1D2935',
              color: '#607F95',
              border: '1px solid #2B3A49',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'not-allowed'
            }}
          >
            Почати сесію
          </button>
          <button
            type="button"
            disabled
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: '#1D2935',
              color: '#607F95',
              border: '1px solid #2B3A49',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'not-allowed'
            }}
          >
            Пауза
          </button>
          <button
            type="button"
            disabled
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: '#1D2935',
              color: '#607F95',
              border: '1px solid #2B3A49',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'not-allowed'
            }}
          >
            Зупинити
          </button>
        </div>
      </section>
    </main>
  )
}

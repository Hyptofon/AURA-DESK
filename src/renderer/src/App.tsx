import React, { useState, useEffect, useCallback } from 'react'
import type { AudioSessionState, AudioConfig } from '@/shared/contracts/audio'
import type { SessionStatus } from '@/shared/contracts/channels'
import { defaultAudioStreamService } from './services/audio-stream-service'

export function App(): React.JSX.Element {
  const platform = typeof window !== 'undefined' && window.api ? window.api.platform : 'windows'
  const version = typeof window !== 'undefined' && window.api ? window.api.version : '0.1.0'

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [audioState, setAudioState] = useState<AudioSessionState | null>(null)
  const [audioConfig, setAudioConfig] = useState<AudioConfig>({ mic: false, system: false })
  const [canStart, setCanStart] = useState<boolean>(true) // Enabled for active session start

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api) return

    let mounted = true

    // Check display configuration availability to set canStart
    if (window.api.getDisplays) {
      window.api.getDisplays().then((config) => {
        if (mounted && config?.displays) {
          setCanStart(config.displays.length > 0)
        }
      }).catch(() => {
        if (mounted) setCanStart(true)
      })
    }

    // Load initial session state
    if (window.api.getSessionState) {
      window.api.getSessionState().then((state) => {
        if (mounted && state?.status) setSessionStatus(state.status)
      }).catch(() => {})
    }

    // Load initial audio state
    if (window.api.getAudioState) {
      window.api.getAudioState().then((state) => {
        if (mounted && state) {
          setAudioState((current) => current ?? state)
          setAudioConfig({
            mic: state.mic.enabled,
            system: state.system.enabled
          })
        }
      }).catch(() => {})
    }

    // Listen for session status updates from main process
    let unsubscribeStatus: (() => void) | undefined
    if (window.api.onSessionStatusChanged) {
      unsubscribeStatus = window.api.onSessionStatusChanged((event) => {
        if (mounted && event?.status) {
          setSessionStatus(event.status)
        }
      })
    }

    // Listen for audio state updates
    let unsubscribeAudio: (() => void) | undefined
    if (window.api.onAudioStateChanged) {
      unsubscribeAudio = window.api.onAudioStateChanged((state) => {
        if (mounted) {
          setAudioState(state)
          setAudioConfig((prev) => ({
            ...prev,
            mic: state.mic.enabled,
            system: state.system.enabled
          }))
        }
      })
    }

    return () => {
      mounted = false
      unsubscribeStatus?.()
      unsubscribeAudio?.()
    }
  }, [])

  const handleToggleMic = useCallback(async (enabled: boolean) => {
    const prevConfig = audioConfig
    const nextConfig: AudioConfig = { ...audioConfig, mic: enabled }
    setAudioConfig(nextConfig)

    // Only activate backend and hardware stream if session is actively running
    if (sessionStatus === 'active') {
      if (enabled) {
        try {
          await defaultAudioStreamService.startMicrophone(nextConfig.micDeviceId)
          if (window.api?.setAudioConfig) {
            const state = await window.api.setAudioConfig(nextConfig)
            setAudioState(state)
          }
        } catch (err) {
          setAudioConfig(prevConfig)
          console.error('Failed to enable mic stream:', err)
        }
      } else {
        await defaultAudioStreamService.stopMicrophone()
        if (window.api?.setAudioConfig) {
          try {
            const state = await window.api.setAudioConfig(nextConfig)
            setAudioState(state)
          } catch (err) {
            console.error('Failed to disable mic config:', err)
          }
        }
      }
    }
  }, [audioConfig, sessionStatus])

  const handleToggleSystem = useCallback(async (enabled: boolean) => {
    const prevConfig = audioConfig
    const nextConfig: AudioConfig = { ...audioConfig, system: enabled }
    setAudioConfig(nextConfig)

    // Only activate backend and hardware stream if session is actively running
    if (sessionStatus === 'active') {
      if (enabled) {
        try {
          await defaultAudioStreamService.startSystemLoopback()
          if (window.api?.setAudioConfig) {
            const state = await window.api.setAudioConfig(nextConfig)
            setAudioState(state)
          }
        } catch (err) {
          setAudioConfig(prevConfig)
          console.error('Failed to enable system audio stream:', err)
        }
      } else {
        await defaultAudioStreamService.stopSystemLoopback()
        if (window.api?.setAudioConfig) {
          try {
            const state = await window.api.setAudioConfig(nextConfig)
            setAudioState(state)
          } catch (err) {
            console.error('Failed to disable system audio config:', err)
          }
        }
      }
    }
  }, [audioConfig, sessionStatus])

  const handleStartSession = useCallback(async () => {
    if (sessionStatus !== 'idle') return

    if (window.api?.startSession) {
      try {
        // Initiate hardware media requests synchronously with user click gesture
        let micPromise: Promise<void> | null = null
        if (audioConfig.mic) {
          micPromise = defaultAudioStreamService.startMicrophone(audioConfig.micDeviceId)
        }
        let systemPromise: Promise<void> | null = null
        if (audioConfig.system) {
          systemPromise = defaultAudioStreamService.startSystemLoopback()
        }

        const res = await window.api.startSession()
        if (res.status) {
          setSessionStatus(res.status)
          if (res.status === 'active') {
            // Apply desired audio configuration upon explicit session start
            if (audioConfig.mic || audioConfig.system) {
              if (window.api?.setAudioConfig) {
                try {
                  const state = await window.api.setAudioConfig(audioConfig)
                  setAudioState(state)
                } catch (err) {
                  console.error('Failed to apply audio config on session start:', err)
                }
              }
              if (micPromise) {
                await micPromise.catch((err) => {
                  console.error('Failed to start microphone stream:', err)
                })
              }
              if (systemPromise) {
                await systemPromise.catch((err) => {
                  console.error('Failed to start system loopback stream:', err)
                })
              }
            }
          } else {
            // Non-active session status returned: stop newly opened audio tracks immediately
            await defaultAudioStreamService.stopAll().catch(() => {})
          }
        } else {
          // No status in response indicates failed startup: stop opened audio tracks
          await defaultAudioStreamService.stopAll().catch(() => {})
        }
      } catch (err) {
        console.error('Failed to start session:', err)
        // Main session Start failed or threw: stop newly opened audio tracks immediately
        await defaultAudioStreamService.stopAll().catch(() => {})
        // Refresh session state to eliminate stale UI if Start was rejected (e.g. SESSION_ACTIVE_STOP_REQUIRED)
        if (window.api?.getSessionState) {
          try {
            const state = await window.api.getSessionState()
            if (state?.status) {
              setSessionStatus(state.status)
            }
          } catch {
            // Ignored
          }
        }
        if (window.api?.getAudioState) {
          try {
            const aState = await window.api.getAudioState()
            if (aState) {
              setAudioState(aState)
            }
          } catch {
            // Ignored
          }
        }
      }
    }
  }, [audioConfig, sessionStatus])

  const handlePauseResume = useCallback(async () => {
    const isCurrentlyPaused =
      sessionStatus === 'paused' ||
      audioState?.mic.status === 'paused' ||
      audioState?.system.status === 'paused'
    const nextPaused = !isCurrentlyPaused

    if (nextPaused) {
      // PAUSE: Stop live renderer streams, disconnect processors, then tell backend
      try {
        await defaultAudioStreamService.pauseAll()
      } catch (err) {
        console.error('Failed to pause renderer audio streams:', err)
      }
      if (window.api?.setAudioConfig) {
        try {
          const state = await window.api.setAudioConfig({ ...audioConfig, paused: true })
          setAudioState(state)
          setSessionStatus('paused')
        } catch (err) {
          console.error('Failed to set pause state in backend:', err)
        }
      }
    } else {
      // RESUME: Reacquire only user-enabled audio sources, then tell backend
      try {
        if (audioConfig.mic) {
          await defaultAudioStreamService.startMicrophone(audioConfig.micDeviceId)
        }
        if (audioConfig.system) {
          await defaultAudioStreamService.startSystemLoopback()
        }
      } catch (err) {
        console.error('Failed to reacquire audio streams on resume:', err)
        return
      }

      if (window.api?.setAudioConfig) {
        try {
          const state = await window.api.setAudioConfig({ ...audioConfig, paused: false })
          setAudioState(state)
          setSessionStatus('active')
        } catch (err) {
          console.error('Failed to resume audio config in backend:', err)
        }
      }
    }
  }, [sessionStatus, audioState, audioConfig])

  const handleStopSession = useCallback(async () => {
    let teardownFailed = false

    // Teardown live renderer audio streams immediately
    try {
      await defaultAudioStreamService.stopAll()
    } catch (err) {
      teardownFailed = true
      console.error('Failed to stop renderer audio streams:', err)
    }

    if (window.api?.stopSession) {
      try {
        const res = await window.api.stopSession()
        if (res.status) {
          setSessionStatus(res.status)
        }
      } catch (err) {
        teardownFailed = true
        console.error('Failed to stop session:', err)
        // Never show idle after a failed Stop! Refresh actual session state
        if (window.api?.getSessionState) {
          try {
            const actual = await window.api.getSessionState()
            if (actual?.status) {
              setSessionStatus(actual.status)
            }
          } catch {
            setSessionStatus('error')
          }
        } else {
          setSessionStatus('error')
        }
      }
    }

    if (window.api?.setAudioConfig && !teardownFailed) {
      try {
        const idleState = await window.api.setAudioConfig({ mic: false, system: false })
        setAudioState(idleState)
      } catch (err) {
        console.error('Failed to stop audio config:', err)
      }
    }

    if (!teardownFailed) {
      setSessionStatus('idle')
    }
  }, [])

  const isMicActive = audioState?.mic.status === 'active'
  const isMicPaused = audioState?.mic.status === 'paused'
  const isSystemActive = audioState?.system.status === 'active'
  const isSystemPaused = audioState?.system.status === 'paused'
  const isSessionPaused = sessionStatus === 'paused'

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

      {/* Signal Rail preview / Session state & Privacy Indicators */}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor:
                  sessionStatus === 'active' || isMicActive || isSystemActive
                    ? '#E86D70'
                    : isSessionPaused || isMicPaused || isSystemPaused
                    ? '#EFC278'
                    : '#607F95'
              }}
              aria-hidden="true"
            />
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#A2B4C3' }}>
              Статус сесії:{' '}
              <span style={{ color: '#EAF2F8' }}>
                {sessionStatus === 'active'
                  ? 'Активна'
                  : sessionStatus === 'paused'
                  ? 'Призупинена'
                  : 'Очікування (Сесія вимкнена)'}
              </span>
            </span>
          </div>

          {/* Privacy Badges Container */}
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
        </div>

        <p style={{ fontSize: '13px', lineHeight: 1.5, color: '#A2B4C3', margin: '0 0 20px 0' }}>
          AURA DESK спостерігає за дозволеними екранами та аудіо виключно під час активної сесії після явного натискання «Почати сесію».
        </p>

        {/* Audio Toggles */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', padding: '12px', backgroundColor: '#1D2935', borderRadius: '6px', border: '1px solid #2B3A49' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              data-testid="toggle-mic"
              checked={audioConfig.mic}
              onChange={(e) => void handleToggleMic(e.target.checked)}
              aria-label="Мікрофон"
            />
            <span style={{ color: audioConfig.mic ? '#EAF2F8' : '#A2B4C3' }}>Мікрофон</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              data-testid="toggle-system-audio"
              checked={audioConfig.system}
              onChange={(e) => void handleToggleSystem(e.target.checked)}
              aria-label="Системне аудіо"
            />
            <span style={{ color: audioConfig.system ? '#EAF2F8' : '#A2B4C3' }}>Системне аудіо</span>
          </label>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            disabled={!canStart || sessionStatus !== 'idle'}
            onClick={() => void handleStartSession()}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: canStart && sessionStatus === 'idle' ? '#7BC5F0' : '#1D2935',
              color: canStart && sessionStatus === 'idle' ? '#102435' : '#607F95',
              border: '1px solid #2B3A49',
              fontSize: '13px',
              fontWeight: 600,
              cursor: canStart && sessionStatus === 'idle' ? 'pointer' : 'not-allowed'
            }}
          >
            Почати сесію
          </button>
          <button
            type="button"
            disabled={sessionStatus !== 'active' && sessionStatus !== 'paused' && !isMicActive && !isSystemActive && !isMicPaused && !isSystemPaused}
            onClick={() => void handlePauseResume()}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: '#1D2935',
              color: (sessionStatus === 'active' || isMicActive || isSystemActive) ? '#EAF2F8' : '#607F95',
              border: '1px solid #2B3A49',
              fontSize: '13px',
              fontWeight: 600,
              cursor: (sessionStatus === 'active' || sessionStatus === 'paused' || isMicActive || isSystemActive || isMicPaused || isSystemPaused) ? 'pointer' : 'not-allowed'
            }}
          >
            {isSessionPaused || isMicPaused || isSystemPaused ? 'Продовжити' : 'Пауза'}
          </button>
          <button
            type="button"
            disabled={sessionStatus === 'idle' && !isMicActive && !isSystemActive && !isMicPaused && !isSystemPaused}
            onClick={() => void handleStopSession()}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: '#1D2935',
              color: (sessionStatus !== 'idle' || isMicActive || isSystemActive || isMicPaused || isSystemPaused) ? '#FA8D8B' : '#607F95',
              border: '1px solid #2B3A49',
              fontSize: '13px',
              fontWeight: 600,
              cursor: (sessionStatus !== 'idle' || isMicActive || isSystemActive || isMicPaused || isSystemPaused) ? 'pointer' : 'not-allowed'
            }}
          >
            Зупинити
          </button>
        </div>
      </section>
    </main>
  )
}

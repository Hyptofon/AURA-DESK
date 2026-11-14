import React, { useState, useEffect, useCallback } from 'react'
import type { AudioSessionState, AudioConfig } from '@/shared/contracts/audio'
import type { SessionStatus } from '@/shared/contracts/channels'
import type { TranscriptionSessionState } from '@/shared/contracts/questions'
import { defaultAudioStreamService } from './services/audio-stream-service'
import { AppHeader } from './components/AppHeader'
import { PrivacyBadges } from './components/PrivacyBadges'
import { AudioToggles } from './components/AudioToggles'
import { ActionControls } from './components/ActionControls'
import { TranscriptionDiagnostics } from './components/TranscriptionDiagnostics'

export function App(): React.JSX.Element {
  const platform = typeof window !== 'undefined' && window.api ? window.api.platform : 'windows'
  const version = typeof window !== 'undefined' && window.api ? window.api.version : '0.1.0'

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [audioState, setAudioState] = useState<AudioSessionState | null>(null)
  const [audioConfig, setAudioConfig] = useState<AudioConfig>({ mic: false, system: false })
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionSessionState | null>(null)
  const [canStart, setCanStart] = useState<boolean>(true)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api) return

    let mounted = true

    if (window.api.getDisplays) {
      window.api.getDisplays().then((config) => {
        if (mounted && config?.displays) {
          setCanStart(config.displays.length > 0)
        }
      }).catch(() => {
        if (mounted) setCanStart(true)
      })
    }

    if (window.api.getSessionState) {
      window.api.getSessionState().then((state) => {
        if (mounted && state?.status) setSessionStatus(state.status)
      }).catch(() => {})
    }

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

    if (window.api.getTranscriptionState) {
      window.api.getTranscriptionState().then((state) => {
        if (mounted && state) {
          setTranscriptionState(state)
        }
      }).catch(() => {})
    }

    let unsubscribeStatus: (() => void) | undefined
    if (window.api.onSessionStatusChanged) {
      unsubscribeStatus = window.api.onSessionStatusChanged((event) => {
        if (mounted && event?.status) {
          setSessionStatus(event.status)
        }
      })
    }

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

    let unsubscribeTranscription: (() => void) | undefined
    if (window.api.onTranscriptionStateChanged) {
      unsubscribeTranscription = window.api.onTranscriptionStateChanged((state) => {
        if (mounted && state) {
          setTranscriptionState(state)
        }
      })
    }

    return () => {
      mounted = false
      unsubscribeStatus?.()
      unsubscribeAudio?.()
      unsubscribeTranscription?.()
    }
  }, [])

  const handleToggleMic = useCallback(async (enabled: boolean) => {
    const prevConfig = audioConfig
    const nextConfig: AudioConfig = { ...audioConfig, mic: enabled }
    setAudioConfig(nextConfig)

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
          console.error('Failed to enable microphone stream:', err)
        }
      } else {
        await defaultAudioStreamService.stopMicrophone()
        if (window.api?.setAudioConfig) {
          try {
            const state = await window.api.setAudioConfig(nextConfig)
            setAudioState(state)
          } catch (err) {
            console.error('Failed to disable microphone config:', err)
          }
        }
      }
    }
  }, [audioConfig, sessionStatus])

  const handleToggleSystem = useCallback(async (enabled: boolean) => {
    const prevConfig = audioConfig
    const nextConfig: AudioConfig = { ...audioConfig, system: enabled }
    setAudioConfig(nextConfig)

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
            await defaultAudioStreamService.stopAll().catch(() => {})
          }
        } else {
          await defaultAudioStreamService.stopAll().catch(() => {})
        }
      } catch (err) {
        console.error('Failed to start session:', err)
        await defaultAudioStreamService.stopAll().catch(() => {})
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
      setTranscriptionState(null)
    }
  }, [])

  const handleToggleSemanticClassifier = useCallback(async (enabled: boolean) => {
    if (window.api?.setClassifierConfig) {
      try {
        const nextState = await window.api.setClassifierConfig({
          enabled,
          userConsentGranted: enabled
        })
        if (nextState) {
          setTranscriptionState(nextState)
        }
      } catch (err) {
        console.error('Failed to update semantic classifier config:', err)
      }
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
      <AppHeader version={version} platform={platform} />

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

          <PrivacyBadges
            isMicActive={isMicActive}
            isMicPaused={isMicPaused}
            isSystemActive={isSystemActive}
            isSystemPaused={isSystemPaused}
            isSessionPaused={isSessionPaused}
          />
        </div>

        <p style={{ fontSize: '13px', lineHeight: 1.5, color: '#A2B4C3', margin: '0 0 20px 0' }}>
          AURA DESK спостерігає за дозволеними екранами та аудіо виключно під час активної сесії після явного натискання «Почати сесію».
        </p>

        <AudioToggles
          audioConfig={audioConfig}
          onToggleMic={(enabled) => void handleToggleMic(enabled)}
          onToggleSystem={(enabled) => void handleToggleSystem(enabled)}
        />

        <ActionControls
          canStart={canStart}
          sessionStatus={sessionStatus}
          isMicActive={isMicActive}
          isMicPaused={isMicPaused}
          isSystemActive={isSystemActive}
          isSystemPaused={isSystemPaused}
          onStart={() => void handleStartSession()}
          onPauseResume={() => void handlePauseResume()}
          onStop={() => void handleStopSession()}
        />

        <TranscriptionDiagnostics
          transcriptionState={transcriptionState}
          onToggleSemanticClassifier={(enabled) => void handleToggleSemanticClassifier(enabled)}
        />
      </section>
    </main>
  )
}

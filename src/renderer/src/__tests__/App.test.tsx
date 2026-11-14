import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { App } from '../App'
import type { AudioSessionState } from '@/shared/contracts/audio'
import type { SessionStatus } from '@/shared/contracts/channels'
import type { TranscriptionSessionState } from '@/shared/contracts/questions'

vi.mock('../services/audio-stream-service', () => ({
  defaultAudioStreamService: {
    startMicrophone: vi.fn(async () => {}),
    stopMicrophone: vi.fn(async () => {}),
    startSystemLoopback: vi.fn(async () => {}),
    stopSystemLoopback: vi.fn(async () => {}),
    pauseAll: vi.fn(async () => {}),
    stopAll: vi.fn(async () => {})
  }
}))

describe('<App /> Component', () => {
  let audioStateListener: ((state: AudioSessionState) => void) | null = null
  let sessionStatusListener: ((payload: { status: SessionStatus; error?: string }) => void) | null = null
  let transcriptionListener: ((state: TranscriptionSessionState) => void) | null = null

  beforeEach(() => {
    audioStateListener = null
    sessionStatusListener = null
    transcriptionListener = null
    window.api = {
      platform: 'win32',
      version: '0.1.0',
      getAppInfo: async () => ({
        name: 'aura-desk',
        version: '0.1.0',
        platform: 'win32',
        isPackaged: false
      }),
      getSessionState: async () => ({ status: 'idle' }),
      setCaptureSelection: async (selection) => ({ success: true, selection }),
      startSession: vi.fn(async () => ({ success: true, status: 'active' as const })),
      stopSession: vi.fn(async () => ({ success: true, status: 'idle' as const })),
      getDisplays: vi.fn(async () => ({
        displays: [
          {
            id: 'disp-1',
            label: 'Display 1',
            isPrimary: true,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1,
            rotation: 0
          }
        ],
        primaryId: 'disp-1',
        count: 1,
        isMultiDisplay: false
      })),
      getAudioState: async () => ({
        mic: {
          enabled: false,
          status: 'idle',
          deviceId: null,
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null },
          vad: { isSpeech: false, rms: 0, speechDurationMs: 0, silenceDurationMs: 0 }
        },
        system: {
          enabled: false,
          status: 'idle',
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null }
        }
      }),
      setAudioConfig: vi.fn(async (config) => ({
        mic: {
          enabled: Boolean(config.mic),
          status: (config.mic ? 'active' : 'idle') as 'active' | 'idle',
          deviceId: null,
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null },
          vad: { isSpeech: false, rms: 0, speechDurationMs: 0, silenceDurationMs: 0 }
        },
        system: {
          enabled: Boolean(config.system),
          status: (config.system ? 'active' : 'idle') as 'active' | 'idle',
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null }
        }
      })),
      getTranscriptionState: vi.fn(async () => ({
        latestSegment: null,
        latestQuestion: null,
        segmentCount: 0,
        questionCount: 0,
        isTranscribing: false
      })),
      setClassifierConfig: vi.fn(async (cfg) => ({
        latestSegment: null,
        latestQuestion: null,
        segmentCount: 0,
        questionCount: 0,
        isTranscribing: false,
        semanticClassifier: {
          enabled: cfg.enabled,
          userConsentGranted: cfg.userConsentGranted,
          providerAvailable: true,
          configuredModel: cfg.model ?? 'google/gemini-3.1-flash-lite',
          zdrPreferred: true,
          requestCount: 0,
          maxRequests: 100,
          totalSpentUsd: 0,
          budgetUsd: 0.25,
          lastError: null
        }
      })),
      onTranscriptionStateChanged: vi.fn((cb) => {
        transcriptionListener = cb
        return () => {
          transcriptionListener = null
        }
      }),
      onAudioStateChanged: vi.fn((cb) => {
        audioStateListener = cb
        return () => {
          audioStateListener = null
        }
      }),
      onSessionStatusChanged: vi.fn((cb) => {
        sessionStatusListener = cb
        return () => {
          sessionStatusListener = null
        }
      })
    }
  })

  it('renders application title and quiet instrument badge', async () => {
    await act(async () => {
      render(<App />)
    })

    expect(screen.getByRole('heading', { level: 1, name: /AURA DESK/i })).toBeInTheDocument()
    expect(screen.getByText(/Quiet Instrument · v0\.1\.0/i)).toBeInTheDocument()
  })

  it('renders platform information from window.api', async () => {
    await act(async () => {
      render(<App />)
    })

    expect(screen.getByText(/Платформа:/i)).toBeInTheDocument()
    expect(screen.getByText('win32')).toBeInTheDocument()
  })

  it('displays initial idle session status and no recording badges', async () => {
    await act(async () => {
      render(<App />)
    })

    expect(screen.getByText(/Очікування \(Сесія вимкнена\)/i)).toBeInTheDocument()
    expect(screen.queryByTestId('mic-recording-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('system-recording-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mic-paused-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('system-paused-badge')).not.toBeInTheDocument()
  })

  it('renders session action buttons correctly initially (start enabled, pause and stop disabled)', async () => {
    await act(async () => {
      render(<App />)
    })

    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    const pauseBtn = screen.getByRole('button', { name: /Пауза/i })
    const stopBtn = screen.getByRole('button', { name: /Зупинити/i })

    expect(startBtn).toBeEnabled()
    expect(pauseBtn).toBeDisabled()
    expect(stopBtn).toBeDisabled()
  })

  it('displays MIC RECORDING badge when mic is active', async () => {
    await act(async () => {
      render(<App />)
    })

    await act(async () => {
      audioStateListener?.({
        mic: {
          enabled: true,
          status: 'active',
          deviceId: null,
          bufferStats: { chunkCount: 1, totalBytes: 640, newestTimestamp: 1000, oldestTimestamp: 1000 },
          vad: { isSpeech: true, rms: 0.05, speechDurationMs: 200, silenceDurationMs: 0 }
        },
        system: {
          enabled: false,
          status: 'idle',
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null }
        }
      })
    })

    const micBadge = screen.getByTestId('mic-recording-badge')
    expect(micBadge).toBeInTheDocument()
    expect(micBadge).toHaveTextContent(/MIC RECORDING/i)
    expect(screen.queryByTestId('system-recording-badge')).not.toBeInTheDocument()
  })

  it('displays SYSTEM AUDIO CAPTURED badge when system audio is active', async () => {
    await act(async () => {
      render(<App />)
    })

    await act(async () => {
      audioStateListener?.({
        mic: {
          enabled: false,
          status: 'idle',
          deviceId: null,
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null },
          vad: { isSpeech: false, rms: 0, speechDurationMs: 0, silenceDurationMs: 0 }
        },
        system: {
          enabled: true,
          status: 'active',
          bufferStats: { chunkCount: 5, totalBytes: 3200, newestTimestamp: 1000, oldestTimestamp: 900 }
        }
      })
    })

    const systemBadge = screen.getByTestId('system-recording-badge')
    expect(systemBadge).toBeInTheDocument()
    expect(systemBadge).toHaveTextContent(/SYSTEM AUDIO CAPTURED/i)
    expect(screen.queryByTestId('mic-recording-badge')).not.toBeInTheDocument()
  })

  it('displays paused badges when audio capture is paused', async () => {
    await act(async () => {
      render(<App />)
    })

    await act(async () => {
      audioStateListener?.({
        mic: {
          enabled: true,
          status: 'paused',
          deviceId: null,
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null },
          vad: { isSpeech: false, rms: 0, speechDurationMs: 0, silenceDurationMs: 0 }
        },
        system: {
          enabled: true,
          status: 'paused',
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null }
        }
      })
    })

    expect(screen.getByTestId('mic-paused-badge')).toHaveTextContent(/MIC PAUSED/i)
    expect(screen.getByTestId('system-paused-badge')).toHaveTextContent(/SYSTEM AUDIO PAUSED/i)
    expect(screen.queryByTestId('mic-recording-badge')).not.toBeInTheDocument()
  })

  it('toggles microphone capture intent while idle and applies on session start', async () => {
    await act(async () => {
      render(<App />)
    })

    const micCheckbox = screen.getByTestId('toggle-mic')
    expect(micCheckbox).not.toBeChecked()

    // 1. Toggling in idle only sets UI intent without premature backend call
    await act(async () => {
      fireEvent.click(micCheckbox)
    })

    expect(micCheckbox).toBeChecked()
    expect(window.api.setAudioConfig).not.toHaveBeenCalled()

    // 2. Starting session applies the audio config
    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    await act(async () => {
      fireEvent.click(startBtn)
    })

    expect(window.api.startSession).toHaveBeenCalled()
    expect(window.api.setAudioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ mic: true, system: false })
    )
  })

  it('toggles system audio capture intent while idle and applies on session start', async () => {
    await act(async () => {
      render(<App />)
    })

    const systemCheckbox = screen.getByTestId('toggle-system-audio')
    expect(systemCheckbox).not.toBeChecked()

    // 1. Toggling in idle only sets UI intent without premature backend call
    await act(async () => {
      fireEvent.click(systemCheckbox)
    })

    expect(systemCheckbox).toBeChecked()
    expect(window.api.setAudioConfig).not.toHaveBeenCalled()

    // 2. Starting session applies the audio config
    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    await act(async () => {
      fireEvent.click(startBtn)
    })

    expect(window.api.startSession).toHaveBeenCalled()
    expect(window.api.setAudioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ mic: false, system: true })
    )
  })

  it('dynamically toggles mic capture during active session', async () => {
    window.api.getSessionState = vi.fn(async () => ({ status: 'active' as const }))

    await act(async () => {
      render(<App />)
    })

    const micCheckbox = screen.getByTestId('toggle-mic')
    expect(micCheckbox).not.toBeChecked()

    await act(async () => {
      fireEvent.click(micCheckbox)
    })

    expect(window.api.setAudioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ mic: true, system: false })
    )
    expect(micCheckbox).toBeChecked()
  })

  it('dynamically toggles system audio capture during active session', async () => {
    window.api.getSessionState = vi.fn(async () => ({ status: 'active' as const }))

    await act(async () => {
      render(<App />)
    })

    const systemCheckbox = screen.getByTestId('toggle-system-audio')
    expect(systemCheckbox).not.toBeChecked()

    await act(async () => {
      fireEvent.click(systemCheckbox)
    })

    expect(window.api.setAudioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ mic: false, system: true })
    )
    expect(systemCheckbox).toBeChecked()
  })

  it('detects system-only paused state and sends resume when clicked', async () => {
    let audioStateCb: ((state: unknown) => void) | null = null
    window.api.onAudioStateChanged = vi.fn((cb) => {
      audioStateCb = cb
      return () => {}
    })

    await act(async () => {
      render(<App />)
    })

    // Simulate system audio paused
    await act(async () => {
      audioStateCb?.({
        mic: {
          enabled: false,
          status: 'idle',
          deviceId: null,
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null },
          vad: { isSpeech: false, rms: 0, speechDurationMs: 0, silenceDurationMs: 0 }
        },
        system: {
          enabled: true,
          status: 'paused',
          bufferStats: { chunkCount: 0, totalBytes: 0, newestTimestamp: null, oldestTimestamp: null }
        }
      })
    })

    const resumeBtn = screen.getByRole('button', { name: /Продовжити/i })
    expect(resumeBtn).toBeEnabled()

    await act(async () => {
      fireEvent.click(resumeBtn)
    })

    expect(window.api.setAudioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ paused: false })
    )
  })

  it('rolls back mic checkbox state if setAudioConfig throws during active session', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.api.getSessionState = vi.fn(async () => ({ status: 'active' as const }))
    window.api.setAudioConfig = vi.fn().mockRejectedValueOnce(new Error('Audio permission denied'))

    await act(async () => {
      render(<App />)
    })

    const micCheckbox = screen.getByTestId('toggle-mic')
    expect(micCheckbox).not.toBeChecked()

    await act(async () => {
      fireEvent.click(micCheckbox)
    })

    expect(window.api.setAudioConfig).toHaveBeenCalled()
    expect(micCheckbox).not.toBeChecked()
    consoleSpy.mockRestore()
  })

  it('rolls back system audio checkbox state if setAudioConfig throws during active session', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.api.getSessionState = vi.fn(async () => ({ status: 'active' as const }))
    window.api.setAudioConfig = vi.fn().mockRejectedValueOnce(new Error('System audio loopback error'))

    await act(async () => {
      render(<App />)
    })

    const systemCheckbox = screen.getByTestId('toggle-system-audio')
    expect(systemCheckbox).not.toBeChecked()

    await act(async () => {
      fireEvent.click(systemCheckbox)
    })

    expect(window.api.setAudioConfig).toHaveBeenCalled()
    expect(systemCheckbox).not.toBeChecked()
    consoleSpy.mockRestore()
  })

  it('synchronizes UI session state and disables Start button when onSessionStatusChanged fires', async () => {
    await act(async () => {
      render(<App />)
    })

    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    expect(startBtn).toBeEnabled()

    // Main process notifies that session became active
    await act(async () => {
      sessionStatusListener?.({ status: 'active' })
    })

    expect(screen.getByText(/Активна/i)).toBeInTheDocument()
    expect(startBtn).toBeDisabled()
  })

  it('refreshes session state when startSession throws SESSION_ACTIVE_STOP_REQUIRED without calling stopSession', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.api.startSession = vi.fn().mockRejectedValueOnce(
      new Error('[SESSION_ACTIVE_STOP_REQUIRED] A capture session is already active')
    )
    window.api.getSessionState = vi.fn()
      .mockResolvedValueOnce({ status: 'idle' as const })
      .mockResolvedValueOnce({ status: 'active' as const })

    await act(async () => {
      render(<App />)
    })

    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    expect(startBtn).toBeEnabled()

    await act(async () => {
      fireEvent.click(startBtn)
    })

    // Must query actual session state to synchronize UI
    expect(window.api.getSessionState).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Активна/i)).toBeInTheDocument()
    expect(startBtn).toBeDisabled()

    // Invariant: never automatically stop active session just to hide error
    expect(window.api.stopSession).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('does not show idle after a failed Stop', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.api.getSessionState = vi.fn(async () => ({ status: 'active' as const }))
    window.api.stopSession = vi.fn().mockRejectedValueOnce(new Error('Teardown failed'))

    await act(async () => {
      render(<App />)
    })

    expect(screen.getByText(/Активна/i)).toBeInTheDocument()
    const stopBtn = screen.getByRole('button', { name: /Зупинити/i })

    await act(async () => {
      fireEvent.click(stopBtn)
    })

    // Invariant: Failed stop must NOT transition UI to idle
    expect(screen.queryByText(/Очікування \(Сесія вимкнена\)/i)).not.toBeInTheDocument()
    consoleSpy.mockRestore()
  })

  it('stops opened audio tracks and synchronizes state when startSession throws', async () => {
    const { defaultAudioStreamService } = await import('../services/audio-stream-service')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.api.getSessionState = vi.fn(async () => ({ status: 'idle' as const }))
    window.api.startSession = vi.fn().mockRejectedValueOnce(new Error('Hardware screen capture failed'))

    await act(async () => {
      render(<App />)
    })

    // Enable mic toggle before starting
    const micCheckbox = screen.getByTestId('toggle-mic')
    await act(async () => {
      fireEvent.click(micCheckbox)
    })

    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    await act(async () => {
      fireEvent.click(startBtn)
    })

    // Must invoke stopAll to cleanly tear down any partially acquired streams/tracks
    expect(defaultAudioStreamService.stopAll).toHaveBeenCalled()

    // Must NOT claim active session or show recording badge
    expect(screen.queryByTestId('mic-recording-badge')).not.toBeInTheDocument()
    expect(screen.getByText(/Очікування \(Сесія вимкнена\)/i)).toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('calls pauseAll and updates UI when pause button is clicked', async () => {
    const { defaultAudioStreamService } = await import('../services/audio-stream-service')
    window.api.getSessionState = vi.fn(async () => ({ status: 'active' as const }))

    await act(async () => {
      render(<App />)
    })

    const pauseBtn = screen.getByRole('button', { name: /Пауза/i })
    expect(pauseBtn).toBeEnabled()

    await act(async () => {
      fireEvent.click(pauseBtn)
    })

    expect(defaultAudioStreamService.pauseAll).toHaveBeenCalled()
    expect(window.api.setAudioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true })
    )
    expect(screen.getByRole('button', { name: /Продовжити/i })).toBeInTheDocument()
  })

  it('reacquires user-enabled streams on resume', async () => {
    const { defaultAudioStreamService } = await import('../services/audio-stream-service')
    window.api.getSessionState = vi.fn(async () => ({ status: 'paused' as const }))

    await act(async () => {
      render(<App />)
    })

    const micCheckbox = screen.getByTestId('toggle-mic')
    await act(async () => {
      fireEvent.click(micCheckbox)
    })

    const resumeBtn = screen.getByRole('button', { name: /Продовжити/i })
    await act(async () => {
      fireEvent.click(resumeBtn)
    })

    expect(defaultAudioStreamService.startMicrophone).toHaveBeenCalled()
    expect(window.api.setAudioConfig).toHaveBeenCalledWith(
      expect.objectContaining({ paused: false })
    )
  })

  it('renders transcription diagnostic panel in idle state with placeholders', async () => {
    await act(async () => {
      render(<App />)
    })

    expect(screen.getByTestId('transcription-diagnostics')).toBeInTheDocument()
    expect(screen.getByTestId('transcript-empty')).toHaveTextContent('Очікування мовлення...')
    expect(screen.getByTestId('question-empty')).toHaveTextContent('Питань не виявлено')
  })

  it('renders live transcript segment and question candidate on transcription state change', async () => {
    await act(async () => {
      render(<App />)
    })

    expect(transcriptionListener).toBeTypeOf('function')

    await act(async () => {
      transcriptionListener?.({
        latestSegment: {
          id: 'seg-101',
          source: 'mic',
          startTimestamp: 1700000000000,
          endTimestamp: 1700000003000,
          text: 'Що таке антигравітація?',
          language: 'uk',
          confidence: 0.95,
          isFinal: true
        },
        latestQuestion: {
          id: 'q-101',
          segmentId: 'seg-101',
          source: 'mic',
          timestamp: 1700000003000,
          text: 'Що таке антигравітація?',
          language: 'uk',
          confidence: 0.9,
          status: 'detected'
        },
        segmentCount: 1,
        questionCount: 1,
        isTranscribing: true
      })
    })

    expect(screen.getByTestId('transcription-active-indicator')).toHaveTextContent('ОБРОБКА МОВЛЕННЯ...')
    expect(screen.getByTestId('transcript-source')).toHaveTextContent('MIC')
    expect(screen.getByTestId('transcript-language')).toHaveTextContent('UK')
    expect(screen.getByTestId('transcript-text')).toHaveTextContent('Що таке антигравітація?')
    expect(screen.getByTestId('question-candidate-badge')).toHaveTextContent('ВИЯВЛЕНО')
    expect(screen.getByTestId('question-confidence')).toHaveTextContent('90%')
    expect(screen.getByTestId('question-text')).toHaveTextContent('Що таке антигравітація?')
  })

  it('flushes transcription state on stopSession', async () => {
    window.api.getSessionState = vi.fn(async () => ({ status: 'active' as const }))
    window.api.stopSession = vi.fn(async () => ({ success: true, status: 'idle' as const }))

    await act(async () => {
      render(<App />)
    })

    // Populate transcription state
    await act(async () => {
      transcriptionListener?.({
        latestSegment: {
          id: 'seg-101',
          source: 'mic',
          startTimestamp: 1700000000000,
          endTimestamp: 1700000003000,
          text: 'Що таке антигравітація?',
          language: 'uk',
          confidence: 0.95,
          isFinal: true
        },
        latestQuestion: {
          id: 'q-101',
          segmentId: 'seg-101',
          source: 'mic',
          timestamp: 1700000003000,
          text: 'Що таке антигравітація?',
          language: 'uk',
          confidence: 0.9,
          status: 'detected'
        },
        segmentCount: 1,
        questionCount: 1,
        isTranscribing: false
      })
    })

    expect(screen.getByTestId('transcript-text')).toHaveTextContent('Що таке антигравітація?')

    const stopBtn = screen.getByRole('button', { name: /Зупинити/i })
    await act(async () => {
      fireEvent.click(stopBtn)
    })

    expect(window.api.stopSession).toHaveBeenCalled()
    expect(screen.getByTestId('transcript-empty')).toHaveTextContent('Очікування мовлення...')
    expect(screen.getByTestId('question-empty')).toHaveTextContent('Питань не виявлено')
  })

  it('displays assembled utterance, intent category, decision, route, contextUsed, and toggles opt-in semantic classifier', async () => {
    await act(async () => {
      render(<App />)
    })

    // Semantic classifier toggle is unchecked by default
    const classifierToggle = screen.getByTestId('toggle-semantic-classifier')
    expect(classifierToggle).not.toBeChecked()
    expect(screen.getByTestId('classifier-provider-status')).toHaveTextContent('LOCAL ONLY')

    // Enable opt-in semantic classifier
    await act(async () => {
      fireEvent.click(classifierToggle)
    })

    expect(window.api.setClassifierConfig).toHaveBeenCalledWith({
      enabled: true,
      userConsentGranted: true
    })
    expect(classifierToggle).toBeChecked()
    expect(screen.getByTestId('classifier-provider-status')).toHaveTextContent('KEY READY')

    // Emit assembled utterance and semantic intent evaluation
    await act(async () => {
      transcriptionListener?.({
        latestSegment: {
          id: 'seg-201',
          source: 'system',
          startTimestamp: 1700000010000,
          endTimestamp: 1700000012000,
          text: 'А другий варіант?',
          language: 'uk',
          isFinal: true
        },
        latestUtterance: {
          id: 'utt-201',
          source: 'system',
          startTimestamp: 1700000010000,
          endTimestamp: 1700000012000,
          text: 'А другий варіант?',
          normalizedText: 'а другий варіант',
          language: 'uk',
          segmentIds: ['seg-201'],
          fragmentCount: 1,
          isComplete: true,
          flushReason: 'sentence_boundary'
        },
        latestEvaluation: {
          utteranceId: 'utt-201',
          source: 'system',
          startTimestamp: 1700000010000,
          endTimestamp: 1700000012000,
          text: 'А другий варіант?',
          language: 'uk',
          intent: 'contextual_follow_up',
          decision: 'ready',
          route: 'openrouter',
          evidenceStrength: 'strong',
          requiresResponse: true,
          addressee: 'assistant_or_user',
          contextUsed: true,
          evidence: ['contextual_follow_up'],
          uncertain: false,
          latencyMs: 145
        },
        latestQuestion: {
          id: 'q-201',
          segmentId: 'utt-201',
          source: 'system',
          timestamp: 1700000012000,
          text: 'А другий варіант?',
          language: 'uk',
          confidence: 0.92,
          intent: 'contextual_follow_up',
          decision: 'ready',
          route: 'openrouter',
          contextUsed: true,
          status: 'ready'
        },
        segmentCount: 1,
        questionCount: 1,
        isTranscribing: false,
        isClassifying: true,
        semanticClassifier: {
          enabled: true,
          userConsentGranted: true,
          providerAvailable: true,
          configuredModel: 'google/gemini-3.1-flash-lite',
          zdrPreferred: true,
          requestCount: 1,
          maxRequests: 100,
          totalSpentUsd: 0.00008,
          budgetUsd: 0.25,
          lastError: 'timeout'
        }
      })
    })

    expect(screen.getByTestId('classifier-active-indicator')).toHaveTextContent('АНАЛІЗ НАМІРУ...')
    expect(screen.getByTestId('transcript-source')).toHaveTextContent('SYSTEM')
    expect(screen.getByTestId('transcript-language')).toHaveTextContent('UK')
    expect(screen.getByTestId('intent-category')).toHaveTextContent('contextual_follow_up')
    expect(screen.getByTestId('intent-decision')).toHaveTextContent('READY')
    expect(screen.getByTestId('intent-route')).toHaveTextContent('semantic_classifier')
    expect(screen.getByTestId('intent-context-used')).toHaveTextContent('CONTEXT: YES')
    expect(screen.getByTestId('question-decision-badge')).toHaveTextContent('READY')
    expect(screen.getByTestId('classifier-last-error')).toHaveTextContent('timeout')
  })
})

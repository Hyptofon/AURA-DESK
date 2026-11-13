import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { App } from '../App'
import type { AudioSessionState } from '@/shared/contracts/audio'

describe('<App /> Component', () => {
  let audioStateListener: ((state: AudioSessionState) => void) | null = null

  beforeEach(() => {
    audioStateListener = null
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
      onAudioStateChanged: vi.fn((cb) => {
        audioStateListener = cb
        return () => {
          audioStateListener = null
        }
      }),
      stopSession: vi.fn(async () => ({ success: true, status: 'idle' as const }))
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

  it('renders session action buttons in disabled state initially', async () => {
    await act(async () => {
      render(<App />)
    })

    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    const pauseBtn = screen.getByRole('button', { name: /Пауза/i })
    const stopBtn = screen.getByRole('button', { name: /Зупинити/i })

    expect(startBtn).toBeDisabled()
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

  it('toggles microphone capture via checkbox', async () => {
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
  })

  it('toggles system audio capture via checkbox', async () => {
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

  it('rolls back mic checkbox state if setAudioConfig throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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

  it('rolls back system audio checkbox state if setAudioConfig throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
})

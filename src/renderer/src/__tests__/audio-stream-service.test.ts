import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AudioStreamService,
  float32ToInt16Pcm
} from '../services/audio-stream-service'

describe('AudioStreamService & PCM Conversion', () => {
  describe('float32ToInt16Pcm', () => {
    it('converts digital silence to zeros', () => {
      const input = new Float32Array([0, 0, 0, 0])
      const output = float32ToInt16Pcm(input)
      expect(Array.from(output)).toEqual([0, 0, 0, 0])
    })

    it('converts positive maximum 1.0 to 32767', () => {
      const input = new Float32Array([1.0])
      const output = float32ToInt16Pcm(input)
      expect(output[0]).toBe(32767)
    })

    it('converts negative maximum -1.0 to -32768', () => {
      const input = new Float32Array([-1.0])
      const output = float32ToInt16Pcm(input)
      expect(output[0]).toBe(-32768)
    })

    it('clamps out-of-range float values beyond [-1.0, 1.0]', () => {
      const input = new Float32Array([1.5, -2.0])
      const output = float32ToInt16Pcm(input)
      expect(output[0]).toBe(32767)
      expect(output[1]).toBe(-32768)
    })
  })

  describe('AudioStreamService Lifecycle', () => {
    let mockTrack: { stop: ReturnType<typeof vi.fn>; readyState: string }
    let mockStream: { getTracks: () => typeof mockTrack[]; active: boolean }
    let mockProcessor: {
      onaudioprocess: ((e: unknown) => void) | null
      connect: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }
    let mockAudioContext: {
      sampleRate: number
      createMediaStreamSource: ReturnType<typeof vi.fn>
      createScriptProcessor: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      destination: Record<string, unknown>
    }

    beforeEach(() => {
      mockTrack = { stop: vi.fn(), readyState: 'live' }
      mockStream = { getTracks: () => [mockTrack], active: true }

      mockProcessor = {
        onaudioprocess: null,
        connect: vi.fn(),
        disconnect: vi.fn()
      }

      mockAudioContext = {
        sampleRate: 16000,
        createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
        createScriptProcessor: vi.fn().mockReturnValue(mockProcessor),
        close: vi.fn().mockResolvedValue(undefined),
        destination: {}
      }

      // Mock AudioContext constructor
      // @ts-expect-error Mocking global AudioContext
      window.AudioContext = vi.fn().mockImplementation(() => mockAudioContext)

      // Mock navigator.mediaDevices
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
          getDisplayMedia: vi.fn().mockResolvedValue(mockStream)
        },
        writable: true,
        configurable: true
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('starts microphone stream and sets up audio processor', async () => {
      const service = new AudioStreamService()
      expect(service.isMicrophoneStreaming()).toBe(false)

      await service.startMicrophone()

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: true,
        video: false
      })
      expect(mockAudioContext.createScriptProcessor).toHaveBeenCalledWith(2048, 1, 1)
      expect(service.isMicrophoneStreaming()).toBe(true)

      await service.stopMicrophone()
      expect(mockTrack.stop).toHaveBeenCalled()
      expect(mockAudioContext.close).toHaveBeenCalled()
      expect(service.isMicrophoneStreaming()).toBe(false)
    })

    it('starts system loopback stream with 48000Hz stereo configuration', async () => {
      mockAudioContext.sampleRate = 48000
      const service = new AudioStreamService()

      await service.startSystemLoopback()

      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
        audio: true,
        video: false
      })
      expect(mockAudioContext.createScriptProcessor).toHaveBeenCalledWith(4096, 2, 2)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      await service.stopSystemLoopback()
      expect(mockTrack.stop).toHaveBeenCalled()
      expect(service.isSystemLoopbackStreaming()).toBe(false)
    })

    it('stopAll terminates both active streams cleanly', async () => {
      const service = new AudioStreamService()
      await service.startMicrophone()
      await service.startSystemLoopback()

      expect(service.isMicrophoneStreaming()).toBe(true)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      await service.stopAll()

      expect(service.isMicrophoneStreaming()).toBe(false)
      expect(service.isSystemLoopbackStreaming()).toBe(false)
    })
  })
})

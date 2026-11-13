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
    let mockAudioTrack: { stop: ReturnType<typeof vi.fn>; readyState: string }
    let mockVideoTrack: { stop: ReturnType<typeof vi.fn>; readyState: string }
    let mockStream: {
      getTracks: () => typeof mockAudioTrack[]
      getAudioTracks: () => typeof mockAudioTrack[]
      getVideoTracks: () => typeof mockVideoTrack[]
      removeTrack: ReturnType<typeof vi.fn>
      active: boolean
    }
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
      mockAudioTrack = { stop: vi.fn(), readyState: 'live' }
      mockVideoTrack = { stop: vi.fn(), readyState: 'live' }
      mockStream = {
        getTracks: () => [mockAudioTrack, mockVideoTrack],
        getAudioTracks: () => [mockAudioTrack],
        getVideoTracks: () => [mockVideoTrack],
        removeTrack: vi.fn(),
        active: true
      }

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
      ;(window as unknown as { AudioContext: unknown }).AudioContext = vi
        .fn()
        .mockImplementation(() => mockAudioContext)

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
      expect(mockAudioTrack.stop).toHaveBeenCalled()
      expect(mockAudioContext.close).toHaveBeenCalled()
      expect(service.isMicrophoneStreaming()).toBe(false)
    })

    it('starts system loopback stream with { video: true, audio: true } and discards video track immediately', async () => {
      mockAudioContext.sampleRate = 48000
      const service = new AudioStreamService()

      await service.startSystemLoopback()

      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
        video: true,
        audio: true
      })
      // Video track must be stopped and removed immediately to protect user privacy
      expect(mockVideoTrack.stop).toHaveBeenCalledTimes(1)
      expect(mockStream.removeTrack).toHaveBeenCalledWith(mockVideoTrack)
      expect(mockAudioContext.createScriptProcessor).toHaveBeenCalledWith(4096, 2, 2)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      await service.stopSystemLoopback()
      expect(mockAudioTrack.stop).toHaveBeenCalled()
      expect(service.isSystemLoopbackStreaming()).toBe(false)
    })

    it('throws error and stops all tracks if no live audio track is returned by getDisplayMedia', async () => {
      const emptyAudioStream = {
        getTracks: () => [mockVideoTrack],
        getAudioTracks: () => [],
        getVideoTracks: () => [mockVideoTrack],
        removeTrack: vi.fn(),
        active: true
      }
      vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(
        emptyAudioStream as never
      )

      const service = new AudioStreamService()
      await expect(service.startSystemLoopback()).rejects.toThrow(
        /No live audio track received for system loopback/
      )
      expect(mockVideoTrack.stop).toHaveBeenCalled()
      expect(service.isSystemLoopbackStreaming()).toBe(false)
    })

    it('pauseAll terminates both active streams and hardware tracks cleanly', async () => {
      const service = new AudioStreamService()
      await service.startMicrophone()
      await service.startSystemLoopback()

      expect(service.isMicrophoneStreaming()).toBe(true)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      await service.pauseAll()

      expect(service.isMicrophoneStreaming()).toBe(false)
      expect(service.isSystemLoopbackStreaming()).toBe(false)
      expect(mockAudioTrack.stop).toHaveBeenCalled()
    })

    it('cancels delayed stream acquisition if stopAll is called in-flight', async () => {
      let resolveUserMedia: (stream: typeof mockStream) => void
      const slowUserMedia = new Promise<typeof mockStream>((resolve) => {
        resolveUserMedia = resolve
      })
      vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
        slowUserMedia as never
      )

      const service = new AudioStreamService()
      const startPromise = service.startMicrophone()

      // Stop while start is pending
      await service.stopAll()

      // Late resolve
      resolveUserMedia!(mockStream)

      await expect(startPromise).rejects.toThrow(/Microphone acquisition was cancelled/)
      expect(mockAudioTrack.stop).toHaveBeenCalled()
      expect(service.isMicrophoneStreaming()).toBe(false)
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

    it('starts microphone and system loopback concurrently without cancelling each other', async () => {
      const service = new AudioStreamService()

      // Start both concurrently (simulating user checking both and starting session)
      const [micResult, sysResult] = await Promise.allSettled([
        service.startMicrophone(),
        service.startSystemLoopback()
      ])

      expect(micResult.status).toBe('fulfilled')
      expect(sysResult.status).toBe('fulfilled')
      expect(service.isMicrophoneStreaming()).toBe(true)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      await service.stopAll()
      expect(service.isMicrophoneStreaming()).toBe(false)
      expect(service.isSystemLoopbackStreaming()).toBe(false)
    })

    it('isolated lifecycle: stopping or restarting one audio source does not affect the active state of the other', async () => {
      const service = new AudioStreamService()
      await service.startMicrophone()
      await service.startSystemLoopback()

      expect(service.isMicrophoneStreaming()).toBe(true)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      // Stop mic: system loopback must remain streaming and active
      await service.stopMicrophone()
      expect(service.isMicrophoneStreaming()).toBe(false)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      // Restart mic: both should now be active
      await service.startMicrophone()
      expect(service.isMicrophoneStreaming()).toBe(true)
      expect(service.isSystemLoopbackStreaming()).toBe(true)

      // Stop system loopback: mic must remain streaming and active
      await service.stopSystemLoopback()
      expect(service.isMicrophoneStreaming()).toBe(true)
      expect(service.isSystemLoopbackStreaming()).toBe(false)

      await service.stopAll()
      expect(service.isMicrophoneStreaming()).toBe(false)
      expect(service.isSystemLoopbackStreaming()).toBe(false)
    })
  })
})

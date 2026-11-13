/**
 * Audio Stream Service running in the renderer process.
 * Acquires live MediaStreams from Chromium (mic via getUserMedia, system loopback via getDisplayMedia),
 * converts Float32 audio samples to 16-bit PCM, and submits chunks to the main process via IPC.
 */

export interface AudioStreamClient {
  startMicrophone(deviceId?: string): Promise<void>
  stopMicrophone(): Promise<void>
  startSystemLoopback(): Promise<void>
  stopSystemLoopback(): Promise<void>
  pauseAll(): Promise<void>
  stopAll(): Promise<void>
  isMicrophoneStreaming(): boolean
  isSystemLoopbackStreaming(): boolean
}

export function float32ToInt16Pcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return output
}

export class AudioStreamService implements AudioStreamClient {
  private micGeneration = 0
  private systemGeneration = 0

  private micStream: MediaStream | null = null
  private micAudioContext: AudioContext | null = null
  private micProcessor: ScriptProcessorNode | null = null

  private systemStream: MediaStream | null = null
  private systemAudioContext: AudioContext | null = null
  private systemProcessor: ScriptProcessorNode | null = null

  async startMicrophone(deviceId?: string): Promise<void> {
    if (this.micStream) return

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('navigator.mediaDevices.getUserMedia is not supported')
    }

    const currentGen = ++this.micGeneration
    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)

    // Abort and stop tracks if teardown/pause was triggered while acquisition was in-flight
    if (this.micGeneration !== currentGen) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      throw new Error('Microphone acquisition was cancelled')
    }

    this.micStream = stream

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const audioContext = new AudioContextClass({ sampleRate: 16000 })
    this.micAudioContext = audioContext

    const source = audioContext.createMediaStreamSource(stream)
    // 2048 samples at 16000Hz is 128ms per chunk
    const processor = audioContext.createScriptProcessor(2048, 1, 1)
    this.micProcessor = processor

    processor.onaudioprocess = (e) => {
      if (!this.micStream) return
      const channelData = e.inputBuffer.getChannelData(0)
      const pcm16 = float32ToInt16Pcm(channelData)
      const data = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
      const durationMs = (pcm16.length / audioContext.sampleRate) * 1000

      if (window.api?.submitAudioChunk) {
        void window.api
          .submitAudioChunk({
            source: 'mic',
            data,
            timestamp: Date.now(),
            durationMs,
            sampleRate: audioContext.sampleRate,
            channels: 1
          })
          .catch((err) => {
            console.error('Failed to submit mic audio chunk:', err)
          })
      }
    }

    source.connect(processor)
    processor.connect(audioContext.destination)
  }

  async stopMicrophone(): Promise<void> {
    ++this.micGeneration

    if (this.micProcessor) {
      this.micProcessor.onaudioprocess = null
      this.micProcessor.disconnect()
      this.micProcessor = null
    }

    if (this.micAudioContext) {
      try {
        await this.micAudioContext.close()
      } catch {
        // Ignored
      }
      this.micAudioContext = null
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop())
      this.micStream = null
    }
  }

  async startSystemLoopback(): Promise<void> {
    if (this.systemStream) return

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('navigator.mediaDevices.getDisplayMedia is not supported')
    }

    const currentGen = ++this.systemGeneration

    // Chromium/Electron getDisplayMedia requires video: true even for audio loopback.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    })

    // Abort and stop all tracks if teardown/pause was triggered while acquisition was in-flight
    if (this.systemGeneration !== currentGen) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      throw new Error('System loopback acquisition was cancelled')
    }

    // Verify a live audio track is present
    const audioTracks = stream.getAudioTracks()
    const audioTrack = audioTracks[0]
    if (!audioTrack || audioTrack.readyState !== 'live') {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      throw new Error('No live audio track received for system loopback')
    }

    // Immediately stop and discard any temporary video tracks required by getDisplayMedia
    for (const videoTrack of stream.getVideoTracks()) {
      videoTrack.stop()
      stream.removeTrack(videoTrack)
    }

    this.systemStream = stream

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const audioContext = new AudioContextClass({ sampleRate: 48000 })
    this.systemAudioContext = audioContext

    const source = audioContext.createMediaStreamSource(stream)
    // 4096 samples at 48000Hz is ~85.3ms per chunk
    const processor = audioContext.createScriptProcessor(4096, 2, 2)
    this.systemProcessor = processor

    processor.onaudioprocess = (e) => {
      if (!this.systemStream) return
      // Extract left and right channels and interleave to 16-bit PCM stereo
      const left = e.inputBuffer.getChannelData(0)
      const right = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : left
      const interleaved = new Int16Array(left.length * 2)

      for (let i = 0; i < left.length; i++) {
        const sl = Math.max(-1, Math.min(1, left[i]))
        const sr = Math.max(-1, Math.min(1, right[i]))
        interleaved[i * 2] = sl < 0 ? sl * 0x8000 : sl * 0x7fff
        interleaved[i * 2 + 1] = sr < 0 ? sr * 0x8000 : sr * 0x7fff
      }

      const data = new Uint8Array(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength)
      const durationMs = (left.length / audioContext.sampleRate) * 1000

      if (window.api?.submitAudioChunk) {
        void window.api
          .submitAudioChunk({
            source: 'system',
            data,
            timestamp: Date.now(),
            durationMs,
            sampleRate: audioContext.sampleRate,
            channels: 2
          })
          .catch((err) => {
            console.error('Failed to submit system loopback audio chunk:', err)
          })
      }
    }

    source.connect(processor)
    processor.connect(audioContext.destination)
  }

  async stopSystemLoopback(): Promise<void> {
    ++this.systemGeneration

    if (this.systemProcessor) {
      this.systemProcessor.onaudioprocess = null
      this.systemProcessor.disconnect()
      this.systemProcessor = null
    }

    if (this.systemAudioContext) {
      try {
        await this.systemAudioContext.close()
      } catch {
        // Ignored
      }
      this.systemAudioContext = null
    }

    if (this.systemStream) {
      this.systemStream.getTracks().forEach((track) => track.stop())
      this.systemStream = null
    }
  }

  async pauseAll(): Promise<void> {
    ++this.micGeneration
    ++this.systemGeneration
    const results = await Promise.allSettled([this.stopMicrophone(), this.stopSystemLoopback()])
    const failure = results.find((r) => r.status === 'rejected')
    if (failure && failure.status === 'rejected') {
      throw failure.reason
    }
  }

  async stopAll(): Promise<void> {
    ++this.micGeneration
    ++this.systemGeneration
    const results = await Promise.allSettled([this.stopMicrophone(), this.stopSystemLoopback()])
    const failure = results.find((r) => r.status === 'rejected')
    if (failure && failure.status === 'rejected') {
      throw failure.reason
    }
  }

  isMicrophoneStreaming(): boolean {
    return this.micStream !== null && this.micStream.active
  }

  isSystemLoopbackStreaming(): boolean {
    return this.systemStream !== null && this.systemStream.active
  }
}

export const defaultAudioStreamService = new AudioStreamService()

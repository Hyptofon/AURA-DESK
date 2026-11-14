import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  WhisperCppSttProvider,
  detectTranscriptLanguage
} from '@/main/transcription/whisper-cpp-provider'
import { createSyntheticAudioBuffer } from '../../test/fixtures/stt-fixtures'

class MockChildProcess extends EventEmitter {
  public pid = 12345
  public stdout = new EventEmitter()
  public stderr = new EventEmitter()
  public kill = vi.fn()
}

describe('WhisperCppSttProvider', () => {
  let mockChild: MockChildProcess
  let mockSpawner: ReturnType<typeof vi.fn>
  let testTempDir: string
  let mockExePath: string
  let mockModelPath: string

  beforeEach(() => {
    mockChild = new MockChildProcess()
    mockSpawner = vi.fn().mockReturnValue(mockChild)
    testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-test-whisper-'))

    mockExePath = path.join(testTempDir, 'whisper-cli.exe')
    mockModelPath = path.join(testTempDir, 'ggml-base.bin')
    fs.writeFileSync(mockExePath, 'mock-binary')
    fs.writeFileSync(mockModelPath, 'mock-model')
  })

  async function waitForSpawner(spawner: ReturnType<typeof vi.fn>, timeoutMs = 3000): Promise<void> {
    const start = Date.now()
    while (spawner.mock.calls.length === 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for processSpawner to be invoked')
      }
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  afterEach(() => {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true })
    } catch {
      // Ignored
    }
  })

  it('spawns STT subprocess and returns parsed transcript result', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: mockExePath,
      modelPath: mockModelPath,
      processSpawner: mockSpawner,
      tempDir: testTempDir
    })

    const audio = createSyntheticAudioBuffer({
      durationMs: 1000,
      source: 'mic',
      startTimestamp: 1700000000000
    })

    const promise = provider.transcribe({ audio, language: 'uk' })

    await waitForSpawner(mockSpawner)

    expect(mockSpawner).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockSpawner.mock.calls[0]
    expect(cmd).toBe(mockExePath)
    expect(args).toContain('-m')
    expect(args).toContain(mockModelPath)
    expect(args).toContain('-l')
    expect(args).toContain('uk')

    // Simulate stdout with timestamp brackets and close event
    mockChild.stdout.emit(
      'data',
      Buffer.from('[00:00:00.000 --> 00:00:01.000] Що таке алгоритм сортування?\n')
    )
    mockChild.emit('close', 0)

    const result = await promise
    expect(result.text).toBe('Що таке алгоритм сортування?')
    expect(result.language).toBe('uk')
    expect(result.segments).toHaveLength(1)
    expect(result.segments![0].source).toBe('mic')
    expect(result.segments![0].startTimestamp).toBe(1700000000000)
    expect(result.segments![0].endTimestamp).toBe(1700000001000)
  })

  it('guarantees temporary WAV files are removed after transcription completes', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: mockExePath,
      modelPath: mockModelPath,
      processSpawner: mockSpawner,
      tempDir: testTempDir
    })

    const audio = createSyntheticAudioBuffer()
    const promise = provider.transcribe({ audio })

    await waitForSpawner(mockSpawner)

    mockChild.stdout.emit('data', Buffer.from('Done.'))
    mockChild.emit('close', 0)
    await promise

    // Verify temp directory has zero remaining .wav files
    const remaining = fs.readdirSync(testTempDir).filter((f) => f.endsWith('.wav'))
    expect(remaining).toHaveLength(0)
  })

  it('aborts and terminates child process when abort signal triggers', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: mockExePath,
      modelPath: mockModelPath,
      processSpawner: mockSpawner,
      tempDir: testTempDir
    })

    const controller = new AbortController()
    const audio = createSyntheticAudioBuffer()

    const promise = provider.transcribe({ audio, signal: controller.signal })

    await waitForSpawner(mockSpawner)

    // Trigger abort while in-flight
    controller.abort()

    await expect(promise).rejects.toThrow(/aborted/)
  })

  it('rejects concurrent requests while a transcription is active', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: mockExePath,
      modelPath: mockModelPath,
      processSpawner: mockSpawner,
      tempDir: testTempDir
    })

    const audio = createSyntheticAudioBuffer()
    const promise1 = provider.transcribe({ audio })

    // Immediate second call should be rejected
    await expect(provider.transcribe({ audio })).rejects.toThrow(/STT engine is busy/)

    await waitForSpawner(mockSpawner)

    mockChild.stdout.emit('data', Buffer.from('Done'))
    mockChild.emit('close', 0)
    await promise1
  })

  it('throws descriptive error on subprocess non-zero exit code', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: mockExePath,
      modelPath: mockModelPath,
      processSpawner: mockSpawner,
      tempDir: testTempDir
    })

    const audio = createSyntheticAudioBuffer()
    const promise = provider.transcribe({ audio })

    await waitForSpawner(mockSpawner)

    mockChild.stderr.emit('data', Buffer.from('CUDA out of memory'))
    mockChild.emit('close', 1)

    await expect(promise).rejects.toThrow(/STT process exited with code 1[\s\S]*CUDA out of memory/)
  })

  it('fails closed when executable and model are not found and fallback is disabled', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: 'nonexistent-whisper.exe',
      modelPath: 'nonexistent-model.bin',
      pythonFallback: false,
      tempDir: testTempDir
    })

    const audio = createSyntheticAudioBuffer()
    await expect(provider.transcribe({ audio })).rejects.toThrow(/Local Whisper STT engine is not available/)
  })

  it('disallows transcription after dispose()', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: mockExePath,
      modelPath: mockModelPath,
      tempDir: testTempDir
    })
    provider.dispose()

    const audio = createSyntheticAudioBuffer()
    await expect(provider.transcribe({ audio })).rejects.toThrow(/disposed/)
  })

  it('reads python whisper output from basename txt and filters stdout banners', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: undefined,
      modelPath: undefined,
      pythonFallback: true,
      processSpawner: mockSpawner,
      tempDir: testTempDir
    })

    const audio = createSyntheticAudioBuffer()
    const promise = provider.transcribe({ audio, language: 'en' })

    await waitForSpawner(mockSpawner)

    expect(mockSpawner).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockSpawner.mock.calls[0]
    expect(cmd).toBe('py')
    expect(args).toContain('whisper')

    // Find the generated WAV file name to simulate python whisper creating <basename>.txt
    const wavFiles = fs.readdirSync(testTempDir).filter((f) => f.endsWith('.wav'))
    expect(wavFiles.length).toBe(1)
    const baseName = path.parse(wavFiles[0]).name
    const pythonTxt = path.join(testTempDir, `${baseName}.txt`)
    fs.writeFileSync(pythonTxt, 'What does this function do?')

    mockChild.stdout.emit('data', Buffer.from('Detecting language using first 30s\n100%|██████████| 156/156\n'))
    mockChild.emit('close', 0)

    const result = await promise
    expect(result.text).toBe('What does this function do?')

    // Verify pythonTxt was cleaned up
    expect(fs.existsSync(pythonTxt)).toBe(false)
  })

  it('does not default automatic-language results to Ukrainian when English or mixed text is returned', async () => {
    const provider = new WhisperCppSttProvider({
      executablePath: mockExePath,
      modelPath: mockModelPath,
      processSpawner: mockSpawner,
      tempDir: testTempDir
    })

    const audio = createSyntheticAudioBuffer()
    const promise = provider.transcribe({ audio, language: 'auto' })

    await waitForSpawner(mockSpawner)

    mockChild.stdout.emit(
      'data',
      Buffer.from('[00:00:00.000 --> 00:00:01.200] How does the event loop handle promises?\n')
    )
    mockChild.emit('close', 0)

    const result = await promise
    expect(result.language).toBe('en')
    expect(result.segments?.[0].language).toBe('en')
  })

  it('conservatively attributes uk, en, mixed, and unknown in detectTranscriptLanguage', () => {
    expect(detectTranscriptLanguage('Поясни, як працює черга повідомлень.')).toBe('uk')
    expect(detectTranscriptLanguage('How does the message queue work?')).toBe('en')
    expect(detectTranscriptLanguage('Як працює useEffect cleanup у React компоненті?')).toBe(
      'mixed'
    )
    expect(detectTranscriptLanguage('12345 ... ???')).toBe('unknown')
  })
})

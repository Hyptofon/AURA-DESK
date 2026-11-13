/**
 * Local Speech-to-Text Provider using whisper.cpp (with Python Whisper fallback).
 * Converts live PCM audio to standard 16kHz mono WAV, manages subprocess lifecycle,
 * enforces cancellation and timeout, guarantees temporary file teardown, and extracts text.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {
  SpeechToTextProvider,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptSegment
} from '@/shared/contracts/transcription'
import { prepareAudioForStt } from './audio-resampler'
import { encodePcm16ToWav } from './wav-encoder'

export interface WhisperCppOptions {
  id?: string
  name?: string
  executablePath?: string
  modelPath?: string
  pythonFallback?: boolean
  timeoutMs?: number
  tempDir?: string
  processSpawner?: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess
}

export class WhisperCppSttProvider implements SpeechToTextProvider {
  public readonly id: string
  public readonly name: string

  private executablePath: string | null
  private modelPath: string | null
  private pythonFallback: boolean
  private timeoutMs: number
  private tempDir: string
  private spawner: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess

  private isTranscribing = false
  private isDisposed = false
  private currentChild: ChildProcess | null = null

  constructor(options: WhisperCppOptions = {}) {
    this.id = options.id ?? 'whisper-cpp'
    this.name = options.name ?? 'Local whisper.cpp STT Engine'
    this.executablePath = options.executablePath ?? process.env['AURA_WHISPER_PATH'] ?? null
    this.modelPath = options.modelPath ?? process.env['AURA_WHISPER_MODEL'] ?? null
    this.pythonFallback = options.pythonFallback ?? true
    this.timeoutMs = options.timeoutMs ?? 30000
    this.tempDir = options.tempDir ?? os.tmpdir()
    this.spawner = options.processSpawner ?? (spawn as unknown as typeof this.spawner)
  }

  public async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    if (this.isDisposed) {
      throw new Error('WhisperCppSttProvider is disposed')
    }

    if (this.isTranscribing) {
      throw new Error('STT engine is busy: concurrent transcription request rejected')
    }

    if (request.signal?.aborted) {
      throw new Error('Transcription request was aborted')
    }

    if (!request.audio || !request.audio.data || request.audio.data.length === 0) {
      throw new Error('Invalid audio: empty or missing PCM buffer')
    }

    this.isTranscribing = true

    // Step 1: Normalize audio to 16kHz mono PCM
    const sttAudio = prepareAudioForStt(request.audio, 16000)
    const wavBuffer = encodePcm16ToWav(sttAudio)

    // Step 2: Write ephemeral temporary WAV file
    const runId = `aura-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const tempWavPath = path.join(this.tempDir, `${runId}.wav`)
    const tempOutputBase = path.join(this.tempDir, `${runId}-out`)
    const tempTxtPath = `${tempOutputBase}.txt`
    const pythonTxtPath = path.join(this.tempDir, `${runId}.txt`)

    try {
      await fs.promises.writeFile(tempWavPath, wavBuffer)

      // Step 3: Resolve execution command
      const execPlan = this.resolveExecutionPlan(tempWavPath, tempOutputBase, request.language)

      // Step 4: Run inference subprocess
      const rawOutput = await this.runSubprocess(execPlan.command, execPlan.args, request.signal)

      // Step 5: Read recognized text
      let recognizedText = ''
      if (fs.existsSync(tempTxtPath)) {
        recognizedText = await fs.promises.readFile(tempTxtPath, 'utf8')
      } else if (fs.existsSync(pythonTxtPath)) {
        recognizedText = await fs.promises.readFile(pythonTxtPath, 'utf8')
      } else {
        recognizedText = rawOutput
      }

      const cleanedText = this.cleanTranscriptOutput(recognizedText)

      const lang = request.language === 'en' ? 'en' : 'uk'
      const durationMs = (sttAudio.data.length / sttAudio.sampleRate) * 1000

      const segment: TranscriptSegment = {
        id: `seg-${runId}`,
        source: request.audio.source,
        startTimestamp: request.audio.startTimestamp,
        endTimestamp: request.audio.endTimestamp,
        text: cleanedText,
        language: lang,
        confidence: 0.9,
        isFinal: true
      }

      return {
        text: cleanedText,
        language: lang,
        confidence: 0.9,
        segments: [segment],
        durationMs
      }
    } finally {
      this.isTranscribing = false
      this.currentChild = null

      // Guaranteed ephemeral cleanup: delete audio and all transcript formats immediately
      this.safeUnlink(tempWavPath)
      this.safeUnlink(tempTxtPath)
      this.safeUnlink(pythonTxtPath)
      this.safeUnlink(`${tempOutputBase}.json`)
      this.safeUnlink(`${tempOutputBase}.tsv`)
      this.safeUnlink(`${tempOutputBase}.vtt`)
      this.safeUnlink(`${tempOutputBase}.srt`)
      this.safeUnlink(path.join(this.tempDir, `${runId}.json`))
      this.safeUnlink(path.join(this.tempDir, `${runId}.tsv`))
      this.safeUnlink(path.join(this.tempDir, `${runId}.vtt`))
      this.safeUnlink(path.join(this.tempDir, `${runId}.srt`))
    }
  }

  public dispose(): void {
    this.isDisposed = true
    if (this.currentChild) {
      this.terminateChild(this.currentChild)
      this.currentChild = null
    }
  }

  private resolveExecutionPlan(
    wavPath: string,
    outputBase: string,
    language?: string
  ): { command: string; args: string[] } {
    const lang = language === 'en' ? 'en' : language === 'uk' ? 'uk' : 'auto'

    // Priority 1: Direct whisper.cpp executable
    if (this.executablePath && fs.existsSync(this.executablePath)) {
      if (!this.modelPath || !fs.existsSync(this.modelPath)) {
        throw new Error(
          `whisper.cpp executable found at "${this.executablePath}", but model file was not found at "${this.modelPath}". Please configure AURA_WHISPER_MODEL.`
        )
      }
      return {
        command: this.executablePath,
        args: [
          '-m',
          this.modelPath,
          '-f',
          wavPath,
          '-l',
          lang,
          '-nt',
          '--output-txt',
          '--output-file',
          outputBase
        ]
      }
    }

    // Priority 2: Python Whisper fallback
    if (this.pythonFallback) {
      const model = this.modelPath ?? 'tiny'
      return {
        command: 'py',
        args: [
          '-3',
          '-m',
          'whisper',
          wavPath,
          '--model',
          model,
          '--language',
          lang === 'auto' ? 'uk' : lang,
          '--output_format',
          'txt',
          '--output_dir',
          path.dirname(outputBase)
        ]
      }
    }

    throw new Error(
      'Local Whisper STT engine is not available. Please install whisper.cpp binary or enable Python whisper fallback.'
    )
  }

  private runSubprocess(
    command: string,
    args: string[],
    signal?: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdoutData = ''
      let stderrData = ''
      let isSettled = false

      const child = this.spawner(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.currentChild = child

      const timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true
          this.terminateChild(child)
          reject(new Error(`STT inference timed out after ${this.timeoutMs}ms`))
        }
      }, this.timeoutMs)

      const onAbort = (): void => {
        if (!isSettled) {
          isSettled = true
          clearTimeout(timeoutTimer)
          this.terminateChild(child)
          reject(new Error('Transcription request was aborted'))
        }
      }

      if (signal) {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout?.on('data', (chunk) => {
        stdoutData += chunk.toString()
      })

      child.stderr?.on('data', (chunk) => {
        stderrData += chunk.toString()
      })

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true
          clearTimeout(timeoutTimer)
          if (signal) signal.removeEventListener('abort', onAbort)
          reject(new Error(`Failed to spawn STT process "${command}": ${err.message}`))
        }
      })

      child.on('close', (code) => {
        if (!isSettled) {
          isSettled = true
          clearTimeout(timeoutTimer)
          if (signal) signal.removeEventListener('abort', onAbort)

          if (code === 0) {
            resolve(stdoutData)
          } else {
            reject(
              new Error(
                `STT process exited with code ${code}. Stderr: ${stderrData.trim() || 'none'}`
              )
            )
          }
        }
      })
    })
  }

  private terminateChild(child: ChildProcess): void {
    try {
      if (process.platform === 'win32' && child.pid) {
        // Taskkill ensures the full process tree is terminated on Windows
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
        killer.on('error', () => {
          try {
            child.kill('SIGTERM')
          } catch {
            // Ignored
          }
        })
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      // Ignored
    }
  }

  private cleanTranscriptOutput(raw: string): string {
    return raw
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, '')
          .replace(/\[\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}\]/g, '')
          .trim()
      )
      .filter((line) => {
        if (!line) return false
        if (/^\[\d{2}:\d{2}/.test(line)) return false
        if (/whisper_/i.test(line)) return false
        if (/detecting language/i.test(line)) return false
        if (/^[\d%|█ -]+$/.test(line)) return false
        return true
      })
      .join(' ')
      .trim()
  }

  private safeUnlink(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // Ignored
    }
  }
}

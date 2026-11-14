/**
 * Privileged Main-Process OpenRouter API Key Store.
 * Safely loads OPENROUTER_API_KEY from environment or local .env file exclusively in the
 * Electron main process, optionally encrypting in-memory storage via Electron safeStorage,
 * and scrubs secret tokens from error messages and diagnostics.
 *
 * SECURITY INVARIANT: Never import in preload or renderer, never expose raw key via IPC,
 * and never log or print the key value.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface OpenRouterKeyStoreOptions {
  envFilePath?: string
  env?: Record<string, string | undefined>
  safeStorage?: SafeStorageLike | null
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string
  existsSync?: (filePath: string) => boolean
}

const SECRET_TOKEN_REGEX = /\bsk-or-(?:v1-)?[a-zA-Z0-9_-]{8,}\b/g
const GENERIC_BEARER_REGEX = /\bBearer\s+[a-zA-Z0-9._\-]{10,}\b/gi

/**
 * Redacts OpenRouter API keys and Bearer tokens from any diagnostic or error message.
 */
export function redactSecrets(input: string, explicitSecret?: string | null): string {
  if (!input) return ''
  let sanitized = input
    .replace(SECRET_TOKEN_REGEX, '[REDACTED_OPENROUTER_KEY]')
    .replace(GENERIC_BEARER_REGEX, 'Bearer [REDACTED_TOKEN]')

  if (explicitSecret && explicitSecret.trim().length >= 6) {
    const trimmed = explicitSecret.trim()
    if (sanitized.includes(trimmed)) {
      sanitized = sanitized.split(trimmed).join('[REDACTED_OPENROUTER_KEY]')
    }
  }
  return sanitized
}

/**
 * Parses OPENROUTER_API_KEY from .env file content without logging or mutating global process.env.
 */
export function parseOpenRouterKeyFromDotEnv(content: string): string | null {
  const lines = content.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = line.match(/^(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.+)$/)
    if (match?.[1]) {
      let value = match[1].trim()
      const doubleQuoted = value.match(/^"([^"]*)"(?:\s*#.*)?$/)
      const singleQuoted = value.match(/^'([^']*)'(?:\s*#.*)?$/)
      if (doubleQuoted) {
        value = doubleQuoted[1].trim()
      } else if (singleQuoted) {
        value = singleQuoted[1].trim()
      } else {
        const hashIdx = value.indexOf(' #')
        if (hashIdx !== -1) {
          value = value.slice(0, hashIdx).trim()
        }
      }
      if (value.length > 0) {
        return value
      }
    }
  }
  return null
}

export class OpenRouterKeyStore {
  private readonly envFilePath: string
  private readonly envSource: Record<string, string | undefined>
  private readonly safeStorage: SafeStorageLike | null
  private readonly readFileSyncFn: (filePath: string, encoding: BufferEncoding) => string
  private readonly existsSyncFn: (filePath: string) => boolean

  private encryptedKey: Buffer | null = null
  private fallbackKey: string | null = null
  private loaded = false

  constructor(options: OpenRouterKeyStoreOptions = {}) {
    this.envFilePath = options.envFilePath ?? path.resolve(process.cwd(), '.env')
    this.envSource = options.env ?? process.env
    this.safeStorage = options.safeStorage ?? null
    this.readFileSyncFn = options.readFileSync ?? fs.readFileSync
    this.existsSyncFn = options.existsSync ?? fs.existsSync
  }

  /**
   * Returns true if a valid non-empty OpenRouter API key is configured.
   * Safe for status diagnostics (never returns the key itself).
   */
  public hasApiKey(): boolean {
    const key = this.getApiKey()
    return Boolean(key && key.length >= 8)
  }

  /**
   * Retrieves the API key strictly for main-process HTTPS authorization headers.
   * Never expose the return value outside the main-process request builder.
   */
  public getApiKey(): string | null {
    if (!this.loaded) {
      this.loadKey()
    }

    if (this.encryptedKey && this.safeStorage) {
      try {
        return this.safeStorage.decryptString(this.encryptedKey)
      } catch {
        return null
      }
    }

    return this.fallbackKey
  }

  /**
   * Scrubs any occurrence of the configured key or OpenRouter token format from an error string.
   */
  public sanitizeErrorMessage(message: string): string {
    const rawKey = this.loaded ? this.getApiKey() : null
    return redactSecrets(message, rawKey)
  }

  /**
   * Clears in-memory key cache.
   */
  public clear(): void {
    if (this.encryptedKey) {
      this.encryptedKey.fill(0)
      this.encryptedKey = null
    }
    this.fallbackKey = null
    this.loaded = false
  }

  private loadKey(): void {
    this.loaded = true
    let resolvedKey: string | null = null

    const fromEnv = this.envSource['OPENROUTER_API_KEY']?.trim()
    if (fromEnv && fromEnv.length > 0) {
      resolvedKey = fromEnv
    } else {
      try {
        if (this.existsSyncFn(this.envFilePath)) {
          const content = this.readFileSyncFn(this.envFilePath, 'utf8')
          resolvedKey = parseOpenRouterKeyFromDotEnv(content)
        }
      } catch {
        resolvedKey = null
      }
    }

    if (!resolvedKey) {
      this.encryptedKey = null
      this.fallbackKey = null
      return
    }

    if (this.safeStorage) {
      try {
        if (this.safeStorage.isEncryptionAvailable()) {
          this.encryptedKey = this.safeStorage.encryptString(resolvedKey)
          this.fallbackKey = null
          return
        }
      } catch {
        // Fall through to in-memory main-process reference if OS safeStorage is unavailable in CLI/test
      }
    }

    this.fallbackKey = resolvedKey
  }
}

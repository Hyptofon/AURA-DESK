import { shell } from 'electron'

export interface NavigationGuardOptions {
  isDev: boolean
  rendererUrl?: string
  expectedHtmlPath: string
}

/**
 * Validates whether an in-app navigation URL is authorized.
 * Development: Only the actual dev server origin (from ELECTRON_RENDERER_URL or localhost:5173).
 * Production: Only the exact application document file path.
 * Forbids: arbitrary file: URLs, third-party origins, javascript:, data:.
 */
export function isAllowedNavigation(
  rawUrl: string,
  options: NavigationGuardOptions
): boolean {
  try {
    const parsed = new URL(rawUrl)

    if (options.isDev) {
      const trustedOrigin = options.rendererUrl
        ? new URL(options.rendererUrl).origin
        : 'http://localhost:5173'
      return parsed.origin === trustedOrigin
    }

    // Production mode: must strictly match expected application file URL
    if (parsed.protocol !== 'file:') {
      return false
    }

    const expected = new URL(options.expectedHtmlPath)
    const normalizePath = (p: string): string => decodeURIComponent(p).toLowerCase().replace(/\\/g, '/')
    const normalizeHost = (h: string): string => h.toLowerCase()

    // Hostname must strictly match expected file URL (rejects file://remote-host even if pathname matches)
    if (normalizeHost(parsed.hostname) !== normalizeHost(expected.hostname)) {
      return false
    }

    // Reject unexpected query parameters in production document (e.g. file:///app/index.html?token=leak)
    if (parsed.search !== expected.search) {
      return false
    }

    // Path must strictly match the expected local document path (hash navigation within the same document is preserved)
    return normalizePath(parsed.pathname) === normalizePath(expected.pathname)
  } catch {
    return false
  }
}

/**
 * Validates whether an external URL requested via window.open is safe to open.
 * Strictly permits HTTPS URLs with valid domains.
 * Rejects: file:, javascript:, data:, shell:, http:, and malformed URLs.
 */
export function validateExternalUrl(rawUrl: string): {
  allowed: boolean
  sanitizedUrl?: string
  reason?: string
} {
  try {
    const parsed = new URL(rawUrl)

    // Strictly HTTPS only
    if (parsed.protocol !== 'https:') {
      return {
        allowed: false,
        reason: `Disallowed protocol '${parsed.protocol}': only HTTPS external URLs are permitted`
      }
    }

    // Hostname must be valid and non-local
    if (!parsed.hostname || parsed.hostname.length < 3 || !parsed.hostname.includes('.')) {
      return {
        allowed: false,
        reason: `Invalid or untrusted hostname '${parsed.hostname}'`
      }
    }

    // Disallow credentials in URL
    if (parsed.username || parsed.password) {
      return {
        allowed: false,
        reason: 'URLs with embedded credentials are not allowed'
      }
    }

    return {
      allowed: true,
      sanitizedUrl: parsed.href
    }
  } catch {
    return {
      allowed: false,
      reason: 'Malformed URL'
    }
  }
}

/**
 * Safe handler for opening external URLs without unhandled Promise rejections.
 */
export async function safeOpenExternal(
  rawUrl: string,
  openFn: (url: string) => Promise<void> = shell.openExternal
): Promise<boolean> {
  const validation = validateExternalUrl(rawUrl)
  if (!validation.allowed || !validation.sanitizedUrl) {
    return false
  }

  try {
    await openFn(validation.sanitizedUrl)
    return true
  } catch (error) {
    console.error('Failed to open external URL:', error)
    return false
  }
}

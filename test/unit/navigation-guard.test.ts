import { describe, it, expect, vi } from 'vitest'
import {
  isAllowedNavigation,
  validateExternalUrl,
  safeOpenExternal
} from '../../src/main/security/navigation-guard'

describe('navigation-guard', () => {
  describe('isAllowedNavigation', () => {
    it('allows dev server origin when in dev mode', () => {
      const options = {
        isDev: true,
        rendererUrl: 'http://localhost:5173',
        expectedHtmlPath: 'file:///path/to/app/out/renderer/index.html'
      }

      expect(isAllowedNavigation('http://localhost:5173', options)).toBe(true)
      expect(isAllowedNavigation('http://localhost:5173/dashboard', options)).toBe(true)
      expect(isAllowedNavigation('http://localhost:5173/#/settings', options)).toBe(true)
    })

    it('denies external or unexpected origins in dev mode', () => {
      const options = {
        isDev: true,
        rendererUrl: 'http://localhost:5173',
        expectedHtmlPath: 'file:///path/to/app/out/renderer/index.html'
      }

      expect(isAllowedNavigation('https://evil.com', options)).toBe(false)
      expect(isAllowedNavigation('http://localhost:3000', options)).toBe(false)
      expect(isAllowedNavigation('http://127.0.0.1:5173', options)).toBe(false)
      expect(isAllowedNavigation('file:///C:/Windows/System32/calc.exe', options)).toBe(false)
    })

    it('allows exact html file path in production mode', () => {
      const expectedHtmlPath = 'file:///C:/AURA-DESK/out/renderer/index.html'
      const options = {
        isDev: false,
        expectedHtmlPath
      }

      expect(isAllowedNavigation('file:///C:/AURA-DESK/out/renderer/index.html', options)).toBe(true)
      // Hash routing allowed on the same file document
      expect(isAllowedNavigation('file:///C:/AURA-DESK/out/renderer/index.html#/settings', options)).toBe(true)
    })

    it('denies other file paths and network protocols in production mode', () => {
      const expectedHtmlPath = 'file:///C:/AURA-DESK/out/renderer/index.html'
      const options = {
        isDev: false,
        expectedHtmlPath
      }

      expect(isAllowedNavigation('file:///C:/AURA-DESK/out/renderer/malicious.html', options)).toBe(false)
      expect(isAllowedNavigation('file:///etc/passwd', options)).toBe(false)
      expect(isAllowedNavigation('https://google.com', options)).toBe(false)
      expect(isAllowedNavigation('http://localhost:5173', options)).toBe(false)
      expect(isAllowedNavigation('javascript:alert(1)', options)).toBe(false)
      expect(isAllowedNavigation('data:text/html,<h1>bad</h1>', options)).toBe(false)
    })

    it('handles malformed URLs gracefully', () => {
      const options = {
        isDev: false,
        expectedHtmlPath: 'file:///C:/AURA-DESK/out/renderer/index.html'
      }

      expect(isAllowedNavigation('not-a-url', options)).toBe(false)
      expect(isAllowedNavigation('', options)).toBe(false)
    })
  })

  describe('validateExternalUrl', () => {
    it('permits valid HTTPS URLs', () => {
      const validUrls = [
        'https://openrouter.ai/docs',
        'https://github.com/Hyptofon/AURA-DESK',
        'https://vitejs.dev/guide/'
      ]

      for (const url of validUrls) {
        const result = validateExternalUrl(url)
        expect(result.allowed).toBe(true)
        expect(result.sanitizedUrl).toBeDefined()
      }
    })

    it('rejects HTTP URLs', () => {
      const result = validateExternalUrl('http://insecure-site.com')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('only HTTPS')
    })

    it('rejects dangerous protocols: file:, javascript:, data:, shell:', () => {
      const dangerous = [
        'file:///C:/Windows/System32/cmd.exe',
        'javascript:alert(document.cookie)',
        'data:text/html,<script>alert(1)</script>',
        'shell:AppsFolder',
        'ms-settings:privacy',
        'blob:https://example.com/123'
      ]

      for (const url of dangerous) {
        const result = validateExternalUrl(url)
        expect(result.allowed).toBe(false)
      }
    })

    it('rejects URLs with embedded credentials', () => {
      const result = validateExternalUrl('https://user:password@malicious.com/secret')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('credentials')
    })

    it('rejects malformed or empty URLs and local/invalid hostnames', () => {
      expect(validateExternalUrl('').allowed).toBe(false)
      expect(validateExternalUrl('not-a-valid-url').allowed).toBe(false)
      expect(validateExternalUrl('https://localhost').allowed).toBe(false)
      expect(validateExternalUrl('https://internal').allowed).toBe(false)
    })
  })

  describe('safeOpenExternal', () => {
    it('calls open function with sanitized URL when valid', async () => {
      const mockOpen = vi.fn().mockResolvedValue(undefined)
      const success = await safeOpenExternal('https://github.com/Hyptofon/AURA-DESK', mockOpen)

      expect(success).toBe(true)
      expect(mockOpen).toHaveBeenCalledWith('https://github.com/Hyptofon/AURA-DESK')
    })

    it('does not call open function and returns false for rejected URLs', async () => {
      const mockOpen = vi.fn().mockResolvedValue(undefined)
      const success = await safeOpenExternal('javascript:alert(1)', mockOpen)

      expect(success).toBe(false)
      expect(mockOpen).not.toHaveBeenCalled()
    })

    it('handles exceptions thrown by openFn without unhandled rejection', async () => {
      const mockOpen = vi.fn().mockRejectedValue(new Error('OS failed to open URL'))
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const success = await safeOpenExternal('https://openrouter.ai', mockOpen)
      expect(success).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })
})

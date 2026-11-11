import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Deterministic Production Invariants Quality Gate', () => {
  const rootDir = path.resolve(__dirname, '../../')
  const readSrc = (relPath: string): string => {
    const fullPath = path.join(rootDir, relPath)
    return fs.readFileSync(fullPath, 'utf-8')
  }

  describe('Capture Module Invariants', () => {
    it('prohibits dummy placeholder byte arrays in capture source code', () => {
      const capturerCode = readSrc('src/main/capture/single-display-capturer.ts')
      const bufferCode = readSrc('src/main/capture/frame-buffer.ts')
      const resolverCode = readSrc('src/main/capture/source-resolver.ts')

      // Assert no hardcoded dummy buffers like new Uint8Array(1024)
      expect(capturerCode).not.toMatch(/Uint8Array\(\s*1024\s*\)/)
      expect(bufferCode).not.toMatch(/Uint8Array\(\s*1024\s*\)/)
      expect(resolverCode).not.toMatch(/Uint8Array\(\s*1024\s*\)/)

      // Ensure capturer strictly checks for real non-empty thumbnail and genuine PNG conversion
      expect(capturerCode).toMatch(/thumbnail\.isEmpty\(\)/)
      expect(capturerCode).toMatch(/thumbnail\.toPNG\(\)/)
      expect(capturerCode).toMatch(/format:\s*['"]png['"]/)
    })

    it('mandates zero-size thumbnail option for desktopCapturer source enumeration', () => {
      const capturerCode = readSrc('src/main/capture/single-display-capturer.ts')

      // Must explicitly request { width: 0, height: 0 } to avoid heavy CPU/memory overhead
      expect(capturerCode).toMatch(/thumbnailSize:\s*\{\s*width:\s*0,\s*height:\s*0\s*\}/)
    })

    it('enforces fail-closed display source resolution without silent fallbacks', () => {
      const resolverCode = readSrc('src/main/capture/source-resolver.ts')

      // Must require exact display_id match
      expect(resolverCode).toMatch(/exact_display_id_match/)

      // Must NOT contain loose fallbacks to index 0, first element, or fuzzy names
      expect(resolverCode).not.toMatch(/sources\[0\]/)
      expect(resolverCode).not.toMatch(/fallback_index/)
      expect(resolverCode).not.toMatch(/fuzzy_name_match/)
    })
  })

  describe('Preload & IPC Security Invariants', () => {
    it('ensures preload script does not bundle heavy runtime validation libraries like zod', () => {
      const preloadCode = readSrc('src/preload/index.ts')

      // Preload bundle must remain ultra-thin without direct zod runtime dependency
      expect(preloadCode).not.toMatch(/from\s+['"]zod['"]/)
      expect(preloadCode).not.toMatch(/require\(['"]zod['"]\)/)
    })

    it('mandates unsubscribe cleanup handlers for preload event listeners', () => {
      const preloadCode = readSrc('src/preload/index.ts')

      // onDisplaysChanged must return a cleanup function calling removeListener
      expect(preloadCode).toMatch(/onDisplaysChanged[\s\S]*?removeListener/)
    })

    it('enforces fail-closed window opening and navigation guards', () => {
      const mainIndexCode = readSrc('src/main/index.ts')

      // setWindowOpenHandler must deny new window creation fail-closed
      expect(mainIndexCode).toMatch(/setWindowOpenHandler[\s\S]*?action:\s*['"]deny['"]/)

      // will-navigate must guard navigation with isAllowedNavigation
      expect(mainIndexCode).toMatch(/will-navigate[\s\S]*?isAllowedNavigation/)
    })
  })
})

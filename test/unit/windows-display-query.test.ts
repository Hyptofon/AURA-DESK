import { describe, it, expect } from 'vitest'
import {
  parseWindowsDisplayOutput,
  queryWindowsDisplayDevices
} from '@/main/capture/windows-display-query'

describe('Windows Display Query & Output Parser', () => {
  describe('parseWindowsDisplayOutput', () => {
    it('parses typical Windows dual-monitor output accurately', () => {
      const raw = [
        '\\\\.\\DISPLAY1|0|0|1920|1080|True',
        '\\\\.\\DISPLAY2|-1920|1|1920|1080|False'
      ].join('\r\n')

      const devices = parseWindowsDisplayOutput(raw)
      expect(devices).toHaveLength(2)

      expect(devices[0]).toEqual({
        deviceName: '\\\\.\\DISPLAY1',
        displayIndex: 0,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true
      })

      expect(devices[1]).toEqual({
        deviceName: '\\\\.\\DISPLAY2',
        displayIndex: 1,
        bounds: { x: -1920, y: 1, width: 1920, height: 1080 },
        isPrimary: false
      })
    })

    it('parses single display output with non-zero origin', () => {
      const raw = '\\\\.\\DISPLAY3|2560|0|2560|1440|true'
      const devices = parseWindowsDisplayOutput(raw)

      expect(devices).toHaveLength(1)
      expect(devices[0]).toEqual({
        deviceName: '\\\\.\\DISPLAY3',
        displayIndex: 2,
        bounds: { x: 2560, y: 0, width: 2560, height: 1440 },
        isPrimary: true
      })
    })

    it('handles empty, whitespace, or invalid inputs gracefully', () => {
      expect(parseWindowsDisplayOutput('')).toEqual([])
      expect(parseWindowsDisplayOutput('   \r\n   ')).toEqual([])
      expect(parseWindowsDisplayOutput(null as unknown as string)).toEqual([])
      expect(parseWindowsDisplayOutput(undefined as unknown as string)).toEqual([])
    })

    it('skips malformed, corrupted, or non-DISPLAY lines without crashing', () => {
      const raw = [
        'NOT_A_DISPLAY|0|0|1920|1080|True',
        '\\\\.\\DISPLAY1|not_number|0|1920|1080|True',
        '\\\\.\\DISPLAY2|0|0|-100|1080|False', // negative width rejected
        'incomplete_line',
        '\\\\.\\DISPLAY4|0|0|1920|1080|False'
      ].join('\n')

      const devices = parseWindowsDisplayOutput(raw)
      expect(devices).toHaveLength(1)
      expect(devices[0].deviceName).toBe('\\\\.\\DISPLAY4')
      expect(devices[0].displayIndex).toBe(3)
    })
  })

  describe('queryWindowsDisplayDevices', () => {
    it('returns empty array when script fails or produces no output', async () => {
      // Intentionally invalid powershell command
      const devices = await queryWindowsDisplayDevices('exit 1')
      expect(devices).toEqual([])
    })

    it('returns parsed devices when valid script override is provided', async () => {
      if (process.platform !== 'win32') {
        const devices = await queryWindowsDisplayDevices()
        expect(devices).toEqual([])
        return
      }

      const script = "Write-Output '\\\\.\\DISPLAY1|0|0|1920|1080|True'"
      const devices = await queryWindowsDisplayDevices(script)
      expect(devices).toHaveLength(1)
      expect(devices[0].deviceName).toBe('\\\\.\\DISPLAY1')
      expect(devices[0].displayIndex).toBe(0)
    })
  })
})

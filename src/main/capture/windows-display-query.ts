import { execFile } from 'node:child_process'
import type { DisplayBounds } from '../../shared/contracts/channels'

export interface WindowsDisplayDevice {
  deviceName: string
  /**
   * Candidate 0-based device index derived from `\\.\DISPLAY<N>` (`N - 1`).
   * Assumes WebRTC's `ScreenCapturerWinGdi` orders sources `screen:<index>:0`
   * synchronously with Windows DISPLAY numbering; NOT universally proven across
   * all multi-GPU/driver/virtual-display topologies without physical pixel verification.
   */
  displayIndex: number
  bounds: DisplayBounds
  isPrimary: boolean
}

const POWERSHELL_DISPLAY_QUERY =
  'Add-Type -AssemblyName System.Windows.Forms; ' +
  '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { ' +
  '$_.DeviceName + \'|\' + $_.Bounds.X + \'|\' + $_.Bounds.Y + \'|\' + ' +
  '$_.Bounds.Width + \'|\' + $_.Bounds.Height + \'|\' + $_.Primary }'

/**
 * Pure parser for Windows display device enumeration output.
 * Converts pipe-delimited screen metadata into typed WindowsDisplayDevice objects.
 */
export function parseWindowsDisplayOutput(rawOutput: string): WindowsDisplayDevice[] {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return []
  }

  const lines = rawOutput.trim().split(/\r?\n/).filter(Boolean)
  const devices: WindowsDisplayDevice[] = []

  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 5) continue

    const [deviceName, rawX, rawY, rawWidth, rawHeight, rawPrimary] = parts
    const match = deviceName.match(/DISPLAY(\d+)/i)
    if (!match) continue

    const displayNum = parseInt(match[1], 10)
    if (isNaN(displayNum) || displayNum < 1) continue

    const x = parseInt(rawX, 10)
    const y = parseInt(rawY, 10)
    const width = parseInt(rawWidth, 10)
    const height = parseInt(rawHeight, 10)

    if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      continue
    }

    devices.push({
      deviceName: deviceName.trim(),
      displayIndex: displayNum - 1,
      bounds: { x, y, width, height },
      isPrimary: rawPrimary ? rawPrimary.trim().toLowerCase() === 'true' : false
    })
  }

  return devices
}

/**
 * Queries the active Windows display devices from the operating system.
 * Returns device names, physical desktop coordinates, and candidate 0-based indices (`DISPLAY<N>` -> `N - 1`).
 *
 * Working assumption (NOT universally proven): assumes WebRTC `ScreenCapturerWinGdi`
 * assigns `screen:<index>:0` in matching `DISPLAY<N>` order when `display_id` is empty.
 * Fails closed by returning an empty array on non-Windows platforms or query failure.
 */
export async function queryWindowsDisplayDevices(
  scriptOverride?: string
): Promise<WindowsDisplayDevice[]> {
  if (process.platform !== 'win32') {
    return []
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', scriptOverride || POWERSHELL_DISPLAY_QUERY],
      { encoding: 'utf-8', windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([])
          return
        }
        resolve(parseWindowsDisplayOutput(stdout))
      }
    )
  })
}

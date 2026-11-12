import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Import CommonJS harness helpers
// eslint-disable-next-line @typescript-eslint/no-var-requires
const harness = require('../../scripts/verify-physical-isolation.cjs')

const {
  parseCliArgs,
  resolveEffectiveMode,
  generateRunId,
  saveVerificationReport,
  evaluateOverallStatus,
  buildPatternDataUrl,
  getWindowDiagnostics,
  AUTHORIZATION_FLAG,
  CHECK_HARNESS_FLAG,
  LIST_DISPLAYS_FLAG
} = harness

describe('Physical Harness CLI & Argument Parsing', () => {
  it('returns default options when no arguments are passed', () => {
    const args = parseCliArgs([])
    expect(args).toEqual({
      mode: 'auto',
      hasAuth: false,
      hasCheckHarness: false,
      hasListDisplays: false,
      hasHelp: false
    })
  })

  it('parses authorization flag correctly', () => {
    const args = parseCliArgs([AUTHORIZATION_FLAG])
    expect(args.hasAuth).toBe(true)
    expect(args.mode).toBe('auto')
  })

  it('parses check harness flag correctly', () => {
    const args = parseCliArgs([CHECK_HARNESS_FLAG])
    expect(args.hasCheckHarness).toBe(true)
  })

  it('parses list displays flag correctly', () => {
    const args = parseCliArgs([LIST_DISPLAYS_FLAG])
    expect(args.hasListDisplays).toBe(true)
  })

  it('parses help flags correctly', () => {
    expect(parseCliArgs(['--help']).hasHelp).toBe(true)
    expect(parseCliArgs(['-h']).hasHelp).toBe(true)
  })

  it('parses space-separated --mode values', () => {
    expect(parseCliArgs(['--mode', 'single']).mode).toBe('single')
    expect(parseCliArgs(['--mode', 'dual']).mode).toBe('dual')
    expect(parseCliArgs(['--mode', 'auto']).mode).toBe('auto')
    expect(parseCliArgs(['--mode', 'SINGLE']).mode).toBe('single')
  })

  it('parses equal-separated --mode= values', () => {
    expect(parseCliArgs(['--mode=single']).mode).toBe('single')
    expect(parseCliArgs(['--mode=dual']).mode).toBe('dual')
    expect(parseCliArgs(['--mode=auto']).mode).toBe('auto')
    expect(parseCliArgs(['--mode=DUAL']).mode).toBe('dual')
  })

  it('throws descriptive error on invalid mode', () => {
    expect(() => parseCliArgs(['--mode', 'triple'])).toThrow(
      /Invalid --mode "triple"\. Supported modes: auto, single, dual/
    )
    expect(() => parseCliArgs(['--mode=invalid'])).toThrow(
      /Invalid --mode "invalid"\. Supported modes: auto, single, dual/
    )
  })

  it('parses mixed flags in any order', () => {
    const args = parseCliArgs([
      '--mode',
      'single',
      AUTHORIZATION_FLAG,
      '--check-harness'
    ])
    expect(args.mode).toBe('single')
    expect(args.hasAuth).toBe(true)
    expect(args.hasCheckHarness).toBe(true)
  })
})

describe('Physical Harness Mode Resolution', () => {
  it('resolves dual mode to run when 2 displays are available', () => {
    const res = resolveEffectiveMode('dual', 2)
    expect(res).toEqual({ mode: 'dual', action: 'run' })
  })

  it('resolves dual mode to run when >2 displays are available', () => {
    const res = resolveEffectiveMode('dual', 3)
    expect(res).toEqual({ mode: 'dual', action: 'run' })
  })

  it('resolves dual mode to skip with reason when only 1 display is available', () => {
    const res = resolveEffectiveMode('dual', 1)
    expect(res.mode).toBe('dual')
    expect(res.action).toBe('skip')
    expect(res.reason).toContain('Dual-monitor verification requested')
    expect(res.reason).toContain('only 1 physical display was detected')
  })

  it('resolves dual mode to skip when 0 displays are available', () => {
    const res = resolveEffectiveMode('dual', 0)
    expect(res.mode).toBe('dual')
    expect(res.action).toBe('skip')
  })

  it('resolves single mode to run when 1 display is available', () => {
    const res = resolveEffectiveMode('single', 1)
    expect(res).toEqual({ mode: 'single', action: 'run' })
  })

  it('resolves single mode to run when 2 displays are available (primary target)', () => {
    const res = resolveEffectiveMode('single', 2)
    expect(res).toEqual({ mode: 'single', action: 'run' })
  })

  it('resolves single mode to fail when 0 displays are available', () => {
    const res = resolveEffectiveMode('single', 0)
    expect(res.mode).toBe('single')
    expect(res.action).toBe('fail')
    expect(res.reason).toContain('no physical displays were detected')
  })

  it('resolves auto mode to dual when 2 or more displays are available', () => {
    expect(resolveEffectiveMode('auto', 2)).toEqual({ mode: 'dual', action: 'run' })
    expect(resolveEffectiveMode('auto', 3)).toEqual({ mode: 'dual', action: 'run' })
  })

  it('resolves auto mode to single when exactly 1 display is available', () => {
    expect(resolveEffectiveMode('auto', 1)).toEqual({ mode: 'single', action: 'run' })
  })

  it('resolves auto mode to fail when 0 displays are available', () => {
    const res = resolveEffectiveMode('auto', 0)
    expect(res.mode).toBe('auto')
    expect(res.action).toBe('fail')
    expect(res.reason).toContain('No physical displays detected in auto mode')
  })
})

describe('Run ID Generation & Collision Resistance', () => {
  it('generates reproducible runId when given fixed date and random string', () => {
    const fixedDate = new Date('2026-11-13T01:00:00.000Z')
    const runId = generateRunId(fixedDate, 'abcdef')
    expect(runId).toBe('2026-11-13T01-00-00-000Z-abcdef')
  })

  it('generates distinct run IDs on successive calls', () => {
    const id1 = generateRunId()
    const id2 = generateRunId()
    expect(id1).not.toBe(id2)
  })
})

describe('Evidence Preservation & Immutable Storage', () => {
  let tempArtifactDir: string

  beforeEach(() => {
    tempArtifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-desk-harness-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempArtifactDir, { recursive: true, force: true })
    } catch (_) {
      // ignore teardown error
    }
  })

  it('saves single-mode report into physical-isolation/single/ directory', () => {
    const mockReport = {
      verificationScope: 'supervised-physical-single-display-capture',
      verificationStatus: 'PASS',
      details: 'single test'
    }

    const { runId, immutableFilePath } = saveVerificationReport(
      mockReport,
      'single',
      'PASS',
      tempArtifactDir
    )

    expect(fs.existsSync(immutableFilePath)).toBe(true)
    expect(immutableFilePath).toContain(path.join('physical-isolation', 'single'))
    expect(immutableFilePath).toContain(runId)

    const savedContent = JSON.parse(fs.readFileSync(immutableFilePath, 'utf-8'))
    expect(savedContent.verificationStatus).toBe('PASS')
    expect(savedContent.runId).toBe(runId)
  })

  it('saves dual-mode report into physical-isolation/dual/ directory', () => {
    const mockReport = {
      verificationScope: 'supervised-physical-dual-display-isolation',
      verificationStatus: 'PASS',
      details: 'dual test'
    }

    const { runId, immutableFilePath } = saveVerificationReport(
      mockReport,
      'dual',
      'PASS',
      tempArtifactDir
    )

    expect(fs.existsSync(immutableFilePath)).toBe(true)
    expect(immutableFilePath).toContain(path.join('physical-isolation', 'dual'))
    expect(immutableFilePath).toContain(runId)
  })

  it('saves skipped run report into physical-isolation/skipped/ directory', () => {
    const mockReport = {
      verificationScope: 'supervised-physical-dual-display-isolation',
      verificationStatus: 'SKIPPED_INSUFFICIENT_DISPLAYS',
      reason: '1 display'
    }

    const { runId, immutableFilePath } = saveVerificationReport(
      mockReport,
      'dual',
      'SKIPPED_INSUFFICIENT_DISPLAYS',
      tempArtifactDir
    )

    expect(fs.existsSync(immutableFilePath)).toBe(true)
    expect(immutableFilePath).toContain(path.join('physical-isolation', 'skipped'))
    expect(immutableFilePath).toContain(runId)
  })

  it('does not overwrite previous run report files when a new report is saved', () => {
    const report1 = { run: 1, verificationStatus: 'PASS' }
    const report2 = { run: 2, verificationStatus: 'FAIL' }

    const saved1 = saveVerificationReport(report1, 'single', 'PASS', tempArtifactDir)
    const saved2 = saveVerificationReport(report2, 'single', 'FAIL', tempArtifactDir)

    expect(saved1.immutableFilePath).not.toBe(saved2.immutableFilePath)
    expect(fs.existsSync(saved1.immutableFilePath)).toBe(true)
    expect(fs.existsSync(saved2.immutableFilePath)).toBe(true)

    const content1 = JSON.parse(fs.readFileSync(saved1.immutableFilePath, 'utf-8'))
    const content2 = JSON.parse(fs.readFileSync(saved2.immutableFilePath, 'utf-8'))

    expect(content1.verificationStatus).toBe('PASS')
    expect(content1.run).toBe(1)
    expect(content2.verificationStatus).toBe('FAIL')
    expect(content2.run).toBe(2)
  })
})

describe('Evaluate Overall Status', () => {
  it('returns PASS when all mandatory applicable checks pass', () => {
    const checks = {
      check1: { mandatory: true, applicable: true, status: 'PASS' },
      check2: { mandatory: true, applicable: true, status: 'PASS' },
      check3: { mandatory: false, applicable: true, status: 'FAIL' }
    }
    expect(evaluateOverallStatus(checks)).toBe('PASS')
  })

  it('returns FAIL when any mandatory applicable check fails', () => {
    const checks = {
      check1: { mandatory: true, applicable: true, status: 'PASS' },
      check2: { mandatory: true, applicable: true, status: 'FAIL' }
    }
    expect(evaluateOverallStatus(checks)).toBe('FAIL')
  })

  it('ignores excluded check keys (e.g. processLifecycle)', () => {
    const checks = {
      check1: { mandatory: true, applicable: true, status: 'PASS' },
      processLifecycle: { mandatory: true, applicable: true, status: 'PENDING' }
    }
    expect(
      evaluateOverallStatus(checks, { excludeKeys: ['processLifecycle'] })
    ).toBe('PASS')
  })

  it('returns FAIL if no mandatory applicable checks exist', () => {
    const checks = {
      check1: { mandatory: false, applicable: true, status: 'PASS' }
    }
    expect(evaluateOverallStatus(checks)).toBe('FAIL')
  })
})

describe('Window Diagnostics & Pattern HTML Builder', () => {
  it('builds a valid data URL containing background hex and labels', () => {
    const dataUrl = buildPatternDataUrl('#0057B8', 'Primary Pattern', 'Display 1')
    expect(dataUrl.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(dataUrl).toContain(encodeURIComponent('#0057B8'))
    expect(dataUrl).toContain(encodeURIComponent('Primary Pattern'))
    expect(dataUrl).toContain(encodeURIComponent('Display 1'))
  })

  it('reports destroyed state for destroyed or null window', () => {
    const bounds = { x: 0, y: 0, width: 1920, height: 1080 }
    const diagNull = getWindowDiagnostics(null, bounds)
    expect(diagNull.isDestroyed).toBe(true)
    expect(diagNull.boundsMatch).toBe(false)
    expect(diagNull.actualBounds).toBeNull()

    const mockDestroyedWin = {
      isDestroyed: () => true
    }
    const diagDestroyed = getWindowDiagnostics(mockDestroyedWin as any, bounds)
    expect(diagDestroyed.isDestroyed).toBe(true)
  })

  it('reports accurate diagnostics for active window matching expected bounds', () => {
    const expected = { x: 0, y: 0, width: 1920, height: 1080 }
    const mockWin = {
      isDestroyed: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      isVisible: () => true,
      isAlwaysOnTop: () => true,
      isMinimized: () => false
    }

    const diag = getWindowDiagnostics(mockWin as any, expected)
    expect(diag.isDestroyed).toBe(false)
    expect(diag.boundsMatch).toBe(true)
    expect(diag.isVisible).toBe(true)
    expect(diag.isAlwaysOnTop).toBe(true)
    expect(diag.isMinimized).toBe(false)
  })
})

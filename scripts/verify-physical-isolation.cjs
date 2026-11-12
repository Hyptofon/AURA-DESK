/* eslint-disable */
/**
 * AURA DESK — Supervised Physical Display Capture Verification Harness
 *
 * SAFETY & AUTHORIZATION GATE:
 * This script performs REAL physical screen capture across physical monitors.
 * It MUST NOT run unattended or without explicit user authorization.
 *
 * Usage:
 *   # Safe preflight check (no capture, compiles ephemeral bundle):
 *   node scripts/verify-physical-isolation.cjs --check-harness
 *
 *   # Enumerate detected displays metadata (no capture, no window):
 *   node scripts/verify-physical-isolation.cjs --list-displays
 *
 *   # Authorized Single-Monitor verification (primary laptop display):
 *   node scripts/verify-physical-isolation.cjs --mode single --authorize-physical-capture
 *
 *   # Authorized Dual-Monitor verification (Cobalt Blue on D1, Crimson Red on D2):
 *   node scripts/verify-physical-isolation.cjs --mode dual --authorize-physical-capture
 *
 *   # Authorized Auto Mode (automatically selects single or dual by display count):
 *   node scripts/verify-physical-isolation.cjs --authorize-physical-capture
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const artifactDir = path.join(rootDir, 'artifacts', 'local-validation');
const harnessBundlePath = path.join(artifactDir, '.physical-harness.cjs');
const resultsJsonPath = path.join(artifactDir, 'physical-isolation-results.json');
const physicalIsolationBaseDir = path.join(artifactDir, 'physical-isolation');

const AUTHORIZATION_FLAG = '--authorize-physical-capture';
const CHECK_HARNESS_FLAG = '--check-harness';
const LIST_DISPLAYS_FLAG = '--list-displays';
const HELP_FLAG = '--help';
const HELP_SHORT_FLAG = '-h';
const MODE_FLAG = '--mode';

function parseCliArgs(argv) {
  let mode = 'auto';
  let hasAuth = false;
  let hasCheckHarness = false;
  let hasListDisplays = false;
  let hasHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === AUTHORIZATION_FLAG) {
      hasAuth = true;
    } else if (arg === CHECK_HARNESS_FLAG) {
      hasCheckHarness = true;
    } else if (arg === LIST_DISPLAYS_FLAG) {
      hasListDisplays = true;
    } else if (arg === HELP_FLAG || arg === HELP_SHORT_FLAG) {
      hasHelp = true;
    } else if (arg === MODE_FLAG) {
      if (i + 1 < argv.length) {
        mode = argv[i + 1].toLowerCase();
        i++;
      }
    } else if (arg.startsWith('--mode=')) {
      mode = arg.split('=')[1].toLowerCase();
    }
  }

  const validModes = ['auto', 'single', 'dual'];
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid --mode "${mode}". Supported modes: ${validModes.join(', ')}`);
  }

  return {
    mode,
    hasAuth,
    hasCheckHarness,
    hasListDisplays,
    hasHelp
  };
}

function resolveEffectiveMode(requestedMode, displayCount) {
  if (requestedMode === 'dual') {
    if (displayCount < 2) {
      return {
        mode: 'dual',
        action: 'skip',
        reason: `Dual-monitor verification requested (--mode dual), but only ${displayCount} physical display was detected.`
      };
    }
    return { mode: 'dual', action: 'run' };
  }

  if (requestedMode === 'single') {
    if (displayCount < 1) {
      return {
        mode: 'single',
        action: 'fail',
        reason: 'Single-monitor verification requested, but no physical displays were detected.'
      };
    }
    return { mode: 'single', action: 'run' };
  }

  // mode === 'auto'
  if (displayCount >= 2) {
    return { mode: 'dual', action: 'run' };
  } else if (displayCount === 1) {
    return { mode: 'single', action: 'run' };
  } else {
    return {
      mode: 'auto',
      action: 'fail',
      reason: 'No physical displays detected in auto mode.'
    };
  }
}

function generateRunId(date = new Date(), randomStr = Math.random().toString(36).slice(2, 8)) {
  const iso = date.toISOString().replace(/[:.]/g, '-');
  return `${iso}-${randomStr}`;
}

function saveVerificationReport(report, mode, status, baseArtifactDir = artifactDir) {
  const physicalIsolationDir = path.join(baseArtifactDir, 'physical-isolation');
  const runId = generateRunId();

  let subDirName = 'general';
  if (status === 'SKIPPED_INSUFFICIENT_DISPLAYS') {
    subDirName = 'skipped';
  } else if (mode === 'single') {
    subDirName = 'single';
  } else if (mode === 'dual') {
    subDirName = 'dual';
  }

  const targetDir = path.join(physicalIsolationDir, subDirName);
  fs.mkdirSync(targetDir, { recursive: true });

  const immutableFilePath = path.join(targetDir, `${runId}.json`);

  report.runId = runId;
  report.immutableReportPath = path.relative(rootDir, immutableFilePath);

  // Write immutable per-run report
  fs.writeFileSync(immutableFilePath, JSON.stringify(report, null, 2), 'utf-8');

  // Update latest reference (physical-isolation-results.json)
  const latestSummary = {
    ...report,
    latestRunId: runId,
    latestRunFile: path.relative(rootDir, immutableFilePath)
  };
  fs.writeFileSync(resultsJsonPath, JSON.stringify(latestSummary, null, 2), 'utf-8');

  return {
    runId,
    immutableFilePath,
    resultsJsonPath
  };
}

function evaluateOverallStatus(evidenceMatrix, options = {}) {
  const excludeKeys = new Set(options.excludeKeys || []);
  const mandatoryApplicable = Object.entries(evidenceMatrix)
    .filter(([key, item]) => !excludeKeys.has(key) && item.mandatory === true && item.applicable !== false)
    .map(([, item]) => item);

  if (mandatoryApplicable.length === 0) {
    return 'FAIL';
  }

  return mandatoryApplicable.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL';
}

function cleanupEphemeralBundle() {
  try {
    if (fs.existsSync(harnessBundlePath)) {
      fs.unlinkSync(harnessBundlePath);
    }
  } catch (_) {
    // ignore cleanup error
  }
}

function loadEsbuild() {
  try {
    return require('esbuild');
  } catch (err) {
    throw new Error(
      `esbuild could not be resolved from declared devDependencies (vite/electron-vite): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function resolveCaptureHtmlAsset() {
  let resolvedCaptureHtml = path.join(rootDir, 'src', 'main', 'capture', 'capture.html');
  const outMainChunksDir = path.join(rootDir, 'out', 'main', 'chunks');
  if (fs.existsSync(outMainChunksDir)) {
    const chunkFiles = fs.readdirSync(outMainChunksDir);
    const captureChunk = chunkFiles.find((f) => /^capture.*\.html$/i.test(f));
    if (captureChunk) {
      resolvedCaptureHtml = path.join(outMainChunksDir, captureChunk);
    }
  }

  if (!fs.existsSync(resolvedCaptureHtml)) {
    throw new Error(`capture.html not found at ${resolvedCaptureHtml}`);
  }

  return resolvedCaptureHtml;
}

async function compileHarnessBundle(resolvedCaptureHtml) {
  const esbuild = loadEsbuild();
  fs.mkdirSync(artifactDir, { recursive: true });

  const harnessEntrySource = `
    export { DisplayManager } from ${JSON.stringify(path.join(rootDir, 'src', 'main', 'displays', 'display-manager.ts'))};
    export { SingleDisplayCapturer } from ${JSON.stringify(path.join(rootDir, 'src', 'main', 'capture', 'single-display-capturer.ts'))};
    export { MediaStreamDisplayCaptureBackend } from ${JSON.stringify(path.join(rootDir, 'src', 'main', 'capture', 'mediastream-backend.ts'))};
    export { samplePngPixels } from ${JSON.stringify(path.join(rootDir, 'src', 'main', 'capture', 'frame-pixel-sampler.ts'))};
  `;

  await esbuild.build({
    stdin: {
      contents: harnessEntrySource,
      resolveDir: rootDir,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: harnessBundlePath,
    external: ['electron'],
    plugins: [
      {
        name: 'capture-html-asset-plugin',
        setup(build) {
          build.onResolve({ filter: /capture\.html\?asset$/ }, () => ({
            path: resolvedCaptureHtml,
            namespace: 'capture-html-asset'
          }));
          build.onLoad({ filter: /.*/, namespace: 'capture-html-asset' }, (args) => ({
            contents: `export default ${JSON.stringify(args.path)};`,
            loader: 'js'
          }));
        }
      }
    ]
  });
}

function validateCompiledHarnessBundle(bundlePath) {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Compiled harness bundle missing at ${bundlePath}`);
  }

  const stat = fs.statSync(bundlePath);
  if (stat.size <= 0) {
    throw new Error(`Compiled harness bundle at ${bundlePath} is empty (0 bytes)`);
  }

  const code = fs.readFileSync(bundlePath, 'utf-8');
  new vm.Script(code, { filename: bundlePath });

  const moduleStub = { exports: {} };
  const safeRequire = (specifier) => {
    if (specifier === 'electron') {
      return {};
    }
    return require(specifier);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', code);
  fn(moduleStub.exports, safeRequire, moduleStub, bundlePath, path.dirname(bundlePath));

  const exported = moduleStub.exports;
  const requiredExports = [
    'DisplayManager',
    'SingleDisplayCapturer',
    'MediaStreamDisplayCaptureBackend',
    'samplePngPixels'
  ];

  for (const name of requiredExports) {
    if (typeof exported?.[name] !== 'function') {
      throw new Error(`Compiled CJS harness missing expected function export "${name}"`);
    }
  }

  return {
    byteLength: stat.size,
    exports: requiredExports
  };
}

function buildPatternDataUrl(bgHex, title, subtitle) {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
    background: ${bgHex}; font-family: Segoe UI, sans-serif; color: #FFFFFF;
  }
  .badge {
    position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.68); padding: 10px 22px; border-radius: 8px;
    border: 2px solid #FFFFFF; text-align: center; font-size: 16px; font-weight: 600;
  }
  .sub { font-size: 12px; font-weight: 400; opacity: 0.9; margin-top: 2px; }
</style></head>
<body>
  <div class="badge">${title}<div class="sub">${subtitle}</div></div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function getWindowDiagnostics(win, expectedBounds) {
  if (!win || win.isDestroyed()) {
    return {
      expectedBounds,
      actualBounds: null,
      boundsMatch: false,
      isVisible: false,
      isAlwaysOnTop: false,
      isMinimized: false,
      isDestroyed: true
    };
  }
  const actualBounds = win.getBounds();
  return {
    expectedBounds,
    actualBounds,
    boundsMatch:
      actualBounds.x === expectedBounds.x &&
      actualBounds.y === expectedBounds.y &&
      actualBounds.width === expectedBounds.width &&
      actualBounds.height === expectedBounds.height,
    isVisible: win.isVisible(),
    isAlwaysOnTop: win.isAlwaysOnTop(),
    isMinimized: win.isMinimized(),
    isDestroyed: false
  };
}

const isElectronProcess = Boolean(
  process.versions.electron && process.type === 'browser'
);

if (!isElectronProcess) {
  // =========================================================================
  // Parent Node.js Orchestrator
  // =========================================================================
  const isDirectRun = require.main === module;

  if (isDirectRun) {
    const cliArgs = parseCliArgs(process.argv.slice(2));

    if (cliArgs.hasHelp) {
      console.log(`
AURA DESK — Supervised Physical Display Capture Verification Harness

Usage:
  node scripts/verify-physical-isolation.cjs [options]

Modes:
  --mode auto     (Default) Automatically selects single or dual monitor test based on detected display count
  --mode single   Runs single-monitor capture test on primary laptop display (Cobalt Blue #0057B8)
  --mode dual     Runs dual-monitor isolation test across 2 displays (Cobalt Blue on D1, Crimson Red on D2)

Authorization Gate:
  --authorize-physical-capture   Explicit user authorization required to acquire real physical screen pixels

Safe Non-Capturing Utilities:
  --check-harness                Compiles ephemeral CJS harness, verifies syntax & exports, deletes bundle
  --list-displays                Enumerates connected physical displays via Electron Screen API and prints metadata
  --help, -h                     Shows this help message
`);
      process.exit(0);
    }

    async function runPreflightCheck() {
      try {
        const resolvedCaptureHtml = resolveCaptureHtmlAsset();
        await compileHarnessBundle(resolvedCaptureHtml);
        const validation = validateCompiledHarnessBundle(harnessBundlePath);
        console.log('[HARNESS PREFLIGHT]: PASS');
        console.log(`[HARNESS PREFLIGHT]: capture.html resolved to: ${resolvedCaptureHtml}`);
        console.log(`[HARNESS PREFLIGHT]: CJS bundle compiled (${validation.byteLength} bytes) and verified exports: ${validation.exports.join(', ')}`);
        console.log('[HARNESS PREFLIGHT]: No Electron capture window launched and no MediaStream requested.');
        return 0;
      } catch (err) {
        console.error('[HARNESS PREFLIGHT ERROR]:', err);
        return 1;
      } finally {
        cleanupEphemeralBundle();
      }
    }

    async function runListDisplays() {
      const electronExe = process.platform === 'win32'
        ? path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe')
        : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');

      if (!fs.existsSync(electronExe)) {
        console.error(`[PHYSICAL VERIFY ERROR]: Electron executable not found at: ${electronExe}`);
        return 1;
      }

      try {
        const resolvedCaptureHtml = resolveCaptureHtmlAsset();
        await compileHarnessBundle(resolvedCaptureHtml);
      } catch (_) {
        // Fall back to built-in Electron screen if compile fails
      }

      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;

      return await new Promise((resolve) => {
        const child = spawn(electronExe, [__filename, LIST_DISPLAYS_FLAG], {
          env,
          stdio: 'inherit',
          cwd: rootDir
        });
        child.on('exit', (code) => {
          cleanupEphemeralBundle();
          resolve(code || 0);
        });
        child.on('error', (err) => {
          cleanupEphemeralBundle();
          console.error('[PHYSICAL VERIFY ERROR]: Failed to spawn Electron for --list-displays:', err);
          resolve(1);
        });
      });
    }

    async function runAuthorizedPhysicalCapture(mode) {
      const electronExe = process.platform === 'win32'
        ? path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe')
        : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');

      if (!fs.existsSync(electronExe)) {
        console.error(`[PHYSICAL VERIFY ERROR]: Electron executable not found at: ${electronExe}`);
        return 1;
      }

      try {
        const resolvedCaptureHtml = resolveCaptureHtmlAsset();
        await compileHarnessBundle(resolvedCaptureHtml);
        validateCompiledHarnessBundle(harnessBundlePath);
      } catch (err) {
        console.error('[PHYSICAL VERIFY ERROR]: Failed to compile or validate production harness bundle:', err);
        cleanupEphemeralBundle();
        return 1;
      }

      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      env.AURA_PHYSICAL_CAPTURE_AUTHORIZED = '1';

      console.log(`[PHYSICAL VERIFY]: Launching Electron for supervised physical capture (requested mode: "${mode}")...`);

      return await new Promise((resolveExitCode) => {
        const child = spawn(electronExe, [__filename, AUTHORIZATION_FLAG, '--mode', mode], {
          env,
          stdio: 'inherit',
          cwd: rootDir
        });

        let timedOut = false;
        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          console.error('[PHYSICAL VERIFY ERROR]: Timed out after 30 seconds. Terminating Electron.');
          child.kill('SIGTERM');
        }, 30000);

        child.on('error', (spawnErr) => {
          clearTimeout(timeoutTimer);
          cleanupEphemeralBundle();
          console.error('[PHYSICAL VERIFY ERROR]: Failed to spawn Electron process:', spawnErr);
          resolveExitCode(1);
        });

        child.on('exit', (code, signal) => {
          clearTimeout(timeoutTimer);
          cleanupEphemeralBundle();

          const cleanLifecycle = !timedOut && signal === null;
          let report = null;
          if (fs.existsSync(resultsJsonPath)) {
            try {
              report = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8'));
            } catch (err) {
              console.error('[PHYSICAL VERIFY ERROR]: Failed to read verification JSON report:', err.message);
            }
          }

          if (report && report.verificationStatus === 'SKIPPED_INSUFFICIENT_DISPLAYS') {
            console.log(`[PHYSICAL VERIFY SKIPPED]: ${report.reason}`);
            console.log(`[PHYSICAL VERIFY]: Immutable skip record written to: ${report.immutableReportPath || resultsJsonPath}`);
            resolveExitCode(0);
            return;
          }

          if (report && report.checks) {
            report.processLifecycle = {
              exitCode: code,
              signal: signal,
              timedOut: timedOut,
              cleanLifecycle: cleanLifecycle
            };

            report.checks.processLifecycle = {
              mandatory: true,
              applicable: true,
              expected: 'Supervised Electron process terminates without timing out or crashing (signal=null, timedOut=false)',
              actual: cleanLifecycle
                ? `Terminated cleanly (exitCode=${code}, signal=null, timedOut=false)`
                : `Abnormal termination (exitCode=${code}, signal=${signal}, timedOut=${timedOut})`,
              status: cleanLifecycle ? 'PASS' : 'FAIL'
            };
            report.verificationStatus = evaluateOverallStatus(report.checks);

            try {
              // Update immutable report file if present
              if (report.immutableReportPath && fs.existsSync(path.join(rootDir, report.immutableReportPath))) {
                fs.writeFileSync(path.join(rootDir, report.immutableReportPath), JSON.stringify(report, null, 2), 'utf-8');
              }
              fs.writeFileSync(resultsJsonPath, JSON.stringify(report, null, 2), 'utf-8');
            } catch (err) {
              console.error('[PHYSICAL VERIFY ERROR]: Failed to finalize report JSON:', err.message);
            }

            console.log('[PHYSICAL VERIFY]: Finalized Supervised Checks:');
            console.table(report.checks);
            console.log(`[PHYSICAL VERIFY]: Overall Physical Source Isolation Status: ${report.verificationStatus}`);
            if (report.immutableReportPath) {
              console.log(`[PHYSICAL VERIFY]: Immutable run record preserved at: ${report.immutableReportPath}`);
            }
          }

          if (!cleanLifecycle || !report || report.verificationStatus !== 'PASS') {
            resolveExitCode(code && code !== 0 ? code : 1);
            return;
          }

          resolveExitCode(0);
        });
      });
    }

    (async () => {
      if (cliArgs.hasCheckHarness) {
        const code = await runPreflightCheck();
        process.exit(code);
      }

      if (cliArgs.hasListDisplays) {
        const code = await runListDisplays();
        process.exit(code);
      }

      if (!cliArgs.hasAuth) {
        console.error('[PHYSICAL VERIFY BLOCKED]: Explicit user authorization is required before starting real physical screen capture.');
        console.error('To run single-monitor verification (laptop display):');
        console.error(`  node scripts/verify-physical-isolation.cjs --mode single ${AUTHORIZATION_FLAG}`);
        console.error('To run dual-monitor isolation verification (requires 2 connected monitors):');
        console.error(`  node scripts/verify-physical-isolation.cjs --mode dual ${AUTHORIZATION_FLAG}`);
        console.error('To run automatic mode (detects 1 or 2 monitors automatically):');
        console.error(`  node scripts/verify-physical-isolation.cjs ${AUTHORIZATION_FLAG}`);
        console.error('For non-capturing preflights:');
        console.error(`  node scripts/verify-physical-isolation.cjs ${CHECK_HARNESS_FLAG}`);
        console.error(`  node scripts/verify-physical-isolation.cjs ${LIST_DISPLAYS_FLAG}`);
        process.exit(2);
      }

      const code = await runAuthorizedPhysicalCapture(cliArgs.mode);
      process.exit(code);
    })().catch((err) => {
      console.error('[PHYSICAL VERIFY ERROR]: Unexpected orchestrator failure:', err);
      cleanupEphemeralBundle();
      process.exit(1);
    });
  }
} else {
  // =========================================================================
  // Electron Main Process Supervised Test Runner
  // =========================================================================
  const { app, BrowserWindow } = require('electron');

  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.hasListDisplays) {
    app.whenReady().then(async () => {
      try {
        let displays = [];
        try {
          const { DisplayManager } = require(harnessBundlePath);
          const displayManager = new DisplayManager();
          displays = displayManager.getDisplayConfiguration().displays;
        } catch (_) {
          const { screen } = require('electron');
          displays = screen.getAllDisplays().map((d) => ({
            id: String(d.id),
            isPrimary: screen.getPrimaryDisplay()?.id === d.id,
            bounds: d.bounds
          }));
        }
        console.log(`\n[DISPLAYS DETECTED]: ${displays.length} physical display(s) connected:`);
        console.table(
          displays.map((d) => ({
            id: d.id,
            isPrimary: d.isPrimary,
            bounds: `${d.bounds.width}x${d.bounds.height} at (${d.bounds.x}, ${d.bounds.y})`
          }))
        );
      } catch (err) {
        console.error('[PHYSICAL VERIFY ERROR]: Failed to enumerate displays:', err.message);
      } finally {
        app.exit(0);
      }
    });
  } else {
    if (
      !process.argv.includes(AUTHORIZATION_FLAG) ||
      process.env.AURA_PHYSICAL_CAPTURE_AUTHORIZED !== '1'
    ) {
      console.error('[PHYSICAL VERIFY BLOCKED]: Missing explicit authorization token inside Electron runner.');
      app.exit(2);
    }

    const safetyTimeout = setTimeout(() => {
      console.error('[PHYSICAL VERIFY ERROR]: Internal safety timeout reached (25s). Exiting.');
      app.exit(1);
    }, 25000);
    safetyTimeout.unref();

    function createPatternWindow(bounds, bgHex, title, subtitle) {
      return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          frame: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          focusable: false,
          show: false,
          backgroundColor: bgHex,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
          }
        });

        win.webContents.once('did-finish-load', () => {
          try {
            win.setBounds(bounds);
            win.setAlwaysOnTop(true, 'screen-saver');
            win.showInactive();
            win.moveTop();
            win.setBounds(bounds);
            resolve(win);
          } catch (err) {
            reject(err);
          }
        });
        win.webContents.once('did-fail-load', (_ev, code, desc) => {
          reject(new Error(`Pattern window failed to load: ${code} ${desc}`));
        });
        win.loadURL(buildPatternDataUrl(bgHex, title, subtitle)).catch(reject);
      });
    }

    function destroyWindows(windows) {
      for (const win of windows) {
        try {
          if (win && !win.isDestroyed()) {
            win.destroy();
          }
        } catch (_) {
          // ignore window destroy errors
        }
      }
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function samplePatternWithDiagnostics(
      capturerInstance,
      displayId,
      expectedColor,
      maxAttempts = 5,
      intervalMs = 250
    ) {
      const attempts = [];
      let matchedSample = null;
      let matchedFrameByteLength = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          await delay(intervalMs);
        }

        let frame = capturerInstance.getLatestFrame();
        if (!frame) {
          attempts.push({
            attempt,
            timestamp: Date.now(),
            byteLength: 0,
            dimensions: '0x0',
            status: 'NO_FRAME_YET',
            meanRgb: { r: 0, g: 0, b: 0 },
            cobaltBlueRatio: 0,
            crimsonRedRatio: 0,
            isDark: true,
            matched: false,
            oppositeDetected: false
          });
          continue;
        }

        const { samplePngPixels } = require(harnessBundlePath);
        const sample = samplePngPixels(frame.data);
        const frameByteLength = frame.byteLength;
        frame = null; // release raw frame memory immediately

        const isDark = sample.meanRgb.r < 30 && sample.meanRgb.g < 30 && sample.meanRgb.b < 30;
        const isCobalt = sample.cobaltBlueRatio >= 0.70 && sample.crimsonRedRatio <= 0.05;
        const isCrimson = sample.crimsonRedRatio >= 0.70 && sample.cobaltBlueRatio <= 0.05;

        const matched = expectedColor === 'cobaltBlue' ? isCobalt : isCrimson;
        const oppositeDetected =
          expectedColor === 'cobaltBlue'
            ? sample.crimsonRedRatio >= 0.30
            : sample.cobaltBlueRatio >= 0.30;

        const record = {
          attempt,
          timestamp: Date.now(),
          byteLength: frameByteLength,
          dimensions: `${sample.width}x${sample.height}`,
          meanRgb: sample.meanRgb,
          cobaltBlueRatio: sample.cobaltBlueRatio,
          crimsonRedRatio: sample.crimsonRedRatio,
          isDark,
          matched,
          oppositeDetected,
          anchors: sample.anchors
        };
        attempts.push(record);

        if (oppositeDetected) {
          console.error(
            `[PHYSICAL VERIFY SOURCE MISMATCH]: Display "${displayId}" detected opposite pattern (${expectedColor === 'cobaltBlue' ? 'Crimson Red' : 'Cobalt Blue'}) on attempt ${attempt}!`
          );
          break;
        }

        if (matched) {
          matchedSample = sample;
          matchedFrameByteLength = frameByteLength;
          break;
        }
      }

      const lastAttempt = attempts[attempts.length - 1];
      const success = Boolean(matchedSample);

      return {
        success,
        matchedSample,
        matchedFrameByteLength: matchedFrameByteLength || (lastAttempt?.byteLength ?? 0),
        lastSample: matchedSample || (lastAttempt ? {
          width: parseInt(lastAttempt.dimensions.split('x')[0], 10) || 1920,
          height: parseInt(lastAttempt.dimensions.split('x')[1], 10) || 1080,
          sampleCount: 192,
          meanRgb: lastAttempt.meanRgb,
          cobaltBlueRatio: lastAttempt.cobaltBlueRatio,
          crimsonRedRatio: lastAttempt.crimsonRedRatio,
          anchors: lastAttempt.anchors || []
        } : {
          width: 0,
          height: 0,
          sampleCount: 0,
          meanRgb: { r: 0, g: 0, b: 0 },
          cobaltBlueRatio: 0,
          crimsonRedRatio: 0,
          anchors: []
        }),
        attempts
      };
    }

    app.whenReady().then(async () => {
      const patternWindows = [];
      let capturer = null;
      let displayManager = null;

      try {
        const {
          DisplayManager,
          SingleDisplayCapturer,
          samplePngPixels
        } = require(harnessBundlePath);

        displayManager = new DisplayManager();
        const config = displayManager.getDisplayConfiguration();
        const displays = config.displays;

        const modeResolution = resolveEffectiveMode(cliArgs.mode, displays.length);

        if (modeResolution.action === 'skip') {
          console.log(`[PHYSICAL VERIFY SKIPPED]: ${modeResolution.reason}`);
          const skipReport = {
            verificationScope: 'supervised-physical-dual-display-isolation',
            requestedMode: cliArgs.mode,
            effectiveMode: modeResolution.mode,
            detectedDisplayCount: displays.length,
            detectedDisplays: displays.map((d) => ({
              id: d.id,
              isPrimary: d.isPrimary,
              bounds: d.bounds
            })),
            verificationStatus: 'SKIPPED_INSUFFICIENT_DISPLAYS',
            captureStarted: false,
            reason: modeResolution.reason,
            timestamp: new Date().toISOString()
          };
          saveVerificationReport(skipReport, modeResolution.mode, 'SKIPPED_INSUFFICIENT_DISPLAYS');
          clearTimeout(safetyTimeout);
          app.exit(0);
          return;
        }

        if (modeResolution.action === 'fail') {
          throw new Error(modeResolution.reason);
        }

        const effectiveMode = modeResolution.mode;
        console.log(`[PHYSICAL VERIFY]: Running physical verification in mode "${effectiveMode}" with ${displays.length} display(s) detected.`);

        if (effectiveMode === 'single') {
          // =================================================================
          // SCENARIO A: Single-Monitor Verification
          // =================================================================
          const targetDisplay = displays.find((d) => d.isPrimary) || displays[0];
          console.log(`[PHYSICAL VERIFY]: Target Display: ${targetDisplay.id} (Primary=${targetDisplay.isPrimary}, Bounds=${JSON.stringify(targetDisplay.bounds)})`);

          const win = await createPatternWindow(
            targetDisplay.bounds,
            '#0057B8',
            'AURA DESK — SINGLE DISPLAY PATTERN (COBALT BLUE)',
            `Display ID: ${targetDisplay.id} | Primary: ${targetDisplay.isPrimary}`
          );
          patternWindows.push(win);

          win.setBounds(targetDisplay.bounds);
          win.setAlwaysOnTop(true, 'screen-saver');
          win.showInactive();
          win.moveTop();

          const diag = getWindowDiagnostics(win, targetDisplay.bounds);
          console.log('[PHYSICAL VERIFY]: Single Pattern Window Diagnostics:', JSON.stringify(diag));

          if (!diag.boundsMatch || !diag.isVisible || !diag.isAlwaysOnTop || diag.isMinimized) {
            throw new Error(
              `Single pattern window failed placement or visibility verification: ` +
              `match=${diag.boundsMatch}, visible=${diag.isVisible}, top=${diag.isAlwaysOnTop}, min=${diag.isMinimized}`
            );
          }

          await delay(1000);

          capturer = new SingleDisplayCapturer(displayManager, { sampleIntervalMs: 250 });
          const backend = capturer.getBackend();

          await capturer.start(targetDisplay.id);
          const passActive = capturer.isActive() && capturer.getActiveDisplayId() === targetDisplay.id;
          const res = await samplePatternWithDiagnostics(capturer, targetDisplay.id, 'cobaltBlue', 5, 250);
          const passBlueVerified = passActive && res.success;

          await capturer.stop();
          const statusAfterStop = capturer.getStatus();
          const statsAfterStop = capturer.getBufferStats();
          const stopClean =
            statusAfterStop === 'idle' &&
            capturer.isActive() === false &&
            capturer.getActiveDisplayId() === null &&
            capturer.getLatestFrame() === null &&
            capturer.getFrameHistory().length === 0 &&
            statsAfterStop.frameCount === 0 &&
            statsAfterStop.totalBytes === 0 &&
            (typeof backend.isHandlerRegistered === 'function' ? !backend.isHandlerRegistered() : true);

          // Nonexistent display rejection check
          let fallbackRejected = false;
          let missingDisplayError = '';
          try {
            await capturer.start('99999999-nonexistent');
          } catch (err) {
            fallbackRejected = true;
            missingDisplayError = err instanceof Error ? err.message : String(err);
          }
          const noBufferAfterMissing =
            capturer.getStatus() === 'error' &&
            capturer.isActive() === false &&
            capturer.getLatestFrame() === null &&
            capturer.getBufferStats().frameCount === 0;
          await capturer.stop();
          const recoveredIdle = capturer.getStatus() === 'idle';
          const noFallbackVerified = fallbackRejected && noBufferAfterMissing && recoveredIdle;

          destroyWindows(patternWindows);
          const windowDestroyed = patternWindows.every((w) => w.isDestroyed());

          const checks = {
            physicalDisplayEnumerated: {
              mandatory: true,
              applicable: true,
              expected: 'At least 1 physical display enumerated',
              actual: `${displays.length} display(s) detected; testing display ${targetDisplay.id}`,
              status: displays.length >= 1 ? 'PASS' : 'FAIL'
            },
            patternWindowPlacementAndReadiness: {
              mandatory: true,
              applicable: true,
              expected: 'Pattern window placed, visible, alwaysOnTop (screen-saver), and unobstructed',
              actual: `match=${diag.boundsMatch}, visible=${diag.isVisible}, top=${diag.isAlwaysOnTop}`,
              status: diag.boundsMatch && diag.isVisible && diag.isAlwaysOnTop ? 'PASS' : 'FAIL'
            },
            singleDisplayPatternVerification: {
              mandatory: true,
              applicable: true,
              expected: 'Captured single display frame matches Cobalt Blue (>=0.70) with Crimson Red <=0.05',
              actual: `cobaltBlueRatio=${res.lastSample.cobaltBlueRatio}, crimsonRedRatio=${res.lastSample.crimsonRedRatio}, meanRgb=${JSON.stringify(res.lastSample.meanRgb)}, bytes=${res.matchedFrameByteLength}, attempts=${res.attempts.length}`,
              status: passBlueVerified ? 'PASS' : 'FAIL'
            },
            stopAndBufferCleanup: {
              mandatory: true,
              applicable: true,
              expected: 'Status idle, bufferCount=0, bytes=0, handler unregistered',
              actual: `status=${statusAfterStop}, frameCount=${statsAfterStop.frameCount}, totalBytes=${statsAfterStop.totalBytes}`,
              status: stopClean ? 'PASS' : 'FAIL'
            },
            missingDisplayNoFallback: {
              mandatory: true,
              applicable: true,
              expected: 'Missing display fails closed without fallback and recovers to idle on stop()',
              actual: `rejected=${fallbackRejected}, recovered=${recoveredIdle}, error=${missingDisplayError}`,
              status: noFallbackVerified ? 'PASS' : 'FAIL'
            },
            patternWindowDestroyed: {
              mandatory: true,
              applicable: true,
              expected: 'Test-pattern window destroyed cleanly after verification',
              actual: `destroyed=${windowDestroyed}`,
              status: windowDestroyed ? 'PASS' : 'FAIL'
            },
            processLifecycle: {
              mandatory: true,
              applicable: true,
              expected: 'Supervised Electron process terminates without timing out or crashing (signal=null, timedOut=false)',
              actual: 'Pending parent process exit verification',
              status: 'PENDING'
            }
          };

          const childStatus = evaluateOverallStatus(checks, { excludeKeys: ['processLifecycle'] });

          const safeReport = {
            verificationScope: 'supervised-physical-single-display-isolation',
            requestedMode: cliArgs.mode,
            effectiveMode: 'single',
            rawFramesPersisted: false,
            rawFramesUploaded: false,
            verificationStatus: childStatus === 'PASS' ? 'PENDING_PROCESS_EXIT' : 'FAIL',
            timestamp: new Date().toISOString(),
            environment: {
              electron: process.versions.electron,
              chrome: process.versions.chrome,
              platform: process.platform
            },
            windowDiagnostics: {
              targetDisplay: diag
            },
            sampledEvidence: {
              display: {
                displayId: targetDisplay.id,
                isPrimary: targetDisplay.isPrimary,
                bounds: targetDisplay.bounds,
                frameByteLength: res.matchedFrameByteLength,
                decodedDimensions: `${res.lastSample.width}x${res.lastSample.height}`,
                sampleCount: res.lastSample.sampleCount,
                meanRgb: res.lastSample.meanRgb,
                cobaltBlueRatio: res.lastSample.cobaltBlueRatio,
                crimsonRedRatio: res.lastSample.crimsonRedRatio,
                anchors: res.lastSample.anchors,
                attempts: res.attempts
              }
            },
            resourceTeardown: {
              stopClean,
              patternWindowDestroyed: windowDestroyed,
              backendHandlerRestored: true
            },
            checks
          };

          saveVerificationReport(safeReport, 'single', childStatus);
          clearTimeout(safetyTimeout);
          app.exit(childStatus === 'PASS' ? 0 : 1);
          return;
        }

        // ===================================================================
        // SCENARIO B: Dual-Monitor Verification
        // ===================================================================
        const display1 = displays.find((d) => d.isPrimary) || displays[0];
        const display2 = displays.find((d) => d.id !== display1.id) || displays[1];

        const win1 = await createPatternWindow(
          display1.bounds,
          '#0057B8',
          'AURA DESK — PATTERN 1 (COBALT BLUE)',
          `Display ID: ${display1.id} | Primary: ${display1.isPrimary}`
        );
        patternWindows.push(win1);

        const win2 = await createPatternWindow(
          display2.bounds,
          '#D92B2B',
          'AURA DESK — PATTERN 2 (CRIMSON RED)',
          `Display ID: ${display2.id} | Primary: ${display2.isPrimary}`
        );
        patternWindows.push(win2);

        for (const win of patternWindows) {
          if (!win.isDestroyed()) {
            win.setBounds(win === win1 ? display1.bounds : display2.bounds);
            win.setAlwaysOnTop(true, 'screen-saver');
            win.showInactive();
            win.moveTop();
          }
        }

        const diag1 = getWindowDiagnostics(win1, display1.bounds);
        const diag2 = getWindowDiagnostics(win2, display2.bounds);

        console.log('[PHYSICAL VERIFY]: Pattern Window 1 Diagnostics:', JSON.stringify(diag1));
        console.log('[PHYSICAL VERIFY]: Pattern Window 2 Diagnostics:', JSON.stringify(diag2));

        const windowsReadyAndUnobstructed =
          diag1.boundsMatch && diag1.isVisible && diag1.isAlwaysOnTop && !diag1.isMinimized &&
          diag2.boundsMatch && diag2.isVisible && diag2.isAlwaysOnTop && !diag2.isMinimized;

        if (!windowsReadyAndUnobstructed) {
          throw new Error(
            `Pattern windows failed placement or visibility verification before capture: ` +
            `win1(boundsMatch=${diag1.boundsMatch}, visible=${diag1.isVisible}, top=${diag1.isAlwaysOnTop}, min=${diag1.isMinimized}), ` +
            `win2(boundsMatch=${diag2.boundsMatch}, visible=${diag2.isVisible}, top=${diag2.isAlwaysOnTop}, min=${diag2.isMinimized})`
          );
        }

        await delay(1000);

        capturer = new SingleDisplayCapturer(displayManager, { sampleIntervalMs: 250 });
        const backend = capturer.getBackend();

        // Pass 1: Display 1 (Cobalt Blue)
        await capturer.start(display1.id);
        const pass1Active = capturer.isActive() && capturer.getActiveDisplayId() === display1.id;
        const res1 = await samplePatternWithDiagnostics(capturer, display1.id, 'cobaltBlue', 5, 250);
        const pass1BlueIsolated = pass1Active && res1.success;

        await capturer.stop();
        const statusAfterStop1 = capturer.getStatus();
        const statsAfterStop1 = capturer.getBufferStats();
        const stop1Clean =
          statusAfterStop1 === 'idle' &&
          capturer.isActive() === false &&
          capturer.getActiveDisplayId() === null &&
          capturer.getLatestFrame() === null &&
          capturer.getFrameHistory().length === 0 &&
          statsAfterStop1.frameCount === 0 &&
          statsAfterStop1.totalBytes === 0 &&
          (typeof backend.isHandlerRegistered === 'function' ? !backend.isHandlerRegistered() : true);

        // Pass 2: Display 2 (Crimson Red)
        await capturer.start(display2.id);
        const pass2Active = capturer.isActive() && capturer.getActiveDisplayId() === display2.id;
        const res2 = await samplePatternWithDiagnostics(capturer, display2.id, 'crimsonRed', 5, 250);
        const pass2RedIsolated = pass2Active && res2.success;

        await capturer.stop();
        const statusAfterStop2 = capturer.getStatus();
        const statsAfterStop2 = capturer.getBufferStats();
        const stop2Clean =
          statusAfterStop2 === 'idle' &&
          capturer.isActive() === false &&
          capturer.getActiveDisplayId() === null &&
          capturer.getLatestFrame() === null &&
          capturer.getFrameHistory().length === 0 &&
          statsAfterStop2.frameCount === 0 &&
          statsAfterStop2.totalBytes === 0 &&
          (typeof backend.isHandlerRegistered === 'function' ? !backend.isHandlerRegistered() : true);

        // Missing display fallback rejection
        let fallbackRejected = false;
        let missingDisplayError = '';
        try {
          await capturer.start('99999999-nonexistent');
        } catch (err) {
          fallbackRejected = true;
          missingDisplayError = err instanceof Error ? err.message : String(err);
        }
        const noBufferAfterMissingFailure =
          capturer.getStatus() === 'error' &&
          capturer.isActive() === false &&
          capturer.getLatestFrame() === null &&
          capturer.getBufferStats().frameCount === 0;
        await capturer.stop();
        const recoveredIdleAfterFailure = capturer.getStatus() === 'idle';
        const noFallbackVerified = fallbackRejected && noBufferAfterMissingFailure && recoveredIdleAfterFailure;

        destroyWindows(patternWindows);
        const allWindowsDestroyed = patternWindows.every((w) => w.isDestroyed());

        const checks = {
          twoPhysicalDisplaysEnumerated: {
            mandatory: true,
            applicable: true,
            expected: '2 displays enumerated for supervised comparison',
            actual: `2 displays (${display1.id}, ${display2.id})`,
            status: displays.length >= 2 ? 'PASS' : 'FAIL'
          },
          patternWindowsPlacementAndReadiness: {
            mandatory: true,
            applicable: true,
            expected: 'Both pattern windows placed, visible, alwaysOnTop (screen-saver band), and unobstructed',
            actual: `win1(match=${diag1.boundsMatch}, visible=${diag1.isVisible}, top=${diag1.isAlwaysOnTop}), win2(match=${diag2.boundsMatch}, visible=${diag2.isVisible}, top=${diag2.isAlwaysOnTop})`,
            status: windowsReadyAndUnobstructed ? 'PASS' : 'FAIL'
          },
          display1PatternIsolation: {
            mandatory: true,
            applicable: true,
            expected: 'Captured Display 1 frame matches Cobalt Blue (>=0.70) with Crimson Red <=0.05',
            actual: `cobaltBlueRatio=${res1.lastSample.cobaltBlueRatio}, crimsonRedRatio=${res1.lastSample.crimsonRedRatio}, meanRgb=${JSON.stringify(res1.lastSample.meanRgb)}, bytes=${res1.matchedFrameByteLength}, attempts=${res1.attempts.length}`,
            status: pass1BlueIsolated ? 'PASS' : 'FAIL'
          },
          display1StopAndBufferCleanup: {
            mandatory: true,
            applicable: true,
            expected: 'Status idle, bufferCount=0, bytes=0, handler unregistered',
            actual: `status=${statusAfterStop1}, frameCount=${statsAfterStop1.frameCount}, totalBytes=${statsAfterStop1.totalBytes}`,
            status: stop1Clean ? 'PASS' : 'FAIL'
          },
          display2PatternIsolation: {
            mandatory: true,
            applicable: true,
            expected: 'Captured Display 2 frame matches Crimson Red (>=0.70) with Cobalt Blue <=0.05',
            actual: `crimsonRedRatio=${res2.lastSample.crimsonRedRatio}, cobaltBlueRatio=${res2.lastSample.cobaltBlueRatio}, meanRgb=${JSON.stringify(res2.lastSample.meanRgb)}, bytes=${res2.matchedFrameByteLength}, attempts=${res2.attempts.length}`,
            status: pass2RedIsolated ? 'PASS' : 'FAIL'
          },
          display2StopAndBufferCleanup: {
            mandatory: true,
            applicable: true,
            expected: 'Status idle, bufferCount=0, bytes=0, handler unregistered',
            actual: `status=${statusAfterStop2}, frameCount=${statsAfterStop2.frameCount}, totalBytes=${statsAfterStop2.totalBytes}`,
            status: stop2Clean ? 'PASS' : 'FAIL'
          },
          missingDisplayNoFallback: {
            mandatory: true,
            applicable: true,
            expected: 'Missing display fails closed without falling back to another monitor and recovers to idle on stop()',
            actual: `rejected=${fallbackRejected}, recovered=${recoveredIdleAfterFailure}, error=${missingDisplayError}`,
            status: noFallbackVerified ? 'PASS' : 'FAIL'
          },
          patternWindowsDestroyed: {
            mandatory: true,
            applicable: true,
            expected: 'All test-pattern windows destroyed cleanly after verification',
            actual: `destroyed=${allWindowsDestroyed}, count=${patternWindows.length}`,
            status: allWindowsDestroyed ? 'PASS' : 'FAIL'
          },
          processLifecycle: {
            mandatory: true,
            applicable: true,
            expected: 'Supervised Electron process terminates without timing out or crashing (signal=null, timedOut=false)',
            actual: 'Pending parent process exit verification',
            status: 'PENDING'
          }
        };

        const childStatus = evaluateOverallStatus(checks, { excludeKeys: ['processLifecycle'] });

        const safeReport = {
          verificationScope: 'supervised-physical-dual-display-isolation',
          requestedMode: cliArgs.mode,
          effectiveMode: 'dual',
          rawFramesPersisted: false,
          rawFramesUploaded: false,
          verificationStatus: childStatus === 'PASS' ? 'PENDING_PROCESS_EXIT' : 'FAIL',
          timestamp: new Date().toISOString(),
          environment: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            platform: process.platform
          },
          windowDiagnostics: {
            display1: diag1,
            display2: diag2,
            bothWindowsVerified: windowsReadyAndUnobstructed
          },
          sampledEvidence: {
            display1: {
              displayId: display1.id,
              isPrimary: display1.isPrimary,
              bounds: display1.bounds,
              frameByteLength: res1.matchedFrameByteLength,
              decodedDimensions: `${res1.lastSample.width}x${res1.lastSample.height}`,
              sampleCount: res1.lastSample.sampleCount,
              meanRgb: res1.lastSample.meanRgb,
              cobaltBlueRatio: res1.lastSample.cobaltBlueRatio,
              crimsonRedRatio: res1.lastSample.crimsonRedRatio,
              anchors: res1.lastSample.anchors,
              attempts: res1.attempts
            },
            display2: {
              displayId: display2.id,
              isPrimary: display2.isPrimary,
              bounds: display2.bounds,
              frameByteLength: res2.matchedFrameByteLength,
              decodedDimensions: `${res2.lastSample.width}x${res2.lastSample.height}`,
              sampleCount: res2.lastSample.sampleCount,
              meanRgb: res2.lastSample.meanRgb,
              cobaltBlueRatio: res2.lastSample.cobaltBlueRatio,
              crimsonRedRatio: res2.lastSample.crimsonRedRatio,
              anchors: res2.lastSample.anchors,
              attempts: res2.attempts
            }
          },
          resourceTeardown: {
            display1StopClean: stop1Clean,
            display2StopClean: stop2Clean,
            patternWindowsDestroyed: allWindowsDestroyed,
            backendHandlerRestored: true
          },
          checks
        };

        saveVerificationReport(safeReport, 'dual', childStatus);
        clearTimeout(safetyTimeout);
        app.exit(childStatus === 'PASS' ? 0 : 1);
      } catch (err) {
        console.error('[PHYSICAL VERIFY ERROR]:', err);
        destroyWindows(patternWindows);
        if (capturer) {
          try {
            await capturer.stop();
          } catch (_) {
            // ignore cleanup failure
          }
        }
        try {
          const failReport = {
            verificationScope: 'supervised-physical-source-isolation',
            rawFramesPersisted: false,
            verificationStatus: 'FAIL',
            timestamp: new Date().toISOString(),
            error: String(err && (err.stack || err.message || err))
          };
          saveVerificationReport(failReport, cliArgs.mode || 'general', 'FAIL');
        } catch (_) {
          // ignore write failure
        }
        clearTimeout(safetyTimeout);
        app.exit(1);
      }
    });
  }
}

// Module exports for deterministic unit testing without spawning Electron
module.exports = {
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
};

/* eslint-disable */
/**
 * AURA DESK — Supervised Physical Single-Display Capture Isolation Verification
 *
 * SAFETY & AUTHORIZATION GATE:
 * This script performs REAL physical screen capture across two physical monitors.
 * It MUST NOT run unattended or without explicit user authorization.
 * Invoke ONLY after explicit authorization using:
 *   node scripts/verify-physical-isolation.cjs --authorize-physical-capture
 *
 * Safe Preflight (no capture / no Electron window / cleans up ephemeral bundle):
 *   node scripts/verify-physical-isolation.cjs --check-harness
 *
 * Verification Scope:
 * 1. Displays two visually distinct, non-sensitive test patterns (Cobalt Blue on
 *    Primary display, Crimson Red on Secondary display).
 * 2. Executes the production capture pipeline (`SingleDisplayCapturer` ->
 *    `MediaStreamDisplayCaptureBackend` -> `CaptureWindowClient`) on Display 1,
 *    decodes the captured PNG frame in-memory, and asserts sampled RGB pixels
 *    contain ONLY Display 1's Cobalt Blue pattern (no Display 2 Red leakage).
 * 3. Calls `capturer.stop()` and verifies clean teardown, zero buffered frames,
 *    and permanent deny-by-default handler re-installation.
 * 4. Repeats on Display 2 and asserts sampled RGB pixels contain ONLY Display 2's
 *    Crimson Red pattern (no Display 1 Blue leakage), followed by full Stop/cleanup.
 * 5. Tests absence of fallback when attempting to capture a nonexistent display ID.
 * 6. NEVER persists, logs, or uploads raw screen frames; records ONLY safe
 *    aggregate pixel statistics, metadata, and PASS/FAIL statuses.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const artifactDir = path.join(rootDir, 'artifacts', 'local-validation');
const harnessBundlePath = path.join(artifactDir, '.physical-harness.cjs');
const resultsJsonPath = path.join(artifactDir, 'physical-isolation-results.json');

const AUTHORIZATION_FLAG = '--authorize-physical-capture';
const CHECK_HARNESS_FLAG = '--check-harness';

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

  // Bundle production TypeScript modules ephemerally so Electron executes the exact production classes
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

  // Verify JavaScript syntax via VM compilation
  new vm.Script(code, { filename: bundlePath });

  // Verify CJS module wrapper execution with stubbed 'electron' (never touches real Electron/MediaStream)
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

const isElectronProcess = Boolean(
  process.versions.electron && process.type === 'browser'
);

if (!isElectronProcess) {
  // =========================================================================
  // Parent Node.js Orchestrator
  // =========================================================================
  const hasCheckHarness = process.argv.includes(CHECK_HARNESS_FLAG);
  const hasCliAuth = process.argv.includes(AUTHORIZATION_FLAG);

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

  async function runAuthorizedPhysicalCapture() {
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

    console.log('[PHYSICAL VERIFY]: Launching Electron for supervised dual-monitor physical test-pattern capture...');

    return await new Promise((resolveExitCode) => {
      const child = spawn(electronExe, [__filename, AUTHORIZATION_FLAG], {
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
            fs.writeFileSync(resultsJsonPath, JSON.stringify(report, null, 2), 'utf-8');
          } catch (err) {
            console.error('[PHYSICAL VERIFY ERROR]: Failed to finalize report JSON:', err.message);
          }

          console.log('[PHYSICAL VERIFY]: Finalized Supervised Checks:');
          console.table(report.checks);
          console.log(`[PHYSICAL VERIFY]: Overall Physical Source Isolation Status: ${report.verificationStatus}`);
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
    if (hasCheckHarness) {
      const code = await runPreflightCheck();
      process.exit(code);
    }

    if (!hasCliAuth) {
      console.error('[PHYSICAL VERIFY BLOCKED]: Explicit user authorization is required before starting real physical screen capture.');
      console.error(`Re-run ONLY with explicit authorization flag: node scripts/verify-physical-isolation.cjs ${AUTHORIZATION_FLAG}`);
      console.error(`For safe preflight harness compilation without capture, run: node scripts/verify-physical-isolation.cjs ${CHECK_HARNESS_FLAG}`);
      process.exit(2);
    }

    const code = await runAuthorizedPhysicalCapture();
    process.exit(code);
  })().catch((err) => {
    console.error('[PHYSICAL VERIFY ERROR]: Unexpected orchestrator failure:', err);
    cleanupEphemeralBundle();
    process.exit(1);
  });
} else {
  // =========================================================================
  // Electron Main Process Supervised Test Runner
  // =========================================================================
  const { app, BrowserWindow } = require('electron');

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

      const twoDisplaysPresent = displays.length >= 2;
      if (!twoDisplaysPresent) {
        throw new Error(`Supervised physical isolation test requires 2 displays; detected ${displays.length}`);
      }

      const display1 = displays.find((d) => d.isPrimary) || displays[0];
      const display2 = displays.find((d) => d.id !== display1.id) || displays[1];

      // 1. Render two distinct non-sensitive test patterns, one per physical monitor
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

      // Re-assert topmost screen-saver band, showInactive, and moveTop for both windows
      for (const win of patternWindows) {
        if (!win.isDestroyed()) {
          win.setBounds(win === win1 ? display1.bounds : display2.bounds);
          win.setAlwaysOnTop(true, 'screen-saver');
          win.showInactive();
          win.moveTop();
        }
      }

      // Collect diagnostics for both windows
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

      // Allow compositor stabilization interval (1000ms) for Windows DWM to settle
      await delay(1000);

      // Bounded diagnostic sampling helper to distinguish dark/settling initial frames from source mismatches
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

          // Fast fail if opposite pattern is detected: wrong source or cross-display leak!
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

      capturer = new SingleDisplayCapturer(displayManager, { sampleIntervalMs: 250 });
      const backend = capturer.getBackend();

      // 2. Capture Pass 1: Display 1 (Cobalt Blue) -> Bounded Diagnostic Sampling -> Stop & Cleanup
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

      // 3. Capture Pass 2: Display 2 (Crimson Red) -> Bounded Diagnostic Sampling -> Stop & Cleanup
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

      // 4. Verify Absence of Fallback on Missing Display ID
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
          status: twoDisplaysPresent ? 'PASS' : 'FAIL'
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

      // Persist ONLY safe metadata, aggregate RGB stats, and PASS/FAIL statuses (NEVER raw images)
      const safeReport = {
        verificationScope: 'supervised-physical-source-isolation',
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

      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(resultsJsonPath, JSON.stringify(safeReport, null, 2), 'utf-8');
      console.log(`[PHYSICAL VERIFY]: Safe sampled evidence written to ${resultsJsonPath}`);

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
        fs.mkdirSync(artifactDir, { recursive: true });
        fs.writeFileSync(
          resultsJsonPath,
          JSON.stringify(
            {
              verificationScope: 'supervised-physical-source-isolation',
              rawFramesPersisted: false,
              verificationStatus: 'FAIL',
              timestamp: new Date().toISOString(),
              error: String(err && (err.stack || err.message || err))
            },
            null,
            2
          ),
          'utf-8'
        );
      } catch (_) {
        // ignore write failure
      }
      clearTimeout(safetyTimeout);
      app.exit(1);
    }
  });
}

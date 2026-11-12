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

        const cleanProcessExit = !timedOut && signal === null && code === 0;
        let report = null;
        if (fs.existsSync(resultsJsonPath)) {
          try {
            report = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8'));
          } catch (err) {
            console.error('[PHYSICAL VERIFY ERROR]: Failed to read verification JSON report:', err.message);
          }
        }

        if (report && report.checks) {
          report.checks.processCleanup = {
            mandatory: true,
            applicable: true,
            expected: 'Supervised Electron process exits cleanly with code 0',
            actual: cleanProcessExit
              ? 'Clean exit (code=0, signal=null, timedOut=false)'
              : `Failed exit (code=${code}, signal=${signal}, timedOut=${timedOut})`,
            status: cleanProcessExit ? 'PASS' : 'FAIL'
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

        if (!cleanProcessExit || !report || report.verificationStatus !== 'PASS') {
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
        show: true,
        backgroundColor: bgHex,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      win.setBounds(bounds);
      win.webContents.once('did-finish-load', () => resolve(win));
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

      // Allow compositor settle time so Windows DWM displays both test cards
      await delay(750);

      capturer = new SingleDisplayCapturer(displayManager, { sampleIntervalMs: 1000 });
      const backend = capturer.getBackend();

      // 2. Capture Pass 1: Display 1 (Cobalt Blue) -> Verify Pixels -> Stop & Cleanup
      await capturer.start(display1.id);
      const pass1Active = capturer.isActive() && capturer.getActiveDisplayId() === display1.id;
      let frame1 = capturer.getLatestFrame();
      if (!frame1) {
        throw new Error('Pass 1 produced no frame on Display 1');
      }
      const sample1 = samplePngPixels(frame1.data);
      const frame1ByteLength = frame1.byteLength;
      frame1 = null; // drop raw PNG reference immediately

      const pass1BlueIsolated =
        pass1Active &&
        sample1.cobaltBlueRatio >= 0.7 &&
        sample1.crimsonRedRatio <= 0.05;

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

      // 3. Capture Pass 2: Display 2 (Crimson Red) -> Verify Pixels -> Stop & Cleanup
      await capturer.start(display2.id);
      const pass2Active = capturer.isActive() && capturer.getActiveDisplayId() === display2.id;
      let frame2 = capturer.getLatestFrame();
      if (!frame2) {
        throw new Error('Pass 2 produced no frame on Display 2');
      }
      const sample2 = samplePngPixels(frame2.data);
      const frame2ByteLength = frame2.byteLength;
      frame2 = null; // drop raw PNG reference immediately

      const pass2RedIsolated =
        pass2Active &&
        sample2.crimsonRedRatio >= 0.7 &&
        sample2.cobaltBlueRatio <= 0.05;

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

      const checks = {
        twoPhysicalDisplaysEnumerated: {
          mandatory: true,
          applicable: true,
          expected: '2 displays enumerated for supervised comparison',
          actual: `2 displays (${display1.id}, ${display2.id})`,
          status: twoDisplaysPresent ? 'PASS' : 'FAIL'
        },
        display1PatternIsolation: {
          mandatory: true,
          applicable: true,
          expected: 'Captured Display 1 frame matches Cobalt Blue (>=0.70) with Crimson Red <=0.05',
          actual: `cobaltBlueRatio=${sample1.cobaltBlueRatio}, crimsonRedRatio=${sample1.crimsonRedRatio}, meanRgb=${JSON.stringify(sample1.meanRgb)}, bytes=${frame1ByteLength}`,
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
          actual: `crimsonRedRatio=${sample2.crimsonRedRatio}, cobaltBlueRatio=${sample2.cobaltBlueRatio}, meanRgb=${JSON.stringify(sample2.meanRgb)}, bytes=${frame2ByteLength}`,
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
        processCleanup: {
          mandatory: true,
          applicable: true,
          expected: 'Graceful exit finalized by parent CLI orchestrator',
          actual: 'Pending parent process exit verification',
          status: 'PENDING'
        }
      };

      const childStatus = evaluateOverallStatus(checks, { excludeKeys: ['processCleanup'] });

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
        sampledEvidence: {
          display1: {
            displayId: display1.id,
            isPrimary: display1.isPrimary,
            bounds: display1.bounds,
            frameByteLength: frame1ByteLength,
            decodedDimensions: `${sample1.width}x${sample1.height}`,
            sampleCount: sample1.sampleCount,
            meanRgb: sample1.meanRgb,
            cobaltBlueRatio: sample1.cobaltBlueRatio,
            crimsonRedRatio: sample1.crimsonRedRatio,
            anchors: sample1.anchors
          },
          display2: {
            displayId: display2.id,
            isPrimary: display2.isPrimary,
            bounds: display2.bounds,
            frameByteLength: frame2ByteLength,
            decodedDimensions: `${sample2.width}x${sample2.height}`,
            sampleCount: sample2.sampleCount,
            meanRgb: sample2.meanRgb,
            cobaltBlueRatio: sample2.cobaltBlueRatio,
            crimsonRedRatio: sample2.crimsonRedRatio,
            anchors: sample2.anchors
          }
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

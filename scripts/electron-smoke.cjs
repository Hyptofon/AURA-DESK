/* eslint-disable */
/**
 * AURA DESK - Autonomous Electron Runtime Smoke Verification
 *
 * Verifies that the real Electron desktop application launches, loads the
 * sandboxed CommonJS preload bridge (index.cjs), properly exposes `window.api`,
 * successfully executes real IPC calls (getDisplays, getSessionState),
 * and captures an authentic window screenshot.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isElectronProcess = Boolean(
  process.versions.electron && process.type === 'browser'
);

if (!isElectronProcess) {
  // =========================================================================
  // CLI Orchestrator: Runs under Node.js CLI to spawn Electron binary
  // =========================================================================
  const rootDir = path.resolve(__dirname, '..');
  const mainBundle = path.join(rootDir, 'out', 'main', 'index.js');
  const preloadBundle = path.join(rootDir, 'out', 'preload', 'index.cjs');
  const rendererIndex = path.join(rootDir, 'out', 'renderer', 'index.html');

  if (!fs.existsSync(mainBundle) || !fs.existsSync(preloadBundle) || !fs.existsSync(rendererIndex)) {
    console.error('[SMOKE ERROR]: Build artifacts missing. Please run `npm run build` before executing smoke test.');
    console.error('Expected:');
    console.error(' -', mainBundle, fs.existsSync(mainBundle) ? '✓' : 'MISSING');
    console.error(' -', preloadBundle, fs.existsSync(preloadBundle) ? '✓' : 'MISSING');
    console.error(' -', rendererIndex, fs.existsSync(rendererIndex) ? '✓' : 'MISSING');
    process.exit(1);
  }

  // Locate the Electron binary from local node_modules
  const electronExe = process.platform === 'win32'
    ? path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');

  if (!fs.existsSync(electronExe)) {
    console.error(`[SMOKE ERROR]: Electron executable not found at: ${electronExe}`);
    process.exit(1);
  }

  // Ensure clean environment without ELECTRON_RUN_AS_NODE so Electron runs as GUI runtime
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.AURA_SMOKE_HARNESS = '1';

  console.log('[SMOKE HARNESS]: Launching Electron binary:', electronExe);
  console.log('[SMOKE HARNESS]: Runner script:', __filename);

  const child = spawn(electronExe, [__filename], {
    env,
    stdio: 'inherit',
    cwd: rootDir
  });

  const timeoutTimer = setTimeout(() => {
    console.error('[SMOKE ERROR]: Execution timed out after 30 seconds. Terminating Electron process.');
    child.kill('SIGTERM');
    process.exit(1);
  }, 30000);

  child.on('exit', (code, signal) => {
    clearTimeout(timeoutTimer);
    if (signal) {
      console.error(`[SMOKE ERROR]: Electron process terminated by signal: ${signal}`);
      process.exit(1);
    }
    if (code !== 0) {
      console.error(`[SMOKE ERROR]: Electron process exited with non-zero exit code: ${code}`);
      process.exit(code || 1);
    }
    console.log('[SMOKE HARNESS]: Smoke verification completed successfully with exit code 0.');
    process.exit(0);
  });
} else {
  // =========================================================================
  // Electron Main Process Harness: Runs inside Electron
  // =========================================================================
  const { app, BrowserWindow } = require('electron');
  const { pathToFileURL } = require('node:url');

  const rootDir = path.resolve(__dirname, '..');
  const artifactDir = path.join(rootDir, 'artifacts', 'local-validation');
  const screenshotPath = path.join(artifactDir, 'electron-app-window.png');
  const resultsJsonPath = path.join(artifactDir, 'electron-runtime-results.json');

  const safetyTimeout = setTimeout(() => {
    console.error('[SMOKE ERROR]: Internal smoke verification safety timeout reached (25s). Exiting.');
    app.exit(1);
  }, 25000);
  safetyTimeout.unref();

  let verificationStarted = false;

  app.on('browser-window-created', (_event, win) => {
    if (verificationStarted) return;
    verificationStarted = true;

    console.log('[SMOKE RUNNER]: Main browser window created. Awaiting did-finish-load...');

    win.webContents.on('did-finish-load', async () => {
      console.log('[SMOKE RUNNER]: Window did-finish-load event received.');

      try {
        // Step 1: Probe window.api structure and types
        const bridgeProbe = await win.webContents.executeJavaScript(`(() => {
          return {
            hasApi: typeof window.api === 'object' && window.api !== null,
            apiType: typeof window.api,
            hasGetDisplays: typeof window.api?.getDisplays === 'function',
            hasGetSessionState: typeof window.api?.getSessionState === 'function',
            hasStartSession: typeof window.api?.startSession === 'function',
            hasStopSession: typeof window.api?.stopSession === 'function',
            hasOnDisplaysChanged: typeof window.api?.onDisplaysChanged === 'function',
            platform: window.api?.platform,
            version: window.api?.version
          };
        })()`);

        console.log('[SMOKE RUNNER]: Bridge probe results:', JSON.stringify(bridgeProbe, null, 2));

        if (!bridgeProbe.hasApi) {
          throw new Error(`window.api is not an object (received: ${bridgeProbe.apiType})`);
        }
        if (!bridgeProbe.hasGetDisplays) {
          throw new Error('window.api.getDisplays is missing or not a function');
        }
        if (!bridgeProbe.hasGetSessionState) {
          throw new Error('window.api.getSessionState is missing or not a function');
        }
        if (!bridgeProbe.hasStartSession) {
          throw new Error('window.api.startSession is missing or not a function');
        }
        if (!bridgeProbe.hasStopSession) {
          throw new Error('window.api.stopSession is missing or not a function');
        }

        // Step 2: Invoke IPC functions from renderer
        const ipcExecution = await win.webContents.executeJavaScript(`(async () => {
          try {
            const displays = await window.api.getDisplays();
            const session = await window.api.getSessionState();
            return {
              ok: true,
              displays,
              session
            };
          } catch (err) {
            return {
              ok: false,
              error: String(err && (err.stack || err.message || err))
            };
          }
        })()`);

        if (!ipcExecution.ok) {
          throw new Error(`Renderer IPC execution failed: ${ipcExecution.error}`);
        }

        console.log(`[SMOKE RUNNER]: IPC getDisplays returned ${ipcExecution.displays.displays.length} displays.`);
        console.log(`[SMOKE RUNNER]: IPC getSessionState returned status: ${ipcExecution.session.status}.`);

        if (!Array.isArray(ipcExecution.displays.displays) || ipcExecution.displays.displays.length === 0) {
          throw new Error('getDisplays() returned 0 displays');
        }
        if (ipcExecution.session.status !== 'idle') {
          throw new Error(`Expected initial session status 'idle', received: ${ipcExecution.session.status}`);
        }

        // Step 3: Capture genuine window screenshot
        fs.mkdirSync(artifactDir, { recursive: true });
        const nativeImage = await win.webContents.capturePage();
        const pngBuffer = nativeImage.toPNG();
        fs.writeFileSync(screenshotPath, pngBuffer);
        console.log(`[SMOKE RUNNER]: Authentic window screenshot saved (${pngBuffer.length} bytes) to: ${screenshotPath}`);

        // Step 4: Write structured verification report
        const report = {
          verificationStatus: 'PASS',
          timestamp: new Date().toISOString(),
          environment: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
            platform: process.platform,
            arch: process.arch
          },
          bridgeProbe,
          displays: {
            count: ipcExecution.displays.displays.length,
            primaryId: ipcExecution.displays.primaryId,
            items: ipcExecution.displays.displays.map((d) => ({
              id: d.id,
              label: d.label,
              bounds: d.bounds
            }))
          },
          sessionState: ipcExecution.session,
          screenshot: {
            path: screenshotPath,
            sizeBytes: pngBuffer.length
          }
        };

        fs.writeFileSync(resultsJsonPath, JSON.stringify(report, null, 2), 'utf-8');
        console.log(`[SMOKE RUNNER]: Verification report written to: ${resultsJsonPath}`);

        clearTimeout(safetyTimeout);
        app.exit(0);
      } catch (err) {
        console.error('[SMOKE ERROR]: Runtime smoke verification failed:', err);
        try {
          fs.mkdirSync(artifactDir, { recursive: true });
          fs.writeFileSync(
            resultsJsonPath,
            JSON.stringify(
              {
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
          // ignore write errors during fatal error reporting
        }
        clearTimeout(safetyTimeout);
        app.exit(1);
      }
    });
  });

  // Dynamically launch the production main entry point
  const productionMainPath = path.join(rootDir, 'out', 'main', 'index.js');
  const mainModuleUrl = pathToFileURL(productionMainPath).href;

  import(mainModuleUrl).catch((err) => {
    console.error('[SMOKE ERROR]: Failed to load production main bundle:', err);
    clearTimeout(safetyTimeout);
    app.exit(1);
  });
}

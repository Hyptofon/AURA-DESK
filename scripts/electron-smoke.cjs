/* eslint-disable */
/**
 * AURA DESK - Autonomous Electron Runtime Smoke Verification & Source Mapping Diagnostic
 *
 * Verifies that the real Electron desktop application launches, loads the
 * sandboxed CommonJS preload bridge (index.cjs), properly exposes `window.api`,
 * executes real IPC calls (getDisplays, getSessionState), inspects metadata-only
 * Windows display-to-capture source resolution (`0x0` thumbnails), verifies clean
 * process termination, and computes overall PASS strictly from every applicable
 * mandatory check (zero hardcoded statuses).
 *
 * Note: Physical pixel-pattern capture isolation is NOT executed here and requires
 * separate explicit user authorization via `scripts/verify-physical-isolation.cjs`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const artifactDir = path.join(rootDir, 'artifacts', 'local-validation');
const screenshotPath = path.join(artifactDir, 'electron-app-window.png');
const resultsJsonPath = path.join(artifactDir, 'electron-runtime-results.json');

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

function resolveCandidateSource(targetDisplay, allDisplays, sources, winDevices) {
  if (!targetDisplay || !targetDisplay.id) {
    return { status: 'UNRESOLVED', reason: 'invalid target display' };
  }

  const displayId = String(targetDisplay.id);
  const hasPopulatedDisplayId = sources.some(
    (s) => s.display_id !== undefined && s.display_id !== null && String(s.display_id).trim() !== ''
  );

  // Strategy 1: Direct display_id match
  const directMatches = sources.filter(
    (s) =>
      s.display_id !== undefined &&
      s.display_id !== null &&
      String(s.display_id).trim() !== '' &&
      String(s.display_id).trim() === displayId
  );

  if (directMatches.length === 1) {
    return {
      status: 'VERIFIED',
      sourceId: directMatches[0].id,
      sourceName: directMatches[0].name,
      strategy: 'exact_display_id_match'
    };
  }

  if (directMatches.length > 1) {
    return { status: 'UNRESOLVED', reason: 'ambiguous duplicate display_id' };
  }

  // Strategy 2: Windows physical device coordinate assumption (ONLY when direct display_id unavailable)
  if (!hasPopulatedDisplayId && Array.isArray(winDevices) && winDevices.length > 0) {
    const displaysWithSameBounds = allDisplays.filter(
      (d) =>
        d.bounds.x === targetDisplay.bounds.x &&
        d.bounds.y === targetDisplay.bounds.y &&
        d.bounds.width === targetDisplay.bounds.width &&
        d.bounds.height === targetDisplay.bounds.height
    );
    if (displaysWithSameBounds.length > 1) {
      return { status: 'UNRESOLVED', reason: 'ambiguous duplicate display bounds' };
    }

    const matchedDevices = winDevices.filter(
      (wd) =>
        wd.bounds.x === targetDisplay.bounds.x &&
        wd.bounds.y === targetDisplay.bounds.y &&
        wd.bounds.width === targetDisplay.bounds.width &&
        wd.bounds.height === targetDisplay.bounds.height
    );

    if (matchedDevices.length > 1) {
      return { status: 'UNRESOLVED', reason: 'ambiguous duplicate Windows device bounds' };
    }

    if (matchedDevices.length === 1) {
      const dev = matchedDevices[0];
      if (!Number.isInteger(dev.displayIndex) || dev.displayIndex < 0) {
        return { status: 'UNRESOLVED', reason: 'invalid Windows device index' };
      }
      const expectedSourceId = `screen:${dev.displayIndex}:0`;
      const matchingSources = sources.filter((s) => s.id === expectedSourceId);
      if (matchingSources.length === 1) {
        return {
          status: 'VERIFIED',
          windowsDevice: dev.deviceName,
          windowsDisplayIndex: dev.displayIndex,
          sourceId: matchingSources[0].id,
          sourceName: matchingSources[0].name,
          strategy: 'windows_device_bounds_match'
        };
      }
      return { status: 'UNRESOLVED', reason: `expected source ${expectedSourceId} missing or duplicated` };
    }
  }

  return { status: 'UNRESOLVED', reason: 'no direct display_id or unique coordinate match' };
}

const isElectronProcess = Boolean(
  process.versions.electron && process.type === 'browser'
);

if (!isElectronProcess) {
  // =========================================================================
  // CLI Orchestrator: Runs under Node.js CLI to spawn Electron binary
  // =========================================================================
  const mainBundle = path.join(rootDir, 'out', 'main', 'index.js');
  const preloadBundle = path.join(rootDir, 'out', 'preload', 'index.cjs');
  const rendererIndex = path.join(rootDir, 'out', 'renderer', 'index.html');

  if (!fs.existsSync(mainBundle) || !fs.existsSync(preloadBundle) || !fs.existsSync(rendererIndex)) {
    console.error('[SMOKE ERROR]: Build artifacts missing. Please run `npm run build` before executing smoke test.');
    console.error('Expected:');
    console.error(' -', mainBundle, fs.existsSync(mainBundle) ? 'OK' : 'MISSING');
    console.error(' -', preloadBundle, fs.existsSync(preloadBundle) ? 'OK' : 'MISSING');
    console.error(' -', rendererIndex, fs.existsSync(rendererIndex) ? 'OK' : 'MISSING');
    process.exit(1);
  }

  const electronExe = process.platform === 'win32'
    ? path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');

  if (!fs.existsSync(electronExe)) {
    console.error(`[SMOKE ERROR]: Electron executable not found at: ${electronExe}`);
    process.exit(1);
  }

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

  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    console.error('[SMOKE ERROR]: Execution timed out after 30 seconds. Terminating Electron process.');
    child.kill('SIGTERM');
  }, 30000);

  child.on('exit', (code, signal) => {
    clearTimeout(timeoutTimer);
    const cleanProcessExit = !timedOut && signal === null && code === 0;

    let report = null;
    if (fs.existsSync(resultsJsonPath)) {
      try {
        report = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8'));
      } catch (err) {
        console.error('[SMOKE ERROR]: Failed to parse child verification report:', err.message);
      }
    }

    if (report && report.evidenceMatrix) {
      report.evidenceMatrix.testProcessCleanup = {
        mandatory: true,
        applicable: true,
        expected: 'Electron process exits cleanly with code 0, no timeout, no signal',
        actual: cleanProcessExit
          ? 'Electron child exited cleanly (code=0, signal=null, timedOut=false)'
          : `Process exit check failed (code=${code}, signal=${signal}, timedOut=${timedOut})`,
        status: cleanProcessExit ? 'PASS' : 'FAIL'
      };
      report.verificationStatus = evaluateOverallStatus(report.evidenceMatrix);

      try {
        fs.writeFileSync(resultsJsonPath, JSON.stringify(report, null, 2), 'utf-8');
      } catch (err) {
        console.error('[SMOKE ERROR]: Failed to write finalized verification report:', err.message);
      }

      console.log('[SMOKE HARNESS]: Finalized Evidence Matrix:');
      console.table(report.evidenceMatrix);
      console.log(`[SMOKE HARNESS]: Overall Verification Status (${report.smokeScope}): ${report.verificationStatus}`);
      console.log(`[SMOKE HARNESS]: Physical Source Isolation Status: ${report.physicalSourceIsolationStatus}`);
    }

    if (!cleanProcessExit) {
      console.error(`[SMOKE ERROR]: Electron process did not exit cleanly (code=${code}, signal=${signal}, timedOut=${timedOut}).`);
      process.exit(code && code !== 0 ? code : 1);
    }

    if (!report || report.verificationStatus !== 'PASS') {
      console.error('[SMOKE ERROR]: One or more mandatory checks failed. Overall smoke verification FAIL.');
      process.exit(1);
    }

    console.log('[SMOKE HARNESS]: Smoke verification completed with overall status PASS.');
    process.exit(0);
  });
} else {
  // =========================================================================
  // Electron Main Process Harness: Runs inside Electron
  // =========================================================================
  const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
  const { pathToFileURL } = require('node:url');

  const safetyTimeout = setTimeout(() => {
    console.error('[SMOKE ERROR]: Internal smoke verification safety timeout reached (25s). Exiting.');
    app.exit(1);
  }, 25000);
  safetyTimeout.unref();

  let verificationStarted = false;

  function queryWindowsPhysicalDevices() {
    if (process.platform !== 'win32') return [];
    try {
      const psScript = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName + \'|\' + $_.Bounds.X + \'|\' + $_.Bounds.Y + \'|\' + $_.Bounds.Width + \'|\' + $_.Bounds.Height + \'|\' + $_.Primary }';
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 5000
      });
      return raw.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const [deviceName, x, y, width, height, primary] = line.split('|');
        const match = deviceName.match(/DISPLAY(\d+)/i);
        const displayIndex = match ? parseInt(match[1], 10) - 1 : null;
        return {
          deviceName: deviceName.trim(),
          displayIndex,
          bounds: {
            x: parseInt(x, 10),
            y: parseInt(y, 10),
            width: parseInt(width, 10),
            height: parseInt(height, 10)
          },
          isPrimary: primary?.toLowerCase() === 'true'
        };
      });
    } catch (err) {
      console.warn('[SMOKE RUNNER]: Windows physical device query warning:', err.message);
      return [];
    }
  }

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
            hasActiveStreamGlobal: Boolean(window.__activeStream),
            platform: window.api?.platform,
            version: window.api?.version
          };
        })()`);

        const bridgeOk = Boolean(
          bridgeProbe.hasApi &&
          bridgeProbe.hasGetDisplays &&
          bridgeProbe.hasGetSessionState &&
          bridgeProbe.hasStartSession &&
          bridgeProbe.hasStopSession &&
          bridgeProbe.hasOnDisplaysChanged
        );

        console.log('[SMOKE RUNNER]: Bridge probe results:', JSON.stringify(bridgeProbe, null, 2));

        // Step 2: Invoke IPC functions from renderer (only if bridge is available)
        let ipcExecution = { ok: false, error: 'Bridge unavailable' };
        if (bridgeOk) {
          ipcExecution = await win.webContents.executeJavaScript(`(async () => {
            try {
              const displays = await window.api.getDisplays();
              const session = await window.api.getSessionState();
              return { ok: true, displays, session };
            } catch (err) {
              return { ok: false, error: String(err && (err.stack || err.message || err)) };
            }
          })()`);
        }

        // Step 3: Capture main application window screenshot (metadata/UI smoke evidence)
        fs.mkdirSync(artifactDir, { recursive: true });
        const nativeImage = await win.webContents.capturePage();
        const pngBuffer = nativeImage.toPNG();
        fs.writeFileSync(screenshotPath, pngBuffer);
        console.log(`[SMOKE RUNNER]: Application window screenshot saved (${pngBuffer.length} bytes) to: ${screenshotPath}`);

        // Step 4: Metadata-Only Display-to-Capture Source Mapping Verification
        console.log('[SMOKE RUNNER]: Initiating metadata-only display-to-source mapping diagnostic...');
        const rawScreenDisplays = screen.getAllDisplays();
        const primaryDisplay = screen.getPrimaryDisplay();

        const ipcBaselineOk = Boolean(
          ipcExecution.ok &&
          Array.isArray(ipcExecution.displays?.displays) &&
          ipcExecution.displays.displays.length === rawScreenDisplays.length &&
          ipcExecution.session?.status === 'idle'
        );

        const rawSources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false
        });

        const thumbnailMeasurements = rawSources.map((s) => {
          const size = s.thumbnail && typeof s.thumbnail.getSize === 'function'
            ? s.thumbnail.getSize()
            : { width: -1, height: -1 };
          const empty = s.thumbnail && typeof s.thumbnail.isEmpty === 'function'
            ? s.thumbnail.isEmpty()
            : false;
          return { id: s.id, width: size.width, height: size.height, isEmpty: empty };
        });
        const allThumbnailsZeroed = thumbnailMeasurements.length > 0 && thumbnailMeasurements.every(
          (t) => t.isEmpty && t.width === 0 && t.height === 0
        );

        const winDevices = queryWindowsPhysicalDevices();
        console.log(`[SMOKE RUNNER]: Enumerated ${rawScreenDisplays.length} Screen API displays, ${rawSources.length} desktopCapturer sources, ${winDevices.length} Windows devices.`);

        const displayInputs = rawScreenDisplays.map((d) => ({
          id: String(d.id),
          isPrimary: d.id === primaryDisplay.id,
          bounds: d.bounds
        }));

        const mappingResults = displayInputs.map((disp) => {
          const resolution = resolveCandidateSource(disp, displayInputs, rawSources, winDevices);
          return {
            displayId: disp.id,
            isPrimary: disp.isPrimary,
            bounds: disp.bounds,
            ...resolution
          };
        });

        console.log('[SMOKE RUNNER]: Display mapping results:\n', JSON.stringify(mappingResults, null, 2));

        // Dynamic negative checks exercising the resolver logic
        const syntheticMissingDisplay = {
          id: '99999999',
          isPrimary: false,
          bounds: { x: 99999, y: 99999, width: 100, height: 100 }
        };
        const missingResolution = resolveCandidateSource(
          syntheticMissingDisplay,
          [...displayInputs, syntheticMissingDisplay],
          rawSources,
          winDevices
        );
        const missingMappingFailsClosed = missingResolution.status === 'UNRESOLVED';

        const primaryMapped = mappingResults.find((m) => m.isPrimary);
        const secondaryMapped = mappingResults.find((m) => !m.isPrimary);
        const hasTwoDisplays = rawScreenDisplays.length >= 2;
        const distinctSources = Boolean(
          hasTwoDisplays &&
          primaryMapped?.status === 'VERIFIED' &&
          secondaryMapped?.status === 'VERIFIED' &&
          primaryMapped.sourceId !== secondaryMapped.sourceId
        );

        // Dynamic mirrored/duplicate bounds rejection check
        const clonedPrimaryDisplay = {
          id: '88888888',
          isPrimary: false,
          bounds: primaryDisplay.bounds
        };
        const duplicateBoundsResolution = resolveCandidateSource(
          clonedPrimaryDisplay,
          [...displayInputs, clonedPrimaryDisplay],
          rawSources.map((s) => ({ ...s, display_id: '' })),
          winDevices
        );
        const duplicateRejected = duplicateBoundsResolution.status === 'UNRESOLVED';

        // Dynamic unsafe fallback check: display matching source name & index 0, unmatched bounds & display_id
        const labelSpoofDisplay = {
          id: '77777777',
          label: rawSources[0]?.name || 'Екран 1',
          isPrimary: false,
          bounds: { x: 88888, y: 88888, width: 640, height: 480 }
        };
        const labelSpoofResolution = resolveCandidateSource(
          labelSpoofDisplay,
          [...displayInputs, labelSpoofDisplay],
          rawSources,
          winDevices
        );
        // Also verify coordinate fallback refuses to run when display_id values ARE populated
        const populatedIdSources = rawSources.map((s, idx) => ({
          ...s,
          display_id: `known-other-${idx}`
        }));
        const fallbackBlockedWhenDisplayIdPresent = resolveCandidateSource(
          displayInputs[0],
          displayInputs,
          populatedIdSources,
          winDevices
        );
        const unsafeFallbackRejected =
          labelSpoofResolution.status === 'UNRESOLVED' &&
          fallbackBlockedWhenDisplayIdPresent.status === 'UNRESOLVED';

        const windowCount = BrowserWindow.getAllWindows().length;
        const pixelCaptureZeroedOk = Boolean(
          allThumbnailsZeroed &&
          windowCount === 1 &&
          !bridgeProbe.hasActiveStreamGlobal
        );

        const screenEnumerationOk = rawScreenDisplays.length >= 1;
        const desktopCapturerOk = rawSources.length >= rawScreenDisplays.length && allThumbnailsZeroed;

        // Evidence Matrix — every status dynamically evaluated; zero hardcoded PASS
        const evidenceMatrix = {
          bridgeExposure: {
            mandatory: true,
            applicable: true,
            expected: 'window.api exposed with all required IPC methods',
            actual: bridgeOk ? 'All 5 IPC bridge methods verified on window.api' : 'Missing window.api methods',
            status: bridgeOk ? 'PASS' : 'FAIL'
          },
          ipcBaseline: {
            mandatory: true,
            applicable: true,
            expected: 'getDisplays count matches Electron Screen API and session starts idle',
            actual: ipcBaselineOk
              ? `IPC returned ${ipcExecution.displays.displays.length} displays and status=${ipcExecution.session.status}`
              : `IPC baseline failed (${ipcExecution.error || 'mismatch'})`,
            status: ipcBaselineOk ? 'PASS' : 'FAIL'
          },
          screenEnumeration: {
            mandatory: true,
            applicable: true,
            expected: 'At least one physical display enumerated (or 2 when external monitor connected)',
            actual: `${rawScreenDisplays.length} displays (${rawScreenDisplays.map((d) => d.id).join(', ')})`,
            status: screenEnumerationOk ? 'PASS' : 'FAIL'
          },
          desktopCapturerEnumeration: {
            mandatory: true,
            applicable: true,
            expected: 'desktopCapturer sources >= display count with 0x0 empty thumbnails',
            actual: `${rawSources.length} sources; thumbnails=${JSON.stringify(thumbnailMeasurements)}`,
            status: desktopCapturerOk ? 'PASS' : 'FAIL'
          },
          primaryMapping: {
            mandatory: true,
            applicable: Boolean(primaryDisplay),
            expected: 'Primary display resolves unambiguously',
            actual: `${primaryMapped?.displayId} -> ${primaryMapped?.sourceId || 'UNRESOLVED'} (${primaryMapped?.strategy || primaryMapped?.reason})`,
            status: primaryMapped?.status === 'VERIFIED' ? 'PASS' : 'FAIL'
          },
          secondaryMapping: {
            mandatory: true,
            applicable: hasTwoDisplays,
            expected: 'Secondary display resolves unambiguously when present',
            actual: hasTwoDisplays
              ? `${secondaryMapped?.displayId} -> ${secondaryMapped?.sourceId || 'UNRESOLVED'} (${secondaryMapped?.strategy || secondaryMapped?.reason})`
              : 'No secondary display present',
            status: hasTwoDisplays ? (secondaryMapped?.status === 'VERIFIED' ? 'PASS' : 'FAIL') : 'NOT_APPLICABLE'
          },
          missingMapping: {
            mandatory: true,
            applicable: true,
            expected: 'Non-existent display ID fails closed',
            actual: `Synthetic display 99999999 resolution=${missingResolution.status} (${missingResolution.reason})`,
            status: missingMappingFailsClosed ? 'PASS' : 'FAIL'
          },
          duplicateMapping: {
            mandatory: true,
            applicable: hasTwoDisplays,
            expected: 'Distinct primary/secondary sources and duplicate bounds rejection',
            actual: `distinctSources=${distinctSources}, duplicateBoundsRejected=${duplicateRejected}`,
            status: hasTwoDisplays ? ((distinctSources && duplicateRejected) ? 'PASS' : 'FAIL') : 'NOT_APPLICABLE'
          },
          unsafeFallback: {
            mandatory: true,
            applicable: true,
            expected: 'Name/index spoof rejected and coordinate fallback blocked when display_id populated',
            actual: `labelSpoofRejected=${labelSpoofResolution.status === 'UNRESOLVED'}, fallbackBlockedWithPopulatedIds=${fallbackBlockedWhenDisplayIdPresent.status === 'UNRESOLVED'}`,
            status: unsafeFallbackRejected ? 'PASS' : 'FAIL'
          },
          pixelCaptureZeroed: {
            mandatory: true,
            applicable: true,
            expected: '0x0 capturer thumbnails, no capture window, no active MediaStream',
            actual: `allThumbnailsZeroed=${allThumbnailsZeroed}, browserWindowCount=${windowCount}, activeStream=${bridgeProbe.hasActiveStreamGlobal}`,
            status: pixelCaptureZeroedOk ? 'PASS' : 'FAIL'
          },
          testProcessCleanup: {
            mandatory: true,
            applicable: true,
            expected: 'Graceful exit with code 0 finalized by parent CLI orchestrator',
            actual: 'Pending parent process exit verification',
            status: 'PENDING'
          },
          physicalPixelIsolation: {
            mandatory: false,
            applicable: false,
            expected: 'Supervised physical test-pattern pixel capture verification (authorized separately)',
            actual: 'NOT_RUN in metadata-only smoke harness',
            status: 'NOT_RUN'
          }
        };

        const childMandatoryStatus = evaluateOverallStatus(evidenceMatrix, {
          excludeKeys: ['testProcessCleanup']
        });

        const report = {
          smokeScope: 'metadata-ipc-preload-only',
          physicalSourceIsolationStatus: 'NOT_VERIFIED',
          verificationStatus: childMandatoryStatus === 'PASS' ? 'PENDING_PROCESS_EXIT' : 'FAIL',
          timestamp: new Date().toISOString(),
          environment: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
            platform: process.platform,
            arch: process.arch
          },
          note: 'Windows Strategy 2 assumes DISPLAY<N> numbering maps to WebRTC screen:<N-1>:0 when display_id is empty; not universally proven without physical test-pattern verification.',
          bridgeProbe,
          displays: {
            count: ipcExecution.displays?.displays?.length ?? 0,
            primaryId: ipcExecution.displays?.primaryId ?? null,
            items: (ipcExecution.displays?.displays || []).map((d) => ({
              id: d.id,
              label: d.label,
              bounds: d.bounds
            }))
          },
          sources: rawSources.map((s) => ({
            id: s.id,
            name: s.name,
            display_id: s.display_id
          })),
          windowsPhysicalDevices: winDevices,
          mappingResults,
          evidenceMatrix,
          sessionState: ipcExecution.session || null,
          screenshot: {
            path: screenshotPath,
            sizeBytes: pngBuffer.length
          }
        };

        fs.writeFileSync(resultsJsonPath, JSON.stringify(report, null, 2), 'utf-8');
        console.log(`[SMOKE RUNNER]: Intermediate report written to: ${resultsJsonPath}`);

        clearTimeout(safetyTimeout);
        app.exit(childMandatoryStatus === 'PASS' ? 0 : 1);
      } catch (err) {
        console.error('[SMOKE ERROR]: Runtime smoke verification failed:', err);
        try {
          fs.mkdirSync(artifactDir, { recursive: true });
          fs.writeFileSync(
            resultsJsonPath,
            JSON.stringify(
              {
                smokeScope: 'metadata-ipc-preload-only',
                physicalSourceIsolationStatus: 'NOT_VERIFIED',
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

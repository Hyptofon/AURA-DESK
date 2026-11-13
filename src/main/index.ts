import { app, BrowserWindow, session, desktopCapturer } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc/register-handlers'
import { isAllowedNavigation } from './security/navigation-guard'
import { DisplayManager, forwardDisplayEvents } from './displays/display-manager'
import { SingleDisplayCapturer } from './capture/single-display-capturer'
import { createDualDisplayCapturer } from './capture/dual-capture-factory'
import type { DualDisplayCapturer } from './capture/dual-display-capturer'
import { applyContentProtection } from './capture/overlay-exclusion'
import { IntegratedAudioSupervisor } from './capture/integrated-audio-supervisor'
import { MicrophoneCapturer } from './capture/microphone-capturer'
import { ElectronMicrophoneBackend } from './capture/electron-microphone-backend'
import { SystemLoopbackCapturer } from './capture/system-loopback-capturer'
import { ElectronLoopbackBackend } from './capture/electron-loopback-backend'

let mainWindow: BrowserWindow | null = null
let displayManager: DisplayManager | null = null
let singleDisplayCapturer: SingleDisplayCapturer | null = null
let dualDisplayCapturer: DualDisplayCapturer | null = null
let audioSupervisor: IntegratedAudioSupervisor | null = null

function createWindow(): void {
  const isDev = Boolean(!app.isPackaged && process.env['ELECTRON_RENDERER_URL'])
  const expectedHtmlPath = join(__dirname, '../renderer/index.html')
  const expectedHtmlUrl = pathToFileURL(expectedHtmlPath).href

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0D1218',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  // Prevent application window and overlays from recursive capture where supported by DWM
  applyContentProtection(mainWindow, true)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Deny new window creation by default; do not automatically open external browser without explicit user confirmation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  // Prevent navigation outside application boundaries
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowed = isAllowedNavigation(navigationUrl, {
      isDev,
      rendererUrl: isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
      expectedHtmlPath: expectedHtmlUrl
    })
    if (!allowed) {
      event.preventDefault()
    }
  })

  displayManager = new DisplayManager()
  displayManager.ensureListening()

  singleDisplayCapturer = new SingleDisplayCapturer(displayManager)
  dualDisplayCapturer = createDualDisplayCapturer(displayManager)

  const micBackend = new ElectronMicrophoneBackend()
  const micCapturer = new MicrophoneCapturer(micBackend)
  const loopbackSession = session.fromPartition('in-memory:aura-audio-loopback', { cache: false })
  const loopbackBackend = new ElectronLoopbackBackend({ session: loopbackSession })
  const loopbackCapturer = new SystemLoopbackCapturer(loopbackBackend)
  audioSupervisor = new IntegratedAudioSupervisor(micCapturer, loopbackCapturer)

  // Register typed IPC handlers bound to authorized window and top frame
  registerIpcHandlers(
    undefined,
    {
      trustedWebContents: mainWindow.webContents,
      trustedOrigin: isDev ? (process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173') : undefined,
      isAllowedOrigin: (url: string) =>
        isAllowedNavigation(url, {
          isDev,
          rendererUrl: isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
          expectedHtmlPath: expectedHtmlUrl
        })
    },
    displayManager,
    singleDisplayCapturer,
    dualDisplayCapturer,
    audioSupervisor,
    micBackend,
    loopbackBackend
  )

  // Configure permission check and request handlers for media access in authorized main window
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' && mainWindow && webContents && webContents.id === mainWindow.webContents.id) {
      return true
    }
    return false
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' && mainWindow && webContents && webContents.id === mainWindow.webContents.id) {
      callback(true)
      return
    }
    callback(false)
  })

  // Authorize system loopback audio requests exclusively from authorized main window
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // Fail-closed: only authorized main window can request loopback audio
    if (!mainWindow || !request.frame || request.frame.processId !== mainWindow.webContents.mainFrame.processId) {
      callback({})
      return
    }

    try {
      // Chromium getDisplayMedia requires a video source even for audio loopback.
      // Grant only an authorized window or primary display source to satisfy the API
      // without capturing an unrelated monitor; renderer stops and removes video immediately.
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 0, height: 0 }
      })

      // Prefer application's own window so no desktop monitor is captured
      const windowSource = sources.find(
        (s) => s.id.startsWith('window:') && (s.name.includes('AURA DESK') || s.id.includes(String(mainWindow?.id)))
      )
      const selectedSource = windowSource ?? sources[0]

      if (!selectedSource) {
        callback({})
        return
      }

      callback({
        video: selectedSource,
        audio: 'loopback'
      })
    } catch (err) {
      console.error('Failed to resolve display media source for loopback audio:', err)
      callback({})
    }
  })

  // Forward validated display hotplug and metrics events to authorized window
  const unsubscribeDisplays = forwardDisplayEvents(mainWindow.webContents, displayManager)

  mainWindow.on('closed', () => {
    unsubscribeDisplays()
    unregisterIpcHandlers()
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      callback({})
    })
    if (audioSupervisor) {
      void audioSupervisor.stopAll()
      audioSupervisor = null
    }
    if (singleDisplayCapturer) {
      void singleDisplayCapturer.stop()
      singleDisplayCapturer = null
    }
    if (dualDisplayCapturer) {
      void dualDisplayCapturer.stop()
      dualDisplayCapturer = null
    }
    displayManager?.stopListening()
    displayManager = null
    mainWindow = null
  })

  // Only load dev server in unpackaged development mode; never load ELECTRON_RENDERER_URL in production
  const devServerUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(expectedHtmlPath)
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc/register-handlers'
import { isAllowedNavigation } from './security/navigation-guard'
import { DisplayManager, forwardDisplayEvents } from './displays/display-manager'
import { SingleDisplayCapturer } from './capture/single-display-capturer'
import { createDualDisplayCapturer } from './capture/dual-capture-factory'
import type { DualDisplayCapturer } from './capture/dual-display-capturer'

let mainWindow: BrowserWindow | null = null
let displayManager: DisplayManager | null = null
let singleDisplayCapturer: SingleDisplayCapturer | null = null
let dualDisplayCapturer: DualDisplayCapturer | null = null

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
    dualDisplayCapturer
  )

  // Forward validated display hotplug and metrics events to authorized window
  const unsubscribeDisplays = forwardDisplayEvents(mainWindow.webContents, displayManager)

  mainWindow.on('closed', () => {
    unsubscribeDisplays()
    unregisterIpcHandlers()
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

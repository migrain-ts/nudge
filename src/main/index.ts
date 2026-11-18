import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { createCloseGate } from './closeGate'
import { registerIpc } from './ipc'

let quitting = false
const gates = new WeakMap<Electron.WebContents, ReturnType<typeof createCloseGate>>()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#0f1012',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.on('ready-to-show', () => win.show())

  // The page never navigates and never opens windows or webviews (a dropped file must not replace the UI).
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Let the renderer save its last edit before the window (or the app) goes away.
  const wc = win.webContents
  const gate = createCloseGate({
    notify: () => wc.send('app:before-close'),
    proceed: () => win.close()
  })
  gates.set(wc, gate)
  win.on('close', (e) => { if (gate.request()) e.preventDefault() })
  // Cmd+Q: the close above was deferred, so finish quitting once the window is really gone.
  win.on('closed', () => { if (quitting) app.quit() })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(() => {
    registerIpc()
    ipcMain.handle('api:readyToClose', (e) => { gates.get(e.sender)?.ready() })
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

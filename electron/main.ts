import { app, BrowserWindow, ipcMain, shell, Menu, globalShortcut, protocol } from 'electron'
import { DISCORD_WEBHOOK_URL } from './secrets'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import dotenv from 'dotenv'

// Must be called before app.whenReady
protocol.registerSchemesAsPrivileged([
  { scheme: 'aurora', privileges: { secure: true, bypassCSP: true } }
])

// Pass Google API key to Chromium so Web Speech API works in Electron.
// Must be done before app.whenReady — process.env alone doesn't reach the renderer.
{
  const envPath = app.isPackaged
    ? require('path').join(app.getPath('userData'), '.env')
    : require('path').join(__dirname, '../.env')
  try {
    const raw = require('fs').readFileSync(envPath, 'utf-8') as string
    const match = raw.match(/^GOOGLE_SPEECH_API_KEY=(.+)$/m)
    if (match) app.commandLine.appendSwitch('google-api-key', match[1].trim())
  } catch { /* .env not present yet — setup screen will handle it */ }
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  try {
    const logPath = join(app.getPath('userData'), 'aurora.log')
    appendFileSync(logPath, line)
  } catch { /* ignore if userData not ready yet */ }
}

// In production, .env lives in userData so it survives updates and isn't in a read-only install dir
const envPath = isDev
  ? join(__dirname, '../.env')
  : join(app.getPath('userData'), '.env')

const REQUIRED_KEYS = ['ANTHROPIC_API_KEY']

function isNoAIMode(): boolean {
  loadEnv()
  return process.env.AURORA_NO_AI === 'true'
}

// App-level EVE credentials — shared across all users, created on developers.eveonline.com
const EVE_CLIENT_ID     = '46e3ae80efea49d88caf2207c3ab62ac'
const EVE_CLIENT_SECRET = 'eat_1K56fWSWiqCRjQU5jgfARCZpxxp3xJd1a_4Ns6Co'

function ensureFixedKeys() {
  // Always write app-level credentials so the server has them even before user setup
  const existing = readEnvValues()
  const needsWrite =
    existing['EVE_CLIENT_ID']     !== EVE_CLIENT_ID ||
    existing['EVE_CLIENT_SECRET'] !== EVE_CLIENT_SECRET ||
    existing['JANICE_API_KEY']    !== 'G9KwKq3465588VPd6747t95Zh94q3W2E' ||
    existing['AURORA_FITS_WORKER_URL'] !== 'https://aurora-fits.aurora-eve.workers.dev' ||
    (DISCORD_WEBHOOK_URL && existing['DISCORD_WEBHOOK_URL'] !== DISCORD_WEBHOOK_URL) ||
    !existing['EVE_CALLBACK_URL']
  if (needsWrite) {
    writeEnvValues(existing)
  }
}

function loadEnv() {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true })
  }
}

function getMissingKeys(): string[] {
  loadEnv()
  const skip = isNoAIMode() ? ['ANTHROPIC_API_KEY'] : []
  return REQUIRED_KEYS.filter(k => !skip.includes(k) && !process.env[k])
}

function readEnvValues(): Record<string, string> {
  if (!existsSync(envPath)) return {}
  const raw = readFileSync(envPath, 'utf-8')
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) result[match[1].trim()] = match[2].trim()
  }
  return result
}

function writeEnvValues(values: Record<string, string>) {
  // Merge with existing so we don't wipe optional keys the user already set
  const existing = readEnvValues()
  const merged = { ...existing, ...values }

  // Always bake in app-level credentials — users never need to supply these
  merged['EVE_CLIENT_ID']         = EVE_CLIENT_ID
  merged['EVE_CLIENT_SECRET']     = EVE_CLIENT_SECRET
  merged['VITE_EVE_CLIENT_ID']    = EVE_CLIENT_ID
  merged['EVE_CALLBACK_URL']      = 'http://localhost:3001/api/eve/callback'
  merged['VITE_EVE_CALLBACK_URL'] = 'http://localhost:3001/api/eve/callback'
  merged['PORT']                  = '3001'
  merged['JANICE_API_KEY']        = 'G9KwKq3465588VPd6747t95Zh94q3W2E'
  merged['AURORA_FITS_WORKER_URL'] = 'https://aurora-fits.aurora-eve.workers.dev'
  if (DISCORD_WEBHOOK_URL) merged['DISCORD_WEBHOOK_URL'] = DISCORD_WEBHOOK_URL

  const content = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  // Ensure userData directory exists (may not exist on first run after install)
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(envPath, content, 'utf-8')
}

let mainWindow: BrowserWindow | null = null
let expressProcess: ChildProcess | null = null

function startExpressServer() {
  if (app.isPackaged) {
    // In production: require the bundled server directly in the Electron main process.
    // Electron IS Node.js — no need to spawn a separate process.
    process.env.PORT            = '3001'
    process.env.DOTENV_CONFIG_PATH = envPath
    process.env.ELECTRON_APP    = '1'
    process.env.NODE_ENV        = 'production'
    process.env.AURORA_DIST_PATH = join(process.resourcesPath, 'app.asar', 'dist')
    loadEnv()  // reload env so the server picks up the keys

    // Diagnostic: log which keys are present so OAuth failures are diagnosable
    const clientId = process.env.EVE_CLIENT_ID
    const secret = process.env.EVE_CLIENT_SECRET
    const cbUrl = process.env.EVE_CALLBACK_URL
    log(`ENV check — EVE_CLIENT_ID=${clientId ? clientId.slice(0,8)+'...' : 'MISSING'} EVE_CLIENT_SECRET=${secret ? '***set***' : 'MISSING'} EVE_CALLBACK_URL=${cbUrl || 'MISSING'}`)

    try {
      const serverPath = join(process.resourcesPath, 'server/index.js')
      // Clear require cache so a post-setup restart picks up new env vars
      delete require.cache[require.resolve(serverPath)]
      require(serverPath)
      log('Express server loaded in-process')
    } catch (err) {
      log(`Failed to load Express server: ${err}`)
    }
  } else {
    // In dev: spawn tsx so the server hot-reloads independently
    const serverScript = join(__dirname, '../server/index.ts')
    expressProcess = spawn('npx', ['tsx', serverScript], {
      cwd: join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: '3001',
        DOTENV_CONFIG_PATH: envPath,
        ELECTRON_APP: '1',
      },
      shell: true,
      stdio: 'inherit',
    })
    expressProcess.on('error', (err) => log(`Express spawn error: ${err}`))
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#080b10',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: join(__dirname, '../public/aurora-icon.png'),
    show: false,
  })

  // Grant microphone access for Web Speech API and getUserMedia
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'speech-recognition', 'speechRecognition']
    callback(allowed.includes(permission))
  })

mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Expose a direct callback for the in-process Express server to call after OAuth.
  // Avoids all web navigation / scheme interception complexity.
  // Let the in-process server write to our log file
  ;(global as any).__auroraLog = (msg: string) => log(`[server] ${msg}`)

  ;(global as any).__auroraOAuthCallback = (params: string) => {
    const redacted = params.replace(/(eve_access_token|eve_refresh_token|code)=[^&]*/g, '$1=[redacted]')
    log(`OAuth callback received: ${redacted}`)
    const base = isDev ? 'http://localhost:5173' : 'http://localhost:3001'
    mainWindow?.loadURL(`${base}/?${params}`)
  }

  Menu.setApplicationMenu(null)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // Tell renderer which keys are missing so it can show setup if needed
    const missing = getMissingKeys()
    log(`ready-to-show — missing keys: ${missing.length > 0 ? missing.join(', ') : 'none'}`)
    if (missing.length > 0) {
      mainWindow?.webContents.send('setup:required', missing)
    }
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizeChange', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChange', false))
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('window:fullScreenChange', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('window:fullScreenChange', false))

  globalShortcut.register('F11', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })

  // Use window-local input event so Escape is not stolen from other apps globally
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow?.isFullScreen()) {
      mainWindow.setFullScreen(false)
    }
  })

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    globalShortcut.register('F12', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    })
    mainWindow.webContents.on('did-fail-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    })
  }

  // Log all navigation events to help debug OAuth flow
  mainWindow.webContents.on('will-navigate', (_e, url) => {
    log(`will-navigate: ${url}`)
  })
  mainWindow.webContents.on('will-redirect', (_e, url) => {
    log(`will-redirect: ${url}`)
  })
  mainWindow.webContents.on('did-navigate', (_e, url) => {
    log(`did-navigate: ${url}`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`did-fail-load: ${url} — ${code} ${desc}`)
  })

  if (isDev) {
    const tryLoad = (retries = 60) => {
      mainWindow?.loadURL('http://localhost:5173').catch(() => {
        if (retries > 0) setTimeout(() => tryLoad(retries - 1), 750)
      })
    }
    tryLoad()
    // Uncomment to open DevTools: mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Wait for Express to be ready then load via http so API calls use same origin
    const waitAndLoad = (retries = 20) => {
      const missing = getMissingKeys()
      const url = missing.length > 0
        ? 'http://localhost:3001/setup.html'
        : 'http://localhost:3001/'
      mainWindow?.loadURL(url).catch(() => {
        if (retries > 0) setTimeout(() => waitAndLoad(retries - 1), 300)
      })
    }
    waitAndLoad()
  }

  // Global PTT shortcut — only active when window is not focused to avoid double-fire
  // with the in-window keydown handler. Key is configurable via ptt:setKey IPC.
  let pttKey = '`'
  const registerPtt = () => { try { globalShortcut.register(pttKey, () => mainWindow?.webContents.send('ptt:toggle')) } catch { /* invalid key */ } }
  const unregisterPtt = () => { try { globalShortcut.unregister(pttKey) } catch { /* not registered */ } }

  mainWindow.on('blur',  registerPtt)
  mainWindow.on('focus', unregisterPtt)

  ipcMain.handle('ptt:setKey', (_e, newKey: string) => {
    const wasBlurred = !mainWindow?.isFocused()
    if (wasBlurred) unregisterPtt()
    pttKey = newKey
    if (wasBlurred) registerPtt()
  })

  mainWindow.on('closed', () => {
    globalShortcut.unregisterAll()
    mainWindow = null
  })
}

// ── Auto-updater ─────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return  // skip in dev

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => log('Checking for update...'))
  autoUpdater.on('update-available', (info) => {
    log(`Update available: ${info.version}`)
    mainWindow?.webContents.send('update:available', info.version)
  })
  autoUpdater.on('update-not-available', () => log('App is up to date'))
  autoUpdater.on('download-progress', (p) => {
    log(`Download progress: ${Math.round(p.percent)}%`)
    mainWindow?.webContents.send('update:progress', Math.round(p.percent))
  })
  autoUpdater.on('update-downloaded', (info) => {
    log(`Update downloaded: ${info.version}`)
    mainWindow?.webContents.send('update:downloaded', info.version)
  })
  autoUpdater.on('error', (err) => log(`Updater error: ${err}`))

  autoUpdater.checkForUpdates().catch(err => log(`Update check failed: ${err}`))
}

ipcMain.on('update:install', () => autoUpdater.quitAndInstall())

// ── Window control IPC ────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:captureScreenshot', async () => {
  if (!mainWindow) return null
  const image = await mainWindow.webContents.capturePage()
  return image.toPNG().toString('base64')
})
ipcMain.handle('window:readLog', () => {
  try {
    const logPath = join(app.getPath('userData'), 'aurora.log')
    if (!existsSync(logPath)) return null
    const contents = readFileSync(logPath, 'utf-8')
    // Return last 200 lines to keep the attachment manageable
    const lines = contents.split('\n')
    return lines.slice(-200).join('\n')
  } catch { return null }
})
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('window:isFullScreen', () => mainWindow?.isFullScreen() ?? false)
ipcMain.handle('config:noAIMode', () => isNoAIMode())
ipcMain.handle('setup:clearKeys', (_e, keys: string[], setNoAI = false) => {
  const existing = readEnvValues()
  for (const k of keys) delete existing[k]
  if (setNoAI) existing['AURORA_NO_AI'] = 'true'
  writeEnvValues(existing)
  loadEnv()
  app.relaunch()
  app.exit(0)
})

// ── Setup / env IPC ───────────────────────────────────────────────────────
ipcMain.handle('setup:getMissing', () => getMissingKeys())
ipcMain.on('setup:getMissingSync', (e) => { e.returnValue = getMissingKeys() })
ipcMain.handle('setup:getValues', () => {
  const vals = readEnvValues()
  return {
    ANTHROPIC_API_KEY:    vals['ANTHROPIC_API_KEY']    ? '••••configured••••' : '',
    ELEVENLABS_API_KEY:   vals['ELEVENLABS_API_KEY']   ? '••••configured••••' : '',
    ELEVENLABS_VOICE_ID:  vals['ELEVENLABS_VOICE_ID']  || '',
  }
})
ipcMain.handle('setup:save', (_e, values: Record<string, string>) => {
  const existing = readEnvValues()
  const merged = { ...existing, ...values }
  // If user left a field blank, keep the existing value
  for (const k of Object.keys(existing)) {
    if (!values[k]) merged[k] = existing[k]
  }
  writeEnvValues(merged)
  loadEnv()
  const remaining = getMissingKeys()
  if (remaining.length === 0) {
    app.relaunch()
    app.exit(0)
  } else {
    expressProcess?.kill()
    setTimeout(startExpressServer, 500)
  }
  return remaining
})

ipcMain.on('app:launch', () => {
  mainWindow?.loadFile(join(__dirname, '../dist/index.html'))
})

// Enforce single instance — if a second instance tries to launch, focus the existing window
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  ensureFixedKeys()
  loadEnv()
  // Chromium's Web Speech API needs GOOGLE_API_KEY to function outside of Chrome.
  // If the user has configured one, expose it under the name Chromium expects.
  if (process.env.GOOGLE_SPEECH_API_KEY) {
    process.env.GOOGLE_API_KEY = process.env.GOOGLE_SPEECH_API_KEY
  }
  startExpressServer()
  setTimeout(createWindow, isDev ? 1500 : 2000)
  setTimeout(setupAutoUpdater, isDev ? 0 : 10000)  // check after app is settled

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  expressProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  expressProcess?.kill()
})

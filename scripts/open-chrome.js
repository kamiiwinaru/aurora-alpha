const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')

const URL = 'http://localhost:5173'
const POLL_MS = 500
const TIMEOUT_MS = 30_000

const CHROME_PATHS = [
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

function findChrome () {
  return CHROME_PATHS.find(p => fs.existsSync(p)) ?? null
}

function tryOpen () {
  const chrome = findChrome()
  if (!chrome) {
    console.error('[open-chrome] Chrome not found — falling back to default browser.')
    spawn('cmd', ['/c', 'start', URL], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn(chrome, ['--new-window', '--start-fullscreen', URL], { detached: true, stdio: 'ignore' }).unref()
}

function poll (elapsed) {
  if (elapsed >= TIMEOUT_MS) {
    console.error('[open-chrome] Vite never became ready — giving up.')
    return
  }
  http.get(URL, (res) => {
    if (res.statusCode < 500) tryOpen()
    else setTimeout(() => poll(elapsed + POLL_MS), POLL_MS)
  }).on('error', () => setTimeout(() => poll(elapsed + POLL_MS), POLL_MS))
}

poll(0)

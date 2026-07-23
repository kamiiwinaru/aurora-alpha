import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  minimize:    () => ipcRenderer.send('window:minimize'),
  maximize:    () => ipcRenderer.send('window:maximize'),
  close:       () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximizeChange', (_e, val) => cb(val))
  },
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  onFullScreenChange: (cb: (fullscreen: boolean) => void) => {
    ipcRenderer.on('window:fullScreenChange', (_e, val) => cb(val))
  },
  // Setup — sync so missing keys are known before React's first render
  getMissingKeysSync: ()                        => ipcRenderer.sendSync('setup:getMissingSync') as string[],
  getMissingKeys: ()                            => ipcRenderer.invoke('setup:getMissing'),
  getEnvValues: ()                              => ipcRenderer.invoke('setup:getValues'),
  saveEnvValues: (values: Record<string, string>) => ipcRenderer.invoke('setup:save', values),
  onSetupRequired: (cb: (missing: string[]) => void) => {
    ipcRenderer.on('setup:required', (_e, missing) => cb(missing))
  },
  // Updates
  onUpdateAvailable: (cb: (version: string) => void) => {
    ipcRenderer.on('update:available', (_e, version) => cb(version))
  },
  onUpdateProgress: (cb: (percent: number) => void) => {
    ipcRenderer.on('update:progress', (_e, percent) => cb(percent))
  },
  onUpdateDownloaded: (cb: (version: string) => void) => {
    ipcRenderer.on('update:downloaded', (_e, version) => cb(version))
  },
  installUpdate: () => ipcRenderer.send('update:install'),
  launchApp: () => ipcRenderer.send('app:launch'),
  captureScreenshot: () => ipcRenderer.invoke('window:captureScreenshot'),
  readLog: () => ipcRenderer.invoke('window:readLog'),
  // PTT global key — 'down' once at the start of a hold, 'up' once released.
  // Returns an unsubscribe fn.
  onPttState: (cb: (state: 'down' | 'up') => void) => {
    const listener = (_e: unknown, state: 'down' | 'up') => cb(state)
    ipcRenderer.on('ptt:state', listener)
    return () => ipcRenderer.removeListener('ptt:state', listener)
  },
  setPttKey: (code: string) => ipcRenderer.invoke('ptt:setKey', code),
  isNoAIMode: () => ipcRenderer.invoke('config:noAIMode') as Promise<boolean>,
  clearKeys: (keys: string[], setNoAI?: boolean) => ipcRenderer.invoke('setup:clearKeys', keys, setNoAI),
})

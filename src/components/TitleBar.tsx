import { useEffect, useState } from 'react'
import OptionsMenu from './OptionsMenu'

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.isMaximized().then(setIsMaximized)
    window.electronAPI.onMaximizeChange(setIsMaximized)
  }, [])

  // Not in Electron — render nothing
  if (!window.electronAPI) return null

  return (
    <div
      className="flex items-center justify-between h-8 px-3 shrink-0 select-none"
      style={{
        background: 'linear-gradient(90deg, #080b10 0%, #0a0f1a 50%, #080b10 100%)',
        borderBottom: '1px solid rgba(0,212,255,0.15)',
        WebkitAppRegion: 'drag' as any,
      }}
    >
      {/* Left — app identity */}
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,212,255,0.8)]" />
        <span className="text-[10px] tracking-[0.2em] text-cyan-400/70 font-mono uppercase">
          Aurora // Capsuleer Intelligence System
        </span>
      </div>

      {/* Right — settings + window controls */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' as any }}
      >
        <OptionsMenu />

        <div className="w-px h-4 mx-0.5" style={{ background: 'rgba(0,212,255,0.12)' }} />

        {/* Minimize */}
        <button
          onClick={window.electronAPI.minimize}
          className="w-7 h-6 flex items-center justify-center rounded-sm text-eve-muted hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={window.electronAPI.maximize}
          className="w-7 h-6 flex items-center justify-center rounded-sm text-eve-muted hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="8" height="8" />
              <polyline points="0,2 0,10 8,10" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0" y="0" width="10" height="10" />
            </svg>
          )}
        </button>

        {/* Close */}
        <button
          onClick={window.electronAPI.close}
          className="w-7 h-6 flex items-center justify-center rounded-sm text-eve-muted hover:text-red-400 hover:bg-red-500/15 transition-colors"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'

export default function TitleBar() {
  if (!window.electronAPI) return null

  return (
    <div
      className="flex items-center justify-between h-8 px-3 shrink-0 select-none border-b border-eve-border"
      style={{
        background: 'var(--eve-deep, #0a0d12)',
        WebkitAppRegion: 'drag' as any,
      }}
    >
      {/* Left — app identity */}
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-eve-cyan shadow-[0_0_6px_rgba(0,212,255,0.7)]" />
        <span className="text-[10px] tracking-[0.2em] text-eve-cyan/70 font-mono uppercase">
          Aurora // Capsuleer Intelligence System
        </span>
      </div>

      {/* Right — window controls */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' as any }}
      >
        <button
          onClick={() => window.electronAPI!.minimize()}
          title="Minimize"
          className="w-7 h-6 flex items-center justify-center text-eve-dim hover:text-eve-cyan hover:bg-eve-cyan/10 rounded-sm transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1"/></svg>
        </button>
        <button
          onClick={() => window.electronAPI!.maximize()}
          title="Maximize"
          className="w-7 h-6 flex items-center justify-center text-eve-dim hover:text-eve-cyan hover:bg-eve-cyan/10 rounded-sm transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="0.5" y="0.5" width="8" height="8"/>
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI!.close()}
          title="Close"
          className="w-7 h-6 flex items-center justify-center text-eve-dim hover:text-red-400 hover:bg-red-500/15 rounded-sm transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="9" y2="9"/><line x1="9" y1="0" x2="0" y2="9"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

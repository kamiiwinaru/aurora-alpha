import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

const MIC_DEVICE_KEY = 'aurora_mic_device_id'

interface MicDevice {
  deviceId: string
  label: string
}

// ── Sections ─────────────────────────────────────────────────────────────────

function MicSection() {
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [selected, setSelected] = useState<string>(
    () => localStorage.getItem(MIC_DEVICE_KEY) ?? 'default'
  )
  const [permDenied, setPermDenied] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        // Request permission so labels are populated
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
      } catch {
        setPermDenied(true)
        return
      }
      const all = await navigator.mediaDevices.enumerateDevices()
      const mics = all
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone (${d.deviceId.slice(0, 8)})`,
        }))
      setDevices(mics)
    }
    load()
  }, [])

  function select(id: string) {
    setSelected(id)
    localStorage.setItem(MIC_DEVICE_KEY, id)
    // Dispatch so useVoiceInput can react without a page reload
    window.dispatchEvent(new CustomEvent('aurora_mic_changed', { detail: id }))
  }

  return (
    <div>
      <div className="text-[9px] tracking-[0.15em] text-cyan-400/50 uppercase mb-1.5">
        Microphone
      </div>
      {permDenied ? (
        <p className="text-[10px] text-eve-muted">Mic permission denied.</p>
      ) : devices.length === 0 ? (
        <p className="text-[10px] text-eve-muted">Detecting devices…</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {devices.map(d => (
            <button
              key={d.deviceId}
              onClick={() => select(d.deviceId)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-[10px] transition-colors ${
                selected === d.deviceId
                  ? 'bg-cyan-400/15 text-cyan-300'
                  : 'text-eve-muted hover:text-cyan-400 hover:bg-cyan-400/8'
              }`}
            >
              <span
                className={`w-1 h-1 rounded-full shrink-0 ${
                  selected === d.deviceId ? 'bg-cyan-400' : 'bg-eve-border'
                }`}
              />
              <span className="truncate max-w-[180px]">{d.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Theme section ─────────────────────────────────────────────────────────────

function ThemeSection({ darkMode, setDarkMode }: { darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.15em] text-cyan-400/50 uppercase mb-1.5">
        Theme
      </div>
      <button
        onClick={() => setDarkMode(!darkMode)}
        className="flex items-center justify-between w-full px-2 py-1.5 rounded-sm text-[10px] text-eve-muted hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors"
      >
        <span>{darkMode ? 'Dark mode' : 'Light mode'}</span>
        <div
          className={`relative w-7 h-4 rounded-full transition-colors ${darkMode ? 'bg-cyan-400/30' : 'bg-eve-border'}`}
        >
          <div
            className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
              darkMode ? 'left-3.5 bg-cyan-400' : 'left-0.5 bg-eve-muted'
            }`}
          />
        </div>
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface OptionsMenuProps {
  darkMode: boolean
  setDarkMode: (v: boolean) => void
}

export default function OptionsMenu({ darkMode, setDarkMode }: OptionsMenuProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  // Position the portal-rendered dropdown below the button
  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({
      top: r.bottom + 4,
      right: window.innerWidth - r.right,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (
        btnRef.current?.contains(target) ||
        dropRef.current?.contains(target)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const dropdown = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropRef}
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.97 }}
          transition={{ duration: 0.12 }}
          style={{
            position: 'fixed',
            top: pos.top,
            right: pos.right,
            width: 224,
            zIndex: 9999,
            borderRadius: 2,
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #080e1a 0%, #0a1020 100%)',
            border: '1px solid rgba(0,212,255,0.2)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,212,255,0.05)',
          }}
        >
          {/* Header */}
          <div
            className="px-3 py-2 flex items-center gap-2"
            style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}
          >
            <div className="w-1 h-1 rounded-full bg-cyan-400 shadow-[0_0_4px_rgba(0,212,255,0.8)]" />
            <span className="text-[9px] tracking-[0.2em] text-cyan-400/70 uppercase font-mono">
              Settings
            </span>
          </div>

          {/* Sections */}
          <div className="px-3 py-2.5 flex flex-col gap-4">
            <ThemeSection darkMode={darkMode} setDarkMode={setDarkMode} />
            <div style={{ borderTop: '1px solid rgba(0,212,255,0.08)' }} />
            <MicSection />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        className={`w-7 h-6 flex items-center justify-center rounded-sm transition-colors ${
          open
            ? 'text-cyan-400 bg-cyan-400/15'
            : 'text-eve-muted hover:text-cyan-400 hover:bg-cyan-400/10'
        }`}
        title="Settings"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {createPortal(dropdown, document.body)}
    </>
  )
}

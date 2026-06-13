import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

const MIC_DEVICE_KEY   = 'aurora_mic_device_id'
const VOLUME_KEY       = 'aurora_tts_volume'
const FONT_SIZE_KEY    = 'aurora_font_size'
const FONT_DENSITY_KEY = 'aurora_font_density'

interface MicDevice { deviceId: string; label: string }

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider() {
  return <div style={{ borderTop: '1px solid rgba(0,212,255,0.08)' }} />
}

// ── Section label ─────────────────────────────────────────────────────────────
function Label({ children }: { children: string }) {
  return (
    <div className="text-[9px] tracking-[0.15em] text-cyan-400/50 uppercase mb-1.5">
      {children}
    </div>
  )
}

// ── Microphone ────────────────────────────────────────────────────────────────
function MicSection() {
  const [devices, setDevices]   = useState<MicDevice[]>([])
  const [selected, setSelected] = useState(() => localStorage.getItem(MIC_DEVICE_KEY) ?? 'default')
  const [permDenied, setPermDenied] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
      } catch { setPermDenied(true); return }
      const all  = await navigator.mediaDevices.enumerateDevices()
      const mics = all
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` }))
      setDevices(mics)
    }
    load()
  }, [])

  function select(id: string) {
    setSelected(id)
    localStorage.setItem(MIC_DEVICE_KEY, id)
    window.dispatchEvent(new CustomEvent('aurora_mic_changed', { detail: id }))
  }

  return (
    <div>
      <Label>Microphone</Label>
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
              <span className={`w-1 h-1 rounded-full shrink-0 ${selected === d.deviceId ? 'bg-cyan-400' : 'bg-eve-border'}`} />
              <span className="truncate max-w-[180px]">{d.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function ThemeSection({ darkMode, setDarkMode }: { darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  return (
    <div>
      <Label>Theme</Label>
      <button
        onClick={() => setDarkMode(!darkMode)}
        className="flex items-center justify-between w-full px-2 py-1.5 rounded-sm text-[10px] text-eve-muted hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors"
      >
        <span>{darkMode ? 'Dark mode' : 'Light mode'}</span>
        <div className={`relative w-7 h-4 rounded-full transition-colors ${darkMode ? 'bg-cyan-400/30' : 'bg-eve-border'}`}>
          <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${darkMode ? 'left-3.5 bg-cyan-400' : 'left-0.5 bg-eve-muted'}`} />
        </div>
      </button>
    </div>
  )
}

// ── ElevenLabs ────────────────────────────────────────────────────────────────
function ElevenLabsSection() {
  const [apiKey,  setApiKey]  = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [status,  setStatus]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const isElectron = !!window.electronAPI

  useEffect(() => {
    if (isElectron) {
      window.electronAPI.getEnvValues().then((vals: Record<string, string>) => {
        setApiKey(vals.ELEVENLABS_API_KEY  ?? '')
        setVoiceId(vals.ELEVENLABS_VOICE_ID ?? '')
      }).catch(() => {})
    }
  }, [isElectron])

  async function save() {
    if (!apiKey && !voiceId) return
    setStatus('saving')
    try {
      if (isElectron) {
        const payload: Record<string, string> = {}
        if (apiKey  && !apiKey.includes('•'))  payload.ELEVENLABS_API_KEY  = apiKey
        if (voiceId && !voiceId.includes('•')) payload.ELEVENLABS_VOICE_ID = voiceId
        await window.electronAPI.saveEnvValues(payload)
        // setup:save triggers app relaunch — show saving state briefly
        setStatus('saved')
      } else {
        const res = await fetch('/api/settings/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey:  apiKey  || undefined,
            voiceId: voiceId || undefined,
          }),
        })
        setStatus(res.ok ? 'saved' : 'error')
        if (res.ok) setTimeout(() => setStatus('idle'), 2000)
      }
    } catch { setStatus('error') }
  }

  return (
    <div>
      <Label>ElevenLabs Voice</Label>
      <div className="flex flex-col gap-1.5">
        <input
          type="password"
          placeholder={isElectron ? '••••configured••••' : 'API key'}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          className="eve-input text-[10px] py-1 px-2"
        />
        <input
          type="text"
          placeholder="Voice ID"
          value={voiceId}
          onChange={e => setVoiceId(e.target.value)}
          className="eve-input text-[10px] py-1 px-2"
        />
        <button
          onClick={save}
          disabled={status === 'saving'}
          className="eve-btn text-[10px] py-1"
        >
          {status === 'saving' ? 'SAVING…' :
           status === 'saved'  ? (isElectron ? 'RESTARTING…' : 'SAVED') :
           status === 'error'  ? 'ERROR — RETRY' :
           'SAVE'}
        </button>
        {isElectron && status === 'idle' && (
          <p className="text-[9px] text-eve-dim">App will restart to apply key changes.</p>
        )}
      </div>
    </div>
  )
}

// ── Volume ────────────────────────────────────────────────────────────────────
function VolumeSection() {
  const [vol, setVol] = useState(() => Number(localStorage.getItem(VOLUME_KEY) ?? '1'))

  function change(v: number) {
    setVol(v)
    localStorage.setItem(VOLUME_KEY, String(v))
  }

  return (
    <div>
      <Label>TTS Volume</Label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0} max={1} step={0.05}
          value={vol}
          onChange={e => change(Number(e.target.value))}
          className="flex-1 accent-cyan-400 h-1"
        />
        <span className="text-[10px] text-eve-muted w-8 text-right">{Math.round(vol * 100)}%</span>
      </div>
    </div>
  )
}

// ── Display ───────────────────────────────────────────────────────────────────
const FONT_SIZES = [
  { label: 'S', value: '12px' },
  { label: 'M', value: '13px' },
  { label: 'L', value: '15px' },
]
const DENSITIES = [
  { label: 'Compact',  value: '1.3' },
  { label: 'Normal',   value: '1.5' },
  { label: 'Relaxed',  value: '1.7' },
]

function DisplaySection() {
  const [fontSize,    setFontSize]    = useState(() => localStorage.getItem(FONT_SIZE_KEY)    ?? '13px')
  const [density,     setDensity]     = useState(() => localStorage.getItem(FONT_DENSITY_KEY) ?? '1.5')

  function applySize(v: string) {
    setFontSize(v)
    localStorage.setItem(FONT_SIZE_KEY, v)
    document.documentElement.style.fontSize = v
  }

  function applyDensity(v: string) {
    setDensity(v)
    localStorage.setItem(FONT_DENSITY_KEY, v)
    document.documentElement.style.setProperty('--aurora-line-height', v)
    document.body.dataset.density = v
  }

  return (
    <div>
      <Label>Display</Label>
      <div className="flex flex-col gap-2">
        <div>
          <div className="text-[9px] text-eve-dim mb-1">Font size</div>
          <div className="flex gap-1">
            {FONT_SIZES.map(o => (
              <button
                key={o.value}
                onClick={() => applySize(o.value)}
                className={`flex-1 py-1 text-[10px] border rounded-sm transition-colors ${
                  fontSize === o.value
                    ? 'border-cyan-400/60 text-cyan-400 bg-cyan-400/10'
                    : 'border-eve-border text-eve-muted hover:border-cyan-400/30 hover:text-cyan-400/70'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-eve-dim mb-1">Density</div>
          <div className="flex gap-1">
            {DENSITIES.map(o => (
              <button
                key={o.value}
                onClick={() => applyDensity(o.value)}
                className={`flex-1 py-1 text-[10px] border rounded-sm transition-colors ${
                  density === o.value
                    ? 'border-cyan-400/60 text-cyan-400 bg-cyan-400/10'
                    : 'border-eve-border text-eve-muted hover:border-cyan-400/30 hover:text-cyan-400/70'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface OptionsMenuProps {
  darkMode?: boolean
  setDarkMode?: (v: boolean) => void
}

export default function OptionsMenu({ darkMode, setDarkMode }: OptionsMenuProps) {
  const [open, setOpen]   = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || dropRef.current?.contains(t)) return
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
          <div
            className="px-3 py-2 flex items-center gap-2"
            style={{ borderBottom: '1px solid rgba(0,212,255,0.12)' }}
          >
            <div className="w-1 h-1 rounded-full bg-cyan-400 shadow-[0_0_4px_rgba(0,212,255,0.8)]" />
            <span className="text-[9px] tracking-[0.2em] text-cyan-400/70 uppercase font-mono">Settings</span>
          </div>

          <div className="px-3 py-2.5 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
            {darkMode !== undefined && setDarkMode !== undefined && (
              <>
                <ThemeSection darkMode={darkMode} setDarkMode={setDarkMode} />
                <Divider />
              </>
            )}
            <MicSection />
            <Divider />
            <VolumeSection />
            <Divider />
            <ElevenLabsSection />
            <Divider />
            <DisplaySection />
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
          open ? 'text-cyan-400 bg-cyan-400/15' : 'text-eve-muted hover:text-cyan-400 hover:bg-cyan-400/10'
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

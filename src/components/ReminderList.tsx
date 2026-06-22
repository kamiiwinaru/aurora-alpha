import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell } from 'lucide-react'

interface Reminder {
  id: string
  text: string
  fireAt: string
  fired: boolean
  createdAt: string
}

const API = '/api/reminders'

function parseDelay(input: string): number | null {
  const s = input.toLowerCase().trim()
  let ms = 0
  const patterns: [RegExp, number][] = [
    [/(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s|$)/,  3_600_000],
    [/(\d+(?:\.\d+)?)\s*m(?:ins?|inutes?)?(?:\s|$)/, 60_000],
    [/(\d+(?:\.\d+)?)\s*s(?:ecs?|econds?)?(?:\s|$)/, 1_000],
  ]
  for (const [re, mult] of patterns) {
    const m = s.match(re)
    if (m) ms += parseFloat(m[1]) * mult
  }
  return ms > 0 ? ms : null
}

function formatCountdown(fireAt: string): string {
  const diff = new Date(fireAt).getTime() - Date.now()
  if (diff <= 0) return 'NOW'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1_000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function ReminderList() {
  const [open, setOpen]           = useState(false)
  const [items, setItems]         = useState<Reminder[]>([])
  const [draft, setDraft]         = useState('')
  const [inputErr, setInputErr]   = useState('')
  const [panelPos, setPanelPos]   = useState({ top: 0, left: 0 })
  const [alerts, setAlerts]       = useState<Reminder[]>([])
  const [tick, setTick]           = useState(0)
  const inputRef  = useRef<HTMLInputElement>(null)
  const btnRef    = useRef<HTMLButtonElement>(null)

  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch(API)
      if (res.ok) setItems(await res.json())
    } catch { /* server not ready */ }
  }, [])

  // Poll every 15s; also tick every second for countdown display
  useEffect(() => { fetchReminders() }, [fetchReminders])
  useEffect(() => {
    const pollId = setInterval(fetchReminders, 15_000)
    const tickId = setInterval(() => setTick(t => t + 1), 1_000)
    return () => { clearInterval(pollId); clearInterval(tickId) }
  }, [fetchReminders])

  // Fire check
  useEffect(() => {
    const now = Date.now()
    const due = items.filter(r => !r.fired && new Date(r.fireAt).getTime() <= now)
    if (due.length === 0) return
    setAlerts(prev => {
      const existingIds = new Set(prev.map(a => a.id))
      return [...prev, ...due.filter(r => !existingIds.has(r.id))]
    })
    // Mark fired on server
    due.forEach(async r => {
      try {
        await fetch(`${API}/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fired: true }),
        })
      } catch { /* ignore */ }
    })
    setItems(prev => prev.map(r => due.find(d => d.id === r.id) ? { ...r, fired: true } : r))
  }, [tick, items])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const add = async () => {
    const text = draft.trim()
    if (!text) return
    setInputErr('')
    const delayMs = parseDelay(text)
    if (!delayMs) {
      setInputErr('Include a time: "2h", "30m", "1h 30m"')
      return
    }
    const fireAt = new Date(Date.now() + delayMs).toISOString()
    // Strip out the time tokens to get the message text
    const cleaned = text
      .replace(/\bin\b/gi, '')
      .replace(/\d+(?:\.\d+)?\s*h(?:ours?|rs?)?/gi, '')
      .replace(/\d+(?:\.\d+)?\s*m(?:in(?:utes?)?)?/gi, '')
      .replace(/\d+(?:\.\d+)?\s*s(?:ec(?:onds?)?)?/gi, '')
      .replace(/\bremind\s+me\b/gi, '')
      .replace(/\bto\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    const label = cleaned || text
    setDraft('')
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: label, fireAt }),
      })
      if (res.ok) { const item = await res.json(); setItems(prev => [...prev, item]) }
    } catch { /* ignore */ }
  }

  const remove = async (id: string) => {
    try { await fetch(`${API}/${id}`, { method: 'DELETE' }) } catch { /* ignore */ }
    setItems(prev => prev.filter(r => r.id !== id))
  }

  const dismissAlert = (id: string) => setAlerts(prev => prev.filter(a => a.id !== id))

  const active = items.filter(r => !r.fired)
  const pending = active.length

  return (
    <>
      {/* Bell button — top-left of Aurora image */}
      <button
        ref={btnRef}
        onClick={() => {
          if (btnRef.current) {
            const r = btnRef.current.getBoundingClientRect()
            setPanelPos({ top: r.top, left: r.right + 10 })
          }
          setOpen(v => !v)
        }}
        className="absolute top-1.5 left-1.5 z-20 w-6 h-6 flex items-center justify-center rounded bg-black/60 border border-eve-border hover:border-eve-cyan hover:text-eve-cyan transition-colors text-eve-muted"
        title="Reminders"
      >
        <Bell size={12} />
        {pending > 0 && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-eve-gold text-black text-[8px] font-bold flex items-center justify-center leading-none">
            {pending > 9 ? '9+' : pending}
          </span>
        )}
      </button>

      {/* Reminder panel popup */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95, x: -6 }}
              transition={{ duration: 0.15 }}
              className="eve-panel border border-eve-border shadow-xl shadow-black/80"
              style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 9999, minWidth: '260px', width: 'max-content', maxWidth: '360px' }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-eve-border">
                <span className="eve-header text-[10px]">REMINDERS</span>
                <button onClick={() => setOpen(false)} className="text-eve-dim hover:text-eve-cyan text-xs leading-none">✕</button>
              </div>

              <div className="max-h-64 overflow-y-auto px-3 py-2 space-y-1.5">
                {active.length === 0 && (
                  <div className="text-xs text-eve-dim text-center py-4">No active reminders.</div>
                )}
                {active.map(item => (
                  <div key={item.id} className="flex items-center gap-2 group">
                    <Bell size={10} className="text-eve-gold shrink-0" />
                    <span className="flex-1 text-xs text-eve-text truncate">{item.text}</span>
                    <span className="text-[10px] font-mono text-eve-cyan shrink-0 tabular-nums">
                      {formatCountdown(item.fireAt)}
                    </span>
                    <button
                      onClick={() => remove(item.id)}
                      className="shrink-0 text-eve-dim hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-t border-eve-border px-3 py-2 space-y-1">
                <div className="text-[9px] text-eve-dim">
                  {inputErr ? <span className="text-eve-red">{inputErr}</span> : 'e.g. "check market in 2h" or "in 30m refuel"'}
                </div>
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={e => { setDraft(e.target.value); setInputErr('') }}
                    onKeyDown={e => { if (e.key === 'Enter') add() }}
                    placeholder="in 2h check market…"
                    className="flex-1 bg-transparent text-xs text-eve-text placeholder-eve-dim outline-none border-b border-eve-border focus:border-eve-cyan transition-colors py-0.5"
                  />
                  <button
                    onClick={add}
                    disabled={!draft.trim()}
                    className="text-xs text-eve-cyan disabled:text-eve-dim transition-colors hover:text-eve-gold"
                  >
                    SET
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Alert toasts — stacked bottom-right */}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[10000] flex flex-col gap-2 items-end pointer-events-none">
          <AnimatePresence>
            {alerts.map(alert => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="eve-panel border border-eve-gold/60 shadow-xl shadow-black/80 pointer-events-auto flex items-start gap-3 px-4 py-3 max-w-xs"
              >
                <Bell size={14} className="text-eve-gold shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="eve-header text-[9px] text-eve-gold mb-0.5">REMINDER</div>
                  <div className="text-xs text-eve-text break-words">{alert.text}</div>
                </div>
                <button
                  onClick={() => dismissAlert(alert.id)}
                  className="text-eve-dim hover:text-eve-cyan text-xs leading-none shrink-0 mt-0.5"
                >
                  ✕
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </>
  )
}

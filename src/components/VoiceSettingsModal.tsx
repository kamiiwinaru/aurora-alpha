import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, Mic, BookOpen, Volume2 } from 'lucide-react'
import type { TtsMode } from '../hooks/useChat'

interface PronunciationEntry { word: string; phonetic: string }

interface VoiceSettingsModalProps {
  ttsMode: TtsMode
  onTtsModeChange: (mode: TtsMode) => void
  onClose: () => void
}

const MODE_OPTIONS: { value: TtsMode; label: string; desc: string }[] = [
  { value: 'concise', label: 'CONCISE', desc: 'First 1–2 sentences only. Quick answers, minimal reading.' },
  { value: 'standard', label: 'STANDARD', desc: 'Key prose up to ~500 chars. Skips tables and data blocks.' },
  { value: 'full', label: 'FULL', desc: 'All prose content. Tables and code are still skipped.' },
]

export default function VoiceSettingsModal({ ttsMode, onTtsModeChange, onClose }: VoiceSettingsModalProps) {
  const [tab, setTab] = useState<'response' | 'pronunciation'>('response')
  const [entries, setEntries] = useState<PronunciationEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [newWord, setNewWord] = useState('')
  const [newPhonetic, setNewPhonetic] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPronunciations = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/pronunciations')
      setEntries(await res.json() as PronunciationEntry[])
    } catch { /* server not ready */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPronunciations() }, [fetchPronunciations])

  const handleAdd = async () => {
    const word = newWord.trim()
    const phonetic = newPhonetic.trim()
    if (!word || !phonetic) { setError('Both fields required'); return }
    setAdding(true); setError(null)
    try {
      await fetch('/api/pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, phonetic }),
      })
      setNewWord(''); setNewPhonetic('')
      await fetchPronunciations()
    } catch { setError('Failed to save') } finally { setAdding(false) }
  }

  const handleDelete = async (word: string) => {
    try {
      await fetch(`/api/pronunciations/${encodeURIComponent(word)}`, { method: 'DELETE' })
      setEntries(prev => prev.filter(e => e.word !== word))
    } catch { /* ignore */ }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="voice-settings-overlay"
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-eve-black/70" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 8 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
          className="relative w-full max-w-lg mx-4 bg-eve-black border border-eve-cyan/30 font-mono overflow-hidden"
          style={{ boxShadow: '0 0 40px rgba(0,212,255,0.1), 0 0 80px rgba(0,212,255,0.05)' }}
        >
          {/* Corner brackets */}
          <div className="absolute -inset-[2px] pointer-events-none z-10">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-eve-cyan/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-eve-cyan/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-eve-cyan/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-eve-cyan/60" />
          </div>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-eve-cyan/20 bg-eve-panel">
            <Mic size={13} className="text-eve-cyan shrink-0" />
            <span className="text-eve-cyan text-[11px] tracking-[0.3em] flex-1">VOICE SETTINGS</span>
            <button
              onClick={onClose}
              className="p-1 border border-eve-dim text-eve-muted hover:border-eve-red/60 hover:text-eve-red transition-colors"
            >
              <X size={11} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-eve-border">
            {[
              { id: 'response' as const, label: 'RESPONSE STYLE', icon: <Volume2 size={10} /> },
              { id: 'pronunciation' as const, label: 'PRONUNCIATION', icon: <BookOpen size={10} /> },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-[10px] tracking-widest transition-all border-b-2 -mb-px ${
                  tab === t.id
                    ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/5'
                    : 'border-transparent text-eve-muted hover:text-eve-text'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Response Style tab ── */}
          {tab === 'response' && (
            <div className="px-5 py-5 flex flex-col gap-3">
              <p className="text-eve-muted text-[10px] leading-relaxed tracking-wide">
                Controls how much of each response Aurora reads aloud. Tables and code blocks are always skipped.
              </p>
              <div className="flex flex-col gap-2 mt-1">
                {MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => onTtsModeChange(opt.value)}
                    className={`text-left px-4 py-3 border transition-all ${
                      ttsMode === opt.value
                        ? 'border-eve-cyan/60 bg-eve-cyan/8 text-eve-cyan'
                        : 'border-eve-border text-eve-muted hover:border-eve-cyan/30 hover:text-eve-text'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <motion.div
                        className={`w-2 h-2 rounded-full border-2 shrink-0 ${
                          ttsMode === opt.value ? 'border-eve-cyan bg-eve-cyan' : 'border-eve-dim'
                        }`}
                        animate={ttsMode === opt.value ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                        transition={{ duration: 0.3 }}
                      />
                      <span className="text-[11px] tracking-widest font-mono">{opt.label}</span>
                    </div>
                    <p className="text-[9px] text-eve-dim tracking-wide mt-1.5 ml-4 leading-relaxed">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Pronunciation tab ── */}
          {tab === 'pronunciation' && (
            <div className="px-5 py-5 flex flex-col gap-4 max-h-96 overflow-y-auto">
              <p className="text-eve-muted text-[10px] leading-relaxed tracking-wide">
                Teach Aurora how to say EVE-specific terms. The phonetic spelling is sent to ElevenLabs in place of the original word.
              </p>

              {/* Add form */}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-eve-dim text-[9px] tracking-widest">WORD / PHRASE</label>
                    <input
                      value={newWord}
                      onChange={e => setNewWord(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAdd()}
                      placeholder="e.g. Jita"
                      className="eve-input py-2 text-[11px]"
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-eve-dim text-[9px] tracking-widest">PHONETIC SPELLING</label>
                    <input
                      value={newPhonetic}
                      onChange={e => setNewPhonetic(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAdd()}
                      placeholder="e.g. Yeeta"
                      className="eve-input py-2 text-[11px]"
                    />
                  </div>
                </div>
                {error && <p className="text-eve-red text-[9px] tracking-widest">{error}</p>}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleAdd}
                  disabled={adding}
                  className="self-start flex items-center gap-1.5 px-3 py-2 border border-eve-cyan/40 bg-eve-cyan/5 hover:bg-eve-cyan/10 hover:border-eve-cyan/70 text-eve-cyan text-[10px] tracking-widest transition-all disabled:opacity-50"
                >
                  <Plus size={10} />
                  {adding ? 'SAVING...' : 'ADD ENTRY'}
                </motion.button>
              </div>

              {/* Entry list */}
              {loading ? (
                <div className="text-eve-muted text-[10px] tracking-widest text-center py-4">
                  <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                    LOADING...
                  </motion.span>
                </div>
              ) : entries.length === 0 ? (
                <div className="text-eve-dim text-[10px] tracking-widest text-center py-6 border border-dashed border-eve-border">
                  NO ENTRIES YET — ADD ONE ABOVE
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-2 pb-1 border-b border-eve-border">
                    <span className="text-eve-dim text-[9px] tracking-widest">WORD</span>
                    <span className="text-eve-dim text-[9px] tracking-widest">PHONETIC</span>
                    <span />
                  </div>
                  <AnimatePresence>
                    {entries.map(entry => (
                      <motion.div
                        key={entry.word}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center px-2 py-2 border border-eve-border/40 hover:border-eve-border transition-colors"
                      >
                        <span className="text-eve-text text-[11px] font-mono truncate">{entry.word}</span>
                        <span className="text-eve-cyan text-[11px] font-mono truncate">{entry.phonetic}</span>
                        <button
                          onClick={() => handleDelete(entry.word)}
                          className="text-eve-muted hover:text-eve-red transition-colors p-1"
                        >
                          <Trash2 size={10} />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="px-5 py-3 border-t border-eve-border bg-eve-panel">
            <p className="text-eve-dim text-[9px] tracking-widest">
              CHANGES APPLY TO ALL FUTURE RESPONSES · SERVER RESTART NOT REQUIRED
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

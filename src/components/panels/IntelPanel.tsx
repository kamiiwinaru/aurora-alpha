import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Radio, FolderOpen, RefreshCw, Filter, X, AlertTriangle, CheckCircle, Eye, Plus, Trash2, Bell, BellOff, MapPin, FolderSync, ChevronDown, ChevronUp } from 'lucide-react'
import type { EveShipLocation } from '../../types'
import { SYSTEM_RE, renderMessage, buildSpans } from '../../lib/intel-highlight'
import { EVE_SYSTEM_NAMES } from '../../lib/eve-system-names'
import { EVE_SYSTEM_IDS } from '../../lib/eve-system-ids'
import { EVE_SYSTEM_GRAPH } from '../../lib/eve-system-graph'

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntelEntry {
  id: string
  timestamp: Date
  character: string
  message: string
  category: 'hostile' | 'clear' | 'neutral' | 'info'
}

interface ChannelState {
  id: string
  channelName: string | null
  entries: IntelEntry[]
  filter: string
  categoryFilter: IntelEntry['category'] | 'all'
  lastLoaded: Date | null
  autoRefresh: boolean
  error: string | null
  fileHandle?: FileSystemFileHandle | null
  pos: { x: number; y: number }
  size: { w: number; h: number }
  zIndex: number
  minimized: boolean
}

const MAX_CHANNELS = 10
const WIN_W = 400
const WIN_H = 300

interface FileSystemFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: object) => Promise<FileSystemFileHandle[]>
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HOSTILE_KEYWORDS = ['neut', 'neutral', 'hostile', 'red', 'nv', 'nb', 'combat', 'fleet', 'gang', 'blob', 'cyno', 'bubbl', 'camp', 'gatecamp', 'tackle', 'pointed', 'warp disrupt']
const CLEAR_KEYWORDS   = ['clr', 'clear', 'safe', 'gone', 'left', 'docked', 'no one', 'empty', 'dock']

function categorise(msg: string): IntelEntry['category'] {
  const lower = msg.toLowerCase()
  if (CLEAR_KEYWORDS.some(k => lower.includes(k))) return 'clear'
  if (HOSTILE_KEYWORDS.some(k => lower.includes(k))) return 'hostile'
  if (lower.startsWith('o/') || lower === 'o7' || lower.startsWith('gf')) return 'info'
  return 'neutral'
}

function parseLogContent(text: string): { channelName: string; entries: IntelEntry[] } {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
  let channelName = 'Unknown Channel'

  for (const line of lines.slice(0, 15)) {
    const m = line.match(/Channel Name:\s+(.+)/)
    if (m) { channelName = m[1].trim(); break }
  }

  const entries: IntelEntry[] = []
  const lineRe = /^\s*\[\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})\s*\]\s*([^>]+?)\s*>\s*(.+)$/

  for (const line of lines) {
    const m = line.match(lineRe)
    if (!m) continue
    const [, ts, character, message] = m
    const timestamp = new Date(ts.replace(/\./g, '-').replace(' ', 'T') + 'Z')
    if (isNaN(timestamp.getTime())) continue
    if (character.trim() === 'EVE System') continue
    entries.push({
      id: `${ts}-${character.trim()}`,
      timestamp,
      character: character.trim(),
      message: message.trim(),
      category: categorise(message),
    })
  }

  return { channelName, entries: entries.reverse() }
}

function decodeEveLog(buf: ArrayBuffer): string {
  return new TextDecoder('utf-16').decode(buf).replace(/﻿/g, '')
}

function formatAge(ts: Date): string {
  const secs = Math.floor((Date.now() - ts.getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 3600)}h`
}

// ─── Sound ────────────────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null

interface AlertDetail { urgency: 'near' | 'mid'; system?: string; jumps?: number; count?: number; characters?: string[]; ships?: string[] }
let _onAlertFired: ((d: AlertDetail) => void) | null = null

async function playAlert(d: AlertDetail) {
  _onAlertFired?.(d)
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new AudioContext()
    // Fire-and-forget resume — awaiting it can hang indefinitely in Electron when
    // the context auto-suspends due to inactivity (no user gesture available).
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
    const ctx  = _audioCtx
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    const freqs = d.urgency === 'near' ? [880, 1100, 880] : [660, 880]
    // 80 ms head room — gives the resume() call time to lift suspension before
    // the first note starts. 10 ms was too tight when context was resuming.
    let t = ctx.currentTime + 0.08
    for (const freq of freqs) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      gain.gain.setValueAtTime(0.3, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      osc.start(t)
      osc.stop(t + 0.2)
      t += 0.25
    }
  } catch { /* blocked */ }
}

export function testAlert() { playAlert({ urgency: 'near' }) }

// ─── ESI distance ─────────────────────────────────────────────────────────────

const systemNameCache   = new Map<string, number>()   // name → id
const routeCache        = new Map<string, number>()   // `${a}-${b}` → jumps
const recentAlertedSys  = new Map<string, number>()   // system → last alert timestamp
const ALERT_COOLDOWN_MS = 45_000                      // 45s per-system dedup window
const ALERT_MAX_AGE_MS  = 90_000                      // ignore entries older than 90s

function resolveSystemId(name: string): number | null {
  const upper = name.toUpperCase()
  if (systemNameCache.has(upper)) return systemNameCache.get(upper)!
  const local = EVE_SYSTEM_IDS.get(name.toLowerCase())
  if (local) { systemNameCache.set(upper, local); return local }
  return null
}

function jumpsBetween(originId: number, destId: number, maxJumps = 20): number | null {
  if (originId === destId) return 0
  const key = `${Math.min(originId, destId)}-${Math.max(originId, destId)}`
  if (routeCache.has(key)) return routeCache.get(key)!
  // BFS using local connection graph — no ESI calls
  const visited = new Set<number>([originId])
  let frontier = [originId]
  for (let d = 1; d <= maxJumps; d++) {
    const next: number[] = []
    for (const sys of frontier) {
      for (const neighbor of EVE_SYSTEM_GRAPH.get(sys) ?? []) {
        if (neighbor === destId) { routeCache.set(key, d); return d }
        if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor) }
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  routeCache.set(key, maxJumps + 1)
  return maxJumps + 1
}

// Returns full path of system IDs from origin to dest, or null if unreachable within maxJumps
export function findRoute(originId: number, destId: number, maxJumps = 20): number[] | null {
  if (originId === destId) return [originId]
  const prev = new Map<number, number>([[originId, -1]])
  let frontier = [originId]
  for (let d = 1; d <= maxJumps; d++) {
    const next: number[] = []
    for (const sys of frontier) {
      for (const neighbor of EVE_SYSTEM_GRAPH.get(sys) ?? []) {
        if (prev.has(neighbor)) continue
        prev.set(neighbor, sys)
        if (neighbor === destId) {
          const path: number[] = []
          let cur: number = destId
          while (cur !== -1) { path.unshift(cur); cur = prev.get(cur)! }
          return path
        }
        next.push(neighbor)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return null
}


function categoryStyle(cat: IntelEntry['category']) {
  switch (cat) {
    case 'hostile': return { border: 'border-l-eve-red/70',   bg: 'bg-eve-red/5',   icon: <AlertTriangle size={9} className="text-eve-red" /> }
    case 'clear':   return { border: 'border-l-eve-green/70', bg: 'bg-eve-green/5', icon: <CheckCircle   size={9} className="text-eve-green" /> }
    case 'info':    return { border: 'border-l-eve-cyan/50',  bg: '',               icon: <Eye           size={9} className="text-eve-cyan" /> }
    default:        return { border: 'border-l-eve-border',   bg: '',               icon: null }
  }
}

type RawEntry = { id: string; timestamp: string; character: string; message: string; category: string }
type RawLogs  = { logs?: Array<{ channelName: string; entries: RawEntry[] }>; error?: string }

function parseEntries(raw: RawEntry[]): IntelEntry[] {
  return raw.map(e => ({ ...e, timestamp: new Date(e.timestamp), category: e.category as IntelEntry['category'] }))
}

let nextId = 1
// Step matches title bar height so each window's bar is visible beneath the one above
const CASCADE_STEP = 30

function makeChannel(index = 0): ChannelState {
  return {
    id: String(nextId++),
    channelName: null,
    entries: [],
    filter: '',
    categoryFilter: 'all',
    lastLoaded: null,
    autoRefresh: false,
    error: null,
    pos: { x: index * CASCADE_STEP, y: index * CASCADE_STEP },
    size: { w: WIN_W, h: WIN_H },
    zIndex: index,
    minimized: false,
  }
}

// ─── ChannelWindow ────────────────────────────────────────────────────────────

function ChannelWindow({
  channel,
  onUpdate,
  onRemove,
  originSystemId,
  alertThreshold,
  alertsEnabled,
  onZkillLookup,
  onFocus,
}: {
  channel: ChannelState
  onUpdate: (patch: Partial<ChannelState>) => void
  onRemove: () => void
  originSystemId: number | null
  alertThreshold: number
  alertsEnabled: boolean
  onZkillLookup?: (query: string, category: 'character' | 'system') => void
  onFocus: () => void
}) {

  const fileHandleRef  = useRef<FileSystemFileHandle | null>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const alertedIds  = useRef<Set<string>>(new Set())
  const baselineSet = useRef(false)
  const knownIds    = useRef<Set<string>>(new Set())

  // Keep volatile props in refs so checkAlerts/load/refreshFromHandle stay stable.
  // Without this, onUpdate (inline arrow in parent) changes every render → load changes
  // → refreshFromHandle changes → the interval effect restarts the timer before it fires.
  const alertsEnabledRef   = useRef(alertsEnabled)
  const originSystemIdRef  = useRef(originSystemId)
  const alertThresholdRef  = useRef(alertThreshold)
  const onUpdateRef        = useRef(onUpdate)
  useEffect(() => { alertsEnabledRef.current  = alertsEnabled  }, [alertsEnabled])
  useEffect(() => { originSystemIdRef.current = originSystemId }, [originSystemId])
  useEffect(() => { alertThresholdRef.current = alertThreshold }, [alertThreshold])
  useEffect(() => { onUpdateRef.current       = onUpdate       }, [onUpdate])

  // Sync externally-provided file handle (e.g. from auto-load) into the ref
  useEffect(() => {
    if (channel.fileHandle !== undefined) {
      fileHandleRef.current = channel.fileHandle ?? null
    }
  }, [channel.fileHandle])

  // Stable — reads all volatile values from refs, never recreated
  const checkAlerts = useCallback(async (entries: IntelEntry[]) => {
    if (!baselineSet.current) {
      baselineSet.current = true
      for (const e of entries) knownIds.current.add(e.id)
      return
    }
    if (!alertsEnabledRef.current) return
    const newEntries = entries.filter(e => !knownIds.current.has(e.id))
    for (const e of entries) knownIds.current.add(e.id)

    for (const entry of newEntries) {
      if (alertedIds.current.has(entry.id)) continue
      if (Date.now() - entry.timestamp.getTime() > ALERT_MAX_AGE_MS) continue

      const systemsInMsg = new Set<string>()
      SYSTEM_RE.lastIndex = 0
      for (const m of entry.message.matchAll(SYSTEM_RE)) systemsInMsg.add(m[1])
      for (const word of entry.message.split(/\W+/)) {
        if (word.length >= 3 && EVE_SYSTEM_NAMES.has(word.toLowerCase())) systemsInMsg.add(word)
      }
      if (systemsInMsg.size === 0) continue

      const extraCount = (entry.message.match(/\+(\d+)/) ?? [])[1]
      const count = extraCount ? parseInt(extraCount, 10) : undefined
      const spans = buildSpans(entry.message)
      const characters = [...new Set(spans.filter(s => s.type === 'character').map(s => s.value))]
      const ships = [...new Set(spans.filter(s => s.type === 'ship').map(s => s.value))]

      if (!originSystemIdRef.current) {
        const sys = [...systemsInMsg][0]
        const now = Date.now()
        if (sys && (now - (recentAlertedSys.get(sys.toLowerCase()) ?? 0)) < ALERT_COOLDOWN_MS) continue
        if (sys) recentAlertedSys.set(sys.toLowerCase(), now)
        alertedIds.current.add(entry.id)
        await playAlert({ urgency: 'mid', system: sys, count, characters, ships })
        continue
      }

      for (const sysName of systemsInMsg) {
        const destId = resolveSystemId(sysName)
        if (!destId) continue
        const jumps = jumpsBetween(originSystemIdRef.current, destId)
        if (jumps === null) continue
        if (jumps <= alertThresholdRef.current) {
          const now = Date.now()
          if ((now - (recentAlertedSys.get(sysName.toLowerCase()) ?? 0)) < ALERT_COOLDOWN_MS) break
          recentAlertedSys.set(sysName.toLowerCase(), now)
          alertedIds.current.add(entry.id)
          await playAlert({ urgency: jumps <= 2 ? 'near' : 'mid', system: sysName, jumps, count, characters, ships })
          break
        }
      }
    }
  }, []) // stable

  // Stable — uses onUpdateRef so it doesn't recreate when the parent re-renders
  const load = useCallback((file: File) => {
    file.arrayBuffer().then(buf => {
      const text   = decodeEveLog(buf)
      const parsed = parseLogContent(text)
      onUpdateRef.current({ channelName: parsed.channelName, entries: parsed.entries, lastLoaded: new Date(), error: null })
      checkAlerts(parsed.entries)
    }).catch(() => onUpdateRef.current({ error: 'Failed to read file.' }))
  }, [checkAlerts]) // stable

  const refreshFromHandle = useCallback(async () => {
    if (!fileHandleRef.current) return
    try {
      load(await fileHandleRef.current.getFile())
    } catch {
      onUpdateRef.current({ error: 'Could not re-read file.' })
    }
  }, [load]) // stable

  // Only restarts when autoRefresh toggles — not on every render
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (channel.autoRefresh) {
      intervalRef.current = setInterval(() => {
        if (fileHandleRef.current) refreshFromHandle()
      }, 5000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [channel.autoRefresh, refreshFromHandle])

  const openPicker = useCallback(async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'EVE Log Files', accept: { 'text/plain': ['.txt'] } }],
          multiple: false,
        })
        fileHandleRef.current = handle
        load(await handle.getFile())
        onUpdateRef.current({ autoRefresh: true })
      } catch { /* cancelled */ }
    } else {
      fileInputRef.current?.click()
    }
  }, [load])

  const onFallbackFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    fileHandleRef.current = null
    onUpdateRef.current({ autoRefresh: false })
    load(file)
    e.target.value = ''
  }, [load])

  // Unique character names seen as senders — used to highlight names in message bodies
  const knownNames = [...new Set(channel.entries.map(e => e.character))]

  const visible = channel.entries.filter(en => {
    if (channel.categoryFilter !== 'all' && en.category !== channel.categoryFilter) return false
    if (!channel.filter.trim()) return true
    const q = channel.filter.toLowerCase()
    return en.character.toLowerCase().includes(q) || en.message.toLowerCase().includes(q)
  })

  const hostileCount = channel.entries.filter(e => e.category === 'hostile').length
  const clearCount   = channel.entries.filter(e => e.category === 'clear').length

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      className={`flex flex-col border border-eve-border bg-eve-panel overflow-hidden shadow-lg ${channel.minimized ? '' : 'h-[280px]'}`}
    >
      {/* Title bar */}
      <div
        onClick={onFocus}
        className="flex items-center justify-between px-2 py-1.5 border-b border-eve-border bg-eve-deep shrink-0 select-none cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Radio size={9} className="text-eve-cyan shrink-0" />
          <span className="text-eve-cyan text-[10px] font-mono truncate">
            {channel.channelName ?? 'NO CHANNEL'}
          </span>
          {channel.channelName && (
            <span className="text-eve-dim text-[9px] shrink-0">
              · <span className="text-eve-red">{hostileCount}H</span>
              {' '}<span className="text-eve-green">{clearCount}C</span>
            </span>
          )}
          {channel.autoRefresh && (
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
              <RefreshCw size={8} className="text-eve-green shrink-0" />
            </motion.div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={openPicker}
            className="text-[9px] px-1.5 py-0.5 border border-eve-cyan/30 text-eve-cyan/70 font-mono hover:bg-eve-cyan/10 transition-colors flex items-center gap-1"
          >
            <FolderOpen size={8} />{channel.channelName ? 'SWAP' : 'LOAD'}
          </button>
          <button
            onClick={() => onUpdate({ minimized: !channel.minimized })}
            className="text-eve-dim hover:text-eve-text px-1 py-0.5 transition-colors"
          >
            {channel.minimized ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          <button
            onClick={onRemove}
            className="text-eve-red/50 hover:text-eve-red px-1 py-0.5 transition-colors"
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {!channel.minimized && (
        <>
          {/* Filter bar */}
          {channel.channelName && (
            <div className="flex gap-1 px-2 py-1 border-b border-eve-border/50 shrink-0">
              <div className="relative flex-1">
                <Filter size={8} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-eve-dim" />
                <input
                  className="eve-input w-full pl-5 py-0.5 text-[10px]"
                  placeholder="Filter..."
                  value={channel.filter}
                  onChange={e => onUpdate({ filter: e.target.value })}
                />
                {channel.filter && (
                  <button onClick={() => onUpdate({ filter: '' })} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-eve-dim hover:text-eve-text">
                    <X size={8} />
                  </button>
                )}
              </div>
              {(['all', 'hostile', 'clear'] as const).map(cat => (
                <button
                  key={cat}
                  onClick={() => onUpdate({ categoryFilter: cat })}
                  className={`px-1.5 text-[9px] uppercase border font-mono transition-colors
                    ${channel.categoryFilter === cat
                      ? cat === 'hostile' ? 'border-eve-red/60 bg-eve-red/10 text-eve-red'
                        : cat === 'clear' ? 'border-eve-green/60 bg-eve-green/10 text-eve-green'
                        : 'border-eve-cyan/40 bg-eve-cyan/10 text-eve-cyan'
                      : 'border-eve-border text-eve-dim hover:text-eve-muted'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={onFallbackFile} />

          {/* Error */}
          {channel.error && (
            <div className="px-2 py-1 text-eve-red text-[10px] border-b border-eve-red/20 bg-eve-red/5 shrink-0">
              {channel.error}
            </div>
          )}

          {/* Feed */}
          {channel.channelName && visible.length > 0 && (
            <>
              <div className="grid grid-cols-12 gap-1 px-2 py-1 border-b border-eve-border text-[8px] text-eve-dim uppercase tracking-widest shrink-0">
                <span className="col-span-1">AGE</span>
                <span className="col-span-3">PILOT</span>
                <span className="col-span-7">MESSAGE</span>
                <span className="col-span-1" />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {visible.map(en => {
                    const s = categoryStyle(en.category)
                    return (
                      <motion.div
                        key={en.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`grid grid-cols-12 gap-1 px-2 py-1 border-b border-eve-border/20 border-l-2 ${s.border} ${s.bg} hover:bg-eve-border/10 transition-colors items-start`}
                      >
                        <div className="col-span-1 text-eve-dim text-[9px] font-mono">{formatAge(en.timestamp)}</div>
                        <div className="col-span-3 text-[9px] truncate font-mono">
                          {onZkillLookup ? (
                            <button
                              onClick={() => onZkillLookup(en.character, 'character')}
                              className="text-eve-gold hover:underline hover:text-eve-gold/80 cursor-pointer truncate max-w-full text-left"
                              title={`zkill: ${en.character}`}
                            >
                              {en.character}
                            </button>
                          ) : (
                            <span className="text-eve-gold">{en.character}</span>
                          )}
                        </div>
                        <div className="col-span-7 text-eve-text text-[9px] break-words leading-tight">{renderMessage(en.message, knownNames, onZkillLookup)}</div>
                        <div className="col-span-1 flex justify-end pt-px">{s.icon}</div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
              {channel.lastLoaded && (
                <div className="px-2 py-0.5 text-[8px] text-eve-dim border-t border-eve-border/30 shrink-0">
                  {channel.entries.length} entries · {formatAge(channel.lastLoaded)} ago
                </div>
              )}
            </>
          )}

          {/* Empty — no file loaded */}
          {!channel.channelName && !channel.error && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-4">
              <Radio size={24} className="text-eve-cyan/20" />
              <div className="text-eve-dim text-[10px]">No channel loaded</div>
              <button onClick={openPicker} className="eve-btn-primary flex items-center gap-1.5 text-[10px] px-3 py-1.5">
                <FolderOpen size={10} />LOAD LOG
              </button>
            </div>
          )}

          {/* Empty — filters hide everything */}
          {channel.channelName && visible.length === 0 && !channel.error && (
            <div className="flex-1 flex flex-col items-center justify-center gap-1">
              <div className="text-eve-dim text-[10px]">No matching entries</div>
              <button onClick={() => onUpdate({ filter: '', categoryFilter: 'all' })} className="text-[9px] text-eve-muted hover:text-eve-text underline">
                clear filters
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}

// ─── IntelPanel ───────────────────────────────────────────────────────────────

interface IntelPanelProps {
  shipLocation?: EveShipLocation | null
  characterId?: number | null
  characterName?: string | null
  onZkillLookup?: (query: string, category: 'character' | 'system') => void
}

const INTEL_MANUAL_SYSTEM_KEY = (id: number) => `aurora_intel_system_${id}`
const INTEL_THRESHOLD_KEY     = (id: number) => `aurora_intel_threshold_${id}`

export default function IntelPanel({ shipLocation, characterId, characterName, onZkillLookup }: IntelPanelProps) {
  const [channels, setChannels]           = useState<ChannelState[]>([])
  const [topZ, setTopZ]                   = useState(100)
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [alertThreshold, setAlertThreshold] = useState<number>(() => {
    if (characterId) {
      const saved = localStorage.getItem(INTEL_THRESHOLD_KEY(characterId))
      if (saved) return Number(saved)
    }
    return 5
  })
  const [manualSystem, setManualSystem]   = useState<string>(() => {
    if (characterId) return localStorage.getItem(INTEL_MANUAL_SYSTEM_KEY(characterId)) ?? ''
    return ''
  })
  const [autoLoadStatus, setAutoLoadStatus] = useState<string | null>('Loading logs...')
  const [alertFlash, setAlertFlash] = useState<'near' | 'mid' | null>(null)
  const [debugPoll, setDebugPoll] = useState<{ n: number; chans: number; newE: number } | null>(null)

  // Register the module-level alert notifier so playAlert() can update React state
  useEffect(() => {
    _onAlertFired = (d) => {
      setAlertFlash(d.urgency)
      setTimeout(() => setAlertFlash(null), 2000)
      window.dispatchEvent(new CustomEvent('aurora_intel_alert', { detail: d }))
    }
    return () => { _onAlertFired = null }
  }, [])

  const originSystemId: number | null = shipLocation?.solarSystemId ?? null
  const originLabel = (shipLocation?.solarSystemName ?? manualSystem) || null

  const updateChannel = useCallback((id: string, patch: Partial<ChannelState>) => {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])
  const addChannel    = useCallback(() => {
    setChannels(prev => prev.length < MAX_CHANNELS ? [...prev, makeChannel(prev.length)] : prev)
  }, [])
  const removeChannel = useCallback((id: string) => {
    setChannels(prev => prev.filter(c => c.id !== id))
  }, [])
  const bringToFront  = useCallback((id: string) => {
    setTopZ(z => {
      const next = z + 1
      setChannels(prev => prev.map(c => c.id === id ? { ...c, zIndex: next } : c))
      return next
    })
  }, [])

  // Persist per-character preferences
  useEffect(() => {
    if (characterId) localStorage.setItem(INTEL_MANUAL_SYSTEM_KEY(characterId), manualSystem)
  }, [characterId, manualSystem])
  useEffect(() => {
    if (characterId) localStorage.setItem(INTEL_THRESHOLD_KEY(characterId), String(alertThreshold))
  }, [characterId, alertThreshold])

  // Reset manual system when character switches
  useEffect(() => {
    if (!characterId) return
    setManualSystem(localStorage.getItem(INTEL_MANUAL_SYSTEM_KEY(characterId)) ?? '')
    setAlertThreshold(Number(localStorage.getItem(INTEL_THRESHOLD_KEY(characterId)) ?? '5'))
  }, [characterId])

  const [manualSystemId, setManualSystemId] = useState<number | null>(null)
  useEffect(() => {
    if (shipLocation || !manualSystem.trim()) { setManualSystemId(null); return }
    setManualSystemId(resolveSystemId(manualSystem.trim()))
  }, [manualSystem, shipLocation])

  const effectiveOriginId = originSystemId ?? manualSystemId

  // ── Refs so server-poll callbacks stay stable ──────────────────────────
  const channelsRef          = useRef<ChannelState[]>(channels)
  const alertsEnabledRef     = useRef(alertsEnabled)
  const alertThresholdRef    = useRef(alertThreshold)
  const effectiveOriginIdRef = useRef<number | null>(effectiveOriginId)
  const characterNameRef     = useRef<string | null | undefined>(characterName)
  const topZRef              = useRef(100)
  useEffect(() => { channelsRef.current          = channels          }, [channels])
  useEffect(() => { alertsEnabledRef.current     = alertsEnabled     }, [alertsEnabled])
  useEffect(() => { alertThresholdRef.current    = alertThreshold    }, [alertThreshold])
  useEffect(() => { effectiveOriginIdRef.current = effectiveOriginId }, [effectiveOriginId])
  useEffect(() => { characterNameRef.current     = characterName     }, [characterName])
  useEffect(() => { topZRef.current              = topZ              }, [topZ])

  const debugPollCountRef   = useRef(0)
  const setDebugPollRef     = useRef(setDebugPoll)

  // seenIds baseline: entries present on first load never trigger alerts
  const seenIdsRef       = useRef<Set<string>>(new Set())
  const alertBaselineSet = useRef(false)

  // ── Stable server refresh — called on mount, on RELOAD, and by the interval
  const refreshFromServer = useCallback(async (isInitial = false) => {
    try {
      const name       = characterNameRef.current
      const openNames  = channelsRef.current.map(c => c.channelName).filter(Boolean) as string[]
      const watchParam = openNames.length ? `&watch=${encodeURIComponent(openNames.join(','))}` : ''
      const url        = name
        ? `/api/intel-auto?listener=${encodeURIComponent(name)}${watchParam}`
        : `/api/intel-auto${watchParam ? '?' + watchParam.slice(1) : ''}`
      const res  = await fetch(url)
      const data = await res.json() as RawLogs
      if (!data.logs?.length) return

      const now = new Date()
      // Merge by channel name — preserves filter/settings, adds new windows for new channels
      const current = [...channelsRef.current]
      const byName  = new Map(current.map((c, i) => [c.channelName?.toLowerCase(), i]))

      const newEntries: IntelEntry[] = []
      for (const log of data.logs) {
        const key     = log.channelName?.toLowerCase()
        const entries = parseEntries(log.entries)
        const isNewChannel = !byName.has(key)

        // New channels (including ones that appear after character name loads) always
        // baseline their entries — never alert on first appearance of a channel.
        const channelNewEntries = alertBaselineSet.current && !isNewChannel
          ? entries.filter(e => !seenIdsRef.current.has(e.id))
          : []
        channelNewEntries.forEach(e => newEntries.push(e))
        entries.forEach(e => seenIdsRef.current.add(e.id))

        const hasNew = channelNewEntries.length > 0

        if (!isNewChannel) {
          const idx = byName.get(key)!
          const newZ = hasNew ? ++topZRef.current : current[idx].zIndex
          current[idx] = { ...current[idx], channelName: log.channelName, entries, lastLoaded: now, zIndex: newZ }
        } else if (current.length < MAX_CHANNELS) {
          // Auto-open new window for a channel we haven't seen before
          current.push({ ...makeChannel(current.length), channelName: log.channelName, entries, lastLoaded: now, autoRefresh: true })
          byName.set(key, current.length - 1)
        }
      }
      // Keep React topZ state in sync after any bumps
      setTopZ(topZRef.current)

      if (!alertBaselineSet.current) {
        alertBaselineSet.current = true
      } else if (newEntries.length && alertsEnabledRef.current) {
        for (const entry of newEntries) {
          if (Date.now() - entry.timestamp.getTime() > ALERT_MAX_AGE_MS) continue
          const systemsInMsg = new Set<string>()
          SYSTEM_RE.lastIndex = 0
          for (const m of entry.message.matchAll(SYSTEM_RE)) systemsInMsg.add(m[1])
          for (const word of entry.message.split(/\W+/)) {
            if (word.length >= 3 && EVE_SYSTEM_NAMES.has(word.toLowerCase())) systemsInMsg.add(word)
          }
          if (systemsInMsg.size === 0) continue

          const extraCount = (entry.message.match(/\+(\d+)/) ?? [])[1]
          const count = extraCount ? parseInt(extraCount, 10) : undefined
          const spans = buildSpans(entry.message)
          const characters = [...new Set(spans.filter(s => s.type === 'character').map(s => s.value))]
          const ships = [...new Set(spans.filter(s => s.type === 'ship').map(s => s.value))]

          if (!effectiveOriginIdRef.current) {
            const sys = [...systemsInMsg][0]
            const now = Date.now()
            if (sys && (now - (recentAlertedSys.get(sys.toLowerCase()) ?? 0)) < ALERT_COOLDOWN_MS) break
            if (sys) recentAlertedSys.set(sys.toLowerCase(), now)
            await playAlert({ urgency: 'mid', system: sys, count, characters, ships })
            break
          }

          for (const sysName of systemsInMsg) {
            const destId = resolveSystemId(sysName)
            if (!destId) continue
            const jumps  = jumpsBetween(effectiveOriginIdRef.current, destId)
            if (jumps !== null && jumps <= alertThresholdRef.current) {
              const now = Date.now()
              if ((now - (recentAlertedSys.get(sysName.toLowerCase()) ?? 0)) < ALERT_COOLDOWN_MS) break
              recentAlertedSys.set(sysName.toLowerCase(), now)
              await playAlert({ urgency: jumps <= 2 ? 'near' : 'mid', system: sysName, jumps, count, characters, ships })
              break
            }
          }
        }
      }

      debugPollCountRef.current++
      setDebugPollRef.current({ n: debugPollCountRef.current, chans: current.length, newE: newEntries.length })
      setChannels(current)
      if (isInitial) setAutoLoadStatus(null)
    } catch {
      if (isInitial) {
        setAutoLoadStatus('Could not reach server.')
        setTimeout(() => setAutoLoadStatus(null), 4000)
      }
    }
  }, []) // stable — all volatile state read from refs

  // Auto-load on mount, then poll every 5 s
  useEffect(() => {
    refreshFromServer(true)
    const id = setInterval(() => refreshFromServer(false), 5000)
    return () => clearInterval(id)
  }, [refreshFromServer])

  // Manual RELOAD: clear windows, reset baseline, re-fetch
  const autoLoadFromServer = useCallback(async () => {
    setAutoLoadStatus('Loading logs...')
    setChannels([])
    seenIdsRef.current = new Set()
    alertBaselineSet.current = false
    await refreshFromServer(true)
  }, [refreshFromServer])

  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <div className="eve-header mb-0">INTEL FEED</div>
          <div className="text-eve-dim text-[9px] tracking-widest mt-0.5">
            {channels.length} CHANNEL{channels.length !== 1 ? 'S' : ''} · EVE CHAT LOG PARSER
          </div>
        </div>
        <div className="flex items-center gap-2">
          {autoLoadStatus && (
            <span className="text-eve-dim text-[9px] font-mono">{autoLoadStatus}</span>
          )}
          <button
            onClick={autoLoadFromServer}
            className="eve-btn flex items-center gap-1.5 text-[10px] px-3 py-1.5"
            title="Reload the 3 most recent EVE chat logs"
          >
            <FolderSync size={10} />RELOAD
          </button>
          <button
            onClick={addChannel}
            disabled={channels.length >= MAX_CHANNELS}
            className="eve-btn-primary flex items-center gap-1.5 text-[10px] px-3 py-1.5 disabled:opacity-40"
          >
            <Plus size={10} />ADD WINDOW
          </button>
        </div>
      </div>

      {/* Alert settings bar */}
      <div className="eve-panel px-3 py-2 flex items-center gap-3 shrink-0 flex-wrap">
        <button
          onClick={() => setAlertsEnabled(v => !v)}
          className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 border transition-colors
            ${alertsEnabled ? 'border-eve-green/50 text-eve-green bg-eve-green/5' : 'border-eve-border text-eve-muted'}`}
        >
          {alertsEnabled ? <Bell size={10} /> : <BellOff size={10} />}
          {alertsEnabled ? 'ALERTS ON' : 'ALERTS OFF'}
        </button>

        <div className="flex items-center gap-1.5 text-[10px] text-eve-muted">
          <span>WITHIN</span>
          <select
            value={alertThreshold}
            onChange={e => setAlertThreshold(Number(e.target.value))}
            className="eve-input py-0.5 px-1 text-[10px] w-14"
          >
            {[1,2,3,4,5,7,10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>JUMPS</span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <MapPin size={10} className="text-eve-dim shrink-0" />
          {shipLocation ? (
            <span className="text-eve-cyan text-[10px] font-mono truncate">
              {shipLocation.solarSystemName}
              <span className="text-eve-dim ml-1">(from ESI)</span>
            </span>
          ) : (
            <input
              className="eve-input py-0.5 text-[10px] flex-1 min-w-0"
              placeholder="Current system (e.g. G-7WUF)..."
              value={manualSystem}
              onChange={e => setManualSystem(e.target.value)}
            />
          )}
        </div>

        {alertsEnabled && (
          <button
            onClick={() => testAlert()}
            className="eve-btn flex items-center gap-1 text-[9px] px-2 py-1 shrink-0"
            title="Click once to unlock audio, then test the alert sound"
          >
            <Bell size={9} />TEST
          </button>
        )}

        {alertsEnabled && (
          <span className={`text-[9px] shrink-0 font-mono ${effectiveOriginId ? 'text-eve-green' : 'text-eve-gold'}`}>
            {effectiveOriginId
              ? '✓ TRACKING'
              : originLabel
                ? 'RESOLVING...'
                : '⚠ NO ORIGIN — ALERTING ALL'}
          </span>
        )}
        {debugPoll && (
          <span className="text-[8px] font-mono text-eve-dim shrink-0">
            poll#{debugPoll.n} ch:{debugPoll.chans} new:{debugPoll.newE}
          </span>
        )}
        {alertFlash && (
          <motion.span
            key={Date.now()}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 2 }}
            className={`text-[9px] font-mono font-bold shrink-0 ${alertFlash === 'near' ? 'text-eve-red' : 'text-eve-gold'}`}
          >
            ▶ ALERT {alertFlash === 'near' ? 'NEAR' : 'MID'}
          </motion.span>
        )}
      </div>

      {/* Grid canvas — most recently active channel is sorted first */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {channels.length === 0 && !autoLoadStatus ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-eve-dim text-[10px]">
            <Radio size={28} className="text-eve-cyan/15" />
            No channels loaded — click RELOAD or ADD WINDOW
          </div>
        ) : (
          <div
            className="grid gap-2 p-2 items-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
          >
            <AnimatePresence>
              {[...channels].sort((a, b) => b.zIndex - a.zIndex).map(ch => (
                <ChannelWindow
                  key={ch.id}
                  channel={ch}
                  onUpdate={patch => updateChannel(ch.id, patch)}
                  onRemove={() => removeChannel(ch.id)}
                  originSystemId={effectiveOriginId}
                  alertThreshold={alertThreshold}
                  alertsEnabled={alertsEnabled}
                  onZkillLookup={onZkillLookup}
                  onFocus={() => bringToFront(ch.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

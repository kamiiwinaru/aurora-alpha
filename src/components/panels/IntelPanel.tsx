import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Radio, FolderOpen, RefreshCw, Filter, X, AlertTriangle, CheckCircle, Eye, Plus, Trash2, Bell, BellOff, MapPin, FolderSync } from 'lucide-react'
import type { EveShipLocation } from '../../types'
import { SYSTEM_RE, buildSpans, renderMessage } from '../../lib/intel-highlight'

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
}

interface FileSystemFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
  name: string
  kind: 'file' | 'directory'
}

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: object) => Promise<FileSystemFileHandle[]>
    showDirectoryPicker?: (opts?: object) => Promise<FileSystemDirectoryHandle>
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

// Shared context — must be resumed after a user gesture or it stays suspended
let _audioCtx: AudioContext | null = null
function getCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new AudioContext()
  if (_audioCtx.state === 'suspended') _audioCtx.resume()
  return _audioCtx
}

function playAlert(urgency: 'near' | 'mid') {
  try {
    const ctx  = getCtx()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    const freqs = urgency === 'near' ? [880, 1100, 880] : [660, 880]
    let t = ctx.currentTime
    for (const freq of freqs) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      gain.gain.setValueAtTime(0.25, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      osc.start(t)
      osc.stop(t + 0.18)
      t += 0.22
    }
  } catch { /* blocked */ }
}

export function testAlert() { playAlert('near') }

// ─── ESI distance ─────────────────────────────────────────────────────────────

const systemNameCache = new Map<string, number>()   // name → id
const routeCache      = new Map<string, number>()   // `${a}-${b}` → jumps

async function resolveSystemId(name: string): Promise<number | null> {
  const upper = name.toUpperCase()
  if (systemNameCache.has(upper)) return systemNameCache.get(upper)!
  try {
    const res  = await fetch('https://esi.evetech.net/latest/search/?categories=solar_system&search=' + encodeURIComponent(name) + '&strict=true')
    const data = await res.json() as { solar_system?: number[] }
    const id   = data.solar_system?.[0] ?? null
    if (id) systemNameCache.set(upper, id)
    return id
  } catch { return null }
}

async function jumpsBetween(originId: number, destId: number): Promise<number | null> {
  if (originId === destId) return 0
  const key = `${Math.min(originId, destId)}-${Math.max(originId, destId)}`
  if (routeCache.has(key)) return routeCache.get(key)!
  try {
    const res  = await fetch(`https://esi.evetech.net/latest/route/${originId}/${destId}/`)
    if (!res.ok) return null
    const route = await res.json() as number[]
    const jumps = route.length - 1
    routeCache.set(key, jumps)
    return jumps
  } catch { return null }
}


function categoryStyle(cat: IntelEntry['category']) {
  switch (cat) {
    case 'hostile': return { border: 'border-l-eve-red/70',   bg: 'bg-eve-red/5',   icon: <AlertTriangle size={9} className="text-eve-red" /> }
    case 'clear':   return { border: 'border-l-eve-green/70', bg: 'bg-eve-green/5', icon: <CheckCircle   size={9} className="text-eve-green" /> }
    case 'info':    return { border: 'border-l-eve-cyan/50',  bg: '',               icon: <Eye           size={9} className="text-eve-cyan" /> }
    default:        return { border: 'border-l-eve-border',   bg: '',               icon: null }
  }
}

function gridCols(count: number) {
  if (count === 1) return 'grid-cols-1'
  if (count === 2) return 'grid-cols-2'
  return 'grid-cols-3'
}

let nextId = 1
function makeChannel(): ChannelState {
  return {
    id: String(nextId++),
    channelName: null,
    entries: [],
    filter: '',
    categoryFilter: 'all',
    lastLoaded: null,
    autoRefresh: false,
    error: null,
  }
}

// ─── ChannelCard ──────────────────────────────────────────────────────────────

function ChannelCard({
  channel,
  onUpdate,
  onRemove,
  canRemove,
  originSystemId,
  alertThreshold,
  alertsEnabled,
  onZkillLookup,
}: {
  channel: ChannelState
  onUpdate: (patch: Partial<ChannelState>) => void
  onRemove: () => void
  canRemove: boolean
  originSystemId: number | null
  alertThreshold: number
  alertsEnabled: boolean
  onZkillLookup?: (query: string, category: 'character' | 'system') => void
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
    if (!alertsEnabledRef.current || !originSystemIdRef.current) return
    const newEntries = entries.filter(e => !knownIds.current.has(e.id))
    for (const e of entries) knownIds.current.add(e.id)

    for (const entry of newEntries) {
      if (alertedIds.current.has(entry.id)) continue
      if (entry.category !== 'hostile' && entry.category !== 'neutral') continue

      SYSTEM_RE.lastIndex = 0
      const sysMatches = [...entry.message.matchAll(SYSTEM_RE)]
      for (const m of sysMatches) {
        const destId = await resolveSystemId(m[1])
        if (!destId) continue
        const jumps = await jumpsBetween(originSystemIdRef.current, destId)
        if (jumps === null) continue
        if (jumps <= alertThresholdRef.current) {
          alertedIds.current.add(entry.id)
          playAlert(jumps <= 2 ? 'near' : 'mid')
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
    <div className="flex flex-col min-h-0 border border-eve-border bg-eve-panel overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-eve-border bg-eve-panel shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Radio size={10} className="text-eve-cyan shrink-0" />
          <span className="text-eve-cyan text-[10px] font-mono truncate">
            {channel.channelName ?? 'NO CHANNEL'}
          </span>
          {channel.channelName && (
            <span className="text-eve-dim text-[9px] shrink-0">
              · <span className="text-eve-red">{hostileCount}H</span>
              {' '}<span className="text-eve-green">{clearCount}C</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {channel.autoRefresh && (
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
              <RefreshCw size={9} className="text-eve-green" />
            </motion.div>
          )}
          {channel.channelName && fileHandleRef.current && (
            <button
              onClick={() => onUpdate({ autoRefresh: !channel.autoRefresh })}
              className={`text-[9px] px-1.5 py-0.5 border font-mono transition-colors
                ${channel.autoRefresh ? 'border-eve-green/50 text-eve-green' : 'border-eve-border text-eve-muted hover:text-eve-text'}`}
            >
              {channel.autoRefresh ? 'LIVE' : 'AUTO'}
            </button>
          )}
          <button
            onClick={openPicker}
            className="text-[9px] px-1.5 py-0.5 border border-eve-cyan/40 text-eve-cyan font-mono hover:bg-eve-cyan/10 transition-colors flex items-center gap-1"
          >
            <FolderOpen size={9} />{channel.channelName ? 'SWAP' : 'LOAD'}
          </button>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-[9px] px-1 py-0.5 border border-eve-red/30 text-eve-red/60 hover:text-eve-red hover:border-eve-red/60 transition-colors"
            >
              <Trash2 size={9} />
            </button>
          )}
        </div>
      </div>

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
              {channel.entries.length} entries · refreshed {formatAge(channel.lastLoaded)} ago
            </div>
          )}
        </>
      )}

      {/* Empty — no file */}
      {!channel.channelName && !channel.error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-4">
          <Radio size={24} className="text-eve-cyan/20" />
          <div className="text-eve-dim text-[10px]">No channel loaded</div>
          <button onClick={openPicker} className="eve-btn-primary flex items-center gap-1.5 text-[10px] px-3 py-1.5">
            <FolderOpen size={10} />LOAD LOG
          </button>
          <div className="text-eve-dim text-[9px] max-w-[160px]">
            Documents\EVE\logs\Chatlogs\
          </div>
        </div>
      )}

      {/* Empty — filter has no results */}
      {channel.channelName && visible.length === 0 && !channel.error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <div className="text-eve-dim text-[10px]">No matching entries</div>
          <button
            onClick={() => onUpdate({ filter: '', categoryFilter: 'all' })}
            className="text-[9px] text-eve-muted hover:text-eve-text underline"
          >
            clear filters
          </button>
        </div>
      )}
    </div>
  )
}

// ─── IntelPanel ───────────────────────────────────────────────────────────────

interface IntelPanelProps {
  shipLocation?: EveShipLocation | null
  onZkillLookup?: (query: string, category: 'character' | 'system') => void
}

export default function IntelPanel({ shipLocation, onZkillLookup }: IntelPanelProps) {
  const [channels, setChannels]         = useState<ChannelState[]>([makeChannel()])
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [alertThreshold, setAlertThreshold] = useState(5)
  const [manualSystem, setManualSystem] = useState('')
  const [autoLoadStatus, setAutoLoadStatus] = useState<string | null>(null)

  const originSystemId: number | null =
    shipLocation?.solarSystemId ?? null

  const originLabel = (shipLocation?.solarSystemName ?? manualSystem) || null

  const updateChannel = useCallback((id: string, patch: Partial<ChannelState>) => {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])

  const addChannel    = useCallback(() => { setChannels(prev => [...prev, makeChannel()]) }, [])
  const removeChannel = useCallback((id: string) => {
    setChannels(prev => prev.length > 1 ? prev.filter(c => c.id !== id) : prev)
  }, [])

  // Resolve manual system name to ID for alert checks
  const [manualSystemId, setManualSystemId] = useState<number | null>(null)
  useEffect(() => {
    if (shipLocation || !manualSystem.trim()) { setManualSystemId(null); return }
    resolveSystemId(manualSystem.trim()).then(id => setManualSystemId(id))
  }, [manualSystem, shipLocation])

  const effectiveOriginId = originSystemId ?? manualSystemId

  const autoLoadFromDirectory = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      setAutoLoadStatus('Directory picker not supported in this browser.')
      return
    }
    try {
      setAutoLoadStatus('Selecting folder...')
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' })

      // Collect all .txt file handles with their last-modified times
      const fileEntries: Array<{ handle: FileSystemFileHandle; lastModified: number; name: string }> = []
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const fh = entry as FileSystemFileHandle
          const file = await fh.getFile()
          if (file.name.endsWith('.txt')) {
            fileEntries.push({ handle: fh, lastModified: file.lastModified, name: file.name })
          }
        }
      }

      if (fileEntries.length === 0) {
        setAutoLoadStatus('No .txt log files found in that folder.')
        setTimeout(() => setAutoLoadStatus(null), 3000)
        return
      }

      // Sort newest first, take up to 3
      fileEntries.sort((a, b) => b.lastModified - a.lastModified)
      const top3 = fileEntries.slice(0, 3)

      setAutoLoadStatus(`Loading ${top3.length} logs...`)

      // Build fresh channel states for each file
      const newChannels: ChannelState[] = await Promise.all(
        top3.map(async ({ handle }) => {
          const ch = makeChannel()
          try {
            const file = await handle.getFile()
            const buf  = await file.arrayBuffer()
            const text = decodeEveLog(buf)
            const parsed = parseLogContent(text)
            return { ...ch, channelName: parsed.channelName, entries: parsed.entries, lastLoaded: new Date(), autoRefresh: true, fileHandle: handle }
          } catch {
            return { ...ch, error: 'Failed to read file.' }
          }
        })
      )

      setChannels(newChannels)
      setAutoLoadStatus(null)
    } catch {
      // User cancelled or permission denied
      setAutoLoadStatus(null)
    }
  }, [])

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
          {typeof window !== 'undefined' && window.showDirectoryPicker && (
            <button
              onClick={autoLoadFromDirectory}
              className="eve-btn flex items-center gap-1.5 text-[10px] px-3 py-1.5"
              title="Pick your EVE Chatlogs folder to auto-load the 3 most recent logs"
            >
              <FolderSync size={10} />AUTO-LOAD
            </button>
          )}
          <button
            onClick={addChannel}
            disabled={channels.length >= 4}
            className="eve-btn-primary flex items-center gap-1.5 text-[10px] px-3 py-1.5 disabled:opacity-40"
          >
            <Plus size={10} />ADD CHANNEL
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

        {originLabel && alertsEnabled && (
          <span className="text-eve-dim text-[9px] shrink-0">
            {manualSystemId || originSystemId ? '✓ TRACKING' : 'RESOLVING...'}
          </span>
        )}
      </div>

      {/* Grid of channel cards */}
      <div className={`flex-1 min-h-0 grid gap-2 ${gridCols(channels.length)}`}>
        {channels.map(ch => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            onUpdate={patch => updateChannel(ch.id, patch)}
            onRemove={() => removeChannel(ch.id)}
            canRemove={channels.length > 1}
            originSystemId={effectiveOriginId}
            alertThreshold={alertThreshold}
            alertsEnabled={alertsEnabled}
            onZkillLookup={onZkillLookup}
          />
        ))}
      </div>
    </div>
  )
}

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ExternalLink, RefreshCw, Skull, Shield } from 'lucide-react'
import { formatISK } from '../../lib/eve-esi'

type ZkillCategory = 'character' | 'corporation' | 'alliance' | 'system' | 'region'

const CATEGORIES: { id: ZkillCategory; label: string }[] = [
  { id: 'character',   label: 'CHARACTER'   },
  { id: 'corporation', label: 'CORPORATION' },
  { id: 'alliance',    label: 'ALLIANCE'    },
  { id: 'system',      label: 'SYSTEM'      },
  { id: 'region',      label: 'REGION'      },
]

const ESI_KEY_MAP: Record<ZkillCategory, string> = {
  character:   'characters',
  corporation: 'corporations',
  alliance:    'alliances',
  system:      'systems',
  region:      'regions',
}

const ZKILL_PATH: Record<ZkillCategory, string> = {
  character:   'character',
  corporation: 'corporation',
  alliance:    'alliance',
  system:      'system',
  region:      'region',
}

interface ZkbMeta {
  totalValue: number
  npc: boolean
  solo: boolean
  awox: boolean
  points: number
}

interface ZkillVictim {
  character_id?: number
  corporation_id?: number
  alliance_id?: number
  ship_type_id?: number
  damage_taken?: number
}

interface ZkillAttacker {
  character_id?: number
  corporation_id?: number
  alliance_id?: number
  ship_type_id?: number
  final_blow?: boolean
  damage_done?: number
}

interface ZkillEntry {
  killmail_id: number
  killmail_time: string
  solar_system_id: number
  victim: ZkillVictim
  attackers: ZkillAttacker[]
  zkb: ZkbMeta
}

interface NameEntry { id: number; name: string; category: string }

type NameMap = Record<number, string>

function secColor(sec: number) {
  if (sec >= 0.5) return 'text-eve-green'
  if (sec >= 0.1) return 'text-eve-orange'
  return 'text-eve-red'
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-GB', { month: 'short', day: '2-digit' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  }
}

function ShipThumb({ typeId, size = 40 }: { typeId?: number; size?: number }) {
  if (!typeId) return <div className="bg-eve-border" style={{ width: size, height: size }} />
  return (
    <img
      src={`https://images.evetech.net/types/${typeId}/render?size=64`}
      alt=""
      width={size}
      height={size}
      className="object-cover bg-eve-black"
      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

function Portrait({ characterId, size = 32 }: { characterId?: number; size?: number }) {
  if (!characterId) return <div className="bg-eve-border rounded-sm" style={{ width: size, height: size }} />
  return (
    <img
      src={`https://images.evetech.net/characters/${characterId}/portrait?size=64`}
      alt=""
      width={size}
      height={size}
      className="object-cover bg-eve-black rounded-sm"
      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

function KillRow({
  kill,
  names,
  systemSec,
  searchedId,
  category,
}: {
  kill: ZkillEntry
  names: NameMap
  systemSec: Record<number, number>
  searchedId: number
  category: ZkillCategory
}) {
  const { date, time } = formatTime(kill.killmail_time ?? '')
  const finalBlow = kill.attackers?.find(a => a.final_blow)
  const sec = systemSec[kill.solar_system_id]
  const isLoss =
    (category === 'character'   && kill.victim?.character_id   === searchedId) ||
    (category === 'corporation' && kill.victim?.corporation_id === searchedId) ||
    (category === 'alliance'    && kill.victim?.alliance_id    === searchedId)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => window.open(`https://zkillboard.com/kill/${kill.killmail_id}/`, '_blank')}
      className={`grid grid-cols-12 gap-2 py-2 px-2 border-b border-eve-border/30 hover:bg-eve-border/10 transition-colors items-center cursor-pointer
        ${isLoss ? 'border-l-2 border-l-eve-red/60' : 'border-l-2 border-l-eve-green/30'}`}
    >
      {/* Time */}
      <div className="col-span-1 text-center">
        <div className="text-eve-muted text-[10px]">{date}</div>
        <div className="text-eve-dim text-[10px]">{time}</div>
      </div>

      {/* Ship + value */}
      <div className="col-span-2 flex items-center gap-1.5">
        <ShipThumb typeId={kill.victim.ship_type_id} size={36} />
        <div className="min-w-0">
          <div className="text-eve-text text-[10px] truncate">{names[kill.victim.ship_type_id ?? 0] ?? '—'}</div>
          <div className="text-eve-gold text-[10px] font-mono">{formatISK(kill.zkb.totalValue)}</div>
        </div>
      </div>

      {/* Location */}
      <div className="col-span-2 min-w-0">
        <div className="flex items-center gap-1">
          {sec !== undefined && (
            <span className={`text-[10px] font-mono ${secColor(sec)}`}>
              {sec.toFixed(1)}
            </span>
          )}
          <span className="text-eve-text text-[10px] truncate">{names[kill.solar_system_id] ?? kill.solar_system_id}</span>
        </div>
        <div className="flex gap-1 mt-0.5">
          {kill.zkb.solo && <span className="text-[9px] text-eve-cyan border border-eve-cyan/30 px-1">SOLO</span>}
          {kill.zkb.npc && <span className="text-[9px] text-eve-muted border border-eve-dim px-1">NPC</span>}
          {kill.zkb.awox && <span className="text-[9px] text-eve-orange border border-eve-orange/30 px-1">AWOX</span>}
        </div>
      </div>

      {/* Victim */}
      <div className="col-span-4 flex items-center gap-1.5 min-w-0">
        <Portrait characterId={kill.victim.character_id} size={28} />
        <div className="min-w-0">
          <div className="text-eve-text text-[10px] truncate">{names[kill.victim.character_id ?? 0] ?? 'Unknown'}</div>
          <div className="text-eve-muted text-[10px] truncate">{names[kill.victim.corporation_id ?? 0] ?? ''}</div>
          {kill.victim.alliance_id && (
            <div className="text-eve-dim text-[10px] truncate">{names[kill.victim.alliance_id]}</div>
          )}
        </div>
      </div>

      {/* Final blow */}
      <div className="col-span-3 flex items-center gap-1.5 min-w-0">
        {finalBlow ? (
          <>
            <Portrait characterId={finalBlow.character_id} size={28} />
            <div className="min-w-0">
              <div className="text-eve-text text-[10px] truncate">{names[finalBlow.character_id ?? 0] ?? 'Unknown'}</div>
              <div className="text-eve-muted text-[10px] truncate">{names[finalBlow.corporation_id ?? 0] ?? ''}</div>
              <div className="text-eve-dim text-[10px]">{kill.attackers.length} attacker{kill.attackers.length !== 1 ? 's' : ''}</div>
            </div>
          </>
        ) : (
          <span className="text-eve-dim text-[10px]">—</span>
        )}
      </div>
    </motion.div>
  )
}

export interface ZkillTarget {
  query: string
  category: ZkillCategory
}

export default function ZkillPanel({ target }: { target?: ZkillTarget | null }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ZkillCategory>('character')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kills, setKills] = useState<ZkillEntry[]>([])
  const [names, setNames] = useState<NameMap>({})
  const [systemSec, setSystemSec] = useState<Record<number, number>>({})
  const [resolvedId, setResolvedId] = useState<number | null>(null)
  const [resolvedName, setResolvedName] = useState<string>('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const fetchPage = useCallback(async (entityId: number, entityCategory: ZkillCategory, pageNum: number, existingNames: NameMap, existingSecMap: Record<number, number>) => {
    const zkillRes = await fetch(`/api/zkill/${entityCategory}/${entityId}?page=${pageNum}`)
    const killData = await zkillRes.json()
    if (killData.error) throw new Error(killData.error)
    if (!Array.isArray(killData) || killData.length === 0) return { kills: [], names: existingNames, secMap: existingSecMap }

    const killList = killData as ZkillEntry[]

    // Collect all IDs to resolve
    const idSet = new Set<number>()
    for (const k of killList) {
      if (k.victim?.character_id) idSet.add(k.victim.character_id)
      if (k.victim?.corporation_id) idSet.add(k.victim.corporation_id)
      if (k.victim?.alliance_id) idSet.add(k.victim.alliance_id)
      if (k.victim?.ship_type_id) idSet.add(k.victim.ship_type_id)
      if (k.solar_system_id) idSet.add(k.solar_system_id)
      for (const a of (k.attackers ?? [])) {
        if (a.character_id) idSet.add(a.character_id)
        if (a.corporation_id) idSet.add(a.corporation_id)
        if (a.alliance_id) idSet.add(a.alliance_id)
        if (a.ship_type_id) idSet.add(a.ship_type_id)
      }
    }

    // Resolve only IDs we don't already have
    const newIds = [...idSet].filter(id => !(id in existingNames))
    const nameMap = { ...existingNames }
    if (newIds.length) {
      const resolveRes = await fetch('/api/eve/resolve-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: newIds }),
      })
      const resolved = await resolveRes.json() as NameEntry[]
      for (const entry of resolved) nameMap[entry.id] = entry.name
    }

    // Fetch security status for new systems only
    const systemIds = [...new Set(killList.map(k => k.solar_system_id))].filter(id => !(id in existingSecMap))
    const secMap = { ...existingSecMap }
    await Promise.allSettled(
      systemIds.slice(0, 15).map(async sysId => {
        const r = await fetch(`/api/eve/system/${sysId}`)
        if (r.ok) {
          const d = await r.json() as { security_status?: number }
          if (d.security_status !== undefined) secMap[sysId] = d.security_status
        }
      })
    )

    return { kills: killList, names: nameMap, secMap }
  }, [])

  const search = useCallback(async (overrideQuery?: string, overrideCategory?: ZkillCategory) => {
    const q   = (overrideQuery   ?? query).trim()
    const cat = overrideCategory ?? category
    if (!q) return
    setLoading(true)
    setError(null)
    setKills([])
    setNames({})
    setSystemSec({})
    setResolvedId(null)
    setPage(1)
    setHasMore(false)
    if (overrideQuery)   setQuery(overrideQuery)
    if (overrideCategory) setCategory(overrideCategory)

    try {
      const nameRes = await fetch('/api/eve/resolve-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [q] }),
      })
      const nameData = await nameRes.json() as Record<string, { id: number; name: string }[]>

      const matches = nameData[ESI_KEY_MAP[cat]] as { id: number; name: string }[] | undefined
      if (!matches?.length) {
        setError(`No ${cat} found matching "${q}"`)
        return
      }
      const { id, name } = matches[0]
      setResolvedId(id)
      setResolvedName(name)

      const result = await fetchPage(id, cat, 1, {}, {})
      setKills(result.kills)
      setNames(result.names)
      setSystemSec(result.secMap)
      setHasMore(result.kills.length >= 20)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, category, fetchPage])

  // Auto-search when an external target is injected (e.g. from Intel panel)
  const prevTargetRef = useRef<ZkillTarget | null>(null)
  useEffect(() => {
    if (!target?.query) return
    if (prevTargetRef.current === target) return
    prevTargetRef.current = target
    search(target.query, target.category)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!resolvedId || loading) return
    setLoading(true)
    try {
      const nextPage = page + 1
      const result = await fetchPage(resolvedId, category, nextPage, names, systemSec)
      if (result.kills.length === 0) {
        setHasMore(false)
      } else {
        setKills(prev => [...prev, ...result.kills])
        setNames(result.names)
        setSystemSec(result.secMap)
        setPage(nextPage)
        setHasMore(result.kills.length >= 20)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load more failed')
    } finally {
      setLoading(false)
    }
  }, [resolvedId, loading, page, category, names, systemSec, fetchPage])

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') search() }

  const losses = kills.filter(k =>
    (category === 'character'   && k.victim?.character_id   === resolvedId) ||
    (category === 'corporation' && k.victim?.corporation_id === resolvedId) ||
    (category === 'alliance'    && k.victim?.alliance_id    === resolvedId)
  ).length
  const killCount = kills.length - losses
  const totalDestroyed = kills.reduce((s, k) => s + (k.zkb?.totalValue || 0), 0)

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="eve-header mb-0">KILL INTELLIGENCE</div>
          <div className="text-eve-dim text-[9px] tracking-widest mt-0.5">POWERED BY ZKILLBOARD.COM</div>
        </div>
        {resolvedId && (
          <button
            onClick={() => window.open(`https://zkillboard.com/${ZKILL_PATH[category]}/${resolvedId}/`, '_blank')}
            className="eve-btn flex items-center gap-1.5 text-[10px]"
          >
            <ExternalLink size={10} />FULL BOARD
          </button>
        )}
      </div>

      {/* Search */}
      <div className="eve-panel p-3 flex flex-col gap-2 flex-shrink-0">
        <div className="grid grid-cols-5 gap-1 mb-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setCategory(cat.id); setKills([]); setError(null); setResolvedId(null) }}
              className={`py-1.5 text-[10px] uppercase tracking-wider border transition-colors font-mono
                ${category === cat.id ? 'border-eve-cyan bg-eve-cyan/10 text-eve-cyan' : 'border-eve-border text-eve-muted hover:text-eve-text'}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="eve-input flex-1 py-2 text-sm"
            placeholder={
              category === 'character'   ? 'e.g. Kami Iwinaru' :
              category === 'corporation' ? 'e.g. Brave Collective' :
              category === 'alliance'    ? 'e.g. Goonswarm Federation' :
              category === 'system'      ? 'e.g. HY-RWO, Jita' :
                                           'e.g. Delve, The Forge'
            }
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          <button
            onClick={() => search()}
            disabled={loading || !query.trim()}
            className="eve-btn-primary flex items-center gap-1.5 px-4 disabled:opacity-40"
          >
            {loading ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
            <span>{loading ? 'RESOLVING' : 'SEARCH'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-eve-red/40 bg-eve-red/5 px-3 py-2 text-eve-red text-xs">{error}</div>
      )}

      {/* Stats bar */}
      <AnimatePresence>
        {kills.length > 0 && resolvedName && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-4 gap-2">
            <div className="eve-panel p-2 col-span-2">
              <div className="text-eve-cyan text-xs truncate font-mono">{resolvedName}</div>
              <div className="text-eve-dim text-[9px]">{category.toUpperCase()} · ID {resolvedId}</div>
            </div>
            <div className="eve-panel p-2 text-center">
              <div className="text-eve-green text-sm font-mono">{killCount}</div>
              <div className="text-[9px] text-eve-muted">KILLS</div>
            </div>
            {['character', 'corporation', 'alliance'].includes(category) ? (
              <div className="eve-panel p-2 text-center">
                <div className="text-eve-red text-sm font-mono">{losses}</div>
                <div className="text-[9px] text-eve-muted">LOSSES</div>
              </div>
            ) : (
              <div className="eve-panel p-2 text-center">
                <div className="text-eve-gold text-sm font-mono">{formatISK(totalDestroyed)}</div>
                <div className="text-[9px] text-eve-muted">DESTROYED</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kill table */}
      {kills.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col border border-eve-border bg-eve-panel eve-panel">
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 px-2 py-1.5 border-b border-eve-border text-[9px] text-eve-dim uppercase tracking-widest shrink-0">
            <span className="col-span-1">TIME</span>
            <span className="col-span-2">SHIP / VALUE</span>
            <span className="col-span-2">LOCATION</span>
            <span className="col-span-4">VICTIM</span>
            <span className="col-span-3">FINAL BLOW</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {kills.map(kill => (
              <KillRow
                key={kill.killmail_id}
                kill={kill}
                names={names}
                systemSec={systemSec}
                searchedId={resolvedId ?? 0}
                category={category}
              />
            ))}
            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="eve-btn text-[10px] flex items-center gap-1.5 disabled:opacity-40"
                >
                  {loading ? <RefreshCw size={10} className="animate-spin" /> : null}
                  LOAD MORE
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <RefreshCw size={24} className="text-eve-cyan/40 animate-spin" />
          <div className="text-eve-muted text-xs tracking-widest">RESOLVING CONTACT...</div>
        </div>
      )}

      {/* Empty state — no search yet */}
      {!loading && kills.length === 0 && !error && !resolvedId && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
          <Skull size={40} className="text-eve-red/20" />
          <div className="text-eve-muted text-xs">Search for a pilot, corporation, alliance, system, or region</div>
          <div className="text-eve-dim text-[10px]">Kills shown inline · Full board opens on zKillboard</div>
        </div>
      )}

      {/* Empty state — search returned no kills */}
      {!loading && kills.length === 0 && !error && resolvedId && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
          <Shield size={32} className="text-eve-dim" />
          <div className="text-eve-muted text-xs">No kills found for {resolvedName}</div>
        </div>
      )}
    </div>
  )
}

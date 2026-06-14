import { useState, useRef, useMemo } from 'react'
import { Search, RefreshCw, Package, Bot, Send, X, ChevronDown, ChevronRight, FlaskConical, Archive } from 'lucide-react'
import type { EveAsset, EveBlueprint } from '../../types'

interface BlueprintImport {
  typeId: number
  typeName: string
  me: number
  te: number
  runs: number
}

interface AssetsPanelProps {
  assets: EveAsset[]
  blueprints?: EveBlueprint[]
  loading: boolean
  characterId?: number
  onRefresh: () => void
  onBlueprintClick?: (bp: BlueprintImport) => void
  noAIMode?: boolean
}

const QUICK_ASKS = [
  { label: 'Ships', q: 'List all ships I own with their locations' },
  { label: 'Minerals', q: 'How much of each mineral do I have total?' },
  { label: 'Blueprints', q: 'List all blueprints with ME and TE ratings' },
  { label: 'Modules', q: 'What modules do I have and where?' },
  { label: 'Ammo', q: 'What ammo and charges do I have?' },
]

// Known EVE group name patterns for client-side category filtering
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  SHIPS:    ['Frigate', 'Cruiser', 'Battleship', 'Destroyer', 'Battlecruiser', 'Carrier', 'Dreadnought', 'Titan', 'Interceptor', 'Assault Frigate', 'Heavy Assault Cruiser', 'Force Recon Ship', 'Combat Recon Ship', 'Covert Ops', 'Stealth Bomber', 'Electronic Attack Ship', 'Logistics', 'Marauder', 'Black Ops', 'Supercarrier'],
  MINERALS: ['Mineral'],
  MODULES:  ['Module', 'Armor', 'Shield', 'Weapon', 'Propulsion', 'Electronic', 'Sensor', 'Targeting', 'Launcher', 'Turret'],
  AMMO:     ['Ammo', 'Charge', 'Missile', 'Rocket', 'Bomb', 'Torpedo'],
  BPs:      ['Blueprint'],
}

function getCategoryFromAsset(a: EveAsset): string {
  const g = a.groupName ?? ''
  const n = a.typeName
  if (a.isBlueprintCopy || n.includes('Blueprint')) return 'BPs'
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'BPs') continue
    if (keywords.some(k => g.includes(k) || n.includes(k))) return cat
  }
  return 'OTHER'
}

interface LocationTree {
  [station: string]: {
    direct: EveAsset[]
    containers: Record<string, EveAsset[]>
  }
}

function AssetRow({
  item,
  showLocation,
  blueprintByItemId,
  onBlueprintClick,
}: {
  item: EveAsset
  showLocation: boolean
  blueprintByItemId: Map<number, EveBlueprint>
  onBlueprintClick?: (bp: BlueprintImport) => void
}) {
  const isBlueprint = item.isBlueprintCopy || item.typeName.includes('Blueprint')
  const bpData = blueprintByItemId.get(item.itemId)
  return (
    <div className="flex items-center justify-between py-px group">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
        <span className="text-eve-text text-[11px] truncate">{item.typeName}</span>
        {item.isBlueprintCopy && (
          <span className="text-eve-orange text-[9px] shrink-0">[BPC]</span>
        )}
        {bpData && (
          <span className="text-eve-dim text-[9px] shrink-0">
            ME{bpData.materialEfficiency} TE{bpData.timeEfficiency}
          </span>
        )}
        {showLocation && (
          <span className="text-eve-dim text-[9px] truncate shrink-0 max-w-[80px]">
            @ {item.locationName.split(' @ ').pop()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isBlueprint && onBlueprintClick && (
          <button
            onClick={() => onBlueprintClick({
              typeId: item.typeId,
              typeName: item.typeName,
              me: bpData?.materialEfficiency ?? 0,
              te: bpData?.timeEfficiency ?? 0,
              runs: bpData?.runs === -1 ? 1 : (bpData?.runs ?? 1),
            })}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-eve-cyan hover:text-eve-text"
            title="Open in Blueprint Calculator"
          >
            <FlaskConical size={10} />
          </button>
        )}
        <span className="text-eve-muted text-[11px]">×{item.quantity.toLocaleString()}</span>
      </div>
    </div>
  )
}

export default function AssetsPanel({ assets, blueprints = [], loading, characterId, onRefresh, onBlueprintClick, noAIMode }: AssetsPanelProps) {
  // Build itemId → blueprint lookup for ME/TE
  const blueprintByItemId = useMemo(() =>
    new Map(blueprints.map(b => [b.itemId, b])), [blueprints]
  )
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'type' | 'location' | 'category'>('location')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Haiku query state
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasGroups = assets.some(a => a.groupName)

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: assets.length }
    for (const a of assets) {
      const cat = getCategoryFromAsset(a)
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  }, [assets])

  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (categoryFilter !== 'ALL' && getCategoryFromAsset(a) !== categoryFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return a.typeName.toLowerCase().includes(q) || a.locationName.toLowerCase().includes(q) || (a.groupName ?? '').toLowerCase().includes(q)
    })
  }, [assets, search, categoryFilter])

  const totalItems = assets.reduce((s, a) => s + a.quantity, 0)
  const uniqueTypes = new Set(assets.map(a => a.typeId)).size
  const uniqueLocations = new Set(assets.map(a => a.locationId)).size
  const bpCount = assets.filter(a => a.isBlueprintCopy || a.typeName.includes('Blueprint')).length

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, EveAsset[]>>((acc, asset) => {
      let key: string
      if (groupBy === 'location') key = asset.locationName
      else if (groupBy === 'category') key = asset.groupName ?? getCategoryFromAsset(asset)
      else key = asset.typeName
      if (!acc[key]) acc[key] = []
      acc[key].push(asset)
      return acc
    }, {})
  }, [filtered, groupBy])

  const locationTree = useMemo<LocationTree>(() => {
    if (groupBy !== 'location') return {}
    const tree: LocationTree = {}
    for (const asset of filtered) {
      const parts = asset.locationName.split(' @ ')
      const station = parts[parts.length - 1]
      if (!tree[station]) tree[station] = { direct: [], containers: {} }
      if (parts.length === 1) {
        tree[station].direct.push(asset)
      } else {
        const containerKey = parts.slice(0, -1).join(' @ ')
        if (!tree[station].containers[containerKey]) tree[station].containers[containerKey] = []
        tree[station].containers[containerKey].push(asset)
      }
    }
    return tree
  }, [filtered, groupBy])

  const toggleCollapse = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const submitQuery = async (q?: string) => {
    const text = (q ?? query).trim()
    if (!text || querying) return
    if (!q) setQuery('')
    setQuerying(true)
    setAnswer(null)
    setQueryError(null)
    try {
      const res = await fetch('/api/assets/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, characterId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Query failed')
      setAnswer(data.answer)
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setQuerying(false)
    }
  }

  const CATEGORIES = ['ALL', 'SHIPS', 'MINERALS', 'MODULES', 'AMMO', 'BPs', 'OTHER']

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="eve-header mb-0">ASSET REGISTRY</span>
        <button onClick={onRefresh} className="eve-btn p-1" title="Refresh assets">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'ITEMS', value: totalItems.toLocaleString() },
          { label: 'TYPES', value: uniqueTypes },
          { label: 'LOCATIONS', value: uniqueLocations },
          { label: 'BPs', value: bpCount },
        ].map(stat => (
          <div key={stat.label} className="eve-panel p-2 text-center">
            <div className="text-eve-cyan text-sm font-mono">{stat.value}</div>
            <div className="eve-label text-[9px]">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Haiku query */}
      <div className="eve-panel p-3 flex flex-col gap-2">
        <div className="eve-header flex items-center gap-2 mb-0">
          <Bot size={11} /> ASK AURORA
        </div>
        {noAIMode && (
          <div className="text-eve-muted text-[10px] tracking-wide opacity-60 select-none py-1">
            AI agent unavailable — Anthropic API key required
          </div>
        )}

        {!noAIMode && (
          <>
            {/* Quick-ask chips */}
            <div className="flex flex-wrap gap-1">
              {QUICK_ASKS.map(({ label, q }) => (
                <button
                  key={label}
                  onClick={() => submitQuery(q)}
                  disabled={querying}
                  className="px-2 py-0.5 text-[9px] uppercase tracking-wider border border-eve-border text-eve-muted hover:text-eve-cyan hover:border-eve-cyan/50 transition-colors disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                ref={inputRef}
                className="eve-input flex-1 py-1.5 text-xs"
                placeholder="How much Tritanium do I have? Where are my ships?"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitQuery() }}
                disabled={querying}
              />
              <button
                onClick={() => submitQuery()}
                disabled={!query.trim() || querying}
                className="eve-btn-primary px-2 py-1 disabled:opacity-40"
              >
                <Send size={11} />
              </button>
            </div>
          </>
        )}

        {querying && (
          <div className="text-eve-muted text-[11px] animate-pulse">Querying inventory…</div>
        )}
        {queryError && (
          <div className="text-eve-red text-[11px]">{queryError}</div>
        )}
        {answer && !querying && (
          <div className="relative border border-eve-border/40 bg-eve-cyan/5 p-2 rounded-sm">
            <button
              onClick={() => setAnswer(null)}
              className="absolute top-1.5 right-1.5 text-eve-muted hover:text-eve-text"
            >
              <X size={10} />
            </button>
            <div className="text-[11px] text-eve-text leading-relaxed whitespace-pre-wrap pr-5 max-h-48 overflow-y-auto">
              {answer}
            </div>
          </div>
        )}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.filter(c => (categoryCounts[c] ?? 0) > 0 || c === 'ALL').map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2 py-0.5 text-[9px] uppercase tracking-wider border transition-colors
              ${categoryFilter === cat
                ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10'
                : 'border-eve-border text-eve-muted hover:text-eve-text hover:border-eve-border/80'}`}
          >
            {cat} {cat !== 'ALL' && categoryCounts[cat] ? <span className="opacity-60">({categoryCounts[cat]})</span> : null}
          </button>
        ))}
      </div>

      {/* Filter + groupBy */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-eve-muted" />
          <input
            className="eve-input pl-6 py-1.5 text-xs"
            placeholder="FILTER..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex border border-eve-border">
          {(['location', 'type', 'category'] as const).filter(g => g !== 'category' || hasGroups).map(g => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`px-2 py-1 text-[10px] uppercase tracking-widest transition-colors
                ${groupBy === g ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
            >
              {g === 'category' ? 'CAT' : g}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory list */}
      <div className="eve-panel p-3 flex flex-col gap-1">
        <div className="eve-header flex items-center gap-2 mb-1">
          <Package size={11} /> INVENTORY
          <span className="text-eve-muted font-normal">({filtered.length} stacks)</span>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 text-eve-muted text-xs py-8">
            {assets.length === 0 ? (
              <span>NO ASSETS LOADED — refresh EVE data</span>
            ) : (
              <>
                <span>NO MATCHES</span>
                <button
                  className="text-[10px] text-eve-cyan hover:underline"
                  onClick={() => { setSearch(''); setCategoryFilter('ALL') }}
                >
                  clear filters
                </button>
              </>
            )}
          </div>
        ) : groupBy === 'location' ? (
          // ── Location tree: station → containers → items ──────────────────
          <div className="space-y-1">
            {Object.entries(locationTree)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([station, { direct, containers }]) => {
                const stationCollapsed = !expanded[station]
                const allItems = [...direct, ...Object.values(containers).flat()]
                const totalQty = allItems.reduce((s, i) => s + i.quantity, 0)
                const containerCount = Object.keys(containers).length
                return (
                  <div key={station}>
                    {/* Station header */}
                    <button
                      onClick={() => toggleCollapse(station)}
                      className="w-full flex items-center justify-between py-1 border-b border-eve-border/40 hover:border-eve-cyan/30 group"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {stationCollapsed
                          ? <ChevronRight size={9} className="text-eve-muted shrink-0" />
                          : <ChevronDown size={9} className="text-eve-muted shrink-0" />}
                        <span className="text-[10px] text-eve-cyan uppercase tracking-wider truncate">
                          {station}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-eve-muted shrink-0 ml-2">
                        {containerCount > 0 && (
                          <span className="text-eve-gold">{containerCount} container{containerCount !== 1 ? 's' : ''}</span>
                        )}
                        <span>{allItems.length} type{allItems.length !== 1 ? 's' : ''}</span>
                        <span className="text-eve-text">×{totalQty.toLocaleString()}</span>
                      </div>
                    </button>

                    {!stationCollapsed && (
                      <div className="pl-2 pt-0.5 pb-1 space-y-0.5">
                        {/* Direct items at station */}
                        {direct.length > 0 && (
                          <div className="pl-1 space-y-px">
                            {direct
                              .sort((a, b) => b.quantity - a.quantity)
                              .map(item => <AssetRow key={item.itemId} item={item} showLocation={false} blueprintByItemId={blueprintByItemId} onBlueprintClick={onBlueprintClick} />)}
                          </div>
                        )}

                        {/* Container sub-groups */}
                        {Object.entries(containers)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([containerKey, items]) => {
                            const colKey = `${station}::${containerKey}`
                            const containerCollapsed = !expanded[colKey]
                            const cQty = items.reduce((s, i) => s + i.quantity, 0)
                            // containerKey may be "Inner @ Outer" — display outermost first
                            const parts = containerKey.split(' @ ')
                            const displayName = parts[parts.length - 1]
                            const subPath = parts.slice(0, -1).join(' @ ')
                            return (
                              <div key={containerKey} className="border-l border-eve-border/30 pl-2">
                                <button
                                  onClick={() => toggleCollapse(colKey)}
                                  className="w-full flex items-center justify-between py-0.5 hover:text-eve-cyan group"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <Archive size={8} className="text-eve-gold shrink-0" />
                                    {containerCollapsed
                                      ? <ChevronRight size={8} className="text-eve-muted shrink-0" />
                                      : <ChevronDown size={8} className="text-eve-muted shrink-0" />}
                                    <div className="min-w-0">
                                      <span className="text-[10px] text-eve-gold truncate">{displayName}</span>
                                      {subPath && (
                                        <span className="text-[9px] text-eve-dim ml-1">› {subPath}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 text-[9px] text-eve-muted shrink-0 ml-2">
                                    <span>{items.length} type{items.length !== 1 ? 's' : ''}</span>
                                    <span className="text-eve-text">×{cQty.toLocaleString()}</span>
                                  </div>
                                </button>
                                {!containerCollapsed && (
                                  <div className="pl-2 space-y-px pt-0.5 pb-1">
                                    {items
                                      .sort((a, b) => b.quantity - a.quantity)
                                      .map(item => <AssetRow key={item.itemId} item={item} showLocation={false} blueprintByItemId={blueprintByItemId} onBlueprintClick={onBlueprintClick} />)}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        ) : (
          // ── Flat grouping (type / category) ──────────────────────────────
          <div className="space-y-1">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([group, items]) => {
                const isCollapsed = !expanded[group]
                const totalQty = items.reduce((s, i) => s + i.quantity, 0)
                return (
                  <div key={group}>
                    <button
                      onClick={() => toggleCollapse(group)}
                      className="w-full flex items-center justify-between py-1 border-b border-eve-border/40 hover:border-eve-cyan/30 group"
                    >
                      <div className="flex items-center gap-1.5">
                        {isCollapsed
                          ? <ChevronRight size={9} className="text-eve-muted" />
                          : <ChevronDown size={9} className="text-eve-muted" />}
                        <span className="text-[10px] text-eve-cyan uppercase tracking-wider truncate max-w-[180px]">
                          {group}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-eve-muted">
                        <span>{items.length} type{items.length !== 1 ? 's' : ''}</span>
                        <span className="text-eve-text">×{totalQty.toLocaleString()}</span>
                      </div>
                    </button>

                    {!isCollapsed && (
                      <div className="pl-3 pt-0.5 pb-1 space-y-px">
                        {items
                          .sort((a, b) => b.quantity - a.quantity)
                          .map(item => <AssetRow key={item.itemId} item={item} showLocation={true} blueprintByItemId={blueprintByItemId} onBlueprintClick={onBlueprintClick} />)}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}
      </div>
    </div>
  )
}

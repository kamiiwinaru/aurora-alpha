import { useState, useRef, useMemo, useEffect } from 'react'
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

const QUICK_ASKS: Array<{ label: string; cat: string }> = [
  { label: 'Ships',      cat: 'SHIPS'    },
  { label: 'Minerals',   cat: 'MINERALS' },
  { label: 'Blueprints', cat: 'BPs'      },
  { label: 'Modules',    cat: 'MODULES'  },
  { label: 'Ammo',       cat: 'AMMO'     },
]

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

function buildLocationTree(items: EveAsset[]): LocationTree {
  const tree: LocationTree = {}
  for (const asset of items) {
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
    <div className="flex items-center justify-between py-px">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
        <span className="text-eve-text text-[11px] truncate">{item.typeName}</span>
        {isBlueprint && onBlueprintClick && (
          <button
            onClick={() => onBlueprintClick({
              typeId: item.typeId,
              typeName: item.typeName,
              me: bpData?.materialEfficiency ?? 0,
              te: bpData?.timeEfficiency ?? 0,
              runs: bpData?.runs === -1 ? 1 : (bpData?.runs ?? 1),
            })}
            className="text-eve-cyan hover:text-eve-text shrink-0"
            title="Open in Blueprint Calculator"
          >
            <FlaskConical size={10} />
          </button>
        )}
        {item.isBlueprintCopy && (
          <span className="text-eve-orange text-[9px] shrink-0">[BPC]</span>
        )}
        {bpData && (
          <span className="text-eve-dim text-[9px] shrink-0">
            ME{bpData.materialEfficiency} TE{bpData.timeEfficiency}
            {bpData.isCopy && bpData.runs > 0 && ` · ${bpData.runs}r`}
          </span>
        )}
        {showLocation && (
          <span className="text-eve-dim text-[9px] truncate shrink-0 max-w-[80px]">
            @ {item.locationName.split(' @ ').pop()}
          </span>
        )}
      </div>
      <span className="text-eve-muted text-[11px] shrink-0">×{item.quantity.toLocaleString()}</span>
    </div>
  )
}

function LocationTreeView({
  tree,
  blueprintByItemId,
  onBlueprintClick,
  expanded,
  toggle,
}: {
  tree: LocationTree
  blueprintByItemId: Map<number, EveBlueprint>
  onBlueprintClick?: (bp: BlueprintImport) => void
  expanded: Record<string, boolean>
  toggle: (key: string) => void
}) {
  return (
    <div className="space-y-1">
      {Object.entries(tree)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([station, { direct, containers }]) => {
          const collapsed = !expanded[station]
          const allItems = [...direct, ...Object.values(containers).flat()]
          const totalQty = allItems.reduce((s, i) => s + i.quantity, 0)
          const containerCount = Object.keys(containers).length
          return (
            <div key={station}>
              <button
                onClick={() => toggle(station)}
                className="w-full flex items-center justify-between py-1 border-b border-eve-border/40 hover:border-eve-cyan/30 group"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {collapsed
                    ? <ChevronRight size={9} className="text-eve-muted shrink-0" />
                    : <ChevronDown size={9} className="text-eve-muted shrink-0" />}
                  <span className="text-[10px] text-eve-cyan uppercase tracking-wider truncate">{station}</span>
                </div>
                <div className="flex items-center gap-2 text-[9px] text-eve-muted shrink-0 ml-2">
                  {containerCount > 0 && <span className="text-eve-gold">{containerCount} container{containerCount !== 1 ? 's' : ''}</span>}
                  <span>{allItems.length} type{allItems.length !== 1 ? 's' : ''}</span>
                  <span className="text-eve-text">×{totalQty.toLocaleString()}</span>
                </div>
              </button>
              {!collapsed && (
                <div className="pl-2 pt-0.5 pb-1 space-y-0.5">
                  {direct.length > 0 && (
                    <div className="pl-1 space-y-px">
                      {direct
                        .sort((a, b) => b.quantity - a.quantity)
                        .map(item => (
                          <AssetRow key={item.itemId} item={item} showLocation={false} blueprintByItemId={blueprintByItemId} onBlueprintClick={onBlueprintClick} />
                        ))}
                    </div>
                  )}
                  {Object.entries(containers)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([containerKey, items]) => {
                      const colKey = `${station}::${containerKey}`
                      const containerCollapsed = !expanded[colKey]
                      const cQty = items.reduce((s, i) => s + i.quantity, 0)
                      const parts = containerKey.split(' @ ')
                      const displayName = parts[parts.length - 1]
                      const subPath = parts.slice(0, -1).join(' @ ')
                      return (
                        <div key={containerKey} className="border-l border-eve-border/30 pl-2">
                          <button
                            onClick={() => toggle(colKey)}
                            className="w-full flex items-center justify-between py-0.5 hover:text-eve-cyan group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Archive size={8} className="text-eve-gold shrink-0" />
                              {containerCollapsed
                                ? <ChevronRight size={8} className="text-eve-muted shrink-0" />
                                : <ChevronDown size={8} className="text-eve-muted shrink-0" />}
                              <div className="min-w-0">
                                <span className="text-[10px] text-eve-gold truncate">{displayName}</span>
                                {subPath && <span className="text-[9px] text-eve-dim ml-1">› {subPath}</span>}
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
                                .map(item => (
                                  <AssetRow key={item.itemId} item={item} showLocation={false} blueprintByItemId={blueprintByItemId} onBlueprintClick={onBlueprintClick} />
                                ))}
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
  )
}

const CAT_PATTERNS: Array<{ re: RegExp; cat: string }> = [
  { re: /\bships?\b/i, cat: 'SHIPS' },
  { re: /\b(minerals?|tritanium|pyerite|mexallon|isogen|nocxium|zydrine|megacyte|morphite)\b/i, cat: 'MINERALS' },
  { re: /\b(blueprints?|bpos?|bpcs?)\b/i, cat: 'BPs' },
  { re: /\b(ammo|ammunition|charges?|missiles?|torpedoes?|drones?)\b/i, cat: 'AMMO' },
  { re: /\b(modules?|fittings?|rigs?|mods?)\b/i, cat: 'MODULES' },
]

export default function AssetsPanel({ assets, blueprints = [], loading, characterId, onRefresh, onBlueprintClick, noAIMode }: AssetsPanelProps) {
  const blueprintByItemId = useMemo(() =>
    new Map(blueprints.map(b => [b.itemId, b])), [blueprints]
  )

  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'type' | 'location' | 'category'>('location')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [bpOpen, setBpOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Local (zero-cost) answer — rendered as a tree
  const [answerAssets, setAnswerAssets] = useState<EveAsset[] | null>(null)
  const [answerLabel, setAnswerLabel] = useState('')
  const [answerExpanded, setAnswerExpanded] = useState<Record<string, boolean>>({})
  // API answer — rendered as text
  const [answerText, setAnswerText] = useState<string | null>(null)
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
    return buildLocationTree(filtered)
  }, [filtered, groupBy])

  const answerTree = useMemo<LocationTree>(() =>
    answerAssets ? buildLocationTree(answerAssets) : {}
  , [answerAssets])

  // Blueprint matches for current search
  const bpMatches = useMemo(() => {
    if (!search.trim() || !blueprints.length) return []
    const q = search.toLowerCase()
    return blueprints.filter(b => {
      const base = b.typeName.replace(/ Blueprint$/i, '').toLowerCase()
      return base.includes(q) || b.typeName.toLowerCase().includes(q)
    })
  }, [search, blueprints])

  useEffect(() => { if (bpMatches.length > 0) setBpOpen(true) }, [bpMatches.length > 0])

  const toggleCollapse = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const toggleAnswerCollapse = (key: string) =>
    setAnswerExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const clearAnswer = () => {
    setAnswerAssets(null)
    setAnswerLabel('')
    setAnswerText(null)
    setQueryError(null)
  }

  const handleQuickAsk = (cat: string) => {
    const matches = assets.filter(a => getCategoryFromAsset(a) === cat)
    const label = cat === 'BPs' ? `Blueprints (${matches.length})` : `${cat.charAt(0) + cat.slice(1).toLowerCase()} (${matches.length} types)`
    setAnswerAssets(matches)
    setAnswerLabel(label)
    setAnswerExpanded({})
    setAnswerText(null)
    setQueryError(null)
  }

  const submitQuery = async (q?: string) => {
    const text = (q ?? query).trim()
    if (!text || querying) return
    if (!q) setQuery('')

    // Named-item intercept — zero API cost
    const namedMatch = text.match(/^(?:how\s+(?:much|many)\s+)(.+?)\s+(?:do\s+i\s+have|have\s+i\s+got|do\s+i\s+own)\??$/i)
      || text.match(/^(?:do\s+i\s+(?:have|own))\s+(?:any\s+|a\s+|an\s+)?(.+?)\??$/i)
      || text.match(/^(?:where\s+(?:is|are)\s+my)\s+(.+?)\??$/i)
    if (namedMatch) {
      const rawName = namedMatch[1].trim().toLowerCase()
      const isCat = CAT_PATTERNS.some(p => p.re.test(rawName))
      if (!isCat) {
        const matches = assets.filter(a => a.typeName.toLowerCase().includes(rawName))
        if (matches.length > 0) {
          setAnswerAssets(matches)
          setAnswerLabel(`"${namedMatch[1].trim()}" — ${matches.length} stack${matches.length !== 1 ? 's' : ''}`)
          setAnswerExpanded({})
          setAnswerText(null)
          setQueryError(null)
          return
        }
      }
    }

    // Category intercept — zero API cost
    const isOwnership = /\b(my|i\s+have|i\s+own|do\s+i\s+have|what.*have)\b/i.test(text)
    if (isOwnership) {
      const hit = CAT_PATTERNS.find(p => p.re.test(text))
      if (hit) { handleQuickAsk(hit.cat); return }
    }

    setQuerying(true)
    setAnswerAssets(null)
    setAnswerText(null)
    setQueryError(null)
    try {
      const res = await fetch('/api/assets/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, characterId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Query failed')
      setAnswerText(data.answer)
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
            <div className="flex flex-wrap gap-1">
              {QUICK_ASKS.map(({ label, cat }) => (
                <button
                  key={label}
                  onClick={() => handleQuickAsk(cat)}
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

        {/* Local tree answer */}
        {answerAssets && !querying && (
          <div className="relative border border-eve-border/40 bg-eve-cyan/5 rounded-sm">
            <div className="flex items-center justify-between px-2 pt-2 pb-1">
              <span className="text-[10px] text-eve-cyan uppercase tracking-wider">{answerLabel}</span>
              <button onClick={clearAnswer} className="text-eve-muted hover:text-eve-text">
                <X size={10} />
              </button>
            </div>
            <div className="px-2 pb-2 max-h-64 overflow-y-auto">
              {answerAssets.length === 0
                ? <div className="text-eve-muted text-[11px] py-2">Nothing found.</div>
                : <LocationTreeView
                    tree={answerTree}
                    blueprintByItemId={blueprintByItemId}
                    onBlueprintClick={onBlueprintClick}
                    expanded={answerExpanded}
                    toggle={toggleAnswerCollapse}
                  />
              }
            </div>
          </div>
        )}

        {/* API text answer */}
        {answerText && !querying && (
          <div className="relative border border-eve-border/40 bg-eve-cyan/5 p-2 rounded-sm">
            <button
              onClick={clearAnswer}
              className="absolute top-1.5 right-1.5 text-eve-muted hover:text-eve-text"
            >
              <X size={10} />
            </button>
            <div className="text-[11px] text-eve-text leading-relaxed whitespace-pre-wrap pr-5 max-h-48 overflow-y-auto">
              {answerText}
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
            onChange={e => { setSearch(e.target.value); setBpOpen(false) }}
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

      {/* Blueprint matches for current search */}
      {bpMatches.length > 0 && (
        <div className="eve-panel p-2.5 flex flex-col gap-1.5">
          <button
            onClick={() => setBpOpen(v => !v)}
            className="flex items-center justify-between w-full group"
          >
            <div className="flex items-center gap-1.5">
              <FlaskConical size={10} className="text-eve-cyan" />
              <span className="eve-header mb-0 text-eve-cyan">OWNED BLUEPRINTS</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-eve-muted">{bpMatches.length} match{bpMatches.length !== 1 ? 'es' : ''}</span>
              {bpOpen
                ? <ChevronDown size={9} className="text-eve-muted" />
                : <ChevronRight size={9} className="text-eve-muted" />}
            </div>
          </button>
          {bpOpen && (
            <div className="space-y-px pt-0.5">
              {bpMatches.map(b => (
                <div key={b.itemId} className="flex items-center justify-between py-px">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                    <span className="text-eve-text text-[11px] truncate">{b.typeName}</span>
                    {onBlueprintClick && (
                      <button
                        onClick={() => onBlueprintClick({ typeId: b.typeId, typeName: b.typeName, me: b.materialEfficiency, te: b.timeEfficiency, runs: b.runs === -1 ? 1 : b.runs })}
                        className="text-eve-cyan hover:text-eve-text shrink-0"
                        title="Open in Blueprint Calculator"
                      >
                        <FlaskConical size={10} />
                      </button>
                    )}
                    {b.isCopy
                      ? <span className="text-eve-orange text-[9px] shrink-0">[BPC]</span>
                      : <span className="text-eve-cyan text-[9px] shrink-0">[BPO]</span>}
                    <span className="text-eve-dim text-[9px] shrink-0">
                      ME{b.materialEfficiency} TE{b.timeEfficiency}
                      {b.isCopy && b.runs > 0 && ` · ${b.runs}r`}
                    </span>
                  </div>
                  <span className="text-eve-muted text-[9px] truncate max-w-[90px] shrink-0">
                    {b.locationName.split(' @ ').pop()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          <LocationTreeView
            tree={locationTree}
            blueprintByItemId={blueprintByItemId}
            onBlueprintClick={onBlueprintClick}
            expanded={expanded}
            toggle={toggleCollapse}
          />
        ) : (
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
                          .map(item => (
                            <AssetRow key={item.itemId} item={item} showLocation={true} blueprintByItemId={blueprintByItemId} onBlueprintClick={onBlueprintClick} />
                          ))}
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

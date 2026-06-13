import React, { useState, useCallback, useMemo, useRef } from 'react'
import { Search, RefreshCw, TrendingUp, TrendingDown, Building2, ChevronDown, FileText, ChevronRight, BotMessageSquare, Send, Copy, Check, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { EveMarketOrder, EveCharacter, EveContract } from '../../types'
import { formatISK } from '../../lib/eve-esi'
import ContractDetailWindow from './ContractDetailWindow'

interface ItemEntry {
  typeId: number
  name: string
  sell: StructureOrder[]
  buy: StructureOrder[]
}
interface TreeNode {
  children: Record<string, TreeNode>
  items: ItemEntry[]
}

function CopyISKButton({ value }: { value: number }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    const text = (Math.round(value * 100) / 100 + 0.01).toFixed(2)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      el.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
      document.body.appendChild(el)
      el.focus()
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setDone(true)
    setTimeout(() => setDone(false), 1500)
  }
  return (
    <button onClick={copy} className="p-0.5 text-eve-dim hover:text-eve-cyan transition-colors" title="Copy full ISK amount">
      {done ? <Check size={9} className="text-eve-green" /> : <Copy size={9} />}
    </button>
  )
}

// ── Recursive category tree component ─────────────────────────────────────────
function TreeBranch({
  node, depth, expandedGroups, toggleGroup, selectedTypeId, onSelectType,
}: {
  node: TreeNode
  depth: number
  expandedGroups: Set<string>
  toggleGroup: (key: string) => void
  selectedTypeId: number | null
  onSelectType: (id: number) => void
}) {
  const indent = depth * 10
  return (
    <>
      {Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
        const key = `${depth}:${name}`
        const open = expandedGroups.has(key)
        const leafCount = countLeaves(child)
        return (
          <div key={key}>
            <button
              onClick={() => toggleGroup(key)}
              className="w-full flex items-center gap-1 py-0.5 hover:bg-eve-cyan/5 transition-colors border-b border-eve-border/10"
              style={{ paddingLeft: `${8 + indent}px` }}
            >
              {open
                ? <ChevronDown size={9} className="text-eve-cyan/60 shrink-0" />
                : <ChevronRight size={9} className="text-eve-muted shrink-0" />}
              <span className={`text-[10px] truncate flex-1 text-left ${depth === 0 ? 'text-eve-text font-mono' : 'text-eve-muted'}`}>
                {name}
              </span>
              <span className="text-[9px] text-eve-dim mr-1.5">{leafCount}</span>
            </button>
            {open && (
              <>
                <TreeBranch
                  node={child} depth={depth + 1}
                  expandedGroups={expandedGroups} toggleGroup={toggleGroup}
                  selectedTypeId={selectedTypeId} onSelectType={onSelectType}
                />
                {child.items.map(item => (
                  <ItemRow key={item.typeId} item={item} depth={depth + 1}
                    selected={selectedTypeId === item.typeId} onSelect={onSelectType} />
                ))}
              </>
            )}
          </div>
        )
      })}
      {depth === 0 && node.items.map(item => (
        <ItemRow key={item.typeId} item={item} depth={0}
          selected={selectedTypeId === item.typeId} onSelect={onSelectType} />
      ))}
    </>
  )
}

function ItemRow({ item, depth, selected, onSelect }: {
  item: ItemEntry; depth: number; selected: boolean; onSelect: (id: number) => void
}) {
  return (
    <button
      onClick={() => onSelect(item.typeId)}
      className={`w-full text-left py-0.5 border-b border-eve-border/10 transition-colors
        ${selected ? 'bg-eve-cyan/15 text-eve-cyan' : 'text-eve-muted hover:text-eve-text hover:bg-white/[0.03]'}`}
      style={{ paddingLeft: `${18 + depth * 10}px`, paddingRight: '6px' }}
    >
      <span className="block truncate text-[10px]">{item.name}</span>
      <span className="text-[9px] opacity-60">
        {item.sell.length > 0 && <span className="text-eve-green">{item.sell.length}S </span>}
        {item.buy.length > 0 && <span className="text-eve-orange">{item.buy.length}B</span>}
      </span>
    </button>
  )
}

function countLeaves(node: TreeNode): number {
  return node.items.length + Object.values(node.children).reduce((s, c) => s + countLeaves(c), 0)
}

interface StructureOrder {
  order_id: number
  type_id: number
  price: number
  volume_remain: number
  volume_total: number
  min_volume?: number
  is_buy_order: boolean
  duration: number
  issued: string
  location_id: number
  range?: string
}

interface Structure {
  id: number
  name: string
  type?: 'structure' | 'station'
  regionId?: number
}

interface MarketPanelProps {
  orders: EveMarketOrder[]
  loading: boolean
  onRefresh: () => void
  character?: EveCharacter | null
  characters?: EveCharacter[]
  contracts?: EveContract[]
  corporationContracts?: EveContract[]
}

type Tab = 'personal' | 'structure' | 'contracts' | 'trade'

interface TradeDeal {
  typeId: number; name: string
  bestBuy: number; bestSell: number
  spread: number; netSpread: number; profitPerUnit: number
  dailyVol: number | null; sellVol: number; buyVol: number
}

type TradeMode = 'relist' | 'mislisted' | 'highvol'

const TRADE_HUBS = [
  { name: 'Jita',    regionId: 10000002, stationId: 60003760 },
  { name: 'Amarr',   regionId: 10000043, stationId: 60008494 },
  { name: 'Rens',    regionId: 10000030, stationId: 60004588 },
  { name: 'Dodixie', regionId: 10000032, stationId: 60011866 },
  { name: 'Hek',     regionId: 10000042, stationId: 60005686 },
] as const
type ContractSubTab = 'personal' | 'completed' | 'browser'

const PINNED_STRUCTURES: Structure[] = [
  // NPC market hubs — public regional API, no auth required
  { id: 60003760, name: 'Jita IV-4 - Caldari Navy Assembly Plant',    type: 'station', regionId: 10000002 },
  { id: 60008494, name: 'Amarr VIII - Emperor Family Academy',        type: 'station', regionId: 10000043 },
  { id: 60011866, name: 'Dodixie IX-20 - Federation Navy Assembly',   type: 'station', regionId: 10000032 },
  { id: 60004588, name: 'Rens VI-8 - Brutor Tribe Treasury',          type: 'station', regionId: 10000030 },
  { id: 60005686, name: 'Hek VIII-12 - Boundless Creation Factory',   type: 'station', regionId: 10000042 },
  // Player structures — requires EVE auth token
  { id: 1049633275448, name: 'HY-RWO - Sigma Grindset Citadel' },
  { id: 1046664001931, name: 'UALX-3 - Mothership Bellicose' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────
const CONTRACT_TYPE_ABBR: Record<string, string> = {
  item_exchange: 'EXCH',
  courier: 'COUR',
  auction: 'AUCT',
  loan: 'LOAN',
  unknown: '????',
}

const CONTRACT_STATUS_COLOR: Record<string, string> = {
  outstanding:          'text-eve-cyan',
  in_progress:          'text-eve-gold',
  finished:             'text-eve-green',
  finished_issuer:      'text-eve-green',
  finished_contractor:  'text-eve-green',
  cancelled:            'text-eve-muted',
  rejected:             'text-eve-red',
  failed:               'text-eve-red',
  deleted:              'text-eve-muted',
  reversed:             'text-eve-red',
}

function contractDaysLeft(dateExpired: string) {
  return Math.ceil((new Date(dateExpired).getTime() - Date.now()) / 86_400_000)
}

export default function MarketPanel({ orders, loading, onRefresh, character, characters = [], contracts = [], corporationContracts = [] }: MarketPanelProps) {
  const [tab, setTab] = useState<Tab>('personal')
  const [contractSubTab, setContractSubTab] = useState<ContractSubTab>('personal')
  const [openContract, setOpenContract] = useState<EveContract | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all')

  // Structure market state
  const [structures, setStructures] = useState<Structure[]>(PINNED_STRUCTURES)
  const [selectedStructure, setSelectedStructure] = useState<Structure | null>(null)
  const [structureOrders, setStructureOrders] = useState<StructureOrder[]>([])
  const [structureLoading, setStructureLoading] = useState(false)
  const [structuresLoading, setStructuresLoading] = useState(false)
  const [typeNames, setTypeNames] = useState<Record<number, string>>({})
  const [typeGroups, setTypeGroups] = useState<Record<number, string[]>>({})
  const [structureError, setStructureError] = useState<string | null>(null)
  const [showStructurePicker, setShowStructurePicker] = useState(false)

  // ── Contract derived state ─────────────────────────────────────────────────
  const byNewest = (a: EveContract, b: EveContract) =>
    new Date(b.dateIssued).getTime() - new Date(a.dateIssued).getTime()

  // Outstanding contracts directly to/from me (not assigned to alliance)
  const myDirectContracts = useMemo(() =>
    contracts.filter(c =>
      c.status === 'outstanding' &&
      (c.issuerId === character?.characterId || c.assigneeId === character?.characterId) &&
      c.assigneeId !== character?.allianceId
    ).sort(byNewest),
    [contracts, character])

  // Outstanding contracts between me and the alliance
  const myAllianceContracts = useMemo(() =>
    contracts.filter(c =>
      c.status === 'outstanding' &&
      (c.issuerId === character?.characterId || c.assigneeId === character?.characterId) &&
      (c.assigneeId === character?.allianceId || c.issuerId === character?.allianceId)
    ).sort(byNewest),
    [contracts, character])

  // Finished contracts involving me (issued by or assigned to me)
  const completedContracts = useMemo(() =>
    contracts.filter(c =>
      ['finished', 'finished_issuer', 'finished_contractor'].includes(c.status) &&
      (c.issuerId === character?.characterId || c.assigneeId === character?.characterId)
    ).sort(byNewest),
    [contracts, character])

  const [contractSearch, setContractSearch] = useState('')
  const [contractStatusFilter, setContractStatusFilter] = useState<'all' | 'outstanding' | 'in_progress' | 'finished'>('all')

  // ── Trade Agent state ──────────────────────────────────────────────────────
  const [tradeHub, setTradeHub] = useState<typeof TRADE_HUBS[number]>(TRADE_HUBS[0])
  const [tradeMode, setTradeMode] = useState<TradeMode>('relist')
  type TradeResults = Record<TradeMode, TradeDeal[]>
  const [tradeResults, setTradeResults] = useState<TradeResults | null>(null)
  const [tradeLoading, setTradeLoading] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [tradeScanned, setTradeScanned] = useState(false)
  const [tradeTotal, setTradeTotal] = useState(0)
  const [selectedDeal, setSelectedDeal] = useState<TradeDeal | null>(null)
  const tradeBottomRef = useRef<HTMLDivElement>(null)
  const [copyDone, setCopyDone] = useState(false)

  const tradeDeals = tradeResults?.[tradeMode] ?? []

  // Scan options (sliders)
  const [minSpread, setMinSpread] = useState(10)
  const [minDailyVol, setMinDailyVol] = useState(5)
  const [resultLimit, setResultLimit] = useState(25)

  // Table sort
  type SortCol = 'name' | 'bestBuy' | 'bestSell' | 'spread' | 'netSpread' | 'profitPerUnit' | 'dailyVol'
  const [sortCol, setSortCol] = useState<SortCol>('spread')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleSortCol = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sortedDeals = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...tradeDeals].sort((a, b) => {
      if (sortCol === 'name') return dir * a.name.localeCompare(b.name)
      const av = (a[sortCol] as number | null) ?? -Infinity
      const bv = (b[sortCol] as number | null) ?? -Infinity
      return dir * (av - bv)
    })
  }, [tradeDeals, sortCol, sortDir])

  const runTradeScan = useCallback(async (hub = tradeHub) => {
    setTradeLoading(true)
    setTradeError(null)
    setTradeResults(null)
    setSelectedDeal(null)
    setTradeScanned(false)
    try {
      const r = await fetch('/api/trade/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regionId: hub.regionId, stationId: hub.stationId, hubName: hub.name,
          minSpread, limit: resultLimit, minDailyVol,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Scan failed')
      setTradeResults({ relist: data.relist, mislisted: data.mislisted, highvol: data.highvol })
      setTradeTotal(data.total)
      setTradeScanned(true)
    } catch (err) {
      setTradeError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setTradeLoading(false)
    }
  }, [tradeHub, minSpread, minDailyVol, resultLimit])

  const filterBySearch = useCallback((list: EveContract[]) =>
    list.filter(c => !contractSearch ||
      c.title.toLowerCase().includes(contractSearch.toLowerCase()) ||
      c.issuerName.toLowerCase().includes(contractSearch.toLowerCase()) ||
      c.assigneeName.toLowerCase().includes(contractSearch.toLowerCase()) ||
      c.type.toLowerCase().includes(contractSearch.toLowerCase())
    ), [contractSearch])

  const displayedCompleted = useMemo(() => filterBySearch(completedContracts), [filterBySearch, completedContracts])
  const displayedBrowser = useMemo(() =>
    filterBySearch(corporationContracts),
    [filterBySearch, corporationContracts])

  // ── Market derived state ───────────────────────────────────────────────────
  // ESI /characters/{id}/orders/ only returns open orders — no state filter needed
  const active = orders
  const buyOrders = active.filter(o => o.isBuyOrder)
  const sellOrders = active.filter(o => !o.isBuyOrder)

  // Map typeId → active buy order volume remaining (for trade agent cross-reference)
  const myBuyOrderMap = useMemo(() =>
    buyOrders.reduce<Record<number, number>>((acc, o) => {
      acc[o.typeId] = (acc[o.typeId] ?? 0) + o.volumeRemain
      return acc
    }, {}),
  [buyOrders])
  const totalBuyValue = buyOrders.reduce((s, o) => s + o.price * o.volumeRemain, 0)
  const totalSellValue = sellOrders.reduce((s, o) => s + o.price * o.volumeRemain, 0)

  const filtered = active.filter(o => {
    const matchSearch = o.typeName.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || (filter === 'buy' ? o.isBuyOrder : !o.isBuyOrder)
    return matchSearch && matchFilter
  })

  const loadStructures = useCallback(async () => {
    if (!character) return
    setStructuresLoading(true)
    setStructureError(null)
    try {
      const res = await fetch(
        `/api/assets/structures?characterId=${character.characterId}&accessToken=${encodeURIComponent(character.accessToken)}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load structures')
      if (!data.length) {
        setStructureError('No additional structures found in your assets.')
      } else {
        const merged = [...PINNED_STRUCTURES]
        for (const s of data) {
          if (!merged.some(p => p.id === s.id)) merged.push(s)
        }
        setStructures(merged)
      }
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStructuresLoading(false)
    }
  }, [character])

  const loadStructureOrders = useCallback(async (structure: Structure) => {
    if (!character) return
    setStructureLoading(true)
    setStructureError(null)
    setStructureOrders([])
    setTypeGroups({})
    try {
      let page = 1
      const allOrders: StructureOrder[] = []
      const isStation = structure.type === 'station'

      while (true) {
        let res: Response | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          const url = isStation
            ? `https://esi.evetech.net/latest/markets/${structure.regionId}/orders/?datasource=tranquility&location_id=${structure.id}&order_type=all&page=${page}`
            : `https://esi.evetech.net/latest/markets/structures/${structure.id}/?page=${page}`
          res = await fetch(url, isStation ? {} : { headers: { Authorization: `Bearer ${character.accessToken}` } })
          if (res.status !== 504) break
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        }
        if (!res!.ok) throw new Error(`ESI error ${res!.status} — ${res!.status === 504 ? 'gateway timeout, try again shortly' : 'check auth'}`)
        const batch: StructureOrder[] = await res!.json()
        allOrders.push(...batch)
        if (batch.length < 1000) break
        page++
      }
      setStructureOrders(allOrders)

      // Resolve type names for all unique type IDs
      const typeIds = [...new Set(allOrders.map(o => o.type_id))]
      const chunks: number[][] = []
      for (let i = 0; i < typeIds.length; i += 1000) chunks.push(typeIds.slice(i, i + 1000))
      const nameMap: Record<number, string> = {}
      await Promise.all(chunks.map(async chunk => {
        const r = await fetch('/api/eve/resolve-ids', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunk }),
        })
        if (r.ok) {
          const names: { id: number; name: string }[] = await r.json()
          for (const n of names) nameMap[n.id] = n.name
        }
      }))
      setTypeNames(nameMap)

      // Fetch market group category paths (server-cached after first load)
      const groupRes = await fetch('/api/market/type-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typeIds }),
      })
      if (groupRes.ok) setTypeGroups(await groupRes.json())
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStructureLoading(false)
    }
  }, [character])

  const handleSelectStructure = (s: Structure) => {
    setSelectedStructure(s)
    setShowStructurePicker(false)
    setSelectedTypeId(null)
    loadStructureOrders(s)
  }

  // ── Structure market item browser state ───────────────────────────────────
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [structureSearch, setStructureSearch] = useState('')

  const toggleGroup = (key: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  // Build nested category tree from market group paths
  const makeNode = (): TreeNode => ({ children: {}, items: [] })

  const categoryTree = useMemo((): TreeNode => {
    const root = makeNode()
    const itemMap = new Map<number, ItemEntry>()
    for (const o of structureOrders) {
      if (!itemMap.has(o.type_id)) {
        itemMap.set(o.type_id, { typeId: o.type_id, name: typeNames[o.type_id] ?? `Type ${o.type_id}`, sell: [], buy: [] })
      }
      const e = itemMap.get(o.type_id)!
      o.is_buy_order ? e.buy.push(o) : e.sell.push(o)
    }
    const q = structureSearch.toLowerCase()
    for (const [typeId, entry] of itemMap) {
      if (q && !entry.name.toLowerCase().includes(q)) continue
      const path = typeGroups[typeId] ?? ['Other']
      let node = root
      for (const seg of path) {
        if (!node.children[seg]) node.children[seg] = makeNode()
        node = node.children[seg]
      }
      node.items.push(entry)
    }
    // Sort items within each leaf
    const sortTree = (n: TreeNode) => {
      n.items.sort((a, b) => a.name.localeCompare(b.name))
      for (const child of Object.values(n.children)) sortTree(child)
    }
    sortTree(root)
    return root
  }, [structureOrders, typeNames, typeGroups, structureSearch])

  const selectedItem = selectedTypeId != null
    ? { typeId: selectedTypeId, name: typeNames[selectedTypeId] ?? `Type ${selectedTypeId}`,
        sell: structureOrders.filter(o => o.type_id === selectedTypeId && !o.is_buy_order).sort((a, b) => a.price - b.price),
        buy: structureOrders.filter(o => o.type_id === selectedTypeId && o.is_buy_order).sort((a, b) => b.price - a.price) }
    : null

  const allItems = useMemo(() => {
    const collect = (n: TreeNode): ItemEntry[] =>
      [...n.items, ...Object.values(n.children).flatMap(collect)]
    return collect(categoryTree)
  }, [categoryTree])
  const totalSellItems = allItems.filter(i => i.sell.length > 0).length
  const totalBuyItems  = allItems.filter(i => i.buy.length > 0).length

  return (
    <div className="flex flex-col gap-3">
      {/* Header + tab switcher */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('personal')}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors border
              ${tab === 'personal' ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10' : 'border-eve-border text-eve-muted hover:text-eve-text'}`}
          >MY ORDERS</button>
          <button
            onClick={() => setTab('structure')}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors border
              ${tab === 'structure' ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10' : 'border-eve-border text-eve-muted hover:text-eve-text'}`}
          >STRUCTURE</button>
          <button
            onClick={() => setTab('contracts')}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors border flex items-center gap-1
              ${tab === 'contracts' ? 'border-eve-gold text-eve-gold bg-eve-gold/10' : 'border-eve-border text-eve-muted hover:text-eve-text'}`}
          >
            <FileText size={9} />
            CONTRACTS
            {contracts.length > 0 && (
              <span className={`text-[9px] font-mono ${tab === 'contracts' ? 'text-eve-gold/70' : 'text-eve-dim'}`}>
                {contracts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('trade')}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors border flex items-center gap-1
              ${tab === 'trade' ? 'border-eve-green text-eve-green bg-eve-green/10' : 'border-eve-border text-eve-muted hover:text-eve-text'}`}
          >
            <BotMessageSquare size={9} />
            TRADE AGENT
          </button>
        </div>
        <button
          onClick={tab === 'personal' || !selectedStructure ? onRefresh : () => loadStructureOrders(selectedStructure!)}
          className="eve-btn p-1"
        >
          <RefreshCw size={11} className={(loading || structureLoading) ? 'animate-spin' : ''} />
        </button>
      </div>

      {tab === 'personal' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="eve-panel p-2">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp size={10} className="text-eve-green" />
                <span className="eve-label text-[9px]">SELL ORDERS</span>
              </div>
              <div className="text-eve-green text-sm font-mono">{sellOrders.length}</div>
              <div className="text-eve-muted text-[10px]">{formatISK(totalSellValue)} ISK</div>
            </div>
            <div className="eve-panel p-2">
              <div className="flex items-center gap-1 mb-1">
                <TrendingDown size={10} className="text-eve-orange" />
                <span className="eve-label text-[9px]">BUY ORDERS</span>
              </div>
              <div className="text-eve-orange text-sm font-mono">{buyOrders.length}</div>
              <div className="text-eve-muted text-[10px]">{formatISK(totalBuyValue)} ISK</div>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-eve-muted" />
              <input
                className="eve-input pl-6 py-1.5 text-xs"
                placeholder="FILTER ORDERS..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex border border-eve-border">
              {(['all', 'sell', 'buy'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-1 text-[10px] uppercase tracking-widest transition-colors
                    ${filter === f ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="eve-panel p-3 flex flex-col">
            <div className="eve-header">ACTIVE ORDERS ({filtered.length})</div>
            {filtered.length > 0 && (
              <div className="grid grid-cols-12 gap-1 text-[9px] text-eve-dim uppercase tracking-widest pb-1 border-b border-eve-border/50 mb-1">
                <span className="col-span-4">ITEM</span>
                <span className="col-span-2 text-right">PRICE</span>
                <span className="col-span-2 text-right">VOL</span>
                <span className="col-span-2 text-right">REMAIN</span>
                <span className="col-span-2 text-right">TYPE</span>
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center text-eve-muted text-xs py-6">
                {orders.length === 0 ? 'NO ORDERS LOADED' : 'NO MATCHES'}
              </div>
            ) : (
              <div>
                {filtered
                  .sort((a, b) => b.price * b.volumeRemain - a.price * a.volumeRemain)
                  .map(order => {
                    const fillPct = ((order.volumeTotal - order.volumeRemain) / order.volumeTotal) * 100
                    return (
                      <div
                        key={order.orderId}
                        className="grid grid-cols-12 gap-1 py-1.5 border-b border-eve-border/20 hover:bg-eve-border/10 transition-colors"
                      >
                        <span className="col-span-4 text-eve-text text-xs truncate">{order.typeName}</span>
                        <span className="col-span-2 text-right text-xs font-mono text-eve-text">
                          {formatISK(order.price)}
                        </span>
                        <span className="col-span-2 text-right text-xs text-eve-muted">
                          {order.volumeTotal.toLocaleString()}
                        </span>
                        <div className="col-span-2 flex items-center justify-end">
                          <div className="relative w-full h-1 bg-eve-border">
                            <motion.div
                              className={`absolute left-0 top-0 h-full ${order.isBuyOrder ? 'bg-eve-orange' : 'bg-eve-green'}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${100 - fillPct}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                        </div>
                        <span className={`col-span-2 text-right text-[10px] font-mono uppercase
                          ${order.isBuyOrder ? 'text-eve-orange' : 'text-eve-green'}`}
                        >
                          {order.isBuyOrder ? 'BUY' : 'SELL'}
                        </span>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'structure' && (
        <>
          {/* Structure selector bar */}
          <div className="eve-panel p-2 flex items-center gap-2 overflow-visible relative z-30">
            <Building2 size={10} className="text-eve-cyan shrink-0" />
            <div className="relative flex-1">
              <button
                onClick={() => setShowStructurePicker(p => !p)}
                className="eve-input w-full flex items-center justify-between px-2 py-1 text-xs"
              >
                <span className="truncate text-left">
                  {selectedStructure ? selectedStructure.name : 'SELECT STRUCTURE...'}
                </span>
                <ChevronDown size={10} className="text-eve-muted shrink-0 ml-1" />
              </button>
              {showStructurePicker && (
                <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-eve-deep border border-eve-border max-h-56 overflow-y-auto">
                  <div className="px-2 py-0.5 text-[9px] text-eve-dim uppercase tracking-widest bg-eve-border/10">NPC HUBS</div>
                  {structures.filter(s => s.type === 'station').map(s => (
                    <button key={s.id} onClick={() => handleSelectStructure(s)}
                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-eve-cyan/10 hover:text-eve-cyan transition-colors truncate">
                      {s.name}
                    </button>
                  ))}
                  <div className="px-2 py-0.5 text-[9px] text-eve-dim uppercase tracking-widest bg-eve-border/10 border-t border-eve-border/30">PLAYER STRUCTURES</div>
                  {structures.filter(s => s.type !== 'station').map(s => (
                    <button key={s.id} onClick={() => handleSelectStructure(s)}
                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-eve-cyan/10 hover:text-eve-cyan transition-colors truncate">
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={loadStructures}
              disabled={structuresLoading || !character}
              className="eve-btn px-2 py-1 text-[10px] shrink-0"
            >
              {structuresLoading ? 'SCANNING...' : 'SCAN ASSETS'}
            </button>
          </div>

          {structureError && (
            <div className="text-eve-red text-[10px] px-1">{structureError}</div>
          )}

          {structureLoading && (
            <div className="flex items-center justify-center text-eve-muted text-xs py-8">
              <RefreshCw size={12} className="animate-spin mr-2" /> LOADING MARKET DATA...
            </div>
          )}

          {!structureLoading && selectedStructure && structureOrders.length > 0 && (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="eve-panel p-2">
                  <div className="flex items-center gap-1 mb-0.5">
                    <TrendingUp size={9} className="text-eve-green" />
                    <span className="eve-label text-[9px]">SELL ITEMS</span>
                  </div>
                  <div className="text-eve-green text-sm font-mono">{totalSellItems}</div>
                </div>
                <div className="eve-panel p-2">
                  <div className="flex items-center gap-1 mb-0.5">
                    <TrendingDown size={9} className="text-eve-orange" />
                    <span className="eve-label text-[9px]">BUY ITEMS</span>
                  </div>
                  <div className="text-eve-orange text-sm font-mono">{totalBuyItems}</div>
                </div>
                <div className="eve-panel p-2">
                  <div className="eve-label text-[9px] mb-0.5">UNIQUE</div>
                  <div className="text-eve-cyan text-sm font-mono">
                    {allItems.length}
                  </div>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-eve-muted" />
                <input
                  className="eve-input pl-6 py-1.5 text-xs w-full"
                  placeholder="FILTER ITEMS..."
                  value={structureSearch}
                  onChange={e => setStructureSearch(e.target.value)}
                />
              </div>

              {/* Two-column browser */}
              <div className="flex gap-2 min-h-0" style={{ height: '480px' }}>

                {/* Left: category tree */}
                <div className="w-52 shrink-0 eve-panel flex flex-col overflow-hidden">
                  <div className="eve-header px-2 pt-2 pb-1 shrink-0">BROWSE</div>
                  <div className="overflow-y-auto flex-1">
                    <TreeBranch
                      node={categoryTree}
                      depth={0}
                      expandedGroups={expandedGroups}
                      toggleGroup={toggleGroup}
                      selectedTypeId={selectedTypeId}
                      onSelectType={setSelectedTypeId}
                    />
                  </div>
                </div>

                {/* Right: item detail */}
                <div className="flex-1 eve-panel flex flex-col overflow-hidden">
                  {!selectedItem ? (
                    <div className="flex-1 flex items-center justify-center text-eve-muted text-xs text-center px-4">
                      SELECT AN ITEM<br />TO VIEW ORDERS
                    </div>
                  ) : (
                    <>
                      <div className="px-3 pt-2 pb-1.5 border-b border-eve-border/40 shrink-0">
                        <div className="text-eve-cyan text-xs font-mono tracking-wide">{selectedItem.name}</div>
                        <div className="flex gap-3 mt-0.5 text-[9px] text-eve-dim">
                          {selectedItem.sell.length > 0 && (
                            <span className="text-eve-green">
                              SELL FROM {formatISK(selectedItem.sell[0].price)}
                            </span>
                          )}
                          {selectedItem.buy.length > 0 && (
                            <span className="text-eve-orange">
                              BUY UP TO {formatISK(selectedItem.buy[0].price)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1 px-2 py-1">
                        {selectedItem.sell.length > 0 && (
                          <>
                            <div className="text-[9px] text-eve-green uppercase tracking-widest py-1 font-mono">
                              SELL ORDERS ({selectedItem.sell.length})
                            </div>
                            <div className="grid grid-cols-3 text-[9px] text-eve-dim uppercase tracking-widest pb-0.5 border-b border-eve-border/30 mb-0.5">
                              <span>PRICE</span><span className="text-right">QTY</span><span className="text-right">MIN VOL</span>
                            </div>
                            {selectedItem.sell.map(o => (
                              <div key={o.order_id} className="grid grid-cols-3 py-1 border-b border-eve-border/10 hover:bg-white/[0.02]">
                                <span className="text-xs font-mono text-eve-green">{formatISK(o.price)}</span>
                                <span className="text-right text-xs text-eve-muted">{o.volume_remain.toLocaleString()}</span>
                                <span className="text-right text-[10px] text-eve-dim">{o.min_volume?.toLocaleString() ?? 1}</span>
                              </div>
                            ))}
                          </>
                        )}
                        {selectedItem.buy.length > 0 && (
                          <>
                            <div className="text-[9px] text-eve-orange uppercase tracking-widest py-1 font-mono mt-2">
                              BUY ORDERS ({selectedItem.buy.length})
                            </div>
                            <div className="grid grid-cols-3 text-[9px] text-eve-dim uppercase tracking-widest pb-0.5 border-b border-eve-border/30 mb-0.5">
                              <span>PRICE</span><span className="text-right">QTY</span><span className="text-right">RANGE</span>
                            </div>
                            {selectedItem.buy.map(o => (
                              <div key={o.order_id} className="grid grid-cols-3 py-1 border-b border-eve-border/10 hover:bg-white/[0.02]">
                                <span className="text-xs font-mono text-eve-orange">{formatISK(o.price)}</span>
                                <span className="text-right text-xs text-eve-muted">{o.volume_remain.toLocaleString()}</span>
                                <span className="text-right text-[10px] text-eve-dim">{o.range ?? '—'}</span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {!structureLoading && !selectedStructure && (
            <div className="flex items-center justify-center text-eve-muted text-xs text-center px-4 py-8">
              SELECT A STRUCTURE ABOVE TO BROWSE ITS MARKET
            </div>
          )}
        </>
      )}

      {tab === 'contracts' && (
        <>
          <AnimatePresence>
            {openContract && character && (
              <ContractDetailWindow
                contract={openContract}
                character={character}
                onClose={() => setOpenContract(null)}
              />
            )}
          </AnimatePresence>

          {/* Sub-tab row */}
          <div className="flex items-center gap-2">
            <div className="flex border border-eve-border/40 overflow-hidden text-[10px] font-mono">
              <button
                onClick={() => setContractSubTab('personal')}
                className={`px-2 py-0.5 transition-colors ${contractSubTab === 'personal' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
              >
                PERSONAL
                {(myDirectContracts.length + myAllianceContracts.length) > 0 && (
                  <span className="ml-1 opacity-60">{myDirectContracts.length + myAllianceContracts.length}</span>
                )}
              </button>
              <button
                onClick={() => setContractSubTab('completed')}
                className={`px-2 py-0.5 border-l border-eve-border/40 transition-colors ${contractSubTab === 'completed' ? 'bg-eve-green/10 text-eve-green' : 'text-eve-muted hover:text-eve-text'}`}
              >
                COMPLETED
                {completedContracts.length > 0 && (
                  <span className="ml-1 opacity-60">{completedContracts.length}</span>
                )}
              </button>
              <button
                onClick={() => setContractSubTab('browser')}
                className={`px-2 py-0.5 border-l border-eve-border/40 transition-colors ${contractSubTab === 'browser' ? 'bg-eve-gold/10 text-eve-gold' : 'text-eve-muted hover:text-eve-text'}`}
              >
                ALLIANCE BROWSER
                {corporationContracts.length > 0 && (
                  <span className="ml-1 opacity-60">{corporationContracts.length}</span>
                )}
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-eve-muted" />
            <input
              className="eve-input pl-6 py-1.5 text-xs w-full"
              placeholder="FILTER CONTRACTS..."
              value={contractSearch}
              onChange={e => setContractSearch(e.target.value)}
            />
          </div>

          {/* ── PERSONAL tab: two inline sections ─────────────────────────── */}
          {contractSubTab === 'personal' && (() => {
            const directFiltered = filterBySearch(myDirectContracts)
            const allianceFiltered = filterBySearch(myAllianceContracts)
            const colHeader = (
              <div className="grid grid-cols-12 gap-1 text-[9px] text-eve-dim uppercase tracking-widest pb-1 border-b border-eve-border/50 mb-1">
                <span className="col-span-1">TYPE</span>
                <span className="col-span-3">TITLE</span>
                <span className="col-span-2">ISSUER</span>
                <span className="col-span-2">ASSIGNEE</span>
                <span className="col-span-2 text-right">PRICE</span>
                <span className="col-span-1 text-right">EXP</span>
                <span className="col-span-1 text-right">STATUS</span>
              </div>
            )
            const renderRow = (c: EveContract) => {
              const daysLeft = contractDaysLeft(c.dateExpired)
              const expired = daysLeft < 0
              const expirySoon = !expired && daysLeft <= 2
              const statusColor = CONTRACT_STATUS_COLOR[c.status] ?? 'text-eve-muted'
              const typeAbbr = CONTRACT_TYPE_ABBR[c.type] ?? c.type.toUpperCase().slice(0, 4)
              const inbound = c.issuerId !== character?.characterId
              return (
                <button
                  key={c.contractId}
                  onClick={() => setOpenContract(c)}
                  className={`w-full text-left grid grid-cols-12 gap-1 py-1.5 border-b border-eve-border/20 hover:bg-white/[0.03] cursor-pointer transition-colors ${inbound ? 'border-l-2 border-l-eve-cyan/50 bg-eve-cyan/5' : ''}`}
                >
                  <span className="col-span-1 text-[9px] font-mono text-eve-dim">{typeAbbr}</span>
                  <span className="col-span-3 text-xs text-eve-text truncate">{c.title || typeAbbr}</span>
                  <span className="col-span-2 text-[10px] text-eve-muted truncate">{c.issuerName}</span>
                  <span className="col-span-2 text-[10px] text-eve-muted truncate">{c.assigneeName}</span>
                  <span className="col-span-2 text-right text-xs font-mono text-eve-green">
                    {c.price > 0 ? formatISK(c.price) : '—'}
                  </span>
                  <span className={`col-span-1 text-right text-[9px] font-mono ${expired ? 'text-eve-red' : expirySoon ? 'text-eve-red' : 'text-eve-dim'}`}>
                    {expired ? 'EXP' : `${daysLeft}d`}
                  </span>
                  <span className={`col-span-1 text-right text-[9px] font-mono uppercase ${statusColor}`}>
                    {c.status === 'outstanding' ? 'OPEN' : c.status === 'in_progress' ? 'ACTV' : c.status.slice(0, 4).toUpperCase()}
                  </span>
                </button>
              )
            }
            return (
              <div className="space-y-3">
                <div className="eve-panel p-3 flex flex-col">
                  <div className="eve-header mb-1">PERSONAL CONTRACTS ({directFiltered.length})</div>
                  {directFiltered.length === 0 ? (
                    <div className="flex items-center justify-center text-eve-muted text-xs py-4">
                      {contractSearch ? 'NO MATCHES' : 'NO OUTSTANDING PERSONAL CONTRACTS'}
                    </div>
                  ) : (
                    <>{colHeader}<div>{directFiltered.map(renderRow)}</div></>
                  )}
                </div>
                <div className="eve-panel p-3 flex flex-col">
                  <div className="eve-header mb-1">ALLIANCE CONTRACTS ({allianceFiltered.length})</div>
                  {allianceFiltered.length === 0 ? (
                    <div className="flex items-center justify-center text-eve-muted text-xs py-4">
                      {contractSearch ? 'NO MATCHES' : 'NO OUTSTANDING ALLIANCE CONTRACTS'}
                    </div>
                  ) : (
                    <>{colHeader}<div>{allianceFiltered.map(renderRow)}</div></>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── COMPLETED tab ───────────────────────────────────────────────── */}
          {contractSubTab === 'completed' && (
            <>
              {completedContracts.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="eve-panel p-2">
                    <div className="eve-label text-[9px] mb-0.5">COMPLETED</div>
                    <div className="text-eve-cyan text-sm font-mono">{completedContracts.length}</div>
                  </div>
                  <div className="eve-panel p-2">
                    <div className="eve-label text-[9px] mb-0.5">INCOMING ISK</div>
                    <div className="text-eve-green text-sm font-mono">
                      {formatISK(completedContracts.filter(c => c.issuerId === character?.characterId).reduce((s, c) => s + c.price, 0))}
                    </div>
                  </div>
                  <div className="eve-panel p-2">
                    <div className="eve-label text-[9px] mb-0.5">OUTGOING ISK</div>
                    <div className="text-eve-red text-sm font-mono">
                      {formatISK(completedContracts.filter(c => c.assigneeId === character?.characterId).reduce((s, c) => s + c.price, 0))}
                    </div>
                  </div>
                </div>
              )}
              <div className="eve-panel p-3 flex flex-col">
                <div className="eve-header mb-1">COMPLETED CONTRACTS ({displayedCompleted.length})</div>
                {displayedCompleted.length > 0 && (
                  <div className="grid grid-cols-12 gap-1 text-[9px] text-eve-dim uppercase tracking-widest pb-1 border-b border-eve-border/50 mb-1">
                    <span className="col-span-1">TYPE</span>
                    <span className="col-span-3">TITLE</span>
                    <span className="col-span-2">ISSUER</span>
                    <span className="col-span-2">ASSIGNEE</span>
                    <span className="col-span-2 text-right">PRICE</span>
                    <span className="col-span-1 text-right">EXP</span>
                    <span className="col-span-1 text-right">STATUS</span>
                  </div>
                )}
                {displayedCompleted.length === 0 ? (
                  <div className="flex items-center justify-center text-eve-muted text-xs py-6">
                    {completedContracts.length === 0 ? 'NO COMPLETED CONTRACTS' : 'NO MATCHES'}
                  </div>
                ) : (
                  <div>
                    {displayedCompleted.map(c => {
                      const statusColor = CONTRACT_STATUS_COLOR[c.status] ?? 'text-eve-muted'
                      const typeAbbr = CONTRACT_TYPE_ABBR[c.type] ?? c.type.toUpperCase().slice(0, 4)
                      const incoming = c.issuerId === character?.characterId
                      const priceColor = incoming ? 'text-eve-green' : 'text-eve-red'
                      return (
                        <button
                          key={c.contractId}
                          onClick={() => setOpenContract(c)}
                          className="w-full text-left grid grid-cols-12 gap-1 py-1.5 border-b border-eve-border/20 hover:bg-white/[0.03] cursor-pointer transition-colors"
                        >
                          <span className="col-span-1 text-[9px] font-mono text-eve-dim">{typeAbbr}</span>
                          <span className="col-span-3 text-xs text-eve-text truncate">{c.title || typeAbbr}</span>
                          <span className="col-span-2 text-[10px] text-eve-muted truncate">{c.issuerName}</span>
                          <span className="col-span-2 text-[10px] text-eve-muted truncate">{c.assigneeName}</span>
                          <span className={`col-span-2 text-right text-xs font-mono ${priceColor}`}>
                            {c.price > 0 ? `${incoming ? '+' : '-'}${formatISK(c.price)}` : '—'}
                          </span>
                          <span className="col-span-1 text-right text-[9px] font-mono text-eve-dim">—</span>
                          <span className={`col-span-1 text-right text-[9px] font-mono uppercase ${statusColor}`}>
                            {c.status === 'finished_issuer' || c.status === 'finished_contractor' ? 'DONE' : c.status.slice(0, 4).toUpperCase()}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── ALLIANCE BROWSER tab ────────────────────────────────────────── */}
          {contractSubTab === 'browser' && (
            <>
              {corporationContracts.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="eve-panel p-2">
                    <div className="eve-label text-[9px] mb-0.5">OUTSTANDING</div>
                    <div className="text-eve-gold text-sm font-mono">
                      {corporationContracts.filter(c => c.status === 'outstanding').length}
                    </div>
                  </div>
                  <div className="eve-panel p-2">
                    <div className="eve-label text-[9px] mb-0.5">MY LISTINGS</div>
                    <div className="text-eve-cyan text-sm font-mono">
                      {corporationContracts.filter(c =>
                        characters.some(ch => ch.characterId === c.issuerId) ||
                        c.issuerId === character?.characterId
                      ).length}
                    </div>
                  </div>
                  <div className="eve-panel p-2">
                    <div className="eve-label text-[9px] mb-0.5">TOTAL ISK</div>
                    <div className="text-eve-green text-sm font-mono">
                      {formatISK(corporationContracts.filter(c => c.status === 'outstanding').reduce((s, c) => s + c.price, 0))}
                    </div>
                  </div>
                </div>
              )}
              <div className="eve-panel p-3 flex flex-col">
                <div className="eve-header mb-1">ALLIANCE CONTRACT BROWSER ({displayedBrowser.length})</div>
                {displayedBrowser.length > 0 && (
                  <div className="grid grid-cols-12 gap-1 text-[9px] text-eve-dim uppercase tracking-widest pb-1 border-b border-eve-border/50 mb-1">
                    <span className="col-span-1">TYPE</span>
                    <span className="col-span-3">TITLE</span>
                    <span className="col-span-2">ISSUER</span>
                    <span className="col-span-2">ASSIGNEE</span>
                    <span className="col-span-2 text-right">PRICE</span>
                    <span className="col-span-1 text-right">EXP</span>
                    <span className="col-span-1 text-right">STATUS</span>
                  </div>
                )}
                {displayedBrowser.length === 0 ? (
                  <div className="flex items-center justify-center text-eve-muted text-xs py-6">
                    {corporationContracts.length === 0 ? 'NO ALLIANCE CONTRACTS LOADED' : 'NO MATCHES'}
                  </div>
                ) : (
                  <div>
                    {displayedBrowser.map(c => {
                      const daysLeft = contractDaysLeft(c.dateExpired)
                      const expired = daysLeft < 0
                      const expirySoon = !expired && daysLeft <= 2
                      const statusColor = CONTRACT_STATUS_COLOR[c.status] ?? 'text-eve-muted'
                      const typeAbbr = CONTRACT_TYPE_ABBR[c.type] ?? c.type.toUpperCase().slice(0, 4)
                      return (
                        <button
                          key={c.contractId}
                          onClick={() => setOpenContract(c)}
                          className="w-full text-left grid grid-cols-12 gap-1 py-1.5 border-b border-eve-border/20 hover:bg-white/[0.03] cursor-pointer transition-colors"
                        >
                          <span className="col-span-1 text-[9px] font-mono text-eve-dim">{typeAbbr}</span>
                          <span className="col-span-3 text-xs text-eve-text truncate">{c.title || typeAbbr}</span>
                          <span className="col-span-2 text-[10px] text-eve-muted truncate">{c.issuerName}</span>
                          <span className="col-span-2 text-[10px] text-eve-muted truncate">{c.assigneeName}</span>
                          <span className="col-span-2 text-right text-xs font-mono text-eve-green">
                            {c.price > 0 ? formatISK(c.price) : '—'}
                          </span>
                          <span className={`col-span-1 text-right text-[9px] font-mono ${expired ? 'text-eve-red' : expirySoon ? 'text-eve-red' : 'text-eve-dim'}`}>
                            {expired ? 'EXP' : `${daysLeft}d`}
                          </span>
                          <span className={`col-span-1 text-right text-[9px] font-mono uppercase ${statusColor}`}>
                            {c.status === 'outstanding' ? 'OPEN' : c.status === 'in_progress' ? 'ACTV' : c.status.slice(0, 4).toUpperCase()}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {tab === 'trade' && (
        <div className="flex flex-col gap-3">

          {/* Hub + mode selectors */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex border border-eve-border overflow-hidden">
              {TRADE_HUBS.map(hub => (
                <button
                  key={hub.name}
                  onClick={() => setTradeHub(hub)}
                  className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest transition-colors
                    ${tradeHub.name === hub.name ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
                >
                  {hub.name}
                </button>
              ))}
            </div>
            <div className="flex border border-eve-border overflow-hidden">
              {(['relist', 'mislisted', 'highvol'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setTradeMode(m); setSelectedDeal(null) }}
                  className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest transition-colors border-r border-eve-border last:border-r-0
                    ${tradeMode === m ? 'bg-eve-green/10 text-eve-green' : 'text-eve-muted hover:text-eve-text'}`}
                >
                  {m === 'relist' ? 'RELIST' : m === 'mislisted' ? 'MISLISTED' : 'HIGH VOL'}
                </button>
              ))}
            </div>
            <button
              onClick={() => runTradeScan()}
              disabled={tradeLoading}
              className="px-3 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-eve-green text-eve-green bg-eve-green/10 hover:bg-eve-green/20 transition-colors disabled:opacity-40"
            >
              {tradeLoading ? 'SCANNING...' : 'SCAN'}
            </button>
            {tradeScanned && !tradeLoading && (
              <span className="text-[9px] text-eve-dim font-mono ml-1">
                {tradeTotal.toLocaleString()} orders · {tradeDeals.length} deals
              </span>
            )}
            {tradeScanned && !tradeLoading && (
              <span className="text-[9px] text-eve-cyan/50 font-mono">· switch modes without rescanning</span>
            )}
          </div>

          {/* Adjustable scan options */}
          <div className="eve-panel p-2 flex flex-col gap-2">
            <div className="text-[9px] text-eve-dim uppercase tracking-widest mb-0.5">SCAN OPTIONS</div>
            <div className="grid grid-cols-3 gap-3">
              {/* Min spread */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[9px]">
                  <span className="text-eve-dim">MIN SPREAD</span>
                  <span className="font-mono text-eve-cyan">{minSpread}%</span>
                </div>
                <input
                  type="range" min={2} max={50} step={1} value={minSpread}
                  onChange={e => setMinSpread(Number(e.target.value))}
                  className="w-full h-1 accent-eve-cyan cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-eve-dim/50">
                  <span>2%</span><span>50%</span>
                </div>
              </div>
              {/* Min daily vol (relist only) */}
              <div className={`flex flex-col gap-1 ${tradeMode !== 'relist' ? 'opacity-30 pointer-events-none' : ''}`}>
                <div className="flex justify-between text-[9px]">
                  <span className="text-eve-dim">MIN VOL/DAY</span>
                  <span className="font-mono text-eve-cyan">{minDailyVol}</span>
                </div>
                <input
                  type="range" min={1} max={100} step={1} value={minDailyVol}
                  onChange={e => setMinDailyVol(Number(e.target.value))}
                  className="w-full h-1 accent-eve-cyan cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-eve-dim/50">
                  <span>1</span><span>100</span>
                </div>
              </div>
              {/* Result limit */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[9px]">
                  <span className="text-eve-dim">RESULTS</span>
                  <span className="font-mono text-eve-cyan">{resultLimit}</span>
                </div>
                <input
                  type="range" min={10} max={100} step={5} value={resultLimit}
                  onChange={e => setResultLimit(Number(e.target.value))}
                  className="w-full h-1 accent-eve-cyan cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-eve-dim/50">
                  <span>10</span><span>100</span>
                </div>
              </div>
            </div>
          </div>

          {/* Mode description */}
          <div className="text-[9px] text-eve-dim font-mono">
            {tradeMode === 'relist' && `↑ Spread ≥${minSpread}% · buy at best buy, relist at best sell · sorted by ISK/day`}
            {tradeMode === 'mislisted' && '⚠ Negative spread · sell order priced BELOW standing buy order · instant flip opportunity'}
            {tradeMode === 'highvol' && `↑ Spread ≥${minSpread}% · sorted by sell-side volume on market · fastest movers`}
          </div>

          {tradeError && (
            <div className="text-eve-red text-[10px] font-mono px-2 py-1 border border-eve-red/30 bg-eve-red/5">{tradeError}</div>
          )}

          {tradeLoading && (
            <div className="flex items-center justify-center text-eve-muted text-xs py-10 gap-2">
              <RefreshCw size={12} className="animate-spin" /> FETCHING {tradeHub.name.toUpperCase()} MARKET DATA...
            </div>
          )}

          {!tradeLoading && !tradeScanned && (
            <div className="flex items-center justify-center text-eve-muted text-xs text-center py-10">
              SELECT A HUB + MODE AND HIT SCAN
            </div>
          )}

          {!tradeLoading && tradeScanned && tradeDeals.length === 0 && (
            <div className="flex items-center justify-center text-eve-muted text-xs py-10">
              NO DEALS FOUND MATCHING CRITERIA
            </div>
          )}

          {!tradeLoading && tradeDeals.length > 0 && (() => {
            const SortHeader = ({ col, children, className = '' }: { col: SortCol; children: React.ReactNode; className?: string }) => (
              <button
                onClick={() => handleSortCol(col)}
                className={`flex items-center gap-0.5 hover:text-eve-text transition-colors ${sortCol === col ? 'text-eve-cyan' : ''} ${className}`}
              >
                {children}
                {sortCol === col
                  ? sortDir === 'desc' ? <ChevronDown size={8} /> : <ChevronUp size={8} />
                  : <ChevronsUpDown size={8} className="opacity-30" />}
              </button>
            )
            return (
              <div className="flex gap-2 min-h-0" style={{ height: '480px' }}>

                {/* Deal list */}
                <div className="flex-1 eve-panel flex flex-col overflow-hidden">
                  <div className="grid grid-cols-12 gap-1 text-[9px] text-eve-dim uppercase tracking-widest px-2 py-1.5 border-b border-eve-border/50 shrink-0">
                    <SortHeader col="name" className={`${tradeMode === 'relist' ? 'col-span-3' : 'col-span-4'} justify-start`}>ITEM</SortHeader>
                    <SortHeader col="bestBuy" className="col-span-2 justify-end">BUY</SortHeader>
                    <SortHeader col="bestSell" className="col-span-2 justify-end">SELL</SortHeader>
                    <SortHeader col="spread" className="col-span-1 justify-end">SPR</SortHeader>
                    <SortHeader col="netSpread" className="col-span-1 justify-end">NET</SortHeader>
                    <SortHeader col="profitPerUnit" className="col-span-2 justify-end">PROFIT/U</SortHeader>
                    {tradeMode === 'relist' && <SortHeader col="dailyVol" className="col-span-1 justify-end">VOL/D</SortHeader>}
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {sortedDeals.map(deal => {
                      const selected = selectedDeal?.typeId === deal.typeId
                      const spreadColor = deal.spread >= 20 ? 'text-eve-green' : deal.spread >= 10 ? 'text-eve-gold' : 'text-eve-red'
                      const netColor = deal.netSpread > 0 ? 'text-eve-green' : 'text-eve-red'
                      return (
                        <button
                          key={deal.typeId}
                          onClick={() => setSelectedDeal(selected ? null : deal)}
                          className={`w-full text-left grid grid-cols-12 gap-1 px-2 py-1.5 border-b border-eve-border/20 transition-colors
                            ${selected ? 'bg-eve-green/10 border-l-2 border-l-eve-green' : 'hover:bg-white/[0.03]'}`}
                        >
                          <span className={`${tradeMode === 'relist' ? 'col-span-3' : 'col-span-4'} flex items-center gap-1 min-w-0`}>
                            <span className="text-eve-text text-[10px] truncate">{deal.name}</span>
                            {myBuyOrderMap[deal.typeId] != null && (
                              <span className="shrink-0 px-0.5 text-[8px] font-mono bg-eve-orange/20 text-eve-orange border border-eve-orange/40 rounded-sm leading-tight">
                                {myBuyOrderMap[deal.typeId].toLocaleString()}
                              </span>
                            )}
                          </span>
                          <span className="col-span-2 text-right text-[10px] font-mono text-eve-orange">{formatISK(deal.bestBuy)}</span>
                          <span className="col-span-2 text-right text-[10px] font-mono text-eve-green">{formatISK(deal.bestSell)}</span>
                          <span className={`col-span-1 text-right text-[10px] font-mono ${spreadColor}`}>
                            {deal.spread >= 0 ? '+' : ''}{deal.spread}%
                          </span>
                          <span className={`col-span-1 text-right text-[10px] font-mono ${netColor}`}>
                            {deal.netSpread > 0 ? '+' : ''}{deal.netSpread}%
                          </span>
                          <span className={`col-span-2 text-right text-[10px] font-mono ${deal.profitPerUnit > 0 ? 'text-eve-green' : 'text-eve-red'}`}>
                            {deal.profitPerUnit > 0 ? '+' : ''}{formatISK(deal.profitPerUnit)}
                          </span>
                          {tradeMode === 'relist' && (
                            <span className="col-span-1 text-right text-[10px] font-mono text-eve-dim">
                              {deal.dailyVol != null ? deal.dailyVol.toLocaleString() : '—'}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Inspector */}
                <div className="w-52 shrink-0 eve-panel flex flex-col overflow-hidden">
                  <div className="eve-header px-2 pt-2 pb-1 shrink-0 text-[9px] tracking-widest">DEAL DETAIL</div>
                  {!selectedDeal ? (
                    <div className="flex-1 flex items-center justify-center text-eve-muted text-xs text-center px-3">
                      CLICK A DEAL<br/>TO INSPECT
                    </div>
                  ) : (
                    <div className="overflow-y-auto flex-1 px-2 py-2 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex-1 min-w-0">
                          <div className="text-eve-cyan text-[10px] font-mono leading-tight">{selectedDeal.name}</div>
                          {myBuyOrderMap[selectedDeal.typeId] != null && (
                            <div className="text-[9px] text-eve-orange mt-0.5 font-mono">
                              ↑ Active buy order · {myBuyOrderMap[selectedDeal.typeId].toLocaleString()} units
                            </div>
                          )}
                        </div>
                        <button
                          onClick={async () => {
                            const text = selectedDeal.name.trimEnd()
                            const fallback = () => {
                              const el = document.createElement('textarea')
                              el.value = text
                              el.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
                              document.body.appendChild(el)
                              el.focus()
                              el.select()
                              document.execCommand('copy')
                              document.body.removeChild(el)
                            }
                            try {
                              await navigator.clipboard.writeText(text)
                            } catch {
                              fallback()
                            }
                            setCopyDone(true)
                            setTimeout(() => setCopyDone(false), 1500)
                          }}
                          className="shrink-0 p-0.5 text-eve-dim hover:text-eve-cyan transition-colors"
                          title="Copy item name"
                        >
                          {copyDone ? <Check size={10} className="text-eve-green" /> : <Copy size={10} />}
                        </button>
                      </div>
                      <div className="flex flex-col gap-1 text-[10px]">
                        {/* Best buy — copyable full ISK amount */}
                        <div className="flex justify-between border-b border-eve-border/30 pb-0.5 items-center">
                          <span className="text-eve-dim">Best buy order</span>
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-eve-orange">{formatISK(selectedDeal.bestBuy)}</span>
                            <CopyISKButton value={selectedDeal.bestBuy} />
                          </div>
                        </div>
                        {[
                          ['Best sell order', formatISK(selectedDeal.bestSell), 'text-eve-green'],
                          ['Raw spread', `${selectedDeal.spread >= 0 ? '+' : ''}${selectedDeal.spread}%`, selectedDeal.spread >= 15 ? 'text-eve-green' : 'text-eve-gold'],
                          ['Broker fee (3%)', '−3.0%', 'text-eve-red'],
                          ['Sales tax (3.6%)', '−3.6%', 'text-eve-red'],
                          ['Net spread', `${selectedDeal.netSpread > 0 ? '+' : ''}${selectedDeal.netSpread}%`, selectedDeal.netSpread > 0 ? 'text-eve-green' : 'text-eve-red'],
                          ['Profit / unit', (selectedDeal.profitPerUnit > 0 ? '+' : '') + formatISK(selectedDeal.profitPerUnit), selectedDeal.profitPerUnit > 0 ? 'text-eve-green' : 'text-eve-red'],
                        ].map(([label, val, color]) => (
                          <div key={label} className="flex justify-between border-b border-eve-border/30 pb-0.5">
                            <span className="text-eve-dim">{label}</span>
                            <span className={`font-mono ${color}`}>{val}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 flex flex-col gap-1 text-[9px] text-eve-dim">
                        {selectedDeal.dailyVol != null && (
                          <div className="flex justify-between">
                            <span>Avg daily vol (30d)</span>
                            <span className={`font-mono ${selectedDeal.dailyVol >= 100 ? 'text-eve-green' : selectedDeal.dailyVol >= 50 ? 'text-eve-gold' : 'text-eve-red'}`}>
                              {selectedDeal.dailyVol.toLocaleString()}/day
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Sell vol on market</span>
                          <span className="font-mono text-eve-muted">{selectedDeal.sellVol.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Buy vol on market</span>
                          <span className="font-mono text-eve-muted">{selectedDeal.buyVol.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className={`mt-2 px-2 py-1.5 text-[9px] font-mono border ${selectedDeal.netSpread > 0 ? 'border-eve-green/30 bg-eve-green/5 text-eve-green' : 'border-eve-red/30 bg-eve-red/5 text-eve-red'}`}>
                        {selectedDeal.netSpread > 0
                          ? `VIABLE · buy at ${formatISK(selectedDeal.bestBuy)}, relist at ${formatISK(selectedDeal.bestSell)}`
                          : 'MARGIN TOO THIN after fees'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          <div ref={tradeBottomRef} />
        </div>
      )}
    </div>
  )
}

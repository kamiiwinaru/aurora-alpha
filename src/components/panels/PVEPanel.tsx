import { useState, useEffect } from 'react'
import { Shield, RefreshCw, ChevronDown, ChevronRight, ChevronUp, AlertCircle, Search, BookOpen, X } from 'lucide-react'
import type { EveCharacter } from '../../types'

// ── LP Store types ─────────────────────────────────────────────────────────────

interface LpBalance {
  corporation_id: number
  loyalty_points: number
  corp_name: string
}

interface RequiredItem {
  type_id: number
  type_name: string
  quantity: number
  unit_sell: number
}

interface RankedOffer {
  offer_id: number
  corporation_id: number
  corp_name: string
  lp_balance: number
  type_id: number
  type_name: string
  quantity: number
  lp_cost: number
  isk_cost: number
  required_items: RequiredItem[]
  sell_price: number
  required_cost: number
  net_isk: number
  isk_per_lp: number
}

// ── Mission DB types ───────────────────────────────────────────────────────────

interface MissionNPC {
  group: string
  class: string
  count: number
  name: string
  trigger: string | null
  web: boolean
  point: boolean
  ewar: string | null
  notes: string | null
}

interface MissionPocket {
  name: string
  description: string
  npcs: MissionNPC[]
}

interface MissionExtra {
  type: 'web' | 'ewar' | 'neut' | 'scram' | 'damp' | 'td'
  note: string
}

interface MissionLoot {
  bounty: string | null
  loot: string | null
  salvage: string | null
  tags: string | null
  items: string[]
}

interface MissionEntry {
  id: string
  name: string
  wikiTitle: string
  level: number | null
  type: string | null
  objective: string | null
  factions: string[]
  standingLoss: string | null
  damageDeal: string | null
  damageResist: string | null
  shipSuggestion: string[]
  extras: MissionExtra[]
  briefing: string | null
  pockets: MissionPocket[]
  blitz: string | null
  loot: MissionLoot | null
}

interface Props {
  characters: EveCharacter[]
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtIsk(n: number): string {
  if (!isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}

function fmtLp(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

// ── Faction → damage type fallback ────────────────────────────────────────────
// Used when the wiki template leaves DamageToDeal blank (most missions)

const FACTION_DMG: Record<string, { deal: string; resist: string }> = {
  'angel cartel':           { deal: 'Exp/Kin',        resist: 'Exp/Kin' },
  'blood raiders':          { deal: 'EM/Therm',       resist: 'EM/Therm' },
  'caldari state':          { deal: 'Kin/Therm',      resist: 'Kin/Therm' },
  'caldari navy':           { deal: 'Kin/Therm',      resist: 'Kin/Therm' },
  'guristas pirates':       { deal: 'Kin/Therm',      resist: 'Kin/Therm' },
  'guristas':               { deal: 'Kin/Therm',      resist: 'Kin/Therm' },
  'rogue drones':           { deal: 'EM/Therm/Exp/Kin', resist: 'EM/Therm/Exp/Kin' },
  "sansha's nation":        { deal: 'EM/Therm',       resist: 'EM/Therm' },
  'serpentis':              { deal: 'Kin/Therm',      resist: 'Kin/Therm' },
  'amarr empire':           { deal: 'EM/Therm',       resist: 'EM/Therm' },
  'gallente federation':    { deal: 'Kin/Therm',      resist: 'Kin/Therm' },
  'minmatar republic':      { deal: 'Exp/Kin',        resist: 'Exp/Kin' },
  'thukker tribe':          { deal: 'Exp/Kin',        resist: 'Exp/Kin' },
  'khanid kingdom':         { deal: 'EM/Therm',       resist: 'EM/Therm' },
  'true sansha':            { deal: 'EM/Therm',       resist: 'EM/Therm' },
  'mordu\'s legion':        { deal: 'Kin/Therm',      resist: 'Kin/Therm' },
  'concord':                { deal: 'EM/Kin',         resist: 'EM/Kin' },
}

function factionDmg(factions: string[]): { deal: string | null; resist: string | null } {
  const results = factions
    .map(f => FACTION_DMG[f.toLowerCase()])
    .filter(Boolean)
  if (results.length === 0) return { deal: null, resist: null }
  if (results.length === 1) return { deal: results[0].deal, resist: results[0].resist }
  // Multi-faction: combine unique values
  const deals = [...new Set(results.map(r => r.deal))].join(' / ')
  const resists = [...new Set(results.map(r => r.resist))].join(' / ')
  return { deal: deals, resist: resists }
}

// ── Damage chip helpers ────────────────────────────────────────────────────────

const DMG_CHIP: Record<string, string> = {
  em:        'border-purple-500/50 bg-purple-900/20 text-purple-300',
  therm:     'border-red-500/50 bg-red-900/20 text-red-300',
  thermal:   'border-red-500/50 bg-red-900/20 text-red-300',
  kin:       'border-blue-500/50 bg-blue-900/20 text-blue-300',
  kinetic:   'border-blue-500/50 bg-blue-900/20 text-blue-300',
  exp:       'border-orange-500/50 bg-orange-900/20 text-orange-300',
  explosive: 'border-orange-500/50 bg-orange-900/20 text-orange-300',
}

function dmgClass(token: string): string {
  const lc = token.toLowerCase().trim()
  for (const [k, v] of Object.entries(DMG_CHIP)) {
    if (lc.includes(k)) return v
  }
  return 'border-eve-border text-eve-muted'
}

function DmgChips({ value, label }: { value: string | null; label: string }) {
  if (!value) return null
  const tokens = value.split(/[/,]/).map(s => s.trim()).filter(Boolean)
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-eve-dim text-[9px] uppercase tracking-widest mr-0.5">{label}</span>
      {tokens.map(t => (
        <span key={t} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${dmgClass(t)}`}>{t}</span>
      ))}
    </div>
  )
}

const EXTRA_STYLE: Record<string, string> = {
  web:  'border-orange-500/50 bg-orange-900/20 text-orange-300',
  scram:'border-red-500/50 bg-red-900/20 text-red-300',
  point:'border-red-500/50 bg-red-900/20 text-red-300',
  neut: 'border-red-400/50 bg-red-900/20 text-red-300',
  ewar: 'border-yellow-500/50 bg-yellow-900/20 text-yellow-300',
  damp: 'border-yellow-500/50 bg-yellow-900/20 text-yellow-300',
  td:   'border-yellow-500/50 bg-yellow-900/20 text-yellow-300',
}

const EXTRA_LABEL: Record<string, string> = {
  web: 'WEB', scram: 'SCRAM', point: 'WARP DISRUPT',
  neut: 'NEUT', ewar: 'EWAR', damp: 'DAMP', td: 'TRACK DISRUPT',
}

// ── LP Store sub-components ───────────────────────────────────────────────────

type SortKey = 'name' | 'corp' | 'runs' | 'lp_cost' | 'isk_cost' | 'sell' | 'net' | 'isk_per_lp'
type SortDir = 'asc' | 'desc'

function SortTh({ label, col, sort, onSort, className = '' }: {
  label: string; col: SortKey; sort: { key: SortKey; dir: SortDir }
  onSort: (col: SortKey) => void; className?: string
}) {
  const active = sort.key === col
  return (
    <th className={`py-1.5 pr-3 font-normal cursor-pointer select-none whitespace-nowrap group ${className}`} onClick={() => onSort(col)}>
      <span className={`inline-flex items-center gap-0.5 ${active ? 'text-eve-cyan' : 'text-eve-dim group-hover:text-eve-muted'}`}>
        {label}
        {active
          ? sort.dir === 'desc' ? <ChevronDown size={9} /> : <ChevronUp size={9} />
          : <ChevronDown size={9} className="opacity-0 group-hover:opacity-40" />}
      </span>
    </th>
  )
}

function OffersTable({ rows, topHighlight, expandedOffer, setExpandedOffer }: {
  rows: RankedOffer[]; topHighlight: boolean
  expandedOffer: number | null; setExpandedOffer: (id: number | null) => void
}) {
  const [runOverrides, setRunOverrides] = useState<Record<number, number>>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'isk_per_lp', dir: 'desc' })

  function getRuns(row: RankedOffer) {
    if (runOverrides[row.offer_id] !== undefined) return runOverrides[row.offer_id]
    return row.lp_cost > 0 ? Math.floor(row.lp_balance / row.lp_cost) : 1
  }

  function onSort(col: SortKey) {
    setSort(prev => prev.key === col
      ? { key: col, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { key: col, dir: col === 'name' || col === 'corp' ? 'asc' : 'desc' })
  }

  const sorted = [...rows].sort((a, b) => {
    const d = sort.dir === 'desc' ? -1 : 1
    switch (sort.key) {
      case 'name':       return d * a.type_name.localeCompare(b.type_name)
      case 'corp':       return d * a.corp_name.localeCompare(b.corp_name)
      case 'runs':       return d * (Math.floor(a.lp_balance / a.lp_cost) - Math.floor(b.lp_balance / b.lp_cost))
      case 'lp_cost':    return d * (a.lp_cost - b.lp_cost)
      case 'isk_cost':   return d * (a.isk_cost - b.isk_cost)
      case 'sell':       return d * (a.sell_price - b.sell_price)
      case 'net':        return d * (a.net_isk - b.net_isk)
      case 'isk_per_lp': return d * (a.isk_per_lp - b.isk_per_lp)
      default: return 0
    }
  })

  const colSpanDetail = topHighlight ? 9 : 8

  return (
    <table className="w-full text-xs font-mono border-collapse">
      <thead>
        <tr className="border-b border-eve-border">
          <th className="w-4" />
          <SortTh label="Item"       col="name"       sort={sort} onSort={onSort} className="text-left" />
          <SortTh label="Corp"       col="corp"       sort={sort} onSort={onSort} className="text-left hidden lg:table-cell" />
          {topHighlight && <SortTh label="Runs" col="runs" sort={sort} onSort={onSort} className="text-right" />}
          <SortTh label="LP Cost"    col="lp_cost"    sort={sort} onSort={onSort} className="text-right" />
          <SortTh label="ISK Cost"   col="isk_cost"   sort={sort} onSort={onSort} className="text-right hidden md:table-cell" />
          <SortTh label="Total Sell" col="sell"       sort={sort} onSort={onSort} className="text-right" />
          <SortTh label="Total Net"  col="net"        sort={sort} onSort={onSort} className="text-right" />
          <SortTh label="ISK/LP"     col="isk_per_lp" sort={sort} onSort={onSort} className="text-right" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => {
          const isExpanded = expandedOffer === row.offer_id
          const iskColor = row.isk_per_lp >= 1500 ? 'text-eve-green' : row.isk_per_lp >= 700 ? 'text-eve-gold' : 'text-eve-muted'
          const lpShortfall = row.lp_cost - row.lp_balance
          const maxRuns = row.lp_cost > 0 ? Math.floor(row.lp_balance / row.lp_cost) : 1
          const runs = topHighlight ? getRuns(row) : 1
          const totalSell = row.sell_price * runs
          const totalNet = row.net_isk * runs
          const totalLp = row.lp_cost * runs
          const totalIsk = row.isk_cost * runs
          const totalReqCost = row.required_cost * runs
          const isTop = topHighlight && sort.key === 'isk_per_lp' && sort.dir === 'desc' && i < 5
          return (
            <>
              <tr
                key={row.offer_id}
                className={`border-b border-eve-border/40 cursor-pointer transition-colors hover:bg-eve-border/10 ${isTop ? 'bg-eve-cyan/3' : ''}`}
                onClick={() => setExpandedOffer(isExpanded ? null : row.offer_id)}
              >
                <td className="py-1.5 pr-1 text-eve-dim">{isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</td>
                <td className="py-1.5 pr-3 text-eve-text">
                  {row.type_name}
                  {row.quantity > 1 && <span className="text-eve-dim ml-1">×{row.quantity}</span>}
                  {isTop && i < 3 && <span className="ml-1.5 text-[9px] text-eve-cyan border border-eve-cyan/40 px-1 rounded">TOP</span>}
                </td>
                <td className="py-1.5 pr-3 text-eve-muted hidden lg:table-cell truncate max-w-[140px]">{row.corp_name}</td>
                {topHighlight && (
                  <td className="py-1 pr-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button className="w-4 h-4 flex items-center justify-center text-eve-dim hover:text-eve-text border border-eve-border rounded leading-none"
                        onClick={() => setRunOverrides(r => ({ ...r, [row.offer_id]: Math.max(1, (r[row.offer_id] ?? maxRuns) - 1) }))}>−</button>
                      <span className="w-7 text-center text-eve-gold">{runs}</span>
                      <button className="w-4 h-4 flex items-center justify-center text-eve-dim hover:text-eve-text border border-eve-border rounded leading-none"
                        onClick={() => setRunOverrides(r => ({ ...r, [row.offer_id]: Math.min(maxRuns, (r[row.offer_id] ?? maxRuns) + 1) }))}>+</button>
                      {runs < maxRuns && <span className="text-eve-dim text-[9px]">/{maxRuns}</span>}
                    </div>
                  </td>
                )}
                <td className="py-1.5 pr-3 text-right">
                  <span className="text-eve-text">{fmtLp(topHighlight ? totalLp : row.lp_cost)}</span>
                  {!topHighlight && <span className="text-eve-red ml-1 text-[9px]">({fmtLp(lpShortfall)} short)</span>}
                </td>
                <td className="py-1.5 pr-3 text-right text-eve-muted hidden md:table-cell">{fmtIsk(topHighlight ? totalIsk : row.isk_cost)}</td>
                <td className="py-1.5 pr-3 text-right text-eve-text">{fmtIsk(totalSell)}</td>
                <td className={`py-1.5 pr-3 text-right ${totalNet >= 0 ? 'text-eve-green' : 'text-eve-red'}`}>{fmtIsk(totalNet)}</td>
                <td className={`py-1.5 text-right font-bold ${iskColor}`}>{fmtIsk(row.isk_per_lp)}</td>
              </tr>
              {isExpanded && (
                <tr key={`${row.offer_id}-detail`} className="border-b border-eve-border/40">
                  <td /><td colSpan={colSpanDetail} className="pb-2 pt-1 pr-3">
                    <div className="bg-eve-border/10 rounded p-2 space-y-1">
                      <div className="flex gap-6 text-eve-dim text-[10px] flex-wrap">
                        <span>LP available: <span className="text-eve-gold">{fmtLp(row.lp_balance)}</span></span>
                        {topHighlight
                          ? <span>Per run: sell <span className="text-eve-text">{fmtIsk(row.sell_price)}</span> · net <span className="text-eve-text">{fmtIsk(row.net_isk)}</span></span>
                          : <span>LP needed: <span className="text-eve-red">{fmtLp(lpShortfall)} more</span></span>}
                        <span>ISK cost/run: <span className="text-eve-text">{fmtIsk(row.isk_cost)}</span></span>
                        {row.required_cost > 0 && <span>Tag cost/run: <span className="text-eve-text">{fmtIsk(row.required_cost)}</span></span>}
                        {topHighlight && runs > 1 && <span>Total tag cost: <span className="text-eve-text">{fmtIsk(totalReqCost)}</span></span>}
                      </div>
                      {row.required_items.length > 0 && (
                        <div className="text-[10px] text-eve-dim">
                          <span className="text-eve-muted">Required per run: </span>
                          {row.required_items.map(ri => (
                            <span key={ri.type_id} className="mr-3">
                              {ri.type_name} ×{ri.quantity}
                              {ri.unit_sell > 0 && <span className="text-eve-muted ml-1">({fmtIsk(ri.unit_sell * ri.quantity)})</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          )
        })}
      </tbody>
    </table>
  )
}

// ── LP Store panel ─────────────────────────────────────────────────────────────

function LPStore({ characters }: Props) {
  const [activeChar, setActiveChar] = useState<EveCharacter | null>(characters[0] ?? null)
  const [scanning, setScanning] = useState(false)
  const [balances, setBalances] = useState<LpBalance[]>([])
  const [results, setResults] = useState<RankedOffer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandedOffer, setExpandedOffer] = useState<number | null>(null)
  const [filterCorp, setFilterCorp] = useState<number | null>(null)
  const [noApiKey, setNoApiKey] = useState(false)
  const [showFuture, setShowFuture] = useState(false)

  const char = activeChar ?? characters[0] ?? null

  async function runScan() {
    if (!char) return
    setScanning(true); setError(null); setResults([]); setBalances([]); setNoApiKey(false); setFilterCorp(null)
    try {
      const r = await fetch('/api/lp/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: char.characterId, refreshToken: char.refreshToken }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error ?? 'Analysis failed'); return }
      if (data.noApiKey) { setNoApiKey(true); return }
      setBalances((data.balances ?? []).sort((a: LpBalance, b: LpBalance) => b.loyalty_points - a.loyalty_points))
      setResults(data.results ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }

  const filtered = filterCorp ? results.filter(r => r.corporation_id === filterCorp) : results
  const affordable = filtered.filter(r => r.lp_balance >= r.lp_cost)
  const future = filtered.filter(r => r.lp_balance < r.lp_cost)
  const selectedCorpName = balances.find(b => b.corporation_id === filterCorp)?.corp_name

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        {characters.length > 1 && (
          <select className="eve-input text-xs py-0.5 px-2" value={char?.characterId ?? ''}
            onChange={e => { const f = characters.find(c => c.characterId === Number(e.target.value)); if (f) setActiveChar(f) }}>
            {characters.map(c => <option key={c.characterId} value={c.characterId}>{c.characterName}</option>)}
          </select>
        )}
        {balances.length > 0 && (
          <select className="eve-input text-xs py-0.5 px-2" value={filterCorp ?? ''}
            onChange={e => setFilterCorp(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">All Corps</option>
            {balances.map(b => <option key={b.corporation_id} value={b.corporation_id}>{b.corp_name} — {fmtLp(b.loyalty_points)} LP</option>)}
          </select>
        )}
        <button className="eve-btn-primary text-xs px-3 py-1 flex items-center gap-1.5 ml-auto"
          onClick={runScan} disabled={scanning || !char}>
          <RefreshCw size={11} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Analyzing…' : 'Analyze LP Stores'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-eve-red text-xs p-3 eve-panel rounded border border-eve-red/20">
          <AlertCircle size={12} />{error}
        </div>
      )}
      {noApiKey && (
        <div className="flex items-center gap-2 text-eve-gold text-xs p-3 eve-panel rounded border border-eve-gold/20">
          <AlertCircle size={12} />Janice API key not configured — add JANICE_API_KEY to your .env to enable LP store analysis.
        </div>
      )}
      {!scanning && !error && !noApiKey && results.length === 0 && balances.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-eve-dim">
          <Shield size={32} className="opacity-30" />
          <p className="text-xs font-mono">Click Analyze LP Stores to rank redemption options by ISK/LP</p>
        </div>
      )}
      {!scanning && !error && !noApiKey && balances.length > 0 && results.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-eve-dim">
          <p className="text-xs font-mono">No priced offers found — check Janice API key or LP balances</p>
        </div>
      )}

      {(affordable.length > 0 || future.length > 0) && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {affordable.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-eve-cyan tracking-widest uppercase mb-1.5">
                Redeemable Now — {affordable.length} offers{selectedCorpName ? ` · ${selectedCorpName}` : ''}
              </p>
              <OffersTable rows={affordable} topHighlight expandedOffer={expandedOffer} setExpandedOffer={setExpandedOffer} />
            </div>
          )}
          {future.length > 0 && (
            <div>
              <button className="flex items-center gap-2 text-[10px] font-mono text-eve-dim tracking-widest uppercase mb-1.5 hover:text-eve-muted transition-colors"
                onClick={() => setShowFuture(v => !v)}>
                {showFuture ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Goal Targets — {future.length} offers · earn more LP to unlock
              </button>
              {showFuture && (
                <OffersTable rows={future} topHighlight={false} expandedOffer={expandedOffer} setExpandedOffer={setExpandedOffer} />
              )}
            </div>
          )}
          <p className="text-eve-dim text-[10px] font-mono text-right">
            {affordable.length + future.length} offers total · prices via Janice Jita split
          </p>
        </div>
      )}
    </>
  )
}

// ── Mission DB panel ───────────────────────────────────────────────────────────

const LEVEL_COLORS = ['', 'text-green-400', 'text-blue-400', 'text-yellow-400', 'text-orange-400', 'text-red-400']
const LEVEL_BORDER = ['', 'border-green-500/50', 'border-blue-500/50', 'border-yellow-500/50', 'border-orange-500/50', 'border-red-500/50']

function LevelBadge({ level }: { level: number | null }) {
  if (!level) return null
  const col = LEVEL_COLORS[level] ?? 'text-eve-muted'
  const bdr = LEVEL_BORDER[level] ?? 'border-eve-border'
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${col} ${bdr} bg-black/20 shrink-0`}>
      L{level}
    </span>
  )
}

function MissionDetail({ mission }: { mission: MissionEntry }) {
  const [openPocket, setOpenPocket] = useState<number | null>(null)

  const fallback = factionDmg(mission.factions)
  const damageDeal = mission.damageDeal || fallback.deal
  const damageResist = mission.damageResist || fallback.resist
  const dmgFromFaction = !mission.damageDeal && !!fallback.deal

  return (
    <div className="bg-eve-border/10 rounded p-3 space-y-3 text-xs font-mono">
      {/* Type / Faction / Standing */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px]">
        {mission.type && <span className="text-eve-dim">Type: <span className="text-eve-muted">{mission.type}</span></span>}
        {mission.factions.length > 0 && <span className="text-eve-dim">Faction: <span className="text-eve-muted">{mission.factions.join(', ')}</span></span>}
        {mission.standingLoss && <span className="text-eve-dim">Standing: <span className="text-eve-red">{mission.standingLoss}</span></span>}
      </div>

      {/* Objective */}
      {mission.objective && (
        <div>
          <p className="text-[9px] text-eve-dim uppercase tracking-widest mb-1">Objective</p>
          <p className="text-eve-text leading-relaxed">{mission.objective}</p>
        </div>
      )}

      {/* Combat info row */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <DmgChips value={damageDeal} label="Deal" />
        <DmgChips value={damageResist} label="Resist" />
        {dmgFromFaction && <span className="text-[9px] text-eve-dim self-end">faction typical</span>}

        {mission.extras.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-eve-dim text-[9px] uppercase tracking-widest mr-0.5">EWAR</span>
            {mission.extras.map((ex, i) => (
              <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded border ${EXTRA_STYLE[ex.type] ?? 'border-eve-border text-eve-muted'}`}
                title={ex.note}>
                {EXTRA_LABEL[ex.type] ?? ex.type.toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Extras detail */}
      {mission.extras.length > 0 && (
        <div className="space-y-0.5">
          {mission.extras.map((ex, i) => (
            <p key={i} className="text-eve-dim text-[10px]">
              <span className={`${EXTRA_STYLE[ex.type]?.split(' ')[2] ?? 'text-eve-muted'} mr-1`}>{EXTRA_LABEL[ex.type]}:</span>
              {ex.note}
            </p>
          ))}
        </div>
      )}

      {/* Ship suggestions */}
      {mission.shipSuggestion.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-eve-dim text-[9px] uppercase tracking-widest mr-0.5">Ships</span>
          {mission.shipSuggestion.map(s => (
            <span key={s} className="text-[9px] text-eve-muted border border-eve-border px-1.5 py-0.5 rounded">{s}</span>
          ))}
        </div>
      )}

      {/* Blitz */}
      {mission.blitz && (
        <div>
          <p className="text-[9px] text-eve-cyan uppercase tracking-widest mb-1">Blitz</p>
          <div className="space-y-0.5">
            {mission.blitz.split('\n').map((line, i) => (
              <p key={i} className="text-eve-text leading-relaxed before:content-['▸'] before:text-eve-cyan before:mr-1.5">{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Pockets / Waves */}
      {mission.pockets.length > 0 && (
        <div>
          <p className="text-[9px] text-eve-dim uppercase tracking-widest mb-1.5">Pockets / Waves</p>
          <div className="space-y-1">
            {mission.pockets.map((pocket, pi) => {
              const isOpen = openPocket === pi
              return (
                <div key={pi} className="border border-eve-border/40 rounded">
                  <button
                    className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-eve-border/10 transition-colors text-left"
                    onClick={() => setOpenPocket(isOpen ? null : pi)}
                  >
                    {isOpen ? <ChevronDown size={10} className="text-eve-dim shrink-0" /> : <ChevronRight size={10} className="text-eve-dim shrink-0" />}
                    <span className="text-eve-muted">{pocket.name}</span>
                    {pocket.npcs.length > 0 && (
                      <span className="text-eve-dim text-[9px] ml-auto">{pocket.npcs.length} ships</span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-2 pb-2 space-y-2">
                      {pocket.description && (
                        <p className="text-eve-dim text-[10px] leading-relaxed border-t border-eve-border/30 pt-2">{pocket.description}</p>
                      )}
                      {pocket.npcs.length > 0 && (() => {
                        // Group by group name
                        const groups: Record<string, MissionNPC[]> = {}
                        for (const npc of pocket.npcs) {
                          if (!groups[npc.group]) groups[npc.group] = []
                          groups[npc.group].push(npc)
                        }
                        return (
                          <table className="w-full text-[10px] border-collapse">
                            <thead>
                              <tr className="border-b border-eve-border/40 text-eve-dim">
                                <th className="text-left py-1 pr-2 font-normal">Class</th>
                                <th className="text-center py-1 pr-2 font-normal w-8">#</th>
                                <th className="text-left py-1 font-normal">Name / Notes</th>
                                <th className="text-right py-1 pl-2 font-normal">Flags</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(groups).map(([grp, npcs]) => (
                                <>
                                  {grp !== 'Initial' && (
                                    <tr key={`grp-${grp}`}>
                                      <td colSpan={4} className="pt-2 pb-0.5 text-[9px] text-eve-cyan/70 uppercase tracking-widest">{grp}</td>
                                    </tr>
                                  )}
                                  {npcs.map((npc, ni) => (
                                    <tr key={ni} className="border-b border-eve-border/20 align-top">
                                      <td className="py-1 pr-2 text-eve-muted">{npc.class}</td>
                                      <td className="py-1 pr-2 text-center text-eve-text">{npc.count}</td>
                                      <td className="py-1 text-eve-text">
                                        <span>{npc.name}</span>
                                        {npc.trigger && <span className="block text-[9px] text-eve-cyan/80 mt-0.5">↳ {npc.trigger}</span>}
                                        {npc.notes   && <span className="block text-[9px] text-eve-gold/80 mt-0.5">↳ {npc.notes}</span>}
                                      </td>
                                      <td className="py-1 pl-2 text-right">
                                        <span className="flex items-center justify-end gap-1 flex-wrap">
                                          {npc.web   && <span className="text-[8px] px-1 rounded border border-orange-500/50 text-orange-300">WEB</span>}
                                          {npc.point && <span className="text-[8px] px-1 rounded border border-red-500/50 text-red-300">POINT</span>}
                                          {npc.ewar && !npc.web && <span className="text-[8px] px-1 rounded border border-yellow-500/50 text-yellow-300">{npc.ewar.toUpperCase()}</span>}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </>
                              ))}
                            </tbody>
                          </table>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Loot / Salvage / Bounty */}
      {mission.loot && (
        <div>
          <p className="text-[9px] text-eve-gold uppercase tracking-widest mb-1.5">Loot, Salvage &amp; Bounty</p>
          {(mission.loot.bounty || mission.loot.loot || mission.loot.salvage || mission.loot.tags) && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-1.5">
              {mission.loot.bounty && (
                <span className="text-[10px] text-eve-dim">Bounty: <span className="text-eve-gold">{mission.loot.bounty}</span></span>
              )}
              {mission.loot.loot && (
                <span className="text-[10px] text-eve-dim">Loot: <span className="text-eve-gold">{mission.loot.loot}</span></span>
              )}
              {mission.loot.salvage && (
                <span className="text-[10px] text-eve-dim">Salvage: <span className="text-eve-gold">{mission.loot.salvage}</span></span>
              )}
              {mission.loot.tags && (
                <span className="text-[10px] text-eve-dim">Tags: <span className="text-eve-gold">{mission.loot.tags}</span></span>
              )}
            </div>
          )}
          {mission.loot.items.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {mission.loot.items.map(item => (
                <span key={item} className="text-[9px] text-eve-muted border border-eve-border/50 px-1.5 py-0.5 rounded">{item}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Briefing — collapsed, lower priority */}
      {mission.briefing && (
        <details className="group">
          <summary className="text-[9px] text-eve-dim uppercase tracking-widest cursor-pointer select-none hover:text-eve-muted">
            Mission Briefing
          </summary>
          <p className="mt-1.5 text-eve-dim text-[10px] leading-relaxed italic">{mission.briefing}</p>
        </details>
      )}
    </div>
  )
}

function MissionDB() {
  const [missions, setMissions] = useState<MissionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [noData, setNoData] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('/missions.json')
      .then(r => {
        if (r.status === 404) { setNoData(true); return null }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { if (data) setMissions(data.missions ?? []) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const q = search.trim().toLowerCase()
  const filtered = missions.filter(m => {
    if (levelFilter && m.level !== levelFilter) return false
    if (q) {
      return m.name.toLowerCase().includes(q) ||
        m.factions.some(f => f.toLowerCase().includes(q)) ||
        (m.type?.toLowerCase().includes(q) ?? false)
    }
    return true
  })

  const LIMIT = 60
  const shown = showAll ? filtered : filtered.slice(0, LIMIT)

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-eve-dim text-xs font-mono">Loading mission database…</div>
  )

  if (noData) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-eve-dim max-w-sm mx-auto text-center">
      <BookOpen size={32} className="opacity-30" />
      <p className="text-xs font-mono text-eve-muted">Mission database not found</p>
      <p className="text-[10px] leading-relaxed">
        Run the scraper once to build it:<br />
        <code className="text-eve-cyan bg-black/30 px-1 rounded">node scripts/scrape-missions.js</code>
      </p>
      <p className="text-[10px] text-eve-dim">Takes ~5 minutes · fetches ~700 missions from EVE University wiki · saves to public/missions.json</p>
    </div>
  )

  if (error) return (
    <div className="flex items-center gap-2 text-eve-red text-xs p-3 eve-panel rounded border border-eve-red/20">
      <AlertCircle size={12} />{error}
    </div>
  )

  return (
    <>
      {/* Search + level filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-eve-dim pointer-events-none" />
          <input
            className="eve-input w-full text-xs py-1 pl-7 pr-6"
            placeholder="Search mission name or faction…"
            value={search}
            onChange={e => { setSearch(e.target.value); setShowAll(false); setExpandedId(null) }}
          />
          {search && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-eve-dim hover:text-eve-text"
              onClick={() => setSearch('')}><X size={10} /></button>
          )}
        </div>
        <div className="flex gap-1">
          {[null, 1, 2, 3, 4, 5].map(l => (
            <button
              key={l ?? 'all'}
              onClick={() => { setLevelFilter(l); setShowAll(false); setExpandedId(null) }}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                levelFilter === l
                  ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10'
                  : 'border-eve-border text-eve-dim hover:text-eve-muted hover:border-eve-muted'
              }`}
            >
              {l === null ? 'ALL' : `L${l}`}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-eve-dim font-mono shrink-0">
          {filtered.length.toLocaleString()} missions
        </span>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto space-y-px">
        {shown.length === 0 && (
          <div className="text-center text-eve-dim text-xs font-mono py-8">No missions match your search</div>
        )}
        {shown.map(m => {
          const isOpen = expandedId === m.id
          return (
            <div key={m.id} className="border border-eve-border/30 rounded overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-eve-border/10 transition-colors text-left"
                onClick={() => setExpandedId(isOpen ? null : m.id)}
              >
                {isOpen
                  ? <ChevronDown size={11} className="text-eve-dim shrink-0" />
                  : <ChevronRight size={11} className="text-eve-dim shrink-0" />}
                <LevelBadge level={m.level} />
                <span className="text-eve-text text-xs font-mono flex-1 min-w-0 truncate">{m.name}</span>
                <span className="text-eve-dim text-[10px] font-mono hidden sm:block shrink-0 max-w-[200px] truncate">
                  {m.factions.join(' · ')}
                </span>
                <div className="flex gap-1 ml-2 shrink-0">
                  {(m.damageDeal || factionDmg(m.factions).deal)?.split(/[/,]/).slice(0, 2).map(t => (
                    <span key={t} className={`text-[8px] px-1 rounded border ${dmgClass(t)}`}>{t.trim()}</span>
                  ))}
                  {m.extras.some(e => e.type === 'web') && (
                    <span className="text-[8px] px-1 rounded border border-orange-500/50 text-orange-300">WEB</span>
                  )}
                  {m.extras.some(e => e.type === 'neut') && (
                    <span className="text-[8px] px-1 rounded border border-red-400/50 text-red-300">NEUT</span>
                  )}
                </div>
              </button>
              {isOpen && <div className="px-2 pb-2"><MissionDetail mission={m} /></div>}
            </div>
          )
        })}
        {!showAll && filtered.length > LIMIT && (
          <button
            className="w-full py-2 text-[10px] text-eve-dim hover:text-eve-muted font-mono border border-eve-border/30 rounded transition-colors"
            onClick={() => setShowAll(true)}
          >
            Show {filtered.length - LIMIT} more results
          </button>
        )}
      </div>
    </>
  )
}

// ── PVE Panel (tab orchestrator) ──────────────────────────────────────────────

type PveTab = 'lp' | 'missions'

export default function PVEPanel({ characters }: Props) {
  const [tab, setTab] = useState<PveTab>('lp')

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Panel header + tabs */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Shield size={14} className="text-eve-cyan" />
          <span className="text-xs font-mono text-eve-cyan tracking-widest uppercase">PVE</span>
        </div>
        <div className="flex gap-1">
          {([['lp', 'LP Store'], ['missions', 'Mission DB']] as [PveTab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`text-[10px] font-mono px-3 py-1 rounded border transition-colors ${
                tab === id
                  ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10'
                  : 'border-eve-border text-eve-dim hover:text-eve-muted hover:border-eve-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — both mounted, hidden via CSS to preserve state */}
      <div className={`flex flex-col flex-1 gap-3 min-h-0 ${tab === 'lp' ? '' : 'hidden'}`}>
        <LPStore characters={characters} />
      </div>
      <div className={`flex flex-col flex-1 gap-3 min-h-0 ${tab === 'missions' ? '' : 'hidden'}`}>
        <MissionDB />
      </div>
    </div>
  )
}

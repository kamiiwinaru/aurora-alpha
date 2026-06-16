import { useState } from 'react'
import { Shield, RefreshCw, ChevronDown, ChevronRight, ChevronUp, AlertCircle } from 'lucide-react'
import type { EveCharacter } from '../../types'

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

interface Props {
  characters: EveCharacter[]
}

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

type SortKey = 'name' | 'corp' | 'runs' | 'lp_cost' | 'isk_cost' | 'sell' | 'net' | 'isk_per_lp'
type SortDir = 'asc' | 'desc'

function SortTh({ label, col, sort, onSort, className = '' }: {
  label: string
  col: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (col: SortKey) => void
  className?: string
}) {
  const active = sort.key === col
  return (
    <th
      className={`py-1.5 pr-3 font-normal cursor-pointer select-none whitespace-nowrap group ${className}`}
      onClick={() => onSort(col)}
    >
      <span className={`inline-flex items-center gap-0.5 ${active ? 'text-eve-cyan' : 'text-eve-dim group-hover:text-eve-muted'}`}>
        {label}
        {active
          ? sort.dir === 'desc' ? <ChevronDown size={9} /> : <ChevronUp size={9} />
          : <ChevronDown size={9} className="opacity-0 group-hover:opacity-40" />
        }
      </span>
    </th>
  )
}

function OffersTable({ rows, topHighlight, expandedOffer, setExpandedOffer }: {
  rows: RankedOffer[]
  topHighlight: boolean
  expandedOffer: number | null
  setExpandedOffer: (id: number | null) => void
}) {
  const [runOverrides, setRunOverrides] = useState<Record<number, number>>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'isk_per_lp', dir: 'desc' })

  function getRuns(row: RankedOffer): number {
    if (runOverrides[row.offer_id] !== undefined) return runOverrides[row.offer_id]
    return row.lp_cost > 0 ? Math.floor(row.lp_balance / row.lp_cost) : 1
  }

  function onSort(col: SortKey) {
    setSort(prev => prev.key === col
      ? { key: col, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { key: col, dir: col === 'name' || col === 'corp' ? 'asc' : 'desc' }
    )
  }

  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'desc' ? -1 : 1
    switch (sort.key) {
      case 'name':      return dir * a.type_name.localeCompare(b.type_name)
      case 'corp':      return dir * a.corp_name.localeCompare(b.corp_name)
      case 'runs':      return dir * (Math.floor(a.lp_balance / a.lp_cost) - Math.floor(b.lp_balance / b.lp_cost))
      case 'lp_cost':   return dir * (a.lp_cost - b.lp_cost)
      case 'isk_cost':  return dir * (a.isk_cost - b.isk_cost)
      case 'sell':      return dir * (a.sell_price - b.sell_price)
      case 'net':       return dir * (a.net_isk - b.net_isk)
      case 'isk_per_lp':return dir * (a.isk_per_lp - b.isk_per_lp)
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
          const iskPerLpColor = row.isk_per_lp >= 1500 ? 'text-eve-green' : row.isk_per_lp >= 700 ? 'text-eve-gold' : 'text-eve-muted'
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
                <td className="py-1.5 pr-1 text-eve-dim">
                  {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </td>
                <td className="py-1.5 pr-3 text-eve-text">
                  {row.type_name}
                  {row.quantity > 1 && <span className="text-eve-dim ml-1">×{row.quantity}</span>}
                  {isTop && i < 3 && <span className="ml-1.5 text-[9px] text-eve-cyan border border-eve-cyan/40 px-1 rounded">TOP</span>}
                </td>
                <td className="py-1.5 pr-3 text-eve-muted hidden lg:table-cell truncate max-w-[140px]">{row.corp_name}</td>
                {topHighlight && (
                  <td className="py-1 pr-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="w-4 h-4 flex items-center justify-center text-eve-dim hover:text-eve-text border border-eve-border rounded leading-none"
                        onClick={() => setRunOverrides(r => ({ ...r, [row.offer_id]: Math.max(1, (r[row.offer_id] ?? maxRuns) - 1) }))}
                      >−</button>
                      <span className="w-7 text-center text-eve-gold">{runs}</span>
                      <button
                        className="w-4 h-4 flex items-center justify-center text-eve-dim hover:text-eve-text border border-eve-border rounded leading-none"
                        onClick={() => setRunOverrides(r => ({ ...r, [row.offer_id]: Math.min(maxRuns, (r[row.offer_id] ?? maxRuns) + 1) }))}
                      >+</button>
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
                <td className={`py-1.5 text-right font-bold ${iskPerLpColor}`}>{fmtIsk(row.isk_per_lp)}</td>
              </tr>
              {isExpanded && (
                <tr key={`${row.offer_id}-detail`} className="border-b border-eve-border/40">
                  <td />
                  <td colSpan={colSpanDetail} className="pb-2 pt-1 pr-3">
                    <div className="bg-eve-border/10 rounded p-2 space-y-1">
                      <div className="flex gap-6 text-eve-dim text-[10px] flex-wrap">
                        <span>LP available: <span className="text-eve-gold">{fmtLp(row.lp_balance)}</span></span>
                        {topHighlight
                          ? <span>Per run: sell <span className="text-eve-text">{fmtIsk(row.sell_price)}</span> · net <span className="text-eve-text">{fmtIsk(row.net_isk)}</span></span>
                          : <span>LP needed: <span className="text-eve-red">{fmtLp(lpShortfall)} more</span></span>
                        }
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

export default function PVEPanel({ characters }: Props) {
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
    setScanning(true)
    setError(null)
    setResults([])
    setBalances([])
    setNoApiKey(false)
    setFilterCorp(null)
    try {
      const r = await fetch('/api/lp/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    <div className="flex flex-col h-full gap-3">
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-eve-cyan" />
          <span className="text-xs font-mono text-eve-cyan tracking-widest uppercase">PVE</span>
          <span className="text-eve-dim text-xs font-mono">/ LP Store</span>
        </div>

        {characters.length > 1 && (
          <select
            className="eve-input text-xs py-0.5 px-2"
            value={char?.characterId ?? ''}
            onChange={e => {
              const found = characters.find(c => c.characterId === Number(e.target.value))
              if (found) setActiveChar(found)
            }}
          >
            {characters.map(c => (
              <option key={c.characterId} value={c.characterId}>{c.characterName}</option>
            ))}
          </select>
        )}

        {/* Corp filter dropdown — only shown after a scan */}
        {balances.length > 0 && (
          <select
            className="eve-input text-xs py-0.5 px-2"
            value={filterCorp ?? ''}
            onChange={e => setFilterCorp(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">All Corps</option>
            {balances.map(b => (
              <option key={b.corporation_id} value={b.corporation_id}>
                {b.corp_name} — {fmtLp(b.loyalty_points)} LP
              </option>
            ))}
          </select>
        )}

        <button
          className="eve-btn-primary text-xs px-3 py-1 flex items-center gap-1.5 ml-auto"
          onClick={runScan}
          disabled={scanning || !char}
        >
          <RefreshCw size={11} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Analyzing…' : 'Analyze LP Stores'}
        </button>
      </div>

      {/* Error / no-api-key states */}
      {error && (
        <div className="flex items-center gap-2 text-eve-red text-xs p-3 eve-panel rounded border border-eve-red/20">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {noApiKey && (
        <div className="flex items-center gap-2 text-eve-gold text-xs p-3 eve-panel rounded border border-eve-gold/20">
          <AlertCircle size={12} />
          Janice API key not configured — ISK pricing unavailable. Add JANICE_API_KEY to your .env to enable LP store analysis.
        </div>
      )}

      {/* Empty states */}
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

      {/* Results */}
      {(affordable.length > 0 || future.length > 0) && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Affordable — actionable now */}
          {affordable.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-eve-cyan tracking-widest uppercase mb-1.5">
                Redeemable Now — {affordable.length} offers{selectedCorpName ? ` · ${selectedCorpName}` : ''}
              </p>
              <OffersTable rows={affordable} topHighlight expandedOffer={expandedOffer} setExpandedOffer={setExpandedOffer} />
            </div>
          )}

          {/* Future — need more LP */}
          {future.length > 0 && (
            <div>
              <button
                className="flex items-center gap-2 text-[10px] font-mono text-eve-dim tracking-widest uppercase mb-1.5 hover:text-eve-muted transition-colors"
                onClick={() => setShowFuture(v => !v)}
              >
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
    </div>
  )
}

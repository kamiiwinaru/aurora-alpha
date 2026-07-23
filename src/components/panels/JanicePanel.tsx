import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus, Copy, Check, Truck, X, BarChart2, ShoppingCart, Tag, Clock, Loader } from 'lucide-react'
import { Percent } from 'lucide-react'
import { formatISK } from '../../lib/eve-esi'
import FloatingChartWindow from './FloatingChartWindow'

const MARKETS: { label: string; id: number }[] = [
  { label: 'Jita',    id: 2 },
  { label: 'Amarr',   id: 115 },
  { label: 'Dodixie', id: 117 },
  { label: 'Rens',    id: 116 },
  { label: 'Hek',     id: 118 },
]

interface AppraisalItem {
  name: string
  typeId: number | null
  quantity: number
  volume?: number
  prices?: { buy: { max: number }; sell: { min: number }; split: { price: number } }
  sellOrderCount?: number
  sellVolume?: number
  buyOrderCount?: number
  buyVolume?: number
}

interface AppraisalResult {
  noApiKey?: boolean
  apiError?: string
  effectivePrices?: { totalBuyPrice: number; totalSellPrice: number; totalSplitPrice: number }
  immediatePrices?: { totalBuyPrice: number; totalSellPrice: number; totalSplitPrice: number }
  items?: AppraisalItem[]
  code?: string
  totalVolume?: number
}

interface JanicePanelProps {
  onSendToFreight?: (collateral: number, volume: number) => void
  preloadText?: string | null
  onPreloadConsumed?: () => void
}

type ActiveTab = 'appraisal' | 'sell-analysis'

type Liquidity = 'fast' | 'moderate' | 'slow' | 'stale' | 'unknown'

interface AnalysisRow {
  name: string
  qty: number
  immediateNet: number
  sellOrderNet: number
  diff: number
  profit: number
  avgDailyVol: number
  daysToSell: number
  liquidity: Liquidity
  rec: 'immediate' | 'sell-order' | 'sell-order-slow'
  undercut: number | null
}

function liquidityLabel(l: Liquidity): { text: string; color: string } {
  switch (l) {
    case 'fast':     return { text: 'FAST',     color: 'text-eve-green' }
    case 'moderate': return { text: 'MODERATE', color: 'text-eve-cyan' }
    case 'slow':     return { text: 'SLOW',     color: 'text-eve-gold' }
    case 'stale':    return { text: 'STALE',    color: 'text-eve-red' }
    default:         return { text: '—',        color: 'text-eve-dim' }
  }
}

function daysLabel(days: number): string {
  if (!isFinite(days) || days <= 0) return '—'
  if (days < 1) return '< 1 day'
  if (days < 2) return '~1 day'
  if (days < 30) return `~${Math.round(days)}d`
  return `${Math.round(days / 30)}mo+`
}

export default function JanicePanel({ onSendToFreight, preloadText, onPreloadConsumed }: JanicePanelProps) {
  const [input, setInput] = useState('')
  const [market, setMarket] = useState(2)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AppraisalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [pricePercent, setPricePercent] = useState(100)
  const [activeTab, setActiveTab] = useState<ActiveTab>('appraisal')
  const [salesTax, setSalesTax] = useState(3.6)
  const [brokerFee, setBrokerFee] = useState(2.0)
  const [minSellValue, setMinSellValue] = useState(0)
  const [dailyVolMap, setDailyVolMap] = useState<Record<string, number>>({})
  const [copiedRow, setCopiedRow] = useState<number | null>(null)
  const [sortCol, setSortCol] = useState<'name' | 'immediate' | 'sellOrder' | 'profit' | 'days' | 'undercut'>('profit')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [volLoading, setVolLoading] = useState(false)

  useEffect(() => {
    if (!preloadText) return
    setInput(preloadText)
    onPreloadConsumed?.()
    appraise(preloadText)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadText])

  const appraise = async (overrideText?: string | null, overrideMarket?: number) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!text) return
    setLoading(true)
    setError(null)
    setResult(null)
    setDailyVolMap({})

    try {
      const res = await fetch('/api/janice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: text, market: overrideMarket ?? market }),
      })
      const data: AppraisalResult = await res.json()
      if ((data as { error?: string }).error) throw new Error((data as { error?: string }).error)
      setResult(data)
      setDailyVolMap({})
      setPricePercent(100)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Appraisal failed')
    } finally {
      setLoading(false)
    }
  }

  // Fetch daily volume whenever sell-analysis tab is active and result/market changes
  useEffect(() => {
    if (activeTab !== 'sell-analysis' || !result?.items?.length) return
    const typeIds = result.items.map(i => i.typeId).filter(id => id != null) as number[]
    if (!typeIds.length) return
    const marketLabel = MARKETS.find(m => m.id === market)?.label ?? 'Jita'
    const controller = new AbortController()
    setVolLoading(true)
    setDailyVolMap({})
    fetch(`/api/market/history/batch?typeIds=${typeIds.join(',')}&market=${encodeURIComponent(marketLabel)}`, { signal: controller.signal })
      .then(r => r.json())
      .then((data: Record<string, number>) => setDailyVolMap(data))
      .catch(() => {})
      .finally(() => setVolLoading(false))
    return () => controller.abort()
  }, [activeTab, result, market])

  const openJanice = () => window.open(`https://janice.e-351.com`, '_blank')

  const copyItems = async () => {
    await navigator.clipboard.writeText(input.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    openJanice()
  }

  const rawTotals = result?.effectivePrices ?? result?.immediatePrices
  const multiplier = pricePercent / 100
  const totals = rawTotals ? {
    totalBuyPrice: rawTotals.totalBuyPrice * multiplier,
    totalSplitPrice: rawTotals.totalSplitPrice * multiplier,
    totalSellPrice: rawTotals.totalSellPrice * multiplier,
  } : undefined
  const items = result?.items ?? []
  const noKey = result?.noApiKey

  // Sell analysis calculations
  const stFrac = salesTax / 100
  const bfFrac = brokerFee / 100
  const analysisRows: AnalysisRow[] = items
    .filter(it => it.prices?.buy?.max || it.prices?.sell?.min)
    .map(it => {
      const qty = it.quantity ?? 1
      const buyGross = (it.prices?.buy?.max ?? 0) * qty
      const sellGross = (it.prices?.sell?.min ?? 0) * qty
      const immediateNet = buyGross * (1 - stFrac)
      const sellOrderNet = sellGross * (1 - stFrac - bfFrac)
      const diff = sellOrderNet - immediateNet
      const profit = diff

      const avgDailyVol = it.typeId != null ? (dailyVolMap[String(it.typeId)] ?? -1) : -1
      // Days to sell: conservatively assume you capture ~20% of daily volume
      // (other sellers compete; you need to undercut to move items)
      const daysToSell = avgDailyVol > 0 ? qty / (avgDailyVol * 0.2) : Infinity

      let liquidity: Liquidity = 'unknown'
      if (avgDailyVol >= 0) {
        if (daysToSell < 2)       liquidity = 'fast'
        else if (daysToSell < 7)  liquidity = 'moderate'
        else if (daysToSell < 30) liquidity = 'slow'
        else                       liquidity = 'stale'
      }

      // Recommendation:
      // sell order is only worth it if: gain is meaningful AND item will realistically sell
      let rec: AnalysisRow['rec']
      const gainPct = immediateNet > 0 ? (profit / immediateNet) * 100 : 0
      if (gainPct < 2 || liquidity === 'stale' || sellOrderNet < minSellValue) {
        rec = 'immediate'
      } else if (liquidity === 'slow') {
        rec = diff > 0 ? 'sell-order-slow' : 'immediate'
      } else {
        rec = diff > 0 ? 'sell-order' : 'immediate'
      }

      const sellMin = it.prices?.sell?.min ?? 0
      const undercut = sellMin > 0 ? Math.max(0.01, sellMin - 0.01) : null

      return { name: it.name, qty, immediateNet, sellOrderNet, diff, profit, avgDailyVol, daysToSell, liquidity, rec, undercut }
    })

  const sortedRows = [...analysisRows].sort((a, b) => {
    let v = 0
    switch (sortCol) {
      case 'name':      v = a.name.localeCompare(b.name); break
      case 'immediate': v = a.immediateNet - b.immediateNet; break
      case 'sellOrder': v = a.sellOrderNet - b.sellOrderNet; break
      case 'profit':    v = a.profit - b.profit; break
      case 'days':      v = (isFinite(a.daysToSell) ? a.daysToSell : 9999) - (isFinite(b.daysToSell) ? b.daysToSell : 9999); break
      case 'undercut':  v = (a.undercut ?? 0) - (b.undercut ?? 0); break
    }
    return sortDir === 'asc' ? v : -v
  })

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const totalImmediateNet = analysisRows.reduce((s, r) => s + r.immediateNet, 0)
  const totalSellOrderNet = analysisRows.reduce((s, r) => s + r.sellOrderNet, 0)
  const totalDiff = totalSellOrderNet - totalImmediateNet

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="eve-header mb-0">ITEM APPRAISAL</div>
            <div className="text-eve-dim text-[9px] tracking-widest mt-0.5">POWERED BY JANICE.E-351.COM</div>
          </div>
          {result && !noKey && (
            <div className="flex border border-eve-border">
              <button
                onClick={() => setActiveTab('appraisal')}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1
                  ${activeTab === 'appraisal' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
              >
                <BarChart2 size={9} />PRICES
              </button>
              <button
                onClick={() => setActiveTab('sell-analysis')}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1
                  ${activeTab === 'sell-analysis' ? 'bg-eve-gold/10 text-eve-gold' : 'text-eve-muted hover:text-eve-text'}`}
              >
                <Tag size={9} />SELL ANALYSIS
              </button>
            </div>
          )}
        </div>
        <button onClick={openJanice} className="eve-btn flex items-center gap-1.5 text-[10px]">
          <ExternalLink size={10} />OPEN JANICE
        </button>
      </div>

      {/* Input */}
      <div className="eve-panel p-3 flex flex-col gap-2 flex-shrink-0">
        <div className="eve-label">PASTE ITEMS</div>
        <textarea
          className="eve-input resize-none text-xs leading-relaxed"
          rows={6}
          placeholder={'Tritanium 100000\nMegacyte 500\nRaven Blueprint\nFederation Navy Comet x3'}
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex border border-eve-border">
            {MARKETS.map(m => (
              <button
                key={m.id}
                onClick={() => { setMarket(m.id); if (input.trim()) appraise(undefined, m.id) }}
                className={`px-2 py-1 text-[10px] uppercase tracking-widest transition-colors
                  ${market === m.id ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 ml-auto items-center">
            <button
              onClick={() => appraise()}
              disabled={loading || !input.trim()}
              className="eve-btn-primary flex items-center gap-1.5 disabled:opacity-40"
            >
              {loading ? <RefreshCw size={11} className="animate-spin" /> : <Search size={11} />}
              <span>{loading ? 'APPRAISING...' : 'APPRAISE'}</span>
            </button>
            <button
              onClick={() => { setInput(''); setResult(null); setError(null) }}
              disabled={!input.trim() && !result}
              className="eve-btn flex items-center gap-1.5 disabled:opacity-40"
            >
              <X size={11} />
              <span>CLEAR</span>
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="border border-eve-red/40 bg-eve-red/5 px-3 py-2 text-eve-red text-xs"
          >{error}</motion.div>
        )}
      </AnimatePresence>

      {/* No API key fallback */}
      <AnimatePresence>
        {noKey && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="eve-panel p-4 flex flex-col items-center gap-3 text-center"
          >
            <div className="text-eve-gold text-xs tracking-widest">NO API KEY CONFIGURED</div>
            <div className="text-eve-muted text-xs max-w-xs leading-relaxed">
              Use <span className="text-eve-cyan">COPY &amp; OPEN</span> to copy items to clipboard, then paste into Janice.
              Or add a <span className="font-mono text-eve-text">JANICE_API_KEY</span> to <span className="font-mono">.env</span> for inline results.
            </div>
            <button onClick={copyItems} className="eve-btn-primary flex items-center gap-2">
              {copied ? <Check size={12} className="text-eve-green" /> : <Copy size={12} />}
              {copied ? 'COPIED — CHECK JANICE TAB' : 'COPY ITEMS & OPEN JANICE'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── APPRAISAL TAB ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {result && !noKey && totals && activeTab === 'appraisal' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">

            <div className="eve-panel px-3 py-2 flex items-center gap-3">
              <Percent size={10} className="text-eve-dim shrink-0" />
              <span className="eve-label text-[9px] shrink-0">PRICE %</span>
              <input type="range" min={50} max={150} step={1} value={pricePercent}
                onChange={e => setPricePercent(Number(e.target.value))}
                className="flex-1 accent-eve-cyan h-1 cursor-pointer" />
              <input type="number" min={1} max={999} value={pricePercent}
                onChange={e => setPricePercent(Math.max(1, Math.min(999, Number(e.target.value) || 100)))}
                className="eve-input w-14 text-xs text-center font-mono py-0.5 px-1" />
              <span className="text-eve-dim text-[10px] shrink-0">%</span>
              {pricePercent !== 100 && (
                <button onClick={() => setPricePercent(100)} className="eve-btn text-[9px] py-0.5 px-1.5 shrink-0">RESET</button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'BUY TOTAL',  value: totals.totalBuyPrice,   color: 'text-eve-orange',           icon: <TrendingDown size={10} /> },
                { label: 'SPLIT TOTAL', value: totals.totalSplitPrice, color: 'text-eve-cyan text-glow-cyan', icon: <Minus size={10} /> },
                { label: 'SELL TOTAL', value: totals.totalSellPrice,   color: 'text-eve-green',            icon: <TrendingUp size={10} /> },
              ].map(stat => (
                <div key={stat.label} className="eve-panel p-2">
                  <div className="flex items-center gap-1 mb-1">
                    <span className={stat.color}>{stat.icon}</span>
                    <span className="eve-label text-[9px]">{stat.label}</span>
                  </div>
                  <div className={`text-sm font-mono ${stat.color}`}>{formatISK(stat.value)}</div>
                  <div className="text-eve-dim text-[9px]">ISK</div>
                </div>
              ))}
              {items.length > 0 && (
                <button onClick={() => setShowChart(v => !v)}
                  className={`eve-panel p-2 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer
                    ${showChart ? 'border-eve-cyan/40 bg-eve-cyan/5' : 'hover:border-eve-border hover:bg-eve-border/10'}`}
                >
                  <BarChart2 size={16} className={showChart ? 'text-eve-cyan' : 'text-eve-dim'} />
                  <span className="eve-label text-[9px]">HISTORY</span>
                </button>
              )}
            </div>

            {showChart && items.length > 0 && (
              <FloatingChartWindow items={items}
                market={MARKETS.find(m => m.id === market)?.label ?? 'Jita'}
                onClose={() => setShowChart(false)} />
            )}

            {result.totalVolume != null && result.totalVolume > 0 && (
              <div className="eve-panel px-3 py-2 flex items-center justify-between">
                <span className="eve-label text-[9px] flex items-center gap-1.5"><Truck size={9} />TOTAL VOLUME</span>
                <span className="text-xs font-mono text-eve-text">
                  {result.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³
                </span>
              </div>
            )}

            <div className="flex gap-2">
              {result.code && (
                <div className="eve-panel flex items-center gap-2 px-2 py-1.5 flex-1 min-w-0">
                  <ExternalLink size={10} className="text-eve-dim shrink-0" />
                  <span className="text-[10px] text-eve-muted font-mono truncate flex-1 select-all">
                    https://janice.e-351.com/a/{result.code}
                  </span>
                  <button onClick={() => {
                    const url = `https://janice.e-351.com/a/${result.code}`
                    try {
                      const ta = document.createElement('textarea')
                      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'
                      document.body.appendChild(ta); ta.select(); document.execCommand('copy')
                      document.body.removeChild(ta)
                    } catch { navigator.clipboard.writeText(url).catch(() => {}) }
                    setCopied(true); setTimeout(() => setCopied(false), 2000)
                  }} className="shrink-0 text-eve-dim hover:text-eve-cyan transition-colors" title="Copy URL">
                    {copied ? <Check size={11} className="text-eve-green" /> : <Copy size={11} />}
                  </button>
                </div>
              )}
              {onSendToFreight && rawTotals && (
                <button onClick={() => onSendToFreight(rawTotals.totalSellPrice, result.totalVolume ?? 0)}
                  className="eve-btn flex items-center gap-2 justify-center py-1.5 flex-1 text-eve-cyan border-eve-cyan/40 hover:bg-eve-cyan/10">
                  <Truck size={11} />SEND TO FREIGHT
                </button>
              )}
            </div>

            {items.length > 0 && (
              <div className="eve-panel p-3 flex-shrink-0">
                <div className="eve-header">ITEM BREAKDOWN ({items.length})</div>
                <div className="grid grid-cols-12 gap-1 text-[9px] text-eve-dim uppercase tracking-widest pb-1 border-b border-eve-border/50 mb-1">
                  <span className="col-span-4">ITEM</span>
                  <span className="col-span-2 text-right">QTY</span>
                  <span className="col-span-2 text-right">VOL M³</span>
                  <span className="col-span-2 text-right">BUY</span>
                  <span className="col-span-2 text-right">SELL</span>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-1 py-1 border-b border-eve-border/20 hover:bg-eve-border/10 transition-colors">
                      <span className="col-span-4 text-eve-text text-xs truncate">{item.name}</span>
                      <span className="col-span-2 text-right text-eve-muted text-xs">{(item.quantity ?? 1).toLocaleString()}</span>
                      <span className="col-span-2 text-right text-eve-dim text-xs font-mono">
                        {item.volume != null ? item.volume.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                      </span>
                      <span className="col-span-2 text-right text-eve-orange text-xs font-mono">
                        {item.prices?.buy?.max ? formatISK(item.prices.buy.max * (item.quantity ?? 1)) : '—'}
                      </span>
                      <span className="col-span-2 text-right text-eve-green text-xs font-mono">
                        {item.prices?.sell?.min ? formatISK(item.prices.sell.min * (item.quantity ?? 1)) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SELL ANALYSIS TAB ────────────────────────────────────────────── */}
      <AnimatePresence>
        {result && !noKey && activeTab === 'sell-analysis' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">

            {/* Fee inputs */}
            <div className="eve-panel px-3 py-2 flex items-center gap-4 flex-wrap">
              <span className="eve-label text-[9px] shrink-0">FEES</span>
              <label className="flex items-center gap-2">
                <span className="text-eve-dim text-[10px]">Sales Tax</span>
                <input type="number" min={0} max={20} step={0.1} value={salesTax}
                  onChange={e => setSalesTax(Math.max(0, Math.min(20, parseFloat(e.target.value) || 0)))}
                  className="eve-input w-16 text-xs text-center font-mono py-0.5 px-1" />
                <span className="text-eve-dim text-[10px]">%</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-eve-dim text-[10px]">Broker Fee</span>
                <input type="number" min={0} max={10} step={0.1} value={brokerFee}
                  onChange={e => setBrokerFee(Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)))}
                  className="eve-input w-16 text-xs text-center font-mono py-0.5 px-1" />
                <span className="text-eve-dim text-[10px]">%</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-eve-dim text-[10px] whitespace-nowrap">Min List Value</span>
                <input type="number" min={0} step={100000} value={minSellValue}
                  onChange={e => setMinSellValue(Math.max(0, parseInt(e.target.value) || 0))}
                  className="eve-input w-24 text-xs text-center font-mono py-0.5 px-1" />
                <span className="text-eve-dim text-[10px]">ISK</span>
              </label>
              {volLoading && (
                <span className="ml-auto flex items-center gap-1 text-eve-dim text-[9px]">
                  <Loader size={9} className="animate-spin" />FETCHING VOLUME DATA...
                </span>
              )}
            </div>

            {/* Summary totals */}
            <div className="grid grid-cols-3 gap-2">
              <div className="eve-panel p-2">
                <div className="flex items-center gap-1 mb-1">
                  <ShoppingCart size={9} className="text-eve-orange" />
                  <span className="eve-label text-[9px]">IMMEDIATE NET</span>
                </div>
                <div className="text-sm font-mono text-eve-orange">{formatISK(totalImmediateNet)}</div>
                <div className="text-eve-dim text-[9px]">after {salesTax}% tax</div>
              </div>
              <div className="eve-panel p-2">
                <div className="flex items-center gap-1 mb-1">
                  <Tag size={9} className="text-eve-green" />
                  <span className="eve-label text-[9px]">SELL ORDER NET</span>
                </div>
                <div className="text-sm font-mono text-eve-green">{formatISK(totalSellOrderNet)}</div>
                <div className="text-eve-dim text-[9px]">after {salesTax}% tax + {brokerFee}% broker</div>
              </div>
              <div className="eve-panel p-2">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingUp size={9} className={totalDiff >= 0 ? 'text-eve-green' : 'text-eve-red'} />
                  <span className="eve-label text-[9px]">SELL ORDER GAIN</span>
                </div>
                <div className={`text-sm font-mono ${totalDiff >= 0 ? 'text-eve-green' : 'text-eve-red'}`}>
                  {totalDiff >= 0 ? '+' : ''}{formatISK(totalDiff)}
                </div>
                <div className="text-eve-dim text-[9px]">vs immediate sell</div>
              </div>
            </div>

            {/* Per-item table */}
            {analysisRows.length > 0 && (
              <div className="eve-panel p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="eve-header mb-0">PER-ITEM ANALYSIS</div>
                  {!volLoading && Object.keys(dailyVolMap).length > 0 && (
                    <span className="text-eve-dim text-[9px] flex items-center gap-1">
                      <Clock size={8} />est. days based on 20% of 30d avg volume
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-12 gap-1 pb-1 border-b border-eve-border/50 mb-1">
                  {([
                    { col: 'name',      label: 'ITEM',      span: 2, align: 'text-left' },
                    { col: 'immediate', label: 'IMMEDIATE',  span: 2, align: 'text-right' },
                    { col: 'sellOrder', label: 'SELL ORDER', span: 2, align: 'text-right' },
                    { col: 'profit',    label: 'PROFIT',     span: 1, align: 'text-right' },
                    { col: 'days',      label: 'DAYS',       span: 1, align: 'text-center' },
                    { col: null,        label: 'REC',        span: 2, align: 'text-center' },
                    { col: 'undercut',  label: 'UNDERCUT',   span: 2, align: 'text-right' },
                  ] as const).map(({ col, label, span, align }) => (
                    <button
                      key={label}
                      onClick={() => col && toggleSort(col)}
                      className={`col-span-${span} ${align} text-[9px] uppercase tracking-widest transition-colors flex items-center gap-0.5
                        ${col ? 'cursor-pointer hover:text-eve-text' : 'cursor-default'}
                        ${col && sortCol === col ? 'text-eve-cyan' : 'text-eve-dim'}`}
                      style={{ justifyContent: align === 'text-right' ? 'flex-end' : align === 'text-center' ? 'center' : 'flex-start' }}
                    >
                      {label}
                      {col && sortCol === col && <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  ))}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {sortedRows.map((row, i) => {
                    const liq = liquidityLabel(row.liquidity)
                    const copyUndercut = () => {
                      if (row.undercut == null) return
                      const val = row.undercut.toFixed(2)
                      try {
                        const ta = document.createElement('textarea')
                        ta.value = val; ta.style.position = 'fixed'; ta.style.opacity = '0'
                        document.body.appendChild(ta); ta.select(); document.execCommand('copy')
                        document.body.removeChild(ta)
                      } catch { navigator.clipboard.writeText(val).catch(() => {}) }
                      setCopiedRow(i)
                    }
                    return (
                      <div key={i} className={`grid grid-cols-12 gap-1 py-1 border-b border-eve-border/20 transition-colors items-center
                        ${copiedRow === i || copiedRow === i + 10000 ? 'bg-eve-cyan/10 border-eve-cyan/20' : 'hover:bg-eve-border/10'}`}>
                        <button
                          onClick={() => {
                            try {
                              const ta = document.createElement('textarea')
                              ta.value = row.name; ta.style.position = 'fixed'; ta.style.opacity = '0'
                              document.body.appendChild(ta); ta.select(); document.execCommand('copy')
                              document.body.removeChild(ta)
                            } catch { navigator.clipboard.writeText(row.name).catch(() => {}) }
                            setCopiedRow(i + 10000)
                          }}
                          className="col-span-2 text-left text-eve-text text-xs truncate hover:text-eve-cyan transition-colors flex items-center gap-1 min-w-0"
                          title={`${row.name} — click to copy`}
                        >
                          <span className="truncate">{row.name}</span>
                          {copiedRow === i + 10000
                            ? <Check size={9} className="text-eve-green shrink-0" />
                            : <Copy size={9} className="shrink-0 opacity-30" />}
                        </button>
                        <span className="col-span-2 text-right text-eve-orange text-xs font-mono">{formatISK(row.immediateNet)}</span>
                        <span className="col-span-2 text-right text-eve-green text-xs font-mono">{formatISK(row.sellOrderNet)}</span>
                        <span className={`col-span-1 text-right text-xs font-mono ${row.profit > 0 ? 'text-eve-green' : 'text-eve-red'}`}>
                          {row.profit >= 0 ? '+' : ''}{formatISK(row.profit)}
                        </span>
                        <span className={`col-span-1 text-center text-[10px] font-mono ${liq.color}`}>
                          {volLoading ? '…' : row.liquidity === 'unknown' ? '—' : daysLabel(row.daysToSell)}
                        </span>
                        <span className="col-span-2 flex justify-center">
                          {row.rec === 'sell-order' ? (
                            <span className="flex items-center gap-1 px-1 py-0.5 bg-eve-green/10 border border-eve-green/30 text-eve-green text-[9px] uppercase tracking-widest whitespace-nowrap">
                              <Tag size={8} />ORDER
                            </span>
                          ) : row.rec === 'sell-order-slow' ? (
                            <span className="flex items-center gap-1 px-1 py-0.5 bg-eve-gold/10 border border-eve-gold/30 text-eve-gold text-[9px] uppercase tracking-widest whitespace-nowrap">
                              <Tag size={8} />ORDER*
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 px-1 py-0.5 bg-eve-orange/10 border border-eve-orange/30 text-eve-orange text-[9px] uppercase tracking-widest whitespace-nowrap">
                              <ShoppingCart size={8} />NOW
                            </span>
                          )}
                        </span>
                        <span className="col-span-2 flex items-center justify-end gap-1">
                          {row.undercut != null ? (
                            <button
                              onClick={copyUndercut}
                              className="flex items-center gap-1 text-[10px] font-mono text-eve-cyan hover:text-eve-text transition-colors"
                              title="Copy undercut price"
                            >
                              <span>{row.undercut.toFixed(2)}</span>
                              {copiedRow === i
                                ? <Check size={9} className="text-eve-green shrink-0" />
                                : <Copy size={9} className="shrink-0 opacity-50" />}
                            </button>
                          ) : <span className="text-eve-dim text-xs">—</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {analysisRows.some(r => r.rec === 'sell-order-slow') && (
                  <div className="mt-2 text-[9px] text-eve-dim">* SELL ORDER (SLOW) — profitable but expect {'>'}7 days to clear</div>
                )}
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
          <div className="text-eve-cyan/20 text-4xl">◈</div>
          <div className="text-eve-muted text-xs">Paste items above to appraise against {MARKETS.find(m => m.id === market)?.label ?? market} market prices</div>
        </div>
      )}
    </div>
  )
}

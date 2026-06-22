import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus, Copy, Check, Truck, X, BarChart2 } from 'lucide-react'
import { formatISK } from '../../lib/eve-esi'
import FloatingChartWindow from './FloatingChartWindow'

const MARKETS = ['Jita', 'Amarr', 'Dodixie', 'Rens', 'Hek']

interface AppraisalItem {
  name: string
  typeId: number | null
  quantity: number
  volume?: number
  prices?: { buy: { max: number }; sell: { min: number }; split: { price: number } }
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

export default function JanicePanel({ onSendToFreight, preloadText, onPreloadConsumed }: JanicePanelProps) {
  const [input, setInput] = useState('')
  const [market, setMarket] = useState('Jita')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AppraisalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showChart, setShowChart] = useState(false)

  useEffect(() => {
    if (!preloadText) return
    setInput(preloadText)
    onPreloadConsumed?.()
    appraise(preloadText)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadText])

  const appraise = async (overrideText?: string | null) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!text) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/janice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: text, market }),
      })
      const data: AppraisalResult = await res.json()
      if ((data as { error?: string }).error) throw new Error((data as { error?: string }).error)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Appraisal failed')
    } finally {
      setLoading(false)
    }
  }

  const openJanice = () => window.open(`https://janice.e-351.com`, '_blank')

  const copyItems = async () => {
    await navigator.clipboard.writeText(input.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    openJanice()
  }

  const totals = result?.effectivePrices ?? result?.immediatePrices
  const items = result?.items ?? []
  const noKey = result?.noApiKey

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="eve-header mb-0">ITEM APPRAISAL</div>
          <div className="text-eve-dim text-[9px] tracking-widest mt-0.5">POWERED BY JANICE.E-351.COM</div>
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
                key={m}
                onClick={() => setMarket(m)}
                className={`px-2 py-1 text-[10px] uppercase tracking-widest transition-colors
                  ${market === m ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={copyItems}
              disabled={!input.trim()}
              className="eve-btn flex items-center gap-1.5 disabled:opacity-40"
            >
              {copied ? <Check size={11} className="text-eve-green" /> : <Copy size={11} />}
              <span>{copied ? 'COPIED!' : 'COPY & OPEN'}</span>
            </button>
            <button
              onClick={appraise}
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

      {/* Results */}
      <AnimatePresence>
        {result && !noKey && totals && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">

            {/* Stat cards — 3 prices + chart toggle */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'BUY TOTAL', value: totals.totalBuyPrice, color: 'text-eve-orange', icon: <TrendingDown size={10} /> },
                { label: 'SPLIT TOTAL', value: totals.totalSplitPrice, color: 'text-eve-cyan text-glow-cyan', icon: <Minus size={10} /> },
                { label: 'SELL TOTAL', value: totals.totalSellPrice, color: 'text-eve-green', icon: <TrendingUp size={10} /> },
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
              {/* Chart pop-out button */}
              {items.length > 0 && (
                <button
                  onClick={() => setShowChart(v => !v)}
                  className={`eve-panel p-2 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer
                    ${showChart ? 'border-eve-cyan/40 bg-eve-cyan/5' : 'hover:border-eve-border hover:bg-eve-border/10'}`}
                >
                  <BarChart2 size={16} className={showChart ? 'text-eve-cyan' : 'text-eve-dim'} />
                  <span className="eve-label text-[9px]">HISTORY</span>
                </button>
              )}
            </div>

            {/* Floating chart window */}
            {showChart && items.length > 0 && (
              <FloatingChartWindow
                items={items}
                market={market}
                onClose={() => setShowChart(false)}
              />
            )}

            {result.totalVolume != null && result.totalVolume > 0 && (
              <div className="eve-panel px-3 py-2 flex items-center justify-between">
                <span className="eve-label text-[9px] flex items-center gap-1.5">
                  <Truck size={9} />TOTAL VOLUME
                </span>
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
                  <button
                    onClick={() => {
                      const url = `https://janice.e-351.com/a/${result.code}`
                      try {
                        const ta = document.createElement('textarea')
                        ta.value = url
                        ta.style.position = 'fixed'
                        ta.style.opacity = '0'
                        document.body.appendChild(ta)
                        ta.select()
                        document.execCommand('copy')
                        document.body.removeChild(ta)
                      } catch {
                        navigator.clipboard.writeText(url).catch(() => {})
                      }
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className="shrink-0 text-eve-dim hover:text-eve-cyan transition-colors"
                    title="Copy URL"
                  >
                    {copied ? <Check size={11} className="text-eve-green" /> : <Copy size={11} />}
                  </button>
                </div>
              )}
              {onSendToFreight && totals && (
                <button
                  onClick={() => onSendToFreight(totals.totalSellPrice, result.totalVolume ?? 0)}
                  className="eve-btn flex items-center gap-2 justify-center py-1.5 flex-1 text-eve-cyan border-eve-cyan/40 hover:bg-eve-cyan/10"
                >
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

      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
          <div className="text-eve-cyan/20 text-4xl">◈</div>
          <div className="text-eve-muted text-xs">Paste items above to appraise against {market} market prices</div>
        </div>
      )}
    </div>
  )
}

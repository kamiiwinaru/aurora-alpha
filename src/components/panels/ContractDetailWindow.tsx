import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Package, X, Cpu, ChevronDown, ChevronUp } from 'lucide-react'
import type { EveContract, EveCharacter } from '../../types'
import { resolveIds, getContractItems, getContractBids } from '../../lib/eve-esi'

// ── Shared helpers (also used by LandingPage — keep in sync) ──────────────────
export const CONTRACT_TYPE_ABBR: Record<string, string> = {
  item_exchange: 'ITEM EX',
  auction:       'AUCTION',
  courier:       'COURIER',
  loan:          'LOAN',
}

export const CONTRACT_STATUS_COLOR: Record<string, string> = {
  outstanding:          'text-eve-cyan',
  in_progress:          'text-eve-gold',
  finished:             'text-eve-green',
  finished_issuer:      'text-eve-green',
  finished_contractor:  'text-eve-green',
  cancelled:            'text-eve-muted',
  deleted:              'text-eve-muted',
  failed:               'text-eve-red',
  reversed:             'text-eve-red',
  rejected:             'text-eve-red',
}

export function contractDaysLeft(dateExpired: string) {
  return Math.ceil((new Date(dateExpired).getTime() - Date.now()) / 86_400_000)
}

// ── Local types ───────────────────────────────────────────────────────────────
interface ContractItem {
  recordId: number
  typeId: number
  typeName: string
  quantity: number
  isIncluded: boolean
  isSingleton: boolean
  rawQuantity?: number
}

interface ContractBid {
  bidId: number
  bidderId: number
  dateBid: string
  amount: number
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ContractDetailWindow({
  contract,
  character,
  onClose,
}: {
  contract: EveContract
  character: EveCharacter
  onClose: () => void
}) {
  const [items, setItems] = useState<ContractItem[]>([])
  const [bids, setBids] = useState<ContractBid[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showBids, setShowBids] = useState(false)

  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(60, window.innerWidth / 2 - 240),
    y: Math.max(60, window.innerHeight / 2 - 220),
  }))
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    dragging.current = true
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.preventDefault()
  }, [pos])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 480, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.current.y)),
      })
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [rawItems, rawBids] = await Promise.allSettled([
          ['item_exchange', 'auction', 'courier'].includes(contract.type)
            ? getContractItems(character.characterId, contract.contractId, character.accessToken)
            : Promise.resolve([]),
          contract.type === 'auction'
            ? getContractBids(character.characterId, contract.contractId, character.accessToken)
            : Promise.resolve([]),
        ])
        if (cancelled) return

        if (rawItems.status === 'fulfilled') {
          const typeIds = [...new Set(rawItems.value.map(i => i.type_id))]
          let nameMap: Record<number, string> = {}
          if (typeIds.length > 0) {
            try { nameMap = await resolveIds(typeIds) } catch { /* names remain blank */ }
          }
          if (!cancelled) setItems(rawItems.value.map(i => ({
            recordId: i.record_id,
            typeId: i.type_id,
            typeName: nameMap[i.type_id] ?? `Type ${i.type_id}`,
            quantity: i.quantity,
            isIncluded: i.is_included,
            isSingleton: i.is_singleton,
            rawQuantity: i.raw_quantity,
          })))
        }

        if (rawBids.status === 'fulfilled' && rawBids.value.length > 0) {
          if (!cancelled) setBids(rawBids.value.map(b => ({
            bidId: b.bid_id,
            bidderId: b.bidder_id,
            dateBid: b.date_bid,
            amount: b.amount,
          })).sort((a, b) => b.amount - a.amount))
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load contract')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [contract.contractId, character.characterId, character.accessToken])

  const daysLeft = contractDaysLeft(contract.dateExpired)
  const typeLabel = CONTRACT_TYPE_ABBR[contract.type] ?? contract.type.replace(/_/g, ' ').toUpperCase()
  const statusColor = CONTRACT_STATUS_COLOR[contract.status] ?? 'text-eve-muted'
  const included = items.filter(i => i.isIncluded)
  const excluded = items.filter(i => !i.isIncluded)

  function iskFmt(v: number) {
    return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0)
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      className="fixed z-50 flex flex-col border border-eve-cyan/40 bg-[#050d18] shadow-[0_0_40px_rgba(0,212,255,0.12)]"
      style={{ left: pos.x, top: pos.y, width: 480, maxHeight: '70vh', userSelect: dragging.current ? 'none' : 'auto' }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-eve-cyan/20 bg-eve-cyan/5 cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={onMouseDown}
      >
        <Package size={11} className="text-eve-cyan shrink-0" />
        <span className="text-eve-cyan text-[10px] font-mono tracking-widest flex-1 truncate">
          {contract.title || typeLabel} — CONTRACT #{contract.contractId}
        </span>
        <button onClick={onClose} className="text-eve-muted hover:text-eve-red transition-colors p-0.5">
          <X size={12} />
        </button>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-3 gap-px border-b border-eve-border/20 shrink-0">
        {[
          { label: 'TYPE',    value: typeLabel },
          { label: 'STATUS',  value: contract.status.replace(/_/g, ' ').toUpperCase(), color: statusColor },
          { label: 'EXPIRES', value: daysLeft < 0 ? 'EXPIRED' : `${daysLeft}d`, color: daysLeft < 0 ? 'text-eve-red' : daysLeft <= 2 ? 'text-eve-red' : 'text-eve-muted' },
        ].map(({ label, value, color }) => (
          <div key={label} className="px-3 py-2 bg-[#080f1c]">
            <div className="text-[8px] text-eve-dim tracking-widest mb-0.5">{label}</div>
            <div className={`text-[10px] font-mono ${color ?? 'text-eve-text'}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Parties + price */}
      <div className="grid grid-cols-2 gap-px border-b border-eve-border/20 shrink-0">
        <div className="px-3 py-2 bg-[#080f1c]">
          <div className="text-[8px] text-eve-dim tracking-widest mb-0.5">ISSUER</div>
          <div className="text-[10px] font-mono text-eve-text">{contract.issuerName || contract.issuerId}</div>
        </div>
        <div className="px-3 py-2 bg-[#080f1c]">
          <div className="text-[8px] text-eve-dim tracking-widest mb-0.5">{contract.type === 'courier' ? 'CONTRACTOR' : 'ASSIGNEE'}</div>
          <div className="text-[10px] font-mono text-eve-text">{contract.assigneeName || (contract.assigneeId ? String(contract.assigneeId) : '—')}</div>
        </div>
        {contract.price > 0 && (
          <div className="px-3 py-2 bg-[#080f1c]">
            <div className="text-[8px] text-eve-dim tracking-widest mb-0.5">{contract.type === 'courier' ? 'REWARD' : 'PRICE'}</div>
            <div className="text-[10px] font-mono text-eve-green">{iskFmt(contract.price)} ISK</div>
          </div>
        )}
        {contract.volume > 0 && (
          <div className="px-3 py-2 bg-[#080f1c]">
            <div className="text-[8px] text-eve-dim tracking-widest mb-0.5">VOLUME</div>
            <div className="text-[10px] font-mono text-eve-muted">{contract.volume.toLocaleString()} m³</div>
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}>
              <Cpu size={14} className="text-eve-cyan/50" />
            </motion.div>
            <span className="text-eve-dim text-[9px] font-mono">Loading contract contents…</span>
          </div>
        )}
        {error && <div className="p-4 text-eve-red text-[9px] font-mono">{error}</div>}
        {!loading && !error && (
          <>
            {included.length > 0 && (
              <div>
                <div className="px-3 py-1.5 bg-[#080f1c] border-b border-eve-border/20">
                  <span className="text-[8px] font-mono text-eve-dim tracking-widest">ITEMS INCLUDED ({included.length})</span>
                </div>
                {included.map(item => (
                  <div key={item.recordId} className="flex items-center gap-2 px-3 py-1.5 border-b border-eve-border/10 hover:bg-eve-border/5">
                    <img src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`} alt="" className="w-5 h-5 shrink-0 opacity-80" crossOrigin="anonymous" />
                    <span className="text-[10px] text-eve-text flex-1 truncate">{item.typeName}</span>
                    <span className="text-[9px] text-eve-muted font-mono shrink-0">
                      {item.isSingleton ? 'x1 (fitted)' : `x${item.quantity.toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {excluded.length > 0 && (
              <div>
                <div className="px-3 py-1.5 bg-[#080f1c] border-b border-eve-border/20">
                  <span className="text-[8px] font-mono text-eve-gold tracking-widest">ITEMS REQUESTED IN EXCHANGE ({excluded.length})</span>
                </div>
                {excluded.map(item => (
                  <div key={item.recordId} className="flex items-center gap-2 px-3 py-1.5 border-b border-eve-border/10 hover:bg-eve-border/5">
                    <img src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`} alt="" className="w-5 h-5 shrink-0 opacity-80" crossOrigin="anonymous" />
                    <span className="text-[10px] text-eve-gold flex-1 truncate">{item.typeName}</span>
                    <span className="text-[9px] text-eve-muted font-mono shrink-0">
                      {item.isSingleton ? 'x1 (fitted)' : `x${item.quantity.toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {bids.length > 0 && (
              <div>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 bg-[#080f1c] border-b border-eve-border/20 hover:bg-eve-border/10 transition-colors"
                  onClick={() => setShowBids(b => !b)}
                >
                  <span className="text-[8px] font-mono text-eve-dim tracking-widest flex-1 text-left">BIDS ({bids.length})</span>
                  {showBids ? <ChevronUp size={10} className="text-eve-dim" /> : <ChevronDown size={10} className="text-eve-dim" />}
                </button>
                <AnimatePresence>
                  {showBids && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      {bids.map((bid, i) => (
                        <div key={bid.bidId} className="flex items-center gap-2 px-3 py-1.5 border-b border-eve-border/10">
                          <span className="text-[8px] text-eve-dim w-4 shrink-0">#{i + 1}</span>
                          <span className="text-[9px] text-eve-text flex-1 font-mono">{bid.bidderId}</span>
                          <span className="text-[10px] text-eve-green font-mono">{iskFmt(bid.amount)} ISK</span>
                          <span className="text-[8px] text-eve-dim">{new Date(bid.dateBid).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {items.length === 0 && bids.length === 0 && contract.type !== 'courier' && (
              <div className="p-4 text-eve-dim text-[9px] font-mono text-center">No item details available</div>
            )}
            {contract.type === 'courier' && items.length === 0 && (
              <div className="p-4 text-eve-dim text-[9px] font-mono text-center">Courier contract — cargo details not accessible</div>
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}

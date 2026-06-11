import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, TrendingUp, ArrowUpRight, ArrowDownLeft, Download, ChevronRight } from 'lucide-react'
import type { EveCharacter, EveWalletTransaction, EveWalletJournalEntry } from '../../types'
import { formatISK } from '../../lib/eve-esi'

interface Props {
  characters: EveCharacter[]
  allWalletBalances: Record<number, number>
  allWalletJournals: Record<number, EveWalletJournalEntry[]>
  allWalletTransactions: Record<number, EveWalletTransaction[]>
  onClose: () => void
}

// Per-entry augmented with characterId for merged views
interface JournalRow extends EveWalletJournalEntry { characterId: number }
interface TxRow extends EveWalletTransaction { characterId: number }

// Human-friendly ref_type labels
const REF_LABEL: Record<string, string> = {
  player_trading:          'Trade',
  market_transaction:      'Market',
  contract_price:          'Contract',
  contract_reward:         'Contract',
  contract_collateral:     'Contract',
  contract_deposit:        'Contract',
  bounty_prizes:           'Bounty',
  agent_mission_reward:    'Mission',
  agent_mission_time_bonus_reward: 'Mission',
  industry_job_tax:        'Industry',
  manufacturing:           'Industry',
  reprocessing_tax:        'Reprocess',
  planetary_import_tax:    'PI',
  planetary_export_tax:    'PI',
  planetary_construction:  'PI',
  structure_gate_jump:     'Gate',
  jump_clone_installation_fee: 'Clone',
  clone_activation:        'Clone',
  insurance:               'Insurance',
  skill_purchase:          'Skill',
  market_escrow:           'Market',
  transaction_tax:         'Tax',
  brokers_fee:             'Broker',
  war_ally_contract:       'War',
  corporation_account_withdrawal: 'Corp',
  player_donation:         'Donation',
  ess_escrow_transfer:     'ESS',
  undefined:               'Other',
}

function refLabel(refType: string) {
  return REF_LABEL[refType] ?? refType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function dateFull(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function dateLabel(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function iskShort(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

function iskFull(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Simple sparkline bar chart of the last N journal entries
function BalanceSparkline({ journal }: { journal: EveWalletJournalEntry[] }) {
  const points = useMemo(() => {
    const sorted = [...journal].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    return sorted.map(e => e.balance).filter(b => b > 0)
  }, [journal])

  if (points.length < 2) return null

  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const W = 360
  const H = 48
  const step = W / (points.length - 1)

  const path = points.map((p, i) => {
    const x = i * step
    const y = H - ((p - min) / range) * (H - 4) - 2
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const area = `${path} L${W},${H} L0,${H} Z`

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#33cc66" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#33cc66" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkGrad)" />
        <path d={path} fill="none" stroke="#33cc66" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="flex justify-between mt-0.5">
        <span className="text-eve-dim text-[8px] font-mono">{iskShort(min)} ISK</span>
        <span className="text-eve-green text-[8px] font-mono">{iskShort(max)} ISK</span>
      </div>
    </div>
  )
}

// ── Detail pane ───────────────────────────────────────────────────────────────

function DetailRow({ label, value, valueClass = 'text-eve-text' }: {
  label: string; value: React.ReactNode; valueClass?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-eve-border/20">
      <span className="text-eve-dim text-[8px] tracking-widest font-mono">{label}</span>
      <span className={`text-[10px] font-mono break-words ${valueClass}`}>{value}</span>
    </div>
  )
}

function JournalDetail({ entry, characterName, showCharacter, onClose }: {
  entry: EveWalletJournalEntry; characterName: string; showCharacter: boolean; onClose: () => void
}) {
  const isPositive = entry.amount >= 0
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-eve-border/30 shrink-0">
        <span className="text-eve-cyan text-[9px] tracking-widest font-mono">JOURNAL DETAIL</span>
        <button onClick={onClose} className="text-eve-muted hover:text-eve-red transition-colors p-0.5">
          <X size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className={`text-center py-5 border-b border-eve-border/20 mb-2 ${isPositive ? 'text-eve-green' : 'text-eve-red'}`}>
          <div className="text-2xl font-mono font-bold">
            {isPositive ? '+' : ''}{iskFull(entry.amount)} ISK
          </div>
          <div className="text-[9px] text-eve-dim mt-1 font-mono tracking-widest">
            {refLabel(entry.refType).toUpperCase()}
          </div>
        </div>

        {showCharacter && <DetailRow label="CHARACTER" value={characterName} valueClass="text-eve-gold" />}
        <DetailRow label="DATE / TIME" value={dateFull(entry.date)} />
        <DetailRow label="TRANSACTION TYPE" value={entry.refType.replace(/_/g, ' ')} valueClass="text-eve-muted" />
        <DetailRow label="HUMAN LABEL" value={refLabel(entry.refType)} valueClass="text-eve-cyan" />
        <DetailRow label="BALANCE AFTER" value={`${iskFull(entry.balance)} ISK`} valueClass="text-eve-cyan" />
        {entry.description && (
          <DetailRow label="DESCRIPTION" value={entry.description} valueClass="text-eve-muted" />
        )}
        <DetailRow label="ENTRY ID" value={entry.id} valueClass="text-eve-dim" />
      </div>
    </div>
  )
}

function TransactionDetail({ tx, characterName, showCharacter, onClose }: {
  tx: EveWalletTransaction; characterName: string; showCharacter: boolean; onClose: () => void
}) {
  const total = tx.quantity * tx.unitPrice
  const isSell = !tx.isBuy

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-eve-border/30 shrink-0">
        <span className="text-eve-cyan text-[9px] tracking-widest font-mono">TRANSACTION DETAIL</span>
        <button onClick={onClose} className="text-eve-muted hover:text-eve-red transition-colors p-0.5">
          <X size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {/* Item hero */}
        <div className="flex flex-col items-center py-4 border-b border-eve-border/20 mb-2 gap-2">
          <div className="border border-eve-border/40 bg-eve-border/10 overflow-hidden" style={{ width: 64, height: 64 }}>
            <img
              src={`https://images.evetech.net/types/${encodeURIComponent(tx.typeName)}/icon`}
              alt={tx.typeName}
              className="w-full h-full object-contain p-1 opacity-80"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <div className="text-center">
            <div className="text-eve-text font-mono text-sm">{tx.typeName}</div>
            <div className={`text-xs font-mono mt-0.5 flex items-center justify-center gap-1 ${isSell ? 'text-eve-green' : 'text-eve-red'}`}>
              {isSell ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
              {isSell ? 'SELL' : 'BUY'}
            </div>
          </div>
        </div>

        {/* ISK breakdown */}
        <div className="grid grid-cols-2 gap-2 py-3 border-b border-eve-border/20 mb-1">
          <div className="flex flex-col gap-0.5">
            <span className="text-eve-dim text-[8px] tracking-widest font-mono">QUANTITY</span>
            <span className="text-eve-text font-mono text-[11px]">{tx.quantity.toLocaleString()}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-eve-dim text-[8px] tracking-widest font-mono">UNIT PRICE</span>
            <span className="text-eve-text font-mono text-[11px]">{iskFull(tx.unitPrice)} ISK</span>
          </div>
          <div className="col-span-2 flex flex-col gap-0.5 pt-1 border-t border-eve-border/15">
            <span className="text-eve-dim text-[8px] tracking-widest font-mono">TOTAL VALUE</span>
            <span className={`font-mono text-base font-bold ${isSell ? 'text-eve-green' : 'text-eve-red'}`}>
              {isSell ? '+' : '-'}{iskFull(total)} ISK
            </span>
          </div>
        </div>

        {showCharacter && <DetailRow label="CHARACTER" value={characterName} valueClass="text-eve-gold" />}
        <DetailRow label="DATE / TIME" value={dateFull(tx.date)} />
        <DetailRow label="CLIENT" value={tx.clientName} valueClass={showCharacter ? 'text-eve-muted' : 'text-eve-gold'} />
        <DetailRow label="LOCATION" value={tx.locationName} valueClass="text-eve-muted" />
        <DetailRow label="TRANSACTION ID" value={tx.transactionId} valueClass="text-eve-dim" />
      </div>
    </div>
  )
}

// ── Main window ───────────────────────────────────────────────────────────────

export default function WalletWindow({ characters, allWalletBalances, allWalletJournals, allWalletTransactions, onClose }: Props) {
  const [tab, setTab] = useState<'journal' | 'transactions'>('journal')
  const [filterType, setFilterType] = useState<string>('all')
  const [charFilter, setCharFilter] = useState<number | 'all'>('all')
  const [selectedJournal, setSelectedJournal] = useState<JournalRow | null>(null)
  const [selectedTx, setSelectedTx] = useState<TxRow | null>(null)

  const hasDetail = selectedJournal !== null || selectedTx !== null

  // Characters that actually have data loaded
  const loadedCharacters = useMemo(() =>
    characters.filter(c => allWalletJournals[c.characterId] || allWalletTransactions[c.characterId]),
    [characters, allWalletJournals, allWalletTransactions])

  const displayBalance = useMemo(() => {
    if (charFilter === 'all') return Object.values(allWalletBalances).reduce((s, b) => s + b, 0)
    return allWalletBalances[charFilter] ?? 0
  }, [charFilter, allWalletBalances])

  // Merge and sort journal entries across selected characters
  const journal = useMemo<JournalRow[]>(() => {
    const sources = charFilter === 'all'
      ? Object.entries(allWalletJournals).map(([id, entries]) => entries.map(e => ({ ...e, characterId: Number(id) })))
      : [(allWalletJournals[charFilter] ?? []).map(e => ({ ...e, characterId: charFilter }))]
    return sources.flat().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [charFilter, allWalletJournals])

  // Merge and sort transactions across selected characters
  const transactions = useMemo<TxRow[]>(() => {
    const sources = charFilter === 'all'
      ? Object.entries(allWalletTransactions).map(([id, txs]) => txs.map(t => ({ ...t, characterId: Number(id) })))
      : [(allWalletTransactions[charFilter] ?? []).map(t => ({ ...t, characterId: charFilter }))]
    return sources.flat().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [charFilter, allWalletTransactions])

  const journalTypes = useMemo(() => [...new Set(journal.map(e => e.refType))].sort(), [journal])

  const filteredJournal = useMemo(() =>
    filterType === 'all' ? journal : journal.filter(e => e.refType === filterType),
    [journal, filterType])

  const journalIncome = useMemo(() =>
    journal.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0), [journal])
  const journalExpense = useMemo(() =>
    journal.filter(e => e.amount < 0).reduce((s, e) => s + e.amount, 0), [journal])

  // Character name lookup
  const charName = (id: number) => characters.find(c => c.characterId === id)?.characterName ?? `${id}`

  function closeDetail() { setSelectedJournal(null); setSelectedTx(null) }

  function handleTabChange(t: 'journal' | 'transactions') { setTab(t); closeDetail() }

  function handleCharFilter(v: number | 'all') { setCharFilter(v); setFilterType('all'); closeDetail() }

  function downloadCSV(rows: (string | number)[][], filename: string) {
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function exportCSV() {
    if (tab === 'journal') {
      const rows = [
        ['Date', 'Character', 'Type', 'Amount', 'Balance', 'Description'],
        ...filteredJournal.map(e => [
          e.date, `"${charName(e.characterId)}"`, e.refType,
          e.amount.toFixed(2), e.balance.toFixed(2), `"${e.description.replace(/"/g, "'")}"`,
        ]),
      ]
      downloadCSV(rows, 'wallet_journal.csv')
    } else {
      const rows = [
        ['Date', 'Character', 'Item', 'Qty', 'Unit Price', 'Total', 'Type', 'Client', 'Location'],
        ...transactions.map(t => [
          t.date, `"${charName(t.characterId)}"`, `"${t.typeName}"`,
          t.quantity, t.unitPrice.toFixed(2), (t.quantity * t.unitPrice).toFixed(2),
          t.isBuy ? 'Buy' : 'Sell', `"${t.clientName}"`, `"${t.locationName}"`,
        ]),
      ]
      downloadCSV(rows, 'wallet_transactions.csv')
    }
  }

  const showCharCol = charFilter === 'all' && loadedCharacters.length > 1

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />

        <motion.div
          className="relative z-10 flex eve-panel border border-eve-cyan/30 bg-[#070e1a] shadow-2xl overflow-hidden"
          style={{ maxHeight: '80vh', minHeight: 480 }}
          animate={{ width: hasDetail ? 860 : 560 }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
        >
          {/* Corner decorations */}
          <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-eve-cyan/60 pointer-events-none z-10" />
          <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-eve-cyan/60 pointer-events-none z-10" />
          <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-eve-cyan/60 pointer-events-none z-10" />
          <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-eve-cyan/60 pointer-events-none z-10" />

          {/* ── Left: main list ─────────────────────────────────────────────── */}
          <div className="flex flex-col" style={{ width: 560, minWidth: 560 }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-eve-border/40 shrink-0">
              <div className="flex items-center gap-2">
                <TrendingUp size={13} className="text-eve-green" />
                <span className="text-eve-cyan text-[10px] tracking-widest font-mono">WALLET</span>
                <span className="text-eve-dim text-[9px]">·</span>
                <span className="text-eve-green font-mono text-sm">{formatISK(displayBalance)} ISK</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Character filter dropdown */}
                {loadedCharacters.length > 1 && (
                  <select
                    value={charFilter === 'all' ? 'all' : charFilter}
                    onChange={e => handleCharFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="bg-eve-deep border border-eve-border/50 text-eve-cyan text-[9px] font-mono px-2 py-1 hover:border-eve-cyan/40 focus:outline-none"
                  >
                    <option value="all">ALL CHARACTERS</option>
                    {loadedCharacters.map(c => (
                      <option key={c.characterId} value={c.characterId}>{c.characterName.toUpperCase()}</option>
                    ))}
                  </select>
                )}
                <button onClick={onClose} className="text-eve-muted hover:text-eve-red transition-colors p-1">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Balance sparkline */}
            {journal.length > 1 && (
              <div className="px-5 pt-4 pb-2 border-b border-eve-border/30 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-eve-dim text-[9px] tracking-widest">ISK BALANCE TREND</span>
                  <div className="flex gap-4 text-[9px] font-mono">
                    <span className="text-eve-green">▲ {iskShort(journalIncome)} ISK</span>
                    <span className="text-eve-red">▼ {iskShort(Math.abs(journalExpense))} ISK</span>
                  </div>
                </div>
                <BalanceSparkline journal={journal} />
              </div>
            )}

            {/* Tabs + filters */}
            <div className="flex items-center justify-between px-5 py-2 border-b border-eve-border/30 shrink-0">
              <div className="flex border border-eve-border/50 overflow-hidden text-[9px] font-mono">
                <button
                  onClick={() => handleTabChange('journal')}
                  className={`px-3 py-1.5 transition-colors ${tab === 'journal' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
                >
                  JOURNAL {journal.length > 0 && <span className="opacity-60 ml-1">{journal.length}</span>}
                </button>
                <button
                  onClick={() => handleTabChange('transactions')}
                  className={`px-3 py-1.5 border-l border-eve-border/40 transition-colors ${tab === 'transactions' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
                >
                  TX {transactions.length > 0 && <span className="opacity-60 ml-1">{transactions.length}</span>}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {tab === 'journal' && (
                  <select
                    value={filterType}
                    onChange={e => setFilterType(e.target.value)}
                    className="bg-eve-deep border border-eve-border/50 text-eve-muted text-[9px] font-mono px-2 py-1 hover:border-eve-cyan/40 focus:outline-none"
                  >
                    <option value="all">ALL TYPES</option>
                    {journalTypes.map(t => (
                      <option key={t} value={t}>{refLabel(t).toUpperCase()}</option>
                    ))}
                  </select>
                )}
                <button onClick={exportCSV} className="eve-btn flex items-center gap-1 text-[9px]" title="Export CSV">
                  <Download size={10} />
                  CSV
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {tab === 'journal' ? (
                filteredJournal.length === 0 ? (
                  <div className="p-6 text-center text-eve-dim text-[10px] font-mono">No journal entries</div>
                ) : (
                  <table className="w-full text-[9px] font-mono">
                    <thead className="sticky top-0 bg-[#070e1a] border-b border-eve-border/30">
                      <tr className="text-eve-dim text-[8px] tracking-widest">
                        <th className="text-left px-3 py-1.5 w-16">DATE</th>
                        {showCharCol && <th className="text-left px-2 py-1.5 w-20">CHAR</th>}
                        <th className="text-left px-2 py-1.5 w-20">TYPE</th>
                        <th className="text-right px-2 py-1.5 w-24">AMOUNT</th>
                        <th className="text-right px-3 py-1.5 w-24">BALANCE</th>
                        <th className="text-left px-2 py-1.5">DESCRIPTION</th>
                        <th className="w-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredJournal.map((e, i) => {
                        const active = selectedJournal?.id === e.id && selectedJournal?.characterId === e.characterId
                        return (
                          <tr
                            key={`${e.characterId}-${e.id}-${i}`}
                            onClick={() => { setSelectedJournal(e); setSelectedTx(null) }}
                            className={`border-b border-eve-border/15 cursor-pointer transition-colors ${active ? 'bg-eve-cyan/[0.08] border-l-2 border-l-eve-cyan/50' : 'hover:bg-white/[0.02]'}`}
                          >
                            <td className="px-3 py-1.5 text-eve-dim">{dateLabel(e.date)}</td>
                            {showCharCol && (
                              <td className="px-2 py-1.5 text-eve-gold truncate" style={{ maxWidth: 80 }}>
                                {charName(e.characterId).split(' ')[0]}
                              </td>
                            )}
                            <td className="px-2 py-1.5 text-eve-muted">{refLabel(e.refType)}</td>
                            <td className={`px-2 py-1.5 text-right ${e.amount >= 0 ? 'text-eve-green' : 'text-eve-red'}`}>
                              {e.amount >= 0 ? '+' : ''}{iskShort(e.amount)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-eve-cyan">{iskShort(e.balance)}</td>
                            <td className="px-2 py-1.5 text-eve-muted truncate max-w-0" style={{ maxWidth: 120 }}>
                              {e.description || '—'}
                            </td>
                            <td className="pr-2">
                              <ChevronRight size={9} className={`transition-colors ${active ? 'text-eve-cyan' : 'text-eve-dim/40'}`} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              ) : (
                transactions.length === 0 ? (
                  <div className="p-6 text-center text-eve-dim text-[10px] font-mono">No transactions</div>
                ) : (
                  <table className="w-full text-[9px] font-mono">
                    <thead className="sticky top-0 bg-[#070e1a] border-b border-eve-border/30">
                      <tr className="text-eve-dim text-[8px] tracking-widest">
                        <th className="text-left px-3 py-1.5 w-16">DATE</th>
                        <th className="text-left px-2 py-1.5 w-6"></th>
                        {showCharCol && <th className="text-left px-2 py-1.5 w-20">CHAR</th>}
                        <th className="text-left px-2 py-1.5">ITEM</th>
                        <th className="text-right px-2 py-1.5 w-10">QTY</th>
                        <th className="text-right px-2 py-1.5 w-20">UNIT</th>
                        <th className="text-right px-3 py-1.5 w-20">TOTAL</th>
                        <th className="w-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t, i) => {
                        const active = selectedTx?.transactionId === t.transactionId && selectedTx?.characterId === t.characterId
                        return (
                          <tr
                            key={`${t.characterId}-${t.transactionId}-${i}`}
                            onClick={() => { setSelectedTx(t); setSelectedJournal(null) }}
                            className={`border-b border-eve-border/15 cursor-pointer transition-colors ${active ? 'bg-eve-cyan/[0.08] border-l-2 border-l-eve-cyan/50' : 'hover:bg-white/[0.02]'}`}
                          >
                            <td className="px-3 py-1.5 text-eve-dim">{dateLabel(t.date)}</td>
                            <td className="px-2 py-1.5">
                              {t.isBuy
                                ? <ArrowDownLeft size={10} className="text-eve-red" />
                                : <ArrowUpRight size={10} className="text-eve-green" />
                              }
                            </td>
                            {showCharCol && (
                              <td className="px-2 py-1.5 text-eve-gold truncate" style={{ maxWidth: 80 }}>
                                {charName(t.characterId).split(' ')[0]}
                              </td>
                            )}
                            <td className="px-2 py-1.5 text-eve-text truncate max-w-0" style={{ maxWidth: 130 }}>
                              {t.typeName}
                            </td>
                            <td className="px-2 py-1.5 text-right text-eve-muted">{t.quantity.toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-eve-muted">{iskShort(t.unitPrice)}</td>
                            <td className={`px-3 py-1.5 text-right font-bold ${t.isBuy ? 'text-eve-red' : 'text-eve-green'}`}>
                              {iskShort(t.quantity * t.unitPrice)}
                            </td>
                            <td className="pr-2">
                              <ChevronRight size={9} className={`transition-colors ${active ? 'text-eve-cyan' : 'text-eve-dim/40'}`} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-2 border-t border-eve-border/30 text-[8px] text-eve-dim font-mono tracking-widest shrink-0">
              {charFilter === 'all' && loadedCharacters.length > 1
                ? `${loadedCharacters.length} CHARACTERS · LAST 50 ENTRIES EACH · ESI WALLET DATA`
                : 'LAST 50 ENTRIES · ESI WALLET DATA'
              }
            </div>
          </div>

          {/* ── Right: detail pane ──────────────────────────────────────────── */}
          <AnimatePresence>
            {hasDetail && (
              <motion.div
                className="border-l border-eve-cyan/20 bg-[#050c17] overflow-hidden"
                style={{ width: 300, minWidth: 300 }}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ type: 'spring', damping: 22, stiffness: 260 }}
              >
                {selectedJournal && (
                  <JournalDetail
                    entry={selectedJournal}
                    characterName={charName(selectedJournal.characterId)}
                    showCharacter={loadedCharacters.length > 1}
                    onClose={closeDetail}
                  />
                )}
                {selectedTx && (
                  <TransactionDetail
                    tx={selectedTx}
                    characterName={charName(selectedTx.characterId)}
                    showCharacter={loadedCharacters.length > 1}
                    onClose={closeDetail}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'

type Status = 'planned' | 'consideration' | 'in-progress' | 'done'
type Category = 'Bug Fixes' | 'Auth & Accounts' | 'Intel Tool' | 'Aurora AI' | 'EVE Data' | 'Infrastructure' | 'General'

interface RoadmapItem {
  id: string
  title: string
  status: Status
  category: Category
  description: string
  notes?: string[]
}

const STATUS_META: Record<Status, { label: string; color: string; dot: string }> = {
  'done':          { label: 'COMPLETE',      color: 'text-eve-green',  dot: 'bg-eve-green' },
  'in-progress':   { label: 'IN PROGRESS',   color: 'text-eve-cyan',   dot: 'bg-eve-cyan animate-pulse' },
  'planned':       { label: 'PLANNED',        color: 'text-eve-gold',   dot: 'bg-eve-gold' },
  'consideration': { label: 'CONSIDERATION', color: 'text-eve-muted',  dot: 'bg-eve-muted' },
}

const CATEGORY_ORDER: Category[] = [
  'Bug Fixes', 'Auth & Accounts', 'Intel Tool', 'Aurora AI', 'EVE Data', 'Infrastructure', 'General',
]

// ── Card ─────────────────────────────────────────────────────────────────────
function RoadmapCard({
  item,
  onDelete,
}: {
  item: RoadmapItem
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const meta = STATUS_META[item.status]

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete) {
      setConfirmDelete(true)
      // Auto-cancel confirm after 3 s
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    onDelete(item.id)
  }

  return (
    <motion.div layout className="eve-panel border border-eve-border/60 overflow-hidden group/card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpen(v => !v) }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-eve-border/10 transition-colors cursor-pointer"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
        <span className="flex-1 text-eve-text text-xs tracking-wide">{item.title}</span>
        <span className={`text-[9px] tracking-widest font-mono ${meta.color} shrink-0`}>
          {meta.label}
        </span>

        {/* Delete button — visible on hover or when awaiting confirm */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleDelete}
          title={confirmDelete ? 'Click again to confirm delete' : 'Remove item'}
          className={`shrink-0 p-1 border transition-all ml-1 ${
            confirmDelete
              ? 'border-eve-red text-eve-red bg-eve-red/10'
              : 'border-transparent text-eve-dim hover:border-eve-red/50 hover:text-eve-red opacity-0 group-hover/card:opacity-100'
          }`}
        >
          <Trash2 size={10} />
        </motion.button>

        <span className="text-eve-dim shrink-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </div>

      {/* Confirm banner */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-2 bg-eve-red/8 border-t border-eve-red/20 flex items-center justify-between gap-3">
              <span className="text-eve-red text-[9px] tracking-widest">CONFIRM DELETE — CLICK TRASH AGAIN</span>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(false) }}
                className="text-eve-dim text-[9px] tracking-widest hover:text-eve-text transition-colors"
              >
                CANCEL
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-eve-border/40 flex flex-col gap-2">
              <p className="text-eve-muted text-xs leading-relaxed">{item.description}</p>
              {item.notes && item.notes.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {item.notes.map((n, i) => (
                    <li key={i} className="flex gap-2 text-[11px] text-eve-dim">
                      <span className="text-eve-cyan/40 shrink-0">▸</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Completed section ────────────────────────────────────────────────────────
function CompletedSection({
  items,
  onDelete,
}: {
  items: RoadmapItem[]
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {/* Section header — always visible, acts as toggle */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 text-left group w-full"
      >
        <div className="flex-1 flex items-center gap-2 border-b border-eve-green/20 pb-1">
          <span className="text-[9px] tracking-widest text-eve-green/70 uppercase">
            COMPLETED
          </span>
          <span className="text-[9px] tracking-widest text-eve-green/40">· {items.length}</span>
        </div>
        <motion.span
          animate={{ rotate: expanded ? 0 : -90 }}
          transition={{ duration: 0.18 }}
          className="text-eve-green/40 group-hover:text-eve-green/70 transition-colors shrink-0 pb-1"
        >
          <ChevronDown size={12} />
        </motion.span>
      </button>

      {/* Items */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2">
              {items.map(item => (
                <RoadmapCard key={item.id} item={item} onDelete={onDelete} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────
export default function RoadmapPanel() {
  const [items, setItems] = useState<RoadmapItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRoadmap = () =>
    fetch('/api/roadmap')
      .then(r => r.json())
      .then((data: RoadmapItem[]) => { setItems(data); setLoading(false) })
      .catch(() => setLoading(false))

  useEffect(() => { fetchRoadmap() }, [])

  // Refresh when window regains focus (Aurora may have updated it via chat)
  useEffect(() => {
    const onFocus = () =>
      fetch('/api/roadmap').then(r => r.json()).then((data: RoadmapItem[]) => setItems(data)).catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const handleDelete = async (id: string) => {
    // Optimistic update
    setItems(prev => prev.filter(i => i.id !== id))
    await fetch(`/api/roadmap/${id}`, { method: 'DELETE' }).catch(() => {
      // Revert on failure
      fetchRoadmap()
    })
  }

  const activeItems = items.filter(i => i.status !== 'done')
  const doneItems   = items.filter(i => i.status === 'done')

  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="eve-header mb-0">AURORA ROADMAP</div>
          <div className="text-eve-dim text-[9px] tracking-widest mt-0.5">PLANNED FEATURES &amp; ENHANCEMENTS</div>
        </div>
        <div className="flex gap-3 flex-wrap justify-end">
          {Object.entries(STATUS_META).map(([status, meta]) => (
            counts[status] ? (
              <div key={status} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                <span className={`text-[9px] tracking-widest ${meta.color}`}>
                  {meta.label} · {counts[status]}
                </span>
              </div>
            ) : null
          ))}
        </div>
      </div>

      {loading && (
        <div className="text-eve-dim text-xs tracking-widest text-center py-8">LOADING ROADMAP...</div>
      )}

      {!loading && (
        <div className="flex flex-col gap-6">
          {/* Active items grouped by category */}
          {CATEGORY_ORDER.map(category => {
            const catItems = activeItems.filter(i => i.category === category)
            if (catItems.length === 0) return null
            return (
              <div key={category} className="flex flex-col gap-2">
                <div className="text-[9px] tracking-widest text-eve-cyan/60 uppercase border-b border-eve-border/30 pb-1">
                  {category}
                </div>
                {catItems.map(item => (
                  <RoadmapCard key={item.id} item={item} onDelete={handleDelete} />
                ))}
              </div>
            )
          })}

          {/* Completed section — collapsed by default */}
          <CompletedSection items={doneItems} onDelete={handleDelete} />
        </div>
      )}

      <div className="text-eve-dim text-[9px] tracking-widest border-t border-eve-border/40 pt-3">
        ITEMS MARKED "CONSIDERATION" ARE EXPLORATORY — SCOPE AND FEASIBILITY TBD
      </div>
    </div>
  )
}

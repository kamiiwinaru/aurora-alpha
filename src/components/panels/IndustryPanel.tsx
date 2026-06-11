import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, Factory, Truck, AlertTriangle, ArrowRight, FlaskConical, CheckCircle2, XCircle, Search, X, ShoppingCart, Zap, Wrench, ChevronDown, ChevronRight as ChevronRightIcon } from 'lucide-react'
import type { EveIndustryJob, EveSkill, EveAsset, EveCharacter } from '../../types'
import { timeUntil, formatISK } from '../../lib/eve-esi'

interface BlueprintImport {
  typeId: number
  typeName: string
  me: number
  te: number
  runs: number
}

interface IndustryPanelProps {
  jobs: EveIndustryJob[]
  loading: boolean
  onRefresh: () => void
  freightImport?: { collateral: number; volume: number } | null
  onFreightImportClear?: () => void
  blueprintImport?: BlueprintImport | null
  onBlueprintImportClear?: () => void
  characterId?: number
  accessToken?: string
  skills?: EveSkill[]
  assets?: EveAsset[]
  allIndustryJobs?: Record<number, EveIndustryJob[]>
  characters?: EveCharacter[]
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-eve-cyan border-eve-cyan',
  ready: 'text-eve-green border-eve-green',
  delivered: 'text-eve-muted border-eve-dim',
  cancelled: 'text-eve-red border-eve-red',
  paused: 'text-eve-orange border-eve-orange',
  reverted: 'text-eve-red border-eve-red',
}

const ACTIVITY_COLORS: Record<string, string> = {
  'Manufacturing': 'text-eve-cyan',
  'Invention': 'text-eve-gold',
  'Copying': 'text-eve-orange',
  'Reactions': 'text-eve-green',
  'Researching TE': 'text-purple-400',
  'Researching ME': 'text-purple-400',
}

const FREIGHT_BASE = 10_000_000
const FREIGHT_PER_M3 = 653
const FREIGHT_COLLATERAL_PCT = 0.01
const FREIGHT_MAX_VOL = 350_000

function JobProgress({ job }: { job: EveIndustryJob }) {
  const start = new Date(job.startDate).getTime()
  const end = new Date(job.endDate).getTime()
  const now = Date.now()
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
  const isReady = pct >= 100

  return (
    <div className="mt-1.5">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-eve-muted">{Math.round(pct)}%</span>
        <span className={isReady ? 'text-eve-green' : 'text-eve-muted'}>
          {isReady ? '▶ READY' : timeUntil(job.endDate)}
        </span>
      </div>
      <div className="h-1 bg-eve-border">
        <motion.div
          className={`h-full ${isReady ? 'bg-eve-green' : 'bg-eve-cyan'}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
    </div>
  )
}

function FreightCalculator({
  freightImport,
  onFreightImportClear,
}: {
  freightImport?: { collateral: number; volume: number } | null
  onFreightImportClear?: () => void
}) {
  const [volume, setVolume] = useState('')
  const [collateral, setCollateral] = useState('')
  const [imported, setImported] = useState(false)

  useEffect(() => {
    if (freightImport && !imported) {
      setVolume(freightImport.volume > 0 ? String(Math.round(freightImport.volume)) : '')
      setCollateral(String(Math.round(freightImport.collateral)))
      setImported(true)
      onFreightImportClear?.()
    }
  }, [freightImport, imported, onFreightImportClear])

  const vol = parseFloat(volume) || 0
  const col = parseFloat(collateral.replace(/,/g, '')) || 0
  const volExceeded = vol > FREIGHT_MAX_VOL

  const baseFee = FREIGHT_BASE
  const volFee = vol * FREIGHT_PER_M3
  const colFee = col * FREIGHT_COLLATERAL_PCT
  const total = Math.ceil((baseFee + volFee + colFee) / 1_000_000) * 1_000_000

  const hasInput = vol > 0 || col > 0

  return (
    <div className="flex flex-col gap-3">
      {/* Route banner */}
      <div className="eve-panel p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-eve-cyan font-mono tracking-wider">JITA</span>
          <ArrowRight size={12} className="text-eve-dim" />
          <span className="text-eve-gold font-mono tracking-wider">HY-RWO</span>
        </div>
        <div className="text-[9px] text-eve-dim tracking-widest">MAX {FREIGHT_MAX_VOL.toLocaleString()} M³</div>
      </div>

      {/* Inputs */}
      <div className="eve-panel p-3 flex flex-col gap-3 flex-shrink-0">
        <div>
          <div className="eve-label mb-1 flex items-center justify-between">
            <span>VOLUME (M³)</span>
            {volExceeded && (
              <span className="text-eve-red text-[9px] flex items-center gap-1">
                <AlertTriangle size={9} />EXCEEDS MAX
              </span>
            )}
          </div>
          <input
            type="number"
            min="0"
            max={FREIGHT_MAX_VOL}
            className={`eve-input w-full text-xs ${volExceeded ? 'border-eve-red/60 text-eve-red' : ''}`}
            placeholder="0"
            value={volume}
            onChange={e => { setVolume(e.target.value); setImported(false) }}
          />
          {vol > 0 && !volExceeded && (
            <div className="mt-1">
              <div className="h-0.5 bg-eve-border">
                <motion.div
                  className="h-full bg-eve-cyan/60"
                  animate={{ width: `${Math.min(100, (vol / FREIGHT_MAX_VOL) * 100)}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="text-[9px] text-eve-dim mt-0.5 text-right">
                {((vol / FREIGHT_MAX_VOL) * 100).toFixed(1)}% of capacity
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="eve-label mb-1">COLLATERAL (ISK)</div>
          <input
            type="number"
            min="0"
            className="eve-input w-full text-xs"
            placeholder="0"
            value={collateral}
            onChange={e => { setCollateral(e.target.value); setImported(false) }}
          />
        </div>
      </div>

      {/* Breakdown */}
      <AnimatePresence>
        {hasInput && !volExceeded && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="eve-panel p-3 flex flex-col gap-2 flex-shrink-0"
          >
            <div className="eve-header">REWARD BREAKDOWN</div>
            <div className="space-y-1.5">
              {[
                { label: 'BASE FEE', value: baseFee, color: 'text-eve-text' },
                { label: `VOLUME  (${vol.toLocaleString()} m³ × ${FREIGHT_PER_M3})`, value: volFee, color: 'text-eve-muted' },
                { label: `COLLATERAL  (${(FREIGHT_COLLATERAL_PCT * 100).toFixed(0)}%)`, value: colFee, color: 'text-eve-muted' },
              ].map(row => (
                <div key={row.label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-eve-dim">{row.label}</span>
                  <span className={`text-xs font-mono ${row.color}`}>{formatISK(row.value)}</span>
                </div>
              ))}
              <div className="border-t border-eve-border/50 pt-2 flex items-baseline justify-between">
                <span className="text-[10px] text-eve-cyan tracking-widest">CONTRACT REWARD</span>
                <span className="text-sm font-mono text-eve-cyan text-glow-cyan">{formatISK(total)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {volExceeded && (
        <div className="eve-panel p-3 border-eve-red/40 bg-eve-red/5 flex items-center gap-2 text-eve-red text-xs">
          <AlertTriangle size={12} />
          Volume exceeds maximum capacity of {FREIGHT_MAX_VOL.toLocaleString()} m³.
          Split your cargo into multiple contracts.
        </div>
      )}

      {!hasInput && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
          <div className="text-eve-cyan/20 text-4xl">◈</div>
          <div className="text-eve-muted text-xs">Enter volume and collateral to calculate courier reward</div>
          <div className="text-eve-dim text-[9px]">Or use SEND TO FREIGHT from the appraisal panel</div>
        </div>
      )}
    </div>
  )
}

interface BlueprintMaterial {
  typeId: number
  name: string
  baseQty: number
  adjQty: number
  have: number
  need: number
}

interface TimeBreakdownEntry { label: string; pct: number }

interface RequiredSkill { typeId: number; name: string; requiredLevel: number }

interface BlueprintData {
  productName: string
  productTypeId: number | null
  productQty: number
  baseTime: number
  adjustedTime: number
  me: number
  te: number
  runs: number
  timeBreakdown: TimeBreakdownEntry[]
  materials: BlueprintMaterial[]
  requiredSkills: RequiredSkill[]
}

interface ChainNode {
  typeId: number
  name: string
  qtyNeeded: number
  qtyPerRun: number
  runsNeeded: number
  activity: 'manufacturing' | 'reaction' | 'raw'
  bpTypeId?: number
  timePerRun: number
  materials: ChainNode[]
}

interface BuyItem { typeId: number; name: string; qty: number; have: number }

interface ChainData {
  productName: string
  productTypeId: number | null
  productQty: number
  runs: number
  chain: ChainNode[]
  buyList: BuyItem[]
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return '0s'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 && d === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

// ── Structure / rig metadata (mirrors server lookup tables) ─────────────────
const STRUCTURES = [
  { key: 'station', label: 'NPC Station',  me: 0, te: 0  },
  { key: 'raitaru', label: 'Raitaru',       me: 1, te: 15 },
  { key: 'azbel',   label: 'Azbel',         me: 1, te: 20 },
  { key: 'sotiyo',  label: 'Sotiyo',        me: 1, te: 30 },
] as const
type StructureKey = typeof STRUCTURES[number]['key']

const RIGS = [
  { key: 'none', label: 'No Rigs' },
  { key: 't1',   label: 'T1 Industry Rig' },
  { key: 't2',   label: 'T2 Industry Rig' },
] as const
type RigKey = typeof RIGS[number]['key']

const REACTION_STRUCTURES = [
  { key: 'none',    label: 'No Structure', te: 0  },
  { key: 'athanor', label: 'Athanor',      te: 15 },
  { key: 'tatara',  label: 'Tatara',       te: 25 },
] as const
type ReactionStructureKey = typeof REACTION_STRUCTURES[number]['key']

const REACTION_RIGS = [
  { key: 'none',        label: 'No Rigs' },
  { key: 't1_reaction', label: 'T1 Reaction Rig' },
  { key: 't2_reaction', label: 'T2 Reaction Rig' },
] as const
type ReactionRigKey = typeof REACTION_RIGS[number]['key']

const SECURITIES = [
  { key: 'high', label: 'Highsec' },
  { key: 'low',  label: 'Lowsec' },
  { key: 'null', label: 'Null / WH' },
] as const
type SecurityKey = typeof SECURITIES[number]['key']

const RIG_BONUSES: Record<RigKey, Record<SecurityKey, { me: number; te: number }>> = {
  none: { high: { me: 0, te: 0 }, low: { me: 0, te: 0 }, null: { me: 0, te: 0 } },
  t1:   { high: { me: 2, te: 20 }, low: { me: 3.8, te: 38 }, null: { me: 4.2, te: 42 } },
  t2:   { high: { me: 2.4, te: 24 }, low: { me: 4.56, te: 45.6 }, null: { me: 5.04, te: 50.4 } },
}

const REACTION_RIG_BONUSES: Record<ReactionRigKey, Record<SecurityKey, { te: number }>> = {
  none:        { high: { te: 0 }, low: { te: 0 }, null: { te: 0 } },
  t1_reaction: { high: { te: 20 }, low: { te: 38 }, null: { te: 42 } },
  t2_reaction: { high: { te: 24 }, low: { te: 45.6 }, null: { te: 50.4 } },
}

interface BpProfile {
  id: string
  name: string
  system: string
  // Manufacturing
  structure: StructureKey
  rig: RigKey
  security: SecurityKey
  // Reaction (optional)
  reactionEnabled?: boolean
  reactionStructure?: ReactionStructureKey
  reactionRig?: ReactionRigKey
}

const PROFILES_KEY = 'aurora_bp_profiles'
const loadProfiles = (): BpProfile[] => {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) ?? '[]') } catch { return [] }
}
const saveProfiles = (p: BpProfile[]) => localStorage.setItem(PROFILES_KEY, JSON.stringify(p))

interface SearchResult { typeId: number; name: string }

// ── Chain flattening helpers ─────────────────────────────────────────────────
interface FlatStep {
  key: string
  typeId: number
  name: string
  qtyNeeded: number
  runsNeeded: number
  activity: 'manufacturing' | 'reaction'
  timePerRun: number
  inputs: Array<{ typeId: number; name: string; qty: number; source: 'buy' | 'manufacture' | 'react' }>
}

function flattenChainToSteps(chain: ChainNode[]): FlatStep[] {
  // Post-order traversal: children (dependencies) before parents
  const seen = new Map<number, FlatStep>()
  const order: number[] = []

  function visit(node: ChainNode) {
    for (const child of node.materials) visit(child)
    if (node.activity === 'raw') return
    if (seen.has(node.typeId)) {
      // Aggregate quantity if same item needed multiple places
      seen.get(node.typeId)!.qtyNeeded += node.qtyNeeded
      seen.get(node.typeId)!.runsNeeded = Math.ceil(seen.get(node.typeId)!.qtyNeeded / Math.max(1, node.qtyPerRun))
      return
    }
    order.push(node.typeId)
    seen.set(node.typeId, {
      key: `${node.typeId}`,
      typeId: node.typeId,
      name: node.name,
      qtyNeeded: node.qtyNeeded,
      runsNeeded: node.runsNeeded,
      activity: node.activity,
      timePerRun: node.timePerRun,
      inputs: node.materials.map(m => ({
        typeId: m.typeId,
        name: m.name,
        qty: m.qtyNeeded,
        source: m.activity === 'raw' ? 'buy' : m.activity === 'reaction' ? 'react' : 'manufacture',
      })),
    })
  }
  for (const n of chain) visit(n)
  return order.map(id => seen.get(id)!).filter(Boolean)
}

// ── Detailed Steps Popout ────────────────────────────────────────────────────
function StepsPopout({
  blueprint, chainData, chainLoading, chainError,
  mfgStructure, mfgRig, rxStructure, rxRig, security, system, onClose,
}: {
  blueprint: BlueprintImport
  chainData: ChainData | null
  chainLoading: boolean
  chainError: string | null
  mfgStructure: string
  mfgRig: string
  rxStructure: string
  rxRig: string
  security: string
  system: string
  onClose: () => void
}) {
  const [pos, setPos] = useState({ x: 60, y: 60 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    dragging.current = true
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.preventDefault()
  }
  useEffect(() => {
    const mv = (e: MouseEvent) => { if (dragging.current) setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }) }
    const up = () => { dragging.current = false }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [])

  const toggleSection = (key: string) => setCollapsed(p => ({ ...p, [key]: !p[key] }))

  const steps = useMemo(() => chainData ? flattenChainToSteps(chainData.chain) : [], [chainData])
  const reactions = steps.filter(s => s.activity === 'reaction')
  const manufacturing = steps.filter(s => s.activity === 'manufacturing')
  const mfgStructLabel = STRUCTURES.find(s => s.key === mfgStructure)?.label ?? mfgStructure
  const rxStructLabel  = REACTION_STRUCTURES.find(s => s.key === rxStructure)?.label ?? rxStructure

  const sourceTag = (source: 'buy' | 'manufacture' | 'react') => {
    if (source === 'buy') return <span className="text-[8px] text-eve-muted border border-eve-border/40 px-1 py-px ml-1">BUY</span>
    if (source === 'react') return <span className="text-[8px] text-eve-green border border-eve-green/30 px-1 py-px ml-1">REACT</span>
    return <span className="text-[8px] text-eve-cyan border border-eve-cyan/30 px-1 py-px ml-1">MFG</span>
  }

  const SectionHeader = ({ id, icon, label, count, color }: { id: string; icon: React.ReactNode; label: string; count: number; color: string }) => (
    <button onClick={() => toggleSection(id)} className="w-full flex items-center gap-2 py-1.5 border-b border-eve-border/40 hover:bg-eve-border/10 transition-colors">
      {collapsed[id] ? <ChevronRightIcon size={9} className="text-eve-dim shrink-0" /> : <ChevronDown size={9} className="text-eve-dim shrink-0" />}
      {icon}
      <span className={`text-[10px] uppercase tracking-wider font-mono ${color}`}>{label}</span>
      <span className="text-eve-dim text-[9px] ml-1">({count})</span>
    </button>
  )

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999, width: 420, minWidth: 320 }}
      className="eve-panel border border-eve-cyan/30 shadow-2xl shadow-black/80 flex flex-col max-h-[80vh]"
    >
      {/* Drag handle */}
      <div onMouseDown={onMouseDown} className="flex items-center justify-between px-3 py-2 border-b border-eve-border/60 cursor-grab active:cursor-grabbing select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical size={11} className="text-eve-cyan shrink-0" />
          <span className="text-eve-cyan text-[10px] tracking-widest uppercase shrink-0">Build Chain</span>
          <span className="text-eve-dim text-[9px] truncate">— {blueprint.typeName}</span>
        </div>
        <button onClick={onClose} className="text-eve-dim hover:text-eve-red transition-colors ml-2 shrink-0"><X size={11} /></button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto flex-1 p-3 space-y-3 text-[11px]">
        {chainLoading && <div className="text-eve-muted text-xs animate-pulse text-center py-6">Resolving manufacturing chain…<br/><span className="text-[9px] text-eve-dim">This may take a moment for complex blueprints</span></div>}
        {chainError  && <div className="text-eve-red text-xs text-center py-4">{chainError}</div>}

        {chainData && !chainLoading && (<>
          {/* ── Buy list ──────────────────────────────────────────── */}
          <div>
            <SectionHeader id="buy" icon={<ShoppingCart size={10} className="text-eve-muted" />} label="Procure (Raw Materials)" count={chainData.buyList.length} color="text-eve-muted" />
            {!collapsed['buy'] && (
              <div className="pt-1 space-y-px">
                {chainData.buyList.map(item => (
                  <div key={item.typeId} className="flex items-center justify-between gap-2 py-0.5 pl-4">
                    <span className="text-eve-text truncate">{item.name}</span>
                    <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                      {item.have > 0 && <span className="text-eve-muted">have {item.have.toLocaleString()}</span>}
                      {item.qty > item.have
                        ? <span className="text-eve-orange">need {(item.qty - item.have).toLocaleString()}</span>
                        : <span className="text-eve-green">✓ covered</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Reaction steps ────────────────────────────────────── */}
          {reactions.length > 0 && (
            <div>
              <SectionHeader id="rx" icon={<Zap size={10} className="text-eve-green" />} label={`Reactions  ·  ${rxStructLabel}${system ? ' · ' + system : ''}`} count={reactions.length} color="text-eve-green" />
              {!collapsed['rx'] && (
                <div className="pt-1 space-y-2">
                  {reactions.map((step, i) => (
                    <div key={step.key} className="pl-4 border-l border-eve-green/20">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-eve-green font-mono">
                          <span className="text-eve-dim text-[9px] mr-1">{i + 1}.</span>
                          {step.name} <span className="text-eve-muted">×{step.qtyNeeded.toLocaleString()}</span>
                        </span>
                        <span className="text-eve-dim text-[9px] shrink-0">{step.runsNeeded}r · {formatTime(step.timePerRun * step.runsNeeded)}</span>
                      </div>
                      <div className="mt-0.5 space-y-px pl-2">
                        {step.inputs.map((inp, j) => (
                          <div key={j} className="flex items-center gap-1 text-[10px] text-eve-muted">
                            <span className="text-eve-dim">└</span>
                            <span>{inp.name} ×{inp.qty.toLocaleString()}</span>
                            {sourceTag(inp.source)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Component manufacturing steps ─────────────────────── */}
          {manufacturing.length > 0 && (
            <div>
              <SectionHeader id="mfg" icon={<Wrench size={10} className="text-eve-cyan" />} label={`Manufacturing  ·  ${mfgStructLabel}${system ? ' · ' + system : ''}`} count={manufacturing.length} color="text-eve-cyan" />
              {!collapsed['mfg'] && (
                <div className="pt-1 space-y-2">
                  {manufacturing.map((step, i) => (
                    <div key={step.key} className="pl-4 border-l border-eve-cyan/20">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-eve-cyan font-mono">
                          <span className="text-eve-dim text-[9px] mr-1">{i + 1}.</span>
                          {step.name} <span className="text-eve-muted">×{step.qtyNeeded.toLocaleString()}</span>
                        </span>
                        <span className="text-eve-dim text-[9px] shrink-0">{step.runsNeeded}r · {formatTime(step.timePerRun * step.runsNeeded)}</span>
                      </div>
                      <div className="mt-0.5 space-y-px pl-2">
                        {step.inputs.map((inp, j) => (
                          <div key={j} className="flex items-center gap-1 text-[10px] text-eve-muted">
                            <span className="text-eve-dim">└</span>
                            <span>{inp.name} ×{inp.qty.toLocaleString()}</span>
                            {sourceTag(inp.source)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Final product ─────────────────────────────────────── */}
          <div className="border border-eve-gold/30 bg-eve-gold/5 p-2">
            <div className="flex items-center gap-2">
              <Factory size={10} className="text-eve-gold shrink-0" />
              <span className="text-eve-gold text-[10px] uppercase tracking-wider">Final Output</span>
            </div>
            <div className="mt-1 text-eve-text font-mono">
              {chainData.productName} <span className="text-eve-gold">×{chainData.productQty.toLocaleString()}</span>
            </div>
            <div className="text-[9px] text-eve-dim mt-0.5">
              {manufacturing.length + reactions.length} production job{manufacturing.length + reactions.length !== 1 ? 's' : ''} · {chainData.buyList.filter(b => b.qty > b.have).length} materials to source
            </div>
          </div>
        </>)}
      </div>
    </motion.div>
  )
}

function BlueprintCalculator({
  initialBlueprint,
  characterId,
  accessToken,
  skills = [],
  assets = [],
}: {
  initialBlueprint: BlueprintImport | null
  characterId?: number
  accessToken?: string
  skills?: EveSkill[]
  assets?: EveAsset[]
}) {
  const [activeBlueprint, setActiveBlueprint] = useState<BlueprintImport | null>(initialBlueprint)

  // Blueprint controls
  const [me, setMe]   = useState(initialBlueprint?.me ?? 0)
  const [te, setTe]   = useState(initialBlueprint?.te ?? 0)
  const [runs, setRuns] = useState(Math.max(1, initialBlueprint?.runs ?? 1))

  // Manufacturing structure / rig / location
  const [structure, setStructure] = useState<StructureKey>('station')
  const [rig, setRig]             = useState<RigKey>('none')
  const [security, setSecurity]   = useState<SecurityKey>('null')
  const [system, setSystem]       = useState('')
  const [profileName, setProfileName] = useState('')

  // Reaction toggle + dropdowns
  const [reactionEnabled, setReactionEnabled]       = useState(false)
  const [reactionStructure, setReactionStructure]   = useState<ReactionStructureKey>('none')
  const [reactionRig, setReactionRig]               = useState<ReactionRigKey>('none')

  // Detailed steps toggle + popout + chain data
  const [detailedSteps, setDetailedSteps]     = useState(false)
  const [showStepsPopout, setShowStepsPopout]  = useState(false)
  const [chainData, setChainData]              = useState<ChainData | null>(null)
  const [chainLoading, setChainLoading]        = useState(false)
  const [chainError, setChainError]            = useState<string | null>(null)

  // Saved profiles
  const [profiles, setProfiles] = useState<BpProfile[]>(loadProfiles)

  // Blueprint data
  const [data, setData] = useState<BlueprintData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync when an import arrives from assets panel
  useEffect(() => {
    if (initialBlueprint) {
      setActiveBlueprint(initialBlueprint)
      setMe(initialBlueprint.me)
      setTe(initialBlueprint.te)
      setRuns(Math.max(1, initialBlueprint.runs))
      setSearchQuery('')
      setShowResults(false)
    }
  }, [initialBlueprint?.typeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetch_ = useCallback(async (
    me_: number, te_: number, runs_: number,
    structure_: string, rig_: string, security_: SecurityKey
  ) => {
    if (!activeBlueprint) return
    setLoading(true); setError(null)
    try {
      const industryLevel = skills.find(s => s.skillId === 3380)?.trainedLevel ?? 0
      const advIndLevel   = skills.find(s => s.skillId === 3388)?.trainedLevel ?? 0
      const params = new URLSearchParams({
        typeId: String(activeBlueprint.typeId),
        me: String(me_), te: String(te_), runs: String(runs_),
        structure: structure_, rig: rig_, security: security_,
        industryLevel: String(industryLevel),
        advIndLevel:   String(advIndLevel),
        ...(characterId ? { characterId: String(characterId) } : {}),
      })
      const res = await fetch(`/api/industry/blueprint?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Request failed')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally { setLoading(false) }
  }, [activeBlueprint?.typeId, characterId, skills])

  useEffect(() => {
    if (activeBlueprint) fetch_(me, te, runs, structure, rig, security)
  }, [activeBlueprint?.typeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = () => fetch_(me, te, runs, structure, rig, security)

  const fetchChain = useCallback(async () => {
    if (!activeBlueprint) return
    setChainLoading(true); setChainError(null)
    try {
      const params = new URLSearchParams({
        typeId: String(activeBlueprint.typeId),
        me: String(me), runs: String(runs),
        includeReactions: String(reactionEnabled),
        ...(characterId ? { characterId: String(characterId) } : {}),
      })
      const res = await fetch(`/api/industry/blueprint/chain?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Chain request failed')
      setChainData(json)
    } catch (err) {
      setChainError(err instanceof Error ? err.message : 'Unknown error')
    } finally { setChainLoading(false) }
  }, [activeBlueprint?.typeId, me, runs, reactionEnabled, characterId])

  // Auto-fetch chain when popout opens or when blueprint/reaction mode changes
  useEffect(() => {
    if (showStepsPopout && activeBlueprint) fetchChain()
  }, [showStepsPopout, activeBlueprint?.typeId, reactionEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Search logic
  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return }
    setSearching(true)
    try {
      const params = new URLSearchParams({ q })
      if (characterId) params.set('characterId', String(characterId))
      if (accessToken)  params.set('accessToken', accessToken)
      const res = await fetch(`/api/industry/blueprint/search?${params}`)
      const json = await res.json() as { results: SearchResult[] }
      setSearchResults(json.results ?? [])
      setShowResults(true)
    } catch { setSearchResults([]) }
    finally { setSearching(false) }
  }, [characterId, accessToken])

  const onSearchChange = (q: string) => {
    setSearchQuery(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.length < 2) { setSearchResults([]); setShowResults(false); return }
    searchTimer.current = setTimeout(() => runSearch(q), 350)
  }

  const selectBlueprint = (r: SearchResult) => {
    setActiveBlueprint({ typeId: r.typeId, typeName: r.name, me, te, runs })
    setData(null); setError(null)
    setSearchQuery(''); setShowResults(false)
  }

  // Profile save / load / delete
  const saveProfile = () => {
    const id = crypto.randomUUID()
    const label = profileName.trim() || [
      system.trim() || null,
      reactionEnabled
        ? REACTION_STRUCTURES.find(s => s.key === reactionStructure)?.label
        : STRUCTURES.find(s => s.key === structure)?.label,
      reactionEnabled
        ? (reactionRig !== 'none' ? REACTION_RIGS.find(r => r.key === reactionRig)?.label : null)
        : (rig !== 'none' ? RIGS.find(r => r.key === rig)?.label : null),
    ].filter(Boolean).join(' · ')
    const p: BpProfile = {
      id, name: label, system: system.trim(),
      structure, rig, security,
      reactionEnabled,
      reactionStructure,
      reactionRig,
    }
    const updated = [p, ...profiles]
    setProfiles(updated); saveProfiles(updated); setProfileName('')
  }

  const deleteProfile = (id: string) => {
    const updated = profiles.filter(p => p.id !== id)
    setProfiles(updated); saveProfiles(updated)
  }

  const applyProfile = (p: BpProfile) => {
    setStructure(p.structure); setRig(p.rig); setSecurity(p.security); setSystem(p.system)
    if (p.reactionEnabled !== undefined) setReactionEnabled(p.reactionEnabled)
    if (p.reactionStructure) setReactionStructure(p.reactionStructure)
    if (p.reactionRig)       setReactionRig(p.reactionRig)
    fetch_(me, te, runs, p.structure, p.rig, p.security)
  }

  // Client-side asset map — used to overlay server have/need values with live inventory
  const clientAssetMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const a of assets) {
      if (a.typeId != null) map.set(a.typeId, (map.get(a.typeId) ?? 0) + a.quantity)
    }
    return map
  }, [assets])

  // Enrich server materials with client-side quantities (client is always fresher than server cache)
  const enrichedMaterials = useMemo(() => {
    if (!data) return []
    if (clientAssetMap.size === 0) return data.materials  // no client data, use server values
    return data.materials.map(mat => {
      const have = clientAssetMap.get(mat.typeId) ?? 0
      const need = Math.max(0, mat.adjQty - have)
      return { ...mat, have, need }
    })
  }, [data, clientAssetMap])

  const hasMissing = enrichedMaterials.some(m => m.need > 0)
  const structInfo = STRUCTURES.find(s => s.key === structure)!
  const rigInfo    = RIG_BONUSES[rig][security]
  const rxStructInfo = REACTION_STRUCTURES.find(s => s.key === reactionStructure)!
  const rxRigInfo    = REACTION_RIG_BONUSES[reactionRig][security]

  return (
    <div className="flex flex-col gap-3">

      {/* ── Search bar ─────────────────────────────────────────────── */}
      <div className="relative">
        <div className="flex items-center border border-eve-border bg-black/20 px-2 gap-2">
          <Search size={11} className="text-eve-muted shrink-0" />
          <input
            className="flex-1 bg-transparent py-2 text-xs text-eve-text placeholder:text-eve-dim outline-none"
            placeholder="Search any blueprint…"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 150)}
          />
          {searching && <div className="w-2 h-2 rounded-full bg-eve-cyan animate-pulse shrink-0" />}
          {searchQuery && !searching && (
            <button onClick={() => { setSearchQuery(''); setShowResults(false) }} className="text-eve-dim hover:text-eve-muted">
              <X size={10} />
            </button>
          )}
        </div>
        {showResults && searchResults.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 border border-eve-border bg-[#0a0e14] shadow-xl max-h-56 overflow-y-auto">
            {searchResults.map(r => (
              <button key={r.typeId} onMouseDown={() => selectBlueprint(r)}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-eve-cyan/10 hover:text-eve-cyan transition-colors
                  ${activeBlueprint?.typeId === r.typeId ? 'text-eve-cyan bg-eve-cyan/5' : 'text-eve-text'}`}
              >{r.name}</button>
            ))}
          </div>
        )}
        {showResults && !searching && searchQuery.length >= 2 && searchResults.length === 0 && (
          <div className="absolute z-50 top-full left-0 right-0 border border-eve-border bg-[#0a0e14] px-3 py-2 text-[11px] text-eve-muted">
            No blueprints found for "{searchQuery}"
          </div>
        )}
      </div>

      {/* ── Toggles row ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        {/* Reaction toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none group">
          <button
            role="switch"
            aria-checked={reactionEnabled}
            onClick={() => {
              setReactionEnabled(v => !v)
              setData(null)
              setChainData(null)
            }}
            className={`relative w-7 h-4 border transition-colors ${reactionEnabled ? 'border-eve-green bg-eve-green/20' : 'border-eve-border bg-black/30'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 transition-all ${reactionEnabled ? 'left-3.5 bg-eve-green' : 'left-0.5 bg-eve-dim'}`} />
          </button>
          <span className={`text-[10px] uppercase tracking-wider transition-colors ${reactionEnabled ? 'text-eve-green' : 'text-eve-muted group-hover:text-eve-text'}`}>
            Reaction Jobs
          </span>
        </label>

        {/* Detailed steps toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none group">
          <button
            role="switch"
            aria-checked={detailedSteps}
            onClick={() => setDetailedSteps(v => !v)}
            className={`relative w-7 h-4 border transition-colors ${detailedSteps ? 'border-eve-cyan bg-eve-cyan/20' : 'border-eve-border bg-black/30'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 transition-all ${detailedSteps ? 'left-3.5 bg-eve-cyan' : 'left-0.5 bg-eve-dim'}`} />
          </button>
          <span className={`text-[10px] uppercase tracking-wider transition-colors ${detailedSteps ? 'text-eve-cyan' : 'text-eve-muted group-hover:text-eve-text'}`}>
            Detailed Steps
          </span>
        </label>
      </div>

      {!activeBlueprint ? (
        <div className="flex flex-col items-center justify-center text-center gap-2 py-12">
          <div className="text-eve-cyan/20 text-4xl">◈</div>
          <div className="text-eve-muted text-xs">Search for a blueprint above,</div>
          <div className="text-eve-dim text-[10px]">or click the flask icon on any blueprint in your assets</div>
        </div>
      ) : (<>

      {/* ── Blueprint header ───────────────────────────────────────── */}
      <div className="eve-panel p-3 flex flex-col gap-3">

        {/* Name + badge + steps button */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-eve-cyan text-xs font-mono truncate">{activeBlueprint.typeName}</div>
            {data && <div className="text-eve-muted text-[10px]">→ {data.productQty > 1 ? `${data.productQty}× ` : ''}{data.productName}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {detailedSteps && (
              <button
                onClick={() => setShowStepsPopout(v => !v)}
                className={`text-[9px] border px-1.5 py-0.5 transition-colors ${showStepsPopout ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10' : 'border-eve-border text-eve-muted hover:border-eve-cyan/50 hover:text-eve-cyan'}`}
              >
                {chainLoading ? '…' : 'VIEW STEPS'}
              </button>
            )}
            {data && (
              <div className={`text-[9px] border px-1.5 py-0.5 ${hasMissing ? 'border-eve-orange text-eve-orange' : 'border-eve-green text-eve-green'}`}>
                {hasMissing ? 'MISSING MATS' : 'READY'}
              </div>
            )}
          </div>
        </div>

        {/* Row 1: ME / TE / Runs */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="eve-label text-[9px] mb-1">ME ({me})</div>
            <input type="range" min={0} max={10} value={me}
              onChange={e => setMe(Number(e.target.value))}
              onMouseUp={refetch} onTouchEnd={refetch}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>
          <div>
            <div className="eve-label text-[9px] mb-1">TE ({te})</div>
            <input type="range" min={0} max={20} value={te}
              onChange={e => setTe(Number(e.target.value))}
              onMouseUp={refetch} onTouchEnd={refetch}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>
          <div>
            <div className="eve-label text-[9px] mb-1">RUNS</div>
            <input type="number" min={1} value={runs}
              onChange={e => setRuns(Math.max(1, Number(e.target.value)))}
              onBlur={refetch} onKeyDown={e => e.key === 'Enter' && refetch()}
              className="eve-input w-full py-0.5 text-xs text-center"
            />
          </div>
        </div>

        {/* Row 2: Manufacturing Structure / Rig / Security — always visible */}
        <div>
          <div className="eve-label text-[9px] mb-1 text-eve-cyan/60 uppercase tracking-widest">Manufacturing Structure</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="eve-label text-[9px] mb-1">
                STRUCTURE {structInfo.me > 0 && <span className="text-eve-green">−{structInfo.me}% ME −{structInfo.te}% TE</span>}
              </div>
              <select value={structure}
                onChange={e => { const v = e.target.value as StructureKey; setStructure(v); fetch_(me, te, runs, v, rig, security) }}
                className="eve-input w-full py-1 text-[10px] cursor-pointer"
              >
                {STRUCTURES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <div className="eve-label text-[9px] mb-1">
                RIG {rigInfo.me > 0 && <span className="text-eve-green">−{rigInfo.me}% ME −{rigInfo.te}% TE</span>}
              </div>
              <select value={rig}
                onChange={e => { const v = e.target.value as RigKey; setRig(v); fetch_(me, te, runs, structure, v, security) }}
                className="eve-input w-full py-1 text-[10px] cursor-pointer"
              >
                {RIGS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <div className="eve-label text-[9px] mb-1">SECURITY</div>
              <select value={security}
                onChange={e => { const v = e.target.value as SecurityKey; setSecurity(v); fetch_(me, te, runs, structure, rig, v) }}
                className={`eve-input w-full py-1 text-[10px] cursor-pointer ${rig === 'none' ? 'opacity-40' : ''}`}
                disabled={rig === 'none'}
              >
                {SECURITIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Row 3: Reaction Structure / Rig — only when reaction toggle is on */}
        {reactionEnabled && (
          <div>
            <div className="eve-label text-[9px] mb-1 text-eve-green/60 uppercase tracking-widest">Reaction Structure</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="eve-label text-[9px] mb-1">
                  STRUCTURE {rxStructInfo.te > 0 && <span className="text-eve-green">−{rxStructInfo.te}% TE</span>}
                </div>
                <select value={reactionStructure}
                  onChange={e => setReactionStructure(e.target.value as ReactionStructureKey)}
                  className="eve-input w-full py-1 text-[10px] cursor-pointer"
                >
                  {REACTION_STRUCTURES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <div className="eve-label text-[9px] mb-1">
                  RIG {rxRigInfo.te > 0 && <span className="text-eve-green">−{rxRigInfo.te}% TE</span>}
                </div>
                <select value={reactionRig}
                  onChange={e => setReactionRig(e.target.value as ReactionRigKey)}
                  className="eve-input w-full py-1 text-[10px] cursor-pointer"
                >
                  {REACTION_RIGS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <div className="eve-label text-[9px] mb-1">SECURITY</div>
                <select value={security}
                  onChange={e => { const v = e.target.value as SecurityKey; setSecurity(v); fetch_(me, te, runs, structure, rig, v) }}
                  className={`eve-input w-full py-1 text-[10px] cursor-pointer ${reactionRig === 'none' ? 'opacity-40' : ''}`}
                  disabled={reactionRig === 'none'}
                >
                  {SECURITIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Row 3: System + Name + Save */}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <div className="eve-label text-[9px] mb-1">SYSTEM</div>
            <input className="eve-input w-full py-1 text-[10px]" placeholder="e.g. MB-NKE"
              value={system} onChange={e => setSystem(e.target.value)} />
          </div>
          <div className="flex-1">
            <div className="eve-label text-[9px] mb-1">PROFILE NAME <span className="text-eve-dim">(optional)</span></div>
            <input className="eve-input w-full py-1 text-[10px]" placeholder="Auto-generated if blank"
              value={profileName} onChange={e => setProfileName(e.target.value)} />
          </div>
          <button onClick={saveProfile} className="eve-btn-primary px-3 py-1 text-[10px] shrink-0">SAVE</button>
        </div>

        {/* Saved profile chips */}
        {profiles.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-eve-border/40">
            {profiles.map(p => (
              <div key={p.id} className="flex items-center gap-0.5 border border-eve-border/60 bg-black/20 text-[9px]">
                <button onClick={() => applyProfile(p)}
                  className="px-2 py-0.5 text-eve-muted hover:text-eve-cyan transition-colors flex items-center gap-1"
                  title={p.system ? `System: ${p.system}` : undefined}
                >
                  {p.reactionEnabled && <span className="text-eve-green/60">⟳</span>}
                  {p.name}
                </button>
                <button onClick={() => deleteProfile(p.id)} className="pr-1.5 text-eve-dim hover:text-eve-red transition-colors">
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="text-eve-muted text-[11px] animate-pulse text-center py-2">Loading blueprint data…</div>}
      {error   && <div className="text-eve-red text-[11px] text-center py-2">{error}</div>}

      {data && !loading && (
        <>
          {/* ── Time + breakdown ──────────────────────────────────── */}
          <div className="eve-panel p-3 flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="eve-header mb-0.5">MANUFACTURING TIME</div>
                <div className="text-eve-cyan font-mono text-sm">{formatTime(data.adjustedTime)}</div>
                <div className="text-eve-dim text-[9px]">
                  Base {formatTime(data.baseTime)} per run
                  {data.adjustedTime < data.baseTime * runs && ` · saves ${formatTime(data.baseTime * runs - data.adjustedTime)}`}
                </div>
              </div>
              <div className="text-right text-[10px]">
                <div className="text-eve-muted">{runs} run{runs !== 1 ? 's' : ''}</div>
                {data.productQty * runs > 1 && (
                  <div className="text-eve-text">{(data.productQty * runs).toLocaleString()} units out</div>
                )}
              </div>
            </div>
            {data.timeBreakdown.length > 0 && (
              <div className="border-t border-eve-border/40 pt-2">
                <div className="eve-label text-[9px] mb-1">REDUCTION BREAKDOWN</div>
                <div className="space-y-px">
                  {data.timeBreakdown.map((row, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px]">
                      <span className="text-eve-muted">{row.label}</span>
                      <span className="text-eve-green font-mono">−{row.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Required Skills ────────────────────────────────────── */}
          {data.requiredSkills.length > 0 && (() => {
            const skillMap = new Map(skills.map(s => [s.skillId, s.trainedLevel]))
            const canManufacture = data.requiredSkills.every(s => (skillMap.get(s.typeId) ?? 0) >= s.requiredLevel)
            return (
              <div className="eve-panel p-3">
                <div className="eve-header mb-2 flex items-center justify-between">
                  <span>REQUIRED SKILLS</span>
                  <span className={`text-[9px] border px-1.5 py-0.5 ${canManufacture ? 'border-eve-green text-eve-green' : 'border-eve-orange text-eve-orange'}`}>
                    {canManufacture ? 'CAN BUILD' : 'MISSING SKILLS'}
                  </span>
                </div>
                <div className="space-y-1">
                  {data.requiredSkills.map(s => {
                    const have = skillMap.get(s.typeId) ?? 0
                    const ok = have >= s.requiredLevel
                    return (
                      <div key={s.typeId} className="flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-1.5">
                          {ok ? <CheckCircle2 size={10} className="text-eve-green shrink-0" />
                              : <XCircle      size={10} className="text-eve-orange shrink-0" />}
                          <span className={ok ? 'text-eve-text' : 'text-eve-orange'}>{s.name}</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-eve-dim">Req L{s.requiredLevel}</span>
                          <span className={ok ? 'text-eve-green' : 'text-eve-orange'}>
                            {skills.length > 0 ? `Have L${have}` : <span className="text-eve-dim italic text-[9px]">no data</span>}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {skills.length > 0 && (() => {
                  const skillMap2 = new Map(skills.map(s => [s.skillId, s.trainedLevel]))
                  const indLv = skillMap2.get(3380) ?? 0
                  const advLv = skillMap2.get(3388) ?? 0
                  if (indLv === 0 && advLv === 0) return null
                  return (
                    <div className="mt-2 pt-2 border-t border-eve-border/40">
                      <div className="eve-label text-[9px] mb-1">SKILL TIME BONUSES</div>
                      <div className="space-y-px">
                        {indLv > 0 && <div className="flex justify-between text-[10px]"><span className="text-eve-muted">Industry L{indLv}</span><span className="text-eve-green font-mono">−{indLv * 4}% time</span></div>}
                        {advLv > 0 && <div className="flex justify-between text-[10px]"><span className="text-eve-muted">Advanced Industry L{advLv}</span><span className="text-eve-green font-mono">−{advLv * 3}% time</span></div>}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {/* ── Materials ──────────────────────────────────────────── */}
          <div className="eve-panel p-3 flex flex-col">
            <div className="eve-header mb-2 flex items-center justify-between">
              <span>MATERIALS</span>
              <span className="text-eve-muted font-normal text-[9px]">
                {enrichedMaterials.filter(m => m.need === 0).length}/{enrichedMaterials.length} covered
              </span>
            </div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-eve-dim border-b border-eve-border/40">
                  <th className="text-left pb-1 font-normal">MATERIAL</th>
                  <th className="text-right pb-1 font-normal">NEED</th>
                  <th className="text-right pb-1 font-normal">HAVE</th>
                  <th className="text-right pb-1 font-normal pl-2">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {enrichedMaterials.map(mat => (
                  <tr key={mat.typeId} className="border-b border-eve-border/20">
                    <td className="py-1 text-eve-text truncate max-w-[120px]">{mat.name}</td>
                    <td className="py-1 text-right font-mono text-eve-text">
                      {mat.adjQty.toLocaleString()}
                      {mat.adjQty < mat.baseQty * runs && (
                        <span className="text-eve-dim ml-1 text-[9px]">(base {(mat.baseQty * runs).toLocaleString()})</span>
                      )}
                    </td>
                    <td className="py-1 text-right font-mono text-eve-muted">{mat.have.toLocaleString()}</td>
                    <td className="py-1 pl-2 text-right">
                      {mat.need === 0
                        ? <CheckCircle2 size={10} className="inline text-eve-green" />
                        : <span className="text-eve-orange font-mono">−{mat.need.toLocaleString()}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      </>)}

      {/* ── Steps Popout (portal-like fixed overlay) ─────────────── */}
      <AnimatePresence>
        {showStepsPopout && activeBlueprint && (
          <StepsPopout
            blueprint={activeBlueprint}
            chainData={chainData}
            chainLoading={chainLoading}
            chainError={chainError}
            mfgStructure={structure}
            mfgRig={rig}
            rxStructure={reactionStructure}
            rxRig={reactionRig}
            security={security}
            system={system}
            onClose={() => setShowStepsPopout(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default function IndustryPanel({ jobs, loading, onRefresh, freightImport, onFreightImportClear, blueprintImport, onBlueprintImportClear, characterId, accessToken, skills, assets, allIndustryJobs, characters }: IndustryPanelProps) {
  const [tab, setTab] = useState<'jobs' | 'freight' | 'blueprint'>('jobs')
  const activeJobs = jobs.filter(j => j.status === 'active')
  const readyJobs = jobs.filter(j => j.status === 'ready')

  const byActivity = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.activityName] = (acc[j.activityName] || 0) + 1
    return acc
  }, {})

  // Auto-switch when imports arrive
  useEffect(() => { if (freightImport) setTab('freight') }, [freightImport])
  useEffect(() => { if (blueprintImport) setTab('blueprint') }, [blueprintImport])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="eve-header mb-0">INDUSTRY OPERATIONS</span>
        <button onClick={onRefresh} className="eve-btn p-1">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex border border-eve-border flex-shrink-0">
        <button
          onClick={() => setTab('jobs')}
          className={`flex items-center gap-1.5 flex-1 px-2 py-1.5 text-[10px] uppercase tracking-widest transition-colors
            ${tab === 'jobs' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
        >
          <Factory size={10} />JOBS
          {readyJobs.length > 0 && (
            <span className="ml-auto text-eve-green text-[9px]">{readyJobs.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab('freight')}
          className={`flex items-center gap-1.5 flex-1 px-2 py-1.5 text-[10px] uppercase tracking-widest transition-colors border-l border-eve-border
            ${tab === 'freight' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
        >
          <Truck size={10} />FREIGHT
          {freightImport && tab !== 'freight' && (
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-eve-cyan animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setTab('blueprint')}
          className={`flex items-center gap-1.5 flex-1 px-2 py-1.5 text-[10px] uppercase tracking-widest transition-colors border-l border-eve-border
            ${tab === 'blueprint' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
        >
          <FlaskConical size={10} />BLUEPRINT
          {blueprintImport && tab !== 'blueprint' && (
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-eve-cyan animate-pulse" />
          )}
        </button>
      </div>

      {tab === 'jobs' ? (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 flex-shrink-0">
            {[
              { label: 'ACTIVE', value: activeJobs.length, color: 'text-eve-cyan' },
              { label: 'READY', value: readyJobs.length, color: 'text-eve-green' },
              { label: 'TOTAL', value: jobs.length, color: 'text-eve-text' },
            ].map(stat => (
              <div key={stat.label} className="eve-panel p-2 text-center">
                <div className={`text-xl font-mono ${stat.color}`}>{stat.value}</div>
                <div className="eve-label text-[9px]">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Activity breakdown */}
          {Object.keys(byActivity).length > 0 && (
            <div className="eve-panel p-3 flex-shrink-0">
              <div className="eve-header">ACTIVITY BREAKDOWN</div>
              <div className="space-y-1">
                {Object.entries(byActivity).map(([name, count]) => (
                  <div key={name} className="flex justify-between items-center">
                    <span className={`text-xs ${ACTIVITY_COLORS[name] || 'text-eve-muted'}`}>{name}</span>
                    <span className="text-eve-muted text-xs">{count} job{count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Job list */}
          <div className="eve-panel p-3 flex flex-col">
            <div className="eve-header flex items-center gap-2">
              <Factory size={11} /> ACTIVE JOBS
            </div>
            {jobs.length === 0 ? (
              <div className="flex items-center justify-center text-eve-muted text-xs py-6">
                NO ACTIVE INDUSTRY JOBS
              </div>
            ) : (() => {
              const multiChar = allIndustryJobs && characters && Object.keys(allIndustryJobs).length > 1
              if (multiChar) {
                return (
                  <div className="space-y-4">
                    {characters!
                      .filter(c => allIndustryJobs![c.characterId]?.length)
                      .map(c => {
                        const charJobs = [...(allIndustryJobs![c.characterId] ?? [])]
                          .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
                        return (
                          <div key={c.characterId}>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="text-[9px] uppercase tracking-widest text-eve-cyan/70 font-mono">{c.characterName}</div>
                              <div className="flex-1 h-px bg-eve-cyan/20" />
                              <div className="text-[9px] text-eve-muted">{charJobs.length} job{charJobs.length !== 1 ? 's' : ''}</div>
                            </div>
                            <div className="space-y-2">
                              {charJobs.map(job => (
                                <div key={job.jobId} className="border border-eve-border/50 p-2 relative">
                                  <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-eve-cyan/30" />
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="text-eve-text text-xs truncate">{job.blueprintTypeName}</div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-[10px] ${ACTIVITY_COLORS[job.activityName] || 'text-eve-muted'}`}>{job.activityName}</span>
                                        <span className="text-eve-dim text-[10px]">×{job.runs}</span>
                                      </div>
                                    </div>
                                    <span className={`text-[10px] border px-1.5 py-0.5 uppercase ${STATUS_COLORS[job.status] || 'text-eve-muted border-eve-dim'}`}>
                                      {job.status}
                                    </span>
                                  </div>
                                  {job.status === 'active' && <JobProgress job={job} />}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )
              }
              return (
                <div className="space-y-3">
                  {[...jobs]
                    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
                    .map(job => (
                      <div key={job.jobId} className="border border-eve-border/50 p-2 relative">
                        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-eve-cyan/30" />
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-eve-text text-xs truncate">{job.blueprintTypeName}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[10px] ${ACTIVITY_COLORS[job.activityName] || 'text-eve-muted'}`}>{job.activityName}</span>
                              <span className="text-eve-dim text-[10px]">×{job.runs}</span>
                            </div>
                          </div>
                          <span className={`text-[10px] border px-1.5 py-0.5 uppercase ${STATUS_COLORS[job.status] || 'text-eve-muted border-eve-dim'}`}>
                            {job.status}
                          </span>
                        </div>
                        {job.status === 'active' && <JobProgress job={job} />}
                      </div>
                    ))}
                </div>
              )
            })()}
          </div>
        </>
      ) : tab === 'freight' ? (
        <FreightCalculator
          freightImport={freightImport}
          onFreightImportClear={onFreightImportClear}
        />
      ) : (
        <BlueprintCalculator
          initialBlueprint={blueprintImport ?? null}
          characterId={characterId}
          accessToken={accessToken}
          skills={skills}
          assets={assets}
        />
      )}
    </div>
  )
}

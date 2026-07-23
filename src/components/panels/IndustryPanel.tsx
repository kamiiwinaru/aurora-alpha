import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, Factory, Truck, AlertTriangle, ArrowRight, FlaskConical, CheckCircle2, XCircle, Search, X, ShoppingCart, Zap, Wrench, ChevronDown, ChevronRight as ChevronRightIcon, Copy, Check, Download, TrendingUp, TrendingDown, Minus, Upload } from 'lucide-react'
import type { EveIndustryJob, EveSkill, EveAsset, EveCharacter } from '../../types'
import { timeUntil, formatISK } from '../../lib/eve-esi'
import ExcelJS from 'exceljs'

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

function copyToClipboard(text: string) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

function CopyBtn({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { copyToClipboard(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className={`text-eve-dim hover:text-eve-cyan transition-colors ${className}`}
      title="Copy"
    >
      {copied ? <Check size={11} className="text-eve-green" /> : <Copy size={11} />}
    </button>
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
            <div className="flex items-center gap-1.5">
              {volExceeded && (
                <span className="text-eve-red text-[9px] flex items-center gap-1">
                  <AlertTriangle size={9} />EXCEEDS MAX
                </span>
              )}
              {vol > 0 && <CopyBtn value={String(Math.round(vol))} />}
            </div>
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
          <div className="eve-label mb-1 flex items-center justify-between">
            <span>COLLATERAL (ISK)</span>
            {col > 0 && <CopyBtn value={String(Math.round(col))} />}
          </div>
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
                <div className="flex items-center gap-2">
                  <CopyBtn value={String(total)} />
                  <span className="text-sm font-mono text-eve-cyan text-glow-cyan">{formatISK(total)}</span>
                </div>
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
  { key: 'station', label: 'NPC Station',  me: 0, te: 0,  costReduction: 0 },
  { key: 'raitaru', label: 'Raitaru',       me: 1, te: 15, costReduction: 3 },
  { key: 'azbel',   label: 'Azbel',         me: 1, te: 20, costReduction: 3 },
  { key: 'sotiyo',  label: 'Sotiyo',        me: 1, te: 30, costReduction: 3 },
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
  qtyPerRun: number
  runsNeeded: number
  activity: 'manufacturing' | 'reaction'
  timePerRun: number
  bpTypeId?: number
  inputs: Array<{ typeId: number; name: string; qty: number; source: 'buy' | 'manufacture' | 'react' }>
}

interface FinalStep {
  name: string
  productTypeId: number | null
  runs: number
  qtyPerRun: number
  timePerRun?: number  // seconds per run (from BlueprintData.adjustedTime)
}

function flattenChainToSteps(chain: ChainNode[]): FlatStep[] {
  const seen = new Map<number, FlatStep & { _qtyPerRun: number }>()
  const order: number[] = []

  function visit(node: ChainNode) {
    for (const child of node.materials) visit(child)
    if (node.activity === 'raw') return
    if (seen.has(node.typeId)) {
      const ex = seen.get(node.typeId)!
      ex.qtyNeeded += node.qtyNeeded
      ex.runsNeeded = Math.ceil(ex.qtyNeeded / Math.max(1, ex._qtyPerRun))
      return
    }
    order.push(node.typeId)
    seen.set(node.typeId, {
      key: `${node.typeId}`,
      typeId: node.typeId,
      name: node.name,
      qtyNeeded: node.qtyNeeded,
      qtyPerRun: node.qtyPerRun,
      _qtyPerRun: node.qtyPerRun,
      runsNeeded: node.runsNeeded,
      activity: node.activity,
      timePerRun: node.timePerRun,
      bpTypeId: node.bpTypeId,
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

// ── Cascade inventory adjustments through the chain ─────────────────────────
// Process steps in reverse topological order (parents before their inputs).
// When a step can be partially or fully skipped due to inventory, propagate
// the reduction to its inputs so downstream demand is accurate.
function computeAdjustedChain(
  steps: FlatStep[],
  buyList: BuyItem[],
  clientAssetMap: Map<number, number>,
  overrideSet?: Set<number>
): {
  stepAdj: Map<number, { have: number; adjQty: number; adjRuns: number }>
  buyAdj:  Map<number, { have: number; adjQty: number }>
} {
  // Mutable needed-qty map covering both intermediate steps and raw buy items
  const qtyMap = new Map<number, number>()
  for (const s of steps)  qtyMap.set(s.typeId, s.qtyNeeded)
  for (const b of buyList) qtyMap.set(b.typeId, b.qty)

  const stepAdj = new Map<number, { have: number; adjQty: number; adjRuns: number }>()

  // Reverse order = parents before their dependencies, so savings propagate down
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]
    // If the user overrides this step, treat inventory as 0 — force full production
    const haveRaw  = clientAssetMap.get(step.typeId) ?? 0
    const have     = overrideSet?.has(step.typeId) ? 0 : haveRaw
    const curQty   = qtyMap.get(step.typeId) ?? step.qtyNeeded
    const adjQty   = Math.max(0, curQty - have)
    const adjRuns  = adjQty > 0 ? Math.ceil(adjQty / Math.max(1, step.qtyPerRun)) : 0
    stepAdj.set(step.typeId, { have: haveRaw, adjQty, adjRuns })

    // Propagate run savings to every input (buy AND manufactured/reacted)
    const savedRuns = step.runsNeeded - adjRuns
    if (savedRuns > 0) {
      for (const inp of step.inputs) {
        const qtyPerRun = inp.qty / Math.max(1, step.runsNeeded)
        const saved     = savedRuns * qtyPerRun
        qtyMap.set(inp.typeId, Math.max(0, (qtyMap.get(inp.typeId) ?? 0) - saved))
      }
    }
  }

  const buyAdj = new Map<number, { have: number; adjQty: number }>()
  for (const b of buyList) {
    const adjQty = Math.max(0, Math.round(qtyMap.get(b.typeId) ?? b.qty))
    // Use client-side inventory for raw materials if available (fresher than server cache)
    const have   = clientAssetMap.get(b.typeId) ?? b.have
    buyAdj.set(b.typeId, { have, adjQty: Math.max(0, adjQty - have) })
  }

  return { stepAdj, buyAdj }
}

// ── Detailed Steps Popout ────────────────────────────────────────────────────
function StepsPopout({
  blueprint, chainData, chainLoading, chainError,
  mfgStructure, mfgRig, rxStructure, rxRig, security, system,
  clientAssetMap, ownedBpTypeIds, exportName, finalSteps,
  onClose,
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
  clientAssetMap?: Map<number, number>
  ownedBpTypeIds?: Set<number>
  exportName?: string
  finalSteps?: FinalStep[]
  onClose: () => void
}) {
  const [pos, setPos] = useState({ x: 60, y: 60 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [overrideSet, setOverrideSet] = useState<Set<number>>(new Set())

  const toggleOverride = (typeId: number) => {
    setOverrideSet(prev => {
      const next = new Set(prev)
      if (next.has(typeId)) next.delete(typeId)
      else next.add(typeId)
      return next
    })
  }

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

  const simpleReactions  = steps.filter(s => s.activity === 'reaction' && s.inputs.every(i => i.source !== 'react'))
  const advReactions     = steps.filter(s => s.activity === 'reaction' && s.inputs.some(i => i.source === 'react'))
  const manufacturing    = steps.filter(s => s.activity === 'manufacturing')

  // Manufacturing steps whose outputs feed a reaction come before simple reactions (e.g. fuel blocks)
  const reactionInputIds = new Set(
    steps.filter(s => s.activity === 'reaction')
         .flatMap(s => s.inputs.filter(i => i.source === 'manufacture').map(i => i.typeId))
  )
  const mfgIntermediates = manufacturing.filter(s => reactionInputIds.has(s.typeId))
  const mfgFinal         = manufacturing.filter(s => !reactionInputIds.has(s.typeId))

  // Cascaded inventory adjustment — if you have an intermediate, its inputs are also reduced
  const adjusted = useMemo(() => {
    if (!chainData || !clientAssetMap) return null
    return computeAdjustedChain(steps, chainData.buyList, clientAssetMap, overrideSet)
  }, [steps, chainData, clientAssetMap, overrideSet])

  const exportXLSX = async () => {
    if (!chainData) return

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Aurora'
    wb.created = new Date()
    const ws = wb.addWorksheet('Build Chain', { views: [{ state: 'frozen', ySplit: 3 }] })

    // ── Column definitions ───────────────────────────────────────────
    ws.columns = [
      { key: 'name',    width: 38 },
      { key: 'qty',     width: 14 },
      { key: 'have',    width: 12 },
      { key: 'adjQty',  width: 14 },
      { key: 'adjRuns', width: 10 },
      { key: 'time',    width: 14 },
      { key: 'source',  width: 10 },
      { key: 'status',  width: 28 },
    ]

    // ── Color palette ────────────────────────────────────────────────
    const C = {
      bg:         'FF0A0E14',
      panelBg:    'FF0D1117',
      white:      'FFFFFFFF',
      cyan:       'FF00D4FF',
      cyanDark:   'FF003A44',
      green:      'FF39C96E',
      greenDark:  'FF003318',
      purple:     'FFC084FC',
      purpleDark: 'FF1E0D35',
      gold:       'FFFFC040',
      goldDark:   'FF302000',
      orange:     'FFFFA040',
      orangeDark: 'FF3A1800',
      red:        'FFFF4040',
      muted:      'FFB8944A',
      dim:        'FF606060',
      border:     'FF1E2A38',
      rowAlt:     'FF0D1520',
    }

    type ARGB = string
    const fill   = (argb: ARGB): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
    const border = (): Partial<ExcelJS.Borders> => ({
      bottom: { style: 'thin', color: { argb: C.border } },
    })
    const font = (argb: ARGB, bold = false, sz = 10): Partial<ExcelJS.Font> => ({ color: { argb }, bold, size: sz, name: 'Consolas' })

    // ── Helper: set a full row's fill + bottom border ────────────────
    const styleRow = (row: ExcelJS.Row, fillArgb: ARGB, fontArgb = C.white, bold = false, sz = 10) => {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill  = fill(fillArgb)
        cell.font  = font(fontArgb, bold, sz)
        cell.border = border()
        cell.alignment = { vertical: 'middle', wrapText: false }
      })
    }

    // ── Helper: merge + write a section header ───────────────────────
    const sectionHeader = (label: string, bgArgb: ARGB, fgArgb: ARGB) => {
      const r = ws.addRow(['', '', '', '', '', '', '', ''])
      ws.mergeCells(r.number, 1, r.number, 8)
      const cell = ws.getCell(r.number, 1)
      cell.value = label
      cell.fill  = fill(bgArgb)
      cell.font  = font(fgArgb, true, 11)
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
      cell.border = { bottom: { style: 'medium', color: { argb: fgArgb } } }
      r.height = 18
    }

    // ── Helper: column header row ────────────────────────────────────
    const colHeaders = (labels: string[], bgArgb: ARGB, fgArgb: ARGB) => {
      const r = ws.addRow(labels)
      r.height = 15
      r.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.fill  = fill(bgArgb)
        cell.font  = font(fgArgb, true, 9)
        cell.border = { bottom: { style: 'thin', color: { argb: fgArgb } } }
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right', indent: col === 1 ? 1 : 0 }
      })
    }

    // ── Helper: add a BP alert row (spans all 8 cols) ────────────────
    const bpAlertRow = (isT2: boolean) => {
      const bgArgb = isT2 ? C.goldDark  : C.orangeDark
      const fgArgb = isT2 ? C.gold      : C.orange
      const icon   = isT2 ? '⚡ INVENTION REQUIRED' : '⚠  BLUEPRINT REQUIRED'
      const note   = isT2
        ? 'T2 blueprints cannot be purchased — run an Invention job from a T1 BPC to produce a limited-run T2 BPC.'
        : 'Obtain a BPC from your corp library, or purchase a BPO/BPC on the market or contracts.'
      const r = ws.addRow(['', '', '', '', '', '', '', ''])
      ws.mergeCells(r.number, 1, r.number, 3)
      ws.mergeCells(r.number, 4, r.number, 8)
      const hCell = ws.getCell(r.number, 1)
      const nCell = ws.getCell(r.number, 4)
      hCell.value = icon
      nCell.value = note
      ;[hCell, nCell].forEach(c => {
        c.fill      = fill(bgArgb)
        c.border    = { top: { style: 'thin', color: { argb: fgArgb } }, bottom: { style: 'thin', color: { argb: fgArgb } } }
        c.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
      })
      hCell.font = font(fgArgb, true, 9)
      nCell.font = font(C.muted, false, 9)
      r.height = 28
    }

    // ── Helper: write one production step + its inputs ───────────────
    const stepRows = (step: FlatStep, fgArgb: ARGB, rowBg: ARGB, altBg: ARGB) => {
      const adj      = adjusted?.stepAdj.get(step.typeId)
      const have     = adj?.have    ?? 0
      const adjQty   = adj?.adjQty  ?? step.qtyNeeded
      const adjRuns  = adj?.adjRuns ?? step.runsNeeded
      const allDone  = adjQty === 0
      const noBp     = step.bpTypeId != null && ownedBpTypeIds != null && ownedBpTypeIds.size > 0 && !ownedBpTypeIds.has(step.bpTypeId)
      const isT2     = noBp && step.activity === 'manufacturing' && / II$/.test(step.name)

      const status = allDone ? '✓ In inventory — skip' : noBp ? (isT2 ? 'Needs invention' : 'Blueprint required') : ''

      const r = ws.addRow([
        step.name,
        step.qtyNeeded,
        have || '',
        allDone ? '' : adjQty,
        allDone ? '' : adjRuns,
        allDone ? '' : formatTime(step.timePerRun * adjRuns),
        '',
        status,
      ])
      r.height = 14
      const rowFill = fill(rowBg)
      r.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.fill      = rowFill
        cell.border    = border()
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right', indent: col === 1 ? 1 : 0 }
      })
      // Name cell colour
      const nameCell = r.getCell(1)
      nameCell.font = font(allDone ? C.dim : fgArgb, true, 10)
      // Qty cells
      ;[2,3,4,5,6].forEach(c => { r.getCell(c).font = font(allDone ? C.dim : C.muted, false, 9) })
      // Status cell
      const sCell = r.getCell(8)
      if (allDone)  sCell.font = font(C.green, false, 9)
      else if (noBp) sCell.font = font(isT2 ? C.gold : C.orange, false, 9)
      else           sCell.font = font(C.dim, false, 9)

      if (noBp) bpAlertRow(isT2)

      // Input sub-rows
      step.inputs.forEach((inp, idx) => {
        const ir = ws.addRow([
          `  └  ${inp.name}`,
          inp.qty,
          '', '', '', '',
          inp.source.toUpperCase(),
          '',
        ])
        ir.height = 13
        const iBg = fill(idx % 2 === 0 ? altBg : rowBg)
        ir.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.fill      = iBg
          cell.border    = { bottom: { style: 'hair', color: { argb: C.border } } }
          cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
          cell.font      = font(C.dim, false, 9)
        })
        const srcCell = ir.getCell(7)
        srcCell.font = font(
          inp.source === 'buy' ? C.muted : inp.source === 'react' ? C.green : C.cyan,
          false, 8
        )
      })
    }

    // ════════════════════════════════════════════════════════════════
    // TITLE ROW
    // ════════════════════════════════════════════════════════════════
    ws.mergeCells(1, 1, 1, 8)
    const titleCell = ws.getCell(1, 1)
    titleCell.value = `${exportName ?? chainData.productName}  —  Build Chain`
    titleCell.fill  = fill(C.bg)
    titleCell.font  = font(C.cyan, true, 13)
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    titleCell.border = { bottom: { style: 'medium', color: { argb: C.cyan } } }
    ws.getRow(1).height = 24

    // META ROW
    ws.mergeCells(2, 1, 2, 8)
    const metaCell = ws.getCell(2, 1)
    const rxLabel  = REACTION_STRUCTURES.find(s => s.key === rxStructure)?.label ?? rxStructure
    metaCell.value = [
      `Structure: ${mfgStructLabel}`,
      security ? `Security: ${security}` : null,
      system   ? `System: ${system}` : null,
      (simpleReactions.length + advReactions.length) > 0 ? `Reaction Structure: ${rxLabel}` : null,
      `Generated: ${new Date().toLocaleString()}`,
    ].filter(Boolean).join('   ·   ')
    metaCell.fill  = fill(C.panelBg)
    metaCell.font  = font(C.muted, false, 9)
    metaCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    metaCell.border = { bottom: { style: 'thin', color: { argb: C.border } } }
    ws.getRow(2).height = 16

    // Spacer
    const spacer = () => {
      const r = ws.addRow([''])
      r.height = 6
      r.eachCell({ includeEmpty: true }, c => { c.fill = fill(C.bg) })
    }
    spacer()

    // ════════════════════════════════════════════════════════════════
    // RAW MATERIALS
    // ════════════════════════════════════════════════════════════════
    if (chainData.buyList.length > 0) {
      sectionHeader('  RAW MATERIALS', C.panelBg, C.muted)
      colHeaders(['Item', 'Qty Needed', 'Have', 'Qty to Buy', '', '', '', 'Status'], C.bg, C.dim)
      chainData.buyList.forEach((item, idx) => {
        const adj    = adjusted?.buyAdj.get(item.typeId)
        const have   = adj?.have   ?? item.have
        const adjQty = adj?.adjQty ?? Math.max(0, item.qty - item.have)
        const covered = adjQty === 0
        const r = ws.addRow([
          item.name,
          item.qty,
          have || '',
          covered ? '' : adjQty,
          '', '', '',
          covered ? '✓ Covered' : '',
        ])
        r.height = 14
        const bg = fill(idx % 2 === 0 ? C.panelBg : C.rowAlt)
        r.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.fill      = bg
          cell.border    = border()
          cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right', indent: col === 1 ? 1 : 0 }
          cell.font      = font(col === 1 ? C.white : C.muted, false, 10)
        })
        if (covered) r.getCell(8).font = font(C.green, false, 9)
        else if (adjQty > 0) r.getCell(4).font = font(C.orange, true, 10)
      })
      spacer()
    }

    // ════════════════════════════════════════════════════════════════
    // PRODUCTION SECTIONS
    // ════════════════════════════════════════════════════════════════
    const prodColHeaders = (bg: ARGB, fg: ARGB) =>
      colHeaders(['Item', 'Qty Needed', 'Have', 'Adj Qty', 'Runs', 'Time', 'Source', 'Status'], bg, fg)

    if (mfgIntermediates.length > 0) {
      sectionHeader('  MFG INTERMEDIATES', C.cyanDark, C.cyan)
      prodColHeaders(C.bg, C.dim)
      mfgIntermediates.forEach(s => stepRows(s, C.cyan, C.panelBg, C.rowAlt))
      spacer()
    }

    if (simpleReactions.length > 0) {
      sectionHeader(`  REACTIONS  ·  ${rxLabel}`, C.greenDark, C.green)
      prodColHeaders(C.bg, C.dim)
      simpleReactions.forEach(s => stepRows(s, C.green, C.panelBg, C.rowAlt))
      spacer()
    }

    if (advReactions.length > 0) {
      sectionHeader(`  ADVANCED REACTIONS  ·  ${rxLabel}`, C.purpleDark, C.purple)
      prodColHeaders(C.bg, C.dim)
      advReactions.forEach(s => stepRows(s, C.purple, C.panelBg, C.rowAlt))
      spacer()
    }

    if (mfgFinal.length > 0) {
      sectionHeader(`  MANUFACTURING  ·  ${mfgStructLabel}`, C.cyanDark, C.cyan)
      prodColHeaders(C.bg, C.dim)
      mfgFinal.forEach(s => stepRows(s, C.cyan, C.panelBg, C.rowAlt))
      spacer()
    }

    // ════════════════════════════════════════════════════════════════
    // FINAL ASSEMBLY
    // ════════════════════════════════════════════════════════════════
    if (finalSteps && finalSteps.length > 0) {
      sectionHeader(`  FINAL ASSEMBLY  ·  ${mfgStructLabel}${system ? '  ·  ' + system : ''}`, C.goldDark, C.gold)
      colHeaders(['Item', 'Qty to Build', 'Have', '', 'Runs', 'Time', '', 'Status'], C.bg, C.dim)
      finalSteps.forEach((fs, idx) => {
        const have      = fs.productTypeId != null ? (clientAssetMap?.get(fs.productTypeId) ?? 0) : 0
        const totalQty  = fs.runs * fs.qtyPerRun
        const adjRuns   = have >= totalQty ? 0 : Math.ceil((totalQty - have) / Math.max(1, fs.qtyPerRun))
        const allDone   = have >= totalQty
        const r = ws.addRow([
          fs.name,
          totalQty,
          have || '',
          '',
          allDone ? '' : adjRuns,
          allDone ? '' : (fs.timePerRun ? formatTime(fs.timePerRun * adjRuns) : ''),
          '',
          allDone ? '✓ In inventory — skip' : '',
        ])
        r.height = 16
        const bg = fill(idx % 2 === 0 ? C.panelBg : C.rowAlt)
        r.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.fill      = bg
          cell.border    = border()
          cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right', indent: col === 1 ? 1 : 0 }
        })
        r.getCell(1).font = font(allDone ? C.dim : C.gold, true, 11)
        ;[2,3,5,6].forEach(c => { r.getCell(c).font = font(allDone ? C.dim : C.muted, false, 10) })
        r.getCell(8).font = font(C.green, false, 9)
      })
    }

    // ── Download ─────────────────────────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer()
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url    = URL.createObjectURL(blob)
    const a      = document.createElement('a')
    a.href       = url
    a.download   = `${(exportName ?? chainData.productName).replace(/[^a-z0-9+]/gi, '_')}_build_chain.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }
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

  // Render a single step row using cascaded-adjusted quantities
  const StepRow = ({ step, color, borderColor }: { step: FlatStep; color: string; borderColor: string }) => {
    const adj        = adjusted?.stepAdj.get(step.typeId)
    const have       = adj?.have    ?? (clientAssetMap?.get(step.typeId) ?? 0)
    const adjRuns    = adj?.adjRuns ?? step.runsNeeded
    const adjQty     = adj?.adjQty  ?? step.qtyNeeded
    const isOverride = overrideSet.has(step.typeId)
    const allCovered = adjQty === 0 && !isOverride
    const noBp       = step.bpTypeId != null && ownedBpTypeIds != null && ownedBpTypeIds.size > 0 && !ownedBpTypeIds.has(step.bpTypeId)
    const isT2       = noBp && step.activity === 'manufacturing' && / II$/.test(step.name)
    return (
      <div className={`pl-4 border-l ${borderColor}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`${color} font-mono`}>
            {step.name} <span className="text-eve-muted">×{step.qtyNeeded.toLocaleString()}</span>
            {noBp && <span className="text-[8px] text-eve-red border border-eve-red/40 px-1 py-px ml-1.5 align-middle">NO BP</span>}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {have > 0 && !isOverride && (
              <span className={`text-[9px] font-mono ${allCovered ? 'text-eve-green' : 'text-eve-orange'}`}>
                {allCovered ? '✓ have' : `have ${have.toLocaleString()}`}
              </span>
            )}
            {isOverride && have > 0 && (
              <span className="text-[9px] font-mono text-eve-dim">have {have.toLocaleString()}</span>
            )}
            {allCovered
              ? <button onClick={() => toggleOverride(step.typeId)} title="Make anyway (you have enough in inventory)" className="text-[9px] text-eve-green hover:text-eve-orange transition-colors cursor-pointer">skip ↺</button>
              : isOverride
                ? <button onClick={() => toggleOverride(step.typeId)} title="Cancel override — use inventory" className="text-[9px] text-eve-orange hover:text-eve-green transition-colors cursor-pointer">{adjRuns}r · {formatTime(step.timePerRun * adjRuns)} ✕</button>
                : <span className="text-eve-dim text-[9px]">{adjRuns}r · {formatTime(step.timePerRun * adjRuns)}</span>}
          </div>
        </div>
        {noBp && (
          isT2 ? (
            <div className="mt-1 ml-0 mr-2 px-2 py-1.5 border-l-2 border-eve-gold bg-eve-gold/5 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-[10px] text-eve-gold font-mono uppercase tracking-wide">
                <Zap size={9} className="shrink-0" />
                Invention required
              </div>
              <div className="text-[9px] text-eve-muted leading-relaxed">
                T2 blueprints cannot be purchased — run an Invention job from a T1 BPC to produce a limited-run T2 BPC.
              </div>
            </div>
          ) : (
            <div className="mt-1 ml-0 mr-2 px-2 py-1.5 border-l-2 border-eve-orange bg-eve-orange/5 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-[10px] text-eve-orange font-mono uppercase tracking-wide">
                <AlertTriangle size={9} className="shrink-0" />
                Blueprint required
              </div>
              <div className="text-[9px] text-eve-muted leading-relaxed">
                Obtain a BPC from your corp library, or purchase a BPO/BPC on the market or contracts.
              </div>
            </div>
          )
        )}
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
    )
  }

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
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {chainData && !chainLoading && (
            <button onClick={exportXLSX} className="text-eve-dim hover:text-eve-cyan transition-colors" title="Export to Excel (.xlsx)">
              <Download size={11} />
            </button>
          )}
          <button onClick={onClose} className="text-eve-dim hover:text-eve-red transition-colors"><X size={11} /></button>
        </div>
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
                {chainData.buyList.map(item => {
                  const adj    = adjusted?.buyAdj.get(item.typeId)
                  const have   = adj?.have   ?? item.have
                  const adjQty = adj?.adjQty ?? Math.max(0, item.qty - item.have)
                  const originalNeed = item.qty - item.have
                  const saved  = originalNeed - adjQty
                  return (
                    <div key={item.typeId} className="flex items-center justify-between gap-2 py-0.5 pl-4">
                      <span className="text-eve-text truncate">{item.name}</span>
                      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                        {have > 0 && <span className="text-eve-muted">have {have.toLocaleString()}</span>}
                        {saved > 0 && adjQty > 0 && (
                          <span className="text-eve-dim" title={`${saved.toLocaleString()} saved from intermediates you already have`}>
                            −{saved.toLocaleString()}
                          </span>
                        )}
                        {adjQty > 0
                          ? <span className="text-eve-orange">need {adjQty.toLocaleString()}</span>
                          : <span className="text-eve-green">✓ covered</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Mfg intermediates ─────────────────────────────────── */}
          {mfgIntermediates.length > 0 && (
            <div>
              <SectionHeader id="mfg-int" icon={<Wrench size={10} className="text-eve-cyan" />} label={`Mfg Intermediates  ·  ${mfgStructLabel}${system ? ' · ' + system : ''}`} count={mfgIntermediates.length} color="text-eve-cyan" />
              {!collapsed['mfg-int'] && (
                <div className="pt-1 space-y-2">
                  {mfgIntermediates.map(step => <StepRow key={step.key} step={step} color="text-eve-cyan" borderColor="border-eve-cyan/20" />)}
                </div>
              )}
            </div>
          )}

          {/* ── Simple reactions ───────────────────────────────────── */}
          {simpleReactions.length > 0 && (
            <div>
              <SectionHeader id="rx-simple" icon={<Zap size={10} className="text-eve-green" />} label={`Reactions  ·  ${rxStructLabel}${system ? ' · ' + system : ''}`} count={simpleReactions.length} color="text-eve-green" />
              {!collapsed['rx-simple'] && (
                <div className="pt-1 space-y-2">
                  {simpleReactions.map(step => <StepRow key={step.key} step={step} color="text-eve-green" borderColor="border-eve-green/20" />)}
                </div>
              )}
            </div>
          )}

          {/* ── Advanced reactions ─────────────────────────────────── */}
          {advReactions.length > 0 && (
            <div>
              <SectionHeader id="rx-adv" icon={<Zap size={10} className="text-purple-400" />} label={`Advanced Reactions  ·  ${rxStructLabel}${system ? ' · ' + system : ''}`} count={advReactions.length} color="text-purple-400" />
              {!collapsed['rx-adv'] && (
                <div className="pt-1 space-y-2">
                  {advReactions.map(step => <StepRow key={step.key} step={step} color="text-purple-400" borderColor="border-purple-400/20" />)}
                </div>
              )}
            </div>
          )}

          {/* ── Component manufacturing ────────────────────────────── */}
          {mfgFinal.length > 0 && (
            <div>
              <SectionHeader id="mfg" icon={<Wrench size={10} className="text-eve-cyan" />} label={`Manufacturing  ·  ${mfgStructLabel}${system ? ' · ' + system : ''}`} count={mfgFinal.length} color="text-eve-cyan" />
              {!collapsed['mfg'] && (
                <div className="pt-1 space-y-2">
                  {mfgFinal.map(step => <StepRow key={step.key} step={step} color="text-eve-cyan" borderColor="border-eve-cyan/20" />)}
                </div>
              )}
            </div>
          )}

          {/* ── Final Assembly ─────────────────────────────────────── */}
          {finalSteps && finalSteps.length > 0 && (
            <div>
              <SectionHeader id="final-asm" icon={<Factory size={10} className="text-eve-gold" />} label={`Final Assembly  ·  ${mfgStructLabel}${system ? ' · ' + system : ''}`} count={finalSteps.length} color="text-eve-gold" />
              {!collapsed['final-asm'] && (
                <div className="pt-1 space-y-2">
                  {finalSteps.map((fs, i) => {
                    const have       = fs.productTypeId != null ? (clientAssetMap?.get(fs.productTypeId) ?? 0) : 0
                    const totalQty   = fs.runs * fs.qtyPerRun
                    const adjRuns    = have >= totalQty ? 0 : Math.max(0, Math.ceil((totalQty - have) / Math.max(1, fs.qtyPerRun)))
                    const allCovered = have >= totalQty
                    return (
                      <div key={i} className="pl-4 border-l border-eve-gold/30">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-eve-gold font-mono">
                            {fs.name} <span className="text-eve-muted">×{totalQty.toLocaleString()}</span>
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {have > 0 && (
                              <span className={`text-[9px] font-mono ${allCovered ? 'text-eve-green' : 'text-eve-orange'}`}>
                                {allCovered ? '✓ have' : `have ${have.toLocaleString()}`}
                              </span>
                            )}
                            {allCovered
                              ? <span className="text-[9px] text-eve-green">skip</span>
                              : <span className="text-eve-dim text-[9px]">
                                  {adjRuns}r{fs.timePerRun ? ` · ${formatTime(fs.timePerRun * adjRuns)}` : ''}
                                </span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Summary footer ─────────────────────────────────────── */}
          <div className="text-[9px] text-eve-dim border-t border-eve-border/30 pt-2">
            {steps.length + (finalSteps?.length ?? 0)} production job{steps.length + (finalSteps?.length ?? 0) !== 1 ? 's' : ''} · {chainData.buyList.filter(b => b.qty > b.have).length} materials to source
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

  // Fit import modal
  const [showFitImport, setShowFitImport] = useState(false)
  const [fitImportText, setFitImportText] = useState('')
  const [fitImportLoading, setFitImportLoading] = useState(false)
  const [fitImportError, setFitImportError] = useState<string | null>(null)
  const [fitImportResults, setFitImportResults] = useState<Array<{
    name: string; qty: number; itemTypeId: number | null
    blueprintTypeId: number | null; blueprintName: string | null; hasBlueprint: boolean
  }> | null>(null)
  const [savedFits, setSavedFits] = useState<Array<{ id: string; name: string; fitText: string }>>([])
  const [selectedFits, setSelectedFits] = useState<Array<{ id?: string; name: string; fitText: string }>>([])
  const [fitPickerQuery, setFitPickerQuery] = useState('')
  const [fitPickerOpen, setFitPickerOpen] = useState(false)
  const fitPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fitPickerRef.current && !fitPickerRef.current.contains(e.target as Node)) {
        setFitPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filteredSavedFits = savedFits.filter(f =>
    !selectedFits.some(s => s.id === f.id) &&
    (!fitPickerQuery || f.name.toLowerCase().includes(fitPickerQuery.toLowerCase()))
  )

  // Fit Build Plan mode
  interface FitPlanItem {
    blueprint: BlueprintImport
    data: BlueprintData | null
    loading: boolean
    expanded: boolean
    me: number
    te: number
    structure: StructureKey
    rig: RigKey
    security: SecurityKey
  }
  const [fitPlanItems, setFitPlanItems] = useState<FitPlanItem[]>([])
  const [fitPlanMissing, setFitPlanMissing] = useState<Array<{ name: string; qty: number }>>([])
  const [fitPlanMode, setFitPlanMode] = useState(false)
  const [fitPlanLoading, setFitPlanLoading] = useState(false)
  const [fitPlanQty, setFitPlanQty] = useState(1)
  const [allStepsLoading, setAllStepsLoading] = useState(false)
  const fitPlanAllStepsActive = useRef(false)

  const refetchItem = useCallback(async (i: number, item: FitPlanItem) => {
    setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, loading: true } : p))
    try {
      const industryLevel = skills.find(s => s.skillId === 3380)?.trainedLevel ?? 0
      const advIndLevel   = skills.find(s => s.skillId === 3388)?.trainedLevel ?? 0
      const params = new URLSearchParams({
        typeId: String(item.blueprint.typeId),
        me: String(item.me), te: String(item.te), runs: String(item.blueprint.runs),
        structure: item.structure, rig: item.rig, security: item.security,
        industryLevel: String(industryLevel), advIndLevel: String(advIndLevel),
        ...(characterId ? { characterId: String(characterId) } : {}),
      })
      const res = await fetch(`/api/industry/blueprint?${params}`)
      const json = res.ok ? await res.json() as BlueprintData : null
      setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, data: json, loading: false } : p))
    } catch {
      setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, loading: false } : p))
    }
  }, [skills, characterId])

  useEffect(() => {
    if (showFitImport) {
      fetch('/api/fits').then(r => r.json()).then(setSavedFits).catch(() => {})
      setSelectedFits([])
      setFitImportText('')
      setFitImportResults(null)
      setFitImportError(null)
      setFitPickerQuery('')
    }
  }, [showFitImport])

  async function resolveFit() {
    const texts = [
      ...selectedFits.map(f => f.fitText),
      ...(fitImportText.trim() ? [fitImportText.trim()] : []),
    ]
    if (texts.length === 0) return
    setFitImportLoading(true)
    setFitImportError(null)
    setFitImportResults(null)
    try {
      const results = await Promise.all(texts.map(async fitText => {
        const r = await fetch('/api/industry/fit-blueprints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fitText }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Failed to resolve fit')
        return data.items as Array<{
          name: string; qty: number; itemTypeId: number | null
          blueprintTypeId: number | null; blueprintName: string | null; hasBlueprint: boolean
        }>
      }))

      // Merge by blueprintTypeId (or name if no blueprint), summing qty
      const merged = new Map<string, typeof results[0][0]>()
      for (const items of results) {
        for (const item of items) {
          const key = item.blueprintTypeId ? String(item.blueprintTypeId) : item.name
          const ex = merged.get(key)
          if (ex) ex.qty += item.qty
          else merged.set(key, { ...item })
        }
      }
      setFitImportResults([...merged.values()])
    } catch (e) {
      setFitImportError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setFitImportLoading(false)
    }
  }

  async function loadFitPlan() {
    if (!fitImportResults) return
    const buildable = fitImportResults.filter(r => r.hasBlueprint && r.blueprintTypeId && r.blueprintName)
    const missing   = fitImportResults.filter(r => !r.hasBlueprint)
    const initialItems: FitPlanItem[] = buildable.map(r => ({
      blueprint: { typeId: r.blueprintTypeId!, typeName: r.blueprintName!, me: 0, te: 0, runs: r.qty },
      data: null, loading: true, expanded: false,
      me: 0, te: 0, structure, rig, security,
    }))
    setFitPlanItems(initialItems)
    setFitPlanMissing(missing.map(r => ({ name: r.name, qty: r.qty })))
    setFitPlanMode(true)
    setFitPlanLoading(true)
    setFitPlanQty(1)
    setShowFitImport(false)

    const industryLevel = skills.find(s => s.skillId === 3380)?.trainedLevel ?? 0
    const advIndLevel   = skills.find(s => s.skillId === 3388)?.trainedLevel ?? 0

    const fetched = await Promise.all(buildable.map(async (r, i) => {
      try {
        const params = new URLSearchParams({
          typeId: String(r.blueprintTypeId!),
          me: '0', te: '0', runs: String(r.qty),
          structure, rig, security,
          industryLevel: String(industryLevel),
          advIndLevel: String(advIndLevel),
          ...(characterId ? { characterId: String(characterId) } : {}),
        })
        const res = await fetch(`/api/industry/blueprint?${params}`)
        const json = await res.json()
        return { i, data: res.ok ? json as BlueprintData : null }
      } catch { return { i, data: null } }
    }))

    setFitPlanItems(prev => {
      const next = [...prev]
      for (const { i, data } of fetched) next[i] = { ...next[i], data, loading: false }
      return next
    })
    setFitPlanLoading(false)
  }

  // Profitability
  const PROFIT_PREFS_KEY = 'aurora_bp_profit_prefs'
  const loadProfitPrefs = () => {
    try { return JSON.parse(localStorage.getItem(PROFIT_PREFS_KEY) ?? '{}') } catch { return {} }
  }
  const [profitSCI, setProfitSCI]             = useState<string>(() => loadProfitPrefs().sci ?? '4')
  const [profitFacilityTax, setProfitFacilityTax] = useState<string>(() => loadProfitPrefs().facilityTax ?? '1')
  const [jitaPrices, setJitaPrices]           = useState<Record<number, { bestSell: number | null; bestBuy: number | null; adjustedPrice: number | null }>>({})
  const [jitaLoading, setJitaLoading]         = useState(false)
  const [jitaError, setJitaError]             = useState<string | null>(null)
  const [profitOpen, setProfitOpen]           = useState(false)

  const saveProfitPrefs = (sci: string, ft: string) =>
    localStorage.setItem(PROFIT_PREFS_KEY, JSON.stringify({ sci, facilityTax: ft }))

  const fetchJitaPrices = useCallback(async () => {
    if (!data) return
    const typeIds = [
      ...(data.productTypeId ? [data.productTypeId] : []),
      ...data.materials.map(m => m.typeId),
    ]
    if (typeIds.length === 0) return
    setJitaLoading(true); setJitaError(null)
    try {
      const res = await fetch('/api/industry/jita-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typeIds }),
      })
      const json = await res.json() as { prices: { typeId: number; bestSell: number | null; bestBuy: number | null; adjustedPrice: number | null }[] }
      const map: Record<number, { bestSell: number | null; bestBuy: number | null; adjustedPrice: number | null }> = {}
      for (const p of json.prices) map[p.typeId] = { bestSell: p.bestSell, bestBuy: p.bestBuy, adjustedPrice: p.adjustedPrice }
      setJitaPrices(map)
    } catch (err) {
      setJitaError(err instanceof Error ? err.message : 'Price fetch failed')
    } finally { setJitaLoading(false) }
  }, [data])  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch Jita prices whenever blueprint data loads
  useEffect(() => {
    if (data) fetchJitaPrices()
    else setJitaPrices({})
  }, [data])  // eslint-disable-line react-hooks/exhaustive-deps

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
    if (fitPlanAllStepsActive.current) return  // merged chain already set — skip
    if (showStepsPopout && activeBlueprint) fetchChain()
  }, [showStepsPopout, activeBlueprint?.typeId, reactionEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const openFitPlanAllSteps = async () => {
    if (fitPlanItems.length === 0) return
    setAllStepsLoading(true)
    setChainError(null)
    try {
      const results = await Promise.all(fitPlanItems.map(async item => {
        const params = new URLSearchParams({
          typeId: String(item.blueprint.typeId),
          me: String(item.me),
          runs: String(item.blueprint.runs * fitPlanQty),
          includeReactions: String(reactionEnabled),
          ...(characterId ? { characterId: String(characterId) } : {}),
        })
        const res = await fetch(`/api/industry/blueprint/chain?${params}`)
        if (!res.ok) return null
        return await res.json() as ChainData
      }))

      const buyMap = new Map<number, BuyItem>()
      const mergedChain: ChainNode[] = []
      for (const cd of results) {
        if (!cd) continue
        mergedChain.push(...cd.chain)
        for (const b of cd.buyList) {
          const ex = buyMap.get(b.typeId)
          if (ex) { ex.qty += b.qty; ex.have = Math.max(ex.have, b.have) }
          else buyMap.set(b.typeId, { ...b })
        }
      }

      fitPlanAllStepsActive.current = true
      setChainData({
        productName: 'Full Fit Plan',
        productTypeId: null,
        productQty: fitPlanItems.reduce((s, i) => s + i.blueprint.runs * fitPlanQty, 0),
        runs: fitPlanItems.length,
        chain: mergedChain,
        buyList: [...buyMap.values()].sort((a, b) => b.qty - a.qty),
      })
      setShowStepsPopout(true)
    } catch (err) {
      setChainError(err instanceof Error ? err.message : 'Chain fetch failed')
    } finally {
      setAllStepsLoading(false)
    }
  }

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

  // Set of all typeIds in the character's assets — used to check blueprint ownership in StepsPopout
  const ownedBpTypeIds = useMemo(() => new Set(assets.map(a => a.typeId)), [assets])

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
      <div className="flex gap-2">
      <div className="relative flex-1">
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
      <button
        onClick={() => { setShowFitImport(true); setFitImportResults(null); setFitImportError(null) }}
        className="flex items-center gap-1 px-2 border border-eve-border bg-black/20 text-eve-muted hover:text-eve-cyan hover:border-eve-cyan/40 transition-colors shrink-0"
        title="Import fit from Fit Analyzer"
      >
        <Upload size={11} />
        <span className="text-[10px] uppercase tracking-wider">Fit</span>
      </button>
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

      {fitPlanMode ? (() => {
        const aggMap = new Map<number, { name: string; qty: number; have: number }>()
        for (const item of fitPlanItems) {
          if (!item.data) continue
          for (const mat of item.data.materials) {
            const have = clientAssetMap.get(mat.typeId) ?? 0
            const qty = mat.adjQty * fitPlanQty
            const ex = aggMap.get(mat.typeId)
            if (ex) { ex.qty += qty; ex.have = have }
            else aggMap.set(mat.typeId, { name: mat.name, qty, have })
          }
        }
        const aggMats = [...aggMap.entries()]
          .map(([typeId, v]) => ({ typeId, ...v, need: Math.max(0, v.qty - v.have) }))
          .sort((a, b) => b.qty - a.qty)
        const missingCount = aggMats.filter(m => m.need > 0).length

        return (
          <div className="flex flex-col gap-2">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-widest text-eve-cyan shrink-0">
                Fit Build Plan — {fitPlanItems.length} blueprints
                {fitPlanLoading && <span className="text-eve-dim ml-2 animate-pulse">loading…</span>}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-eve-muted uppercase tracking-wider shrink-0">Fits</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={fitPlanQty}
                  onChange={e => setFitPlanQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                  className="eve-input w-14 text-center text-[11px] py-0.5 px-1"
                />
              </div>
              {detailedSteps && (
                <button
                  onClick={openFitPlanAllSteps}
                  disabled={allStepsLoading || fitPlanLoading || fitPlanItems.length === 0}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-eve-green border border-eve-green/40 px-2 py-0.5 hover:bg-eve-green/10 transition-colors disabled:opacity-40 shrink-0"
                  title="View combined build chain for entire fit"
                >
                  {allStepsLoading
                    ? <span className="w-2 h-2 rounded-full bg-eve-green animate-pulse" />
                    : <FlaskConical size={10} />}
                  All Steps
                </button>
              )}
              <button onClick={() => setFitPlanMode(false)} className="text-[10px] text-eve-muted hover:text-eve-text uppercase tracking-wider shrink-0">← Back</button>
            </div>

            {/* Side-by-side */}
            <div className="grid grid-cols-2 gap-3 items-start">

              {/* Left: Blueprint list + missing */}
              <div className="flex flex-col gap-2">
              <div className="eve-panel divide-y divide-eve-border/30">
                {fitPlanItems.map((item, i) => {
                  const structInfoI = STRUCTURES.find(s => s.key === item.structure)!
                  const rigInfoI    = RIG_BONUSES[item.rig][item.security]
                  return (
                    <div key={i} className="flex flex-col">
                      <button
                        className="flex items-center gap-2 px-3 py-2 text-left hover:bg-eve-cyan/5 transition-colors w-full"
                        onClick={() => setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, expanded: !p.expanded } : p))}
                      >
                        <span className="text-eve-dim text-[9px]">{item.expanded ? '▾' : '▸'}</span>
                        <span className="flex-1 text-[11px] text-eve-text truncate">{item.data?.productName ?? item.blueprint.typeName.replace(' Blueprint', '')}</span>
                        <span className="text-[10px] text-eve-dim shrink-0">×{item.blueprint.runs * fitPlanQty}</span>
                        {item.loading && <span className="w-1.5 h-1.5 rounded-full bg-eve-cyan animate-pulse shrink-0" />}
                        {detailedSteps && (
                          <button
                            className="shrink-0 text-[9px] uppercase tracking-wider text-eve-green border border-eve-green/40 px-1.5 py-0.5 hover:bg-eve-green/10 transition-colors"
                            onClick={e => {
                              e.stopPropagation()
                              setActiveBlueprint({ ...item.blueprint, me: item.me, te: item.te })
                              setMe(item.me); setTe(item.te); setRuns(item.blueprint.runs)
                              setShowStepsPopout(true)
                            }}
                            title="View detailed build chain"
                          >Steps</button>
                        )}
                        <button
                          className="shrink-0 text-[9px] uppercase tracking-wider text-eve-cyan border border-eve-cyan/40 px-1.5 py-0.5 hover:bg-eve-cyan/10 transition-colors"
                          onClick={e => { e.stopPropagation(); setActiveBlueprint({ ...item.blueprint, me: item.me, te: item.te }); setMe(item.me); setTe(item.te); setRuns(item.blueprint.runs); setStructure(item.structure); setRig(item.rig); setSecurity(item.security); setFitPlanMode(false) }}
                        >Open</button>
                      </button>

                      {item.expanded && (
                        <div className="px-3 pb-3 pt-2 border-t border-eve-border/20 flex flex-col gap-2">
                          {/* ME / TE sliders */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="eve-label text-[9px] mb-1">ME ({item.me})</div>
                              <input type="range" min={0} max={10} value={item.me}
                                onChange={e => setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, me: Number(e.target.value) } : p))}
                                onMouseUp={e => setFitPlanItems(prev => { const next = prev.map((p, j) => j === i ? { ...p, me: Number((e.target as HTMLInputElement).value) } : p); refetchItem(i, next[i]); return next })}
                                onTouchEnd={e => setFitPlanItems(prev => { const next = prev.map((p, j) => j === i ? { ...p, me: Number((e.target as HTMLInputElement).value) } : p); refetchItem(i, next[i]); return next })}
                                className="w-full accent-cyan-400 cursor-pointer"
                              />
                            </div>
                            <div>
                              <div className="eve-label text-[9px] mb-1">TE ({item.te})</div>
                              <input type="range" min={0} max={20} value={item.te}
                                onChange={e => setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, te: Number(e.target.value) } : p))}
                                onMouseUp={e => setFitPlanItems(prev => { const next = prev.map((p, j) => j === i ? { ...p, te: Number((e.target as HTMLInputElement).value) } : p); refetchItem(i, next[i]); return next })}
                                onTouchEnd={e => setFitPlanItems(prev => { const next = prev.map((p, j) => j === i ? { ...p, te: Number((e.target as HTMLInputElement).value) } : p); refetchItem(i, next[i]); return next })}
                                className="w-full accent-cyan-400 cursor-pointer"
                              />
                            </div>
                          </div>

                          {/* Structure / Rig / Security */}
                          <div className="grid grid-cols-3 gap-1.5">
                            <div>
                              <div className="eve-label text-[9px] mb-1">
                                STRUCTURE{structInfoI.me > 0 && <span className="text-eve-green ml-1">−{structInfoI.me}%</span>}
                              </div>
                              <select value={item.structure} className="eve-input w-full py-0.5 text-[9px] cursor-pointer"
                                onChange={e => {
                                  const v = e.target.value as StructureKey
                                  const updated = { ...item, structure: v }
                                  setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, structure: v } : p))
                                  refetchItem(i, updated)
                                }}>
                                {STRUCTURES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <div className="eve-label text-[9px] mb-1">
                                RIG{rigInfoI.me > 0 && <span className="text-eve-green ml-1">−{rigInfoI.me}%</span>}
                              </div>
                              <select value={item.rig} className="eve-input w-full py-0.5 text-[9px] cursor-pointer"
                                onChange={e => {
                                  const v = e.target.value as RigKey
                                  const updated = { ...item, rig: v }
                                  setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, rig: v } : p))
                                  refetchItem(i, updated)
                                }}>
                                {RIGS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <div className="eve-label text-[9px] mb-1">SEC</div>
                              <select value={item.security} className={`eve-input w-full py-0.5 text-[9px] cursor-pointer ${item.rig === 'none' ? 'opacity-40' : ''}`}
                                onChange={e => {
                                  const v = e.target.value as SecurityKey
                                  const updated = { ...item, security: v }
                                  setFitPlanItems(prev => prev.map((p, j) => j === i ? { ...p, security: v } : p))
                                  refetchItem(i, updated)
                                }}>
                                {SECURITIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* Materials for this item */}
                          {item.data && (
                            <div className="flex flex-col gap-0.5 mt-1">
                              {item.data.materials.map(mat => {
                                const have = clientAssetMap.get(mat.typeId) ?? 0
                                const need = Math.max(0, mat.adjQty - have)
                                return (
                                  <div key={mat.typeId} className="flex items-center gap-1.5">
                                    <span className={`text-[9px] shrink-0 ${need > 0 ? 'text-eve-red' : 'text-eve-green'}`}>{need > 0 ? '✗' : '✓'}</span>
                                    <span className="flex-1 text-[10px] text-eve-text truncate">{mat.name}</span>
                                    <span className="text-[10px] text-eve-muted shrink-0">×{mat.adjQty.toLocaleString()}</span>
                                  </div>
                                )
                              })}
                              <div className="text-[10px] text-eve-dim mt-1">
                                Time: {item.data.adjustedTime >= 3600 ? `${(item.data.adjustedTime / 3600).toFixed(1)}h` : `${Math.ceil(item.data.adjustedTime / 60)}m`}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Missing blueprints */}
              {fitPlanMissing.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                  <div className="text-[10px] uppercase tracking-wider text-eve-red/80 px-1">
                    No Blueprint — {fitPlanMissing.length} items
                  </div>
                  <div className="eve-panel divide-y divide-eve-border/20 opacity-60">
                    {fitPlanMissing.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                        <XCircle size={10} className="text-eve-red shrink-0" />
                        <span className="flex-1 text-[11px] text-eve-muted truncate">{m.name}</span>
                        <span className="text-[10px] text-eve-dim shrink-0">×{m.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div> {/* end left column wrapper */}

              {/* Right: Aggregated materials */}
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-eve-muted">
                  Materials — {aggMats.length} types
                  {missingCount > 0 && <span className="text-eve-red ml-2">{missingCount} missing</span>}
                </div>
                <div className="eve-panel divide-y divide-eve-border/20 max-h-[600px] overflow-y-auto">
                  {aggMats.map(mat => (
                    <div key={mat.typeId} className="flex items-center gap-2 px-2 py-1">
                      <span className={`text-[9px] shrink-0 ${mat.need > 0 ? 'text-eve-red' : 'text-eve-green'}`}>{mat.need > 0 ? '✗' : '✓'}</span>
                      <span className="flex-1 text-[10px] text-eve-text truncate">{mat.name}</span>
                      <span className="text-[10px] shrink-0">
                        {mat.need > 0
                          ? <span className="text-eve-red">{mat.need.toLocaleString()}<span className="text-eve-dim">/{mat.qty.toLocaleString()}</span></span>
                          : <span className="text-eve-muted">{mat.qty.toLocaleString()}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )
      })() : !activeBlueprint ? (
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
          {/* ── Profitability ──────────────────────────────────────── */}
          {(() => {
            const sci         = parseFloat(profitSCI) || 0
            const structBonus = structInfo.costReduction
            const facTax      = parseFloat(profitFacilityTax) || 0
            const SCC         = 4

            const hasPrices    = data.productTypeId != null && jitaPrices[data.productTypeId] != null
            const productPrice = data.productTypeId ? (jitaPrices[data.productTypeId]?.bestSell ?? null) : null
            const totalUnits   = data.productQty * runs

            // matCost = what you spend buying materials at Jita sell prices
            let matCost = 0
            let matCostKnown = hasPrices
            for (const mat of enrichedMaterials) {
              const p = jitaPrices[mat.typeId]?.bestSell
              if (p == null) { matCostKnown = false; break }
              matCost += mat.adjQty * p
            }

            // EIV = sum(adjusted_price × qty) — CCP's market equilibrium prices, used for job cost
            let eiv = 0
            let eivKnown = matCostKnown
            for (const mat of enrichedMaterials) {
              const ap = jitaPrices[mat.typeId]?.adjustedPrice
              if (ap == null) { eivKnown = false; break }
              eiv += mat.adjQty * ap
            }

            // Job cost breakdown (correct EVE formula):
            //   grossSCI       = EIV × SCI%
            //   structBonusAmt = grossSCI × structBonus%   (reduces gross SCI)
            //   netSCI         = grossSCI − structBonusAmt
            //   facilityTax    = EIV × facTax%
            //   scc            = EIV × 4%
            //   total          = netSCI + facilityTax + scc
            const grossSCI       = eivKnown ? eiv * sci / 100 : null
            const structBonusAmt = grossSCI != null ? grossSCI * structBonus / 100 : null
            const netSCI         = grossSCI != null && structBonusAmt != null ? grossSCI - structBonusAmt : null
            const facTaxAmt      = eivKnown ? eiv * facTax / 100 : null
            const sccAmt         = eivKnown ? eiv * SCC / 100 : null
            const jobCost        = netSCI != null && facTaxAmt != null && sccAmt != null ? netSCI + facTaxAmt + sccAmt : null

            const SALES_TAX = 0.036
            const BROKER    = 0.03
            const productSellGross = productPrice != null ? productPrice * totalUnits : null
            const productSellNet   = productSellGross != null
              ? productSellGross * (1 - SALES_TAX) * (1 - BROKER) : null

            const profit = productSellNet != null && matCostKnown && jobCost != null ? productSellNet - matCost - jobCost : null
            const margin = profit != null && productSellNet ? (profit / productSellNet) * 100 : null

            return (
              <div className="eve-panel p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setProfitOpen(v => !v)}
                    className="flex items-center gap-2 text-eve-gold hover:text-eve-text transition-colors"
                  >
                    {profitOpen ? <ChevronDown size={10} /> : <ChevronRightIcon size={10} />}
                    <span className="eve-header mb-0">PROFITABILITY</span>
                  </button>
                  <div className="flex items-center gap-2">
                    {profit != null && (
                      <span className={`text-xs font-mono ${profit > 0 ? 'text-eve-green' : 'text-eve-red'}`}>
                        {profit > 0 ? '+' : ''}{formatISK(profit)}
                        {margin != null && <span className="text-[9px] ml-1 text-eve-dim">({margin.toFixed(1)}%)</span>}
                      </span>
                    )}
                    <button
                      onClick={() => fetchJitaPrices()}
                      disabled={jitaLoading}
                      className="text-[9px] border border-eve-gold/40 text-eve-gold hover:border-eve-gold hover:bg-eve-gold/10 px-1.5 py-0.5 transition-colors disabled:opacity-40"
                    >
                      {jitaLoading ? '…' : 'REFRESH'}
                    </button>
                  </div>
                </div>

                {jitaError && <div className="text-eve-red text-[10px]">{jitaError}</div>}

                <AnimatePresence>
                  {profitOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      {/* Job cost parameters */}
                      <div className="border-t border-eve-border/40 pt-2 mb-3">
                        <div className="eve-label text-[9px] mb-1.5">JOB COST PARAMETERS</div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: 'SCI %', val: profitSCI, set: (v: string) => { setProfitSCI(v); saveProfitPrefs(v, profitFacilityTax) } },
                            { label: 'FACILITY TAX %', val: profitFacilityTax, set: (v: string) => { setProfitFacilityTax(v); saveProfitPrefs(profitSCI, v) } },
                          ].map(field => (
                            <div key={field.label}>
                              <div className="eve-label text-[9px] mb-0.5">{field.label}</div>
                              <input
                                type="number" min="0" step="0.1"
                                className="eve-input w-full py-0.5 text-xs text-right"
                                value={field.val}
                                onChange={e => field.set(e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between text-[9px] text-eve-dim mt-1.5 flex-wrap gap-x-3">
                          {structBonus > 0 && <span>Struct role bonus: <span className="text-eve-text font-mono">−{structBonus}% of SCI</span></span>}
                          <span>SCC: <span className="text-eve-text font-mono">4% (fixed)</span></span>
                          {eivKnown && <span>EIV: <span className="text-eve-text font-mono">{formatISK(eiv)}</span></span>}
                        </div>
                      </div>

                      {jitaLoading && (
                        <div className="text-eve-muted text-[10px] animate-pulse text-center py-2">
                          Fetching {enrichedMaterials.length + 1} prices from Jita…
                        </div>
                      )}
                      {hasPrices && !jitaLoading && (
                        <div className="space-y-1.5">
                          {[
                            { label: `Product sell (${totalUnits.toLocaleString()}× @ Jita)`, value: productSellGross, color: 'text-eve-text' },
                            { label: `  Net after taxes (${((SALES_TAX + BROKER) * 100).toFixed(1)}%)`, value: productSellNet, color: 'text-eve-muted' },
                            { label: 'Material cost (Jita buy)', value: matCostKnown ? -matCost : null, color: 'text-eve-muted' },
                            { label: 'Job cost', value: jobCost != null ? -jobCost : null, color: 'text-eve-muted' },
                          ].map(row => (
                            <div key={row.label} className="flex items-baseline justify-between gap-2">
                              <span className="text-[10px] text-eve-dim whitespace-pre">{row.label}</span>
                              <span className={`text-[10px] font-mono shrink-0 ${row.color}`}>
                                {row.value == null ? '—' : formatISK(row.value)}
                              </span>
                            </div>
                          ))}

                          {eivKnown && grossSCI != null && (
                            <div className="pl-2 space-y-0.5 border-l border-eve-border/30">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[9px] text-eve-dim">SCI {sci}%</span>
                                <span className="text-[9px] font-mono text-eve-dim">{formatISK(grossSCI)}</span>
                              </div>
                              {structBonusAmt != null && structBonusAmt > 0 && (
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-[9px] text-eve-dim">  Struct role bonus −{structBonus}%</span>
                                  <span className="text-[9px] font-mono text-eve-green">−{formatISK(structBonusAmt)}</span>
                                </div>
                              )}
                              {netSCI != null && (
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-[9px] text-eve-dim">  Net SCI</span>
                                  <span className="text-[9px] font-mono text-eve-dim">{formatISK(netSCI)}</span>
                                </div>
                              )}
                              {facTaxAmt != null && facTaxAmt > 0 && (
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-[9px] text-eve-dim">Facility Tax {facTax}%</span>
                                  <span className="text-[9px] font-mono text-eve-dim">{formatISK(facTaxAmt)}</span>
                                </div>
                              )}
                              {sccAmt != null && (
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-[9px] text-eve-dim">SCC Surcharge 4%</span>
                                  <span className="text-[9px] font-mono text-eve-dim">{formatISK(sccAmt)}</span>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="border-t border-eve-border/50 pt-1.5 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {profit == null ? <Minus size={11} className="text-eve-dim" />
                                : profit > 0 ? <TrendingUp size={11} className="text-eve-green" />
                                : <TrendingDown size={11} className="text-eve-red" />}
                              <span className="text-[10px] text-eve-gold uppercase tracking-wider">Net Profit</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {profit != null && <CopyBtn value={profit.toFixed(0)} />}
                              <span className={`text-sm font-mono ${profit == null ? 'text-eve-dim' : profit > 0 ? 'text-eve-green' : 'text-eve-red'}`}>
                                {profit == null ? '—' : `${profit > 0 ? '+' : ''}${formatISK(profit)}`}
                              </span>
                            </div>
                          </div>
                          {margin != null && (
                            <div className="text-[9px] text-eve-dim text-right">
                              {margin.toFixed(2)}% margin · {formatISK((profit ?? 0) / runs)} per run
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })()}

          {/* ── Materials | Manufacturing Time | Required Skills (side by side) ── */}
          {(() => {
            const sci         = parseFloat(profitSCI) || 0
            const structBonus = structInfo.costReduction
            const facTax      = parseFloat(profitFacilityTax) || 0
            const SCC         = 4

            let eiv2 = 0
            let eiv2Known = data.productTypeId != null && jitaPrices[data.productTypeId] != null
            let matCost2 = 0
            for (const mat of enrichedMaterials) {
              const p  = jitaPrices[mat.typeId]?.bestSell
              const ap = jitaPrices[mat.typeId]?.adjustedPrice
              if (p == null || ap == null) { eiv2Known = false }
              if (p  != null) matCost2 += mat.adjQty * p
              if (ap != null) eiv2     += mat.adjQty * ap
            }
            const grossSCI2       = eiv2Known ? eiv2 * sci / 100 : null
            const structBonusAmt2 = grossSCI2 != null ? grossSCI2 * structBonus / 100 : null
            const netSCI2         = grossSCI2 != null && structBonusAmt2 != null ? grossSCI2 - structBonusAmt2 : null
            const facTaxAmt2      = eiv2Known ? eiv2 * facTax / 100 : null
            const sccAmt2         = eiv2Known ? eiv2 * SCC / 100 : null
            const jobCost         = netSCI2 != null && facTaxAmt2 != null && sccAmt2 != null ? netSCI2 + facTaxAmt2 + sccAmt2 : null

            const skillMap       = new Map(skills.map(s => [s.skillId, s.trainedLevel]))
            const canManufacture = data.requiredSkills.every(s => (skillMap.get(s.typeId) ?? 0) >= s.requiredLevel)
            const indLv          = skillMap.get(3380) ?? 0
            const advLv          = skillMap.get(3388) ?? 0

            return (
              <div className="grid grid-cols-3 gap-2 items-start">

                {/* ── Col 1: Materials ───────────────────────────────── */}
                <div className="eve-panel p-2 flex flex-col col-span-1">
                  <div className="eve-header mb-1 flex items-center justify-between">
                    <span>MATERIALS</span>
                    <span className="text-eve-muted font-normal text-[9px]">
                      {enrichedMaterials.filter(m => m.need === 0).length}/{enrichedMaterials.length}
                    </span>
                  </div>
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="text-eve-dim border-b border-eve-border/40">
                        <th className="text-left pb-1 font-normal">MAT</th>
                        <th className="text-right pb-1 font-normal">NEED</th>
                        <th className="text-right pb-1 font-normal pl-1">STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enrichedMaterials.map(mat => (
                        <tr key={mat.typeId} className="border-b border-eve-border/20">
                          <td className="py-0.5 text-eve-text truncate max-w-[70px]" title={mat.name}>{mat.name}</td>
                          <td className="py-0.5 text-right font-mono text-eve-text">{mat.adjQty.toLocaleString()}</td>
                          <td className="py-0.5 pl-1 text-right">
                            {mat.need === 0
                              ? <CheckCircle2 size={9} className="inline text-eve-green" />
                              : <span className="text-eve-orange font-mono">−{mat.need.toLocaleString()}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Col 2: Manufacturing Time ───────────────────────── */}
                <div className="eve-panel p-2 flex flex-col gap-2 col-span-1">
                  <div className="eve-header mb-0">MFG TIME</div>
                  <div className="text-eve-cyan font-mono text-sm">{formatTime(data.adjustedTime)}</div>
                  <div className="text-eve-dim text-[9px]">
                    {formatTime(data.baseTime)}/run
                    {data.adjustedTime < data.baseTime * runs && (
                      <span className="text-eve-green ml-1">saves {formatTime(data.baseTime * runs - data.adjustedTime)}</span>
                    )}
                  </div>
                  <div className="text-[9px] text-eve-muted">{runs} run{runs !== 1 ? 's' : ''}{data.productQty * runs > 1 ? ` · ${(data.productQty * runs).toLocaleString()} out` : ''}</div>

                  {data.timeBreakdown.length > 0 && (
                    <div className="border-t border-eve-border/40 pt-1.5 space-y-px">
                      {data.timeBreakdown.map((row, i) => (
                        <div key={i} className="flex items-center justify-between text-[9px]">
                          <span className="text-eve-muted truncate">{row.label}</span>
                          <span className="text-eve-green font-mono ml-1 shrink-0">−{row.pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {jobCost != null && grossSCI2 != null && (
                    <div className="border-t border-eve-border/40 pt-1.5 space-y-px">
                      <div className="eve-label text-[9px] mb-1">JOB COST</div>
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-eve-muted">SCI {sci}%</span>
                        <span className="text-eve-orange font-mono">{formatISK(grossSCI2)}</span>
                      </div>
                      {structBonusAmt2 != null && structBonusAmt2 > 0 && (
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-eve-muted">Struct −{structBonus}%</span>
                          <span className="text-eve-green font-mono">−{formatISK(structBonusAmt2)}</span>
                        </div>
                      )}
                      {facTaxAmt2 != null && facTaxAmt2 > 0 && (
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-eve-muted">Tax {facTax}%</span>
                          <span className="text-eve-orange font-mono">{formatISK(facTaxAmt2)}</span>
                        </div>
                      )}
                      {sccAmt2 != null && (
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-eve-muted">SCC 4%</span>
                          <span className="text-eve-orange font-mono">{formatISK(sccAmt2)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[9px] pt-0.5 border-t border-eve-border/30">
                        <span className="text-eve-dim">Total</span>
                        <span className="text-eve-orange font-mono">{formatISK(jobCost)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Col 3: Required Skills ──────────────────────────── */}
                <div className="eve-panel p-2 flex flex-col gap-1 col-span-1">
                  <div className="eve-header mb-0 flex items-center justify-between">
                    <span>SKILLS</span>
                    {data.requiredSkills.length > 0 && (
                      <span className={`text-[8px] border px-1 py-px ${canManufacture ? 'border-eve-green text-eve-green' : 'border-eve-orange text-eve-orange'}`}>
                        {canManufacture ? 'OK' : 'MISSING'}
                      </span>
                    )}
                  </div>
                  {data.requiredSkills.length === 0 ? (
                    <div className="text-eve-dim text-[9px]">None required</div>
                  ) : (
                    <div className="space-y-0.5">
                      {data.requiredSkills.map(s => {
                        const have = skillMap.get(s.typeId) ?? 0
                        const ok   = have >= s.requiredLevel
                        return (
                          <div key={s.typeId} className="flex items-center justify-between text-[9px]">
                            <div className="flex items-center gap-1 min-w-0">
                              {ok ? <CheckCircle2 size={9} className="text-eve-green shrink-0" />
                                  : <XCircle      size={9} className="text-eve-orange shrink-0" />}
                              <span className={`truncate ${ok ? 'text-eve-text' : 'text-eve-orange'}`}>{s.name}</span>
                            </div>
                            <span className={`font-mono ml-1 shrink-0 ${ok ? 'text-eve-green' : 'text-eve-orange'}`}>
                              {skills.length > 0 ? `L${have}/${s.requiredLevel}` : `L${s.requiredLevel}`}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {(indLv > 0 || advLv > 0) && (
                    <div className="border-t border-eve-border/40 pt-1 space-y-px">
                      {indLv > 0 && <div className="flex justify-between text-[9px]"><span className="text-eve-muted">Industry L{indLv}</span><span className="text-eve-green font-mono">−{indLv * 4}%</span></div>}
                      {advLv > 0 && <div className="flex justify-between text-[9px]"><span className="text-eve-muted">Adv Ind L{advLv}</span><span className="text-eve-green font-mono">−{advLv * 3}%</span></div>}
                    </div>
                  )}
                </div>

              </div>
            )
          })()}

        </>
      )}
      </> )}

      {/* ── Fit Import Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showFitImport && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowFitImport(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="relative w-[540px] max-h-[80vh] flex flex-col bg-[#0a0e14] border border-eve-border shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Corner brackets */}
              <span className="absolute top-0 left-0 w-3 h-3 border-t border-l border-eve-cyan/60" />
              <span className="absolute top-0 right-0 w-3 h-3 border-t border-r border-eve-cyan/60" />
              <span className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-eve-cyan/60" />
              <span className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-eve-cyan/60" />

              <div className="flex items-center justify-between px-4 py-2 border-b border-eve-border">
                <span className="text-[10px] uppercase tracking-widest text-eve-cyan">Import Fit → Blueprint Planner</span>
                <button onClick={() => setShowFitImport(false)} className="text-eve-dim hover:text-eve-muted"><X size={12} /></button>
              </div>

              <div className="flex flex-col gap-3 p-4 overflow-y-auto">

                {/* Selected fit chips */}
                {selectedFits.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {selectedFits.map((fit, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1 bg-eve-cyan/5 border border-eve-cyan/20">
                        <span className="flex-1 text-xs text-eve-text truncate">{fit.name}</span>
                        <button
                          onClick={() => { setSelectedFits(prev => prev.filter((_, j) => j !== i)); setFitImportResults(null) }}
                          className="text-eve-dim hover:text-eve-red transition-colors shrink-0"
                          title="Remove"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Saved fits searchable picker */}
                {savedFits.length > 0 && (
                  <div className="relative" ref={fitPickerRef}>
                    <div className="relative">
                      <input
                        className="eve-input w-full text-xs pr-6"
                        placeholder={selectedFits.length > 0 ? `Add another saved fit…` : `Search ${savedFits.length} saved fits…`}
                        value={fitPickerQuery}
                        onChange={e => { setFitPickerQuery(e.target.value); setFitPickerOpen(true) }}
                        onFocus={() => { setFitPickerOpen(true) }}
                        spellCheck={false}
                      />
                      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-eve-dim pointer-events-none" />
                    </div>
                    {fitPickerOpen && (
                      <div className="absolute z-50 w-full mt-0.5 bg-eve-panel border border-eve-border max-h-48 overflow-y-auto">
                        {filteredSavedFits.length === 0 ? (
                          <div className="px-2 py-2 text-eve-dim text-xs">{fitPickerQuery ? 'No fits match' : 'All fits already added'}</div>
                        ) : filteredSavedFits.map(fit => (
                          <div
                            key={fit.id}
                            className="px-2 py-1.5 hover:bg-eve-border/30 cursor-pointer text-xs text-eve-text truncate"
                            onMouseDown={() => {
                              setSelectedFits(prev => [...prev, { id: fit.id, name: fit.name, fitText: fit.fitText }])
                              setFitPickerQuery('')
                              setFitPickerOpen(false)
                              setFitImportResults(null)
                            }}
                          >
                            {fit.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* EFT paste area */}
                <div className="flex flex-col gap-1">
                  {selectedFits.length > 0 && (
                    <span className="text-[10px] text-eve-dim uppercase tracking-wider">Or paste additional EFT text:</span>
                  )}
                  <textarea
                    className="w-full h-32 bg-black/30 border border-eve-border text-[11px] text-eve-text font-mono px-2 py-1.5 outline-none resize-none placeholder:text-eve-dim"
                    placeholder="Paste EFT fit here…"
                    value={fitImportText}
                    onChange={e => { setFitImportText(e.target.value); setFitImportResults(null) }}
                  />
                </div>

                <button
                  onClick={resolveFit}
                  disabled={selectedFits.length === 0 && !fitImportText.trim() || fitImportLoading}
                  className="eve-btn-primary text-[10px] uppercase tracking-wider py-1.5 disabled:opacity-40"
                >
                  {fitImportLoading
                    ? 'Resolving…'
                    : selectedFits.length > 1
                      ? `Resolve ${selectedFits.length} Fits`
                      : 'Resolve Blueprints'}
                </button>

                {fitImportError && (
                  <div className="text-eve-red text-[11px]">{fitImportError}</div>
                )}

                {/* Results table */}
                {fitImportResults && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-eve-muted uppercase tracking-wider">
                        {fitImportResults.filter(r => r.hasBlueprint).length} / {fitImportResults.length} items have blueprints
                      </span>
                      <button
                        onClick={loadFitPlan}
                        disabled={fitImportResults.filter(r => r.hasBlueprint).length === 0}
                        className="eve-btn-primary text-[10px] uppercase tracking-wider px-3 py-1 disabled:opacity-40"
                      >
                        Build Plan (All)
                      </button>
                    </div>
                    <div className="border border-eve-border divide-y divide-eve-border/40 max-h-48 overflow-y-auto">
                      {fitImportResults.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1">
                          <div className="shrink-0">
                            {item.hasBlueprint
                              ? <CheckCircle2 size={10} className="text-eve-green" />
                              : <XCircle size={10} className="text-eve-red" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-eve-text truncate">{item.name}</div>
                            {item.blueprintName && <div className="text-[9px] text-eve-muted truncate">{item.blueprintName}</div>}
                          </div>
                          <div className="text-[10px] text-eve-dim shrink-0">×{item.qty}</div>
                          {item.hasBlueprint && item.blueprintTypeId && item.blueprintName && (
                            <button
                              onClick={() => {
                                setActiveBlueprint({ typeId: item.blueprintTypeId!, typeName: item.blueprintName!, me: 0, te: 0, runs: item.qty })
                                setMe(0); setTe(0); setRuns(item.qty)
                                setShowFitImport(false)
                              }}
                              className="shrink-0 text-[9px] uppercase tracking-wider text-eve-cyan border border-eve-cyan/40 px-1.5 py-0.5 hover:bg-eve-cyan/10 transition-colors"
                            >
                              Load
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Steps Popout (portal-like fixed overlay) ─────────────── */}
      {(() => {
        // Compute export name based on context
        let popoutExportName: string
        if (fitPlanAllStepsActive.current) {
          const names = fitPlanItems.filter(i => i.data).map(i => i.data!.productName)
          const shown = names.slice(0, 2).join(' + ')
          const extra = names.length > 2 ? ` + ${names.length - 2} more` : ''
          popoutExportName = `${shown}${extra} — Fit Build`
        } else if (fitPlanMode && activeBlueprint) {
          const item = fitPlanItems.find(i => i.blueprint.typeId === activeBlueprint.typeId)
          popoutExportName = (item?.data?.productName ?? activeBlueprint.typeName.replace(' Blueprint', '')) + ' — Fit'
        } else {
          popoutExportName = data?.productName ?? activeBlueprint?.typeName.replace(' Blueprint', '') ?? 'Build Chain'
        }

        // Compute finalSteps for the popout based on current mode
        let popoutFinalSteps: FinalStep[] | undefined
        if (fitPlanAllStepsActive.current) {
          popoutFinalSteps = fitPlanItems
            .filter(item => item.data)
            .map(item => ({
              name: item.data!.productName,
              productTypeId: item.data!.productTypeId,
              runs: item.blueprint.runs * fitPlanQty,
              qtyPerRun: item.data!.productQty,
              timePerRun: item.data!.adjustedTime,
            }))
        } else if (fitPlanMode && activeBlueprint) {
          const item = fitPlanItems.find(i => i.blueprint.typeId === activeBlueprint.typeId)
          if (item?.data) {
            popoutFinalSteps = [{
              name: item.data.productName,
              productTypeId: item.data.productTypeId,
              runs: item.blueprint.runs * fitPlanQty,
              qtyPerRun: item.data.productQty,
              timePerRun: item.data.adjustedTime,
            }]
          }
        } else if (data) {
          popoutFinalSteps = [{
            name: data.productName,
            productTypeId: data.productTypeId,
            runs,
            qtyPerRun: data.productQty,
            timePerRun: data.adjustedTime,
          }]
        }
        return (
          <AnimatePresence>
            {showStepsPopout && (activeBlueprint || fitPlanAllStepsActive.current) && (
              <StepsPopout
                blueprint={activeBlueprint ?? { typeId: 0, typeName: 'Full Fit Plan', me: 0, te: 0, runs: fitPlanItems.length }}
                chainData={chainData}
                chainLoading={chainLoading || allStepsLoading}
                chainError={chainError}
                mfgStructure={structure}
                mfgRig={rig}
                rxStructure={reactionStructure}
                rxRig={reactionRig}
                security={security}
                system={system}
                clientAssetMap={clientAssetMap}
                ownedBpTypeIds={assets.length > 0 ? ownedBpTypeIds : undefined}
                exportName={popoutExportName}
                finalSteps={popoutFinalSteps}
                onClose={() => { setShowStepsPopout(false); fitPlanAllStepsActive.current = false }}
              />
            )}
          </AnimatePresence>
        )
      })()}
    </div>
  )
}

export default function IndustryPanel({ jobs, loading, onRefresh, freightImport, onFreightImportClear, blueprintImport, onBlueprintImportClear, characterId, accessToken, skills, assets, allIndustryJobs, characters }: IndustryPanelProps) {
  const [tab, setTab] = useState<'jobs' | 'freight' | 'blueprint'>('jobs')
  const [collapsedChars, setCollapsedChars]  = useState<Record<number, boolean>>({})
  const [collapsedTypes, setCollapsedTypes]  = useState<Record<string, boolean>>({})
  const toggleChar = (id: number) => setCollapsedChars(p => ({ ...p, [id]: !p[id] }))
  const toggleType = (key: string) => setCollapsedTypes(p => ({ ...p, [key]: !p[key] }))
  const now = Date.now()
  const readyJobs = jobs.filter(j =>
    j.status === 'ready' || (j.status === 'active' && new Date(j.endDate).getTime() <= now)
  )
  const activeJobs = jobs.filter(j =>
    j.status === 'active' && new Date(j.endDate).getTime() > now
  )

  const charJobGroups = useMemo(() => {
    if (!allIndustryJobs || !characters) return null
    return characters
      .filter(c => allIndustryJobs[c.characterId]?.length)
      .map(c => {
        const charJobs = [...(allIndustryJobs[c.characterId] ?? [])]
          .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
        const byType: Record<string, EveIndustryJob[]> = {}
        for (const job of charJobs) {
          if (!byType[job.activityName]) byType[job.activityName] = []
          byType[job.activityName].push(job)
        }
        return { character: c, byType, total: charJobs.length }
      })
  }, [allIndustryJobs, characters])

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

          {/* Jobs grouped by character → activity type */}
          {jobs.length === 0 ? (
            <div className="eve-panel p-3 flex items-center justify-center text-eve-muted text-xs py-6">
              NO ACTIVE INDUSTRY JOBS
            </div>
          ) : charJobGroups && charJobGroups.length > 0 ? (
            <div className="space-y-2">
              {charJobGroups.map(({ character, byType, total }) => {
                const charCollapsed = !!collapsedChars[character.characterId]
                return (
                  <div key={character.characterId} className="eve-panel">
                    {/* Character header — clickable */}
                    <button
                      onClick={() => toggleChar(character.characterId)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-eve-border/10 transition-colors"
                    >
                      {charCollapsed
                        ? <ChevronRightIcon size={9} className="text-eve-dim shrink-0" />
                        : <ChevronDown size={9} className="text-eve-dim shrink-0" />}
                      <img
                        src={`https://images.evetech.net/characters/${character.characterId}/portrait?size=32`}
                        className="w-4 h-4 rounded-full opacity-80 shrink-0"
                        alt=""
                      />
                      <span className="text-eve-cyan text-[10px] uppercase tracking-widest font-mono flex-1 text-left">{character.characterName}</span>
                      <span className="text-[9px] text-eve-muted shrink-0">{total} job{total !== 1 ? 's' : ''}</span>
                    </button>

                    {/* Activity type groups */}
                    {!charCollapsed && (
                      <div className="px-3 pb-2 space-y-1.5">
                        {Object.entries(byType).map(([activity, actJobs]) => {
                          const typeKey = `${character.characterId}:${activity}`
                          const typeCollapsed = !!collapsedTypes[typeKey]
                          return (
                            <div key={activity}>
                              <button
                                onClick={() => toggleType(typeKey)}
                                className="w-full flex items-center gap-2 py-1 hover:opacity-80 transition-opacity"
                              >
                                {typeCollapsed
                                  ? <ChevronRightIcon size={8} className="text-eve-dim shrink-0" />
                                  : <ChevronDown size={8} className="text-eve-dim shrink-0" />}
                                <span className={`text-[9px] uppercase tracking-wider font-mono ${ACTIVITY_COLORS[activity] || 'text-eve-muted'}`}>{activity}</span>
                                <div className="flex-1 h-px bg-eve-border/30" />
                                <span className="text-[9px] text-eve-dim shrink-0">{actJobs.length}</span>
                              </button>
                              {!typeCollapsed && (
                                <div className="space-y-px pl-3">
                                  {actJobs.map(job => (
                                    <div key={job.jobId} className="border-l border-eve-border/40 pl-2 py-1">
                                      <div className="flex items-center gap-2">
                                        <span className="flex-1 text-[11px] text-eve-text truncate">{job.blueprintTypeName}</span>
                                        <span className="text-[9px] text-eve-dim shrink-0">×{job.runs}</span>
                                        <span className={`text-[9px] border px-1 py-px uppercase shrink-0 ${STATUS_COLORS[job.status] || 'text-eve-muted border-eve-dim'}`}>
                                          {job.status}
                                        </span>
                                      </div>
                                      {job.status === 'active' && <JobProgress job={job} />}
                                    </div>
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
          ) : (
            <div className="space-y-2">
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
          )}
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

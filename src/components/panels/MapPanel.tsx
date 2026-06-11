import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

interface System {
  id: number
  name: string
  x: number
  z: number
  sec: number
  region: string
  con: string
  conns: number[]
}

interface Region {
  name: string
  x: number    // centroid (from system positions after separation)
  z: number
  sec: number  // average security
  systems: System[]
  regionConns: string[]  // names of connected regions
}

// Module-level cache — survives tab switches
let SYSTEMS: System[] = []
let sysMap   = new Map<number, System>()
let REGIONS: Region[] = []
let regMap   = new Map<string, Region>()
let LY_PER_UNIT = 0   // set from JSON metadata; 0 means scale unknown
let loadPromise: Promise<void> | null = null

// ── Minimum-separation pass ──────────────────────────────────────────────────
// Pushes overlapping systems apart organically, preserving relative layout.
// MIN_D is in the same normalized coordinate space as s.x / s.z.
// At default zoom 10.5 and span ≈ 525 px: 0.015 * 525 * 10.5 ≈ 83 px between
// system centers. Pills are ~70 px wide — comfortable gap, no visible grid.
const MIN_D = 0.015

function applyMinSeparation(passes = 4) {
  const CELL = MIN_D * 1.5
  const ckey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`

  for (let p = 0; p < passes; p++) {
    // Rebuild spatial hash each pass (positions shift)
    const cells = new Map<string, System[]>()
    for (const s of SYSTEMS) {
      const k = ckey(s.x, s.z)
      if (!cells.has(k)) cells.set(k, [])
      cells.get(k)!.push(s)
    }

    for (const s of SYSTEMS) {
      const cx = Math.floor(s.x / CELL), cz = Math.floor(s.z / CELL)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const t of cells.get(`${cx + dx},${cz + dz}`) ?? []) {
            if (t.id >= s.id) continue
            const ex = s.x - t.x, ez = s.z - t.z
            const dist = Math.hypot(ex, ez)
            if (dist < MIN_D && dist > 1e-6) {
              const push = (MIN_D - dist) * 0.5
              const nx = ex / dist, nz = ez / dist
              s.x += nx * push;  s.z += nz * push
              t.x -= nx * push;  t.z -= nz * push
            }
          }
        }
      }
    }
  }
}

// ── Region builder ───────────────────────────────────────────────────────────
function buildRegions() {
  const grouped = new Map<string, System[]>()
  for (const s of SYSTEMS) {
    if (!grouped.has(s.region)) grouped.set(s.region, [])
    grouped.get(s.region)!.push(s)
  }
  REGIONS = []; regMap = new Map()
  for (const [name, systems] of grouped) {
    const x   = systems.reduce((a, s) => a + s.x, 0) / systems.length
    const z   = systems.reduce((a, s) => a + s.z, 0) / systems.length
    const sec = systems.reduce((a, s) => a + s.sec, 0) / systems.length
    const r: Region = { name, x, z, sec, systems, regionConns: [] }
    REGIONS.push(r); regMap.set(name, r)
  }
  // Cross-region connections
  for (const r of REGIONS) {
    const connSet = new Set<string>()
    for (const sys of r.systems)
      for (const destId of sys.conns) {
        const dest = sysMap.get(destId)
        if (dest && dest.region !== r.name) connSet.add(dest.region)
      }
    r.regionConns = [...connSet]
  }
}

function ensureLoaded(): Promise<void> {
  if (SYSTEMS.length > 0) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = fetch('/eve-systems.json')
    .then(r => r.json())
    .then((payload: { sc?: number; v?: Array<{ id: number; n: string; x: number; z: number; s: number; r: string; k?: string; c: number[] }> } | Array<{ id: number; n: string; x: number; z: number; s: number; r: string; k?: string; c: number[] }>) => {
      // Support both new { sc, v } format and legacy bare array
      const raw  = Array.isArray(payload) ? payload : (payload.v ?? [])
      const scM  = Array.isArray(payload) ? 0        : (payload.sc ?? 0)
      // 1 normalised unit = sc/2 metres; 1 LY = 9.461e15 m
      LY_PER_UNIT = scM > 0 ? scM / 2 / 9.461e15 : 0
      SYSTEMS = raw.map(d => ({ id: d.id, name: d.n, x: d.x, z: d.z, sec: d.s, region: d.r, con: d.k ?? 'Unknown', conns: d.c }))
      sysMap  = new Map(SYSTEMS.map(s => [s.id, s]))
      applyMinSeparation()   // organic nudge — no grid, preserves proportions
      buildRegions()         // compute region centroids after separation
    })
  return loadPromise
}

// ── Client-side Dijkstra route planner ──────────────────────────────────────
// Uses the already-loaded SYSTEMS graph + optional extra bridge edges.
// Always returns a list of system IDs (origin … destination), or null if unreachable.
function clientRoute(
  originId:   number,
  destId:     number,
  flag:       'shortest' | 'secure' | 'insecure',
  avoidIds:   number[],
  bridges:    Array<{ fromId: number; toId: number }>
): number[] | null {
  if (!sysMap.size) return null
  const avoid = new Set(avoidIds)
  if (avoid.has(originId) || avoid.has(destId)) return null

  const edgeCost = (toSec: number): number => {
    if (flag === 'shortest')  return 1
    if (flag === 'secure')    return toSec < 0.45 ? 100_000 : 1
    /* insecure */            return toSec >= 0.45 ? 100_000 : 1
  }

  // Binary min-heap helpers
  type Entry = [number, number]   // [dist, systemId]
  const heap: Entry[] = []
  const heapPush = (e: Entry) => {
    heap.push(e); let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]; i = p
    }
  }
  const heapPop = (): Entry => {
    const top = heap[0], last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last; let i = 0
      while (true) {
        let s = i, l = 2*i+1, r = 2*i+2
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r
        if (s === i) break
        ;[heap[i], heap[s]] = [heap[s], heap[i]]; i = s
      }
    }
    return top
  }

  const dist = new Map<number, number>()
  const prev = new Map<number, number>()
  dist.set(originId, 0)
  heapPush([0, originId])

  while (heap.length > 0) {
    const [d, id] = heapPop()
    if (d > (dist.get(id) ?? Infinity)) continue
    if (id === destId) break

    const s = sysMap.get(id)
    if (!s) continue

    // Stargate neighbours
    for (const toId of s.conns) {
      if (avoid.has(toId)) continue
      const t = sysMap.get(toId); if (!t) continue
      const nd = d + edgeCost(t.sec)
      if (nd < (dist.get(toId) ?? Infinity)) {
        dist.set(toId, nd); prev.set(toId, id); heapPush([nd, toId])
      }
    }
    // Extra bridge edges (bidirectional)
    for (const br of bridges) {
      const otherId = br.fromId === id ? br.toId : br.toId === id ? br.fromId : -1
      if (otherId === -1 || avoid.has(otherId)) continue
      const t = sysMap.get(otherId); if (!t) continue
      const nd = d + edgeCost(t.sec)
      if (nd < (dist.get(otherId) ?? Infinity)) {
        dist.set(otherId, nd); prev.set(otherId, id); heapPush([nd, otherId])
      }
    }
  }

  if (!dist.has(destId)) return null

  // Reconstruct path
  const path: number[] = []
  let cur: number | undefined = destId
  while (cur !== undefined) {
    path.unshift(cur)
    if (cur === originId) break
    cur = prev.get(cur)
  }
  return path[0] === originId ? path : null
}

interface JumpBridge { fromSystemId: number; destName: string }
interface MapPanelProps { currentSystemName?: string | null; jumpBridges?: JumpBridge[] }

// ── Security color scale ─────────────────────────────────────────────────────
// Lightened palette — pastel-ish so black text reads clearly on top of pills
const SEC_COLOR_STOPS: [number, number, number][] = [
  [130, 165, 235],  // 1.0  soft blue
  [110, 185, 255],  // 0.9  light dodger blue
  [ 80, 220, 245],  // 0.8  light cyan
  [ 70, 215, 170],  // 0.7  light teal
  [100, 215, 100],  // 0.6  light green
  [185, 220,  75],  // 0.5  light yellow-green
  [235, 210,  80],  // 0.4  light yellow
  [240, 155,  75],  // 0.3  light orange
  [230, 110, 110],  // 0.2  light red
  [210, 100, 190],  // 0.1  light magenta
  [175, 105, 225],  // 0.0  light purple
]
function _secInterp(sec: number): [number, number, number] {
  const t = 1 - Math.max(0, Math.min(1, sec))
  const n = SEC_COLOR_STOPS.length - 1
  const pos = t * n; const lo = Math.floor(pos); const hi = Math.min(lo + 1, n); const f = pos - lo
  const [r1,g1,b1] = SEC_COLOR_STOPS[lo]; const [r2,g2,b2] = SEC_COLOR_STOPS[hi]
  return [r1+(r2-r1)*f, g1+(g2-g1)*f, b1+(b2-b1)*f]
}
function secColor(sec: number): string {
  const [r,g,b] = _secInterp(sec); return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
}
function secColorHex(sec: number): string {
  const [r,g,b] = _secInterp(sec)
  const h = (v: number) => Math.round(v).toString(16).padStart(2,'0')
  return `#${h(r)}${h(g)}${h(b)}`
}
function secLabel(sec: number): string { return sec.toFixed(1) }

// ── Autocomplete input ────────────────────────────────────────────────────────
function SystemInput({
  value, onChange, onSelect, placeholder, inputClass = '', wrapperClass = '', rightSlot, onEnter,
}: {
  value: string; onChange: (v: string) => void; onSelect: (s: System) => void
  placeholder?: string; inputClass?: string; wrapperClass?: string
  rightSlot?: React.ReactNode; onEnter?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const suggestions = useMemo(() => {
    if (value.length < 2) return []
    const q = value.toLowerCase()
    const starts   = SYSTEMS.filter(s => s.name.toLowerCase().startsWith(q))
    const contains = SYSTEMS.filter(s => !s.name.toLowerCase().startsWith(q) && s.name.toLowerCase().includes(q))
    return [...starts, ...contains].slice(0, 8)
  }, [value])
  const choose = (s: System) => { onChange(s.name); onSelect(s); setOpen(false) }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!open || suggestions.length === 0) { if (e.key === 'Enter') onEnter?.(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i+1, suggestions.length-1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i-1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[activeIdx]) }
    else if (e.key === 'Tab')   { e.preventDefault(); choose(suggestions[activeIdx]) }
  }
  return (
    <div className={`relative ${wrapperClass}`}>
      <input type="text" value={value} placeholder={placeholder} className={inputClass}
        onChange={e => { onChange(e.target.value); setOpen(true); setActiveIdx(0) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={handleKeyDown} />
      {rightSlot}
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 bg-eve-panel border border-eve-border shadow-lg overflow-hidden" style={{ maxHeight: 200 }}>
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            {suggestions.map((s, i) => (
              <div key={s.id} onMouseDown={() => choose(s)}
                className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-[9px] font-mono ${i === activeIdx ? 'bg-eve-cyan/15 text-eve-text' : 'text-eve-muted hover:bg-eve-border/20 hover:text-eve-text'}`}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: secColor(s.sec) }} />
                <span>{s.name}</span>
                <span className="ml-auto text-eve-dim text-[8px] shrink-0">{s.region}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function MapPanel({ currentSystemName, jumpBridges = [] }: MapPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const stateRef  = useRef({ zoom: 1.0, offsetX: 0, offsetY: 0, W: 0, H: 0 })
  const dragRef   = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 })
  const animRef   = useRef<number | null>(null)

  const [loaded, setLoaded]     = useState(SYSTEMS.length > 0)
  const [isDark, setIsDark]     = useState(() => document.documentElement.classList.contains('dark'))
  const [selected, setSelected] = useState<System | null>(null)
  const [hovered, setHovered]   = useState<System | null>(null)
  const [colorBySec, setColorBySec] = useState(true)
  const [search, setSearch]         = useState('')
  const [searchResult, setSearchResult] = useState<System | null>(null)

  // Route state
  const [routeFrom, setRouteFrom]   = useState('')
  const [routeTo, setRouteTo]       = useState('')
  const [routeFlag, setRouteFlag]   = useState<'shortest' | 'secure' | 'insecure'>('shortest')
  const [routeAvoid, setRouteAvoid] = useState<System[]>([])
  const [routeAvoidInput, setRouteAvoidInput] = useState('')
  const [useJumpBridges, setUseJumpBridges]   = useState(() =>
    localStorage.getItem('aurora_map_use_bridges') !== 'false'  // default true
  )
  const [route, setRoute]           = useState<number[]>([])
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError]     = useState<string | null>(null)

  // Custom jump bridges — persisted to localStorage
  const [customBridges, setCustomBridges] = useState<Array<{ from: string; to: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('aurora_custom_bridges') ?? '[]') } catch { return [] }
  })
  const [cbFrom, setCbFrom] = useState('')
  const [cbTo,   setCbTo]   = useState('')
  const [cbError, setCbError] = useState<string | null>(null)
  const saveCustomBridges = (next: Array<{ from: string; to: string }>) => {
    setCustomBridges(next)
    localStorage.setItem('aurora_custom_bridges', JSON.stringify(next))
  }
  const addCustomBridge = () => {
    const a = SYSTEMS.find(s => s.name.toLowerCase() === cbFrom.trim().toLowerCase())
    const b = SYSTEMS.find(s => s.name.toLowerCase() === cbTo.trim().toLowerCase())
    if (!a) { setCbError('Unknown origin system'); return }
    if (!b) { setCbError('Unknown destination system'); return }
    if (a.id === b.id) { setCbError('Systems must be different'); return }
    const dupe = customBridges.some(
      br => (br.from === a.name && br.to === b.name) || (br.from === b.name && br.to === a.name)
    )
    if (dupe) { setCbError('Bridge already exists'); return }
    setCbError(null); setCbFrom(''); setCbTo('')
    saveCustomBridges([...customBridges, { from: a.name, to: b.name }])
  }

  // Region clustering state
  // hoveredRegRef — updated in mouse handler, no re-render needed (just schedDraw)
  const hoveredRegRef   = useRef<string | null>(null)
  const [hoveredReg, setHoveredReg] = useState<Region | null>(null)
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set())
  const manualExpandedRef = useRef<Set<string>>(new Set())
  manualExpandedRef.current = manualExpanded

  // Ref mirrors for stale-closure-safe draw access
  const searchResultRef = useRef<System | null>(null)
  searchResultRef.current = searchResult
  const routeRef   = useRef<number[]>([])
  routeRef.current = route
  // bridgesRef stores ONE entry per bridge (unique pairs).
  // Route planning explicitly passes both directions to ESI.
  const bridgesRef = useRef<Array<{ fromId: number; toId: number }>>([])
  bridgesRef.current = [
    // ESI Ansiblex bridges (already one direction per structure)
    ...jumpBridges
      .map(b => {
        const from = sysMap.get(b.fromSystemId)
        const to   = SYSTEMS.find(s => s.name.toLowerCase() === b.destName.toLowerCase())
        return from && to ? { fromId: from.id, toId: to.id } : null
      })
      .filter((b): b is { fromId: number; toId: number } => b !== null),
    // Custom bridges — one entry per bridge (canvas deduplication + correct count)
    ...customBridges
      .map(b => {
        const from = SYSTEMS.find(s => s.name === b.from)
        const to   = SYSTEMS.find(s => s.name === b.to)
        return from && to ? { fromId: from.id, toId: to.id } : null
      })
      .filter((b): b is { fromId: number; toId: number } => b !== null),
  ]

  // Derived: which regions are auto-expanded
  const currentSysId = currentSystemName
    ? SYSTEMS.find(s => s.name.toLowerCase() === currentSystemName.toLowerCase())?.id ?? 30000142
    : 30000142
  const currentSys_forReg = SYSTEMS.find(s => s.id === currentSysId)

  const autoExpanded = useMemo(() => {
    const set = new Set<string>()
    if (currentSys_forReg) set.add(currentSys_forReg.region)
    if (searchResult) set.add(searchResult.region)
    for (const id of route) { const s = sysMap.get(id); if (s) set.add(s.region) }
    for (const name of manualExpanded) set.add(name)
    return set
  }, [currentSys_forReg?.region, searchResult?.region, route, manualExpanded]) // eslint-disable-line
  const autoExpandedRef = useRef<Set<string>>(new Set())
  autoExpandedRef.current = autoExpanded

  useEffect(() => {
    if (loaded) return
    ensureLoaded().then(() => setLoaded(true))
  }, [loaded])

  useEffect(() => {
    const mo = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  const worldToCanvas = useCallback((wx: number, wy: number): [number, number] => {
    const { zoom, offsetX, offsetY, W, H } = stateRef.current
    const span = Math.min(W, H) * 0.75
    return [W / 2 + offsetX + wx * span * zoom, H / 2 + offsetY + (-wy) * span * zoom]
  }, [])

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { zoom, W, H } = stateRef.current

    const dark       = document.documentElement.classList.contains('dark')
    const bg         = dark ? '#080b10' : '#f0ede8'
    const connColor  = dark ? 'rgba(30,60,95,0.85)'  : 'rgba(100,130,170,0.55)'
    const starColor  = dark ? 'rgba(180,200,220,'     : 'rgba(80,100,130,'
    const loadColor  = dark ? '#334455'               : '#7a8fa8'
    const pillText   = dark ? 'rgba(0,0,0,0.75)'      : 'rgba(255,255,255,0.85)'

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    if (!loaded || SYSTEMS.length === 0) {
      ctx.fillStyle = loadColor
      ctx.font = "11px 'Courier New', monospace"
      ctx.textAlign = 'center'
      ctx.fillText('LOADING MAP DATA...', W / 2, H / 2)
      return
    }

    // Star field
    for (let i = 0; i < 300; i++) {
      const px = ((i * 1618 + 1302) % 1000) / 1000 * W
      const py = ((i * 2741 + 714)  % 1000) / 1000 * H
      ctx.fillStyle = `${starColor}${0.04 + ((i * 97) % 100) / 700})`
      ctx.fillRect(px, py, 1, 1)
    }

    // Region zoom threshold: below this → region nodes; above → systems
    const REGION_ZOOM = 3.5
    const inRegionMode = zoom < REGION_ZOOM
    const isExpanded   = (name: string) =>
      autoExpandedRef.current.has(name) || hoveredRegRef.current === name

    // ── Connections ──────────────────────────────────────────────────────────
    if (inRegionMode) {
      // Cross-region connections between region centroids (collapsed only)
      ctx.lineWidth = 0.5
      const drawnRR = new Set<string>()
      for (const r of REGIONS) {
        const [ax, ay] = worldToCanvas(r.x, r.z)
        if (ax < -300 || ax > W + 300 || ay < -300 || ay > H + 300) continue
        for (const otherName of r.regionConns) {
          const key = r.name < otherName ? `${r.name}|${otherName}` : `${otherName}|${r.name}`
          if (drawnRR.has(key)) continue
          drawnRR.add(key)
          if (isExpanded(r.name) || isExpanded(otherName)) continue
          const or = regMap.get(otherName)
          if (!or) continue
          const [bx, by] = worldToCanvas(or.x, or.z)
          ctx.strokeStyle = connColor
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        }
      }
      // System connections within expanded regions
      ctx.lineWidth = Math.max(0.6, Math.min(1.8, zoom * 0.15))
      const drawnS = new Set<string>()
      for (const r of REGIONS) {
        if (!isExpanded(r.name)) continue
        for (const s of r.systems) {
          const [ax, ay] = worldToCanvas(s.x, s.z)
          for (const tid of s.conns) {
            const key = s.id < tid ? `${s.id}-${tid}` : `${tid}-${s.id}`
            if (drawnS.has(key)) continue; drawnS.add(key)
            const t = sysMap.get(tid)
            if (!t) continue
            const [bx, by] = worldToCanvas(t.x, t.z)
            ctx.strokeStyle = connColor
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
          }
        }
      }
    } else {
      // Full system mode — all connections
      ctx.lineWidth = Math.max(0.6, Math.min(1.8, zoom * 0.15))
      const drawn = new Set<string>()
      for (const s of SYSTEMS) {
        const [ax, ay] = worldToCanvas(s.x, s.z)
        if (ax < -200 || ax > W + 200 || ay < -200 || ay > H + 200) continue
        for (const tid of s.conns) {
          const key = s.id < tid ? `${s.id}-${tid}` : `${tid}-${s.id}`
          if (drawn.has(key)) continue; drawn.add(key)
          const t = sysMap.get(tid)
          if (!t) continue
          const [bx, by] = worldToCanvas(t.x, t.z)
          ctx.strokeStyle = connColor
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        }
      }
    }

    // Jump bridges — bold green dotted arch
    if (bridgesRef.current.length > 0) {
      ctx.save()
      ctx.lineWidth   = 2.5
      ctx.strokeStyle = 'rgba(80, 255, 130, 0.90)'
      ctx.shadowColor = 'rgba(80, 255, 130, 0.55)'
      ctx.shadowBlur  = 6
      ctx.setLineDash([5, 7])
      const drawnB = new Set<string>()
      for (const { fromId, toId } of bridgesRef.current) {
        const key = fromId < toId ? `${fromId}-${toId}` : `${toId}-${fromId}`
        if (drawnB.has(key)) continue; drawnB.add(key)
        const a = sysMap.get(fromId), b = sysMap.get(toId)
        if (!a || !b) continue
        const [ax, ay] = worldToCanvas(a.x, a.z)
        const [bx, by] = worldToCanvas(b.x, b.z)
        // Control point offset perpendicular to the midpoint — creates the arch
        const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5
        const dx = bx - ax, dy = by - ay
        const len = Math.hypot(dx, dy) || 1
        // Arch height = 25% of segment length, clamped 30–120 px
        const archH = Math.min(120, Math.max(30, len * 0.25))
        // Perpendicular unit vector (rotate 90°)
        const cpx = mx - (dy / len) * archH
        const cpy = my + (dx / len) * archH
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.quadraticCurveTo(cpx, cpy, bx, by)
        ctx.stroke()
      }
      ctx.restore()
    }

    // Route line — skip segments that cross a jump bridge (those get the green arch)
    if (routeRef.current.length >= 2) {
      ctx.save()
      ctx.lineWidth = 2; ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.shadowColor = 'rgba(0,212,255,0.7)'; ctx.shadowBlur = 6
      const bridgeSet = new Set(
        bridgesRef.current.flatMap(b => [`${b.fromId}-${b.toId}`, `${b.toId}-${b.fromId}`])
      )
      const rte = routeRef.current
      for (let i = 0; i < rte.length - 1; i++) {
        const aId = rte[i], bId = rte[i + 1]
        // Skip if this hop is a bridge (not a stargate connection)
        if (bridgeSet.has(`${aId}-${bId}`)) continue
        const a = sysMap.get(aId), b = sysMap.get(bId)
        if (!a || !b) continue
        const [ax, ay] = worldToCanvas(a.x, a.z)
        const [bx, by] = worldToCanvas(b.x, b.z)
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      }
      ctx.restore()
    }

    // ── Nodes ────────────────────────────────────────────────────────────────
    // Shared system pill renderer
    const pillH    = Math.max(4, Math.min(20, zoom * 1.9))
    const pillR    = Math.min(pillH / 2, 4)
    const fontSize = Math.max(7, Math.min(12, zoom * 1.1))
    const showText = zoom >= 3.5

    const drawSystem = (s: System) => {
      const [cx, cy] = worldToCanvas(s.x, s.z)
      if (cx < -120 || cx > W + 120 || cy < -20 || cy > H + 20) return

      const isCurrent      = s.id === currentSysId
      const isSelectedSys  = selected?.id === s.id
      const isHoveredSys   = hovered?.id === s.id
      const isSearchResult = searchResultRef.current?.id === s.id

      ctx.font = `${fontSize}px 'Courier New', monospace`
      ctx.textAlign = 'center'

      let color = colorBySec ? secColor(s.sec) : 'rgb(58,80,104)'
      if (isCurrent)     color = 'rgb(0,212,255)'
      if (isSelectedSys) color = 'rgb(200,168,75)'

      const nameW = showText ? ctx.measureText(s.name).width : 0
      const pW    = Math.max(pillH * 2, nameW + pillH)
      const px    = cx - pW / 2, py = cy - pillH / 2

      if (isSelectedSys || isCurrent || isHoveredSys || isSearchResult) {
        ctx.shadowColor = (isSearchResult && !isSelectedSys) ? 'rgba(255,255,255,0.9)' : color
        ctx.shadowBlur  = (isSelectedSys || isCurrent) ? 10 : isSearchResult ? 8 : 5
      }
      ctx.fillStyle = color
      ctx.beginPath(); ctx.roundRect(px, py, pW, pillH, pillR); ctx.fill()
      ctx.shadowBlur = 0

      if (isSearchResult && !isSelectedSys) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.roundRect(px - 2, py - 2, pW + 4, pillH + 4, pillR + 2); ctx.stroke()
      }
      if (showText) { ctx.fillStyle = pillText; ctx.fillText(s.name, cx, cy + fontSize * 0.35) }
    }

    if (inRegionMode) {
      // Expanded regions: draw individual systems
      for (const r of REGIONS) {
        if (!isExpanded(r.name)) continue
        for (const s of r.systems) drawSystem(s)
      }

      // Collapsed regions: draw region blob node
      const rFontSize = Math.max(7, Math.min(11, zoom * 3))
      const rPillH    = Math.max(10, Math.min(28, zoom * 8))
      ctx.font      = `bold ${rFontSize}px 'Courier New', monospace`
      ctx.textAlign = 'center'

      for (const r of REGIONS) {
        if (isExpanded(r.name)) continue
        const [cx, cy] = worldToCanvas(r.x, r.z)
        if (cx < -120 || cx > W + 120 || cy < -30 || cy > H + 30) continue

        const isHR         = hoveredRegRef.current === r.name
        const hasCurrentSys = r.systems.some(s => s.id === currentSysId)
        const hasSearchRes  = searchResultRef.current !== null &&
          r.systems.some(s => s.id === searchResultRef.current!.id)

        let color = colorBySec ? secColor(r.sec) : 'rgb(58,80,104)'
        if (hasCurrentSys) color = 'rgb(0,212,255)'

        const label = r.name
        const nameW = ctx.measureText(label).width
        const rPillW = Math.max(rPillH * 2, nameW + rPillH * 0.8)
        const rPillR = Math.min(rPillH / 2, 5)
        const px = cx - rPillW / 2, py = cy - rPillH / 2

        if (isHR || hasCurrentSys || hasSearchRes) {
          ctx.shadowColor = hasCurrentSys ? 'rgba(0,212,255,0.8)'
            : hasSearchRes ? 'rgba(255,255,255,0.9)' : color
          ctx.shadowBlur = 14
        }
        ctx.fillStyle = color
        ctx.beginPath(); ctx.roundRect(px, py, rPillW, rPillH, rPillR); ctx.fill()
        ctx.shadowBlur = 0

        if (hasSearchRes && !hasCurrentSys) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.roundRect(px-2, py-2, rPillW+4, rPillH+4, rPillR+2); ctx.stroke()
        }
        if (isHR) {
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.beginPath(); ctx.roundRect(px-3, py-3, rPillW+6, rPillH+6, rPillR+3); ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.fillStyle = pillText
        ctx.fillText(label, cx, cy + rFontSize * 0.38)
      }
    } else {
      for (const s of SYSTEMS) drawSystem(s)
    }

    // ── Route callouts ────────────────────────────────────────────────────────
    // Small numbered hop-badges above each system on the active route.
    // Visible whenever the systems themselves are on-screen; always drawn on
    // top of everything else so they can't be obscured by other pills.
    if (routeRef.current.length >= 2) {
      const badgeFontSize = Math.max(7, Math.min(10, zoom * 0.95))
      ctx.font = `bold ${badgeFontSize}px 'Courier New', monospace`
      ctx.textAlign = 'center'

      const cPillH = Math.max(4, Math.min(20, zoom * 1.9))  // same as drawSystem
      const badgeH = badgeFontSize + 4
      const badgeGap = cPillH / 2 + 3   // gap between pill top and badge bottom

      routeRef.current.forEach((id, hop) => {
        const s = sysMap.get(id); if (!s) return
        const [cx, cy] = worldToCanvas(s.x, s.z)
        if (cx < -40 || cx > W + 40 || cy < -40 || cy > H + 40) return

        const label   = String(hop)
        const labelW  = ctx.measureText(label).width
        const badgeW  = Math.max(badgeH, labelW + 6)
        const bx      = cx - badgeW / 2
        const by      = cy - cPillH / 2 - badgeGap - badgeH

        // Connecting tick line
        ctx.strokeStyle = 'rgba(0,212,255,0.6)'
        ctx.lineWidth   = 0.8
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(cx, by + badgeH)
        ctx.lineTo(cx, cy - cPillH / 2)
        ctx.stroke()

        // Badge background
        const br = badgeH / 2
        ctx.fillStyle   = 'rgba(0,212,255,0.92)'
        ctx.shadowColor = 'rgba(0,212,255,0.5)'
        ctx.shadowBlur  = 4
        ctx.beginPath(); ctx.roundRect(bx, by, badgeW, badgeH, br); ctx.fill()
        ctx.shadowBlur = 0

        // Badge text
        ctx.fillStyle = 'rgba(0,0,0,0.85)'
        ctx.fillText(label, cx, by + badgeH - badgeFontSize * 0.22)
      })
    }

    // HUD
    ctx.fillStyle = dark ? 'rgba(13,17,23,0.85)' : 'rgba(240,237,232,0.9)'
    ctx.fillRect(12, H - 26, 180, 16)
    ctx.fillStyle = dark ? '#6a8aaa' : '#4a6a8a'
    ctx.font = "9px 'Courier New', monospace"
    ctx.textAlign = 'left'
    ctx.fillText(
      inRegionMode
        ? `ZOOM ${zoom.toFixed(2)}x  ·  ${REGIONS.length} REGIONS`
        : `ZOOM ${zoom.toFixed(2)}x  ·  ${SYSTEMS.length} SYSTEMS`,
      16, H - 14
    )
  }, [worldToCanvas, selected, hovered, colorBySec, currentSysId, loaded, isDark, manualExpanded])

  const schedDraw = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = requestAnimationFrame(draw)
  }, [draw])

  const resize = useCallback(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current
    if (!canvas || !wrap) return
    stateRef.current.W = canvas.width  = wrap.clientWidth
    stateRef.current.H = canvas.height = wrap.clientHeight
    schedDraw()
  }, [schedDraw])

  // ── Mouse hit-testing ─────────────────────────────────────────────────────
  const findHovered = useCallback((mx: number, my: number): System | null => {
    const zoom = stateRef.current.zoom
    const isExpandedFn = (name: string) =>
      autoExpandedRef.current.has(name) || hoveredRegRef.current === name
    const systemsToCheck = zoom < 3.5
      ? SYSTEMS.filter(s => isExpandedFn(s.region))
      : SYSTEMS
    let best: System | null = null, bestD = 18
    for (const s of systemsToCheck) {
      const [cx, cy] = worldToCanvas(s.x, s.z)
      const d = Math.hypot(mx - cx, my - cy)
      if (d < bestD) { bestD = d; best = s }
    }
    return best
  }, [worldToCanvas])

  const findHoveredReg = useCallback((mx: number, my: number): Region | null => {
    const zoom = stateRef.current.zoom
    const isExpandedFn = (name: string) =>
      autoExpandedRef.current.has(name) || hoveredRegRef.current === name
    const rPillH = Math.max(10, Math.min(28, zoom * 8))
    let best: Region | null = null, bestD = Infinity
    for (const r of REGIONS) {
      if (isExpandedFn(r.name)) continue
      const [cx, cy] = worldToCanvas(r.x, r.z)
      const dx = mx - cx, dy = my - cy
      const hw = Math.max(rPillH, 50), hh = rPillH / 2 + 4
      if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) {
        const d = Math.hypot(dx, dy)
        if (d < bestD) { bestD = d; best = r }
      }
    }
    return best
  }, [worldToCanvas])

  // ── Canvas event handlers ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return

    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = { active: true, startX: e.clientX, startY: e.clientY,
        originX: stateRef.current.offsetX, originY: stateRef.current.offsetY }
    }
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      if (dragRef.current.active) {
        stateRef.current.offsetX = dragRef.current.originX + (e.clientX - dragRef.current.startX)
        stateRef.current.offsetY = dragRef.current.originY + (e.clientY - dragRef.current.startY)
      }
      const inRegionMode = stateRef.current.zoom < 3.5
      if (inRegionMode) {
        const hr = findHoveredReg(mx, my)
        const prev = hoveredRegRef.current
        hoveredRegRef.current = hr?.name ?? null
        if (prev !== hoveredRegRef.current) setHoveredReg(hr)
        setHovered(findHovered(mx, my))
      } else {
        if (hoveredRegRef.current !== null) { hoveredRegRef.current = null; setHoveredReg(null) }
        setHovered(findHovered(mx, my))
      }
      schedDraw()
    }
    const onMouseUp = (e: MouseEvent) => {
      const moved = Math.hypot(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY)
      dragRef.current.active = false
      if (moved < 5) {
        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left, my = e.clientY - rect.top
        if (stateRef.current.zoom < 3.5) {
          const hr = findHoveredReg(mx, my)
          if (hr) {
            setManualExpanded(prev => {
              const next = new Set(prev)
              if (next.has(hr.name)) next.delete(hr.name); else next.add(hr.name)
              return next
            })
            return
          }
        }
        setSelected(findHovered(mx, my))
      }
    }
    const onMouseLeave = () => {
      dragRef.current.active = false; setHovered(null)
      if (hoveredRegRef.current !== null) { hoveredRegRef.current = null; setHoveredReg(null); schedDraw() }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 0.89
      const rect   = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const wx = mx - stateRef.current.W / 2 - stateRef.current.offsetX
      const wy = my - stateRef.current.H / 2 - stateRef.current.offsetY
      stateRef.current.zoom    = Math.max(0.15, Math.min(30, stateRef.current.zoom * factor))
      stateRef.current.offsetX = mx - stateRef.current.W / 2 - wx * factor
      stateRef.current.offsetY = my - stateRef.current.H / 2 - wy * factor
      schedDraw()
    }

    canvas.addEventListener('mousedown',  onMouseDown)
    canvas.addEventListener('mousemove',  onMouseMove)
    canvas.addEventListener('mouseup',    onMouseUp)
    canvas.addEventListener('mouseleave', onMouseLeave)
    canvas.addEventListener('wheel',      onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('mousedown',  onMouseDown)
      canvas.removeEventListener('mousemove',  onMouseMove)
      canvas.removeEventListener('mouseup',    onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('wheel',      onWheel)
    }
  }, [findHovered, findHoveredReg, schedDraw, setManualExpanded])

  useEffect(() => {
    const wrap = wrapRef.current; if (!wrap) return
    const ro = new ResizeObserver(resize)
    ro.observe(wrap); resize()
    return () => ro.disconnect()
  }, [resize])

  useEffect(() => {
    schedDraw()
  }, [selected, hovered, colorBySec, loaded, jumpBridges, searchResult, route, manualExpanded, schedDraw])

  // ── Navigation helpers ──────────────────────────────────────────────────
  const jumpToSystem = useCallback((sys: System, targetZoom?: number) => {
    const { W, H } = stateRef.current
    const span = Math.min(W, H) * 0.75
    if (targetZoom !== undefined) stateRef.current.zoom = targetZoom
    const z = stateRef.current.zoom
    stateRef.current.offsetX = -(sys.x * span * z)
    stateRef.current.offsetY =  (sys.z * span * z)
    setSelected(sys)
    schedDraw()
  }, [schedDraw])

  // Fit viewport to show all route systems with padding
  const fitToRoute = useCallback((ids: number[]) => {
    const systems = ids.map(id => sysMap.get(id)).filter(Boolean) as System[]
    if (systems.length === 0) return
    const { W, H } = stateRef.current
    const span = Math.min(W, H) * 0.75
    if (systems.length === 1) {
      // Single system — just jump to it
      const s = systems[0]
      stateRef.current.zoom    = 10.5
      stateRef.current.offsetX = -(s.x * span * 10.5)
      stateRef.current.offsetY =  (s.z * span * 10.5)
      schedDraw(); return
    }
    const xs = systems.map(s => s.x)
    const zs = systems.map(s => s.z)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    const rangeX = maxX - minX || MIN_D * 4
    const rangeZ = maxZ - minZ || MIN_D * 4
    // Compute zoom that fits the bounding box with 20% padding
    const PAD   = 1.4   // divide by this to get 30% breathing room on each side
    const zoomX = (W / span) / (rangeX * PAD)
    const zoomZ = (H / span) / (rangeZ * PAD)
    const newZoom = Math.max(1.5, Math.min(12, Math.min(zoomX, zoomZ)))
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    stateRef.current.zoom    = newZoom
    stateRef.current.offsetX = -(cx * span * newZoom)
    stateRef.current.offsetY =  (cz * span * newZoom)
    schedDraw()
  }, [schedDraw])

  const didInitRef = useRef(false)
  useEffect(() => {
    if (!loaded || didInitRef.current) return
    const raf = requestAnimationFrame(() => {
      const { W, H } = stateRef.current
      if (W === 0 || H === 0) return
      didInitRef.current = true
      const sys = SYSTEMS.find(s => s.id === currentSysId)
      if (sys) jumpToSystem(sys, 10.5)
    })
    return () => cancelAnimationFrame(raf)
  }, [loaded, currentSysId, jumpToSystem])

  const resetView = () => {
    stateRef.current.zoom = 0.3
    stateRef.current.offsetX = 0; stateRef.current.offsetY = 0
    schedDraw()
  }

  const handleSearch = (q: string) => {
    setSearch(q)
    if (!q.trim()) { setSearchResult(null); return }
    const match = SYSTEMS.find(s => s.name.toLowerCase().includes(q.toLowerCase()))
    if (match) { setSearchResult(match); jumpToSystem(match, 10.5) }
  }

  const addAvoidSystem = (input: string) => {
    const match = SYSTEMS.find(s => s.name.toLowerCase() === input.trim().toLowerCase())
    if (match && !routeAvoid.find(s => s.id === match.id)) setRouteAvoid(prev => [...prev, match])
    setRouteAvoidInput('')
  }

  const calculateRoute = async () => {
    const fromSys = SYSTEMS.find(s => s.name.toLowerCase() === routeFrom.trim().toLowerCase())
    const toSys   = SYSTEMS.find(s => s.name.toLowerCase() === routeTo.trim().toLowerCase())
    if (!fromSys) { setRouteError('Unknown origin system'); return }
    if (!toSys)   { setRouteError('Unknown destination system'); return }
    setRouteLoading(true); setRouteError(null); setRoute([])
    try {
      let ids: number[]

      if (useJumpBridges) {
        // Client-side Dijkstra — guaranteed to honour custom bridges
        const result = clientRoute(
          fromSys.id, toSys.id, routeFlag,
          routeAvoid.map(s => s.id),
          bridgesRef.current
        )
        if (!result) { setRouteError('No route found'); return }
        ids = result
      } else {
        // ESI route — no custom connections needed
        const r = await fetch('/api/eve/route', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: fromSys.id, destination: toSys.id,
            flag: routeFlag, avoid: routeAvoid.map(s => s.id), connections: [] }),
        })
        const data = await r.json()
        if (!r.ok || data.error) { setRouteError(data.error ?? 'No route found'); return }
        ids = data as number[]
      }

      setRoute(ids)
      if (ids.length >= 1) fitToRoute(ids)
    } catch { setRouteError('Route calculation failed') }
    finally  { setRouteLoading(false) }
  }

  const currentSys = SYSTEMS.find(s => s.id === currentSysId)
  const jumpCount  = SYSTEMS.reduce((a, s) => a + s.conns.length, 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full font-mono text-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-eve-border bg-eve-panel shrink-0 flex-wrap gap-y-1">
        <span className="text-eve-cyan text-[10px] uppercase tracking-widest">Star Map</span>
        <span className="text-eve-dim">·</span>
        <span className="text-eve-muted text-[9px]">Systems <span className="text-eve-text">{SYSTEMS.length || '—'}</span></span>
        <span className="text-eve-dim">·</span>
        <span className="text-eve-muted text-[9px]">Connections <span className="text-eve-text">{jumpCount || '—'}</span></span>
        <span className="text-eve-dim">·</span>
        <span className="text-eve-muted text-[9px]">Regions <span className="text-eve-text">{REGIONS.length || '—'}</span></span>
        {route.length > 0 && (() => {
          let totalLY = 0
          for (let i = 1; i < route.length; i++) {
            const a = sysMap.get(route[i - 1]), b = sysMap.get(route[i])
            if (a && b) totalLY += Math.hypot(b.x - a.x, b.z - a.z) * LY_PER_UNIT
          }
          const fmt = (ly: number) => ly >= 10 ? `${ly.toFixed(1)} LY` : `${ly.toFixed(2)} LY`
          const routeLyStr  = LY_PER_UNIT > 0 ? fmt(totalLY) : null
          // Direct cyno jump distance — straight line origin → destination
          const orig = sysMap.get(route[0]), dest = sysMap.get(route[route.length - 1])
          const directLY = (LY_PER_UNIT > 0 && orig && dest)
            ? Math.hypot(dest.x - orig.x, dest.z - orig.z) * LY_PER_UNIT
            : null
          const directLyStr = directLY !== null ? fmt(directLY) : null
          return (
            <>
              <span className="text-eve-dim">·</span>
              <span className="text-eve-cyan text-[10px] font-semibold tracking-wide">
                {route.length - 1} jumps
                {routeLyStr  && <span className="text-eve-gold"> · {routeLyStr}</span>}
                {directLyStr && (
                  <span className="text-eve-muted font-normal"> · <span className="text-[9px]" title="Direct cyno jump distance">{directLyStr} direct</span></span>
                )}
              </span>
            </>
          )
        })()}
        {bridgesRef.current.length > 0 && (
          <>
            <span className="text-eve-dim">·</span>
            <span className="text-[9px]" style={{ color: 'rgba(255,140,40,0.9)' }}>
              {bridgesRef.current.length} Jump Bridge{bridgesRef.current.length !== 1 ? 's' : ''}
            </span>
          </>
        )}
        <div className="ml-auto flex gap-2">
          {manualExpanded.size > 0 && !(REGIONS.length > 0 && REGIONS.every(r => manualExpanded.has(r.name))) && (
            <button onClick={() => setManualExpanded(new Set())}
              className="px-2 py-1 border border-eve-gold/40 text-eve-gold text-[9px] uppercase tracking-wider hover:bg-eve-gold/10 transition-all">
              Collapse ({manualExpanded.size})
            </button>
          )}
          <button
            onClick={() => {
              const allExpanded = REGIONS.length > 0 && REGIONS.every(r => manualExpanded.has(r.name))
              setManualExpanded(allExpanded ? new Set() : new Set(REGIONS.map(r => r.name)))
            }}
            className={`px-2 py-1 border text-[9px] uppercase tracking-wider transition-all ${
              REGIONS.length > 0 && REGIONS.every(r => manualExpanded.has(r.name))
                ? 'border-eve-cyan/60 text-eve-cyan bg-eve-cyan/10'
                : 'border-eve-border text-eve-muted hover:border-eve-cyan hover:text-eve-cyan'
            }`}
          >
            {REGIONS.length > 0 && REGIONS.every(r => manualExpanded.has(r.name)) ? 'Compress' : 'Explode'}
          </button>
          <button onClick={() => setColorBySec(v => !v)}
            className={`px-2 py-1 border text-[9px] uppercase tracking-wider transition-all ${colorBySec ? 'border-eve-gold/50 text-eve-gold bg-eve-gold/5' : 'border-eve-border text-eve-muted'}`}>
            Sec Color
          </button>
          <button onClick={resetView}
            className="px-2 py-1 border border-eve-border text-eve-muted text-[9px] uppercase tracking-wider hover:border-eve-cyan hover:text-eve-cyan transition-all">
            Reset
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div ref={wrapRef} className="relative flex-1 overflow-hidden select-none" style={{ cursor: 'crosshair' }}>
          <div className="absolute top-1 left-1 w-3 h-3 border-t border-l border-eve-cyan/30 pointer-events-none" />
          <div className="absolute top-1 right-1 w-3 h-3 border-t border-r border-eve-cyan/30 pointer-events-none" />
          <div className="absolute bottom-1 left-1 w-3 h-3 border-b border-l border-eve-cyan/30 pointer-events-none" />
          <div className="absolute bottom-1 right-1 w-3 h-3 border-b border-r border-eve-cyan/30 pointer-events-none" />
          <canvas ref={canvasRef} className="block w-full h-full" />

          {/* Region hover tooltip */}
          {hoveredReg && (
            <div className="absolute pointer-events-none bg-eve-panel border border-eve-border px-2 py-1.5 text-[10px] min-w-[160px] shadow-md" style={{ left: 20, bottom: 36 }}>
              <div className="text-eve-gold mb-1 text-[9px] uppercase tracking-wider">Region</div>
              <div className="text-eve-cyan mb-1">{hoveredReg.name}</div>
              <div className="text-eve-muted">Avg Sec: <span style={{ color: secColorHex(hoveredReg.sec) }}>{secLabel(hoveredReg.sec)}</span></div>
              <div className="text-eve-muted">Systems: <span className="text-eve-text">{hoveredReg.systems.length}</span></div>
              <div className="text-eve-dim text-[8px] mt-1">Click to expand</div>
            </div>
          )}
          {/* System hover tooltip */}
          {!hoveredReg && hovered && (
            <div className="absolute pointer-events-none bg-eve-panel border border-eve-border px-2 py-1.5 text-[10px] min-w-[140px] shadow-md" style={{ left: 20, bottom: 36 }}>
              <div className="text-eve-cyan mb-1">{hovered.name}</div>
              <div className="text-eve-muted">Region: <span className="text-eve-text">{hovered.region}</span></div>
              <div className="text-eve-muted">Security: <span style={{ color: secColorHex(hovered.sec) }}>{secLabel(hovered.sec)}</span></div>
              <div className="text-eve-muted">Connections: <span className="text-eve-text">{hovered.conns.length}</span></div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-60 border-l border-eve-border bg-eve-panel flex flex-col shrink-0 overflow-y-auto overflow-x-hidden">

          {/* Search */}
          <div className="p-2 border-b border-eve-border shrink-0">
            <SystemInput value={search} onChange={handleSearch} onSelect={s => handleSearch(s.name)}
              placeholder="Search system..." wrapperClass="w-full"
              inputClass="w-full bg-eve-black border border-eve-border text-eve-text text-[10px] px-2 py-1.5 outline-none focus:border-eve-cyan placeholder:text-eve-dim font-mono" />
          </div>

          {/* Selected / Location */}
          <div className="p-3 border-b border-eve-border shrink-0">
            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[8px] uppercase tracking-widest text-eve-dim mb-1">Selected</div>
                {selected ? (
                  <>
                    <div className="text-eve-text text-[9px] truncate">{selected.name}</div>
                    <div className="text-eve-muted text-[8px] truncate">{selected.region}</div>
                    <div className="text-[8px]" style={{ color: secColorHex(selected.sec) }}>
                      {secLabel(selected.sec)} · {selected.conns.length}J
                    </div>
                  </>
                ) : <div className="text-eve-dim text-[9px]">Click a system</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[8px] uppercase tracking-widest text-eve-dim mb-1">Location</div>
                {currentSys ? (
                  <>
                    <div className="text-eve-cyan text-[9px] truncate cursor-pointer hover:underline"
                         onClick={() => jumpToSystem(currentSys, 10.5)}>{currentSys.name}</div>
                    <div className="text-eve-muted text-[8px] truncate">{currentSys.region}</div>
                    <div className="text-[8px]" style={{ color: secColorHex(currentSys.sec) }}>{secLabel(currentSys.sec)}</div>
                  </>
                ) : <div className="text-eve-dim text-[9px]">{loaded ? 'Unknown' : 'Loading...'}</div>}
              </div>
            </div>
          </div>

          {/* Route Calculator */}
          <div className="p-3 border-b border-eve-border shrink-0">
            <div className="text-[8px] uppercase tracking-widest text-eve-dim mb-2">Route Calculator</div>
            <div className="space-y-1.5 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] text-eve-dim w-5 shrink-0">FROM</span>
                <SystemInput value={routeFrom} onChange={setRouteFrom} onSelect={s => setRouteFrom(s.name)}
                  placeholder={currentSys?.name ?? 'Origin…'} wrapperClass="flex-1"
                  inputClass="w-full bg-eve-black border border-eve-border text-eve-text text-[9px] px-1.5 py-1 outline-none focus:border-eve-cyan placeholder:text-eve-dim font-mono"
                  rightSlot={currentSys && !routeFrom ? (
                    <button onMouseDown={() => setRouteFrom(currentSys.name)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-[7px] text-eve-cyan hover:text-white"
                      title="Use current location">HERE</button>
                  ) : undefined} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] text-eve-dim w-5 shrink-0">TO</span>
                <SystemInput value={routeTo} onChange={setRouteTo} onSelect={s => setRouteTo(s.name)}
                  onEnter={calculateRoute} placeholder="Destination…" wrapperClass="flex-1"
                  inputClass="w-full bg-eve-black border border-eve-border text-eve-text text-[9px] px-1.5 py-1 outline-none focus:border-eve-cyan placeholder:text-eve-dim font-mono" />
              </div>
            </div>

            <div className="flex gap-1 mb-2">
              {(['shortest', 'secure', 'insecure'] as const).map(f => (
                <button key={f} onClick={() => setRouteFlag(f)}
                  className={`flex-1 py-1 text-[8px] uppercase tracking-wider border transition-all ${
                    routeFlag === f
                      ? f === 'shortest' ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10'
                      : f === 'secure'   ? 'border-green-500 text-green-400 bg-green-500/10'
                      :                    'border-red-500 text-red-400 bg-red-500/10'
                      : 'border-eve-border text-eve-dim hover:border-eve-muted'
                  }`}>
                  {f === 'shortest' ? 'Short' : f === 'secure' ? 'Safe' : 'Risky'}
                </button>
              ))}
            </div>

            <div className="mb-2">
              <div className="text-[8px] text-eve-dim mb-1">Avoid systems</div>
              <SystemInput value={routeAvoidInput} onChange={setRouteAvoidInput}
                onSelect={s => addAvoidSystem(s.name)} onEnter={() => addAvoidSystem(routeAvoidInput)}
                placeholder="System name + Enter" wrapperClass="w-full"
                inputClass="w-full bg-eve-black border border-eve-border text-eve-text text-[9px] px-1.5 py-1 outline-none focus:border-eve-gold placeholder:text-eve-dim font-mono" />
              {routeAvoid.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {routeAvoid.map(s => (
                    <span key={s.id} className="flex items-center gap-0.5 bg-eve-border/30 text-eve-muted text-[8px] px-1.5 py-0.5">
                      {s.name}
                      <button onClick={() => setRouteAvoid(prev => prev.filter(x => x.id !== s.id))}
                        className="text-eve-dim hover:text-eve-red ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {bridgesRef.current.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setUseJumpBridges(v => { localStorage.setItem('aurora_map_use_bridges', String(!v)); return !v })}
                  className={`w-7 h-3.5 rounded-full transition-all relative shrink-0 ${useJumpBridges ? 'bg-eve-cyan/60' : 'bg-eve-border'}`}>
                  <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${useJumpBridges ? 'left-4' : 'left-0.5'}`} />
                </button>
                <span className="text-[8px] text-eve-muted">Use jump bridges ({bridgesRef.current.length})</span>
              </div>
            )}

            <button onClick={calculateRoute} disabled={routeLoading || !routeTo.trim()}
              className="w-full py-1.5 text-[9px] uppercase tracking-widest border border-eve-cyan text-eve-cyan bg-eve-cyan/5 hover:bg-eve-cyan/15 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {routeLoading ? 'Calculating…' : 'Calculate Route'}
            </button>

            {routeError && <div className="mt-1.5 text-[8px] text-red-400">{routeError}</div>}

            {route.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[8px] text-eve-dim"><span className="text-eve-text">{route.length - 1}</span> jumps</span>
                  <button onClick={() => setRoute([])} className="text-[8px] text-eve-dim hover:text-eve-red">Clear</button>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-px">
                  {route.map((id, i) => {
                    const s = sysMap.get(id); if (!s) return null
                    return (
                      <div key={id} onClick={() => jumpToSystem(s, 10.5)}
                        className="flex items-center gap-1.5 px-1.5 py-0.5 hover:bg-eve-border/20 cursor-pointer group">
                        <span className="text-[7px] text-eve-dim w-4 text-right shrink-0">{i}</span>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: secColor(s.sec) }} />
                        <span className="text-[9px] text-eve-text truncate group-hover:text-eve-cyan">{s.name}</span>
                        <span className="text-[7px] text-eve-dim ml-auto shrink-0">{secLabel(s.sec)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Custom Jump Bridges */}
          <div className="p-3 border-b border-eve-border shrink-0">
            <div className="text-[8px] uppercase tracking-widest text-eve-dim mb-2">Custom Jump Bridges</div>

            <div className="space-y-1.5 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] text-eve-dim w-5 shrink-0">FROM</span>
                <SystemInput value={cbFrom} onChange={setCbFrom} onSelect={s => { setCbFrom(s.name); setCbError(null) }}
                  onEnter={addCustomBridge} placeholder="System…" wrapperClass="flex-1"
                  inputClass="w-full bg-eve-black border border-eve-border text-eve-text text-[9px] px-1.5 py-1 outline-none focus:border-eve-gold placeholder:text-eve-dim font-mono" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] text-eve-dim w-5 shrink-0">TO</span>
                <SystemInput value={cbTo} onChange={setCbTo} onSelect={s => { setCbTo(s.name); setCbError(null) }}
                  onEnter={addCustomBridge} placeholder="System…" wrapperClass="flex-1"
                  inputClass="w-full bg-eve-black border border-eve-border text-eve-text text-[9px] px-1.5 py-1 outline-none focus:border-eve-gold placeholder:text-eve-dim font-mono" />
              </div>
            </div>

            <button onClick={addCustomBridge} disabled={!cbFrom.trim() || !cbTo.trim()}
              className="w-full py-1 text-[9px] uppercase tracking-widest border border-eve-gold/50 text-eve-gold bg-eve-gold/5 hover:bg-eve-gold/15 transition-all disabled:opacity-30 disabled:cursor-not-allowed mb-2">
              Add Bridge
            </button>

            {cbError && <div className="text-[8px] text-red-400 mb-1.5">{cbError}</div>}

            {customBridges.length > 0 && (
              <div className="space-y-px">
                {customBridges.map((br, i) => (
                  <div key={i} className="flex items-center gap-1 px-1.5 py-1 bg-eve-border/10 text-[8px]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(255,140,40,0.9)' }} />
                    <span className="text-eve-text truncate flex-1">{br.from}</span>
                    <span className="text-eve-dim mx-0.5">↔</span>
                    <span className="text-eve-text truncate flex-1 text-right">{br.to}</span>
                    <button onClick={() => saveCustomBridges(customBridges.filter((_, j) => j !== i))}
                      className="text-eve-dim hover:text-eve-red ml-1 shrink-0">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Security legend */}
          <div className="p-3 shrink-0">
            <div className="text-[8px] uppercase tracking-widest text-eve-dim mb-2">Security Status</div>
            <div className="mb-1.5 rounded" style={{
              height: 8,
              background: `linear-gradient(to right, rgb(120,20,180), rgb(180,35,145), rgb(200,45,45), rgb(210,100,10), rgb(210,175,10), rgb(155,200,20), rgb(50,190,60), rgb(0,200,150), rgb(0,210,240), rgb(30,144,255), rgb(51,102,204))`,
            }} />
            <div className="flex justify-between text-[8px] text-eve-dim mb-2">
              <span>0.0</span><span>0.5</span><span>1.0</span>
            </div>
            <div className="space-y-1.5 mt-2">
              {([
                { color: 'rgb(0,212,255)',        label: 'Current location' },
                { color: 'rgb(200,168,75)',        label: 'Selected system' },
                { color: 'rgba(255,140,40,0.9)',   label: 'Jump bridge', dashed: true },
                { color: 'rgba(255,255,255,0.85)', label: 'Route', dashed: true },
              ] as { color: string; label: string; dashed?: boolean }[]).map(({ color, label, dashed }) => (
                <div key={label} className="flex items-center gap-2 text-[9px] text-eve-muted">
                  {dashed
                    ? <div className="w-4 shrink-0 border-t" style={{ borderColor: color }} />
                    : <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto p-3 border-t border-eve-border shrink-0">
            <div className="text-[8px] text-eve-muted leading-relaxed">
              Scroll to zoom · Drag to pan · Click to select
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

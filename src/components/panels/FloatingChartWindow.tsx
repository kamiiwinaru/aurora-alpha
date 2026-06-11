import { useRef, useState, useEffect, useCallback } from 'react'
import { X, GripHorizontal, Minus } from 'lucide-react'
import AppraisalChart from './AppraisalChart'

interface AppraisalItem {
  name: string
  typeId: number | null
}

interface Props {
  items: AppraisalItem[]
  market: string
  onClose: () => void
}

const MIN_W = 340
const MIN_H = 260
const DEFAULT_W = 520
const DEFAULT_H = 380

export default function FloatingChartWindow({ items, market, onClose }: Props) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, window.innerWidth / 2 - DEFAULT_W / 2),
    y: Math.max(0, window.innerHeight / 2 - DEFAULT_H / 2 - 40),
  }))
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [minimised, setMinimised] = useState(false)

  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const resizing = useRef(false)
  const resizeStart = useRef({ mx: 0, my: 0, w: 0, h: 0 })

  // ── Drag ────────────────────────────────────────────────
  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // don't drag when clicking buttons
    dragging.current = true
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.preventDefault()
  }, [pos])

  // ── Resize ──────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    resizing.current = true
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h }
    e.preventDefault()
    e.stopPropagation()
  }, [size])

  // ── Global mouse handlers ────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        setPos({
          x: Math.max(0, Math.min(window.innerWidth - size.w, e.clientX - dragOffset.current.x)),
          y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.current.y)),
        })
      }
      if (resizing.current) {
        const dx = e.clientX - resizeStart.current.mx
        const dy = e.clientY - resizeStart.current.my
        setSize({
          w: Math.max(MIN_W, resizeStart.current.w + dx),
          h: Math.max(MIN_H, resizeStart.current.h + dy),
        })
      }
    }
    const onUp = () => {
      dragging.current = false
      resizing.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [size.w])

  return (
    <div
      className="fixed z-50 flex flex-col eve-panel border border-eve-border shadow-2xl shadow-black/60"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimised ? 'auto' : size.h,
        minWidth: MIN_W,
        minHeight: minimised ? 'auto' : MIN_H,
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-eve-border bg-eve-black/60 cursor-grab active:cursor-grabbing flex-shrink-0 select-none"
        onMouseDown={onTitleMouseDown}
      >
        <GripHorizontal size={11} className="text-eve-dim flex-shrink-0" />
        <span className="eve-header mb-0 flex-1 text-[10px]">PRICE HISTORY</span>
        <button
          onClick={() => setMinimised(v => !v)}
          className="eve-btn p-0.5 text-eve-muted hover:text-eve-text"
          title={minimised ? 'Restore' : 'Minimise'}
        >
          <Minus size={10} />
        </button>
        <button
          onClick={onClose}
          className="eve-btn p-0.5 text-eve-muted hover:text-eve-red"
          title="Close"
        >
          <X size={10} />
        </button>
      </div>

      {/* Chart body */}
      {!minimised && (
        <div className="flex-1 overflow-hidden p-2 min-h-0">
          <AppraisalChart items={items} market={market} height={size.h - 80} />
        </div>
      )}

      {/* Resize handle */}
      {!minimised && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end pb-0.5 pr-0.5"
          onMouseDown={onResizeMouseDown}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-eve-dim opacity-50">
            <path d="M8 0 L8 8 L0 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4 L4 8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </div>
      )}
    </div>
  )
}

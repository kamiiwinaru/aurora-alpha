import { useEffect, useState, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { RefreshCw } from 'lucide-react'
import { formatISK } from '../../lib/eve-esi'

interface AppraisalItem {
  name: string
  typeId: number | null
}

interface HistoryEntry {
  date: string
  average: number
  highest: number
  lowest: number
  volume: number
}

interface ChartPoint {
  date: string
  [itemName: string]: number | string
}

const LINE_COLORS = [
  '#00d4ff', '#ffd700', '#ff6b35', '#7fff00', '#ff69b4',
  '#9370db', '#00ced1', '#ff4500', '#adff2f', '#da70d6',
]

const DAY_OPTIONS = [1, 7, 14, 30]

interface Props {
  items: AppraisalItem[]
  market: string
  height?: number
}

export default function AppraisalChart({ items, market, height = 280 }: Props) {
  const [days, setDays] = useState(14)
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({})
  const [loading, setLoading] = useState(false)
  const [priceMode, setPriceMode] = useState<'average' | 'highest' | 'lowest'>('average')

  const validItems = items.filter(i => i.typeId !== null)

  const fetchHistory = useCallback(async () => {
    if (!validItems.length) return
    setLoading(true)
    try {
      const results = await Promise.all(
        validItems.map(async item => {
          const res = await fetch(`/api/market/history?typeId=${item.typeId}&market=${encodeURIComponent(market)}`)
          const data: HistoryEntry[] = await res.json()
          return { name: item.name, data }
        })
      )
      const map: Record<string, HistoryEntry[]> = {}
      for (const r of results) map[r.name] = r.data
      setHistory(map)
    } finally {
      setLoading(false)
    }
  }, [validItems.map(i => i.typeId).join(','), market])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  if (!validItems.length) return null

  // Build unified date-keyed chart data
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const dateSet = new Set<string>()
  for (const entries of Object.values(history)) {
    for (const e of entries) {
      if (e.date >= cutoffStr) dateSet.add(e.date)
    }
  }
  const sortedDates = Array.from(dateSet).sort()

  const chartData: ChartPoint[] = sortedDates.map(date => {
    const point: ChartPoint = { date: date.slice(5) } // MM-DD
    for (const [name, entries] of Object.entries(history)) {
      const entry = entries.find(e => e.date === date)
      if (entry) point[name] = entry[priceMode]
    }
    return point
  })

  const hasData = chartData.length > 0

  return (
    <div className="eve-panel p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="eve-header">PRICE HISTORY</div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Price mode */}
          <div className="flex border border-eve-border">
            {(['average', 'highest', 'lowest'] as const).map(m => (
              <button
                key={m}
                onClick={() => setPriceMode(m)}
                className={`px-2 py-0.5 text-[9px] uppercase tracking-widest transition-colors
                  ${priceMode === m ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
              >
                {m}
              </button>
            ))}
          </div>
          {/* Day range */}
          <div className="flex border border-eve-border">
            {DAY_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-0.5 text-[9px] uppercase tracking-widest transition-colors
                  ${days === d ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
              >
                {d}D
              </button>
            ))}
          </div>
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="eve-btn p-1 disabled:opacity-40"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !hasData && (
        <div className="flex items-center justify-center py-8 text-eve-muted text-xs gap-2">
          <RefreshCw size={12} className="animate-spin" />LOADING HISTORY...
        </div>
      )}

      {!loading && !hasData && (
        <div className="flex items-center justify-center py-8 text-eve-dim text-xs">
          NO HISTORY DATA FOR SELECTED RANGE
        </div>
      )}

      {hasData && (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#666', fontSize: 9, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={v => formatISK(v as number)}
              tick={{ fill: '#666', fontSize: 9, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              contentStyle={{
                background: '#0a0e14',
                border: '1px solid rgba(0,212,255,0.2)',
                borderRadius: 0,
                fontSize: 11,
                fontFamily: 'monospace',
              }}
              labelStyle={{ color: '#00d4ff', marginBottom: 4 }}
              itemStyle={{ color: '#aaa' }}
              formatter={(value: number, name: string) => [formatISK(value) + ' ISK', name]}
            />
            <Legend
              wrapperStyle={{ fontSize: 10, fontFamily: 'monospace', paddingTop: 8 }}
              iconType="line"
            />
            {validItems.map((item, i) => {
              const color = LINE_COLORS[i % LINE_COLORS.length]
              return (
                <Line
                  key={item.name}
                  type="monotone"
                  dataKey={item.name}
                  stroke={color}
                  strokeWidth={1.5}
                  dot={{ r: 3, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: color, strokeWidth: 0 }}
                  connectNulls
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'

interface UsageData {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  calls: number
  estimatedCostUsd: number
  startedAt: string
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function UsageBar() {
  const [usage, setUsage] = useState<UsageData | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/usage')
        if (res.ok) setUsage(await res.json())
      } catch { /* server not ready */ }
    }
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [])

  if (!usage) return null

  const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens
  const cost = usage.estimatedCostUsd

  return (
    <div className="shrink-0 border-t border-eve-border bg-eve-black/80 px-4 py-1 flex items-center gap-4 text-[9px] font-mono text-eve-dim select-none">
      <span className="text-eve-muted tracking-widest uppercase">API</span>

      <span className="flex items-center gap-1">
        <span className="text-eve-dim">CALLS</span>
        <span className="text-eve-text">{usage.calls}</span>
      </span>

      <span className="flex items-center gap-1">
        <span className="text-eve-dim">TOK</span>
        <span className="text-eve-text">{fmt(totalTokens)}</span>
        {usage.cacheReadTokens > 0 && (
          <span className="text-eve-cyan/60">({fmt(usage.cacheReadTokens)} cached)</span>
        )}
      </span>

      <span className="flex items-center gap-1">
        <span className="text-eve-dim">SESSION COST</span>
        <span className={cost > 0.10 ? 'text-eve-gold' : 'text-eve-green'}>
          ${cost < 0.001 ? cost.toFixed(5) : cost.toFixed(4)}
        </span>
      </span>

      <span className="ml-auto text-eve-dim/50">
        since {new Date(usage.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

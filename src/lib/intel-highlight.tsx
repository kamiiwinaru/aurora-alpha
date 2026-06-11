import React from 'react'
import { EVE_SHIP_NAMES } from './eve-ships'

// ── Regexes ────────────────────────────────────────────────────────────────────

// Matches null-sec style system names: G-7WUF, HY-RWO, X-7OMU-B, 4-CM8I, etc.
export const SYSTEM_RE = /\b([A-Z0-9][A-Z0-9]*-[A-Z0-9][-A-Z0-9]*)\b/g

export const CLEAR_RE   = /\b(clr|clear|safe|gone|docked|empty)\b/gi
export const HOSTILE_RE = /\b(neut|neutral|hostile|cyno|bubble|bubbles|camp|gatecamp|tackle|pointed|fleet|gang|blob)\b/gi

// 1–3 consecutive Title-Case words (each 3+ chars, digits ok) — likely EVE character names
export const CHAR_NAME_RE = /\b([A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]{2,}){0,2})\b/g

// Lowercase-starting names that contain at least one digit — digit presence rules out common words
export const CHAR_NAME_LOWER_RE = /\b([a-z][a-zA-Z0-9]*\d[a-zA-Z0-9]*)\b/g

// URLs — matched first so they aren't partially consumed by other patterns
export const URL_RE = /https?:\/\/[^\s<>"]+/g

// Words/phrases that match CHAR_NAME_RE but are not character names
export const CHAR_STOPWORDS = new Set([
  'The', 'And', 'But', 'For', 'With', 'From', 'Into', 'Not', 'All', 'Any',
  'Still', 'Moving', 'Jumped', 'Jump', 'North', 'South', 'East', 'West',
  'ESS', 'NPC', 'PVP', 'PVE', 'SRP', 'POS', 'POCOs', 'Poco',
  'Proteus', 'Legion', 'Tengu', 'Loki', 'Sabre', 'Broadsword', 'Vagabond',
  'Rapier', 'Huginn', 'Falcon', 'Arazu', 'Lachesis', 'Curse', 'Pilgrim',
  'Cynabal', 'Stabber', 'Rifter', 'Taranis', 'Stiletto', 'Malediction',
  'Interceptor', 'Interdictor', 'Recon', 'Stratios', 'Astero', 'Buzzard',
  'Helios', 'Cheetah', 'Anathema', 'Manticore', 'Nemesis', 'Purifier',
  'Stealth', 'Bomber', 'Rook', 'Ares', 'Crow',
])

// ── Span builder ───────────────────────────────────────────────────────────────

export type SpanType = 'system' | 'clear' | 'hostile' | 'character' | 'url'
export type Span = { start: number; end: number; type: SpanType; value: string }

export function buildSpans(msg: string, knownNames: string[] = []): Span[] {
  const spans: Span[] = []
  let m: RegExpExecArray | null

  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(msg)) !== null)
    spans.push({ start: m.index, end: m.index + m[0].length, type: 'url', value: m[0] })

  SYSTEM_RE.lastIndex = 0
  while ((m = SYSTEM_RE.exec(msg)) !== null)
    spans.push({ start: m.index, end: m.index + m[0].length, type: 'system', value: m[1] })

  for (const { re, type } of [
    { re: CLEAR_RE,   type: 'clear'   as const },
    { re: HOSTILE_RE, type: 'hostile' as const },
  ]) {
    re.lastIndex = 0
    while ((m = re.exec(msg)) !== null)
      spans.push({ start: m.index, end: m.index + m[0].length, type, value: m[0] })
  }

  CHAR_NAME_RE.lastIndex = 0
  while ((m = CHAR_NAME_RE.exec(msg)) !== null) {
    const name = m[1]
    const words = name.split(' ')
    if (CHAR_STOPWORDS.has(name) || CHAR_STOPWORDS.has(words[0])) continue
    if (words.some(w => EVE_SHIP_NAMES.has(w))) continue
    spans.push({ start: m.index, end: m.index + m[0].length, type: 'character', value: name })
  }

  CHAR_NAME_LOWER_RE.lastIndex = 0
  while ((m = CHAR_NAME_LOWER_RE.exec(msg)) !== null)
    spans.push({ start: m.index, end: m.index + m[0].length, type: 'character', value: m[1] })

  const lower = msg.toLowerCase()
  const sorted = [...knownNames].filter(n => n.length >= 4).sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    const nl = name.toLowerCase()
    let idx = lower.indexOf(nl)
    while (idx !== -1) {
      spans.push({ start: idx, end: idx + name.length, type: 'character', value: name })
      idx = lower.indexOf(nl, idx + 1)
    }
  }

  spans.sort((a, b) => a.start - b.start)
  const deduped: Span[] = []
  let cursor = 0
  for (const s of spans) {
    if (s.start < cursor) continue
    deduped.push(s)
    cursor = s.end
  }
  return deduped
}

// ── Renderer ───────────────────────────────────────────────────────────────────

export function renderMessage(
  msg: string,
  knownNames: string[] = [],
  onZkillLookup?: (query: string, category: 'character' | 'system') => void,
): React.ReactNode {
  const spans = buildSpans(msg, knownNames)
  if (spans.length === 0) return msg

  const nodes: React.ReactNode[] = []
  let pos = 0
  for (const s of spans) {
    if (s.start > pos) nodes.push(msg.slice(pos, s.start))
    const text = msg.slice(s.start, s.end)

    if (s.type === 'url') {
      nodes.push(
        <a key={s.start} href={s.value} target="_blank" rel="noopener noreferrer"
          className="text-eve-cyan/70 hover:text-eve-cyan underline break-all cursor-pointer">
          {text}
        </a>
      )
    } else if (s.type === 'system' && onZkillLookup) {
      nodes.push(
        <button key={s.start} onClick={() => onZkillLookup(s.value, 'system')}
          className="text-eve-cyan font-semibold hover:underline hover:text-eve-cyan/80 cursor-pointer">
          {text}
        </button>
      )
    } else if (s.type === 'character' && onZkillLookup) {
      nodes.push(
        <button key={s.start} onClick={() => onZkillLookup(s.value, 'character')}
          className="text-eve-gold font-semibold hover:underline hover:text-eve-gold/80 cursor-pointer">
          {text}
        </button>
      )
    } else {
      const cls =
        s.type === 'system'    ? 'text-eve-cyan font-semibold' :
        s.type === 'clear'     ? 'text-eve-green font-semibold' :
        s.type === 'character' ? 'text-eve-gold font-semibold' :
                                 'text-eve-red font-semibold'
      nodes.push(<span key={s.start} className={cls}>{text}</span>)
    }
    pos = s.end
  }
  if (pos < msg.length) nodes.push(msg.slice(pos))
  return <>{nodes}</>
}

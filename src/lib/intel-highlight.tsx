import React from 'react'
import { EVE_SHIP_NAMES as _EVE_SHIP_NAMES } from './eve-ships'

// Lowercase version for case-insensitive matching
const EVE_SHIP_NAMES_LC = new Set([..._EVE_SHIP_NAMES].map(s => s.toLowerCase()))
function isShipName(word: string): boolean { return EVE_SHIP_NAMES_LC.has(word.toLowerCase()) }
import { EVE_SYSTEM_NAMES } from './eve-system-names'

// ── Regexes ────────────────────────────────────────────────────────────────────

// Null-sec style names: G-7WUF, HY-RWO, 4-CM8I etc.
// K-space names (Jita, Amarr, …) are matched via EVE_SYSTEM_NAMES set lookup below.
export const SYSTEM_RE = /\b([A-Z0-9][A-Z0-9]*-[A-Z0-9][-A-Z0-9]*)\b/g

export const CLEAR_RE   = /\b(clr|clear|safe|gone|docked|empty)\b/gi
export const HOSTILE_RE = /\b(neut|neutral|hostile|cyno|bubble|bubbles|camp|gatecamp|tackle|pointed|fleet|gang|blob)\b/gi

// Lowercase-starting names that contain at least one digit
export const CHAR_NAME_LOWER_RE = /\b([a-z][a-zA-Z0-9]*\d[a-zA-Z0-9]*)\b/g

// URLs — matched first so they aren't partially consumed by other patterns
export const URL_RE = /https?:\/\/[^\s<>"]+/g

// Words that look like character names but aren't
export const CHAR_STOPWORDS = new Set([
  // Common English
  'The', 'And', 'But', 'For', 'With', 'From', 'Into', 'Not', 'All', 'Any',
  'Still', 'Moving', 'Jumped', 'Jump', 'North', 'South', 'East', 'West',
  'Has', 'Have', 'Had', 'Was', 'Were', 'Are', 'Can', 'Could', 'Would',
  'Just', 'More', 'Some', 'That', 'This', 'When', 'Then', 'They',
  'Out', 'Our', 'Now', 'New', 'Get', 'Got', 'Let', 'Off', 'Too', 'Who',
  'Doing', 'Going', 'Coming', 'Looking', 'Sitting', 'Waiting', 'Running',
  'Need', 'Want', 'Help', 'Back', 'Away', 'Here', 'Safe', 'Dock', 'Gate',
  'Hack', 'Scan', 'Kill', 'Hold', 'Free', 'Good', 'Nice', 'Cool',
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Ten',
  // EVE game terms
  'ESS', 'NPC', 'PVP', 'PVE', 'SRP', 'POS', 'POCOs', 'Poco',
  'Navy', 'Federation', 'Imperial', 'Caldari', 'Gallente', 'Minmatar', 'Amarr',
  'Station', 'Stargate', 'Mission', 'Agent', 'Level', 'Deadspace',
  'Local', 'Intel', 'Fleet', 'Corp', 'Alliance', 'Neutral', 'Hostile',
  'Warp', 'Align', 'Jump', 'Gate', 'Cyno', 'Bridge', 'Titan',
  'Opportunity', 'Bulwark', 'Advantage', 'Damage', 'Control', 'Shield',
  'Armor', 'Structure', 'Module', 'Fitting', 'Slot', 'High', 'Mid', 'Low',
])

// ── Helpers ────────────────────────────────────────────────────────────────────

function isSystemName(word: string): boolean {
  return EVE_SYSTEM_NAMES.has(word.toLowerCase())
}

// A word that should break a character-name sequence
function isBlockingWord(word: string): boolean {
  return CHAR_STOPWORDS.has(word) || isShipName(word) || isSystemName(word)
}

// ── Span builder ───────────────────────────────────────────────────────────────

export type SpanType = 'system' | 'clear' | 'hostile' | 'character' | 'ship' | 'url'
export type Span = { start: number; end: number; type: SpanType; value: string }

// Single Title-Case word (3+ chars)
const TITLE_WORD_RE = /\b([A-Z][a-zA-Z0-9]{2,})\b/g
// Any word (for system/ship lookup)
const WORD_RE = /\b([A-Za-z][A-Za-z0-9'-]*)\b/g

export function buildSpans(msg: string, knownNames: string[] = []): Span[] {
  const spans: Span[] = []
  let m: RegExpExecArray | null

  // 1. URLs
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(msg)) !== null)
    spans.push({ start: m.index, end: m.index + m[0].length, type: 'url', value: m[0] })

  // 2. Null-sec system names (X-Y format)
  SYSTEM_RE.lastIndex = 0
  while ((m = SYSTEM_RE.exec(msg)) !== null)
    spans.push({ start: m.index, end: m.index + m[0].length, type: 'system', value: m[1] })

  // 3. K-space systems and ships — word-by-word lookup
  WORD_RE.lastIndex = 0
  while ((m = WORD_RE.exec(msg)) !== null) {
    if (isSystemName(m[1]))
      spans.push({ start: m.index, end: m.index + m[0].length, type: 'system', value: m[1] })
    else if (isShipName(m[1]))
      spans.push({ start: m.index, end: m.index + m[0].length, type: 'ship', value: m[1] })
  }

  // 4. Clear / hostile keywords
  for (const { re, type } of [
    { re: CLEAR_RE,   type: 'clear'   as const },
    { re: HOSTILE_RE, type: 'hostile' as const },
  ]) {
    re.lastIndex = 0
    while ((m = re.exec(msg)) !== null)
      spans.push({ start: m.index, end: m.index + m[0].length, type, value: m[0] })
  }

  // 5. Character names — sliding window over Title-Case words.
  //    Stops at system/ship/stopword boundaries so "Sebastian Barragan Seil Paladin"
  //    correctly yields "Sebastian Barragan" without swallowing "Seil" or "Paladin".
  const titleWords: Array<{ word: string; start: number; end: number }> = []
  TITLE_WORD_RE.lastIndex = 0
  while ((m = TITLE_WORD_RE.exec(msg)) !== null)
    titleWords.push({ word: m[1], start: m.index, end: m.index + m[0].length })

  let i = 0
  while (i < titleWords.length) {
    const tw = titleWords[i]
    // Skip words that are definitively not character-name starters
    if (isBlockingWord(tw.word)) { i++; continue }

    // Greedily extend up to 3 consecutive Title-Case words, stopping at any blocking word
    const nameWords = [tw]
    let j = i + 1
    while (j < titleWords.length && nameWords.length < 3) {
      const prev = nameWords[nameWords.length - 1]
      const next = titleWords[j]
      // Must be directly adjacent (only whitespace between)
      if (!/^\s+$/.test(msg.slice(prev.end, next.start))) break
      // Stop before any system / ship / stopword
      if (isBlockingWord(next.word)) break
      nameWords.push(next)
      j++
    }

    const start = nameWords[0].start
    const end   = nameWords[nameWords.length - 1].end
    spans.push({ start, end, type: 'character', value: msg.slice(start, end) })
    i = j // advance past all consumed words
  }

  // 6. Lowercase+digit names
  CHAR_NAME_LOWER_RE.lastIndex = 0
  while ((m = CHAR_NAME_LOWER_RE.exec(msg)) !== null) {
    if (isSystemName(m[1])) continue
    spans.push({ start: m.index, end: m.index + m[0].length, type: 'character', value: m[1] })
  }

  // 7. Known sender names from this channel's history
  const lower = msg.toLowerCase()
  const sorted = [...knownNames].filter(n => n.length >= 4).sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    if (isBlockingWord(name)) continue
    const nl = name.toLowerCase()
    let idx = lower.indexOf(nl)
    while (idx !== -1) {
      spans.push({ start: idx, end: idx + name.length, type: 'character', value: name })
      idx = lower.indexOf(nl, idx + 1)
    }
  }

  // De-overlap: sort by position, drop anything that starts inside a prior span
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
    } else if (s.type === 'system') {
      nodes.push(onZkillLookup
        ? <button key={s.start} onClick={() => onZkillLookup(s.value, 'system')}
            className="text-eve-cyan font-semibold hover:underline cursor-pointer">{text}</button>
        : <span key={s.start} className="text-eve-cyan font-semibold">{text}</span>
      )
    } else if (s.type === 'character') {
      nodes.push(onZkillLookup
        ? <button key={s.start} onClick={() => onZkillLookup(s.value, 'character')}
            className="text-eve-gold font-semibold hover:underline cursor-pointer">{text}</button>
        : <span key={s.start} className="text-eve-gold font-semibold">{text}</span>
      )
    } else if (s.type === 'ship') {
      nodes.push(<span key={s.start} className="text-eve-orange font-semibold">{text}</span>)
    } else {
      const cls =
        s.type === 'clear'   ? 'text-eve-green font-semibold' :
                               'text-eve-red font-semibold'
      nodes.push(<span key={s.start} className={cls}>{text}</span>)
    }
    pos = s.end
  }
  if (pos < msg.length) nodes.push(msg.slice(pos))
  return <>{nodes}</>
}

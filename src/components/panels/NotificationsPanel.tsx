import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, Mail, MailOpen, Send, X, ChevronLeft, Loader2, Bell } from 'lucide-react'
import type { EveMail, EveMailLabel, EveNotification, EveCharacter } from '../../types'
import { resolveIds } from '../../lib/eve-esi'

interface NotificationsPanelProps {
  mail: EveMail[]
  mailLabels: EveMailLabel[]
  notifications: EveNotification[]
  loading: boolean
  onRefresh: () => void
  character?: EveCharacter | null
  initialMailId?: number | null
  onInitialMailConsumed?: () => void
}

interface ComposeState {
  to: string
  subject: string
  body: string
  sending: boolean
  error: string | null
}

type Category = 'mail' | 'structures' | 'financial' | 'sovereignty' | 'warfare' | 'kills' | 'goals' | 'applications' | 'clones' | 'standings' | 'contacts' | 'planetary' | 'misc'

const EMPTY_COMPOSE: ComposeState = { to: '', subject: '', body: '', sending: false, error: null }

// ── Notification type categorisation ──────────────────────────────────────
// Evaluated in order — first match wins
const CATEGORIES: Array<{ key: Exclude<Category, 'mail'>; re: RegExp }> = [
  { key: 'structures',   re: /Structure|Tower|Poco|CustomsOffice|Orbital|Starbase|Citadel|EngineeringComplex|Refinery|Upwell|StationService|StationAggression|StationConquer/i },
  { key: 'financial',    re: /Bounty|Bill|Insurance|Market|Tax|Payment|Transaction|Wallet|Isk|OwnershipTransferred/i },
  { key: 'sovereignty',  re: /^Sov|Entosis|InfrastructureHub|^Campaign|TCU|IHub/i },
  { key: 'warfare',      re: /^War|FactionWarfare|^Fw|BattlePunish|Reinforce|Siege|Militia/i },
  { key: 'kills',        re: /KillReport|KillMail/i },
  { key: 'goals',        re: /Goal|Project|Corporation.*Milestone/i },
  { key: 'applications', re: /CorpApp|CharApp|CorpInvite|MemberAdded|MemberRemoved|CorpKick|AllyJoined|CorpJoin|CorpLeave|CorpNewCEO|CorpDividend|AllyContractCancel/i },
  { key: 'clones',       re: /Clone|JumpClone/i },
  { key: 'standings',    re: /Standing|AgentMission|FWChar.*Rank|FWCorp|FWAlliance|NPCStanding|CorpNoLongerWar/i },
  { key: 'contacts',     re: /Contact/i },
  { key: 'planetary',    re: /Orbital|Planet|PI[A-Z]/i },
]

function categoriseNotification(type: string): Category {
  for (const { key, re } of CATEGORIES) {
    if (re.test(type)) return key
  }
  return 'misc'
}

const CATEGORY_LABELS: Record<Category, string> = {
  mail:         'Mail',
  structures:   'Structures',
  financial:    'Financial',
  sovereignty:  'Sovereignty',
  warfare:      'Warfare',
  kills:        'Kills',
  goals:        'Goals',
  applications: 'Applications',
  clones:       'Clones',
  standings:    'Standings',
  contacts:     'Contacts',
  planetary:    'Planetary',
  misc:         'Misc',
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatDate(ts: string) {
  const d = new Date(ts)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').trim()
}

// Windows FILETIME epoch offset (100-ns ticks from 1601-01-01 to 1970-01-01)
const FILETIME_EPOCH = BigInt('116444736000000000')
// FILETIME range: 2000-01-01 to 2100-01-01 (sanity check)
const FILETIME_MIN = BigInt('125911584000000000')
const FILETIME_MAX = BigInt('157766016000000000')

// Resolve YAML anchor/alias notation used in EVE notification text:
//   &id001 12345  →  12345  (anchor stored)
//   *id001        →  12345  (alias replaced)
function resolveYaml(raw: string): string {
  const anchors: Record<string, string> = {}
  let t = raw.replace(/\\n/g, '\n')
  t = t.replace(/&(\w+)\s+(\S+)/g, (_, anchor, value) => { anchors[anchor] = value; return value })
  t = t.replace(/\*(\w+)/g, (full, anchor) => anchors[anchor] ?? full)
  return t
}

// Pretty-print a camelCase YAML key — keeps "ID" as a unit (not "I D")
function prettyKey(k: string): string {
  return k
    .replace(/([A-Z]+)/g, ' $1')   // space before each run of caps: "cloneStationID" → "clone Station ID"
    .replace(/\s+/g, ' ')
    .trim()
}

// Match a bare integer on a YAML list line.
// Handles: "- 500019", "  - 500019", "- - 500019" (nested list markers)
const LIST_INT_RE = /^([ \t]*(?:-[ \t]*)+)(\d{3,12})\s*$/gm
const LIST_INT_LARGE_RE = /^([ \t]*(?:-[ \t]*)+)(\d{13,18})\s*$/gm

// Matches both snake_case "_id:" and camelCase "ID:" field suffixes
const KV_ID_RE = /(?:_id|ID):\s*(\d+)/gi

function collectInts(text: string, min: number, max: number): number[] {
  const ids: number[] = []
  // key: value form — match both _id: and ID:
  const kvRe = new RegExp(KV_ID_RE.source, 'gi')
  let m
  while ((m = kvRe.exec(text)) !== null) {
    const n = Number(m[1])
    if (Number.isSafeInteger(n) && n >= min && n < max) ids.push(n)
  }
  // bare list value form
  const listRe = new RegExp(LIST_INT_RE.source, 'gm')
  while ((m = listRe.exec(text)) !== null) {
    const n = Number(m[2])
    if (Number.isSafeInteger(n) && n >= min && n < max) ids.push(n)
  }
  return [...new Set(ids)]
}

// Extract all ESI-resolvable IDs (500–1e12) from notification text
function extractNotifIds(raw: string): number[] {
  return collectInts(resolveYaml(raw), 500, 1_000_000_000_000)
}

// Extract player structure IDs (>1e12) for auth'd resolution
function extractStructureIds(raw: string): bigint[] {
  const text = resolveYaml(raw)
  const ids: bigint[] = []
  const patterns = [/(?:_id|ID):\s*(\d{13,18})/gi, new RegExp(LIST_INT_LARGE_RE.source, 'gm')]
  for (const re of patterns) {
    let m
    while ((m = re.exec(text)) !== null) {
      const digits = m[2] ?? m[1]
      try {
        const n = BigInt(digits)
        if (n > BigInt(1_000_000_000_000) && n < BigInt('99999999999999999')) ids.push(n)
      } catch { /* skip */ }
    }
  }
  return [...new Set(ids.map(String))].map(s => BigInt(s))
}

// ── Type-specific formatters ───────────────────────────────────────────────

const STANDINGS_RE = /Standing/i

// Standings tuple: [entityId, charId, delta, ignored, ignored, newStanding]
function formatStandingsText(raw: string, names: Record<string, string>): string {
  const text = resolveYaml(raw)
  // Extract all numeric values from list lines (integers and floats, including negatives)
  // Require ≥1 space after each list dash so the minus of a negative value isn't consumed
  const valueRe = /^[ \t]*(?:-[ \t]+)+(-?[\d.]+)\s*$/gm
  const values: string[] = []
  let m
  while ((m = valueRe.exec(text)) !== null) values.push(m[1])
  if (!values.length) return formatNotifText(raw, names) // fallback
  const lines: string[] = []
  for (let i = 0; i + 5 < values.length; i += 6) {
    const [entityRaw, charRaw, deltaRaw, , , standingRaw] = values.slice(i, i + 6)
    const entity = names[entityRaw] ? `${names[entityRaw]} (${entityRaw})` : entityRaw
    const char  = names[charRaw]   ? `${names[charRaw]} (${charRaw})`     : charRaw
    const delta   = parseFloat(deltaRaw)
    const standing = parseFloat(standingRaw)
    if (i > 0) lines.push('')
    lines.push(
      `Entity:   ${entity}`,
      `Character:${char}`,
      `Change:   ${isNaN(delta)    ? deltaRaw    : (delta * 10).toFixed(3)}`,
      `Standing: ${isNaN(standing) ? standingRaw : standing.toFixed(2)}`,
    )
  }
  return lines.join('\n')
}

// Format EVE notification YAML text for display
function formatNotifText(raw: string, names: Record<string, string> = {}, type = ''): string {
  if (!raw) return '(no details)'

  // Delegate to type-specific formatters first
  if (STANDINGS_RE.test(type)) return formatStandingsText(raw, names)

  let text = resolveYaml(raw)

  // Substitute resolved names for _id/_ID key-value fields; treat 0 as "none"
  text = text.replace(/((?:_id|ID)):\s*(\d+)/gi, (full, suffix, digits) => {
    const n = Number(digits)
    if (n === 0) return `${suffix}: (none)`
    const name = names[digits]
    return name ? `${suffix}: ${name} (${digits})` : full
  })

  // Substitute resolved names for bare integers on list lines
  text = text.replace(LIST_INT_RE, (_, prefix, digits) => {
    const name = names[digits]
    return name ? `${prefix}${name} (${digits})` : `${prefix}${digits}`
  })

  // Convert Windows FILETIME (17-18 digit numbers) to readable date
  text = text.replace(/:\s*(\d{17,18})\b/g, (full, digits) => {
    try {
      const ft = BigInt(digits)
      if (ft < FILETIME_MIN || ft > FILETIME_MAX) return full
      const unixMs = Number((ft - FILETIME_EPOCH) / BigInt(10000))
      return ': ' + new Date(unixMs).toLocaleString()
    } catch { return full }
  })

  // Pretty-print camelCase keys
  text = text.replace(/^([a-zA-Z]\w*):/gm, (_, k) => `${prettyKey(k)}:`)

  return text.trim()
}

// Human-readable label for an ESI notification type string
function notifLabel(type: string): string {
  return prettyKey(type)
}

export default function NotificationsPanel({
  mail, mailLabels, notifications, loading, onRefresh, character,
  initialMailId, onInitialMailConsumed,
}: NotificationsPanelProps) {
  const [category, setCategory] = useState<Category>('mail')
  const [mailFilter, setMailFilter] = useState<'unread' | 'all'>('unread')
  const [selectedMail, setSelectedMail] = useState<EveMail | null>(null)
  const [selectedNotif, setSelectedNotif] = useState<EveNotification | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyText, setBodyText] = useState<string | null>(null)
  const [compose, setCompose] = useState<ComposeState | null>(null)
  const [localRead, setLocalRead] = useState<Set<number>>(new Set())
  const [notifNames, setNotifNames] = useState<Record<string, string>>({})
  const [resolvingNames, setResolvingNames] = useState(false)

  // Resolve IDs in notification text when a notification is selected
  useEffect(() => {
    setNotifNames({})
    if (!selectedNotif) return
    const ids = extractNotifIds(selectedNotif.text)
    const structureIds = extractStructureIds(selectedNotif.text)
    if (!ids.length && !structureIds.length) return
    setResolvingNames(true)
    const jobs: Promise<void>[] = []
    const merged: Record<string, string> = {}
    if (ids.length) {
      jobs.push(resolveIds(ids).then(map => {
        for (const [k, v] of Object.entries(map)) merged[String(k)] = v
      }))
    }
    if (structureIds.length && character?.accessToken) {
      jobs.push(
        fetch('/api/eve/structure-names', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: structureIds.map(String), token: character.accessToken }),
        }).then(r => r.json()).then((map: Record<string, string>) => {
          for (const [k, v] of Object.entries(map)) merged[k] = v
        }).catch(() => { /* ignore failed structure lookups */ })
      )
    }
    Promise.allSettled(jobs).then(() => {
      setNotifNames(merged)
      setResolvingNames(false)
    })
  }, [selectedNotif, character?.accessToken])

  // Handle incoming initialMailId from landing page navigation
  useEffect(() => {
    if (!initialMailId) return
    const m = mail.find(x => x.mailId === initialMailId)
    if (m) {
      setCategory('mail')
      setMailFilter('all')
      openMail(m)
    }
    onInitialMailConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMailId])

  const unreadCount = mail.filter(m => !m.isRead && !localRead.has(m.mailId)).length

  const filteredMail = mailFilter === 'unread'
    ? mail.filter(m => !m.isRead && !localRead.has(m.mailId))
    : mail

  const notifsByCategory = (cat: Exclude<Category, 'mail'>) =>
    notifications.filter(n => categoriseNotification(n.type) === cat)

  const categoryCounts = Object.fromEntries(
    (Object.keys(CATEGORY_LABELS) as Category[]).map(cat =>
      [cat, cat === 'mail' ? unreadCount : notifsByCategory(cat as Exclude<Category, 'mail'>).length]
    )
  ) as Record<Category, number>

  const openMail = useCallback(async (m: EveMail) => {
    setSelectedMail(m)
    setSelectedNotif(null)
    setBodyText(null)
    if (!character) return
    setBodyLoading(true)
    try {
      const r = await fetch('/api/mail/body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: character.characterId, mailId: m.mailId, token: character.accessToken }),
      })
      const data = await r.json()
      setBodyText(stripHtml(data.body ?? ''))
      if (!m.isRead && !localRead.has(m.mailId)) {
        fetch('/api/mail/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId: character.characterId, mailId: m.mailId, token: character.accessToken }),
        })
        setLocalRead(prev => new Set(prev).add(m.mailId))
      }
    } catch {
      setBodyText('Failed to load mail body.')
    } finally {
      setBodyLoading(false)
    }
  }, [character, localRead])

  const sendMail = useCallback(async () => {
    if (!compose || !character) return
    setCompose(c => c ? { ...c, sending: true, error: null } : c)
    try {
      const toId = parseInt(compose.to.trim(), 10)
      if (isNaN(toId)) {
        setCompose(c => c ? { ...c, sending: false, error: 'Recipient must be a character ID.' } : c)
        return
      }
      const r = await fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: character.characterId,
          token: character.accessToken,
          recipients: [{ recipient_id: toId, recipient_type: 'character' }],
          subject: compose.subject,
          body: compose.body,
        }),
      })
      if (!r.ok) {
        const e = await r.json()
        setCompose(c => c ? { ...c, sending: false, error: e.error ?? 'Send failed.' } : c)
        return
      }
      setCompose(null)
    } catch {
      setCompose(c => c ? { ...c, sending: false, error: 'Network error.' } : c)
    }
  }, [compose, character])

  const currentNotifs = category !== 'mail' ? notifsByCategory(category as Exclude<Category, 'mail'>) : []

  const showDetail = selectedMail !== null || selectedNotif !== null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Category sidebar */}
      <div className="flex flex-col border-r border-eve-border shrink-0 w-28">
        <div className="flex items-center gap-1.5 px-2 py-2 border-b border-eve-border shrink-0">
          <Bell size={11} className="text-eve-cyan" />
          <span className="text-[9px] font-mono text-eve-cyan tracking-widest uppercase">Notif</span>
        </div>
        {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => {
          const count = categoryCounts[cat]
          const active = category === cat
          return (
            <button
              key={cat}
              onClick={() => { setCategory(cat); setSelectedMail(null); setSelectedNotif(null); setBodyText(null) }}
              className={`flex items-center justify-between px-2 py-2 text-left border-b border-eve-border/50 transition-colors ${
                active ? 'bg-eve-cyan/10 text-eve-cyan border-l-2 border-l-eve-cyan' : 'text-eve-muted hover:text-eve-text hover:bg-eve-border/20 border-l-2 border-l-transparent'
              }`}
            >
              <span className="text-[10px] font-mono truncate">{CATEGORY_LABELS[cat]}</span>
              {count > 0 && (
                <span className={`text-[9px] font-mono ml-1 shrink-0 ${cat === 'mail' ? 'text-eve-cyan' : 'text-eve-dim'}`}>{count}</span>
              )}
            </button>
          )
        })}
        <div className="mt-auto p-2 border-t border-eve-border">
          <button onClick={onRefresh} className="w-full flex items-center justify-center gap-1 text-eve-muted hover:text-eve-cyan transition-colors py-1">
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            <span className="text-[9px] font-mono">SYNC</span>
          </button>
        </div>
      </div>

      {/* List column */}
      <div className={`flex flex-col border-r border-eve-border ${showDetail ? 'hidden md:flex w-64 shrink-0' : 'flex-1'}`}>
        {/* Mail list header */}
        {category === 'mail' && (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-eve-border shrink-0">
              <div className="flex gap-2">
                {(['unread', 'all'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setMailFilter(f)}
                    className={`text-[10px] font-mono uppercase transition-colors ${mailFilter === f ? 'text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
                  >
                    {f === 'unread' ? `Unread (${unreadCount})` : `All (${mail.length})`}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCompose(EMPTY_COMPOSE)}
                className="flex items-center gap-1 text-[10px] font-mono text-eve-muted hover:text-eve-cyan transition-colors"
              >
                <Send size={10} /> Compose
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredMail.length === 0 ? (
                <div className="flex items-center justify-center h-16 text-eve-dim text-xs font-mono">
                  {mailFilter === 'unread' ? 'No unread mail' : 'No mail'}
                </div>
              ) : filteredMail.map(m => {
                const isRead = m.isRead || localRead.has(m.mailId)
                const isSel = selectedMail?.mailId === m.mailId
                return (
                  <button
                    key={m.mailId}
                    onClick={() => openMail(m)}
                    className={`w-full text-left px-3 py-2.5 border-b border-eve-border/50 transition-colors ${isSel ? 'bg-eve-cyan/10' : 'hover:bg-eve-border/20'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isRead ? <MailOpen size={10} className="text-eve-dim shrink-0" /> : <Mail size={10} className="text-eve-cyan shrink-0" />}
                        <span className={`text-[11px] font-mono truncate ${isRead ? 'text-eve-muted' : 'text-eve-text'}`}>{m.fromName}</span>
                      </div>
                      <span className="text-[9px] font-mono text-eve-dim shrink-0">{formatDate(m.timestamp)}</span>
                    </div>
                    <div className={`text-[10px] font-mono truncate mt-0.5 pl-4 ${isRead ? 'text-eve-dim' : 'text-eve-muted'}`}>{m.subject}</div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Notification list */}
        {category !== 'mail' && (
          <>
            <div className="px-3 py-2 border-b border-eve-border shrink-0">
              <span className="text-[10px] font-mono text-eve-muted uppercase tracking-widest">{CATEGORY_LABELS[category]}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {currentNotifs.length === 0 ? (
                <div className="flex items-center justify-center h-16 text-eve-dim text-xs font-mono">No notifications</div>
              ) : currentNotifs.map(n => {
                const isSel = selectedNotif?.notificationId === n.notificationId
                return (
                  <button
                    key={n.notificationId}
                    onClick={() => { setSelectedNotif(n); setSelectedMail(null); setBodyText(null) }}
                    className={`w-full text-left px-3 py-2.5 border-b border-eve-border/50 transition-colors ${isSel ? 'bg-eve-cyan/10' : 'hover:bg-eve-border/20'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-eve-text truncate">{notifLabel(n.type)}</span>
                      <span className="text-[9px] font-mono text-eve-dim shrink-0">{formatDate(n.timestamp)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Detail pane */}
      {showDetail && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-eve-border bg-eve-panel shrink-0">
            <button
              onClick={() => { setSelectedMail(null); setSelectedNotif(null); setBodyText(null) }}
              className="md:hidden p-1 text-eve-muted hover:text-eve-cyan transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            {selectedMail && (
              <div className="min-w-0">
                <div className="text-xs font-mono text-eve-text truncate">{selectedMail.subject}</div>
                <div className="text-[10px] font-mono text-eve-muted">
                  From: {selectedMail.fromName} · {new Date(selectedMail.timestamp).toLocaleString()}
                </div>
              </div>
            )}
            {selectedNotif && (
              <div className="min-w-0">
                <div className="text-xs font-mono text-eve-text truncate">{notifLabel(selectedNotif.type)}</div>
                <div className="text-[10px] font-mono text-eve-muted">{new Date(selectedNotif.timestamp).toLocaleString()}</div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedMail && (
              bodyLoading ? (
                <div className="flex items-center gap-2 text-eve-muted text-xs font-mono">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : (
                <pre className="text-xs font-mono text-eve-text whitespace-pre-wrap leading-relaxed">{bodyText ?? ''}</pre>
              )
            )}
            {selectedNotif && (
              <>
                {resolvingNames && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-eve-dim mb-3">
                    <Loader2 size={10} className="animate-spin" /> Resolving IDs…
                  </div>
                )}
                <pre className="text-xs font-mono text-eve-text whitespace-pre-wrap leading-relaxed">{formatNotifText(selectedNotif.text, notifNames, selectedNotif.type)}</pre>
              </>
            )}
          </div>
        </div>
      )}

      {/* Compose modal */}
      {compose && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="eve-panel w-full max-w-lg mx-4 flex flex-col border border-eve-border">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-eve-border">
              <span className="text-xs font-mono text-eve-cyan tracking-widest uppercase">New Mail</span>
              <button onClick={() => setCompose(null)} className="text-eve-muted hover:text-eve-cyan transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <label className="eve-label block mb-1">To (Character ID)</label>
                <input className="eve-input w-full text-xs" placeholder="Character ID" value={compose.to}
                  onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : c)} />
              </div>
              <div>
                <label className="eve-label block mb-1">Subject</label>
                <input className="eve-input w-full text-xs" placeholder="Subject" value={compose.subject}
                  onChange={e => setCompose(c => c ? { ...c, subject: e.target.value } : c)} />
              </div>
              <div>
                <label className="eve-label block mb-1">Body</label>
                <textarea className="eve-input w-full text-xs font-mono resize-none" rows={8}
                  placeholder="Message…" value={compose.body}
                  onChange={e => setCompose(c => c ? { ...c, body: e.target.value } : c)} />
              </div>
              {compose.error && <div className="text-[11px] font-mono text-eve-red">{compose.error}</div>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setCompose(null)} className="eve-btn text-xs px-3 py-1.5">Cancel</button>
                <button onClick={sendMail}
                  disabled={compose.sending || !compose.to || !compose.subject || !compose.body}
                  className="eve-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
                  {compose.sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

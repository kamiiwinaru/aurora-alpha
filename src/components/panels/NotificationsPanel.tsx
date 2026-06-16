import { useState, useCallback, useEffect, useRef } from 'react'
import { RefreshCw, Mail, MailOpen, Send, X, ChevronLeft, Loader2, Bell, Trash2, ChevronDown, Users } from 'lucide-react'
import type { EveMail, EveMailLabel, EveNotification, EveCharacter, EveMailingList } from '../../types'
import { resolveIds, resolveTypeIds } from '../../lib/eve-esi'
import { NOTIF_TYPE_NAMES, notifLabel as _notifLabel } from '../../lib/notif-utils'

interface NotificationsPanelProps {
  mail: EveMail[]
  mailLabels: EveMailLabel[]
  mailingLists: EveMailingList[]
  notifications: EveNotification[]
  loading: boolean
  onRefresh: () => void
  character?: EveCharacter | null
  initialMailId?: number | null
  onInitialMailConsumed?: () => void
}

interface ComposeState {
  to: string
  toType: 'character' | 'corporation' | 'alliance' | 'mailing_list'
  subject: string
  body: string
  sending: boolean
  error: string | null
}

// Sidebar folder types: system labels + notification categories
type MailFolder = 'inbox' | 'sent' | 'corp' | 'alliance' | `label_${number}`
type NotifCategory = 'structures' | 'financial' | 'sovereignty' | 'warfare' | 'kills' | 'goals' | 'applications' | 'clones' | 'standings' | 'contacts' | 'planetary' | 'misc'
type SidebarItem = { kind: 'mail'; folder: MailFolder } | { kind: 'notif'; category: NotifCategory }

const SYSTEM_LABELS: Array<{ folder: MailFolder; labelId: number; name: string }> = [
  { folder: 'inbox',    labelId: 1, name: 'Inbox' },
  { folder: 'sent',     labelId: 2, name: 'Sent' },
  { folder: 'corp',     labelId: 4, name: 'Corp' },
  { folder: 'alliance', labelId: 8, name: 'Alliance' },
]

const NOTIF_CATEGORIES: Array<{ key: NotifCategory; label: string; re: RegExp }> = [
  { key: 'structures',   label: 'Structures',   re: /Structure|Tower|Poco|CustomsOffice|Starbase|Citadel|EngineeringComplex|Refinery|Upwell|StationService|StationAggression|StationConquer|Skyhook|MercenaryDen/i },
  { key: 'financial',    label: 'Financial',    re: /Bounty|Bill|Insurance|Market|Tax|Payment|Transaction|Wallet|Isk|OwnershipTransferred|Dividend|Reimbursement|LPAuto|SPAuto/i },
  { key: 'sovereignty',  label: 'Sovereignty',  re: /^Sov|Entosis|InfrastructureHub|^Campaign|TCU|IHub/i },
  { key: 'warfare',      label: 'Warfare',      re: /^War|FactionWarfare|^Fw|BattlePunish|Reinforce|Siege|Militia|AllyJoinedWar|CorpBecameWar|MutualWar|DeclareWar|OfferedSurrender|AcceptedSurrender|CombatOperation/i },
  { key: 'kills',        label: 'Kills',        re: /KillReport|KillMail|KillRight/i },
  { key: 'goals',        label: 'Goals',        re: /CorporationGoal|FreelanceProject|SeasonalChallenge/i },
  { key: 'applications', label: 'Applications', re: /CorpApp|CharApp|CorpInvite|CorpKick|CorpJoin|CorpLeave|CorpNewCEO|AllyJoined|CorporationLeft|CharLeft|CharTermination/i },
  { key: 'clones',       label: 'Clones',       re: /Clone|JumpClone/i },
  { key: 'standings',    label: 'Standings',    re: /Standing|AgentMission|FWChar|FWCorp|FWAlliance|NPCStanding|FacWar/i },
  { key: 'contacts',     label: 'Contacts',     re: /Contact|BuddyConnect/i },
  { key: 'planetary',    label: 'Planetary',    re: /Orbital|Planet|OrbitalAttacked|OrbitalReinforced/i },
]

function categoriseNotification(type: string): NotifCategory {
  for (const { key, re } of NOTIF_CATEGORIES) {
    if (re.test(type)) return key
  }
  return 'misc'
}

// ── Date formatting ───────────────────────────────────────────────────────
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

// ── YAML / notification text helpers ─────────────────────────────────────
const FILETIME_EPOCH = BigInt('116444736000000000')
const FILETIME_MIN  = BigInt('125911584000000000')  // 2000
const FILETIME_MAX  = BigInt('157766016000000000')  // 2100

function resolveYaml(raw: string): string {
  const anchors: Record<string, string> = {}
  let t = raw.replace(/\\n/g, '\n')
  t = t.replace(/&(\w+)\s+(\S+)/g, (_, a, v) => { anchors[a] = v; return v })
  t = t.replace(/\*(\w+)/g, (full, a) => anchors[a] ?? full)
  return t
}

function prettyKey(k: string): string {
  return k
    .replace(/IDs\b/g, ' IDs')          // typeIDs → type IDs
    .replace(/ID\b/g, ' ID')            // charID → char ID
    .replace(/([A-Z][a-z])/g, ' $1')   // camelCase split
    .replace(/[_]+/g, ' ')             // underscores → spaces
    .replace(/\s+/g, ' ')
    .trim()
}

// Bare integer on list lines: handles "- 123", "- - 123", "  - 123"
const LIST_INT_RE       = /^([ \t]*(?:-[ \t]+)+)(\d{3,12})\s*$/gm
const LIST_INT_LARGE_RE = /^([ \t]*(?:-[ \t]+)+)(\d{13,18})\s*$/gm

function collectInts(text: string, min: number, max: number): number[] {
  const ids: number[] = []
  const kvRe = /(?:_id|ID):\s*(\d+)/gi
  let m
  while ((m = kvRe.exec(text)) !== null) {
    const n = Number(m[1])
    if (Number.isSafeInteger(n) && n >= min && n < max) ids.push(n)
  }
  const listRe = new RegExp(LIST_INT_RE.source, 'gm')
  while ((m = listRe.exec(text)) !== null) {
    const n = Number(m[2])
    if (Number.isSafeInteger(n) && n >= min && n < max) ids.push(n)
  }
  return [...new Set(ids)]
}

// Keys whose values are celestials (moon/planet IDs) — not supported by /universe/names/
const CELESTIAL_KEY_RE = /moon|planet|orbital|asteroid|belt|stargate|star\b/i

// /universe/names/ supported ID ranges (approximate):
//   Factions:       500000-   599999
//   Regions:      10000000-  10999999
//   Constellations:20000000-  20999999
//   Solar systems: 30000000-  32999999
//   Stations:      60000000-  64999999
//   Characters:    90000000-2147483647
//   Corps/Alliances: 98000000+ / 99000000+
// Celestials (moons, planets): 40000000-49999999 — NOT supported, exclude
function isMaybeEntityId(n: number): boolean {
  if (n >= 40_000_000 && n <= 49_999_999) return false  // celestials
  if (n < 500_000) return false                          // too small for any entity
  if (n >= 1_000_000_000_000) return false               // player structures
  return true
}

// Entity IDs: characters, corps, alliances, systems, stations — NOT type IDs or celestials.
function extractNotifEntityIds(raw: string): number[] {
  const text = resolveYaml(raw)
  const ids: number[] = []
  // KV form — parse key + value so we can skip celestial keys
  const kvRe = /^(\w+):\s*(\d+)\s*$/gm
  let m
  while ((m = kvRe.exec(text)) !== null) {
    const key = m[1]
    const n   = Number(m[2])
    if (CELESTIAL_KEY_RE.test(key)) continue          // skip moon/planet/etc
    if (/[Tt]ype[_]?[Ii][Dd]$/.test(key)) continue   // skip *TypeID (handled separately)
    if (isMaybeEntityId(n)) ids.push(n)
  }
  return [...new Set(ids)]
}

// Type IDs: items, ships, structures — from *TypeID fields anywhere in the text.
function extractNotifTypeIds(raw: string): number[] {
  const text = resolveYaml(raw)
  const ids: number[] = []
  const re = /\w*[Tt]ype[_]?[Ii][Dd]:\s*(\d+)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1])
    if (n > 0 && Number.isSafeInteger(n)) ids.push(n)
  }
  return [...new Set(ids)]
}

// Keep old name for callers that don't need the split
function extractNotifIds(raw: string): number[] {
  return extractNotifEntityIds(raw)
}

// The listOfTypesAndQty block ends when we hit a new YAML key (letter at column 0) or EOF.
// Using (?=\n[a-zA-Z]|\s*$) instead of (?=\n\S|$) so we don't stop at "- - qty" list lines.
const QTY_TYPE_BLOCK_RE = /listOfTypesAndQty\s*:\s*\n([\s\S]*?)(?=\n[a-zA-Z]|\s*$)/i

// Parse [qty, typeId] pairs from the block. Returns {qty, typeId}[].
function parseQtyTypePairs(block: string): Array<{ qty: string; typeId: string | null }> {
  const lines = block.split('\n')
  const pairs: Array<{ qty: string; typeId: string | null }> = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const first = /^[ \t]*(?:-[ \t]+)+(\d+)\s*$/.exec(lines[i])
    if (!first) continue
    const next = lines[i + 1] ?? ''
    const second = /^[ \t]*(?:-[ \t]+)+(\d+)\s*$/.exec(next)
    pairs.push({ qty: first[1], typeId: second?.[1] ?? null })
    if (second) i++ // consume the typeId line
  }
  return pairs
}

// Extract type IDs from "listOfTypesAndQty" paired list (second value in each pair).
// Type IDs can be < 500 so we skip the normal min-threshold here.
function extractQtyTypeIds(raw: string): number[] {
  const text = resolveYaml(raw)
  const block = QTY_TYPE_BLOCK_RE.exec(text)?.[1]
  if (!block) return []
  return [...new Set(
    parseQtyTypePairs(block)
      .map(p => Number(p.typeId))
      .filter(n => n > 0 && Number.isSafeInteger(n))
  )]
}

// Format a "listOfTypesAndQty" block as "qty × Name" lines.
function formatQtyTypePairs(block: string, names: Record<string, string>): string {
  const pairs = parseQtyTypePairs(block)
  return pairs.map(({ qty, typeId }) => {
    const name = typeId ? (names[typeId] ?? `(TypeID ${typeId})`) : '(unknown)'
    return `  ${qty.padStart(6)} × ${name}`
  }).join('\n')
}

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

// Re-export from shared util — keeps NotificationsPanel using the same map as LandingPage
// NOTIF_TYPE_NAMES is imported at the top for use by notifLabel
const notifLabel = _notifLabel
void NOTIF_TYPE_NAMES // referenced by notifLabel via closure in notif-utils

// ── Key labels & value helpers ────────────────────────────────────────────
const KEY_LABELS: Record<string, string> = {
  charID:              'Pilot',
  characterID:         'Pilot',
  corpID:              'Corporation',
  corporationID:       'Corporation',
  corporation_id:      'Corporation',
  allianceID:          'Alliance',
  alliance_id:         'Alliance',
  solarsystemID:       'System',
  solarSystemID:       'System',
  dungeonSolarSystemID:'System',
  dungeonLocationID:   'Location',
  structureID:         'Structure',
  structureName:       'Structure Name',
  structureTypeID:     'Structure Type',
  typeID:              'Type',
  victimShipTypeID:    'Ship',
  moonID:              'Moon',
  planetID:            'Planet',
  shieldPercentage:    'Shield',
  armorPercentage:     'Armor',
  hullPercentage:      'Hull',
  listOfTypesAndQty:   'Items',
  timeLeft:            'Reinforce In',
  timestamp:           'Timestamp',
  vulnerableTime:      'Window Duration',
  itemID:              'Item',
  aggressorID:         'Aggressor',
  aggressorCorpID:     'Aggressor Corp',
  aggressorAllianceID: 'Aggressor Alliance',
  declaredByID:        'Declared By',
  againstID:           'Against',
  defenderID:          'Defender',
  hostileState:        'Active',
  delayHours:          'Starts In',
  warHQ:               'War HQ',
  cost:                'Cost',
  amount:              'Amount',
  payout:              'Paid Out',
  level:               'Standing Level',
  creator_id:          'Created By',
  goal_id:             'Goal ID',
  goal_name:           'Goal',
  applicationText:     'Message',
  destroyerID:         'Destroyed By',
  locationID:          'Location',
  locationOwnerID:     'Location Owner',
  ownerID:             'Owner',
  typeIDs:             'Implants',
  rewardQuantity:      'Reward',
  rewardTypeID:        'Reward Type',
}

function labelKey(k: string): string {
  return KEY_LABELS[k] ?? prettyKey(k)
}

function fmtIsk(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ISK'
}

// Shared cleanup applied to all formatters after key/value substitution
function applyCommonCleanup(text: string): string {
  // Strip HTML tags from values
  text = text.replace(/<[^>]+>/g, '')
  // Empty string literals '' → remove line
  text = text.replace(/^[^\n]+:\s*''\s*\n?/gm, '')
  // Empty arrays [] → remove line
  text = text.replace(/^[^\n]+:\s*\[\s*\]\s*\n?/gm, '')
  // Boolean values
  text = text.replace(/^([^\n:]+):\s*true\s*$/gim, '$1: Yes')
  text = text.replace(/^([^\n:]+):\s*false\s*$/gim, '$1: No')
  // Floats with > 4 decimal places → 2dp (catches amount: 23853462.400000002)
  text = text.replace(/:\s*(-?\d+\.\d{4,})\s*$/gm, (_, n) => ': ' + parseFloat(n).toFixed(2))
  // ISK formatting for amount/cost keys
  text = text.replace(/^(Amount|Cost):\s*([\d.]+)\s*$/gm, (_, key, val) => {
    const n = parseFloat(val); return isNaN(n) ? `${key}: ${val}` : `${key}: ${fmtIsk(n)}`
  })
  // delayHours → "X hours"
  text = text.replace(/^(Starts In):\s*(\d+)\s*$/gm, '$1: $2 hours')
  // level → standing description
  text = text.replace(/^(Standing Level):\s*(-?\d+)\s*$/gm, (_, key, val) => {
    const n = parseInt(val)
    const desc = n >= 10 ? 'Excellent (+10)' : n >= 5 ? 'Good (+5)' : n === 0 ? 'Neutral (0)' : n <= -10 ? 'Terrible (−10)' : n <= -5 ? 'Bad (−5)' : `(${val})`
    return `${key}: ${desc}`
  })
  // Strip UI localization path list items (Mission notifications)
  text = text.replace(/^\s*-\s*UI\/\S+[^\n]*\n?/gm, '')
  text = text.replace(/^\s*-\s*\{\s*\}[^\n]*\n?/gm, '')
  // Collapse keys with empty bodies left by stripping
  text = text.replace(/^([^\n:]+):\s*\n(?=\S|$)/gm, '')
  // Collapse excess blank lines
  text = text.replace(/\n{3,}/g, '\n\n')
  return text
}

// Extract entity IDs from standings list values (first two in each 6-tuple)
function extractStandingsEntityIds(raw: string): number[] {
  const text = resolveYaml(raw)
  const valueRe = /^[ \t]*(?:-[ \t]+)+(-?[\d.]+)\s*$/gm
  const values: string[] = []
  let m
  while ((m = valueRe.exec(text)) !== null) values.push(m[1])
  const ids: number[] = []
  for (let i = 0; i + 5 < values.length; i += 6) {
    for (const raw of [values[i], values[i + 1]]) {
      const n = parseInt(raw, 10)
      if (isMaybeEntityId(n)) ids.push(n)
    }
  }
  return [...new Set(ids)]
}

// ── Type-specific formatters ──────────────────────────────────────────────

function formatStandingsText(raw: string, names: Record<string, string>): string {
  const text = resolveYaml(raw)
  const valueRe = /^[ \t]*(?:-[ \t]+)+(-?[\d.]+)\s*$/gm
  const values: string[] = []
  let m
  while ((m = valueRe.exec(text)) !== null) values.push(m[1])
  if (!values.length) return formatNotifText(raw, names)
  const lines: string[] = []
  for (let i = 0; i + 5 < values.length; i += 6) {
    const [entityRaw, charRaw, deltaRaw, , , standingRaw] = values.slice(i, i + 6)
    const entity   = names[entityRaw] ? `${names[entityRaw]}` : `ID ${entityRaw}`
    const char_    = names[charRaw]   ? `${names[charRaw]}`   : `ID ${charRaw}`
    const delta    = parseFloat(deltaRaw)
    const standing = parseFloat(standingRaw)
    if (i > 0) lines.push('')
    lines.push(
      `Entity:   ${entity}`,
      `Pilot:    ${char_}`,
      `Change:   ${isNaN(delta)    ? deltaRaw    : (delta * 10).toFixed(3)}`,
      `Standing: ${isNaN(standing) ? standingRaw : standing.toFixed(2)}`,
    )
  }
  return lines.join('\n')
}

function formatKillReportText(raw: string, names: Record<string, string>): string {
  const text = resolveYaml(raw)
  const lines: string[] = []
  const killIdM = /killMailID:\s*(\d+)/.exec(text)
  const hashM   = /killMailHash:\s*(\S+)/.exec(text)
  const victimM = /victimID:\s*(\d+)/.exec(text)
  const shipM   = /victimShipTypeID:\s*(\d+)/.exec(text)
  if (killIdM) lines.push(`Kill ID: ${killIdM[1]}`)
  if (victimM) lines.push(`Victim:  ${names[victimM[1]] ?? `ID ${victimM[1]}`}`)
  if (shipM)   lines.push(`Ship:    ${names[shipM[1]]   ?? `TypeID ${shipM[1]}`}`)
  if (killIdM) lines.push('', `zkillboard.com/kill/${killIdM[1]}/`)
  return lines.join('\n') || formatNotifText(raw, names)
}

function formatStructureText(raw: string, names: Record<string, string>): string {
  let text = resolveYaml(raw)

  // Strip blocks that carry only internal EVE UI data
  text = text.replace(/^structureShowInfoData\s*:[^\n]*(?:\n[ \t]*-[^\n]*)*/gim, '')
  text = text.replace(/^warHQ[_\s]*[Ii]d[_\s]*[Tt]ype\s*:[^\n]*(?:\n[ \t]*-[^\n]*)*/gim, '')

  // Replace listOfTypesAndQty block with "qty × Name" lines
  text = text.replace(QTY_TYPE_BLOCK_RE, (_, block) => {
    const lines = formatQtyTypePairs(block, names)
    return lines ? `Items:\n${lines}\n` : ''
  })

  // Resolve entity IDs (charID, solarsystemID, etc.) from KV lines with 6+ digit values
  text = text.replace(/^(\w+):\s*(\d{6,})\s*$/gm, (full, key, digits) => {
    if (/[Tt]ype[_]?[Ii][Dd]$/.test(key)) return full  // handled below
    const name = names[digits]
    return name ? `${labelKey(key)}: ${name}` : `${labelKey(key)}: ${digits}`
  })

  // Resolve type IDs (*TypeID fields)
  text = text.replace(/^(\w*[Tt]ype[_]?[Ii][Dd]):\s*(\d+)\s*$/gm, (_, key, digits) => {
    const name = names[digits]
    return name ? `${labelKey(key)}: ${name}` : `${labelKey(key)}: TypeID ${digits}`
  })

  // FILETIME
  text = text.replace(/:\s*(\d{17,18})\b/g, (full, digits) => {
    try {
      const ft = BigInt(digits)
      if (ft < FILETIME_MIN || ft > FILETIME_MAX) return full
      return ': ' + new Date(Number((ft - FILETIME_EPOCH) / BigInt(10000))).toLocaleString()
    } catch { return full }
  })

  // Nanosecond durations
  text = text.replace(/^(timeLeft|vulnerableTime):\s*(\d+)\s*$/gm, (_, key, digits) => {
    const secs = Math.round(Number(digits) / 1e9)
    const h = Math.floor(secs / 3600), mn = Math.floor((secs % 3600) / 60), s = secs % 60
    return `${labelKey(key)}: ${h ? `${h}h ${mn}m` : mn ? `${mn}m ${s}s` : `${s}s`}`
  })

  // Shield/armor/hull percentages
  text = text.replace(/^(shield|armor|hull)Percentage:\s*([\d.]+)\s*$/gim, (_, key, val) => {
    return `${labelKey(key + 'Percentage')}: ${(parseFloat(val) * 100).toFixed(1)}%`
  })

  // Pretty-print remaining camelCase keys
  text = text.replace(/^([a-zA-Z]\w*):/gm, (_, k) => `${labelKey(k)}:`)

  return applyCommonCleanup(text).trim()
}

function formatGenericText(raw: string, names: Record<string, string>): string {
  let text = resolveYaml(raw)

  // Items list
  text = text.replace(QTY_TYPE_BLOCK_RE, (_, block) => {
    const lines = formatQtyTypePairs(block, names)
    return lines ? `Items:\n${lines}\n` : ''
  })

  // Resolve entity + type IDs from KV pairs
  text = text.replace(/^(\w+):\s*(\d+)\s*$/gm, (full, key, digits) => {
    const name = names[digits]
    if (!name) return `${labelKey(key)}: ${digits}`
    return `${labelKey(key)}: ${name}`
  })

  // Resolve bare list integers
  text = text.replace(LIST_INT_RE, (_, prefix, digits) => {
    const name = names[digits]
    return name ? `${prefix}${name}` : `${prefix}${digits}`
  })

  // FILETIME
  text = text.replace(/:\s*(\d{17,18})\b/g, (full, digits) => {
    try {
      const ft = BigInt(digits)
      if (ft < FILETIME_MIN || ft > FILETIME_MAX) return full
      return ': ' + new Date(Number((ft - FILETIME_EPOCH) / BigInt(10000))).toLocaleString()
    } catch { return full }
  })

  // Pretty-print remaining keys
  text = text.replace(/^([a-zA-Z_]\w*):/gm, (_, k) => `${labelKey(k)}:`)

  return applyCommonCleanup(text).trim()
}

function formatNotifText(raw: string, names: Record<string, string> = {}, type = ''): string {
  if (!raw) return '(no details)'
  if (/Standing/i.test(type))                        return formatStandingsText(raw, names)
  if (/KillReport|KillMail/i.test(type))             return formatKillReportText(raw, names)
  if (/Structure|Skyhook|Tower|Mercenary/i.test(type)) return formatStructureText(raw, names)
  return formatGenericText(raw, names)
}

const EMPTY_COMPOSE: ComposeState = { to: '', toType: 'character', subject: '', body: '', sending: false, error: null }

export default function NotificationsPanel({
  mail, mailLabels, mailingLists, notifications, loading, onRefresh, character,
  initialMailId, onInitialMailConsumed,
}: NotificationsPanelProps) {
  const [sidebar, setSidebar] = useState<SidebarItem>({ kind: 'mail', folder: 'inbox' })
  const [selectedMail, setSelectedMail] = useState<EveMail | null>(null)
  const [selectedNotif, setSelectedNotif] = useState<EveNotification | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyText, setBodyText] = useState<string | null>(null)
  const [compose, setCompose] = useState<ComposeState | null>(null)
  const [localRead, setLocalRead] = useState<Set<number>>(new Set())
  const [localDeleted, setLocalDeleted] = useState<Set<number>>(new Set())
  const [notifNames, setNotifNames] = useState<Record<string, string>>({})
  const [resolvingNames, setResolvingNames] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreMail, setMoreMail] = useState<EveMail[]>([])
  const [toTypeOpen, setToTypeOpen] = useState(false)
  const toTypeRef = useRef<HTMLDivElement>(null)

  // Close toType dropdown on outside click
  useEffect(() => {
    if (!toTypeOpen) return
    const handler = (e: MouseEvent) => {
      if (toTypeRef.current && !toTypeRef.current.contains(e.target as Node)) setToTypeOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [toTypeOpen])

  // Resolve IDs when a notification is selected
  useEffect(() => {
    setNotifNames({})
    if (!selectedNotif) return
    const standingsIds = /Standing/i.test(selectedNotif.type) ? extractStandingsEntityIds(selectedNotif.text) : []
    const entityIds = [...new Set([...extractNotifEntityIds(selectedNotif.text), ...standingsIds])]
    const typeIds   = [...new Set([
      ...extractQtyTypeIds(selectedNotif.text),
      ...extractNotifTypeIds(selectedNotif.text),
    ])]
    const structureIds = extractStructureIds(selectedNotif.text)
    if (!entityIds.length && !typeIds.length && !structureIds.length) return
    setResolvingNames(true)
    const merged: Record<string, string> = {}
    const jobs: Promise<void>[] = []
    // Entity IDs (chars, corps, systems) → /universe/names/ — kept separate to avoid 422
    if (entityIds.length) {
      jobs.push(resolveIds(entityIds).then(map => {
        for (const [k, v] of Object.entries(map)) merged[String(k)] = v
      }))
    }
    // Type IDs (items, ships, structures) → /universe/types/{id}/ directly
    if (typeIds.length) {
      jobs.push(resolveTypeIds(typeIds).then(map => {
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
        }).catch(() => {})
      )
    }
    Promise.allSettled(jobs).then(() => {
      setNotifNames(merged)
      setResolvingNames(false)
    })
  }, [selectedNotif, character?.accessToken])

  // Handle initialMailId from landing page
  useEffect(() => {
    if (!initialMailId) return
    const m = allMail.find(x => x.mailId === initialMailId)
    if (m) {
      setSidebar({ kind: 'mail', folder: folderForMail(m) })
      openMail(m)
    }
    onInitialMailConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMailId])

  // ── Mail helpers ──────────────────────────────────────────────────────────

  // Determine which folder a mail belongs to based on its labelIds
  function folderForMail(m: EveMail): MailFolder {
    if (m.labelIds.includes(8)) return 'alliance'
    if (m.labelIds.includes(4)) return 'corp'
    if (m.labelIds.includes(2)) return 'sent'
    return 'inbox'
  }

  const allMail = [...mail, ...moreMail].filter(m => !localDeleted.has(m.mailId))

  function mailForFolder(folder: MailFolder): EveMail[] {
    if (folder.startsWith('label_')) {
      const labelId = parseInt(folder.slice(6), 10)
      return allMail.filter(m => m.labelIds.includes(labelId))
    }
    const systemLabel = SYSTEM_LABELS.find(s => s.folder === folder)
    if (!systemLabel) return allMail
    return allMail.filter(m => m.labelIds.includes(systemLabel.labelId))
  }

  function unreadInFolder(folder: MailFolder): number {
    return mailForFolder(folder).filter(m => !m.isRead && !localRead.has(m.mailId)).length
  }

  const totalMailUnread = SYSTEM_LABELS.reduce((sum, sl) => sum + unreadInFolder(sl.folder), 0)

  const notifsByCategory = (cat: NotifCategory) =>
    notifications.filter(n => categoriseNotification(n.type) === cat)

  const totalNotifUnread = notifications.filter(n => !n.isRead).length

  function notifCountForCategory(cat: NotifCategory): number {
    return notifsByCategory(cat).length
  }

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

  const deleteMail = useCallback(async (m: EveMail) => {
    if (!character) return
    setLocalDeleted(prev => new Set(prev).add(m.mailId))
    if (selectedMail?.mailId === m.mailId) { setSelectedMail(null); setBodyText(null) }
    fetch('/api/mail/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: character.characterId, mailId: m.mailId, token: character.accessToken }),
    })
  }, [character, selectedMail])

  const loadMoreMail = useCallback(async () => {
    if (!character || loadingMore) return
    const existing = allMail
    if (!existing.length) return
    const lastMailId = Math.min(...existing.map(m => m.mailId))
    setLoadingMore(true)
    try {
      const r = await fetch('/api/mail/more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: character.characterId, token: character.accessToken, lastMailId }),
      })
      const raw: Array<{ mail_id: number; subject: string; from: number; timestamp: string; is_read?: boolean; recipients: Array<{ recipient_id: number; recipient_type: string }>; labels?: number[] }> = await r.json()
      if (!Array.isArray(raw) || !raw.length) return
      const senderIds = [...new Set(raw.map(m => m.from))]
      const names = await resolveIds(senderIds)
      const resolved: EveMail[] = raw.map(m => ({
        mailId: m.mail_id,
        subject: m.subject,
        fromId: m.from,
        fromName: names[m.from] ?? `Pilot ${m.from}`,
        timestamp: m.timestamp,
        isRead: m.is_read ?? false,
        labelIds: m.labels ?? [],
        recipients: (m.recipients ?? []).map(rec => ({
          recipientId: rec.recipient_id,
          recipientType: rec.recipient_type as EveMail['recipients'][number]['recipientType'],
        })),
      }))
      setMoreMail(prev => [...prev, ...resolved])
    } catch { /* ignore */ }
    finally { setLoadingMore(false) }
  }, [character, allMail, loadingMore])

  const sendMail = useCallback(async () => {
    if (!compose || !character) return
    setCompose(c => c ? { ...c, sending: true, error: null } : c)
    try {
      let recipientId: number
      if (compose.toType === 'mailing_list') {
        const list = mailingLists.find(l => l.name.toLowerCase() === compose.to.trim().toLowerCase() || String(l.mailingListId) === compose.to.trim())
        if (!list) {
          setCompose(c => c ? { ...c, sending: false, error: 'Mailing list not found.' } : c)
          return
        }
        recipientId = list.mailingListId
      } else {
        recipientId = parseInt(compose.to.trim(), 10)
        if (isNaN(recipientId)) {
          setCompose(c => c ? { ...c, sending: false, error: `Recipient must be a ${compose.toType} ID.` } : c)
          return
        }
      }
      const r = await fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: character.characterId,
          token: character.accessToken,
          recipients: [{ recipient_id: recipientId, recipient_type: compose.toType }],
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
  }, [compose, character, mailingLists])

  // ── Derived state ────────────────────────────────────────────────────────
  const currentMailList = sidebar.kind === 'mail' ? mailForFolder(sidebar.folder) : []
  const currentNotifList = sidebar.kind === 'notif' ? notifsByCategory(sidebar.category) : []
  const showDetail = selectedMail !== null || selectedNotif !== null

  const userLabels = mailLabels.filter(l => ![1, 2, 4, 8].includes(l.labelId))

  const TO_TYPE_LABELS: Record<string, string> = {
    character: 'Character ID',
    corporation: 'Corporation ID',
    alliance: 'Alliance ID',
    mailing_list: 'Mailing List',
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Sidebar ── */}
      <div className="flex flex-col border-r border-eve-border shrink-0 w-32 overflow-y-auto">
        {/* Mail section */}
        <div className="px-2 py-1.5 border-b border-eve-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Mail size={10} className="text-eve-cyan" />
              <span className="text-[9px] font-mono text-eve-cyan tracking-widest uppercase">Mail</span>
            </div>
            {totalMailUnread > 0 && (
              <span className="text-[9px] font-mono text-eve-cyan">{totalMailUnread}</span>
            )}
          </div>
        </div>
        {SYSTEM_LABELS.map(({ folder, name }) => {
          const unread = unreadInFolder(folder)
          const active = sidebar.kind === 'mail' && sidebar.folder === folder
          return (
            <button
              key={folder}
              onClick={() => { setSidebar({ kind: 'mail', folder }); setSelectedMail(null); setSelectedNotif(null); setBodyText(null) }}
              className={`flex items-center justify-between px-2 py-1.5 text-left border-b border-eve-border/30 transition-colors ${
                active ? 'bg-eve-cyan/10 text-eve-cyan border-l-2 border-l-eve-cyan' : 'text-eve-muted hover:text-eve-text hover:bg-eve-border/20 border-l-2 border-l-transparent'
              }`}
            >
              <span className="text-[10px] font-mono pl-1">{name}</span>
              {unread > 0 && <span className="text-[9px] font-mono text-eve-cyan shrink-0">{unread}</span>}
            </button>
          )
        })}
        {userLabels.map(label => {
          const folder: MailFolder = `label_${label.labelId}`
          const active = sidebar.kind === 'mail' && sidebar.folder === folder
          return (
            <button
              key={folder}
              onClick={() => { setSidebar({ kind: 'mail', folder }); setSelectedMail(null); setSelectedNotif(null); setBodyText(null) }}
              className={`flex items-center justify-between px-2 py-1.5 text-left border-b border-eve-border/30 transition-colors ${
                active ? 'bg-eve-cyan/10 text-eve-cyan border-l-2 border-l-eve-cyan' : 'text-eve-muted hover:text-eve-text hover:bg-eve-border/20 border-l-2 border-l-transparent'
              }`}
            >
              <span className="text-[10px] font-mono pl-1 truncate">{label.name}</span>
              {label.unreadCount > 0 && <span className="text-[9px] font-mono text-eve-dim shrink-0">{label.unreadCount}</span>}
            </button>
          )
        })}

        {/* Notifications section */}
        <div className="px-2 py-1.5 border-b border-eve-border mt-1 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Bell size={10} className="text-eve-gold" />
              <span className="text-[9px] font-mono text-eve-gold tracking-widest uppercase">Notif</span>
            </div>
            {totalNotifUnread > 0 && (
              <span className="text-[9px] font-mono text-eve-gold">{totalNotifUnread}</span>
            )}
          </div>
        </div>
        {NOTIF_CATEGORIES.map(({ key, label }) => {
          const count = notifCountForCategory(key)
          const active = sidebar.kind === 'notif' && sidebar.category === key
          return (
            <button
              key={key}
              onClick={() => { setSidebar({ kind: 'notif', category: key }); setSelectedMail(null); setSelectedNotif(null); setBodyText(null) }}
              className={`flex items-center justify-between px-2 py-1.5 text-left border-b border-eve-border/30 transition-colors ${
                active ? 'bg-eve-gold/10 text-eve-gold border-l-2 border-l-eve-gold' : 'text-eve-muted hover:text-eve-text hover:bg-eve-border/20 border-l-2 border-l-transparent'
              }`}
            >
              <span className="text-[10px] font-mono pl-1 truncate">{label}</span>
              {count > 0 && <span className="text-[9px] font-mono text-eve-dim shrink-0">{count}</span>}
            </button>
          )
        })}

        {/* Misc catch-all */}
        {(() => {
          const count = notifCountForCategory('misc')
          const active = sidebar.kind === 'notif' && sidebar.category === 'misc'
          return (
            <button
              onClick={() => { setSidebar({ kind: 'notif', category: 'misc' }); setSelectedMail(null); setSelectedNotif(null); setBodyText(null) }}
              className={`flex items-center justify-between px-2 py-1.5 text-left border-b border-eve-border/30 transition-colors ${
                active ? 'bg-eve-gold/10 text-eve-gold border-l-2 border-l-eve-gold' : 'text-eve-muted hover:text-eve-text hover:bg-eve-border/20 border-l-2 border-l-transparent'
              }`}
            >
              <span className="text-[10px] font-mono pl-1">Misc</span>
              {count > 0 && <span className="text-[9px] font-mono text-eve-dim shrink-0">{count}</span>}
            </button>
          )
        })()}

        <div className="mt-auto p-2 border-t border-eve-border">
          <button onClick={onRefresh} className="w-full flex items-center justify-center gap-1 text-eve-muted hover:text-eve-cyan transition-colors py-1">
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            <span className="text-[9px] font-mono">SYNC</span>
          </button>
        </div>
      </div>

      {/* ── List column ── */}
      <div className={`flex flex-col border-r border-eve-border ${showDetail ? 'hidden md:flex w-64 shrink-0' : 'flex-1'}`}>

        {/* Mail list */}
        {sidebar.kind === 'mail' && (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-eve-border shrink-0">
              <span className="text-[10px] font-mono text-eve-muted uppercase tracking-widest">
                {SYSTEM_LABELS.find(s => s.folder === sidebar.folder)?.name ?? mailLabels.find(l => `label_${l.labelId}` === sidebar.folder)?.name ?? 'Mail'}
                <span className="ml-1 text-eve-dim">({currentMailList.length})</span>
              </span>
              <button
                onClick={() => setCompose(EMPTY_COMPOSE)}
                className="flex items-center gap-1 text-[10px] font-mono text-eve-muted hover:text-eve-cyan transition-colors"
              >
                <Send size={10} /> Compose
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {currentMailList.length === 0 ? (
                <div className="flex items-center justify-center h-16 text-eve-dim text-xs font-mono">No mail</div>
              ) : currentMailList.map(m => {
                const isRead = m.isRead || localRead.has(m.mailId)
                const isSel = selectedMail?.mailId === m.mailId
                return (
                  <div
                    key={m.mailId}
                    className={`group relative border-b border-eve-border/50 transition-colors ${isSel ? 'bg-eve-cyan/10' : 'hover:bg-eve-border/20'}`}
                  >
                    <button
                      onClick={() => openMail(m)}
                      className="w-full text-left px-3 py-2.5 pr-8"
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
                    <button
                      onClick={() => deleteMail(m)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-eve-dim opacity-0 group-hover:opacity-100 hover:text-eve-red transition-all"
                      title="Delete"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                )
              })}
              {/* Load more */}
              {allMail.length > 0 && (
                <button
                  onClick={loadMoreMail}
                  disabled={loadingMore}
                  className="w-full py-2 text-[10px] font-mono text-eve-dim hover:text-eve-muted transition-colors flex items-center justify-center gap-1"
                >
                  {loadingMore ? <Loader2 size={10} className="animate-spin" /> : null}
                  {loadingMore ? 'Loading…' : 'Load older mail'}
                </button>
              )}
            </div>
          </>
        )}

        {/* Notification list */}
        {sidebar.kind === 'notif' && (
          <>
            <div className="px-3 py-2 border-b border-eve-border shrink-0">
              <span className="text-[10px] font-mono text-eve-muted uppercase tracking-widest">
                {NOTIF_CATEGORIES.find(c => c.key === sidebar.category)?.label ?? 'Misc'}
                <span className="ml-1 text-eve-dim">({currentNotifList.length})</span>
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {currentNotifList.length === 0 ? (
                <div className="flex items-center justify-center h-16 text-eve-dim text-xs font-mono">No notifications</div>
              ) : currentNotifList.map(n => {
                const isSel = selectedNotif?.notificationId === n.notificationId
                return (
                  <button
                    key={n.notificationId}
                    onClick={() => { setSelectedNotif(n); setSelectedMail(null); setBodyText(null) }}
                    className={`w-full text-left px-3 py-2.5 border-b border-eve-border/50 transition-colors ${isSel ? 'bg-eve-gold/10' : 'hover:bg-eve-border/20'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {!n.isRead && <div className="w-1.5 h-1.5 rounded-full bg-eve-gold shrink-0" />}
                        <span className="text-[11px] font-mono text-eve-text truncate">{notifLabel(n.type)}</span>
                      </div>
                      <span className="text-[9px] font-mono text-eve-dim shrink-0">{formatDate(n.timestamp)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Detail pane ── */}
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
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-eve-text truncate">{selectedMail.subject}</div>
                <div className="text-[10px] font-mono text-eve-muted">
                  From: {selectedMail.fromName} · {new Date(selectedMail.timestamp).toLocaleString()}
                </div>
                {selectedMail.recipients.length > 0 && (
                  <div className="text-[10px] font-mono text-eve-dim">
                    To: {selectedMail.recipients.map(r => r.recipientName ?? `${r.recipientType} ${r.recipientId}`).join(', ')}
                  </div>
                )}
              </div>
            )}
            {selectedNotif && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-eve-text truncate">{notifLabel(selectedNotif.type)}</div>
                <div className="text-[10px] font-mono text-eve-muted">{new Date(selectedNotif.timestamp).toLocaleString()}</div>
              </div>
            )}
            {selectedMail && (
              <button
                onClick={() => deleteMail(selectedMail)}
                className="p-1 text-eve-muted hover:text-eve-red transition-colors shrink-0"
                title="Delete mail"
              >
                <Trash2 size={13} />
              </button>
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
                <pre className="text-xs font-mono text-eve-text whitespace-pre-wrap leading-relaxed">
                  {formatNotifText(selectedNotif.text, notifNames, selectedNotif.type)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Compose modal ── */}
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
              {/* Recipient row with type selector */}
              <div>
                <label className="eve-label block mb-1">To</label>
                <div className="flex gap-2">
                  {/* Type dropdown */}
                  <div className="relative" ref={toTypeRef}>
                    <button
                      onClick={() => setToTypeOpen(o => !o)}
                      className="eve-input flex items-center gap-1 text-xs whitespace-nowrap px-2 py-1.5"
                    >
                      {compose.toType === 'mailing_list' ? <Users size={10} /> : null}
                      <span className="capitalize">{compose.toType.replace('_', ' ')}</span>
                      <ChevronDown size={10} />
                    </button>
                    {toTypeOpen && (
                      <div className="absolute top-full left-0 mt-0.5 bg-eve-panel border border-eve-border z-50 min-w-[130px]">
                        {(['character', 'corporation', 'alliance', 'mailing_list'] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => { setCompose(c => c ? { ...c, toType: t, to: '' } : c); setToTypeOpen(false) }}
                            className="w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-eve-border/30 capitalize text-eve-text"
                          >
                            {t.replace('_', ' ')}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Mailing list selector or ID input */}
                  {compose.toType === 'mailing_list' ? (
                    <select
                      className="eve-input flex-1 text-xs"
                      value={compose.to}
                      onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : c)}
                    >
                      <option value="">Select mailing list…</option>
                      {mailingLists.map(l => (
                        <option key={l.mailingListId} value={String(l.mailingListId)}>{l.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="eve-input flex-1 text-xs"
                      placeholder={TO_TYPE_LABELS[compose.toType]}
                      value={compose.to}
                      onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : c)}
                    />
                  )}
                </div>
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

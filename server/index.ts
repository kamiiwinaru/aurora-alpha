import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || undefined })
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const app = express()
const PORT = process.env.PORT || 3001

// In production Electron, serve the built frontend so API calls work on same origin
if (process.env.AURORA_DIST_PATH) {
  app.use(express.static(process.env.AURORA_DIST_PATH))
}

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'] }))
app.use(express.json({ limit: '10mb' }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Usage tracking ────────────────────────────────────────────────────────
// Accumulates token counts from every Anthropic API call this session.
// Cost based on claude-sonnet-4-6 pricing (per million tokens):
//   input $3, output $15, cache_write $3.75, cache_read $0.30
interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  calls: number
  startedAt: string
}
const usageTotals: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  calls: 0,
  startedAt: new Date().toISOString(),
}

function accumulateUsage(usage: {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}) {
  usageTotals.inputTokens        += usage.input_tokens ?? 0
  usageTotals.outputTokens       += usage.output_tokens ?? 0
  usageTotals.cacheWriteTokens   += usage.cache_creation_input_tokens ?? 0
  usageTotals.cacheReadTokens    += usage.cache_read_input_tokens ?? 0
  usageTotals.calls              += 1
}

function estimateCostUsd(u: UsageTotals): number {
  return (
    (u.inputTokens      / 1_000_000) * 3.00  +
    (u.outputTokens     / 1_000_000) * 15.00 +
    (u.cacheWriteTokens / 1_000_000) * 3.75  +
    (u.cacheReadTokens  / 1_000_000) * 0.30
  )
}

// ── Server-side asset cache ────────────────────────────────────────────────
// Keyed by characterId. Updated via POST /api/assets/sync after each ESI refresh.
// Haiku reads from here — assets never need to travel with every chat request.
interface AssetCacheEntry {
  assets: AssetEntry[]
  structureIds: number[]
  syncedAt: number
  characterName: string
}
const assetCache = new Map<number, AssetCacheEntry>()

// ── Server-side industry cache ────────────────────────────────────────────
interface IndustryJobEntry {
  jobId: number; activityName: string; blueprintTypeName: string
  runs: number; status: string; startDate: string; endDate: string
}
interface BlueprintEntry {
  typeName: string; isCopy: boolean
  materialEfficiency: number; timeEfficiency: number; runs: number
}
interface IndustryCacheEntry {
  jobs: IndustryJobEntry[]
  blueprints: BlueprintEntry[]
  syncedAt: number
  characterName: string
}
const industryCache = new Map<number, IndustryCacheEntry>()

async function executeIndustryQuery(query: string, characterId?: number): Promise<string> {
  const entry = characterId ? industryCache.get(characterId) : null
  if (!entry) return 'No industry data cached — ask the pilot to refresh their EVE data first.'

  const syncAge = Math.round((Date.now() - entry.syncedAt) / 60000)

  const jobLines = entry.jobs.length
    ? entry.jobs.map(j => {
        const done = new Date(j.endDate).getTime()
        const minsLeft = Math.ceil((done - Date.now()) / 60000)
        const timeStr = minsLeft <= 0 ? 'COMPLETE' : minsLeft < 60 ? `${minsLeft}m` : `${Math.floor(minsLeft/60)}h ${minsLeft%60}m`
        return `  ${j.blueprintTypeName} ×${j.runs} [${j.activityName}] — ${j.status.toUpperCase()} (${timeStr})`
      }).join('\n')
    : '  (none)'

  const bpoLines = entry.blueprints.filter(b => !b.isCopy).slice(0, 60)
    .map(b => `  ${b.typeName} ME${b.materialEfficiency}/TE${b.timeEfficiency}`).join('\n') || '  (none)'

  const bpcLines = entry.blueprints.filter(b => b.isCopy).slice(0, 30)
    .map(b => `  ${b.typeName} ×${b.runs}r ME${b.materialEfficiency}/TE${b.timeEfficiency}`).join('\n') || '  (none)'

  const context = [
    `Pilot: ${entry.characterName} | Data age: ${syncAge} min`,
    `\nACTIVE INDUSTRY JOBS:\n${jobLines}`,
    `\nBLUEPRINTS (BPOs):\n${bpoLines}`,
    `\nBLUEPRINTS (BPCs):\n${bpcLines}`,
  ].join('\n')

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: [
        'You are an industry analyst for an EVE Online capsuleer.',
        'Answer questions about their manufacturing jobs and blueprints accurately and concisely.',
        'Use K/M/B notation for large numbers. Skill levels are Roman numerals I–V.',
        'Respond in plain text — no markdown headers unless the answer is a list.',
        'Only report what is in the data below. Do not speculate.',
        '',
        'INDUSTRY DATA:',
        context,
      ].join('\n'),
      messages: [{ role: 'user', content: query }],
    })
    accumulateUsage(response.usage)
    return response.content[0].type === 'text' ? response.content[0].text : 'No result.'
  } catch (err) {
    console.error('Industry sub-agent error:', err)
    return `Industry query failed: ${err instanceof Error ? err.message : 'unknown error'}`
  }
}

// ── Server-side skills cache ──────────────────────────────────────────────
interface SkillEntry { skillId: number; skillName: string; trainedLevel: number; skillpointsInSkill: number }
interface SkillQueueEntry { skillName: string; finishedLevel: number; finishDate?: string }
interface AttributesEntry { intelligence: number; memory: number; perception: number; willpower: number; charisma: number }
interface SkillsCacheEntry {
  skills: SkillEntry[]
  queue: SkillQueueEntry[]
  attributes: AttributesEntry | null
  syncedAt: number
  characterName: string
}
const skillsCache = new Map<number, SkillsCacheEntry>()

async function executeSkillQuery(query: string, characterId?: number): Promise<string> {
  const entry = characterId ? skillsCache.get(characterId) : null
  if (!entry) return 'No skills data cached — ask the pilot to refresh their EVE data first.'

  const syncAge = Math.round((Date.now() - entry.syncedAt) / 60000)
  const totalSP = entry.skills.reduce((s, sk) => s + sk.skillpointsInSkill, 0)
  const atV = entry.skills.filter(s => s.trainedLevel === 5).length

  const top50 = [...entry.skills]
    .sort((a, b) => b.skillpointsInSkill - a.skillpointsInSkill)
    .slice(0, 50)
    .map(s => `  ${s.skillName} ${s.trainedLevel} (${Math.round(s.skillpointsInSkill / 1000)}k SP)`)
    .join('\n')

  const queueLines = entry.queue.slice(0, 15).map(q => {
    if (!q.finishDate) return `  ${q.skillName} → ${q.finishedLevel}`
    const ms = new Date(q.finishDate).getTime() - Date.now()
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000)
    const t = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
    return `  ${q.skillName} → ${q.finishedLevel} (${t})`
  }).join('\n') || '  (empty)'

  const attrLine = entry.attributes
    ? `Int ${entry.attributes.intelligence} | Mem ${entry.attributes.memory} | Per ${entry.attributes.perception} | Wil ${entry.attributes.willpower} | Cha ${entry.attributes.charisma}`
    : 'unknown'

  const context = [
    `Pilot: ${entry.characterName} | Data age: ${syncAge} min`,
    `Total SP: ${totalSP.toLocaleString()} | Skills at V: ${atV} | Known: ${entry.skills.length}`,
    `Attributes: ${attrLine}`,
    `\nSKILL QUEUE:\n${queueLines}`,
    `\nTOP 50 SKILLS BY SP:\n${top50}`,
  ].join('\n')

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: [
        'You are a skill planning advisor for an EVE Online capsuleer.',
        'Answer questions about their skills, training queue, and skill plans accurately and concisely.',
        'Training time estimates: SP/hour = 2700 × sqrt(primary_attribute + 0.5 × secondary_attribute).',
        'Respond in plain text. Be direct and tactical.',
        'Only report what is in the data below.',
        '',
        'SKILLS DATA:',
        context,
      ].join('\n'),
      messages: [{ role: 'user', content: query }],
    })
    accumulateUsage(response.usage)
    return response.content[0].type === 'text' ? response.content[0].text : 'No result.'
  } catch (err) {
    console.error('Skills sub-agent error:', err)
    return `Skills query failed: ${err instanceof Error ? err.message : 'unknown error'}`
  }
}

// ── Server-side mail cache ────────────────────────────────────────────────
interface MailCacheEntry {
  mails: Array<{
    mailId: number; subject: string; fromName: string; timestamp: string
    isRead: boolean; labelIds: number[]; body?: string
  }>
  syncedAt: number
}
const mailCache = new Map<number, MailCacheEntry>()

// ── Server-side contracts cache ───────────────────────────────────────────
interface ContractCacheEntry {
  contracts: Array<{
    contractId: number; type: string; status: string; title: string
    issuerName: string; assigneeName: string
    dateIssued: string; dateExpired: string; price: number; volume: number
    forCorporation: boolean; source?: 'character' | 'alliance'
  }>
  syncedAt: number
}
const contractCache = new Map<number, ContractCacheEntry>()

// ── ESI group name resolution (server-side, throttled) ────────────────────
// Resolves typeId→groupId→groupName via ESI. Runs server-side so there's no
// browser connection exhaustion. Results are cached for the server's lifetime.
const esiTypeGroupCache = new Map<number, number>()   // typeId → groupId
const esiGroupNameCache = new Map<number, string>()    // groupId → groupName

async function esiGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://esi.evetech.net/latest${path}`)
  if (!res.ok) throw new Error(`ESI ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

// Throttle: max 10 concurrent ESI requests from the server at once
let esiInFlight = 0
async function throttledEsiGet<T>(path: string): Promise<T> {
  while (esiInFlight >= 10) await new Promise(r => setTimeout(r, 50))
  esiInFlight++
  try { return await esiGet<T>(path) }
  finally { esiInFlight-- }
}

async function enrichAssetsWithGroups(assets: AssetEntry[]): Promise<void> {
  const unknownTypeIds = [...new Set(
    assets.filter(a => !esiTypeGroupCache.has(a.typeId ?? -1)).map(a => a.typeId).filter(Boolean) as number[]
  )]
  // Fetch group_id for each unknown type (throttled)
  await Promise.allSettled(unknownTypeIds.map(async typeId => {
    try {
      const info = await throttledEsiGet<{ group_id: number }>(`/universe/types/${typeId}/`)
      if (info.group_id) esiTypeGroupCache.set(typeId, info.group_id)
    } catch { /* skip */ }
  }))
  // Fetch group names for any group IDs we haven't seen
  const unknownGroupIds = [...new Set(
    [...esiTypeGroupCache.values()].filter(gid => !esiGroupNameCache.has(gid))
  )]
  await Promise.allSettled(unknownGroupIds.map(async groupId => {
    try {
      const info = await throttledEsiGet<{ name: string }>(`/universe/groups/${groupId}/`)
      if (info.name) esiGroupNameCache.set(groupId, info.name)
    } catch { /* skip */ }
  }))
  // Mutate assets in-place with group names
  for (const a of assets) {
    if (a.typeId === undefined) continue
    const groupId = esiTypeGroupCache.get(a.typeId)
    if (groupId !== undefined) a.groupName = esiGroupNameCache.get(groupId)
  }
}

// ── Asset sub-agent ────────────────────────────────────────────────────────
// Runs a focused Haiku instance with the full asset list as its only context.
// Aurora delegates any asset query here — keeps her main prompt lean.
interface AssetEntry {
  typeId?: number
  typeName: string
  groupName?: string
  quantity: number
  locationId?: number
  locationName: string
  isBlueprintCopy?: boolean
  // Blueprint-specific (only present when the item is a blueprint)
  materialEfficiency?: number
  timeEfficiency?: number
  runs?: number  // -1 = BPO, positive = BPC run count
}

// Approximate token count for context budget (1 token ≈ 4 chars)
const ASSET_CONTEXT_TOKEN_BUDGET = 12_000
const ASSET_CONTEXT_CHAR_BUDGET = ASSET_CONTEXT_TOKEN_BUDGET * 4

function buildAssetContext(assets: AssetEntry[]): string {
  const byLocation: Record<string, AssetEntry[]> = {}
  for (const a of assets) (byLocation[a.locationName] ??= []).push(a)

  // Sort locations by total quantity descending — largest stockpiles always appear first,
  // ensuring they're included even when the context has to be truncated.
  const sortedLocations = Object.entries(byLocation).sort(
    ([, a], [, b]) => b.reduce((s, i) => s + i.quantity, 0) - a.reduce((s, i) => s + i.quantity, 0)
  )

  const lines: string[] = []
  for (const [loc, items] of sortedLocations) {
    lines.push(`\n[${loc}]`)
    for (const i of items.sort((a, b) => b.quantity - a.quantity)) {
      let entry = `  ${i.typeName}`
      if (i.groupName) entry += ` [${i.groupName}]`
      if (i.materialEfficiency !== undefined) {
        const bpType = i.runs === -1 ? 'BPO' : `BPC ×${i.runs}`
        entry += ` (${bpType} ME${i.materialEfficiency} TE${i.timeEfficiency})`
      } else if (i.isBlueprintCopy) {
        entry += ' (BPC)'
      }
      entry += `: ${i.quantity.toLocaleString()}`
      lines.push(entry)
    }
  }

  const full = lines.join('\n')
  if (full.length <= ASSET_CONTEXT_CHAR_BUDGET) return full

  // Truncation: emit location summaries first (sorted largest first), then itemised
  // detail in the same order until the budget is exhausted.
  const summaryLines: string[] = ['[INVENTORY TOO LARGE — SHOWING LARGEST LOCATIONS FIRST]']
  for (const [loc, items] of sortedLocations) {
    const total = items.reduce((s, i) => s + i.quantity, 0)
    summaryLines.push(`  ${loc}: ${items.length} types, ${total.toLocaleString()} units total`)
  }
  summaryLines.push('\n[ITEMISED DETAIL — LARGEST LOCATIONS FIRST, MAY BE PARTIAL]')
  let chars = summaryLines.join('\n').length
  for (const line of lines) {
    if (chars + line.length > ASSET_CONTEXT_CHAR_BUDGET) break
    summaryLines.push(line)
    chars += line.length + 1
  }
  return summaryLines.join('\n')
}

async function executeAssetQuery(query: string, characterId?: number, fallbackAssets?: AssetEntry[]): Promise<string> {
  const assets = (characterId && assetCache.get(characterId)?.assets) || fallbackAssets || []
  if (!assets.length) return 'No asset data available — try refreshing EVE data first.'

  const cached = characterId ? assetCache.get(characterId) : null
  const syncAge = cached ? Math.round((Date.now() - cached.syncedAt) / 60000) : null

  // Substitute known structure names for any remaining numeric Location IDs
  const structureMap = getStructureMap()
  const resolvedAssets = structureMap.size === 0 ? assets : assets.map(a => {
    const locMatch = a.locationName.match(/(?:^|@ )Location (\d+)/)
    if (!locMatch) return a
    const id = Number(locMatch[1])
    const name = structureMap.get(id)
    if (!name) return a
    return { ...a, locationName: a.locationName.replace(`Location ${id}`, name) }
  })

  const assetContext = buildAssetContext(resolvedAssets)

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: [
        'You are an asset database for an EVE Online capsuleer.',
        'Answer queries about the pilot\'s inventory accurately and concisely.',
        'Use K/M/B notation for large numbers.',
        'For blueprints, always state ME/TE levels and whether it is a BPO or BPC.',
        'Respond in plain text — no markdown headers, no bullet lists unless listing items.',
        'IMPORTANT: Only report what is explicitly listed below. If an item or quantity is present in the inventory data, state it confidently. Do not speculate or claim uncertainty about data that is clearly listed.',
        'If the inventory is marked as partial, note which locations may be incomplete — but never fabricate uncertainty about data that is actually present.',
        syncAge !== null
          ? `Inventory last synced: ${syncAge} minute(s) ago. Total stacks: ${assets.length}.`
          : '',
        '',
        'ASSET INVENTORY:',
        assetContext,
      ].filter(Boolean).join('\n'),
      messages: [{ role: 'user', content: query }],
    })
    accumulateUsage(response.usage)
    return response.content[0].type === 'text' ? response.content[0].text : 'Query returned no results.'
  } catch (err) {
    console.error('Asset sub-agent error:', err)
    return `Asset query failed: ${err instanceof Error ? err.message : 'unknown error'}`
  }
}

// ── Todo list storage ─────────────────────────────────────────────────────
// ── Structure name database ────────────────────────────────────────────────
// Persisted map of structureId → name. Populated by the client when it
// successfully resolves a structure name (needs esi-universe.read_structures.v1),
// or manually via POST /api/structures. Used to substitute readable names into
// the Haiku asset context in place of raw numeric location IDs.
interface StructureEntry { id: number; name: string; registeredAt: string }

const STRUCTURES_FILE = join(process.cwd(), 'structures.json')

function loadStructures(): StructureEntry[] {
  try {
    return existsSync(STRUCTURES_FILE) ? JSON.parse(readFileSync(STRUCTURES_FILE, 'utf8')) : []
  } catch { return [] }
}

function saveStructures(entries: StructureEntry[]) {
  writeFileSync(STRUCTURES_FILE, JSON.stringify(entries, null, 2), 'utf8')
  // Invalidate in-memory cache after write
  structureMapCache = null
}

// In-memory cache — rebuilt from disk only when null (on startup or after a write)
let structureMapCache: Map<number, string> | null = null

function getStructureMap(): Map<number, string> {
  if (!structureMapCache) {
    structureMapCache = new Map(loadStructures().map(e => [e.id, e.name]))
  }
  return structureMapCache
}

app.get('/api/structures', (_req, res) => res.json(loadStructures()))

app.post('/api/structures', (req, res) => {
  const entries = req.body as Array<{ id: number; name: string }>
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'array of {id, name} required' })
  const existing = loadStructures()
  const existingMap = new Map(existing.map(e => [e.id, e]))
  for (const { id, name } of entries) {
    if (!id || !name?.trim()) continue
    existingMap.set(id, { id, name: name.trim(), registeredAt: new Date().toISOString() })
  }
  const updated = [...existingMap.values()]
  saveStructures(updated)
  return res.json({ ok: true, count: updated.length })
})

app.delete('/api/structures/:id', (req, res) => {
  const id = Number(req.params.id)
  const filtered = loadStructures().filter(e => e.id !== id)
  saveStructures(filtered)
  return res.json({ ok: true })
})

interface TodoItem { id: string; text: string; done: boolean; createdAt: string }

const TODO_FILE = join(process.cwd(), 'todos.json')

function loadTodos(): TodoItem[] {
  try {
    return existsSync(TODO_FILE) ? JSON.parse(readFileSync(TODO_FILE, 'utf8')) : []
  } catch { return [] }
}

function saveTodos(todos: TodoItem[]) {
  writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2), 'utf8')
}

app.get('/api/todos', (_req, res) => res.json(loadTodos()))

app.post('/api/todos', (req, res) => {
  const { text } = req.body as { text: string }
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })
  const todos = loadTodos()
  const item: TodoItem = { id: crypto.randomUUID(), text: text.trim(), done: false, createdAt: new Date().toISOString() }
  todos.push(item)
  saveTodos(todos)
  return res.json(item)
})

app.patch('/api/todos/:id', (req, res) => {
  const todos = loadTodos()
  const idx = todos.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'not found' })
  todos[idx] = { ...todos[idx], ...req.body as Partial<TodoItem> }
  saveTodos(todos)
  return res.json(todos[idx])
})

app.delete('/api/todos/:id', (req, res) => {
  const todos = loadTodos()
  const filtered = todos.filter(t => t.id !== req.params.id)
  saveTodos(filtered)
  return res.json({ ok: true })
})

// ── Roadmap storage ───────────────────────────────────────────────────────
type RoadmapStatus = 'planned' | 'consideration' | 'in-progress' | 'done'
type RoadmapCategory = 'Bug Fixes' | 'Auth & Accounts' | 'Intel Tool' | 'Aurora AI' | 'EVE Data' | 'Infrastructure' | 'General'

interface RoadmapItem {
  id: string
  title: string
  status: RoadmapStatus
  category: RoadmapCategory
  description: string
  notes?: string[]
}

const ROADMAP_FILE = join(process.cwd(), 'roadmap.json')

const ROADMAP_DEFAULT: RoadmapItem[] = [
  { id: 'aurora-landing-listen-bug', title: 'Aurora Landing Screen — Voice Input Bug', status: 'planned', category: 'Bug Fixes', description: 'On the landing screen, Aurora glows gold when listening but shows no visual feedback for an incoming query and never dispatches it.', notes: ['Orb glow triggers correctly — mic activation works', 'Query text does not appear / interim transcript not surfacing to UI', 'Final transcript never sent — investigate submit path from landing screen vs. main chat'] },
  { id: 'intel-audio-fix', title: 'Intel Tool — Audio Alert Bug Fix', status: 'planned', category: 'Bug Fixes', description: 'Audio alerts do not fire when intel is reported within 5 jumps in live use, despite working correctly in isolated tests.', notes: ['Works in test environment — likely a timing or state-sync issue in production flow', 'Investigate alert trigger path when intel arrives through the live parser'] },
  { id: 'persistent-auth', title: 'Persistent ESI Sessions', status: 'planned', category: 'Auth & Accounts', description: 'Keep characters logged in across app restarts by persisting and auto-refreshing ESI refresh tokens.', notes: ['Store refresh token securely (electron-store / keychain, not localStorage)', 'Silent re-auth on launch using refresh token before expiry', 'Surface re-login prompt only when refresh token is revoked or expired'] },
  { id: 'multi-account', title: 'Multi-Account ESI Login', status: 'planned', category: 'Auth & Accounts', description: 'Support adding and switching between multiple EVE characters/accounts, each with their own ESI auth token.', notes: ['Store tokens per character — keyed by character ID', 'Account switcher UI in header or sidebar', 'Scope sets may differ per character — handle gracefully'] },
  { id: 'intel-auto-location', title: 'Auto-Detect Player Location', status: 'planned', category: 'Intel Tool', description: "Automatically pull the pilot's current system from ESI so the Intel tool can calculate jump range without manual input.", notes: ['ESI scope: esi-location.read_location.v1', 'Poll or use a refresh trigger to keep location current'] },
  { id: 'rift-intel', title: 'RIFT Intel Integration', status: 'planned', category: 'Intel Tool', description: 'Pull live intel data from RIFT into Aurora — hostile activity, system status, and threat assessments visible alongside other panels.', notes: ['Requires RIFT API key / feed configuration', 'Display in dedicated Intel panel or overlay on existing views'] },
  { id: 'aurora-voice', title: "Aurora's Voice — ElevenLabs Integration", status: 'planned', category: 'Aurora AI', description: 'Give Aurora a voice using ElevenLabs TTS. Select a voice that fits Aurora\'s character, wire it into alert and notification events.', notes: ['Audition ElevenLabs voice library — open to suggestions for best fit', 'Start with Intel alerts, expand to other spoken notifications', 'ElevenLabs API key required; consider streaming vs. pre-generated clips'] },
  { id: 'aurora-self-aware', title: 'Aurora × Claude Code — Self-Modifying Agent', status: 'consideration', category: 'Aurora AI', description: 'Explore giving Aurora access to her own codebase via the Claude Code SDK so she can read, reason about, and potentially modify herself.', notes: ["Claude Code SDK / agent loop would need to be embedded or sidecar'd", 'Significant safety and scope concerns — sandboxing required', 'Likely a research spike first: can Aurora answer "how do you work?" accurately?', 'Probably unlikely in full form — log as aspirational / long-term exploration'] },
  { id: 'wallet', title: 'Wallet & Transaction History', status: 'planned', category: 'EVE Data', description: 'Full wallet journal and transaction history pulled from ESI. Filter by type, date range, and counterparty.', notes: ['ESI scopes: esi-wallet.read_character_wallet.v1', 'Chart ISK flow over time', 'Export to CSV'] },
  { id: 'freight-calc', title: 'Alliance Freight Calculator', status: 'planned', category: 'EVE Data', description: 'Calculate freight costs for alliance logistics routes. Input items/volume, select route, get collateral and cost breakdown.', notes: ['Alliance contract rates and route configuration', 'Integration with item appraisal for collateral auto-calc'] },
  { id: 'contracts', title: 'Contract Browsing', status: 'consideration', category: 'EVE Data', description: 'Browse and search personal, corporation, and public contracts. Filter by type, location, and status.', notes: ['ESI scopes: esi-contracts.read_character_contracts.v1', 'Scope of public contract search TBD'] },
  { id: 'fitting-sim', title: 'Fitting Simulator', status: 'consideration', category: 'EVE Data', description: 'Build and evaluate ship fittings inline. Apply pilot skill modifiers, calculate DPS, tank, and capacitor values.', notes: ['Significant scope — may integrate with Pyfa API or similar', 'Requires full static data export (SDE) for attributes'] },
  { id: 'lan-server', title: 'LAN Server Deployment', status: 'consideration', category: 'Infrastructure', description: 'Explore moving Aurora off the local desktop and onto a dedicated server machine, accessible from any device on the LAN via a URL.', notes: ['Would require separating frontend (browser) from backend (ESI auth, AI calls, intel parser)', 'ESI OAuth redirect_uri must match — local network URL needs to be registered or proxied', 'Voice input/output may need browser mic permissions over LAN (HTTPS or localhost exception)', 'Investigate: Electron → web app conversion, or just expose the dev server securely'] },
]

function loadRoadmap(): RoadmapItem[] {
  try {
    return existsSync(ROADMAP_FILE) ? JSON.parse(readFileSync(ROADMAP_FILE, 'utf8')) : ROADMAP_DEFAULT
  } catch { return ROADMAP_DEFAULT }
}

function saveRoadmap(items: RoadmapItem[]) {
  writeFileSync(ROADMAP_FILE, JSON.stringify(items, null, 2), 'utf8')
}

// Seed the file on first run
if (!existsSync(ROADMAP_FILE)) saveRoadmap(ROADMAP_DEFAULT)

app.get('/api/roadmap', (_req, res) => res.json(loadRoadmap()))

app.post('/api/roadmap', (req, res) => {
  const { title, status = 'planned', category = 'General', description = '', notes } = req.body as Partial<RoadmapItem>
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })
  const items = loadRoadmap()
  const item: RoadmapItem = { id: crypto.randomUUID(), title: title.trim(), status: status as RoadmapStatus, category: category as RoadmapCategory, description, notes }
  items.push(item)
  saveRoadmap(items)
  return res.json(item)
})

app.patch('/api/roadmap/:id', (req, res) => {
  const items = loadRoadmap()
  const idx = items.findIndex(i => i.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'not found' })
  items[idx] = { ...items[idx], ...req.body as Partial<RoadmapItem> }
  saveRoadmap(items)
  return res.json(items[idx])
})

app.delete('/api/roadmap/:id', (req, res) => {
  const items = loadRoadmap()
  saveRoadmap(items.filter(i => i.id !== req.params.id))
  return res.json({ ok: true })
})

// ── Star map data + route planner ────────────────────────────────────────────
interface MapSystem { id: number; n: string; x: number; z: number; s: number; r: string; c: number[] }
interface MapPayload { sc?: number; v?: MapSystem[] }

let _mapSystems: MapSystem[] = []
let _mapSysById = new Map<number, MapSystem>()
let _mapSysByName = new Map<string, MapSystem>()
let _mapLyPerUnit = 0

function ensureMapLoaded() {
  if (_mapSystems.length > 0) return
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'public', 'eve-systems.json'), 'utf8')) as MapPayload | MapSystem[]
    const arr  = Array.isArray(raw) ? raw : (raw.v ?? [])
    const scM  = Array.isArray(raw) ? 0   : (raw.sc ?? 0)
    _mapLyPerUnit = scM > 0 ? scM / 2 / 9.461e15 : 0
    _mapSystems = arr
    _mapSysById  = new Map(arr.map(s => [s.id, s]))
    _mapSysByName = new Map(arr.map(s => [s.n.toLowerCase(), s]))
  } catch { /* file not built yet — tools will return a helpful error */ }
}

function mapRoute(
  originId: number, destId: number,
  flag: 'shortest' | 'secure' | 'insecure',
  avoidIds: number[],
  bridges: Array<{ fromId: number; toId: number }>
): number[] | null {
  if (!_mapSysById.size) return null
  const avoid = new Set(avoidIds)
  if (avoid.has(originId) || avoid.has(destId)) return null

  const edgeCost = (toSec: number) =>
    flag === 'shortest' ? 1 : flag === 'secure' ? (toSec < 0.45 ? 100_000 : 1) : (toSec >= 0.45 ? 100_000 : 1)

  type E = [number, number]
  const heap: E[] = []
  const push = (e: E) => {
    heap.push(e); let i = heap.length - 1
    while (i > 0) { const p = (i-1)>>1; if (heap[p][0] <= heap[i][0]) break; [heap[p],heap[i]]=[heap[i],heap[p]]; i=p }
  }
  const pop = (): E => {
    const top = heap[0], last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last; let i = 0
      while (true) {
        let s=i,l=2*i+1,r=2*i+2
        if (l<heap.length&&heap[l][0]<heap[s][0]) s=l
        if (r<heap.length&&heap[r][0]<heap[s][0]) s=r
        if (s===i) break; [heap[i],heap[s]]=[heap[s],heap[i]]; i=s
      }
    }
    return top
  }

  const dist = new Map<number,number>(), prev = new Map<number,number>()
  dist.set(originId, 0); push([0, originId])

  while (heap.length > 0) {
    const [d, id] = pop()
    if (d > (dist.get(id) ?? Infinity)) continue
    if (id === destId) break
    const s = _mapSysById.get(id); if (!s) continue
    for (const toId of s.c) {
      if (avoid.has(toId)) continue
      const t = _mapSysById.get(toId); if (!t) continue
      const nd = d + edgeCost(t.s)
      if (nd < (dist.get(toId) ?? Infinity)) { dist.set(toId, nd); prev.set(toId, id); push([nd, toId]) }
    }
    for (const br of bridges) {
      const otherId = br.fromId === id ? br.toId : br.toId === id ? br.fromId : -1
      if (otherId === -1 || avoid.has(otherId)) continue
      const t = _mapSysById.get(otherId); if (!t) continue
      const nd = d + edgeCost(t.s)
      if (nd < (dist.get(otherId) ?? Infinity)) { dist.set(otherId, nd); prev.set(otherId, id); push([nd, otherId]) }
    }
  }

  if (!dist.has(destId)) return null
  const path: number[] = []; let cur: number | undefined = destId
  while (cur !== undefined) { path.unshift(cur); if (cur === originId) break; cur = prev.get(cur) }
  return path[0] === originId ? path : null
}

// ── Market tool definitions ────────────────────────────────────────────────
const MARKET_TOOLS: Anthropic.Tool[] = [
  {
    name: 'appraise_items',
    description: 'Get current market buy/sell/split prices for one or more EVE Online items from the Janice appraisal API. Use this whenever the user asks about prices, appraisals, or item values. Input should be a newline-separated list of items with optional quantities (e.g. "Tritanium 100000\\nMegacyte 500").',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: { type: 'string', description: 'Newline-separated list of item names with optional quantities' },
        market: { type: 'string', enum: ['Jita', 'Amarr', 'Dodixie', 'Rens', 'Hek'], description: 'Market hub (default: Jita)' },
      },
      required: ['items'],
    },
  },
  {
    name: 'get_price_history',
    description: 'Get historical daily price data for an EVE Online item. Returns average, highest, and lowest prices per day for the requested range. Use after appraise_items when the user asks for history or trends.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type_id: { type: 'number', description: 'EVE type ID of the item (obtained from appraise_items)' },
        item_name: { type: 'string', description: 'Human-readable name for context' },
        days: { type: 'number', description: 'Number of days of history to return (1-90, default 30)' },
        market: { type: 'string', enum: ['Jita', 'Amarr', 'Dodixie', 'Rens', 'Hek'], description: 'Market hub (default: Jita)' },
      },
      required: ['type_id', 'item_name'],
    },
  },
  {
    name: 'query_assets',
    description: 'Query the pilot\'s full asset inventory. Use this for ANY question about what the pilot owns: item counts, locations, ships, materials, blueprints, or whether a specific item exists anywhere. Do NOT try to answer asset questions from memory — always call this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language question about the pilot\'s assets, e.g. "how much Tritanium do I have?", "list all ships", "do I have any Raven blueprints?"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_industry',
    description: 'Query the pilot\'s industry jobs and blueprints. Use for ANY question about manufacturing, production jobs, blueprint efficiency, what is currently being built, job completion times, or build planning. Handled by a local Hermes sub-agent — do NOT try to answer industry questions from memory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language question about industry, e.g. "what jobs are active?", "which BPOs do I have for cruisers?", "when does my Raven job finish?"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_skills',
    description: 'Query the pilot\'s skills, training queue, and skill planning. Use for ANY question about trained skills, skill levels, what is in the queue, training time estimates, or skill recommendations. Handled by a local Hermes sub-agent — do NOT try to answer skill questions from memory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language question about skills, e.g. "what level is my Caldari Cruiser?", "how long until my queue finishes?", "what skills do I need for a Tengu?"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'plan_route',
    description: 'Calculate the optimal route between two EVE Online solar systems. Use whenever the pilot asks to plan a route, get directions, or asks how to travel between systems. Always pass any known jump bridges so the route accounts for them. Returns the full hop list, jump count, route light-years, and direct jump distance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin:      { type: 'string', description: 'Name of the origin solar system (e.g. "HY-RWO")' },
        destination: { type: 'string', description: 'Name of the destination solar system (e.g. "G-7WUF")' },
        flag: { type: 'string', enum: ['shortest', 'secure', 'insecure'], description: 'Routing preference (default: shortest)' },
        avoid: { type: 'array', items: { type: 'string' }, description: 'System names to exclude from the route' },
        bridges: {
          type: 'array',
          description: 'Jump bridges available for this pilot — pass all bridges from context so the route can use them',
          items: {
            type: 'object',
            properties: { from: { type: 'string' }, to: { type: 'string' } },
            required: ['from', 'to'],
          },
        },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'roadmap_list',
    description: 'Read the Aurora development roadmap — all planned, in-progress, consideration, and completed items grouped by category. Use this when the pilot asks what features are planned, what\'s being worked on, the status of a feature, or anything about Aurora\'s roadmap.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'roadmap_add',
    description: 'Add a new item to the Aurora development roadmap. Use when the pilot requests a feature, reports a bug, or suggests an improvement.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short title for the roadmap item' },
        description: { type: 'string', description: 'Detailed description of the feature or bug' },
        status: { type: 'string', enum: ['planned', 'consideration', 'in-progress', 'done'], description: 'Initial status (default: planned)' },
        category: { type: 'string', enum: ['Bug Fixes', 'Auth & Accounts', 'Intel Tool', 'Aurora AI', 'EVE Data', 'Infrastructure', 'General'], description: 'Category for the item' },
        notes: { type: 'array', items: { type: 'string' }, description: 'Optional bullet-point notes or sub-tasks' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'roadmap_update',
    description: 'Update the status or details of an existing roadmap item. Call roadmap_list first to get item IDs. Use this to mark items as in-progress or done, add notes, or revise descriptions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'ID of the roadmap item to update' },
        status: { type: 'string', enum: ['planned', 'consideration', 'in-progress', 'done'] },
        title: { type: 'string' },
        description: { type: 'string' },
        notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_add',
    description: 'Add one or more tasks to the pilot\'s to-do list. Use this whenever the pilot asks to remember something, add a task, or keep a note. You can add multiple items at once.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: { type: 'array', items: { type: 'string' }, description: 'List of task descriptions to add' },
      },
      required: ['items'],
    },
  },
  {
    name: 'todo_list',
    description: 'Retrieve the pilot\'s current to-do list. Use this when the pilot asks what\'s on their list, wants to check tasks, or before adding items to avoid duplicates.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'todo_complete',
    description: 'Mark one or more to-do items as done by their ID. Call todo_list first to get item IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'IDs of items to mark as done' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'todo_remove',
    description: 'Delete one or more to-do items by their ID. Call todo_list first to get item IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'IDs of items to remove' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'get_mail',
    description: 'Retrieve the pilot\'s EVE mail. Use this whenever the pilot asks about their messages, unread mail, what someone sent them, or anything about their inbox. Can filter by read status or search subject/sender. Returns subject, sender, timestamp, and body if available.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'string', enum: ['all', 'unread', 'read'], description: 'Which messages to return (default: unread)' },
        search: { type: 'string', description: 'Optional text to search within subject or sender name' },
        limit: { type: 'number', description: 'Max messages to return (default 20, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'calculate_blueprint',
    description: 'Calculate manufacturing requirements for any EVE blueprint. Use this whenever the pilot asks about building/manufacturing something, how many materials are needed, how long it takes to build, or wants a production breakdown. Automatically checks if the pilot owns the blueprint and uses their actual ME/TE if so. You know the pilot\'s Industry and Advanced Industry skill levels from the system context — pass them as industry_level and adv_industry_level.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blueprint_name: { type: 'string', description: 'Name of the item or blueprint, e.g. "Rifter", "Raven", "Tritanium" — do NOT include "Blueprint" suffix, the tool handles that' },
        runs: { type: 'number', description: 'Number of production runs (default 1)' },
        me: { type: 'number', description: 'Material Efficiency level 0-10 (default 0, or auto-filled from owned blueprint)' },
        te: { type: 'number', description: 'Time Efficiency level 0-20 (default 0, or auto-filled from owned blueprint)' },
        structure: { type: 'string', enum: ['station', 'raitaru', 'azbel', 'sotiyo'], description: 'Manufacturing structure (default: station)' },
        rig: { type: 'string', enum: ['none', 't1', 't2'], description: 'Industry rig installed (default: none)' },
        security: { type: 'string', enum: ['high', 'low', 'null'], description: 'System security band for rig scaling (default: null)' },
        industry_level: { type: 'number', description: 'Pilot\'s Industry skill level 0-5 — check system context for this' },
        adv_industry_level: { type: 'number', description: 'Pilot\'s Advanced Industry skill level 0-5 — check system context for this' },
      },
      required: ['blueprint_name'],
    },
  },
  {
    name: 'get_contracts',
    description: 'Retrieve the pilot\'s EVE contracts. Use this when the pilot asks about contracts, deals, trades, courier jobs, outstanding offers, or anything contract-related. Can filter by status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'string', enum: ['all', 'outstanding', 'in_progress', 'finished', 'failed', 'attention'], description: 'Which contracts to return — "attention" returns outstanding + expired (default: all)' },
        limit: { type: 'number', description: 'Max contracts to return (default 20, max 50)' },
      },
      required: [],
    },
  },
]

// ── Manufacturing bonus lookup tables ─────────────────────────────────────
// Source: https://www.eveonline.com/news/view/building-dreams-introducing-engineering-complexes
const STRUCTURE_BONUSES: Record<string, { me: number; te: number }> = {
  station: { me: 0,  te: 0  },
  raitaru: { me: 1,  te: 15 },
  azbel:   { me: 1,  te: 20 },
  sotiyo:  { me: 1,  te: 30 },
  // Reaction structures — no ME bonus, TE only
  athanor: { me: 0,  te: 15 },
  tatara:  { me: 0,  te: 25 },
}
// Rig bonuses by [rig][security] — T1/T2 M-Set Manufacturing Efficiency / Process Efficiency
const RIG_BONUSES: Record<string, Record<string, { me: number; te: number }>> = {
  none:          { high: { me: 0, te: 0    }, low: { me: 0,    te: 0    }, null: { me: 0,    te: 0    } },
  t1:            { high: { me: 2, te: 20   }, low: { me: 3.8,  te: 38   }, null: { me: 4.2,  te: 42   } },
  t2:            { high: { me: 2.4, te: 24 }, low: { me: 4.56, te: 45.6 }, null: { me: 5.04, te: 50.4 } },
  // Reaction rigs — M-Set Biochemical Reactor Efficiency (no ME component)
  t1_reaction:   { high: { me: 0, te: 20   }, low: { me: 0,    te: 38   }, null: { me: 0,    te: 42   } },
  t2_reaction:   { high: { me: 0, te: 24   }, low: { me: 0,    te: 45.6 }, null: { me: 0,    te: 50.4 } },
}

// ── Blueprint chain resolution ────────────────────────────────────────────
// Persistent cache: product typeId → blueprint info (survives request lifetime)
const bpByProductCache = new Map<number, { bpTypeId: number; activity: 'manufacturing' | 'reaction' } | null>()

async function findBpForProduct(productTypeId: number, productName: string): Promise<{ bpTypeId: number; activity: 'manufacturing' | 'reaction' } | null> {
  if (bpByProductCache.has(productTypeId)) return bpByProductCache.get(productTypeId)!
  const attempts: Array<[string, 'manufacturing' | 'reaction']> = [
    [`${productName} Blueprint`, 'manufacturing'],
    [`${productName} Reaction Formula`, 'reaction'],
  ]
  for (const [bpName, activity] of attempts) {
    try {
      const r = await fetch(`https://www.fuzzwork.co.uk/api/typeid2.php?typename=${encodeURIComponent(bpName)}`)
      if (!r.ok) continue
      const d = await r.json() as Array<{ typeID: number; typeName: string }> | { typeID: number; typeName: string }
      const arr = Array.isArray(d) ? d : [d]
      const hit = arr.find(m => m.typeID > 0 && (m.typeName ?? '').toLowerCase() === bpName.toLowerCase())
      if (hit) {
        const result = { bpTypeId: hit.typeID, activity }
        bpByProductCache.set(productTypeId, result)
        return result
      }
    } catch { /* skip */ }
  }
  bpByProductCache.set(productTypeId, null)
  return null
}

export interface ChainNode {
  typeId: number
  name: string
  qtyNeeded: number   // total quantity needed by parent
  qtyPerRun: number   // how many this bp produces per run
  runsNeeded: number  // ceil(qtyNeeded / qtyPerRun)
  activity: 'manufacturing' | 'reaction' | 'raw'
  bpTypeId?: number
  timePerRun: number  // seconds
  materials: ChainNode[]
}

async function resolveChainNode(
  typeId: number,
  name: string,
  qtyNeeded: number,
  depth: number,
  nameCache: Map<number, string>,
  includeReactions: boolean
): Promise<ChainNode> {
  const rawNode: ChainNode = { typeId, name, qtyNeeded, qtyPerRun: 1, runsNeeded: qtyNeeded, activity: 'raw', timePerRun: 0, materials: [] }
  if (depth >= 6) return rawNode

  const bpInfo = await findBpForProduct(typeId, name)
  if (!bpInfo) return rawNode
  if (bpInfo.activity === 'reaction' && !includeReactions) return rawNode

  try {
    const bpRes = await fetch(`https://ref-data.everef.net/blueprints/${bpInfo.bpTypeId}`)
    if (!bpRes.ok) return rawNode
    const bp = await bpRes.json() as {
      activities?: {
        manufacturing?: { materials?: Record<string, { type_id: number; quantity: number }>; products?: Record<string, { type_id: number; quantity: number }>; time?: number }
        reaction?:      { materials?: Record<string, { type_id: number; quantity: number }>; products?: Record<string, { type_id: number; quantity: number }>; time?: number }
      }
    }
    const act = bpInfo.activity === 'reaction' ? bp.activities?.reaction : bp.activities?.manufacturing
    if (!act) return rawNode

    const rawMats  = Object.values(act.materials ?? {})
    const product  = Object.values(act.products ?? {})[0]
    const qtyPerRun = product?.quantity ?? 1
    const runsNeeded = Math.ceil(qtyNeeded / qtyPerRun)
    const timePerRun = act.time ?? 0

    if (rawMats.length === 0) return rawNode

    // Batch-resolve any unknown names
    const unknownIds = rawMats.map(m => m.type_id).filter(id => !nameCache.has(id))
    if (unknownIds.length > 0) {
      try {
        const nr = await fetch('https://esi.evetech.net/latest/universe/names/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(unknownIds),
        })
        if (nr.ok) {
          const names = await nr.json() as Array<{ id: number; name: string }>
          for (const n of names) nameCache.set(n.id, n.name)
        }
      } catch { /* ignore name failures */ }
    }

    // Recurse in parallel
    const children = await Promise.all(rawMats.map(m =>
      resolveChainNode(m.type_id, nameCache.get(m.type_id) ?? `Type ${m.type_id}`,
        m.quantity * runsNeeded, depth + 1, nameCache, includeReactions)
    ))

    return { typeId, name, qtyNeeded, qtyPerRun, runsNeeded, activity: bpInfo.activity, bpTypeId: bpInfo.bpTypeId, timePerRun, materials: children }
  } catch { return rawNode }
}

// ── Blueprint chain endpoint ───────────────────────────────────────────────
app.get('/api/industry/blueprint/chain', async (req, res) => {
  const typeId          = Number(req.query.typeId)
  const me              = Math.min(10, Math.max(0, Number(req.query.me ?? 0)))
  const runs            = Math.max(1, Number(req.query.runs ?? 1))
  const includeReactions = req.query.includeReactions === 'true'
  const characterId     = req.query.characterId ? Number(req.query.characterId) : undefined

  if (!typeId) return res.status(400).json({ error: 'typeId required' })

  try {
    const bpRes = await fetch(`https://ref-data.everef.net/blueprints/${typeId}`)
    if (!bpRes.ok) return res.status(404).json({ error: 'Blueprint not found' })
    const bp = await bpRes.json() as {
      activities?: {
        manufacturing?: {
          materials?: Record<string, { type_id: number; quantity: number }>
          products?:  Record<string, { type_id: number; quantity: number }>
          time?: number
        }
      }
    }
    const mfg = bp.activities?.manufacturing
    if (!mfg) return res.status(404).json({ error: 'No manufacturing activity' })

    const rawMats = Object.values(mfg.materials ?? {})
    const product = Object.values(mfg.products ?? {})[0]

    // Resolve all top-level names in one batch
    const allIds = [...new Set([...rawMats.map(m => m.type_id), ...(product ? [product.type_id] : [])])]
    const nameCache = new Map<number, string>()
    if (allIds.length > 0) {
      const nr = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allIds),
      })
      if (nr.ok) {
        const names = await nr.json() as Array<{ id: number; name: string }>
        for (const n of names) nameCache.set(n.id, n.name)
      }
    }

    // ME-adjusted quantities for top-level materials
    const meFactor = 1 - me / 100

    // Resolve the full chain for each top-level material in parallel
    const chain = await Promise.all(rawMats.map(m => {
      const adjQty = Math.max(runs, Math.ceil(m.quantity * runs * meFactor))
      return resolveChainNode(m.type_id, nameCache.get(m.type_id) ?? `Type ${m.type_id}`,
        adjQty, 0, nameCache, includeReactions)
    }))

    // Build total raw-material buy list
    const buyMap = new Map<number, { name: string; qty: number }>()
    function collectRaw(node: ChainNode) {
      if (node.activity === 'raw') {
        const e = buyMap.get(node.typeId)
        if (e) e.qty += node.qtyNeeded
        else buyMap.set(node.typeId, { name: node.name, qty: node.qtyNeeded })
        return
      }
      for (const c of node.materials) collectRaw(c)
    }
    for (const n of chain) collectRaw(n)

    // Asset quantities
    const assets = characterId ? (assetCache.get(characterId)?.assets ?? []) : []
    const assetQty: Record<number, number> = {}
    for (const a of assets) if (a.typeId) assetQty[a.typeId] = (assetQty[a.typeId] ?? 0) + a.quantity

    return res.json({
      typeId,
      productName: product ? (nameCache.get(product.type_id) ?? 'Unknown') : '',
      productTypeId: product?.type_id ?? null,
      productQty: (product?.quantity ?? 1) * runs,
      runs,
      chain,
      buyList: [...buyMap.entries()].map(([id, v]) => ({ typeId: id, name: v.name, qty: v.qty, have: assetQty[id] ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
})

async function executeMarketTool(name: string, input: Record<string, unknown>, characterId?: number, fallbackAssets?: AssetEntry[]): Promise<unknown> {
  if (name === 'plan_route') {
    ensureMapLoaded()
    if (_mapSystems.length === 0) return { error: 'Star map data not loaded — run `node scripts/build-map-data.mjs` first.' }

    const originName = String(input.origin ?? '').trim()
    const destName   = String(input.destination ?? '').trim()
    const flag = (String(input.flag ?? 'shortest')) as 'shortest' | 'secure' | 'insecure'
    const avoidNames: string[] = Array.isArray(input.avoid) ? (input.avoid as string[]) : []
    const bridgeInput: Array<{ from: string; to: string }> =
      Array.isArray(input.bridges) ? (input.bridges as Array<{ from: string; to: string }>) : []

    const orig = _mapSysByName.get(originName.toLowerCase())
    const dest = _mapSysByName.get(destName.toLowerCase())
    if (!orig) return { error: `Unknown system: "${originName}"` }
    if (!dest) return { error: `Unknown system: "${destName}"` }

    const avoidIds = avoidNames.map(n => _mapSysByName.get(n.toLowerCase())?.id).filter((id): id is number => id !== undefined)

    // Resolve bridge system names → IDs
    const bridges = bridgeInput
      .map(b => {
        const f = _mapSysByName.get(b.from.toLowerCase())
        const t = _mapSysByName.get(b.to.toLowerCase())
        return f && t ? { fromId: f.id, toId: t.id } : null
      })
      .filter((b): b is { fromId: number; toId: number } => b !== null)

    const routeIds = mapRoute(orig.id, dest.id, flag, avoidIds, bridges)
    if (!routeIds) return { error: `No ${flag} route found from ${originName} to ${destName}.` }

    const fmt = (ly: number) => ly >= 10 ? `${ly.toFixed(1)} LY` : `${ly.toFixed(2)} LY`
    const bridgeSet = new Set(bridges.flatMap(b => [`${b.fromId}-${b.toId}`, `${b.toId}-${b.fromId}`]))

    // Build hop list with names + bridge annotations
    const hops = routeIds.map((id, i) => {
      const s = _mapSysById.get(id)!
      const isBridgeHop = i > 0 && bridgeSet.has(`${routeIds[i-1]}-${id}`)
      return { system: s.n, region: s.r, sec: s.s, isBridgeHop }
    })

    // Total route LY (sum of hops)
    let totalLY = 0
    if (_mapLyPerUnit > 0) {
      for (let i = 1; i < routeIds.length; i++) {
        const a = _mapSysById.get(routeIds[i-1])!, b = _mapSysById.get(routeIds[i])!
        totalLY += Math.hypot(b.x - a.x, b.z - a.z) * _mapLyPerUnit
      }
    }

    // Direct cyno jump distance
    const directLY = _mapLyPerUnit > 0
      ? Math.hypot(dest.x - orig.x, dest.z - orig.z) * _mapLyPerUnit
      : null

    return {
      origin: orig.n, destination: dest.n, flag,
      jumps: routeIds.length - 1,
      routeLY: _mapLyPerUnit > 0 ? fmt(totalLY) : null,
      directJumpLY: directLY !== null ? fmt(directLY) : null,
      bridgesUsed: bridges.filter(b => {
        for (let i = 1; i < routeIds.length; i++) {
          if ((routeIds[i-1] === b.fromId && routeIds[i] === b.toId) ||
              (routeIds[i-1] === b.toId   && routeIds[i] === b.fromId)) return true
        }
        return false
      }).map(b => `${_mapSysById.get(b.fromId)?.n} ↔ ${_mapSysById.get(b.toId)?.n}`),
      route: hops,
    }
  }

  if (name === 'query_assets') {
    const query = String(input.query ?? '')
    return await executeAssetQuery(query, characterId, fallbackAssets)
  }
  if (name === 'appraise_items') {
    const items = String(input.items ?? '')
    const market = String(input.market ?? 'Jita')
    const apiKey = process.env.JANICE_API_KEY
    if (!apiKey) return { error: 'No JANICE_API_KEY configured — cannot look up prices.' }

    const url = `https://janice.e-351.com/api/rest/v2/appraisal?designation=appraisal&pricing=split&pricingVariant=immediate&marketName=${encodeURIComponent(market)}&raw=1`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-ApiKey': apiKey, Accept: 'application/json' },
      body: items,
    })
    if (!response.ok) return { error: `Janice API error: ${response.status}` }
    const data = await response.json() as {
      effectivePrices?: Record<string, number>
      items?: Array<Record<string, unknown>>
    }

    return {
      market,
      totals: {
        buy: data.effectivePrices?.totalBuyPrice ?? 0,
        sell: data.effectivePrices?.totalSellPrice ?? 0,
        split: data.effectivePrices?.totalSplitPrice ?? 0,
      },
      items: (data.items ?? []).map(item => {
        const ep = (item.effectivePrices ?? {}) as Record<string, number>
        const it = (item.itemType ?? {}) as Record<string, unknown>
        return {
          name: it.name ?? 'Unknown',
          typeId: it.eid ?? null,
          quantity: (item.amount as number) ?? 1,
          buyPrice: ep.buyPrice ?? 0,
          sellPrice: ep.sellPrice ?? 0,
          splitPrice: ep.splitPrice ?? 0,
          buyTotal: ep.buyPriceTotal ?? 0,
          sellTotal: ep.sellPriceTotal ?? 0,
        }
      }),
    }
  }

  if (name === 'get_price_history') {
    const typeId = Number(input.type_id)
    const itemName = String(input.item_name ?? '')
    const days = Math.min(90, Math.max(1, Number(input.days ?? 30)))
    const market = String(input.market ?? 'Jita')
    const regionId = REGION_IDS[market] ?? REGION_IDS.Jita

    const url = `https://esi.evetech.net/latest/markets/${regionId}/history/?datasource=tranquility&type_id=${typeId}`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return { error: `ESI error: ${response.status}` }

    const all = await response.json() as Array<{ date: string; average: number; highest: number; lowest: number; volume: number }>
    const recent = all.slice(-days)

    // Compute simple trend metrics for Aurora's analysis
    const prices = recent.map(d => d.average).filter(Boolean)
    const first = prices[0] ?? 0
    const last = prices[prices.length - 1] ?? 0
    const pctChange = first > 0 ? ((last - first) / first) * 100 : 0
    const high = Math.max(...recent.map(d => d.highest))
    const low = Math.min(...recent.map(d => d.lowest))

    return {
      item: itemName,
      typeId,
      market,
      days,
      trend: { pctChange: +pctChange.toFixed(2), high, low, firstAvg: first, lastAvg: last },
      history: recent.map(d => ({ date: d.date, avg: d.average, high: d.highest, low: d.lowest, vol: d.volume })),
    }
  }

  if (name === 'roadmap_list') {
    const items = loadRoadmap()
    const grouped: Record<string, { id: string; title: string; status: string; description: string; notes?: string[] }[]> = {}
    for (const item of items) {
      ;(grouped[item.category] ??= []).push({ id: item.id, title: item.title, status: item.status, description: item.description, notes: item.notes })
    }
    return { grouped, total: items.length }
  }

  if (name === 'roadmap_add') {
    const items = loadRoadmap()
    const newItem: RoadmapItem = {
      id: crypto.randomUUID(),
      title: String(input.title ?? '').trim(),
      description: String(input.description ?? ''),
      status: (input.status as RoadmapStatus) ?? 'planned',
      category: (input.category as RoadmapCategory) ?? 'General',
      notes: (input.notes as string[] | undefined),
    }
    if (!newItem.title) return { error: 'title required' }
    items.push(newItem)
    saveRoadmap(items)
    return { added: { id: newItem.id, title: newItem.title, status: newItem.status, category: newItem.category } }
  }

  if (name === 'roadmap_update') {
    const items = loadRoadmap()
    const idx = items.findIndex(i => i.id === input.id)
    if (idx === -1) return { error: `No roadmap item with id ${input.id}` }
    const patch: Partial<RoadmapItem> = {}
    if (input.status)      patch.status      = input.status as RoadmapStatus
    if (input.title)       patch.title       = String(input.title)
    if (input.description) patch.description = String(input.description)
    if (input.notes)       patch.notes       = input.notes as string[]
    items[idx] = { ...items[idx], ...patch }
    saveRoadmap(items)
    return { updated: items[idx] }
  }

  if (name === 'todo_add') {
    const items = (input.items as string[] | undefined) ?? []
    if (!items.length) return { error: 'No items provided' }
    const todos = loadTodos()
    const added: TodoItem[] = items.map(text => ({
      id: crypto.randomUUID(), text: text.trim(), done: false, createdAt: new Date().toISOString(),
    }))
    todos.push(...added)
    saveTodos(todos)
    return { added: added.map(t => ({ id: t.id, text: t.text })), total: todos.length }
  }

  if (name === 'todo_list') {
    const todos = loadTodos()
    return { todos: todos.map(t => ({ id: t.id, text: t.text, done: t.done })), total: todos.length }
  }

  if (name === 'todo_complete') {
    const ids = (input.ids as string[] | undefined) ?? []
    const todos = loadTodos()
    let updated = 0
    for (const todo of todos) {
      if (ids.includes(todo.id)) { todo.done = true; updated++ }
    }
    saveTodos(todos)
    return { updated }
  }

  if (name === 'todo_remove') {
    const ids = (input.ids as string[] | undefined) ?? []
    const todos = loadTodos()
    const filtered = todos.filter(t => !ids.includes(t.id))
    saveTodos(filtered)
    return { removed: todos.length - filtered.length }
  }

  if (name === 'get_mail') {
    if (!characterId) return { error: 'No character context — cannot fetch mail.' }
    const entry = mailCache.get(characterId)
    if (!entry) return { error: 'Mail not synced yet — ask the pilot to refresh their data.' }
    const filter = String(input.filter ?? 'unread')
    const search = input.search ? String(input.search).toLowerCase() : null
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 20)))
    let mails = entry.mails
    if (filter === 'unread') mails = mails.filter(m => !m.isRead)
    else if (filter === 'read') mails = mails.filter(m => m.isRead)
    if (search) mails = mails.filter(m => m.subject.toLowerCase().includes(search) || m.fromName.toLowerCase().includes(search))
    const result = mails.slice(0, limit).map(m => ({
      mailId: m.mailId,
      subject: m.subject || '(No subject)',
      from: m.fromName,
      date: m.timestamp.slice(0, 10),
      isRead: m.isRead,
      body: m.body ?? null,
    }))
    return { total: mails.length, showing: result.length, filter, mails: result }
  }

  if (name === 'get_contracts') {
    if (!characterId) return { error: 'No character context — cannot fetch contracts.' }
    const entry = contractCache.get(characterId)
    if (!entry) return { error: 'Contracts not synced yet — ask the pilot to refresh their data.' }
    const filter = String(input.filter ?? 'all')
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 20)))
    let contracts = entry.contracts
    const now = Date.now()
    if (filter === 'outstanding') contracts = contracts.filter(c => c.status === 'outstanding')
    else if (filter === 'in_progress') contracts = contracts.filter(c => c.status === 'in_progress')
    else if (filter === 'finished') contracts = contracts.filter(c => ['finished','finished_issuer','finished_contractor'].includes(c.status))
    else if (filter === 'failed') contracts = contracts.filter(c => ['failed','cancelled','rejected','reversed'].includes(c.status))
    else if (filter === 'attention') contracts = contracts.filter(c =>
      c.status === 'outstanding' || (new Date(c.dateExpired).getTime() < now && (c.status === 'in_progress' || c.status === 'outstanding'))
    )
    contracts = [...contracts].sort((a, b) => new Date(b.dateIssued).getTime() - new Date(a.dateIssued).getTime())
    const result = contracts.slice(0, limit).map(c => {
      const daysLeft = Math.ceil((new Date(c.dateExpired).getTime() - now) / 86_400_000)
      return {
        contractId: c.contractId,
        type: c.type,
        status: c.status,
        title: c.title || '(untitled)',
        issuer: c.issuerName,
        assignee: c.assigneeName || null,
        price: c.price,
        volume: c.volume,
        dateIssued: c.dateIssued.slice(0, 10),
        dateExpired: c.dateExpired.slice(0, 10),
        daysLeft,
        expired: daysLeft < 0,
        forCorporation: c.forCorporation,
        source: c.source ?? 'character',
      }
    })
    return { total: contracts.length, showing: result.length, filter, contracts: result }
  }

  if (name === 'query_industry') {
    const query = String(input.query ?? '')
    return await executeIndustryQuery(query, characterId)
  }

  if (name === 'query_skills') {
    const query = String(input.query ?? '')
    return await executeSkillQuery(query, characterId)
  }

  if (name === 'calculate_blueprint') {
    const blueprintName  = String(input.blueprint_name ?? '').trim()
    const runs           = Math.max(1, Number(input.runs ?? 1))
    const structure      = String(input.structure ?? 'station')
    const rig            = String(input.rig ?? 'none')
    const security       = String(input.security ?? 'null')
    const industryLevel  = Math.min(5, Math.max(0, Number(input.industry_level ?? 0)))
    const advIndLevel    = Math.min(5, Math.max(0, Number(input.adv_industry_level ?? 0)))

    if (!blueprintName) return { error: 'blueprint_name is required' }

    // Normalise: if the user/AI included "Blueprint" in the name, strip it for asset lookup
    const baseName = blueprintName.replace(/\s+blueprint$/i, '').trim()
    const searchTerm = /blueprint/i.test(blueprintName) ? blueprintName : `${blueprintName} Blueprint`

    // Check if pilot owns this blueprint in the asset cache — use their ME/TE
    let me = Math.min(10, Math.max(0, Number(input.me ?? 0)))
    let te = Math.min(20, Math.max(0, Number(input.te ?? 0)))
    let ownedBlueprintNote = ''
    if (characterId) {
      const cached = assetCache.get(characterId)
      if (cached) {
        const owned = cached.assets.find(a =>
          a.materialEfficiency !== undefined &&
          (a.typeName.toLowerCase() === searchTerm.toLowerCase() ||
           a.typeName.toLowerCase() === `${baseName.toLowerCase()} blueprint`)
        )
        if (owned) {
          // Only use owned values if caller didn't explicitly supply them
          if (input.me === undefined) me = owned.materialEfficiency ?? me
          if (input.te === undefined) te = owned.timeEfficiency    ?? te
          const bpType = owned.runs === -1 ? 'BPO' : `BPC (${owned.runs} runs)`
          ownedBlueprintNote = `Pilot owns this blueprint (${bpType}, ME${me} TE${te})`
        }
      }
    }

    // Resolve blueprint typeId via Fuzzwork
    let typeId: number | null = null
    try {
      const fwRes = await fetch(`https://www.fuzzwork.co.uk/api/typeid2.php?typename=${encodeURIComponent(searchTerm)}`)
      if (fwRes.ok) {
        const fwData = await fwRes.json() as Array<{ typeID: number; typeName: string }> | { typeID: number; typeName: string }
        const matches = Array.isArray(fwData) ? fwData : [fwData]
        const found = matches.find(m => m.typeID && /blueprint/i.test(m.typeName ?? ''))
        if (found) typeId = found.typeID
      }
    } catch { /* fall through */ }

    if (!typeId) return { error: `Could not find a blueprint named "${searchTerm}". Try a more specific item name.` }

    // Fetch blueprint SDE data
    const bpRes = await fetch(`https://ref-data.everef.net/blueprints/${typeId}`)
    if (!bpRes.ok) return { error: `Blueprint data not found for "${searchTerm}" (typeId ${typeId})` }
    const bp = await bpRes.json() as {
      activities?: {
        manufacturing?: {
          materials?:       Record<string, { type_id: number; quantity: number }>
          products?:        Record<string, { type_id: number; quantity: number }>
          required_skills?: Record<string, number>
          time?:            number
        }
      }
    }

    const mfg = bp.activities?.manufacturing
    if (!mfg) return { error: `"${searchTerm}" has no manufacturing activity` }

    const rawMaterials  = Object.values(mfg.materials ?? {})
    const product       = Object.values(mfg.products ?? {})[0] ?? null
    const baseTime      = mfg.time ?? 0
    const rawReqSkills  = Object.entries(mfg.required_skills ?? {})
      .map(([id, level]) => ({ typeId: Number(id), requiredLevel: level }))

    // Batch-resolve names
    const allIds = [...new Set([
      ...rawMaterials.map(m => m.type_id),
      ...rawReqSkills.map(s => s.typeId),
      ...(product ? [product.type_id] : []),
    ])]
    let nameMap: Record<number, string> = {}
    if (allIds.length > 0) {
      const nameRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allIds),
      })
      if (nameRes.ok) {
        const names = await nameRes.json() as Array<{ id: number; name: string }>
        for (const n of names) nameMap[n.id] = n.name
      }
    }

    const productName = product ? (nameMap[product.type_id] ?? `Type ${product.type_id}`) : ''

    // Asset HAVE quantities
    const assets = characterId ? (assetCache.get(characterId)?.assets ?? []) : []
    const assetQty = new Map<number, number>()
    for (const a of assets) {
      if (a.typeId !== undefined) assetQty.set(a.typeId, (assetQty.get(a.typeId) ?? 0) + a.quantity)
    }

    // ME / TE calculations (multiplicative stacking)
    const structBonus = STRUCTURE_BONUSES[structure] ?? STRUCTURE_BONUSES.station
    const rigBonus    = (RIG_BONUSES[rig] ?? RIG_BONUSES.none)[security] ?? RIG_BONUSES.none.null
    const meFactor    = (1 - me / 100) * (1 - structBonus.me / 100) * (1 - rigBonus.me / 100)
    const industryPct = industryLevel * 4
    const advIndPct   = advIndLevel   * 3
    const teFactor    = (1 - te / 100)
      * (1 - structBonus.te / 100)
      * (1 - rigBonus.te / 100)
      * (1 - industryPct / 100)
      * (1 - advIndPct   / 100)

    const materials = rawMaterials.map(m => {
      const adjQty = Math.max(runs, Math.ceil(m.quantity * runs * meFactor))
      const have   = assetQty.get(m.type_id) ?? 0
      const need   = Math.max(0, adjQty - have)
      return { name: nameMap[m.type_id] ?? `Type ${m.type_id}`, baseQty: m.quantity, adjQty, have, need }
    }).sort((a, b) => a.name.localeCompare(b.name))

    const adjustedTime = Math.ceil(baseTime * runs * teFactor)
    const formatTime = (s: number) => {
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
            m = Math.floor((s % 3600) / 60), sec = s % 60
      return [d && `${d}d`, h && `${h}h`, m && `${m}m`, sec && `${sec}s`].filter(Boolean).join(' ') || '0s'
    }

    const requiredSkills = rawReqSkills.map(s => ({
      name: nameMap[s.typeId] ?? `Skill ${s.typeId}`,
      requiredLevel: s.requiredLevel,
    }))

    const missingMaterials = materials.filter(m => m.need > 0)
    const coveredMaterials = materials.filter(m => m.need === 0)

    return {
      blueprint: searchTerm,
      typeId,
      ...(ownedBlueprintNote ? { ownedBlueprint: ownedBlueprintNote } : {}),
      product: productName,
      produces: (product?.quantity ?? 1) * runs,
      runs,
      me, te,
      structure, rig, security,
      baseTime: formatTime(baseTime * runs),
      adjustedTime: formatTime(adjustedTime),
      timeReductions: [
        te > 0             && `Blueprint TE${te}: -${te}%`,
        structBonus.te > 0 && `${structure.charAt(0).toUpperCase() + structure.slice(1)}: -${structBonus.te}%`,
        rigBonus.te > 0    && `${rig.toUpperCase()} Rig (${security}sec): -${rigBonus.te}%`,
        industryLevel > 0  && `Industry L${industryLevel}: -${industryPct}%`,
        advIndLevel > 0    && `Adv. Industry L${advIndLevel}: -${advIndPct}%`,
      ].filter(Boolean),
      materials: materials.map(m => ({
        name: m.name,
        needed: m.adjQty,
        have: m.have,
        shortfall: m.need > 0 ? m.need : null,
      })),
      summary: {
        totalMaterials: materials.length,
        covered: coveredMaterials.length,
        missing: missingMaterials.length,
        missingItems: missingMaterials.map(m => `${m.name} (need ${m.need.toLocaleString()}, have ${m.have.toLocaleString()})`),
      },
      requiredSkills,
    }
  }

  return { error: 'Unknown tool' }
}

// ── Asset sync endpoint ────────────────────────────────────────────────────
// Called by the client after every ESI refresh. Stores the full resolved
// asset list (with blueprint ME/TE) so query_assets always has a complete picture.
app.post('/api/assets/sync', async (req, res) => {
  const { characterId, characterName, assets, structureIds } = req.body as {
    characterId: number
    characterName: string
    assets: AssetEntry[]
    structureIds?: number[]
  }
  if (!characterId || !Array.isArray(assets)) {
    return res.status(400).json({ error: 'characterId and assets required' })
  }
  assetCache.set(characterId, { assets, structureIds: structureIds ?? [], syncedAt: Date.now(), characterName })
  console.log(`Asset cache updated: ${characterName} (${characterId}) — ${assets.length} stacks`)
  // Await enrichment so we can return groupNames to the client in this same response
  await enrichAssetsWithGroups(assets).catch(err => console.warn('Group enrichment failed:', err))
  const groups: Record<number, string> = {}
  for (const a of assets) {
    if (a.typeId !== undefined && a.groupName) groups[a.typeId] = a.groupName
  }
  return res.json({ ok: true, count: assets.length, syncedAt: new Date().toISOString(), groups })
})

// ── Direct asset query endpoint ────────────────────────────────────────────
// Lets the asset panel query Haiku directly, without going through the chat loop.
app.post('/api/assets/query', async (req, res) => {
  const { query, characterId } = req.body as { query: string; characterId?: number }
  if (!query?.trim()) return res.status(400).json({ error: 'query required' })
  try {
    const answer = await executeAssetQuery(query, characterId)
    return res.json({ answer })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
})

app.get('/api/assets/status', (req, res) => {
  const status = [...assetCache.entries()].map(([id, entry]) => ({
    characterId: id,
    characterName: entry.characterName,
    stacks: entry.assets.length,
    syncedAt: new Date(entry.syncedAt).toISOString(),
    ageMinutes: Math.round((Date.now() - entry.syncedAt) / 60000),
    structureCount: entry.structureIds.length,
  }))
  res.json(status)
})

// ── Structure discovery from asset cache ──────────────────────────────────
// Scans cached assets for player-owned structure location IDs (>1e12),
// resolves names via authenticated GET /universe/structures/{id}/ (requires
// docking rights), and returns {id, name}[] for the character.
app.get('/api/assets/structures', async (req, res) => {
  const characterId = req.query.characterId ? Number(req.query.characterId) : undefined
  const accessToken = req.query.accessToken as string | undefined
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' })

  const entries = characterId
    ? (assetCache.has(characterId) ? [[characterId, assetCache.get(characterId)!] as [number, AssetCacheEntry]] : [])
    : [...assetCache.entries()]

  const structureIdSet = new Set<number>()
  for (const [, entry] of entries) {
    for (const id of entry.structureIds) structureIdSet.add(id)
  }

  if (!structureIdSet.size) return res.json([])

  const results: { id: number; name: string }[] = []
  for (const id of structureIdSet) {
    try {
      const esiRes = await fetch(`https://esi.evetech.net/latest/universe/structures/${id}/`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!esiRes.ok) continue
      const data = await esiRes.json() as { name: string }
      results.push({ id, name: data.name })
    } catch {
      // skip structures we can't resolve
    }
  }

  return res.json(results)
})

// ── Industry sync endpoint ────────────────────────────────────────────────
app.post('/api/industry/sync', (req, res) => {
  const { characterId, characterName, jobs, blueprints } = req.body as {
    characterId: number; characterName: string
    jobs: IndustryJobEntry[]; blueprints: BlueprintEntry[]
  }
  if (!characterId || !Array.isArray(jobs)) return res.status(400).json({ error: 'characterId and jobs required' })
  industryCache.set(characterId, { jobs, blueprints: blueprints ?? [], syncedAt: Date.now(), characterName })
  console.log(`Industry cache updated: ${characterName} (${characterId}) — ${jobs.length} jobs, ${blueprints?.length ?? 0} blueprints`)
  return res.json({ ok: true, jobs: jobs.length, blueprints: blueprints?.length ?? 0 })
})

// ── Blueprint search endpoint ─────────────────────────────────────────────
// Uses ESI authenticated character search to find blueprint types by partial name.
app.get('/api/industry/blueprint/search', async (req, res) => {
  const q           = String(req.query.q ?? '').trim()
  const characterId = req.query.characterId ? Number(req.query.characterId) : undefined
  const accessToken = req.query.accessToken as string | undefined

  if (!q || q.length < 2) return res.json({ results: [] })

  // Append "Blueprint" if not already in the query so we stay in blueprint-space
  const searchTerm = /blueprint/i.test(q) ? q : `${q} Blueprint`

  try {
    let typeIds: number[] = []

    if (characterId && accessToken) {
      // Authenticated character search — most reliable
      const esiUrl = `https://esi.evetech.net/latest/characters/${characterId}/search/?categories=inventory_type&search=${encodeURIComponent(searchTerm)}&strict=false&datasource=tranquility`
      const esiRes = await fetch(esiUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (esiRes.ok) {
        const esiData = await esiRes.json() as { inventory_type?: number[] }
        typeIds = (esiData.inventory_type ?? []).slice(0, 40)
      }
    }

    // Fallback: try Fuzzwork exact-match for the full query
    if (typeIds.length === 0) {
      const fwRes = await fetch(`https://www.fuzzwork.co.uk/api/typeid2.php?typename=${encodeURIComponent(searchTerm)}`)
      if (fwRes.ok) {
        const fwData = await fwRes.json() as Array<{ typeID: number; typeName: string }>
        const matches = Array.isArray(fwData) ? fwData : [fwData]
        return res.json({
          results: matches
            .filter(m => m.typeID && /blueprint/i.test(m.typeName ?? ''))
            .map(m => ({ typeId: m.typeID, name: m.typeName }))
            .slice(0, 20),
        })
      }
    }

    if (typeIds.length === 0) return res.json({ results: [] })

    // Resolve names for the ESI IDs
    const nameRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeIds),
    })
    if (!nameRes.ok) return res.json({ results: [] })
    const names = await nameRes.json() as Array<{ id: number; name: string; category: string }>

    const results = names
      .filter(n => /blueprint/i.test(n.name))
      .map(n => ({ typeId: n.id, name: n.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20)

    return res.json({ results })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
})

// ── Blueprint materials endpoint ──────────────────────────────────────────
// Fetches manufacturing data from EVE Ref SDE, applies ME/TE + structure/rig bonuses, diffs vs assets.
app.get('/api/industry/blueprint', async (req, res) => {
  const typeId          = Number(req.query.typeId)
  const me              = Math.min(10, Math.max(0, Number(req.query.me  ?? 0)))
  const te              = Math.min(20, Math.max(0, Number(req.query.te  ?? 0)))
  const runs            = Math.max(1, Number(req.query.runs ?? 1))
  const structure       = String(req.query.structure ?? 'station')
  const rig             = String(req.query.rig ?? 'none')
  const security        = String(req.query.security ?? 'null')
  const industryLevel   = Math.min(5, Math.max(0, Number(req.query.industryLevel   ?? 0)))
  const advIndLevel     = Math.min(5, Math.max(0, Number(req.query.advIndLevel     ?? 0)))
  const characterId     = req.query.characterId ? Number(req.query.characterId) : undefined

  const structBonus  = STRUCTURE_BONUSES[structure] ?? STRUCTURE_BONUSES.station
  const rigBonus     = (RIG_BONUSES[rig] ?? RIG_BONUSES.none)[security] ?? RIG_BONUSES.none.null

  if (!typeId) return res.status(400).json({ error: 'typeId required' })

  try {
    // Fetch raw blueprint data from EVE Ref
    const bpRes = await fetch(`https://ref-data.everef.net/blueprints/${typeId}`)
    if (!bpRes.ok) return res.status(404).json({ error: `Blueprint ${typeId} not found in SDE` })
    const bp = await bpRes.json() as {
      activities?: {
        manufacturing?: {
          materials?:       Record<string, { type_id: number; quantity: number }>
          products?:        Record<string, { type_id: number; quantity: number }>
          required_skills?: Record<string, number>   // skillTypeId → minLevel
          time?:            number
        }
      }
    }

    const mfg = bp.activities?.manufacturing
    if (!mfg) return res.status(404).json({ error: 'Blueprint has no manufacturing activity' })

    const rawMaterials  = Object.values(mfg.materials ?? {})
    const product       = Object.values(mfg.products ?? {})[0] ?? null
    const baseTime      = mfg.time ?? 0
    const rawReqSkills  = Object.entries(mfg.required_skills ?? {})
      .map(([id, level]) => ({ typeId: Number(id), requiredLevel: level }))

    // Resolve material + skill names in one batch ESI call
    const matTypeIds   = rawMaterials.map(m => m.type_id)
    const skillTypeIds = rawReqSkills.map(s => s.typeId)
    const allResolveIds = [...new Set([...matTypeIds, ...skillTypeIds])]
    let nameMap: Record<number, string> = {}
    if (allResolveIds.length > 0) {
      const nameRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allResolveIds),
      })
      if (nameRes.ok) {
        const names = await nameRes.json() as Array<{ id: number; name: string }>
        for (const n of names) nameMap[n.id] = n.name
      }
    }

    // Also resolve product name if we have a product
    let productName = ''
    if (product) {
      const pRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([product.type_id]),
      })
      if (pRes.ok) {
        const pNames = await pRes.json() as Array<{ id: number; name: string }>
        productName = pNames[0]?.name ?? ''
      }
    }

    // Build asset quantity map for this character
    const assets = characterId ? (assetCache.get(characterId)?.assets ?? []) : []
    const assetQty = new Map<number, number>()
    for (const a of assets) {
      if (a.typeId !== undefined) {
        assetQty.set(a.typeId, (assetQty.get(a.typeId) ?? 0) + a.quantity)
      }
    }

    // Apply ME reduction (multiplicative stacking: BP + structure + rig)
    const meFactor = (1 - me / 100) * (1 - structBonus.me / 100) * (1 - rigBonus.me / 100)
    const materials = rawMaterials.map(m => {
      const baseQty  = m.quantity
      const adjQty   = Math.max(runs, Math.ceil(baseQty * runs * meFactor))
      const have     = assetQty.get(m.type_id) ?? 0
      const need     = Math.max(0, adjQty - have)
      return {
        typeId:   m.type_id,
        name:     nameMap[m.type_id] ?? `Type ${m.type_id}`,
        baseQty,
        adjQty,
        have,
        need,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    // Build required-skills list with resolved names
    const requiredSkills = rawReqSkills.map(s => ({
      typeId:        s.typeId,
      name:          nameMap[s.typeId] ?? `Skill ${s.typeId}`,
      requiredLevel: s.requiredLevel,
    }))

    // Apply TE reduction: multiplicative stacking of BP + structure + rig + skills
    // Industry (3380) gives -4% per level, Advanced Industry (3388) gives -3% per level
    const industryPct   = industryLevel * 4    // e.g. L4 → 16%
    const advIndPct     = advIndLevel   * 3    // e.g. L5 → 15%
    const teFactor = (1 - te / 100)
      * (1 - structBonus.te / 100)
      * (1 - rigBonus.te / 100)
      * (1 - industryPct / 100)
      * (1 - advIndPct   / 100)
    const adjustedTime = Math.ceil(baseTime * runs * teFactor)

    // Build time-reduction breakdown for display
    const timeBreakdown = [
      { label: `Blueprint TE${te}`,   pct: te,              applies: te > 0 },
      { label: structBonus.te > 0 ? `${structure.charAt(0).toUpperCase() + structure.slice(1)}` : 'NPC Station', pct: structBonus.te, applies: structBonus.te > 0 },
      { label: `${rig === 'none' ? '' : (rig === 't1' ? 'T1' : 'T2') + ' Rig (' + (security === 'high' ? 'Hi' : security === 'low' ? 'Lo' : 'Null') + ')'}`, pct: rigBonus.te, applies: rigBonus.te > 0 },
      { label: `Industry L${industryLevel}`,        pct: industryPct, applies: industryLevel > 0 },
      { label: `Advanced Industry L${advIndLevel}`, pct: advIndPct,   applies: advIndLevel > 0 },
    ].filter(r => r.applies)

    return res.json({
      typeId,
      productTypeId: product?.type_id ?? null,
      productName,
      productQty: product?.quantity ?? 1,
      baseTime,
      adjustedTime,
      me, te, runs,
      structure, rig, security,
      industryLevel, advIndLevel,
      structureMeBonus: structBonus.me,
      structureTeBonus: structBonus.te,
      rigMeBonus: rigBonus.me,
      rigTeBonus: rigBonus.te,
      timeBreakdown,
      materials,
      requiredSkills,
    })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
})

// ── Skills sync endpoint ──────────────────────────────────────────────────
app.post('/api/skills/sync', (req, res) => {
  const { characterId, characterName, skills, queue, attributes } = req.body as {
    characterId: number; characterName: string
    skills: SkillEntry[]; queue: SkillQueueEntry[]; attributes: AttributesEntry | null
  }
  if (!characterId || !Array.isArray(skills)) return res.status(400).json({ error: 'characterId and skills required' })
  skillsCache.set(characterId, { skills, queue: queue ?? [], attributes: attributes ?? null, syncedAt: Date.now(), characterName })
  console.log(`Skills cache updated: ${characterName} (${characterId}) — ${skills.length} skills`)
  return res.json({ ok: true, skills: skills.length, queue: queue?.length ?? 0 })
})


// ── Mail sync endpoint ────────────────────────────────────────────────────
app.post('/api/mail/sync', (req, res) => {
  const { characterId, mails } = req.body as { characterId: number; mails: MailCacheEntry['mails'] }
  if (!characterId || !Array.isArray(mails)) return res.status(400).json({ error: 'characterId and mails required' })
  mailCache.set(characterId, { mails, syncedAt: Date.now() })
  return res.json({ ok: true, count: mails.length })
})

// ── Mail body fetch ───────────────────────────────────────────────────────
app.post('/api/mail/body', async (req, res) => {
  const { characterId, mailId, token } = req.body as { characterId: number; mailId: number; token: string }
  if (!characterId || !mailId || !token) return res.status(400).json({ error: 'characterId, mailId, token required' })
  const r = await fetch(`https://esi.evetech.net/latest/characters/${characterId}/mail/${mailId}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) return res.status(r.status).json({ error: `ESI ${r.status}` })
  return res.json(await r.json())
})

// ── Send mail ─────────────────────────────────────────────────────────────
app.post('/api/mail/send', async (req, res) => {
  const { characterId, token, recipients, subject, body } = req.body as {
    characterId: number; token: string
    recipients: Array<{ recipient_id: number; recipient_type: string }>
    subject: string; body: string
  }
  if (!characterId || !token || !recipients || !subject || !body) return res.status(400).json({ error: 'missing fields' })
  const r = await fetch(`https://esi.evetech.net/latest/characters/${characterId}/mail/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients, subject, body }),
  })
  if (!r.ok) return res.status(r.status).json({ error: `ESI ${r.status}` })
  const mailId = await r.json()
  return res.json({ ok: true, mailId })
})

// ── Mark mail read ────────────────────────────────────────────────────────
app.post('/api/mail/read', async (req, res) => {
  const { characterId, mailId, token } = req.body as { characterId: number; mailId: number; token: string }
  if (!characterId || !mailId || !token) return res.status(400).json({ error: 'characterId, mailId, token required' })
  const r = await fetch(`https://esi.evetech.net/latest/characters/${characterId}/mail/${mailId}/`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: true }),
  })
  if (!r.ok) return res.status(r.status).json({ error: `ESI ${r.status}` })
  // Update cache
  const entry = mailCache.get(characterId)
  if (entry) {
    const m = entry.mails.find(x => x.mailId === mailId)
    if (m) m.isRead = true
  }
  return res.json({ ok: true })
})

// ── Contracts sync endpoint ───────────────────────────────────────────────
app.post('/api/contracts/sync', (req, res) => {
  const { characterId, contracts } = req.body as { characterId: number; contracts: ContractCacheEntry['contracts'] }
  if (!characterId || !Array.isArray(contracts)) return res.status(400).json({ error: 'characterId and contracts required' })
  contractCache.set(characterId, { contracts, syncedAt: Date.now() })
  return res.json({ ok: true, count: contracts.length })
})

// ── Chat endpoint (SSE streaming + agentic tool loop) ──────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, system, systemStatic, systemDynamic, characterId, assetContext, previousMessageId } = req.body as {
    messages: Anthropic.MessageParam[]
    system?: string
    systemStatic?: string
    systemDynamic?: string
    characterId?: number
    assetContext?: AssetEntry[]
    previousMessageId?: string | null
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const apiMessages: Anthropic.MessageParam[] = [...messages]

  let lastResponseId: string | null = null

  try {
    // Agentic loop: keep going until Claude stops requesting tools
    while (true) {
      // Build system blocks: static (cacheable) + dynamic EVE context (uncached).
      // Splitting lets the static personality/tools section (~700 tokens) cache
      // across requests even as the dynamic EVE context changes each time.
      const systemBlocks = systemStatic
        ? [
            { type: 'text' as const, text: systemStatic, cache_control: { type: 'ephemeral' as const } },
            ...(systemDynamic ? [{ type: 'text' as const, text: systemDynamic }] : []),
          ]
        : [
            {
              type: 'text' as const,
              text: system || 'You are Aurora, a Capsuleer Intelligence System for EVE Online.',
              cache_control: { type: 'ephemeral' as const },
            },
          ]

      const stream = (anthropic.messages as any).stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemBlocks,
        messages: apiMessages,
        tools: MARKET_TOOLS,
      })

      // Track tool_use blocks as they accumulate
      const toolUses: Array<{ id: string; name: string; inputStr: string }> = []
      let currentTool: { id: string; name: string; inputStr: string } | null = null

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentTool = { id: event.content_block.id, name: event.content_block.name, inputStr: '' }
            res.write(`data: ${JSON.stringify({ tool: { name: event.content_block.name, status: 'calling' } })}\n\n`)
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ delta: { text: event.delta.text } })}\n\n`)
          } else if (event.delta.type === 'input_json_delta' && currentTool) {
            currentTool.inputStr += event.delta.partial_json
          }
        } else if (event.type === 'content_block_stop' && currentTool) {
          toolUses.push(currentTool)
          currentTool = null
        }
      }

      const final = await stream.finalMessage()
      accumulateUsage(final.usage)

      lastResponseId = final.id ?? null

      if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break

      // Execute each tool and build tool_result messages
      apiMessages.push({ role: 'assistant', content: final.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        res.write(`data: ${JSON.stringify({ tool: { name: tu.name, status: 'executing' } })}\n\n`)
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(tu.inputStr || '{}') } catch { /* empty input */ }
        const result = await executeMarketTool(tu.name, parsed, characterId, assetContext)
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
        res.write(`data: ${JSON.stringify({ tool: { name: tu.name, status: 'done' } })}\n\n`)
      }

      apiMessages.push({ role: 'user', content: toolResults })
    }

    if (lastResponseId) {
      res.write(`data: ${JSON.stringify({ responseId: lastResponseId, diagnostics: null })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Log full error for server-side debugging
    console.error('Chat error:', message)
    if (err && typeof err === 'object' && 'status' in err) {
      console.error('Anthropic status:', (err as { status: number }).status)
    }
    if (err && typeof err === 'object' && 'error' in err) {
      console.error('Anthropic error body:', JSON.stringify((err as { error: unknown }).error))
    }
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.end()
  }
})

// ── Sync chat endpoint (for Discord bot / non-SSE clients) ────────────────
// Runs the same agentic loop as /api/chat but returns accumulated text as JSON.
app.post('/api/chat/sync', async (req, res) => {
  const { messages, system, systemStatic, systemDynamic, characterId, assetContext } = req.body as {
    messages: Anthropic.MessageParam[]
    system?: string
    systemStatic?: string
    systemDynamic?: string
    characterId?: number
    assetContext?: AssetEntry[]
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' })
  }

  const apiMessages: Anthropic.MessageParam[] = [...messages]
  let accumulatedText = ''

  try {
    while (true) {
      const systemBlocks = systemStatic
        ? [
            { type: 'text' as const, text: systemStatic, cache_control: { type: 'ephemeral' as const } },
            ...(systemDynamic ? [{ type: 'text' as const, text: systemDynamic }] : []),
          ]
        : [
            {
              type: 'text' as const,
              text: system || 'You are Aurora, a Capsuleer Intelligence System for EVE Online.',
              cache_control: { type: 'ephemeral' as const },
            },
          ]

      const stream = (anthropic.messages as any).stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemBlocks,
        messages: apiMessages,
        tools: MARKET_TOOLS,
      })

      const toolUses: Array<{ id: string; name: string; inputStr: string }> = []
      let currentTool: { id: string; name: string; inputStr: string } | null = null

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentTool = { id: event.content_block.id, name: event.content_block.name, inputStr: '' }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            accumulatedText += event.delta.text
          } else if (event.delta.type === 'input_json_delta' && currentTool) {
            currentTool.inputStr += event.delta.partial_json
          }
        } else if (event.type === 'content_block_stop' && currentTool) {
          toolUses.push(currentTool)
          currentTool = null
        }
      }

      const final = await stream.finalMessage()
      accumulateUsage(final.usage)

      if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break

      apiMessages.push({ role: 'assistant', content: final.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(tu.inputStr || '{}') } catch { /* empty */ }
        const result = await executeMarketTool(tu.name, parsed, characterId, assetContext)
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
      }

      apiMessages.push({ role: 'user', content: toolResults })
    }

    res.json({ text: accumulatedText })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Sync chat error:', message)
    res.status(500).json({ error: message })
  }
})

// ── Usage stats endpoint ───────────────────────────────────────────────────
app.get('/api/usage', (_req, res) => {
  const costUsd = estimateCostUsd(usageTotals)
  res.json({ ...usageTotals, estimatedCostUsd: +costUsd.toFixed(6) })
})

// ── EVE SSO OAuth callback (GET) — exchanges code, redirects to frontend ──
// In Electron, we serve a small HTML page that navigates via JS to aurora://callback.
// This triggers will-navigate in the main process (more reliable than will-redirect for 302s).
const IS_ELECTRON = process.env.ELECTRON_APP === '1'

function sendToFrontend(res: any, params: string) {
  if (IS_ELECTRON && typeof (global as any).__auroraOAuthCallback === 'function') {
    // Server and Electron main share the same process — call directly, no web navigation needed
    ;(global as any).__auroraOAuthCallback(params)
    res.send('<html><body style="background:#080b10;color:#00d4ff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Returning to Aurora...</body></html>')
  } else {
    res.redirect(`http://localhost:5173/?${params}`)
  }
}

const auroraLog = (msg: string) => {
  if (typeof (global as any).__auroraLog === 'function') (global as any).__auroraLog(msg)
  else console.log(msg)
}

app.get('/api/eve/callback', async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string }
  auroraLog(`EVE callback hit — code=${code?.slice(0,8)}... clientId=${process.env.EVE_CLIENT_ID?.slice(0,6)}... secret=${process.env.EVE_CLIENT_SECRET ? 'SET' : 'MISSING'} callbackUrl=${process.env.EVE_CALLBACK_URL}`)
  if (!code) return sendToFrontend(res, 'eve_error=missing_code')

  try {
    const credentials = Buffer.from(
      `${process.env.EVE_CLIENT_ID}:${process.env.EVE_CLIENT_SECRET}`
    ).toString('base64')

    const response = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.EVE_CALLBACK_URL || 'http://localhost:3001/api/eve/callback',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      auroraLog(`EVE token exchange failed: status=${response.status} body=${text.slice(0, 200)}`)
      return sendToFrontend(res, `eve_error=${encodeURIComponent(text)}`)
    }

    const data = await response.json() as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    // Decode the JWT to extract character info — no HTTP call needed for SSO v2
    let characterId = 0
    let characterName = 'Unknown'
    let corporationId = 0

    try {
      const payload = JSON.parse(
        Buffer.from(data.access_token.split('.')[1], 'base64url').toString('utf8')
      )
      // sub is "CHARACTER:EVE:12345678"
      characterId = parseInt(payload.sub?.split(':')[2] ?? '0', 10)
      characterName = payload.name ?? 'Unknown'
      console.log('EVE JWT decoded:', { characterId, characterName })
    } catch (e) {
      console.error('Failed to decode EVE JWT:', e)
      return sendToFrontend(res, 'eve_error=jwt_decode_failed')
    }

    // Fetch corporation ID from public ESI (no auth required)
    try {
      const charRes = await fetch(`https://esi.evetech.net/latest/characters/${characterId}/`)
      if (charRes.ok) {
        const charData = await charRes.json() as { corporation_id: number }
        corporationId = charData.corporation_id
      }
    } catch {
      // non-fatal — corporation_id defaults to 0
    }

    const params = new URLSearchParams({
      eve_access_token: data.access_token,
      eve_refresh_token: data.refresh_token,
      eve_expires_in: String(data.expires_in),
      eve_character_id: String(characterId),
      eve_character_name: characterName,
      eve_corporation_id: String(corporationId),
    })

    sendToFrontend(res, params.toString())
  } catch (err) {
    console.error('EVE callback error:', err)
    sendToFrontend(res, 'eve_error=server_error')
  }
})

// ── EVE SSO token exchange ─────────────────────────────────────────────────
app.post('/api/eve/token', async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'code required' })

  try {
    const credentials = Buffer.from(
      `${process.env.EVE_CLIENT_ID}:${process.env.EVE_CLIENT_SECRET}`
    ).toString('base64')

    const response = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Host: 'login.eveonline.com',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.EVE_CALLBACK_URL || 'http://localhost:5173/eve/callback',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return res.status(response.status).json({ error: text })
    }

    const data = await response.json()
    res.json(data)
  } catch (err) {
    console.error('EVE token error:', err)
    res.status(500).json({ error: 'Token exchange failed' })
  }
})

// ── Janice appraisal proxy ────────────────────────────────────────────────
app.post('/api/janice', async (req, res) => {
  const { items, market = 'Jita' } = req.body as { items: string; market?: string }
  if (!items?.trim()) return res.status(400).json({ error: 'items required' })

  const apiKey = process.env.JANICE_API_KEY
  if (!apiKey) {
    // No API key configured — tell frontend to fall back to browser open
    return res.status(200).json({ noApiKey: true })
  }

  try {
    const url = `https://janice.e-351.com/api/rest/v2/appraisal?designation=appraisal&pricing=split&pricingVariant=immediate&marketName=${encodeURIComponent(market)}&raw=1`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-ApiKey': apiKey,
        'Accept': 'application/json',
      },
      body: items,
    })
    if (!response.ok) {
      const text = await response.text()
      console.error('Janice API error:', response.status, text)
      return res.status(200).json({ noApiKey: true, apiError: `Janice: ${response.status}` })
    }
    const data = await response.json()
    // Normalize Janice v2 item schema to what the frontend expects
    if (data.items?.length) {
      data.items = data.items.map((item: Record<string, unknown>) => {
        const ep = (item.effectivePrices ?? item.immediatePrices ?? {}) as Record<string, number>
        const qty = (item.amount as number) ?? 1
        const itemType = item.itemType as { name?: string; eid?: number; volume?: number; packagedVolume?: number }
        // Prefer packagedVolume (shipping volume) over volume (assembled volume).
        // For ships/structures the assembled volume can be orders of magnitude larger.
        const unitVol = itemType.packagedVolume ?? itemType.volume ?? 0
        return {
          name: itemType.name ?? 'Unknown',
          typeId: itemType.eid ?? null,
          quantity: qty,
          volume: unitVol * qty,
          prices: {
            buy: { max: ep.buyPrice ?? 0 },
            sell: { min: ep.sellPrice ?? 0 },
            split: { price: ep.splitPrice ?? 0 },
          },
        }
      })
      data.totalVolume = (data.items as Array<{ volume?: number }>).reduce((s, it) => s + (it.volume ?? 0), 0)
    }
    res.json(data)
  } catch (err) {
    console.error('Janice error:', err)
    res.status(200).json({ noApiKey: true })
  }
})

// ── Market group / type category cache ────────────────────────────────────
const typeGroupCache  = new Map<number, number | null>()       // typeId → marketGroupId
const mktGroupCache   = new Map<number, { name: string; parent?: number }>()

async function fetchTypeGroup(typeId: number): Promise<number | null> {
  if (typeGroupCache.has(typeId)) return typeGroupCache.get(typeId)!
  try {
    const r = await fetch(`https://esi.evetech.net/latest/universe/types/${typeId}/`)
    const d = r.ok ? await r.json() : {}
    const gid: number | null = d.market_group_id ?? null
    typeGroupCache.set(typeId, gid)
    return gid
  } catch { typeGroupCache.set(typeId, null); return null }
}

async function fetchMarketGroup(gid: number): Promise<{ name: string; parent?: number }> {
  if (mktGroupCache.has(gid)) return mktGroupCache.get(gid)!
  try {
    const r = await fetch(`https://esi.evetech.net/latest/markets/groups/${gid}/`)
    const d = r.ok ? await r.json() : {}
    const entry = { name: d.name ?? `Group ${gid}`, parent: d.parent_group_id }
    mktGroupCache.set(gid, entry)
    return entry
  } catch {
    const entry = { name: `Group ${gid}` }
    mktGroupCache.set(gid, entry)
    return entry
  }
}

async function resolveGroupPath(gid: number): Promise<string[]> {
  const path: string[] = []
  let cur: number | undefined = gid
  const seen = new Set<number>()
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur)
    const g = await fetchMarketGroup(cur)
    path.unshift(g.name)
    cur = g.parent
  }
  return path
}

// POST /api/market/type-groups  { typeIds: number[] }
// Returns { [typeId]: string[] }  — full category path from root
app.post('/api/market/type-groups', async (req, res) => {
  const { typeIds } = req.body as { typeIds: number[] }
  if (!Array.isArray(typeIds)) return res.status(400).json({ error: 'typeIds required' })

  // Fetch all type→group mappings in parallel
  await Promise.all(typeIds.map(fetchTypeGroup))

  // Collect unique group IDs that need path resolution
  const uniqueGids = new Set<number>()
  for (const id of typeIds) {
    const gid = typeGroupCache.get(id)
    if (gid) uniqueGids.add(gid)
  }

  const pathMap = new Map<number, string[]>()
  await Promise.all([...uniqueGids].map(async gid => {
    pathMap.set(gid, await resolveGroupPath(gid))
  }))

  const result: Record<number, string[]> = {}
  for (const id of typeIds) {
    const gid = typeGroupCache.get(id)
    result[id] = (gid && pathMap.get(gid)) ?? ['Other']
  }
  res.json(result)
})

// ── EVE market price history proxy ────────────────────────────────────────
const REGION_IDS: Record<string, number> = {
  Jita: 10000002, Amarr: 10000043, Dodixie: 10000032, Rens: 10000030, Hek: 10000042,
}
app.get('/api/market/history', async (req, res) => {
  const typeId = Number(req.query.typeId)
  const market = String(req.query.market ?? 'Jita')
  const regionId = REGION_IDS[market] ?? REGION_IDS.Jita
  if (!typeId) return res.status(400).json({ error: 'typeId required' })
  try {
    const url = `https://esi.evetech.net/latest/markets/${regionId}/history/?datasource=tranquility&type_id=${typeId}`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return res.status(200).json([])
    const data = await response.json()
    res.json(data)
  } catch {
    res.status(200).json([])
  }
})

// ── EVE universe name→ID resolution proxy ─────────────────────────────────
app.post('/api/eve/resolve-names', async (req, res) => {
  const { names } = req.body as { names: string[] }
  if (!names?.length) return res.status(400).json({ error: 'names required' })

  try {
    const response = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(names),
    })
    if (!response.ok) return res.status(response.status).json({ error: 'ESI resolve failed' })
    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Name resolution failed' })
  }
})

// ── ESI ID→name bulk resolution ───────────────────────────────────────────
app.post('/api/eve/resolve-ids', async (req, res) => {
  const { ids } = req.body as { ids: number[] }
  if (!ids?.length) return res.status(400).json({ error: 'ids required' })
  // ESI limit is 1000 IDs per call
  const batch = ids.slice(0, 1000)
  try {
    const response = await fetch('https://esi.evetech.net/latest/universe/names/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    })
    if (!response.ok) return res.status(response.status).json({ error: 'ESI resolve-ids failed' })
    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'ID resolution failed' })
  }
})

// ── Player structure name resolution (auth'd) ─────────────────────────────
app.post('/api/eve/structure-names', async (req, res) => {
  const { ids, token } = req.body as { ids: string[]; token: string }
  if (!ids?.length || !token) return res.status(400).json({ error: 'ids and token required' })
  const results: Record<string, string> = {}
  await Promise.allSettled(ids.map(async (id) => {
    const r = await fetch(`https://esi.evetech.net/latest/universe/structures/${id}/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.ok) {
      const d = await r.json() as { name: string }
      results[id] = d.name
    }
  }))
  res.json(results)
})

// ── zKillboard proxy ──────────────────────────────────────────────────────
// zKill returns only {killmail_id, zkb:{hash,...}}. We then fetch the full
// killmail from ESI using the hash to get victim/attacker details.
const ZKILL_HEADERS = {
  'Accept': 'application/json',
  'Accept-Encoding': 'gzip',
  'User-Agent': 'Aurora-EVE-Intelligence/1.0 github.com/aurora-eve',
}

interface ZkbMeta { hash: string; totalValue: number; fittedValue?: number; points: number; npc: boolean; solo: boolean; awox: boolean }
interface ZkillRef { killmail_id: number; zkb: ZkbMeta }

async function fetchZkillPage(endpoint: string): Promise<ZkillRef[]> {
  const url = `https://zkillboard.com/api/${endpoint}`
  const r = await fetch(url, { headers: ZKILL_HEADERS })
  if (!r.ok) throw new Error(`zKill ${r.status}: ${endpoint}`)
  return r.json() as Promise<ZkillRef[]>
}

async function fetchKillmail(killmailId: number, hash: string): Promise<Record<string, unknown>> {
  const url = `https://esi.evetech.net/latest/killmails/${killmailId}/${hash}/`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) return {}
  return r.json() as Promise<Record<string, unknown>>
}

app.get('/api/zkill/:category/:id', async (req, res) => {
  const { category, id } = req.params
  const page = Math.max(1, Number(req.query.page ?? 1))
  const limit = 25

  const zkillCatMap: Record<string, string> = {
    character:    'characterID',
    system:       'solarSystemID',
    constellation:'constellationID',
    region:       'regionID',
  }
  const zkillCat = zkillCatMap[category]
  if (!zkillCat) return res.status(400).json({ error: 'Unknown category' })

  try {
    let refs: ZkillRef[]

    if (category === 'character') {
      // Fetch both kills and losses in parallel so the feed shows the full picture
      const [killRefs, lossRefs] = await Promise.all([
        fetchZkillPage(`kills/${zkillCat}/${id}/page/${page}/`),
        fetchZkillPage(`losses/${zkillCat}/${id}/page/${page}/`),
      ])
      // Merge and sort by killmail_id descending (newest first)
      const merged = [...killRefs, ...lossRefs]
      merged.sort((a, b) => b.killmail_id - a.killmail_id)
      refs = merged.slice(0, limit)
    } else {
      refs = (await fetchZkillPage(`kills/${zkillCat}/${id}/page/${page}/`)).slice(0, limit)
    }

    if (!refs.length) return res.json([])

    // Enrich each ref with the full ESI killmail (victim + attackers)
    const enriched = await Promise.all(
      refs.map(async ref => {
        const km = await fetchKillmail(ref.killmail_id, ref.zkb.hash)
        return { ...km, killmail_id: ref.killmail_id, zkb: ref.zkb }
      })
    )

    res.json(enriched)
  } catch (err) {
    console.error('zKill error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'zKill fetch failed' })
  }
})

// ── System security status lookup ─────────────────────────────────────────
// ── Route calculation ─────────────────────────────────────────────────────
// Proxies to ESI GET /route/{origin}/{destination}/ with all parameters.
// flag: 'shortest' | 'secure' | 'insecure'
// avoid: number[]
// connections: [number, number][]  (jump bridge pairs)
app.post('/api/eve/route', async (req, res) => {
  const { origin, destination, flag = 'shortest', avoid = [], connections = [] } = req.body
  if (!origin || !destination) return res.status(400).json({ error: 'origin and destination required' })

  try {
    // Build query string manually — ESI uses multi-value params for arrays
    const parts: string[] = [`flag=${flag}`, 'datasource=tranquility']
    for (const id of avoid) parts.push(`avoid[]=${id}`)
    // Connections: each pair as two consecutive avoid[][]-style entries
    for (const [a, b] of connections) {
      parts.push(`connections[][]=${a}`)
      parts.push(`connections[][]=${b}`)
    }

    const url = `https://esi.evetech.net/latest/route/${origin}/${destination}/?${parts.join('&')}`
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) {
      const body = await r.text()
      return res.status(r.status).json({ error: body })
    }
    const data = await r.json()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Route calculation failed' })
  }
})

app.get('/api/eve/system/:id', async (req, res) => {
  try {
    const response = await fetch(`https://esi.evetech.net/latest/universe/systems/${req.params.id}/`)
    if (!response.ok) return res.status(response.status).json({})
    res.json(await response.json())
  } catch {
    res.status(500).json({})
  }
})

// ── Jump bridges (Ansiblex gates accessible to character) ────────────────
// Searches for Ansiblex structures visible to the character, fetches details,
// and returns parsed { fromSystemId, destName } pairs.
const ANSIBLEX_TYPE_ID = 35841
app.post('/api/eve/jump-bridges', async (req, res) => {
  const { characterId, accessToken } = req.body
  if (!characterId || !accessToken) return res.status(400).json({ error: 'characterId and accessToken required' })

  const ESI = 'https://esi.evetech.net/latest'
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }

  try {
    // 1. Search for Ansiblex structures the character can see
    const searchUrl = `${ESI}/characters/${characterId}/search/?categories=structure&search=Ansiblex&strict=false`
    const searchRes = await fetch(searchUrl, { headers })
    if (!searchRes.ok) return res.json({ bridges: [] })

    const searchData = await searchRes.json()
    const structureIds: number[] = searchData.structure ?? []
    if (!structureIds.length) return res.json({ bridges: [] })

    // 2. Fetch structure details concurrently (cap at 300 to avoid ESI rate limits)
    const ids = structureIds.slice(0, 300)
    const details = await Promise.allSettled(
      ids.map(sid =>
        fetch(`${ESI}/universe/structures/${sid}/`, { headers })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    )

    // 3. Parse bridges: filter Ansiblex type, extract dest from name "... » DestSystem"
    const bridges: Array<{ fromSystemId: number; destName: string }> = []
    for (const result of details) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const s = result.value
      if (s.type_id !== ANSIBLEX_TYPE_ID) continue
      const match = (s.name as string)?.match(/»\s*(.+)$/)
      if (!match || !s.solar_system_id) continue
      bridges.push({ fromSystemId: s.solar_system_id, destName: match[1].trim() })
    }

    res.json({ bridges })
  } catch (e) {
    console.error('Jump bridge fetch error:', e)
    res.json({ bridges: [] })
  }
})

// ── EVE token refresh ──────────────────────────────────────────────────────
app.post('/api/eve/refresh', async (req, res) => {
  const { refresh_token } = req.body
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' })

  try {
    const credentials = Buffer.from(
      `${process.env.EVE_CLIENT_ID}:${process.env.EVE_CLIENT_SECRET}`
    ).toString('base64')

    const response = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
      }),
    })

    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Refresh failed' })
  }
})

// ── EVE Intel log reader ───────────────────────────────────────────────────
const CHATLOG_DIR = process.env.EVE_CHATLOG_DIR ||
  'C:\\Users\\kamii\\OneDrive\\Documents\\EVE\\logs\\Chatlogs'

const HOSTILE_KW = ['neut','neutral','hostile','red','nv','nb','combat','fleet','gang','blob','cyno','bubbl','camp','gatecamp','tackle','pointed','warp disrupt']
const CLEAR_KW   = ['clr','clear','safe','gone','left','docked','no one','empty','dock']

function categoriseMsg(msg: string): string {
  const lower = msg.toLowerCase()
  if (CLEAR_KW.some(k => lower.includes(k))) return 'clear'
  if (HOSTILE_KW.some(k => lower.includes(k))) return 'hostile'
  if (lower.startsWith('o/') || lower === 'o7' || lower.startsWith('gf')) return 'info'
  return 'neutral'
}

function parseEveLog(text: string) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
  let channelName = 'Unknown Channel'
  for (const line of lines.slice(0, 15)) {
    const m = line.match(/Channel Name:\s+(.+)/)
    if (m) { channelName = m[1].trim(); break }
  }

  const entries: Array<{ id: string; timestamp: string; character: string; message: string; category: string }> = []
  const re = /^\s*\[\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})\s*\]\s*([^>]+?)\s*>\s*(.+)$/
  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    const [, ts, character, message] = m
    if (character.trim() === 'EVE System') continue
    entries.push({
      id: `${ts}-${character.trim()}`,
      timestamp: ts.replace(/\./g, '-').replace(' ', 'T') + 'Z',
      character: character.trim(),
      message: message.trim(),
      category: categoriseMsg(message),
    })
  }

  return { channelName, entries: entries.reverse() }
}

app.get('/api/intel/:channel', (req, res) => {
  const channel = req.params.channel.toLowerCase()
  try {
    const files = readdirSync(CHATLOG_DIR)
      .filter(f => f.toLowerCase().startsWith(channel) && f.endsWith('.txt'))
      .map(f => ({ name: f, mtime: statSync(join(CHATLOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (!files.length) return res.json({ error: `No log file found for channel: ${channel}` })

    const filePath = join(CHATLOG_DIR, files[0].name)
    const buf = readFileSync(filePath)
    const text = buf.toString('utf16le').replace(/﻿/g, '')
    const parsed = parseEveLog(text)

    res.json({ ...parsed, file: files[0].name, lastModified: new Date(files[0].mtime).toISOString() })
  } catch (err) {
    console.error('Intel log error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read log' })
  }
})

// ── Fit database ─────────────────────────────────────────────────────────
interface SavedFit { id: string; name: string; shipType: string; fitText: string; createdAt: string }
const FITS_FILE = join(process.cwd(), 'fits.json')

function loadFits(): SavedFit[] {
  try { return existsSync(FITS_FILE) ? JSON.parse(readFileSync(FITS_FILE, 'utf8')) : [] }
  catch { return [] }
}
function saveFits(fits: SavedFit[]) {
  writeFileSync(FITS_FILE, JSON.stringify(fits, null, 2), 'utf8')
}
if (!existsSync(FITS_FILE)) saveFits([])

function parseFitHeader(text: string): { name: string; shipType: string } {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith('[') && t.includes(',')) {
      const inner = t.slice(1, t.lastIndexOf(']'))
      const comma = inner.indexOf(',')
      return { shipType: inner.slice(0, comma).trim(), name: inner.slice(comma + 1).trim() }
    }
  }
  return { name: 'Unknown Fit', shipType: 'Unknown Ship' }
}

app.get('/api/fits', (_req, res) => res.json(loadFits()))

app.post('/api/fits', (req, res) => {
  const { fitText } = req.body as { fitText?: string }
  if (!fitText?.trim()) return res.status(400).json({ error: 'fitText required' })
  const { name, shipType } = parseFitHeader(fitText)
  const fits = loadFits()
  const fit: SavedFit = { id: Date.now().toString(36), name, shipType, fitText: fitText.trim(), createdAt: new Date().toISOString() }
  fits.push(fit)
  saveFits(fits)
  return res.json(fit)
})

app.delete('/api/fits/:id', (req, res) => {
  const fits = loadFits().filter(f => f.id !== req.params.id)
  saveFits(fits)
  return res.json({ ok: true })
})

// ── Pronunciation dictionary ──────────────────────────────────────────────
interface PronunciationEntry { word: string; phonetic: string }
const PRONUNCIATIONS_FILE = join(process.cwd(), 'pronunciations.json')

function loadPronunciations(): PronunciationEntry[] {
  try { return existsSync(PRONUNCIATIONS_FILE) ? JSON.parse(readFileSync(PRONUNCIATIONS_FILE, 'utf8')) : [] }
  catch { return [] }
}
function savePronunciations(entries: PronunciationEntry[]) {
  writeFileSync(PRONUNCIATIONS_FILE, JSON.stringify(entries, null, 2), 'utf8')
}
if (!existsSync(PRONUNCIATIONS_FILE)) savePronunciations([])

app.get('/api/pronunciations', (_req, res) => res.json(loadPronunciations()))

app.post('/api/pronunciations', (req, res) => {
  const { word, phonetic } = req.body as { word?: string; phonetic?: string }
  if (!word?.trim() || !phonetic?.trim()) return res.status(400).json({ error: 'word and phonetic required' })
  const entries = loadPronunciations().filter(e => e.word.toLowerCase() !== word.trim().toLowerCase())
  entries.push({ word: word.trim(), phonetic: phonetic.trim() })
  savePronunciations(entries)
  return res.json({ ok: true })
})

app.delete('/api/pronunciations/:word', (req, res) => {
  const entries = loadPronunciations().filter(e => e.word.toLowerCase() !== req.params.word.toLowerCase())
  savePronunciations(entries)
  return res.json({ ok: true })
})

// ── TTS text extraction ────────────────────────────────────────────────────
// Pulls only speakable prose from a markdown response.
// Tables, code blocks, and separator lines are skipped entirely.
// mode controls how much is read: concise = first ~200 chars of prose,
// standard = prose up to ~500 chars, full = all prose.
function extractSpokenText(raw: string, mode: 'concise' | 'standard' | 'full'): string {
  const lines = raw.split('\n')
  const prose: string[] = []
  let inCode = false

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Toggle code blocks
    if (line.startsWith('```')) { inCode = !inCode; continue }
    if (inCode) continue

    // Skip table rows and separator lines
    if (line.startsWith('|') || /^[\s|:\-]+$/.test(line)) continue

    // Skip empty lines
    if (!line) continue

    // Strip markdown syntax → natural speech
    const text = line
      .replace(/^#{1,6}\s+/, '')                      // headings
      .replace(/\*\*([^*]+)\*\*/g, '$1')              // bold
      .replace(/\*([^*]+)\*/g, '$1')                  // italic
      .replace(/`([^`]+)`/g, '$1')                    // inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // links
      .replace(/^[-*+]\s+/, '')                        // bullet points
      .replace(/^\d+\.\s+/, '')                        // numbered lists
      .trim()

    if (text) prose.push(text)
  }

  const full = prose.join(' ').replace(/\s+/g, ' ').trim()
  const limit = mode === 'concise' ? 220 : mode === 'standard' ? 520 : Infinity
  if (!isFinite(limit) || full.length <= limit) return full

  // Break at the last sentence boundary before the limit
  const truncated = full.slice(0, limit)
  const lastEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? '),
  )
  return lastEnd > 80 ? full.slice(0, lastEnd + 1) : truncated.trimEnd() + '.'
}

// ── Number-to-words ───────────────────────────────────────────────────────
const _ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const _TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

// Converts a non-negative integer to its spoken English form (up to 999,999).
// Numbers beyond that range fall back to their digit string.
function intToWords(n: number): string {
  if (n === 0) return 'zero'
  if (n < 20)  return _ONES[n]
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10
    return o === 0 ? _TENS[t] : `${_TENS[t]}-${_ONES[o]}`
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), rest = n % 100
    return rest === 0
      ? `${_ONES[h]} hundred`
      : `${_ONES[h]} hundred ${intToWords(rest)}`
  }
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000), rest = n % 1000
    return rest === 0
      ? `${intToWords(th)} thousand`
      : `${intToWords(th)} thousand ${intToWords(rest)}`
  }
  // Beyond 999,999 — return digit string so we don't generate absurd output
  return n.toString()
}

// Converts a numeric string (integer or decimal) to spoken form.
// Integer part: full words. Decimal part: each digit spoken individually.
// e.g. "19.81" → "nineteen-point-eight-one"
//      "20"    → "twenty"
const _DIGIT_WORD = ['zero','one','two','three','four','five','six','seven','eight','nine']
function numberToWords(numStr: string): string {
  const [intPart, decPart] = numStr.split('.')
  const intWords = intToWords(parseInt(intPart, 10) || 0)
  if (!decPart) return intWords
  const decWords = decPart.split('').map(d => _DIGIT_WORD[parseInt(d)] ?? d).join('-')
  return `${intWords}-point-${decWords}`
}

// ── Speech normalization ───────────────────────────────────────────────────
// Converts EVE-specific notation into natural spoken forms before TTS.
// Runs after prose extraction, before the user pronunciation dictionary.
function normalizeForSpeech(text: string): string {
  let out = text

  // 1. Dates: YYYY-MM-DD → "Month the Nth, YYYY"
  //    Must run before time patterns so the DD doesn't get caught by \d+d
  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ]
  function ordinal(n: number): string {
    const s = ['th','st','nd','rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
  }
  out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) => {
    const month = MONTHS[parseInt(mo, 10) - 1] ?? mo
    return `${month} the ${ordinal(parseInt(d, 10))}, ${y}`
  })

  // 2. ISK amounts with suffix + optional "ISK" keyword.
  //    Number part is fully spoken (nineteen-point-eight-one billion ISK).
  //    Matches K / M / B / T (case-insensitive) but NOT V (skill level Roman numeral).
  const ISK_SUFFIX: Record<string, string> = { K: 'thousand', M: 'million', B: 'billion', T: 'trillion' }
  // With explicit ISK keyword
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*([KMBT])\s+ISK\b/gi, (_m, num, sfx) =>
    `${numberToWords(num)}-${ISK_SUFFIX[sfx.toUpperCase()]} ISK`
  )
  // Bare B / T suffix (unambiguous)
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*([BT])\b(?!\s*[A-Za-z])/g, (_m, num, sfx) =>
    `${numberToWords(num)}-${ISK_SUFFIX[sfx.toUpperCase()]}`
  )
  // Bare M / K — only when followed by whitespace/punctuation, not letters
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*([MK])\b(?=[^A-Za-z]|$)/g, (_m, num, sfx) =>
    `${numberToWords(num)}-${ISK_SUFFIX[sfx.toUpperCase()]}`
  )

  // 2b. Standalone decimal numbers not already consumed above.
  //     e.g. "1.2" → "one-point-two". Integers left as-is (too broad to expand safely).
  out = out.replace(/\b(\d+\.\d+)\b/g, (_m, num) => numberToWords(num))

  // 2c. ISK → lowercase "isk" so ElevenLabs reads it as a word /ɪsk/ not letters.
  //     Runs after all ISK-amount patterns so every remaining instance is caught.
  out = out.replace(/\bISK\b/g, 'isk')

  // 3. Time remaining: longest patterns first to avoid partial matches
  //    Handles combinations of d/h/m and pluralises correctly
  function plural(n: number, unit: string) { return `${n} ${unit}${n === 1 ? '' : 's'}` }

  // d h m
  out = out.replace(/\b(\d+)d\s+(\d+)h\s+(\d+)m\b/g, (_m, d, h, mn) =>
    [plural(+d,'day'), plural(+h,'hour'), plural(+mn,'minute')].join(' and ')
  )
  // d h
  out = out.replace(/\b(\d+)d\s+(\d+)h\b/g, (_m, d, h) =>
    `${plural(+d,'day')} and ${plural(+h,'hour')}`
  )
  // d m
  out = out.replace(/\b(\d+)d\s+(\d+)m\b/g, (_m, d, mn) =>
    `${plural(+d,'day')} and ${plural(+mn,'minute')}`
  )
  // h m
  out = out.replace(/\b(\d+)h\s+(\d+)m\b/g, (_m, h, mn) =>
    `${plural(+h,'hour')} and ${plural(+mn,'minute')}`
  )
  // bare d / h / m
  out = out.replace(/\b(\d+)d\b/g, (_m, d) => plural(+d, 'day'))
  out = out.replace(/\b(\d+)h\b/g, (_m, h) => plural(+h, 'hour'))
  out = out.replace(/\b(\d+)m\b/g, (_m, mn) => plural(+mn, 'minute'))

  // 4. EVE system codes: e.g. G-7WUF, 1DQ1-A, M-OEE8
  //    Hyphen → "tack". Each letter → its spoken name. Each digit → its word.
  //    e.g. G-7WUF → "gee tack seven double-you you eff"
  const LETTER_PHONETICS: Record<string, string> = {
    A: 'ay',   B: 'bee',   C: 'see',  D: 'dee', E: 'ee',  F: 'eff',
    G: 'gee',  H: 'aitch', I: 'eye',  J: 'jay', K: 'kay', L: 'el',
    M: 'em',   N: 'en',    O: 'oh',   P: 'pee', Q: 'cue', R: 'ar',
    S: 'ess',  T: 'tee',   U: 'you',  V: 'vee', W: 'double-you',
    X: 'ex',   Y: 'why',   Z: 'zee',
  }
  const DIGIT_WORDS: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two',   '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  }
  out = out.replace(/\b([A-Z0-9]{1,4}-[A-Z0-9]{1,5})\b/g, (match) =>
    match.split('').map(c =>
      c === '-'              ? 'tack'
      : DIGIT_WORDS[c]      ? DIGIT_WORDS[c]
      : LETTER_PHONETICS[c] ? LETTER_PHONETICS[c]
      : c
    ).join(' ')
  )

  // 5. Long numeric IDs (10+ digits) → comma-separated spoken digits for paced TTS.
  //    e.g. 1047177040758 → "1, 0, 4, 7, 1, 7, 7, 0, 4, 0, 7, 5, 8"
  out = out.replace(/\b(\d{10,})\b/g, (match) =>
    match.split('').join(', ')
  )

  return out
}

// ── Fit Analyzer ──────────────────────────────────────────────────────────

// Cache type info (name, required_skills, rank) for the server's lifetime
const fitTypeInfoCache = new Map<number, {
  name: string
  requiredSkills: { skill_id: number; level: number }[]
  rank: number
}>()

// Dogma attribute IDs for required skills (up to 6 skill slots)
const SKILL_TYPE_ATTR_IDS  = [182, 183, 184, 1285, 1289, 1290]
const SKILL_LEVEL_ATTR_IDS = [277, 278, 279,  1286, 1287, 1288]

async function getFitTypeInfo(typeId: number) {
  if (fitTypeInfoCache.has(typeId)) return fitTypeInfoCache.get(typeId)!
  const info = await throttledEsiGet<{
    name: string
    dogma_attributes?: { attribute_id: number; value: number }[]
  }>(`/universe/types/${typeId}/?datasource=tranquility`)
  const attrs = info.dogma_attributes ?? []
  const attrMap = new Map(attrs.map(a => [a.attribute_id, a.value]))

  // attr 275 = skillTimeConstant (rank)
  const rank = attrMap.get(275) ?? 1

  // Extract required skills from dogma attribute pairs
  const requiredSkills: { skill_id: number; level: number }[] = []
  for (let i = 0; i < SKILL_TYPE_ATTR_IDS.length; i++) {
    const skillTypeId = attrMap.get(SKILL_TYPE_ATTR_IDS[i])
    const skillLevel  = attrMap.get(SKILL_LEVEL_ATTR_IDS[i])
    if (skillTypeId !== undefined && skillLevel !== undefined) {
      requiredSkills.push({ skill_id: Math.round(skillTypeId), level: Math.round(skillLevel) })
    }
  }

  const result = { name: info.name, requiredSkills, rank }
  fitTypeInfoCache.set(typeId, result)
  return result
}

// Recursively collect all required skills (including prereqs) for a set of item typeIds.
// Returns a map of skillId → { skillName, level, rank }
async function collectRequiredSkills(
  itemTypeIds: number[]
): Promise<Map<number, { skillName: string; level: number; rank: number }>> {
  const result = new Map<number, { skillName: string; level: number; rank: number }>()
  const visited = new Set<number>()

  async function visit(typeId: number, asSkillLevel?: number) {
    if (visited.has(typeId)) {
      // Still update level if higher
      if (asSkillLevel !== undefined) {
        const ex = result.get(typeId)
        if (ex && asSkillLevel > ex.level) ex.level = asSkillLevel
      }
      return
    }
    visited.add(typeId)

    let info
    try { info = await getFitTypeInfo(typeId) } catch { return }

    if (asSkillLevel !== undefined) {
      result.set(typeId, { skillName: info.name, level: asSkillLevel, rank: info.rank })
    }

    for (const req of info.requiredSkills) {
      const ex = result.get(req.skill_id)
      const effectiveLevel = ex ? Math.max(ex.level, req.level) : req.level
      if (ex) ex.level = effectiveLevel
      await visit(req.skill_id, effectiveLevel)
    }
  }

  await Promise.all(itemTypeIds.map(id => visit(id)))
  return result
}

// SP required to reach a given level (absolute, not incremental) for rank 1.
// Multiply by rank to get actual SP.
const SP_FOR_LEVEL = [0, 250, 1415, 8000, 45255, 256000]

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || parts.length === 0) parts.push(`${m}m`)
  return parts.join(' ')
}

interface CharSkillInput {
  skillId: number
  trainedLevel: number
  skillpointsInSkill: number
}

app.post('/api/skills/analyze-fit', async (req, res) => {
  const { fitText, skills: charSkills = [] } = req.body as {
    fitText: string
    skills: CharSkillInput[]
  }
  if (!fitText?.trim()) return res.status(400).json({ error: 'fitText required' })

  // Parse EFT fit format
  const lines = fitText.trim().split('\n').map(l => l.trim())
  let fitName = 'Unknown Fit'
  const itemNames: string[] = []

  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('[') && line.includes(',')) {
      const inner = line.slice(1, line.lastIndexOf(']'))
      const comma = inner.indexOf(',')
      const shipType = inner.slice(0, comma).trim()
      fitName = inner.slice(comma + 1).trim()
      if (shipType) itemNames.push(shipType)
      continue
    }
    if (line.startsWith('[') || line.startsWith('//') || line.startsWith('-')) continue
    // Strip quantity suffix (e.g. "Valkyrie II x5") and ignore cargo/charge lines
    // Charges/ammo lines come after the blank section separator; keep all module lines
    const withoutQty = line.replace(/\s+x\d+\s*$/, '').trim()
    if (withoutQty) itemNames.push(withoutQty)
  }

  const uniqueNames = [...new Set(itemNames)]
  if (uniqueNames.length === 0) return res.status(400).json({ error: 'No items found in fit' })

  console.log('[fit-analyzer] parsed item names:', uniqueNames)

  try {
    // Resolve item names → typeIds
    const resolveRes = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uniqueNames),
    })
    if (!resolveRes.ok) return res.status(502).json({ error: 'ESI name resolution failed' })
    const resolved = await resolveRes.json() as { inventory_types?: { id: number; name: string }[] }
    const resolvedTypes = resolved.inventory_types ?? []
    const typeIds = resolvedTypes.map(t => t.id)
    console.log('[fit-analyzer] resolved typeIds:', resolvedTypes.map(t => `${t.name}=${t.id}`))

    if (typeIds.length === 0) return res.status(400).json({ error: 'Could not resolve any item typeIds', parsedNames: uniqueNames })

    // Clear stale cache entries so the dogma-attribute fix applies to already-fetched types
    for (const id of typeIds) fitTypeInfoCache.delete(id)

    // Sample-check first typeId to confirm dogma skill extraction works
    if (typeIds.length > 0) {
      try {
        const sample = await getFitTypeInfo(typeIds[0])
        console.log(`[fit-analyzer] sample type ${typeIds[0]} → name="${sample.name}" rank=${sample.rank} requiredSkills=${JSON.stringify(sample.requiredSkills)}`)
      } catch (e) { console.log('[fit-analyzer] sample fetch error:', e) }
    }

    // Collect all required skills recursively
    const requiredSkillMap = await collectRequiredSkills(typeIds)
    console.log('[fit-analyzer] collected required skills count:', requiredSkillMap.size)

    // Build a lookup from the character's trained skills
    const charSkillMap = new Map(charSkills.map(s => [s.skillId, s]))

    // Build result: one entry per required skill
    const SP_PER_HOUR = 2500
    let totalTrainingSeconds = 0

    const allRequired: {
      skillId: number
      skillName: string
      requiredLevel: number
      rank: number
      currentLevel: number
      missing: boolean
      trainingSeconds: number
    }[] = []

    for (const [skillId, { skillName, level: requiredLevel, rank }] of requiredSkillMap) {
      const charSkill = charSkillMap.get(skillId)
      const currentLevel = charSkill?.trainedLevel ?? 0
      const currentSP = charSkill?.skillpointsInSkill ?? 0
      const missing = currentLevel < requiredLevel

      let trainingSeconds = 0
      if (missing) {
        const targetSP = SP_FOR_LEVEL[requiredLevel] * rank
        const spNeeded = Math.max(0, targetSP - currentSP)
        trainingSeconds = Math.round((spNeeded / SP_PER_HOUR) * 3600)
        totalTrainingSeconds += trainingSeconds
      }

      allRequired.push({ skillId, skillName, requiredLevel, rank, currentLevel, missing, trainingSeconds })
    }

    // Sort: missing first, then by training time desc
    allRequired.sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? -1 : 1
      return b.trainingSeconds - a.trainingSeconds
    })

    const missingSkills = allRequired.filter(s => s.missing)

    // Build importable skill plan text (ordered by dependency: prereqs first)
    // Simple approach: sort by rank ascending so lower-rank prereqs come first
    const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
    const skillPlanLines = missingSkills
      .sort((a, b) => a.rank - b.rank)
      .map(s => `${s.skillName} ${s.requiredLevel}`)
    const skillPlanText = skillPlanLines.join('\n')

    res.json({
      fitName,
      allRequired,
      missingSkills,
      _debug: { parsedNames: uniqueNames, resolvedCount: typeIds.length, requiredSkillCount: requiredSkillMap.size },
      totalTrainingSeconds,
      trainingTimeFormatted: formatDuration(totalTrainingSeconds),
      skillPlanText,
      itemCount: typeIds.length,
    })
  } catch (err) {
    console.error('Fit analyze error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' })
  }
})

// Apply pronunciation substitutions (whole-word, case-insensitive)
function applyPronunciations(text: string, entries: PronunciationEntry[]): string {
  let out = text
  for (const { word, phonetic } of entries) {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    out = out.replace(pattern, phonetic)
  }
  return out
}

// ── ElevenLabs TTS proxy ──────────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const { text, mode = 'standard', variant = 'cute' } = req.body as { text: string; mode?: 'concise' | 'standard' | 'full'; variant?: 'cute' | 'hot' }
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = variant === 'hot'
    ? (process.env.ELEVENLABS_VOICE_ID_HOT || process.env.ELEVENLABS_VOICE_ID)
    : process.env.ELEVENLABS_VOICE_ID
  if (!apiKey || !voiceId) return res.status(503).json({ error: 'ElevenLabs not configured' })

  const pronunciations = loadPronunciations()
  const extracted = extractSpokenText(text, mode)
  const normalized = normalizeForSpeech(extracted)
  const spoken = applyPronunciations(normalized, pronunciations)

  if (!spoken) return res.status(400).json({ error: 'No speakable text' })

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: spoken,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error('ElevenLabs error:', response.status, err)
      return res.status(response.status).json({ error: `ElevenLabs: ${response.status}` })
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Transfer-Encoding', 'chunked')
    const reader = response.body!.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    console.error('TTS error:', err)
    res.status(500).json({ error: 'TTS failed' })
  }
})

app.listen(PORT, () => {
  console.log(`Aurora server running on http://localhost:${PORT}`)
})

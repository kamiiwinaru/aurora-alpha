const ESI_BASE = 'https://esi.evetech.net/latest'
const SSO_BASE = 'https://login.eveonline.com'

const EVE_CLIENT_ID = import.meta.env.VITE_EVE_CLIENT_ID || ''
const EVE_CALLBACK_URL = import.meta.env.VITE_EVE_CALLBACK_URL || 'http://localhost:5173/eve/callback'

const SCOPES = [
  // Skills
  'esi-skills.read_skills.v1',
  'esi-skills.read_skillqueue.v1',
  // Assets & blueprints
  'esi-assets.read_assets.v1',
  'esi-characters.read_blueprints.v1',
  // Industry
  'esi-industry.read_character_jobs.v1',
  'esi-industry.read_character_mining.v1',
  // Market & wallet
  'esi-markets.read_character_orders.v1',
  'esi-markets.structure_markets.v1',
  'esi-wallet.read_character_wallet.v1',
  // Character data
  'esi-characters.read_corporation_roles.v1',
  'esi-characters.read_standings.v1',
  'esi-characters.read_contacts.v1',
  'esi-characters.read_notifications.v1',
  'esi-characters.read_loyalty.v1',
  'esi-characters.read_fatigue.v1',
  // Location
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  // Clones
  'esi-clones.read_clones.v1',
  // Contracts
  'esi-contracts.read_character_contracts.v1',
  'esi-contracts.read_corporation_contracts.v1',
  // Kill mails
  'esi-killmails.read_killmails.v1',
  // Planetary interaction
  'esi-planets.manage_planets.v1',
  // Calendar
  'esi-calendar.read_calendar_events.v1',
  // Mail
  'esi-mail.read_mail.v1',
  'esi-mail.send_mail.v1',
  'esi-mail.organize_mail.v1',
  // Universe (player-owned structure names)
  'esi-universe.read_structures.v1',
  // Search (jump bridge / Ansiblex discovery)
  'esi-search.search_structures.v1',
].join(' ')

export function getEveLoginUrl(): string {
  const state = crypto.randomUUID()
  sessionStorage.setItem('eve_oauth_state', state)
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: EVE_CALLBACK_URL,
    client_id: EVE_CLIENT_ID,
    scope: SCOPES,
    state,
  })
  return `${SSO_BASE}/v2/oauth/authorize?${params}`
}

export async function exchangeEveCode(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const res = await fetch('/api/eve/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error('Token exchange failed')
  return res.json()
}

async function esiGet<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${ESI_BASE}${path}`, { headers })
  if (!res.ok) throw new Error(`ESI error: ${res.status} ${path}`)
  return res.json()
}

// Fetches all pages of a paginated ESI endpoint in parallel after reading X-Pages from page 1.
async function esiGetPaged<T>(path: string, token: string): Promise<T[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  const sep = path.includes('?') ? '&' : '?'

  // Fetch page 1 to get total page count
  const first = await fetch(`${ESI_BASE}${path}${sep}page=1`, { headers })
  if (!first.ok) throw new Error(`ESI error: ${first.status} ${path}`)
  const totalPages = parseInt(first.headers.get('X-Pages') ?? '1', 10)
  const page1: T[] = await first.json()

  if (totalPages <= 1) return page1

  // Fetch remaining pages in parallel
  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      fetch(`${ESI_BASE}${path}${sep}page=${i + 2}`, { headers })
        .then(r => r.ok ? r.json() as Promise<T[]> : Promise.resolve([] as T[]))
    )
  )

  return [page1, ...rest].flat()
}

export async function getCharacterInfo(token: string): Promise<{
  CharacterID: number
  CharacterName: string
  CorporationID: number
}> {
  const res = await fetch('https://esi.evetech.net/verify', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Character verify failed')
  return res.json()
}

export async function getSkills(characterId: number, token: string) {
  return esiGet<{ skills: Array<{ skill_id: number; active_skill_level: number; trained_skill_level: number; skillpoints_in_skill: number }> }>(
    `/characters/${characterId}/skills/`,
    token
  )
}

export async function getSkillQueue(characterId: number, token: string) {
  return esiGet<Array<{
    skill_id: number
    finished_level: number
    queue_position: number
    start_date?: string
    finish_date?: string
    level_start_sp?: number
    level_end_sp?: number
    training_start_sp?: number
  }>>(`/characters/${characterId}/skillqueue/`, token)
}

export async function getAssets(characterId: number, token: string) {
  return esiGetPaged<{
    item_id: number
    type_id: number
    location_id: number
    location_type: string   // 'station' | 'solar_system' | 'other' (ship/container)
    location_flag: string   // 'Hangar' | 'Cargo' | 'LockedItem' | etc.
    quantity: number
    is_blueprint_copy?: boolean
  }>(`/characters/${characterId}/assets/`, token)
}

// Resolves player-owned structure names via authenticated ESI.
// /universe/names/ returns 404 for these; they need individual authenticated calls.
export async function resolveStructureNames(structureIds: number[], token: string): Promise<Record<number, string>> {
  if (!structureIds.length) return {}
  const results = await Promise.allSettled(
    structureIds.map(async id => {
      const res = await fetch(`${ESI_BASE}/universe/structures/${id}/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json() as { name: string }
      return { id, name: data.name }
    })
  )
  const out: Record<number, string> = {}
  for (const r of results) {
    if (r.status === 'fulfilled') out[r.value.id] = r.value.name
  }
  return out
}

// Returns player-assigned custom names for renamed items (containers, ships, etc.)
export async function getAssetNames(characterId: number, token: string, itemIds: number[]) {
  if (!itemIds.length) return [] as Array<{ item_id: number; name: string }>
  // ESI accepts up to 1000 IDs per call
  const results: Array<{ item_id: number; name: string }> = []
  for (let i = 0; i < itemIds.length; i += 1000) {
    try {
      const res = await fetch(`${ESI_BASE}/characters/${characterId}/assets/names/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(itemIds.slice(i, i + 1000)),
      })
      if (res.ok) results.push(...(await res.json() as Array<{ item_id: number; name: string }>))
    } catch { /* skip — names are optional */ }
  }
  return results
}


export async function getIndustryJobs(characterId: number, token: string) {
  return esiGet<Array<{
    job_id: number
    activity_id: number
    blueprint_type_id: number
    output_location_id: number
    runs: number
    status: string
    start_date: string
    end_date: string
    facility_id: number
  }>>(`/characters/${characterId}/industry/jobs/?include_completed=false`, token)
}

export async function getMarketOrders(characterId: number, token: string) {
  return esiGet<Array<{
    order_id: number
    type_id: number
    location_id: number
    volume_total: number
    volume_remain: number
    price: number
    is_buy_order: boolean
    issued: string
    duration: number
    state: string
  }>>(`/characters/${characterId}/orders/`, token)
}

export async function getTypeInfo(typeId: number): Promise<{ name: string; description: string }> {
  return esiGet(`/universe/types/${typeId}/`)
}

export async function getMarketPrice(typeId: number, regionId = 10000002): Promise<{ average: number; highest: number; lowest: number }> {
  const orders = await esiGet<Array<{ price: number; is_buy_order: boolean; volume_remain: number }>>(
    `/markets/${regionId}/orders/?type_id=${typeId}`
  )
  const prices = orders.map(o => o.price)
  if (!prices.length) return { average: 0, highest: 0, lowest: 0 }
  return {
    average: prices.reduce((a, b) => a + b, 0) / prices.length,
    highest: Math.max(...prices),
    lowest: Math.min(...prices),
  }
}

export const ACTIVITY_NAMES: Record<number, string> = {
  1: 'Manufacturing',
  3: 'Researching TE',
  4: 'Researching ME',
  5: 'Copying',
  7: 'Reverse Engineering',
  8: 'Invention',
  9: 'Reactions',
}

// ── Bulk name resolution (up to 1000 IDs per call) ────────────────────────
export async function resolveIds(ids: number[]): Promise<Record<number, string>> {
  if (!ids.length) return {}
  const result: Record<number, string> = {}
  // Player-owned structure IDs (>1e12) are not supported by /universe/names/ — skip them
  const resolvable = ids.filter(id => id < 1_000_000_000_000)
  for (let i = 0; i < resolvable.length; i += 1000) {
    const chunk = resolvable.slice(i, i + 1000)
    try {
      const res = await fetch(`${ESI_BASE}/universe/names/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      })
      if (res.ok) {
        const data: Array<{ id: number; name: string }> = await res.json()
        for (const item of data) result[item.id] = item.name
      }
    } catch { /* skip failed chunk */ }
  }
  return result
}

// ── Wallet ─────────────────────────────────────────────────────────────────
export async function getWalletBalance(characterId: number, token: string): Promise<number> {
  return esiGet<number>(`/characters/${characterId}/wallet/`, token)
}

export async function getWalletJournal(characterId: number, token: string) {
  return esiGet<Array<{
    id: number
    date: string
    ref_type: string
    amount?: number
    balance?: number
    description?: string
    first_party_id?: number
    second_party_id?: number
  }>>(`/characters/${characterId}/wallet/journal/?page=1`, token)
}

export async function getWalletTransactions(characterId: number, token: string) {
  return esiGet<Array<{
    transaction_id: number
    date: string
    type_id: number
    quantity: number
    unit_price: number
    is_buy: boolean
    client_id: number
    location_id: number
  }>>(`/characters/${characterId}/wallet/transactions/`, token)
}

// ── Blueprints ─────────────────────────────────────────────────────────────
export async function getBlueprints(characterId: number, token: string) {
  return esiGetPaged<{
    item_id: number
    type_id: number
    location_id: number
    material_efficiency: number
    time_efficiency: number
    runs: number
    quantity: number
  }>(`/characters/${characterId}/blueprints/`, token)
}

// ── Character attributes & implants ───────────────────────────────────────
export async function getCharacterAttributes(characterId: number, token: string) {
  return esiGet<{
    charisma: number
    intelligence: number
    memory: number
    perception: number
    willpower: number
    bonus_remaps?: number
    last_remap_date?: string
    accrued_remap_cooldown_date?: string
  }>(`/characters/${characterId}/attributes/`, token)
}

export async function getImplants(characterId: number, token: string): Promise<number[]> {
  return esiGet<number[]>(`/characters/${characterId}/implants/`, token)
}

// ── Clones & jump clones ───────────────────────────────────────────────────
export async function getClones(characterId: number, token: string) {
  return esiGet<{
    home_location?: { location_id: number; location_type: string }
    jump_clones: Array<{
      jump_clone_id: number
      location_id: number
      location_type: string
      implants: number[]
    }>
    last_jump_date?: string
  }>(`/characters/${characterId}/clones/`, token)
}

// ── Location & ship ────────────────────────────────────────────────────────
export async function getLocation(characterId: number, token: string) {
  return esiGet<{
    solar_system_id: number
    station_id?: number
    structure_id?: number
  }>(`/characters/${characterId}/location/`, token)
}

export async function getCurrentShip(characterId: number, token: string) {
  return esiGet<{
    ship_item_id: number
    ship_name: string
    ship_type_id: number
  }>(`/characters/${characterId}/ship/`, token)
}

// ── Standings ──────────────────────────────────────────────────────────────
export async function getStandings(characterId: number, token: string) {
  return esiGet<Array<{
    from_id: number
    from_type: string
    standing: number
  }>>(`/characters/${characterId}/standings/`, token)
}

// ── Contracts ─────────────────────────────────────────────────────────────
export async function getContracts(characterId: number, token: string) {
  return esiGet<Array<{
    contract_id: number
    type: string
    status: string
    title?: string
    issuer_id: number
    assignee_id: number
    date_issued: string
    date_expired: string
    price?: number
    volume?: number
    for_corporation: boolean
  }>>(`/characters/${characterId}/contracts/`, token)
}

export async function getAllianceContracts(allianceId: number, token: string) {
  return esiGet<Array<{
    contract_id: number
    type: string
    status: string
    title?: string
    issuer_id: number
    assignee_id: number
    date_issued: string
    date_expired: string
    price?: number
    volume?: number
    for_corporation: boolean
  }>>(`/alliances/${allianceId}/contracts/`, token)
}

export async function getCorporationContracts(corporationId: number, token: string) {
  return esiGet<Array<{
    contract_id: number
    type: string
    status: string
    title?: string
    issuer_id: number
    assignee_id: number
    date_issued: string
    date_expired: string
    price?: number
    volume?: number
    for_corporation: boolean
  }>>(`/corporations/${corporationId}/contracts/`, token)
}

export async function getContractItems(characterId: number, contractId: number, token: string) {
  return esiGet<Array<{
    record_id: number
    type_id: number
    quantity: number
    is_included: boolean
    is_singleton: boolean
    raw_quantity?: number
  }>>(`/characters/${characterId}/contracts/${contractId}/items/`, token)
}

export async function getContractBids(characterId: number, contractId: number, token: string) {
  return esiGet<Array<{
    bid_id: number
    bidder_id: number
    date_bid: string
    amount: number
  }>>(`/characters/${characterId}/contracts/${contractId}/bids/`, token)
}

// ── Mining ledger ──────────────────────────────────────────────────────────
export async function getMiningLedger(characterId: number, token: string) {
  return esiGet<Array<{
    date: string
    solar_system_id: number
    type_id: number
    quantity: number
  }>>(`/characters/${characterId}/mining/`, token)
}

// ── Kill mails ─────────────────────────────────────────────────────────────
export async function getKillmails(characterId: number, token: string) {
  return esiGet<Array<{
    killmail_id: number
    killmail_hash: string
  }>>(`/characters/${characterId}/killmails/recent/`, token)
}

export async function getKillmailDetail(killmailId: number, hash: string) {
  return esiGet<{
    killmail_id: number
    killmail_time: string
    solar_system_id: number
    victim: {
      character_id?: number
      ship_type_id: number
      items?: unknown[]
    }
    attackers: Array<{ character_id?: number; ship_type_id?: number; final_blow: boolean }>
  }>(`/killmails/${killmailId}/${hash}/`)
}

// ── Loyalty points ─────────────────────────────────────────────────────────
export async function getLoyaltyPoints(characterId: number, token: string) {
  return esiGet<Array<{
    corporation_id: number
    loyalty_points: number
  }>>(`/characters/${characterId}/loyalty/points/`, token)
}

// ── Notifications ─────────────────────────────────────────────────────────
export async function getNotifications(characterId: number, token: string) {
  return esiGet<Array<{
    notification_id: number
    type: string
    timestamp: string
    text?: string
    is_read?: boolean
  }>>(`/characters/${characterId}/notifications/`, token)
}

// ── Fatigue ────────────────────────────────────────────────────────────────
export async function getFatigue(characterId: number, token: string) {
  return esiGet<{
    jump_fatigue_expire_date?: string
    last_jump_date?: string
    last_update_date?: string
  }>(`/characters/${characterId}/fatigue/`, token)
}

// ── Planetary interaction ──────────────────────────────────────────────────
export async function getPlanets(characterId: number, token: string) {
  return esiGet<Array<{
    last_update: string
    num_pins: number
    owner_id: number
    planet_id: number
    planet_type: string
    solar_system_id: number
    upgrade_level: number
  }>>(`/characters/${characterId}/planets/`, token)
}

// ── Calendar ───────────────────────────────────────────────────────────────
export async function getCalendarEvents(characterId: number, token: string) {
  return esiGet<Array<{
    event_id: number
    event_date: string
    title: string
    importance: number
    event_response: string
  }>>(`/characters/${characterId}/calendar/`, token)
}

// ── Mail ───────────────────────────────────────────────────────────────────
export async function getMailHeaders(characterId: number, token: string) {
  return esiGet<Array<{
    mail_id: number
    subject: string
    from: number
    timestamp: string
    is_read?: boolean
    recipients: Array<{ recipient_id: number; recipient_type: string }>
    labels?: number[]
  }>>(`/characters/${characterId}/mail/`, token)
}

export async function getMailLabels(characterId: number, token: string) {
  return esiGet<{
    labels?: Array<{ label_id: number; name: string; unread_count?: number; color?: string }>
    total_unread_count?: number
  }>(`/characters/${characterId}/mail/labels/`, token)
}

export async function getMailBody(characterId: number, mailId: number, token: string) {
  return esiGet<{
    mail_id: number
    subject: string
    from: number
    timestamp: string
    is_read?: boolean
    body: string
    recipients: Array<{ recipient_id: number; recipient_type: string }>
    labels?: number[]
  }>(`/characters/${characterId}/mail/${mailId}/`, token)
}

export async function sendMail(characterId: number, token: string, recipients: Array<{ recipient_id: number; recipient_type: 'character' | 'corporation' | 'alliance' | 'mailing_list' }>, subject: string, body: string) {
  const res = await fetch(`${ESI_BASE}/characters/${characterId}/mail/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients, subject, body }),
  })
  if (!res.ok) throw new Error(`ESI sendMail ${res.status}`)
  return res.json() as Promise<number>
}

export async function markMailRead(characterId: number, mailId: number, token: string) {
  const res = await fetch(`${ESI_BASE}/characters/${characterId}/mail/${mailId}/`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: true }),
  })
  if (!res.ok) throw new Error(`ESI markMailRead ${res.status}`)
}

// ── Public character info ──────────────────────────────────────────────────
export async function getPublicCharacterInfo(characterId: number) {
  return esiGet<{
    name: string
    birthday: string
    race_id: number
    bloodline_id: number
    corporation_id: number
    alliance_id?: number
    security_status: number
    title?: string
  }>(`/characters/${characterId}/`)
}

export function formatISK(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value.toFixed(2)
}

export function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'Complete'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

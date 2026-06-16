import { useState, useEffect, useCallback } from 'react'
import type {
  EveCharacter, EveSkill, EveSkillQueueItem, EveAsset, EveIndustryJob, EveMarketOrder,
  EveWalletTransaction, EveWalletJournalEntry, EveBlueprint, EveCharacterAttributes,
  EveImplant, EveJumpClone, EveShipLocation, EveStanding, EveContract,
  EveMiningEntry, EveKillmail, EveLoyaltyPoint, EveNotification, EveMail, EveMailLabel, EveMailingList,
} from '../types'
import {
  getSkills, getSkillQueue, getAssets, getIndustryJobs, getMarketOrders,
  getTypeInfo, ACTIVITY_NAMES, resolveIds,
  getWalletBalance, getWalletJournal, getWalletTransactions,
  getBlueprints, getCharacterAttributes, getClones,
  getLocation, getCurrentShip, getStandings, getContracts, getCorporationContracts,
  getMiningLedger, getKillmails, getKillmailDetail,
  getLoyaltyPoints, getNotifications, getFatigue, getPlanets,
  getCalendarEvents, getPublicCharacterInfo, getMailHeaders, getMailLabels, getMailingLists,
  getAssetNames,
} from '../lib/eve-esi'

const CHARACTERS_KEY = 'aurora_eve_characters'
const ACTIVE_KEY = 'aurora_eve_active'

function loadCharacters(): EveCharacter[] {
  try {
    const raw = localStorage.getItem(CHARACTERS_KEY)
    if (raw) return JSON.parse(raw)
    // Migrate from old single-character storage
    const legacy = localStorage.getItem('aurora_eve_character')
    if (legacy) {
      const char = JSON.parse(legacy)
      localStorage.setItem(CHARACTERS_KEY, JSON.stringify([char]))
      localStorage.removeItem('aurora_eve_character')
      return [char]
    }
    return []
  } catch { return [] }
}

function saveCharacters(chars: EveCharacter[]) {
  localStorage.setItem(CHARACTERS_KEY, JSON.stringify(chars))
}

function loadActiveId(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveActiveId(id: number | null) {
  if (id === null) localStorage.removeItem(ACTIVE_KEY)
  else localStorage.setItem(ACTIVE_KEY, JSON.stringify(id))
}

const WALLET_CACHE_KEY = 'aurora_wallet_balances'

function loadWalletCache(): Record<number, number> {
  try {
    const raw = localStorage.getItem(WALLET_CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveWalletCache(cache: Record<number, number>) {
  localStorage.setItem(WALLET_CACHE_KEY, JSON.stringify(cache))
}

// Shared type name cache — pre-populated from localStorage so ESI calls are
// only needed for type IDs never seen before across any session.
const typeNameCache: Record<number, string> = (() => {
  try { return JSON.parse(localStorage.getItem('aurora_type_names') ?? '{}') } catch { return {} }
})()

// Run async tasks with at most `limit` concurrent in-flight at a time
async function throttledAll<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = []
  let i = 0
  async function worker() {
    while (i < tasks.length) {
      const idx = i++
      results[idx] = await tasks[idx]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

async function resolveTypeNames(typeIds: number[]): Promise<Record<number, string>> {
  const uncached = [...new Set(typeIds)].filter(id => !typeNameCache[id])
  if (uncached.length) {
    const bulk = await resolveIds(uncached)
    for (const [id, name] of Object.entries(bulk)) {
      typeNameCache[Number(id)] = name
    }
    const stillMissing = uncached.filter(id => !typeNameCache[id])
    await throttledAll(stillMissing.map(id => async () => {
      try {
        const info = await getTypeInfo(id)
        typeNameCache[id] = info.name
      } catch { typeNameCache[id] = `Type ${id}` }
    }), 5)
    // Persist newly resolved names so future sessions skip ESI entirely
    try { localStorage.setItem('aurora_type_names', JSON.stringify(typeNameCache)) } catch { /* storage full */ }
  }
  const result: Record<number, string> = {}
  for (const id of typeIds) result[id] = typeNameCache[id] ?? `Type ${id}`
  return result
}

// NPC station name cache — persisted to localStorage; station names never change.
const stationNameCache: Record<number, string> = (() => {
  try { return JSON.parse(localStorage.getItem('aurora_station_names') ?? '{}') } catch { return {} }
})()

async function resolveStationNames(locationIds: number[]): Promise<Record<number, string>> {
  const uncached = [...new Set(locationIds)].filter(id => !stationNameCache[id])
  if (uncached.length) {
    const resolved = await resolveIds(uncached)
    for (const [id, name] of Object.entries(resolved)) stationNameCache[Number(id)] = name
    try { localStorage.setItem('aurora_station_names', JSON.stringify(stationNameCache)) } catch { /* storage full */ }
  }
  const result: Record<number, string> = {}
  for (const id of locationIds) result[id] = stationNameCache[id] ?? `Location ${id}`
  return result
}

export function useEve() {
  const [characters, setCharacters] = useState<EveCharacter[]>(loadCharacters)
  const [activeCharacterId, setActiveCharacterId] = useState<number | null>(() => {
    const saved = loadActiveId()
    const chars = loadCharacters()
    // Fall back to first character if saved ID no longer exists
    if (saved && chars.some(c => c.characterId === saved)) return saved
    return chars[0]?.characterId ?? null
  })

  const character = characters.find(c => c.characterId === activeCharacterId) ?? null

  // Core
  const [skills, setSkills] = useState<EveSkill[]>([])
  const [skillQueue, setSkillQueue] = useState<EveSkillQueueItem[]>([])
  const [assets, setAssets] = useState<EveAsset[]>([])
  const [industryJobs, setIndustryJobs] = useState<EveIndustryJob[]>([])
  const [marketOrders, setMarketOrders] = useState<EveMarketOrder[]>([])

  // Wallet
  const [walletBalance, setWalletBalance] = useState<number>(0)
  const [walletTransactions, setWalletTransactions] = useState<EveWalletTransaction[]>([])
  const [walletJournal, setWalletJournal] = useState<EveWalletJournalEntry[]>([])
  const [allWalletJournals, setAllWalletJournals] = useState<Record<number, EveWalletJournalEntry[]>>({})
  const [allWalletTransactions, setAllWalletTransactions] = useState<Record<number, EveWalletTransaction[]>>({})

  // Blueprints
  const [blueprints, setBlueprints] = useState<EveBlueprint[]>([])

  // Character
  const [attributes, setAttributes] = useState<EveCharacterAttributes | null>(null)
  const [implants, setImplants] = useState<EveImplant[]>([])
  const [jumpClones, setJumpClones] = useState<EveJumpClone[]>([])
  const [shipLocation, setShipLocation] = useState<EveShipLocation | null>(null)
  const [standings, setStandings] = useState<EveStanding[]>([])
  const [loyaltyPoints, setLoyaltyPoints] = useState<EveLoyaltyPoint[]>([])
  const [securityStatus, setSecurityStatus] = useState<number>(0)
  const [jumpFatigue, setJumpFatigue] = useState<string | null>(null)

  // Contracts
  const [contracts, setContracts] = useState<EveContract[]>([])
  const [corporationContracts, setCorporationContracts] = useState<EveContract[]>([])

  // Intel
  const [miningLedger, setMiningLedger] = useState<EveMiningEntry[]>([])
  const [killmails, setKillmails] = useState<EveKillmail[]>([])
  const [notifications, setNotifications] = useState<EveNotification[]>([])

  // PI
  const [planets, setPlanets] = useState<Array<{ solarSystemName: string; planetType: string; upgradeLevel: number; numPins: number }>>([])

  // Calendar
  const [calendarEvents, setCalendarEvents] = useState<Array<{ date: string; title: string; response: string }>>([])

  // Mail
  const [mail, setMail] = useState<EveMail[]>([])
  const [mailLabels, setMailLabels] = useState<EveMailLabel[]>([])
  const [mailingLists, setMailingLists] = useState<EveMailingList[]>([])

  // Map
  const [jumpBridges, setJumpBridges] = useState<Array<{ fromSystemId: number; destName: string }>>([])


  const [allWalletBalances, setAllWalletBalances] = useState<Record<number, number>>(loadWalletCache)
  const [allAssets, setAllAssets] = useState<Record<number, EveAsset[]>>({})
  const [allIndustryJobs, setAllIndustryJobs] = useState<Record<number, EveIndustryJob[]>>({})
  const [allMarketOrders, setAllMarketOrders] = useState<Record<number, EveMarketOrder[]>>({})

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Persist to localStorage whenever state changes — never inside updater functions
  useEffect(() => { saveCharacters(characters) }, [characters])
  useEffect(() => { saveWalletCache(allWalletBalances) }, [allWalletBalances])

  const clearData = useCallback(() => {
    setSkills([]); setSkillQueue([]); setAssets([]); setIndustryJobs([]); setMarketOrders([])
    setWalletBalance(0); setWalletTransactions([]); setWalletJournal([])
    setBlueprints([]); setAttributes(null); setImplants([]); setJumpClones([])
    setShipLocation(null); setStandings([]); setLoyaltyPoints([]); setSecurityStatus(0)
    setContracts([]); setCorporationContracts([]); setMiningLedger([]); setKillmails([]); setNotifications([])
    setPlanets([]); setCalendarEvents([]); setMail([]); setMailLabels([]); setMailingLists([])
  }, [])

  // Remove the active character (or a specific one by ID)
  const logout = useCallback((characterId?: number) => {
    const removeId = characterId ?? activeCharacterId
    setCharacters(prev => {
      const next = prev.filter(c => c.characterId !== removeId)
      if (activeCharacterId === removeId) {
        const nextActive = next[0]?.characterId ?? null
        saveActiveId(nextActive)
        setActiveCharacterId(nextActive)
        clearData()
      }
      return next
    })
    setAllWalletBalances(prev => {
      if (removeId === null) return prev
      const next = { ...prev }
      delete next[removeId]
      saveWalletCache(next)
      return next
    })
    setAllWalletJournals(prev => { const next = { ...prev }; if (removeId !== null) delete next[removeId]; return next })
    setAllWalletTransactions(prev => { const next = { ...prev }; if (removeId !== null) delete next[removeId]; return next })
    setAllAssets(prev => { const next = { ...prev }; if (removeId !== null) delete next[removeId]; return next })
    setAllIndustryJobs(prev => { const next = { ...prev }; if (removeId !== null) delete next[removeId]; return next })
    setAllMarketOrders(prev => { const next = { ...prev }; if (removeId !== null) delete next[removeId]; return next })
  }, [activeCharacterId, clearData])

  const switchCharacter = useCallback((characterId: number) => {
    setActiveCharacterId(characterId)
    saveActiveId(characterId)
    clearData()
  }, [clearData])

  const loginWithToken = useCallback((
    accessToken: string, refreshToken: string, expiresIn: number,
    characterId: number, characterName: string, corporationId: number,
  ) => {
    const char: EveCharacter = {
      characterId, characterName, corporationId,
      accessToken, refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    }
    setCharacters(prev =>
      prev.some(c => c.characterId === characterId)
        ? prev.map(c => c.characterId === characterId ? char : c)
        : [...prev, char]
    )
    setActiveCharacterId(characterId)
    saveActiveId(characterId)
  }, [])

  // Auto-refresh access token 5 minutes before expiry
  useEffect(() => {
    if (!character) return
    const msUntilRefresh = character.expiresAt - Date.now() - 5 * 60 * 1000
    if (msUntilRefresh < 0) {
      // Already expired or very close — refresh immediately
      fetch('/api/eve/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: character.refreshToken }),
      }).then(r => r.json()).then(data => {
        if (data.access_token) {
          const updated = { ...character, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 1199) * 1000 }
          setCharacters(prev => prev.map(c => c.characterId === character.characterId ? updated : c))
        }
      }).catch(() => {})
      return
    }
    const timer = setTimeout(() => {
      fetch('/api/eve/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: character.refreshToken }),
      }).then(r => r.json()).then(data => {
        if (data.access_token) {
          const updated = { ...character, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 1199) * 1000 }
          setCharacters(prev => prev.map(c => c.characterId === character.characterId ? updated : c))
        }
      }).catch(() => {})
    }, msUntilRefresh)
    return () => clearTimeout(timer)
  }, [character?.characterId, character?.expiresAt])

  const refreshCharacterData = useCallback(async (char: EveCharacter) => {
    const isActive = char.characterId === activeCharacterId
    if (isActive) { setLoading(true); setError(null) }

    const token = char.accessToken
    const id = char.characterId

    // Fire all requests concurrently — each settles independently
    const [
      skillsRes, queueRes, assetsRes, jobsRes, ordersRes,
      balanceRes, journalRes, txRes,
      bpRes, attrRes, clonesRes,
      locationRes, shipRes, standingsRes, contractsRes, allianceContractsRes, corpContractsRes,
      miningRes, killsRes, loyaltyRes, notifRes,
      fatigueRes, planetsRes, calendarRes, publicRes, mailRes, mailLabelsRes,
    ] = await Promise.allSettled([
      getSkills(id, token),
      getSkillQueue(id, token),
      getAssets(id, token),
      getIndustryJobs(id, token),
      getMarketOrders(id, token),
      getWalletBalance(id, token),
      getWalletJournal(id, token),
      getWalletTransactions(id, token),
      getBlueprints(id, token),
      getCharacterAttributes(id, token),
      getClones(id, token),
      getLocation(id, token),
      getCurrentShip(id, token),
      getStandings(id, token),
      getContracts(id, token),
      Promise.reject('no alliance endpoint'),
      char.corporationId ? getCorporationContracts(char.corporationId, token) : Promise.reject('no corporation'),
      getMiningLedger(id, token),
      getKillmails(id, token),
      getLoyaltyPoints(id, token),
      getNotifications(id, token),
      getFatigue(id, token),
      getPlanets(id, token),
      getCalendarEvents(id, token),
      getPublicCharacterInfo(id),
      getMailHeaders(id, token),
      getMailLabels(id, token),
    ])

    let resolvedAssets: EveAsset[] = []
    let structureIds: number[] = []
    let resolvedBlueprintMap = new Map<number, { materialEfficiency: number; timeEfficiency: number; runs: number }>()
    // Local captures for sub-agent sync — React setState is async so we can't
    // read the state variables at the end of this function; they'll be stale.
    let syncSkills:     Array<{ skillId: number; skillName: string; trainedLevel: number; skillpointsInSkill: number }> = []
    let syncSkillQueue: Array<{ skillName: string; finishedLevel: number; finishDate?: string }> = []
    let syncJobs:       Array<{ jobId: number; activityName: string; blueprintTypeName: string; runs: number; status: string; startDate: string; endDate: string }> = []
    let syncBlueprints: Array<{ typeName: string; isCopy: boolean; materialEfficiency: number; timeEfficiency: number; runs: number }> = []
    let syncAttributes: { intelligence: number; memory: number; perception: number; willpower: number; charisma: number } | null = null
    try {
      // ── Skills ──────────────────────────────────────────────────────────
      if (skillsRes.status === 'fulfilled') {
        const names = await resolveTypeNames(skillsRes.value.skills.map(s => s.skill_id))
        const mappedSkills = skillsRes.value.skills.map(s => ({
          skillId: s.skill_id,
          skillName: names[s.skill_id],
          activeLevel: s.active_skill_level,
          trainedLevel: s.trained_skill_level,
          skillpointsInSkill: s.skillpoints_in_skill,
        }))
        syncSkills = mappedSkills
        if (isActive) setSkills(mappedSkills)
      }

      // ── Skill queue ──────────────────────────────────────────────────────
      if (queueRes.status === 'fulfilled') {
        const names = await resolveTypeNames(queueRes.value.map(q => q.skill_id))
        const mappedQueue = queueRes.value.map(q => ({
          skillId: q.skill_id,
          skillName: names[q.skill_id],
          finishedLevel: q.finished_level,
          queuePosition: q.queue_position,
          startDate: q.start_date,
          finishDate: q.finish_date,
          levelStartSp: q.level_start_sp,
          levelEndSp: q.level_end_sp,
          trainingStartSp: q.training_start_sp,
        }))
        syncSkillQueue = mappedQueue
        if (isActive) setSkillQueue(mappedQueue)
      }

      // ── Assets (no cap) ──────────────────────────────────────────────────
      if (assetsRes.status === 'fulfilled') {
        const rawAssets = assetsRes.value

        // Load locally cached structure names — avoids ESI round-trip for known structures
        const localStructureCache: Record<number, string> = (() => {
          try { return JSON.parse(localStorage.getItem('aurora_structure_names') ?? '{}') } catch { return {} }
        })()

        // Build item_id → raw asset map for container hierarchy resolution
        const itemMap = new Map(rawAssets.map(a => [a.item_id, a]))

        // Only top-level location IDs (station/solar_system/structure) need bulk name resolution
        const stationLocationIds = [...new Set(
          rawAssets.filter(a => a.location_type !== 'other').map(a => a.location_id)
        )]
        const typeIds = [...new Set(rawAssets.map(a => a.type_id))]

        // Collect player-owned structure IDs (> 1e11) for the sync payload.
        // We do NOT call ESI for these — without esi-universe.read_structures.v1 every
        // request returns 403 and burns the ESI error budget, causing cascading 420s.
        // Structure names come from the server-side structures.json DB instead.
        structureIds = [...new Set(
          stationLocationIds.filter(id => id > 100_000_000_000)
        )]
        const publicLocationIds = stationLocationIds.filter(id => id <= 100_000_000_000)

        const [names, stationNames] = await Promise.all([
          resolveTypeNames(typeIds),
          resolveStationNames(publicLocationIds),
        ])

        // Fetch player-assigned custom names for containers/ships (esi-assets.read_assets.v1)
        const containerItemIds = [...new Set(
          rawAssets
            .filter(a => a.location_type === 'item' || a.location_type === 'other')
            .map(a => a.location_id)
            .filter(id => itemMap.has(id))
        )]
        const customNames = new Map<number, string>()
        if (containerItemIds.length && char.accessToken) {
          try {
            const named = await getAssetNames(char.characterId, char.accessToken, containerItemIds)
            for (const { item_id, name } of named) customNames.set(item_id, name)
          } catch { /* scope not granted yet — fall back to type names */ }
        }

        // Walk up the container chain to build a human-readable location string.
        // Checks localStorage cache for player-owned structure IDs before falling back to "Location <ID>".
        // Depth-limited to 5 to guard against corrupt data cycles.
        function resolveLocation(locationId: number, locationType: string, depth = 0): string {
          if (depth > 5) return stationNames[locationId] ?? localStructureCache[locationId] ?? `Location ${locationId}`
          if (locationType !== 'other' && locationType !== 'item') {
            return stationNames[locationId] ?? localStructureCache[locationId] ?? `Location ${locationId}`
          }
          const container = itemMap.get(locationId)
          if (!container) return stationNames[locationId] ?? localStructureCache[locationId] ?? `Location ${locationId}`
          const containerLabel = customNames.get(locationId) ?? names[container.type_id] ?? `Item ${locationId}`
          const parentLabel = resolveLocation(container.location_id, container.location_type, depth + 1)
          return `${containerLabel} @ ${parentLabel}`
        }

        resolvedAssets = rawAssets.map(a => ({
          itemId: a.item_id,
          typeId: a.type_id,
          typeName: names[a.type_id],
          locationId: a.location_id,
          locationName: resolveLocation(a.location_id, a.location_type),
          quantity: a.quantity,
          isBlueprintCopy: a.is_blueprint_copy,
        }))
        if (isActive) setAssets(resolvedAssets)
        setAllAssets(prev => ({ ...prev, [id]: resolvedAssets }))
      }

      // ── Industry jobs ────────────────────────────────────────────────────
      if (jobsRes.status === 'fulfilled') {
        const names = await resolveTypeNames([...new Set(jobsRes.value.map(j => j.blueprint_type_id))])
        const mappedJobs = jobsRes.value.map(j => ({
          jobId: j.job_id,
          activityId: j.activity_id,
          activityName: ACTIVITY_NAMES[j.activity_id] ?? `Activity ${j.activity_id}`,
          blueprintTypeId: j.blueprint_type_id,
          blueprintTypeName: names[j.blueprint_type_id],
          runs: j.runs,
          status: j.status as EveIndustryJob['status'],
          startDate: j.start_date,
          endDate: j.end_date,
          facilityId: j.facility_id,
        }))
        syncJobs = mappedJobs
        if (isActive) setIndustryJobs(mappedJobs)
        setAllIndustryJobs(prev => ({ ...prev, [id]: mappedJobs }))
      }

      // ── Market orders ────────────────────────────────────────────────────
      if (ordersRes.status === 'fulfilled') {
        const names = await resolveTypeNames([...new Set(ordersRes.value.map(o => o.type_id))])
        const mappedOrders = ordersRes.value.map(o => ({
          orderId: o.order_id,
          typeId: o.type_id,
          typeName: names[o.type_id],
          locationId: o.location_id,
          volumeTotal: o.volume_total,
          volumeRemain: o.volume_remain,
          price: o.price,
          isBuyOrder: o.is_buy_order,
          issued: o.issued,
          duration: o.duration,
          state: (o.state as EveMarketOrder['state']) ?? 'active',
        }))
        if (isActive) setMarketOrders(mappedOrders)
        setAllMarketOrders(prev => ({ ...prev, [id]: mappedOrders }))
      }

      // ── Wallet ───────────────────────────────────────────────────────────
      if (balanceRes.status === 'fulfilled') {
        if (isActive) setWalletBalance(balanceRes.value)
        setAllWalletBalances(prev => ({ ...prev, [id]: balanceRes.value }))
      }

      if (journalRes.status === 'fulfilled') {
        const mapped = journalRes.value.slice(0, 50).map(e => ({
          id: e.id,
          date: e.date,
          refType: e.ref_type,
          amount: e.amount ?? 0,
          balance: e.balance ?? 0,
          description: e.description ?? '',
        }))
        if (isActive) setWalletJournal(mapped)
        setAllWalletJournals(prev => ({ ...prev, [id]: mapped }))
      }

      if (txRes.status === 'fulfilled') {
        const typeIds = [...new Set(txRes.value.map(t => t.type_id))]
        const clientIds = [...new Set(txRes.value.map(t => t.client_id))]
        const locationIds = [...new Set(txRes.value.map(t => t.location_id))]
        const [names, entityNames, locationNames] = await Promise.all([
          resolveTypeNames(typeIds),
          resolveIds(clientIds),
          resolveIds(locationIds),
        ])
        const mapped = txRes.value.slice(0, 50).map(t => ({
          transactionId: t.transaction_id,
          date: t.date,
          typeName: names[t.type_id],
          quantity: t.quantity,
          unitPrice: t.unit_price,
          isBuy: t.is_buy,
          clientName: entityNames[t.client_id] ?? `Entity ${t.client_id}`,
          locationName: locationNames[t.location_id] ?? `Location ${t.location_id}`,
        }))
        if (isActive) setWalletTransactions(mapped)
        setAllWalletTransactions(prev => ({ ...prev, [id]: mapped }))
      }

      // ── Blueprints ───────────────────────────────────────────────────────
      if (bpRes.status === 'fulfilled') {
        const typeIds = [...new Set(bpRes.value.map(b => b.type_id))]
        const locationIds = [...new Set(bpRes.value.map(b => b.location_id))]
        const [names, locationNames] = await Promise.all([
          resolveTypeNames(typeIds),
          resolveIds(locationIds),
        ])
        const mappedBlueprints = bpRes.value.map(b => ({
          itemId: b.item_id,
          typeId: b.type_id,
          typeName: names[b.type_id],
          locationId: b.location_id,
          locationName: locationNames[b.location_id] ?? `Location ${b.location_id}`,
          materialEfficiency: b.material_efficiency,
          timeEfficiency: b.time_efficiency,
          runs: b.runs,
          isCopy: b.runs !== -1,
        }))
        syncBlueprints = mappedBlueprints
        if (isActive) setBlueprints(mappedBlueprints)
        // Build item_id → ME/TE/runs map for enriching the asset sync payload
        resolvedBlueprintMap = new Map(bpRes.value.map(b => [
          b.item_id,
          { materialEfficiency: b.material_efficiency, timeEfficiency: b.time_efficiency, runs: b.runs },
        ]))
      }

      // ── Attributes ───────────────────────────────────────────────────────
      if (attrRes.status === 'fulfilled') {
        const a = attrRes.value
        syncAttributes = {
          charisma: a.charisma,
          intelligence: a.intelligence,
          memory: a.memory,
          perception: a.perception,
          willpower: a.willpower,
        }
        if (isActive) setAttributes({
          ...syncAttributes,
          bonusRemaps: a.bonus_remaps,
          lastRemapDate: a.last_remap_date,
          accruedRemapCooldownDate: a.accrued_remap_cooldown_date,
        })
      }

      // ── Jump clones ──────────────────────────────────────────────────────
      if (clonesRes.status === 'fulfilled') {
        const clone = clonesRes.value
        const locationIds = clone.jump_clones.map(c => c.location_id)
        const allImplantIds = [...new Set(clone.jump_clones.flatMap(c => c.implants))]
        const [locationNames, implantNames] = await Promise.all([
          resolveIds(locationIds),
          resolveTypeNames(allImplantIds),
        ])
        if (isActive) setJumpClones(clone.jump_clones.map(c => ({
          jumpCloneId: c.jump_clone_id,
          locationId: c.location_id,
          locationName: locationNames[c.location_id] ?? `Location ${c.location_id}`,
          implants: c.implants.map((id, i) => ({ typeId: id, typeName: implantNames[id], slot: i + 1 })),
        })))
      }

      // ── Ship & location ──────────────────────────────────────────────────
      if (isActive && locationRes.status === 'fulfilled' && shipRes.status === 'fulfilled') {
        const loc = locationRes.value
        const ship = shipRes.value
        const resolveIds2 = [ship.ship_type_id, loc.solar_system_id, loc.station_id].filter(Boolean) as number[]
        const names = await resolveIds(resolveIds2)
        setShipLocation({
          shipTypeId: ship.ship_type_id,
          shipName: ship.ship_name,
          shipTypeName: typeNameCache[ship.ship_type_id] ?? names[ship.ship_type_id] ?? `Ship ${ship.ship_type_id}`,
          solarSystemId: loc.solar_system_id,
          solarSystemName: names[loc.solar_system_id] ?? `System ${loc.solar_system_id}`,
          stationId: loc.station_id,
          stationName: loc.station_id ? names[loc.station_id] : undefined,
        })
      }

      // ── Standings ────────────────────────────────────────────────────────
      if (isActive && standingsRes.status === 'fulfilled') {
        const ids = standingsRes.value.map(s => s.from_id)
        const names = await resolveIds(ids)
        setStandings(standingsRes.value
          .filter(s => Math.abs(s.standing) >= 0.5)
          .sort((a, b) => Math.abs(b.standing) - Math.abs(a.standing))
          .slice(0, 50)
          .map(s => ({
            fromId: s.from_id,
            fromName: names[s.from_id] ?? `Entity ${s.from_id}`,
            fromType: s.from_type as EveStanding['fromType'],
            standing: s.standing,
          })))
      }

      // ── Contracts ────────────────────────────────────────────────────────
      if (contractsRes.status === 'fulfilled') {
        const charContracts = contractsRes.value
        const allianceContracts = allianceContractsRes.status === 'fulfilled' ? allianceContractsRes.value : []
        // Deduplicate by contract_id — character endpoint may already include some alliance contracts
        const seen = new Set(charContracts.map(c => c.contract_id))
        const merged = [
          ...charContracts,
          ...allianceContracts.filter(c => !seen.has(c.contract_id)).map(c => ({ ...c, _source: 'alliance' as const }),
          ),
        ]
        const entityIds = [...new Set([
          ...merged.map(c => c.issuer_id),
          ...merged.map(c => c.assignee_id),
        ])]
        const names = await resolveIds(entityIds)
        const resolvedContracts = merged
          .filter(c => ['outstanding', 'in_progress', 'finished', 'finished_issuer', 'finished_contractor'].includes(c.status))
          .sort((a, b) => new Date(b.date_issued).getTime() - new Date(a.date_issued).getTime())
          .slice(0, 500)
          .map(c => ({
            contractId: c.contract_id,
            type: c.type,
            status: c.status,
            title: c.title ?? '',
            issuerId: c.issuer_id,
            issuerName: names[c.issuer_id] ?? `Entity ${c.issuer_id}`,
            assigneeId: c.assignee_id,
            assigneeName: names[c.assignee_id] ?? `Entity ${c.assignee_id}`,
            dateIssued: c.date_issued,
            dateExpired: c.date_expired,
            price: c.price ?? 0,
            volume: c.volume ?? 0,
            forCorporation: c.for_corporation,
            source: ('_source' in c ? c._source : 'character') as 'character' | 'alliance',
          }))
        if (isActive) setContracts(resolvedContracts)
        fetch('/api/contracts/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId: char.characterId, contracts: resolvedContracts }),
        }).catch(err => console.warn('Contracts sync failed:', err))
      }

      // ── Corporation contracts ─────────────────────────────────────────────
      if (isActive && corpContractsRes.status === 'fulfilled') {
        const corpRaw = corpContractsRes.value
        const entityIds = [...new Set([
          ...corpRaw.map(c => c.issuer_id),
          ...corpRaw.map(c => c.assignee_id),
        ])]
        const names = await resolveIds(entityIds)
        const resolvedCorpContracts = corpRaw
          .filter(c => c.status === 'outstanding')
          .sort((a, b) => new Date(b.date_issued).getTime() - new Date(a.date_issued).getTime())
          .map(c => ({
            contractId: c.contract_id,
            type: c.type,
            status: c.status,
            title: c.title ?? '',
            issuerId: c.issuer_id,
            issuerName: names[c.issuer_id] ?? `Entity ${c.issuer_id}`,
            assigneeId: c.assignee_id,
            assigneeName: names[c.assignee_id] ?? `Entity ${c.assignee_id}`,
            dateIssued: c.date_issued,
            dateExpired: c.date_expired,
            price: c.price ?? 0,
            volume: c.volume ?? 0,
            forCorporation: c.for_corporation,
            source: 'corporation' as const,
          }))
        setCorporationContracts(resolvedCorpContracts)
      }

      // ── Mining ledger ────────────────────────────────────────────────────
      if (isActive && miningRes.status === 'fulfilled') {
        const typeIds = [...new Set(miningRes.value.map(m => m.type_id))]
        const systemIds = [...new Set(miningRes.value.map(m => m.solar_system_id))]
        const [names, systemNames] = await Promise.all([
          resolveTypeNames(typeIds),
          resolveIds(systemIds),
        ])
        setMiningLedger(miningRes.value.slice(0, 60).map(m => ({
          date: m.date,
          solarSystemId: m.solar_system_id,
          solarSystemName: systemNames[m.solar_system_id] ?? `System ${m.solar_system_id}`,
          typeId: m.type_id,
          typeName: names[m.type_id],
          quantity: m.quantity,
        })))
      }

      // ── Kill mails (resolve top 10 details) ──────────────────────────────
      if (isActive && killsRes.status === 'fulfilled' && killsRes.value.length) {
        const top = killsRes.value.slice(0, 10)
        const details = await Promise.allSettled(
          top.map(k => getKillmailDetail(k.killmail_id, k.killmail_hash))
        )
        const shipTypeIds = details
          .filter(d => d.status === 'fulfilled')
          .map(d => (d as PromiseFulfilledResult<Awaited<ReturnType<typeof getKillmailDetail>>>).value)
          .flatMap(d => [d.victim.ship_type_id, ...d.attackers.map(a => a.ship_type_id ?? 0)])
          .filter(Boolean)
        const systemIds = details
          .filter(d => d.status === 'fulfilled')
          .map(d => (d as PromiseFulfilledResult<Awaited<ReturnType<typeof getKillmailDetail>>>).value.solar_system_id)
        const [shipNames, systemNames] = await Promise.all([
          resolveTypeNames([...new Set(shipTypeIds)]),
          resolveIds([...new Set(systemIds)]),
        ])
        setKillmails(details
          .filter(d => d.status === 'fulfilled')
          .map(d => {
            const km = (d as PromiseFulfilledResult<Awaited<ReturnType<typeof getKillmailDetail>>>).value
            const isLoss = km.victim.character_id === id
            return {
              killmailId: km.killmail_id,
              killmailTime: km.killmail_time,
              solarSystemId: km.solar_system_id,
              solarSystemName: systemNames[km.solar_system_id] ?? `System ${km.solar_system_id}`,
              shipTypeId: km.victim.ship_type_id,
              shipTypeName: shipNames[km.victim.ship_type_id] ?? `Ship ${km.victim.ship_type_id}`,
              isLoss,
              attackerCount: km.attackers.length,
            }
          }))
      }

      // ── Loyalty points ───────────────────────────────────────────────────
      if (isActive && loyaltyRes.status === 'fulfilled') {
        const corpIds = loyaltyRes.value.map(l => l.corporation_id)
        const names = await resolveIds(corpIds)
        setLoyaltyPoints(loyaltyRes.value.map(l => ({
          corporationId: l.corporation_id,
          corporationName: names[l.corporation_id] ?? `Corp ${l.corporation_id}`,
          loyaltyPoints: l.loyalty_points,
        })))
      }

      // ── Notifications ─────────────────────────────────────────────────────
      if (isActive && notifRes.status === 'fulfilled') {
        setNotifications(notifRes.value
          .slice(0, 500)
          .map(n => ({
            notificationId: n.notification_id,
            type: n.type,
            senderId: n.sender_id,
            timestamp: n.timestamp,
            isRead: n.is_read ?? false,
            text: n.text ?? '',
          })))
      }

      // ── Jump fatigue ──────────────────────────────────────────────────────
      if (isActive && fatigueRes.status === 'fulfilled') {
        const exp = fatigueRes.value.jump_fatigue_expire_date
        setJumpFatigue(exp && new Date(exp) > new Date() ? exp : null)
      }

      // ── Planets (PI) ──────────────────────────────────────────────────────
      if (isActive && planetsRes.status === 'fulfilled') {
        const systemIds = [...new Set(planetsRes.value.map(p => p.solar_system_id))]
        const names = await resolveIds(systemIds)
        setPlanets(planetsRes.value.map(p => ({
          solarSystemName: names[p.solar_system_id] ?? `System ${p.solar_system_id}`,
          planetType: p.planet_type,
          upgradeLevel: p.upgrade_level,
          numPins: p.num_pins,
        })))
      }

      // ── Calendar ──────────────────────────────────────────────────────────
      if (isActive && calendarRes.status === 'fulfilled') {
        setCalendarEvents(calendarRes.value
          .filter(e => new Date(e.event_date) >= new Date())
          .slice(0, 10)
          .map(e => ({ date: e.event_date, title: e.title, response: e.event_response })))
      }

      // ── Mail ──────────────────────────────────────────────────────────────
      if (isActive && mailRes.status === 'fulfilled') {
        const headers = mailRes.value
        const senderIds = [...new Set(headers.map(m => m.from))]
        const names = await resolveIds(senderIds)
        const resolvedMail = headers.map(m => ({
          mailId: m.mail_id,
          subject: m.subject,
          fromId: m.from,
          fromName: names[m.from] ?? `Pilot ${m.from}`,
          timestamp: m.timestamp,
          isRead: m.is_read ?? false,
          labelIds: m.labels ?? [],
          recipients: (m.recipients ?? []).map(r => ({
            recipientId: r.recipient_id,
            recipientType: r.recipient_type as EveMail['recipients'][number]['recipientType'],
          })),
        }))
        setMail(resolvedMail)
        fetch('/api/mail/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId: char.characterId, mails: resolvedMail }),
        }).catch(err => console.warn('Mail sync failed:', err))
      }

      if (isActive && mailLabelsRes.status === 'fulfilled') {
        setMailLabels((mailLabelsRes.value.labels ?? []).map(l => ({
          labelId: l.label_id,
          name: l.name,
          color: l.color,
          unreadCount: l.unread_count ?? 0,
        })))
      }

      // ── Mailing lists ─────────────────────────────────────────────────────
      if (isActive) {
        getMailingLists(char.characterId, char.accessToken).then(lists => {
          setMailingLists(lists.map(l => ({ mailingListId: l.mailing_list_id, name: l.name })))
        }).catch(() => { /* ignore — scope may not be granted */ })
      }

      // ── Public info (security status) ─────────────────────────────────────
      if (publicRes.status === 'fulfilled') {
        if (isActive) setSecurityStatus(publicRes.value.security_status)
        // Update character with alliance ID if present
        if (publicRes.value.alliance_id) {
          const allianceId = publicRes.value.alliance_id
          setCharacters(prev => prev.map(c => c.characterId === char.characterId ? { ...c, allianceId } : c))
        }
      }

    } catch (e) {
      if (isActive) setError('Partial data load failure — some modules unavailable')
    } finally {
      if (isActive) setLoading(false)
    }

    // Sync resolved assets (with blueprint ME/TE merged in) to server cache.
    // Fire-and-forget — doesn't block the UI.
    if (resolvedAssets.length) {
      const enrichedAssets = resolvedAssets.map(a => {
        const bp = resolvedBlueprintMap.get(a.itemId)
        if (!bp) return a
        return { ...a, materialEfficiency: bp.materialEfficiency, timeEfficiency: bp.timeEfficiency, runs: bp.runs }
      })
      fetch('/api/assets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: char.characterId,
          characterName: char.characterName,
          assets: enrichedAssets,
          structureIds,
        }),
      }).then(r => r.json()).then((data: { groups?: Record<number, string> }) => {
        if (data.groups && Object.keys(data.groups).length > 0) {
          const applyGroups = (a: EveAsset) => { const g = data.groups![a.typeId]; return g ? { ...a, groupName: g } : a }
          if (isActive) setAssets(prev => prev.map(applyGroups))
          setAllAssets(prev => {
            const charAssets = prev[char.characterId]
            return charAssets ? { ...prev, [char.characterId]: charAssets.map(applyGroups) } : prev
          })
        }
      }).catch(err => console.warn('Asset sync failed:', err))

      // Resolve player structure names (IDs > 1e11) via authenticated ESI,
      // persist to structures.json, and patch locationName in local state.
      if (structureIds.length > 0) {
        fetch(`/api/assets/structures?characterId=${char.characterId}&accessToken=${char.accessToken}`)
          .then(r => r.json())
          .then((resolved: { id: number; name: string }[]) => {
            if (!resolved.length) return
            fetch('/api/structures', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resolved.map(({ id, name }) => ({ id, name }))),
            }).catch(() => {})
            // Persist to localStorage so future refreshes resolve instantly without ESI
            try {
              const existing = JSON.parse(localStorage.getItem('aurora_structure_names') ?? '{}')
              for (const { id, name } of resolved) existing[String(id)] = name
              localStorage.setItem('aurora_structure_names', JSON.stringify(existing))
            } catch { /* storage full — skip */ }

            const nameMap = new Map(resolved.map(r => [r.id, r.name]))
            const patchLoc = (a: EveAsset) => {
              let loc = a.locationName
              for (const [sid, sname] of nameMap) loc = loc.replace(`Location ${sid}`, sname)
              return loc !== a.locationName ? { ...a, locationName: loc } : a
            }
            if (isActive) setAssets(prev => prev.map(patchLoc))
            setAllAssets(prev => {
              const charAssets = prev[char.characterId]
              return charAssets ? { ...prev, [char.characterId]: charAssets.map(patchLoc) } : prev
            })
          })
          .catch(() => {})
      }
    }

    // Sync industry jobs + blueprints to Hermes sub-agent cache.
    fetch('/api/industry/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: char.characterId,
        characterName: char.characterName,
        jobs: syncJobs.map(j => ({
          jobId: j.jobId, activityName: j.activityName,
          blueprintTypeName: j.blueprintTypeName, runs: j.runs,
          status: j.status, startDate: j.startDate, endDate: j.endDate,
        })),
        blueprints: syncBlueprints.map(b => ({
          typeName: b.typeName, isCopy: b.isCopy,
          materialEfficiency: b.materialEfficiency,
          timeEfficiency: b.timeEfficiency, runs: b.runs,
        })),
      }),
    }).catch(err => console.warn('Industry sync failed:', err))

    // Sync skills + queue + attributes to Hermes sub-agent cache
    fetch('/api/skills/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: char.characterId,
        characterName: char.characterName,
        skills: syncSkills.map(s => ({
          skillId: s.skillId, skillName: s.skillName,
          trainedLevel: s.trainedLevel, skillpointsInSkill: s.skillpointsInSkill,
        })),
        queue: syncSkillQueue.map(q => ({
          skillName: q.skillName, finishedLevel: q.finishedLevel, finishDate: q.finishDate,
        })),
        attributes: syncAttributes,
      }),
    }).catch(err => console.warn('Skills sync failed:', err))

    // Fetch jump bridges (Ansiblex gates) the active character is authorized to use.
    // Fire-and-forget — map overlay, non-blocking.
    if (isActive && char.accessToken) {
      fetch('/api/eve/jump-bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: char.characterId, accessToken: char.accessToken }),
      })
        .then(r => r.json())
        .then((data: { bridges: Array<{ fromSystemId: number; destName: string }> }) => {
          if (data.bridges?.length) setJumpBridges(data.bridges)
        })
        .catch(() => {})
    }
  }, [activeCharacterId])

  // Lightweight refresh for non-active characters — only the data needed for merged panel views.
  // Avoids firing 26 ESI calls per alt and overwhelming the error budget.
  const refreshCharacterLight = useCallback(async (char: EveCharacter) => {
    let token = char.accessToken
    const id = char.characterId

    // Quick auth check — only probe if token is near expiry (< 60s remaining)
    if (!char.expiresAt || char.expiresAt - Date.now() < 60_000) {
      try {
        const probe = await fetch(`https://esi.evetech.net/latest/characters/${id}/wallet/`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (probe.status === 401) {
          // Access token expired — try to get a new one via the refresh token
          try {
            const refreshRes = await fetch('/api/eve/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: char.refreshToken }),
            })
            const refreshData = await refreshRes.json()
            if (refreshData.access_token) {
              const updatedChar = { ...char, accessToken: refreshData.access_token, expiresAt: Date.now() + (refreshData.expires_in ?? 1199) * 1000 }
              setCharacters(prev => prev.map(c => c.characterId === id ? updatedChar : c))
              token = refreshData.access_token
            } else {
              setCharacters(prev => prev.filter(c => c.characterId !== id))
              return
            }
          } catch {
            return
          }
        }
      } catch { /* network error on probe — skip silently */ }
    }

    const [balanceRes, journalRes, txRes, assetsRes, jobsRes, ordersRes] = await Promise.allSettled([
      getWalletBalance(id, token),
      getWalletJournal(id, token),
      getWalletTransactions(id, token),
      getAssets(id, token),
      getIndustryJobs(id, token),
      getMarketOrders(id, token),
    ])

    if (balanceRes.status === 'fulfilled') {
      setAllWalletBalances(prev => ({ ...prev, [id]: balanceRes.value }))
    }
    if (journalRes.status === 'fulfilled') {
      const mapped = journalRes.value.slice(0, 50).map(e => ({
        id: e.id, date: e.date, refType: e.ref_type,
        amount: e.amount ?? 0, balance: e.balance ?? 0, description: e.description ?? '',
      }))
      setAllWalletJournals(prev => ({ ...prev, [id]: mapped }))
    }
    if (txRes.status === 'fulfilled') {
      const typeIds = [...new Set(txRes.value.map(t => t.type_id))]
      const clientIds = [...new Set(txRes.value.map(t => t.client_id))]
      const locationIds = [...new Set(txRes.value.map(t => t.location_id))]
      const [names, entityNames, locationNames] = await Promise.all([
        resolveTypeNames(typeIds), resolveIds(clientIds), resolveIds(locationIds),
      ])
      const mapped = txRes.value.slice(0, 50).map(t => ({
        transactionId: t.transaction_id, date: t.date, typeName: names[t.type_id],
        quantity: t.quantity, unitPrice: t.unit_price, isBuy: t.is_buy,
        clientName: entityNames[t.client_id] ?? `Entity ${t.client_id}`,
        locationName: locationNames[t.location_id] ?? `Location ${t.location_id}`,
      }))
      setAllWalletTransactions(prev => ({ ...prev, [id]: mapped }))
    }
    if (assetsRes.status === 'fulfilled') {
      const rawAssets = assetsRes.value
      const itemMap = new Map(rawAssets.map(a => [a.item_id, a]))
      const stationLocationIds = [...new Set(rawAssets.filter(a => a.location_type !== 'other').map(a => a.location_id))]
      const publicLocationIds = stationLocationIds.filter(sid => sid <= 100_000_000_000)
      const typeIds = [...new Set(rawAssets.map(a => a.type_id))]
      const [names, stationNames] = await Promise.all([resolveTypeNames(typeIds), resolveStationNames(publicLocationIds)])
      const altStructureCache: Record<number, string> = (() => {
        try { return JSON.parse(localStorage.getItem('aurora_structure_names') ?? '{}') } catch { return {} }
      })()
      function resolveLocation(locationId: number, locationType: string, depth = 0): string {
        if (depth > 5 || (locationType !== 'other' && locationType !== 'item'))
          return stationNames[locationId] ?? altStructureCache[locationId] ?? `Location ${locationId}`
        const container = itemMap.get(locationId)
        if (!container) return stationNames[locationId] ?? altStructureCache[locationId] ?? `Location ${locationId}`
        return `${names[container.type_id] ?? `Item ${locationId}`} @ ${resolveLocation(container.location_id, container.location_type, depth + 1)}`
      }
      const altStructureIds = [...new Set(
        stationLocationIds.filter(sid => sid > 100_000_000_000)
      )]
      const resolved = rawAssets.map(a => ({
        itemId: a.item_id, typeId: a.type_id, typeName: names[a.type_id],
        locationId: a.location_id, locationName: resolveLocation(a.location_id, a.location_type),
        quantity: a.quantity, isBlueprintCopy: a.is_blueprint_copy,
      }))
      setAllAssets(prev => ({ ...prev, [id]: resolved }))
      fetch('/api/assets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: id, characterName: char.characterName, assets: resolved, structureIds: altStructureIds }),
      }).catch(() => {})

      // Resolve player structure names for this alt using their own token
      if (altStructureIds.length && char.accessToken) {
        const idsParam = altStructureIds.join(',')
        fetch(`/api/assets/structures?characterId=${id}&accessToken=${char.accessToken}&ids=${idsParam}`)
          .then(r => r.json())
          .then((resolved: { id: number; name: string }[]) => {
            if (!resolved.length) return
            fetch('/api/structures', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resolved.map(({ id, name }) => ({ id, name }))),
            }).catch(() => {})
            try {
              const existing = JSON.parse(localStorage.getItem('aurora_structure_names') ?? '{}')
              for (const { id, name } of resolved) existing[String(id)] = name
              localStorage.setItem('aurora_structure_names', JSON.stringify(existing))
            } catch { /* storage full — skip */ }
            const nameMap = new Map(resolved.map(r => [r.id, r.name]))
            const patchLoc = (a: EveAsset) => {
              let loc = a.locationName
              for (const [sid, sname] of nameMap) loc = loc.replace(`Location ${sid}`, sname)
              return loc !== a.locationName ? { ...a, locationName: loc } : a
            }
            setAllAssets(prev => {
              const charAssets = prev[id]
              return charAssets ? { ...prev, [id]: charAssets.map(patchLoc) } : prev
            })
          })
          .catch(() => {})
      }
    }
    if (jobsRes.status === 'fulfilled') {
      const names = await resolveTypeNames([...new Set(jobsRes.value.map(j => j.blueprint_type_id))])
      const mapped = jobsRes.value.map(j => ({
        jobId: j.job_id, activityId: j.activity_id,
        activityName: ACTIVITY_NAMES[j.activity_id] ?? `Activity ${j.activity_id}`,
        blueprintTypeId: j.blueprint_type_id, blueprintTypeName: names[j.blueprint_type_id],
        runs: j.runs, status: j.status as EveIndustryJob['status'],
        startDate: j.start_date, endDate: j.end_date, facilityId: j.facility_id,
      }))
      setAllIndustryJobs(prev => ({ ...prev, [id]: mapped }))
    }
    if (ordersRes.status === 'fulfilled') {
      const names = await resolveTypeNames([...new Set(ordersRes.value.map(o => o.type_id))])
      const mapped = ordersRes.value.map(o => ({
        orderId: o.order_id, typeId: o.type_id, typeName: names[o.type_id],
        locationId: o.location_id, volumeTotal: o.volume_total, volumeRemain: o.volume_remain,
        price: o.price, isBuyOrder: o.is_buy_order, issued: o.issued,
        duration: o.duration, state: (o.state as EveMarketOrder['state']) ?? 'active',
      }))
      setAllMarketOrders(prev => ({ ...prev, [id]: mapped }))
    }
  }, [])

  const refreshData = useCallback(async () => {
    if (!character) return
    return refreshCharacterData(character)
  }, [character, refreshCharacterData])

  const refreshAllCharacters = useCallback(async () => {
    if (!characters.length) return
    // Active character gets the full refresh; alts get the lightweight version
    await Promise.allSettled([
      character ? refreshCharacterData(character) : Promise.resolve(),
      ...characters
        .filter(c => c.characterId !== activeCharacterId)
        .map(c => refreshCharacterLight(c)),
    ])
  }, [characters, character, activeCharacterId, refreshCharacterData, refreshCharacterLight])

  useEffect(() => {
    if (character) refreshAllCharacters()
  }, [character?.characterId, character?.accessToken])

  return {
    character, characters, activeCharacterId, allWalletBalances,
    skills, skillQueue, assets, industryJobs, marketOrders,
    allAssets, allIndustryJobs, allMarketOrders,
    walletBalance, walletTransactions, walletJournal, allWalletJournals, allWalletTransactions,
    blueprints, attributes, implants, jumpClones, shipLocation,
    standings, loyaltyPoints, securityStatus, jumpFatigue,
    contracts, corporationContracts, miningLedger, killmails, notifications,
    planets, calendarEvents, mail, mailLabels, mailingLists, jumpBridges,
    loading, error,
    loginWithToken, logout, switchCharacter, refreshData, refreshAllCharacters,
  }
}

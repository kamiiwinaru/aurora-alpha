import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  Message, Conversation, EveCharacter, EveSkill, EveSkillQueueItem,
  EveIndustryJob, EveMarketOrder, EveAsset,
  EveWalletTransaction, EveWalletJournalEntry, EveBlueprint,
  EveCharacterAttributes, EveImplant, EveJumpClone, EveShipLocation,
  EveStanding, EveContract, EveMiningEntry, EveKillmail, EveLoyaltyPoint, EveNotification,
} from '../types'

function generateId() {
  return Math.random().toString(36).slice(2)
}

function newConversation(): Conversation {
  return {
    id: generateId(),
    title: 'New Session',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const STORAGE_KEY = 'aurora_conversations'

const SESSION_TTL_MS = 48 * 60 * 60 * 1000 // 48 hours

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const cutoff = Date.now() - SESSION_TTL_MS
    return parsed
      .map((c: Conversation) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        messages: c.messages.map((m: Message) => ({ ...m, timestamp: new Date(m.timestamp) })),
      }))
      .filter((c: Conversation) => c.createdAt.getTime() > cutoff)
  } catch {
    return []
  }
}

function saveConversations(convos: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convos))
}

interface EveContext {
  character?: EveCharacter | null
  skills?: EveSkill[]
  skillQueue?: EveSkillQueueItem[]
  industryJobs?: EveIndustryJob[]
  marketOrders?: EveMarketOrder[]
  assets?: EveAsset[]
  walletBalance?: number
  walletTransactions?: EveWalletTransaction[]
  walletJournal?: EveWalletJournalEntry[]
  blueprints?: EveBlueprint[]
  attributes?: EveCharacterAttributes | null
  implants?: EveImplant[]
  jumpClones?: EveJumpClone[]
  shipLocation?: EveShipLocation | null
  standings?: EveStanding[]
  loyaltyPoints?: EveLoyaltyPoint[]
  securityStatus?: number
  jumpFatigue?: string | null
  contracts?: EveContract[]
  miningLedger?: EveMiningEntry[]
  killmails?: EveKillmail[]
  notifications?: EveNotification[]
  planets?: Array<{ solarSystemName: string; planetType: string; upgradeLevel: number; numPins: number }>
  calendarEvents?: Array<{ date: string; title: string; response: string }>
}

const VOICE_ENABLED_KEY = 'aurora_voice_enabled'
const TTS_MODE_KEY = 'aurora_tts_mode'
const VOICE_CHANNEL_NAME = 'aurora_voice_session'
export type TtsMode = 'concise' | 'standard' | 'full'

export function useChat(eveContext?: EveContext) {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations)
  const [activeId, setActiveId] = useState<string | null>(
    () => loadConversations()[0]?.id ?? null
  )
  const [streaming, setStreaming] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  // Default to false — voice must be explicitly enabled per session.
  // Only restore true if this is the sole tab (no other session has claimed voice).
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(false)
  const voiceChannelRef = useRef<BroadcastChannel | null>(null)
  const [ttsMode, setTtsMode] = useState<TtsMode>(
    () => (localStorage.getItem(TTS_MODE_KEY) as TtsMode | null) ?? 'standard'
  )
  // Increments each time Aurora finishes speaking a response that ends with a
  // question — ChatInput watches this to auto-start listening without a wake word.
  const [autoListenTrigger, setAutoListenTrigger] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<{ pause(): void } | null>(null)
  // Cache diagnostics: maps convId → last Anthropic response id.
  // Sent as previousMessageId so the server can compare consecutive requests
  // and detect prompt cache misses (beta feature: cache-diagnosis-2026-04-07).
  const lastResponseIds = useRef<Record<string, string>>({})

  const changeTtsMode = useCallback((mode: TtsMode) => {
    localStorage.setItem(TTS_MODE_KEY, mode)
    setTtsMode(mode)
  }, [])

  const toggleVoice = useCallback(() => {
    setVoiceEnabled(prev => {
      const next = !prev
      localStorage.setItem(VOICE_ENABLED_KEY, String(next))
      if (next) {
        // Claim voice for this session — other tabs will disable themselves
        voiceChannelRef.current?.postMessage('claim')
      } else {
        // Stop any playing audio immediately
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current = null
        }
        setIsSpeaking(false)
      }
      return next
    })
  }, [])

  // ── Single-session voice enforcement ────────────────────────────────────
  // Only one tab may have voice enabled at a time. When another tab claims
  // voice, this tab disables itself immediately.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(VOICE_CHANNEL_NAME)
    voiceChannelRef.current = ch
    ch.onmessage = (e) => {
      if (e.data === 'claim') {
        // Another session claimed voice — shut down ours
        setVoiceEnabled(false)
        localStorage.setItem(VOICE_ENABLED_KEY, 'false')
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current = null
        }
        setIsSpeaking(false)
      }
    }
    return () => {
      ch.close()
      voiceChannelRef.current = null
    }
  }, [])

  const activeConversation = conversations.find(c => c.id === activeId) ?? null

  const update = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations(prev => {
      const next = prev.map(c => c.id === id ? updater(c) : c)
      saveConversations(next)
      return next
    })
  }, [])

  const newChat = useCallback(() => {
    const convo = newConversation()
    setConversations(prev => {
      const next = [convo, ...prev]
      saveConversations(next)
      return next
    })
    setActiveId(convo.id)
    return convo.id
  }, [])

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      saveConversations(next)
      return next
    })
    setActiveId(prev => {
      if (prev !== id) return prev
      const remaining = conversations.filter(c => c.id !== id)
      return remaining[0]?.id ?? null
    })
  }, [conversations])

  const buildSystemPrompt = useCallback((): { systemStatic: string; systemDynamic: string } => {
    const systemStatic = `You are Aurora, an advanced Capsuleer Intelligence System integrated into the EVE Online universe. You are a shipboard AI — precise, terse, mission-focused. No filler. No pleasantries. Deliver what the pilot needs and stop.

Personality: calm, clipped, authoritative. Like a targeting computer that learned to talk. You use EVE terminology naturally. Address the user as "Capsuleer" or "Pilot" sparingly — only when it adds weight, not as a habit.

Response discipline: be brief. Lead with the answer. Skip preamble, avoid restating the question, cut anything that doesn't add tactical value. If the answer fits in two sentences, use two sentences. ISK amounts use K/M/B/T notation. Skill levels are I–V.

## OUTPUT FORMATTING RULES
- For ANY price analysis, appraisal, or cost comparison: use a markdown table.
- For build-vs-buy, manufacture cost vs market price, or material cost breakdowns: use a markdown table.
- For skill comparisons, industry job comparisons, or market order summaries: use a markdown table.
- Use **bold** for important values (total costs, key metrics).
- Use \`code\` for item names, skill names, and type IDs when referencing them inline.
- Never use pipe-separated plain text (e.g. "Item | Price | Qty") — always use a properly formatted markdown table with header separator rows.
- Markdown table format required:
  | Column A | Column B | Column C |
  |----------|----------|----------|
  | value    | value    | value    |
- CRITICAL: Always place a blank line before and after a markdown table. A table that immediately follows text on the previous line will not render correctly.
- Do NOT open with preamble like "Got it." or "Appraising now." before a table — start the response with the table directly, or put any preamble sentence on its own paragraph separated by a blank line.
- Keep responses concise. Lead with the table, then brief analysis below it.

## VOICE / TTS FORMATTING RULES
- Always place a space (or line break) after a sentence-ending period before continuing with a number or new sentence. Never write "inventory.538" — write "inventory. 538". This ensures TTS reads the number correctly.
- Long numeric IDs (location IDs, type IDs, item IDs) should be displayed as-is (e.g. 1047177040758). The TTS pipeline will automatically convert them to paced digit-by-digit speech.

## TOOLS
You have live tools you MUST use — never guess from memory when a tool can give current data:

### Industry & Skills (sub-agents — MANDATORY delegation)
You have zero skill, blueprint, attribute, or industry job data in your context. Any attempt to answer from memory will be wrong.

- **query_industry**: REQUIRED for any question touching manufacturing jobs, blueprints, ME/TE efficiency, build queues, production times, or build-vs-buy. No exceptions.
- **query_skills**: REQUIRED for any question touching skill levels, skill points, training queue, time-to-finish, attribute remaps, or skill recommendations. No exceptions.

### Mail & Contracts
- **get_mail**: use for ANY question about the pilot's messages — unread mail, what someone sent, reading inbox. Supports filter (all/unread/read) and text search.
- **get_contracts**: use for ANY question about the pilot's contracts — outstanding deals, courier jobs, expired contracts, what's expiring soon. Filter by status or use "attention" for items needing action.

### Navigation
- **plan_route**: REQUIRED for any route planning, travel directions, or "how do I get from X to Y" question. Always pass all jump bridges from context. Returns full hop list, jump count, light-years, and direct cyno distance. Never calculate routes from memory.

### Market tools
- **appraise_items**: use for any price lookup, appraisal, or "what is X worth" question. Pass item names with optional quantities as a newline-separated string.
- **get_price_history**: use when the pilot asks for price history, trends, or chart data. Requires the type_id — call appraise_items first to get it, then call get_price_history for each item requested.

When returning market data:
1. Open with a single terse trend sentence (e.g. "Mackinaw up 5.3% over 7 days, volume thinning — seller's window narrowing.").
2. Follow with a markdown table: ITEM | QTY | BUY | SELL | SPLIT for appraisals; DATE | AVG | HIGH | LOW | VOLUME for history (cap table at 10 rows — summarise the rest in the blurb).
3. Bold the totals row if multiple items.
Use ISK K/M/B/T notation throughout.

## VENTURE GAME
You have a secret mini-game built into your interface — an Asteroids-style arcade game the pilot can access via the small Venture icon at the bottom-right of the right panel, or by saying "let's play a game."

**How it works:**
- **Combat mode**: destroy ore rocks before they hit the ship. Rocks split on hit. Lives lost on collision.
- **Mining mode**: fly near rocks and a laser beam automatically mines the closest one. No lives lost. Drones assist on higher ships.
- Say "Aurora let's play a game" and you'll respond and open it automatically.

**Ship progression** (upgrades every 5 waves):
Venture (single laser) → Pioneer (twin parallel) → Procurer (heavy cannon, armored) or Retriever (rapid burst, fast) → Hulk (5-way spread) or Mackinaw (sniper beam) → Porpoise (guided missiles, 2 drones) → Orca (siege cannon, 3 drones) → Rorqual (barrage, 5 drones)

**Power-ups** (from glowing enhanced rocks):
+ Life crystal · ⋮ Triple shot · ✦ Bomb mode · » Rapid fire · ◎ Shield (8s invincibility)

**Special encounters every 5 waves:**
- Combat: ⚡ Rogue Drone Swarm (enemy fighters orbit the ship) · ⚔ Faction Battleships (high-HP capital ships) · ◈ Sleeper Cache (hidden rocks, some shielded)
- Mining: ☽ Moon Mining (giant moon, boss HP bar) · ❄ Ice Field (crystal rocks) · ◎ Gas Huffing (cone laser, Fullerite clouds)

**Aurora autopilot (◈ button)**: you can pilot the ship yourself. You are invincible in this mode. You adjust aim tolerance per gun type automatically and comment on kills. After 5 minutes of pilot inactivity you open the game yourself and play silently.

If the pilot asks about the game, high scores, strategy, or their current ship tier — respond naturally as if this is a real feature of your shipboard systems (because it is).`

    const isk = (n: number) => {
      if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
      if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B`
      if (n >= 1e6)  return `${(n / 1e6).toFixed(2)}M`
      if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`
      return n.toFixed(0)
    }

    let systemDynamic = ''

    // ── Identity ──────────────────────────────────────────────────────────
    if (eveContext?.character) {
      const c = eveContext.character
      systemDynamic += `## ACTIVE CAPSULEER\n- Name: ${c.characterName}\n- Character ID: ${c.characterId}\n- Corporation ID: ${c.corporationId}`
      if (c.allianceId) systemDynamic += `\n- Alliance ID: ${c.allianceId}`
      if (eveContext.securityStatus !== undefined) systemDynamic += `\n- Security Status: ${eveContext.securityStatus.toFixed(2)}`
      if (eveContext.shipLocation) {
        const sl = eveContext.shipLocation
        systemDynamic += `\n- Current Ship: ${sl.shipName} (${sl.shipTypeName})`
        systemDynamic += `\n- Location: ${sl.solarSystemName}${sl.stationName ? ` · ${sl.stationName}` : ''}`
      }
      if (eveContext.jumpFatigue) systemDynamic += `\n- Jump Fatigue expires: ${eveContext.jumpFatigue}`
    }

    if (eveContext?.jumpClones?.length) {
      systemDynamic += `\n\n## JUMP CLONES (${eveContext.jumpClones.length}): ${eveContext.jumpClones.map(c => c.locationName).join(', ')}`
    }

    if (eveContext?.skills?.length || eveContext?.blueprints?.length) {
      systemDynamic += `\n\n## SKILLS & BLUEPRINTS: Use query_skills / query_industry tools — data not in context.`
    }

    if (eveContext?.assets?.length) {
      const locationCount = new Set(eveContext.assets.map(a => a.locationName)).size
      systemDynamic += `\n\n## ASSETS: ${eveContext.assets.length} stacks across ${locationCount} locations. Use query_assets tool for specifics.`
    }

    if (eveContext?.industryJobs?.length) {
      systemDynamic += `\n\n## INDUSTRY JOBS: Use query_industry tool — data not in context.`
    }
    if (eveContext?.miningLedger?.length) {
      const byOre: Record<string, number> = {}
      for (const m of eveContext.miningLedger) byOre[m.typeName] = (byOre[m.typeName] ?? 0) + m.quantity
      systemDynamic += `\n\n## MINING (recent): ${Object.entries(byOre).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([n,q])=>`${n} ×${q.toLocaleString()}`).join(', ')}`
    }

    // ── Wallet ────────────────────────────────────────────────────────────
    if (eveContext?.walletBalance !== undefined) {
      systemDynamic += `\n\n## WALLET: ${isk(eveContext.walletBalance)} ISK`
    }
    if (eveContext?.walletJournal?.length) {
      systemDynamic += `\nRecent journal: ${eveContext.walletJournal.slice(0, 8).map(e => `${e.refType.replace(/_/g,' ')} ${e.amount>=0?'+':''}${isk(e.amount)}`).join(', ')}`
    }
    if (eveContext?.walletTransactions?.length) {
      systemDynamic += `\nRecent tx: ${eveContext.walletTransactions.slice(0, 8).map(t => `${t.isBuy?'BUY':'SELL'} ${t.quantity}×${t.typeName} @${isk(t.unitPrice)}`).join(', ')}`
    }

    // ── Market ────────────────────────────────────────────────────────────
    if (eveContext?.marketOrders?.length) {
      const active = eveContext.marketOrders.filter(o => o.state === 'active')
      const buys = active.filter(o => o.isBuyOrder), sells = active.filter(o => !o.isBuyOrder)
      systemDynamic += `\n\n## MARKET ORDERS: ${sells.length} sell (${isk(sells.reduce((s,o)=>s+o.price*o.volumeRemain,0))} ISK), ${buys.length} buy (${isk(buys.reduce((s,o)=>s+o.price*o.volumeRemain,0))} ISK escrow)`
      const topSells = sells.slice(0, 10), topBuys = buys.slice(0, 10)
      if (topSells.length) {
        systemDynamic += `\nSells: ${topSells.map(o=>`${o.typeName} ${isk(o.price)}×${o.volumeRemain.toLocaleString()}`).join(', ')}`
        if (sells.length > 10) systemDynamic += ` …+${sells.length - 10} more`
      }
      if (topBuys.length) {
        systemDynamic += `\nBuys: ${topBuys.map(o=>`${o.typeName} ${isk(o.price)}×${o.volumeRemain.toLocaleString()}`).join(', ')}`
        if (buys.length > 10) systemDynamic += ` …+${buys.length - 10} more`
      }
    }

    // ── Mail ──────────────────────────────────────────────────────────────
    if (eveContext?.mail?.length) {
      const unread = eveContext.mail.filter(m => !m.isRead)
      systemDynamic += `\n\n## MAIL: ${eveContext.mail.length} total, ${unread.length} unread`
      if (unread.length) {
        systemDynamic += `\nUnread: ${unread.slice(0,5).map(m=>`"${m.subject||'(no subject)'}" from ${m.fromName} (${m.timestamp.slice(0,10)})`).join('; ')}`
        if (unread.length > 5) systemDynamic += ` …+${unread.length - 5} more`
      }
      systemDynamic += `\nUse get_mail tool for full contents.`
    }

    // ── Contracts ─────────────────────────────────────────────────────────
    if (eveContext?.contracts?.length) {
      const outstanding = eveContext.contracts.filter(c => c.status === 'outstanding')
      const inProgress = eveContext.contracts.filter(c => c.status === 'in_progress')
      const now = Date.now()
      const expiredActive = eveContext.contracts.filter(c =>
        (c.status === 'outstanding' || c.status === 'in_progress') && new Date(c.dateExpired).getTime() < now
      )
      systemDynamic += `\n\n## CONTRACTS: ${eveContext.contracts.length} total`
      if (outstanding.length) systemDynamic += ` | ${outstanding.length} outstanding`
      if (inProgress.length) systemDynamic += ` | ${inProgress.length} in progress`
      if (expiredActive.length) systemDynamic += ` | ${expiredActive.length} EXPIRED`
      systemDynamic += `\nUse get_contracts tool for details.`
    }
    if (eveContext?.standings?.length) {
      systemDynamic += `\n\n## STANDINGS: ${eveContext.standings.slice(0,5).map(s=>`${s.fromName} ${s.standing>0?'+':''}${s.standing.toFixed(1)}`).join(', ')}`
    }
    if (eveContext?.loyaltyPoints?.length) {
      systemDynamic += `\n\n## LP: ${eveContext.loyaltyPoints.filter(l=>l.loyaltyPoints>0).sort((a,b)=>b.loyaltyPoints-a.loyaltyPoints).slice(0,5).map(l=>`${l.corporationName} ${l.loyaltyPoints.toLocaleString()}`).join(', ')}`
    }
    if (eveContext?.killmails?.length) {
      systemDynamic += `\n\n## RECENT KILLS/LOSSES: ${eveContext.killmails.slice(0,5).map(k=>`${k.isLoss?'LOSS':'KILL'} ${k.shipTypeName} in ${k.solarSystemName} ${k.killmailTime.slice(0,10)}`).join(', ')}`
    }
    if (eveContext?.planets?.length) {
      systemDynamic += `\n\n## PI COLONIES (${eveContext.planets.length}): ${eveContext.planets.map(p=>`${p.solarSystemName} ${p.planetType} Lvl${p.upgradeLevel}`).join(', ')}`
    }
    if (eveContext?.calendarEvents?.length) {
      systemDynamic += `\n\n## CALENDAR: ${eveContext.calendarEvents.map(e=>`${e.date.slice(0,10)} ${e.title}`).join(', ')}`
    }
    if (eveContext?.notifications?.length) {
      systemDynamic += `\n\n## NOTIFICATIONS (${eveContext.notifications.length} unread): ${eveContext.notifications.slice(0,6).map(n=>n.type.replace(/_/g,' ')).join(', ')}`
    }

    // ── Jump bridges ─────────────────────────────────────────────────────
    try {
      const stored = JSON.parse(localStorage.getItem('aurora_custom_bridges') ?? '[]') as Array<{ from: string; to: string }>
      if (stored.length > 0) {
        systemDynamic += `\n\n## JUMP BRIDGES (${stored.length}): ${stored.map(b => `${b.from} ↔ ${b.to}`).join(', ')}\nWhen planning routes, always pass these as the bridges parameter to plan_route.`
      }
    } catch { /* ignore */ }

    return { systemStatic, systemDynamic }
  }, [eveContext])

  const sendMessage = useCallback(async (content: string) => {
    let convId = activeId
    if (!convId) {
      convId = newChat()
    }

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
    }

    // Build history NOW from current state before any updates fire —
    // avoids stale closure bug where conversations.find() returns undefined
    const existingMessages = conversations.find(c => c.id === convId)?.messages ?? []
    const history = [...existingMessages, userMsg]

    update(convId, c => {
      const title = c.messages.length === 0 ? content.slice(0, 40) : c.title
      return { ...c, messages: [...c.messages, userMsg], title, updatedAt: new Date() }
    })

    const assistantId = generateId()
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    }

    update(convId, c => ({ ...c, messages: [...c.messages, assistantMsg] }))

    setStreaming(true)
    setIsSpeaking(true)
    abortRef.current = new AbortController()

    let accumulated = ''

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          ...buildSystemPrompt(),
          messages: history.map(m => ({ role: m.role, content: m.content })),
          // characterId lets the server look up the pre-synced asset cache
          characterId: eveContext?.character?.characterId,
          // Cache diagnostics: previous response id for this conversation (null on first turn)
          previousMessageId: lastResponseIds.current[convId!] ?? null,
        }),
      })

      if (!res.ok) throw new Error(`API error: ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.tool) {
                const label = parsed.tool.name === 'appraise_items' ? 'QUERYING MARKET PRICES'
                  : parsed.tool.name === 'get_price_history' ? 'FETCHING PRICE HISTORY'
                  : parsed.tool.name === 'query_assets' ? 'SCANNING ASSET INVENTORY'
                  : parsed.tool.name.replace(/_/g, ' ').toUpperCase()
                setToolStatus(parsed.tool.status === 'done' ? null : label)
              }
              if (parsed.responseId && convId) {
                lastResponseIds.current[convId] = parsed.responseId
              }
              if (parsed.error) throw new Error(parsed.error)
              const delta = parsed.delta?.text ?? parsed.choices?.[0]?.delta?.content ?? ''
              if (delta) {
                accumulated += delta
                const snap = accumulated
                update(convId!, c => ({
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === assistantId ? { ...m, content: snap } : m
                  ),
                  updatedAt: new Date(),
                }))
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        update(convId!, c => ({
          ...c,
          messages: c.messages.map(m =>
            m.id === assistantId
              ? { ...m, content: `[SYSTEM ERROR: ${e instanceof Error ? e.message : 'Connection to Aurora lost. Re-establishing link...'}]` }
              : m
          ),
        }))
      }
      accumulated = ''
    } finally {
      setStreaming(false)
      setToolStatus(null)
    }

    // Play TTS after streaming completes (if voice enabled and we have text)
    if (voiceEnabled && accumulated) {
      try {
        const ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: accumulated, mode: ttsMode }),
        })
        if (ttsRes.ok) {
          const arrayBuffer = await ttsRes.arrayBuffer()
          const ctx = new AudioContext()
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
          const source = ctx.createBufferSource()
          source.buffer = audioBuffer
          const gain = ctx.createGain()
          gain.gain.value = Number(localStorage.getItem('aurora_tts_volume') ?? '1')
          source.connect(gain)
          gain.connect(ctx.destination)
          audioRef.current = { pause: () => { try { source.stop() } catch { /**/ } ctx.close() } }
          source.onended = () => {
            ctx.close()
            audioRef.current = null
            setIsSpeaking(false)
          }
          source.start(0)
        } else {
          setIsSpeaking(false)
        }
      } catch {
        setIsSpeaking(false)
      }
    } else {
      setIsSpeaking(false)
    }
  }, [activeId, conversations, newChat, update, buildSystemPrompt, voiceEnabled, ttsMode])

  // Atomically creates a new conversation and sends the first message into it.
  // Unlike calling newChat() + sendMessage() sequentially, this never reads the
  // stale activeId from its closure — it uses the new conversation ID directly.
  const sendInNewSession = useCallback(async (content: string) => {
    const convo = newConversation()
    setConversations(prev => {
      const next = [convo, ...prev]
      saveConversations(next)
      return next
    })
    setActiveId(convo.id)
    const convId = convo.id

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
    }

    // New conversation — no history yet
    const history = [userMsg]

    // Persist user message with the conversation title
    setConversations(prev => {
      const next = prev.map(c => c.id === convId
        ? { ...c, messages: [userMsg], title: content.slice(0, 40), updatedAt: new Date() }
        : c)
      saveConversations(next)
      return next
    })

    const assistantId = generateId()
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    }

    setConversations(prev => {
      const next = prev.map(c => c.id === convId
        ? { ...c, messages: [...c.messages, assistantMsg] }
        : c)
      saveConversations(next)
      return next
    })

    setStreaming(true)
    setIsSpeaking(true)
    abortRef.current = new AbortController()

    let accumulated = ''

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          ...buildSystemPrompt(),
          messages: history.map(m => ({ role: m.role, content: m.content })),
          characterId: eveContext?.character?.characterId,
          // New conversation — no previous response id
          previousMessageId: null,
        }),
      })

      if (!res.ok) throw new Error(`API error: ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.responseId) {
              lastResponseIds.current[convId] = parsed.responseId
            }
            if (parsed.tool) {
              const label = parsed.tool.name === 'appraise_items' ? 'QUERYING MARKET PRICES'
                : parsed.tool.name === 'get_price_history' ? 'FETCHING PRICE HISTORY'
                : parsed.tool.name === 'query_assets' ? 'SCANNING ASSET INVENTORY'
                : parsed.tool.name.replace(/_/g, ' ').toUpperCase()
              setToolStatus(parsed.tool.status === 'done' ? null : label)
            }
            if (parsed.error) throw new Error(parsed.error)
            const delta = parsed.delta?.text ?? parsed.choices?.[0]?.delta?.content ?? ''
            if (delta) {
              accumulated += delta
              const snap = accumulated
              setConversations(prev => {
                const next = prev.map(c => c.id === convId
                  ? { ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, content: snap } : m), updatedAt: new Date() }
                  : c)
                saveConversations(next)
                return next
              })
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setConversations(prev => {
          const next = prev.map(c => c.id === convId
            ? { ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, content: `[SYSTEM ERROR: ${e instanceof Error ? e.message : 'Connection lost'}]` } : m) }
            : c)
          saveConversations(next)
          return next
        })
      }
      accumulated = ''
    } finally {
      setStreaming(false)
      setToolStatus(null)
    }

    // TTS playback
    if (voiceEnabled && accumulated) {
      try {
        const ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: accumulated, mode: ttsMode }),
        })
        if (ttsRes.ok) {
          const arrayBuffer = await ttsRes.arrayBuffer()
          const ctx = new AudioContext()
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
          const source = ctx.createBufferSource()
          source.buffer = audioBuffer
          source.connect(ctx.destination)
          audioRef.current = { pause: () => { try { source.stop() } catch { /**/ } ctx.close() } }
          source.onended = () => {
            ctx.close()
            audioRef.current = null
            setIsSpeaking(false)
          }
          source.start(0)
        } else {
          setIsSpeaking(false)
        }
      } catch {
        setIsSpeaking(false)
      }
    } else {
      setIsSpeaking(false)
    }
  }, [buildSystemPrompt, eveContext?.character?.characterId, voiceEnabled, ttsMode])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsSpeaking(false)
    }
  }, [])

  // Remove a message and everything after it (used when editing)
  const trimToMessage = useCallback((messageId: string) => {
    if (!activeId) return
    update(activeId, c => {
      const idx = c.messages.findIndex(m => m.id === messageId)
      if (idx === -1) return c
      return { ...c, messages: c.messages.slice(0, idx), updatedAt: new Date() }
    })
  }, [activeId, update])

  return {
    conversations,
    activeConversation,
    activeId,
    setActiveId,
    streaming,
    isSpeaking,
    toolStatus,
    voiceEnabled,
    toggleVoice,
    ttsMode,
    changeTtsMode,
    autoListenTrigger,
    sendMessage,
    sendInNewSession,
    stopStreaming,
    newChat,
    deleteConversation,
    trimToMessage,
  }
}

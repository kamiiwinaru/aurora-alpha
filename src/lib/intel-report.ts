import { EVE_SYSTEM_INFO } from './eve-system-info'
import { EVE_SYSTEM_IDS } from './eve-system-ids'
import { findRoute } from '../components/panels/IntelPanel'

// ── Ship tactical database ────────────────────────────────────────────────────

const SHIP_ROLES: Record<string, { role: string; threat: 'low' | 'medium' | 'high' | 'critical'; note: string }> = {
  // Frigates
  Rifter:       { role: 'combat frigate', threat: 'low',     note: 'fast tackle / solo skirmisher' },
  Punisher:     { role: 'combat frigate', threat: 'low',     note: 'armour brawler' },
  Slasher:      { role: 'combat frigate', threat: 'low',     note: 'fast tackle' },
  Merlin:       { role: 'combat frigate', threat: 'low',     note: 'shield brawler' },
  Atron:        { role: 'combat frigate', threat: 'low',     note: 'tackle / speed' },
  Condor:       { role: 'combat frigate', threat: 'low',     note: 'missile kiter' },
  Incursus:     { role: 'combat frigate', threat: 'low',     note: 'armour brawler' },
  Kestrel:      { role: 'combat frigate', threat: 'low',     note: 'missile kiter' },
  Tristan:      { role: 'drone frigate',  threat: 'low',     note: 'drone brawler' },
  Executioner:  { role: 'combat frigate', threat: 'low',     note: 'fast kiter' },
  Tormentor:    { role: 'combat frigate', threat: 'low',     note: 'armour kiter' },
  // Interceptors
  Crow:         { role: 'interceptor',    threat: 'medium',  note: 'tackle — immune to bubbles' },
  Stiletto:     { role: 'interceptor',    threat: 'medium',  note: 'tackle — immune to bubbles' },
  Ares:         { role: 'interceptor',    threat: 'medium',  note: 'tackle — immune to bubbles' },
  Malediction:  { role: 'interceptor',    threat: 'medium',  note: 'tackle — immune to bubbles' },
  Taranis:      { role: 'interceptor',    threat: 'medium',  note: 'combat interceptor' },
  Crusader:     { role: 'interceptor',    threat: 'medium',  note: 'combat interceptor' },
  Raptor:       { role: 'interceptor',    threat: 'medium',  note: 'tackle interceptor' },
  Claw:         { role: 'interceptor',    threat: 'medium',  note: 'combat interceptor' },
  // Assault Frigates
  Wolf:         { role: 'assault frigate', threat: 'medium', note: 'heavy armour brawler' },
  Jaguar:       { role: 'assault frigate', threat: 'medium', note: 'shield brawler / tackle' },
  Hawk:         { role: 'assault frigate', threat: 'medium', note: 'shield missile boat' },
  Harpy:        { role: 'assault frigate', threat: 'medium', note: 'shield rail boat' },
  Enyo:         { role: 'assault frigate', threat: 'medium', note: 'armour blaster brawler' },
  Ishkur:       { role: 'assault frigate', threat: 'medium', note: 'drone assault frigate' },
  Retribution:  { role: 'assault frigate', threat: 'medium', note: 'laser armour brawler' },
  Vengeance:    { role: 'assault frigate', threat: 'medium', note: 'missile armour brawler' },
  // Destroyers
  Catalyst:     { role: 'destroyer',      threat: 'medium', note: 'ganking platform — high DPS burst' },
  Thrasher:     { role: 'destroyer',      threat: 'medium', note: 'arty alpha / ganker' },
  Coercer:      { role: 'destroyer',      threat: 'medium', note: 'laser DPS boat' },
  Cormorant:    { role: 'destroyer',      threat: 'medium', note: 'rail / missile kiter' },
  Algos:        { role: 'drone destroyer', threat: 'medium', note: 'drone + rail hybrid' },
  Dragoon:      { role: 'drone destroyer', threat: 'medium', note: 'neut / drone disruptor' },
  // Interdictors
  Sabre:        { role: 'interdictor',    threat: 'high',   note: 'bubble launcher — gate camper' },
  Heretic:      { role: 'interdictor',    threat: 'high',   note: 'bubble launcher' },
  Flycatcher:   { role: 'interdictor',    threat: 'high',   note: 'bubble launcher' },
  Eris:         { role: 'interdictor',    threat: 'high',   note: 'bubble launcher' },
  // Cruisers
  Stabber:      { role: 'combat cruiser', threat: 'medium', note: 'fast artillery cruiser' },
  Rupture:      { role: 'combat cruiser', threat: 'medium', note: 'armour brawler' },
  Bellicose:    { role: 'combat cruiser', threat: 'medium', note: 'missile / EWAR' },
  Scythe:       { role: 'logistics',      threat: 'medium', note: 'fleet logistics — shield reps' },
  Thorax:       { role: 'combat cruiser', threat: 'medium', note: 'blaster brawler' },
  Vexor:        { role: 'drone cruiser',  threat: 'medium', note: 'drone brawler' },
  Celestis:     { role: 'EWAR cruiser',   threat: 'medium', note: 'sensor dampening' },
  Exequror:     { role: 'logistics',      threat: 'low',    note: 'fleet logistics — armour reps' },
  Maller:       { role: 'combat cruiser', threat: 'medium', note: 'armour laser brawler' },
  Omen:         { role: 'combat cruiser', threat: 'medium', note: 'laser / speed cruiser' },
  Augoror:      { role: 'logistics',      threat: 'low',    note: 'fleet logistics — armour reps' },
  Caracal:      { role: 'combat cruiser', threat: 'medium', note: 'missile kiter' },
  Blackbird:    { role: 'EWAR cruiser',   threat: 'high',   note: 'ECM jammer — disables locks' },
  Osprey:       { role: 'logistics',      threat: 'low',    note: 'fleet logistics — shield reps' },
  // Heavy Assault Cruisers
  Vagabond:     { role: 'HAC',            threat: 'high',   note: 'fast shield cruiser — very dangerous solo' },
  Muninn:       { role: 'HAC',            threat: 'high',   note: 'artillery HAC — fleet doctrine staple' },
  Deimos:       { role: 'HAC',            threat: 'high',   note: 'blaster brawler HAC' },
  Ishtar:       { role: 'HAC',            threat: 'high',   note: 'drone HAC — sentry platform' },
  Cerberus:     { role: 'HAC',            threat: 'high',   note: 'missile HAC — long range' },
  Eagle:        { role: 'HAC',            threat: 'high',   note: 'rail HAC — fleet sniper' },
  Zealot:       { role: 'HAC',            threat: 'high',   note: 'laser HAC — fleet DPS' },
  Sacrilege:    { role: 'HAC',            threat: 'high',   note: 'missile HAC — armour brawler' },
  // Recon
  Falcon:       { role: 'force recon',    threat: 'high',   note: 'ECM — can jam from off-grid, cloaky' },
  Rook:         { role: 'combat recon',   threat: 'high',   note: 'ECM — combat recon, no cloak bonus' },
  Rapier:       { role: 'force recon',    threat: 'high',   note: 'webs / point — cloaky tackle anchor' },
  Huginn:       { role: 'combat recon',   threat: 'high',   note: 'webs / paint — fleet support' },
  Arazu:        { role: 'force recon',    threat: 'high',   note: 'point / damp — cloaky hunter' },
  Lachesis:     { role: 'combat recon',   threat: 'high',   note: 'long-range point / damp' },
  Curse:        { role: 'force recon',    threat: 'high',   note: 'neut / damp — cloaky energy vampire' },
  Pilgrim:      { role: 'combat recon',   threat: 'high',   note: 'neut / damp — ambush specialist' },
  // Battlecruisers
  Hurricane:    { role: 'battlecruiser',  threat: 'high',   note: 'arty alpha / armour fleet BC' },
  Tornado:      { role: 'attack BC',      threat: 'high',   note: 'alpha strike artillery — ganker / alpha fleet' },
  Prophecy:     { role: 'battlecruiser',  threat: 'high',   note: 'drone / armour brawler' },
  Harbinger:    { role: 'battlecruiser',  threat: 'high',   note: 'laser armour fleet BC' },
  Drake:        { role: 'battlecruiser',  threat: 'high',   note: 'missile shield BC — docrine staple' },
  Ferox:        { role: 'battlecruiser',  threat: 'high',   note: 'rail / missile shield BC' },
  // Command Ships
  Claymore:     { role: 'command ship',   threat: 'high',   note: 'skirmish command bursts — fleet multiplier' },
  Sleipnir:     { role: 'command ship',   threat: 'high',   note: 'shield assault command' },
  Absolution:   { role: 'command ship',   threat: 'high',   note: 'armour assault command' },
  Damnation:    { role: 'command ship',   threat: 'high',   note: 'armour fleet command' },
  Nighthawk:    { role: 'command ship',   threat: 'high',   note: 'shield missile command' },
  Vulture:      { role: 'command ship',   threat: 'high',   note: 'shield fleet command' },
  // Battleships
  Tempest:      { role: 'battleship',     threat: 'high',   note: 'artillery / missile BS' },
  Typhoon:      { role: 'battleship',     threat: 'high',   note: 'missile / drone BS' },
  Machariel:    { role: 'battleship',     threat: 'critical', note: 'fast artillery BS — roaming fleets' },
  Megathron:    { role: 'battleship',     threat: 'high',   note: 'blaster / rail BS' },
  Dominix:      { role: 'battleship',     threat: 'high',   note: 'drone BS / remote rep' },
  Hyperion:     { role: 'battleship',     threat: 'high',   note: 'blaster brawler BS' },
  Apocalypse:   { role: 'battleship',     threat: 'high',   note: 'laser BS' },
  Armageddon:   { role: 'battleship',     threat: 'high',   note: 'neut / drone BS' },
  Raven:        { role: 'battleship',     threat: 'high',   note: 'missile BS' },
  Scorpion:     { role: 'battleship',     threat: 'high',   note: 'ECM BS — fleet disruption' },
  'Raven Navy Issue':      { role: 'navy battleship', threat: 'high',   note: 'enhanced missile BS' },
  'Megathron Navy Issue':  { role: 'navy battleship', threat: 'high',   note: 'enhanced blaster BS' },
  'Apocalypse Navy Issue': { role: 'navy battleship', threat: 'high',   note: 'enhanced laser BS' },
  'Typhoon Fleet Issue':   { role: 'navy battleship', threat: 'high',   note: 'enhanced missile / drone BS' },
  // Industrials / Mining
  Orca:         { role: 'industrial command', threat: 'low',   note: 'mining booster / hauler — not a combat ship; Industrial Core makes it immobile and a free kill' },
  Rorqual:      { role: 'capital industrial', threat: 'low',   note: 'capital mining — immobile when active; extremely high-value target' },
  Hulk:         { role: 'exhumer',        threat: 'low',    note: 'mining — no combat capability' },
  Skiff:        { role: 'exhumer',        threat: 'low',    note: 'tanky mining — drone defence only' },
  Mackinaw:     { role: 'exhumer',        threat: 'low',    note: 'high-yield mining — fragile' },
  Retriever:    { role: 'mining barge',   threat: 'low',    note: 'mining — minimal tank' },
  Covetor:      { role: 'mining barge',   threat: 'low',    note: 'mining — no tank' },
  Procurer:     { role: 'mining barge',   threat: 'low',    note: 'defensive mining — drone + tank' },
  Venture:      { role: 'mining frigate', threat: 'low',    note: 'rookie mining — two high-slots only' },
  // Capitals
  Thanatos:     { role: 'carrier',        threat: 'critical', note: 'fighter carrier — fighter drones, not subcap drones' },
  Nidhoggur:    { role: 'carrier',        threat: 'critical', note: 'fighter carrier — also remote reps' },
  Archon:       { role: 'carrier',        threat: 'critical', note: 'armour carrier — triage / fighters' },
  Chimera:      { role: 'carrier',        threat: 'critical', note: 'shield carrier — fighters / remote shield' },
  Revelation:   { role: 'dreadnought',    threat: 'critical', note: 'siege dreadnought — structure / capital killer' },
  Naglfar:      { role: 'dreadnought',    threat: 'critical', note: 'siege dreadnought' },
  Moros:        { role: 'dreadnought',    threat: 'critical', note: 'siege dreadnought' },
  Phoenix:      { role: 'dreadnought',    threat: 'critical', note: 'missile siege dreadnought' },
  Leviathan:    { role: 'titan',          threat: 'critical', note: 'superweapon — doomsday device, jump bridge' },
  Erebus:       { role: 'titan',          threat: 'critical', note: 'superweapon — doomsday device' },
  Ragnarok:     { role: 'titan',          threat: 'critical', note: 'superweapon — doomsday device' },
  Avatar:       { role: 'titan',          threat: 'critical', note: 'superweapon — doomsday device' },
}

// ── Security label ────────────────────────────────────────────────────────────

function secLabel(sec: number): string {
  const s = Math.round(sec * 10) / 10
  if (s >= 0.5) return `${s.toFixed(1)} (highsec)`
  if (s > 0.0)  return `${s.toFixed(1)} (lowsec)`
  return `${s.toFixed(1)} (nullsec)`
}

function secShort(sec: number): string {
  if (sec >= 0.5) return sec.toFixed(2)
  if (sec > 0.0)  return sec.toFixed(2)
  return sec.toFixed(2)
}

// ── Threat tier ───────────────────────────────────────────────────────────────

function threatTier(count: number | undefined, jumps: number | undefined): 'critical' | 'high' | 'medium' | 'low' {
  const n = count ?? 1
  const j = jumps ?? 99
  if (j === 0) return 'critical'
  if (n >= 100 || (n >= 20 && j <= 3)) return 'critical'
  if (n >= 20 || (n >= 5 && j <= 3) || j <= 2) return 'high'
  if (n >= 5 || j <= 5) return 'medium'
  return 'low'
}

// ── Main report builder ───────────────────────────────────────────────────────

export interface IntelAlertDetail {
  urgency: string
  system?: string
  jumps?: number
  count?: number
  characters?: string[]
  ships?: string[]
}

export function buildIntelReport(
  detail: IntelAlertDetail,
  originId: number | null,
  originName: string | null,
): string {
  const { system, jumps, count, characters, ships } = detail
  const tier = threatTier(count, jumps)

  const header =
    tier === 'critical' ? '🚨 CRITICAL THREAT' :
    tier === 'high'     ? '⚠ HOSTILE CONTACT' :
                          'INTEL REPORT'

  const lines: string[] = []

  // ── Header line ───────────────────────────────────────────────────────────
  const systemInfo = system ? EVE_SYSTEM_INFO.get(resolveSystemId(system) ?? 0) : undefined
  const headerSuffix = system
    ? ` — ${system.toUpperCase()}${jumps != null ? ` | ${jumps} JUMP${jumps === 1 ? '' : 'S'}` : ''}`
    : ''
  lines.push(`${header}${headerSuffix}`)
  lines.push('')

  // ── Route table ───────────────────────────────────────────────────────────
  if (originId && system) {
    const destId = resolveSystemId(system)
    if (destId && jumps != null && jumps <= 20) {
      const path = findRoute(originId, destId)
      if (path && path.length > 0) {
        lines.push('Route:')
        lines.push('Hop\tSystem\tSec\tRegion')
        path.forEach((sysId, i) => {
          const info = EVE_SYSTEM_INFO.get(sysId)
          const name = info?.name ?? sysId.toString()
          const sec  = info ? secShort(info.sec) : '?'
          const reg  = info?.region ?? ''
          const tag  = i === 0 && originName ? ` (${originName})` : i === path.length - 1 ? ' ← hostiles' : ''
          lines.push(`${i}\t${name}${tag}\t${sec}\t${reg}`)
        })
        lines.push('')
      }
    }
  } else if (system && systemInfo) {
    lines.push(`System: ${system} | Security: ${secLabel(systemInfo.sec)} | Region: ${systemInfo.region}`)
    lines.push('')
  }

  // ── Contact summary ───────────────────────────────────────────────────────
  if (count != null || (characters && characters.length) || (ships && ships.length)) {
    lines.push('Contacts:')
    if (count != null) lines.push(`▸ ${count}+ hostiles reported`)
    if (characters && characters.length) {
      lines.push(`▸ Pilots: ${characters.join(', ')}`)
    }
    if (ships && ships.length) {
      lines.push(`▸ Ships: ${ships.join(', ')}`)
    }
    lines.push('')
  }

  // ── Ship breakdowns ───────────────────────────────────────────────────────
  if (ships && ships.length) {
    const knowns = ships.map(s => ({ name: s, data: SHIP_ROLES[s] })).filter(s => s.data)
    if (knowns.length) {
      lines.push('Ship assessment:')
      for (const { name, data } of knowns) {
        lines.push(`▸ ${name} (${data.role}) — ${data.note}`)
      }
      lines.push('')
    }
  }

  // ── Tactical assessment ───────────────────────────────────────────────────
  lines.push('Tactical:')

  if (jumps === 0) {
    lines.push('▸ Hostiles IN SYSTEM. Do not undock. Weapons cold.')
    if (count && count >= 5) lines.push('▸ Multiple contacts in system — likely gate camp or bubble trap.')
  } else if (jumps != null && jumps <= 2) {
    lines.push(`▸ ${jumps} jump${jumps === 1 ? '' : 's'} — immediate threat radius. Align safe, prepare to dock.`)
    if (systemInfo && systemInfo.sec < 0.5) {
      lines.push(`▸ ${system} is ${secLabel(systemInfo.sec)} — CONCORD will not respond. Engage at own risk.`)
    }
  } else if (jumps != null && jumps <= 5) {
    lines.push(`▸ ${jumps} jumps — within roaming range. Monitor local and gates.`)
  } else if (jumps != null) {
    lines.push(`▸ ${jumps} jumps out — outside immediate threat range. Keep situational awareness.`)
  }

  if (count != null) {
    if (count >= 100) {
      lines.push('▸ Fleet of this size indicates a large-scale op — do not engage, evacuate if threatened.')
    } else if (count >= 20) {
      lines.push('▸ Gang / small fleet size — coordinated threat, expect FC and logistics.')
    } else if (count >= 5) {
      lines.push('▸ Small gang — likely roaming. Watch for tackle.')
    }
  }

  if (ships) {
    const hasCaps = ships.some(s => ['carrier', 'dreadnought', 'titan', 'supercarrier'].some(r => SHIP_ROLES[s]?.role.includes(r)))
    const hasRecon = ships.some(s => SHIP_ROLES[s]?.role.includes('recon'))
    const hasInterdictor = ships.some(s => SHIP_ROLES[s]?.role.includes('interdictor'))
    const hasLogi = ships.some(s => SHIP_ROLES[s]?.role.includes('logistics'))
    if (hasCaps)        lines.push('▸ Capital ships present — do not engage without capital support.')
    if (hasRecon)       lines.push('▸ Recon on field — expect cloaked scouts and off-grid support.')
    if (hasInterdictor) lines.push('▸ Interdictor reported — gates and warp-outs may be bubbled.')
    if (hasLogi)        lines.push('▸ Logistics on field — sustained DPS required to break reps.')
  }

  if (systemInfo && systemInfo.sec < 0.5 && systemInfo.sec > 0) {
    lines.push(`▸ Lowsec — CONCORD does not respond. Gate guns are present at entry points.`)
  } else if (systemInfo && systemInfo.sec <= 0) {
    lines.push(`▸ Nullsec — no CONCORD, no gate guns. Anything goes.`)
  }

  return lines.join('\n')
}

function resolveSystemId(name: string): number | null {
  return EVE_SYSTEM_IDS.get(name.toLowerCase()) ?? null
}

import { useEffect, useRef, useState, type ReactNode } from 'react'

// ── TYPES ─────────────────────────────────────────────────────────────────────
type ShipTier = 'venture'|'pioneer'|'procurer'|'retriever'|'hulk'|'mackinaw'|'porpoise'|'orca'|'rorqual'
type RockType = 'rock'|'ice'|'gas'|'moon'
type WaveType = 'normal'|'moon'|'ice'|'gas'|'drones'|'faction'|'sleeper'
type PowerUpType = 'life'|'tripleshot'|'bomb'|'rapidfire'|'shield'
type GunType = 'single'|'twin'|'cannon'|'burst'|'spread'|'sniper'|'guided'|'siege'|'barrage'
interface Vec2 { x: number; y: number }
interface Ship { pos: Vec2; vel: Vec2; angle: number; radius: number; invincible: number }
interface Bullet { pos: Vec2; vel: Vec2; life: number; isBomb: boolean; bRadius: number; homing?: boolean; damage?: number }
interface Rock {
  pos: Vec2; vel: Vec2; angle: number; spin: number
  radius: number; tier: number; ore: string; verts: number[]
  health: number; maxHealth: number; rockType: RockType
  powerUpType?: PowerUpType
  shields?: number
  faction?: boolean
  revealed?: boolean
  isDrone?: boolean
  isBattleship?: boolean
}
interface DroneState { orbitAngle: number; facingAngle: number; shootCooldown: number }
interface ActivePowerUp { type: Exclude<PowerUpType,'life'>; framesLeft: number }
interface GameState {
  ship: Ship; bullets: Bullet[]; rocks: Rock[]
  score: number; lives: number; wave: number
  phase: 'playing'|'dead'|'over'|'cleared'|'upgrading'
  respawnTimer: number; cleared: boolean; waveType: WaveType; waveStartFrame: number
  shipTier: ShipTier; shipBranch: 'procurer'|'retriever'|null
  upgradeOptions: ShipTier[]; upgradeSelected: number; upgradeTimer: number
  powerUps: ActivePowerUp[]; drones: DroneState[]
}

// ── SHIP STATS ────────────────────────────────────────────────────────────────
interface ShipStats {
  maxLives: number; radius: number; accel: number
  fireCooldown: number; mineRate: number; gunType: GunType
  droneCount: number; color: string; label: string; desc: string
}
const SHIP_STATS: Record<ShipTier, ShipStats> = {
  venture:  { maxLives:3,  radius:14, accel:0.18, fireCooldown:12, mineRate:1,   gunType:'single',  droneCount:0, color:'#00ccee', label:'VENTURE',  desc:'T1 Mining Frigate — Single Laser' },
  pioneer:  { maxLives:4,  radius:16, accel:0.20, fireCooldown:11, mineRate:1.5, gunType:'twin',    droneCount:0, color:'#00ddff', label:'PIONEER',  desc:'T2 Mining Frigate — Twin Parallel' },
  procurer: { maxLives:6,  radius:20, accel:0.13, fireCooldown:38, mineRate:2.0, gunType:'cannon',  droneCount:0, color:'#ff8844', label:'PROCURER', desc:'Mining Barge — Heavy Cannon' },
  retriever:{ maxLives:4,  radius:17, accel:0.22, fireCooldown:15, mineRate:2.5, gunType:'burst',   droneCount:0, color:'#44aaff', label:'RETRIEVER',desc:'Mining Barge — Rapid Burst Fire' },
  hulk:     { maxLives:8,  radius:24, accel:0.12, fireCooldown:18, mineRate:3.0, gunType:'spread',  droneCount:0, color:'#ff6622', label:'HULK',     desc:'Exhumer — 5-Way Wide Spread' },
  mackinaw: { maxLives:6,  radius:20, accel:0.20, fireCooldown:20, mineRate:3.5, gunType:'sniper',  droneCount:0, color:'#22aaff', label:'MACKINAW', desc:'Exhumer — Long-Range Sniper Beam' },
  porpoise: { maxLives:5,  radius:18, accel:0.20, fireCooldown:14, mineRate:2.0, gunType:'guided',  droneCount:2, color:'#44ffcc', label:'PORPOISE', desc:'Command Destroyer — Guided Missiles + 2 Drones' },
  orca:     { maxLives:7,  radius:28, accel:0.15, fireCooldown:55, mineRate:2.5, gunType:'siege',   droneCount:3, color:'#4488ff', label:'ORCA',     desc:'Industrial Command — Siege Cannon + 3 Drones' },
  rorqual:  { maxLives:9,  radius:35, accel:0.10, fireCooldown:14, mineRate:3.0, gunType:'barrage', droneCount:5, color:'#9966ff', label:'RORQUAL',  desc:'Capital Industrial — Barrage + 5 Drones' },
}

function getUpgradeOptions(tier: ShipTier): ShipTier[] {
  const m: Partial<Record<ShipTier, ShipTier[]>> = {
    venture: ['pioneer'], pioneer: ['procurer','retriever'],
    procurer: ['hulk'], retriever: ['mackinaw'],
    hulk: ['porpoise'], mackinaw: ['porpoise'],
    porpoise: ['orca'], orca: ['rorqual'],
  }
  return m[tier] ?? []
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const W = 960; const H = 720
const TAU = Math.PI * 2
const FRICTION = 0.985; const BULLET_SPEED = 9; const BULLET_LIFE = 55
const ROCK_SIZES = [38,22,12]
const ROCK_SCORE = [20,50,100]; const ENHANCED_SCORE = 150
const ROCK_HEALTH   = [600,Math.round(600*22/38),Math.round(600*12/38)]
const ICE_HEALTH    = [400,Math.round(400*22/38),Math.round(400*12/38)]
const GAS_HEALTH = 900; const MOON_HEALTH = 3600
const FACTION_HEALTH_MULT = 3.5
const INITIAL_ROCKS = 5; const QUIP_COOLDOWN = 360
const GAS_CONE_HALF = 0.38; const GAS_CONE_LEN = 220
const DRONE_ORBIT_R = 44; const DRONE_BULLET_SPEED = 7; const DRONE_FIRE_CD = 28

const ORE_NAMES  = ['Veldspar','Scordite','Pyroxeres','Plagioclase','Omber','Kernite','Jaspet','Hemorphite']
const ORE_COLORS = ['#8899aa','#cc8844','#668844','#6688cc','#886688','#44aaaa','#cc6644','#aaaacc']
const ICE_NAMES  = ['Glacial Mass','Smooth Glacial Mass','Brilliant Glacial Mass','White Glaze','Pristine White Glaze','Clear Icicle','Thick Blue Ice']
const ICE_COLORS = ['#aaddff','#ddeeff','#88ccff','#eeeeff','#ccddff','#bbffff','#99ccdd']
const GAS_NAMES  = ['Fullerite-C28','Fullerite-C32','Fullerite-C50','Fullerite-C60','Fullerite-C70','Mykoserocin','Cytoserocin']
const GAS_COLORS = ['#88ee44','#aaff66','#66dd33','#99ff44','#bbff88','#eeff99','#ddff44']

const POWERUP_COLORS: Record<PowerUpType,string> = {
  life:'#44ff88', tripleshot:'#4488ff', bomb:'#ff4444', rapidfire:'#ffcc44', shield:'#44ddff'
}
const POWERUP_ICONS: Record<PowerUpType,string> = {
  life:'+', tripleshot:'⋮', bomb:'✦', rapidfire:'»', shield:'◎'
}
const POWERUP_LABELS: Record<PowerUpType,string> = {
  life:'+1 LIFE', tripleshot:'TRIPLE SHOT', bomb:'BOMB MODE', rapidfire:'RAPID FIRE', shield:'SHIELD'
}

const COMBAT_QUIPS = ['Target resolved.','Lock. Fire. Done.','Veldspar poses no threat.',
  'Range optimal.','Fragment recovered.','I do enjoy this.','Field thinning nicely.',
  'Trajectory confirmed.','Another for the ledger.']
const MINING_QUIPS = ['Yield confirmed.','Ore secured.','Adding to the hold.',
  'Efficient extraction.','This pays better than ratting.','Cycle complete.',
  'The market will appreciate this.','Venture earns its keep.']
const MOON_QUIPS   = ['Planetary body. Impressive.','Surface integrity compromised.',
  'Moon ore. Exceptional yield.','The crust is yielding.','Long cycle. Worth it.']
const ICE_QUIPS    = ['Ice field confirmed.','Cold work.','Compressed ice — worth the effort.',
  'Crystal clear yield.','Blue ice. Premium grade.']
const GAS_QUIPS    = ['Hazardous atmosphere. Proceeding.','Huffing in progress.',
  'The Fullerites are plentiful.','Cloud thinning nicely.','Vent sealed. Yield secured.']
const DRONE_QUIPS  = ['Rogue drones. Manageable.','They are fast. I am faster.',
  'Swarm neutralized.','Drone fire ineffective.']
const FACTION_QUIPS= ['Faction ships. Overconfident.','Significant yield on these wrecks.',
  'Capital kill. Efficient.','Their insurance must be expensive.']
const SLEEPER_QUIPS= ['Ancient technology. Predictable.','Sleeper cache breached.',
  'W-space was never a threat.','Shields down. Proceed.']
const UPGRADE_QUIPS: Partial<Record<ShipTier,string>> = {
  pioneer:'Pioneer. A step up.', procurer:'Procurer. Armored and ready.',
  retriever:'Retriever. Fast extraction suits me.', hulk:'Hulk. Maximum yield achieved.',
  mackinaw:'Mackinaw. Precision over power.', porpoise:'Porpoise. The drones are a welcome addition.',
  orca:'Orca. Now we are talking capital class.', rorqual:'Rorqual. Nothing in this field is a threat.',
}

// ── MATH HELPERS ──────────────────────────────────────────────────────────────
const randRange = (a: number, b: number) => a + Math.random() * (b - a)
const wrap = (v: number, max: number) => ((v % max) + max) % max
function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d
}
function tDelta(ax: number, ay: number, bx: number, by: number): Vec2 {
  let dx = bx-ax; let dy = by-ay
  if (Math.abs(dx) > W/2) dx -= Math.sign(dx)*W
  if (Math.abs(dy) > H/2) dy -= Math.sign(dy)*H
  return { x:dx, y:dy }
}
function polyVerts(n: number) { return Array.from({length:n}, () => 0.65 + Math.random()*0.35) }
function cloudInCone(ship: Ship, cloud: Rock): boolean {
  const dx = cloud.pos.x-ship.pos.x; const dy = cloud.pos.y-ship.pos.y
  const dist = Math.hypot(dx,dy)
  if (dist > GAS_CONE_LEN + cloud.radius) return false
  const diff = Math.abs(angleDiff(ship.angle, Math.atan2(dx,-dy)))
  return diff < GAS_CONE_HALF + Math.atan2(cloud.radius, Math.max(dist,1))
}
function activePowerUp(powerUps: ActivePowerUp[], type: Exclude<PowerUpType,'life'>) {
  return powerUps.some(p => p.type === type)
}

// ── ROCK FACTORIES ────────────────────────────────────────────────────────────
function makeRock(tier: number, pos?: Vec2, mm = false, opts?: Partial<Rock>): Rock {
  const oi = Math.floor(Math.random()*ORE_NAMES.length)
  const speed = mm ? 0 : randRange(0.4, 0.9+tier*0.4)
  const ang = Math.random()*TAU; const mh = ROCK_HEALTH[tier]
  return {
    pos: pos ?? {x:Math.random()*W, y:Math.random()*H},
    vel: {x:Math.cos(ang)*speed, y:Math.sin(ang)*speed},
    angle: Math.random()*TAU, spin: mm ? 0 : randRange(-0.02,0.02),
    radius: ROCK_SIZES[tier], tier, ore: ORE_NAMES[oi],
    verts: polyVerts(8+Math.floor(Math.random()*5)),
    health: mh, maxHealth: mh, rockType: 'rock', ...opts,
  }
}
function makeEnhancedRock(pos: Vec2): Rock {
  const types: PowerUpType[] = ['life','tripleshot','bomb','rapidfire','shield']
  const pType = types[Math.floor(Math.random()*types.length)]
  const mh = ROCK_HEALTH[1]
  return {
    pos, vel:{x:randRange(-0.4,0.4), y:randRange(-0.4,0.4)},
    angle: Math.random()*TAU, spin: randRange(-0.015,0.015),
    radius: ROCK_SIZES[1]+4, tier:1, ore:'Enhanced Ore',
    verts: polyVerts(12), health:mh, maxHealth:mh, rockType:'rock', powerUpType: pType,
  }
}
function makeIceRock(tier: number, pos?: Vec2): Rock {
  const oi = Math.floor(Math.random()*ICE_NAMES.length); const mh = ICE_HEALTH[tier]
  const speed = randRange(0.05,0.15); const ang = Math.random()*TAU
  return {
    pos: pos ?? {x:randRange(80,W-80), y:randRange(80,H-80)},
    vel:{x:Math.cos(ang)*speed, y:Math.sin(ang)*speed},
    angle:Math.random()*TAU, spin:randRange(-0.005,0.005),
    radius:ROCK_SIZES[tier], tier, ore:ICE_NAMES[oi],
    verts:polyVerts(10+Math.floor(Math.random()*6)),
    health:mh, maxHealth:mh, rockType:'ice',
  }
}
function makeGasCloud(cx: number, cy: number): Rock {
  let pos: Vec2; do { pos={x:randRange(100,W-100),y:randRange(100,H-100)} } while(Math.hypot(pos.x-cx,pos.y-cy)<160)
  const oi = Math.floor(Math.random()*GAS_NAMES.length)
  const ang = Math.random()*TAU; const speed = randRange(0.08,0.2)
  return {
    pos, vel:{x:Math.cos(ang)*speed, y:Math.sin(ang)*speed},
    angle:0, spin:0, radius:randRange(65,105), tier:0, ore:GAS_NAMES[oi],
    verts:[], health:GAS_HEALTH, maxHealth:GAS_HEALTH, rockType:'gas',
  }
}
function makeMoon(): Rock {
  return {
    pos:{x:W/2,y:-280}, vel:{x:0,y:0}, angle:0, spin:0, radius:380, tier:0,
    ore:'Lunar Regolith', verts:[], health:MOON_HEALTH, maxHealth:MOON_HEALTH, rockType:'moon',
  }
}

// ── WAVE GENERATION ───────────────────────────────────────────────────────────
function waveTypeFor(wave: number, mm: boolean): WaveType {
  if (wave % 5 !== 0) return 'normal'
  if (mm) return (['moon','ice','gas'] as WaveType[])[(Math.floor(wave/5)-1)%3]
  return (['drones','faction','sleeper'] as WaveType[])[(Math.floor(wave/5)-1)%3]
}

function buildWave(wave: number, wt: WaveType, mm: boolean): Rock[] {
  const cx = W/2; const cy = H/2
  const safePos = (): Vec2 => {
    let p: Vec2; do { p={x:Math.random()*W, y:Math.random()*H} } while(Math.hypot(p.x-cx,p.y-cy)<160); return p
  }

  if (wt === 'moon') return [makeMoon()]
  if (wt === 'ice') return Array.from({length:6+Math.floor(wave/10)}, () => makeIceRock(0, safePos()))
  if (wt === 'gas') return Array.from({length:4+Math.floor(wave/10)}, () => makeGasCloud(cx,cy))

  if (wt === 'drones') {
    // Hostile drones spawning from screen edges, swarming toward ship
    const count = 35 + Math.floor(wave / 5) * 5
    return Array.from({length:count}, (_,i) => {
      const side = i % 4
      const p: Vec2 = side===0 ? {x:Math.random()*W, y:-10}
        : side===1 ? {x:W+10, y:Math.random()*H}
        : side===2 ? {x:Math.random()*W, y:H+10}
        : {x:-10, y:Math.random()*H}
      const mh = 80
      return makeRock(2, p, false, {
        vel:{x:0,y:0}, ore:'Rogue Drone', spin:0,
        radius:9, health:mh, maxHealth:mh, isDrone:true, verts:[],
      })
    })
  }
  if (wt === 'faction') {
    // Faction battleships — large, tough, drawn as proper warships
    const count = 2 + Math.floor(wave / 10)
    return Array.from({length:count}, () => {
      const p = safePos()
      const mh = 2500 + wave * 50
      const speed = randRange(0.2, 0.5); const ang = Math.random()*TAU
      return makeRock(0, p, false, {
        vel:{x:Math.cos(ang)*speed, y:Math.sin(ang)*speed},
        radius:52, health:mh, maxHealth:mh, ore:'Faction Battleship',
        faction:true, isBattleship:true, verts:[], spin:0.003,
      })
    })
  }
  if (wt === 'sleeper') {
    // Mix of normal and shielded rocks, initially hidden
    return Array.from({length:8}, () =>
      makeRock(1, safePos(), false, { revealed:false, shields: Math.random()<0.5 ? 1 : 0, ore:'Sleeper Cache' })
    )
  }

  // Normal wave
  const count = INITIAL_ROCKS + wave - 1
  const rocks: Rock[] = Array.from({length:count}, () => makeRock(0, safePos(), mm))
  // Enhanced rocks: base 45%, +5% per wave, capped at 85%, up to 1+floor(wave/6) rocks
  if (!mm) {
    const chance = Math.min(0.85, 0.45 + (wave - 1) * 0.05)
    const maxEnhanced = Math.min(3, 1 + Math.floor((wave - 1) / 6))
    const indices = [...Array(rocks.length).keys()].sort(() => Math.random() - 0.5)
    let placed = 0
    for (const idx of indices) {
      if (placed >= maxEnhanced) break
      if (Math.random() < chance) { rocks[idx] = makeEnhancedRock(rocks[idx].pos); placed++ }
    }
  }
  return rocks
}

// ── AURORA AUTOPILOT ──────────────────────────────────────────────────────────
interface AI { rotateLeft:boolean; rotateRight:boolean; thrust:boolean; shoot:boolean }
function auroraAI(ship: Ship, rocks: Rock[], mm: boolean, wt: WaveType, gunType: GunType = 'single'): AI {
  const none: AI = {rotateLeft:false,rotateRight:false,thrust:false,shoot:false}
  if (rocks.length === 0) return none
  let nearest = rocks[0]; let nd = Infinity
  for (const r of rocks) {
    if (wt==='sleeper' && !r.revealed) continue
    const d = tDelta(ship.pos.x,ship.pos.y,r.pos.x,r.pos.y)
    const dist = Math.hypot(d.x,d.y); if(dist<nd){nd=dist;nearest=r}
  }

  if (wt==='moon') {
    const dx=ship.pos.x-nearest.pos.x; const dy=ship.pos.y-nearest.pos.y
    const dist=Math.hypot(dx,dy)
    const sx=nearest.pos.x+dx/dist*nearest.radius; const sy=nearest.pos.y+dy/dist*nearest.radius
    const sdx=sx-ship.pos.x; const sdy=sy-ship.pos.y
    const desired=Math.atan2(sdx,-sdy); const diff=angleDiff(ship.angle,desired)
    return {rotateLeft:diff<-0.03,rotateRight:diff>0.03,thrust:Math.hypot(sdx,sdy)>70&&Math.abs(diff)<0.8,shoot:false}
  }
  if (wt==='gas') {
    const d=tDelta(ship.pos.x,ship.pos.y,nearest.pos.x,nearest.pos.y)
    const desired=Math.atan2(d.x,-d.y); const diff=angleDiff(ship.angle,desired)
    return {rotateLeft:diff<-0.03,rotateRight:diff>0.03,thrust:nd>90&&Math.abs(diff)<0.7,shoot:false}
  }
  if (mm) {
    const d=tDelta(ship.pos.x,ship.pos.y,nearest.pos.x,nearest.pos.y)
    const desired=Math.atan2(d.x,-d.y); const diff=angleDiff(ship.angle,desired)
    return {rotateLeft:diff<-0.03,rotateRight:diff>0.03,thrust:nd>nearest.radius+ship.radius+30&&Math.abs(diff)<0.7,shoot:false}
  }
  // Combat: lead target
  const d=tDelta(ship.pos.x,ship.pos.y,nearest.pos.x,nearest.pos.y)
  const frames=nd/BULLET_SPEED
  const px=d.x+nearest.vel.x*frames; const py=d.y+nearest.vel.y*frames
  const desired=Math.atan2(px,-py); const diff=angleDiff(ship.angle,desired)
  // Aim tolerance varies by gun type — loose for wide/homing, tight for sniper/siege
  const aimTol = gunType==='spread'||gunType==='barrage' ? 0.45
    : gunType==='guided' ? 0.55
    : gunType==='sniper'||gunType==='siege' ? 0.05
    : gunType==='cannon' ? 0.08
    : 0.14
  return {rotateLeft:diff<-0.02,rotateRight:diff>0.02,thrust:nd>nearest.radius+ship.radius+50&&Math.abs(diff)<0.6,shoot:Math.abs(diff)<aimTol}
}

// ── FIRE BULLETS ──────────────────────────────────────────────────────────────
function fireBullets(ship: Ship, gunType: GunType, isBombActive: boolean): Bullet[] {
  const fwd = { x:Math.sin(ship.angle), y:-Math.cos(ship.angle) }
  const perp= { x:Math.cos(ship.angle), y: Math.sin(ship.angle) }
  const bow = { x:ship.pos.x+fwd.x*16, y:ship.pos.y+fwd.y*16 }
  const mk = (pos: Vec2, vel: Vec2, opts?: Partial<Bullet>): Bullet => ({
    pos:{...pos}, vel, life:BULLET_LIFE,
    isBomb:isBombActive, bRadius:isBombActive?10:3, ...opts,
  })
  const ang = ship.angle
  switch (gunType) {
    case 'single':
      return [mk(bow, {x:fwd.x*BULLET_SPEED+ship.vel.x*0.3, y:fwd.y*BULLET_SPEED+ship.vel.y*0.3})]
    case 'twin': {
      const off = 9
      return [-1,1].map(s => mk(
        {x:ship.pos.x+perp.x*off*s, y:ship.pos.y+perp.y*off*s},
        {x:fwd.x*BULLET_SPEED+ship.vel.x*0.3, y:fwd.y*BULLET_SPEED+ship.vel.y*0.3}
      ))
    }
    case 'cannon':
      return [mk(bow, {x:fwd.x*4+ship.vel.x*0.2, y:fwd.y*4+ship.vel.y*0.2},
        {bRadius:14, damage:450, life:100, isBomb:false})]
    case 'burst':
      return [-0.07,0,0.07].map(sp => {
        const a=ang+sp
        return mk(bow, {x:Math.sin(a)*BULLET_SPEED+ship.vel.x*0.3, y:-Math.cos(a)*BULLET_SPEED+ship.vel.y*0.3})
      })
    case 'spread':
      return [-0.62,-0.31,0,0.31,0.62].map(sp => {
        const a=ang+sp
        return mk(bow, {x:Math.sin(a)*BULLET_SPEED, y:-Math.cos(a)*BULLET_SPEED})
      })
    case 'sniper':
      return [mk(bow, {x:fwd.x*22+ship.vel.x*0.1, y:fwd.y*22+ship.vel.y*0.1},
        {bRadius:2, damage:350, life:160, isBomb:false})]
    case 'guided':
      return [-0.18,0.18].map(sp => {
        const a=ang+sp
        return mk(bow, {x:Math.sin(a)*BULLET_SPEED, y:-Math.cos(a)*BULLET_SPEED}, {homing:true})
      })
    case 'siege':
      return [mk(bow, {x:fwd.x*3+ship.vel.x*0.1, y:fwd.y*3+ship.vel.y*0.1},
        {bRadius:22, damage:1000, life:220, isBomb:false})]
    case 'barrage':
      return [-0.45,-0.15,0.15,0.45].map(sp => {
        const a=ang+sp
        return mk(bow, {x:Math.sin(a)*BULLET_SPEED, y:-Math.cos(a)*BULLET_SPEED})
      })
  }
}

// ── DRAWING HELPERS ───────────────────────────────────────────────────────────
function setGlow(ctx: CanvasRenderingContext2D, color: string, blur: number) {
  ctx.strokeStyle=color; ctx.shadowColor=color; ctx.shadowBlur=blur
}

// Ship shape functions — all drawn in ship-local space (0,0=center, -y=forward)
function shapeVenture(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'20'; ctx.strokeStyle=c; ctx.lineWidth=1.5
  ctx.beginPath()
  ctx.moveTo(0,-14*s); ctx.lineTo(10*s,10*s); ctx.lineTo(5*s,7*s)
  ctx.lineTo(0,12*s); ctx.lineTo(-5*s,7*s); ctx.lineTo(-10*s,10*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  for(const sx of [-1,1]){
    ctx.beginPath()
    ctx.moveTo(sx*6*s,-2*s); ctx.lineTo(sx*16*s,-8*s); ctx.lineTo(sx*18*s,-3*s); ctx.lineTo(sx*8*s,2*s)
    ctx.closePath(); ctx.fill(); ctx.stroke()
  }
}
function shapePioneer(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'20'; ctx.strokeStyle=c; ctx.lineWidth=1.5
  ctx.beginPath()
  ctx.moveTo(0,-16*s); ctx.lineTo(11*s,8*s); ctx.lineTo(6*s,6*s)
  ctx.lineTo(0,13*s); ctx.lineTo(-6*s,6*s); ctx.lineTo(-11*s,8*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  for(const sx of [-1,1]){
    ctx.beginPath()
    ctx.moveTo(sx*6*s,-4*s); ctx.lineTo(sx*20*s,-10*s); ctx.lineTo(sx*22*s,-2*s); ctx.lineTo(sx*8*s,3*s)
    ctx.closePath(); ctx.fill(); ctx.stroke()
  }
  // Center boom
  ctx.beginPath(); ctx.moveTo(-3*s,-14*s); ctx.lineTo(3*s,-14*s); ctx.lineTo(2*s,-22*s); ctx.lineTo(-2*s,-22*s); ctx.closePath(); ctx.fill(); ctx.stroke()
}
function shapeProcurer(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'18'; ctx.strokeStyle=c; ctx.lineWidth=1.5
  // Wide boxy body
  ctx.beginPath()
  ctx.moveTo(-12*s,-14*s); ctx.lineTo(12*s,-14*s); ctx.lineTo(16*s,8*s); ctx.lineTo(8*s,14*s)
  ctx.lineTo(0,18*s); ctx.lineTo(-8*s,14*s); ctx.lineTo(-16*s,8*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Bridge
  ctx.beginPath(); ctx.rect(-5*s,-20*s,10*s,8*s); ctx.fill(); ctx.stroke()
  // Mining strips left/right
  for(const sx of [-1,1]){
    ctx.beginPath()
    ctx.moveTo(sx*16*s,-10*s); ctx.lineTo(sx*28*s,-12*s); ctx.lineTo(sx*28*s,2*s); ctx.lineTo(sx*16*s,4*s)
    ctx.closePath(); ctx.fill(); ctx.stroke()
  }
}
function shapeRetriever(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'18'; ctx.strokeStyle=c; ctx.lineWidth=1.5
  // Sleek elongated body
  ctx.beginPath()
  ctx.moveTo(0,-18*s); ctx.lineTo(8*s,-10*s); ctx.lineTo(10*s,4*s)
  ctx.lineTo(8*s,14*s); ctx.lineTo(-8*s,14*s); ctx.lineTo(-10*s,4*s); ctx.lineTo(-8*s,-10*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Large ore bay
  ctx.beginPath()
  ctx.moveTo(-14*s,6*s); ctx.lineTo(14*s,6*s); ctx.lineTo(18*s,20*s); ctx.lineTo(-18*s,20*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Slim forward booms
  for(const sx of [-1,1]){
    ctx.beginPath(); ctx.moveTo(sx*8*s,-12*s); ctx.lineTo(sx*20*s,-18*s); ctx.lineTo(sx*20*s,-8*s); ctx.lineTo(sx*9*s,-6*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  }
}
function shapeHulk(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'18'; ctx.strokeStyle=c; ctx.lineWidth=2
  // Wide aggressive body
  ctx.beginPath()
  ctx.moveTo(0,-18*s); ctx.lineTo(14*s,-10*s); ctx.lineTo(20*s,0); ctx.lineTo(18*s,12*s)
  ctx.lineTo(0,18*s); ctx.lineTo(-18*s,12*s); ctx.lineTo(-20*s,0); ctx.lineTo(-14*s,-10*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Bridge/command
  ctx.beginPath(); ctx.rect(-6*s,-24*s,12*s,9*s); ctx.fill(); ctx.stroke()
  // Mining arrays (3 on each side)
  for(const sx of [-1,1]){
    ctx.beginPath(); ctx.moveTo(sx*20*s,-8*s); ctx.lineTo(sx*32*s,-14*s); ctx.lineTo(sx*34*s,2*s); ctx.lineTo(sx*20*s,6*s); ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(sx*18*s,4*s); ctx.lineTo(sx*30*s,2*s); ctx.lineTo(sx*30*s,14*s); ctx.lineTo(sx*18*s,14*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  }
}
function shapeMackinaw(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'18'; ctx.strokeStyle=c; ctx.lineWidth=1.5
  // Like retriever but wider
  ctx.beginPath()
  ctx.moveTo(0,-18*s); ctx.lineTo(10*s,-8*s); ctx.lineTo(12*s,6*s)
  ctx.lineTo(10*s,14*s); ctx.lineTo(-10*s,14*s); ctx.lineTo(-12*s,6*s); ctx.lineTo(-10*s,-8*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Enhanced ore bays
  for(const ox of [-1,1]){
    ctx.beginPath(); ctx.rect(ox*13*s,2*s,10*s,16*s); ctx.fill(); ctx.stroke()
  }
  // Wing tips
  for(const sx of [-1,1]){
    ctx.beginPath(); ctx.moveTo(sx*12*s,-6*s); ctx.lineTo(sx*24*s,-14*s); ctx.lineTo(sx*26*s,0); ctx.lineTo(sx*12*s,2*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  }
}
function shapePorpoise(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'18'; ctx.strokeStyle=c; ctx.lineWidth=1.5
  // Oval command ship
  ctx.beginPath(); ctx.ellipse(0,0,12*s,18*s,0,0,TAU); ctx.fill(); ctx.stroke()
  // Command bridge
  ctx.beginPath(); ctx.ellipse(0,-12*s,5*s,6*s,0,0,TAU); ctx.fill(); ctx.stroke()
  // Small wings
  for(const sx of [-1,1]){
    ctx.beginPath(); ctx.moveTo(sx*12*s,-4*s); ctx.lineTo(sx*22*s,-8*s); ctx.lineTo(sx*20*s,4*s); ctx.lineTo(sx*12*s,4*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  }
  // Drone bays
  for(const ox of [-1,1]){
    ctx.beginPath(); ctx.rect(ox*6*s,8*s,5*s,8*s); ctx.fill(); ctx.stroke()
  }
}
function shapeOrca(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'18'; ctx.strokeStyle=c; ctx.lineWidth=2
  // Large carrier body
  ctx.beginPath()
  ctx.moveTo(0,-22*s); ctx.lineTo(16*s,-14*s); ctx.lineTo(24*s,-4*s); ctx.lineTo(24*s,8*s)
  ctx.lineTo(16*s,18*s); ctx.lineTo(-16*s,18*s); ctx.lineTo(-24*s,8*s); ctx.lineTo(-24*s,-4*s); ctx.lineTo(-16*s,-14*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Bridge
  ctx.beginPath(); ctx.ellipse(0,-20*s,7*s,8*s,0,0,TAU); ctx.fill(); ctx.stroke()
  // Drone bay pods
  for(const sx of [-1,1]){
    ctx.beginPath(); ctx.ellipse(sx*20*s,4*s,8*s,12*s,0,0,TAU); ctx.fill(); ctx.stroke()
    // Bay opening
    ctx.beginPath(); ctx.arc(sx*20*s,10*s,4*s,0,TAU); ctx.fillStyle=c+'08'; ctx.fill(); ctx.strokeStyle=c; ctx.stroke()
  }
}
function shapeRorqual(ctx: CanvasRenderingContext2D, c: string, s: number) {
  ctx.fillStyle=c+'18'; ctx.strokeStyle=c; ctx.lineWidth=2
  // Massive capital body
  ctx.beginPath()
  ctx.moveTo(0,-28*s); ctx.lineTo(18*s,-18*s); ctx.lineTo(28*s,-6*s); ctx.lineTo(30*s,8*s)
  ctx.lineTo(24*s,20*s); ctx.lineTo(-24*s,20*s); ctx.lineTo(-30*s,8*s); ctx.lineTo(-28*s,-6*s); ctx.lineTo(-18*s,-18*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Command tower
  ctx.beginPath(); ctx.moveTo(-8*s,-26*s); ctx.lineTo(8*s,-26*s); ctx.lineTo(8*s,-36*s); ctx.lineTo(-8*s,-36*s); ctx.closePath(); ctx.fill(); ctx.stroke()
  // Engine clusters
  for(const sx of [-1,1]){
    ctx.beginPath(); ctx.ellipse(sx*22*s,16*s,8*s,6*s,0,0,TAU); ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.ellipse(sx*14*s,22*s,5*s,4*s,0,0,TAU); ctx.fill(); ctx.stroke()
  }
  // Capital drone bay
  ctx.beginPath(); ctx.rect(-14*s,4*s,28*s,10*s); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.rect(-8*s,6*s,16*s,6*s); ctx.fillStyle=c+'06'; ctx.fill(); ctx.strokeStyle=c; ctx.stroke()
}

const SHAPE_FN: Record<ShipTier, (ctx: CanvasRenderingContext2D, c: string, s: number) => void> = {
  venture: shapeVenture, pioneer: shapePioneer,
  procurer: shapeProcurer, retriever: shapeRetriever,
  hulk: shapeHulk, mackinaw: shapeMackinaw,
  porpoise: shapePorpoise, orca: shapeOrca, rorqual: shapeRorqual,
}

function drawShip(ctx: CanvasRenderingContext2D, ship: Ship, thrustOn: boolean, am: boolean, mm: boolean, tier: ShipTier, frame: number) {
  ctx.save(); ctx.translate(ship.pos.x, ship.pos.y); ctx.rotate(ship.angle)
  if (ship.invincible > 0 && Math.floor(ship.invincible/4)%2===0) { ctx.restore(); return }
  const stats = SHIP_STATS[tier]
  const baseColor = am ? '#cc88ff' : mm ? '#44ddaa' : stats.color
  ctx.shadowColor = baseColor; ctx.shadowBlur = am ? 12 : 8
  SHAPE_FN[tier](ctx, baseColor, 1)
  if (thrustOn) {
    const tc = am ? '#dd66ff' : '#ff8800'
    ctx.shadowColor=tc; ctx.shadowBlur=14; ctx.strokeStyle=tc; ctx.lineWidth=2
    // Multiple nozzles for larger ships
    const multi = stats.gunType==='spread'||stats.gunType==='barrage'||stats.gunType==='burst'
    const twin  = stats.gunType==='twin'||stats.gunType==='guided'
    const nozzles = multi ? [[-5,0],[5,0],[0,-3]] : twin ? [[-4,0],[4,0]] : [[0,0]]
    const s = stats.radius/14
    for(const [ox,oy] of nozzles){
      ctx.beginPath(); ctx.moveTo(ox*s, stats.radius+oy*s); ctx.lineTo(ox*s, stats.radius+(12+Math.random()*8)*s); ctx.stroke()
    }
  }
  ctx.restore()
}

function drawDrone(ctx: CanvasRenderingContext2D, pos: Vec2, facing: number, color: string, frame: number) {
  ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(facing)
  ctx.shadowColor=color; ctx.shadowBlur=6
  shapeVenture(ctx, color, 0.42)
  ctx.restore()
}

function drawDrones(ctx: CanvasRenderingContext2D, ship: Ship, drones: DroneState[], color: string, frame: number) {
  for (const d of drones) {
    const pos = { x: ship.pos.x + Math.cos(d.orbitAngle)*DRONE_ORBIT_R, y: ship.pos.y + Math.sin(d.orbitAngle)*DRONE_ORBIT_R }
    drawDrone(ctx, pos, d.facingAngle, color, frame)
  }
}

function drawRock(ctx: CanvasRenderingContext2D, rock: Rock, isTarget: boolean, mm: boolean, frame: number) {
  if (rock.rockType==='gas' || rock.rockType==='moon') return
  if (rock.revealed===false) return // sleeper cache — hidden
  const oi = rock.rockType==='ice' ? ICE_NAMES.indexOf(rock.ore) : ORE_NAMES.indexOf(rock.ore)
  const colors = rock.rockType==='ice' ? ICE_COLORS : ORE_COLORS
  let color = colors[oi] ?? '#aaa'

  // Enhanced rock override
  if (rock.powerUpType) color = POWERUP_COLORS[rock.powerUpType]

  // Faction rock override
  if (rock.faction) color = '#ffdd44'

  // Enhanced rock outer glow — drawn in world space before local transform
  if (rock.powerUpType) {
    const color = POWERUP_COLORS[rock.powerUpType]
    const t = frame * 0.05
    // Two pulsing rings expanding outward
    for (let i = 0; i < 2; i++) {
      const phase = (t + i * 0.5) % 1
      const ringR = rock.radius + 6 + phase * 22
      const alpha = (1 - phase) * 0.55
      ctx.beginPath(); ctx.arc(rock.pos.x, rock.pos.y, ringR, 0, TAU)
      ctx.strokeStyle = color; ctx.lineWidth = 2.5 - phase * 2
      ctx.shadowColor = color; ctx.shadowBlur = 16
      ctx.globalAlpha = alpha; ctx.stroke(); ctx.globalAlpha = 1
    }
    ctx.shadowBlur = 0
  }

  ctx.save(); ctx.translate(rock.pos.x, rock.pos.y); ctx.rotate(rock.angle)

  // Shield ring (sleeper)
  if (rock.shields && rock.shields > 0) {
    ctx.beginPath(); ctx.arc(0,0,rock.radius+8,0,TAU)
    ctx.strokeStyle='rgba(100,200,255,0.6)'; ctx.lineWidth=3; ctx.shadowColor='#88ddff'; ctx.shadowBlur=10; ctx.stroke()
  }

  const sides = rock.verts.length
  ctx.beginPath()
  for(let i=0;i<sides;i++){
    const a=(i/sides)*TAU-Math.PI/2; const r=rock.radius*rock.verts[i]
    i===0 ? ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r) : ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r)
  }
  ctx.closePath()
  ctx.strokeStyle=color; ctx.lineWidth=rock.powerUpType||rock.faction ? 2 : 1.5
  ctx.shadowColor=color; ctx.shadowBlur=rock.powerUpType ? 22 : rock.faction ? 10 : 4
  ctx.fillStyle=rock.rockType==='ice' ? 'rgba(180,220,255,0.12)' : rock.faction ? 'rgba(220,180,0,0.1)' : 'rgba(60,60,80,0.4)'
  ctx.fill(); ctx.stroke()

  // Enhanced rock icon
  if (rock.powerUpType) {
    const pulse = 0.7+0.3*Math.sin(frame*0.1)
    ctx.globalAlpha=pulse; ctx.fillStyle=color; ctx.font=`bold ${Math.round(rock.radius*0.9)}px monospace`
    ctx.textAlign='center'; ctx.textBaseline='middle'
    ctx.fillText(POWERUP_ICONS[rock.powerUpType], 0, 0)
    ctx.globalAlpha=1
  }
  // Ice sparkle
  if (rock.rockType==='ice') {
    const sp=Math.sin(frame*0.08+rock.angle*3)*0.5+0.5
    ctx.beginPath(); ctx.arc(0,0,rock.radius*0.3,0,TAU)
    ctx.strokeStyle=`rgba(200,240,255,${sp*0.4})`; ctx.lineWidth=1; ctx.stroke()
  }
  ctx.restore()

  // Health bar when mined
  if (mm && isTarget && rock.health < rock.maxHealth) {
    const bw=rock.radius*2; const bh=5; const bx=rock.pos.x-bw/2; const by=rock.pos.y+rock.radius+8
    ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(bx,by,bw,bh)
    const pct=rock.health/rock.maxHealth
    const bc=rock.rockType==='ice'?'#88ccff':pct>0.5?'#44ddaa':pct>0.25?'#ffcc44':'#ff6644'
    ctx.fillStyle=bc; ctx.shadowColor=bc; ctx.shadowBlur=4; ctx.fillRect(bx,by,bw*pct,bh)
    ctx.shadowBlur=0; ctx.fillStyle=color; ctx.font='9px monospace'; ctx.textAlign='center'
    ctx.fillText(rock.ore, rock.pos.x, by+bh+10)
  }
}

function drawGasCloud(ctx: CanvasRenderingContext2D, cloud: Rock, isTarget: boolean, mm: boolean, frame: number) {
  const oi=GAS_NAMES.indexOf(cloud.ore); const color=GAS_COLORS[oi]??'#88ff44'
  const pulse=0.5+0.5*Math.sin(frame*0.04+cloud.pos.x*0.01); const r=cloud.radius
  ctx.save(); ctx.translate(cloud.pos.x,cloud.pos.y)
  // Parse hex to rgba for gradient
  const hexParts = color.match(/[0-9a-f]{2}/gi)?.map(h=>parseInt(h,16)) ?? [136,238,68]
  const [cr,cg,cb] = hexParts
  const g=ctx.createRadialGradient(0,0,r*0.1,0,0,r)
  g.addColorStop(0,`rgba(${cr},${cg},${cb},${(0.18+pulse*0.08).toFixed(2)})`)
  g.addColorStop(1,'rgba(0,0,0,0)')
  ctx.beginPath(); ctx.arc(0,0,r,0,TAU); ctx.fillStyle=g; ctx.fill()
  for(let i=0;i<3;i++){
    const ir=r*(0.3+i*0.22); const a=(frame*0.015+i*1.2)%TAU
    ctx.beginPath(); ctx.arc(Math.cos(a)*ir*0.2,Math.sin(a)*ir*0.2,ir,0,TAU)
    ctx.strokeStyle=`rgba(${cr},${cg},${cb},${(0.06+pulse*0.04).toFixed(2)})`; ctx.lineWidth=1; ctx.stroke()
  }
  ctx.restore()
  if (mm&&isTarget&&cloud.health<cloud.maxHealth) {
    const bw=cloud.radius*2; const bh=5; const bx=cloud.pos.x-bw/2; const by=cloud.pos.y+cloud.radius+8
    ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(bx,by,bw,bh)
    const pct=cloud.health/cloud.maxHealth; const bc=pct>0.5?'#88ff44':pct>0.25?'#ffcc44':'#ff6644'
    ctx.fillStyle=bc; ctx.shadowColor=bc; ctx.shadowBlur=4; ctx.fillRect(bx,by,bw*pct,bh)
    ctx.shadowBlur=0; ctx.fillStyle=color; ctx.font='9px monospace'; ctx.textAlign='center'
    ctx.fillText(cloud.ore,cloud.pos.x,by+bh+10)
  }
}

function drawMoon(ctx: CanvasRenderingContext2D, moon: Rock, frame: number) {
  const {x,y}=moon.pos; const r=moon.radius
  ctx.save()
  ctx.beginPath(); ctx.arc(x,y,r,0,TAU)
  const g=ctx.createRadialGradient(x-r*0.25,y+r*0.1,r*0.05,x,y,r)
  g.addColorStop(0,'#a0a890'); g.addColorStop(0.7,'#707868'); g.addColorStop(1,'#404840')
  ctx.fillStyle=g; ctx.fill()
  ctx.strokeStyle='#889988'; ctx.lineWidth=2; ctx.shadowColor='#aabbaa'; ctx.shadowBlur=16; ctx.stroke()
  for(const [cx_,cy_,cr] of [[0.3,-0.15,0.08],[-0.2,0.25,0.06],[0.1,0.35,0.05],[-0.35,0.05,0.07],[0.25,0.2,0.04],[-0.1,-0.3,0.05]]){
    const px=x+cx_*r; const py=y+cy_*r; const pr=cr*r
    ctx.beginPath(); ctx.arc(px,py,pr,0,TAU)
    ctx.fillStyle='rgba(40,50,40,0.5)'; ctx.fill()
    ctx.strokeStyle='rgba(160,180,160,0.3)'; ctx.lineWidth=1; ctx.stroke()
  }
  const shimmer=0.03+0.01*Math.sin(frame*0.02)
  ctx.beginPath(); ctx.arc(x,y,r+8,0,TAU)
  ctx.strokeStyle=`rgba(200,220,180,${shimmer})`; ctx.lineWidth=6; ctx.stroke()
  ctx.restore()
  // Boss health bar
  const bw=W*0.6; const bh=8; const bx=(W-bw)/2; const by=14
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(bx,by,bw,bh)
  const pct=moon.health/moon.maxHealth; const bc=pct>0.5?'#aabbaa':pct>0.25?'#ffcc44':'#ff6644'
  ctx.fillStyle=bc; ctx.shadowColor=bc; ctx.shadowBlur=6; ctx.fillRect(bx,by,bw*pct,bh)
  ctx.shadowBlur=0; ctx.fillStyle='#aabb99'; ctx.font='10px monospace'; ctx.textAlign='center'
  ctx.fillText(`◉ LUNAR REGOLITH  ${Math.ceil(moon.health/60)}s remaining`, W/2, by+bh+12)
}

function drawMiningLaser(ctx: CanvasRenderingContext2D, ship: Ship, tx: number, ty: number, am: boolean, wt: WaveType, frame: number) {
  const bx=ship.pos.x+Math.sin(ship.angle)*14; const by=ship.pos.y-Math.cos(ship.angle)*14
  const pulse=0.7+0.3*Math.sin(frame*0.25)
  const [core,glow] = am
    ? [`rgba(220,140,255,${pulse})`,'rgba(180,80,255,0.35)']
    : wt==='ice'
      ? [`rgba(180,230,255,${pulse})`,'rgba(120,200,255,0.3)']
      : [`rgba(60,255,180,${pulse})`,'rgba(0,255,160,0.28)']
  ctx.save()
  ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(tx,ty); ctx.strokeStyle=glow; ctx.lineWidth=5; ctx.shadowColor=glow; ctx.shadowBlur=14; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(tx,ty); ctx.strokeStyle=core; ctx.lineWidth=1.5; ctx.shadowColor=core; ctx.shadowBlur=6; ctx.stroke()
  ctx.restore()
}

function drawDroneLaser(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, color: string, frame: number) {
  const pulse=0.5+0.5*Math.sin(frame*0.3+from.x*0.01)
  const glow=color+'55'
  ctx.save()
  ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to.x,to.y)
  ctx.strokeStyle=glow; ctx.lineWidth=3; ctx.shadowColor=glow; ctx.shadowBlur=8; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to.x,to.y)
  ctx.strokeStyle=color+`${Math.round(pulse*180).toString(16).padStart(2,'0')}`; ctx.lineWidth=1; ctx.shadowBlur=4; ctx.stroke()
  ctx.restore()
}

function drawGasCone(ctx: CanvasRenderingContext2D, ship: Ship, am: boolean, frame: number) {
  const bx=ship.pos.x+Math.sin(ship.angle)*14; const by=ship.pos.y-Math.cos(ship.angle)*14
  const cf=ship.angle-Math.PI/2; const pulse=0.12+0.06*Math.sin(frame*0.12)
  ctx.save()
  ctx.beginPath(); ctx.moveTo(bx,by); ctx.arc(bx,by,GAS_CONE_LEN,cf-GAS_CONE_HALF,cf+GAS_CONE_HALF); ctx.closePath()
  const [cr2,cg2,cb2]=am?[200,120,255]:[130,255,80]
  const g=ctx.createRadialGradient(bx,by,0,bx,by,GAS_CONE_LEN)
  g.addColorStop(0,`rgba(${cr2},${cg2},${cb2},${(pulse*3).toFixed(2)})`)
  g.addColorStop(1,`rgba(${cr2},${cg2},${cb2},0.01)`)
  ctx.fillStyle=g; ctx.fill()
  for(const side of [-1,1]){
    const ea=cf+side*GAS_CONE_HALF
    ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx+Math.cos(ea)*GAS_CONE_LEN,by+Math.sin(ea)*GAS_CONE_LEN)
    const ep=0.25+0.12*Math.sin(frame*0.09); const ec=am?`rgba(220,140,255,${ep})`:`rgba(150,255,80,${ep})`
    ctx.strokeStyle=ec; ctx.lineWidth=1.2; ctx.shadowColor=ec; ctx.shadowBlur=8; ctx.stroke()
  }
  ctx.restore()
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet, am: boolean) {
  ctx.save()
  if (b.bRadius >= 18) {
    // Siege cannon — massive glowing orb with gradient core
    const g = ctx.createRadialGradient(b.pos.x,b.pos.y,0,b.pos.x,b.pos.y,b.bRadius)
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.3,am?'#cc88ff':'#4488ff'); g.addColorStop(1,'transparent')
    ctx.beginPath(); ctx.arc(b.pos.x,b.pos.y,b.bRadius,0,TAU); ctx.fillStyle=g; ctx.fill()
    ctx.shadowColor=am?'#cc88ff':'#4488ff'; ctx.shadowBlur=28
    ctx.beginPath(); ctx.arc(b.pos.x,b.pos.y,b.bRadius,0,TAU); ctx.strokeStyle=am?'#cc88ff':'#6699ff'; ctx.lineWidth=2; ctx.stroke()
  } else if (b.bRadius >= 12) {
    // Cannon slug — fat orange slug
    const color=am?'#ff88cc':'#ff8822'
    const g=ctx.createRadialGradient(b.pos.x,b.pos.y,0,b.pos.x,b.pos.y,b.bRadius)
    g.addColorStop(0,'#ffeeaa'); g.addColorStop(0.5,color); g.addColorStop(1,'transparent')
    ctx.beginPath(); ctx.arc(b.pos.x,b.pos.y,b.bRadius,0,TAU); ctx.fillStyle=g; ctx.fill()
    ctx.shadowColor=color; ctx.shadowBlur=16
    ctx.beginPath(); ctx.arc(b.pos.x,b.pos.y,b.bRadius*0.6,0,TAU); ctx.fillStyle='rgba(255,200,100,0.6)'; ctx.fill()
  } else if (b.bRadius <= 2 && !b.homing) {
    // Sniper beam — draw as a long line
    const sp=Math.hypot(b.vel.x,b.vel.y); const nx=b.vel.x/sp; const ny=b.vel.y/sp
    const color=am?'#ffaaff':'#aaddff'
    ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.shadowColor=color; ctx.shadowBlur=12
    ctx.beginPath(); ctx.moveTo(b.pos.x-nx*18,b.pos.y-ny*18); ctx.lineTo(b.pos.x+nx*10,b.pos.y+ny*10); ctx.stroke()
  } else {
    const color=b.homing?(am?'#ff88ff':'#ff44cc'):am?'#dd88ff':'#00ffcc'
    ctx.beginPath(); ctx.arc(b.pos.x,b.pos.y,b.bRadius,0,TAU)
    ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=b.isBomb?14:b.homing?12:8; ctx.fill()
    if(b.homing){
      // Small trail arrow for guided missiles
      const sp=Math.hypot(b.vel.x,b.vel.y); const nx=b.vel.x/sp; const ny=b.vel.y/sp
      ctx.strokeStyle=color; ctx.lineWidth=1; ctx.beginPath()
      ctx.moveTo(b.pos.x-nx*8,b.pos.y-ny*8); ctx.lineTo(b.pos.x,b.pos.y); ctx.stroke()
    }
  }
  ctx.restore()
}

function drawDroneEnemy(ctx: CanvasRenderingContext2D, rock: Rock, frame: number) {
  ctx.save(); ctx.translate(rock.pos.x,rock.pos.y)
  const movAngle=Math.atan2(rock.vel.x,-rock.vel.y)
  ctx.rotate(movAngle)
  const pulse=0.8+0.2*Math.sin(frame*0.2+rock.pos.x*0.05)
  ctx.strokeStyle='#ff4444'; ctx.shadowColor='#ff4444'; ctx.shadowBlur=8*pulse; ctx.lineWidth=1.2
  ctx.fillStyle='rgba(255,60,60,0.2)'
  ctx.beginPath()
  ctx.moveTo(0,-8); ctx.lineTo(5,5); ctx.lineTo(2,3); ctx.lineTo(0,7); ctx.lineTo(-2,3); ctx.lineTo(-5,5); ctx.closePath()
  ctx.fill(); ctx.stroke()
  for(const sx of [-1,1]){
    ctx.beginPath()
    ctx.moveTo(sx*2,1); ctx.lineTo(sx*8,-2); ctx.lineTo(sx*9,2); ctx.lineTo(sx*3,3); ctx.closePath()
    ctx.fill(); ctx.stroke()
  }
  ctx.restore()
}

function drawBattleship(ctx: CanvasRenderingContext2D, rock: Rock, frame: number) {
  const r=rock.radius; const {x,y}=rock.pos
  ctx.save(); ctx.translate(x,y); ctx.rotate(rock.angle)
  const color='#ffaa22'
  ctx.strokeStyle=color; ctx.fillStyle='rgba(200,120,0,0.18)'
  ctx.shadowColor=color; ctx.shadowBlur=14; ctx.lineWidth=2
  // Hull
  ctx.beginPath()
  ctx.moveTo(0,-r*0.68); ctx.lineTo(r*0.34,-r*0.28); ctx.lineTo(r*0.46,r*0.18)
  ctx.lineTo(r*0.30,r*0.66); ctx.lineTo(-r*0.30,r*0.66); ctx.lineTo(-r*0.46,r*0.18); ctx.lineTo(-r*0.34,-r*0.28)
  ctx.closePath(); ctx.fill(); ctx.stroke()
  // Command tower
  ctx.beginPath(); ctx.rect(-r*0.13,-r*0.78,r*0.26,r*0.16); ctx.fill(); ctx.stroke()
  // Side gun wings + barrels
  for(const sx of [-1,1]){
    ctx.beginPath()
    ctx.moveTo(sx*r*0.46,-r*0.08); ctx.lineTo(sx*r*0.74,-r*0.2); ctx.lineTo(sx*r*0.74,r*0.12); ctx.lineTo(sx*r*0.46,r*0.12)
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(sx*r*0.74,-r*0.04); ctx.lineTo(sx*r*0.94,-r*0.04)
    ctx.lineWidth=1.5; ctx.stroke(); ctx.lineWidth=2
  }
  // Engine glow
  const eg=0.35+0.2*Math.sin(frame*0.06)
  ctx.beginPath(); ctx.arc(0,r*0.58,r*0.1,0,TAU); ctx.fillStyle=`rgba(255,100,0,${eg})`; ctx.shadowColor='#ff6600'; ctx.shadowBlur=10; ctx.fill()
  ctx.restore()
  // Health bar above ship
  const pct=rock.health/rock.maxHealth
  const bw=r*1.5; const bx=x-bw/2; const by=y-r-16
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(bx,by,bw,6)
  const bc=pct>0.5?'#ffdd44':pct>0.25?'#ff8822':'#ff4444'
  ctx.fillStyle=bc; ctx.shadowColor=bc; ctx.shadowBlur=5; ctx.fillRect(bx,by,bw*pct,6); ctx.shadowBlur=0
}

function drawStars(ctx: CanvasRenderingContext2D, wt: WaveType) {
  const c = wt==='ice'?'rgba(200,230,255,0.6)':wt==='gas'?'rgba(180,255,150,0.4)':'rgba(255,255,255,0.5)'
  ctx.fillStyle=c
  for(let i=0;i<110;i++){
    ctx.fillRect(((i*137+73)*31)%W, ((i*211+19)*17)%H, (i%3)*0.5+0.5, (i%3)*0.5+0.5)
  }
}

function drawAuroraHUD(ctx: CanvasRenderingContext2D, quip: string, alpha: number) {
  if (alpha<=0) return
  ctx.save(); ctx.globalAlpha=Math.min(1,alpha/60)
  ctx.font='11px monospace'; ctx.textAlign='center'
  ctx.fillStyle='#cc88ff'; ctx.shadowColor='#cc88ff'; ctx.shadowBlur=6
  ctx.fillText(`◈ "${quip}"`, W/2, H-18)
  ctx.restore()
}

function drawPowerUpHUD(ctx: CanvasRenderingContext2D, powerUps: ActivePowerUp[]) {
  if (powerUps.length===0) return
  let ox = 12
  for(const p of powerUps){
    const c = POWERUP_COLORS[p.type]; const secs = Math.ceil(p.framesLeft/60)
    ctx.save()
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(ox, H-42, 64, 26)
    ctx.strokeStyle=c; ctx.shadowColor=c; ctx.shadowBlur=6; ctx.lineWidth=1; ctx.strokeRect(ox,H-42,64,26)
    ctx.fillStyle=c; ctx.font='bold 11px monospace'; ctx.textAlign='left'
    ctx.fillText(POWERUP_ICONS[p.type]+' '+p.type.toUpperCase().slice(0,5), ox+5, H-28)
    ctx.fillStyle='#888'; ctx.font='9px monospace'; ctx.fillText(`${secs}s`, ox+5, H-18)
    ctx.restore()
    ox += 70
  }
}

function drawUpgradeScreen(ctx: CanvasRenderingContext2D, options: ShipTier[], selected: number, timer: number, am: boolean) {
  ctx.save()
  ctx.fillStyle='rgba(0,0,0,0.82)'; ctx.fillRect(0,0,W,H)
  const isSingle = options.length === 1
  const title = isSingle ? '▲ SHIP UPGRADE AVAILABLE' : '▲ CHOOSE YOUR PATH'
  ctx.fillStyle='#00ffcc'; ctx.font='bold 20px monospace'; ctx.textAlign='center'
  ctx.shadowColor='#00ffcc'; ctx.shadowBlur=12
  ctx.fillText(title, W/2, 60)
  ctx.shadowBlur=0

  for(let i=0;i<options.length;i++){
    const tier=options[i]; const stats=SHIP_STATS[tier]
    const cx = isSingle ? W/2 : i===0 ? W/3 : 2*W/3
    const cy = H/2 - 20
    const isSelected = i===selected
    const shipColor = isSelected ? stats.color : '#555'

    // Selection highlight
    if (isSelected) {
      ctx.strokeStyle=stats.color; ctx.shadowColor=stats.color; ctx.shadowBlur=20
      ctx.lineWidth=1.5; ctx.strokeRect(cx-90, cy-80, 180, 200)
      ctx.shadowBlur=0
    }

    // Ship preview (drawn scaled 2.5x in a fake translate)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.shadowColor=shipColor; ctx.shadowBlur=isSelected?14:4
    SHAPE_FN[tier](ctx, shipColor, 2.2)
    ctx.restore()

    // Labels
    ctx.fillStyle=isSelected?stats.color:'#888'
    ctx.font=`bold 16px monospace`; ctx.textAlign='center'
    ctx.fillText(stats.label, cx, cy+stats.radius*2.2+28)
    ctx.fillStyle=isSelected?'#aaa':'#555'; ctx.font='11px monospace'
    ctx.fillText(stats.desc, cx, cy+stats.radius*2.2+46)
    // Stats
    ctx.fillStyle=isSelected?'#888':'#444'; ctx.font='10px monospace'
    ctx.fillText(`LIVES ${stats.maxLives}  GUN ${stats.gunType.toUpperCase()}  DRONES ${stats.droneCount}`, cx, cy+stats.radius*2.2+62)
  }

  // Prompt
  const pct = Math.min(1, timer/60)
  const prompt = am ? `Auto-selecting in ${Math.ceil((90-timer)/60)+1}s…` : options.length>1 ? '← → TO CHOOSE · SPACE TO CONFIRM' : 'SPACE TO CONFIRM'
  ctx.fillStyle='#888'; ctx.font='12px monospace'; ctx.textAlign='center'
  ctx.fillText(prompt, W/2, H-40)

  // Auto-confirm bar (aurora only)
  if (am) {
    const bw=300; const bx=(W-bw)/2; const by=H-28
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(bx,by,bw,6)
    ctx.fillStyle='#cc88ff'; ctx.shadowColor='#cc88ff'; ctx.shadowBlur=6
    ctx.fillRect(bx,by,bw*pct,6)
    ctx.shadowBlur=0
  }
  ctx.restore()
}

// ── COMPONENT ──────────────────────────────────────────────────────────────────
// ── INFO PANE ─────────────────────────────────────────────────────────────────
function Section({ title, color = '#00ccee', children }: { title: string; color?: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div style={{ color, fontSize: 9, letterSpacing: '0.18em', borderBottom: `1px solid ${color}33`, paddingBottom: 3, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}
function Row({ label, value, color = '#aaa' }: { label: string; value?: string; color?: string }) {
  return (
    <div className="flex justify-between items-start gap-2 mb-1" style={{ fontSize: 10 }}>
      <span style={{ color: '#666', flexShrink: 0 }}>{label}</span>
      {value && <span style={{ color, textAlign: 'right' }}>{value}</span>}
    </div>
  )
}
function Tag({ color, icon, label }: { color: string; icon: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5" style={{ fontSize: 10 }}>
      <span style={{ color, fontWeight: 'bold', minWidth: 14, textAlign: 'center', textShadow: `0 0 6px ${color}` }}>{icon}</span>
      <span style={{ color: '#999' }}>{label}</span>
    </div>
  )
}

function InfoPane({ miningMode }: { miningMode: boolean }) {
  return (
    <div
      style={{
        width: 272,
        height: H,
        overflowY: 'auto',
        background: 'rgba(3,5,10,0.96)',
        border: '1px solid rgba(0,180,220,0.2)',
        boxShadow: '0 0 24px rgba(0,180,220,0.08)',
        padding: '14px 14px',
        fontFamily: 'monospace',
        scrollbarWidth: 'thin',
        scrollbarColor: '#00ccee22 transparent',
      }}
    >
      <div style={{ color: '#00ccee', fontSize: 11, letterSpacing: '0.3em', marginBottom: 14 }}>◈ PILOT MANUAL</div>

      {/* Controls */}
      <Section title="CONTROLS">
        <Row label="↑ / W" value="Thrust" />
        <Row label="← → / A D" value="Rotate" />
        <Row label="SPACE" value="Fire" />
        <Row label="⛏ Button" value="Toggle mining mode" />
        <Row label="◈ Button" value="Aurora autopilot" />
        <Row label="[?] Button" value="This pane" />
        <Row label="R" value="Restart after death" />
        <Row label="ESC" value="Close game" />
      </Section>

      {/* Modes */}
      <Section title="GAME MODES">
        <div style={{ color: '#888', fontSize: 10, lineHeight: 1.6, marginBottom: 6 }}>
          <span style={{ color: '#00ccee' }}>COMBAT</span> — Destroy rocks before they hit you. Rocks split into smaller fragments. Lives lost on collision.
        </div>
        <div style={{ color: '#888', fontSize: 10, lineHeight: 1.6 }}>
          <span style={{ color: '#44ddaa' }}>MINING ⛏</span> — Fly near rocks; a laser automatically mines the closest one. Drones mine additional rocks simultaneously. No lives lost.
        </div>
      </Section>

      {/* Ships */}
      <Section title="SHIP UPGRADES" color="#ffcc44">
        <div style={{ color: '#666', fontSize: 9, marginBottom: 8 }}>Upgrade every 5 waves. Choice at wave 10.</div>
        {(Object.entries(SHIP_STATS) as [ShipTier, ShipStats][]).map(([tier, s]) => (
          <div key={tier} style={{ marginBottom: 7, paddingBottom: 7, borderBottom: '1px solid #ffffff08' }}>
            <div className="flex justify-between items-baseline">
              <span style={{ color: s.color, fontSize: 10, fontWeight: 'bold', textShadow: `0 0 6px ${s.color}66` }}>▲ {s.label}</span>
              <span style={{ color: '#444', fontSize: 9 }}>♦×{s.maxLives}{s.droneCount > 0 ? ` · ${s.droneCount}🛸` : ''}</span>
            </div>
            <div style={{ color: '#555', fontSize: 9, marginTop: 1 }}>{s.desc}</div>
          </div>
        ))}
        <div style={{ color: '#555', fontSize: 9, marginTop: 4, lineHeight: 1.5 }}>
          Venture → Pioneer → <span style={{ color: '#ff8844' }}>Procurer</span> / <span style={{ color: '#44aaff' }}>Retriever</span> →
          {' '}<span style={{ color: '#ff6622' }}>Hulk</span> / <span style={{ color: '#22aaff' }}>Mackinaw</span> →
          {' '}<span style={{ color: '#44ffcc' }}>Porpoise</span> → <span style={{ color: '#4488ff' }}>Orca</span> → <span style={{ color: '#9966ff' }}>Rorqual</span>
        </div>
      </Section>

      {/* Enhanced rocks */}
      <Section title="ENHANCED ROCKS" color="#ffaa44">
        <div style={{ color: '#666', fontSize: 9, marginBottom: 8 }}>Glowing rocks with pulsing rings. Spawn more frequently at higher waves.</div>
        <Tag color={POWERUP_COLORS.life}       icon={POWERUP_ICONS.life}       label="+1 Life — instant restore" />
        <Tag color={POWERUP_COLORS.tripleshot} icon={POWERUP_ICONS.tripleshot} label="Triple Shot — extra spread 15s" />
        <Tag color={POWERUP_COLORS.bomb}       icon={POWERUP_ICONS.bomb}       label="Bomb Mode — large radius 15s" />
        <Tag color={POWERUP_COLORS.rapidfire}  icon={POWERUP_ICONS.rapidfire}  label="Rapid Fire — half cooldown 15s" />
        <Tag color={POWERUP_COLORS.shield}     icon={POWERUP_ICONS.shield}     label="Shield — full invincibility 8s" />
      </Section>

      {/* Special encounters */}
      <Section title="SPECIAL ENCOUNTERS" color="#aa88ff">
        <div style={{ color: '#666', fontSize: 9, marginBottom: 8 }}>Trigger every 5 waves. Mining and combat have separate rotation.</div>

        <div style={{ color: '#888', fontSize: 9, letterSpacing: '0.1em', marginBottom: 5 }}>— COMBAT —</div>
        <div style={{ marginBottom: 10 }}>
          <Tag color="#ff6666" icon="⚡" label="Rogue Drone Swarm — enemy fighters orbit and close in" />
          <div style={{ color: '#555', fontSize: 9, marginLeft: 20, marginTop: -4, marginBottom: 6 }}>Shoot them before they pile up. Spawn in large numbers, scale with waves.</div>
          <Tag color="#ffdd44" icon="⚔" label="Faction Battleships — armored capital ships" />
          <div style={{ color: '#555', fontSize: 9, marginLeft: 20, marginTop: -4, marginBottom: 6 }}>High HP with visible hull damage. More battleships at higher waves. Guaranteed power-up drops.</div>
          <Tag color="#aaaaff" icon="◈" label="Sleeper Cache — ancient Sleeper drones" />
          <div style={{ color: '#555', fontSize: 9, marginLeft: 20, marginTop: -4 }}>Invisible until within 160px. Half are shielded — requires an extra hit to pop the shield.</div>
        </div>

        <div style={{ color: '#888', fontSize: 9, letterSpacing: '0.1em', marginBottom: 5 }}>— MINING —</div>
        <div>
          <Tag color="#aabb99" icon="☽" label="Moon Mining — giant moon covers top of field" />
          <div style={{ color: '#555', fontSize: 9, marginLeft: 20, marginTop: -4, marginBottom: 6 }}>Laser fires to moon surface. Boss HP bar at top. 40-second cycle.</div>
          <Tag color="#aaddff" icon="❄" label="Ice Field — slow-drifting crystal rocks" />
          <div style={{ color: '#555', fontSize: 9, marginLeft: 20, marginTop: -4, marginBottom: 6 }}>Mine faster than normal ore. Ice rocks shatter more easily.</div>
          <Tag color="#88ff44" icon="◎" label="Gas Huffing — rotate to aim your cone" />
          <div style={{ color: '#555', fontSize: 9, marginLeft: 20, marginTop: -4 }}>Fullerite clouds drift slowly. Any cloud inside your exhaust cone gets vented simultaneously.</div>
        </div>
      </Section>

      {/* Aurora note */}
      <Section title="AURORA AUTOPILOT" color="#cc88ff">
        <div style={{ color: '#888', fontSize: 10, lineHeight: 1.6 }}>
          Toggle <span style={{ color: '#cc88ff' }}>◈ AURORA</span> to hand control to the AI. She cannot be destroyed — she is an AI after all. Her aim tolerance automatically adjusts per gun type, and she speaks via ElevenLabs when a quip fires (if voice is enabled).
        </div>
        <div style={{ color: '#555', fontSize: 9, marginTop: 6, lineHeight: 1.5 }}>
          After 5 minutes of inactivity, Aurora opens the game herself and plays silently on the idle screen.
        </div>
      </Section>
    </div>
  )
}

interface Props {
  onClose: () => void
  voiceEnabled?: boolean
  onSpeak?: (text: string) => void
  idleMode?: boolean
}

export default function VentureGame({ onClose, voiceEnabled, onSpeak, idleMode }: Props) {
  // Init idle-aware values before any effect
  const idleInitMining = useRef(idleMode ? Math.random() < 0.5 : false)
  const auroraModeRef  = useRef(!!idleMode)
  const miningModeRef  = useRef(idleInitMining.current)
  const [auroraMode, setAuroraMode] = useState(!!idleMode)
  const [miningMode, setMiningMode] = useState(idleInitMining.current)

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const stateRef     = useRef<GameState|null>(null)
  const keysRef      = useRef<Set<string>>(new Set())
  const animRef      = useRef<number>(0)
  const frameRef     = useRef(0)
  const voiceRef     = useRef(voiceEnabled && !idleMode)
  const speakRef     = useRef(onSpeak)
  useEffect(()=>{ voiceRef.current = voiceEnabled && !idleMode },[voiceEnabled, idleMode])
  useEffect(()=>{ speakRef.current = onSpeak },[onSpeak])

  const [uiScore, setUiScore]   = useState(0)
  const [uiLives, setUiLives]   = useState(3)
  const [uiPhase, setUiPhase]   = useState<GameState['phase']>('playing')
  const [uiWave, setUiWave]     = useState(1)
  const [uiWaveType, setUiWaveType] = useState<WaveType>('normal')
  const [uiTier, setUiTier]     = useState<ShipTier>('venture')
  const [showInfo, setShowInfo] = useState(false)

  const quipRef          = useRef('')
  const quipAlphaRef     = useRef(0)
  const lastQuipFrameRef = useRef(-QUIP_COOLDOWN)

  const fireQuip = (text: string) => {
    quipRef.current=text; quipAlphaRef.current=180
    lastQuipFrameRef.current=frameRef.current
    if (voiceRef.current && speakRef.current) speakRef.current(text)
  }

  const makeInitState = (mm: boolean): GameState => ({
    ship: {pos:{x:W/2,y:H/2},vel:{x:0,y:0},angle:0,radius:14,invincible:120},
    bullets: [], rocks: buildWave(1,'normal',mm),
    score:0, lives:3, wave:1, phase:'playing', respawnTimer:0, cleared:false,
    waveType:'normal', waveStartFrame:0,
    shipTier:'venture', shipBranch:null,
    upgradeOptions:[], upgradeSelected:0, upgradeTimer:0,
    powerUps:[], drones:[],
  })

  const respawnShip = (gs: GameState) => {
    gs.ship={pos:{x:W/2,y:H/2},vel:{x:0,y:0},angle:0,radius:SHIP_STATS[gs.shipTier].radius,invincible:120}
    gs.phase='playing'
  }

  const applyUpgrade = (gs: GameState, tier: ShipTier) => {
    const prev=gs.shipTier; gs.shipTier=tier
    if (tier==='procurer'||tier==='retriever') gs.shipBranch=tier
    const stats=SHIP_STATS[tier]; const prevStats=SHIP_STATS[prev]
    gs.lives=Math.min(gs.lives + (stats.maxLives-prevStats.maxLives), stats.maxLives)
    gs.ship.radius=stats.radius
    // Add drones
    const dc=stats.droneCount
    gs.drones=Array.from({length:dc},(_,i)=>({orbitAngle:(i/dc)*TAU,facingAngle:0,shootCooldown:0}))
    if (UPGRADE_QUIPS[tier]) setTimeout(()=>fireQuip(UPGRADE_QUIPS[tier]!), 500)
  }

  const advanceWave = (gs: GameState, mm: boolean) => {
    gs.wave++; gs.phase='playing'; gs.cleared=false
    const wt=waveTypeFor(gs.wave, mm); gs.waveType=wt; gs.waveStartFrame=frameRef.current
    gs.rocks=buildWave(gs.wave, wt, mm)
    gs.powerUps=gs.powerUps.filter(p=>p.framesLeft>0) // carry over active power-ups
  }

  const shootCooldownRef = useRef(0)
  const droneShootCoolRef = useRef(0)

  const toggleAurora = () => { const n=!auroraModeRef.current; auroraModeRef.current=n; setAuroraMode(n); if(n) fireQuip('Autopilot engaged. Stand by.') }
  const toggleMining = () => {
    const n=!miningModeRef.current; miningModeRef.current=n; setMiningMode(n)
    stateRef.current=makeInitState(n); lastQuipFrameRef.current=-QUIP_COOLDOWN; frameRef.current=0
  }

  useEffect(()=>{
    stateRef.current=makeInitState(miningModeRef.current)
    const onKey=(e:KeyboardEvent)=>{ keysRef.current.add(e.code); if(e.code!=='Escape') e.preventDefault() }
    const offKey=(e:KeyboardEvent)=>keysRef.current.delete(e.code)
    window.addEventListener('keydown',onKey); window.addEventListener('keyup',offKey)

    const canvas=canvasRef.current!; const ctx=canvas.getContext('2d')!
    let uiTick=0

    const loop=()=>{
      frameRef.current++
      const frame=frameRef.current; const gs=stateRef.current!
      const keys=keysRef.current; const am=auroraModeRef.current; const mm=miningModeRef.current
      const wt=gs.waveType; const stats=SHIP_STATS[gs.shipTier]

      // ── Upgrade phase input ──────────────────────────────────────────────
      if (gs.phase==='upgrading') {
        gs.upgradeTimer++
        if (!am) {
          if (gs.upgradeOptions.length>1) {
            if (keys.has('ArrowLeft')||keys.has('KeyA')) gs.upgradeSelected=0
            if (keys.has('ArrowRight')||keys.has('KeyD')) gs.upgradeSelected=1
          }
          if (keys.has('Space')||keys.has('Enter')) {
            keys.delete('Space'); keys.delete('Enter')
            applyUpgrade(gs, gs.upgradeOptions[gs.upgradeSelected])
            advanceWave(gs, mm)
          }
        } else {
          // Aurora auto-confirms after 90 frames
          if (gs.upgradeTimer >= 90) {
            gs.upgradeSelected = gs.upgradeOptions.length > 1 ? Math.round(Math.random()) : 0
            applyUpgrade(gs, gs.upgradeOptions[gs.upgradeSelected])
            advanceWave(gs, mm)
          }
        }

        // Draw upgrade screen
        ctx.fillStyle='#030508'; ctx.fillRect(0,0,W,H)
        drawStars(ctx,wt)
        drawUpgradeScreen(ctx, gs.upgradeOptions, gs.upgradeSelected, gs.upgradeTimer, am)
        drawAuroraHUD(ctx, quipRef.current, quipAlphaRef.current)
        if (quipAlphaRef.current>0) quipAlphaRef.current--
        uiTick++; if(uiTick>=6){uiTick=0; setUiPhase('upgrading'); setUiTier(gs.shipTier)}
        animRef.current=requestAnimationFrame(loop); return
      }

      // ── Input ────────────────────────────────────────────────────────────
      let rotLeft:boolean, rotRight:boolean, thrustOn:boolean, shootNow:boolean
      if (am&&gs.phase==='playing') {
        const ai=auroraAI(gs.ship,gs.rocks,mm,wt,stats.gunType)
        rotLeft=ai.rotateLeft; rotRight=ai.rotateRight; thrustOn=ai.thrust; shootNow=ai.shoot&&!mm
      } else {
        rotLeft=keys.has('ArrowLeft')||keys.has('KeyA')
        rotRight=keys.has('ArrowRight')||keys.has('KeyD')
        thrustOn=keys.has('ArrowUp')||keys.has('KeyW')
        shootNow=keys.has('Space')&&!mm
      }

      if (gs.phase==='playing') {
        // ── Physics ─────────────────────────────────────────────────────────
        if (rotLeft)  gs.ship.angle -= 0.065
        if (rotRight) gs.ship.angle += 0.065
        if (thrustOn) { gs.ship.vel.x+=Math.sin(gs.ship.angle)*stats.accel; gs.ship.vel.y-=Math.cos(gs.ship.angle)*stats.accel }
        gs.ship.vel.x*=FRICTION; gs.ship.vel.y*=FRICTION
        gs.ship.pos.x=wrap(gs.ship.pos.x+gs.ship.vel.x,W); gs.ship.pos.y=wrap(gs.ship.pos.y+gs.ship.vel.y,H)
        if(gs.ship.invincible>0) gs.ship.invincible--

        // Tick power-ups
        gs.powerUps=gs.powerUps.filter(p=>{ p.framesLeft--; return p.framesLeft>0 })
        const isShielded = activePowerUp(gs.powerUps,'shield')
        const isBomb     = activePowerUp(gs.powerUps,'bomb')
        const isRapid    = activePowerUp(gs.powerUps,'rapidfire')
        const isTriple   = activePowerUp(gs.powerUps,'tripleshot')
        const effectCD   = isRapid ? Math.max(4, Math.floor(stats.fireCooldown*0.5)) : stats.fireCooldown

        // Orbit drones
        for(const d of gs.drones) { d.orbitAngle+=0.018; d.orbitAngle%=TAU }

        // Sleeper reveal
        if (wt==='sleeper') {
          for(const r of gs.rocks) {
            if(!r.revealed) {
              const dist=Math.hypot(r.pos.x-gs.ship.pos.x, r.pos.y-gs.ship.pos.y)
              if(dist<160) r.revealed=true
            }
          }
        }

        let killedAny=false; let droppedPowerUp: PowerUpType|undefined

        if (mm) {
          // ── Mining logic ─────────────────────────────────────────────────
          if (wt==='gas') {
            for(const r of gs.rocks) { if(cloudInCone(gs.ship,r)) r.health-=stats.mineRate }
            gs.rocks=gs.rocks.filter(r=>{ if(r.health<=0){gs.score+=ROCK_SCORE[0];killedAny=true;return false} return true })
          } else {
            // Sort by dist, assign: ship → nearest, drones → next
            const sorted=[...gs.rocks].sort((a,b)=>{
              return Math.hypot(a.pos.x-gs.ship.pos.x,a.pos.y-gs.ship.pos.y)-Math.hypot(b.pos.x-gs.ship.pos.x,b.pos.y-gs.ship.pos.y)
            })
            if (sorted.length>0) {
              sorted[0].health-=stats.mineRate
              for(let di=0;di<gs.drones.length&&di+1<sorted.length;di++) sorted[di+1].health-=stats.mineRate*0.6
            }
            gs.rocks=gs.rocks.filter(r=>{
              if(r.health<=0){
                gs.score+=r.rockType==='moon'?500:ROCK_SCORE[r.tier]; killedAny=true
                if(r.powerUpType) droppedPowerUp=r.powerUpType; return false
              } return true
            })
          }
        } else {
          // ── Combat logic ─────────────────────────────────────────────────
          // Rock movement (with special behavior)
          for(const r of gs.rocks){
            if(r.isDrone) {
              // Drones orbit the ship — tangential velocity keeps them circling,
              // radial correction holds the orbit radius so they never pile onto the hull
              const d=tDelta(r.pos.x,r.pos.y,gs.ship.pos.x,gs.ship.pos.y)
              const dist=Math.hypot(d.x,d.y)||1
              const radX=d.x/dist; const radY=d.y/dist   // unit vector toward ship
              const tanX=-radY;    const tanY=radX         // tangential (counterclockwise)
              const orbitR=90
              const orbitSpd=1.3+gs.wave*0.03
              const radErr=Math.min((dist-orbitR)*0.07, 2) // pull toward orbit radius
              r.vel.x+=(tanX*orbitSpd+radX*radErr-r.vel.x)*0.06
              r.vel.y+=(tanY*orbitSpd+radY*radErr-r.vel.y)*0.06
              r.angle=Math.atan2(r.vel.x,-r.vel.y)
            } else {
              r.angle+=r.spin
            }
            r.pos.x=wrap(r.pos.x+r.vel.x,W); r.pos.y=wrap(r.pos.y+r.vel.y,H)
          }

          // Homing bullet steering
          for(const b of gs.bullets){
            if(b.homing && gs.rocks.length>0){
              let nt=gs.rocks[0]; let nd=Infinity
              for(const r of gs.rocks){ const dd=Math.hypot(r.pos.x-b.pos.x,r.pos.y-b.pos.y); if(dd<nd){nd=dd;nt=r} }
              const ta=Math.atan2(nt.pos.x-b.pos.x,-(nt.pos.y-b.pos.y))
              const ca=Math.atan2(b.vel.x,-b.vel.y)
              const na=ca+Math.sign(angleDiff(ca,ta))*Math.min(Math.abs(angleDiff(ca,ta)),0.09)
              const sp=Math.hypot(b.vel.x,b.vel.y)
              b.vel.x=Math.sin(na)*sp; b.vel.y=-Math.cos(na)*sp
            }
          }

          // Ship shooting
          if(shootCooldownRef.current>0) shootCooldownRef.current--
          if(shootNow&&shootCooldownRef.current===0){
            shootCooldownRef.current=am?Math.floor(effectCD*0.85):effectCD
            const newBullets=fireBullets(gs.ship,stats.gunType,isBomb)
            // Triple-shot power-up: append 2 extra spread bullets regardless of gun type
            if(isTriple){
              for(const sp of [-0.28,0.28]){
                const a=gs.ship.angle+sp
                newBullets.push({
                  pos:{x:gs.ship.pos.x+Math.sin(a)*16,y:gs.ship.pos.y-Math.cos(a)*16},
                  vel:{x:Math.sin(a)*BULLET_SPEED,y:-Math.cos(a)*BULLET_SPEED},
                  life:BULLET_LIFE, isBomb, bRadius:isBomb?10:3,
                })
              }
            }
            gs.bullets.push(...newBullets)
          }

          // Drone shooting
          if(droneShootCoolRef.current>0) droneShootCoolRef.current--
          if(gs.drones.length>0&&droneShootCoolRef.current===0){
            droneShootCoolRef.current=DRONE_FIRE_CD
            for(let di=0;di<gs.drones.length;di++){
              const d=gs.drones[di]
              const dPos={x:gs.ship.pos.x+Math.cos(d.orbitAngle)*DRONE_ORBIT_R, y:gs.ship.pos.y+Math.sin(d.orbitAngle)*DRONE_ORBIT_R}
              // Drone targets nearest visible rock
              let nearest=gs.rocks[0]; let nd=Infinity
              for(const r of gs.rocks){
                if(wt==='sleeper'&&!r.revealed) continue
                const dist=Math.hypot(r.pos.x-dPos.x,r.pos.y-dPos.y); if(dist<nd){nd=dist;nearest=r}
              }
              if(nearest){
                const ta=Math.atan2(nearest.pos.x-dPos.x,-(nearest.pos.y-dPos.y))
                d.facingAngle=ta
                gs.bullets.push({
                  pos:{...dPos},
                  vel:{x:Math.sin(ta)*DRONE_BULLET_SPEED,y:-Math.cos(ta)*DRONE_BULLET_SPEED},
                  life:BULLET_LIFE, isBomb:false, bRadius:2,
                })
              }
            }
          }

          // Bullet movement & collision
          gs.bullets=gs.bullets.filter(b=>b.life-->0)
          for(const b of gs.bullets){ b.pos.x=wrap(b.pos.x+b.vel.x,W); b.pos.y=wrap(b.pos.y+b.vel.y,H) }
          const hitBullets=new Set<Bullet>(); const newRocks: Rock[]=[]
          for(const r of gs.rocks){
            if(wt==='sleeper'&&!r.revealed){newRocks.push(r);continue}
            let hit=false
            for(const b of gs.bullets){
              if(!hitBullets.has(b)&&Math.hypot(b.pos.x-r.pos.x,b.pos.y-r.pos.y)<r.radius+b.bRadius){
                hit=true; hitBullets.add(b)
                // Shields absorb hit
                if(r.shields&&r.shields>0){ r.shields--; break }
                r.health-=b.damage ?? (b.isBomb?300:100)
                if(r.health<=0){
                  gs.score+=r.powerUpType?ENHANCED_SCORE:r.faction?ROCK_SCORE[0]*4:ROCK_SCORE[r.tier]
                  killedAny=true
                  if(r.powerUpType) droppedPowerUp=r.powerUpType
                  if(!r.powerUpType&&r.tier<2) for(let i=0;i<2;i++) newRocks.push(makeRock(r.tier+1,{x:r.pos.x,y:r.pos.y}))
                } else newRocks.push(r)
                break
              }
            }
            if(!hit) newRocks.push(r)
          }
          gs.bullets=gs.bullets.filter(b=>!hitBullets.has(b)); gs.rocks=newRocks

          // Drone mining in mining mode (handled above — drones shoot in combat only)
        }

        // Power-up pickup
        if (droppedPowerUp) {
          if (droppedPowerUp==='life') {
            gs.lives=Math.min(gs.lives+1, SHIP_STATS[gs.shipTier].maxLives)
          } else {
            const existing=gs.powerUps.findIndex(p=>p.type===droppedPowerUp)
            if(existing>=0) gs.powerUps[existing].framesLeft=droppedPowerUp==='shield'?480:900
            else gs.powerUps.push({type:droppedPowerUp,framesLeft:droppedPowerUp==='shield'?480:900})
          }
        }

        // Aurora quip on kill
        if (killedAny&&am&&frame-lastQuipFrameRef.current>=QUIP_COOLDOWN) {
          const pool = wt==='moon'?MOON_QUIPS:wt==='ice'?ICE_QUIPS:wt==='gas'?GAS_QUIPS:wt==='drones'?DRONE_QUIPS:wt==='faction'?FACTION_QUIPS:wt==='sleeper'?SLEEPER_QUIPS:mm?MINING_QUIPS:COMBAT_QUIPS
          fireQuip(pool[Math.floor(Math.random()*pool.length)])
        }
        if(quipAlphaRef.current>0) quipAlphaRef.current-=1

        // Ship collision (combat, no damage in mining)
        if(!mm&&!am&&gs.ship.invincible===0&&!isShielded){
          for(const r of gs.rocks){
            if(wt==='sleeper'&&!r.revealed) continue
            if(Math.hypot(gs.ship.pos.x-r.pos.x,gs.ship.pos.y-r.pos.y)<gs.ship.radius*0.65+r.radius*0.75){
              gs.lives--
              if(gs.lives<=0){gs.phase='over'}
              else{gs.phase='dead';gs.respawnTimer=90}
              break
            }
          }
        }

        // Wave clear
        if(gs.rocks.length===0&&!gs.cleared){
          gs.cleared=true
          const opts=getUpgradeOptions(gs.shipTier)
          if(opts.length>0&&gs.wave%5===0){
            gs.phase='upgrading'; gs.upgradeOptions=opts; gs.upgradeSelected=0; gs.upgradeTimer=0
          } else {
            gs.phase='cleared'; gs.respawnTimer=am?60:120
            if(am&&frame-lastQuipFrameRef.current>=QUIP_COOLDOWN) fireQuip('Field cleared. Calculating next wave.')
          }
        }

      } else if(gs.phase==='dead'||gs.phase==='cleared'){
        if(--gs.respawnTimer<=0){
          if(gs.phase==='dead') respawnShip(gs)
          else advanceWave(gs,mm)
        }
      }

      // ── Draw ──────────────────────────────────────────────────────────────
      const bgColors: Partial<Record<WaveType,string>> = {ice:'#060a14',gas:'#060b05',moon:'#04060a',drones:'#0a0404',faction:'#0a0804',sleeper:'#060610'}
      ctx.fillStyle=bgColors[wt]??'#050810'; ctx.fillRect(0,0,W,H)

      // Ambient glow
      if(am||wt!=='normal'){
        const [gr,gg,gb]=am?[140,60,220]:wt==='ice'?[80,140,220]:wt==='gas'?[60,180,40]:wt==='moon'?[120,160,100]:wt==='drones'?[200,40,40]:wt==='faction'?[200,160,40]:wt==='sleeper'?[100,100,200]:[0,0,0]
        const g=ctx.createRadialGradient(W/2,H/2,50,W/2,H/2,350)
        g.addColorStop(0,`rgba(${gr},${gg},${gb},0.05)`); g.addColorStop(1,'transparent')
        ctx.fillStyle=g; ctx.fillRect(0,0,W,H)
      }
      drawStars(ctx,wt)
      const bc=am?'rgba(180,80,255,0.18)':wt==='ice'?'rgba(120,200,255,0.2)':wt==='gas'?'rgba(100,220,60,0.18)':wt==='moon'?'rgba(160,190,140,0.18)':wt==='drones'?'rgba(220,60,60,0.2)':wt==='faction'?'rgba(220,180,60,0.2)':wt==='sleeper'?'rgba(100,120,220,0.18)':'rgba(0,180,220,0.15)'
      ctx.strokeStyle=bc; ctx.lineWidth=1; ctx.strokeRect(1,1,W-2,H-2)

      // Find nearest for laser/aiming
      let nearestRock: Rock|null=null; let nd2=Infinity
      for(const r of gs.rocks){
        if(wt==='sleeper'&&!r.revealed) continue
        const d=tDelta(gs.ship.pos.x,gs.ship.pos.y,r.pos.x,r.pos.y); const dist=Math.hypot(d.x,d.y)
        if(dist<nd2){nd2=dist;nearestRock=r}
      }

      // Moon backdrop
      if(wt==='moon'&&gs.rocks.length>0&&gs.rocks[0].rockType==='moon') drawMoon(ctx,gs.rocks[0],frame)

      // Gas clouds
      if(wt==='gas') for(const r of gs.rocks) if(r.rockType==='gas') drawGasCloud(ctx,r,r===nearestRock,mm,frame)

      // Normal/ice rocks, drones, battleships
      for(const r of gs.rocks){
        if(r.rockType==='gas'||r.rockType==='moon') continue
        if(r.isDrone) drawDroneEnemy(ctx,r,frame)
        else if(r.isBattleship) drawBattleship(ctx,r,frame)
        else drawRock(ctx,r,r===nearestRock,mm,frame)
      }

      // Mining beam
      if(mm&&gs.phase==='playing'){
        if(wt==='gas') drawGasCone(ctx,gs.ship,am,frame)
        else if(nearestRock){
          let tx=nearestRock.pos.x; let ty=nearestRock.pos.y
          if(nearestRock.rockType==='moon'){const dx=gs.ship.pos.x-nearestRock.pos.x;const dy=gs.ship.pos.y-nearestRock.pos.y;const dist=Math.hypot(dx,dy);tx=nearestRock.pos.x+dx/dist*nearestRock.radius;ty=nearestRock.pos.y+dy/dist*nearestRock.radius}
          drawMiningLaser(ctx,gs.ship,tx,ty,am,wt,frame)
          // Drone mining beams
          const sorted=[...gs.rocks].sort((a,b)=>Math.hypot(a.pos.x-gs.ship.pos.x,a.pos.y-gs.ship.pos.y)-Math.hypot(b.pos.x-gs.ship.pos.x,b.pos.y-gs.ship.pos.y))
          for(let di=0;di<gs.drones.length&&di+1<sorted.length;di++){
            const d=gs.drones[di]; const dPos={x:gs.ship.pos.x+Math.cos(d.orbitAngle)*DRONE_ORBIT_R,y:gs.ship.pos.y+Math.sin(d.orbitAngle)*DRONE_ORBIT_R}
            const tgt=sorted[di+1]
            const dc=SHIP_STATS[gs.shipTier].color
            drawDroneLaser(ctx,dPos,tgt.pos,dc,frame)
          }
        }
      }

      // Aurora aim dotted line
      if(!mm&&am&&nearestRock&&gs.phase==='playing'){
        ctx.save(); ctx.setLineDash([3,6]); ctx.strokeStyle='rgba(200,120,255,0.2)'; ctx.lineWidth=1
        ctx.beginPath(); ctx.moveTo(gs.ship.pos.x,gs.ship.pos.y); ctx.lineTo(nearestRock.pos.x,nearestRock.pos.y); ctx.stroke()
        ctx.setLineDash([]); ctx.restore()
      }

      // Bullets
      if(!mm) for(const b of gs.bullets) drawBullet(ctx,b,am)

      // Ship
      if(gs.phase!=='over') drawShip(ctx,gs.ship,thrustOn,am,mm,gs.shipTier,frame)

      // Drones
      if(gs.drones.length>0&&gs.phase!=='over'){
        const dc=am?'#cc88ff':mm?'#44ddaa':SHIP_STATS[gs.shipTier].color
        drawDrones(ctx,gs.ship,gs.drones,dc,frame)
      }

      // HUDs
      drawAuroraHUD(ctx,quipRef.current,quipAlphaRef.current)
      drawPowerUpHUD(ctx,gs.powerUps)

      // Phase overlays
      ctx.textAlign='center'
      if(gs.phase==='dead'){
        ctx.fillStyle='rgba(255,60,60,0.9)'; ctx.font='bold 22px monospace'; ctx.fillText('HULL BREACH — EMERGENCY WARP',W/2,H/2-12)
        ctx.font='13px monospace'; ctx.fillStyle='#aaa'; ctx.fillText(`Respawning in ${Math.ceil(gs.respawnTimer/30)}s`,W/2,H/2+16)
      }
      if(gs.phase==='cleared'){
        const cc=wt==='moon'?'#aabb99':wt==='ice'?'#aaddff':wt==='gas'?'#88ff44':wt==='drones'?'#ff8888':wt==='faction'?'#ffdd44':wt==='sleeper'?'#aaaaff':am?'#dd88ff':'#00ffcc'
        const cm=wt==='moon'?'◉ MOON MINED':wt==='ice'?'❄ ICE FIELD CLEARED':wt==='gas'?'◎ GAS CLOUD VENTED':wt==='drones'?'⚡ DRONE SWARM NEUTRALIZED':wt==='faction'?'⚔ FACTION WRECK LOOTED':wt==='sleeper'?'◈ SLEEPER CACHE BREACHED':`FIELD CLEARED — WAVE ${gs.wave}`
        ctx.fillStyle=cc; ctx.font='bold 22px monospace'; ctx.fillText(cm,W/2,H/2-12)
        ctx.font='13px monospace'; ctx.fillStyle='#aaa'; ctx.fillText(`Next wave in ${Math.ceil(gs.respawnTimer/30)}s`,W/2,H/2+16)
      }
      if(gs.phase==='over'){
        ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,W,H)
        ctx.fillStyle='#ff4444'; ctx.font='bold 28px monospace'; ctx.fillText('CAPSULE DESTROYED',W/2,H/2-36)
        ctx.fillStyle=am?'#dd88ff':'#00ccee'; ctx.font='16px monospace'; ctx.fillText(`Final Score: ${gs.score.toLocaleString()} ISK`,W/2,H/2+4)
        ctx.fillStyle='#888'; ctx.font='12px monospace'; ctx.fillText(am?'Redeploying…':'Press R to try again',W/2,H/2+30)
      }

      // Special wave banner
      if(wt!=='normal'&&gs.rocks.length>0&&!gs.cleared&&gs.phase==='playing'&&frame-gs.waveStartFrame<120){
        const bf=frame-gs.waveStartFrame; const ba=Math.min(1,bf<60?bf/30:(120-bf)/30)
        const bc2=wt==='moon'?'#aabb99':wt==='ice'?'#aaddff':wt==='gas'?'#88ff44':wt==='drones'?'#ff8888':wt==='faction'?'#ffdd44':'#aaaaff'
        const bt=wt==='moon'?'☽  SECRET LEVEL — MOON MINING':wt==='ice'?'❄  SECRET LEVEL — ICE FIELD':wt==='gas'?'◎  SECRET LEVEL — GAS HUFFING':wt==='drones'?'⚡  SPECIAL ENCOUNTER — ROGUE DRONE SWARM':wt==='faction'?'⚔  SPECIAL ENCOUNTER — FACTION BATTLESHIPS':'◈  SPECIAL ENCOUNTER — SLEEPER CACHE'
        ctx.save(); ctx.globalAlpha=ba
        ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,H/2-36,W,52)
        ctx.fillStyle=bc2; ctx.font='bold 22px monospace'; ctx.textAlign='center'; ctx.shadowColor=bc2; ctx.shadowBlur=14
        ctx.fillText(bt,W/2,H/2+2); ctx.restore()
      }

      uiTick++; if(uiTick>=6){uiTick=0;setUiScore(gs.score);setUiLives(gs.lives);setUiPhase(gs.phase);setUiWave(gs.wave);setUiWaveType(gs.waveType);setUiTier(gs.shipTier)}
      animRef.current=requestAnimationFrame(loop)
    }

    const onRestart=(e:KeyboardEvent)=>{ if(e.code==='KeyR'&&stateRef.current?.phase==='over') stateRef.current=makeInitState(miningModeRef.current) }
    window.addEventListener('keydown',onRestart)
    animRef.current=requestAnimationFrame(loop)
    return ()=>{
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('keydown',onKey); window.removeEventListener('keyup',offKey)
      window.removeEventListener('keydown',onRestart)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  useEffect(()=>{
    const esc=(e:KeyboardEvent)=>{ if(e.key==='Escape') onClose() }
    window.addEventListener('keydown',esc)
    return()=>window.removeEventListener('keydown',esc)
  },[onClose])

  const modeColor = auroraMode?'#cc88ff':miningMode
    ?(uiWaveType==='ice'?'#aaddff':uiWaveType==='gas'?'#88ff44':uiWaveType==='moon'?'#aabb99':'#44ddaa')
    :SHIP_STATS[uiTier].color
  const waveLabel = uiWaveType==='moon'?'☽ MOON':uiWaveType==='ice'?'❄ ICE':uiWaveType==='gas'?'◎ GAS':uiWaveType==='drones'?'⚡ DRONES':uiWaveType==='faction'?'⚔ FACTION':uiWaveType==='sleeper'?'◈ SLEEPER':`WAVE ${uiWave}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-4"
    >
      <div className="flex flex-row gap-3 items-start" style={{fontFamily:'monospace'}} onClick={e=>e.stopPropagation()}>
        {/* ── Left: canvas column ── */}
        <div className="flex flex-col gap-2">
        {/* HUD */}
        <div className="flex items-center justify-between px-1" style={{width:W}}>
          <div className="flex items-center gap-3 text-xs" style={{color:modeColor}}>
            <span>{auroraMode?'◈ AURORA':miningMode?'⛏ MINING':'◈ VENTURE'} · {waveLabel}</span>
            <span style={{color:SHIP_STATS[uiTier].color,fontSize:10}}>▲ {SHIP_STATS[uiTier].label}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {uiPhase!=='upgrading'&&(
              !miningMode
                ? <span style={{color:'#ffcc44'}}>{'♦ '.repeat(Math.max(0,uiLives))}{'◇ '.repeat(Math.max(0,SHIP_STATS[uiTier].maxLives-uiLives))}</span>
                : null
            )}
            <span style={{color:'#00ffcc'}}>{uiScore.toLocaleString()} ISK</span>
            {!idleMode&&<>
              <button onClick={toggleMining} style={{color:miningMode?modeColor:'#555',fontSize:10,textShadow:miningMode?`0 0 8px ${modeColor}`:'none',transition:'all .2s'}}>
                {miningMode?'⛏ MINING':'⛏'}
              </button>
              <button onClick={toggleAurora} style={{color:auroraMode?'#cc88ff':'#555',fontSize:10,textShadow:auroraMode?'0 0 8px #cc88ff':'none',transition:'all .2s'}}>
                {auroraMode?'◈ AURORA':'◈'}
              </button>
            </>}
            <button onClick={()=>setShowInfo(v=>!v)} style={{color:showInfo?'#00ccee':'#555',fontSize:10,textShadow:showInfo?'0 0 8px #00ccee':'none',transition:'all .2s'}}>
              {showInfo?'[?]':'[?]'}
            </button>
            <button onClick={onClose} style={{color:'#ff6666',fontSize:10}}>[ESC]</button>
          </div>
        </div>

        <canvas ref={canvasRef} width={W} height={H} style={{
          display:'block',
          border:`1px solid ${auroraMode?'rgba(180,80,255,0.35)':uiWaveType==='ice'?'rgba(120,200,255,0.3)':uiWaveType==='gas'?'rgba(100,220,60,0.3)':uiWaveType==='moon'?'rgba(160,190,140,0.3)':miningMode?'rgba(60,200,150,0.3)':'rgba(0,180,220,0.3)'}`,
          boxShadow:`0 0 32px ${auroraMode?'rgba(160,60,255,0.2)':uiWaveType==='gas'?'rgba(80,200,40,0.15)':uiWaveType==='ice'?'rgba(80,160,255,0.15)':'rgba(0,180,220,0.15)'}`,
          transition:'border-color .5s,box-shadow .5s', maxWidth:'95vw',
        }} />

        <div className="flex justify-center gap-4 text-[9px]" style={{color:'#444',width:W}}>
          {idleMode
            ? <span style={{color:'#554466'}}>◈ AURORA IS PLAYING — CLICK OR PRESS ESC TO DISMISS</span>
            : auroraMode
              ? <span style={{color:'#9966cc'}}>◈ AURORA IS PILOTING — SIT BACK AND ENJOY</span>
              : miningMode
                ? <span style={{color:'#336655'}}>⛏ FLY NEAR ROCKS · SECRET LEVEL EVERY 5 WAVES · UPGRADE EVERY 5 WAVES</span>
                : <><span>↑/W THRUST</span><span>←/→ ROTATE</span><span>SPACE FIRE</span><span>R RESTART</span><span>[?] INFO</span><span>ESC CLOSE</span></>
          }
        </div>
        </div>{/* end canvas column */}

        {/* ── Right: info pane ── */}
        {showInfo && <InfoPane miningMode={miningMode} />}
      </div>
    </div>
  )
}

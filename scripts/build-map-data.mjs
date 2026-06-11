/**
 * build-map-data.mjs
 *
 * Fetches all k-space systems from ESI and builds public/eve-systems.json.
 * Runtime: ~3-6 minutes depending on ESI latency.
 *
 * Usage: node scripts/build-map-data.mjs
 */

import { writeFileSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUTPUT = join(ROOT, 'public', 'eve-systems.json')
const CACHE_DIR = join(ROOT, 'scripts', '.map-cache')
const ESI = 'https://esi.evetech.net/latest'
const CONCURRENCY = 40

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchJson(url, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (r.status === 420 || r.status === 503 || r.status === 502) {
        const wait = Math.pow(2, attempt) * 500
        await sleep(wait)
        continue
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
      return await r.json()
    } catch (e) {
      if (attempt === retries) throw e
      await sleep(Math.pow(2, attempt) * 300)
    }
  }
}

async function batchFetch(urls, concurrency, label = '') {
  const results = new Array(urls.length)
  let idx = 0
  let done = 0
  const total = urls.length
  const startTime = Date.now()

  async function worker() {
    while (true) {
      const i = idx++
      if (i >= total) break
      results[i] = await fetchJson(urls[i])
      done++
      if (done % 100 === 0 || done === total) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        const rate = (done / elapsed).toFixed(0)
        process.stdout.write(`\r  ${label}: ${done}/${total} (${rate}/s, ${elapsed}s)  `)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  process.stdout.write('\n')
  return results
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}


// ── main ─────────────────────────────────────────────────────────────────────

console.log('Aurora star map data builder')
console.log('─'.repeat(40))

// 1. Get all system IDs
process.stdout.write('Fetching system ID list...')
const allIds = await fetchJson(`${ESI}/universe/systems/`)
const ksIds = allIds.filter(id => id >= 30000000 && id < 31000000).sort((a, b) => a - b)
console.log(` ${allIds.length} total, ${ksIds.length} k-space`)

// 2. Fetch system details
console.log('Fetching system details...')
const systemUrls = ksIds.map(id => `${ESI}/universe/systems/${id}/`)
const rawSystems = await batchFetch(systemUrls, CONCURRENCY, 'systems')

// 3. Collect stargate IDs (deduplicated)
const gateIds = [...new Set(rawSystems.flatMap(s => s?.stargates ?? []))]
console.log(`Fetching ${gateIds.length} stargates...`)
const gateUrls = gateIds.map(id => `${ESI}/universe/stargates/${id}/`)
const rawGates = await batchFetch(gateUrls, CONCURRENCY, 'stargates')

// 4. Build gate → destination system map
const gateDestMap = new Map()
for (const gate of rawGates) {
  if (gate?.stargate_id && gate?.destination?.system_id) {
    gateDestMap.set(gate.stargate_id, gate.destination.system_id)
  }
}

// 5. Get region names
process.stdout.write('Fetching region names...')
const regionIds = [...new Set(rawSystems.map(s => s?.constellation_id).filter(Boolean))]
// Actually we need region IDs from constellation data — fetch constellations instead
const constellationIds = [...new Set(rawSystems.map(s => s?.constellation_id).filter(Boolean))]
const constellationUrls = constellationIds.map(id => `${ESI}/universe/constellations/${id}/`)
process.stdout.write(` fetching ${constellationIds.length} constellations...\n`)
const rawConstellations = await batchFetch(constellationUrls, CONCURRENCY, 'constellations')

const constellationMap = new Map()  // constellationId → { name, regionId }
for (const c of rawConstellations) {
  if (c?.constellation_id) constellationMap.set(c.constellation_id, { name: c.name, regionId: c.region_id })
}

const uniqueRegionIds = [...new Set(rawConstellations.map(c => c?.region_id).filter(Boolean))]
process.stdout.write(`Fetching ${uniqueRegionIds.length} region names...\n`)
const regionUrls = uniqueRegionIds.map(id => `${ESI}/universe/regions/${id}/`)
const rawRegions = await batchFetch(regionUrls, CONCURRENCY, 'regions')

const regionNameMap = new Map()
for (const r of rawRegions) {
  if (r?.region_id) regionNameMap.set(r.region_id, r.name)
}

// 6. Normalize coordinates
// Find bounds across all k-space systems
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
for (const s of rawSystems) {
  if (!s?.position) continue
  if (s.position.x < minX) minX = s.position.x
  if (s.position.x > maxX) maxX = s.position.x
  if (s.position.z < minZ) minZ = s.position.z
  if (s.position.z > maxZ) maxZ = s.position.z
}
const rangeX = maxX - minX
const rangeZ = maxZ - minZ

// Normalize to [-1, 1] preserving aspect ratio (use max range as divisor)
const range = Math.max(rangeX, rangeZ)

// 7. Build output
process.stdout.write('Building output...')
const systemIdSet = new Set(ksIds)
const output = []

for (const s of rawSystems) {
  if (!s?.system_id || !s.position) continue

  // Build connections: map gate IDs → destination system IDs, keep only k-space targets
  const conns = (s.stargates ?? [])
    .map(gid => gateDestMap.get(gid))
    .filter(dest => dest !== undefined && systemIdSet.has(dest))

  const constData = constellationMap.get(s.constellation_id)
  const regionName = constData ? regionNameMap.get(constData.regionId) ?? 'Unknown' : 'Unknown'

  const secRaw = parseFloat((s.security_status ?? 0).toFixed(2))

  output.push({
    id: s.system_id,
    n: s.name,
    x: parseFloat((((s.position.x - minX) / range) * 2 - rangeX / range).toFixed(5)),
    z: parseFloat((((s.position.z - minZ) / range) * 2 - rangeZ / range).toFixed(5)),
    s: secRaw,
    r: regionName,
    k: constData?.name ?? 'Unknown',   // constellation name
    c: conns,
  })
}

console.log(` ${output.length} systems, ${output.reduce((a, s) => a + s.c.length, 0)} connections`)

// 8. Write output  — wrap in { sc, v } so the parser can derive LY scale.
// `sc` = the raw meter range used for normalization; 1 normalised unit = sc/2 metres.
const payload = { sc: range, v: output }
const json = JSON.stringify(payload)
writeFileSync(OUTPUT, json)
const kb = (json.length / 1024).toFixed(0)
console.log(`\nWrote ${OUTPUT} (${kb} KB)`)
console.log('Done! Reload Aurora to use the full map.')

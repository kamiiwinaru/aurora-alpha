#!/usr/bin/env node
// Scrapes EVE University mission wiki pages and outputs public/missions.json
// Run once: node scripts/scrape-missions.js
// Resumes from cache on interruption — safe to re-run.

const https = require('https')
const fs = require('fs')
const path = require('path')

const WIKI_API = 'https://wiki.eveuniversity.org/api.php'
const OUT_FILE = path.join(__dirname, '../public/missions.json')
const CACHE_FILE = path.join(__dirname, 'mission-wikitext-cache.json')
const RATE_LIMIT_MS = 400 // ~2.5 req/sec — respectful of the wiki

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Aurora-EVE-App/1.0 (personal EVE assistant)' } }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fetchWikitext(pageTitle) {
  const params = new URLSearchParams({
    action: 'parse',
    page: pageTitle,
    format: 'json',
    prop: 'wikitext',
    formatversion: '2'
  })
  try {
    const raw = await httpsGet(`${WIKI_API}?${params}`)
    const json = JSON.parse(raw)
    if (json.error || !json.parse) return null
    return json.parse.wikitext
  } catch {
    return null
  }
}

// ── Parsing helpers ────────────────────────────────────────────────────────────

function stripWiki(text) {
  if (!text) return ''
  return text
    .replace(/\[\[File:[^\]]+\]\]/gi, '')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/{{[^{}]*}}/g, '')      // remove simple templates
    .replace(/{{[^{}]*}}/g, '')      // second pass for nested
    .replace(/'{2,3}/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseTemplateBlock(text, templateName) {
  // Handles multi-line templates with nested braces
  const start = text.search(new RegExp(`{{${templateName}\\s*[\\|\\n]`, 'i'))
  if (start === -1) return {}
  let depth = 0
  let i = start
  let begin = -1
  while (i < text.length) {
    if (text[i] === '{' && text[i+1] === '{') {
      if (depth === 0) begin = i + 2
      depth++
      i += 2
    } else if (text[i] === '}' && text[i+1] === '}') {
      depth--
      if (depth === 0) {
        const inner = text.slice(begin, i)
        return parseParams(inner)
      }
      i += 2
    } else {
      i++
    }
  }
  return {}
}

function parseParams(inner) {
  // Split on top-level | only
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if ((c === '{' && inner[i+1] === '{') || (c === '[' && inner[i+1] === '[')) { depth++; cur += c; continue }
    if ((c === '}' && inner[i+1] === '}') || (c === ']' && inner[i+1] === ']')) { depth--; cur += c; continue }
    if (c === '|' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())

  const params = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim().toLowerCase().replace(/\s+/g, '')
    const v = part.slice(eq + 1).trim()
    params[k] = v
  }
  return params
}

// Convert {{Damagetype|th|kin}} → "Therm/Kin" before stripping wiki markup
const DMG_TOKEN = { em: 'EM', th: 'Therm', therm: 'Therm', thermal: 'Therm', kin: 'Kin', kinetic: 'Kin', exp: 'Exp', explosive: 'Exp' }
function resolveDamageTemplate(text) {
  if (!text) return text
  return text.replace(/{{Damagetype\|([^}]+)}}/gi, (_, args) =>
    args.split('|').map(a => DMG_TOKEN[a.trim().toLowerCase()] || a.trim()).filter(Boolean).join('/')
  )
}

function parsePockets(wikitext) {
  const pockets = []

  // Primary: scan for {{NPCTableHead|label}} blocks — used by most missions
  const headRe = /{{NPCTableHead\|([^}]*)}}/g
  const heads = []
  let m
  while ((m = headRe.exec(wikitext)) !== null) {
    heads.push({ label: m[1].trim(), pos: m.index, end: m.index + m[0].length })
  }

  if (heads.length > 0) {
    for (let i = 0; i < heads.length; i++) {
      const head = heads[i]
      const bodyEnd = i + 1 < heads.length ? heads[i + 1].pos : wikitext.length
      const body = wikitext.slice(head.end, bodyEnd)

      const npcs = extractNPCRows(body)
      // Prose between head and first NPC row (strategy notes, aggro notes)
      const firstRow = body.search(/{{NPCTable/)
      const descText = firstRow > 5 ? body.slice(0, firstRow) : ''
      const description = stripWiki(descText).slice(0, 400).trim()

      pockets.push({ name: head.label || `Group ${i + 1}`, description, npcs })
    }
    return pockets
  }

  // Fallback: === section header approach for missions with named pocket sections
  const headingRe = /^(={2,3})\s*(.+?)\s*\1\s*$/gm
  const headings = []
  while ((m = headingRe.exec(wikitext)) !== null) {
    headings.push({ title: m[2], pos: m.index, end: m.index + m[0].length })
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    if (!h.title.match(/pocket|wave|room|initial\s+spawn/i)) continue

    const bodyEnd = i + 1 < headings.length ? headings[i + 1].pos : wikitext.length
    const body = wikitext.slice(h.end, bodyEnd)

    const npcs = extractNPCRows(body)
    const descLines = body
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('{') && !l.startsWith('|') && !l.startsWith('!') && !l.startsWith('['))
      .slice(0, 4).join(' ')
    const description = stripWiki(descLines).slice(0, 400)

    pockets.push({ name: h.title.trim(), description, npcs })
  }

  return pockets
}

function extractNPCRows(body) {
  const npcs = []
  let currentGroup = 'Initial'

  // Collect separators and rows in document order
  const entries = []
  const sepRe = /{{NPCTableSeparator\|([^}]+)}}/g
  const rowRe = /{{NPCTableRow\|([^}]+)}}/g
  let m

  while ((m = sepRe.exec(body)) !== null) entries.push({ t: 'sep', i: m.index, v: m[1] })
  while ((m = rowRe.exec(body)) !== null) entries.push({ t: 'row', i: m.index, v: m[1] })
  entries.sort((a, b) => a.i - b.i)

  for (const e of entries) {
    if (e.t === 'sep') {
      currentGroup = e.v.replace(/:$/, '').trim()
    } else {
      const parts = e.v.split('|').map(p => p.trim())
      const shipClass = parts[0] || ''
      const count = parseInt(parts[1]) || 1
      const name = stripWiki(parts[2] || '')

      const named = {}
      for (let i = 3; i < parts.length; i++) {
        const eq = parts[i].indexOf('=')
        if (eq !== -1) named[parts[i].slice(0, eq).trim().toLowerCase()] = parts[i].slice(eq + 1).trim()
      }

      npcs.push({
        group: currentGroup,
        class: shipClass,
        count,
        name,
        trigger: named.trigger || null,
        web: named.ewar?.toLowerCase().includes('web') || named.web === 'yes' || false,
        point: named.point === 'yes' || false,
        ewar: named.ewar || null,
        notes: named.note || named.notes || null,
      })
    }
  }

  return npcs
}

function parseBlitz(wikitext) {
  let raw = null

  // Pattern 1: === Blitz === section
  const sectionM = wikitext.match(/={2,3}\s*Blitz\s*={2,3}\s*\n([\s\S]*?)(?=\n={2,3}[^=]|$)/i)
  if (sectionM) raw = sectionM[1]

  // Pattern 2: '''Blitz:''' inline
  if (!raw) {
    const inlineM = wikitext.match(/'''Blitz[^']*'''[:\s]*([\s\S]*?)(?=\n===|\n==|\n{{(?!NPCTable)|\z)/i)
    if (inlineM) raw = inlineM[1]
  }

  if (!raw) return null

  const lines = raw
    .split('\n')
    .map(l => stripWiki(l).replace(/^[*#]+\s*/, '').trim())  // handle both * and # lists
    .filter(l => l.length > 8)
  return lines.length ? lines.join('\n') : null
}

function parseLoot(wikitext) {
  // Find any section whose title contains Loot, Salvage, Bounty, Rewards, or Tag(s)
  const sectionRe = /={2,4}[^=\n]*(?:Loot|Salvage|Bounty|Reward|[Tt]ags?)[^=\n]*={2,4}\s*\n([\s\S]*?)(?=\n={2,4}[^=]|\n{{(?!NPC)|$)/gi
  let allBody = ''
  let sm
  while ((sm = sectionRe.exec(wikitext)) !== null) allBody += sm[1] + '\n'

  // Also capture '''Tags''' bold inline blocks (e.g. '''Tags''' (all spawns): followed by bullets)
  const boldTagRe = /'''[Tt]ags?'''[^'\n]*:?\s*\n((?:[*\s][^\n]+\n?)+)/g
  let bm
  while ((bm = boldTagRe.exec(wikitext)) !== null) allBody += bm[1] + '\n'

  const result = { bounty: null, loot: null, salvage: null, tags: null, items: [] }

  // Normalise ISK value strings: strip dates, br tags, wiki bold markers
  function cleanVal(v) {
    return v.replace(/\([^)]*\d{4}[^)]*\)/g, '').replace(/<br\s*\/?>/gi, '').replace(/'{2,3}/g, '').trim()
  }

  // ISK value pattern — includes mil/Mio variants
  const ISK_VAL = /[\d~<>,.]+\s*(?:[-–]\s*[\d~,.]+\s*)?(?:Mio|mil|M|k|B|ISK|million|billion)?(?:\s+ISK)?/i

  // Scan full wikitext for standalone loot/bounty/salvage lines (not inside section headers)
  // Handles: "Bounties: ~254,000 ISK", "Loot : 5.2M", "Salvage: ~3 Mio ISK", "Loot:'''10mil'''"
  const standaloneLootRe = /^[ \t]*(?:Total\s+)?([Bb]ounti?(?:es?|y)?|[Ll]oot(?:\s*&\s*[Ss]alvage)?|[Ss]alvage|[Tt]ags?)\s*:\s*(.+)$/gm
  let slm
  while ((slm = standaloneLootRe.exec(wikitext)) !== null) {
    const key = slm[1].trim().toLowerCase()
    const rawVal = cleanVal(slm[2])
    // Value must START with a number, ~, ±, ≈, or About/Approximately N — reject prose
    if (!/^[~±≈<>]?[\d]|^[Aa](?:bout|pproximately)\s+[\d~≈]/.test(rawVal)) continue
    const valM = rawVal.match(/[~±≈<>]?[\d,.]+\s*(?:[-–]\s*[\d,.]+\s*)?(?:Mio|mil|M|k|B|ISK|million|billion)?(?:\s+ISK)?/i)
    const val = valM ? valM[0].trim() : null
    if (!val) continue
    if (/bounti?(?:es?|y)?/.test(key))                            result.bounty  = result.bounty  || val
    else if (/loot\s*&\s*salvage|loot and salvage/.test(key)) { result.loot = result.loot || val; result.salvage = result.salvage || val }
    else if (/^loot/.test(key))                                result.loot    = result.loot    || val
    else if (/salvage/.test(key))                              result.salvage = result.salvage || val
    else if (/tag/.test(key))                                  result.tags    = result.tags    || val
  }

  // Reversed format: "~6.8M Bounty" / "~0.7M Salvage" (value first, keyword after)
  const reversedRe = /^[ \t]*([~±<>]?[\d,.]+\s*(?:[-–][\d,.]+\s*)?(?:Mio|mil|M|k|B|million|billion)?(?:\s+ISK)?)\s+(Bounti?(?:es?|y)?|Loot(?:\s*&\s*Salvage)?|Salvage|Tags?)\b/gim
  let rm2
  while ((rm2 = reversedRe.exec(wikitext)) !== null) {
    const val = rm2[1].trim(), key = rm2[2].trim().toLowerCase()
    if (/bounti?(?:es?|y)?/.test(key))                            result.bounty  = result.bounty  || val
    else if (/loot\s*&\s*salvage/.test(key))                  { result.loot = result.loot || val; result.salvage = result.salvage || val }
    else if (/^loot/.test(key))                                result.loot    = result.loot    || val
    else if (/salvage/.test(key))                              result.salvage = result.salvage || val
    else if (/tag/.test(key))                                  result.tags    = result.tags    || val
  }

  // |Rewards= field containing loot/salvage/bounty text (not ISK+LP agent reward format)
  const rewardsM = wikitext.match(/\|Rewards\s*=\s*([^\n|{}]{5,})/i)
  if (rewardsM) {
    const rv = cleanVal(rewardsM[1])
    // Skip pure agent reward format: "NNN ISK + NNN LP + ..."
    if (/\d/.test(rv) && !/ISK\s*\+\s*\d.*LP/i.test(rv)) {
      // Try to extract bounty/loot/salvage/tags values from prose
      const bM = rv.match(/([~<>]?[\d,.]+\s*(?:k|M|mil|million|B|Mio)?(?:\s+ISK)?)\s*(?:in\s+)?(?:bounti?e?s?)/i)
      const lM = rv.match(/([~<>]?[\d,.]+\s*(?:k|M|mil|million|B|Mio)?(?:\s+ISK)?)\s*(?:in\s+)?(?:loot)/i)
      const sM = rv.match(/([~<>]?[\d,.]+\s*(?:k|M|mil|million|B|Mio)?(?:\s+ISK)?)\s*(?:in\s+)?(?:salvage)/i)
      const tM = rv.match(/([~<>]?[\d,.\-]+\s*(?:k|M|mil|million|B|Mio)?(?:\s+ISK)?)\s*(?:in\s+)?(?:tags?)/i)
      if (bM) result.bounty  = result.bounty  || bM[1].trim()
      if (lM) result.loot    = result.loot    || lM[1].trim()
      if (sM) result.salvage = result.salvage || sM[1].trim()
      if (tM) result.tags    = result.tags    || tM[1].trim()
      // If no structured values but has loot keywords and numbers, store as items note
      if (!bM && !lM && !sM && !tM && /loot|salvage|bounty|tag/i.test(rv) && /\d/.test(rv)) {
        result.items.push(rv.slice(0, 150))
      }
    }
  }

  // NotableLoot template fields: | NotableLoot1 = Item Name
  const notableLootRe = /\|\s*NotableLoot\d*\s*=\s*([^\n|{}]{3,})/gi
  let nlm
  while ((nlm = notableLootRe.exec(wikitext)) !== null) {
    const item = stripWiki(nlm[1]).trim()
    if (item.length > 2 && item.length < 120) result.items.push(item)
  }

  // Tags:<br> with items either on next line or same line after <br>
  // e.g. "Tags:'''<br>Item x5, Item x7" OR "Tags:<br>\nItem x5, Item x7"
  const tagsBrRe = /[Tt]ags?[^:\n]*:\s*(?:'{0,3})?(?:<br\s*\/?>\s*(?:'{0,3})?)(?:\n)?([^\n{|]{10,})/g
  let tbm
  while ((tbm = tagsBrRe.exec(wikitext)) !== null) {
    const line = tbm[1]
    // Parse comma-separated "ItemName xN" entries
    const entries = line.split(',').map(e => e.trim()).filter(Boolean)
    for (const entry of entries) {
      const qM = entry.match(/^(.+?)\s+x(\d+)\s*$/i)
      if (qM) {
        const name = stripWiki(qM[1]).trim(), qty = parseInt(qM[2])
        if (name.length > 2 && name.length < 100) result.items.push(qty > 1 ? `${name} ×${qty}` : name)
      } else {
        const clean = stripWiki(entry).trim()
        if (clean.length > 2 && clean.length < 100 && /[A-Z]/.test(clean)) result.items.push(clean)
      }
    }
  }

  // Dash-bullet keyword-first: "- Bounties from the rats are approximately 20 mil"
  const dashBulletRe = /^-\s*(Bounti?(?:es?|y)?|Loot|Salvage|Tags?)[^.\n]*?([~≈±]?[\d,.]+\s*(?:mil|M|k|B|million|billion))\b/gim
  let dbm
  while ((dbm = dashBulletRe.exec(wikitext)) !== null) {
    const key = dbm[1].trim().toLowerCase(), val = dbm[2].trim()
    if (/bounti?/.test(key))   result.bounty  = result.bounty  || val
    else if (/loot/.test(key)) result.loot    = result.loot    || val
    else if (/salv/.test(key)) result.salvage = result.salvage || val
    else if (/tag/.test(key))  result.tags    = result.tags    || val
  }

  // Prose-embedded: "approximately 20 mil in bounties", "get 20mil in bounties", etc.
  // Only fire when field is still unset — avoids overwriting cleaner values
  const proseRe = /([~≈±]?[\d,.]+\s*(?:mil|M|k|B|million|billion))\s+in\s+(bounti?(?:es?|y)?|loot|salvage|tags?)/gi
  let pm
  while ((pm = proseRe.exec(wikitext)) !== null) {
    const val = pm[1].trim(), key = pm[2].trim().toLowerCase()
    if (/bounti?/.test(key))   result.bounty  = result.bounty  || val
    else if (/loot/.test(key)) result.loot    = result.loot    || val
    else if (/salv/.test(key)) result.salvage = result.salvage || val
    else if (/tag/.test(key))  result.tags    = result.tags    || val
  }

  // Now bail if no section body AND no values found at all
  if (!allBody.trim() && !result.bounty && !result.loot && !result.salvage && !result.tags && !result.items.length) return null

  const lines = allBody.split('\n')
  for (const line of lines) {
    const isBullet = /^[\s*#]+/.test(line)

    // Handle "7x Item Name" / " 26x Item" / "* Imperial Navy Colonel I x 34" quantity formats
    const qtyM = line.match(/^[\s*#]*(\d+)\s*x\s+(.+)$/i) ||
                 line.match(/^[\s*#]*(.+?)\s+x\s+(\d+)\s*$/i)
    if (qtyM) {
      // Determine which group is qty and which is name
      const [, a, b] = qtyM
      const isFirstQty = /^\d+$/.test(a)
      const qty = isFirstQty ? parseInt(a) : parseInt(b)
      const name = stripWiki(isFirstQty ? b : a).replace(/<br\s*\/?>/gi, '').trim()
      if (name.length > 2 && name.length < 100 && qty > 0) {
        result.items.push(qty > 1 ? `${name} ×${qty}` : name)
      }
      continue
    }

    const clean = cleanVal(line.replace(/^\*+\s*/, '').replace(/<br\s*\/?>/gi, ''))
    if (!clean.trim()) continue

    // "Key: value" patterns (Bounty, Loot, Salvage, Tags, Insignias, Normal loot, etc.)
    const kvM = clean.match(/^([A-Za-z][^:]{0,30}):\s*(.+)$/)
    if (kvM) {
      const key = kvM[1].trim().toLowerCase()
      const val = cleanVal(kvM[2]).replace(/\s{2,}/g, ' ').trim()
      if (/bounti?(?:es?|y)?/.test(key))                       result.bounty  = val
      else if (/loot\s*&\s*salvage|loot and salvage/.test(key)) { result.loot = val; result.salvage = val }
      else if (/^loot|normal loot/.test(key))               result.loot    = val
      else if (/salvage/.test(key))                          result.salvage = val
      else if (/tag|insignia|faction/.test(key))             result.tags    = val
      // preserve other named values (e.g. "Insingnias: 8.95m ISK") as items text
      else if (ISK_VAL.test(val)) result.items.push(`${kvM[1].trim()}: ${val}`)
      continue
    }

    // "500,000 EST. Value (Bounty)" style
    const parenM = clean.match(/^([\d,~]+\s*[\w\s.]+?)\s*\(([^)]+)\)\s*$/)
    if (parenM) {
      const label = parenM[2].trim().toLowerCase()
      const val = parenM[1].trim()
      if (/bounty/.test(label))  result.bounty  = result.bounty  || val
      else if (/loot/.test(label))    result.loot    = result.loot    || val
      else if (/salvage/.test(label)) result.salvage = result.salvage || val
      else if (/tag/.test(label))     result.tags    = result.tags    || val
      continue
    }

    // Plain prose ISK lines (e.g. "Salvage: ± 1.7 Mil ISK" already caught above; catch remainder)
    if (ISK_VAL.test(clean) && clean.length < 200) {
      result.items.push(stripWiki(clean).trim())
    } else if (isBullet && /[A-Z]/.test(clean) && clean.length > 4 && clean.length < 100 && !clean.includes('=')) {
      // Plain bullet item with no qty/ISK — likely a tag or loot item name
      result.items.push(stripWiki(clean).trim())
    }
  }

  // Parse wikitables: split each row on || and extract item + optional qty/value
  // Handles both "| ItemName || qty" and "| Date | Source | ItemName | ISK" formats
  // Split allBody into table sections to process row-by-row
  const tableRe = /{\|([\s\S]*?)\|}/g
  let tm
  while ((tm = tableRe.exec(allBody)) !== null) {
    const tableBody = tm[1]
    // Split into rows on |- boundaries
    const rows = tableBody.split(/^\|-[^\n]*/m)
    for (const row of rows) {
      // Extract cells: lines starting with | (but not |+ or |-)
      const cells = row.split('\n')
        .filter(l => /^\|[^|!+\-]/.test(l))
        .map(l => {
          // Handle inline || separators within a single line
          const parts = l.replace(/^\|\s*/, '').split(/\s*\|\|\s*/)
          return parts.map(p => stripWiki(p.replace(/style="[^"]*"/g, '').replace(/rowspan=\s*["']?\d+["']?/g, '')).trim())
        })
        .flat()
        .filter(c => c.length > 0)

      if (cells.length === 0) continue

      // Identify item-like cells: not a pure date, not a pure number, not "Pocket N - ..."
      const itemCells = cells.filter(c =>
        c.length > 3 && c.length < 120 &&
        !/^\d{4}[/\-]/.test(c) &&       // skip dates
        !/^Pocket\s+\d/i.test(c) &&      // skip pocket refs
        !/^\d{1,3}(,\d{3})*$/.test(c)    // skip plain numbers
      )

      // ISK-value cells: pure numbers (item est. value)
      const iskCells = cells.filter(c => /^\d{1,3}(,\d{3})+$/.test(c))

      for (let ci = 0; ci < itemCells.length; ci++) {
        const item = itemCells[ci]
        // Check if there's a corresponding ISK value
        const iskVal = iskCells[ci]
        if (iskVal) {
          const isk = parseInt(iskVal.replace(/,/g, ''))
          result.items.push(`${item} (~${isk >= 1000000 ? (isk/1000000).toFixed(1)+'M' : (isk/1000).toFixed(0)+'k'} ISK)`)
        } else {
          // Check for qty: small number in next cell
          const nextC = cells[cells.indexOf(item) + 1]
          const qty = nextC && /^\d+$/.test(nextC) ? parseInt(nextC) : null
          result.items.push(qty && qty > 1 ? `${item} ×${qty}` : item)
        }
      }
    }
  }

  // Deduplicate items and filter junk (raw wiki markup lines, URLs, empty, too short)
  result.items = [...new Set(result.items)].filter(i =>
    i.length > 3 && i.length < 200 &&
    !/^[{|!<]/.test(i) &&                  // skip raw wiki/html syntax
    !/rowspan|colspan|style=/i.test(i) &&
    !/^\d{4}[/\-]/.test(i) &&             // skip bare dates
    !/https?:[\s/]/i.test(i) &&           // skip URLs (incl. space-mangled ones)
    !/<!--/.test(i) &&                    // skip html comments
    !/^={2,}/.test(i) &&                  // skip leaked section headers
    !/^(Besides|Note:|This mission)/.test(i)  // skip narrative prose
  )

  const hasData = result.bounty || result.loot || result.salvage || result.tags || result.items.length > 0
  if (!hasData) return null
  return result
}

function parseMissionPage(wikitext, listLevel) {
  if (!wikitext) return null

  const d = parseTemplateBlock(wikitext, 'Missiondetails')

  const level = parseInt(d.level) || listLevel || null

  // |Faction= (singular) or |Faction1= etc. Strip standing loss suffix ("Gallente - Very Minor...")
  const factions = [d.faction, d.faction1, d.faction2, d.faction3, d.faction4]
    .map(f => f ? stripWiki(f.split('-')[0]).trim() : '').filter(Boolean)

  // Standing loss note lives after " - " in the faction field
  const standingLoss = d.faction
    ? stripWiki(d.faction.split('-').slice(1).join('-')).trim() || null
    : null

  // Template uses either |DamageToDeal= (single) or |DamageToDeal1= / |DamageToDeal2= (multi-faction)
  // Values often use {{Damagetype|th|kin}} — resolve before stripping
  const damageDeal = [d.damagetodeal, d.damagetodeal1, d.damagetodeal2, d.damagetodeal3]
    .map(f => f ? stripWiki(resolveDamageTemplate(f)).trim() : '').filter(Boolean).join(' / ') || null
  const damageResist = [d.damagetoresist, d.damagetoresist1, d.damagetoresist2, d.damagetoresist3]
    .map(f => f ? stripWiki(resolveDamageTemplate(f)).trim() : '').filter(Boolean).join(' / ') || null

  const extras = []
  if (d.webpoint)     extras.push({ type: 'web',   note: stripWiki(d.webpoint) })
  if (d.ewar)         extras.push({ type: 'ewar',  note: stripWiki(d.ewar) })
  if (d.neutralizing) extras.push({ type: 'neut',  note: stripWiki(d.neutralizing) })
  if (d.scrambling)   extras.push({ type: 'scram', note: stripWiki(d.scrambling) })
  if (d.dampen)       extras.push({ type: 'damp',  note: stripWiki(d.dampen) })
  if (d.tracking)     extras.push({ type: 'td',    note: stripWiki(d.tracking) })

  const shipSuggestion = stripWiki(d.shipsuggestion || '')
    .split(/[,/]/).map(s => s.trim()).filter(Boolean)

  const briefM = wikitext.match(/{{MissionBriefing\s*\|([\s\S]*?)}}/i)
  const briefing = briefM ? stripWiki(briefM[1]).slice(0, 600).trim() : null

  const pockets = parsePockets(wikitext)
  const blitz = parseBlitz(wikitext)
  const loot = parseLoot(wikitext)

  return {
    level,
    type: d.type ? stripWiki(d.type) : null,
    objective: d.objective ? stripWiki(d.objective).slice(0, 300) : null,
    factions,
    standingLoss,
    damageDeal,
    damageResist,
    shipSuggestion,
    extras,
    briefing,
    pockets,
    blitz,
    loot,
  }
}

// ── Mission list ──────────────────────────────────────────────────────────────

async function getMissionList() {
  console.log('Fetching mission list from Mission_reports...')
  const wikitext = await fetchWikitext('Mission_reports')
  if (!wikitext) throw new Error('Could not fetch Mission_reports')

  const missions = []
  const seen = new Set()

  // The page uses MediaWiki <tabs> — try to find level context per link
  // Strategy: scan for level markers then collect links until next marker
  const lines = wikitext.split('\n')
  let currentLevel = 1

  for (const line of lines) {
    const tabM = line.match(/name=["']?Level (\d)/i)
    if (tabM) { currentLevel = parseInt(tabM[1]); continue }

    const linkRe = /\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]/g
    let m
    while ((m = linkRe.exec(line)) !== null) {
      const title = m[1].trim()
      if (title.includes(':') || title.match(/^(Anomic|Storyline|Epic|Talk)/i)) continue
      if (seen.has(title)) continue
      seen.add(title)
      missions.push({ title, level: currentLevel })
    }
  }

  return missions
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load wikitext cache (so we can resume without re-fetching)
  let cache = {}
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
      console.log(`Cache loaded: ${Object.keys(cache).length} pages`)
    } catch { cache = {} }
  }

  const missionList = await getMissionList()
  console.log(`Mission list: ${missionList.length} entries`)

  const results = []
  let fetched = 0
  let cached = 0

  for (let i = 0; i < missionList.length; i++) {
    const { title, level } = missionList[i]

    process.stdout.write(`\r[${i + 1}/${missionList.length}] ${title.slice(0, 55).padEnd(55)} `)

    let wikitext = cache[title]
    if (!wikitext) {
      await sleep(RATE_LIMIT_MS)
      wikitext = await fetchWikitext(title)
      cache[title] = wikitext ?? ''
      fetched++

      if (fetched % 25 === 0) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
        process.stdout.write('(saved) ')
      }
    } else {
      cached++
    }

    if (!wikitext) continue

    const parsed = parseMissionPage(wikitext, level)
    if (!parsed) continue

    // Clean display name: strip trailing "(Level N)" added by wiki disambiguation
    const displayName = title
      .replace(/\s*\(Level \d\)\s*$/i, '')
      .replace(/\s*\(level \d\)\s*$/i, '')
      .trim()

    results.push({
      id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-'),
      name: displayName,
      wikiTitle: title,
      ...parsed,
    })
  }

  // Final cache flush
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  console.log(`\nFetched: ${fetched} new, ${cached} from cache`)

  // Sort by level then name
  results.sort((a, b) => (a.level || 99) - (b.level || 99) || a.name.localeCompare(b.name))

  const output = {
    version: '1.0',
    scraped: new Date().toISOString().split('T')[0],
    count: results.length,
    missions: results,
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2))
  console.log(`Written: ${OUT_FILE}`)
  console.log(`Total missions: ${results.length}`)
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1) })

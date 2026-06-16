import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Copy, Check, Loader2, Save, Trash2, ChevronDown, Share2, X } from 'lucide-react'
import type { EveSkill, EveSkillQueueItem } from '../../types'
import { timeUntil } from '../../lib/eve-esi'

interface EnrichedSkill extends EveSkill { groupName?: string }

interface SkillPanelProps {
  skills: EveSkill[]
  skillQueue: EveSkillQueueItem[]
  loading: boolean
  onRefresh: () => void
  characterId?: number
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

function SkillDots({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-2 border ${
            i < level
              ? 'bg-eve-cyan border-eve-cyan'
              : 'border-eve-dim bg-transparent'
          }`}
        />
      ))}
    </div>
  )
}

function QueueProgress({ item }: { item: EveSkillQueueItem }) {
  let pct = 0
  if (item.startDate && item.finishDate && item.levelStartSp !== undefined && item.levelEndSp !== undefined) {
    const start = new Date(item.startDate).getTime()
    const end = new Date(item.finishDate).getTime()
    const now = Date.now()
    const elapsed = Math.max(0, now - start)
    const duration = end - start
    pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0
  }

  return (
    <div className="w-full bg-eve-border h-1 mt-1">
      <motion.div
        className="h-full bg-eve-cyan"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5 }}
      />
    </div>
  )
}

interface AnalysisResult {
  fitName: string
  _debug?: { parsedNames: string[]; resolvedCount: number; requiredSkillCount: number }
  missingSkills: {
    skillId: number
    skillName: string
    requiredLevel: number
    rank: number
    currentLevel: number
    missing: boolean
    trainingSeconds: number
  }[]
  allRequired: {
    skillId: number
    skillName: string
    requiredLevel: number
    rank: number
    currentLevel: number
    missing: boolean
    trainingSeconds: number
  }[]
  totalTrainingSeconds: number
  trainingTimeFormatted: string
  skillPlanText: string
  itemCount: number
}

interface SavedFit { id: string; name: string; shipType: string; fitText: string; createdAt: string }

function FitAnalyzer({ skills, characterId }: { skills: EveSkill[]; characterId?: number }) {
  const [fitText, setFitText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedFit, setCopiedFit] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const [savedFits, setSavedFits] = useState<SavedFit[]>([])
  // selectedLabel = display value when idle; query = what user types while searching
  const [selectedLabel, setSelectedLabel] = useState('')
  const [selectedFitId, setSelectedFitId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/fits').then(r => r.json()).then(setSavedFits).catch(() => {})
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const filteredFits = savedFits.filter(f =>
    !query || `${f.shipType} ${f.name}`.toLowerCase().includes(query.toLowerCase())
  )

  const isDuplicate = !!fitText.trim() && savedFits.some(f => f.fitText.trim() === fitText.trim())

  async function runAnalysis(text: string) {
    setLoading(true)
    setError(null)
    setResult(null)
    setShowAll(false)
    try {
      const res = await fetch('/api/skills/analyze-fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fitText: text,
          characterId,
          skills: skills.map(s => ({ skillId: s.skillId, trainedLevel: s.trainedLevel, skillpointsInSkill: s.skillpointsInSkill })),
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? `Error ${res.status}`) }
      setResult(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  async function selectFit(fit: SavedFit) {
    const label = `[${fit.shipType}] ${fit.name}`
    setSelectedLabel(label)
    setSelectedFitId(fit.id)
    setQuery('')
    setDropdownOpen(false)
    setFitText(fit.fitText)
    await runAnalysis(fit.fitText)
  }

  async function deleteFit(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/fits/${id}`, { method: 'DELETE' })
    setSavedFits(prev => prev.filter(f => f.id !== id))
  }

  function clearFit() {
    setFitText('')
    setSelectedLabel('')
    setSelectedFitId(null)
    setQuery('')
    setResult(null)
    setError(null)
  }

  async function deleteSelectedFit() {
    if (!selectedFitId) return
    await fetch(`/api/fits/${selectedFitId}`, { method: 'DELETE' })
    setSavedFits(prev => prev.filter(f => f.id !== selectedFitId))
    clearFit()
  }

  async function saveFit() {
    if (!fitText.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/fits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fitText }),
      })
      if (!res.ok) throw new Error('Save failed')
      const fit: SavedFit = await res.json()
      setSavedFits(prev => [...prev, fit])
      setSelectedLabel(`[${fit.shipType}] ${fit.name}`)
    } finally {
      setSaving(false)
    }
  }

  const [sharingId, setSharingId] = useState<string | null>(null)
  const [shareLink, setShareLink] = useState<{ fitId: string; url: string } | null>(null)
  const [importToken, setImportToken] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null)

  async function shareFit(fit: SavedFit, e: React.MouseEvent) {
    e.stopPropagation()
    setSharingId(fit.id)
    setShareLink(null)
    try {
      const r = await fetch('/api/fits/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [fit.id] }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Share failed')
      setShareLink({ fitId: fit.id, url: d.url })
      writeClipboard(d.url)
      setDropdownOpen(false)
    } catch (err) {
      setImportMsg({ text: err instanceof Error ? err.message : 'Share failed', ok: false })
      setTimeout(() => setImportMsg(null), 4000)
    } finally {
      setSharingId(null)
    }
  }

  async function importShare() {
    if (!importToken.trim()) return
    setImporting(true)
    setImportMsg(null)
    try {
      const r = await fetch('/api/fits/import-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: importToken.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Import failed')
      if (d.added === 0) {
        setImportMsg({ text: 'Already have all fits in this link', ok: true })
      } else {
        setImportMsg({ text: `Imported ${d.added} fit${d.added !== 1 ? 's' : ''}`, ok: true })
        setSavedFits(await fetch('/api/fits').then(r => r.json()))
      }
      setImportToken('')
    } catch (err) {
      setImportMsg({ text: err instanceof Error ? err.message : 'Import failed', ok: false })
    } finally {
      setImporting(false)
      setTimeout(() => setImportMsg(null), 5000)
    }
  }

  async function shareCurrent() {
    if (!fitText.trim()) return
    setSharingId('__current__')
    setShareLink(null)
    try {
      const r = await fetch('/api/fits/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fitTexts: [fitText.trim()] }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Share failed')
      setShareLink({ fitId: '__current__', url: d.url })
      writeClipboard(d.url)
    } catch (err) {
      setImportMsg({ text: err instanceof Error ? err.message : 'Share failed', ok: false })
      setTimeout(() => setImportMsg(null), 4000)
    } finally {
      setSharingId(null)
    }
  }

  async function shareAll() {
    if (!savedFits.length) return
    setSharingId('__all__')
    setShareLink(null)
    try {
      const r = await fetch('/api/fits/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: savedFits.map(f => f.id) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Share failed')
      setShareLink({ fitId: '__all__', url: d.url })
      writeClipboard(d.url)
    } catch (err) {
      setImportMsg({ text: err instanceof Error ? err.message : 'Share failed', ok: false })
      setTimeout(() => setImportMsg(null), 4000)
    } finally {
      setSharingId(null)
    }
  }

  async function analyze() {
    if (!fitText.trim()) return
    await runAnalysis(fitText)
  }

  function writeClipboard(text: string) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      navigator.clipboard.writeText(text).catch(() => {})
    }
  }

  function copyFit() {
    if (!fitText.trim()) return
    writeClipboard(fitText)
    setCopiedFit(true)
    setTimeout(() => setCopiedFit(false), 2000)
  }

  function copyPlan() {
    if (!result?.skillPlanText) return
    writeClipboard(result.skillPlanText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displaySkills = showAll ? result?.allRequired : result?.missingSkills

  return (
    <div className="eve-panel p-3 flex flex-col gap-2">
      <div className="eve-header">FIT ANALYZER</div>

      {/* Saved fits dropdown */}
      <div className="relative" ref={dropdownRef}>
        <div className="relative">
          <input
            ref={inputRef}
            className="eve-input w-full text-xs pr-6"
            placeholder={savedFits.length ? `Search ${savedFits.length} saved fits…` : 'No saved fits yet'}
            value={dropdownOpen ? query : selectedLabel}
            onChange={e => { setQuery(e.target.value); setDropdownOpen(true) }}
            onFocus={() => { setQuery(''); setDropdownOpen(true) }}
            spellCheck={false}
          />
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-eve-dim pointer-events-none" />
        </div>
        {dropdownOpen && (
          <div className="absolute z-50 w-full mt-0.5 bg-eve-panel border border-eve-border max-h-48 overflow-y-auto">
            {filteredFits.length === 0 ? (
              <div className="px-2 py-2 text-eve-dim text-xs">No fits match</div>
            ) : filteredFits.map(fit => (
              <div
                key={fit.id}
                className="flex items-center justify-between px-2 py-1.5 hover:bg-eve-border/30 cursor-pointer group"
                onMouseDown={() => selectFit(fit)}
              >
                <div className="min-w-0">
                  <div className="text-eve-text text-xs truncate">{fit.name}</div>
                  <div className="text-eve-dim text-[10px] truncate">{fit.shipType}</div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">
                  <button
                    className="text-eve-dim hover:text-eve-cyan"
                    onMouseDown={e => shareFit(fit, e)}
                    title="Share fit — copies link to clipboard"
                  >
                    {sharingId === fit.id ? <Loader2 size={10} className="animate-spin" /> : <Share2 size={10} />}
                  </button>
                  <button
                    className="text-eve-dim hover:text-eve-red"
                    onMouseDown={e => deleteFit(fit.id, e)}
                    title="Delete fit"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <textarea
        className="eve-input w-full text-xs font-mono resize-none h-36"
        placeholder="Paste EFT fit here…"
        value={fitText}
        onChange={e => { setFitText(e.target.value); setSelectedLabel(''); setSelectedFitId(null) }}
        spellCheck={false}
      />

      <div className="flex gap-2">
        <button
          className="eve-btn text-xs py-1.5 flex items-center justify-center gap-1.5 px-3 flex-shrink-0"
          onClick={saveFit}
          disabled={saving || !fitText.trim() || isDuplicate}
          title={isDuplicate ? 'Fit already in database' : 'Save fit to database'}
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          {isDuplicate ? 'SAVED' : 'SAVE'}
        </button>
        <button
          className="eve-btn text-xs py-1.5 flex items-center justify-center gap-1.5 px-3 flex-shrink-0"
          onClick={clearFit}
          disabled={!fitText && !result}
          title="Clear fit"
        >
          CLEAR
        </button>
        {fitText.trim() && (
          <button
            className="eve-btn text-xs py-1.5 flex items-center justify-center gap-1.5 px-3 flex-shrink-0"
            onClick={shareCurrent}
            disabled={sharingId === '__current__'}
            title="Share current fit — copies link to clipboard"
          >
            {sharingId === '__current__' ? <Loader2 size={11} className="animate-spin" /> : <Share2 size={11} />}
            SHARE
          </button>
        )}
        {selectedFitId && (
          <button
            className="eve-btn text-xs py-1.5 flex items-center justify-center gap-1.5 px-3 flex-shrink-0 text-eve-red hover:border-eve-red"
            onClick={deleteSelectedFit}
            title="Delete this saved fit"
          >
            <Trash2 size={11} />
            DELETE
          </button>
        )}
        <button
          className="eve-btn-primary flex-1 text-xs py-1.5 flex items-center justify-center gap-2"
          onClick={analyze}
          disabled={loading || !fitText.trim()}
        >
          {loading && <Loader2 size={11} className="animate-spin" />}
          {loading ? 'ANALYZING…' : 'ANALYZE FIT'}
        </button>
      </div>

      {/* Share all fits */}
      <button
        className="eve-btn text-[10px] py-1 px-2 flex items-center gap-1.5 w-full justify-center"
        onClick={shareAll}
        disabled={sharingId === '__all__' || savedFits.length === 0}
        title="Generate a share link for all saved fits"
      >
        {sharingId === '__all__' ? <Loader2 size={10} className="animate-spin" /> : <Share2 size={10} />}
        SHARE ALL FITS
      </button>

      {/* Share link display */}
      {shareLink && (
        <div className="flex items-center gap-2 border border-eve-cyan/30 bg-eve-cyan/5 px-2 py-1.5">
          <span className="text-[10px] text-eve-cyan shrink-0">LINK COPIED</span>
          <span className="flex-1 text-[10px] text-eve-muted font-mono truncate">{shareLink.url}</span>
          <button
            className="text-eve-dim hover:text-eve-cyan shrink-0"
            onClick={() => { writeClipboard(shareLink.url); }}
            title="Copy again"
          ><Copy size={10} /></button>
          <button className="text-eve-dim hover:text-eve-muted shrink-0" onClick={() => setShareLink(null)}><X size={10} /></button>
        </div>
      )}

      {/* Import from share link */}
      <div className="flex gap-2 items-center">
        <input
          className="eve-input flex-1 text-[11px] py-1"
          placeholder="Paste share link or token to import…"
          value={importToken}
          onChange={e => setImportToken(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && importShare()}
        />
        <button
          className="eve-btn text-[10px] py-1 px-2 shrink-0"
          onClick={importShare}
          disabled={importing || !importToken.trim()}
        >
          {importing ? <Loader2 size={10} className="animate-spin" /> : '↓'} IMPORT
        </button>
      </div>
      {importMsg && (
        <div className={`text-[10px] ${importMsg.ok ? 'text-eve-green' : 'text-eve-red'}`}>{importMsg.text}</div>
      )}

      {error && <div className="text-eve-red text-xs">{error}</div>}

      {result && (
        <div className="flex flex-col gap-2 pt-1">
          {/* Summary */}
          <div className="border border-eve-border/50 p-2 space-y-1">
            <div className="text-eve-cyan text-xs font-mono truncate">{result.fitName}</div>
            <div className="flex justify-between text-xs">
              <span className="text-eve-muted">{result.allRequired.length} skills required</span>
              <span className={result.missingSkills.length > 0 ? 'text-eve-red' : 'text-eve-green'}>
                {result.missingSkills.length === 0 ? '✓ ALL SKILLS MET' : `${result.missingSkills.length} MISSING`}
              </span>
            </div>
            {result.missingSkills.length > 0 && (
              <div className="text-eve-gold text-xs">
                Est. training: <span className="font-mono">{result.trainingTimeFormatted}</span>
                <span className="text-eve-dim ml-1">(~2500 SP/hr)</span>
              </div>
            )}
          </div>

          {/* Toggle missing / all */}
          <div className="flex gap-2">
            <button
              className={`text-[10px] px-2 py-0.5 border transition-colors ${!showAll ? 'border-eve-cyan text-eve-cyan' : 'border-eve-dim text-eve-dim'}`}
              onClick={() => setShowAll(false)}
            >
              MISSING ({result.missingSkills.length})
            </button>
            <button
              className={`text-[10px] px-2 py-0.5 border transition-colors ${showAll ? 'border-eve-cyan text-eve-cyan' : 'border-eve-dim text-eve-dim'}`}
              onClick={() => setShowAll(true)}
            >
              ALL ({result.allRequired.length})
            </button>
          </div>

          {/* Skill list */}
          <div className="space-y-0.5">
            {displaySkills?.length === 0 && (
              <div className="text-eve-muted text-xs text-center py-2">No skills to show</div>
            )}
            {displaySkills?.map(s => (
              <div
                key={s.skillId}
                className={`flex items-center justify-between py-0.5 text-xs border-b border-eve-border/20 ${s.missing ? '' : 'opacity-50'}`}
              >
                <span className={`truncate flex-1 mr-2 ${s.missing ? 'text-eve-text' : 'text-eve-muted'}`}>
                  {s.skillName}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.missing && s.currentLevel > 0 && (
                    <span className="text-eve-dim text-[10px]">{ROMAN[s.currentLevel]}→</span>
                  )}
                  <span className={`font-mono ${s.missing ? 'text-eve-red' : 'text-eve-cyan'}`}>
                    {ROMAN[s.requiredLevel]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Copy skill plan / fit */}
          <button
            className="eve-btn w-full text-xs py-1.5 flex items-center justify-center gap-2"
            onClick={result.missingSkills.length > 0 ? copyPlan : copyFit}
          >
            {(copied || copiedFit) ? <Check size={11} className="text-eve-green" /> : <Copy size={11} />}
            {(copied || copiedFit) ? 'COPIED!' : result.missingSkills.length > 0 ? 'COPY SKILL PLAN' : 'COPY FIT'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function SkillPanel({ skills, skillQueue, loading, onRefresh, characterId }: SkillPanelProps) {
  const [enrichedSkills, setEnrichedSkills] = useState<EnrichedSkill[]>([])
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!characterId) { setEnrichedSkills(skills); return }
    let cancelled = false
    const doFetch = () =>
      fetch(`/api/skills/${characterId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (cancelled) return
          if (data?.skills?.length) setEnrichedSkills(data.skills)
          else setEnrichedSkills(skills)
        })
        .catch(() => { if (!cancelled) setEnrichedSkills(skills) })

    doFetch()
    // Re-fetch after 8s to pick up async group resolution that may still be running
    const retry = setTimeout(doFetch, 8000)
    return () => { cancelled = true; clearTimeout(retry) }
  }, [characterId, skills])

  const grouped = new Map<string, EnrichedSkill[]>()
  for (const s of enrichedSkills) {
    const g = s.groupName ?? 'Other'
    if (!grouped.has(g)) grouped.set(g, [])
    grouped.get(g)!.push(s)
  }
  const sortedGroups = [...grouped.keys()].sort()

  function toggleGroup(g: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="eve-header mb-0">SKILL OVERVIEW</span>
        <button onClick={onRefresh} className="eve-btn p-1" title="Refresh">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-2 gap-3 items-start">
        {/* Left — queue + trained skills */}
        <div className="flex flex-col gap-3">
          <div className="eve-panel p-3">
            <div className="eve-header">TRAINING QUEUE</div>
            {skillQueue.length === 0 ? (
              <div className="text-eve-muted text-xs text-center py-3">QUEUE EMPTY</div>
            ) : (
              <div className="space-y-2">
                {skillQueue.slice(0, 6).map((item, i) => (
                  <div key={item.skillId + item.finishedLevel + i} className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-eve-dim text-xs w-4">{item.queuePosition + 1}.</span>
                        <span className="text-eve-text text-xs truncate max-w-[110px]">{item.skillName}</span>
                        <span className="text-eve-cyan text-xs">{ROMAN[item.finishedLevel]}</span>
                      </div>
                      <span className="text-eve-muted text-[10px]">
                        {item.finishDate ? timeUntil(item.finishDate) : '—'}
                      </span>
                    </div>
                    {i === 0 && <QueueProgress item={item} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="eve-panel p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="eve-header mb-0">TRAINED SKILLS</div>
              <div className="flex gap-2">
                {[5, 4, 3, 2, 1, 0].map(lvl => {
                  const count = enrichedSkills.filter(s => s.trainedLevel === lvl).length
                  if (!count) return null
                  return (
                    <span key={lvl} className="text-[10px] text-eve-muted">
                      <span className="text-eve-cyan">{lvl === 0 ? '0' : ROMAN[lvl]}</span> {count}
                    </span>
                  )
                })}
              </div>
            </div>
            <div className="space-y-0.5">
              {sortedGroups.map(group => {
                const groupSkills = grouped.get(group)!.slice().sort((a, b) => a.skillName.localeCompare(b.skillName))
                const isOpen = openGroups.has(group)
                return (
                  <div key={group}>
                    <button
                      onClick={() => toggleGroup(group)}
                      className="w-full flex items-center justify-between py-1 text-left hover:bg-eve-border/20 px-1"
                    >
                      <span className="text-eve-cyan text-xs font-medium">{group}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-eve-muted text-[10px]">{groupSkills.length}</span>
                        <ChevronDown size={10} className={`text-eve-dim transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="ml-2 space-y-0.5 mb-1">
                        {groupSkills.map(skill => (
                          <div key={skill.skillId} className="flex items-center justify-between py-0.5 border-b border-eve-border/20">
                            <span className="text-eve-text text-xs truncate flex-1 mr-2">{skill.skillName}</span>
                            <SkillDots level={skill.trainedLevel} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right — fit analyzer */}
        <FitAnalyzer skills={skills} characterId={characterId} />
      </div>
    </div>
  )
}

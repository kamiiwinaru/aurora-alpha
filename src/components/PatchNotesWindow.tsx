import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import changelogRaw from '../../CHANGELOG.md?raw'

interface Props {
  open: boolean
  onClose: () => void
}

interface Section {
  version: string
  date: string
  groups: { label: string; items: string[] }[]
}

function parseChangelog(raw: string): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  let currentGroup: { label: string; items: string[] } | null = null

  for (const line of raw.split('\n')) {
    const versionMatch = line.match(/^## \[(.+?)\] — (.+)/)
    if (versionMatch) {
      if (currentGroup && current) current.groups.push(currentGroup)
      currentGroup = null
      if (current) sections.push(current)
      current = { version: versionMatch[1], date: versionMatch[2], groups: [] }
      continue
    }
    if (!current) continue

    const groupMatch = line.match(/^### (.+)/)
    if (groupMatch) {
      if (currentGroup) current.groups.push(currentGroup)
      currentGroup = { label: groupMatch[1], items: [] }
      continue
    }

    const itemMatch = line.match(/^- (.+)/)
    if (itemMatch && currentGroup) {
      currentGroup.items.push(itemMatch[1])
    }
  }

  if (currentGroup && current) current.groups.push(currentGroup)
  if (current) sections.push(current)

  return sections
}

function renderItem(text: string) {
  // Convert **bold** to styled spans
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <span key={i} className="text-eve-cyan font-semibold">{p.slice(2, -2)}</span>
    }
    return <span key={i}>{p}</span>
  })
}

const GROUP_COLORS: Record<string, string> = {
  Added: 'text-eve-green',
  Changed: 'text-eve-gold',
  Fixed: 'text-eve-cyan',
  Removed: 'text-eve-red',
}

export default function PatchNotesWindow({ open, onClose }: Props) {
  const sections = useRef(parseChangelog(changelogRaw)).current
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={e => { if (e.target === overlayRef.current) onClose() }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          <motion.div
            className="relative z-10 w-[680px] max-h-[80vh] flex flex-col eve-panel border border-eve-border shadow-2xl"
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            {/* Corner brackets */}
            <span className="absolute top-1 left-1 text-eve-cyan text-[10px] leading-none opacity-50 select-none">◤</span>
            <span className="absolute top-1 right-1 text-eve-cyan text-[10px] leading-none opacity-50 select-none">◥</span>
            <span className="absolute bottom-1 left-1 text-eve-cyan text-[10px] leading-none opacity-50 select-none">◣</span>
            <span className="absolute bottom-1 right-1 text-eve-cyan text-[10px] leading-none opacity-50 select-none">◢</span>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-eve-border shrink-0">
              <div>
                <div className="text-eve-cyan text-glow-cyan text-sm tracking-widest font-mono uppercase">
                  PATCH NOTES
                </div>
                <div className="text-eve-muted text-[10px] mt-0.5">
                  AURORA · CAPSULEER INTELLIGENCE SYSTEM
                </div>
              </div>
              <button onClick={onClose} className="text-eve-muted hover:text-eve-red transition-colors p-1">
                <X size={14} />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
              {sections.map((section, si) => (
                <div key={section.version}>
                  {/* Version header */}
                  <div className={`flex items-baseline gap-3 mb-3 ${si === 0 ? '' : 'pt-2 border-t border-eve-border'}`}>
                    <span className={`font-mono text-base font-bold ${si === 0 ? 'text-eve-cyan text-glow-cyan' : 'text-eve-muted'}`}>
                      v{section.version}
                    </span>
                    {si === 0 && (
                      <span className="text-[9px] bg-eve-cyan/20 text-eve-cyan border border-eve-cyan/40 px-1.5 py-0.5 uppercase tracking-widest font-mono">
                        CURRENT
                      </span>
                    )}
                    <span className="text-eve-dim text-[10px] font-mono ml-auto">{section.date}</span>
                  </div>

                  {/* Groups */}
                  {section.groups.map(group => (
                    <div key={group.label} className="mb-3">
                      <div className={`text-[10px] uppercase tracking-widest font-mono mb-1.5 ${GROUP_COLORS[group.label] ?? 'text-eve-muted'}`}>
                        {group.label}
                      </div>
                      <ul className="space-y-1">
                        {group.items.map((item, ii) => (
                          <li key={ii} className="flex gap-2 text-[11px] text-eve-muted leading-relaxed">
                            <span className="text-eve-border mt-0.5 shrink-0">›</span>
                            <span>{renderItem(item)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-2 border-t border-eve-border shrink-0 flex justify-between items-center">
              <span className="text-eve-dim text-[9px] font-mono">AURORA INTELLIGENCE SYSTEM</span>
              <button
                onClick={onClose}
                className="eve-btn text-[10px] px-3 py-1"
              >
                CLOSE
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

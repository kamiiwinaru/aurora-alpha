import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, MessageSquare, ChevronRight, ListTodo, Eraser } from 'lucide-react'
import Aurora from './Aurora'
import type { Conversation } from '../types'

interface SidebarProps {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onClearAll: () => void
  darkMode: boolean
  onToggleDark: () => void
  onOpenRoadmap: () => void
  roadmapActive: boolean
  isSpeaking: boolean
  characterName?: string
  voiceEnabled: boolean
  onToggleVoice: () => void
  showVoiceToggle?: boolean
  autoListenTrigger: number
  onVoiceQuery: (text: string) => void
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onClearAll,
  darkMode,
  onToggleDark,
  onOpenRoadmap,
  roadmapActive,
  isSpeaking,
  characterName,
  voiceEnabled,
  onToggleVoice,
  showVoiceToggle,
  autoListenTrigger,
  onVoiceQuery,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <motion.aside
      className="eve-panel flex flex-col border-r border-eve-border relative"
      animate={{ width: collapsed ? 48 : 220 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-eve-border">
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="eve-label text-eve-cyan tracking-widest"
            >
              SESSION LOG
            </motion.span>
          )}
        </AnimatePresence>
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-eve-muted hover:text-eve-cyan transition-colors ml-auto"
        >
          <motion.div animate={{ rotate: collapsed ? 0 : 180 }}>
            <ChevronRight size={14} />
          </motion.div>
        </button>
      </div>

      {/* New chat button */}
      <div className="px-2 py-2 border-b border-eve-border flex gap-1">
        <button
          onClick={onNew}
          className="flex-1 eve-btn-primary flex items-center gap-2 justify-center"
        >
          <Plus size={12} />
          {!collapsed && <span>NEW SESSION</span>}
        </button>
        {!collapsed && (
          <button
            onClick={onClearAll}
            title="Clear all sessions"
            className="eve-btn flex items-center justify-center px-2 text-eve-muted hover:text-eve-red hover:border-eve-red/40 transition-colors"
          >
            <Eraser size={12} />
          </button>
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        <AnimatePresence>
          {conversations.map(convo => (
            <motion.div
              key={convo.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={`
                group relative flex items-center gap-2 px-2 py-2 cursor-pointer transition-all duration-150
                ${activeId === convo.id
                  ? 'bg-eve-cyan/10 border-l-2 border-eve-cyan'
                  : 'hover:bg-eve-border/30 border-l-2 border-transparent'
                }
              `}
              onClick={() => onSelect(convo.id)}
              onMouseEnter={() => setHoveredId(convo.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <MessageSquare
                size={12}
                className={activeId === convo.id ? 'text-eve-cyan' : 'text-eve-muted'}
              />
              {!collapsed && (
                <>
                  <span className={`flex-1 text-xs truncate ${activeId === convo.id ? 'text-eve-text' : 'text-eve-muted'}`}>
                    {convo.title}
                  </span>
                  <AnimatePresence>
                    {hoveredId === convo.id && (
                      <motion.button
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={e => { e.stopPropagation(); onDelete(convo.id) }}
                        className="text-eve-muted hover:text-eve-red transition-colors"
                      >
                        <Trash2 size={11} />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Aurora avatar */}
      {!collapsed && (
        <div className="border-t border-eve-border">
          <Aurora
            isSpeaking={isSpeaking}
            characterName={characterName}
            voiceEnabled={voiceEnabled}
            onToggleVoice={onToggleVoice}
            showVoiceToggle={showVoiceToggle}
            autoListenTrigger={autoListenTrigger}
            onVoiceQuery={onVoiceQuery}
          />
        </div>
      )}

      {/* Bottom controls */}
      <div className="border-t border-eve-border px-2 py-2 flex flex-col gap-1">
        <button
          onClick={onOpenRoadmap}
          title="Roadmap"
          className={`w-full eve-btn flex items-center gap-2 justify-center transition-colors
            ${roadmapActive ? 'border-eve-cyan/60 text-eve-cyan bg-eve-cyan/10' : ''}`}
        >
          <ListTodo size={12} />
          {!collapsed && <span>ROADMAP</span>}
        </button>
      </div>
    </motion.aside>
  )
}

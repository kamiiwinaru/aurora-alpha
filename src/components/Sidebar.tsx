import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, MessageSquare, ChevronRight, ListTodo, Eraser } from 'lucide-react'
import Aurora from './Aurora'
import SpotifyPanel from './SpotifyPanel'
import { isSpotifyConnected } from '../lib/spotify/client'
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

function SpotifyLogoSm() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )
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
  const [collapsed, setCollapsed]       = useState(false)
  const [hoveredId, setHoveredId]       = useState<string | null>(null)
  const [spotifyOpen, setSpotifyOpen]   = useState(false)
  const [spotifyConn, setSpotifyConn]   = useState(isSpotifyConnected)
  const spotifyBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onConn() { setSpotifyConn(true) }
    function onDisc() { setSpotifyConn(false) }
    window.addEventListener('aurora_spotify_connected', onConn)
    window.addEventListener('aurora_spotify_disconnected', onDisc)
    return () => {
      window.removeEventListener('aurora_spotify_connected', onConn)
      window.removeEventListener('aurora_spotify_disconnected', onDisc)
    }
  }, [])


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

      {/* Spotify control */}
      <div className="border-t border-eve-border px-2 py-1.5 flex items-center gap-2">
        <button
          ref={spotifyBtnRef}
          onClick={() => setSpotifyOpen(v => !v)}
          title="Spotify"
          className={`flex items-center gap-2 w-full px-1.5 py-1 rounded-sm transition-colors text-left ${
            spotifyOpen
              ? 'text-[#1DB954] bg-[#1DB954]/10'
              : 'text-eve-muted hover:text-[#1DB954] hover:bg-[#1DB954]/8'
          }`}
        >
          <span className="relative shrink-0">
            <SpotifyLogoSm />
            <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-eve-panel ${
              spotifyConn ? 'bg-[#1DB954]' : 'bg-eve-border'
            }`} />
          </span>
          {!collapsed && <span className="eve-label text-[9px] tracking-widest">SPOTIFY</span>}
        </button>
      </div>

      <SpotifyPanel
        anchorRef={spotifyBtnRef as React.RefObject<HTMLElement>}
        open={spotifyOpen}
        onClose={() => setSpotifyOpen(false)}
      />

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

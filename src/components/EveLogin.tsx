import { motion } from 'framer-motion'
import { LogIn, LogOut, RefreshCw, User, AlertTriangle, UserPlus, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { EveCharacter } from '../types'
import { getEveLoginUrl } from '../lib/eve-esi'

interface EveLoginProps {
  character: EveCharacter | null
  characters: EveCharacter[]
  loading: boolean
  error: string | null
  onLogout: (characterId?: number) => void
  onRefresh: () => void
  onSwitch: (characterId: number) => void
}

export default function EveLogin({ character, characters, loading, error, onLogout, onRefresh, onSwitch }: EveLoginProps) {
  const [showSwitcher, setShowSwitcher] = useState(false)

  const handleLogin = () => {
    const url = getEveLoginUrl()
    window.location.href = url
  }

  if (character) {
    return (
      <div className="eve-panel p-3 flex flex-col gap-2">
        <div className="eve-header">PILOT STATUS</div>

        {/* Active character row */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-eve-cyan/10 border border-eve-cyan/30 flex items-center justify-center">
            <User size={14} className="text-eve-cyan" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-eve-text text-xs truncate">{character.characterName}</div>
            <div className="text-eve-muted text-[10px]">ID: {character.characterId}</div>
          </div>
          <div className="flex gap-1">
            {characters.length > 1 && (
              <button
                onClick={() => setShowSwitcher(v => !v)}
                className="eve-btn p-1"
                title="Switch character"
              >
                <ChevronDown size={10} className={showSwitcher ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            )}
            <button onClick={onRefresh} className="eve-btn p-1" title="Refresh data">
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => onLogout()} className="eve-btn-danger p-1" title="Log out">
              <LogOut size={10} />
            </button>
          </div>
        </div>

        {/* Character switcher */}
        {showSwitcher && characters.length > 1 && (
          <div className="flex flex-col gap-1 border border-eve-cyan/20 p-1.5">
            {characters.filter(c => c.characterId !== character.characterId).map(c => (
              <div key={c.characterId} className="flex items-center gap-2">
                <button
                  onClick={() => { onSwitch(c.characterId); setShowSwitcher(false) }}
                  className="flex-1 text-left eve-btn px-2 py-1 text-[10px] truncate"
                >
                  {c.characterName}
                </button>
                <button
                  onClick={() => onLogout(c.characterId)}
                  className="eve-btn-danger p-1 shrink-0"
                  title={`Remove ${c.characterName}`}
                >
                  <LogOut size={8} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-1.5 text-eve-orange text-[10px]">
            <AlertTriangle size={10} />
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-eve-green"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-eve-green text-[10px] tracking-widest">ESI CONNECTED</span>
          </div>
          <button
            onClick={handleLogin}
            className="eve-btn p-1 flex items-center gap-1"
            title="Add another character"
          >
            <UserPlus size={10} />
            <span className="text-[9px]">ADD</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="eve-panel p-3 flex flex-col gap-2">
      <div className="eve-header">PILOT AUTHENTICATION</div>
      <div className="text-eve-muted text-xs leading-relaxed">
        Connect your EVE Online character to unlock skill tracking, industry monitoring, asset management, and market operations.
      </div>
      <button
        onClick={handleLogin}
        className="eve-btn-primary flex items-center gap-2 justify-center py-2"
      >
        <LogIn size={12} />
        <span>LOGIN WITH EVE ONLINE</span>
      </button>
      <div className="text-eve-dim text-[9px] text-center">
        Secured via EVE SSO · OAuth 2.0
      </div>
    </div>
  )
}

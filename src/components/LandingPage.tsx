import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LogIn, LogOut, ExternalLink, RefreshCw, Shield, Zap, TrendingUp, MapPin, Cpu, Star, MessageSquare, Radio, UserPlus, Mic, X, Package, ChevronDown, ChevronUp } from 'lucide-react'
import OptionsMenu from './OptionsMenu'
import FeedbackModal from './FeedbackModal'
import type { EveCharacter, EveSkill, EveShipLocation, EveCharacterAttributes, EveMail, EveMailLabel, EveContract, EveNotification, EveWalletTransaction, EveWalletJournalEntry } from '../types'
import { renderMessage } from '../lib/intel-highlight'
import { useVoiceInput, type VoicePhase } from '../hooks/useVoiceInput'

import AURORA_IMG from '../assets/Aurora1.png'

function AuroraImageCorner() {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="w-full h-full bg-gradient-to-b from-[#0a1628] to-[#030810] flex items-center justify-center">
        <svg viewBox="0 0 100 120" className="w-14 h-16 text-eve-cyan/40" fill="currentColor">
          <ellipse cx="50" cy="35" rx="20" ry="23" />
          <path d="M20 120 Q20 75 50 70 Q80 75 80 120Z" />
        </svg>
      </div>
    )
  }
  return <img src={AURORA_IMG} alt="Aurora" className="w-full h-full object-cover object-top" onError={() => setFailed(true)} />
}
import { getEveLoginUrl, resolveIds, formatISK } from '../lib/eve-esi'
import ContractDetailWindow, { CONTRACT_TYPE_ABBR, CONTRACT_STATUS_COLOR, contractDaysLeft } from './panels/ContractDetailWindow'
import WalletWindow from './panels/WalletWindow'

interface Props {
  character: EveCharacter | null
  characters: EveCharacter[]
  skills: EveSkill[]
  walletBalance: number
  walletTransactions: EveWalletTransaction[]
  walletJournal: EveWalletJournalEntry[]
  allWalletBalances: Record<number, number>
  allWalletJournals: Record<number, EveWalletJournalEntry[]>
  allWalletTransactions: Record<number, EveWalletTransaction[]>
  securityStatus: number
  shipLocation: EveShipLocation | null
  attributes: EveCharacterAttributes | null
  loading: boolean
  isSpeaking: boolean
  voiceEnabled?: boolean
  autoListenTrigger?: number
  onEnter: () => void
  onOpenComms: () => void
  onVoiceQuery?: (text: string) => void
  onRefresh: () => void
  mail?: EveMail[]
  mailLabels?: EveMailLabel[]
  notifications?: EveNotification[]
  contracts?: EveContract[]
  onOpenNotifications?: (mailId?: number) => void
  onLogout?: () => void
  onSwitchCharacter?: (id: number) => void
  darkMode?: boolean
  onToggleDark?: () => void
  onFeedback?: () => void
}

// ── Portrait (size must be 64 | 128 | 256 | 512) ──────────────────────────────
function PortraitFrame({ characterId, size, displaySize, className = '' }: {
  characterId: number
  size: 64 | 128 | 256 | 512
  displaySize: number
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  return (
    <div
      className={`relative overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: displaySize, height: displaySize }}
    >
      {/* Placeholder while loading */}
      {!loaded && !errored && (
        <div className="absolute inset-0 bg-eve-border/20 flex items-center justify-center">
          <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }}>
            <Cpu size={displaySize / 6} className="text-eve-cyan/40" />
          </motion.div>
        </div>
      )}

      {!errored ? (
        <img
          src={`https://images.evetech.net/characters/${characterId}/portrait?size=${size}`}
          alt="Character portrait"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          crossOrigin="anonymous"
        />
      ) : (
        /* Fallback if image fails */
        <div className="absolute inset-0 bg-gradient-to-b from-eve-dim to-eve-black flex items-center justify-center">
          <div className="text-eve-cyan/20 text-4xl font-mono">◈</div>
        </div>
      )}

      {/* Corner brackets */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-eve-cyan" />
        <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-eve-cyan" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-eve-cyan" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-eve-cyan" />
      </div>

      {/* Scan line sweep */}
      <motion.div
        className="absolute inset-x-0 pointer-events-none"
        style={{ height: 2, background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.4), transparent)' }}
        animate={{ top: ['0%', '100%'] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear', repeatDelay: 2 }}
      />
    </div>
  )
}

function MiniPortrait({ characterId, characterName, isActive, onClick }: {
  characterId: number
  characterName: string
  isActive: boolean
  onClick: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      title={characterName}
      className={`relative overflow-hidden shrink-0 transition-all ${isActive ? 'ring-2 ring-eve-cyan ring-offset-1 ring-offset-eve-black' : 'opacity-60 hover:opacity-90'}`}
      style={{ width: 48, height: 48 }}
    >
      {!loaded && (
        <div className="absolute inset-0 bg-eve-border/20 flex items-center justify-center">
          <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }}>
            <Cpu size={14} className="text-eve-cyan/40" />
          </motion.div>
        </div>
      )}
      <img
        src={`https://images.evetech.net/characters/${characterId}/portrait?size=64`}
        alt={characterName}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        crossOrigin="anonymous"
      />
      {/* Active indicator */}
      {isActive && (
        <div className="absolute bottom-0 inset-x-0 h-0.5 bg-eve-cyan" />
      )}
      {/* Corner brackets — smaller */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t border-l border-eve-cyan/70" />
        <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t border-r border-eve-cyan/70" />
        <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b border-l border-eve-cyan/70" />
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b border-r border-eve-cyan/70" />
      </div>
    </motion.button>
  )
}

function LogoFrame({ url, label, size = 72 }: { url: string; label: string; size?: number }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative border border-eve-border/60 bg-eve-border/10 overflow-hidden" style={{ width: size, height: size }}>
        {!loaded && <div className="absolute inset-0 bg-eve-border/20 animate-pulse" />}
        <img
          src={url}
          alt={label}
          className={`w-full h-full object-contain p-1.5 transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          crossOrigin="anonymous"
        />
      </div>
      <span className="text-eve-dim text-[9px] tracking-widest uppercase text-center leading-tight" style={{ maxWidth: size }}>
        {label}
      </span>
    </div>
  )
}

function StatBlock({ icon, label, value, sub, color = 'text-eve-cyan' }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="eve-panel p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={color}>{icon}</span>
        <span className="text-eve-dim text-[9px] tracking-widest uppercase">{label}</span>
      </div>
      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
      {sub && <div className="text-eve-muted text-[10px] truncate">{sub}</div>}
    </div>
  )
}

function ExternalLinkBtn({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="eve-btn flex items-center gap-1.5 text-[10px] hover:border-eve-cyan/60 hover:text-eve-cyan transition-all"
    >
      <span className="tracking-widest">{label}</span>
      <ExternalLink size={9} className="text-eve-dim shrink-0" />
    </a>
  )
}

function secColor(sec: number) {
  if (sec >= 5.0) return 'text-[#2ecc71]'
  if (sec >= 4.0) return 'text-[#00ff00]'
  if (sec >= 3.0) return 'text-[#adff2f]'
  if (sec >= 2.0) return 'text-[#ffff00]'
  if (sec >= 1.0) return 'text-[#ffa500]'
  if (sec >= 0.0) return 'text-[#ff4500]'
  return 'text-[#ff0000]'
}

// ── Aurora corner model ───────────────────────────────────────────────────────
function AuroraCorner({ isSpeaking, phase, wakeArmed, isListening, isSupported, onToggleWake, onToggleMic, onOpenComms }: {
  isSpeaking: boolean
  phase: VoicePhase
  wakeArmed: boolean
  isListening: boolean
  isSupported: boolean
  onToggleWake: () => void
  onToggleMic: () => void
  onOpenComms: () => void
}) {
  const voiceActive = isSpeaking || isListening || phase === 'activated'
  const listening = isListening || phase === 'activated'

  const statusLabel =
    isSpeaking      ? 'TRANSMITTING' :
    phase === 'pending'   ? 'PROCESSING' :
    phase === 'listening' ? 'LISTENING' :
    phase === 'activated' ? 'ACTIVATED' :
    phase === 'standby'   ? 'STANDBY' :
    'ONLINE'

  const dotColor =
    isSpeaking            ? '#00d4ff' :
    phase === 'pending'   ? '#ffd700' :
    phase === 'listening' ? '#ff4444' :
    phase === 'activated' ? '#00d4ff' :
    phase === 'standby'   ? '#ffd700' :
    '#33cc66'

  const ringColor =
    isSpeaking || phase === 'activated' ? 'border-eve-cyan/50' :
    listening ? 'border-eve-red/40' :
    'border-eve-gold/40'

  // Generate a contextual greeting line (stable across renders)
  const greeting = (() => {
    if (isSpeaking) return 'Transmitting...'
    if (phase === 'listening' || phase === 'activated') return 'Listening...'
    if (phase === 'standby') return 'Listening for "Aurora"...'
    const blurbs = [
      'Intelligence feeds are active. New Eden awaits your command.',
      'All systems nominal. Your empire won\'t build itself.',
      'ESI uplink stable. Ready to dig into your data.',
      'Capsuleer network online. Where are we headed today?',
      'Tactical overlay loaded. The stars are yours to chart.',
      'Standing by for orders. Markets, skills, or killmails?',
      'Neural interface synced. Let\'s make some ISK.',
      'Deep space telemetry active. What\'s the play, Commander?',
      'Fleet intelligence standing by. The cluster never sleeps.',
      'Warp drives spooled. Awaiting your next move.',
    ]
    return `Welcome, Commander. ${blurbs[Math.floor(Math.random() * blurbs.length)]}`
  })()

  return (
    <div className="flex flex-col items-start gap-3">
      {/* Speech bubble */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        onClick={onOpenComms}
        className="group relative max-w-[220px] text-left"
        title="Open Comms"
      >
        <div className="border border-eve-cyan/30 bg-eve-cyan/5 hover:bg-eve-cyan/10 hover:border-eve-cyan/60 transition-all px-3 py-2 relative">
          <div
            className="absolute -bottom-[7px] left-5 w-3 h-3 border-b border-l border-eve-cyan/30 bg-eve-black"
            style={{ transform: 'rotate(-45deg)', clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }}
          />
          <p className="text-eve-cyan/80 text-[10px] font-mono leading-relaxed pr-4">{greeting}</p>
          <div className="flex items-center gap-1 mt-1.5">
            <MessageSquare size={8} className="text-eve-cyan/40" />
            <span className="text-eve-dim text-[8px] tracking-widest group-hover:text-eve-cyan/60 transition-colors">OPEN COMMS</span>
          </div>
        </div>
      </motion.button>

      {/* Aurora avatar */}
      <div className="relative flex items-center justify-center" style={{ width: 100, height: 100 }}>
        {/* Ambient outer ring */}
        <motion.div
          className="absolute inset-0 rounded-full border border-eve-cyan/15"
          animate={{ scale: [1, 1.06, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 3, repeat: Infinity }}
        />

        {/* Active pulse rings */}
        <AnimatePresence>
          {voiceActive && [0, 1, 2].map(i => (
            <motion.div
              key={i}
              className={`absolute inset-0 rounded-full border ${ringColor}`}
              initial={{ scale: 0.9, opacity: 0.8 }}
              animate={{ scale: 1.6 + i * 0.25, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.3, ease: 'easeOut' }}
            />
          ))}
        </AnimatePresence>

        {/* Avatar circle */}
        <motion.div
          className="relative rounded-full overflow-hidden border-2 z-10"
          style={{ width: 76, height: 76 }}
          animate={{
            borderColor: voiceActive
              ? (isSpeaking || phase === 'activated') ? '#00d4ff' : '#ffd700'
              : '#1a2332',
            boxShadow: voiceActive
              ? (isSpeaking || phase === 'activated')
                ? ['0 0 20px rgba(0,212,255,0.5)', '0 0 40px rgba(0,212,255,0.8)', '0 0 20px rgba(0,212,255,0.5)']
                : ['0 0 20px rgba(255,215,0,0.4)', '0 0 35px rgba(255,215,0,0.6)', '0 0 20px rgba(255,215,0,0.4)']
              : ['0 0 12px rgba(0,212,255,0.1)', '0 0 22px rgba(0,212,255,0.18)', '0 0 12px rgba(0,212,255,0.1)'],
          }}
          transition={{ duration: voiceActive ? 0.7 : 3, repeat: Infinity }}
        >
          <div className="w-full h-full relative overflow-hidden">
            <AuroraImageCorner />
            <motion.div
              className="absolute inset-x-0 pointer-events-none"
              style={{ height: '35%', background: 'linear-gradient(180deg, transparent, rgba(0,212,255,0.07), transparent)' }}
              animate={{ y: ['-100%', '300%'] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', repeatDelay: 2 }}
            />
          </div>
        </motion.div>

        {/* Corner brackets */}
        <div className="absolute inset-0 z-20 pointer-events-none" style={{ inset: '12px' }}>
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-eve-cyan/50" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-eve-cyan/50" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-eve-cyan/50" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-eve-cyan/50" />
        </div>
      </div>

      {/* Status + controls */}
      <div className="flex items-center gap-2 -mt-1 pl-1 w-full">
        <motion.div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: voiceActive ? 0.5 : 2, repeat: Infinity }}
        />
        <span className="text-eve-cyan text-[9px] tracking-[0.2em] font-mono">{statusLabel}</span>

        {isSupported && (
          <div className="flex items-center gap-1 ml-auto">
            {/* Wake word toggle */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={onToggleWake}
              title={wakeArmed ? 'Disarm wake word' : 'Arm wake word — say "Aurora"'}
              className={`p-1 border transition-colors ${
                wakeArmed
                  ? 'border-eve-gold/60 text-eve-gold bg-eve-gold/10'
                  : 'border-eve-dim text-eve-muted hover:border-eve-cyan/40 hover:text-eve-cyan/60'
              }`}
            >
              <motion.div
                animate={wakeArmed ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
                transition={{ duration: 1.5, repeat: wakeArmed ? Infinity : 0 }}
              >
                <Radio size={10} />
              </motion.div>
            </motion.button>

            {/* Manual mic */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={onToggleMic}
              title={isListening ? 'Stop listening' : 'Start listening'}
              className={`p-1 border transition-colors ${
                phase === 'listening' ? 'border-eve-red text-eve-red bg-eve-red/10' :
                phase === 'pending'   ? 'border-eve-gold text-eve-gold bg-eve-gold/10' :
                'border-eve-dim text-eve-muted hover:border-eve-cyan/40 hover:text-eve-cyan/60'
              }`}
            >
              <motion.div
                animate={isListening ? { scale: [1, 1.25, 1] } : { scale: 1 }}
                transition={{ duration: 0.6, repeat: isListening ? Infinity : 0 }}
              >
                <Mic size={10} />
              </motion.div>
            </motion.button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ darkMode, onToggleDark, onFeedback }: { darkMode?: boolean; onToggleDark?: () => void; onFeedback?: () => void }) {
  const handleLogin = () => { window.location.href = getEveLoginUrl() }

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(rgba(0,212,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,1) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,212,255,0.06) 0%, transparent 70%)',
      }} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 flex flex-col items-center gap-8 max-w-sm w-full px-6"
      >
        <div className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="text-eve-cyan text-glow-cyan text-5xl font-mono"
          >◈</motion.div>
          <div className="text-center">
            <div className="text-eve-cyan text-glow-cyan text-2xl tracking-[0.4em] font-mono uppercase mb-1">AURORA</div>
            <div className="text-eve-dim text-[10px] tracking-[0.3em] uppercase">Capsuleer Intelligence System</div>
          </div>
        </div>

        <div className="text-center space-y-2">
          <div className="text-eve-muted text-xs leading-relaxed">
            Real-time intelligence, market analysis, industry oversight, and tactical briefings — built for the capsuleer who demands more.
          </div>
          <div className="flex justify-center gap-3 text-eve-dim text-[9px] tracking-widest">
            <span>SKILLS</span><span>·</span><span>INDUSTRY</span><span>·</span><span>MARKET</span><span>·</span><span>ASSETS</span>
          </div>
        </div>

        <div className="w-full eve-panel border border-eve-cyan/20 p-5 flex flex-col gap-4">
          <div className="text-eve-muted text-[10px] tracking-widest text-center">PILOT AUTHENTICATION REQUIRED</div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleLogin}
            className="w-full py-3 px-4 flex items-center justify-center gap-3 border border-eve-cyan/40 bg-eve-cyan/5 hover:bg-eve-cyan/10 hover:border-eve-cyan/70 transition-all text-eve-cyan font-mono text-xs tracking-widest"
          >
            <LogIn size={14} />
            <span>LOGIN WITH EVE ONLINE</span>
          </motion.button>
          <div className="text-eve-dim text-[9px] text-center tracking-widest">SECURED VIA EVE SSO · OAUTH 2.0</div>
        </div>

        <div className="text-eve-dim text-[9px] tracking-widest">
          AURORA v1.0 · NEW EDEN · YC {new Date().getFullYear() - 1898}
        </div>
      </motion.div>

      {/* Options cog — top-right */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="absolute top-4 right-4 flex items-center gap-2"
      >
        {onFeedback && (
          <button
            onClick={onFeedback}
            className="text-eve-muted hover:text-eve-gold transition-colors text-[10px] tracking-widest font-mono border border-eve-border hover:border-eve-gold/50 px-2 py-0.5 rounded-sm"
          >
            FEEDBACK
          </button>
        )}
        <OptionsMenu darkMode={darkMode} setDarkMode={onToggleDark ? () => onToggleDark() : undefined} />
      </motion.div>
    </div>
  )
}

// ── Intel Feed ────────────────────────────────────────────────────────────────
interface IntelEntry { id: string; timestamp: string; character: string; message: string; category: string }

function ageLabel(isoTs: string): string {
  const secs = Math.floor((Date.now() - new Date(isoTs).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 3600)}h`
}

function IntelFeed({ channel }: { channel: string }) {
  const [entries, setEntries] = useState<IntelEntry[]>([])
  const [channelName, setChannelName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchFeed = async () => {
    try {
      const res = await fetch(`/api/intel/${encodeURIComponent(channel)}`)
      const data = await res.json() as { channelName?: string; entries?: IntelEntry[]; error?: string }
      if (data.error) { setError(data.error); return }
      setChannelName(data.channelName ?? channel)
      setEntries(data.entries ?? [])
      setError(null)
    } catch {
      setError('Could not reach server')
    }
  }

  useEffect(() => {
    fetchFeed()
    intervalRef.current = setInterval(fetchFeed, 5000)
    // Re-render every 30s to keep age labels current
    const ageTick = setInterval(() => setTick(t => t + 1), 30_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      clearInterval(ageTick)
    }
  }, [channel]) // eslint-disable-line react-hooks/exhaustive-deps

  const knownNames = [...new Set(entries.map(e => e.character))]

  const catColor = (cat: string) =>
    cat === 'hostile' ? 'border-l-eve-red/60 bg-eve-red/5' :
    cat === 'clear'   ? 'border-l-eve-green/60 bg-eve-green/5' :
    cat === 'info'    ? 'border-l-eve-cyan/40' :
                        'border-l-eve-border/60'

  const visible = entries.slice(0, 15)

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <Radio size={10} className="text-eve-cyan shrink-0" />
        <span className="eve-label text-[9px]">{channelName || channel.toUpperCase()}</span>
        {entries.length > 0 && (
          <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-eve-green shrink-0" />
        )}
      </div>

      {error && (
        <div className="text-eve-red text-[9px] font-mono">{error}</div>
      )}

      {!error && visible.length === 0 && (
        <div className="text-eve-dim text-[9px]">Waiting for intel...</div>
      )}

      {visible.length > 0 && (
        <div className="border border-eve-border/40 bg-eve-deep overflow-hidden flex-1 overflow-y-auto">
          {visible.map(en => (
            <div
              key={en.id}
              className={`grid grid-cols-12 gap-1 px-2 py-1 border-b border-eve-border/20 border-l-2 ${catColor(en.category)}`}
            >
              <div className="col-span-1 text-eve-dim text-[9px] font-mono">{ageLabel(en.timestamp)}</div>
              <div className="col-span-3 text-eve-gold text-[9px] truncate font-mono">{en.character}</div>
              <div className="col-span-8 text-eve-text text-[9px] break-words leading-tight">
                {renderMessage(en.message, knownNames)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Keywords that warrant a highlight
const STRUCTURE_KEYWORDS = /structure|reinforced|anchor|onlining|offline|destroyed|abandoned|low power/i
const CORP_APP_KEYWORDS = /applied to join|application|corp application|has applied|membership/i

function isAlert(subject: string) {
  return STRUCTURE_KEYWORDS.test(subject) || CORP_APP_KEYWORDS.test(subject)
}
function isWarning(subject: string) {
  return CORP_APP_KEYWORDS.test(subject)
}

// EVE system label IDs that map to the in-game folder names
const SYSTEM_LABEL_NAMES: Record<number, string> = {
  1: 'Inbox',
  2: 'Sent',
  4: 'Corp',
  8: 'Alliance',
  16: 'Agents',
  32: 'Bills',
  64: 'Contacts',
  128: 'Corporate',
  256: 'Faction Warfare',
  512: 'Insurance',
  1024: 'Miscellaneous',
  2048: 'Old',
  4096: 'Sovereignty',
  8192: 'Structures',
  16384: 'War',
  32768: 'Insurgencies',
}

// Ordered tab list matching the in-game sidebar
const TAB_ORDER = [
  'Unread',
  'Agents', 'Bills', 'Contacts', 'Corporate',
  'Faction Warfare', 'Insurance', 'Insurgencies',
  'Miscellaneous', 'Old', 'Sovereignty', 'Structures', 'War',
]

// ── Notifications Feed ────────────────────────────────────────────────────────
function MailFeed({ mail, mailLabels, notifications, onOpenNotifications }: { mail: EveMail[]; mailLabels: EveMailLabel[]; notifications: EveNotification[]; onOpenNotifications?: (mailId?: number) => void }) {
  const [activeTab, setActiveTab] = useState('Unread')

  // Build label ID → name map (system labels + character custom labels)
  const labelNameMap = useMemo(() => {
    const map: Record<number, string> = { ...SYSTEM_LABEL_NAMES }
    for (const l of mailLabels) map[l.labelId] = l.name
    return map
  }, [mailLabels])

  // Which tabs actually have mail
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { Unread: mail.filter(m => !m.isRead).length }
    for (const m of mail) {
      for (const lid of m.labelIds) {
        const name = labelNameMap[lid]
        if (name && TAB_ORDER.includes(name)) counts[name] = (counts[name] ?? 0) + 1
      }
    }
    return counts
  }, [mail, labelNameMap])

  const notifCount = notifications.length
  const allTabs = ['Unread', 'Notif', ...TAB_ORDER.slice(1)]
  const visibleTabs = allTabs.filter(t => {
    if (t === 'Unread') return true
    if (t === 'Notif') return notifCount > 0
    return (tabCounts[t] ?? 0) > 0
  })

  const filtered = useMemo(() => {
    if (activeTab === 'Unread') return mail.filter(m => !m.isRead)
    if (activeTab === 'Notif') return []
    return mail.filter(m => m.labelIds.some(lid => labelNameMap[lid] === activeTab))
  }, [mail, activeTab, labelNameMap])

  useEffect(() => {
    if (activeTab !== 'Unread' && activeTab !== 'Notif' && (tabCounts[activeTab] ?? 0) === 0) setActiveTab('Unread')
  }, [tabCounts, activeTab])

  return (
    <div className="flex min-h-0 h-full border border-eve-border/40 bg-eve-deep overflow-hidden">
      {/* Left tabs */}
      <div className="flex flex-col border-r border-eve-border/30 shrink-0 overflow-y-auto" style={{ minWidth: 90 }}>
        {visibleTabs.map(tab => {
          const count = tab === 'Notif' ? notifCount : (tabCounts[tab] ?? 0)
          const active = activeTab === tab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2 py-1.5 text-left text-[9px] font-mono tracking-wide border-b border-eve-border/20 flex items-center justify-between gap-1 transition-colors whitespace-nowrap
                ${active ? 'bg-eve-cyan/10 text-eve-cyan border-l-2 border-l-eve-cyan/60' : 'text-eve-muted hover:text-eve-text hover:bg-eve-border/10 border-l-2 border-l-transparent'}`}
            >
              <span className="truncate">{tab.toUpperCase()}</span>
              {count > 0 && (
                <span className={`text-[8px] px-1 shrink-0 ${active ? 'text-eve-cyan' : tab === 'Unread' || tab === 'Notif' ? 'text-eve-cyan/70' : 'text-eve-dim'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
        {activeTab === 'Notif' ? (
          notifications.length === 0 ? (
            <div className="p-3 text-eve-dim text-[9px] font-mono">No notifications</div>
          ) : notifications.map(n => (
            <button
              key={n.notificationId}
              className="w-full flex items-start gap-2 px-2 py-1.5 text-left border-b border-eve-border/20 hover:bg-eve-border/10 transition-colors"
              onClick={() => onOpenNotifications?.()}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-[10px] font-mono truncate text-eve-muted">
                    {n.type.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span className="text-[8px] text-eve-dim shrink-0">
                    {new Date(n.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </button>
          ))
        ) : filtered.length === 0 ? (
          <div className="p-3 text-eve-dim text-[9px] font-mono">No messages</div>
        ) : (
          filtered.map(m => {
            const alert = isAlert(m.subject)
            const warn = isWarning(m.subject)
            return (
              <button
                key={m.mailId}
                className={`w-full flex items-start gap-2 px-2 py-1.5 text-left border-b border-eve-border/20 hover:bg-eve-border/10 transition-colors ${alert ? warn ? 'border-l-2 border-l-eve-gold/70 bg-eve-gold/5' : 'border-l-2 border-l-eve-red/60 bg-eve-red/5' : ''}`}
                onClick={() => onOpenNotifications?.(m.mailId)}
              >
                <span className={`mt-1 shrink-0 w-1.5 h-1.5 rounded-full ${m.isRead ? 'bg-transparent border border-eve-border/30' : 'bg-eve-cyan'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={`text-[10px] font-mono truncate ${m.isRead ? 'text-eve-muted' : alert ? warn ? 'text-eve-gold' : 'text-eve-red' : 'text-eve-text'}`}>
                      {m.subject || '(No subject)'}
                    </span>
                    <span className="text-[8px] text-eve-dim shrink-0">
                      {new Date(m.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="text-[9px] text-eve-dim truncate">{m.fromName}</div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Contracts Feed ────────────────────────────────────────────────────────────
function ContractRow({ c, highlight, onClick }: { c: EveContract; highlight?: 'red' | 'gold' | 'cyan'; onClick?: () => void }) {
  const statusColor = CONTRACT_STATUS_COLOR[c.status] ?? 'text-eve-muted'
  const typeLabel = CONTRACT_TYPE_ABBR[c.type] ?? c.type.toUpperCase()
  const counterparty = c.assigneeName || c.issuerName
  const daysLeft = contractDaysLeft(c.dateExpired)
  const expired = daysLeft < 0
  const expirySoon = !expired && daysLeft <= 2

  const rowBg =
    highlight === 'red'  ? 'border-l-2 border-l-eve-red/60 bg-eve-red/5' :
    highlight === 'gold' ? 'border-l-2 border-l-eve-gold/60 bg-eve-gold/5' :
    highlight === 'cyan' ? 'border-l-2 border-l-eve-cyan/50 bg-eve-cyan/5' : ''

  return (
    <button
      onClick={onClick}
      className={`w-full text-left border-b border-eve-border/20 px-2 py-1.5 ${rowBg} ${onClick ? 'hover:bg-white/[0.03] cursor-pointer' : 'cursor-default'} transition-colors`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-[8px] font-mono text-eve-dim shrink-0">{typeLabel}</span>
        <span className={`text-[9px] font-mono truncate flex-1 ${highlight === 'red' ? 'text-eve-red' : highlight === 'gold' ? 'text-eve-gold' : c.status === 'outstanding' || c.status === 'in_progress' ? 'text-eve-text' : 'text-eve-muted'}`}>
          {c.title || typeLabel}
        </span>
        <span className={`text-[8px] font-mono shrink-0 ${statusColor}`}>
          {c.status.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[9px] text-eve-dim truncate flex-1">{counterparty}</span>
        {c.price > 0 && (
          <span className="text-[9px] text-eve-green font-mono shrink-0">
            {c.price >= 1e9 ? `${(c.price / 1e9).toFixed(1)}B` : c.price >= 1e6 ? `${(c.price / 1e6).toFixed(1)}M` : `${(c.price / 1e3).toFixed(0)}K`} ISK
          </span>
        )}
        {expired ? (
          <span className="text-[8px] font-mono shrink-0 text-eve-red">EXPIRED</span>
        ) : (c.status === 'outstanding' || c.status === 'in_progress') ? (
          <span className={`text-[8px] font-mono shrink-0 ${expirySoon ? 'text-eve-red' : 'text-eve-dim'}`}>
            {daysLeft}d
          </span>
        ) : null}
      </div>
    </button>
  )
}

function ContractsFeed({ contracts, character }: { contracts: EveContract[]; character: EveCharacter }) {
  const [tab, setTab] = useState<'active' | 'all' | 'alliance'>('active')
  const [openContract, setOpenContract] = useState<EveContract | null>(null)

  const byNewest = useCallback((a: EveContract, b: EveContract) =>
    new Date(b.dateIssued).getTime() - new Date(a.dateIssued).getTime(), [])

  const isAllianceContract = useCallback((c: EveContract) =>
    (c.source === 'alliance' || (!!character.allianceId && c.assigneeId === character.allianceId))
    && c.issuerId !== character.characterId,
    [character.allianceId, character.characterId])

  // Personal contracts only (exclude alliance-assigned)
  const personalContracts = useMemo(() =>
    contracts.filter(c => !isAllianceContract(c)), [contracts, isAllianceContract])

  const allianceContracts = useMemo(() =>
    contracts.filter(isAllianceContract).sort(byNewest), [contracts, isAllianceContract, byNewest])

  // Attention from personal contracts only:
  // - Expired contracts always need attention
  // - Outstanding contracts only need attention if someone ELSE created them (i.e. assigned to you)
  const attention = useMemo(() => personalContracts.filter(c => {
    const expired = contractDaysLeft(c.dateExpired) < 0
    if (expired && (c.status === 'in_progress' || c.status === 'outstanding')) return true
    if (c.status === 'outstanding' && c.issuerId !== character.characterId) return true
    return false
  }).sort(byNewest), [personalContracts, byNewest, character.characterId])

  const displayed = useMemo(() => {
    if (tab === 'alliance') return allianceContracts.slice(0, 50)
    const list = tab === 'active'
      ? personalContracts.filter(c => c.status === 'outstanding' || c.status === 'in_progress')
      : personalContracts
    const attentionIds = new Set(attention.map(c => c.contractId))
    return list.filter(c => !attentionIds.has(c.contractId)).sort(byNewest).slice(0, 30)
  }, [tab, personalContracts, allianceContracts, attention, byNewest])

  const activeCount = personalContracts.filter(c => c.status === 'outstanding' || c.status === 'in_progress').length

  return (
    <>
    <AnimatePresence>
      {openContract && (
        <ContractDetailWindow
          contract={openContract}
          character={character}
          onClose={() => setOpenContract(null)}
        />
      )}
    </AnimatePresence>

    <div className="flex flex-col gap-2 h-full min-w-0">
      <div className="flex items-center gap-2 shrink-0">
        <span className="eve-label text-[9px]">CONTRACTS</span>
        {activeCount > 0 && (
          <span className="px-1.5 py-0.5 bg-eve-cyan/15 text-eve-cyan text-[8px] border border-eve-cyan/30">
            {activeCount} ACTIVE
          </span>
        )}
        {attention.length > 0 && (
          <span className="px-1.5 py-0.5 bg-eve-red/15 text-eve-red text-[8px] border border-eve-red/30">
            {attention.length} ATTENTION
          </span>
        )}
        <div className="ml-auto flex border border-eve-border/40 overflow-hidden text-[8px] font-mono">
          <button
            onClick={() => setTab('active')}
            className={`px-2 py-0.5 transition-colors ${tab === 'active' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
          >ACTIVE</button>
          <button
            onClick={() => setTab('all')}
            className={`px-2 py-0.5 border-l border-eve-border/40 transition-colors ${tab === 'all' ? 'bg-eve-cyan/10 text-eve-cyan' : 'text-eve-muted hover:text-eve-text'}`}
          >ALL</button>
          {allianceContracts.length > 0 && (
            <button
              onClick={() => setTab('alliance')}
              className={`px-2 py-0.5 border-l border-eve-border/40 transition-colors ${tab === 'alliance' ? 'bg-eve-gold/10 text-eve-gold' : 'text-eve-muted hover:text-eve-text'}`}
            >ALLIANCE {allianceContracts.length > 0 && <span className="ml-0.5 opacity-60">{allianceContracts.length}</span>}</button>
          )}
        </div>
      </div>

      <div className="border border-eve-border/40 bg-eve-deep flex-1 overflow-y-auto">
        {tab === 'alliance' ? (
          displayed.length === 0 ? (
            <div className="p-3 text-eve-dim text-[9px] font-mono">No alliance contracts</div>
          ) : displayed.map(c => (
            <ContractRow key={c.contractId} c={c} onClick={() => setOpenContract(c)} />
          ))
        ) : (
          <>
            {/* Attention section */}
            {attention.length > 0 && (
              <>
                <div className="px-2 py-1 bg-eve-red/10 border-b border-eve-red/20 flex items-center gap-1.5">
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full bg-eve-red shrink-0"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  />
                  <span className="text-[8px] font-mono text-eve-red tracking-widest">REQUIRES ATTENTION</span>
                </div>
                {attention.map(c => (
                  <ContractRow
                    key={c.contractId}
                    c={c}
                    highlight={contractDaysLeft(c.dateExpired) < 0 ? 'red' : 'gold'}
                    onClick={() => setOpenContract(c)}
                  />
                ))}
                {(displayed.length > 0 || personalContracts.length > attention.length) && (
                  <div className="px-2 py-1 bg-eve-border/10 border-b border-eve-border/20">
                    <span className="text-[8px] font-mono text-eve-dim tracking-widest">OTHER CONTRACTS</span>
                  </div>
                )}
              </>
            )}

            {/* Main list */}
            {displayed.length === 0 && attention.length === 0 ? (
              <div className="p-3 text-eve-dim text-[9px] font-mono">
                {personalContracts.length === 0 ? 'No contracts' : 'No active contracts'}
              </div>
            ) : displayed.map(c => (
              <ContractRow
                key={c.contractId}
                c={c}
                highlight={c.issuerId !== character.characterId ? 'cyan' : undefined}
                onClick={() => setOpenContract(c)}
              />
            ))}
          </>
        )}
      </div>
    </div>
    </>
  )
}

// ── Character Showcase ────────────────────────────────────────────────────────
function CharacterShowcase(props: Omit<Props, 'character'> & { character: EveCharacter }) {
  const { character, characters, skills, walletBalance, walletTransactions, walletJournal, allWalletBalances, allWalletJournals, allWalletTransactions, securityStatus, shipLocation, attributes, loading, isSpeaking, voiceEnabled, autoListenTrigger, onEnter, onOpenComms, onVoiceQuery, onRefresh, onLogout, onSwitchCharacter, mail, mailLabels, notifications, contracts, onOpenNotifications, darkMode, onToggleDark, onFeedback } = props
  const [corpName, setCorpName] = useState('')
  const [allianceName, setAllianceName] = useState('')
  const [showWallet, setShowWallet] = useState(false)

  useEffect(() => {
    const ids = [character.corporationId, character.allianceId].filter(Boolean) as number[]
    resolveIds(ids).then(names => {
      setCorpName(names[character.corporationId] ?? `Corp ${character.corporationId}`)
      if (character.allianceId) setAllianceName(names[character.allianceId] ?? `Alliance ${character.allianceId}`)
    })
  }, [character.corporationId, character.allianceId])

  // Voice input — same engine as main comms
  const handleVoiceQuery = useCallback((text: string) => {
    onVoiceQuery?.(text)
    // Navigate to comms after submitting
    onOpenComms()
  }, [onVoiceQuery, onOpenComms])

  const voice = useVoiceInput({
    onSubmit: handleVoiceQuery,
    voiceEnabled,
    autoListenTrigger,
    returnToStandby: true, // always re-arm on landing page
  })

  const totalSP = skills.reduce((s, sk) => s + sk.skillpointsInSkill, 0)
  const dotlanCorp = corpName ? `https://evemaps.dotlan.net/corp/${encodeURIComponent(corpName.replace(/ /g, '_'))}` : '#'
  const dotlanAlliance = allianceName ? `https://evemaps.dotlan.net/alliance/${encodeURIComponent(allianceName.replace(/ /g, '_'))}` : '#'

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <AnimatePresence>
        {showWallet && (
          <WalletWindow
            characters={characters}
            allWalletBalances={allWalletBalances}
            allWalletJournals={allWalletJournals}
            allWalletTransactions={allWalletTransactions}
            onClose={() => setShowWallet(false)}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-3 border-b border-eve-border/40 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-eve-cyan text-glow-cyan text-sm tracking-[0.3em] font-mono">◈ AURORA</span>
          <span className="text-eve-dim text-[9px] tracking-widest">PILOT DOSSIER</span>
        </div>
        <div className="flex items-center gap-2">
          {onFeedback && (
            <button
              onClick={onFeedback}
              className="text-eve-muted hover:text-eve-gold transition-colors text-[10px] tracking-widest font-mono border border-eve-border hover:border-eve-gold/50 px-2 py-0.5 rounded-sm"
            >
              FEEDBACK
            </button>
          )}
          <OptionsMenu darkMode={darkMode} setDarkMode={onToggleDark ? () => onToggleDark() : undefined} />
          <button onClick={onRefresh} className="eve-btn flex items-center gap-1.5 text-[10px]" disabled={loading}>
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            {!loading && <span>REFRESH</span>}
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onEnter}
            className="eve-btn-primary flex items-center gap-2 text-[10px] px-4 py-2"
          >
            <span>ENTER AURORA</span>
            <span className="text-eve-cyan/60">→</span>
          </motion.button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="lg:w-72 xl:w-80 shrink-0 flex flex-col items-center gap-5 p-8 border-r border-eve-border/30 relative">
          <div className="absolute inset-0 pointer-events-none" style={{
            background: 'radial-gradient(ellipse 80% 55% at 50% 25%, rgba(0,212,255,0.05) 0%, transparent 70%)',
          }} />

          {/* Portrait — use 512 for quality, display at 240px */}
          <PortraitFrame
            characterId={character.characterId}
            size={512}
            displaySize={240}
            className="relative z-10"
          />

          {/* Character switcher row — mini portraits + add button */}
          <div className="flex flex-wrap items-center justify-center gap-2 z-10 max-w-xs">
            {characters.map(c => (
              <MiniPortrait
                key={c.characterId}
                characterId={c.characterId}
                characterName={c.characterName}
                isActive={c.characterId === character.characterId}
                onClick={() => c.characterId !== character.characterId && onSwitchCharacter?.(c.characterId)}
              />
            ))}
            {/* Add character button */}
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { window.location.href = getEveLoginUrl() }}
              title="Add character"
              className="flex items-center justify-center border border-eve-cyan/30 bg-eve-cyan/5 hover:bg-eve-cyan/10 hover:border-eve-cyan/60 text-eve-cyan/60 hover:text-eve-cyan transition-all shrink-0"
              style={{ width: 48, height: 48 }}
            >
              <UserPlus size={16} />
            </motion.button>
          </div>

          {/* Name + sec */}
          <div className="text-center z-10">
            <div className="text-eve-text text-lg font-mono tracking-wider">{character.characterName}</div>
            {securityStatus !== 0 && (
              <div className={`text-sm font-mono mt-0.5 ${secColor(securityStatus)}`}>
                SEC {securityStatus >= 0 ? '+' : ''}{securityStatus.toFixed(2)}
              </div>
            )}
          </div>

          {/* Logout */}
          {onLogout && (
            <button
              onClick={() => onLogout()}
              className="z-10 flex items-center gap-1.5 text-[9px] font-mono tracking-widest text-eve-dim hover:text-eve-red hover:border-eve-red/40 border border-eve-border/40 px-3 py-1.5 transition-colors"
            >
              <LogOut size={9} />
              LOGOUT
            </button>
          )}

          {/* Corp + Alliance logos */}
          <div className="flex gap-6 items-start z-10">
            <LogoFrame
              url={`https://images.evetech.net/corporations/${character.corporationId}/logo?size=128`}
              label={corpName || `Corp ${character.corporationId}`}
            />
            {character.allianceId && (
              <LogoFrame
                url={`https://images.evetech.net/alliances/${character.allianceId}/logo?size=128`}
                label={allianceName || `Alliance ${character.allianceId}`}
              />
            )}
          </div>

          {/* Aurora in bottom-left */}
          <div className="w-full mt-auto pt-4 border-t border-eve-border/20 z-10">
            <AuroraCorner
              isSpeaking={isSpeaking}
              phase={voice.phase}
              wakeArmed={voice.wakeArmed}
              isListening={voice.isListening}
              isSupported={voice.isSupported}
              onToggleWake={voice.toggleWakeMode}
              onToggleMic={voice.toggleManualMic}
              onOpenComms={onOpenComms}
            />
          </div>
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col gap-5 p-8 overflow-y-auto">

          {/* Stat grid */}
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            <StatBlock
              icon={<Star size={13} />} label="Skillpoints"
              value={totalSP >= 1e6 ? `${(totalSP / 1e6).toFixed(2)}M SP` : `${(totalSP / 1e3).toFixed(0)}K SP`}
              sub={`${skills.filter(s => s.trainedLevel === 5).length} at V · ${skills.length} known`}
              color="text-eve-gold"
            />
            <motion.button
              className="text-left hover:ring-1 hover:ring-eve-green/30 transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowWallet(true)}
              title="Open Wallet"
            >
              <StatBlock
                icon={<TrendingUp size={13} />} label="Wallet ↗"
                value={walletBalance > 0 ? formatISK(walletBalance) + ' ISK' : '—'}
                sub={characters.length > 1 ? (() => {
                  const total = Object.values(allWalletBalances).reduce((a, b) => a + b, 0)
                  return total > 0 ? `Combined: ${formatISK(total)} ISK` : undefined
                })() : undefined}
                color="text-eve-green"
              />
            </motion.button>
            <StatBlock
              icon={<Shield size={13} />} label="Corporation"
              value={corpName || `ID: ${character.corporationId}`}
              sub={allianceName || (character.allianceId ? `Alliance ${character.allianceId}` : 'No alliance')}
              color="text-eve-cyan"
            />
            {shipLocation && <>
              <StatBlock
                icon={<Zap size={13} />} label="Active Ship"
                value={shipLocation.shipTypeName} sub={shipLocation.shipName}
                color="text-eve-orange"
              />
              <StatBlock
                icon={<MapPin size={13} />} label="Location"
                value={shipLocation.solarSystemName} sub={shipLocation.stationName ?? 'In space'}
                color="text-eve-muted"
              />
            </>}
            {attributes && (
              <StatBlock
                icon={<Cpu size={13} />} label="Attributes"
                value={`${attributes.intelligence + attributes.memory + attributes.perception + attributes.willpower + attributes.charisma} pts`}
                sub={`Int ${attributes.intelligence} · Mem ${attributes.memory} · Per ${attributes.perception}`}
                color="text-eve-cyan"
              />
            )}
          </div>

          {/* External links */}
          <div className="flex flex-col gap-2">
            <div className="eve-label text-[9px]">EXTERNAL INTEL</div>
            <div className="flex flex-wrap gap-2">
              <ExternalLinkBtn href={`https://zkillboard.com/character/${character.characterId}/`} label="ZKILLBOARD" />
              <ExternalLinkBtn href={`https://evewho.com/character/${character.characterId}`} label="EVE WHO" />
              <ExternalLinkBtn href={dotlanCorp} label="DOTLAN CORP" />
              {character.allianceId && <ExternalLinkBtn href={dotlanAlliance} label="DOTLAN ALLIANCE" />}
              <ExternalLinkBtn href={`https://eveskillboard.com/pilot/${encodeURIComponent(character.characterName)}`} label="SKILLBOARD" />
              <ExternalLinkBtn href="https://www.fuzzwork.co.uk/" label="FUZZWORK" />
            </div>
          </div>

          {/* Intel · Contracts · Notifications */}
          <div className="flex gap-3 min-h-0" style={{ height: 300 }}>
            {/* Intel feed */}
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <IntelFeed channel="east.imperium" />
            </div>

            {/* Contracts feed */}
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <ContractsFeed contracts={contracts ?? []} character={character} />
            </div>

            {/* Notifications feed */}
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <div className="eve-label text-[9px] flex items-center gap-2 shrink-0">
                NOTIFICATIONS
                {((mail?.filter(m => !m.isRead).length ?? 0) + (notifications?.length ?? 0)) > 0 && (
                  <span className="px-1.5 py-0.5 bg-eve-cyan/15 text-eve-cyan text-[8px] border border-eve-cyan/30">
                    {(mail?.filter(m => !m.isRead).length ?? 0) + (notifications?.length ?? 0)} NEW
                  </span>
                )}
              </div>
              {(mail && mail.length > 0) || (notifications && notifications.length > 0) ? (
                <MailFeed
                  mail={mail ?? []}
                  mailLabels={mailLabels ?? []}
                  notifications={notifications ?? []}
                  onOpenNotifications={onOpenNotifications}
                />
              ) : (
                <div className="border border-eve-border/40 bg-eve-deep flex items-center justify-center flex-1">
                  <span className="text-eve-dim text-[9px] font-mono">
                    {mail ? 'No notifications' : 'Authenticating…'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Footer CTA */}
          <div className="mt-auto pt-4 border-t border-eve-border/30">
            <motion.button
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
              onClick={onEnter}
              className="w-full py-3 border border-eve-cyan/40 bg-eve-cyan/5 hover:bg-eve-cyan/10 hover:border-eve-cyan/70 transition-all text-eve-cyan font-mono text-xs tracking-[0.3em] flex items-center justify-center gap-3"
            >
              <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }}>◈</motion.span>
              ENTER AURORA
              <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity, delay: 1 }}>◈</motion.span>
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function LandingPage(props: Props) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackScreenshot, setFeedbackScreenshot] = useState<string | null>(null)
  const feedbackPanel = props.character ? 'landing' : 'landing-login'

  async function openFeedback() {
    const shot = window.electronAPI?.captureScreenshot ? await window.electronAPI.captureScreenshot() : null
    setFeedbackScreenshot(shot)
    setShowFeedback(true)
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={props.character ? 'character' : 'login'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="h-screen flex flex-col bg-eve-black font-mono overflow-hidden relative"
      >
        <div className="scanline-overlay" />
        {props.character
          ? <CharacterShowcase {...props} character={props.character} onFeedback={openFeedback} />
          : <LoginScreen darkMode={props.darkMode} onToggleDark={props.onToggleDark} onFeedback={openFeedback} />
        }
        {showFeedback && (
          <FeedbackModal activePanel={feedbackPanel as import('../types').ActivePanel} screenshot={feedbackScreenshot} onClose={() => setShowFeedback(false)} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

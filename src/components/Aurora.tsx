import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Volume2, VolumeX } from 'lucide-react'

import AURORA_IMG from '../assets/Aurora1.png'
import TodoList from './TodoList'
import { useVoiceInput } from '../hooks/useVoiceInput'

function AuroraImage() {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="w-full h-full bg-gradient-to-b from-eve-dim to-eve-black flex items-center justify-center relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-eve-cyan/5 to-eve-cyan/10" />
        <svg viewBox="0 0 100 120" className="w-20 h-24 text-eve-cyan/30" fill="currentColor">
          <ellipse cx="50" cy="35" rx="20" ry="23" />
          <path d="M20 120 Q20 75 50 70 Q80 75 80 120Z" />
        </svg>
      </div>
    )
  }
  return (
    <img
      src={AURORA_IMG}
      alt="Aurora"
      className="w-full h-full object-cover object-top"
      onError={() => setFailed(true)}
    />
  )
}

interface AuroraProps {
  isSpeaking: boolean
  characterName?: string
  voiceEnabled: boolean
  onToggleVoice?: () => void
  showVoiceToggle?: boolean
  autoListenTrigger: number
  onVoiceQuery: (text: string) => void
}

export default function Aurora({ isSpeaking, characterName, voiceEnabled, onToggleVoice, showVoiceToggle, autoListenTrigger, onVoiceQuery }: AuroraProps) {
  const voice = useVoiceInput({
    onSubmit: onVoiceQuery,
    voiceEnabled,
    autoListenTrigger,
    returnToStandby: true,
  })

  const { phase, wakeArmed, isListening, interimText } = voice
  const voiceActive = phase !== 'off'

  const knobColor =
    isListening           ? '#ff4444' :
    phase === 'activated' ? '#00d4ff' :
    wakeArmed             ? '#ffd700' :
    '#3a4556'

  const statusDotColor =
    isSpeaking            ? '#00d4ff' :
    isListening           ? '#ff4444' :
    phase === 'activated' ? '#00d4ff' :
    wakeArmed             ? '#ffd700' :
    '#33cc66'

  const statusLabel =
    isSpeaking            ? 'TRANSMITTING'      :
    phase === 'pending'   ? 'PROCESSING'        :
    isListening           ? 'LISTENING'         :
    phase === 'activated' ? 'ACTIVATED'         :
    wakeArmed             ? 'ARMED'             :
    'ONLINE'

  // Border colour for the avatar ring — CSS transition handles the change
  const borderColor = isSpeaking ? '#00d4ff' : voiceActive ? knobColor : '#1a2332'

  // Box-shadow for avatar — static per state, CSS transition animates between them
  const boxShadow = isSpeaking
    ? '0 0 30px rgba(0,212,255,0.5), 0 0 60px rgba(0,212,255,0.25)'
    : voiceActive
    ? `0 0 20px ${knobColor}55, 0 0 40px ${knobColor}22`
    : '0 0 15px rgba(0,212,255,0.1), 0 0 30px rgba(0,212,255,0.05)'

  return (
    <div className="flex flex-col items-center gap-3 py-4 select-none">
      {/* Rings + Avatar */}
      <div className="relative flex items-center justify-center w-36 h-36">
        {/* Outer ambient ring — CSS animation, off JS thread */}
        <div
          className="absolute inset-0 rounded-full border border-eve-cyan/10"
          style={{ animation: 'aurora-ring 3s ease-in-out infinite' }}
        />

        {/* Speaking pulse rings — Framer Motion, only mount when speaking */}
        <AnimatePresence>
          {isSpeaking && (
            <>
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="absolute inset-0 rounded-full border border-eve-cyan/40"
                  initial={{ scale: 0.9, opacity: 0.7 }}
                  animate={{ scale: 1.8 + i * 0.3, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.35, ease: 'easeOut' }}
                />
              ))}
              <motion.div
                className="absolute inset-4 rounded-full border border-eve-cyan/60"
                animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            </>
          )}
        </AnimatePresence>

        {/* Listening rings — Framer Motion, only mount when active */}
        <AnimatePresence>
          {voiceActive && !isSpeaking && (
            <>
              {[0, 1].map(i => (
                <motion.div
                  key={`listen-${i}`}
                  className="absolute inset-0 rounded-full border"
                  style={{ borderColor: knobColor + '55' }}
                  initial={{ scale: 0.9, opacity: 0.6 }}
                  animate={{ scale: 1.5 + i * 0.2, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.4, ease: 'easeOut' }}
                />
              ))}
            </>
          )}
        </AnimatePresence>

        {/* Avatar container — CSS transition for border/glow, no JS animation loop */}
        <div
          className="relative w-28 h-28 rounded-full overflow-hidden border-2 z-10"
          style={{
            borderColor,
            boxShadow,
            transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
          }}
        >
          <div className="w-full h-full relative overflow-hidden">
            <AuroraImage />
            {/* Scanline — CSS animation, off JS thread */}
            <div
              className="absolute inset-x-0 pointer-events-none"
              style={{
                height: '30%',
                background: 'linear-gradient(180deg, transparent, rgba(0,212,255,0.07), transparent)',
                animation: 'aurora-scanline 4.5s linear infinite',
              }}
            />
          </div>
        </div>

        {/* Corner brackets */}
        <div className="absolute inset-1 z-20 pointer-events-none">
          <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-eve-cyan/60" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-eve-cyan/60" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-eve-cyan/60" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-eve-cyan/60" />
        </div>

        {/* Voice toggle */}
        {showVoiceToggle && onToggleVoice && (
          <motion.button
            onClick={onToggleVoice}
            title={voiceEnabled ? 'Disable voice' : 'Enable voice'}
            className="absolute bottom-1 right-1 z-30 w-7 h-7 flex items-center justify-center rounded-full border transition-colors"
            style={{
              borderColor: voiceEnabled ? 'rgba(0,212,255,0.6)' : 'rgba(26,35,50,0.9)',
              background: voiceEnabled ? 'rgba(0,212,255,0.15)' : 'rgba(8,11,16,0.85)',
              color: voiceEnabled ? '#00d4ff' : '#3a4556',
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            {voiceEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          </motion.button>
        )}

        {/* Todo notepad */}
        <TodoList />
      </div>

      {/* Name */}
      <div className="text-center">
        <div className="text-eve-cyan text-glow-cyan font-mono text-sm tracking-[0.3em] uppercase">
          AURORA
        </div>
        <div className="text-eve-muted text-xs tracking-widest mt-0.5">
          CAPSULEER INTELLIGENCE SYSTEM
        </div>

        <div className="flex items-center justify-center gap-2 mt-2">
          {/* Status dot — CSS animation */}
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              backgroundColor: statusDotColor,
              animation: `aurora-dot ${isSpeaking || isListening ? '0.5s' : '2s'} ease-in-out infinite`,
              transition: 'background-color 0.3s ease',
            }}
          />
          <span className="text-eve-muted text-xs tracking-widest">{statusLabel}</span>
        </div>

        <AnimatePresence>
          {interimText && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden mt-1"
            >
              <p className="text-eve-muted text-[9px] italic font-mono px-2 leading-relaxed">
                <motion.span
                  className="text-eve-red mr-1"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                >●</motion.span>
                {interimText}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

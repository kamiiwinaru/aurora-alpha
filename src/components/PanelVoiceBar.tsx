import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceInput } from '../hooks/useVoiceInput'

interface PanelVoiceBarProps {
  onVoiceQuery: (text: string) => void
  voiceEnabled: boolean
  autoListenTrigger: number
  noAIMode?: boolean
}

export default function PanelVoiceBar({ onVoiceQuery, voiceEnabled, autoListenTrigger, noAIMode }: PanelVoiceBarProps) {
  if (noAIMode) {
    return (
      <div className="border-b border-eve-border/40 bg-eve-panel shrink-0 px-4 py-2 flex items-center gap-2 opacity-50 select-none">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-eve-muted shrink-0">
          <circle cx="7" cy="7" r="6" /><line x1="7" y1="4" x2="7" y2="7" /><circle cx="7" cy="10" r="0.5" fill="currentColor" />
        </svg>
        <span className="text-eve-muted text-[9px] tracking-widest font-mono uppercase">
          AI agent unavailable — Anthropic API key required
        </span>
      </div>
    )
  }
  const voice = useVoiceInput({
    onSubmit: onVoiceQuery,
    voiceEnabled,
    autoListenTrigger,
    returnToStandby: true,
  })

  if (!voice.isSupported) return null

  const { phase, wakeArmed, isListening, interimText, countdown } = voice
  const active = phase !== 'off'

  // ── Toggle slider ──────────────────────────────────────────────────────────
  const trackBg =
    phase === 'listening' ? 'rgba(255,68,68,0.15)'  :
    phase === 'pending'   ? 'rgba(255,215,0,0.12)'  :
    phase === 'activated' ? 'rgba(0,212,255,0.12)'  :
    wakeArmed             ? 'rgba(255,215,0,0.10)'  :
    'rgba(255,255,255,0.04)'

  const trackBorder =
    phase === 'listening' ? 'rgba(255,68,68,0.5)'   :
    phase === 'pending'   ? 'rgba(255,215,0,0.5)'   :
    phase === 'activated' ? 'rgba(0,212,255,0.6)'   :
    wakeArmed             ? 'rgba(255,215,0,0.45)'  :
    'rgba(255,255,255,0.12)'

  const knobColor =
    phase === 'listening' ? '#ff4444' :
    phase === 'pending'   ? '#ffd700' :
    phase === 'activated' ? '#00d4ff' :
    wakeArmed             ? '#ffd700' :
    '#3a4556'

  const statusText =
    phase === 'pending'   ? `SUBMITTING IN ${countdown.toFixed(1)}s` :
    phase === 'listening' ? 'LISTENING'        :
    phase === 'activated' ? 'ACTIVATED'        :
    phase === 'standby'   ? 'ARMED — SAY "AURORA"' :
    'INACTIVE'

  const statusColor =
    phase === 'listening' ? 'text-eve-red'   :
    phase === 'pending'   ? 'text-eve-gold'  :
    phase === 'activated' ? 'text-eve-cyan'  :
    wakeArmed             ? 'text-eve-gold'  :
    'text-eve-dim'

  return (
    <div className="border-b border-eve-border/40 bg-eve-panel shrink-0">
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Label */}
        <span className="text-eve-dim text-[9px] tracking-widest font-mono shrink-0">
          AURORA VOICE
        </span>

        {/* Status */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <motion.div
            className="w-1 h-1 rounded-full shrink-0"
            style={{ backgroundColor: knobColor }}
            animate={{ opacity: active ? [1, 0.3, 1] : 1 }}
            transition={{ duration: active ? 0.7 : 1, repeat: active ? Infinity : 0 }}
          />
          <span className={`text-[9px] tracking-widest font-mono truncate ${statusColor}`}>
            {statusText}
          </span>
        </div>

        {/* Toggle slider */}
        <button
          onClick={voice.toggleWakeMode}
          title={active ? 'Disarm Aurora voice' : 'Arm Aurora voice — say "Aurora" to activate'}
          className="relative shrink-0 flex items-center focus:outline-none"
          style={{ width: 40, height: 20 }}
        >
          {/* Track */}
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{ backgroundColor: trackBg, borderColor: trackBorder }}
            transition={{ duration: 0.2 }}
            style={{ border: '1px solid' }}
          />
          {/* Knob */}
          <motion.div
            className="absolute top-[3px] w-[14px] h-[14px] rounded-full shadow-sm"
            animate={{
              left: active ? 22 : 3,
              backgroundColor: knobColor,
              boxShadow: active ? `0 0 6px ${knobColor}` : 'none',
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          />
        </button>
      </div>

      {/* Interim transcript — only shows while actively listening */}
      <AnimatePresence>
        {interimText && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-2 flex items-center gap-2">
              <motion.span
                className="text-eve-red text-[9px]"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >●</motion.span>
              <span className="text-eve-muted text-[10px] italic font-mono">{interimText}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

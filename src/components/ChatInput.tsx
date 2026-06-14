import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Square, Mic, Pencil, X, Volume2, VolumeX, Settings2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceInput } from '../hooks/useVoiceInput'

interface ChatInputProps {
  onSend: (msg: string) => void
  onStop: () => void
  disabled: boolean
  streaming: boolean
  editValue: string | null
  onCancelEdit: () => void
  voiceEnabled: boolean
  onToggleVoice: () => void
  onOpenVoiceSettings: () => void
  autoListenTrigger: number
  noAIMode?: boolean
}

const SUGGESTIONS = [
  'What skills should I train for mining barges?',
  'Analyze my current industry jobs',
  'What are the most profitable items in Jita?',
  'How do I optimize my skill queue?',
]

export default function ChatInput({
  onSend,
  onStop,
  disabled,
  streaming,
  editValue,
  onCancelEdit,
  voiceEnabled,
  onToggleVoice,
  onOpenVoiceSettings,
  autoListenTrigger,
  noAIMode,
}: ChatInputProps) {
  const [textValue, setTextValue] = useState('')
  const textValueRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { textValueRef.current = textValue }, [textValue])

  const clearAutoSubmit = () => {
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current)
      autoSubmitTimerRef.current = null
    }
  }

  // ── Voice input ───────────────────────────────────────────────────────────
  const handleVoiceSubmit = useCallback((text: string) => {
    if (!disabled) onSend(text)
  }, [disabled, onSend])

  const voice = useVoiceInput({
    onSubmit: handleVoiceSubmit,
    voiceEnabled,
    autoListenTrigger,
  })

  // When Scribe finishes, copy transcript into textarea and start 1s auto-send timer
  useEffect(() => {
    if (voice.value && voice.phase === 'off') {
      const transcript = voice.value
      setTextValue(prev => prev ? `${prev.trimEnd()} ${transcript}` : transcript)
      voice.setValue('')
      textareaRef.current?.focus()
      clearAutoSubmit()
      autoSubmitTimerRef.current = setTimeout(() => {
        autoSubmitTimerRef.current = null
        const msg = textValueRef.current.trim()
        if (msg) {
          setTextValue('')
          if (textareaRef.current) textareaRef.current.style.height = 'auto'
          onSend(msg)
        }
      }, 1000)
    }
  }, [voice.value, voice.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync edit value into the text area
  useEffect(() => {
    if (editValue !== null) {
      setTextValue(editValue)
      setTimeout(() => {
        textareaRef.current?.focus()
        const len = editValue.length
        textareaRef.current?.setSelectionRange(len, len)
      }, 0)
    }
  }, [editValue])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [textValue])

  // ── Text submit ───────────────────────────────────────────────────────────
  const submit = () => {
    const msg = textValue.trim()
    if (!msg || disabled) return
    onSend(msg)
    setTextValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (voice.isListening) {
        voice.submitNow()
      } else {
        submit()
      }
    }
    if (e.key === 'Escape') {
      clearAutoSubmit()
      if (editValue !== null) { onCancelEdit(); setTextValue('') }
      if (voice.isListening) {
        voice.clearSilenceTimer()
        voice.toggleManualMic()
      }
    }
  }

  // ── Derived display ───────────────────────────────────────────────────────
  const { phase, interimText, countdown, isListening, isSupported } = voice

  const micColor =
    phase === 'transcribing' ? 'border-eve-cyan text-eve-cyan bg-eve-cyan/10' :
    phase === 'pending'      ? 'border-eve-gold text-eve-gold bg-eve-gold/10' :
    phase === 'listening'    ? 'border-eve-red text-eve-red bg-eve-red/10' :
    'border-eve-dim text-eve-muted hover:border-eve-cyan hover:text-eve-cyan'

  const placeholder =
    phase === 'transcribing' ? 'TRANSCRIBING...' :
    phase === 'pending'      ? `SUBMITTING IN ${countdown.toFixed(1)}s — SPEAK TO CONTINUE` :
    phase === 'listening'    ? 'RECORDING — CLICK MIC TO STOP' :
    'ENTER QUERY // SHIFT+ENTER FOR NEWLINE'

  if (noAIMode) {
    return (
      <div className="border-t border-eve-border bg-eve-panel px-4 py-4 flex items-center justify-center gap-3 opacity-50 select-none">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-eve-muted shrink-0">
          <circle cx="7" cy="7" r="6" /><line x1="7" y1="4" x2="7" y2="7" /><circle cx="7" cy="10" r="0.5" fill="currentColor" />
        </svg>
        <span className="text-eve-muted text-xs tracking-widest uppercase">
          AI agent unavailable — provide Anthropic API key in settings to enable
        </span>
      </div>
    )
  }

  return (
    <div className="border-t border-eve-border bg-eve-panel px-4 py-3">
      {/* Edit mode banner */}
      <AnimatePresence>
        {editValue !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 mb-2 text-[10px] text-eve-orange border border-eve-orange/30 bg-eve-orange/5 px-2 py-1"
          >
            <Pencil size={10} />
            <span className="tracking-widest">EDITING MESSAGE — ESC TO CANCEL</span>
            <button onClick={() => { onCancelEdit(); setTextValue('') }} className="ml-auto hover:text-eve-red transition-colors">
              <X size={10} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Countdown banner */}
      <AnimatePresence>
        {phase === 'pending' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 mb-2 text-[10px] text-eve-gold border border-eve-gold/30 bg-eve-gold/5 px-2 py-1"
          >
            <span className="tracking-widest">SUBMITTING IN</span>
            <span className="font-mono text-eve-gold">{countdown.toFixed(1)}s</span>
            <span className="tracking-widest">— SPEAK TO CONTINUE OR PRESS ENTER TO SEND NOW</span>
            <button
              onClick={() => { voice.clearSilenceTimer(); voice.toggleManualMic() }}
              className="ml-auto hover:text-eve-red transition-colors"
            >
              <X size={10} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick suggestions */}
      {!streaming && textValue === '' && editValue === null && phase === 'off' && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {SUGGESTIONS.slice(0, 3).map(s => (
            <button
              key={s}
              onClick={() => setTextValue(s)}
              className="shrink-0 text-[10px] text-eve-muted border border-eve-border px-2 py-1 hover:border-eve-cyan/40 hover:text-eve-cyan/70 transition-colors whitespace-nowrap"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        {isSupported && (
          <div className="flex gap-1 shrink-0">
            {/* Manual mic — push-to-talk via ElevenLabs Scribe */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={voice.toggleManualMic}
              disabled={streaming}
              title={isListening ? 'Stop & transcribe' : 'Voice input (or hold `)'}
              className={`px-2 py-2.5 border font-mono transition-all disabled:opacity-30 disabled:cursor-not-allowed ${micColor}`}
            >
              <motion.div
                animate={isListening ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={{ duration: 0.6, repeat: isListening ? Infinity : 0 }}
              >
                <Mic size={13} />
              </motion.div>
            </motion.button>
          </div>
        )}

        {/* Voice output toggle */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onToggleVoice}
          title={voiceEnabled ? 'Mute Aurora voice' : 'Enable Aurora voice'}
          className={`px-2 py-2.5 border font-mono transition-all shrink-0 ${
            voiceEnabled
              ? 'border-eve-cyan/60 text-eve-cyan bg-eve-cyan/10'
              : 'border-eve-dim text-eve-muted hover:border-eve-cyan/40 hover:text-eve-cyan/60'
          }`}
        >
          {voiceEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
        </motion.button>

        {/* Voice settings */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onOpenVoiceSettings}
          title="Voice settings — pronunciation & response style"
          className="px-2 py-2.5 border border-eve-dim text-eve-muted hover:border-eve-cyan/40 hover:text-eve-cyan transition-all shrink-0"
        >
          <Settings2 size={13} />
        </motion.button>

        {/* Input + interim preview */}
        <div className="flex-1 relative">
          <div className={`absolute top-0 left-0 w-2 h-2 border-t border-l
            ${editValue !== null ? 'border-eve-orange/50' : isListening ? 'border-eve-red/50' : 'border-eve-cyan/30'}`} />
          <div className={`absolute bottom-0 right-0 w-2 h-2 border-b border-r
            ${editValue !== null ? 'border-eve-orange/50' : isListening ? 'border-eve-red/50' : 'border-eve-cyan/30'}`} />
          <textarea
            ref={textareaRef}
            value={textValue}
            onChange={e => { clearAutoSubmit(); setTextValue(e.target.value) }}
            onKeyDown={handleKey}
            disabled={disabled && !streaming}
            placeholder={placeholder}
            rows={1}
            className={`eve-input resize-none py-2.5 pr-2 min-h-[40px] leading-relaxed
              ${phase === 'pending' ? 'border-eve-gold/40' : isListening ? 'border-eve-red/40' : ''}`}
          />
          {/* Live interim transcript */}
          <AnimatePresence>
            {interimText && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-full left-0 right-0 mb-1 px-3 py-1.5 bg-eve-panel border border-eve-red/30 text-eve-muted text-xs italic"
              >
                <span className="text-eve-red text-[9px] tracking-widest mr-2">●</span>
                {interimText}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Send / Stop */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={streaming ? onStop : (isListening ? voice.submitNow : submit)}
          disabled={!streaming && (!textValue.trim() || disabled) && !isListening}
          className={`
            px-3 py-2.5 border font-mono text-xs uppercase tracking-widest transition-all
            flex items-center gap-1.5 shrink-0
            ${streaming
              ? 'border-eve-orange text-eve-orange hover:bg-eve-orange/10'
              : editValue !== null
              ? 'border-eve-orange text-eve-orange hover:bg-eve-orange/10 disabled:opacity-30 disabled:cursor-not-allowed'
              : phase === 'pending'
              ? 'border-eve-gold text-eve-gold hover:bg-eve-gold/10'
              : 'border-eve-cyan text-eve-cyan hover:bg-eve-cyan/10 disabled:opacity-30 disabled:cursor-not-allowed'
            }
          `}
        >
          {streaming ? (
            <><Square size={12} /><span>HALT</span></>
          ) : editValue !== null ? (
            <><Pencil size={12} /><span>UPDATE</span></>
          ) : phase === 'pending' ? (
            <><Send size={12} /><span>SEND NOW</span></>
          ) : (
            <><Send size={12} /><span>SEND</span></>
          )}
        </motion.button>
      </div>

      <div className="flex justify-between mt-1.5">
        <span className="text-eve-dim text-[9px] tracking-widest flex items-center gap-2">
          AURORA v1.0 // CLAUDE SONNET
          {phase === 'listening' && (
            <span className="text-eve-red animate-pulse">● RECORDING</span>
          )}
          {phase === 'transcribing' && (
            <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.6, repeat: Infinity }}
              className="text-eve-cyan">◈ TRANSCRIBING</motion.span>
          )}
          {phase === 'pending' && (
            <span className="text-eve-gold">◷ SUBMITTING IN {countdown.toFixed(1)}s</span>
          )}
        </span>
        <span className="text-eve-dim text-[9px] tracking-widest">{textValue.length} CHARS</span>
      </div>
    </div>
  )
}

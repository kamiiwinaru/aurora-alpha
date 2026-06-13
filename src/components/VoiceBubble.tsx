import { useRef, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Minus, MessageSquare, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../types'
import AURORA_IMG from '../assets/Aurora1.png'

interface VoiceBubbleProps {
  messages: Message[]
  streaming: boolean
  isSpeaking: boolean
  toolStatus: string | null
  onOpenComms: () => void
  onClose: () => void
}

function AuroraThumb({ isSpeaking }: { isSpeaking: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <motion.div
      className="relative rounded-full overflow-hidden border-2 shrink-0"
      style={{ width: 36, height: 36 }}
      animate={{
        borderColor: isSpeaking ? '#00d4ff' : '#1a2332',
        boxShadow: isSpeaking
          ? ['0 0 10px rgba(0,212,255,0.5)', '0 0 22px rgba(0,212,255,0.8)', '0 0 10px rgba(0,212,255,0.5)']
          : ['0 0 6px rgba(0,212,255,0.1)', '0 0 12px rgba(0,212,255,0.15)', '0 0 6px rgba(0,212,255,0.1)'],
      }}
      transition={{ duration: isSpeaking ? 0.7 : 2.5, repeat: Infinity }}
    >
      {failed ? (
        <div className="w-full h-full bg-eve-dim flex items-center justify-center text-eve-cyan/40 text-[10px] font-mono">◈</div>
      ) : (
        <img src={AURORA_IMG} alt="Aurora" className="w-full h-full object-cover object-top" onError={() => setFailed(true)} />
      )}
      {/* Scan line */}
      <motion.div
        className="absolute inset-x-0 pointer-events-none"
        style={{ height: '40%', background: 'linear-gradient(180deg, transparent, rgba(0,212,255,0.08), transparent)' }}
        animate={{ y: ['-100%', '250%'] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 1.5 }}
      />
    </motion.div>
  )
}

function StreamingCursor() {
  return (
    <motion.span
      className="inline-block w-[2px] h-[0.85em] bg-eve-cyan align-middle ml-[2px]"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.7, repeat: Infinity }}
    />
  )
}

export default function VoiceBubble({ messages, streaming, isSpeaking, toolStatus, onOpenComms, onClose }: VoiceBubbleProps) {
  const [minimized, setMinimized] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Show only the last user + assistant pair from this session
  const lastTwo = messages.slice(-2)
  const lastMsg = messages[messages.length - 1]
  const isAssistantStreaming = streaming && lastMsg?.role === 'assistant'

  // Auto-scroll to bottom as content streams in
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <AnimatePresence>
      <motion.div
        key="voice-bubble"
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 16 }}
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      >
        {/* Backdrop — subtle, doesn't block full interaction */}
        <div className="absolute inset-0 bg-eve-black/40 pointer-events-auto" onClick={() => setMinimized(false)} />

        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          className="relative pointer-events-auto w-full max-w-md mx-4"
          style={{ fontFamily: 'monospace' }}
        >
          {/* Corner brackets — outer frame */}
          <div className="absolute -inset-[3px] pointer-events-none z-10">
            <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-eve-cyan/70" />
            <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-eve-cyan/70" />
            <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-eve-cyan/70" />
            <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-eve-cyan/70" />
          </div>

          <div className="bg-eve-black border border-eve-cyan/25 overflow-hidden"
            style={{ boxShadow: '0 0 40px rgba(0,212,255,0.12), 0 0 80px rgba(0,212,255,0.06)' }}
          >
            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-eve-cyan/20 bg-eve-panel">
              {/* Pulse rings behind avatar */}
              <div className="relative flex items-center justify-center shrink-0" style={{ width: 36, height: 36 }}>
                <AnimatePresence>
                  {(isSpeaking || isAssistantStreaming) && [0, 1].map(i => (
                    <motion.div
                      key={i}
                      className="absolute inset-0 rounded-full border border-eve-cyan/40"
                      initial={{ scale: 0.9, opacity: 0.7 }}
                      animate={{ scale: 1.7 + i * 0.3, opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.4, ease: 'easeOut' }}
                    />
                  ))}
                </AnimatePresence>
                <AuroraThumb isSpeaking={isSpeaking || isAssistantStreaming} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-eve-cyan text-[11px] tracking-[0.3em] font-mono">AURORA</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <motion.div
                    className="w-1 h-1 rounded-full"
                    style={{ backgroundColor: isSpeaking ? '#00d4ff' : isAssistantStreaming ? '#ffd700' : '#33cc66' }}
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: isSpeaking || isAssistantStreaming ? 0.5 : 2, repeat: Infinity }}
                  />
                  <span className="text-eve-muted text-[9px] tracking-widest">
                    {isSpeaking ? 'TRANSMITTING' : isAssistantStreaming ? 'PROCESSING' : toolStatus ?? 'ONLINE'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setMinimized(v => !v)}
                  className="p-1.5 border border-eve-dim text-eve-muted hover:border-eve-cyan/40 hover:text-eve-cyan transition-colors"
                  title={minimized ? 'Expand' : 'Minimise'}
                >
                  {minimized ? <ChevronUp size={11} /> : <Minus size={11} />}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="p-1.5 border border-eve-dim text-eve-muted hover:border-eve-red/60 hover:text-eve-red transition-colors"
                  title="Dismiss"
                >
                  <X size={11} />
                </motion.button>
              </div>
            </div>

            {/* ── Body — collapses when minimised ── */}
            <AnimatePresence initial={false}>
              {!minimized && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  {/* Tool status bar */}
                  <AnimatePresence>
                    {toolStatus && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-4 py-1.5 border-b border-eve-gold/20 bg-eve-gold/5 flex items-center gap-2"
                      >
                        <motion.div
                          className="w-1 h-1 rounded-full bg-eve-gold"
                          animate={{ opacity: [1, 0.2, 1] }}
                          transition={{ duration: 0.5, repeat: Infinity }}
                        />
                        <span className="text-eve-gold text-[9px] tracking-widest">{toolStatus}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Messages */}
                  <div
                    ref={scrollRef}
                    className="max-h-64 overflow-y-auto px-4 py-3 flex flex-col gap-3 scrollbar-thin"
                  >
                    {lastTwo.length === 0 && (
                      <div className="text-eve-muted text-[10px] text-center py-4 tracking-widest">
                        <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
                          PROCESSING QUERY...
                        </motion.span>
                      </div>
                    )}

                    {lastTwo.map((msg, idx) => {
                      const isUser = msg.role === 'user'
                      const isLastMsg = idx === lastTwo.length - 1
                      const showCursor = isLastMsg && !isUser && streaming && msg.content.length > 0

                      return (
                        <div key={msg.id} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                          <div className={`w-5 h-5 rounded-sm border flex items-center justify-center text-[8px] font-mono shrink-0 mt-0.5
                            ${isUser ? 'border-eve-orange/40 text-eve-orange bg-eve-orange/10' : 'border-eve-cyan/40 text-eve-cyan bg-eve-cyan/10'}`}
                          >
                            {isUser ? 'YOU' : 'AUR'}
                          </div>

                          <div className={`flex-1 text-[11px] leading-relaxed font-mono ${isUser ? 'text-right text-eve-text/80' : 'text-eve-text'}`}>
                            {isUser ? (
                              <span className="text-eve-text/90">{msg.content}</span>
                            ) : msg.content ? (
                              <div className="prose prose-invert prose-sm max-w-none [&>*]:text-[11px] [&>p]:mb-1 [&>p]:leading-relaxed [&_table]:text-[10px] [&_table]:border-collapse [&_th]:border [&_th]:border-eve-border [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:text-eve-cyan [&_td]:border [&_td]:border-eve-border [&_td]:px-1.5 [&_td]:py-0.5">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                {showCursor && <StreamingCursor />}
                              </div>
                            ) : (
                              <motion.span
                                className="text-eve-muted text-[9px] tracking-widest"
                                animate={{ opacity: [1, 0.3, 1] }}
                                transition={{ duration: 0.8, repeat: Infinity }}
                              >
                                ···
                              </motion.span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── Footer ── */}
                  <div className="px-4 py-3 border-t border-eve-cyan/20 bg-eve-panel flex items-center justify-between gap-3">
                    <span className="text-eve-dim text-[9px] tracking-widest">
                      CAPSULEER INTELLIGENCE SYSTEM
                    </span>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={onOpenComms}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-eve-cyan/40 bg-eve-cyan/5 hover:bg-eve-cyan/10 hover:border-eve-cyan/70 text-eve-cyan text-[10px] tracking-widest transition-all"
                    >
                      <MessageSquare size={10} />
                      OPEN COMMS
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

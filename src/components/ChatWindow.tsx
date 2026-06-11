import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../types'

interface ChatWindowProps {
  messages: Message[]
  streaming: boolean
  toolStatus: string | null
  onEditMessage: (id: string, content: string) => void
}

// Convert large M (million) ISK values to B (billion): 1,067.0M → 1.067B
// Only fires when M is followed by a non-letter (avoids "10MN Afterburner" etc.)
function convertMillionsToBillions(text: string): string {
  return text.replace(/([\d,]+(?:\.\d+)?)M(?=[^a-zA-Z]|$)/g, (_match, numStr) => {
    const value = parseFloat(numStr.replace(/,/g, ''))
    if (value >= 1000) {
      const b = value / 1000
      const formatted = b.toFixed(3).replace(/\.?0+$/, '')
      return `${formatted}B`
    }
    return _match
  })
}

// Ensure markdown tables are always preceded by a blank line so GFM parses them correctly.
// Also collapse blank lines between table rows — Aurora sometimes emits one blank line per row,
// which GFM treats as paragraph breaks instead of continuing the table.
function normaliseMarkdown(text: string): string {
  // Handle table directly glued to prose with NO newline: "text.| col |" → "text.\n\n| col |"
  // Safe because Aurora always puts spaces around cell pipes, so word chars never touch | inside a cell.
  let out = text.replace(/([a-zA-Z0-9.%!?,;:)"'])(\|)/g, '$1\n\n$2')
  // Add blank line before first pipe row when separated by only a single newline
  out = out.replace(/([^\n])\n(\|)/g, '$1\n\n$2')
  // Remove blank lines between consecutive pipe rows (table body / header / separator)
  out = out.replace(/(\|[^\n]*)\n\n(\|)/g, '$1\n$2')
  // Repeat pass — handles tables with many rows
  out = out.replace(/(\|[^\n]*)\n\n(\|)/g, '$1\n$2')
  return out
}

function formatTime(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function MessageBubble({
  message,
  isLast,
  streaming,
  onEdit,
}: {
  message: Message
  isLast: boolean
  streaming: boolean
  onEdit: (id: string, content: string) => void
}) {
  const isUser = message.role === 'user'
  const showCursor = isLast && !isUser && streaming && message.content.length > 0
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar indicator */}
      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
        <div className={`w-5 h-5 rounded-sm border flex items-center justify-center text-[9px] font-mono
          ${isUser
            ? 'border-eve-orange/40 text-eve-orange bg-eve-orange/10'
            : 'border-eve-cyan/40 text-eve-cyan bg-eve-cyan/10'
          }`}
        >
          {isUser ? 'YOU' : 'AUR'}
        </div>
      </div>

      {/* Message content */}
      <div className={`flex-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`flex items-center gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className={`text-[10px] tracking-widest uppercase font-mono
            ${isUser ? 'text-eve-orange' : 'text-eve-cyan'}`}
          >
            {isUser ? 'CAPSULEER' : 'AURORA'}
          </span>
          <span className="text-eve-muted text-[10px]">{formatTime(message.timestamp)}</span>

          {/* Edit button — only on user messages when hovered */}
          <AnimatePresence>
            {isUser && hovered && !streaming && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => onEdit(message.id, message.content)}
                className="text-eve-muted hover:text-eve-cyan transition-colors p-0.5"
                title="Edit message"
              >
                <Pencil size={10} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div className={`
          relative px-3 py-2.5 text-sm font-mono leading-relaxed
          ${isUser
            ? 'bg-eve-orange/5 border border-eve-orange/20 text-eve-text ml-auto'
            : 'bg-eve-cyan/5 border border-eve-cyan/15 text-eve-text'
          }
        `}>
          {/* Corner brackets */}
          <div className={`absolute top-0 left-0 w-2 h-2 border-t border-l
            ${isUser ? 'border-eve-orange/40' : 'border-eve-cyan/40'}`} />
          <div className={`absolute bottom-0 right-0 w-2 h-2 border-b border-r
            ${isUser ? 'border-eve-orange/40' : 'border-eve-cyan/40'}`} />

          {isUser ? (
            <span className="whitespace-pre-wrap">
              {message.content || '...'}
            </span>
          ) : (
            <div className="aurora-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="w-full border-collapse text-xs">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="border-b border-eve-cyan/30">{children}</thead>
                  ),
                  tbody: ({ children }) => <tbody>{children}</tbody>,
                  tr: ({ children }) => (
                    <tr className="border-b border-eve-border/20 hover:bg-eve-cyan/5 transition-colors">{children}</tr>
                  ),
                  th: ({ children }) => (
                    <th className="px-3 py-1.5 text-left text-eve-cyan text-[10px] tracking-widest uppercase font-mono whitespace-nowrap">{children}</th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-1.5 text-eve-text font-mono text-xs whitespace-nowrap">{children}</td>
                  ),
                  strong: ({ children }) => (
                    <strong className="text-eve-cyan font-bold">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="text-eve-gold not-italic">{children}</em>
                  ),
                  code: ({ children }) => (
                    <code className="text-eve-orange bg-eve-orange/10 px-1 rounded text-[11px] font-mono">{children}</code>
                  ),
                  h1: ({ children }) => (
                    <div className="text-eve-cyan text-xs tracking-widest uppercase font-mono mt-3 mb-1 border-b border-eve-cyan/20 pb-1">{children}</div>
                  ),
                  h2: ({ children }) => (
                    <div className="text-eve-cyan/80 text-[11px] tracking-widest uppercase font-mono mt-2 mb-1">{children}</div>
                  ),
                  h3: ({ children }) => (
                    <div className="text-eve-muted text-[10px] tracking-widest uppercase font-mono mt-2 mb-0.5">{children}</div>
                  ),
                  p: ({ children }) => (
                    <p className="leading-relaxed mb-1 last:mb-0">{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-none space-y-0.5 my-1">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-none space-y-0.5 my-1 counter-reset-item">{children}</ol>
                  ),
                  li: ({ children }) => (
                    <li className="flex gap-2 text-xs"><span className="text-eve-cyan/50 shrink-0">▸</span><span>{children}</span></li>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-eve-cyan/30 pl-3 text-eve-muted italic my-1">{children}</blockquote>
                  ),
                  hr: () => <hr className="border-eve-border/30 my-2" />,
                }}
              >
                {convertMillionsToBillions(normaliseMarkdown(message.content || ''))}
              </ReactMarkdown>
            </div>
          )}
          {showCursor && <span className="typing-cursor" />}

          {!isUser && message.content === '' && streaming && isLast && (
            <span className="text-eve-cyan/60 text-xs tracking-widest">
              PROCESSING
              <motion.span
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              >...</motion.span>
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default function ChatWindow({ messages, streaming, toolStatus, onEditMessage }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center h-full gap-4 text-center py-16"
        >
          <div className="text-eve-cyan/20 text-6xl font-mono">◈</div>
          <div>
            <div className="text-eve-cyan text-sm tracking-widest uppercase mb-1">AURORA ONLINE</div>
            <div className="text-eve-muted text-xs max-w-xs leading-relaxed">
              Capsuleer intelligence system active. Query regarding skills, industry, assets, or market operations.
            </div>
          </div>
          <div className="text-eve-dim text-[10px] tracking-widest">
            ▸ EVE ONLINE · NEW EDEN · YC {new Date().getFullYear() - 1898}
          </div>
        </motion.div>
      )}

      <AnimatePresence initial={false}>
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isLast={i === messages.length - 1}
            streaming={streaming}
            onEdit={onEditMessage}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {toolStatus && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 px-3 py-1.5 border border-eve-cyan/20 bg-eve-cyan/5 w-fit"
          >
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="text-eve-cyan text-[10px]"
            >◈</motion.span>
            <span className="text-eve-cyan/70 text-[10px] tracking-widest font-mono">{toolStatus}...</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={bottomRef} />
    </div>
  )
}

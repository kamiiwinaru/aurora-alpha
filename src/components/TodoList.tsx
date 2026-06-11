import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

interface TodoItem {
  id: string
  text: string
  done: boolean
}

const API = 'http://localhost:3001/api/todos'

export default function TodoList() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<TodoItem[]>([])
  const [draft, setDraft] = useState('')
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch(API)
      if (res.ok) setItems(await res.json())
    } catch { /* server not ready yet */ }
  }, [])

  // Initial load + poll while open so chat-added items appear
  useEffect(() => { fetchTodos() }, [fetchTodos])
  useEffect(() => {
    if (!open) return
    fetchTodos()
    const id = setInterval(fetchTodos, 3000)
    return () => clearInterval(id)
  }, [open, fetchTodos])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const add = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.ok) { const item = await res.json(); setItems(prev => [...prev, item]) }
    } catch { /* ignore */ }
  }

  const toggle = async (item: TodoItem) => {
    try {
      const res = await fetch(`${API}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !item.done }),
      })
      if (res.ok) setItems(prev => prev.map(i => i.id === item.id ? { ...i, done: !i.done } : i))
    } catch { /* ignore */ }
  }

  const remove = async (id: string) => {
    try {
      await fetch(`${API}/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(i => i.id !== id))
    } catch { /* ignore */ }
  }

  const pending = items.filter(i => !i.done).length

  return (
    <>
      {/* Notepad icon button — sits top-right of avatar */}
      <button
        ref={btnRef}
        onClick={() => {
          if (btnRef.current) {
            const r = btnRef.current.getBoundingClientRect()
            setPanelPos({ top: r.top, left: r.right + 10 })
          }
          setOpen(v => !v)
        }}
        className="absolute top-1.5 right-1.5 z-20 w-6 h-6 flex items-center justify-center rounded bg-black/60 border border-eve-border hover:border-eve-cyan hover:text-eve-cyan transition-colors text-eve-muted"
        title="To-do list"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="1" width="9" height="11" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none"/>
          <line x1="4" y1="3.5" x2="9" y2="3.5" stroke="currentColor" strokeWidth="1"/>
          <line x1="4" y1="5.5" x2="9" y2="5.5" stroke="currentColor" strokeWidth="1"/>
          <line x1="4" y1="7.5" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1"/>
          <rect x="1.5" y="0.5" width="2" height="2" rx="0.5" stroke="currentColor" strokeWidth="0.8" fill="none"/>
          <rect x="9.5" y="0.5" width="2" height="2" rx="0.5" stroke="currentColor" strokeWidth="0.8" fill="none"/>
        </svg>
        {pending > 0 && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-eve-cyan text-black text-[8px] font-bold flex items-center justify-center leading-none">
            {pending > 9 ? '9+' : pending}
          </span>
        )}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: -6 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -6 }}
            transition={{ duration: 0.15 }}
            className="eve-panel border border-eve-border shadow-xl shadow-black/80"
            style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 9999, minWidth: '240px', width: 'max-content', maxWidth: '340px' }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-eve-border">
              <span className="eve-header text-[10px]">TASK LIST</span>
              <button
                onClick={() => setOpen(false)}
                className="text-eve-dim hover:text-eve-cyan text-xs leading-none"
              >
                ✕
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto px-3 py-2 space-y-1.5">
              {items.length === 0 && (
                <div className="text-xs text-eve-dim text-center py-4">No tasks logged.</div>
              )}
              {items.map(item => (
                <div key={item.id} className="flex items-start gap-2 group">
                  <button
                    onClick={() => toggle(item)}
                    className={`mt-0.5 w-4 h-4 shrink-0 border rounded-sm flex items-center justify-center transition-colors ${
                      item.done
                        ? 'border-eve-cyan bg-eve-cyan/20 text-eve-cyan'
                        : 'border-eve-border text-transparent hover:border-eve-cyan'
                    }`}
                  >
                    {item.done && (
                      <svg width="9" height="9" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4L3.5 6L6.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                  <span className={`flex-1 text-xs leading-snug whitespace-pre-wrap break-words ${item.done ? 'line-through text-eve-dim' : 'text-eve-text'}`}>
                    {item.text}
                  </span>
                  <button
                    onClick={() => remove(item.id)}
                    className="shrink-0 text-eve-dim hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none mt-0.5"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-eve-border px-3 py-2 flex gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add() }}
                placeholder="Add task…"
                className="flex-1 bg-transparent text-xs text-eve-text placeholder-eve-dim outline-none border-b border-eve-border focus:border-eve-cyan transition-colors py-0.5"
              />
              <button
                onClick={add}
                disabled={!draft.trim()}
                className="text-xs text-eve-cyan disabled:text-eve-dim transition-colors hover:text-eve-gold"
              >
                ADD
              </button>
            </div>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { version } from '../../package.json'
import type { ActivePanel } from '../types'

interface Props {
  activePanel: ActivePanel
  onClose: () => void
  screenshot?: string | null
}

const BUG_TYPES = ['Bug', 'UI Issue', 'Feature Request', 'Other'] as const

export default function FeedbackModal({ activePanel, onClose, screenshot }: Props) {
  const [type, setType] = useState<string>('Bug')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState('')
  const [stepsOpen, setStepsOpen] = useState(false)
  const [includeScreenshot, setIncludeScreenshot] = useState(!!screenshot)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit() {
    if (!description.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          description: description.trim(),
          steps: steps.trim() || null,
          panel: activePanel,
          version,
          screenshot: includeScreenshot ? screenshot : null,
        }),
      })
      setSubmitted(true)
      setTimeout(onClose, 1400)
    } catch {
      setSubmitting(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="eve-panel border border-eve-border w-[420px] max-w-[95vw] relative"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Corner decorations */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-eve-cyan/60" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-eve-cyan/60" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-eve-cyan/60" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-eve-cyan/60" />

          <div className="p-4 border-b border-eve-border flex items-center justify-between">
            <span className="eve-header text-xs tracking-widest">SUBMIT FEEDBACK</span>
            <div className="flex items-center gap-3 text-[10px] font-mono text-eve-dim">
              <span>v{version}</span>
              <span>PANEL: {activePanel.toUpperCase()}</span>
            </div>
          </div>

          {submitted ? (
            <div className="p-6 text-center text-eve-cyan text-sm tracking-widest">
              FEEDBACK LOGGED. THANK YOU.
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-3">
              <div>
                <div className="eve-label mb-1">TYPE</div>
                <div className="flex gap-2 flex-wrap">
                  {BUG_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={`eve-btn text-[10px] px-3 py-1 ${type === t ? 'border-eve-cyan text-eve-cyan' : ''}`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="eve-label mb-1">DESCRIPTION</div>
                <textarea
                  className="eve-input w-full h-24 resize-none text-xs"
                  placeholder="Describe the issue or feedback..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <button
                  className="flex items-center gap-1.5 text-[10px] text-eve-dim hover:text-eve-cyan transition-colors tracking-widest"
                  onClick={() => setStepsOpen(v => !v)}
                >
                  <span>{stepsOpen ? '▾' : '▸'}</span>
                  <span>STEPS TO REPRODUCE</span>
                  <span className="text-eve-border ml-1">— OPTIONAL</span>
                </button>
                {stepsOpen && (
                  <textarea
                    className="eve-input w-full h-16 resize-none text-xs mt-1.5"
                    placeholder="What were you doing when this happened?"
                    value={steps}
                    onChange={e => setSteps(e.target.value)}
                  />
                )}
              </div>

              {!!screenshot && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => setIncludeScreenshot(v => !v)}
                    className={`w-3.5 h-3.5 border flex items-center justify-center transition-colors ${
                      includeScreenshot ? 'border-eve-cyan bg-eve-cyan/20' : 'border-eve-border'
                    }`}
                  >
                    {includeScreenshot && <div className="w-1.5 h-1.5 bg-eve-cyan" />}
                  </div>
                  <span className="text-eve-dim text-[10px] tracking-widest">INCLUDE SCREENSHOT</span>
                </label>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <button className="eve-btn text-[10px] px-4 py-1.5" onClick={onClose}>
                  CANCEL
                </button>
                <button
                  className="eve-btn-primary text-[10px] px-4 py-1.5 disabled:opacity-40"
                  onClick={handleSubmit}
                  disabled={submitting || !description.trim()}
                >
                  {submitting ? 'SUBMITTING...' : 'SUBMIT'}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

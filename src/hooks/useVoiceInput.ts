import { useState, useRef, useCallback, useEffect } from 'react'
import { loadVoskModel, prewarmAudio, VoskSession, type VoskStatus } from '../lib/voskRecognizer'

export type VoicePhase = 'off' | 'standby' | 'activated' | 'listening' | 'pending'

// Silence delay before auto-submit (ms)
const SILENCE_DELAY = 2000


function getSpeechRecognition(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  return (
    (window as unknown as Record<string, unknown>).SpeechRecognition as (new () => SpeechRecognition) | undefined
    ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition as (new () => SpeechRecognition) | undefined
    ?? null
  )
}

function stripWakeWord(text: string): string {
  return text.replace(/^(aurora)[,\s]*/i, '').trim()
}

function containsWakeWord(text: string): boolean {
  return /\baurora\b/i.test(text)
}

interface UseVoiceInputOptions {
  /** Called when the voice session produces a final query to send */
  onSubmit: (text: string) => void
  /** Whether voice TTS is enabled (used to decide whether to re-arm after speaking) */
  voiceEnabled?: boolean
  /** Increments when Aurora finishes speaking a question — triggers auto-listen */
  autoListenTrigger?: number
  /** If true, after submit the system returns to standby (wake-word armed) rather than off */
  returnToStandby?: boolean
}

export function useVoiceInput({
  onSubmit,
  voiceEnabled,
  autoListenTrigger,
  returnToStandby = false,
}: UseVoiceInputOptions) {
  const [phase, setPhase] = useState<VoicePhase>('off')
  const [value, setValue] = useState('')
  const [interimText, setInterimText] = useState('')
  const [countdown, setCountdown] = useState(0)

  const SpeechRecognitionClass = getSpeechRecognition()

  // Refs so closures inside recognition handlers always see current values
  const phaseRef = useRef<VoicePhase>('off')
  const valueRef = useRef('')
  const wakeEnabledRef = useRef(false)
  const wakeRef = useRef<SpeechRecognition | null>(null)
  const activeRef = useRef<SpeechRecognition | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startWakeRef = useRef<() => void>(() => {})
  const armSilenceTimerRef = useRef<() => void>(() => {})

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { valueRef.current = value }, [value])

  // ── Vosk (Electron only) ────────────────────────────────────────────────
  const isElectron = !!window.electronAPI
  const [voskStatus, setVoskStatus] = useState<VoskStatus>('idle')
  const [voskDownloadPct, setVoskDownloadPct] = useState(0)
  const voskSessionRef = useRef<VoskSession | null>(null)
  const voskPartialRef = useRef('')

  const ensureVoskReady = useCallback(async () => {
    if (!isElectron || voskStatus === 'ready' || voskStatus === 'loading') return
    setVoskStatus('loading')
    try {
      await loadVoskModel(pct => setVoskDownloadPct(pct))
      setVoskStatus('ready')
      prewarmAudio()
    } catch (err) {
      console.error('Vosk model load failed:', err)
      setVoskStatus('error')
    }
  }, [isElectron, voskStatus])

  // Pre-load the model immediately on Electron mount so it's ready when the user first speaks
  useEffect(() => {
    if (isElectron) ensureVoskReady()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopVosk = useCallback(() => {
    voskSessionRef.current?.stop()
    voskSessionRef.current = null
    voskPartialRef.current = ''
    setInterimText('')
  }, [])

  const startVosk = useCallback(async (prefill = '') => {
    if (voskStatus !== 'ready') return
    stopVosk()

    if (prefill) {
      setValue(prev => {
        const base = prev.trimEnd()
        return base ? `${base} ${prefill}` : prefill
      })
    }

    setPhase('listening')
    try {
      const model = await loadVoskModel()
      const session = await VoskSession.create(model, ({ text, partial }) => {
        if (partial) {
          voskPartialRef.current = text
          setInterimText(text)
        } else {
          voskPartialRef.current = ''
          setInterimText('')
          setValue(prev => {
            const base = prev.trimEnd()
            return base ? `${base} ${text}` : text
          })
          armSilenceTimerRef.current()
        }
      })
      voskSessionRef.current = session
    } catch (err) {
      console.error('Vosk session failed:', err)
      setPhase(wakeEnabledRef.current ? 'standby' : 'off')
    }
  }, [voskStatus, stopVosk])

  // ── Silence / countdown timer ───────────────────────────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    silenceTimerRef.current = null
    countdownIntervalRef.current = null
    setCountdown(0)
  }, [])

  const submitVoiceInput = useCallback(() => {
    clearSilenceTimer()
    const msg = valueRef.current.trim()
    if (msg) onSubmit(msg)
    setValue('')
    setInterimText('')
    // Return to standby if wake mode is armed or returnToStandby is set
    if (wakeEnabledRef.current || returnToStandby) {
      setPhase('standby')
      setTimeout(() => startWakeRef.current(), 200)
    } else {
      setPhase('off')
    }
  }, [onSubmit, clearSilenceTimer, returnToStandby])

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer()
    setPhase('pending')
    setCountdown(SILENCE_DELAY / 1000)

    let remaining = SILENCE_DELAY / 1000
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 0.1
      setCountdown(Math.max(0, +remaining.toFixed(1)))
    }, 100)

    silenceTimerRef.current = setTimeout(() => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      setCountdown(0)
      submitVoiceInput()
    }, SILENCE_DELAY)
  }, [clearSilenceTimer, submitVoiceInput])

  // ── Active listening session ────────────────────────────────────────────
  const stopActive = useCallback(() => {
    if (isElectron) {
      stopVosk()
      clearSilenceTimer()
      return
    }
    activeRef.current?.stop()
    activeRef.current = null
    clearSilenceTimer()
    setInterimText('')
  }, [isElectron, stopVosk, clearSilenceTimer])

  const startActive = useCallback((prefill = '') => {
    if (isElectron) { startVosk(prefill); return }
    if (!SpeechRecognitionClass) return
    stopActive()

    if (prefill) {
      setValue(prev => {
        const base = prev.trimEnd()
        return base ? `${base} ${prefill}` : prefill
      })
    }

    const rec = new SpeechRecognitionClass()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onstart = () => setPhase('listening')

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      setInterimText(interim)
      if (final) {
        setValue(prev => {
          const base = prev.trimEnd()
          return base ? `${base} ${final.trim()}` : final.trim()
        })
        setInterimText('')
        armSilenceTimer()
      }
    }

    rec.onend = () => {
      activeRef.current = null
      setInterimText('')
    }

    rec.onerror = () => {
      activeRef.current = null
      setInterimText('')
      if (wakeEnabledRef.current) setPhase('standby')
      else setPhase('off')
    }

    activeRef.current = rec
    rec.start()
  }, [SpeechRecognitionClass, stopActive, armSilenceTimer])

  // ── Wake word listener ──────────────────────────────────────────────────
  const stopWake = useCallback(() => {
    if (wakeRef.current) {
      wakeRef.current.abort()
      wakeRef.current = null
    }
  }, [])

  const startWake = useCallback(() => {
    if (!SpeechRecognitionClass || !wakeEnabledRef.current || wakeRef.current) return

    const rec = new SpeechRecognitionClass()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 3

    rec.onresult = (e: SpeechRecognitionEvent) => {
      if (phaseRef.current !== 'standby') return
      for (let i = e.resultIndex; i < e.results.length; i++) {
        for (let alt = 0; alt < e.results[i].length; alt++) {
          const transcript = e.results[i][alt].transcript
          if (containsWakeWord(transcript)) {
            const afterWake = stripWakeWord(transcript)
            wakeRef.current = null
            rec.abort()
            setPhase('activated')
            // 50 ms: practical floor for Chrome to release the audio context
            // after abort() before a new session can start cleanly.
            // Words in the same breath as "Aurora" are already in afterWake,
            // so this gap only matters on a deliberate post-wake pause.
            setTimeout(() => {
              if (wakeEnabledRef.current) startActive(afterWake)
            }, 50)
            return
          }
        }
      }
    }

    rec.onend = () => {
      wakeRef.current = null
      if (wakeEnabledRef.current && phaseRef.current === 'standby') {
        setTimeout(() => startWakeRef.current(), 150)
      }
    }

    rec.onerror = (e) => {
      wakeRef.current = null
      if (e.error === 'not-allowed') {
        wakeEnabledRef.current = false
        setPhase('off')
        return
      }
      if (wakeEnabledRef.current && phaseRef.current === 'standby') {
        setTimeout(() => startWakeRef.current(), 300)
      }
    }

    wakeRef.current = rec
    try { rec.start() } catch { wakeRef.current = null }
  }, [SpeechRecognitionClass, startActive])

  useEffect(() => { startWakeRef.current = startWake }, [startWake])
  useEffect(() => { armSilenceTimerRef.current = armSilenceTimer }, [armSilenceTimer])

  // Start wake listener whenever phase enters standby
  // In Electron, Vosk handles wake detection via a continuous session
  useEffect(() => {
    if (phase !== 'standby' || !wakeEnabledRef.current) return
    if (isElectron) {
      if (voskStatus !== 'ready') return
      // Run Vosk continuously in standby — look for wake word in partial results
      let session: VoskSession | null = null
      loadVoskModel().then(async model => {
        if (phaseRef.current !== 'standby') return
        session = await VoskSession.create(model, ({ text, partial }) => {
          if (phaseRef.current !== 'standby') { session?.stop(); session = null; return }
          const t = (text || '').toLowerCase()
          if (containsWakeWord(t)) {
            session?.stop()
            session = null
            const afterWake = stripWakeWord(t)
            setPhase('activated')
            setTimeout(() => {
              if (wakeEnabledRef.current) startActive(afterWake)
            }, 50)
          } else if (!partial && t) {
            // non-wake utterance — ignore but reset
          }
        })
        voskSessionRef.current = session
      }).catch(() => {})
      return () => { session?.stop(); session = null }
    }
    startWake()
  }, [phase, isElectron, voskStatus, startWake, startActive])

  // ── Wake mode toggle ────────────────────────────────────────────────────
  const toggleWakeMode = useCallback(() => {
    if (wakeEnabledRef.current) {
      wakeEnabledRef.current = false
      stopWake()
      stopActive()
      clearSilenceTimer()
      setPhase('off')
      setValue('')
      setInterimText('')
    } else {
      wakeEnabledRef.current = true
      setPhase('standby')
      // In Electron, kick off model download immediately so it's ready when needed
      if (isElectron) ensureVoskReady()
    }
  }, [isElectron, ensureVoskReady, stopWake, stopActive, clearSilenceTimer])

  // ── Manual mic toggle ───────────────────────────────────────────────────
  const toggleManualMic = useCallback(() => {
    if (phase === 'listening' || phase === 'pending') {
      stopActive()
      clearSilenceTimer()
      if (wakeEnabledRef.current) setPhase('standby')
      else setPhase('off')
    } else {
      startActive()
    }
  }, [phase, stopActive, clearSilenceTimer, startActive])

  // ── Auto-listen when Aurora finishes speaking a question ────────────────
  const autoListenInitRef = useRef(true)
  useEffect(() => {
    if (autoListenInitRef.current) { autoListenInitRef.current = false; return }
    if (!voiceEnabled || !SpeechRecognitionClass) return
    if (phaseRef.current === 'listening' || phaseRef.current === 'pending') return
    setTimeout(() => startActive(), 300)
  }, [autoListenTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Submit on Enter / programmatic call ────────────────────────────────
  const submitNow = useCallback(() => {
    clearSilenceTimer()
    submitVoiceInput()
  }, [clearSilenceTimer, submitVoiceInput])

  // ── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      wakeEnabledRef.current = false
      stopWake()
      stopVosk()
      stopActive()
      clearSilenceTimer()
    }
  }, [stopWake, stopVosk, stopActive, clearSilenceTimer])

  const wakeArmed = phase === 'standby' || phase === 'activated'
  const isListening = phase === 'listening' || phase === 'pending'
  const isSupported = isElectron || !!SpeechRecognitionClass

  return {
    phase,
    value,
    setValue,
    interimText,
    countdown,
    wakeArmed,
    isListening,
    isSupported,
    voskStatus,
    voskDownloadPct,
    toggleWakeMode,
    toggleManualMic,
    startActive,
    submitNow,
    clearSilenceTimer,
  }
}

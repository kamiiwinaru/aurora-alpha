import { useState, useRef, useCallback, useEffect } from 'react'
import { loadVoskModel, prewarmAudio, VoskSession, type VoskStatus } from '../lib/voskRecognizer'
import { PTT_KEY_STORAGE, PTT_KEY_DEFAULT, NOISE_FLOOR_KEY, NOISE_FLOOR_DEFAULT } from '../components/OptionsMenu'

export type VoicePhase = 'off' | 'standby' | 'activated' | 'listening' | 'pending' | 'transcribing'

// Silence delay before auto-submit (ms) — used by Web Speech fallback path
const SILENCE_DELAY = 2000


function getSpeechRecognition(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  return (
    (window as unknown as Record<string, unknown>).SpeechRecognition as (new () => SpeechRecognition) | undefined
    ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition as (new () => SpeechRecognition) | undefined
    ?? null
  )
}

// function stripWakeWord(text: string): string {
//   return text.replace(/^(aurora)[,\s]*/i, '').trim()
// }

// function containsWakeWord(text: string): boolean {
//   return /\baurora\b/i.test(text)
// }

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
  // const wakeEnabledRef = useRef(false)
  // const wakeRef = useRef<SpeechRecognition | null>(null)
  const activeRef = useRef<SpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // const startWakeRef = useRef<() => void>(() => {})
  const armSilenceTimerRef = useRef<() => void>(() => {})

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { valueRef.current = value }, [value])

  // ── Vosk (stubbed — Smart App Control blocks WASM in production) ─────────
  const [voskStatus] = useState<VoskStatus>('idle')
  const [voskDownloadPct] = useState(0)
  const voskSessionRef = useRef<VoskSession | null>(null)

  // const ensureVoskReady = useCallback(async () => { ... }, [])

  const stopVosk = useCallback(() => {
    voskSessionRef.current?.stop()
    voskSessionRef.current = null
    setInterimText('')
  }, [])

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
    setPhase('off')
  }, [onSubmit, clearSilenceTimer])

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

  useEffect(() => { armSilenceTimerRef.current = armSilenceTimer }, [armSilenceTimer])

  // ── Web Speech active listening (browser fallback, not used in Electron) ─
  const stopActive = useCallback(() => {
    activeRef.current?.stop()
    activeRef.current = null
    clearSilenceTimer()
    setInterimText('')
  }, [clearSilenceTimer])

  const startActive = useCallback((prefill = '') => {
    if (!SpeechRecognitionClass) return
    stopActive()

    if (prefill) {
      setValue(prev => {
        const base = prev.trimEnd()
        return base ? `${base} ${prefill}` : prefill
      })
    }

    setPhase('listening')
    const rec = new SpeechRecognitionClass()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'

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
        armSilenceTimerRef.current()
      }
    }

    rec.onend = () => {
      activeRef.current = null
      setInterimText('')
    }

    rec.onerror = (e: any) => {
      console.error('[SpeechRecognition] error:', e.error, e.message)
      activeRef.current = null
      setInterimText('')
      setPhase('off')
    }

    activeRef.current = rec
    rec.start()
  }, [SpeechRecognitionClass, stopActive])

  // ── Wake word listener — COMMENTED OUT (parked until Vosk is unblocked) ──
  // const stopWake = useCallback(() => {
  //   if (wakeRef.current) { wakeRef.current.abort(); wakeRef.current = null }
  // }, [])
  //
  // const startWake = useCallback(() => {
  //   if (!SpeechRecognitionClass || !wakeEnabledRef.current || wakeRef.current) return
  //   const rec = new SpeechRecognitionClass()
  //   rec.continuous = false; rec.interimResults = true; rec.lang = 'en-US'; rec.maxAlternatives = 3
  //   rec.onresult = (e: SpeechRecognitionEvent) => {
  //     if (phaseRef.current !== 'standby') return
  //     for (let i = e.resultIndex; i < e.results.length; i++) {
  //       for (let alt = 0; alt < e.results[i].length; alt++) {
  //         const transcript = e.results[i][alt].transcript
  //         if (containsWakeWord(transcript)) {
  //           const afterWake = stripWakeWord(transcript)
  //           wakeRef.current = null; rec.abort()
  //           setPhase('activated')
  //           setTimeout(() => { if (wakeEnabledRef.current) startActive(afterWake) }, 50)
  //           return
  //         }
  //       }
  //     }
  //   }
  //   rec.onend = () => {
  //     wakeRef.current = null
  //     if (wakeEnabledRef.current && phaseRef.current === 'standby') setTimeout(() => startWakeRef.current(), 150)
  //   }
  //   rec.onerror = (e: any) => {
  //     wakeRef.current = null
  //     if (e.error === 'not-allowed') { wakeEnabledRef.current = false; setPhase('off'); return }
  //     if (wakeEnabledRef.current && phaseRef.current === 'standby') setTimeout(() => startWakeRef.current(), 300)
  //   }
  //   wakeRef.current = rec
  //   try { rec.start() } catch { wakeRef.current = null }
  // }, [SpeechRecognitionClass, startActive])
  //
  // useEffect(() => { startWakeRef.current = startWake }, [startWake])
  //
  // // Start wake listener whenever phase enters standby
  // useEffect(() => {
  //   if (phase !== 'standby' || !wakeEnabledRef.current) return
  //   startWake()
  // }, [phase, startWake])
  //
  // const toggleWakeMode = useCallback(() => {
  //   if (wakeEnabledRef.current) {
  //     wakeEnabledRef.current = false; stopWake(); stopActive(); clearSilenceTimer()
  //     setPhase('off'); setValue(''); setInterimText('')
  //   } else {
  //     wakeEnabledRef.current = true; setPhase('standby')
  //   }
  // }, [stopWake, stopActive, clearSilenceTimer])

  // ── Noise filtering helpers ─────────────────────────────────────────────
  const noiseFloorRef = useRef(Number(localStorage.getItem(NOISE_FLOOR_KEY) ?? NOISE_FLOOR_DEFAULT))
  useEffect(() => {
    function onChanged(e: Event) {
      noiseFloorRef.current = (e as CustomEvent<number>).detail
    }
    window.addEventListener('aurora_noise_floor_changed', onChanged)
    return () => window.removeEventListener('aurora_noise_floor_changed', onChanged)
  }, [])
  // Noise-only transcript patterns — single filler words, punctuation, brackets
  const NOISE_TRANSCRIPT_RE = /^[\s.,!?;:()\[\]{}"'`~@#$%^&*_+=|\\/<>-]+$/
  const NOISE_WORDS = new Set(['um', 'uh', 'hmm', 'hm', 'ah', 'oh', 'er', 'mm'])

  function isNoiseTranscript(text: string): boolean {
    const t = text.trim()
    if (!t || t.length < 2) return true
    if (NOISE_TRANSCRIPT_RE.test(t)) return true
    if (NOISE_WORDS.has(t.toLowerCase())) return true
    // Must contain at least one letter or digit
    if (!/[a-zA-Z0-9]/.test(t)) return true
    return false
  }

  // ── ElevenLabs Scribe push-to-talk ─────────────────────────────────────
  const startScribeRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

      // Monitor audio level during recording to detect silence/noise-only sessions
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const freqData = new Uint8Array(analyser.frequencyBinCount)
      let peakLevel = 0
      const levelTimer = setInterval(() => {
        analyser.getByteFrequencyData(freqData)
        const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length
        if (avg > peakLevel) peakLevel = avg
      }, 50)

      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = async () => {
        clearInterval(levelTimer)
        audioCtx.close()
        stream.getTracks().forEach(t => t.stop())

        // Skip Scribe entirely if audio never rose above noise floor
        if (peakLevel < noiseFloorRef.current) {
          setPhase('off')
          return
        }

        setPhase('transcribing')
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        try {
          const resp = await fetch('/api/stt', {
            method: 'POST',
            headers: { 'Content-Type': blob.type },
            body: blob,
          })
          const data = await resp.json() as { text?: string }
          const transcript = data.text?.trim() ?? ''
          if (!isNoiseTranscript(transcript)) setValue(transcript)
        } catch (err) {
          console.error('[Scribe] STT failed:', err)
        }
        setPhase('off')
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setPhase('listening')
    } catch (err) {
      console.error('[Scribe] getUserMedia failed:', err)
      setPhase('off')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopScribeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
  }, [])

  // ── PTT keyboard shortcut — configurable hold-to-talk ──────────────────
  const pttKeyRef = useRef(localStorage.getItem(PTT_KEY_STORAGE) ?? PTT_KEY_DEFAULT)

  useEffect(() => {
    function onPttChanged(e: Event) {
      pttKeyRef.current = (e as CustomEvent<string>).detail
    }
    window.addEventListener('aurora_ptt_changed', onPttChanged)
    return () => window.removeEventListener('aurora_ptt_changed', onPttChanged)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== pttKeyRef.current || e.repeat) return
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (phaseRef.current === 'off') startScribeRecording()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== pttKeyRef.current) return
      if (phaseRef.current === 'listening') {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop()
          mediaRecorderRef.current = null
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [startScribeRecording])

  // ── Manual mic toggle — Scribe push-to-talk ────────────────────────────
  const toggleManualMic = useCallback(() => {
    if (phase === 'listening') {
      stopScribeRecording()
      // onstop handler transitions to 'transcribing' then 'off'
    } else if (phase === 'transcribing') {
      // already uploading, ignore
    } else if (phase === 'pending') {
      stopActive()
      clearSilenceTimer()
      setPhase('off')
    } else {
      startScribeRecording()
    }
  }, [phase, stopScribeRecording, stopActive, clearSilenceTimer, startScribeRecording])

  // ── Global PTT via Electron IPC (fires when Aurora window is not focused) ─
  const toggleManualMicRef = useRef(toggleManualMic)
  useEffect(() => { toggleManualMicRef.current = toggleManualMic }, [toggleManualMic])

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.onPttToggle) return
    const unsub = api.onPttToggle(() => toggleManualMicRef.current())
    return unsub
  }, [])

  // Auto-listen removed — PTT is the input model; recording only on explicit trigger.

  // ── Submit on Enter / programmatic call ────────────────────────────────
  const submitNow = useCallback(() => {
    clearSilenceTimer()
    submitVoiceInput()
  }, [clearSilenceTimer, submitVoiceInput])

  // ── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopVosk()
      stopActive()
      stopScribeRecording()
      clearSilenceTimer()
    }
  }, [stopVosk, stopActive, stopScribeRecording, clearSilenceTimer])

  const wakeArmed = false // wake word parked
  const isListening = phase === 'listening' || phase === 'pending' || phase === 'transcribing'
  const isSupported = true // MediaRecorder is universally available

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
    toggleWakeMode: () => {}, // parked
    toggleManualMic,
    startActive,
    submitNow,
    clearSilenceTimer,
  }
}

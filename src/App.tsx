import { useState, useEffect, useRef } from 'react'
import { buildIntelReport } from './lib/intel-report'
import { INTEL_SESSION_KEY } from './hooks/useChat'
import { version } from '../package.json'
import { motion } from 'framer-motion'
import { Brain, TrendingUp } from 'lucide-react'

import Sidebar from './components/Sidebar'
import ChatWindow from './components/ChatWindow'
import ChatInput from './components/ChatInput'
import NavTabs from './components/NavTabs'
import EveLogin from './components/EveLogin'
import LandingPage from './components/LandingPage'
import SkillPanel from './components/panels/SkillPanel'
import IndustryPanel from './components/panels/IndustryPanel'
import AssetsPanel from './components/panels/AssetsPanel'
import MarketPanel from './components/panels/MarketPanel'
import JanicePanel from './components/panels/JanicePanel'
import ZkillPanel, { type ZkillTarget } from './components/panels/ZkillPanel'
import IntelPanel from './components/panels/IntelPanel'
import RoadmapPanel from './components/panels/RoadmapPanel'
import MapPanel from './components/panels/MapPanel'
import NotificationsPanel from './components/panels/NotificationsPanel'
import VoiceBubble from './components/VoiceBubble'
import VoiceSettingsModal from './components/VoiceSettingsModal'
import VentureGame from './components/VentureGame'
import WalletWindow from './components/panels/WalletWindow'
import UsageBar from './components/UsageBar'
import TitleBar from './components/TitleBar'
import OptionsMenu from './components/OptionsMenu'
import FeedbackModal from './components/FeedbackModal'
import SetupScreen from './components/SetupScreen'
import { useChat } from './hooks/useChat'
import { useEve } from './hooks/useEve'
import type { ActivePanel } from './types'

// Extend window type for Electron IPC
declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (cb: (maximized: boolean) => void) => void
      isFullScreen: () => Promise<boolean>
      onFullScreenChange: (cb: (fullscreen: boolean) => void) => void
      getMissingKeysSync: () => string[]
      getMissingKeys: () => Promise<string[]>
      getEnvValues: () => Promise<Record<string, string>>
      saveEnvValues: (values: Record<string, string>) => Promise<string[]>
      onSetupRequired: (cb: (missing: string[]) => void) => void
      onUpdateAvailable: (cb: (version: string) => void) => void
      onUpdateProgress: (cb: (percent: number) => void) => void
      onUpdateDownloaded: (cb: (version: string) => void) => void
      installUpdate: () => void
      captureScreenshot: () => Promise<string | null>
      isNoAIMode: () => Promise<boolean>
      clearKeys: (keys: string[], setNoAI?: boolean) => Promise<void>
    }
  }
}

export default function App() {
  const [darkMode, setDarkMode] = useState(true)

  // Apply persisted display preferences on mount
  useEffect(() => {
    const size = localStorage.getItem('aurora_font_size')
    const density = localStorage.getItem('aurora_font_density')
    if (size) document.documentElement.style.fontSize = size
    if (density) {
      document.documentElement.style.setProperty('--aurora-line-height', density)
      document.body.dataset.density = density
    }
  }, [])
  const [setupMissing, setSetupMissing] = useState<string[]>([])
  const [noAIMode, setNoAIMode] = useState(false)
  const [updateState, setUpdateState] = useState<{ version: string; progress?: number; ready: boolean } | null>(null)
  const [activePanel, setActivePanel] = useState<ActivePanel>('chat')
  const [showLanding, setShowLanding] = useState(true)
  const [showVoiceBubble, setShowVoiceBubble] = useState(false)
  const [showVoiceSettings, setShowVoiceSettings] = useState(false)
  const [zkillTarget, setZkillTarget] = useState<ZkillTarget | null>(null)
  const [showWalletWindow, setShowWalletWindow] = useState(false)
  const prevPanelRef = useRef<ActivePanel>('chat')
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackScreenshot, setFeedbackScreenshot] = useState<string | null>(null)
  const [freightImport, setFreightImport] = useState<{ collateral: number; volume: number } | null>(null)
  const [blueprintImport, setBlueprintImport] = useState<{ typeId: number; typeName: string; me: number; te: number; runs: number } | null>(null)
  const [editMessage, setEditMessage] = useState<{ id: string; content: string } | null>(null)
  const [showVentureGame, setShowVentureGame] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [notificationsMailId, setNotificationsMailId] = useState<number | null>(null)
  const [isIdleGame, setIsIdleGame] = useState(false)
  const isIdleGameRef = useRef(false)
  const callbackHandled = useRef(false)

  const eve = useEve()

  // Merged arrays across all authenticated characters — used by panels
  const mergedAssets = Object.values(eve.allAssets).flat()
  const mergedIndustryJobs = Object.values(eve.allIndustryJobs).flat()
  const mergedMarketOrders = Object.values(eve.allMarketOrders).flat()

  const chat = useChat({
    character: eve.character,
    skills: eve.skills,
    skillQueue: eve.skillQueue,
    industryJobs: eve.industryJobs,
    marketOrders: eve.marketOrders,
    assets: eve.assets,
    walletBalance: eve.walletBalance,
    walletTransactions: eve.walletTransactions,
    walletJournal: eve.walletJournal,
    blueprints: eve.blueprints,
    attributes: eve.attributes,
    implants: eve.implants,
    jumpClones: eve.jumpClones,
    shipLocation: eve.shipLocation,
    standings: eve.standings,
    loyaltyPoints: eve.loyaltyPoints,
    securityStatus: eve.securityStatus,
    jumpFatigue: eve.jumpFatigue,
    contracts: eve.contracts,
    miningLedger: eve.miningLedger,
    killmails: eve.killmails,
    notifications: eve.notifications,
    planets: eve.planets,
    calendarEvents: eve.calendarEvents,
  })

  const intelSessionIdRef = useRef<string | null>(localStorage.getItem(INTEL_SESSION_KEY))

  // ── Global PTT for non-COMMS panels ────────────────────────────────────
  // ChatInput's voice hook is only mounted when activePanel === 'chat'.
  // This handler covers all other panels — records, transcribes via Scribe,
  // then fires sendInNewSession + VoiceBubble without switching panels.
  const activePanelRef = useRef(activePanel)
  useEffect(() => { activePanelRef.current = activePanel }, [activePanel])

  const globalPttRecorderRef = useRef<MediaRecorder | null>(null)
  const globalPttPhaseRef    = useRef<'off' | 'listening'>('off')
  const globalPttKeyRef      = useRef(localStorage.getItem('aurora_ptt_key') ?? '`')
  const globalNoiseFloorRef  = useRef(Number(localStorage.getItem('aurora_noise_floor') ?? '12'))

  useEffect(() => {
    const onKey = (e: Event) => { globalPttKeyRef.current     = (e as CustomEvent<string>).detail }
    const onNF  = (e: Event) => { globalNoiseFloorRef.current = (e as CustomEvent<number>).detail }
    window.addEventListener('aurora_ptt_changed',        onKey)
    window.addEventListener('aurora_noise_floor_changed', onNF)
    return () => {
      window.removeEventListener('aurora_ptt_changed',        onKey)
      window.removeEventListener('aurora_noise_floor_changed', onNF)
    }
  }, [])

  const startGlobalPttRef = useRef<() => void>(() => {})
  const stopGlobalPttRef  = useRef<() => void>(() => {})

  useEffect(() => {
    startGlobalPttRef.current = async () => {
      if (globalPttPhaseRef.current !== 'off') return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        const audioCtx  = new AudioContext()
        const source    = audioCtx.createMediaStreamSource(stream)
        const analyser  = audioCtx.createAnalyser()
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
          globalPttPhaseRef.current = 'off'
          if (peakLevel < globalNoiseFloorRef.current) return
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          try {
            const resp = await fetch('/api/stt', {
              method: 'POST',
              headers: { 'Content-Type': blob.type },
              body: blob,
            })
            const data = await resp.json() as { text?: string }
            const transcript = (data.text ?? '').trim()
            if (transcript.length >= 2 && /[a-zA-Z0-9]/.test(transcript)) {
              chat.sendInNewSession(transcript)
              setShowVoiceBubble(true)
            }
          } catch (err) {
            console.error('[GlobalPTT] STT failed:', err)
          }
        }
        recorder.start()
        globalPttRecorderRef.current = recorder
        globalPttPhaseRef.current = 'listening'
      } catch (err) {
        console.error('[GlobalPTT] getUserMedia failed:', err)
        globalPttPhaseRef.current = 'off'
      }
    }

    stopGlobalPttRef.current = () => {
      if (globalPttRecorderRef.current?.state === 'recording') {
        globalPttRecorderRef.current.stop()
        globalPttRecorderRef.current = null
      }
    }
  }) // runs every render to keep chat ref fresh

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== globalPttKeyRef.current || e.repeat) return
      if (activePanelRef.current === 'chat') return
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      startGlobalPttRef.current()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== globalPttKeyRef.current) return
      if (activePanelRef.current === 'chat') return
      stopGlobalPttRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup',   onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup',   onKeyUp)
    }
  }, [])

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.onPttToggle) return
    const unsub = api.onPttToggle(() => {
      if (activePanelRef.current === 'chat') return
      if (globalPttPhaseRef.current === 'listening') stopGlobalPttRef.current()
      else startGlobalPttRef.current()
    })
    return unsub
  }, [])

  // Speak intel alerts via Aurora TTS and open/reuse an intel comms session
  useEffect(() => {
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
    const handler = (e: Event) => {
      const { urgency, system, jumps, count, characters, ships } = (e as CustomEvent<{ urgency: string; system?: string; jumps?: number; count?: number; characters?: string[]; ships?: string[] }>).detail
      const j = jumps ?? 0
      const gang = count != null ? ` ${count} additional hostile${count === 1 ? '' : 's'} reported.` : ''
      const gangShort = count != null ? ` Plus ${count} more.` : ''
      const gangFleet = count != null ? ` They've got numbers — ${count} confirmed additional.` : ''
      let text: string
      if (system && jumps != null && urgency === 'near') {
        text = pick([
          `Warning. Hostile contact in ${system}. ${j} jump${j === 1 ? '' : 's'} from your position.${gang} Get safe.`,
          `Red alert. ${system}, ${j} out. They're close.${gangShort} Safe up now.`,
          `Contact in ${system}. ${j} jump${j === 1 ? '' : 's'}. That's too close for comfort.${gang}`,
          `Intel spike. ${system} has hostiles, just ${j} jump${j === 1 ? '' : 's'} away.${gangFleet} I'd move if I were you.`,
          `${system}. ${j} jump${j === 1 ? '' : 's'}. Hostile confirmed.${gang} Watch yourself out there.`,
        ])
      } else if (system && jumps != null) {
        text = pick([
          `Heads up. Hostiles spotted in ${system}, ${j} jump${j === 1 ? '' : 's'} out.${gang}`,
          `Intel coming in. ${system} has activity, ${j} jump${j === 1 ? '' : 's'} from you.${gangShort}`,
          `Picking up hostile movement in ${system}. ${j} jump${j === 1 ? '' : 's'} away.${gang} Stay alert.`,
          `${system} is lighting up. Hostiles reported, ${j} jump${j === 1 ? '' : 's'} from your location.${gangFleet}`,
          `Contact. ${system}, ${j} jump${j === 1 ? '' : 's'}.${gang} Keep an eye on the gate.`,
        ])
      } else if (system) {
        text = pick([
          `Hostile activity reported in ${system}.${gang} Unknown distance.`,
          `Intel ping on ${system}.${gangShort} Treat as unsafe.`,
          `${system} flagged on intel.${gang} Proceed with caution.`,
        ])
      } else if (urgency === 'near') {
        text = pick([
          `Warning. Hostiles nearby.${gang} Safe up immediately.`,
          `Close contact on intel.${gangShort} Get to safety now.`,
          `They're close. Intel is pinging hostiles near your position.${gang}`,
        ])
      } else {
        text = pick([
          `Hostile reported in the area.${gang} Stay aware.`,
          `Intel activity. Hostiles in your region.${gangShort} Eyes open.`,
          `New contact on intel.${gang} Don't drop your guard.`,
          `Something's moving on intel.${gangFleet} Watch yourself.`,
        ])
      }
      // Build the user-side log entry (what was reported)
      const parts: string[] = []
      if (system) parts.push(`System: ${system}${jumps != null ? ` (${jumps} jump${jumps === 1 ? '' : 's'})` : ''}`)
      if (characters && characters.length) parts.push(`Pilots: ${characters.join(', ')}`)
      if (ships && ships.length) parts.push(`Ships: ${ships.join(', ')}`)
      if (count) parts.push(`+${count} additional`)
      const userEntry = parts.length ? parts.join(' · ') : 'Intel ping'
      const report = buildIntelReport(
        { urgency, system, jumps, count, characters, ships },
        eve.shipLocation?.solarSystemId ?? null,
        eve.shipLocation?.solarSystemName ?? null,
      )

      const existingId = intelSessionIdRef.current
      const sessionExists = existingId && chat.conversations.some(c => c.id === existingId)
      let targetId: string
      if (sessionExists) {
        targetId = existingId!
        chat.setActiveId(targetId)
      } else {
        targetId = chat.newChat()
        intelSessionIdRef.current = targetId
        localStorage.setItem(INTEL_SESSION_KEY, targetId)
        // Rename the session immediately so it's identifiable in the sidebar
        chat.appendToSession(targetId, '⚠ INTEL FEED', 'Intel monitoring active. Alerts will appear here.')
      }
      chat.appendToSession(targetId, userEntry, report)
      setShowLanding(false)
      setActivePanel('chat')

      chat.speakAlert(text)
    }
    window.addEventListener('aurora_intel_alert', handler)
    return () => window.removeEventListener('aurora_intel_alert', handler)
  }, [chat.speakAlert, chat.conversations, chat.setActiveId, chat.appendToSession, chat.newChat])

  // Handle EVE OAuth callback — server does the exchange and passes tokens back via URL params
  useEffect(() => {
    window.electronAPI?.onSetupRequired(missing => setSetupMissing(missing))
    window.electronAPI?.isNoAIMode().then(setNoAIMode)
    window.electronAPI?.onUpdateAvailable(version => setUpdateState({ version, ready: false }))
    window.electronAPI?.onUpdateProgress(percent => setUpdateState(s => s ? { ...s, progress: percent } : null))
    window.electronAPI?.onUpdateDownloaded(version => setUpdateState({ version, ready: true }))
  }, [])

  useEffect(() => {
    if (callbackHandled.current) return
    const params = new URLSearchParams(window.location.search)
    const accessToken = params.get('eve_access_token')
    const refreshToken = params.get('eve_refresh_token')
    const expiresIn = params.get('eve_expires_in')
    const eveError = params.get('eve_error')

    if (eveError) {
      console.error('EVE login error:', eveError)
      window.history.replaceState({}, '', '/')
      return
    }

    const characterId = params.get('eve_character_id')
    const characterName = params.get('eve_character_name')
    const corporationId = params.get('eve_corporation_id')

    if (!accessToken || !refreshToken || !characterId || !characterName) return

    callbackHandled.current = true
    window.history.replaceState({}, '', '/')

    eve.loginWithToken(
      accessToken,
      refreshToken,
      parseInt(expiresIn || '1200', 10),
      parseInt(characterId, 10),
      characterName,
      parseInt(corporationId || '0', 10),
    )
  }, []) // empty deps — intentionally runs once on mount

  // Idle game detection — disabled for now
  // useEffect(() => {
  //   if (showLanding || !eve.character || showVentureGame) return
  //   const timer = setTimeout(() => {
  //     isIdleGameRef.current = true
  //     setIsIdleGame(true)
  //     setShowVentureGame(true)
  //   }, 5 * 60 * 1000)
  //   return () => clearTimeout(timer)
  // }, [showLanding, eve.character, showVentureGame])


  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const panels: ActivePanel[] = ['chat', 'notifications', 'skills', 'industry', 'assets', 'market', 'janice', 'zkill', 'intel', 'map']
      const idx = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'].indexOf(e.key)
      if (idx !== -1) { e.preventDefault(); setActivePanel(panels[idx]) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Dark mode class on html
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  // Edit a message: trim conversation to before that message, populate input
  const handleEditMessage = (id: string, content: string) => {
    chat.trimToMessage(id)
    setEditMessage({ id, content })
  }

  const speakText = async (text: string) => {
    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode: 'full' }),
      })
      if (!resp.ok) return
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      audio.play()
    } catch { /* ignore */ }
  }

  // Fuzzy match for the game trigger phrase
  const isGameTrigger = (text: string) => {
    const t = text.toLowerCase().trim()
    return (
      /\b(let'?s?|wanna|want to|shall we)\b.{0,20}\bplay\b.{0,10}\b(a\s+)?game\b/i.test(t) ||
      /\bplay\b.{0,10}\b(a\s+)?game\b/i.test(t) ||
      /\bopen\b.{0,10}\bgame\b/i.test(t) ||
      /\bventure\s+game\b/i.test(t)
    )
  }

  const handleVoiceQuery = (text: string, send: (t: string) => void) => {
    if (isGameTrigger(text)) {
      const line = "Oh, I love games! Opening now."
      if (chat.voiceEnabled) speakText(line)
      setShowVentureGame(true)
      return
    }
    send(text)
  }

  const handleSend = (content: string) => {
    setEditMessage(null)
    if (isGameTrigger(content)) {
      const line = "Oh, I love games! Opening now."
      if (chat.voiceEnabled) speakText(line)
      setShowVentureGame(true)
      return
    }
    chat.sendMessage(content)
  }

  // Show landing page when no character, or when explicitly requested
  if (showLanding || !eve.character) {
    return (
      <div className={`${darkMode ? 'dark' : ''} relative flex flex-col`}>
        <TitleBar />
        {showVoiceBubble && (
          <VoiceBubble
            messages={chat.activeConversation?.messages ?? []}
            streaming={chat.streaming}
            isSpeaking={chat.isSpeaking}
            toolStatus={chat.toolStatus}
            onOpenComms={() => {
              setShowVoiceBubble(false)
              setShowLanding(false)
              setActivePanel('chat')
            }}
            onClose={() => setShowVoiceBubble(false)}
          />
        )}
        <LandingPage
          character={eve.character}
          characters={eve.characters}
          skills={eve.skills}
          walletBalance={eve.walletBalance}
          walletTransactions={eve.walletTransactions}
          walletJournal={eve.walletJournal}
          allWalletBalances={eve.allWalletBalances}
          allWalletJournals={eve.allWalletJournals}
          allWalletTransactions={eve.allWalletTransactions}
          securityStatus={eve.securityStatus}
          shipLocation={eve.shipLocation}
          attributes={eve.attributes}
          loading={eve.loading}
          isSpeaking={chat.isSpeaking}
          voiceEnabled={chat.voiceEnabled}
          autoListenTrigger={chat.autoListenTrigger}
          onEnter={() => { setShowLanding(false); setShowVoiceBubble(false) }}
          onOpenComms={() => { setShowLanding(false); setActivePanel('chat'); setShowVoiceBubble(false) }}
          onVoiceQuery={(text) => {
            handleVoiceQuery(text, (t) => { setShowVoiceBubble(true); chat.sendInNewSession(t) })
          }}
          mail={eve.mail}
          mailLabels={eve.mailLabels}
          notifications={eve.notifications}
          contracts={eve.contracts}
          onOpenNotifications={(mailId) => {
            setNotificationsMailId(mailId ?? null)
            setShowLanding(false)
            setActivePanel('notifications')
          }}
          onRefresh={eve.refreshAllCharacters}
          onLogout={eve.logout}
          onSwitchCharacter={eve.switchCharacter}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(v => !v)}
        />
      </div>
    )
  }

  if (setupMissing.length > 0) {
    return <SetupScreen missingKeys={setupMissing} onComplete={() => setSetupMissing([])} />
  }

  return (
    <div className={`h-screen flex flex-col overflow-hidden bg-eve-black font-mono ${darkMode ? 'dark' : ''}`}>
      {/* Scanline overlay */}
      <div className="scanline-overlay" />

      <TitleBar />

      {/* Update banner */}
      {updateState && (
        <div className="fixed bottom-4 right-4 z-50 eve-panel border-eve-cyan/40 p-3 w-72 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-widest text-eve-cyan uppercase">
              {updateState.ready ? '◈ Update Ready' : '◈ Downloading Update'}
            </span>
            <span className="text-[10px] text-eve-muted">{updateState.version}</span>
          </div>
          {!updateState.ready && updateState.progress !== undefined && (
            <div className="h-0.5 bg-eve-border rounded-full overflow-hidden">
              <div
                className="h-full bg-eve-cyan transition-all duration-300"
                style={{ width: `${updateState.progress}%` }}
              />
            </div>
          )}
          {updateState.ready && (
            <div className="flex gap-2">
              <button
                onClick={() => window.electronAPI?.installUpdate()}
                className="eve-btn-primary flex-1 py-1 text-[10px] tracking-widest uppercase"
              >
                Restart &amp; Install
              </button>
              <button
                onClick={() => setUpdateState(null)}
                className="eve-btn py-1 px-3 text-[10px] text-eve-muted"
              >
                Later
              </button>
            </div>
          )}
        </div>
      )}

      {/* Wallet window */}
      {showWalletWindow && eve.character && (
        <WalletWindow
          characters={eve.characters}
          allWalletBalances={eve.allWalletBalances}
          allWalletJournals={eve.allWalletJournals}
          allWalletTransactions={eve.allWalletTransactions}
          onClose={() => setShowWalletWindow(false)}
        />
      )}

      {/* Feedback modal */}
      {showFeedback && (
        <FeedbackModal activePanel={activePanel} screenshot={feedbackScreenshot} onClose={() => setShowFeedback(false)} />
      )}

      {/* Voice settings modal */}
      {showVoiceSettings && (
        <VoiceSettingsModal
          ttsMode={chat.ttsMode}
          onTtsModeChange={chat.changeTtsMode}
          onClose={() => setShowVoiceSettings(false)}
        />
      )}

      {/* Top bar */}
      <header className="eve-panel border-b border-eve-border px-4 py-2 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLanding(true)}
            className="text-eve-cyan text-glow-cyan text-sm tracking-[0.4em] font-mono uppercase hover:opacity-80 transition-opacity"
            title="Back to pilot dossier"
          >
            ◈ AURORA
          </button>
          <div className="hidden md:flex items-center gap-1 text-eve-dim text-[10px]">
            <span>CAPSULEER INTELLIGENCE SYSTEM</span>
            <span className="mx-1">·</span>
            <span>v{version}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-eve-muted">
          <button
            onClick={() => window.open('/preview-brain.html', '_blank', 'noopener,noreferrer')}
            title="Aurora Brain Map"
            className="text-eve-muted hover:text-eve-cyan transition-colors p-0.5"
          >
            <Brain size={13} />
          </button>
          <div className="hidden sm:flex items-center gap-1.5">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-eve-green"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span>NEW EDEN · YC {new Date().getFullYear() - 1898}</span>
          </div>
          <span className="text-eve-dim">{new Date().toUTCString().slice(17, 25)} UTC</span>

          <button
            onClick={async () => {
              const shot = window.electronAPI?.captureScreenshot ? await window.electronAPI.captureScreenshot() : null
              setFeedbackScreenshot(shot)
              setShowFeedback(true)
            }}
            title="Submit bug or feedback"
            className="text-eve-muted hover:text-eve-gold transition-colors text-[10px] tracking-widest font-mono border border-eve-border hover:border-eve-gold/50 px-2 py-0.5 rounded-sm"
          >
            FEEDBACK
          </button>

          <OptionsMenu darkMode={darkMode} setDarkMode={setDarkMode} />

        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: chat history */}
        <Sidebar
          conversations={chat.conversations}
          activeId={chat.activeId}
          onSelect={(id) => { chat.setActiveId(id); setActivePanel('chat') }}
          onNew={chat.newChat}
          onClearAll={chat.clearAllConversations}
          onDelete={chat.deleteConversation}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(v => !v)}
          onOpenRoadmap={() => {
            if (activePanel === 'roadmap') {
              setActivePanel(prevPanelRef.current)
            } else {
              prevPanelRef.current = activePanel
              setActivePanel('roadmap')
            }
          }}
          roadmapActive={activePanel === 'roadmap'}
          isSpeaking={chat.isSpeaking}
          characterName={eve.character?.characterName}
          voiceEnabled={chat.voiceEnabled}
          onToggleVoice={chat.toggleVoice}
          showVoiceToggle={activePanel !== 'chat'}
          autoListenTrigger={chat.autoListenTrigger}
          onVoiceQuery={(text) => {
            handleVoiceQuery(text, (t) => { chat.sendInNewSession(t); setActivePanel('chat') })
          }}
        />

        {/* Center: nav + panel content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <NavTabs active={activePanel} onChange={setActivePanel} />

<div className="flex-1 overflow-hidden flex flex-col">
            {/* Always-mounted panels preserve state across tab switches */}
            <div className={`flex-1 overflow-hidden flex flex-col p-4 ${activePanel === 'zkill' ? '' : 'hidden'}`}>
              <ZkillPanel target={zkillTarget} />
            </div>

            <div className={`flex-1 overflow-hidden flex flex-col p-4 ${activePanel === 'intel' ? '' : 'hidden'}`}>
              <IntelPanel
                shipLocation={eve.shipLocation}
                characterId={eve.character?.characterId}
                characterName={eve.character?.characterName}
                onZkillLookup={(query, category) => {
                  setZkillTarget({ query, category })
                  setActivePanel('zkill')
                }}
              />
            </div>
            <div className={`flex-1 overflow-hidden flex flex-col ${activePanel === 'notifications' ? '' : 'hidden'}`}>
              <NotificationsPanel
                mail={eve.mail}
                mailLabels={eve.mailLabels}
                notifications={eve.notifications}
                loading={eve.loading}
                onRefresh={eve.refreshAllCharacters}
                character={eve.character}
                initialMailId={notificationsMailId}
                onInitialMailConsumed={() => setNotificationsMailId(null)}
              />
            </div>
            <div className={`flex-1 overflow-y-auto p-4 ${activePanel === 'janice' ? '' : 'hidden'}`}>
              <JanicePanel
                onSendToFreight={(collateral, volume) => {
                  setFreightImport({ collateral, volume })
                  setActivePanel('industry')
                }}
              />
            </div>

            {activePanel === 'chat' ? (
              <>
                <ChatWindow
                  messages={chat.activeConversation?.messages ?? []}
                  streaming={chat.streaming}
                  toolStatus={chat.toolStatus}
                  onEditMessage={handleEditMessage}
                  noAIMode={noAIMode}
                />
                <ChatInput
                  onSend={handleSend}
                  onStop={chat.stopStreaming}
                  disabled={chat.streaming}
                  streaming={chat.streaming}
                  editValue={editMessage?.content ?? null}
                  onCancelEdit={() => setEditMessage(null)}
                  voiceEnabled={chat.voiceEnabled}
                  onToggleVoice={chat.toggleVoice}
                  onOpenVoiceSettings={() => setShowVoiceSettings(true)}
                  autoListenTrigger={chat.autoListenTrigger}
                  noAIMode={noAIMode}
                />
              </>
            ) : activePanel === 'map' ? (
              <div className="flex-1 overflow-hidden flex flex-col">
                <MapPanel
                  currentSystemName={eve.shipLocation?.solarSystemName ?? null}
                  jumpBridges={eve.jumpBridges}
                />
              </div>
            ) : activePanel !== 'zkill' && activePanel !== 'intel' && activePanel !== 'janice' && activePanel !== 'notifications' ? (
              <div className="flex-1 overflow-y-auto p-4">
                {activePanel === 'skills' && (
                  <SkillPanel
                    skills={eve.skills}
                    skillQueue={eve.skillQueue}
                    loading={eve.loading}
                    onRefresh={eve.refreshAllCharacters}
                    characterId={eve.character?.characterId}
                  />
                )}
                {activePanel === 'industry' && (
                  <IndustryPanel
                    jobs={mergedIndustryJobs.length ? mergedIndustryJobs : eve.industryJobs}
                    loading={eve.loading}
                    onRefresh={eve.refreshAllCharacters}
                    freightImport={freightImport}
                    onFreightImportClear={() => setFreightImport(null)}
                    blueprintImport={blueprintImport}
                    onBlueprintImportClear={() => setBlueprintImport(null)}
                    characterId={eve.character?.characterId}
                    accessToken={eve.character?.accessToken}
                    skills={eve.skills}
                    assets={mergedAssets.length ? mergedAssets : eve.assets}
                    allIndustryJobs={eve.allIndustryJobs}
                    characters={eve.characters}
                  />
                )}
                {activePanel === 'assets' && (
                  <AssetsPanel
                    assets={mergedAssets.length ? mergedAssets : eve.assets}
                    blueprints={eve.blueprints}
                    loading={eve.loading}
                    characterId={eve.character?.characterId}
                    onRefresh={eve.refreshAllCharacters}
                    onBlueprintClick={(bp) => {
                      setBlueprintImport(bp)
                      setActivePanel('industry')
                    }}
                    noAIMode={noAIMode}
                  />
                )}
                {activePanel === 'market' && (
                  <MarketPanel
                    orders={mergedMarketOrders.length ? mergedMarketOrders : eve.marketOrders}
                    loading={eve.loading}
                    onRefresh={eve.refreshAllCharacters}
                    character={eve.character}
                    characters={eve.characters}
                    contracts={eve.contracts}
                    corporationContracts={eve.corporationContracts}
                  />
                )}
                {activePanel === 'roadmap' && <RoadmapPanel />}
              </div>
            ) : null}
          </div>
        </div>

        {/* Right panel: character portrait + EVE status */}
        <div className="relative flex shrink-0">
          {/* Slide toggle tab */}
          <button
            onClick={() => setRightPanelOpen(v => !v)}
            className="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 z-20 flex items-center justify-center w-4 h-10 bg-eve-panel border border-eve-border border-r-0 text-eve-dim hover:text-eve-cyan transition-colors rounded-l"
            title={rightPanelOpen ? 'Collapse panel' : 'Expand panel'}
          >
            <span className="text-[10px]">{rightPanelOpen ? '›' : '‹'}</span>
          </button>
        <aside className={`eve-panel border-l border-eve-border flex flex-col overflow-y-auto transition-all duration-300 ease-in-out ${rightPanelOpen ? 'w-52 xl:w-60' : 'w-0 overflow-hidden border-l-0'}`}>
          {/* Character portrait */}
          {eve.character ? (
            <div className="relative shrink-0 w-full aspect-square overflow-hidden border-b border-eve-border">
              <img
                src={`https://images.evetech.net/characters/${eve.character.characterId}/portrait?size=256`}
                alt={eve.character.characterName}
                className="w-full h-full object-cover object-top"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
                <div className="text-eve-gold text-xs tracking-wider truncate">◆ {eve.character.characterName}</div>
              </div>
            </div>
          ) : (
            <div className="shrink-0 w-full aspect-square border-b border-eve-border bg-eve-black/40 flex items-center justify-center">
              <div className="text-eve-dim text-xs tracking-widest">NO PILOT</div>
            </div>
          )}

          <div className="px-3 pb-3 flex flex-col gap-3 pt-3">
            <EveLogin
              character={eve.character}
              characters={eve.characters}
              loading={eve.loading}
              error={eve.error}
              onLogout={eve.logout}
              onRefresh={eve.refreshAllCharacters}
              onSwitch={eve.switchCharacter}
            />

            {/* Quick stats when logged in */}
            {eve.character && (
              <div className="eve-panel p-2 space-y-1.5">
                <div className="eve-header text-[9px]">QUICK STATUS</div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-eve-muted">Training</span>
                  <span className="text-eve-cyan">{eve.skillQueue[0]?.skillName?.slice(0, 14) ?? '—'}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-eve-muted">Ind. Jobs</span>
                  <span className="text-eve-text">{(mergedIndustryJobs.length ? mergedIndustryJobs : eve.industryJobs).filter(j => j.status === 'active').length}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-eve-muted">Orders</span>
                  <span className="text-eve-text">{(mergedMarketOrders.length ? mergedMarketOrders : eve.marketOrders).filter(o => o.state === 'active').length}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-eve-muted">Assets</span>
                  <span className="text-eve-text">{(mergedAssets.length ? mergedAssets : eve.assets).length} types</span>
                </div>
                {eve.skills.length > 0 && (
                  <div className="border-t border-eve-border/40 pt-1.5">
                    <div className="eve-label text-[9px] mb-1">SKILL POINTS</div>
                    <div className="text-eve-cyan font-mono text-xs text-glow-cyan">
                      {eve.skills.reduce((s, sk) => s + sk.skillpointsInSkill, 0).toLocaleString()}
                    </div>
                    <div className="text-eve-dim text-[9px] mt-0.5">{eve.skills.length} skills trained</div>
                  </div>
                )}
                {Object.keys(eve.allWalletBalances).length > 0 && (
                  <button
                    onClick={() => setShowWalletWindow(true)}
                    className="border-t border-eve-border/40 pt-1.5 w-full text-left group"
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <TrendingUp size={9} className="text-eve-green" />
                      <div className="eve-label text-[9px]">WALLET</div>
                    </div>
                    {(() => {
                      const fmt = (b: number) => {
                        if (b >= 1e12) return `${(b / 1e12).toFixed(2)}T ISK`
                        if (b >= 1e9)  return `${(b / 1e9).toFixed(2)}B ISK`
                        if (b >= 1e6)  return `${(b / 1e6).toFixed(2)}M ISK`
                        return `${(b / 1e3).toFixed(1)}K ISK`
                      }
                      const balances = eve.allWalletBalances
                      const total = Object.values(balances).reduce((s, b) => s + b, 0)
                      const multiChar = eve.characters.length > 1

                      return (
                        <>
                          <div className="text-eve-green font-mono text-xs group-hover:brightness-125 transition-all">
                            {fmt(total)}
                          </div>
                          {multiChar && (
                            <div className="mt-1 space-y-0.5">
                              {eve.characters.map(c => {
                                const bal = balances[c.characterId]
                                if (bal === undefined) return null
                                return (
                                  <div key={c.characterId} className="flex justify-between text-[9px]">
                                    <span className="text-eve-dim truncate" style={{ maxWidth: 80 }}>
                                      {c.characterName.split(' ')[0]}
                                    </span>
                                    <span className="text-eve-muted font-mono">
                                      {bal >= 1e9 ? `${(bal / 1e9).toFixed(1)}B`
                                        : bal >= 1e6 ? `${(bal / 1e6).toFixed(1)}M`
                                        : `${(bal / 1e3).toFixed(0)}K`}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </button>
                )}
              </div>
            )}

            {/* System info */}
            <div className="text-[9px] text-eve-dim space-y-0.5 border-t border-eve-border pt-2">
              <div className="flex justify-between">
                <span>MODEL</span>
                <span className="text-eve-muted">CLAUDE SONNET</span>
              </div>
              <div className="flex justify-between">
                <span>ESI</span>
                <span className="text-eve-muted">v1 LATEST</span>
              </div>
              <div className="flex justify-between">
                <span>STATUS</span>
                <span className="text-eve-green">NOMINAL</span>
              </div>
            </div>
          </div>

          {/* Venture mini-game launcher */}
          <div className="mt-auto px-3 pb-3 pt-1 border-t border-eve-border/30">
            <button
              onClick={() => setShowVentureGame(true)}
              title="Venture Ore Blaster — secret mini-game"
              className="w-full flex items-center gap-2 text-[9px] text-eve-dim hover:text-eve-cyan transition-colors group"
            >
              {/* Tiny SVG Venture silhouette */}
              <svg width="18" height="18" viewBox="0 0 36 36" className="shrink-0 opacity-40 group-hover:opacity-100 transition-opacity group-hover:drop-shadow-[0_0_4px_#00ccee]">
                <polygon points="18,4 26,28 20,22 18,30 16,22 10,28" fill="none" stroke="#00ccee" strokeWidth="1.8" strokeLinejoin="round"/>
                <polygon points="12,10 2,6 4,18 12,16" fill="none" stroke="#00ccee" strokeWidth="1.4" strokeLinejoin="round"/>
                <polygon points="24,10 34,6 32,18 24,16" fill="none" stroke="#00ccee" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
              <span className="tracking-widest">VENTURE GAME</span>
            </button>
          </div>
        </aside>
        </div>
      </div>

      {/* Venture mini-game */}
      {showVentureGame && (
        <VentureGame
          onClose={() => { setShowVentureGame(false); isIdleGameRef.current = false; setIsIdleGame(false) }}
          voiceEnabled={chat.voiceEnabled}
          onSpeak={speakText}
          idleMode={isIdleGame}
        />
      )}

      {/* API usage tracker */}
      <UsageBar />
    </div>
  )
}

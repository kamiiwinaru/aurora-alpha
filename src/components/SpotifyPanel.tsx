import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { isSpotifyConnected, startSpotifyLogin, disconnectSpotify } from '../lib/spotify/client'
import { getPlaybackState, play, pause, skipNext, skipPrev, setVolume, setShuffle, saveTrack, unsaveTrack, isTrackSaved, getUserPlaylists, createPlaylist, addTrackToPlaylist, SpotifyPlaylist, PlaybackState } from '../lib/spotify/controller'
import { captureBaseline } from '../lib/spotify/ducker'

export const SPOTIFY_CONNECTED_EVENT = 'aurora_spotify_connected'

interface Props {
  anchorRef: React.RefObject<HTMLElement>
  open: boolean
  onClose: () => void
}

export default function SpotifyPanel({ anchorRef, open, onClose }: Props) {
  const [connected, setConnected]     = useState(isSpotifyConnected)
  const [playback, setPlayback]       = useState<PlaybackState | null>(null)
  const [loading, setLoading]         = useState(false)
  const [vol, setVol]                 = useState<number | null>(null)
  const [liked, setLiked]             = useState(false)
  const [shuffleOn, setShuffleOn]     = useState(false)
  const [showPlaylists, setShowPlaylists] = useState(false)
  const [playlists, setPlaylists]     = useState<SpotifyPlaylist[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [newPlName, setNewPlName]     = useState('')
  const [addingTo, setAddingTo]       = useState<string | null>(null)
  const [addedTo, setAddedTo]         = useState<string | null>(null)
  const [pos, setPos]                 = useState<{ x: number; y: number } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Position popout relative to the anchor button
  useEffect(() => {
    if (!open || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const panelH = 320
    const y = Math.min(rect.top, window.innerHeight - panelH - 8)
    setPos({ x: rect.right + 8, y: Math.max(8, y) })
  }, [open, anchorRef])

  // Poll playback state while open
  const lastTrackIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open || !connected) return
    async function refresh() {
      try {
        const state = await getPlaybackState()
        setPlayback(state)
        if (state && vol === null) setVol(state.volumePct)
        if (state) setShuffleOn(state.shuffleState)
        const trackId = state?.track?.id ?? null
        if (trackId && trackId !== lastTrackIdRef.current) {
          lastTrackIdRef.current = trackId
          if (state?.itemType === 'track') isTrackSaved(trackId).then(setLiked).catch(() => {})
          else setLiked(false)
        }
        if (!trackId) { lastTrackIdRef.current = null; setLiked(false) }
      } catch { /* ignore token errors mid-session */ }
    }
    refresh()
    pollRef.current = setInterval(refresh, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open, connected])

  // Listen for connect event (fired after OAuth callback completes)
  useEffect(() => {
    function onConnect() {
      setConnected(true)
      captureBaseline().catch(() => {})
    }
    window.addEventListener(SPOTIFY_CONNECTED_EVENT, onConnect)
    return () => window.removeEventListener(SPOTIFY_CONNECTED_EVENT, onConnect)
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const panel = document.getElementById('spotify-panel-popout')
      if (panel && !panel.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose, anchorRef])

  async function cmd(fn: () => Promise<void>) {
    setLoading(true)
    try {
      await fn()
      await new Promise(r => setTimeout(r, 300))
      const state = await getPlaybackState()
      setPlayback(state)
      if (state) setVol(state.volumePct)
    } catch { /* surface nothing — Spotify 404s when no active device */ }
    finally { setLoading(false) }
  }

  async function onVolumeCommit(v: number) {
    setVol(v)
    try { await setVolume(v) } catch { /* ignore */ }
  }

  function doDisconnect() {
    disconnectSpotify()
    setConnected(false)
    setPlayback(null)
    setVol(null)
  }

  if (!open || !pos) return null

  const track    = playback?.track
  const isTrack  = (playback?.itemType ?? 'unknown') === 'track'
  const playing  = playback?.isPlaying ?? false
  const progress = track ? Math.min(100, ((playback?.progressMs ?? 0) / track.durationMs) * 100) : 0

  const panel = (
    <motion.div
      id="spotify-panel-popout"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999 }}
      className="w-64 eve-panel border border-eve-border shadow-xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-eve-border">
        <div className="flex items-center gap-2">
          <SpotifyLogo size={14} className="text-[#1DB954]" />
          <span className="eve-label tracking-widest text-[10px]">SPOTIFY</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#1DB954]' : 'bg-eve-border'}`} />
          <button onClick={onClose} className="ml-1 text-eve-muted hover:text-eve-cyan transition-colors text-[10px]">✕</button>
        </div>
      </div>

      {!connected ? (
        /* ── Not connected ── */
        <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
          <SpotifyLogo size={32} className="text-[#1DB954]/60" />
          <p className="text-[11px] text-eve-muted">Link your Spotify account to control playback and enable voice commands.</p>
          <button
            onClick={() => startSpotifyLogin().catch(() => {})}
            className="eve-btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1.5"
          >
            <SpotifyLogo size={10} className="text-current" />
            CONNECT SPOTIFY
          </button>
        </div>
      ) : (
        <>
          {/* ── Now playing ── */}
          <div className="px-3 py-2.5 border-b border-eve-border min-h-[60px]">
            {track ? (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[11px] text-eve-text truncate font-medium flex-1">{track.name}</p>
                  {isTrack && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={async () => {
                          try {
                            if (liked) { await unsaveTrack(track.id); setLiked(false) }
                            else { await saveTrack(track.id); setLiked(true) }
                          } catch (e) { console.error('[like]', e) }
                        }}
                        title={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                        className="transition-colors"
                      >
                        <HeartIcon filled={liked} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!showPlaylists) {
                            setShowPlaylists(true)
                            setPlaylistsLoading(true)
                            try { setPlaylists(await getUserPlaylists()) } catch { /* ignore */ }
                            finally { setPlaylistsLoading(false) }
                          } else {
                            setShowPlaylists(false)
                            setNewPlName('')
                          }
                        }}
                        title="Add to playlist"
                        className="transition-colors"
                      >
                        <PlaylistIcon active={showPlaylists} />
                      </button>
                    </div>
                  )}
                </div>
                {/* ── Playlist picker ── */}
                {isTrack && showPlaylists && (
                  <div className="mt-1.5 border border-eve-border rounded bg-eve-panel max-h-[140px] flex flex-col">
                    {/* New playlist input */}
                    <div className="flex items-center gap-1 px-2 py-1 border-b border-eve-border shrink-0">
                      <input
                        type="text"
                        placeholder="New playlist…"
                        value={newPlName}
                        onChange={e => setNewPlName(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key !== 'Enter' || !newPlName.trim()) return
                          try {
                            setAddingTo('__new__')
                            const pl = await createPlaylist(newPlName.trim())
                            await addTrackToPlaylist(pl.id, track.id)
                            setPlaylists(prev => [pl, ...prev])
                            setNewPlName('')
                            setAddedTo(pl.id)
                            setTimeout(() => setAddedTo(null), 2000)
                          } catch { /* ignore */ } finally { setAddingTo(null) }
                        }}
                        className="flex-1 bg-transparent text-[10px] text-eve-text placeholder:text-eve-dim outline-none"
                      />
                      <button
                        disabled={!newPlName.trim() || addingTo === '__new__'}
                        onClick={async () => {
                          if (!newPlName.trim()) return
                          try {
                            setAddingTo('__new__')
                            const pl = await createPlaylist(newPlName.trim())
                            await addTrackToPlaylist(pl.id, track.id)
                            setPlaylists(prev => [pl, ...prev])
                            setNewPlName('')
                            setAddedTo(pl.id)
                            setTimeout(() => setAddedTo(null), 2000)
                          } catch { /* ignore */ } finally { setAddingTo(null) }
                        }}
                        className="text-[9px] text-eve-cyan hover:text-eve-text disabled:opacity-40 transition-colors shrink-0"
                      >
                        CREATE
                      </button>
                    </div>
                    {/* Existing playlists */}
                    <div className="overflow-y-auto flex-1">
                      {playlistsLoading ? (
                        <p className="text-[9px] text-eve-dim italic px-2 py-1">Loading…</p>
                      ) : playlists.length === 0 ? (
                        <p className="text-[9px] text-eve-dim italic px-2 py-1">No playlists found</p>
                      ) : playlists.map(pl => (
                        <button
                          key={pl.id}
                          disabled={addingTo === pl.id}
                          onClick={async () => {
                            try {
                              setAddingTo(pl.id)
                              await addTrackToPlaylist(pl.id, track.id)
                              setAddedTo(pl.id)
                              setTimeout(() => setAddedTo(null), 2000)
                            } catch { /* ignore */ } finally { setAddingTo(null) }
                          }}
                          className="w-full flex items-center justify-between px-2 py-1 hover:bg-eve-border/30 transition-colors disabled:opacity-40"
                        >
                          <span className="text-[10px] text-eve-text truncate text-left">{pl.name}</span>
                          <span className="text-[9px] shrink-0 ml-1">
                            {addedTo === pl.id ? <span className="text-[#1DB954]">✓</span> : <span className="text-eve-dim">+</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-eve-muted truncate">{track.artists.join(', ')}</p>
                <p className="text-[9px] text-eve-dim truncate">{track.album}</p>
                {/* Progress bar */}
                <div className="mt-1.5 h-0.5 bg-eve-border rounded-full overflow-hidden">
                  <div className="h-full bg-[#1DB954]/70 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-eve-dim italic">Nothing playing</p>
            )}
          </div>

          {/* ── Transport controls ── */}
          <div className="flex items-center justify-center gap-3 px-3 py-2.5 border-b border-eve-border">
            <button
              onClick={() => cmd(async () => { await setShuffle(!shuffleOn); setShuffleOn(s => !s) })}
              disabled={loading}
              title={shuffleOn ? 'Shuffle on' : 'Shuffle off'}
              className={`transition-colors disabled:opacity-40 ${shuffleOn ? 'text-[#1DB954]' : 'text-eve-dim hover:text-eve-muted'}`}
            >
              <ShuffleIcon />
            </button>
            <CtrlBtn disabled={loading} onClick={() => cmd(skipPrev)} title="Previous">
              <PrevIcon />
            </CtrlBtn>
            <CtrlBtn
              disabled={loading}
              onClick={() => cmd(playing ? pause : play)}
              title={playing ? 'Pause' : 'Play'}
              primary
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </CtrlBtn>
            <CtrlBtn disabled={loading} onClick={() => cmd(skipNext)} title="Skip">
              <NextIcon />
            </CtrlBtn>
          </div>

          {/* ── Volume ── */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-eve-border">
            <VolumeIcon muted={(vol ?? 0) === 0} />
            <input
              type="range" min={0} max={100} step={1}
              value={vol ?? 50}
              onChange={e => setVol(Number(e.target.value))}
              onMouseUp={e => onVolumeCommit(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={e => onVolumeCommit(Number((e.target as HTMLInputElement).value))}
              className="flex-1 accent-[#1DB954] h-1 cursor-pointer"
            />
            <span className="text-[9px] text-eve-dim w-6 text-right">{vol ?? '—'}</span>
          </div>

          {/* ── Disconnect ── */}
          <div className="px-3 py-1.5">
            <button
              onClick={doDisconnect}
              className="w-full text-[9px] text-eve-dim hover:text-eve-red transition-colors text-center py-0.5"
            >
              disconnect
            </button>
          </div>
        </>
      )}
    </motion.div>
  )

  return createPortal(
    <AnimatePresence>{open && panel}</AnimatePresence>,
    document.body,
  )
}

// ── Icon helpers ──────────────────────────────────────────────────────────────

function SpotifyLogo({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )
}

function CtrlBtn({ children, onClick, disabled, title, primary }: { children: React.ReactNode; onClick: () => void; disabled: boolean; title: string; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center rounded-full transition-all disabled:opacity-40 ${
        primary
          ? 'w-8 h-8 bg-[#1DB954]/20 hover:bg-[#1DB954]/40 text-[#1DB954]'
          : 'w-6 h-6 text-eve-muted hover:text-eve-cyan'
      }`}
    >
      {children}
    </button>
  )
}

function PlaylistIcon({ active }: { active: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className={active ? 'text-[#1DB954]' : 'text-eve-dim hover:text-eve-cyan transition-colors'}>
      <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
    </svg>
  )
}
function HeartIcon({ filled }: { filled: boolean }) {
  return filled
    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-eve-dim hover:text-[#1DB954] transition-colors"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
}
function ShuffleIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg> }
function PlayIcon()  { return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> }
function PauseIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> }
function NextIcon()  { return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg> }
function PrevIcon()  { return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg> }
function VolumeIcon({ muted }: { muted: boolean }) {
  return muted
    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-eve-dim shrink-0"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25A6.97 6.97 0 0 1 14 18.98v2.06A8.99 8.99 0 0 0 17.54 19l2.19 2.19L21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
    : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-eve-dim shrink-0"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
}

// Volume ducker — fades Spotify down around TTS playback via Web API volume.
// Latency is 200–600ms (Web API round-trip), not AppleScript-class.
// Call duck() before TTS starts, restore() after TTS ends + grace period.

import { getPlaybackState, setVolume } from './controller'
import { SPOTIFY_CONFIG } from './config'

interface DuckState {
  baselineVol: number       // volume at session start (or last restore)
  deviceId:    string | null
  isDucked:    boolean
  restoreTimer: ReturnType<typeof setTimeout> | null
}

const state: DuckState = {
  baselineVol:  100,
  deviceId:     null,
  isDucked:     false,
  restoreTimer: null,
}

// ── Session init ──────────────────────────────────────────────────────────────

/** Call once at app start (after Spotify connect) to capture baseline volume. */
export async function captureBaseline(): Promise<void> {
  const playback = await getPlaybackState()
  if (!playback) return          // nothing playing — skip, leave defaults
  state.baselineVol = playback.volumePct
  state.deviceId    = playback.deviceId
}

// ── Duck / restore ────────────────────────────────────────────────────────────

/**
 * Fade to duck volume over DUCK_FADE_MS in steps.
 * Safe to call when nothing is playing — exits early.
 */
export async function duck(): Promise<void> {
  if (state.isDucked) return

  // Cancel any pending restore — TTS overlapped
  if (state.restoreTimer) {
    clearTimeout(state.restoreTimer)
    state.restoreTimer = null
  }

  const playback = await getPlaybackState()
  if (!playback?.isPlaying) return   // nothing playing — no duck needed

  // Refresh baseline + device in case user changed device since session start
  state.baselineVol = playback.volumePct
  state.deviceId    = playback.deviceId
  state.isDucked    = true

  await fadeVolume(state.baselineVol, SPOTIFY_CONFIG.ducking.duckVolumePct, SPOTIFY_CONFIG.ducking.fadeDuckMs)
}

/**
 * Schedule a restore after grace period.
 * Grace period lets the tail of TTS audio finish before music swells back.
 */
export function schedulRestore(): void {
  if (!state.isDucked) return
  if (state.restoreTimer) clearTimeout(state.restoreTimer)

  state.restoreTimer = setTimeout(async () => {
    state.restoreTimer = null
    await restore()
  }, SPOTIFY_CONFIG.ducking.graceAfterTtsMs)
}

export async function restore(): Promise<void> {
  if (!state.isDucked) return
  state.isDucked = false
  await fadeVolume(SPOTIFY_CONFIG.ducking.duckVolumePct, state.baselineVol, SPOTIFY_CONFIG.ducking.fadeRestoreMs)
}

// ── Fade engine ───────────────────────────────────────────────────────────────

async function fadeVolume(from: number, to: number, durationMs: number): Promise<void> {
  const STEPS = 8
  const stepMs = durationMs / STEPS
  const delta  = (to - from) / STEPS

  for (let i = 1; i <= STEPS; i++) {
    const vol = Math.round(from + delta * i)
    await setVolume(vol, state.deviceId ?? undefined)
    if (i < STEPS) await sleep(stepMs)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

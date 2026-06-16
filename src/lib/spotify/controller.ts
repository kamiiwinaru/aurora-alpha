// Spotify playback controller — wraps Web API player endpoints.
// All functions throw on API error; callers should catch and surface to the user.

import { spotifyFetch, getAccessToken } from './client'

export interface SpotifyTrack {
  id: string
  name: string
  artists: string[]
  album: string
  durationMs: number
  uri: string
}

export interface PlaybackState {
  isPlaying: boolean
  volumePct: number        // 0–100
  track: SpotifyTrack | null
  itemType: 'track' | 'episode' | 'ad' | 'unknown'
  progressMs: number
  deviceId: string | null
  deviceName: string | null
}

// ── Playback state ────────────────────────────────────────────────────────────

export async function getPlaybackState(): Promise<PlaybackState | null> {
  const data = await spotifyFetch<SpotifyPlayerResponse | null>('/me/player')
  if (!data || !data.device) return null

  return {
    isPlaying:   data.is_playing,
    volumePct:   data.device.volume_percent ?? 50,
    progressMs:  data.progress_ms ?? 0,
    deviceId:    data.device.id,
    deviceName:  data.device.name,
    track:       data.item ? normaliseTrack(data.item) : null,
    itemType:    (data.currently_playing_type ?? 'unknown') as PlaybackState['itemType'],
  }
}

// ── Transport controls ────────────────────────────────────────────────────────

export async function play(deviceId?: string): Promise<void> {
  const qs = deviceId ? `?device_id=${deviceId}` : ''
  await spotifyFetch(`/me/player/play${qs}`, { method: 'PUT' })
}

export async function pause(deviceId?: string): Promise<void> {
  const qs = deviceId ? `?device_id=${deviceId}` : ''
  await spotifyFetch(`/me/player/pause${qs}`, { method: 'PUT' })
}

export async function skipNext(deviceId?: string): Promise<void> {
  const qs = deviceId ? `?device_id=${deviceId}` : ''
  await spotifyFetch(`/me/player/next${qs}`, { method: 'POST' })
}

export async function skipPrev(deviceId?: string): Promise<void> {
  const qs = deviceId ? `?device_id=${deviceId}` : ''
  await spotifyFetch(`/me/player/previous${qs}`, { method: 'POST' })
}

// ── Volume ────────────────────────────────────────────────────────────────────

export async function setVolume(pct: number, deviceId?: string): Promise<void> {
  const vol = Math.max(0, Math.min(100, Math.round(pct)))
  const qs  = deviceId ? `&device_id=${deviceId}` : ''
  await spotifyFetch(`/me/player/volume?volume_percent=${vol}${qs}`, { method: 'PUT' })
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export async function queueTrack(uri: string, deviceId?: string): Promise<void> {
  const qs = deviceId ? `&device_id=${deviceId}` : ''
  await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}${qs}`, { method: 'POST' })
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  tracks: SpotifyTrack[]
}

export async function searchTracks(query: string, limit = 10): Promise<SearchResult> {
  const qs = new URLSearchParams({ q: query, type: 'track', limit: String(Math.min(limit, 10)) })
  const data = await spotifyFetch<{ tracks: { items: RawTrack[] } }>(`/search?${qs}`)
  return { tracks: (data.tracks.items ?? []).map(normaliseTrack) }
}

// ── History & top tracks ──────────────────────────────────────────────────────

export async function getRecentlyPlayed(limit = 20): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{ items: { track: RawTrack }[] }>(
    `/me/player/recently-played?limit=${Math.min(limit, 50)}`
  )
  return (data.items ?? []).map(i => normaliseTrack(i.track))
}

export async function getTopTracks(
  timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
  limit = 20,
): Promise<SpotifyTrack[]> {
  const qs = new URLSearchParams({ time_range: timeRange, limit: String(Math.min(limit, 50)) })
  const data = await spotifyFetch<{ items: RawTrack[] }>(`/me/top/tracks?${qs}`)
  return (data.items ?? []).map(normaliseTrack)
}

// ── Playlist management ───────────────────────────────────────────────────────

export async function getPlaylistTracks(playlistId: string, limit = 50): Promise<SpotifyTrack[]> {
  const qs = new URLSearchParams({ limit: String(Math.min(limit, 100)), fields: 'items(track(id,name,artists,album,duration_ms,uri))' })
  const data = await spotifyFetch<{ items: { track: RawTrack }[] }>(`/playlists/${playlistId}/items?${qs}`)
  return (data.items ?? []).filter(i => i.track).map(i => normaliseTrack(i.track))
}


export interface SpotifyPlaylist {
  id: string
  name: string
  public: boolean
  images: { url: string }[]
}

export async function getUserPlaylists(): Promise<SpotifyPlaylist[]> {
  const token = await getAccessToken()
  const res = await fetch(`/api/spotify/playlists?token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.playlists ?? []
}

export async function createPlaylist(name: string, isPublic = false, description = ''): Promise<SpotifyPlaylist> {
  const token = await getAccessToken()
  const res = await fetch('/api/spotify/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name, isPublic, description }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`/api/spotify/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, trackId }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function saveTrack(trackId: string): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch('/api/spotify/library/save', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: trackId, token }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function unsaveTrack(trackId: string): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch('/api/spotify/library/save', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: trackId, token }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function isTrackSaved(trackId: string): Promise<boolean> {
  const token = await getAccessToken()
  const res = await fetch(`/api/spotify/library/contains?id=${trackId}&token=${encodeURIComponent(token)}`)
  if (!res.ok) return false
  const data = await res.json()
  return data.saved ?? false
}

export async function getCurrentUserId(): Promise<string> {
  const data = await spotifyFetch<{ id: string }>('/me')
  return data.id
}

// ── Internal types & normaliser ───────────────────────────────────────────────

interface RawTrack {
  id: string
  name: string
  artists: { name: string }[]
  album: { name: string }
  duration_ms: number
  uri: string
}

interface SpotifyPlayerResponse {
  is_playing: boolean
  progress_ms: number | null
  item: RawTrack | null
  currently_playing_type: string
  device: {
    id: string | null
    name: string
    volume_percent: number | null
  }
}

function normaliseTrack(t: RawTrack): SpotifyTrack {
  return {
    id:         t.id,
    name:       t.name,
    artists:    (t.artists ?? []).map(a => a.name),
    album:      t.album?.name ?? '',
    durationMs: t.duration_ms,
    uri:        t.uri,
  }
}

// DJ curator — replaces the dead /recommendations endpoint.
// Pulls recent + top tracks as context, asks Claude for picks, resolves via /search, queues them.
// Optionally saves the result as a named playlist.

import { getRecentlyPlayed, getTopTracks, searchTracks, queueTrack,
         createPlaylist, addTracksToPlaylist, getCurrentUserId, SpotifyTrack } from './controller'
import { SPOTIFY_CONFIG } from './config'

export interface CurationRequest {
  prompt: string           // free-text mood/style description from the user or Aurora
  count?: number           // tracks to queue (default from config)
  saveAsPlaylist?: string  // if set, save queued tracks under this playlist name
}

export interface CuratedTrack {
  artist: string
  title:  string
  bpm?:   number
  camelotKey?: string
}

export interface CurationResult {
  queued:     SpotifyTrack[]
  skipped:    string[]        // Claude suggestions that couldn't be resolved via search
  playlistId: string | null
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function curate(req: CurationRequest): Promise<CurationResult> {
  const count = req.count ?? SPOTIFY_CONFIG.curator.defaultCount

  // 1. Build listening context for Claude
  const [recent, top] = await Promise.all([
    getRecentlyPlayed(20),
    getTopTracks('medium_term', 20),
  ])
  const context = buildContext(recent, top)

  // 2. Ask Claude for track suggestions
  const suggestions = await askClaude(req.prompt, context, count)

  // 3. Resolve each suggestion via Spotify search
  const queued: SpotifyTrack[]  = []
  const skipped: string[]       = []

  for (const s of suggestions) {
    const query  = `${s.artist} ${s.title}`
    const result = await searchTracks(query, 5)
    const match  = result.tracks[0]
    if (match) {
      await queueTrack(match.uri)
      queued.push(match)
    } else {
      skipped.push(query)
    }
  }

  // 4. Optionally save as playlist
  let playlistId: string | null = null
  if (req.saveAsPlaylist && queued.length > 0) {
    const userId = await getCurrentUserId()
    playlistId   = await createPlaylist(userId, req.saveAsPlaylist, `Aurora DJ · ${req.prompt}`)
    await addTracksToPlaylist(playlistId, queued.map(t => t.uri))
  }

  return { queued, skipped, playlistId }
}

// ── Claude suggestion call ────────────────────────────────────────────────────

async function askClaude(
  prompt: string,
  context: string,
  count: number,
): Promise<CuratedTrack[]> {
  const res = await fetch('/api/spotify/curate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, context, count }),
  })
  if (!res.ok) throw new Error(`Curator API failed: ${await res.text()}`)
  const data = await res.json() as { tracks: CuratedTrack[] }
  return data.tracks.slice(0, count)
}

// ── Context builder ───────────────────────────────────────────────────────────

function buildContext(recent: SpotifyTrack[], top: SpotifyTrack[]): string {
  const fmt = (t: SpotifyTrack) => `${t.artists[0]} – ${t.name}`

  const recentLines = recent.slice(0, 10).map(fmt).join('\n')
  const topLines    = top.slice(0, 10).map(fmt).join('\n')

  return `Recently played:\n${recentLines}\n\nTop tracks (medium term):\n${topLines}`
}

// Spotify client — token storage + authenticated API fetch.
// OAuth PKCE is handled server-side (/api/spotify/auth-start + /api/spotify/callback)
// so the verifier never crosses origins. Mirrors the EVE SSO pattern.

const LS_ACCESS  = 'spotify_access_token'
const LS_REFRESH = 'spotify_refresh_token'
const LS_EXPIRY  = 'spotify_token_expiry'

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Redirect to Spotify authorize via server-generated PKCE URL. */
export async function startSpotifyLogin(): Promise<void> {
  const res = await fetch('/api/spotify/auth-start')
  if (!res.ok) throw new Error('Failed to start Spotify login')
  const { url } = await res.json()
  window.location.href = url
}

export function isSpotifyConnected(): boolean {
  return !!localStorage.getItem(LS_ACCESS)
}

export function disconnectSpotify(): void {
  localStorage.removeItem(LS_ACCESS)
  localStorage.removeItem(LS_REFRESH)
  localStorage.removeItem(LS_EXPIRY)
  window.dispatchEvent(new CustomEvent('aurora_spotify_disconnected'))
}

// ── Token storage (called by App.tsx after server callback) ───────────────────

export function storeTokens(data: { access_token: string; refresh_token?: string; expires_in: number }): void {
  localStorage.setItem(LS_ACCESS, data.access_token)
  if (data.refresh_token) localStorage.setItem(LS_REFRESH, data.refresh_token)
  localStorage.setItem(LS_EXPIRY, String(Date.now() + (data.expires_in - 60) * 1000))
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken(): Promise<string> {
  const res = await fetch('/api/spotify/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: localStorage.getItem(LS_REFRESH) }),
  })
  if (!res.ok) {
    disconnectSpotify()
    throw new Error('Spotify token refresh failed — please reconnect')
  }
  const data = await res.json()
  storeTokens(data)
  return data.access_token
}

export async function getAccessToken(): Promise<string> {
  const expiry = Number(localStorage.getItem(LS_EXPIRY) ?? 0)
  if (Date.now() < expiry) return localStorage.getItem(LS_ACCESS)!
  return refreshAccessToken()
}

// ── Authenticated API fetch ───────────────────────────────────────────────────

export async function spotifyFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (res.status === 204 || res.status === 202) return undefined as T
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Spotify API ${path} → ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

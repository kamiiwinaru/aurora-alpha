// Spotify integration config — edit these values to tune behaviour.
// Equivalent to config.yml from the spec; TypeScript so it's type-checked.

export const SPOTIFY_CONFIG = {
  ducking: {
    // Target volume during TTS (0–100)
    duckVolumePct: 25,

    // Fade Spotify down to duckVolumePct over this many ms before TTS starts
    fadeDuckMs: 150,

    // Fade Spotify back to baseline over this many ms after grace period
    fadeRestoreMs: 400,

    // Wait this long after TTS ends before starting the restore fade
    graceAfterTtsMs: 800,
  },

  curator: {
    // Default number of tracks to queue when count is not specified
    defaultCount: 8,

    // Claude model used for track suggestions (haiku keeps costs low)
    model: 'claude-haiku-4-5-20251001' as const,

    // Max tokens for the suggestion response
    maxTokens: 512,
  },

  search: {
    // Max results per search query (Spotify cap for our usage is 10)
    limit: 10,
  },
} as const

export type SpotifyConfig = typeof SPOTIFY_CONFIG

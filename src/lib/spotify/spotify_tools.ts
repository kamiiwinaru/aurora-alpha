// Anthropic tool definitions for Spotify voice control.
// Imported by useChat.ts and injected into MARKET_TOOLS (or a dedicated SPOTIFY_TOOLS array).

import type Anthropic from '@anthropic-ai/sdk'

export const SPOTIFY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'spotify_play',
    description: 'Resume Spotify playback on the active device. Use when the user says "play", "resume", "unpause", or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'spotify_pause',
    description: 'Pause Spotify playback. Use when the user says "pause", "stop the music", "mute Spotify", or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'spotify_skip',
    description: 'Skip to the next or previous track. Use when the user says "skip", "next track", "go back", "previous song", or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        direction: {
          type: 'string',
          enum: ['next', 'previous'],
          description: 'Which direction to skip (default: next)',
        },
      },
      required: [],
    },
  },
  {
    name: 'spotify_volume',
    description: 'Set Spotify volume to an absolute level or adjust it relatively. Use when the user says "turn it up/down", "volume to 50", "quieter", "louder", etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        absolute: {
          type: 'number',
          description: 'Set volume to this exact percentage (0–100). Use when the user gives a specific number.',
        },
        delta: {
          type: 'number',
          description: 'Adjust volume by this amount (negative = quieter, positive = louder). Use when the user says "a bit quieter", "turn it up", etc. Typical step: ±15.',
        },
      },
      required: [],
    },
  },
  {
    name: 'spotify_queue',
    description: 'Search for a track and add it to the Spotify queue. Use when the user says "queue", "add to queue", "play X next", or names a specific song/artist to add.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — ideally "Artist Title", e.g. "Daft Punk Get Lucky"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'spotify_now_playing',
    description: 'Get the currently playing track and playback state. Use when the user asks "what\'s playing?", "what song is this?", "what\'s on?", or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'spotify_curate',
    description: 'Use Aurora\'s DJ mode to generate and queue a set of tracks based on a mood, vibe, or style description. Pulls the user\'s listening history as context and uses Claude to pick tracks, then resolves and queues them via Spotify search. Use when the user says "play something chill", "queue some focus music", "DJ mode", "surprise me", or describes a vibe. Optionally saves the set as a playlist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Mood, vibe, or style description, e.g. "dark ambient for late-night ratting", "upbeat focus music", "something like what I\'ve been listening to lately"',
        },
        count: {
          type: 'number',
          description: 'Number of tracks to queue (default 8, max 20)',
        },
        save_as_playlist: {
          type: 'string',
          description: 'If provided, save the queued tracks as a new Spotify playlist with this name',
        },
      },
      required: ['prompt'],
    },
  },
]

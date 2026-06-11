# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start both client (Vite :5173) and server (Express :3001) concurrently
npm run client     # Vite dev server only
npm run server     # tsx watch server/index.ts only
npm run build      # tsc + vite build
```

No test suite exists. There is no linter configured. TypeScript errors surface via `npm run build` or the Vite dev server overlay.

The `.env` file (not committed) must exist at root with:
```
ANTHROPIC_API_KEY=
EVE_CLIENT_ID=
EVE_CLIENT_SECRET=
EVE_CALLBACK_URL=http://localhost:3001/api/eve/callback
VITE_EVE_CLIENT_ID=
VITE_EVE_CALLBACK_URL=http://localhost:3001/api/eve/callback
JANICE_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
PORT=3001
```

---

## Architecture

Two processes communicate through a Vite proxy (`/api` → `:3001`):

- **`server/index.ts`** — single-file Express server. All backend logic lives here: EVE SSO OAuth, Anthropic streaming chat with agentic tool loop, ElevenLabs TTS proxy, Janice market appraisal proxy, ESI proxies (zkill, market history, name resolution), intel log reader, and JSON file persistence for todos/roadmap/pronunciations.
- **`src/`** — React 18 + TypeScript SPA. No routing library used in practice (React Router is a dep but not used for navigation — panels are toggled by state).

### State ownership

| Hook | Owns |
|---|---|
| `useChat` | Conversations (localStorage), streaming state, TTS playback, `voiceEnabled`, `ttsMode`, `autoListenTrigger` |
| `useEve` | EVE characters (localStorage), all ESI data, token refresh loop |
| `useVoiceInput` | Wake word + active listening state machine, shared by ChatInput, Aurora sidebar, and LandingPage |

`App.tsx` is the root orchestrator — it instantiates both hooks and passes props down. There is intentionally no global state library (no Redux/Zustand/Context).

### Chat / AI flow

1. `useChat.sendMessage` (or `sendInNewSession`) POSTs to `/api/chat` with the full system prompt, message history, and optional `characterId`.
2. Server runs an **agentic loop**: streams a Anthropic `claude-sonnet-4-6` response, detects `tool_use` stop reason, executes tools (`appraise_items`, `get_price_history`, `query_assets`, `roadmap_*`, `todo_*`), appends `tool_result` messages, and loops until `end_turn`.
3. SSE stream sends `data: {"delta":{"text":"..."}}` chunks and `data: {"tool":{"name":"...","status":"calling|done"}}` events back to the client.
4. After streaming ends, if `voiceEnabled`, the client POSTs `accumulated` text + `ttsMode` to `/api/tts`.

### TTS pipeline (server-side, `/api/tts`)

Raw markdown → `extractSpokenText(mode)` → `normalizeForSpeech()` → `applyPronunciations()` → ElevenLabs stream.

- **`extractSpokenText`**: strips code blocks and table rows line-by-line, removes markdown syntax; `concise` ≈220 chars, `standard` ≈520 chars, `full` = unlimited.
- **`normalizeForSpeech`**: converts dates (`YYYY-MM-DD`), ISK amounts with K/M/B/T suffixes (using `numberToWords`), time durations (`1d 15h`), and EVE system codes (`G-7WUF` → `gee tack seven double-you you eff`) to spoken form. ISK is lowercased to `isk` to prevent letter-spelling.
- **`applyPronunciations`**: applies user-defined word→phonetic substitutions from `pronunciations.json`.

### Voice input state machine (`useVoiceInput`)

Phases: `off` → `standby` (wake armed) → `activated` (wake detected, 50 ms gap) → `listening` → `pending` (silence timer, 2 s) → submit → back to `standby`.

Used in three places: `ChatInput` (main comms), `Aurora` sidebar component (panel-level), `LandingPage` / `AuroraCorner`. All three share the same hook; `returnToStandby: true` re-arms after each submission.

### EVE SSO flow

1. Client redirects to EVE SSO via `getEveLoginUrl()` (scopes in `src/lib/eve-esi.ts`).
2. EVE redirects to `GET /api/eve/callback` on the server, which exchanges the code, decodes the JWT for character info, fetches `corporationId` from ESI, then redirects to `http://localhost:5173/?eve_access_token=...`.
3. `App.tsx` catches URL params on mount (`callbackHandled` ref prevents double-fire), calls `eve.loginWithToken(...)`.
4. `useEve` persists characters to `localStorage` keyed as `aurora_eve_characters`. Multi-character is supported.
5. Token refresh: `useEve` calls `POST /api/eve/refresh` before expiry; the server proxies to EVE SSO.

### Asset sub-agent

`POST /api/assets/sync` (called by client after each ESI refresh) caches the full resolved asset list in server memory keyed by `characterId`. When Aurora's `query_assets` tool fires, a separate `claude-haiku-4-5` call answers with only the asset context — keeping the main prompt lean.

### Server-side JSON persistence

Four files written to `process.cwd()` (project root):
- `todos.json` — pilot to-do list
- `roadmap.json` — Aurora development roadmap (seeded from `ROADMAP_DEFAULT` on first run)
- `pronunciations.json` — custom word→phonetic pairs for TTS

### Panel layout

`ActivePanel` union type: `chat | skills | industry | assets | market | janice | zkill | intel | roadmap`. `zkill`, `intel`, and `janice` panels are **always mounted** (hidden via CSS class) to preserve their internal state across tab switches. All others are conditionally rendered.

### Styling

Tailwind with a custom EVE Online dark theme. Key CSS variables/classes defined in `src/styles/globals.css`: `eve-panel`, `eve-btn`, `eve-btn-primary`, `eve-input`, `eve-header`, `eve-label`, colour tokens (`eve-cyan`, `eve-gold`, `eve-red`, `eve-green`, `eve-orange`, `eve-muted`, `eve-dim`, `eve-border`, `text-glow-cyan`). The scanline overlay is a global CSS pseudo-element.

### UI / visual testing

**Static panel mockups** live in `public/preview-*.html` — plain HTML files served by Vite at `http://localhost:5173/preview-*.html`. No auth required. Use these for color/layout previews. Current: `preview-industry.html`.

**Bypass EVE login for quick navigation testing** — paste in browser console, then reload:
```js
localStorage.setItem('aurora_eve_characters', JSON.stringify([{
  characterId: 12345,
  characterName: "Kami Iwinaru",
  accessToken: "fake",
  refreshToken: "fake",
  expiresAt: Date.now() + 999999999,
  corporationId: 1,
  allianceId: null
}]))
```
⚠️ The app will hang on ESI API calls with a fake token — good enough to reach a panel and inspect layout/color, but not functional. Clear with `localStorage.removeItem('aurora_eve_characters')` when done.

### VoiceBubble (landing page overlay)

When voice is triggered on the landing page, `App.tsx` sets `showVoiceBubble = true` and calls `chat.sendInNewSession(text)` — the user stays on the landing page while the response streams into a centered floating overlay (`VoiceBubble.tsx`). The bubble shows the last user+assistant exchange, supports minimize/close, and has an "OPEN COMMS" button that navigates to the chat panel.

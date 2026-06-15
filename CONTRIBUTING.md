# Contributing to Aurora Alpha

Thanks for your interest in Aurora. This is a personal project but contributions are welcome — bug fixes, UI improvements, and EVE ESI integrations especially.

---

## What Aurora is

A Windows desktop app (Electron + React + Express) that connects to your EVE Online account via ESI and gives you an AI assistant (Claude) with awareness of your character data — assets, skills, industry jobs, market orders, intel, and more.

---

## Getting started

### Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com) (Claude)
- An EVE Online account with ESI credentials (optional for UI work)

### Setup

```bash
git clone https://github.com/kamiiwinaru/aurora-alpha.git
cd aurora-alpha
npm install
```

Create a `.env` file at the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...
EVE_CLIENT_ID=
EVE_CLIENT_SECRET=
EVE_CALLBACK_URL=http://localhost:3001/api/eve/callback
VITE_EVE_CLIENT_ID=
VITE_EVE_CALLBACK_URL=http://localhost:3001/api/eve/callback
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
PORT=3001
```

EVE SSO credentials are optional — without them you can still work on UI panels using the fake-login trick below.

### Run in dev mode

```bash
npm run dev
```

This starts both the Vite frontend (`:5173`) and the Express backend (`:3001`) concurrently.

### Bypass EVE login for UI work

Paste this in the browser console, then reload:

```js
localStorage.setItem('aurora_eve_characters', JSON.stringify([{
  characterId: 12345,
  characterName: "Test Pilot",
  accessToken: "fake",
  refreshToken: "fake",
  expiresAt: Date.now() + 999999999,
  corporationId: 1,
  allianceId: null
}]))
```

The app will load but ESI calls will fail — good enough to navigate panels and test layout/styling without a live EVE account.

Clear with `localStorage.removeItem('aurora_eve_characters')` when done.

---

## Project structure

```
server/index.ts        — Express backend: ESI proxies, AI chat loop, tools
src/
  App.tsx              — Root orchestrator, hook wiring, panel routing
  hooks/
    useChat.ts         — Conversation state, streaming, TTS, asset intercepts
    useEve.ts          — EVE characters, ESI data, token refresh
    useVoiceInput.ts   — PTT / wake word state machine
  components/
    panels/            — One file per tab (AssetsPanel, IntelPanel, etc.)
    Aurora.tsx         — AI avatar sidebar
  lib/
    eve-esi.ts         — ESI scopes, login URL builder
electron/
  main.ts              — Electron main process, IPC handlers, auto-updater
  preload.ts           — Context bridge (exposes electronAPI to renderer)
public/
  setup.html           — Standalone first-run configuration screen
```

---

## Development notes

- **No test suite** — TypeScript errors surface via `npm run build` or the Vite overlay. Build before submitting a PR.
- **No linter** — keep style consistent with surrounding code.
- **Two processes** — frontend at `:5173`, backend at `:3001`. The Vite dev config proxies `/api` to `:3001` so fetch calls work without CORS issues in the browser.
- **Electron vs browser** — `window.electronAPI` is only present in the Electron build. Guard any IPC calls with `window.electronAPI?.someMethod`.
- **State management** — no Redux/Zustand/Context. `App.tsx` instantiates `useChat` and `useEve` and passes props down. Keep it that way unless there's a strong reason not to.

---

## Submitting a PR

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Run `npm run build` and fix any TypeScript errors
4. Open a pull request with a clear description of what changed and why

Please keep PRs focused — one feature or fix per PR makes review much easier.

---

## Reporting bugs

Use the built-in **Feedback** button inside Aurora (bottom of the sidebar) — it captures a screenshot and attaches recent app logs automatically, which makes bugs much easier to diagnose.

For issues that prevent Aurora from launching, open a [GitHub issue](https://github.com/kamiiwinaru/aurora-alpha/issues) instead.

---

## What's out of scope

- Mercenary Den / MTO tracking — ESI endpoints are not yet live; stubs exist but are reverted until deployment
- Vosk offline voice recognition — blocked by Windows Smart App Control; parked pending investigation
- Mobile or web versions — Aurora is a Windows desktop app and is likely to stay that way

---

*Not affiliated with CCP Games. EVE Online is a trademark of CCP hf.*

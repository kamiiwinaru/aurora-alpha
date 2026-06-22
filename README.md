# Aurora Alpha
### Capsuleer Intelligence System for EVE Online

Aurora is a personal AI assistant for EVE Online pilots, built as a standalone Windows desktop app. It connects to your EVE account via ESI, pulls your character data, and gives you an AI you can actually talk to about your assets, skills, industry jobs, market orders, killmails, and more.

---

## Features

- **AI Chat (COMMS)** — Conversational AI powered by Claude, with full awareness of your EVE character data
- **Skills** — Live skill queue, training time, skill planning, and fit analysis with skill plan export
- **Industry** — Active job tracking, blueprint inventory, material analysis
- **Assets** — Searchable asset list across all locations and containers
- **Market** — Active buy/sell orders, price history charts, and Trade Agent scan (relist opportunities, mislisted items, high-volume picks)
- **Appraisal** — Paste a cargo scan or item list for instant Janice appraisal
- **zKillboard** — Inline killboard with ship renders and pilot portraits; supports character, corporation, and alliance lookups
- **Intel** — Local intel log parsing with threat highlighting, auto-detected player location, and voice alerts via Aurora TTS
- **Star Map** — Interactive galaxy map with route planning, jump bridge support, and region/system search
- **PVE** — LP store offer ranker (ISK/LP across all characters) and mission database with damage types, NPC breakdown, and blitz notes
- **Spotify** — Sidebar music controls: play/pause/skip, volume, liked tracks, and playlist management. Auto-ducks during intel alerts
- **Voice** — Push-to-talk voice input via ElevenLabs Scribe, and ElevenLabs voice synthesis (optional)
- **Wallet** — Transaction and journal history across all characters
- **Multi-character** — Add and switch between multiple EVE characters
- **Feedback** — Submit bugs or suggestions with an optional screenshot directly from the app

---

## Installation

1. Download **Aurora-Alpha-Setup-1.0.9.exe** from the [latest release](https://github.com/kamiiwinaru/aurora-alpha/releases/latest)
2. Run the installer
3. On first launch, enter your **Anthropic API key** ([get one here](https://console.anthropic.com))
4. Log in with your EVE account via the EVE SSO button
5. Start flying smarter

> **ElevenLabs** API key is optional — only needed if you want Aurora to speak responses aloud.
> **No AI Mode** — Aurora can run without an Anthropic key if you only need EVE data tools (assets, market, intel, etc.).

---

## Requirements

- Windows 10 or 11
- An [Anthropic API key](https://console.anthropic.com) (Claude — pay-as-you-go, no subscription required)
- An EVE Online account

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| F1 | COMMS (Chat) |
| F2 | Skills |
| F3 | Industry |
| F4 | Assets |
| F5 | Market |
| F6 | Appraise |
| F7 | zKillboard |
| F8 | Intel |
| F11 | Toggle fullscreen |

---

## Updates

Aurora checks for updates automatically on launch. When a new version is available it will download in the background and prompt you to restart and install.

---

## Built With

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- [Anthropic Claude](https://www.anthropic.com/) (`claude-sonnet-4-6`)
- [EVE ESI](https://esi.evetech.net/)
- [ElevenLabs](https://elevenlabs.io/) (optional voice)

---

*Not affiliated with CCP Games. EVE Online is a trademark of CCP hf.*

# Changelog

## [1.0.2] — 2026-06-12

### Added
- Initial public release of Aurora Alpha — EVE Online AI assistant built on React + Tailwind + Express + Anthropic SDK.
- Full panel suite: COMMS, SKILLS, INDUSTRY, ASSETS, MARKET, APPRAISE (Janice), ZKILL, INTEL, MAP, ROADMAP, WALLET.
- EVE SSO multi-character login with automatic token refresh.
- Streaming AI chat (Claude Sonnet) with agentic tool loop — appraisal, route planning, asset queries, skill lookups, todo/roadmap management.
- Star map with region/system zoom, route planning (ESI + client-side Dijkstra), jump bridge support.
- Voice input (wake word + push-to-talk) and ElevenLabs TTS with EVE-aware speech normalization.
- Skill panel now shows all skills organised into collapsible groups (e.g. Spaceship Command, Engineering) with a skill-level breakdown summary — previously showed only the top 50 by SP.
- Server-side skill group resolution with 72-hour disk cache; skills data survives server restarts and is pre-loaded on startup.
- Map search now accepts regions in addition to systems — selecting a region zooms the map to fit all its systems.
- Options menu added to both the title bar and the in-app header, housing the dark/light mode toggle and future settings.
- App version in the header now reads dynamically from package.json instead of being hardcoded.
- Voice input now primes the selected microphone device before starting speech recognition, improving reliability when a non-default mic is configured.
- Wallet panel with multi-character journal/transaction history and ISK totals.
- zKill panel with inline killboard, name resolution, and EVE portrait/ship renders.
- Intel log reader with system highlight and threat parsing.
- Venture Game idle mini-game on the landing page.
- Electron desktop app (Windows) with auto-update via GitHub Releases and guided API key setup screen.
- Prompt caching (static system block) to reduce token costs on repeated queries.
- README added with setup and build instructions.

### Changed
- Skill panel context sent to Aurora now includes all skills grouped by category rather than just the top 50 by SP.
- Setup screen now shows "already configured — leave blank to keep" placeholder for saved secrets instead of exposing them, and blank fields on save no longer overwrite existing values.

### Removed
- Mercenary Den Tracker panel — ESI endpoints for Mercenary Dens and MTOs are not yet deployed to production (all return 404); feature reverted until ESI goes live.
- Dark/light mode toggle removed from the top-level header and consolidated into the new Options menu.
- DevTools (F12) shortcut and auto-open on load failure restricted to dev builds only.
- Unused bot/, Aurora.bat, preview HTML mockups, and internal script logs removed from the repo.

### Security
- OAuth callback log now redacts access tokens, refresh tokens, and auth codes before writing to the application log.
- Removed personal data files (fits, structures, todos, roadmap, pronunciations) from version control.
- Untracked private config files (CLAUDE.md, SETUP.md) from the repo; added to .gitignore.
- `skills_*.json` cache files added to .gitignore.
- Express server binds to 127.0.0.1 only — not exposed on LAN.
- Setup IPC returns masked values only; renderer never sees real API keys.

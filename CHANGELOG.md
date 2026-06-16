# Changelog

## [1.0.8] — 2026-06-16

### Added
- **Spotify integration** — music controls embedded in the sidebar: play/pause/skip, volume, liked track toggle, playlist add, and "now playing" display. Connects via Spotify OAuth (PKCE). Auto-ducks volume during intel alerts and restores after. AI can control playback via new Spotify tools.
- **PVE panel (F11)** — Loyalty Point store offer ranker. Shows all LP offers across all logged-in characters sorted by ISK/LP, with required item costs, net ISK, and sell price pulled from market data.
- **Intel "all clear" voice alerts** — Aurora now speaks a randomised clear phrase ("System clear", "All clear on intel") when a previously flagged system goes quiet.
- **Notifications panel rework** — overhauled with a new `notif-utils` library: human-readable type labels instead of raw camelCase, color-coded categories (kills, structures, warfare, financial, etc.), read/unread dot indicators, inline text snippets, and mailing list support in compose. Notification count badge on landing page now reflects unread-only, not total.
- **All panels always-mounted** — every tab panel is now kept in the DOM (hidden via CSS) rather than unmounted on tab switch. State is preserved when switching away and back.
- **GitHub community files** — bug report template, feature request template, and a general "Other" issue template added to `.github/ISSUE_TEMPLATE/`. `CONTRIBUTING.md` and `SECURITY.md` added.

### Changed
- Notifications tab count in the landing page mail feed now shows unread notifications only, not total.
- Panel layout in `App.tsx` refactored from conditional rendering to CSS-hidden always-mounted divs for consistency.

## [1.0.7] — 2026-06-15

### Added
- **Smart asset queries** — Aurora now answers asset questions without hitting the AI API for common patterns. Category queries ("what ships do I have?"), location queries ("assets in Jita"), and named-item lookups ("how much Tritanium do I have?") are resolved instantly from in-memory data. Vague broad queries ("check my assets") are intercepted and prompt the pilot to narrow down.
- **`lookup_items` tool** — new server-side tool for batch exact item-name lookup; used when Aurora checks a fit, shopping list, or manifest against inventory. Much faster and cheaper than `query_assets` for lists of specific items.
- **Cross-character asset queries** — asset searches now aggregate across all logged-in characters, not just the active one.
- **Log attachment in feedback** — bug reports now automatically attach the last 200 lines of `aurora.log` to the Discord webhook submission, making it easier to diagnose issues.
- **Persistent server caches** — blueprint type lookup cache (`bp_type_cache.json`), blueprint data cache (`bp_data_cache.json`), and ESI group name cache (`type_groups.json`) now survive server restarts, eliminating ~325 ESI calls on every cold start after the first.
- **In-app guide screenshots** — guide images added to `public/guide/` for future help panel.

### Changed
- NavTabs active indicator replaced Framer Motion `layoutId` animation with a plain CSS opacity transition — eliminates layout jank when switching tabs.
- Asset sub-agent (`query_assets`) now filters assets to the relevant category or location before passing context to the AI, reducing token usage and improving response accuracy. Filtered count is reported in the system context.
- Merged arrays (`allAssets`, `allIndustryJobs`, `allMarketOrders`) now computed with `useMemo` to avoid unnecessary re-renders.
- `query_assets` tool description updated to direct Aurora to prefer `lookup_items` for specific named-item checks.

## [1.0.6] — 2026-06-14

### Changed
- Version bump to force a clean GitHub release publish.

## [1.0.5] — 2026-06-14

### Added
- Intel alerts now trigger Aurora's voice — when a hostile is reported within range, Aurora speaks a randomised alert line and logs the report into a dedicated Intel comms session automatically.
- Push-to-talk now works on every panel, not just COMMS — holding the PTT key on any panel sends voice to Aurora and shows the response in the Voice Bubble overlay.
- ElevenLabs Scribe speech-to-text added as the PTT transcription backend, replacing browser Web Speech API for audio recording.
- Google Speech API key support — the key is now passed directly to Chromium's Web Speech API so voice input works in the Electron app without a separate service.
- zKillboard now supports corporation and alliance lookups in addition to character searches.
- Intel log auto-discovery — the Intel panel can now detect and load the most recent log files automatically without manually entering a channel name, and filters by active character.
- No-AI mode — Aurora can now run without an Anthropic API key for users who only need EVE data tools.
- TitleBar now appears on both the landing page and main app view for consistent window controls across all states.
- Sidebar now has a "Clear All" button to delete all conversations at once.
- Escape key exits fullscreen in the Electron app.
- Voice toggle button added to the Aurora avatar panel when on non-COMMS panels.

### Changed
- Intel log parser now extracts the Listener (character name) from log headers and uses it to pick the correct log file when multiple characters have logs for the same channel.
- Intel chatlog directory path now auto-detects the Windows username instead of being hardcoded.
- Window maximize/fullscreen behaviour corrected — maximize and fullscreen are now separate actions with proper IPC events for state tracking.
- Window controls moved to TitleBar component exclusively; duplicate controls removed from the main app header.
- Clicking a conversation in the sidebar now also navigates to the COMMS panel.
- Discord webhook URL moved to a gitignored `secrets.ts` file so it is never committed to the repo.
- Vosk offline recognition stubbed out pending Smart App Control investigation — Web Speech API is used as the voice backend in this build.

### Fixed
- Intel log parser now generates unique IDs for duplicate timestamp+character entries, preventing React key collisions when the same pilot sends multiple messages in one second.

## [1.0.4] — 2026-06-13

### Added
- In-app feedback tool — a FEEDBACK button in the header and landing page lets you submit bugs, UI issues, and feature requests with an optional screenshot, sent directly to a Discord channel.
- Trade Agent (Market panel) — new scan modes: Relist (spread opportunities with 30-day volume filtering), Mislisted (negative-spread items to flip), and High Volume (top-volume items). One scan fetches all three; mode buttons switch instantly without re-fetching.
- Vosk offline speech recognition support — fallback voice model for use when Google Speech API is unavailable; downloads automatically on first use.
- Google Speech API key field added to the setup screen for enabling voice input in the desktop app.
- Screenshot capture IPC — the app can now capture a screenshot of itself before opening the feedback modal, so the submission shows what you were looking at.

### Changed
- Aurora image updated to new artwork (Aurora1.png); "cute/hot" variant toggle removed.
- Aurora sidebar panel no longer shows the voice toggle slider — wake word arming is handled in the chat input bar only.
- Options cog (settings menu) now appears on the login screen and character showcase header, replacing the standalone dark/light mode button in those locations.
- Skill panel now uses the active character's ID correctly when fetching enriched skill data (was always using the first character in the list).
- Fit Analyzer skill plan export now uses Roman numerals and strips control characters from skill names for correct EVE clipboard import.
- Character switcher on the landing page wraps to multiple rows when many characters are linked, preventing off-screen overflow.
- ElevenLabs "hot" voice variant removed; TTS always uses the configured voice ID.

### Fixed
- Voice input now correctly routes to the selected microphone device when a non-default mic is configured in Options.
- Vosk wake word tooltip now shows download progress percentage while the model is loading.

## [1.0.3] — 2026-06-13

### Fixed
- Roadmap panel now correctly shows previously completed items as done on fresh installs — the default roadmap seeded on first run now reflects current completion state.

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

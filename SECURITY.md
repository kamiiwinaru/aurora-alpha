# Security Policy

## Supported Versions

Only the latest release of Aurora Alpha receives security fixes. Older versions are not actively maintained.

| Version | Supported |
|---------|-----------|
| Latest  | ✅ |
| Older   | ❌ |

---

## Reporting a Vulnerability

If you discover a security vulnerability in Aurora, please **do not open a public GitHub issue**. Instead, report it privately so it can be addressed before public disclosure.

**Contact:** Discord — @Tosai924

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- The Aurora version you tested against

You can expect an acknowledgement within a few days. There is no formal bug bounty program, but all valid reports are taken seriously.

---

## Security notes for users

- Aurora runs entirely on your local machine — the Express backend binds to `127.0.0.1` only and is not exposed on your local network.
- Your Anthropic API key and EVE SSO credentials are stored in your user data directory (`%APPDATA%\aurora-alpha\.env`) and are never transmitted anywhere except the intended services (Anthropic API, EVE SSO).
- The setup screen never displays your real API keys in plaintext after they are saved.
- DevTools (F12) are disabled in production builds.

---

## Scope

The following are considered in scope for vulnerability reports:

- Credential exposure or leakage
- EVE SSO token handling
- Local privilege escalation via the Electron main process
- IPC context bridge misuse that exposes unsafe Node.js APIs to the renderer

The following are out of scope:

- Vulnerabilities in third-party services (Anthropic, EVE ESI, ElevenLabs, Janice)
- Social engineering
- Issues requiring physical access to the machine

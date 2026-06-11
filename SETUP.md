# Aurora — Setup Guide

## 1. Install Node.js
Download and install from https://nodejs.org (LTS version, 20.x or later)

## 2. Add your Anthropic API key
Edit `.env` in this folder:
```
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```

## 3. (Optional) Set up EVE Online SSO
- Go to https://developers.eveonline.com
- Create an application with callback URL: `http://localhost:5173/eve/callback`
- Enable scopes: skills, assets, industry, markets, wallet
- Copy Client ID and Secret into `.env`

## 4. Install & run
Open a terminal in this folder and run:
```bash
npm install
npm run dev
```

Open http://localhost:5173

## Keyboard shortcuts
- F1 — Chat (COMMS)
- F2 — Skills
- F3 — Industry
- F4 — Assets
- F5 — Market

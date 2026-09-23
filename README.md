# Godfather — AI Chart Scanner (v2, Screenshot Mode)

Installable web app (PWA) where you upload a chart screenshot, an AI
(Gemini) reads it using ICT / Smart Money concepts and returns a BUY /
SELL / WAIT signal with Entry, Stop Loss and Take Profit, and you can
execute a batch of trades straight into your MT4/5 account via MetaApi
Cloud.

## What changed from v1

v1 fetched/generated OHLC candle data and ran it through a local rule
engine (`scanner.js`). v2 instead sends your uploaded **screenshot**
directly to the Gemini API and asks it to read the chart and reason
about the setup itself. `scanner.js` is kept in the repo (it's solid,
deterministic ICT logic) but isn't wired into the main flow anymore —
useful if you ever reconnect a live candle feed later.

- **Nav** simplified to two bottom tabs: **Home** and **Settings**
  (both still bottom-anchored).
- **Home**: upload a screenshot → AI analyzes it → signal card →
  choose number of trades (1/3/7/9) → Confirm & Execute.
- **Settings**: where you paste your own **Gemini API key** and
  **MetaApi Cloud** token/account ID. Saved to `localStorage` on your
  device only.
- **Symbols**: added a Forex Majors row (EURUSD, GBPUSD, USDJPY,
  USDCHF, AUDUSD, USDCAD, NZDUSD) alongside the original
  XAUUSD/US30/GER30/USTECH row.
- Fixed a v1 bug: `api.js` was never actually `<script>`-included in
  `index.html`, so `GodfatherAPI` was undefined and every candle
  request silently fell back to mock data. It's included now.

## Important: this is a personal-use architecture, not multi-tenant

Because your Gemini and MetaApi keys are entered in Settings and used
directly from the browser (`api.js`), they live in this browser's
`localStorage` and are sent straight to Google/MetaApi — there is no
backend hiding them. That's fine for **your own device, your own
keys, your own trading account**. It stops being fine the moment
anyone else uses this build: don't publish this as a public site with
your keys already filled in, and don't hand this codebase to other
users expecting them to bring their own keys without you re-adding a
server-side proxy (see v1's original `/api/*` design if you need
that later).

## Project structure

```
godfather/
├── index.html            Home (upload + scan) and Settings pages
├── manifest.json          PWA manifest (installability)
├── service-worker.js       Offline app-shell caching (cache bumped to v2)
├── tokens.css              Design tokens (color, type, radius)
├── app.css                 Component + layout styles
├── chart.js                Canvas candlestick renderer (currently unused, kept for later)
├── scanner.js               GodfatherEngine — ICT rule engine (currently unused, kept for later)
├── api.js                    Gemini screenshot analysis + MetaApi Cloud trade execution + settings storage
├── app.js                     App controller: upload flow, scan animation, result + settings wiring
└── icons/                     App icons
```

## Setup

1. Get a **Gemini API key** at [ai.google.dev](https://ai.google.dev).
2. Get a **MetaApi Cloud** account at [metaapi.cloud](https://metaapi.cloud),
   connect your MT4/5 account, and grab its **Account ID** and an
   **auth token**.
3. Open the app → **Settings** → paste both in → **Save Settings**.
4. Go to **Home** → upload a chart screenshot → **Scan Chart**.

### One thing to check before going live: MetaApi region

`api.js` currently calls MetaApi's `mt-client-api-v1.new-york.agiliumtrade.ai`
endpoint directly. MetaApi accounts are provisioned in a specific
region, and the correct host can differ from New York — call MetaApi's
provisioning API (`GET /users/current/accounts/{id}`) once to read the
account's real region, then update the host in `api.js`, or trades
will fail with a routing error.

## Still to build

- Live Positions / Account screen (MetaApi open positions, close/modify)
- Verifying the MetaApi regional endpoint automatically instead of
  hardcoding `new-york`
- Reconnecting `scanner.js` as an optional path if you bring back a
  live candle feed alongside screenshot mode

## Local preview

Any static file server works, e.g.:
```
npx serve .
```
Then open the printed localhost URL on your phone (same network) or in
desktop Chrome and use "Install app" from the browser menu to test the
PWA install flow.

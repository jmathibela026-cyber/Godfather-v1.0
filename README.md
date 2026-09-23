# Godfather — AI Chart Scanner (v4, Live Chart via Twelve Data)

Installable web app (PWA) that pulls a **live chart** for your chosen
symbol from Twelve Data, runs it through a local ICT "Liquidity Sweep"
rule engine, and produces a BUY / SELL / WAIT signal with Entry, Stop
Loss and Take Profit — then lets you fire a batch of trades into your
MT4/5 account via MetaApi Cloud.

## What changed from v3

v3 pulled live candles from MetaApi Cloud. v4 splits the two jobs
between two providers, which is closer to the original v1 plan:

- **Twelve Data** → live/historical candle data for the chart and the
  scan engine.
- **MetaApi Cloud** → trade execution only (placing orders on your
  connected MT4/5 account, and reading open positions).

Everything else is unchanged: `scanner.js` still does the actual
analysis locally (no AI/LLM in the loop), two bottom tabs (Home /
Settings), Forex Majors symbol row, trade-count selector.

## Settings now has two sections

1. **Live Chart Data — Twelve Data**: paste a Twelve Data API key
   (free tier at [twelvedata.com](https://twelvedata.com)).
2. **Trade Execution — MetaApi Cloud**: token, account ID, lot size
   (unchanged from v3).

## Important: this is a personal-use architecture, not multi-tenant

Both keys are entered in Settings and used directly from the browser
(`api.js`) — they live in this browser's `localStorage` and are sent
straight to Twelve Data / MetaApi Cloud. That's fine for **your own
device, your own keys, your own account**. Don't publish this as a
public site with your keys already filled in, and don't hand this
codebase to other users without adding a server-side proxy back in.

## Project structure

```
godfather/
├── index.html            Home (live chart + scan) and Settings pages
├── manifest.json          PWA manifest (installability)
├── service-worker.js       Offline app-shell caching (cache bumped to v4)
├── tokens.css              Design tokens (color, type, radius)
├── app.css                 Component + layout styles
├── chart.js                Canvas candlestick renderer, with SL/Entry/TP overlay
├── scanner.js               GodfatherEngine — the ICT Liquidity Sweep rule engine
├── api.js                    Twelve Data candles + MetaApi Cloud trade execution + settings storage
├── app.js                     App controller: live polling, scan animation, result + settings wiring
└── icons/                     App icons
```

## Setup

1. Get a **Twelve Data** API key (free tier: 800 calls/day, 8/min —
   fine for personal use with the 15s chart refresh this app does).
2. Get a **MetaApi Cloud** account, connect your MT4/5 account, and
   grab its **Account ID** and an **auth token**.
3. Open the app → **Settings** → paste both in → **Save Settings**.
4. Go to **Home** — the live chart should start loading. Tap
   **Scan Chart** once candles are showing.

### Things to verify before going live

1. **Index symbols.** Twelve Data doesn't use broker CFD names like
   US30/GER30/USTECH — `api.js` maps them to Twelve Data's own tickers
   (`DJI`, `GDAXI`, `NDX`). Whether those resolve depends on your
   Twelve Data plan (indices are sometimes gated to paid tiers) — if a
   chart won't load for one of these, check Twelve Data's symbol
   search for the exact ticker your plan has access to and adjust
   `TD_SYMBOL_MAP` in `api.js`.
2. **MetaApi region.** The trade/positions hosts in `api.js` are
   hardcoded to MetaApi's `new-york` region (`REGION` constant). If
   your account is provisioned elsewhere, update it or trade requests
   will fail to route.
3. **Rate limits.** The free Twelve Data tier caps at 8 requests/min.
   The 15s auto-refresh on Home uses 1 call per refresh — fine solo,
   but leave multiple tabs open and you'll hit the limit.

## Still to build

- Live Positions / Account screen (MetaApi open positions, close/modify)
- Auto-detecting the MetaApi region instead of hardcoding it
- A symbol picker backed by Twelve Data's `/symbol_search` endpoint
  instead of a hardcoded ticker map, so any instrument your plan
  supports "just works"

## Local preview

Any static file server works, e.g.:
```
npx serve .
```
Then open the printed localhost URL on your phone (same network) or in
desktop Chrome and use "Install app" from the browser menu to test the
PWA install flow.

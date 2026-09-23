# Godfather — AI Chart Scanner

Installable web app (PWA) that scans live charts using an ICT "Liquidity
Sweep" rule engine and produces BUY / SELL / WAIT signals with Entry, Stop
Loss and Take Profit.

## Status

This is the **v1 frontend + signal engine**, running on mock candle data
until the backend below is deployed. The UI, scan flow, and signal logic
are fully functional — connect the two API functions and it goes live.

## Project structure

```
godfather/
├── index.html          Home / Chart Scanner screen + Signal Result view
├── manifest.json        PWA manifest (installability)
├── service-worker.js     Offline app-shell caching
├── css/
│   ├── tokens.css        Design tokens (color, type, radius — from the UI reference)
│   └── app.css           Component + layout styles
├── js/
│   ├── chart.js          Canvas candlestick renderer (with SL/Entry/TP overlay)
│   ├── scanner.js         GodfatherEngine — the ICT Liquidity Sweep rule engine
│   ├── api.js             Frontend API client (calls your backend, see below)
│   └── app.js              App controller: chips, scan animation, result rendering
├── icons/                 App icons
└── api/                  Backend serverless functions (you deploy these)
```

## Why a backend is required

Twelve Data and MetaAPI keys must never live in frontend JavaScript —
anyone could open dev tools and steal them. `js/api.js` already calls
`/api/candles`, `/api/quote`, `/api/trade`, `/api/positions` — you need to
implement those as serverless functions (Vercel, Netlify, or Cloudflare
Workers all have free tiers) that hold your real API keys server-side and
proxy the requests.

### `/api/candles?symbol=XAUUSD&interval=M15&count=60`
Calls Twelve Data's `time_series` endpoint, returns:
```json
[{ "t": 1699999999000, "o": 2400.1, "h": 2401.5, "l": 2399.2, "c": 2400.8 }, ...]
```

### `/api/trade` (POST)
Body: `{ symbol, direction, entry, sl, tp, lots }` — calls MetaAPI's trade
execution endpoint using your account credentials.

### `/api/positions`
Calls MetaAPI's positions endpoint for the Live Positions screen (not yet
built — next stage).

## Deploying

1. Push this repo to GitHub.
2. **Frontend (GitHub Pages):** Settings → Pages → deploy from `main` /
   root. Your PWA is installable directly from that URL.
3. **Backend:** deploy the `api/` functions to Vercel or Netlify (both
   support serverless functions and free custom domains), and set
   `TWELVE_DATA_API_KEY` and `METAAPI_TOKEN` as environment variables
   there — never commit them to the repo.
4. If your backend lives on a different domain than GitHub Pages, update
   `BASE_URL` in `js/api.js` to point at it, and make sure the backend
   sends CORS headers allowing your Pages origin.

## Still to build

- Live Positions / Account screen (MetaAPI open positions, close/modify)
- Settings screen (API connection status, strategy parameters)
- The `api/` backend functions themselves (Twelve Data + MetaAPI proxies)

## Local preview

Any static file server works, e.g.:
```
npx serve .
```
Then open the printed localhost URL on your phone (same network) or in
desktop Chrome and use "Install app" from the browser menu to test the PWA
install flow.

/* ==========================================================================
   GODFATHER — API Layer
   Talks to YOUR backend (see /api/*.js in the repo root's serverless
   functions), which holds the real Twelve Data + MetaAPI keys.
   The browser never sees those keys directly.
   ========================================================================== */

const GodfatherAPI = (() => {

  // Point this at your deployed backend once it's live.
  // Same-origin ("") works if the backend is deployed alongside the PWA
  // (e.g. Vercel/Netlify functions under /api).
  const BASE_URL = '';

  async function getCandles(symbol, timeframe, count = 100) {
    const res = await fetch(`${BASE_URL}/api/candles?symbol=${symbol}&interval=${timeframe}&count=${count}`);
    if (!res.ok) throw new Error(`Candle fetch failed: ${res.status}`);
    return res.json(); // expected: [{ t, o, h, l, c }, ...]
  }

  async function getQuote(symbol) {
    const res = await fetch(`${BASE_URL}/api/quote?symbol=${symbol}`);
    if (!res.ok) throw new Error(`Quote fetch failed: ${res.status}`);
    return res.json(); // expected: { price, time }
  }

  async function placeTrade({ symbol, direction, entry, sl, tp, lots }) {
    const res = await fetch(`${BASE_URL}/api/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, direction, entry, sl, tp, lots }),
    });
    if (!res.ok) throw new Error(`Trade placement failed: ${res.status}`);
    return res.json();
  }

  async function getOpenPositions() {
    const res = await fetch(`${BASE_URL}/api/positions`);
    if (!res.ok) throw new Error(`Positions fetch failed: ${res.status}`);
    return res.json();
  }

  return { getCandles, getQuote, placeTrade, getOpenPositions };
})();

window.GodfatherAPI = GodfatherAPI;

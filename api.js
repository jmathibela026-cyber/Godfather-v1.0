/* ==========================================================================
   GODFATHER — API Layer
   Personal-use client: your own Gemini API key and MetaApi Cloud
   credentials (entered on the Settings page) are stored only in this
   browser's localStorage and used to call Google's and MetaApi's APIs
   directly. There is no backend server in this version — if you ever
   turn this into a multi-user product, move both keys server-side
   instead (see README).
   ========================================================================== */

const GodfatherAPI = (() => {

  const STORAGE_KEY = 'godfather_settings_v1';

  // ---- Settings (Gemini key, MetaApi token/account, lot size) ----
  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveSettings(partial) {
    const current = getSettings();
    const next = { ...current, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  // ---- Screenshot -> signal, via Gemini vision ----
  // imageBase64: raw base64 (no "data:image/..;base64," prefix)
  async function analyzeScreenshot({ imageBase64, mimeType, symbol, strategy, timeframe }) {
    const { geminiKey } = getSettings();
    if (!geminiKey) throw new Error('No Gemini API key set. Add one in Settings.');

    const prompt = `You are an ICT / Smart Money Concepts trading analyst. Look at this ` +
      `${symbol} ${timeframe} chart screenshot and analyze it using: liquidity sweeps, ` +
      `change of character (CHoCH) / break of structure (BOS), order blocks, fair value gaps ` +
      `(FVGs), liquidity pools (BSL/SSL), and premium/discount (OTE 61.8%-78.6% retracement) bias. ` +
      `Read the actual candles and price levels visible in the image.\n\n` +
      `Respond with ONLY raw JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"verdict":"buy"|"sell"|"wait","entry":number|null,"sl":number|null,"tp":number|null,` +
      `"confidence":number|null,"reasoning":string}\n` +
      `Use "wait" with entry/sl/tp/confidence set to null if there is no valid setup yet, and ` +
      `explain why in "reasoning". Prices must be plain numbers matching the price scale shown ` +
      `on the chart's axis.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.2 },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Gemini request failed: ${res.status} ${errBody}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const cleaned = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Could not parse a signal from the AI response.');
    }

    return {
      verdict: parsed.verdict,
      entry: parsed.entry,
      sl: parsed.sl,
      tp: parsed.tp,
      confidence: parsed.confidence,
      strategy: strategy || 'ICT / Smart Money',
      reasoning: parsed.reasoning || '',
    };
  }

  // ---- Trade execution via MetaApi Cloud (MT4/MT5) ----
  async function placeTrade({ symbol, direction, entry, sl, tp, lots }) {
    const { metaToken, metaAccountId } = getSettings();
    if (!metaToken || !metaAccountId) {
      throw new Error('No MetaApi Cloud credentials set. Add them in Settings.');
    }

    const actionType = direction === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL';
    const res = await fetch(
      `https://mt-client-api-v1.new-york.agiliumtrade.ai/users/current/accounts/${metaAccountId}/trade`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'auth-token': metaToken,
        },
        body: JSON.stringify({
          actionType,
          symbol,
          volume: lots,
          stopLoss: sl,
          takeProfit: tp,
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Trade placement failed: ${res.status} ${errBody}`);
    }
    return res.json();
  }

  async function getOpenPositions() {
    const { metaToken, metaAccountId } = getSettings();
    if (!metaToken || !metaAccountId) {
      throw new Error('No MetaApi Cloud credentials set. Add them in Settings.');
    }
    const res = await fetch(
      `https://mt-client-api-v1.new-york.agiliumtrade.ai/users/current/accounts/${metaAccountId}/positions`,
      { headers: { 'auth-token': metaToken } }
    );
    if (!res.ok) throw new Error(`Positions fetch failed: ${res.status}`);
    return res.json();
  }

  return { getSettings, saveSettings, analyzeScreenshot, placeTrade, getOpenPositions };
})();

window.GodfatherAPI = GodfatherAPI;

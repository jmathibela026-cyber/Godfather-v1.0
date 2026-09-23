/* ==========================================================================
   GODFATHER — Signal Engine
   Implements the ICT "Liquidity Sweep" strategy as deterministic rules:

     1. HTF: detect a single-candle liquidity sweep beyond the last swing
        high/low, validated by the following candle not exceeding it.
     2. LTF: wait for a CHoCH (break of the nearest minor structure point
        in the sweep's reversal direction).
     3. Mark the Order Block (last opposite candle before the displacement)
        and the Fair Value Gap (3-candle imbalance) from the displacement leg.
     4. Entry = OTE (61.8%-78.6% Fibonacci retracement) of the displacement
        leg. OB/FVG overlap with the OTE zone raises confidence but never
        overrides the OTE price.
     5. SL = beyond the Order Block + spread buffer.
     6. TP = next opposite-side swing point / liquidity level.
     7. Confidence = weighted confluence score.

   Candle format: { t: timestamp, o, h, l, c }
   ========================================================================== */

const GodfatherEngine = (() => {

  const SPREAD_BUFFER_PCT = 0.0006; // ~0.06% buffer added beyond the OB for SL

  // ---- Swing point detection (simple fractal: 2 bars either side) ----
  function findSwings(candles, lookback = 2) {
    const swingHighs = [];
    const swingLows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const window = candles.slice(i - lookback, i + lookback + 1);
      const c = candles[i];
      if (c.h === Math.max(...window.map(w => w.h))) swingHighs.push({ i, price: c.h });
      if (c.l === Math.min(...window.map(w => w.l))) swingLows.push({ i, price: c.l });
    }
    return { swingHighs, swingLows };
  }

  // ---- Step 1: HTF single-candle liquidity sweep ----
  function detectSweep(htfCandles) {
    const { swingHighs, swingLows } = findSwings(htfCandles);
    if (!swingLows.length || !swingHighs.length) return null;

    const lastLow = swingLows[swingLows.length - 1];
    const lastHigh = swingHighs[swingHighs.length - 1];
    const last = htfCandles.length - 1;
    const sweepCandle = htfCandles[last - 1];
    const confirmCandle = htfCandles[last];
    if (!sweepCandle || !confirmCandle) return null;

    // Bullish sweep: wicks below last swing low, then next candle holds above it
    if (sweepCandle.l < lastLow.price && confirmCandle.l >= sweepCandle.l) {
      return {
        direction: 'buy',
        sweptLevel: lastLow.price,
        sweepCandle,
        confirmCandle,
        valid: confirmCandle.c > sweepCandle.o, // confirm candle didn't close back below
      };
    }
    // Bearish sweep: wicks above last swing high, then next candle holds below it
    if (sweepCandle.h > lastHigh.price && confirmCandle.h <= sweepCandle.h) {
      return {
        direction: 'sell',
        sweptLevel: lastHigh.price,
        sweepCandle,
        confirmCandle,
        valid: confirmCandle.c < sweepCandle.o,
      };
    }
    return null;
  }

  // ---- Step 2: LTF Change of Character ----
  function detectCHoCH(ltfCandles, direction) {
    const { swingHighs, swingLows } = findSwings(ltfCandles, 1);
    const last = ltfCandles[ltfCandles.length - 1];

    if (direction === 'buy' && swingHighs.length) {
      const refHigh = swingHighs[swingHighs.length - 1];
      if (last.c > refHigh.price) return { confirmed: true, breakIndex: ltfCandles.length - 1, refLevel: refHigh };
    }
    if (direction === 'sell' && swingLows.length) {
      const refLow = swingLows[swingLows.length - 1];
      if (last.c < refLow.price) return { confirmed: true, breakIndex: ltfCandles.length - 1, refLevel: refLow };
    }
    return { confirmed: false };
  }

  // ---- Step 3: Order Block + Fair Value Gap from the displacement leg ----
  function findOrderBlockAndFVG(ltfCandles, choch, direction) {
    const idx = choch.breakIndex;
    const legStart = Math.max(0, idx - 6);
    const leg = ltfCandles.slice(legStart, idx + 1);

    // Order block: last opposite-colored candle before the displacement run
    let ob = null;
    for (let i = leg.length - 2; i >= 0; i--) {
      const isBull = leg[i].c > leg[i].o;
      if (direction === 'buy' && !isBull) { ob = leg[i]; break; }
      if (direction === 'sell' && isBull) { ob = leg[i]; break; }
    }
    if (!ob) ob = leg[0];

    // FVG: gap between candle i-1's wick and candle i+1's wick around the
    // largest displacement candle in the leg
    let fvg = null;
    for (let i = 1; i < leg.length - 1; i++) {
      const a = leg[i - 1], b = leg[i + 1];
      if (direction === 'buy' && a.h < b.l) fvg = { top: b.l, bottom: a.h };
      if (direction === 'sell' && a.l > b.h) fvg = { top: a.l, bottom: b.h };
    }

    const legHigh = Math.max(...leg.map(c => c.h));
    const legLow = Math.min(...leg.map(c => c.l));

    return { ob, fvg, legHigh, legLow };
  }

  // ---- Step 4: OTE entry from the displacement leg ----
  function calcOTE(legHigh, legLow, direction) {
    const range = legHigh - legLow;
    if (direction === 'buy') {
      return { low: legHigh - range * 0.786, high: legHigh - range * 0.618 };
    }
    return { low: legLow + range * 0.618, high: legLow + range * 0.786 };
  }

  // ---- Step 6: TP from next opposite-side swing / liquidity point ----
  function findTarget(candles, direction, fromPrice) {
    const { swingHighs, swingLows } = findSwings(candles);
    if (direction === 'buy') {
      const targets = swingHighs.map(s => s.price).filter(p => p > fromPrice);
      return targets.length ? Math.min(...targets) : fromPrice * 1.01;
    } else {
      const targets = swingLows.map(s => s.price).filter(p => p < fromPrice);
      return targets.length ? Math.max(...targets) : fromPrice * 0.99;
    }
  }

  // ---- Full pipeline ----
  function analyze(htfCandles, ltfCandles) {
    const sweep = detectSweep(htfCandles);
    if (!sweep || !sweep.valid) {
      return { verdict: 'wait', reason: 'No valid liquidity sweep detected on the higher timeframe yet.' };
    }

    const choch = detectCHoCH(ltfCandles, sweep.direction);
    if (!choch.confirmed) {
      return { verdict: 'wait', reason: `Liquidity sweep found (${sweep.direction.toUpperCase()}), waiting for CHoCH confirmation on the lower timeframe.` };
    }

    const { ob, fvg, legHigh, legLow } = findOrderBlockAndFVG(ltfCandles, choch, sweep.direction);
    const ote = calcOTE(legHigh, legLow, sweep.direction);
    const entry = (ote.low + ote.high) / 2;

    const obMid = ob ? (ob.h + ob.l) / 2 : entry;
    const fvgMid = fvg ? (fvg.top + fvg.bottom) / 2 : entry;

    const buffer = entry * SPREAD_BUFFER_PCT;
    const sl = sweep.direction === 'buy'
      ? Math.min(ob.l, sweep.sweepCandle.l) - buffer
      : Math.max(ob.h, sweep.sweepCandle.h) + buffer;

    const tp = findTarget(htfCandles, sweep.direction, entry);

    // Confidence: confluence-weighted score
    let confidence = 50;
    confidence += sweep.valid ? 12 : 0;
    confidence += choch.confirmed ? 12 : 0;
    const obFvgAligned = fvg && Math.abs(obMid - fvgMid) / entry < 0.01;
    confidence += obFvgAligned ? 10 : 4;
    const oteAligned = obMid >= ote.low && obMid <= ote.high;
    confidence += oteAligned ? 10 : 0;
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl || 1);
    confidence += Math.min(rr * 3, 10);
    confidence = Math.max(40, Math.min(95, Math.round(confidence)));

    const reasoning = buildReasoning(sweep, choch, ote, sl, tp, entry);

    return {
      verdict: sweep.direction, // 'buy' | 'sell'
      entry, sl, tp,
      confidence,
      strategy: 'ICT / Smart Money',
      reasoning,
      zones: { ob, fvg, ote },
    };
  }

  function buildReasoning(sweep, choch, ote, sl, tp, entry) {
    const dir = sweep.direction === 'buy' ? 'bullish' : 'bearish';
    const action = sweep.direction === 'buy' ? 'BUY' : 'SELL';
    return `The higher timeframe swept liquidity beyond the prior swing ` +
      `${sweep.direction === 'buy' ? 'low' : 'high'} at ${sweep.sweptLevel.toFixed(2)}, then held — a valid ` +
      `${dir} liquidity sweep. The lower timeframe confirmed with a change of character, ` +
      `shifting structure ${dir}. We're looking for a ${action} entry inside the ` +
      `${(ote.low).toFixed(2)}–${(ote.high).toFixed(2)} OTE zone (61.8%-78.6% retracement). ` +
      `Stop loss sits beyond the order block at ${sl.toFixed(2)}, and take profit targets the ` +
      `next visible liquidity level at ${tp.toFixed(2)}.`;
  }

  return { analyze, findSwings, detectSweep, detectCHoCH };
})();

window.GodfatherEngine = GodfatherEngine;

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
  // Scans back over the recent candles (not just the very last one) so a
  // sweep that happened a few bars ago is still picked up.
  function detectSweep(htfCandles, lookbackBars = 20) {
    const { swingHighs, swingLows } = findSwings(htfCandles);
    if (!swingLows.length || !swingHighs.length) return null;

    const start = htfCandles.length - 2;
    const end = Math.max(1, start - lookbackBars);

    for (let i = start; i >= end; i--) {
      const sweepCandle = htfCandles[i];
      const confirmCandle = htfCandles[i + 1];
      if (!sweepCandle || !confirmCandle) continue;

      const priorLows = swingLows.filter(s => s.i < i);
      const priorHighs = swingHighs.filter(s => s.i < i);
      const lastLow = priorLows[priorLows.length - 1];
      const lastHigh = priorHighs[priorHighs.length - 1];

      // Bullish sweep: wicks below last swing low, then next candle holds above it
      if (lastLow && sweepCandle.l < lastLow.price && confirmCandle.l >= sweepCandle.l) {
        const valid = confirmCandle.c > sweepCandle.o;
        if (valid) {
          return { direction: 'buy', sweptLevel: lastLow.price, sweepCandle, confirmCandle, valid };
        }
      }
      // Bearish sweep: wicks above last swing high, then next candle holds below it
      if (lastHigh && sweepCandle.h > lastHigh.price && confirmCandle.h <= sweepCandle.h) {
        const valid = confirmCandle.c < sweepCandle.o;
        if (valid) {
          return { direction: 'sell', sweptLevel: lastHigh.price, sweepCandle, confirmCandle, valid };
        }
      }
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

/* ==========================================================================
   MARKET MAKER'S MATRIX — Second Signal Engine
   A second, independent rule set (selectable via the Strategy chips)
   implementing an "inducement / liquidity grab" trading model:

     1. HTF: a liquidity grab beyond a swing extreme (an induced low/high
        gets wicked through, then price holds beyond it) sets the
        directional bias.
     2. LTF: that grab must cause a Break of Structure (BOS) — a candle
        BODY closing beyond the nearest opposing structure point — in
        the reversal direction.
     3. The zone left behind (the last opposite-colored candle before
        the breakout leg) becomes the Point of Interest (POI) —
        price is expected to pull back ("mitigate") into it.
     4. That POI must sit in discount (below the midpoint of the
        current trading range) for a buy, or premium (above the
        midpoint) for a sell — otherwise we wait for price to reach a
        valid zone.
     5. Target is the next liquidity pool (opposing swing point/equal
        highs-lows) beyond entry; stop sits beyond the origin of the
        move that caused the BOS.

   Candle format: { t: timestamp, o, h, l, c }
   ========================================================================== */

const MarketMakerMatrixEngine = (() => {

  const BUFFER_PCT = 0.0006;

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

  // ---- Step 1: liquidity grab beyond a swing extreme on the HTF ----
  // Scans back over the recent candles (not just the very last one) so a
  // grab that happened a few bars ago is still picked up.
  function detectLiquidityGrab(htfCandles, lookbackBars = 20) {
    const { swingHighs, swingLows } = findSwings(htfCandles);
    if (!swingHighs.length || !swingLows.length) return null;

    const start = htfCandles.length - 2;
    const end = Math.max(1, start - lookbackBars);

    for (let i = start; i >= end; i--) {
      const grabCandle = htfCandles[i];
      const holdCandle = htfCandles[i + 1];
      if (!grabCandle || !holdCandle) continue;

      // Use the swing context as it stood at that point in time, not the
      // single most-recent swing in the whole series.
      const priorLows = swingLows.filter(s => s.i < i);
      const priorHighs = swingHighs.filter(s => s.i < i);
      const lastLow = priorLows[priorLows.length - 1];
      const lastHigh = priorHighs[priorHighs.length - 1];

      // Induced low wicked through, then price holds above it -> bullish bias
      if (lastLow && grabCandle.l < lastLow.price && holdCandle.l >= grabCandle.l && holdCandle.c > grabCandle.o) {
        return { direction: 'buy', originLevel: grabCandle.l, grabCandle, holdCandle };
      }
      // Induced high wicked through, then price holds below it -> bearish bias
      if (lastHigh && grabCandle.h > lastHigh.price && holdCandle.h <= grabCandle.h && holdCandle.c < grabCandle.o) {
        return { direction: 'sell', originLevel: grabCandle.h, grabCandle, holdCandle };
      }
    }
    return null;
  }

  // ---- Step 2: Break of Structure by candle BODY on the LTF ----
  function detectBOS(ltfCandles, direction) {
    const { swingHighs, swingLows } = findSwings(ltfCandles, 1);
    const last = ltfCandles[ltfCandles.length - 1];

    if (direction === 'buy' && swingHighs.length) {
      const refHigh = swingHighs[swingHighs.length - 1];
      if (last.c > refHigh.price) return { confirmed: true, breakIndex: ltfCandles.length - 1, refLevel: refHigh.price };
    }
    if (direction === 'sell' && swingLows.length) {
      const refLow = swingLows[swingLows.length - 1];
      if (last.c < refLow.price) return { confirmed: true, breakIndex: ltfCandles.length - 1, refLevel: refLow.price };
    }
    return { confirmed: false };
  }

  // ---- Step 3: POI — last opposite-colored candle before the breakout leg ----
  function findPOI(ltfCandles, breakIndex, direction) {
    const legStart = Math.max(0, breakIndex - 6);
    const leg = ltfCandles.slice(legStart, breakIndex + 1);
    let poi = null;
    for (let i = leg.length - 2; i >= 0; i--) {
      const isBull = leg[i].c > leg[i].o;
      if (direction === 'buy' && !isBull) { poi = leg[i]; break; }
      if (direction === 'sell' && isBull) { poi = leg[i]; break; }
    }
    if (!poi) poi = leg[0];
    return poi;
  }

  // ---- Step 4: premium/discount filter against the current range ----
  function inValidZone(poiMid, rangeHigh, rangeLow, direction) {
    const mid = (rangeHigh + rangeLow) / 2;
    return direction === 'buy' ? poiMid <= mid : poiMid >= mid;
  }

  // ---- Step 5: next liquidity pool as target ----
  function findLiquidityTarget(candles, direction, fromPrice) {
    const { swingHighs, swingLows } = findSwings(candles);
    if (direction === 'buy') {
      const targets = swingHighs.map(s => s.price).filter(p => p > fromPrice);
      return targets.length ? Math.min(...targets) : fromPrice * 1.01;
    } else {
      const targets = swingLows.map(s => s.price).filter(p => p < fromPrice);
      return targets.length ? Math.max(...targets) : fromPrice * 0.99;
    }
  }

  function analyze(htfCandles, ltfCandles) {
    const grab = detectLiquidityGrab(htfCandles);
    if (!grab) {
      return { verdict: 'wait', reason: 'No liquidity grab beyond a higher-timeframe swing point yet.' };
    }

    const bos = detectBOS(ltfCandles, grab.direction);
    if (!bos.confirmed) {
      return { verdict: 'wait', reason: `Liquidity grab found (${grab.direction.toUpperCase()}), waiting for a break of structure on the lower timeframe.` };
    }

    const poi = findPOI(ltfCandles, bos.breakIndex, grab.direction);
    const poiMid = (poi.h + poi.l) / 2;

    const { swingHighs, swingLows } = findSwings(ltfCandles);
    const rangeHigh = swingHighs.length ? Math.max(...swingHighs.map(s => s.price)) : poi.h;
    const rangeLow = swingLows.length ? Math.min(...swingLows.map(s => s.price)) : poi.l;

    if (!inValidZone(poiMid, rangeHigh, rangeLow, grab.direction)) {
      return { verdict: 'wait', reason: `POI formed but sits on the wrong side of the range (needs discount for buys, premium for sells) — waiting for price to reach a valid mitigation zone.` };
    }

    const entry = poiMid;
    const buffer = entry * BUFFER_PCT;
    const sl = grab.direction === 'buy'
      ? Math.min(poi.l, grab.originLevel) - buffer
      : Math.max(poi.h, grab.originLevel) + buffer;
    const tp = findLiquidityTarget(htfCandles, grab.direction, entry);

    let confidence = 50;
    confidence += 12; // valid liquidity grab
    confidence += 12; // confirmed BOS
    confidence += 10; // POI in valid premium/discount zone
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl || 1);
    confidence += Math.min(rr * 3, 16);
    confidence = Math.max(40, Math.min(95, Math.round(confidence)));

    const dir = grab.direction === 'buy' ? 'bullish' : 'bearish';
    const action = grab.direction === 'buy' ? 'BUY' : 'SELL';
    const reasoning = `A liquidity grab beyond the prior higher-timeframe ` +
      `${grab.direction === 'buy' ? 'low' : 'high'} at ${grab.originLevel.toFixed(2)} induced the ` +
      `opposite side before holding — a ${dir} setup. The lower timeframe broke structure in that ` +
      `direction, leaving a point of interest at ${entry.toFixed(2)} for price to mitigate back into. ` +
      `That zone sits in ${grab.direction === 'buy' ? 'discount' : 'premium'} of the current range, so ` +
      `we're looking for a ${action} there, stop beyond the origin of the move at ${sl.toFixed(2)}, ` +
      `targeting the next liquidity pool at ${tp.toFixed(2)}.`;

    return {
      verdict: grab.direction,
      entry, sl, tp,
      confidence,
      strategy: "Market Maker's Matrix",
      reasoning,
    };
  }

  return { analyze, findSwings, detectLiquidityGrab, detectBOS };
})();

window.MarketMakerMatrixEngine = MarketMakerMatrixEngine;


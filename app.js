/* ==========================================================================
   GODFATHER — App Controller
   ========================================================================== */

(() => {
  const state = {
    symbol: 'XAUUSD',
    timeframe: 'M15',
    htfTimeframe: 'H4',
  };

  const scanCanvas = document.getElementById('chartCanvas');
  const resultCanvas = document.getElementById('resultCanvas');
  const liveChart = new CandleChart(scanCanvas);
  const resultChart = new CandleChart(resultCanvas);

  // ---- Chip selection ----
  function wireChipGroup(groupId, onSelect) {
    const group = document.getElementById(groupId);
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip || chip.disabled) return;
      [...group.children].forEach(c => c.classList.remove('is-selected'));
      chip.classList.add('is-selected');
      onSelect(chip.dataset.value);
    });
  }

  wireChipGroup('symbolChips', (v) => { state.symbol = v; loadChart(); });
  wireChipGroup('tfChips', (v) => { state.timeframe = v; loadChart(); });

  // ---- Mock candle generator (used until the backend is deployed) ----
  // Swap GodfatherAPI.getCandles() in once /api/candles is live —
  // loadChart() below already tries the real API first.
  function generateMockCandles(count = 60, seed = 1) {
    let price = 2400 + seed * 37;
    const candles = [];
    let t = Date.now() - count * 15 * 60 * 1000;
    for (let i = 0; i < count; i++) {
      const vol = price * 0.0015;
      const o = price;
      const drift = (Math.sin(i / 6) * 1.5) + (Math.random() - 0.5) * 2;
      const c = o + drift * vol;
      const h = Math.max(o, c) + Math.random() * vol;
      const l = Math.min(o, c) - Math.random() * vol;
      candles.push({ t, o, h, l, c });
      price = c;
      t += 15 * 60 * 1000;
    }
    return candles;
  }

  let currentCandles = [];

  async function loadChart() {
    try {
      currentCandles = await GodfatherAPI.getCandles(state.symbol, state.timeframe, 60);
    } catch (e) {
      currentCandles = generateMockCandles(60, state.symbol.length);
    }
    liveChart.setCandles(currentCandles);
    const last = currentCandles[currentCandles.length - 1];
    document.getElementById('livePrice').textContent = last.c.toFixed(2);
  }

  // ---- Scan animation ----
  const checklistItems = [...document.querySelectorAll('.checklist__item')];
  const progressFill = document.getElementById('progressFill');
  let scanTimer = null;

  function runScanAnimation(onDone) {
    checklistItems.forEach(el => el.classList.remove('is-done', 'is-active'));
    let step = 0;
    clearInterval(scanTimer);
    scanTimer = setInterval(() => {
      if (step > 0) checklistItems[step - 1]?.classList.replace('is-active', 'is-done');
      if (step < checklistItems.length) {
        checklistItems[step].classList.add('is-active');
        progressFill.style.width = `${((step + 1) / checklistItems.length) * 100}%`;
        step++;
      } else {
        clearInterval(scanTimer);
        onDone();
      }
    }, 420);
  }

  // ---- Scan button ----
  document.getElementById('scanBtn').addEventListener('click', () => {
    document.getElementById('scanBtn').disabled = true;
    runScanAnimation(async () => {
      let htfCandles, ltfCandles;
      try {
        htfCandles = await GodfatherAPI.getCandles(state.symbol, state.htfTimeframe, 60);
        ltfCandles = await GodfatherAPI.getCandles(state.symbol, state.timeframe, 60);
      } catch (e) {
        htfCandles = generateMockCandles(60, state.symbol.length + 1);
        ltfCandles = currentCandles.length ? currentCandles : generateMockCandles(60, state.symbol.length);
      }
      const signal = GodfatherEngine.analyze(htfCandles, ltfCandles);
      showResult(signal, ltfCandles);
      document.getElementById('scanBtn').disabled = false;
    });
  });

  // ---- Render result screen ----
  function showResult(signal, candles) {
    document.getElementById('scanDock').classList.add('hidden');
    document.getElementById('resultDock').classList.remove('hidden');
    document.getElementById('resultView').classList.remove('hidden');
    document.querySelectorAll('.chart-card, .progress-track, .checklist, .section-label, .chip-row')
      .forEach(el => { if (!el.closest('#resultView')) el.classList.add('hidden'); });

    if (signal.verdict === 'wait') {
      document.getElementById('toastTitle').textContent = 'No trade yet';
      document.getElementById('toastBody').textContent = signal.reason;
      document.getElementById('reasoningBox').innerHTML = `<strong>WAIT</strong> — ${signal.reason}`;
      document.querySelector('.signal-card').classList.add('hidden');
      resultChart.setCandles(candles);
      resultChart.setOverlay(null);
      return;
    }
    document.querySelector('.signal-card').classList.remove('hidden');

    const isBuy = signal.verdict === 'buy';
    document.getElementById('toastTitle').textContent = 'New signal detected';
    document.getElementById('toastBody').textContent =
      `${signal.verdict.toUpperCase()} ${state.symbol} • ${state.timeframe} • ${signal.confidence}% confidence`;

    document.getElementById('reasoningBox').innerHTML =
      `<strong>${signal.strategy.toUpperCase()}</strong> ${signal.reasoning}`;

    const symbolEl = document.getElementById('cardSymbol');
    symbolEl.className = `signal-card__symbol ${isBuy ? 'is-buy' : 'is-sell'}`;
    symbolEl.innerHTML = `<span class="arrow">${isBuy ? '&#8593;' : '&#8595;'}</span> ${state.symbol}`;

    const badge = document.getElementById('cardBadge');
    badge.textContent = isBuy ? 'BUY' : 'SELL';
    badge.className = `direction-badge ${isBuy ? 'buy' : 'sell'}`;

    document.getElementById('cardEntry').textContent = signal.entry.toFixed(2);
    document.getElementById('cardSL').textContent = signal.sl.toFixed(2);
    document.getElementById('cardTP').textContent = signal.tp.toFixed(2);
    document.getElementById('cardStrategy').textContent = signal.strategy;
    document.getElementById('cardTimeframe').textContent = state.timeframe;
    document.getElementById('cardConfidence').textContent = `${signal.confidence}%`;

    resultChart.setCandles(candles);
    resultChart.setOverlay({ entry: signal.entry, sl: signal.sl, tp: signal.tp, direction: signal.verdict });

    window._lastSignal = signal;
  }

  // ---- Confirm trade ----
  document.getElementById('confirmTradeBtn').addEventListener('click', async () => {
    const signal = window._lastSignal;
    if (!signal) return;
    const btn = document.getElementById('confirmTradeBtn');
    btn.textContent = 'Sending...';
    btn.disabled = true;
    try {
      await GodfatherAPI.placeTrade({
        symbol: state.symbol,
        direction: signal.verdict,
        entry: signal.entry,
        sl: signal.sl,
        tp: signal.tp,
        lots: 0.01,
      });
      btn.textContent = 'Trade Sent ✓';
    } catch (e) {
      btn.textContent = 'Failed — backend not connected';
      setTimeout(() => { btn.textContent = 'Confirm & Send Trade'; btn.disabled = false; }, 2200);
      return;
    }
    setTimeout(() => { btn.textContent = 'Confirm & Send Trade'; btn.disabled = false; }, 2200);
  });

  // ---- Scan another chart ----
  document.getElementById('scanAgainBtn').addEventListener('click', () => {
    document.getElementById('resultView').classList.add('hidden');
    document.getElementById('resultDock').classList.add('hidden');
    document.getElementById('scanDock').classList.remove('hidden');
    document.querySelectorAll('.chart-card, .progress-track, .checklist, .section-label, .chip-row')
      .forEach(el => { if (!el.closest('#resultView')) el.classList.remove('hidden'); });
    progressFill.style.width = '0%';
    checklistItems.forEach(el => el.classList.remove('is-done', 'is-active'));
  });

  // ---- Tab bar ----
  const scannerScreen = document.getElementById('scannerScreen');
  const placeholderView = document.getElementById('placeholderView');
  const placeholderIcon = document.getElementById('placeholderIcon');
  const placeholderTitle = document.getElementById('placeholderTitle');
  const placeholderBody = document.getElementById('placeholderBody');
  const scanDock = document.getElementById('scanDock');
  const resultDock = document.getElementById('resultDock');
  const resultView = document.getElementById('resultView');

  const placeholderCopy = {
    smart: { icon: '&#9889;', title: 'Smart AI', body: 'Chat with the Godfather AI persona about your signals. Coming soon.' },
    metatrader: { icon: '&#128200;', title: 'MetaTrader', body: 'Live positions and account balance via MetaAPI. Coming soon.' },
    settings: { icon: '&#9881;', title: 'Settings', body: 'API connection status and strategy parameters. Coming soon.' },
  };

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const page = tab.dataset.page;

    [...document.querySelectorAll('.tab')].forEach(t => t.classList.toggle('is-active', t === tab));

    if (page === 'home' || page === 'scanner') {
      placeholderView.classList.add('hidden');
      scannerScreen.classList.remove('hidden');
      // Restore whichever action dock matches the current sub-view (scan setup vs. result)
      if (resultView.classList.contains('hidden')) {
        scanDock.classList.remove('hidden');
        resultDock.classList.add('hidden');
      } else {
        scanDock.classList.add('hidden');
        resultDock.classList.remove('hidden');
      }
      return;
    }

    // Not-yet-built screens: show a responsive placeholder instead of nothing
    scannerScreen.classList.add('hidden');
    scanDock.classList.add('hidden');
    resultDock.classList.add('hidden');
    const copy = placeholderCopy[page];
    placeholderIcon.innerHTML = copy.icon;
    placeholderTitle.textContent = copy.title;
    placeholderBody.textContent = copy.body;
    placeholderView.classList.remove('hidden');
  });

  // ---- Init ----
  loadChart();

  // ---- Register service worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();

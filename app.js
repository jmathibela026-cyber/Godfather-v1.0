/* ==========================================================================
   GODFATHER — App Controller
   ========================================================================== */

(() => {
  const state = {
    symbol: 'XAUUSD',
    timeframe: 'M15',
    htfTimeframe: 'H4',
    tradeCount: 3,
    strategy: 'rsi',
  };

  const scanCanvas = document.getElementById('chartCanvas');
  const resultCanvas = document.getElementById('resultCanvas');
  const liveChart = new CandleChart(scanCanvas);
  const resultChart = new CandleChart(resultCanvas);
  const chartStatus = document.getElementById('chartStatus');

  // ---- Page nav (Home / Settings) ----
  const pages = {
    home: document.getElementById('page-home'),
    settings: document.getElementById('page-settings'),
  };
  const topbarTitle = document.getElementById('topbarTitle');
  const tabs = [...document.querySelectorAll('.tab')];

  function goToPage(name) {
    Object.entries(pages).forEach(([key, el]) => el.classList.toggle('hidden', key !== name));
    tabs.forEach(t => t.classList.toggle('is-active', t.dataset.page === name));
    topbarTitle.textContent = name === 'settings' ? 'SETTINGS' : 'CHART SCANNER';
    // Docks only ever show on the home page.
    if (name !== 'home') {
      document.getElementById('scanDock').classList.add('hidden');
      document.getElementById('resultDock').classList.add('hidden');
      stopPolling();
    } else if (document.getElementById('resultView').classList.contains('hidden')) {
      document.getElementById('scanDock').classList.remove('hidden');
      startPolling();
    } else {
      document.getElementById('resultDock').classList.remove('hidden');
    }
  }

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) goToPage(tab.dataset.page);
  });

  // ---- Chip selection ----
  function wireChipGroup(groupId, onSelect) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip || chip.disabled) return;
      [...group.children].forEach(c => c.classList.remove('is-selected'));
      chip.classList.add('is-selected');
      onSelect(chip.dataset.value);
    });
  }

  // Symbol can be picked from either chip row, but only one is ever selected
  // across both — clear the other row when one is picked.
  const indexChips = document.getElementById('symbolChips');
  const forexChips = document.getElementById('symbolChipsForex');
  wireChipGroup('symbolChips', (v) => {
    [...forexChips.children].forEach(c => c.classList.remove('is-selected'));
    state.symbol = v;
    loadChart();
  });
  wireChipGroup('symbolChipsForex', (v) => {
    [...indexChips.children].forEach(c => c.classList.remove('is-selected'));
    state.symbol = v;
    loadChart();
  });
  wireChipGroup('tfChips', (v) => { state.timeframe = v; loadChart(); });
  wireChipGroup('strategyChips', (v) => { state.strategy = v; });
  wireChipGroup('tradeCountRow', (v) => {
    state.tradeCount = parseInt(v, 10);
    document.getElementById('confirmTradeBtn').textContent = `Confirm & Execute ${v} Trade${v === '1' ? '' : 's'}`;
  });

  // ---- Live chart (polls MetaApi Cloud) ----
  let currentCandles = [];
  let pollTimer = null;

  async function loadChart() {
    try {
      chartStatus.textContent = 'Loading live candles…';
      currentCandles = await GodfatherAPI.getCandles(state.symbol, state.timeframe, 150);
      liveChart.setCandles(currentCandles);
      const last = currentCandles[currentCandles.length - 1];
      document.getElementById('livePrice').textContent = last ? last.c.toFixed(2) : '—';
      chartStatus.textContent = '';
    } catch (e) {
      chartStatus.textContent = e.message;
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(loadChart, 45000); // refresh every 45s — stay under Twelve Data's free-tier 8/min limit
  }

  function stopPolling() {
    clearInterval(pollTimer);
  }

  // ---- Scan animation ----
  const checklistItems = [...document.querySelectorAll('.checklist__item')];
  const progressFill = document.getElementById('progressFill');
  let scanTimer = null;

  function runScanAnimation(onDone) {
    document.getElementById('progressTrack').classList.remove('hidden');
    document.getElementById('checklist').classList.remove('hidden');
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
    const btn = document.getElementById('scanBtn');
    btn.disabled = true;
    stopPolling(); // no live-chart requests while scanning / viewing a result
    runScanAnimation(async () => {
      try {
        // Reuse the LTF candles the live chart already has (at most 45s
        // stale) instead of spending a second Twelve Data request on it.
        const htfCandles = await GodfatherAPI.getCandles(state.symbol, state.htfTimeframe, 150);
        const ltfCandles = currentCandles.length ? currentCandles : await GodfatherAPI.getCandles(state.symbol, state.timeframe, 150);
        const ENGINES = { rsi: RSIEngine, ma: MovingAveragesEngine, stoch: StochasticEngine };
        const engine = ENGINES[state.strategy] || RSIEngine;
        const signal = engine.analyze(htfCandles, ltfCandles);
        showResult(signal, ltfCandles);
      } catch (e) {
        showError(e.message);
      }
      btn.disabled = false;
    });
  });

  function showError(message) {
    document.getElementById('checklist').classList.add('hidden');
    document.getElementById('progressTrack').classList.add('hidden');
    document.getElementById('resultView').classList.remove('hidden');
    document.getElementById('chipSection').classList.add('hidden');
    document.getElementById('toastTitle').textContent = 'Could not complete scan';
    document.getElementById('toastBody').textContent = message;
    document.getElementById('reasoningBox').innerHTML = `<strong>ERROR</strong> ${message}`;
    document.querySelector('.signal-card').classList.add('hidden');
    document.getElementById('tradeCountRow').classList.add('hidden');
    document.getElementById('scanDock').classList.add('hidden');
    document.getElementById('resultDock').classList.remove('hidden');
    document.getElementById('confirmTradeBtn').classList.add('hidden');
  }

  // ---- Render result screen ----
  function showResult(signal, candles) {
    document.getElementById('scanDock').classList.add('hidden');
    document.getElementById('resultDock').classList.remove('hidden');
    document.getElementById('resultView').classList.remove('hidden');
    document.getElementById('confirmTradeBtn').classList.remove('hidden');
    document.getElementById('checklist').classList.add('hidden');
    document.getElementById('progressTrack').classList.add('hidden');
    document.getElementById('chipSection').classList.add('hidden');
    document.getElementById('liveCard').classList.add('hidden');

    if (signal.verdict === 'wait') {
      document.getElementById('toastTitle').textContent = 'No trade yet';
      document.getElementById('toastBody').textContent = signal.reason;
      document.getElementById('reasoningBox').innerHTML = `<strong>WAIT</strong> — ${signal.reason}`;
      document.querySelector('.signal-card').classList.add('hidden');
      document.getElementById('tradeCountRow').classList.add('hidden');
      document.getElementById('confirmTradeBtn').classList.add('hidden');
      resultChart.setCandles(candles);
      resultChart.setOverlay(null);
      return;
    }
    document.querySelector('.signal-card').classList.remove('hidden');
    document.getElementById('tradeCountRow').classList.remove('hidden');

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

  // ---- Confirm & execute N trades ----
  document.getElementById('confirmTradeBtn').addEventListener('click', async () => {
    const signal = window._lastSignal;
    if (!signal) return;
    const { metaLot } = GodfatherAPI.getSettings();
    const lots = metaLot ? parseFloat(metaLot) : 0.01;
    const btn = document.getElementById('confirmTradeBtn');
    const original = btn.textContent;
    btn.disabled = true;

    let sent = 0;
    try {
      for (let i = 0; i < state.tradeCount; i++) {
        btn.textContent = `Sending trade ${i + 1}/${state.tradeCount}...`;
        await GodfatherAPI.placeTrade({
          symbol: state.symbol,
          direction: signal.verdict,
          entry: signal.entry,
          sl: signal.sl,
          tp: signal.tp,
          lots,
        });
        sent++;
      }
      btn.textContent = `${sent} Trade${sent === 1 ? '' : 's'} Sent ✓`;
    } catch (e) {
      btn.textContent = `Sent ${sent}/${state.tradeCount} — failed: ${e.message}`;
    }
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 3000);
  });

  // ---- Scan another chart ----
  document.getElementById('scanAgainBtn').addEventListener('click', () => {
    document.getElementById('resultView').classList.add('hidden');
    document.getElementById('resultDock').classList.add('hidden');
    document.getElementById('chipSection').classList.remove('hidden');
    document.getElementById('confirmTradeBtn').classList.remove('hidden');
    document.getElementById('liveCard').classList.remove('hidden');
    document.getElementById('scanDock').classList.remove('hidden');
    progressFill.style.width = '0%';
    checklistItems.forEach(el => el.classList.remove('is-done', 'is-active'));
    loadChart();
    startPolling();
  });

  // ---- Settings page ----
  function loadSettingsForm() {
    const s = GodfatherAPI.getSettings();
    document.getElementById('twelveDataKeyInput').value = s.twelveDataKey || '';
    document.getElementById('metaTokenInput').value = s.metaToken || '';
    document.getElementById('metaAccountInput').value = s.metaAccountId || '';
    document.getElementById('metaLotInput').value = s.metaLot || '0.01';
  }

  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    GodfatherAPI.saveSettings({
      twelveDataKey: document.getElementById('twelveDataKeyInput').value.trim(),
      metaToken: document.getElementById('metaTokenInput').value.trim(),
      metaAccountId: document.getElementById('metaAccountInput').value.trim(),
      metaLot: document.getElementById('metaLotInput').value.trim(),
    });
    const status = document.getElementById('settingsStatus');
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2000);
    loadChart(); // credentials may have just been added/fixed
  });

  // ---- Init ----
  loadSettingsForm();
  loadChart();
  startPolling();

  // ---- Register service worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();

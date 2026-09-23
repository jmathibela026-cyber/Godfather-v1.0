/* ==========================================================================
   GODFATHER — App Controller
   ========================================================================== */

(() => {
  const state = {
    symbol: 'XAUUSD',
    timeframe: 'M15',
    tradeCount: 3,
    screenshot: null, // { base64, mimeType }
  };

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
    } else if (document.getElementById('resultView').classList.contains('hidden')) {
      document.getElementById('scanDock').classList.remove('hidden');
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
  });
  wireChipGroup('symbolChipsForex', (v) => {
    [...indexChips.children].forEach(c => c.classList.remove('is-selected'));
    state.symbol = v;
  });
  wireChipGroup('tfChips', (v) => { state.timeframe = v; });
  wireChipGroup('tradeCountRow', (v) => {
    state.tradeCount = parseInt(v, 10);
    document.getElementById('confirmTradeBtn').textContent = `Confirm & Execute ${v} Trade${v === '1' ? '' : 's'}`;
  });

  // ---- Screenshot upload ----
  const screenshotInput = document.getElementById('screenshotInput');
  const uploadZone = document.getElementById('uploadZone');
  const previewCard = document.getElementById('previewCard');
  const screenshotPreview = document.getElementById('screenshotPreview');
  const scanBtn = document.getElementById('scanBtn');

  document.getElementById('pickScreenshotBtn').addEventListener('click', () => screenshotInput.click());

  screenshotInput.addEventListener('change', () => {
    const file = screenshotInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // "data:image/png;base64,AAAA..."
      const [, mimeType, base64] = dataUrl.match(/^data:(.+);base64,(.*)$/);
      state.screenshot = { base64, mimeType };
      screenshotPreview.src = dataUrl;
      uploadZone.classList.add('hidden');
      previewCard.classList.remove('hidden');
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan Chart';
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('clearScreenshotBtn').addEventListener('click', () => {
    state.screenshot = null;
    screenshotInput.value = '';
    previewCard.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Upload a screenshot first';
  });

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
  scanBtn.addEventListener('click', () => {
    if (!state.screenshot) return;
    scanBtn.disabled = true;
    runScanAnimation(async () => {
      try {
        const signal = await GodfatherAPI.analyzeScreenshot({
          imageBase64: state.screenshot.base64,
          mimeType: state.screenshot.mimeType,
          symbol: state.symbol,
          strategy: 'ICT / Smart Money',
          timeframe: state.timeframe,
        });
        showResult(signal);
      } catch (e) {
        showError(e.message);
      }
      scanBtn.disabled = false;
    });
  });

  function showError(message) {
    document.getElementById('checklist').classList.add('hidden');
    document.getElementById('progressTrack').classList.add('hidden');
    document.getElementById('resultView').classList.remove('hidden');
    document.getElementById('chipSection').classList.add('hidden');
    document.getElementById('toastTitle').textContent = 'Could not analyze screenshot';
    document.getElementById('toastBody').textContent = message;
    document.getElementById('reasoningBox').innerHTML = `<strong>ERROR</strong> ${message}`;
    document.querySelector('.signal-card').classList.add('hidden');
    document.getElementById('tradeCountRow').classList.add('hidden');
    document.getElementById('scanDock').classList.add('hidden');
    document.getElementById('resultDock').classList.remove('hidden');
    document.getElementById('confirmTradeBtn').classList.add('hidden');
  }

  // ---- Render result screen ----
  function showResult(signal) {
    document.getElementById('scanDock').classList.add('hidden');
    document.getElementById('resultDock').classList.remove('hidden');
    document.getElementById('resultView').classList.remove('hidden');
    document.getElementById('confirmTradeBtn').classList.remove('hidden');
    document.getElementById('checklist').classList.add('hidden');
    document.getElementById('progressTrack').classList.add('hidden');
    document.getElementById('chipSection').classList.add('hidden');
    previewCard.classList.add('hidden');

    if (signal.verdict === 'wait' || !signal.entry) {
      document.getElementById('toastTitle').textContent = 'No trade yet';
      document.getElementById('toastBody').textContent = signal.reasoning || 'No valid setup detected in this screenshot.';
      document.getElementById('reasoningBox').innerHTML = `<strong>WAIT</strong> — ${signal.reasoning || ''}`;
      document.querySelector('.signal-card').classList.add('hidden');
      document.getElementById('tradeCountRow').classList.add('hidden');
      document.getElementById('confirmTradeBtn').classList.add('hidden');
      return;
    }
    document.querySelector('.signal-card').classList.remove('hidden');
    document.getElementById('tradeCountRow').classList.remove('hidden');

    const isBuy = signal.verdict === 'buy';
    document.getElementById('toastTitle').textContent = 'New signal detected';
    document.getElementById('toastBody').textContent =
      `${signal.verdict.toUpperCase()} ${state.symbol} • ${state.timeframe} • ${signal.confidence ?? '—'}% confidence`;

    document.getElementById('reasoningBox').innerHTML =
      `<strong>${(signal.strategy || 'ICT / Smart Money').toUpperCase()}</strong> ${signal.reasoning || ''}`;

    const symbolEl = document.getElementById('cardSymbol');
    symbolEl.className = `signal-card__symbol ${isBuy ? 'is-buy' : 'is-sell'}`;
    symbolEl.innerHTML = `<span class="arrow">${isBuy ? '&#8593;' : '&#8595;'}</span> ${state.symbol}`;

    const badge = document.getElementById('cardBadge');
    badge.textContent = isBuy ? 'BUY' : 'SELL';
    badge.className = `direction-badge ${isBuy ? 'buy' : 'sell'}`;

    document.getElementById('cardEntry').textContent = Number(signal.entry).toFixed(2);
    document.getElementById('cardSL').textContent = Number(signal.sl).toFixed(2);
    document.getElementById('cardTP').textContent = Number(signal.tp).toFixed(2);
    document.getElementById('cardStrategy').textContent = signal.strategy || 'ICT / Smart Money';
    document.getElementById('cardTimeframe').textContent = state.timeframe;
    document.getElementById('cardConfidence').textContent = signal.confidence != null ? `${signal.confidence}%` : '—';

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
    state.screenshot = null;
    screenshotInput.value = '';
    previewCard.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Upload a screenshot first';
    document.getElementById('scanDock').classList.remove('hidden');
    progressFill.style.width = '0%';
    checklistItems.forEach(el => el.classList.remove('is-done', 'is-active'));
  });

  // ---- Settings page ----
  function loadSettingsForm() {
    const s = GodfatherAPI.getSettings();
    document.getElementById('geminiKeyInput').value = s.geminiKey || '';
    document.getElementById('metaTokenInput').value = s.metaToken || '';
    document.getElementById('metaAccountInput').value = s.metaAccountId || '';
    document.getElementById('metaLotInput').value = s.metaLot || '0.01';
  }

  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    GodfatherAPI.saveSettings({
      geminiKey: document.getElementById('geminiKeyInput').value.trim(),
      metaToken: document.getElementById('metaTokenInput').value.trim(),
      metaAccountId: document.getElementById('metaAccountInput').value.trim(),
      metaLot: document.getElementById('metaLotInput').value.trim(),
    });
    const status = document.getElementById('settingsStatus');
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2000);
  });

  // ---- Init ----
  loadSettingsForm();

  // ---- Register service worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();

const FAST_FINISH_CONFIRM_MS = 200;
const REWARD_SETTLE_MS = 300;
const CLAIM_MAX_MS = 6000;
const FAST_CLAIM_TICK_MS = 150;

function isFastClaimActive() {
  return !!(window.location.pathname.includes('/play_game')
    && window._rcFastClaim && window._rcFastClaim.active);
}

function isVisibleRewardButton(element) {
  if (!element) return false;
  var style = window.getComputedStyle(element);
  var rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden'
    && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
}

function getVisibleRewardButtons() {
  var buttons = [];
  var seen = new Set();
  function add(element) {
    if (seen.has(element) || !isVisibleRewardButton(element)) return;
    seen.add(element);
    buttons.push(element);
  }
  document.querySelectorAll('.complete-game-button-wrapper button').forEach(add);
  document.querySelectorAll('.collect-button button').forEach(add);
  document.querySelectorAll('.drops-modal .collect-buttons button').forEach(add);
  document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]').forEach(function(element) {
    var text = String(element.tagName === 'INPUT' ? element.value : (element.innerText || element.textContent) || '')
      .replace(/\s+/g, ' ').trim();
    if (/^(claim(?:\s+reward)?|collect\s+reward)$/i.test(text)) add(element);
  });
  return buttons;
}

function getRewardScreenText() {
  var pageText = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').toLowerCase();
  return {
    pageText: pageText,
    finalScreen: pageText.includes('go home') && pageText.includes('choose game')
  };
}

function getResultFromPageText(pageText) {
  if (/\byou\s+(?:win|won)\b|\byou\s+have\s+won\b/.test(pageText)) return 'win';
  if (/\byou\s+(?:lose|lost)\b|\byou\s+have\s+lost\b/.test(pageText)) return 'lose';
  return 'unknown';
}

function getGameFinishSignal() {
  var resultContainer = document.querySelector('div.play-game-result, .container-result-info');
  var hasResultContainer = isVisibleRewardButton(resultContainer);
  var rewardButtons = getVisibleRewardButtons();
  var botSignal = null;
  try {
    botSignal = JSON.parse(document.body.getAttribute('data-rc-game-finished') || 'null');
  } catch(e) {}
  if (hasResultContainer && window._rcResultVisibleAt === null) window._rcResultVisibleAt = Date.now();
  if (hasResultContainer || rewardButtons.length) {
    var resultText = getResultFromPageText(String(resultContainer && resultContainer.innerText || '')
      .replace(/\s+/g, ' ').toLowerCase());
    if (resultText === 'unknown') {
      resultText = getResultFromPageText((document.body && document.body.innerText || '').replace(/\s+/g, ' ').toLowerCase());
    }
    var resolvedResult = resultText !== 'unknown' ? resultText : botSignal && botSignal.result;
    if (resolvedResult === 'win' || resolvedResult === 'lose') window._rcFastGameResult = resolvedResult;
    return {
      rewardButtons: rewardButtons,
      resultContainer: hasResultContainer,
      finalScreen: false,
      result: resolvedResult
    };
  }
  var screen = getRewardScreenText();
  if (!screen.finalScreen) return null;
  var screenResult = getResultFromPageText(screen.pageText);
  var resolvedScreenResult = screenResult !== 'unknown' ? screenResult : botSignal && botSignal.result;
  if (resolvedScreenResult === 'win' || resolvedScreenResult === 'lose') window._rcFastGameResult = resolvedScreenResult;
  return { rewardButtons: [], finalScreen: true, result: resolvedScreenResult };
}

function getGameFinishResult(signal) {
  if (signal && (signal.result === 'win' || signal.result === 'lose')) return signal.result;
  return getResultFromPageText((document.body && document.body.innerText || '').replace(/\s+/g, ' ').toLowerCase());
}

function isFastGameClaimProtected(signal) {
  if (signal && signal.result === 'lose') return false;
  return (signal && signal.result === 'win') || window._rcFastGameResult === 'win';
}

function clearFastClaimResources(state) {
  if (!state) return;
  if (state.tickTimer) clearInterval(state.tickTimer);
  if (state.confirmTimer) clearTimeout(state.confirmTimer);
  if (state.performanceObserver) state.performanceObserver.disconnect();
}

function cancelFastClaim(fallbackToLegacy) {
  var state = window._rcFastClaim;
  if (state) {
    state.active = false;
    clearFastClaimResources(state);
  }
  window._rcFastClaim = null;
  if (fallbackToLegacy) {
    window._rcFastClaimFallback = true;
    try { sessionStorage.setItem(FAST_CLAIM_FALLBACK_KEY, '1'); } catch(e) {}
  } else {
    try { sessionStorage.removeItem(FAST_CLAIM_FALLBACK_KEY); } catch(e) {}
  }
}

function handOffFastClaimToLegacy(state, reason) {
  if (state !== window._rcFastClaim || !state.active) return;
  console.log('[RC] Hızlı ödül alma beklemesi devredildi:', reason);
  cancelFastClaim(true);
}

function startFastClaimPerformanceObserver(state) {
  if (typeof PerformanceObserver !== 'function') return;
  try {
    state.performanceObserver = new PerformanceObserver(function(list) {
      if (state !== window._rcFastClaim || !state.active) return;
      list.getEntries().forEach(function(entry) {
        if (state.lastClickPerf && (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest')
            && entry.startTime >= state.lastClickPerf && entry.responseEnd > 0) {
          state.requestCompleted = true;
        }
      });
      processFastClaim(state);
    });
    state.performanceObserver.observe({ type: 'resource', buffered: true });
  } catch(e) {
    state.performanceObserver = null;
  }
}

function startFastClaim(signal) {
  if (window._rcFastClaim || window._rcFastClaimFallback || window._rcFastFinishHandled) return;
  var visibleAt = window._rcRewardUiVisibleSince || Date.now();
  var state = {
    active: true,
    visibleAt: visibleAt,
    firstClickAt: 0,
    lastClickAt: 0,
    lastClickPerf: 0,
    clickedButtons: window._rcFastClaimClickedButtons,
    claimedAny: false,
    requestCompleted: false,
    confirmTimer: null,
    tickTimer: null,
    performanceObserver: null,
    initialSignal: signal
  };
  window._rcFastClaim = state;
  startFastClaimPerformanceObserver(state);
  state.tickTimer = setInterval(function() { processFastClaim(state); }, FAST_CLAIM_TICK_MS);
  processFastClaim(state);
}

function navigateToChooseGame() {
  var chooseButton = document.querySelector('.router-btns a.btn-cyan');
  window._rcRewardScreenHandled = true;
  if (chooseButton) {
    chooseButton.click();
    setTimeout(function() {
      if (window.location.pathname.includes('/play_game')) {
        window.location.assign('https://rollercoin.com/game/choose_game');
      }
    }, 700);
  } else {
    window.location.assign('https://rollercoin.com/game/choose_game');
  }
}

function onGameFinished(signal) {
  if (window.autoPlayActive !== true || window.fastNextGame !== true
      || !window.location.pathname.includes('/play_game') || window._rcFastFinishHandled) return;
  window._rcFastFinishHandled = true;
  var result = getGameFinishResult(signal);
  var activeGame = window._activeGame;
  var elapsed = activeGame ? Date.now() - activeGame.startedAt : null;
  var limit = getGameTimeLimitMs(activeGame);
  if (!activeGame) {
    console.log('[RC] Ödül tamamlandı: Unknown elapsedMs=' + (elapsed === null ? 'unknown' : elapsed) + ' limitMs=' + limit);
  }
  if (activeGame) finishActiveGame(window._rcResultVisibleAt);
  window._rcResultVisibleAt = null;
  cancelFastClaim(false);
  clearGameLimitWatchdog();
  window._rcFastClaimFallback = false;
  console.log('[RC] Hızlı ödül alma tamamlandı (' + result + '); sonraki oyun açılıyor.');
  navigateToChooseGame();
}

function finishFastClaim(state, signal) {
  if (state !== window._rcFastClaim || !state.active || state.confirmTimer) return;
  state.confirmTimer = setTimeout(function() {
    state.confirmTimer = null;
    if (state !== window._rcFastClaim || !state.active) return;
    var buttons = getVisibleRewardButtons();
    if (buttons.length) {
      processFastClaim(state);
      return;
    }
    var screen = getRewardScreenText();
    var settled = state.lastClickAt && Date.now() - state.lastClickAt >= REWARD_SETTLE_MS;
    if (state.claimedAny && (screen.finalScreen || (state.lastClickAt && (state.requestCompleted || settled)))) {
      onGameFinished(signal || state.initialSignal || { result: 'unknown' });
    }
  }, FAST_FINISH_CONFIRM_MS);
}

function processFastClaim(state) {
  if (state !== window._rcFastClaim || !state.active) return;
  if (!window.location.pathname.includes('/play_game')) {
    cancelFastClaim(false);
    return;
  }
  if (window.autoPlayActive !== true || window.fastNextGame !== true) {
    handOffFastClaimToLegacy(state, 'auto-play veya hızlı mod kapatıldı');
    return;
  }
  var now = Date.now();
  var claimStartAt = state.firstClickAt || state.visibleAt;
  if (now - claimStartAt >= CLAIM_MAX_MS) {
    handOffFastClaimToLegacy(state, 'ödül tıklama zaman aşımı');
    return;
  }

  var buttons = getVisibleRewardButtons();
  for (var i = 0; i < buttons.length; i++) {
    var button = buttons[i];
    if (state.clickedButtons.has(button)) continue;
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    state.clickedButtons.add(button);
    state.lastClickAt = Date.now();
    state.lastClickPerf = performance.now();
    state.requestCompleted = false;
    if (!state.firstClickAt) {
      state.firstClickAt = state.lastClickAt;
      try { sessionStorage.setItem(FAST_CLAIM_FALLBACK_KEY, '1'); } catch(e) {}
    }
    if (state.confirmTimer) {
      clearTimeout(state.confirmTimer);
      state.confirmTimer = null;
    }
    try { button.click(); } catch(e) {}
    state.claimedAny = true;
    console.log('[RC] Ödül adımı tıklandı:', button.tagName.toLowerCase(), String(button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim());
    return;
  }

  if (buttons.length) return;
  var screen = getRewardScreenText();
  if (state.claimedAny && (screen.finalScreen || (state.lastClickAt && (state.requestCompleted
      || now - state.lastClickAt >= REWARD_SETTLE_MS)))) {
    finishFastClaim(state, { result: state.initialSignal && state.initialSignal.result });
  }
}
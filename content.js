const RC_VERSION = '2.3.35';
const FAST_FINISH_MIN_GAME_AGE_MS = 3000;
const GAME_LIMIT_EARLY_EXIT_MS = 1000;
const DEFAULT_GAME_LIMIT_MS = 90000;
const GAME_TIME_LIMITS_MS = {
  coinclick: 75000,
  coinmatch: 70000,
  coinfisher: 35000,
  hamsterclimber: 60000,
  coinflip: 60000,
  flappyrocket: 30000,
  '2048': 40000,
};
const FAST_FINISH_OBSERVER_THROTTLE_MS = 200;
const ACTIVE_GAME_STARTED_KEY = 'rc_active_game_started_at';
const ACTIVE_GAME_NAME_KEY = 'rc_active_game_name';
const FAST_CLAIM_FALLBACK_KEY = 'rc_fast_claim_fallback';
var _rcGameLimitTimer = null;
window._rcGameLimitWatchdog = null;


let _rcAudioCtx = null;
function _getRCAudioCtx() {
  if (!_rcAudioCtx || _rcAudioCtx.state === 'closed') {
    _rcAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _rcAudioCtx;
}
['click', 'keydown', 'mousedown', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, () => {
    const ctx = _getRCAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
  }, { once: false, passive: true, capture: true });
});

function playSound(type) {
  if (window._rcSoundEnabled === false) return;
  try {
    const ctx = _getRCAudioCtx();
    const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    resume.then(() => {
      const sounds = {
        select:   { type: 'sine',     freq: [520, 660],      dur: [0, 0.06, 0.12],      vol: 0.2  },
        autoOn:   { type: 'sine',     freq: [440, 554, 659], dur: [0, 0.1, 0.2, 0.3],   vol: 0.18 },
        autoOff:  { type: 'sine',     freq: [659, 554, 440], dur: [0, 0.1, 0.2, 0.3],   vol: 0.18 },
      };
      const s = sounds[type];
      if (!s) return;

      const g = ctx.createGain();
      g.connect(ctx.destination);
      const o = ctx.createOscillator();
      o.connect(g);
      o.type = s.type;

      const t = ctx.currentTime;
      g.gain.setValueAtTime(s.vol, t);
      s.freq.forEach((f, i) => o.frequency.setValueAtTime(f, t + s.dur[i]));

      const end = s.dur[s.dur.length - 1];
      g.gain.setValueAtTime(s.vol, t + end - 0.04);
      g.gain.linearRampToValueAtTime(0, t + end + 0.06);
      o.start(t);
      o.stop(t + end + 0.1);
      o.onended = () => { try { g.disconnect(); } catch(e) {} };
    }).catch(() => {});
  } catch(e) {}
}

window.autoPlayActive = false;
window.autoChoose = true;
window.autoCollect = true;
window.fastNextGame = false;
window._rcFastClaim = null;
window._rcFastClaimFallback = false;
window._rcFastGameResult = 'unknown';
window._rcRewardUiVisibleSince = null;
window._rcResultVisibleAt = null;
window._rcFastClaimClickedButtons = new WeakSet();
window._rcFastFinishObserverActive = false;
try {
  window._rcFastClaimFallback = window.location.pathname.includes('/play_game')
    && sessionStorage.getItem(FAST_CLAIM_FALLBACK_KEY) === '1';
} catch(e) {}
window.lastSelectedGame = null;
window.gameSelectionInProgress = false;
window.pickAndPlayRunning = false;
var mainTimer = null;

try {
  chrome.storage.local.get(['autoPlay', 'autoChoose', 'autoCollect', 'fastNextGame', 'botFisherEnabled', 'botHamsterEnabled', 'bot2048Enabled', 'botCoinClickEnabled', 'botRocketEnabled', 'botCoinFlipEnabled', 'botCoinMatchEnabled'], (data) => {
    if (!data) data = {};
    window.autoCollect = data.autoCollect !== false;
    window.fastNextGame = data.fastNextGame === true;
    window.autoChoose  = data.autoChoose  !== false;
    window._rcBotEnabled = {
      botFisherEnabled:        data.botFisherEnabled        !== false,
      botHamsterEnabled:       data.botHamsterEnabled       !== false,
      bot2048Enabled:          data.bot2048Enabled          !== false,
      botCoinClickEnabled:     data.botCoinClickEnabled     !== false,
      botRocketEnabled:        data.botRocketEnabled        !== false,
      botCoinFlipEnabled:      data.botCoinFlipEnabled      !== false,
      botCoinMatchEnabled:     data.botCoinMatchEnabled     !== false
    };
    try {
      document.body.setAttribute('data-rc-bot-2048-enabled', (data.bot2048Enabled !== false) ? 'true' : 'false');
      document.body.setAttribute('data-rc-bot-coinclick-enabled', (data.botCoinClickEnabled !== false) ? 'true' : 'false');
      document.body.setAttribute('data-rc-bot-rocket-enabled',    (data.botRocketEnabled    !== false) ? 'true' : 'false');
      document.body.setAttribute('data-rc-bot-coinflip-enabled',  (data.botCoinFlipEnabled  !== false) ? 'true' : 'false');
      document.body.setAttribute('data-rc-bot-fisher-enabled',    (data.botFisherEnabled    !== false) ? 'true' : 'false');
      document.body.setAttribute('data-rc-bot-coinmatch-enabled', (data.botCoinMatchEnabled !== false) ? 'true' : 'false');
    } catch(e) {}
    if (typeof checkFastGameFinished === 'function') checkFastGameFinished();
    if (data.autoPlay) {
      fetch('https://api.github.com/repos/zunTd/Rollerbot/releases/latest', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          const latest = (d.tag_name || '').replace('v', '');
          if (!latest) { window.autoPlayActive = true; startAutoPlay(); return; }
          const cur = RC_VERSION.split('.').map(Number);
          const lat = latest.split('.').map(Number);
          let isOld = false;
          for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
            if ((lat[i]||0) > (cur[i]||0)) { isOld = true; break; }
            if ((cur[i]||0) > (lat[i]||0)) break;
          }
          if (isOld) {
            console.warn('[RC] Eski sürüm! Auto-Play engellendi. Güncel sürüm: v' + latest);
            try { chrome.storage.local.set({ autoPlay: false }); } catch(e) {}
          } else {
            window.autoPlayActive = true;
            startAutoPlay();
          }
        })
        .catch(() => { window.autoPlayActive = true; startAutoPlay(); });
    }
    
  });
} catch(e) {
  console.error('[RC] Giriş okuma hatası:', e);
}

function saveState() {
  chrome.storage.local.set({
    autoPlay:    window.autoPlayActive,
    autoChoose:  window.autoChoose,
    autoCollect: window.autoCollect,
    fastNextGame: window.fastNextGame,
  });
}

/* ── Game start/end URL transition watcher ── */
function checkGameTransitions() {
  const nowPlaying = isOnPlayGamePage();
  const wasPlaying = window._lastWasPlaying === true;

  if (!wasPlaying && nowPlaying) {
    clearGameLimitWatchdog();
    window._rcFastGameResult = 'unknown';
    window._rcResultVisibleAt = null;
    window._rcFastClaimClickedButtons = new WeakSet();
    window._rcFastClaimFallback = false;
    window._rcRewardUiVisibleSince = null;
    try { sessionStorage.removeItem(FAST_CLAIM_FALLBACK_KEY); } catch(e) {}
    window._rcFastFinishHandled = false;
    window._rcRewardScreenHandled = false;
    if (window.autoPlayActive && window.fastNextGame) updateGameFinishObserver();
    if (window._rcFinishAgeTimer) {
      clearTimeout(window._rcFinishAgeTimer);
      window._rcFinishAgeTimer = null;
    }
    if (window._rcFinishConfirmTimer) {
      clearTimeout(window._rcFinishConfirmTimer);
      window._rcFinishConfirmTimer = null;
    }
    try { document.body.removeAttribute('data-rc-game-finished'); } catch(e) {}
    if (window.autoClickStartButton) window.autoClickStartButton();
    // /choose_game to /play_game: the game has started.
    const name = (window.pendingGameClick && window.pendingGameClick.name)
      || window.lastSelectedGame
      || window.currentPlayingGame
      || 'Unknown';
    window._activeGame = { name: name, startedAt: Date.now() };
    saveActiveGameForReload(window._activeGame);
    if (window.autoPlayActive && window.fastNextGame) scheduleGameLimitWatchdog();
    window.pendingGameClick = null;
    updatePlayingIndicator(name);
    console.log('[RC] ✓ Oyun başladı:', name);
    // For manually started games, read and update the name after the DOM loads.
    if (name === 'Unknown' || name === null) {
      [500, 2000].forEach(function(delay) {
        setTimeout(function() {
          if (!window._activeGame || window._activeGame.name !== 'Unknown') return;
          var domName = getGameNameFromPage();
          if (domName && domName.length > 1) {
            window._activeGame.name = domName;
            window.currentPlayingGame = domName;
            if (window.autoPlayActive && window.fastNextGame) scheduleGameLimitWatchdog();
            updatePlayingIndicator(domName);
            console.log('[RC] ✓ Manuel oyun ismi alındı:', domName);
          }
        }, delay);
      });
    }
  } else if (wasPlaying && !nowPlaying) {
    // Leaving /play_game ends active game tracking.
    sessionStorage.removeItem('rc_manual_game_name');
    var resultTime = window.autoPlayActive && window.fastNextGame
      ? window._rcResultVisibleAt : null;
    finishActiveGame(resultTime);
    window._rcFastGameResult = 'unknown';
    window._rcResultVisibleAt = null;
    clearActiveGameReloadState();
    clearGameLimitWatchdog();
    cancelFastClaim(false);
    window._rcFastClaimFallback = false;
    window._rcRewardUiVisibleSince = null;
    try { sessionStorage.removeItem(FAST_CLAIM_FALLBACK_KEY); } catch(e) {}
    window._rcFastFinishHandled = false;
    window._rcRewardScreenHandled = false;
    if (window._rcFinishAgeTimer) {
      clearTimeout(window._rcFinishAgeTimer);
      window._rcFinishAgeTimer = null;
    }
    if (window._rcFinishConfirmTimer) {
      clearTimeout(window._rcFinishConfirmTimer);
      window._rcFinishConfirmTimer = null;
    }
    try { document.body.removeAttribute('data-rc-game-finished'); } catch(e) {}
    updatePlayingIndicator(null);
    updateGameFinishObserver();
  }

  window._lastWasPlaying = nowPlaying;
}

function finishActiveGame(completionTime) {
  if (!window._activeGame) return;
  const activeGame = window._activeGame;
  const duration = Math.max(0, (completionTime || Date.now()) - activeGame.startedAt);
  if (window.autoPlayActive === true && window.fastNextGame === true) {
    console.log('[RC] Oyun süresi: ' + activeGame.name + ' elapsedMs=' + duration
      + ' limitMs=' + getGameTimeLimitMs(activeGame));
  }
  clearActiveGameReloadState();
  window._activeGame = null;
}

function saveActiveGameForReload(activeGame) {
  try {
    sessionStorage.setItem(ACTIVE_GAME_STARTED_KEY, String(activeGame.startedAt));
    sessionStorage.setItem(ACTIVE_GAME_NAME_KEY, String(activeGame.name || 'Unknown'));
  } catch(e) {}
}

function restoreActiveGameAfterReload() {
  if (window._activeGame || !isOnPlayGamePage()) return;
  var startedAt = 0;
  var name = '';
  try {
    startedAt = Number(sessionStorage.getItem(ACTIVE_GAME_STARTED_KEY));
    name = sessionStorage.getItem(ACTIVE_GAME_NAME_KEY) || '';
  } catch(e) {}
  var now = Date.now();
  if (!startedAt || startedAt > now || now - startedAt > 30 * 60 * 1000) startedAt = now;
  if (!name) name = getGameNameFromPage() || 'Unknown';
  window._activeGame = { name: name, startedAt: startedAt };
  saveActiveGameForReload(window._activeGame);
  updatePlayingIndicator(name);
  console.log('[RC] Oyun oturumu sekme yenilemesinden geri yüklendi:', name);
  if (window.autoPlayActive && window.fastNextGame) scheduleGameLimitWatchdog();
}

function clearActiveGameReloadState() {
  try {
    sessionStorage.removeItem(ACTIVE_GAME_STARTED_KEY);
    sessionStorage.removeItem(ACTIVE_GAME_NAME_KEY);
  } catch(e) {}
}

function updatePlayingIndicator(name) {
  try {
    if (name) {
      document.body.setAttribute('data-rc-current-game', name);
    } else {
      document.body.removeAttribute('data-rc-current-game');
    }
  } catch(e) {}
}

function getGameTimeLimitMs(activeGame) {
  var name = typeof activeGame === 'string' ? activeGame
    : activeGame && activeGame.name || window.currentPlayingGame
      || document.body.getAttribute('data-rc-current-game') || '';
  var normalizedName = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  var gameIds = Object.keys(GAME_TIME_LIMITS_MS);
  for (var i = 0; i < gameIds.length; i++) {
    if (normalizedName.includes(gameIds[i])) return GAME_TIME_LIMITS_MS[gameIds[i]];
  }
  return DEFAULT_GAME_LIMIT_MS;
}

function clearGameLimitWatchdog(resetState) {
  if (_rcGameLimitTimer) {
    clearTimeout(_rcGameLimitTimer);
    _rcGameLimitTimer = null;
  }
  if (resetState !== false) window._rcGameLimitWatchdog = null;
}

function scheduleGameLimitWatchdog() {
  var activeGame = window._activeGame;
  if (window.autoPlayActive !== true || window.fastNextGame !== true
      || !window.location.pathname.includes('/play_game') || !activeGame
      || window._rcFastGameResult === 'win') return;

  var watchdog = window._rcGameLimitWatchdog;
  var limit = getGameTimeLimitMs(activeGame);
  if (!watchdog || watchdog.startedAt !== activeGame.startedAt || watchdog.limitMs !== limit) {
    clearGameLimitWatchdog();
    watchdog = { startedAt: activeGame.startedAt, limitMs: limit };
    window._rcGameLimitWatchdog = watchdog;
  }
  if (_rcGameLimitTimer) return;

  var deadline = activeGame.startedAt + limit - GAME_LIMIT_EARLY_EXIT_MS;
  _rcGameLimitTimer = setTimeout(function() {
    _rcGameLimitTimer = null;
    runGameLimitWatchdog(watchdog);
  }, Math.max(0, deadline - Date.now()));
}

function runGameLimitWatchdog(watchdog) {
  var activeGame = window._activeGame;
  if (!activeGame || watchdog !== window._rcGameLimitWatchdog
      || activeGame.startedAt !== watchdog.startedAt
      || window.autoPlayActive !== true || window.fastNextGame !== true
      || !window.location.pathname.includes('/play_game')) {
    clearGameLimitWatchdog();
    return;
  }
  var signal = getGameFinishSignal();
  if (signal && window._rcRewardUiVisibleSince === null) window._rcRewardUiVisibleSince = Date.now();
  if (isFastGameClaimProtected(signal)) {
    clearGameLimitWatchdog();
    checkFastGameFinished();
    return;
  }
  var deadline = activeGame.startedAt + getGameTimeLimitMs(activeGame) - GAME_LIMIT_EARLY_EXIT_MS;
  if (Date.now() < deadline) {
    scheduleGameLimitWatchdog();
    return;
  }

  var now = Date.now();
  var elapsed = now - activeGame.startedAt;
  var limit = getGameTimeLimitMs(activeGame);
  console.log('[RC] Kazanılmadı; oyun limitinden 1 saniye önce sonraki oyuna geçiliyor. elapsedMs=' + elapsed + ' limitMs=' + limit);
  window._rcFastFinishHandled = true;
  finishActiveGame(window._rcResultVisibleAt || now);
  window._rcResultVisibleAt = null;
  cancelFastClaim(false);
  clearGameLimitWatchdog();
  window._rcFastClaimFallback = false;
  window._rcRewardScreenHandled = true;
  navigateToChooseGame();
}

function checkFastGameFinished() {
  if (window.autoPlayActive !== true || window.fastNextGame !== true
      || !window.location.pathname.includes('/play_game') || window._rcFastFinishHandled
      || window._rcFastClaimFallback) return;
  scheduleGameLimitWatchdog();
  if (window._rcFastClaim) {
    processFastClaim(window._rcFastClaim);
    return;
  }
  var signal = getGameFinishSignal();
  if (!signal) {
    return;
  }
  if (window._rcRewardUiVisibleSince === null) {
    window._rcRewardUiVisibleSince = Date.now();
  }
  if (isFastGameClaimProtected(signal)) clearGameLimitWatchdog();
  var age = window._activeGame ? Date.now() - window._activeGame.startedAt : FAST_FINISH_MIN_GAME_AGE_MS;
  if (age < FAST_FINISH_MIN_GAME_AGE_MS) {
    if (!window._rcFinishAgeTimer) {
      window._rcFinishAgeTimer = setTimeout(function() {
        window._rcFinishAgeTimer = null;
        checkFastGameFinished();
      }, FAST_FINISH_MIN_GAME_AGE_MS - age);
    }
    return;
  }
  startFastClaim(signal);
}

var _rcFinishObserverLastRun = 0;
var _rcFinishObserverTimer = null;
function queueFastFinishCheck() {
  if (window.autoPlayActive !== true || window.fastNextGame !== true) return;
  var now = Date.now();
  var elapsed = now - _rcFinishObserverLastRun;
  if (elapsed >= FAST_FINISH_OBSERVER_THROTTLE_MS) {
    _rcFinishObserverLastRun = now;
    checkFastGameFinished();
  } else if (!_rcFinishObserverTimer) {
    _rcFinishObserverTimer = setTimeout(function() {
      _rcFinishObserverTimer = null;
      _rcFinishObserverLastRun = Date.now();
      checkFastGameFinished();
    }, FAST_FINISH_OBSERVER_THROTTLE_MS - elapsed);
  }
}

var gameFinishObserver = new MutationObserver(function() {
  if (window.autoPlayActive !== true || window.fastNextGame !== true) return;
  if (!window.location.pathname.includes('/play_game')) {
    if (window._rcFastClaim || window._rcFastFinishHandled || window._rcRewardUiVisibleSince !== null) {
      cancelFastClaim(false);
      window._rcFastFinishHandled = false;
      window._rcRewardScreenHandled = false;
      window._rcRewardUiVisibleSince = null;
    }
    gameFinishObserver.disconnect();
    window._rcFastFinishObserverActive = false;
    return;
  }
  queueFastFinishCheck();
});
function updateGameFinishObserver() {
  var shouldObserve = window.autoPlayActive === true && window.fastNextGame === true
    && window.location.pathname.includes('/play_game') && !!document.body;
  if (shouldObserve && !window._rcFastFinishObserverActive) {
    gameFinishObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-rc-game-finished', 'class', 'style', 'hidden', 'disabled', 'aria-hidden'] });
    window._rcFastFinishObserverActive = true;
  } else if (!shouldObserve && window._rcFastFinishObserverActive) {
    gameFinishObserver.disconnect();
    window._rcFastFinishObserverActive = false;
    if (_rcFinishObserverTimer) {
      clearTimeout(_rcFinishObserverTimer);
      _rcFinishObserverTimer = null;
    }
  }
}


// Track game-page transitions for manual play and Fast Next.
setTimeout(() => {
  if (!window._transitionWatcherStarted) {
    window._transitionWatcherStarted = true;
    window._lastWasPlaying = isOnPlayGamePage();
    if (window._lastWasPlaying) {
      restoreActiveGameAfterReload();
      if (window.autoClickStartButton) window.autoClickStartButton();
      if (window.autoPlayActive && window.fastNextGame) updateGameFinishObserver();
      checkFastGameFinished();
    }
    setInterval(checkGameTransitions, 1000);
  }
}, 2000);

function startAutoPlay() {
  playSound('autoOn');
  console.log('[RC] startAutoPlay çağrıldı!');
  window.autoPlayActive = true;
  updateGameFinishObserver();
  checkFastGameFinished();
  if (mainTimer) clearInterval(mainTimer);
  mainTimer = setInterval(() => {
    if (!window.autoPlayActive) return;
    if (window.gameSelectionInProgress) return;
    if (isOnPlayGamePage()) return;
    if (isOnChooseGamePage()) {
      pickAndPlay();
    }
  }, 1000);
}

function stopAutoPlay() {
  playSound('autoOff');
  window.autoPlayActive = false;
  cancelFastClaim(!!window._rcFastClaim);
  updateGameFinishObserver();
  clearGameLimitWatchdog();
  if (mainTimer) { clearInterval(mainTimer); mainTimer = null; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.action === 'toggleAuto') {
    window.autoPlayActive = msg.on;
    saveState();
    if (msg.on) startAutoPlay(); else stopAutoPlay();
  }
  else if (msg.action === 'toggleChoose') { window.autoChoose = msg.on; saveState(); }
  else if (msg.action === 'toggleCollect') { window.autoCollect = msg.on; saveState(); }
  else if (msg.action === 'toggleFastNext') {
    window.fastNextGame = msg.on === true;
    if (!window.fastNextGame) cancelFastClaim(!!window._rcFastClaim);
    updateGameFinishObserver();
    if (!window.fastNextGame) clearGameLimitWatchdog();
    saveState();
    checkFastGameFinished();
  }
  else if (msg.action === 'getBotStatus') {
    sendResponse({
      bots: {
        fisher:        !!(window._rcCoinFisher    && window._rcCoinFisher.isActive()),
        hamster:       !!(window._rcHamster       && window._rcHamster.isActive()),
        '2048':        document.body.getAttribute('data-rc-bot-2048-active') === 'true',
        coinclick:     document.body.getAttribute('data-rc-bot-coinclick-active') === 'true',
        rocket:        document.body.getAttribute('data-rc-bot-rocket-active') === 'true',
        coinflip:      document.body.getAttribute('data-rc-bot-coinflip-active') === 'true',
        coinmatch:     !!(window._rcCoinMatch     && window._rcCoinMatch.isActive())
      }
    });
    return true;
  }
  else if (msg.action === 'setBotEnabled') {
    window._rcBotEnabled = window._rcBotEnabled || {};
    window._rcBotEnabled[msg.bot] = msg.enabled;
    try {
      if (msg.bot === 'bot2048Enabled') {
        document.body.setAttribute('data-rc-bot-2048-enabled', msg.enabled ? 'true' : 'false');
      }
      if (msg.bot === 'botCoinClickEnabled') {
        document.body.setAttribute('data-rc-bot-coinclick-enabled', msg.enabled ? 'true' : 'false');
      }
      if (msg.bot === 'botRocketEnabled') {
        document.body.setAttribute('data-rc-bot-rocket-enabled', msg.enabled ? 'true' : 'false');
      }
      if (msg.bot === 'botCoinFlipEnabled') {
        document.body.setAttribute('data-rc-bot-coinflip-enabled', msg.enabled ? 'true' : 'false');
      }
      if (msg.bot === 'botFisherEnabled') {
        document.body.setAttribute('data-rc-bot-fisher-enabled', msg.enabled ? 'true' : 'false');
      }
      if (msg.bot === 'botCoinMatchEnabled') {
        document.body.setAttribute('data-rc-bot-coinmatch-enabled', msg.enabled ? 'true' : 'false');
      }

    } catch(e) {}
    /* Stop bots immediately when they are disabled. */
    if (msg.bot === 'botFisherEnabled'        && window._rcCoinFisher)    { if (!msg.enabled) window._rcCoinFisher.stop(); }
    if (msg.bot === 'botHamsterEnabled'       && window._rcHamster)       { if (!msg.enabled) window._rcHamster.stop(); }
    if (msg.bot === 'bot2048Enabled'          && window._rc2048)          { if (!msg.enabled) window._rc2048.stop(); }
    if (msg.bot === 'botRocketEnabled'        && window._rcFlappyRocket)  { if (!msg.enabled) window._rcFlappyRocket.stop(); }
    if (msg.bot === 'botCoinFlipEnabled'      && window._rcCoinFlip)      { if (!msg.enabled) window._rcCoinFlip.stop(); }
    if (msg.bot === 'botCoinMatchEnabled'     && window._rcCoinMatch)     { if (!msg.enabled) window._rcCoinMatch.stop(); }

    sendResponse({ ok: true });
    return true;
  }
  sendResponse({ ok: true });
  return true;
});

setInterval(() => {
  let clicksThisRound = 0;
  const fastClaimBypass = window.location.pathname.includes('/play_game') && isFastClaimActive();
  if (window.autoCollect && !fastClaimBypass) {
    const gainPowerBtn = document.querySelector('.complete-game-button-wrapper button');
    const collectBtn = document.querySelector('.collect-button button');
    const dropsCollectBtn = document.querySelector('.drops-modal .collect-buttons button');
    if (gainPowerBtn && gainPowerBtn.offsetParent !== null
        && !window._rcFastClaimClickedButtons.has(gainPowerBtn)) {
      window._rcFastClaimClickedButtons.add(gainPowerBtn);
      gainPowerBtn.click();
      clicksThisRound++;
    }
    if (collectBtn && collectBtn.offsetParent !== null
        && !window._rcFastClaimClickedButtons.has(collectBtn)) {
      window._rcFastClaimClickedButtons.add(collectBtn);
      collectBtn.click();
      clicksThisRound++;
    }
    if (dropsCollectBtn && dropsCollectBtn.offsetParent !== null
        && !window._rcFastClaimClickedButtons.has(dropsCollectBtn)) {
      window._rcFastClaimClickedButtons.add(dropsCollectBtn);
      dropsCollectBtn.click();
      clicksThisRound++;
    }

    const claimButton = Array.from(document.querySelectorAll(
      'button, [role="button"], a, input[type="button"], input[type="submit"]'
    )).find(function(el) {
      if (el.offsetParent === null) return false;
      const text = String(el.tagName === 'INPUT' ? el.value : (el.innerText || el.textContent) || '')
        .replace(/\s+/g, ' ').trim();
      return /^(claim(?:\s+reward)?|collect\s+reward)$/i.test(text);
    });
    if (claimButton && !window._rcFastClaimClickedButtons.has(claimButton)) {
      window._rcFastClaimClickedButtons.add(claimButton);
      claimButton.click();
      clicksThisRound++;
    }
  }


  if (window.autoChoose && !fastClaimBypass && !window.location.href.includes('/play_game')) {
    const chooseBtn = document.querySelector('a.btn-cyan[href="/game/choose_game"]');
    if (chooseBtn) {
      const style = window.getComputedStyle(chooseBtn);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && chooseBtn.offsetParent !== null) {
        chooseBtn.click();
        clicksThisRound++;
      }
    }
  }

  if (clicksThisRound > 0) {
    console.log('[RC] Otomatik tıklandı:', clicksThisRound, 'buton');
  }
}, 2000);

setInterval(function() {
  const onPlayPage = window.location.pathname.includes('/play_game');
  if (!onPlayPage) {
    window._rcRewardScreenHandled = false;
    return;
  }
  if (isFastClaimActive()) return;
  if (!window.autoChoose || window._rcRewardScreenHandled) return;

  const pageText = (document.body.innerText || '').replace(/\s+/g, ' ').toLowerCase();
  if (!pageText.includes('go home') || !pageText.includes('choose game')) return;

  window._rcRewardScreenHandled = true;
  const chooseButton = Array.from(document.querySelectorAll(
    'button, [role="button"], a, input[type="button"], input[type="submit"]'
  )).find(function(el) {
    const text = String(el.tagName === 'INPUT' ? el.value : (el.innerText || el.textContent) || '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return text === 'choose game' && style.display !== 'none'
      && style.visibility !== 'hidden' && style.opacity !== '0'
      && rect.width > 0 && rect.height > 0;
  });

  if (chooseButton) {
    chooseButton.click();
  } else {
    window.location.assign('https://rollercoin.com/game/choose_game');
  }
  console.log('[RC] Reward screen detected; returning to choose game');
}, 500);

/* ── Manual click interceptor: capture the game name when START is clicked ── */
document.addEventListener('click', function(e) {
  if (!window.location.href.includes('/choose_game')) return;
  if (window.gameSelectionInProgress) return; /* Auto-play already handles this click. */
  var btn = e.target.closest('button');
  if (!btn) return;
  var btnText = (btn.innerText || btn.textContent || '').trim().toUpperCase();
  if (btnText !== 'START' && btnText !== 'PLAY') return;
  /* Find the nearest game item containing the START button. */
  var item = btn.closest('.choose-game-item, .choose-game-item-container, [class*="choose-game-item"]');
  if (!item) return;
  var titleEl = item.querySelector('p.game-title, .game-title, [class*="game-title"]');
  var name = titleEl && titleEl.innerText && titleEl.innerText.trim();
  if (name && isValidGameName(name)) {
    window.lastSelectedGame = name.substring(0, 40);
    window.currentPlayingGame = window.lastSelectedGame;
    console.log('[RC] ✓ Manuel seçim yakalandı:', window.lastSelectedGame);
  }
}, true); /* Capture the click before it reaches the target element. */



/* ═══════════════════════════════════════════════════════════════
   RC Helper — Play-Game Automation (START button + game bots)
   ═══════════════════════════════════════════════════════════════ */
(function installRCPlayGameAutomation() {
  'use strict';

  const startLabels = ['START IN FULLSCREEN', 'START', 'PLAY', 'BEGIN'];
  const botSpecs = [
    {
      property: '_rcCoinFisher',
      path: /\/play_game\/(?:coinfisher|coin-fisher)(?:\/|$)/i,
      game: /coinfisher/,
      setting: 'botFisherEnabled',
      interval: 1500,
      tick: function(bot) { bot.pressKey('Space', 120); }
    },
  ];

  function isPlayGamePage() { return window.location.pathname.includes('/play_game'); }
  function isEnabled(s) { return !window._rcBotEnabled || window._rcBotEnabled[s] !== false; }
  function isBotGame(spec) {
    if (spec.path.test(window.location.pathname)) return true;
    const currentGame = [
      document.body.getAttribute('data-rc-current-game'),
      window.currentPlayingGame,
      document.title
    ].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
    return spec.game.test(currentGame);
  }
  function isVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
      && rect.width > 0 && rect.height > 0;
  }

  function findStartButton() {
    const candidates = Array.from(document.querySelectorAll(
      'button, [role="button"], a, input[type="button"], input[type="submit"]'
    )).filter(isVisible).map(function(el) {
      const val = el.tagName === 'INPUT'
        ? (el.value || el.getAttribute('aria-label') || '')
        : (el.innerText || el.textContent || el.getAttribute('aria-label') || '');
      return { el, text: String(val).replace(/\s+/g, ' ').trim().toUpperCase() };
    });
    for (const label of startLabels) {
      const match = candidates.find(c => c.text === label);
      if (match) return match.el;
    }
    return null;
  }

  function clearStartWatch() {
    if (window._rcStartBtnObserver) window._rcStartBtnObserver.disconnect();
    if (window._rcStartBtnPoll)     clearInterval(window._rcStartBtnPoll);
    if (window._rcStartBtnTimeout)  clearTimeout(window._rcStartBtnTimeout);
    window._rcStartBtnObserver = window._rcStartBtnPoll = window._rcStartBtnTimeout = null;
  }

  function clickCanvasStart() {
    const canvas = document.querySelector('#phaserGame canvas') || document.querySelector('canvas');
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    if (!rect.width || !rect.height || style.display === 'none'
        || style.visibility === 'hidden' || style.opacity === '0') return false;
    const opts = {
      view: window, bubbles: true, cancelable: true,
      clientX: rect.left + rect.width * 0.5, clientY: rect.top + rect.height * 0.415,
      button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true
    };
    if (window.PointerEvent) {
      canvas.dispatchEvent(new PointerEvent('pointermove', opts));
      canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
      opts.buttons = 0;
      canvas.dispatchEvent(new PointerEvent('pointerup', opts));
    }
    canvas.dispatchEvent(new MouseEvent('mousemove', opts));
    opts.buttons = 1;
    canvas.dispatchEvent(new MouseEvent('mousedown', opts));
    opts.buttons = 0;
    canvas.dispatchEvent(new MouseEvent('mouseup', opts));
    canvas.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }

  function autoClickStartButton() {
    if (!isPlayGamePage() || window._rcStartBtnClicked || window._rcStartBtnAttempted) return;
    window._rcStartBtnAttempted = true;
    const startedAt = Date.now();
    let stopped = false;

    function cleanup() { if (!stopped) { stopped = true; clearStartWatch(); } }
    function findAndClick() {
      if (stopped) return;
      if (!isPlayGamePage()) { cleanup(); return; }
      const btn = findStartButton();
      if (btn) { window._rcStartBtnClicked = true; cleanup(); btn.click(); return; }
      if (Date.now() - startedAt >= 500 && clickCanvasStart()) {
        window._rcStartBtnClicked = true;
        cleanup();
        return;
      }
      if (Date.now() - startedAt >= 15000) cleanup();
    }

    const root = document.documentElement || document;
    if (window.MutationObserver && root) {
      window._rcStartBtnObserver = new MutationObserver(findAndClick);
      window._rcStartBtnObserver.observe(root, { childList: true, subtree: true, characterData: true });
    }
    window._rcStartBtnPoll    = setInterval(findAndClick, 500);
    window._rcStartBtnTimeout = setTimeout(cleanup, 15000);
    findAndClick();
  }

  window.autoClickStartButton = autoClickStartButton;

  function resetStartButtonState() {
    clearStartWatch();
    window._rcStartBtnClicked = window._rcStartBtnAttempted = false;
  }

  function getCanvas() {
    return document.querySelector('#phaserGame canvas') || document.querySelector('canvas');
  }

  function dispatchKey(code, type, canvas) {
    const map = {
      Space: { key: ' ', keyCode: 32, which: 32 },
      ArrowLeft: { key: 'ArrowLeft', keyCode: 37, which: 37 },
      ArrowRight: { key: 'ArrowRight', keyCode: 39, which: 39 }
    };
    const v = map[code] || { key: code, keyCode: 0, which: 0 };
    [window, document, canvas, document.body].filter(Boolean).forEach(function(t) {
      t.dispatchEvent(new KeyboardEvent(type, {
        key: v.key, code, keyCode: v.keyCode, which: v.which, bubbles: true, cancelable: true
      }));
    });
  }

  function createBot(spec) {
    let active = false, intervalId = null;
    const timeouts = new Set(), pressedKeys = new Set();
    const bot = {
      isActive() { return active; },
      pressKey(code, duration) {
        if (!active) return;
        dispatchKey(code, 'keydown', getCanvas());
        pressedKeys.add(code);
        const tid = setTimeout(function() {
          timeouts.delete(tid);
          if (pressedKeys.delete(code)) dispatchKey(code, 'keyup', getCanvas());
        }, duration || 100);
        timeouts.add(tid);
      },
      start() {
        if (active || !isPlayGamePage() || !isBotGame(spec)) return;
        if (!isEnabled(spec.setting)) return;
        active = true;
        intervalId = setInterval(function() {
          if (!isPlayGamePage() || !isBotGame(spec)
              || !isEnabled(spec.setting)) {
            bot.stop(); return;
          }
          try { spec.tick(bot); }
          catch(e) { console.warn('[RC bot] tick error:', e); }
        }, spec.interval);
      },
      stop() {
        if (intervalId !== null) clearInterval(intervalId);
        intervalId = null;
        timeouts.forEach(clearTimeout); timeouts.clear();
        pressedKeys.forEach(code => dispatchKey(code, 'keyup', getCanvas()));
        pressedKeys.clear(); active = false;
      }
    };
    return bot;
  }

  if (window._rcFallbackBotTimer) clearInterval(window._rcFallbackBotTimer);
  ['_rcCoinFisher']
    .forEach(p => { if (window[p]?.stop) window[p].stop(); });

  const bots = botSpecs.map(function(spec) {
    const bot = createBot(spec);
    window[spec.property] = bot;
    return { spec, bot };
  });

  function reconcileBots() {
    bots.forEach(function({ spec, bot }) {
      const ok = isPlayGamePage() && isBotGame(spec)
        && isEnabled(spec.setting);
      if (ok && !bot.isActive()) bot.start();
      if (!ok && bot.isActive()) bot.stop();
    });
  }

  window._rcFallbackBotTimer = setInterval(reconcileBots, 500);
  reconcileBots();

  let wasOnPlayGame = isPlayGamePage();
  if (wasOnPlayGame) autoClickStartButton();

  if (window._rcStartRouteWatcher) clearInterval(window._rcStartRouteWatcher);
  window._rcStartRouteWatcher = setInterval(function() {
    const now = isPlayGamePage();
    if (!wasOnPlayGame && now)  autoClickStartButton();
    if (wasOnPlayGame  && !now) resetStartButtonState();
    wasOnPlayGame = now;
  }, 500);

  if (typeof checkGameTransitions === 'function') {
    const _orig = checkGameTransitions;
    checkGameTransitions = function() {
      const wasPlaying = window._lastWasPlaying === true;
      const nowPlaying = isPlayGamePage();
      if ( wasPlaying && !nowPlaying) resetStartButtonState();
      return _orig.apply(this, arguments);
    };
  }

})();




var autoPlayState = false;
var CURRENT_VERSION = '2.3.35';
var updateAvailable = false;
var latestReleaseUrl = 'https://github.com/zunTd/Rollerbot/releases/latest';

function checkForUpdates() {
  var btnAuto = document.getElementById('btn-auto');
  if (btnAuto) {
    btnAuto.disabled = true;
    btnAuto.style.opacity = '0.4';
    btnAuto.style.cursor = 'not-allowed';
    btnAuto.title = 'Kontrol ediliyor...';
  }

  fetch('https://api.github.com/repos/zunTd/Rollerbot/releases/latest', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var latest = (data.tag_name || '').replace('v', '');
      if (!latest) { unlockAutoPlay(); return; }
      latestReleaseUrl = data.html_url || latestReleaseUrl;
      var cur = CURRENT_VERSION.split('.').map(Number);
      var lat = latest.split('.').map(Number);
      var isOld = false;
      for (var i = 0; i < Math.max(cur.length, lat.length); i++) {
        var c = cur[i] || 0, l = lat[i] || 0;
        if (l > c) { isOld = true; break; }
        if (c > l) break;
      }
      if (isOld) {
        updateAvailable = true;
        var banner = document.getElementById('update-banner');
        var sub = document.getElementById('update-banner-sub');
        var btnUpdate = document.getElementById('btn-update');
        if (banner) banner.style.display = 'block';
        if (sub) sub.textContent = 'v' + latest + ' — A new version has been released. Please update to use Auto-Play.';
        if (btnUpdate) btnUpdate.onclick = function() { chrome.tabs.create({ url: latestReleaseUrl }); };
        if (btnAuto) {
          btnAuto.disabled = true;
          btnAuto.style.opacity = '0.4';
          btnAuto.style.cursor = 'not-allowed';
          btnAuto.title = 'Update required';
        }
      } else {
        unlockAutoPlay();
      }
    })
    .catch(function() { unlockAutoPlay(); });
}

function unlockAutoPlay() {
  var btnAuto = document.getElementById('btn-auto');
  if (btnAuto) {
    btnAuto.disabled = false;
    btnAuto.style.opacity = '';
    btnAuto.style.cursor = '';
    btnAuto.title = '';
  }
}

function sendMessage(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, msg, function() {
      void chrome.runtime.lastError;
    });
  });
}


document.addEventListener('DOMContentLoaded', function() {
  checkForUpdates();

  /* ── Popout window ── */
  var btnPopout = document.getElementById('btn-popout');
  if (btnPopout) btnPopout.onclick = function() {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html?popout=1'),
      type: 'popup',
      width: 340,
      height: 640,
      focused: true
    });
    window.close();
  };

  /* Hide the popout control in the popout window. */
  if (new URLSearchParams(location.search).get('popout') === '1' && btnPopout) {
    btnPopout.style.display = 'none';
  }

  var btnAuto      = document.getElementById('btn-auto');
  var chkCollect   = document.getElementById('chk-collect');
  var chkFastNext  = document.getElementById('chk-fast-next');

  chrome.storage.local.get(['autoPlay', 'autoCollect', 'fastNextGame'], (data) => {
    autoPlayState = !!data.autoPlay;
    chkCollect.checked = data.autoCollect !== false;
    chkFastNext.checked = data.fastNextGame === true;
    updateAutoBtn(autoPlayState);
  });

  btnAuto.onclick = function() {
    if (updateAvailable) return;
    autoPlayState = !autoPlayState;
    updateAutoBtn(autoPlayState);
    chrome.storage.local.set({ autoPlay: autoPlayState });
    sendMessage({ action: 'toggleAuto', on: autoPlayState });
  };

  function updateAutoBtn(state) {
    document.getElementById('auto-play-lbl').textContent = state ? 'Auto-Play: ON' : 'Auto-Play: OFF';
    btnAuto.classList.toggle('active', state);
  }

  /* ── Bot toggles ── */
  var BOT_KEYS = {
    'chk-bot-fisher':         'botFisherEnabled',
    'chk-bot-hamster':        'botHamsterEnabled',
    'chk-bot-2048':           'bot2048Enabled',
    'chk-bot-coinclick':      'botCoinClickEnabled',
    'chk-bot-rocket':         'botRocketEnabled',
    'chk-bot-coinflip':       'botCoinFlipEnabled',
    'chk-bot-coinmatch':      'botCoinMatchEnabled'
  };

  chrome.storage.local.get(Object.values(BOT_KEYS), function(data) {
    Object.keys(BOT_KEYS).forEach(function(chkId) {
      var el = document.getElementById(chkId);
      if (!el) return;
      var key = BOT_KEYS[chkId];
      el.checked = data[key] !== false; /* default enabled */
      el.addEventListener('change', function() {
        var upd = {};
        upd[key] = el.checked;
        chrome.storage.local.set(upd);
        sendMessage({ action: 'setBotEnabled', bot: key, enabled: el.checked });
      });
    });
  });

  /* Update bot badges when the content script reports a status change. */
  function updateBotBadges(activeBots) {
    var map = { 
      fisher:     'badge-fisher',
      hamster:    'badge-hamster',
      '2048':     'badge-2048',
      coinclick: 'badge-coinclick',
      rocket: 'badge-rocket',
      coinflip:  'badge-coinflip',
      coinmatch: 'badge-coinmatch'
    };
    Object.keys(map).forEach(function(k) {
      var el = document.getElementById(map[k]);
      if (el) el.style.display = (activeBots && activeBots[k]) ? '' : 'none';
    });
  }

  /* Request bot status from the content script. */
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getBotStatus' }, function(resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.bots) updateBotBadges(resp.bots);
    });
  });

  chkCollect.onchange = function() { chrome.storage.local.set({ autoCollect: chkCollect.checked }); sendMessage({ action: 'toggleCollect', on: chkCollect.checked }); };
  chkFastNext.onchange = function() { chrome.storage.local.set({ fastNextGame: chkFastNext.checked }); sendMessage({ action: 'toggleFastNext', on: chkFastNext.checked }); };

});
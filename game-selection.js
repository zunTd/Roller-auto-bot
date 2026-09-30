function isOnChooseGamePage() {
  const url = window.location.href;
  const hasChooseInUrl = url.includes('/choose_game');
  const hasChooseGameElement = document.querySelector('.choose-game-page, [class*="choose-game"]');
  const hasChooseInH1 = document.querySelector('h1')?.innerText?.toLowerCase().includes('choose');
  return hasChooseInUrl || (hasChooseGameElement && hasChooseInH1);
}

function getGameNameFromPage() {
  /* Only run on the play_game page. */
  if (!window.location.href.includes('/play_game')) return null;

  /* 1) document.title — "GameName | RollerCoin" formatında */
  var title = document.title || '';
  var titlePart = title.split('|')[0].split('-')[0].trim();
  if (titlePart && titlePart.length > 1 && isValidGameName(titlePart)) {
    return titlePart.substring(0, 40);
  }
  /* 2) Game slug from paths such as /play_game/<name>. */
  var m = window.location.pathname.match(/\/play_game\/([^/?#]+)/);
  if (m) {
    var slug = decodeURIComponent(m[1]).replace(/-/g, ' ').trim();
    if (slug && isValidGameName(slug)) return slug.substring(0, 40);
  }
  var manualName = sessionStorage.getItem('rc_manual_game_name');
  if (manualName && isValidGameName(manualName)) return manualName.substring(0, 40);
  return null;
}

function isOnPlayGamePage() {
  const url = window.location.href;
     /* Use the URL because game DOM elements can briefly disappear during SPA
       navigation, which can otherwise cause a false game-end detection. */
  const isPlayGame = url.includes('/play_game');

  if (isPlayGame && !window.gameSelectionInProgress) {
    var name = getGameNameFromPage();
    if (name && name !== window.currentPlayingGame) {
      window.currentPlayingGame = name;
    }
  }

  return isPlayGame;
}

const BADGE_WORDS = new Set(['new', 'hot', 'soon', 'coming soon', 'wait', 'beta', 'free',
  'rollercoin', 'play games to rise your power', 'online bitcoin', 'play game', 'choose game']);

function isValidGameName(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t.length > 1 && !BADGE_WORDS.has(t);
}

function getGameName(item) {
  const dataName = item.getAttribute('data-game-name') || item.getAttribute('data-name') || item.getAttribute('data-title');
  if (dataName && isValidGameName(dataName)) {
    return dataName.trim().substring(0, 40);
  }
  
  const nameSelectors = [
    '[class*="game-name"]',
    '[class*="gameName"]',
    '[class*="item-name"]',
    '[class*="itemName"]',
    '.game-card-title',
    '.game-title',
    '[class*="game-title"]',
    'h3',
    'h4',
    '[class*="title"]',
    '[class*="Name"]',
    '.name',
  ];
  
  for (const selector of nameSelectors) {
    const nameEl = item.querySelector(selector);
    const text = nameEl?.innerText?.trim();
    if (isValidGameName(text)) {
      return text.substring(0, 40);
    }
  }
  
  const allText = item.innerText.trim();
  const lines = allText.split(/[\n\r]+/).map(l => l.trim()).filter(isValidGameName);
  if (lines.length > 0) {
    return lines[0].substring(0, 40);
  }
  
  return 'Game-' + Date.now();
}

document.addEventListener('click', function(e) {
  var item = e.target.closest('.choose-game-item-container, .choose-game-item, .game-item, div[class*="choose-game-item"]');
  if (!item) return;
  var name = getGameName(item);
  if (name) sessionStorage.setItem('rc_manual_game_name', name);
}, true);

const BOT_AUTOPLAY_GAME_SETTINGS = {
  hamsterclimber: 'botHamsterEnabled',
  flappyrocket: 'botRocketEnabled',
  '2048': 'bot2048Enabled',
  '2048coins': 'bot2048Enabled',
  coins2048: 'bot2048Enabled',
  coinclick: 'botCoinClickEnabled',
  'coin-click': 'botCoinClickEnabled',
  coinflip: 'botCoinFlipEnabled',
  coinflipmemory: 'botCoinFlipEnabled',
  coinfisher: 'botFisherEnabled',
  'coin-fisher': 'botFisherEnabled',
  coinmatch: 'botCoinMatchEnabled',
  'coin match': 'botCoinMatchEnabled',
  'coin-match': 'botCoinMatchEnabled'
};

function isBotAutoplayGameEnabled(gameName) {
  const normalizedName = String(gameName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const setting = BOT_AUTOPLAY_GAME_SETTINGS[normalizedName];
  return !!setting && (!window._rcBotEnabled || window._rcBotEnabled[setting] !== false);
}

function pickAndPlay() {
  if (window.gameSelectionInProgress) {
    console.log('[RC] Oyun seçimi yapılıyor, atlanıyor');
    return;
  }
  
  if (window.pickAndPlayRunning) {
    console.log('[RC] pickAndPlay çalışıyor, atlanıyor');
    return;
  }
  
  if (isOnPlayGamePage()) {
    return;
  }
  
  if (!isOnChooseGamePage()) {
    return;
  }
  
  window.pickAndPlayRunning = true;
  
  const items = Array.from(document.querySelectorAll('.choose-game-item-container, .choose-game-item, .game-item:not(.winning-game-item), div[class*="choose-game-item"]:not(.winning-game-item)'));
  if (items.length === 0) {
    window.pickAndPlayRunning = false;
    setTimeout(() => {
      if (!window.gameSelectionInProgress && window.autoPlayActive) pickAndPlay();
    }, 1500);
    return;
  }
  
  const validItems = items.filter(item => {
    const gameName = getGameName(item);
    const hasEnabledBot = isBotAutoplayGameEnabled(gameName);
    const isComingSoon = gameName.toLowerCase().includes('coming soon');
    
    const btn = item.querySelector('button, a, [class*="btn"], [role="button"]');
    const btnText = btn?.innerText || btn?.textContent || '';
    const isWait = btn && (btn.disabled || btnText.toUpperCase().includes('WAIT'));
    
    return hasEnabledBot && !isComingSoon && !isWait;
  });
  
  console.log('[RC] Bulunan:', items.length, '| Geçerli:', validItems.length);
  
  if (validItems.length === 0) {
    console.log('[RC] ⚠ No eligible games are currently available.');
    window.pickAndPlayRunning = false;
    setTimeout(() => {
      if (!window.gameSelectionInProgress && window.autoPlayActive) {
        pickAndPlay();
      }
    }, 5000);
    return;
  }
  
  if (!window.recentGames) window.recentGames = [];
  const historySize = Math.max(1, Math.floor(validItems.length / 2));
  const filteredValidItems = validItems.filter(item => {
    const name = getGameName(item);
    return !window.recentGames.includes(name);
  });
  const finalItems = filteredValidItems.length > 0 ? filteredValidItems : validItems;
  
  console.log('[RC] Son oynanlar:', window.recentGames, '| Filtrelenmiş:', filteredValidItems.length, '| Son:', finalItems.length);
  
  const selected = finalItems[Math.floor(Math.random() * finalItems.length)];
  const selectedGameName = getGameName(selected);
  window.recentGames.push(selectedGameName);
  if (window.recentGames.length > historySize) window.recentGames.shift();
  
  const btn = selected.querySelector('button, a, [class*="btn"], [role="button"]');
  const btnText = btn?.innerText || btn?.textContent || '';
  
  window.lastSelectedGame = selectedGameName;
  playSound('select');
  console.log('[RC] === SEÇİLEN OYUN:', selectedGameName, '===');
  
  if (btn && !btn.disabled) {
    window.gameSelectionInProgress = true;
    window.currentPlayingGame = selectedGameName;
    window.pendingGameClick = { name: selectedGameName };
    console.log('[RC] Butona tıklanıyor:', btnText);
    btn.click();
    const urlAtClick = window.location.href;

    // Fallback: click the game item if the URL has not changed after 1.5 seconds.
    setTimeout(() => {
      if (window.location.href === urlAtClick && window.gameSelectionInProgress) {
        console.log('[RC] İlk tıklama başarısız, item tıklanıyor...');
        try {
          selected.click();
        } catch(e) {}
      }
    }, 1500);

    window.pickAndPlayRunning = false;
    setTimeout(() => {
      if (window.location.href === urlAtClick && window.gameSelectionInProgress) {
        console.log('[RC] ⚠ Sayfa geçişi olmadı, oyun açılamadı (sayım YAPILMADI):', selectedGameName);
        // The game did not open; clear the pending selection state.
        window.pendingGameClick = null;
        window.gameSelectionInProgress = false;
        window.pickAndPlayRunning = false;
      } else {
        // The URL changed, so the game started and the transition watcher will handle it.
        window.gameSelectionInProgress = false;
      }
    }, 4000);
  } else {
    window.pickAndPlayRunning = false;
  }
}
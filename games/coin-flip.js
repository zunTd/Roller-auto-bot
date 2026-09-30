/* ══════════════════════════════════════════════════════════════════
 RC Helper — Coin Flip (Phaser internal mode)
 Interacts directly with the Phaser Input API instead of dispatching DOM events.
 ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _botActive = false;
  var _loopId    = null;
  var _pairQueue = [];
  var _isClicking = false;

  function _isGame() {
    var cur = (document.body.getAttribute('data-rc-current-game') || '').toLowerCase();
    if (cur.indexOf('coin-flip') !== -1 || cur.indexOf('coin flip') !== -1 || cur.indexOf('coinflip') !== -1) return true;
    var href = window.location.href.toLowerCase();
    var title = document.title.toLowerCase();
    if (href.indexOf('/play_game') !== -1) {
      if (title.indexOf('coin flip') !== -1 || title.indexOf('coin-flip') !== -1) return true;
    }
    return false;
  }

  function _getCanvas() {
    return document.querySelector('#phaserGame canvas') || document.querySelector('canvas');
  }

  function _findGame() {
    var canvas = _getCanvas();
    if (!canvas) return null;
    var targets = [canvas];
    var ph = document.getElementById('phaserGame');
    if (ph) targets.push(ph);

    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      var keys = Object.keys(el);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].indexOf('__reactFiber$') === 0) {
          var node = el[keys[j]];
          while (node) {
            if (node.stateNode && node.stateNode.game) return node.stateNode.game;
            node = node.return;
          }
        }
      }
    }
    return null;
  }

  function _getActiveScene(game) {
    if (!game || !game.scene || !game.scene.scenes) return null;
    for (var i = 0; i < game.scene.scenes.length; i++) {
      var s = game.scene.scenes[i];
      if (s.sys && s.sys.settings && s.sys.settings.active && s.sys.settings.key === 'Game') return s;
    }
    for (var i2 = 0; i2 < game.scene.scenes.length; i2++) {
      if (game.scene.scenes[i2].sys.settings.active) return game.scene.scenes[i2];
    }
    return null;
  }

  /* Simulate a click through Phaser Input without dispatching DOM events. */
  function _phaserInternalClick(scene, card) {
    if (!card || !card.active) return;
    var input = scene.input;
    if (!input || !input.activePointer) return;

    var pointer = input.activePointer;

    // Move the pointer to the center of the card.
    pointer.x = card.x;
    pointer.y = card.y;
    pointer.worldX = card.x;
    pointer.worldY = card.y;
    pointer.downX = card.x;
    pointer.downY = card.y;
    pointer.isDown = true;
    pointer.button = 0;

    // Notify the Phaser Input Plugin that a game object was pressed.
    input.emit('gameobjectdown', pointer, card);
    // Notify the card itself that it was pressed.
    if (card.input) {
      card.emit('pointerdown', pointer, card.x, card.y, pointer);
    }

    // Release the pointer to complete the click.
    pointer.isDown = false;
    input.emit('gameobjectup', pointer, card);
    if (card.input) {
      card.emit('pointerup', pointer, card.x, card.y, pointer);
    }
  }

  function _readCards() {
    var game = _findGame();
    if (!game) return false;
    var scene = _getActiveScene(game);
    if (!scene) return false;

    var cards = scene.cards;
    if (!cards) return false;

    var list = [];
    if (typeof cards.getChildren === 'function') list = cards.getChildren();
    else if (cards.children && cards.children.entries) list = cards.children.entries;
    else if (Array.isArray(cards)) list = cards;

    if (list.length === 0) return false;

    var map = {};
    _pairQueue = [];

    for (var i = 0; i < list.length; i++) {
      var card = list[i];
      if (!card || !card.active) continue;
      var key = card.texture ? card.texture.key : 'unknown';
      if (key === '__MISSING' || key === '') continue;

      if (!map[key]) map[key] = [];
      map[key].push(card);
    }

    for (var k in map) {
      if (map[k].length >= 2) {
        _pairQueue.push({ c1: map[k][0], c2: map[k][1] });
      }
    }

    return _pairQueue.length > 0;
  }

  function _processQueue() {
    if (!_botActive || _isClicking) return;

    // Read the cards again when the queue is empty, in case a new round started.
    if (_pairQueue.length === 0) {
      if (!_readCards()) return;
    }

    // Remove matched cards that are no longer active from the queue.
    while (_pairQueue.length > 0 && (!_pairQueue[0].c1.active || !_pairQueue[0].c2.active)) {
      _pairQueue.shift();
    }

    if (_pairQueue.length === 0) return;

    var pair = _pairQueue.shift();
    var game = _findGame();
    if (!game) return;
    var scene = _getActiveScene(game);
    if (!scene) return;

    _isClicking = true;

    // Click the first card through Phaser.
    _phaserInternalClick(scene, pair.c1);

    // Wait for the first card to turn over and the game to respond.
    setTimeout(function() {
      if (!_botActive) { _isClicking = false; return; }

      // Click the second card through Phaser.
      _phaserInternalClick(scene, pair.c2);

      // Let the match animation finish before continuing.
      setTimeout(function() {
        _isClicking = false;
      }, 1200);

    }, 800);
  }

  function _start() {
    if (_botActive) return;
    _botActive = true;
    _pairQueue = [];
    _isClicking = false;

    try { document.body.setAttribute('data-rc-bot-coinflip-active', 'true'); } catch(e) {}
    console.log('[RC-CoinFlip] ✅ Bot BAŞLADI (Phaser Internal Modu)');

    // Check the queue every 500 ms and click when idle.
    _loopId = setInterval(_processQueue, 500);
  }

  function _stop() {
    if (!_botActive) return;
    _botActive = false;
    if (_loopId) { clearInterval(_loopId); _loopId = null; }

    try { document.body.removeAttribute('data-rc-bot-coinflip-active'); } catch(e) {}
    console.log('[RC-CoinFlip] 🛑 Bot DURDURULDU');
  }

  /* Start automatically when the game is active. */
  setInterval(function () {
    var enabled = !(window._rcBotEnabled && window._rcBotEnabled['botCoinFlipEnabled'] === false);
    var active  = _isGame() && !!_getCanvas() && enabled;
    if (active  && !_botActive) _start();
    if (!active &&  _botActive) _stop();
  }, 500);

    window._rcCoinFlip = {
      start: _start,
 stop: _stop,
 isActive: function () { return _botActive; }
    };
})();

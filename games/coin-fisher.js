/*
   RC Helper - Coin Fisher bot for the RollerCoin Hamster Magnet game.
*/
(function () {
  'use strict';

  var _botActive = false;
  var _tickId = null;
  var _lastThrowTime = 0;
  var THROW_COOLDOWN_MS = 800;

  function _log() {
    if (window.console) {
      console.log.apply(console, ['[RC-CoinFisher]'].concat([].slice.call(arguments)));
    }
  }

  function _isGame() {
    var currentGame = '';
    try {
      currentGame = String(document.body.getAttribute('data-rc-current-game') || '').toLowerCase();
    } catch (e) {}
    if (currentGame.indexOf('coin fisher') !== -1 || currentGame.indexOf('coinfisher') !== -1) {
      return true;
    }

    try {
      return String(window.location.href || '').toLowerCase().indexOf('coinfisher') !== -1;
    } catch (e) {
      return false;
    }
  }

  function _findGame() {
    try {
      if (window.game && window.game.scene) return window.game;
    } catch (e) {}

    try {
      if (window.Phaser && Array.isArray(window.Phaser.GAMES)) {
        var games = window.Phaser.GAMES;
        if (games[0] && games[0].scene) return games[0];
      }
    } catch (e) {}

    try {
      var canvas = document.querySelector('#phaserGame canvas') || document.querySelector('canvas');
      if (!canvas) return null;
      var keys = Object.keys(canvas);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') !== 0) continue;
        var node = canvas[keys[i]];
        while (node) {
          if (node.stateNode && node.stateNode.game && node.stateNode.game.scene) {
            return node.stateNode.game;
          }
          node = node.return;
        }
      }
    } catch (e) {}

    return null;
  }

  function _getActiveScene(game) {
    if (!game || !game.scene || !Array.isArray(game.scene.scenes)) return null;
    return game.scene.scenes.find(function (scene) {
      return scene && scene.sys && scene.sys.settings && scene.sys.settings.active;
    }) || null;
  }

  function _getCoins(scene) {
    var children = scene && scene.children && scene.children.list;
    if (!Array.isArray(children)) return [];

    return children.filter(function (child) {
      if (!child || child.active !== true || child.visible !== true || !child.texture) return false;
      return String(child.texture.key || '').toLowerCase().indexOf('coin_') !== -1;
    });
  }

  function _throwMagnet(scene, target) {
    if (!scene || typeof scene.onPointerDown !== 'function') return;

    var now = Date.now();
    if (now - _lastThrowTime < THROW_COOLDOWN_MS) return;

    var point = target ? { x: target.x, y: target.y } : { x: 480, y: 400 };
    try {
      scene.onPointerDown(point);
      _lastThrowTime = now;
      _log('Magnet thrown:', point.x, point.y);
    } catch (e) {
      _log('onPointerDown error:', e);
    }
  }

  function _tick() {
    if (!_botActive || !_isGame()) return;

    var game = _findGame();
    var scene = _getActiveScene(game);
    if (!scene || scene.state !== 'ready') return;

    var gameHeight = game && game.config && game.config.height;
    var groundHeight = Number(scene.groudHeight);
    var maxY = gameHeight - groundHeight;
    if (!isFinite(maxY)) return;

    var coins = _getCoins(scene).filter(function (coin) {
      return typeof coin.x === 'number' && typeof coin.y === 'number' && coin.y < maxY;
    });

    if (!coins.length) {
      _throwMagnet(scene, null);
      return;
    }

    var target = coins[0];
    var bestScore = -1;
    var bestDistance = -1;
    coins.forEach(function (candidate) {
      var lineDx = candidate.x - 480;
      var lineDy = candidate.y - 700;
      var lineLength = Math.sqrt(lineDy * lineDy + lineDx * lineDx);
      if (lineLength === 0) return;

      var score = 1;
      coins.forEach(function (coin) {
        if (coin === candidate) return;
        var perpendicularDistance = Math.abs(
          lineDy * coin.x - lineDx * coin.y + candidate.x * 700 - candidate.y * 480
        ) / lineLength;
        if (perpendicularDistance <= 45) score++;
      });

      if (score > bestScore || (score === bestScore && lineLength > bestDistance)) {
        target = candidate;
        bestScore = score;
        bestDistance = lineLength;
      }
    });

    _throwMagnet(scene, target);
  }

  function _start() {
    if (_botActive) return;
    _botActive = true;
    _lastThrowTime = 0;
    try { document.body.setAttribute('data-rc-bot-fisher-active', 'true'); } catch (e) {}
    _log('Hamster Magnet bot started');
    _tickId = setInterval(_tick, 300);
    _tick();
  }

  function _stop() {
    if (!_botActive) return;
    _botActive = false;
    if (_tickId) {
      clearInterval(_tickId);
      _tickId = null;
    }
    try { document.body.removeAttribute('data-rc-bot-fisher-active'); } catch (e) {}
    _log('Hamster Magnet bot stopped');
  }

  /* Auto-start loop for navigation and the popup toggle. */
  setInterval(function () {
    var enabled = true;
    try {
      enabled = document.body.getAttribute('data-rc-bot-fisher-enabled') !== 'false';
    } catch (e) {}

    var shouldRun = _isGame() && enabled;
    if (shouldRun && !_botActive) _start();
    if (!shouldRun && _botActive) _stop();
  }, 400);

  window._rcCoinFisher = {
    start: _start,
    stop: _stop,
    isActive: function () { return _botActive; }
  };
})();

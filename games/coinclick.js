/* Coin Click bot using the fixed RGB signatures from the reference project. */
(function () {
  'use strict';

  var COIN_COLORS = [
    { name: 'eth', r: 66, g: 105, b: 207, offsetX: 5, offsetY: 10 },
    { name: 'blue', r: 0, g: null, b: 184, offsetX: 0, offsetY: 10 },
    { name: 'yellow', r: 200, g: null, b: 64, offsetX: 0, offsetY: 10 },
    { name: 'orange', r: 231, g: null, b: 32, offsetX: 0, offsetY: 10 },
    { name: 'grey', r: 230, g: null, b: 230, offsetX: 5, offsetY: 10 }
  ];
  var END_COLOR = { r: 3, g: 225, b: 228 };
  var SCAN_STEP = 5;
  var SCAN_INTERVAL_MS = 120;
  var CLICK_DEDUPE_RADIUS = 30;
  var CLICK_COOLDOWN_MS = 180;
  var MAX_CLICKS_PER_SCAN = 8;

  var _botActive = false;
  var _scanId = null;
  var _recentClicks = new Map();

  function _log() {
    if (window.console) {
      console.log.apply(console, ['[RC-CoinClick]'].concat([].slice.call(arguments)));
    }
  }

  function _isGame() {
    var currentGame = '';
    try {
      currentGame = String(document.body.getAttribute('data-rc-current-game') || '').toLowerCase();
    } catch (e) {}
    if (currentGame.indexOf('coinclick') !== -1 || currentGame.indexOf('coin click') !== -1
        || currentGame.indexOf('coin-click') !== -1) return true;

    var pageIdentity = String((document.title || '') + ' ' + (window.location.href || '')).toLowerCase();
    return pageIdentity.indexOf('coinclick') !== -1 || pageIdentity.indexOf('coin click') !== -1
      || pageIdentity.indexOf('coin-click') !== -1;
  }

  function _getCanvas() {
    var canvases = document.querySelectorAll('#phaserGame canvas, canvas');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var canvas = canvases[i];
      if (!canvas.width || !canvas.height) continue;
      var rect = canvas.getBoundingClientRect();
      var area = rect.width * rect.height;
      if (area > bestArea) {
        best = canvas;
        bestArea = area;
      }
    }
    return best;
  }

  function _matchCoin(red, green, blue) {
    if (red === END_COLOR.r && green === END_COLOR.g && blue === END_COLOR.b) {
      return { end: true };
    }
    for (var i = 0; i < COIN_COLORS.length; i++) {
      var coin = COIN_COLORS[i];
      if (red === coin.r && blue === coin.b && (coin.g === null || green === coin.g)) return coin;
    }
    return null;
  }

  function _dispatchClick(canvas, x, y) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    var clientX = rect.left + x * (rect.width / canvas.width);
    var clientY = rect.top + y * (rect.height / canvas.height);
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: clientX,
      clientY: clientY,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    };
    try { canvas.dispatchEvent(new PointerEvent('pointerdown', base)); } catch (e) {}
    try { canvas.dispatchEvent(new MouseEvent('mousedown', base)); } catch (e) {}
    base.buttons = 0;
    try { canvas.dispatchEvent(new PointerEvent('pointerup', base)); } catch (e) {}
    try { canvas.dispatchEvent(new MouseEvent('mouseup', base)); } catch (e) {}
    try { canvas.dispatchEvent(new MouseEvent('click', base)); } catch (e) {}
    return true;
  }

  function _scan() {
    if (!_botActive || !_isGame()) return;
    var canvas = _getCanvas();
    if (!canvas) return;

    try {
      var context = canvas.getContext('2d');
      if (!context) return;
      var pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      var now = Date.now();
      _recentClicks.forEach(function (lastClick, key) {
        if (now - lastClick >= CLICK_COOLDOWN_MS) _recentClicks.delete(key);
      });
      var targets = [];

      for (var y = 0; y < canvas.height && targets.length < MAX_CLICKS_PER_SCAN; y += SCAN_STEP) {
        for (var x = 0; x < canvas.width && targets.length < MAX_CLICKS_PER_SCAN; x += SCAN_STEP) {
          var index = (y * canvas.width + x) * 4;
          if (pixels[index + 3] < 200) continue;
          var match = _matchCoin(pixels[index], pixels[index + 1], pixels[index + 2]);
          if (!match) continue;
          if (match.end) {
            _log('end screen detected');
            _stop();
            return;
          }

          var targetX = Math.min(canvas.width - 1, x + match.offsetX);
          var targetY = Math.min(canvas.height - 1, y + match.offsetY);
          var duplicate = targets.some(function (target) {
            return Math.hypot(target.x - targetX, target.y - targetY) < CLICK_DEDUPE_RADIUS;
          });
          if (duplicate) continue;

          var key = Math.round(targetX / CLICK_DEDUPE_RADIUS) + ':' + Math.round(targetY / CLICK_DEDUPE_RADIUS);
          if (_recentClicks.has(key)) continue;
          targets.push({ x: targetX, y: targetY, key: key, name: match.name });
        }
      }

      targets.forEach(function (target) {
        if (_dispatchClick(canvas, target.x, target.y)) {
          _recentClicks.set(target.key, Date.now());
          _log('coin clicked:', target.name, target.x, target.y);
        }
      });
    } catch (e) {
      _log('canvas scan error:', e);
    }
  }

  function _start() {
    if (_botActive) return;
    _botActive = true;
    _recentClicks.clear();
    try { document.body.setAttribute('data-rc-bot-coinclick-active', 'true'); } catch (e) {}
    _log('Coin Click bot started');
    _scanId = setInterval(_scan, SCAN_INTERVAL_MS);
    _scan();
  }

  function _stop() {
    if (!_botActive) return;
    _botActive = false;
    if (_scanId) {
      clearInterval(_scanId);
      _scanId = null;
    }
    _recentClicks.clear();
    try { document.body.removeAttribute('data-rc-bot-coinclick-active'); } catch (e) {}
    _log('Coin Click bot stopped');
  }

  setInterval(function () {
    var enabled = true;
    try { enabled = document.body.getAttribute('data-rc-bot-coinclick-enabled') !== 'false'; } catch (e) {}
    if (_isGame() && _getCanvas() && enabled) _start();
    else if (_botActive) _stop();
  }, 400);

  window._rcCoinClick = {
    start: _start,
    stop: _stop,
    isActive: function () { return _botActive; },
    debug: function (enable) { _log('debug logging', enable === false ? 'disabled' : 'enabled'); },
    config: {
      coinColors: COIN_COLORS,
      endColor: END_COLOR,
      scanStep: SCAN_STEP,
      scanIntervalMs: SCAN_INTERVAL_MS
    }
  };
})();
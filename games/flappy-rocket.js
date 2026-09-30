/* ══════════════════════════════════════════════════════════════════
  RC Helper — Flappy Rocket flight bot (v2.5.0)
  Injected on /play_game pages; starts when the game is detected.
  Patches Phaser scene.update and uses requestAnimationFrame as a fallback.
  Tracks pipe gaps to estimate a target height and when to flap.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _botActive      = false;
  var _patchedScene   = null;
  var _originalUpdate = null;
  var _monitorId      = null;
  var _rafId          = null;

  /* State tracking. */
  var _lastFlapTime = 0;

  /* ─── Game detection ────────────────────────────────────────── */
  function _isGame() {
    var attr = (document.body.getAttribute('data-rc-current-game') || '').toLowerCase();
    if (attr.includes('rocket') || attr.includes('flappy')) return true;
    var src = (document.title + window.location.href).toLowerCase();
    return src.includes('rocket') || src.includes('flappy');
  }

  function _isOnPlayPage() {
    return window.location.href.includes('/play_game');
  }

  function _getCanvas() {
    var ph = document.getElementById('phaserGame');
    if (ph) {
      var c = ph.querySelector('canvas');
      if (c) return c;
    }
    var canvases = document.querySelectorAll('canvas');
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      if (c.width === 960 && c.height === 828) return c;
    }
    return document.querySelector('#phaserGame canvas') || document.querySelector('canvas');
  }

  /* ─── Find the Phaser game ──────────────────────────────────── */
  function _findGame() {
    var canvas = _getCanvas();
    if (!canvas) return null;

    var targets = [canvas];
    var ph = document.getElementById('phaserGame');
    if (ph) targets.push(ph);

    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      var rk = Object.keys(el).find(function (k) { return k.startsWith('__reactFiber$'); });
      if (!rk) continue;
      var node = el[rk];
      while (node) {
        if (node.stateNode && node.stateNode.game) return node.stateNode.game;
        node = node.return;
      }
    }
    return null;
  }

  function _getGameScene(game) {
    if (!game || !game.scene) return null;
    if (typeof game.scene.getScenes === 'function') {
      var actives = game.scene.getScenes(true);
      if (actives && actives.length) return actives[actives.length - 1];
    }
    var found = null;
    (game.scene.scenes || []).forEach(function (s) {
      if (s && s.sys && s.sys.settings && s.sys.settings.active &&
          s.sys.settings.key === 'Game') found = s;
    });
    return found;
  }

  /* ─── Trigger a flap ────────────────────────────────────────── */
  function _flap(scene) {
    var now = Date.now();
    if (now - _lastFlapTime < 220) return; /* Keep at least 220 ms between flaps. */
    _lastFlapTime = now;

    try {
      if (scene.player && scene.player.body && typeof scene.player.body.setVelocityY === 'function') {
        var flapForce = scene.BIRD_FLAP || 500;
        scene.player.body.setVelocityY(-flapForce);
      } else {
        var opts = { bubbles: true, cancelable: true, keyCode: 32, which: 32, key: ' ', code: 'Space' };
        window.dispatchEvent(new KeyboardEvent('keydown', opts));
        window.dispatchEvent(new KeyboardEvent('keyup',   opts));
      }
    } catch(e) {}
  }

  /* ─── Main decision loop ────────────────────────────────────── */
  function _tickFrame(scene) {
    var sceneKey = scene && scene.sys && scene.sys.settings && scene.sys.settings.key;
    if (sceneKey !== 'Game') return;

    var player = scene.player;
    if (!player || !player.active || !player.body) return;

    var targetY = 414; /* Default to the vertical center of the 828 px canvas. */
    var hasPipes = false;

    /* Analyze the nearest active pipes in pipesGroup. */
    if (scene.pipesGroup && typeof scene.pipesGroup.getChildren === 'function') {
      var activePipes = scene.pipesGroup.getChildren().filter(function (c) {
        return c && c.active && c.visible && c.x > player.x - 50;
      });

      if (activePipes.length > 0) {
        /* Group pipe segments by their X coordinate. */
        var pipesByX = {};
        activePipes.forEach(function (c) {
          var px = Math.round(c.x / 5) * 5; /* Round to the nearest 5 px. */
          if (!pipesByX[px]) pipesByX[px] = [];
          pipesByX[px].push(c);
        });

        /* Find the next pipe pair, including a 50 px overlap margin. */
        var sortedXs = Object.keys(pipesByX).map(Number).sort(function (a, b) { return a - b; });
        var closestX = sortedXs.find(function (x) { return x > player.x - 50; });
        if (closestX !== undefined) {
          hasPipes = true;
          var pair = pipesByX[closestX];
          var yTop    = null; /* originY=1 marks the lower edge of the top pipe. */
          var yBottom = null; /* originY=0 marks the upper edge of the bottom pipe. */

          pair.forEach(function (c) {
            if (c.originY === 1) yTop    = c.y;
            if (c.originY === 0) yBottom = c.y;
          });

          if (yTop !== null && yBottom !== null) {
            targetY = (yTop + yBottom) / 2; /* Center of the gap. */
          } else if (yTop    !== null) { targetY = yTop    + 120; }
            else if (yBottom !== null) { targetY = yBottom - 120; }
        }
      }
    }

    var py = player.y;
    var vy = player.body.velocity ? player.body.velocity.y : 0;

    /* Adjust the rocket angle smoothly based on its vertical velocity. */
    try {
      var smoothAngle = Math.min(20, Math.max(-20, vy * 0.05));
      if (typeof player.setAngle === 'function') player.setAngle(smoothAngle);
      else if (player.angle !== undefined) player.angle = smoothAngle;
    } catch(e) {}

     /* Flap below 460 px before pipes appear; otherwise flap below the target
       when upward velocity has slowed. */
    if (!hasPipes) {
      if (py > 460 && vy > 20) {
        _flap(scene);
      }
    } else {
      if (py > targetY + 8 && vy >= -30) {
        _flap(scene);
      }
    }
  }

  /* ─── Patch the scene ───────────────────────────────────────── */
  function _patchScene(scene) {
    if (!scene || _patchedScene === scene) return;

    if (_patchedScene && _originalUpdate) {
      try { _patchedScene.update = _originalUpdate; } catch(e) {}
    }

    _patchedScene   = scene;
    _originalUpdate = scene.update || function () {};

    scene.update = function (time, delta) {
      try { _originalUpdate.call(scene, time, delta); } catch (e) {}
      if (_botActive) _tickFrame(scene);
    };

    console.log('[RC-FlappyRocket] ✅ scene.update başarıyla yamalandı');
  }

  /* ─── Monitor ──────────────────────────────────────────────── */
  function _monitor() {
    if (!_botActive) return;

    var game = _findGame();
    if (!game) return;

    var scene = _getGameScene(game);
    if (!scene) return;

    if (_patchedScene !== scene) {
      _patchScene(scene);
    }
  }

  /* ─── Start and stop ───────────────────────────────────────── */
  function _start() {
    if (_botActive) return;
    _botActive    = true;
    _lastFlapTime = 0;

    try { document.body.setAttribute('data-rc-bot-rocket-active', 'true'); } catch (e) {}
    console.log('[RC-FlappyRocket] ✅ Bot BAŞLADI');

    _monitorId = setInterval(_monitor, 500);
    _monitor();

    /* Animation-frame loop; call _tickFrame on every frame. */
    if (_rafId) cancelAnimationFrame(_rafId);
    function _rafLoop() {
      if (!_botActive) return;
      var game  = _findGame();
      var scene = game && _getGameScene(game);
      if (scene) {
        /* Patch the scene if needed. */
        if (_patchedScene !== scene) _patchScene(scene);
        /* Also tick directly in case the scene.update patch is bypassed. */
        _tickFrame(scene);
      }
      _rafId = requestAnimationFrame(_rafLoop);
    }
    _rafId = requestAnimationFrame(_rafLoop);
  }

  function _stop() {
    if (!_botActive) return;
    _botActive = false;
    if (_monitorId) { clearInterval(_monitorId); _monitorId = null; }
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

    if (_patchedScene && _originalUpdate) {
      try { _patchedScene.update = _originalUpdate; } catch(e) {}
    }
    _patchedScene   = null;
    _originalUpdate = null;

    try { document.body.setAttribute('data-rc-bot-rocket-active', 'false'); } catch (e) {}
    console.log('[RC-FlappyRocket] ⏹ Bot DURDU');
  }

  /* ─── Automatic start and stop ──────────────────────────────── */
  setInterval(function () {
    var enabled    = document.body.getAttribute('data-rc-bot-rocket-enabled') !== 'false';
    var shouldRun  = _isOnPlayPage() && _isGame() && !!_getCanvas() && enabled;
    if (shouldRun  && !_botActive) _start();
    if (!shouldRun && _botActive)  _stop();
  }, 500);

  window._rcFlappyRocket = { start: _start, stop: _stop, isActive: function () { return _botActive; } };
})();

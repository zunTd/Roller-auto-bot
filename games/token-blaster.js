/* Token Blaster canvas detection and guarded keyboard controller. */
(function () {
  'use strict';

  var SAMPLE_WIDTH = 416;
  var SAMPLE_HEIGHT = 359;
  var REPORT_INTERVAL_MS = 1000;
  var CONTROL_SCAN_INTERVAL_MS = 100;
  var SHIP_CONFIRM_FRAMES = 2;
  var botActive = false;
  var debugEnabled = false;
  var scanTimer = null;
  var lastReportAt = 0;
  var stableShipFrames = 0;
  var movementKey = null;
  var firingKeyHeld = false;
  var previousThreats = { bullets: [], enemies: [] };
  var sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = SAMPLE_WIDTH;
  sampleCanvas.height = SAMPLE_HEIGHT;
  var sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });

  function log() {
    console.log.apply(console, ['[RC-TokenBlaster]'].concat([].slice.call(arguments)));
  }

  function isTokenBlaster() {
    var identity = String(
      (document.body && document.body.getAttribute('data-rc-current-game') || '') + ' ' +
      (document.title || '') + ' ' +
      (window.location.href || '')
    ).toLowerCase().replace(/[^a-z0-9]/g, '');
    return identity.indexOf('tokenblaster') !== -1;
  }

  function getCanvas() {
    return document.querySelector('#phaserGame canvas') || document.querySelector('canvas');
  }

  function isControlEnabled() {
    return !!(document.body && document.body.getAttribute('data-rc-bot-tokenblaster-enabled') === 'true');
  }

  function dispatchKey(key, type) {
    var keyCodes = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38 };
    var target = getCanvas() || document.body;
    if (!target) return;
    target.dispatchEvent(new KeyboardEvent(type, {
      key: key,
      code: key,
      keyCode: keyCodes[key],
      which: keyCodes[key],
      bubbles: true,
      cancelable: true
    }));
  }

  function releaseInputs() {
    if (movementKey) {
      dispatchKey(movementKey, 'keyup');
      movementKey = null;
    }
    if (firingKeyHeld) {
      firingKeyHeld = false;
      dispatchKey('ArrowUp', 'keyup');
    }
  }

  function clearThreatHistory() {
    previousThreats = { bullets: [], enemies: [] };
  }

  function stopFiring() {
    if (!firingKeyHeld) return;
    firingKeyHeld = false;
    dispatchKey('ArrowUp', 'keyup');
  }

  function setMovement(direction) {
    var nextKey = direction === 'left' ? 'ArrowLeft'
      : direction === 'right' ? 'ArrowRight' : null;
    if (nextKey === movementKey) return;
    if (movementKey) dispatchKey(movementKey, 'keyup');
    movementKey = nextKey;
    if (movementKey) dispatchKey(movementKey, 'keydown');
  }

  function setFiring(enabled) {
    if (firingKeyHeld === enabled) return;
    firingKeyHeld = enabled;
    dispatchKey('ArrowUp', enabled ? 'keydown' : 'keyup');
  }

  function chooseTarget(result) {
    var ship = result.ship;
    var canvas = result.canvas;
    var enemies = result.enemies.filter(function (enemy) {
      return enemy.y < ship.y - canvas.height * 0.06;
    });
    if (!enemies.length) return null;
    return enemies.reduce(function (best, enemy) {
      var score = Math.abs(enemy.x - ship.x) / canvas.width
        + 0.12 * (ship.y - enemy.y) / canvas.height;
      return !best || score < best.score ? { enemy: enemy, score: score } : best;
    }, null).enemy;
  }

  function findIncomingThreats(result, kind) {
    var now = performance.now();
    var width = result.canvas.width;
    var height = result.canvas.height;
    var currentObjects = result[kind];
    var previousObjects = previousThreats[kind];
    var usedPrevious = Object.create(null);
    var nextObjects = [];
    var threats = [];
    var isEnemy = kind === 'enemies';
    var minimumDownSpeed = height * (isEnemy ? 0.06 : 0.10);
    var horizon = isEnemy ? 1.2 : 1.15;
    var shipVerticalRadius = height * (isEnemy ? 0.12 : 0.04);

    currentObjects.forEach(function (object) {
      var bestIndex = -1;
      var bestDistance = Infinity;
      for (var i = 0; i < previousObjects.length; i++) {
        if (usedPrevious[i]) continue;
        var previous = previousObjects[i];
        var elapsed = (now - previous.time) / 1000;
        if (elapsed < 0.02 || elapsed > (isEnemy ? 0.25 : 0.20)) continue;
        var distance = Math.hypot(object.x - previous.x, object.y - previous.y);
        var maxDistance = Math.min(width * (isEnemy ? 0.10 : 0.16),
          Math.max(width * 0.025, elapsed * width * (isEnemy ? 0.75 : 1.5)));
        if (distance < maxDistance && distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      var velocityX = 0;
      var velocityY = 0;
      var estimatedVelocity = bestIndex === -1;
      if (estimatedVelocity) {
        var initialVerticalGap = result.ship.y - object.y;
        if (isEnemy || initialVerticalGap < height * 0.24) {
          nextObjects.push({ x: object.x, y: object.y, time: now });
          return;
        }
        velocityY = height * 0.55;
      } else {
        usedPrevious[bestIndex] = true;
        var matched = previousObjects[bestIndex];
        var deltaSeconds = (now - matched.time) / 1000;
        velocityX = (object.x - matched.x) / deltaSeconds;
        velocityY = (object.y - matched.y) / deltaSeconds;
      }
      nextObjects.push({ x: object.x, y: object.y, time: now });

      if (velocityY <= minimumDownSpeed) return;
      var verticalGap = result.ship.y - object.y;
      if (verticalGap < -shipVerticalRadius) return;
      var timeToShip = Math.max(0.04, verticalGap / velocityY);
      if (timeToShip > horizon) return;
      var predictedX = object.x + velocityX * timeToShip;
      var horizontalDistance = Math.abs(predictedX - result.ship.x);
      threats.push({
        kind: kind,
        estimatedVelocity: estimatedVelocity,
        x: object.x,
        y: object.y,
        velocityX: velocityX,
        velocityY: velocityY,
        predictedX: predictedX,
        timeToShip: timeToShip,
        horizontalDistance: horizontalDistance
      });
    });

    previousThreats[kind] = nextObjects;
    threats.sort(function (first, second) {
      return first.timeToShip - second.timeToShip;
    });
    return threats;
  }

  function scorePath(result, threats, direction) {
    var width = result.canvas.width;
    var height = result.canvas.height;
    var directionSign = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    var speedFactors = [0.75, 1, 1.25];
    var minimumClearance = 10;
    var exposure = 0;

    speedFactors.forEach(function (speedFactor) {
      var horizontalSpeed = directionSign * width * 0.55 * speedFactor;
      threats.forEach(function (threat) {
        var radiusX = width * (threat.kind === 'enemies' ? 0.083 : 0.058);
        var radiusY = height * (threat.kind === 'enemies' ? 0.105 : 0.085);
        var maxTime = Math.min(0.72, threat.timeToShip + 0.04);

        for (var step = 0; step <= 18; step++) {
          var time = step * 0.04;
          if (time > maxTime) break;
          var playerX = Math.max(width * 0.05, Math.min(width * 0.95,
            result.ship.x + horizontalSpeed * time));
          var threatTime = time + 0.06;
          var threatX = threat.x + threat.velocityX * threatTime;
          var threatY = threat.y + threat.velocityY * threatTime;
          var dx = (threatX - playerX) / radiusX;
          var dy = (threatY - result.ship.y) / radiusY;
          var clearance = dx * dx + dy * dy;
          if (clearance < minimumClearance) minimumClearance = clearance;
          exposure += Math.max(0, 1.35 - clearance);
        }
      });
    });

    return minimumClearance - 0.03 * exposure;
  }

  function chooseDodgeDirection(result, threats) {
    var stayScore = scorePath(result, threats, null);
    if (stayScore >= 1.35) return null;

    var leftScore = scorePath(result, threats, 'left');
    var rightScore = scorePath(result, threats, 'right');
    var direction = leftScore >= rightScore ? 'left' : 'right';
    var bestScore = Math.max(leftScore, rightScore);
    var currentDirection = movementKey === 'ArrowLeft' ? 'left'
      : movementKey === 'ArrowRight' ? 'right' : null;
    var currentScore = currentDirection === 'left' ? leftScore
      : currentDirection === 'right' ? rightScore : -Infinity;

    if (currentDirection && currentScore >= bestScore - 0.12) {
      direction = currentDirection;
      bestScore = currentScore;
    }

    var primaryThreat = threats[0];
    return {
      direction: direction,
      threat: primaryThreat.kind,
      impactInSeconds: primaryThreat.timeToShip,
      impactX: Math.round(primaryThreat.predictedX),
      stayScore: Number(stayScore.toFixed(2)),
      dodgeScore: Number(bestScore.toFixed(2))
    };
  }

  function control(result) {
    if (!isControlEnabled()) {
      stableShipFrames = 0;
      clearThreatHistory();
      releaseInputs();
      return { mode: 'disabled' };
    }
    if (!result || !result.ship || result.shipSource !== 'hull') {
      stableShipFrames = 0;
      clearThreatHistory();
      releaseInputs();
      return { mode: 'idle', reason: 'ship-unconfirmed' };
    }

    stableShipFrames++;
    if (stableShipFrames < SHIP_CONFIRM_FRAMES) {
      releaseInputs();
      return { mode: 'hold', reason: 'confirming-ship' };
    }

    var threats = findIncomingThreats(result, 'bullets')
      .concat(findIncomingThreats(result, 'enemies'))
      .sort(function (first, second) { return first.timeToShip - second.timeToShip; });
    var dodge = threats.length ? chooseDodgeDirection(result, threats) : null;
    if (dodge) {
      stopFiring();
      setMovement(dodge.direction);
      return {
        mode: 'dodge',
        threat: dodge.threat,
        direction: dodge.direction,
        impactInSeconds: dodge.impactInSeconds,
        impactX: dodge.impactX,
        stayScore: dodge.stayScore,
        dodgeScore: dodge.dodgeScore
      };
    }

    var target = chooseTarget(result);
    if (!target) {
      setMovement(null);
      stopFiring();
      return { mode: 'hold', reason: 'no-target' };
    }

    var horizontalOffset = target.x - result.ship.x;
    var movementTolerance = result.canvas.width * 0.018;
    var firingTolerance = result.canvas.width * 0.045;
    setMovement(Math.abs(horizontalOffset) <= movementTolerance
      ? null : horizontalOffset > 0 ? 'right' : 'left');
    if (Math.abs(horizontalOffset) <= firingTolerance) setFiring(true);
    else stopFiring();
    return {
      mode: 'target',
      direction: movementKey === 'ArrowLeft' ? 'left'
        : movementKey === 'ArrowRight' ? 'right' : null,
      firing: Math.abs(horizontalOffset) <= firingTolerance,
      targetX: Math.round(target.x)
    };
  }

  function findComponents(mask, width, height) {
    var visited = new Uint8Array(mask.length);
    var components = [];

    for (var startIndex = 0; startIndex < mask.length; startIndex++) {
      if (!mask[startIndex] || visited[startIndex]) continue;
      var queue = [startIndex];
      var cursor = 0;
      var minX = width;
      var minY = height;
      var maxX = -1;
      var maxY = -1;
      var area = 0;
      visited[startIndex] = 1;

      while (cursor < queue.length) {
        var currentIndex = queue[cursor++];
        var pixelX = currentIndex % width;
        var pixelY = Math.floor(currentIndex / width);
        area++;
        if (pixelX < minX) minX = pixelX;
        if (pixelX > maxX) maxX = pixelX;
        if (pixelY < minY) minY = pixelY;
        if (pixelY > maxY) maxY = pixelY;

        for (var offsetY = -1; offsetY <= 1; offsetY++) {
          for (var offsetX = -1; offsetX <= 1; offsetX++) {
            if (offsetX === 0 && offsetY === 0) continue;
            var neighborX = pixelX + offsetX;
            var neighborY = pixelY + offsetY;
            if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
            var neighborIndex = neighborY * width + neighborX;
            if (mask[neighborIndex] && !visited[neighborIndex]) {
              visited[neighborIndex] = 1;
              queue.push(neighborIndex);
            }
          }
        }
      }

      components.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area: area
      });
    }

    return components;
  }

  function makeMasks(pixels, width, height) {
    var count = width * height;
    var masks = {
      orange: new Uint8Array(count),
      green: new Uint8Array(count),
      yellow: new Uint8Array(count),
      pale: new Uint8Array(count),
      exhaust: new Uint8Array(count),
      hull: new Uint8Array(count),
      cockpit: new Uint8Array(count)
    };

    for (var pixelY = 0; pixelY < height; pixelY++) {
      for (var pixelX = 0; pixelX < width; pixelX++) {
        var index = (pixelY * width + pixelX) * 4;
        var red = pixels[index];
        var green = pixels[index + 1];
        var blue = pixels[index + 2];
        var maskIndex = pixelY * width + pixelX;
        var lowerBoard = pixelY >= height * 0.65;
        var orange = red > 100 && red > green + 18 && red > blue + 25
          && green > 35 && red - green > (green - blue) * 1.2;
        var vividGreen = green > 85 && green > red + 9 && green > blue + 12;

        masks.orange[maskIndex] = orange ? 1 : 0;
        masks.green[maskIndex] = vividGreen ? 1 : 0;
        masks.yellow[maskIndex] = red > 115 && green > 105 && green > blue + 25
          && red > green + 5 && red < green + 80 ? 1 : 0;
        masks.pale[maskIndex] = pixelY >= height * 0.18 && red > 105 && green > 105
          && blue > 100 && Math.abs(red - green) < 25
          && blue > red - 15 && blue < red + 80 ? 1 : 0;
        masks.exhaust[maskIndex] = lowerBoard && blue > 110 && blue > red + 18
          && green > red + 5 && green > 95 ? 1 : 0;
        masks.hull[maskIndex] = lowerBoard && red > 65 && red < 205 && green > 65
          && blue > 65 && Math.abs(red - green) < 25 && Math.abs(green - blue) < 22 ? 1 : 0;
        masks.cockpit[maskIndex] = blue > green + 22 && blue > red + 25 && blue > 100 ? 1 : 0;
      }
    }

    return masks;
  }

  function dilateMask(mask, width, height, radius) {
    var expanded = new Uint8Array(mask.length);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;
        var left = Math.max(0, x - radius);
        var right = Math.min(width - 1, x + radius);
        var top = Math.max(0, y - radius);
        var bottom = Math.min(height - 1, y + radius);
        for (var expandedY = top; expandedY <= bottom; expandedY++) {
          var rowStart = expandedY * width;
          expanded.fill(1, rowStart + left, rowStart + right + 1);
        }
      }
    }
    return expanded;
  }

  function detect(canvas) {
    if (!canvas || !canvas.width || !canvas.height || !sampleContext) return null;

    sampleContext.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    sampleContext.drawImage(canvas, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    var image = sampleContext.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    var masks = makeMasks(image.data, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    var minimumArea = SAMPLE_WIDTH * SAMPLE_HEIGHT * 0.0002;
    var rawHulls = findComponents(masks.hull, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    var joinedHulls = findComponents(
      dilateMask(masks.hull, SAMPLE_WIDTH, SAMPLE_HEIGHT, 2),
      SAMPLE_WIDTH,
      SAMPLE_HEIGHT
    );
    var hullShapes = joinedHulls.filter(function (item) {
      if (item.width < SAMPLE_WIDTH * 0.04 || item.width > SAMPLE_WIDTH * 0.12
          || item.height < SAMPLE_HEIGHT * 0.065 || item.height > SAMPLE_HEIGHT * 0.25
          || item.width / item.height < 0.35 || item.width / item.height > 1.1
          || item.area < SAMPLE_WIDTH * SAMPLE_HEIGHT * 0.0015) return false;
      return true;
    });
    var hulls = hullShapes.filter(function (item) {
      for (var pixelY = item.y; pixelY < item.y + item.height; pixelY++) {
        for (var pixelX = item.x; pixelX < item.x + item.width; pixelX++) {
          if (masks.cockpit[pixelY * SAMPLE_WIDTH + pixelX]) return true;
        }
      }
      return false;
    });

    var ship = null;
    var shipSource = null;
    var rawExhausts = [];
    var exhausts = [];
    if (hulls.length === 1) {
      var hull = hulls[0];
      ship = {
        x: (hull.x + hull.width / 2) * canvas.width / SAMPLE_WIDTH,
        y: (hull.y + hull.height * 0.65) * canvas.height / SAMPLE_HEIGHT
      };
      shipSource = 'hull';
    } else {
      rawExhausts = findComponents(masks.exhaust, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      exhausts = rawExhausts.filter(function (item) {
        return item.width > SAMPLE_WIDTH * 0.015 && item.width < SAMPLE_WIDTH * 0.10
          && item.height > SAMPLE_HEIGHT * 0.01 && item.height < SAMPLE_HEIGHT * 0.15
          && item.area > SAMPLE_WIDTH * SAMPLE_HEIGHT * 0.00015;
      });
      if (exhausts.length === 1) {
        var exhaust = exhausts[0];
        ship = {
          x: (exhaust.x + exhaust.width / 2) * canvas.width / SAMPLE_WIDTH,
          y: (exhaust.y + exhaust.height / 2 - SAMPLE_HEIGHT * 0.075) * canvas.height / SAMPLE_HEIGHT
        };
        shipSource = 'exhaust';
      }
    }

    var enemies = [];
    [masks.orange, masks.green].forEach(function (mask, colorIndex) {
      findComponents(mask, SAMPLE_WIDTH, SAMPLE_HEIGHT).forEach(function (item) {
        if (item.width <= SAMPLE_WIDTH * 0.025 || item.width >= SAMPLE_WIDTH * 0.12
            || item.height <= SAMPLE_HEIGHT * 0.025 || item.height >= SAMPLE_HEIGHT * 0.13
            || item.area <= minimumArea) return;
        var centerX = item.x + item.width / 2;
        var centerY = item.y + item.height / 2;
        var greenPixels = 0;
        for (var pixelY = item.y; pixelY < item.y + item.height; pixelY++) {
          for (var pixelX = item.x; pixelX < item.x + item.width; pixelX++) {
            if (masks.green[pixelY * SAMPLE_WIDTH + pixelX]) greenPixels++;
          }
        }
        var vividGreen = colorIndex === 1 || greenPixels > item.area * 0.15;
        if (colorIndex === 0 || vividGreen || !ship
            || Math.abs(centerX - ship.x * SAMPLE_WIDTH / canvas.width) > SAMPLE_WIDTH * 0.055
            || Math.abs(centerY - ship.y * SAMPLE_HEIGHT / canvas.height) > SAMPLE_HEIGHT * 0.10) {
          enemies.push({
            x: centerX * canvas.width / SAMPLE_WIDTH,
            y: centerY * canvas.height / SAMPLE_HEIGHT,
            color: colorIndex === 0 ? 'orange' : 'green'
          });
        }
      });
    });

    var bullets = findComponents(
      masks.yellow.map(function (value, index) { return value || masks.pale[index] ? 1 : 0; }),
      SAMPLE_WIDTH,
      SAMPLE_HEIGHT
    ).filter(function (item) {
      return item.width >= 3 && item.width < SAMPLE_WIDTH * 0.035
        && item.height >= 3 && item.height < SAMPLE_HEIGHT * 0.05
        && item.area >= 8 && item.width / item.height >= 0.55
        && item.width / item.height <= 1.8;
    }).map(function (item) {
      return {
        x: (item.x + item.width / 2) * canvas.width / SAMPLE_WIDTH,
        y: (item.y + item.height / 2) * canvas.height / SAMPLE_HEIGHT
      };
    });

    return {
      canvas: { width: canvas.width, height: canvas.height },
      ship: ship,
      enemies: enemies,
      bullets: bullets,
      shipSource: shipSource,
      shipCandidates: {
        hullComponents: rawHulls.length,
        joinedHullComponents: joinedHulls.length,
        hullShapeCandidates: hullShapes,
        hullWithCockpit: hulls,
        exhaustComponents: rawExhausts.length,
        validExhausts: exhausts
      }
    };
  }

  function scan() {
    if (!botActive) return null;
    if (!isTokenBlaster() || !isControlEnabled()) {
      stableShipFrames = 0;
      clearThreatHistory();
      releaseInputs();
      return null;
    }
    var canvas = getCanvas();
    if (!canvas) {
      stableShipFrames = 0;
      clearThreatHistory();
      releaseInputs();
      return null;
    }

    try {
      var result = detect(canvas);
      var action = control(result);
      var now = Date.now();
      if (debugEnabled && result && now - lastReportAt >= REPORT_INTERVAL_MS) {
        lastReportAt = now;
        log('detection', result, 'action', action);
      }
      return result;
    } catch (error) {
      stableShipFrames = 0;
      clearThreatHistory();
      releaseInputs();
      log('canvas scan error:', error && error.message || error);
      return null;
    }
  }

  function start() {
    if (botActive || !isControlEnabled()) return;
    botActive = true;
    stableShipFrames = 0;
    clearThreatHistory();
    document.body.setAttribute('data-rc-bot-tokenblaster-active', 'true');
    log('controller started');
    scanTimer = setInterval(scan, CONTROL_SCAN_INTERVAL_MS);
    scan();
  }

  function stop() {
    if (scanTimer !== null) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    releaseInputs();
    botActive = false;
    stableShipFrames = 0;
    clearThreatHistory();
    if (document.body) document.body.setAttribute('data-rc-bot-tokenblaster-active', 'false');
    log('controller stopped');
  }

  function debug(enable) {
    debugEnabled = enable !== false;
    lastReportAt = 0;
    log('debug logging', debugEnabled ? 'ENABLED' : 'disabled');
    if (debugEnabled) scan();
  }

  window._rcTokenBlaster = {
    start: start,
    stop: stop,
    isActive: function () { return botActive; },
    debug: debug,
    inspect: function () { return detect(getCanvas()); }
  };

  setInterval(function () {
    if (isTokenBlaster() && isControlEnabled()) {
      if (!botActive) start();
    } else if (botActive) {
      stop();
    }
  }, 500);
})();

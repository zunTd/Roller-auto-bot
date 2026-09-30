/*
   RC Helper - Coin Match pixel-scan match-3 bot.
   window._rcCoinMatch -> { start, stop, isActive, debug, config }
*/
(function () {
  'use strict';

  var config = {
    SCAN_STEP: 4,
    CLUSTER_DISTANCE: 26,
    MIN_CLUSTER_PIXELS: 12,
    GRID_COORD_TOLERANCE: 22,
    COLOR_SAMPLE_RADIUS_RATIO: 0.43,
    COLOR_SAMPLE_STEP: 2,
    COIN_COLOR_DISTANCE: 65,
    BLUE_GRAY_COLOR_DISTANCE: 25,
    COIN_COLOR_MIN_COVERAGE: 0.20,
    COIN_COLOR_MIN_PURITY: 0.85,
    BLUE_GRAY_MIN_COVERAGE: 0.12,
    BLUE_GRAY_MIN_PURITY: 0.65,
    COIN_COLORS: [
      { name: 'BTC', r: 236, g: 154, b: 67 },
      { name: 'DOGE', r: 200, g: 168, b: 62 },
      { name: 'ETH', r: 91, g: 128, b: 231 },
      { name: 'DASH', r: 0, g: 116, b: 184 },
      { name: 'XMR', r: 236, g: 150, b: 0 },
      { name: 'BLUE_GRAY', r: 32, g: 148, b: 211 },
      { name: 'YELLOW_SYMBOL', r: 255, g: 213, b: 17 }
    ],
    GRID_COLS: 8,
    GRID_ROWS: 8,
    CELL_SIZE: 80,
    GRID_OFFSET_X: 160,
    GRID_OFFSET_Y: 32,
    SWAP_COOLDOWN_MS: 700,
    SWAP_STABLE_FRAMES: 3,
    SWAP_MAX_CONFIRMATION_FRAMES: 6,
    FAILED_MOVE_BLOCK_MS: 5000,
    CALIBRATION_INTERVAL_MS: 30000,
    CALIBRATION_FAILURE_WINDOW: 10,
    CALIBRATION_FAILURE_RATE: 0.4,
    CALIBRATION_MIN_COL_CENTERS: 8,
    CALIBRATION_MIN_ROW_CENTERS: 6,
    CALIBRATION_SCAN_STEP: 12,
    SCAN_INTERVAL_MS: 200,
    DEBUG_LOG_INTERVAL_MS: 2000,
    BG_BRIGHTNESS_MAX: 90
  };

  var _botActive = false;
  var _scanId = null;
  var _nextSwapTime = 0;
  var _debugEnabled = false;
  var _lastDebugLog = 0;
  var _pendingSwap = null;
  var _lastCalibrationAt = 0;
  var _recentSwapFailures = [];
  var _blockedMove = null;

  function _log() {
    if (window.console) {
      console.log.apply(console, ['[RC-CoinMatch]'].concat([].slice.call(arguments)));
    }
  }

  function _isDebugEnabled() {
    if (_debugEnabled) return true;
    try {
      return document.body && document.body.getAttribute('data-rc-coinmatch-debug') === 'true';
    } catch (e) {
      return false;
    }
  }

  function _isGame() {
    try {
      var currentGame = String(
        document.body && document.body.getAttribute('data-rc-current-game') || ''
      ).toLowerCase();
      if (/coin[-_]?match|coinmatch/.test(currentGame)) return true;
      return /coin[-_]?match|coinmatch/.test(String(window.location.href || '').toLowerCase());
    } catch (e) {
      return false;
    }
  }

  function _getCanvas() {
    var canvas = document.querySelector('#phaserGame canvas') || document.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    return canvas;
  }

  function _classifyPixels(data, width, height, scanStep) {
    var candidates = [];
    var step = scanStep || config.SCAN_STEP;
    var x;
    var y;

    for (y = 0; y < height; y += step) {
      for (x = 0; x < width; x += step) {
        var index = (y * width + x) * 4;
        if (data[index + 3] < 200) continue;

        var red = data[index];
        var green = data[index + 1];
        var blue = data[index + 2];
        var brightness = (red + green + blue) / 3;
        if (brightness > config.BG_BRIGHTNESS_MAX) {
          candidates.push({ x: x, y: y, r: red, g: green, b: blue });
        }
      }
    }

    return candidates;
  }

  function _findClusters(points) {
    var distanceSquared = config.CLUSTER_DISTANCE * config.CLUSTER_DISTANCE;
    var parent = [];
    var size = [];
    var grid = Object.create(null);
    var i;

    function find(index) {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    }

    function union(first, second) {
      var firstRoot = find(first);
      var secondRoot = find(second);
      if (firstRoot === secondRoot) return;
      if (size[firstRoot] < size[secondRoot]) {
        var temp = firstRoot;
        firstRoot = secondRoot;
        secondRoot = temp;
      }
      parent[secondRoot] = firstRoot;
      size[firstRoot] += size[secondRoot];
    }

    for (i = 0; i < points.length; i++) {
      var point = points[i];
      parent[i] = i;
      size[i] = 1;
      var cellX = Math.floor(point.x / config.CLUSTER_DISTANCE);
      var cellY = Math.floor(point.y / config.CLUSTER_DISTANCE);
      var cellKey = cellX + ':' + cellY;
      if (!grid[cellKey]) grid[cellKey] = [];

      for (var offsetY = -1; offsetY <= 1; offsetY++) {
        for (var offsetX = -1; offsetX <= 1; offsetX++) {
          var neighbors = grid[(cellX + offsetX) + ':' + (cellY + offsetY)];
          if (!neighbors) continue;
          for (var neighborIndex = 0; neighborIndex < neighbors.length; neighborIndex++) {
            var otherIndex = neighbors[neighborIndex];
            var other = points[otherIndex];
            var dx = point.x - other.x;
            var dy = point.y - other.y;
            if (dx * dx + dy * dy < distanceSquared) union(i, otherIndex);
          }
        }
      }
      grid[cellKey].push(i);
    }

    var groups = Object.create(null);
    for (i = 0; i < points.length; i++) {
      var root = find(i);
      if (!groups[root]) groups[root] = [];
      groups[root].push(points[i]);
    }

    return Object.keys(groups).map(function (key) {
      var group = groups[key];
      if (group.length < config.MIN_CLUSTER_PIXELS) return null;
      var totalX = 0;
      var totalY = 0;
      var totalRed = 0;
      var totalGreen = 0;
      var totalBlue = 0;
      group.forEach(function (item) {
        totalX += item.x;
        totalY += item.y;
        totalRed += item.r;
        totalGreen += item.g;
        totalBlue += item.b;
      });
      return {
        x: totalX / group.length,
        y: totalY / group.length,
        size: group.length,
        avgColor: {
          r: totalRed / group.length,
          g: totalGreen / group.length,
          b: totalBlue / group.length
        }
      };
    }).filter(Boolean);
  }

  function _groupCoordinates(values) {
    var groups = [];
    values.slice().sort(function (first, second) { return first - second; }).forEach(function (value) {
      var group = groups[groups.length - 1];
      if (!group || value - group.last > config.GRID_COORD_TOLERANCE) {
        groups.push({ values: [value], last: value });
      } else {
        group.values.push(value);
        group.last = value;
      }
    });
    return groups.map(function (group) {
      return group.values.reduce(function (sum, value) { return sum + value; }, 0) / group.values.length;
    });
  }

  function _sampleCellColor(data, width, height, center) {
    var radius = Math.round(config.CELL_SIZE * config.COLOR_SAMPLE_RADIUS_RATIO);
    var step = config.COLOR_SAMPLE_STEP;
    var minX = Math.max(0, Math.floor(center.x - radius));
    var maxX = Math.min(width - 1, Math.ceil(center.x + radius));
    var minY = Math.max(0, Math.floor(center.y - radius));
    var maxY = Math.min(height - 1, Math.ceil(center.y + radius));
    var red = 0;
    var green = 0;
    var blue = 0;
    var sampleCount = 0;
    var colorCounts = config.COIN_COLORS.map(function () { return 0; });

    for (var y = minY; y <= maxY; y += step) {
      for (var x = minX; x <= maxX; x += step) {
        var index = (y * width + x) * 4;
        if (data[index + 3] < 200) continue;
        var pixelRed = data[index];
        var pixelGreen = data[index + 1];
        var pixelBlue = data[index + 2];
        red += pixelRed;
        green += pixelGreen;
        blue += pixelBlue;
        sampleCount++;

        var bestIndex = -1;
        var bestDistance = Infinity;
        config.COIN_COLORS.forEach(function (prototype, prototypeIndex) {
          var distance = Math.abs(pixelRed - prototype.r)
            + Math.abs(pixelGreen - prototype.g)
            + Math.abs(pixelBlue - prototype.b);
          var maxDistance = prototype.name === 'BLUE_GRAY'
            ? config.BLUE_GRAY_COLOR_DISTANCE : config.COIN_COLOR_DISTANCE;
          if (distance <= maxDistance && distance < bestDistance) {
            bestIndex = prototypeIndex;
            bestDistance = distance;
          }
        });
        if (bestIndex !== -1) colorCounts[bestIndex]++;
      }
    }

    var winnerIndex = -1;
    var winnerCount = 0;
    var recognizedCount = 0;
    colorCounts.forEach(function (count, index) {
      recognizedCount += count;
      if (count > winnerCount) {
        winnerIndex = index;
        winnerCount = count;
      }
    });

    var typeId = null;
    var typeName = null;
    var coverage = sampleCount ? winnerCount / sampleCount : 0;
    var purity = recognizedCount ? winnerCount / recognizedCount : 0;
    if (winnerIndex !== -1) {
      var winner = config.COIN_COLORS[winnerIndex];
      var minCoverage = winner.name === 'BLUE_GRAY'
        ? config.BLUE_GRAY_MIN_COVERAGE : config.COIN_COLOR_MIN_COVERAGE;
      var minPurity = winner.name === 'BLUE_GRAY'
        ? config.BLUE_GRAY_MIN_PURITY : config.COIN_COLOR_MIN_PURITY;
      if (winner.name === 'XMR' || winner.name === 'YELLOW_SYMBOL') minPurity = 0.80;
      if (coverage >= minCoverage && purity >= minPurity) {
        typeId = winnerIndex;
        typeName = winner.name;
      }
    }

    return {
      r: sampleCount ? red / sampleCount : 0,
      g: sampleCount ? green / sampleCount : 0,
      b: sampleCount ? blue / sampleCount : 0,
      typeId: typeId,
      typeName: typeName,
      coverage: coverage,
      purity: purity
    };
  }

  function _assignTypes(cells) {
    var assignedTypes = Object.create(null);
    cells.forEach(function (cell) {
      cell.typeId = cell.color.typeId;
      cell.typeName = cell.color.typeName;
      if (cell.typeName !== null) assignedTypes[cell.typeName] = true;
    });
    return Object.keys(assignedTypes).length;
  }

  function _buildFixedGrid(data, width, height) {
    var rows = config.GRID_ROWS;
    var columns = config.GRID_COLS;
    var xCenters = [];
    var yCenters = [];
    var grid = [];
    var cells = [];

    for (var column = 0; column < columns; column++) {
      xCenters.push(config.GRID_OFFSET_X + column * config.CELL_SIZE + config.CELL_SIZE / 2);
    }
    for (var row = 0; row < rows; row++) {
      yCenters.push(config.GRID_OFFSET_Y + row * config.CELL_SIZE + config.CELL_SIZE / 2);
      grid[row] = [];
      for (column = 0; column < columns; column++) {
        var cell = {
          x: xCenters[column],
          y: yCenters[row],
          color: _sampleCellColor(data, width, height, {
            x: xCenters[column],
            y: yCenters[row]
          }),
          typeId: null,
          typeName: null
        };
        grid[row][column] = cell;
        cells.push(cell);
      }
    }

    _assignTypes(cells);
    return {
      rows: rows,
      columns: columns,
      xCenters: xCenters,
      yCenters: yCenters,
      spacingX: config.CELL_SIZE,
      spacingY: config.CELL_SIZE,
      cells: grid
    };
  }

  function _median(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (first, second) { return first - second; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function _estimateSpacing(values, currentSpacing) {
    var spacings = [];
    values.slice().sort(function (first, second) { return first - second; }).forEach(function (value, index, sorted) {
      if (index) {
        var spacing = value - sorted[index - 1];
        if (spacing >= currentSpacing * 0.65 && spacing <= currentSpacing * 1.35) {
          spacings.push(spacing);
        }
      }
    });
    return spacings.length ? _median(spacings) : currentSpacing;
  }

  function _calibrateGrid(canvas, forceLog) {
    if (!canvas) return false;
    _lastCalibrationAt = Date.now();
    try {
      var context = canvas.getContext('2d');
      if (!context) return false;
      var imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      var candidates = _classifyPixels(
        imageData.data,
        canvas.width,
        canvas.height,
        config.CALIBRATION_SCAN_STEP
      );
      var clusters = _findClusters(candidates);
      if (clusters.length < 6) return false;

      var xValues = _groupCoordinates(clusters.map(function (cluster) { return cluster.x; }));
      var yValues = _groupCoordinates(clusters.map(function (cluster) { return cluster.y; }));
        if (xValues.length < config.CALIBRATION_MIN_COL_CENTERS ||
          yValues.length < config.CALIBRATION_MIN_ROW_CENTERS) return false;

      var spacingX = _estimateSpacing(xValues, config.CELL_SIZE);
      var spacingY = _estimateSpacing(yValues, config.CELL_SIZE);
      var xOffsets = [];
      var yOffsets = [];

      xValues.forEach(function (value) {
        var column = Math.round((value - config.GRID_OFFSET_X - spacingX / 2) / spacingX);
        if (column >= 0 && column < config.GRID_COLS) {
          xOffsets.push(value - column * spacingX - spacingX / 2);
        }
      });
      yValues.forEach(function (value) {
        var row = Math.round((value - config.GRID_OFFSET_Y - spacingY / 2) / spacingY);
        if (row >= 0 && row < config.GRID_ROWS) {
          yOffsets.push(value - row * spacingY - spacingY / 2);
        }
      });

      if (!xOffsets.length || !yOffsets.length) return false;
      config.CELL_SIZE = (spacingX + spacingY) / 2;
      config.GRID_OFFSET_X = _median(xOffsets);
      config.GRID_OFFSET_Y = _median(yOffsets);
      _lastCalibrationAt = Date.now();

      if (forceLog || _isDebugEnabled()) {
        _log('grid calibration: CELL_SIZE=' + config.CELL_SIZE.toFixed(2) +
          ' OFFSET=(' + config.GRID_OFFSET_X.toFixed(2) + ',' +
          config.GRID_OFFSET_Y.toFixed(2) + ') clusters=' + clusters.length);
      }
      return true;
    } catch (e) {
      _log('grid calibration error:', e);
      return false;
    }
  }

  function _recordSwapResult(success) {
    _recentSwapFailures.push(success ? 0 : 1);
    if (_recentSwapFailures.length > config.CALIBRATION_FAILURE_WINDOW) {
      _recentSwapFailures.shift();
    }
  }

  function _shouldRecalibrate() {
    var now = Date.now();
    if (now - _lastCalibrationAt >= config.CALIBRATION_INTERVAL_MS) return true;
    if (_recentSwapFailures.length < config.CALIBRATION_FAILURE_WINDOW) return false;
    var failures = _recentSwapFailures.reduce(function (sum, value) { return sum + value; }, 0);
    return failures / _recentSwapFailures.length > config.CALIBRATION_FAILURE_RATE;
  }

  function _readGameProgress() {
    var result = {};
    var selectors = [
      '[id*="score" i]', '[class*="score" i]', '[data-score]',
      '[id*="count" i]', '[class*="count" i]', '[data-count]'
    ];
    try {
      document.querySelectorAll(selectors.join(',')).forEach(function (element) {
        var text = element.getAttribute('data-score') || element.getAttribute('data-count') ||
          element.innerText || element.textContent || '';
        var match = String(text).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        if (!match) return;
        var label = (element.id + ' ' + element.className).toLowerCase();
        if (label.indexOf('score') !== -1 && result.score === undefined) result.score = Number(match[0]);
        if (label.indexOf('count') !== -1 && result.count === undefined) result.count = Number(match[0]);
      });
    } catch (e) {}
    return Object.keys(result).length ? result : null;
  }

  function _progressConfirms(before, after) {
    if (!before || !after) return false;
    if (before.score !== undefined && after.score !== undefined && after.score > before.score) return true;
    return before.count !== undefined && after.count !== undefined && after.count !== before.count;
  }

  function _swapPositionsChanged(beforeGrid, currentGrid, move) {
    if (!beforeGrid || !currentGrid || !move) return false;
    var beforeFrom = beforeGrid.cells[move.from.row][move.from.column];
    var beforeTo = beforeGrid.cells[move.to.row][move.to.column];
    var currentFrom = currentGrid.cells[move.from.row][move.from.column];
    var currentTo = currentGrid.cells[move.to.row][move.to.column];
    return !!(beforeFrom && beforeTo && currentFrom && currentTo &&
      (beforeFrom.typeId !== currentFrom.typeId || beforeTo.typeId !== currentTo.typeId));
  }

  function _moveKey(move) {
    return move.from.row + ',' + move.from.column + '>' + move.to.row + ',' + move.to.column;
  }

  function _availableMoves(moves, signature) {
    if (!_blockedMove || _blockedMove.signature !== signature || Date.now() >= _blockedMove.until) {
      if (_blockedMove && (_blockedMove.signature !== signature || Date.now() >= _blockedMove.until)) {
        _blockedMove = null;
      }
      return moves;
    }
    return moves.filter(function (move) {
      return _moveKey(move) !== _blockedMove.key;
    });
  }

  function _hasMatchAt(grid, rows, columns, row, column) {
    var cell = grid[row] && grid[row][column];
    if (!cell || cell.typeId === null) return false;
    var type = cell.typeId;
    var horizontal = 1;
    var vertical = 1;
    for (var left = column - 1; left >= 0 && grid[row][left] && grid[row][left].typeId === type; left--) horizontal++;
    for (var right = column + 1; right < columns && grid[row][right] && grid[row][right].typeId === type; right++) horizontal++;
    for (var up = row - 1; up >= 0 && grid[up][column] && grid[up][column].typeId === type; up--) vertical++;
    for (var down = row + 1; down < rows && grid[down][column] && grid[down][column].typeId === type; down++) vertical++;
    return horizontal >= 3 || vertical >= 3;
  }

  function _collectMatchedCells(grid, rows, columns) {
    var matched = Object.create(null);
    function mark(row, column) {
      matched[row + ',' + column] = true;
    }

    for (var row = 0; row < rows; row++) {
      var column = 0;
      while (column < columns) {
        var cell = grid[row][column];
        var typeId = cell && cell.typeId;
        if (typeId === null || typeId === undefined) {
          column++;
          continue;
        }
        var end = column + 1;
        while (end < columns && grid[row][end] && grid[row][end].typeId === typeId) end++;
        if (end - column >= 3) {
          for (var matchColumn = column; matchColumn < end; matchColumn++) mark(row, matchColumn);
        }
        column = end;
      }
    }

    for (var columnIndex = 0; columnIndex < columns; columnIndex++) {
      var rowIndex = 0;
      while (rowIndex < rows) {
        var verticalCell = grid[rowIndex][columnIndex];
        var verticalType = verticalCell && verticalCell.typeId;
        if (verticalType === null || verticalType === undefined) {
          rowIndex++;
          continue;
        }
        var verticalEnd = rowIndex + 1;
        while (verticalEnd < rows && grid[verticalEnd][columnIndex]
            && grid[verticalEnd][columnIndex].typeId === verticalType) verticalEnd++;
        if (verticalEnd - rowIndex >= 3) {
          for (var matchRow = rowIndex; matchRow < verticalEnd; matchRow++) mark(matchRow, columnIndex);
        }
        rowIndex = verticalEnd;
      }
    }

    return matched;
  }

  function _findMoves(gridData) {
    var moves = [];
    var grid = gridData.cells;
    if (Object.keys(_collectMatchedCells(grid, gridData.rows, gridData.columns)).length) return moves;
    for (var row = 0; row < gridData.rows; row++) {
      for (var column = 0; column < gridData.columns; column++) {
        var source = grid[row][column];
        if (!source || source.typeId === null) continue;
        [[0, 1], [1, 0]].forEach(function (direction) {
          var targetRow = row + direction[0];
          var targetColumn = column + direction[1];
          if (targetRow >= gridData.rows || targetColumn >= gridData.columns || !grid[targetRow][targetColumn]) return;
          var target = grid[targetRow][targetColumn];
          if (target.typeId === null || source.typeId === target.typeId) return;
          grid[row][column] = target;
          grid[targetRow][targetColumn] = source;
          var valid = _hasMatchAt(grid, gridData.rows, gridData.columns, row, column) ||
            _hasMatchAt(grid, gridData.rows, gridData.columns, targetRow, targetColumn);
          var matched = valid ? _collectMatchedCells(grid, gridData.rows, gridData.columns) : null;
          grid[row][column] = source;
          grid[targetRow][targetColumn] = target;
          var score = matched ? Object.keys(matched).length : 0;
          if (score > 0 && (matched[row + ',' + column] || matched[targetRow + ',' + targetColumn])) {
            moves.push({
              from: { row: row, column: column, x: source.x, y: source.y },
              to: { row: targetRow, column: targetColumn, x: target.x, y: target.y },
              score: score
            });
          }
        });
      }
    }
    return moves.sort(function (first, second) { return second.score - first.score; });
  }

  function _gridSignature(gridData) {
    if (!gridData) return '';
    return gridData.cells.map(function (row) {
      return row.map(function (cell) {
        return cell && cell.typeId !== null ? cell.typeId : '-';
      }).join(',');
    }).join('|');
  }

  function _screenPoint(canvas, point) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + point.x * (rect.width / canvas.width),
      y: rect.top + point.y * (rect.height / canvas.height)
    };
  }

  function _eventOptions(base, x, y, buttons) {
    var options = {};
    for (var key in base) options[key] = base[key];
    options.clientX = x;
    options.clientY = y;
    if (typeof buttons === 'number') options.buttons = buttons;
    return options;
  }

  function _dispatchDrag(canvas, from, to) {
    var start = _screenPoint(canvas, from);
    var end = _screenPoint(canvas, to);
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    };
    var steps = 3;
    try { canvas.dispatchEvent(new PointerEvent('pointerdown', _eventOptions(base, start.x, start.y))); } catch (e) {}
    try { canvas.dispatchEvent(new MouseEvent('mousedown', _eventOptions(base, start.x, start.y))); } catch (e) {}
    for (var step = 1; step <= steps; step++) {
      var ratio = step / steps;
      var x = start.x + (end.x - start.x) * ratio;
      var y = start.y + (end.y - start.y) * ratio;
      try { canvas.dispatchEvent(new PointerEvent('pointermove', _eventOptions(base, x, y))); } catch (e) {}
      try { canvas.dispatchEvent(new MouseEvent('mousemove', _eventOptions(base, x, y))); } catch (e) {}
    }
    try { canvas.dispatchEvent(new PointerEvent('pointerup', _eventOptions(base, end.x, end.y, 0))); } catch (e) {}
    try { canvas.dispatchEvent(new MouseEvent('mouseup', _eventOptions(base, end.x, end.y, 0))); } catch (e) {}
  }

  function _logGrid(gridData) {
    var rows = gridData.cells.map(function (row) {
      return row.map(function (cell) {
        return cell && cell.typeId !== null ? cell.typeName : '.';
      }).join(' ');
    });
    var voteRows = gridData.cells.map(function (row) {
      return row.map(function (cell) {
        if (!cell) return 'missing';
        return Math.round(cell.color.coverage * 100) + '/' + Math.round(cell.color.purity * 100);
      }).join(' ');
    });
    var originX = gridData.xCenters[0] - gridData.spacingX / 2;
    var originY = gridData.yCenters[0] - gridData.spacingY / 2;
    var colorRows = gridData.cells.map(function (row) {
      return row.map(function (cell) {
        return cell ? [cell.color.r, cell.color.g, cell.color.b].map(Math.round).join('/') : 'missing';
      }).join(' ');
    });
    _log('grid ' + gridData.rows + 'x' + gridData.columns +
      ' spacing=(' + Math.round(gridData.spacingX) + ',' + Math.round(gridData.spacingY) + ')' +
      ' origin=(' + Math.round(originX) + ',' + Math.round(originY) + ')');
    _log('types:\n' + rows.join('\n'));
    _log('cell RGB averages:\n' + colorRows.join('\n'));
    _log('vote coverage/purity %:\n' + voteRows.join('\n'));
  }

  function _logDebug(gridData, moves, result, selectedMove) {
    var now = Date.now();
    if (now - _lastDebugLog < config.DEBUG_LOG_INTERVAL_MS) return;
    _lastDebugLog = now;
    if (!gridData) {
      _log('grid detection: none');
      return;
    }
    _logGrid(gridData);
    _log('valid moves:', moves.length);
    if (result) _log('swap result:', result);
    if (moves.length) {
      var move = selectedMove || moves[0];
      _log('selected move: (' + move.from.row + ',' + move.from.column + ') -> (' +
        move.to.row + ',' + move.to.column + ') score=' + move.score);
    }
  }

  function _scan() {
    if (!_botActive) return;
    var canvas = _getCanvas();
    if (!canvas) return;

    try {
      var context = canvas.getContext('2d');
      if (!context) return;
      if (!_pendingSwap && _shouldRecalibrate()) _calibrateGrid(canvas, false);
      var imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      var gridData = _buildFixedGrid(imageData.data, canvas.width, canvas.height);
      var signature = _gridSignature(gridData);
      var progress = _readGameProgress();
      var confirmationResult = null;

      if (_pendingSwap) {
        _pendingSwap.frames++;
        if (signature && signature !== _pendingSwap.beforeSignature) {
          if (signature === _pendingSwap.lastChangedSignature) {
            _pendingSwap.stableFrames++;
          } else {
            _pendingSwap.stableFrames = 1;
            _pendingSwap.lastChangedSignature = signature;
          }

          if (_pendingSwap.stableFrames >= config.SWAP_STABLE_FRAMES) {
            var progressConfirmed = _progressConfirms(_pendingSwap.beforeProgress, progress);
            var positionsChanged = _swapPositionsChanged(
              _pendingSwap.beforeGrid,
              gridData,
              _pendingSwap.move
            );
            var confirmed = progressConfirmed || positionsChanged;
            confirmationResult = confirmed
              ? 'SUCCESS (match thật, xác nhận qua ' + (progressConfirmed ? 'điểm/COUNT' : 'ổn định lưới') + ')'
              : 'SUCCESS-KHÔNG-CHẮC (chỉ đổi pixel)';
            _recordSwapResult(confirmed);
            _log(confirmationResult);
            if (confirmed) {
              _blockedMove = {
                key: _moveKey(_pendingSwap.move),
                signature: signature,
                until: Date.now() + config.SWAP_COOLDOWN_MS
              };
            }
            _pendingSwap = null;
          }
        } else {
          if (signature === _pendingSwap.beforeSignature) {
            _pendingSwap.stableFrames = 0;
            _pendingSwap.lastChangedSignature = '';
          }
          if (_pendingSwap.frames >= config.SWAP_MAX_CONFIRMATION_FRAMES) {
            confirmationResult = 'FAILED after ' + _pendingSwap.frames + ' frames';
            _log('WARNING swap confirmation FAILED after ' + _pendingSwap.frames +
              ' frames; check grid coordinates, animation timing, or detection');
            _recordSwapResult(false);
            _blockedMove = {
              key: _moveKey(_pendingSwap.move),
              signature: signature,
              until: Date.now() + config.FAILED_MOVE_BLOCK_MS
            };
            _pendingSwap = null;
          }
        }
      }

      var moves = gridData ? _availableMoves(_findMoves(gridData), signature) : [];
      var selected = null;
      if (!_pendingSwap && moves.length && Date.now() >= _nextSwapTime) {
        var bestScore = moves[0].score;
        var bestMoves = moves.filter(function (move) { return move.score === bestScore; });
        selected = bestMoves[Math.floor(Math.random() * bestMoves.length)];
        _dispatchDrag(canvas, selected.from, selected.to);
        _pendingSwap = {
          beforeSignature: signature,
          frames: 0,
          stableFrames: 0,
          lastChangedSignature: '',
          beforeGrid: gridData,
          beforeProgress: progress,
          move: selected
        };
        _nextSwapTime = Date.now() + config.SWAP_COOLDOWN_MS;
        _log('drag swap score=' + selected.score + ': (' + selected.from.row + ',' + selected.from.column + ') -> (' +
          selected.to.row + ',' + selected.to.column + ')');
      }

      if (_isDebugEnabled()) _logDebug(gridData, moves, confirmationResult, selected);
    } catch (e) {
      _log('canvas scan error:', e);
    }
  }

  function _start() {
    if (_botActive) return;
    _botActive = true;
    _nextSwapTime = 0;
    _pendingSwap = null;
    _recentSwapFailures = [];
    _blockedMove = null;
    _lastCalibrationAt = 0;
    _lastDebugLog = 0;
    try { document.body.setAttribute('data-rc-bot-coinmatch-active', 'true'); } catch (e) {}
    _log('Coin Match bot started');
    _scanId = setInterval(_scan, config.SCAN_INTERVAL_MS);
    _scan();
    setTimeout(function () {
      if (_botActive && !_pendingSwap) _calibrateGrid(_getCanvas(), true);
    }, 100);
  }

  function _stop() {
    if (!_botActive) return;
    _botActive = false;
    if (_scanId) {
      clearInterval(_scanId);
      _scanId = null;
    }
    _pendingSwap = null;
    _recentSwapFailures = [];
    _blockedMove = null;
    try { document.body.removeAttribute('data-rc-bot-coinmatch-active'); } catch (e) {}
    _log('Coin Match bot stopped');
  }

  window._rcCoinMatch = {
    start: _start,
    stop: _stop,
    isActive: function () { return _botActive; },
    debug: function (enable) {
      _debugEnabled = enable !== false;
      _lastDebugLog = 0;
      _log('debug logging', _debugEnabled ? 'ENABLED' : 'disabled');
    },
    config: config
  };

  setInterval(function () {
    var enabled = true;
    try {
      enabled = document.body.getAttribute('data-rc-bot-coinmatch-enabled') !== 'false';
    } catch (e) {}
    var shouldRun = _isGame() && enabled;
    if (shouldRun && !_botActive) _start();
    if (!shouldRun && _botActive) _stop();
  }, 400);
})();

/* =========================================================
   terrain.js — 땅(언덕) 만들기와 파이기
   - 땅은 가로 1칸마다 "땅 표면 높이(y)"를 적은 숫자 목록입니다.
   - 대표 결정 4: 포트리스처럼 깊게 파입니다. 안전장치:
     ① 땅이 파이면 탱크도 내려앉음 (game.js에서 settleTanks)
     ② 바닥선(floorY) 아래로는 파이지 않음
     ③ 가파른 벽은 자동으로 무너뜨려 완만하게 → 탱크가 갇히지 않음
     ④ 파인 자리에 물감 자국(paint)
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};
  var T = {};

  // 씨앗(seed) 숫자로 늘 같은 순서의 "무작위 수"를 만드는 도구
  // (같은 seed → 같은 땅. 품질검사부가 같은 땅으로 다시 시험할 수 있음)
  T.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // 언덕 3개(왼쪽·가운데·오른쪽)가 있는 땅 만들기
  // 가운데 둔덕은 양쪽 언덕보다 낮거나 비슷하게 (디자인부 2-3)
  T.generate = function (seed, cfg) {
    cfg = cfg || MF.Config;
    var W = cfg.world.width;
    var rand = T.rng(seed);
    var base = 345;
    var aL = 45 + rand() * 30;           // 왼쪽 언덕 높이
    var aR = 45 + rand() * 30;           // 오른쪽 언덕 높이
    var aM = 15 + rand() * (Math.min(aL, aR) - 15); // 가운데(더 낮게)
    var cL = 150 + (rand() - 0.5) * 40;
    var cR = 850 + (rand() - 0.5) * 40;
    var ph = rand() * Math.PI * 2;
    var heights = new Array(W + 1);
    var paint = new Array(W + 1);
    for (var x = 0; x <= W; x++) {
      var y = base
        - aL * Math.exp(-Math.pow((x - cL) / 150, 2))
        - aM * Math.exp(-Math.pow((x - 500) / 110, 2))
        - aR * Math.exp(-Math.pow((x - cR) / 150, 2))
        + 6 * Math.sin(x / 37 + ph);
      heights[x] = y;
      paint[x] = -1;
    }

    // [요청-003] 두 탱크 시작 자리 높이 차이를 world.height 의 5~10%로 맞추기
    // - 어느 쪽이 높을지는 seed로 정함(판마다 바뀜, 같은 seed면 같은 땅)
    // - 시작 자리를 가운데로 하는 넓은 언덕 모양(폭 150)으로 한쪽은 올리고 한쪽은 내림
    //   → 반대쪽 자리와 가운데 둔덕에는 거의 영향이 없음
    var td = cfg.terrainDiff || { minRatio: 0.05, maxRatio: 0.10 };
    var Hh = cfg.world.height;
    var lo = Hh * td.minRatio + 1, hi = Hh * td.maxRatio - 1;   // 경계에서 1만큼 안쪽(반올림 여유)
    var target = lo + rand() * (hi - lo);
    var leftHigh = rand() < 0.5;
    var sx = (cfg.players && cfg.players.startX) || [150, 850];
    var floorTop = cfg.world.floorY - 40;   // 이보다 아래(큰 y)로는 땅 표면이 내려가지 않음
    var skyTop = Hh * 0.3;                  // 이보다 위(작은 y)로는 땅 표면이 올라가지 않음
    for (var it = 0; it < 4; it++) {
      // 오른쪽 자리 y − 왼쪽 자리 y : 왼쪽이 높으면 양수
      var want = leftHigh ? target : -target;
      var err = want - (heights[sx[1]] - heights[sx[0]]);
      if (Math.abs(err) < 0.01) break;
      for (x = 0; x <= W; x++) {
        var gL = Math.exp(-Math.pow((x - sx[0]) / 150, 2));
        var gR = Math.exp(-Math.pow((x - sx[1]) / 150, 2));
        heights[x] += -err / 2 * gL + err / 2 * gR;
      }
      for (x = 0; x <= W; x++) heights[x] = Math.max(skyTop, Math.min(heights[x], floorTop));
    }
    return { seed: seed, heights: heights, paint: paint, leftHigh: leftHigh };
  };

  // 두 탱크 시작 자리의 땅 높이 차이 (품질검사부 확인용, 순수 함수)
  // 돌려주는 값: { left, right, diff(양수), ratio(%), higher: '왼쪽'|'오른쪽' }
  T.startHeightDiff = function (terrain, cfg) {
    cfg = cfg || MF.Config;
    var sx = cfg.players.startX;
    var l = T.surfaceAt(terrain, sx[0]), r = T.surfaceAt(terrain, sx[1]);
    var d = Math.abs(l - r);
    return {
      left: Math.round(l * 10) / 10, right: Math.round(r * 10) / 10,
      diff: Math.round(d * 10) / 10,
      ratio: Math.round(d / cfg.world.height * 1000) / 10,
      higher: l < r ? '왼쪽' : '오른쪽'
    };
  };

  // x 자리의 땅 높이 (칸 사이는 이어서 계산)
  T.surfaceAt = function (terrain, x) {
    var h = terrain.heights, n = h.length - 1;
    if (x <= 0) return h[0];
    if (x >= n) return h[n];
    var i = Math.floor(x), f = x - i;
    return h[i] * (1 - f) + h[i + 1] * f;
  };

  // 탱크가 앉을 높이: 바퀴 아래 몇 군데의 평균
  T.tankRestY = function (terrain, x, halfW) {
    var s = 0, pts = [-0.7, -0.35, 0, 0.35, 0.7];
    for (var i = 0; i < pts.length; i++) s += T.surfaceAt(terrain, x + pts[i] * halfW);
    return s / pts.length;
  };

  // 탱크 기울기(그림용, 라디안). 너무 기울지 않게 제한
  T.tankTilt = function (terrain, x, halfW) {
    var a = Math.atan2(T.surfaceAt(terrain, x + halfW) - T.surfaceAt(terrain, x - halfW), halfW * 2);
    return Math.max(-0.45, Math.min(0.45, a));
  };

  // 구덩이 파기
  // cx: 포탄이 떨어진 가로 위치, colorIdx: 물감 색 번호
  // 그릇 모양으로 파고, 바닥선 아래로는 파지 않으며, 가파른 벽은 무너뜨립니다.
  T.dig = function (terrain, cx, colorIdx, cfg) {
    cfg = cfg || MF.Config;
    var h = terrain.heights, n = h.length - 1;
    var r = cfg.crater.radius, depth = cfg.crater.depth, floorY = cfg.world.floorY;
    var cy = T.surfaceAt(terrain, cx);
    var from = Math.max(0, Math.ceil(cx - r)), to = Math.min(n, Math.floor(cx + r));
    for (var x = from; x <= to; x++) {
      var bowl = cy + depth * 0.5 * (1 + Math.cos(Math.PI * (x - cx) / r));
      if (bowl > h[x]) h[x] = Math.min(bowl, floorY);   // ② 바닥선 보호
      if (Math.abs(x - cx) < r * 0.85) terrain.paint[x] = colorIdx; // ④ 물감 자국
    }
    T.relax(terrain, cfg.crater.maxSlope);              // ③ 가파른 벽 무너뜨리기
    return { from: from, to: to, centerY: cy };
  };

  // 이웃한 두 칸의 높이 차이가 maxSlope보다 크면, 높은 쪽을 깎아 완만하게 합니다.
  // (깎기만 하므로 바닥선 아래로 내려가지 않습니다)
  T.relax = function (terrain, maxSlope) {
    var h = terrain.heights, n = h.length - 1, x;
    for (x = 0; x < n; x++) {            // 오른쪽 칸이 너무 높으면 오른쪽을 깎음
      if (h[x] - h[x + 1] > maxSlope) h[x + 1] = h[x] - maxSlope;
    }
    for (x = n - 1; x >= 0; x--) {       // 왼쪽 칸이 너무 높으면 왼쪽을 깎음
      if (h[x + 1] - h[x] > maxSlope) h[x] = h[x + 1] - maxSlope;
    }
  };

  // 가장 가파른 곳의 기울기 (품질검사부 확인용)
  T.maxSlope = function (terrain) {
    var h = terrain.heights, m = 0;
    for (var x = 0; x < h.length - 1; x++) m = Math.max(m, Math.abs(h[x + 1] - h[x]));
    return m;
  };

  MF.Terrain = T;
})(typeof window !== 'undefined' ? window : globalThis);

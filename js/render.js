/* =========================================================
   render.js — 화면 그리기 (canvas)
   - 게임 규칙·점수 계산은 하지 않고, 받은 상태를 그리기만 합니다.
   - 꾸밈 효과(별·물감 방울·연기·색종이)는 이 파일이 직접 움직입니다.
   - 좌표: 게임 세상(가로 1000) → 화면 픽셀로 늘이고 줄여서 그립니다.
   - 카메라([요청-003]): 조준할 때는 전체 화면, 포탄이 날 때는 1.6배로 확대해 따라감.
     화면 좌표가 필요한 곳은 모두 R.toScreen()을 쓰면 카메라가 반영됩니다.
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};
  var C = MF.Config, P = MF.Physics, T = MF.Terrain, F = MF.Feedback;

  var R = {};
  var canvas, ctx;
  // scale/ox/oy: 전체 화면일 때 세상→화면 / s2·ox2·oy2: 카메라를 반영한 실제 값
  var view = { scale: 1, ox: 0, oy: 0, cssW: 1, cssH: 1, dpr: 1, s2: 1, ox2: 0, oy2: 0 };
  // 카메라: z = 확대 배율, fx·fy = 화면 기준점(전체 화면일 때 세상 가운데가 보이는 자리)에 올 세상 점
  var cam = { z: 1, fx: 500, fy: 281, mode: 'full', t: 0, tx: 0, ty: 0, zFrom: 1, fxFrom: 0, fyFrom: 0 };
  var dmgFloats = [];
  var great = null;
  var insets = { top: 60, bottom: 90 };
  var particles = [];
  var popups = [];
  var bigStar = null;
  var confetti = null;
  var clouds = [
    { x: 160, y: 120, s: 1.0 }, { x: 430, y: 80, s: 0.8 },
    { x: 690, y: 135, s: 1.1 }, { x: 900, y: 70, s: 0.7 }
  ];
  var clock = 0;

  var OUTLINE = '#3A2E39';

  // ---------- 준비와 크기 맞추기 ----------
  R.init = function (cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    R.resize();
  };
  R.setInsets = function (top, bottom) { insets.top = top; insets.bottom = bottom; };

  R.resize = function () {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    view.cssW = Math.max(1, rect.width);
    view.cssH = Math.max(1, rect.height);
    view.dpr = dpr;
    canvas.width = Math.round(view.cssW * dpr);
    canvas.height = Math.round(view.cssH * dpr);
    var W = C.world.width, H = C.world.height;
    // 바닥선(floorY)이 아래 조작판 윗변보다 위에 오도록 크기와 위치를 정합니다.
    var floorScreenMax = view.cssH - insets.bottom - 6;
    view.scale = Math.min(view.cssW / W, view.cssH / H, Math.max(0.1, floorScreenMax / C.world.floorY));
    view.ox = (view.cssW - W * view.scale) / 2;
    // 땅은 아래쪽에 맞추되, 바닥선은 늘 조작판 위에 보이게
    view.oy = Math.min(view.cssH - H * view.scale, floorScreenMax - C.world.floorY * view.scale);
    clampCam();
    applyCam();
  };

  R.toScreen = function (x, y) { return { x: view.ox2 + x * view.s2, y: view.oy2 + y * view.s2 }; };
  R.getView = function () { return view; };

  function setWorld() { ctx.setTransform(view.dpr * view.s2, 0, 0, view.dpr * view.s2, view.dpr * view.ox2, view.dpr * view.oy2); }

  // ---------- 카메라 ----------
  // 화면 기준점: 전체 화면일 때 세상 가운데(W/2, H/2)가 보이는 화면 자리
  function camCenter() { return { x: C.world.width / 2, y: C.world.height / 2 }; }
  function camAnchor() {
    var c = camCenter();
    return { x: view.ox + c.x * view.scale, y: view.oy + c.y * view.scale };
  }
  // 확대해도 전체 화면에서 보이던 범위 밖(세상 경계 밖)은 보이지 않게 fx·fy 범위를 제한
  function clampCam() {
    var c = camCenter(), a = camAnchor(), k = 1 - 1 / cam.z, s = view.scale;
    cam.fx = Math.max(c.x - a.x / s * k, Math.min(c.x + (view.cssW - a.x) / s * k, cam.fx));
    cam.fy = Math.max(c.y - a.y / s * k, Math.min(c.y + (view.cssH - a.y) / s * k, cam.fy));
  }
  function applyCam() {
    var a = camAnchor();
    view.s2 = view.scale * cam.z;
    view.ox2 = a.x - cam.fx * view.s2;
    view.oy2 = a.y - cam.fy * view.s2;
  }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }
  function easeInOut(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function updateCam(dt) {
    var cc = C.camera, c = camCenter();
    if (cam.mode === 'follow') {
      cam.t += dt;
      var k = Math.min(1, cam.t / cc.zoomInTime);
      cam.z = cam.zFrom + (cc.zoom - cam.zFrom) * easeOut(k);
      var f = 1 - Math.exp(-dt * cc.follow);   // 부드럽게 따라가기(lerp)
      cam.fx += (cam.tx - cam.fx) * f;
      cam.fy += (cam.ty - cam.fy) * f;
      clampCam();   // 포탄이 위로 높이 올라가면 위 경계에 막혀 가로만 따라감
    } else if (cam.mode === 'return') {
      cam.t += dt;
      var e = easeInOut(Math.min(1, cam.t / cc.returnTime));
      cam.z = cam.zFrom + (1 - cam.zFrom) * e;
      cam.fx = cam.fxFrom + (c.x - cam.fxFrom) * e;
      cam.fy = cam.fyFrom + (c.y - cam.fyFrom) * e;
      clampCam();
      if (cam.t >= cc.returnTime) { R.camReset(); return; }
    }
    applyCam();
  }
  // 발사: 포탄 쪽으로 확대 시작
  R.camFollow = function (x, y) {
    if (cam.mode === 'full') { var c = camCenter(); cam.fx = c.x; cam.fy = c.y; }
    cam.mode = 'follow'; cam.t = 0; cam.zFrom = cam.z; cam.tx = x; cam.ty = y;
  };
  // 따라갈 자리 바꾸기 (날아가는 포탄 / 떨어진 자리에 머물기)
  R.camTarget = function (x, y) { cam.tx = x; cam.ty = y; };
  // 전체 화면으로 돌아가기
  R.camReturn = function () {
    if (cam.mode === 'full' || cam.mode === 'return') return;
    cam.mode = 'return'; cam.t = 0; cam.zFrom = cam.z; cam.fxFrom = cam.fx; cam.fyFrom = cam.fy;
  };
  R.camReset = function () {
    var c = camCenter();
    cam.mode = 'full'; cam.z = 1; cam.fx = c.x; cam.fy = c.y; cam.t = 0;
    applyCam();
  };
  // 조준(끌기)은 카메라가 전체 화면일 때만 받음
  R.cameraIsFull = function () { return cam.mode === 'full' && cam.z === 1; };
  R.getCamera = function () {
    return { z: Math.round(cam.z * 1000) / 1000, fx: Math.round(cam.fx), fy: Math.round(cam.fy), mode: cam.mode };
  };

  // 탱크가 화면에서 차지하는 상자 (포신·머리 위 체력 막대 포함) — 조준 숫자 비키기에 사용
  R.tankScreenBox = function (pl) {
    var k = R.tankScale();
    var reach = C.tank.bodyW / 2 + C.tank.barrelLen + 6;
    var top = pl.drawY - Math.max(C.tank.pivotH + C.tank.barrelLen + 6, 66 * k + 8);
    var a = R.toScreen(pl.x - reach, top), b = R.toScreen(pl.x + reach, pl.drawY + 4);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  };
  function setScreen() { ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); }

  // ---------- 작은 그리기 도구 ----------
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function starPath(c, x, y, r, rot) {
    c.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 === 0 ? r : r * 0.45;
      var a = rot + i * Math.PI / 5 - Math.PI / 2;
      var px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
  function lerpColor(a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    var g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    var bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  // 체력 막대 색 (초록·노랑·주황)
  R.hpColor = function (hp) {
    if (hp > 50) return C.hpColors.green;
    if (hp > 20) return C.hpColors.yellow;
    return C.hpColors.orange;
  };
  // 적중률 막대 색 (높을수록 좋음)
  R.accColor = function (acc) {
    if (acc >= 70) return C.hpColors.green;
    if (acc >= 40) return C.hpColors.yellow;
    return C.hpColors.orange;
  };

  // ---------- 하늘·구름·해 ----------
  function drawSky(dt) {
    setScreen();
    var g = ctx.createLinearGradient(0, 0, 0, view.cssH);
    g.addColorStop(0, '#9ED8FF');
    g.addColorStop(1, '#E3F5FF');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.cssW, view.cssH);
    setWorld();
    // 해 (얼굴 없음)
    ctx.fillStyle = '#FFE27A';
    circle(ctx, 70, 120, 26); ctx.fill();
    ctx.globalAlpha = 0.35; circle(ctx, 70, 120, 36); ctx.fill(); ctx.globalAlpha = 1;
    // 구름 (천천히 흘러감)
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      cl.x += dt * 6 * cl.s;
      if (cl.x > 1120) cl.x = -120;
      var s = cl.s;
      circle(ctx, cl.x, cl.y, 18 * s); ctx.fill();
      circle(ctx, cl.x + 20 * s, cl.y - 8 * s, 22 * s); ctx.fill();
      circle(ctx, cl.x + 42 * s, cl.y, 17 * s); ctx.fill();
      rr(ctx, cl.x - 10 * s, cl.y, 62 * s, 16 * s, 8 * s); ctx.fill();
    }
  }

  // ---------- 땅 ----------
  function drawTerrain(terrain) {
    var h = terrain.heights, W = C.world.width;
    var xL = -view.ox2 / view.s2 - 5, xR = (view.cssW - view.ox2) / view.s2 + 5;
    var yB = (view.cssH - view.oy2) / view.s2 + 10;
    var x;
    // 땅 모양 경로
    ctx.beginPath();
    ctx.moveTo(xL, yB);
    ctx.lineTo(xL, h[0]);
    for (x = 0; x <= W; x += 2) ctx.lineTo(x, h[x]);
    ctx.lineTo(W, h[W]);
    ctx.lineTo(xR, h[W]);
    ctx.lineTo(xR, yB);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, 260, 0, C.world.floorY);
    g.addColorStop(0, '#D9A066');
    g.addColorStop(1, '#B97F4A');
    ctx.fillStyle = g;
    ctx.fill();

    // 바닥선 아래 단단한 돌층 (여기 아래로는 파이지 않아요)
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#9C7650';
    ctx.fillRect(xL, C.world.floorY, xR - xL, yB - C.world.floorY);
    ctx.fillStyle = '#8A6644';
    for (x = Math.floor(xL / 30) * 30; x < xR; x += 30) {
      circle(ctx, x + 10, C.world.floorY + 14, 5); ctx.fill();
      circle(ctx, x + 24, C.world.floorY + 32, 4); ctx.fill();
    }
    ctx.restore();

    // 풀 띠 (진한 테두리 위에 초록)
    function surfacePath() {
      ctx.beginPath();
      ctx.moveTo(xL, h[0]);
      for (var i = 0; i <= W; i += 2) ctx.lineTo(i, h[i]);
      ctx.lineTo(W, h[W]); ctx.lineTo(xR, h[W]);
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    surfacePath(); ctx.strokeStyle = '#5B3B24'; ctx.lineWidth = 9; ctx.stroke();
    surfacePath(); ctx.strokeStyle = '#6CC24A'; ctx.lineWidth = 6; ctx.stroke();

    // 물감 자국 (파인 자리)
    var p = terrain.paint, start = -1;
    for (x = 0; x <= W + 1; x++) {
      var cur = x <= W ? p[x] : -2;
      var prev = start >= 0 ? p[start] : -1;
      if (start >= 0 && cur !== prev) {
        ctx.beginPath();
        ctx.moveTo(start, h[start] + 1);
        for (var k = start + 1; k < x; k++) ctx.lineTo(k, h[k] + 1);
        ctx.strokeStyle = C.colors[prev].body;
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.fillStyle = C.colors[prev].body;
        for (k = start + 4; k < x - 2; k += 9) { circle(ctx, k, h[k] + 7 + (k % 3), 2.4); ctx.fill(); }
        start = -1;
      }
      if (start < 0 && cur >= 0) start = x;
    }

    // 작은 꽃 (파이지 않은 곳에만)
    for (x = 23; x < W; x += 47) {
      if (p[x] >= 0) continue;
      var fy = h[x] - 4;
      ctx.fillStyle = (x % 2) ? '#FFFFFF' : '#FFB3C7';
      circle(ctx, x, fy, 2.6); ctx.fill();
      ctx.fillStyle = '#FFE066';
      circle(ctx, x, fy, 1.1); ctx.fill();
    }
  }

  // ---------- 탱크 ----------
  // o = { x, y, tilt, colorIdx, pIdx, angleDeg, dir, facing, face, splats, recoil, t, wheel }
  // 탱크 그림은 기준 크기(폭 48)로 그리고, config의 bodyW ÷ 48 배로 통째로 키웁니다.
  var TK = { bodyW: 48, bodyH: 18, treadH: 10, domeR: 15, pivotH: 30, barrelLen: 26 };
  R.tankScale = function () { return C.tank.bodyW / 48; };
  function drawTank(c, o) {
    var col = C.colors[o.colorIdx];
    var k = R.tankScale();
    var bob = Math.sin((o.t || 0) * Math.PI) * 0.8;
    var domeY = -(TK.treadH + TK.bodyH);
    c.save();
    c.translate(o.x - (o.facing || 1) * (o.recoil || 0), o.y + bob);
    c.rotate(o.tilt || 0);
    c.scale(k, k);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = OUTLINE; c.lineWidth = 2;

    // 궤도와 바퀴
    rr(c, -TK.bodyW / 2 - 2, -TK.treadH, TK.bodyW + 4, TK.treadH, 5);
    c.fillStyle = '#5A5560'; c.fill(); c.stroke();
    for (var i = 0; i < 4; i++) {
      var wx = -18 + i * 12;
      circle(c, wx, -TK.treadH / 2, 3.3); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 1.4; c.stroke();
      var wa = (o.wheel || 0) + i;
      c.beginPath(); c.moveTo(wx - Math.cos(wa) * 2.4, -TK.treadH / 2 - Math.sin(wa) * 2.4);
      c.lineTo(wx + Math.cos(wa) * 2.4, -TK.treadH / 2 + Math.sin(wa) * 2.4); c.stroke();
    }
    c.lineWidth = 2;

    // 포신 (세상 기준 각도로: 몸 기울기를 되돌림)
    c.save();
    c.translate(0, -TK.pivotH);
    c.rotate(-(o.tilt || 0));
    var a = (o.angleDeg || 0) * Math.PI / 180;
    c.rotate(o.dir > 0 ? -a : -(Math.PI - a));
    rr(c, 0, -4, TK.barrelLen, 8, 4);
    c.fillStyle = col.body; c.fill(); c.stroke();
    rr(c, TK.barrelLen - 6, -5.5, 7, 11, 3.5);
    c.fillStyle = col.dark; c.fill(); c.stroke();
    c.restore();

    // 몸통
    rr(c, -TK.bodyW / 2, domeY, TK.bodyW, TK.bodyH, 8);
    c.fillStyle = col.body; c.fill(); c.stroke();
    // 무늬: 1번 별 3개, 2번 사선 줄무늬 3줄
    c.save();
    rr(c, -TK.bodyW / 2, domeY, TK.bodyW, TK.bodyH, 8); c.clip();
    c.fillStyle = '#FFFFFF';
    if (o.pIdx === 0) {
      for (var s = -1; s <= 1; s++) { starPath(c, s * 14, domeY + 10, 4, 0); c.fill(); }
    } else {
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 3.5;
      for (var st = -1; st <= 1; st++) {
        c.beginPath(); c.moveTo(st * 14 - 5, domeY + TK.bodyH); c.lineTo(st * 14 + 5, domeY); c.stroke();
      }
    }
    // 묻은 물감
    if (o.splats) {
      for (var sp = 0; sp < o.splats.length; sp++) {
        var spl = o.splats[sp];
        c.fillStyle = C.colors[spl.colorIdx].body;
        circle(c, spl.ox, domeY + spl.oy, 5); c.fill();
        for (var d = 0; d < 6; d++) {
          var da = d * 1.05 + spl.ox;
          circle(c, spl.ox + Math.cos(da) * 7, domeY + spl.oy + Math.sin(da) * 5, 1.6); c.fill();
        }
      }
    }
    c.restore();
    c.strokeStyle = OUTLINE; c.lineWidth = 2;

    // 깃발 (1번 동그라미, 2번 세모)
    var bx = -(o.facing || 1) * 10;
    c.beginPath(); c.moveTo(bx, domeY - 6); c.lineTo(bx, domeY - 26); c.stroke();
    c.fillStyle = col.dark;
    if (o.pIdx === 0) { circle(c, bx - (o.facing || 1) * 5, domeY - 22, 5); c.fill(); c.stroke(); }
    else {
      c.beginPath(); c.moveTo(bx, domeY - 27); c.lineTo(bx - (o.facing || 1) * 11, domeY - 22); c.lineTo(bx, domeY - 17);
      c.closePath(); c.fill(); c.stroke();
    }

    // 포탑(얼굴)
    c.beginPath(); c.arc(0, domeY, TK.domeR, Math.PI, 0); c.closePath();
    c.fillStyle = col.light; c.fill(); c.stroke();
    // Robo 표시: 포탑 위 안테나 + 노란 전구 (글씨 없이 모양으로 구별, 디자인부 2-4)
    // 생각·조준 중에는 전구가 천천히 깜빡임 (밝기 0.5 ↔ 1, 0.6초 주기)
    if (o.isRobo) {
      c.beginPath(); c.moveTo(0, domeY - TK.domeR); c.lineTo(0, domeY - 25);
      c.strokeStyle = OUTLINE; c.lineWidth = 2; c.stroke();
      c.save();
      if (o.blink) c.globalAlpha = 0.75 + 0.25 * Math.sin((o.t || 0) * Math.PI * 2 / 0.6);
      circle(c, 0, domeY - 28, 3.5);
      c.fillStyle = '#FFE066'; c.fill();
      c.restore();
      circle(c, 0, domeY - 28, 3.5);
      c.strokeStyle = OUTLINE; c.lineWidth = 1.5; c.stroke();
      c.lineWidth = 2;
    }
    drawFace(c, o, domeY);
    c.restore();
  }

  function drawFace(c, o, domeY) {
    var f = o.facing || 1;
    var face = o.face || 'idle';
    var a = (o.angleDeg || 0) * Math.PI / 180;
    var lookX = o.dir * Math.cos(a) * 1.3, lookY = -Math.sin(a) * 1.3;
    var ey = domeY - 7;
    var ex = [-5.5 + f, 5.5 + f];
    c.lineWidth = 1.4; c.strokeStyle = OUTLINE;
    // 볼터치
    c.fillStyle = 'rgba(255,140,170,0.75)';
    circle(c, -10 + f, domeY - 3, 2); c.fill();
    circle(c, 10 + f, domeY - 3, 2); c.fill();

    if (face === 'happy' || face === 'shy') {
      for (var i = 0; i < 2; i++) { c.beginPath(); c.arc(ex[i], ey + 1, 2.6, Math.PI, 0); c.stroke(); }
      c.beginPath(); c.arc(f, domeY - 3.5, 3.2, 0, Math.PI); c.closePath();
      c.fillStyle = '#7A3B45'; c.fill(); c.stroke();
      if (face === 'shy') {
        c.fillStyle = '#7FD0FF';
        c.beginPath(); c.moveTo(-f * 12, domeY - 14); c.quadraticCurveTo(-f * 14.5, domeY - 9, -f * 12, domeY - 8.5);
        c.quadraticCurveTo(-f * 9.5, domeY - 9, -f * 12, domeY - 14); c.fill(); c.stroke();
      }
      return;
    }
    var er = face === 'hit' ? 4.4 : 3.6;
    for (var j = 0; j < 2; j++) {
      if (face === 'aim' && j === (f > 0 ? 0 : 1)) {   // 한쪽 눈 가늘게(집중)
        c.beginPath(); c.moveTo(ex[j] - 3, ey); c.lineTo(ex[j] + 3, ey - 0.5); c.stroke();
        continue;
      }
      circle(c, ex[j], ey, er); c.fillStyle = '#FFFFFF'; c.fill(); c.stroke();
      circle(c, ex[j] + lookX, ey + lookY, face === 'hit' ? 1.4 : 1.8); c.fillStyle = OUTLINE; c.fill();
    }
    if (face === 'hit') {
      circle(c, f, domeY - 2.5, 1.8); c.fillStyle = '#7A3B45'; c.fill(); c.stroke();
      // 머리 위 빙글빙글 별 3개
      for (var k = 0; k < 3; k++) {
        var sa = clock * 5 + k * 2.09;
        starPath(c, Math.cos(sa) * 12, domeY - 22 + Math.sin(sa) * 3, 3.2, sa);
        c.fillStyle = '#FFE066'; c.fill(); c.strokeStyle = '#E0A800'; c.lineWidth = 1; c.stroke();
      }
    } else if (face === 'aim') {
      c.beginPath(); c.moveTo(f - 2.5, domeY - 2.5); c.lineTo(f + 2.5, domeY - 2.5); c.stroke();
    } else {
      c.beginPath(); c.arc(f, domeY - 4, 2.6, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    }
  }

  // 탱크 머리 위 작은 체력 막대
  function drawMiniHp(x, y, hp) {
    var w = 34, hgt = 5, top = y - 66 * R.tankScale();
    ctx.lineWidth = 1.5; ctx.strokeStyle = OUTLINE;
    rr(ctx, x - w / 2, top, w, hgt, 2.5); ctx.fillStyle = '#E9E4DA'; ctx.fill();
    if (hp > 0) { rr(ctx, x - w / 2, top, Math.max(2.5, w * hp / 100), hgt, 2.5); ctx.fillStyle = R.hpColor(hp); ctx.fill(); }
    rr(ctx, x - w / 2, top, w, hgt, 2.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - w / 2 + w * 0.1, top - 1.5); ctx.lineTo(x - w / 2 + w * 0.1, top + hgt + 1.5); ctx.stroke();
  }

  // ---------- 조준 그림 (각도기/눈금판 + 화살표) ----------
  function drawAim(pl) {
    var mode = pl.mode;
    var act = P.aimToActual(pl.aim, mode);
    var piv = P.pivotPosition(pl.x, pl.drawY, pl.tilt, C.tank);
    var dir = pl.aim.dir;
    ctx.save();
    ctx.translate(piv.x, piv.y);
    ctx.lineCap = 'round';
    if (mode === 'sprout') {
      // 눈금판 10칸
      for (var i = 1; i <= 10; i++) {
        var a = i * 9 * Math.PI / 180;
        var on = i === pl.aim.angleValue;
        var kk = R.tankScale(), r1 = 36 * kk, r2 = (on ? 50 : 44) * kk;
        ctx.strokeStyle = on ? '#FF8A00' : 'rgba(58,46,57,0.55)';
        ctx.lineWidth = on ? 4 : 2.5;
        ctx.beginPath();
        ctx.moveTo(dir * Math.cos(a) * r1, -Math.sin(a) * r1);
        ctx.lineTo(dir * Math.cos(a) * r2, -Math.sin(a) * r2);
        ctx.stroke();
      }
    } else {
      // 반투명 각도기 (0°~90°)
      var R0 = 50 * R.tankScale();
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, R0, dir > 0 ? -Math.PI / 2 : Math.PI, dir > 0 ? 0 : -Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fill();
      ctx.strokeStyle = 'rgba(58,46,57,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      for (var d = 0; d <= 90; d += 5) {
        var ra = d * Math.PI / 180, len = d % 10 === 0 ? 8 : 4;
        ctx.beginPath();
        ctx.moveTo(dir * Math.cos(ra) * R0, -Math.sin(ra) * R0);
        ctx.lineTo(dir * Math.cos(ra) * (R0 - len), -Math.sin(ra) * (R0 - len));
        ctx.stroke();
      }
    }
    // 방향·힘 화살표 (포탄 길 미리보기 아님: 쏘는 방향과 힘만 보여 줌)
    var ar = act.angleDeg * Math.PI / 180;
    var ux = dir * Math.cos(ar), uy = -Math.sin(ar);
    var start = C.tank.barrelLen + 4;
    var L = start + 12 + act.power * 0.6;
    var colr = lerpColor('#FFE89A', '#FF8A00', act.power / 100);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = colr; ctx.lineWidth = 3 + act.power * 0.03;
    ctx.beginPath(); ctx.moveTo(ux * start, uy * start); ctx.lineTo(ux * (L - 6), uy * (L - 6)); ctx.stroke();
    ctx.setLineDash([]);
    var px = -uy, py = ux;
    ctx.beginPath();
    ctx.moveTo(ux * (L + 6), uy * (L + 6));
    ctx.lineTo(ux * (L - 6) + px * 7, uy * (L - 6) + py * 7);
    ctx.lineTo(ux * (L - 6) - px * 7, uy * (L - 6) - py * 7);
    ctx.closePath();
    ctx.fillStyle = colr; ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  // ---------- 지난 궤적 점선과 깃발 ----------
  function drawTrails(pl, terrain) {
    var col = C.colors[pl.colorIdx];
    var n = pl.trails.length;
    for (var i = 0; i < n; i++) {
      var tr = pl.trails[i];
      var recent = i === n - 1;
      ctx.globalAlpha = recent ? 0.55 : 0.3;
      ctx.fillStyle = col.dark;
      for (var k = 0; k < tr.points.length; k += 2) {
        circle(ctx, tr.points[k].x, tr.points[k].y, recent ? 2 : 1.6); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    for (var j = 0; j < pl.flags.length; j++) {
      var fl = pl.flags[j];
      if (fl.x < -20 || fl.x > C.world.width + 20) continue;
      var fx = Math.max(4, Math.min(C.world.width - 4, fl.x));
      var gy = T.surfaceAt(terrain, fx);
      ctx.globalAlpha = j === pl.flags.length - 1 ? 1 : 0.6;
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx, gy); ctx.lineTo(fx, gy - 24); ctx.stroke();
      ctx.fillStyle = col.body;
      if (pl.idx === 0) { circle(ctx, fx + 6, gy - 20, 5.5); ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(fx, gy - 25); ctx.lineTo(fx + 12, gy - 20); ctx.lineTo(fx, gy - 15); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }
  function drawFlagLabels(pl, terrain) {
    for (var j = 0; j < pl.flags.length; j++) {
      var fl = pl.flags[j];
      if (fl.x < -20 || fl.x > C.world.width + 20) continue;
      var fx = Math.max(4, Math.min(C.world.width - 4, fl.x));
      var gy = T.surfaceAt(terrain, fx);
      var s = R.toScreen(fx, gy - 26);
      label(fl.text, s.x, s.y - 4 - (j < pl.flags.length - 1 ? 26 : 0), 16, j === pl.flags.length - 1 ? 1 : 0.7);
    }
  }
  // 깃발 글자: [요청-003] 상자 없이 흰 글씨 + 진한 외곽선
  function label(text, x, y, size, alpha) {
    ctx.globalAlpha = alpha || 1;
    ctx.font = '800 ' + size + 'px ' + FONT;
    var w = ctx.measureText(text).width + 8, hgt = size + 6;
    x = Math.max(w / 2 + 2, Math.min(view.cssW - w / 2 - 2, x));
    outlinedText(text, x, y - hgt / 2 + 0.5, '#FFFFFF', 4);
    ctx.globalAlpha = 1;
  }
  // 외곽선 글씨 (배경 없이 하늘·땅 위에서도 읽히게)
  function outlinedText(text, x, y, fill, lw) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw || 4;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  var FONT = '"Apple SD Gothic Neo","Malgun Gothic","맑은 고딕","Noto Sans KR",system-ui,sans-serif';

  // ---------- 포탄 ----------
  function drawShell(sh) {
    var col = C.colors[sh.colorIdx];
    for (var i = 0; i < sh.tail.length; i++) {
      var tp = sh.tail[i];
      ctx.globalAlpha = 0.25 + 0.1 * i;
      ctx.fillStyle = col.body;
      circle(ctx, tp.x, tp.y, 1.5 + i * 0.8); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2;
    circle(ctx, sh.pos.x, sh.pos.y, 6.5); ctx.fillStyle = col.body; ctx.fill(); ctx.stroke();
    if (sh.pIdx === 1) {
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sh.pos.x - 4, sh.pos.y + 1); ctx.lineTo(sh.pos.x + 4, sh.pos.y + 1); ctx.stroke();
    }
    ctx.fillStyle = '#FFFFFF';
    circle(ctx, sh.pos.x - 2.2, sh.pos.y - 2.2, 1.8); ctx.fill();
  }
  // 포탄이 화면 위로 나가면 위쪽에 작은 세모로 알려 줌
  function drawOffscreenMarker(sh) {
    var s = R.toScreen(sh.pos.x, sh.pos.y);
    if (s.y > insets.top + 4) return;
    var x = Math.max(12, Math.min(view.cssW - 12, s.x)), y = insets.top + 10;
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 8, y + 6); ctx.lineTo(x - 8, y + 6); ctx.closePath();
    ctx.fillStyle = C.colors[sh.colorIdx].body; ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2; ctx.stroke();
  }

  // ---------- 꾸밈 효과 ----------
  function addP(o) { particles.push(o); if (particles.length > 260) particles.shift(); }

  // 명중: 물감 튀김 + 별 8개 + 반짝이 10개
  R.burstHit = function (x, y, colorIdx) {
    var col = C.colors[colorIdx].body, i, a;
    for (i = 0; i < 8; i++) {
      a = i * Math.PI / 4 + 0.2;
      addP({ k: 'star', x: x, y: y - 10, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70 - 30, g: 40, life: 1.1, max: 1.1, s: 6, rot: a, vr: 3 });
    }
    for (i = 0; i < 10; i++) {
      a = i * 0.63;
      addP({ k: 'spark', x: x, y: y - 10, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, g: 0, life: 0.6, max: 0.6, s: 2.2 });
    }
    R.burstPaint(x, y, colorIdx, 10);
  };
  // 물감 방울
  R.burstPaint = function (x, y, colorIdx, n) {
    var col = C.colors[colorIdx].body;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI * (0.1 + 0.8 * (i / Math.max(1, n - 1)));
      addP({ k: 'drop', x: x, y: y, vx: Math.cos(a) * (60 + (i % 3) * 25), vy: Math.sin(a) * (90 + (i % 2) * 40), g: 260, life: 0.9, max: 0.9, s: 3 + (i % 3), color: col });
    }
  };
  // 빗나감: 물감 조금 + 흙먼지 3개
  R.burstMiss = function (x, y, colorIdx) {
    R.burstPaint(x, y, colorIdx, 6);
    for (var i = 0; i < 3; i++) {
      addP({ k: 'dust', x: x + (i - 1) * 10, y: y - 4, vx: (i - 1) * 14, vy: -18, g: 0, life: 0.8, max: 0.8, s: 6 });
    }
  };
  // 발사: 포신 끝 흰 연기 3개
  R.puffSmoke = function (x, y, dir) {
    for (var i = 0; i < 3; i++) {
      addP({ k: 'smoke', x: x, y: y, vx: dir * (20 + i * 12), vy: -10 - i * 6, g: 0, life: 0.6, max: 0.6, s: 4 + i });
    }
  };

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
      if (p.k === 'spark' || p.k === 'smoke' || p.k === 'dust') { p.vx *= 0.94; p.vy *= 0.94; }
    }
  }
  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i], t = p.life / p.max;
      ctx.globalAlpha = Math.min(1, t * 1.5);
      if (p.k === 'star') {
        starPath(ctx, p.x, p.y, p.s, p.rot);
        ctx.fillStyle = '#FFE066'; ctx.fill(); ctx.strokeStyle = '#E0A800'; ctx.lineWidth = 1.2; ctx.stroke();
      } else if (p.k === 'spark') {
        ctx.fillStyle = '#FFFFFF'; circle(ctx, p.x, p.y, p.s); ctx.fill();
      } else if (p.k === 'drop') {
        ctx.fillStyle = p.color; circle(ctx, p.x, p.y, p.s); ctx.fill();
      } else if (p.k === 'dust') {
        ctx.fillStyle = '#E8CFA8'; circle(ctx, p.x, p.y, p.s * (1.6 - t * 0.6)); ctx.fill();
      } else if (p.k === 'smoke') {
        ctx.fillStyle = '#FFFFFF'; circle(ctx, p.x, p.y, p.s * (1.8 - t * 0.8)); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // 적중률 표시 (탱크 위) — [요청-003] 상자 없이 글씨·별·색 막대만
  // o = { x, y, acc, mode, colorIdx }
  // 탱크 위에 둘지 옆에 둘지는 처음 한 번만, 전체 화면(카메라 반영 전) 좌표로 정해 p.beside에 저장
  // → 카메라가 돌아오는 도중에 위 ↔ 옆으로 순간 이동하지 않음 (디자인부 2-3)
  R.showHitPopup = function (o) {
    o.life = 2.0; o.max = 2.0;
    var fullTop = view.oy + (o.y - 66 * R.tankScale()) * view.scale;
    o.beside = fullTop - 40 - 76 < insets.top + 6;
    // 옆에 둘 때 좌우 방향(+1 오른쪽, -1 왼쪽)도 한 번만 정함 [오류-006]
    // 「Great!」(가운데)과 겹치지 않게 바깥쪽을 먼저, 전체 화면에서 바깥쪽 자리가 없으면 가운데 쪽
    var sx = view.ox + o.x * view.scale, hw = 80;
    var gapF = (C.tank.bodyW / 2 + C.tank.barrelLen) * view.scale + hw + 8;
    var out = sx > view.cssW / 2 ? 1 : -1;
    var fits = sx + out * gapF + hw + 4 <= view.cssW && sx + out * gapF - hw - 4 >= 0;
    o.sideSign = fits ? out : -out;
    o.inward = o.beside && !fits;   // 가운데 쪽 옆 → 「Great!」이 떠 있는 동안은 기다렸다가 보임
    popups.push(o);
  };
  // 품질검사부 확인용: 떠 있는 적중률 묶음의 그려진 자리
  R.popupInfo = function () {
    return popups.map(function (p) { return { x: Math.round(p.drawX), y: Math.round(p.drawY), beside: p.beside, sideSign: p.sideSign }; });
  };
  // 탱크 머리 위 체력 막대의 화면 y (카메라 반영)
  function tankTopScreenY(x, y) { return R.toScreen(x, y - 66 * R.tankScale()).y; }
  function drawPopups(dt) {
    for (var i = popups.length - 1; i >= 0; i--) {
      var p = popups[i];
      if (great && p.inward) { p.drawX = NaN; continue; }   // 가운데 「Great!」과 겹치지 않게 끝날 때까지 기다림
      p.life -= dt;
      if (p.life <= 0) { popups.splice(i, 1); continue; }
      var rise = (1 - p.life / p.max) * 14;
      var s = R.toScreen(p.x, p.y);
      var w = 160, h = 76;
      var x = Math.max(w / 2 + 4, Math.min(view.cssW - w / 2 - 4, s.x));
      // 피해 % 글씨 자리(체력 막대 바로 위 약 34px)를 비워 두고 그 위에
      var topY = tankTopScreenY(p.x, p.y);
      var y = topY - 40 - h - rise;
      if (p.beside) {
        // 탱크 옆에 둠. 좌우 방향은 showHitPopup 때 정한 p.sideSign만 씀(매 장면 바꾸지 않음)
        var half = (C.tank.bodyW / 2 + C.tank.barrelLen) * view.s2;
        var gap = half + w / 2 + 8;
        x = Math.max(w / 2 + 4, Math.min(view.cssW - w / 2 - 4, s.x + p.sideSign * gap));
        y = Math.max(insets.top + 6, topY - 10 - rise);
      } else {
        y = Math.max(insets.top + 6, y);
      }
      p.drawX = x; p.drawY = y;
      ctx.globalAlpha = Math.min(1, p.life * 3);
      var nStars = P.starsFor(p.acc, C.stars);
      if (p.mode === 'challenge') {
        ctx.font = '800 22px ' + FONT;
        outlinedText('적중률 ' + p.acc + '%', x, y + 18, '#FFFFFF', 5);
      } else {
        for (var k = 0; k < 3; k++) {
          starPath(ctx, x - 26 + k * 26, y + 18, 10, 0);
          ctx.fillStyle = k < nStars ? '#FFE066' : '#E9E4DA'; ctx.fill();
          ctx.strokeStyle = k < nStars ? '#B07F00' : '#7A7380'; ctx.lineWidth = 2; ctx.stroke();
        }
      }
      ctx.font = '800 18px ' + FONT;
      outlinedText(F.hitWord(p.acc), x, y + 42, '#FFFFFF', 4);
      // 10칸 색 막대 (%는 늘 색 막대와 함께)
      var bw = 120, bh = 10, bx = x - bw / 2, by = y + 58;
      rr(ctx, bx, by, bw, bh, 5); ctx.fillStyle = '#E9E4DA'; ctx.fill();
      if (p.acc > 0) { rr(ctx, bx, by, Math.max(bh, bw * p.acc / 100), bh, 5); ctx.fillStyle = R.accColor(p.acc); ctx.fill(); }
      ctx.strokeStyle = 'rgba(58,46,57,0.35)'; ctx.lineWidth = 1;
      for (var t = 1; t < 10; t++) { ctx.beginPath(); ctx.moveTo(bx + bw * t / 10, by); ctx.lineTo(bx + bw * t / 10, by + bh); ctx.stroke(); }
      rr(ctx, bx, by, bw, bh, 5); ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // 피해 % 글씨 (맞은 탱크 위로 떠올랐다 약 1.2초 뒤 사라짐) — 예: "-45%"
  R.showDamage = function (x, y, dmg) {
    var d = C.timing.damageFloat;
    dmgFloats.push({ x: x, y: y, text: '-' + dmg + '%', life: d, max: d });
  };
  function drawDamageFloats(dt) {
    for (var i = dmgFloats.length - 1; i >= 0; i--) {
      var f = dmgFloats[i];
      f.life -= dt;
      if (f.life <= 0) { dmgFloats.splice(i, 1); continue; }
      var k = 1 - f.life / f.max;
      var s = R.toScreen(f.x, f.y);
      var y = Math.max(insets.top + 16, tankTopScreenY(f.x, f.y) - 16 - k * 22);
      var x = Math.max(40, Math.min(view.cssW - 40, s.x));
      ctx.globalAlpha = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
      ctx.font = '900 24px ' + FONT;
      outlinedText(f.text, x, y, '#FFE066', 5);
      ctx.globalAlpha = 1;
    }
  }

  // 「Great!」 (피해 40 이상, 사람이 쐈을 때) — 톡 튀어나오듯 커졌다가 사라짐
  R.showGreat = function () { great = { t: 0 }; };
  function drawGreat(dt) {
    if (!great) return;
    great.t += dt;
    var t = great.t, dur = C.timing.great;
    if (t >= dur) { great = null; return; }
    // 크기: 0.5 → 1.15 (0.18초) → 1 (0.12초)
    var sc = t < 0.18 ? 0.5 + 0.65 * easeOut(t / 0.18)
           : (t < 0.30 ? 1.15 - 0.15 * ((t - 0.18) / 0.12) : 1);
    var alpha = t > dur - 0.25 ? Math.max(0, (dur - t) / 0.25) : 1;
    var cx = view.cssW / 2;
    var cy = insets.top + (view.cssH - insets.top - insets.bottom) * 0.55;   // 말풍선과 겹치지 않게 조금 아래
    var size = Math.max(44, Math.min(84, view.cssH * 0.13));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.font = '900 ' + Math.round(size) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    var g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, '#FFE45C');
    g.addColorStop(1, '#FF9A1F');
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(6, size * 0.12);
    ctx.strokeText('Great!', 0, 0);
    ctx.fillStyle = g; ctx.fillText('Great!', 0, 0);
    // 반짝이는 작은 별 4개 (폭발 아님)
    var w = ctx.measureText('Great!').width;
    for (var i = 0; i < 4; i++) {
      var sx = (i % 2 === 0 ? -1 : 1) * (w / 2 + 14 + (i > 1 ? 10 : 0));
      var sy = (i < 2 ? -1 : 1) * size * 0.38;
      var tw = 0.6 + 0.4 * Math.sin(t * 12 + i * 1.7);
      starPath(ctx, sx, sy, size * 0.14 * tw, t * 2 + i);
      ctx.fillStyle = '#FFF3A6'; ctx.fill();
      ctx.strokeStyle = '#B07F00'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
  }

  // 승리 순간 큰 별
  R.showBigStar = function (x, y) { bigStar = { x: x, y: y, t: 0 }; };
  function drawBigStar(dt) {
    if (!bigStar) return;
    bigStar.t += dt;
    var k = Math.min(1, bigStar.t / 0.5);
    var r = 6 + 20 * k;
    starPath(ctx, bigStar.x, bigStar.y - 90 * R.tankScale(), r, bigStar.t * 0.8);
    ctx.fillStyle = '#FFE066'; ctx.fill();
    ctx.strokeStyle = '#E0A800'; ctx.lineWidth = 2.5; ctx.stroke();
  }

  // 색종이 (결과 화면)
  R.startConfetti = function () {
    confetti = [];
    for (var i = 0; i < 70; i++) confetti.push(newConfetto(true));
  };
  R.stopConfetti = function () { confetti = null; bigStar = null; };
  function newConfetto(anywhere) {
    var cols = ['#4FB6F0', '#FF9A3C', '#6CCB5F', '#A78BFA', '#FFE066', '#FFB3C7'];
    return {
      x: Math.random() * view.cssW,
      y: anywhere ? Math.random() * view.cssH : -10,
      vy: 30 + Math.random() * 40, sway: Math.random() * 6, rot: Math.random() * 6,
      s: 5 + Math.random() * 5, c: cols[Math.floor(Math.random() * cols.length)], round: Math.random() < 0.4
    };
  }
  function drawConfetti(dt) {
    if (!confetti) return;
    for (var i = 0; i < confetti.length; i++) {
      var p = confetti[i];
      p.y += p.vy * dt; p.rot += dt * 2; p.sway += dt * 1.5;
      var x = p.x + Math.sin(p.sway) * 12;
      if (p.y > view.cssH + 12) confetti[i] = newConfetto(false);
      ctx.fillStyle = p.c;
      if (p.round) { circle(ctx, x, p.y, p.s / 2); ctx.fill(); }
      else {
        ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); ctx.restore();
      }
    }
  }

  R.clearEffects = function () { particles = []; popups = []; dmgFloats = []; great = null; bigStar = null; };

  // ---------- 한 장면 그리기 ----------
  R.draw = function (G, dt) {
    if (!ctx) return;
    clock += dt;
    updateParticles(dt);
    updateCam(dt);
    drawSky(dt);
    if (G && G.terrain && G.screen !== 'start') {
      setWorld();
      drawTerrain(G.terrain);
      var cur = G.players[G.current];
      var showAimStuff = G.screen === 'battle' && (G.phase === 'aim' || G.phase === 'intro');
      if (showAimStuff) drawTrails(cur, G.terrain);
      for (var i = 0; i < G.players.length; i++) {
        var pl = G.players[i];
        drawTank(ctx, {
          x: pl.x, y: pl.drawY, tilt: pl.tilt, colorIdx: pl.colorIdx, pIdx: i,
          angleDeg: P.aimToActual(pl.aim, pl.mode).angleDeg, dir: pl.aim.dir, facing: pl.facing,
          face: pl.face, splats: pl.splats, recoil: pl.recoil, t: clock + i * 0.7, wheel: pl.wheel,
          isRobo: pl.isRobo,
          blink: pl.isRobo && G.robo && G.current === i && (G.robo.step === 'think' || G.robo.step === 'aim')
        });
        drawMiniHp(pl.x, pl.drawY, pl.displayHp);
      }
      if (G.screen === 'battle' && G.phase === 'aim') drawAim(cur);
      if (G.shell) drawShell(G.shell);
      drawParticles();
      drawBigStar(dt);
      setScreen();
      if (showAimStuff) drawFlagLabels(cur, G.terrain);
      if (G.shell) drawOffscreenMarker(G.shell);
      // 새총 고무줄 (끄는 동안)
      if (G.drag && G.drag.active && G.drag.moved) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(58,46,57,0.55)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(G.drag.sx, G.drag.sy); ctx.lineTo(G.drag.cx, G.drag.cy); ctx.stroke();
        ctx.setLineDash([]);
        circle(ctx, G.drag.sx, G.drag.sy, 10); ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2; ctx.stroke();
        circle(ctx, G.drag.cx, G.drag.cy, 7); ctx.fillStyle = C.colors[cur.colorIdx].body; ctx.fill(); ctx.stroke();
      }
      drawPopups(dt);
      drawDamageFloats(dt);
      drawGreat(dt);
    }
    setScreen();
    drawConfetti(dt);
  };

  // 시작 화면 탱크 미리보기
  // isRobo: Robo 탱크면 안테나·전구를 함께 그림
  R.drawTankPreview = function (cv, colorIdx, pIdx, t, isRobo) {
    var c = cv.getContext('2d');
    var dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    var w = cv.clientWidth || 96, h = cv.clientHeight || 64;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var sc = Math.min(w / 80, h / 66) / R.tankScale();   // 미리보기는 늘 같은 크기
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#6CC24A';
    rr(c, 4, h - 10, w - 8, 8, 4); c.fill();
    c.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * w / 2, dpr * (h - 8));
    var facing = pIdx === 0 ? 1 : -1;
    drawTank(c, { x: 0, y: 0, tilt: 0, colorIdx: colorIdx, pIdx: pIdx, angleDeg: 30, dir: facing, facing: facing, face: 'idle', t: t || 0, wheel: 0, isRobo: !!isRobo });
  };

  MF.Render = R;
})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================
   ui.js — 화면 위 글자·버튼 (HTML 부분)
   - 시작 화면, 위쪽 정보판, 아래 조작판, 조준 숫자, 말풍선, 결과 화면
   - 게임 규칙은 game.js가 정하고, 이 파일은 보여 주기와 버튼 연결만 합니다.
   - [요청-003] 이름은 입력하지 않고 Config.names 3개 중 버튼으로 고릅니다.
     (이름은 늘 textContent로만 넣습니다)
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};
  var C = MF.Config, F = MF.Feedback, P = MF.Physics;
  var doc = root.document;
  var U = {};
  var $ = function (id) { return doc.getElementById(id); };
  var handlers = {};
  var startState = null;   // 시작 화면에서 고른 값 { opp: 'human'|'robo', players: [{ name, colorIdx, mode }, ...] }
  var previewTimer = null;
  var previewBounce = [0, 0];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 버튼에 "눌렀다 떼기"를 마우스·터치 모두로 연결
  function holdButton(el, onDown, onUp) {
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (el.disabled) return;
      try { el.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
      el.classList.add('pressed');
      onDown();
    });
    var up = function () { el.classList.remove('pressed'); onUp(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  function tap(el, fn) {
    el.addEventListener('click', function (e) {
      if (el.disabled) return;
      MF.Sound.playClick();
      fn(e);
    });
  }

  // ---------- 시작 ----------
  U.init = function (h) {
    handlers = h;
    tap($('btn-start'), function () { handlers.onStart(U.readStart()); });
    tap($('btn-fire'), function () { handlers.onFire(); });
    tap($('btn-pause'), function () { handlers.onPause(); });
    tap($('btn-resume'), function () { handlers.onResume(); });
    tap($('btn-home-pause'), function () { handlers.onHome(); });
    tap($('btn-home'), function () { handlers.onHome(); });
    tap($('btn-again'), function () { handlers.onAgain(); });
    $('btn-sound').addEventListener('click', function () {
      handlers.onSoundToggle();
    });
    holdButton($('btn-left'), function () { handlers.onMoveHold(-1); }, function () { handlers.onMoveRelease(-1); });
    holdButton($('btn-right'), function () { handlers.onMoveHold(1); }, function () { handlers.onMoveRelease(1); });
    for (var i = 0; i < 2; i++) setupCard(i);
    Array.prototype.forEach.call($('opp-select').querySelectorAll('.btn.opp'), function (b) {
      tap(b, function () {
        startState.opp = b.dataset.opp;
        fixNames(1);
        refreshStart();
      });
    });
  };

  // 두 선수가 같은 이름이면 i번 선수 이름을 남은 이름 중 첫째로 바꿈
  function fixNames(i) {
    var ps = startState.players;
    if (ps[i].name !== ps[1 - i].name && C.names.indexOf(ps[i].name) >= 0) return;
    for (var k = 0; k < C.names.length; k++) {
      if (C.names[k] !== ps[1 - i].name) { ps[i].name = C.names[k]; return; }
    }
  }

  function setupCard(i) {
    var box = $('colors-' + i);
    C.colors.forEach(function (col, ci) {
      var b = doc.createElement('button');
      b.className = 'color-dot';
      b.style.background = col.body;
      b.setAttribute('aria-label', col.name + ' 색');
      b.dataset.ci = ci;
      tap(b, function () {
        startState.players[i].colorIdx = ci;
        previewBounce[i] = 0.4;
        refreshStart();
      });
      box.appendChild(b);
    });
    var modeBtns = $('modes-' + i).querySelectorAll('.btn.mode');
    Array.prototype.forEach.call(modeBtns, function (b) {
      tap(b, function () { startState.players[i].mode = b.dataset.mode; refreshStart(); });
    });
    // 이름 버튼 3개 (Enoch / Moses / Joshua)
    var nb = $('names-' + i);
    C.names.forEach(function (nm) {
      var b = doc.createElement('button');
      b.className = 'btn name';
      b.textContent = nm;
      b.dataset.name = nm;
      tap(b, function () { startState.players[i].name = nm; previewBounce[i] = 0.4; refreshStart(); });
      nb.appendChild(b);
    });
  }

  // prefs = { opp, players: [{ name, colorIdx, mode }, { ... }] }
  U.buildStart = function (prefs) {
    startState = {
      opp: prefs.opp === 'robo' ? 'robo' : 'human',
      players: prefs.players.map(function (p) { return { name: p.name, colorIdx: p.colorIdx, mode: p.mode }; })
    };
    fixNames(1); fixNames(0);   // 2번(Robo전에서는 숨은 이름)을 먼저 비켜 1번이 고른 이름을 지킴 [오류-004]
    refreshStart();
    if (!previewTimer) {
      var last = performance.now();
      previewTimer = setInterval(function () {
        if ($('screen-start').classList.contains('hidden')) return;
        var now = performance.now(), dt = (now - last) / 1000; last = now;
        for (var k = 0; k < 2; k++) {
          previewBounce[k] = Math.max(0, previewBounce[k] - dt);
          var cv = $('preview-' + k);
          var hop = previewBounce[k] > 0 ? Math.sin(previewBounce[k] / 0.4 * Math.PI) * 6 : 0;
          cv.style.transform = 'translateY(' + (-hop) + 'px)';
          MF.Render.drawTankPreview(cv, startState.players[k].colorIdx, k, now / 1000 + k, k === 1 && startState.opp === 'robo');
        }
      }, 50);
    }
  };

  function refreshStart() {
    var robo = startState.opp === 'robo';
    var ps = startState.players;
    Array.prototype.forEach.call($('opp-select').querySelectorAll('.btn.opp'), function (b) {
      var on = b.dataset.opp === startState.opp;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    for (var i = 0; i < 2; i++) {
      var me = ps[i], otherP = ps[1 - i];
      var dots = $('colors-' + i).querySelectorAll('.color-dot');
      Array.prototype.forEach.call(dots, function (d) {
        var ci = +d.dataset.ci;
        d.classList.toggle('selected', ci === me.colorIdx);
        d.disabled = ci === otherP.colorIdx;   // 상대가 고른 색은 고를 수 없음
      });
      var modeBtns = $('modes-' + i).querySelectorAll('.btn.mode');
      Array.prototype.forEach.call(modeBtns, function (b) {
        b.classList.toggle('selected', b.dataset.mode === me.mode);
      });
      var nameBtns = $('names-' + i).querySelectorAll('.btn.name');
      Array.prototype.forEach.call(nameBtns, function (b) {
        b.classList.toggle('selected', b.dataset.name === me.name);
        // 상대가 고른 이름은 고를 수 없음 (Robo와 겨룰 때 1번 선수는 셋 다 가능)
        b.disabled = !(robo && i === 0) && b.dataset.name === otherP.name;
      });
      $('start-icon-' + i).style.background = C.colors[me.colorIdx].body;
      $('mode-note-' + i).textContent = me.mode === 'sprout'
        ? '새싹 모드는 포탄이 조금 더 넓게 퍼져요!' : '각도기를 보며 1도씩 맞춰요';
    }
    // Robo 모드: 2번 카드는 「Robo」 고정 (이름·새싹/도전 버튼 숨김, 색은 고를 수 있음)
    $('names-1').classList.toggle('hidden', robo);
    $('robo-tag').classList.toggle('hidden', !robo);
    $('card-1').classList.toggle('robo', robo);   // Robo전 카드 표시 (색 줄 아래 여백용)
    $('modes-1').classList.toggle('hidden', robo);
    $('card-head-1').textContent = robo ? '상대' : '2번 선수';
    if (robo) $('mode-note-1').textContent = 'Robo는 내 실력에 맞춰 겨뤄 줘요!';
  }

  // 돌려주는 값: { opp, players: [{ name, colorIdx, mode, isRobo }], prefs(다음에 시작 화면을 되살릴 값) }
  U.readStart = function () {
    var robo = startState.opp === 'robo';
    var prefs = {
      opp: startState.opp,
      players: startState.players.map(function (p) { return { name: p.name, colorIdx: p.colorIdx, mode: p.mode }; })
    };
    var players = startState.players.map(function (p, i) {
      if (robo && i === 1) return { name: C.robo.name, colorIdx: p.colorIdx, mode: C.robo.mode, isRobo: true };
      return { name: p.name, colorIdx: p.colorIdx, mode: p.mode, isRobo: false };
    });
    return { opp: startState.opp, players: players, prefs: prefs };
  };

  // ---------- 화면 바꾸기 ----------
  U.showScreen = function (name) {
    $('screen-start').classList.toggle('hidden', name !== 'start');
    $('screen-result').classList.toggle('hidden', name !== 'result');
    var battle = name === 'battle';
    $('hud-top').classList.toggle('hidden', !battle);
    $('panel').classList.toggle('hidden', !battle);
    $('turn-glow').classList.toggle('hidden', !battle);
    $('btn-pause').classList.toggle('hidden', !battle);
    if (!battle) { U.hideReadout(); U.hideMessage(); U.hideBanner(); }
    U.showPause(false);
  };

  U.insets = function () {
    var top = 60, bottom = 90;
    var hud = $('hud-top'), panel = $('panel');
    if (hud && !hud.classList.contains('hidden')) top = hud.getBoundingClientRect().bottom;
    if (panel && !panel.classList.contains('hidden')) bottom = root.innerHeight - panel.getBoundingClientRect().top;
    return { top: top, bottom: bottom };
  };

  // ---------- 위쪽 정보판 ----------
  U.updateHud = function (G) {
    for (var i = 0; i < 2; i++) {
      var pl = G.players[i];
      $('pname-' + i).textContent = pl.name;
      $('picon-' + i).style.background = C.colors[pl.colorIdx].body;
      var fill = $('hpfill-' + i);
      fill.style.width = Math.max(0, pl.hp) + '%';
      fill.style.backgroundColor = MF.Render.hpColor(pl.hp);
      // 도전 모드 선수는 숫자도, 새싹 모드 선수는 막대만
      $('hpnum-' + i).textContent = pl.mode === 'challenge' ? '체력 ' + pl.hp + '%' : '';
    }
    var cur = G.players[G.current];
    $('turn-text').textContent = (G.current === 0 ? '◀ ' : '') + cur.name + ' 차례' + (G.current === 1 ? ' ▶' : '');
    $('shot-count').textContent = '발사 ' + Math.min(cur.shots.length + 1, C.edu.maxShotsPerPlayer) + ' / ' + C.edu.maxShotsPerPlayer;
  };

  U.setTurnColor = function (hex) {
    doc.documentElement.style.setProperty('--turn-color', hex);
  };

  // ---------- 아래 조작판 ----------
  U.setPanel = function (G) {
    var cur = G.players[G.current];
    var roboTurn = !!cur.isRobo;
    var on = G.phase === 'aim' && !G.paused && !roboTurn;   // Robo 차례에는 사람 조작을 막음
    var panel = $('panel');
    panel.classList.toggle('off', !on);
    panel.classList.toggle('big', cur.mode === 'sprout');
    var range = C.players.rangeX[G.current];
    $('btn-left').disabled = !on || cur.moveLeft <= 0.01 || cur.x <= range[0] + 0.01;
    $('btn-right').disabled = !on || cur.moveLeft <= 0.01 || cur.x >= range[1] - 0.01;
    // 꺼진 이동 버튼에 눌린 모양이 남지 않게
    ['btn-left', 'btn-right'].forEach(function (id) { if ($(id).disabled) $(id).classList.remove('pressed'); });
    $('btn-fire').disabled = !on;
    $('btn-fire').classList.toggle('breathe', on && !cur.aimTouched);
    var n = Math.ceil(cur.moveLeft / C.edu.stepUnit - 0.001);
    var steps = $('steps'), total = Math.round(C.edu.moveLimitPerTurn / C.edu.stepUnit);
    if (steps.children.length !== total) {
      steps.innerHTML = '';
      for (var k = 0; k < total; k++) steps.appendChild(doc.createElement('span'));
    }
    for (var j = 0; j < total; j++) steps.children[j].classList.toggle('on', j < n);
    var hint;
    if (G.phase === 'flight') hint = '포탄이 날아가요…';
    else if (roboTurn && (G.phase === 'aim' || G.phase === 'intro')) {
      hint = G.robo && G.robo.step === 'aim' ? 'Robo가 조준하고 있어요…' : 'Robo가 생각하고 있어요…';
    } else if (!on) hint = '';
    else if (cur.mode === 'sprout') hint = '화면을 끌어 당겨 보세요! 반대쪽으로 날아가요';
    else hint = '끌어서 조준 · 발사! 버튼으로 쏘기';
    var hintEl = $('panel-hint');
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
  };

  // ---------- 조준 숫자 ([요청-003]) ----------
  // - 형식: 도전 "power 100  angle 45°" / 새싹 "power 7  angle ⑥"
  // - 자리: 쏘는 탱크 쪽 위 구석(왼쪽 탱크 → 왼쪽 위), 위쪽 정보판 바로 아래.
  //   두 탱크 화면 상자(포신 포함, 여유 12px)와 겹치면 ②조금 아래 ③더 아래 ④가운데 쪽 위 순서로 비킴
  // - 내 차례 시작: 지난번 값을 흐리게(.7) → 끌기 시작하면 0.25초 동안 지금 값으로 바뀌며 진하게
  var ro = {
    visible: false, pl: null, side: 'left', dim: false,
    shownA: 0, shownP: 0, fromA: 0, fromP: 0, t: 0, dur: 0,
    key: '', w: 0, h: 0, x: 0, y: 0, spot: 0
  };
  function readoutHtml(a, p, mode, back) {
    var ang = F.angleText(a, mode);
    var html = '<div class="ar-main"><span class="ar-lab">power</span><span class="ar-num">' + p +
      '</span><span class="ar-lab ar-sep">angle</span><span class="ar-num">' + esc(ang) + '</span></div>';
    if (back) html += '<div class="ar-back">뒤쪽으로 쏘아요</div>';
    return html;
  }
  function renderReadout() {
    var el = $('aim-readout'), pl = ro.pl;
    var a = Math.round(ro.shownA), p = Math.round(ro.shownP);
    var back = pl.aim.dir !== pl.facing;
    var key = a + '|' + p + '|' + pl.mode + '|' + back;
    if (key !== ro.key) {
      el.innerHTML = readoutHtml(a, p, pl.mode, back);
      ro.key = key;
      ro.w = el.offsetWidth; ro.h = el.offsetHeight;
    }
    el.classList.toggle('dim', ro.dim);
  }
  // side: 'left' | 'right', dim: 흐리게 보이기(지난번 값)
  U.showReadout = function (pl, side, dim) {
    var el = $('aim-readout');
    ro.pl = pl; ro.side = side; ro.dim = !!dim;
    ro.shownA = pl.aim.angleValue; ro.shownP = pl.aim.powerValue;
    ro.t = 0; ro.dur = 0; ro.key = '';
    el.className = pl.mode + (ro.dim ? ' dim' : '');
    ro.visible = true;
    renderReadout();
    placeReadout(null);
  };
  // 끌기를 시작한 순간(또는 Robo가 조준을 시작한 순간): 지금 값으로 바뀌며 진하게
  U.wakeReadout = function (dur) {
    if (!ro.visible || !ro.pl) return;
    ro.fromA = ro.shownA; ro.fromP = ro.shownP;
    ro.t = 0; ro.dur = dur || 0; ro.dim = false;
    renderReadout();
  };
  // 매 장면: 숫자 바꾸기 + 탱크와 겹치지 않는 자리 찾기
  // boxes: 두 탱크의 화면 상자 [{ x1, y1, x2, y2 }]
  U.tickReadout = function (dt, boxes) {
    if (!ro.visible || !ro.pl) return;
    var aim = ro.pl.aim;
    if (ro.dim) {                       // 흐린 동안은 지난번 값 그대로
      ro.shownA = aim.angleValue; ro.shownP = aim.powerValue;
    } else if (ro.t < ro.dur) {         // 0.25초 동안 부드럽게
      ro.t += dt;
      var k = Math.min(1, ro.t / ro.dur), e = 1 - Math.pow(1 - k, 3);
      ro.shownA = ro.fromA + (aim.angleValue - ro.fromA) * e;
      ro.shownP = ro.fromP + (aim.powerValue - ro.fromP) * e;
    } else {
      ro.shownA = aim.angleValue; ro.shownP = aim.powerValue;
    }
    renderReadout();
    placeReadout(boxes);
  };
  function overlaps(x, y, w, h, b, pad) {
    return x < b.x2 + pad && x + w > b.x1 - pad && y < b.y2 + pad && y + h > b.y1 - pad;
  }
  function placeReadout(boxes) {
    var el = $('aim-readout');
    var W = root.innerWidth, w = ro.w || el.offsetWidth, h = ro.h || el.offsetHeight;
    var hud = $('hud-top');
    var top0 = (hud && !hud.classList.contains('hidden') ? hud.getBoundingClientRect().bottom : 60) + 6;
    var left = ro.side === 'left';
    var cornerX = left ? 10 : W - w - 10;
    var spots = [
      { x: cornerX, y: top0 },                                // ① 구석
      { x: cornerX, y: top0 + h + 8 },                        // ② 조금 아래
      { x: cornerX, y: top0 + (h + 8) * 2 },                  // ③ 더 아래
      { x: left ? W / 2 - w - 14 : W / 2 + 14, y: top0 }      // ④ 가운데 쪽 위
    ];
    var pick = 0;
    if (boxes && boxes.length) {
      pick = -1;
      for (var i = 0; i < spots.length && pick < 0; i++) {
        var free = true;
        for (var j = 0; j < boxes.length; j++) {
          if (overlaps(spots[i].x, spots[i].y, w, h, boxes[j], 16)) { free = false; break; }   // 여유 12 → 16px
        }
        if (free) pick = i;
      }
      if (pick < 0) {   // 모두 겹치면 겹치는 넓이가 가장 작은 자리
        var bestArea = Infinity;
        for (var s2 = 0; s2 < spots.length; s2++) {
          var area = 0;
          for (var b2 = 0; b2 < boxes.length; b2++) {
            var bx = boxes[b2];
            var ox = Math.min(spots[s2].x + w, bx.x2) - Math.max(spots[s2].x, bx.x1);
            var oy = Math.min(spots[s2].y + h, bx.y2) - Math.max(spots[s2].y, bx.y1);
            if (ox > 0 && oy > 0) area += ox * oy;
          }
          if (area < bestArea) { bestArea = area; pick = s2; }
        }
      }
    }
    var sp = spots[pick];
    if (Math.round(sp.x) !== ro.x || Math.round(sp.y) !== ro.y) {
      ro.x = Math.round(sp.x); ro.y = Math.round(sp.y);
      el.style.left = ro.x + 'px';
      el.style.top = ro.y + 'px';
    }
    ro.spot = pick + 1;
    el.classList.remove('hidden');
  }
  U.hideReadout = function () { ro.visible = false; $('aim-readout').classList.add('hidden'); };
  // 품질검사부 확인용: 지금 조준 숫자 상태
  U.readoutInfo = function () {
    var el = $('aim-readout');
    return {
      visible: ro.visible, text: el.textContent, dim: ro.dim, side: ro.side,
      spot: ro.spot, left: ro.x, top: ro.y, width: ro.w, height: ro.h
    };
  };

  // ---------- 말풍선 ----------
  var msgTimer = null;
  U.showMessage = function (main, sub, ms) {
    $('msg-main').textContent = main || '';
    $('msg-sub').textContent = sub || '';
    var el = $('message');
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    if (msgTimer) clearTimeout(msgTimer);
    if (ms) msgTimer = setTimeout(U.hideMessage, ms);
  };
  U.hideMessage = function () { $('message').classList.add('hidden'); };

  U.showBanner = function (text) {
    var el = $('turn-banner');
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  };
  U.hideBanner = function () { $('turn-banner').classList.add('hidden'); };

  U.showPause = function (on) { $('screen-pause').classList.toggle('hidden', !on); };

  U.setSoundButton = function (on) {
    $('btn-sound').innerHTML = '<span>♪</span> <span class="snd-text">' + (on ? '소리 켜짐' : '소리 꺼짐') + '</span>' + (on ? '' : '<span> ✕</span>');
    $('btn-sound').setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  // ---------- 결과 화면 ----------
  // data = { winner: 0|1|null(무승부), players: [{ name, colorIdx, mode, msg, stats }] }
  U.showResult = function (data) {
    var t = $('result-title');
    if (data.winner === null) {
      t.textContent = '★ 무승부! 둘 다 잘했어요 ★';
      t.style.color = '#FFFFFF';
    } else {
      t.textContent = '★ ' + data.players[data.winner].name + ' 승리! ★';
      t.style.color = C.colors[data.players[data.winner].colorIdx].light;
    }
    for (var i = 0; i < 2; i++) {
      var p = data.players[i], s = p.stats, col = C.colors[p.colorIdx];
      var el = $('rcard-' + i);
      el.style.borderColor = col.dark;
      var html = '<div class="rc-name"><span class="picon ' + (i === 0 ? 'round' : 'tri') + ' small-icon" style="background:' + col.body + '"></span><span class="nm"></span></div>';
      html += '<div class="rc-msg"></div>';
      html += '<div class="rc-line">' + s.shots + '번 쏘아서 ' + s.hits + '번 적중</div>';
      if (s.bestAcc === 0) {
        if (s.bestSteps !== null) html += '<div class="rc-line">가장 가까운 한 발 ' + s.bestSteps + '걸음 차이</div>';
      } else if (p.mode === 'challenge') {
        html += '<div class="rc-line">가장 높은 적중률 ' + s.bestAcc + '%<span class="rc-bar"><i style="width:' + s.bestAcc + '%;background:' + MF.Render.accColor(s.bestAcc) + '"></i></span></div>';
      } else {
        var n = P.starsFor(s.bestAcc, C.stars);
        if (n > 0) html += '<div class="rc-line">가장 가까운 한 발 <span class="rc-stars">' + '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n) + '</span><span class="rc-bar"><i style="width:' + s.bestAcc + '%;background:' + MF.Render.accColor(s.bestAcc) + '"></i></span></div>';
        else if (s.bestSteps !== null) html += '<div class="rc-line">가장 가까운 한 발 ' + s.bestSteps + '걸음 차이</div>';
      }
      if (s.bestImprove > 0 && !p.isRobo) html += '<div class="rc-line">한 번에 ' + s.bestImprove + '걸음 가까워짐!</div>';
      el.innerHTML = html;
      el.querySelector('.nm').textContent = p.name;
      el.querySelector('.rc-msg').textContent = p.msg;
    }
    U.showScreen('result');
  };

  MF.UI = U;
})(typeof window !== 'undefined' ? window : globalThis);

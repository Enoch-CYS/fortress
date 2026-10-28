/* =========================================================
   game.js — 게임 진행 (차례, 조준, 발사, 맞힘, 승패)
   - 한 턴 순서: 차례 안내 → 이동·조준 → 발사(카메라가 포탄을 따라감) → 결과 말풍선 → 상대 차례
   - [요청-003] Robo 상대: 생각 중(1초) → 조준 숫자가 부드럽게 바뀜(0.6초) → 자동 발사
   - 계산은 physics.js / terrain.js / feedback.js 순수 함수에 맡기고,
     그림은 render.js, 글자·버튼은 ui.js에 맡깁니다.
   - 품질검사부 콘솔 도구: MF.Game.debug (맨 아래 참고)
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF;
  var C = MF.Config, P = MF.Physics, T = MF.Terrain, F = MF.Feedback;
  var S = MF.Sound, R = MF.Render, U = MF.UI;

  // ---------- 게임 상태 (한곳에 모아 둠) ----------
  var G = {
    screen: 'start',      // 'start' | 'battle' | 'result'
    phase: 'aim',         // 'intro' | 'aim' | 'flight' | 'impact' | 'ending'
    paused: false,
    players: [],
    current: 0,
    terrain: null,
    seed: 0,
    shell: null,
    drag: { active: false, moved: false },
    readoutSide: 'left',  // 조준 숫자 자리: 쏘는 탱크 쪽 (왼쪽 탱크 → 왼쪽 위)
    opp: 'human',         // 'human' | 'robo'
    robo: null,           // Robo 상태 { missDist, step, t, from, to, shots, last }
    time: 0,
    phaseTime: 0,
    phaseDur: 0,
    timers: [],
    rot: {},              // 칭찬 문구 돌려쓰기
    encourageRot: {},     // 격려 문구 돌려쓰기
    moveHold: 0,
    moveLimitSignaled: false,
    setup: null,          // 시작 화면에서 고른 값 (다시 하기에 사용)
    firstThisGame: 0,
    pendingEnd: null,
    result: null
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function after(sec, fn) { G.timers.push({ at: G.time + sec, fn: fn }); }

  // ---------- 선수 만들기 ----------
  function makePlayer(i, s) {
    var m = C.modes[s.mode];
    var facing = i === 0 ? 1 : -1;
    return {
      idx: i, name: s.name, colorIdx: s.colorIdx, mode: s.mode, facing: facing, isRobo: !!s.isRobo,
      hp: C.edu.startHp, displayHp: C.edu.startHp,
      x: C.players.startX[i], y: 0, drawY: 0, tilt: 0,
      aim: { angleValue: m.defaultAngle, powerValue: m.defaultPower, dir: facing },
      aimTouched: false,
      lastAim: null,
      moveLeft: C.edu.moveLimitPerTurn,
      shots: [], trails: [], flags: [], splats: [],
      face: 'idle', faceUntil: 0, recoil: 0, wheel: 0,
      stats: { shots: 0, hits: 0, bestAcc: 0, bestSteps: null, bestImprove: 0 }
    };
  }

  // ① 땅이 파이면 탱크도 함께 내려앉음
  function settleTank(pl, instant) {
    var hw = C.tank.hitW / 2;
    pl.y = T.tankRestY(G.terrain, pl.x, hw);
    pl.tilt = T.tankTilt(G.terrain, pl.x, hw);
    if (instant) pl.drawY = pl.y;
  }
  function settleTanks(instant) { G.players.forEach(function (pl) { settleTank(pl, instant); }); }

  function newSeed() {
    var q = /[?&]seed=(\d+)/.exec(root.location ? root.location.search : '');
    if (q) return +q[1];
    return (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0;
  }

  // 상대 탱크를 포탄 계산용 과녁으로
  function targetOf(pl) {
    return { id: pl.idx, x: pl.x, top: pl.y - C.tank.hitH, bottom: pl.y + 2, halfW: C.tank.hitW / 2 };
  }
  function heightAt(x) { return T.surfaceAt(G.terrain, x); }

  // ---------- 판 시작 ----------
  // setup = { opp: 'human'|'robo', players: [{ name, colorIdx, mode, isRobo }, ...], prefs }
  function startGame(setup, firstIdx) {
    G.setup = setup;
    G.opp = setup.opp === 'robo' ? 'robo' : 'human';
    G.seed = newSeed();
    G.terrain = T.generate(G.seed, C);
    G.players = [makePlayer(0, setup.players[0]), makePlayer(1, setup.players[1])];
    G.robo = { missDist: C.robo.startMiss, step: 'idle', t: 0, from: null, to: null, shots: 0, last: null };
    G.shell = null; G.pendingEnd = null; G.result = null; G.timers = [];
    G.paused = false; G.moveHold = 0; G.drag.active = false;
    G.screen = 'battle';
    G.firstThisGame = firstIdx;
    R.clearEffects(); R.stopConfetti(); R.camReset();
    settleTanks(true);
    U.showScreen('battle');
    U.updateHud(G);
    refreshInsets();
    beginTurn(firstIdx);
  }

  // 첫 판은 새싹 모드 선수가 먼저 (둘 다 같으면 1번)
  function firstPlayerFor(setup) {
    var ps = setup.players;
    if (ps[1].isRobo) return 0;   // Robo와 겨룰 때 첫 판은 사람이 먼저
    if (ps[0].mode !== ps[1].mode) return ps[0].mode === 'sprout' ? 0 : 1;
    return 0;
  }

  // ---------- 차례 ----------
  function beginTurn(idx) {
    G.current = idx;
    var cur = G.players[idx];
    cur.moveLeft = C.edu.moveLimitPerTurn;
    cur.aimTouched = false;
    G.moveHold = 0;
    G.phase = 'intro'; G.phaseTime = 0; G.phaseDur = C.timing.turnIntro;
    G.readoutSide = idx === 0 ? 'left' : 'right';   // 쏘는 탱크 쪽 위 구석
    G.robo.step = 'idle'; G.robo.t = 0;
    R.camReset();
    U.setTurnColor(C.colors[cur.colorIdx].body);
    U.hideMessage();
    // 지난번 값(첫 차례면 기본값)을 흐리게 보여 줌
    U.showReadout(cur, G.readoutSide, true);
    U.showBanner(cur.name + ' 차례예요!');
    U.updateHud(G);
    S.playTurnChange();
  }
  function endIntro() {
    if (G.phase !== 'intro') return;
    G.phase = 'aim';
    U.hideBanner();
    if (G.players[G.current].isRobo) { G.robo.step = 'think'; G.robo.t = 0; }
  }

  // ---------- Robo 차례 ----------
  // 빗나감 거리를 정하고, 그 자리에 떨어지는 각도·힘을 찾음 (현재 지형 기준)
  function planRoboShot() {
    var cur = G.players[G.current], opp = G.players[1 - G.current];
    // 기준값(baseMiss)에 그 순간의 체력 차 보정을 이번 발에만 더함 (보정은 쌓이지 않음)
    var base = G.robo.missDist;
    var m = MF.Robo.missFor(base, cur.hp, opp.hp, opp.mode, C.robo);
    var sign = Math.random() < 0.5 ? -1 : 1;   // 앞/뒤 어느 쪽으로 빗나갈지 (보상이 아니므로 무작위 사용)
    function aimAt(sg) {
      return MF.Robo.findAim({
        x: cur.x, y: cur.y, tilt: cur.tilt, dir: cur.facing, targetX: opp.x + sg * m,
        heightAt: heightAt, targets: [targetOf(opp)], cfg: C
      });
    }
    var res = aimAt(sign);
    // 목표가 상대 탱크 바로 뒤라 탱크에 가려지면(오차가 크면) 반대쪽으로 다시 찾기
    if (res.err > 6) {
      var res2 = aimAt(-sign);
      if (res2.err < res.err) { res = res2; sign = -sign; }
    }
    var targetX = opp.x + sign * m;
    G.robo.last = {
      baseMiss: Math.round(base * 10) / 10, missUsed: Math.round(m * 10) / 10, sign: sign, targetX: Math.round(targetX),
      angle: res.angleValue, power: res.powerValue,
      expectedImpactX: res.impactX === null ? null : Math.round(res.impactX),
      hpRobo: cur.hp, hpHuman: opp.hp
    };
    G.robo.missDist = MF.Robo.nextBase(base, C.robo);   // 다음 발 기준값은 보정 전 값 ×0.8 (최소 18)
    G.robo.shots++;
    return { a: res.angleValue, p: res.powerValue };
  }
  function easeInOut(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function updateRobo(dt) {
    var cur = G.players[G.current], rb = G.robo;
    if (!cur.isRobo || G.phase !== 'aim') return;
    rb.t += dt;
    if (rb.step === 'think' && rb.t >= C.robo.thinkTime) {
      rb.from = { a: cur.aim.angleValue, p: cur.aim.powerValue };
      rb.to = planRoboShot();
      rb.step = 'aim'; rb.t = 0;
      U.wakeReadout(0);   // 진하게 바꾸고 숫자는 조준과 함께 움직임
    } else if (rb.step === 'aim') {
      var k = Math.min(1, rb.t / C.robo.aimAnimTime), e = easeInOut(k);
      var a = Math.round(rb.from.a + (rb.to.a - rb.from.a) * e);
      var p = Math.round(rb.from.p + (rb.to.p - rb.from.p) * e);
      if (a !== cur.aim.angleValue) S.playAimTick('angle', a / 90);
      else if (p !== cur.aim.powerValue) S.playAimTick('power', p / 100);
      cur.aim = { angleValue: a, powerValue: p, dir: cur.facing };
      cur.aimTouched = true;
      if (k >= 1) { rb.step = 'wait'; rb.t = 0; }
    } else if (rb.step === 'wait' && rb.t >= C.robo.fireDelay) {
      rb.step = 'done';
      fire(true);
    }
  }

  // ---------- 새총식 끌기 조준 ----------
  function maxDrag() {
    var v = R.getView();
    return clamp(Math.min(v.cssW, v.cssH) * 0.34, 110, 200);
  }
  function canvasPoint(e) {
    var r = canvasEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onPointerDown(e) {
    if (G.screen !== 'battle' || G.paused) return;
    if (G.players[G.current].isRobo) return;      // Robo 차례에는 끌기 입력을 받지 않음
    if (!R.cameraIsFull()) return;                // 카메라가 전체 화면일 때만 조준
    if (G.phase === 'intro') endIntro();          // 차례 안내는 화면을 누르면 바로 넘어감
    if (G.phase !== 'aim') return;
    e.preventDefault();
    var p = canvasPoint(e);
    G.drag = { active: true, moved: false, id: e.pointerId, sx: p.x, sy: p.y, cx: p.x, cy: p.y };
    try { canvasEl.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
  }
  function onPointerMove(e) {
    var d = G.drag;
    if (!d.active || d.id !== e.pointerId || G.phase !== 'aim' || G.paused) return;
    e.preventDefault();
    var p = canvasPoint(e);
    d.cx = p.x; d.cy = p.y;
    var dx = d.cx - d.sx, dy = d.cy - d.sy;
    var cur = G.players[G.current];
    if (cur.isRobo) return;
    if (!d.moved && Math.sqrt(dx * dx + dy * dy) > 8) {
      d.moved = true;
      U.wakeReadout(C.timing.readoutWake);   // 끌기 시작: 0.25초 동안 지금 값으로 바뀌며 진하게
    }
    var a = P.dragToAim(dx, dy, maxDrag(), cur.mode, cur.aim.dir);
    if (!a) return;
    var sprout = cur.mode === 'sprout';
    if (a.angleValue !== cur.aim.angleValue || a.dir !== cur.aim.dir) S.playAimTick('angle', a.angleValue / (sprout ? 10 : 90));
    else if (a.powerValue !== cur.aim.powerValue) S.playAimTick('power', a.powerValue / (sprout ? 10 : 100));
    cur.aim = { angleValue: a.angleValue, powerValue: a.powerValue, dir: a.dir };
    cur.aimTouched = true;
    // 숫자 자리는 쏘는 탱크 쪽에 고정 (매 장면 U.tickReadout이 겹침을 보고 비킴)
  }
  function onPointerUp(e) {
    if (G.drag.id === e.pointerId) G.drag.active = false;   // 손을 떼도 발사하지 않고 값만 유지
  }

  // ---------- 발사 (발사 버튼으로만, Robo는 자동) ----------
  // byRobo: Robo가 스스로 쏠 때 true (Robo 차례에 사람이 발사 버튼을 눌러도 쏘지 않음)
  function fire(byRobo) {
    if (G.screen !== 'battle' || G.phase !== 'aim' || G.paused) return;
    var cur = G.players[G.current], opp = G.players[1 - G.current];
    if (cur.isRobo && byRobo !== true) return;
    var act = P.aimToActual(cur.aim, cur.mode);
    var mz = P.muzzlePosition(cur.x, cur.y, cur.tilt, act.angleDeg, cur.aim.dir, C.tank);
    var res = P.simulateShot({
      x0: mz.x, y0: mz.y, angleDeg: act.angleDeg, power: act.power, dir: cur.aim.dir,
      heightAt: heightAt,
      targets: [targetOf(opp)],
      world: C.world
    });
    G.shell = {
      path: res.path, impact: res.impact, t: 0, idx: 0, lastTail: 0,
      pos: { x: mz.x, y: mz.y }, tail: [], colorIdx: cur.colorIdx, pIdx: G.current,
      aim: { angleValue: cur.aim.angleValue, powerValue: cur.aim.powerValue, dir: cur.aim.dir }
    };
    G.drag.active = false; G.moveHold = 0;
    G.phase = 'flight'; G.phaseTime = 0;
    cur.recoil = 4;
    R.puffSmoke(mz.x, mz.y, cur.aim.dir);
    R.camFollow(mz.x, mz.y);   // 0.35초 동안 1.6배로 확대하며 포탄을 따라감
    U.hideReadout();
    S.playFire();
    S.startFlight();
  }

  function updateFlight(dt) {
    var sh = G.shell;
    sh.t += dt;
    while (sh.idx < sh.path.length - 1 && sh.path[sh.idx + 1].t <= sh.t) sh.idx++;
    var p = sh.path[sh.idx];
    sh.pos = { x: p.x, y: p.y };
    R.camTarget(p.x, p.y);
    if (sh.t - sh.lastTail > 0.035) {
      sh.tail.push({ x: p.x, y: p.y }); sh.lastTail = sh.t;
      if (sh.tail.length > 5) sh.tail.shift();
    }
    S.updateFlight(clamp((C.world.floorY - p.y) / C.world.floorY, 0, 1));
    if (sh.t >= sh.impact.t) resolveImpact();
  }

  // ---------- 떨어진 뒤 계산 ----------
  function resolveImpact() {
    var sh = G.shell, imp = sh.impact;
    var cur = G.players[sh.pIdx], opp = G.players[1 - sh.pIdx];
    S.stopFlight();
    // 카메라: 떨어진 자리에 0.6초 머문 뒤 0.6초 동안 전체 화면으로
    R.camTarget(clamp(imp.x, 0, C.world.width), Math.min(imp.y, C.world.floorY));
    after(C.camera.holdTime, function () { R.camReturn(); });

    var out = imp.type === 'out';
    var d = out ? null : Math.abs(imp.x - opp.x);
    var acc = out ? 0 : P.accuracy(d, P.hitRadiusFor(cur.mode, C.edu));
    var dmg = P.damage(acc, C.edu.maxDamage);
    var shot = {
      type: imp.type, acc: acc, d: d,
      steps: out ? null : P.steps(d, C.edu.stepUnit),
      side: P.missSide(imp.x, cur.x, opp.x),
      arrow: opp.x >= imp.x ? '▶' : '◀',
      angleValue: sh.aim.angleValue, powerValue: sh.aim.powerValue, impactX: imp.x
    };
    var prev = cur.shots.length ? cur.shots[cur.shots.length - 1] : null;

    // 땅 파기 + 물감 자국 + 탱크 내려앉기
    if (!out && imp.x >= 0 && imp.x <= C.world.width) {
      T.dig(G.terrain, imp.x, cur.colorIdx, C);
      settleTanks(false);
    }

    // 효과와 소리
    if (acc > 0) {
      opp.hp = P.applyDamage(opp.hp, dmg);
      R.burstHit(opp.x, opp.y - 22 * R.tankScale(), cur.colorIdx);
      opp.splats.push({ ox: clamp(imp.x - opp.x, -16, 16), oy: 9, colorIdx: cur.colorIdx });
      if (opp.splats.length > 3) opp.splats.shift();
      setFace(opp, 'hit', 0.8);
      setFace(cur, 'happy', 1.2);
      if (dmg > 0) R.showDamage(opp.x, opp.y, dmg);                 // 맞은 탱크 위 "-45%"
      var isGreat = dmg >= C.edu.greatDamage && !cur.isRobo;        // 사람이 40 이상 줄였을 때만
      var popup = { x: opp.x, y: opp.y, acc: acc, mode: cur.mode, colorIdx: cur.colorIdx };
      // 시간 차 표시 (디자인부 2-2): Great!면 적중률 묶음은 0.5초 뒤, 보통 명중은 바로
      if (isGreat) after(C.timing.popupDelay, function () { R.showHitPopup(popup); });
      else R.showHitPopup(popup);
      if (isGreat) {
        R.showGreat();
        S.playGreat();                                              // 명중음 대신 Great 소리
        after(0.85, function () { S.playHpDown(); });               // Great 소리가 끝난 뒤
      } else {
        S.playHit(acc);
        if (dmg > 0) after(0.35, function () { S.playHpDown(); });  // 피해 0이면 소리 없음
      }
      G.lastGreat = isGreat;
    } else {
      if (!out) R.burstMiss(imp.x, imp.y, cur.colorIdx);
      S.playMiss();
    }

    // 지난 궤적 점선과 깃발 (새싹 2개, 도전 1개)
    var keep = C.modes[cur.mode].trailCount;
    var pts = [];
    for (var i = 0; i < sh.path.length; i += 3) pts.push(sh.path[i]);
    cur.trails.push({ points: pts });
    while (cur.trails.length > keep) cur.trails.shift();
    if (!out) {
      cur.flags.push({ x: imp.x, text: F.flagText(sh.aim.angleValue, sh.aim.powerValue, cur.mode) });
      while (cur.flags.length > keep) cur.flags.shift();
    }

    // 기록
    var st = cur.stats;
    st.shots++;
    if (acc > 0) st.hits++;
    st.bestAcc = Math.max(st.bestAcc, acc);
    if (shot.steps !== null) st.bestSteps = st.bestSteps === null ? shot.steps : Math.min(st.bestSteps, shot.steps);
    if (prev && prev.steps !== null && shot.steps !== null) st.bestImprove = Math.max(st.bestImprove, prev.steps - shot.steps);
    cur.shots.push(shot);
    cur.lastAim = { angleValue: sh.aim.angleValue, powerValue: sh.aim.powerValue };

    // 말풍선 (방향 힌트 + 성장 칭찬)
    var fb = cur.isRobo ? F.roboShotFeedback(acc) : F.shotFeedback(shot, prev, cur.mode, G.rot);
    G.phaseDur = acc > 0 ? (G.lastGreat ? C.timing.impactGreat : C.timing.impactHit) : C.timing.impactMiss;
    // 말풍선: 빗나감은 바로, 명중은 조금 뒤(Great! 1.1초 / 보통 0.4초)에 띄움
    // (after 예약은 다음 판·처음으로에서 G.timers를 비우므로 늦게 뜨지 않음)
    var msgDelay = acc > 0 ? (G.lastGreat ? C.timing.msgDelayGreat : C.timing.msgDelayHit) : 0;
    var msgMs = (G.phaseDur - msgDelay) * 1000 - 150;
    if (msgDelay > 0) {
      U.hideMessage();
      after(msgDelay, function () { if (G.phase === 'impact') U.showMessage(fb.main, fb.sub, msgMs); });
    } else {
      U.showMessage(fb.main, fb.sub, msgMs);
    }
    U.updateHud(G);

    // 승부 확인
    if (acc > 0 && P.isWin(opp.hp, C.edu.winHp)) {
      G.pendingEnd = { winner: cur.idx, byLimit: false };
    } else if (G.players[0].shots.length >= C.edu.maxShotsPerPlayer && G.players[1].shots.length >= C.edu.maxShotsPerPlayer) {
      var a = G.players[0].hp, b = G.players[1].hp;
      G.pendingEnd = { winner: a === b ? null : (a > b ? 0 : 1), byLimit: true };
    }

    G.shell = null;
    G.phase = 'impact'; G.phaseTime = 0;
  }

  function setFace(pl, face, sec) { pl.face = face; pl.faceUntil = G.time + sec; }

  // ---------- 승부가 났을 때 ----------
  function startEnding() {
    var end = G.pendingEnd;
    G.phase = 'ending'; G.phaseTime = 0; G.phaseDur = C.timing.ending;
    U.hideMessage(); U.hideReadout();
    R.camReturn();   // 혹시 아직 확대 중이면 전체 화면으로
    if (end.winner !== null) {
      var w = G.players[end.winner], l = G.players[1 - end.winner];
      R.showBigStar(w.x, w.drawY);
      setFace(w, 'happy', 1e9);
      setFace(l, 'shy', 1e9);
      S.playVictory();
      after(1.6, function () { S.playEncourage(); });   // 팡파르(약 1.1초) 끝나고 0.5초 뒤, 결과 화면이 뜰 때 진 쪽 격려음
    } else {
      setFace(G.players[0], 'happy', 1e9);
      setFace(G.players[1], 'happy', 1e9);
      S.playEncourage();
    }
  }

  function showResult() {
    var end = G.pendingEnd;
    G.screen = 'result';
    G.result = end;
    var vsRobo = G.opp === 'robo';
    var players = G.players.map(function (pl) {
      var msg;
      if (pl.isRobo) msg = F.roboCardText(end.winner === null ? 'draw' : (pl.idx === end.winner ? 'win' : 'lose'));
      else if (end.winner === null) msg = F.drawText();
      else if (pl.idx === end.winner) msg = (end.byLimit ? '15발을 모두 쏘았어요! ' : '') + F.winnerText(vsRobo);
      else msg = F.encourageText(pl.stats, G.encourageRot);   // 진 쪽(Robo에게 졌을 때도) 격려
      return { name: pl.name, colorIdx: pl.colorIdx, mode: pl.mode, msg: msg, stats: pl.stats, isRobo: pl.isRobo };
    });
    R.startConfetti();
    U.showResult({ winner: end.winner, players: players });
  }

  // ---------- 이동 (◀▶, 한 턴 최대 3걸음) ----------
  function updateMove(dt) {
    var cur = G.players[G.current];
    if (!G.moveHold) return;
    var range = C.players.rangeX[cur.idx];
    var dir = G.moveHold;
    // ③ 오르막은 느려지지만 멈추지는 않음 → 구덩이에서도 빠져나올 수 있음
    var here = T.surfaceAt(G.terrain, cur.x), ahead = T.surfaceAt(G.terrain, cur.x + dir * 4);
    var up = Math.max(0, (here - ahead) / 4);
    var step = C.edu.moveSpeed * dt * Math.max(0.35, 1 / (1 + up * 0.8));
    step = Math.min(step, cur.moveLeft);
    var nx = clamp(cur.x + dir * step, range[0], range[1]);
    var moved = Math.abs(nx - cur.x);
    if (moved > 1e-4) {
      cur.x = nx;
      cur.moveLeft = Math.max(0, cur.moveLeft - moved);
      cur.wheel += dir * moved * 0.3;
      settleTank(cur, true);
      S.playMoveStep();
    } else if (!G.moveLimitSignaled) {
      S.playMoveLimit();
      G.moveLimitSignaled = true;
      G.moveHold = 0;
    }
  }

  // ---------- 매 장면 계산 ----------
  function update(dt) {
    // 예약된 일 (소리 등)
    for (var i = G.timers.length - 1; i >= 0; i--) {
      if (G.time >= G.timers[i].at) { var t = G.timers[i]; G.timers.splice(i, 1); t.fn(); }
    }
    G.players.forEach(function (pl) {
      pl.drawY += (pl.y - pl.drawY) * Math.min(1, dt * 8);
      pl.displayHp += (pl.hp - pl.displayHp) * Math.min(1, dt * 6);
      pl.recoil = Math.max(0, pl.recoil - dt * 20);
      if (G.time > pl.faceUntil) {
        pl.face = (G.screen === 'battle' && pl.idx === G.current && G.phase === 'aim') ? 'aim' : 'idle';
      }
    });
    if (G.screen !== 'battle') return;
    G.phaseTime += dt;
    if (G.phase === 'intro' && G.phaseTime >= G.phaseDur) endIntro();
    else if (G.phase === 'aim') { updateMove(dt); updateRobo(dt); }
    else if (G.phase === 'flight') updateFlight(dt);
    else if (G.phase === 'impact' && G.phaseTime >= G.phaseDur) {
      if (G.pendingEnd) startEnding(); else beginTurn(1 - G.current);
    } else if (G.phase === 'ending' && G.phaseTime >= G.phaseDur) showResult();
    if (G.screen === 'battle') {
      U.setPanel(G);
      // 조준 숫자: 숫자 바꾸기 + 두 탱크와 겹치지 않는 자리 다시 확인
      U.tickReadout(dt, [R.tankScreenBox(G.players[0]), R.tankScreenBox(G.players[1])]);
    }
  }

  // ---------- 버튼 연결 ----------
  function defaultPrefs() {
    return {
      opp: 'human',
      players: [
        { name: C.names[0], colorIdx: 0, mode: 'sprout' },      // 1번 기본: Enoch
        { name: C.names[1], colorIdx: 1, mode: 'challenge' }    // 2번 기본: Moses
      ]
    };
  }
  function goHome() {
    S.stopFlight();
    G.screen = 'start'; G.paused = false; G.shell = null; G.timers = [];
    R.stopConfetti(); R.clearEffects(); R.camReset();
    var prefs = G.setup && G.setup.prefs ? G.setup.prefs : defaultPrefs();
    U.buildStart(prefs);
    U.showScreen('start');
  }

  var handlers = {
    onStart: function (setup) { S.unlock(); startGame(setup, firstPlayerFor(setup)); },
    onFire: function () { fire(false); },
    onMoveHold: function (dir) {
      if (G.phase !== 'aim' || G.paused || G.players[G.current].isRobo) return;
      G.moveHold = dir; G.moveLimitSignaled = false;
    },
    onMoveRelease: function (dir) { if (G.moveHold === dir) G.moveHold = 0; },
    onPause: function () {
      if (G.screen !== 'battle') return;
      G.paused = true; G.moveHold = 0; G.drag.active = false;
      S.stopFlight();
      U.showPause(true);
    },
    onResume: function () {
      G.paused = false;
      U.showPause(false);
      if (G.phase === 'flight') S.startFlight();
    },
    onHome: goHome,
    onAgain: function () {
      // 다음 판은 진 쪽이 먼저 (무승부면 지난번 나중에 쏜 사람이 먼저)
      var end = G.result;
      var first = end && end.winner !== null ? 1 - end.winner : 1 - G.firstThisGame;
      startGame(G.setup, first);
    },
    onSoundToggle: function () {
      S.unlock();
      var on = S.toggle();
      U.setSoundButton(on);
    }
  };

  // 정보판·조작판 높이를 먼저 재서 넣은 뒤, 화면 크기를 다시 계산
  function refreshInsets() {
    var ins = U.insets();
    R.setInsets(ins.top, ins.bottom);
    R.resize();
  }

  // ---------- 시작 ----------
  var canvasEl;
  function boot() {
    canvasEl = document.getElementById('game-canvas');
    R.init(canvasEl);
    U.init(handlers);
    U.setSoundButton(S.isEnabled());
    U.buildStart(defaultPrefs());
    U.showScreen('start');

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('pointercancel', onPointerUp);
    canvasEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // 휴대폰은 첫 터치 뒤에만 소리가 나므로, 첫 터치 때 소리 장치를 깨움
    ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { S.unlock(); }, { passive: true });
    });
    // 두 손가락 확대·두 번 탭 확대 막기
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });

    root.addEventListener('resize', function () { setTimeout(refreshInsets, 50); });
    root.addEventListener('orientationchange', function () { setTimeout(refreshInsets, 200); });
    refreshInsets();

    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!G.paused) { G.time += dt; update(dt); }
      R.draw(G, G.paused ? 0 : dt);
      root.requestAnimationFrame(frame);
    }
    root.requestAnimationFrame(frame);
  }

  // ---------- 품질검사부 콘솔 도구 ----------
  // 예) MF.Game.debug.setAim(0, 6, 7)      → 1번 선수 조준을 (눈금6, 힘7)로
  //     MF.Game.debug.predict()            → 지금 조준으로 쏘면 어디에 떨어지고 적중률은 몇인지
  //     MF.Game.debug.bestSprout()         → 지금 자리에서 새싹 모드 최고 적중 조합
  //     MF.Game.debug.setHp(1, 20)         → 2번 선수 체력을 20으로
  //     MF.Game.debug.maxSlope()           → 땅에서 가장 가파른 곳 (1.2 이하여야 함)
  //     MF.Game.debug.robo()               → Robo 빗나감 거리(missDist)와 지난 조준 정보
  //     MF.Game.debug.setRoboMiss(40)      → Robo 빗나감 거리를 40으로
  //     MF.Game.debug.heightDiff()         → 두 탱크 시작 자리 땅 높이 차이 (5~10%)
  //     MF.Game.debug.camera()             → 카메라 확대 배율·위치
  //     MF.Game.debug.readout()            → 조준 숫자 글자·자리(①~④)·흐림 여부
  var debug = {
    setAim: function (i, angleValue, powerValue, dir) {
      var pl = G.players[i];
      pl.aim = { angleValue: angleValue, powerValue: powerValue, dir: dir || pl.facing };
      return pl.aim;
    },
    robo: function () {
      if (!G.robo) return null;
      return {
        baseMiss: Math.round(G.robo.missDist * 10) / 10,          // 다음 발 기준값 (80에서 ×0.8씩, 최소 18)
        nextMiss: G.players.length ? MF.Robo.missFor(G.robo.missDist, G.players[1].hp, G.players[0].hp, G.players[0].mode, C.robo) : null, // 지금 체력이면 이번 오차
        lastMiss: G.robo.last ? G.robo.last.missUsed : null,      // 지난 발에 실제로 쓴 오차
        step: G.robo.step, shots: G.robo.shots, last: G.robo.last,
        range: [C.robo.minMiss, C.robo.maxMiss], sproutMin: C.robo.sproutMinMiss
      };
    },
    setRoboMiss: function (m) { if (G.robo) G.robo.missDist = m; return m; },
    heightDiff: function () { return T.startHeightDiff(T.generate(G.seed, C), C); },
    heightDiffNow: function () { return T.startHeightDiff(G.terrain, C); },
    camera: function () { return R.getCamera(); },
    readout: function () { return U.readoutInfo(); },
    setHp: function (i, hp) { G.players[i].hp = hp; G.players[i].displayHp = hp; U.updateHud(G); return hp; },
    predict: function (aim, mode) {
      var cur = G.players[G.current], opp = G.players[1 - G.current];
      aim = aim || cur.aim; mode = mode || cur.mode;
      var act = P.aimToActual(aim, mode);
      var mz = P.muzzlePosition(cur.x, cur.y, cur.tilt, act.angleDeg, aim.dir || cur.facing, C.tank);
      var res = P.simulateShot({
        x0: mz.x, y0: mz.y, angleDeg: act.angleDeg, power: act.power, dir: aim.dir || cur.facing,
        heightAt: heightAt,
        targets: [targetOf(opp)],
        world: C.world
      });
      var sc = res.impact.type === 'out' ? { acc: 0, dmg: 0 } : P.scoreShot(res.impact.x, opp.x, mode);
      return { impact: res.impact, acc: sc.acc, dmg: sc.dmg };
    },
    bestSprout: function () {
      var best = { acc: -1 }, count50 = 0, dir = G.players[G.current].facing;
      for (var a = 1; a <= 10; a++) for (var p = 1; p <= 10; p++) {
        var r = debug.predict({ angleValue: a, powerValue: p, dir: dir }, 'sprout');
        if (r.acc >= 50) count50++;
        if (r.acc > best.acc) best = { acc: r.acc, angle: a, power: p };
      }
      best.combosOver50 = count50;
      return best;
    },
    maxSlope: function () { return T.maxSlope(G.terrain); },
    fire: function () { fire(true); },
    // 화면이 숨겨져 장면이 멈췄을 때 시간을 sec초만큼 직접 흘려 보내기 (검사용)
    step: function (sec) {
      var dt = 1 / 60, n = Math.ceil((sec || 0) / dt);
      for (var i = 0; i < n; i++) {
        if (G.paused) break;
        G.time += dt; update(dt); R.draw(G, dt);
      }
      return { screen: G.screen, phase: G.phase, current: G.current };
    }
  };

  MF.Game = { state: G, debug: debug, start: startGame };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);

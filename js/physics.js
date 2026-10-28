/* =========================================================
   physics.js — 물리 계산(각도·힘·중력)과 점수 계산
   - 이 파일의 함수는 화면을 그리지 않는 "순수 함수"입니다.
     같은 값을 넣으면 언제나 같은 답이 나옵니다.
   - 품질검사부 확인 예 (브라우저 콘솔):
       MF.Physics.accuracy(18, 60)   → 70
       MF.Physics.damage(70, 60)     → 42
       MF.Physics.sproutAngle(6)     → 54
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};
  var P = {};

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  P.clamp = clamp;

  // ---------- 모드별 값 바꾸기 ----------
  // 새싹 눈금(1~10) → 실제 각도(도)
  P.sproutAngle = function (step) { return step * 9; };
  // 새싹 힘 눈금(1~10) → 실제 힘(0~100)
  P.sproutPower = function (step) { return step * 10; };

  // 조준값(모드 단위)을 실제 각도·힘으로 바꿉니다.
  // aim = { angleValue, powerValue }, mode = 'sprout' | 'challenge'
  P.aimToActual = function (aim, mode) {
    if (mode === 'sprout') {
      return { angleDeg: P.sproutAngle(aim.angleValue), power: P.sproutPower(aim.powerValue) };
    }
    return { angleDeg: aim.angleValue, power: aim.powerValue };
  };

  // ---------- 새총식 끌기 → 조준값 ----------
  // dx, dy: 끌기 시작점에서 손가락까지 거리(화면 픽셀, dy는 아래로 +)
  // 당긴 반대쪽이 발사 방향, 당긴 길이가 힘입니다.
  // maxDrag: 이만큼 당기면 힘 최대
  // prevDir: 거의 수직으로 당겨 방향을 정하기 어려울 때 쓰는 이전 방향(+1 오른쪽, -1 왼쪽)
  // 돌려주는 값: { angleValue, powerValue, dir, angleDeg, power, ratio } 또는 너무 짧으면 null
  P.dragToAim = function (dx, dy, maxDrag, mode, prevDir) {
    var lx = -dx;           // 발사 방향 가로 성분
    var up = dy;            // 발사 방향 위쪽 성분 (아래로 당기면 위로 날아감)
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 8) return null;   // 살짝 건드린 것은 무시
    var ratio = clamp(len / maxDrag, 0, 1);
    var ang = Math.atan2(Math.max(0, up), Math.abs(lx)) * 180 / Math.PI; // 0~90
    var dir = prevDir || 1;
    if (Math.abs(lx) >= 4) dir = lx > 0 ? 1 : -1;

    var angleValue, powerValue;
    if (mode === 'sprout') {
      angleValue = clamp(Math.round(ang / 9), 1, 10);
      powerValue = clamp(Math.round(ratio * 10), 1, 10);
    } else {
      angleValue = clamp(Math.round(ang), 0, 90);
      powerValue = clamp(Math.round(ratio * 100), 0, 100);
    }
    var actual = P.aimToActual({ angleValue: angleValue, powerValue: powerValue }, mode);
    return {
      angleValue: angleValue, powerValue: powerValue, dir: dir,
      angleDeg: actual.angleDeg, power: actual.power, ratio: ratio
    };
  };

  // ---------- 포탄 처음 속도 ----------
  P.launchVelocity = function (angleDeg, power, dir, worldCfg) {
    var v = power * worldCfg.speedPerPower;
    var r = angleDeg * Math.PI / 180;
    return { vx: dir * v * Math.cos(r), vy: -v * Math.sin(r) };
  };

  // ---------- 포신 끝 위치 ----------
  // x, y: 탱크가 땅에 닿은 가운데 점, tilt: 탱크 기울기(라디안)
  P.pivotPosition = function (x, y, tilt, tankCfg) {
    return { x: x + Math.sin(tilt) * tankCfg.pivotH, y: y - Math.cos(tilt) * tankCfg.pivotH };
  };
  P.muzzlePosition = function (x, y, tilt, angleDeg, dir, tankCfg) {
    var p = P.pivotPosition(x, y, tilt, tankCfg);
    var r = angleDeg * Math.PI / 180;
    return { x: p.x + dir * Math.cos(r) * tankCfg.barrelLen, y: p.y - Math.sin(r) * tankCfg.barrelLen };
  };

  // ---------- 포탄 날아가기 계산 ----------
  // opts = {
  //   x0, y0, angleDeg, power, dir,
  //   heightAt: function(x) → 그 자리 땅 높이(y),
  //   targets: [{ id, x, top, bottom, halfW }],  (상대 탱크)
  //   world: Config.world
  // }
  // 돌려주는 값: { path: [{x,y,t}], impact: { x, y, t, type: 'ground'|'tank'|'out', targetId } }
  P.simulateShot = function (opts) {
    var w = opts.world;
    var vel = P.launchVelocity(opts.angleDeg, opts.power, opts.dir, w);
    var x = opts.x0, y = opts.y0, vx = vel.vx, vy = vel.vy;
    var dt = w.dt, t = 0;
    var path = [{ x: x, y: y, t: 0 }];
    var targets = opts.targets || [];
    // 포신 끝이 땅속에서 시작하면, 땅 위로 나올 때까지는 땅에 닿은 것으로 보지 않음(최대 0.3초)
    var wasAbove = y < opts.heightAt(x);
    var maxSteps = Math.ceil(w.maxFlightTime / dt);

    for (var i = 0; i < maxSteps; i++) {
      vx += (w.wind || 0) * dt;
      vy += w.gravity * dt;
      x += vx * dt;
      y += vy * dt;
      t += dt;
      path.push({ x: x, y: y, t: t });

      // 화면 옆으로 나가거나 바닥 아래로 떨어짐 → 화면 밖
      if (x < -60 || x > w.width + 60 || y > w.height + 60) {
        return { path: path, impact: { x: x, y: y, t: t, type: 'out', targetId: null } };
      }
      // 상대 탱크에 닿음
      for (var k = 0; k < targets.length; k++) {
        var tg = targets[k];
        if (Math.abs(x - tg.x) <= tg.halfW && y >= tg.top && y <= tg.bottom) {
          return { path: path, impact: { x: x, y: y, t: t, type: 'tank', targetId: tg.id } };
        }
      }
      // 땅에 닿음 (세상 안쪽일 때만)
      if (x >= 0 && x <= w.width) {
        var hy = opts.heightAt(x);
        if (y >= hy) {
          if (wasAbove || t > 0.3) {
            path[path.length - 1] = { x: x, y: hy, t: t };
            return { path: path, impact: { x: x, y: hy, t: t, type: 'ground', targetId: null } };
          }
        } else {
          wasAbove = true;
        }
      }
    }
    return { path: path, impact: { x: x, y: y, t: t, type: 'out', targetId: null } };
  };

  // ---------- 점수 계산 (교육기획부 공식) ----------
  // 모드별 적중 반경 R
  P.hitRadiusFor = function (mode, eduCfg) {
    return mode === 'sprout' ? eduCfg.sproutHitRadius : eduCfg.hitRadius;
  };
  // 적중률 = d ≥ R 이면 0, 아니면 반올림((1 − d/R) × 100)
  P.accuracy = function (d, R) {
    if (d === null || d === undefined || !isFinite(d)) return 0;
    d = Math.abs(d);
    if (d >= R) return 0;
    return Math.round((1 - d / R) * 100);
  };
  // 줄어드는 체력 = 반올림(적중률 × 최대피해 ÷ 100)
  P.damage = function (acc, maxDamage) {
    return Math.round(acc * maxDamage / 100);
  };
  // 체력은 0 아래로 내려가지 않음
  P.applyDamage = function (hp, dmg) { return Math.max(0, hp - dmg); };
  // 상대 체력이 winHp 이하이면 승리
  P.isWin = function (hp, winHp) { return hp <= winHp; };
  // 걸음 수 = 반올림(d ÷ 20)
  P.steps = function (d, unit) { return Math.round(Math.abs(d) / unit); };
  // 별 개수
  P.starsFor = function (acc, starRules) {
    for (var i = 0; i < starRules.length; i++) {
      if (acc >= starRules[i].min) return starRules[i].n;
    }
    return 0;
  };
  // 빗나간 방향: 쏜 사람 → 상대 방향을 기준으로 'short'(모자람) / 'over'(넘어감)
  P.missSide = function (impactX, shooterX, targetX) {
    var s = targetX >= shooterX ? 1 : -1;
    return (impactX - targetX) * s > 0 ? 'over' : 'short';
  };
  // 한 번에 끝내는 계산: 탄착점 x로 적중률·피해를 구함 (품질검사부 확인용)
  // MF.Physics.scoreShot(870, 850, 'challenge') → { d:20, R:60, acc:67, dmg:40 }
  P.scoreShot = function (impactX, targetX, mode, eduCfg) {
    eduCfg = eduCfg || (MF.Config && MF.Config.edu);
    var d = Math.abs(impactX - targetX);
    var R = P.hitRadiusFor(mode, eduCfg);
    var acc = P.accuracy(d, R);
    return { d: d, R: R, acc: acc, dmg: P.damage(acc, eduCfg.maxDamage) };
  };

  MF.Physics = P;
})(typeof window !== 'undefined' ? window : globalThis);

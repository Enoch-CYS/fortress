/* =========================================================
   robo.js — 컴퓨터 상대 Robo의 계산 (화면을 그리지 않는 순수 함수)
   - Robo는 "목표 착탄점 = 상대 탱크 x ± missDist" 에 떨어지는 각도·힘을 찾습니다.
   - missDist(빗나감 거리)는 아이 실력에 맞춰 자동으로 바뀝니다.
       ① 기준값 baseMiss: 처음 80, Robo가 쏠 때마다 ×0.8 (최소 18, 사람처럼 조금씩 가까워짐)
       ② 이번 오차 = baseMiss + 그 순간 체력 차 보정 (Robo가 20 이상 앞서면 +25, 사람이 20 이상 앞서면 −15)
          보정은 그 발에만 적용하고 기준값에 쌓지 않음 → 체력 차가 줄면 바로 원래 실력
       ③ 18~130 사이로 제한, 새싹 모드 사람과 겨룰 때는 최소 30
   - 품질검사부 확인 예 (node 또는 콘솔):
       MF.Robo.missFor(80, 100, 100, 'challenge')  → 80
       MF.Robo.missFor(80, 100, 70,  'challenge')  → 105  (Robo가 30 앞섬)
       MF.Robo.missFor(20, 60, 100,  'sprout')     → 30   (새싹 최소값)
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};
  var Rb = {};

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 이번 발의 빗나감 거리 계산
  // base: 지금까지 이어 온 missDist, roboHp / humanHp: 체력, humanMode: 사람의 모드
  Rb.missFor = function (base, roboHp, humanHp, humanMode, cfg) {
    cfg = cfg || MF.Config.robo;
    var m = base;
    if (roboHp - humanHp >= cfg.hpGap) m += cfg.behindAdd;       // Robo가 많이 앞섬 → 덜 정확
    else if (humanHp - roboHp >= cfg.hpGap) m -= cfg.aheadSub;   // 사람이 많이 앞섬 → 더 정확
    var lo = humanMode === 'sprout' ? Math.max(cfg.minMiss, cfg.sproutMinMiss) : cfg.minMiss;
    return clamp(m, lo, cfg.maxMiss);
  };

  // 다음 발을 위해 줄여 두기 (×0.8)
  Rb.nextBase = function (used, cfg) {
    cfg = cfg || MF.Config.robo;
    return clamp(used * cfg.shrink, cfg.minMiss, cfg.maxMiss);
  };

  // 목표 착탄점에 가장 가깝게 떨어지는 각도·힘 찾기 (도전 모드 정수값)
  // opts = { x, y, tilt, dir, targetX, heightAt, targets, cfg }
  // 돌려주는 값: { angleValue, powerValue, impactX, err }
  Rb.findAim = function (opts) {
    var cfg = opts.cfg || MF.Config, P = MF.Physics;
    var best = null;
    function test(a, p) {
      if (a < 10 || a > 85 || p < 10 || p > 100) return;
      var mz = P.muzzlePosition(opts.x, opts.y, opts.tilt, a, opts.dir, cfg.tank);
      var res = P.simulateShot({
        x0: mz.x, y0: mz.y, angleDeg: a, power: p, dir: opts.dir,
        heightAt: opts.heightAt, targets: opts.targets || [], world: cfg.world
      });
      if (res.impact.type === 'out') return;
      // 자연스러운 모습을 위해 45~55° 근처를 아주 조금 더 좋아함
      var err = Math.abs(res.impact.x - opts.targetX);
      var score = err + Math.abs(a - 50) * 0.06;
      if (!best || score < best.score) best = { angleValue: a, powerValue: p, impactX: res.impact.x, err: err, score: score };
    }
    var a, p;
    // ① 크게 훑어보기 (각도 3°, 힘 3 간격)
    for (a = 22; a <= 76; a += 3) for (p = 19; p <= 100; p += 3) test(a, p);
    // ② 가장 좋은 자리 근처를 1씩 자세히 (두 번 반복해 더 가깝게)
    if (best) {
      for (var pass = 0; pass < 2; pass++) {
        var ca = best.angleValue, cp = best.powerValue;
        for (a = ca - 4; a <= ca + 4; a++) for (p = cp - 4; p <= cp + 4; p++) test(a, p);
      }
    } else {
      best = { angleValue: 45, powerValue: 60, impactX: null, err: Infinity, score: Infinity };
    }
    delete best.score;
    return best;
  };

  MF.Robo = Rb;
})(typeof window !== 'undefined' ? window : globalThis);

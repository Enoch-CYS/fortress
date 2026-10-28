/* =========================================================
   feedback.js — 발사 뒤 칭찬·힌트 문구, 결과 화면 문구 고르기
   - 교육기획부 3-3, 3-4 문구를 그대로 씁니다.
   - 같은 문구가 연달아 나오지 않도록 "차례대로 돌려 쓰기"를 합니다.
     (무작위 뽑기 대신 순서대로 → 확률형 자극 없음)
   - 화면을 그리지 않는 순수 계산 파일입니다.
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};
  var F = {};

  var CIRCLED = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  F.circled = function (n) { return CIRCLED[n] || String(n); };

  // 조준값을 화면 글자로 ([요청-003] 형식: 도전 "power 100  angle 45°" / 새싹 "power 7  angle ⑥")
  F.aimText = function (angleValue, powerValue, mode) {
    return 'power ' + powerValue + '  angle ' + F.angleText(angleValue, mode);
  };
  F.angleText = function (v, mode) { return mode === 'sprout' ? F.circled(v) : v + '°'; };
  // 깃발에 붙이는 짧은 글자 (새싹: 각도 ⑥ 힘 7 / 도전: 47° / 72)
  F.flagText = function (angleValue, powerValue, mode) {
    if (mode === 'sprout') return '각도 ' + F.circled(angleValue) + ' 힘 ' + powerValue;
    return angleValue + '° / ' + powerValue;
  };

  // 차례대로 돌려 쓰기 도우미. rot는 { 묶음이름: 다음번호 } 를 담는 그릇
  function pick(list, key, rot) {
    rot = rot || {};
    var i = rot[key] || 0;
    rot[key] = (i + 1) % list.length;
    return list[i % list.length];
  }
  function fill(s, n) { return s.replace('{n}', String(n)); }

  // 적중률에 따른 짧은 말 (교육기획부 2-3)
  F.hitWord = function (acc) {
    if (acc >= 70) return '아주 가까워요!';
    if (acc >= 40) return '가까워요!';
    if (acc >= 1) return '살짝 닿았어요!';
    return '거의 다 왔어요!';
  };

  // 발사 결과 문구 만들기
  // shot = { type:'ground'|'tank'|'out', acc, steps(걸음 수, 화면 밖이면 null), side:'short'|'over',
  //          arrow:'◀'|'▶'(상대가 있는 쪽), angleValue, powerValue }
  // prev = 같은 선수의 지난 발사(없으면 null), mode = 'sprout'|'challenge', rot = 돌려쓰기 그릇
  // 돌려주는 값: { main: 큰 글자, sub: 작은 칭찬 글자 }
  F.shotFeedback = function (shot, prev, mode, rot) {
    var main, sub;
    var hit = shot.acc > 0;

    // 1) 큰 글자: 결과 + 방향 힌트 (무엇을 바꿀지는 말하지 않음)
    if (hit) {
      // 적중률 숫자는 탱크 위에 이미 보이므로 말풍선에서는 뺌 (디자인부 2-2)
      main = F.hitWord(shot.acc);
    } else if (shot.type === 'out') {
      main = '하늘 여행을 떠났어요! 상대는 ' + (shot.arrow === '▶' ? '오른쪽 ▶' : '◀ 왼쪽') + '에 있어요';
    } else if (shot.side === 'short') {
      main = shot.arrow === '▶' ? '조금만 더 멀리! ▶' : '◀ 조금만 더 멀리!';
    } else {
      main = shot.arrow === '▶' ? '조금 지나갔어요! 상대는 이쪽 ▶' : '◀ 상대는 이쪽! 조금 지나갔어요';
    }

    // 2) 작은 글자: 지난번과 비교한 성장 칭찬
    if (!prev) {
      sub = hit ? '첫 발사부터 닿았어요! 깃발을 보고 더 가까이 가 볼까요?'
                : '첫 발사! 이제 깃발을 보고 조정해 볼까요?';
    } else if (hit) {
      if (mode === 'challenge' && prev.acc > 0 && shot.acc > prev.acc) {
        sub = fill('적중률이 지난번보다 {n}만큼 올랐어요!', shot.acc - prev.acc);
      } else if (shot.acc >= 70) {
        sub = '끝까지 생각하며 조준한 덕분이에요!';
      } else {
        sub = '닿았어요! 지난번 결과를 보고 고친 게 딱 맞았어요.';
      }
    } else if (shot.steps === null || prev.steps === null || prev.steps === undefined) {
      sub = '이번 흔적이 다음 조준의 좋은 길잡이가 될 거예요.';
    } else {
      var delta = prev.steps - shot.steps;   // +면 가까워짐
      if (delta > 0) {
        var list = [
          '지난번보다 {n}걸음 가까워졌어요! 조정을 잘했어요.',
          '와, 점점 가까워지고 있어요! 생각한 대로 고친 덕분이에요.',
          '예상이 점점 정확해지고 있어요. {n}걸음만큼 더 다가갔어요!'
        ];
        var angleChanged = prev.angleValue !== shot.angleValue;
        var powerChanged = prev.powerValue !== shot.powerValue;
        if (powerChanged && !angleChanged) list.push('힘을 바꿔 본 게 효과가 있었어요! 지난번보다 {n}걸음 가까워요.');
        if (angleChanged && !powerChanged) list.push('각도를 바꿔 본 게 효과가 있었어요! 지난번보다 {n}걸음 가까워요.');
        sub = fill(pick(list, 'closer', rot), delta);
      } else if (delta < 0) {
        sub = fill(pick([
          '이번엔 {n}걸음 멀어졌어요. 그래도 이렇게 바꾸면 멀어진다는 걸 알아냈어요!',
          '좋은 실험이었어요! 깃발 두 개를 비교해 보세요.'
        ], 'farther', rot), -delta);
      } else if (shot.side === 'short') {
        sub = '조금 모자랐어요. 거의 다 왔어요!';
      } else {
        sub = pick([
          '조금 멀리 갔어요. 다음엔 어떻게 바꿔 볼까요?',
          '이번 흔적이 다음 조준의 좋은 길잡이가 될 거예요.'
        ], 'same', rot);
      }
    }
    return { main: main, sub: sub };
  };

  // ---------- 결과 화면 ----------
  // stats = { shots, hits, bestAcc, bestSteps(null 가능), bestImprove }
  // vsRobo: Robo와 겨룬 판이면 true
  F.winnerText = function (vsRobo) {
    if (vsRobo) return '조정을 차근차근 잘해서 이겼어요! Robo와 한 판 더 해 볼까요?';
    return '조정을 차근차근 잘해서 이겼어요! 함께 해 준 상대에게도 고맙다고 말해 볼까요?';
  };
  // 결과 화면 Robo 카드 문구 (Robo가 이겼을 때 / 졌을 때 / 비겼을 때)
  F.roboCardText = function (result) {
    if (result === 'win') return '재미있었어요! 다음 판도 함께해요.';
    if (result === 'lose') return '와, 정말 잘 맞히네요! 한 수 배웠어요.';
    return '막상막하였어요! 한 판 더 해요.';
  };
  // Robo가 쏜 뒤 말풍선 (사람에게 다음 차례를 북돋는 말)
  F.roboShotFeedback = function (acc) {
    if (acc > 0) return { main: 'Robo 적중률 ' + acc + '%', sub: '괜찮아요! 이제 내가 맞힐 차례예요.' };
    return { main: 'Robo의 포탄이 빗나갔어요', sub: '이제 내 차례! 차분히 조준해 봐요.' };
  };
  // 진 쪽 격려 문구: 판마다 순서대로 돌려 씀 (필요한 숫자가 없으면 다음 문구로)
  F.encourageText = function (stats, rot) {
    var list = [
      { s: '조준이 점점 가까워지고 있어요! 다음 판이 기대돼요.' },
      { s: '이번 판에서 {n}번이나 적중했어요. 끝까지 포기하지 않았어요!', n: stats.hits, need: stats.hits > 0 },
      { s: '가장 가까웠던 한 발은 {n}걸음 차이였어요. 정말 아까웠어요!', n: stats.bestSteps, need: stats.bestSteps !== null && stats.bestSteps !== undefined },
      { s: '마지막까지 생각하며 쏜 모습이 멋졌어요. 한 판 더 해 볼까요?' },
      { s: '처음보다 훨씬 정확해졌어요. 연습한 만큼 자라고 있어요!' }
    ];
    rot = rot || {};
    for (var tries = 0; tries < list.length; tries++) {
      var item = pick(list, 'encourage', rot);
      if (item.need === undefined || item.need) return fill(item.s, item.n);
    }
    return list[0].s;
  };
  F.drawText = function () { return '체력이 똑같아요. 둘 다 정말 잘했어요!'; };

  MF.Feedback = F;
})(typeof window !== 'undefined' ? window : globalThis);

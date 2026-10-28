/* =========================================================
   config.js — 게임 설정값을 한곳에 모아 둔 파일
   - 숫자를 바꾸고 싶으면 이 파일만 고치면 됩니다.
   - 교육기획부 EDU_CONFIG + 통합기획(1차) 확정값을 따릅니다.
   - 브라우저에서는 window.MF.Config, node에서는 globalThis.MF.Config
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};

  MF.Config = {
    // ---------- 게임 세상(물리 계산용 좌표) ----------
    // 가로 1000을 기준으로 계산합니다. (교육기획부 기준: 탱크 너비 40, R=60)
    // y는 아래로 갈수록 커집니다. (화면 좌표와 같은 방향)
    world: {
      width: 1000,
      height: 562,        // 16:9 비율
      floorY: 432,        // 바닥선: 이 높이보다 아래로는 땅이 파이지 않습니다.
      gravity: 300,       // 중력 (아래로 끌어당기는 힘)
      speedPerPower: 5.5, // 힘 1당 포탄 처음 속도
      dt: 1 / 120,        // 계산 간격(초). 늘 같은 간격이라 같은 숫자 = 같은 곳
      maxFlightTime: 15,  // 이보다 오래 날면 계산을 멈춤(안전장치)
      wind: 0             // 1차에는 바람 없음
    },

    // ---------- 교육기획부 규칙값 ----------
    edu: {
      tankWidth: 40,
      hitRadius: 60,          // 도전 모드 적중 반경 R
      sproutHitRadius: 90,    // 새싹 모드로 쏜 포탄의 적중 반경 (1.5배, 대표 결정 3)
      maxDamage: 60,          // 적중률 100%일 때 줄어드는 체력 ([요청-003]: 35 → 60)
      greatDamage: 40,        // 한 번에 이만큼 이상 줄이면 「Great!」 (사람이 쐈을 때만)
      startHp: 100,
      winHp: 10,              // 상대 체력이 이 값 이하가 되면 공격한 쪽 승리
      stepUnit: 20,           // 1걸음 = 20
      moveLimitPerTurn: 60,   // 한 턴 이동 최대 3걸음
      moveSpeed: 45,          // 이동 속도(1초에 몇 칸)
      maxShotsPerPlayer: 15,  // 한 사람당 15발에도 안 끝나면 마무리
      selfDamage: false       // 자기 탱크는 다치지 않음
    },

    // ---------- 모드 (새싹 / 도전) ----------
    modes: {
      sprout: {
        name: '새싹',
        angleSteps: 10, angleUnit: 9,   // 실제각도 = 눈금 × 9
        powerSteps: 10, powerUnit: 10,  // 실제 힘 = 눈금 × 10
        showPercent: false, showStars: true, trailCount: 2,
        defaultAngle: 5, defaultPower: 5
      },
      challenge: {
        name: '도전',
        angleMin: 0, angleMax: 90, powerMin: 0, powerMax: 100,
        showPercent: true, showStars: true, trailCount: 1,
        defaultAngle: 45, defaultPower: 50
      }
    },

    // 별 개수 기준 (적중률)
    stars: [{ min: 70, n: 3 }, { min: 40, n: 2 }, { min: 1, n: 1 }],

    // ---------- 탱크 크기(세상 좌표) ----------
    // 디자인부 점검(2026-10-28): 휴대폰에서 잘 보이도록 처음 값(폭 48)의 4/3배.
    // 적중률은 탱크 중심과의 가로 거리로 계산하므로(hitRadius 60/90) 그림 크기와 상관없음.
    tank: {
      bodyW: 64,       // 몸통 폭 (그림). render.js는 bodyW ÷ 48 배로 탱크를 통째로 키움
      bodyH: 24,
      treadH: 13,
      domeR: 20,       // 포탑(얼굴) 반지름
      pivotH: 40,      // 땅에서 포신 회전축까지 높이
      barrelLen: 35,   // 포신 길이
      hitW: 64,        // 포탄이 탱크에 닿았다고 보는 폭
      hitH: 58         // 포탄이 탱크에 닿았다고 보는 높이
    },

    // ---------- 땅 파임 (대표 결정 4: 깊게 파임 + 안전장치) ----------
    crater: {
      radius: 34,      // 구덩이 반지름(가로)
      depth: 30,       // 한 번에 파이는 깊이
      maxSlope: 1.2    // 이보다 가파른 벽은 자동으로 무너뜨려 완만하게 (탱크가 갇히지 않게)
    },

    // ---------- 이름 고르기 ([요청-003], 대표가 정한 이름 3개만) ----------
    names: ['Enoch', 'Moses', 'Joshua'],

    // ---------- Robo (컴퓨터 상대) ----------
    // 아이 실력에 맞춰 자동 조절: 목표 착탄점 = 상대 탱크 x ± missDist
    robo: {
      name: 'Robo',
      mode: 'challenge',     // 도전 모드 값으로 쏘고, 적중률·피해도 도전 규칙(R=60)
      startMiss: 80,         // 첫 발 빗나감 거리
      shrink: 0.8,           // 쏠 때마다 ×0.8 (사람처럼 조금씩 가까워짐)
      hpGap: 20,             // 체력 차이가 이만큼 이상이면 보정
      behindAdd: 25,         // Robo가 20 이상 앞서면 덜 정확하게 (+25)
      aheadSub: 15,          // 사람이 20 이상 앞서면 더 정확하게 (−15)
      minMiss: 18, maxMiss: 130,
      sproutMinMiss: 30,     // 새싹 모드 사람과 겨룰 때 최소 빗나감
      thinkTime: 1.0,        // "생각 중" 시간(초)
      aimAnimTime: 0.6,      // 조준 숫자가 바뀌는 시간(초)
      fireDelay: 0.3         // 조준을 마치고 쏘기까지(초)
    },

    // ---------- 지형 높낮이 ([요청-003]) ----------
    // 두 탱크 시작 자리 땅 높이 차이 = world.height 의 5~10%
    terrainDiff: { minRatio: 0.05, maxRatio: 0.10 },

    // ---------- 카메라 ([요청-003]) ----------
    camera: {
      zoom: 1.6,             // 포탄을 따라갈 때 확대 배율
      zoomInTime: 0.35,      // 확대하는 시간
      follow: 8,             // 따라가는 부드러움(클수록 빨리 따라감)
      holdTime: 0.6,         // 떨어진 뒤 머무는 시간
      returnTime: 0.6        // 전체 화면으로 돌아오는 시간
    },

    // ---------- 선수 위치 ----------
    players: {
      startX: [150, 850],
      rangeX: [[50, 350], [650, 950]]   // 자기 진영 안에서만 이동
    },

    // ---------- 탱크 색 4종 (디자인부) ----------
    colors: [
      { id: 'sky',    name: '하늘', body: '#4FB6F0', light: '#8FD3F8', dark: '#1F7FB8' },
      { id: 'sunset', name: '노을', body: '#FF9A3C', light: '#FFC07F', dark: '#D96A0B' },
      { id: 'leaf',   name: '풀잎', body: '#6CCB5F', light: '#A6E39C', dark: '#3E8E34' },
      { id: 'grape',  name: '포도', body: '#A78BFA', light: '#C9B8FC', dark: '#6D4FD1' }
    ],

    // 체력 막대 색 (빨강은 쓰지 않음: 초록·노랑·주황)
    hpColors: { green: '#4CC764', yellow: '#FFC83D', orange: '#FF9F43' },

    // 소리 설정 저장 이름 (개인정보 아님)
    storageKeys: { soundOn: 'mf_sound_on' },

    // 화면 연출 시간(초)
    timing: {
      turnIntro: 1.2,
      impactHit: 2.4,
      impactMiss: 2.0,
      ending: 1.6,
      readoutWake: 0.25,     // 조준을 시작하면 숫자가 지금 값으로 바뀌는 시간
      damageFloat: 1.2,      // 피해 % 글씨가 떠올랐다 사라지는 시간
      great: 1.2,            // 「Great!」 글씨가 보이는 시간
      // 디자인부 점검(요청-003 2-2): 결과 표시를 시간 차를 두고 차례로
      impactGreat: 3.2,      // Great!일 때 다음 차례까지
      popupDelay: 0.5,       // Great!일 때 적중률 묶음이 뜨는 때
      msgDelayGreat: 1.1,    // Great!일 때 말풍선이 뜨는 때
      msgDelayHit: 0.4       // 보통 명중일 때 말풍선이 뜨는 때
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

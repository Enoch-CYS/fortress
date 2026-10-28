/* =========================================================
   sound.js — 효과음 14개 (음원부 기획서 2장 표 + [요청-003] Great!)
   - 녹음 파일 없이 브라우저가 그 자리에서 음을 만듭니다(Web Audio).
   - 배경음은 1차에서 만들지 않습니다(대표 결정 5).
   - 소리가 실패해도 게임은 멈추지 않도록 모든 함수를 try/catch로 감쌉니다.
   - 사용: Sound.unlock(), Sound.toggle(), Sound.playClick() ...
   ========================================================= */
(function (root) {
  'use strict';
  var MF = root.MF = root.MF || {};

  var ctx = null, master = null, sfxBus = null, limiter = null, noiseBuf = null;
  var enabled = true;
  var unlocked = false;
  var MASTER_VOL = 0.5;          // 음량 중간 고정
  var MAX_VOICES = 6;            // 동시에 최대 6개
  var activeVoices = 0;
  var lastPlayed = {};           // 같은 소리 최소 간격 확인용
  var flight = null;             // 비행음(한 번에 하나)

  var KEY = (MF.Config && MF.Config.storageKeys && MF.Config.storageKeys.soundOn) || 'mf_sound_on';

  // 저장된 켜기/끄기 설정 읽기 (localStorage는 막혀 있을 수 있어 try/catch)
  try {
    var saved = root.localStorage && root.localStorage.getItem(KEY);
    if (saved === '0') enabled = false;
  } catch (e) { /* 저장소를 못 써도 괜찮음 */ }

  function save() {
    try { root.localStorage && root.localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { /* 무시 */ }
  }

  // 소리 장치 만들기 (첫 터치 때만)
  function build() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14; limiter.knee.value = 6; limiter.ratio.value = 4;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    master = ctx.createGain();
    master.gain.value = enabled ? MASTER_VOL : 0;
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1.0;
    sfxBus.connect(master); master.connect(limiter); limiter.connect(ctx.destination);
    // 1초짜리 잡음(쉬익) 재료를 한 번만 만들어 둠
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // 소리를 낼 준비가 되었는지 + 같은 소리 간격 + 동시 음 개수 확인
  // voices: 이 소리가 쓰는 음 개수. 꼭 들려야 하는 소리(승리·격려)는 1로 넘겨 건너뛰지 않게 함
  function ready(name, minGap, voices) {
    if (!enabled || !ctx) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 무시 */ } }
    var now = ctx.currentTime;
    if (minGap && lastPlayed[name] !== undefined && now - lastPlayed[name] < minGap) return false;
    if (activeVoices + (voices || 1) > MAX_VOICES) return false;
    if (minGap) lastPlayed[name] = now;   // 실제로 낼 때만 간격 기록
    return true;
  }

  function track(node, endTime) {
    activeVoices++;
    node.onended = function () { activeVoices = Math.max(0, activeVoices - 1); };
    node.stop(endTime + 0.02);
  }

  // 한 음: freq → endFreq로 미끄러짐, delay초 뒤 시작
  function tone(o) {
    var type = o.type || 'sine', freq = o.freq, endFreq = o.endFreq || o.freq;
    var dur = o.dur, gain = o.gain, delay = o.delay || 0, attack = o.attack || 0.008;
    var t0 = ctx.currentTime + delay;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (o.vibratoHz) {   // 떨림(비브라토)
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vibratoHz; lg.gain.value = o.vibratoDepth || 4;
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + dur + 0.02);
    }
    osc.connect(g); g.connect(sfxBus);
    osc.start(t0);
    track(osc, t0 + dur);
  }

  // 잡음 한 번 (풀썩·토독)
  function noise(o) {
    var dur = o.dur, gain = o.gain, delay = o.delay || 0;
    var t0 = ctx.currentTime + delay;
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.filterFreq, t0);
    if (o.endFilterFreq && o.endFilterFreq !== o.filterFreq) f.frequency.exponentialRampToValueAtTime(o.endFilterFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0);
    track(src, t0 + dur);
  }

  function safe(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { /* 소리 실패는 무시 */ }
    };
  }

  var S = {};

  // 첫 터치 때 한 번: 소리 장치를 만들고 깨움
  S.unlock = safe(function () {
    if (unlocked && ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    if (!build()) return;
    unlocked = true;
    if (ctx.resume) ctx.resume();
    // 아이폰용: 아주 짧은 무음 한 번
    var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  });

  S.isEnabled = function () { return enabled; };
  S.setEnabled = safe(function (on) {
    enabled = !!on;
    save();
    if (ctx && master) {
      var now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(enabled ? MASTER_VOL : 0, now + 0.05);
    }
    if (!enabled) S.stopFlight();
    else S.playSoundOn();
  });
  S.toggle = function () { S.setEnabled(!enabled); return enabled; };

  // 1 버튼 누름: 톡
  S.playClick = safe(function () {
    if (!ready('click', 0.05)) return;
    tone({ type: 'triangle', freq: 660, endFreq: 620, dur: 0.06, gain: 0.20 });
  });
  // 2 이동 중: 토독 (0.16초마다 1회)
  S.playMoveStep = safe(function () {
    if (!ready('move', 0.16, 2)) return;
    tone({ type: 'triangle', freq: 150, endFreq: 120, dur: 0.05, gain: 0.12 });
    noise({ dur: 0.05, gain: 0.05, filterFreq: 800 });
  });
  // 3 이동 한계: 뽁
  S.playMoveLimit = safe(function () {
    if (!ready('limit', 0.1)) return;
    tone({ type: 'sine', freq: 330, endFreq: 260, dur: 0.08, gain: 0.15 });
  });
  // 4 조준 틱: 값에 따라 높낮이 (kind: 'angle'|'power', ratio: 0~1)
  S.playAimTick = safe(function (kind, ratio) {
    if (!ready('tick', 0.06)) return;
    ratio = Math.max(0, Math.min(1, ratio || 0));
    var f = kind === 'power' ? 400 + ratio * 600 : 500 + ratio * 400;
    tone({ type: 'sine', freq: f, dur: 0.03, gain: 0.08, attack: 0.004 });
  });
  // 5 발사: 퐁!
  S.playFire = safe(function () {
    if (!ready('fire', 0, 2)) return;
    tone({ type: 'sine', freq: 620, endFreq: 180, dur: 0.15, gain: 0.30 });
    tone({ type: 'triangle', freq: 1240, endFreq: 600, dur: 0.06, gain: 0.08 });
  });
  // 6 비행음: 휘~ (아주 작게)
  S.startFlight = safe(function () {
    S.stopFlight();
    if (!enabled || !ctx) return;
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    var lfo = ctx.createOscillator(), lg = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(500, t0);
    lfo.frequency.value = 6; lg.gain.value = 8;
    lfo.connect(lg); lg.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.04, t0 + 0.05);
    osc.connect(g); g.connect(sfxBus);
    osc.start(t0); lfo.start(t0);
    flight = { osc: osc, lfo: lfo, g: g };
  });
  S.updateFlight = safe(function (h) {
    if (!flight || !ctx) return;
    h = Math.max(0, Math.min(1, h || 0));
    flight.osc.frequency.setTargetAtTime(500 + h * 500, ctx.currentTime, 0.03);
  });
  S.stopFlight = safe(function () {
    if (!flight || !ctx) { flight = null; return; }
    var f = flight, now = ctx.currentTime;
    flight = null;
    f.g.gain.cancelScheduledValues(now);
    f.g.gain.setValueAtTime(f.g.gain.value, now);
    f.g.gain.linearRampToValueAtTime(0.0001, now + 0.04);
    f.osc.stop(now + 0.06); f.lfo.stop(now + 0.06);
  });
  // 7 명중: 띠-리-링 반짝
  S.playHit = safe(function (accuracy) {
    if (!ready('hit', 0, accuracy >= 70 ? 5 : 4)) return;
    var notes = [1047, 1319, 1568];
    for (var i = 0; i < 3; i++) tone({ type: 'triangle', freq: notes[i], dur: 0.08, gain: 0.18, delay: i * 0.06 });
    tone({ type: 'sine', freq: 2093, dur: 0.25, gain: 0.08, delay: 0.15, vibratoHz: 8, vibratoDepth: 6 });
    if (accuracy >= 70) tone({ type: 'triangle', freq: 2093, dur: 0.08, gain: 0.14, delay: 0.40 });
  });
  // 8 빗나감: 뽀옹~ 풀썩
  S.playMiss = safe(function () {
    if (!ready('miss', 0, 2)) return;
    tone({ type: 'sine', freq: 420, endFreq: 260, dur: 0.25, gain: 0.12 });
    noise({ dur: 0.20, gain: 0.10, filterFreq: 700, endFilterFreq: 200 });
  });
  // 9 체력 줄어듦: 뾰로롱 (가볍게)
  S.playHpDown = safe(function () {
    if (!ready('hpdown', 0, 2)) return;
    tone({ type: 'triangle', freq: 784, dur: 0.11, gain: 0.14 });
    tone({ type: 'triangle', freq: 659, dur: 0.11, gain: 0.14, delay: 0.12 });
  });
  // 10 차례 바뀜: 딩-동↑
  S.playTurnChange = safe(function () {
    if (!ready('turn', 0, 2)) return;
    tone({ type: 'sine', freq: 659, dur: 0.15, gain: 0.18 });
    tone({ type: 'sine', freq: 880, dur: 0.20, gain: 0.18, delay: 0.15 });
  });
  // 11 승리: 빰빰빰 빠-밤!
  S.playVictory = safe(function () {
    if (!ready('victory', 0, 1)) return;   // 꼭 들려야 하므로 우선 재생
    var mel = [523, 659, 784];
    for (var i = 0; i < 3; i++) tone({ type: 'triangle', freq: mel[i], dur: 0.12, gain: 0.20, delay: i * 0.13 });
    var chord = [1047, 1319, 784];
    for (var j = 0; j < 3; j++) tone({ type: 'sine', freq: chord[j], dur: 0.70, gain: 0.10, delay: 0.42, vibratoHz: 5, vibratoDepth: 4 });
  });
  // 12 진 쪽 격려: 토닥토닥~
  S.playEncourage = safe(function () {
    if (!ready('encourage', 0, 1)) return; // 꼭 들려야 하므로 우선 재생
    tone({ type: 'sine', freq: 349, dur: 0.25, gain: 0.15 });
    tone({ type: 'sine', freq: 440, dur: 0.25, gain: 0.15, delay: 0.28 });
    tone({ type: 'sine', freq: 523, dur: 0.35, gain: 0.15, delay: 0.56 });
  });
  // 14 Great!: 밝게 올라가는 도-미-솔-도 (약 0.8초) — [요청-003]
  //    피해 40 이상일 때 명중음 대신 냅니다. 음 4개 + 반짝 1개 = 5개 (동시 6개 제한 안)
  S.playGreat = safe(function () {
    if (!ready('great', 0.5, 5)) return;
    var notes = [523, 659, 784, 1047];   // C5 E5 G5 C6
    for (var i = 0; i < 3; i++) tone({ type: 'triangle', freq: notes[i], dur: 0.12, gain: 0.17, delay: i * 0.09 });
    tone({ type: 'triangle', freq: notes[3], dur: 0.52, gain: 0.17, delay: 0.27, vibratoHz: 6, vibratoDepth: 5 });
    tone({ type: 'sine', freq: 2093, dur: 0.30, gain: 0.05, delay: 0.30 });
  });
  // 13 소리 켜짐: 띵
  S.playSoundOn = safe(function () {
    if (!ready('on')) return;
    tone({ type: 'sine', freq: 880, dur: 0.12, gain: 0.15 });
  });

  // 다른 앱으로 바꾸면 쉬고, 돌아오면 다시
  if (root.document) {
    root.document.addEventListener('visibilitychange', function () {
      try {
        if (!ctx) return;
        if (root.document.hidden) ctx.suspend(); else ctx.resume();
      } catch (e) { /* 무시 */ }
    });
  }

  MF.Sound = S;
  root.Sound = S;
})(typeof window !== 'undefined' ? window : globalThis);

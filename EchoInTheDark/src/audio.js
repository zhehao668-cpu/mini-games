'use strict';
/* =====================================================================
 * 暗夜回声 · Echo in the Dark  —— 程序化音效（Web Audio API，无外部音频文件）
 * 依赖：无。全局暴露 initAudio 与 sfx* 函数，供 game.js 调用。
 * ===================================================================== */

let actx = null, master = null;

function initAudio() {
  try {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
  } catch (e) { /* 音频不可用则静默 */ }
}

function env(g, t, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function sfxSonar(strength) {
  if (!actx) return; const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.45);
  const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.36 * (0.5 + strength * 0.5), t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  const d = actx.createDelay(); d.delayTime.value = 0.22;
  const fb = actx.createGain(); fb.gain.value = 0.35;
  const wet = actx.createGain(); wet.gain.value = 0.4;
  o.connect(g); g.connect(master); g.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(master);
  o.start(t); o.stop(t + 0.9);
}

function sfxHeartbeat() {
  if (!actx) return; const t = actx.currentTime;
  [0, 0.12].forEach(off => {
    const o = actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(60, t + off); o.frequency.exponentialRampToValueAtTime(40, t + off + 0.09);
    const g = actx.createGain(); env(g, t + off, 0.5, 0.1);
    o.connect(g); g.connect(master); o.start(t + off); o.stop(t + off + 0.12);
  });
}

function sfxAlert() {
  if (!actx) return; const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.12);
  const g = actx.createGain(); env(g, t, 0.16, 0.14);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
}

function sfxPebbleImpact() {
  if (!actx) return; const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(320, t + 0.08);
  const g = actx.createGain(); env(g, t, 0.5, 0.1);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
}

function sfxFootstep() {
  if (!actx) return; const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(92, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.05);
  const g = actx.createGain(); env(g, t, 0.05, 0.06);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.07);
}

function sfxWallBump() {
  if (!actx) return; const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(74, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.06);
  const g = actx.createGain(); env(g, t, 0.08, 0.07);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.08);
}

function sfxFail() {
  if (!actx) return; const t = actx.currentTime;
  const len = Math.floor(actx.sampleRate * 0.4);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource(); src.buffer = buf;
  const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800;
  const g = actx.createGain(); g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  src.connect(hp); hp.connect(g); g.connect(master); src.start(t);
}

function sfxWin() {
  if (!actx) return; const t = actx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const o = actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t + i * 0.11);
    const g = actx.createGain(); env(g, t + i * 0.11, 0.22, 0.3);
    o.connect(g); g.connect(master); o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.32);
  });
}

'use strict';
/* =====================================================================
 * 暗夜回声 · Echo in the Dark  —— 游戏主逻辑
 * 依赖：audio.js（先于本文件加载，提供 initAudio 与 sfx* 函数）
 * ===================================================================== */

/* ---------------- 工具 ---------------- */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------------- 常量与数值表 ---------------- */
const WORLD = { w: 1280, h: 720 };
const BG = '#050508';
const SONAR = { maxCharge: 1.5, minRadius: 140, maxRadius: 620, speed: 1500, rays: 360, decalFade: 3.5, revealTime: 2.2, mergeDist: 14 };
const PLAYER = { r: 14, speed: 185, chargeSlow: 0.5 };
const GUARD = { r: 16, patrolSpeed: 92, alertSpeed: 165, heartbeatInterval: 2.0, searchTime: 3.0 };
const PEBBLE = { speed: 520, maxRange: 520, rippleRadius: 280, count: 3 };
const FOOTSTEP = { interval: 0.4, radius: 45, alertRadius: 70 };

/* ---------------- Canvas 与缩放 ---------------- */
const canvas = $('#game');
const ctx = canvas.getContext('2d');
let DPR = 1, scale = 1, offX = 0, offY = 0;

function resize() {
  const cw = window.innerWidth, ch = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cw * DPR);
  canvas.height = Math.round(ch * DPR);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  scale = Math.min(cw / WORLD.w, ch / WORLD.h);
  offX = (cw - WORLD.w * scale) / 2;
  offY = (ch - WORLD.h * scale) / 2;
}
window.addEventListener('resize', resize);
resize();

function toWorld(clientX, clientY) {
  return { x: (clientX - offX) / scale, y: (clientY - offY) / scale };
}

/* ---------------- 关卡数据 ---------------- */
function rect(x, y, w, h) { return { x, y, w, h }; }
function boundary() {
  return [rect(0, 0, 1280, 24), rect(0, 696, 1280, 24), rect(0, 0, 24, 720), rect(1256, 0, 24, 720)];
}

const LEVELS = [
  { // 关 1：基础声呐与绕柱
    name: '基础声呐与绕柱',
    walls: boundary().concat([
      rect(500, 240, 26, 240),
      rect(760, 240, 26, 240),
    ]),
    guards: [{ waypoints: [{x:360,y:140},{x:920,y:140},{x:920,y:580},{x:360,y:580}] }],
    start: { x: 200, y: 360 },
    exit: { x: 1080, y: 328, w: 46, h: 64 },
    hints: [
      { x: 232, y: 300, text: 'WASD / 方向键 移动' },
      { x: 232, y: 336, text: '空格 / 左键 声呐（蓄力）' },
      { x: 232, y: 372, text: '右键 / E 投掷石子' },
      { x: 232, y: 408, text: '抵达绿色出口' },
    ],
  },
  { // 关 2：双守卫交叉巡逻
    name: '双守卫交叉巡逻',
    walls: boundary().concat([
      rect(400, 80, 24, 240),
      rect(856, 400, 24, 240),
      rect(440, 300, 160, 24),
      rect(680, 396, 160, 24),
    ]),
    guards: [
      { waypoints: [{x:280,y:360},{x:1000,y:360}] },
      { waypoints: [{x:640,y:120},{x:640,y:600}] },
    ],
    start: { x: 200, y: 560 },
    exit: { x: 1080, y: 128, w: 46, h: 64 },
    hints: [],
  },
  { // 关 3：狭窄回廊与极限蓄力
    name: '狭窄回廊与极限蓄力',
    walls: boundary().concat([
      rect(0, 240, 1040, 26),
      rect(240, 480, 1040, 26),
      rect(620, 70, 26, 60),
      rect(500, 300, 26, 60),
      rect(700, 540, 26, 50),
    ]),
    guards: [
      { waypoints: [{x:300,y:150},{x:900,y:150}] },
      { waypoints: [{x:360,y:400},{x:960,y:400}] },
      { waypoints: [{x:960,y:620},{x:400,y:620}] },
    ],
    start: { x: 140, y: 140 },
    exit: { x: 1120, y: 600, w: 46, h: 64 },
    hints: [],
  },
];

/* ---------------- 游戏状态 ---------------- */
let state = 'start';            // start | play | won | lost
let levelIndex = 0;
let walls = [], guards = [], player, exit, hints = [];
let decals = [], waves = [], ripples = [], pebbles = [], particles = [];
let pebbleCount = 0, sonarCount = 0, noise = 0, levelTime = 0;
let footstepTimer = 0, exitParticleTimer = 0;
let shake = { t: 0, dur: 0, mag: 0 };
let redFlash = 0;
let time = 0, lastTime = performance.now() / 1000;

/* ---------------- 输入 ---------------- */
const keys = {};
const chargeSources = new Set();
let charging = false, chargeStart = 0;
let mouse = { x: WORLD.w / 2, y: WORLD.h / 2, inside: false };

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'tab') { e.preventDefault(); if (state === 'play') toggleEditor(); return; }
  if (k === 'r' && state === 'play') { restartLevel(); return; }
  if (k === ' ' && state === 'play') { e.preventDefault(); pressCharge('space'); return; }
  if ((k === 'e') && state === 'play') { throwPebble(); return; }
  if (k === 'enter' && state === 'start') { startGame(); return; }
  keys[k] = true;
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === ' ' && state === 'play') { releaseCharge('space'); }
  keys[k] = false;
});

function pressCharge(src) {
  if (chargeSources.size === 0) chargeStart = time;
  chargeSources.add(src);
  charging = true;
}
function releaseCharge(src) {
  chargeSources.delete(src);
  if (chargeSources.size === 0 && charging) {
    charging = false;
    if (state === 'play' && !editorOpen) emitSonar(clamp((time - chargeStart) / SONAR.maxCharge, 0, 1));
  }
}

canvas.addEventListener('mousemove', e => {
  const p = toWorld(e.clientX, e.clientY);
  mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
});
canvas.addEventListener('mousedown', e => {
  const p = toWorld(e.clientX, e.clientY);
  mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  if (state === 'start') { startGame(); return; }
  if (state !== 'play') return;
  if (editorOpen) { editorDown(p, e.button); return; }
  if (e.button === 0) pressCharge('mouse');
  else if (e.button === 2) { e.preventDefault(); throwPebble(); }
});
canvas.addEventListener('mouseup', e => {
  if (e.button === 0) releaseCharge('mouse');
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mouseleave', () => { mouse.inside = false; });

$('#restartBtn').addEventListener('click', () => { if (state === 'play') restartLevel(); });
$('#startBtn').addEventListener('click', startGame);
$('#startOverlay').addEventListener('click', startGame);
$('#nextBtn').addEventListener('click', nextLevel);
$('#winRestartBtn').addEventListener('click', restartLevel);
$('#loseRestartBtn').addEventListener('click', restartLevel);

/* ---------------- 碰撞（circle↔rect 轴分离滑动，防卡墙） ---------------- */
function collideCircleRect(c, r) {
  const nx = clamp(c.x, r.x, r.x + r.w);
  const ny = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - nx, dy = c.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 < c.r * c.r) {
    let d = Math.sqrt(d2), ux, uy, pen;
    if (d > 1e-6) { ux = dx / d; uy = dy / d; pen = c.r - d; }
    else {
      const left = c.x - r.x, right = r.x + r.w - c.x, top = c.y - r.y, bottom = r.y + r.h - c.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) { ux = -1; uy = 0; } else if (m === right) { ux = 1; uy = 0; }
      else if (m === top) { ux = 0; uy = -1; } else { ux = 0; uy = 1; }
      pen = c.r + m;
    }
    return { hit: true, nx: ux, ny: uy, pen, px: nx, py: ny };
  }
  return { hit: false };
}

function moveCircleBody(b, dx, dy, wallArr) {
  let hit = null;
  b.x += dx;
  for (const w of wallArr) { const c = collideCircleRect(b, w); if (c.hit) { b.x += c.nx * c.pen; hit = hit || c; } }
  b.y += dy;
  for (const w of wallArr) { const c = collideCircleRect(b, w); if (c.hit) { b.y += c.ny * c.pen; hit = hit || c; } }
  return hit;
}

function circleRectOverlap(cx, cy, r, rct) {
  const nx = clamp(cx, rct.x, rct.x + rct.w);
  const ny = clamp(cy, rct.y, rct.y + rct.h);
  return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < r * r;
}

/* ---------------- 光线投射（AABB Slab） ---------------- */
function rayRect(ox, oy, dx, dy, r, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-9) { if (ox < r.x || ox > r.x + r.w) return null; }
  else {
    let t1 = (r.x - ox) / dx, t2 = (r.x + r.w - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < r.y || oy > r.y + r.h) return null; }
  else {
    let t1 = (r.y - oy) / dy, t2 = (r.y + r.h - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function castRay(ox, oy, dx, dy, maxDist, wallArr) {
  let bestT = maxDist, best = null;
  for (const w of wallArr) {
    const t = rayRect(ox, oy, dx, dy, w, bestT);
    if (t !== null && t < bestT) { bestT = t; best = w; }
  }
  return { t: bestT, rect: best, hx: ox + dx * bestT, hy: oy + dy * bestT };
}
function hasLineOfSight(x1, y1, x2, y2, wallArr) {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d < 1e-4) return true;
  const r = castRay(x1, y1, dx / d, dy / d, d, wallArr);
  return r.t >= d - 0.5;
}
function wallEdge(r, hx, hy) {
  const e = 1.0;
  if (Math.abs(hx - r.x) < e) return { dir: 'v', fixed: r.x, from: r.y, to: r.y + r.h };
  if (Math.abs(hx - (r.x + r.w)) < e) return { dir: 'v', fixed: r.x + r.w, from: r.y, to: r.y + r.h };
  if (Math.abs(hy - r.y) < e) return { dir: 'h', fixed: r.y, from: r.x, to: r.x + r.w };
  if (Math.abs(hy - (r.y + r.h)) < e) return { dir: 'h', fixed: r.y + r.h, from: r.x, to: r.x + r.w };
  return null;
}

/* ---------------- 实体与特效 ---------------- */
function spawnWave(x, y, maxR, color, speed) { waves.push({ x, y, r: 8, maxR, color, speed, birth: time }); }
function spawnRipple(x, y, maxR, color, speed, width) { ripples.push({ x, y, r: 4, maxR, color, speed, width: width || 2, birth: time }); }
function spawnDecal(x1, y1, x2, y2, distFromSrc) { decals.push({ x1, y1, x2, y2, arrive: time + distFromSrc / SONAR.speed }); }
function spawnParticle(x, y, vx, vy, color, life, size) { particles.push({ x, y, vx, vy, color, life, maxLife: life, size: size || 2, birth: time }); }
function spawnSparks(px, py, nx, ny) {
  for (let i = 0; i < 6; i++) {
    const a = Math.atan2(ny, nx) + rand(-1.1, 1.1);
    const sp = rand(40, 150);
    spawnParticle(px, py, Math.cos(a) * sp, Math.sin(a) * sp, '#7fdfef', rand(0.15, 0.35), rand(1, 2.4));
  }
}

/* ---------------- 核心动作 ---------------- */
function emitSonar(ratio) {
  const radius = lerp(SONAR.minRadius, SONAR.maxRadius, ratio);
  sonarCount++;
  noise = clamp(noise + 28 + 46 * ratio, 0, 100);
  if (ratio > 0.96) triggerShake(3.5);
  sfxSonar(ratio);
  spawnWave(player.x, player.y, radius, '#00f0ff', SONAR.speed);

  // 光线投射 → 残影线段（按墙 + 边归并）
  const buckets = new Map();
  for (let i = 0; i < SONAR.rays; i++) {
    const a = (i / SONAR.rays) * Math.PI * 2;
    const r = castRay(player.x, player.y, Math.cos(a), Math.sin(a), radius, walls);
    if (r.rect) {
      const edge = wallEdge(r.rect, r.hx, r.hy);
      if (edge) {
        const key = walls.indexOf(r.rect) + ':' + edge.dir + ':' + edge.fixed.toFixed(1);
        if (!buckets.has(key)) buckets.set(key, { rect: r.rect, edge, pts: [] });
        buckets.get(key).pts.push({ pos: edge.dir === 'v' ? r.hy : r.hx, dist: r.t });
      }
    }
  }
  for (const b of buckets.values()) {
    b.pts.sort((p, q) => p.pos - q.pos);
    let s = null;
    const flush = seg => {
      const edge = b.edge, hw = SONAR.mergeDist / 2;
      if (edge.dir === 'v') {
        const y1 = clamp(seg.start - hw, edge.from, edge.to), y2 = clamp(seg.end + hw, edge.from, edge.to);
        if (y2 > y1) spawnDecal(edge.fixed, y1, edge.fixed, y2, seg.minDist);
      } else {
        const x1 = clamp(seg.start - hw, edge.from, edge.to), x2 = clamp(seg.end + hw, edge.from, edge.to);
        if (x2 > x1) spawnDecal(x1, edge.fixed, x2, edge.fixed, seg.minDist);
      }
    };
    for (const p of b.pts) {
      if (!s) s = { start: p.pos, end: p.pos, minDist: p.dist };
      else if (p.pos - s.end <= SONAR.mergeDist) { s.end = p.pos; s.minDist = Math.min(s.minDist, p.dist); }
      else { flush(s); s = { start: p.pos, end: p.pos, minDist: p.dist }; }
    }
    if (s) flush(s);
  }

  // 守卫感知（声音穿墙）
  for (const g of guards) {
    const d = dist(player.x, player.y, g.x, g.y);
    if (d <= radius) {
      if (hasLineOfSight(player.x, player.y, g.x, g.y, walls)) g.revealTimer = SONAR.revealTime;
      guardAlert(g, player.x, player.y, 1);
    }
  }
}

function throwPebble() {
  if (state !== 'play' || editorOpen || pebbleCount <= 0) return;
  const dx = mouse.x - player.x, dy = mouse.y - player.y;
  const d = Math.hypot(dx, dy) || 1;
  const range = Math.min(d, PEBBLE.maxRange);
  const tx = player.x + dx / d * range, ty = player.y + dy / d * range;
  pebbleCount--;
  updateHUD();
  pebbles.push({ sx: player.x, sy: player.y, tx, ty, t: 0, dur: range / PEBBLE.speed });
  sfxFootstep();
}
function pebbleImpact(p) {
  spawnRipple(p.tx, p.ty, PEBBLE.rippleRadius, '#ffaa00', 900, 3);
  spawnWave(p.tx, p.ty, PEBBLE.rippleRadius, '#ffaa00', 900);
  noise = clamp(noise + 55, 0, 100);
  sfxPebbleImpact();
  for (const g of guards) {
    if (dist(p.tx, p.ty, g.x, g.y) <= PEBBLE.rippleRadius) guardAlert(g, p.tx, p.ty, 2);
  }
}

function guardAlert(g, sx, sy, priority) {
  if (g.state === 'ALERT') {
    if (priority >= 2) { g.source = { x: sx, y: sy }; g.alertTimer = Math.max(g.alertTimer, 4); }
    return;
  }
  g.state = 'ALERT';
  g.source = { x: sx, y: sy };
  g.alertTimer = 6;
  g.exclaim = 1.0;
  g.revealTimer = Math.max(g.revealTimer, 3);
  sfxAlert();
}

/* ---------------- 守卫 AI ---------------- */
function guardMoveToward(g, tx, ty, step) {
  if (step <= 0) return;
  const ox = g.x, oy = g.y;
  let dx = tx - g.x, dy = ty - g.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return;
  const ux = dx / d, uy = dy / d;
  moveCircleBody(g, ux * step, uy * step, walls);
  const moved = Math.hypot(g.x - ox, g.y - oy);
  if (moved < step * 0.35) {
    // 卡墙兜底：尝试沿墙切线滑动
    const dirs = [{ x: -uy, y: ux }, { x: uy, y: -ux }];
    let best = null, bestD = Infinity;
    for (const dd of dirs) {
      g.x = ox; g.y = oy;
      const h = moveCircleBody(g, dd.x * step, dd.y * step, walls);
      const m2 = Math.hypot(g.x - ox, g.y - oy);
      if (m2 > step * 0.35) {
        const nd = dist(g.x, g.y, tx, ty);
        if (nd < bestD) { bestD = nd; best = { x: g.x, y: g.y }; }
      }
    }
    if (best) { g.x = best.x; g.y = best.y; }
    else { g.x = ox; g.y = oy; }
  }
}
function updateGuard(g, dt) {
  // 心跳（巡逻）
  if (g.state === 'PATROL') {
    g.hbTimer -= dt;
    if (g.hbTimer <= 0) {
      g.hbTimer = GUARD.heartbeatInterval;
      spawnRipple(g.x, g.y, 62, '#ff3355', 130, 2);
    }
  }
  if (g.state === 'PATROL') {
    const wp = g.waypoints[g.wpIndex];
    if (wp) {
      g.angle = Math.atan2(wp.y - g.y, wp.x - g.x);
      guardMoveToward(g, wp.x, wp.y, GUARD.patrolSpeed * dt);
      if (dist(g.x, g.y, wp.x, wp.y) < 6) g.wpIndex = (g.wpIndex + 1) % g.waypoints.length;
    }
  } else if (g.state === 'ALERT') {
    g.alertTimer -= dt;
    g.exclaim = Math.max(0, g.exclaim - dt * 0.6);
    const d = dist(g.x, g.y, g.source.x, g.source.y);
    if (d < 18 || g.alertTimer <= 0) {
      g.state = 'SEARCH';
      g.searchTimer = GUARD.searchTime;
    } else {
      g.angle = Math.atan2(g.source.y - g.y, g.source.x - g.x);
      guardMoveToward(g, g.source.x, g.source.y, GUARD.alertSpeed * dt);
    }
  } else if (g.state === 'SEARCH') {
    g.searchTimer -= dt;
    g.angle += dt * 4.2;
    if (g.searchTimer <= 0) {
      g.state = 'PATROL';
      g.wpIndex = nearestWaypoint(g);
    }
  }
  if (g.revealTimer > 0) g.revealTimer -= dt;
}
function nearestWaypoint(g) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < g.waypoints.length; i++) {
    const d = dist(g.x, g.y, g.waypoints[i].x, g.waypoints[i].y);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/* ---------------- 关卡装载 ---------------- */
function loadLevel(idx) {
  levelIndex = idx;
  const L = LEVELS[idx];
  walls = L.walls.map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
  guards = L.guards.map(g => ({
    waypoints: g.waypoints.map(p => ({ x: p.x, y: p.y })),
    x: g.waypoints[0].x, y: g.waypoints[0].y, r: GUARD.r,
    state: 'PATROL', wpIndex: 0, source: { x: 0, y: 0 },
    alertTimer: 0, searchTimer: 0, exclaim: 0, revealTimer: 0,
    hbTimer: rand(0, GUARD.heartbeatInterval), angle: 0, nextHb: 0,
  }));
  player = { x: L.start.x, y: L.start.y, r: PLAYER.r };
  exit = { x: L.exit.x, y: L.exit.y, w: L.exit.w, h: L.exit.h };
  hints = L.hints || [];
  decals = []; waves = []; ripples = []; pebbles = []; particles = [];
  pebbleCount = PEBBLE.count; sonarCount = 0; noise = 0; levelTime = 0;
  footstepTimer = 0; exitParticleTimer = 0;
  charging = false; chargeSources.clear();
  updateHUD();
}

function startGame() {
  initAudio();
  state = 'play';
  $('#startOverlay').classList.add('hidden');
  loadLevel(0);
}
function restartLevel() {
  state = 'play';
  $('#winOverlay').classList.add('hidden');
  $('#loseOverlay').classList.add('hidden');
  redFlash = 0;
  loadLevel(levelIndex);
}
function nextLevel() {
  if (levelIndex + 1 < LEVELS.length) { loadLevel(levelIndex + 1); state = 'play'; $('#winOverlay').classList.add('hidden'); }
  else { state = 'start'; $('#winOverlay').classList.add('hidden'); $('#startOverlay').classList.remove('hidden'); }
}
function fail() {
  if (state !== 'play') return;
  state = 'lost';
  redFlash = 1;
  triggerShake(5);
  sfxFail();
  $('#loseOverlay').classList.remove('hidden');
}
function win() {
  if (state !== 'play') return;
  state = 'won';
  sfxWin();
  let rank = '暗夜行者';
  if (sonarCount === 0) rank = '无声幽灵';
  else if (pebbleCount === 3 && sonarCount <= 5) rank = '幽灵潜行者';
  else if (sonarCount >= 20) rank = '声波狂人';
  $('#winTitle').textContent = (levelIndex + 1 === LEVELS.length) ? '全部通关！' : '抵达出口';
  $('#winRank').textContent = '称号 · ' + rank;
  $('#statTime').textContent = levelTime.toFixed(1) + 's';
  $('#statSonar').textContent = sonarCount;
  $('#statPebble').textContent = pebbleCount;
  $('#nextBtn').style.display = (levelIndex + 1 < LEVELS.length) ? '' : 'none';
  $('#winOverlay').classList.remove('hidden');
}
function triggerShake(mag) { shake.t = 0; shake.dur = 0.3; shake.mag = mag; }

/* ---------------- 主循环 ---------------- */
function update(dt) {
  levelTime += dt;
  noise = Math.max(0, noise - 30 * dt);
  if (shake.t < shake.dur) shake.t += dt;
  redFlash = Math.max(0, redFlash - dt * 2.2);

  // 玩家移动
  let ix = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
  let iy = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
  if (ix || iy) {
    const l = Math.hypot(ix, iy); ix /= l; iy /= l;
    const sp = PLAYER.speed * (charging ? PLAYER.chargeSlow : 1) * dt;
    const hit = moveCircleBody(player, ix * sp, iy * sp, walls);
    if (hit) { spawnSparks(hit.px, hit.py, hit.nx, hit.ny); sfxWallBump(); }
    footstepTimer -= dt;
    if (footstepTimer <= 0) {
      footstepTimer = FOOTSTEP.interval;
      spawnRipple(player.x, player.y, FOOTSTEP.radius, '#ffffff', 120, 1.4);
      noise = clamp(noise + 4, 0, 100);
      sfxFootstep();
      for (const g of guards) if (dist(player.x, player.y, g.x, g.y) <= FOOTSTEP.alertRadius) guardAlert(g, player.x, player.y, 1);
    }
  }

  // 守卫
  for (const g of guards) updateGuard(g, dt);

  // 抓捕判定
  for (const g of guards) if (dist(player.x, player.y, g.x, g.y) < player.r + g.r - 2) { fail(); return; }

  // 出口判定
  if (circleRectOverlap(player.x, player.y, player.r + 6, exit)) { win(); return; }

  // 石子
  for (let i = pebbles.length - 1; i >= 0; i--) {
    const p = pebbles[i];
    p.t += dt / p.dur;
    if (p.t >= 1) { pebbles.splice(i, 1); pebbleImpact(p); }
  }

  // 波纹 / 波前 / 粒子 / 残影 生命周期
  for (let i = waves.length - 1; i >= 0; i--) { waves[i].r += waves[i].speed * dt; if (waves[i].r >= waves[i].maxR) waves.splice(i, 1); }
  for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].r += ripples[i].speed * dt; if (ripples[i].r >= ripples[i].maxR) ripples.splice(i, 1); }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
    if (time >= p.birth + p.maxLife) particles.splice(i, 1);
  }
  for (let i = decals.length - 1; i >= 0; i--) if (time - decals[i].arrive > SONAR.decalFade) decals.splice(i, 1);

  // 出口粒子（每 3s 一波）
  exitParticleTimer -= dt;
  if (exitParticleTimer <= 0) {
    exitParticleTimer = 3;
    const cx = exit.x + exit.w / 2, cy = exit.y + exit.h / 2;
    for (let i = 0; i < 5; i++) spawnParticle(cx + rand(-10, 10), cy + rand(-10, 10), rand(-14, 14), rand(-40, -14), '#3ee06a', rand(1.2, 2.2), rand(1.5, 3));
  }

  // 心跳音效（守卫警戒且近）
  if (actx) {
    for (const g of guards) {
      if (g.state === 'ALERT') {
        const d = dist(player.x, player.y, g.x, g.y);
        if (d < 250) {
          const rate = lerp(0.95, 0.35, clamp(1 - d / 250, 0, 1));
          if (time >= g.nextHb) { g.nextHb = time + rate; sfxHeartbeat(); }
        }
      }
    }
  }
  updateHUD();
}

/* ---------------- 渲染 ---------------- */
function beginWorld() {
  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(scale, scale);
  if (shake.t < shake.dur) {
    const k = (1 - shake.t / shake.dur) * shake.mag;
    ctx.translate(rand(-k, k), rand(-k, k));
  }
}
function endWorld() { ctx.restore(); }

function drawFloor() {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  // 地板教学提示（关 1）
  if (hints.length) {
    ctx.fillStyle = 'rgba(120,140,165,0.55)';
    ctx.font = '16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    hints.forEach(h => ctx.fillText(h.text, h.x, h.y));
  }
}

function drawDecals() {
  for (const d of decals) {
    if (time < d.arrive) continue;
    const a = Math.max(0, 1 - (time - d.arrive) / SONAR.decalFade);
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(0,240,255,${(a * 0.28).toFixed(3)})`;
    ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2); ctx.stroke();
    ctx.strokeStyle = `rgba(180,250,255,${(a * 0.95).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2); ctx.stroke();
  }
}

function drawWaves() {
  for (const w of waves) {
    const p = w.r / w.maxR;
    const a = Math.max(0, 1 - p);
    const grad = ctx.createRadialGradient(w.x, w.y, w.r * 0.6, w.x, w.y, w.r);
    grad.addColorStop(0, 'rgba(0,240,255,0)');
    grad.addColorStop(0.85, `rgba(0,240,255,${(a * 0.10).toFixed(3)})`);
    grad.addColorStop(1, `rgba(0,240,255,${(a * 0.5).toFixed(3)})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawRipples() {
  for (const r of ripples) {
    const p = r.r / r.maxR;
    const a = Math.max(0, 1 - p);
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = a * 0.6;
    ctx.lineWidth = r.width * (1 - p * 0.6) + 0.4;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawExit() {
  const cx = exit.x + exit.w / 2, cy = exit.y + exit.h / 2;
  const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 2.2));
  ctx.fillStyle = `rgba(30,220,110,${(0.10 + 0.12 * pulse).toFixed(3)})`;
  ctx.strokeStyle = `rgba(70,255,150,${(0.55 + 0.4 * pulse).toFixed(3)})`;
  ctx.lineWidth = 2.2;
  roundRect(exit.x, exit.y, exit.w, exit.h, 6);
  ctx.fill(); ctx.stroke();
  // 门内竖线
  ctx.strokeStyle = `rgba(140,255,190,${(0.3 * pulse).toFixed(3)})`;
  ctx.lineWidth = 1.4;
  for (let i = 1; i <= 3; i++) {
    const lx = exit.x + exit.w * i / 4;
    ctx.beginPath(); ctx.moveTo(lx, exit.y + 5); ctx.lineTo(lx, exit.y + exit.h - 5); ctx.stroke();
  }
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayer() {
  // 蓄力圆环
  if (charging) {
    const ratio = clamp((time - chargeStart) / SONAR.maxCharge, 0, 1);
    const R = player.r + 6 + ratio * 34;
    ctx.strokeStyle = `rgba(0,240,255,${(0.5 + ratio * 0.5).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(player.x, player.y, R, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2); ctx.stroke();
    if (ratio >= 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(player.x, player.y, R, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // 本体
  ctx.fillStyle = 'rgba(215,240,255,0.95)';
  ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,240,255,0.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(player.x, player.y, player.r + 3, 0, Math.PI * 2); ctx.stroke();
}

function drawGuard(g) {
  const visible = g.revealTimer > 0 || g.state !== 'PATROL';
  if (!visible) return;
  let alpha = g.state !== 'PATROL' ? 1 : clamp(g.revealTimer / 0.6, 0, 1);
  const c = g.state === 'ALERT' ? '#ff3355' : (g.state === 'SEARCH' ? '#ff7744' : '#ff3355');
  ctx.save();
  ctx.translate(g.x, g.y);
  if (g.state === 'SEARCH') ctx.rotate(g.angle); else ctx.rotate(g.angle);
  ctx.globalAlpha = alpha;
  // 菱形
  ctx.strokeStyle = c;
  ctx.lineWidth = 2.4;
  ctx.shadowColor = c; ctx.shadowBlur = 10;
  const R = GUARD.r;
  ctx.beginPath();
  ctx.moveTo(R, 0); ctx.lineTo(0, R * 0.72); ctx.lineTo(-R, 0); ctx.lineTo(0, -R * 0.72); ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,51,85,0.16)';
  ctx.fill();
  // 警戒感叹号
  if (g.state === 'ALERT' && g.exclaim > 0) {
    ctx.fillStyle = `rgba(255,80,80,${(g.exclaim).toFixed(3)})`;
    ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('!', 0, -R - 12);
  }
  ctx.restore();
}

function drawPebbles() {
  for (const p of pebbles) {
    const x = lerp(p.sx, p.tx, p.t), y = lerp(p.sy, p.ty, p.t);
    const s = Math.sin(Math.PI * p.t) * 4 + 2;
    ctx.fillStyle = '#ffaa00';
    ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = clamp(1 - (time - p.birth) / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawAim() {
  if (pebbleCount > 0 && state === 'play' && mouse.inside) {
    ctx.strokeStyle = 'rgba(255,170,0,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,170,0,0.6)';
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width / DPR, canvas.height / DPR);

  beginWorld();
  drawFloor();
  drawDecals();
  drawWaves();
  drawRipples();
  drawExit();
  drawPebbles();
  for (const g of guards) drawGuard(g);
  drawPlayer();
  drawParticles();
  drawAim();
  if (editorOpen) drawEditorWorld();
  endWorld();

  // 失败红闪
  if (redFlash > 0) {
    ctx.fillStyle = `rgba(255,34,51,${(redFlash * 0.4).toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width / DPR, canvas.height / DPR);
  }
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  $('#hudLevel').textContent = `关卡 ${levelIndex + 1} / ${LEVELS.length}`;
  const pWrap = $('#pebbles');
  pWrap.innerHTML = '';
  for (let i = 0; i < PEBBLE.count; i++) {
    const d = document.createElement('div');
    d.className = 'pebble' + (i < pebbleCount ? '' : ' spent');
    pWrap.appendChild(d);
  }
  const fill = $('#noiseFill');
  fill.style.width = clamp(noise, 0, 100) + '%';
  const t = clamp(noise / 100, 0, 1);
  fill.style.background = t > 0.6 ? '#ff5566' : (t > 0.3 ? '#ffb84d' : '#3ee06a');
}

/* ---------------- 关卡编辑器 ---------------- */
let editorOpen = false;
let editorMode = 'wall';
let editorDrag = null;
let editorGuardPath = [];   // 当前正在绘制的守卫路径

function toggleEditor() {
  editorOpen = !editorOpen;
  $('#editorBar').classList.toggle('show', editorOpen);
  $('#editorHint').classList.toggle('show', editorOpen);
  if (editorOpen) { editorGuardPath = []; setEditorMode('wall'); updateEditorHint(); }
  else { editorGuardPath = []; }
}
function setEditorMode(m) {
  editorMode = m;
  document.querySelectorAll('#editorBar .ebtn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'guard') editorGuardPath = [];
  updateEditorHint();
}
function updateEditorHint() {
  const map = {
    wall: '编辑模式：拖拽绘制墙体 · 右键删除墙 / 巡逻点',
    guard: '编辑模式：点击添加守卫巡逻点 · 点「新守卫路径」开始下一守卫',
    exit: '编辑模式：点击放置出口',
    start: '编辑模式：点击放置玩家出生点',
  };
  $('#editorHint').textContent = map[editorMode] || '';
}
document.querySelectorAll('#editorBar .ebtn[data-mode]').forEach(b => b.addEventListener('click', () => setEditorMode(b.dataset.mode)));
$('#newGuardBtn').addEventListener('click', () => {
  if (editorGuardPath.length >= 2) {
    LEVELS[levelIndex].guards.push({ waypoints: editorGuardPath.slice() });
    applyEditorLevel();
  }
  editorGuardPath = [];
  updateEditorHint();
});
$('#closeEditorBtn').addEventListener('click', toggleEditor);
$('#exportBtn').addEventListener('click', openExport);
$('#copyBtn').addEventListener('click', () => { $('#exportArea').select(); try { navigator.clipboard.writeText($('#exportArea').value); } catch (e) {} });
$('#importBtn').addEventListener('click', importLevel);
$('#closeExportBtn').addEventListener('click', () => $('#exportModal').classList.remove('show'));

function editorDown(p, button) {
  if (button === 2) { editorErase(p); return; }
  if (editorMode === 'wall') {
    editorDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  } else if (editorMode === 'guard') {
    editorGuardPath.push({ x: Math.round(p.x), y: Math.round(p.y) });
  } else if (editorMode === 'exit') {
    LEVELS[levelIndex].exit = { x: p.x - 23, y: p.y - 32, w: 46, h: 64 };
    applyEditorLevel();
  } else if (editorMode === 'start') {
    LEVELS[levelIndex].start = { x: p.x, y: p.y };
    applyEditorLevel();
  }
}
canvas.addEventListener('mousemove', e => {
  const p = toWorld(e.clientX, e.clientY);
  mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  if (editorOpen && editorDrag) { editorDrag.x1 = p.x; editorDrag.y1 = p.y; }
});
canvas.addEventListener('mouseup', e => {
  if (editorOpen && editorDrag && e.button === 0) {
    const d = editorDrag, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    if (w > 12 && h > 12) LEVELS[levelIndex].walls.push({ x, y, w, h });
    editorDrag = null;
    applyEditorLevel();
  }
});
function editorErase(p) {
  // 优先删墙
  for (let i = LEVELS[levelIndex].walls.length - 1; i >= 0; i--) {
    const w = LEVELS[levelIndex].walls[i];
    if (p.x >= w.x - 4 && p.x <= w.x + w.w + 4 && p.y >= w.y - 4 && p.y <= w.y + w.h + 4) {
      LEVELS[levelIndex].walls.splice(i, 1); applyEditorLevel(); return;
    }
  }
  // 删巡逻点
  for (const g of LEVELS[levelIndex].guards) {
    for (let i = g.waypoints.length - 1; i >= 0; i--) {
      if (dist(p.x, p.y, g.waypoints[i].x, g.waypoints[i].y) < 14) { g.waypoints.splice(i, 1); applyEditorLevel(); return; }
    }
  }
  if (editorGuardPath.length) { editorGuardPath.pop(); }
}
function applyEditorLevel() { loadLevel(levelIndex); }
function openExport() {
  const L = LEVELS[levelIndex];
  const out = {
    name: L.name,
    walls: L.walls.map(w => ({ x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h) })),
    guards: L.guards.map(g => ({ waypoints: g.waypoints.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) })),
    start: { x: Math.round(L.start.x), y: Math.round(L.start.y) },
    exit: L.exit,
  };
  $('#exportArea').value = JSON.stringify(out, null, 2);
  $('#exportModal').classList.add('show');
}
function importLevel() {
  try {
    const L = JSON.parse($('#exportArea').value);
    if (!L.walls || !L.start) throw new Error('格式错误');
    LEVELS[levelIndex].walls = L.walls;
    LEVELS[levelIndex].guards = (L.guards || []).filter(g => g.waypoints && g.waypoints.length >= 1);
    LEVELS[levelIndex].start = L.start;
    LEVELS[levelIndex].exit = L.exit || { x: 640, y: 360, w: 46, h: 64 };
    $('#exportModal').classList.remove('show');
    applyEditorLevel();
  } catch (err) { alert('导入失败：' + err.message); }
}

function drawEditorWorld() {
  // 墙体
  ctx.strokeStyle = 'rgba(0,240,255,0.35)';
  ctx.lineWidth = 1;
  for (const w of walls) { ctx.strokeRect(w.x, w.y, w.w, w.h); }
  if (editorDrag) { ctx.strokeStyle = 'rgba(0,240,255,0.8)'; ctx.strokeRect(Math.min(editorDrag.x0, editorDrag.x1), Math.min(editorDrag.y0, editorDrag.y1), Math.abs(editorDrag.x1 - editorDrag.x0), Math.abs(editorDrag.y1 - editorDrag.y0)); }
  // 守卫巡逻点
  for (const g of guards) {
    if (g.waypoints.length) {
      ctx.strokeStyle = 'rgba(255,51,85,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(g.waypoints[0].x, g.waypoints[0].y);
      for (const p of g.waypoints) ctx.lineTo(p.x, p.y);
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const p of g.waypoints) { ctx.fillStyle = '#ff3355'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  // 当前路径
  if (editorGuardPath.length) {
    ctx.strokeStyle = 'rgba(255,120,140,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(editorGuardPath[0].x, editorGuardPath[0].y);
    for (const p of editorGuardPath) ctx.lineTo(p.x, p.y);
    ctx.stroke(); ctx.setLineDash([]);
    for (const p of editorGuardPath) { ctx.fillStyle = '#ff8899'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  // 出口 / 出生点
  ctx.strokeStyle = 'rgba(62,224,106,0.8)'; ctx.lineWidth = 2;
  ctx.strokeRect(exit.x, exit.y, exit.w, exit.h);
  ctx.fillStyle = '#3ee06a'; ctx.beginPath(); ctx.arc(player.x, player.y, 6, 0, Math.PI * 2); ctx.fill();
}

/* ---------------- 启动 ---------------- */
function loop() {
  const now = performance.now() / 1000;
  let dt = now - lastTime; lastTime = now;
  time = now;
  dt = clamp(dt, 0, 0.033);
  if (state === 'play' && !editorOpen) update(dt);
  render();
  requestAnimationFrame(loop);
}
loadLevel(0);
updateHUD();
requestAnimationFrame(loop);

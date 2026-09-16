const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });
const PORT = process.env.PORT || 3000;
// ARCHER_SKILLS_PATCH_V1

const MAPS = {
  forest: {
    id: 'forest', name: '숲', width: 5200, height: 3400, safeAll: false,
    safeZone: { x: 2600, y: 1700, radius: 470 },
    portals: [{ id: 'forest-village', x: 2600, y: 1700, radius: 82, label: '마을 포탈', target: 'village', targetX: 1300, targetY: 1240 }]
  },
  village: {
    id: 'village', name: '마을', width: 2600, height: 1900, safeAll: true, safeZone: null,
    portals: [
      { id: 'village-forest', x: 1300, y: 950, radius: 82, label: '숲 포탈', target: 'forest', targetX: 2600, targetY: 1940 },
      { id: 'village-arena', x: 2050, y: 950, radius: 82, label: '결투장 포탈', target: 'arena', targetX: 1200, targetY: 1260 }
    ]
  },
  arena: {
    id: 'arena', name: '결투장', width: 2400, height: 1600, safeAll: false, safeZone: null,
    portals: [{ id: 'arena-village', x: 1200, y: 1360, radius: 82, label: '마을 포탈', target: 'village', targetX: 2050, targetY: 1140 }]
  }
};

const FOREST_CLEARING = { x: 2600, y: 1700, rx: 1050, ry: 680 };
const FOREST_PATHS = [
  [{ x: 2600, y: 1700 }, { x: 2050, y: 1700 }, { x: 1460, y: 1580 }, { x: 850, y: 1450 }],
  [{ x: 2600, y: 1700 }, { x: 2700, y: 1150 }, { x: 3040, y: 650 }, { x: 3260, y: 100 }],
  [{ x: 2600, y: 1700 }, { x: 3150, y: 1510 }, { x: 3700, y: 1120 }, { x: 4280, y: 650 }],
  [{ x: 2600, y: 1700 }, { x: 3200, y: 2040 }, { x: 3680, y: 2340 }, { x: 4210, y: 2390 }],
  [{ x: 2600, y: 1700 }, { x: 2230, y: 2280 }, { x: 1620, y: 2720 }, { x: 900, y: 3230 }]
];
const FOREST_RIVERS = [
  { width: 230, points: [{ x: 420, y: -100 }, { x: 480, y: 400 }, { x: 610, y: 850 }, { x: 620, y: 1240 }, { x: 615, y: 1470 }, { x: 570, y: 1900 }, { x: 430, y: 2380 }, { x: 500, y: 2900 }, { x: 590, y: 3500 }] },
  { width: 330, points: [{ x: 4380, y: 620 }, { x: 4500, y: 1020 }, { x: 4550, y: 1480 }, { x: 4470, y: 1900 }, { x: 4320, y: 2350 }, { x: 4410, y: 2820 }] }
];
const FOREST_BRIDGES = [
  { x: 620, y: 1450, w: 380, h: 180 },
  { x: 4330, y: 2360, w: 430, h: 190 }
];
const FOREST_CLIFFS = [
  { x: 1600, y: 80, w: 930, h: 250 },
  { x: 3500, y: 2760, w: 1250, h: 270 },
  { x: 40, y: 1900, w: 500, h: 260 },
  { x: 3660, y: 120, w: 620, h: 230 }
];
const FOREST_CAVE = { x: 4560, y: 340, r: 155 };

function hashRand(n) {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}
function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const denom = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / denom));
  const x = ax + abx * t, y = ay + aby * t;
  return Math.hypot(px - x, py - y);
}
function pointInRect(x, y, rect, pad = 0) {
  return x >= rect.x - rect.w / 2 - pad && x <= rect.x + rect.w / 2 + pad && y >= rect.y - rect.h / 2 - pad && y <= rect.y + rect.h / 2 + pad;
}
function pointInClearing(x, y, pad = 0) {
  const rx = FOREST_CLEARING.rx + pad, ry = FOREST_CLEARING.ry + pad;
  const dx = (x - FOREST_CLEARING.x) / rx, dy = (y - FOREST_CLEARING.y) / ry;
  return dx * dx + dy * dy <= 1;
}
function pointNearForestPath(x, y, distance = 120) {
  for (const pathPoints of FOREST_PATHS) {
    for (let i = 1; i < pathPoints.length; i++) {
      const a = pathPoints[i - 1], b = pathPoints[i];
      if (pointSegmentDistance(x, y, a.x, a.y, b.x, b.y) <= distance) return true;
    }
  }
  return false;
}
function pointNearRiver(x, y, pad = 0) {
  for (const river of FOREST_RIVERS) {
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1], b = river.points[i];
      if (pointSegmentDistance(x, y, a.x, a.y, b.x, b.y) <= river.width / 2 + pad) return true;
    }
  }
  return false;
}
function pointInCliff(x, y, pad = 0) {
  return FOREST_CLIFFS.some(c => pointInRect(x, y, c, pad));
}
function bridgeAt(x, y, pad = 0) {
  return FOREST_BRIDGES.some(b => pointInRect(x, y, b, pad));
}

function buildRiverCollisionCircles() {
  const circles = [];
  for (const river of FOREST_RIVERS) {
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1], b = river.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / 70));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (bridgeAt(x, y, 105)) continue;
        circles.push({ x, y, r: river.width / 2 - 8 });
      }
    }
  }
  return circles;
}
const FOREST_WATER_COLLIDERS = buildRiverCollisionCircles();

function buildForestTrees() {
  const trees = [];
  for (let i = 0; i < 260 && trees.length < 145; i++) {
    const x = 90 + hashRand(i + 3) * 5020;
    const y = 90 + hashRand(i + 903) * 3220;
    if (pointInClearing(x, y, 120)) continue;
    if (pointNearForestPath(x, y, 135)) continue;
    if (pointNearRiver(x, y, 80)) continue;
    if (pointInCliff(x, y, 55)) continue;
    if (Math.hypot(x - FOREST_CAVE.x, y - FOREST_CAVE.y) < FOREST_CAVE.r + 120) continue;
    const r = 30 + hashRand(i + 1803) * 18;
    trees.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), trunk: Math.round(14 + r * 0.12) });
  }
  return trees;
}
function buildForestRocks() {
  const rocks = [];
  for (let i = 0; i < 90 && rocks.length < 34; i++) {
    const x = 120 + hashRand(i + 4101) * 4960;
    const y = 120 + hashRand(i + 4801) * 3160;
    if (pointInClearing(x, y, 60)) continue;
    if (pointNearForestPath(x, y, 80)) continue;
    if (pointNearRiver(x, y, 25)) continue;
    if (pointInCliff(x, y, 25)) continue;
    const r = 18 + hashRand(i + 5501) * 20;
    rocks.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
  }
  return rocks;
}
const FOREST_TREES = buildForestTrees();
const FOREST_ROCKS = buildForestRocks();
const FOREST_LAYOUT = {
  clearing: FOREST_CLEARING,
  paths: FOREST_PATHS,
  rivers: FOREST_RIVERS,
  bridges: FOREST_BRIDGES,
  cliffs: FOREST_CLIFFS,
  cave: FOREST_CAVE,
  trees: FOREST_TREES,
  rocks: FOREST_ROCKS
};

function circleRectOverlap(x, y, radius, rect) {
  const left = rect.x - rect.w / 2, right = rect.x + rect.w / 2;
  const top = rect.y - rect.h / 2, bottom = rect.y + rect.h / 2;
  const cx = Math.max(left, Math.min(x, right));
  const cy = Math.max(top, Math.min(y, bottom));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy < radius * radius;
}
function forestBlocked(x, y, radius = 20) {
  if (x < radius || y < radius || x > MAPS.forest.width - radius || y > MAPS.forest.height - radius) return true;
  for (const water of FOREST_WATER_COLLIDERS) {
    const dx = x - water.x, dy = y - water.y, rr = radius + water.r;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  for (const cliff of FOREST_CLIFFS) if (circleRectOverlap(x, y, radius, cliff)) return true;
  for (const tree of FOREST_TREES) {
    const dx = x - tree.x, dy = y - tree.y, rr = radius + tree.trunk;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  for (const rock of FOREST_ROCKS) {
    const dx = x - rock.x, dy = y - rock.y, rr = radius + rock.r * 0.72;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  const caveDist = Math.hypot(x - FOREST_CAVE.x, y - FOREST_CAVE.y);
  if (caveDist < FOREST_CAVE.r + radius && y < FOREST_CAVE.y + 70) return true;
  return false;
}

const MAX_PLAYERS = 20;
const PLAYER_SPEED = 300;
const PLAYER_RADIUS = 24;
const PLAYER_MAX_HP = 100;
const PLAYER_RESPAWN_MS = 1500;
const SAFE_HEAL_PER_SECOND = 18;

const PHYSICS_RATE = 30;
const NETWORK_RATE = 10;
const MONSTER_AI_RATE = 6;
const GRID_SIZE = 400;
const VIEW_RADIUS = 1300;
const MONSTER_ACTIVE_RADIUS = 1050;

const AVATARS = ['mage', 'pirate', 'archer'];
const NORMAL_SLIMES = 150;
const ELITE_SLIMES = 25;
const MIN_SLIME_SPAWN_DISTANCE = 125;
const SLIME_RESPAWN_MS = 5000;
const BOSS_TARGET = 20;
const BOSS_HP = 1200;
const BOSS_KEEP_NORMAL = 18;
const BOSS_KEEP_ELITE = 4;

const SLIME_AGGRO = 380;
const ELITE_AGGRO = 480;
const BOSS_AGGRO = 700;
const SLIME_CHASE_SPEED = 125;
const ELITE_CHASE_SPEED = 155;
const BOSS_CHASE_SPEED = 118;
const SLIME_DAMAGE = 10;
const ELITE_DAMAGE = 18;
const BOSS_DAMAGE = 30;
const SLIME_ATTACK_COOLDOWN = 900;
const ELITE_ATTACK_COOLDOWN = 780;
const BOSS_ATTACK_COOLDOWN = 700;

const SOUL_FIRE_SPEED = 900;
const SOUL_FIRE_DAMAGE = 60;
const SOUL_FIRE_RADIUS = 24;
const SOUL_FIRE_LIFE = 1.5;
const SOUL_FIRE_COOLDOWN = 900;

const TRIPLE_ARROW_DAMAGE = 38;
const TRIPLE_ARROW_RANGE = 950;
const TRIPLE_ARROW_SPREAD = 0.14;
const TRIPLE_ARROW_COOLDOWN = 850;
const ARROW_RAIN_RANGE = 900;
const ARROW_RAIN_RADIUS = 190;
const ARROW_RAIN_DAMAGE = 24;
const ARROW_RAIN_WAVES = 4;
const ARROW_RAIN_INTERVAL = 320;
const ARROW_RAIN_COOLDOWN = 4800;
const GHOST_SHIP_DURATION = 3000;
const GHOST_SHIP_SPEED = 520;
const GHOST_SHIP_RADIUS = 115;
const GHOST_SHIP_DAMAGE = 85;
const GHOST_SHIP_COOLDOWN = 6500;

const SLASH_RANGE = 145;
const SLASH_HALF_ANGLE = Math.PI / 3;
const SLASH_DAMAGE = 120;
const SLASH_COOLDOWN = 1000;
const SLASH_EFFECT_LIFE = 0.28;

const CHAIN_DAMAGE = 70;
const CHAIN_RADIUS = 340;
const CHAIN_MAX_TARGETS = 5;
const CHAIN_CAST_RANGE = 800;
const CHAIN_COOLDOWN = 4500;
const CHAIN_EFFECT_LIFE = 0.28;
const CHAIN_AIM_DOT = Math.cos(Math.PI / 4);

const PORTAL_USE_RANGE = 140;
const PORTAL_COOLDOWN = 900;

const players = new Map();
const slimes = new Map();
const soulFires = new Map();
let slimeGrid = new Map();

let nextSlimeId = 1;
let nextSoulFireId = 1;
let nextEffectId = 1;
let bossProgress = 0;
let bossId = null;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function normalize(x, y, fx = 0, fy = 1) {
  x = Number(x); y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: fx, y: fy };
  const len = Math.hypot(x, y);
  return len < 0.001 ? { x: fx, y: fy } : { x: x / len, y: y / len };
}
function directionFromVector(x, y, previous = 'front') {
  if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) return previous;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'front' : 'back';
}
function mapSpec(id) { return MAPS[id] || MAPS.forest; }
function roomFor(map) { return 'map:' + map; }
function emitMap(map, event, data) { io.to(roomFor(map)).emit(event, data); }

function isPointInForestSafeZone(x, y, extra = 0) {
  const z = MAPS.forest.safeZone;
  const dx = x - z.x, dy = y - z.y, r = z.radius + extra;
  return dx * dx + dy * dy <= r * r;
}
function isPlayerSafe(p) {
  if (!p || !p.alive) return true;
  const map = mapSpec(p.map);
  if (map.safeAll) return true;
  return p.map === 'forest' && isPointInForestSafeZone(p.x, p.y);
}
function canPvp(a, b) {
  return !!(a && b && a.id !== b.id && a.alive && b.alive && a.map === b.map && !isPlayerSafe(a) && !isPlayerSafe(b));
}

function gridKey(cx, cy) { return cx + ':' + cy; }
function rebuildSlimeGrid() {
  const next = new Map();
  for (const s of slimes.values()) {
    if (!s.alive) continue;
    const cx = Math.floor(s.x / GRID_SIZE), cy = Math.floor(s.y / GRID_SIZE);
    const key = gridKey(cx, cy);
    let bucket = next.get(key);
    if (!bucket) { bucket = []; next.set(key, bucket); }
    bucket.push(s);
  }
  slimeGrid = next;
}
function querySlimes(x, y, radius) {
  const out = [];
  const minX = Math.floor((x - radius) / GRID_SIZE), maxX = Math.floor((x + radius) / GRID_SIZE);
  const minY = Math.floor((y - radius) / GRID_SIZE), maxY = Math.floor((y + radius) / GRID_SIZE);
  const r2 = radius * radius;
  for (let gx = minX; gx <= maxX; gx++) {
    for (let gy = minY; gy <= maxY; gy++) {
      const bucket = slimeGrid.get(gridKey(gx, gy));
      if (!bucket) continue;
      for (const s of bucket) {
        if (!s.alive) continue;
        const dx = s.x - x, dy = s.y - y;
        if (dx * dx + dy * dy <= r2) out.push(s);
      }
    }
  }
  return out;
}

function isFarEnoughFromOtherSlimes(x, y, minDistance) {
  if (!minDistance) return true;
  const d2 = minDistance * minDistance;
  for (const s of slimes.values()) {
    if (!s.alive || s.boss) continue;
    const dx = s.x - x, dy = s.y - y;
    if (dx * dx + dy * dy < d2) return false;
  }
  return true;
}
function forestSpawnPoint(margin = 160, minDistance = 0) {
  for (let tries = 0; tries < 180; tries++) {
    const x = margin + Math.random() * (MAPS.forest.width - margin * 2);
    const y = margin + Math.random() * (MAPS.forest.height - margin * 2);
    if (isPointInForestSafeZone(x, y, 210)) continue;
    if (forestBlocked(x, y, 44)) continue;
    if (!isFarEnoughFromOtherSlimes(x, y, minDistance)) continue;
    return { x, y };
  }
  for (let tries = 0; tries < 80; tries++) {
    const x = margin + Math.random() * (MAPS.forest.width - margin * 2);
    const y = margin + Math.random() * (MAPS.forest.height - margin * 2);
    if (!isPointInForestSafeZone(x, y, 180) && !forestBlocked(x, y, 38)) return { x, y };
  }
  return { x: 3400, y: 1700 };
}
function playerForestSafeSpawn() {
  const z = MAPS.forest.safeZone;
  return { x: z.x, y: z.y + 220 };
}
function makePlayer(id) {
  const p = playerForestSafeSpawn();
  return {
    id, map: 'forest', x: p.x, y: p.y,
    inputX: 0, inputY: 0, aimX: 0, aimY: 1,
    direction: 'front', moving: false, avatar: 'mage',
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, respawnAt: 0,
    lastSoulFireAt: 0, lastSlashAt: 0, lastChainAt: 0, lastTripleArrowAt: 0, lastArrowRainAt: 0, lastGhostShipAt: 0,
    ghostShipUntil: 0, ghostDirX: 0, ghostDirY: 1, ghostHitKeys: new Set(), lastPortalAt: 0
  };
}

function monsterStats(s) {
  if (s.boss) return { aggro: BOSS_AGGRO, speed: BOSS_CHASE_SPEED, damage: BOSS_DAMAGE, cooldown: BOSS_ATTACK_COOLDOWN };
  if (s.elite) return { aggro: ELITE_AGGRO, speed: ELITE_CHASE_SPEED, damage: ELITE_DAMAGE, cooldown: ELITE_ATTACK_COOLDOWN };
  return { aggro: SLIME_AGGRO, speed: SLIME_CHASE_SPEED, damage: SLIME_DAMAGE, cooldown: SLIME_ATTACK_COOLDOWN };
}
function chooseSlimeDirection(s) {
  const angle = Math.random() * Math.PI * 2;
  const speed = s.boss ? 28 + Math.random() * 16 : s.elite ? 48 + Math.random() * 26 : 38 + Math.random() * 26;
  s.vx = Math.cos(angle) * speed;
  s.vy = Math.sin(angle) * speed;
  s.changeAt = Date.now() + 1000 + Math.random() * 2400;
  s.targetId = null;
}
function createSlime(elite = false) {
  const p = forestSpawnPoint(170, MIN_SLIME_SPAWN_DISTANCE);
  const s = {
    id: nextSlimeId++, map: 'forest', x: p.x, y: p.y,
    elite, boss: false, radius: elite ? 34 : 24,
    maxHp: elite ? 180 : 60, hp: elite ? 180 : 60,
    vx: 0, vy: 0, changeAt: 0, alive: true, respawnAt: 0,
    targetId: null, lastAttackAt: 0, suppressedByBoss: false, active: false
  };
  chooseSlimeDirection(s);
  slimes.set(s.id, s);
}
for (let i = 0; i < NORMAL_SLIMES; i++) createSlime(false);
for (let i = 0; i < ELITE_SLIMES; i++) createSlime(true);
rebuildSlimeGrid();

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function suppressMobsForBoss() {
  const normal = shuffle([...slimes.values()].filter(s => s.alive && !s.boss && !s.elite));
  const elite = shuffle([...slimes.values()].filter(s => s.alive && !s.boss && s.elite));
  const suppress = (list, keep) => list.forEach((s, i) => {
    if (i < keep) return;
    s.alive = false; s.hp = 0; s.respawnAt = 0; s.targetId = null; s.vx = 0; s.vy = 0; s.active = false; s.suppressedByBoss = true;
  });
  suppress(normal, BOSS_KEEP_NORMAL);
  suppress(elite, BOSS_KEEP_ELITE);
}
function restoreMobsAfterBoss(now) {
  for (const s of slimes.values()) {
    if (s.boss || s.alive) continue;
    s.suppressedByBoss = false;
    s.respawnAt = now + 1600 + Math.random() * 4500;
  }
}
function createBossSlime() {
  if (bossId !== null) return;
  suppressMobsForBoss();
  const p = forestSpawnPoint(500, 260);
  const s = {
    id: nextSlimeId++, map: 'forest', x: p.x, y: p.y,
    elite: false, boss: true, radius: 78, maxHp: BOSS_HP, hp: BOSS_HP,
    vx: 0, vy: 0, changeAt: 0, alive: true, respawnAt: 0,
    targetId: null, lastAttackAt: 0, suppressedByBoss: false, active: true
  };
  chooseSlimeDirection(s);
  slimes.set(s.id, s);
  bossId = s.id;
  bossProgress = 0;
  rebuildSlimeGrid();
  emitMap('forest', 'bossSpawned', { x: s.x, y: s.y, map: 'forest' });
}
function respawnSlime(s) {
  if (s.boss || bossId !== null || s.suppressedByBoss) return;
  const p = forestSpawnPoint(170, MIN_SLIME_SPAWN_DISTANCE);
  s.x = p.x; s.y = p.y; s.hp = s.maxHp; s.alive = true; s.respawnAt = 0;
  s.lastAttackAt = 0; s.active = false; chooseSlimeDirection(s);
}
function addBossProgress(s) {
  if (bossId !== null) return;
  bossProgress += s.elite ? 2 : 1;
  if (bossProgress >= BOSS_TARGET) createBossSlime();
}
function killSlime(s, now) {
  if (!s.alive) return;
  if (s.boss) {
    s.alive = false; s.hp = 0; slimes.delete(s.id); bossId = null; bossProgress = 0;
    restoreMobsAfterBoss(now); rebuildSlimeGrid(); emitMap('forest', 'bossDefeated');
    return;
  }
  s.alive = false; s.hp = 0; s.targetId = null; s.vx = 0; s.vy = 0; s.active = false;
  if (bossId !== null) { s.respawnAt = 0; s.suppressedByBoss = true; }
  else s.respawnAt = now + SLIME_RESPAWN_MS;
  addBossProgress(s);
}

function socketForPlayer(id) { return io.sockets.sockets.get(id) || null; }
function changePlayerMap(p, targetMap, x, y) {
  const oldMap = p.map;
  const socket = socketForPlayer(p.id);
  if (socket) socket.leave(roomFor(oldMap));
  p.map = targetMap; p.x = x; p.y = y; p.inputX = 0; p.inputY = 0; p.moving = false;
  if (socket) {
    socket.join(roomFor(targetMap));
    const map = mapSpec(targetMap);
    socket.emit('mapChanged', { map: targetMap, mapName: map.name, world: { width: map.width, height: map.height }, portals: map.portals });
  }
}
function respawnPlayer(p) {
  const point = playerForestSafeSpawn();
  changePlayerMap(p, 'forest', point.x, point.y);
  p.hp = p.maxHp; p.alive = true; p.respawnAt = 0;
  const socket = socketForPlayer(p.id);
  if (socket) socket.emit('playerRespawned');
}
function defeatPlayer(p, now, source = 'monster') {
  if (!p.alive) return;
  p.hp = 0; p.alive = false; p.respawnAt = now + PLAYER_RESPAWN_MS;
  p.inputX = 0; p.inputY = 0; p.moving = false;
  const socket = socketForPlayer(p.id);
  if (socket) socket.emit('playerDefeated', { source });
}
function damagePlayer(p, damage, now, source = 'monster') {
  if (!p.alive || isPlayerSafe(p)) return false;
  p.hp = Math.max(0, p.hp - damage);
  if (p.hp <= 0) defeatPlayer(p, now, source);
  return true;
}

function getAttackableTargets(p, range) {
  const out = [];
  const r2 = range * range;
  if (p.map === 'forest') {
    for (const s of querySlimes(p.x, p.y, range)) {
      out.push({ key: 's:' + s.id, type: 'slime', x: s.x, y: s.y, radius: s.radius, ref: s });
    }
  }
  for (const other of players.values()) {
    if (!canPvp(p, other)) continue;
    const dx = other.x - p.x, dy = other.y - p.y;
    if (dx * dx + dy * dy <= r2) out.push({ key: 'p:' + other.id, type: 'player', x: other.x, y: other.y, radius: PLAYER_RADIUS, ref: other });
  }
  return out;
}
function findNearestAttackableTarget(p, range) {
  let best = null, bestD2 = range * range;
  for (const t of getAttackableTargets(p, range)) {
    const dx = t.x - p.x, dy = t.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) { bestD2 = d2; best = t; }
  }
  return best;
}
function resolveAim(p, aimData, autoAim, range) {
  if (autoAim) {
    const t = findNearestAttackableTarget(p, range);
    if (t) return normalize(t.x - p.x, t.y - p.y, p.aimX, p.aimY);
  }
  if (aimData) {
    const a = normalize(aimData.x, aimData.y, p.aimX, p.aimY);
    p.aimX = a.x; p.aimY = a.y; return a;
  }
  return normalize(p.aimX, p.aimY, 0, 1);
}
function skillBlock(p, lastAt, cooldown) {
  if (!p.alive) return 'dead';
  if (isPlayerSafe(p)) return 'safe';
  if (Date.now() - lastAt < cooldown) return 'cooldown';
  return null;
}
function applyCombatDamage(t, amount, owner, now) {
  if (t.type === 'slime') {
    if (!t.ref.alive) return false;
    t.ref.hp -= amount;
    if (t.ref.hp <= 0) killSlime(t.ref, now);
    return true;
  }
  if (t.type === 'player' && canPvp(owner, t.ref)) return damagePlayer(t.ref, amount, now, 'pvp');
  return false;
}

function lineClearForArrow(map, x1, y1, x2, y2) {
  if (map !== 'forest') return true;
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(distance / 32));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (forestBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 5)) return false;
  }
  return true;
}
function bestArrowTarget(p, dirX, dirY, range) {
  let best = null;
  let bestAlong = Infinity;
  for (const target of getAttackableTargets(p, range + 80)) {
    const vx = target.x - p.x;
    const vy = target.y - p.y;
    const along = vx * dirX + vy * dirY;
    if (along < 0 || along > range) continue;
    const perpendicular = Math.abs(vx * dirY - vy * dirX);
    if (perpendicular > target.radius + 18) continue;
    if (!lineClearForArrow(p.map, p.x, p.y, target.x, target.y)) continue;
    if (along < bestAlong) { bestAlong = along; best = target; }
  }
  return best;
}
function targetsInArea(owner, mapId, x, y, radius) {
  const out = [];
  if (mapId === 'forest') {
    for (const slime of querySlimes(x, y, radius + 90)) {
      const dx = slime.x - x, dy = slime.y - y;
      if (dx * dx + dy * dy <= (radius + slime.radius) * (radius + slime.radius)) {
        out.push({ key: 's:' + slime.id, type: 'slime', x: slime.x, y: slime.y, radius: slime.radius, ref: slime });
      }
    }
  }
  for (const other of players.values()) {
    if (!canPvp(owner, other) || other.map !== mapId) continue;
    const dx = other.x - x, dy = other.y - y;
    if (dx * dx + dy * dy <= (radius + PLAYER_RADIUS) * (radius + PLAYER_RADIUS)) {
      out.push({ key: 'p:' + other.id, type: 'player', x: other.x, y: other.y, radius: PLAYER_RADIUS, ref: other });
    }
  }
  return out;
}
function castSoulFire(p, aimData, autoAim) {
  const blocked = p.avatar !== 'mage' ? 'avatar' : skillBlock(p, p.lastSoulFireAt, SOUL_FIRE_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const a = resolveAim(p, aimData, autoAim, 1000);
  p.lastSoulFireAt = Date.now(); p.aimX = a.x; p.aimY = a.y;
  const id = nextSoulFireId++;
  soulFires.set(id, {
    id, ownerId: p.id, map: p.map,
    x: p.x + a.x * 48, y: p.y + a.y * 48,
    vx: a.x * SOUL_FIRE_SPEED, vy: a.y * SOUL_FIRE_SPEED,
    radius: SOUL_FIRE_RADIUS, life: SOUL_FIRE_LIFE,
    pierce: true, hitKeys: new Set()
  });
  return { success: true };
}
function castTripleArrow(p, aimData, autoAim) {
  const blocked = p.avatar !== 'archer' ? 'avatar' : skillBlock(p, p.lastTripleArrowAt, TRIPLE_ARROW_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(p, aimData, autoAim, TRIPLE_ARROW_RANGE);
  const base = Math.atan2(aim.y, aim.x);
  const angles = [base - TRIPLE_ARROW_SPREAD, base, base + TRIPLE_ARROW_SPREAD];
  p.lastTripleArrowAt = now; p.aimX = aim.x; p.aimY = aim.y;
  for (const angle of angles) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const target = bestArrowTarget(p, dx, dy, TRIPLE_ARROW_RANGE);
    if (target) applyCombatDamage(target, TRIPLE_ARROW_DAMAGE, p, now);
  }
  emitMap(p.map, 'combatEffect', { type: 'tripleArrow', id: nextEffectId++, x: p.x, y: p.y, angles, range: TRIPLE_ARROW_RANGE, life: 0.42 });
  return { success: true };
}
function castArrowRain(p, targetData) {
  const blocked = p.avatar !== 'archer' ? 'avatar' : skillBlock(p, p.lastArrowRainAt, ARROW_RAIN_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  let tx = Number(targetData && targetData.x), ty = Number(targetData && targetData.y);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) { tx = p.x + p.aimX * 600; ty = p.y + p.aimY * 600; }
  const dx = tx - p.x, dy = ty - p.y, distance = Math.hypot(dx, dy);
  if (distance > ARROW_RAIN_RANGE) {
    tx = p.x + dx / distance * ARROW_RAIN_RANGE;
    ty = p.y + dy / distance * ARROW_RAIN_RANGE;
  }
  const map = mapSpec(p.map);
  tx = clamp(tx, 30, map.width - 30); ty = clamp(ty, 30, map.height - 30);
  const rainMap = p.map;
  p.lastArrowRainAt = Date.now();
  emitMap(rainMap, 'combatEffect', { type: 'arrowRain', id: nextEffectId++, x: tx, y: ty, radius: ARROW_RAIN_RADIUS, life: 1.45 });
  for (let wave = 0; wave < ARROW_RAIN_WAVES; wave++) {
    setTimeout(() => {
      if (!players.has(p.id) || !p.alive || p.map !== rainMap) return;
      const now = Date.now();
      for (const target of targetsInArea(p, rainMap, tx, ty, ARROW_RAIN_RADIUS)) applyCombatDamage(target, ARROW_RAIN_DAMAGE, p, now);
    }, wave * ARROW_RAIN_INTERVAL);
  }
  return { success: true };
}
function castGhostShip(p, aimData, autoAim) {
  const blocked = p.avatar !== 'pirate' ? 'avatar' : skillBlock(p, p.lastGhostShipAt, GHOST_SHIP_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(p, aimData, autoAim, 800);
  p.lastGhostShipAt = now;
  p.ghostShipUntil = now + GHOST_SHIP_DURATION;
  p.ghostDirX = aim.x; p.ghostDirY = aim.y;
  p.ghostHitKeys = new Set();
  p.inputX = 0; p.inputY = 0; p.moving = false;
  return { success: true };
}
function castSlash(p, aimData, autoAim) {
  const blocked = p.avatar !== 'pirate' ? 'avatar' : skillBlock(p, p.lastSlashAt, SLASH_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const a = resolveAim(p, aimData, autoAim, SLASH_RANGE + 260);
  p.lastSlashAt = now; p.aimX = a.x; p.aimY = a.y;
  emitMap(p.map, 'combatEffect', { type: 'slash', id: nextEffectId++, x: p.x, y: p.y, angle: Math.atan2(a.y, a.x), life: SLASH_EFFECT_LIFE });
  const minDot = Math.cos(SLASH_HALF_ANGLE);
  for (const t of getAttackableTargets(p, SLASH_RANGE + 90)) {
    const dx = t.x - p.x, dy = t.y - p.y, dist = Math.hypot(dx, dy);
    if (dist > SLASH_RANGE + t.radius) continue;
    if (dist > 25 && (dx / dist) * a.x + (dy / dist) * a.y < minDot) continue;
    applyCombatDamage(t, SLASH_DAMAGE, p, now);
  }
  return { success: true };
}
function findInitialChainTarget(p, aim, autoAim) {
  if (autoAim) return findNearestAttackableTarget(p, CHAIN_CAST_RANGE);
  let best = null, score = Infinity;
  for (const t of getAttackableTargets(p, CHAIN_CAST_RANGE)) {
    const dx = t.x - p.x, dy = t.y - p.y, dist = Math.hypot(dx, dy);
    if (dist < 0.001) continue;
    const dot = (dx / dist) * aim.x + (dy / dist) * aim.y;
    if (dot < CHAIN_AIM_DOT) continue;
    const s = dist + (1 - dot) * 420;
    if (s < score) { score = s; best = t; }
  }
  return best;
}
function chainCandidates(owner, x, y) {
  const out = [];
  if (owner.map === 'forest') {
    for (const s of querySlimes(x, y, CHAIN_RADIUS)) out.push({ key: 's:' + s.id, type: 'slime', x: s.x, y: s.y, radius: s.radius, ref: s });
  }
  for (const other of players.values()) {
    if (!canPvp(owner, other)) continue;
    const dx = other.x - x, dy = other.y - y;
    if (dx * dx + dy * dy <= CHAIN_RADIUS * CHAIN_RADIUS) out.push({ key: 'p:' + other.id, type: 'player', x: other.x, y: other.y, radius: PLAYER_RADIUS, ref: other });
  }
  return out;
}
function castChainLightning(p, aimData, autoAim) {
  const blocked = p.avatar !== 'mage' ? 'avatar' : skillBlock(p, p.lastChainAt, CHAIN_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(p, aimData, autoAim, CHAIN_CAST_RANGE);
  let current = findInitialChainTarget(p, aim, autoAim);
  if (!current) return { success: false, reason: 'noTarget' };
  p.lastChainAt = now; p.aimX = aim.x; p.aimY = aim.y;
  const hit = new Set(), segments = [];
  let fromX = p.x, fromY = p.y;
  for (let i = 0; i < CHAIN_MAX_TARGETS && current; i++) {
    hit.add(current.key);
    const cx = current.x, cy = current.y;
    segments.push({ x1: fromX, y1: fromY, x2: cx, y2: cy });
    applyCombatDamage(current, Math.max(1, Math.round(CHAIN_DAMAGE * (1 - i * 0.10))), p, now);
    if (i === CHAIN_MAX_TARGETS - 1) break;
    let next = null, bestD2 = CHAIN_RADIUS * CHAIN_RADIUS;
    for (const t of chainCandidates(p, cx, cy)) {
      if (hit.has(t.key)) continue;
      const dx = t.x - cx, dy = t.y - cy, d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { bestD2 = d2; next = t; }
    }
    fromX = cx; fromY = cy; current = next;
  }
  emitMap(p.map, 'combatEffect', { type: 'chain', id: nextEffectId++, segments, life: CHAIN_EFFECT_LIFE });
  return { success: true };
}

function nearestForestPlayer(s, range, requireUnsafe) {
  let best = null, bestD2 = range * range;
  for (const p of players.values()) {
    if (!p.alive || p.map !== 'forest' || (requireUnsafe && isPlayerSafe(p))) continue;
    const dx = p.x - s.x, dy = p.y - s.y, d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) { bestD2 = d2; best = p; }
  }
  return best;
}
function steerAwayFromSafeZone(s, vx, vy, speed) {
  const z = MAPS.forest.safeZone;
  const dx = s.x - z.x, dy = s.y - z.y, dist = Math.max(1, Math.hypot(dx, dy));
  if (dist > z.radius + s.radius + 90) return { vx, vy };
  const inward = vx * (-dx / dist) + vy * (-dy / dist);
  if (inward <= 0) return { vx, vy };
  const side = s.id % 2 ? 1 : -1;
  const n = normalize((-dy / dist) * side * 0.86 + (dx / dist) * 0.5, (dx / dist) * side * 0.86 + (dy / dist) * 0.5, dx / dist, dy / dist);
  return { vx: n.x * speed, vy: n.y * speed };
}
function updateMonsterAI(now) {
  for (const s of slimes.values()) {
    if (!s.alive) continue;
    const awakePlayer = s.boss ? nearestForestPlayer(s, 99999, false) : nearestForestPlayer(s, MONSTER_ACTIVE_RADIUS, false);
    if (!awakePlayer) {
      s.active = false; s.targetId = null; s.vx = 0; s.vy = 0;
      continue;
    }
    const wasActive = s.active;
    s.active = true;
    const stats = monsterStats(s);
    const target = nearestForestPlayer(s, stats.aggro, true);
    if (!target) {
      if (!wasActive || now >= s.changeAt || s.targetId !== null) chooseSlimeDirection(s);
      continue;
    }
    s.targetId = target.id;
    const dx = target.x - s.x, dy = target.y - s.y, dist = Math.max(0.001, Math.hypot(dx, dy));
    const attackRange = s.radius + PLAYER_RADIUS + (s.boss ? 26 : s.elite ? 18 : 12);
    if (dist <= attackRange) {
      s.vx = 0; s.vy = 0;
      if (now - s.lastAttackAt >= stats.cooldown) {
        s.lastAttackAt = now;
        if (damagePlayer(target, stats.damage, now, 'monster')) {
          emitMap('forest', 'combatEffect', { type: 'monsterHit', id: nextEffectId++, x1: s.x, y1: s.y, x2: target.x, y2: target.y, life: 0.22 });
        }
      }
      continue;
    }
    const a = normalize(dx, dy);
    const avoided = steerAwayFromSafeZone(s, a.x * stats.speed, a.y * stats.speed, stats.speed);
    s.vx = avoided.vx; s.vy = avoided.vy; s.changeAt = now + 450;
  }
}
function constrainSlimeOutsideSafeZone(s) {
  const z = MAPS.forest.safeZone;
  const dx = s.x - z.x, dy = s.y - z.y, dist = Math.max(0.001, Math.hypot(dx, dy));
  const minDist = z.radius + s.radius + 8;
  if (dist >= minDist) return;
  const nx = dx / dist, ny = dy / dist;
  s.x = z.x + nx * minDist; s.y = z.y + ny * minDist;
  const speed = Math.max(45, Math.hypot(s.vx, s.vy)), side = s.id % 2 ? 1 : -1;
  s.vx = (-ny * side + nx * 0.35) * speed; s.vy = (nx * side + ny * 0.35) * speed; s.targetId = null;
}

function moveForestEntity(entity, dx, dy, radius) {
  let blocked = false;
  const nx = clamp(entity.x + dx, radius, MAPS.forest.width - radius);
  if (!forestBlocked(nx, entity.y, radius)) entity.x = nx; else blocked = true;
  const ny = clamp(entity.y + dy, radius, MAPS.forest.height - radius);
  if (!forestBlocked(entity.x, ny, radius)) entity.y = ny; else blocked = true;
  return blocked;
}

function nearestPortal(p) {
  let best = null, bestDist = Infinity;
  for (const portal of mapSpec(p.map).portals || []) {
    const d = Math.hypot(p.x - portal.x, p.y - portal.y);
    if (d <= PORTAL_USE_RANGE && d < bestDist) { bestDist = d; best = portal; }
  }
  return best;
}
function usePortal(p) {
  if (!p.alive) return;
  const now = Date.now();
  if (now - p.lastPortalAt < PORTAL_COOLDOWN) return;
  const portal = nearestPortal(p);
  if (!portal) return;
  p.lastPortalAt = now;
  changePlayerMap(p, portal.target, portal.targetX, portal.targetY);
}

function serializePlayer(p) {
  return { id: p.id, map: p.map, x: p.x, y: p.y, direction: p.direction, moving: p.moving, avatar: p.avatar, hp: p.hp, maxHp: p.maxHp, alive: p.alive, ghostShip: p.ghostShipUntil > Date.now(), ghostDirX: p.ghostDirX, ghostDirY: p.ghostDirY };
}
function near(viewer, x, y, radius = VIEW_RADIUS) {
  const dx = x - viewer.x, dy = y - viewer.y;
  return dx * dx + dy * dy <= radius * radius;
}
function stateForPlayer(viewer) {
  const map = mapSpec(viewer.map);
  const playerState = [];
  for (const p of players.values()) if (p.map === viewer.map) playerState.push(serializePlayer(p));

  const slimeState = [];
  if (viewer.map === 'forest') {
    const seen = new Set();
    for (const s of querySlimes(viewer.x, viewer.y, VIEW_RADIUS)) {
      if (!s.alive) continue;
      seen.add(s.id);
      slimeState.push({ id: s.id, x: s.x, y: s.y, elite: s.elite, boss: s.boss, hp: s.hp, maxHp: s.maxHp, alive: true, aggro: s.targetId !== null });
    }
    if (bossId !== null && !seen.has(bossId)) {
      const s = slimes.get(bossId);
      if (s && s.alive) slimeState.push({ id: s.id, x: s.x, y: s.y, elite: false, boss: true, hp: s.hp, maxHp: s.maxHp, alive: true, aggro: s.targetId !== null });
    }
  }

  const fires = [];
  for (const f of soulFires.values()) {
    if (f.map === viewer.map && near(viewer, f.x, f.y, VIEW_RADIUS + 250)) fires.push({ id: f.id, x: f.x, y: f.y, vx: f.vx, vy: f.vy, radius: f.radius });
  }

  return {
    map: viewer.map, mapName: map.name, world: { width: map.width, height: map.height },
    safe: isPlayerSafe(viewer), portals: map.portals,
    players: playerState, slimes: slimeState, soulFires: fires,
    bossProgress, bossTarget: BOSS_TARGET, bossActive: bossId !== null
  };
}

io.on('connection', socket => {
  if (players.size >= MAX_PLAYERS) {
    socket.emit('serverFull', { maxPlayers: MAX_PLAYERS });
    setTimeout(() => socket.disconnect(true), 300);
    return;
  }

  const p = makePlayer(socket.id);
  players.set(socket.id, p);
  socket.join(roomFor('forest'));

  socket.emit('welcome', {
    id: p.id, map: p.map, mapName: MAPS.forest.name,
    world: { width: MAPS.forest.width, height: MAPS.forest.height }, portals: MAPS.forest.portals,
    safeZone: MAPS.forest.safeZone, maxPlayers: MAX_PLAYERS,
    soulFireCooldown: SOUL_FIRE_COOLDOWN, slashCooldown: SLASH_COOLDOWN, chainCooldown: CHAIN_COOLDOWN, tripleArrowCooldown: TRIPLE_ARROW_COOLDOWN, arrowRainCooldown: ARROW_RAIN_COOLDOWN, ghostShipCooldown: GHOST_SHIP_COOLDOWN,
    slashRange: SLASH_RANGE, slashHalfAngle: SLASH_HALF_ANGLE
  });

  io.emit('count', { current: players.size, max: MAX_PLAYERS });

  socket.on('input', data => {
    if (!p.alive) return;
    let x = Number(data && data.x) || 0, y = Number(data && data.y) || 0;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    p.inputX = clamp(x, -1, 1); p.inputY = clamp(y, -1, 1);
    p.moving = Math.abs(x) > 0.05 || Math.abs(y) > 0.05;
    if (p.moving) p.direction = directionFromVector(x, y, p.direction);
  });

  socket.on('aim', data => {
    const a = normalize(data && data.x, data && data.y, p.aimX, p.aimY);
    p.aimX = a.x; p.aimY = a.y;
  });

  socket.on('setAvatar', data => {
    const avatar = String(data && data.avatar || '');
    if (AVATARS.includes(avatar)) p.avatar = avatar;
  });

  socket.on('usePortal', () => usePortal(p));

  socket.on('castSoulFire', data => {
    const r = castSoulFire(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'soulFire', cooldown: SOUL_FIRE_COOLDOWN });
  });

  socket.on('castSlash', data => {
    const r = castSlash(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'slash', cooldown: SLASH_COOLDOWN });
  });

  socket.on('castChain', data => {
    const r = castChainLightning(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'chain', cooldown: CHAIN_COOLDOWN });
  });
  socket.on('castTripleArrow', data => {
    const r = castTripleArrow(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'tripleArrow', cooldown: TRIPLE_ARROW_COOLDOWN });
  });
  socket.on('castArrowRain', data => {
    const r = castArrowRain(p, data && data.target);
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'arrowRain', cooldown: ARROW_RAIN_COOLDOWN });
  });
  socket.on('castGhostShip', data => {
    const r = castGhostShip(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'ghostShip', cooldown: GHOST_SHIP_COOLDOWN });
  });

  socket.on('disconnect', () => {
    players.delete(p.id);
    io.emit('count', { current: players.size, max: MAX_PLAYERS });
  });
});

setInterval(() => updateMonsterAI(Date.now()), 1000 / MONSTER_AI_RATE);

let lastPhysics = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastPhysics) / 1000, 0.1);
  lastPhysics = now;

  for (const p of players.values()) {
    if (!p.alive) {
      if (p.respawnAt && now >= p.respawnAt) respawnPlayer(p);
      continue;
    }
    const map = mapSpec(p.map);
    if (p.ghostShipUntil > now) {
      const dx = p.ghostDirX * GHOST_SHIP_SPEED * dt;
      const dy = p.ghostDirY * GHOST_SHIP_SPEED * dt;
      if (p.map === 'forest') moveForestEntity(p, dx, dy, PLAYER_RADIUS);
      else { p.x = clamp(p.x + dx, PLAYER_RADIUS, map.width - PLAYER_RADIUS); p.y = clamp(p.y + dy, PLAYER_RADIUS, map.height - PLAYER_RADIUS); }
      for (const target of getAttackableTargets(p, GHOST_SHIP_RADIUS + 90)) {
        if (p.ghostHitKeys.has(target.key)) continue;
        const ddx = target.x - p.x, ddy = target.y - p.y;
        if (ddx * ddx + ddy * ddy <= (GHOST_SHIP_RADIUS + target.radius) * (GHOST_SHIP_RADIUS + target.radius)) {
          p.ghostHitKeys.add(target.key);
          applyCombatDamage(target, GHOST_SHIP_DAMAGE, p, now);
        }
      }
    } else if (p.map === 'forest') {
      moveForestEntity(p, p.inputX * PLAYER_SPEED * dt, p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS);
    } else {
      p.x = clamp(p.x + p.inputX * PLAYER_SPEED * dt, PLAYER_RADIUS, map.width - PLAYER_RADIUS);
      p.y = clamp(p.y + p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS, map.height - PLAYER_RADIUS);
    }
    if (isPlayerSafe(p) && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + SAFE_HEAL_PER_SECOND * dt);
  }

  for (const s of slimes.values()) {
    if (!s.alive) {
      if (bossId === null && !s.boss && !s.suppressedByBoss && s.respawnAt && now >= s.respawnAt) respawnSlime(s);
      continue;
    }
    if (!s.active && !s.boss) continue;
    const oldX = s.x, oldY = s.y;
    const blocked = moveForestEntity(s, s.vx * dt, s.vy * dt, Math.max(16, s.radius * 0.7));
    if (blocked) {
      if (Math.abs(s.x - oldX) < 0.5) s.vx *= -1;
      if (Math.abs(s.y - oldY) < 0.5) s.vy *= -1;
      s.targetId = null;
      s.changeAt = now + 250;
    }
    constrainSlimeOutsideSafeZone(s);
  }

  rebuildSlimeGrid();

  for (const fire of [...soulFires.values()]) {
    const owner = players.get(fire.ownerId);
    fire.x += fire.vx * dt; fire.y += fire.vy * dt; fire.life -= dt;
    const map = mapSpec(fire.map);

    if (fire.life <= 0 || fire.x < -60 || fire.x > map.width + 60 || fire.y < -60 || fire.y > map.height + 60 || (fire.map === 'forest' && forestBlocked(fire.x, fire.y, 5))) {
      soulFires.delete(fire.id);
      continue;
    }

    let hit = null, bestD2 = Infinity;
    if (fire.map === 'forest') {
      for (const s of querySlimes(fire.x, fire.y, 100)) {
        if (!s.alive || (fire.hitKeys && fire.hitKeys.has('s:' + s.id))) continue;
        const dx = s.x - fire.x, dy = s.y - fire.y, r = s.radius + fire.radius, d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'slime', ref: s, key: 's:' + s.id }; }
      }
    }

    if (owner) {
      for (const target of players.values()) {
        if (!canPvp(owner, target) || target.map !== fire.map || (fire.hitKeys && fire.hitKeys.has('p:' + target.id))) continue;
        const dx = target.x - fire.x, dy = target.y - fire.y, r = PLAYER_RADIUS + fire.radius, d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'player', ref: target, key: 'p:' + target.id }; }
      }
    }

    if (hit) {
      if (fire.pierce && fire.hitKeys) fire.hitKeys.add(hit.key);
      else soulFires.delete(fire.id);
      if (hit.type === 'slime') {
        hit.ref.hp -= SOUL_FIRE_DAMAGE;
        if (hit.ref.hp <= 0) killSlime(hit.ref, now);
      } else if (owner) damagePlayer(hit.ref, SOUL_FIRE_DAMAGE, now, 'pvp');
    }
  }
}, 1000 / PHYSICS_RATE);

setInterval(() => {
  for (const socket of io.sockets.sockets.values()) {
    const viewer = players.get(socket.id);
    if (viewer) socket.emit('state', stateForPlayer(viewer));
  }
}, 1000 / NETWORK_RATE);

app.get('/mage.png', (_req, res) => res.sendFile(path.join(__dirname, 'mage.png')));
app.get('/pirate.png', (_req, res) => res.sendFile(path.join(__dirname, 'pirate.png')));
app.get('/archer.png', (_req, res) => res.sendFile(path.join(__dirname, 'archer.png')));

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Forest RPG</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#182716;font-family:system-ui,sans-serif;touch-action:none}
#gameHost{position:fixed;inset:0;overflow:hidden}#gameHost canvas{display:block;width:100%;height:100%}
#hud{position:fixed;left:10px;top:10px;z-index:20;color:#fff;background:rgba(8,14,8,.78);border:1px solid rgba(255,255,255,.15);border-radius:11px;padding:9px 12px;line-height:1.45;font-size:13px;pointer-events:none}
#status{font-weight:900}#skillName,#skillState,#chainState{color:#78f5ff;font-weight:900}#hpText{color:#ffb0b0;font-weight:900}#bossProgress{color:#ffb5b5;font-weight:900}#mapName{color:#ffe49b;font-weight:900}
#bossLocator{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:60;display:none;min-width:250px;padding:8px 12px;color:#fff4c7;background:rgba(112,18,27,.92);border:2px solid rgba(255,90,100,.75);border-radius:11px;text-align:center;font-size:12px;font-weight:900;pointer-events:none}
#zoneStatus{position:fixed;top:10px;right:10px;z-index:50;color:#e1ffe6;background:rgba(18,90,40,.92);border:2px solid rgba(118,255,153,.7);border-radius:11px;padding:8px 12px;font-size:12px;font-weight:900;text-align:center;pointer-events:none}
#zoneStatus.danger{color:#fff0e2;background:rgba(125,35,20,.92);border-color:rgba(255,130,88,.78)}#zoneStatus small{display:block;margin-top:2px;font-size:10px;opacity:.85}
#avatarPanel{position:fixed;right:10px;top:78px;z-index:25;width:195px;color:#fff;background:rgba(8,14,8,.78);border:1px solid rgba(255,255,255,.15);border-radius:11px;padding:9px}
#avatarTitle{margin-bottom:7px;font-weight:900}#avatarGrid{display:grid;gap:7px}.avatarBtn{border:2px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(255,255,255,.06);color:#fff;padding:8px;text-align:left;font:inherit;cursor:pointer}
.avatarBtn.selected{border-color:#7cf8ff;background:rgba(80,230,255,.11)}.avatarBtn b,.avatarBtn span{display:block}.avatarBtn span{font-size:10px;opacity:.82}
.joyZone{position:fixed;bottom:max(18px,env(safe-area-inset-bottom));z-index:35;width:146px;height:146px;border-radius:50%;touch-action:none;user-select:none}
#moveJoy{left:18px;border:2px solid rgba(255,255,255,.36);background:rgba(0,0,0,.2)}#attackJoy{right:18px;border:2px solid rgba(93,247,255,.72);background:rgba(10,103,118,.2)}
.joyKnob{position:absolute;width:54px;height:54px;left:46px;top:46px;border-radius:50%;pointer-events:none}#moveKnob{background:rgba(255,255,255,.82)}#attackKnob{background:rgba(95,247,255,.86)}
#attackLabel{position:absolute;left:0;right:0;top:10px;text-align:center;color:#d8ffff;font-weight:900;font-size:11px;pointer-events:none}
#chainBtn{position:fixed;right:140px;bottom:max(140px,calc(env(safe-area-inset-bottom) + 140px));z-index:40;width:70px;height:70px;border-radius:50%;border:3px solid #65f4ff;background:rgba(10,94,118,.92);color:#fff;font:900 12px system-ui;touch-action:none}
#chainBtn.cooling{opacity:.55}#chainBtn.hidden{display:none}
#portalPrompt{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:55;display:none;padding:9px 16px;border-radius:13px;background:rgba(35,25,70,.9);border:2px solid rgba(170,130,255,.85);color:#fff;font-weight:900;pointer-events:none}
#portalBtn{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:55;display:none;padding:11px 18px;border-radius:17px;border:2px solid #b691ff;background:rgba(65,40,130,.92);color:#fff;font:900 14px system-ui;touch-action:none}
#clearMessage{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.4);pointer-events:none}
#clearTitle{color:#ffe477;font-size:clamp(60px,11vw,140px);font-weight:1000;text-shadow:0 5px 20px #000}#clearSub{color:#fff;text-align:center;font-size:20px;font-weight:900}
.death{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:900;display:none;padding:16px 25px;border-radius:15px;background:rgba(90,10,20,.88);border:2px solid rgba(255,100,110,.85);color:#fff;font-size:22px;font-weight:1000;pointer-events:none}.death.active{display:block}
@media(pointer:fine){.joyZone,#chainBtn,#portalBtn{display:none!important}}@media(max-width:700px){#avatarPanel{width:165px}#bossLocator{top:64px;min-width:210px}#zoneStatus{font-size:10px}#portalPrompt{bottom:195px}}
</style>
</head>
<body>
<div id="gameHost"></div>
<div id="clearMessage"><div><div id="clearTitle">CLEAR!</div><div id="clearSub">👑 보스 슬라임 처치 완료</div></div></div>
<div id="deathMessage" class="death">쓰러졌습니다</div>
<div id="hud"><div id="status">서버 연결 중...</div><div>접속자: <span id="count">0</span>/<span id="maxCount">20</span>명</div><div>맵: <span id="mapName">숲</span></div><div>HP: <span id="hpText">100 / 100</span></div><div>캐릭터: <span id="currentAvatarName">마법사</span></div><div>E: <span id="skillName">영혼불</span></div><div>Q: <span id="chainState">체인 라이트닝</span></div><div>상태: <span id="skillState">대기</span></div><div>보스 게이지: <span id="bossProgress">0 / 20</span></div></div>
<div id="bossLocator"></div><div id="zoneStatus">🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small></div>
<div id="avatarPanel"><div id="avatarTitle">캐릭터 선택</div><div id="avatarGrid"><button class="avatarBtn selected" data-avatar="mage" type="button"><b>🔮 마법사</b><span>E 영혼불 · Q 체인</span></button><button class="avatarBtn" data-avatar="pirate" type="button"><b>🏴‍☠️ 해적</b><span>E 슬래시 · Q 유령해적선</span></button><button class="avatarBtn" data-avatar="archer" type="button"><b>🏹 궁수</b><span>E 3연발 · Q 화살비</span></button></div></div>
<div id="moveJoy" class="joyZone"><div id="moveKnob" class="joyKnob"></div></div>
<div id="attackJoy" class="joyZone"><div id="attackLabel">영혼불</div><div id="attackKnob" class="joyKnob"></div></div>
<button id="chainBtn" type="button">⚡<br>체인</button>
<div id="portalPrompt">F · 포탈 사용</div><button id="portalBtn" type="button">포탈 이동</button>
<script src="/socket.io/socket.io.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js"></script>
<script>
(async function(){
const FOREST_LAYOUT=${JSON.stringify(FOREST_LAYOUT)};
const E=id=>document.getElementById(id);
const host=E('gameHost'),statusEl=E('status'),countEl=E('count'),maxCountEl=E('maxCount'),mapNameEl=E('mapName'),hpTextEl=E('hpText'),currentAvatarNameEl=E('currentAvatarName'),skillNameEl=E('skillName'),chainStateEl=E('chainState'),skillStateEl=E('skillState'),bossProgressEl=E('bossProgress'),bossLocatorEl=E('bossLocator'),zoneStatusEl=E('zoneStatus'),clearMessageEl=E('clearMessage'),deathMessageEl=E('deathMessage'),moveJoy=E('moveJoy'),moveKnob=E('moveKnob'),attackJoy=E('attackJoy'),attackKnob=E('attackKnob'),attackLabel=E('attackLabel'),chainBtn=E('chainBtn'),portalPrompt=E('portalPrompt'),portalBtn=E('portalBtn'),avatarButtons=[...document.querySelectorAll('.avatarBtn')];
if(!window.PIXI){statusEl.textContent='PixiJS 로드 실패';return;}
const coarse=matchMedia('(pointer:coarse)').matches;
const lowPower=coarse||((navigator.hardwareConcurrency||8)<=4);
const app=new PIXI.Application({resizeTo:window,backgroundColor:0x182716,antialias:false,autoDensity:true,resolution:Math.min(devicePixelRatio||1,coarse?1.25:1.5),powerPreference:'high-performance'});
host.appendChild(app.view);PIXI.settings.ROUND_PIXELS=true;
const worldRoot=new PIXI.Container(),staticLayer=new PIXI.Container(),portalLayer=new PIXI.Container(),slimeLayer=new PIXI.Container(),playerLayer=new PIXI.Container(),projectileLayer=new PIXI.Container(),effectLayer=new PIXI.Container(),previewLayer=new PIXI.Container();
worldRoot.addChild(staticLayer,portalLayer,slimeLayer,playerLayer,projectileLayer,effectLayer,previewLayer);app.stage.addChild(worldRoot);
let myId=null,currentMap='forest',currentMapName='숲',world={width:5200,height:3400},currentPortals=[],forestSafeZone={x:2600,y:1700,radius:470},currentSafe=true;
let players=[],slimes=[],soulFires=[],serverFull=false,selectedAvatar='mage',keys=new Set(),cameraX=0,cameraY=0,mouseX=innerWidth/2,mouseY=innerHeight/2,mouseAimActive=false;
let movePointerId=null,attackPointerId=null,moveX=0,moveY=0,attackX=0,attackY=1,attackDragAmount=0,attackDragging=false,lastMobileAim={x:0,y:1},lastInputX=999,lastInputY=999,lastAimX=999,lastAimY=999;
let soulFireCooldown=900,slashCooldown=1000,chainCooldown=4500,tripleArrowCooldown=850,arrowRainCooldown=4800,ghostShipCooldown=6500,slashRange=145,slashHalfAngle=Math.PI/3,cooldownUntil={mage:0,pirate:0,chain:0,archer:0,archerQ:0,pirateQ:0},clearTimer=null,deathTimer=null;
const playerNodes=new Map(),slimeNodes=new Map(),projectileNodes=new Map(),effectNodes=new Map(),playerTargets=new Map(),slimeTargets=new Map();
const MAGE_FRAMES=[[{x:104,y:75,w:236,h:308},{x:376,y:74,w:237,h:308},{x:680,y:74,w:236,h:308}],[{x:98,y:417,w:234,h:287},{x:375,y:418,w:230,h:286},{x:679,y:417,w:229,h:287}],[{x:116,y:744,w:222,h:285},{x:387,y:745,w:221,h:284},{x:691,y:744,w:224,h:285}],[{x:152,y:1071,w:212,h:279},{x:419,y:1069,w:214,h:282},{x:722,y:1070,w:217,h:279}]];
const PIRATE_FRAMES=[[{x:74,y:29,w:249,h:319,anchorX:107},{x:422,y:30,w:229,h:311,anchorX:121},{x:761,y:30,w:230,h:318,anchorX:144}],[{x:91,y:384,w:245,h:326,anchorX:90},{x:431,y:384,w:225,h:318,anchorX:112},{x:772,y:384,w:235,h:326,anchorX:133}],[{x:45,y:738,w:293,h:312,anchorX:136},{x:418,y:738,w:236,h:316,anchorX:125},{x:755,y:738,w:273,h:312,anchorX:150}],[{x:67,y:1092,w:270,h:312,anchorX:114},{x:427,y:1092,w:227,h:317,anchorX:116},{x:751,y:1092,w:266,h:313,anchorX:154}]];
const ARCHER_FRAMES=Array.from({length:4},(_,row)=>Array.from({length:3},(_,col)=>({x:col*128,y:row*128,w:128,h:128})));
let mageTextures=null,pirateTextures=null,archerTextures=null;
try{const mageBase=await PIXI.Assets.load('/mage.png?v=120');const pirateBase=await PIXI.Assets.load('/pirate.png?v=120');const archerBase=await PIXI.Assets.load('/archer.png?v=120');mageTextures=MAGE_FRAMES.map(row=>row.map(f=>new PIXI.Texture(mageBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));pirateTextures=PIRATE_FRAMES.map(row=>row.map(f=>new PIXI.Texture(pirateBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));archerTextures=ARCHER_FRAMES.map(row=>row.map(f=>new PIXI.Texture(archerBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));}catch(err){statusEl.textContent='캐릭터 이미지 로드 실패';}
const socket=io({transports:['websocket','polling']});
function directionRow(d){return d==='back'?1:d==='left'?2:d==='right'?3:0}function walkFrame(p){return p.moving?Math.floor(performance.now()/145)%3:1}function clampClient(v,a,b){return Math.max(a,Math.min(b,v))}function norm(x,y,fx,fy){const l=Math.hypot(x,y);return l<.001?{x:fx,y:fy}:{x:x/l,y:y/l}}
function clearContainer(c){while(c.children.length){const child=c.removeChildAt(c.children.length-1);child.destroy({children:true});}}
function drawPolyline(g,points,width,color,alpha){if(!points.length)return;g.lineStyle(width,color,alpha);g.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)g.lineTo(points[i].x,points[i].y);}
function buildMap(){
  clearContainer(staticLayer);clearContainer(portalLayer);const g=new PIXI.Graphics();
  if(currentMap==='forest'){
    g.beginFill(0x35682f).drawRect(0,0,world.width,world.height).endFill();
    for(let i=0;i<70;i++){const x=(i*811)%world.width,y=(i*1297)%world.height,r=90+(i%6)*32;g.beginFill(i%2?0x3d7436:0x2f6030,0.16).drawCircle(x,y,r).endFill();}
    for(const river of FOREST_LAYOUT.rivers){drawPolyline(g,river.points,river.width+30,0x294a55,0.95);drawPolyline(g,river.points,river.width,0x267ca0,1);drawPolyline(g,river.points,Math.max(10,river.width*.08),0x70cbe5,0.38);}
    const c=FOREST_LAYOUT.clearing;g.beginFill(0x75aa45,1).drawEllipse(c.x,c.y,c.rx,c.ry).endFill();g.lineStyle(7,0x9bcf61,0.55).drawEllipse(c.x,c.y,c.rx-20,c.ry-20);
    for(const pathPoints of FOREST_LAYOUT.paths){drawPolyline(g,pathPoints,128,0x8f7447,0.45);drawPolyline(g,pathPoints,105,0xc8a96b,1);drawPolyline(g,pathPoints,48,0xd7bc7f,0.38);}
    for(const cliff of FOREST_LAYOUT.cliffs){const left=cliff.x-cliff.w/2,top=cliff.y-cliff.h/2;g.beginFill(0x38432d).drawRoundedRect(left,top,cliff.w,cliff.h,36).endFill();g.beginFill(0x6b7454).drawRoundedRect(left+14,top+10,cliff.w-28,cliff.h*.58,28).endFill();for(let k=0;k<Math.max(4,Math.floor(cliff.w/110));k++){const bx=left+45+k*95,by=top+cliff.h*.58+(k%2)*22;g.beginFill(k%2?0x59624a:0x747c61).drawCircle(bx,by,35+(k%3)*7).endFill();}}
    const cave=FOREST_LAYOUT.cave;g.beginFill(0x45483c).drawCircle(cave.x,cave.y,cave.r+55).endFill();g.beginFill(0x68705a).drawCircle(cave.x,cave.y,cave.r+22).endFill();g.beginFill(0x171a17).drawEllipse(cave.x,cave.y+38,cave.r*.72,cave.r*.7).endFill();g.beginFill(0x282c27).drawEllipse(cave.x,cave.y+68,cave.r*.48,cave.r*.42).endFill();
    for(const rock of FOREST_LAYOUT.rocks){g.beginFill(0x4e5846,0.45).drawEllipse(rock.x+5,rock.y+9,rock.r*.9,rock.r*.45).endFill();g.beginFill(0x737b68).drawCircle(rock.x,rock.y,rock.r).endFill();g.beginFill(0x939987,0.55).drawCircle(rock.x-rock.r*.25,rock.y-rock.r*.3,rock.r*.32).endFill();}
    for(const tree of FOREST_LAYOUT.trees){const x=tree.x,y=tree.y,r=tree.r;g.beginFill(0x172e1c,0.35).drawEllipse(x+7,y+r*.72,r*.9,r*.34).endFill();g.beginFill(0x5f4025).drawRect(x-tree.trunk*.38,y-2,tree.trunk*.76,r*.92).endFill();g.beginFill(0x1f6539).drawCircle(x-r*.43,y-r*.08,r*.68).drawCircle(x+r*.43,y-r*.08,r*.68).drawCircle(x,y-r*.42,r*.82).endFill();g.beginFill(0x3f9450,0.75).drawCircle(x-r*.18,y-r*.62,r*.32).endFill();}
    for(const bridge of FOREST_LAYOUT.bridges){const left=bridge.x-bridge.w/2,top=bridge.y-bridge.h/2;g.beginFill(0x553b25).drawRoundedRect(left-12,top+18,bridge.w+24,bridge.h-36,12).endFill();for(let plank=0;plank<11;plank++){const px=left+plank*(bridge.w/10);g.beginFill(plank%2?0x9b6a3b:0xad7846).drawRect(px-9,top+26,18,bridge.h-52).endFill();}g.lineStyle(7,0x402d1e).moveTo(left,top+22).lineTo(left+bridge.w,top+22).moveTo(left,top+bridge.h-22).lineTo(left+bridge.w,top+bridge.h-22);}
    g.beginFill(0x93c75f,0.16).lineStyle(5,0xc9ffb8,0.55).drawCircle(forestSafeZone.x,forestSafeZone.y,forestSafeZone.radius).endFill();
    if(!lowPower){for(let i=0;i<150;i++){const x=(i*977+333)%world.width,y=(i*557+911)%world.height;if(Math.hypot(x-c.x,y-c.y)>Math.max(c.rx,c.ry)*1.02)continue;g.beginFill([0xffe082,0xff9e9e,0xc9a3ff,0x9ee7ff][i%4],0.9).drawCircle(x,y,2+(i%2)).endFill();}}
  }else if(currentMap==='village'){
    g.beginFill(0xc9b98b).drawRect(0,0,world.width,world.height).endFill();g.beginFill(0xb9ad88).drawCircle(1300,950,330).endFill();const houses=[[520,430,250,170,0x994c45],[1000,340,260,180,0x7d5144],[1590,350,250,170,0x995d3f],[2100,470,270,185,0x81505d],[470,1320,260,180,0x84543e],[1030,1460,250,170,0x9a5548],[1620,1470,260,180,0x7d5144],[2140,1310,250,170,0x995d3f]];for(const h of houses){const x=h[0],y=h[1],w=h[2],hh=h[3],roof=h[4];g.beginFill(0xead6aa).drawRect(x-w/2,y-hh/2,w,hh).endFill();g.beginFill(roof).moveTo(x-w/2-14,y-hh/2+5).lineTo(x,y-hh/2-52).lineTo(x+w/2+14,y-hh/2+5).closePath().endFill();g.beginFill(0x7b4f2b).drawRect(x-16,y+hh/2-48,32,48).endFill();}
  }else{
    g.beginFill(0x61564e).drawRect(0,0,world.width,world.height).endFill();g.beginFill(0x786b60).lineStyle(10,0xd4c19a).drawRect(180,180,world.width-360,world.height-360).endFill();g.lineStyle(3,0xffffff,0.15).drawCircle(world.width/2,world.height/2,270).moveTo(world.width/2-420,world.height/2).lineTo(world.width/2+420,world.height/2);
  }
  staticLayer.addChild(g);
  if(currentMap==='forest'){const label=new PIXI.Text('중앙 광장 · 안전지대',{fontFamily:'system-ui',fontSize:24,fontWeight:'900',fill:0xe9ffd5,stroke:0x27421f,strokeThickness:5});label.anchor.set(.5);label.position.set(FOREST_LAYOUT.clearing.x,FOREST_LAYOUT.clearing.y-510);staticLayer.addChild(label);}
  for(const p of currentPortals){const node=new PIXI.Container();node.position.set(p.x,p.y);node.portal=p;const ring=new PIXI.Graphics().lineStyle(7,0x9b82ff,0.9).drawCircle(0,0,42).beginFill(0x8264ff,0.25).drawCircle(0,0,25).endFill();const label=new PIXI.Text(p.label||'포탈',{fontFamily:'system-ui',fontSize:13,fontWeight:'900',fill:0xffffff,stroke:0x27183e,strokeThickness:4});label.anchor.set(.5,1);label.position.set(0,-52);node.addChild(ring,label);node.ring=ring;portalLayer.addChild(node);}
}
function createHpBar(width){const c=new PIXI.Container(),bg=new PIXI.Graphics().beginFill(0x151515,0.85).drawRoundedRect(-width/2,0,width,7,3).endFill(),bar=new PIXI.Graphics();c.addChild(bg,bar);c.bar=bar;c.widthValue=width;return c;}
function makePlayerNode(p){
  const c=new PIXI.Container();c.sortableChildren=true;
  const ghost=new PIXI.Container();ghost.zIndex=0;ghost.visible=false;
  const hull=new PIXI.Graphics().beginFill(0x63e6ff,0.22).lineStyle(3,0xa8f6ff,0.65).drawEllipse(0,12,88,34).endFill();
  const mast=new PIXI.Graphics().lineStyle(4,0x8eefff,0.55).moveTo(0,15).lineTo(0,-54).beginFill(0x7bf1ff,0.16).moveTo(3,-50).lineTo(55,-20).lineTo(3,-8).closePath().endFill();
  ghost.addChild(hull,mast);c.addChild(ghost);
  const sprite=new PIXI.Sprite(PIXI.Texture.EMPTY);sprite.zIndex=1;sprite.position.y=30;c.addChild(sprite);
  const hp=createHpBar(62);hp.position.y=-103;hp.zIndex=3;c.addChild(hp);
  const label=new PIXI.Text('',{fontFamily:'system-ui',fontSize:11,fontWeight:'700',fill:0xffffff,stroke:0x111111,strokeThickness:3});label.anchor.set(.5,1);label.position.y=-76;label.zIndex=4;c.addChild(label);
  c.sprite=sprite;c.hp=hp;c.label=label;c.ghostShip=ghost;c.lastFrame='';c.position.set(p.x,p.y);playerLayer.addChild(c);playerNodes.set(p.id,c);playerTargets.set(p.id,{x:p.x,y:p.y});return c;
}
function updatePlayerNode(p,dt){
  let c=playerNodes.get(p.id);if(!c)c=makePlayerNode(p);let t=playerTargets.get(p.id);t.x=p.x;t.y=p.y;c.x+=(t.x-c.x)*Math.min(1,dt*14);c.y+=(t.y-c.y)*Math.min(1,dt*14);c.visible=p.alive;
  const row=directionRow(p.direction),col=walkFrame(p),key=p.avatar+':'+row+':'+col;
  if(c.lastFrame!==key){c.lastFrame=key;if(p.avatar==='archer'&&archerTextures){c.sprite.texture=archerTextures[row][col];c.sprite.scale.set(1.05);c.sprite.anchor.set(.5,1);}else if(p.avatar==='pirate'&&pirateTextures){const f=PIRATE_FRAMES[row][col];c.sprite.texture=pirateTextures[row][col];c.sprite.scale.set(.39);c.sprite.anchor.set(f.anchorX/f.w,1);}else if(mageTextures){c.sprite.texture=mageTextures[row][col];c.sprite.scale.set(.43);c.sprite.anchor.set(.5,1);}}
  c.ghostShip.visible=!!p.ghostShip;if(p.ghostShip)c.ghostShip.rotation=Math.atan2(p.ghostDirY||0,p.ghostDirX||1);
  const hp=Math.max(0,p.hp/p.maxHp),bar=c.hp.bar;bar.clear().beginFill(hp>.45?0x70e27d:0xff6565).drawRoundedRect(-29,1,58*hp,4,2).endFill();c.label.text=p.id===myId?'YOU':'P-'+p.id.slice(0,4);c.label.style.fill=p.id===myId?0xffe082:0xffffff;
}
function cleanupPlayerNodes(){const keep=new Set(players.map(p=>p.id));for(const [id,c] of playerNodes){if(!keep.has(id)){c.destroy({children:true});playerNodes.delete(id);playerTargets.delete(id);}}}
function makeSlimeNode(s){const c=new PIXI.Container(),body=new PIXI.Graphics(),aggro=new PIXI.Graphics(),hp=createHpBar(s.boss?170:s.elite?64:44);const r=s.boss?78:s.elite?34:24,color=s.boss?0xb32641:s.elite?0x774dd0:0x58c96f;body.beginFill(color).drawEllipse(0,0,r,r*.78).endFill();body.beginFill(0x151719).drawCircle(-r*.3,-4,s.boss?7:3).drawCircle(r*.3,-4,s.boss?7:3).endFill();if(s.boss){const crown=new PIXI.Text('👑',{fontSize:24});crown.anchor.set(.5,1);crown.position.y=-r+2;body.addChild(crown);}aggro.lineStyle(2,0xff5046,0.65).drawCircle(0,0,r+10);aggro.visible=false;hp.position.y=-r-(s.boss?34:18);c.addChild(body,aggro,hp);c.body=body;c.aggro=aggro;c.hp=hp;c.radius=r;c.position.set(s.x,s.y);slimeLayer.addChild(c);slimeNodes.set(s.id,c);slimeTargets.set(s.id,{x:s.x,y:s.y});return c;}
function updateSlimeNode(s,dt){let c=slimeNodes.get(s.id);if(!c)c=makeSlimeNode(s);let t=slimeTargets.get(s.id);t.x=s.x;t.y=s.y;c.x+=(t.x-c.x)*Math.min(1,dt*11);c.y+=(t.y-c.y)*Math.min(1,dt*11);c.aggro.visible=!!s.aggro;if(s.aggro)c.aggro.alpha=.5+.3*Math.sin(performance.now()/100);const hp=Math.max(0,s.hp/s.maxHp),bar=c.hp.bar,w=c.hp.widthValue;bar.clear().beginFill(s.boss?0xff334f:s.elite?0xe5b84d:0xef6666).drawRoundedRect(-w/2+1,1,(w-2)*hp,4,2).endFill();}
function cleanupSlimeNodes(){const keep=new Set(slimes.map(s=>s.id));for(const [id,c] of slimeNodes){if(!keep.has(id)){c.destroy({children:true});slimeNodes.delete(id);slimeTargets.delete(id);}}}
function makeProjectileNode(f){const size=f.radius>=20?19:11;const g=new PIXI.Graphics().beginFill(0x39e7f1,0.92).drawCircle(0,0,size).endFill();if(!lowPower)g.beginFill(0xd2ffff).drawCircle(-3,-3,Math.max(4,size*.38)).endFill();projectileLayer.addChild(g);projectileNodes.set(f.id,g);return g;}
function syncProjectiles(){const keep=new Set();for(const f of soulFires){keep.add(f.id);let n=projectileNodes.get(f.id);if(!n)n=makeProjectileNode(f);n.position.set(f.x,f.y);n.vx=f.vx;n.vy=f.vy;}for(const [id,n] of projectileNodes){if(!keep.has(id)){n.destroy();projectileNodes.delete(id);}}}
function spawnEffect(e){
  const c=new PIXI.Container();c.started=performance.now();c.life=(e.life||.25)*1000;c.type=e.type;
  if(e.type==='slash'){
    const g=new PIXI.Graphics();g.lineStyle(lowPower?7:11,0xffe18c,0.9).arc(0,0,110,-.7,.7);c.addChild(g);c.position.set(e.x,e.y);c.rotation=e.angle;
  }else if(e.type==='chain'){
    const g=new PIXI.Graphics();g.lineStyle(lowPower?3:5,0xb9ffff,0.9);for(const seg of e.segments||[]){const mx=(seg.x1+seg.x2)/2+Math.sin((e.id+seg.x2)*.13)*10,my=(seg.y1+seg.y2)/2+Math.cos((e.id+seg.y2)*.13)*10;g.moveTo(seg.x1,seg.y1).lineTo(mx,my).lineTo(seg.x2,seg.y2);}c.addChild(g);
  }else if(e.type==='tripleArrow'){
    const g=new PIXI.Graphics();g.lineStyle(5,0xf1e2a2,0.95);for(const angle of e.angles||[]){const ex=Math.cos(angle)*520,ey=Math.sin(angle)*520;g.moveTo(0,0).lineTo(ex,ey);g.beginFill(0xffefb0).drawCircle(ex,ey,5).endFill();}c.addChild(g);c.position.set(e.x,e.y);
  }else if(e.type==='arrowRain'){
    const g=new PIXI.Graphics();g.lineStyle(3,0xd9f0a0,0.55).drawCircle(0,0,e.radius||190);for(let i=0;i<24;i++){const a=(i*2.399)+e.id,r=((i*47)%100)/100*(e.radius||190),x=Math.cos(a)*r,y=Math.sin(a)*r;g.lineStyle(3,0xf5efbd,0.85).moveTo(x-8,y-32).lineTo(x,y+10);g.beginFill(0xd5ba65).drawCircle(x,y+10,3).endFill();}c.addChild(g);c.position.set(e.x,e.y);
  }else{
    const g=new PIXI.Graphics().lineStyle(4,0xff5a46,0.9).drawCircle(0,0,25);c.addChild(g);c.position.set(e.x2,e.y2);
  }
  effectLayer.addChild(c);effectNodes.set(e.id,c);
}
const preview=new PIXI.Graphics();previewLayer.addChild(preview);
function getMe(){return players.find(p=>p.id===myId)||null}function getBoss(){return currentMap==='forest'?(slimes.find(s=>s.boss&&s.alive)||null):null}
function updateZoneStatus(){if(currentSafe){zoneStatusEl.classList.remove('danger');zoneStatusEl.innerHTML='🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small>';}else{zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML=currentMap==='arena'?'⚔️ 결투장<small>PVP 전용 · 안전지대 없음</small>':'⚔️ 전투 지역<small>PVP 허용 · 몬스터 공격 가능</small>';}}
function setAvatar(a){
  selectedAvatar=a;socket.emit('setAvatar',{avatar:a});avatarButtons.forEach(b=>b.classList.toggle('selected',b.dataset.avatar===a));chainBtn.classList.remove('hidden');
  if(a==='mage'){currentAvatarNameEl.textContent='마법사';skillNameEl.textContent='영혼불';chainStateEl.textContent='체인 라이트닝';attackLabel.textContent='영혼불';chainBtn.innerHTML='⚡<br>체인';}
  else if(a==='pirate'){currentAvatarNameEl.textContent='해적';skillNameEl.textContent='슬래시';chainStateEl.textContent='유령해적선';attackLabel.textContent='슬래시';chainBtn.innerHTML='👻<br>유령선';}
  else{currentAvatarNameEl.textContent='궁수';skillNameEl.textContent='3연발 화살';chainStateEl.textContent='화살비';attackLabel.textContent='3연발';chainBtn.innerHTML='🏹<br>화살비';}
}
avatarButtons.forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setAvatar(b.dataset.avatar);}));
function mouseAim(){const me=getMe(),node=me&&playerNodes.get(me.id);if(!me||!node)return null;const dx=cameraX+mouseX-node.x,dy=cameraY+mouseY-node.y,l=Math.hypot(dx,dy);return l<.001?null:{x:dx/l,y:dy/l};}
function attackAim(){return mouseAimActive?(mouseAim()||lastMobileAim):lastMobileAim}function skillTarget(aim){const me=getMe(),node=me&&playerNodes.get(me.id);if(mouseAimActive)return{x:cameraX+mouseX,y:cameraY+mouseY};if(node&&aim)return{x:node.x+aim.x*620,y:node.y+aim.y*620};return null}function sendAim(a){if(!a||serverFull)return;if(Math.abs(a.x-lastAimX)>.01||Math.abs(a.y-lastAimY)>.01){socket.emit('aim',a);lastAimX=a.x;lastAimY=a.y;}}
function castPrimary(a,auto){if(serverFull)return;if(currentSafe){skillStateEl.textContent='🛡️ 안전지대에서는 공격 불가';return;}if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.mage)return;socket.emit('castSoulFire',{aim:a,autoAim:!!auto});}else if(selectedAvatar==='pirate'){if(performance.now()<cooldownUntil.pirate)return;socket.emit('castSlash',{aim:a,autoAim:!!auto});}else{if(performance.now()<cooldownUntil.archer)return;socket.emit('castTripleArrow',{aim:a,autoAim:!!auto});}}
function castSecondary(a,auto){if(serverFull||currentSafe)return;if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.chain)return;socket.emit('castChain',{aim:a,autoAim:!!auto});}else if(selectedAvatar==='pirate'){if(performance.now()<cooldownUntil.pirateQ)return;socket.emit('castGhostShip',{aim:a,autoAim:!!auto});}else{if(performance.now()<cooldownUntil.archerQ)return;socket.emit('castArrowRain',{target:skillTarget(a)});}}function tryPortal(){if(!serverFull)socket.emit('usePortal');}
socket.on('connect',()=>{if(!serverFull)statusEl.textContent='서버 접속됨';});
socket.on('welcome',d=>{myId=d.id;currentMap=d.map;currentMapName=d.mapName;world=d.world;currentPortals=d.portals||[];forestSafeZone=d.safeZone;soulFireCooldown=d.soulFireCooldown;slashCooldown=d.slashCooldown;chainCooldown=d.chainCooldown;tripleArrowCooldown=d.tripleArrowCooldown;arrowRainCooldown=d.arrowRainCooldown;ghostShipCooldown=d.ghostShipCooldown;slashRange=d.slashRange;slashHalfAngle=d.slashHalfAngle;maxCountEl.textContent=d.maxPlayers;mapNameEl.textContent=currentMapName;buildMap();setAvatar('mage');});
socket.on('mapChanged',d=>{currentMap=d.map;currentMapName=d.mapName;world=d.world;currentPortals=d.portals||[];players=[];slimes=[];soulFires=[];for(const c of playerNodes.values())c.destroy({children:true});playerNodes.clear();playerTargets.clear();for(const c of slimeNodes.values())c.destroy({children:true});slimeNodes.clear();slimeTargets.clear();for(const c of projectileNodes.values())c.destroy();projectileNodes.clear();buildMap();mapNameEl.textContent=currentMapName;skillStateEl.textContent=currentMap==='arena'?'⚔️ 결투장 입장':currentMap==='village'?'마을 도착':'숲 도착';});
socket.on('count',d=>{countEl.textContent=d.current;maxCountEl.textContent=d.max;});
socket.on('state',d=>{currentMap=d.map||currentMap;currentMapName=d.mapName||currentMapName;world=d.world||world;currentPortals=d.portals||currentPortals;currentSafe=!!d.safe;players=d.players||[];slimes=d.slimes||[];soulFires=d.soulFires||[];syncProjectiles();mapNameEl.textContent=currentMapName;const me=getMe();if(me)hpTextEl.textContent=Math.ceil(me.hp)+' / '+me.maxHp;if(currentMap==='forest'&&d.bossActive)bossProgressEl.textContent='👑 보스 전투중';else if(currentMap==='forest')bossProgressEl.textContent=d.bossProgress+' / '+d.bossTarget;else bossProgressEl.textContent='-';updateZoneStatus();});
socket.on('combatEffect',e=>spawnEffect(e));
socket.on('bossSpawned',d=>{if(currentMap!=='forest')return;skillStateEl.textContent='👑 보스 슬라임 출현!';bossLocatorEl.style.display='block';bossLocatorEl.textContent='👑 BOSS · X '+Math.round(d.x)+' · Y '+Math.round(d.y);});
socket.on('bossDefeated',()=>{if(currentMap!=='forest')return;skillStateEl.textContent='🏆 보스 처치!';bossLocatorEl.style.display='none';clearMessageEl.style.display='flex';clearTimeout(clearTimer);clearTimer=setTimeout(()=>{clearMessageEl.style.display='none';skillStateEl.textContent='대기';},3000);});
socket.on('playerDefeated',d=>{deathMessageEl.textContent=d.source==='pvp'?'플레이어에게 쓰러졌습니다':'슬라임에게 쓰러졌습니다';deathMessageEl.classList.add('active');clearTimeout(deathTimer);deathTimer=setTimeout(()=>deathMessageEl.classList.remove('active'),1300);});
socket.on('playerRespawned',()=>{deathMessageEl.classList.remove('active');skillStateEl.textContent='안전지대에서 부활';});
socket.on('serverFull',d=>{serverFull=true;statusEl.textContent='서버가 가득 찼습니다';countEl.textContent=d.maxPlayers;maxCountEl.textContent=d.maxPlayers;socket.io.opts.reconnection=false;});
socket.on('disconnect',()=>{if(!serverFull)statusEl.textContent='재접속 중...';});
socket.on('skillCastResult',d=>{
  if(!d.success){skillStateEl.textContent=d.reason==='safe'?'🛡️ 안전지대에서는 공격 불가':d.reason==='noTarget'?'대상 없음':d.reason==='dead'?'부활 대기 중':'쿨타임';return;}
  if(d.skill==='soulFire'){cooldownUntil.mage=performance.now()+d.cooldown;skillStateEl.textContent='🩵 관통 영혼불!';}
  else if(d.skill==='slash'){cooldownUntil.pirate=performance.now()+d.cooldown;skillStateEl.textContent='⚔️ 슬래시!';}
  else if(d.skill==='chain'){cooldownUntil.chain=performance.now()+d.cooldown;skillStateEl.textContent='⚡ 강화 체인 라이트닝!';}
  else if(d.skill==='tripleArrow'){cooldownUntil.archer=performance.now()+d.cooldown;skillStateEl.textContent='🏹 3연발 화살!';}
  else if(d.skill==='arrowRain'){cooldownUntil.archerQ=performance.now()+d.cooldown;skillStateEl.textContent='🌧️ 화살비!';}
  else if(d.skill==='ghostShip'){cooldownUntil.pirateQ=performance.now()+d.cooldown;skillStateEl.textContent='👻 유령해적선 돌진!';}
});
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){keys.add(k);e.preventDefault();}if(k==='e'&&!e.repeat){const a=mouseAim()||attackAim();if(a){sendAim(a);castPrimary(a,false);}e.preventDefault();}if(k==='q'&&!e.repeat){const a=mouseAim()||attackAim();if(a){sendAim(a);castSecondary(a,false);}e.preventDefault();}if(k==='f'&&!e.repeat){tryPortal();e.preventDefault();}});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));app.view.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'&&e.pointerType!=='pen')return;mouseX=e.clientX;mouseY=e.clientY;mouseAimActive=true;const a=mouseAim();if(a)sendAim(a);});portalBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();tryPortal();});
function joyVector(el,x,y,dz){const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,m=r.width*.34;let dx=x-cx,dy=y-cy;const raw=Math.hypot(dx,dy);if(raw>m){dx=dx/raw*m;dy=dy/raw*m;}const amount=Math.min(1,raw/m);let nx=dx/m,ny=dy/m;if(amount<dz){nx=0;ny=0;}return{dx,dy,nx,ny,amount};}function setKnob(k,x,y){k.style.transform='translate('+x+'px,'+y+'px)';}
moveJoy.addEventListener('pointerdown',e=>{movePointerId=e.pointerId;moveJoy.setPointerCapture(e.pointerId);const v=joyVector(moveJoy,e.clientX,e.clientY,.12);moveX=v.nx;moveY=v.ny;setKnob(moveKnob,v.dx,v.dy);});moveJoy.addEventListener('pointermove',e=>{if(e.pointerId!==movePointerId)return;const v=joyVector(moveJoy,e.clientX,e.clientY,.12);moveX=v.nx;moveY=v.ny;setKnob(moveKnob,v.dx,v.dy);});function releaseMove(e){if(e.pointerId!==movePointerId)return;movePointerId=null;moveX=0;moveY=0;setKnob(moveKnob,0,0);}moveJoy.addEventListener('pointerup',releaseMove);moveJoy.addEventListener('pointercancel',releaseMove);
attackJoy.addEventListener('pointerdown',e=>{attackPointerId=e.pointerId;attackJoy.setPointerCapture(e.pointerId);attackDragging=true;const v=joyVector(attackJoy,e.clientX,e.clientY,0);attackDragAmount=v.amount;setKnob(attackKnob,v.dx,v.dy);if(v.amount>=.08){const a=norm(v.nx,v.ny,lastMobileAim.x,lastMobileAim.y);attackX=a.x;attackY=a.y;lastMobileAim=a;sendAim(a);}});attackJoy.addEventListener('pointermove',e=>{if(e.pointerId!==attackPointerId)return;const v=joyVector(attackJoy,e.clientX,e.clientY,0);attackDragAmount=Math.max(attackDragAmount,v.amount);setKnob(attackKnob,v.dx,v.dy);if(v.amount>=.08){const a=norm(v.nx,v.ny,lastMobileAim.x,lastMobileAim.y);attackX=a.x;attackY=a.y;lastMobileAim=a;sendAim(a);}});function releaseAttack(e){if(e.pointerId!==attackPointerId)return;const manual=attackDragAmount>=.2,a=manual?{x:attackX,y:attackY}:lastMobileAim;attackPointerId=null;attackDragging=false;attackDragAmount=0;setKnob(attackKnob,0,0);castPrimary(a,!manual);}attackJoy.addEventListener('pointerup',releaseAttack);attackJoy.addEventListener('pointercancel',e=>{if(e.pointerId!==attackPointerId)return;attackPointerId=null;attackDragging=false;attackDragAmount=0;setKnob(attackKnob,0,0);});chainBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();const manual=attackDragging&&attackDragAmount>=.2;castSecondary(manual?{x:attackX,y:attackY}:lastMobileAim,!manual);});
setInterval(()=>{if(serverFull)return;let x=0,y=0;if(keys.has('a')||keys.has('arrowleft'))x--;if(keys.has('d')||keys.has('arrowright'))x++;if(keys.has('w')||keys.has('arrowup'))y--;if(keys.has('s')||keys.has('arrowdown'))y++;if(Math.abs(moveX)>.01||Math.abs(moveY)>.01){x=moveX;y=moveY;}const l=Math.hypot(x,y);if(l>1){x/=l;y/=l;}if(Math.abs(x-lastInputX)>.01||Math.abs(y-lastInputY)>.01){socket.emit('input',{x,y});lastInputX=x;lastInputY=y;}if(mouseAimActive){const a=mouseAim();if(a)sendAim(a);}},40);
setInterval(()=>{
  let until=0,label='Q';
  if(selectedAvatar==='mage'){until=cooldownUntil.chain;label='⚡<br>체인';}
  else if(selectedAvatar==='pirate'){until=cooldownUntil.pirateQ;label='👻<br>유령선';}
  else{until=cooldownUntil.archerQ;label='🏹<br>화살비';}
  const r=Math.max(0,until-performance.now());
  if(r>0){chainBtn.classList.add('cooling');chainBtn.innerHTML=(r/1000).toFixed(1);chainStateEl.textContent=(r/1000).toFixed(1)+'초';}
  else{chainBtn.classList.remove('cooling');chainBtn.innerHTML=label;chainStateEl.textContent=selectedAvatar==='mage'?'체인 라이트닝':selectedAvatar==='pirate'?'유령해적선':'화살비';}
},120);
function updatePortalUi(){const me=getMe();if(!me||!me.alive){portalPrompt.style.display='none';portalBtn.style.display='none';return;}let best=null,d0=Infinity;for(const p of currentPortals){const d=Math.hypot(me.x-p.x,me.y-p.y);if(d<=145&&d<d0){d0=d;best=p;}}portalPrompt.style.display=best?'block':'none';portalPrompt.textContent=best?'F · '+(best.label||'포탈')+' 사용':'';if(coarse){portalBtn.style.display=best?'block':'none';portalBtn.textContent=best?(best.label||'포탈')+' 이동':'포탈 이동';}}
function updateBossLocator(){if(currentMap!=='forest'){bossLocatorEl.style.display='none';return;}const b=getBoss(),me=getMe();if(!b){bossLocatorEl.style.display='none';return;}bossLocatorEl.style.display='block';if(!me){bossLocatorEl.textContent='👑 BOSS';return;}const dx=b.x-me.x,dy=b.y-me.y,d=(Math.atan2(dy,dx)*180/Math.PI+360)%360;const arrow=d<22.5||d>=337.5?'→':d<67.5?'↘':d<112.5?'↓':d<157.5?'↙':d<202.5?'←':d<247.5?'↖':d<292.5?'↑':'↗';bossLocatorEl.textContent='👑 BOSS '+arrow+' · 거리 '+Math.round(Math.hypot(dx,dy));}
app.ticker.maxFPS=60;app.ticker.add(()=>{const dt=Math.min(app.ticker.deltaMS/1000,.05);for(const p of players)updatePlayerNode(p,dt);cleanupPlayerNodes();for(const s of slimes)updateSlimeNode(s,dt);cleanupSlimeNodes();const me=getMe(),meNode=me&&playerNodes.get(me.id);if(meNode){cameraX=clampClient(meNode.x-innerWidth/2,0,Math.max(0,world.width-innerWidth));cameraY=clampClient(meNode.y-innerHeight/2,0,Math.max(0,world.height-innerHeight));}else{cameraX=0;cameraY=0;}worldRoot.position.set(-cameraX,-cameraY);for(const n of projectileNodes.values()){n.x+=n.vx*dt;n.y+=n.vy*dt;}for(const [id,c] of effectNodes){const t=(performance.now()-c.started)/c.life;c.alpha=Math.max(0,1-t);if(t>=1){c.destroy({children:true});effectNodes.delete(id);}}for(const c of portalLayer.children){if(c.ring){const pulse=1+Math.sin(performance.now()/260+c.position.x*.01)*.06;c.ring.scale.set(pulse);c.ring.rotation+=dt*.25;}}preview.clear();if(attackDragging&&meNode){if(selectedAvatar==='mage'){preview.lineStyle(6,0x5ffaff,.65).moveTo(meNode.x,meNode.y).lineTo(meNode.x+attackX*500,meNode.y+attackY*500);}else if(selectedAvatar==='pirate'){const angle=Math.atan2(attackY,attackX);preview.beginFill(0xffb137,.15).moveTo(meNode.x,meNode.y).arc(meNode.x,meNode.y,slashRange,angle-slashHalfAngle,angle+slashHalfAngle).lineTo(meNode.x,meNode.y).endFill();}else{const base=Math.atan2(attackY,attackX);preview.lineStyle(3,0xe8e0a0,.62);for(const off of[-.14,0,.14]){const a=base+off;preview.moveTo(meNode.x,meNode.y).lineTo(meNode.x+Math.cos(a)*500,meNode.y+Math.sin(a)*500);}}}updateBossLocator();updatePortalUi();});
})();
</script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log('Forest RPG running on port ' + PORT);
  console.log('Renderer: PixiJS/WebGL');
  console.log('Forest: detailed plaza / rivers / bridges / cliffs / collision');
  console.log('Physics ' + PHYSICS_RATE + 'Hz / network ' + NETWORK_RATE + 'Hz / AI ' + MONSTER_AI_RATE + 'Hz');
  console.log('Spatial grid ' + GRID_SIZE + 'px / view ' + VIEW_RADIUS + 'px / active AI ' + MONSTER_ACTIVE_RADIUS + 'px');
  console.log('Slimes ' + NORMAL_SLIMES + ' normal + ' + ELITE_SLIMES + ' elite');
});

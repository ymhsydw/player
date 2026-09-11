const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });
const PORT = process.env.PORT || 3000;

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

const MAX_PLAYERS = 20;
const PLAYER_SPEED = 300;
const PLAYER_RADIUS = 24;
const PLAYER_MAX_HP = 100;
const PLAYER_RESPAWN_MS = 1500;
const SAFE_HEAL_PER_SECOND = 18;

// 성능 설정: 서버 판정은 30Hz 유지, AI/네트워크만 낮춰 플레이 감각을 보존한다.
const PHYSICS_RATE = 30;
const NETWORK_RATE = 10;
const MONSTER_AI_RATE = 6;
const GRID_SIZE = 400;
const VIEW_RADIUS = 1300;
const MONSTER_ACTIVE_RADIUS = 1050;

const AVATARS = ['mage', 'pirate'];
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
const SOUL_FIRE_RADIUS = 15;
const SOUL_FIRE_LIFE = 1.5;
const SOUL_FIRE_COOLDOWN = 900;

const SLASH_RANGE = 145;
const SLASH_HALF_ANGLE = Math.PI / 3;
const SLASH_DAMAGE = 120;
const SLASH_COOLDOWN = 1000;
const SLASH_EFFECT_LIFE = 0.28;

const CHAIN_DAMAGE = 70;
const CHAIN_RADIUS = 260;
const CHAIN_MAX_TARGETS = 5;
const CHAIN_CAST_RANGE = 550;
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
  for (let tries = 0; tries < 120; tries++) {
    const x = margin + Math.random() * (MAPS.forest.width - margin * 2);
    const y = margin + Math.random() * (MAPS.forest.height - margin * 2);
    if (isPointInForestSafeZone(x, y, 210)) continue;
    if (!isFarEnoughFromOtherSlimes(x, y, minDistance)) continue;
    return { x, y };
  }
  for (let tries = 0; tries < 50; tries++) {
    const x = margin + Math.random() * (MAPS.forest.width - margin * 2);
    const y = margin + Math.random() * (MAPS.forest.height - margin * 2);
    if (!isPointInForestSafeZone(x, y, 180)) return { x, y };
  }
  return { x: 420, y: 420 };
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
    lastSoulFireAt: 0, lastSlashAt: 0, lastChainAt: 0, lastPortalAt: 0
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

function castSoulFire(p, aimData, autoAim) {
  const blocked = p.avatar !== 'mage' ? 'avatar' : skillBlock(p, p.lastSoulFireAt, SOUL_FIRE_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const a = resolveAim(p, aimData, autoAim, 900);
  p.lastSoulFireAt = Date.now(); p.aimX = a.x; p.aimY = a.y;
  const id = nextSoulFireId++;
  soulFires.set(id, { id, ownerId: p.id, map: p.map, x: p.x + a.x * 43, y: p.y + a.y * 43, vx: a.x * SOUL_FIRE_SPEED, vy: a.y * SOUL_FIRE_SPEED, radius: SOUL_FIRE_RADIUS, life: SOUL_FIRE_LIFE });
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
  return { id: p.id, map: p.map, x: p.x, y: p.y, direction: p.direction, moving: p.moving, avatar: p.avatar, hp: p.hp, maxHp: p.maxHp, alive: p.alive };
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
    if (f.map === viewer.map && near(viewer, f.x, f.y, VIEW_RADIUS + 250)) fires.push({ id: f.id, x: f.x, y: f.y, vx: f.vx, vy: f.vy });
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
    soulFireCooldown: SOUL_FIRE_COOLDOWN, slashCooldown: SLASH_COOLDOWN, chainCooldown: CHAIN_COOLDOWN,
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
    p.x = clamp(p.x + p.inputX * PLAYER_SPEED * dt, PLAYER_RADIUS, map.width - PLAYER_RADIUS);
    p.y = clamp(p.y + p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS, map.height - PLAYER_RADIUS);
    if (isPlayerSafe(p) && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + SAFE_HEAL_PER_SECOND * dt);
  }

  for (const s of slimes.values()) {
    if (!s.alive) {
      if (bossId === null && !s.boss && !s.suppressedByBoss && s.respawnAt && now >= s.respawnAt) respawnSlime(s);
      continue;
    }
    if (!s.active && !s.boss) continue;
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.x < s.radius || s.x > MAPS.forest.width - s.radius) { s.vx *= -1; s.x = clamp(s.x, s.radius, MAPS.forest.width - s.radius); }
    if (s.y < s.radius || s.y > MAPS.forest.height - s.radius) { s.vy *= -1; s.y = clamp(s.y, s.radius, MAPS.forest.height - s.radius); }
    constrainSlimeOutsideSafeZone(s);
  }

  rebuildSlimeGrid();

  for (const fire of [...soulFires.values()]) {
    const owner = players.get(fire.ownerId);
    fire.x += fire.vx * dt; fire.y += fire.vy * dt; fire.life -= dt;
    const map = mapSpec(fire.map);
    if (fire.life <= 0 || fire.x < -60 || fire.x > map.width + 60 || fire.y < -60 || fire.y > map.height + 60) {
      soulFires.delete(fire.id); continue;
    }
    let hit = null, bestD2 = Infinity;
    if (fire.map === 'forest') {
      for (const s of querySlimes(fire.x, fire.y, 100)) {
        const dx = s.x - fire.x, dy = s.y - fire.y, r = s.radius + fire.radius, d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'slime', ref: s }; }
      }
    }
    if (owner) {
      for (const target of players.values()) {
        if (!canPvp(owner, target) || target.map !== fire.map) continue;
        const dx = target.x - fire.x, dy = target.y - fire.y, r = PLAYER_RADIUS + fire.radius, d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'player', ref: target }; }
      }
    }
    if (hit) {
      soulFires.delete(fire.id);
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

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><title>Forest RPG</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#20391d;font-family:system-ui,sans-serif;touch-action:none}canvas{display:block;width:100%;height:100%}
#hud{position:fixed;left:10px;top:10px;z-index:20;color:#fff;background:rgba(8,14,8,.78);border:1px solid rgba(255,255,255,.15);border-radius:11px;padding:9px 12px;line-height:1.45;font-size:13px;pointer-events:none}#status{font-weight:900}#skillName,#skillState,#chainState{color:#78f5ff;font-weight:900}#hpText{color:#ffb0b0;font-weight:900}#bossProgress{color:#ffb5b5;font-weight:900}#mapName{color:#ffe49b;font-weight:900}
#bossLocator{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:60;display:none;min-width:250px;padding:8px 12px;color:#fff4c7;background:rgba(112,18,27,.92);border:2px solid rgba(255,90,100,.75);border-radius:11px;text-align:center;font-size:12px;font-weight:900;pointer-events:none}
#zoneStatus{position:fixed;top:10px;right:10px;z-index:50;color:#e1ffe6;background:rgba(18,90,40,.92);border:2px solid rgba(118,255,153,.7);border-radius:11px;padding:8px 12px;font-size:12px;font-weight:900;text-align:center;pointer-events:none}#zoneStatus.danger{color:#fff0e2;background:rgba(125,35,20,.92);border-color:rgba(255,130,88,.78)}#zoneStatus small{display:block;margin-top:2px;font-size:10px;opacity:.85}
#avatarPanel{position:fixed;right:10px;top:78px;z-index:25;width:195px;color:#fff;background:rgba(8,14,8,.78);border:1px solid rgba(255,255,255,.15);border-radius:11px;padding:9px}#avatarTitle{margin-bottom:7px;font-weight:900}#avatarGrid{display:grid;gap:7px}.avatarBtn{border:2px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(255,255,255,.06);color:#fff;padding:8px;text-align:left;font:inherit;cursor:pointer}.avatarBtn.selected{border-color:#7cf8ff;background:rgba(80,230,255,.11)}.avatarBtn b,.avatarBtn span{display:block}.avatarBtn span{font-size:10px;opacity:.82}
.joyZone{position:fixed;bottom:max(18px,env(safe-area-inset-bottom));z-index:35;width:146px;height:146px;border-radius:50%;touch-action:none;user-select:none}#moveJoy{left:18px;border:2px solid rgba(255,255,255,.36);background:rgba(0,0,0,.2)}#attackJoy{right:18px;border:2px solid rgba(93,247,255,.72);background:rgba(10,103,118,.2)}.joyKnob{position:absolute;width:54px;height:54px;left:46px;top:46px;border-radius:50%;pointer-events:none}#moveKnob{background:rgba(255,255,255,.82)}#attackKnob{background:rgba(95,247,255,.86)}#attackLabel{position:absolute;left:0;right:0;top:10px;text-align:center;color:#d8ffff;font-weight:900;font-size:11px;pointer-events:none}
#chainBtn{position:fixed;right:140px;bottom:max(140px,calc(env(safe-area-inset-bottom) + 140px));z-index:40;width:70px;height:70px;border-radius:50%;border:3px solid #65f4ff;background:rgba(10,94,118,.92);color:#fff;font:900 12px system-ui;touch-action:none}#chainBtn.cooling{opacity:.55}#chainBtn.hidden{display:none}
#portalPrompt{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:55;display:none;padding:9px 16px;border-radius:13px;background:rgba(35,25,70,.9);border:2px solid rgba(170,130,255,.85);color:#fff;font-weight:900;pointer-events:none}#portalBtn{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:55;display:none;padding:11px 18px;border-radius:17px;border:2px solid #b691ff;background:rgba(65,40,130,.92);color:#fff;font:900 14px system-ui;touch-action:none}
#clearMessage{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.4);pointer-events:none}#clearMessage.active{display:flex}#clearTitle{color:#ffe477;font-size:clamp(60px,11vw,140px);font-weight:1000;text-shadow:0 5px 20px #000}#clearSub{color:#fff;text-align:center;font-size:20px;font-weight:900}.death{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:900;display:none;padding:16px 25px;border-radius:15px;background:rgba(90,10,20,.88);border:2px solid rgba(255,100,110,.85);color:#fff;font-size:22px;font-weight:1000;pointer-events:none}.death.active{display:block}
@media(pointer:fine){.joyZone,#chainBtn,#portalBtn{display:none!important}}@media(max-width:700px){#avatarPanel{width:165px}#bossLocator{top:64px;min-width:210px}#zoneStatus{font-size:10px}#portalPrompt{bottom:195px}}
</style></head><body>
<canvas id="game"></canvas><div id="clearMessage"><div><div id="clearTitle">CLEAR!</div><div id="clearSub">👑 보스 슬라임 처치 완료</div></div></div><div id="deathMessage" class="death">쓰러졌습니다</div>
<div id="hud"><div id="status">서버 연결 중...</div><div>접속자: <span id="count">0</span>/<span id="maxCount">20</span>명</div><div>맵: <span id="mapName">숲</span></div><div>HP: <span id="hpText">100 / 100</span></div><div>캐릭터: <span id="currentAvatarName">마법사</span></div><div>E: <span id="skillName">영혼불</span></div><div>Q: <span id="chainState">체인 라이트닝</span></div><div>상태: <span id="skillState">대기</span></div><div>보스 게이지: <span id="bossProgress">0 / 20</span></div></div>
<div id="bossLocator"></div><div id="zoneStatus">🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small></div>
<div id="avatarPanel"><div id="avatarTitle">캐릭터 선택</div><div id="avatarGrid"><button class="avatarBtn selected" data-avatar="mage" type="button"><b>🔮 마법사</b><span>E 영혼불 · Q 체인</span></button><button class="avatarBtn" data-avatar="pirate" type="button"><b>🏴‍☠️ 해적</b><span>E 슬래시</span></button></div></div>
<div id="moveJoy" class="joyZone"><div id="moveKnob" class="joyKnob"></div></div><div id="attackJoy" class="joyZone"><div id="attackLabel">영혼불</div><div id="attackKnob" class="joyKnob"></div></div><button id="chainBtn" type="button">⚡<br>체인</button><div id="portalPrompt">F · 포탈 사용</div><button id="portalBtn" type="button">포탈 이동</button>
<script src="/socket.io/socket.io.js"></script><script>
const socket=io({transports:['websocket','polling']});
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d',{alpha:false});
const E=id=>document.getElementById(id),statusEl=E('status'),countEl=E('count'),maxCountEl=E('maxCount'),mapNameEl=E('mapName'),hpTextEl=E('hpText'),currentAvatarNameEl=E('currentAvatarName'),skillNameEl=E('skillName'),chainStateEl=E('chainState'),skillStateEl=E('skillState'),bossProgressEl=E('bossProgress'),bossLocatorEl=E('bossLocator'),zoneStatusEl=E('zoneStatus'),clearMessageEl=E('clearMessage'),deathMessageEl=E('deathMessage'),moveJoy=E('moveJoy'),moveKnob=E('moveKnob'),attackJoy=E('attackJoy'),attackKnob=E('attackKnob'),attackLabel=E('attackLabel'),chainBtn=E('chainBtn'),portalPrompt=E('portalPrompt'),portalBtn=E('portalBtn'),avatarButtons=[...document.querySelectorAll('.avatarBtn')];
const coarse=matchMedia('(pointer:coarse)').matches,lowPower=coarse||((navigator.hardwareConcurrency||8)<=4);
let myId=null,currentMap='forest',currentMapName='숲',world={width:5200,height:3400},currentPortals=[],forestSafeZone={x:2600,y:1700,radius:470},currentSafe=true,players=[],slimes=[],soulFires=[],effects=[],serverFull=false,keys=new Set(),cameraX=0,cameraY=0,mouseX=innerWidth/2,mouseY=innerHeight/2,mouseAimActive=false,selectedAvatar='mage',movePointerId=null,attackPointerId=null,moveX=0,moveY=0,attackX=0,attackY=1,attackDragAmount=0,attackDragging=false,lastMobileAim={x:0,y:1},lastInputX=999,lastInputY=999,lastAimX=999,lastAimY=999,soulFireCooldown=900,slashCooldown=1000,chainCooldown=4500,slashRange=145,slashHalfAngle=Math.PI/3,cooldownUntil={mage:0,pirate:0,chain:0},clearTimer=null,deathTimer=null,stateReceivedAt=performance.now();
const playerVisuals=new Map(),slimeVisuals=new Map();
function cClamp(v,a,b){return Math.max(a,Math.min(b,v))}function norm(x,y,fx,fy){const l=Math.hypot(x,y);return l<.001?{x:fx,y:fy}:{x:x/l,y:y/l}}
function resize(){const max=coarse?1.25:1.6,d=Math.min(devicePixelRatio||1,max);canvas.width=Math.floor(innerWidth*d);canvas.height=Math.floor(innerHeight*d);canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';ctx.setTransform(d,0,0,d,0,0);ctx.imageSmoothingEnabled=true}addEventListener('resize',resize);resize();
const mageImage=new Image();let mageReady=false;mageImage.onload=()=>mageReady=true;mageImage.src='/mage.png?v=90';const pirateImage=new Image();let pirateReady=false;pirateImage.onload=()=>pirateReady=true;pirateImage.src='/pirate.png?v=90';
function syncVisual(cache,list){const keep=new Set();for(const item of list){keep.add(item.id);let v=cache.get(item.id);if(!v){v={x:item.x,y:item.y,tx:item.x,ty:item.y};cache.set(item.id,v)}v.tx=item.x;v.ty=item.y}for(const id of cache.keys())if(!keep.has(id))cache.delete(id)}function visual(cache,item,fast){let v=cache.get(item.id);if(!v){v={x:item.x,y:item.y,tx:item.x,ty:item.y};cache.set(item.id,v)}const f=fast?.46:.32;v.x+=(v.tx-v.x)*f;v.y+=(v.ty-v.y)*f;return v}
socket.on('connect',()=>{if(!serverFull)statusEl.textContent='서버 접속됨'});socket.on('welcome',d=>{myId=d.id;currentMap=d.map;currentMapName=d.mapName;world=d.world;currentPortals=d.portals||[];forestSafeZone=d.safeZone;soulFireCooldown=d.soulFireCooldown;slashCooldown=d.slashCooldown;chainCooldown=d.chainCooldown;slashRange=d.slashRange;slashHalfAngle=d.slashHalfAngle;maxCountEl.textContent=d.maxPlayers;mapNameEl.textContent=currentMapName;setAvatar('mage')});socket.on('mapChanged',d=>{currentMap=d.map;currentMapName=d.mapName;world=d.world;currentPortals=d.portals||[];players=[];slimes=[];soulFires=[];effects=[];playerVisuals.clear();slimeVisuals.clear();mapNameEl.textContent=currentMapName;skillStateEl.textContent=currentMap==='arena'?'⚔️ 결투장 입장':currentMap==='village'?'마을 도착':'숲 도착'});socket.on('count',d=>{countEl.textContent=d.current;maxCountEl.textContent=d.max});
socket.on('state',d=>{stateReceivedAt=performance.now();currentMap=d.map||currentMap;currentMapName=d.mapName||currentMapName;world=d.world||world;currentPortals=d.portals||currentPortals;currentSafe=!!d.safe;players=d.players||[];slimes=d.slimes||[];soulFires=d.soulFires||[];syncVisual(playerVisuals,players);syncVisual(slimeVisuals,slimes);mapNameEl.textContent=currentMapName;const me=getMe();if(me)hpTextEl.textContent=Math.ceil(me.hp)+' / '+me.maxHp;if(currentMap==='forest'&&d.bossActive)bossProgressEl.textContent='👑 보스 전투중';else if(currentMap==='forest')bossProgressEl.textContent=d.bossProgress+' / '+d.bossTarget;else bossProgressEl.textContent='-';updateZoneStatus()});
socket.on('combatEffect',e=>{e.started=performance.now();effects.push(e);if(effects.length>40)effects.splice(0,effects.length-40)});socket.on('bossSpawned',d=>{if(currentMap!=='forest')return;skillStateEl.textContent='👑 보스 슬라임 출현!';bossLocatorEl.style.display='block';bossLocatorEl.textContent='👑 BOSS · X '+Math.round(d.x)+' · Y '+Math.round(d.y)});socket.on('bossDefeated',()=>{if(currentMap!=='forest')return;skillStateEl.textContent='🏆 보스 처치!';bossLocatorEl.style.display='none';clearMessageEl.style.display='flex';clearTimeout(clearTimer);clearTimer=setTimeout(()=>{clearMessageEl.style.display='none';skillStateEl.textContent='대기'},3000)});socket.on('playerDefeated',d=>{deathMessageEl.textContent=d.source==='pvp'?'플레이어에게 쓰러졌습니다':'슬라임에게 쓰러졌습니다';deathMessageEl.classList.add('active');clearTimeout(deathTimer);deathTimer=setTimeout(()=>deathMessageEl.classList.remove('active'),1300)});socket.on('playerRespawned',()=>{deathMessageEl.classList.remove('active');skillStateEl.textContent='안전지대에서 부활'});socket.on('serverFull',d=>{serverFull=true;statusEl.textContent='서버가 가득 찼습니다';countEl.textContent=d.maxPlayers;maxCountEl.textContent=d.maxPlayers;socket.io.opts.reconnection=false});socket.on('disconnect',()=>{if(!serverFull)statusEl.textContent='재접속 중...'});
socket.on('skillCastResult',d=>{if(!d.success){skillStateEl.textContent=d.reason==='safe'?'🛡️ 안전지대에서는 공격 불가':d.reason==='noTarget'?'체인 라이트닝 대상 없음':d.reason==='dead'?'부활 대기 중':'쿨타임';return}if(d.skill==='soulFire'){cooldownUntil.mage=performance.now()+d.cooldown;skillStateEl.textContent='🩵 영혼불!'}else if(d.skill==='slash'){cooldownUntil.pirate=performance.now()+d.cooldown;skillStateEl.textContent='⚔️ 슬래시!'}else{cooldownUntil.chain=performance.now()+d.cooldown;skillStateEl.textContent='⚡ 체인 라이트닝!'}});
function getMe(){return players.find(p=>p.id===myId)||null}function getBoss(){return currentMap==='forest'?(slimes.find(s=>s.boss&&s.alive)||null):null}function updateZoneStatus(){if(currentSafe){zoneStatusEl.classList.remove('danger');zoneStatusEl.innerHTML='🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small>'}else{zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML=currentMap==='arena'?'⚔️ 결투장<small>PVP 전용 · 안전지대 없음</small>':'⚔️ 전투 지역<small>PVP 허용 · 몬스터 공격 가능</small>'}}
function setAvatar(a){selectedAvatar=a;socket.emit('setAvatar',{avatar:a});avatarButtons.forEach(b=>b.classList.toggle('selected',b.dataset.avatar===a));if(a==='mage'){currentAvatarNameEl.textContent='마법사';skillNameEl.textContent='영혼불';chainStateEl.textContent='체인 라이트닝';attackLabel.textContent='영혼불';chainBtn.classList.remove('hidden')}else{currentAvatarNameEl.textContent='해적';skillNameEl.textContent='슬래시';chainStateEl.textContent='-';attackLabel.textContent='슬래시';chainBtn.classList.add('hidden')}}avatarButtons.forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setAvatar(b.dataset.avatar)}));
function mouseAim(){const me=getMe();if(!me)return null;const v=playerVisuals.get(me.id)||me,dx=cameraX+mouseX-v.x,dy=cameraY+mouseY-v.y,l=Math.hypot(dx,dy);return l<.001?null:{x:dx/l,y:dy/l}}function attackAim(){return mouseAimActive?(mouseAim()||lastMobileAim):lastMobileAim}function sendAim(a){if(!a||serverFull)return;if(Math.abs(a.x-lastAimX)>.01||Math.abs(a.y-lastAimY)>.01){socket.emit('aim',a);lastAimX=a.x;lastAimY=a.y}}function castPrimary(a,auto){if(serverFull)return;if(currentSafe){skillStateEl.textContent='🛡️ 안전지대에서는 공격 불가';return}if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.mage)return;socket.emit('castSoulFire',{aim:a,autoAim:!!auto})}else{if(performance.now()<cooldownUntil.pirate)return;socket.emit('castSlash',{aim:a,autoAim:!!auto})}}function castChain(a,auto){if(serverFull||selectedAvatar!=='mage'||currentSafe)return;if(performance.now()<cooldownUntil.chain)return;socket.emit('castChain',{aim:a,autoAim:!!auto})}function tryPortal(){if(!serverFull)socket.emit('usePortal')}
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){keys.add(k);e.preventDefault()}if(k==='e'&&!e.repeat){const a=mouseAim()||attackAim();if(a){sendAim(a);castPrimary(a,false)}e.preventDefault()}if(k==='q'&&selectedAvatar==='mage'&&!e.repeat){const a=mouseAim()||attackAim();if(a){sendAim(a);castChain(a,false)}e.preventDefault()}if(k==='f'&&!e.repeat){tryPortal();e.preventDefault()}});addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'&&e.pointerType!=='pen')return;mouseX=e.clientX;mouseY=e.clientY;mouseAimActive=true;const a=mouseAim();if(a)sendAim(a)});portalBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();tryPortal()});
function joyVector(el,x,y,dz){const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,m=r.width*.34;let dx=x-cx,dy=y-cy;const raw=Math.hypot(dx,dy);if(raw>m){dx=dx/raw*m;dy=dy/raw*m}const amount=Math.min(1,raw/m);let nx=dx/m,ny=dy/m;if(amount<dz){nx=0;ny=0}return{dx,dy,nx,ny,amount}}function setKnob(k,x,y){k.style.transform='translate('+x+'px,'+y+'px)'}
moveJoy.addEventListener('pointerdown',e=>{movePointerId=e.pointerId;moveJoy.setPointerCapture(e.pointerId);const v=joyVector(moveJoy,e.clientX,e.clientY,.12);moveX=v.nx;moveY=v.ny;setKnob(moveKnob,v.dx,v.dy)});moveJoy.addEventListener('pointermove',e=>{if(e.pointerId!==movePointerId)return;const v=joyVector(moveJoy,e.clientX,e.clientY,.12);moveX=v.nx;moveY=v.ny;setKnob(moveKnob,v.dx,v.dy)});function releaseMove(e){if(e.pointerId!==movePointerId)return;movePointerId=null;moveX=0;moveY=0;setKnob(moveKnob,0,0)}moveJoy.addEventListener('pointerup',releaseMove);moveJoy.addEventListener('pointercancel',releaseMove);
attackJoy.addEventListener('pointerdown',e=>{attackPointerId=e.pointerId;attackJoy.setPointerCapture(e.pointerId);attackDragging=true;const v=joyVector(attackJoy,e.clientX,e.clientY,0);attackDragAmount=v.amount;setKnob(attackKnob,v.dx,v.dy);if(v.amount>=.08){const a=norm(v.nx,v.ny,lastMobileAim.x,lastMobileAim.y);attackX=a.x;attackY=a.y;lastMobileAim=a;sendAim(a)}});attackJoy.addEventListener('pointermove',e=>{if(e.pointerId!==attackPointerId)return;const v=joyVector(attackJoy,e.clientX,e.clientY,0);attackDragAmount=Math.max(attackDragAmount,v.amount);setKnob(attackKnob,v.dx,v.dy);if(v.amount>=.08){const a=norm(v.nx,v.ny,lastMobileAim.x,lastMobileAim.y);attackX=a.x;attackY=a.y;lastMobileAim=a;sendAim(a)}});function releaseAttack(e){if(e.pointerId!==attackPointerId)return;const manual=attackDragAmount>=.2,a=manual?{x:attackX,y:attackY}:lastMobileAim;attackPointerId=null;attackDragging=false;attackDragAmount=0;setKnob(attackKnob,0,0);castPrimary(a,!manual)}attackJoy.addEventListener('pointerup',releaseAttack);attackJoy.addEventListener('pointercancel',e=>{if(e.pointerId!==attackPointerId)return;attackPointerId=null;attackDragging=false;attackDragAmount=0;setKnob(attackKnob,0,0)});chainBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();const manual=attackDragging&&attackDragAmount>=.2;castChain(manual?{x:attackX,y:attackY}:lastMobileAim,!manual)});
setInterval(()=>{if(serverFull)return;let x=0,y=0;if(keys.has('a')||keys.has('arrowleft'))x--;if(keys.has('d')||keys.has('arrowright'))x++;if(keys.has('w')||keys.has('arrowup'))y--;if(keys.has('s')||keys.has('arrowdown'))y++;if(Math.abs(moveX)>.01||Math.abs(moveY)>.01){x=moveX;y=moveY}const l=Math.hypot(x,y);if(l>1){x/=l;y/=l}if(Math.abs(x-lastInputX)>.01||Math.abs(y-lastInputY)>.01){socket.emit('input',{x,y});lastInputX=x;lastInputY=y}if(mouseAimActive){const a=mouseAim();if(a)sendAim(a)}},40);setInterval(()=>{if(selectedAvatar!=='mage')return;const r=Math.max(0,cooldownUntil.chain-performance.now());if(r>0){chainBtn.classList.add('cooling');chainBtn.innerHTML='⚡<br>'+(r/1000).toFixed(1);chainStateEl.textContent=(r/1000).toFixed(1)+'초'}else{chainBtn.classList.remove('cooling');chainBtn.innerHTML='⚡<br>체인';chainStateEl.textContent='체인 라이트닝'}},120);
function visible(x,y,m,cx,cy){return x>cx-m&&x<cx+innerWidth+m&&y>cy-m&&y<cy+innerHeight+m}function hashRand(n){const v=Math.sin(n*12.9898)*43758.5453;return v-Math.floor(v)}
const forestTrees=[],forestFlowers=[];(function(){const z={x:2600,y:1700,radius:470};for(let i=0;i<130;i++){const x=90+hashRand(i+1)*5020,y=90+hashRand(i+701)*3220,dx=x-z.x,dy=y-z.y;if(dx*dx+dy*dy<(z.radius+120)*(z.radius+120))continue;forestTrees.push({x,y,s:22+hashRand(i+1401)*22})}if(!lowPower)for(let i=0;i<90;i++){const x=hashRand(i+2701)*5200,y=hashRand(i+3301)*3400,dx=x-z.x,dy=y-z.y;if(dx*dx+dy*dy>(z.radius+30)*(z.radius+30))forestFlowers.push({x,y,c:i%4})}})();
function drawPortal(p,cx,cy){if(!p||!visible(p.x,p.y,140,cx,cy))return;const x=p.x-cx,y=p.y-cy,t=performance.now()/650;ctx.beginPath();ctx.arc(x,y,42+Math.sin(t)*4,0,Math.PI*2);ctx.strokeStyle='#9b82ff';ctx.lineWidth=6;ctx.stroke();ctx.beginPath();ctx.arc(x,y,25,0,Math.PI*2);ctx.fillStyle='rgba(130,100,255,.32)';ctx.fill();ctx.fillStyle='#fff';ctx.font='800 12px system-ui';ctx.textAlign='center';ctx.fillText(p.label||'포탈',x,y-55)}
function drawForest(cx,cy){ctx.fillStyle='#3d6b34';ctx.fillRect(0,0,innerWidth,innerHeight);const z=forestSafeZone,x=z.x-cx,y=z.y-cy;ctx.beginPath();ctx.arc(x,y,z.radius,0,Math.PI*2);ctx.fillStyle='rgba(125,196,104,.26)';ctx.fill();ctx.strokeStyle='rgba(180,255,165,.8)';ctx.lineWidth=5;ctx.stroke();for(let i=0;i<forestTrees.length;i++){if(lowPower&&i%2)continue;const tr=forestTrees[i];if(!visible(tr.x,tr.y,70,cx,cy))continue;const sx=tr.x-cx,sy=tr.y-cy,s=tr.s;ctx.fillStyle='#694526';ctx.fillRect(sx-s*.1,sy,s*.2,s*.72);ctx.beginPath();ctx.arc(sx,sy-6,s,0,Math.PI*2);ctx.fillStyle='#287a3e';ctx.fill()}for(const f of forestFlowers){if(!visible(f.x,f.y,8,cx,cy))continue;ctx.beginPath();ctx.arc(f.x-cx,f.y-cy,2,0,Math.PI*2);ctx.fillStyle=['#ffe082','#ff9e9e','#c9a3ff','#9ee7ff'][f.c];ctx.fill()}for(const p of currentPortals)drawPortal(p,cx,cy)}
function house(x,y,w,h,cx,cy,roof){if(!visible(x,y,170,cx,cy))return;const sx=x-cx,sy=y-cy;ctx.fillStyle='#ead6aa';ctx.fillRect(sx-w/2,sy-h/2,w,h);ctx.beginPath();ctx.moveTo(sx-w/2-12,sy-h/2+4);ctx.lineTo(sx,sy-h/2-48);ctx.lineTo(sx+w/2+12,sy-h/2+4);ctx.closePath();ctx.fillStyle=roof;ctx.fill();ctx.fillStyle='#7b4f2b';ctx.fillRect(sx-16,sy+h/2-48,32,48)}function drawVillage(cx,cy){ctx.fillStyle='#c9b98b';ctx.fillRect(0,0,innerWidth,innerHeight);const hs=[[520,430,250,170,'#994c45'],[1000,340,260,180,'#7d5144'],[1590,350,250,170,'#995d3f'],[2100,470,270,185,'#81505d'],[470,1320,260,180,'#84543e'],[1030,1460,250,170,'#9a5548'],[1620,1470,260,180,'#7d5144'],[2140,1310,250,170,'#995d3f']];for(const h of hs)house(h[0],h[1],h[2],h[3],cx,cy,h[4]);ctx.fillStyle='#fff';ctx.font='900 21px system-ui';ctx.textAlign='center';ctx.fillText('마을 · 전체 안전지대 · HP 회복',1300-cx,805-cy);for(const p of currentPortals)drawPortal(p,cx,cy)}function drawArena(cx,cy){ctx.fillStyle='#61564e';ctx.fillRect(0,0,innerWidth,innerHeight);ctx.fillStyle='#786b60';ctx.fillRect(180-cx,180-cy,world.width-360,world.height-360);ctx.strokeStyle='#d4c19a';ctx.lineWidth=9;ctx.strokeRect(200-cx,200-cy,world.width-400,world.height-400);ctx.fillStyle='#ffe1be';ctx.font='900 24px system-ui';ctx.textAlign='center';ctx.fillText('⚔️ 결투장 · PVP 전용',world.width/2-cx,120-cy);for(const p of currentPortals)drawPortal(p,cx,cy)}
function walkFrame(p){return p.moving?Math.floor(performance.now()/145)%3:1}function directionRow(d){return d==='back'?1:d==='left'?2:d==='right'?3:0}
const MAGE_FRAMES=[[{x:104,y:75,w:236,h:308},{x:376,y:74,w:237,h:308},{x:680,y:74,w:236,h:308}],[{x:98,y:417,w:234,h:287},{x:375,y:418,w:230,h:286},{x:679,y:417,w:229,h:287}],[{x:116,y:744,w:222,h:285},{x:387,y:745,w:221,h:284},{x:691,y:744,w:224,h:285}],[{x:152,y:1071,w:212,h:279},{x:419,y:1069,w:214,h:282},{x:722,y:1070,w:217,h:279}]];
const PIRATE_FRAMES=[[{x:74,y:29,w:249,h:319,anchorX:107},{x:422,y:30,w:229,h:311,anchorX:121},{x:761,y:30,w:230,h:318,anchorX:144}],[{x:91,y:384,w:245,h:326,anchorX:90},{x:431,y:384,w:225,h:318,anchorX:112},{x:772,y:384,w:235,h:326,anchorX:133}],[{x:45,y:738,w:293,h:312,anchorX:136},{x:418,y:738,w:236,h:316,anchorX:125},{x:755,y:738,w:273,h:312,anchorX:150}],[{x:67,y:1092,w:270,h:312,anchorX:114},{x:427,y:1092,w:227,h:317,anchorX:116},{x:751,y:1092,w:266,h:313,anchorX:154}]];
function drawCharacter(p,x,y,isMe){if(!p.alive)return;const row=directionRow(p.direction),col=walkFrame(p),foot=30;ctx.save();ctx.translate(Math.round(x),Math.round(y));if(p.avatar==='pirate'){const f=PIRATE_FRAMES[row][col],s=.39;if(pirateReady)ctx.drawImage(pirateImage,f.x,f.y,f.w,f.h,-f.anchorX*s,foot-f.h*s,f.w*s,f.h*s)}else{const f=MAGE_FRAMES[row][col],s=.43,w=f.w*s,h=f.h*s;if(mageReady)ctx.drawImage(mageImage,f.x,f.y,f.w,f.h,-w/2,foot-h,w,h)}ctx.restore();const hp=Math.max(0,p.hp/p.maxHp);ctx.fillStyle='#151515';ctx.fillRect(x-30,y-100,60,6);ctx.fillStyle=hp>.45?'#70e27d':'#ff6565';ctx.fillRect(x-29,y-99,58*hp,4);ctx.fillStyle=isMe?'#ffe082':'#fff';ctx.font='700 11px system-ui';ctx.textAlign='center';ctx.fillText(isMe?'YOU':'P-'+p.id.slice(0,4),x,y-76)}
function drawSlime(s,cx,cy){if(!s.alive)return;const v=visual(slimeVisuals,s,false),x=v.x-cx,y=v.y-cy,r=s.boss?78:s.elite?34:24,b=Math.sin(performance.now()/190+s.id)*(s.boss?3:2);ctx.beginPath();ctx.ellipse(x,y+b,r,r*.78,0,0,Math.PI*2);ctx.fillStyle=s.boss?'#b32641':s.elite?'#774dd0':'#58c96f';ctx.fill();ctx.fillStyle='#151719';ctx.beginPath();ctx.arc(x-r*.3,y+b-4,s.boss?7:3,0,Math.PI*2);ctx.arc(x+r*.3,y+b-4,s.boss?7:3,0,Math.PI*2);ctx.fill();if(s.aggro){ctx.beginPath();ctx.arc(x,y,r+10,0,Math.PI*2);ctx.strokeStyle='rgba(255,80,70,.65)';ctx.lineWidth=2;ctx.stroke()}const bw=s.boss?170:s.elite?64:44,hp=Math.max(0,s.hp/s.maxHp),hy=y-r-(s.boss?34:18);ctx.fillStyle='#222';ctx.fillRect(x-bw/2,hy,bw,6);ctx.fillStyle=s.boss?'#ff334f':s.elite?'#e5b84d':'#ef6666';ctx.fillRect(x-bw/2+1,hy+1,(bw-2)*hp,4);if(s.boss){ctx.fillStyle='#ffd6db';ctx.font='900 14px system-ui';ctx.textAlign='center';ctx.fillText('👑 BOSS SLIME',x,hy-8)}}
function drawSoulFire(f,cx,cy){const age=Math.min(.12,(performance.now()-stateReceivedAt)/1000),x=f.x+f.vx*age-cx,y=f.y+f.vy*age-cy;ctx.beginPath();ctx.arc(x,y,lowPower?10:13,0,Math.PI*2);ctx.fillStyle='#39e7f1';ctx.fill();if(!lowPower){ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle='#d2ffff';ctx.fill()}}
function drawEffect(e,cx,cy){const elapsed=(performance.now()-e.started)/1000,life=e.life||.25,a=Math.max(0,1-elapsed/life);if(a<=0)return false;if(e.type==='slash'){ctx.save();ctx.translate(e.x-cx,e.y-cy);ctx.rotate(e.angle);ctx.beginPath();ctx.arc(0,0,110,-.7,.7);ctx.strokeStyle='rgba(255,225,140,'+a+')';ctx.lineWidth=lowPower?7:11;ctx.stroke();ctx.restore()}else if(e.type==='chain'){ctx.save();ctx.strokeStyle='rgba(185,255,255,'+a+')';ctx.lineWidth=lowPower?3:5;for(const s of e.segments||[]){const x1=s.x1-cx,y1=s.y1-cy,x2=s.x2-cx,y2=s.y2-cy,mx=(x1+x2)/2+Math.sin((e.id+s.x2)*.13)*10,my=(y1+y2)/2+Math.cos((e.id+s.y2)*.13)*10;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(mx,my);ctx.lineTo(x2,y2);ctx.stroke()}ctx.restore()}else if(e.type==='monsterHit'){ctx.beginPath();ctx.arc(e.x2-cx,e.y2-cy,25,0,Math.PI*2);ctx.strokeStyle='rgba(255,90,70,'+a+')';ctx.lineWidth=4;ctx.stroke()}return true}
function bossDir(dx,dy){const d=(Math.atan2(dy,dx)*180/Math.PI+360)%360;return d<22.5||d>=337.5?'→':d<67.5?'↘':d<112.5?'↓':d<157.5?'↙':d<202.5?'←':d<247.5?'↖':d<292.5?'↑':'↗'}function updateBossLocator(){if(currentMap!=='forest'){bossLocatorEl.style.display='none';return}const b=getBoss(),me=getMe();if(!b){bossLocatorEl.style.display='none';return}bossLocatorEl.style.display='block';const bv=slimeVisuals.get(b.id)||b,mv=me?(playerVisuals.get(me.id)||me):null;if(!mv){bossLocatorEl.textContent='👑 BOSS';return}const dx=bv.x-mv.x,dy=bv.y-mv.y;bossLocatorEl.textContent='👑 BOSS '+bossDir(dx,dy)+' · 거리 '+Math.round(Math.hypot(dx,dy))}
function drawAttackPreview(){if(!attackDragging)return;const me=getMe();if(!me||!me.alive)return;const v=playerVisuals.get(me.id)||me,x=v.x-cameraX,y=v.y-cameraY,a={x:attackX,y:attackY};if(selectedAvatar==='mage'){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+a.x*430,y+a.y*430);ctx.strokeStyle='rgba(95,250,255,.65)';ctx.lineWidth=4;ctx.stroke()}else{ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(a.y,a.x));ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,slashRange,-slashHalfAngle,slashHalfAngle);ctx.closePath();ctx.fillStyle='rgba(255,177,55,.15)';ctx.fill();ctx.restore()}}
function nearestClientPortal(){const me=getMe();if(!me||!me.alive)return null;let best=null,d0=Infinity;for(const p of currentPortals){const d=Math.hypot(me.x-p.x,me.y-p.y);if(d<=145&&d<d0){d0=d;best=p}}return best}function updatePortalUi(){const p=nearestClientPortal(),near=!!p;portalPrompt.style.display=near?'block':'none';portalPrompt.textContent=near?'F · '+(p.label||'포탈')+' 사용':'';if(coarse){portalBtn.style.display=near?'block':'none';portalBtn.textContent=near?(p.label||'포탈')+' 이동':'포탈 이동'}}
function render(){requestAnimationFrame(render);const me=getMe();let meVis=null;if(me)meVis=visual(playerVisuals,me,true);if(meVis){cameraX=cClamp(meVis.x-innerWidth/2,0,Math.max(0,world.width-innerWidth));cameraY=cClamp(meVis.y-innerHeight/2,0,Math.max(0,world.height-innerHeight))}else{cameraX=0;cameraY=0}if(currentMap==='village')drawVillage(cameraX,cameraY);else if(currentMap==='arena')drawArena(cameraX,cameraY);else drawForest(cameraX,cameraY);for(const s of slimes){const v=slimeVisuals.get(s.id)||s;if(visible(v.x,v.y,140,cameraX,cameraY))drawSlime(s,cameraX,cameraY)}for(const f of soulFires)drawSoulFire(f,cameraX,cameraY);const ordered=[...players].sort((a,b)=>a.y-b.y);for(const p of ordered){const v=p.id===myId&&meVis?meVis:visual(playerVisuals,p,false);if(visible(v.x,v.y,150,cameraX,cameraY))drawCharacter(p,v.x-cameraX,v.y-cameraY,p.id===myId)}const alive=[];for(const e of effects)if(drawEffect(e,cameraX,cameraY))alive.push(e);effects=alive;drawAttackPreview();updateBossLocator();updatePortalUi()}render();
</script></body></html>`);
});

server.listen(PORT, () => {
  console.log('Forest RPG running on port ' + PORT);
  console.log('Optimized: physics ' + PHYSICS_RATE + 'Hz / network ' + NETWORK_RATE + 'Hz / AI ' + MONSTER_AI_RATE + 'Hz');
  console.log('Spatial grid: ' + GRID_SIZE + 'px / view: ' + VIEW_RADIUS + 'px / active AI: ' + MONSTER_ACTIVE_RADIUS + 'px');
  console.log('Slimes: ' + NORMAL_SLIMES + ' normal + ' + ELITE_SLIMES + ' elite');
});

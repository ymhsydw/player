const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const MAPS = {
  forest: {
    id: 'forest',
    name: '숲',
    width: 5200,
    height: 3400,
    safeAll: false,
    safeZone: { x: 2600, y: 1700, radius: 470 },
    portal: { x: 2600, y: 1700, radius: 82, target: 'village', targetX: 1300, targetY: 1160 }
  },
  village: {
    id: 'village',
    name: '마을',
    width: 2600,
    height: 1900,
    safeAll: true,
    safeZone: null,
    portal: { x: 1300, y: 950, radius: 82, target: 'forest', targetX: 2600, targetY: 1940 }
  }
};

const MAX_PLAYERS = 20;
const PLAYER_SPEED = 300;
const PLAYER_RADIUS = 24;
const PLAYER_MAX_HP = 100;
const PLAYER_RESPAWN_MS = 1500;
const TICK_RATE = 30;
const NETWORK_RATE = 15;
const MONSTER_AI_RATE = 10;
const VIEW_RADIUS = 1650;
const AVATARS = ['mage', 'pirate'];

const NORMAL_SLIMES = 150;
const ELITE_SLIMES = 25;
const SLIME_RESPAWN_MS = 5000;
const BOSS_TARGET = 20;
const BOSS_HP = 1200;

const SLIME_AGGRO = 560;
const ELITE_AGGRO = 700;
const BOSS_AGGRO = 920;
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
const slashEffects = new Map();
const chainEffects = new Map();
const monsterAttackEffects = new Map();

let nextSlimeId = 1;
let nextSoulFireId = 1;
let nextSlashId = 1;
let nextChainEffectId = 1;
let nextMonsterAttackEffectId = 1;
let bossProgress = 0;
let bossId = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(x, y, fallbackX = 0, fallbackY = 1) {
  x = Number(x);
  y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: fallbackX, y: fallbackY };
  const len = Math.hypot(x, y);
  if (len < 0.001) return { x: fallbackX, y: fallbackY };
  return { x: x / len, y: y / len };
}

function directionFromVector(x, y, previous = 'front') {
  if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) return previous;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'front' : 'back';
}

function mapSpec(mapId) {
  return MAPS[mapId] || MAPS.forest;
}

function isPointInForestSafeZone(x, y, extra = 0) {
  const z = MAPS.forest.safeZone;
  const dx = x - z.x;
  const dy = y - z.y;
  const r = z.radius + extra;
  return dx * dx + dy * dy <= r * r;
}

function isPlayerSafe(player) {
  if (!player || !player.alive) return true;
  const map = mapSpec(player.map);
  if (map.safeAll) return true;
  if (player.map === 'forest') return isPointInForestSafeZone(player.x, player.y);
  return false;
}

function canPvp(attacker, target) {
  return !!(
    attacker && target &&
    attacker.id !== target.id &&
    attacker.alive && target.alive &&
    attacker.map === target.map &&
    !isPlayerSafe(attacker) && !isPlayerSafe(target)
  );
}

function forestSpawnPoint(margin = 160) {
  for (let tries = 0; tries < 80; tries++) {
    const x = margin + Math.random() * (MAPS.forest.width - margin * 2);
    const y = margin + Math.random() * (MAPS.forest.height - margin * 2);
    if (!isPointInForestSafeZone(x, y, 170)) return { x, y };
  }
  return { x: 500, y: 500 };
}

function playerForestSafeSpawn() {
  const z = MAPS.forest.safeZone;
  return { x: z.x, y: z.y + 220 };
}

function makePlayer(id) {
  const p = playerForestSafeSpawn();
  return {
    id,
    map: 'forest',
    x: p.x,
    y: p.y,
    inputX: 0,
    inputY: 0,
    aimX: 0,
    aimY: 1,
    direction: 'front',
    moving: false,
    avatar: 'mage',
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    alive: true,
    respawnAt: 0,
    lastSoulFireAt: 0,
    lastSlashAt: 0,
    lastChainAt: 0,
    lastPortalAt: 0
  };
}

function monsterStats(slime) {
  if (slime.boss) return { aggro: BOSS_AGGRO, speed: BOSS_CHASE_SPEED, damage: BOSS_DAMAGE, cooldown: BOSS_ATTACK_COOLDOWN };
  if (slime.elite) return { aggro: ELITE_AGGRO, speed: ELITE_CHASE_SPEED, damage: ELITE_DAMAGE, cooldown: ELITE_ATTACK_COOLDOWN };
  return { aggro: SLIME_AGGRO, speed: SLIME_CHASE_SPEED, damage: SLIME_DAMAGE, cooldown: SLIME_ATTACK_COOLDOWN };
}

function chooseSlimeDirection(slime) {
  const angle = Math.random() * Math.PI * 2;
  const speed = slime.boss ? 28 + Math.random() * 16 : slime.elite ? 48 + Math.random() * 26 : 38 + Math.random() * 26;
  slime.vx = Math.cos(angle) * speed;
  slime.vy = Math.sin(angle) * speed;
  slime.changeAt = Date.now() + 900 + Math.random() * 2200;
  slime.targetId = null;
}

function createSlime(elite = false) {
  const p = forestSpawnPoint(170);
  const slime = {
    id: nextSlimeId++, map: 'forest', x: p.x, y: p.y,
    elite, boss: false,
    radius: elite ? 34 : 24,
    maxHp: elite ? 180 : 60,
    hp: elite ? 180 : 60,
    vx: 0, vy: 0, changeAt: 0,
    alive: true, respawnAt: 0,
    targetId: null, lastAttackAt: 0
  };
  chooseSlimeDirection(slime);
  slimes.set(slime.id, slime);
}

for (let i = 0; i < NORMAL_SLIMES; i++) createSlime(false);
for (let i = 0; i < ELITE_SLIMES; i++) createSlime(true);

function createBossSlime() {
  if (bossId !== null) return;
  const p = forestSpawnPoint(500);
  const boss = {
    id: nextSlimeId++, map: 'forest', x: p.x, y: p.y,
    elite: false, boss: true, radius: 78,
    maxHp: BOSS_HP, hp: BOSS_HP,
    vx: 0, vy: 0, changeAt: 0,
    alive: true, respawnAt: 0,
    targetId: null, lastAttackAt: 0
  };
  chooseSlimeDirection(boss);
  slimes.set(boss.id, boss);
  bossId = boss.id;
  bossProgress = 0;
  io.emit('bossSpawned', { x: boss.x, y: boss.y, map: 'forest' });
}

function respawnSlime(slime) {
  if (slime.boss) return;
  const p = forestSpawnPoint(170);
  slime.x = p.x;
  slime.y = p.y;
  slime.hp = slime.maxHp;
  slime.alive = true;
  slime.respawnAt = 0;
  slime.lastAttackAt = 0;
  chooseSlimeDirection(slime);
}

function addBossProgress(slime) {
  if (bossId !== null) return;
  bossProgress += slime.elite ? 2 : 1;
  if (bossProgress >= BOSS_TARGET) createBossSlime();
}

function killSlime(slime, now) {
  if (!slime.alive) return;
  if (slime.boss) {
    slime.hp = 0;
    slime.alive = false;
    slimes.delete(slime.id);
    bossId = null;
    bossProgress = 0;
    io.emit('bossDefeated');
    return;
  }
  slime.hp = 0;
  slime.alive = false;
  slime.respawnAt = now + SLIME_RESPAWN_MS;
  slime.targetId = null;
  addBossProgress(slime);
}

function socketForPlayer(playerId) {
  return io.sockets.sockets.get(playerId) || null;
}

function respawnPlayer(player) {
  const p = playerForestSafeSpawn();
  player.map = 'forest';
  player.x = p.x;
  player.y = p.y;
  player.hp = player.maxHp;
  player.alive = true;
  player.respawnAt = 0;
  player.inputX = 0;
  player.inputY = 0;
  player.moving = false;
  const socket = socketForPlayer(player.id);
  if (socket) {
    socket.emit('mapChanged', { map: 'forest', mapName: MAPS.forest.name, world: { width: MAPS.forest.width, height: MAPS.forest.height }, portal: MAPS.forest.portal });
    socket.emit('playerRespawned');
  }
}

function defeatPlayer(player, now, sourceType = 'monster') {
  if (!player.alive) return;
  player.hp = 0;
  player.alive = false;
  player.respawnAt = now + PLAYER_RESPAWN_MS;
  player.inputX = 0;
  player.inputY = 0;
  player.moving = false;
  const socket = socketForPlayer(player.id);
  if (socket) socket.emit('playerDefeated', { source: sourceType });
}

function damagePlayer(player, damage, now, sourceType = 'monster') {
  if (!player.alive || isPlayerSafe(player)) return false;
  player.hp = Math.max(0, player.hp - damage);
  if (player.hp <= 0) defeatPlayer(player, now, sourceType);
  return true;
}

function getAttackableTargets(player, maxRange = Infinity) {
  const out = [];
  const maxD2 = maxRange * maxRange;
  if (player.map === 'forest') {
    for (const slime of slimes.values()) {
      if (!slime.alive) continue;
      const dx = slime.x - player.x;
      const dy = slime.y - player.y;
      if (dx * dx + dy * dy <= maxD2) out.push({ key: 's:' + slime.id, type: 'slime', id: slime.id, x: slime.x, y: slime.y, radius: slime.radius, ref: slime });
    }
  }
  for (const other of players.values()) {
    if (!canPvp(player, other)) continue;
    const dx = other.x - player.x;
    const dy = other.y - player.y;
    if (dx * dx + dy * dy <= maxD2) out.push({ key: 'p:' + other.id, type: 'player', id: other.id, x: other.x, y: other.y, radius: PLAYER_RADIUS, ref: other });
  }
  return out;
}

function findNearestAttackableTarget(player, maxRange = Infinity) {
  let best = null;
  let bestD2 = maxRange * maxRange;
  for (const target of getAttackableTargets(player, maxRange)) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = target;
    }
  }
  return best;
}

function resolveAim(player, aimData, autoAim, autoAimRange = Infinity) {
  if (autoAim) {
    const target = findNearestAttackableTarget(player, autoAimRange);
    if (target) return normalize(target.x - player.x, target.y - player.y, player.aimX, player.aimY);
  }
  if (aimData) {
    const a = normalize(aimData.x, aimData.y, player.aimX, player.aimY);
    player.aimX = a.x;
    player.aimY = a.y;
    return a;
  }
  return normalize(player.aimX, player.aimY, 0, 1);
}

function skillBlockReason(player, lastAt, cooldown) {
  if (!player.alive) return 'dead';
  if (isPlayerSafe(player)) return 'safe';
  if (Date.now() - lastAt < cooldown) return 'cooldown';
  return null;
}

function castSoulFire(player, aimData, autoAim = false) {
  const blocked = player.avatar !== 'mage' ? 'avatar' : skillBlockReason(player, player.lastSoulFireAt, SOUL_FIRE_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(player, aimData, autoAim);
  player.lastSoulFireAt = now;
  player.aimX = aim.x;
  player.aimY = aim.y;
  const id = nextSoulFireId++;
  soulFires.set(id, { id, ownerId: player.id, map: player.map, x: player.x + aim.x * 43, y: player.y + aim.y * 43, vx: aim.x * SOUL_FIRE_SPEED, vy: aim.y * SOUL_FIRE_SPEED, radius: SOUL_FIRE_RADIUS, life: SOUL_FIRE_LIFE });
  return { success: true };
}

function applyCombatDamage(target, amount, owner, now) {
  if (target.type === 'slime') {
    if (!target.ref.alive) return false;
    target.ref.hp -= amount;
    if (target.ref.hp <= 0) killSlime(target.ref, now);
    return true;
  }
  if (target.type === 'player') {
    if (!canPvp(owner, target.ref)) return false;
    return damagePlayer(target.ref, amount, now, 'pvp');
  }
  return false;
}

function castSlash(player, aimData, autoAim = false) {
  const blocked = player.avatar !== 'pirate' ? 'avatar' : skillBlockReason(player, player.lastSlashAt, SLASH_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(player, aimData, autoAim, SLASH_RANGE + 260);
  player.lastSlashAt = now;
  player.aimX = aim.x;
  player.aimY = aim.y;
  const id = nextSlashId++;
  slashEffects.set(id, { id, ownerId: player.id, map: player.map, x: player.x, y: player.y, angle: Math.atan2(aim.y, aim.x), life: SLASH_EFFECT_LIFE });
  const minDot = Math.cos(SLASH_HALF_ANGLE);
  for (const target of getAttackableTargets(player, SLASH_RANGE + 90)) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SLASH_RANGE + target.radius) continue;
    if (dist > 25) {
      const dot = (dx / dist) * aim.x + (dy / dist) * aim.y;
      if (dot < minDot) continue;
    }
    applyCombatDamage(target, SLASH_DAMAGE, player, now);
  }
  return { success: true };
}

function findInitialChainTarget(player, aim, autoAim) {
  if (autoAim) return findNearestAttackableTarget(player, CHAIN_CAST_RANGE);
  let best = null;
  let bestScore = Infinity;
  for (const target of getAttackableTargets(player, CHAIN_CAST_RANGE)) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) continue;
    const dot = (dx / dist) * aim.x + (dy / dist) * aim.y;
    if (dot < CHAIN_AIM_DOT) continue;
    const score = dist + (1 - dot) * 420;
    if (score < bestScore) {
      bestScore = score;
      best = target;
    }
  }
  return best;
}

function findNextChainTarget(owner, x, y, hitKeys) {
  let best = null;
  let bestD2 = CHAIN_RADIUS * CHAIN_RADIUS;
  for (const target of getAttackableTargets(owner, Infinity)) {
    if (hitKeys.has(target.key)) continue;
    const dx = target.x - x;
    const dy = target.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = target;
    }
  }
  return best;
}

function castChainLightning(player, aimData, autoAim = false) {
  const blocked = player.avatar !== 'mage' ? 'avatar' : skillBlockReason(player, player.lastChainAt, CHAIN_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(player, aimData, autoAim, CHAIN_CAST_RANGE);
  const first = findInitialChainTarget(player, aim, autoAim);
  if (!first) return { success: false, reason: 'noTarget' };
  player.lastChainAt = now;
  player.aimX = aim.x;
  player.aimY = aim.y;
  const hitKeys = new Set();
  const segments = [];
  let current = first;
  let fromX = player.x;
  let fromY = player.y;
  for (let index = 0; index < CHAIN_MAX_TARGETS && current; index++) {
    hitKeys.add(current.key);
    const currentX = current.x;
    const currentY = current.y;
    segments.push({ x1: fromX, y1: fromY, x2: currentX, y2: currentY });
    const damage = Math.max(1, Math.round(CHAIN_DAMAGE * (1 - index * 0.10)));
    applyCombatDamage(current, damage, player, now);
    if (index >= CHAIN_MAX_TARGETS - 1) break;
    const next = findNextChainTarget(player, currentX, currentY, hitKeys);
    fromX = currentX;
    fromY = currentY;
    current = next;
  }
  const effectId = nextChainEffectId++;
  chainEffects.set(effectId, { id: effectId, map: player.map, segments, life: CHAIN_EFFECT_LIFE });
  return { success: true };
}

function nearestAggroPlayer(slime) {
  const stats = monsterStats(slime);
  let best = null;
  let bestD2 = stats.aggro * stats.aggro;
  for (const player of players.values()) {
    if (!player.alive || player.map !== 'forest' || isPlayerSafe(player)) continue;
    const dx = player.x - slime.x;
    const dy = player.y - slime.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = player;
    }
  }
  return best;
}

function steerAwayFromSafeZone(slime, vx, vy, speed) {
  const z = MAPS.forest.safeZone;
  const dx = slime.x - z.x;
  const dy = slime.y - z.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const dangerRadius = z.radius + slime.radius + 90;
  if (dist > dangerRadius) return { vx, vy };
  const inward = vx * (-dx / dist) + vy * (-dy / dist);
  if (inward <= 0) return { vx, vy };
  const side = ((slime.id % 2) * 2 - 1);
  const tangentX = (-dy / dist) * side;
  const tangentY = (dx / dist) * side;
  const outwardX = dx / dist;
  const outwardY = dy / dist;
  const n = normalize(tangentX * 0.86 + outwardX * 0.5, tangentY * 0.86 + outwardY * 0.5, outwardX, outwardY);
  return { vx: n.x * speed, vy: n.y * speed };
}

function updateMonsterAI(now) {
  for (const slime of slimes.values()) {
    if (!slime.alive) continue;
    const stats = monsterStats(slime);
    const target = nearestAggroPlayer(slime);
    if (!target) {
      if (now >= slime.changeAt || slime.targetId !== null) chooseSlimeDirection(slime);
      continue;
    }
    slime.targetId = target.id;
    const dx = target.x - slime.x;
    const dy = target.y - slime.y;
    const dist = Math.max(0.001, Math.hypot(dx, dy));
    const attackRange = slime.radius + PLAYER_RADIUS + (slime.boss ? 26 : slime.elite ? 18 : 12);
    if (dist <= attackRange) {
      slime.vx = 0;
      slime.vy = 0;
      if (now - slime.lastAttackAt >= stats.cooldown) {
        slime.lastAttackAt = now;
        if (damagePlayer(target, stats.damage, now, 'monster')) {
          const effectId = nextMonsterAttackEffectId++;
          monsterAttackEffects.set(effectId, { id: effectId, map: 'forest', x1: slime.x, y1: slime.y, x2: target.x, y2: target.y, life: 0.22 });
        }
      }
      continue;
    }
    const a = normalize(dx, dy);
    const avoided = steerAwayFromSafeZone(slime, a.x * stats.speed, a.y * stats.speed, stats.speed);
    slime.vx = avoided.vx;
    slime.vy = avoided.vy;
    slime.changeAt = now + 400;
  }
}

function constrainSlimeOutsideSafeZone(slime) {
  const z = MAPS.forest.safeZone;
  const dx = slime.x - z.x;
  const dy = slime.y - z.y;
  const dist = Math.max(0.001, Math.hypot(dx, dy));
  const minDist = z.radius + slime.radius + 8;
  if (dist < minDist) {
    const nx = dx / dist;
    const ny = dy / dist;
    slime.x = z.x + nx * minDist;
    slime.y = z.y + ny * minDist;
    const speed = Math.max(45, Math.hypot(slime.vx, slime.vy));
    const tangent = (slime.id % 2) ? 1 : -1;
    slime.vx = (-ny * tangent + nx * 0.35) * speed;
    slime.vy = (nx * tangent + ny * 0.35) * speed;
    slime.targetId = null;
  }
}

function usePortal(player) {
  if (!player.alive) return;
  const now = Date.now();
  if (now - player.lastPortalAt < PORTAL_COOLDOWN) return;
  const currentMap = mapSpec(player.map);
  const portal = currentMap.portal;
  const dx = player.x - portal.x;
  const dy = player.y - portal.y;
  if (Math.hypot(dx, dy) > PORTAL_USE_RANGE) return;
  const targetMap = mapSpec(portal.target);
  player.lastPortalAt = now;
  player.map = portal.target;
  player.x = portal.targetX;
  player.y = portal.targetY;
  player.inputX = 0;
  player.inputY = 0;
  player.moving = false;
  const socket = socketForPlayer(player.id);
  if (socket) socket.emit('mapChanged', { map: player.map, mapName: targetMap.name, world: { width: targetMap.width, height: targetMap.height }, portal: targetMap.portal });
}

function serializePlayer(p) {
  return { id: p.id, map: p.map, x: p.x, y: p.y, direction: p.direction, moving: p.moving, avatar: p.avatar, hp: p.hp, maxHp: p.maxHp, alive: p.alive };
}

function withinView(viewer, x, y, radius = VIEW_RADIUS) {
  const dx = x - viewer.x;
  const dy = y - viewer.y;
  return dx * dx + dy * dy <= radius * radius;
}

function stateForPlayer(viewer) {
  const currentMap = mapSpec(viewer.map);
  const visiblePlayers = [];
  for (const p of players.values()) if (p.map === viewer.map) visiblePlayers.push(serializePlayer(p));
  const visibleSlimes = [];
  if (viewer.map === 'forest') {
    for (const s of slimes.values()) {
      if (s.boss || withinView(viewer, s.x, s.y)) visibleSlimes.push({ id: s.id, x: s.x, y: s.y, elite: s.elite, boss: s.boss, hp: s.hp, maxHp: s.maxHp, alive: s.alive, aggro: s.targetId !== null });
    }
  }
  const visibleSoulFires = [];
  for (const f of soulFires.values()) if (f.map === viewer.map && withinView(viewer, f.x, f.y, VIEW_RADIUS + 300)) visibleSoulFires.push({ id: f.id, x: f.x, y: f.y });
  const visibleSlashEffects = [];
  for (const e of slashEffects.values()) if (e.map === viewer.map && withinView(viewer, e.x, e.y, VIEW_RADIUS + 200)) visibleSlashEffects.push({ id: e.id, x: e.x, y: e.y, angle: e.angle, life: e.life });
  const visibleChainEffects = [];
  for (const e of chainEffects.values()) {
    if (e.map !== viewer.map) continue;
    const near = e.segments.some(seg => withinView(viewer, seg.x1, seg.y1, VIEW_RADIUS + 250) || withinView(viewer, seg.x2, seg.y2, VIEW_RADIUS + 250));
    if (near) visibleChainEffects.push({ id: e.id, segments: e.segments, life: e.life });
  }
  const visibleMonsterAttackEffects = [];
  for (const e of monsterAttackEffects.values()) if (e.map === viewer.map && (withinView(viewer, e.x1, e.y1, VIEW_RADIUS + 200) || withinView(viewer, e.x2, e.y2, VIEW_RADIUS + 200))) visibleMonsterAttackEffects.push({ id: e.id, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, life: e.life });
  return {
    map: viewer.map,
    mapName: currentMap.name,
    world: { width: currentMap.width, height: currentMap.height },
    safe: isPlayerSafe(viewer),
    portal: currentMap.portal,
    players: visiblePlayers,
    slimes: visibleSlimes,
    soulFires: visibleSoulFires,
    slashEffects: visibleSlashEffects,
    chainEffects: visibleChainEffects,
    monsterAttackEffects: visibleMonsterAttackEffects,
    bossProgress,
    bossTarget: BOSS_TARGET,
    bossActive: bossId !== null
  };
}

io.on('connection', socket => {
  if (players.size >= MAX_PLAYERS) {
    socket.emit('serverFull', { maxPlayers: MAX_PLAYERS });
    setTimeout(() => socket.disconnect(true), 400);
    return;
  }
  const player = makePlayer(socket.id);
  players.set(socket.id, player);
  socket.emit('welcome', {
    id: socket.id,
    map: player.map,
    mapName: MAPS[player.map].name,
    world: { width: MAPS[player.map].width, height: MAPS[player.map].height },
    portal: MAPS[player.map].portal,
    safeZone: MAPS.forest.safeZone,
    maxPlayers: MAX_PLAYERS,
    soulFireCooldown: SOUL_FIRE_COOLDOWN,
    slashCooldown: SLASH_COOLDOWN,
    chainCooldown: CHAIN_COOLDOWN,
    slashRange: SLASH_RANGE,
    slashHalfAngle: SLASH_HALF_ANGLE
  });
  io.emit('count', { current: players.size, max: MAX_PLAYERS });

  socket.on('input', (data = {}) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    let x = Number(data.x) || 0;
    let y = Number(data.y) || 0;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    p.inputX = clamp(x, -1, 1);
    p.inputY = clamp(y, -1, 1);
    p.moving = Math.abs(x) > 0.05 || Math.abs(y) > 0.05;
    if (p.moving) p.direction = directionFromVector(x, y, p.direction);
  });

  socket.on('aim', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const a = normalize(data.x, data.y, p.aimX, p.aimY);
    p.aimX = a.x;
    p.aimY = a.y;
  });

  socket.on('setAvatar', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const avatar = String(data.avatar || '');
    if (AVATARS.includes(avatar)) p.avatar = avatar;
  });

  socket.on('usePortal', () => {
    const p = players.get(socket.id);
    if (p) usePortal(p);
  });

  socket.on('castSoulFire', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const result = castSoulFire(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', { success: result.success, reason: result.reason || null, skill: 'soulFire', cooldown: SOUL_FIRE_COOLDOWN });
  });

  socket.on('castSlash', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const result = castSlash(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', { success: result.success, reason: result.reason || null, skill: 'slash', cooldown: SLASH_COOLDOWN });
  });

  socket.on('castChain', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const result = castChainLightning(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', { success: result.success, reason: result.reason || null, skill: 'chain', cooldown: CHAIN_COOLDOWN });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('count', { current: players.size, max: MAX_PLAYERS });
  });
});

setInterval(() => updateMonsterAI(Date.now()), 1000 / MONSTER_AI_RATE);

let lastTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  for (const p of players.values()) {
    if (!p.alive) {
      if (p.respawnAt && now >= p.respawnAt) respawnPlayer(p);
      continue;
    }
    const map = mapSpec(p.map);
    p.x = clamp(p.x + p.inputX * PLAYER_SPEED * dt, PLAYER_RADIUS, map.width - PLAYER_RADIUS);
    p.y = clamp(p.y + p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS, map.height - PLAYER_RADIUS);
  }

  for (const slime of slimes.values()) {
    if (!slime.alive) {
      if (!slime.boss && now >= slime.respawnAt) respawnSlime(slime);
      continue;
    }
    if (slime.targetId === null && now >= slime.changeAt) chooseSlimeDirection(slime);
    slime.x += slime.vx * dt;
    slime.y += slime.vy * dt;
    if (slime.x < slime.radius || slime.x > MAPS.forest.width - slime.radius) {
      slime.vx *= -1;
      slime.x = clamp(slime.x, slime.radius, MAPS.forest.width - slime.radius);
    }
    if (slime.y < slime.radius || slime.y > MAPS.forest.height - slime.radius) {
      slime.vy *= -1;
      slime.y = clamp(slime.y, slime.radius, MAPS.forest.height - slime.radius);
    }
    constrainSlimeOutsideSafeZone(slime);
  }

  for (const fire of [...soulFires.values()]) {
    const owner = players.get(fire.ownerId);
    fire.x += fire.vx * dt;
    fire.y += fire.vy * dt;
    fire.life -= dt;
    const map = mapSpec(fire.map);
    if (fire.life <= 0 || fire.x < -60 || fire.x > map.width + 60 || fire.y < -60 || fire.y > map.height + 60) {
      soulFires.delete(fire.id);
      continue;
    }
    let hitTarget = null;
    let hitD2 = Infinity;
    if (fire.map === 'forest') {
      for (const slime of slimes.values()) {
        if (!slime.alive) continue;
        const dx = slime.x - fire.x;
        const dy = slime.y - fire.y;
        const r = slime.radius + fire.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < hitD2) {
          hitD2 = d2;
          hitTarget = { type: 'slime', ref: slime };
        }
      }
    }
    if (owner) {
      for (const target of players.values()) {
        if (!canPvp(owner, target) || target.map !== fire.map) continue;
        const dx = target.x - fire.x;
        const dy = target.y - fire.y;
        const r = PLAYER_RADIUS + fire.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < hitD2) {
          hitD2 = d2;
          hitTarget = { type: 'player', ref: target };
        }
      }
    }
    if (hitTarget) {
      soulFires.delete(fire.id);
      if (hitTarget.type === 'slime') {
        hitTarget.ref.hp -= SOUL_FIRE_DAMAGE;
        if (hitTarget.ref.hp <= 0) killSlime(hitTarget.ref, now);
      } else if (owner) {
        damagePlayer(hitTarget.ref, SOUL_FIRE_DAMAGE, now, 'pvp');
      }
    }
  }

  for (const effect of [...slashEffects.values()]) {
    effect.life -= dt;
    if (effect.life <= 0) slashEffects.delete(effect.id);
  }
  for (const effect of [...chainEffects.values()]) {
    effect.life -= dt;
    if (effect.life <= 0) chainEffects.delete(effect.id);
  }
  for (const effect of [...monsterAttackEffects.values()]) {
    effect.life -= dt;
    if (effect.life <= 0) monsterAttackEffects.delete(effect.id);
  }
}, 1000 / TICK_RATE);

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
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Forest RPG</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#20391d;font-family:system-ui,sans-serif;touch-action:none}
canvas{display:block;width:100%;height:100%}
#hud{position:fixed;left:12px;top:12px;z-index:20;color:#fff;background:rgba(8,14,8,.78);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:10px 13px;line-height:1.48;font-size:13px;backdrop-filter:blur(6px);pointer-events:none}
#status{font-weight:900}#skillName,#skillState,#chainState{color:#78f5ff;font-weight:900}#hpText{color:#ffb0b0;font-weight:900}#bossProgress{color:#ffb5b5;font-weight:900}#mapName{color:#ffe49b;font-weight:900}
#bossLocator{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;display:none;min-width:270px;padding:9px 14px;color:#fff4c7;background:rgba(112,18,27,.94);border:2px solid rgba(255,90,100,.8);border-radius:12px;text-align:center;font-size:13px;font-weight:900;pointer-events:none}
#zoneStatus{position:fixed;top:12px;right:12px;z-index:50;color:#e1ffe6;background:rgba(18,90,40,.94);border:2px solid rgba(118,255,153,.78);border-radius:12px;padding:9px 13px;font-size:13px;font-weight:900;text-align:center;pointer-events:none}
#zoneStatus.danger{color:#fff0e2;background:rgba(125,35,20,.94);border-color:rgba(255,130,88,.85)}#zoneStatus small{display:block;margin-top:2px;font-size:10px;opacity:.85}
#avatarPanel{position:fixed;right:12px;top:82px;z-index:25;width:205px;color:#fff;background:rgba(8,14,8,.8);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:10px;backdrop-filter:blur(6px)}
#avatarTitle{margin-bottom:8px;font-weight:900}#avatarGrid{display:grid;gap:8px}.avatarBtn{border:2px solid rgba(255,255,255,.13);border-radius:10px;background:rgba(255,255,255,.06);color:#fff;padding:9px;text-align:left;font:inherit;cursor:pointer}.avatarBtn.selected{border-color:#7cf8ff;background:rgba(80,230,255,.12)}.avatarBtn b,.avatarBtn span{display:block}.avatarBtn span{margin-top:2px;font-size:11px;opacity:.82}
.joyZone{position:fixed;bottom:max(22px,env(safe-area-inset-bottom));z-index:35;width:156px;height:156px;border-radius:50%;touch-action:none;user-select:none}#moveJoy{left:22px;border:2px solid rgba(255,255,255,.38);background:rgba(0,0,0,.22)}#attackJoy{right:22px;border:2px solid rgba(93,247,255,.78);background:rgba(10,103,118,.22)}.joyKnob{position:absolute;width:58px;height:58px;left:49px;top:49px;border-radius:50%;pointer-events:none}#moveKnob{background:rgba(255,255,255,.84)}#attackKnob{background:rgba(95,247,255,.88);box-shadow:0 0 18px rgba(67,239,255,.5)}#attackLabel{position:absolute;left:0;right:0;top:12px;text-align:center;color:#d8ffff;font-weight:900;font-size:12px;pointer-events:none}
#chainBtn{position:fixed;right:150px;bottom:max(150px,calc(env(safe-area-inset-bottom) + 150px));z-index:40;width:76px;height:76px;border-radius:50%;border:3px solid #65f4ff;background:rgba(10,94,118,.94);color:#fff;font:900 13px system-ui;box-shadow:0 0 22px rgba(75,239,255,.35);touch-action:none}#chainBtn.cooling{opacity:.55}#chainBtn.hidden{display:none}
#portalPrompt{position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:55;display:none;padding:10px 18px;border-radius:14px;background:rgba(35,25,70,.9);border:2px solid rgba(170,130,255,.9);color:#fff;font-weight:900;pointer-events:none}#portalBtn{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:55;display:none;padding:12px 20px;border-radius:18px;border:2px solid #b691ff;background:rgba(65,40,130,.94);color:#fff;font:900 15px system-ui;touch-action:none}
#mobileHint{position:fixed;right:18px;bottom:max(188px,calc(env(safe-area-inset-bottom) + 188px));z-index:20;color:#fff;background:rgba(0,0,0,.38);padding:6px 9px;border-radius:8px;font-size:11px;pointer-events:none}
#clearMessage{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.42);pointer-events:none}#clearMessage.active{display:flex;animation:clearBg .25s ease-out}#clearBox{text-align:center;animation:clearPop .45s ease-out}#clearTitle{color:#ffe477;font-size:clamp(64px,12vw,150px);font-weight:1000;letter-spacing:8px;text-shadow:0 4px 0 #8b571b,0 8px 25px rgba(0,0,0,.9),0 0 30px rgba(255,220,80,.5)}#clearSub{margin-top:10px;color:#fff;font-size:clamp(18px,3vw,32px);font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.9)}
#deathMessage{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:900;display:none;padding:18px 28px;border-radius:16px;background:rgba(90,10,20,.88);border:2px solid rgba(255,100,110,.9);color:#fff;font-size:24px;font-weight:1000;pointer-events:none}#deathMessage.active{display:block}
@keyframes clearPop{0%{opacity:0;transform:scale(.45)}65%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}@keyframes clearBg{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,.42)}}
@media(pointer:fine){.joyZone,#chainBtn,#mobileHint,#portalBtn{display:none!important}}@media(max-width:700px){#avatarPanel{width:170px}#bossLocator{top:67px;min-width:220px;font-size:11px}#zoneStatus{font-size:11px}#portalPrompt{bottom:205px}}
</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="clearMessage"><div id="clearBox"><div id="clearTitle">CLEAR!</div><div id="clearSub">👑 보스 슬라임 처치 완료</div></div></div>
<div id="deathMessage">쓰러졌습니다</div>
<div id="hud"><div id="status">서버 연결 중...</div><div>접속자: <span id="count">0</span>/<span id="maxCount">20</span>명</div><div>맵: <span id="mapName">숲</span></div><div>HP: <span id="hpText">100 / 100</span></div><div>캐릭터: <span id="currentAvatarName">마법사</span></div><div>E 공격: <span id="skillName">영혼불</span></div><div>Q 스킬: <span id="chainState">체인 라이트닝</span></div><div>상태: <span id="skillState">대기</span></div><div>보스 게이지: <span id="bossProgress">0 / 20</span></div></div>
<div id="bossLocator">👑 BOSS 위치</div><div id="zoneStatus">🛡️ 안전 지대<small>PVP / 몬스터 공격 불가</small></div>
<div id="avatarPanel"><div id="avatarTitle">캐릭터 선택</div><div id="avatarGrid"><button class="avatarBtn selected" data-avatar="mage" type="button"><b>🔮 마법사</b><span>E 영혼불 · Q 체인 라이트닝</span></button><button class="avatarBtn" data-avatar="pirate" type="button"><b>🏴‍☠️ 해적</b><span>E 즉발 슬래시</span></button></div></div>
<div id="moveJoy" class="joyZone"><div id="moveKnob" class="joyKnob"></div></div><div id="attackJoy" class="joyZone"><div id="attackLabel">영혼불</div><div id="attackKnob" class="joyKnob"></div></div><button id="chainBtn" type="button">⚡<br>체인</button><div id="portalPrompt">F · 포탈 사용</div><button id="portalBtn" type="button">포탈 이동</button><div id="mobileHint">왼쪽 이동 · 오른쪽 조준 후 놓아서 공격</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket=io(),canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
const statusEl=document.getElementById('status'),countEl=document.getElementById('count'),maxCountEl=document.getElementById('maxCount'),mapNameEl=document.getElementById('mapName'),hpTextEl=document.getElementById('hpText'),currentAvatarNameEl=document.getElementById('currentAvatarName'),skillNameEl=document.getElementById('skillName'),chainStateEl=document.getElementById('chainState'),skillStateEl=document.getElementById('skillState'),bossProgressEl=document.getElementById('bossProgress'),bossLocatorEl=document.getElementById('bossLocator'),zoneStatusEl=document.getElementById('zoneStatus'),clearMessageEl=document.getElementById('clearMessage'),deathMessageEl=document.getElementById('deathMessage'),avatarButtons=[...document.querySelectorAll('.avatarBtn')],moveJoy=document.getElementById('moveJoy'),moveKnob=document.getElementById('moveKnob'),attackJoy=document.getElementById('attackJoy'),attackKnob=document.getElementById('attackKnob'),attackLabel=document.getElementById('attackLabel'),chainBtn=document.getElementById('chainBtn'),portalPrompt=document.getElementById('portalPrompt'),portalBtn=document.getElementById('portalBtn');
let myId=null,currentMap='forest',currentMapName='숲',world={width:5200,height:3400},currentPortal={x:2600,y:1700,radius:82,target:'village'},forestSafeZone={x:2600,y:1700,radius:470},currentSafe=true,players=[],slimes=[],soulFires=[],slashEffects=[],chainEffects=[],monsterAttackEffects=[],serverFull=false,keys=new Set(),cameraX=0,cameraY=0,mouseX=innerWidth/2,mouseY=innerHeight/2,mouseAimActive=false,selectedAvatar='mage',movePointerId=null,attackPointerId=null,moveX=0,moveY=0,attackX=0,attackY=1,attackDragAmount=0,attackDragging=false,lastMobileAim={x:0,y:1},lastInputX=999,lastInputY=999,lastAimX=999,lastAimY=999,soulFireCooldown=900,slashCooldown=1000,chainCooldown=4500,slashRange=145,slashHalfAngle=Math.PI/3,cooldownUntil={mage:0,pirate:0,chain:0},clearMessageTimer=null,deathTimer=null;
function cClamp(v,min,max){return Math.max(min,Math.min(max,v))}function normalizeClient(x,y,fx,fy){const l=Math.hypot(x,y);return l<.001?{x:fx,y:fy}:{x:x/l,y:y/l}}
function resize(){const m=matchMedia('(pointer:coarse)').matches?1.5:2,d=Math.min(devicePixelRatio||1,m);canvas.width=Math.floor(innerWidth*d);canvas.height=Math.floor(innerHeight*d);canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';ctx.setTransform(d,0,0,d,0,0);ctx.imageSmoothingEnabled=true}addEventListener('resize',resize);resize();
const mageImage=new Image();let mageReady=false;mageImage.onload=()=>{mageReady=true};mageImage.onerror=()=>{statusEl.textContent='mage.png 로드 실패'};mageImage.src='/mage.png?v=70';const pirateImage=new Image();let pirateReady=false;pirateImage.onload=()=>{pirateReady=true};pirateImage.onerror=()=>{statusEl.textContent='pirate.png 로드 실패'};pirateImage.src='/pirate.png?v=70';
socket.on('connect',()=>{if(!serverFull)statusEl.textContent='서버 접속됨'});
socket.on('welcome',d=>{myId=d.id;currentMap=d.map;currentMapName=d.mapName;world=d.world;currentPortal=d.portal;forestSafeZone=d.safeZone;soulFireCooldown=d.soulFireCooldown;slashCooldown=d.slashCooldown;chainCooldown=d.chainCooldown;slashRange=d.slashRange;slashHalfAngle=d.slashHalfAngle;maxCountEl.textContent=d.maxPlayers;mapNameEl.textContent=currentMapName;setAvatar('mage')});
socket.on('mapChanged',d=>{currentMap=d.map;currentMapName=d.mapName;world=d.world;currentPortal=d.portal;players=[];slimes=[];soulFires=[];slashEffects=[];chainEffects=[];monsterAttackEffects=[];mapNameEl.textContent=currentMapName;skillStateEl.textContent=currentMap==='village'?'마을 도착':'숲 도착'});
socket.on('count',d=>{countEl.textContent=d.current;maxCountEl.textContent=d.max});
socket.on('state',d=>{currentMap=d.map||currentMap;currentMapName=d.mapName||currentMapName;world=d.world||world;currentPortal=d.portal||currentPortal;currentSafe=!!d.safe;players=d.players||[];slimes=d.slimes||[];soulFires=d.soulFires||[];slashEffects=d.slashEffects||[];chainEffects=d.chainEffects||[];monsterAttackEffects=d.monsterAttackEffects||[];mapNameEl.textContent=currentMapName;const me=getMe();if(me)hpTextEl.textContent=Math.ceil(me.hp)+' / '+me.maxHp;if(currentMap==='forest'&&d.bossActive)bossProgressEl.textContent='👑 보스 전투중';else bossProgressEl.textContent=d.bossProgress+' / '+d.bossTarget;updateZoneStatus()});
socket.on('bossSpawned',d=>{if(currentMap!=='forest')return;skillStateEl.textContent='👑 보스 슬라임 출현!';bossLocatorEl.style.display='block';bossLocatorEl.textContent='👑 BOSS · X '+Math.round(d.x)+' · Y '+Math.round(d.y)});
socket.on('bossDefeated',()=>{if(currentMap!=='forest')return;skillStateEl.textContent='🏆 보스 처치!';bossLocatorEl.style.display='none';clearMessageEl.classList.remove('active');void clearMessageEl.offsetWidth;clearMessageEl.classList.add('active');if(clearMessageTimer)clearTimeout(clearMessageTimer);clearMessageTimer=setTimeout(()=>{clearMessageEl.classList.remove('active');skillStateEl.textContent='대기'},3000)});
socket.on('playerDefeated',d=>{deathMessageEl.textContent=d.source==='pvp'?'플레이어에게 쓰러졌습니다':'슬라임에게 쓰러졌습니다';deathMessageEl.classList.add('active');if(deathTimer)clearTimeout(deathTimer);deathTimer=setTimeout(()=>deathMessageEl.classList.remove('active'),1300)});socket.on('playerRespawned',()=>{deathMessageEl.classList.remove('active');skillStateEl.textContent='안전지대에서 부활'});
socket.on('serverFull',d=>{serverFull=true;statusEl.textContent='서버가 가득 찼습니다';countEl.textContent=d.maxPlayers;maxCountEl.textContent=d.maxPlayers;socket.io.opts.reconnection=false});socket.on('disconnect',()=>{if(!serverFull)statusEl.textContent='재접속 중...'});
socket.on('skillCastResult',d=>{if(!d.success){if(d.reason==='safe')skillStateEl.textContent='🛡️ 안전지대에서는 공격 불가';else if(d.reason==='noTarget')skillStateEl.textContent='체인 라이트닝 대상 없음';else if(d.reason==='dead')skillStateEl.textContent='부활 대기 중';else skillStateEl.textContent='쿨타임';return}if(d.skill==='soulFire'){cooldownUntil.mage=performance.now()+d.cooldown;skillStateEl.textContent='🩵 영혼불!'}else if(d.skill==='slash'){cooldownUntil.pirate=performance.now()+d.cooldown;skillStateEl.textContent='⚔️ 슬래시!'}else if(d.skill==='chain'){cooldownUntil.chain=performance.now()+d.cooldown;skillStateEl.textContent='⚡ 체인 라이트닝!'}});
function getMe(){return players.find(p=>p.id===myId)||null}function getBoss(){return currentMap==='forest'?(slimes.find(s=>s.boss&&s.alive)||null):null}
function updateZoneStatus(){if(currentSafe){zoneStatusEl.classList.remove('danger');zoneStatusEl.innerHTML='🛡️ 안전 지대<small>PVP / 몬스터 공격 불가</small>'}else{zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML='⚔️ 전투 지역<small>PVP 허용 · 몬스터 공격 가능</small>'}}
function setAvatar(a){selectedAvatar=a;socket.emit('setAvatar',{avatar:a});avatarButtons.forEach(b=>b.classList.toggle('selected',b.dataset.avatar===a));if(a==='mage'){currentAvatarNameEl.textContent='마법사';skillNameEl.textContent='영혼불';chainStateEl.textContent='체인 라이트닝';attackLabel.textContent='영혼불';attackJoy.style.borderColor='rgba(93,247,255,.78)';attackKnob.style.background='rgba(95,247,255,.88)';chainBtn.classList.remove('hidden')}else{currentAvatarNameEl.textContent='해적';skillNameEl.textContent='슬래시';chainStateEl.textContent='-';attackLabel.textContent='슬래시';attackJoy.style.borderColor='rgba(255,196,80,.82)';attackKnob.style.background='rgba(255,181,70,.9)';chainBtn.classList.add('hidden')}}avatarButtons.forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setAvatar(b.dataset.avatar)}));
function getMouseAim(){const me=getMe();if(!me)return null;const dx=cameraX+mouseX-me.x,dy=cameraY+mouseY-me.y,l=Math.hypot(dx,dy);return l<.001?null:{x:dx/l,y:dy/l}}function getAttackAim(){if(mouseAimActive){const a=getMouseAim();if(a)return a}return lastMobileAim}function sendAim(a){if(!a||serverFull)return;if(Math.abs(a.x-lastAimX)>.01||Math.abs(a.y-lastAimY)>.01){socket.emit('aim',a);lastAimX=a.x;lastAimY=a.y}}
function castPrimary(a,auto){if(serverFull)return;if(currentSafe){skillStateEl.textContent='🛡️ 안전지대에서는 공격 불가';return}if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.mage){skillStateEl.textContent='영혼불 쿨타임';return}socket.emit('castSoulFire',{aim:a,autoAim:!!auto})}else{if(performance.now()<cooldownUntil.pirate){skillStateEl.textContent='슬래시 쿨타임';return}socket.emit('castSlash',{aim:a,autoAim:!!auto})}}function castChain(a,auto){if(serverFull||selectedAvatar!=='mage')return;if(currentSafe){skillStateEl.textContent='🛡️ 안전지대에서는 공격 불가';return}if(performance.now()<cooldownUntil.chain){skillStateEl.textContent='체인 라이트닝 쿨타임';return}socket.emit('castChain',{aim:a,autoAim:!!auto})}function tryPortal(){if(!serverFull)socket.emit('usePortal')}
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){keys.add(k);e.preventDefault()}if(k==='e'&&!e.repeat){const a=getMouseAim()||getAttackAim();if(a){sendAim(a);castPrimary(a,false)}e.preventDefault()}if(k==='q'&&selectedAvatar==='mage'&&!e.repeat){const a=getMouseAim()||getAttackAim();if(a){sendAim(a);castChain(a,false)}e.preventDefault()}if(k==='f'&&!e.repeat){tryPortal();e.preventDefault()}});addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'&&e.pointerType!=='pen')return;mouseX=e.clientX;mouseY=e.clientY;mouseAimActive=true;const a=getMouseAim();if(a)sendAim(a)});portalBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();tryPortal()});
function joyVector(el,x,y,dz){const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,m=r.width*.34;let dx=x-cx,dy=y-cy;const raw=Math.hypot(dx,dy);if(raw>m){dx=dx/raw*m;dy=dy/raw*m}const amt=Math.min(1,raw/m);let nx=dx/m,ny=dy/m;if(amt<dz){nx=0;ny=0}return{dx,dy,nx,ny,amount:amt}}function setKnob(k,dx,dy){k.style.transform='translate('+dx+'px,'+dy+'px)'}
moveJoy.addEventListener('pointerdown',e=>{movePointerId=e.pointerId;moveJoy.setPointerCapture(e.pointerId);const v=joyVector(moveJoy,e.clientX,e.clientY,.12);moveX=v.nx;moveY=v.ny;setKnob(moveKnob,v.dx,v.dy)});moveJoy.addEventListener('pointermove',e=>{if(e.pointerId!==movePointerId)return;const v=joyVector(moveJoy,e.clientX,e.clientY,.12);moveX=v.nx;moveY=v.ny;setKnob(moveKnob,v.dx,v.dy)});function releaseMove(e){if(e.pointerId!==movePointerId)return;movePointerId=null;moveX=0;moveY=0;setKnob(moveKnob,0,0)}moveJoy.addEventListener('pointerup',releaseMove);moveJoy.addEventListener('pointercancel',releaseMove);
attackJoy.addEventListener('pointerdown',e=>{attackPointerId=e.pointerId;attackJoy.setPointerCapture(e.pointerId);attackDragging=true;const v=joyVector(attackJoy,e.clientX,e.clientY,0);attackDragAmount=v.amount;setKnob(attackKnob,v.dx,v.dy);if(v.amount>=.08){const a=normalizeClient(v.nx,v.ny,lastMobileAim.x,lastMobileAim.y);attackX=a.x;attackY=a.y;lastMobileAim=a;sendAim(a)}});attackJoy.addEventListener('pointermove',e=>{if(e.pointerId!==attackPointerId)return;const v=joyVector(attackJoy,e.clientX,e.clientY,0);attackDragAmount=Math.max(attackDragAmount,v.amount);setKnob(attackKnob,v.dx,v.dy);if(v.amount>=.08){const a=normalizeClient(v.nx,v.ny,lastMobileAim.x,lastMobileAim.y);attackX=a.x;attackY=a.y;lastMobileAim=a;sendAim(a)}});function releaseAttack(e){if(e.pointerId!==attackPointerId)return;const manual=attackDragAmount>=.20,a=manual?{x:attackX,y:attackY}:lastMobileAim;attackPointerId=null;attackDragging=false;attackDragAmount=0;setKnob(attackKnob,0,0);castPrimary(a,!manual)}attackJoy.addEventListener('pointerup',releaseAttack);attackJoy.addEventListener('pointercancel',e=>{if(e.pointerId!==attackPointerId)return;attackPointerId=null;attackDragging=false;attackDragAmount=0;setKnob(attackKnob,0,0)});chainBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();const manual=attackDragging&&attackDragAmount>=.20,a=manual?{x:attackX,y:attackY}:lastMobileAim;castChain(a,!manual)});
setInterval(()=>{if(serverFull)return;let x=0,y=0;if(keys.has('a')||keys.has('arrowleft'))x--;if(keys.has('d')||keys.has('arrowright'))x++;if(keys.has('w')||keys.has('arrowup'))y--;if(keys.has('s')||keys.has('arrowdown'))y++;if(Math.abs(moveX)>.01||Math.abs(moveY)>.01){x=moveX;y=moveY}const l=Math.hypot(x,y);if(l>1){x/=l;y/=l}if(Math.abs(x-lastInputX)>.01||Math.abs(y-lastInputY)>.01){socket.emit('input',{x,y});lastInputX=x;lastInputY=y}if(mouseAimActive){const a=getMouseAim();if(a)sendAim(a)}},33);setInterval(()=>{if(selectedAvatar!=='mage')return;const r=Math.max(0,cooldownUntil.chain-performance.now());if(r>0){chainBtn.classList.add('cooling');chainBtn.innerHTML='⚡<br>'+(r/1000).toFixed(1);chainStateEl.textContent=(r/1000).toFixed(1)+'초'}else{chainBtn.classList.remove('cooling');chainBtn.innerHTML='⚡<br>체인';chainStateEl.textContent='체인 라이트닝'}},100);
function visible(x,y,m,cx,cy){return x>cx-m&&x<cx+innerWidth+m&&y>cy-m&&y<cy+innerHeight+m}function hashRand(n){const v=Math.sin(n*12.9898)*43758.5453;return v-Math.floor(v)}
function drawPortal(p,cx,cy,label){if(!p||!visible(p.x,p.y,160,cx,cy))return;const x=p.x-cx,y=p.y-cy,t=performance.now()/700;ctx.save();ctx.globalCompositeOperation='lighter';for(let i=0;i<4;i++){const r=34+i*12+Math.sin(t+i)*4;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle='rgba('+(130+i*20)+',105,255,'+(0.65-i*.1)+')';ctx.lineWidth=6-i;ctx.stroke()}ctx.beginPath();ctx.ellipse(x,y+12,40,19,0,0,Math.PI*2);ctx.fillStyle='rgba(145,110,255,.42)';ctx.fill();ctx.restore();ctx.fillStyle='#f4edff';ctx.font='900 13px system-ui';ctx.textAlign='center';ctx.fillText(label,x,y-62)}
function drawForest(cx,cy){ctx.fillStyle='#3d6b34';ctx.fillRect(0,0,innerWidth,innerHeight);const z=forestSafeZone,zx=z.x-cx,zy=z.y-cy;ctx.save();ctx.beginPath();ctx.arc(zx,zy,z.radius,0,Math.PI*2);ctx.fillStyle='rgba(125,196,104,.34)';ctx.fill();ctx.strokeStyle='rgba(180,255,165,.88)';ctx.lineWidth=7;ctx.setLineDash([18,12]);ctx.stroke();ctx.setLineDash([]);ctx.restore();for(let i=0;i<170;i++){const x=90+hashRand(i+1)*(world.width-180),y=90+hashRand(i+701)*(world.height-180),dx=x-z.x,dy=y-z.y;if(dx*dx+dy*dy<(z.radius+120)*(z.radius+120))continue;const s=22+hashRand(i+1401)*24;if(!visible(x,y,90,cx,cy))continue;const sx=x-cx,sy=y-cy;ctx.beginPath();ctx.ellipse(sx,sy+25,s*.72,s*.25,0,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.2)';ctx.fill();ctx.fillStyle='#694526';ctx.fillRect(sx-s*.12,sy,s*.24,s*.85);ctx.beginPath();ctx.arc(sx,sy-8,s,0,Math.PI*2);ctx.arc(sx-s*.55,sy,s*.58,0,Math.PI*2);ctx.arc(sx+s*.55,sy,s*.58,0,Math.PI*2);ctx.fillStyle='#287a3e';ctx.fill();ctx.beginPath();ctx.arc(sx-s*.25,sy-s*.28,s*.3,0,Math.PI*2);ctx.fillStyle='#47a457';ctx.fill()}for(let i=0;i<160;i++){const x=hashRand(i+2701)*world.width,y=hashRand(i+3301)*world.height,dx=x-z.x,dy=y-z.y;if(dx*dx+dy*dy<(z.radius+30)*(z.radius+30)||!visible(x,y,15,cx,cy))continue;ctx.beginPath();ctx.arc(x-cx,y-cy,2.2,0,Math.PI*2);ctx.fillStyle=['#ffe082','#ff9e9e','#c9a3ff','#9ee7ff'][i%4];ctx.fill()}drawPortal(currentPortal,cx,cy,'마을 포탈')}
function drawHouse(x,y,w,h,cx,cy,roof){if(!visible(x,y,180,cx,cy))return;const sx=x-cx,sy=y-cy;ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(sx-w/2+8,sy+h/2-2,w,18);ctx.fillStyle='#ead6aa';ctx.fillRect(sx-w/2,sy-h/2,w,h);ctx.beginPath();ctx.moveTo(sx-w/2-16,sy-h/2+6);ctx.lineTo(sx,sy-h/2-55);ctx.lineTo(sx+w/2+16,sy-h/2+6);ctx.closePath();ctx.fillStyle=roof;ctx.fill();ctx.fillStyle='#7b4f2b';ctx.fillRect(sx-18,sy+h/2-54,36,54);ctx.fillStyle='#8fd6ef';ctx.fillRect(sx-w/2+24,sy-20,34,30);ctx.fillRect(sx+w/2-58,sy-20,34,30)}
function drawVillage(cx,cy){ctx.fillStyle='#c9b98b';ctx.fillRect(0,0,innerWidth,innerHeight);const x=1300-cx,y=950-cy;ctx.beginPath();ctx.arc(x,y,330,0,Math.PI*2);ctx.fillStyle='#b9ad88';ctx.fill();ctx.beginPath();ctx.arc(x,y,315,0,Math.PI*2);ctx.strokeStyle='rgba(255,246,195,.55)';ctx.lineWidth=5;ctx.stroke();const hs=[[520,430,250,170,'#994c45'],[1000,340,260,180,'#7d5144'],[1590,350,250,170,'#995d3f'],[2100,470,270,185,'#81505d'],[470,1320,260,180,'#84543e'],[1030,1460,250,170,'#9a5548'],[1620,1470,260,180,'#7d5144'],[2140,1310,250,170,'#995d3f']];for(const h of hs)drawHouse(h[0],h[1],h[2],h[3],cx,cy,h[4]);ctx.fillStyle='rgba(255,255,255,.7)';ctx.font='1000 24px system-ui';ctx.textAlign='center';ctx.fillText('마을 · 전체 안전지대',x,y-118);drawPortal(currentPortal,cx,cy,'숲 포탈')}
function walkFrame(p){return p.moving?Math.floor(performance.now()/145)%3:1}function directionRow(d){if(d==='back')return 1;if(d==='left')return 2;if(d==='right')return 3;return 0}
const MAGE_FRAMES=[[{x:104,y:75,w:236,h:308},{x:376,y:74,w:237,h:308},{x:680,y:74,w:236,h:308}],[{x:98,y:417,w:234,h:287},{x:375,y:418,w:230,h:286},{x:679,y:417,w:229,h:287}],[{x:116,y:744,w:222,h:285},{x:387,y:745,w:221,h:284},{x:691,y:744,w:224,h:285}],[{x:152,y:1071,w:212,h:279},{x:419,y:1069,w:214,h:282},{x:722,y:1070,w:217,h:279}]];const PIRATE_FRAMES=[[{x:74,y:29,w:249,h:319,anchorX:107},{x:422,y:30,w:229,h:311,anchorX:121},{x:761,y:30,w:230,h:318,anchorX:144}],[{x:91,y:384,w:245,h:326,anchorX:90},{x:431,y:384,w:225,h:318,anchorX:112},{x:772,y:384,w:235,h:326,anchorX:133}],[{x:45,y:738,w:293,h:312,anchorX:136},{x:418,y:738,w:236,h:316,anchorX:125},{x:755,y:738,w:273,h:312,anchorX:150}],[{x:67,y:1092,w:270,h:312,anchorX:114},{x:427,y:1092,w:227,h:317,anchorX:116},{x:751,y:1092,w:266,h:313,anchorX:154}]];
function drawCharacter(p,sx,sy,isMe){if(!p.alive)return;const row=directionRow(p.direction),col=walkFrame(p),footY=30;ctx.save();ctx.translate(Math.round(sx),Math.round(sy));if(p.avatar==='pirate'){const f=PIRATE_FRAMES[row][col],s=.39;if(pirateReady)ctx.drawImage(pirateImage,f.x,f.y,f.w,f.h,-f.anchorX*s,footY-f.h*s,f.w*s,f.h*s)}else{const f=MAGE_FRAMES[row][col],s=.43;if(mageReady){const w=f.w*s,h=f.h*s;ctx.drawImage(mageImage,f.x,f.y,f.w,f.h,-w/2,footY-h,w,h)}}ctx.restore();const hp=Math.max(0,p.hp/p.maxHp);ctx.fillStyle='rgba(0,0,0,.72)';ctx.fillRect(sx-32,sy-104,64,7);ctx.fillStyle=hp>.45?'#70e27d':'#ff6565';ctx.fillRect(sx-30,sy-102,60*hp,3);ctx.fillStyle='rgba(0,0,0,.42)';ctx.fillRect(sx-34,sy-91,68,18);ctx.fillStyle=isMe?'#ffe082':'#fff';ctx.font='700 12px system-ui';ctx.textAlign='center';ctx.fillText(isMe?'YOU':'P-'+p.id.slice(0,4),sx,sy-78)}
function drawSlime(s,cx,cy){if(!s.alive)return;const x=s.x-cx,y=s.y-cy,r=s.boss?78:s.elite?34:24,b=Math.sin(performance.now()/180+s.id)*(s.boss?4:2.5);ctx.save();ctx.translate(x,y+b);if(s.aggro){ctx.beginPath();ctx.arc(0,0,r+14+Math.sin(performance.now()/100)*3,0,Math.PI*2);ctx.strokeStyle='rgba(255,80,70,.72)';ctx.lineWidth=3;ctx.stroke()}ctx.beginPath();ctx.ellipse(0,r*.72,r*.82,r*.27,0,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.24)';ctx.fill();ctx.beginPath();ctx.moveTo(-r,8);ctx.quadraticCurveTo(-r,-r*.7,0,-r);ctx.quadraticCurveTo(r,-r*.7,r,8);ctx.quadraticCurveTo(0,r*.85,-r,8);ctx.fillStyle=s.boss?'#b32641':s.elite?'#774dd0':'#58c96f';ctx.fill();ctx.fillStyle='#151719';ctx.beginPath();ctx.arc(-r*.3,-4,s.boss?7:3,0,Math.PI*2);ctx.arc(r*.3,-4,s.boss?7:3,0,Math.PI*2);ctx.fill();if(s.elite||s.boss){const cy2=-r-4,z=s.boss?22:13;ctx.fillStyle='#ffd259';ctx.beginPath();ctx.moveTo(-z,cy2);ctx.lineTo(-z*.6,cy2-z);ctx.lineTo(0,cy2-z*.4);ctx.lineTo(z*.6,cy2-z);ctx.lineTo(z,cy2);ctx.closePath();ctx.fill()}ctx.restore();const bw=s.boss?180:s.elite?68:48,hp=Math.max(0,s.hp/s.maxHp),hy=y-r-(s.boss?43:22);ctx.fillStyle='rgba(0,0,0,.72)';ctx.fillRect(x-bw/2,hy,bw,s.boss?13:7);ctx.fillStyle=s.boss?'#ff334f':s.elite?'#e5b84d':'#ef6666';ctx.fillRect(x-bw/2+2,hy+2,(bw-4)*hp,s.boss?9:3);if(s.boss){ctx.fillStyle='#ffd6db';ctx.font='900 16px system-ui';ctx.textAlign='center';ctx.fillText('👑 BOSS SLIME',x,hy-10)}else if(s.elite){ctx.fillStyle='#ffe59a';ctx.font='700 11px system-ui';ctx.textAlign='center';ctx.fillText('ELITE',x,hy-6)}}
function drawSoulFire(f,cx,cy){const x=f.x-cx,y=f.y-cy,t=performance.now()/100,p=Math.sin(t+f.id)*2;ctx.save();ctx.globalCompositeOperation='lighter';ctx.shadowBlur=30;ctx.shadowColor='#49f4ff';ctx.beginPath();ctx.arc(x,y,19+p,0,Math.PI*2);ctx.fillStyle='rgba(40,235,255,.28)';ctx.fill();ctx.beginPath();ctx.arc(x,y,11+p*.35,0,Math.PI*2);ctx.fillStyle='#23dce9';ctx.fill();ctx.beginPath();ctx.arc(x-2,y-2,5.5,0,Math.PI*2);ctx.fillStyle='#d2ffff';ctx.fill();ctx.restore()}
function drawSlash(s,cx,cy){const x=s.x-cx,y=s.y-cy,l=Math.max(0,Math.min(1,s.life/.28)),r=75+(1-l)*55;ctx.save();ctx.translate(x,y);ctx.rotate(s.angle);ctx.globalCompositeOperation='lighter';ctx.beginPath();ctx.arc(0,0,r,-.7,.7);ctx.strokeStyle='rgba(255,225,140,'+l+')';ctx.lineWidth=15*l+3;ctx.stroke();ctx.beginPath();ctx.arc(0,0,r-5,-.66,.66);ctx.strokeStyle='rgba(255,255,245,'+l+')';ctx.lineWidth=4;ctx.stroke();ctx.restore()}
function seededNoise(s){const v=Math.sin(s*12.9898)*43758.5453;return v-Math.floor(v)}function drawLightningSegment(s,seed,cx,cy,a){const x1=s.x1-cx,y1=s.y1-cy,x2=s.x2-cx,y2=s.y2-cy,dx=x2-x1,dy=y2-y1,l=Math.max(1,Math.hypot(dx,dy)),px=-dy/l,py=dx/l,pts=[{x:x1,y:y1}],steps=5;for(let i=1;i<steps;i++){const t=i/steps,amp=14*Math.sin(Math.PI*t),off=(seededNoise(seed+i*17.13+Math.floor(performance.now()/55))-.5)*2*amp;pts.push({x:x1+dx*t+px*off,y:y1+dy*t+py*off})}pts.push({x:x2,y:y2});ctx.save();ctx.globalCompositeOperation='lighter';ctx.shadowBlur=20;ctx.shadowColor='#77f7ff';ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.strokeStyle='rgba(47,220,232,'+(.72*a)+')';ctx.lineWidth=8;ctx.stroke();ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.strokeStyle='rgba(207,255,255,'+a+')';ctx.lineWidth=3;ctx.stroke();ctx.restore()}function drawChainEffect(e,cx,cy){const a=Math.max(0,Math.min(1,e.life/.28));e.segments.forEach((s,i)=>drawLightningSegment(s,e.id*31+i*7,cx,cy,a))}
function drawMonsterAttack(e,cx,cy){const a=Math.max(0,Math.min(1,e.life/.22)),x1=e.x1-cx,y1=e.y1-cy,x2=e.x2-cx,y2=e.y2-cy;ctx.save();ctx.strokeStyle='rgba(255,76,64,'+a+')';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.beginPath();ctx.arc(x2,y2,34*(1.2-a*.2),0,Math.PI*2);ctx.strokeStyle='rgba(255,130,95,'+a+')';ctx.lineWidth=4;ctx.stroke();ctx.restore()}
function bossDirectionText(dx,dy){const d=(Math.atan2(dy,dx)*180/Math.PI+360)%360;if(d>=337.5||d<22.5)return'→';if(d<67.5)return'↘';if(d<112.5)return'↓';if(d<157.5)return'↙';if(d<202.5)return'←';if(d<247.5)return'↖';if(d<292.5)return'↑';return'↗'}
function updateBossLocator(){if(currentMap!=='forest'){bossLocatorEl.style.display='none';return}const b=getBoss(),me=getMe();if(!b){bossLocatorEl.style.display='none';return}bossLocatorEl.style.display='block';if(!me){bossLocatorEl.textContent='👑 BOSS · X '+Math.round(b.x)+' · Y '+Math.round(b.y);return}const dx=b.x-me.x,dy=b.y-me.y;bossLocatorEl.textContent='👑 BOSS '+bossDirectionText(dx,dy)+' · 거리 '+Math.round(Math.hypot(dx,dy))+' · X '+Math.round(b.x)+' Y '+Math.round(b.y)}
function drawBossGuide(){const b=getBoss(),me=getMe();if(!b||!me)return;const sx=b.x-cameraX,sy=b.y-cameraY,m=70,inside=sx>m&&sx<innerWidth-m&&sy>m&&sy<innerHeight-m;if(inside){const p=7+Math.sin(performance.now()/160)*3;ctx.save();ctx.strokeStyle='rgba(255,65,80,.9)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(sx,sy,92+p,0,Math.PI*2);ctx.stroke();ctx.restore();return}const px=me.x-cameraX,py=me.y-cameraY,dx=sx-px,dy=sy-py,a=Math.atan2(dy,dx),cx=innerWidth/2,cy=innerHeight/2,mx=innerWidth/2-m,my=innerHeight/2-m,co=Math.cos(a),si=Math.sin(a),sc=Math.min(Math.abs(co)>.001?mx/Math.abs(co):Infinity,Math.abs(si)>.001?my/Math.abs(si):Infinity),x=cx+co*sc,y=cy+si*sc;ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillStyle='#ff4355';ctx.beginPath();ctx.moveTo(20,0);ctx.lineTo(-12,-14);ctx.lineTo(-7,0);ctx.lineTo(-12,14);ctx.closePath();ctx.fill();ctx.rotate(-a);ctx.fillStyle='#fff';ctx.font='900 12px system-ui';ctx.textAlign='center';ctx.fillText('BOSS',0,-22);ctx.restore()}
function drawAttackPreview(){if(!attackDragging)return;const me=getMe();if(!me||!me.alive)return;const px=me.x-cameraX,py=me.y-cameraY,a={x:attackX,y:attackY};ctx.save();if(selectedAvatar==='mage'){const l=430;ctx.strokeStyle='rgba(95,250,255,.72)';ctx.fillStyle='rgba(191,255,255,.9)';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+a.x*l,py+a.y*l);ctx.stroke();ctx.beginPath();ctx.arc(px+a.x*l,py+a.y*l,8,0,Math.PI*2);ctx.fill()}else{const ang=Math.atan2(a.y,a.x);ctx.translate(px,py);ctx.rotate(ang);ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,slashRange,-slashHalfAngle,slashHalfAngle);ctx.closePath();ctx.fillStyle='rgba(255,177,55,.18)';ctx.strokeStyle='rgba(255,207,104,.75)';ctx.lineWidth=3;ctx.fill();ctx.stroke()}ctx.restore()}
function updatePortalUi(){const me=getMe();if(!me||!me.alive||!currentPortal){portalPrompt.style.display='none';portalBtn.style.display='none';return}const near=Math.hypot(me.x-currentPortal.x,me.y-currentPortal.y)<=145;portalPrompt.style.display=near?'block':'none';if(matchMedia('(pointer:coarse)').matches)portalBtn.style.display=near?'block':'none'}
function render(){requestAnimationFrame(render);ctx.clearRect(0,0,innerWidth,innerHeight);const me=getMe();cameraX=0;cameraY=0;if(me){cameraX=cClamp(me.x-innerWidth/2,0,Math.max(0,world.width-innerWidth));cameraY=cClamp(me.y-innerHeight/2,0,Math.max(0,world.height-innerHeight))}if(currentMap==='village')drawVillage(cameraX,cameraY);else drawForest(cameraX,cameraY);for(const s of slimes)if(visible(s.x,s.y,190,cameraX,cameraY))drawSlime(s,cameraX,cameraY);for(const f of soulFires)if(visible(f.x,f.y,70,cameraX,cameraY))drawSoulFire(f,cameraX,cameraY);for(const e of chainEffects)drawChainEffect(e,cameraX,cameraY);for(const e of monsterAttackEffects)drawMonsterAttack(e,cameraX,cameraY);const ordered=[...players].sort((a,b)=>a.y-b.y);for(const p of ordered)if(visible(p.x,p.y,190,cameraX,cameraY))drawCharacter(p,p.x-cameraX,p.y-cameraY,p.id===myId);for(const s of slashEffects)if(visible(s.x,s.y,190,cameraX,cameraY))drawSlash(s,cameraX,cameraY);drawAttackPreview();updateBossLocator();drawBossGuide();updatePortalUi()}render();
</script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log('Forest RPG running on port ' + PORT);
  console.log('Normal slimes: ' + NORMAL_SLIMES);
  console.log('Elite slimes: ' + ELITE_SLIMES);
  console.log('Monster AI: melee aggro enabled');
  console.log('Forest center safe zone + village portal enabled');
  console.log('PVP: enabled outside safe zones');
});

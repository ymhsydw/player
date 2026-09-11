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
    portals: [
      { id: 'forest-village', x: 2600, y: 1700, radius: 82, label: '마을 포탈', target: 'village', targetX: 1300, targetY: 1240 }
    ]
  },
  village: {
    id: 'village',
    name: '마을',
    width: 2600,
    height: 1900,
    safeAll: true,
    safeZone: null,
    portals: [
      { id: 'village-forest', x: 1300, y: 950, radius: 82, label: '숲 포탈', target: 'forest', targetX: 2600, targetY: 1940 },
      { id: 'village-arena', x: 2050, y: 950, radius: 82, label: '결투장 포탈', target: 'arena', targetX: 1200, targetY: 1260 }
    ]
  },
  arena: {
    id: 'arena',
    name: '결투장',
    width: 2400,
    height: 1600,
    safeAll: false,
    safeZone: null,
    portals: [
      { id: 'arena-village', x: 1200, y: 1360, radius: 82, label: '마을 포탈', target: 'village', targetX: 2050, targetY: 1140 }
    ]
  }
};

const MAX_PLAYERS = 20;
const PLAYER_SPEED = 300;
const PLAYER_RADIUS = 24;
const PLAYER_MAX_HP = 100;
const PLAYER_RESPAWN_MS = 1500;
const SAFE_HEAL_PER_SECOND = 18;

const TICK_RATE = 30;
const NETWORK_RATE = 15;
const MONSTER_AI_RATE = 10;
const VIEW_RADIUS = 1650;
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
    attacker &&
    target &&
    attacker.id !== target.id &&
    attacker.alive &&
    target.alive &&
    attacker.map === target.map &&
    !isPlayerSafe(attacker) &&
    !isPlayerSafe(target)
  );
}

function isFarEnoughFromOtherSlimes(x, y, minDistance) {
  if (!minDistance) return true;
  const minD2 = minDistance * minDistance;
  for (const slime of slimes.values()) {
    if (!slime.alive || slime.boss) continue;
    const dx = slime.x - x;
    const dy = slime.y - y;
    if (dx * dx + dy * dy < minD2) return false;
  }
  return true;
}

function forestSpawnPoint(margin = 160, minMonsterDistance = 0) {
  for (let tries = 0; tries < 140; tries++) {
    const x = margin + Math.random() * (MAPS.forest.width - margin * 2);
    const y = margin + Math.random() * (MAPS.forest.height - margin * 2);
    if (isPointInForestSafeZone(x, y, 210)) continue;
    if (!isFarEnoughFromOtherSlimes(x, y, minMonsterDistance)) continue;
    return { x, y };
  }

  for (let tries = 0; tries < 80; tries++) {
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
  const p = forestSpawnPoint(170, MIN_SLIME_SPAWN_DISTANCE);
  const slime = {
    id: nextSlimeId++,
    map: 'forest',
    x: p.x,
    y: p.y,
    elite,
    boss: false,
    radius: elite ? 34 : 24,
    maxHp: elite ? 180 : 60,
    hp: elite ? 180 : 60,
    vx: 0,
    vy: 0,
    changeAt: 0,
    alive: true,
    respawnAt: 0,
    targetId: null,
    lastAttackAt: 0,
    suppressedByBoss: false
  };
  chooseSlimeDirection(slime);
  slimes.set(slime.id, slime);
}

for (let i = 0; i < NORMAL_SLIMES; i++) createSlime(false);
for (let i = 0; i < ELITE_SLIMES; i++) createSlime(true);

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function suppressMobsForBoss() {
  const normals = shuffle([...slimes.values()].filter(s => !s.boss && !s.elite && s.alive));
  const elites = shuffle([...slimes.values()].filter(s => !s.boss && s.elite && s.alive));

  normals.forEach((slime, index) => {
    if (index < BOSS_KEEP_NORMAL) return;
    slime.alive = false;
    slime.hp = 0;
    slime.respawnAt = 0;
    slime.targetId = null;
    slime.vx = 0;
    slime.vy = 0;
    slime.suppressedByBoss = true;
  });

  elites.forEach((slime, index) => {
    if (index < BOSS_KEEP_ELITE) return;
    slime.alive = false;
    slime.hp = 0;
    slime.respawnAt = 0;
    slime.targetId = null;
    slime.vx = 0;
    slime.vy = 0;
    slime.suppressedByBoss = true;
  });
}

function restoreMobsAfterBoss(now) {
  for (const slime of slimes.values()) {
    if (slime.boss || slime.alive) continue;
    slime.suppressedByBoss = false;
    slime.respawnAt = now + 1400 + Math.random() * 4200;
  }
}

function createBossSlime() {
  if (bossId !== null) return;
  suppressMobsForBoss();
  const p = forestSpawnPoint(500, 260);
  const boss = {
    id: nextSlimeId++,
    map: 'forest',
    x: p.x,
    y: p.y,
    elite: false,
    boss: true,
    radius: 78,
    maxHp: BOSS_HP,
    hp: BOSS_HP,
    vx: 0,
    vy: 0,
    changeAt: 0,
    alive: true,
    respawnAt: 0,
    targetId: null,
    lastAttackAt: 0,
    suppressedByBoss: false
  };
  chooseSlimeDirection(boss);
  slimes.set(boss.id, boss);
  bossId = boss.id;
  bossProgress = 0;
  io.emit('bossSpawned', { x: boss.x, y: boss.y, map: 'forest' });
}

function respawnSlime(slime) {
  if (slime.boss || bossId !== null || slime.suppressedByBoss) return;
  const p = forestSpawnPoint(170, MIN_SLIME_SPAWN_DISTANCE);
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
    restoreMobsAfterBoss(now);
    io.emit('bossDefeated');
    return;
  }

  slime.hp = 0;
  slime.alive = false;
  slime.targetId = null;
  slime.vx = 0;
  slime.vy = 0;

  if (bossId !== null) {
    slime.respawnAt = 0;
    slime.suppressedByBoss = true;
  } else {
    slime.respawnAt = now + SLIME_RESPAWN_MS;
  }

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
    socket.emit('mapChanged', {
      map: 'forest',
      mapName: MAPS.forest.name,
      world: { width: MAPS.forest.width, height: MAPS.forest.height },
      portals: MAPS.forest.portals
    });
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
      if (dx * dx + dy * dy <= maxD2) {
        out.push({ key: 's:' + slime.id, type: 'slime', id: slime.id, x: slime.x, y: slime.y, radius: slime.radius, ref: slime });
      }
    }
  }

  for (const other of players.values()) {
    if (!canPvp(player, other)) continue;
    const dx = other.x - player.x;
    const dy = other.y - player.y;
    if (dx * dx + dy * dy <= maxD2) {
      out.push({ key: 'p:' + other.id, type: 'player', id: other.id, x: other.x, y: other.y, radius: PLAYER_RADIUS, ref: other });
    }
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
  soulFires.set(id, {
    id,
    ownerId: player.id,
    map: player.map,
    x: player.x + aim.x * 43,
    y: player.y + aim.y * 43,
    vx: aim.x * SOUL_FIRE_SPEED,
    vy: aim.y * SOUL_FIRE_SPEED,
    radius: SOUL_FIRE_RADIUS,
    life: SOUL_FIRE_LIFE
  });

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
  slashEffects.set(id, {
    id,
    ownerId: player.id,
    map: player.map,
    x: player.x,
    y: player.y,
    angle: Math.atan2(aim.y, aim.x),
    life: SLASH_EFFECT_LIFE
  });

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
          monsterAttackEffects.set(effectId, {
            id: effectId,
            map: 'forest',
            x1: slime.x,
            y1: slime.y,
            x2: target.x,
            y2: target.y,
            life: 0.22
          });
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

function nearestPortal(player) {
  const map = mapSpec(player.map);
  let best = null;
  let bestDistance = Infinity;

  for (const portal of map.portals || []) {
    const dist = Math.hypot(player.x - portal.x, player.y - portal.y);
    if (dist <= PORTAL_USE_RANGE && dist < bestDistance) {
      bestDistance = dist;
      best = portal;
    }
  }

  return best;
}

function usePortal(player) {
  if (!player.alive) return;
  const now = Date.now();
  if (now - player.lastPortalAt < PORTAL_COOLDOWN) return;

  const portal = nearestPortal(player);
  if (!portal) return;

  const targetMap = mapSpec(portal.target);
  player.lastPortalAt = now;
  player.map = portal.target;
  player.x = portal.targetX;
  player.y = portal.targetY;
  player.inputX = 0;
  player.inputY = 0;
  player.moving = false;

  const socket = socketForPlayer(player.id);
  if (socket) {
    socket.emit('mapChanged', {
      map: player.map,
      mapName: targetMap.name,
      world: { width: targetMap.width, height: targetMap.height },
      portals: targetMap.portals
    });
  }
}

function serializePlayer(p) {
  return {
    id: p.id,
    map: p.map,
    x: p.x,
    y: p.y,
    direction: p.direction,
    moving: p.moving,
    avatar: p.avatar,
    hp: p.hp,
    maxHp: p.maxHp,
    alive: p.alive
  };
}

function withinView(viewer, x, y, radius = VIEW_RADIUS) {
  const dx = x - viewer.x;
  const dy = y - viewer.y;
  return dx * dx + dy * dy <= radius * radius;
}

function stateForPlayer(viewer) {
  const currentMap = mapSpec(viewer.map);

  const visiblePlayers = [];
  for (const p of players.values()) {
    if (p.map === viewer.map) visiblePlayers.push(serializePlayer(p));
  }

  const visibleSlimes = [];
  if (viewer.map === 'forest') {
    for (const s of slimes.values()) {
      if (s.boss || withinView(viewer, s.x, s.y)) {
        visibleSlimes.push({
          id: s.id,
          x: s.x,
          y: s.y,
          elite: s.elite,
          boss: s.boss,
          hp: s.hp,
          maxHp: s.maxHp,
          alive: s.alive,
          aggro: s.targetId !== null
        });
      }
    }
  }

  const visibleSoulFires = [];
  for (const f of soulFires.values()) {
    if (f.map === viewer.map && withinView(viewer, f.x, f.y, VIEW_RADIUS + 300)) {
      visibleSoulFires.push({ id: f.id, x: f.x, y: f.y });
    }
  }

  const visibleSlashEffects = [];
  for (const e of slashEffects.values()) {
    if (e.map === viewer.map && withinView(viewer, e.x, e.y, VIEW_RADIUS + 200)) {
      visibleSlashEffects.push({ id: e.id, x: e.x, y: e.y, angle: e.angle, life: e.life });
    }
  }

  const visibleChainEffects = [];
  for (const e of chainEffects.values()) {
    if (e.map !== viewer.map) continue;
    const near = e.segments.some(seg =>
      withinView(viewer, seg.x1, seg.y1, VIEW_RADIUS + 250) ||
      withinView(viewer, seg.x2, seg.y2, VIEW_RADIUS + 250)
    );
    if (near) visibleChainEffects.push({ id: e.id, segments: e.segments, life: e.life });
  }

  const visibleMonsterAttackEffects = [];
  for (const e of monsterAttackEffects.values()) {
    if (
      e.map === viewer.map &&
      (
        withinView(viewer, e.x1, e.y1, VIEW_RADIUS + 200) ||
        withinView(viewer, e.x2, e.y2, VIEW_RADIUS + 200)
      )
    ) {
      visibleMonsterAttackEffects.push({
        id: e.id,
        x1: e.x1,
        y1: e.y1,
        x2: e.x2,
        y2: e.y2,
        life: e.life
      });
    }
  }

  return {
    map: viewer.map,
    mapName: currentMap.name,
    world: { width: currentMap.width, height: currentMap.height },
    safe: isPlayerSafe(viewer),
    portals: currentMap.portals,
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
    portals: MAPS[player.map].portals,
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

    if (len > 1) {
      x /= len;
      y /= len;
    }

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
    socket.emit('skillCastResult', {
      success: result.success,
      reason: result.reason || null,
      skill: 'soulFire',
      cooldown: SOUL_FIRE_COOLDOWN
    });
  });

  socket.on('castSlash', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const result = castSlash(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', {
      success: result.success,
      reason: result.reason || null,
      skill: 'slash',
      cooldown: SLASH_COOLDOWN
    });
  });

  socket.on('castChain', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const result = castChainLightning(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', {
      success: result.success,
      reason: result.reason || null,
      skill: 'chain',
      cooldown: CHAIN_COOLDOWN
    });
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

    if (isPlayerSafe(p) && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + SAFE_HEAL_PER_SECOND * dt);
    }
  }

  for (const slime of slimes.values()) {
    if (!slime.alive) {
      if (bossId === null && !slime.boss && !slime.suppressedByBoss && slime.respawnAt && now >= slime.respawnAt) {
        respawnSlime(slime);
      }
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
    if (
      fire.life <= 0 ||
      fire.x < -60 ||
      fire.x > map.width + 60 ||
      fire.y < -60 ||
      fire.y > map.height + 60
    ) {
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
#status{font-weight:900}
#skillName,#skillState,#chainState{color:#78f5ff;font-weight:900}
#hpText{color:#ffb0b0;font-weight:900}
#bossProgress{color:#ffb5b5;font-weight:900}
#mapName{color:#ffe49b;font-weight:900}
#bossLocator{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;display:none;min-width:270px;padding:9px 14px;color:#fff4c7;background:rgba(112,18,27,.94);border:2px solid rgba(255,90,100,.8);border-radius:12px;text-align:center;font-size:13px;font-weight:900;pointer-events:none}
#zoneStatus{position:fixed;top:12px;right:12px;z-index:50;color:#e1ffe6;background:rgba(18,90,40,.94);border:2px solid rgba(118,255,153,.78);border-radius:12px;padding:9px 13px;font-size:13px;font-weight:900;text-align:center;pointer-events:none}
#zoneStatus.danger{color:#fff0e2;background:rgba(125,35,20,.94);border-color:rgba(255,130,88,.85)}
#zoneStatus small{display:block;margin-top:2px;font-size:10px;opacity:.85}
#avatarPanel{position:fixed;right:12px;top:82px;z-index:25;width:205px;color:#fff;background:rgba(8,14,8,.8);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:10px;backdrop-filter:blur(6px)}
#avatarTitle{margin-bottom:8px;font-weight:900}
#avatarGrid{display:grid;gap:8px}
.avatarBtn{border:2px solid rgba(255,255,255,.13);border-radius:10px;background:rgba(255,255,255,.06);color:#fff;padding:9px;text-align:left;font:inherit;cursor:pointer}
.avatarBtn.selected{border-color:#7cf8ff;background:rgba(80,230,255,.12)}
.avatarBtn b,.avatarBtn span{display:block}
.avatarBtn span{margin-top:2px;font-size:11px;opacity:.82}
.joyZone{position:fixed;bottom:max(22px,env(safe-area-inset-bottom));z-index:35;width:156px;height:156px;border-radius:50%;touch-action:none;user-select:none}
#moveJoy{left:22px;border:2px solid rgba(255,255,255,.38);background:rgba(0,0,0,.22)}
#attackJoy{right:22px;border:2px solid rgba(93,247,255,.78);background:rgba(10,103,118,.22)}
.joyKnob{position:absolute;width:58px;height:58px;left:49px;top:49px;border-radius:50%;pointer-events:none}
#moveKnob{background:rgba(255,255,255,.84)}
#attackKnob{background:rgba(95,247,255,.88);box-shadow:0 0 18px rgba(67,239,255,.5)}
#attackLabel{position:absolute;left:0;right:0;top:12px;text-align:center;color:#d8ffff;font-weight:900;font-size:12px;pointer-events:none}
#chainBtn{position:fixed;right:150px;bottom:max(150px,calc(env(safe-area-inset-bottom) + 150px));z-index:40;width:76px;height:76px;border-radius:50%;border:3px solid #65f4ff;background:rgba(10,94,118,.94);color:#fff;font:900 13px system-ui;box-shadow:0 0 22px rgba(75,239,255,.35);touch-action:none}
#chainBtn.cooling{opacity:.55}
#chainBtn.hidden{display:none}
#portalPrompt{position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:55;display:none;padding:10px 18px;border-radius:14px;background:rgba(35,25,70,.9);border:2px solid rgba(170,130,255,.9);color:#fff;font-weight:900;pointer-events:none}
#portalBtn{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:55;display:none;padding:12px 20px;border-radius:18px;border:2px solid #b691ff;background:rgba(65,40,130,.94);color:#fff;font:900 15px system-ui;touch-action:none}
#mobileHint{position:fixed;right:18px;bottom:max(188px,calc(env(safe-area-inset-bottom) + 188px));z-index:20;color:#fff;background:rgba(0,0,0,.38);padding:6px 9px;border-radius:8px;font-size:11px;pointer-events:none}
#clearMessage{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.42);pointer-events:none}
#clearMessage.active{display:flex;animation:clearBg .25s ease-out}
#clearBox{text-align:center;animation:clearPop .45s ease-out}
#clearTitle{color:#ffe477;font-size:clamp(64px,12vw,150px);font-weight:1000;letter-spacing:8px;text-shadow:0 4px 0 #8b571b,0 8px 25px rgba(0,0,0,.9),0 0 30px rgba(255,220,80,.5)}
#clearSub{margin-top:10px;color:#fff;font-size:clamp(18px,3vw,32px);font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.9)}
#deathMessage{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:900;display:none;padding:18px 28px;border-radius:16px;background:rgba(90,10,20,.88);border:2px solid rgba(255,100,110,.9);color:#fff;font-size:24px;font-weight:1000;pointer-events:none}
#deathMessage.active{display:block}
@keyframes clearPop{0%{opacity:0;transform:scale(.45)}65%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes clearBg{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,.42)}}
@media(pointer:fine){.joyZone,#chainBtn,#mobileHint,#portalBtn{display:none!important}}
@media(max-width:700px){#avatarPanel{width:170px}#bossLocator{top:67px;min-width:220px;font-size:11px}#zoneStatus{font-size:11px}#portalPrompt{bottom:205px}}
</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="clearMessage"><div id="clearBox"><div id="clearTitle">CLEAR!</div><div id="clearSub">👑 보스 슬라임 처치 완료</div></div></div>
<div id="deathMessage">쓰러졌습니다</div>
<div id="hud">
  <div id="status">서버 연결 중...</div>
  <div>접속자: <span id="count">0</span>/<span id="maxCount">20</span>명</div>
  <div>맵: <span id="mapName">숲</span></div>
  <div>HP: <span id="hpText">100 / 100</span></div>
  <div>캐릭터: <span id="currentAvatarName">마법사</span></div>
  <div>E 공격: <span id="skillName">영혼불</span></div>
  <div>Q 스킬: <span id="chainState">체인 라이트닝</span></div>
  <div>상태: <span id="skillState">대기</span></div>
  <div>보스 게이지: <span id="bossProgress">0 / 20</span></div>
</div>
<div id="bossLocator">👑 BOSS 위치</div>
<div id="zoneStatus">🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small></div>
<div id="avatarPanel">
  <div id="avatarTitle">캐릭터 선택</div>
  <div id="avatarGrid">
    <button class="avatarBtn selected" data-avatar="mage" type="button"><b>🔮 마법사</b><span>E 영혼불 · Q 체인 라이트닝</span></button>
    <button class="avatarBtn" data-avatar="pirate" type="button"><b>🏴‍☠️ 해적</b><span>E 즉발 슬래시</span></button>
  </div>
</div>
<div id="moveJoy" class="joyZone"><div id="moveKnob" class="joyKnob"></div></div>
<div id="attackJoy" class="joyZone"><div id="attackLabel">영혼불</div><div id="attackKnob" class="joyKnob"></div></div>
<button id="chainBtn" type="button">⚡<br>체인</button>
<div id="portalPrompt">F · 포탈 사용</div>
<button id="portalBtn" type="button">포탈 이동</button>
<div id="mobileHint">왼쪽 이동 · 오른쪽 조준 후 놓아서 공격</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const maxCountEl = document.getElementById('maxCount');
const mapNameEl = document.getElementById('mapName');
const hpTextEl = document.getElementById('hpText');
const currentAvatarNameEl = document.getElementById('currentAvatarName');
const skillNameEl = document.getElementById('skillName');
const chainStateEl = document.getElementById('chainState');
const skillStateEl = document.getElementById('skillState');
const bossProgressEl = document.getElementById('bossProgress');
const bossLocatorEl = document.getElementById('bossLocator');
const zoneStatusEl = document.getElementById('zoneStatus');
const clearMessageEl = document.getElementById('clearMessage');
const deathMessageEl = document.getElementById('deathMessage');
const avatarButtons = [...document.querySelectorAll('.avatarBtn')];
const moveJoy = document.getElementById('moveJoy');
const moveKnob = document.getElementById('moveKnob');
const attackJoy = document.getElementById('attackJoy');
const attackKnob = document.getElementById('attackKnob');
const attackLabel = document.getElementById('attackLabel');
const chainBtn = document.getElementById('chainBtn');
const portalPrompt = document.getElementById('portalPrompt');
const portalBtn = document.getElementById('portalBtn');

let myId = null;
let currentMap = 'forest';
let currentMapName = '숲';
let world = { width: 5200, height: 3400 };
let currentPortals = [{ id:'forest-village', x:2600, y:1700, radius:82, label:'마을 포탈', target:'village' }];
let forestSafeZone = { x:2600, y:1700, radius:470 };
let currentSafe = true;

let players = [];
let slimes = [];
let soulFires = [];
let slashEffects = [];
let chainEffects = [];
let monsterAttackEffects = [];

let serverFull = false;
let keys = new Set();
let cameraX = 0;
let cameraY = 0;
let mouseX = innerWidth / 2;
let mouseY = innerHeight / 2;
let mouseAimActive = false;
let selectedAvatar = 'mage';

let movePointerId = null;
let attackPointerId = null;
let moveX = 0;
let moveY = 0;
let attackX = 0;
let attackY = 1;
let attackDragAmount = 0;
let attackDragging = false;
let lastMobileAim = { x: 0, y: 1 };

let lastInputX = 999;
let lastInputY = 999;
let lastAimX = 999;
let lastAimY = 999;

let soulFireCooldown = 900;
let slashCooldown = 1000;
let chainCooldown = 4500;
let slashRange = 145;
let slashHalfAngle = Math.PI / 3;
let cooldownUntil = { mage:0, pirate:0, chain:0 };
let clearMessageTimer = null;
let deathTimer = null;

function cClamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeClient(x, y, fx, fy) {
  const len = Math.hypot(x, y);
  return len < 0.001 ? { x:fx, y:fy } : { x:x/len, y:y/len };
}

function resize() {
  const maxDpr = matchMedia('(pointer:coarse)').matches ? 1.5 : 2;
  const dpr = Math.min(devicePixelRatio || 1, maxDpr);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
}

addEventListener('resize', resize);
resize();

const mageImage = new Image();
let mageReady = false;
mageImage.onload = () => { mageReady = true; };
mageImage.onerror = () => { statusEl.textContent = 'mage.png 로드 실패'; };
mageImage.src = '/mage.png?v=80';

const pirateImage = new Image();
let pirateReady = false;
pirateImage.onload = () => { pirateReady = true; };
pirateImage.onerror = () => { statusEl.textContent = 'pirate.png 로드 실패'; };
pirateImage.src = '/pirate.png?v=80';

socket.on('connect', () => {
  if (!serverFull) statusEl.textContent = '서버 접속됨';
});

socket.on('welcome', data => {
  myId = data.id;
  currentMap = data.map;
  currentMapName = data.mapName;
  world = data.world;
  currentPortals = data.portals || [];
  forestSafeZone = data.safeZone;
  soulFireCooldown = data.soulFireCooldown;
  slashCooldown = data.slashCooldown;
  chainCooldown = data.chainCooldown;
  slashRange = data.slashRange;
  slashHalfAngle = data.slashHalfAngle;
  maxCountEl.textContent = data.maxPlayers;
  mapNameEl.textContent = currentMapName;
  setAvatar('mage');
});

socket.on('mapChanged', data => {
  currentMap = data.map;
  currentMapName = data.mapName;
  world = data.world;
  currentPortals = data.portals || [];
  players = [];
  slimes = [];
  soulFires = [];
  slashEffects = [];
  chainEffects = [];
  monsterAttackEffects = [];
  mapNameEl.textContent = currentMapName;

  if (currentMap === 'village') skillStateEl.textContent = '마을 도착';
  else if (currentMap === 'arena') skillStateEl.textContent = '⚔️ 결투장 입장';
  else skillStateEl.textContent = '숲 도착';
});

socket.on('count', data => {
  countEl.textContent = data.current;
  maxCountEl.textContent = data.max;
});

socket.on('state', data => {
  currentMap = data.map || currentMap;
  currentMapName = data.mapName || currentMapName;
  world = data.world || world;
  currentPortals = data.portals || currentPortals;
  currentSafe = !!data.safe;
  players = data.players || [];
  slimes = data.slimes || [];
  soulFires = data.soulFires || [];
  slashEffects = data.slashEffects || [];
  chainEffects = data.chainEffects || [];
  monsterAttackEffects = data.monsterAttackEffects || [];
  mapNameEl.textContent = currentMapName;

  const me = getMe();
  if (me) hpTextEl.textContent = Math.ceil(me.hp) + ' / ' + me.maxHp;

  if (currentMap === 'forest' && data.bossActive) bossProgressEl.textContent = '👑 보스 전투중';
  else if (currentMap === 'forest') bossProgressEl.textContent = data.bossProgress + ' / ' + data.bossTarget;
  else bossProgressEl.textContent = '-';

  updateZoneStatus();
});

socket.on('bossSpawned', data => {
  if (currentMap !== 'forest') return;
  skillStateEl.textContent = '👑 보스 슬라임 출현!';
  bossLocatorEl.style.display = 'block';
  bossLocatorEl.textContent = '👑 BOSS · X ' + Math.round(data.x) + ' · Y ' + Math.round(data.y);
});

socket.on('bossDefeated', () => {
  if (currentMap !== 'forest') return;
  skillStateEl.textContent = '🏆 보스 처치!';
  bossLocatorEl.style.display = 'none';
  clearMessageEl.classList.remove('active');
  void clearMessageEl.offsetWidth;
  clearMessageEl.classList.add('active');

  if (clearMessageTimer) clearTimeout(clearMessageTimer);
  clearMessageTimer = setTimeout(() => {
    clearMessageEl.classList.remove('active');
    skillStateEl.textContent = '대기';
  }, 3000);
});

socket.on('playerDefeated', data => {
  deathMessageEl.textContent = data.source === 'pvp' ? '플레이어에게 쓰러졌습니다' : '슬라임에게 쓰러졌습니다';
  deathMessageEl.classList.add('active');

  if (deathTimer) clearTimeout(deathTimer);
  deathTimer = setTimeout(() => deathMessageEl.classList.remove('active'), 1300);
});

socket.on('playerRespawned', () => {
  deathMessageEl.classList.remove('active');
  skillStateEl.textContent = '안전지대에서 부활';
});

socket.on('serverFull', data => {
  serverFull = true;
  statusEl.textContent = '서버가 가득 찼습니다';
  countEl.textContent = data.maxPlayers;
  maxCountEl.textContent = data.maxPlayers;
  socket.io.opts.reconnection = false;
});

socket.on('disconnect', () => {
  if (!serverFull) statusEl.textContent = '재접속 중...';
});

socket.on('skillCastResult', data => {
  if (!data.success) {
    if (data.reason === 'safe') skillStateEl.textContent = '🛡️ 안전지대에서는 공격 불가';
    else if (data.reason === 'noTarget') skillStateEl.textContent = '체인 라이트닝 대상 없음';
    else if (data.reason === 'dead') skillStateEl.textContent = '부활 대기 중';
    else skillStateEl.textContent = '쿨타임';
    return;
  }

  if (data.skill === 'soulFire') {
    cooldownUntil.mage = performance.now() + data.cooldown;
    skillStateEl.textContent = '🩵 영혼불!';
  } else if (data.skill === 'slash') {
    cooldownUntil.pirate = performance.now() + data.cooldown;
    skillStateEl.textContent = '⚔️ 슬래시!';
  } else if (data.skill === 'chain') {
    cooldownUntil.chain = performance.now() + data.cooldown;
    skillStateEl.textContent = '⚡ 체인 라이트닝!';
  }
});

function getMe() {
  return players.find(p => p.id === myId) || null;
}

function getBoss() {
  return currentMap === 'forest' ? (slimes.find(s => s.boss && s.alive) || null) : null;
}

function updateZoneStatus() {
  if (currentSafe) {
    zoneStatusEl.classList.remove('danger');
    zoneStatusEl.innerHTML = '🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small>';
    return;
  }

  zoneStatusEl.classList.add('danger');
  if (currentMap === 'arena') {
    zoneStatusEl.innerHTML = '⚔️ 결투장<small>PVP 전용 · 안전지대 없음</small>';
  } else {
    zoneStatusEl.innerHTML = '⚔️ 전투 지역<small>PVP 허용 · 몬스터 공격 가능</small>';
  }
}

function setAvatar(avatar) {
  selectedAvatar = avatar;
  socket.emit('setAvatar', { avatar });

  avatarButtons.forEach(button => {
    button.classList.toggle('selected', button.dataset.avatar === avatar);
  });

  if (avatar === 'mage') {
    currentAvatarNameEl.textContent = '마법사';
    skillNameEl.textContent = '영혼불';
    chainStateEl.textContent = '체인 라이트닝';
    attackLabel.textContent = '영혼불';
    attackJoy.style.borderColor = 'rgba(93,247,255,.78)';
    attackKnob.style.background = 'rgba(95,247,255,.88)';
    chainBtn.classList.remove('hidden');
  } else {
    currentAvatarNameEl.textContent = '해적';
    skillNameEl.textContent = '슬래시';
    chainStateEl.textContent = '-';
    attackLabel.textContent = '슬래시';
    attackJoy.style.borderColor = 'rgba(255,196,80,.82)';
    attackKnob.style.background = 'rgba(255,181,70,.9)';
    chainBtn.classList.add('hidden');
  }
}

avatarButtons.forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setAvatar(button.dataset.avatar);
  });
});

function getMouseAim() {
  const me = getMe();
  if (!me) return null;

  const dx = cameraX + mouseX - me.x;
  const dy = cameraY + mouseY - me.y;
  const len = Math.hypot(dx, dy);

  return len < 0.001 ? null : { x: dx / len, y: dy / len };
}

function getAttackAim() {
  if (mouseAimActive) {
    const aim = getMouseAim();
    if (aim) return aim;
  }
  return lastMobileAim;
}

function sendAim(aim) {
  if (!aim || serverFull) return;

  if (
    Math.abs(aim.x - lastAimX) > 0.01 ||
    Math.abs(aim.y - lastAimY) > 0.01
  ) {
    socket.emit('aim', aim);
    lastAimX = aim.x;
    lastAimY = aim.y;
  }
}

function castPrimary(aim, autoAim) {
  if (serverFull) return;

  if (currentSafe) {
    skillStateEl.textContent = '🛡️ 안전지대에서는 공격 불가';
    return;
  }

  if (selectedAvatar === 'mage') {
    if (performance.now() < cooldownUntil.mage) {
      skillStateEl.textContent = '영혼불 쿨타임';
      return;
    }
    socket.emit('castSoulFire', { aim, autoAim: !!autoAim });
  } else {
    if (performance.now() < cooldownUntil.pirate) {
      skillStateEl.textContent = '슬래시 쿨타임';
      return;
    }
    socket.emit('castSlash', { aim, autoAim: !!autoAim });
  }
}

function castChain(aim, autoAim) {
  if (serverFull || selectedAvatar !== 'mage') return;

  if (currentSafe) {
    skillStateEl.textContent = '🛡️ 안전지대에서는 공격 불가';
    return;
  }

  if (performance.now() < cooldownUntil.chain) {
    skillStateEl.textContent = '체인 라이트닝 쿨타임';
    return;
  }

  socket.emit('castChain', { aim, autoAim: !!autoAim });
}

function tryPortal() {
  if (!serverFull) socket.emit('usePortal');
}

addEventListener('keydown', event => {
  const key = event.key.toLowerCase();

  if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) {
    keys.add(key);
    event.preventDefault();
  }

  if (key === 'e' && !event.repeat) {
    const aim = getMouseAim() || getAttackAim();
    if (aim) {
      sendAim(aim);
      castPrimary(aim, false);
    }
    event.preventDefault();
  }

  if (key === 'q' && selectedAvatar === 'mage' && !event.repeat) {
    const aim = getMouseAim() || getAttackAim();
    if (aim) {
      sendAim(aim);
      castChain(aim, false);
    }
    event.preventDefault();
  }

  if (key === 'f' && !event.repeat) {
    tryPortal();
    event.preventDefault();
  }
});

addEventListener('keyup', event => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
  mouseX = event.clientX;
  mouseY = event.clientY;
  mouseAimActive = true;
  const aim = getMouseAim();
  if (aim) sendAim(aim);
});

portalBtn.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  tryPortal();
});

function joyVector(element, clientX, clientY, deadZone) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const max = rect.width * 0.34;

  let dx = clientX - centerX;
  let dy = clientY - centerY;
  const raw = Math.hypot(dx, dy);

  if (raw > max) {
    dx = dx / raw * max;
    dy = dy / raw * max;
  }

  const amount = Math.min(1, raw / max);
  let nx = dx / max;
  let ny = dy / max;

  if (amount < deadZone) {
    nx = 0;
    ny = 0;
  }

  return { dx, dy, nx, ny, amount };
}

function setKnob(knob, dx, dy) {
  knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
}

moveJoy.addEventListener('pointerdown', event => {
  movePointerId = event.pointerId;
  moveJoy.setPointerCapture(event.pointerId);
  const v = joyVector(moveJoy, event.clientX, event.clientY, 0.12);
  moveX = v.nx;
  moveY = v.ny;
  setKnob(moveKnob, v.dx, v.dy);
});

moveJoy.addEventListener('pointermove', event => {
  if (event.pointerId !== movePointerId) return;
  const v = joyVector(moveJoy, event.clientX, event.clientY, 0.12);
  moveX = v.nx;
  moveY = v.ny;
  setKnob(moveKnob, v.dx, v.dy);
});

function releaseMove(event) {
  if (event.pointerId !== movePointerId) return;
  movePointerId = null;
  moveX = 0;
  moveY = 0;
  setKnob(moveKnob, 0, 0);
}

moveJoy.addEventListener('pointerup', releaseMove);
moveJoy.addEventListener('pointercancel', releaseMove);

attackJoy.addEventListener('pointerdown', event => {
  attackPointerId = event.pointerId;
  attackJoy.setPointerCapture(event.pointerId);
  attackDragging = true;

  const v = joyVector(attackJoy, event.clientX, event.clientY, 0);
  attackDragAmount = v.amount;
  setKnob(attackKnob, v.dx, v.dy);

  if (v.amount >= 0.08) {
    const aim = normalizeClient(v.nx, v.ny, lastMobileAim.x, lastMobileAim.y);
    attackX = aim.x;
    attackY = aim.y;
    lastMobileAim = aim;
    sendAim(aim);
  }
});

attackJoy.addEventListener('pointermove', event => {
  if (event.pointerId !== attackPointerId) return;

  const v = joyVector(attackJoy, event.clientX, event.clientY, 0);
  attackDragAmount = Math.max(attackDragAmount, v.amount);
  setKnob(attackKnob, v.dx, v.dy);

  if (v.amount >= 0.08) {
    const aim = normalizeClient(v.nx, v.ny, lastMobileAim.x, lastMobileAim.y);
    attackX = aim.x;
    attackY = aim.y;
    lastMobileAim = aim;
    sendAim(aim);
  }
});

function releaseAttack(event) {
  if (event.pointerId !== attackPointerId) return;

  const manual = attackDragAmount >= 0.20;
  const aim = manual ? { x:attackX, y:attackY } : lastMobileAim;

  attackPointerId = null;
  attackDragging = false;
  attackDragAmount = 0;
  setKnob(attackKnob, 0, 0);
  castPrimary(aim, !manual);
}

attackJoy.addEventListener('pointerup', releaseAttack);
attackJoy.addEventListener('pointercancel', event => {
  if (event.pointerId !== attackPointerId) return;
  attackPointerId = null;
  attackDragging = false;
  attackDragAmount = 0;
  setKnob(attackKnob, 0, 0);
});

chainBtn.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  const manual = attackDragging && attackDragAmount >= 0.20;
  const aim = manual ? { x:attackX, y:attackY } : lastMobileAim;
  castChain(aim, !manual);
});

setInterval(() => {
  if (serverFull) return;

  let x = 0;
  let y = 0;

  if (keys.has('a') || keys.has('arrowleft')) x--;
  if (keys.has('d') || keys.has('arrowright')) x++;
  if (keys.has('w') || keys.has('arrowup')) y--;
  if (keys.has('s') || keys.has('arrowdown')) y++;

  if (Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01) {
    x = moveX;
    y = moveY;
  }

  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }

  if (
    Math.abs(x - lastInputX) > 0.01 ||
    Math.abs(y - lastInputY) > 0.01
  ) {
    socket.emit('input', { x, y });
    lastInputX = x;
    lastInputY = y;
  }

  if (mouseAimActive) {
    const aim = getMouseAim();
    if (aim) sendAim(aim);
  }
}, 33);

setInterval(() => {
  if (selectedAvatar !== 'mage') return;

  const remaining = Math.max(0, cooldownUntil.chain - performance.now());

  if (remaining > 0) {
    chainBtn.classList.add('cooling');
    chainBtn.innerHTML = '⚡<br>' + (remaining / 1000).toFixed(1);
    chainStateEl.textContent = (remaining / 1000).toFixed(1) + '초';
  } else {
    chainBtn.classList.remove('cooling');
    chainBtn.innerHTML = '⚡<br>체인';
    chainStateEl.textContent = '체인 라이트닝';
  }
}, 100);

function visible(x, y, margin, cx, cy) {
  return x > cx - margin &&
    x < cx + innerWidth + margin &&
    y > cy - margin &&
    y < cy + innerHeight + margin;
}

function hashRand(n) {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

function drawPortal(portal, cx, cy) {
  if (!portal || !visible(portal.x, portal.y, 160, cx, cy)) return;

  const x = portal.x - cx;
  const y = portal.y - cy;
  const t = performance.now() / 700;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < 4; i++) {
    const r = 34 + i * 12 + Math.sin(t + i) * 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(' + (130 + i * 20) + ',105,255,' + (0.65 - i * 0.1) + ')';
    ctx.lineWidth = 6 - i;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.ellipse(x, y + 12, 40, 19, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(145,110,255,.42)';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#f4edff';
  ctx.font = '900 13px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(portal.label || '포탈', x, y - 62);
}

function drawForest(cx, cy) {
  ctx.fillStyle = '#3d6b34';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const z = forestSafeZone;
  const zx = z.x - cx;
  const zy = z.y - cy;

  ctx.save();
  ctx.beginPath();
  ctx.arc(zx, zy, z.radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(125,196,104,.34)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(180,255,165,.88)';
  ctx.lineWidth = 7;
  ctx.setLineDash([18,12]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  for (let i = 0; i < 170; i++) {
    const x = 90 + hashRand(i + 1) * (world.width - 180);
    const y = 90 + hashRand(i + 701) * (world.height - 180);
    const dx = x - z.x;
    const dy = y - z.y;

    if (dx * dx + dy * dy < (z.radius + 120) * (z.radius + 120)) continue;

    const size = 22 + hashRand(i + 1401) * 24;
    if (!visible(x, y, 90, cx, cy)) continue;

    const sx = x - cx;
    const sy = y - cy;

    ctx.beginPath();
    ctx.ellipse(sx, sy + 25, size * 0.72, size * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.fill();

    ctx.fillStyle = '#694526';
    ctx.fillRect(sx - size * 0.12, sy, size * 0.24, size * 0.85);

    ctx.beginPath();
    ctx.arc(sx, sy - 8, size, 0, Math.PI * 2);
    ctx.arc(sx - size * 0.55, sy, size * 0.58, 0, Math.PI * 2);
    ctx.arc(sx + size * 0.55, sy, size * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = '#287a3e';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx - size * 0.25, sy - size * 0.28, size * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#47a457';
    ctx.fill();
  }

  for (let i = 0; i < 160; i++) {
    const x = hashRand(i + 2701) * world.width;
    const y = hashRand(i + 3301) * world.height;
    const dx = x - z.x;
    const dy = y - z.y;

    if (dx * dx + dy * dy < (z.radius + 30) * (z.radius + 30)) continue;
    if (!visible(x, y, 15, cx, cy)) continue;

    ctx.beginPath();
    ctx.arc(x - cx, y - cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = ['#ffe082','#ff9e9e','#c9a3ff','#9ee7ff'][i % 4];
    ctx.fill();
  }

  for (const portal of currentPortals) drawPortal(portal, cx, cy);
}

function drawHouse(x, y, width, height, cx, cy, roof) {
  if (!visible(x, y, 180, cx, cy)) return;

  const sx = x - cx;
  const sy = y - cy;

  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(sx - width / 2 + 8, sy + height / 2 - 2, width, 18);

  ctx.fillStyle = '#ead6aa';
  ctx.fillRect(sx - width / 2, sy - height / 2, width, height);

  ctx.beginPath();
  ctx.moveTo(sx - width / 2 - 16, sy - height / 2 + 6);
  ctx.lineTo(sx, sy - height / 2 - 55);
  ctx.lineTo(sx + width / 2 + 16, sy - height / 2 + 6);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();

  ctx.fillStyle = '#7b4f2b';
  ctx.fillRect(sx - 18, sy + height / 2 - 54, 36, 54);

  ctx.fillStyle = '#8fd6ef';
  ctx.fillRect(sx - width / 2 + 24, sy - 20, 34, 30);
  ctx.fillRect(sx + width / 2 - 58, sy - 20, 34, 30);
}

function drawVillage(cx, cy) {
  ctx.fillStyle = '#c9b98b';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const centerX = 1300 - cx;
  const centerY = 950 - cy;

  ctx.beginPath();
  ctx.arc(centerX, centerY, 330, 0, Math.PI * 2);
  ctx.fillStyle = '#b9ad88';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerX, centerY, 315, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,246,195,.55)';
  ctx.lineWidth = 5;
  ctx.stroke();

  const houses = [
    [520,430,250,170,'#994c45'],
    [1000,340,260,180,'#7d5144'],
    [1590,350,250,170,'#995d3f'],
    [2100,470,270,185,'#81505d'],
    [470,1320,260,180,'#84543e'],
    [1030,1460,250,170,'#9a5548'],
    [1620,1470,260,180,'#7d5144'],
    [2140,1310,250,170,'#995d3f']
  ];

  for (const h of houses) {
    drawHouse(h[0], h[1], h[2], h[3], cx, cy, h[4]);
  }

  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.font = '1000 24px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('마을 · 전체 안전지대 · HP 회복', centerX, centerY - 118);

  for (const portal of currentPortals) drawPortal(portal, cx, cy);
}

function drawArena(cx, cy) {
  ctx.fillStyle = '#61564e';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const centerX = world.width / 2 - cx;
  const centerY = world.height / 2 - cy;

  ctx.fillStyle = '#786b60';
  ctx.fillRect(180 - cx, 180 - cy, world.width - 360, world.height - 360);

  ctx.strokeStyle = '#d4c19a';
  ctx.lineWidth = 12;
  ctx.strokeRect(200 - cx, 200 - cy, world.width - 400, world.height - 400);

  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 270, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - 420, centerY);
  ctx.lineTo(centerX + 420, centerY);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,225,190,.9)';
  ctx.font = '1000 28px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('⚔️ 결투장 · PVP 전용', centerX, 120 - cy);

  ctx.font = '800 14px system-ui';
  ctx.fillText('안전지대 없음', centerX, 148 - cy);

  for (const portal of currentPortals) drawPortal(portal, cx, cy);
}

function walkFrame(player) {
  return player.moving ? Math.floor(performance.now() / 145) % 3 : 1;
}

function directionRow(direction) {
  if (direction === 'back') return 1;
  if (direction === 'left') return 2;
  if (direction === 'right') return 3;
  return 0;
}

const MAGE_FRAMES = [
  [{x:104,y:75,w:236,h:308},{x:376,y:74,w:237,h:308},{x:680,y:74,w:236,h:308}],
  [{x:98,y:417,w:234,h:287},{x:375,y:418,w:230,h:286},{x:679,y:417,w:229,h:287}],
  [{x:116,y:744,w:222,h:285},{x:387,y:745,w:221,h:284},{x:691,y:744,w:224,h:285}],
  [{x:152,y:1071,w:212,h:279},{x:419,y:1069,w:214,h:282},{x:722,y:1070,w:217,h:279}]
];

const PIRATE_FRAMES = [
  [{x:74,y:29,w:249,h:319,anchorX:107},{x:422,y:30,w:229,h:311,anchorX:121},{x:761,y:30,w:230,h:318,anchorX:144}],
  [{x:91,y:384,w:245,h:326,anchorX:90},{x:431,y:384,w:225,h:318,anchorX:112},{x:772,y:384,w:235,h:326,anchorX:133}],
  [{x:45,y:738,w:293,h:312,anchorX:136},{x:418,y:738,w:236,h:316,anchorX:125},{x:755,y:738,w:273,h:312,anchorX:150}],
  [{x:67,y:1092,w:270,h:312,anchorX:114},{x:427,y:1092,w:227,h:317,anchorX:116},{x:751,y:1092,w:266,h:313,anchorX:154}]
];

function drawCharacter(player, screenX, screenY, isMe) {
  if (!player.alive) return;

  const row = directionRow(player.direction);
  const col = walkFrame(player);
  const footY = 30;

  ctx.save();
  ctx.translate(Math.round(screenX), Math.round(screenY));

  if (player.avatar === 'pirate') {
    const frame = PIRATE_FRAMES[row][col];
    const scale = 0.39;
    if (pirateReady) {
      ctx.drawImage(
        pirateImage,
        frame.x, frame.y, frame.w, frame.h,
        -frame.anchorX * scale,
        footY - frame.h * scale,
        frame.w * scale,
        frame.h * scale
      );
    }
  } else {
    const frame = MAGE_FRAMES[row][col];
    const scale = 0.43;

    if (mageReady) {
      const width = frame.w * scale;
      const height = frame.h * scale;
      ctx.drawImage(
        mageImage,
        frame.x, frame.y, frame.w, frame.h,
        -width / 2,
        footY - height,
        width,
        height
      );
    }
  }

  ctx.restore();

  const hp = Math.max(0, player.hp / player.maxHp);

  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fillRect(screenX - 32, screenY - 104, 64, 7);
  ctx.fillStyle = hp > 0.45 ? '#70e27d' : '#ff6565';
  ctx.fillRect(screenX - 30, screenY - 102, 60 * hp, 3);

  ctx.fillStyle = 'rgba(0,0,0,.42)';
  ctx.fillRect(screenX - 34, screenY - 91, 68, 18);
  ctx.fillStyle = isMe ? '#ffe082' : '#fff';
  ctx.font = '700 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(isMe ? 'YOU' : 'P-' + player.id.slice(0, 4), screenX, screenY - 78);
}

function drawSlime(slime, cx, cy) {
  if (!slime.alive) return;

  const x = slime.x - cx;
  const y = slime.y - cy;
  const radius = slime.boss ? 78 : slime.elite ? 34 : 24;
  const bounce = Math.sin(performance.now() / 180 + slime.id) * (slime.boss ? 4 : 2.5);

  ctx.save();
  ctx.translate(x, y + bounce);

  if (slime.aggro) {
    ctx.beginPath();
    ctx.arc(0, 0, radius + 14 + Math.sin(performance.now() / 100) * 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,80,70,.72)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.ellipse(0, radius * 0.72, radius * 0.82, radius * 0.27, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-radius, 8);
  ctx.quadraticCurveTo(-radius, -radius * 0.7, 0, -radius);
  ctx.quadraticCurveTo(radius, -radius * 0.7, radius, 8);
  ctx.quadraticCurveTo(0, radius * 0.85, -radius, 8);
  ctx.fillStyle = slime.boss ? '#b32641' : slime.elite ? '#774dd0' : '#58c96f';
  ctx.fill();

  ctx.fillStyle = '#151719';
  ctx.beginPath();
  ctx.arc(-radius * 0.3, -4, slime.boss ? 7 : 3, 0, Math.PI * 2);
  ctx.arc(radius * 0.3, -4, slime.boss ? 7 : 3, 0, Math.PI * 2);
  ctx.fill();

  if (slime.elite || slime.boss) {
    const crownY = -radius - 4;
    const size = slime.boss ? 22 : 13;

    ctx.fillStyle = '#ffd259';
    ctx.beginPath();
    ctx.moveTo(-size, crownY);
    ctx.lineTo(-size * 0.6, crownY - size);
    ctx.lineTo(0, crownY - size * 0.4);
    ctx.lineTo(size * 0.6, crownY - size);
    ctx.lineTo(size, crownY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  const barWidth = slime.boss ? 180 : slime.elite ? 68 : 48;
  const hp = Math.max(0, slime.hp / slime.maxHp);
  const hpY = y - radius - (slime.boss ? 43 : 22);

  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fillRect(x - barWidth / 2, hpY, barWidth, slime.boss ? 13 : 7);
  ctx.fillStyle = slime.boss ? '#ff334f' : slime.elite ? '#e5b84d' : '#ef6666';
  ctx.fillRect(x - barWidth / 2 + 2, hpY + 2, (barWidth - 4) * hp, slime.boss ? 9 : 3);

  if (slime.boss) {
    ctx.fillStyle = '#ffd6db';
    ctx.font = '900 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('👑 BOSS SLIME', x, hpY - 10);
  } else if (slime.elite) {
    ctx.fillStyle = '#ffe59a';
    ctx.font = '700 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('ELITE', x, hpY - 6);
  }
}

function drawSoulFire(fire, cx, cy) {
  const x = fire.x - cx;
  const y = fire.y - cy;
  const time = performance.now() / 100;
  const pulse = Math.sin(time + fire.id) * 2;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowBlur = 30;
  ctx.shadowColor = '#49f4ff';

  ctx.beginPath();
  ctx.arc(x, y, 19 + pulse, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40,235,255,.28)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, 11 + pulse * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = '#23dce9';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x - 2, y - 2, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = '#d2ffff';
  ctx.fill();
  ctx.restore();
}

function drawSlash(slash, cx, cy) {
  const x = slash.x - cx;
  const y = slash.y - cy;
  const life = Math.max(0, Math.min(1, slash.life / 0.28));
  const radius = 75 + (1 - life) * 55;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(slash.angle);
  ctx.globalCompositeOperation = 'lighter';

  ctx.beginPath();
  ctx.arc(0, 0, radius, -0.7, 0.7);
  ctx.strokeStyle = 'rgba(255,225,140,' + life + ')';
  ctx.lineWidth = 15 * life + 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, radius - 5, -0.66, 0.66);
  ctx.strokeStyle = 'rgba(255,255,245,' + life + ')';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.restore();
}

function seededNoise(seed) {
  const v = Math.sin(seed * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

function drawLightningSegment(seg, seed, cx, cy, alpha) {
  const x1 = seg.x1 - cx;
  const y1 = seg.y1 - cy;
  const x2 = seg.x2 - cx;
  const y2 = seg.y2 - cy;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len;
  const py = dx / len;

  const points = [{ x:x1, y:y1 }];
  const steps = 5;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const amp = 14 * Math.sin(Math.PI * t);
    const offset = (seededNoise(seed + i * 17.13 + Math.floor(performance.now() / 55)) - 0.5) * 2 * amp;
    points.push({
      x: x1 + dx * t + px * offset,
      y: y1 + dy * t + py * offset
    });
  }

  points.push({ x:x2, y:y2 });

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#77f7ff';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = 'rgba(47,220,232,' + (0.72 * alpha) + ')';
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = 'rgba(207,255,255,' + alpha + ')';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

function drawChainEffect(effect, cx, cy) {
  const alpha = Math.max(0, Math.min(1, effect.life / 0.28));
  effect.segments.forEach((seg, index) => {
    drawLightningSegment(seg, effect.id * 31 + index * 7, cx, cy, alpha);
  });
}

function drawMonsterAttack(effect, cx, cy) {
  const alpha = Math.max(0, Math.min(1, effect.life / 0.22));
  const x1 = effect.x1 - cx;
  const y1 = effect.y1 - cy;
  const x2 = effect.x2 - cx;
  const y2 = effect.y2 - cy;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,76,64,' + alpha + ')';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x2, y2, 34 * (1.2 - alpha * 0.2), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,130,95,' + alpha + ')';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function bossDirectionText(dx, dy) {
  const degree = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  if (degree >= 337.5 || degree < 22.5) return '→';
  if (degree < 67.5) return '↘';
  if (degree < 112.5) return '↓';
  if (degree < 157.5) return '↙';
  if (degree < 202.5) return '←';
  if (degree < 247.5) return '↖';
  if (degree < 292.5) return '↑';
  return '↗';
}

function updateBossLocator() {
  if (currentMap !== 'forest') {
    bossLocatorEl.style.display = 'none';
    return;
  }

  const boss = getBoss();
  const me = getMe();

  if (!boss) {
    bossLocatorEl.style.display = 'none';
    return;
  }

  bossLocatorEl.style.display = 'block';

  if (!me) {
    bossLocatorEl.textContent = '👑 BOSS · X ' + Math.round(boss.x) + ' · Y ' + Math.round(boss.y);
    return;
  }

  const dx = boss.x - me.x;
  const dy = boss.y - me.y;

  bossLocatorEl.textContent =
    '👑 BOSS ' + bossDirectionText(dx, dy) +
    ' · 거리 ' + Math.round(Math.hypot(dx, dy)) +
    ' · X ' + Math.round(boss.x) +
    ' Y ' + Math.round(boss.y);
}

function drawBossGuide() {
  const boss = getBoss();
  const me = getMe();
  if (!boss || !me) return;

  const sx = boss.x - cameraX;
  const sy = boss.y - cameraY;
  const margin = 70;

  const inside =
    sx > margin &&
    sx < innerWidth - margin &&
    sy > margin &&
    sy < innerHeight - margin;

  if (inside) {
    const pulse = 7 + Math.sin(performance.now() / 160) * 3;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,65,80,.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, 92 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const playerX = me.x - cameraX;
  const playerY = me.y - cameraY;
  const dx = sx - playerX;
  const dy = sy - playerY;
  const angle = Math.atan2(dy, dx);

  const centerX = innerWidth / 2;
  const centerY = innerHeight / 2;
  const maxX = innerWidth / 2 - margin;
  const maxY = innerHeight / 2 - margin;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const scale = Math.min(
    Math.abs(cos) > 0.001 ? maxX / Math.abs(cos) : Infinity,
    Math.abs(sin) > 0.001 ? maxY / Math.abs(sin) : Infinity
  );

  const arrowX = centerX + cos * scale;
  const arrowY = centerY + sin * scale;

  ctx.save();
  ctx.translate(arrowX, arrowY);
  ctx.rotate(angle);

  ctx.fillStyle = '#ff4355';
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-12, -14);
  ctx.lineTo(-7, 0);
  ctx.lineTo(-12, 14);
  ctx.closePath();
  ctx.fill();

  ctx.rotate(-angle);
  ctx.fillStyle = '#fff';
  ctx.font = '900 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('BOSS', 0, -22);
  ctx.restore();
}

function drawAttackPreview() {
  if (!attackDragging) return;

  const me = getMe();
  if (!me || !me.alive) return;

  const px = me.x - cameraX;
  const py = me.y - cameraY;
  const aim = { x:attackX, y:attackY };

  ctx.save();

  if (selectedAvatar === 'mage') {
    const length = 430;
    ctx.strokeStyle = 'rgba(95,250,255,.72)';
    ctx.fillStyle = 'rgba(191,255,255,.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + aim.x * length, py + aim.y * length);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px + aim.x * length, py + aim.y * length, 8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const angle = Math.atan2(aim.y, aim.x);
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, slashRange, -slashHalfAngle, slashHalfAngle);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,177,55,.18)';
    ctx.strokeStyle = 'rgba(255,207,104,.75)';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function nearestClientPortal() {
  const me = getMe();
  if (!me || !me.alive) return null;

  let best = null;
  let bestDistance = Infinity;

  for (const portal of currentPortals || []) {
    const distance = Math.hypot(me.x - portal.x, me.y - portal.y);
    if (distance <= 145 && distance < bestDistance) {
      bestDistance = distance;
      best = portal;
    }
  }

  return best;
}

function updatePortalUi() {
  const portal = nearestClientPortal();
  const near = !!portal;

  portalPrompt.style.display = near ? 'block' : 'none';
  portalPrompt.textContent = near ? 'F · ' + (portal.label || '포탈') + ' 사용' : '';

  if (matchMedia('(pointer:coarse)').matches) {
    portalBtn.style.display = near ? 'block' : 'none';
    portalBtn.textContent = near ? (portal.label || '포탈') + ' 이동' : '포탈 이동';
  }
}

function render() {
  requestAnimationFrame(render);
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  const me = getMe();
  cameraX = 0;
  cameraY = 0;

  if (me) {
    cameraX = cClamp(me.x - innerWidth / 2, 0, Math.max(0, world.width - innerWidth));
    cameraY = cClamp(me.y - innerHeight / 2, 0, Math.max(0, world.height - innerHeight));
  }

  if (currentMap === 'village') drawVillage(cameraX, cameraY);
  else if (currentMap === 'arena') drawArena(cameraX, cameraY);
  else drawForest(cameraX, cameraY);

  for (const slime of slimes) {
    if (visible(slime.x, slime.y, 190, cameraX, cameraY)) {
      drawSlime(slime, cameraX, cameraY);
    }
  }

  for (const fire of soulFires) {
    if (visible(fire.x, fire.y, 70, cameraX, cameraY)) {
      drawSoulFire(fire, cameraX, cameraY);
    }
  }

  for (const effect of chainEffects) drawChainEffect(effect, cameraX, cameraY);
  for (const effect of monsterAttackEffects) drawMonsterAttack(effect, cameraX, cameraY);

  const ordered = [...players].sort((a, b) => a.y - b.y);
  for (const player of ordered) {
    if (visible(player.x, player.y, 190, cameraX, cameraY)) {
      drawCharacter(player, player.x - cameraX, player.y - cameraY, player.id === myId);
    }
  }

  for (const slash of slashEffects) {
    if (visible(slash.x, slash.y, 190, cameraX, cameraY)) {
      drawSlash(slash, cameraX, cameraY);
    }
  }

  drawAttackPreview();
  updateBossLocator();
  drawBossGuide();
  updatePortalUi();
}

render();
</script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log('Forest RPG running on port ' + PORT);
  console.log('Normal slimes: ' + NORMAL_SLIMES);
  console.log('Elite slimes: ' + ELITE_SLIMES);
  console.log('Slime aggro: ' + SLIME_AGGRO + ' / Elite: ' + ELITE_AGGRO);
  console.log('Boss keeps mobs: ' + BOSS_KEEP_NORMAL + ' normal, ' + BOSS_KEEP_ELITE + ' elite');
  console.log('Safe-zone healing: ' + SAFE_HEAL_PER_SECOND + ' HP/s');
  console.log('Village duel arena portal: ON');
});

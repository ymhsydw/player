const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const WORLD = { width: 5200, height: 3400 };
const MAX_PLAYERS = 20;
const PLAYER_SPEED = 300;
const PLAYER_RADIUS = 24;
const TICK_RATE = 30;
const AVATARS = ['mage', 'pirate'];

const NORMAL_SLIMES = 50;
const ELITE_SLIMES = 8;
const SLIME_RESPAWN_MS = 5000;
const BOSS_TARGET = 20;
const BOSS_HP = 1200;

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

const players = new Map();
const slimes = new Map();
const soulFires = new Map();
const slashEffects = new Map();
const chainEffects = new Map();

let nextSlimeId = 1;
let nextSoulFireId = 1;
let nextSlashId = 1;
let nextChainEffectId = 1;
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

function randomPoint(margin = 120) {
  return {
    x: margin + Math.random() * (WORLD.width - margin * 2),
    y: margin + Math.random() * (WORLD.height - margin * 2)
  };
}

function makePlayer(id) {
  const p = randomPoint(450);
  return {
    id,
    x: p.x,
    y: p.y,
    inputX: 0,
    inputY: 0,
    aimX: 0,
    aimY: 1,
    direction: 'front',
    moving: false,
    avatar: 'mage',
    lastSoulFireAt: 0,
    lastSlashAt: 0,
    lastChainAt: 0
  };
}

function chooseSlimeDirection(slime) {
  const angle = Math.random() * Math.PI * 2;
  let speed;
  if (slime.boss) speed = 26 + Math.random() * 14;
  else if (slime.elite) speed = 52 + Math.random() * 24;
  else speed = 38 + Math.random() * 28;

  slime.vx = Math.cos(angle) * speed;
  slime.vy = Math.sin(angle) * speed;
  slime.changeAt = Date.now() + 1000 + Math.random() * 2300;
}

function createSlime(elite = false) {
  const p = randomPoint(180);
  const slime = {
    id: nextSlimeId++,
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
    respawnAt: 0
  };
  chooseSlimeDirection(slime);
  slimes.set(slime.id, slime);
}

for (let i = 0; i < NORMAL_SLIMES; i++) createSlime(false);
for (let i = 0; i < ELITE_SLIMES; i++) createSlime(true);

function createBossSlime() {
  if (bossId !== null) return;
  const p = randomPoint(500);
  const boss = {
    id: nextSlimeId++,
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
    respawnAt: 0
  };
  chooseSlimeDirection(boss);
  slimes.set(boss.id, boss);
  bossId = boss.id;
  bossProgress = 0;
  io.emit('bossSpawned', { x: boss.x, y: boss.y });
}

function respawnSlime(slime) {
  if (slime.boss) return;
  const p = randomPoint(180);
  slime.x = p.x;
  slime.y = p.y;
  slime.hp = slime.maxHp;
  slime.alive = true;
  slime.respawnAt = 0;
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
  addBossProgress(slime);
}

function findNearestAliveSlime(x, y, maxRange = Infinity) {
  let best = null;
  let bestD2 = maxRange * maxRange;
  for (const slime of slimes.values()) {
    if (!slime.alive) continue;
    const dx = slime.x - x;
    const dy = slime.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = slime;
    }
  }
  return best;
}

function resolveAim(player, aimData, autoAim, autoAimRange = Infinity) {
  if (autoAim) {
    const target = findNearestAliveSlime(player.x, player.y, autoAimRange);
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

function castSoulFire(player, aimData, autoAim = false) {
  if (player.avatar !== 'mage') return false;
  const now = Date.now();
  if (now - player.lastSoulFireAt < SOUL_FIRE_COOLDOWN) return false;

  const aim = resolveAim(player, aimData, autoAim);
  player.lastSoulFireAt = now;
  player.aimX = aim.x;
  player.aimY = aim.y;

  const id = nextSoulFireId++;
  soulFires.set(id, {
    id,
    ownerId: player.id,
    x: player.x + aim.x * 43,
    y: player.y + aim.y * 43,
    vx: aim.x * SOUL_FIRE_SPEED,
    vy: aim.y * SOUL_FIRE_SPEED,
    radius: SOUL_FIRE_RADIUS,
    life: SOUL_FIRE_LIFE
  });

  return true;
}

function castSlash(player, aimData, autoAim = false) {
  if (player.avatar !== 'pirate') return false;
  const now = Date.now();
  if (now - player.lastSlashAt < SLASH_COOLDOWN) return false;

  const aim = resolveAim(player, aimData, autoAim, SLASH_RANGE + 220);
  player.lastSlashAt = now;
  player.aimX = aim.x;
  player.aimY = aim.y;

  const id = nextSlashId++;
  slashEffects.set(id, {
    id,
    ownerId: player.id,
    x: player.x,
    y: player.y,
    angle: Math.atan2(aim.y, aim.x),
    life: SLASH_EFFECT_LIFE
  });

  const minDot = Math.cos(SLASH_HALF_ANGLE);

  for (const slime of slimes.values()) {
    if (!slime.alive) continue;
    const dx = slime.x - player.x;
    const dy = slime.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SLASH_RANGE + slime.radius) continue;

    if (dist > 25) {
      const dot = (dx / dist) * aim.x + (dy / dist) * aim.y;
      if (dot < minDot) continue;
    }

    slime.hp -= SLASH_DAMAGE;
    if (slime.hp <= 0) killSlime(slime, now);
  }

  return true;
}

function findInitialChainTarget(player, aim, autoAim) {
  if (autoAim) return findNearestAliveSlime(player.x, player.y, CHAIN_CAST_RANGE);

  let best = null;
  let bestScore = Infinity;

  for (const slime of slimes.values()) {
    if (!slime.alive) continue;

    const dx = slime.x - player.x;
    const dy = slime.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > CHAIN_CAST_RANGE || dist < 0.001) continue;

    const dot = (dx / dist) * aim.x + (dy / dist) * aim.y;
    if (dot < CHAIN_AIM_DOT) continue;

    const anglePenalty = (1 - dot) * 420;
    const score = dist + anglePenalty;
    if (score < bestScore) {
      bestScore = score;
      best = slime;
    }
  }

  return best;
}

function findNextChainTarget(current, hitIds) {
  let best = null;
  let bestD2 = CHAIN_RADIUS * CHAIN_RADIUS;

  for (const slime of slimes.values()) {
    if (!slime.alive || hitIds.has(slime.id)) continue;
    const dx = slime.x - current.x;
    const dy = slime.y - current.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = slime;
    }
  }

  return best;
}

function castChainLightning(player, aimData, autoAim = false) {
  if (player.avatar !== 'mage') return false;
  const now = Date.now();
  if (now - player.lastChainAt < CHAIN_COOLDOWN) return false;

  const aim = resolveAim(player, aimData, autoAim, CHAIN_CAST_RANGE);
  const first = findInitialChainTarget(player, aim, autoAim);
  if (!first) return false;

  player.lastChainAt = now;
  player.aimX = aim.x;
  player.aimY = aim.y;

  const hitIds = new Set();
  const segments = [];

  let current = first;
  let fromX = player.x;
  let fromY = player.y;

  for (let index = 0; index < CHAIN_MAX_TARGETS && current; index++) {
    hitIds.add(current.id);

    segments.push({
      x1: fromX,
      y1: fromY,
      x2: current.x,
      y2: current.y
    });

    const damage = Math.max(1, Math.round(CHAIN_DAMAGE * (1 - index * 0.10)));
    current.hp -= damage;

    const currentX = current.x;
    const currentY = current.y;

    if (current.hp <= 0) killSlime(current, now);

    if (index >= CHAIN_MAX_TARGETS - 1) break;

    const next = findNextChainTarget({ x: currentX, y: currentY }, hitIds);
    fromX = currentX;
    fromY = currentY;
    current = next;
  }

  const effectId = nextChainEffectId++;
  chainEffects.set(effectId, {
    id: effectId,
    segments,
    life: CHAIN_EFFECT_LIFE
  });

  return true;
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
    world: WORLD,
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
    if (!p) return;

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

    if (p.moving) {
      p.direction = directionFromVector(x, y, p.direction);
    }
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
    if (!AVATARS.includes(avatar)) return;
    p.avatar = avatar;
  });

  socket.on('castSoulFire', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const success = castSoulFire(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', {
      success,
      skill: 'soulFire',
      cooldown: SOUL_FIRE_COOLDOWN
    });
  });

  socket.on('castSlash', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const success = castSlash(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', {
      success,
      skill: 'slash',
      cooldown: SLASH_COOLDOWN
    });
  });

  socket.on('castChain', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const success = castChainLightning(p, data.aim, !!data.autoAim);
    socket.emit('skillCastResult', {
      success,
      skill: 'chain',
      cooldown: CHAIN_COOLDOWN
    });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('count', { current: players.size, max: MAX_PLAYERS });
  });
});

let lastTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  for (const p of players.values()) {
    p.x = clamp(
      p.x + p.inputX * PLAYER_SPEED * dt,
      PLAYER_RADIUS,
      WORLD.width - PLAYER_RADIUS
    );
    p.y = clamp(
      p.y + p.inputY * PLAYER_SPEED * dt,
      PLAYER_RADIUS,
      WORLD.height - PLAYER_RADIUS
    );
  }

  for (const slime of slimes.values()) {
    if (!slime.alive) {
      if (!slime.boss && now >= slime.respawnAt) respawnSlime(slime);
      continue;
    }

    if (now >= slime.changeAt) chooseSlimeDirection(slime);

    slime.x += slime.vx * dt;
    slime.y += slime.vy * dt;

    if (slime.x < slime.radius || slime.x > WORLD.width - slime.radius) {
      slime.vx *= -1;
      slime.x = clamp(slime.x, slime.radius, WORLD.width - slime.radius);
    }

    if (slime.y < slime.radius || slime.y > WORLD.height - slime.radius) {
      slime.vy *= -1;
      slime.y = clamp(slime.y, slime.radius, WORLD.height - slime.radius);
    }
  }

  for (const fire of [...soulFires.values()]) {
    fire.x += fire.vx * dt;
    fire.y += fire.vy * dt;
    fire.life -= dt;

    if (
      fire.life <= 0 ||
      fire.x < -60 ||
      fire.x > WORLD.width + 60 ||
      fire.y < -60 ||
      fire.y > WORLD.height + 60
    ) {
      soulFires.delete(fire.id);
      continue;
    }

    for (const slime of slimes.values()) {
      if (!slime.alive) continue;

      const dx = slime.x - fire.x;
      const dy = slime.y - fire.y;
      const hit = slime.radius + fire.radius;

      if (dx * dx + dy * dy <= hit * hit) {
        slime.hp -= SOUL_FIRE_DAMAGE;
        soulFires.delete(fire.id);
        if (slime.hp <= 0) killSlime(slime, now);
        break;
      }
    }
  }

  for (const slash of [...slashEffects.values()]) {
    slash.life -= dt;
    if (slash.life <= 0) slashEffects.delete(slash.id);
  }

  for (const effect of [...chainEffects.values()]) {
    effect.life -= dt;
    if (effect.life <= 0) chainEffects.delete(effect.id);
  }

  io.emit('state', {
    players: [...players.values()].map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      direction: p.direction,
      moving: p.moving,
      avatar: p.avatar
    })),

    slimes: [...slimes.values()].map(s => ({
      id: s.id,
      x: s.x,
      y: s.y,
      elite: s.elite,
      boss: s.boss,
      hp: s.hp,
      maxHp: s.maxHp,
      alive: s.alive
    })),

    soulFires: [...soulFires.values()].map(f => ({
      id: f.id,
      x: f.x,
      y: f.y
    })),

    slashEffects: [...slashEffects.values()].map(s => ({
      id: s.id,
      x: s.x,
      y: s.y,
      angle: s.angle,
      life: s.life
    })),

    chainEffects: [...chainEffects.values()].map(e => ({
      id: e.id,
      segments: e.segments,
      life: e.life
    })),

    bossProgress,
    bossTarget: BOSS_TARGET,
    bossActive: bossId !== null
  });
}, 1000 / TICK_RATE);

app.get('/mage.png', (_req, res) => {
  res.sendFile(path.join(__dirname, 'mage.png'));
});

app.get('/pirate.png', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pirate.png'));
});

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
#hud{position:fixed;left:12px;top:12px;z-index:20;color:#fff;background:rgba(8,14,8,.78);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:10px 13px;line-height:1.55;font-size:14px;backdrop-filter:blur(6px);pointer-events:none}
#status{font-weight:900}
#skillName,#skillState{color:#78f5ff;font-weight:900}
#bossProgress{color:#ffb5b5;font-weight:900}
#bossLocator{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;display:none;min-width:270px;padding:9px 14px;color:#fff4c7;background:rgba(112,18,27,.94);border:2px solid rgba(255,90,100,.8);border-radius:12px;text-align:center;font-size:13px;font-weight:900;pointer-events:none}
#safeMode{position:fixed;top:12px;right:12px;z-index:50;color:#e1ffe6;background:rgba(18,90,40,.94);border:2px solid rgba(118,255,153,.78);border-radius:12px;padding:9px 13px;font-size:13px;font-weight:900;text-align:center;pointer-events:none}
#safeMode small{display:block;margin-top:2px;font-size:10px;opacity:.85}
#avatarPanel{position:fixed;right:12px;top:76px;z-index:25;width:205px;color:#fff;background:rgba(8,14,8,.8);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:10px;backdrop-filter:blur(6px)}
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
#mobileHint{position:fixed;right:18px;bottom:max(188px,calc(env(safe-area-inset-bottom) + 188px));z-index:20;color:#fff;background:rgba(0,0,0,.38);padding:6px 9px;border-radius:8px;font-size:11px;pointer-events:none}
#clearMessage{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.42);pointer-events:none}
#clearMessage.active{display:flex;animation:clearBg .25s ease-out}
#clearBox{text-align:center;animation:clearPop .45s ease-out}
#clearTitle{color:#ffe477;font-size:clamp(64px,12vw,150px);font-weight:1000;letter-spacing:8px;text-shadow:0 4px 0 #8b571b,0 8px 25px rgba(0,0,0,.9),0 0 30px rgba(255,220,80,.5)}
#clearSub{margin-top:10px;color:#fff;font-size:clamp(18px,3vw,32px);font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.9)}
@keyframes clearPop{0%{opacity:0;transform:scale(.45)}65%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes clearBg{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,.42)}}
@media(pointer:fine){.joyZone,#chainBtn,#mobileHint{display:none!important}}
@media(max-width:700px){#avatarPanel{width:170px}#bossLocator{top:67px;min-width:220px;font-size:11px}#safeMode{font-size:11px}}
</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="clearMessage"><div id="clearBox"><div id="clearTitle">CLEAR!</div><div id="clearSub">👑 보스 슬라임 처치 완료</div></div></div>
<div id="hud">
  <div id="status">서버 연결 중...</div>
  <div>접속자: <span id="count">0</span>/<span id="maxCount">20</span>명</div>
  <div>캐릭터: <span id="currentAvatarName">마법사</span></div>
  <div>E 공격: <span id="skillName">영혼불</span></div>
  <div>Q 스킬: <span id="chainState">체인 라이트닝</span></div>
  <div>상태: <span id="skillState">대기</span></div>
  <div>보스 게이지: <span id="bossProgress">0 / 20</span></div>
</div>
<div id="bossLocator">👑 BOSS 위치</div>
<div id="safeMode">🛡️ 안전 모드 ON<small>플레이어 공격 불가</small></div>
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
<div id="mobileHint">왼쪽 이동 · 오른쪽 조준 후 놓아서 공격</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const maxCountEl = document.getElementById('maxCount');
const currentAvatarNameEl = document.getElementById('currentAvatarName');
const skillNameEl = document.getElementById('skillName');
const chainStateEl = document.getElementById('chainState');
const skillStateEl = document.getElementById('skillState');
const bossProgressEl = document.getElementById('bossProgress');
const bossLocatorEl = document.getElementById('bossLocator');
const clearMessageEl = document.getElementById('clearMessage');
const avatarButtons = [...document.querySelectorAll('.avatarBtn')];
const moveJoy = document.getElementById('moveJoy');
const moveKnob = document.getElementById('moveKnob');
const attackJoy = document.getElementById('attackJoy');
const attackKnob = document.getElementById('attackKnob');
const attackLabel = document.getElementById('attackLabel');
const chainBtn = document.getElementById('chainBtn');

let myId = null;
let world = { width: 5200, height: 3400 };
let players = [];
let slimes = [];
let soulFires = [];
let slashEffects = [];
let chainEffects = [];
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
let cooldownUntil = { mage: 0, pirate: 0, chain: 0 };
let clearMessageTimer = null;

function cClamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function normalizeClient(x, y, fx, fy) {
  const len = Math.hypot(x, y);
  if (len < 0.001) return { x: fx, y: fy };
  return { x: x / len, y: y / len };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
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
mageImage.src = '/mage.png?v=60';

const pirateImage = new Image();
let pirateReady = false;
pirateImage.onload = () => { pirateReady = true; };
pirateImage.onerror = () => { statusEl.textContent = 'pirate.png 로드 실패'; };
pirateImage.src = '/pirate.png?v=60';

socket.on('connect', () => {
  if (!serverFull) statusEl.textContent = '숲 서버 접속됨';
});

socket.on('welcome', data => {
  myId = data.id;
  world = data.world;
  soulFireCooldown = data.soulFireCooldown;
  slashCooldown = data.slashCooldown;
  chainCooldown = data.chainCooldown;
  slashRange = data.slashRange;
  slashHalfAngle = data.slashHalfAngle;
  maxCountEl.textContent = data.maxPlayers;
  setAvatar('mage');
});

socket.on('count', data => {
  countEl.textContent = data.current;
  maxCountEl.textContent = data.max;
});

socket.on('state', data => {
  players = data.players || [];
  slimes = data.slimes || [];
  soulFires = data.soulFires || [];
  slashEffects = data.slashEffects || [];
  chainEffects = data.chainEffects || [];
  if (data.bossActive) bossProgressEl.textContent = '👑 보스 전투중';
  else bossProgressEl.textContent = data.bossProgress + ' / ' + data.bossTarget;
});

socket.on('bossSpawned', data => {
  skillStateEl.textContent = '👑 보스 슬라임 출현!';
  bossLocatorEl.style.display = 'block';
  bossLocatorEl.textContent = '👑 BOSS · X ' + Math.round(data.x) + ' · Y ' + Math.round(data.y);
});

socket.on('bossDefeated', () => {
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
    skillStateEl.textContent = data.skill === 'chain' ? '체인 라이트닝 대상 없음 또는 쿨타임' : '쿨타임';
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

function getMe() { return players.find(p => p.id === myId) || null; }
function getBoss() { return slimes.find(s => s.boss && s.alive) || null; }

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
  if (len < 0.001) return null;
  return { x: dx / len, y: dy / len };
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
  if (Math.abs(aim.x - lastAimX) > .01 || Math.abs(aim.y - lastAimY) > .01) {
    socket.emit('aim', aim);
    lastAimX = aim.x;
    lastAimY = aim.y;
  }
}

function castPrimary(aim, autoAim) {
  if (serverFull) return;
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
  if (performance.now() < cooldownUntil.chain) {
    skillStateEl.textContent = '체인 라이트닝 쿨타임';
    return;
  }
  socket.emit('castChain', { aim, autoAim: !!autoAim });
}

addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) {
    keys.add(key);
    event.preventDefault();
  }
  if (key === 'e') {
    const aim = getMouseAim() || getAttackAim();
    if (aim) {
      sendAim(aim);
      castPrimary(aim, false);
    }
    event.preventDefault();
  }
  if (key === 'q' && selectedAvatar === 'mage') {
    const aim = getMouseAim() || getAttackAim();
    if (aim) {
      sendAim(aim);
      castChain(aim, false);
    }
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

function joyVector(element, clientX, clientY, deadZone) {
  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * .34;
  let dx = clientX - cx;
  let dy = clientY - cy;
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
  const v = joyVector(moveJoy, event.clientX, event.clientY, .12);
  moveX = v.nx;
  moveY = v.ny;
  setKnob(moveKnob, v.dx, v.dy);
});

moveJoy.addEventListener('pointermove', event => {
  if (event.pointerId !== movePointerId) return;
  const v = joyVector(moveJoy, event.clientX, event.clientY, .12);
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
  if (v.amount >= .08) {
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
  if (v.amount >= .08) {
    const aim = normalizeClient(v.nx, v.ny, lastMobileAim.x, lastMobileAim.y);
    attackX = aim.x;
    attackY = aim.y;
    lastMobileAim = aim;
    sendAim(aim);
  }
});

function releaseAttack(event) {
  if (event.pointerId !== attackPointerId) return;
  const manual = attackDragAmount >= .20;
  const aim = manual ? { x: attackX, y: attackY } : lastMobileAim;
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
  const hasManualAim = attackDragging && attackDragAmount >= .20;
  const aim = hasManualAim ? { x: attackX, y: attackY } : lastMobileAim;
  castChain(aim, !hasManualAim);
});

setInterval(() => {
  if (serverFull) return;
  let x = 0;
  let y = 0;
  if (keys.has('a') || keys.has('arrowleft')) x--;
  if (keys.has('d') || keys.has('arrowright')) x++;
  if (keys.has('w') || keys.has('arrowup')) y--;
  if (keys.has('s') || keys.has('arrowdown')) y++;
  if (Math.abs(moveX) > .01 || Math.abs(moveY) > .01) {
    x = moveX;
    y = moveY;
  }
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  if (Math.abs(x - lastInputX) > .01 || Math.abs(y - lastInputY) > .01) {
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
  return x > cx - margin && x < cx + innerWidth + margin && y > cy - margin && y < cy + innerHeight + margin;
}

function hashRand(n) {
  const value = Math.sin(n * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function drawForest(cx, cy) {
  ctx.fillStyle = '#3d6b34';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.fillStyle = '#98764c';
  ctx.fillRect(-cx, 1580 - cy, world.width, 105);
  ctx.fillRect(2510 - cx, -cy, 110, world.height);

  for (let i = 0; i < 150; i++) {
    const x = 90 + hashRand(i + 1) * (world.width - 180);
    const y = 90 + hashRand(i + 701) * (world.height - 180);
    const size = 22 + hashRand(i + 1401) * 24;
    if (!visible(x, y, 90, cx, cy)) continue;
    const sx = x - cx;
    const sy = y - cy;

    ctx.beginPath();
    ctx.ellipse(sx, sy + 25, size * .72, size * .25, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.fill();
    ctx.fillStyle = '#694526';
    ctx.fillRect(sx - size * .12, sy, size * .24, size * .85);
    ctx.beginPath();
    ctx.arc(sx, sy - 8, size, 0, Math.PI * 2);
    ctx.arc(sx - size * .55, sy, size * .58, 0, Math.PI * 2);
    ctx.arc(sx + size * .55, sy, size * .58, 0, Math.PI * 2);
    ctx.fillStyle = '#287a3e';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx - size * .25, sy - size * .28, size * .3, 0, Math.PI * 2);
    ctx.fillStyle = '#47a457';
    ctx.fill();
  }

  for (let i = 0; i < 180; i++) {
    const x = hashRand(i + 2701) * world.width;
    const y = hashRand(i + 3301) * world.height;
    if (!visible(x, y, 15, cx, cy)) continue;
    ctx.beginPath();
    ctx.arc(x - cx, y - cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = ['#ffe082','#ff9e9e','#c9a3ff','#9ee7ff'][i % 4];
    ctx.fill();
  }
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
  const row = directionRow(player.direction);
  const col = walkFrame(player);
  const footY = 30;
  ctx.save();
  ctx.translate(Math.round(screenX), Math.round(screenY));

  if (player.avatar === 'pirate') {
    const frame = PIRATE_FRAMES[row][col];
    const scale = .39;
    if (pirateReady) {
      ctx.drawImage(pirateImage, frame.x, frame.y, frame.w, frame.h, -frame.anchorX * scale, footY - frame.h * scale, frame.w * scale, frame.h * scale);
    }
  } else {
    const frame = MAGE_FRAMES[row][col];
    const scale = .43;
    if (mageReady) {
      const drawW = frame.w * scale;
      const drawH = frame.h * scale;
      ctx.drawImage(mageImage, frame.x, frame.y, frame.w, frame.h, -drawW / 2, footY - drawH, drawW, drawH);
    }
  }

  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,.42)';
  ctx.fillRect(screenX - 34, screenY - 84, 68, 18);
  ctx.fillStyle = isMe ? '#ffe082' : '#fff';
  ctx.font = '700 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(isMe ? 'YOU' : 'P-' + player.id.slice(0, 4), screenX, screenY - 71);
}

function drawSlime(slime, cx, cy) {
  if (!slime.alive) return;
  const x = slime.x - cx;
  const y = slime.y - cy;
  const radius = slime.boss ? 78 : slime.elite ? 34 : 24;
  const bounce = Math.sin(performance.now() / 180 + slime.id) * (slime.boss ? 4 : 2.5);

  ctx.save();
  ctx.translate(x, y + bounce);
  ctx.beginPath();
  ctx.ellipse(0, radius * .72, radius * .82, radius * .27, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-radius, 8);
  ctx.quadraticCurveTo(-radius, -radius * .7, 0, -radius);
  ctx.quadraticCurveTo(radius, -radius * .7, radius, 8);
  ctx.quadraticCurveTo(0, radius * .85, -radius, 8);
  ctx.fillStyle = slime.boss ? '#b32641' : slime.elite ? '#774dd0' : '#58c96f';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-radius * .28, -radius * .28, radius * .2, radius * .12, -.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.2)';
  ctx.fill();
  ctx.fillStyle = '#151719';
  ctx.beginPath();
  ctx.arc(-radius * .3, -4, slime.boss ? 7 : 3, 0, Math.PI * 2);
  ctx.arc(radius * .3, -4, slime.boss ? 7 : 3, 0, Math.PI * 2);
  ctx.fill();

  if (slime.elite || slime.boss) {
    const crownY = -radius - 4;
    const size = slime.boss ? 22 : 13;
    ctx.fillStyle = '#ffd259';
    ctx.beginPath();
    ctx.moveTo(-size, crownY);
    ctx.lineTo(-size * .6, crownY - size);
    ctx.lineTo(0, crownY - size * .4);
    ctx.lineTo(size * .6, crownY - size);
    ctx.lineTo(size, crownY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const barW = slime.boss ? 180 : slime.elite ? 68 : 48;
  const hpPercent = Math.max(0, slime.hp / slime.maxHp);
  const hpY = y - radius - (slime.boss ? 43 : 22);
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fillRect(x - barW / 2, hpY, barW, slime.boss ? 13 : 7);
  ctx.fillStyle = slime.boss ? '#ff334f' : slime.elite ? '#e5b84d' : '#ef6666';
  ctx.fillRect(x - barW / 2 + 2, hpY + 2, (barW - 4) * hpPercent, slime.boss ? 9 : 3);

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
  ctx.moveTo(x - 8, y + 5);
  ctx.quadraticCurveTo(x - 20, y + 16, x - 12, y + 31);
  ctx.quadraticCurveTo(x, y + 20, x + 8, y + 5);
  ctx.fillStyle = 'rgba(20,210,235,.62)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 11 + pulse * .35, 0, Math.PI * 2);
  ctx.fillStyle = '#23dce9';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - 2, y - 2, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = '#d2ffff';
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = time * .55 + i * 1.57;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 18, y + Math.sin(a) * 13, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(185,255,255,.85)';
    ctx.fill();
  }
  ctx.restore();
}

function drawSlash(slash, cx, cy) {
  const x = slash.x - cx;
  const y = slash.y - cy;
  const lifePercent = Math.max(0, Math.min(1, slash.life / 0.28));
  const progress = 1 - lifePercent;
  const radius = 75 + progress * 55;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(slash.angle);
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(0, 0, radius, -.7, .7);
  ctx.strokeStyle = 'rgba(255,225,140,' + lifePercent + ')';
  ctx.lineWidth = 15 * lifePercent + 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius - 5, -.66, .66);
  ctx.strokeStyle = 'rgba(255,255,245,' + lifePercent + ')';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius - 18, -.53, .53);
  ctx.strokeStyle = 'rgba(255,145,40,' + (lifePercent * .85) + ')';
  ctx.lineWidth = 5;
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
  const points = [{ x: x1, y: y1 }];
  const steps = 5;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const amp = 14 * Math.sin(Math.PI * t);
    const offset = (seededNoise(seed + i * 17.13 + Math.floor(performance.now() / 55)) - .5) * 2 * amp;
    points.push({ x: x1 + dx * t + px * offset, y: y1 + dy * t + py * offset });
  }
  points.push({ x: x2, y: y2 });

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#77f7ff';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = 'rgba(47,220,232,' + (.72 * alpha) + ')';
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
  const alpha = Math.max(0, Math.min(1, effect.life / .28));
  effect.segments.forEach((seg, index) => {
    drawLightningSegment(seg, effect.id * 31 + index * 7, cx, cy, alpha);
  });
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
  const distance = Math.round(Math.hypot(dx, dy));
  bossLocatorEl.textContent = '👑 BOSS ' + bossDirectionText(dx, dy) + ' · 거리 ' + distance + ' · X ' + Math.round(boss.x) + ' Y ' + Math.round(boss.y);
}

function drawBossGuide() {
  const boss = getBoss();
  const me = getMe();
  if (!boss || !me) return;
  const sx = boss.x - cameraX;
  const sy = boss.y - cameraY;
  const margin = 70;
  const inside = sx > margin && sx < innerWidth - margin && sy > margin && sy < innerHeight - margin;

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
  const scaleX = Math.abs(cos) > .001 ? maxX / Math.abs(cos) : Infinity;
  const scaleY = Math.abs(sin) > .001 ? maxY / Math.abs(sin) : Infinity;
  const scale = Math.min(scaleX, scaleY);
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
  if (!me) return;
  const px = me.x - cameraX;
  const py = me.y - cameraY;
  const aim = { x: attackX, y: attackY };

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

  drawForest(cameraX, cameraY);

  for (const slime of slimes) {
    if (visible(slime.x, slime.y, 190, cameraX, cameraY)) drawSlime(slime, cameraX, cameraY);
  }

  for (const fire of soulFires) {
    if (visible(fire.x, fire.y, 70, cameraX, cameraY)) drawSoulFire(fire, cameraX, cameraY);
  }

  for (const effect of chainEffects) drawChainEffect(effect, cameraX, cameraY);

  const ordered = [...players].sort((a, b) => a.y - b.y);
  for (const player of ordered) {
    if (!visible(player.x, player.y, 190, cameraX, cameraY)) continue;
    drawCharacter(player, player.x - cameraX, player.y - cameraY, player.id === myId);
  }

  for (const slash of slashEffects) {
    if (visible(slash.x, slash.y, 190, cameraX, cameraY)) drawSlash(slash, cameraX, cameraY);
  }

  drawAttackPreview();
  updateBossLocator();
  drawBossGuide();
}

render();
</script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log('Forest RPG running on port ' + PORT);
  console.log('SAFE MODE: ON');
  console.log('Normal slimes: ' + NORMAL_SLIMES);
  console.log('Elite slimes: ' + ELITE_SLIMES);
  console.log('Boss target: ' + BOSS_TARGET);
  console.log('Chain lightning: ON');
});

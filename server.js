const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const WORLD = {
  width: 5200,
  height: 3400
};

const PLAYER_RADIUS = 26;
const PLAYER_SPEED = 320;
const TICK_RATE = 30;
const MAX_PLAYERS = 20;

const AVATARS = ['knight', 'archer', 'mage', 'rogue'];

const players = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function generateForestDecor() {
  const rand = createRng(20260904);

  const decor = {
    clearings: [
      { x: 500, y: 500, w: 760, h: 500, r: 30 },
      { x: 1800, y: 1400, w: 900, h: 620, r: 30 },
      { x: 3600, y: 700, w: 800, h: 520, r: 30 },
      { x: 3400, y: 2200, w: 1000, h: 650, r: 30 },
      { x: 900, y: 2400, w: 780, h: 520, r: 30 }
    ],
    paths: [
      { x: 350, y: 1520, w: 4500, h: 90, r: 40 },
      { x: 2480, y: 350, w: 110, h: 2700, r: 40 },
      { x: 850, y: 820, w: 1900, h: 80, r: 35 },
      { x: 2580, y: 2360, w: 1500, h: 80, r: 35 }
    ],
    ponds: [],
    trees: [],
    bushes: [],
    rocks: [],
    flowers: []
  };

  for (let i = 0; i < 5; i++) {
    decor.ponds.push({
      x: 700 + rand() * 3800,
      y: 500 + rand() * 2200,
      rx: 70 + rand() * 90,
      ry: 45 + rand() * 65
    });
  }

  for (let i = 0; i < 170; i++) {
    decor.trees.push({
      x: 90 + rand() * (WORLD.width - 180),
      y: 90 + rand() * (WORLD.height - 180),
      size: 22 + rand() * 22
    });
  }

  for (let i = 0; i < 110; i++) {
    decor.bushes.push({
      x: 50 + rand() * (WORLD.width - 100),
      y: 50 + rand() * (WORLD.height - 100),
      size: 14 + rand() * 18
    });
  }

  for (let i = 0; i < 55; i++) {
    decor.rocks.push({
      x: 50 + rand() * (WORLD.width - 100),
      y: 50 + rand() * (WORLD.height - 100),
      w: 18 + rand() * 24,
      h: 12 + rand() * 18
    });
  }

  for (let i = 0; i < 220; i++) {
    decor.flowers.push({
      x: 20 + rand() * (WORLD.width - 40),
      y: 20 + rand() * (WORLD.height - 40),
      size: 2 + rand() * 2,
      color:
        ['#ffd54f', '#ff8a80', '#ce93d8', '#80deea', '#ffffff'][
          Math.floor(rand() * 5)
        ]
    });
  }

  return decor;
}

const FOREST_DECOR = generateForestDecor();

function makePlayer(id) {
  return {
    id,
    x: 500 + Math.random() * (WORLD.width - 1000),
    y: 500 + Math.random() * (WORLD.height - 1000),
    inputX: 0,
    inputY: 0,
    angle: 0,
    avatar: 'knight'
  };
}

io.on('connection', (socket) => {
  if (players.size >= MAX_PLAYERS) {
    socket.emit('serverFull', { maxPlayers: MAX_PLAYERS });

    setTimeout(() => {
      socket.disconnect(true);
    }, 400);

    return;
  }

  const player = makePlayer(socket.id);
  players.set(socket.id, player);

  socket.emit('welcome', {
    id: socket.id,
    world: WORLD,
    maxPlayers: MAX_PLAYERS,
    decor: FOREST_DECOR,
    avatar: player.avatar
  });

  io.emit('count', {
    current: players.size,
    max: MAX_PLAYERS
  });

  socket.on('input', (data = {}) => {
    const current = players.get(socket.id);
    if (!current) return;

    let x = Number(data.x) || 0;
    let y = Number(data.y) || 0;

    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }

    current.inputX = clamp(x, -1, 1);
    current.inputY = clamp(y, -1, 1);

    if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) {
      current.angle = Math.atan2(y, x);
    }
  });

  socket.on('setAvatar', (data = {}) => {
    const current = players.get(socket.id);
    if (!current) return;

    const avatar = String(data.avatar || '');
    if (!AVATARS.includes(avatar)) return;

    current.avatar = avatar;
  });

  socket.on('disconnect', () => {
    if (!players.has(socket.id)) return;

    players.delete(socket.id);

    io.emit('count', {
      current: players.size,
      max: MAX_PLAYERS
    });
  });
});

let last = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  for (const player of players.values()) {
    player.x += player.inputX * PLAYER_SPEED * dt;
    player.y += player.inputY * PLAYER_SPEED * dt;

    player.x = clamp(player.x, PLAYER_RADIUS, WORLD.width - PLAYER_RADIUS);
    player.y = clamp(player.y, PLAYER_RADIUS, WORLD.height - PLAYER_RADIUS);
  }

  io.emit(
    'state',
    Array.from(players.values(), (player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      angle: player.angle,
      avatar: player.avatar
    }))
  );
}, 1000 / TICK_RATE);

app.get('/', (_req, res) => {
  res.type('html').send(`
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no"
/>
<title>Forest Open Server</title>

<style>
* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #152313;
  font-family: system-ui, sans-serif;
  touch-action: none;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

#hud {
  position: fixed;
  left: 12px;
  top: 12px;
  z-index: 20;
  color: white;
  background: rgba(0, 0, 0, 0.42);
  padding: 10px 13px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  backdrop-filter: blur(6px);
}

#status {
  font-weight: 800;
}

#selector {
  position: fixed;
  right: 12px;
  top: 12px;
  z-index: 20;
  width: min(320px, calc(100vw - 24px));
  color: white;
  background: rgba(0, 0, 0, 0.42);
  padding: 12px;
  border-radius: 14px;
  backdrop-filter: blur(6px);
}

#selectorTitle {
  font-size: 15px;
  font-weight: 800;
  margin-bottom: 10px;
}

#avatarGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.avatarBtn {
  border: 2px solid rgba(255,255,255,.18);
  background: rgba(255,255,255,.08);
  color: white;
  border-radius: 12px;
  padding: 10px 8px;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.avatarBtn.selected {
  border-color: #ffe082;
  background: rgba(255, 224, 130, 0.18);
}

.avatarName {
  display: block;
  font-weight: 800;
  margin-bottom: 2px;
}

.avatarDesc {
  display: block;
  font-size: 12px;
  opacity: .88;
}

#joystick {
  position: fixed;
  left: 22px;
  bottom: 22px;
  width: 145px;
  height: 145px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.35);
  background: rgba(255,255,255,.10);
  z-index: 20;
  touch-action: none;
}

#stick {
  position: absolute;
  left: 47px;
  top: 47px;
  width: 51px;
  height: 51px;
  border-radius: 50%;
  background: rgba(255,255,255,.82);
  box-shadow: 0 4px 16px rgba(0,0,0,.25);
  pointer-events: none;
}

#hint {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 20;
  color: rgba(255,255,255,.86);
  background: rgba(0,0,0,.36);
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
}

@media (max-width: 780px) {
  #selector {
    top: auto;
    bottom: 88px;
  }
}

@media (pointer: fine) {
  #joystick {
    opacity: .4;
  }
}
</style>
</head>
<body>

<canvas id="game"></canvas>

<div id="hud">
  <div id="status">서버 연결 중...</div>
  <div>접속자: <span id="count">0</span> / <span id="maxCount">20</span>명</div>
  <div>맵: 숲 오픈서버</div>
  <div>내 캐릭터: <span id="currentAvatar">기사</span></div>
</div>

<div id="selector">
  <div id="selectorTitle">캐릭터 선택</div>
  <div id="avatarGrid">
    <button class="avatarBtn selected" data-avatar="knight">
      <span class="avatarName">⚔️ 기사</span>
      <span class="avatarDesc">갑옷과 방패</span>
    </button>
    <button class="avatarBtn" data-avatar="archer">
      <span class="avatarName">🏹 궁수</span>
      <span class="avatarDesc">활과 후드</span>
    </button>
    <button class="avatarBtn" data-avatar="mage">
      <span class="avatarName">🔮 마법사</span>
      <span class="avatarDesc">지팡이와 로브</span>
    </button>
    <button class="avatarBtn" data-avatar="rogue">
      <span class="avatarName">🗡️ 도적</span>
      <span class="avatarDesc">단검과 망토</span>
    </button>
  </div>
</div>

<div id="joystick"><div id="stick"></div></div>

<div id="hint">PC: WASD / 방향키 · 모바일: 조이스틱</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const maxCountEl = document.getElementById('maxCount');
const currentAvatarEl = document.getElementById('currentAvatar');

const joystick = document.getElementById('joystick');
const stick = document.getElementById('stick');

const avatarButtons = Array.from(document.querySelectorAll('.avatarBtn'));

const avatarNameMap = {
  knight: '기사',
  archer: '궁수',
  mage: '마법사',
  rogue: '도적'
};

let myId = null;
let myAvatar = 'knight';

let world = { width: 5200, height: 3400 };
let decor = {
  clearings: [],
  paths: [],
  ponds: [],
  trees: [],
  bushes: [],
  rocks: [],
  flowers: []
};

let players = [];

let keys = new Set();
let touchX = 0;
let touchY = 0;
let joystickPointer = null;
let serverIsFull = false;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function selectAvatar(type) {
  myAvatar = type;
  currentAvatarEl.textContent = avatarNameMap[type] || type;

  avatarButtons.forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.avatar === type);
  });

  if (!serverIsFull) {
    socket.emit('setAvatar', { avatar: type });
  }
}

avatarButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    selectAvatar(btn.dataset.avatar);
  });
});

socket.on('connect', () => {
  if (!serverIsFull) {
    statusEl.textContent = '공개 서버 접속됨';
  }
});

socket.on('welcome', (data) => {
  myId = data.id;
  world = data.world;
  decor = data.decor;
  maxCountEl.textContent = data.maxPlayers;

  if (data.avatar) {
    selectAvatar(data.avatar);
  }
});

socket.on('serverFull', (data) => {
  serverIsFull = true;
  statusEl.textContent = '서버가 가득 찼습니다';
  countEl.textContent = data.maxPlayers;
  maxCountEl.textContent = data.maxPlayers;
  joystick.style.display = 'none';
  socket.io.opts.reconnection = false;
});

socket.on('disconnect', () => {
  if (serverIsFull) {
    statusEl.textContent = '서버가 가득 찼습니다';
    return;
  }
  statusEl.textContent = '서버 연결 끊김 · 재접속 중...';
});

socket.on('count', (data) => {
  countEl.textContent = data.current;
  maxCountEl.textContent = data.max;
});

socket.on('state', (state) => {
  players = state;
  const me = players.find((p) => p.id === myId);
  if (me && me.avatar) {
    myAvatar = me.avatar;
    currentAvatarEl.textContent = avatarNameMap[me.avatar] || me.avatar;
  }
});

addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();

  if (
    ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
  ) {
    keys.add(key);
    e.preventDefault();
  }
});

addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
});

function setJoystickFromPoint(clientX, clientY) {
  const rect = joystick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  let dx = clientX - centerX;
  let dy = clientY - centerY;

  const max = rect.width * 0.34;
  const length = Math.hypot(dx, dy);

  if (length > max) {
    dx = (dx / length) * max;
    dy = (dy / length) * max;
  }

  touchX = dx / max;
  touchY = dy / max;

  stick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
}

joystick.addEventListener('pointerdown', (e) => {
  joystickPointer = e.pointerId;
  joystick.setPointerCapture(e.pointerId);
  setJoystickFromPoint(e.clientX, e.clientY);
});

joystick.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joystickPointer) return;
  setJoystickFromPoint(e.clientX, e.clientY);
});

function releaseJoystick(e) {
  if (e.pointerId !== joystickPointer) return;

  joystickPointer = null;
  touchX = 0;
  touchY = 0;
  stick.style.transform = 'translate(0px,0px)';
}

joystick.addEventListener('pointerup', releaseJoystick);
joystick.addEventListener('pointercancel', releaseJoystick);

let lastSentX = 999;
let lastSentY = 999;

setInterval(() => {
  if (serverIsFull) return;

  let x = 0;
  let y = 0;

  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;

  if (Math.abs(touchX) > 0.08 || Math.abs(touchY) > 0.08) {
    x = touchX;
    y = touchY;
  }

  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }

  if (Math.abs(x - lastSentX) > 0.01 || Math.abs(y - lastSentY) > 0.01) {
    socket.emit('input', { x, y });
    lastSentX = x;
    lastSentY = y;
  }
}, 33);

function isVisible(x, y, margin, cameraX, cameraY) {
  return (
    x >= cameraX - margin &&
    x <= cameraX + innerWidth + margin &&
    y >= cameraY - margin &&
    y <= cameraY + innerHeight + margin
  );
}

function drawForest(cameraX, cameraY) {
  ctx.fillStyle = '#355d2a';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  for (const clearing of decor.clearings) {
    if (!isVisible(clearing.x, clearing.y, 500, cameraX, cameraY)) continue;
    roundRectPath(
      ctx,
      clearing.x - cameraX,
      clearing.y - cameraY,
      clearing.w,
      clearing.h,
      clearing.r
    );
    ctx.fillStyle = '#456f35';
    ctx.fill();
  }

  for (const path of decor.paths) {
    if (!isVisible(path.x, path.y, 500, cameraX, cameraY)) continue;
    roundRectPath(
      ctx,
      path.x - cameraX,
      path.y - cameraY,
      path.w,
      path.h,
      path.r
    );
    ctx.fillStyle = '#927449';
    ctx.fill();
  }

  for (const pond of decor.ponds) {
    if (!isVisible(pond.x, pond.y, 220, cameraX, cameraY)) continue;

    ctx.beginPath();
    ctx.ellipse(
      pond.x - cameraX,
      pond.y - cameraY,
      pond.rx,
      pond.ry,
      0,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = '#4ea0c8';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      pond.x - cameraX - 10,
      pond.y - cameraY - 8,
      pond.rx * 0.52,
      pond.ry * 0.40,
      0,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fill();
  }

  for (const flower of decor.flowers) {
    if (!isVisible(flower.x, flower.y, 30, cameraX, cameraY)) continue;
    ctx.beginPath();
    ctx.arc(flower.x - cameraX, flower.y - cameraY, flower.size, 0, Math.PI * 2);
    ctx.fillStyle = flower.color;
    ctx.fill();
  }

  for (const rock of decor.rocks) {
    if (!isVisible(rock.x, rock.y, 80, cameraX, cameraY)) continue;

    ctx.beginPath();
    ctx.ellipse(
      rock.x - cameraX,
      rock.y - cameraY,
      rock.w,
      rock.h,
      0,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = '#7c837c';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      rock.x - cameraX - 3,
      rock.y - cameraY - 3,
      rock.w * 0.45,
      rock.h * 0.35,
      0,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fill();
  }

  for (const bush of decor.bushes) {
    if (!isVisible(bush.x, bush.y, 70, cameraX, cameraY)) continue;

    ctx.beginPath();
    ctx.arc(bush.x - cameraX - bush.size * 0.4, bush.y - cameraY, bush.size * 0.72, 0, Math.PI * 2);
    ctx.arc(bush.x - cameraX + bush.size * 0.1, bush.y - cameraY - 4, bush.size * 0.85, 0, Math.PI * 2);
    ctx.arc(bush.x - cameraX + bush.size * 0.65, bush.y - cameraY + 2, bush.size * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = '#2f7d3c';
    ctx.fill();
  }

  for (const tree of decor.trees) {
    if (!isVisible(tree.x, tree.y, 90, cameraX, cameraY)) continue;

    ctx.beginPath();
    ctx.ellipse(
      tree.x - cameraX,
      tree.y - cameraY + tree.size * 0.72,
      tree.size * 0.80,
      tree.size * 0.34,
      0,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fill();

    ctx.fillStyle = '#6c4a27';
    ctx.fillRect(
      tree.x - cameraX - tree.size * 0.16,
      tree.y - cameraY + tree.size * 0.10,
      tree.size * 0.32,
      tree.size * 0.95
    );

    ctx.beginPath();
    ctx.arc(tree.x - cameraX, tree.y - cameraY, tree.size, 0, Math.PI * 2);
    ctx.arc(tree.x - cameraX - tree.size * 0.62, tree.y - cameraY + tree.size * 0.10, tree.size * 0.62, 0, Math.PI * 2);
    ctx.arc(tree.x - cameraX + tree.size * 0.62, tree.y - cameraY + tree.size * 0.12, tree.size * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = '#2f8f47';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(tree.x - cameraX - tree.size * 0.25, tree.y - cameraY - tree.size * 0.20, tree.size * 0.30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 5;
  ctx.strokeRect(-cameraX, -cameraY, world.width, world.height);
}

function drawLabel(text, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  roundRectPath(ctx, x - 36, y - 18, 72, 18, 8);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.96)';
  ctx.font = '700 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y - 5);
}

function drawShadow() {
  ctx.beginPath();
  ctx.ellipse(0, 20, 18, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.fill();
}

function drawKnight() {
  drawShadow();

  ctx.strokeStyle = '#39444e';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(-6, 18);
  ctx.moveTo(6, 4);
  ctx.lineTo(6, 18);
  ctx.stroke();

  roundRectPath(ctx, -12, -10, 24, 24, 8);
  ctx.fillStyle = '#6d88a5';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -19, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#d6dae1';
  ctx.fill();

  ctx.fillStyle = '#b13a3a';
  ctx.fillRect(-2, -31, 4, 10);

  ctx.strokeStyle = '#d9d9d9';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(10, -3);
  ctx.lineTo(26, -10);
  ctx.stroke();

  ctx.strokeStyle = '#8b6743';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(6, 2);
  ctx.lineTo(21, 8);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-16, -1, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#7c4f2f';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-16, -1, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#c9b27d';
  ctx.fill();
}

function drawArcher() {
  drawShadow();

  ctx.strokeStyle = '#4a3625';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(-6, 18);
  ctx.moveTo(6, 4);
  ctx.lineTo(6, 18);
  ctx.stroke();

  roundRectPath(ctx, -12, -10, 24, 24, 8);
  ctx.fillStyle = '#4b8c54';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -19, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#d7b08a';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -22, 11, 0, Math.PI * 2);
  ctx.strokeStyle = '#2e5c37';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.strokeStyle = '#8b5e34';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(18, 0, 12, -1.1, 1.1);
  ctx.stroke();

  ctx.strokeStyle = '#d9c0a2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(13, -10);
  ctx.lineTo(22, 10);
  ctx.stroke();

  ctx.fillStyle = '#654321';
  ctx.fillRect(-14, -12, 6, 18);
}

function drawMage() {
  drawShadow();

  ctx.strokeStyle = '#4a2f66';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, 3);
  ctx.lineTo(-8, 18);
  ctx.moveTo(5, 3);
  ctx.lineTo(8, 18);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-13, 13);
  ctx.lineTo(-9, -10);
  ctx.lineTo(9, -10);
  ctx.lineTo(13, 13);
  ctx.closePath();
  ctx.fillStyle = '#7054c8';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -19, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#e3bf9f';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-10, -22);
  ctx.lineTo(0, -34);
  ctx.lineTo(10, -22);
  ctx.closePath();
  ctx.fillStyle = '#4c2e9a';
  ctx.fill();

  ctx.strokeStyle = '#7f5b36';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(11, 2);
  ctx.lineTo(24, -12);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(27, -15, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#7ee0ff';
  ctx.fill();
}

function drawRogue() {
  drawShadow();

  ctx.strokeStyle = '#2e2e2e';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(-7, 18);
  ctx.moveTo(6, 4);
  ctx.lineTo(7, 18);
  ctx.stroke();

  roundRectPath(ctx, -12, -10, 24, 24, 8);
  ctx.fillStyle = '#5c6673';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -19, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#dab090';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -22, 11, 0, Math.PI * 2);
  ctx.strokeStyle = '#3e4650';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.strokeStyle = '#c8d1d9';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(10, -4);
  ctx.lineTo(22, -14);
  ctx.moveTo(10, 4);
  ctx.lineTo(22, 14);
  ctx.stroke();

  ctx.strokeStyle = '#262b31';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-8, -6);
  ctx.lineTo(-18, -11);
  ctx.stroke();
}

function drawCharacter(player, screenX, screenY, mine) {
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(player.angle || 0);

  switch (player.avatar) {
    case 'archer':
      drawArcher();
      break;
    case 'mage':
      drawMage();
      break;
    case 'rogue':
      drawRogue();
      break;
    default:
      drawKnight();
      break;
  }

  if (mine) {
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();

  drawLabel(mine ? 'YOU' : 'P-' + player.id.slice(0, 4), screenX, screenY - 28);
}

function render() {
  requestAnimationFrame(render);

  ctx.clearRect(0, 0, innerWidth, innerHeight);

  const me = players.find((p) => p.id === myId);

  let cameraX = 0;
  let cameraY = 0;

  if (me) {
    cameraX = me.x - innerWidth / 2;
    cameraY = me.y - innerHeight / 2;

    cameraX = Math.max(0, Math.min(Math.max(0, world.width - innerWidth), cameraX));
    cameraY = Math.max(0, Math.min(Math.max(0, world.height - innerHeight), cameraY));
  }

  drawForest(cameraX, cameraY);

  for (const player of players) {
    const screenX = player.x - cameraX;
    const screenY = player.y - cameraY;

    if (
      screenX < -100 ||
      screenX > innerWidth + 100 ||
      screenY < -100 ||
      screenY > innerHeight + 100
    ) {
      continue;
    }

    drawCharacter(player, screenX, screenY, player.id === myId);
  }
}

selectAvatar('knight');
render();
</script>
</body>
</html>
  `);
});

server.listen(PORT, () => {
  console.log('Forest server running on port ' + PORT);
  console.log('Max players: ' + MAX_PLAYERS);
});

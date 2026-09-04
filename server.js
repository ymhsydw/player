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
const PLAYER_RADIUS = 24;
const PLAYER_SPEED = 300;
const TICK_RATE = 30;

const NORMAL_SLIMES = 28;
const ELITE_SLIMES = 4;
const SLIME_RESPAWN_MS = 5000;

const FIREBALL_SPEED = 900;
const FIREBALL_DAMAGE = 60;
const FIREBALL_RADIUS = 14;
const FIREBALL_LIFE = 1.35;
const FIREBALL_COOLDOWN = 900;

const players = new Map();
const slimes = new Map();
const fireballs = new Map();

let nextSlimeId = 1;
let nextFireballId = 1;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randomPoint(margin = 120) {
  return {
    x: margin + Math.random() * (WORLD.width - margin * 2),
    y: margin + Math.random() * (WORLD.height - margin * 2)
  };
}

function directionFromInput(x, y, previous = 'front') {
  if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) return previous;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'front' : 'back';
}

function directionFromAim(x, y, previous = 'front') {
  if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) return previous;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'front' : 'back';
}

function makePlayer(id) {
  const p = randomPoint(450);

  return {
    id,
    x: p.x,
    y: p.y,
    inputX: 0,
    inputY: 0,
    direction: 'front',
    moving: false,
    aimX: 0,
    aimY: 1,
    lastFireballAt: 0
  };
}

// ======================================================
// 슬라임
// ======================================================

function chooseSlimeDirection(slime) {
  const angle = Math.random() * Math.PI * 2;

  const speed = slime.elite
    ? 55 + Math.random() * 25
    : 40 + Math.random() * 30;

  slime.vx = Math.cos(angle) * speed;
  slime.vy = Math.sin(angle) * speed;

  slime.changeAt =
    Date.now() +
    900 +
    Math.random() * 2600;
}

function createSlime(elite = false) {
  const p = randomPoint(180);

  const slime = {
    id: nextSlimeId++,
    x: p.x,
    y: p.y,
    elite,

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

  slimes.set(
    slime.id,
    slime
  );
}

for (let i = 0; i < NORMAL_SLIMES; i++) {
  createSlime(false);
}

for (let i = 0; i < ELITE_SLIMES; i++) {
  createSlime(true);
}

function respawnSlime(slime) {
  const p = randomPoint(180);

  slime.x = p.x;
  slime.y = p.y;

  slime.hp = slime.maxHp;

  slime.alive = true;
  slime.respawnAt = 0;

  chooseSlimeDirection(slime);
}

// ======================================================
// 파이어볼
// ======================================================

function castFireball(player) {
  const now = Date.now();

  if (
    now - player.lastFireballAt <
    FIREBALL_COOLDOWN
  ) {
    return;
  }

  player.lastFireballAt = now;

  const aimLength =
    Math.hypot(
      player.aimX,
      player.aimY
    ) || 1;

  const d = {
    x: player.aimX / aimLength,
    y: player.aimY / aimLength
  };

  const id = nextFireballId++;

  fireballs.set(id, {
    id,
    ownerId: player.id,

    x:
      player.x +
      d.x * 42,

    y:
      player.y +
      d.y * 42,

    vx:
      d.x *
      FIREBALL_SPEED,

    vy:
      d.y *
      FIREBALL_SPEED,

    radius:
      FIREBALL_RADIUS,

    life:
      FIREBALL_LIFE
  });
}

// ======================================================
// 접속
// ======================================================

io.on('connection', (socket) => {
  if (
    players.size >=
    MAX_PLAYERS
  ) {
    socket.emit(
      'serverFull',
      {
        maxPlayers: MAX_PLAYERS
      }
    );

    setTimeout(
      () => socket.disconnect(true),
      400
    );

    return;
  }

  const player =
    makePlayer(socket.id);

  players.set(
    socket.id,
    player
  );

  socket.emit(
    'welcome',
    {
      id: socket.id,
      world: WORLD,
      maxPlayers: MAX_PLAYERS,
      fireballCooldown:
        FIREBALL_COOLDOWN
    }
  );

  io.emit(
    'count',
    {
      current: players.size,
      max: MAX_PLAYERS
    }
  );

  // 이동
  socket.on(
    'input',
    (data = {}) => {
      const p =
        players.get(
          socket.id
        );

      if (!p) return;

      let x =
        Number(data.x) || 0;

      let y =
        Number(data.y) || 0;

      const len =
        Math.hypot(x, y);

      if (len > 1) {
        x /= len;
        y /= len;
      }

      p.inputX =
        clamp(
          x,
          -1,
          1
        );

      p.inputY =
        clamp(
          y,
          -1,
          1
        );

      p.moving =
        Math.abs(x) > 0.05 ||
        Math.abs(y) > 0.05;
    }
  );

  // 마우스/시선 방향
  socket.on(
    'aim',
    (data = {}) => {
      const p =
        players.get(
          socket.id
        );

      if (!p) return;

      let x =
        Number(data.x) || 0;

      let y =
        Number(data.y) || 0;

      const len =
        Math.hypot(x, y);

      if (len < 0.001) {
        return;
      }

      x /= len;
      y /= len;

      p.aimX = x;
      p.aimY = y;

      p.direction =
        directionFromAim(
          x,
          y,
          p.direction
        );
    }
  );

  socket.on(
    'castFireball',
    () => {
      const p =
        players.get(
          socket.id
        );

      if (p) {
        castFireball(p);
      }
    }
  );

  socket.on(
    'disconnect',
    () => {
      players.delete(
        socket.id
      );

      io.emit(
        'count',
        {
          current:
            players.size,

          max:
            MAX_PLAYERS
        }
      );
    }
  );
});

// ======================================================
// 게임 업데이트
// ======================================================

let lastTime =
  Date.now();

setInterval(() => {
  const now =
    Date.now();

  const dt =
    Math.min(
      (
        now -
        lastTime
      ) / 1000,
      0.1
    );

  lastTime =
    now;

  // 플레이어 이동
  for (
    const p
    of players.values()
  ) {
    p.x +=
      p.inputX *
      PLAYER_SPEED *
      dt;

    p.y +=
      p.inputY *
      PLAYER_SPEED *
      dt;

    p.x =
      clamp(
        p.x,
        PLAYER_RADIUS,
        WORLD.width -
        PLAYER_RADIUS
      );

    p.y =
      clamp(
        p.y,
        PLAYER_RADIUS,
        WORLD.height -
        PLAYER_RADIUS
      );
  }

  // 슬라임 이동
  for (
    const slime
    of slimes.values()
  ) {
    if (!slime.alive) {
      if (
        now >=
        slime.respawnAt
      ) {
        respawnSlime(slime);
      }

      continue;
    }

    if (
      now >=
      slime.changeAt
    ) {
      chooseSlimeDirection(
        slime
      );
    }

    slime.x +=
      slime.vx *
      dt;

    slime.y +=
      slime.vy *
      dt;

    if (
      slime.x <
      slime.radius ||

      slime.x >
      WORLD.width -
      slime.radius
    ) {
      slime.vx *= -1;

      slime.x =
        clamp(
          slime.x,
          slime.radius,
          WORLD.width -
          slime.radius
        );
    }

    if (
      slime.y <
      slime.radius ||

      slime.y >
      WORLD.height -
      slime.radius
    ) {
      slime.vy *= -1;

      slime.y =
        clamp(
          slime.y,
          slime.radius,
          WORLD.height -
          slime.radius
        );
    }
  }

  // 파이어볼
  for (
    const fireball
    of Array.from(
      fireballs.values()
    )
  ) {
    fireball.x +=
      fireball.vx *
      dt;

    fireball.y +=
      fireball.vy *
      dt;

    fireball.life -= dt;

    if (
      fireball.life <= 0 ||

      fireball.x < -50 ||

      fireball.x >
      WORLD.width + 50 ||

      fireball.y < -50 ||

      fireball.y >
      WORLD.height + 50
    ) {
      fireballs.delete(
        fireball.id
      );

      continue;
    }

    for (
      const slime
      of slimes.values()
    ) {
      if (!slime.alive) {
        continue;
      }

      const dx =
        slime.x -
        fireball.x;

      const dy =
        slime.y -
        fireball.y;

      const hitDistance =
        slime.radius +
        fireball.radius;

      if (
        dx * dx +
        dy * dy <=
        hitDistance *
        hitDistance
      ) {
        slime.hp -=
          FIREBALL_DAMAGE;

        fireballs.delete(
          fireball.id
        );

        if (
          slime.hp <= 0
        ) {
          slime.alive = false;

          slime.respawnAt =
            now +
            SLIME_RESPAWN_MS;
        }

        break;
      }
    }
  }

  // 상태 동기화
  io.emit(
    'state',
    {
      players:
        Array.from(
          players.values(),
          p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            direction:
              p.direction,
            moving:
              p.moving
          })
        ),

      slimes:
        Array.from(
          slimes.values(),
          s => ({
            id: s.id,
            x: s.x,
            y: s.y,
            elite: s.elite,
            hp: s.hp,
            maxHp: s.maxHp,
            alive: s.alive
          })
        ),

      fireballs:
        Array.from(
          fireballs.values(),
          f => ({
            id: f.id,
            x: f.x,
            y: f.y,
            radius: f.radius
          })
        )
    }
  );
}, 1000 / TICK_RATE);

// ======================================================
// mage.png
// ======================================================

app.get(
  '/mage.png',
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'mage.png'
      )
    );
  }
);

// ======================================================
// 게임 화면
// ======================================================

app.get(
  '/',
  (_req, res) => {
    res.type('html').send(`<!doctype html>

<html lang="ko">

<head>

<meta charset="utf-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">

<title>
Forest Mage RPG
</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;

  width: 100%;
  height: 100%;

  overflow: hidden;

  background: #20391d;

  font-family:
    system-ui,
    sans-serif;

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

  color: #fff;

  background:
    rgba(9,14,9,.72);

  border:
    1px solid
    rgba(255,255,255,.16);

  border-radius: 12px;

  padding:
    10px 13px;

  line-height: 1.5;

  font-size: 14px;

  backdrop-filter:
    blur(6px);
}

#status {
  font-weight: 800;
}

.skillText {
  color: #ffcc80;

  font-weight: 800;
}

#joystick {
  position: fixed;

  left: 22px;
  bottom: 22px;

  z-index: 30;

  width: 145px;
  height: 145px;

  border-radius: 50%;

  border:
    2px solid
    rgba(255,255,255,.36);

  background:
    rgba(0,0,0,.25);
}

#stick {
  position: absolute;

  left: 46px;
  top: 46px;

  width: 52px;
  height: 52px;

  border-radius: 50%;

  background:
    rgba(255,255,255,.84);

  pointer-events: none;
}

#skillE {
  position: fixed;

  right: 28px;
  bottom: 32px;

  z-index: 30;

  width: 94px;
  height: 94px;

  border-radius: 50%;

  border:
    3px solid
    rgba(255,214,128,.85);

  background:
    rgba(137,45,24,.82);

  color: white;

  font:
    900 17px
    system-ui;

  box-shadow:
    0 5px 18px
    rgba(0,0,0,.3);

  touch-action: none;
}

#skillE:active {
  transform:
    scale(.96);
}

#skillE.cooling {
  opacity: .55;
}

#tip {
  position: fixed;

  right: 16px;
  bottom: 138px;

  z-index: 20;

  color: #fff;

  background:
    rgba(0,0,0,.38);

  border-radius: 9px;

  padding:
    7px 10px;

  font-size: 12px;
}

@media(pointer:fine) {
  #joystick {
    opacity: .36;
  }
}

</style>

</head>

<body>

<canvas id="game"></canvas>

<div id="hud">

<div id="status">
서버 연결 중...
</div>

<div>
접속자:
<span id="count">0</span>
/
<span id="maxCount">20</span>명
</div>

<div>
직업: 🔮 마법사
</div>

<div>
스킬:
<span class="skillText">
E · 파이어볼
</span>
</div>

<div>
슬라임:
일반 28 · 엘리트 4
</div>

</div>

<div id="joystick">
<div id="stick"></div>
</div>

<button
id="skillE"
type="button">
E<br>파이어볼
</button>

<div id="tip">
PC: WASD · 마우스 조준 · E 파이어볼 · 모바일: 조이스틱 + E 버튼
</div>

<script src="/socket.io/socket.io.js"></script>

<script>

const socket =
  io();

const canvas =
  document.getElementById(
    'game'
  );

const ctx =
  canvas.getContext(
    '2d'
  );

const statusEl =
  document.getElementById(
    'status'
  );

const countEl =
  document.getElementById(
    'count'
  );

const maxCountEl =
  document.getElementById(
    'maxCount'
  );

const joystick =
  document.getElementById(
    'joystick'
  );

const stick =
  document.getElementById(
    'stick'
  );

const skillE =
  document.getElementById(
    'skillE'
  );

let myId = null;

let world = {
  width: 5200,
  height: 3400
};

let players = [];
let slimes = [];
let fireballs = [];

let keys =
  new Set();

let joyX = 0;
let joyY = 0;

let joyPointer = null;

let serverFull = false;

let fireballCooldown = 900;
let lastLocalCast = 0;

// ======================================================
// 마우스 조준
// ======================================================

let mouseX =
  innerWidth / 2;

let mouseY =
  innerHeight / 2;

let mouseAimActive =
  false;

// 카메라 월드 위치
let cameraX = 0;
let cameraY = 0;

let lastAimX = 999;
let lastAimY = 999;

function clamp(
  v,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      v
    )
  );
}

// ======================================================
// 마법사 이미지
// ======================================================

const mageImage =
  new Image();

let mageReady =
  false;

mageImage.onload =
  () => {
    mageReady = true;
  };

mageImage.onerror =
  () => {
    statusEl.textContent =
      'mage.png를 GitHub에 올려주세요';
  };

mageImage.src =
  '/mage.png';

// ======================================================
// 화면
// ======================================================

function resize() {
  const dpr =
    Math.min(
      window.devicePixelRatio ||
      1,
      2
    );

  canvas.width =
    Math.floor(
      innerWidth *
      dpr
    );

  canvas.height =
    Math.floor(
      innerHeight *
      dpr
    );

  canvas.style.width =
    innerWidth +
    'px';

  canvas.style.height =
    innerHeight +
    'px';

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );

  ctx.imageSmoothingEnabled =
    true;
}

addEventListener(
  'resize',
  resize
);

resize();

// ======================================================
// 서버 통신
// ======================================================

socket.on(
  'connect',
  () => {
    if (!serverFull) {
      statusEl.textContent =
        '숲 서버 접속됨';
    }
  }
);

socket.on(
  'welcome',
  data => {
    myId = data.id;

    world =
      data.world;

    fireballCooldown =
      data.fireballCooldown;

    maxCountEl.textContent =
      data.maxPlayers;
  }
);

socket.on(
  'count',
  data => {
    countEl.textContent =
      data.current;

    maxCountEl.textContent =
      data.max;
  }
);

socket.on(
  'state',
  data => {
    players =
      data.players;

    slimes =
      data.slimes;

    fireballs =
      data.fireballs;
  }
);

socket.on(
  'serverFull',
  data => {
    serverFull = true;

    statusEl.textContent =
      '서버가 가득 찼습니다';

    countEl.textContent =
      data.maxPlayers;

    maxCountEl.textContent =
      data.maxPlayers;

    joystick.style.display =
      'none';

    skillE.style.display =
      'none';

    socket.io.opts.reconnection =
      false;
  }
);

socket.on(
  'disconnect',
  () => {
    if (!serverFull) {
      statusEl.textContent =
        '재접속 중...';
    }
  }
);

// ======================================================
// 키보드
// ======================================================

addEventListener(
  'keydown',
  e => {
    const k =
      e.key.toLowerCase();

    if (
      [
        'w',
        'a',
        's',
        'd',
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright'
      ].includes(k)
    ) {
      keys.add(k);

      e.preventDefault();
    }

    if (k === 'e') {
      castFireball();

      e.preventDefault();
    }
  }
);

addEventListener(
  'keyup',
  e => {
    keys.delete(
      e.key.toLowerCase()
    );
  }
);

// ======================================================
// 마우스 시선
// ======================================================

addEventListener(
  'mousemove',
  e => {
    mouseX =
      e.clientX;

    mouseY =
      e.clientY;

    mouseAimActive =
      true;
  }
);

// ======================================================
// 모바일 조이스틱
// ======================================================

function moveJoystick(
  clientX,
  clientY
) {
  const r =
    joystick.getBoundingClientRect();

  const cx =
    r.left +
    r.width / 2;

  const cy =
    r.top +
    r.height / 2;

  let dx =
    clientX - cx;

  let dy =
    clientY - cy;

  const max =
    r.width * .34;

  const len =
    Math.hypot(
      dx,
      dy
    );

  if (len > max) {
    dx =
      dx / len *
      max;

    dy =
      dy / len *
      max;
  }

  joyX =
    dx / max;

  joyY =
    dy / max;

  stick.style.transform =
    'translate(' +
    dx +
    'px,' +
    dy +
    'px)';
}

joystick.addEventListener(
  'pointerdown',
  e => {
    joyPointer =
      e.pointerId;

    joystick.setPointerCapture(
      e.pointerId
    );

    moveJoystick(
      e.clientX,
      e.clientY
    );
  }
);

joystick.addEventListener(
  'pointermove',
  e => {
    if (
      e.pointerId ===
      joyPointer
    ) {
      moveJoystick(
        e.clientX,
        e.clientY
      );
    }
  }
);

function releaseJoy(e) {
  if (
    e.pointerId !==
    joyPointer
  ) {
    return;
  }

  joyPointer = null;

  joyX = 0;
  joyY = 0;

  stick.style.transform =
    'translate(0px,0px)';
}

joystick.addEventListener(
  'pointerup',
  releaseJoy
);

joystick.addEventListener(
  'pointercancel',
  releaseJoy
);

// ======================================================
// 내 플레이어
// ======================================================

function getMyPlayer() {
  return (
    players.find(
      p => p.id === myId
    ) || null
  );
}

// ======================================================
// 조준 방향
// ======================================================

function getCurrentAim() {
  const me =
    getMyPlayer();

  if (!me) {
    return null;
  }

  // PC 마우스 조준
  if (mouseAimActive) {
    const worldMouseX =
      cameraX +
      mouseX;

    const worldMouseY =
      cameraY +
      mouseY;

    let ax =
      worldMouseX -
      me.x;

    let ay =
      worldMouseY -
      me.y;

    const len =
      Math.hypot(
        ax,
        ay
      );

    if (len > .001) {
      return {
        x: ax / len,
        y: ay / len
      };
    }
  }

  // 모바일
  let ax = joyX;
  let ay = joyY;

  if (
    Math.abs(ax) < .05 &&
    Math.abs(ay) < .05
  ) {
    if (
      keys.has('a') ||
      keys.has('arrowleft')
    ) {
      ax -= 1;
    }

    if (
      keys.has('d') ||
      keys.has('arrowright')
    ) {
      ax += 1;
    }

    if (
      keys.has('w') ||
      keys.has('arrowup')
    ) {
      ay -= 1;
    }

    if (
      keys.has('s') ||
      keys.has('arrowdown')
    ) {
      ay += 1;
    }
  }

  const len =
    Math.hypot(
      ax,
      ay
    );

  if (len > .001) {
    return {
      x: ax / len,
      y: ay / len
    };
  }

  // 움직이지 않을 때 기존 시선 유지
  if (
    me.direction ===
    'back'
  ) {
    return {
      x: 0,
      y: -1
    };
  }

  if (
    me.direction ===
    'left'
  ) {
    return {
      x: -1,
      y: 0
    };
  }

  if (
    me.direction ===
    'right'
  ) {
    return {
      x: 1,
      y: 0
    };
  }

  return {
    x: 0,
    y: 1
  };
}

function sendAim(
  force = false
) {
  if (serverFull) {
    return;
  }

  const aim =
    getCurrentAim();

  if (!aim) {
    return;
  }

  if (
    force ||

    Math.abs(
      aim.x -
      lastAimX
    ) > .01 ||

    Math.abs(
      aim.y -
      lastAimY
    ) > .01
  ) {
    socket.emit(
      'aim',
      aim
    );

    lastAimX =
      aim.x;

    lastAimY =
      aim.y;
  }
}

// ======================================================
// 파이어볼
// ======================================================

function castFireball() {
  if (serverFull) {
    return;
  }

  const now =
    performance.now();

  if (
    now -
    lastLocalCast <
    fireballCooldown
  ) {
    return;
  }

  lastLocalCast =
    now;

  // 발사 직전에 마우스 방향을 서버에 전달
  sendAim(true);

  socket.emit(
    'castFireball'
  );

  skillE.classList.add(
    'cooling'
  );

  skillE.textContent =
    '쿨타임';

  setTimeout(
    () => {
      skillE.classList.remove(
        'cooling'
      );

      skillE.innerHTML =
        'E<br>파이어볼';
    },
    fireballCooldown
  );
}

skillE.addEventListener(
  'pointerdown',
  e => {
    e.preventDefault();

    castFireball();
  }
);

// ======================================================
// 이동 + 조준 전송
// ======================================================

let lastX = 999;
let lastY = 999;

setInterval(
  () => {
    if (serverFull) {
      return;
    }

    let x = 0;
    let y = 0;

    if (
      keys.has('a') ||
      keys.has('arrowleft')
    ) {
      x--;
    }

    if (
      keys.has('d') ||
      keys.has('arrowright')
    ) {
      x++;
    }

    if (
      keys.has('w') ||
      keys.has('arrowup')
    ) {
      y--;
    }

    if (
      keys.has('s') ||
      keys.has('arrowdown')
    ) {
      y++;
    }

    if (
      Math.abs(joyX) > .08 ||
      Math.abs(joyY) > .08
    ) {
      x = joyX;
      y = joyY;
    }

    const len =
      Math.hypot(
        x,
        y
      );

    if (len > 1) {
      x /= len;
      y /= len;
    }

    if (
      Math.abs(
        x -
        lastX
      ) > .01 ||

      Math.abs(
        y -
        lastY
      ) > .01
    ) {
      socket.emit(
        'input',
        {
          x,
          y
        }
      );

      lastX = x;
      lastY = y;
    }

    // PC = 마우스 방향
    // 모바일 = 이동 방향
    sendAim(false);

  },
  33
);

// ======================================================
// 숲
// ======================================================

function visible(
  x,
  y,
  m,
  cx,
  cy
) {
  return (
    x > cx - m &&
    x < cx + innerWidth + m &&
    y > cy - m &&
    y < cy + innerHeight + m
  );
}

function hashRand(n) {
  const x =
    Math.sin(
      n * 12.9898
    ) *
    43758.5453;

  return (
    x -
    Math.floor(x)
  );
}

function drawForest(
  cx,
  cy
) {
  ctx.fillStyle =
    '#3d6b34';

  ctx.fillRect(
    0,
    0,
    innerWidth,
    innerHeight
  );

  // 흙길
  ctx.fillStyle =
    '#98764c';

  ctx.fillRect(
    -cx,
    1580 - cy,
    world.width,
    105
  );

  ctx.fillRect(
    2510 - cx,
    -cy,
    110,
    world.height
  );

  // 나무
  for (
    let i = 0;
    i < 150;
    i++
  ) {
    const x =
      90 +
      hashRand(i + 1) *
      (
        world.width -
        180
      );

    const y =
      90 +
      hashRand(i + 701) *
      (
        world.height -
        180
      );

    const s =
      22 +
      hashRand(i + 1401) *
      24;

    if (
      !visible(
        x,
        y,
        90,
        cx,
        cy
      )
    ) {
      continue;
    }

    const sx =
      x - cx;

    const sy =
      y - cy;

    // 그림자
    ctx.beginPath();

    ctx.ellipse(
      sx,
      sy + 25,
      s * .72,
      s * .25,
      0,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      'rgba(0,0,0,.2)';

    ctx.fill();

    // 줄기
    ctx.fillStyle =
      '#694526';

    ctx.fillRect(
      sx - s * .12,
      sy,
      s * .24,
      s * .85
    );

    // 잎
    ctx.beginPath();

    ctx.arc(
      sx,
      sy - 8,
      s,
      0,
      Math.PI * 2
    );

    ctx.arc(
      sx - s * .55,
      sy,
      s * .58,
      0,
      Math.PI * 2
    );

    ctx.arc(
      sx + s * .55,
      sy,
      s * .58,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      '#287a3e';

    ctx.fill();

    ctx.beginPath();

    ctx.arc(
      sx - s * .25,
      sy - s * .28,
      s * .3,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      '#47a457';

    ctx.fill();
  }

  // 꽃
  for (
    let i = 0;
    i < 180;
    i++
  ) {
    const x =
      hashRand(
        i + 2701
      ) *
      world.width;

    const y =
      hashRand(
        i + 3301
      ) *
      world.height;

    if (
      !visible(
        x,
        y,
        15,
        cx,
        cy
      )
    ) {
      continue;
    }

    ctx.beginPath();

    ctx.arc(
      x - cx,
      y - cy,
      2.2,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      [
        '#ffe082',
        '#ff9e9e',
        '#c9a3ff',
        '#9ee7ff'
      ][i % 4];

    ctx.fill();
  }

  ctx.strokeStyle =
    'rgba(255,255,255,.25)';

  ctx.lineWidth = 4;

  ctx.strokeRect(
    -cx,
    -cy,
    world.width,
    world.height
  );
}

// ======================================================
// 마법사 스프라이트
// ======================================================

function walkFrame(p) {
  if (!p.moving) {
    return 1;
  }

  return (
    Math.floor(
      performance.now() /
      140
    ) % 3
  );
}

function directionRow(d) {
  // 0 = 앞
  // 1 = 뒤
  // 2 = 왼쪽
  // 3 = 오른쪽

  if (d === 'back') {
    return 1;
  }

  if (d === 'left') {
    return 2;
  }

  if (d === 'right') {
    return 3;
  }

  return 0;
}

/*
  mage.png는 생성 이미지라
  정확하게 3×4로 나뉜 균등 셀이 아님.

  실제 캐릭터가 들어있는 위치를
  고정 좌표로 잘라 사용한다.

  모든 프레임:
  - 같은 소스 크기
  - 같은 출력 크기
  - 같은 중심 X
  - 같은 발 Y

  로 맞춰서 걷는 동안 캐릭터 중심이
  흔들리는 현상을 줄인다.
*/

const MAGE_CROP = {
  x: [
    82,
    354,
    660
  ],

  y: [
    60,
    400,
    730,
    1055
  ],

  w: 300,
  h: 330
};

const MAGE_DRAW_W = 120;
const MAGE_DRAW_H = 132;

// 모든 프레임의 발 위치
const MAGE_FOOT_Y = 31;

function drawMage(
  p,
  sx,
  sy,
  isMe
) {
  ctx.save();

  ctx.translate(
    Math.round(sx),
    Math.round(sy)
  );

  if (mageReady) {
    const col =
      walkFrame(p);

    const row =
      directionRow(
        p.direction
      );

    const sourceX =
      MAGE_CROP.x[col];

    const sourceY =
      MAGE_CROP.y[row];

    /*
      캐릭터 중심 X = 0

      발 위치 =
      항상 MAGE_FOOT_Y

      따라서 프레임이 바뀌어도
      출력 좌표 자체는 이동하지 않는다.
    */

    ctx.drawImage(
      mageImage,

      sourceX,
      sourceY,

      MAGE_CROP.w,
      MAGE_CROP.h,

      -MAGE_DRAW_W / 2,

      MAGE_FOOT_Y -
      MAGE_DRAW_H,

      MAGE_DRAW_W,
      MAGE_DRAW_H
    );

  } else {
    ctx.fillStyle =
      '#6743a5';

    ctx.fillRect(
      -22,
      -44,
      44,
      44
    );

    ctx.fillStyle =
      '#f0d6ff';

    ctx.font =
      'bold 24px sans-serif';

    ctx.textAlign =
      'center';

    ctx.fillText(
      'M',
      0,
      -13
    );
  }

  /*
    기존에 있던
    내 캐릭터 주위 원은 제거함.
  */

  ctx.restore();

  // 이름
  ctx.fillStyle =
    'rgba(0,0,0,.48)';

  ctx.fillRect(
    sx - 33,
    sy - 72,
    66,
    18
  );

  ctx.fillStyle =
    isMe
      ? '#ffe082'
      : '#fff';

  ctx.font =
    '700 12px system-ui';

  ctx.textAlign =
    'center';

  ctx.fillText(
    isMe
      ? 'YOU'
      : 'P-' +
        p.id.slice(
          0,
          4
        ),

    sx,
    sy - 59
  );
}

// ======================================================
// 슬라임
// ======================================================

function drawSlime(
  s,
  cx,
  cy
) {
  if (!s.alive) {
    return;
  }

  const x =
    s.x - cx;

  const y =
    s.y - cy;

  const r =
    s.elite
      ? 34
      : 24;

  const bounce =
    Math.sin(
      performance.now() /
      180 +
      s.id
    ) * 2.5;

  ctx.save();

  ctx.translate(
    x,
    y + bounce
  );

  // 그림자
  ctx.beginPath();

  ctx.ellipse(
    0,
    r * .72,
    r * .82,
    r * .28,
    0,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(0,0,0,.22)';

  ctx.fill();

  // 몸
  ctx.beginPath();

  ctx.moveTo(
    -r,
    8
  );

  ctx.quadraticCurveTo(
    -r,
    -r * .65,
    0,
    -r
  );

  ctx.quadraticCurveTo(
    r,
    -r * .65,
    r,
    8
  );

  ctx.quadraticCurveTo(
    0,
    r * .85,
    -r,
    8
  );

  ctx.fillStyle =
    s.elite
      ? '#7d4fd1'
      : '#58c96f';

  ctx.fill();

  // 광택
  ctx.beginPath();

  ctx.ellipse(
    -r * .3,
    -r * .25,
    r * .22,
    r * .13,
    -.4,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(255,255,255,.25)';

  ctx.fill();

  // 눈
  ctx.fillStyle =
    '#172019';

  ctx.beginPath();

  ctx.arc(
    -r * .3,
    -2,
    3,
    0,
    Math.PI * 2
  );

  ctx.arc(
    r * .3,
    -2,
    3,
    0,
    Math.PI * 2
  );

  ctx.fill();

  // 엘리트 왕관
  if (s.elite) {
    ctx.fillStyle =
      '#f6cf58';

    ctx.beginPath();

    ctx.moveTo(
      -13,
      -r - 2
    );

    ctx.lineTo(
      -8,
      -r - 13
    );

    ctx.lineTo(
      0,
      -r - 5
    );

    ctx.lineTo(
      8,
      -r - 13
    );

    ctx.lineTo(
      13,
      -r - 2
    );

    ctx.closePath();

    ctx.fill();
  }

  ctx.restore();

  // 체력
  const w =
    s.elite
      ? 68
      : 48;

  const pct =
    Math.max(
      0,
      s.hp /
      s.maxHp
    );

  ctx.fillStyle =
    'rgba(0,0,0,.55)';

  ctx.fillRect(
    x - w / 2,
    y - r - 22,
    w,
    7
  );

  ctx.fillStyle =
    s.elite
      ? '#e5b84d'
      : '#ef6666';

  ctx.fillRect(
    x - w / 2 + 1,
    y - r - 21,
    (w - 2) * pct,
    5
  );

  if (s.elite) {
    ctx.fillStyle =
      '#ffe59a';

    ctx.font =
      '700 11px system-ui';

    ctx.textAlign =
      'center';

    ctx.fillText(
      'ELITE',
      x,
      y - r - 28
    );
  }
}

// ======================================================
// 파이어볼
// ======================================================

function drawFireball(
  f,
  cx,
  cy
) {
  const x =
    f.x - cx;

  const y =
    f.y - cy;

  ctx.save();

  ctx.shadowBlur =
    18;

  ctx.shadowColor =
    '#ff6a20';

  ctx.beginPath();

  ctx.arc(
    x,
    y,
    16,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(255,86,26,.35)';

  ctx.fill();

  ctx.beginPath();

  ctx.arc(
    x,
    y,
    10,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    '#ff6a1a';

  ctx.fill();

  ctx.beginPath();

  ctx.arc(
    x - 2,
    y - 2,
    5,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    '#ffd35a';

  ctx.fill();

  ctx.restore();
}

// ======================================================
// 렌더
// ======================================================

function render() {
  requestAnimationFrame(
    render
  );

  ctx.clearRect(
    0,
    0,
    innerWidth,
    innerHeight
  );

  const me =
    players.find(
      p => p.id === myId
    );

  cameraX = 0;
  cameraY = 0;

  if (me) {
    cameraX =
      clamp(
        me.x -
        innerWidth / 2,

        0,

        Math.max(
          0,
          world.width -
          innerWidth
        )
      );

    cameraY =
      clamp(
        me.y -
        innerHeight / 2,

        0,

        Math.max(
          0,
          world.height -
          innerHeight
        )
      );
  }

  drawForest(
    cameraX,
    cameraY
  );

  // 슬라임
  for (
    const s
    of slimes
  ) {
    if (
      visible(
        s.x,
        s.y,
        80,
        cameraX,
        cameraY
      )
    ) {
      drawSlime(
        s,
        cameraX,
        cameraY
      );
    }
  }

  // 파이어볼
  for (
    const f
    of fireballs
  ) {
    if (
      visible(
        f.x,
        f.y,
        50,
        cameraX,
        cameraY
      )
    ) {
      drawFireball(
        f,
        cameraX,
        cameraY
      );
    }
  }

  // 플레이어
  const ordered =
    [...players].sort(
      (a, b) =>
        a.y - b.y
    );

  for (
    const p
    of ordered
  ) {
    const sx =
      p.x -
      cameraX;

    const sy =
      p.y -
      cameraY;

    if (
      visible(
        p.x,
        p.y,
        120,
        cameraX,
        cameraY
      )
    ) {
      drawMage(
        p,
        sx,
        sy,
        p.id === myId
      );
    }
  }
}

render();

</script>

</body>

</html>`);
  }
);

// ======================================================
// 서버 시작
// ======================================================

server.listen(
  PORT,
  () => {
    console.log(
      'Forest Mage RPG running on port ' +
      PORT
    );

    console.log(
      'Players: ' +
      MAX_PLAYERS +
      ', Slimes: ' +
      (
        NORMAL_SLIMES +
        ELITE_SLIMES
      )
    );
  }
);

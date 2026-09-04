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

const clamp = (v, min, max) =>
  Math.max(min, Math.min(max, v));

const randomPoint = (m = 120) => ({
  x: m + Math.random() * (WORLD.width - m * 2),
  y: m + Math.random() * (WORLD.height - m * 2)
});

function directionFromVector(x, y, prev = 'front') {
  if (
    Math.abs(x) < 0.001 &&
    Math.abs(y) < 0.001
  ) {
    return prev;
  }

  if (Math.abs(x) > Math.abs(y)) {
    return x > 0
      ? 'right'
      : 'left';
  }

  return y > 0
    ? 'front'
    : 'back';
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

    lastFireballAt: 0
  };
}

// ======================================================
// 슬라임
// ======================================================

function chooseSlimeDirection(s) {
  const angle =
    Math.random() *
    Math.PI *
    2;

  const speed =
    s.elite
      ? 55 + Math.random() * 25
      : 40 + Math.random() * 30;

  s.vx =
    Math.cos(angle) *
    speed;

  s.vy =
    Math.sin(angle) *
    speed;

  s.changeAt =
    Date.now() +
    900 +
    Math.random() * 2600;
}

function createSlime(elite = false) {
  const p =
    randomPoint(180);

  const s = {
    id: nextSlimeId++,

    x: p.x,
    y: p.y,

    elite,

    radius:
      elite
        ? 34
        : 24,

    maxHp:
      elite
        ? 180
        : 60,

    hp:
      elite
        ? 180
        : 60,

    vx: 0,
    vy: 0,

    changeAt: 0,

    alive: true,

    respawnAt: 0
  };

  chooseSlimeDirection(s);

  slimes.set(
    s.id,
    s
  );
}

for (
  let i = 0;
  i < NORMAL_SLIMES;
  i++
) {
  createSlime(false);
}

for (
  let i = 0;
  i < ELITE_SLIMES;
  i++
) {
  createSlime(true);
}

function respawnSlime(s) {
  const p =
    randomPoint(180);

  s.x = p.x;
  s.y = p.y;

  s.hp =
    s.maxHp;

  s.alive =
    true;

  s.respawnAt =
    0;

  chooseSlimeDirection(s);
}

// ======================================================
// 파이어볼
// ======================================================

function castFireball(
  player,
  targetX,
  targetY
) {
  const now =
    Date.now();

  if (
    now -
    player.lastFireballAt <
    FIREBALL_COOLDOWN
  ) {
    return false;
  }

  let dx =
    Number(targetX) -
    player.x;

  let dy =
    Number(targetY) -
    player.y;

  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy)
  ) {
    return false;
  }

  const len =
    Math.hypot(
      dx,
      dy
    );

  if (len < 1) {
    return false;
  }

  dx /= len;
  dy /= len;

  player.lastFireballAt =
    now;

  player.aimX =
    dx;

  player.aimY =
    dy;

  player.direction =
    directionFromVector(
      dx,
      dy,
      player.direction
    );

  const id =
    nextFireballId++;

  fireballs.set(
    id,
    {
      id,

      ownerId:
        player.id,

      x:
        player.x +
        dx * 42,

      y:
        player.y +
        dy * 42,

      vx:
        dx *
        FIREBALL_SPEED,

      vy:
        dy *
        FIREBALL_SPEED,

      radius:
        FIREBALL_RADIUS,

      life:
        FIREBALL_LIFE
    }
  );

  return true;
}

// ======================================================
// 멀티 접속
// ======================================================

io.on(
  'connection',
  socket => {

    if (
      players.size >=
      MAX_PLAYERS
    ) {
      socket.emit(
        'serverFull',
        {
          maxPlayers:
            MAX_PLAYERS
        }
      );

      setTimeout(
        () =>
          socket.disconnect(true),
        400
      );

      return;
    }

    players.set(
      socket.id,
      makePlayer(socket.id)
    );

    socket.emit(
      'welcome',
      {
        id:
          socket.id,

        world:
          WORLD,

        maxPlayers:
          MAX_PLAYERS,

        fireballCooldown:
          FIREBALL_COOLDOWN
      }
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

    socket.on(
      'input',
      (data = {}) => {

        const p =
          players.get(
            socket.id
          );

        if (!p) {
          return;
        }

        let x =
          Number(data.x) ||
          0;

        let y =
          Number(data.y) ||
          0;

        const len =
          Math.hypot(
            x,
            y
          );

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
          Math.abs(x) >
            0.05 ||
          Math.abs(y) >
            0.05;
      }
    );

    // 마우스 시선
    socket.on(
      'aim',
      (data = {}) => {

        const p =
          players.get(
            socket.id
          );

        if (!p) {
          return;
        }

        let x =
          Number(data.x) ||
          0;

        let y =
          Number(data.y) ||
          0;

        const len =
          Math.hypot(
            x,
            y
          );

        if (
          len <
          0.001
        ) {
          return;
        }

        x /= len;
        y /= len;

        p.aimX =
          x;

        p.aimY =
          y;

        p.direction =
          directionFromVector(
            x,
            y,
            p.direction
          );
      }
    );

    // 클릭한 월드 위치로 파이어볼
    socket.on(
      'castFireball',
      (data = {}) => {

        const p =
          players.get(
            socket.id
          );

        if (!p) {
          return;
        }

        socket.emit(
          'fireballCastResult',
          {
            success:
              castFireball(
                p,
                data.targetX,
                data.targetY
              ),

            cooldown:
              FIREBALL_COOLDOWN
          }
        );
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
  }
);

// ======================================================
// 게임 업데이트
// ======================================================

let lastTime =
  Date.now();

setInterval(
  () => {

    const now =
      Date.now();

    const dt =
      Math.min(
        (
          now -
          lastTime
        ) /
        1000,

        0.1
      );

    lastTime =
      now;

    // 플레이어
    for (
      const p
      of players.values()
    ) {
      p.x =
        clamp(
          p.x +
          p.inputX *
          PLAYER_SPEED *
          dt,

          PLAYER_RADIUS,

          WORLD.width -
          PLAYER_RADIUS
        );

      p.y =
        clamp(
          p.y +
          p.inputY *
          PLAYER_SPEED *
          dt,

          PLAYER_RADIUS,

          WORLD.height -
          PLAYER_RADIUS
        );
    }

    // 슬라임
    for (
      const s
      of slimes.values()
    ) {
      if (!s.alive) {
        if (
          now >=
          s.respawnAt
        ) {
          respawnSlime(s);
        }

        continue;
      }

      if (
        now >=
        s.changeAt
      ) {
        chooseSlimeDirection(
          s
        );
      }

      s.x +=
        s.vx *
        dt;

      s.y +=
        s.vy *
        dt;

      if (
        s.x <
          s.radius ||
        s.x >
          WORLD.width -
          s.radius
      ) {
        s.vx *= -1;

        s.x =
          clamp(
            s.x,
            s.radius,
            WORLD.width -
            s.radius
          );
      }

      if (
        s.y <
          s.radius ||
        s.y >
          WORLD.height -
          s.radius
      ) {
        s.vy *= -1;

        s.y =
          clamp(
            s.y,
            s.radius,
            WORLD.height -
            s.radius
          );
      }
    }

    // 파이어볼
    for (
      const f
      of [
        ...fireballs.values()
      ]
    ) {
      f.x +=
        f.vx *
        dt;

      f.y +=
        f.vy *
        dt;

      f.life -=
        dt;

      if (
        f.life <= 0 ||

        f.x < -50 ||

        f.x >
          WORLD.width +
          50 ||

        f.y < -50 ||

        f.y >
          WORLD.height +
          50
      ) {
        fireballs.delete(
          f.id
        );

        continue;
      }

      // 충돌
      for (
        const s
        of slimes.values()
      ) {
        if (
          !s.alive
        ) {
          continue;
        }

        const dx =
          s.x -
          f.x;

        const dy =
          s.y -
          f.y;

        const hit =
          s.radius +
          f.radius;

        if (
          dx * dx +
          dy * dy <=
          hit * hit
        ) {
          s.hp -=
            FIREBALL_DAMAGE;

          fireballs.delete(
            f.id
          );

          if (
            s.hp <= 0
          ) {
            s.alive =
              false;

            s.respawnAt =
              now +
              SLIME_RESPAWN_MS;
          }

          break;
        }
      }
    }

    io.emit(
      'state',
      {
        players:
          [
            ...players.values()
          ].map(
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
          [
            ...slimes.values()
          ].map(
            s => ({
              id: s.id,

              x: s.x,
              y: s.y,

              elite:
                s.elite,

              hp:
                s.hp,

              maxHp:
                s.maxHp,

              alive:
                s.alive
            })
          ),

        fireballs:
          [
            ...fireballs.values()
          ].map(
            f => ({
              id: f.id,

              x: f.x,
              y: f.y,

              radius:
                f.radius
            })
          )
      }
    );
  },

  1000 /
  TICK_RATE
);

// ======================================================
// 이미지
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
// HTML
// ======================================================

app.get(
  '/',
  (_req, res) => {

res.type('html').send(`

<!doctype html>

<html lang="ko">

<head>

<meta charset="utf-8">

<meta
name="viewport"
content="
width=device-width,
initial-scale=1,
maximum-scale=1,
user-scalable=no,
viewport-fit=cover
">

<title>
Forest Mage RPG
</title>

<style>

* {
  box-sizing:
    border-box;
}

html,
body {
  margin: 0;

  width: 100%;
  height: 100%;

  overflow:
    hidden;

  background:
    #20391d;

  font-family:
    system-ui,
    sans-serif;

  touch-action:
    none;
}

canvas {
  display:
    block;

  width:
    100%;

  height:
    100%;

  cursor:
    default;
}

body.skill-selected canvas {
  cursor:
    crosshair;
}

#hud {
  position:
    fixed;

  left:
    12px;

  top:
    12px;

  z-index:
    20;

  color:
    white;

  background:
    rgba(
      9,
      14,
      9,
      .72
    );

  border:
    1px solid
    rgba(
      255,
      255,
      255,
      .16
    );

  border-radius:
    12px;

  padding:
    10px 13px;

  line-height:
    1.5;

  font-size:
    14px;

  backdrop-filter:
    blur(6px);

  pointer-events:
    none;
}

#status {
  font-weight:
    800;
}

.skillText,
#skillState {
  color:
    #ffe082;

  font-weight:
    800;
}

#joystick {
  position:
    fixed;

  left:
    22px;

  bottom:
    22px;

  z-index:
    30;

  width:
    145px;

  height:
    145px;

  border-radius:
    50%;

  border:
    2px solid
    rgba(
      255,
      255,
      255,
      .36
    );

  background:
    rgba(
      0,
      0,
      0,
      .25
    );

  touch-action:
    none;
}

#stick {
  position:
    absolute;

  left:
    46px;

  top:
    46px;

  width:
    52px;

  height:
    52px;

  border-radius:
    50%;

  background:
    rgba(
      255,
      255,
      255,
      .84
    );

  pointer-events:
    none;
}

#skillE {
  position:
    fixed;

  right:
    28px;

  bottom:
    32px;

  z-index:
    30;

  width:
    94px;

  height:
    94px;

  border-radius:
    50%;

  border:
    3px solid
    rgba(
      255,
      214,
      128,
      .85
    );

  background:
    rgba(
      137,
      45,
      24,
      .82
    );

  color:
    white;

  font:
    900 16px
    system-ui;

  box-shadow:
    0 5px 18px
    rgba(
      0,
      0,
      0,
      .3
    );

  touch-action:
    none;
}

#skillE.selected {
  border-color:
    #fff2a6;

  background:
    rgba(
      204,
      72,
      25,
      .96
    );

  box-shadow:
    0 0 0 5px
      rgba(
        255,
        190,
        72,
        .2
      ),

    0 0 24px
      rgba(
        255,
        105,
        25,
        .55
      );
}

#skillE.cooling {
  opacity:
    .5;
}

#tip {
  position:
    fixed;

  right:
    16px;

  bottom:
    138px;

  z-index:
    20;

  color:
    white;

  background:
    rgba(
      0,
      0,
      0,
      .38
    );

  border-radius:
    9px;

  padding:
    7px 10px;

  font-size:
    12px;

  pointer-events:
    none;
}

@media (
  pointer: fine
) {
  #joystick {
    opacity:
      .36;
  }
}

</style>

</head>

<body>

<canvas id="game">
</canvas>

<div id="hud">

<div id="status">
서버 연결 중...
</div>

<div>
접속자:
<span id="count">
0
</span>
/
<span id="maxCount">
20
</span>
명
</div>

<div>
직업:
🔮 마법사
</div>

<div>
스킬:
<span class="skillText">
E · 파이어볼
</span>
</div>

<div>
상태:
<span id="skillState">
대기
</span>
</div>

<div>
슬라임:
일반 28 · 엘리트 4
</div>

</div>

<div id="joystick">

<div id="stick">
</div>

</div>

<button
id="skillE"
type="button">

E
<br>
파이어볼

</button>

<div id="tip">

E = 파이어볼 선택
→ 맵 클릭/터치
→ 그 위치로 발사

</div>

<script
src="/socket.io/socket.io.js">
</script>

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

const skillStateEl =
  document.getElementById(
    'skillState'
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

let myId =
  null;

let world = {
  width:
    5200,

  height:
    3400
};

let players =
  [];

let slimes =
  [];

let fireballs =
  [];

let keys =
  new Set();

let joyX = 0;
let joyY = 0;

let joyPointer =
  null;

let serverFull =
  false;

let cameraX = 0;
let cameraY = 0;

let mouseX =
  innerWidth /
  2;

let mouseY =
  innerHeight /
  2;

let mouseAimActive =
  false;

let lastAimX =
  999;

let lastAimY =
  999;

let lastInputX =
  999;

let lastInputY =
  999;

let fireballCooldown =
  900;

let lastLocalCast =
  -99999;

let fireballSelected =
  false;

let waitingForCastResult =
  false;

const cClamp =
  (
    v,
    min,
    max
  ) =>
    Math.max(
      min,
      Math.min(
        max,
        v
      )
    );

// ======================================================
// 마법사 이미지
// ======================================================

const mageImage =
  new Image();

let mageReady =
  false;

mageImage.onload =
  () => {

    mageReady =
      true;
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
      devicePixelRatio ||
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

    if (
      !serverFull
    ) {
      statusEl.textContent =
        '숲 서버 접속됨';
    }
  }
);

socket.on(
  'welcome',
  d => {

    myId =
      d.id;

    world =
      d.world;

    fireballCooldown =
      d.fireballCooldown;

    maxCountEl.textContent =
      d.maxPlayers;
  }
);

socket.on(
  'count',
  d => {

    countEl.textContent =
      d.current;

    maxCountEl.textContent =
      d.max;
  }
);

socket.on(
  'state',
  d => {

    players =
      d.players;

    slimes =
      d.slimes;

    fireballs =
      d.fireballs;
  }
);

socket.on(
  'serverFull',
  d => {

    serverFull =
      true;

    statusEl.textContent =
      '서버가 가득 찼습니다';

    countEl.textContent =
      d.maxPlayers;

    maxCountEl.textContent =
      d.maxPlayers;

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

    if (
      !serverFull
    ) {
      statusEl.textContent =
        '재접속 중...';
    }
  }
);

socket.on(
  'fireballCastResult',
  d => {

    waitingForCastResult =
      false;

    if (
      !d.success
    ) {
      skillStateEl.textContent =
        '쿨타임';

      return;
    }

    setFireballSelected(
      false
    );

    startCooldownDisplay();
  }
);

// ======================================================
// 내 플레이어
// ======================================================

const getMe =
  () =>
    players.find(
      p =>
        p.id ===
        myId
    ) ||
    null;

// ======================================================
// E = 파이어볼 선택
// ======================================================

function setFireballSelected(
  selected
) {

  if (
    serverFull
  ) {
    return;
  }

  if (
    selected &&

    performance.now() -
    lastLocalCast <
    fireballCooldown
  ) {
    skillStateEl.textContent =
      '쿨타임';

    return;
  }

  fireballSelected =
    selected;

  document.body.classList.toggle(
    'skill-selected',
    selected
  );

  skillE.classList.toggle(
    'selected',
    selected
  );

  skillStateEl.textContent =
    selected
      ? '파이어볼 선택됨 · 맵을 클릭하세요'
      : '대기';

  skillE.innerHTML =
    selected
      ? '선택됨<br>클릭 발사'
      : 'E<br>파이어볼';
}

function selectFireball() {

  if (
    !serverFull &&
    !waitingForCastResult
  ) {
    setFireballSelected(
      true
    );
  }
}

function startCooldownDisplay() {

  lastLocalCast =
    performance.now();

  skillE.classList.add(
    'cooling'
  );

  skillE.innerHTML =
    '쿨타임';

  skillStateEl.textContent =
    '쿨타임';

  setTimeout(
    () => {

      skillE.classList.remove(
        'cooling'
      );

      skillE.innerHTML =
        'E<br>파이어볼';

      skillStateEl.textContent =
        '대기';
    },

    fireballCooldown
  );
}

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
      ].includes(
        k
      )
    ) {
      keys.add(
        k
      );

      e.preventDefault();
    }

    if (
      k === 'e'
    ) {
      selectFireball();

      e.preventDefault();
    }

    if (
      k ===
        'escape' &&
      fireballSelected
    ) {
      setFireballSelected(
        false
      );
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

canvas.addEventListener(
  'pointermove',
  e => {

    if (
      e.pointerType !==
        'mouse' &&
      e.pointerType !==
        'pen'
    ) {
      return;
    }

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
  x,
  y
) {

  const r =
    joystick.getBoundingClientRect();

  const cx =
    r.left +
    r.width /
    2;

  const cy =
    r.top +
    r.height /
    2;

  const max =
    r.width *
    .34;

  let dx =
    x -
    cx;

  let dy =
    y -
    cy;

  const len =
    Math.hypot(
      dx,
      dy
    );

  if (
    len >
    max
  ) {
    dx =
      dx /
      len *
      max;

    dy =
      dy /
      len *
      max;
  }

  joyX =
    dx /
    max;

  joyY =
    dy /
    max;

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

function releaseJoy(
  e
) {

  if (
    e.pointerId !==
    joyPointer
  ) {
    return;
  }

  joyPointer =
    null;

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

// 모바일 E 버튼도 스킬 선택
skillE.addEventListener(
  'pointerdown',
  e => {

    e.preventDefault();

    e.stopPropagation();

    selectFireball();
  }
);

// ======================================================
// 마우스 시선 계산
// ======================================================

function aimToScreen(
  screenX,
  screenY
) {

  const me =
    getMe();

  if (!me) {
    return null;
  }

  let x =
    cameraX +
    screenX -
    me.x;

  let y =
    cameraY +
    screenY -
    me.y;

  const len =
    Math.hypot(
      x,
      y
    );

  if (
    len <
    .001
  ) {
    return null;
  }

  return {
    x:
      x /
      len,

    y:
      y /
      len
  };
}

function sendMouseAim(
  force = false
) {

  if (
    serverFull ||
    !mouseAimActive
  ) {
    return;
  }

  const a =
    aimToScreen(
      mouseX,
      mouseY
    );

  if (!a) {
    return;
  }

  if (
    force ||

    Math.abs(
      a.x -
      lastAimX
    ) >
      .01 ||

    Math.abs(
      a.y -
      lastAimY
    ) >
      .01
  ) {
    socket.emit(
      'aim',
      a
    );

    lastAimX =
      a.x;

    lastAimY =
      a.y;
  }
}

// ======================================================
// 선택된 파이어볼을 클릭 위치로 발사
// ======================================================

function castSelectedAt(
  screenX,
  screenY
) {

  if (
    !fireballSelected ||
    waitingForCastResult ||
    serverFull
  ) {
    return;
  }

  if (
    performance.now() -
    lastLocalCast <
    fireballCooldown
  ) {
    skillStateEl.textContent =
      '쿨타임';

    return;
  }

  const me =
    getMe();

  if (!me) {
    return;
  }

  const targetX =
    cClamp(
      cameraX +
      screenX,

      0,
      world.width
    );

  const targetY =
    cClamp(
      cameraY +
      screenY,

      0,
      world.height
    );

  const a =
    aimToScreen(
      screenX,
      screenY
    );

  if (a) {
    socket.emit(
      'aim',
      a
    );
  }

  waitingForCastResult =
    true;

  socket.emit(
    'castFireball',
    {
      targetX,
      targetY
    }
  );
}

// 파이어볼이 선택된 상태에서만
// 맵 클릭 = 발사
canvas.addEventListener(
  'pointerdown',
  e => {

    if (
      !fireballSelected
    ) {
      return;
    }

    e.preventDefault();

    mouseX =
      e.clientX;

    mouseY =
      e.clientY;

    if (
      e.pointerType ===
        'mouse' ||
      e.pointerType ===
        'pen'
    ) {
      mouseAimActive =
        true;
    }

    castSelectedAt(
      e.clientX,
      e.clientY
    );
  }
);

// ======================================================
// 이동 입력
// ======================================================

setInterval(
  () => {

    if (
      serverFull
    ) {
      return;
    }

    let x = 0;
    let y = 0;

    if (
      keys.has('a') ||
      keys.has(
        'arrowleft'
      )
    ) {
      x--;
    }

    if (
      keys.has('d') ||
      keys.has(
        'arrowright'
      )
    ) {
      x++;
    }

    if (
      keys.has('w') ||
      keys.has(
        'arrowup'
      )
    ) {
      y--;
    }

    if (
      keys.has('s') ||
      keys.has(
        'arrowdown'
      )
    ) {
      y++;
    }

    if (
      Math.abs(
        joyX
      ) >
        .08 ||

      Math.abs(
        joyY
      ) >
        .08
    ) {
      x =
        joyX;

      y =
        joyY;
    }

    const len =
      Math.hypot(
        x,
        y
      );

    if (
      len >
      1
    ) {
      x /= len;
      y /= len;
    }

    if (
      Math.abs(
        x -
        lastInputX
      ) >
        .01 ||

      Math.abs(
        y -
        lastInputY
      ) >
        .01
    ) {
      socket.emit(
        'input',
        {
          x,
          y
        }
      );

      lastInputX =
        x;

      lastInputY =
        y;
    }

    // 캐릭터 시선은 마우스 추적
    sendMouseAim(
      false
    );
  },

  33
);

// ======================================================
// 맵
// ======================================================

function visible(
  x,
  y,
  m,
  cx,
  cy
) {

  return (
    x >
      cx -
      m &&

    x <
      cx +
      innerWidth +
      m &&

    y >
      cy -
      m &&

    y <
      cy +
      innerHeight +
      m
  );
}

function hashRand(
  n
) {

  const v =
    Math.sin(
      n *
      12.9898
    ) *
    43758.5453;

  return (
    v -
    Math.floor(
      v
    )
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
    1580 -
    cy,

    world.width,
    105
  );

  ctx.fillRect(
    2510 -
    cx,

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
      hashRand(
        i + 1
      ) *
      (
        world.width -
        180
      );

    const y =
      90 +
      hashRand(
        i + 701
      ) *
      (
        world.height -
        180
      );

    const s =
      22 +
      hashRand(
        i + 1401
      ) *
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
      x -
      cx;

    const sy =
      y -
      cy;

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

    ctx.fillStyle =
      '#694526';

    ctx.fillRect(
      sx -
      s * .12,

      sy,

      s * .24,

      s * .85
    );

    ctx.beginPath();

    ctx.arc(
      sx,
      sy - 8,
      s,
      0,
      Math.PI * 2
    );

    ctx.arc(
      sx -
      s * .55,

      sy,

      s * .58,

      0,
      Math.PI * 2
    );

    ctx.arc(
      sx +
      s * .55,

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
      sx -
      s * .25,

      sy -
      s * .28,

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
      x -
      cx,

      y -
      cy,

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
      ][
        i % 4
      ];

    ctx.fill();
  }

  ctx.strokeStyle =
    'rgba(255,255,255,.25)';

  ctx.lineWidth =
    4;

  ctx.strokeRect(
    -cx,
    -cy,
    world.width,
    world.height
  );
}

// ======================================================
// 마법사 걷기
// ======================================================

function walkFrame(
  p
) {

  if (
    !p.moving
  ) {
    return 1;
  }

  return (
    Math.floor(
      performance.now() /
      145
    ) %
    3
  );
}

function directionRow(
  d
) {

  if (
    d === 'back'
  ) {
    return 1;
  }

  if (
    d === 'left'
  ) {
    return 2;
  }

  if (
    d === 'right'
  ) {
    return 3;
  }

  return 0;
}

/*
mage.png 실제 이미지에서
각 캐릭터의 투명 영역 위치를 따로 지정.

기존처럼
width / 3
height / 4

방식으로 자르지 않음.

그래서 옆 프레임이나 아래 프레임이
같이 딸려오는 문제가 없어짐.
*/

const MAGE_FRAMES = [

  // 앞
  [
    {
      x: 104,
      y: 75,
      w: 236,
      h: 308
    },

    {
      x: 376,
      y: 74,
      w: 237,
      h: 308
    },

    {
      x: 680,
      y: 74,
      w: 236,
      h: 308
    }
  ],

  // 뒤
  [
    {
      x: 98,
      y: 417,
      w: 234,
      h: 287
    },

    {
      x: 375,
      y: 418,
      w: 230,
      h: 286
    },

    {
      x: 679,
      y: 417,
      w: 229,
      h: 287
    }
  ],

  // 왼쪽
  [
    {
      x: 116,
      y: 744,
      w: 222,
      h: 285
    },

    {
      x: 387,
      y: 745,
      w: 221,
      h: 284
    },

    {
      x: 691,
      y: 744,
      w: 224,
      h: 285
    }
  ],

  // 오른쪽
  [
    {
      x: 152,
      y: 1071,
      w: 212,
      h: 279
    },

    {
      x: 419,
      y: 1069,
      w: 214,
      h: 282
    },

    {
      x: 722,
      y: 1070,
      w: 217,
      h: 279
    }
  ]
];

// 모든 프레임 같은 확대비율
const MAGE_SCALE =
  .43;

// 모든 프레임 발 위치
const MAGE_FOOT_Y =
  31;

function drawMage(
  p,
  sx,
  sy,
  isMe
) {

  ctx.save();

  ctx.translate(
    Math.round(
      sx
    ),

    Math.round(
      sy
    )
  );

  if (
    mageReady
  ) {

    const frame =
      MAGE_FRAMES[
        directionRow(
          p.direction
        )
      ][
        walkFrame(
          p
        )
      ];

    const drawWidth =
      frame.w *
      MAGE_SCALE;

    const drawHeight =
      frame.h *
      MAGE_SCALE;

    /*
    중요:
    모든 프레임의
    아래 중앙을
    동일한 좌표에 배치.

             중심
               |
               |
            캐릭터
               |
            발 위치
    -------------

    걷기 프레임이 바뀌어도
    발 위치가 이동하지 않음.
    */

    ctx.drawImage(
      mageImage,

      frame.x,
      frame.y,
      frame.w,
      frame.h,

      -drawWidth /
      2,

      MAGE_FOOT_Y -
      drawHeight,

      drawWidth,
      drawHeight
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
  }

  ctx.restore();

  // 캐릭터 주위 원 없음

  ctx.fillStyle =
    'rgba(0,0,0,.48)';

  ctx.fillRect(
    sx - 33,
    sy - 76,
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

    sy - 63
  );
}

// ======================================================
// 슬라임 렌더
// ======================================================

function drawSlime(
  s,
  cx,
  cy
) {

  if (
    !s.alive
  ) {
    return;
  }

  const x =
    s.x -
    cx;

  const y =
    s.y -
    cy;

  const r =
    s.elite
      ? 34
      : 24;

  const bounce =
    Math.sin(
      performance.now() /
      180 +
      s.id
    ) *
    2.5;

  ctx.save();

  ctx.translate(
    x,
    y +
    bounce
  );

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

  if (
    s.elite
  ) {

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
    x -
    w / 2,

    y -
    r -
    22,

    w,
    7
  );

  ctx.fillStyle =
    s.elite
      ? '#e5b84d'
      : '#ef6666';

  ctx.fillRect(
    x -
    w / 2 +
    1,

    y -
    r -
    21,

    (
      w -
      2
    ) *
    pct,

    5
  );

  if (
    s.elite
  ) {

    ctx.fillStyle =
      '#ffe59a';

    ctx.font =
      '700 11px system-ui';

    ctx.textAlign =
      'center';

    ctx.fillText(
      'ELITE',
      x,
      y -
      r -
      28
    );
  }
}

// ======================================================
// 파이어볼 렌더
// ======================================================

function drawFireball(
  f,
  cx,
  cy
) {

  const x =
    f.x -
    cx;

  const y =
    f.y -
    cy;

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
// 스킬 선택 중 마우스 표적
// ======================================================

function drawTarget() {

  if (
    !fireballSelected ||
    !mouseAimActive
  ) {
    return;
  }

  ctx.save();

  ctx.strokeStyle =
    'rgba(255,150,55,.9)';

  ctx.lineWidth =
    2;

  ctx.beginPath();

  ctx.arc(
    mouseX,
    mouseY,
    11,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  ctx.beginPath();

  ctx.moveTo(
    mouseX - 17,
    mouseY
  );

  ctx.lineTo(
    mouseX - 7,
    mouseY
  );

  ctx.moveTo(
    mouseX + 7,
    mouseY
  );

  ctx.lineTo(
    mouseX + 17,
    mouseY
  );

  ctx.moveTo(
    mouseX,
    mouseY - 17
  );

  ctx.lineTo(
    mouseX,
    mouseY - 7
  );

  ctx.moveTo(
    mouseX,
    mouseY + 7
  );

  ctx.lineTo(
    mouseX,
    mouseY + 17
  );

  ctx.stroke();

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
    getMe();

  cameraX =
    0;

  cameraY =
    0;

  if (
    me
  ) {

    cameraX =
      cClamp(
        me.x -
        innerWidth /
        2,

        0,

        Math.max(
          0,

          world.width -
          innerWidth
        )
      );

    cameraY =
      cClamp(
        me.y -
        innerHeight /
        2,

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

  const ordered =
    [
      ...players
    ].sort(
      (
        a,
        b
      ) =>
        a.y -
        b.y
    );

  for (
    const p
    of ordered
  ) {

    if (
      !visible(
        p.x,
        p.y,
        150,
        cameraX,
        cameraY
      )
    ) {
      continue;
    }

    drawMage(
      p,

      p.x -
      cameraX,

      p.y -
      cameraY,

      p.id ===
      myId
    );
  }

  drawTarget();
}

render();

</script>

</body>

</html>

`);

  }
);

// ======================================================
// 시작
// ======================================================

server.listen(
  PORT,
  () => {

    console.log(
      'Forest Mage RPG running on port ' +
      PORT
    );

    console.log(
      'Max players: ' +
      MAX_PLAYERS
    );

    console.log(
      'Slimes: ' +
      (
        NORMAL_SLIMES +
        ELITE_SLIMES
      )
    );
  }
);

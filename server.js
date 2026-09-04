const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const WORLD = {
  width: 5200,
  height: 3400
};

const MAX_PLAYERS = 20;

const PLAYER_RADIUS = 24;
const PLAYER_SPEED = 300;
const TICK_RATE = 30;


// ==============================
// 슬라임 설정
// ==============================

const NORMAL_SLIMES = 28;
const ELITE_SLIMES = 4;

const SLIME_RESPAWN_MS = 5000;


// ==============================
// 파이어볼 설정
// ==============================

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

  return Math.max(
    min,
    Math.min(
      max,
      v
    )
  );
}


function randomPoint(
  margin = 120
) {

  return {

    x:
      margin +
      Math.random() *
      (
        WORLD.width -
        margin * 2
      ),

    y:
      margin +
      Math.random() *
      (
        WORLD.height -
        margin * 2
      )

  };
}


// ==============================
// 플레이어 방향
// ==============================

function directionFromInput(
  x,
  y,
  previous = 'front'
) {

  if (
    Math.abs(x) < 0.05 &&
    Math.abs(y) < 0.05
  ) {

    return previous;

  }


  if (
    Math.abs(x) >
    Math.abs(y)
  ) {

    return x > 0
      ? 'right'
      : 'left';

  }


  return y > 0
    ? 'front'
    : 'back';
}


function directionVector(
  direction
) {

  if (
    direction === 'back'
  ) {

    return {
      x: 0,
      y: -1
    };

  }


  if (
    direction === 'left'
  ) {

    return {
      x: -1,
      y: 0
    };

  }


  if (
    direction === 'right'
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


// ==============================
// 플레이어 생성
// ==============================

function makePlayer(id) {

  const p =
    randomPoint(450);


  return {

    id,

    x: p.x,
    y: p.y,

    inputX: 0,
    inputY: 0,

    direction: 'front',

    moving: false,

    lastFireballAt: 0

  };
}


// ==============================
// 슬라임
// ==============================

function chooseSlimeDirection(
  slime
) {

  const angle =
    Math.random() *
    Math.PI *
    2;


  const speed =
    slime.elite
      ? 55 +
        Math.random() *
        25

      : 40 +
        Math.random() *
        30;


  slime.vx =
    Math.cos(angle) *
    speed;


  slime.vy =
    Math.sin(angle) *
    speed;


  slime.changeAt =
    Date.now() +
    900 +
    Math.random() *
    2600;
}


function createSlime(
  elite = false
) {

  const p =
    randomPoint(180);


  const slime = {

    id:
      nextSlimeId++,

    x:
      p.x,

    y:
      p.y,

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


  chooseSlimeDirection(
    slime
  );


  slimes.set(
    slime.id,
    slime
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


function respawnSlime(
  slime
) {

  const p =
    randomPoint(180);


  slime.x =
    p.x;

  slime.y =
    p.y;


  slime.hp =
    slime.maxHp;


  slime.alive =
    true;


  slime.respawnAt =
    0;


  chooseSlimeDirection(
    slime
  );
}


// ==============================
// 파이어볼
// ==============================

function castFireball(
  player
) {

  const now =
    Date.now();


  if (
    now -
    player.lastFireballAt <
    FIREBALL_COOLDOWN
  ) {

    return;

  }


  player.lastFireballAt =
    now;


  const direction =
    directionVector(
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
        direction.x *
        42,

      y:
        player.y +
        direction.y *
        42,

      vx:
        direction.x *
        FIREBALL_SPEED,

      vy:
        direction.y *
        FIREBALL_SPEED,

      radius:
        FIREBALL_RADIUS,

      life:
        FIREBALL_LIFE

    }
  );
}


// ==============================
// 접속
// ==============================

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
        () => {

          socket.disconnect(
            true
          );

        },

        400
      );


      return;
    }


    const player =
      makePlayer(
        socket.id
      );


    players.set(
      socket.id,
      player
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


    // 이동
    socket.on(
      'input',
      (data = {}) => {

        const player =
          players.get(
            socket.id
          );


        if (!player)
          return;


        let x =
          Number(
            data.x
          ) || 0;


        let y =
          Number(
            data.y
          ) || 0;


        const length =
          Math.hypot(
            x,
            y
          );


        if (
          length > 1
        ) {

          x /=
            length;

          y /=
            length;
        }


        player.inputX =
          clamp(
            x,
            -1,
            1
          );


        player.inputY =
          clamp(
            y,
            -1,
            1
          );


        player.moving =
          Math.abs(x) > 0.05 ||
          Math.abs(y) > 0.05;


        player.direction =
          directionFromInput(
            x,
            y,
            player.direction
          );
      }
    );


    // E 파이어볼
    socket.on(
      'castFireball',
      () => {

        const player =
          players.get(
            socket.id
          );


        if (player) {

          castFireball(
            player
          );

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

  }
);


// ==============================
// 게임 업데이트
// ==============================

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


    // 플레이어 이동
    for (
      const player
      of players.values()
    ) {

      player.x +=
        player.inputX *
        PLAYER_SPEED *
        dt;


      player.y +=
        player.inputY *
        PLAYER_SPEED *
        dt;


      player.x =
        clamp(
          player.x,
          PLAYER_RADIUS,
          WORLD.width -
          PLAYER_RADIUS
        );


      player.y =
        clamp(
          player.y,
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

      if (
        !slime.alive
      ) {

        if (
          now >=
          slime.respawnAt
        ) {

          respawnSlime(
            slime
          );

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

        slime.vx *=
          -1;


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

        slime.vy *=
          -1;


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


      fireball.life -=
        dt;


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


      // 슬라임 명중
      for (
        const slime
        of slimes.values()
      ) {

        if (
          !slime.alive
        ) {

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

            slime.alive =
              false;


            slime.respawnAt =
              now +
              SLIME_RESPAWN_MS;

          }


          break;
        }
      }
    }


    // 전체 상태 전송
    io.emit(
      'state',
      {

        players:
          Array.from(
            players.values(),

            player => ({

              id:
                player.id,

              x:
                player.x,

              y:
                player.y,

              direction:
                player.direction,

              moving:
                player.moving

            })
          ),


        slimes:
          Array.from(
            slimes.values(),

            slime => ({

              id:
                slime.id,

              x:
                slime.x,

              y:
                slime.y,

              elite:
                slime.elite,

              hp:
                slime.hp,

              maxHp:
                slime.maxHp,

              alive:
                slime.alive

            })
          ),


        fireballs:
          Array.from(
            fireballs.values(),

            fireball => ({

              id:
                fireball.id,

              x:
                fireball.x,

              y:
                fireball.y,

              radius:
                fireball.radius

            })
          )

      }
    );

  },

  1000 /
  TICK_RATE
);


// ==============================
// 마법사 이미지
// ==============================

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


// ==============================
// 게임 화면
// ==============================

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
  box-sizing: border-box;
}

html,
body {

  margin: 0;

  width: 100%;
  height: 100%;

  overflow: hidden;

  background:
    #20391d;

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
}


#status {

  font-weight:
    800;
}


.skillText {

  color:
    #ffcc80;

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
    900 17px
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


#skillE:active {

  transform:
    scale(.96);
}


#skillE.cooling {

  opacity:
    .55;
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


<canvas id="game"></canvas>


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
PC: WASD + E ·
모바일: 조이스틱 + E 버튼
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
  width: 5200,
  height: 3400
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


let fireballCooldown =
  900;


let lastLocalCast =
  0;


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


// ==============================
// 마법사 이미지
// ==============================

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


// ==============================
// 화면 크기
// ==============================

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


// ==============================
// 서버
// ==============================

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
  data => {

    myId =
      data.id;


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

    serverFull =
      true;


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

    if (
      !serverFull
    ) {

      statusEl.textContent =
        '재접속 중...';

    }
  }
);


// ==============================
// 키보드
// ==============================

addEventListener(
  'keydown',
  e => {

    const key =
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
        key
      )
    ) {

      keys.add(
        key
      );


      e.preventDefault();
    }


    if (
      key === 'e'
    ) {

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


// ==============================
// 모바일 조이스틱
// ==============================

function moveJoystick(
  clientX,
  clientY
) {

  const rect =
    joystick.getBoundingClientRect();


  const centerX =
    rect.left +
    rect.width / 2;


  const centerY =
    rect.top +
    rect.height / 2;


  let dx =
    clientX -
    centerX;


  let dy =
    clientY -
    centerY;


  const max =
    rect.width *
    .34;


  const length =
    Math.hypot(
      dx,
      dy
    );


  if (
    length > max
  ) {

    dx =
      dx /
      length *
      max;


    dy =
      dy /
      length *
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


  joyX =
    0;


  joyY =
    0;


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


// ==============================
// 파이어볼 발사
// ==============================

function castFireball() {

  if (
    serverFull
  ) {

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


// ==============================
// 이동 입력
// ==============================

let lastX = 999;
let lastY = 999;


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

      x =
        joyX;


      y =
        joyY;
    }


    const length =
      Math.hypot(
        x,
        y
      );


    if (
      length > 1
    ) {

      x /=
        length;

      y /=
        length;

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


      lastX =
        x;


      lastY =
        y;
    }

  },

  33
);


// ==============================
// 숲
// ==============================

function visible(
  x,
  y,
  margin,
  cameraX,
  cameraY
) {

  return (

    x >
    cameraX -
    margin &&

    x <
    cameraX +
    innerWidth +
    margin &&

    y >
    cameraY -
    margin &&

    y <
    cameraY +
    innerHeight +
    margin

  );
}


function hashRand(n) {

  const x =
    Math.sin(
      n *
      12.9898
    ) *
    43758.5453;


  return x -
    Math.floor(
      x
    );
}


function drawForest(
  cameraX,
  cameraY
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
    -cameraX,
    1580 -
    cameraY,
    world.width,
    105
  );


  ctx.fillRect(
    2510 -
    cameraX,
    -cameraY,
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


    const size =
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
        cameraX,
        cameraY
      )
    ) {

      continue;
    }


    const screenX =
      x -
      cameraX;


    const screenY =
      y -
      cameraY;


    // 그림자
    ctx.beginPath();


    ctx.ellipse(
      screenX,
      screenY + 25,
      size * .72,
      size * .25,
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
      screenX -
      size * .12,
      screenY,
      size * .24,
      size * .85
    );


    // 잎
    ctx.beginPath();


    ctx.arc(
      screenX,
      screenY - 8,
      size,
      0,
      Math.PI * 2
    );


    ctx.arc(
      screenX -
      size * .55,
      screenY,
      size * .58,
      0,
      Math.PI * 2
    );


    ctx.arc(
      screenX +
      size * .55,
      screenY,
      size * .58,
      0,
      Math.PI * 2
    );


    ctx.fillStyle =
      '#287a3e';


    ctx.fill();


    ctx.beginPath();


    ctx.arc(
      screenX -
      size * .25,
      screenY -
      size * .28,
      size * .3,
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
        cameraX,
        cameraY
      )
    ) {

      continue;
    }


    ctx.beginPath();


    ctx.arc(
      x -
      cameraX,
      y -
      cameraY,
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
    -cameraX,
    -cameraY,
    world.width,
    world.height
  );
}


// ==============================
// 마법사 스프라이트
// ==============================

function walkFrame(
  player
) {

  if (
    !player.moving
  ) {

    return 1;

  }


  return (
    Math.floor(
      performance.now() /
      140
    ) %
    3
  );
}


function directionRow(
  direction
) {

  // 이미지 행
  // 0 = 앞
  // 1 = 뒤
  // 2 = 왼쪽
  // 3 = 오른쪽

  if (
    direction === 'back'
  ) {

    return 1;

  }


  if (
    direction === 'left'
  ) {

    return 2;

  }


  if (
    direction === 'right'
  ) {

    return 3;

  }


  return 0;
}


function drawMage(
  player,
  screenX,
  screenY,
  isMe
) {

  ctx.save();


  ctx.translate(
    Math.round(
      screenX
    ),
    Math.round(
      screenY
    )
  );


  // 그림자
  ctx.beginPath();


  ctx.ellipse(
    0,
    27,
    23,
    8,
    0,
    0,
    Math.PI * 2
  );


  ctx.fillStyle =
    'rgba(0,0,0,.24)';


  ctx.fill();


  if (
    mageReady
  ) {

    const column =
      walkFrame(
        player
      );


    const row =
      directionRow(
        player.direction
      );


    const sourceWidth =
      mageImage.width /
      3;


    const sourceHeight =
      mageImage.height /
      4;


    const drawWidth =
      108;


    const drawHeight =
      144;


    ctx.drawImage(

      mageImage,

      column *
      sourceWidth,

      row *
      sourceHeight,

      sourceWidth,

      sourceHeight,

      -drawWidth /
      2,

      -drawHeight +
      38,

      drawWidth,

      drawHeight

    );

  } else {

    ctx.beginPath();


    ctx.arc(
      0,
      0,
      24,
      0,
      Math.PI * 2
    );


    ctx.fillStyle =
      '#6743a5';


    ctx.fill();


    ctx.fillStyle =
      '#f0d6ff';


    ctx.font =
      'bold 24px sans-serif';


    ctx.textAlign =
      'center';


    ctx.fillText(
      'M',
      0,
      8
    );
  }


  if (
    isMe
  ) {

    ctx.beginPath();


    ctx.arc(
      0,
      0,
      34,
      0,
      Math.PI * 2
    );


    ctx.strokeStyle =
      'rgba(255,226,128,.75)';


    ctx.lineWidth =
      2;


    ctx.stroke();
  }


  ctx.restore();


  // 이름
  ctx.fillStyle =
    'rgba(0,0,0,.48)';


  ctx.fillRect(
    screenX - 33,
    screenY - 65,
    66,
    18
  );


  ctx.fillStyle =
    isMe
      ? '#ffe082'
      : '#ffffff';


  ctx.font =
    '700 12px system-ui';


  ctx.textAlign =
    'center';


  ctx.fillText(

    isMe
      ? 'YOU'
      : 'P-' +
        player.id.slice(
          0,
          4
        ),

    screenX,

    screenY - 52

  );
}


// ==============================
// 슬라임
// ==============================

function drawSlime(
  slime,
  cameraX,
  cameraY
) {

  if (
    !slime.alive
  ) {

    return;
  }


  const x =
    slime.x -
    cameraX;


  const y =
    slime.y -
    cameraY;


  const radius =
    slime.elite
      ? 34
      : 24;


  const bounce =
    Math.sin(
      performance.now() /
      180 +
      slime.id
    ) *
    2.5;


  ctx.save();


  ctx.translate(
    x,
    y +
    bounce
  );


  // 그림자
  ctx.beginPath();


  ctx.ellipse(
    0,
    radius * .72,
    radius * .82,
    radius * .28,
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
    -radius,
    8
  );


  ctx.quadraticCurveTo(
    -radius,
    -radius * .65,
    0,
    -radius
  );


  ctx.quadraticCurveTo(
    radius,
    -radius * .65,
    radius,
    8
  );


  ctx.quadraticCurveTo(
    0,
    radius * .85,
    -radius,
    8
  );


  ctx.fillStyle =
    slime.elite
      ? '#7d4fd1'
      : '#58c96f';


  ctx.fill();


  // 반짝임
  ctx.beginPath();


  ctx.ellipse(
    -radius * .3,
    -radius * .25,
    radius * .22,
    radius * .13,
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
    -radius * .3,
    -2,
    3,
    0,
    Math.PI * 2
  );


  ctx.arc(
    radius * .3,
    -2,
    3,
    0,
    Math.PI * 2
  );


  ctx.fill();


  // 엘리트 왕관
  if (
    slime.elite
  ) {

    ctx.fillStyle =
      '#f6cf58';


    ctx.beginPath();


    ctx.moveTo(
      -13,
      -radius - 2
    );


    ctx.lineTo(
      -8,
      -radius - 13
    );


    ctx.lineTo(
      0,
      -radius - 5
    );


    ctx.lineTo(
      8,
      -radius - 13
    );


    ctx.lineTo(
      13,
      -radius - 2
    );


    ctx.closePath();


    ctx.fill();
  }


  ctx.restore();


  // 체력바
  const width =
    slime.elite
      ? 68
      : 48;


  const hpPercent =
    Math.max(
      0,
      slime.hp /
      slime.maxHp
    );


  ctx.fillStyle =
    'rgba(0,0,0,.55)';


  ctx.fillRect(
    x -
    width / 2,
    y -
    radius -
    22,
    width,
    7
  );


  ctx.fillStyle =
    slime.elite
      ? '#e5b84d'
      : '#ef6666';


  ctx.fillRect(
    x -
    width / 2 +
    1,
    y -
    radius -
    21,
    (
      width -
      2
    ) *
    hpPercent,
    5
  );


  if (
    slime.elite
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
      radius -
      28
    );
  }
}


// ==============================
// 파이어볼
// ==============================

function drawFireball(
  fireball,
  cameraX,
  cameraY
) {

  const x =
    fireball.x -
    cameraX;


  const y =
    fireball.y -
    cameraY;


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


// ==============================
// 렌더
// ==============================

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
      player =>
        player.id ===
        myId
    );


  let cameraX = 0;
  let cameraY = 0;


  if (
    me
  ) {

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
    const slime
    of slimes
  ) {

    if (
      visible(
        slime.x,
        slime.y,
        80,
        cameraX,
        cameraY
      )
    ) {

      drawSlime(
        slime,
        cameraX,
        cameraY
      );

    }
  }


  // 파이어볼
  for (
    const fireball
    of fireballs
  ) {

    if (
      visible(
        fireball.x,
        fireball.y,
        50,
        cameraX,
        cameraY
      )
    ) {

      drawFireball(
        fireball,
        cameraX,
        cameraY
      );

    }
  }


  // 플레이어
  const ordered =
    [...players].sort(
      (
        a,
        b
      ) =>
        a.y -
        b.y
    );


  for (
    const player
    of ordered
  ) {

    if (
      !visible(
        player.x,
        player.y,
        100,
        cameraX,
        cameraY
      )
    ) {

      continue;
    }


    drawMage(

      player,

      player.x -
      cameraX,

      player.y -
      cameraY,

      player.id ===
      myId

    );
  }
}


render();

</script>

</body>

</html>

`);

  }
);


// ==============================
// 서버 실행
// ==============================

server.listen(
  PORT,
  () => {

    console.log(
      'Forest Mage RPG running on port ' +
      PORT
    );


    console.log(
      'Players: ' +
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

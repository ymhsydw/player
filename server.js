const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ==============================
// 게임 설정
// ==============================

// 기존보다 훨씬 넓은 맵
const WORLD = {
  width: 5000,
  height: 3000
};

const PLAYER_RADIUS = 24;
const PLAYER_SPEED = 320;
const TICK_RATE = 30;
const MAX_PLAYERS = 20;

const players = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makePlayer(id) {
  return {
    id,

    x:
      300 +
      Math.random() *
        (WORLD.width - 600),

    y:
      300 +
      Math.random() *
        (WORLD.height - 600),

    inputX: 0,
    inputY: 0,

    angle: 0
  };
}

// ==============================
// 접속
// ==============================

io.on('connection', (socket) => {

  if (players.size >= MAX_PLAYERS) {

    socket.emit('serverFull', {
      maxPlayers: MAX_PLAYERS
    });

    setTimeout(() => {
      socket.disconnect(true);
    }, 500);

    return;
  }

  const player =
    makePlayer(socket.id);

  players.set(
    socket.id,
    player
  );

  socket.emit('welcome', {
    id: socket.id,
    world: WORLD,
    maxPlayers: MAX_PLAYERS
  });

  io.emit('count', {
    current: players.size,
    max: MAX_PLAYERS
  });

  // ==============================
  // 이동 입력
  // ==============================

  socket.on('input', (data = {}) => {

    const player =
      players.get(socket.id);

    if (!player) return;

    let x =
      Number(data.x) || 0;

    let y =
      Number(data.y) || 0;

    const length =
      Math.hypot(x, y);

    if (length > 1) {
      x /= length;
      y /= length;
    }

    player.inputX =
      clamp(x, -1, 1);

    player.inputY =
      clamp(y, -1, 1);

    // 움직이는 방향으로 캐릭터 회전
    if (
      Math.abs(x) > 0.01 ||
      Math.abs(y) > 0.01
    ) {

      player.angle =
        Math.atan2(y, x);
    }
  });

  // ==============================
  // 나가기
  // ==============================

  socket.on('disconnect', () => {

    if (!players.has(socket.id))
      return;

    players.delete(socket.id);

    io.emit('count', {
      current: players.size,
      max: MAX_PLAYERS
    });

  });

});

// ==============================
// 게임 업데이트
// ==============================

let last = Date.now();

setInterval(() => {

  const now = Date.now();

  const dt =
    Math.min(
      (now - last) / 1000,
      0.1
    );

  last = now;

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

  io.emit(
    'state',
    Array.from(
      players.values(),
      player => ({
        id: player.id,
        x: player.x,
        y: player.y,
        angle: player.angle
      })
    )
  );

}, 1000 / TICK_RATE);


// ==============================
// 웹 게임
// ==============================

app.get('/', (_req, res) => {

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
    viewport-fit=cover,
    user-scalable=no
  "
>

<title>Open Multiplayer</title>

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

  background: #111827;

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

  z-index: 10;

  color: white;

  background:
    rgba(0,0,0,.48);

  padding:
    10px 13px;

  border-radius: 12px;

  font-size: 14px;

  line-height: 1.5;

  backdrop-filter:
    blur(6px);
}

#status {
  font-weight: 700;
}

#joystick {

  position: fixed;

  left: 24px;
  bottom: 24px;

  width: 145px;
  height: 145px;

  border-radius: 50%;

  border:
    2px solid
    rgba(255,255,255,.38);

  background:
    rgba(255,255,255,.10);

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

  background:
    rgba(255,255,255,.82);

  box-shadow:
    0 5px 15px
    rgba(0,0,0,.3);

  pointer-events: none;
}

#hint {

  position: fixed;

  right: 12px;
  bottom: 12px;

  color:
    rgba(255,255,255,.85);

  background:
    rgba(0,0,0,.38);

  padding:
    8px 11px;

  border-radius: 10px;

  font-size: 12px;
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

  <div id="status">
    서버 연결 중...
  </div>

  <div>
    접속자:
    <span id="count">0</span>
    /
    <span id="maxCount">20</span>
    명
  </div>

  <div>
    맵 크기:
    5000 × 3000
  </div>

</div>

<div id="joystick">

  <div id="stick"></div>

</div>

<div id="hint">
PC: WASD / 방향키
· 모바일: 조이스틱
</div>


<script src="/socket.io/socket.io.js"></script>

<script>

const socket = io();

const canvas =
  document.getElementById('game');

const ctx =
  canvas.getContext('2d');

const statusEl =
  document.getElementById('status');

const countEl =
  document.getElementById('count');

const maxCountEl =
  document.getElementById('maxCount');

const joystick =
  document.getElementById('joystick');

const stick =
  document.getElementById('stick');

let myId = null;

let world = {
  width: 5000,
  height: 3000
};

let players = [];

let keys =
  new Set();

let touchX = 0;
let touchY = 0;

let joystickPointer = null;

let serverIsFull = false;


// ==============================
// 화면 크기
// ==============================

function resize() {

  const dpr =
    Math.min(
      window.devicePixelRatio || 1,
      2
    );

  canvas.width =
    Math.floor(
      innerWidth * dpr
    );

  canvas.height =
    Math.floor(
      innerHeight * dpr
    );

  canvas.style.width =
    innerWidth + 'px';

  canvas.style.height =
    innerHeight + 'px';

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );

}

addEventListener(
  'resize',
  resize
);

resize();


// ==============================
// 서버
// ==============================

socket.on('connect', () => {

  if (!serverIsFull) {

    statusEl.textContent =
      '공개 서버 접속됨';

  }

});

socket.on(
  'welcome',
  data => {

    myId =
      data.id;

    world =
      data.world;

    maxCountEl.textContent =
      data.maxPlayers;

  }
);

socket.on(
  'serverFull',
  data => {

    serverIsFull = true;

    statusEl.textContent =
      '서버가 가득 찼습니다';

    countEl.textContent =
      data.maxPlayers;

    maxCountEl.textContent =
      data.maxPlayers;

    joystick.style.display =
      'none';

    socket.io.opts.reconnection =
      false;
  }
);

socket.on(
  'disconnect',
  () => {

    if (serverIsFull) {

      statusEl.textContent =
        '서버가 가득 찼습니다';

    } else {

      statusEl.textContent =
        '재접속 중...';

    }

  }
);

socket.on(
  'state',
  state => {

    players = state;

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


// ==============================
// PC 조작
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
      ].includes(key)
    ) {

      keys.add(key);

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

function setJoystickFromPoint(
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
    clientX - centerX;

  let dy =
    clientY - centerY;

  const max =
    rect.width * 0.34;

  const length =
    Math.hypot(dx, dy);

  if (length > max) {

    dx =
      dx / length * max;

    dy =
      dy / length * max;
  }

  touchX =
    dx / max;

  touchY =
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

    joystickPointer =
      e.pointerId;

    joystick.setPointerCapture(
      e.pointerId
    );

    setJoystickFromPoint(
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
      joystickPointer
    ) {

      setJoystickFromPoint(
        e.clientX,
        e.clientY
      );

    }

  }
);

function releaseJoystick(e) {

  if (
    e.pointerId !==
    joystickPointer
  ) return;

  joystickPointer = null;

  touchX = 0;
  touchY = 0;

  stick.style.transform =
    'translate(0px,0px)';
}

joystick.addEventListener(
  'pointerup',
  releaseJoystick
);

joystick.addEventListener(
  'pointercancel',
  releaseJoystick
);


// ==============================
// 입력 전송
// ==============================

let lastSentX = 999;
let lastSentY = 999;

setInterval(() => {

  if (serverIsFull)
    return;

  let x = 0;
  let y = 0;

  if (
    keys.has('a') ||
    keys.has('arrowleft')
  ) x -= 1;

  if (
    keys.has('d') ||
    keys.has('arrowright')
  ) x += 1;

  if (
    keys.has('w') ||
    keys.has('arrowup')
  ) y -= 1;

  if (
    keys.has('s') ||
    keys.has('arrowdown')
  ) y += 1;

  if (
    Math.abs(touchX) > 0.08 ||
    Math.abs(touchY) > 0.08
  ) {

    x = touchX;
    y = touchY;

  }

  const length =
    Math.hypot(x, y);

  if (length > 1) {

    x /= length;
    y /= length;

  }

  if (
    Math.abs(
      x - lastSentX
    ) > 0.01 ||

    Math.abs(
      y - lastSentY
    ) > 0.01
  ) {

    socket.emit(
      'input',
      {
        x,
        y
      }
    );

    lastSentX = x;
    lastSentY = y;
  }

}, 33);


// ==============================
// 배경
// ==============================

function drawGrid(
  cameraX,
  cameraY
) {

  const spacing = 100;

  ctx.strokeStyle =
    'rgba(255,255,255,.05)';

  ctx.lineWidth = 1;

  ctx.beginPath();

  const startX =
    Math.floor(
      cameraX / spacing
    ) * spacing;

  const endX =
    cameraX + innerWidth;

  const startY =
    Math.floor(
      cameraY / spacing
    ) * spacing;

  const endY =
    cameraY + innerHeight;

  for (
    let x = startX;
    x <= endX;
    x += spacing
  ) {

    ctx.moveTo(
      x - cameraX,
      0
    );

    ctx.lineTo(
      x - cameraX,
      innerHeight
    );

  }

  for (
    let y = startY;
    y <= endY;
    y += spacing
  ) {

    ctx.moveTo(
      0,
      y - cameraY
    );

    ctx.lineTo(
      innerWidth,
      y - cameraY
    );

  }

  ctx.stroke();
}


// ==============================
// 캐릭터 색상
// ==============================

function playerColor(id) {

  let hash = 0;

  for (
    let i = 0;
    i < id.length;
    i++
  ) {

    hash =
      id.charCodeAt(i) +
      ((hash << 5) - hash);

  }

  const colors = [
    '#4fc3f7',
    '#ff8a65',
    '#81c784',
    '#ba68c8',
    '#ffd54f',
    '#4db6ac',
    '#f06292',
    '#90a4ae'
  ];

  return colors[
    Math.abs(hash) %
    colors.length
  ];
}


// ==============================
// 사람 캐릭터
// ==============================

function drawCharacter(
  player,
  screenX,
  screenY,
  mine
) {

  ctx.save();

  ctx.translate(
    screenX,
    screenY
  );

  ctx.rotate(
    player.angle || 0
  );

  const color =
    mine
      ? '#45d4ff'
      : playerColor(
          player.id
        );

  // 그림자
  ctx.beginPath();

  ctx.ellipse(
    -2,
    8,
    25,
    16,
    0,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(0,0,0,.27)';

  ctx.fill();


  // 다리
  ctx.lineWidth = 9;

  ctx.lineCap = 'round';

  ctx.strokeStyle =
    '#263238';

  ctx.beginPath();

  ctx.moveTo(
    -10,
    -8
  );

  ctx.lineTo(
    -20,
    11
  );

  ctx.moveTo(
    -10,
    8
  );

  ctx.lineTo(
    -20,
    27
  );

  ctx.stroke();


  // 몸
  ctx.fillStyle =
    color;

  ctx.beginPath();

  ctx.roundRect(
    -12,
    -16,
    32,
    32,
    8
  );

  ctx.fill();


  // 팔
  ctx.lineWidth = 8;

  ctx.strokeStyle =
    '#e5b98f';

  ctx.beginPath();

  ctx.moveTo(
    3,
    -15
  );

  ctx.lineTo(
    20,
    -24
  );

  ctx.moveTo(
    3,
    15
  );

  ctx.lineTo(
    20,
    24
  );

  ctx.stroke();


  // 머리
  ctx.beginPath();

  ctx.arc(
    22,
    0,
    12,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    '#f2c49c';

  ctx.fill();


  // 머리카락
  ctx.beginPath();

  ctx.arc(
    24,
    0,
    12,
    Math.PI * 0.7,
    Math.PI * 1.3
  );

  ctx.lineWidth = 5;

  ctx.strokeStyle =
    '#2d2522';

  ctx.stroke();


  // 보는 방향
  ctx.beginPath();

  ctx.arc(
    29,
    -4,
    2,
    0,
    Math.PI * 2
  );

  ctx.arc(
    29,
    4,
    2,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    '#263238';

  ctx.fill();

  ctx.restore();


  // 이름은 회전하지 않음
  ctx.fillStyle =
    'rgba(255,255,255,.95)';

  ctx.font =
    '700 12px system-ui';

  ctx.textAlign =
    'center';

  ctx.fillText(
    mine
      ? 'YOU'
      : 'P-' +
        player.id.slice(0, 4),

    screenX,

    screenY - 43
  );
}


// ==============================
// 렌더링
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
        player.id === myId
    );

  let cameraX = 0;
  let cameraY = 0;

  if (me) {

    cameraX =
      me.x -
      innerWidth / 2;

    cameraY =
      me.y -
      innerHeight / 2;

    cameraX =
      Math.max(
        0,
        Math.min(
          Math.max(
            0,
            world.width -
              innerWidth
          ),
          cameraX
        )
      );

    cameraY =
      Math.max(
        0,
        Math.min(
          Math.max(
            0,
            world.height -
              innerHeight
          ),
          cameraY
        )
      );

  }


  // 바닥
  ctx.fillStyle =
    '#18243a';

  ctx.fillRect(
    0,
    0,
    innerWidth,
    innerHeight
  );

  drawGrid(
    cameraX,
    cameraY
  );


  // 맵 외곽
  ctx.strokeStyle =
    'rgba(255,255,255,.45)';

  ctx.lineWidth = 5;

  ctx.strokeRect(
    -cameraX,
    -cameraY,
    world.width,
    world.height
  );


  // ==============================
  // 간단한 맵 장식
  // ==============================

  ctx.fillStyle =
    'rgba(70,110,90,.32)';

  const zones = [

    [700, 500, 600, 400],

    [2100, 700, 900, 500],

    [3800, 1800, 700, 600],

    [1000, 2100, 900, 500]

  ];

  for (
    const zone
    of zones
  ) {

    ctx.fillRect(
      zone[0] -
        cameraX,

      zone[1] -
        cameraY,

      zone[2],
      zone[3]
    );

  }


  // 캐릭터
  for (
    const player
    of players
  ) {

    const screenX =
      player.x -
      cameraX;

    const screenY =
      player.y -
      cameraY;

    if (
      screenX < -80 ||
      screenX >
        innerWidth + 80 ||
      screenY < -80 ||
      screenY >
        innerHeight + 80
    ) {

      continue;

    }

    drawCharacter(
      player,
      screenX,
      screenY,
      player.id === myId
    );
  }

}

render();

</script>

</body>

</html>

`);

});


// ==============================
// 서버 시작
// ==============================

server.listen(
  PORT,
  () => {

    console.log(
      'Server running: ' +
      PORT
    );

    console.log(
      'Map: ' +
      WORLD.width +
      ' x ' +
      WORLD.height
    );

    console.log(
      'Max players: ' +
      MAX_PLAYERS
    );
  }
);

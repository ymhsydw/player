const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const WORLD = {
  width: 2000,
  height: 1200
};

const PLAYER_RADIUS = 22;
const PLAYER_SPEED = 280;
const TICK_RATE = 30;

// ==============================
// 최대 서버 접속 인원
// 여기 숫자만 바꾸면 됨
// ==============================
const MAX_PLAYERS = 20;

const players = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makePlayer(id) {
  return {
    id,
    x: 120 + Math.random() * (WORLD.width - 240),
    y: 120 + Math.random() * (WORLD.height - 240),
    inputX: 0,
    inputY: 0
  };
}


// ==============================
// 플레이어 접속
// ==============================

io.on('connection', (socket) => {

  // 서버가 가득 찬 경우
  if (players.size >= MAX_PLAYERS) {

    socket.emit('serverFull', {
      maxPlayers: MAX_PLAYERS
    });

    setTimeout(() => {
      socket.disconnect(true);
    }, 500);

    return;
  }


  // 플레이어 생성
  players.set(
    socket.id,
    makePlayer(socket.id)
  );


  // 접속 성공
  socket.emit('welcome', {
    id: socket.id,
    world: WORLD,
    maxPlayers: MAX_PLAYERS
  });


  // 접속자 수 전송
  io.emit('count', {
    current: players.size,
    max: MAX_PLAYERS
  });


  // ==============================
  // 플레이어 이동 입력
  // ==============================

  socket.on('input', (data = {}) => {

    const player = players.get(socket.id);

    if (!player) return;


    let x = Number(data.x) || 0;
    let y = Number(data.y) || 0;


    const length = Math.hypot(x, y);


    if (length > 1) {

      x /= length;
      y /= length;

    }


    player.inputX = clamp(x, -1, 1);
    player.inputY = clamp(y, -1, 1);

  });


  // ==============================
  // 플레이어 나가기
  // ==============================

  socket.on('disconnect', () => {

    if (!players.has(socket.id)) return;


    players.delete(socket.id);


    io.emit('count', {
      current: players.size,
      max: MAX_PLAYERS
    });

  });

});


// ==============================
// 게임 서버 업데이트
// ==============================

let last = Date.now();


setInterval(() => {

  const now = Date.now();

  const dt = Math.min(
    (now - last) / 1000,
    0.1
  );

  last = now;


  for (const player of players.values()) {

    player.x +=
      player.inputX *
      PLAYER_SPEED *
      dt;


    player.y +=
      player.inputY *
      PLAYER_SPEED *
      dt;


    player.x = clamp(
      player.x,
      PLAYER_RADIUS,
      WORLD.width - PLAYER_RADIUS
    );


    player.y = clamp(
      player.y,
      PLAYER_RADIUS,
      WORLD.height - PLAYER_RADIUS
    );

  }


  // 모든 플레이어 위치 전송
  io.emit(
    'state',
    Array.from(
      players.values(),
      (player) => ({
        id: player.id,
        x: player.x,
        y: player.y
      })
    )
  );

}, 1000 / TICK_RATE);



// ==============================
// 게임 화면
// ==============================

app.get('/', (_req, res) => {

  res.type('html').send(`

<!doctype html>

<html lang="ko">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,
  initial-scale=1,
  viewport-fit=cover,
  user-scalable=no"
>

<title>Open Move</title>


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

  background: #172033;

}


#hud {

  position: fixed;

  left: 12px;
  top: 12px;

  z-index: 10;

  color: white;

  background:
    rgba(0,0,0,.42);

  padding:
    9px 12px;

  border-radius: 12px;

  font-size: 14px;

  line-height: 1.45;

  backdrop-filter:
    blur(6px);

}


#status {

  font-weight: 700;

}


#joystick {

  position: fixed;

  left: 22px;
  bottom: 22px;

  width: 138px;
  height: 138px;

  border-radius: 50%;

  border:
    2px solid
    rgba(255,255,255,.35);

  background:
    rgba(255,255,255,.09);

  z-index: 11;

  touch-action: none;

}


#stick {

  position: absolute;

  left: 44px;
  top: 44px;

  width: 50px;
  height: 50px;

  border-radius: 50%;

  background:
    rgba(255,255,255,.72);

  box-shadow:
    0 4px 14px
    rgba(0,0,0,.25);

  pointer-events: none;

}


#hint {

  position: fixed;

  right: 12px;
  bottom: 12px;

  z-index: 10;

  color:
    rgba(255,255,255,.82);

  background:
    rgba(0,0,0,.35);

  padding:
    8px 10px;

  border-radius: 10px;

  font-size: 12px;

}


@media (pointer: fine) {

  #joystick {

    opacity: .35;

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

</div>


<div
  id="joystick"
  aria-label="이동 조이스틱"
>

  <div id="stick"></div>

</div>


<div id="hint">

  PC: WASD / 방향키
  ·
  모바일: 왼쪽 조이스틱

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
  width: 2000,
  height: 1200
};


let players = [];


let keys =
  new Set();


let touchX = 0;
let touchY = 0;


let joystickPointer = null;


// 서버가 꽉 찼는지
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
// 서버 연결
// ==============================

socket.on('connect', () => {

  if (!serverIsFull) {

    statusEl.textContent =
      '공개 서버 접속됨';

  }

});



socket.on(
  'welcome',
  (data) => {

    myId = data.id;

    world = data.world;

    maxCountEl.textContent =
      data.maxPlayers;

  }
);



socket.on(
  'serverFull',
  (data) => {

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

      return;

    }


    statusEl.textContent =
      '서버 연결 끊김 · 재접속 중...';

  }
);



socket.on(
  'state',
  (state) => {

    players = state;

  }
);



socket.on(
  'count',
  (data) => {

    countEl.textContent =
      data.current;


    maxCountEl.textContent =
      data.max;

  }
);



// ==============================
// PC 키보드 조작
// ==============================

addEventListener(
  'keydown',
  (e) => {

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
  (e) => {

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
  (e) => {

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
  (e) => {

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
  ) {

    return;

  }


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
// 이동 입력 서버로 보내기
// ==============================

let lastSentX = 999;
let lastSentY = 999;


setInterval(() => {

  if (serverIsFull) return;


  let x = 0;
  let y = 0;


  if (
    keys.has('a') ||
    keys.has('arrowleft')
  ) {

    x -= 1;

  }


  if (
    keys.has('d') ||
    keys.has('arrowright')
  ) {

    x += 1;

  }


  if (
    keys.has('w') ||
    keys.has('arrowup')
  ) {

    y -= 1;

  }


  if (
    keys.has('s') ||
    keys.has('arrowdown')
  ) {

    y += 1;

  }


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
// 맵 격자
// ==============================

function drawGrid(
  cameraX,
  cameraY
) {

  const spacing = 100;


  ctx.strokeStyle =
    'rgba(255,255,255,.055)';


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
// 화면 그리기
// ==============================

function render() {

  requestAnimationFrame(render);


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


  const cameraX =
    me
      ? Math.max(
          0,
          Math.min(
            world.width - innerWidth,
            me.x - innerWidth / 2
          )
        )
      : 0;


  const cameraY =
    me
      ? Math.max(
          0,
          Math.min(
            world.height - innerHeight,
            me.y - innerHeight / 2
          )
        )
      : 0;



  ctx.fillStyle =
    '#172033';


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


  // 맵 외곽선
  ctx.strokeStyle =
    'rgba(255,255,255,.35)';


  ctx.lineWidth = 4;


  ctx.strokeRect(
    -cameraX,
    -cameraY,
    world.width,
    world.height
  );



  // ==============================
  // 플레이어 그리기
  // ==============================

  for (const player of players) {

    const screenX =
      player.x - cameraX;


    const screenY =
      player.y - cameraY;


    const mine =
      player.id === myId;



    ctx.beginPath();


    ctx.arc(
      screenX,
      screenY,
      PLAYER_RADIUS_CLIENT,
      0,
      Math.PI * 2
    );


    ctx.fillStyle =
      mine
        ? '#57d2ff'
        : '#ffcf67';


    ctx.fill();


    ctx.lineWidth = 3;


    ctx.strokeStyle =
      mine
        ? '#e7fbff'
        : '#fff4cf';


    ctx.stroke();



    ctx.fillStyle =
      'rgba(255,255,255,.95)';


    ctx.font =
      '600 12px system-ui';


    ctx.textAlign =
      'center';


    ctx.fillText(
      mine
        ? 'YOU'
        : 'P-' +
          player.id.slice(0, 4),

      screenX,

      screenY - 32
    );

  }

}


// 플레이어 화면 크기
const PLAYER_RADIUS_CLIENT = 22;


render();


</script>


</body>

</html>

`);

});



// ==============================
// 서버 시작
// ==============================

server.listen(PORT, () => {

  console.log(
    'Open Move server running on port ' +
    PORT
  );

  console.log(
    'Maximum players: ' +
    MAX_PLAYERS
  );

});

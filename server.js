const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ======================================================
// 게임 설정
// ======================================================

const WORLD = {
  width: 5200,
  height: 3400
};

const PLAYER_RADIUS = 25;
const PLAYER_SPEED = 300;
const TICK_RATE = 30;
const MAX_PLAYERS = 20;

const AVATARS = [
  "knight",
  "archer",
  "mage",
  "rogue"
];

const players = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ======================================================
// 숲 생성
// ======================================================

function createRng(seed) {
  let s = seed >>> 0;

  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function generateForest() {
  const rand = createRng(92741);

  const forest = {
    trees: [],
    bushes: [],
    rocks: [],
    flowers: [],
    ponds: [],
    paths: []
  };

  forest.paths.push(
    { x: 200, y: 1550, w: 4800, h: 110 },
    { x: 2480, y: 200, w: 130, h: 3000 },
    { x: 700, y: 750, w: 2100, h: 90 },
    { x: 2550, y: 2450, w: 1700, h: 90 }
  );

  for (let i = 0; i < 190; i++) {
    forest.trees.push({
      x: 100 + rand() * (WORLD.width - 200),
      y: 100 + rand() * (WORLD.height - 200),
      size: 25 + rand() * 28
    });
  }

  for (let i = 0; i < 110; i++) {
    forest.bushes.push({
      x: 80 + rand() * (WORLD.width - 160),
      y: 80 + rand() * (WORLD.height - 160),
      size: 12 + rand() * 16
    });
  }

  for (let i = 0; i < 65; i++) {
    forest.rocks.push({
      x: 80 + rand() * (WORLD.width - 160),
      y: 80 + rand() * (WORLD.height - 160),
      size: 10 + rand() * 18
    });
  }

  for (let i = 0; i < 240; i++) {
    forest.flowers.push({
      x: rand() * WORLD.width,
      y: rand() * WORLD.height,
      color: [
        "#ffe082",
        "#ff9e9e",
        "#d6a7ff",
        "#9ee7ff",
        "#ffffff"
      ][Math.floor(rand() * 5)]
    });
  }

  for (let i = 0; i < 5; i++) {
    forest.ponds.push({
      x: 600 + rand() * 4000,
      y: 500 + rand() * 2300,
      rx: 70 + rand() * 90,
      ry: 50 + rand() * 60
    });
  }

  return forest;
}

const FOREST = generateForest();

// ======================================================
// 플레이어
// ======================================================

function makePlayer(id) {
  return {
    id,

    x:
      600 +
      Math.random() *
      (WORLD.width - 1200),

    y:
      600 +
      Math.random() *
      (WORLD.height - 1200),

    inputX: 0,
    inputY: 0,

    direction: "front",

    moving: false,

    avatar: "knight"
  };
}

function getDirection(x, y, previous) {
  if (
    Math.abs(x) < 0.05 &&
    Math.abs(y) < 0.05
  ) {
    return previous;
  }

  if (Math.abs(x) > Math.abs(y)) {
    return x > 0
      ? "right"
      : "left";
  }

  return y > 0
    ? "front"
    : "back";
}

// ======================================================
// 멀티 서버
// ======================================================

io.on("connection", (socket) => {

  if (players.size >= MAX_PLAYERS) {

    socket.emit("serverFull", {
      maxPlayers: MAX_PLAYERS
    });

    setTimeout(() => {
      socket.disconnect(true);
    }, 400);

    return;
  }

  const player =
    makePlayer(socket.id);

  players.set(
    socket.id,
    player
  );

  socket.emit("welcome", {
    id: socket.id,
    world: WORLD,
    maxPlayers: MAX_PLAYERS,
    forest: FOREST
  });

  io.emit("count", {
    current: players.size,
    max: MAX_PLAYERS
  });

  // 이동
  socket.on("input", (data = {}) => {

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

    player.moving =
      Math.abs(x) > 0.05 ||
      Math.abs(y) > 0.05;

    player.direction =
      getDirection(
        x,
        y,
        player.direction
      );
  });

  // 캐릭터 변경
  socket.on(
    "setAvatar",
    (data = {}) => {

      const player =
        players.get(socket.id);

      if (!player) return;

      const avatar =
        String(
          data.avatar || ""
        );

      if (
        !AVATARS.includes(
          avatar
        )
      ) {
        return;
      }

      player.avatar =
        avatar;
    }
  );

  socket.on(
    "disconnect",
    () => {

      players.delete(
        socket.id
      );

      io.emit(
        "count",
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
// 서버 이동 계산
// ======================================================

let previousTime =
  Date.now();

setInterval(() => {

  const currentTime =
    Date.now();

  const dt =
    Math.min(
      (currentTime -
        previousTime) /
        1000,

      0.1
    );

  previousTime =
    currentTime;

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
    "state",

    Array.from(
      players.values(),

      player => ({
        id:
          player.id,

        x:
          player.x,

        y:
          player.y,

        avatar:
          player.avatar,

        direction:
          player.direction,

        moving:
          player.moving
      })
    )
  );

}, 1000 / TICK_RATE);

// ======================================================
// 게임 화면
// ======================================================

app.get("/", (_req, res) => {

res.type("html").send(`

<!DOCTYPE html>

<html lang="ko">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="
width=device-width,
initial-scale=1,
maximum-scale=1,
user-scalable=no,
viewport-fit=cover
">

<title>Forest RPG</title>

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
    #1c3219;

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

  top: 12px;
  left: 12px;

  z-index: 20;

  color: white;

  background:
    rgba(
      10,
      18,
      10,
      .78
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
  font-weight: 800;
}

#characterPanel {

  position: fixed;

  right: 12px;
  top: 12px;

  width: 300px;

  max-width:
    calc(
      100vw -
      24px
    );

  z-index: 30;

  background:
    rgba(
      10,
      18,
      10,
      .82
    );

  color: white;

  border-radius:
    14px;

  padding:
    12px;

  border:
    1px solid
    rgba(
      255,
      255,
      255,
      .18
    );

  backdrop-filter:
    blur(8px);
}

#characterTitle {

  font-weight: 900;

  margin-bottom:
    9px;
}

#characterGrid {

  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 7px;
}

.characterButton {

  min-height:
    55px;

  border-radius:
    10px;

  border:
    2px solid
    rgba(
      255,
      255,
      255,
      .12
    );

  color: white;

  background:
    rgba(
      255,
      255,
      255,
      .07
    );

  font:
    inherit;

  text-align:
    left;

  padding:
    8px;

  cursor: pointer;
}

.characterButton.selected {

  border-color:
    #ffe082;

  background:
    rgba(
      255,
      224,
      130,
      .15
    );
}

.className {

  display: block;

  font-weight:
    900;
}

.classInfo {

  display: block;

  margin-top:
    2px;

  font-size:
    11px;

  opacity:
    .8;
}

#joystick {

  position: fixed;

  left: 22px;
  bottom: 22px;

  z-index: 30;

  width: 145px;
  height: 145px;

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

  width: 52px;
  height: 52px;

  left: 45px;
  top: 45px;

  border-radius:
    50%;

  background:
    rgba(
      255,
      255,
      255,
      .85
    );

  pointer-events:
    none;
}

@media (
  max-width: 720px
) {

  #characterPanel {

    top: auto;

    bottom: 12px;

    right: 10px;

    width: 220px;
  }

  .characterButton {

    min-height:
      48px;
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
캐릭터:
<span id="currentClass">
기사
</span>
</div>

</div>

<div id="characterPanel">

<div id="characterTitle">
캐릭터 선택
</div>

<div id="characterGrid">

<button
class="characterButton selected"
data-avatar="knight">

<span class="className">
⚔️ 기사
</span>

<span class="classInfo">
검 · 방패 · 중갑
</span>

</button>


<button
class="characterButton"
data-avatar="archer">

<span class="className">
🏹 궁수
</span>

<span class="classInfo">
활 · 화살통 · 망토
</span>

</button>


<button
class="characterButton"
data-avatar="mage">

<span class="className">
🔮 마법사
</span>

<span class="classInfo">
지팡이 · 마법 · 로브
</span>

</button>


<button
class="characterButton"
data-avatar="rogue">

<span class="className">
🗡️ 도적
</span>

<span class="classInfo">
쌍단검 · 붉은 스카프
</span>

</button>

</div>

</div>

<div id="joystick">
<div id="stick"></div>
</div>

<script
src="/socket.io/socket.io.js">
</script>

<script>

// ======================================================
// 기본
// ======================================================

const socket =
  io();

const canvas =
  document.getElementById(
    "game"
  );

const ctx =
  canvas.getContext(
    "2d"
  );

ctx.imageSmoothingEnabled =
  false;

const statusEl =
  document.getElementById(
    "status"
  );

const countEl =
  document.getElementById(
    "count"
  );

const maxCountEl =
  document.getElementById(
    "maxCount"
  );

const currentClassEl =
  document.getElementById(
    "currentClass"
  );

const joystick =
  document.getElementById(
    "joystick"
  );

const stick =
  document.getElementById(
    "stick"
  );

const characterButtons =
  Array.from(
    document.querySelectorAll(
      ".characterButton"
    )
  );

const classNames = {

  knight:
    "기사",

  archer:
    "궁수",

  mage:
    "마법사",

  rogue:
    "도적"
};

let myId =
  null;

let players =
  [];

let world = {
  width: 5200,
  height: 3400
};

let forest = {
  trees: [],
  bushes: [],
  rocks: [],
  flowers: [],
  ponds: [],
  paths: []
};

let serverFull =
  false;

let keys =
  new Set();

let joystickX =
  0;

let joystickY =
  0;

let joystickPointer =
  null;

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
    "px";

  canvas.style.height =
    innerHeight +
    "px";

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );

  ctx.imageSmoothingEnabled =
    false;
}

addEventListener(
  "resize",
  resize
);

resize();

// ======================================================
// 서버
// ======================================================

socket.on(
  "connect",
  () => {

    if (!serverFull) {

      statusEl.textContent =
        "숲 서버 접속됨";
    }
  }
);

socket.on(
  "welcome",
  data => {

    myId =
      data.id;

    world =
      data.world;

    forest =
      data.forest;

    maxCountEl.textContent =
      data.maxPlayers;

    selectAvatar(
      "knight"
    );
  }
);

socket.on(
  "state",
  data => {

    players =
      data;
  }
);

socket.on(
  "count",
  data => {

    countEl.textContent =
      data.current;

    maxCountEl.textContent =
      data.max;
  }
);

socket.on(
  "serverFull",
  data => {

    serverFull =
      true;

    statusEl.textContent =
      "서버가 가득 찼습니다";

    countEl.textContent =
      data.maxPlayers;

    maxCountEl.textContent =
      data.maxPlayers;

    joystick.style.display =
      "none";

    socket.io.opts.reconnection =
      false;
  }
);

socket.on(
  "disconnect",
  () => {

    if (!serverFull) {

      statusEl.textContent =
        "재접속 중...";
    }
  }
);

// ======================================================
// 캐릭터 선택
// ======================================================

function selectAvatar(
  avatar
) {

  characterButtons.forEach(
    button => {

      button.classList.toggle(
        "selected",

        button.dataset.avatar ===
        avatar
      );
    }
  );

  currentClassEl.textContent =
    classNames[avatar];

  socket.emit(
    "setAvatar",
    {
      avatar
    }
  );
}

characterButtons.forEach(
  button => {

    button.addEventListener(
      "click",
      () => {

        selectAvatar(
          button.dataset.avatar
        );
      }
    );
  }
);

// ======================================================
// 키보드
// ======================================================

addEventListener(
  "keydown",
  e => {

    const key =
      e.key.toLowerCase();

    if (
      [
        "w",
        "a",
        "s",
        "d",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright"
      ].includes(key)
    ) {

      keys.add(key);

      e.preventDefault();
    }
  }
);

addEventListener(
  "keyup",
  e => {

    keys.delete(
      e.key.toLowerCase()
    );
  }
);

// ======================================================
// 조이스틱
// ======================================================

function moveJoystick(
  x,
  y
) {

  const rect =
    joystick.getBoundingClientRect();

  const cx =
    rect.left +
    rect.width / 2;

  const cy =
    rect.top +
    rect.height / 2;

  let dx =
    x - cx;

  let dy =
    y - cy;

  const max =
    rect.width *
    0.34;

  const length =
    Math.hypot(
      dx,
      dy
    );

  if (length > max) {

    dx =
      dx /
      length *
      max;

    dy =
      dy /
      length *
      max;
  }

  joystickX =
    dx / max;

  joystickY =
    dy / max;

  stick.style.transform =
    "translate(" +
    dx +
    "px," +
    dy +
    "px)";
}

joystick.addEventListener(
  "pointerdown",
  e => {

    joystickPointer =
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
  "pointermove",
  e => {

    if (
      e.pointerId !==
      joystickPointer
    ) {
      return;
    }

    moveJoystick(
      e.clientX,
      e.clientY
    );
  }
);

function releaseJoystick(
  e
) {

  if (
    e.pointerId !==
    joystickPointer
  ) {
    return;
  }

  joystickPointer =
    null;

  joystickX =
    0;

  joystickY =
    0;

  stick.style.transform =
    "translate(0px,0px)";
}

joystick.addEventListener(
  "pointerup",
  releaseJoystick
);

joystick.addEventListener(
  "pointercancel",
  releaseJoystick
);

// ======================================================
// 입력 전송
// ======================================================

let previousInputX =
  999;

let previousInputY =
  999;

setInterval(() => {

  if (serverFull)
    return;

  let x = 0;
  let y = 0;

  if (
    keys.has("a") ||
    keys.has("arrowleft")
  ) {
    x -= 1;
  }

  if (
    keys.has("d") ||
    keys.has("arrowright")
  ) {
    x += 1;
  }

  if (
    keys.has("w") ||
    keys.has("arrowup")
  ) {
    y -= 1;
  }

  if (
    keys.has("s") ||
    keys.has("arrowdown")
  ) {
    y += 1;
  }

  if (
    Math.abs(
      joystickX
    ) > 0.08 ||

    Math.abs(
      joystickY
    ) > 0.08
  ) {

    x =
      joystickX;

    y =
      joystickY;
  }

  const length =
    Math.hypot(
      x,
      y
    );

  if (length > 1) {

    x /= length;
    y /= length;
  }

  if (
    Math.abs(
      x -
      previousInputX
    ) > 0.01 ||

    Math.abs(
      y -
      previousInputY
    ) > 0.01
  ) {

    socket.emit(
      "input",
      {
        x,
        y
      }
    );

    previousInputX =
      x;

    previousInputY =
      y;
  }

}, 33);

// ======================================================
// 픽셀 그리기
// ======================================================

function px(
  x,
  y,
  w,
  h,
  color
) {

  ctx.fillStyle =
    color;

  ctx.fillRect(
    Math.round(x),
    Math.round(y),
    Math.round(w),
    Math.round(h)
  );
}

function ellipse(
  x,
  y,
  rx,
  ry,
  color
) {

  ctx.beginPath();

  ctx.ellipse(
    x,
    y,
    rx,
    ry,
    0,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    color;

  ctx.fill();
}

// ======================================================
// 걷기 애니메이션
// ======================================================

function getWalkFrame(
  player
) {

  if (!player.moving)
    return 1;

  return (
    Math.floor(
      performance.now() /
      130
    ) % 3
  );
}

function getWalkOffsets(
  frame
) {

  if (frame === 0) {

    return {
      leftLeg: -3,
      rightLeg: 3,
      leftArm: 3,
      rightArm: -3,
      bob: 1
    };
  }

  if (frame === 2) {

    return {
      leftLeg: 3,
      rightLeg: -3,
      leftArm: -3,
      rightArm: 3,
      bob: 1
    };
  }

  return {
    leftLeg: 0,
    rightLeg: 0,
    leftArm: 0,
    rightArm: 0,
    bob: 0
  };
}

// ======================================================
// 그림자
// ======================================================

function drawShadow() {

  ellipse(
    0,
    24,
    18,
    7,
    "rgba(0,0,0,.28)"
  );
}

// ======================================================
// 기사
// ======================================================

function drawKnight(
  direction,
  frame
) {

  const walk =
    getWalkOffsets(
      frame
    );

  drawShadow();

  ctx.save();

  ctx.translate(
    0,
    -walk.bob
  );

  // 뒤
  if (
    direction ===
    "back"
  ) {

    // 다리
    px(
      -9 +
      walk.leftLeg,
      12,
      7,
      14,
      "#343c47"
    );

    px(
      2 +
      walk.rightLeg,
      12,
      7,
      14,
      "#343c47"
    );

    // 망토
    px(
      -13,
      -9,
      26,
      24,
      "#25548b"
    );

    px(
      -10,
      11,
      20,
      8,
      "#173b69"
    );

    // 금색 장식
    px(
      -10,
      -7,
      20,
      3,
      "#d5a74f"
    );

    // 갑옷 어깨
    px(
      -16,
      -8,
      7,
      8,
      "#c8d1dc"
    );

    px(
      9,
      -8,
      7,
      8,
      "#c8d1dc"
    );

    // 머리
    ellipse(
      0,
      -20,
      11,
      11,
      "#d6af90"
    );

    // 머리카락
    ellipse(
      0,
      -25,
      11,
      8,
      "#252833"
    );

    px(
      -10,
      -24,
      20,
      8,
      "#252833"
    );

    // 검
    px(
      14,
      -4,
      4,
      24,
      "#adb9c6"
    );

    px(
      12,
      -3,
      8,
      4,
      "#d5a74f"
    );

    return ctx.restore();
  }

  // 옆
  if (
    direction ===
      "left" ||
    direction ===
      "right"
  ) {

    const flip =
      direction ===
      "left"
        ? -1
        : 1;

    ctx.scale(
      flip,
      1
    );

    px(
      -7 +
      walk.leftLeg,
      11,
      7,
      15,
      "#343c47"
    );

    px(
      2 +
      walk.rightLeg,
      13,
      7,
      13,
      "#343c47"
    );

    px(
      -10,
      -9,
      20,
      24,
      "#416fa8"
    );

    px(
      -9,
      -7,
      18,
      5,
      "#bfcbd8"
    );

    px(
      -7,
      0,
      14,
      4,
      "#d5a74f"
    );

    ellipse(
      2,
      -20,
      10,
      11,
      "#d6af90"
    );

    ellipse(
      0,
      -25,
      10,
      7,
      "#252833"
    );

    px(
      -8,
      -24,
      16,
      7,
      "#252833"
    );

    // 눈
    px(
      7,
      -21,
      2,
      2,
      "#315d8d"
    );

    // 방패
    px(
      -17,
      -5 +
      walk.leftArm,
      10,
      18,
      "#2e619a"
    );

    px(
      -15,
      -3 +
      walk.leftArm,
      6,
      14,
      "#d0a754"
    );

    // 검
    px(
      10,
      -4 +
      walk.rightArm,
      4,
      20,
      "#cfd7df"
    );

    px(
      8,
      -4 +
      walk.rightArm,
      8,
      4,
      "#d0a754"
    );

    return ctx.restore();
  }

  // 앞

  px(
    -9 +
    walk.leftLeg,
    11,
    7,
    15,
    "#343c47"
  );

  px(
    2 +
    walk.rightLeg,
    11,
    7,
    15,
    "#343c47"
  );

  // 몸통
  px(
    -12,
    -9,
    24,
    23,
    "#4979ad"
  );

  px(
    -9,
    -7,
    18,
    5,
    "#c9d2dd"
  );

  px(
    -2,
    -5,
    4,
    18,
    "#d0a754"
  );

  // 어깨갑옷
  px(
    -17,
    -7 +
    walk.leftArm,
    7,
    8,
    "#c7d1dd"
  );

  px(
    10,
    -7 +
    walk.rightArm,
    7,
    8,
    "#c7d1dd"
  );

  // 얼굴
  ellipse(
    0,
    -20,
    11,
    11,
    "#dfb494"
  );

  // 머리
  ellipse(
    0,
    -26,
    10,
    7,
    "#252833"
  );

  px(
    -10,
    -25,
    20,
    8,
    "#252833"
  );

  px(
    -7,
    -22,
    4,
    5,
    "#252833"
  );

  px(
    4,
    -22,
    5,
    5,
    "#252833"
  );

  // 눈
  px(
    -5,
    -20,
    2,
    2,
    "#448ad2"
  );

  px(
    3,
    -20,
    2,
    2,
    "#448ad2"
  );

  // 방패
  px(
    -21,
    -4 +
    walk.leftArm,
    10,
    19,
    "#315f99"
  );

  px(
    -18,
    -1 +
    walk.leftArm,
    4,
    13,
    "#d2ac55"
  );

  // 검
  px(
    15,
    -5 +
    walk.rightArm,
    4,
    22,
    "#d7dde4"
  );

  px(
    12,
    -4 +
    walk.rightArm,
    10,
    4,
    "#d2ac55"
  );

  ctx.restore();
}

// ======================================================
// 궁수
// ======================================================

function drawArcher(
  direction,
  frame
) {

  const walk =
    getWalkOffsets(
      frame
    );

  drawShadow();

  ctx.save();

  ctx.translate(
    0,
    -walk.bob
  );

  if (
    direction ===
    "back"
  ) {

    px(
      -9 +
      walk.leftLeg,
      11,
      7,
      15,
      "#4b3826"
    );

    px(
      2 +
      walk.rightLeg,
      11,
      7,
      15,
      "#4b3826"
    );

    // 망토
    px(
      -12,
      -9,
      24,
      25,
      "#355f38"
    );

    px(
      -9,
      11,
      18,
      7,
      "#29492d"
    );

    // 화살통
    px(
      -15,
      -9,
      6,
      25,
      "#765331"
    );

    px(
      -16,
      -14,
      2,
      12,
      "#d9c38a"
    );

    px(
      -12,
      -14,
      2,
      12,
      "#d9c38a"
    );

    // 머리
    ellipse(
      0,
      -20,
      11,
      11,
      "#e0b792"
    );

    ellipse(
      0,
      -25,
      11,
      8,
      "#9b704d"
    );

    // 포니테일
    px(
      7,
      -21,
      7,
      17,
      "#9b704d"
    );

    return ctx.restore();
  }

  if (
    direction ===
      "left" ||
    direction ===
      "right"
  ) {

    const flip =
      direction ===
      "left"
        ? -1
        : 1;

    ctx.scale(
      flip,
      1
    );

    px(
      -7 +
      walk.leftLeg,
      11,
      7,
      15,
      "#4b3826"
    );

    px(
      2 +
      walk.rightLeg,
      13,
      7,
      13,
      "#4b3826"
    );

    px(
      -10,
      -9,
      20,
      23,
      "#447447"
    );

    px(
      -8,
      -5,
      16,
      4,
      "#91703f"
    );

    ellipse(
      2,
      -20,
      10,
      11,
      "#e1b791"
    );

    ellipse(
      0,
      -25,
      10,
      7,
      "#a37752"
    );

    px(
      -7,
      -24,
      16,
      7,
      "#a37752"
    );

    px(
      7,
      -20,
      2,
      2,
      "#467b4d"
    );

    // 포니테일
    px(
      -10,
      -19,
      7,
      16,
      "#a37752"
    );

    // 활
    ctx.strokeStyle =
      "#8f6137";

    ctx.lineWidth =
      3;

    ctx.beginPath();

    ctx.arc(
      14,
      1,
      14,
      -1.25,
      1.25
    );

    ctx.stroke();

    ctx.strokeStyle =
      "#d6c39d";

    ctx.lineWidth =
      1;

    ctx.beginPath();

    ctx.moveTo(
      18,
      -12
    );

    ctx.lineTo(
      18,
      14
    );

    ctx.stroke();

    return ctx.restore();
  }

  px(
    -9 +
    walk.leftLeg,
    11,
    7,
    15,
    "#4b3826"
  );

  px(
    2 +
    walk.rightLeg,
    11,
    7,
    15,
    "#4b3826"
  );

  px(
    -12,
    -9,
    24,
    23,
    "#47784a"
  );

  px(
    -10,
    -5,
    20,
    4,
    "#977345"
  );

  px(
    -17,
    -5 +
    walk.leftArm,
    7,
    17,
    "#355e39"
  );

  px(
    10,
    -5 +
    walk.rightArm,
    7,
    17,
    "#355e39"
  );

  ellipse(
    0,
    -20,
    11,
    11,
    "#e4b995"
  );

  ellipse(
    0,
    -26,
    10,
    7,
    "#a57750"
  );

  px(
    -10,
    -25,
    20,
    7,
    "#a57750"
  );

  px(
    7,
    -22,
    7,
    16,
    "#a57750"
  );

  px(
    -5,
    -20,
    2,
    2,
    "#4f8b54"
  );

  px(
    3,
    -20,
    2,
    2,
    "#4f8b54"
  );

  // 활
  ctx.strokeStyle =
    "#8d6037";

  ctx.lineWidth =
    3;

  ctx.beginPath();

  ctx.arc(
    18,
    0,
    13,
    -1.25,
    1.25
  );

  ctx.stroke();

  ctx.strokeStyle =
    "#dacaa9";

  ctx.lineWidth =
    1;

  ctx.beginPath();

  ctx.moveTo(
    22,
    -12
  );

  ctx.lineTo(
    22,
    12
  );

  ctx.stroke();

  ctx.restore();
}

// ======================================================
// 마법사
// ======================================================

function drawMage(
  direction,
  frame
) {

  const walk =
    getWalkOffsets(
      frame
    );

  drawShadow();

  ctx.save();

  ctx.translate(
    0,
    -walk.bob
  );

  if (
    direction ===
    "back"
  ) {

    px(
      -8 +
      walk.leftLeg,
      11,
      7,
      15,
      "#402767"
    );

    px(
      1 +
      walk.rightLeg,
      11,
      7,
      15,
      "#402767"
    );

    // 로브
    px(
      -13,
      -9,
      26,
      26,
      "#56368c"
    );

    px(
      -10,
      10,
      20,
      9,
      "#43266d"
    );

    px(
      -10,
      7,
      20,
      2,
      "#d6a64f"
    );

    // 머리카락
    ellipse(
      0,
      -19,
      11,
      12,
      "#60458d"
    );

    px(
      -9,
      -19,
      18,
      15,
      "#60458d"
    );

    // 모자
    px(
      -14,
      -30,
      28,
      5,
      "#42266f"
    );

    px(
      -7,
      -41,
      14,
      14,
      "#56318c"
    );

    px(
      -5,
      -45,
      9,
      8,
      "#56318c"
    );

    px(
      -13,
      -29,
      26,
      2,
      "#d6a64f"
    );

    // 지팡이
    px(
      15,
      -10,
      4,
      31,
      "#745231"
    );

    ellipse(
      17,
      -15,
      6,
      6,
      "#9d5cff"
    );

    ellipse(
      17,
      -15,
      3,
      3,
      "#e4c5ff"
    );

    return ctx.restore();
  }

  if (
    direction ===
      "left" ||
    direction ===
      "right"
  ) {

    const flip =
      direction ===
      "left"
        ? -1
        : 1;

    ctx.scale(
      flip,
      1
    );

    px(
      -7 +
      walk.leftLeg,
      11,
      7,
      15,
      "#402767"
    );

    px(
      2 +
      walk.rightLeg,
      13,
      7,
      13,
      "#402767"
    );

    px(
      -10,
      -9,
      20,
      25,
      "#62419b"
    );

    px(
      -8,
      8,
      16,
      2,
      "#d6a64f"
    );

    ellipse(
      2,
      -20,
      10,
      11,
      "#e3b99b"
    );

    px(
      -7,
      -23,
      14,
      11,
      "#60458d"
    );

    px(
      -14,
      -30,
      28,
      4,
      "#42266f"
    );

    px(
      -5,
      -41,
      12,
      13,
      "#56318c"
    );

    px(
      -12,
      -29,
      24,
      2,
      "#d6a64f"
    );

    px(
      7,
      -21,
      2,
      2,
      "#6645a2"
    );

    // 지팡이
    px(
      15,
      -8,
      4,
      29,
      "#745231"
    );

    ellipse(
      17,
      -13,
      6,
      6,
      "#9d5cff"
    );

    ellipse(
      17,
      -13,
      3,
      3,
      "#ead6ff"
    );

    return ctx.restore();
  }

  px(
    -8 +
    walk.leftLeg,
    11,
    7,
    15,
    "#402767"
  );

  px(
    1 +
    walk.rightLeg,
    11,
    7,
    15,
    "#402767"
  );

  px(
    -13,
    -9,
    26,
    26,
    "#63429b"
  );

  px(
    -10,
    7,
    20,
    3,
    "#d6a64f"
  );

  px(
    -17,
    -5 +
    walk.leftArm,
    7,
    16,
    "#50327f"
  );

  px(
    10,
    -5 +
    walk.rightArm,
    7,
    16,
    "#50327f"
  );

  ellipse(
    0,
    -20,
    11,
    11,
    "#e5bb9b"
  );

  px(
    -9,
    -22,
    18,
    10,
    "#60458d"
  );

  px(
    -5,
    -20,
    2,
    2,
    "#865ee2"
  );

  px(
    3,
    -20,
    2,
    2,
    "#865ee2"
  );

  // 마법모자
  px(
    -14,
    -30,
    28,
    5,
    "#44286f"
  );

  px(
    -7,
    -41,
    14,
    13,
    "#59338f"
  );

  px(
    -5,
    -45,
    9,
    8,
    "#59338f"
  );

  px(
    -13,
    -29,
    26,
    2,
    "#d6a64f"
  );

  // 지팡이
  px(
    16,
    -8 +
    walk.rightArm,
    4,
    29,
    "#745231"
  );

  ellipse(
    18,
    -13 +
    walk.rightArm,
    6,
    6,
    "#9f60ff"
  );

  ellipse(
    18,
    -13 +
    walk.rightArm,
    3,
    3,
    "#f2e6ff"
  );

  ctx.restore();
}

// ======================================================
// 도적
// ======================================================

function drawRogue(
  direction,
  frame
) {

  const walk =
    getWalkOffsets(
      frame
    );

  drawShadow();

  ctx.save();

  ctx.translate(
    0,
    -walk.bob
  );

  if (
    direction ===
    "back"
  ) {

    px(
      -9 +
      walk.leftLeg,
      11,
      7,
      15,
      "#272a30"
    );

    px(
      2 +
      walk.rightLeg,
      11,
      7,
      15,
      "#272a30"
    );

    // 갑옷
    px(
      -12,
      -9,
      24,
      24,
      "#353a43"
    );

    // 붉은 망토
    px(
      -11,
      -8,
      22,
      8,
      "#8f2929"
    );

    px(
      -8,
      -1,
      16,
      15,
      "#691f24"
    );

    ellipse(
      0,
      -20,
      11,
      11,
      "#d8ad8e"
    );

    ellipse(
      0,
      -26,
      11,
      8,
      "#252631"
    );

    px(
      -10,
      -25,
      20,
      8,
      "#252631"
    );

    // 단검 2개
    px(
      -17,
      -1,
      4,
      20,
      "#abb7c3"
    );

    px(
      13,
      -1,
      4,
      20,
      "#abb7c3"
    );

    return ctx.restore();
  }

  if (
    direction ===
      "left" ||
    direction ===
      "right"
  ) {

    const flip =
      direction ===
      "left"
        ? -1
        : 1;

    ctx.scale(
      flip,
      1
    );

    px(
      -7 +
      walk.leftLeg,
      11,
      7,
      15,
      "#272a30"
    );

    px(
      2 +
      walk.rightLeg,
      13,
      7,
      13,
      "#272a30"
    );

    px(
      -10,
      -9,
      20,
      23,
      "#393e47"
    );

    // 스카프
    px(
      -9,
      -10,
      18,
      5,
      "#9d3030"
    );

    px(
      -12,
      -7,
      8,
      13,
      "#7c2428"
    );

    ellipse(
      2,
      -20,
      10,
      11,
      "#dfb291"
    );

    ellipse(
      0,
      -26,
      10,
      7,
      "#252631"
    );

    px(
      -8,
      -24,
      17,
      7,
      "#252631"
    );

    px(
      7,
      -21,
      2,
      2,
      "#a43e3e"
    );

    // 단검
    px(
      11,
      -3 +
      walk.rightArm,
      14,
      3,
      "#d2dae2"
    );

    px(
      9,
      -5 +
      walk.rightArm,
      5,
      7,
      "#8a5838"
    );

    return ctx.restore();
  }

  px(
    -9 +
    walk.leftLeg,
    11,
    7,
    15,
    "#272a30"
  );

  px(
    2 +
    walk.rightLeg,
    11,
    7,
    15,
    "#272a30"
  );

  px(
    -12,
    -9,
    24,
    23,
    "#3a3f48"
  );

  // 가죽띠
  px(
    -9,
    2,
    18,
    4,
    "#68482f"
  );

  // 스카프
  px(
    -11,
    -11,
    22,
    6,
    "#a83232"
  );

  px(
    -13,
    -7,
    7,
    13,
    "#842729"
  );

  ellipse(
    0,
    -20,
    11,
    11,
    "#deb291"
  );

  ellipse(
    0,
    -26,
    11,
    8,
    "#252631"
  );

  px(
    -10,
    -25,
    20,
    8,
    "#252631"
  );

  px(
    -5,
    -20,
    2,
    2,
    "#b23a3a"
  );

  px(
    3,
    -20,
    2,
    2,
    "#b23a3a"
  );

  // 왼쪽 단검
  px(
    -24,
    -3 +
    walk.leftArm,
    14,
    3,
    "#d0d8df"
  );

  px(
    -13,
    -5 +
    walk.leftArm,
    5,
    7,
    "#744932"
  );

  // 오른쪽 단검
  px(
    10,
    -3 +
    walk.rightArm,
    14,
    3,
    "#d0d8df"
  );

  px(
    8,
    -5 +
    walk.rightArm,
    5,
    7,
    "#744932"
  );

  ctx.restore();
}

// ======================================================
// 캐릭터 렌더
// ======================================================

function drawCharacter(
  player,
  screenX,
  screenY,
  isMe
) {

  const frame =
    getWalkFrame(
      player
    );

  ctx.save();

  ctx.translate(
    Math.round(
      screenX
    ),

    Math.round(
      screenY
    )
  );

  const scale =
    1.35;

  ctx.scale(
    scale,
    scale
  );

  switch (
    player.avatar
  ) {

    case "archer":

      drawArcher(
        player.direction,
        frame
      );

      break;

    case "mage":

      drawMage(
        player.direction,
        frame
      );

      break;

    case "rogue":

      drawRogue(
        player.direction,
        frame
      );

      break;

    default:

      drawKnight(
        player.direction,
        frame
      );
  }

  ctx.restore();

  // 이름
  ctx.font =
    "700 12px system-ui";

  ctx.textAlign =
    "center";

  ctx.fillStyle =
    "rgba(0,0,0,.55)";

  ctx.fillRect(
    screenX - 34,
    screenY - 58,
    68,
    18
  );

  ctx.fillStyle =
    isMe
      ? "#ffe082"
      : "#ffffff";

  ctx.fillText(
    isMe
      ? "YOU"
      : "P-" +
        player.id.slice(
          0,
          4
        ),

    screenX,

    screenY - 45
  );
}

// ======================================================
// 숲 렌더
// ======================================================

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

function drawForest(
  cameraX,
  cameraY
) {

  // 잔디
  ctx.fillStyle =
    "#396332";

  ctx.fillRect(
    0,
    0,
    innerWidth,
    innerHeight
  );

  // 길
  for (
    const path
    of forest.paths
  ) {

    ctx.fillStyle =
      "#92754d";

    ctx.fillRect(
      path.x -
      cameraX,

      path.y -
      cameraY,

      path.w,
      path.h
    );
  }

  // 꽃
  for (
    const flower
    of forest.flowers
  ) {

    if (
      !visible(
        flower.x,
        flower.y,
        20,
        cameraX,
        cameraY
      )
    ) {
      continue;
    }

    ellipse(
      flower.x -
      cameraX,

      flower.y -
      cameraY,

      2.5,
      2.5,

      flower.color
    );
  }

  // 연못
  for (
    const pond
    of forest.ponds
  ) {

    if (
      !visible(
        pond.x,
        pond.y,
        180,
        cameraX,
        cameraY
      )
    ) {
      continue;
    }

    ellipse(
      pond.x -
      cameraX,

      pond.y -
      cameraY,

      pond.rx,
      pond.ry,

      "#418daf"
    );

    ellipse(
      pond.x -
      cameraX -
      12,

      pond.y -
      cameraY -
      10,

      pond.rx *
      .55,

      pond.ry *
      .35,

      "rgba(255,255,255,.13)"
    );
  }

  // 바위
  for (
    const rock
    of forest.rocks
  ) {

    if (
      !visible(
        rock.x,
        rock.y,
        60,
        cameraX,
        cameraY
      )
    ) {
      continue;
    }

    ellipse(
      rock.x -
      cameraX,

      rock.y -
      cameraY,

      rock.size,
      rock.size *
      .65,

      "#757b75"
    );

    ellipse(
      rock.x -
      cameraX -
      4,

      rock.y -
      cameraY -
      4,

      rock.size *
      .45,

      rock.size *
      .25,

      "#949a94"
    );
  }

  // 덤불
  for (
    const bush
    of forest.bushes
  ) {

    if (
      !visible(
        bush.x,
        bush.y,
        60,
        cameraX,
        cameraY
      )
    ) {
      continue;
    }

    ellipse(
      bush.x -
      cameraX -
      8,

      bush.y -
      cameraY,

      bush.size,
      bush.size *
      .75,

      "#267338"
    );

    ellipse(
      bush.x -
      cameraX +
      7,

      bush.y -
      cameraY -
      3,

      bush.size,
      bush.size *
      .8,

      "#308b44"
    );
  }

  // 나무
  for (
    const tree
    of forest.trees
  ) {

    if (
      !visible(
        tree.x,
        tree.y,
        90,
        cameraX,
        cameraY
      )
    ) {
      continue;
    }

    const x =
      tree.x -
      cameraX;

    const y =
      tree.y -
      cameraY;

    // 그림자
    ellipse(
      x,
      y + 28,
      tree.size *
      .75,
      tree.size *
      .28,
      "rgba(0,0,0,.22)"
    );

    // 줄기
    px(
      x -
      tree.size *
      .13,

      y,

      tree.size *
      .26,

      tree.size *
      .9,

      "#684525"
    );

    // 잎
    ellipse(
      x,
      y - 8,
      tree.size,
      tree.size *
      .85,
      "#24733a"
    );

    ellipse(
      x -
      tree.size *
      .55,

      y,
      tree.size *
      .60,
      tree.size *
      .55,
      "#2d8744"
    );

    ellipse(
      x +
      tree.size *
      .55,

      y,
      tree.size *
      .60,
      tree.size *
      .55,
      "#2d8744"
    );

    ellipse(
      x -
      tree.size *
      .25,

      y -
      tree.size *
      .32,

      tree.size *
      .35,
      tree.size *
      .28,
      "#4aa65b"
    );
  }
}

// ======================================================
// 메인 렌더
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
      player =>
        player.id ===
        myId
    );

  let cameraX = 0;
  let cameraY = 0;

  if (me) {

    cameraX =
      me.x -
      innerWidth /
      2;

    cameraY =
      me.y -
      innerHeight /
      2;

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

  drawForest(
    cameraX,
    cameraY
  );

  // 플레이어는 Y순서로 그림
  // 아래쪽 플레이어가 앞에 보임

  const sortedPlayers =
    [...players].sort(
      (a, b) =>
        a.y - b.y
    );

  for (
    const player
    of sortedPlayers
  ) {

    const screenX =
      player.x -
      cameraX;

    const screenY =
      player.y -
      cameraY;

    if (
      screenX < -100 ||
      screenX >
        innerWidth +
        100 ||

      screenY < -100 ||
      screenY >
        innerHeight +
        100
    ) {
      continue;
    }

    drawCharacter(
      player,
      screenX,
      screenY,
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

});

// ======================================================
// 서버 실행
// ======================================================

server.listen(
  PORT,
  () => {

    console.log(
      "Forest RPG server running"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "MAX PLAYERS:",
      MAX_PLAYERS
    );
  }
);

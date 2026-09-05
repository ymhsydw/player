const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ======================================================
// 기본 게임 설정
// ======================================================

const WORLD = {
  width: 5200,
  height: 3400
};

const MAX_PLAYERS = 20;
const PLAYER_SPEED = 300;
const PLAYER_RADIUS = 24;
const TICK_RATE = 30;

const AVATARS = [
  'mage',
  'pirate'
];

// ======================================================
// 슬라임
// ======================================================

const NORMAL_SLIMES = 28;
const ELITE_SLIMES = 4;

const SLIME_RESPAWN_MS = 5000;

// ======================================================
// 마법사 스킬
// ======================================================

const FIREBALL_SPEED = 900;
const FIREBALL_DAMAGE = 60;
const FIREBALL_RADIUS = 14;
const FIREBALL_LIFE = 1.35;
const FIREBALL_COOLDOWN = 900;

// ======================================================
// 해적 스킬
// ======================================================

const PIRATE_SHIP_SPEED = 720;

const PIRATE_SHIP_LIFE = 4;

const PIRATE_SHIP_HIT_RADIUS = 85;

const PIRATE_SHIP_COOLDOWN = 6000;

// ======================================================

const players = new Map();

const slimes = new Map();

const fireballs = new Map();

const pirateShips = new Map();

let nextSlimeId = 1;

let nextFireballId = 1;

let nextPirateShipId = 1;

// ======================================================
// 공통 함수
// ======================================================

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
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

function directionFromVector(
  x,
  y,
  previous = 'front'
) {

  if (
    Math.abs(x) < 0.001 &&
    Math.abs(y) < 0.001
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

// ======================================================
// 플레이어
// ======================================================

function makePlayer(id) {

  const point =
    randomPoint(450);

  return {

    id,

    x: point.x,
    y: point.y,

    inputX: 0,
    inputY: 0,

    aimX: 0,
    aimY: 1,

    direction: 'front',

    moving: false,

    avatar: 'mage',

    lastMageCastAt: 0,

    lastPirateCastAt: 0

  };
}

// ======================================================
// 슬라임
// ======================================================

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

  const point =
    randomPoint(180);

  const slime = {

    id:
      nextSlimeId++,

    x:
      point.x,

    y:
      point.y,

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

  const point =
    randomPoint(180);

  slime.x =
    point.x;

  slime.y =
    point.y;

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

function killSlime(
  slime,
  now
) {

  slime.hp = 0;

  slime.alive =
    false;

  slime.respawnAt =
    now +
    SLIME_RESPAWN_MS;
}

// ======================================================
// 마법사 파이어볼
// ======================================================

function castFireball(
  player,
  targetX,
  targetY
) {

  // 마법사만 사용
  if (
    player.avatar !==
    'mage'
  ) {

    return false;
  }

  const now =
    Date.now();

  if (
    now -
    player.lastMageCastAt <
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

  const length =
    Math.hypot(
      dx,
      dy
    );

  if (
    length < 1
  ) {

    return false;
  }

  dx /=
    length;

  dy /=
    length;

  player.lastMageCastAt =
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
// 해적선 돌격
// ======================================================

function castPirateShip(
  player,
  targetX,
  targetY
) {

  // 해적만 사용
  if (
    player.avatar !==
    'pirate'
  ) {

    return false;
  }

  const now =
    Date.now();

  if (
    now -
    player.lastPirateCastAt <
    PIRATE_SHIP_COOLDOWN
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

  const length =
    Math.hypot(
      dx,
      dy
    );

  if (
    length < 1
  ) {

    return false;
  }

  dx /=
    length;

  dy /=
    length;

  player.lastPirateCastAt =
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
    nextPirateShipId++;

  pirateShips.set(
    id,
    {

      id,

      ownerId:
        player.id,

      x:
        player.x +
        dx * 90,

      y:
        player.y +
        dy * 90,

      vx:
        dx *
        PIRATE_SHIP_SPEED,

      vy:
        dy *
        PIRATE_SHIP_SPEED,

      angle:
        Math.atan2(
          dy,
          dx
        ),

      life:
        PIRATE_SHIP_LIFE

    }
  );

  return true;
}

// ======================================================
// 현재 직업 스킬
// ======================================================

function castCurrentSkill(
  player,
  targetX,
  targetY
) {

  if (
    player.avatar ===
    'pirate'
  ) {

    return {

      success:
        castPirateShip(
          player,
          targetX,
          targetY
        ),

      skill:
        'pirateShip',

      cooldown:
        PIRATE_SHIP_COOLDOWN

    };
  }

  return {

    success:
      castFireball(
        player,
        targetX,
        targetY
      ),

    skill:
      'fireball',

    cooldown:
      FIREBALL_COOLDOWN

  };
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
          socket.disconnect(
            true
          ),
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
          FIREBALL_COOLDOWN,

        pirateCooldown:
          PIRATE_SHIP_COOLDOWN

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

    // ================================================
    // 이동
    // ================================================

    socket.on(
      'input',
      (data = {}) => {

        const player =
          players.get(
            socket.id
          );

        if (
          !player
        ) {

          return;
        }

        let x =
          Number(data.x) ||
          0;

        let y =
          Number(data.y) ||
          0;

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
          Math.abs(x) >
            0.05 ||
          Math.abs(y) >
            0.05;

      }
    );

    // ================================================
    // 시선
    // ================================================

    socket.on(
      'aim',
      (data = {}) => {

        const player =
          players.get(
            socket.id
          );

        if (
          !player
        ) {

          return;
        }

        let x =
          Number(data.x) ||
          0;

        let y =
          Number(data.y) ||
          0;

        const length =
          Math.hypot(
            x,
            y
          );

        if (
          length <
          0.001
        ) {

          return;
        }

        x /=
          length;

        y /=
          length;

        player.aimX =
          x;

        player.aimY =
          y;

        player.direction =
          directionFromVector(
            x,
            y,
            player.direction
          );

      }
    );

    // ================================================
    // 캐릭터 변경
    // ================================================

    socket.on(
      'setAvatar',
      (data = {}) => {

        const player =
          players.get(
            socket.id
          );

        if (
          !player
        ) {

          return;
        }

        const avatar =
          String(
            data.avatar ||
            ''
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

    // ================================================
    // E 스킬
    // ================================================

    socket.on(
      'castSkill',
      (data = {}) => {

        const player =
          players.get(
            socket.id
          );

        if (
          !player
        ) {

          return;
        }

        const result =
          castCurrentSkill(
            player,
            data.targetX,
            data.targetY
          );

        socket.emit(
          'skillCastResult',
          result
        );

      }
    );

    // ================================================
    // 종료
    // ================================================

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

    // ==================================================
    // 플레이어
    // ==================================================

    for (
      const player
      of players.values()
    ) {

      player.x =
        clamp(
          player.x +
          player.inputX *
          PLAYER_SPEED *
          dt,

          PLAYER_RADIUS,

          WORLD.width -
          PLAYER_RADIUS
        );

      player.y =
        clamp(
          player.y +
          player.inputY *
          PLAYER_SPEED *
          dt,

          PLAYER_RADIUS,

          WORLD.height -
          PLAYER_RADIUS
        );

    }

    // ==================================================
    // 슬라임
    // ==================================================

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

    // ==================================================
    // 파이어볼
    // ==================================================

    for (
      const fireball
      of [
        ...fireballs.values()
      ]
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
          WORLD.width +
          50 ||

        fireball.y < -50 ||

        fireball.y >
          WORLD.height +
          50
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

            killSlime(
              slime,
              now
            );
          }

          break;
        }
      }

    }

    // ==================================================
    // 해적선
    // ==================================================

    for (
      const ship
      of [
        ...pirateShips.values()
      ]
    ) {

      ship.x +=
        ship.vx *
        dt;

      ship.y +=
        ship.vy *
        dt;

      ship.life -=
        dt;

      if (
        ship.life <= 0 ||

        ship.x < -250 ||

        ship.x >
          WORLD.width +
          250 ||

        ship.y < -250 ||

        ship.y >
          WORLD.height +
          250
      ) {

        pirateShips.delete(
          ship.id
        );

        continue;
      }

      /*
        해적선의 이동 경로에 있는
        모든 슬라임을 즉시 처치.

        일반 슬라임 / 엘리트 슬라임
        둘 다 적용.
      */

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
          ship.x;

        const dy =
          slime.y -
          ship.y;

        const hitDistance =
          PIRATE_SHIP_HIT_RADIUS +
          slime.radius;

        if (
          dx * dx +
          dy * dy <=
          hitDistance *
          hitDistance
        ) {

          killSlime(
            slime,
            now
          );
        }
      }

    }

    // ==================================================
    // 상태 전송
    // ==================================================

    io.emit(
      'state',
      {

        players:
          [
            ...players.values()
          ].map(
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
                player.moving,

              avatar:
                player.avatar

            })
          ),

        slimes:
          [
            ...slimes.values()
          ].map(
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
          [
            ...fireballs.values()
          ].map(
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
          ),

        pirateShips:
          [
            ...pirateShips.values()
          ].map(
            ship => ({

              id:
                ship.id,

              x:
                ship.x,

              y:
                ship.y,

              angle:
                ship.angle

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

app.get(
  '/pirate.png',
  (_req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'pirate.png'
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
Forest RPG
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

#skillName,
#skillState {

  color:
    #ffe082;

  font-weight:
    800;
}

#avatarPanel {

  position:
    fixed;

  right:
    12px;

  top:
    12px;

  z-index:
    25;

  width:
    210px;

  color:
    white;

  background:
    rgba(
      9,
      14,
      9,
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
    10px;

  backdrop-filter:
    blur(6px);
}

#avatarTitle {

  font-weight:
    900;

  margin-bottom:
    8px;
}

#avatarGrid {

  display:
    grid;

  gap:
    8px;
}

.avatarBtn {

  border:
    2px solid
    rgba(
      255,
      255,
      255,
      .14
    );

  border-radius:
    10px;

  background:
    rgba(
      255,
      255,
      255,
      .06
    );

  color:
    white;

  padding:
    10px 11px;

  font:
    inherit;

  text-align:
    left;

  cursor:
    pointer;
}

.avatarBtn.selected {

  border-color:
    #ffe082;

  background:
    rgba(
      255,
      224,
      130,
      .16
    );
}

.avatarBtn b {

  display:
    block;

  margin-bottom:
    2px;
}

.avatarBtn span {

  font-size:
    12px;

  opacity:
    .85;
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
    106px;

  height:
    106px;

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
      .86
    );

  color:
    white;

  font:
    900 15px
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
    150px;

  z-index:
    20;

  color:
    white;

  background:
    rgba(
      0,
      0,
      0,
      .4
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
  max-width: 700px
) {

  #avatarPanel {

    width:
      175px;
  }
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
캐릭터:
<span id="currentAvatarName">
마법사
</span>
</div>

<div>
E 스킬:
<span id="skillName">
파이어볼
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

<div id="avatarPanel">

<div id="avatarTitle">
캐릭터 선택
</div>

<div id="avatarGrid">

<button
class="avatarBtn selected"
data-avatar="mage"
type="button">

<b>
🔮 마법사
</b>

<span>
E · 파이어볼
</span>

</button>

<button
class="avatarBtn"
data-avatar="pirate"
type="button">

<b>
🏴‍☠️ 해적
</b>

<span>
E · 해적선 돌격
</span>

</button>

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

E로 스킬 선택
→ 맵 클릭
→ 지정 방향으로 사용

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

const currentAvatarNameEl =
  document.getElementById(
    'currentAvatarName'
  );

const skillNameEl =
  document.getElementById(
    'skillName'
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

const avatarButtons =
  [
    ...document.querySelectorAll(
      '.avatarBtn'
    )
  ];

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

let pirateShips =
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

let selectedAvatar =
  'mage';

let skillSelected =
  false;

let waitingForCast =
  false;

let mageCooldown =
  900;

let pirateCooldown =
  6000;

let localCooldownUntil = {
  mage: 0,
  pirate: 0
};

const cClamp =
  (
    value,
    min,
    max
  ) =>
    Math.max(
      min,
      Math.min(
        max,
        value
      )
    );

// ======================================================
// 캐릭터 정보
// ======================================================

const CHARACTER_INFO = {

  mage: {

    name:
      '마법사',

    skill:
      '파이어볼',

    button:
      'E<br>파이어볼',

    selected:
      '선택됨<br>클릭 발사'

  },

  pirate: {

    name:
      '해적',

    skill:
      '해적선 돌격',

    button:
      'E<br>해적선',

    selected:
      '선택됨<br>진로 지정'

  }

};

// ======================================================
// 이미지
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

mageImage.src =
  '/mage.png';


const pirateImage =
  new Image();

let pirateReady =
  false;

pirateImage.onload =
  () => {

    pirateReady =
      true;
  };

pirateImage.onerror =
  () => {

    statusEl.textContent =
      'pirate.png 파일을 확인하세요';
  };

pirateImage.src =
  '/pirate.png';

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
// 서버
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
  data => {

    myId =
      data.id;

    world =
      data.world;

    mageCooldown =
      data.fireballCooldown;

    pirateCooldown =
      data.pirateCooldown;

    maxCountEl.textContent =
      data.maxPlayers;

    setAvatar(
      'mage'
    );
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

    pirateShips =
      data.pirateShips ||
      [];
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

socket.on(
  'skillCastResult',
  data => {

    waitingForCast =
      false;

    if (
      !data.success
    ) {

      skillStateEl.textContent =
        '쿨타임';

      return;
    }

    const avatar =
      data.skill ===
        'pirateShip'
        ? 'pirate'
        : 'mage';

    localCooldownUntil[
      avatar
    ] =
      performance.now() +
      data.cooldown;

    setSkillSelected(
      false
    );

    updateSkillUI();

  }
);

// ======================================================
// 내 플레이어
// ======================================================

function getMe() {

  return (
    players.find(
      player =>
        player.id ===
        myId
    ) ||
    null
  );
}

// ======================================================
// 캐릭터 선택
// ======================================================

function setAvatar(
  avatar
) {

  selectedAvatar =
    avatar;

  socket.emit(
    'setAvatar',
    {
      avatar
    }
  );

  setSkillSelected(
    false
  );

  avatarButtons.forEach(
    button => {

      button.classList.toggle(
        'selected',
        button.dataset.avatar ===
        avatar
      );

    }
  );

  updateSkillUI();
}

avatarButtons.forEach(
  button => {

    button.addEventListener(
      'click',
      event => {

        event.preventDefault();

        event.stopPropagation();

        setAvatar(
          button.dataset.avatar
        );

      }
    );

  }
);

// ======================================================
// 스킬 UI
// ======================================================

function currentCooldown() {

  return selectedAvatar ===
    'pirate'
      ? pirateCooldown
      : mageCooldown;
}

function isCurrentSkillCooling() {

  return (
    performance.now() <
    localCooldownUntil[
      selectedAvatar
    ]
  );
}

function updateSkillUI() {

  const info =
    CHARACTER_INFO[
      selectedAvatar
    ];

  currentAvatarNameEl.textContent =
    info.name;

  skillNameEl.textContent =
    info.skill;

  if (
    isCurrentSkillCooling()
  ) {

    const remain =
      Math.max(
        0,
        localCooldownUntil[
          selectedAvatar
        ] -
        performance.now()
      );

    skillE.classList.add(
      'cooling'
    );

    skillE.classList.remove(
      'selected'
    );

    skillE.innerHTML =
      (
        remain /
        1000
      ).toFixed(1) +
      '초';

    skillStateEl.textContent =
      '쿨타임';

    return;
  }

  skillE.classList.remove(
    'cooling'
  );

  skillE.classList.toggle(
    'selected',
    skillSelected
  );

  skillE.innerHTML =
    skillSelected
      ? info.selected
      : info.button;

  skillStateEl.textContent =
    skillSelected
      ? (
          selectedAvatar ===
          'mage'
            ? '파이어볼 선택 · 목표 위치 클릭'
            : '해적선 경로 선택 · 목표 방향 클릭'
        )
      : '대기';
}

setInterval(
  updateSkillUI,
  100
);

// ======================================================
// E 스킬 선택
// ======================================================

function setSkillSelected(
  selected
) {

  if (
    serverFull
  ) {

    return;
  }

  if (
    selected &&
    isCurrentSkillCooling()
  ) {

    skillStateEl.textContent =
      '쿨타임';

    return;
  }

  skillSelected =
    selected;

  document.body.classList.toggle(
    'skill-selected',
    selected
  );

  updateSkillUI();
}

function selectCurrentSkill() {

  if (
    waitingForCast ||
    serverFull
  ) {

    return;
  }

  setSkillSelected(
    true
  );
}

// ======================================================
// 키보드
// ======================================================

addEventListener(
  'keydown',
  event => {

    const key =
      event.key.toLowerCase();

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

      event.preventDefault();
    }

    if (
      key === 'e'
    ) {

      selectCurrentSkill();

      event.preventDefault();
    }

    if (
      key ===
      'escape'
    ) {

      setSkillSelected(
        false
      );
    }
  }
);

addEventListener(
  'keyup',
  event => {

    keys.delete(
      event.key.toLowerCase()
    );
  }
);

// ======================================================
// 마우스 시선
// ======================================================

canvas.addEventListener(
  'pointermove',
  event => {

    if (
      event.pointerType !==
        'mouse' &&
      event.pointerType !==
        'pen'
    ) {

      return;
    }

    mouseX =
      event.clientX;

    mouseY =
      event.clientY;

    mouseAimActive =
      true;
  }
);

// ======================================================
// 조이스틱
// ======================================================

function moveJoystick(
  clientX,
  clientY
) {

  const rect =
    joystick.getBoundingClientRect();

  const centerX =
    rect.left +
    rect.width /
    2;

  const centerY =
    rect.top +
    rect.height /
    2;

  const max =
    rect.width *
    0.34;

  let dx =
    clientX -
    centerX;

  let dy =
    clientY -
    centerY;

  const length =
    Math.hypot(
      dx,
      dy
    );

  if (
    length >
    max
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
  event => {

    joyPointer =
      event.pointerId;

    joystick.setPointerCapture(
      event.pointerId
    );

    moveJoystick(
      event.clientX,
      event.clientY
    );
  }
);

joystick.addEventListener(
  'pointermove',
  event => {

    if (
      event.pointerId ===
      joyPointer
    ) {

      moveJoystick(
        event.clientX,
        event.clientY
      );
    }
  }
);

function releaseJoystick(
  event
) {

  if (
    event.pointerId !==
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
  releaseJoystick
);

joystick.addEventListener(
  'pointercancel',
  releaseJoystick
);

skillE.addEventListener(
  'pointerdown',
  event => {

    event.preventDefault();

    event.stopPropagation();

    selectCurrentSkill();

  }
);

// ======================================================
// 조준
// ======================================================

function aimToScreen(
  screenX,
  screenY
) {

  const me =
    getMe();

  if (
    !me
  ) {

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

  const length =
    Math.hypot(
      x,
      y
    );

  if (
    length <
    0.001
  ) {

    return null;
  }

  return {

    x:
      x /
      length,

    y:
      y /
      length

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

  const aim =
    aimToScreen(
      mouseX,
      mouseY
    );

  if (
    !aim
  ) {

    return;
  }

  if (
    force ||

    Math.abs(
      aim.x -
      lastAimX
    ) >
      0.01 ||

    Math.abs(
      aim.y -
      lastAimY
    ) >
      0.01
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
// 선택한 스킬 발사
// ======================================================

function castSkillAt(
  screenX,
  screenY
) {

  if (
    !skillSelected ||
    waitingForCast ||
    serverFull
  ) {

    return;
  }

  if (
    isCurrentSkillCooling()
  ) {

    skillStateEl.textContent =
      '쿨타임';

    return;
  }

  const me =
    getMe();

  if (
    !me
  ) {

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

  const aim =
    aimToScreen(
      screenX,
      screenY
    );

  if (
    aim
  ) {

    socket.emit(
      'aim',
      aim
    );
  }

  waitingForCast =
    true;

  socket.emit(
    'castSkill',
    {

      targetX,
      targetY

    }
  );
}

canvas.addEventListener(
  'pointerdown',
  event => {

    if (
      !skillSelected
    ) {

      return;
    }

    event.preventDefault();

    mouseX =
      event.clientX;

    mouseY =
      event.clientY;

    if (
      event.pointerType ===
        'mouse' ||
      event.pointerType ===
        'pen'
    ) {

      mouseAimActive =
        true;
    }

    castSkillAt(
      event.clientX,
      event.clientY
    );

  }
);

// ======================================================
// 이동
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
        0.08 ||

      Math.abs(
        joyY
      ) >
        0.08
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
      length >
      1
    ) {

      x /=
        length;

      y /=
        length;
    }

    if (
      Math.abs(
        x -
        lastInputX
      ) >
        0.01 ||

      Math.abs(
        y -
        lastInputY
      ) >
        0.01
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

    sendMouseAim(
      false
    );

  },

  33
);

// ======================================================
// 숲 렌더
// ======================================================

function visible(
  x,
  y,
  margin,
  cx,
  cy
) {

  return (
    x >
      cx -
      margin &&

    x <
      cx +
      innerWidth +
      margin &&

    y >
      cy -
      margin &&

    y <
      cy +
      innerHeight +
      margin
  );
}

function hashRand(
  n
) {

  const value =
    Math.sin(
      n *
      12.9898
    ) *
    43758.5453;

  return (
    value -
    Math.floor(
      value
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
        cx,
        cy
      )
    ) {

      continue;
    }

    const screenX =
      x -
      cx;

    const screenY =
      y -
      cy;

    ctx.beginPath();

    ctx.ellipse(
      screenX,
      screenY + 25,
      size * 0.72,
      size * 0.25,
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
      screenX -
      size * 0.12,
      screenY,
      size * 0.24,
      size * 0.85
    );

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
      size * 0.55,
      screenY,
      size * 0.58,
      0,
      Math.PI * 2
    );

    ctx.arc(
      screenX +
      size * 0.55,
      screenY,
      size * 0.58,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      '#287a3e';

    ctx.fill();

    ctx.beginPath();

    ctx.arc(
      screenX -
      size * 0.25,
      screenY -
      size * 0.28,
      size * 0.3,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      '#47a457';

    ctx.fill();

  }

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
// 걷기 프레임
// ======================================================

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
      145
    ) %
    3
  );
}

function directionRow(
  direction
) {

  if (
    direction ===
    'back'
  ) {

    return 1;
  }

  if (
    direction ===
    'left'
  ) {

    return 2;
  }

  if (
    direction ===
    'right'
  ) {

    return 3;
  }

  return 0;
}

// ======================================================
// 마법사 프레임
// ======================================================

const MAGE_FRAMES = [

  [
    {
      x: 112,
      y: 83,
      w: 220,
      h: 292,
      anchorX: 59
    },

    {
      x: 384,
      y: 82,
      w: 221,
      h: 292,
      anchorX: 128
    },

    {
      x: 686,
      y: 82,
      w: 222,
      h: 292,
      anchorX: 167
    }
  ],

  [
    {
      x: 105,
      y: 424,
      w: 219,
      h: 344,
      anchorX: 66
    },

    {
      x: 382,
      y: 426,
      w: 215,
      h: 342,
      anchorX: 130
    },

    {
      x: 687,
      y: 425,
      w: 213,
      h: 343,
      anchorX: 166
    }
  ],

  [
    {
      x: 119,
      y: 768,
      w: 222,
      h: 384,
      anchorX: 52
    },

    {
      x: 341,
      y: 768,
      w: 283,
      h: 384,
      anchorX: 171
    },

    {
      x: 695,
      y: 768,
      w: 235,
      h: 384,
      anchorX: 158
    }
  ],

  [
    {
      x: 160,
      y: 1152,
      w: 181,
      h: 190,
      anchorX: 11
    },

    {
      x: 341,
      y: 1152,
      w: 284,
      h: 191,
      anchorX: 171
    },

    {
      x: 730,
      y: 1152,
      w: 202,
      h: 189,
      anchorX: 123
    }
  ]

];

// ======================================================
// 해적 프레임
// 실제 업로드한 pirate.png 기준
// 1086 × 1448 이미지
//
// 중요:
// 무기까지 포함한 이미지 중앙이 아니라
// 각 셀의 캐릭터 몸 중심 위치를 anchorX로 사용.
// 그래서 커틀라스/총 때문에 중심축이 옆으로 밀리지 않음.
// ======================================================

const PIRATE_FRAMES = [

  // FRONT
  [
    {
      x: 74,
      y: 29,
      w: 249,
      h: 319,
      anchorX: 107
    },

    {
      x: 422,
      y: 30,
      w: 229,
      h: 311,
      anchorX: 121
    },

    {
      x: 761,
      y: 30,
      w: 230,
      h: 318,
      anchorX: 144
    }
  ],

  // BACK
  [
    {
      x: 91,
      y: 384,
      w: 245,
      h: 326,
      anchorX: 90
    },

    {
      x: 431,
      y: 384,
      w: 225,
      h: 318,
      anchorX: 112
    },

    {
      x: 772,
      y: 384,
      w: 235,
      h: 326,
      anchorX: 133
    }
  ],

  // LEFT
  [
    {
      x: 45,
      y: 738,
      w: 293,
      h: 312,
      anchorX: 136
    },

    {
      x: 418,
      y: 738,
      w: 236,
      h: 316,
      anchorX: 125
    },

    {
      x: 755,
      y: 738,
      w: 273,
      h: 312,
      anchorX: 150
    }
  ],

  // RIGHT
  [
    {
      x: 67,
      y: 1092,
      w: 270,
      h: 312,
      anchorX: 114
    },

    {
      x: 427,
      y: 1092,
      w: 227,
      h: 317,
      anchorX: 116
    },

    {
      x: 751,
      y: 1092,
      w: 266,
      h: 313,
      anchorX: 154
    }
  ]

];

const MAGE_SCALE =
  0.39;

const PIRATE_SCALE =
  0.39;

const CHARACTER_FOOT_Y =
  30;

// ======================================================
// 캐릭터 그리기
// ======================================================

function spriteConfig(
  player
) {

  if (
    player.avatar ===
    'pirate'
  ) {

    return {

      image:
        pirateImage,

      ready:
        pirateReady,

      frames:
        PIRATE_FRAMES,

      scale:
        PIRATE_SCALE,

      fallback:
        '#a33632'

    };
  }

  return {

    image:
      mageImage,

    ready:
      mageReady,

    frames:
      MAGE_FRAMES,

    scale:
      MAGE_SCALE,

    fallback:
      '#6743a5'

  };
}

function drawCharacter(
  player,
  screenX,
  screenY,
  isMe
) {

  const config =
    spriteConfig(
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

  if (
    config.ready
  ) {

    const row =
      directionRow(
        player.direction
      );

    const column =
      walkFrame(
        player
      );

    const frame =
      config.frames[
        row
      ][
        column
      ];

    const scale =
      config.scale;

    /*
      핵심 수정

      X축:
      이미지 전체 중앙이 아니라
      캐릭터 몸 중심 anchorX 사용.

      Y축:
      각 프레임의 맨 아래를
      CHARACTER_FOOT_Y에 고정.

      프레임 크기가 달라도
      발 위치와 몸 중심축이 유지됨.
    */

    ctx.drawImage(

      config.image,

      frame.x,
      frame.y,

      frame.w,
      frame.h,

      -frame.anchorX *
      scale,

      CHARACTER_FOOT_Y -
      frame.h *
      scale,

      frame.w *
      scale,

      frame.h *
      scale

    );

  } else {

    ctx.fillStyle =
      config.fallback;

    ctx.fillRect(
      -22,
      -44,
      44,
      44
    );
  }

  ctx.restore();

  ctx.fillStyle =
    'rgba(0,0,0,.48)';

  ctx.fillRect(
    screenX - 34,
    screenY - 78,
    68,
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

    screenY - 65

  );
}

// ======================================================
// 슬라임
// ======================================================

function drawSlime(
  slime,
  cx,
  cy
) {

  if (
    !slime.alive
  ) {

    return;
  }

  const x =
    slime.x -
    cx;

  const y =
    slime.y -
    cy;

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

  ctx.beginPath();

  ctx.ellipse(
    0,
    radius * 0.72,
    radius * 0.82,
    radius * 0.28,
    0,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(0,0,0,.22)';

  ctx.fill();

  ctx.beginPath();

  ctx.moveTo(
    -radius,
    8
  );

  ctx.quadraticCurveTo(
    -radius,
    -radius * 0.65,
    0,
    -radius
  );

  ctx.quadraticCurveTo(
    radius,
    -radius * 0.65,
    radius,
    8
  );

  ctx.quadraticCurveTo(
    0,
    radius * 0.85,
    -radius,
    8
  );

  ctx.fillStyle =
    slime.elite
      ? '#7d4fd1'
      : '#58c96f';

  ctx.fill();

  ctx.fillStyle =
    '#172019';

  ctx.beginPath();

  ctx.arc(
    -radius * 0.3,
    -2,
    3,
    0,
    Math.PI * 2
  );

  ctx.arc(
    radius * 0.3,
    -2,
    3,
    0,
    Math.PI * 2
  );

  ctx.fill();

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

  const width =
    slime.elite
      ? 68
      : 48;

  const hp =
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
    hp,

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

// ======================================================
// 파이어볼
// ======================================================

function drawFireball(
  fireball,
  cx,
  cy
) {

  const x =
    fireball.x -
    cx;

  const y =
    fireball.y -
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
// 해적선 스킬 렌더
// ======================================================

function drawPirateShip(
  ship,
  cx,
  cy
) {

  const x =
    ship.x -
    cx;

  const y =
    ship.y -
    cy;

  ctx.save();

  ctx.translate(
    x,
    y
  );

  /*
    이미지가 위쪽을 바라보게 그린 뒤
    서버 각도에 맞춰 회전
  */

  ctx.rotate(
    ship.angle +
    Math.PI /
    2
  );

  // 물결
  ctx.beginPath();

  ctx.ellipse(
    0,
    30,
    56,
    18,
    0,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(100,210,255,.28)';

  ctx.fill();

  // 선체
  ctx.beginPath();

  ctx.moveTo(
    0,
    -58
  );

  ctx.lineTo(
    30,
    35
  );

  ctx.lineTo(
    18,
    52
  );

  ctx.lineTo(
    -18,
    52
  );

  ctx.lineTo(
    -30,
    35
  );

  ctx.closePath();

  ctx.fillStyle =
    '#70411f';

  ctx.fill();

  ctx.strokeStyle =
    '#d39b4a';

  ctx.lineWidth =
    4;

  ctx.stroke();

  // 갑판
  ctx.fillStyle =
    '#ad6a32';

  ctx.fillRect(
    -17,
    -15,
    34,
    43
  );

  // 돛대
  ctx.fillStyle =
    '#4b2c17';

  ctx.fillRect(
    -3,
    -34,
    6,
    67
  );

  // 돛
  ctx.beginPath();

  ctx.moveTo(
    2,
    -31
  );

  ctx.lineTo(
    34,
    -12
  );

  ctx.lineTo(
    3,
    2
  );

  ctx.closePath();

  ctx.fillStyle =
    '#25252c';

  ctx.fill();

  // 해골
  ctx.fillStyle =
    '#ffffff';

  ctx.beginPath();

  ctx.arc(
    12,
    -13,
    6,
    0,
    Math.PI * 2
  );

  ctx.fill();

  ctx.fillStyle =
    '#111111';

  ctx.beginPath();

  ctx.arc(
    10,
    -14,
    1.5,
    0,
    Math.PI * 2
  );

  ctx.arc(
    14,
    -14,
    1.5,
    0,
    Math.PI * 2
  );

  ctx.fill();

  // 충돌 범위 느낌
  ctx.beginPath();

  ctx.ellipse(
    0,
    5,
    55,
    80,
    0,
    0,
    Math.PI * 2
  );

  ctx.strokeStyle =
    'rgba(255,190,80,.15)';

  ctx.lineWidth =
    2;

  ctx.stroke();

  ctx.restore();
}

// ======================================================
// 스킬 조준점
// ======================================================

function drawTarget() {

  if (
    !skillSelected ||
    !mouseAimActive
  ) {

    return;
  }

  ctx.save();

  ctx.strokeStyle =
    selectedAvatar ===
      'pirate'
      ? 'rgba(255,215,90,.95)'
      : 'rgba(255,105,40,.95)';

  ctx.lineWidth =
    2;

  ctx.beginPath();

  ctx.arc(
    mouseX,
    mouseY,
    12,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  ctx.beginPath();

  ctx.moveTo(
    mouseX - 18,
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
    mouseX + 18,
    mouseY
  );

  ctx.moveTo(
    mouseX,
    mouseY - 18
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
    mouseY + 18
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

  cameraX = 0;
  cameraY = 0;

  if (
    me
  ) {

    cameraX =
      cClamp(
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
      cClamp(
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
        100,
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

  // 해적선
  for (
    const ship
    of pirateShips
  ) {

    if (
      visible(
        ship.x,
        ship.y,
        150,
        cameraX,
        cameraY
      )
    ) {

      drawPirateShip(
        ship,
        cameraX,
        cameraY
      );
    }
  }

  // 캐릭터
  const orderedPlayers =
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
    const player
    of orderedPlayers
  ) {

    if (
      !visible(
        player.x,
        player.y,
        170,
        cameraX,
        cameraY
      )
    ) {

      continue;
    }

    drawCharacter(

      player,

      player.x -
      cameraX,

      player.y -
      cameraY,

      player.id ===
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
// 서버 실행
// ======================================================

server.listen(
  PORT,
  () => {

    console.log(
      'Forest RPG running on port ' +
      PORT
    );

    console.log(
      'Max players: ' +
      MAX_PLAYERS
    );

  }
);

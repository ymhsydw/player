const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

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

// 보스 소환 필요 점수
const BOSS_KILL_TARGET = 20;

// 보스 체력
const BOSS_HP = 1200;

// ======================================================
// 마법사
// ======================================================

const FIREBALL_SPEED = 900;

const FIREBALL_DAMAGE = 60;

const FIREBALL_RADIUS = 14;

const FIREBALL_LIFE = 1.35;

const FIREBALL_COOLDOWN = 900;

// ======================================================
// 해적
// ======================================================

const PIRATE_SHIP_SPEED = 720;

const PIRATE_SHIP_LIFE = 4;

const PIRATE_SHIP_HIT_RADIUS = 85;

const PIRATE_SHIP_COOLDOWN = 6000;

// 보스에게 해적선이 주는 피해
const PIRATE_SHIP_BOSS_DAMAGE = 300;

// ======================================================
// 서버 상태
// ======================================================

const players = new Map();

const slimes = new Map();

const fireballs = new Map();

const pirateShips = new Map();

let nextSlimeId = 1;

let nextFireballId = 1;

let nextPirateShipId = 1;

let bossKillProgress = 0;

let bossId = null;

// ======================================================
// 공통
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

    x:
      point.x,

    y:
      point.y,

    inputX: 0,
    inputY: 0,

    aimX: 0,
    aimY: 1,

    direction:
      'front',

    moving:
      false,

    avatar:
      'mage',

    lastMageCastAt:
      0,

    lastPirateCastAt:
      0

  };
}

// ======================================================
// 슬라임 AI
// ======================================================

function chooseSlimeDirection(
  slime
) {

  const angle =
    Math.random() *
    Math.PI *
    2;

  let speed;

  if (
    slime.boss
  ) {

    speed =
      26 +
      Math.random() *
      15;

  } else if (
    slime.elite
  ) {

    speed =
      55 +
      Math.random() *
      25;

  } else {

    speed =
      40 +
      Math.random() *
      30;
  }

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

// ======================================================
// 일반 / 엘리트 생성
// ======================================================

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

    boss:
      false,

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

    alive:
      true,

    respawnAt:
      0

  };

  chooseSlimeDirection(
    slime
  );

  slimes.set(
    slime.id,
    slime
  );
}

// ======================================================
// 보스 생성
// ======================================================

function createBossSlime() {

  if (
    bossId !== null
  ) {

    return;
  }

  const point =
    randomPoint(500);

  const boss = {

    id:
      nextSlimeId++,

    x:
      point.x,

    y:
      point.y,

    elite:
      false,

    boss:
      true,

    radius:
      74,

    maxHp:
      BOSS_HP,

    hp:
      BOSS_HP,

    vx: 0,

    vy: 0,

    changeAt: 0,

    alive:
      true,

    respawnAt:
      0

  };

  chooseSlimeDirection(
    boss
  );

  slimes.set(
    boss.id,
    boss
  );

  bossId =
    boss.id;

  bossKillProgress =
    0;

  io.emit(
    'bossSpawned'
  );
}

// ======================================================
// 초기 슬라임 생성
// ======================================================

for (
  let i = 0;
  i < NORMAL_SLIMES;
  i++
) {

  createSlime(
    false
  );
}

for (
  let i = 0;
  i < ELITE_SLIMES;
  i++
) {

  createSlime(
    true
  );
}

// ======================================================
// 일반 슬라임 부활
// ======================================================

function respawnSlime(
  slime
) {

  if (
    slime.boss
  ) {

    return;
  }

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

// ======================================================
// 처치 카운트
// ======================================================

function addKillProgress(
  slime
) {

  // 보스가 살아있는 동안
  // 다음 보스 게이지는 충전되지 않음
  if (
    bossId !== null
  ) {

    return;
  }

  if (
    slime.elite
  ) {

    bossKillProgress +=
      2;

  } else {

    bossKillProgress +=
      1;
  }

  if (
    bossKillProgress >=
    BOSS_KILL_TARGET
  ) {

    createBossSlime();
  }
}

// ======================================================
// 슬라임 처치
// ======================================================

function killSlime(
  slime,
  now
) {

  if (
    !slime.alive
  ) {

    return;
  }

  // ==============================
  // 보스
  // ==============================

  if (
    slime.boss
  ) {

    slime.alive =
      false;

    slime.hp =
      0;

    slimes.delete(
      slime.id
    );

    bossId =
      null;

    bossKillProgress =
      0;

    io.emit(
      'bossDefeated'
    );

    return;
  }

  // ==============================
  // 일반 / 엘리트
  // ==============================

  slime.hp =
    0;

  slime.alive =
    false;

  slime.respawnAt =
    now +
    SLIME_RESPAWN_MS;

  addKillProgress(
    slime
  );
}

// ======================================================
// 파이어볼
// ======================================================

function castFireball(
  player,
  targetX,
  targetY
) {

  // 마법사 전용
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
// 해적선
// ======================================================

function castPirateShip(
  player,
  targetX,
  targetY
) {

  // 해적 전용
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
        PIRATE_SHIP_LIFE,

      bossHits:
        new Set()

    }
  );

  return true;
}

// ======================================================
// 현재 캐릭터 E 스킬
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
// 서버 접속
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

    // ==================================================
    // 이동
    // ==================================================

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
          Number(
            data.x
          ) ||
          0;

        let y =
          Number(
            data.y
          ) ||
          0;

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

    // ==================================================
    // 마우스 시선
    // ==================================================

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
          Number(
            data.x
          ) ||
          0;

        let y =
          Number(
            data.y
          ) ||
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

    // ==================================================
    // 캐릭터 선택
    // ==================================================

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

    // ==================================================
    // E 스킬
    //
    // PVP 안전모드:
    // 스킬은 슬라임에만 판정.
    // players에는 어떠한 공격 판정도 하지 않음.
    // ==================================================

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
    // 플레이어 이동
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
    // 슬라임 이동
    // ==================================================

    for (
      const slime
      of slimes.values()
    ) {

      if (
        !slime.alive
      ) {

        if (
          !slime.boss &&
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
        fireball.life <=
          0 ||

        fireball.x <
          -50 ||

        fireball.x >
          WORLD.width +
          50 ||

        fireball.y <
          -50 ||

        fireball.y >
          WORLD.height +
          50
      ) {

        fireballs.delete(
          fireball.id
        );

        continue;
      }

      // 오직 슬라임과만 충돌
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
            slime.hp <=
            0
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
        ship.life <=
          0 ||

        ship.x <
          -250 ||

        ship.x >
          WORLD.width +
          250 ||

        ship.y <
          -250 ||

        ship.y >
          WORLD.height +
          250
      ) {

        pirateShips.delete(
          ship.id
        );

        continue;
      }

      // 역시 플레이어와 충돌하지 않음
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
          dy * dy >
          hitDistance *
          hitDistance
        ) {

          continue;
        }

        // ==============================
        // 보스
        // ==============================

        if (
          slime.boss
        ) {

          if (
            ship.bossHits.has(
              slime.id
            )
          ) {

            continue;
          }

          ship.bossHits.add(
            slime.id
          );

          slime.hp -=
            PIRATE_SHIP_BOSS_DAMAGE;

          if (
            slime.hp <=
            0
          ) {

            killSlime(
              slime,
              now
            );
          }

          continue;
        }

        // 일반 / 엘리트 즉사
        killSlime(
          slime,
          now
        );
      }

    }

    // ==================================================
    // 클라이언트 상태
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

              boss:
                slime.boss,

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
          ),

        bossProgress:
          bossKillProgress,

        bossTarget:
          BOSS_KILL_TARGET,

        bossActive:
          bossId !==
          null

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
// 웹게임
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
content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"
>

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

/* ==============================
   HUD
============================== */

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

#bossProgress {

  color:
    #ffb3b3;

  font-weight:
    900;
}

/* ==============================
   안전모드
============================== */

#safeMode {

  position:
    fixed;

  right:
    12px;

  top:
    12px;

  z-index:
    50;

  color:
    #dcffe2;

  background:
    rgba(
      20,
      92,
      44,
      .92
    );

  border:
    2px solid
    rgba(
      126,
      255,
      161,
      .8
    );

  border-radius:
    12px;

  padding:
    9px 13px;

  font-size:
    13px;

  font-weight:
    900;

  text-align:
    center;

  box-shadow:
    0 4px 16px
    rgba(
      0,
      0,
      0,
      .28
    );

  pointer-events:
    none;
}

#safeMode small {

  display:
    block;

  margin-top:
    2px;

  font-size:
    10px;

  opacity:
    .85;
}

/* ==============================
   캐릭터 선택
============================== */

#avatarPanel {

  position:
    fixed;

  right:
    12px;

  top:
    72px;

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
    10px;

  text-align:
    left;

  font:
    inherit;
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
}

.avatarBtn span {

  font-size:
    12px;

  opacity:
    .82;
}

/* ==============================
   조이스틱
============================== */

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

/* ==============================
   E스킬
============================== */

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

  touch-action:
    none;
}

#skillE.selected {

  background:
    rgba(
      204,
      72,
      25,
      .96
    );

  box-shadow:
    0 0 25px
    rgba(
      255,
      110,
      25,
      .65
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

  padding:
    7px 10px;

  border-radius:
    9px;

  font-size:
    12px;

  pointer-events:
    none;
}

@media (
  max-width:
  700px
) {

  #avatarPanel {

    width:
      175px;
  }

  #safeMode {

    font-size:
      11px;
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
보스 게이지:
<span id="bossProgress">
0 / 20
</span>
</div>

</div>

<div id="safeMode">

🛡️ 안전 모드 ON

<small>
플레이어 공격 불가
</small>

</div>

<div id="avatarPanel">

<div id="avatarTitle">
캐릭터 선택
</div>

<div id="avatarGrid">

<button
class="avatarBtn selected"
data-avatar="mage"
type="button"
>

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
type="button"
>

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
type="button"
>

E
<br>
파이어볼

</button>

<div id="tip">

E → 스킬 선택 → 맵 클릭

</div>

<script src="/socket.io/socket.io.js">
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

const bossProgressEl =
  document.getElementById(
    'bossProgress'
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

let players = [];

let slimes = [];

let fireballs = [];

let pirateShips = [];

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

  mage:
    0,

  pirate:
    0

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
// 캐릭터 데이터
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
      '선택됨<br>경로 지정'

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

pirateImage.src =
  '/pirate.png';

// ======================================================
// 리사이즈
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

    if (
      data.bossActive
    ) {

      bossProgressEl.textContent =
        '👑 보스 출현!';

    } else {

      bossProgressEl.textContent =
        data.bossProgress +
        ' / ' +
        data.bossTarget;
    }
  }
);

socket.on(
  'bossSpawned',
  () => {

    skillStateEl.textContent =
      '👑 보스 슬라임 출현!';
  }
);

socket.on(
  'bossDefeated',
  () => {

    skillStateEl.textContent =
      '🏆 보스 처치!';
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
}

setInterval(
  updateSkillUI,
  100
);

// ======================================================
// E 선택
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
      key ===
      'e'
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
// 마우스
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
    .34;

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

  joyX =
    0;

  joyY =
    0;

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
    .001
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

function sendMouseAim() {

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
    Math.abs(
      aim.x -
      lastAimX
    ) >
      .01 ||

    Math.abs(
      aim.y -
      lastAimY
    ) >
      .01
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
// 스킬 클릭
// ======================================================

function castSkillAt(
  screenX,
  screenY
) {

  if (
    !skillSelected ||
    waitingForCast
  ) {

    return;
  }

  if (
    isCurrentSkillCooling()
  ) {

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

    sendMouseAim();

  },

  33
);

// ======================================================
// 가시 영역
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

// ======================================================
// 숲
// ======================================================

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
      size * .72,
      size * .25,
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
      size * .12,
      sy,
      size * .24,
      size * .85
    );

    ctx.beginPath();

    ctx.arc(
      sx,
      sy - 8,
      size,
      0,
      Math.PI * 2
    );

    ctx.arc(
      sx -
      size * .55,
      sy,
      size * .58,
      0,
      Math.PI * 2
    );

    ctx.arc(
      sx +
      size * .55,
      sy,
      size * .58,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      '#287a3e';

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
// 걷기
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
// 마법사
// 이전 정상 크롭 좌표로 복구
// ======================================================

const MAGE_FRAMES = [

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

// ======================================================
// 해적
// ======================================================

const PIRATE_FRAMES = [

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
  .43;

const PIRATE_SCALE =
  .39;

const CHARACTER_FOOT_Y =
  30;

// ======================================================
// 캐릭터
// ======================================================

function drawCharacter(
  player,
  screenX,
  screenY,
  isMe
) {

  const row =
    directionRow(
      player.direction
    );

  const column =
    walkFrame(
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

  // ==============================
  // 해적
  // ==============================

  if (
    player.avatar ===
    'pirate'
  ) {

    if (
      pirateReady
    ) {

      const frame =
        PIRATE_FRAMES[
          row
        ][
          column
        ];

      const scale =
        PIRATE_SCALE;

      ctx.drawImage(

        pirateImage,

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
    }

  }

  // ==============================
  // 마법사
  // ==============================

  else {

    if (
      mageReady
    ) {

      const frame =
        MAGE_FRAMES[
          row
        ][
          column
        ];

      const drawWidth =
        frame.w *
        MAGE_SCALE;

      const drawHeight =
        frame.h *
        MAGE_SCALE;

      ctx.drawImage(

        mageImage,

        frame.x,
        frame.y,
        frame.w,
        frame.h,

        -drawWidth /
        2,

        CHARACTER_FOOT_Y -
        drawHeight,

        drawWidth,
        drawHeight

      );
    }
  }

  ctx.restore();

  ctx.fillStyle =
    'rgba(0,0,0,.48)';

  ctx.fillRect(
    screenX -
    34,
    screenY -
    78,
    68,
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
        player.id.slice(
          0,
          4
        ),

    screenX,
    screenY -
    65
  );
}

// ======================================================
// 슬라임 그리기
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
    slime.boss
      ? 74
      : slime.elite
        ? 34
        : 24;

  const bounce =
    Math.sin(
      performance.now() /
      180 +
      slime.id
    ) *
    (
      slime.boss
        ? 4
        : 2.5
    );

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
    radius * .83,
    radius * .28,
    0,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(0,0,0,.25)';

  ctx.fill();

  // 몸
  ctx.beginPath();

  ctx.moveTo(
    -radius,
    8
  );

  ctx.quadraticCurveTo(
    -radius,
    -radius * .7,
    0,
    -radius
  );

  ctx.quadraticCurveTo(
    radius,
    -radius * .7,
    radius,
    8
  );

  ctx.quadraticCurveTo(
    0,
    radius * .85,
    -radius,
    8
  );

  if (
    slime.boss
  ) {

    ctx.fillStyle =
      '#a52339';

  } else if (
    slime.elite
  ) {

    ctx.fillStyle =
      '#7d4fd1';

  } else {

    ctx.fillStyle =
      '#58c96f';
  }

  ctx.fill();

  // 보스 내부
  if (
    slime.boss
  ) {

    ctx.beginPath();

    ctx.arc(
      0,
      -15,
      35,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      'rgba(255,90,100,.28)';

    ctx.fill();
  }

  // 눈
  ctx.fillStyle =
    '#151719';

  ctx.beginPath();

  ctx.arc(
    -radius * .3,
    -4,
    slime.boss
      ? 7
      : 3,
    0,
    Math.PI * 2
  );

  ctx.arc(
    radius * .3,
    -4,
    slime.boss
      ? 7
      : 3,
    0,
    Math.PI * 2
  );

  ctx.fill();

  // 왕관
  if (
    slime.elite ||
    slime.boss
  ) {

    const crownY =
      -radius -
      5;

    const crownSize =
      slime.boss
        ? 22
        : 13;

    ctx.fillStyle =
      '#ffd259';

    ctx.beginPath();

    ctx.moveTo(
      -crownSize,
      crownY
    );

    ctx.lineTo(
      -crownSize * .6,
      crownY -
      crownSize
    );

    ctx.lineTo(
      0,
      crownY -
      crownSize * .4
    );

    ctx.lineTo(
      crownSize * .6,
      crownY -
      crownSize
    );

    ctx.lineTo(
      crownSize,
      crownY
    );

    ctx.closePath();

    ctx.fill();
  }

  ctx.restore();

  // ==============================
  // HP
  // ==============================

  const width =
    slime.boss
      ? 180
      : slime.elite
        ? 68
        : 48;

  const hp =
    Math.max(
      0,
      slime.hp /
      slime.maxHp
    );

  ctx.fillStyle =
    'rgba(0,0,0,.7)';

  ctx.fillRect(
    x -
    width / 2,
    y -
    radius -
    (
      slime.boss
        ? 42
        : 22
    ),
    width,
    slime.boss
      ? 13
      : 7
  );

  ctx.fillStyle =
    slime.boss
      ? '#ff334f'
      : slime.elite
        ? '#e5b84d'
        : '#ef6666';

  ctx.fillRect(
    x -
    width / 2 +
    2,
    y -
    radius -
    (
      slime.boss
        ? 40
        : 21
    ),
    (
      width -
      4
    ) *
    hp,
    slime.boss
      ? 9
      : 5
  );

  if (
    slime.boss
  ) {

    ctx.fillStyle =
      '#ffd6da';

    ctx.font =
      '900 16px system-ui';

    ctx.textAlign =
      'center';

    ctx.fillText(
      '👑 BOSS SLIME',
      x,
      y -
      radius -
      52
    );

  } else if (
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
// 해적선
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

  ctx.rotate(
    ship.angle +
    Math.PI /
    2
  );

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

  ctx.fillStyle =
    '#ad6a32';

  ctx.fillRect(
    -17,
    -15,
    34,
    43
  );

  ctx.fillStyle =
    '#4b2c17';

  ctx.fillRect(
    -3,
    -34,
    6,
    67
  );

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
    const slime
    of slimes
  ) {

    if (
      visible(
        slime.x,
        slime.y,
        150,
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

  for (
    const fireball
    of fireballs
  ) {

    drawFireball(
      fireball,
      cameraX,
      cameraY
    );
  }

  for (
    const ship
    of pirateShips
  ) {

    drawPirateShip(
      ship,
      cameraX,
      cameraY
    );
  }

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
}

render();

</script>

</body>

</html>

`);

  }
);

// ======================================================
// 실행
// ======================================================

server.listen(
  PORT,
  () => {

    console.log(
      'Forest RPG running on port ' +
      PORT
    );

    console.log(
      'SAFE MODE: ON'
    );

  }
);

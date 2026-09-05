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

// 일반 = 1점
// 엘리트 = 2점
// 20점 = 보스
const BOSS_KILL_TARGET = 20;

const BOSS_HP = 1200;

// ======================================================
// 마법사 E - 파이어볼
// ======================================================

const FIREBALL_SPEED = 900;
const FIREBALL_DAMAGE = 60;
const FIREBALL_RADIUS = 14;
const FIREBALL_LIFE = 1.5;
const FIREBALL_COOLDOWN = 900;

// ======================================================
// 해적 E - 유령 해적선
// ======================================================

const PIRATE_SHIP_SPEED = 700;
const PIRATE_SHIP_LIFE = 5;
const PIRATE_SHIP_HIT_RADIUS = 90;
const PIRATE_SHIP_COOLDOWN = 6000;

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

let bossProgress = 0;
let bossId = null;

// ======================================================
// 공통
// ======================================================

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function randomPoint(margin = 120) {
  return {
    x:
      margin +
      Math.random() *
      (WORLD.width - margin * 2),

    y:
      margin +
      Math.random() *
      (WORLD.height - margin * 2)
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
// 슬라임 이동 AI
// ======================================================

function chooseSlimeDirection(slime) {
  const angle =
    Math.random() *
    Math.PI *
    2;

  let speed;

  if (slime.boss) {
    speed =
      28 +
      Math.random() * 14;
  } else if (slime.elite) {
    speed =
      55 +
      Math.random() * 25;
  } else {
    speed =
      40 +
      Math.random() * 30;
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
    Math.random() * 2500;
}

// ======================================================
// 일반 / 엘리트 슬라임
// ======================================================

function createSlime(elite = false) {
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

    boss: false,

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

  chooseSlimeDirection(slime);

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

// ======================================================
// 보스 슬라임
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

    elite: false,

    boss: true,

    radius: 76,

    maxHp:
      BOSS_HP,

    hp:
      BOSS_HP,

    vx: 0,
    vy: 0,

    changeAt: 0,

    alive: true,

    respawnAt: 0
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

  bossProgress =
    0;

  io.emit(
    'bossSpawned'
  );
}

// ======================================================
// 슬라임 리스폰
// ======================================================

function respawnSlime(slime) {
  if (slime.boss) {
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
// 보스 게이지
// ======================================================

function addBossProgress(slime) {
  // 보스가 살아있는 동안
  // 다음 게이지는 충전 안 함
  if (
    bossId !== null
  ) {
    return;
  }

  if (slime.elite) {
    bossProgress += 2;
  } else {
    bossProgress += 1;
  }

  if (
    bossProgress >=
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
  if (!slime.alive) {
    return;
  }

  // ==============================
  // 보스 처치
  // ==============================

  if (slime.boss) {
    slime.hp = 0;
    slime.alive = false;

    slimes.delete(
      slime.id
    );

    bossId = null;
    bossProgress = 0;

    io.emit(
      'bossDefeated'
    );

    return;
  }

  // ==============================
  // 일반 / 엘리트
  // ==============================

  slime.hp = 0;
  slime.alive = false;

  slime.respawnAt =
    now +
    SLIME_RESPAWN_MS;

  addBossProgress(
    slime
  );
}

// ======================================================
// 마법사 파이어볼
// ======================================================

function castFireball(
  player,
  targetX,
  targetY
) {
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
    Math.hypot(dx, dy);

  if (length < 1) {
    return false;
  }

  dx /= length;
  dy /= length;

  player.lastMageCastAt =
    now;

  player.aimX = dx;
  player.aimY = dy;

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
// 해적선 방향
//
// 클릭한 곳을 기준으로
// 가장 가까운 상하좌우 방향 결정
//
// 해적선 PNG 방향과
// 실제 이동 방향을 완전히 일치시킴.
// ======================================================

function getPirateShipDirection(
  dx,
  dy
) {
  if (
    Math.abs(dx) >
    Math.abs(dy)
  ) {
    if (dx > 0) {
      return {
        name: 'right',
        x: 1,
        y: 0
      };
    }

    return {
      name: 'left',
      x: -1,
      y: 0
    };
  }

  if (dy > 0) {
    return {
      name: 'down',
      x: 0,
      y: 1
    };
  }

  return {
    name: 'up',
    x: 0,
    y: -1
  };
}

// ======================================================
// 해적 유령선 발사
// ======================================================

function castPirateShip(
  player,
  targetX,
  targetY
) {
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

  const rawX =
    Number(targetX) -
    player.x;

  const rawY =
    Number(targetY) -
    player.y;

  if (
    !Number.isFinite(rawX) ||
    !Number.isFinite(rawY)
  ) {
    return false;
  }

  if (
    Math.hypot(
      rawX,
      rawY
    ) < 1
  ) {
    return false;
  }

  const dir =
    getPirateShipDirection(
      rawX,
      rawY
    );

  player.lastPirateCastAt =
    now;

  player.aimX =
    dir.x;

  player.aimY =
    dir.y;

  player.direction =
    directionFromVector(
      dir.x,
      dir.y,
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
        dir.x * 100,

      y:
        player.y +
        dir.y * 100,

      vx:
        dir.x *
        PIRATE_SHIP_SPEED,

      vy:
        dir.y *
        PIRATE_SHIP_SPEED,

      direction:
        dir.name,

      life:
        PIRATE_SHIP_LIFE,

      bossHits:
        new Set()
    }
  );

  return true;
}

// ======================================================
// 현재 캐릭터 E
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
// 멀티
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

    // ==============================
    // 이동
    // ==============================

    socket.on(
      'input',
      (data = {}) => {
        const player =
          players.get(
            socket.id
          );

        if (!player) {
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
          length >
          1
        ) {
          x /= length;
          y /= length;
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

    // ==============================
    // 시선
    // ==============================

    socket.on(
      'aim',
      (data = {}) => {
        const player =
          players.get(
            socket.id
          );

        if (!player) {
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

        x /= length;
        y /= length;

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

    // ==============================
    // 캐릭터 변경
    // ==============================

    socket.on(
      'setAvatar',
      (data = {}) => {
        const player =
          players.get(
            socket.id
          );

        if (!player) {
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

    // ==============================
    // E 스킬
    //
    // 안전 모드:
    // players와 공격 충돌 검사 없음.
    // 플레이어끼리는 절대 피해 없음.
    // ==============================

    socket.on(
      'castSkill',
      (data = {}) => {
        const player =
          players.get(
            socket.id
          );

        if (!player) {
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

    // ==============================
    // 플레이어
    // ==============================

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

    // ==============================
    // 슬라임
    // ==============================

    for (
      const slime
      of slimes.values()
    ) {
      if (!slime.alive) {
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

    // ==============================
    // 파이어볼
    // ==============================

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

      // 오직 슬라임만 공격
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
            killSlime(
              slime,
              now
            );
          }

          break;
        }
      }
    }

    // ==============================
    // 유령 해적선
    // ==============================

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
        ship.x < -300 ||
        ship.x >
          WORLD.width +
          300 ||
        ship.y < -300 ||
        ship.y >
          WORLD.height +
          300
      ) {
        pirateShips.delete(
          ship.id
        );

        continue;
      }

      // 플레이어 충돌 없음
      // 슬라임만 공격
      for (
        const slime
        of slimes.values()
      ) {
        if (!slime.alive) {
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

        // ==========================
        // 보스
        // ==========================

        if (slime.boss) {
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

        // ==========================
        // 일반 / 엘리트 즉사
        // ==========================

        killSlime(
          slime,
          now
        );
      }
    }

    // ==============================
    // 상태 전송
    // ==============================

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
                fireball.y
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

              direction:
                ship.direction
            })
          ),

        bossProgress,

        bossTarget:
          BOSS_KILL_TARGET,

        bossActive:
          bossId !== null
      }
    );
  },

  1000 /
  TICK_RATE
);

// ======================================================
// PNG 파일
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

app.get(
  '/pirate_ship.png',
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'pirate_ship.png'
      )
    );
  }
);

// ======================================================
// 게임 HTML
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

/* ======================================================
   왼쪽 HUD
====================================================== */

#hud {
  position:
    fixed;

  top:
    12px;

  left:
    12px;

  z-index:
    20;

  color:
    white;

  background:
    rgba(8,14,8,.76);

  border:
    1px solid
    rgba(255,255,255,.16);

  border-radius:
    12px;

  padding:
    10px 13px;

  font-size:
    14px;

  line-height:
    1.55;

  backdrop-filter:
    blur(6px);

  pointer-events:
    none;
}

#status {
  font-weight:
    900;
}

#skillName,
#skillState {
  color:
    #ffe082;

  font-weight:
    900;
}

#bossProgress {
  color:
    #ffb5b5;

  font-weight:
    900;
}

/* ======================================================
   안전 모드
====================================================== */

#safeMode {
  position:
    fixed;

  top:
    12px;

  right:
    12px;

  z-index:
    50;

  color:
    #e1ffe6;

  background:
    rgba(18,90,40,.94);

  border:
    2px solid
    rgba(118,255,153,.78);

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

/* ======================================================
   캐릭터 선택
====================================================== */

#avatarPanel {
  position:
    fixed;

  top:
    76px;

  right:
    12px;

  z-index:
    25;

  width:
    205px;

  color:
    white;

  background:
    rgba(8,14,8,.78);

  border:
    1px solid
    rgba(255,255,255,.16);

  border-radius:
    12px;

  padding:
    10px;

  backdrop-filter:
    blur(6px);
}

#avatarTitle {
  margin-bottom:
    8px;

  font-weight:
    900;
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
    rgba(255,255,255,.13);

  border-radius:
    10px;

  background:
    rgba(255,255,255,.06);

  color:
    white;

  padding:
    9px;

  text-align:
    left;

  font:
    inherit;

  cursor:
    pointer;
}

.avatarBtn.selected {
  border-color:
    #ffe082;

  background:
    rgba(255,224,130,.15);
}

.avatarBtn b {
  display:
    block;
}

.avatarBtn span {
  display:
    block;

  margin-top:
    2px;

  font-size:
    11px;

  opacity:
    .82;
}

/* ======================================================
   모바일 이동
====================================================== */

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

  border:
    2px solid
    rgba(255,255,255,.36);

  border-radius:
    50%;

  background:
    rgba(0,0,0,.25);

  touch-action:
    none;
}

#stick {
  position:
    absolute;

  top:
    46px;

  left:
    46px;

  width:
    52px;

  height:
    52px;

  border-radius:
    50%;

  background:
    rgba(255,255,255,.84);

  pointer-events:
    none;
}

/* ======================================================
   E 스킬
====================================================== */

#skillE {
  position:
    fixed;

  right:
    28px;

  bottom:
    30px;

  z-index:
    30;

  width:
    108px;

  height:
    108px;

  border:
    3px solid
    rgba(255,214,128,.86);

  border-radius:
    50%;

  background:
    rgba(137,45,24,.88);

  color:
    white;

  font:
    900 15px
    system-ui;

  cursor:
    pointer;

  touch-action:
    none;
}

#skillE.selected {
  background:
    rgba(204,72,25,.97);

  box-shadow:
    0 0 0 5px
    rgba(255,190,72,.2),

    0 0 25px
    rgba(255,105,25,.65);
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
    rgba(0,0,0,.42);

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
  max-width: 700px
) {
  #avatarPanel {
    width:
      170px;
  }

  #safeMode {
    font-size:
      11px;
  }
}

@media (
  pointer: fine
) {
  #joystick {
    opacity:
      .32;
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
E · 유령 해적선
</span>

</button>

</div>

</div>

<div id="joystick">
<div id="stick"></div>
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

<script src="/socket.io/socket.io.js"></script>

<script>

// ======================================================
// 기본
// ======================================================

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

// ======================================================
// 상태
// ======================================================

let myId =
  null;

let world = {
  width: 5200,
  height: 3400
};

let players = [];
let slimes = [];
let fireballs = [];
let pirateShips = [];

let serverFull =
  false;

let keys =
  new Set();

let joyX = 0;
let joyY = 0;

let joyPointer =
  null;

let cameraX = 0;
let cameraY = 0;

let mouseX =
  innerWidth / 2;

let mouseY =
  innerHeight / 2;

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

let cooldownUntil = {
  mage: 0,
  pirate: 0
};

function cClamp(
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
      '선택됨<br>목표 클릭'
  },

  pirate: {
    name:
      '해적',

    skill:
      '유령 해적선',

    button:
      'E<br>해적선',

    selected:
      '선택됨<br>방향 클릭'
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

mageImage.onerror =
  () => {
    console.error(
      'mage.png 로드 실패'
    );
  };

mageImage.src =
  '/mage.png?v=5';


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
    console.error(
      'pirate.png 로드 실패'
    );
  };

pirateImage.src =
  '/pirate.png?v=5';


const pirateShipImage =
  new Image();

let pirateShipReady =
  false;

pirateShipImage.onload =
  () => {
    pirateShipReady =
      true;
  };

pirateShipImage.onerror =
  () => {
    console.error(
      'pirate_ship.png 로드 실패'
    );
  };

pirateShipImage.src =
  '/pirate_ship.png?v=5';

// ======================================================
// 리사이즈
// ======================================================

function resize() {
  const dpr =
    Math.min(
      devicePixelRatio || 1,
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

  // 현재 이미지들은
  // 픽셀아트보다는 고해상도 RPG 이미지이므로
  // 보간 사용
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
    if (!serverFull) {
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
  'disconnect',
  () => {
    if (!serverFull) {
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

    if (!data.success) {
      skillStateEl.textContent =
        '쿨타임';

      return;
    }

    const avatar =
      data.skill ===
      'pirateShip'
        ? 'pirate'
        : 'mage';

    cooldownUntil[
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
        player.id === myId
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

function isSkillCooling() {
  return (
    performance.now() <
    cooldownUntil[
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
    isSkillCooling()
  ) {
    const remaining =
      Math.max(
        0,
        cooldownUntil[
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
        remaining /
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

  if (
    skillSelected
  ) {
    skillStateEl.textContent =
      selectedAvatar ===
      'mage'
        ? '파이어볼 목표 위치를 클릭'
        : '해적선 발사 방향을 클릭';
  } else if (
    skillStateEl.textContent ===
      '파이어볼 목표 위치를 클릭' ||
    skillStateEl.textContent ===
      '해적선 발사 방향을 클릭'
  ) {
    skillStateEl.textContent =
      '대기';
  }
}

setInterval(
  updateSkillUI,
  100
);

// ======================================================
// 스킬 선택
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
    isSkillCooling()
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
      key === 'escape'
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
// 모바일 조이스틱
// ======================================================

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
// 조준 계산
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

function sendAim() {
  if (
    serverFull
  ) {
    return;
  }

  let aim =
    null;

  // PC = 마우스
  if (
    mouseAimActive
  ) {
    aim =
      aimToScreen(
        mouseX,
        mouseY
      );
  }

  // 모바일 = 조이스틱 방향
  if (
    !aim &&
    (
      Math.abs(joyX) >
        0.08 ||
      Math.abs(joyY) >
        0.08
    )
  ) {
    const length =
      Math.hypot(
        joyX,
        joyY
      );

    aim = {
      x:
        joyX /
        length,

      y:
        joyY /
        length
    };
  }

  if (!aim) {
    return;
  }

  if (
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
// 스킬 사용
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
    isSkillCooling()
  ) {
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

  const aim =
    aimToScreen(
      screenX,
      screenY
    );

  if (aim) {
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

    castSkillAt(
      event.clientX,
      event.clientY
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
      Math.abs(joyX) >
        0.08 ||
      Math.abs(joyY) >
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
      x /= length;
      y /= length;
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

    sendAim();
  },

  33
);

// ======================================================
// 화면 안인지
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

// ======================================================
// 랜덤 고정값
// ======================================================

function hashRand(n) {
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

  // 길
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
      x - cx;

    const sy =
      y - cy;

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

    ctx.beginPath();

    ctx.arc(
      sx -
      size * .25,
      sy -
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
    i < 170;
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

function characterDirectionRow(
  direction
) {
  // 캐릭터 PNG
  //
  // 0 = 아래 / 앞
  // 1 = 위 / 뒤
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

// ======================================================
// 셀 계산
//
// 수동 크롭 좌표 사용 안 함.
// PNG 전체를 3열×4행으로 정확하게 분리.
//
// mage.png = 1024×1536처럼
// 3으로 딱 나눠지지 않는 이미지도
// Math.round 경계값을 사용하므로
// 옆 캐릭터가 섞이지 않음.
// ======================================================

function getGridCell(
  image,
  columns,
  rows,
  column,
  row
) {
  const x1 =
    Math.round(
      column *
      image.width /
      columns
    );

  const x2 =
    Math.round(
      (
        column + 1
      ) *
      image.width /
      columns
    );

  const y1 =
    Math.round(
      row *
      image.height /
      rows
    );

  const y2 =
    Math.round(
      (
        row + 1
      ) *
      image.height /
      rows
    );

  return {
    x:
      x1,

    y:
      y1,

    w:
      x2 -
      x1,

    h:
      y2 -
      y1
  };
}

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
    characterDirectionRow(
      player.direction
    );

  const column =
    walkFrame(
      player
    );

  let image;
  let ready;
  let drawWidth;
  let drawHeight;

  if (
    player.avatar ===
    'pirate'
  ) {
    image =
      pirateImage;

    ready =
      pirateReady;

    // pirate.png는 정사각형 셀
    drawWidth =
      145;

    drawHeight =
      145;
  } else {
    image =
      mageImage;

    ready =
      mageReady;

    // mage.png 셀 비율에 맞춤
    drawWidth =
      136;

    drawHeight =
      154;
  }

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
    ready
  ) {
    const cell =
      getGridCell(
        image,
        3,
        4,
        column,
        row
      );

    /*
      중요

      매 프레임:
      - 같은 출력 가로 크기
      - 같은 출력 세로 크기
      - 같은 중심 X
      - 같은 바닥 Y

      로 출력.

      그래서 프레임마다 중심축이
      튀는 문제를 크게 줄임.
    */

    const FOOT_Y =
      34;

    ctx.drawImage(
      image,

      cell.x,
      cell.y,
      cell.w,
      cell.h,

      -drawWidth / 2,

      FOOT_Y -
      drawHeight,

      drawWidth,
      drawHeight
    );
  } else {
    ctx.fillStyle =
      player.avatar ===
        'pirate'
        ? '#9f342f'
        : '#6743a5';

    ctx.fillRect(
      -22,
      -44,
      44,
      44
    );
  }

  ctx.restore();

  // 캐릭터 주변 원 없음

  ctx.fillStyle =
    'rgba(0,0,0,.45)';

  ctx.fillRect(
    screenX - 34,
    screenY - 82,
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

    screenY - 69
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
    slime.boss
      ? 76
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
    'rgba(0,0,0,.24)';

  ctx.fill();

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
      '#a9233c';
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

  // 광택
  ctx.beginPath();

  ctx.ellipse(
    -radius * .28,
    -radius * .28,
    radius * .2,
    radius * .12,
    -.4,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(255,255,255,.22)';

  ctx.fill();

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

    const size =
      slime.boss
        ? 22
        : 13;

    ctx.fillStyle =
      '#ffd259';

    ctx.beginPath();

    ctx.moveTo(
      -size,
      crownY
    );

    ctx.lineTo(
      -size * .6,
      crownY -
      size
    );

    ctx.lineTo(
      0,
      crownY -
      size * .4
    );

    ctx.lineTo(
      size * .6,
      crownY -
      size
    );

    ctx.lineTo(
      size,
      crownY
    );

    ctx.closePath();

    ctx.fill();
  }

  ctx.restore();

  // ==============================
  // HP바
  // ==============================

  const barWidth =
    slime.boss
      ? 180
      : slime.elite
        ? 68
        : 48;

  const hpPercent =
    Math.max(
      0,
      slime.hp /
      slime.maxHp
    );

  const hpY =
    y -
    radius -
    (
      slime.boss
        ? 43
        : 22
    );

  ctx.fillStyle =
    'rgba(0,0,0,.7)';

  ctx.fillRect(
    x -
    barWidth / 2,
    hpY,
    barWidth,
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
    barWidth / 2 +
    2,

    hpY + 2,

    (
      barWidth -
      4
    ) *
    hpPercent,

    slime.boss
      ? 9
      : 3
  );

  if (
    slime.boss
  ) {
    ctx.fillStyle =
      '#ffd6db';

    ctx.font =
      '900 16px system-ui';

    ctx.textAlign =
      'center';

    ctx.fillText(
      '👑 BOSS SLIME',
      x,
      hpY - 10
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
      hpY - 6
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
    '#ff6518';

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
// 유령 해적선 PNG
//
// pirate_ship.png
// 실제 크기: 1402 × 1122
//
// 5열 × 4행
//
// 0행 = 아래 ↓
// 1행 = 위   ↑
// 2행 = 왼쪽 ←
// 3행 = 오른쪽 →
//
// 각 방향 5프레임
// ======================================================

function pirateShipRow(
  direction
) {
  if (
    direction === 'up'
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

function pirateShipFrame(
  ship
) {
  // 각 배마다 시작 프레임 약간 분산
  return (
    Math.floor(
      performance.now() /
      115 +
      ship.id *
      0.4
    ) %
    5
  );
}

function drawPirateShip(
  ship,
  cx,
  cy
) {
  if (
    !pirateShipReady
  ) {
    return;
  }

  const x =
    ship.x -
    cx;

  const y =
    ship.y -
    cy;

  const row =
    pirateShipRow(
      ship.direction
    );

  const column =
    pirateShipFrame(
      ship
    );

  const cell =
    getGridCell(
      pirateShipImage,
      5,
      4,
      column,
      row
    );

  /*
    이미지 전체 셀 크기를 일정하게 사용.
    각 프레임마다 크롭 크기가 변하지 않기 때문에
    유령선 중심이 흔들리지 않음.
  */

  const DRAW_SIZE =
    210;

  ctx.save();

  ctx.drawImage(
    pirateShipImage,

    cell.x,
    cell.y,
    cell.w,
    cell.h,

    x -
    DRAW_SIZE / 2,

    y -
    DRAW_SIZE / 2,

    DRAW_SIZE,
    DRAW_SIZE
  );

  ctx.restore();
}

// ======================================================
// 스킬 조준점
// ======================================================

function drawSkillTarget() {
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
      ? 'rgba(110,235,255,.95)'
      : 'rgba(255,125,45,.95)';

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
    mouseX - 19,
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
    mouseX + 19,
    mouseY
  );

  ctx.moveTo(
    mouseX,
    mouseY - 19
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
    mouseY + 19
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

  if (me) {
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

  // 맵
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
        170,
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
        60,
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

  // 유령 해적선
  for (
    const ship
    of pirateShips
  ) {
    if (
      visible(
        ship.x,
        ship.y,
        220,
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

  // 플레이어
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
        190,
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

  drawSkillTarget();
}

render();

</script>

</body>

</html>`);

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
      'SAFE MODE: ON'
    );

    console.log(
      'Boss target: ' +
      BOSS_KILL_TARGET
    );
  }
);

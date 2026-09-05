const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ======================================================
// 기본 설정
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
// 몬스터
// ======================================================

const NORMAL_SLIMES = 28;
const ELITE_SLIMES = 4;

const SLIME_RESPAWN_MS = 5000;

// 일반 = 1점
// 엘리트 = 2점
// 20점 = 보스 출현
const BOSS_TARGET = 20;

const BOSS_HP = 1200;

// ======================================================
// 마법사 E - 영혼불
// ======================================================

const SOUL_FIRE_SPEED = 900;
const SOUL_FIRE_DAMAGE = 60;
const SOUL_FIRE_RADIUS = 15;
const SOUL_FIRE_LIFE = 1.5;
const SOUL_FIRE_COOLDOWN = 900;

// ======================================================
// 해적 E - 슬래시
// ======================================================

const SLASH_RANGE = 145;

// 총 범위 약 120도
const SLASH_HALF_ANGLE = Math.PI / 3;

const SLASH_DAMAGE = 120;
const SLASH_COOLDOWN = 1000;
const SLASH_EFFECT_LIFE = 0.28;

// ======================================================
// 서버 상태
// ======================================================

const players = new Map();
const slimes = new Map();

const soulFires = new Map();
const slashEffects = new Map();

let nextSlimeId = 1;
let nextSoulFireId = 1;
let nextSlashId = 1;

let bossProgress = 0;
let bossId = null;

// ======================================================
// 공통 함수
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

    lastSoulFireAt: 0,
    lastSlashAt: 0
  };
}

// ======================================================
// 슬라임 AI
// ======================================================

function chooseSlimeDirection(slime) {
  const angle =
    Math.random() *
    Math.PI *
    2;

  let speed;

  if (slime.boss) {
    speed =
      26 +
      Math.random() * 14;
  }

  else if (slime.elite) {
    speed =
      52 +
      Math.random() * 24;
  }

  else {
    speed =
      38 +
      Math.random() * 28;
  }

  slime.vx =
    Math.cos(angle) *
    speed;

  slime.vy =
    Math.sin(angle) *
    speed;

  slime.changeAt =
    Date.now() +
    1000 +
    Math.random() * 2300;
}

// ======================================================
// 일반 / 엘리트 슬라임 생성
// ======================================================

function createSlime(elite = false) {
  const point =
    randomPoint(180);

  const slime = {
    id:
      nextSlimeId++,

    x: point.x,
    y: point.y,

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
// 보스 슬라임 생성
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

    x: point.x,
    y: point.y,

    elite: false,
    boss: true,

    radius: 78,

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
    'bossSpawned',
    {
      x:
        boss.x,

      y:
        boss.y
    }
  );
}

// ======================================================
// 슬라임 부활
// ======================================================

function respawnSlime(slime) {
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
// 보스 게이지
// ======================================================

function addBossProgress(slime) {
  // 보스가 살아있는 동안
  // 다음 게이지는 올라가지 않음
  if (
    bossId !== null
  ) {
    return;
  }

  if (
    slime.elite
  ) {
    bossProgress += 2;
  }

  else {
    bossProgress += 1;
  }

  if (
    bossProgress >=
    BOSS_TARGET
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

  // ==================================================
  // 보스
  // ==================================================

  if (
    slime.boss
  ) {
    slime.hp = 0;
    slime.alive = false;

    slimes.delete(
      slime.id
    );

    bossId = null;
    bossProgress = 0;

    // 모든 플레이어에게 클리어 이벤트
    io.emit(
      'bossDefeated'
    );

    return;
  }

  // ==================================================
  // 일반 / 엘리트
  // ==================================================

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
// 마법사 - 영혼불
// ======================================================

function castSoulFire(
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
    player.lastSoulFireAt <
    SOUL_FIRE_COOLDOWN
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

  dx /= length;
  dy /= length;

  player.lastSoulFireAt =
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
    nextSoulFireId++;

  soulFires.set(
    id,
    {
      id,

      ownerId:
        player.id,

      x:
        player.x +
        dx * 43,

      y:
        player.y +
        dy * 43,

      vx:
        dx *
        SOUL_FIRE_SPEED,

      vy:
        dy *
        SOUL_FIRE_SPEED,

      radius:
        SOUL_FIRE_RADIUS,

      life:
        SOUL_FIRE_LIFE
    }
  );

  return true;
}

// ======================================================
// 해적 - 즉발 슬래시
// ======================================================

function castSlash(
  player,
  aimData = null
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
    player.lastSlashAt <
    SLASH_COOLDOWN
  ) {
    return false;
  }

  // 클라이언트가 현재 마우스 방향을 같이 보내면
  // 그것을 우선 사용
  if (
    aimData &&
    Number.isFinite(
      Number(aimData.x)
    ) &&
    Number.isFinite(
      Number(aimData.y)
    )
  ) {
    let ax =
      Number(aimData.x);

    let ay =
      Number(aimData.y);

    const len =
      Math.hypot(
        ax,
        ay
      );

    if (
      len >
      0.001
    ) {
      player.aimX =
        ax / len;

      player.aimY =
        ay / len;
    }
  }

  let aimX =
    player.aimX;

  let aimY =
    player.aimY;

  let aimLength =
    Math.hypot(
      aimX,
      aimY
    );

  if (
    aimLength <
    0.001
  ) {
    aimX = 0;
    aimY = 1;
    aimLength = 1;
  }

  aimX /= aimLength;
  aimY /= aimLength;

  player.lastSlashAt =
    now;

  player.direction =
    directionFromVector(
      aimX,
      aimY,
      player.direction
    );

  // ==================================================
  // 슬래시 이펙트 생성
  // ==================================================

  const slashId =
    nextSlashId++;

  slashEffects.set(
    slashId,
    {
      id:
        slashId,

      ownerId:
        player.id,

      x:
        player.x,

      y:
        player.y,

      aimX,
      aimY,

      angle:
        Math.atan2(
          aimY,
          aimX
        ),

      life:
        SLASH_EFFECT_LIFE
    }
  );

  // ==================================================
  // 전방 부채꼴 공격
  // ==================================================

  const minimumDot =
    Math.cos(
      SLASH_HALF_ANGLE
    );

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
      player.x;

    const dy =
      slime.y -
      player.y;

    const distance =
      Math.hypot(
        dx,
        dy
      );

    if (
      distance >
      SLASH_RANGE +
      slime.radius
    ) {
      continue;
    }

    // 아주 가까운 적은
    // 방향 상관없이 공격
    if (
      distance >
      25
    ) {
      const nx =
        dx /
        distance;

      const ny =
        dy /
        distance;

      const dot =
        nx * aimX +
        ny * aimY;

      if (
        dot <
        minimumDot
      ) {
        continue;
      }
    }

    slime.hp -=
      SLASH_DAMAGE;

    if (
      slime.hp <=
      0
    ) {
      killSlime(
        slime,
        now
      );
    }
  }

  return true;
}

// ======================================================
// 멀티플레이
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

        soulFireCooldown:
          SOUL_FIRE_COOLDOWN,

        slashCooldown:
          SLASH_COOLDOWN
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

    // ==================================================
    // 시선
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

    // ==================================================
    // 캐릭터 변경
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
    // 마법사 영혼불
    // ==================================================

    socket.on(
      'castSoulFire',
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

        const success =
          castSoulFire(
            player,
            data.targetX,
            data.targetY
          );

        socket.emit(
          'skillCastResult',
          {
            success,

            skill:
              'soulFire',

            cooldown:
              SOUL_FIRE_COOLDOWN
          }
        );
      }
    );

    // ==================================================
    // 해적 슬래시
    // ==================================================

    socket.on(
      'castSlash',
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

        const success =
          castSlash(
            player,
            data.aim
          );

        socket.emit(
          'skillCastResult',
          {
            success,

            skill:
              'slash',

            cooldown:
              SLASH_COOLDOWN
          }
        );
      }
    );

    // ==================================================
    // 종료
    // ==================================================

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
// 게임 루프
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

    // ==================================================
    // 영혼불
    // ==================================================

    for (
      const fire
      of [
        ...soulFires.values()
      ]
    ) {
      fire.x +=
        fire.vx *
        dt;

      fire.y +=
        fire.vy *
        dt;

      fire.life -=
        dt;

      if (
        fire.life <=
          0 ||
        fire.x <
          -60 ||
        fire.x >
          WORLD.width +
          60 ||
        fire.y <
          -60 ||
        fire.y >
          WORLD.height +
          60
      ) {
        soulFires.delete(
          fire.id
        );

        continue;
      }

      // 안전모드:
      // 플레이어 공격 판정 없음
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
          fire.x;

        const dy =
          slime.y -
          fire.y;

        const hit =
          slime.radius +
          fire.radius;

        if (
          dx * dx +
          dy * dy <=
          hit * hit
        ) {
          slime.hp -=
            SOUL_FIRE_DAMAGE;

          soulFires.delete(
            fire.id
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
    // 슬래시 이펙트 수명
    // ==================================================

    for (
      const slash
      of [
        ...slashEffects.values()
      ]
    ) {
      slash.life -=
        dt;

      if (
        slash.life <=
        0
      ) {
        slashEffects.delete(
          slash.id
        );
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

        soulFires:
          [
            ...soulFires.values()
          ].map(
            fire => ({
              id:
                fire.id,

              x:
                fire.x,

              y:
                fire.y
            })
          ),

        slashEffects:
          [
            ...slashEffects.values()
          ].map(
            slash => ({
              id:
                slash.id,

              x:
                slash.x,

              y:
                slash.y,

              angle:
                slash.angle,

              life:
                slash.life
            })
          ),

        bossProgress,

        bossTarget:
          BOSS_TARGET,

        bossActive:
          bossId !== null
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

  cursor: default;
}

body.skill-selected canvas {
  cursor: crosshair;
}

/* ======================================================
   HUD
====================================================== */

#hud {
  position: fixed;

  left: 12px;
  top: 12px;

  z-index: 20;

  color: white;

  background:
    rgba(8,14,8,.78);

  border:
    1px solid
    rgba(255,255,255,.16);

  border-radius:
    12px;

  padding:
    10px 13px;

  line-height:
    1.55;

  font-size:
    14px;

  backdrop-filter:
    blur(6px);

  pointer-events: none;
}

#status {
  font-weight: 900;
}

#skillName,
#skillState {
  color: #78f5ff;

  font-weight: 900;
}

#bossProgress {
  color: #ffb5b5;

  font-weight: 900;
}

/* ======================================================
   보스 위치
====================================================== */

#bossLocator {
  position: fixed;

  top: 12px;
  left: 50%;

  transform:
    translateX(-50%);

  z-index: 60;

  display: none;

  min-width: 270px;

  padding:
    9px 14px;

  color: #fff4c7;

  background:
    rgba(112,18,27,.94);

  border:
    2px solid
    rgba(255,90,100,.8);

  border-radius:
    12px;

  text-align: center;

  font-size: 13px;

  font-weight: 900;

  pointer-events: none;
}

/* ======================================================
   안전모드
====================================================== */

#safeMode {
  position: fixed;

  top: 12px;
  right: 12px;

  z-index: 50;

  color: #e1ffe6;

  background:
    rgba(18,90,40,.94);

  border:
    2px solid
    rgba(118,255,153,.78);

  border-radius:
    12px;

  padding:
    9px 13px;

  font-size: 13px;

  font-weight: 900;

  text-align: center;

  pointer-events: none;
}

#safeMode small {
  display: block;

  margin-top: 2px;

  font-size: 10px;

  opacity: .85;
}

/* ======================================================
   캐릭터 선택
====================================================== */

#avatarPanel {
  position: fixed;

  right: 12px;
  top: 76px;

  z-index: 25;

  width: 205px;

  color: white;

  background:
    rgba(8,14,8,.8);

  border:
    1px solid
    rgba(255,255,255,.16);

  border-radius:
    12px;

  padding: 10px;

  backdrop-filter:
    blur(6px);
}

#avatarTitle {
  margin-bottom: 8px;

  font-weight: 900;
}

#avatarGrid {
  display: grid;

  gap: 8px;
}

.avatarBtn {
  border:
    2px solid
    rgba(255,255,255,.13);

  border-radius:
    10px;

  background:
    rgba(255,255,255,.06);

  color: white;

  padding: 9px;

  text-align: left;

  font: inherit;

  cursor: pointer;
}

.avatarBtn.selected {
  border-color: #7cf8ff;

  background:
    rgba(80,230,255,.12);
}

.avatarBtn b {
  display: block;
}

.avatarBtn span {
  display: block;

  margin-top: 2px;

  font-size: 11px;

  opacity: .82;
}

/* ======================================================
   조이스틱
====================================================== */

#joystick {
  position: fixed;

  left: 22px;
  bottom: 22px;

  z-index: 30;

  width: 145px;
  height: 145px;

  border:
    2px solid
    rgba(255,255,255,.36);

  border-radius:
    50%;

  background:
    rgba(0,0,0,.25);

  touch-action: none;
}

#stick {
  position: absolute;

  left: 46px;
  top: 46px;

  width: 52px;
  height: 52px;

  border-radius:
    50%;

  background:
    rgba(255,255,255,.84);

  pointer-events: none;
}

/* ======================================================
   E 스킬
====================================================== */

#skillE {
  position: fixed;

  right: 28px;
  bottom: 30px;

  z-index: 30;

  width: 108px;
  height: 108px;

  border:
    3px solid
    rgba(108,246,255,.88);

  border-radius:
    50%;

  background:
    rgba(12,97,112,.92);

  color: white;

  font:
    900 15px
    system-ui;

  cursor: pointer;

  touch-action: none;

  box-shadow:
    0 0 18px
    rgba(72,235,255,.25);
}

#skillE.pirate {
  border-color: #ffd98a;

  background:
    rgba(126,63,27,.94);

  box-shadow:
    0 0 18px
    rgba(255,190,70,.25);
}

#skillE.selected {
  box-shadow:
    0 0 0 5px
    rgba(70,240,255,.2),

    0 0 28px
    rgba(45,230,255,.75);
}

#skillE.cooling {
  opacity: .5;
}

#tip {
  position: fixed;

  right: 16px;
  bottom: 150px;

  z-index: 20;

  color: white;

  background:
    rgba(0,0,0,.42);

  padding:
    7px 10px;

  border-radius:
    9px;

  font-size: 12px;

  pointer-events: none;
}

/* ======================================================
   보스 클리어
====================================================== */

#clearMessage {
  position: fixed;

  inset: 0;

  z-index: 1000;

  display: none;

  align-items: center;
  justify-content: center;

  background:
    rgba(0,0,0,.42);

  pointer-events: none;
}

#clearMessage.active {
  display: flex;

  animation:
    clearBackground .25s ease-out;
}

#clearBox {
  text-align: center;

  transform:
    scale(1);

  animation:
    clearPop .45s ease-out;
}

#clearTitle {
  color: #ffe477;

  font-size:
    clamp(
      64px,
      12vw,
      150px
    );

  font-weight: 1000;

  letter-spacing: 8px;

  text-shadow:
    0 4px 0 #8b571b,
    0 8px 25px rgba(0,0,0,.9),
    0 0 30px rgba(255,220,80,.5);
}

#clearSub {
  margin-top: 10px;

  color: white;

  font-size:
    clamp(
      18px,
      3vw,
      32px
    );

  font-weight: 900;

  text-shadow:
    0 3px 12px
    rgba(0,0,0,.9);
}

@keyframes clearPop {
  0% {
    opacity: 0;

    transform:
      scale(.45);
  }

  65% {
    opacity: 1;

    transform:
      scale(1.12);
  }

  100% {
    transform:
      scale(1);
  }
}

@keyframes clearBackground {
  from {
    background:
      rgba(0,0,0,0);
  }

  to {
    background:
      rgba(0,0,0,.42);
  }
}

@media (
  max-width: 700px
) {
  #avatarPanel {
    width: 170px;
  }

  #bossLocator {
    top: 67px;

    min-width:
      220px;

    font-size:
      11px;
  }

  #safeMode {
    font-size: 11px;
  }
}

@media (
  pointer: fine
) {
  #joystick {
    opacity: .32;
  }
}

</style>

</head>

<body>

<canvas id="game"></canvas>

<!-- ====================================================
     보스 클리어
==================================================== -->

<div id="clearMessage">

  <div id="clearBox">

    <div id="clearTitle">
      CLEAR!
    </div>

    <div id="clearSub">
      👑 보스 슬라임 처치 완료
    </div>

  </div>

</div>

<!-- ====================================================
     HUD
==================================================== -->

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
영혼불
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

<!-- ====================================================
     보스 위치
==================================================== -->

<div id="bossLocator">
👑 BOSS 위치
</div>

<!-- ====================================================
     안전 모드
==================================================== -->

<div id="safeMode">

🛡️ 안전 모드 ON

<small>
플레이어 공격 불가
</small>

</div>

<!-- ====================================================
     캐릭터 선택
==================================================== -->

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
E · 영혼불
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
E · 즉발 슬래시
</span>

</button>

</div>

</div>

<!-- ====================================================
     모바일 조이스틱
==================================================== -->

<div id="joystick">

<div id="stick">
</div>

</div>

<!-- ====================================================
     스킬 버튼
==================================================== -->

<button
id="skillE"
type="button"
>

E
<br>
영혼불

</button>

<div id="tip">

마법사: E → 위치 클릭
/
해적: E → 즉시 슬래시

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

const bossLocatorEl =
  document.getElementById(
    'bossLocator'
  );

const clearMessageEl =
  document.getElementById(
    'clearMessage'
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
// 클라이언트 상태
// ======================================================

let myId =
  null;

let world = {
  width: 5200,
  height: 3400
};

let players = [];
let slimes = [];

let soulFires = [];
let slashEffects = [];

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

let soulFireCooldown =
  900;

let slashCooldown =
  1000;

let clearMessageTimer =
  null;

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
    statusEl.textContent =
      'mage.png 로드 실패';
  };

mageImage.src =
  '/mage.png?v=40';


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
      'pirate.png 로드 실패';
  };

pirateImage.src =
  '/pirate.png?v=40';

// ======================================================
// 화면 크기
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
// 서버 이벤트
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

    soulFireCooldown =
      data.soulFireCooldown;

    slashCooldown =
      data.slashCooldown;

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

    soulFires =
      data.soulFires ||
      [];

    slashEffects =
      data.slashEffects ||
      [];

    if (
      data.bossActive
    ) {
      bossProgressEl.textContent =
        '👑 보스 전투중';
    }

    else {
      bossProgressEl.textContent =
        data.bossProgress +
        ' / ' +
        data.bossTarget;
    }
  }
);

socket.on(
  'bossSpawned',
  data => {
    skillStateEl.textContent =
      '👑 보스 슬라임 출현!';

    bossLocatorEl.style.display =
      'block';

    bossLocatorEl.textContent =
      '👑 BOSS · X ' +
      Math.round(
        data.x
      ) +
      ' · Y ' +
      Math.round(
        data.y
      );
  }
);

// ======================================================
// 보스 처치 → CLEAR!
// ======================================================

socket.on(
  'bossDefeated',
  () => {
    skillStateEl.textContent =
      '🏆 보스 처치!';

    bossLocatorEl.style.display =
      'none';

    clearMessageEl.classList.remove(
      'active'
    );

    // 애니메이션을 다시 시작시키기 위한 강제 리플로우
    void clearMessageEl.offsetWidth;

    clearMessageEl.classList.add(
      'active'
    );

    if (
      clearMessageTimer
    ) {
      clearTimeout(
        clearMessageTimer
      );
    }

    clearMessageTimer =
      setTimeout(
        () => {
          clearMessageEl.classList.remove(
            'active'
          );

          skillStateEl.textContent =
            '대기';
        },

        3000
      );
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
      'slash'
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
// 플레이어 / 보스
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

function getBoss() {
  return (
    slimes.find(
      slime =>
        slime.boss &&
        slime.alive
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
  // ==================================================
  // 해적
  // ==================================================

  if (
    selectedAvatar ===
    'pirate'
  ) {
    currentAvatarNameEl.textContent =
      '해적';

    skillNameEl.textContent =
      '슬래시';

    skillE.classList.add(
      'pirate'
    );

    if (
      isSkillCooling()
    ) {
      const remain =
        Math.max(
          0,

          cooldownUntil.pirate -
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

    skillE.classList.remove(
      'selected'
    );

    skillE.innerHTML =
      'E<br>슬래시';

    return;
  }

  // ==================================================
  // 마법사
  // ==================================================

  currentAvatarNameEl.textContent =
    '마법사';

  skillNameEl.textContent =
    '영혼불';

  skillE.classList.remove(
    'pirate'
  );

  if (
    isSkillCooling()
  ) {
    const remain =
      Math.max(
        0,

        cooldownUntil.mage -
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
      ? '선택됨<br>목표 클릭'
      : 'E<br>영혼불';
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
  skillSelected =
    selected;

  document.body.classList.toggle(
    'skill-selected',

    selected &&
    selectedAvatar ===
    'mage'
  );

  updateSkillUI();
}

// ======================================================
// 조준 계산
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

// ======================================================
// 현재 조준값
// ======================================================

function getCurrentAim() {
  if (
    mouseAimActive
  ) {
    const aim =
      aimToScreen(
        mouseX,
        mouseY
      );

    if (
      aim
    ) {
      return aim;
    }
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
    const len =
      Math.hypot(
        joyX,
        joyY
      );

    return {
      x:
        joyX /
        len,

      y:
        joyY /
        len
    };
  }

  const me =
    getMe();

  if (
    me
  ) {
    return {
      x:
        me.direction ===
        'left'
          ? -1
          : me.direction ===
            'right'
            ? 1
            : 0,

      y:
        me.direction ===
        'back'
          ? -1
          : me.direction ===
            'front'
            ? 1
            : 0
    };
  }

  return {
    x: 0,
    y: 1
  };
}

// ======================================================
// E 동작
// ======================================================

function useESkill() {
  if (
    serverFull ||
    waitingForCast
  ) {
    return;
  }

  if (
    isSkillCooling()
  ) {
    skillStateEl.textContent =
      '쿨타임';

    return;
  }

  // ==================================================
  // 해적 = E 누르는 즉시 슬래시
  // ==================================================

  if (
    selectedAvatar ===
    'pirate'
  ) {
    const aim =
      getCurrentAim();

    socket.emit(
      'aim',
      aim
    );

    waitingForCast =
      true;

    socket.emit(
      'castSlash',
      {
        aim
      }
    );

    skillStateEl.textContent =
      '⚔️ 슬래시!';

    return;
  }

  // ==================================================
  // 마법사 = 영혼불 선택
  // ==================================================

  setSkillSelected(
    true
  );

  skillStateEl.textContent =
    '영혼불 목표 위치 클릭';
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
      useESkill();

      event.preventDefault();
    }

    if (
      key === 'escape'
    ) {
      setSkillSelected(
        false
      );

      skillStateEl.textContent =
        '대기';
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

// ======================================================
// E 모바일 버튼
// ======================================================

skillE.addEventListener(
  'pointerdown',
  event => {
    event.preventDefault();
    event.stopPropagation();

    useESkill();
  }
);

// ======================================================
// 시선 전송
// ======================================================

function sendAim() {
  if (
    serverFull
  ) {
    return;
  }

  const aim =
    getCurrentAim();

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
// 영혼불 클릭 발사
// ======================================================

function castSoulFireAt(
  screenX,
  screenY
) {
  if (
    selectedAvatar !==
      'mage' ||
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
    'castSoulFire',
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
      selectedAvatar !==
        'mage' ||
      !skillSelected
    ) {
      return;
    }

    event.preventDefault();

    mouseX =
      event.clientX;

    mouseY =
      event.clientY;

    mouseAimActive =
      true;

    castSoulFireAt(
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
      x /= length;
      y /= length;
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

    sendAim();
  },

  33
);

// ======================================================
// 가시영역
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

    // 그림자
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

    // 줄기
    ctx.fillStyle =
      '#694526';

    ctx.fillRect(
      sx -
      size * .12,
      sy,
      size * .24,
      size * .85
    );

    // 나뭇잎
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
}

// ======================================================
// 캐릭터 걷기
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
  // 앞
  [
    {
      x: 112,
      y: 83,
      w: 220,
      h: 291,
      ax: 120
    },

    {
      x: 384,
      y: 83,
      w: 221,
      h: 291,
      ax: 119.5
    },

    {
      x: 688,
      y: 83,
      w: 220,
      h: 291,
      ax: 120.5
    }
  ],

  // 뒤
  [
    {
      x: 112,
      y: 426,
      w: 212,
      h: 270,
      ax: 120
    },

    {
      x: 384,
      y: 426,
      w: 213,
      h: 270,
      ax: 119.5
    },

    {
      x: 688,
      y: 426,
      w: 212,
      h: 270,
      ax: 120.5
    }
  ],

  // 왼쪽
  [
    {
      x: 119,
      y: 752,
      w: 211,
      h: 269,
      ax: 113
    },

    {
      x: 391,
      y: 752,
      w: 209,
      h: 269,
      ax: 112.5
    },

    {
      x: 695,
      y: 752,
      w: 212,
      h: 269,
      ax: 113.5
    }
  ],

  // 오른쪽
  [
    {
      x: 160,
      y: 1079,
      w: 192,
      h: 263,
      ax: 72
    },

    {
      x: 427,
      y: 1078,
      w: 196,
      h: 264,
      ax: 76.5
    },

    {
      x: 730,
      y: 1078,
      w: 199,
      h: 263,
      ax: 78.5
    }
  ]
];

// ======================================================
// 해적 프레임
// ======================================================

const PIRATE_FRAMES = [
  // 앞
  [
    {
      x: 74,
      y: 30,
      w: 249,
      h: 317,
      ax: 118.5
    },

    {
      x: 422,
      y: 30,
      w: 229,
      h: 311,
      ax: 116
    },

    {
      x: 761,
      y: 30,
      w: 230,
      h: 317,
      ax: 126.5
    }
  ],

  // 뒤
  [
    {
      x: 91,
      y: 384,
      w: 245,
      h: 325,
      ax: 101.5
    },

    {
      x: 431,
      y: 384,
      w: 225,
      h: 318,
      ax: 107
    },

    {
      x: 772,
      y: 384,
      w: 235,
      h: 325,
      ax: 115.5
    }
  ],

  // 왼쪽
  [
    {
      x: 48,
      y: 738,
      w: 289,
      h: 312,
      ax: 144.5
    },

    {
      x: 420,
      y: 738,
      w: 234,
      h: 316,
      ax: 118
    },

    {
      x: 755,
      y: 738,
      w: 265,
      h: 312,
      ax: 132.5
    }
  ],

  // 오른쪽
  [
    {
      x: 67,
      y: 1092,
      w: 270,
      h: 312,
      ax: 125.5
    },

    {
      x: 427,
      y: 1092,
      w: 227,
      h: 316,
      ax: 111
    },

    {
      x: 755,
      y: 1092,
      w: 262,
      h: 313,
      ax: 132.5
    }
  ]
];

// ======================================================
// 캐릭터 렌더
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

  let image;
  let ready;
  let frame;

  if (
    player.avatar ===
    'pirate'
  ) {
    image =
      pirateImage;

    ready =
      pirateReady;

    frame =
      PIRATE_FRAMES[
        row
      ][
        column
      ];
  }

  else {
    image =
      mageImage;

    ready =
      mageReady;

    frame =
      MAGE_FRAMES[
        row
      ][
        column
      ];
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
    const targetHeight =
      128;

    const scale =
      targetHeight /
      frame.h;

    const drawWidth =
      frame.w *
      scale;

    const drawHeight =
      frame.h *
      scale;

    const FOOT_Y =
      31;

    ctx.drawImage(
      image,

      frame.x,
      frame.y,
      frame.w,
      frame.h,

      -frame.ax *
      scale,

      FOOT_Y -
      drawHeight,

      drawWidth,
      drawHeight
    );
  }

  else {
    ctx.fillStyle =
      player.avatar ===
        'pirate'
        ? '#9d302b'
        : '#6743a5';

    ctx.fillRect(
      -22,
      -44,
      44,
      44
    );
  }

  ctx.restore();

  // 이름
  ctx.fillStyle =
    'rgba(0,0,0,.42)';

  ctx.fillRect(
    screenX -
    34,

    screenY -
    84,

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
    71
  );
}

// ======================================================
// 슬라임 렌더
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
      ? 78
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
    radius * .82,
    radius * .27,
    0,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(0,0,0,.24)';

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
      '#b32641';
  }

  else if (
    slime.elite
  ) {
    ctx.fillStyle =
      '#774dd0';
  }

  else {
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
    'rgba(255,255,255,.2)';

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
      4;

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

  // ==================================================
  // HP BAR
  // ==================================================

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
    'rgba(0,0,0,.72)';

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
  }

  else if (
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
// 영혼불 렌더
// ======================================================

function drawSoulFire(
  fire,
  cx,
  cy
) {
  const x =
    fire.x -
    cx;

  const y =
    fire.y -
    cy;

  const time =
    performance.now() /
    100;

  const pulse =
    Math.sin(
      time +
      fire.id
    ) *
    2;

  ctx.save();

  ctx.globalCompositeOperation =
    'lighter';

  // 외곽 시안 빛
  ctx.shadowBlur =
    30;

  ctx.shadowColor =
    '#49f4ff';

  ctx.beginPath();

  ctx.arc(
    x,
    y,
    19 +
    pulse,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    'rgba(40,235,255,.28)';

  ctx.fill();

  // 영혼 꼬리
  ctx.beginPath();

  ctx.moveTo(
    x - 8,
    y + 5
  );

  ctx.quadraticCurveTo(
    x - 20,
    y + 16,
    x - 12,
    y + 31
  );

  ctx.quadraticCurveTo(
    x,
    y + 20,
    x + 8,
    y + 5
  );

  ctx.fillStyle =
    'rgba(20,210,235,.62)';

  ctx.fill();

  // 가운데 불
  ctx.beginPath();

  ctx.arc(
    x,
    y,
    11 +
    pulse * .35,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    '#23dce9';

  ctx.fill();

  // 밝은 핵
  ctx.beginPath();

  ctx.arc(
    x - 2,
    y - 2,
    5.5,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    '#d2ffff';

  ctx.fill();

  // 영혼 입자
  for (
    let i = 0;
    i < 4;
    i++
  ) {
    const angle =
      time * .55 +
      i * 1.57;

    ctx.beginPath();

    ctx.arc(
      x +
      Math.cos(
        angle
      ) *
      18,

      y +
      Math.sin(
        angle
      ) *
      13,

      2.2,

      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      'rgba(185,255,255,.85)';

    ctx.fill();
  }

  ctx.restore();
}

// ======================================================
// 해적 슬래시 렌더
// ======================================================

function drawSlash(
  slash,
  cx,
  cy
) {
  const x =
    slash.x -
    cx;

  const y =
    slash.y -
    cy;

  const lifePercent =
    Math.max(
      0,

      Math.min(
        1,

        slash.life /
        0.28
      )
    );

  const progress =
    1 -
    lifePercent;

  const radius =
    75 +
    progress *
    55;

  ctx.save();

  ctx.translate(
    x,
    y
  );

  ctx.rotate(
    slash.angle
  );

  ctx.globalCompositeOperation =
    'lighter';

  // 큰 검기
  ctx.beginPath();

  ctx.arc(
    0,
    0,
    radius,
    -.7,
    .7
  );

  ctx.strokeStyle =
    'rgba(255,225,140,' +
    lifePercent +
    ')';

  ctx.lineWidth =
    15 *
    lifePercent +
    3;

  ctx.stroke();

  // 흰 중심 검기
  ctx.beginPath();

  ctx.arc(
    0,
    0,
    radius -
    5,
    -.66,
    .66
  );

  ctx.strokeStyle =
    'rgba(255,255,245,' +
    lifePercent +
    ')';

  ctx.lineWidth =
    4;

  ctx.stroke();

  // 주황색 잔광
  ctx.beginPath();

  ctx.arc(
    0,
    0,
    radius -
    18,
    -.53,
    .53
  );

  ctx.strokeStyle =
    'rgba(255,145,40,' +
    (
      lifePercent *
      .85
    ) +
    ')';

  ctx.lineWidth =
    5;

  ctx.stroke();

  ctx.restore();
}

// ======================================================
// 보스 방향 문자
// ======================================================

function bossDirectionText(
  dx,
  dy
) {
  const degree =
    (
      Math.atan2(
        dy,
        dx
      ) *
      180 /
      Math.PI +
      360
    ) %
    360;

  if (
    degree >=
      337.5 ||
    degree <
      22.5
  ) {
    return '→';
  }

  if (
    degree <
    67.5
  ) {
    return '↘';
  }

  if (
    degree <
    112.5
  ) {
    return '↓';
  }

  if (
    degree <
    157.5
  ) {
    return '↙';
  }

  if (
    degree <
    202.5
  ) {
    return '←';
  }

  if (
    degree <
    247.5
  ) {
    return '↖';
  }

  if (
    degree <
    292.5
  ) {
    return '↑';
  }

  return '↗';
}

// ======================================================
// 보스 위치 HUD
// ======================================================

function updateBossLocator() {
  const boss =
    getBoss();

  const me =
    getMe();

  if (
    !boss
  ) {
    bossLocatorEl.style.display =
      'none';

    return;
  }

  bossLocatorEl.style.display =
    'block';

  if (
    !me
  ) {
    bossLocatorEl.textContent =
      '👑 BOSS · X ' +
      Math.round(
        boss.x
      ) +
      ' · Y ' +
      Math.round(
        boss.y
      );

    return;
  }

  const dx =
    boss.x -
    me.x;

  const dy =
    boss.y -
    me.y;

  const distance =
    Math.round(
      Math.hypot(
        dx,
        dy
      )
    );

  bossLocatorEl.textContent =
    '👑 BOSS ' +
    bossDirectionText(
      dx,
      dy
    ) +
    ' · 거리 ' +
    distance +
    ' · X ' +
    Math.round(
      boss.x
    ) +
    ' Y ' +
    Math.round(
      boss.y
    );
}

// ======================================================
// 화면 밖 보스 위치 화살표
// ======================================================

function drawBossGuide() {
  const boss =
    getBoss();

  const me =
    getMe();

  if (
    !boss ||
    !me
  ) {
    return;
  }

  const bossScreenX =
    boss.x -
    cameraX;

  const bossScreenY =
    boss.y -
    cameraY;

  const margin =
    70;

  const inside =
    bossScreenX >
      margin &&

    bossScreenX <
      innerWidth -
      margin &&

    bossScreenY >
      margin &&

    bossScreenY <
      innerHeight -
      margin;

  // 화면 안에 보스가 있으면 강조 원
  if (
    inside
  ) {
    const pulse =
      7 +
      Math.sin(
        performance.now() /
        160
      ) *
      3;

    ctx.save();

    ctx.strokeStyle =
      'rgba(255,65,80,.9)';

    ctx.lineWidth =
      3;

    ctx.beginPath();

    ctx.arc(
      bossScreenX,
      bossScreenY,

      92 +
      pulse,

      0,
      Math.PI * 2
    );

    ctx.stroke();

    ctx.restore();

    return;
  }

  // 화면 밖이면 화살표
  const playerScreenX =
    me.x -
    cameraX;

  const playerScreenY =
    me.y -
    cameraY;

  const dx =
    bossScreenX -
    playerScreenX;

  const dy =
    bossScreenY -
    playerScreenY;

  const angle =
    Math.atan2(
      dy,
      dx
    );

  const centerX =
    innerWidth /
    2;

  const centerY =
    innerHeight /
    2;

  const maxX =
    innerWidth /
    2 -
    margin;

  const maxY =
    innerHeight /
    2 -
    margin;

  const cos =
    Math.cos(
      angle
    );

  const sin =
    Math.sin(
      angle
    );

  const scaleX =
    Math.abs(cos) >
      .001
      ? maxX /
        Math.abs(cos)
      : Infinity;

  const scaleY =
    Math.abs(sin) >
      .001
      ? maxY /
        Math.abs(sin)
      : Infinity;

  const scale =
    Math.min(
      scaleX,
      scaleY
    );

  const arrowX =
    centerX +
    cos *
    scale;

  const arrowY =
    centerY +
    sin *
    scale;

  ctx.save();

  ctx.translate(
    arrowX,
    arrowY
  );

  ctx.rotate(
    angle
  );

  ctx.fillStyle =
    '#ff4355';

  ctx.beginPath();

  ctx.moveTo(
    20,
    0
  );

  ctx.lineTo(
    -12,
    -14
  );

  ctx.lineTo(
    -7,
    0
  );

  ctx.lineTo(
    -12,
    14
  );

  ctx.closePath();

  ctx.fill();

  ctx.rotate(
    -angle
  );

  ctx.fillStyle =
    '#fff';

  ctx.font =
    '900 12px system-ui';

  ctx.textAlign =
    'center';

  ctx.fillText(
    'BOSS',
    0,
    -22
  );

  ctx.restore();
}

// ======================================================
// 영혼불 목표 표시
// ======================================================

function drawSkillTarget() {
  if (
    selectedAvatar !==
      'mage' ||
    !skillSelected ||
    !mouseAimActive
  ) {
    return;
  }

  ctx.save();

  ctx.strokeStyle =
    'rgba(90,245,255,.95)';

  ctx.shadowBlur =
    12;

  ctx.shadowColor =
    '#43efff';

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

  // ==================================================
  // 맵
  // ==================================================

  drawForest(
    cameraX,
    cameraY
  );

  // ==================================================
  // 슬라임
  // ==================================================

  for (
    const slime
    of slimes
  ) {
    if (
      visible(
        slime.x,
        slime.y,
        190,
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

  // ==================================================
  // 영혼불
  // ==================================================

  for (
    const fire
    of soulFires
  ) {
    if (
      visible(
        fire.x,
        fire.y,
        70,
        cameraX,
        cameraY
      )
    ) {
      drawSoulFire(
        fire,
        cameraX,
        cameraY
      );
    }
  }

  // ==================================================
  // 플레이어
  // ==================================================

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

  // ==================================================
  // 슬래시
  // ==================================================

  for (
    const slash
    of slashEffects
  ) {
    if (
      visible(
        slash.x,
        slash.y,
        190,
        cameraX,
        cameraY
      )
    ) {
      drawSlash(
        slash,
        cameraX,
        cameraY
      );
    }
  }

  // ==================================================
  // 보스 안내
  // ==================================================

  updateBossLocator();

  drawBossGuide();

  // ==================================================
  // 영혼불 조준점
  // ==================================================

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
      BOSS_TARGET
    );
  }
);

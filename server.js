const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const WORLD = { width: 2000, height: 1200 };
const PLAYER_RADIUS = 22;
const PLAYER_SPEED = 280; // pixels per second
const TICK_RATE = 30;

const players = new Map();

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function makePlayer(id) {
  return {
    id,
    x: 120 + Math.random() * (WORLD.width - 240),
    y: 120 + Math.random() * (WORLD.height - 240),
    inputX: 0,
    inputY: 0,
  };
}

io.on('connection', (socket) => {
  players.set(socket.id, makePlayer(socket.id));

  socket.emit('welcome', {
    id: socket.id,
    world: WORLD,
  });

  io.emit('count', players.size);

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

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('count', players.size);
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  for (const player of players.values()) {
    player.x += player.inputX * PLAYER_SPEED * dt;
    player.y += player.inputY * PLAYER_SPEED * dt;

    player.x = clamp(player.x, PLAYER_RADIUS, WORLD.width - PLAYER_RADIUS);
    player.y = clamp(player.y, PLAYER_RADIUS, WORLD.height - PLAYER_RADIUS);
  }

  io.emit(
    'state',
    Array.from(players.values(), (p) => ({ id: p.id, x: p.x, y: p.y }))
  );
}, 1000 / TICK_RATE);

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <title>Open Move</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111827; font-family: system-ui, sans-serif; touch-action: none; }
    canvas { display: block; width: 100%; height: 100%; background: #172033; }
    #hud {
      position: fixed; left: 12px; top: 12px; z-index: 10;
      color: white; background: rgba(0,0,0,.42); padding: 9px 12px;
      border-radius: 12px; font-size: 14px; line-height: 1.45;
      backdrop-filter: blur(6px);
    }
    #status { font-weight: 700; }
    #joystick {
      position: fixed; left: 22px; bottom: 22px; width: 138px; height: 138px;
      border-radius: 50%; border: 2px solid rgba(255,255,255,.35);
      background: rgba(255,255,255,.09); z-index: 11;
      touch-action: none;
    }
    #stick {
      position: absolute; left: 44px; top: 44px; width: 50px; height: 50px;
      border-radius: 50%; background: rgba(255,255,255,.72);
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
      pointer-events: none;
    }
    #hint {
      position: fixed; right: 12px; bottom: 12px; z-index: 10;
      color: rgba(255,255,255,.82); background: rgba(0,0,0,.35); padding: 8px 10px;
      border-radius: 10px; font-size: 12px;
    }
    @media (pointer: fine) {
      #joystick { opacity: .35; }
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <div id="hud">
    <div id="status">서버 연결 중...</div>
    <div>접속자: <span id="count">0</span>명</div>
  </div>
  <div id="joystick" aria-label="이동 조이스틱"><div id="stick"></div></div>
  <div id="hint">PC: WASD / 방향키 · 모바일: 왼쪽 조이스틱</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('status');
    const countEl = document.getElementById('count');
    const joystick = document.getElementById('joystick');
    const stick = document.getElementById('stick');

    let myId = null;
    let world = { width: 2000, height: 1200 };
    let players = [];
    let keys = new Set();
    let touchX = 0;
    let touchY = 0;
    let joystickPointer = null;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(innerWidth * dpr);
      canvas.height = Math.floor(innerHeight * dpr);
      canvas.style.width = innerWidth + 'px';
      canvas.style.height = innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    addEventListener('resize', resize);
    resize();

    socket.on('connect', () => {
      statusEl.textContent = '공개 서버 접속됨';
    });
    socket.on('disconnect', () => {
      statusEl.textContent = '서버 연결 끊김 · 재접속 중...';
    });
    socket.on('welcome', (data) => {
      myId = data.id;
      world = data.world;
    });
    socket.on('state', (state) => {
      players = state;
    });
    socket.on('count', (count) => {
      countEl.textContent = count;
    });

    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
        keys.add(k);
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => {
      keys.delete(e.key.toLowerCase());
    });

    function setJoystickFromPoint(clientX, clientY) {
      const r = joystick.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const max = r.width * 0.34;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = dx / len * max;
        dy = dy / len * max;
      }
      touchX = dx / max;
      touchY = dy / max;
      stick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }

    joystick.addEventListener('pointerdown', (e) => {
      joystickPointer = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      setJoystickFromPoint(e.clientX, e.clientY);
    });
    joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId === joystickPointer) setJoystickFromPoint(e.clientX, e.clientY);
    });
    function releaseJoystick(e) {
      if (e.pointerId !== joystickPointer) return;
      joystickPointer = null;
      touchX = 0;
      touchY = 0;
      stick.style.transform = 'translate(0px,0px)';
    }
    joystick.addEventListener('pointerup', releaseJoystick);
    joystick.addEventListener('pointercancel', releaseJoystick);

    let lastSentX = 999;
    let lastSentY = 999;
    setInterval(() => {
      let x = 0;
      let y = 0;
      if (keys.has('a') || keys.has('arrowleft')) x -= 1;
      if (keys.has('d') || keys.has('arrowright')) x += 1;
      if (keys.has('w') || keys.has('arrowup')) y -= 1;
      if (keys.has('s') || keys.has('arrowdown')) y += 1;

      if (Math.abs(touchX) > 0.08 || Math.abs(touchY) > 0.08) {
        x = touchX;
        y = touchY;
      }

      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }

      if (Math.abs(x - lastSentX) > 0.01 || Math.abs(y - lastSentY) > 0.01) {
        socket.emit('input', { x, y });
        lastSentX = x;
        lastSentY = y;
      }
    }, 33);

    function drawGrid(cameraX, cameraY) {
      const spacing = 100;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startX = Math.floor(cameraX / spacing) * spacing;
      const endX = cameraX + innerWidth;
      const startY = Math.floor(cameraY / spacing) * spacing;
      const endY = cameraY + innerHeight;
      for (let x = startX; x <= endX; x += spacing) {
        ctx.moveTo(x - cameraX, 0);
        ctx.lineTo(x - cameraX, innerHeight);
      }
      for (let y = startY; y <= endY; y += spacing) {
        ctx.moveTo(0, y - cameraY);
        ctx.lineTo(innerWidth, y - cameraY);
      }
      ctx.stroke();
    }

    function render() {
      requestAnimationFrame(render);
      ctx.clearRect(0, 0, innerWidth, innerHeight);

      const me = players.find(p => p.id === myId);
      const cameraX = me ? Math.max(0, Math.min(world.width - innerWidth, me.x - innerWidth / 2)) : 0;
      const cameraY = me ? Math.max(0, Math.min(world.height - innerHeight, me.y - innerHeight / 2)) : 0;

      ctx.fillStyle = '#172033';
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      drawGrid(cameraX, cameraY);

      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 4;
      ctx.strokeRect(-cameraX, -cameraY, world.width, world.height);

      for (const p of players) {
        const sx = p.x - cameraX;
        const sy = p.y - cameraY;
        const mine = p.id === myId;

        ctx.beginPath();
        ctx.arc(sx, sy, 22, 0, Math.PI * 2);
        ctx.fillStyle = mine ? '#57d2ff' : '#ffcf67';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = mine ? '#e7fbff' : '#fff4cf';
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.font = '600 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(mine ? 'YOU' : 'P-' + p.id.slice(0,4), sx, sy - 32);
      }
    }
    render();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log(`Open Move server running on port ${PORT}`);
});

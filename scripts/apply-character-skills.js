const fs = require('fs');
const file = require('path').join(__dirname, '..', 'server.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// ARCHER_SKILLS_PATCH_V1')) {
  console.log('Character skills patch already applied');
  process.exit(0);
}

function rep(label, from, to) {
  if (!s.includes(from)) throw new Error('Patch target not found: ' + label);
  s = s.replace(from, to);
}
function reg(label, rx, to) {
  if (!rx.test(s)) throw new Error('Patch pattern not found: ' + label);
  s = s.replace(rx, () => to);
}

rep('patch marker', "const PORT = process.env.PORT || 3000;", "const PORT = process.env.PORT || 3000;\n// ARCHER_SKILLS_PATCH_V1");
rep('avatars', "const AVATARS = ['mage', 'pirate'];", "const AVATARS = ['mage', 'pirate', 'archer'];");
rep('soul radius', 'const SOUL_FIRE_RADIUS = 15;', 'const SOUL_FIRE_RADIUS = 24;');
rep('chain radius', 'const CHAIN_RADIUS = 260;', 'const CHAIN_RADIUS = 340;');
rep('chain cast range', 'const CHAIN_CAST_RANGE = 550;', 'const CHAIN_CAST_RANGE = 800;');
rep('new skill constants',
  'const SOUL_FIRE_COOLDOWN = 900;',
  `const SOUL_FIRE_COOLDOWN = 900;\n\nconst TRIPLE_ARROW_DAMAGE = 38;\nconst TRIPLE_ARROW_RANGE = 950;\nconst TRIPLE_ARROW_SPREAD = 0.14;\nconst TRIPLE_ARROW_COOLDOWN = 850;\nconst ARROW_RAIN_RANGE = 900;\nconst ARROW_RAIN_RADIUS = 190;\nconst ARROW_RAIN_DAMAGE = 24;\nconst ARROW_RAIN_WAVES = 4;\nconst ARROW_RAIN_INTERVAL = 320;\nconst ARROW_RAIN_COOLDOWN = 4800;\nconst GHOST_SHIP_DURATION = 3000;\nconst GHOST_SHIP_SPEED = 520;\nconst GHOST_SHIP_RADIUS = 115;\nconst GHOST_SHIP_DAMAGE = 85;\nconst GHOST_SHIP_COOLDOWN = 6500;`
);

rep('player skill state',
  'lastSoulFireAt: 0, lastSlashAt: 0, lastChainAt: 0, lastPortalAt: 0',
  `lastSoulFireAt: 0, lastSlashAt: 0, lastChainAt: 0, lastTripleArrowAt: 0, lastArrowRainAt: 0, lastGhostShipAt: 0,\n    ghostShipUntil: 0, ghostDirX: 0, ghostDirY: 1, ghostHitKeys: new Set(), lastPortalAt: 0`
);

const combatFunctions = `function lineClearForArrow(map, x1, y1, x2, y2) {
  if (map !== 'forest') return true;
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(distance / 32));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (forestBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 5)) return false;
  }
  return true;
}
function bestArrowTarget(p, dirX, dirY, range) {
  let best = null;
  let bestAlong = Infinity;
  for (const target of getAttackableTargets(p, range + 80)) {
    const vx = target.x - p.x;
    const vy = target.y - p.y;
    const along = vx * dirX + vy * dirY;
    if (along < 0 || along > range) continue;
    const perpendicular = Math.abs(vx * dirY - vy * dirX);
    if (perpendicular > target.radius + 18) continue;
    if (!lineClearForArrow(p.map, p.x, p.y, target.x, target.y)) continue;
    if (along < bestAlong) { bestAlong = along; best = target; }
  }
  return best;
}
function targetsInArea(owner, mapId, x, y, radius) {
  const out = [];
  if (mapId === 'forest') {
    for (const slime of querySlimes(x, y, radius + 90)) {
      const dx = slime.x - x, dy = slime.y - y;
      if (dx * dx + dy * dy <= (radius + slime.radius) * (radius + slime.radius)) {
        out.push({ key: 's:' + slime.id, type: 'slime', x: slime.x, y: slime.y, radius: slime.radius, ref: slime });
      }
    }
  }
  for (const other of players.values()) {
    if (!canPvp(owner, other) || other.map !== mapId) continue;
    const dx = other.x - x, dy = other.y - y;
    if (dx * dx + dy * dy <= (radius + PLAYER_RADIUS) * (radius + PLAYER_RADIUS)) {
      out.push({ key: 'p:' + other.id, type: 'player', x: other.x, y: other.y, radius: PLAYER_RADIUS, ref: other });
    }
  }
  return out;
}
function castSoulFire(p, aimData, autoAim) {
  const blocked = p.avatar !== 'mage' ? 'avatar' : skillBlock(p, p.lastSoulFireAt, SOUL_FIRE_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const a = resolveAim(p, aimData, autoAim, 1000);
  p.lastSoulFireAt = Date.now(); p.aimX = a.x; p.aimY = a.y;
  const id = nextSoulFireId++;
  soulFires.set(id, {
    id, ownerId: p.id, map: p.map,
    x: p.x + a.x * 48, y: p.y + a.y * 48,
    vx: a.x * SOUL_FIRE_SPEED, vy: a.y * SOUL_FIRE_SPEED,
    radius: SOUL_FIRE_RADIUS, life: SOUL_FIRE_LIFE,
    pierce: true, hitKeys: new Set()
  });
  return { success: true };
}
function castTripleArrow(p, aimData, autoAim) {
  const blocked = p.avatar !== 'archer' ? 'avatar' : skillBlock(p, p.lastTripleArrowAt, TRIPLE_ARROW_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(p, aimData, autoAim, TRIPLE_ARROW_RANGE);
  const base = Math.atan2(aim.y, aim.x);
  const angles = [base - TRIPLE_ARROW_SPREAD, base, base + TRIPLE_ARROW_SPREAD];
  p.lastTripleArrowAt = now; p.aimX = aim.x; p.aimY = aim.y;
  for (const angle of angles) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const target = bestArrowTarget(p, dx, dy, TRIPLE_ARROW_RANGE);
    if (target) applyCombatDamage(target, TRIPLE_ARROW_DAMAGE, p, now);
  }
  emitMap(p.map, 'combatEffect', { type: 'tripleArrow', id: nextEffectId++, x: p.x, y: p.y, angles, range: TRIPLE_ARROW_RANGE, life: 0.42 });
  return { success: true };
}
function castArrowRain(p, targetData) {
  const blocked = p.avatar !== 'archer' ? 'avatar' : skillBlock(p, p.lastArrowRainAt, ARROW_RAIN_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  let tx = Number(targetData && targetData.x), ty = Number(targetData && targetData.y);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) { tx = p.x + p.aimX * 600; ty = p.y + p.aimY * 600; }
  const dx = tx - p.x, dy = ty - p.y, distance = Math.hypot(dx, dy);
  if (distance > ARROW_RAIN_RANGE) {
    tx = p.x + dx / distance * ARROW_RAIN_RANGE;
    ty = p.y + dy / distance * ARROW_RAIN_RANGE;
  }
  const map = mapSpec(p.map);
  tx = clamp(tx, 30, map.width - 30); ty = clamp(ty, 30, map.height - 30);
  const rainMap = p.map;
  p.lastArrowRainAt = Date.now();
  emitMap(rainMap, 'combatEffect', { type: 'arrowRain', id: nextEffectId++, x: tx, y: ty, radius: ARROW_RAIN_RADIUS, life: 1.45 });
  for (let wave = 0; wave < ARROW_RAIN_WAVES; wave++) {
    setTimeout(() => {
      if (!players.has(p.id) || !p.alive || p.map !== rainMap) return;
      const now = Date.now();
      for (const target of targetsInArea(p, rainMap, tx, ty, ARROW_RAIN_RADIUS)) applyCombatDamage(target, ARROW_RAIN_DAMAGE, p, now);
    }, wave * ARROW_RAIN_INTERVAL);
  }
  return { success: true };
}
function castGhostShip(p, aimData, autoAim) {
  const blocked = p.avatar !== 'pirate' ? 'avatar' : skillBlock(p, p.lastGhostShipAt, GHOST_SHIP_COOLDOWN);
  if (blocked) return { success: false, reason: blocked };
  const now = Date.now();
  const aim = resolveAim(p, aimData, autoAim, 800);
  p.lastGhostShipAt = now;
  p.ghostShipUntil = now + GHOST_SHIP_DURATION;
  p.ghostDirX = aim.x; p.ghostDirY = aim.y;
  p.ghostHitKeys = new Set();
  p.inputX = 0; p.inputY = 0; p.moving = false;
  return { success: true };
}
function castSlash`;
reg('combat skill functions', /function castSoulFire\(p, aimData, autoAim\) \{[\s\S]*?\n\}\nfunction castSlash/, combatFunctions);

rep('serialize ghost ship',
  "return { id: p.id, map: p.map, x: p.x, y: p.y, direction: p.direction, moving: p.moving, avatar: p.avatar, hp: p.hp, maxHp: p.maxHp, alive: p.alive };",
  "return { id: p.id, map: p.map, x: p.x, y: p.y, direction: p.direction, moving: p.moving, avatar: p.avatar, hp: p.hp, maxHp: p.maxHp, alive: p.alive, ghostShip: p.ghostShipUntil > Date.now(), ghostDirX: p.ghostDirX, ghostDirY: p.ghostDirY };"
);
rep('fire state radius',
  "fires.push({ id: f.id, x: f.x, y: f.y, vx: f.vx, vy: f.vy });",
  "fires.push({ id: f.id, x: f.x, y: f.y, vx: f.vx, vy: f.vy, radius: f.radius });"
);
rep('welcome cooldowns',
  'soulFireCooldown: SOUL_FIRE_COOLDOWN, slashCooldown: SLASH_COOLDOWN, chainCooldown: CHAIN_COOLDOWN,',
  'soulFireCooldown: SOUL_FIRE_COOLDOWN, slashCooldown: SLASH_COOLDOWN, chainCooldown: CHAIN_COOLDOWN, tripleArrowCooldown: TRIPLE_ARROW_COOLDOWN, arrowRainCooldown: ARROW_RAIN_COOLDOWN, ghostShipCooldown: GHOST_SHIP_COOLDOWN,'
);
rep('server skill sockets',
`  socket.on('castChain', data => {
    const r = castChainLightning(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'chain', cooldown: CHAIN_COOLDOWN });
  });`,
`  socket.on('castChain', data => {
    const r = castChainLightning(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'chain', cooldown: CHAIN_COOLDOWN });
  });
  socket.on('castTripleArrow', data => {
    const r = castTripleArrow(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'tripleArrow', cooldown: TRIPLE_ARROW_COOLDOWN });
  });
  socket.on('castArrowRain', data => {
    const r = castArrowRain(p, data && data.target);
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'arrowRain', cooldown: ARROW_RAIN_COOLDOWN });
  });
  socket.on('castGhostShip', data => {
    const r = castGhostShip(p, data && data.aim, !!(data && data.autoAim));
    socket.emit('skillCastResult', { success: r.success, reason: r.reason || null, skill: 'ghostShip', cooldown: GHOST_SHIP_COOLDOWN });
  });`
);
rep('ghost ship physics',
`    const map = mapSpec(p.map);
    if (p.map === 'forest') {
      moveForestEntity(p, p.inputX * PLAYER_SPEED * dt, p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS);
    } else {
      p.x = clamp(p.x + p.inputX * PLAYER_SPEED * dt, PLAYER_RADIUS, map.width - PLAYER_RADIUS);
      p.y = clamp(p.y + p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS, map.height - PLAYER_RADIUS);
    }
    if (isPlayerSafe(p) && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + SAFE_HEAL_PER_SECOND * dt);`,
`    const map = mapSpec(p.map);
    if (p.ghostShipUntil > now) {
      const dx = p.ghostDirX * GHOST_SHIP_SPEED * dt;
      const dy = p.ghostDirY * GHOST_SHIP_SPEED * dt;
      if (p.map === 'forest') moveForestEntity(p, dx, dy, PLAYER_RADIUS);
      else { p.x = clamp(p.x + dx, PLAYER_RADIUS, map.width - PLAYER_RADIUS); p.y = clamp(p.y + dy, PLAYER_RADIUS, map.height - PLAYER_RADIUS); }
      for (const target of getAttackableTargets(p, GHOST_SHIP_RADIUS + 90)) {
        if (p.ghostHitKeys.has(target.key)) continue;
        const ddx = target.x - p.x, ddy = target.y - p.y;
        if (ddx * ddx + ddy * ddy <= (GHOST_SHIP_RADIUS + target.radius) * (GHOST_SHIP_RADIUS + target.radius)) {
          p.ghostHitKeys.add(target.key);
          applyCombatDamage(target, GHOST_SHIP_DAMAGE, p, now);
        }
      }
    } else if (p.map === 'forest') {
      moveForestEntity(p, p.inputX * PLAYER_SPEED * dt, p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS);
    } else {
      p.x = clamp(p.x + p.inputX * PLAYER_SPEED * dt, PLAYER_RADIUS, map.width - PLAYER_RADIUS);
      p.y = clamp(p.y + p.inputY * PLAYER_SPEED * dt, PLAYER_RADIUS, map.height - PLAYER_RADIUS);
    }
    if (isPlayerSafe(p) && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + SAFE_HEAL_PER_SECOND * dt);`
);
rep('pierce slime hit',
  "if (!s.alive) continue;\n        const dx = s.x - fire.x, dy = s.y - fire.y, r = s.radius + fire.radius, d2 = dx * dx + dy * dy;\n        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'slime', ref: s }; }",
  "if (!s.alive || (fire.hitKeys && fire.hitKeys.has('s:' + s.id))) continue;\n        const dx = s.x - fire.x, dy = s.y - fire.y, r = s.radius + fire.radius, d2 = dx * dx + dy * dy;\n        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'slime', ref: s, key: 's:' + s.id }; }"
);
rep('pierce player hit',
  "if (!canPvp(owner, target) || target.map !== fire.map) continue;\n        const dx = target.x - fire.x, dy = target.y - fire.y, r = PLAYER_RADIUS + fire.radius, d2 = dx * dx + dy * dy;\n        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'player', ref: target }; }",
  "if (!canPvp(owner, target) || target.map !== fire.map || (fire.hitKeys && fire.hitKeys.has('p:' + target.id))) continue;\n        const dx = target.x - fire.x, dy = target.y - fire.y, r = PLAYER_RADIUS + fire.radius, d2 = dx * dx + dy * dy;\n        if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; hit = { type: 'player', ref: target, key: 'p:' + target.id }; }"
);
rep('pierce hit handling',
`    if (hit) {
      soulFires.delete(fire.id);
      if (hit.type === 'slime') {
        hit.ref.hp -= SOUL_FIRE_DAMAGE;
        if (hit.ref.hp <= 0) killSlime(hit.ref, now);
      } else if (owner) damagePlayer(hit.ref, SOUL_FIRE_DAMAGE, now, 'pvp');
    }`,
`    if (hit) {
      if (fire.pierce && fire.hitKeys) fire.hitKeys.add(hit.key);
      else soulFires.delete(fire.id);
      if (hit.type === 'slime') {
        hit.ref.hp -= SOUL_FIRE_DAMAGE;
        if (hit.ref.hp <= 0) killSlime(hit.ref, now);
      } else if (owner) damagePlayer(hit.ref, SOUL_FIRE_DAMAGE, now, 'pvp');
    }`
);
rep('archer route',
  "app.get('/pirate.png', (_req, res) => res.sendFile(path.join(__dirname, 'pirate.png')));",
  "app.get('/pirate.png', (_req, res) => res.sendFile(path.join(__dirname, 'pirate.png')));\napp.get('/archer.webp', (_req, res) => res.sendFile(path.join(__dirname, 'archer.webp')));"
);
rep('archer avatar button',
  '<button class="avatarBtn" data-avatar="pirate" type="button"><b>🏴‍☠️ 해적</b><span>E 슬래시</span></button>',
  '<button class="avatarBtn" data-avatar="pirate" type="button"><b>🏴‍☠️ 해적</b><span>E 슬래시 · Q 유령해적선</span></button><button class="avatarBtn" data-avatar="archer" type="button"><b>🏹 궁수</b><span>E 3연발 · Q 화살비</span></button>'
);
rep('client cooldown vars',
  "let soulFireCooldown=900,slashCooldown=1000,chainCooldown=4500,slashRange=145,slashHalfAngle=Math.PI/3,cooldownUntil={mage:0,pirate:0,chain:0},clearTimer=null,deathTimer=null;",
  "let soulFireCooldown=900,slashCooldown=1000,chainCooldown=4500,tripleArrowCooldown=850,arrowRainCooldown=4800,ghostShipCooldown=6500,slashRange=145,slashHalfAngle=Math.PI/3,cooldownUntil={mage:0,pirate:0,chain:0,archer:0,archerQ:0,pirateQ:0},clearTimer=null,deathTimer=null;"
);
rep('archer frames',
  'let mageTextures=null,pirateTextures=null;',
  `const ARCHER_FRAMES=Array.from({length:4},(_,row)=>Array.from({length:3},(_,col)=>({x:col*128,y:row*128,w:128,h:128})));\nlet mageTextures=null,pirateTextures=null,archerTextures=null;`
);
rep('archer asset',
  "try{const mageBase=await PIXI.Assets.load('/mage.png?v=110');const pirateBase=await PIXI.Assets.load('/pirate.png?v=110');mageTextures=MAGE_FRAMES.map(row=>row.map(f=>new PIXI.Texture(mageBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));pirateTextures=PIRATE_FRAMES.map(row=>row.map(f=>new PIXI.Texture(pirateBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));}catch(err){statusEl.textContent='캐릭터 이미지 로드 실패';}",
  "try{const mageBase=await PIXI.Assets.load('/mage.png?v=120');const pirateBase=await PIXI.Assets.load('/pirate.png?v=120');const archerBase=await PIXI.Assets.load('/archer.webp?v=120');mageTextures=MAGE_FRAMES.map(row=>row.map(f=>new PIXI.Texture(mageBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));pirateTextures=PIRATE_FRAMES.map(row=>row.map(f=>new PIXI.Texture(pirateBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));archerTextures=ARCHER_FRAMES.map(row=>row.map(f=>new PIXI.Texture(archerBase.baseTexture,new PIXI.Rectangle(f.x,f.y,f.w,f.h))));}catch(err){statusEl.textContent='캐릭터 이미지 로드 실패';}"
);
reg('make player node', /function makePlayerNode\(p\)\{[\s\S]*?return c;\}/,
`function makePlayerNode(p){
  const c=new PIXI.Container();c.sortableChildren=true;
  const ghost=new PIXI.Container();ghost.zIndex=0;ghost.visible=false;
  const hull=new PIXI.Graphics().beginFill(0x63e6ff,0.22).lineStyle(3,0xa8f6ff,0.65).drawEllipse(0,12,88,34).endFill();
  const mast=new PIXI.Graphics().lineStyle(4,0x8eefff,0.55).moveTo(0,15).lineTo(0,-54).beginFill(0x7bf1ff,0.16).moveTo(3,-50).lineTo(55,-20).lineTo(3,-8).closePath().endFill();
  ghost.addChild(hull,mast);c.addChild(ghost);
  const sprite=new PIXI.Sprite(PIXI.Texture.EMPTY);sprite.zIndex=1;sprite.position.y=30;c.addChild(sprite);
  const hp=createHpBar(62);hp.position.y=-103;hp.zIndex=3;c.addChild(hp);
  const label=new PIXI.Text('',{fontFamily:'system-ui',fontSize:11,fontWeight:'700',fill:0xffffff,stroke:0x111111,strokeThickness:3});label.anchor.set(.5,1);label.position.y=-76;label.zIndex=4;c.addChild(label);
  c.sprite=sprite;c.hp=hp;c.label=label;c.ghostShip=ghost;c.lastFrame='';c.position.set(p.x,p.y);playerLayer.addChild(c);playerNodes.set(p.id,c);playerTargets.set(p.id,{x:p.x,y:p.y});return c;
}`);
reg('update player node', /function updatePlayerNode\(p,dt\)\{[\s\S]*?c\.label\.style\.fill=p\.id===myId\?0xffe082:0xffffff;\}/,
`function updatePlayerNode(p,dt){
  let c=playerNodes.get(p.id);if(!c)c=makePlayerNode(p);let t=playerTargets.get(p.id);t.x=p.x;t.y=p.y;c.x+=(t.x-c.x)*Math.min(1,dt*14);c.y+=(t.y-c.y)*Math.min(1,dt*14);c.visible=p.alive;
  const row=directionRow(p.direction),col=walkFrame(p),key=p.avatar+':'+row+':'+col;
  if(c.lastFrame!==key){c.lastFrame=key;if(p.avatar==='archer'&&archerTextures){c.sprite.texture=archerTextures[row][col];c.sprite.scale.set(1.05);c.sprite.anchor.set(.5,1);}else if(p.avatar==='pirate'&&pirateTextures){const f=PIRATE_FRAMES[row][col];c.sprite.texture=pirateTextures[row][col];c.sprite.scale.set(.39);c.sprite.anchor.set(f.anchorX/f.w,1);}else if(mageTextures){c.sprite.texture=mageTextures[row][col];c.sprite.scale.set(.43);c.sprite.anchor.set(.5,1);}}
  c.ghostShip.visible=!!p.ghostShip;if(p.ghostShip)c.ghostShip.rotation=Math.atan2(p.ghostDirY||0,p.ghostDirX||1);
  const hp=Math.max(0,p.hp/p.maxHp),bar=c.hp.bar;bar.clear().beginFill(hp>.45?0x70e27d:0xff6565).drawRoundedRect(-29,1,58*hp,4,2).endFill();c.label.text=p.id===myId?'YOU':'P-'+p.id.slice(0,4);c.label.style.fill=p.id===myId?0xffe082:0xffffff;
}`);
rep('projectile visual',
  "function makeProjectileNode(f){const g=new PIXI.Graphics().beginFill(0x39e7f1).drawCircle(0,0,11).endFill();if(!lowPower)g.beginFill(0xd2ffff).drawCircle(-2,-2,4).endFill();projectileLayer.addChild(g);projectileNodes.set(f.id,g);return g;}",
  "function makeProjectileNode(f){const size=f.radius>=20?19:11;const g=new PIXI.Graphics().beginFill(0x39e7f1,0.92).drawCircle(0,0,size).endFill();if(!lowPower)g.beginFill(0xd2ffff).drawCircle(-3,-3,Math.max(4,size*.38)).endFill();projectileLayer.addChild(g);projectileNodes.set(f.id,g);return g;}"
);
reg('spawn effects', /function spawnEffect\(e\)\{[\s\S]*?effectNodes\.set\(e\.id,c\);\}/,
`function spawnEffect(e){
  const c=new PIXI.Container();c.started=performance.now();c.life=(e.life||.25)*1000;c.type=e.type;
  if(e.type==='slash'){
    const g=new PIXI.Graphics();g.lineStyle(lowPower?7:11,0xffe18c,0.9).arc(0,0,110,-.7,.7);c.addChild(g);c.position.set(e.x,e.y);c.rotation=e.angle;
  }else if(e.type==='chain'){
    const g=new PIXI.Graphics();g.lineStyle(lowPower?3:5,0xb9ffff,0.9);for(const seg of e.segments||[]){const mx=(seg.x1+seg.x2)/2+Math.sin((e.id+seg.x2)*.13)*10,my=(seg.y1+seg.y2)/2+Math.cos((e.id+seg.y2)*.13)*10;g.moveTo(seg.x1,seg.y1).lineTo(mx,my).lineTo(seg.x2,seg.y2);}c.addChild(g);
  }else if(e.type==='tripleArrow'){
    const g=new PIXI.Graphics();g.lineStyle(5,0xf1e2a2,0.95);for(const angle of e.angles||[]){const ex=Math.cos(angle)*520,ey=Math.sin(angle)*520;g.moveTo(0,0).lineTo(ex,ey);g.beginFill(0xffefb0).drawCircle(ex,ey,5).endFill();}c.addChild(g);c.position.set(e.x,e.y);
  }else if(e.type==='arrowRain'){
    const g=new PIXI.Graphics();g.lineStyle(3,0xd9f0a0,0.55).drawCircle(0,0,e.radius||190);for(let i=0;i<24;i++){const a=(i*2.399)+e.id,r=((i*47)%100)/100*(e.radius||190),x=Math.cos(a)*r,y=Math.sin(a)*r;g.lineStyle(3,0xf5efbd,0.85).moveTo(x-8,y-32).lineTo(x,y+10);g.beginFill(0xd5ba65).drawCircle(x,y+10,3).endFill();}c.addChild(g);c.position.set(e.x,e.y);
  }else{
    const g=new PIXI.Graphics().lineStyle(4,0xff5a46,0.9).drawCircle(0,0,25);c.addChild(g);c.position.set(e.x2,e.y2);
  }
  effectLayer.addChild(c);effectNodes.set(e.id,c);
}`);
reg('set avatar UI', /function setAvatar\(a\)\{[\s\S]*?\}\navatarButtons/,
`function setAvatar(a){
  selectedAvatar=a;socket.emit('setAvatar',{avatar:a});avatarButtons.forEach(b=>b.classList.toggle('selected',b.dataset.avatar===a));chainBtn.classList.remove('hidden');
  if(a==='mage'){currentAvatarNameEl.textContent='마법사';skillNameEl.textContent='영혼불';chainStateEl.textContent='체인 라이트닝';attackLabel.textContent='영혼불';chainBtn.innerHTML='⚡<br>체인';}
  else if(a==='pirate'){currentAvatarNameEl.textContent='해적';skillNameEl.textContent='슬래시';chainStateEl.textContent='유령해적선';attackLabel.textContent='슬래시';chainBtn.innerHTML='👻<br>유령선';}
  else{currentAvatarNameEl.textContent='궁수';skillNameEl.textContent='3연발 화살';chainStateEl.textContent='화살비';attackLabel.textContent='3연발';chainBtn.innerHTML='🏹<br>화살비';}
}
avatarButtons`);
rep('mouse target helper',
  "function attackAim(){return mouseAimActive?(mouseAim()||lastMobileAim):lastMobileAim}function sendAim",
  "function attackAim(){return mouseAimActive?(mouseAim()||lastMobileAim):lastMobileAim}function skillTarget(aim){const me=getMe(),node=me&&playerNodes.get(me.id);if(mouseAimActive)return{x:cameraX+mouseX,y:cameraY+mouseY};if(node&&aim)return{x:node.x+aim.x*620,y:node.y+aim.y*620};return null}function sendAim"
);
rep('client primary secondary',
  "function castPrimary(a,auto){if(serverFull)return;if(currentSafe){skillStateEl.textContent='🛡️ 안전지대에서는 공격 불가';return;}if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.mage)return;socket.emit('castSoulFire',{aim:a,autoAim:!!auto});}else{if(performance.now()<cooldownUntil.pirate)return;socket.emit('castSlash',{aim:a,autoAim:!!auto});}}\nfunction castChain(a,auto){if(serverFull||selectedAvatar!=='mage'||currentSafe)return;if(performance.now()<cooldownUntil.chain)return;socket.emit('castChain',{aim:a,autoAim:!!auto});}function tryPortal",
  "function castPrimary(a,auto){if(serverFull)return;if(currentSafe){skillStateEl.textContent='🛡️ 안전지대에서는 공격 불가';return;}if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.mage)return;socket.emit('castSoulFire',{aim:a,autoAim:!!auto});}else if(selectedAvatar==='pirate'){if(performance.now()<cooldownUntil.pirate)return;socket.emit('castSlash',{aim:a,autoAim:!!auto});}else{if(performance.now()<cooldownUntil.archer)return;socket.emit('castTripleArrow',{aim:a,autoAim:!!auto});}}\nfunction castSecondary(a,auto){if(serverFull||currentSafe)return;if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.chain)return;socket.emit('castChain',{aim:a,autoAim:!!auto});}else if(selectedAvatar==='pirate'){if(performance.now()<cooldownUntil.pirateQ)return;socket.emit('castGhostShip',{aim:a,autoAim:!!auto});}else{if(performance.now()<cooldownUntil.archerQ)return;socket.emit('castArrowRain',{target:skillTarget(a)});}}function tryPortal"
);
rep('welcome client cooldown assignments',
  "soulFireCooldown=d.soulFireCooldown;slashCooldown=d.slashCooldown;chainCooldown=d.chainCooldown;slashRange=d.slashRange;",
  "soulFireCooldown=d.soulFireCooldown;slashCooldown=d.slashCooldown;chainCooldown=d.chainCooldown;tripleArrowCooldown=d.tripleArrowCooldown;arrowRainCooldown=d.arrowRainCooldown;ghostShipCooldown=d.ghostShipCooldown;slashRange=d.slashRange;"
);
reg('skill result client', /socket\.on\('skillCastResult',[\s\S]*?\}\);\naddEventListener\('keydown'/,
`socket.on('skillCastResult',d=>{
  if(!d.success){skillStateEl.textContent=d.reason==='safe'?'🛡️ 안전지대에서는 공격 불가':d.reason==='noTarget'?'대상 없음':d.reason==='dead'?'부활 대기 중':'쿨타임';return;}
  if(d.skill==='soulFire'){cooldownUntil.mage=performance.now()+d.cooldown;skillStateEl.textContent='🩵 관통 영혼불!';}
  else if(d.skill==='slash'){cooldownUntil.pirate=performance.now()+d.cooldown;skillStateEl.textContent='⚔️ 슬래시!';}
  else if(d.skill==='chain'){cooldownUntil.chain=performance.now()+d.cooldown;skillStateEl.textContent='⚡ 강화 체인 라이트닝!';}
  else if(d.skill==='tripleArrow'){cooldownUntil.archer=performance.now()+d.cooldown;skillStateEl.textContent='🏹 3연발 화살!';}
  else if(d.skill==='arrowRain'){cooldownUntil.archerQ=performance.now()+d.cooldown;skillStateEl.textContent='🌧️ 화살비!';}
  else if(d.skill==='ghostShip'){cooldownUntil.pirateQ=performance.now()+d.cooldown;skillStateEl.textContent='👻 유령해적선 돌진!';}
});
addEventListener('keydown'`);
rep('q key handling',
  "if(k==='q'&&selectedAvatar==='mage'&&!e.repeat){const a=mouseAim()||attackAim();if(a){sendAim(a);castChain(a,false);}e.preventDefault();}",
  "if(k==='q'&&!e.repeat){const a=mouseAim()||attackAim();if(a){sendAim(a);castSecondary(a,false);}e.preventDefault();}"
);
rep('mobile q handling',
  "chainBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();const manual=attackDragging&&attackDragAmount>=.2;castChain(manual?{x:attackX,y:attackY}:lastMobileAim,!manual);});",
  "chainBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();const manual=attackDragging&&attackDragAmount>=.2;castSecondary(manual?{x:attackX,y:attackY}:lastMobileAim,!manual);});"
);
reg('q cooldown ui', /setInterval\(\(\)=>\{if\(selectedAvatar!==\'mage\'\)return;[\s\S]*?\},120\);/,
`setInterval(()=>{
  let until=0,label='Q';
  if(selectedAvatar==='mage'){until=cooldownUntil.chain;label='⚡<br>체인';}
  else if(selectedAvatar==='pirate'){until=cooldownUntil.pirateQ;label='👻<br>유령선';}
  else{until=cooldownUntil.archerQ;label='🏹<br>화살비';}
  const r=Math.max(0,until-performance.now());
  if(r>0){chainBtn.classList.add('cooling');chainBtn.innerHTML=(r/1000).toFixed(1);chainStateEl.textContent=(r/1000).toFixed(1)+'초';}
  else{chainBtn.classList.remove('cooling');chainBtn.innerHTML=label;chainStateEl.textContent=selectedAvatar==='mage'?'체인 라이트닝':selectedAvatar==='pirate'?'유령해적선':'화살비';}
},120);`);
rep('attack preview',
  "if(attackDragging&&meNode){if(selectedAvatar==='mage'){preview.lineStyle(4,0x5ffaff,.65).moveTo(meNode.x,meNode.y).lineTo(meNode.x+attackX*430,meNode.y+attackY*430);}else{const angle=Math.atan2(attackY,attackX);preview.beginFill(0xffb137,.15).moveTo(meNode.x,meNode.y).arc(meNode.x,meNode.y,slashRange,angle-slashHalfAngle,angle+slashHalfAngle).lineTo(meNode.x,meNode.y).endFill();}}",
  "if(attackDragging&&meNode){if(selectedAvatar==='mage'){preview.lineStyle(6,0x5ffaff,.65).moveTo(meNode.x,meNode.y).lineTo(meNode.x+attackX*500,meNode.y+attackY*500);}else if(selectedAvatar==='pirate'){const angle=Math.atan2(attackY,attackX);preview.beginFill(0xffb137,.15).moveTo(meNode.x,meNode.y).arc(meNode.x,meNode.y,slashRange,angle-slashHalfAngle,angle+slashHalfAngle).lineTo(meNode.x,meNode.y).endFill();}else{const base=Math.atan2(attackY,attackX);preview.lineStyle(3,0xe8e0a0,.62);for(const off of[-.14,0,.14]){const a=base+off;preview.moveTo(meNode.x,meNode.y).lineTo(meNode.x+Math.cos(a)*500,meNode.y+Math.sin(a)*500);}}}"
);

fs.writeFileSync(file, s);
console.log('Applied archer, upgraded mage, pirate ghost ship, and PNG-free forest patch');

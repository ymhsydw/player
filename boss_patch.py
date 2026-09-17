from pathlib import Path
import re
p=Path('server.js')
s=p.read_text()
if '// BOSS_EVENT_V2' in s:
    raise SystemExit('already patched')
s=s.replace('// LOGIN_BOARD_PERSISTENCE_V1','// LOGIN_BOARD_PERSISTENCE_V1\n// BOSS_EVENT_V2',1)
old="""const AVATARS = ['mage', 'pirate', 'archer'];
const NORMAL_SLIMES = 150;
const ELITE_SLIMES = 25;
const MIN_SLIME_SPAWN_DISTANCE = 125;
const SLIME_RESPAWN_MS = 5000;
const BOSS_TARGET = 20;
const BOSS_HP = 1200;
const BOSS_KEEP_NORMAL = 18;
const BOSS_KEEP_ELITE = 4;

const SLIME_AGGRO = 380;
const ELITE_AGGRO = 480;
const BOSS_AGGRO = 700;
const SLIME_CHASE_SPEED = 125;
const ELITE_CHASE_SPEED = 155;
const BOSS_CHASE_SPEED = 118;
const SLIME_DAMAGE = 10;
const ELITE_DAMAGE = 18;
const BOSS_DAMAGE = 30;
const SLIME_ATTACK_COOLDOWN = 900;
const ELITE_ATTACK_COOLDOWN = 780;
const BOSS_ATTACK_COOLDOWN = 700;"""
new="""const AVATARS = ['mage', 'pirate', 'archer'];
const NORMAL_SLIMES = 110;
const ELITE_SLIMES = 7;
const ELITE_RESPAWN_CHANCE = 0.35;
const MIN_SLIME_SPAWN_DISTANCE = 125;
const SLIME_RESPAWN_MS = 5000;
const BOSS_TARGET = 30;
const HIDDEN_ELITE_TARGET = 20;
const EVENT_WAVE_TARGET = 20;
const EVENT_SAFE_GRACE_MS = 20000;
const MID_BOSS_HP = 520;
const KING_HP = 2400;
const QUEEN_HP = 3900;

const SLIME_AGGRO = 380;
const ELITE_AGGRO = 480;
const MID_BOSS_AGGRO = 760;
const KING_AGGRO = 1500;
const QUEEN_AGGRO = 1750;
const SLIME_CHASE_SPEED = 125;
const ELITE_CHASE_SPEED = 155;
const MID_BOSS_SPEED = 145;
const KING_SPEED = 145;
const QUEEN_SPEED = 178;
const SLIME_DAMAGE = 10;
const ELITE_DAMAGE = 18;
const MID_BOSS_DAMAGE = 24;
const KING_DAMAGE = 36;
const QUEEN_DAMAGE = 44;
const SLIME_ATTACK_COOLDOWN = 900;
const ELITE_ATTACK_COOLDOWN = 780;
const MID_BOSS_ATTACK_COOLDOWN = 720;
const KING_ATTACK_COOLDOWN = 620;
const QUEEN_ATTACK_COOLDOWN = 500;"""
assert old in s,'constants block not found'
s=s.replace(old,new,1)
s=s.replace("let nextEffectId = 1;\nlet bossProgress = 0;\nlet bossId = null;","let nextEffectId = 1;\nlet bossProgress = 0;\nlet eliteProgress = 0;\nlet bossId = null;\nlet bossPhase = 'grind';\nlet waveKills = 0;\nlet safeZoneDropAt = 0;",1)
old="""function isPlayerSafe(p) {
  if (!p || !p.alive) return true;
  const map = mapSpec(p.map);
  if (map.safeAll) return true;
  return p.map === 'forest' && isPointInForestSafeZone(p.x, p.y);
}"""
new="""function forestSafeZoneActive(now = Date.now()) {
  if (bossPhase === 'grind') return true;
  return !(safeZoneDropAt && now >= safeZoneDropAt);
}
function isPlayerSafe(p) {
  if (!p || !p.alive) return true;
  const map = mapSpec(p.map);
  if (map.safeAll) return true;
  return p.map === 'forest' && forestSafeZoneActive() && isPointInForestSafeZone(p.x, p.y);
}"""
assert old in s,'safe block not found'
s=s.replace(old,new,1)
block=r'''function monsterStats(s) {
  if (s.bossType === 'queen') return { aggro: QUEEN_AGGRO, speed: QUEEN_SPEED, damage: QUEEN_DAMAGE, cooldown: QUEEN_ATTACK_COOLDOWN };
  if (s.bossType === 'king') return { aggro: KING_AGGRO, speed: KING_SPEED, damage: KING_DAMAGE, cooldown: KING_ATTACK_COOLDOWN };
  if (s.midBoss) return { aggro: MID_BOSS_AGGRO, speed: MID_BOSS_SPEED, damage: MID_BOSS_DAMAGE, cooldown: MID_BOSS_ATTACK_COOLDOWN };
  if (s.elite) return { aggro: ELITE_AGGRO, speed: ELITE_CHASE_SPEED, damage: ELITE_DAMAGE, cooldown: ELITE_ATTACK_COOLDOWN };
  return { aggro: SLIME_AGGRO, speed: SLIME_CHASE_SPEED, damage: SLIME_DAMAGE, cooldown: SLIME_ATTACK_COOLDOWN };
}
function chooseSlimeDirection(s) {
  const angle = Math.random() * Math.PI * 2;
  const speed = s.boss ? 36 + Math.random() * 18 : s.midBoss ? 52 + Math.random() * 20 : s.elite ? 48 + Math.random() * 26 : 38 + Math.random() * 26;
  s.vx = Math.cos(angle) * speed; s.vy = Math.sin(angle) * speed;
  s.changeAt = Date.now() + 1000 + Math.random() * 2400; s.targetId = null;
}
function createSlime(elite = false, options = {}) {
  const point = Number.isFinite(options.x) && Number.isFinite(options.y) ? { x: options.x, y: options.y } : forestSpawnPoint(170, MIN_SLIME_SPAWN_DISTANCE);
  const bossType = options.bossType || null, midBoss = !!options.midBoss;
  let radius = elite ? 34 : 24, maxHp = elite ? 180 : 60;
  if (midBoss) { radius = 52; maxHp = MID_BOSS_HP; }
  if (bossType === 'king') { radius = 82; maxHp = KING_HP; }
  if (bossType === 'queen') { radius = 94; maxHp = QUEEN_HP; }
  const slime = { id:nextSlimeId++, map:'forest', x:point.x, y:point.y, elite, boss:!!bossType, bossType, midBoss,
    eventMob:!!options.eventMob, marchToCenter:!!options.marchToCenter, radius, maxHp, hp:maxHp,
    vx:0, vy:0, changeAt:0, alive:true, respawnAt:0, targetId:null, lastAttackAt:0, suppressedByBoss:false,
    active:!!options.eventMob || !!bossType, nextPatternAt:Date.now()+2600, patternIndex:0, rageUntil:0, detourUntil:0,
    detourSign:Math.random()<0.5?-1:1 };
  chooseSlimeDirection(slime); slimes.set(slime.id, slime); return slime;
}
function spawnBaselineSlimes(clearFirst = false) {
  if (clearFirst) slimes.clear();
  for (let i=0;i<NORMAL_SLIMES;i++) createSlime(false);
  for (let i=0;i<ELITE_SLIMES;i++) createSlime(true);
  rebuildSlimeGrid();
}
spawnBaselineSlimes();
function clearMonstersForEvent() {
  for (const slime of slimes.values()) { slime.alive=false; slime.hp=0; }
  slimes.clear(); soulFires.clear(); bossId=null; rebuildSlimeGrid();
}
function startInvasionWave() {
  if (bossPhase !== 'grind') return;
  clearMonstersForEvent(); bossPhase='wave'; waveKills=0; safeZoneDropAt=Date.now()+EVENT_SAFE_GRACE_MS;
  const z=MAPS.forest.safeZone;
  const anchors=[{x:z.x,y:360},{x:MAPS.forest.width-420,y:z.y},{x:z.x,y:MAPS.forest.height-360},{x:420,y:z.y}];
  for (const a of anchors) {
    const d=normalize(z.x-a.x,z.y-a.y,0,1), px=-d.y, py=d.x;
    createSlime(false,{x:a.x,y:a.y,midBoss:true,eventMob:true,marchToCenter:true});
    const offs=[-132,-54,54,132], elites=[false,true,true,false];
    for(let i=0;i<4;i++) createSlime(elites[i],{x:a.x+px*offs[i],y:a.y+py*offs[i],eventMob:true,marchToCenter:true});
  }
  rebuildSlimeGrid(); emitMap('forest','bossWaveStarted',{target:EVENT_WAVE_TARGET,safeDropInMs:EVENT_SAFE_GRACE_MS});
}
function startFinalBoss(type) {
  clearMonstersForEvent(); bossPhase=type; if(!safeZoneDropAt) safeZoneDropAt=Date.now()+EVENT_SAFE_GRACE_MS;
  const z=MAPS.forest.safeZone, slime=createSlime(false,{x:z.x,y:520,bossType:type,eventMob:true});
  bossId=slime.id; rebuildSlimeGrid(); emitMap('forest','bossSpawned',{x:slime.x,y:slime.y,map:'forest',type});
}
function finishBossEvent(now,type) {
  clearMonstersForEvent(); bossPhase='grind'; bossProgress=0; eliteProgress=0; waveKills=0; safeZoneDropAt=0;
  spawnBaselineSlimes(); emitMap('forest','bossDefeated',{type});
}
function respawnSlime(slime) {
  if (slime.boss || slime.eventMob || bossPhase!=='grind' || slime.suppressedByBoss) return;
  if (slime.elite && Math.random()>ELITE_RESPAWN_CHANCE) { slime.respawnAt=Date.now()+7000+Math.random()*9000; return; }
  const point=forestSpawnPoint(170,MIN_SLIME_SPAWN_DISTANCE); slime.x=point.x; slime.y=point.y; slime.hp=slime.maxHp; slime.alive=true; slime.respawnAt=0; slime.lastAttackAt=0; slime.active=false; chooseSlimeDirection(slime);
}
function addBossProgress(slime) {
  if (bossPhase!=='grind') return;
  const gain=slime.elite?2:1; bossProgress+=gain; if(slime.elite) eliteProgress+=2;
  if(eliteProgress>=HIDDEN_ELITE_TARGET && bossProgress<BOSS_TARGET){ startFinalBoss('queen'); return; }
  if(bossProgress>=BOSS_TARGET) startInvasionWave();
}
function killSlime(slime,now) {
  if(!slime.alive) return;
  if(slime.bossType==='king'||slime.bossType==='queen'){ const type=slime.bossType; slime.alive=false; slime.hp=0; slimes.delete(slime.id); finishBossEvent(now,type); return; }
  if(bossPhase==='wave'&&slime.eventMob){ slime.alive=false; slime.hp=0; slimes.delete(slime.id); waveKills++; rebuildSlimeGrid(); emitMap('forest','waveProgress',{kills:waveKills,target:EVENT_WAVE_TARGET}); if(waveKills>=EVENT_WAVE_TARGET) startFinalBoss('king'); return; }
  if(bossPhase!=='grind'){ slime.alive=false; slime.hp=0; slimes.delete(slime.id); return; }
  slime.alive=false; slime.hp=0; slime.targetId=null; slime.vx=0; slime.vy=0; slime.active=false; slime.respawnAt=now+(slime.elite?SLIME_RESPAWN_MS*1.8:SLIME_RESPAWN_MS); addBossProgress(slime);
}
'''
s,n=re.subn(r"function monsterStats\(s\) \{.*?\nfunction socketForPlayer\(id\)",block+"\nfunction socketForPlayer(id)",s,count=1,flags=re.S)
assert n==1,'boss block replacement failed'
s=s.replace("function steerAwayFromSafeZone(s, vx, vy, speed) {\n  const z = MAPS.forest.safeZone;","function steerAwayFromSafeZone(s, vx, vy, speed) {\n  if (!forestSafeZoneActive()) return { vx, vy };\n  const z = MAPS.forest.safeZone;",1)
s=s.replace("function constrainSlimeOutsideSafeZone(s) {\n  const z = MAPS.forest.safeZone;","function constrainSlimeOutsideSafeZone(s) {\n  if (!forestSafeZoneActive()) return;\n  const z = MAPS.forest.safeZone;",1)
ai=r'''function bossAreaAttack(s, radius, damage, type, now) {
  emitMap('forest','combatEffect',{type,id:nextEffectId++,x:s.x,y:s.y,radius,life:.7});
  for(const p of players.values()) if(p.alive&&p.map==='forest'&&Math.hypot(p.x-s.x,p.y-s.y)<=radius+PLAYER_RADIUS) damagePlayer(p,damage,now,'monster');
}
function runBossSpecial(s,now) {
  if(!s.bossType||now<s.nextPatternAt) return;
  s.patternIndex=(s.patternIndex+1)%(s.bossType==='queen'?4:3);
  if(s.bossType==='king'){
    if(s.patternIndex===0) bossAreaAttack(s,265,30,'bossSlam',now);
    else if(s.patternIndex===1){s.rageUntil=now+2200;emitMap('forest','combatEffect',{type:'bossRage',id:nextEffectId++,x:s.x,y:s.y,radius:170,life:1});}
    else bossAreaAttack(s,430,20,'bossWave',now);
    s.nextPatternAt=now+4100;
  }else{
    if(s.patternIndex===0) bossAreaAttack(s,320,40,'bossSlam',now);
    else if(s.patternIndex===1) bossAreaAttack(s,540,30,'bossWave',now);
    else if(s.patternIndex===2){s.rageUntil=now+3200;emitMap('forest','combatEffect',{type:'bossRage',id:nextEffectId++,x:s.x,y:s.y,radius:230,life:1.2});}
    else bossAreaAttack(s,700,24,'queenPulse',now);
    s.nextPatternAt=now+3200;
  }
}
function updateMonsterAI(now) {
  for(const s of slimes.values()){
    if(!s.alive) continue;
    if(s.bossType) runBossSpecial(s,now);
    if(bossPhase==='wave'&&s.eventMob&&s.marchToCenter){
      s.active=true;const z=MAPS.forest.safeZone,dx=z.x-s.x,dy=z.y-s.y,dist=Math.max(.001,Math.hypot(dx,dy));
      if(dist>175||forestSafeZoneActive(now)){const stats=monsterStats(s);let ax=dx/dist,ay=dy/dist;if(now<s.detourUntil){const side=s.detourSign||1,tx=-ay*side,ty=ax*side,n=normalize(ax*.35+tx*.94,ay*.35+ty*.94,ax,ay);ax=n.x;ay=n.y;}s.vx=ax*stats.speed;s.vy=ay*stats.speed;s.targetId=null;s.changeAt=now+300;continue;}
    }
    const awake=s.boss?nearestForestPlayer(s,99999,false):nearestForestPlayer(s,MONSTER_ACTIVE_RADIUS,false);
    if(!awake){s.active=false;s.targetId=null;s.vx=0;s.vy=0;continue;}
    const wasActive=s.active;s.active=true;const stats=monsterStats(s),target=nearestForestPlayer(s,stats.aggro,true);
    if(!target){if(!wasActive||now>=s.changeAt||s.targetId!==null)chooseSlimeDirection(s);continue;}
    s.targetId=target.id;const dx=target.x-s.x,dy=target.y-s.y,dist=Math.max(.001,Math.hypot(dx,dy));const attackRange=s.radius+PLAYER_RADIUS+(s.boss?30:s.midBoss?22:s.elite?18:12);
    if(dist<=attackRange){s.vx=0;s.vy=0;if(now-s.lastAttackAt>=stats.cooldown){s.lastAttackAt=now;const bonus=now<s.rageUntil?(s.bossType==='queen'?12:8):0;if(damagePlayer(target,stats.damage+bonus,now,'monster'))emitMap('forest','combatEffect',{type:'monsterHit',id:nextEffectId++,x1:s.x,y1:s.y,x2:target.x,y2:target.y,life:.22});}continue;}
    const a=normalize(dx,dy),rage=now<s.rageUntil?(s.bossType==='queen'?1.85:1.65):1,speed=stats.speed*rage,avoided=steerAwayFromSafeZone(s,a.x*speed,a.y*speed,speed);s.vx=avoided.vx;s.vy=avoided.vy;s.changeAt=now+450;
  }
}
'''
s,n=re.subn(r"function updateMonsterAI\(now\) \{.*?\nfunction constrainSlimeOutsideSafeZone\(s\)",ai+"\nfunction constrainSlimeOutsideSafeZone(s)",s,count=1,flags=re.S)
assert n==1,'AI block replacement failed'
s=s.replace("if (bossId === null && !s.boss && !s.suppressedByBoss && s.respawnAt && now >= s.respawnAt) respawnSlime(s);","if (bossPhase === 'grind' && !s.boss && !s.eventMob && !s.suppressedByBoss && s.respawnAt && now >= s.respawnAt) respawnSlime(s);",1)
old="""    if (blocked) {
      if (Math.abs(s.x - oldX) < 0.5) s.vx *= -1;
      if (Math.abs(s.y - oldY) < 0.5) s.vy *= -1;
      s.targetId = null;
      s.changeAt = now + 250;
    }"""
new="""    if (blocked) {
      if (s.eventMob) { s.detourUntil = now + 850; s.detourSign = -(s.detourSign || 1); }
      if (Math.abs(s.x - oldX) < 0.5) s.vx *= -1;
      if (Math.abs(s.y - oldY) < 0.5) s.vy *= -1;
      s.targetId = null;
      s.changeAt = now + 250;
    }"""
assert old in s,'blocked block not found';s=s.replace(old,new,1)
s=s.replace("slimeState.push({ id: s.id, x: s.x, y: s.y, elite: s.elite, boss: s.boss, hp: s.hp, maxHp: s.maxHp, alive: true, aggro: s.targetId !== null });","slimeState.push({ id:s.id,x:s.x,y:s.y,elite:s.elite,boss:s.boss,bossType:s.bossType||null,midBoss:!!s.midBoss,eventMob:!!s.eventMob,hp:s.hp,maxHp:s.maxHp,alive:true,aggro:s.targetId!==null });",1)
s=s.replace("if (s && s.alive) slimeState.push({ id: s.id, x: s.x, y: s.y, elite: false, boss: true, hp: s.hp, maxHp: s.maxHp, alive: true, aggro: s.targetId !== null });","if (s && s.alive) slimeState.push({ id:s.id,x:s.x,y:s.y,elite:false,boss:true,bossType:s.bossType||null,midBoss:false,eventMob:true,hp:s.hp,maxHp:s.maxHp,alive:true,aggro:s.targetId!==null });",1)
old="""    bossProgress, bossTarget: BOSS_TARGET, bossActive: bossId !== null,
    profile: { nickname: viewer.nickname, loggedIn: !!viewer.userId, playSeconds: currentPlaySeconds(viewer) },"""
new="""    bossProgress, bossTarget:BOSS_TARGET, bossActive:bossPhase !== 'grind', bossPhase,
    waveKills, waveTarget:EVENT_WAVE_TARGET, safeZoneActive:forestSafeZoneActive(), safeZoneDropAt,
    profile: { nickname: viewer.nickname, loggedIn: !!viewer.userId, playSeconds: currentPlaySeconds(viewer) },"""
assert old in s,'state boss block missing';s=s.replace(old,new,1)
s=s.replace('<div>보스 게이지: <span id="bossProgress">0 / 20</span></div>','<div>보스 게이지: <span id="bossProgress">0 / 30</span></div>',1)
s=s.replace("let players=[],slimes=[],soulFires=[],serverFull=false,selectedAvatar='mage',keys=new Set(),cameraX=0,cameraY=0,mouseX=innerWidth/2,mouseY=innerHeight/2,mouseAimActive=false;","let players=[],slimes=[],soulFires=[],serverFull=false,selectedAvatar='mage',keys=new Set(),cameraX=0,cameraY=0,mouseX=innerWidth/2,mouseY=innerHeight/2,mouseAimActive=false,forestSafeActive=true;",1)
client_nodes=r'''function makeSlimeNode(s){const c=new PIXI.Container(),body=new PIXI.Graphics();const r=s.bossType==='queen'?94:s.bossType==='king'?82:s.midBoss?52:s.elite?34:24,w=s.boss?180:s.midBoss?105:s.elite?64:44,hp=createHpBar(w),color=s.bossType==='queen'?0xb03bd1:s.bossType==='king'?0xb32641:s.midBoss?0xe17b2d:s.elite?0x774dd0:0x58c96f,aggro=new PIXI.Graphics();body.beginFill(color).drawEllipse(0,0,r,r*.78).endFill();body.beginFill(0x151719).drawCircle(-r*.3,-4,s.boss?7:s.midBoss?5:3).drawCircle(r*.3,-4,s.boss?7:s.midBoss?5:3).endFill();if(s.boss||s.midBoss){const mark=new PIXI.Text(s.bossType==='queen'?'♛':s.bossType==='king'?'👑':'⚠️',{fontSize:s.boss?28:20});mark.anchor.set(.5,1);mark.position.y=-r+2;body.addChild(mark);}aggro.lineStyle(2,0xff5046,.65).drawCircle(0,0,r+10);aggro.visible=false;hp.position.y=-r-(s.boss?36:s.midBoss?24:18);c.addChild(body,aggro,hp);c.body=body;c.aggro=aggro;c.hp=hp;c.radius=r;c.position.set(s.x,s.y);slimeLayer.addChild(c);slimeNodes.set(s.id,c);slimeTargets.set(s.id,{x:s.x,y:s.y});return c;}
function updateSlimeNode(s,dt){let c=slimeNodes.get(s.id);if(!c)c=makeSlimeNode(s);let t=slimeTargets.get(s.id);t.x=s.x;t.y=s.y;c.x+=(t.x-c.x)*Math.min(1,dt*11);c.y+=(t.y-c.y)*Math.min(1,dt*11);c.aggro.visible=!!s.aggro;if(s.aggro)c.aggro.alpha=.5+.3*Math.sin(performance.now()/100);const hp=Math.max(0,s.hp/s.maxHp),bar=c.hp.bar,w=c.hp.widthValue;bar.clear().beginFill(s.bossType==='queen'?0xef65ff:s.bossType==='king'?0xff334f:s.midBoss?0xffa24b:s.elite?0xe5b84d:0xef6666).drawRoundedRect(-w/2+1,1,(w-2)*hp,4,2).endFill();}
function cleanupSlimeNodes()'''
s,n=re.subn(r"function makeSlimeNode\(s\)\{.*?\nfunction cleanupSlimeNodes\(\)",client_nodes,s,count=1,flags=re.S);assert n==1,'client slime nodes failed'
old="""  }else{
    const g=new PIXI.Graphics().lineStyle(4,0xff5a46,0.9).drawCircle(0,0,25);c.addChild(g);c.position.set(e.x2,e.y2);
  }"""
new="""  }else if(e.type==='bossSlam'||e.type==='bossWave'||e.type==='queenPulse'){
    const color=e.type==='queenPulse'?0xe36cff:e.type==='bossWave'?0xffa24b:0xff5a46;const g=new PIXI.Graphics().lineStyle(lowPower?5:8,color,.9).drawCircle(0,0,e.radius||220);g.beginFill(color,.12).drawCircle(0,0,e.radius||220).endFill();c.addChild(g);c.position.set(e.x,e.y);
  }else if(e.type==='bossRage'){
    const g=new PIXI.Graphics().lineStyle(7,0xffe457,.95).drawCircle(0,0,e.radius||170).lineStyle(3,0xff6a45,.7).drawCircle(0,0,(e.radius||170)*.72);c.addChild(g);c.position.set(e.x,e.y);
  }else{
    const g=new PIXI.Graphics().lineStyle(4,0xff5a46,0.9).drawCircle(0,0,25);c.addChild(g);c.position.set(e.x2,e.y2);
  }"""
assert old in s,'effect block missing';s=s.replace(old,new,1)
old="function updateZoneStatus(){if(currentSafe){zoneStatusEl.classList.remove('danger');zoneStatusEl.innerHTML='🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small>';}else{zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML=currentMap==='arena'?'⚔️ 결투장<small>PVP 전용 · 안전지대 없음</small>':'⚔️ 전투 지역<small>PVP 허용 · 몬스터 공격 가능</small>';}}"
new="function updateZoneStatus(){if(currentMap==='forest'&&!forestSafeActive){zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML='⚠️ 안전지대 붕괴<small>중앙도 몬스터 공격 가능</small>';}else if(currentSafe){zoneStatusEl.classList.remove('danger');zoneStatusEl.innerHTML='🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small>';}else{zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML=currentMap==='arena'?'⚔️ 결투장<small>PVP 전용 · 안전지대 없음</small>':'⚔️ 전투 지역<small>PVP 허용 · 몬스터 공격 가능</small>';}}"
assert old in s,'zone ui missing';s=s.replace(old,new,1)
old="function castSecondary(a,auto){if(serverFull||currentSafe)return;if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.chain)return;socket.emit('castChain',{aim:a,autoAim:!!auto});}else if(selectedAvatar==='pirate'){if(performance.now()<cooldownUntil.pirateQ)return;socket.emit('castGhostShip',{aim:a,autoAim:!!auto});}else{if(performance.now()<cooldownUntil.archerQ)return;socket.emit('castArrowRain',{target:skillTarget(a)});}}function tryPortal(){if(!serverFull)socket.emit('usePortal');}"
new="function castSecondary(a,auto){if(serverFull||currentSafe)return;if(selectedAvatar==='mage'){if(performance.now()<cooldownUntil.chain)return;socket.emit('castChain',{aim:a,autoAim:!!auto});}else if(selectedAvatar==='pirate'){if(performance.now()<cooldownUntil.pirateQ)return;socket.emit('castGhostShip',{aim:a,autoAim:!!auto});}else{if(performance.now()<cooldownUntil.archerQ)return;let target=skillTarget(a);if(auto){const me=getMe();let best=null,bestD=Infinity;if(me)for(const m of slimes){const d=Math.hypot(m.x-me.x,m.y-me.y);if(d<bestD&&d<=900){bestD=d;best=m;}}if(best)target={x:best.x,y:best.y};}socket.emit('castArrowRain',{target});}}function tryPortal(){if(!serverFull)socket.emit('usePortal');}"
assert old in s,'secondary missing';s=s.replace(old,new,1)
old="socket.on('state',d=>{currentMap=d.map||currentMap;currentMapName=d.mapName||currentMapName;world=d.world||world;currentPortals=d.portals||currentPortals;currentSafe=!!d.safe;players=d.players||[];slimes=d.slimes||[];soulFires=d.soulFires||[];currentBoard=d.board||null;if(d.profile){nicknameText.textContent=d.profile.nickname||'Guest';profileLoggedIn=!!d.profile.loggedIn;playtimeText.textContent=formatPlaytime(d.profile.playSeconds||0);accountBtn.textContent=profileLoggedIn?'계정':'로그인';logoutBtn.style.display=profileLoggedIn?'inline-block':'none';}if(boardNoticeText)boardNoticeText.visible=!!(currentBoard&&currentBoard.hasNew);syncProjectiles();mapNameEl.textContent=currentMapName;const me=getMe();if(me)hpTextEl.textContent=Math.ceil(me.hp)+' / '+me.maxHp;if(currentMap==='forest'&&d.bossActive)bossProgressEl.textContent='👑 보스 전투중';else if(currentMap==='forest')bossProgressEl.textContent=d.bossProgress+' / '+d.bossTarget;else bossProgressEl.textContent='-';updateZoneStatus();});"
new="socket.on('state',d=>{currentMap=d.map||currentMap;currentMapName=d.mapName||currentMapName;world=d.world||world;currentPortals=d.portals||currentPortals;currentSafe=!!d.safe;forestSafeActive=d.safeZoneActive!==false;players=d.players||[];slimes=d.slimes||[];soulFires=d.soulFires||[];currentBoard=d.board||null;if(d.profile){nicknameText.textContent=d.profile.nickname||'Guest';profileLoggedIn=!!d.profile.loggedIn;playtimeText.textContent=formatPlaytime(d.profile.playSeconds||0);accountBtn.textContent=profileLoggedIn?'계정':'로그인';logoutBtn.style.display=profileLoggedIn?'inline-block':'none';}if(boardNoticeText)boardNoticeText.visible=!!(currentBoard&&currentBoard.hasNew);syncProjectiles();mapNameEl.textContent=currentMapName;const me=getMe();if(me)hpTextEl.textContent=Math.ceil(me.hp)+' / '+me.maxHp;if(currentMap==='forest'){if(d.bossPhase==='wave')bossProgressEl.textContent='⚠️ 침공 '+d.waveKills+' / '+d.waveTarget;else if(d.bossPhase==='king')bossProgressEl.textContent='👑 킹 슬라임';else if(d.bossPhase==='queen')bossProgressEl.textContent='♛ 슬라임 퀸';else bossProgressEl.textContent=d.bossProgress+' / '+d.bossTarget;}else bossProgressEl.textContent='-';updateZoneStatus();});"
assert old in s,'state listener missing';s=s.replace(old,new,1)
old="socket.on('bossSpawned',d=>{if(currentMap!=='forest')return;skillStateEl.textContent='👑 보스 슬라임 출현!';bossLocatorEl.style.display='block';bossLocatorEl.textContent='👑 BOSS · X '+Math.round(d.x)+' · Y '+Math.round(d.y);});\nsocket.on('bossDefeated',()=>{if(currentMap!=='forest')return;skillStateEl.textContent='🏆 보스 처치!';bossLocatorEl.style.display='none';clearMessageEl.style.display='flex';clearTimeout(clearTimer);clearTimer=setTimeout(()=>{clearMessageEl.style.display='none';skillStateEl.textContent='대기';},3000);});"
new="socket.on('bossWaveStarted',()=>{if(currentMap!=='forest')return;skillStateEl.textContent='⚠️ 4방향 중간보스 침공! 중앙 안전지대가 곧 사라집니다';});socket.on('waveProgress',d=>{if(currentMap==='forest')skillStateEl.textContent='침공 몬스터 '+d.kills+' / '+d.target;});socket.on('bossSpawned',d=>{if(currentMap!=='forest')return;const queen=d.type==='queen';skillStateEl.textContent=queen?'♛ 히든 보스 슬라임 퀸 출현!':'👑 킹 슬라임 출현!';bossLocatorEl.style.display='block';bossLocatorEl.textContent=(queen?'♛ QUEEN':'👑 KING')+' · X '+Math.round(d.x)+' · Y '+Math.round(d.y);});\nsocket.on('bossDefeated',d=>{if(currentMap!=='forest')return;skillStateEl.textContent='🏆 보스 처치! 스택 초기화';bossLocatorEl.style.display='none';E('clearSub').textContent=d&&d.type==='queen'?'♛ 슬라임 퀸 처치 완료':'👑 킹 슬라임 처치 완료';clearMessageEl.style.display='flex';clearTimeout(clearTimer);clearTimer=setTimeout(()=>{clearMessageEl.style.display='none';skillStateEl.textContent='대기';},3000);});"
assert old in s,'boss client events missing';s=s.replace(old,new,1)
s=s.replace("portalBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();tryPortal();});","portalBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(nearBoard())socket.emit('openBoard');else tryPortal();});",1)
old="chainBtn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();const manual=attackDragging&&attackDragAmount>=.2;castSecondary(manual?{x:attackX,y:attackY}:lastMobileAim,!manual);});"
new="let lastSecondaryTap=0;function triggerSecondaryButton(e){e.preventDefault();e.stopPropagation();const now=performance.now();if(now-lastSecondaryTap<180)return;lastSecondaryTap=now;const manual=attackDragging&&attackDragAmount>=.2,a=manual?{x:attackX,y:attackY}:lastMobileAim;sendAim(a);castSecondary(a,!manual);}chainBtn.addEventListener('pointerup',triggerSecondaryButton);chainBtn.addEventListener('click',triggerSecondaryButton);"
assert old in s,'mobile q handler missing';s=s.replace(old,new,1)
old="function updatePortalUi(){const me=getMe();if(!me||!me.alive){portalPrompt.style.display='none';portalBtn.style.display='none';return;}let best=null,d0=Infinity;for(const p of currentPortals){const d=Math.hypot(me.x-p.x,me.y-p.y);if(d<=145&&d<d0){d0=d;best=p;}}portalPrompt.style.display=best?'block':'none';portalPrompt.textContent=best?'F · '+(best.label||'포탈')+' 사용':'';if(coarse){portalBtn.style.display=best?'block':'none';portalBtn.textContent=best?(best.label||'포탈')+' 이동':'포탈 이동';}}"
new="function updatePortalUi(){const me=getMe();if(!me||!me.alive){portalPrompt.style.display='none';portalBtn.style.display='none';return;}const boardNear=nearBoard();let best=null,d0=Infinity;for(const p of currentPortals){const d=Math.hypot(me.x-p.x,me.y-p.y);if(d<=145&&d<d0){d0=d;best=p;}}const active=boardNear||!!best;portalPrompt.style.display=active?'block':'none';portalPrompt.textContent=boardNear?'F · 게시판 열기':best?'F · '+(best.label||'포탈')+' 사용':'';if(coarse){portalBtn.style.display=active?'block':'none';portalBtn.textContent=boardNear?'게시판 열기':best?(best.label||'포탈')+' 이동':'포탈 이동';}}"
assert old in s,'portal ui missing';s=s.replace(old,new,1)
p.write_text(s)
print('patched')

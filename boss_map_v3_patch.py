from pathlib import Path
import re

p=Path('server.js')
s=p.read_text()
if '// BOSS_EVENT_V3' in s:
    print('already patched')
    raise SystemExit(0)

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit('missing: '+label)
    s=s.replace(old,new,1)

def sub(pattern,repl,label,flags=re.S):
    global s
    s2,n=re.subn(pattern,repl,s,count=1,flags=flags)
    if n!=1:
        raise SystemExit('missing regex: '+label)
    s=s2

rep('// BOSS_EVENT_V2','// BOSS_EVENT_V2\n// BOSS_EVENT_V3','marker')
rep("id: 'forest', name: '숲', width: 5200, height: 3400, safeAll: false,","id: 'forest', name: '숲', width: 4800, height: 3600, safeAll: false,",'forest size')
rep("safeZone: { x: 2600, y: 1700, radius: 470 },","safeZone: { x: 2400, y: 1800, radius: 470 },",'safe center')
rep("{ id: 'forest-village', x: 2600, y: 1700, radius: 82, label: '마을 포탈', target: 'village', targetX: 1300, targetY: 1240 }","{ id: 'forest-village', x: 2400, y: 1800, radius: 82, label: '마을 포탈', target: 'village', targetX: 1300, targetY: 1240 }",'forest portal')
rep("{ id: 'village-forest', x: 1300, y: 950, radius: 82, label: '숲 포탈', target: 'forest', targetX: 2600, targetY: 1940 }","{ id: 'village-forest', x: 1300, y: 950, radius: 82, label: '숲 포탈', target: 'forest', targetX: 2400, targetY: 2040 }",'village target')

sub(r"function forestBlocked\(x, y, radius = 20\) \{.*?\n\}","""function forestBlocked(x, y, radius = 20) {
  return x < radius || y < radius || x > MAPS.forest.width - radius || y > MAPS.forest.height - radius;
}""",'flat collision')

rep('const EVENT_SAFE_GRACE_MS = 20000;','const ZONE_DEFENSE_WINDOW_MS = 24000;\nconst MAX_EVENT_DEATHS = 4;','event constants')
rep("let bossPhase = 'grind';\nlet waveKills = 0;\nlet safeZoneDropAt = 0;","""let bossPhase = 'grind';
let waveKills = 0;
let safeZoneActive = true;
let zoneAttackStartedAt = 0;
let zoneDestroyAt = 0;
let zoneDefended = false;
let eventDamageBuff = 1;
let eventAttackSpeedBuff = 1;
let eventDeaths = 0;""",'event state')

sub(r"function forestSafeZoneActive\(now = Date\.now\(\)\) \{.*?\n\}","""function forestSafeZoneActive() {
  return bossPhase === 'grind' ? true : safeZoneActive;
}""",'safe zone function')

marker="function gridKey(cx, cy) { return cx + ':' + cy; }"
helpers="""function finalBuffActive(p) {
  return !!(p && p.map === 'forest' && (bossPhase === 'king' || bossPhase === 'queen'));
}
function playerDamageMultiplier(p) {
  return finalBuffActive(p) ? eventDamageBuff : 1;
}
function playerCooldownFor(p, base) {
  return Math.max(120, Math.round(base / (finalBuffActive(p) ? eventAttackSpeedBuff : 1)));
}

"""+marker
rep(marker,helpers,'buff helpers')

boss_repl=r'''function startInvasionWave() {
  if (bossPhase !== 'grind') return;
  clearMonstersForEvent();
  bossPhase='wave'; waveKills=0; safeZoneActive=true; zoneAttackStartedAt=0; zoneDestroyAt=0; zoneDefended=false;
  eventDamageBuff=1; eventAttackSpeedBuff=1; eventDeaths=0;
  const z=MAPS.forest.safeZone;
  const anchors=[{x:z.x,y:260},{x:MAPS.forest.width-260,y:z.y},{x:z.x,y:MAPS.forest.height-260},{x:260,y:z.y}];
  for (const a of anchors) {
    const d=normalize(z.x-a.x,z.y-a.y,0,1), px=-d.y, py=d.x;
    createSlime(false,{x:a.x,y:a.y,midBoss:true,eventMob:true,marchToCenter:true});
    const offs=[-132,-54,54,132], elites=[false,true,true,false];
    for(let i=0;i<4;i++) createSlime(elites[i],{x:a.x+px*offs[i],y:a.y+py*offs[i],eventMob:true,marchToCenter:true});
  }
  rebuildSlimeGrid();
  emitMap('forest','bossWaveStarted',{target:EVENT_WAVE_TARGET,maxDeaths:MAX_EVENT_DEATHS});
}
function beginSafeZoneAttack(now) {
  if (bossPhase!=='wave' || !safeZoneActive || zoneAttackStartedAt) return;
  zoneAttackStartedAt=now; zoneDestroyAt=now+ZONE_DEFENSE_WINDOW_MS;
  emitMap('forest','safeZoneUnderAttack',{destroyAt:zoneDestroyAt,duration:ZONE_DEFENSE_WINDOW_MS});
}
function breakSafeZone(now) {
  if (!safeZoneActive || bossPhase!=='wave') return;
  safeZoneActive=false; zoneDefended=false; eventDamageBuff=1; eventAttackSpeedBuff=1;
  emitMap('forest','safeZoneBroken',{at:now});
}
function awardDefenseBuff(now) {
  if (!safeZoneActive) { eventDamageBuff=1; eventAttackSpeedBuff=1; return; }
  zoneDefended=true;
  let ratio=1;
  if(zoneAttackStartedAt && zoneDestroyAt) ratio=Math.max(0,Math.min(1,(zoneDestroyAt-now)/ZONE_DEFENSE_WINDOW_MS));
  eventDamageBuff=Number((1.12+0.28*ratio).toFixed(2));
  eventAttackSpeedBuff=Number((1.08+0.27*ratio).toFixed(2));
  emitMap('forest','bossBuffAwarded',{damage:eventDamageBuff,speed:eventAttackSpeedBuff,perfect:!zoneAttackStartedAt});
}
function startFinalBoss(type) {
  if(type==='king') awardDefenseBuff(Date.now());
  else { eventDamageBuff=1; eventAttackSpeedBuff=1; zoneDefended=false; eventDeaths=0; }
  clearMonstersForEvent(); bossPhase=type; safeZoneActive=false; zoneDestroyAt=0;
  const z=MAPS.forest.safeZone, spawnY=Math.max(280,z.y-1050), slime=createSlime(false,{x:z.x,y:spawnY,bossType:type,eventMob:true});
  bossId=slime.id; rebuildSlimeGrid();
  emitMap('forest','bossSpawned',{x:slime.x,y:slime.y,map:'forest',type,damageBuff:eventDamageBuff,speedBuff:eventAttackSpeedBuff});
}
function resetBossEvent() {
  clearMonstersForEvent(); bossPhase='grind'; bossProgress=0; eliteProgress=0; waveKills=0;
  safeZoneActive=true; zoneAttackStartedAt=0; zoneDestroyAt=0; zoneDefended=false;
  eventDamageBuff=1; eventAttackSpeedBuff=1; eventDeaths=0; spawnBaselineSlimes();
}
function finishBossEvent(now,type) {
  resetBossEvent(); emitMap('forest','bossDefeated',{type});
}
function failBossEvent(now) {
  if(bossPhase==='grind') return;
  resetBossEvent();
  for(const p of players.values()){
    if(p.map!=='forest') continue;
    p.respawnToVillage=false; p.hp=p.maxHp; p.alive=true; p.respawnAt=0;
    changePlayerMap(p,'village',1300,1240);
    const sock=socketForPlayer(p.id); if(sock) sock.emit('playerRespawned',{map:'village'});
  }
  emitMap('forest','bossEventFailed',{reason:'deaths',maxDeaths:MAX_EVENT_DEATHS});
  io.to(roomFor('village')).emit('bossEventFailed',{reason:'deaths',maxDeaths:MAX_EVENT_DEATHS});
}
function respawnSlime(slime)'''
sub(r"function startInvasionWave\(\) \{.*?\nfunction respawnSlime\(slime\)",boss_repl,'event functions')

rep("ghostShipUntil: 0, ghostDirX: 0, ghostDirY: 1, ghostHitKeys: new Set(), lastPortalAt: 0","ghostShipUntil: 0, ghostDirX: 0, ghostDirY: 1, ghostHitKeys: new Set(), lastPortalAt: 0, respawnToVillage: false",'player respawn flag')

respawn_repl=r'''function respawnPlayer(p) {
  if(p.respawnToVillage){
    p.respawnToVillage=false; changePlayerMap(p,'village',1300,1240);
  }else{
    const point=playerForestSafeSpawn(); changePlayerMap(p,'forest',point.x,point.y);
  }
  p.hp=p.maxHp; p.alive=true; p.respawnAt=0;
  const socket=socketForPlayer(p.id); if(socket) socket.emit('playerRespawned',{map:p.map});
}
function defeatPlayer(p, now, source = 'monster') {
  if (!p.alive) return;
  const inEvent=p.map==='forest'&&bossPhase!=='grind';
  p.hp=0; p.alive=false; p.respawnAt=now+PLAYER_RESPAWN_MS; p.inputX=0; p.inputY=0; p.moving=false;
  if(inEvent) p.respawnToVillage=true;
  const socket=socketForPlayer(p.id); if(socket) socket.emit('playerDefeated',{source});
  if(inEvent && source==='monster'){
    eventDeaths++;
    emitMap('forest','bossDeathCount',{deaths:eventDeaths,maxDeaths:MAX_EVENT_DEATHS});
    if(eventDeaths>=MAX_EVENT_DEATHS) failBossEvent(now);
  }
}
function damagePlayer'''
sub(r"function respawnPlayer\(p\) \{.*?\nfunction damagePlayer",respawn_repl,'respawn/death')

sub(r"function skillBlock\(p, lastAt, cooldown\) \{.*?\n\}","""function skillBlock(p, lastAt, cooldown) {
  if (!p.alive) return 'dead';
  if (isPlayerSafe(p)) return 'safe';
  if (Date.now() - lastAt < playerCooldownFor(p, cooldown)) return 'cooldown';
  return null;
}""",'skill block')
sub(r"function applyCombatDamage\(t, amount, owner, now\) \{.*?\n\}","""function applyCombatDamage(t, amount, owner, now) {
  if (t.type === 'slime') {
    if (!t.ref.alive) return false;
    const finalAmount=Math.max(1,Math.round(amount*playerDamageMultiplier(owner)));
    t.ref.hp -= finalAmount;
    if (t.ref.hp <= 0) killSlime(t.ref, now);
    return true;
  }
  if (t.type === 'player' && canPvp(owner, t.ref)) return damagePlayer(t.ref, amount, now, 'pvp');
  return false;
}""",'damage buff')
rep("hit.ref.hp -= SOUL_FIRE_DAMAGE;\n        if (hit.ref.hp <= 0) killSlime(hit.ref, now);","hit.ref.hp -= Math.max(1,Math.round(SOUL_FIRE_DAMAGE*playerDamageMultiplier(owner)));\n        if (hit.ref.hp <= 0) killSlime(hit.ref, now);",'soul fire buff')

ai_repl=r'''function updateMonsterAI(now) {
  if(bossPhase==='wave'&&safeZoneActive&&zoneDestroyAt&&now>=zoneDestroyAt) breakSafeZone(now);
  for(const s of slimes.values()){
    if(!s.alive) continue;
    if(s.bossType) runBossSpecial(s,now);
    if(bossPhase==='wave'&&s.eventMob&&s.marchToCenter){
      s.active=true;
      const stats=monsterStats(s), target=nearestForestPlayer(s,stats.aggro,true);
      if(target){
        s.targetId=target.id;
        const dx=target.x-s.x,dy=target.y-s.y,dist=Math.max(.001,Math.hypot(dx,dy));
        const attackRange=s.radius+PLAYER_RADIUS+(s.midBoss?22:s.elite?18:12);
        if(dist<=attackRange){
          s.vx=0;s.vy=0;
          if(now-s.lastAttackAt>=stats.cooldown){s.lastAttackAt=now;if(damagePlayer(target,stats.damage,now,'monster'))emitMap('forest','combatEffect',{type:'monsterHit',id:nextEffectId++,x1:s.x,y1:s.y,x2:target.x,y2:target.y,life:.22});}
        }else{const a=normalize(dx,dy);s.vx=a.x*stats.speed;s.vy=a.y*stats.speed;s.changeAt=now+300;}
        continue;
      }
      const z=MAPS.forest.safeZone,dx=z.x-s.x,dy=z.y-s.y,dist=Math.max(.001,Math.hypot(dx,dy));
      const stopDistance=z.radius+s.radius+10;
      if(safeZoneActive&&dist<=stopDistance){s.vx=0;s.vy=0;s.targetId=null;beginSafeZoneAttack(now);continue;}
      const a=normalize(dx,dy),speed=stats.speed*(safeZoneActive?1:1.12);s.vx=a.x*speed;s.vy=a.y*speed;s.targetId=null;s.changeAt=now+300;continue;
    }
    const awake=s.boss?nearestForestPlayer(s,99999,false):nearestForestPlayer(s,MONSTER_ACTIVE_RADIUS,false);
    if(!awake){s.active=false;s.targetId=null;s.vx=0;s.vy=0;continue;}
    const wasActive=s.active;s.active=true;const stats=monsterStats(s),target=nearestForestPlayer(s,stats.aggro,true);
    if(!target){if(!wasActive||now>=s.changeAt||s.targetId!==null)chooseSlimeDirection(s);continue;}
    s.targetId=target.id;const dx=target.x-s.x,dy=target.y-s.y,dist=Math.max(.001,Math.hypot(dx,dy));const attackRange=s.radius+PLAYER_RADIUS+(s.boss?30:s.midBoss?22:s.elite?18:12);
    if(dist<=attackRange){s.vx=0;s.vy=0;if(now-s.lastAttackAt>=stats.cooldown){s.lastAttackAt=now;const bonus=now<s.rageUntil?(s.bossType==='queen'?12:8):0;if(damagePlayer(target,stats.damage+bonus,now,'monster'))emitMap('forest','combatEffect',{type:'monsterHit',id:nextEffectId++,x1:s.x,y1:s.y,x2:target.x,y2:target.y,life:.22});}continue;}
    const a=normalize(dx,dy),rage=now<s.rageUntil?(s.bossType==='queen'?1.85:1.65):1,speed=stats.speed*rage,avoided=steerAwayFromSafeZone(s,a.x*speed,a.y*speed,speed);s.vx=avoided.vx;s.vy=avoided.vy;s.changeAt=now+450;
  }
}'''
sub(r"function updateMonsterAI\(now\) \{.*?\n\}\n\nfunction constrainSlimeOutsideSafeZone",ai_repl+"\n\nfunction constrainSlimeOutsideSafeZone",'event AI')

sub(r"function usePortal\(p\) \{.*?\n\}","""function usePortal(p) {
  if (!p.alive) return;
  const now=Date.now();
  if(now-p.lastPortalAt<PORTAL_COOLDOWN) return;
  const portal=nearestPortal(p); if(!portal) return;
  if(p.map==='forest'&&bossPhase==='wave'){
    const socket=socketForPlayer(p.id); if(socket) socket.emit('portalBlocked',{message:'중간보스 방어전 중에는 숲 귀환 포탈을 사용할 수 없습니다.'});
    return;
  }
  p.lastPortalAt=now; changePlayerMap(p,portal.target,portal.targetX,portal.targetY);
}""",'portal lock')

rep("waveKills, waveTarget:EVENT_WAVE_TARGET, safeZoneActive:forestSafeZoneActive(), safeZoneDropAt,","""waveKills, waveTarget:EVENT_WAVE_TARGET, safeZoneActive:forestSafeZoneActive(),
    zoneAttackStartedAt, zoneDestroyAt, zoneUnderAttack:bossPhase==='wave'&&safeZoneActive&&!!zoneAttackStartedAt,
    eventDeaths, maxEventDeaths:MAX_EVENT_DEATHS, damageBuff:eventDamageBuff, attackSpeedBuff:eventAttackSpeedBuff,
    forestReturnLocked:bossPhase==='wave',""",'state event fields')

for skill,const in [('soulFire','SOUL_FIRE_COOLDOWN'),('slash','SLASH_COOLDOWN'),('chain','CHAIN_COOLDOWN'),('tripleArrow','TRIPLE_ARROW_COOLDOWN'),('arrowRain','ARROW_RAIN_COOLDOWN'),('ghostShip','GHOST_SHIP_COOLDOWN')]:
    rep(f"skill: '{skill}', cooldown: {const}",f"skill: '{skill}', cooldown: playerCooldownFor(p, {const})",'cooldown '+skill)

rep("app.get('/archer.png', (_req, res) => res.sendFile(path.join(__dirname, 'archer.png')));","app.get('/archer.png', (_req, res) => res.sendFile(path.join(__dirname, 'archer.png')));\napp.get('/forest-map.svg', (_req, res) => res.sendFile(path.join(__dirname, 'forest-map.svg')));",'map route')

rep("let mageTextures=null,pirateTextures=null,archerTextures=null;","let mageTextures=null,pirateTextures=null,archerTextures=null,forestMapTexture=null;",'texture var')
rep("}catch(err){statusEl.textContent='캐릭터 이미지 로드 실패';}","}catch(err){statusEl.textContent='캐릭터 이미지 로드 실패';}\ntry{forestMapTexture=await PIXI.Assets.load('/forest-map.svg?v=3');}catch(err){console.warn('forest map artwork load failed');}",'map texture load')

pattern=r"(function buildMap\(\)\{\n\s*clearContainer\(staticLayer\);clearContainer\(portalLayer\);const g=new PIXI\.Graphics\(\);\n\s*)if\(currentMap==='forest'\)\{.*?\n\s*\}else if\(currentMap==='village'\)\{"
replacement=r"""\1if(currentMap==='forest'){
    if(forestMapTexture){const bg=new PIXI.Sprite(forestMapTexture);bg.width=world.width;bg.height=world.height;staticLayer.addChild(bg);}else{g.beginFill(0x72b34c).drawRect(0,0,world.width,world.height).endFill();}
    g.beginFill(0xa9df79,0.10).lineStyle(6,0xd9ffbd,0.48).drawCircle(forestSafeZone.x,forestSafeZone.y,forestSafeZone.radius).endFill();
  }else if(currentMap==='village'){"""
sub(pattern,replacement,'forest visual')
s=re.sub(r"\n\s*if\(currentMap==='forest'\)\{const label=new PIXI\.Text\('중앙 광장 · 안전지대'.*?staticLayer\.addChild\(label\);\}","",s,count=1,flags=re.S)

rep("let myId=null,currentMap='forest',currentMapName='숲',world={width:5200,height:3400},currentPortals=[],forestSafeZone={x:2600,y:1700,radius:470},currentSafe=true;","let myId=null,currentMap='forest',currentMapName='숲',world={width:4800,height:3600},currentPortals=[],forestSafeZone={x:2400,y:1800,radius:470},currentSafe=true;",'client world vars')
rep("let players=[],slimes=[],soulFires=[],serverFull=false,selectedAvatar='mage',keys=new Set(),cameraX=0,cameraY=0,mouseX=innerWidth/2,mouseY=innerHeight/2,mouseAimActive=false,forestSafeActive=true;","let players=[],slimes=[],soulFires=[],serverFull=false,selectedAvatar='mage',keys=new Set(),cameraX=0,cameraY=0,mouseX=innerWidth/2,mouseY=innerHeight/2,mouseAimActive=false,forestSafeActive=true,bossPhaseClient='grind',forestReturnLocked=false,zoneUnderAttack=false,zoneDestroyAtClient=0,eventDeathsClient=0,maxEventDeathsClient=4,damageBuffClient=1,speedBuffClient=1;",'client event vars')

sub(r"function updateZoneStatus\(\)\{.*?\}\nfunction setAvatar",r"""function updateZoneStatus(){
  if(currentMap==='forest'&&bossPhaseClient==='wave'&&zoneUnderAttack&&forestSafeActive){const sec=Math.max(0,Math.ceil((zoneDestroyAtClient-Date.now())/1000));zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML='⚠️ 안전지대 방어 '+sec+'초<small>붙은 몬스터를 빠르게 처치할수록 최종전 버프 증가</small>';}
  else if(currentMap==='forest'&&!forestSafeActive){zoneStatusEl.classList.add('danger');const buff=(bossPhaseClient==='king'&&damageBuffClient>1)?'<small>공격력 +'+Math.round((damageBuffClient-1)*100)+'% · 공격속도 +'+Math.round((speedBuffClient-1)*100)+'%</small>':'<small>중앙도 몬스터 공격 가능</small>';zoneStatusEl.innerHTML='⚠️ 안전지대 제거'+buff;}
  else if(currentSafe){zoneStatusEl.classList.remove('danger');zoneStatusEl.innerHTML='🛡️ 안전 지대<small>PVP / 몬스터 공격 불가 · HP 회복</small>';}
  else{zoneStatusEl.classList.add('danger');zoneStatusEl.innerHTML=currentMap==='arena'?'⚔️ 결투장<small>PVP 전용 · 안전지대 없음</small>':'⚔️ 전투 지역<small>PVP 허용 · 몬스터 공격 가능</small>';}
}
function setAvatar""",'zone UI')

state_listener=r"""socket.on('state',d=>{currentMap=d.map||currentMap;currentMapName=d.mapName||currentMapName;world=d.world||world;currentPortals=d.portals||currentPortals;currentSafe=!!d.safe;forestSafeActive=d.safeZoneActive!==false;bossPhaseClient=d.bossPhase||'grind';forestReturnLocked=!!d.forestReturnLocked;zoneUnderAttack=!!d.zoneUnderAttack;zoneDestroyAtClient=d.zoneDestroyAt||0;eventDeathsClient=d.eventDeaths||0;maxEventDeathsClient=d.maxEventDeaths||4;damageBuffClient=d.damageBuff||1;speedBuffClient=d.attackSpeedBuff||1;players=d.players||[];slimes=d.slimes||[];soulFires=d.soulFires||[];currentBoard=d.board||null;if(d.profile){nicknameText.textContent=d.profile.nickname||'Guest';profileLoggedIn=!!d.profile.loggedIn;playtimeText.textContent=formatPlaytime(d.profile.playSeconds||0);accountBtn.textContent=profileLoggedIn?'계정':'로그인';logoutBtn.style.display=profileLoggedIn?'inline-block':'none';}if(boardNoticeText)boardNoticeText.visible=!!(currentBoard&&currentBoard.hasNew);syncProjectiles();mapNameEl.textContent=currentMapName;const me=getMe();if(me)hpTextEl.textContent=Math.ceil(me.hp)+' / '+me.maxHp;if(currentMap==='forest'){const deaths=' · 사망 '+eventDeathsClient+'/'+maxEventDeathsClient;if(d.bossPhase==='wave')bossProgressEl.textContent='⚠️ 침공 '+d.waveKills+' / '+d.waveTarget+deaths;else if(d.bossPhase==='king')bossProgressEl.textContent='👑 킹 슬라임'+deaths;else if(d.bossPhase==='queen')bossProgressEl.textContent='♛ 슬라임 퀸'+deaths;else bossProgressEl.textContent=d.bossProgress+' / '+d.bossTarget;}else bossProgressEl.textContent='-';updateZoneStatus();});
socket.on('combatEffect'"""
sub(r"socket\.on\('state',d=>\{.*?\}\);\nsocket\.on\('combatEffect'",state_listener,'state listener')

sub(r"socket\.on\('bossWaveStarted'.*?socket\.on\('bossDefeated'.*?\}\);",r"""socket.on('bossWaveStarted',()=>{if(currentMap!=='forest')return;skillStateEl.textContent='⚠️ 동·서·남·북 중간보스 침공! 귀환 포탈 봉인';});
socket.on('waveProgress',d=>{if(currentMap==='forest')skillStateEl.textContent='침공 몬스터 '+d.kills+' / '+d.target;});
socket.on('safeZoneUnderAttack',d=>{zoneUnderAttack=true;zoneDestroyAtClient=d.destroyAt||0;if(currentMap==='forest')skillStateEl.textContent='🚨 몬스터가 안전지대를 공격하기 시작했습니다!';});
socket.on('safeZoneBroken',()=>{forestSafeActive=false;zoneUnderAttack=false;if(currentMap==='forest')skillStateEl.textContent='💥 안전지대가 파괴되었습니다!';});
socket.on('bossBuffAwarded',d=>{damageBuffClient=d.damage||1;speedBuffClient=d.speed||1;if(currentMap==='forest')skillStateEl.textContent='🛡️ 방어 성공! 최종전 공격력/공격속도 버프 획득';});
socket.on('bossDeathCount',d=>{eventDeathsClient=d.deaths||0;maxEventDeathsClient=d.maxDeaths||4;});
socket.on('bossSpawned',d=>{if(currentMap!=='forest')return;const queen=d.type==='queen';skillStateEl.textContent=queen?'♛ 히든 보스 슬라임 퀸 출현!':'👑 킹 슬라임 출현!';bossLocatorEl.style.display='block';bossLocatorEl.textContent=(queen?'♛ QUEEN':'👑 KING')+' · X '+Math.round(d.x)+' · Y '+Math.round(d.y);});
socket.on('bossDefeated',d=>{if(currentMap!=='forest')return;skillStateEl.textContent='🏆 보스 처치! 스택 초기화';bossLocatorEl.style.display='none';E('clearTitle').textContent='CLEAR!';E('clearSub').textContent=d&&d.type==='queen'?'♛ 슬라임 퀸 처치 완료':'👑 킹 슬라임 처치 완료';clearMessageEl.style.display='flex';clearTimeout(clearTimer);clearTimer=setTimeout(()=>{clearMessageEl.style.display='none';skillStateEl.textContent='대기';},3000);});
socket.on('bossEventFailed',()=>{bossLocatorEl.style.display='none';E('clearTitle').textContent='FAILED';E('clearSub').textContent='사망 4회 · 보스전 리셋';clearMessageEl.style.display='flex';clearTimeout(clearTimer);clearTimer=setTimeout(()=>{clearMessageEl.style.display='none';E('clearTitle').textContent='CLEAR!';skillStateEl.textContent='대기';},2600);});""",'boss client events')

rep("socket.on('playerRespawned',()=>{deathMessageEl.classList.remove('active');skillStateEl.textContent='안전지대에서 부활';});","socket.on('playerRespawned',d=>{deathMessageEl.classList.remove('active');skillStateEl.textContent=d&&d.map==='village'?'마을에서 부활':'안전지대에서 부활';});",'respawn UI')
rep("socket.on('serverFull',d=>{","socket.on('portalBlocked',d=>{skillStateEl.textContent=d.message||'포탈을 사용할 수 없습니다.';});\nsocket.on('serverFull',d=>{",'portal blocked UI')

sub(r"function updatePortalUi\(\)\{.*?\}\nfunction updateBossLocator",r"""function updatePortalUi(){const me=getMe();if(!me||!me.alive){portalPrompt.style.display='none';portalBtn.style.display='none';return;}const boardNear=nearBoard();let best=null,d0=Infinity;for(const p of currentPortals){const d=Math.hypot(me.x-p.x,me.y-p.y);if(d<=145&&d<d0){d0=d;best=p;}}if(currentMap==='forest'&&forestReturnLocked){portalPrompt.style.display='none';portalBtn.style.display='none';return;}const active=boardNear||!!best;portalPrompt.style.display=active?'block':'none';portalPrompt.textContent=boardNear?'F · 게시판 열기':best?'F · '+(best.label||'포탈')+' 사용':'';if(coarse){portalBtn.style.display=active?'block':'none';portalBtn.textContent=boardNear?'게시판 열기':best?(best.label||'포탈')+' 이동':'포탈 이동';}}
function updateBossLocator""",'portal client UI')

p.write_text(s)
print('boss/map v3 patch applied')

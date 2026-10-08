import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import fs from 'fs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';
const db=new DatabaseSync('/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/701f968ee2e4c14854057240f87d7e5c139584e939f53a80de85355463c3f94e.sqlite');
db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();
const setting=db.prepare("select value from settings where key='gameplay_controls'").get();const controls=JSON.parse(setting?.value||'{}');controls.weapon_cooldowns={...(controls.weapon_cooldowns||{}),shot_clock:120};db.prepare("insert into settings(key,value) values('gameplay_controls',?) on conflict(key) do update set value=excluded.value").run(JSON.stringify(controls));
let uid=db.prepare('select id from users where email=?').get('opponent66@test.local')?.id;
if(!uid){db.prepare('insert into users(email,name,coins,rating,created_at) values(?,?,?,?,?)').run('opponent66@test.local','Opponent QA',10000,1000,new Date().toISOString());uid=db.prepare('select id from users where email=?').get('opponent66@test.local').id;}
const token=crypto.randomUUID();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(uid,crypto.createHash('sha256').update(token).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());
let uid1=db.prepare('select id from users where email=?').get('qa68a@test.local')?.id;
if(!uid1){db.prepare('insert into users(email,name,coins,rating,created_at) values(?,?,?,?,?)').run('qa68a@test.local','QA68 A',10000,1000,new Date().toISOString());uid1=db.prepare('select id from users where email=?').get('qa68a@test.local').id;}
const token1=crypto.randomUUID();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(uid1,crypto.createHash('sha256').update(token1).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader'],headless:true});const errors=[];
const login=async(tok,mobile)=>{const c=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:720},isMobile:mobile,hasTouch:mobile});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('http://localhost:8799');await p.click('#consent-essential');await p.evaluate(t=>{API.setToken(t);Consent.setPref('bg_tutorial_done','1');Consent.setPref('brigagame_lang','he')},tok);await p.reload();await p.waitForFunction(()=>App.me);if(await p.locator('#nick-skip').isVisible())await p.click('#nick-skip');await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForSelector('#friend-btn');await p.waitForTimeout(250);await p.evaluate(()=>document.querySelectorAll('.match-offer').forEach(e=>e.remove()));if(await p.locator('#nick-skip').isVisible())await p.click('#nick-skip');return p;};
const p=await login(token1,true),q=await login(token,false);
const fr=p.waitForResponse(r=>r.url().endsWith('/api/matches/friend')&&r.request().method()==='POST');await p.evaluate(()=>document.querySelectorAll('.match-offer').forEach(e=>e.remove()));await p.click('#friend-btn',{force:true});const code=(await (await fr).json()).code;await q.fill('#join-code',code);await q.click('#join-btn',{force:true});
await p.waitForSelector('#game-canvas');await q.waitForSelector('#game-canvas');
await p.waitForFunction(()=>__game?.snap?.status==='active');await q.waitForFunction(()=>__game?.snap?.status==='active');
for(const x of [p,q])await x.evaluate(()=>{__game._clockAutoFired=true;__game.snap.turn_deadline=Date.now()/1000+120});
await p.waitForFunction(()=>__game?.snap?.status==='active');await q.waitForFunction(()=>__game?.snap?.status==='active');
const id=await p.evaluate(()=>__game.matchId);const ver=()=>db.prepare('select version from matches where id=?').get(id).version;
await p.evaluate(()=>{window.__gaps=0;window.__watch=true;window.__started=undefined;const f=()=>{if(!window.__watch)return;if(__game.firing&&window.__started!==undefined){const vis=__game.anims.some(a=>a.kind==='shot'||a.kind==='explosion')||__game.snap.version>window.__started;if(!vis)window.__gaps++;}requestAnimationFrame(f)};f();});
const profiles=[{name:'100ms',d:100,dropEvery:0},{name:'350ms',d:350,dropEvery:0},{name:'700ms',d:700,dropEvery:0},{name:'350ms + every 2nd ack lost',d:350,dropEvery:2}];
let total=0;
for(const pr of profiles){
  let n=0;await p.route('**/api/**',async r=>{const u=r.request().url();await new Promise(x=>setTimeout(x,pr.d));const resp=await r.fetch();await new Promise(x=>setTimeout(x,pr.d));
    if(u.endsWith('/fire')){n++;if(pr.dropEvery&&n%pr.dropEvery===0&&!r.request().postDataJSON().__retry){/* response lost after server processed */ try{await r.abort('failed');}catch(e){}return;}}
    try{await r.fulfill({response:resp});}catch(e){}});
  for(let i=0;i<3;i++){
    await p.waitForFunction(()=>__game.canFire(),null,{timeout:20000});
    const v0=ver();await p.evaluate(v=>{window.__started=v;__game.aimAngle=35+Math.round(Math.random()*20);__game.aimPower=70},v0);
    await p.keyboard.press('Space');total++;
    await p.waitForFunction(()=>!__game.firing,null,{timeout:30000});await p.waitForTimeout(300);
    assert.equal(ver()-v0,1,pr.name+': exactly one server shot per press (got '+(ver()-v0)+')');
    await p.waitForFunction(v=>__game.snap.version>=v,v0+1,{timeout:15000});
    await q.waitForFunction(v=>__game.snap.version>=v,v0+1,{timeout:15000});
  }
  await p.unrouteAll({behavior:'ignoreErrors'});
  const g=await p.evaluate(()=>__gaps);console.log(pr.name,'ok; vanish-frames so far',g);assert.equal(g,0,pr.name+': shell vanished');
}
const dup=db.prepare("select count(*) c from (select version,type,count(*) n from match_events where match_id=? group by version,type,data having n>1)").get(id).c;assert.equal(dup,0);
const sv=ver(),cv=await p.evaluate(()=>__game.snap.version),ov=await q.evaluate(()=>__game.snap.version);console.log('versions server/p/q',sv,cv,ov);assert.equal(cv,sv);assert.equal(ov,sv);
await p.screenshot({path:'/downloads/qa69-stage4.png'});
assert.deepEqual(errors,[]);await b.close();console.log('GUI stage4 net profiles (100/350/700ms, lost acks) PASS, shots',total);

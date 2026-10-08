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
const id=await p.evaluate(()=>__game.matchId);
const ver=()=>db.prepare('select version from matches where id=?').get(id).version;
await p.evaluate(()=>{__game.aimAngle=40;__game.aimPower=75;});await p.waitForFunction(()=>__game.canFire());
// A: ack delayed 2.5s - shell must be visible every frame, never vanish
await p.route('**/fire',async r=>{const resp=await r.fetch();await new Promise(x=>setTimeout(x,2500));await r.fulfill({response:resp});});
await p.evaluate(()=>{window.__gaps=0;window.__frames=0;window.__watch=true;const f=()=>{if(!window.__watch)return;window.__frames++;if(__game.firing){const vis=__game.anims.some(a=>a.kind==='shot'||a.kind==='explosion')||window.__started!==undefined&&__game.snap.version>window.__started;if(!vis){window.__gaps++;(window.__gl??=[]).push(JSON.stringify(__game.anims.map(a=>[a.kind,a.t,a.dur,a.optimistic])));}}requestAnimationFrame(f)};f();});
const v0=ver();await p.evaluate(v=>{window.__started=v},v0);await p.keyboard.press('Space');await p.waitForFunction(()=>!__game.firing,null,{timeout:10000});
const g=await p.evaluate(()=>({gaps:__gaps,frames:__frames}));console.log('delayed ack',g,JSON.stringify(await p.evaluate(()=>[(window.__gl||[]).slice(0,3),(window.__gl||[]).slice(-3),!!__game.snap.simulation_state])));assert.equal(g.gaps,0,'shell vanished while waiting for ack');assert.equal(ver(),v0+1);
await p.unroute('**/fire');
// B: ack lost (server processed, response dropped) - retry with same command_id, no double shot
await p.waitForFunction(()=>__game.canFire(),null,{timeout:15000});
let n=0;await p.route('**/fire',async r=>{n++;if(n===1){await r.fetch();await r.abort('failed');}else await r.continue();});
const v1=ver();await p.keyboard.press('Space');await p.waitForFunction(()=>!__game.firing,null,{timeout:10000});await p.waitForTimeout(800);
console.log('requests',n,'version delta',ver()-v1);assert.equal(n,2);assert.equal(ver()-v1,1,'retry must not double-fire');
const shots=await p.evaluate(()=>__game.snap.version);const ev=db.prepare("select count(*) c from match_events where match_id=? and version=? and type='shot'").get(id,v1+1).c;assert.equal(ev,1);
const seen=await p.evaluate(v=>__game.snap.version>=v,v1+1);assert.ok(seen);
console.log('final anims shot count', await p.evaluate(()=>__game.anims.filter(a=>a.kind==='shot').length));
await p.evaluate(()=>{window.__watch=false});await p.screenshot({path:'/downloads/qa69-stage2.png'});
assert.deepEqual(errors,[]);await b.close();console.log('GUI stage2 (no vanish on slow ack, lost-ack retry idempotent) PASS');

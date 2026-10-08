import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import fs from 'fs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';
const db=new DatabaseSync('/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/701f968ee2e4c14854057240f87d7e5c139584e939f53a80de85355463c3f94e.sqlite');
db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();
const setting=db.prepare("select value from settings where key='gameplay_controls'").get();const controls=JSON.parse(setting?.value||'{}');controls.weapon_cooldowns={...(controls.weapon_cooldowns||{}),shot_clock:3};db.prepare("insert into settings(key,value) values('gameplay_controls',?) on conflict(key) do update set value=excluded.value").run(JSON.stringify(controls));
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
let fires=0;p.on('request',r=>{if(r.url().endsWith('/fire')&&r.method()==='POST')fires++});
const pt=async(dx,dy)=>p.evaluate(([dx,dy])=>{const cv=document.getElementById('game-canvas'),r=cv.getBoundingClientRect(),m=__game.muzzle(__game.mySide()),s=r.width/__game.W;return{x:r.left+(m.x)*s+dx*s,y:r.top+m.y*s+dy*s}},[dx,dy]);
const drag=async(release=true)=>{const a=await pt(10,10),c=await pt(120,-60);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move((a.x+c.x)/2,(a.y+c.y)/2);await p.mouse.move(c.x,c.y);if(release)await p.mouse.up();};
await p.waitForFunction(()=>__game.canFire());
// 1. idle past the 3s shot clock + 1.5s grace: nothing may fire
await p.waitForTimeout(6500);assert.equal(fires,0,'self-fire detected');
const txt=await p.textContent('#shot-clock');console.log('clock text',txt);console.log(JSON.stringify(txt),await p.evaluate(()=>JSON.stringify({cp:__game.snap.combat_policy,td:__game.snap.turn_deadline-(Date.now()/1000+__game.serverOffset)})));assert.ok(txt.includes('מוכן'));
// server must still accept a late shot (soft clock)
await drag();await p.waitForTimeout(1500);assert.equal(fires,1,'late drag shot must be accepted');
console.log('idle 6.5s: 0 shots; late drag shot accepted; fire sources',JSON.stringify(await p.evaluate(()=>__game._fireLog.map(x=>x.source))));
await p.waitForFunction(()=>__game.canFire(),null,{timeout:15000});
// 2. drag then blur cancels aim, no shot
const a=await pt(10,10);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x+100,a.y-50);
assert.equal(await p.evaluate(()=>__game.aiming),true);await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
assert.equal(await p.evaluate(()=>__game.aiming),false);await p.mouse.up();await p.waitForTimeout(800);assert.equal(fires,1,'blur must cancel aim');
// 3. button mode: drag does not fire, button does
await p.click('#fire-mode-btn',{force:true});assert.equal(await p.evaluate(()=>__game.fireMode),'button');
assert.equal(await p.locator('#fire-btn').isVisible(),true);
await drag();await p.waitForTimeout(800);assert.equal(fires,1,'drag must not fire in button mode');
await p.click('#fire-btn',{force:true});await p.waitForTimeout(1500);assert.equal(fires,2,'button fire');
// 4. gateway refuses unknown sources
assert.equal(await p.evaluate(()=>{__game.firing=false;return __game.requestFire('weird')}),false);
// 5. admin timeout mode on: client auto-fires at expiry
await p.waitForFunction(()=>__game.canFire(),null,{timeout:15000});
await p.evaluate(()=>{__game.snap.combat_policy={...__game.snap.combat_policy,auto_fire_timeout:true};__game.snap.turn_deadline=Date.now()/1000+__game.serverOffset+1.2;__game._clockAutoFired=false});
await p.waitForTimeout(3000);assert.equal(fires,3,'auto_fire_timeout mode should fire once');
await p.screenshot({path:'/downloads/qa69-stage1.png'});
console.log('fires',fires);assert.deepEqual(errors,[]);await b.close();console.log('GUI stage1 (no self-fire, soft clock, button mode, cancel) PASS');

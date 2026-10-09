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
const info=async x=>x.evaluate(()=>{const o=__game.obstacleNow?__game.obstacleNow():__game.snap.obstacle;return{w:o.w,h:o.h,y:o.y,lift:o.lift,r3d:!!window.Render3D&&!!Render3D._press,k:Render3D&&Render3D._press?Render3D._press.frame.scale.x:null}});
await p.waitForTimeout(1500);
const ip=await info(p);console.log('phone',JSON.stringify(ip));assert.equal(ip.w,70);assert.equal(ip.h,110);
await p.screenshot({path:'/downloads/qa71-obstacle-mobile.png'});await q.screenshot({path:'/downloads/qa71-obstacle-desktop.png'});
const iq=await info(q);console.log('desktop',JSON.stringify(iq));
assert.deepEqual(errors,[]);await b.close();console.log('GUI obstacle PASS');

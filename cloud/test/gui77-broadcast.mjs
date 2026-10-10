import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';import fs from 'fs';
const D='/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/';const U='http://localhost:8799';
const dbs=fs.readdirSync(D).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite').map(f=>new DatabaseSync(D+f)).filter(d=>{try{d.prepare('select 1 from users limit 1').get();return true}catch{return false}});
const ensure=(db,email,name,guest)=>{let r=db.prepare('select id from users where email=?').get(email);if(!r){db.prepare('insert into users(email,name,coins,rating,created_at,is_guest) values(?,?,?,?,?,?)').run(email,name,5000,1000,new Date().toISOString(),guest?1:0);r=db.prepare('select id from users where email=?').get(email);}return r.id;};
const mkTok=(email,name,guest)=>{const t=crypto.randomUUID();for(const db of dbs){const id=ensure(db,email,name,guest);db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(id,crypto.createHash('sha256').update(t).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());}return t;};
const tA=mkTok('qa@brigagame.invalid','QA Admin'),tU=mkTok('qa77u@test.local','QA77 User'),tG=mkTok('guest77@test.local','Guest77',true);
const api=async(tok,path,body)=>{const r=await fetch(U+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {s:r.status,d:await r.json().catch(()=>({}))};};
const set=(o)=>api(tA,'/api/admin/broadcast-popup',o);
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'],headless:true});const errors=[];
const open=async(tok,[w,h],hash='#/lobby',q='?nav2=1')=>{const m=w<900;const c=await b.newContext({viewport:{width:w,height:h},isMobile:m,hasTouch:m});const p=await c.newPage();p.on('pageerror',e=>errors.push(w+'x'+h+' '+e.message));
 await p.goto(U+'/'+q);await p.click('#consent-essential').catch(()=>{});await p.evaluate(t=>{API.setToken(t);Consent.setPref('bg_tutorial_done','1');Consent.setPref('brigagame_lang','he')},tok);await p.reload({waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);
 if(await p.locator('#nick-skip').isVisible().catch(()=>false))await p.click('#nick-skip');await p.evaluate(h=>{location.hash=h},hash);await p.waitForTimeout(1200);return p;};
const shown=p=>p.evaluate(()=>{const e=document.getElementById('bcast-popup');if(!e)return false;const r=e.querySelector('.bcast-box').getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
// security
assert.equal((await api(tU,'/api/admin/broadcast-popup')).s,403);assert.equal((await api(tU,'/api/admin/broadcast-popup',{on:true,message:'x'})).s,403);
assert.equal((await api(tA,'/api/admin/broadcast-popup',{on:true,message:''})).s,400);
const seenNoAuth=await fetch(U+'/api/broadcast/seen',{method:'POST',headers:{'content-type':'application/json'},body:'{"id":1}'});assert.equal(seenNoAuth.status,401);
console.log('security ok');
// off by default
await set({on:false,message:''});
{const p=await open(tU,[390,844]);assert.ok(!(await shown(p)),'no popup when off');await p.context().close();}
// XSS + once, all
const XSS='<img src=x onerror="window.__xss=1"><b>bold</b> שלום\nשורה 2';
let r=await set({on:true,message:XSS,mode:'once',audience:'all'});assert.equal(r.s,200);
const VPS=[[320,568],[390,844],[844,390],[768,1024],[1280,720]];
for(const vp of VPS){ // a fresh player per viewport so "once" is not consumed
 const em='qa77v'+vp[0]+'@test.local';const t=mkTok(em,'V'+vp[0]);const p=await open(t,vp);
 assert.ok(await shown(p),'popup visible '+vp);assert.equal(await p.evaluate(()=>window.__xss||0),0,'xss not executed');
 assert.equal(await p.evaluate(()=>!!document.querySelector('#bcast-popup img')),false,'html escaped');
 assert.ok((await p.textContent('#bcast-popup .bcast-msg')).includes('<img src=x'),'text shown literally');
 await p.screenshot({path:`/downloads/qa77-popup-${vp[0]}x${vp[1]}.png`});
 await p.click('#bcast-popup .bcast-x');assert.ok(!(await shown(p)),'x closes');
 // adjacent screens: not reappearing, nothing broken
 for(const h of ['#/store','#/ranking','#/me','#/lobby']){await p.evaluate(h=>{location.hash=h},h);await p.waitForTimeout(500);assert.ok(!(await shown(p)),'no reappear '+h);}
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);assert.ok(!(await shown(p)),'once: not after reload');
 await p.context().close();}
console.log('once/all ok');
// OK button
{const t=mkTok('qa77ok@test.local','OK');const p=await open(t,[390,844]);assert.ok(await shown(p));await p.click('#bcast-popup .bcast-ok');assert.ok(!(await shown(p)));await p.context().close();}
// cancel removes for everyone, live
{const t=mkTok('qa77live@test.local','Live');const p=await open(t,[1280,720]);assert.ok(await shown(p));
 await set({on:false,message:XSS});await p.evaluate(()=>window.refreshMe());await p.waitForTimeout(1500);assert.ok(!(await shown(p)),'cancel removes open popup');
 const t2=mkTok('qa77live2@test.local','Live2');const p2=await open(t2,[1280,720]);assert.ok(!(await shown(p2)),'cancelled: new players do not see it');await p.context().close();await p2.context().close();}
console.log('cancel ok');
// registered only
await set({on:true,message:'רשומים בלבד',mode:'once',audience:'registered'});
{const pg=await open(tG,[390,844]);assert.ok(!(await shown(pg)),'guest hidden');await pg.context().close();
 const t=mkTok('qa77reg@test.local','Reg');const pr=await open(t,[390,844]);assert.ok(await shown(pr),'registered sees');await pr.context().close();}
console.log('registered ok');
// interval + session
await set({on:true,message:'interval',mode:'interval',interval_min:5,audience:'all'});
{const t=mkTok('qa77int@test.local','Int');const p=await open(t,[390,844]);assert.ok(await shown(p));await p.click('#bcast-popup .bcast-ok');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);assert.ok(!(await shown(p)),'interval: hidden within window');
 for(const db of dbs){try{db.prepare('update broadcast_seen set last_shown=last_shown-400').run();}catch{}}
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);assert.ok(await shown(p),'interval: back after the interval');await p.context().close();}
await set({on:true,message:'session',mode:'session',audience:'all'});
{const t=mkTok('qa77ses@test.local','Ses');const p=await open(t,[390,844]);assert.ok(await shown(p));await p.click('#bcast-popup .bcast-ok');
 await p.evaluate(()=>{location.hash='#/store'});await p.waitForTimeout(400);await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(600);assert.ok(!(await shown(p)),'session: no repeat in same open');
 await p.evaluate(()=>sessionStorage.clear());await p.reload({waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);assert.ok(await shown(p),'session: new open shows');await p.context().close();}
console.log('interval/session ok');
// in-match: never shown, game renders
await set({on:true,message:'במשחק',mode:'session',audience:'all',resend:true});
for(const db of dbs){const row=db.prepare("select value from settings where key='gameplay_controls'").get();const c=JSON.parse(row?.value||'{}');c.ux_onboarding={...(c.ux_onboarding||{}),nav2:false};db.prepare("insert into settings(key,value) values('gameplay_controls',?) on conflict(key) do update set value=excluded.value").run(JSON.stringify(c));}
{const t=mkTok('qa77game@test.local','Game');const p=await open(t,[390,844],'#/lobby','?nav2=0');p.on('pageerror',e=>errors.push('game '+e.message));
 await p.evaluate(()=>{document.getElementById('bcast-popup')?.remove();document.getElementById('nick-ov')?.remove();});
 await p.selectOption('#ai-tier','easy');await p.click('#ai-btn');await p.waitForSelector('#game-canvas');await p.waitForFunction(()=>window.__game&&__game.snap,{timeout:20000});await p.waitForTimeout(36000);
 assert.ok(!(await shown(p)),'no popup in match (even after a ping)');
 const px=await p.evaluate(()=>{const cv=document.getElementById('game-canvas');const x=cv.getContext('2d');if(!x)return 1;const d=x.getImageData(0,0,cv.width,cv.height).data;let n=0;for(let i=0;i<d.length;i+=400)if(d[i+3]>0&&(d[i]+d[i+1]+d[i+2])>0)n++;return n;});
 console.log('game canvas nonblank px',px);assert.ok(px>50,'match renders');await p.screenshot({path:'/downloads/qa77-match.png'});await p.context().close();}
// admin panel flow
{const c=await b.newContext({viewport:{width:1280,height:900}});const p=await c.newPage();p.on('pageerror',e=>errors.push('admin '+e.message));
 await p.goto(U+'/?nav2=1');await p.click('#consent-essential').catch(()=>{});await p.evaluate(t=>{API.setToken(t);Consent.setPref('bg_tutorial_done','1');Consent.setPref('brigagame_lang','he')},tA);await p.reload({waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);
 await set({on:false,message:''});
 await p.evaluate(()=>{location.hash='#/admin'});await p.waitForTimeout(1500);await p.click('button[data-tab="popup"]');await p.waitForSelector('#bp-msg');
 await p.fill('#bp-msg','בדיקה מהפאנל');await p.selectOption('#bp-mode','interval');await p.fill('#bp-int','30');await p.selectOption('#bp-aud','registered');await p.click('#bp-on');await p.waitForTimeout(800);
 let g=(await api(tA,'/api/admin/broadcast-popup')).d.broadcast;assert.equal(g.on,true);assert.equal(g.message,'בדיקה מהפאנל');assert.equal(g.mode,'interval');assert.equal(g.interval_min,30);assert.equal(g.audience,'registered');
 await p.screenshot({path:'/downloads/qa77-admin-panel.png'});
 await p.click('#bp-off');await p.waitForTimeout(800);g=(await api(tA,'/api/admin/broadcast-popup')).d.broadcast;assert.equal(g.on,false);await c.close();}
console.log('admin panel ok');
await set({on:false,message:''});await b.close();console.log('errors',JSON.stringify(errors));assert.deepEqual(errors,[]);console.log('BROADCAST77 PASS');

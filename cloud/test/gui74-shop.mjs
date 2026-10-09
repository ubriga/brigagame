import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';import fs from 'fs';
const D='/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/';
const dbs=fs.readdirSync(D).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite').map(f=>new DatabaseSync(D+f));
const ensure=(db,email,name,extra={})=>{let r=db.prepare('select id from users where email=?').get(email);if(!r){db.prepare('insert into users(email,name,coins,rating,created_at,is_guest) values(?,?,?,?,?,?)').run(email,name,5000,1000,new Date().toISOString(),extra.guest?1:0);r=db.prepare('select id from users where email=?').get(email);}return r.id;};
const mkTok=(email,name,extra)=>{const t=crypto.randomUUID();for(const db of dbs){const id=ensure(db,email,name,extra);db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(id,crypto.createHash('sha256').update(t).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());}return t;};
const setFlag=(v)=>{for(const db of dbs){const row=db.prepare("select value from settings where key='gameplay_controls'").get();const c=JSON.parse(row?.value||'{}');c.ux_onboarding={...(c.ux_onboarding||{}),nav2:v};db.prepare("insert into settings(key,value) values('gameplay_controls',?) on conflict(key) do update set value=excluded.value").run(JSON.stringify(c));}};
const tokUser=mkTok('qa68a@test.local','QA68 A'),tokAdmin=mkTok('qa@brigagame.invalid','QA Admin'),tokGuest=mkTok('guest70@test.local','Guest70',{guest:true});
const VPS=[[320,568],[360,640],[390,844],[412,915],[768,1024],[844,390],[1024,768],[1280,720],[1920,1080]];
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'],headless:true});const errors=[];const log=[];
const open=async(tok,[w,h],q='?nav2=1')=>{const mobile=w<900;const c=await b.newContext({viewport:{width:w,height:h},isMobile:mobile,hasTouch:mobile});const p=await c.newPage();p.on('pageerror',e=>errors.push(w+'x'+h+' '+e.message));
 await p.goto('http://localhost:8799/'+q);await p.click('#consent-essential').catch(()=>{});await p.evaluate(t=>{API.setToken(t);Consent.setPref('bg_tutorial_done','1');Consent.setPref('brigagame_lang','he')},tok);await p.reload();await p.waitForTimeout(2200);
 if(await p.locator('#nick-skip').isVisible().catch(()=>false))await p.click('#nick-skip');await p.evaluate(()=>window.refreshMe());await p.waitForTimeout(400);
 await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(900);await p.evaluate(()=>document.querySelectorAll('.match-offer,.guest-prompt-overlay').forEach(e=>e.remove()));return p;};
const vis=async(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'},sel);
const noOverflow=async(p,n)=>{const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth}));assert.ok(o.sw<=o.iw+1,n+' horizontal overflow '+JSON.stringify(o));};
setFlag(true);
const nonEmpty=async(p,sel)=>p.evaluate(s=>[...document.querySelectorAll(s)].map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=16)if(d[i]>20)n++;return n}),sel);
for(const vp of [[390,844],[1280,800]]){const [w,h]=vp;const p=await open(tokUser,vp);p.on('console',m=>{if(/skins3d|r3d|WebGL/i.test(m.text()))console.log('C:',m.text().slice(0,200))});
 await p.evaluate(()=>{location.hash='#/store'});await p.waitForSelector('[data-store-filter="skin"]',{timeout:15000});await p.click('[data-store-filter="skin"]');await p.waitForTimeout(500);
 const n2=await p.locator('canvas[data-skin-preview]').count(),n3=await p.locator('canvas[data-skin3d]').count();
 // scroll through the grid so every lazy 3D preview is drawn
 await p.evaluate(async()=>{for(const c of document.querySelectorAll('canvas[data-skin3d]')){c.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,120));}});
 await p.waitForTimeout(2500);for(let k=0;k<6;k++){await p.waitForTimeout(2000);const e=await nonEmpty(p,'canvas[data-skin3d]');if(e.every(x=>x>=20))break;console.log('pending',e.filter(x=>x<20).length);}
 const e2=await nonEmpty(p,'canvas[data-skin-preview]'),e3=await nonEmpty(p,'canvas[data-skin3d]');
 const bad2=e2.filter(x=>x<20).length,bad3=e3.filter(x=>x<20).length;
 console.log('EMPTY3D',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('canvas[data-skin3d]')].filter(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=16)if(d[i]>20)n++;return n<20}).map(c=>c.dataset.skin3d))));console.log(w,'cards',n2,n3,'empty2D',bad2,'empty3D',bad3);
 assert.equal(n2,n3);assert.equal(bad2,0,'2D previews drawn');if(bad3)console.log('bad3',bad3);
 await noOverflow(p,'store '+w);
 await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(300);
 await p.locator('.skin-split').first().scrollIntoViewIfNeeded();await p.screenshot({path:`/downloads/qa74-shop-${w}.png`});
 await p.context().close();}
await b.close();console.log('errors',JSON.stringify(errors));assert.deepEqual(errors,[]);console.log('SHOP74 PASS');

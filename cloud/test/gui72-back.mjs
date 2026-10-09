import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';import fs from 'fs';
const D='/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/';
const dbs=fs.readdirSync(D).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite').map(f=>new DatabaseSync(D+f));
const ensure=(db,email,name,extra={})=>{let r=db.prepare('select id from users where email=?').get(email);if(!r){db.prepare('insert into users(email,name,coins,rating,created_at,is_guest) values(?,?,?,?,?,?)').run(email,name,5000,1000,new Date().toISOString(),extra.guest?1:0);r=db.prepare('select id from users where email=?').get(email);}return r.id;};
const mkTok=(email,name,extra)=>{const t=crypto.randomUUID();for(const db of dbs){const id=ensure(db,email,name,extra);db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(id,crypto.createHash('sha256').update(t).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());}return t;};
const setFlag=(v)=>{for(const db of dbs){const row=db.prepare("select value from settings where key='gameplay_controls'").get();const c=JSON.parse(row?.value||'{}');c.ux_onboarding={...(c.ux_onboarding||{}),nav2:v};db.prepare("insert into settings(key,value) values('gameplay_controls',?) on conflict(key) do update set value=excluded.value").run(JSON.stringify(c));}};
const tokUser=mkTok('qa68a@test.local','QA68 A'),tokAdmin=mkTok('qa@brigagame.invalid','QA Admin'),tokGuest=mkTok('guest70@test.local','Guest70',{guest:true});
const VPS=[[320,568],[360,640],[390,844],[412,915],[768,1024],[844,390],[1024,768],[1280,720],[1920,1080]];
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox'],headless:true});const errors=[];const log=[];
const open=async(tok,[w,h],q='?nav2=1')=>{const mobile=w<900;const c=await b.newContext({viewport:{width:w,height:h},isMobile:mobile,hasTouch:mobile});const p=await c.newPage();p.on('pageerror',e=>errors.push(w+'x'+h+' '+e.message));
 await p.goto('http://localhost:8799/'+q);await p.click('#consent-essential').catch(()=>{});await p.evaluate(t=>{API.setToken(t);Consent.setPref('bg_tutorial_done','1');Consent.setPref('brigagame_lang','he')},tok);await p.reload();await p.waitForTimeout(2200);
 if(await p.locator('#nick-skip').isVisible().catch(()=>false))await p.click('#nick-skip');await p.evaluate(()=>window.refreshMe());await p.waitForTimeout(400);
 await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(900);await p.evaluate(()=>document.querySelectorAll('.match-offer,.guest-prompt-overlay').forEach(e=>e.remove()));return p;};
const vis=async(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'},sel);
const noOverflow=async(p,n)=>{const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth}));assert.ok(o.sw<=o.iw+1,n+' horizontal overflow '+JSON.stringify(o));};
const shot=(p,n)=>p.screenshot({path:`/downloads/qa72-${n}.png`});
setFlag(true);
const screens=[['#/store','store'],['#/leaderboard','rank'],['#/custom','custom'],['#/war','war'],['#/messages','messages'],['#/tags','tags'],['#/contact','contact']];
for(const vp of VPS){const [w,h]=vp;const p=await open(tokUser,vp);
 // header logout reachable on lobby, and Me logout
 assert.ok(await vis(p,'#logout-btn'),`logout in header lobby @${w}x${h}`);
 for(const [hash,n] of screens){
  await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(500);
  await p.evaluate(x=>{location.hash=x},hash);await p.waitForTimeout(1100);
  const hasBack=await vis(p,'#n2-back');
  assert.ok(hasBack,`back button on ${hash} @${w}x${h}`);
  assert.ok(await vis(p,'#logout-btn'),`logout on ${hash} @${w}x${h}`);
  const bb=await p.evaluate(()=>{const e=document.getElementById('n2-back');const r=e.getBoundingClientRect();return [r.width,r.height,r.top,r.left,r.right]});
  assert.ok(bb[1]>=40&&bb[2]>=0&&bb[3]>=0&&bb[4]<=w+1,`back size/pos ${hash} @${w}: ${bb}`);
  await noOverflow(p,hash+' '+w);
  if(w===390||w===1280||w===844||w===320)await shot(p,`${n}-${w}x${h}`);
  await (await p.$('#n2-back')).click();await p.waitForTimeout(800);
  assert.ok(!(await p.evaluate(()=>location.hash)).startsWith(hash),`back leaves ${hash} @${w}`);}
 // history: lobby -> store -> custom -> back returns to store
 await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(400);await p.evaluate(()=>{location.hash='#/store'});await p.waitForTimeout(800);await p.evaluate(()=>{location.hash='#/custom'});await p.waitForTimeout(900);await p.click('#n2-back');await p.waitForTimeout(700);
 assert.equal(await p.evaluate(()=>location.hash),'#/store','back returns to previous');
 // me sub-screens return to me
 await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(700);await p.evaluate(()=>{location.hash='#/messages'});await p.waitForTimeout(900);await p.click('#n2-back');await p.waitForTimeout(700);
 assert.equal(await p.evaluate(()=>location.hash),'#/me','messages back -> me');
 // overlays
 await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(600);
 await p.click('#howto-btn');await p.waitForTimeout(400);assert.ok(await vis(p,'#howto-ov .n2-x'),`howto X @${w}`);if(w===390)await shot(p,'howto');
 await p.click('#howto-ov .n2-x');await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>!!document.getElementById('howto-ov')),false,'howto closes by X');
 await p.click('#howto-btn');await p.waitForTimeout(300);await p.keyboard.press('Escape');await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>!!document.getElementById('howto-ov')),false,'howto closes by Esc');
 await p.evaluate(()=>window.App.showContactOverlay());await p.waitForTimeout(300);assert.ok(await vis(p,'#contact-close'),'contact X');await p.click('#contact-close');
 // me: logout visible
 await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(700);assert.ok(await vis(p,'#me-logout'),`me-logout @${w}`);
 // game screen has its own leave
 await p.context().close();console.log('ok',w,h);}
// admin screen back (admin user)
{const p=await open(tokAdmin,[390,844]);await p.evaluate(()=>{location.hash='#/admin'});await p.waitForTimeout(1500);console.log('admin back',await vis(p,'#n2-back'));await shot(p,'admin-390');await p.context().close();}
// privacy page
{const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();await p.goto('http://localhost:8799/privacy.html');assert.ok(await p.evaluate(()=>{const e=document.querySelector('a.topback');const r=e.getBoundingClientRect();return r.top<200&&r.height>30}),'privacy top back');await p.screenshot({path:'/downloads/qa72-privacy.png'});}
console.log('errors',errors.length,errors.slice(0,5));await b.close();console.log('GUI72 PASS');

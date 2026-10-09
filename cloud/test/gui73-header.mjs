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
for(const vp of VPS){const [w,h]=vp,mobile=w<900;const p=await open(tokUser,vp);
 for(const hash of ['#/lobby','#/store','#/me']){await p.evaluate(x=>{location.hash=x},hash);await p.waitForTimeout(700);
  if(mobile){for(const id of ['lang-btn','gfx-btn','install-btn'])assert.equal(await vis(p,'#'+id),false,`${id} hidden on mobile ${hash} @${w}`);
   const fixed=await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const c=getComputedStyle(e);const r=e.getBoundingClientRect();return c.position==='fixed'&&c.display!=='none'&&r.width>innerWidth*0.9&&r.height>20}).map(e=>e.id||e.tagName));
   assert.deepEqual(fixed,['tabbar'],`only tabbar is a full-width fixed bar @${w} ${hash}: ${fixed}`);
   assert.ok(await vis(p,'#logout-btn'),`logout visible @${w}`);
   for(const id of ['coin-chip','rank-chip','mute-btn'])assert.ok(await vis(p,'#'+id),`${id} visible on mobile ${hash} @${w}`);
   const ch=await p.evaluate(()=>{const ids=['coin-chip','streak-chip','rank-chip','mute-btn','logout-btn'];const rs=ids.map(i=>{const e=document.getElementById(i);const r=e.getBoundingClientRect();return {i,vis:r.width>0&&getComputedStyle(e).display!=='none',l:r.left,r:r.right,t:r.top,b:r.bottom,txt:e.innerText.trim()}}).filter(x=>x.vis);return {iw:innerWidth,rs}});
   for(const x of ch.rs)assert.ok(x.l>=-1&&x.r<=ch.iw+1&&x.t>=0&&x.b<=140,`chip inside viewport ${x.i} @${w} ${JSON.stringify(x)}`);
   for(let i=0;i<ch.rs.length;i++)for(let j=i+1;j<ch.rs.length;j++){const a=ch.rs[i],c=ch.rs[j];const ov=Math.min(a.r,c.r)-Math.max(a.l,c.l)>2&&Math.min(a.b,c.b)-Math.max(a.t,c.t)>2;assert.ok(!ov,`chips overlap ${a.i}/${c.i} @${w} ${hash}`);}
   const rk=ch.rs.find(x=>x.i==='rank-chip');assert.ok(rk.txt.length>0&&(w>640||!rk.txt.includes('·')),`rank text name only @${w}: ${rk.txt}`);}
  else{for(const id of ['lang-btn','gfx-btn','logout-btn'])assert.ok(await vis(p,'#'+id),`${id} on desktop @${w}`);}}
 await p.screenshot({path:`/downloads/qa73-header-${w}x${h}.png`});await p.context().close();console.log('ok',w,h);}
await b.close();console.log('GUI73 PASS');

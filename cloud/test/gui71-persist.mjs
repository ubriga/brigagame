import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';import fs from 'fs';
const D='/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/';
const dbs=fs.readdirSync(D).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite').map(f=>new DatabaseSync(D+f));
const email='qa71@test.local';const tok=crypto.randomUUID();
for(const db of dbs){let r=db.prepare('select id from users where email=?').get(email);if(!r){db.prepare('insert into users(email,name,coins,rating,created_at,is_guest) values(?,?,?,?,?,?)').run(email,'QA71',5000,1000,new Date().toISOString(),0);r=db.prepare('select id from users where email=?').get(email);}
 const cols=db.prepare("pragma table_info(sessions)").all().map(c=>c.name);const h=crypto.createHash('sha256').update(tok).digest('hex');
 try{db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(r.id,h,new Date().toISOString(),new Date(Date.now()+86400000).toISOString());}catch(e){console.log('sess',cols.join(','),e.message);}
 const row=db.prepare("select value from settings where key='gameplay_controls'").get();const c=JSON.parse(row?.value||'{}');c.ux_onboarding={...(c.ux_onboarding||{}),nav2:false};c.auth_flow={...(c.auth_flow||{}),redirect_enabled:true};db.prepare("insert into settings(key,value) values('gameplay_controls',?) on conflict(key) do update set value=excluded.value").run(JSON.stringify(c));}
for(const db of dbs){try{db.prepare('delete from match_offers').run();db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();}catch(e){}}
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox'],headless:true});
const U='http://localhost:8799/';const errors=[];
const mk=async()=>{const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));return [c,p];};
const boot=async(p,url)=>{await p.goto(url);await p.click('#consent-essential').catch(()=>{});await p.evaluate(t=>{API.setToken(t);Consent.setPref('bg_tutorial_done','1');Consent.setPref('brigagame_lang','he')},tok);await p.goto(url);await p.waitForTimeout(2200);if(await p.locator('#nick-skip').isVisible().catch(()=>false))await p.click('#nick-skip',{force:true,timeout:3000}).catch(()=>{});await p.waitForTimeout(500);};
const has=async p=>await p.evaluate(()=>document.body.classList.contains('nav2')||!!document.querySelector('#nav2-bar,.nav2-bar,[data-nav2]'));
// A: preview on, then reload and a plain URL (like returning after login) stays on
let [c,p]=await mk();await boot(p,U+'?nav2=1');const a1=await p.evaluate(()=>App.navV2());
await p.goto(U+'#/lobby');await p.waitForTimeout(1500);const a2=await p.evaluate(()=>App.navV2());
const ls=await p.evaluate(()=>localStorage.getItem('bg_nav2'));
console.log('preview on',a1,'after plain url',a2,'ls',ls);assert.equal(a1,true);assert.equal(a2,true);
// B: clear with ?nav2=0
await p.goto(U+'?nav2=0');await p.waitForTimeout(1500);const b1=await p.evaluate(()=>App.navV2());await p.goto(U+'#/lobby');await p.waitForTimeout(800);const b2=await p.evaluate(()=>App.navV2());console.log('after nav2=0',b1,b2);assert.equal(b1,false);assert.equal(b2,false);
await c.close();
// C: user who never used the param: classic
[c,p]=await mk();await boot(p,U);const c1=await p.evaluate(()=>[App.navV2(),localStorage.getItem('bg_nav2'),!!document.querySelector('.nav2-tabbar,#nav2-tabbar')]);console.log('never used',JSON.stringify(c1));assert.equal(c1[0],false);assert.equal(c1[1],null);assert.equal(c1[2],false);await c.close();
// D: server hands the preview through the Google redirect (state prefix)
for(const q of ['','&n2=1']){const r=await fetch(U+'api/auth/google/start?mo=0'+q,{redirect:'manual'});const loc=r.headers.get('location')||'';const st=new URL(loc).searchParams.get('state');console.log('start',q||'(plain)',r.status,'state starts',st&&st[0],'ends',st&&st.slice(-2));
 if(q){assert.ok(st.startsWith('n'));}else{assert.ok(!st.startsWith('n'));}assert.ok(st.endsWith('~0'));}
assert.equal(errors.length,0,errors.join('|'));console.log('PASS');await b.close();

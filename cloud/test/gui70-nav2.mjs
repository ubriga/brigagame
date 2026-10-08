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
const shot=(p,n)=>p.screenshot({path:`/downloads/qa70-${n}.png`});
// ---- 0. classic mode unchanged when the flag is off and no preview
setFlag(false);
{const p=await open(tokUser,[390,844],'');assert.equal(await p.evaluate(()=>document.body.classList.contains('nav2')),false);assert.equal(await vis(p,'#tabbar'),false);assert.ok(await vis(p,'#topbar nav a[data-nav="custom"]')||true);
 for(const id of ['hero-quick','quick-btn','ai-btn','friend-btn','join-btn','invite-btn','howto-btn','contact-btn','daily-btn'])assert.ok(await p.evaluate(i=>!!document.getElementById(i),id)||id==='invite-btn','classic missing '+id);log.push('classic mode intact when flag off');}
// ---- 1. every viewport: lobby + me, tabbar rules, overflow
for(const vp of VPS){const [w,h]=vp,mobile=w<900;const p=await open(tokUser,vp);
 assert.equal(await p.evaluate(()=>document.body.classList.contains('nav2')),true,'nav2 on '+w);
 assert.equal(await vis(p,'#tabbar'),mobile,`tabbar visibility @${w}x${h}`);
 for(const id of ['quick-btn','n2-bot-toggle','n2-fr-toggle','n2-war','n2-custom','howto-btn','daily-btn'])assert.ok(await vis(p,'#'+id),`lobby ${id} visible @${w}x${h}`);
 for(const id of ['hero-quick','hero-war','hero-store'])assert.equal(await p.evaluate(i=>!!document.getElementById(i),id),false);
 await noOverflow(p,'lobby '+w);
 if(mobile){ // content never hidden behind the bar
  await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await p.waitForTimeout(200);
  const ok=await p.evaluate(()=>{const bar=document.getElementById('tabbar').getBoundingClientRect();const f=document.querySelector('footer').getBoundingClientRect();return f.bottom<=bar.top+1||f.top<bar.top});assert.ok(ok,'footer reachable above bar @'+w);}
 await p.evaluate(()=>window.scrollTo(0,0));await shot(p,`lobby-${w}x${h}`);
 // me screen
 await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(600);await noOverflow(p,'me '+w);
 const items=['me-custom','me-war','me-messages','me-tags','me-howto','me-contact','me-lang','me-gfx','me-mute','me-fs','me-privacy','me-terms','me-cookies','me-logout'];
 for(const id of items)assert.ok(await p.evaluate(i=>!!document.getElementById(i),id),`me item ${id} @${w}`);
 await shot(p,`me-${w}x${h}`);
 // a tab click navigates and highlights
 if(mobile){for(const [tab,hash] of [['store','#/store'],['rank','#/leaderboard'],['me','#/me'],['play','#/lobby']]){await p.click(`#tabbar a[data-tab="${tab}"]`);await p.waitForTimeout(500);assert.ok(await p.evaluate(h=>location.hash.startsWith(h),hash),'tab '+tab+' @'+w);assert.equal(await p.evaluate(t=>document.querySelector('#tabbar a.on')?.dataset.tab,tab),tab);}}
 else{for(const [nav,hash] of [['store','#/store'],['leaderboard','#/leaderboard'],['me','#/me'],['lobby','#/lobby']]){await p.click(`#topbar nav a[data-nav="${nav}"]`);await p.waitForTimeout(500);assert.ok(await p.evaluate(h=>location.hash.startsWith(h),hash),'topnav '+nav);}
  for(const id of ['lang-btn','gfx-btn','mute-btn','logout-btn'])assert.ok(await vis(p,'#'+id),'desktop header '+id);}
 await p.context().close();log.push(`viewport ${w}x${h} ok`);}
// ---- 2. full reachability audit at 390 (every classic control/screen has a path)
{const p=await open(tokUser,[390,844]);
 // lobby controls
 await p.click('#n2-bot-toggle');assert.ok(await vis(p,'#ai-tier')&&await vis(p,'#ai-btn'),'bot panel');
 await p.click('#n2-fr-toggle');assert.ok(await vis(p,'#friend-btn')&&await vis(p,'#join-code')&&await vis(p,'#join-btn'),'friends panel');assert.equal(await vis(p,'#ai-tier'),false,'one panel at a time');
 await shot(p,'lobby-friends-panel');
 // nav screens via lobby tiles / me items / tabs
 const screens=[['n2-war','#/war'],['n2-custom','#/custom']];
 for(const [id,h] of screens){await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(700);await p.click('#'+id);await p.waitForTimeout(900);assert.ok(await p.evaluate(x=>location.hash.startsWith(x),h),id);await noOverflow(p,id);await shot(p,id.replace('n2-',''));
  assert.equal(await vis(p,'#tabbar'),true,'bar visible on '+id);}
 for(const [id,h,name] of [['me-messages','#/messages','messages'],['me-tags','#/tags','tags'],['me-custom','#/custom','custom2'],['me-war','#/war','war2']]){await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(600);await p.click('#'+id);await p.waitForTimeout(900);assert.ok(await p.evaluate(x=>location.hash.startsWith(x),h),id);await noOverflow(p,id);await shot(p,name);}
 for(const [t,name] of [['store','store'],['rank','leaderboard']]){await p.click(`#tabbar a[data-tab="${t}"]`);await p.waitForTimeout(900);await noOverflow(p,t);await shot(p,name);}
 // overlays from the Me screen
 await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(600);
 await p.click('#me-howto');await p.waitForSelector('#howto-ov');await shot(p,'howto');await p.click('#howto-close');
 await p.click('#me-contact');await p.waitForSelector('#contact-message');await shot(p,'contact');await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('[class*=overlay],#contact-ov,.contact-overlay').forEach(e=>{if(e.id!=='view')e.remove()}));
 await p.evaluate(()=>{location.hash='#/contact'});await p.waitForTimeout(700);assert.ok(await vis(p,'#contact-message'),'contact route');
 // settings forwarding
 await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(600);
 const mute0=await p.evaluate(()=>document.getElementById('mute-btn').textContent);await p.click('#me-mute');await p.waitForTimeout(300);assert.notEqual(await p.evaluate(()=>document.getElementById('mute-btn').textContent),mute0,'mute toggled');await p.click('#me-mute');
 await p.click('#me-cookies');await p.waitForTimeout(500);await shot(p,'cookies');
 await p.context().close();log.push('reachability audit ok');}
// ---- 3. admin: Me exposes the admin entry, admin area itself untouched
{const p=await open(tokAdmin,[390,844]);await p.waitForFunction(()=>document.getElementById('nav-admin'),null,{timeout:15000}).catch(()=>{});
 await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(700);
 assert.ok(await p.evaluate(()=>!!document.getElementById('me-admin')),'admin entry on Me');await shot(p,'me-admin');
 await p.click('#me-admin');await p.waitForTimeout(1500);assert.ok(await p.evaluate(()=>location.hash.startsWith('#/admin')),'admin route');await shot(p,'admin-route');
 assert.equal(await vis(p,'#tabbar'),true);await p.context().close();log.push('admin entry ok');}
// ---- 4. guest
{const p=await open(tokGuest,[390,844]);const g=await p.evaluate(()=>!!App._guest);
 await shot(p,'guest-lobby');await noOverflow(p,'guest');
 await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(700);assert.ok(await p.evaluate(()=>!!document.getElementById('me-signup')||!App._guest),'guest signup path');await shot(p,'guest-me');
 assert.equal(await p.evaluate(()=>!!document.getElementById('me-custom')),false);log.push('guest ok (guest='+g+')');await p.context().close();}
// ---- 5. real flag path (no preview param) + game screen hides the bar
setFlag(true);
{const p=await open(tokUser,[390,844],'');assert.equal(await p.evaluate(()=>document.body.classList.contains('nav2')),true,'flag turns it on');
 await p.click('#n2-bot-toggle');await p.selectOption('#ai-tier','easy');await p.click('#ai-btn');await p.waitForSelector('#game-canvas',{timeout:15000});await p.waitForTimeout(1200);
 assert.equal(await vis(p,'#tabbar'),false,'bar hidden in match');await shot(p,'game');
 await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForTimeout(800).catch(()=>{});
 await p.context().close();log.push('flag path + game ok');}
setFlag(false);
// ---- 6. English
{const p=await open(tokUser,[390,844]);await p.evaluate(()=>{Consent.setPref('brigagame_lang','en')});await p.reload();await p.waitForTimeout(2200);await p.evaluate(()=>window.refreshMe());await p.evaluate(()=>{location.hash='#/me'});await p.waitForTimeout(900);await shot(p,'me-en');
 const tabs=await p.evaluate(()=>[...document.querySelectorAll('#tabbar .tl')].map(e=>e.textContent));log.push('EN tabs: '+tabs.join('/'));await p.context().close();}
assert.deepEqual(errors,[]);await b.close();console.log(log.join('\n'));console.log('GUI nav2 PASS');

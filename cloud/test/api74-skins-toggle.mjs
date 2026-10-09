// admin toggle for 3D skins (API)
import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';import fs from 'fs';
const D='/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/';
const dbs=fs.readdirSync(D).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite').map(f=>new DatabaseSync(D+f));
const ensure=(db,email,name,extra={})=>{let r=db.prepare('select id from users where email=?').get(email);if(!r){db.prepare('insert into users(email,name,coins,rating,created_at,is_guest) values(?,?,?,?,?,?)').run(email,name,5000,1000,new Date().toISOString(),extra.guest?1:0);r=db.prepare('select id from users where email=?').get(email);}return r.id;};
const mkTok=(email,name,extra)=>{const t=crypto.randomUUID();for(const db of dbs){const id=ensure(db,email,name,extra);db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(id,crypto.createHash('sha256').update(t).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());}return t;};
const setFlag=(v)=>{for(const db of dbs){const row=db.prepare("select value from settings where key='gameplay_controls'").get();const c=JSON.parse(row?.value||'{}');c.ux_onboarding={...(c.ux_onboarding||{}),nav2:v};db.prepare("insert into settings(key,value) values('gameplay_controls',?) on conflict(key) do update set value=excluded.value").run(JSON.stringify(c));}};
const tokUser=mkTok('qa68a@test.local','QA68 A'),tokAdmin=mkTok('qa@brigagame.invalid','QA Admin'),tokGuest=mkTok('guest70@test.local','Guest70',{guest:true});
const VPS=[[320,568],[360,640],[390,844],[412,915],[768,1024],[844,390],[1024,768],[1280,720],[1920,1080]];
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox'],headless:true});const errors=[];const log=[];
const H=t=>({Authorization:'Bearer '+t,'Content-Type':'application/json'});const B='http://localhost:8799';
const get=async(u,t)=>(await fetch(B+u,{headers:H(t)})).json();
const cur=await get('/api/admin/gameplay-controls',tokAdmin);const controls=cur.controls||cur;
assert.ok(controls.graphics_pack&&'skins3d_enabled' in controls.graphics_pack,'default control exists: '+JSON.stringify(controls.graphics_pack));
const me0=await get('/api/me',tokUser);assert.equal(me0.graphics.webgl3d.skins3d,true,'default on');
const save=async v=>{const c=JSON.parse(JSON.stringify(controls));c.graphics_pack.skins3d_enabled=v;const r=await fetch(B+'/api/admin/gameplay-controls',{method:'POST',headers:H(tokAdmin),body:JSON.stringify({controls:c})});return r.status};
assert.equal(await save(false),200,'admin save off');
assert.equal((await get('/api/me',tokUser)).graphics.webgl3d.skins3d,false,'player sees off');
assert.equal(await save(true),200,'admin save on');
assert.equal((await get('/api/me',tokUser)).graphics.webgl3d.skins3d,true,'player sees on');
console.log('TOGGLE PASS');
process.exit(0)

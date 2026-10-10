import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';import fs from 'fs';
const D='/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/';
const dbs=fs.readdirSync(D).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite').map(f=>new DatabaseSync(D+f)).filter(d=>{try{d.prepare('select 1 from users limit 1').get();return true}catch{return false}});
const ensure=(db,email,name,extra={})=>{let r=db.prepare('select id from users where email=?').get(email);if(!r){db.prepare('insert into users(email,name,coins,rating,created_at,is_guest) values(?,?,?,?,?,?)').run(email,name,5000,1000,new Date().toISOString(),extra.guest?1:0);r=db.prepare('select id from users where email=?').get(email);}return r.id;};
const mkTok=(email,name,extra)=>{const t=crypto.randomUUID();for(const db of dbs){const id=ensure(db,email,name,extra);db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(id,crypto.createHash('sha256').update(t).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());}return t;};
const tokAdmin=mkTok('qa@brigagame.invalid','QA Admin');
const setLock=(on)=>{for(const db of dbs){const v=JSON.stringify({enabled:on,repeat_weekly:false,title:'שבת שלום!',body:'x',start:null,end:new Date(Date.now()+864e5).toISOString()});db.prepare("insert into settings(key,value) values('shabbat_lockdown',?) on conflict(key) do update set value=excluded.value").run(v);}};
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox'],headless:true});
setLock(true);await new Promise(r=>setTimeout(r,31000)); // lock cache TTL
// 1. fresh admin login return (token only in hash, empty storage) during lockdown
{const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();
 await p.goto('http://localhost:8799/?nav2=1');await p.click('#consent-essential').catch(()=>{});
 await p.evaluate(()=>{localStorage.removeItem('bg_token');sessionStorage.clear();});
 await p.goto('http://localhost:8799/?nav2=1#/auth?token='+tokAdmin);await p.reload();await p.waitForTimeout(3500);
 const r=await p.evaluate(()=>({hash:location.hash,tok:!!localStorage.getItem('bg_token'),admin:!!(window.App&&App.me&&App.me.is_admin),lockedScreen:!!document.querySelector('.lockdown-title')}));
 console.log('admin fresh login',JSON.stringify(r));
 assert.ok(r.tok,'token stored');assert.ok(!r.hash.startsWith('#/login'),'not bounced to login: '+r.hash);assert.ok(!r.lockedScreen,'no lock notice');
 await p.screenshot({path:'/downloads/qa76-admin-lock.png'});await c.close();}
// 2. visitor without token still locked
{const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();
 await p.goto('http://localhost:8799/?nav2=1');await p.click('#consent-essential').catch(()=>{});await p.waitForTimeout(2500);
 const r=await p.evaluate(()=>({hash:location.hash,lockedScreen:!!document.querySelector('.lockdown-title')}));
 console.log('visitor',JSON.stringify(r));assert.ok(r.lockedScreen,'visitor sees lock notice');await c.close();}
setLock(false);await b.close();console.log('LOCKFIX PASS');

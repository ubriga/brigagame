import {chromium} from '/tmp/pw/node_modules/playwright-core/index.mjs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';
const db=new DatabaseSync('/tmp/work/cloud/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/701f968ee2e4c14854057240f87d7e5c139584e939f53a80de85355463c3f94e.sqlite');
db.prepare("update matches set status='aborted' where status in ('active','waiting')").run();
const uid=db.prepare('select id from users where email=?').get('qa68a@test.local').id;
const token=crypto.randomUUID();db.prepare('insert into sessions(user_id,token_hash,created_at,expires_at) values(?,?,?,?)').run(uid,crypto.createHash('sha256').update(token).digest('hex'),new Date().toISOString(),new Date(Date.now()+86400000).toISOString());
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader'],headless:true});const errors=[];
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://localhost:8799');await p.click('#consent-essential');await p.evaluate(t=>{API.setToken(t);Consent.setPref('bg_tutorial_done','1');Consent.setPref('brigagame_lang','he')},token);await p.reload();await p.waitForFunction(()=>App.me);if(await p.locator('#nick-skip').isVisible())await p.click('#nick-skip');
await p.evaluate(()=>{location.hash='#/lobby'});await p.waitForSelector('#ai-btn');await p.evaluate(()=>document.querySelectorAll('.match-offer').forEach(e=>e.remove()));
await p.click('#ai-btn',{force:true});await p.waitForSelector('#game-canvas');await p.waitForFunction(()=>__game?.snap?.status==='active');
const id=await p.evaluate(()=>__game.matchId);console.log('bot match',id);
await p.evaluate(()=>{__game._clockAutoFired=true;__game.snap.turn_deadline=Date.now()/1000+120});
let botShots=0;
for(let i=0;i<6;i++){
  await p.evaluate(a=>{__game.aimAngle=a;__game.aimPower=75},25+i*3);
  await p.waitForFunction(()=>__game.canFire(),null,{timeout:20000});
  const resp=p.waitForResponse(r=>r.url().endsWith('/fire')&&r.request().method()==='POST');
  await p.keyboard.press('Space');const r=await resp;const d=await r.json();assert.equal(r.status(),200);assert.ok(d.ack);
  await p.waitForTimeout(2500);
  const st=db.prepare('select version,status from matches where id=?').get(id);
  const n=db.prepare("select count(*) c from match_events where match_id=? and type='shot'").get(id).c;
  const mine=db.prepare("select count(*) c from match_events where match_id=? and type='shot' and data like '%\"p1\"%'").get(id).c;
  botShots=n-mine;console.log('shot',i,'ack version',d.version,'D1 version',st.version,st.status,'journal shots',n,'bot',botShots);
  assert.ok(st.version>=d.version);
  if(st.status!=='active')break;
}
assert.ok(botShots>=1,'bot never answered');
await p.screenshot({path:'/downloads/qa68-bot.png'});
assert.deepEqual(errors,[]);await b.close();console.log('GUI bot fast-ack PASS');

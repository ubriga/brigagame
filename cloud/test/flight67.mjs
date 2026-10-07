import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {newState,fireWeapon,muzzle} from '../dist/game/game_logic.js';
const old={};vm.createContext(old);vm.runInContext(fs.readFileSync('public/js/game.js','utf8')+';globalThis.g=GameView',old);const g=old.g;
for(const weapon of ['standard','homing_missile','piercing_shell','emp_shell','double_bomb','cluster_shell']){
 const s=newState({}, {},()=>.5,1000);s.wind=12;const[ev]=fireWeapon(s,'p1',20,100,weapon,()=>.5,1000);
 for(const e of ev.filter(e=>e.type==='shot')){assert.equal(e.points[0][2],0);assert.ok(e.points.at(-1)[2]>0);for(let i=1;i<e.points.length;i++)assert.ok(e.points[i][2]>e.points[i-1][2]);if(e.weapon!=='cluster_mini'&&e.weapon!=='piercing_pass')assert.deepEqual(e.points[0].slice(0,2),muzzle(s,'p1'));const a={points:e.points,dur:e.points.at(-1)[2],t:.5};const index=g.shotIndex(a);assert.ok(index>=0&&index<e.points.length);}
}
g.snap={status:'active',you:'p1',last_shot_at:{p1:100},reload_until:{p1:103},cooldowns:{standard:3,piercing_shell:8},towers:{p1:[[18]],p2:[[18]]}};old.Date={now:()=>104000};g.serverOffset=0;g.weapon='piercing_shell';g.localLastShot=100;assert.equal(g.reloadFrac(),1);assert.equal(g.canFire(),true);g.snap.reload_until.p1=108;assert.equal(g.canFire(),false);old.Date={now:()=>109000};assert.equal(g.canFire(),true);
g.snap.aim_guide_active=true;g.aimAngle=45;g.aimPower=50;const a=g.guidePoints();g.aimAngle=90;const b=g.guidePoints();assert.notDeepEqual(a,b);assert.equal(b.at(-1)[0],b[0][0]);
console.log('v67 timed paths/start/end/allweapons/reload switching/guide PASS');

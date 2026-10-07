import assert from'node:assert/strict';import vm from'node:vm';import fs from'node:fs';import{newState,fireWeapon}from'../dist/game/game_logic.js';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/js/physics.js','utf8'),ctx);
for(const weapon of ['standard','homing_missile','double_bomb','cluster_shell','piercing_shell','emp_shell'])for(const wind of [-24,0,24])for(const angle of [0,20,45,75,90]){
 const s=newState({dynamic_obstacle:{enabled:true,v_enabled:true,speed:20,warning_seconds:1.5,v_speed:14,v_min_lift:-120,v_max_lift:30}}, {},()=>.5,1000);s.wind=wind;
 const pred=ctx.BrigaPhysics.predict(s,'p1',angle,83,weapon,false,1000);
 const[events]=fireWeapon(structuredClone(s),'p1',angle,83,weapon,()=>.5,1000);
 assert.equal(JSON.stringify(pred),JSON.stringify(events.filter(e=>e.type==='shot')));
}
console.log('270 browser/server same-source weapon/wind/angle/moving-obstacle trajectories exact PASS');

import assert from 'node:assert/strict';import {applyTerritoryBotRules} from '../dist/game/territory_bot.js';import {botChooseWeapon,executeShot} from '../dist/game/bot.js';import {newState} from '../dist/game/game_logic.js';
for(let r=1;r<=4;r++){
const s=newState({},{});s.cooldowns={standard:3,shot_clock:3};s.ai_profile={mega_chance:.7,weapon_skill:1,aggression:1};s.bot_controls={infinite_ammo:true,deep_aim:true,tactical_mega:true};s.bot_ammo={double_bomb:4,homing_missile:4,cluster_shell:4};const original=structuredClone(s.bot_controls);applyTerritoryBotRules(s,r);assert.equal(s.cooldowns.shot_clock,6);assert.equal(s.bot_controls.infinite_ammo,false);assert.equal(original.infinite_ammo,true);
if(r<=2){assert.equal(s.bot_controls.deep_aim,false);assert.equal(s.bot_controls.tactical_mega,false);}
const total=Object.values(s.bot_ammo).reduce((a,b)=>a+b,0);assert.equal(total,r===1?0:r===2?1:3*r);
if(r===1)assert.equal(botChooseWeapon(s,()=>0),'standard');
for(const w of Object.keys(s.bot_ammo)){while(s.bot_ammo[w]>0){s.last_shot_at.p2=0;s.reload_until={};const [,err]=executeShot({state:s,p2_ai:true},'p2',45,30,w,false,null,null,()=>.5,100000);assert.equal(err,null);}s.last_shot_at.p2=0;s.reload_until={};const [,err]=executeShot({state:s,p2_ai:true},'p2',45,30,w,false,null,null,()=>.5,100000);assert.ok(err);}
console.log('territory rarity',r,'finite ammo/clock/isolation PASS');}

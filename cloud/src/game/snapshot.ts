import {towerHp, obstacleAt, cooldownFor, turnDeadline} from "./game_logic.js";
import {MATCH_DURATION_SECONDS} from "./finalize.js";
export function combatSnapshot(m:any, side:string):any {
 const s=m.state; const keys=["towers","tower_x","map","wind","last_shot_at","reload_until","shield","coatings","damage_dealt","winner_side","results","finish_reason","ready","bot_hold_until","ai_tier","ai_rank_level","emp_disabled_until","emp_immune_until","sudden_death","combat_policy"];
 const out:any={id:m.id,status:m.status,version:m.version,server_time:Date.now()/1000};
 for(const k of keys)out[k]=s[k]??null;
 out.tower_hp=s.towers?{p1:towerHp(s,"p1"),p2:towerHp(s,"p2")}:null; out.obstacle=obstacleAt(s);
 out.cooldowns=Object.fromEntries(["standard","double_bomb","homing_missile","cluster_shell","piercing_shell","emp_shell"].map(w=>[w,cooldownFor(w,s)]));
 out.moves_left=s.moves_left?.[side]??0;out.abilities=s.abilities?.[side]??{};
 out.aim_guide_active=!!s.aim_guide_active?.[side];out.aim_guide_uses=s.aim_guide_uses?.[side]??0;
 out.aim_guide_always=!!s.combat_policy?.guide_always;out.turn_deadline=turnDeadline(s,side);
 out.match_ends_at=m.status==="active"?Number(s.started_at)+MATCH_DURATION_SECONDS:null;
 out.simulation_state={towers:s.towers,tower_x:s.tower_x,wind:s.wind,obstacle:s.obstacle,obstacle_motion:s.obstacle_motion,mods:{p1:{armor:s.mods?.p1?.armor??0},p2:{armor:s.mods?.p2?.armor??0}},coatings:s.coatings,shield:s.shield,last_shot_at:s.last_shot_at,shot_count:s.shot_count,abilities:s.abilities,damage_dealt:s.damage_dealt,sudden_death:s.sudden_death};
 return out;
}

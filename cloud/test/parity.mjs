// Parity harness: run identical scenarios through the TS port and the Python
// original, compare. Run: npm run build && node test/parity.mjs
import { execFileSync } from "node:child_process";
import * as gl from "../dist/game/game_logic.js";

const mods7 = { armor:5, hp:5, skin:"skin_sun_pyramid", coating:{material:"iron",hp:130.0,max_hp:130.0},
                extra_cubes:12, expansion_cube_hp:18, dynamic_obstacle:{enabled:true,speed:20,warning_seconds:1.5} };
const modsBot = { armor:0, hp:0, skin:null };

function jsScenario() {
  const rngVals = [0.42, 0.17, 0.83, 0.55, 0.31, 0.9, 0.12, 0.66];
  let i = 0;
  const rng = () => rngVals[i++ % rngVals.length];
  const state = gl.newState(mods7, modsBot, rng, 1000.0);
  state.tower_x = { p1: 123, p2: 689 };
  state.wind = -8.4;
  const ev = [];
  const [x, y, pts, off] = gl.simulate(state, "p2", 44.91, 57.64, "standard", ev, undefined, 1000.0);
  const before = gl.towerHp(state, "p1").hp;
  const [events, won] = gl.fireWeapon(state, "p2", 44.74, 56.89, "standard", rng, 1000.0);
  const after = gl.towerHp(state, "p1").hp;
  const rng2Vals = [0.5, 0.5];
  let j = 0; const rng2 = () => rng2Vals[j++ % rng2Vals.length];
  const profile = { angle_noise:0.35, power_spread:0.004, wind_skill:1.0, correction:1.0 };
  const [a, p] = gl.aiChooseShot(state, "p2", "ranked", 18, profile, rng2);
  return { impact: [x, y], off, dmg: [before, after], coating: state.coatings.p1.hp, won,
           solver: [a, p], windAfter: state.wind, shotCount: state.shot_count };
}
const js = jsScenario();
console.log("JS  :", JSON.stringify(js));

const py = execFileSync("python3", ["-c", `
import sys, json
sys.path.insert(0, "/home/sandbox/brigagame/backend")
import game_logic as g
mods7 = {"armor":5,"hp":5,"skin":"skin_sun_pyramid","coating":{"material":"iron","hp":130.0,"max_hp":130.0},
         "extra_cubes":12,"expansion_cube_hp":18,"dynamic_obstacle":{"enabled":True,"speed":20,"warning_seconds":1.5}}
mods_bot = {"armor":0,"hp":0,"skin":None}
import random
vals = [0.42, 0.17, 0.83, 0.55, 0.31, 0.9, 0.12, 0.66]
it = iter(vals * 4)
random.uniform = lambda a, b: a + (b - a) * next(it)
random.randint = lambda a, b: a + int((b - a + 1) * next(it)) if a != b else a
random.choice = lambda seq: seq[int(len(seq) * next(it)) % len(seq)]
import time
state = g.new_state(mods7, mods_bot)
state["tower_x"] = {"p1":123,"p2":689}
state["wind"] = -8.4
orig_time = time.time
time.time = lambda: 1000.0
ev = []
x, y, pts, off = g._simulate(state, "p2", 44.91, 57.64, "standard", ev)
before = g.tower_hp(state, "p1")["hp"]
events, won = g.fire_weapon(state, "p2", 44.74, 56.89, "standard")
after = g.tower_hp(state, "p1")["hp"]
vals2 = iter([0.5, 0.5])
random.uniform = lambda a, b: a + (b - a) * next(vals2)
profile = {"angle_noise":0.35,"power_spread":0.004,"wind_skill":1.0,"correction":1.0}
state["ai_profile"] = profile; state["ai_tier"] = "expert"
a, p, w = g.ai_choose_shot(state, "p2", "ranked", 18, profile)
time.time = orig_time
print(json.dumps({"impact":[x,y],"off":off,"dmg":[before,after],"coating":state["coatings"]["p1"]["hp"],"won":won,"solver":[a,p],"windAfter":state["wind"],"shotCount":state["shot_count"]}))
`], { encoding: "utf8" });
console.log("PY  :", py.trim());
const pyObj = JSON.parse(py);
const close = (a, b) => Math.abs(a - b) < 0.6;
const checks = [
  ["impact_x", close(js.impact[0], pyObj.impact[0])],
  ["impact_y", close(js.impact[1], pyObj.impact[1])],
  ["damage_before", js.dmg[0] === pyObj.dmg[0]],
  ["damage_after", close(js.dmg[1], pyObj.dmg[1])],
  ["coating", close(js.coating, pyObj.coating)],
  ["won", js.won === pyObj.won],
  ["solver_angle", close(js.solver[0], pyObj.solver[0])],
  ["solver_power", close(js.solver[1], pyObj.solver[1])],
];
let ok = true;
for (const [name, pass] of checks) { if (!pass) ok = false; console.log(pass ? "PASS" : "FAIL", name); }
console.log(ok ? "PARITY OK" : "PARITY MISMATCH");
process.exit(ok ? 0 : 1);
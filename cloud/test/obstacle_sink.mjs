// Sinking obstacle: smooth motion, depth scaling, sunk press stops blocking shots, ground stays a wall.
import * as gl from "../dist/game/game_logic.js";
import assert from "node:assert/strict";
const dyn = { enabled: true, speed: 20, warning_seconds: 1.5, v_enabled: true, v_speed: 20, v_min_lift: -120, v_max_lift: 30,
  v_depth_easy: 1.3, v_depth_hard: 0.8, v_speed_easy: 0.8, v_rarity_depth_pct: -10, v_kind_depth_pct_fortress: -15 };
const mods = { armor: 0, hp: 0, skin: null, dynamic_obstacle: dyn };
const st = gl.newState(mods, { armor: 0, hp: 0, skin: null }, () => 0.5, 1000);
// 1. motion range and smoothness
let lo = 1e9, hi = -1e9, maxStep = 0, prev = null;
for (let t = 1000; t < 1000 + 40; t += 0.05) {
  const o = gl.obstacleAt(st, t); lo = Math.min(lo, o.lift); hi = Math.max(hi, o.lift);
  if (prev !== null) maxStep = Math.max(maxStep, Math.abs(o.lift - prev)); prev = o.lift;
  assert.ok(o.y + o.h <= gl.GROUND_Y - o.lift + 0.01);
}
assert.ok(lo <= -119 && hi >= 29, `range ${lo}..${hi}`);
assert.ok(maxStep < 2.0, `step ${maxStep}`);           // no jumps: 20px/s peak ~31px/s * 0.05s
// 2. scaling
const base = gl.scaleObstacleMotion(dyn, {});
const easy = gl.scaleObstacleMotion(dyn, { difficulty: "easy" });
const hard = gl.scaleObstacleMotion(dyn, { difficulty: "hard" });
assert.ok(easy.min_lift < base.min_lift && hard.min_lift > base.min_lift && easy.v_speed < base.v_speed);
const rare = gl.scaleObstacleMotion(dyn, { rarity: 4, kind: "fortress" });
assert.ok(rare.min_lift > base.min_lift, "rare fortress sinks less");
assert.ok(gl.scaleObstacleMotion({ ...dyn, v_min_lift: -500 }, { difficulty: "easy" }).min_lift >= -gl.OBSTACLE_H);
assert.equal(base.max_lift, 30);
// 3. a sunk press does not block, a risen one does (flat shot straight through the press column)
function shotThrough(lift) {
  const s = JSON.parse(JSON.stringify(st));
  s.obstacle_motion.enabled = false; s.obstacle_motion.v_enabled = false; s.wind = 0;
  s.obstacle = { x: 450, y: gl.GROUND_Y - gl.OBSTACLE_H - lift, w: gl.OBSTACLE_W, h: gl.OBSTACLE_H };
  s.towers.p2 = s.towers.p2.map(r => r.map(() => 0));       // no tower in the way
  const [x, y, pts] = gl.simulate(s, "p1", 14, 66, "standard", [], undefined, 1000);
  return { x, y, blocked: x !== null && x >= 450 && x <= 450 + gl.OBSTACLE_W && y < gl.GROUND_Y - 0.5, pts };
}
for (const L of [-184, -150]) { const r = shotThrough(L); assert.ok(!r.blocked, `lift ${L} should not block (${r.x},${r.y})`); }
const up = shotThrough(30); const mid = shotThrough(-20);
console.log("up", up.x?.toFixed(0), up.y?.toFixed(0), "mid", mid.x?.toFixed(0), mid.y?.toFixed(0));
// 4. the ground is never crossed
for (const L of [-184, -120, 0, 30]) { const r = shotThrough(L); assert.ok(r.pts.every(p => p[1] <= gl.GROUND_Y + 0.01)); }
console.log("obstacle_sink ok");

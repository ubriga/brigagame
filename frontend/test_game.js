// Deterministic presentation-physics checks. Run with: node frontend/test_game.js
const fs = require("fs");
const vm = require("vm");
const src = fs.readFileSync(__dirname + "/js/game.js", "utf8")
  .replace("const GameView =", "globalThis.GameView =");
const sandbox = {
  console, setTimeout, clearTimeout,
  window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  document: { hidden: false, getElementById() { return null; } },
  performance: { now() { return 0; } },
  requestAnimationFrame() {}, cancelAnimationFrame() {},
  CONFIG: {}, API: {}, Sfx: { play() {} }, toast() {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const g = sandbox.GameView;
function reset(wind) {
  g.snap = { wind, towers: { p1: [], p2: [] }, you: "p1" };
  g.cloudOffsets = [100, 500];
  g.anims = []; g.particles = []; g.blockTransitions = [];
  g.cannonRecoil = { p1: 0, p2: 0 };
  g.displayAngles = { p1: 45, p2: 45 };
  g.shake = 0; g.idleClock = 0;
}
reset(40); g.stepAnims(1 / 30); const right = [...g.cloudOffsets];
reset(-40); g.stepAnims(1 / 30); const left = [...g.cloudOffsets];
if (!(right[0] > 100 && right[1] > 500 && left[0] < 100 && left[1] < 500))
  throw new Error(`cloud direction regression: right=${right}, left=${left}`);
if (!((right[1] - 500) > (right[0] - 100)))
  throw new Error(`cloud depth-speed regression: ${right}`);
if (g.WIND_ACCEL !== 0.75)
  throw new Error(`frontend wind acceleration mismatch: ${g.WIND_ACCEL}`);
console.log("PASS cloud direction follows wind");
console.log("PASS cloud speed follows wind strength with layered depth");
console.log("PASS frontend wind acceleration is 0.75");

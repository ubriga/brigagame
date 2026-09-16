const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(__dirname + "/js/game.js", "utf8").replace("const GameView =", "globalThis.GameView =");
const handlers = {};
const canvas = {
  addEventListener(type, fn) { handlers[type] = fn; },
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 560 }; },
  setPointerCapture() {}
};
const sandbox = {
  console, setTimeout, clearTimeout, performance: { now: () => 0 },
  requestAnimationFrame() {}, cancelAnimationFrame() {}, CONFIG: {}, API: {}, toast() {},
  Sfx: { play() {} }, window: { addEventListener() {}, removeEventListener() {} },
  document: { hidden: false, activeElement: null, getElementById() { return null; } }
};
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const g = sandbox.GameView;
g.canvas = canvas; g.snap = { status: "active", you: "p1", towers: { p1: [], p2: [] } };
g.tx = () => 140; g.canFire = () => true;
let shots = 0; g.fire = () => { shots++; };
g.bindInput();
const ev = (x,y,id=1) => ({ clientX:x, clientY:y, pointerId:id });
handlers.pointerdown(ev(500,250)); handlers.pointerup(ev(520,250));
if (shots !== 0) throw new Error("battlefield pan fired a shot");
handlers.pointerdown(ev(192,356)); handlers.pointerup(ev(192,356));
if (shots !== 0) throw new Error("tap near tower fired a shot");
handlers.pointerdown(ev(192,356)); handlers.pointermove(ev(250,300)); handlers.pointerup(ev(250,300));
if (shots !== 1) throw new Error(`real aim drag did not fire exactly once: ${shots}`);
handlers.pointerdown(ev(192,356)); handlers.pointercancel(ev(260,290)); handlers.pointerup(ev(260,290));
if (shots !== 1) throw new Error("cancelled gesture fired a shot");
console.log("PASS battlefield pan does not fire");
console.log("PASS tower tap does not fire");
console.log("PASS deliberate tower drag fires once");
console.log("PASS cancelled gesture does not fire");

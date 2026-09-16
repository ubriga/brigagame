// Audio lifecycle regressions. Run with: node frontend/test_audio.js
const fs = require("fs");
const vm = require("vm");
const src = fs.readFileSync(__dirname + "/js/audio.js", "utf8")
  .replace("const Sfx =", "globalThis.Sfx =");
let resumeCalls = 0, starts = 0;
class FakeAudioContext {
  constructor() { this.state = "suspended"; this.currentTime = 0; this.destination = {}; this.sampleRate = 8; }
  async resume() { resumeCalls++; this.state = "running"; }
  createOscillator() { return { type:"", frequency:{value:0}, connect(){return this;}, start(){starts++;}, stop(){} }; }
  createGain() { return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){return this;} }; }
  createBufferSource() { return { playbackRate:{value:1}, connect(){return this;}, start(){starts++;} }; }
  createBuffer() { return { getChannelData(){ return new Float32Array(4); } }; }
  createBiquadFilter() { return { frequency:{setValueAtTime(){}, exponentialRampToValueAtTime(){}}, connect(){return this;} }; }
}
const sandbox = {
  console, setTimeout(){ return 1; }, clearTimeout(){},
  localStorage:{ getItem(){return null;}, setItem(){} },
  window:{ AudioContext:FakeAudioContext }, fetch:async()=>{throw new Error("offline")},
  Promise, Math, Float32Array
};
vm.createContext(sandbox); vm.runInContext(src, sandbox);
(async () => {
  const ok = await sandbox.Sfx.unlock();
  if (!ok || resumeCalls !== 1 || sandbox.Sfx.ctx.state !== "running")
    throw new Error("first gesture did not await AudioContext resume");
  if (!sandbox.Sfx.musicOn || starts < 1)
    throw new Error("saved-session launch did not start music after unlock");
  console.log("PASS first gesture resumes audio context");
  console.log("PASS saved-session launch starts background music");
  sandbox.Sfx.muted = true; sandbox.Sfx.stopMusic(); await sandbox.Sfx.unlock();
  if (sandbox.Sfx.musicOn) throw new Error("muted unlock started music");
  console.log("PASS muted launch stays silent");
})().catch(e => { console.error(e); process.exit(1); });

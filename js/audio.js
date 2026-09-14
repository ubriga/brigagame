// Original WebAudio-synthesized SFX + music loop. No external assets,
// so there are no licensing concerns at all.
const Sfx = {
  ctx: null,
  muted: localStorage.getItem("bg_muted") === "1",
  musicOn: false,
  _musicTimer: null,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem("bg_muted", this.muted ? "1" : "0");
    if (this.muted) this.stopMusic(); else this.startMusic();
    return this.muted;
  },

  _env(gainNode, t0, a, peak, d) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  },

  play(type) {
    if (this.muted || !this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (type === "shot") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.25);
      this._env(g, t, 0.01, 0.25, 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.3);
    } else if (type === "explosion") {
      const len = ctx.sampleRate * 0.5;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(80, t + 0.45);
      const g = ctx.createGain(); this._env(g, t, 0.01, 0.5, 0.45);
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t);
      const o = ctx.createOscillator(), g2 = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
      this._env(g2, t, 0.01, 0.4, 0.4);
      o.connect(g2).connect(ctx.destination); o.start(t); o.stop(t + 0.45);
    } else if (type === "win") {
      [523, 659, 784, 1047].forEach((fq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = fq;
        this._env(g, t + i * 0.12, 0.02, 0.2, 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.35);
      });
    } else if (type === "lose") {
      [392, 330, 262].forEach((fq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = fq;
        this._env(g, t + i * 0.15, 0.02, 0.18, 0.35);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.15); o.stop(t + i * 0.15 + 0.4);
      });
    } else if (type === "click") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 880;
      this._env(g, t, 0.005, 0.08, 0.05);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.07);
    } else if (type === "coin") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(988, t);
      o.frequency.setValueAtTime(1319, t + 0.07);
      this._env(g, t, 0.01, 0.15, 0.18);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.25);
    }
  },

  // Short original 8-bar chiptune-style loop.
  startMusic() {
    if (this.muted || this.musicOn || !this.ensure()) return;
    this.musicOn = true;
    const ctx = this.ctx;
    const melody = [262, 330, 392, 330, 294, 349, 440, 349,
                    262, 330, 392, 523, 440, 392, 330, 294];
    let step = 0;
    const tick = () => {
      if (!this.musicOn) return;
      const t = ctx.currentTime;
      const fq = melody[step % melody.length];
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = fq;
      this._env(g, t, 0.02, 0.06, 0.22);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.25);
      if (step % 4 === 0) {
        const b = ctx.createOscillator(), gb = ctx.createGain();
        b.type = "sine"; b.frequency.value = fq / 2;
        this._env(gb, t, 0.02, 0.08, 0.3);
        b.connect(gb).connect(ctx.destination); b.start(t); b.stop(t + 0.35);
      }
      step++;
      this._musicTimer = setTimeout(tick, 240);
    };
    tick();
  },

  stopMusic() {
    this.musicOn = false;
    clearTimeout(this._musicTimer);
  },
};

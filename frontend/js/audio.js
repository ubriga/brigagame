// Brigagame audio: real CC0 samples (see assets/sfx/CREDITS.md) through Web
// Audio, with the original code-synthesized sounds as fallback if a sample
// cannot be decoded. Samples preload at page load; the AudioContext is
// created lazily and resumed on the first user gesture so mobile autoplay
// policy never blocks us. Mute persists in localStorage.
const Sfx = {
  ctx: null,
  muted: localStorage.getItem("bg_muted") === "1",
  musicOn: false,
  _musicTimer: null,
  _buffers: {},   // name -> AudioBuffer | "error"
  _loading: null, // shared preload promise

  FILES: {
    shot: "assets/sfx/shot.mp3",
    explosion: "assets/sfx/explosion.mp3",
    crumble: "assets/sfx/crumble.mp3",
    click: "assets/sfx/click.mp3",
    coin: "assets/sfx/coin.mp3",
    win: "assets/sfx/win.mp3",
    lose: "assets/sfx/lose.mp3",
  },
  // Per-sound loudness trim on top of the normalized files.
  GAIN: { shot: 0.9, explosion: 1, crumble: 0.85, click: 0.45, coin: 0.7, win: 0.9, lose: 0.9 },

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  // Called from the first pointer/key gesture anywhere in the app (mobile
  // autoplay unlock). Harmless to call often.
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") ctx.resume();
  },

  // Fetch + decode every sample once. Decoding works even while the context
  // is still suspended, so this can start before the first gesture.
  preload() {
    if (this._loading) return this._loading;
    const ctx = this.ensure();
    if (!ctx) return Promise.resolve();
    this._loading = Promise.all(Object.entries(this.FILES).map(async ([name, url]) => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error("http " + r.status);
        const raw = await r.arrayBuffer();
        this._buffers[name] = await ctx.decodeAudioData(raw);
      } catch (e) {
        this._buffers[name] = "error"; // synth fallback covers this sound
      }
    }));
    return this._loading;
  },

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem("bg_muted", this.muted ? "1" : "0");
    if (this.muted) this.stopMusic(); else this.startMusic();
    return this.muted;
  },

  play(type) {
    if (this.muted || !this.ensure()) return;
    const ctx = this.ctx;
    const buf = this._buffers[type];
    if (buf === "error") { this._synth(type); return; }
    if (!buf) {
      // Not decoded yet: fall back to the synth for this play and make sure
      // the preload is running so the next one is the real sample.
      this._synth(type);
      this.preload();
      return;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Slight pitch wobble keeps repeated artillery sounds from going stale.
    if (type === "shot" || type === "explosion" || type === "crumble")
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = ctx.createGain();
    g.gain.value = this.GAIN[type] != null ? this.GAIN[type] : 0.8;
    src.connect(g).connect(ctx.destination);
    src.start(t);
  },

  _env(gainNode, t0, a, peak, d) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  },

  // Original WebAudio-synthesized SFX, kept as the per-sound fallback.
  _synth(type) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (type === "shot") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.25);
      this._env(g, t, 0.01, 0.25, 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.3);
    } else if (type === "explosion" || type === "crumble") {
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

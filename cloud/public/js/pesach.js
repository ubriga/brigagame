/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
// Secret night mode ("Pesach egg") plus a rotating tips line in the lobby.
// Trigger: press and hold the "Brigagame 2.0" title for 5 seconds (toggles).
// Effects: twinkling stars, fireworks after every hit, a different music loop.
// Everything is generated in code (canvas + WebAudio): no external assets.
const PesachNight = {
  on: false, canvas: null, ctx: null, stars: [], sparks: [], raf: 0, holdTimer: 0, startXY: null,
  KEY: "bg_night",
  HOLD_MS: 5000,

  init() {
    try { this.on = localStorage.getItem(this.KEY) === "1"; } catch (e) { this.on = false; }
    document.addEventListener("pointerdown", (e) => this.down(e), true);
    ["pointerup", "pointercancel"].forEach(t => document.addEventListener(t, () => this.cancel(), true));
    document.addEventListener("pointermove", (e) => {
      if (!this.startXY) return;
      if (Math.hypot(e.clientX - this.startXY[0], e.clientY - this.startXY[1]) > 14) this.cancel();
    }, true);
    document.addEventListener("contextmenu", (e) => { if (this.startXY) e.preventDefault(); }, true);
    setInterval(() => this.tickLobby(), 1000);
    this.rotateTips();
    this.apply();
  },

  isTitle(el) { return !!(el && el.closest && el.closest(".brand, .lobby-title")); },
  down(e) {
    if (!this.isTitle(e.target)) return;
    this.startXY = [e.clientX, e.clientY];
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => { this.startXY = null; this.toggle(); }, this.HOLD_MS);
  },
  cancel() { clearTimeout(this.holdTimer); this.startXY = null; },

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem(this.KEY, this.on ? "1" : "0"); } catch (e) {}
    this.apply();
    const en = typeof Lang !== "undefined" && Lang.current === "en";
    if (this.on) { this.firework(); setTimeout(() => this.firework(), 350); }
    try { if (typeof toast === "function")
      toast(this.on ? (en ? "🌌 Secret night mode on ✨" : "🌌 מצב לילה סודי הופעל ✨")
                    : (en ? "Night mode off" : "מצב לילה כבוי"), 3500); } catch (e) {}
  },

  apply() {
    document.body.classList.toggle("pesach-night", this.on);
    if (this.on) this.startSky(); else this.stopSky();
  },

  // ---- starry sky overlay -------------------------------------------------
  startSky() {
    if (!this.canvas) {
      const c = document.createElement("canvas");
      c.id = "night-fx"; c.setAttribute("aria-hidden", "true");
      document.body.appendChild(c);
      this.canvas = c; this.ctx = c.getContext("2d");
      window.addEventListener("resize", () => this.resize());
    }
    this.canvas.style.display = "block";
    this.resize();
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  },
  stopSky() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this._lt = 0; this.sparks = [];
    if (this.canvas) this.canvas.style.display = "none";
  },
  resize() {
    if (!this.canvas) return;
    const w = this.canvas.width = innerWidth, h = this.canvas.height = innerHeight;
    const n = Math.min(90, Math.round(w * h / 14000));
    this.stars = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h * 0.75,
      r: 0.5 + Math.random() * 1.4, p: Math.random() * 6.28, s: 0.6 + Math.random() * 1.8,
    }));
  },
  frame(t) {
    const c = this.ctx, w = this.canvas.width, h = this.canvas.height;
    const dt = Math.min(0.05, this._lt ? (t - this._lt) / 1000 : 0.016); this._lt = t; const k = dt / 0.016;
    c.clearRect(0, 0, w, h);
    const gl = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, h * 0.8);
    gl.addColorStop(0, "rgba(60,40,140,.22)"); gl.addColorStop(1, "rgba(0,0,0,0)");
    c.globalAlpha = 1; c.fillStyle = gl; c.fillRect(0, 0, w, h);
    for (const s of this.stars) {
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t / 1000 * s.s + s.p));
      c.globalAlpha = a; c.fillStyle = "#fff6d8";
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.283); c.fill();
    }
    c.globalCompositeOperation = "lighter";
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life -= dt; if (p.life <= 0) { this.sparks.splice(i, 1); continue; }
      p.vy += 0.06 * k; p.vx *= Math.pow(0.985, k); p.x += p.vx * k; p.y += p.vy * k;
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
    }
    c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  },

  // ---- fireworks ------------------------------------------------------------
  firework(anchor) {
    if (!this.on) return;
    if (!this.canvas) this.startSky();
    let x, y;
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    if (r) { x = r.left + r.width * (0.2 + Math.random() * 0.6); y = r.top + r.height * (0.12 + Math.random() * 0.3); }
    else { x = innerWidth * (0.2 + Math.random() * 0.6); y = innerHeight * (0.15 + Math.random() * 0.25); }
    const hue = Math.floor(Math.random() * 360), n = 46;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + Math.random() * 0.2, v = 1.6 + Math.random() * 2.6;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, r: 1.4 + Math.random() * 1.6,
        life: 1.1 + Math.random() * 0.6, max: 1.7, col: `hsl(${(hue + Math.random() * 50) % 360},95%,62%)` });
    }
    if (this.sparks.length > 700) this.sparks.splice(0, this.sparks.length - 700);
    this.pop();
  },
  pop() {
    try {
      if (typeof Sfx === "undefined" || Sfx.muted || !Sfx.ensure()) return;
      const ctx = Sfx.ctx, t = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * 0.25), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = ctx.createBufferSource(); src.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      src.connect(f).connect(g).connect(ctx.destination); src.start(t);
    } catch (e) {}
  },

  // ---- tips line --------------------------------------------------------------
  TIPS_HE: [
    "💨 הרוח משתנה אחרי כל ירייה - תסתכל על החץ לפני שמשחררים.",
    "🎯 משחק מול בוט קל הוא תרגול בלי דירוג - מקום טוב להתחיל בו.",
    "🛡️ מגן קונה לך תור. לפעמים הגנה חכמה שווה יותר מירייה.",
    "🔥 כניסה כל יום ממשיכה את הרצף ונותנת מטבעות.",
    "🏗️ בסדנת המגדל אפשר לשדרג ולשנות את המראה של המגדל.",
    "✨ אומרים שיש לילה שלא נגמר... מי שנשאר לחוץ במקום הנכון, מגלה.",
  ],
  TIPS_EN: [
    "💨 The wind changes after every shot - check the arrow before you release.",
    "🎯 A game against the easy bot is practice with no ranking - a good place to start.",
    "🛡️ A shield buys you a turn. Smart defence can beat a shot.",
    "🔥 Logging in every day keeps your streak going and earns coins.",
    "🏗️ The tower workshop lets you upgrade and restyle your tower.",
    "✨ They say there is a night that never ends... hold the right spot long enough and you will find it.",
  ],
  tipIdx: 0,
  tips() { return (typeof Lang !== "undefined" && Lang.current === "en") ? this.TIPS_EN : this.TIPS_HE; },
  tickLobby() {
    const view = document.getElementById("view");
    if (!view || !/^#\/lobby/.test(location.hash)) return;
    const h1 = view.querySelector("h1");
    if (!h1 || h1.parentElement !== view || view.querySelector("#tip-line")) return;
    if (!view.querySelector(".lobby-title")) {
      const lt = document.createElement("div");
      lt.className = "lobby-title"; lt.textContent = "🎯 Brigagame 2.0";
      view.insertBefore(lt, h1);
    }
    const sub = h1.nextElementSibling && h1.nextElementSibling.classList.contains("sub") ? h1.nextElementSibling : h1;
    const tip = document.createElement("div");
    tip.id = "tip-line"; tip.className = "sub tip-line";
    tip.textContent = this.tips()[this.tipIdx % this.tips().length];
    sub.insertAdjacentElement("afterend", tip);
  },
  rotateTips() {
    setInterval(() => {
      const el = document.getElementById("tip-line");
      if (!el) return;
      el.classList.add("tip-out");
      setTimeout(() => {
        this.tipIdx = (this.tipIdx + 1) % this.tips().length;
        el.textContent = this.tips()[this.tipIdx];
        el.classList.remove("tip-out");
      }, 400);
    }, 12000);
  },
};
document.addEventListener("DOMContentLoaded", () => PesachNight.init());

// Game screen: canvas rendering, drag aiming, polling, animations.
// Rendering only - every rule is enforced by the server.
const GameView = {
  matchId: null, snap: null, pollTimer: null, raf: null,
  canvas: null, ctx: null, scale: 1,
  weapon: "standard", ammo: {},
  aiming: false, aimAngle: 45, aimPower: 50,
  anims: [], processing: false,
  serverOffset: 0, onExit: null,

  W: 1000, H: 560, GROUND: 520, BLOCK: 26, TROWS: 6, TCOLS: 4,
  TX: { p1: 140, p2: 760 },

  async init(root, matchId, onExit) {
    this.matchId = matchId; this.onExit = onExit;
    this.anims = []; this.weapon = "standard"; this.snap = null;
    root.innerHTML = `
      <div id="game-hud">
        <div class="player-tag" id="tag-p1"></div>
        <div id="wind-ind">💨 ...</div>
        <div class="player-tag" id="tag-p2"></div>
      </div>
      <div id="game-stage">
        <canvas id="game-canvas" width="1000" height="560"></canvas>
        <div id="game-overlay" class="hidden"></div>
      </div>
      <div id="reload-wrap"><div id="reload-bar"></div></div>
      <div id="aim-info">זווית 45° · עוצמה 50</div>
      <div id="weapon-bar"></div>
      <p class="sub" style="margin-top:10px">גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות. הרוח מזיזה את הפגז באוויר.</p>`;
    this.canvas = document.getElementById("game-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.bindInput();
    await this.refresh(0);
    this.pollTimer = setInterval(() => this.poll(), CONFIG.POLL_MS);
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  },

  destroy() {
    clearInterval(this.pollTimer);
    cancelAnimationFrame(this.raf);
    this.canvas = null;
  },

  mySide() { return this.snap ? this.snap.you : "p1"; },
  facing() { return this.mySide() === "p1" ? 1 : -1; },
  muzzle(side) {
    return { x: this.TX[side] + this.TCOLS * this.BLOCK / 2,
             y: this.GROUND - this.TROWS * this.BLOCK - 8 };
  },

  bindInput() {
    const cv = this.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (this.W / r.width),
               y: (e.clientY - r.top) * (this.H / r.height) };
    };
    const updateAim = (p) => {
      const m = this.muzzle(this.mySide());
      const dx = (p.x - m.x) * this.facing();
      const dy = m.y - p.y;
      let ang = Math.atan2(dy, Math.max(1, dx)) * 180 / Math.PI;
      ang = Math.max(0, Math.min(90, ang));
      const dist = Math.hypot(p.x - m.x, p.y - m.y);
      this.aimAngle = Math.round(ang);
      this.aimPower = Math.max(5, Math.min(100, Math.round(dist / 3.2)));
      const el = document.getElementById("aim-info");
      if (el) el.textContent = `זווית ${this.aimAngle}° · עוצמה ${this.aimPower}`;
    };
    cv.addEventListener("pointerdown", (e) => {
      if (!this.canFire()) return;
      this.aiming = true; cv.setPointerCapture(e.pointerId); updateAim(pos(e));
    });
    cv.addEventListener("pointermove", (e) => { if (this.aiming) updateAim(pos(e)); });
    cv.addEventListener("pointerup", (e) => {
      if (!this.aiming) return;
      this.aiming = false; updateAim(pos(e)); this.fire();
    });
  },

  canFire() {
    if (!this.snap || this.snap.status !== "active") return false;
    return this.reloadFrac() >= 1;
  },

  cooldown() {
    return { standard: 4, double_bomb: 5, homing_missile: 5, cluster_shell: 6 }[this.weapon] || 4;
  },

  reloadFrac() {
    if (!this.snap) return 0;
    const last = (this.snap.last_shot_at || {})[this.mySide()] || 0;
    const nowSrv = Date.now() / 1000 + this.serverOffset;
    return Math.max(0, Math.min(1, (nowSrv - last) / this.cooldown()));
  },

  async refresh(since) {
    const { status, data } = await API.get(
      `/api/matches/${this.matchId}/state?since=${since}`);
    if (status !== 200) { toast("בעיה בטעינת המשחק"); return; }
    this.applySnap(data);
  },

  async poll() {
    if (!this.snap) return;
    const { status, data } = await API.get(
      `/api/matches/${this.matchId}/state?since=${this.snap.version}`);
    if (status === 200) this.applySnap(data);
  },

  applySnap(s) {
    const prevV = this.snap ? this.snap.version : -1;
    this.serverOffset = s.server_time - Date.now() / 1000;
    const events = s.events || [];
    delete s.events;
    this.snap = s;
    this.renderHud();
    this.renderWeapons();
    if (s.version > prevV) this.enqueue(events);
    if (s.status === "finished") this.showEnd();
  },

  renderHud() {
    const s = this.snap; if (!s) return;
    for (const side of ["p1", "p2"]) {
      const p = s.players[side] || {};
      const el = document.getElementById("tag-" + side);
      if (!el) continue;
      el.classList.toggle("me", side === s.you);
      el.innerHTML = `${p.picture ? `<img src="${esc(p.picture)}" alt="">` : "🤖"}
        <span>${esc(p.name || "?")}</span>
        <span class="rank">${esc(p.rank || "")}</span>`;
    }
    const w = document.getElementById("wind-ind");
    if (w) {
      const v = s.wind || 0;
      w.textContent = `💨 ${v === 0 ? "ללא רוח" : (v > 0 ? "→" : "←") + " " + Math.abs(v)}`;
    }
  },

  renderWeapons() {
    const bar = document.getElementById("weapon-bar");
    if (!bar) return;
    const inv = this._inventory || {};
    const names = { standard: "🎯 רגיל (∞)", double_bomb: "💣 כפולה",
                    homing_missile: "🚀 מסתובב", cluster_shell: "🎇 מרושת" };
    bar.innerHTML = "";
    for (const [id, label] of Object.entries(names)) {
      const qty = id === "standard" ? null : (inv[id] ? inv[id].qty : 0);
      const b = document.createElement("button");
      b.className = "wpn" + (this.weapon === id ? " sel" : "");
      b.textContent = qty === null ? label : `${label} (${qty})`;
      b.disabled = qty !== null && qty <= 0;
      b.onclick = () => { this.weapon = id; Sfx.play("click"); this.renderWeapons(); };
      bar.appendChild(b);
    }
  },

  setInventory(inv) { this._inventory = inv; if (this.canvas) this.renderWeapons(); },

  async fire() {
    if (!this.canFire()) return;
    Sfx.play("shot");
    const { status, data } = await API.post(`/api/matches/${this.matchId}/fire`, {
      angle: this.aimAngle, power: this.aimPower, weapon: this.weapon,
    });
    if (status === 200) {
      this.applySnap(data);
      if (this.weapon !== "standard" && this._inventory?.[this.weapon]) {
        this._inventory[this.weapon].qty--;
        this.renderWeapons();
      }
      if (window.refreshMe) window.refreshMe();
    } else if (data.error_he) {
      toast(data.error_he);
    }
  },

  // ---------------- animations ----------------
  enqueue(events) {
    for (const ev of events) {
      if (ev.type === "shot" && ev.points && ev.points.length > 1)
        this.anims.push({ kind: "shot", points: ev.points, t: 0, weapon: ev.weapon });
      else if (ev.type === "explosion")
        this.anims.push({ kind: "explosion", x: ev.x, y: ev.y, r: ev.radius, t: 0 });
      else if (ev.type === "match_end") { /* handled by status */ }
    }
  },

  stepAnims(dt) {
    let boom = false;
    for (const a of this.anims) {
      if (a.kind === "shot") a.t += dt / Math.min(1.6, a.points.length * 0.045);
      else { a.t += dt / 0.55; if (a.t >= 0.05 && !a.sfx) { a.sfx = 1; boom = true; } }
    }
    if (boom) Sfx.play("explosion");
    this.anims = this.anims.filter(a => a.t < 1);
  },

  // ---------------- drawing ----------------
  draw() {
    if (!this.ctx || !this.snap) return;
    const c = this.ctx, now = performance.now();
    const dt = this._last ? (now - this._last) / 1000 : 0.016;
    this._last = now;
    this.stepAnims(dt);

    // sky
    const sky = c.createLinearGradient(0, 0, 0, this.H);
    sky.addColorStop(0, "#1e3a5f"); sky.addColorStop(1, "#0f1e33");
    c.fillStyle = sky; c.fillRect(0, 0, this.W, this.H);
    // clouds
    c.fillStyle = "rgba(255,255,255,0.07)";
    const ct = now / 4000;
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 260 + ct * (20 + i * 7)) % 1200) - 100;
      c.beginPath(); c.ellipse(cx, 60 + i * 32, 60, 16, 0, 0, 7); c.fill();
    }
    // ground
    const g = c.createLinearGradient(0, this.GROUND, 0, this.H);
    g.addColorStop(0, "#3f6212"); g.addColorStop(1, "#1a2e05");
    c.fillStyle = g; c.fillRect(0, this.GROUND, this.W, this.H - this.GROUND);

    // towers
    for (const side of ["p1", "p2"]) this.drawTower(side);
    // cannons
    for (const side of ["p1", "p2"]) this.drawCannon(side);
    // aim arrow
    if (this.aiming && this.canFire()) this.drawAim();
    // animations
    for (const a of this.anims) {
      if (a.kind === "shot") {
        const n = a.points.length;
        const fi = Math.min(n - 1, a.t * n), i = Math.floor(fi), f = fi - i;
        const p0 = a.points[i], p1 = a.points[Math.min(n - 1, i + 1)];
        const x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f;
        // trail
        c.strokeStyle = "rgba(251,191,36,.5)"; c.lineWidth = 2; c.beginPath();
        const upto = Math.max(1, Math.floor(fi));
        c.moveTo(a.points[0][0], a.points[0][1]);
        for (let k = 1; k <= upto; k++) c.lineTo(a.points[k][0], a.points[k][1]);
        c.lineTo(x, y); c.stroke();
        c.fillStyle = a.weapon === "cluster_mini" ? "#fb923c" : "#fde047";
        c.beginPath(); c.arc(x, y, a.weapon === "cluster_mini" ? 4 : 6, 0, 7); c.fill();
      } else {
        const r = a.r * (0.3 + 0.7 * a.t);
        const grad = c.createRadialGradient(a.x, a.y, 2, a.x, a.y, r);
        grad.addColorStop(0, `rgba(254,240,138,${0.9 * (1 - a.t)})`);
        grad.addColorStop(0.6, `rgba(249,115,22,${0.7 * (1 - a.t)})`);
        grad.addColorStop(1, "rgba(249,115,22,0)");
        c.fillStyle = grad;
        c.beginPath(); c.arc(a.x, a.y, r, 0, 7); c.fill();
      }
    }
    // reload bar
    const bar = document.getElementById("reload-bar");
    if (bar) bar.style.width = (this.reloadFrac() * 100) + "%";
  },

  drawTower(side) {
    const c = this.ctx, tower = this.snap.towers[side];
    const cols = this.snap.skins[side] || ["#3b82f6", "#1e3a8a"];
    for (let r = 0; r < this.TROWS; r++) {
      for (let col = 0; col < this.TCOLS; col++) {
        const hp = tower[r][col];
        if (hp <= 0) continue;
        const x = this.TX[side] + col * this.BLOCK;
        const y = this.GROUND - (this.TROWS - r) * this.BLOCK;
        const frac = Math.min(1, hp / 20);
        c.fillStyle = cols[0];
        c.globalAlpha = 0.45 + 0.55 * frac;
        c.fillRect(x + 1, y + 1, this.BLOCK - 2, this.BLOCK - 2);
        c.globalAlpha = 1;
        c.strokeStyle = cols[1]; c.lineWidth = 2;
        c.strokeRect(x + 1, y + 1, this.BLOCK - 2, this.BLOCK - 2);
        if (frac < 0.6) {  // cracks
          c.strokeStyle = "rgba(0,0,0,.5)"; c.lineWidth = 1;
          c.beginPath(); c.moveTo(x + 5, y + 5); c.lineTo(x + 18, y + 16);
          c.moveTo(x + 20, y + 6); c.lineTo(x + 9, y + 21); c.stroke();
        }
      }
    }
  },

  drawCannon(side) {
    const c = this.ctx, m = this.muzzle(side);
    const isMe = side === this.mySide();
    const ang = (isMe ? this.aimAngle : 45) * Math.PI / 180;
    const f = side === "p1" ? 1 : -1;
    c.save(); c.translate(m.x, m.y);
    c.rotate(-f * ang);
    c.fillStyle = "#475569";
    c.fillRect(0, -5, 30 * f, 10);
    c.restore();
    c.fillStyle = "#64748b";
    c.beginPath(); c.arc(m.x, m.y, 9, 0, 7); c.fill();
  },

  drawAim() {
    const c = this.ctx, m = this.muzzle(this.mySide());
    const ang = this.aimAngle * Math.PI / 180, f = this.facing();
    const len = 30 + this.aimPower * 1.2;
    const ex = m.x + f * Math.cos(ang) * len, ey = m.y - Math.sin(ang) * len;
    c.strokeStyle = "#38bdf8"; c.lineWidth = 3; c.setLineDash([7, 6]);
    c.beginPath(); c.moveTo(m.x, m.y); c.lineTo(ex, ey); c.stroke();
    c.setLineDash([]);
    c.fillStyle = "#38bdf8";
    c.beginPath(); c.arc(ex, ey, 5, 0, 7); c.fill();
  },

  showEnd() {
    clearInterval(this.pollTimer);
    const s = this.snap, ov = document.getElementById("game-overlay");
    const iWon = s.winner_side === s.you;
    const res = (s.results || {})[s.you] || {};
    if (iWon) Sfx.play("win"); else Sfx.play("lose");
    ov.classList.remove("hidden");
    ov.innerHTML = `
      <h2>${iWon ? "🏆 ניצחת!" : "😞 הפסדת"}</h2>
      <p>${res.coins != null ? `🪙 +${res.coins} מטבעות` : ""}
         ${res.rating_delta != null ? ` · דירוג ${res.rating_delta > 0 ? "+" : ""}${res.rating_delta}` : ""}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button class="btn" id="again-btn">עוד משחק</button>
        <button class="btn secondary" id="lobby-btn">חזרה ללובי</button>
      </div>`;
    document.getElementById("again-btn").onclick = () => { Sfx.play("click"); location.hash = "#/lobby"; };
    document.getElementById("lobby-btn").onclick = () => { Sfx.play("click"); location.hash = "#/lobby"; };
    if (window.refreshMe) window.refreshMe();
  },
};

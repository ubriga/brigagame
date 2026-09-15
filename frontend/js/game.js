// Game screen: canvas rendering, drag aiming, polling, animations.
// Rendering only - every rule is enforced by the server.
const GameView = {
  matchId: null, snap: null, pollTimer: null, raf: null,
  canvas: null, ctx: null, scale: 1,
  weapon: "standard", ammo: {},
  aiming: false, aimAngle: 45, aimPower: 50,
  _rankImgs: {},
  anims: [], processing: false,
  serverOffset: 0, onExit: null,
  displayTowers: null, displayHp: null, pendingTowers: null,
  shake: 0, endAt: null, ended: false, readySent: false,
  pollDelay: 900, showAimUntil: 0, reconnectFailures: 0,

  W: 1000, H: 560, GROUND: 520, BLOCK: 26, TROWS: 6, TCOLS: 4,
  TX: { p1: 140, p2: 760 },

  async init(root, matchId, onExit) {
    this.matchId = matchId; this.onExit = onExit;
    this.firing = false; this.localLastShot = 0;
    this.anims = []; this.weapon = "standard"; this.snap = null;
    this.displayTowers = null; this.displayHp = null; this.pendingTowers = null;
    this.shake = 0; this.endAt = null; this.ended = false; this.readySent = false;
    this.reconnectFailures = 0;
    root.innerHTML = `
      <div id="game-hud">
        <div class="player-tag" id="tag-p1"></div>
        <div id="wind-ind">💨 ...</div>
        <div class="player-tag" id="tag-p2"></div>
      </div>
      <div id="practice-ind" class="hidden">🎯 משחק תרגול - לא נספר לדרגה</div>
      <div id="game-stage">
        <canvas id="game-canvas" width="1000" height="560"></canvas>
        <div id="game-overlay" class="hidden"></div>
      </div>
      <div id="reload-wrap"><div id="reload-bar"></div></div>
      <div id="aim-info">זווית 45° · עוצמה 50</div>
      <div id="weapon-bar"></div>
      <p class="sub" style="margin-top:10px">גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות. הרוח מזיזה את הפגז באוויר.</p>
      <p class="sub kbd-help">⌨️ מקלדת: <b>↑</b>/<b>↓</b> זווית · <b>←</b>/<b>→</b> עוצמה
        · <b>רווח</b> ירייה · <b>1-4</b> בחירת נשק (Shift = צעדים גדולים)</p>`;
    this.canvas = document.getElementById("game-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.bindInput();
    await this.refresh(0);
    this._destroyed = false;
    this.pollDelay = CONFIG.POLL_MIN_MS || 900;
    this.pollTimer = setTimeout(() => this.pollLoop(), this.pollDelay);
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  },

  destroy() {
    this.stopPoll();
    cancelAnimationFrame(this.raf);
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._onKey = null;
    this.canvas = null;
  },

  stopPoll() {
    this._destroyed = true;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  },

  // Adaptive polling: right after a state change we poll hot; when nothing
  // changes we back off gradually so idle clients stay cheap on the free
  // tier. Hidden tabs poll rarely. Net effect: opponent shots appear about
  // twice as fast during an exchange, with less load overall than a fixed
  // 1.5s interval.
  async pollLoop() {
    if (this._destroyed) return;
    const prevV = this.snap ? this.snap.version : -1;
    const ok = await this.poll();
    if (this._destroyed) return;
    if (!ok) {
      this.reconnectFailures++;
      API.setReconnecting(true);
      this.pollDelay = Math.min(12000, 900 * (2 ** Math.min(this.reconnectFailures, 4)));
      this.pollTimer = setTimeout(() => this.pollLoop(), this.pollDelay);
      return;
    }
    if (this.reconnectFailures) API.setReconnecting(false);
    this.reconnectFailures = 0;
    if (this.snap && this.snap.status !== "active" && this.snap.status !== "waiting") {
      // Terminal match: nothing more will change server-side. Stop polling
      // here as well - showEnd() stops the poll only via the rAF loop, which
      // is paused in hidden tabs, so finished matches kept polling for hours.
      this.stopPoll();
      return;
    }
    const changed = !!(this.snap && this.snap.version > prevV);
    if (document.hidden) {
      this.pollDelay = CONFIG.POLL_HIDDEN_MS || 5000;
    } else if (changed) {
      this.pollDelay = CONFIG.POLL_MIN_MS || 800;
    } else {
      this.pollDelay = Math.min(CONFIG.POLL_MAX_MS || 2600,
                                Math.round(this.pollDelay * 1.35) + 40);
    }
    this.pollTimer = setTimeout(() => this.pollLoop(), this.pollDelay);
  },

  mySide() { return this.snap ? this.snap.you : "p1"; },
  facing() { return this.mySide() === "p1" ? 1 : -1; },
  muzzle(side) {
    return { x: this.TX[side] + this.TCOLS * this.BLOCK / 2,
             y: this.GROUND - this.TROWS * this.BLOCK - 8 };
  },
  blockCenter(side, r, c) {
    return { x: this.TX[side] + c * this.BLOCK + this.BLOCK / 2,
             y: this.GROUND - (this.TROWS - r) * this.BLOCK + this.BLOCK / 2 };
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
      this.aiming = true;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
      updateAim(pos(e));
    });
    cv.addEventListener("pointermove", (e) => { if (this.aiming) updateAim(pos(e)); });
    cv.addEventListener("pointerup", (e) => {
      if (!this.aiming) return;
      this.aiming = false; updateAim(pos(e)); this.fire();
    });
    // Keyboard controls: arrows adjust angle/power, space fires, 1-4 picks a
    // weapon. Shift makes arrow steps bigger. The aim indicator stays visible
    // briefly after a key press so keyboard aiming has visual feedback.
    this._onKey = (e) => {
      if (!this.canvas || !this.snap || this.snap.status !== "active") return;
      const t = e.target;
      if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (document.activeElement && document.activeElement.tagName === "BUTTON")
        document.activeElement.blur();
      const step = e.shiftKey ? 5 : 1;
      const weapons = ["standard", "double_bomb", "homing_missile", "cluster_shell"];
      let used = true;
      switch (e.key) {
        case "ArrowUp":
          this.aimAngle = Math.min(90, this.aimAngle + step); break;
        case "ArrowDown":
          this.aimAngle = Math.max(0, this.aimAngle - step); break;
        case "ArrowRight":
          this.aimPower = Math.min(100, this.aimPower + step); break;
        case "ArrowLeft":
          this.aimPower = Math.max(5, this.aimPower - step); break;
        case " ":
          if (this.canFire()) this.fire();
          break;
        case "1": case "2": case "3": case "4": {
          const id = weapons[Number(e.key) - 1];
          const qty = id === "standard" ? 1 : (this._inventory?.[id]?.qty || 0);
          if (id && qty > 0) { this.weapon = id; Sfx.play("click"); this.renderWeapons(); }
          break;
        }
        default: used = false;
      }
      if (!used) return;
      e.preventDefault();
      this.showAimUntil = performance.now() + 1600;
      const el = document.getElementById("aim-info");
      if (el) el.textContent = `זווית ${this.aimAngle}° · עוצמה ${this.aimPower}`;
    };
    window.addEventListener("keydown", this._onKey);
  },

  canFire() {
    if (this.firing) return false;
    if (!this.snap || this.snap.status !== "active") return false;
    return this.reloadFrac() >= 1;
  },

  cooldown() {
    return { standard: 4, double_bomb: 5, homing_missile: 5, cluster_shell: 6 }[this.weapon] || 4;
  },

  reloadFrac() {
    if (!this.snap) return 0;
    const serverLast = (this.snap.last_shot_at || {})[this.mySide()] || 0;
    // localLastShot resets the reload bar the instant the player releases,
    // before the server's last_shot_at catches up on the round trip.
    const last = Math.max(serverLast, this.localLastShot || 0);
    const nowSrv = Date.now() / 1000 + this.serverOffset;
    return Math.max(0, Math.min(1, (nowSrv - last) / this.cooldown()));
  },

  async refresh(since) {
    const { status, data } = await API.get(
      `/api/matches/${this.matchId}/state?since=${since}`);
    if (status !== 200) {
      if (status === 0 || status >= 500) { API.setReconnecting(true); return false; }
      toast(data.error_he || "בעיה בטעינת המשחק"); return false;
    }
    API.setReconnecting(false);
    this.applySnap(data);
    this.sendReady();
    return true;
  },

  async poll() {
    if (!this.snap) return;
    const { status, data } = await API.get(
      `/api/matches/${this.matchId}/state?since=${this.snap.version}`);
    if (status === 200) { this.applySnap(data); this.sendReady(); return true; }
    return false;
  },


  async sendReady() {
    if (this.readySent || !this.snap || this.snap.status !== "active") return;
    this.readySent = true;
    const { status } = await API.post(`/api/matches/${this.matchId}/ready`);
    if (status !== 200) this.readySent = false;
  },

  applySnap(s) {
    const prevV = this.snap ? this.snap.version : -1;
    this.serverOffset = s.server_time - Date.now() / 1000;
    const events = s.events || [];
    delete s.events;
    this.snap = s;
    // Waiting snapshots deliberately have no battlefield. Keep the waiting
    // overlay alive without trying to render null towers/HP (the black-screen
    // crash reported on mobile).
    if (s.status === "waiting" || !s.towers || !s.tower_hp) {
      this.displayTowers = null; this.displayHp = null; this.pendingTowers = null;
      this.renderHud();
      return;
    }
    if (s.status === "aborted" && !this.ended) {
      // Technical abort (opponent left before real play, stale sweep): no
      // winner, no coins. Show an honest overlay instead of a frozen field.
      this.ended = true;
      this.showAbort();
      return;
    }
    if (events.some(e => e.type === "shot" && e.side === s.you))
      this.dropOptimistic();  // authoritative arc for my shot has arrived
    const hasFx = s.version > prevV && events.length > 0;
    if (hasFx) {
      const impactIn = this.enqueue(events);  // seconds until the last impact
      // towers crumble on screen exactly when the shell lands, not before
      this.pendingTowers = { towers: s.towers, hp: s.tower_hp,
                             at: performance.now() / 1000 + impactIn };
    } else if (this.pendingTowers) {
      this.pendingTowers.towers = s.towers; this.pendingTowers.hp = s.tower_hp;
    } else {
      this.displayTowers = s.towers; this.displayHp = s.tower_hp;
    }
    this.renderHud();
    this.renderWeapons();
    if (s.status === "finished" && !this.ended) {
      this.endAt = performance.now() / 1000 +
        (this.pendingTowers ? Math.max(0, this.pendingTowers.at - performance.now() / 1000) : 0) + 0.9;
    }
  },

  renderHud() {
    const s = this.snap; if (!s) return;
    for (const side of ["p1", "p2"]) {
      const p = s.players[side] || {};
      const el = document.getElementById("tag-" + side);
      if (!el) continue;
      el.classList.toggle("me", side === s.you);
      const hp = (this.displayHp || s.tower_hp || {})[side];
      const frac = hp && hp.max ? Math.max(0, hp.hp / hp.max) : 1;
      const pct = Math.round(frac * 100);
      const col = frac > 0.5 ? "var(--ok)" : frac > 0.25 ? "var(--gold)" : "var(--danger)";
      el.innerHTML = `${p.picture ? `<img src="${esc(p.picture)}" alt="">` : "🤖"}
        ${p.idf_rank && p.idf_rank.insignia ? `<img class="rank-badge" src="${esc(p.idf_rank.insignia)}" alt="${esc(p.idf_rank.abbr_he || "")}" title="${esc(p.idf_rank.name_he || "")}">` : ""}
        <div class="tag-mid">
          <div class="tag-line"><span>${esc(p.name || "?")}</span>
          <span class="rank">${esc(p.rank || "")}</span></div>
          <div class="hp-wrap"><div class="hp-fill" style="width:${pct}%;background:${col}"></div></div>
          <div class="hp-num" style="color:${col}">${pct}%</div>
        </div>`;
    }
    const pi = document.getElementById("practice-ind");
    if (pi) pi.classList.toggle("hidden", !s.practice);
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
    this.firing = true;
    Sfx.play("shot");
    // Optimistic launch: mirror the server's ballistics locally so the shell
    // leaves the barrel the instant the finger/mouse releases instead of
    // waiting for the network round trip. The authoritative server events
    // replace it as soon as the response lands.
    this.localLastShot = Date.now() / 1000 + this.serverOffset;
    this.spawnOptimisticShot();
    const { status, data } = await API.post(`/api/matches/${this.matchId}/fire`, {
      angle: this.aimAngle, power: this.aimPower, weapon: this.weapon,
    });
    this.firing = false;
    if (status === 200) {
      this.applySnap(data);
      if (this.weapon !== "standard" && this._inventory?.[this.weapon]) {
        this._inventory[this.weapon].qty--;
        this.renderWeapons();
      }
      if (window.refreshMe) window.refreshMe();
      // Stay hot right after our shot so the opponent's answer shows fast.
      this.pollDelay = CONFIG.POLL_MIN_MS || 800;
      clearTimeout(this.pollTimer);
      if (!this._destroyed && this.snap.status !== "finished")
        this.pollTimer = setTimeout(() => this.pollLoop(), this.pollDelay);
    } else {
      this.dropOptimistic();
      this.localLastShot = 0;
      if (data.error_he) toast(data.error_he);
    }
  },

  // Predicted primary arc, mirroring the server's _simulate (gravity 700,
  // power x10, wind x0.15, dt 0.02). Multi-shell weapons get only their
  // primary arc predicted; the server's events take over within a round
  // trip either way. Tagged `optimistic` so it can be dropped on reconcile.
  spawnOptimisticShot() {
    if (!this.snap || !this.snap.towers) return;
    const side = this.mySide(), f = this.facing();
    const ang = Math.max(0, Math.min(90, this.aimAngle)) * Math.PI / 180;
    const power = Math.max(5, Math.min(100, this.aimPower));
    const m = this.muzzle(side);
    let x = m.x, y = m.y;
    let vx = f * power * 10 * Math.cos(ang), vy = -power * 10 * Math.sin(ang);
    const wind = this.snap.wind || 0, DT = 0.02;
    const points = [];
    let step = 0, t = 0;
    while (t < 20) {
      t += DT; step++;
      vx += wind * 0.15 * DT; vy += 700 * DT;
      x += vx * DT; y += vy * DT;
      if (step % 6 === 0) points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      if (y >= this.GROUND) { points.push([Math.round(x * 10) / 10, this.GROUND]); break; }
      if (this.shellHitsTower(x, y)) { points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]); break; }
      if (x < -80 || x > this.W + 80) break;
    }
    if (points.length > 1) {
      const dur = Math.max(0.6, Math.min(2.2, points.length * 0.09));
      this.anims.push({ kind: "shot", points, t: 0, dur,
                        weapon: this.weapon, side, optimistic: true });
    }
  },

  shellHitsTower(x, y) {
    for (const s of ["p1", "p2"]) {
      const tower = this.snap.towers[s];
      for (let r = 0; r < this.TROWS; r++) {
        for (let c = 0; c < this.TCOLS; c++) {
          if (tower[r][c] <= 0) continue;
          const p = this.blockCenter(s, r, c);
          if (Math.abs(x - p.x) <= this.BLOCK / 2 && Math.abs(y - p.y) <= this.BLOCK / 2)
            return true;
        }
      }
    }
    return false;
  },

  dropOptimistic() {
    this.anims = this.anims.filter(a => !a.optimistic);
  },

  // ---------------- animations ----------------
  // Events arrive as one batch per version bump. We play them in order:
  // each shell flies its full arc first, then its explosion, damage number,
  // debris and screen shake land together at impact.
  enqueue(events) {
    let delay = 0, lastImpact = 0;
    for (const ev of events) {
      if (ev.type === "shot" && ev.points && ev.points.length > 1) {
        const dur = Math.max(0.6, Math.min(2.2, ev.points.length * 0.09));
        this.anims.push({ kind: "shot", points: ev.points, t: -delay, dur,
                          weapon: ev.weapon, side: ev.side });
        delay += dur;
      } else if (ev.type === "explosion") {
        const dmg = ev.damage || 0;
        this.anims.push({ kind: "explosion", x: ev.x, y: ev.y, r: ev.radius,
                          t: -delay, dur: 0.85, damage: dmg,
                          target: ev.target, cosmetic: !!ev.cosmetic,
                          sparks: this.makeSparks(ev.x, ev.y, ev.cosmetic ? 5 : 12),
                          smoke: this.makeSmoke(ev.x, ev.y, ev.cosmetic ? 2 : 5) });
        lastImpact = Math.max(lastImpact, delay);
        if (!ev.cosmetic) {
          this.shakeAt = performance.now() / 1000 + delay;
          this.shakeAmp = Math.min(16, 3 + dmg / 8);
          this.anims.push({ kind: "dmgnum", x: ev.x, y: Math.max(60, ev.y - 46),
                            t: -delay, dur: 1.3, damage: dmg });
          if (ev.destroyed) for (const b of ev.destroyed)
            this.spawnDebris(ev.target, b.r, b.c, delay);
        }
        delay += ev.cosmetic ? 0.2 : 0.45;
      } else if (ev.type === "collapse" && ev.blocks) {
        for (const b of ev.blocks) this.spawnDebris(b.side, b.r, b.c, delay);
      }
    }
    return lastImpact;
  },

  makeSparks(x, y, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 150 + Math.random() * 300;
      out.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 });
    }
    return out;
  },

  makeSmoke(x, y, n) {
    const out = [];
    for (let i = 0; i < n; i++)
      out.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 16,
                 drift: (Math.random() - 0.5) * 30, r: 10 + Math.random() * 14 });
    return out;
  },

  spawnDebris(side, r, c, delay) {
    const p = this.blockCenter(side, r, c);
    const skin = (this.snap && this.snap.skins[side]) || {};
    const cols = skin.debris || skin.colors || (Array.isArray(skin) ? skin : ["#3b82f6", "#1e3a8a"]);
    for (let i = 0; i < 3; i++) {
      this.anims.push({ kind: "debris", x: p.x, y: p.y,
        vx: (Math.random() - 0.5) * 340, vy: -80 - Math.random() * 260,
        rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 12,
        size: 7 + Math.random() * 8, color: cols[i % cols.length],
        t: -delay, dur: 1.4 });
    }
  },

  stepAnims(dt) {
    let boom = false;
    for (const a of this.anims) {
      const prev = a.t;
      a.t += dt / (a.dur || 1);
      if (a.kind === "explosion" && prev < 0.06 && a.t >= 0.06 && !a.cosmetic) boom = true;
      if (a.kind === "confetti" && a.t > 0) { a.y += a.vy * dt; }
      if (a.kind === "debris" && a.t > 0) {
        const step = dt / (a.dur || 1) * (a.dur || 1); // real seconds
        a.vy += 900 * dt; a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.vrot * dt;
        if (a.y > this.GROUND - 4 && a.vy > 0) { a.y = this.GROUND - 4; a.vy *= -0.35; a.vx *= 0.6; }
      }
    }
    if (boom) Sfx.play("explosion");
    // screen shake fires exactly at impact time
    const now = performance.now() / 1000;
    if (this.shakeAt && now >= this.shakeAt) {
      this.shake = this.shakeAmp; this.shakeAt = null;
    }
    this.shake = Math.max(0, this.shake - dt * 34);
    this.anims = this.anims.filter(a => a.t < 1);
  },

  // ---------------- drawing ----------------
  draw() {
    if (!this.ctx || !this.snap || !this.snap.towers) return;
    const c = this.ctx, now = performance.now();
    const dt = this._last ? (now - this._last) / 1000 : 0.016;
    this._last = now;
    this.stepAnims(dt);

    // swap in crumbled tower state at the moment of impact
    if (this.pendingTowers && now / 1000 >= this.pendingTowers.at) {
      this.displayTowers = this.pendingTowers.towers;
      this.displayHp = this.pendingTowers.hp;
      this.pendingTowers = null;
      this.renderHud();
    }
    // delayed end screen so the winning shot visibly lands first
    if (this.endAt && now / 1000 >= this.endAt && !this.ended) {
      this.ended = true; this.showEnd();
    }

    c.save();
    if (this.shake > 0.3)
      c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    // sky
    const sky = c.createLinearGradient(0, 0, 0, this.H);
    sky.addColorStop(0, "#1e3a5f"); sky.addColorStop(1, "#0f1e33");
    c.fillStyle = sky; c.fillRect(-20, -20, this.W + 40, this.H + 40);
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
    c.fillStyle = g; c.fillRect(-20, this.GROUND, this.W + 40, this.H - this.GROUND + 20);

    // towers + HP bars
    for (const side of ["p1", "p2"]) { this.drawTower(side); this.drawHpBar(side); this.drawRankBadge(side); }
    // cannons
    for (const side of ["p1", "p2"]) this.drawCannon(side);
    // aim arrow
    if ((this.aiming || performance.now() < (this.showAimUntil || 0))
        && this.canFire()) this.drawAim();
    // animations
    for (const a of this.anims) {
      if (a.t < 0) continue;  // sequenced for later
      if (a.kind === "shot") this.drawShot(a);
      else if (a.kind === "explosion") this.drawExplosion(a);
      else if (a.kind === "debris") this.drawDebris(a);
      else if (a.kind === "dmgnum") this.drawDmgNum(a);
      else if (a.kind === "confetti") this.drawConfetti(a, now / 1000);
    }
    c.restore();

    // reload bar
    const bar = document.getElementById("reload-bar");
    if (bar) bar.style.width = (this.reloadFrac() * 100) + "%";
  },

  drawShot(a) {
    const c = this.ctx;
    // muzzle flash at launch
    if (a.t < 0.08 && a.side) {
      const m = this.muzzle(a.side);
      c.save(); c.globalAlpha = 1 - a.t / 0.08;
      c.fillStyle = "#fef08a";
      c.beginPath(); c.arc(m.x, m.y, 16, 0, 7); c.fill();
      c.fillStyle = "#fff";
      c.beginPath(); c.arc(m.x, m.y, 7, 0, 7); c.fill();
      c.restore();
    }
    const n = a.points.length;
    const fi = Math.min(n - 1, a.t * n), i = Math.floor(fi), f = fi - i;
    const p0 = a.points[i], p1 = a.points[Math.min(n - 1, i + 1)];
    const x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f;
    // trail
    c.strokeStyle = "rgba(251,191,36,.55)"; c.lineWidth = 3; c.lineCap = "round";
    c.beginPath();
    const upto = Math.max(1, Math.floor(fi));
    c.moveTo(a.points[0][0], a.points[0][1]);
    for (let k = 1; k <= upto; k++) c.lineTo(a.points[k][0], a.points[k][1]);
    c.lineTo(x, y); c.stroke();
    // shell with glow
    const r = a.weapon === "cluster_mini" ? 5 : 8;
    const glow = c.createRadialGradient(x, y, 1, x, y, r * 2.4);
    glow.addColorStop(0, "rgba(253,224,71,.9)");
    glow.addColorStop(1, "rgba(253,224,71,0)");
    c.fillStyle = glow;
    c.beginPath(); c.arc(x, y, r * 2.4, 0, 7); c.fill();
    c.fillStyle = a.weapon === "cluster_mini" ? "#fb923c" : "#fde047";
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  },

  drawExplosion(a) {
    const c = this.ctx, t = a.t;
    if (a.cosmetic) {
      // small dust puff where a shell left the world
      c.globalAlpha = 0.5 * (1 - t);
      c.fillStyle = "#94a3b8";
      c.beginPath(); c.arc(a.x, a.y, a.r * (0.4 + 0.6 * t), 0, 7); c.fill();
      c.globalAlpha = 1;
      return;
    }
    // white flash at the very start
    if (t < 0.14) {
      c.globalAlpha = 0.95 * (1 - t / 0.14);
      c.fillStyle = "#ffffff";
      c.beginPath(); c.arc(a.x, a.y, a.r * 1.15, 0, 7); c.fill();
      c.globalAlpha = 1;
    }
    // fireball
    const r = a.r * (0.35 + 0.85 * Math.min(1, t * 1.6));
    const grad = c.createRadialGradient(a.x, a.y, 2, a.x, a.y, r);
    grad.addColorStop(0, `rgba(254,240,138,${0.95 * (1 - t)})`);
    grad.addColorStop(0.55, `rgba(249,115,22,${0.8 * (1 - t)})`);
    grad.addColorStop(1, "rgba(220,38,38,0)");
    c.fillStyle = grad;
    c.beginPath(); c.arc(a.x, a.y, r, 0, 7); c.fill();
    // shockwave ring
    c.strokeStyle = `rgba(254,215,170,${0.7 * (1 - t)})`;
    c.lineWidth = 5 * (1 - t) + 1;
    c.beginPath(); c.arc(a.x, a.y, a.r * (0.4 + 1.7 * t), 0, 7); c.stroke();
    // sparks
    c.strokeStyle = `rgba(253,186,116,${1 - t})`; c.lineWidth = 3;
    for (const s of a.sparks) {
      const sx = s.x + s.vx * t * 0.8, sy2 = s.y + s.vy * t * 0.8 + 300 * t * t * 0.32;
      c.beginPath(); c.moveTo(sx, sy2);
      c.lineTo(sx - s.vx * 0.03, sy2 - s.vy * 0.03); c.stroke();
    }
    // smoke
    for (const m of a.smoke) {
      c.globalAlpha = 0.28 * (1 - t);
      c.fillStyle = "#64748b";
      c.beginPath();
      c.arc(m.x + m.drift * t, m.y - 46 * t, m.r * (0.7 + t), 0, 7); c.fill();
    }
    c.globalAlpha = 1;
  },

  drawDebris(a) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = Math.max(0, 1 - a.t * a.t);
    c.translate(a.x, a.y); c.rotate(a.rot);
    c.fillStyle = a.color;
    c.fillRect(-a.size / 2, -a.size / 2, a.size, a.size);
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 1;
    c.strokeRect(-a.size / 2, -a.size / 2, a.size, a.size);
    c.restore();
  },

  drawDmgNum(a) {
    const c = this.ctx;
    const rise = a.t * 46;
    c.save();
    c.globalAlpha = a.t < 0.7 ? 1 : 1 - (a.t - 0.7) / 0.3;
    c.font = "800 30px system-ui, sans-serif";
    c.textAlign = "center";
    c.direction = "ltr";
    c.lineWidth = 5; c.strokeStyle = "rgba(10,10,20,.85)";
    const label = a.damage > 0 ? `-${Math.round(a.damage)}` : "החטאה!";
    c.strokeText(label, a.x, a.y - rise);
    c.fillStyle = a.damage > 0 ? "#f87171" : "#94a3b8";
    c.fillText(label, a.x, a.y - rise);
    c.restore();
  },

  drawConfetti(a, nowSec) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = a.t < 0.75 ? 1 : 1 - (a.t - 0.75) / 0.25;
    c.translate(a.x + Math.sin(nowSec * 3 + a.phase) * 22, a.y);
    c.rotate(a.rot + nowSec * a.vrot);
    c.fillStyle = a.color;
    c.fillRect(-a.size / 2, -a.size / 4, a.size, a.size / 2);
    c.restore();
  },

  rankImg(path) {
    let img = this._rankImgs[path];
    if (!img) {
      img = new Image();
      img.src = path;
      this._rankImgs[path] = img;
    }
    return img;
  },

  // IDF rank insignia plaque mounted on the tower front, just under the top row.
  // Rank data always comes from the server snapshot (players[side].idf_rank).
  drawRankBadge(side) {
    const p = (this.snap.players || {})[side] || {};
    const rank = p.idf_rank;
    if (!rank || !rank.insignia) return;
    const img = this.rankImg(rank.insignia);
    if (!img.complete || !img.naturalWidth) return;
    const c = this.ctx, size = 40;
    const x = this.TX[side] + this.TCOLS * this.BLOCK / 2 - size / 2;
    const y = this.GROUND - this.TROWS * this.BLOCK + 4;
    c.save();
    c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 6;
    c.drawImage(img, x, y, size, size);
    c.restore();
  },

  drawTower(side) {
    const c = this.ctx, tower = (this.displayTowers || this.snap.towers)[side];
    const rawSkin = this.snap.skins[side] || {};
    const style = Array.isArray(rawSkin)
      ? { colors: rawSkin, fill: rawSkin, frame: rawSkin[1], texture: "plain", emblem: "" }
      : rawSkin;
    const cols = style.colors || ["#3b82f6", "#1e3a8a"];
    const fill = style.fill || cols;
    const hpInfo = (this.displayHp || this.snap.tower_hp || {})[side];
    const blockMax = hpInfo && hpInfo.max ? hpInfo.max / (this.TROWS * this.TCOLS) : 15;
    for (let r = 0; r < this.TROWS; r++) {
      for (let col = 0; col < this.TCOLS; col++) {
        const hp = tower[r][col];
        if (hp <= 0) continue;
        const x = this.TX[side] + col * this.BLOCK;
        const y = this.GROUND - (this.TROWS - r) * this.BLOCK;
        const frac = Math.min(1, hp / blockMax);
        c.save();
        if (style.glow) { c.shadowColor = style.glow; c.shadowBlur = 8; }
        const grad = c.createLinearGradient(x, y, x + this.BLOCK, y + this.BLOCK);
        grad.addColorStop(0, fill[0]); grad.addColorStop(1, fill[1] || fill[0]);
        c.fillStyle = grad;
        c.globalAlpha = 0.45 + 0.55 * frac;
        c.fillRect(x + 1, y + 1, this.BLOCK - 2, this.BLOCK - 2);
        c.globalAlpha = 1; c.shadowBlur = 0;
        c.strokeStyle = style.frame || cols[1]; c.lineWidth = 2;
        c.strokeRect(x + 1, y + 1, this.BLOCK - 2, this.BLOCK - 2);
        c.globalAlpha = 0.22;
        c.strokeStyle = style.frame || "#fff"; c.lineWidth = 1;
        if (style.texture === "brick" && (r + col) % 2 === 0) {
          c.beginPath(); c.moveTo(x + 2, y + this.BLOCK / 2); c.lineTo(x + this.BLOCK - 2, y + this.BLOCK / 2); c.stroke();
        } else if (style.texture === "steel") {
          c.beginPath(); c.moveTo(x + 5, y + 5); c.lineTo(x + this.BLOCK - 5, y + this.BLOCK - 5); c.stroke();
          c.fillStyle = style.frame || "#fff"; c.beginPath(); c.arc(x + 5, y + 5, 1.5, 0, 7); c.fill();
        } else if (style.texture === "neon") {
          c.beginPath(); c.moveTo(x + 3, y + this.BLOCK - 4); c.lineTo(x + this.BLOCK - 4, y + 3); c.stroke();
        }
        c.restore();
        if (frac < 0.65) {  // cracks appear as blocks weaken
          c.strokeStyle = "rgba(0,0,0,.55)"; c.lineWidth = 1.4;
          c.beginPath(); c.moveTo(x + 5, y + 5); c.lineTo(x + 18, y + 16);
          c.moveTo(x + 20, y + 6); c.lineTo(x + 9, y + 21); c.stroke();
        }
      }
    }
    if (style.emblem) {
      const w = this.TCOLS * this.BLOCK, h = this.TROWS * this.BLOCK;
      c.save(); c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `bold ${Math.round(this.BLOCK * 1.35)}px sans-serif`;
      c.fillStyle = style.frame || "#fff"; c.shadowColor = style.glow || "transparent"; c.shadowBlur = 12;
      c.globalAlpha = 0.82; c.fillText(style.emblem, this.TX[side] + w / 2, this.GROUND - h / 2);
      c.restore();
    }
  },

  drawHpBar(side) {
    const c = this.ctx;
    const hp = (this.displayHp || this.snap.tower_hp || {})[side];
    if (!hp || !hp.max) return;
    const frac = Math.max(0, hp.hp / hp.max);
    const w = this.TCOLS * this.BLOCK + 24, h = 14;
    const x = this.TX[side] - 12, y = this.GROUND - this.TROWS * this.BLOCK - 46;
    c.save();
    c.fillStyle = "rgba(10,15,30,.72)";
    c.beginPath(); c.roundRect(x - 3, y - 3, w + 6, h + 6, 8); c.fill();
    c.fillStyle = "#1e293b";
    c.beginPath(); c.roundRect(x, y, w, h, 6); c.fill();
    if (frac > 0) {
      c.fillStyle = frac > 0.5 ? "#34d399" : frac > 0.25 ? "#fbbf24" : "#f87171";
      c.beginPath(); c.roundRect(x, y, Math.max(6, w * frac), h, 6); c.fill();
    }
    c.restore();
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
    this.stopPoll();
    const s = this.snap, ov = document.getElementById("game-overlay");
    const iWon = s.winner_side === s.you;
    const res = (s.results || {})[s.you] || {};
    if (iWon) { Sfx.play("win"); this.spawnConfetti(); } else Sfx.play("lose");
    ov.classList.remove("hidden");
    ov.classList.toggle("lost", !iWon);
    ov.innerHTML = `
      <div class="end-emoji">${iWon ? "🏆🎉" : "💥"}</div>
      <h2>${iWon ? "ניצחת!" : "הפסדת"}</h2>
      <p class="end-sub">${iWon ? "מגדל היריב הושמד!" : "המגדל שלך הושמד."}</p>
      <p>${res.coins != null ? `🪙 +${res.coins} מטבעות` : ""}
         ${res.rating_delta != null ? ` · דירוג ${res.rating_delta > 0 ? "+" : ""}${res.rating_delta}` : ""}</p>
      ${res.practice ? `<p class="practice-note">🎯 משחק תרגול - לא נספר לדרגה</p>` : ""}
      ${!res.practice && res.rank_points_lost > 0 ? `<p class="practice-note">📉 ירדו ${res.rank_points_lost} נקודות דרגה</p>` : ""}
      ${res.rank_up ? `<p class="rank-up"><img class="rank-badge-big" src="${esc(res.rank_up.insignia)}" alt=""> קודמת לדרגת ${esc(res.rank_up.name_he)} (${esc(res.rank_up.abbr_he)})!</p>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button class="btn" id="again-btn">עוד משחק</button>
        <button class="btn secondary" id="lobby-btn">חזרה ללובי</button>
      </div>`;
    document.getElementById("again-btn").onclick = () => {
      Sfx.play("click");
      if (s.mode === "ai") this.showAiRematch();
      else location.hash = "#/lobby";
    };
    document.getElementById("lobby-btn").onclick = () => { Sfx.play("click"); location.hash = "#/lobby"; };
    if (window.refreshMe) window.refreshMe();
  },

  showAbort() {
    this.stopPoll();
    const ov = document.getElementById("game-overlay");
    if (!ov) return;
    ov.classList.remove("hidden");
    ov.innerHTML = `
      <div class="end-emoji">🚫</div>
      <h2>המשחק בוטל</h2>
      <p class="end-sub">המשחק הסתיים מסיבה טכנית - ללא ניצחון, הפסד או מטבעות.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button class="btn" id="abort-lobby-btn">חזרה ללובי</button>
      </div>`;
    document.getElementById("abort-lobby-btn").onclick = () => {
      Sfx.play("click"); location.hash = "#/lobby";
    };
  },

  // After an AI match, "play again" offers an instant rematch against the
  // same bot with the difficulty preselected from the match just played,
  // instead of dumping the player back at the lobby.
  showAiRematch() {
    const ov = document.getElementById("game-overlay");
    const practice = this.snap && this.snap.practice;
    const minLevel = (this.snap && this.snap.players && this.snap.players[this.snap.you] && this.snap.players[this.snap.you].idf_rank || {}).level || 1;
    const prevLevel = (this.snap && this.snap.ai_rank_level) || minLevel;
    ov.innerHTML = `
      <div class="end-emoji">🤖⚔️</div>
      <h2>ריבאנץ' נגד OrelAI Bot</h2>
      <p class="end-sub">אותו יריב, משחק חדש - אפשר לשנות רמת קושי</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;align-items:center">
        <select id="rematch-diff" aria-label="רמת קושי">
          ${practice ? `<option value="easy">משחק תרגול</option>` : App.botRankOptions(minLevel, prevLevel)}
        </select>
        <button class="btn" id="rematch-go">עוד משחק</button>
        <button class="btn secondary" id="rematch-lobby">חזרה ללובי</button>
      </div>`;
    document.getElementById("rematch-go").onclick = async (e) => {
      Sfx.play("click");
      const btn = e.target;
      btn.disabled = true; btn.textContent = "יוצר משחק...";
      const value = document.getElementById("rematch-diff").value;
      const body = practice ? { difficulty: "easy" } : { difficulty: "ranked", bot_rank_level: Number(value) };
      const { status, data } = await API.post("/api/matches/ai", body);
      if (status === 200 && data.match_id) {
        location.hash = "#/game/" + data.match_id;
      } else {
        btn.disabled = false; btn.textContent = "עוד משחק";
        toast((data && data.error_he) || "שגיאה ביצירת משחק");
      }
    };
    document.getElementById("rematch-lobby").onclick = () => { Sfx.play("click"); location.hash = "#/lobby"; };
  },

  spawnConfetti() {
    const colors = ["#fbbf24", "#34d399", "#38bdf8", "#f472b6", "#a78bfa", "#f87171"];
    for (let i = 0; i < 90; i++) {
      this.anims.push({ kind: "confetti",
        x: Math.random() * this.W, y: -20 - Math.random() * 240,
        phase: Math.random() * 6.28, rot: Math.random() * 6.28,
        vrot: 2 + Math.random() * 5, size: 8 + Math.random() * 8,
        color: colors[i % colors.length], t: 0, dur: 2.8,
        vy: 130 + Math.random() * 120 });
    }
  },
};

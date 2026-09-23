// Game screen: canvas rendering, drag aiming, polling, animations.
// Rendering only - every rule is enforced by the server.
const GameView = {
  matchId: null, snap: null, pollTimer: null, raf: null,
  canvas: null, ctx: null, scale: 1,
  weapon: "standard", ammo: {},
  aiming: false, aimAngle: 45, aimPower: 50,
  // Presentation-only motion state. Gameplay continues to use aimAngle and
  // server snapshots, while the canvas eases between visual states.
  displayAngles: { p1: 45, p2: 45 }, cannonRecoil: { p1: 0, p2: 0 },
  blockTransitions: [], idleClock: 0, lastActionAt: 0,
  cloudOffsets: [0, 410],
  _rankImgs: {},
  anims: [], processing: false,
  // Small pooled FX budget keeps impact effects smooth on mobile. Particles
  // are recycled instead of allocating new objects during every hit.
  particles: [], particlePool: [], MAX_PARTICLES: 96, MAX_DEBRIS: 48,
  serverOffset: 0, onExit: null,
  displayTowers: null, displayHp: null, pendingTowers: null,
  shake: 0, endAt: null, ended: false, readySent: false,
  pollDelay: 900, showAimUntil: 0, reconnectFailures: 0,

  W: 1000, H: 560, GROUND: 520, BLOCK: 26, TROWS: 6, TCOLS: 4,
  WIND_ACCEL: 0.75,
  TX: { p1: 140, p2: 760 },

  async init(root, matchId, onExit) {
    this.matchId = matchId; this.onExit = onExit;
    // Every match opens at the logical start of the document. Mobile RTL and
    // installed PWAs can preserve a horizontal offset from the lobby/store;
    // clear both axes before laying out the fixed-aspect battlefield.
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    this.firing = false; this.localLastShot = 0;
    this.anims = []; this.particles = []; this.particlePool = [];
    this.weapon = "standard"; this.snap = null;
    this.displayTowers = null; this.displayHp = null; this.pendingTowers = null;
    this.shake = 0; this.endAt = null; this.ended = false; this.readySent = false;
    this.displayAngles = { p1: 45, p2: 45 };
    this.cannonRecoil = { p1: 0, p2: 0 };
    this.blockTransitions = []; this.idleClock = 0; this.lastActionAt = performance.now();
    this.cloudOffsets = [0, 410];
    this.reconnectFailures = 0;
    Sfx.startMusic();
    root.innerHTML = `
      <div id="game-hud">
        <div class="player-tag" id="tag-p1"></div>
        <div id="match-info"><div id="match-timer">⏱️ 03:00</div><div id="wind-ind">💨 ...</div></div>
        <div class="player-tag" id="tag-p2"></div>
        <button id="exit-match-btn" title="יציאה מהמשחק" aria-label="יציאה מהמשחק"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 3v8"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/></svg></button>
      </div>
      <div id="exit-confirm" class="hidden">
        <span>לצאת מהמשחק?</span>
        <button class="btn small danger" id="exit-match-yes">יציאה מהמשחק</button>
        <button class="btn small secondary" id="exit-match-no">ביטול</button>
        <span class="exit-note">יציאה ממשחק פעיל תיספר כהפסד בדירוג</span>
      </div>
      <div id="practice-ind" class="hidden">🎯 משחק תרגול - לא נספר לדרגה</div>
      <div id="game-stage">
        <canvas id="game-canvas" width="1000" height="560"></canvas>
        <div id="game-overlay" class="hidden"></div>
      </div>
      <div id="reload-wrap"><div id="reload-bar"></div></div>
      <div id="shot-clock">⏳ 10</div>
      <div id="aim-info" aria-label="מדדי כיוון ועוצמה"><span>זווית</span><div class="aim-gauge"><i id="angle-gauge"></i></div><span>עוצמה</span><div class="aim-gauge"><i id="power-gauge"></i></div></div>
      <div id="ability-bar"><button id="move-left" class="btn small secondary">⬅ הזזה</button><button id="move-right" class="btn small secondary">הזזה ➡</button><button id="shield-btn" class="btn small secondary">🛡 מגן</button><button id="mega-btn" class="btn small secondary">⚡ מגה</button></div>
      <div id="weapon-bar"></div>
      <p class="sub" style="margin-top:10px">גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות. הרוח מזיזה את הפגז ומשתנה אחרי כל ירייה, ובכל משחק המגדלים במיקומים אחרים.</p>
      <p class="sub kbd-help">⌨️ מקלדת: <b>↑</b>/<b>↓</b> זווית · <b>←</b>/<b>→</b> עוצמה
        · <b>רווח</b> ירייה · <b>1-4</b> בחירת נשק (Shift = צעדים גדולים)</p>`;
    this.canvas = document.getElementById("game-canvas");
    requestAnimationFrame(() => {
      document.documentElement.scrollLeft = 0; document.body.scrollLeft = 0;
      window.scrollTo(0, 0);
      document.getElementById("game-stage")?.scrollIntoView({ block: "start", inline: "center" });
    });
    this.ctx = this.canvas.getContext("2d");
    // Exit control: one tap reveals the confirmation strip; only the
    // explicit "יציאה מהמשחק" button actually leaves (active match = loss,
    // enforced server-side; waiting room = match deleted).
    const exitBtn = document.getElementById("exit-match-btn");
    const confirmBar = document.getElementById("exit-confirm");
    exitBtn.onclick = () => {
      Sfx.play("click");
      const note = confirmBar.querySelector(".exit-note");
      if (note) note.textContent = this.snap?.practice
        ? "יציאה ממשחק תרגול לא תשפיע על הדירוג"
        : "יציאה ממשחק פעיל תיספר כהפסד בדירוג";
      exitBtn.classList.add("hidden");
      confirmBar.classList.remove("hidden");
      Lang.apply(confirmBar);
    };
    document.getElementById("exit-match-no").onclick = () => {
      Sfx.play("click");
      confirmBar.classList.add("hidden");
      exitBtn.classList.remove("hidden");
    };
    document.getElementById("exit-match-yes").onclick = async (e) => {
      Sfx.play("click");
      const btn = e.target;
      btn.disabled = true; btn.textContent = "יוצא...";
      const st = this.snap && this.snap.status;
      if (st === "active" || st === "waiting")
        await API.post(`/api/matches/${this.matchId}/leave`);
      Sfx.stopMusic();
      location.hash = "#/lobby";
    };
    this.bindInput();
    const ability = async (path, body = {}) => {
      const { status, data } = await API.post(`/api/matches/${this.matchId}/${path}`, body);
      if (status === 200) this.applySnap(data); else toast((data && data.error_he) || "הפעולה אינה זמינה");
    };
    document.getElementById("move-left").onclick = () => ability("move", { direction: "left" });
    document.getElementById("move-right").onclick = () => ability("move", { direction: "right" });
    document.getElementById("shield-btn").onclick = () => ability("shield");
    document.getElementById("mega-btn").onclick = () => { this.useMega = !this.useMega; document.getElementById("mega-btn").classList.toggle("active", this.useMega); };
    await this.refresh(0);
    this._destroyed = false;
    this.openSocket();
    this.pollDelay = CONFIG.POLL_MIN_MS || 900;
    this.pollTimer = setTimeout(() => this.pollLoop(), this.pollDelay);
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  },

  destroy() {
    this.stopPoll();
    this.closeSocket();
    cancelAnimationFrame(this.raf);
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._onKey = null;
    this.canvas = null;
  },

  // WebSocket acceleration (Cloudflare port): the server pushes every match
  // event batch the moment it happens; each push triggers the same snapshot
  // fetch the poll loop uses, so all state processing stays in one path.
  // When the socket is down the adaptive poll cadence below is unchanged.
  openSocket() {
    if (!CONFIG.WS_ENABLED || this.ws || !this.snap) return;
    const me = this.snap.players && this.snap.players[this.snap.you];
    if (!me || me.id == null) return;  // spectators/bots get polling only
    const base = (CONFIG.API_BASE || location.origin).replace(/^http/, "ws");
    let ws;
    try {
      ws = new WebSocket(`${base}/api/matches/${this.matchId}/ws?uid=${me.id}&side=${this.snap.you}`);
    } catch (e) { return; }
    this.ws = ws;
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === "events" && !this._destroyed) {
        // Something changed server-side: pull the authoritative snapshot now.
        clearTimeout(this.pollTimer);
        this.pollLoop();
      } else if (msg.type === "error" && msg.error_he) {
        toast(msg.error_he);
      }
    };
    ws.onclose = () => { if (this.ws === ws) this.ws = null; };
    ws.onerror = () => { try { ws.close(); } catch (err) { /* ignore */ } };
  },

  closeSocket() {
    if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } this.ws = null; }
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
    if (this.ws && this.ws.readyState === 1) {
      // Socket is the wake-up channel; polling is only a safety net now.
      this.pollDelay = CONFIG.WS_SAFETY_POLL_MS || 15000;
    } else if (document.hidden) {
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
  // Tower left edge for this match. The server randomizes the layout every
  // game and sends it in the snapshot; TX is only the pre-snapshot fallback.
  tx(side) {
    const laid = this.snap && this.snap.tower_x;
    return laid && laid[side] != null ? laid[side] : this.TX[side];
  },
  obstacleNow() {
    const ob=this.snap?.obstacle; if(!ob?.motion?.enabled) return ob;
    const m=ob.motion, dist=Math.max(0,m.max_x-m.min_x), travel=dist/Math.max(1,m.speed);
    const leg=m.warning_seconds+travel, cycle=Math.max(.001,2*leg);
    let phase=((Date.now()/1000+this.serverOffset-m.epoch)%cycle+cycle)%cycle;
    const reverse=phase>=leg; if(reverse) phase-=leg;
    const warning=phase<m.warning_seconds;
    const progress=warning||!travel?0:Math.min(1,(phase-m.warning_seconds)/travel);
    return {...ob,x:reverse?m.max_x-progress*dist:m.min_x+progress*dist,
      moving:!warning&&dist>0,warning,direction:reverse?-1:1};
  },
  dims(side) {
    const tower=(this.displayTowers||this.snap?.towers||{})[side];
    return { rows:tower?.length||this.TROWS, cols:tower?.[0]?.length||this.TCOLS };
  },
  muzzle(side) {
    const d=this.dims(side);
    return { x: this.tx(side) + d.cols * this.BLOCK / 2,
             y: this.GROUND - d.rows * this.BLOCK - 8 };
  },
  blockCenter(side, r, c) {
    const d=this.dims(side);
    return { x: this.tx(side) + c * this.BLOCK + this.BLOCK / 2,
             y: this.GROUND - (d.rows - r) * this.BLOCK + this.BLOCK / 2 };
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
      if (el) this.renderAimGauges();
    };
    // Touches elsewhere on the battlefield are navigation, not shots. Aiming
    // must begin near your tower and become a real drag before release fires.
    // This also lets an ordinary one-finger swipe scroll the compact PWA view.
    const cancelAim = () => {
      this.aiming = false;
      this.aimPointerId = null;
      this.aimStart = null;
    };
    cv.addEventListener("pointerdown", (e) => {
      if (!this.canFire()) return;
      const p = pos(e);
      const m = this.muzzle(this.mySide());
      if (Math.hypot(p.x - m.x, p.y - m.y) > 145) return;
      this.aiming = true;
      this.aimPointerId = e.pointerId;
      this.aimStart = { clientX: e.clientX, clientY: e.clientY };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
      updateAim(p);
    });
    cv.addEventListener("pointermove", (e) => {
      if (this.aiming && e.pointerId === this.aimPointerId) updateAim(pos(e));
    });
    cv.addEventListener("pointerup", (e) => {
      if (!this.aiming || e.pointerId !== this.aimPointerId) return;
      const start = this.aimStart;
      const dragged = start && Math.hypot(e.clientX - start.clientX,
                                          e.clientY - start.clientY) >= 12;
      cancelAim();
      if (!dragged) return;
      updateAim(pos(e));
      this.fire();
    });
    cv.addEventListener("pointercancel", cancelAim);
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
      if (el) this.renderAimGauges();
    };
    window.addEventListener("keydown", this._onKey);
  },

  renderAimGauges() {
    const a = document.getElementById("angle-gauge"), p = document.getElementById("power-gauge");
    if (a) a.style.width = `${Math.max(0, Math.min(100, this.aimAngle / 90 * 100))}%`;
    if (p) p.style.width = `${Math.max(0, Math.min(100, this.aimPower))}%`;
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
      // Wind re-rolls after every shot; flash the pill so the new value
      // registers before the player lines up the next shot.
      if (this._lastWind !== undefined && this._lastWind !== v) {
        w.classList.remove("wind-flash");
        void w.offsetWidth;  // restart the CSS animation
        w.classList.add("wind-flash");
      }
      this._lastWind = v;
    }
    const moves = Number(s.moves_left || 0);
    ["move-left", "move-right"].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = moves < 1; });
    const ab = s.abilities || {};
    const sb = document.getElementById("shield-btn"); if (sb) sb.disabled = Number(ab.shield || 0) < 1;
    const mb = document.getElementById("mega-btn"); if (mb) mb.disabled = Number(ab.mega || 0) < 1;
    this.renderTimer();
  },

  renderTimer() {
    const el = document.getElementById("match-timer");
    if (!el || !this.snap) return;
    if (this.snap.status !== "active" || !this.snap.match_ends_at) {
      el.textContent = this.snap.status === "finished" ? "⏱️ 00:00" : "⏱️ --:--";
      return;
    }
    const left = Math.max(0, Math.ceil(this.snap.match_ends_at -
      (Date.now() / 1000 + this.serverOffset)));
    const min = Math.floor(left / 60);
    const sec = String(left % 60).padStart(2, "0");
    el.textContent = `⏱️ ${String(min).padStart(2, "0")}:${sec}`;
    el.classList.toggle("urgent", left <= 30);
    if (this.snap.sudden_death) el.textContent += " · 🔥 נזק כפול";
    const shot = document.getElementById("shot-clock");
    if (shot && this.snap.turn_deadline) {
      const turn = Math.max(0, Math.ceil(this.snap.turn_deadline - (Date.now() / 1000 + this.serverOffset)));
      shot.textContent = `⏳ ${turn}`; shot.classList.toggle("urgent", turn <= 3);
      // The ten-second clock is a real gameplay constraint: if the player is
      // still loaded and ready at zero, fire the current visual-gauge aim.
      if (turn === 0 && this.canFire() && !this._clockAutoFired) {
        this._clockAutoFired = true; this.fire();
      } else if (turn > 0) this._clockAutoFired = false;
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
    this.startRecoil(this.mySide());
    this.lastActionAt = performance.now();
    Sfx.play("shot");
    // Optimistic launch: mirror the server's ballistics locally so the shell
    // leaves the barrel the instant the finger/mouse releases instead of
    // waiting for the network round trip. The authoritative server events
    // replace it as soon as the response lands.
    this.localLastShot = Date.now() / 1000 + this.serverOffset;
    this.spawnOptimisticShot();
    const { status, data } = await API.post(`/api/matches/${this.matchId}/fire`, {
      angle: this.aimAngle, power: this.aimPower, weapon: this.weapon, mega: !!this.useMega,
    });
    this.useMega = false;
    const megaBtn = document.getElementById("mega-btn"); if (megaBtn) megaBtn.classList.remove("active");
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
  // power x10, wind x0.75, dt 0.02). Multi-shell weapons get only their
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
      vx += wind * this.WIND_ACCEL * DT; vy += 700 * DT;
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
      for (let r = 0; r < tower.length; r++) {
        for (let c = 0; c < tower[r].length; c++) {
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
        // Remote shots recoil when their sequenced shell leaves the barrel.
        // The local optimistic launch already kicked, so do not double-trigger it.
        if (ev.side !== this.mySide())
          this.anims.push({ kind: "recoil", side: ev.side, t: -delay, dur: 0.34 });
        delay += dur;
      } else if (ev.type === "explosion") {
        const dmg = ev.damage || 0;
        this.anims.push({ kind: "explosion", x: ev.x, y: ev.y, r: ev.radius,
                          t: -delay, dur: 0.85, damage: dmg,
                          target: ev.target, cosmetic: !!ev.cosmetic,
                          particlesStarted: false });
        lastImpact = Math.max(lastImpact, delay);
        if (!ev.cosmetic) {
          // Separate impact animations let several cluster hits overlap
          // without one hit overwriting another's shake or tower flash.
          this.anims.push({ kind: "impact", t: -delay, dur: 0.34,
                            amp: Math.min(16, 3 + dmg / 8) });
          this.anims.push({ kind: "hitflash", target: ev.target,
                            t: -delay, dur: 0.24 });
          this.anims.push({ kind: "dmgnum", x: ev.x, y: Math.max(60, ev.y - 46),
                            t: -delay, dur: 1.3, damage: dmg });
          if (ev.destroyed) for (const b of ev.destroyed)
            this.spawnDebris(ev.target, b.r, b.c, delay);
          if (ev.destroyed && ev.destroyed.length)
            // Tower blocks break: rubble lands just after the boom starts.
            this.anims.push({ kind: "sound", name: "crumble",
                              t: -(delay + 0.08), dur: 0.1 });
        }
        delay += ev.cosmetic ? 0.2 : 0.45;
      } else if (ev.type === "critical") {
        toast("🎯 פגיעה קריטית בקנה התותח!");
      } else if (ev.type === "random_event") {
        const labels = { gust: "משב רוח קיצוני", meteor: "מטאור פגע בזירה", charge: "מטען מגה נוסף" };
        toast(`⚡ אירוע אקראי: ${labels[ev.kind] || ev.kind}`);
      } else if (ev.type === "sudden_death") {
        toast("🔥 מוות פתאומי - הנזק הוכפל!");
      } else if (ev.type === "collapse" && ev.blocks) {
        for (const b of ev.blocks) this.spawnDebris(b.side, b.r, b.c, delay);
        if (ev.blocks.length)
          this.anims.push({ kind: "sound", name: "crumble", t: -delay, dur: 0.1 });
      }
    }
    return lastImpact;
  },

  startRecoil(side) {
    if (!side) return;
    this.cannonRecoil[side] = 0.34;
  },

  beginTowerTransition(oldTowers, newTowers) {
    if (!oldTowers || !newTowers) return;
    for (const side of ["p1", "p2"]) for (let r = 0; r < Math.max(oldTowers[side]?.length||0,newTowers[side]?.length||0); r++) {
      for (let col = 0; col < Math.max(oldTowers[side]?.[r]?.length||0,newTowers[side]?.[r]?.length||0); col++) {
        const before = oldTowers[side]?.[r]?.[col] || 0;
        const after = newTowers[side]?.[r]?.[col] || 0;
        if (before > 0 && after <= 0 && this.blockTransitions.length < 24)
          this.blockTransitions.push({ side, r, col, hp: before, age: 0, life: 0.46 });
      }
    }
  },

  takeParticle() {
    return this.particlePool.pop() || {};
  },

  releaseParticle(p) {
    // Retain only a bounded warm pool. All fields are overwritten on reuse.
    if (this.particlePool.length < this.MAX_PARTICLES) this.particlePool.push(p);
  },

  spawnImpactParticles(x, y, cosmetic) {
    const room = this.MAX_PARTICLES - this.particles.length;
    if (room <= 0) return;
    const sparks = Math.min(cosmetic ? 5 : 18, room);
    const smoke = Math.min(cosmetic ? 2 : 7, room - sparks);
    for (let i = 0; i < sparks; i++) {
      const p = this.takeParticle(), a = Math.random() * Math.PI * 2;
      const speed = 160 + Math.random() * 330;
      Object.assign(p, { type: "spark", x, y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 110,
        age: 0, life: 0.38 + Math.random() * 0.32,
        size: 1.5 + Math.random() * 2.2 });
      this.particles.push(p);
    }
    for (let i = 0; i < smoke; i++) {
      const p = this.takeParticle();
      Object.assign(p, { type: "smoke",
        x: x + (Math.random() - 0.5) * 28,
        y: y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 32, vy: -35 - Math.random() * 35,
        age: 0, life: 0.65 + Math.random() * 0.4,
        size: 9 + Math.random() * 14 });
      this.particles.push(p);
    }
  },

  spawnDebris(side, r, c, delay) {
    const p = this.blockCenter(side, r, c);
    let debrisCount = this.anims.reduce((n, a) => n + (a.kind === "debris" ? 1 : 0), 0);
    const skin = (this.snap && this.snap.skins[side]) || {};
    const cols = skin.debris || skin.colors || (Array.isArray(skin) ? skin : ["#3b82f6", "#1e3a8a"]);
    for (let i = 0; i < 3 && debrisCount < this.MAX_DEBRIS; i++, debrisCount++) {
      this.anims.push({ kind: "debris", x: p.x, y: p.y,
        vx: (Math.random() - 0.5) * 340, vy: -80 - Math.random() * 260,
        rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 12,
        size: 7 + Math.random() * 8, color: cols[i % cols.length],
        t: -delay, dur: 1.4 });
    }
  },

  stepAnims(dt) {
    // A suspended tab must not inject a multi-second physics step on resume.
    dt = Math.min(dt, 1 / 30);
    let shakeKick = 0;
    for (const a of this.anims) {
      const prev = a.t;
      a.t += dt / (a.dur || 1);
      if (a.kind === "sound" && prev < 0 && a.t >= 0) Sfx.play(a.name);
      if (a.kind === "recoil" && prev < 0 && a.t >= 0) this.startRecoil(a.side);
      if (a.kind === "explosion" && prev < 0.02 && a.t >= 0.02) {
        if (!a.cosmetic) Sfx.play("explosion");
        if (!a.particlesStarted) {
          a.particlesStarted = true;
          this.spawnImpactParticles(a.x, a.y, a.cosmetic);
        }
      }
      if (a.kind === "impact" && prev <= 0 && a.t > 0) shakeKick = Math.max(shakeKick, a.amp);
      if (a.kind === "confetti" && a.t > 0) a.y += a.vy * dt;
      if (a.kind === "debris" && a.t > 0) {
        a.vy += 900 * dt; a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.vrot * dt;
        if (a.y > this.GROUND - 4 && a.vy > 0) {
          a.y = this.GROUND - 4; a.vy *= -0.35; a.vx *= 0.6; a.vrot *= 0.72;
        }
      }
    }
    this.shake = Math.max(this.shake, shakeKick);
    this.shake = Math.max(0, this.shake - dt * 34);
    this.idleClock += dt;
    // Integrating offsets avoids a visual jump when wind changes. Positive
    // wind moves clouds right, negative wind left, and calm air holds them.
    const wind = (this.snap && this.snap.wind) || 0;
    this.cloudOffsets[0] = (this.cloudOffsets[0] + wind * 0.55 * dt) % 1320;
    this.cloudOffsets[1] = (this.cloudOffsets[1] + wind * 1.05 * dt) % 1320;
    for (const side of ["p1", "p2"]) {
      this.cannonRecoil[side] = Math.max(0, (this.cannonRecoil[side] || 0) - dt);
      const target = side === this.mySide() ? this.aimAngle : 45;
      // Exponential easing is frame-rate independent and never overshoots.
      this.displayAngles[side] += (target - this.displayAngles[side]) * (1 - Math.exp(-dt * 13));
    }
    for (const b of this.blockTransitions) b.age += dt;
    this.blockTransitions = this.blockTransitions.filter(b => b.age < b.life);

    const alive = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) { this.releaseParticle(p); continue; }
      p.vy += (p.type === "spark" ? 720 : -8) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === "smoke") { p.vx *= 0.985; p.size += 13 * dt; }
      alive.push(p);
    }
    this.particles = alive;
    this.anims = this.anims.filter(a => a.t < 1);
  },

  // ---------------- drawing ----------------
  draw() {
    if (!this.ctx || !this.snap || !this.snap.towers) return;
    const c = this.ctx, now = performance.now();
    const dt = this._last ? (now - this._last) / 1000 : 0.016;
    this._last = now;
    this.stepAnims(dt);
    this.renderTimer();

    // At impact the authoritative state becomes current. Destroyed blocks
    // pass through cracked and broken visual stages before disappearing.
    if (this.pendingTowers && now / 1000 >= this.pendingTowers.at) {
      this.beginTowerTransition(this.displayTowers, this.pendingTowers.towers);
      this.displayTowers = this.pendingTowers.towers;
      this.displayHp = this.pendingTowers.hp;
      this.pendingTowers = null; this.lastActionAt = now;
      this.renderHud();
    }
    // delayed end screen so the winning shot visibly lands first
    if (this.endAt && now / 1000 >= this.endAt && !this.ended) {
      this.ended = true; this.showEnd();
    }

    c.save();
    if (this.shake > 0.3)
      c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    // Layered illustrated battlefield. Each layer drifts at a different
    // speed, creating parallax without affecting any server-owned geometry.
    const map = (this.snap && this.snap.map) || "valley";
    const sky = c.createLinearGradient(0, 0, 0, this.H);
    const palette = map === "desert" ? ["#3f1d38", "#b4533c", "#f2b66d"] : map === "highlands" ? ["#10243c", "#355c68", "#a7c7b7"] : ["#0a2943", "#15506a", "#e09a62"];
    sky.addColorStop(0, palette[0]); sky.addColorStop(.55, palette[1]); sky.addColorStop(1, palette[2]);
    c.fillStyle = sky; c.fillRect(-20, -20, this.W + 40, this.H + 40);

    // moon glow and sparse stars keep the same teal/amber palette.
    const moon = c.createRadialGradient(790, 88, 3, 790, 88, 56);
    moon.addColorStop(0, "rgba(255,239,190,.94)");
    moon.addColorStop(.28, "rgba(244,201,93,.44)"); moon.addColorStop(1, "rgba(244,201,93,0)");
    c.fillStyle = moon; c.beginPath(); c.arc(790, 88, 56, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,244,211,.55)";
    for (let i = 0; i < 18; i++) {
      const sx = (i * 83 + 31) % this.W, sy = 24 + (i * 47) % 150;
      c.fillRect(sx, sy, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1);
    }

    const secs = now / 1000;
    const mountainLayer = (baseY, color, speed, peaks) => {
      const off = (secs * speed) % 260;
      c.fillStyle = color; c.beginPath(); c.moveTo(-300, this.GROUND);
      for (let i = -2; i < peaks + 2; i++) {
        const x = i * 260 - off;
        c.lineTo(x, baseY + (i % 2 ? 18 : 0));
        c.lineTo(x + 125, baseY - 115 - (i % 3) * 18);
        c.lineTo(x + 260, baseY + (i % 2 ? 18 : 0));
      }
      c.lineTo(this.W + 300, this.GROUND); c.closePath(); c.fill();
    };
    mountainLayer(420, "rgba(20,62,73,.54)", 1.2, 6);
    mountainLayer(466, "rgba(12,47,56,.88)", 3.0, 6);

    // Two cloud belts drift continuously with the current wind. Their
    // different response rates preserve depth while direction and strength
    // remain physically legible to the player.
    const cloudLayer = (y, alpha, scale, layer) => {
      c.save(); c.fillStyle = `rgba(234,240,224,${alpha})`;
      const off = ((this.cloudOffsets[layer] % 1320) + 1320) % 1320;
      for (let i = 0; i < 4; i++) {
        const x = ((i * 330 + off) % 1320) - 160;
        c.beginPath(); c.ellipse(x, y + i * 12, 52 * scale, 15 * scale, 0, 0, Math.PI * 2);
        c.ellipse(x + 42 * scale, y + i * 12 + 3, 38 * scale, 12 * scale, 0, 0, Math.PI * 2);
        c.ellipse(x - 35 * scale, y + i * 12 + 5, 31 * scale, 10 * scale, 0, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    };
    cloudLayer(78, .14, 1.05, 0);
    cloudLayer(165, .22, .72, 1);

    // Ground with a warm rim, tying the battlefield to the interface palette.
    const g = c.createLinearGradient(0, this.GROUND - 9, 0, this.H);
    g.addColorStop(0, "#d08b4e"); g.addColorStop(.14, "#41694e"); g.addColorStop(1, "#183b35");
    c.fillStyle = g; c.fillRect(-20, this.GROUND - 4, this.W + 40, this.H - this.GROUND + 24);
    c.fillStyle = "rgba(244,201,93,.20)";
    for (let x = 8; x < this.W; x += 34) c.fillRect(x, this.GROUND + 8 + (x % 3) * 3, 19, 2);

    const ob = this.obstacleNow();
    if (ob) {
      c.save();
      if(ob.warning){c.shadowColor="#f59e0b";c.shadowBlur=10+7*Math.sin(now/120);}
      c.fillStyle = ob.warning ? "#6b4f32" : "#4b5563"; c.strokeStyle = "#111827"; c.lineWidth = 4;
      c.fillRect(ob.x, ob.y, ob.w, ob.h); c.strokeRect(ob.x, ob.y, ob.w, ob.h);
      c.fillStyle = "rgba(255,255,255,.14)"; c.fillRect(ob.x + 8, ob.y + 8, ob.w - 16, 8);
      if(ob.motion?.enabled){
        c.fillStyle=ob.warning?"#fbbf24":"#d1d5db";c.font="bold 20px sans-serif";c.textAlign="center";
        c.fillText(ob.warning?"!":(ob.direction>0?"›":"‹"),ob.x+ob.w/2,ob.y+31);
        c.fillStyle="rgba(251,191,36,.8)";
        for(let yy=ob.y+46;yy<ob.y+ob.h-4;yy+=18){c.beginPath();c.moveTo(ob.x+6,yy);c.lineTo(ob.x+22,yy-12);c.lineTo(ob.x+34,yy-12);c.lineTo(ob.x+18,yy);c.fill();}
      }
      c.restore();
    }
    // towers + HP bars and capped, deterministic idle life.
    for (const side of ["p1", "p2"]) {
      this.drawIdleLife(side, now / 1000);
      this.drawTower(side); this.drawCoating(side); this.drawHpBar(side); this.drawRankBadge(side);
    }
    // A struck tower flashes as a whole, independently of the blast glow.
    for (const side of ["p1", "p2"]) this.drawTowerFlash(side);
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
    this.drawParticles();
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
    // Smoothstep removes the hard launch/landing snap while preserving the
    // authoritative path and impact point.
    const eased = a.t * a.t * (3 - 2 * a.t);
    const fi = Math.min(n - 1, eased * n), i = Math.floor(fi), f = fi - i;
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
    c.globalAlpha = 1;
  },

  drawParticles() {
    const c = this.ctx;
    c.save(); c.lineCap = "round";
    for (const p of this.particles) {
      const q = Math.max(0, 1 - p.age / p.life);
      if (p.type === "spark") {
        c.globalAlpha = q;
        c.strokeStyle = p.age < p.life * 0.45 ? "#fff7b2" : "#fb923c";
        c.lineWidth = p.size;
        c.beginPath(); c.moveTo(p.x, p.y);
        c.lineTo(p.x - p.vx * 0.026, p.y - p.vy * 0.026); c.stroke();
      } else {
        c.globalAlpha = 0.3 * q;
        c.fillStyle = "#94a3b8";
        c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  },

  drawTowerFlash(side) {
    let alpha = 0;
    for (const a of this.anims) {
      if (a.kind === "hitflash" && a.target === side && a.t >= 0 && a.t < 1)
        alpha = Math.max(alpha, Math.sin(Math.PI * a.t) * 0.9);
    }
    if (alpha <= 0) return;
    const tower = (this.displayTowers || this.snap.towers)[side], c = this.ctx;
    c.save(); c.globalAlpha = alpha; c.fillStyle = "#fff";
    c.shadowColor = "#fff"; c.shadowBlur = 20;
    for (let r = 0; r < tower.length; r++) for (let col = 0; col < tower[r].length; col++) {
      if (tower[r][col] == null || tower[r][col] <= 0) continue;
      const x = this.tx(side) + col * this.BLOCK;
      const y = this.GROUND - (tower.length - r) * this.BLOCK;
      c.fillRect(x + 1, y + 1, this.BLOCK - 2, this.BLOCK - 2);
    }
    c.restore();
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
    const eased = 1 - Math.pow(1 - a.t, 3);
    const rise = eased * 46;
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
    const c = this.ctx, size = 40, d=this.dims(side);
    const x = this.tx(side) + d.cols * this.BLOCK / 2 - size / 2;
    const y = this.GROUND - d.rows * this.BLOCK + 4;
    c.save();
    c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 6;
    c.drawImage(img, x, y, size, size);
    c.restore();
  },

  drawIdleLife(side, t) {
    const c = this.ctx, m = this.muzzle(side), f = side === "p1" ? 1 : -1;
    // Two tiny smoke puffs are computed, not allocated, so idle cost is fixed.
    for (let i = 0; i < 2; i++) {
      const phase = (t * 0.12 + i * 0.5 + (side === "p2" ? 0.23 : 0)) % 1;
      c.save(); c.globalAlpha = 0.13 * (1 - phase);
      c.fillStyle = "#cbd5e1";
      c.beginPath(); c.arc(m.x - f * 7 + Math.sin(t + i) * 3,
        m.y - 13 - phase * 28, 3 + phase * 5, 0, Math.PI * 2); c.fill(); c.restore();
    }
    // A small flag gives towers life without particles or extra rAF loops.
    const d=this.dims(side);
    const poleX = this.tx(side) + (side === "p1" ? 6 : d.cols * this.BLOCK - 6);
    const topY = this.GROUND - d.rows * this.BLOCK - 26;
    c.save(); c.strokeStyle = "#94a3b8"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(poleX, topY); c.lineTo(poleX, topY + 30); c.stroke();
    const wave = Math.sin(t * 2.1 + (side === "p2" ? 1.4 : 0)) * 3;
    c.fillStyle = side === "p1" ? "#38bdf8" : "#fb7185";
    c.beginPath(); c.moveTo(poleX, topY); c.quadraticCurveTo(poleX + f * 12, topY + 4 + wave,
      poleX + f * 24, topY + 8); c.lineTo(poleX + f * 24, topY + 18);
    c.quadraticCurveTo(poleX + f * 12, topY + 12 + wave, poleX, topY + 11); c.fill(); c.restore();
  },

  drawTower(side) {
    const c = this.ctx, tower = (this.displayTowers || this.snap.towers)[side];
    const rawSkin = this.snap.skins[side] || {};
    const style = Array.isArray(rawSkin)
      ? { colors: rawSkin, fill: rawSkin, frame: rawSkin[1], texture: "plain", emblem: "" }
      : rawSkin;
    const colors = style.colors || ["#3b82f6", "#1e3a8a"];
    const fill = style.fill || colors;
    const hpInfo = (this.displayHp || this.snap.tower_hp || {})[side];
    const rows=tower.length, cols=tower[0].length;
    const blockMax = hpInfo && hpInfo.max ? hpInfo.max / (rows * cols) : 15;
    const towerX = this.tx(side), towerY = this.GROUND - rows * this.BLOCK;

    if (typeof PremiumTowerArt !== "undefined")
      PremiumTowerArt.draw(c, style.geometry, { x: towerX, y: towerY,
        w: cols * this.BLOCK, h: rows * this.BLOCK, ground: this.GROUND },
        style, this.idleClock * 1000, side, "back");

    // Deep silhouette makes every skin read as the same chunky fortress style.
    c.save(); c.fillStyle = "rgba(2,11,19,.32)";
    c.beginPath(); c.roundRect(towerX - 7, towerY + 5, cols * this.BLOCK + 14,
      rows * this.BLOCK - 1, 10); c.fill(); c.restore();

    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const hp = tower[r][col];
      if (hp <= 0) continue;
      const x = towerX + col * this.BLOCK, y = this.GROUND - (rows - r) * this.BLOCK;
      const frac = Math.min(1, hp / blockMax), stagger = r % 2 ? 2 : 0;
      c.save();
      if (style.glow) { c.shadowColor = style.glow; c.shadowBlur = 8; }
      const grad = c.createLinearGradient(x, y, x + this.BLOCK, y + this.BLOCK);
      grad.addColorStop(0, fill[0]); grad.addColorStop(.62, fill[1] || fill[0]);
      grad.addColorStop(1, style.frame || colors[1]);
      c.fillStyle = grad; c.globalAlpha = .48 + .52 * frac;
      c.beginPath(); c.roundRect(x + 1 + stagger * .12, y + 1, this.BLOCK - 2, this.BLOCK - 2, 4); c.fill();
      c.globalAlpha = 1; c.shadowBlur = 0;
      c.strokeStyle = style.frame || colors[1]; c.lineWidth = 2;
      c.beginPath(); c.roundRect(x + 1 + stagger * .12, y + 1, this.BLOCK - 2, this.BLOCK - 2, 4); c.stroke();
      // Bevel and mortar lines replace the flat block look.
      c.strokeStyle = "rgba(255,255,255,.22)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + 5, y + 5); c.lineTo(x + this.BLOCK - 6, y + 5); c.stroke();
      c.strokeStyle = "rgba(2,11,19,.24)";
      c.beginPath(); c.moveTo(x + 5, y + this.BLOCK - 4); c.lineTo(x + this.BLOCK - 5, y + this.BLOCK - 4); c.stroke();
      if (style.texture === "brick" && (r + col) % 2 === 0) {
        c.beginPath(); c.moveTo(x + 3, y + this.BLOCK / 2); c.lineTo(x + this.BLOCK - 3, y + this.BLOCK / 2); c.stroke();
      } else if (style.texture === "steel") {
        c.fillStyle = style.frame || "#fff";
        for (const px of [x + 6, x + this.BLOCK - 6]) { c.beginPath(); c.arc(px, y + 7, 1.6, 0, Math.PI * 2); c.fill(); }
      } else if (style.texture === "neon") {
        c.strokeStyle = style.glow || "rgba(255,255,255,.34)";
        c.beginPath(); c.moveTo(x + 4, y + this.BLOCK - 5); c.lineTo(x + this.BLOCK - 5, y + 4); c.stroke();
      }
      c.restore();
      if (frac < .72) {
        c.strokeStyle = "rgba(2,11,19,.68)"; c.lineWidth = frac < .35 ? 2.2 : 1.4;
        c.beginPath(); c.moveTo(x + 5, y + 4); c.lineTo(x + 13, y + 12); c.lineTo(x + 9, y + 22);
        c.moveTo(x + 21, y + 5); c.lineTo(x + 14, y + 13);
        if (frac < .35) { c.moveTo(x + 3, y + 17); c.lineTo(x + 13, y + 12); c.lineTo(x + 23, y + 20); }
        c.stroke();
      }
    }

    // Consistent crown, doorway and corner trim turn the destructible grid
    // into a recognisable tower while preserving block-by-block damage.
    c.save(); c.strokeStyle = style.frame || colors[1]; c.lineWidth = 3;
    c.beginPath(); c.moveTo(towerX - 4, towerY + 2); c.lineTo(towerX - 4, this.GROUND);
    c.moveTo(towerX + cols * this.BLOCK + 4, towerY + 2);
    c.lineTo(towerX + cols * this.BLOCK + 4, this.GROUND); c.stroke();
    c.fillStyle = "rgba(2,11,19,.45)";
    c.beginPath(); c.roundRect(towerX + cols * this.BLOCK / 2 - 13, this.GROUND - 30, 26, 30, [12,12,2,2]); c.fill();
    c.fillStyle = "rgba(244,201,93,.62)"; c.beginPath(); c.arc(towerX + cols * this.BLOCK / 2 + 6, this.GROUND - 14, 2, 0, Math.PI * 2); c.fill();
    c.restore();

    for (const b of this.blockTransitions) if (b.side === side) {
      const q = Math.min(1, b.age / b.life), p = this.blockCenter(side, b.r, b.col);
      c.save(); c.translate(p.x, p.y); c.rotate((q > .5 ? q - .5 : 0) * (side === "p1" ? .18 : -.18));
      const scale = q < .5 ? 1 : 1 - (q - .5) * .55; c.scale(scale, scale);
      c.globalAlpha = 1 - Math.max(0, q - .72) / .28;
      c.fillStyle = fill[0]; c.beginPath(); c.roundRect(-this.BLOCK / 2 + 1, -this.BLOCK / 2 + 1, this.BLOCK - 2, this.BLOCK - 2, 4); c.fill();
      c.strokeStyle = style.frame || colors[1]; c.lineWidth = 2; c.stroke();
      c.strokeStyle = "rgba(2,11,19,.75)"; c.beginPath(); c.moveTo(-8,-9); c.lineTo(1,-1); c.lineTo(-5,10); c.moveTo(9,-7); c.lineTo(1,-1); c.lineTo(10,8); c.stroke(); c.restore();
    }
    if (style.emblem) {
      const w = cols * this.BLOCK, h = rows * this.BLOCK;
      c.save(); c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `bold ${Math.round(this.BLOCK * 1.35)}px sans-serif`;
      c.fillStyle = style.frame || "#fff"; c.shadowColor = style.glow || "transparent"; c.shadowBlur = 12;
      c.globalAlpha = .82; c.fillText(style.emblem, towerX + w / 2, this.GROUND - h / 2); c.restore();
    }
    if (typeof PremiumTowerArt !== "undefined")
      PremiumTowerArt.draw(c, style.geometry, { x: towerX, y: towerY,
        w: cols * this.BLOCK, h: rows * this.BLOCK, ground: this.GROUND },
        style, this.idleClock * 1000, side, "front");
  },

  drawCoating(side) {
    const coating = (this.snap.coatings || {})[side];
    if (!coating || coating.hp <= 0) return;
    const d=this.dims(side), c=this.ctx, x=this.tx(side), y=this.GROUND-d.rows*this.BLOCK;
    const w=d.cols*this.BLOCK, h=d.rows*this.BLOCK;
    const frac=Math.max(0,Math.min(1,coating.hp/coating.max_hp));
    const palette={wood:["#92400e","#d97706"],tin:["#94a3b8","#e2e8f0"],iron:["#334155","#94a3b8"]}[coating.material]||["#64748b","#cbd5e1"];
    c.save();c.globalAlpha=.32+.38*frac;c.strokeStyle=palette[1];c.lineWidth=6;
    c.beginPath();c.roundRect(x-5,y-5,w+10,h+10,9);c.stroke();
    c.globalAlpha=.75;c.strokeStyle=palette[0];c.lineWidth=2;
    for(let yy=y+8;yy<this.GROUND;yy+=18){c.beginPath();c.moveTo(x-5,yy);c.lineTo(x+w+5,yy);c.stroke();}
    if(coating.material==="wood"){for(let xx=x+10;xx<x+w;xx+=22){c.beginPath();c.moveTo(xx,y-4);c.lineTo(xx,this.GROUND+4);c.stroke();}}
    else {for(let xx=x+10;xx<x+w;xx+=26){for(let yy=y+10;yy<this.GROUND;yy+=26){c.fillStyle=palette[1];c.beginPath();c.arc(xx,yy,2,0,7);c.fill();}}}
    c.restore();
  },

  drawHpBar(side) {
    const c = this.ctx;
    const hp = (this.displayHp || this.snap.tower_hp || {})[side];
    if (!hp || !hp.max) return;
    const frac = Math.max(0, hp.hp / hp.max);
    const d=this.dims(side), w = d.cols * this.BLOCK + 24, h = 14;
    const x = this.tx(side) - 12, y = this.GROUND - d.rows * this.BLOCK - 46;
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
    const idle = !this.aiming && performance.now() - this.lastActionAt > 900;
    const sway = idle ? Math.sin(this.idleClock * 1.25 + (side === "p2" ? 1.7 : 0)) * .8 : 0;
    const ang = ((this.displayAngles[side] ?? (isMe ? this.aimAngle : 45)) + sway) * Math.PI / 180;
    const f = side === "p1" ? 1 : -1, rt = this.cannonRecoil[side] || 0;
    const rp = rt > 0 ? 1 - rt / .34 : 1;
    const kick = rp < .24 ? 7 * (rp / .24) : 7 * (1 - Math.pow((rp - .24) / .76, .55));
    c.save(); c.translate(m.x - f * Math.cos(ang) * kick, m.y + Math.sin(ang) * kick); c.rotate(-f * ang);
    // Tapered, banded barrel in the shared navy/brass art direction.
    const barrel = c.createLinearGradient(0, -7, 0, 7);
    barrel.addColorStop(0, "#8aa2ad"); barrel.addColorStop(.45, "#3c5967"); barrel.addColorStop(1, "#183543");
    c.fillStyle = barrel; c.strokeStyle = "#071b2d"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -7); c.lineTo(32 * f, -5); c.lineTo(32 * f, 5); c.lineTo(0, 7); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#d79b48"; c.fillRect(8 * f - (f < 0 ? 4 : 0), -8, 5, 16);
    c.fillStyle = "#f4c95d"; c.fillRect(27 * f - (f < 0 ? 5 : 0), -7, 5, 14); c.restore();
    const hub = c.createRadialGradient(m.x - 3, m.y - 3, 1, m.x, m.y, 12);
    hub.addColorStop(0, "#f4c95d"); hub.addColorStop(.36, "#d08b4e"); hub.addColorStop(1, "#60452f");
    c.fillStyle = hub; c.strokeStyle = "#071b2d"; c.lineWidth = 2;
    c.beginPath(); c.arc(m.x, m.y, 11, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = "#173d54"; c.beginPath(); c.arc(m.x, m.y, 4, 0, Math.PI * 2); c.fill();
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
    const isDraw = !s.winner_side && ((s.results || {})[s.you] || {}).outcome === "draw";
    const iWon = s.winner_side === s.you;
    const res = (s.results || {})[s.you] || {};
    if (isDraw) Sfx.play("click");
    else if (iWon) { Sfx.play("win"); this.spawnConfetti(); } else Sfx.play("lose");
    const timed = s.finish_reason === "time_limit";
    const reason = timed
      ? (isDraw ? "הזמן נגמר - לשני המגדלים אותה שלמות."
                : `הזמן נגמר - למגדל ${iWon ? "שלך" : "היריב"} נשארה יותר שלמות.`)
      : (iWon ? "מגדל היריב הושמד!" : "המגדל שלך הושמד.");
    ov.classList.remove("hidden");
    ov.classList.toggle("lost", !iWon && !isDraw);
    ov.innerHTML = `
      <div class="end-emoji">${isDraw ? "🤝" : (iWon ? "🏆🎉" : "💥")}</div>
      <h2>${isDraw ? "תיקו" : (iWon ? "ניצחת!" : "הפסדת")}</h2>
      <p class="end-sub">${reason}</p>
      <p>${res.coins != null ? `🪙 +${res.coins} מטבעות` : ""}
         ${res.rating_delta != null ? ` · דירוג ${res.rating_delta > 0 ? "+" : ""}${res.rating_delta}` : ""}</p>
      ${res.practice ? `<p class="practice-note">🎯 משחק תרגול - לא נספר לדרגה</p>` : ""}
      ${!res.practice && res.rank_points_awarded > 0 ? `<p class="practice-note">⭐ +${res.rank_points_awarded} XP מנזק וניצחון</p>` : ""}
      ${!res.practice && res.damage_xp_awarded > 0 ? `<p class="practice-note">⭐ +${res.damage_xp_awarded} XP מנזק</p>` : ""}
      ${!res.practice && res.rank_points_lost > 0 ? `<p class="practice-note">📉 ירדו ${res.rank_points_lost} XP</p>` : ""}
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

  // Rematches expose only the five difficulty tiers. The server maps a tier
  // to an authoritative bot rank; the client never chooses or submits one.
  showAiRematch() {
    const ov = document.getElementById("game-overlay");
    const previous = (this.snap && (this.snap.ai_tier || (this.snap.practice ? "easy" : "medium"))) || "medium";
    const tiers = [
      ["easy", "קל - תרגול, ללא נקודות או מטבעות"],
      ["medium", "בינוני"], ["hard", "קשה"],
      ["ultra", "אולטרה קשה"], ["expert", "מומחה - האתגר הקשה ביותר"]
    ];
    ov.innerHTML = `
      <div class="end-emoji">🤖⚔️</div>
      <h2>ריבאנץ' נגד OrelAI Bot</h2>
      <p class="end-sub">משחק חדש - בחר רמת קושי בלבד</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;align-items:center">
        <select id="rematch-diff" aria-label="רמת קושי">
          ${tiers.map(([value, label]) => `<option value="${value}" ${value === previous ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <button class="btn" id="rematch-go">עוד משחק</button>
        <button class="btn secondary" id="rematch-lobby">חזרה ללובי</button>
      </div>`;
    document.getElementById("rematch-go").onclick = async (e) => {
      Sfx.play("click");
      const btn = e.target;
      btn.disabled = true; btn.textContent = "יוצר משחק...";
      const difficulty = document.getElementById("rematch-diff").value;
      localStorage.setItem("brigagame.aiTier", difficulty);
      const { status, data } = await API.post("/api/matches/ai", { difficulty });
      if (status === 200 && data.match_id) location.hash = "#/game/" + data.match_id;
      else {
        btn.disabled = false; btn.textContent = "עוד משחק";
        toast((data && data.error_he) || "שגיאה ביצירת משחק");
      }
    };
    document.getElementById("rematch-lobby").onclick = () => {
      Sfx.play("click"); Sfx.stopMusic(); location.hash = "#/lobby";
    };
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

// Router + views (login, lobby, store, leaderboard, messages, admin).
const App = {
  me: null, inventory: {},

  async boot() {
    window.addEventListener("hashchange", () => this.route());
    document.getElementById("mute-btn").onclick = () => {
      const m = Sfx.toggleMute();
      document.getElementById("mute-btn").textContent = m ? "🔇" : "🔊";
    };
    document.getElementById("logout-btn").onclick = async () => {
      await API.post("/api/auth/logout"); API.setToken(null);
      App.stopPulse();
      App.me = null; location.hash = "#/login";
    };
    document.getElementById("mute-btn").textContent = Sfx.muted ? "🔇" : "🔊";
    if (API.token) {
      // Bounded retries: a busy/down server must show the reconnect indicator
      // and then an honest offline screen - never a silent endless "connecting".
      let status = 0, data = null;
      for (let i = 0; i < 4 && status !== 200; i++) {
        ({ status, data } = await API.get("/api/me"));
        if (status === 200) { this.setMe(data); this.startPulse(); break; }
        if (status === 401 || status === 403) break;
        API.setReconnecting(true);
        await new Promise(r => setTimeout(r, 2500));
      }
      API.setReconnecting(false);
      if (status !== 200 && !this.me) {
        document.getElementById("view").innerHTML = `
          <div class="card" style="max-width:420px;margin:60px auto;text-align:center">
            <h2>📡 אין חיבור לשרת</h2>
            <p class="sub">השרת לא ענה כרגע. בדוק את חיבור האינטרנט ונסה שוב בעוד רגע.</p>
            <button class="btn" onclick="location.reload()">🔄 נסה שוב</button>
          </div>`;
        return;
      }
    }
    this.route();
  },

  // App-wide presence pulse: keeps the player invitable from ANY screen
  // (lobby, store, leaderboard, ...) and delivers incoming match invites as
  // a global overlay.
  startPulse() {
    this.stopPulse();
    const beat = async () => {
      if (!API.token) return;
      const { status, data } = await API.post("/api/presence/ping");
      if (status !== 200 || !data) return;
      // Version handshake: a newer deploy reloads the app, but only from the
      // lobby - never mid-game - and at most once per version, so a half
      // deployed release cannot cause a reload loop.
      if (data.server_version && data.server_version !== CONFIG.CLIENT_VERSION) {
        const h = location.hash || "#/lobby";
        if (h === "#/lobby" || h === "#/") {
          const key = "bg_reloaded_for_" + data.server_version;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, "1");
            location.reload();
            return;
          }
        }
      }
      const offer = data.offer;
      if (offer && offer.match_id && this._offerMatchId !== offer.match_id)
        this.showMatchOffer(offer.match_id, offer.expires_in || 20);
      if (typeof data.unread_messages === "number")
        this.setUnread(data.unread_messages);
      if (data.maintenance) this.setMaintenance(data.maintenance);
    };
    beat();
    this._pulse = setInterval(beat, CONFIG.PRESENCE_PULSE_MS || 8000);
  },

  stopPulse() {
    clearInterval(this._pulse);
    this._pulse = null;
  },

  // Unread-messages indicator: a red badge on the messages nav icon, visible
  // from every screen (the topbar is global), plus a toast the moment a new
  // message arrives no matter where the player is.
  setUnread(n) {
    const badge = document.getElementById("msg-badge");
    if (badge) {
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.classList.toggle("hidden", n <= 0);
    }
    if (this._unread != null && n > this._unread) {
      Sfx.play("coin");
      toast("✉️ הגיעה הודעה חדשה! פתח את ״הודעות״ לקריאה", 4500);
    }
    this._unread = n;
  },

  // Maintenance banner (D1): global strip visible on every screen,
  // including in-game. Driven by the presence pulse and /api/me.
  setMaintenance(m) {
    const el = document.getElementById("maintenance-banner");
    if (!el) return;
    const txt = m && m.on ? ("🚧 " + (m.message || "המשחק בתחזוקה זמנית")) : "";
    el.textContent = txt;
    el.classList.toggle("hidden", !txt);
  },

  setMe(data) {
    this.me = data.user; this.inventory = data.inventory || {};
    this.setMaintenance(data.maintenance);
    this._daily = data.daily_available; this._streak = data.streak;
    document.getElementById("topbar").classList.remove("hidden");
    document.getElementById("coin-chip").textContent = "🪙 " + this.me.coins;
    document.getElementById("rank-chip").textContent = this.me.rank + " · " + this.me.rating;
    const pic = document.getElementById("user-pic");
    if (this.me.picture) { pic.src = this.me.picture; pic.classList.remove("hidden"); }
    document.getElementById("nav-admin").classList.toggle("hidden", !this.me.is_admin);
    GameView.setInventory(this.inventory);
  },

  route() {
    if (GameView.canvas) GameView.destroy();
    const hash = location.hash || "#/lobby";
    const view = document.getElementById("view");
    document.querySelectorAll("#topbar nav a").forEach(a =>
      a.classList.toggle("active", hash.startsWith("#/" + a.dataset.nav)));
    if (!API.token && !hash.startsWith("#/login")) { location.hash = "#/login"; return; }
    if (hash.startsWith("#/game/")) this.vGame(view, hash.split("/")[2]);
    else if (hash.startsWith("#/store")) this.vStore(view);
    else if (hash.startsWith("#/custom")) this.vCustom(view);
    else if (hash.startsWith("#/leaderboard")) this.vLeaderboard(view);
    else if (hash.startsWith("#/messages")) this.vMessages(view);
    else if (hash.startsWith("#/admin")) this.vAdmin(view, hash.split("/")[2] || "stats");
    else if (hash.startsWith("#/login")) this.vLogin(view);
    else this.vLobby(view);
  },

  // ---------------- login ----------------
  vLogin(view) {
    document.getElementById("topbar").classList.add("hidden");
    view.innerHTML = `
      <div id="login-wrap">
        <div class="logo">🎯</div>
        <h1>Brigagame <span style="color:var(--accent)">2.0</span></h1>
        <p class="sub">by OrelAI · משחק ארטילריה מולטיפלייר - הפל את מגדל היריב!</p>
        <div class="card">
          <div class="gsi-wrap"><div id="gsi-btn"></div></div>
          <p class="sub" style="font-size:13px">התחברות עם חשבון גוגל בלבד.
            בהתחברות אתה מאשר את <a href="terms.html">תנאי השימוש</a>
            ו<a href="privacy.html">מדיניות הפרטיות</a>.</p>
        </div>
        <div id="dev-login" class="card hidden">
          <label>כניסת פיתוח (מקומית בלבד)</label>
          <input id="dev-email" placeholder="dev@example.com">
          <button class="btn secondary" style="margin-top:8px" id="dev-btn">כניסה</button>
        </div>
      </div>`;
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      document.getElementById("dev-login").classList.remove("hidden");
      document.getElementById("dev-btn").onclick = async () => {
        const email = document.getElementById("dev-email").value.trim();
        const { status, data } = await API.post("/api/auth/dev", { email });
        if (status === 200) { API.setToken(data.token); App.setMe(await (await fetch(CONFIG.API_BASE + "/api/me", { headers: { Authorization: "Bearer " + data.token } })).json()); App.startPulse(); location.hash = "#/lobby"; }
        else toast(data.error_he || "כניסת פיתוח כבויה");
      };
    }
    const renderGsi = () => {
      if (!window.google || !google.accounts || !CONFIG.GOOGLE_CLIENT_ID) return;
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          const { status, data } = await API.post("/api/auth/google",
            { credential: resp.credential });
          if (status === 200) {
            API.setToken(data.token);
            const me = await API.get("/api/me");
            if (me.status === 200) App.setMe(me.data);
            App.startPulse();
            Sfx.ensure(); Sfx.startMusic();
            location.hash = "#/lobby";
          } else toast(data.error_he || data.detail || "ההתחברות נכשלה");
        },
      });
      google.accounts.id.renderButton(document.getElementById("gsi-btn"),
        { theme: "filled_black", size: "large", text: "signin_with", locale: "iw" });
    };
    if (window.google) renderGsi();
    else window.addEventListener("load", renderGsi);
  },

  // ---------------- lobby ----------------
  async vLobby(view) {
    if (!this.me) { location.hash = "#/login"; return; }
    const u = this.me;
    view.innerHTML = `
      <h1>שלום, ${esc(u.name)} 👋</h1>
      <p class="sub">הפל את מגדל היריב לפני שהוא מפיל את שלך.</p>
      <div class="grid cols2">
        <div class="card">
          <h2>🎮 משחק</h2>
          <div class="grid">
            <button class="btn" id="quick-btn">⚡ משחק מהיר</button>
            <div class="ai-start">
              <select id="ai-difficulty" aria-label="רמת קושי">
                <option value="easy">קל (משחק תרגול)</option>
                <option value="normal" selected>רגיל</option>
                <option value="hard">קשה</option>
              </select>
              <button class="btn secondary" id="ai-btn">🤖 נגד המחשב</button>
            </div>
            <button class="btn secondary" id="friend-btn">🔗 משחק חברים (צור קוד)</button>
            <div style="display:flex;gap:8px">
              <input id="join-code" placeholder="קוד משחק" maxlength="6" style="text-transform:uppercase">
              <button class="btn secondary" id="join-btn">הצטרף</button>
            </div>
            <div id="friend-code" class="hidden" style="margin-top:8px"></div>
          </div>
        </div>
        <div class="card">
          <h2>📊 הסטטיסטיקה שלך</h2>
          <div class="stat-row">
            <span><b>${u.rating}</b>דירוג (${esc(u.rank)})</span>
            <span><b>${u.wins}</b>נצחונות</span>
            <span><b>${u.losses}</b>הפסדים</span>
            <span><b>🪙 ${u.coins}</b>מטבעות</span>
          </div>
          <button class="btn" id="daily-btn" style="margin-top:14px"
            ${this._daily ? "" : "disabled"}>🎁 בונוס יומי${this._daily ? "" : " (נאסף)"}</button>
        </div>
      </div>`;
    const go = (id) => { location.hash = "#/game/" + id; };
    document.getElementById("quick-btn").onclick = async () => {
      Sfx.play("click");
      const { data } = await API.post("/api/matches/quick");
      if (data.status === "waiting") {
        toast("מחכה ליריב...");
        go(data.match_id);
      } else if (data.status === "offered" && data.match_id) {
        this.showMatchOffer(data.match_id, data.expires_in || 20);
      } else if (data.match_id) go(data.match_id);
      else toast(data.error_he || "שגיאה");
    };
    document.getElementById("ai-btn").onclick = async () => {
      Sfx.play("click");
      const difficulty = document.getElementById("ai-difficulty").value;
      const { data } = await API.post("/api/matches/ai", { difficulty });
      if (data.match_id) go(data.match_id); else toast(data.error_he || "שגיאה");
    };
    document.getElementById("friend-btn").onclick = async () => {
      Sfx.play("click");
      const { data } = await API.post("/api/matches/friend");
      if (data.code) {
        const box = document.getElementById("friend-code");
        box.classList.remove("hidden");
        box.innerHTML = `<p class="sub">שתף את הקוד עם חבר:</p>
          <div class="code-box">${esc(data.code)}</div>
          <button class="btn small secondary" id="copy-code" style="margin-top:8px">העתק קוד</button>
          <p class="sub" style="margin-top:6px">ממתין שהחבר יצטרף...</p>`;
        document.getElementById("copy-code").onclick = () => {
          navigator.clipboard?.writeText(data.code); toast("הקוד הועתק");
        };
        go(data.match_id);
      } else toast(data.error_he || "שגיאה");
    };
    document.getElementById("join-btn").onclick = async () => {
      const code = document.getElementById("join-code").value.trim();
      if (!code) return;
      Sfx.play("click");
      const { data } = await API.post("/api/matches/join", { code });
      if (data.match_id) go(data.match_id);
      else toast(data.error_he || "הקוד לא תקין");
    };
    document.getElementById("daily-btn").onclick = async (e) => {
      const { status, data } = await API.post("/api/daily/claim");
      if (status === 200) {
        Sfx.play("coin");
        toast(`🎁 קיבלת ${data.amount} מטבעות! רצף: ${data.streak} ימים`);
        window.refreshMe();
        e.target.disabled = true; e.target.textContent = "🎁 בונוס יומי (נאסף)";
      } else toast(data.error_he || "שגיאה");
    };
  },


  showMatchOffer(matchId, seconds) {
    if (this._offerBox) this._offerBox.remove();
    this._offerMatchId = matchId;
    const box = document.createElement("div");
    box.className = "match-offer";
    box.innerHTML = `<div class="card match-offer-card">
      <div class="match-offer-icon">⚔️</div>
      <h2>נמצא יריב!</h2>
      <p>להיכנס למשחק?</p>
      <p class="sub">ההזמנה תיסגר בעוד <b id="offer-seconds">${seconds}</b> שניות</p>
      <div class="match-offer-actions">
        <button class="btn" id="offer-accept">כן, מתחילים</button>
        <button class="btn secondary" id="offer-decline">לא עכשיו</button>
      </div>
    </div>`;
    document.body.appendChild(box);
    this._offerBox = box;
    let remaining = seconds, done = false;
    const close = () => {
      clearInterval(timer); box.remove();
      if (this._offerBox === box) this._offerBox = null;
      if (this._offerMatchId === matchId) this._offerMatchId = null;
    };
    const decline = async (expired = false) => {
      if (done) return; done = true;
      await API.post(`/api/matches/${matchId}/decline`);
      close();
      toast(expired ? "ההזמנה פגה" : "דחית את ההזמנה");
    };
    document.getElementById("offer-accept").onclick = async () => {
      if (done) return; done = true;
      const accept = document.getElementById("offer-accept");
      accept.disabled = true; accept.textContent = "נכנסים...";
      const { status, data } = await API.post(`/api/matches/${matchId}/accept`);
      close();
      if (status === 200 && data.match_id) location.hash = "#/game/" + data.match_id;
      else toast(data.error_he || "המשחק כבר לא זמין");
    };
    document.getElementById("offer-decline").onclick = () => decline(false);
    const timer = setInterval(() => {
      remaining -= 1;
      const el = document.getElementById("offer-seconds");
      if (el) el.textContent = Math.max(0, remaining);
      if (remaining <= 0) decline(true);
    }, 1000);
  },

  // ---------------- game ----------------
  async vGame(view, matchId) {
    const me = await API.get("/api/me");
    if (me.status === 200) { this.setMe(me.data); GameView.setInventory(me.data.inventory); }
    window.refreshMe = async () => {
      const m = await API.get("/api/me");
      if (m.status === 200) this.setMe(m.data);
    };
    await GameView.init(view, matchId);
    // waiting room overlay until opponent joins
    const waitCheck = setInterval(() => {
      if (!GameView.snap) return;
      if (GameView.snap.status === "waiting") {
        const ov = document.getElementById("game-overlay");
        if (ov && ov.classList.contains("hidden")) {
          ov.classList.remove("hidden");
          ov.innerHTML = `<h2>⏳ מחכים ליריב...</h2>
            ${GameView.snap.code ? `<div class="code-box">${esc(GameView.snap.code)}</div>
            <p class="sub">שתף את הקוד עם חבר</p>` : "<p>משחק מהיר - מחפש יריב</p>"}
            <button class="btn secondary" id="cancel-wait">ביטול</button>`;
          document.getElementById("cancel-wait").onclick = async () => {
            await API.post(`/api/matches/${matchId}/leave`);
            location.hash = "#/lobby";
          };
        }
      } else {
        const ov = document.getElementById("game-overlay");
        if (GameView.snap.status === "active" && ov && !GameView.snap.winner_side)
          ov.classList.add("hidden");
        clearInterval(waitCheck);
      }
    }, 1200);
  },

  // ---------------- store ----------------
  // --- א3: "My customization" - dedicated tab with a live animated tower
  // preview, every owned skin selectable, apply-on-click.
  async vCustom(view) {
    if (!this.me) { location.hash = "#/login"; return; }
    const { data } = await API.get("/api/store");
    const catalog = (data && data.catalog) || {};
    const inv = (data && data.inventory) || {};
    const DEFAULT_STYLE = { colors: ["#3b82f6", "#1e3a8a"], fill: ["#60a5fa", "#1d4ed8"],
      frame: "#bfdbfe", glow: "rgba(59,130,246,.38)", texture: "steel", emblem: "●" };
    const options = [{ id: "skin_default", name_he: "ברירת מחדל", desc_he: "המגדל הכחול הקלאסי", style: DEFAULT_STYLE }]
      .concat(Object.entries(catalog)
        .filter(([id, it]) => it.kind === "skin" && inv[id])
        .map(([id, it]) => ({ id, name_he: it.name_he, desc_he: it.desc_he, style: it.style || {} })));
    let applied = Object.keys(inv).find(id => id.startsWith("skin_") && inv[id].equipped) || "skin_default";
    this._custSel = applied;
    view.innerHTML = `
      <h1>🎨 ההתאמה שלי</h1>
      <div class="custom-wrap">
        <div class="card custom-preview">
          <canvas id="cust-canvas" width="300" height="240"></canvas>
          <div id="cust-name" class="cust-name"></div>
        </div>
        <div id="cust-list" class="custom-list"></div>
      </div>
      <p class="sub" style="margin-top:10px">מראים נוספים מחכים ב<a href="#/store">חנות</a> - כל רכישה מופיעה כאן מיד.</p>`;
    const canvas = document.getElementById("cust-canvas");
    const renderList = () => {
      const sel = options.find(o => o.id === this._custSel) || options[0];
      document.getElementById("cust-name").textContent = sel.name_he;
      document.getElementById("cust-list").innerHTML = options.map(o => `
        <div class="card item custom-item ${o.id === applied ? "equipped" : ""}" data-skin="${o.id}">
          <h3>${esc(o.name_he)}</h3>
          <p class="sub">${esc(o.desc_he || "")}</p>
          <p class="${o.id === applied ? "owned-tag" : "price"}">${o.id === applied ? "✓ המראה הפעיל שלך" : "בבעלותך - לחץ להחיל"}</p>
        </div>`).join("");
      document.querySelectorAll("[data-skin]").forEach(el =>
        el.onclick = () => applySkin(el.dataset.skin));
    };
    const applySkin = async (id) => {
      if (id === applied) return;
      this._custSel = id;
      renderList();
      const { status: s } = await API.post("/api/store/equip", { item_id: id });
      if (s === 200) {
        applied = id;
        Sfx.play("coin");
        toast("המראה הוחל - יופיע במשחק הבא");
        window.refreshMe?.();
      } else {
        toast("שגיאה בהחלת המראה");
      }
      renderList();
    };
    renderList();
    const loop = (t) => {
      if (!canvas.isConnected) return;  // navigated away - stop the preview
      const sel = options.find(o => o.id === this._custSel) || options[0];
      this.drawSkinPreview(canvas, sel.style, t || 0);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  // Compact standalone copy of the in-game tower renderer, for the live
  // customization preview: full-HP tower, animated glow.
  drawSkinPreview(canvas, style, t) {
    const c = canvas.getContext("2d");
    const BLOCK = 26, ROWS = 6, COLS = 4;
    const W = canvas.width, H = canvas.height, ground = H - 20;
    c.clearRect(0, 0, W, H);
    const cols = style.colors || ["#3b82f6", "#1e3a8a"];
    const fill = style.fill || cols;
    const tx = (W - COLS * BLOCK) / 2;
    const pulse = 0.7 + 0.3 * Math.sin(t / 350);
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const x = tx + col * BLOCK, y = ground - (ROWS - r) * BLOCK;
        c.save();
        if (style.glow) { c.shadowColor = style.glow; c.shadowBlur = 4 + 8 * pulse; }
        const grad = c.createLinearGradient(x, y, x + BLOCK, y + BLOCK);
        grad.addColorStop(0, fill[0]); grad.addColorStop(1, fill[1] || fill[0]);
        c.fillStyle = grad;
        c.fillRect(x + 1, y + 1, BLOCK - 2, BLOCK - 2);
        c.shadowBlur = 0;
        c.strokeStyle = style.frame || cols[1]; c.lineWidth = 2;
        c.strokeRect(x + 1, y + 1, BLOCK - 2, BLOCK - 2);
        c.globalAlpha = 0.22; c.strokeStyle = style.frame || "#fff"; c.lineWidth = 1;
        if (style.texture === "brick" && (r + col) % 2 === 0) {
          c.beginPath(); c.moveTo(x + 2, y + BLOCK / 2); c.lineTo(x + BLOCK - 2, y + BLOCK / 2); c.stroke();
        } else if (style.texture === "steel") {
          c.beginPath(); c.moveTo(x + 5, y + 5); c.lineTo(x + BLOCK - 5, y + BLOCK - 5); c.stroke();
          c.fillStyle = style.frame || "#fff"; c.beginPath(); c.arc(x + 5, y + 5, 1.5, 0, 7); c.fill();
        } else if (style.texture === "neon") {
          c.beginPath(); c.moveTo(x + 3, y + BLOCK - 4); c.lineTo(x + BLOCK - 4, y + 3); c.stroke();
        }
        c.restore();
      }
    }
    if (style.emblem) {
      const w = COLS * BLOCK, h = ROWS * BLOCK;
      c.save(); c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `bold ${Math.round(BLOCK * 1.35)}px sans-serif`;
      c.fillStyle = style.frame || "#fff";
      c.shadowColor = style.glow || "transparent"; c.shadowBlur = 12 * pulse;
      c.globalAlpha = 0.82;
      c.fillText(style.emblem, tx + w / 2, ground - h / 2);
      c.restore();
    }
    c.fillStyle = "rgba(148,163,184,.35)";
    c.fillRect(tx - 30, ground, COLS * BLOCK + 60, 4);
  },

  async vStore(view) {
    const { status, data } = await API.get("/api/store");
    if (status !== 200) { toast("שגיאה בטעינת החנות"); return; }
    const { catalog, inventory } = data;
    this.inventory = inventory;
    const sec = { consumable: "⚔️ נשקים מיוחדים", upgrade: "🛡️ שדרוגי מגדל", skin: "🎨 מראה" };
    const groups = { consumable: [], upgrade: [], skin: [] };
    for (const [id, it] of Object.entries(catalog)) groups[it.kind].push([id, it]);
    let html = `<h1>🛒 חנות</h1><p class="sub">יתרה: 🪙 ${data.coins} מטבעות</p>
      <div class="card"><h2>🎟️ מימוש קופון</h2>
        <div style="display:flex;gap:8px"><input id="coupon-in" placeholder="קוד קופון">
        <button class="btn" id="coupon-btn">ממש</button></div></div>`;
    for (const kind of ["consumable", "upgrade", "skin"]) {
      html += `<h2>${sec[kind]}</h2><div class="grid cols3">`;
      for (const [id, it] of groups[kind]) {
        const inv = inventory[id];
        let body = "";
        if (kind === "consumable") {
          body = `<p class="owned-tag">בתיק: ${inv ? inv.qty : 0} שימושים</p>
                  <p class="price">🪙 ${it.price} (חבילה של ${it.pack_shots})</p>`;
        } else if (kind === "upgrade") {
          const lvl = inv ? inv.level : 0;
          const pips = Array.from({ length: it.max_level },
            (_, i) => `<span class="${i < lvl ? "on" : ""}"></span>`).join("");
          const next = lvl < it.max_level ? `🪙 ${it.prices[lvl]}` : "מקסימום";
          body = `<div class="level-pips">${pips}</div><p class="price">${next}</p>`;
        } else {
          const owned = !!inv;
          body = `<div class="swatch" style="background:linear-gradient(135deg,${it.colors[0]},${it.colors[1]})"></div>
                  <p class="${owned ? "owned-tag" : "price"}">${owned ? (inv.equipped ? "✓ המראה הפעיל שלך" : "בבעלותך - לחץ להחיל") : "🪙 " + it.price}</p>`;
        }
        const skinBtn = kind === "skin"
          ? (inv && inv.equipped ? "✓ במשחק" : inv ? "החל מראה" : "קנה והחל")
          : "קנה";
        html += `<div class="card item${kind === "skin" && inv && inv.equipped ? " equipped" : ""}">
          <b>${esc(it.name_he)}</b><span class="sub" style="margin:0">${esc(it.desc_he)}</span>
          ${body}
          <button class="btn small" data-buy="${id}" ${kind === "skin" && inv && inv.equipped ? "disabled" : ""}>${skinBtn}</button>
        </div>`;
      }
      html += `</div>`;
    }
    view.innerHTML = html;
    document.getElementById("coupon-btn").onclick = async () => {
      const code = document.getElementById("coupon-in").value.trim();
      const { status: s, data: d } = await API.post("/api/coupons/redeem", { code });
      if (s === 200) { Sfx.play("coin"); toast(`🎉 מומש: ${d.reward}`); window.refreshMe?.(); }
      else toast(d.error_he || "קופון לא תקין");
    };
    view.querySelectorAll("[data-buy]").forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.buy;
      const inv = this.inventory[id];
      if (catalog[id].kind === "skin" && inv) {
        const { status: s } = await API.post("/api/store/equip", { item_id: id });
        if (s === 200) { Sfx.play("coin"); toast("המראה הוחל - יופיע במשחק הבא"); this.vStore(view); window.refreshMe?.(); }
        return;
      }
      const { status: s, data: d } = await API.post("/api/store/buy", { item_id: id });
      if (s === 200) {
        Sfx.play("coin");
        toast(catalog[id].kind === "skin" ? "נקנה והוחל! יופיע במשחק הבא" : "נקנה בהצלחה!");
        this.vStore(view); window.refreshMe?.();
      }
      else toast(d.error_he || "הקנייה נכשלה");
    });
  },

  // ---------------- leaderboard ----------------
  async vLeaderboard(view) {
    const { status, data } = await API.get("/api/leaderboard");
    if (status !== 200) { toast("שגיאה"); return; }
    let html = `<h1>🏆 טבלת דירוג</h1><p class="sub">הדירוג עולה ויורד לפי נצחונות והפסדים.</p>
      <div class="card"><table><tr><th>#</th><th>שחקן</th><th>דרגה</th><th>דירוג</th><th>נצ׳</th><th>הפ׳</th></tr>`;
    data.leaderboard.forEach((p, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || (i + 1);
      html += `<tr style="${p.id === data.me ? "outline:2px solid var(--accent)" : ""}">
        <td>${medal}</td><td>${esc(p.name)}</td><td>${esc(p.rank)}</td>
        <td>${p.rating}</td><td>${p.wins}</td><td>${p.losses}</td></tr>`;
    });
    html += `</table></div>`;
    view.innerHTML = html;
  },

  // ---------------- messages ----------------
  async vMessages(view) {
    const { status, data } = await API.get("/api/messages");
    if (status !== 200) { toast("שגיאה"); return; }
    let html = `<h1>✉️ הודעות</h1>`;
    if (!data.messages.length) html += `<p class="sub">אין הודעות עדיין.</p>`;
    for (const m of data.messages) {
      html += `<div class="msg ${m.read ? "" : "unread"}">
        <b>${esc(m.title)}</b> <span class="t">${esc(m.created_at.slice(0, 16).replace("T", " "))}</span>
        <p>${esc(m.body)}</p></div>`;
    }
    view.innerHTML = html;
    this.setUnread(0);
  },

  // ---------------- admin ----------------
  async vAdmin(view, tab) {
    if (!this.me?.is_admin) { view.innerHTML = "<p>אין הרשאה.</p>"; return; }
    tab = tab || "stats";
    view.innerHTML = `
      <h1>🛠️ ניהול</h1>
      <div class="tabs">
        ${["stats", "users", "audit", "broadcast", "coupons", "matches", "maintenance"].map(t =>
          `<button data-tab="${t}" class="${t === tab ? "active" : ""}">${{
            stats: "סטטיסטיקות", users: "משתמשים", audit: "יומן פעילות", broadcast: "שידור הודעה",
            coupons: "קופונים", matches: "משחקים", maintenance: "תחזוקה" }[t]}</button>`).join("")}
      </div>
      <div id="admin-body"></div>`;
    view.querySelectorAll(".tabs button").forEach(b =>
      b.onclick = () => this.vAdmin(view, b.dataset.tab));
    const body = document.getElementById("admin-body");

    if (tab === "stats") {
      const { data } = await API.get("/api/admin/overview");
      const s = data.stats || {};
      body.innerHTML = `<div class="stat-cards">
        ${[["משתמשים", s.users_total], ["פעילים היום", s.users_today],
           ["משחקים", s.matches_total], ["משחקים פעילים", s.matches_active],
           ["מטבעות הונפקו", s.coins_issued], ["מטבעות הוצאו", s.coins_spent],
           ["רכישות", s.purchases], ["חסומים", s.banned]]
          .map(([k, v]) => `<div class="card"><b>${v ?? 0}</b>${k}</div>`).join("")}
        </div><h2>תנועות אחרונות</h2><div class="card"><table>
        <tr><th>זמן</th><th>משתמש</th><th>סכום</th><th>סיבה</th></tr>
        ${(data.recent_transactions || []).map(t =>
          `<tr><td>${esc(t.created_at.slice(5, 16).replace("T", " "))}</td>
           <td>${esc(t.email)}</td><td>${t.delta}</td><td>${esc(t.reason)}</td></tr>`).join("")}
        </table></div>`;
    } else if (tab === "users") {
      body.innerHTML = `<input id="uq" placeholder="חיפוש לפי שם או אימייל">
        <div id="ulist" style="margin-top:10px"></div>`;
      const load = async () => {
        const { data } = await API.get("/api/admin/users?q=" + encodeURIComponent(document.getElementById("uq").value));
        document.getElementById("ulist").innerHTML = `<div class="card"><table>
          <tr><th>משתמש</th><th>מטבעות</th><th>דירוג</th><th>נ/ה</th><th>סטטוס</th><th>פעולות</th></tr>
          ${(data.users || []).map(u => `<tr>
            <td>${esc(u.name)}<br><span class="sub" style="margin:0">${esc(u.email)}</span></td>
            <td>${u.coins}</td><td>${u.rating}</td><td>${u.wins}/${u.losses}</td>
            <td>${u.suspended ? "🚫 מושהה" : u.banned_until ? "⏸️ חסום" : "✓"}</td>
            <td style="white-space:nowrap">
              <button class="btn small secondary" data-coins="${u.id}">🪙±</button>
              <button class="btn small secondary" data-ban="${u.id}">חסום 24ש׳</button>
              <button class="btn small secondary" data-susp="${u.id}">השהה</button>
              <button class="btn small secondary" data-lift="${u.id}">שחרר</button>
            </td></tr>`).join("")}</table></div>`;
        body.querySelectorAll("[data-ban]").forEach(b => b.onclick = async () => {
          await API.post(`/api/admin/users/${b.dataset.ban}/moderate`, { action: "ban", hours: 24 });
          toast("נחסם ל-24 שעות"); load();
        });
        body.querySelectorAll("[data-susp]").forEach(b => b.onclick = async () => {
          await API.post(`/api/admin/users/${b.dataset.susp}/moderate`, { action: "suspend" });
          toast("הושהה"); load();
        });
        body.querySelectorAll("[data-lift]").forEach(b => b.onclick = async () => {
          await API.post(`/api/admin/users/${b.dataset.lift}/moderate`, { action: "lift" });
          toast("שוחרר"); load();
        });
        body.querySelectorAll("[data-coins]").forEach(b => b.onclick = async () => {
          const v = prompt("כמה מטבעות להוסיף/להוריד? (למשל 500 או -200)");
          if (v === null) return;
          const reason = prompt("סיבה (תוצג ביומן):", "admin_adjustment") || "admin_adjustment";
          const { data: d } = await API.post(`/api/admin/users/${b.dataset.coins}/coins`,
            { delta: parseInt(v, 10) || 0, reason });
          if (d.ok) { toast("עודכן. יתרה: " + d.coins); load(); }
          else toast("שגיאה");
        });
      };
      document.getElementById("uq").oninput = () => load();
      load();
    } else if (tab === "audit") {
      const { status, data } = await API.get("/api/admin/audit");
      if (status !== 200) { body.innerHTML = `<p>שגיאה בטעינת היומן.</p>`; return; }
      body.innerHTML = `<div class="card"><p class="sub">${esc(data.notice || "")}</p><table>
        <tr><th>זמן</th><th>מנהל/משתמש</th><th>פעולה</th><th>יעד</th><th>פרטים</th></tr>
        ${(data.audit || []).map(a => `<tr><td>${esc(a.created_at.slice(0, 16).replace("T", " "))}</td>
          <td>${esc(a.actor_email || "מערכת")}</td><td>${esc(a.action)}</td>
          <td>${esc((a.target_type || "") + (a.target_id ? ":" + a.target_id : ""))}</td>
          <td class="audit-details">${esc(a.details || "")}</td></tr>`).join("")}
        </table></div>`;
    } else if (tab === "maintenance") {
      const { data: mt } = await API.get("/api/admin/maintenance");
      body.innerHTML = `<div class="card">
        <h2>🚧 מצב תחזוקה</h2>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" id="mt-on" ${mt && mt.on ? "checked" : ""} style="width:auto">
          הצג באנר תחזוקה לכל השחקנים (בכל המסכים, כולל במשחק)</label>
        <label>נוסח ההודעה</label>
        <input id="mt-msg" value="${esc((mt && mt.message) || "")}" placeholder="למשל: תחזוקה מתוכננת הלילה ב-23:00">
        <button class="btn" id="mt-save" style="margin-top:12px">שמור</button></div>`;
      document.getElementById("mt-save").onclick = async () => {
        const { status: s, data: d } = await API.post("/api/admin/maintenance", {
          on: document.getElementById("mt-on").checked,
          message: document.getElementById("mt-msg").value });
        if (s === 200) { this.setMaintenance(d.maintenance); toast("נשמר"); }
        else toast("שגיאה");
      };
    } else if (tab === "broadcast") {
      body.innerHTML = `<div class="card">
        <label>כותרת</label><input id="bc-title">
        <label>תוכן ההודעה (תישלח לכל המשתמשים)</label>
        <input id="bc-body" style="height:80px">
        <button class="btn" id="bc-send" style="margin-top:12px">📢 שלח לכולם</button></div>`;
      document.getElementById("bc-send").onclick = async () => {
        const title = document.getElementById("bc-title").value;
        const b = document.getElementById("bc-body").value;
        const { status: s } = await API.post("/api/admin/broadcast", { title, body: b });
        toast(s === 200 ? "ההודעה שודרה לכל המשתמשים" : "שגיאה");
      };
    } else if (tab === "coupons") {
      body.innerHTML = `<div class="card">
        <h2>יצירת קופון</h2>
        <label>סוג</label>
        <select id="cp-kind"><option value="coins">מטבעות</option><option value="item">פריט</option></select>
        <label>סכום (אם מטבעות)</label><input id="cp-amount" type="number" value="100">
        <label>פריט (אם פריט)</label>
        <select id="cp-item">${["double_bomb","homing_missile","cluster_shell","skin_emerald","skin_crimson","skin_royal","skin_gold"]
          .map(i => `<option>${i}</option>`).join("")}</select>
        <label>מספר מימושים</label><input id="cp-uses" type="number" value="1">
        <label>קוד (ריק = אקראי)</label><input id="cp-code">
        <button class="btn" id="cp-create" style="margin-top:12px">צור קופון</button></div>
        <div id="cp-list"></div>`;
      const loadC = async () => {
        const { data } = await API.get("/api/admin/coupons");
        document.getElementById("cp-list").innerHTML = `<div class="card"><table>
          <tr><th>קוד</th><th>סוג</th><th>ערך</th><th>מימושים</th><th></th></tr>
          ${(data.coupons || []).map(c => `<tr><td><b>${esc(c.code)}</b></td>
            <td>${c.kind}</td><td>${c.kind === "coins" ? c.amount : c.item_id}</td>
            <td>${c.uses}/${c.max_uses}</td>
            <td><button class="btn small danger" data-delc="${esc(c.code)}">מחק</button></td></tr>`).join("")}
          </table></div>`;
        body.querySelectorAll("[data-delc]").forEach(b => b.onclick = async () => {
          await API.del("/api/admin/coupons/" + b.dataset.delc); loadC();
        });
      };
      document.getElementById("cp-create").onclick = async () => {
        const payload = {
          kind: document.getElementById("cp-kind").value,
          amount: parseInt(document.getElementById("cp-amount").value, 10) || 100,
          item_id: document.getElementById("cp-item").value,
          max_uses: parseInt(document.getElementById("cp-uses").value, 10) || 1,
          code: document.getElementById("cp-code").value,
        };
        const { status: s, data: d } = await API.post("/api/admin/coupons", payload);
        toast(s === 200 ? "נוצר קופון: " + d.code : (d.error || "שגיאה"));
        loadC();
      };
      loadC();
    } else if (tab === "matches") {
      const { data } = await API.get("/api/admin/matches");
      body.innerHTML = `<div class="card"><table>
        <tr><th>מזהה</th><th>סוג</th><th>סטטוס</th><th>עודכן</th></tr>
        ${(data.matches || []).map(m => `<tr><td>${esc(m.id)}</td><td>${m.mode}</td>
          <td>${m.status}</td><td>${esc(m.updated_at.slice(5, 16).replace("T", " "))}</td></tr>`).join("")}
        </table></div>`;
    }
  },
};

App.boot();

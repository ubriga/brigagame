function apiError(result, fallback = "שגיאה") {
  const data = (result && result.data) || {};
  if (data.error_he) return data.error_he;
  if (data.detail) return String(data.detail);
  if (result && result.networkError) return "אין חיבור לשרת. נסה שוב.";
  if (result && result.status) return `${fallback} (HTTP ${result.status})`;
  return fallback;
}

// Router + views (login, lobby, store, leaderboard, messages).
const App = {
  me: null, inventory: {}, _routeSeq: 0,

  routeCurrent(seq) { return seq === this._routeSeq; },

  async boot() {
    Lang.boot();
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
    // Mobile autoplay: resume the AudioContext on the first gesture anywhere;
    // start decoding samples right away (decode works while suspended).
    const unlockAudio = () => { Sfx.unlock(); };
    ["pointerdown", "touchstart", "keydown"].forEach((ev) =>
      window.addEventListener(ev, unlockAudio, { passive: true, capture: true }));
    Sfx.preload();
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

  // Maintenance notice: dismissible to a small side chip per browser. A new
  // notice text expands again so users do not miss a changed announcement.
  setMaintenance(m) {
    const el = document.getElementById("maintenance-banner");
    if (!el) return;
    const message = m && m.on ? (m.message || "המשחק בתחזוקה זמנית") : "";
    if (!message) { el.className = "hidden"; el.innerHTML = ""; return; }
    const key = "bg_maintenance_collapsed_" + message;
    const collapsed = localStorage.getItem(key) === "1";
    el.className = collapsed ? "maintenance-collapsed" : "maintenance-expanded";
    el.innerHTML = collapsed
      ? `<button class="maintenance-chip" title="${esc(message)}" aria-label="הצג הודעת תחזוקה">🚧 תחזוקה</button>`
      : `<span>🚧 ${esc(message)}</span><button class="maintenance-close" aria-label="סגירת הודעת תחזוקה">×</button>`;
    const close = el.querySelector(".maintenance-close");
    if (close) close.onclick = () => { localStorage.setItem(key, "1"); this.setMaintenance(m); };
    const chip = el.querySelector(".maintenance-chip");
    if (chip) chip.onclick = () => { localStorage.removeItem(key); this.setMaintenance(m); };
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
    if (this.me.is_admin && !this._panelLoading) {
      this._panelLoading = true;
      import("/js/panel.js?v=1").then(m => m.install(this)).catch(() => { this._panelLoading = false; });
    }
    GameView.setInventory(this.inventory);
  },

  route() {
    if (GameView.canvas) GameView.destroy();
    const seq = ++this._routeSeq;
    const hash = location.hash || "#/lobby";
    const inGame = hash.startsWith("#/game/");
    // Match music belongs to the battlefield. Always stop it when routing to
    // the lobby or any other screen (including PWA history navigation).
    if (!inGame) Sfx.stopMusic();
    // The HUD owns match exit. Mark the document so the account logout cannot
    // appear as a second, confirmation-free exit path during gameplay.
    document.body.classList.toggle("game-active", inGame);
    document.body.classList.toggle("login-active", hash.startsWith("#/login"));
    const view = document.getElementById("view");
    view.setAttribute("aria-busy", "true");
    view.innerHTML = `<div class="route-loading" role="status">${Lang.current === "en" ? "Loading…" : "טוען…"}</div>`;
    document.querySelectorAll("#topbar nav a").forEach(a =>
      a.classList.toggle("active", hash.startsWith("#/" + a.dataset.nav)));
    if (hash.startsWith("#/auth")) {
      const t = new URLSearchParams((hash.split("?")[1] || "")).get("token");
      if (t) {
        API.setToken(t, localStorage.getItem("bg_remember") !== "0");
        (async () => {
          const me = await API.get("/api/me");
          if (me.status === 200) App.setMe(me.data);
          App.startPulse(); Sfx.ensure(); Sfx.startMusic();
          location.hash = "#/lobby";
        })();
      } else location.hash = "#/login";
      return;
    }
    if (!API.token && !hash.startsWith("#/login")) { location.hash = "#/login"; return; }
    if (hash.startsWith("#/game/")) this.vGame(view, hash.split("/")[2], seq);
    else if (hash.startsWith("#/store")) this.vStore(view, seq);
    else if (hash.startsWith("#/custom")) this.vCustom(view, seq);
    else if (hash.startsWith("#/leaderboard")) this.vLeaderboard(view, seq);
    else if (hash.startsWith("#/messages")) this.vMessages(view, seq);
    else if (this._routeHook && this._routeHook(hash, view, seq)) { /* extension route */ }
    else if (hash.startsWith("#/login")) { this.vLogin(view); view.removeAttribute("aria-busy"); }
    else this.vLobby(view, seq);
  },

  // ---------------- login ----------------
  vLogin(view) {
    document.getElementById("topbar").classList.add("hidden");
    const incomingError = new URLSearchParams((location.hash.split("?")[1] || "")).get("auth_error") || "";
    view.innerHTML = `
      <div id="login-wrap">
        <div class="logo">🎯</div>
        <h1>Brigagame <span style="color:var(--accent)">2.0</span></h1>
        <p class="sub">by OrelAI · משחק ארטילריה מולטיפלייר - הפל את מגדל היריב!</p>
        <div class="card">
          <div id="login-error" class="hidden" style="background:rgba(255,80,80,.12);border:1px solid rgba(255,80,80,.45);border-radius:10px;padding:10px;margin-bottom:12px;text-align:center">
            <div id="login-error-text" style="font-size:14px"></div>
            <button class="btn" id="login-retry" style="margin-top:8px;padding:12px 22px;font-size:16px">🔄 נסה שוב</button>
            <div id="login-report" class="hidden" style="margin-top:8px;font-size:13px">
              עדיין לא עובד? <a href="mailto:ubriga@gmail.com?subject=בעיית%20התחברות%20Brigagame">דווח לנו</a>
            </div>
          </div>
          <div id="login-spin" class="hidden" style="text-align:center;padding:6px">
            <div class="spinner"></div><div class="sub" style="margin-top:6px">מתחבר…</div>
          </div>
          <div id="login-methods">
            <button class="btn" id="redirect-btn" style="width:100%;margin-top:8px">🟢 כניסה עם חשבון גוגל</button>
            <div id="email-block" class="hidden" style="margin-top:14px;border-top:1px solid rgba(255,255,255,.12);padding-top:12px">
              <div class="sub" style="font-size:13px;margin-bottom:6px">או כניסה עם קוד למייל:</div>
              <div id="email-step1">
                <input id="email-input" type="email" placeholder="המייל שלך" dir="ltr" style="text-align:left">
                <button class="btn secondary" id="email-send" style="width:100%;margin-top:6px">שלח לי קוד כניסה</button>
              </div>
              <div id="email-step2" class="hidden">
                <input id="code-input" inputmode="numeric" maxlength="6" placeholder="קוד בן 6 ספרות" dir="ltr" style="text-align:center;letter-spacing:6px">
                <button class="btn" id="email-verify" style="width:100%;margin-top:6px">כניסה</button>
                <button class="btn secondary" id="email-back" style="width:100%;margin-top:6px;font-size:13px;padding:8px">חזרה</button>
              </div>
              <div class="sub" id="email-from-note" style="font-size:12px;margin-top:8px;line-height:1.5"></div>
              </div>
            </div>
          </div>
          <label style="display:flex;align-items:center;justify-content:center;gap:6px;margin:10px 0 4px;font-size:14px;cursor:pointer">
            <input type="checkbox" id="remember-me" checked
              style="width:auto;padding:0;margin:0;accent-color:var(--accent)">
            <span>זכור אותי</span>
          </label>
          <p class="sub" style="font-size:13px">
            בהתחברות אתה מאשר את <a href="terms.html">תנאי השימוש</a>
            ו<a href="privacy.html">מדיניות הפרטיות</a>.</p>
        </div>
        <div id="dev-login" class="card hidden">
          <label>כניסת פיתוח (מקומית בלבד)</label>
          <input id="dev-email" placeholder="dev@example.com">
          <button class="btn secondary" style="margin-top:8px" id="dev-btn">כניסה</button>
        </div>
      </div>`;
    const rememberEl = document.getElementById("remember-me");
    rememberEl.checked = localStorage.getItem("bg_remember") !== "0";
    rememberEl.onchange = () => localStorage.setItem("bg_remember", rememberEl.checked ? "1" : "0");
    let failCount = Number(sessionStorage.getItem("bg_login_fails") || 0);
    let lastMethod = "";
    const errBox = document.getElementById("login-error");
    const setSpin = (on) => {
      document.getElementById("login-spin").classList.toggle("hidden", !on);
      const m = document.getElementById("login-methods");
      m.style.opacity = on ? "0.35" : "1";
      m.style.pointerEvents = on ? "none" : "auto";
    };
    const showError = (msg) => {
      failCount += 1; sessionStorage.setItem("bg_login_fails", String(failCount));
      document.getElementById("login-error-text").textContent = msg;
      errBox.classList.remove("hidden");
      document.getElementById("login-report").classList.toggle("hidden", failCount < 2);
      setSpin(false);
    };
    const clearError = () => errBox.classList.add("hidden");
    const finishLogin = async (data) => {
      API.setToken(data.token, rememberEl.checked);
      sessionStorage.setItem("bg_login_fails", "0");
      const me = await API.get("/api/me");
      if (me.status === 200) App.setMe(me.data);
      App.startPulse();
      Sfx.ensure(); Sfx.startMusic();
      location.hash = "#/lobby";
    };
    const redirectStart = () => {
      clearError(); lastMethod = "redirect";
      location.href = CONFIG.API_BASE + "/api/auth/google/start";
    };
    document.getElementById("login-retry").onclick = () => {
      if (lastMethod === "redirect") return redirectStart();
      if (lastMethod === "email") return document.getElementById("email-send").click();
      clearError();
    };
    if (incomingError) showError(incomingError);
    // Google sign-in is always the plain redirect flow: the account chooser
    // lives at Google, after a click. No Google script runs on this page, so
    // no personalized prompt or button can appear before that click.
    document.getElementById("redirect-btn").onclick = redirectStart;
    API.get("/api/auth/options").then(({ status, data }) => {
      if (status !== 200 || !data) return;
      if (data.email_code) document.getElementById("email-block").classList.remove("hidden");
      if (data.email_code && data.email_from)
        document.getElementById("email-from-note").innerHTML =
          'הקוד יגיע מ-<b dir="ltr">' + data.email_from + '</b><br>לא מוצאים? בדקו גם בתיקיית הספאם.';
    });
    document.getElementById("email-send").onclick = async () => {
      const email = document.getElementById("email-input").value.trim();
      if (!email) return;
      lastMethod = "email"; clearError(); setSpin(true);
      const { status, data } = await API.post("/api/auth/email/start", { email });
      if (status === 200) {
        setSpin(false);
        document.getElementById("email-step1").classList.add("hidden");
        document.getElementById("email-step2").classList.remove("hidden");
        toast("נשלח קוד למייל - בדוק גם בספאם");
      } else showError((data && data.error_he) || "שליחת הקוד נכשלה. נסה שוב.");
    };
    document.getElementById("email-verify").onclick = async () => {
      const code = document.getElementById("code-input").value.trim();
      if (code.length !== 6) return;
      lastMethod = "email"; clearError(); setSpin(true);
      const { status, data } = await API.post("/api/auth/email/verify",
        { email: document.getElementById("email-input").value.trim(), code });
      if (status === 200) finishLogin(data);
      else showError((data && data.error_he) || "הקוד שגוי. נסה שוב.");
    };
    document.getElementById("email-back").onclick = () => {
      document.getElementById("email-step2").classList.add("hidden");
      document.getElementById("email-step1").classList.remove("hidden");
    };
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      document.getElementById("dev-login").classList.remove("hidden");
      document.getElementById("dev-btn").onclick = async () => {
        const email = document.getElementById("dev-email").value.trim();
        const { status, data } = await API.post("/api/auth/dev", { email });
        if (status === 200) { API.setToken(data.token, rememberEl.checked); App.setMe(await (await fetch(CONFIG.API_BASE + "/api/me", { headers: { Authorization: "Bearer " + data.token } })).json()); App.startPulse(); location.hash = "#/lobby"; }
        else toast(data.error_he || "כניסת פיתוח כבויה");
      };
    }
  },

  botRankOptions(minLevel = 1, selectedLevel = null) {
    const names = ["טוראי", "רב טוראי", "סמל", "סמל ראשון", "רב סמל",
      "רב סמל ראשון", "רב סמל מתקדם", "רב סמל בכיר", "רב נגד", "סגן משנה",
      "סגן", "סרן", "רב סרן", "סגן אלוף", "אלוף משנה", "תת אלוף", "אלוף", "רב אלוף"];
    minLevel = Math.max(1, Math.min(18, Number(minLevel) || 1));
    selectedLevel = Math.max(minLevel, Math.min(18, Number(selectedLevel) || minLevel));
    return names.map((name, i) => {
      const level = i + 1;
      return level < minLevel ? "" : `<option value="${level}" ${level === selectedLevel ? "selected" : ""}>${name}${level === minLevel ? " (הדרגה שלך)" : ""}</option>`;
    }).join("");
  },

  // ---------------- lobby ----------------
  async vLobby(view, seq = this._routeSeq) {
    if (!this.routeCurrent(seq)) return;
    if (!this.me) { location.hash = "#/login"; return; }
    const u = this.me;
    view.removeAttribute("aria-busy");
    view.innerHTML = `
      <h1>שלום, ${esc(u.name)} 👋</h1>
      <p class="sub">הפל את מגדל היריב לפני שהוא מפיל את שלך.</p>
      <div class="grid cols2">
        <div class="card">
          <h2>🎮 משחק</h2>
          <div class="grid">
            <button class="btn" id="quick-btn">⚡ משחק מהיר</button>
            <div class="ai-start">
              <label for="ai-tier" class="sub" style="margin:0">רמת קושי מול בוט:</label>
              <select id="ai-tier" aria-label="רמת קושי">
                <option value="easy">קל - תרגול, ללא נקודות או מטבעות</option>
                <option value="medium">בינוני</option>
                <option value="hard">קשה</option>
                <option value="ultra">אולטרה קשה</option>
                <option value="expert">מומחה - האתגר הקשה ביותר</option>
              </select>
              <button class="btn" id="ai-btn">🤖 התחל משחק מול בוט</button>
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
          <div class="rank-progress-card">
            <div class="rank-progress-head">
              <span>דרגה נוכחית: <b>${esc(u.idf_rank.name_he)} (${esc(u.idf_rank.abbr_he)})</b></span>
              <span>${u.idf_rank.next ? `הבאה: <b>${esc(u.idf_rank.next.name_he)} (${esc(u.idf_rank.next.abbr_he)})</b>` : "הגעת לדרגה הגבוהה ביותר"}</span>
            </div>
            <div class="rank-progress-track"><div style="width:${u.idf_rank.progress_pct}%"></div></div>
            <p>${u.idf_rank.next ? `נשארו <b>${u.idf_rank.next.wins_to_go}</b> XP לקידום` : "רא״ל - דרגה מרבית"}</p>
          </div>
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
      const result = await API.post("/api/matches/quick");
      const data = result.data || {};
      if (data.status === "waiting") {
        toast("מחכה ליריב...");
        go(data.match_id);
      } else if (data.status === "offered" && data.match_id) {
        this.showMatchOffer(data.match_id, data.expires_in || 20);
      } else if (data.match_id) go(data.match_id);
      else toast(apiError(result, "שגיאה ביצירת משחק מהיר"));
    };
    const aiTier = document.getElementById("ai-tier");
    const savedAiTier = localStorage.getItem("brigagame.aiTier");
    if (["easy", "medium", "hard", "ultra", "expert"].includes(savedAiTier)) aiTier.value = savedAiTier;
    else aiTier.value = "medium";
    aiTier.onchange = () => localStorage.setItem("brigagame.aiTier", aiTier.value);
    document.getElementById("ai-btn").onclick = async () => {
      Sfx.play("click");
      const difficulty = aiTier.value;
      localStorage.setItem("brigagame.aiTier", difficulty);
      const result = await API.post("/api/matches/ai", { difficulty });
      const data = result.data || {};
      if (data.match_id) go(data.match_id); else toast(apiError(result, "שגיאה ביצירת משחק מול בוט"));
    };
    document.getElementById("friend-btn").onclick = async () => {
      Sfx.play("click");
      const result = await API.post("/api/matches/friend");
      const data = result.data || {};
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
      } else toast(apiError(result, "שגיאה ביצירת משחק חברים"));
    };
    document.getElementById("join-btn").onclick = async () => {
      const code = document.getElementById("join-code").value.trim();
      if (!code) return;
      Sfx.play("click");
      const result = await API.post("/api/matches/join", { code });
      const data = result.data || {};
      if (data.match_id) go(data.match_id);
      else toast(apiError(result, "הקוד לא תקין"));
    };
    document.getElementById("daily-btn").onclick = async (e) => {
      const result = await API.post("/api/daily/claim");
      const { status } = result;
      const data = result.data || {};
      if (status === 200) {
        Sfx.play("coin");
        toast(`🎁 קיבלת ${data.amount} מטבעות! רצף: ${data.streak} ימים`);
        window.refreshMe();
        e.target.disabled = true; e.target.textContent = "🎁 בונוס יומי (נאסף)";
      } else toast(apiError(result, "שגיאה באיסוף הבונוס היומי"));
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
  async vGame(view, matchId, seq = this._routeSeq) {
    const me = await API.get("/api/me");
    if (!this.routeCurrent(seq)) return;
    if (me.status === 200) { this.setMe(me.data); GameView.setInventory(me.data.inventory); }
    window.refreshMe = async () => {
      const m = await API.get("/api/me");
      if (m.status === 200) this.setMe(m.data);
    };
    await GameView.init(view, matchId);
    const botFb = me.status === 200 ? (me.data.bot_fallback || null) : null;
    // waiting room overlay until opponent joins
    let waitStart = 0, fbOffered = false, fbDeclined = false;
    const waitCheck = setInterval(() => {
      if (!GameView.snap) return;
      if (GameView.snap.status === "waiting") {
        const ov = document.getElementById("game-overlay");
        if (ov && ov.classList.contains("hidden")) {
          waitStart = Date.now();
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
        // Bot fallback offer: a quick match with no human found in time gets a
        // one-tap switch to a bot game (also gated server-side).
        const isQuickWait = GameView.snap.mode === "quick" && !GameView.snap.code;
        if (ov && isQuickWait && botFb && botFb.enabled && !fbOffered && !fbDeclined
            && waitStart && Date.now() - waitStart >= Number(botFb.wait_seconds || 30) * 1000) {
          fbOffered = true;
          const box = document.createElement("div");
          box.id = "bot-fallback-box";
          box.innerHTML = `<p style="margin:14px 0 0">🤖 לא נמצא יריב עדיין - לשחק מיד נגד הבוט?</p>
            <div style="display:flex;gap:8px;justify-content:center;margin-top:10px">
              <button class="btn" id="bot-fallback-yes">שחק נגד הבוט</button>
              <button class="btn secondary" id="bot-fallback-no">להמשיך לחכות</button>
            </div>`;
          ov.appendChild(box);
          document.getElementById("bot-fallback-no").onclick = () => {
            fbDeclined = true; box.remove(); toast("ממשיכים לחפש יריב...");
          };
          document.getElementById("bot-fallback-yes").onclick = async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true; btn.textContent = "מתחיל...";
            const { status, data } = await API.post("/api/matches/quick/bot-fallback", { match_id: matchId });
            if (status === 200 && data.match_id) {
              box.remove();
              if (data.match_id !== matchId) {
                clearInterval(waitCheck);
                location.hash = "#/game/" + data.match_id;
              }
              // Same id = a human joined meanwhile; the live snapshot flips the
              // overlay to the game by itself.
            } else {
              btn.disabled = false; btn.textContent = "שחק נגד הבוט";
              toast((data && data.error_he) || "לא הצלחנו להתחיל משחק נגד הבוט");
            }
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
  async vCustom(view, seq = this._routeSeq) {
    if (!this.me) { location.hash = "#/login"; return; }
    const { data } = await API.get("/api/store");
    const { data: coatingData } = await API.get("/api/coatings");
    const { data: expansionData } = await API.get("/api/expansions");
    if (!this.routeCurrent(seq)) return;
    const catalog = (data && data.catalog) || {};
    const inv = (data && data.inventory) || {};
    const DEFAULT_STYLE = { colors: ["#3b82f6", "#1e3a8a"], fill: ["#60a5fa", "#1d4ed8"],
      frame: "#bfdbfe", glow: "rgba(59,130,246,.38)", texture: "steel", emblem: "●" };
    const options = [{ id: "skin_default", name_he: "ברירת מחדל", desc_he: "המגדל הכחול הקלאסי", style: DEFAULT_STYLE }]
      .concat(Object.entries(catalog)
        .filter(([id, it]) => it.kind === "skin" && inv[id])
        .map(([id, it]) => ({ id, name_he: it.name_he, desc_he: it.desc_he, style: { colors: it.colors, ...(it.style || {}) } })));
    let applied = Object.keys(inv).find(id => id.startsWith("skin_") && inv[id].equipped) || "skin_default";
    this._custSel = applied;
    view.removeAttribute("aria-busy");
    view.innerHTML = `
      <h1>🏗️ סדנת המגדל שלי</h1>
      <p class="sub workshop-intro">כאן משדרגים את המגדל. ציפויים וקוביות נמצאים תמיד בראש העמוד.</p>
      <div class="workshop-jump"><a href="#coating-workshop">ציפוי מגדל</a><a href="#expansion-workshop">הוספת קוביות</a><a href="#appearance-workshop">מראה המגדל</a></div>
      <div class="card player-coatings" id="coating-workshop"><h2>🏗️ בניית ציפוי למגדל שלי</h2><div id="player-coating-state"></div></div>
      <div class="card player-expansion" id="expansion-workshop"><h2>🧱 הרחבת שטח המגדל</h2><div id="player-expansion-state"></div></div>
      <h2 id="appearance-workshop">🎨 מראה המגדל</h2>
      <div class="custom-wrap">
        <div class="card custom-preview">
          <canvas id="cust-canvas" width="300" height="240"></canvas>
          <div id="cust-name" class="cust-name"></div>
        </div>
        <div id="cust-list" class="custom-list"></div>
      </div>
      <p class="sub" style="margin-top:10px">מראים נוספים מחכים ב<a href="#/store">חנות</a> - כל רכישה מופיעה כאן מיד.</p>`;
    const canvas = document.getElementById("cust-canvas");
    const coatingState = document.getElementById("player-coating-state");
    const renderCoatings = () => {
      const order=["wood","tin","iron"], current=coatingData.current;
      const level=current ? order.indexOf(current.material)+1 : 0;
      const queued=new Set((coatingData.jobs||[]).map(j=>j.material));
      coatingState.innerHTML = `${current ? `<p>פעיל: <b>${esc(coatingData.catalog[current.material].name_he)}</b> · ${Math.round(current.hp)}/${Math.round(current.max_hp)} הגנה</p>` : '<p class="sub">עדיין אין ציפוי פעיל.</p>'}
        ${(coatingData.jobs||[]).map(j=>`<div class="build-job"><b>${esc(coatingData.catalog[j.material].name_he)}</b> - ${j.status==="building"?"בבנייה":"בתור"}<div class="worker-scene"><span>👷</span><span>🔨</span><span>👷</span></div></div>`).join("")}
        <div class="coating-grid">${order.map((m,i)=>{const x=coatingData.catalog[m],locked=i>level||queued.has(m);return `<div class="card coating-${m}"><h3>${esc(x.name_he)}</h3><p>${Math.round(x.hp)} הגנה · ${x.minutes} דקות · 🪙 ${x.price}</p><button class="btn small" data-player-coating="${m}" ${!coatingData.enabled||locked||i<level?"disabled":""}>${i<level?"הושלם":queued.has(m)?"בתור":i===level?"התחל בנייה":"נעול"}</button></div>`}).join("")}</div>`;
      coatingState.querySelectorAll("[data-player-coating]").forEach(btn=>btn.onclick=async()=>{
        const {status,data:r}=await API.post("/api/coatings/build",{material:btn.dataset.playerCoating});
        if(status===200){toast("הבנייה התחילה - הפועלים כבר עובדים");this.vCustom(view);window.refreshMe?.();} else toast(r.error_he||"הבנייה נכשלה");
      });
    };
    renderCoatings();
    const expansionState=document.getElementById("player-expansion-state");
    const expansionJobs=expansionData.jobs||[];
    expansionState.innerHTML=`<p>קוביות נוספות: <b>${expansionData.extra_cubes}</b> מתוך ${expansionData.max_extra_cubes}. כל קובייה מוסיפה ${expansionData.cube_hp} נקודות חיים ומרחיבה את שטח הפגיעה.</p>
      ${expansionJobs.map(j=>`<div class="build-job"><b>קובייה ${j.cube_number}</b> - ${j.status==="building"?"בבנייה":"בתור"}<div class="worker-scene"><span>👷</span><span>🔨</span><span>🧱</span></div></div>`).join("")}
      <button class="btn" id="build-expansion" ${!expansionData.enabled||expansionData.extra_cubes+expansionJobs.length>=expansionData.max_extra_cubes?"disabled":""}>בנה קובייה · ${expansionData.build_minutes} דקות · 🪙 ${expansionData.cube_price}</button>`;
    document.getElementById("build-expansion").onclick=async()=>{const {status,data:r}=await API.post("/api/expansions/build",{});if(status===200){toast("הקובייה בתהליך בנייה");this.vCustom(view);window.refreshMe?.();}else toast(r.error_he||"הבנייה נכשלה")};
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
    if (typeof PremiumTowerArt !== "undefined")
      PremiumTowerArt.draw(c, style.geometry, { x: tx, y: ground - ROWS * BLOCK,
        w: COLS * BLOCK, h: ROWS * BLOCK, ground }, style, t, "p1", "back");
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
    if (typeof PremiumTowerArt !== "undefined")
      PremiumTowerArt.draw(c, style.geometry, { x: tx, y: ground - ROWS * BLOCK,
        w: COLS * BLOCK, h: ROWS * BLOCK, ground }, style, t, "p1", "front");
    c.fillStyle = "rgba(148,163,184,.35)";
    c.fillRect(tx - 30, ground, COLS * BLOCK + 60, 4);
  },

  async vStore(view, seq = this._routeSeq) {
    const { status, data } = await API.get("/api/store");
    if (!this.routeCurrent(seq)) return;
    if (status !== 200) { toast("שגיאה בטעינת החנות"); return; }
    const { catalog, inventory } = data;
    this.inventory = inventory;
    const sec = { consumable: "⚔️ נשקים מיוחדים", upgrade: "🛡️ שדרוגי מגדל", skin: "🎨 מראה" };
    const groups = { consumable: [], upgrade: [], skin: [] };
    for (const [id, it] of Object.entries(catalog)) groups[it.kind].push([id, it]);
    const tierOrder = { common: 1, rare: 2, epic: 3, legendary: 4 };
    groups.skin.sort((a, b) => (tierOrder[a[1].tier] || 0) - (tierOrder[b[1].tier] || 0) || a[1].price - b[1].price);
    let html = `<h1>🛒 חנות</h1><p class="sub">יתרה: 🪙 ${data.coins} מטבעות</p>
      <div class="card store-workshop-callout"><div><b>מחפש ציפוי או קוביות למגדל?</b><span>הם נמצאים בסדנת המגדל, יחד עם הפועלים וזמני הבנייה.</span></div><a class="btn" href="#/custom">לסדנת המגדל</a></div>
      <div class="store-category-bar" role="tablist" aria-label="קטגוריות חנות">
        <button class="active" data-store-filter="consumable">⚔️ נשקים</button><button data-store-filter="upgrade">🛡️ שדרוגים</button><button data-store-filter="skin">🎨 מראות</button><button data-store-filter="all">הכל</button>
      </div>
      <div class="card store-coupon"><h2>🎟️ מימוש קופון</h2>
        <div style="display:flex;gap:8px"><input id="coupon-in" placeholder="קוד קופון">
        <button class="btn" id="coupon-btn">ממש</button></div></div>`;
    for (const kind of ["consumable", "upgrade", "skin"]) {
      html += `<section class="store-section ${kind === "consumable" ? "" : "hidden"}" data-store-section="${kind}"><h2>${sec[kind]}</h2><div class="grid cols3">`;
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
          const tierName = { common: "רגיל", rare: "נדיר", epic: "אפי", legendary: "אגדי" }[it.tier] || "רגיל";
          body = `<div class="skin-card-art"><canvas class="skin-card-preview" width="220" height="150" data-skin-preview="${id}"></canvas>${it.coming_soon && it.available === false ? '<span class="coming-ribbon">בקרוב</span>' : ''}</div>
                  <span class="shop-tier tier-${esc(it.tier || "common")}">${tierName}</span>
                  <p class="${owned ? "owned-tag" : "price"}">${owned ? (inv.equipped ? "✓ המראה הפעיל שלך" : "בבעלותך - לחץ להחיל") : "🪙 " + it.price}</p>`;
        }
        const skinBtn = kind === "skin"
          ? (inv && inv.equipped ? "✓ במשחק" : inv ? "החל מראה" : "קנה והחל")
          : "קנה";
        html += `<div class="card item${kind === "skin" && inv && inv.equipped ? " equipped" : ""}${it.available === false ? " disabled" : ""}">
          <b>${esc(Lang.pick(it))}</b><span class="sub" style="margin:0">${esc(Lang.current === "en" ? (it.desc_en || (kind === "skin" ? `Premium ${it.tier || "common"} cosmetic.` : Lang.text(it.desc_he))) : it.desc_he)}</span>
          ${body}
          <button class="btn small" data-buy="${id}" ${kind === "skin" && (inv && inv.equipped || it.available === false) ? "disabled" : ""}>${it.available === false ? "לא זמין" : skinBtn}</button>
        </div>`;
      }
      html += `</div></section>`;
    }
    view.removeAttribute("aria-busy");
    view.innerHTML = html;
    const setStoreFilter = kind => {
      view.querySelectorAll("[data-store-filter]").forEach(b => b.classList.toggle("active", b.dataset.storeFilter === kind));
      view.querySelectorAll("[data-store-section]").forEach(sec => sec.classList.toggle("hidden", kind !== "all" && sec.dataset.storeSection !== kind));
      requestAnimationFrame(() => view.querySelectorAll("canvas[data-skin-preview]").forEach(canvas => {
        if (canvas.dataset.rendered) return;
        const it=catalog[canvas.dataset.skinPreview];
        try { this.drawSkinPreview(canvas,{colors:it.colors,...(it.style||{})},0); canvas.dataset.rendered="1"; }
        catch(e){ console.error("skin preview",canvas.dataset.skinPreview,e); }
      }));
    };
    view.querySelectorAll("[data-store-filter]").forEach(b => b.onclick=()=>setStoreFilter(b.dataset.storeFilter));
    view.querySelectorAll("[data-skin-preview]").forEach(canvas => {
      const it = catalog[canvas.dataset.skinPreview];
      try { this.drawSkinPreview(canvas, { colors: it.colors, ...(it.style || {}) }, 0); canvas.dataset.rendered="1"; }
      catch (e) { console.error("skin preview", canvas.dataset.skinPreview, e); }
    });
    document.getElementById("coupon-btn").onclick = async () => {
      const code = document.getElementById("coupon-in").value.trim();
      const { status: s, data: d } = await API.post("/api/coupons/redeem", { code });
      if (s === 200) { Sfx.play("coin"); toast(`🎉 מומש: ${d.reward}`); window.refreshMe?.(); }
      else toast(d.error_he || "קופון לא תקין");
    };
    view.querySelectorAll("[data-buy]").forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.buy;
      const inv = this.inventory[id];
      const oldText=btn.textContent; btn.disabled=true; btn.textContent="...";
      if (catalog[id].kind === "skin" && inv) {
        const { status: s } = await API.post("/api/store/equip", { item_id: id });
        if (s === 200) { Sfx.play("coin"); toast("המראה הוחל - יופיע במשחק הבא"); this.vStore(view); window.refreshMe?.(); }
        else { btn.disabled=false; btn.textContent=oldText; toast("ההחלה נכשלה - נסה שוב"); }
        return;
      }
      const { status: s, data: d } = await API.post("/api/store/buy", { item_id: id });
      if (s === 200) {
        Sfx.play("coin");
        toast(catalog[id].kind === "skin" ? "נקנה והוחל! יופיע במשחק הבא" : "נקנה בהצלחה!");
        this.vStore(view); window.refreshMe?.();
      }
      else { btn.disabled=false; btn.textContent=oldText; toast(d.error_he || (s === 0 ? "בעיית חיבור - לא בוצעה רכישה" : "הקנייה נכשלה")); }
    });
  },

  // ---------------- leaderboard ----------------
  async vLeaderboard(view, seq = this._routeSeq) {
    const { status, data } = await API.get("/api/leaderboard");
    if (!this.routeCurrent(seq)) return;
    if (status !== 200) { toast("שגיאה"); return; }
    let html = `<h1>🏆 טבלת דירוג</h1><p class="sub">הטבלה מסודרת לפי נקודות דרגה. הנקודות קובעות את הדרגה ואת ההתקדמות לדרגה הבאה.</p>
      <div class="card"><table><tr><th>#</th><th>שחקן</th><th>דרגה</th><th>נקודות דרגה</th><th>נצ׳</th><th>הפ׳</th></tr>`;
    data.leaderboard.forEach((p, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || (i + 1);
      html += `<tr style="${p.id === data.me ? "outline:2px solid var(--accent)" : ""}">
        <td>${medal}</td><td>${esc(p.name)}</td><td>${esc(p.idf_rank.name_he)}</td>
        <td>${Number(p.rank_points || 0).toFixed(1)}</td><td>${p.wins}</td><td>${p.losses}</td></tr>`;
    });
    html += `</table></div>`;
    view.removeAttribute("aria-busy");
    view.innerHTML = html;
  },

  // ---------------- messages ----------------
  async vMessages(view, seq = this._routeSeq) {
    const { status, data } = await API.get("/api/messages");
    if (!this.routeCurrent(seq)) return;
    if (status !== 200) { toast("שגיאה"); return; }
    let html = `<h1>✉️ הודעות</h1>`;
    if (!data.messages.length) html += `<p class="sub">אין הודעות עדיין.</p>`;
    for (const m of data.messages) {
      html += `<div class="msg ${m.read ? "" : "unread"}">
        <b>${esc(m.title)}</b> <span class="t">${esc(m.created_at.slice(0, 16).replace("T", " "))}</span>
        <p>${esc(m.body)}</p></div>`;
    }
    view.removeAttribute("aria-busy");
    view.innerHTML = html;
    this.setUnread(0);
  },

};

App.boot();

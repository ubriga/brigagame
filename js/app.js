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
  // Last user activity (route change or tap). The version-handshake reload is
  // allowed only when the app sits idle at the lobby: a reload racing a tap
  // used to nuke the in-flight navigation and leave a several-second black
  // screen (real-device bug report: tap "צור קשר" -> black -> tiny form).
  _lastActiveAt: 0,

  routeCurrent(seq) { return seq === this._routeSeq; },

  async boot() {
    Lang.boot();
    // App-level session refresh: updates the coin/streak chips from /api/me.
    // Used to be defined only inside the game screen, so shop purchases made
    // before entering a game never refreshed the top-bar balance (bug fix).
    window.refreshMe = async () => {
      const m = await API.get("/api/me");
      if (m.status === 200) App.setMe(m.data);
    };
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
    ["pointerdown", "keydown"].forEach((ev) =>
      window.addEventListener(ev, () => { this._lastActiveAt = Date.now(); }, { passive: true, capture: true }));
    Sfx.preload();
    // Shabbat/holiday lockdown: the server is authoritative and refuses every
    // non-admin API call while active; this check only picks the first screen.
    try {
      const lockRes = await API.get("/api/lockdown");
      if (lockRes.status === 200 && lockRes.data && lockRes.data.active) {
        // Admin sessions pass the server gate: skip the lock screen so the
        // admin can manage and lift the lockdown from the panel.
        let isAdmin = false;
        if (API.token) {
          const { status, data } = await API.get("/api/me");
          isAdmin = status === 200 && !!(data && data.user && data.user.is_admin);
        }
        if (!isAdmin) {
          // His design (25.9): visitors get the normal Google login screen
          // carrying the Shabbat notice; only the admin email receives a
          // session. A denied attempt lands on the full candle lock screen.
          this._locked = true;
          if (typeof Sfx !== "undefined") Sfx.stopMusic();
          window.__BG_LOCKED__ = true; // suppress the PWA install prompt during lockdown
          // The beforeinstallprompt event can fire before this boot check
          // returns, so hide any banner that already slipped through.
          document.getElementById("install-card")?.classList.add("hidden");
          document.getElementById("install-btn")?.classList.add("hidden");
          this._lockTitle = lockRes.data.title; this._lockBody = lockRes.data.body; this._lockEnds = lockRes.data.ends_at;
          location.hash = "#/login";
          this.route();
          return;
        }
      }
    } catch (_) { /* server unreachable: normal boot shows the offline card */ }
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
        // Never reload right after a route change or a tap: the reload wipes
        // the in-flight screen behind several seconds of black, and on a slow
        // connection the user starts poking the dark page (pinch zoom) which
        // then renders the next view tiny. Wait for a genuinely idle lobby.
        const idleFor = Date.now() - (this._lastActiveAt || 0);
        if ((h === "#/lobby" || h === "#/") && idleFor > 10000) {
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

  // "איך משחקים?" (item ג): a short visual guide modal, reachable from the
  // lobby and from inside a match. Static panels, no server round trip.
  showHowTo() {
    let ov = document.getElementById("howto-ov");
    if (ov) ov.remove();
    ov = document.createElement("div");
    ov.id = "howto-ov";
    ov.innerHTML = `<div class="howto-card">
      <h2>❓ איך משחקים?</h2>
      <div class="howto-panel"><div class="howto-ico">🎯</div><div><b>מטרה:</b> להפיל את מגדל היריב לפני שהוא מפיל את שלך. כל פגיעה מפרקת עוד חלק מהמגדל.</div></div>
      <div class="howto-panel"><div class="howto-ico">👆</div><div><b>ירייה:</b> גוררים מהמגדל שלך לכיוון היריב - הגרירה קובעת זווית ועוצמה - ומשחררים. מדדי הזווית והעוצמה למטה מראים את הכיוון הנוכחי.</div></div>
      <div class="howto-panel"><div class="howto-ico">💨</div><div><b>רוח:</b> החץ ליד גלולת הרוח למעלה מזיז את הפגז במעופו. הרוח משתנה אחרי כל ירייה - בודקים לפני כל יריה.</div></div>
      <div class="howto-panel"><div class="howto-ico">⏳</div><div><b>שעון ירייה:</b> יש 10 שניות לירות ברגע שהתותח טעון. באפס - הירייה יוצאת אוטומטית בכיוון הנוכחי.</div></div>
      <div class="howto-panel"><div class="howto-ico">🛡️</div><div><b>יכולות:</b> הזזה מזיזה את המגדל צעד, מגן סופג פגיעה, מגה היא ירייה עוצמתית. תחמושת מיוחדת (כפולה, מסתובב, מרושת) נקנית בחנות במטבעות.</div></div>
      <button class="btn" id="howto-close">הבנתי, יאללה!</button>
    </div>`;
    document.body.appendChild(ov);
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    document.getElementById("howto-close").onclick = () => { Sfx.play("click"); ov.remove(); };
    Lang.apply(ov);
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
    if (close) close.onclick = () => { Consent.setPref(key, "1"); this.setMaintenance(m); };
    const chip = el.querySelector(".maintenance-chip");
    if (chip) chip.onclick = () => { localStorage.removeItem(key); this.setMaintenance(m); };
  },

  setMe(data) {
    // A successful /api/me proves a valid session; during lockdown that can
    // only be the admin, so any boot-time lock flag must clear or the route
    // guard would slam the lock screen over the lobby right after login.
    this._locked = false;
    window.__BG_LOCKED__ = false;
    this.me = data.user; this.inventory = data.inventory || {};
    this.ux = data.ux || {};
    this._guest = this.me && this.me.is_guest ? (data.guest || {}) : null;
    document.body.classList.toggle("guest-mode", !!this._guest);
    if (this._guest) this.showGuestBanner(); else this.hideGuestBanner();
    if (this.me) this.me.invite_enabled = data.invite_enabled === true;
    this.setMaintenance(data.maintenance);
    this._daily = data.daily_available; this._streak = data.streak;
    this._loginStreak = data.login_streak || null;
    const streakChip = document.getElementById("streak-chip");
    if (this._loginStreak && this._loginStreak.enabled) {
      streakChip.textContent = "🔥 " + (data.streak || 0);
      streakChip.classList.remove("hidden");
    } else streakChip.classList.add("hidden");
    if (data.login_reward) this._loginRewardData = data.login_reward;
    if (data.login_reward && !this._loginRewardShown) {
      this._loginRewardShown = true;
      // When a repair window just expired, that message comes first and the
      // day-1 reward popup is chained after its confirmation.
      if (!data.repair_expired) setTimeout(() => this.showLoginReward(data.login_reward), 400);
    }
    if (data.repair_offer && !this._repairOfferShown) {
      this._repairOfferShown = true;
      setTimeout(() => this.showRepairOffer(data.repair_offer), 400);
    }
    if (data.repair_expired && !this._repairExpiredShown) {
      this._repairExpiredShown = true;
      setTimeout(() => this.showRepairExpired(data.repair_expired, data.login_reward || null), 400);
    }
    document.getElementById("topbar").classList.remove("hidden");
    document.getElementById("seo-intro")?.classList.add("hidden");
    document.getElementById("coin-chip").textContent = "🪙 " + this.me.coins;
    document.getElementById("rank-chip").textContent = this.me.rank + " · " + this.me.rating;
    const pic = document.getElementById("user-pic");
    if (this.me.picture) { pic.src = this.me.picture; pic.classList.remove("hidden"); }
    // Permanent rule: non-admins must not see any trace that an admin area
    // exists - remove a stale panel button left by a previous admin session
    // in this tab (logout/login does not clear injected DOM).
    if (!this.me.is_admin) document.getElementById("nav-admin")?.remove();
    if (this.me.is_admin && !this._panelLoading) {
      this._panelLoading = true;
      import("./panel.js?v=9").then(m => m.install(this)).catch(() => { this._panelLoading = false; });
    }
    GameView.setInventory(this.inventory);
  },

  // Full-site Shabbat/holiday lock screen. The server enforces the lockdown
  // (every non-admin API call returns 503 lockdown); this is only the display.
  // Persistent guest warning: the account deletes itself at expires_at
  // (TTL from FIRST entry, admin-controlled). The countdown banner is the
  // visible pre-deletion warning the spec requires, with a register CTA
  // that keeps every bit of progress (server converts the same row).
  showGuestBanner() {
    this.hideGuestBanner();
    const en = Lang.current === "en";
    const bar = document.createElement("div");
    bar.id = "guest-banner";
    bar.innerHTML = `
      <span id="guest-banner-text"></span>
      <button class="btn small" id="guest-register-btn">${en ? "Sign up & keep progress" : "הירשם ושמור את ההתקדמות"}</button>`;
    document.body.appendChild(bar);
    const tick = () => {
      const el = document.getElementById("guest-banner-text");
      if (!el) { clearInterval(this._guestTimer); return; }
      const exp = Date.parse(this._guest && this._guest.expires_at || "") || (Date.now() + 24 * 3600e3);
      const left = Math.max(0, exp - Date.now());
      const h = Math.floor(left / 3600e3), m = Math.floor((left % 3600e3) / 60e3);
      el.textContent = en
        ? `🎭 Guest account - deletes itself in ${h}h ${m}m · progress is not kept`
        : `🎭 חשבון אורח - נמחק בעוד ${h} שעות ו-${m} דקות · ההתקדמות לא נשמרת`;
    };
    tick();
    this._guestTimer = setInterval(tick, 30000);
    document.getElementById("guest-register-btn").onclick = () => {
      this._guestUpgrade = true;
      location.hash = "#/login";
    };
  },

  hideGuestBanner() {
    clearInterval(this._guestTimer); this._guestTimer = null;
    document.getElementById("guest-banner")?.remove();
  },

  showLockdown(title, body, endsAt, preview = false) {
    if (typeof Sfx !== "undefined") Sfx.stopMusic();
    this._locked = !preview;
    this._lockTitle = title; this._lockBody = body; this._lockEnds = endsAt;
    this.stopPulse?.();
    // While the lock screen is up, suppress the PWA install prompt.
    if (!preview) window.__BG_LOCKED__ = true;
    document.getElementById("install-card")?.classList.add("hidden");
    document.getElementById("install-btn")?.classList.add("hidden");
    document.getElementById("topbar").classList.add("hidden");
    document.body.classList.remove("login-active");
    const t = esc(title || "שבת שלום!");
    const b = esc(body || "");
    const endLine = endsAt
      ? `<p class="sub" style="margin-top:14px;opacity:.75">חוזרים לפעילות: ${esc(new Date(endsAt).toLocaleString("he-IL", { dateStyle: "full", timeStyle: "short" }))}</p>`
      : "";
    document.getElementById("view").innerHTML = `
      <div class="lockdown-wrap">
        <div class="lockdown-candle">🕯️</div>
        <h1 class="lockdown-title">${t}</h1>
        ${b ? `<p class="lockdown-body">${b}</p>` : ""}
        ${endLine}
      </div>`;
  },

  // Phones: a stray pinch-zoom (e.g. applied on a slow black reload screen)
  // persists across hash routes and renders short views tiny and offset.
  // Momentarily clamping maximum-scale forces the visual scale back to 1;
  // the clamp is lifted right after so pinch zoom keeps working.
  resetZoom() {
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp || this._zoomResetPending) return;
    this._zoomResetPending = true;
    const base = vp.content;
    if (!/maximum-scale/.test(base)) vp.content = base + ", maximum-scale=1.0";
    setTimeout(() => { vp.content = base; this._zoomResetPending = false; }, 60);
  },

  route() {
    this._lastActiveAt = Date.now();
    if (GameView.canvas) GameView.destroy();
    const seq = ++this._routeSeq;
    const hash = location.hash || "#/lobby";
    // Admin preview of the lock screen (no activation, no login needed):
    // #/shabbat-preview?title=...&body=...
    if (hash.startsWith("#/shabbat-preview")) {
      const q = new URLSearchParams(hash.split("?")[1] || "");
      this.showLockdown(q.get("title") || "שבת שלום!", q.get("body") || "", q.get("end") || null, true);
      view.removeAttribute("aria-busy");
      return;
    }
    // While locked, every route except the login screen shows the lock screen.
    if (this._locked && !hash.startsWith("#/login")) {
      this.showLockdown(this._lockTitle, this._lockBody, this._lockEnds);
      view.removeAttribute("aria-busy");
      return;
    }
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
    // Route changes must not inherit the previous screen's scroll position:
    // on a phone, opening a short view (e.g. the contact form) from a long
    // scrolled lobby left the viewport at the bottom of the page, so the new
    // screen looked like "nothing happened".
    window.scrollTo(0, 0);
    this.resetZoom();
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
          await App.claimPendingInvite();
          location.hash = "#/lobby";
        })();
      } else location.hash = "#/login";
      return;
    }
    if (!API.token && !hash.startsWith("#/login") && !hash.startsWith("#/invite/")) { location.hash = "#/login"; return; }
    if (!hash.startsWith("#/contact")) this._lastHash = hash;
    if (hash.startsWith("#/game/")) this.vGame(view, hash.split("/")[2], seq);
    else if (hash.startsWith("#/store")) this.vStore(view, seq);
    else if (hash.startsWith("#/custom")) this.vCustom(view, seq);
    else if (hash.startsWith("#/leaderboard")) this.vLeaderboard(view, seq);
    else if (hash.startsWith("#/messages")) this.vMessages(view, seq);
    else if (hash.startsWith("#/tags")) this.vTags(view, seq);
    else if (hash.startsWith("#/contact")) this.vContact(view, seq);
    else if (hash.startsWith("#/invite/")) { this.vInvite(view, hash.split("/")[2] || ""); view.removeAttribute("aria-busy"); }
    else if (this._routeHook && this._routeHook(hash, view, seq)) { /* extension route */ }
    else if (hash.startsWith("#/login")) { this.vLogin(view); view.removeAttribute("aria-busy"); }
    else this.vLobby(view, seq);
  },

  // ---------------- login ----------------
  vLogin(view) {
    document.getElementById("seo-intro")?.classList.remove("hidden");
    document.getElementById("topbar").classList.add("hidden");
    const hashParams = new URLSearchParams((location.hash.split("?")[1] || ""));
    const incomingError = hashParams.get("auth_error") || "";
    // Non-admin whose Google sign-in was refused during lockdown: full lock screen.
    if (this._locked && hashParams.get("lockdenied")) {
      this.showLockdown(this._lockTitle, this._lockBody, this._lockEnds);
      return;
    }
    // Shabbat/holiday notice on top of the normal login screen (same texts as
    // the lock screen) while the lockdown is active.
    const lockNotice = this._locked ? `
      <div class="card" style="text-align:center;margin-bottom:14px">
        <div class="lockdown-candle">🕯️</div>
        <h1 class="lockdown-title">${esc(this._lockTitle || "שבת שלום!")}</h1>
        ${this._lockBody ? `<p class="lockdown-body">${esc(this._lockBody)}</p>` : ""}
        ${this._lockEnds ? `<p class="sub" style="margin-top:10px;opacity:.75">חוזרים לפעילות: ${esc(new Date(this._lockEnds).toLocaleString("he-IL", { dateStyle: "full", timeStyle: "short" }))}</p>` : ""}
      </div>` : "";
    const guestUpgradeNote = (this._guestUpgrade && API.token) ? `
        <div class="card" style="text-align:center;margin-bottom:12px;border:1px solid var(--accent)">
          🎭 ${Lang.current === "en"
            ? "Signing up now attaches to your guest session - all progress is kept, nothing lost."
            : "נרשמים עכשיו על סשן האורח - כל ההתקדמות נשמרת, שום דבר לא אובד."}
        </div>` : "";
    view.innerHTML = `
      <div id="login-wrap">
        <button id="login-lang" class="lang-switch" title="Language">${Lang.current === "en" ? "עברית" : "EN"}</button>
        ${lockNotice}
        ${guestUpgradeNote}
        <div class="logo">🎯</div>
        <h1>Brigagame <span style="color:var(--accent)">2.0</span></h1>
        <p class="sub">by OrelAI · משחק ארטילריה מולטיפלייר - הפל את מגדל היריב!</p>
        <p class="sub" style="font-size:13px">גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות. הרוח מזיזה את הפגז, ובכל משחק המגדלים במיקומים אחרים.</p>
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
            <div id="pwa-login-hint" class="hidden" style="background:rgba(255,200,60,.10);border:1px solid rgba(255,200,60,.4);border-radius:10px;padding:10px;margin-bottom:10px;font-size:13px;line-height:1.5;text-align:center">
              📲 באפליקציה המותקנתת, כניסה עם גוגל נפתחת בדפדפן חיצוני ולא מחברת את האפליקציה.<br><b>מומלץ: כניסה עם קוד למייל</b>, נשאר בתוך האפליקציה.
            </div>
            <div id="gsi-btn" style="display:flex;justify-content:center;margin-top:8px"></div>
            <button class="btn" id="redirect-btn" style="width:100%;margin-top:8px">🟢 כניסה עם חשבון גוגל</button>
            <button class="btn secondary hidden" id="guest-btn" style="width:100%;margin-top:8px">🎭 שחק כאורח</button>
            <p class="sub hidden" id="guest-note" style="font-size:12px;margin-top:4px">בלי הרשמה · חשבון זמני שנמחק אוטומטית</p>
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
    rememberEl.onchange = () => Consent.setPref("bg_remember", rememberEl.checked ? "1" : "0");
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
      if (data.upgraded) {
        App._guestUpgrade = false;
        toast(Lang.current === "en" ? "🎉 Progress saved - welcome!" : "🎉 ההתקדמות נשמרה! ברוך הבא", 4500);
      }
      const me = await API.get("/api/me");
      if (me.status === 200) App.setMe(me.data);
      App.startPulse();
      Sfx.ensure(); Sfx.startMusic();
      await App.claimPendingInvite();
      location.hash = "#/lobby";
    };
    const renderGsi = () => {
      if (!window.google || !google.accounts || !CONFIG.GOOGLE_CLIENT_ID) return;
      if (document.getElementById("gsi-btn").dataset.rendered) return;
      document.getElementById("gsi-btn").dataset.rendered = "1";
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          lastMethod = "redirect"; clearError(); setSpin(true);
          const { status, data } = await API.post("/api/auth/google",
            { credential: resp.credential });
          if (status === 200) finishLogin(data);
          else { setSpin(false); showError((data && data.error_he) || "ההתחברות נכשלה"); }
        },
      });
      google.accounts.id.renderButton(document.getElementById("gsi-btn"),
        { theme: "filled_black", size: "large", text: "signin_with", locale: "iw" });
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
    const isPwa = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true;
    document.getElementById("login-lang").onclick = () =>
      Lang.set(Lang.current === "en" ? "he" : "en");
    API.get("/api/auth/options").then(({ status, data }) => {
      if (status !== 200 || !data) return;
      if (data.guest_enabled) {
        document.getElementById("guest-btn").classList.remove("hidden");
        document.getElementById("guest-note").classList.remove("hidden");
      }
      if (data.email_code) document.getElementById("email-block").classList.remove("hidden");
      if (isPwa && data.pwa_email_hint !== false) {
        document.getElementById("pwa-login-hint").classList.remove("hidden");
        document.getElementById("redirect-btn").classList.add("secondary");
      }
      if (data.popup) renderGsi();
      if (data.email_code && data.email_from)
        document.getElementById("email-from-note").innerHTML =
          'הקוד יגיע מ-<b dir="ltr">' + data.email_from + '</b><br>לא מוצאים? בדקו גם בתיקיית הספאם.';
    });
    document.getElementById("guest-btn").onclick = async () => {
      lastMethod = "guest"; clearError(); setSpin(true);
      const { status, data } = await API.post("/api/guest");
      if (status === 200) {
        // Guest token lives in sessionStorage only: closing the tab ends the
        // session (the server account still self-deletes on its TTL).
        API.setToken(data.token, false);
        sessionStorage.setItem("bg_login_fails", "0");
        const me = await API.get("/api/me");
        if (me.status === 200) App.setMe(me.data);
        App.startPulse();
        Sfx.ensure(); Sfx.startMusic();
        App._guestUpgrade = false;
        location.hash = "#/lobby";
      } else showError((data && data.error_he) || "כניסת אורחים נכשלה. נסה שוב.");
    };
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
  // Claim a stored invite code right after login/registration (א1).
  async claimPendingInvite() {
    const code = sessionStorage.getItem("bg_pending_invite");
    if (!code || !API.token) return;
    sessionStorage.removeItem("bg_pending_invite");
    const { status, data } = await API.post("/api/invites/claim", { code });
    if (status === 200) toast(`🎉 הצטרפת דרך ההזמנה של ${data.inviter_name || "חבר"}!`);
    else if (data && data.error_he) toast(data.error_he, 4500);
  },

  // Create an invite link and share/copy it (lobby + game-over buttons).
  async inviteFriend() {
    if (!this.me) { location.hash = "#/login"; return; }
    const { status, data } = await API.post("/api/invites", {});
    if (status !== 200) { toast((data && data.error_he) || "יצירת ההזמנה נכשלה", 4500); return; }
    const url = location.origin + location.pathname + "#/invite/" + data.code;
    const text = (data.invite_text || "חברך {name} קורא לך לקרב ב-Brigagame 2.0! 🎯")
      .replace("{name}", data.inviter_name || "שלך");
    try {
      if (navigator.share) { await navigator.share({ title: "Brigagame 2.0", text, url }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try {
      await navigator.clipboard.writeText(text + "\n" + url);
      toast("קישור ההזמנה הועתק - שלח אותו לחבר 📨");
    } catch (e) { prompt("העתק את קישור ההזמנה:", url); }
  },

  // Public invite landing page: "חברך X קורא לך לקרב" (א1).
  async vInvite(view, code) {
    code = String(code || "").toUpperCase();
    document.getElementById("topbar").classList.add("hidden");
    const back = API.token ? "#/lobby" : "#/login";
    const fail = (msg) => {
      view.innerHTML = `<div id="login-wrap"><div class="logo">🎯</div>
        <div class="card" style="text-align:center"><h2>${esc(msg)}</h2>
        <p class="sub">קישור ההזמנה לא תקף, פג תוקפו או שכבר נוצל.</p>
        <button class="btn" onclick="location.hash='${back}'">${API.token ? "חזרה ללובי" : "לכניסה למשחק"}</button></div></div>`;
    };
    const { status, data } = await API.get("/api/invite/" + encodeURIComponent(code));
    if (status !== 200 || !data || !data.valid) return fail("ההזמנה לא נמצאה 😕");
    const name = esc(data.inviter_name || "חבר");
    view.innerHTML = `<div id="login-wrap"><div class="logo">🎯</div>
      <h1 style="font-size:26px">חברך <span style="color:var(--accent)">${name}</span> קורא לך לקרב!</h1>
      <p class="sub">Brigagame 2.0 - משחק ארטילריה מולטיפלייר. הפל את מגדל היריב!</p>
      <div class="card" style="text-align:center">
        <button class="btn" id="invite-join">${API.token ? "⚔️ נכנסים לקרב" : "🚀 הצטרפה למשחק"}</button>
      </div></div>`;
    document.getElementById("invite-join").onclick = async () => {
      Sfx.play("click");
      if (!API.token) {
        sessionStorage.setItem("bg_pending_invite", code);
        location.hash = "#/login";
        return;
      }
      const r = await API.post("/api/invites/claim", { code });
      if (r.status === 200) { toast(`🎉 הצטרפת דרך ההזמנה של ${name}!`); location.hash = "#/lobby"; }
      else if (r.data && r.data.error_he) toast(r.data.error_he, 4500);
      else location.hash = "#/lobby";
    };
  },

  // Dedicated tags page (א1): shows the user's earned tags.
  async vTags(view, seq = this._routeSeq) {
    if (!this.routeCurrent(seq)) return;
    if (!this.me) { location.hash = "#/login"; return; }
    if (this.me.is_guest) {
      view.removeAttribute("aria-busy");
      view.innerHTML = `<h1>🎖️ התגים שלי</h1>
        <div class="card" style="text-align:center;padding:32px 18px">
          <div style="font-size:42px">🔒</div>
          <p class="sub">תגים זמינים לשחקנים רשומים בלבד.</p>
        </div>`;
      return;
    }
    const { status, data } = await API.get("/api/tags");
    if (!this.routeCurrent(seq)) return;
    view.removeAttribute("aria-busy");
    const tags = (status === 200 && data && data.tags) || [];
    const when = (iso) => { try { return new Date(iso).toLocaleDateString("he-IL"); } catch (e) { return ""; } };
    view.innerHTML = `<h1>🎖️ התגים שלי</h1>
      <p class="sub">תגים מיוחדים שצברת במשחק.</p>
      <div class="card">
        ${tags.length ? tags.map(t => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;margin:8px 0">
          <span style="font-size:18px;font-weight:700">🎖️ ${esc(t.tag)}</span>
          <span class="sub" style="margin:0">${when(t.granted_at)}</span></div>`).join("")
        : `<p style="text-align:center">עדיין אין לך תגים.</p>
           <p class="sub" style="text-align:center">הזמן חבר למשחק - כשהוא נכנס דרך הקישור שלך, תזכה בתג 'מגייס'!</p>`}
        ${this.me.invite_enabled ? `<button class="btn" id="tags-invite-btn" style="margin-top:8px">📨 הזמן חבר</button>` : ""}
      </div>`;
    const btn = document.getElementById("tags-invite-btn");
    if (btn) btn.onclick = () => { Sfx.play("click"); this.inviteFriend(); };
  },


  // ---------------- contact / bug report ----------------
  vContact(view, seq) {
    if (!this.routeCurrent(seq)) return;
    const u = this.me ?? {};
    const identified = Boolean(u.id) && !u.is_guest;
    const from = (this._lastHash && !this._lastHash.startsWith("#/contact")) ? this._lastHash : "#/lobby";
    view.removeAttribute("aria-busy");
    view.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto">
      <h1>🛟 דיווח על תקלה / צור קשר</h1>
      <p class="sub">נתקלתם בתקלה, יש שאלה או רעיון לשיפור? הפנייה נשלחת ישירות למפתח במייל, ומצורפים אליה אוטומטית פרטים טכניים (גרסה, דפדפן, מסך) שעוזרים לאתר תקלות.</p>
      <label>סוג הפנייה</label>
      <select id="contact-type">
        <option value="bug">דיווח על תקלה</option>
        <option value="question">שאלה</option>
        <option value="suggestion">הצעה לשיפור</option>
      </select>
      <label>ההודעה שלך</label>
      <textarea id="contact-message" rows="6" maxlength="2000" placeholder="מה קרה, באיזה מסך, ומה ציפיתם שיקרה?"></textarea>
      ${identified ? `<p class="sub">הפנייה משויכת אוטומטית לחשבון שלך (${esc(u.name)}) והתשובה תגיע למייל של החשבון.</p>`
        : `<label>מייל לתשובה</label><input id="contact-email" type="email" maxlength="200" placeholder="you@example.com" dir="ltr" style="text-align:left">`}
      <input id="contact-website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0">
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn" id="contact-send">שליחה</button>
        <button class="btn secondary" id="contact-back">חזרה ללובי</button>
      </div></div>`;
    document.getElementById("contact-back").onclick = () => { Sfx.play("click"); location.hash = "#/lobby"; };
    const sendBtn = document.getElementById("contact-send");
    sendBtn.onclick = async () => {
      const type = document.getElementById("contact-type").value;
      const message = document.getElementById("contact-message").value;
      if (!message.trim()) { toast("כתבו כמה מילים לפני השליחה"); return; }
      const email = identified ? "" : (document.getElementById("contact-email")?.value ?? "");
      if (!identified && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast("כתובת המייל לא תקינה"); return; }
      sendBtn.disabled = true;
      Sfx.play("click");
      const result = await API.post("/api/contact", {
        type, message, email: email.trim(),
        website: document.getElementById("contact-website").value,
        context: {
          client_version: (typeof CONFIG !== "undefined" && CONFIG.CLIENT_VERSION) || "",
          screen: from, lang: Lang.current, user_agent: navigator.userAgent,
        },
      });
      if (result.status === 200 && result.data && result.data.ok) {
        view.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto;text-align:center">
          <h1>✅ הפנייה נשלחה</h1>
          <p class="sub">תודה! הדיווח הגיע אלינו ואנחנו חוזרים למייל בהקדם.</p>
          <button class="btn" id="contact-done" style="margin-top:10px">חזרה ללובי</button></div>`;
        document.getElementById("contact-done").onclick = () => { location.hash = "#/lobby"; };
      } else {
        sendBtn.disabled = false;
        toast(apiError(result, "השליחה נכשלה - נסו שוב"));
      }
    };
  },

  async vLobby(view, seq = this._routeSeq) {
    if (!this.routeCurrent(seq)) return;
    if (!this.me) { location.hash = "#/login"; return; }
    const u = this.me;
    const guest = this._guest;
    view.removeAttribute("aria-busy");
    view.innerHTML = `
      <h1>שלום, ${esc(u.name)} 👋</h1>
      <p class="sub">הפל את מגדל היריב לפני שהוא מפיל את שלך.</p>
      ${this._loginRewardData ? `<div class="card ux-welcome"><b>🔥 יום ${this._loginRewardData.streak} ברצף!</b> ${this._loginRewardData.amount > 0 ? `קיבלת היום 🪙 ${this._loginRewardData.amount} מטבעות על הרצף` : "הרצף נמשך!"}</div>` : ""}
      ${(this.ux.lobby_labels !== false && Number(u.matches_played || 0) === 0) ? `<div class="card ux-welcome"><b>🎓 משחק ראשון?</b> מומלץ להתחיל מול בוט קל - משחק תרגול בלי דירוג ובלי לחץ. אפשר גם לפתוח את "איך משחקים?" למטה.</div>` : ""}
      <div class="grid cols2">
        <div class="card">
          <h2>🎮 משחק</h2>
          <div class="grid">
            ${!guest || guest.ranked_allowed ? `<button class="btn" id="quick-btn">⚡ משחק מהיר</button>
            ${this.ux.lobby_labels !== false ? `<p class="sub ux-hint">מול שחקן אמיתי אקראי - נספר לדירוג</p>` : ""}` : `<p class="sub ux-hint">⚡ משחק מהיר מדורג זמין לשחקנים רשומים - אפשר מול בוט, או להירשם ולשמור את ההתקדמות</p>`}
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
            ${this.ux.lobby_labels !== false ? `<p class="sub ux-hint">מול המחשב - רמה קלה היא תרגול שלא נספר לדירוג</p>` : ""}
            ${!guest ? `<button class="btn secondary" id="friend-btn">🔗 משחק חברים (צור קוד)</button>
            ${this.ux.lobby_labels !== false ? `<p class="sub ux-hint">יוצר קוד לשיתוף חבר - הוא מזין אותו בשדה "קוד משחק" כאן למטה</p>` : ""}
            <div style="display:flex;gap:8px">
              <input id="join-code" placeholder="קוד משחק" maxlength="6" style="text-transform:uppercase">
              <button class="btn secondary" id="join-btn">הצטרף</button>
            </div>
            <div id="friend-code" class="hidden" style="margin-top:8px"></div>
            <button class="btn secondary" id="invite-btn" ${u.invite_enabled ? "" : 'style="display:none"'}>📨 הזמן חבר</button>` : ""}
            ${this.ux.how_to_play_button !== false ? `<button class="btn secondary" id="howto-btn">❓ איך משחקים?</button>` : ""}
            <button class="btn secondary" id="contact-btn">🛟 דיווח על תקלה / צור קשר</button>
          </div>
        </div>
        <div class="card">
          ${guest ? `<h2>🎭 משחק אורח</h2>
          <p class="sub">משחק אורח: הסטטיסטיקה לא נשמרת בין סשנים והחשבון נמחק אוטומטית. אורחים לא מופיעים בטבלת הדירוג. רוצה לשמור הכל? <b>הירשם בחינם</b> - ההתקדמות עוברת איתך.</p>
          <div class="stat-row"><span><b>${u.wins}</b>נצחונות</span><span><b>${u.losses}</b>הפסדים</span></div>
          <button class="btn" id="daily-btn" style="margin-top:14px;display:none"></button>
        </div>` : ""}
          <h2 ${guest ? 'style="display:none"' : ""}>📊 הסטטיסטיקה שלך</h2>
          <div class="rank-progress-card" ${guest ? 'style="display:none"' : ""}>
            <div class="rank-progress-head">
              <span>דרגה נוכחית: <b>${esc(u.idf_rank.name_he)} (${esc(u.idf_rank.abbr_he)})</b></span>
              <span>${u.idf_rank.next ? `הבאה: <b>${esc(u.idf_rank.next.name_he)} (${esc(u.idf_rank.next.abbr_he)})</b>` : "הגעת לדרגה הגבוהה ביותר"}</span>
            </div>
            <div class="rank-progress-track"><div style="width:${u.idf_rank.progress_pct}%"></div></div>
            <p>${u.idf_rank.next ? `נשארו <b>${u.idf_rank.next.wins_to_go}</b> XP לקידום` : "רא״ל - דרגה מרבית"}</p>
          </div>
          ${!guest ? `<div class="stat-row">
            <span><b>${u.rating}</b>דירוג (${esc(u.rank)})</span>
            <span><b>${u.wins}</b>נצחונות</span>
            <span><b>${u.losses}</b>הפסדים</span>
            <span><b>🪙 ${u.coins}</b>מטבעות</span>
          </div>
          <button class="btn" id="daily-btn" style="margin-top:14px"
            ${this._loginStreak && this._loginStreak.enabled ? "" : (this._daily ? "" : "disabled")}>${this._loginStreak && this._loginStreak.enabled ? "🔥 רצף יומי · יום " + (this._streak || 0) : "🎁 בונוס יומי" + (this._daily ? "" : " (נאסף)")}</button>` : ""}
        </div>
      </div>`;
    const go = (id) => { location.hash = "#/game/" + id; };
    const quickBtn = document.getElementById("quick-btn");
    if (quickBtn) quickBtn.onclick = async () => {
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
    const savedAiTier = localStorage.getItem("brigagame.aiTier") || sessionStorage.getItem("brigagame.aiTier");
    if (["easy", "medium", "hard", "ultra", "expert"].includes(savedAiTier)) aiTier.value = savedAiTier;
    else if (Number(this.me.matches_played || 0) < Math.trunc(Number(this.ux.newbie_easy_matches ?? 0))) aiTier.value = "easy";
    else aiTier.value = "medium";
    aiTier.onchange = () => Consent.setPref("brigagame.aiTier", aiTier.value);
    document.getElementById("ai-btn").onclick = async () => {
      Sfx.play("click");
      const difficulty = aiTier.value;
      Consent.setPref("brigagame.aiTier", difficulty);
      const result = await API.post("/api/matches/ai", { difficulty });
      const data = result.data || {};
      if (data.match_id) go(data.match_id); else toast(apiError(result, "שגיאה ביצירת משחק מול בוט"));
    };
    const howtoBtn = document.getElementById("howto-btn");
    if (howtoBtn) howtoBtn.onclick = () => { Sfx.play("click"); this.showHowTo(); };
    document.getElementById("contact-btn").onclick = () => { Sfx.play("click"); location.hash = "#/contact"; };
    const friendBtn = document.getElementById("friend-btn");
    if (friendBtn) friendBtn.onclick = async () => {
      Sfx.play("click");
      const result = await API.post("/api/matches/friend");
      const data = result.data || {};
      if (data.code) {
        const box = document.getElementById("friend-code");
        box.classList.remove("hidden");
        box.innerHTML = `<p class="sub">שתף את הקוד עם חבר:</p>
          <div class="code-box">${esc(data.code)}</div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button class="btn small secondary" id="copy-code">העתק קוד</button>
            ${this.ux.friend_share_button !== false ? `<a class="btn small secondary wa-share" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("בוא לקרב מולי ב-Brigagame 2.0! 🎯 הקוד: " + data.code + " - נכנסים ל-" + location.origin + location.pathname + " ומזינים את הקוד בשדה 'קוד משחק' בלובי")}">🟢 שתף בוואטסאפ</a>` : ""}
          </div>
          ${this.ux.friend_share_button !== false ? `<p class="sub ux-hint" style="margin-top:6px">החבר נכנס לאתר, מתחבר, ומזין את הקוד בשדה "קוד משחק" בלובי</p>` : ""}
          <p class="sub" style="margin-top:6px">ממתין שהחבר יצטרף...</p>`;
        document.getElementById("copy-code").onclick = () => {
          navigator.clipboard?.writeText(data.code); toast("הקוד הועתק");
        };
        go(data.match_id);
      } else toast(apiError(result, "שגיאה ביצירת משחק חברים"));
    };
    const inviteBtn = document.getElementById("invite-btn");
    if (inviteBtn) inviteBtn.onclick = () => { Sfx.play("click"); this.inviteFriend(); };
    const joinBtn = document.getElementById("join-btn");
    if (joinBtn) joinBtn.onclick = async () => {
      const code = document.getElementById("join-code").value.trim();
      if (!code) return;
      Sfx.play("click");
      const result = await API.post("/api/matches/join", { code });
      const data = result.data || {};
      if (data.match_id) go(data.match_id);
      else toast(apiError(result, "הקוד לא תקין"));
    };
    const dailyBtn = document.getElementById("daily-btn");
    if (dailyBtn) dailyBtn.onclick = async (e) => {
      if (this._loginStreak && this._loginStreak.enabled) { this.showStreakLadder(); return; }
      const result = await API.post("/api/daily/claim");
      const { status } = result;
      const data = result.data || {};
      if (status === 200) {
        Sfx.play("coin");
        toast(`🎁 קיבלת ${data.amount} מטבעות! רצף: ${data.streak} ימים`);
        this._daily = false;
        e.target.disabled = true; e.target.textContent = "🎁 בונוס יומי (נאסף)";
        window.refreshMe?.();
      } else toast(apiError(result, "שגיאה באיסוף הבונוס היומי"));
    };
    // Guest register prompt: after the admin-set number of games, offer once
    // per session to keep everything via a free sign-up.
    if (guest && Number(guest.games_until_register_prompt) > 0
        && Number(u.matches_played || 0) >= Number(guest.games_until_register_prompt)
        && !sessionStorage.getItem("bg_guest_prompted")) {
      sessionStorage.setItem("bg_guest_prompted", "1");
      const en = Lang.current === "en";
      const ov = document.createElement("div");
      ov.className = "guest-prompt-overlay";
      ov.innerHTML = `<div class="card guest-prompt-card">
        <h2>🎭 ${en ? "Nice streak!" : "משחק יפה!"}</h2>
        <p>${en
          ? `You already played ${u.matches_played} guest games. Sign up free and keep every bit of progress - the account stops being temporary.`
          : `כבר שיחקת ${u.matches_played} משחקים כאורח. נרשמים בחינם ושומרים את כל ההתקדמות - החשבון מפסיק להיות זמני.`}</p>
        <button class="btn" id="guest-prompt-yes">${en ? "Sign up free" : "הרשמה חינם"}</button>
        <button class="btn secondary" id="guest-prompt-no">${en ? "Maybe later" : "אולי אחר כך"}</button>
      </div>`;
      document.body.appendChild(ov);
      ov.querySelector("#guest-prompt-yes").onclick = () => {
        ov.remove(); this._guestUpgrade = true; location.hash = "#/login";
      };
      ov.querySelector("#guest-prompt-no").onclick = () => ov.remove();
    }
  },


  // Login streak: first-login-of-day reward popup ("יום X ברצף! קיבלת Y").
  showLoginReward(r) {
    if (this._lrBox) this._lrBox.remove();
    const cfg = this._loginStreak || {};
    // cfg.next comes from the /api/me snapshot; after a streak repair the
    // streak is higher than when next was computed, so drop a stale
    // milestone instead of rendering "in -1 days".
    const next = cfg.next && Number(cfg.next.day) > Number(r.streak) ? cfg.next : null;
    const box = document.createElement("div");
    box.className = "match-offer";
    box.innerHTML = `<div class="card match-offer-card">
      <div class="match-offer-icon">🔥</div>
      <h2>יום ${r.streak} ברצף!</h2>
      <p>${r.amount > 0 ? `קיבלת 🪙 ${r.amount} מטבעות` : "הרצף נמשך!"}</p>
      ${next ? `<p class="sub">בעוד ${next.day - r.streak} ימים: פרס של 🪙 ${next.amount} ביום ${next.day}</p>` : ""}
      <div class="match-offer-actions">
        <button class="btn" id="lr-ok">יאללה!</button>
      </div>
    </div>`;
    document.body.appendChild(box);
    this._lrBox = box;
    Sfx.play("coin");
    document.getElementById("lr-ok").onclick = () => { box.remove(); if (this._lrBox === box) this._lrBox = null; };
  },

  // Streak repair offer: parked on the return day, valid until IL midnight.
  showRepairOffer(o) {
    if (this._lrBox) this._lrBox.remove();
    const box = document.createElement("div");
    box.className = "match-offer";
    box.innerHTML = `<div class="card match-offer-card">
      <div class="match-offer-icon">💔</div>
      <h2>הרצף של ${Number(o.lost_streak)} ימים נשבר</h2>
      <p>שחזר ב-🪙 ${Number(o.price)} מטבעות וקבל את פרס היום לפי רצף ${Number(o.restored_streak)} - כאילו לא פספסת יום!</p>
      <p class="sub">ההצעה בתוקף עד חצות היום בלבד</p>
      <div class="match-offer-actions">
        <button class="btn" id="rp-yes">🪙 שחזר עכשיו</button>
        <button class="btn secondary" id="rp-no">מוותר על הרצף</button>
      </div>
    </div>`;
    document.body.appendChild(box);
    this._lrBox = box;
    const close = () => { box.remove(); if (this._lrBox === box) this._lrBox = null; };
    document.getElementById("rp-yes").onclick = async () => {
      const { status, data } = await API.post("/api/streak/repair", {});
      close();
      if (status === 200) {
        this._loginRewardData = { streak: data.streak, amount: data.amount };
        this.showLoginReward(this._loginRewardData);
      } else {
        toast(data.error_he || "השחזור נכשל");
      }
      window.refreshMe?.();
    };
    document.getElementById("rp-no").onclick = async () => {
      const { status, data } = await API.post("/api/streak/decline", {});
      close();
      if (status === 200) {
        toast("הרצף אופס");
        if (data.streak > 0) {
          this._loginRewardData = { streak: data.streak, amount: data.amount };
          this.showLoginReward(this._loginRewardData);
        }
      }
      window.refreshMe?.();
    };
  },

  // The repair window closed at IL midnight: the streak is gone for good.
  showRepairExpired(e, chainedReward) {
    if (this._lrBox) this._lrBox.remove();
    const box = document.createElement("div");
    box.className = "match-offer";
    box.innerHTML = `<div class="card match-offer-card">
      <div class="match-offer-icon">🕛</div>
      <h2>חלון השחזור פג</h2>
      <p>הרצף של ${Number(e.lost_streak)} ימים אבד בחצות. מתחילים רצף חדש - אתה יכול!</p>
      <div class="match-offer-actions">
        <button class="btn" id="rx-ok">הבנתי</button>
      </div>
    </div>`;
    document.body.appendChild(box);
    this._lrBox = box;
    document.getElementById("rx-ok").onclick = () => {
      box.remove(); if (this._lrBox === box) this._lrBox = null;
      if (chainedReward) this.showLoginReward(chainedReward);
    };
  },

  // Streak ladder: the daily button opens this when streak mode is on (the
  // reward itself is granted automatically at first login of the day).
  showStreakLadder() {
    if (this._lrBox) this._lrBox.remove();
    const cfg = this._loginStreak || { base_amount: 0, milestones: {} };
    const cur = this._streak || 0;
    const days = Object.keys(cfg.milestones || {}).map(Number).sort((a, b) => a - b);
    const rows = days.map(d => {
      const hit = cur >= d;
      const isNext = cfg.next && cfg.next.day === d;
      return `<p style="margin:4px 0">${hit ? "✅" : isNext ? "👉" : "▫️"} יום ${d}: 🪙 ${cfg.milestones[d]}${hit ? " - הושג!" : isNext ? " - הבא!" : ""}</p>`;
    }).join("");
    const box = document.createElement("div");
    box.className = "match-offer";
    box.innerHTML = `<div class="card match-offer-card">
      <div class="match-offer-icon">🔥</div>
      <h2>רצף יומי - יום ${cur}</h2>
      <p class="sub">התחברות יומית מעלה את הרצף ונותנת מטבעות אוטומטית. יום שמדולג מאפס את הרצף.</p>
      <p style="margin:4px 0">▫️ כל יום: 🪙 ${cfg.base_amount}</p>
      ${rows}
      <div class="match-offer-actions">
        <button class="btn" id="lr-ok">סגור</button>
      </div>
    </div>`;
    document.body.appendChild(box);
    this._lrBox = box;
    document.getElementById("lr-ok").onclick = () => { box.remove(); if (this._lrBox === box) this._lrBox = null; };
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
            <p class="sub">שתף את הקוד עם חבר</p>
            ${(App.ux || {}).friend_share_button !== false ? `<a class="btn small secondary wa-share" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("בוא לקרב מולי ב-Brigagame 2.0! 🎯 הקוד: " + GameView.snap.code + " - נכנסים ל-" + location.origin + location.pathname + " ומזינים את הקוד בשדה 'קוד משחק' בלובי")}">🟢 שתף בוואטסאפ</a>
            <p class="sub ux-hint">החבר נכנס לאתר, מתחבר, ומזין את הקוד בשדה "קוד משחק" בלובי</p>` : ""}` : "<p>משחק מהיר - מחפש יריב</p>"}
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
    if (this.me.is_guest) {
      view.removeAttribute("aria-busy");
      view.innerHTML = `<h1>🏗️ סדנת המגדל</h1>
        <div class="card" style="text-align:center;padding:32px 18px">
          <div style="font-size:42px">🔒</div>
          <p class="sub">סדנת המגדל זמינה לשחקנים רשומים בלבד. הרישום חינם, וכל ההתקדמות שצברת כאורח עוברת איתך.</p>
          <button class="primary" onclick="location.hash='#/login'">הירשם בחינם</button>
        </div>`;
      return;
    }
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
    if (this.me && this.me.is_guest) {
      view.removeAttribute("aria-busy");
      view.innerHTML = `<h1>🛒 חנות</h1>
        <div class="card" style="text-align:center;padding:32px 18px">
          <div style="font-size:42px">🔒</div>
          <p class="sub">החנות זמינה לשחקנים רשומים בלבד. הרישום חינם, וכל ההתקדמות שצברת כאורח עוברת איתך.</p>
          <button class="primary" onclick="location.hash='#/login'">הירשם בחינם</button>
        </div>`;
      return;
    }
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
    if (this.me && this.me.is_guest) {
      view.removeAttribute("aria-busy");
      view.innerHTML = `<h1>🏆 טבלת דירוג</h1>
        <div class="card" style="text-align:center;padding:32px 18px">
          <div style="font-size:42px">🔒</div>
          <h2>הירשם כדי לראות את הטבלה</h2>
          <p class="sub">טבלת הדירוג פתוחה לשחקנים רשומים בלבד. הרישום חינם, וכל ההתקדמות שצברת כאורח עוברת איתך.</p>
          <button class="primary" onclick="location.hash='#/login'">הירשם בחינם</button>
        </div>`;
      return;
    }
    const { status, data } = await API.get("/api/leaderboard");
    if (!this.routeCurrent(seq)) return;
    if (status !== 200) { toast("שגיאה"); return; }
    let html = `<h1>🏆 טבלת דירוג</h1><p class="sub">הטבלה מסודרת לפי נקודות דרגה. הנקודות קובעות את הדרגה ואת ההתקדמות לדרגה הבאה.</p>
      <div class="card"><table><tr><th>#</th><th>שחקן</th><th>דרגה</th><th>נקודות דרגה</th><th>נצ׳</th><th>הפ׳</th></tr>`;
    data.leaderboard.forEach((p, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || (i + 1);
      html += `<tr style="${p.id === data.me ? "outline:2px solid var(--accent)" : ""}">
        <td>${medal}</td><td data-i18n-skip>${esc(p.name)}</td><td>${esc(p.idf_rank.name_he)}</td>
        <td>${Number(p.rank_points || 0).toFixed(1)}</td><td>${p.wins}</td><td>${p.losses}</td></tr>`;
    });
    html += `</table></div>`;
    view.removeAttribute("aria-busy");
    view.innerHTML = html;
  },

  // ---------------- messages ----------------
  async vMessages(view, seq = this._routeSeq) {
    if (this.me && this.me.is_guest) {
      view.removeAttribute("aria-busy");
      view.innerHTML = `<h1>✉️ הודעות</h1>
        <div class="card" style="text-align:center;padding:32px 18px">
          <div style="font-size:42px">🔒</div>
          <p class="sub">הודעות זמינות לשחקנים רשומים בלבד.</p>
        </div>`;
      return;
    }
    const { status, data } = await API.get("/api/messages");
    if (!this.routeCurrent(seq)) return;
    if (status !== 200) { toast("שגיאה"); return; }
    // Read-state is tracked locally ("סמן הכל כנקרא" button); the server keeps
    // its own auto-mark for the nav badge until the mark-all endpoint ships.
    let seen = [];
    try { seen = JSON.parse(Consent.getPref("brigagame_msg_seen") || "[]"); } catch (e) {}
    const msgs = data.messages || [];
    const isNew = (m) => !seen.includes(m.id);
    const unreadCount = msgs.filter(isNew).length;
    const fmtWhen = (iso) => {
      try {
        const d = new Date(iso), now = new Date();
        const hm = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
        const day = (x) => x.toDateString();
        if (day(d) === day(now)) return `היום ${hm}`;
        const y = new Date(now); y.setDate(y.getDate() - 1);
        if (day(d) === day(y)) return `אתמול ${hm}`;
        return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" });
      } catch (e) { return ""; }
    };
    let html = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <h1 style="margin:0">✉️ הודעות</h1>
      ${msgs.length && unreadCount ? `<button class="btn small secondary" id="msg-mark-all">✓ סמן הכל כנקרא</button>` : ""}
    </div>`;
    if (!msgs.length) {
      html += `<div class="card" style="text-align:center;padding:40px 18px;margin-top:14px">
        <div style="font-size:46px">📭</div>
        <h2 style="margin:8px 0 4px">אין הודעות עדיין</h2>
        <p class="sub">כשיגיעו עדכונים, הם יופיעו כאן.</p>
      </div>`;
    } else {
      for (const m of msgs) {
        html += `<div class="card" style="display:flex;gap:12px;align-items:flex-start;margin-top:10px;padding:14px 16px">
          <div style="font-size:24px;line-height:1.2">${isNew(m) ? "✉️" : "📄"}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <b data-i18n-skip>${esc(m.title)}</b>
              ${isNew(m) ? `<span style="background:var(--accent);color:#06222e;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px">חדש</span>` : ""}
              <span class="sub" style="margin-inline-start:auto;font-size:12px">${esc(fmtWhen(m.created_at))}</span>
            </div>
            <p data-i18n-skip style="margin:6px 0 0">${esc(m.body)}</p>
          </div>
        </div>`;
      }
    }
    view.removeAttribute("aria-busy");
    view.innerHTML = html;
    const markBtn = document.getElementById("msg-mark-all");
    if (markBtn) markBtn.onclick = () => {
      try { Consent.setPref("brigagame_msg_seen", JSON.stringify(msgs.map((m) => m.id))); } catch (e) {}
      this.vMessages(view, seq);
    };
    this.setUnread(0);
  },

};

// Classic-script top-level const does not create a window property; game.js
// feature-toggle guards read window.App, so expose it explicitly.
window.App = App;

App.boot();

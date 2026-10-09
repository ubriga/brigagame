/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
// Player menu v2: bottom tab bar (play / shop / ranking / me) and a cleaner
// lobby. Admin-switched (ux_onboarding.nav2); `?nav2=1` previews it for one
// browser session. Nothing is removed: every screen and control that exists in
// the classic layout stays reachable (see the "Me" screen). Admin area untouched.
(function () {
  const A = window.App;
  if (!A) return;
  const EN = {
    "שחק": "Play", "אני": "Me", "דירוג": "Ranking", "חנות": "Shop",
    "מול בוט": "Vs bot", "חברים": "Friends", "משחק מהיר": "Quick match",
    "סדנת המגדל": "Tower workshop", "מלחמת טריטוריות": "Territory war",
    "הודעות": "Messages", "תגים": "Tags", "איך משחקים?": "How to play?",
    "דיווח על תקלה / צור קשר": "Report a problem / contact", "הגדרות": "Settings",
    "שפה": "Language", "גרפיקה חסכונית": "Low-spec graphics", "קול": "Sound",
    "התקנת המשחק": "Install the game", "מסך מלא": "Full screen", "ניהול": "Admin",
    "התנתקות": "Sign out", "הזמן חבר": "Invite a friend", "הגדרות עוגיות": "Cookie settings",
    "מדיניות פרטיות": "Privacy policy", "תנאי שימוש והבהרה": "Terms and disclaimer",
    "משחק": "Play", "הפרופיל שלי": "My profile", "החשבון": "Account", "מידע": "Info",
    "הירשם בחינם": "Sign up free", "חשבון אורח": "Guest account", "עוד": "More",
    "תפריט ראשי": "Main menu", "כינוי": "Nickname", "שינוי כינוי": "Change nickname",
  };
  if (typeof Lang !== "undefined" && Lang.exact) for (const [h, e] of Object.entries(EN)) if (!Lang.exact.has(h)) Lang.exact.set(h, e);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const IC = {
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    shop: '<path d="M4 8h16l-1.5 11h-13z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8a4 4 0 018 0" fill="none" stroke="currentColor" stroke-width="2"/>',
    rank: '<path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2"/>',
    me: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  const svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${p}</svg>`;

  // ---------------- state ----------------
  try {
    const q = new URLSearchParams(location.search).get("nav2");
    // localStorage so the preview survives login, reloads and new tabs on this
    // origin; ?nav2=0 clears it. (An old sessionStorage value is still honored.)
    if (q === "1") localStorage.setItem("bg_nav2", "1");
    else if (q === "0") { localStorage.removeItem("bg_nav2"); sessionStorage.removeItem("bg_nav2"); }
  } catch (e) { /* storage blocked: preview unavailable, flag still works */ }
  A.navV2 = function () {
    let pre = false;
    try { pre = localStorage.getItem("bg_nav2") === "1" || sessionStorage.getItem("bg_nav2") === "1"; } catch (e) { /* ignore */ }
    return !!(this.me && (this.ux && this.ux.nav2 === true || pre));
  };

  // ---------------- tab bar + header link ----------------
  const tabs = [
    { key: "play", href: "#/lobby", label: "שחק", icon: IC.play },
    { key: "store", href: "#/store", label: "חנות", icon: IC.shop },
    { key: "rank", href: "#/leaderboard", label: "דירוג", icon: IC.rank },
    { key: "me", href: "#/me", label: "אני", icon: IC.me },
  ];
  const bar = document.createElement("nav");
  bar.id = "tabbar"; bar.className = "hidden"; bar.setAttribute("aria-label", "תפריט ראשי");
  bar.innerHTML = tabs.map((t) => `<a href="${t.href}" data-tab="${t.key}"><span class="ti">${svg(t.icon)}</span><span class="tl">${t.label}</span>${t.key === "me" ? '<span class="badge hidden" id="tab-msg-badge"></span>' : ""}</a>`).join("");
  document.body.appendChild(bar);
  const meLink = document.createElement("a");
  meLink.href = "#/me"; meLink.dataset.nav = "me"; meLink.id = "nav-me"; meLink.className = "n2-only";
  meLink.innerHTML = 'אני <span id="nav-me-badge" class="badge hidden"></span>';
  document.querySelector("#topbar nav")?.appendChild(meLink);

  function activeTab(hash) {
    if (hash.startsWith("#/store") || hash.startsWith("#/custom")) return "store";
    if (hash.startsWith("#/leaderboard")) return "rank";
    if (hash.startsWith("#/me") || hash.startsWith("#/messages") || hash.startsWith("#/tags") || hash.startsWith("#/contact") || hash.startsWith("#/admin")) return "me";
    return "play"; // lobby, war map, matches
  }
  A.nav2Sync = function () {
    const on = this.navV2();
    document.body.classList.toggle("nav2", on);
    const topHidden = $("topbar")?.classList.contains("hidden");
    bar.classList.toggle("hidden", !on || topHidden);
    const hash = location.hash || "#/lobby";
    const cur = activeTab(hash);
    bar.querySelectorAll("a").forEach((a) => {
      const is = a.dataset.tab === cur;
      a.classList.toggle("on", is);
      if (is) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.querySelectorAll("#topbar nav a").forEach((a) => {
      if (!on) return;
      const nav = a.dataset.nav;
      if (nav === "lobby") a.classList.toggle("active", cur === "play" && hash.startsWith("#/lobby"));
    });
    try { if (typeof Lang !== "undefined" && Lang.current === "en") Lang.apply(bar); } catch (e) { /* ignore */ }
    const n = Number(this._unread || 0);
    for (const id of ["tab-msg-badge", "nav-me-badge"]) {
      const b = $(id); if (!b) continue;
      b.textContent = n > 99 ? "99+" : String(n);
      b.classList.toggle("hidden", n <= 0);
    }
    // Desktop top nav: relabel "Lobby" to "Play" while v2 is on.
    const lobbyLink = document.querySelector('#topbar nav a[data-nav="lobby"]');
    if (lobbyLink) {
      if (on && !lobbyLink.dataset.n2orig) { lobbyLink.dataset.n2orig = lobbyLink.textContent; lobbyLink.textContent = (typeof Lang !== "undefined" && Lang.current === "en") ? "Play" : "שחק"; }
      else if (!on && lobbyLink.dataset.n2orig) { lobbyLink.textContent = lobbyLink.dataset.n2orig; delete lobbyLink.dataset.n2orig; }
    }
  };
  new MutationObserver(() => A.nav2Sync()).observe($("topbar"), { attributes: true, attributeFilter: ["class"] });

  const origRoute = A.route;
  A.route = function () { const r = origRoute.apply(this, arguments); this.nav2Sync(); return r; };
  const origSetMe = A.setMe;
  A.setMe = function () { const r = origSetMe.apply(this, arguments); this.nav2Sync(); return r; };
  const origUnread = A.setUnread;
  A.setUnread = function () { const r = origUnread.apply(this, arguments); this.nav2Sync(); return r; };
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#tabbar a")) { try { Sfx.play("click"); } catch (x) { /* ignore */ } } });

  // ---------------- lobby ----------------
  const origLobby = A.vLobby;
  A.vLobby = async function (view, seq) {
    const hash = location.hash || "";
    if (/^#\/me(\?|$)/.test(hash)) { this.nav2Sync(); return this.navV2() ? this.vMe(view, seq) : (location.hash = "#/lobby"); }
    const r = await origLobby.call(this, view, seq);
    if (this.navV2() && this.routeCurrent(seq) && view.querySelector("#quick-btn, #ai-btn")) { try { this.nav2Lobby(view); } catch (e) { console.warn("nav2 lobby", e); } }
    this.nav2Sync();
    return r;
  };

  A.nav2Lobby = function (view) {
    const u = this.me, guest = this._guest;
    view.classList.add("n2-lobby");
    view.querySelector("#home-hero")?.remove();
    view.querySelectorAll(":scope > h1 + p.sub").forEach((p) => p.classList.add("n2-hide"));
    const grid = view.querySelector(".grid.cols2");
    if (!grid || grid.dataset.n2) return;
    grid.dataset.n2 = "1";
    const playCard = grid.children[0], sideCard = grid.children[1];
    const g = playCard.querySelector(".grid");
    const q = $("quick-btn"), ai = g.querySelector(".ai-start"), fb = $("friend-btn");
    const join = $("join-code")?.parentElement, fc = $("friend-code"), inv = $("invite-btn");
    const how = $("howto-btn"), contact = $("contact-btn");
    const hints = [...g.querySelectorAll(":scope > p.ux-hint")];
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const botHints = hints.filter((h) => ai && after(ai, h) && (!fb || after(h, fb)));
    const frHints = hints.filter((h) => fb && after(fb, h));
    const topHints = hints.filter((h) => !botHints.includes(h) && !frHints.includes(h));
    playCard.querySelector("h2")?.classList.add("n2-hide");

    const wrap = document.createElement("div");
    wrap.className = "n2-play";
    if (q) { q.classList.add("n2-primary"); wrap.append(q); }
    topHints.forEach((h) => wrap.append(h));
    const modes = document.createElement("div");
    modes.className = "n2-modes";
    const mk = (id, label, panel) => { const b = document.createElement("button"); b.type = "button"; b.id = id; b.className = "btn secondary n2-mode"; b.setAttribute("aria-expanded", "false"); b.textContent = label; b.dataset.panel = panel.id; return b; };
    const panels = [];
    if (ai) {
      const p = document.createElement("div"); p.id = "n2-bot-panel"; p.className = "n2-panel hidden";
      p.append(ai); botHints.forEach((h) => p.append(h)); panels.push(p);
      modes.append(mk("n2-bot-toggle", "מול בוט", p));
    }
    if (fb) {
      const p = document.createElement("div"); p.id = "n2-fr-panel"; p.className = "n2-panel hidden";
      [fb, ...frHints, join, fc, inv].filter(Boolean).forEach((n) => p.append(n)); panels.push(p);
      modes.append(mk("n2-fr-toggle", "חברים", p));
    }
    wrap.append(modes); panels.forEach((p) => wrap.append(p));
    modes.addEventListener("click", (e) => {
      const b = e.target.closest(".n2-mode"); if (!b) return;
      try { Sfx.play("click"); } catch (x) { /* ignore */ }
      const target = $(b.dataset.panel), open = target.classList.contains("hidden");
      panels.forEach((p) => p.classList.add("hidden"));
      modes.querySelectorAll(".n2-mode").forEach((m) => { m.setAttribute("aria-expanded", "false"); m.classList.remove("on"); });
      if (open) { target.classList.remove("hidden"); b.setAttribute("aria-expanded", "true"); b.classList.add("on"); }
    });
    // Guests: the quick-match explanation paragraph stays; leave the rest untouched.
    contact?.classList.add("n2-hide"); // lives on the "Me" screen
    how?.classList.add("n2-link");
    const links = document.createElement("div");
    links.className = "n2-links";
    if (how) links.append(how);

    const daily = $("daily-btn");
    const top = document.createElement("div");
    top.className = "n2-daily";
    if (daily && !guest) { top.append(daily); daily.classList.add("n2-daily-btn"); }

    const tiles = document.createElement("div");
    tiles.className = "n2-tiles";
    const tile = (id, label, sub, go) => { const b = document.createElement("button"); b.type = "button"; b.id = id; b.className = "btn secondary n2-tile"; b.innerHTML = `<b>${label}</b><small>${sub}</small>`; b.onclick = () => { try { Sfx.play("click"); } catch (x) { /* ignore */ } location.hash = go; }; return b; };
    if (!u.is_guest) {
      tiles.append(tile("n2-war", "מלחמת טריטוריות", "כבוש אזורים", "#/war"));
      tiles.append(tile("n2-custom", "סדנת המגדל", "שדרג ועצב", "#/custom"));
    }
    playCard.replaceChildren(wrap, links);
    playCard.classList.add("n2-card");
    const ins = [];
    if (top.children.length) ins.push(top);
    ins.push(playCard);
    if (tiles.children.length) ins.push(tiles);
    if (!guest) { sideCard.remove(); } else { ins.push(sideCard); }
    grid.replaceChildren(...ins);
    grid.classList.remove("cols2"); grid.classList.add("n2-grid");
    Lang.apply?.(view);
  };

  // ---------------- "Me" screen ----------------
  A.vMe = function (view, seq) {
    if (!this.routeCurrent(seq)) return;
    const u = this.me, guest = this._guest;
    view.removeAttribute("aria-busy");
    view.classList.remove("n2-lobby");
    const en = Lang.current === "en";
    const items = [];
    const item = (id, label, opt = {}) => items.push(`<button type="button" class="n2-item${opt.danger ? " danger" : ""}" id="${id}"><span class="il">${label}</span>${opt.val ? `<span class="iv" id="${id}-v">${opt.val}</span>` : ""}${opt.badge ? `<span class="badge" id="${id}-b">${opt.badge}</span>` : ""}<span class="ia" aria-hidden="true">‹</span></button>`);
    const section = (title, list) => list.length ? `<h2 class="n2-sec">${title}</h2><div class="n2-list">${list.join("")}</div>` : "";
    const take = () => items.splice(0, items.length);
    const acts = {};
    const go = (id, label, hash, opt) => { item(id, label, opt); acts[id] = () => { location.hash = hash; }; };
    const fn = (id, label, f, opt) => { item(id, label, opt); acts[id] = f; };

    if (!u.is_guest) {
      go("me-custom", "סדנת המגדל", "#/custom");
      go("me-war", "מלחמת טריטוריות", "#/war");
      go("me-messages", "הודעות", "#/messages", { badge: Number(this._unread || 0) > 0 ? String(this._unread) : "" });
      go("me-tags", "תגים", "#/tags");
    }
    if (!u.is_guest && u.invite_enabled) fn("me-invite", "הזמן חבר", () => this.inviteFriend());
    if (this.ux.how_to_play_button !== false) fn("me-howto", "איך משחקים?", () => this.showHowTo());
    fn("me-contact", "דיווח על תקלה / צור קשר", () => this.showContactOverlay());
    const secPlay = section("משחק", take());

    const click = (id) => () => $(id)?.click();
    const val = (id) => esc(($(id)?.textContent || "").trim());
    fn("me-lang", "שפה", click("lang-btn"), { val: val("lang-btn") });
    fn("me-gfx", "גרפיקה חסכונית", click("gfx-btn"), { val: val("gfx-btn") });
    fn("me-mute", "קול", click("mute-btn"), { val: val("mute-btn") });
    if (typeof ScreenMode !== "undefined" && ScreenMode.toggle) fn("me-fs", "מסך מלא", () => ScreenMode.toggle());
    const inst = $("install-btn");
    if (inst && !inst.classList.contains("hidden")) fn("me-install", "התקנת המשחק", click("install-btn"));
    const secSet = section("הגדרות", take());

    if ($("nav-admin")) go("me-admin", "ניהול", "#/admin");
    go("me-privacy", "מדיניות פרטיות", "privacy.html");
    go("me-terms", "תנאי שימוש והבהרה", "terms.html");
    fn("me-cookies", "הגדרות עוגיות", click("cookie-settings"));
    fn("me-logout", "התנתקות", click("logout-btn"), { danger: true });
    const secInfo = section("מידע", take());

    let head;
    if (guest) {
      head = `<div class="card"><h2>חשבון אורח</h2><p class="sub">משחק אורח: הסטטיסטיקה לא נשמרת והחשבון נמחק אוטומטית. הירשם בחינם כדי לשמור את הכל.</p><div class="stat-row"><span><b>${u.wins}</b>נצחונות</span><span><b>${u.losses}</b>הפסדים</span></div><button class="btn" id="me-signup" style="margin-top:12px">הירשם בחינם</button></div>`;
    } else {
      const r = u.idf_rank || {};
      head = `<div class="card n2-profile"><div class="n2-who"><h2>${esc(u.name)}</h2><button class="btn ghost" id="me-nick" aria-label="שינוי כינוי">✎</button></div>
        <div class="rank-progress-card"><div class="rank-progress-head"><span>דרגה נוכחית: <b>${esc(r.name_he)} (${esc(r.abbr_he)})</b></span><span>${r.next ? `הבאה: <b>${esc(r.next.name_he)} (${esc(r.next.abbr_he)})</b>` : "הגעת לדרגה הגבוהה ביותר"}</span></div>
        <div class="rank-progress-track"><div style="width:${Number(r.progress_pct) || 0}%"></div></div><p>${r.next ? `נשארו <b>${r.next.wins_to_go}</b> XP לקידום` : "רא״ל - דרגה מרבית"}</p></div>
        <div class="stat-row"><span><b>${u.rating}</b>דירוג (${esc(u.rank)})</span><span><b>${u.wins}</b>נצחונות</span><span><b>${u.losses}</b>הפסדים</span><span><b>🪙 ${u.coins}</b>מטבעות</span></div></div>`;
    }
    view.innerHTML = `<h1>${en ? "Me" : "אני"}</h1><div class="n2-me">${head}${secPlay}${secSet}${secInfo}</div>`;
    view.querySelectorAll(".n2-item").forEach((b) => { b.onclick = () => { try { Sfx.play("click"); } catch (x) { /* ignore */ } acts[b.id]?.(); }; });
    $("me-nick")?.addEventListener("click", () => this.showNickname(false));
    $("me-signup")?.addEventListener("click", () => { this._guestUpgrade = true; location.hash = "#/login"; });
    // Plain-link items for static pages.
    for (const [id, href] of [["me-privacy", "privacy.html"], ["me-terms", "terms.html"]]) {
      const b = $(id); if (b) b.onclick = () => { window.location.href = href; };
    }
    Lang.apply?.(view);
  };

  // First paint when the flag is already known (boot after setMe ran earlier).
  A.nav2Sync();
})();

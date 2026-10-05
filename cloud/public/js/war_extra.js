/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
// Territory war extras: notifications, live battles + spectator bets, battle viewer/replay, alliance, public profile.
(function () {
  const EN = (typeof Lang !== "undefined" && Lang.current === "en");
  const X = {"🔔 עדכונים":"🔔 Updates","אין עדכונים חדשים.":"No new updates.","שחזור":"Replay","👁️ קרבות חיים":"👁️ Live battles","אין קרבות פעילים כרגע.":"No active battles right now.","צפייה":"Watch","הימור":"Bet","תוקף":"Attacker","מגן":"Defender","מהמר":"Bet","סכום":"Amount","הימרת":"You bet","🤝 ברית":"🤝 Alliance","הקמת ברית":"Create alliance","שם הברית":"Alliance name","הזמנה":"Invite","כינוי השחקן":"Player nickname","עזיבה":"Leave","קבלה":"Accept","דחייה":"Decline","סגירה":"Close","פרופיל":"Profile","אריחים":"Tiles","כיבושים":"Conquests","הגנות מוצלחות":"Successful defenses","נזק":"Damage","שחזור קרב":"Battle replay","הקרב נגמר":"Battle over","הגנה אוטומטית: הבוט מגן במקומי כשאני מחובר":"Auto-defense: my bot defends for me even when I am online","כבשת את האריח":"You conquered the tile","התקפה נכשלה":"Attack failed","הגנת בהצלחה":"You defended","איבדת אריח":"You lost a tile","מרד: אריח חזר להיות פנוי":"Rebellion: a tile went free","אריח":"Tile"};
  const T = (he) => (EN && X[he]) || he;
  const KINDTXT = { conquered: "🏴 כבשת את האריח", attack_failed: "⚔️ התקפה נכשלה", defended: "🛡️ הגנת בהצלחה", tile_lost: "💥 איבדת אריח", rebellion: "🔥 מרד: אריח חזר להיות פנוי" };
  const css = `.wx{margin-top:10px}.wx h3{margin:0 0 6px}.wx ul{list-style:none;margin:0;padding:0}.wx li{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}
  .wx .new{color:#ffd35c;font-weight:700}.wx input{width:100%;margin:4px 0}.wx .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .wv-ov{position:fixed;inset:0;background:rgba(10,5,2,.88);z-index:9000;display:flex;align-items:center;justify-content:center;padding:10px}
  .wv-box{background:#2a1608;border-radius:14px;padding:12px;max-width:860px;width:100%}
  .wv-box canvas{width:100%;background:linear-gradient(#5a3a1c,#2a1608);border-radius:10px;display:block}`;
  const esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- battle viewer (replay of a finished battle, or live viewing of a running one) ----
  function viewer(battleId, title) {
    const ov = document.createElement("div"); ov.className = "wv-ov";
    ov.innerHTML = `<div class="wv-box"><div class="row" style="justify-content:space-between"><b>${esc2(title || T("שחזור קרב"))}</b><button class="btn small secondary" id="wv-close">${T("סגירה")}</button></div>
      <canvas id="wv-c" width="880" height="560" aria-label="battle"></canvas><p class="sub" id="wv-st" aria-live="polite"></p></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector("#wv-c"), ctx = cv.getContext("2d"), st = ov.querySelector("#wv-st");
    let since = 0, queue = [], live = true, dead = false, busy = false, dmg = { p1: 0, p2: 0 }, hist = [], over = false;
    const base = () => {
      ctx.clearRect(0, 0, 880, 560);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(0, 520, 880, 40);
      ctx.fillStyle = "#ffd35c"; ctx.fillRect(170, 300, 40, 220); ctx.fillStyle = "#e0556b"; ctx.fillRect(780, 300, 40, 220);
      for (const h of hist) { ctx.fillStyle = h.c; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, 7); ctx.fill(); }
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const play = async () => {
      if (busy) return; busy = true;
      while (queue.length && !dead) {
        const ev = queue.shift();
        if (ev.type === "shot" && ev.points) {
          const col = ev.side === "p1" ? "#ffd35c" : "#e0556b";
          for (let i = 0; i < ev.points.length && !dead; i++) {
            base(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
            ev.points.slice(0, i + 1).forEach((p, j) => j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
            ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ev.points[i][0], ev.points[i][1], 4, 0, 7); ctx.fill();
            await sleep(60);
          }
        } else if (ev.type === "explosion") {
          if (!ev.cosmetic && ev.damage) dmg[ev.attacker] = (dmg[ev.attacker] || 0) + Number(ev.damage);
          hist.push({ x: ev.x, y: ev.y, r: Math.min(30, (ev.radius || 40) / 2), c: "rgba(255,120,40,.55)" }); if (hist.length > 40) hist.shift();
          base(); await sleep(250);
        } else if (ev.type === "match_end") { over = true; }
        st.textContent = `${T("נזק")}: ${T("תוקף")} ${Math.round(dmg.p1)} · ${T("מגן")} ${Math.round(dmg.p2)}` + (over ? " · " + T("הקרב נגמר") : "");
      }
      busy = false;
    };
    const poll = async () => {
      if (dead) return;
      const r = await API.get(`/api/territory/replay/${battleId}?since=${since}`);
      if (r.status === 200 && r.data) {
        for (const e of r.data.events) { since = Math.max(since, e.id); queue.push(e); }
        live = !!r.data.live; play();
      }
      if (!dead && (live || queue.length || busy)) setTimeout(poll, live ? 2500 : 1000);
    };
    base(); poll();
    ov.querySelector("#wv-close").onclick = () => { dead = true; ov.remove(); };
  }

  async function profile(nick) {
    const r = await API.get("/api/territory/profile?nick=" + encodeURIComponent(nick));
    if (r.status !== 200) { toast(apiError(r, "שגיאה")); return; }
    const d = r.data, ov = document.createElement("div"); ov.className = "wv-ov";
    ov.innerHTML = `<div class="wv-box" style="max-width:340px;text-align:center"><div style="font-size:44px;filter:hue-rotate(${d.flag_hue}deg)">🚩</div><h2>${esc2(d.nickname)}</h2>
      ${d.alliance ? `<p class="sub">🤝 ${esc2(d.alliance)}</p>` : ""}
      <p>${T("אריחים")}: <b>${d.tiles}</b> · ${T("כיבושים")}: <b>${d.conquests}</b> · ${T("הגנות מוצלחות")}: <b>${d.defenses}</b></p><button class="btn small" id="pf-x">${T("סגירה")}</button></div>`;
    document.body.appendChild(ov); ov.querySelector("#pf-x").onclick = () => ov.remove(); ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  }

  const App2 = App;
  App2.warExtras = async function (view, ctx) {
    if (!document.getElementById("wx-css")) { const s = document.createElement("style"); s.id = "wx-css"; s.textContent = css; document.head.appendChild(s); }
    const host = view.querySelector("#war-extra"); if (!host) return;
    const st = ctx.ex || (ctx.ex = { live: null, alliance: null, loaded: false });
    const render = () => {
      const h = view.querySelector("#war-extra"); if (!h) return;
      const ev = (ctx.me.events || []);
      let html = `<div class="card wx"><h3>${T("🔔 עדכונים")}</h3>${ev.length ? "<ul>" + ev.slice(0, 8).map(e => `<li><span class="${e.seen ? "" : "new"}">${T(KINDTXT[e.kind] || "אריח")}${e.other ? " · " + esc2(e.other) : ""}</span>${e.battle_id ? `<button class="btn small secondary" data-rep="${e.battle_id}">${T("שחזור")}</button>` : ""}</li>`).join("") + "</ul>" : `<p class="sub">${T("אין עדכונים חדשים.")}</p>`}</div>`;
      const L = st.live;
      html += `<div class="card wx"><h3>${T("👁️ קרבות חיים")}</h3>${L && L.battles.length ? "<ul>" + L.battles.map(b => `<li><span>${esc2(b.attacker || "שחקן")} ⚔️ ${esc2(b.defender || "שחקן")}${b.pool_a || b.pool_d ? ` · 🪙 ${b.pool_a}/${b.pool_d}` : ""}</span><span><button class="btn small secondary" data-live="${b.id}">${T("צפייה")}</button>${b.can_bet ? ` <button class="btn small" data-bet="${b.id}">${T("הימור")}</button>` : (b.my_side ? ` <small>${T("הימרת")}</small>` : "")}</span></li>`).join("") + "</ul>" : `<p class="sub">${T("אין קרבות פעילים כרגע.")}</p>`}</div>`;
      const A = st.alliance;
      if (A && A.enabled) {
        html += `<div class="card wx"><h3>${T("🤝 ברית")}</h3>`;
        if (A.alliance) {
          html += `<p><b>${esc2(A.alliance.name)}</b> (${A.alliance.members.length}/${A.max_members})</p><ul>${A.alliance.members.map(m => `<li><span>${esc2(m.nick)}${m.leader ? " 👑" : ""}</span></li>`).join("")}</ul>`;
          if (A.alliance.leader && A.alliance.members.length < A.max_members) html += `<div class="row"><input id="al-inv" placeholder="${T("כינוי השחקן")}" maxlength="16"><button class="btn small" id="al-invite">${T("הזמנה")}</button></div>`;
          html += `<button class="btn small secondary" id="al-leave">${T("עזיבה")}</button>`;
        } else {
          for (const i of A.invites || []) html += `<div class="row"><span>${esc2(i.name)}</span><button class="btn small" data-ai="${i.id}" data-acc="1">${T("קבלה")}</button><button class="btn small secondary" data-ai="${i.id}">${T("דחייה")}</button></div>`;
          html += A.has_nick ? `<div class="row"><input id="al-name" placeholder="${T("שם הברית")}" maxlength="16"><button class="btn small" id="al-create">${T("הקמת ברית")}</button></div>` : `<p class="sub">צריך כינוי כדי להקים ברית.</p>`;
        }
        html += `</div>`;
      }
      h.innerHTML = html;
      h.querySelectorAll("[data-rep]").forEach(b => b.onclick = () => viewer(b.dataset.rep, T("שחזור קרב")));
      h.querySelectorAll("[data-live]").forEach(b => b.onclick = () => viewer(b.dataset.live, T("👁️ קרבות חיים")));
      h.querySelectorAll("[data-bet]").forEach(b => b.onclick = async () => {
        const bt = st.live.bets || { min: 5, max: 100 };
        const side = prompt("1 = " + T("תוקף") + ", 2 = " + T("מגן"), "1"); if (side !== "1" && side !== "2") return;
        const amount = Number(prompt(T("סכום") + ` (${bt.min}-${bt.max})`, String(bt.min))); if (!amount) return;
        const r = await API.post("/api/territory/bet", { battle_id: Number(b.dataset.bet), side: side === "1" ? "attacker" : "defender", amount });
        toast(r.status === 200 ? T("הימרת") : apiError(r, "שגיאה")); refresh();
      });
      const post = async (p, body) => { const r = await API.post(p, body); if (r.status !== 200) toast(apiError(r, "שגיאה")); await refresh(); };
      const q = (id) => h.querySelector(id);
      if (q("#al-create")) q("#al-create").onclick = () => post("/api/territory/alliance/create", { name: q("#al-name").value });
      if (q("#al-invite")) q("#al-invite").onclick = () => post("/api/territory/alliance/invite", { nickname: q("#al-inv").value });
      if (q("#al-leave")) q("#al-leave").onclick = () => { if (confirm("?")) post("/api/territory/alliance/leave", {}); };
      h.querySelectorAll("[data-ai]").forEach(b => b.onclick = () => post("/api/territory/alliance/respond", { invite_id: Number(b.dataset.ai), accept: b.dataset.acc === "1" }));
    };
    const refresh = async () => {
      const [l, a] = await Promise.all([API.get("/api/territory/live"), API.get("/api/territory/alliance")]);
      if (l.status === 200) st.live = l.data; if (a.status === 200 || (a.data && a.data.enabled === false)) st.alliance = a.data;
      render();
    };
    render();
    if (!st.loaded) {
      st.loaded = true; await refresh();
      if ((ctx.me.events || []).some(e => !e.seen)) API.post("/api/territory/events/seen");
      st.timer = setInterval(() => { if (!document.getElementById("war-extra")) { clearInterval(st.timer); return; } refresh(); }, 12000);
    }
  };
  App2.showProfile = profile;
})();

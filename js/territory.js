/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
// Territory war screen: map, materials, attack, and the courtyard defender persona.
(function () {
  const EN = (typeof Lang !== "undefined" && Lang.current === "en");
  const T = (he) => (EN && EN_MAP[he]) || he;
  const EN_MAP = {"הגנה אוטומטית: הבוט מגן במקומי כשאני מחובר":"Auto-defense: the bot defends for me even when I am online","🤝 בעל ברית.":"🤝 Ally.","פרופיל":"Profile","מלחמת טריטוריות":"Territory War","המפה זמינה לשחקנים רשומים בלבד.":"The map is for registered players only.","המפה אינה זמינה כרגע.":"The map is unavailable right now.","התקפות היום":"Attacks today","אריחים:":"Tiles:","בחר אריח במפה. אפשר לתקוף אריח שצמוד לטריטוריה שלך (מסומנת בצהוב).":"Pick a tile. You can attack a tile next to your territory (marked yellow).","האריח שלך":"Your tile","(הבית)":"(home)","מוגן בתקופת חסד.":"Protected (grace period).","לא צמוד לטריטוריה שלך.":"Not next to your territory.","עלות תקיפה:":"Attack cost:","מכל חומר.":"of each material.","⚔️ תקוף":"⚔️ Attack","בעלים:":"Owner:","פנוי (הגנת בוט)":"Free (bot defense)","אישיות המגן שלי":"My defender persona","כשתוקפים אותך, מגן החצר שלך נלחם לפי ההגדרות. תקציב":"When you are attacked, your courtyard defender fights by these settings. Budget","נקודות.":"points.","תוקפנות":"Aggression","דיוק":"Accuracy","אומץ":"Boldness","שמירה":"Save","תרגול מול החצר שלי":"Practice vs my courtyard","סה\"כ":"Total"," - חריגה מהתקציב":" - over budget","האישיות נשמרה":"Persona saved","השמירה נכשלה":"Save failed","לא ניתן לתקוף":"Cannot attack","שגיאה":"Error","יער":"Forest","מכרה":"Mine","מחצבה":"Quarry","מישור":"Plains","מצודה":"Fortress","רגיל":"Common","נדיר":"Rare","אפי":"Epic","אגדי":"Legendary","🪵 עץ":"🪵 Wood","⚙️ ברזל":"⚙️ Iron","🧱 אבן":"🧱 Stone","מקרא והסבר":"Legend and help","סוגי אריחים:":"Tile types:","יער - מייצר עץ":"Forest - produces wood","מכרה - מייצר ברזל":"Mine - produces iron","מחצבה - מייצר אבן":"Quarry - produces stone","מישור - מייצר מעט מכל שלושת החומרים":"Plains - a little of all three materials","מצודה - מייצרת מכל החומרים, תמיד אפית או אגדית":"Fortress - produces all materials, always epic or legendary","דרגת נדירות: ★ נדיר, ★★ אפי, ★★★ אגדי. ככל שהדרגה גבוהה יותר התפוקה גדולה יותר, אבל גם עלות התקיפה גבוהה יותר (":"Rarity: ★ rare, ★★ epic, ★★★ legendary. Higher rarity means more output, but a higher attack cost (","מכל חומר לכל דרגה) והבוט המגן חזק יותר.":"of each material per rank) and a stronger defending bot.","הבית שלך. אי אפשר לתקוף אותו כל עוד יש לך אריחים אחרים.":"Your home. It cannot be attacked while you own other tiles.","מסגרת צהובה - אריחים שלך.":"Yellow outline - your tiles.","מסגרת אדומה - של שחקן אחר.":"Red outline - another player's.","תוקפים רק אריח שצמוד לטריטוריה שלך. אריח שנכבש מוגן":"You can only attack a tile next to your territory. A conquered tile is protected for","שעות.":"hours.","החומרים נצברים לבד גם כשאינך מחובר, עד":"Materials build up on their own while you are away, up to","שעות. לכל אריח נוסף יש תחזוקה קטנה.":"hours. Each extra tile has a small upkeep.","הפסד בקרב מאבד רק את האריח. המטבעות, הדירוג וההיסטוריה נשארים.":"Losing a battle only loses the tile. Coins, rank and history stay."};
  const localize = (root) => {
    if (!EN) return;
    const keys = Object.keys(EN_MAP).sort((a, b) => b.length - a.length);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) { let v = n.nodeValue; for (const k of keys) if (v.includes(k)) v = v.split(k).join(EN_MAP[k]); n.nodeValue = v; }
    root.querySelectorAll("[aria-label]").forEach(e => { let v = e.getAttribute("aria-label"); for (const k of keys) v = v.split(k).join(EN_MAP[k]); e.setAttribute("aria-label", v); });
  };
  const KIND = { forest: ["🌲", "יער", "#2f6b3a"], mine: ["⛏️", "מכרה", "#6b5a45"], quarry: ["🪨", "מחצבה", "#5b6572"],
    plains: ["🌾", "מישור", "#7a8a3c"], fortress: ["🏰", "מצודה", "#7b3f6e"] };
  const RAR = ["", "רגיל", "נדיר", "אפי", "אגדי"];
  const MAT = { wood: "🪵 עץ", iron: "⚙️ ברזל", stone: "🧱 אבן" };
  const CSS = `
  .war-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
  .war-chip{background:rgba(255,255,255,.08);padding:6px 10px;border-radius:12px;font-weight:700}
  .war-wrap{display:grid;grid-template-columns:minmax(0,2fr) minmax(220px,1fr);gap:12px}
  @media (max-width:760px){.war-wrap{grid-template-columns:1fr}}
  .war-map{overflow:auto;max-height:58vh;border-radius:12px;background:#361c0b;padding:6px}
  .war-grid{display:grid;gap:2px;direction:ltr}
  .wt{aspect-ratio:1;min-width:30px;border:0;border-radius:6px;font-size:15px;line-height:1;padding:0;color:#fff;cursor:pointer;position:relative;opacity:.92}
  .wt.mine{outline:3px solid #ffd35c;opacity:1}
  .wt.enemy{outline:3px solid #e0556b}
  .wt.sel{outline:3px solid #fff;opacity:1}
  .wt .r{position:absolute;bottom:1px;left:2px;font-size:9px;font-weight:700}
  .war-side .card{margin-bottom:10px}
  .war-leg{margin:4px 18px 8px 0;padding:0 0 0 0;list-style:none;line-height:1.7}
  .war-legend summary{cursor:pointer}
  .war-persona label{display:flex;justify-content:space-between;margin-top:8px}
  .war-persona input[type=range]{width:100%}`;
  function css() { if (document.getElementById("war-css")) return; const s = document.createElement("style"); s.id = "war-css"; s.textContent = CSS; document.head.appendChild(s); }

  App.vWar = async function (view, seq = this._routeSeq) {
    if (!this.routeCurrent(seq)) return;
    css();
    if (!this.me) { location.hash = "#/login"; return; }
    if (this.me.is_guest) {
      view.removeAttribute("aria-busy");
      view.innerHTML = `<h1>🗺️ מלחמת טריטוריות</h1><div class="card" style="text-align:center;padding:32px 18px"><div style="font-size:42px">🔒</div><p class="sub">המפה זמינה לשחקנים רשומים בלבד.</p></div>`;
      return;
    }
    const mr = await API.get("/api/territory/me"); /* first: /me assigns a new player's home, the map must be read after it */
    const [pr, mapr] = await Promise.all([API.get("/api/persona"), API.get("/api/territory/map")]);
    if (!this.routeCurrent(seq)) return;
    view.removeAttribute("aria-busy");
    if (mr.status !== 200 || mapr.status !== 200) {
      view.innerHTML = `<h1>🗺️ מלחמת טריטוריות</h1><div class="card"><p class="sub">${esc(apiError(mr.status !== 200 ? mr : mapr, "המפה אינה זמינה כרגע."))}</p></div>`;
      return;
    }
    let me = mr.data, map = mapr.data, persona = pr.data || {}, sel = null;
    const wctx = { me, map, persona };
    const byXY = new Map(map.tiles.map(t => [t.x + "," + t.y, t]));
    const adjacent = (t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const n = byXY.get((t.x + dx) + "," + (t.y + dy)); return n && n.mine; });
    const cfg = me.cfg || {};
    const cost = (t) => (cfg.cost_per_rarity || 15) * t.rarity;

    const legend = () => `<details class="card war-legend" open><summary><b>📖 מקרא והסבר</b></summary>
      <p class="sub" style="margin-top:8px">סוגי אריחים:</p>
      <ul class="war-leg">
        <li>🌲 יער - מייצר עץ</li>
        <li>⛏️ מכרה - מייצר ברזל</li>
        <li>🪨 מחצבה - מייצר אבן</li>
        <li>🌾 מישור - מייצר מעט מכל שלושת החומרים</li>
        <li>🏰 מצודה - מייצרת מכל החומרים, תמיד אפית או אגדית</li>
      </ul>
      <p class="sub">דרגת נדירות: ★ נדיר, ★★ אפי, ★★★ אגדי. ככל שהדרגה גבוהה יותר התפוקה גדולה יותר, אבל גם עלות התקיפה גבוהה יותר (${cfg.cost_per_rarity || 15} מכל חומר לכל דרגה) והבוט המגן חזק יותר.</p>
      <ul class="war-leg">
        <li>🏠 הבית שלך. אי אפשר לתקוף אותו כל עוד יש לך אריחים אחרים.</li>
        <li>🟨 מסגרת צהובה - אריחים שלך. 🟥 מסגרת אדומה - של שחקן אחר.</li>
        <li>תוקפים רק אריח שצמוד לטריטוריה שלך. אריח שנכבש מוגן ${cfg.grace_hours || 24} שעות.</li>
        <li>החומרים נצברים לבד גם כשאינך מחובר, עד ${cfg.accrual_cap_hours || 24} שעות. לכל אריח נוסף יש תחזוקה קטנה.</li>
        <li>הפסד בקרב מאבד רק את האריח. המטבעות, הדירוג וההיסטוריה נשארים.</li>
      </ul></details>`;
    const draw = () => {
      const size = map.size;
      const grid = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const t = byXY.get(x + "," + y); if (!t) { grid.push("<span></span>"); continue; }
        const k = KIND[t.kind] || KIND.plains;
        const cls = ["wt", t.mine ? "mine" : (t.owned ? "enemy" : ""), sel && sel.id === t.id ? "sel" : ""].join(" ");
        grid.push(`<button class="${cls}" data-id="${t.id}" style="background:${k[2]}" aria-label="${k[1]} ${x},${y}">${t.home ? "🏠" : k[0]}<span class="r">${t.rarity > 1 ? "★".repeat(t.rarity - 1) : ""}</span></button>`);
      }
      const m = me.materials;
      view.innerHTML = `<h1>🗺️ מלחמת טריטוריות</h1>
        <div class="war-top">
          <span class="war-chip">${MAT.wood} ${m.wood}</span><span class="war-chip">${MAT.iron} ${m.iron}</span><span class="war-chip">${MAT.stone} ${m.stone}</span>
          <span class="war-chip">⚔️ התקפות היום ${me.attacks_today}/${me.attacks_cap}</span>
          <span class="war-chip">🏴 אריחים: ${me.tiles.length}</span>
        </div>
        <div class="war-wrap">
          <div class="war-map" id="war-map"><div class="war-grid" style="grid-template-columns:repeat(${size},minmax(30px,1fr))">${grid.join("")}</div></div>
          <div class="war-side">
            <div class="card" id="war-detail">${detail()}</div>
            ${legend()}
            <div id="war-extra"></div>
            <div class="card war-persona"><h3>🛡️ אישיות המגן שלי</h3>
              <p class="sub">כשתוקפים אותך, מגן החצר שלך נלחם לפי ההגדרות. תקציב ${persona.budget} נקודות.</p>
              ${["aggression:תוקפנות", "accuracy:דיוק", "boldness:אומץ"].map(s => { const [k, l] = s.split(":"); return `<label><span>${l}</span><b id="pv-${k}">${persona.persona[k]}</b></label><input type="range" id="pr-${k}" min="0" max="100" value="${persona.persona[k]}">`; }).join("")}
              <label style="display:flex;gap:8px;align-items:center;justify-content:flex-start;margin-top:10px"><input type="checkbox" id="pr-auto" ${persona.auto_defense ? "checked" : ""}><span>${T("הגנה אוטומטית: הבוט מגן במקומי כשאני מחובר")}</span></label>
              <p class="sub" id="persona-total" aria-live="polite"></p>
              <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="persona-save">שמירה</button><button class="btn small secondary" id="persona-test">תרגול מול החצר שלי</button></div>
            </div>
          </div>
        </div>`;
      wire();
      localize(view);
      if (App.warExtras) App.warExtras(view, wctx);
    };
    const detail = () => {
      if (!sel) return `<p class="sub">בחר אריח במפה. אפשר לתקוף אריח שצמוד לטריטוריה שלך (מסומנת בצהוב).</p>`;
      const k = KIND[sel.kind]; const c = cost(sel);
      let act = "";
      if (sel.mine) act = `<p class="sub">האריח שלך${sel.home ? " (הבית)" : ""}.</p>`;
      else if (sel.ally) act = `<p class="sub">${T("🤝 בעל ברית.")}</p>`;
      else if (sel.protected) act = `<p class="sub">🔒 מוגן בתקופת חסד.</p>`;
      else if (!adjacent(sel)) act = `<p class="sub">לא צמוד לטריטוריה שלך.</p>`;
      else act = `<p class="sub">עלות תקיפה: ${c} מכל חומר.</p><button class="btn" id="war-attack">⚔️ תקוף</button>`;
      return `<h3>${k[0]} ${k[1]} · ${RAR[sel.rarity]}</h3><p class="sub">בעלים: ${sel.owner ? esc(sel.owner) : "פנוי (הגנת בוט)"}${sel.owner && !sel.mine && App.showProfile ? ` <button class="btn small secondary" id="war-prof">${T("פרופיל")}</button>` : ""}</p>${act}`;
    };
    const wire = () => {
      view.querySelectorAll(".wt").forEach(b => b.onclick = () => { sel = map.tiles.find(t => t.id === Number(b.dataset.id)); const sc = document.getElementById("war-map").scrollTop; const sl = document.getElementById("war-map").scrollLeft; draw(); const mp = document.getElementById("war-map"); mp.scrollTop = sc; mp.scrollLeft = sl; });
      const pf = document.getElementById("war-prof"); if (pf) pf.onclick = () => App.showProfile(sel.owner);
      const atk = document.getElementById("war-attack");
      if (atk) atk.onclick = async () => {
        atk.disabled = true;
        const r = await API.post("/api/territory/attack", { tile_id: sel.id });
        if (r.data && r.data.match_id) location.hash = "#/game/" + r.data.match_id;
        else { toast(apiError(r, T("לא ניתן לתקוף"))); atk.disabled = false; }
      };
      const upd = () => {
        const v = ["aggression", "accuracy", "boldness"].map(k => Number(document.getElementById("pr-" + k).value));
        ["aggression", "accuracy", "boldness"].forEach((k, i) => document.getElementById("pv-" + k).textContent = v[i]);
        const tot = v[0] + v[1] + v[2]; const over = tot > persona.budget;
        const el = document.getElementById("persona-total"); el.textContent = `סה"כ ${tot}/${persona.budget}` + (over ? " - חריגה מהתקציב" : "");
        document.getElementById("persona-save").disabled = over; return v;
      };
      ["aggression", "accuracy", "boldness"].forEach(k => document.getElementById("pr-" + k).oninput = upd);
      upd();
      document.getElementById("persona-save").onclick = async () => {
        const v = upd(); const r = await API.post("/api/persona", { aggression: v[0], accuracy: v[1], boldness: v[2], auto_defense: document.getElementById("pr-auto").checked });
        if (r.status === 200) { persona.persona = { aggression: v[0], accuracy: v[1], boldness: v[2] }; toast(T("האישיות נשמרה")); } else toast(apiError(r, T("השמירה נכשלה")));
      };
      document.getElementById("persona-test").onclick = async () => {
        const r = await API.post("/api/courtyard/practice");
        if (r.data && r.data.match_id) location.hash = "#/game/" + r.data.match_id; else toast(apiError(r, T("שגיאה")));
      };
    };
    draw();
    const h = me.home && byXY.get(me.home.x + "," + me.home.y);
    if (h) { const b = view.querySelector(`.wt[data-id="${h.id}"]`); if (b && b.scrollIntoView) b.scrollIntoView({ block: "center", inline: "center" }); }
  };
})();

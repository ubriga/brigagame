/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
// v83: interface choice (mobile / desktop), separate music switch, pre-match timer choice,
// and a short worked example of territory conquest. Layout only - no game rules change.
const UiMode = {
  pref() { try { const v = Consent.getPref("bg_ui"); return v === "d" || v === "m" ? v : "a"; } catch (e) { return "a"; } },
  auto() { return matchMedia("(pointer: fine)").matches && Math.min(screen.width, screen.height) >= 700 ? "d" : "m"; },
  mode() { const p = this.pref(); return p === "a" ? this.auto() : p; },
  apply() {
    const m = this.mode();
    document.body.classList.toggle("ui-desktop", m === "d");
    document.body.classList.toggle("ui-mobile", m === "m");
    // A phone that is forced to the desktop interface gets a desktop-width page.
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) {
      const touch = matchMedia("(pointer: coarse)").matches;
      vp.setAttribute("content", (touch && m === "d") ? "width=1280, viewport-fit=cover"
        : "width=device-width, initial-scale=1.0, viewport-fit=cover");
    }
    window.dispatchEvent(new Event("resize"));
  },
  set(v) { Consent.setPref("bg_ui", v); this.apply(); this._renderPanel(); },
  prestart() { const v = parseInt(Consent.getPref("bg_prestart"), 10); return v >= 5 && v <= 10 ? v : 5; },
  en() { return typeof Lang !== "undefined" && Lang.current === "en"; },
  musicLabel() { const off = Sfx.musicOff || Sfx.muted; return this.en() ? (off ? "🎵 Music: off" : "🎵 Music: on") : (off ? "🎵 מוזיקה: כבויה" : "🎵 מוזיקה: פועלת"); },
  _renderPanel() {
    const box = document.getElementById("ui-panel"); if (!box) return;
    const en = this.en(), p = this.pref(), cur = this.mode();
    const seg = (v, he, e) => `<button type="button" class="ui-seg${p === v ? " on" : ""}" data-ui="${v}">${en ? e : he}</button>`;
    box.innerHTML = `
      <div class="ui-row"><span class="ui-lbl">${en ? "Interface" : "ממשק"}</span>
        ${seg("a", "אוטומטי", "Auto")}${seg("m", "📱 נייד", "📱 Mobile")}${seg("d", "🖥️ מחשב", "🖥️ Desktop")}
        <span class="ui-note">${en ? "now: " : "כרגע: "}${cur === "d" ? (en ? "desktop" : "מחשב") : (en ? "mobile" : "נייד")}</span></div>
      <div class="ui-row"><span class="ui-lbl">${en ? "Before a match" : "לפני משחק"}</span>
        <select id="ui-prestart" aria-label="${en ? "Seconds before the match" : "שניות לפני המשחק"}">${[5,6,7,8,9,10].map(n => `<option value="${n}"${n === this.prestart() ? " selected" : ""}>${n} ${en ? "sec" : "שנ'"}</option>`).join("")}</select>
        <button type="button" class="ui-seg" id="ui-music">${this.musicLabel()}</button></div>`;
    box.querySelectorAll("[data-ui]").forEach(b => b.onclick = () => { try { Sfx.play("click"); } catch (e) {} this.set(b.dataset.ui); });
    box.querySelector("#ui-prestart").onchange = (e) => { Consent.setPref("bg_prestart", e.target.value); };
    box.querySelector("#ui-music").onclick = () => { Sfx.toggleMusic(); this._renderPanel(); this._renderFloat(); };
  },
  _renderFloat() {
    let b = document.getElementById("music-float");
    const inGame = document.body.classList.contains("game-active");
    if (!inGame) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("button"); b.id = "music-float"; b.type = "button";
      b.onclick = () => { Sfx.toggleMusic(); this._renderFloat(); this._renderPanel(); };
      document.body.appendChild(b);
    }
    const off = Sfx.musicOff || Sfx.muted;
    b.textContent = off ? "🎵✕" : "🎵";
    b.title = b.ariaLabel = this.musicLabel();
    b.classList.toggle("off", !!off);
  },
  _tickLobby() {
    const view = document.getElementById("view");
    if (!view || !/^#\/lobby/.test(location.hash)) return;
    if (document.getElementById("ui-panel")) return;
    const h1 = view.querySelector("h1");
    if (!h1 || h1.parentElement !== view) return;
    const box = document.createElement("div"); box.id = "ui-panel";
    let anchor = h1.nextElementSibling && h1.nextElementSibling.classList.contains("sub") ? h1.nextElementSibling : h1;
    anchor.insertAdjacentElement("afterend", box);
    this._renderPanel();
  },
  // Territory conquest: a short worked example, shown at the top of the war map.
  explainHtml() {
    const en = this.en();
    return en ? `<details class="card war-explain" id="war-explain" open><summary><b>🗺️ How conquest works - example</b></summary>
      <ol><li><b>Your home</b> is the yellow-outlined tile. You can only attack a tile that touches your territory.</li>
      <li>Tap a free tile next to it, say a Plains tile. The side panel shows the attack cost (materials: wood, iron, stone).</li>
      <li>Press <b>Attack</b>. The cost is paid and you play one normal match against the defender of that tile (a bot, or the other player's defender).</li>
      <li><b>You win:</b> the tile turns yellow (yours), is protected for a few hours and starts producing materials, even while you are away. Now the tiles next to it can be attacked too.</li>
      <li><b>You lose:</b> you only miss the tile. Coins, rank and history stay. Collect materials and try again.</li></ol>
      <p class="sub">Example: Home in the Forest -> take the Plains next to it -> next the Mine next to the Plains. Higher rarity = more output but a stronger defender.</p></details>`
    : `<details class="card war-explain" id="war-explain" open><summary><b>🗺️ איך כובשים? דוגמה</b></summary>
      <ol><li><b>הבית שלך</b> הוא האריח עם המסגרת הצהובה. אפשר לתקוף רק אריח שצמוד לטריטוריה שלך.</li>
      <li>לוחצים על אריח פנוי שצמוד לבית, למשל מישור. בצד מופיעה עלות התקיפה (חומרים: עץ, ברזל, אבן).</li>
      <li>לוחצים <b>תקוף</b>. העלות יורדת ואתה משחק משחק רגיל אחד מול מגן האריח (בוט, או המגן של שחקן אחר).</li>
      <li><b>ניצחת:</b> האריח נצבע בצהוב (שלך), מוגן כמה שעות, ומתחיל להניב חומרים גם כשאתה לא מחובר. עכשיו אפשר לתקוף גם את האריחים שצמודים אליו.</li>
      <li><b>הפסדת:</b> רק לא קיבלת את האריח. המטבעות, הדירוג וההיסטוריה נשארים. אוספים חומרים ומנסים שוב.</li></ol>
      <p class="sub">דוגמה: בית ביער ← כובשים את המישור שלידו ← אחר כך את המכרה שצמוד למישור. ככל שהדרגה נדירה יותר התפוקה גדולה יותר, אבל גם המגן חזק יותר.</p></details>`;
  },
  _tickWar() {
    const view = document.getElementById("view");
    if (!view || !/^#\/war/.test(location.hash) || document.getElementById("war-explain")) return;
    const top = view.querySelector(".war-top"); if (!top) return;
    top.insertAdjacentHTML("afterend", this.explainHtml());
  },
  init() {
    this.apply();
    matchMedia("(pointer: fine)").addEventListener?.("change", () => this.apply());
    setInterval(() => { document.body.classList.toggle("view-lobby", /^#\/lobby/.test(location.hash)); document.body.classList.toggle("view-war", /^#\/war/.test(location.hash)); this._tickLobby(); this._tickWar(); this._renderFloat(); }, 600);
  }
};
UiMode.init();

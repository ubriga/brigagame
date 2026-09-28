// Cookie/storage consent - a REAL gate, not a dummy button.
// The choice is persisted (localStorage + cookie), mirrored to the server
// audit log (IP hashed), and actually enforced: non-essential preference
// storage (language pick is functional; convenience prefs below) is kept
// out of persistent storage until the visitor accepts. Strictly-necessary
// storage - the session token created by the visitor's own explicit login
// action, this consent record, and in-game state - is exempt by nature.
const Consent = {
  KEY: "bg_consent",

  get() {
    try {
      const c = JSON.parse(localStorage.getItem(this.KEY) || "null");
      return c && c.v === 1 ? c : null;
    } catch { return null; }
  },

  has() { return !!this.get(); },
  allowsAll() { return this.get()?.choice === "all"; },

  // Gate for NON-essential preference persistence. Without consent the pref
  // still works for the current tab (sessionStorage) but is never persisted.
  setPref(key, value) {
    if (this.allowsAll()) { localStorage.setItem(key, value); return true; }
    try { sessionStorage.setItem(key, value); } catch {}
    localStorage.removeItem(key);
    return false;
  },

  record(choice) {
    const rec = { v: 1, choice, ts: new Date().toISOString() };
    localStorage.setItem(this.KEY, JSON.stringify(rec));
    document.cookie = "bg_consent=" + choice + ";max-age=31536000;path=/;samesite=lax";
    try {
      fetch((CONFIG.API_BASE || "") + "/api/legal/consent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, lang: (typeof Lang !== "undefined" ? Lang.current : "he") }),
      }).catch(() => {});
    } catch {}
  },

  boot() {
    if (this.has()) return;
    const en = (typeof Lang !== "undefined" && Lang.current === "en");
    const wrap = document.createElement("div");
    wrap.id = "consent-banner";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-live", "polite");
    wrap.innerHTML = en ? `
      <div class="consent-text">🍪 This game uses browser storage (cookies) to run - sign-in session and saved game - and, only with your consent, to remember convenience preferences (language, last bot level). No ads, no trackers.
        <a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></div>
      <div class="consent-actions">
        <button class="btn small" id="consent-all">Accept</button>
        <button class="btn small secondary" id="consent-essential">Essentials only</button>
      </div>` : `
      <div class="consent-text">🍪 המשחק משתמש באחסון הדפדפן (עוגיות) כדי לפעול - סשן כניסה ומשחק שמור - ורק באישורך גם לשמירת העדפות נוחות (שפה, רמת הבוט האחרונה). בלי פרסומות ובלי עקיבה.
        <a href="privacy.html" target="_blank" rel="noopener">מדיניות פרטיות</a></div>
      <div class="consent-actions">
        <button class="btn small" id="consent-all">מאשר</button>
        <button class="btn small secondary" id="consent-essential">הכרחי בלבד</button>
      </div>`;
    document.body.appendChild(wrap);
    const done = (choice) => { this.record(choice); wrap.remove(); };
    wrap.querySelector("#consent-all").onclick = () => done("all");
    wrap.querySelector("#consent-essential").onclick = () => done("essential");
  },
};

document.addEventListener("DOMContentLoaded", () => Consent.boot());

// Thin API client. The server is authoritative for everything.
const API = {
  // Remember-me: "זכור אותי" stores the session in localStorage (persists
  // across days, until server expiry); without it the token lives in
  // sessionStorage and dies when the browser tab/session closes.
  token: localStorage.getItem("bg_token") || sessionStorage.getItem("bg_token") || null,
  retryBaseMs: 450,
  // Hard ceiling per request. Without a timeout, one stalled connection (or
  // the single free-tier worker being busy) hangs the client on "connecting"
  // forever. Aborting frees the client to retry on a fresh connection instead
  // of waiting on a dead one.
  timeoutMs: 12000,

  setToken(t, remember = true) {
    this.token = t;
    localStorage.removeItem("bg_token");
    sessionStorage.removeItem("bg_token");
    if (t) (remember ? localStorage : sessionStorage).setItem("bg_token", t);
  },

  setReconnecting(on) {
    const el = document.getElementById("reconnect-indicator");
    if (el) el.classList.toggle("hidden", !on);
    window.dispatchEvent(new CustomEvent(on ? "brigagame:reconnecting" : "brigagame:reconnected"));
  },

  async call(method, path, body, options = {}) {
    // Only retry reads. Retrying a POST after an uncertain network failure can
    // duplicate a purchase or other mutation even if the first request landed.
    const attempts = method === "GET" ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const headers = { "Content-Type": "application/json" };
      if (this.token) headers["Authorization"] = "Bearer " + this.token;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs || this.timeoutMs);
      try {
        const res = await fetch(CONFIG.API_BASE + path, {
          method, headers, body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        let data = {};
        try { data = await res.json(); } catch (e) { /* non-JSON */ }
        const transient = [502, 503, 504].includes(res.status);
        if (transient && attempt + 1 < attempts) {
          this.setReconnecting(true);
          await new Promise(r => setTimeout(r, this.retryBaseMs * (2 ** attempt)));
          continue;
        }
        this.setReconnecting(false);
        if (res.status === 401 && !path.startsWith("/api/auth")) {
          this.setToken(null);
          location.hash = "#/login";
        }
        return { status: res.status, data };
      } catch (error) {
        clearTimeout(timer);
        if (attempt + 1 < attempts) {
          this.setReconnecting(true);
          await new Promise(r => setTimeout(r, this.retryBaseMs * (2 ** attempt)));
          continue;
        }
        this.setReconnecting(true);
        return { status: 0, data: {}, networkError: true };
      }
    }
  },
  get(p) { return this.call("GET", p); },
  post(p, b, options) { return this.call("POST", p, b || {}, options); },
  del(p) { return this.call("DELETE", p); },
};

function toast(msg, ms = 3200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

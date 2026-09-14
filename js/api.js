// Thin API client. The server is authoritative for everything.
const API = {
  token: localStorage.getItem("bg_token") || null,

  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem("bg_token", t);
    else localStorage.removeItem("bg_token");
  },

  async call(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = "Bearer " + this.token;
    const res = await fetch(CONFIG.API_BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (res.status === 401 && !path.startsWith("/api/auth")) {
      this.setToken(null);
      location.hash = "#/login";
    }
    return { status: res.status, data };
  },
  get(p) { return this.call("GET", p); },
  post(p, b) { return this.call("POST", p, b || {}); },
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

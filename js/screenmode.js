/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
// Landscape full-screen mode for gameplay and menus.
// Enter by button or by rotating a touch device to landscape. A real browser
// fullscreen + landscape lock is requested as a best effort (browsers only
// allow it after a tap, and iOS Safari allows neither); the landscape layout
// (body.fs-mode) is applied in every case so the screen is always usable.
const ScreenMode = {
  active: false, byUser: false, floatBtn: null,
  isTouch() { return matchMedia("(pointer: coarse)").matches; },
  isLandscape() { return matchMedia("(orientation: landscape)").matches; },
  fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; },
  async tryFullscreen() {
    const el = document.documentElement;
    try {
      if (!this.fsEl()) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) await req.call(el, { navigationUI: "hide" });
      }
    } catch (e) { /* needs a user gesture; layout still applies */ }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape"); }
    catch (e) { /* not supported or not allowed here */ }
  },
  async release() {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    try {
      if (this.fsEl()) {
        const ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) await ex.call(document);
      }
    } catch (e) {}
  },
  label(on) {
    const en = typeof Lang !== "undefined" && Lang.current === "en";
    return on ? (en ? "↩ Exit full screen" : "↩ יציאה ממסך מלא")
              : (en ? "⛶ Full screen (landscape)" : "⛶ מסך מלא (לרוחב)");
  },
  apply(on) {
    this.active = on;
    document.body.classList.toggle("fs-mode", on);
    if (this.floatBtn) {
      this.floatBtn.classList.remove("hidden");
      this.floatBtn.classList.toggle("on", on);
      this.floatBtn.textContent = this.label(on);
      this.floatBtn.setAttribute("aria-label", this.label(on));
    }
    const b = document.getElementById("fs-btn");
    if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
    const ib = document.getElementById("fs-inline");
    if (ib) ib.textContent = this.label(on);
    window.dispatchEvent(new Event("resize"));
  },
  async enter(byUser) {
    this.byUser = !!byUser;
    this.apply(true);
    await this.tryFullscreen();
  },
  async exit() {
    this.byUser = false;
    this.apply(false);
    await this.release();
  },
  toggle() { return this.active ? this.exit() : this.enter(true); },
  tickLobby() {
    const view = document.getElementById("view");
    if (!view || !/^#\/lobby/.test(location.hash) || document.getElementById("fs-inline")) return;
    const h1 = view.querySelector("h1");
    if (!h1 || h1.parentElement !== view) return;
    const b = document.createElement("button");
    b.id = "fs-inline"; b.type = "button"; b.textContent = this.label(this.active);
    b.addEventListener("click", () => this.toggle());
    const sub = h1.nextElementSibling && h1.nextElementSibling.classList.contains("sub") ? h1.nextElementSibling : h1;
    sub.insertAdjacentElement("afterend", b);
  },
  init() {
    const lang = () => (typeof Lang !== "undefined" && Lang.current === "en");
    const btn = document.createElement("button");
    btn.id = "fs-btn"; btn.type = "button"; btn.textContent = "⛶";
    btn.title = lang() ? "Full screen (landscape)" : "מסך מלא (לרוחב)";
    btn.setAttribute("aria-label", btn.title);
    const anchor = document.getElementById("mute-btn");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
    btn.addEventListener("click", () => this.toggle());

    // One always-visible control: enters full screen (landscape) and, once in,
    // becomes the clear way back out.
    const fl = document.createElement("button");
    fl.id = "fs-float"; fl.type = "button";
    fl.textContent = this.label(false);
    fl.setAttribute("aria-label", this.label(false));
    fl.addEventListener("click", () => this.toggle());
    document.body.appendChild(fl);
    this.floatBtn = fl;

    // Leaving real fullscreen with Esc / system back also leaves the mode.
    const onFs = () => { if (this.active && !this.fsEl() && this.byUser && !this.isTouch()) this.apply(false); };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);

    // No automatic entering/leaving: orientation and resize events (rotation
    // lock, Google sign-in redirects, address bar) made the mode flap on some
    // phones. The mode changes only when the user taps the button.
    setInterval(() => this.tickLobby(), 1000);
  }
};
ScreenMode.init();

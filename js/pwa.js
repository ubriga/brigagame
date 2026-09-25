// Install lifecycle for Android Chrome and install-capable desktop browsers.
const PWAInstall = {
  prompt: null,
  init() {
    const button = document.getElementById("install-btn");
    const card = document.getElementById("install-card");
    const confirm = document.getElementById("install-confirm");
    const dismiss = document.getElementById("install-dismiss");
    const installed = matchMedia("(display-mode: standalone)").matches ||
      matchMedia("(display-mode: fullscreen)").matches || navigator.standalone;
    if (installed) return;

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      if (window.__BG_LOCKED__) return; // Shabbat/holiday lock screen: no install prompt
      this.prompt = event;
      button.classList.remove("hidden");
      if (localStorage.getItem("bg_install_dismissed") !== "1")
        card.classList.remove("hidden");
    });

    const install = async () => {
      if (!this.prompt) return;
      card.classList.add("hidden");
      button.classList.add("hidden");
      const event = this.prompt;
      this.prompt = null;
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome !== "accepted") button.classList.remove("hidden");
    };
    button.addEventListener("click", install);
    confirm.addEventListener("click", install);
    dismiss.addEventListener("click", () => {
      card.classList.add("hidden");
      localStorage.setItem("bg_install_dismissed", "1");
    });
    window.addEventListener("appinstalled", () => {
      this.prompt = null;
      button.classList.add("hidden");
      card.classList.add("hidden");
      localStorage.removeItem("bg_install_dismissed");
    });

    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
        .catch(error => console.warn("Service worker registration failed", error));
  }
};
PWAInstall.init();

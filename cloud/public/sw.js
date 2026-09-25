/* Brigagame service worker: offline shell fallback without stale deploys. */
const RELEASE = "28-shabbat-weekly";
const SHELL_CACHE = `brigagame-shell-${RELEASE}`;
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/style.css", "./js/config.js", "./js/i18n.js", "./js/api.js",
  "./js/audio.js", "./js/tower-skins.js", "./js/game.js", "./js/app.js", "./js/pwa.js",
  "./assets/sfx/shot.mp3", "./assets/sfx/explosion.mp3",
  "./assets/sfx/crumble.mp3", "./assets/sfx/click.mp3",
  "./assets/sfx/coin.mp3", "./assets/sfx/win.mp3", "./assets/sfx/lose.mp3",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("brigagame-shell-") && key !== SHELL_CACHE)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Do not intercept API or third-party requests at all. In particular,
  // leaving cross-origin CORS traffic to the browser preserves its native
  // preflight/response handling in installed Android PWAs.
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  // Network-first is deliberate: every online load gets the current JS/CSS.
  // The cache is used only when the network is unavailable.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request, { cache: "no-store" });
      if (fresh.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") {
        return (await caches.match("./index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});

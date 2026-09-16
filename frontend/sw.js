/* Brigagame service worker: offline shell fallback without stale deploys. */
const RELEASE = "13-pwa1";
const SHELL_CACHE = `brigagame-shell-${RELEASE}`;
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/style.css", "./js/config.js", "./js/api.js",
  "./js/audio.js", "./js/game.js", "./js/app.js",
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

  // API and third-party auth always go straight to the network. Never cache
  // mutable game state or authentication responses.
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

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

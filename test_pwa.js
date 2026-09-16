// Static PWA regression checks. Run with: node frontend/test_pwa.js
const fs = require("fs");
const path = require("path");
const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest")));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
function check(label, condition) { if (!condition) throw new Error(label); console.log(`PASS ${label}`); }
check("manifest is linked", html.includes('rel="manifest" href="manifest.webmanifest"'));
check("Hebrew RTL manifest", manifest.lang === "he" && manifest.dir === "rtl");
check("fullscreen landscape install", manifest.display === "fullscreen" && manifest.orientation === "landscape");
for (const icon of manifest.icons) check(`icon exists: ${icon.src}`, fs.existsSync(path.join(root, icon.src)));
check("service worker is registered without HTTP cache", /register\("\.\/sw\.js", \{ updateViaCache: "none" \}\)/.test(fs.readFileSync(path.join(root, "js/pwa.js"), "utf8")));
check("service worker uses network-first asset fetches", sw.includes('fetch(request, { cache: "no-store" })'));
check("service worker never caches API", sw.includes('url.pathname.includes("/api/")'));
check("cache release follows client version", sw.includes('RELEASE = "13-'));

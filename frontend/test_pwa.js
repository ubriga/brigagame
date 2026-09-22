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
check("mobile-safe standalone install", manifest.display === "standalone" && manifest.orientation === "any" && !manifest.display_override.includes("fullscreen"));
for (const icon of manifest.icons) check(`icon exists: ${icon.src}`, fs.existsSync(path.join(root, icon.src)));
check("service worker is registered without HTTP cache", /register\("\.\/sw\.js", \{ updateViaCache: "none" \}\)/.test(fs.readFileSync(path.join(root, "js/pwa.js"), "utf8")));
check("service worker uses network-first asset fetches", sw.includes('fetch(request, { cache: "no-store" })'));
check("service worker never intercepts API", /if \(url\.origin !== self\.location\.origin \|\| url\.pathname\.includes\("\/api\/"\)\) return;/.test(sw));
check("cache release follows client version", /const RELEASE = "22-[^"]+"/.test(sw));
check("offline shell includes PWA lifecycle", sw.includes('"./js/pwa.js"'));
for (const name of ["shot", "explosion", "crumble", "click", "coin", "win", "lose"])
  check(`offline shell includes sound: ${name}`, sw.includes(`"./assets/sfx/${name}.mp3"`));
check("external API bypasses respondWith", sw.includes('url.pathname.includes("/api/")) return;'));

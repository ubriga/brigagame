// Regression guards for 2026-09-16 mobile/PWA QA.
const fs = require("fs");
const path = require("path");
const root = __dirname;
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const game = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest")));
function check(label, ok) { if (!ok) throw new Error(label); console.log(`PASS ${label}`); }
check("game route marks body for one exit path", app.includes('classList.toggle("game-active", inGame)'));
check("header logout hidden during a match", css.includes("body.game-active #logout-btn { display: none !important; }"));
check("compact layout uses viewport capabilities, not a device model", css.includes("(max-width: 600px), (orientation: landscape) and (max-height: 760px)") && !css.includes("S24"));
check("short landscape stage scales from live viewport height", css.includes("100dvh - clamp(158px, 27dvh, 194px)") && css.includes("width: min(100%"));
check("canvas allows vertical navigation gestures", css.includes("touch-action: pan-y"));
check("aim starts near own tower only", game.includes("Math.hypot(p.x - m.x, p.y - m.y) > 145"));
check("tap does not shoot and drag threshold is required", game.includes(">= 12") && game.includes("if (!dragged) return"));
check("cancelled touch never shoots", game.includes('addEventListener("pointercancel", cancelAim)'));
check("PWA no longer forces fullscreen landscape", manifest.display === "standalone" && manifest.orientation === "any" && !manifest.display_override.includes("fullscreen"));

check("match start resets inherited horizontal scroll", game.includes("document.documentElement.scrollLeft = 0") && game.includes("scrollIntoView({ block: \"start\", inline: \"center\" })"));
check("game document blocks horizontal overflow", css.includes("body.game-active{overflow-x:hidden"));
check("shop exposes item investment tiers", app.includes("legendary: 4") && app.includes("tierOrder"));
check("admin controls cosmetic price and availability", app.includes("/api/admin/cosmetics/") && app.includes("data-price") && app.includes("data-available"));
check("admin foundations cover every approved gameplay stage", app.includes("/api/admin/gameplay-controls") && ["premium_skins", "coatings", "tower_expansion", "dynamic_obstacle"].every(k => app.includes(k)));
check("premium shop skins render real geometry previews", app.includes("skin-card-preview") && app.includes("data-skin-preview") && game.includes("PremiumTowerArt.draw"));
check("timed coatings expose queue workers and match layer", app.includes("/api/coatings/build") && app.includes("worker-scene") && game.includes("drawCoating(side)"));

const i18n = fs.readFileSync(path.join(root, "js/i18n.js"), "utf8");
check("language choice persists and covers dynamic game/store DOM", i18n.includes("brigagame_lang") && i18n.includes("MutationObserver") && app.includes("Lang.boot()"));
check("30 upcoming cosmetics are ribboned and blocked", app.includes("coming-ribbon") && app.includes("coming_soon") && app.includes('it.available === false'));

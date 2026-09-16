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

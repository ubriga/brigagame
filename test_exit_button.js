// Guards the unified exit/logout control (option ג, 2026-09-16):
// one inline SVG power icon on every device - never a unicode glyph that
// Android/PWA fonts swap for an X-like fallback - plus an in-match exit
// that asks "לצאת מהמשחק?" before leaving.
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const game = fs.readFileSync(__dirname + "/js/game.js", "utf8");
const css = fs.readFileSync(__dirname + "/css/style.css", "utf8");
function check(label, ok) { if (!ok) throw new Error(label); console.log(`PASS ${label}`); }

const POWER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 3v8"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/></svg>';

check("header logout button uses the inline SVG icon", html.includes(`<button id="logout-btn" title="התנתקות" aria-label="התנתקות">${POWER_SVG}</button>`));
check("no unicode power/X glyphs left in the shell", !html.includes("⏻") && !game.includes("⏻"));
check("in-match exit button uses the SAME svg markup", game.includes(`id="exit-match-btn" title="יציאה מהמשחק" aria-label="יציאה מהמשחק">${POWER_SVG}</button>`));
check("exit confirmation asks לצאת מהמשחק? with explicit יציאה מהמשחק button",
  game.includes("<span>לצאת מהמשחק?</span>") && game.includes('id="exit-match-yes">יציאה מהמשחק</button>'));
check("confirmation has a cancel path", game.includes('id="exit-match-no">ביטול</button>'));
check("confirmation warns that leaving an active match counts as a ranked loss", game.includes("יציאה ממשחק פעיל תיספר כהפסד בדירוג"));
check("leaving an active/waiting match goes through /api/matches/<id>/leave",
  game.includes('st === "active" || st === "waiting"') && game.includes('/api/matches/${this.matchId}/leave'));
check("exit buttons styled across viewports", css.includes("#exit-match-btn") && css.includes("#exit-confirm"));

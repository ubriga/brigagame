// Static guard for game-start failures that used to collapse to bare "שגיאה".
const fs = require("fs");
const app = fs.readFileSync(__dirname + "/js/app.js", "utf8");
function check(label, ok) { if (!ok) throw new Error(label); console.log(`PASS ${label}`); }
check("network failures get a useful Hebrew message", app.includes('result.networkError') && app.includes('אין חיבור לשרת'));
for (const kind of ["משחק מהיר", "משחק מול בוט", "משחק חברים"])
  check(`game-start error identifies ${kind}`, app.includes(`שגיאה ביצירת ${kind}`));
check("game-start handlers preserve API result", (app.match(/const result = await API\.post\("\/api\/matches\//g) || []).length >= 4);
check("daily reward reports network and HTTP failures", app.includes("שגיאה באיסוף הבונוס היומי") && /result = await API\.post\("\/api\/daily\/claim"/.test(app));

const game = fs.readFileSync(__dirname + "/js/game.js", "utf8");
check("leaving gameplay stops music", app.includes("if (!inGame) Sfx.stopMusic()") && game.includes("Sfx.stopMusic(); location.hash = \"#/lobby\""));
check("AI rematch submits difficulty only", game.includes('API.post("/api/matches/ai", { difficulty })') && !game.includes("bot_rank_level: Number(value)"));
check("expert tier is offered", app.includes('option value="expert"') && game.includes('["expert", "מומחה'));

check("admin statistics never masks API failure as zeroes", app.includes("overviewStatus !== 200") && app.includes("לא ניתן לטעון סטטיסטיקות"));
check("leaderboard exposes rank points and hides Elo", app.includes('נקודות דרגה') && app.includes('p.rank_points') && !app.includes('<th>דירוג</th><th>נצ׳</th>'));

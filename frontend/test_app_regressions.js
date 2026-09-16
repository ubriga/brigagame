// Static guard for game-start failures that used to collapse to bare "שגיאה".
const fs = require("fs");
const app = fs.readFileSync(__dirname + "/js/app.js", "utf8");
function check(label, ok) { if (!ok) throw new Error(label); console.log(`PASS ${label}`); }
check("network failures get a useful Hebrew message", app.includes('result.networkError') && app.includes('אין חיבור לשרת'));
for (const kind of ["משחק מהיר", "משחק מול בוט", "משחק חברים"])
  check(`game-start error identifies ${kind}`, app.includes(`שגיאה ביצירת ${kind}`));
check("game-start handlers preserve API result", (app.match(/const result = await API\.post\("\/api\/matches\//g) || []).length >= 4);
check("daily reward reports network and HTTP failures", app.includes("שגיאה באיסוף הבונוס היומי") && /result = await API\.post\("\/api\/daily\/claim"/.test(app));

import { validateNick, normalizeNick } from "../dist/nickname.js";
const t = (s) => { const r = validateNick(s); console.log(JSON.stringify(s), r.ok ? "OK" : r.error); };
["ArtyKing","א","יואב בריגה","Fuck_You","f.u.c.k","fvck","SH1T","Admin","אדמין","מנהל","orelai","OrelAI_fan","12345","a@b.com","www.x.co","קקי","שחקן מעולה","זין","Dick","Mike","ab","תותח-123","a\u200bdmin","Brigagame2026"].forEach(t);

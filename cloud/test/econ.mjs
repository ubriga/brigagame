import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { awardBotWin, ensureHome, settle, claimDailyGift, claimRefill, econStatus, giftAmount, cfgOf } from "../dist/game/territory.js";
const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);INSERT INTO users VALUES(1,'a'),(2,'b');");
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
sql.exec(schema.slice(schema.indexOf("-- 0003")));
const db = { async run(s,p){const r=sql.prepare(s).run(...p);return{changes:Number(r.changes)}}, async get(s,p){return sql.prepare(s).get(...p)??null} };
let fails = 0; const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const C = {};
const c = cfgOf(C);
ok([1,2,4,7,8,30].map(d=>giftAmount(d,c)).join() === "20,25,35,50,50,50", "gift curve 20..50 over 7 days: " + [1,2,4,7,8,30].map(d=>giftAmount(d,c)));
await ensureHome(db, 1, C);
let r = await claimDailyGift(db, 1, C);
ok(r.ok && r.got.wood === 20 && r.streak === 1, "day1 gift 20");
ok((await claimDailyGift(db, 1, C)).reason === "already", "second claim same day refused");
// simulate yesterday claim, streak 6 -> 7th day gives 50 but cap 60 total/day
const yday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
sql.prepare("update user_econ set last_claim_day=?, streak=6, cap_day=null where user_id=1").run(yday);
r = await claimDailyGift(db, 1, C); ok(r.ok && r.streak === 7 && r.got.wood === 50, "day7 gift 50 (cap day rolled over)");
// missed day resets
sql.prepare("update user_econ set last_claim_day='2000-01-01', streak=5 where user_id=1").run();
r = await claimDailyGift(db, 1, C); ok(r.ok && r.streak === 1, "missed days reset streak");
// daily cap: gift 50 already used today? set used to 50, gift 20 -> only 10
await ensureHome(db, 2, C); sql.prepare("insert or ignore into user_econ(user_id) values(2)").run();
sql.prepare("update user_econ set cap_day=?, cap_wood=50, cap_iron=50, cap_stone=50 where user_id=2").run(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }));
r = await claimDailyGift(db, 2, C); ok(r.ok && r.got.wood === 10, "daily cap trims gift to remaining 10: " + r.got.wood);
// refill: poor player
sql.prepare("update user_materials set wood=5, iron=40, stone=0 where user_id=2").run();
sql.prepare("update user_econ set cap_day=null, cap_wood=0, cap_iron=0, cap_stone=0 where user_id=2").run();
let st = await econStatus(db, 2, C, { wood: 5, iron: 40, stone: 0 }); ok(st.refill.available, "refill available when low");
r = await claimRefill(db, 2, C); ok(r.ok && r.got.wood === 25 && r.got.iron === 0 && r.got.stone === 30, "refill tops up to 30 only the low ones");
ok((await claimRefill(db, 2, C)).reason === "already", "refill once a day");
// not needed
sql.prepare("update user_materials set wood=100, iron=100, stone=100 where user_id=1").run();
ok((await claimRefill(db, 1, C)).reason === "not_needed", "no refill if not poor");
// safety yield: poor player accrues faster until threshold
sql.prepare("update user_materials set wood=0, iron=0, stone=0, last_settle=? where user_id=1").run(new Date(Date.now() - 2*3600000).toISOString());
let a = await settle(db, 1, C);
sql.prepare("update user_materials set wood=0, iron=0, stone=0, last_settle=? where user_id=1").run(new Date(Date.now() - 2*3600000).toISOString());
let b = await settle(db, 1, { territory: { safety_enabled: false } });
ok(a.wood + a.iron + a.stone > b.wood + b.iron + b.stone && a.wood <= 30 + 0, "safety net multiplies low accrual, capped at threshold: " + JSON.stringify([a, b]));
// switches
ok((await claimDailyGift(db, 1, { territory: { gift_enabled: false } })).reason === "disabled", "gift switch");
ok((await claimRefill(db, 1, { territory: { refill_enabled: false } })).reason === "disabled", "refill switch");
// bot win rewards
sql.exec("ALTER TABLE users ADD COLUMN is_guest INTEGER DEFAULT 0");
sql.prepare("delete from user_econ").run();
const big = { territory: { free_daily_cap: 1000 } };
const rw = []; for (const t of ["easy","medium","hard","ultra","expert"]) { sql.prepare("delete from user_econ where user_id=1").run(); rw.push((await awardBotWin(db, 1, t, big))?.wood ?? 0); }
ok(rw.join() === "0,6,10,15,20", "bot reward scales by tier: " + rw);
sql.prepare("delete from user_econ where user_id=1").run();
for (let i = 0; i < 10; i++) await awardBotWin(db, 1, "medium", big);
ok((await awardBotWin(db, 1, "medium", big)) === null, "daily max wins (10) enforced");
sql.prepare("delete from user_econ where user_id=1").run();
ok((await awardBotWin(db, 1, "expert", { territory: { bot_reward_enabled: false } })) === null, "global off switch");
sql.prepare("delete from user_econ where user_id=1").run();
await awardBotWin(db, 1, "expert", {}); await awardBotWin(db, 1, "expert", {}); await awardBotWin(db, 1, "expert", {});
const g4 = await awardBotWin(db, 1, "expert", {});
ok(g4 === null, "total free cap 60 stops rewards (3x20)");
sql.prepare("update users set is_guest=1 where id=2").run();
ok((await awardBotWin(db, 2, "expert", big)) === null, "guest gets nothing");
console.log(fails ? "FAILED " + fails : "ALL OK"); process.exit(fails ? 1 : 0);

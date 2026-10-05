import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { ensureMap, ensureHome, settle, resolveTerritoryBattle, ownedTiles, attackCost } from "../dist/game/territory.js";
const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);INSERT INTO users VALUES(1,'a'),(2,'b'),(3,'c');");
let schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const part = schema.slice(schema.indexOf("-- 0003"));
sql.exec(part);
const db = { async run(s,p){const r=sql.prepare(s).run(...p);return{changes:Number(r.changes)}}, async get(s,p){return sql.prepare(s).get(...p)??null} };
const C = {};
let fails = 0; const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
await ensureMap(db, C);
ok(sql.prepare("select count(*) n from territory_tiles").get().n === 400, "map 400 tiles");
await ensureMap(db, C); ok(sql.prepare("select count(*) n from territory_tiles").get().n === 400, "seed idempotent");
const h1 = await ensureHome(db, 1, C), h2 = await ensureHome(db, 2, C);
ok(h1 && h2 && h1.id !== h2.id, "two distinct homes");
ok((await ensureHome(db, 1, C)).id === h1.id, "home stable");
let m = sql.prepare("select * from user_materials where user_id=1").get(); ok(m.wood === 60, "start grant 60");
sql.prepare("update user_materials set last_settle=? where user_id=1").run(new Date(Date.now()-100*3600000).toISOString());
const after = await settle(db, 1, C);
ok(after.wood + after.iron + after.stone > 180, "accrual credited"); ok(after.wood <= 500, "store cap");
// battle: user1 conquers a neutral tile
const neutral = sql.prepare("select id from territory_tiles where owner_id is null limit 1").get().id;
sql.prepare("insert into territory_battles(attacker_id,defender_id,tile_id,created_at) values(1,null,?,?)").run(neutral, new Date().toISOString());
const mt = { state: { territory: { battle_id: 1 }, results: {} } };
await resolveTerritoryBattle(db, mt, "p1", C);
ok(sql.prepare("select owner_id,protected_until from territory_tiles where id=?").get(neutral).owner_id === 1, "winner owns tile");
ok(!!sql.prepare("select protected_until p from territory_tiles where id=?").get(neutral).p, "grace set");
await resolveTerritoryBattle(db, mt, "p1", C); ok(sql.prepare("select count(*) n from territory_battles where status='won'").get().n === 1, "idempotent resolve");
// loss
sql.prepare("insert into territory_battles(attacker_id,tile_id,created_at) values(2,?,?)").run(neutral, new Date().toISOString());
await resolveTerritoryBattle(db, { state: { territory: { battle_id: 2 }, results: {} } }, "p2", C);
ok(sql.prepare("select owner_id from territory_tiles where id=?").get(neutral).owner_id === 1, "attacker loss keeps owner");
// full loss: user 2 conquers user 1's last tiles -> user1 gets new home
for (const t of await ownedTiles(db, 1)) {
  sql.prepare("update territory_tiles set protected_until=null where id=?").run(t.id);
  sql.prepare("insert into territory_battles(attacker_id,defender_id,tile_id,created_at) values(2,1,?,?)").run(t.id, new Date().toISOString());
  const bid = sql.prepare("select max(id) i from territory_battles").get().i;
  await resolveTerritoryBattle(db, { state: { territory: { battle_id: bid }, results: {} } }, "p1", C);
}
const left = await ownedTiles(db, 1);
ok(left.length === 1 && left[0].is_home === 1, "full loss -> exactly a new home tile");
ok(sql.prepare("select wood from user_materials where user_id=1").get().wood > 0, "materials kept after loss");
console.log(JSON.stringify(attackCost(3, C)));
process.exit(fails ? 1 : 0);

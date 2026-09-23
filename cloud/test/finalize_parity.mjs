// Settlement parity: Python finalize_match vs TS finalizeMatch on identical input.
import { execFileSync } from "node:child_process";
import * as fin from "../dist/game/finalize.js";

const pyOut = execFileSync("python3", ["-c", `
import os, sys, json
os.environ["DB_PATH"] = "/tmp/fin_py.db"
if os.path.exists("/tmp/fin_py.db"): os.remove("/tmp/fin_py.db")
sys.path.insert(0, "/home/sandbox/brigagame/backend")
import app as appmod
from app import app, q, execute
with app.app_context():
    now = appmod._now_iso()
    execute("INSERT INTO users (id,email,name,coins,rating,wins,rank_points,losses,matches_played,created_at) VALUES (1,'a@b.c','A',500,1100,10,42.0,3,13,?)", (now,))
    execute("INSERT INTO users (id,email,name,coins,rating,rank_points,created_at) VALUES (2,'o@b.c','O',0,1250,300.0,?)", (now,))
    xp = appmod.rank_xp_config()
    m = {"id":"m1","p1":1,"p2":None,"p2_ai":1,"status":"active","winner":None,
         "state":{"damage_dealt":{"p1":841.0,"p2":436.7},"ai_difficulty":"expert","ai_tier":"expert",
                  "ai_rank_level":15,"towers":{"p1":[[5.0]*4 for _ in range(6)],"p2":[[0.0]*4 for _ in range(6)]},
                  "tower_max_hp":{"p1":972.0,"p2":1118.4},"mods":{"p1":{"hp":5},"p2":{"hp":0}}}}
    appmod.finalize_match(m, "p1")
    u1 = q("SELECT coins,rating,wins,rank_points,losses,matches_played FROM users WHERE id=1", one=True)
    tx = [dict(r) for r in q("SELECT delta,reason,ref FROM transactions")]
    print(json.dumps({"u1": dict(u1), "tx": tx, "results": m["state"]["results"], "winner": m["winner"], "status": m["status"], "xp": xp}))
`], { encoding: "utf8" });
const py = JSON.parse(pyOut);

// --- TS side with a fake Db that mirrors the exact statements ---
function fakeDb() {
  const users = new Map([[1, { id: 1, coins: 500, rating: 1100, wins: 10, rank_points: 42.0, losses: 3, matches_played: 13 }],
                         [2, { id: 2, coins: 0, rating: 1250, rank_points: 300.0 }]]);
  const tx = [];
  const r1 = (x) => Math.round(x * 1e9) / 1e9;
  return {
    users, tx,
    async run(sql, p) {
      if (sql.startsWith("UPDATE users SET coins")) { const u = users.get(p[1]); u.coins = r1(u.coins + p[0]); return { changes: 1 }; }
      if (sql.startsWith("INSERT INTO transactions")) { tx.push({ delta: p[1], reason: p[2], ref: p[3] }); return { changes: 1 }; }
      if (sql.includes("rating = rating + ?")) { const u = users.get(p[3]); u.rating = r1(u.rating + p[0]); u.wins += p[1]; u.rank_points = r1(u.rank_points + p[2]); u.matches_played += 1; return { changes: 1 }; }
      if (sql.includes("rating = MAX(0, rating - ?)")) { const u = users.get(p[4]); u.rating = Math.max(0, r1(u.rating - p[0])); u.rank_points = Math.max(0, r1(u.rank_points + p[1] - p[2])); u.losses += p[3]; u.matches_played += 1; return { changes: 1 }; }
      throw new Error("unknown SQL: " + sql);
    },
    async get(sql, p) {
      const u = users.get(p[0]);
      if (!u) return null;
      if (sql.includes("rating, wins, rank_points")) return { rating: u.rating, wins: u.wins, rank_points: u.rank_points };
      if (sql.includes("SELECT rating FROM")) return { rating: u.rating };
      if (sql.includes("rank_points")) return { rank_points: u.rank_points };
      return u;
    },
  };
}
const db = fakeDb();
const m = { id: "m1", p1: 1, p2: null, p2_ai: 1, status: "active", winner: undefined,
  state: { damage_dealt: { p1: 841.0, p2: 436.7 }, ai_difficulty: "expert", ai_tier: "expert",
           ai_rank_level: 15, towers: { p1: Array.from({length:6},()=>[5,5,5,5]), p2: Array.from({length:6},()=>[0,0,0,0]) },
           tower_max_hp: { p1: 972.0, p2: 1118.4 }, mods: { p1: { hp: 5 }, p2: { hp: 0 } } } };
await fin.finalizeMatch(db, m, "p1", py.xp);
const tsU1 = db.users.get(1);
const fails = [];
const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fails.push(name + ": ts=" + JSON.stringify(a) + " py=" + JSON.stringify(b)); };
for (const k of ["coins","rating","wins","rank_points","losses","matches_played"]) {
  const a = tsU1[k], b = py.u1[k];
  if (Math.abs(a - b) > 1e-9) fails.push(`u1.${k}: ts=${a} py=${b}`);
}
eq("tx", db.tx.map(t=>({delta:t.delta,reason:t.reason,ref:t.ref})), py.tx.map(t=>({delta:t.delta,reason:t.reason,ref:t.ref})));
eq("winner", m.winner ?? null, py.winner);
eq("status", m.status, py.status);
eq("p1_results.coins", m.state.results.p1.coins, py.results.p1.coins);
eq("p1_results.rating_delta", m.state.results.p1.rating_delta, py.results.p1.rating_delta);
eq("p1_results.rank_points_awarded", m.state.results.p1.rank_points_awarded, py.results.p1.rank_points_awarded);
eq("p1_results.idf_rank.level", m.state.results.p1.idf_rank.level, py.results.p1.idf_rank.level);
console.log("PY u1:", JSON.stringify(py.u1));
console.log("TS u1:", JSON.stringify(tsU1));
console.log(fails.length ? "FAIL\n" + fails.join("\n") : "FINALIZE PARITY OK");
process.exit(fails.length ? 1 : 0);
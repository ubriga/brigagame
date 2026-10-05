/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/** Courtyard + persona API (registered players only; no admin surface here). */
import { currentUser } from "../auth.js";
import { d1, getControls } from "../util.js";
import { json } from "./routes.js";
import { limited } from "./ratelimit.js";
import { createCourtyardMatch, createAiMatch, createLiveDefenseMatch } from "./matchmaking.js";
import { validatePersona, DEFAULT_PERSONA, DEFAULT_BUDGET } from "../game/persona.js";
import { cfgOf, ensureHome, ensureMap, settle, ownedTiles, attackCost, cancelBattle, reapDanglingBattles } from "../game/territory.js";
import type { Env } from "../do/MatchRoom";

const nowIso = () => new Date().toISOString();

async function budgetOf(env: Env): Promise<number> {
  const c: any = await getControls(env);
  const b = Number(c?.courtyard?.persona_budget);
  return Number.isFinite(b) ? Math.max(30, Math.min(300, Math.trunc(b))) : DEFAULT_BUDGET;
}

export async function handleCourtyard(env: Env, request: Request, path: string): Promise<Response | null> {
  if (!path.startsWith("/api/persona") && !path.startsWith("/api/courtyard/") && !path.startsWith("/api/territory/")) return null;
  const u: any = await currentUser(d1(env.DB), request);
  if (!u) return json({ error: "unauthorized" }, 401);
  if (u.is_guest) return json({ error: "guest_forbidden", error_he: "החצר זמינה לשחקנים רשומים." }, 403);
  const c: any = await getControls(env);
  if (c?.courtyard?.enabled === false) return json({ error: "disabled", error_he: "החצר כבויה כרגע." }, 403);
  const rl = await limited(env, request, "mutation", u);
  if (rl) return rl;
  const uid = Number(u.id);

  if (path === "/api/persona" && request.method === "GET") {
    const row: any = await env.DB.prepare("SELECT aggression, accuracy, boldness FROM user_persona WHERE user_id = ?").bind(uid).first();
    return json({ persona: row ? { aggression: Number(row.aggression), accuracy: Number(row.accuracy), boldness: Number(row.boldness) } : DEFAULT_PERSONA,
                  saved: !!row, budget: await budgetOf(env), max: 100 });
  }
  if (path === "/api/persona" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const v = validatePersona(body, await budgetOf(env));
    if (!v.ok) return json({ error: v.error, error_he: v.error_he }, 400);
    const p = v.persona;
    await env.DB.prepare(
      "INSERT INTO user_persona (user_id, aggression, accuracy, boldness, updated_at) VALUES (?,?,?,?,?)"
      + " ON CONFLICT(user_id) DO UPDATE SET aggression=excluded.aggression, accuracy=excluded.accuracy, boldness=excluded.boldness, updated_at=excluded.updated_at")
      .bind(uid, p.aggression, p.accuracy, p.boldness, nowIso()).run();
    return json({ ok: true, persona: p });
  }
  // Unranked test of my own courtyard (see how my defender behaves).
  if (path === "/api/courtyard/practice" && request.method === "POST") {
    const r = await createCourtyardMatch(env, u, uid, true);
    if (!r.ok) return json({ error: r.error, error_he: r.error_he }, r.status);
    return json({ match_id: r.match_id, status: "active" });
  }
  if (path.startsWith("/api/territory/")) return handleTerritory(env, request, path, u, c);
  return json({ error: "not_found" }, 404);
}

const MAT = ["wood", "iron", "stone"] as const;
const TIER_BY_RARITY: Record<number, string> = { 1: "easy", 2: "medium", 3: "hard", 4: "ultra" };

async function handleTerritory(env: Env, request: Request, path: string, u: any, c: any): Promise<Response> {
  const db = d1(env.DB);
  const t = cfgOf(c);
  if (!t.enabled) return json({ error: "disabled", error_he: "מלחמת הטריטוריות כבויה כרגע." }, 403);
  const uid = Number(u.id);
  if (path === "/api/territory/map" && request.method === "GET") {
    await ensureMap(db, c);
    const r: any = await db.get(
      "SELECT json_group_array(json_array(t.id,t.x,t.y,t.kind,t.rarity,t.owner_id,t.is_home,t.protected_until,n.nickname)) AS j"
      + " FROM territory_tiles t LEFT JOIN user_nicknames n ON n.user_id = t.owner_id AND n.status = 'ok'", []);
    const now = Date.now();
    const tiles = (JSON.parse(r?.j ?? "[]") as any[]).map((a) => ({
      id: a[0], x: a[1], y: a[2], kind: a[3], rarity: a[4],
      mine: a[5] === uid, owned: a[5] != null, home: !!a[6] && a[5] === uid,
      owner: a[5] == null ? null : (a[5] === uid ? "אני" : (a[8] || "שחקן " + a[5])),
      protected: !!a[7] && Date.parse(a[7]) > now,
    }));
    return json({ size: Math.max(8, Math.min(60, Math.trunc(t.map_size))), tiles });
  }
  if (path === "/api/territory/me" && request.method === "GET") {
    const home = await ensureHome(db, uid, c);
    const mats = await settle(db, uid, c);
    const mine = await ownedTiles(db, uid);
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const a: any = await db.get("SELECT COUNT(*) AS n FROM territory_battles WHERE attacker_id = ? AND created_at >= ?", [uid, since]);
    return json({ home: home ? { id: home.id, x: home.x, y: home.y } : null, tiles: mine, materials: mats,
                  attacks_today: Number(a?.n ?? 0), attacks_cap: t.daily_attack_cap, store_cap: t.store_cap,
                  cfg: { cost_per_rarity: t.attack_cost_per_rarity, grace_hours: t.grace_hours, base_yield: t.base_yield_per_hour, accrual_cap_hours: t.accrual_cap_hours } });
  }
  if (path === "/api/territory/attack" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const tileId = Math.trunc(Number(body?.tile_id));
    if (!Number.isFinite(tileId)) return json({ error: "bad_tile", error_he: "אריח לא תקין." }, 400);
    const home = await ensureHome(db, uid, c);
    if (!home) return json({ error: "map_full", error_he: "אין מקום פנוי במפה כרגע." }, 409);
    const tile: any = await db.get("SELECT * FROM territory_tiles WHERE id = ?", [tileId]);
    if (!tile) return json({ error: "no_tile", error_he: "האריח לא נמצא." }, 404);
    if (tile.owner_id === uid) return json({ error: "own_tile", error_he: "האריח כבר שלך." }, 400);
    if (tile.protected_until && Date.parse(tile.protected_until) > Date.now())
      return json({ error: "protected", error_he: "האריח מוגן בתקופת חסד אחרי כיבוש." }, 409);
    const adj: any = await db.get(
      "SELECT 1 AS ok FROM territory_tiles WHERE owner_id = ? AND ABS(x - ?) + ABS(y - ?) = 1 LIMIT 1", [uid, tile.x, tile.y]);
    if (!adj) return json({ error: "not_adjacent", error_he: "אפשר לתקוף רק אריח שצמוד לטריטוריה שלך." }, 400);
    if (tile.owner_id != null && tile.is_home) {
      const others: any = await db.get("SELECT COUNT(*) AS n FROM territory_tiles WHERE owner_id = ? AND is_home = 0", [tile.owner_id]);
      if (Number(others?.n ?? 0) > 0) return json({ error: "home_protected", error_he: "אי אפשר לתקוף בית כל עוד יש לבעלים אריחים אחרים." }, 409);
    }
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const cnt: any = await db.get("SELECT COUNT(*) AS n FROM territory_battles WHERE attacker_id = ? AND created_at >= ?", [uid, since]);
    if (Number(cnt?.n ?? 0) >= t.daily_attack_cap)
      return json({ error: "daily_cap", error_he: "הגעת למכסת ההתקפות היומית." }, 429);
    await reapDanglingBattles(db, uid);
    const stale = new Date(Date.now() - t.ongoing_battle_minutes * 60000).toISOString();
    const open: any = await db.get("SELECT id FROM territory_battles WHERE attacker_id = ? AND status = 'open' AND created_at >= ?", [uid, stale]);
    if (open) return json({ error: "battle_open", error_he: "יש לך קרב טריטוריה פתוח." }, 409);
    const cost = attackCost(tile.rarity, c);
    const mats = await settle(db, uid, c);
    for (const k of MAT) if ((mats as any)[k] < (cost as any)[k])
      return json({ error: "no_materials", error_he: "אין מספיק חומרים לתקיפה.", cost, have: mats }, 402);
    // Spend (guarded against a concurrent spend), then open the battle; refund on creation failure.
    const spent = await db.run(
      "UPDATE user_materials SET wood = wood - ?, iron = iron - ?, stone = stone - ? WHERE user_id = ? AND wood >= ? AND iron >= ? AND stone >= ?",
      [cost.wood, cost.iron, cost.stone, uid, cost.wood, cost.iron, cost.stone]);
    if (!spent.changes) return json({ error: "no_materials", error_he: "אין מספיק חומרים לתקיפה." }, 402);
    const ins: any = await env.DB.prepare(
      "INSERT INTO territory_battles (attacker_id, defender_id, tile_id, status, created_at, cost) VALUES (?,?,?, 'open', ?, ?)")
      .bind(uid, tile.owner_id ?? null, tileId, new Date().toISOString(), cost.wood).run();
    const battleId = Number(ins.meta?.last_row_id);
    const extra = { territory: { battle_id: battleId, tile_id: tileId } };
    if (tile.owner_id != null && t.live_defense !== false) {
      const liveId = await createLiveDefenseMatch(env, u, Number(tile.owner_id), extra, Number(t.live_offer_seconds));
      if (liveId) {
        await db.run("UPDATE territory_battles SET match_id = ?, live = 1 WHERE id = ?", [liveId, battleId]);
        return json({ match_id: liveId, battle_id: battleId, cost, live: true, wait_seconds: Number(t.live_offer_seconds) });
      }
    }
    const r = tile.owner_id == null
      ? await createAiMatch(env, u, TIER_BY_RARITY[tile.rarity] ?? "medium", extra)
      : await createCourtyardMatch(env, u, Number(tile.owner_id), false, extra);
    if (!r.ok) {
      await db.run("UPDATE user_materials SET wood = wood + ?, iron = iron + ?, stone = stone + ? WHERE user_id = ?", [cost.wood, cost.iron, cost.stone, uid]);
      await db.run("DELETE FROM territory_battles WHERE id = ?", [battleId]);
      return json({ error: r.error, error_he: r.error_he }, r.status);
    }
    await db.run("UPDATE territory_battles SET match_id = ? WHERE id = ?", [r.match_id, battleId]);
    return json({ match_id: r.match_id, battle_id: battleId, cost });
  }
  if (path === "/api/territory/live-fallback" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const mid = String(body?.match_id ?? "");
    const m: any = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(mid).first();
    if (!m || m.mode !== "territory" || Number(m.p1) !== uid) return json({ error: "not_found", error_he: "הקרב לא נמצא." }, 404);
    if (m.status === "active" && m.p2 != null) return json({ match_id: mid, status: "active", human: true });
    if (m.status !== "waiting" || m.p2 != null) return json({ error: "unavailable", error_he: "הקרב כבר לא ממתין." }, 409);
    const nowS = Date.now() / 1000;
    const offer: any = await env.DB.prepare("SELECT 1 AS ok FROM match_offers WHERE match_id = ? AND expires_at > ?").bind(mid, nowS).first();
    if (offer) return json({ error: "too_soon", error_he: "הבעלים עדיין מחליט.", retry_in: 3 }, 400);
    const b: any = await db.get("SELECT * FROM territory_battles WHERE match_id = ? AND attacker_id = ? AND status = 'open'", [mid, uid]);
    if (!b) return json({ error: "not_found", error_he: "הקרב לא נמצא." }, 404);
    await env.DB.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(mid).run();   // first, so cascades cannot inflate the count below
    const del = await env.DB.prepare("DELETE FROM matches WHERE id = ? AND status = 'waiting' AND p2 IS NULL").bind(mid).run();
    if (Number(del.meta?.changes ?? 0) < 1) {
      const cur: any = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(mid).first();
      if (cur && cur.status === "active") return json({ match_id: mid, status: "active", human: true });
      return json({ error: "unavailable", error_he: "הקרב כבר לא זמין." }, 409);
    }
    await env.DB.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(mid).run();
    const extra = { territory: { battle_id: Number(b.id), tile_id: Number(b.tile_id) } };
    const r = await createCourtyardMatch(env, u, Number(b.defender_id), false, extra);
    if (!r.ok) { await cancelBattle(db, Number(b.id), "cancelled"); return json({ error: r.error, error_he: r.error_he }, r.status); }
    await db.run("UPDATE territory_battles SET match_id = ?, live = 0 WHERE id = ?", [r.match_id, Number(b.id)]);
    return json({ match_id: r.match_id, status: "active", fallback: true });
  }
  return json({ error: "not_found" }, 404);
}

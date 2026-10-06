/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/** Territory war: map, lazy material economy, battles. All balance numbers come from admin controls. */
import type { Db } from "./finalize.js";
import { refundBets } from "./bets.js";

export const KINDS = ["forest", "mine", "quarry", "plains", "fortress"] as const;
export const YIELD_KIND: Record<string, "wood" | "iron" | "stone" | null> = { forest: "wood", mine: "iron", quarry: "stone", plains: null, fortress: null };
export const TERRITORY_DEFAULTS = {
  enabled: true, map_size: 20, base_yield_per_hour: 6, store_cap: 500, accrual_cap_hours: 24,
  start_grant: 60, attack_cost_per_rarity: 15, maintenance_per_extra_tile: 1,
  daily_attack_cap: 6, grace_hours: 24, ongoing_battle_minutes: 10,
  live_defense: true, live_offer_seconds: 30,
  rebellion_enabled: true, rebellion_inactive_days: 14, rebellion_max_per_run: 25,
  // Daily gift: day 1 gives gift_base, rising linearly to gift_max on day gift_streak_days, then stays.
  gift_enabled: true, gift_base: 20, gift_max: 50, gift_streak_days: 7,
  // Safety net for a poor player: below the threshold production is multiplied until the threshold is reached,
  // and once a day the missing amount is topped up to refill_target.
  safety_enabled: true, safety_threshold: 30, safety_yield_multiplier: 2,
  refill_enabled: true, refill_target: 30,
  // Total free material (gift + refill) one player may receive per material per Israel day.
  free_daily_cap: 60,
};
export function cfgOf(controls: any) { return { ...TERRITORY_DEFAULTS, ...((controls ?? {}).territory ?? {}) } as typeof TERRITORY_DEFAULTS; }
const nowIso = () => new Date().toISOString();

function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
export function tileSpec(x: number, y: number) {
  const k = hash(x, y, 1) % 100;
  const kind = k < 24 ? "forest" : k < 44 ? "mine" : k < 64 ? "quarry" : k < 94 ? "plains" : "fortress";
  const r = hash(x, y, 2) % 100;
  let rarity = r < 60 ? 1 : r < 85 ? 2 : r < 96 ? 3 : 4;
  if (kind === "fortress") rarity = Math.max(3, rarity);
  return { kind, rarity };
}
/** Idempotent: seeds the map only when empty (literal numeric values, no user input). */
export async function ensureMap(db: Db, controls: any): Promise<void> {
  const row = await db.get("SELECT COUNT(*) AS n FROM territory_tiles", []);
  if (Number(row?.n ?? 0) > 0) return;
  const n = Math.max(8, Math.min(60, Math.trunc(cfgOf(controls).map_size)));
  const rows: string[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const t = tileSpec(x, y); rows.push(`(${x},${y},'${t.kind}',${t.rarity})`);
  }
  for (let i = 0; i < rows.length; i += 80)
    await db.run("INSERT OR IGNORE INTO territory_tiles (x,y,kind,rarity) VALUES " + rows.slice(i, i + 80).join(","), []);
}
function yieldOf(kind: string, rarity: number, base: number) {
  const out = { wood: 0, iron: 0, stone: 0 };
  const mat = YIELD_KIND[kind];
  if (mat) out[mat] = base * rarity;
  else { const v = Math.round(base * rarity * (kind === "fortress" ? 0.5 : 0.33)); out.wood = out.iron = out.stone = v; }
  return out;
}
/** Lazy accrual: credit the time since last settle (capped), minus maintenance, up to the storage cap. */
export async function settle(db: Db, uid: number, controls: any): Promise<{ wood: number; iron: number; stone: number }> {
  const c = cfgOf(controls);
  let m: any = await db.get("SELECT wood, iron, stone, last_settle FROM user_materials WHERE user_id = ?", [uid]);
  const now = Date.now();
  if (!m) {
    await db.run("INSERT OR IGNORE INTO user_materials (user_id, wood, iron, stone, last_settle) VALUES (?,?,?,?,?)",
      [uid, c.start_grant, c.start_grant, c.start_grant, nowIso()]);
    return { wood: c.start_grant, iron: c.start_grant, stone: c.start_grant };
  }
  const hours = Math.max(0, Math.min(c.accrual_cap_hours, (now - Date.parse(m.last_settle)) / 3600000));
  const tiles = await allOwned(db, uid);
  const gross = { wood: 0, iron: 0, stone: 0 };
  for (const t of tiles) { const y = yieldOf(t.kind, t.rarity, c.base_yield_per_hour); gross.wood += y.wood; gross.iron += y.iron; gross.stone += y.stone; }
  const maint = Math.max(0, tiles.length - 1) * c.maintenance_per_extra_tile;
  const cap = c.store_cap;
  const grow = (have: number, g: number) => {
    const gain = Math.floor(hours * Math.max(0, g - maint));
    let add = gain;
    // Safety net: a poor player's production is multiplied only until the threshold is reached.
    if (c.safety_enabled && have < c.safety_threshold && c.safety_yield_multiplier > 1)
      add = Math.max(gain, Math.min(Math.floor(gain * c.safety_yield_multiplier), c.safety_threshold - have));
    return Math.min(Math.max(cap, have), have + add);
  };
  const next = { wood: grow(m.wood, gross.wood), iron: grow(m.iron, gross.iron), stone: grow(m.stone, gross.stone) };
  await db.run("UPDATE user_materials SET wood=?, iron=?, stone=?, last_settle=? WHERE user_id=?",
    [next.wood, next.iron, next.stone, nowIso(), uid]);
  return next;
}
async function allOwned(db: Db, uid: number): Promise<any[]> {
  // Db has only get/run; use a JSON aggregate to read many rows.
  const r = await db.get("SELECT json_group_array(json_object('id',id,'x',x,'y',y,'kind',kind,'rarity',rarity,'is_home',is_home,'protected_until',protected_until)) AS j FROM territory_tiles WHERE owner_id = ?", [uid]);
  return JSON.parse(r?.j ?? "[]");
}
export const ownedTiles = allOwned;

/** Give the player a home tile if they own nothing. Returns the tile or null if the map is full. */
export async function ensureHome(db: Db, uid: number, controls: any): Promise<any | null> {
  await ensureMap(db, controls);
  const mine = await allOwned(db, uid);
  if (mine.length) return mine.find((t) => t.is_home) ?? mine[0];
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await db.get(
      "SELECT t.id FROM territory_tiles t WHERE t.owner_id IS NULL AND t.kind = 'plains' AND t.rarity = 1 "
      + "AND NOT EXISTS (SELECT 1 FROM territory_tiles o WHERE o.owner_id IS NOT NULL AND ABS(o.x - t.x) + ABS(o.y - t.y) <= 1) "
      + "ORDER BY ((t.id * 7919 + ?) % 1009) LIMIT 1", [uid + attempt]);
    const id = r?.id ?? (await db.get("SELECT id FROM territory_tiles WHERE owner_id IS NULL AND kind != 'fortress' ORDER BY id LIMIT 1", []))?.id;
    if (id == null) return null;
    const res = await db.run("UPDATE territory_tiles SET owner_id=?, is_home=1, conquered_at=? WHERE id=? AND owner_id IS NULL", [uid, nowIso(), id]);
    if (res.changes) { await settle(db, uid, controls); return db.get("SELECT * FROM territory_tiles WHERE id = ?", [id]); }
  }
  return null;
}
export function attackCost(rarity: number, controls: any) {
  const v = cfgOf(controls).attack_cost_per_rarity * rarity;
  return { wood: v, iron: v, stone: v };
}

/** Called from finalizeMatch once for a battle match. Attacker is always p1. Idempotent. */
export async function resolveTerritoryBattle(db: Db, m: any, winnerSide: string, controls: any): Promise<void> {
  const tr = m.state?.territory;
  if (!tr?.battle_id) return;
  const b = await db.get("SELECT * FROM territory_battles WHERE id = ? AND status = 'open'", [tr.battle_id]);
  if (!b) return;
  const won = winnerSide === "p1";
  const c = cfgOf(controls);
  if (!won) {
    await db.run("UPDATE territory_battles SET status='lost', resolved_at=? WHERE id=?", [nowIso(), b.id]);
    m.state.results = { ...(m.state.results ?? {}), territory: { outcome: "lost", tile_id: b.tile_id } };
    await addEvent(db, Number(b.attacker_id), "attack_failed", Number(b.tile_id), Number(b.id), b.defender_id ?? null);
    if (b.defender_id != null) await addEvent(db, Number(b.defender_id), "defended", Number(b.tile_id), Number(b.id), Number(b.attacker_id));
    return;
  }
  const tile = await db.get("SELECT * FROM territory_tiles WHERE id = ?", [b.tile_id]);
  const prev = tile?.owner_id ?? null;
  if (prev !== null) await settle(db, Number(prev), controls);   // lock in the old owner's accrual first
  const until = new Date(Date.now() + c.grace_hours * 3600000).toISOString();
  await db.run("UPDATE territory_tiles SET owner_id=?, is_home=0, conquered_at=?, protected_until=? WHERE id=?",
    [b.attacker_id, nowIso(), until, b.tile_id]);
  await db.run("UPDATE territory_battles SET status='won', resolved_at=? WHERE id=?", [nowIso(), b.id]);
  let newHome: any = null;
  if (prev !== null) {
    const left = await db.get("SELECT COUNT(*) AS n FROM territory_tiles WHERE owner_id = ?", [prev]);
    if (Number(left?.n ?? 0) === 0) newHome = await ensureHome(db, Number(prev), controls);   // full loss: only tiles, new home
    else if (tile.is_home) await db.run("UPDATE territory_tiles SET is_home=1 WHERE id = (SELECT id FROM territory_tiles WHERE owner_id=? ORDER BY id LIMIT 1)", [prev]);
  }
  await addEvent(db, Number(b.attacker_id), "conquered", Number(b.tile_id), Number(b.id), prev !== null ? Number(prev) : null);
  if (prev !== null) await addEvent(db, Number(prev), "tile_lost", Number(b.tile_id), Number(b.id), Number(b.attacker_id));
  m.state.results = { ...(m.state.results ?? {}), territory: { outcome: "won", tile_id: b.tile_id, protected_until: until, previous_owner_new_home: newHome?.id ?? null } };
}

/** Refund and close a battle whose live wait never became a fight (cancelled, expired, or its match row vanished). */
export async function cancelBattle(db: Db, battleId: number, why: string): Promise<boolean> {
  const b: any = await db.get("SELECT * FROM territory_battles WHERE id = ? AND status = 'open'", [battleId]);
  if (!b) return false;
  const res = await db.run("UPDATE territory_battles SET status = ?, resolved_at = ? WHERE id = ? AND status = 'open'", [why, nowIso(), battleId]);
  if (!res.changes) return false;
  if (b.match_id) await refundBets(db, String(b.match_id));
  const v = Number(b.cost ?? 0);
  if (v > 0) await db.run("UPDATE user_materials SET wood = wood + ?, iron = iron + ?, stone = stone + ? WHERE user_id = ?", [v, v, v, b.attacker_id]);
  return true;
}
export async function cancelBattleForMatch(db: Db, matchId: string): Promise<void> {
  const b: any = await db.get("SELECT id FROM territory_battles WHERE match_id = ? AND status = 'open'", [matchId]);
  if (!b) return;
  const shots: any = await db.get("SELECT COUNT(*) AS n FROM match_events WHERE match_id = ? AND type = 'shot'", [matchId]);
  if (Number(shots?.n ?? 0) > 0) {   // a real fight was abandoned: the tile stays, the materials stay spent, bets are returned
    await db.run("UPDATE territory_battles SET status = 'lost', resolved_at = ? WHERE id = ? AND status = 'open'", [nowIso(), b.id]);
    await refundBets(db, matchId);
  } else await cancelBattle(db, Number(b.id), "cancelled");
}
/** Refund this attacker's open battles whose match vanished or was aborted before a result. */
export async function reapDanglingBattles(db: Db, uid: number): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const r: any = await db.get(
      "SELECT b.id, b.match_id, (SELECT 1 FROM matches m WHERE m.id = b.match_id) AS has_match FROM territory_battles b WHERE b.attacker_id = ? AND b.status = 'open'"
      + " AND ((b.live = 1 AND b.match_id IS NULL) OR (b.match_id IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = b.match_id)"
      + " OR EXISTS (SELECT 1 FROM matches m2 WHERE m2.id = b.match_id AND m2.status = 'aborted')))) LIMIT 1", [uid]);
    if (!r) return;
    if (r.has_match) await cancelBattleForMatch(db, String(r.match_id));
    else if (!(await cancelBattle(db, Number(r.id), "cancelled"))) return;
  }
}

export async function addEvent(db: Db, userId: number, kind: string, tileId: number | null, battleId: number | null, otherId: number | null): Promise<void> {
  await db.run("INSERT INTO territory_events (user_id, kind, tile_id, battle_id, other_id, created_at) VALUES (?,?,?,?,?,?)",
    [userId, kind, tileId, battleId, otherId, nowIso()]);
}

let lastRebellionRun = 0;
/** Rebellion: tiles (never homes) of owners absent for rebellion_inactive_days revert to the free bot-defended state.
 * Lazy and throttled (at most one scan per 10 min per isolate); the owner's accrual is locked in first. */
export async function applyRebellions(db: Db, controls: any): Promise<number> {
  const c = cfgOf(controls);
  if (c.rebellion_enabled === false) return 0;
  if (Date.now() - lastRebellionRun < 600000) return 0;
  lastRebellionRun = Date.now();
  const cutoff = new Date(Date.now() - c.rebellion_inactive_days * 86400000).toISOString();
  let n = 0;
  for (let i = 0; i < c.rebellion_max_per_run; i++) {
    const r: any = await db.get(
      "SELECT t.id, t.owner_id FROM territory_tiles t JOIN users u ON u.id = t.owner_id"
      + " WHERE t.is_home = 0 AND (t.protected_until IS NULL OR t.protected_until < ?)"
      + " AND (u.last_seen IS NULL OR u.last_seen < ?) LIMIT 1", [nowIso(), cutoff]);
    if (!r) break;
    await settle(db, Number(r.owner_id), controls);
    const res = await db.run("UPDATE territory_tiles SET owner_id = NULL, conquered_at = NULL, protected_until = NULL WHERE id = ? AND owner_id = ? AND is_home = 0", [r.id, r.owner_id]);
    if (!res.changes) break;
    await addEvent(db, Number(r.owner_id), "rebellion", Number(r.id), null, null);
    n++;
  }
  return n;
}


// ---- Daily gift and emergency refill (free material, capped per Israel day) ----
const MATS = ["wood", "iron", "stone"] as const;
const ilDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
export function giftAmount(streak: number, c: ReturnType<typeof cfgOf>): number {
  const days = Math.max(1, Math.trunc(c.gift_streak_days));
  const d = Math.max(1, Math.min(days, streak));
  if (days <= 1) return Math.round(c.gift_base);
  return Math.round(c.gift_base + (c.gift_max - c.gift_base) * (d - 1) / (days - 1));
}
async function econRow(db: Db, uid: number): Promise<any> {
  await db.run("INSERT OR IGNORE INTO user_econ (user_id) VALUES (?)", [uid]);
  return await db.get("SELECT * FROM user_econ WHERE user_id = ?", [uid]);
}
function capLeft(e: any, c: ReturnType<typeof cfgOf>, today: string) {
  const used = e.cap_day === today ? { wood: e.cap_wood, iron: e.cap_iron, stone: e.cap_stone } : { wood: 0, iron: 0, stone: 0 };
  return { wood: Math.max(0, c.free_daily_cap - used.wood), iron: Math.max(0, c.free_daily_cap - used.iron), stone: Math.max(0, c.free_daily_cap - used.stone), used };
}
/** Status shown on the war screen. Read-only. */
export async function econStatus(db: Db, uid: number, controls: any, mats: { wood: number; iron: number; stone: number }) {
  const c = cfgOf(controls), today = ilDay(), e = await econRow(db, uid);
  const claimedToday = e.last_claim_day === today;
  const continues = e.last_claim_day === ilDay(-1);
  const nextStreak = claimedToday ? e.streak : (continues ? e.streak + 1 : 1);
  const left = capLeft(e, c, today);
  const low = MATS.filter((k) => mats[k] < c.refill_target);
  return {
    gift: { enabled: c.gift_enabled, can_claim: c.gift_enabled && !claimedToday, streak: claimedToday ? e.streak : (continues ? e.streak : 0),
            next_streak: nextStreak, amount: giftAmount(nextStreak, c), days: c.gift_streak_days },
    refill: { enabled: c.refill_enabled, available: c.refill_enabled && e.refill_day !== today && low.length > 0, target: c.refill_target, used_today: e.refill_day === today },
    cap_left: { wood: left.wood, iron: left.iron, stone: left.stone },
  };
}
async function addCapped(db: Db, uid: number, e: any, c: ReturnType<typeof cfgOf>, today: string, want: { wood: number; iron: number; stone: number }) {
  const left = capLeft(e, c, today), got = { wood: 0, iron: 0, stone: 0 };
  for (const k of MATS) got[k] = Math.max(0, Math.min(Math.trunc(want[k]), left[k]));
  const used = left.used;
  await db.run("UPDATE user_econ SET cap_day=?, cap_wood=?, cap_iron=?, cap_stone=? WHERE user_id=?",
    [today, used.wood + got.wood, used.iron + got.iron, used.stone + got.stone, uid]);
  await db.run("UPDATE user_materials SET wood = wood + ?, iron = iron + ?, stone = stone + ? WHERE user_id = ?", [got.wood, got.iron, got.stone, uid]);
  return got;
}
export async function claimDailyGift(db: Db, uid: number, controls: any): Promise<{ ok: boolean; reason?: string; got?: any; streak?: number }> {
  const c = cfgOf(controls); if (!c.gift_enabled) return { ok: false, reason: "disabled" };
  await settle(db, uid, controls);
  const today = ilDay(), e = await econRow(db, uid);
  if (e.last_claim_day === today) return { ok: false, reason: "already" };
  const streak = e.last_claim_day === ilDay(-1) ? e.streak + 1 : 1;
  const r = await db.run("UPDATE user_econ SET last_claim_day=?, streak=? WHERE user_id=? AND (last_claim_day IS NULL OR last_claim_day <> ?)", [today, streak, uid, today]);
  if (!r.changes) return { ok: false, reason: "already" };
  const a = giftAmount(streak, c);
  const got = await addCapped(db, uid, e, c, today, { wood: a, iron: a, stone: a });
  return { ok: true, got, streak };
}
export async function claimRefill(db: Db, uid: number, controls: any): Promise<{ ok: boolean; reason?: string; got?: any }> {
  const c = cfgOf(controls); if (!c.refill_enabled) return { ok: false, reason: "disabled" };
  const mats = await settle(db, uid, controls);
  const today = ilDay(), e = await econRow(db, uid);
  if (e.refill_day === today) return { ok: false, reason: "already" };
  const want = { wood: Math.max(0, c.refill_target - mats.wood), iron: Math.max(0, c.refill_target - mats.iron), stone: Math.max(0, c.refill_target - mats.stone) };
  if (!want.wood && !want.iron && !want.stone) return { ok: false, reason: "not_needed" };
  const r = await db.run("UPDATE user_econ SET refill_day=? WHERE user_id=? AND (refill_day IS NULL OR refill_day <> ?)", [today, uid, today]);
  if (!r.changes) return { ok: false, reason: "already" };
  const got = await addCapped(db, uid, e, c, today, want);
  return { ok: true, got };
}

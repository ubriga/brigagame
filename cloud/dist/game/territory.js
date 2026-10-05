import { refundBets } from "./bets.js";
export const KINDS = ["forest", "mine", "quarry", "plains", "fortress"];
export const YIELD_KIND = { forest: "wood", mine: "iron", quarry: "stone", plains: null, fortress: null };
export const TERRITORY_DEFAULTS = {
    enabled: true, map_size: 20, base_yield_per_hour: 6, store_cap: 500, accrual_cap_hours: 24,
    start_grant: 60, attack_cost_per_rarity: 15, maintenance_per_extra_tile: 1,
    daily_attack_cap: 6, grace_hours: 24, ongoing_battle_minutes: 10,
    live_defense: true, live_offer_seconds: 30,
    rebellion_enabled: true, rebellion_inactive_days: 14, rebellion_max_per_run: 25,
};
export function cfgOf(controls) { return { ...TERRITORY_DEFAULTS, ...((controls ?? {}).territory ?? {}) }; }
const nowIso = () => new Date().toISOString();
function hash(x, y, salt) {
    let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
    h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}
export function tileSpec(x, y) {
    const k = hash(x, y, 1) % 100;
    const kind = k < 24 ? "forest" : k < 44 ? "mine" : k < 64 ? "quarry" : k < 94 ? "plains" : "fortress";
    const r = hash(x, y, 2) % 100;
    let rarity = r < 60 ? 1 : r < 85 ? 2 : r < 96 ? 3 : 4;
    if (kind === "fortress")
        rarity = Math.max(3, rarity);
    return { kind, rarity };
}
/** Idempotent: seeds the map only when empty (literal numeric values, no user input). */
export async function ensureMap(db, controls) {
    const row = await db.get("SELECT COUNT(*) AS n FROM territory_tiles", []);
    if (Number(row?.n ?? 0) > 0)
        return;
    const n = Math.max(8, Math.min(60, Math.trunc(cfgOf(controls).map_size)));
    const rows = [];
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            const t = tileSpec(x, y);
            rows.push(`(${x},${y},'${t.kind}',${t.rarity})`);
        }
    for (let i = 0; i < rows.length; i += 80)
        await db.run("INSERT OR IGNORE INTO territory_tiles (x,y,kind,rarity) VALUES " + rows.slice(i, i + 80).join(","), []);
}
function yieldOf(kind, rarity, base) {
    const out = { wood: 0, iron: 0, stone: 0 };
    const mat = YIELD_KIND[kind];
    if (mat)
        out[mat] = base * rarity;
    else {
        const v = Math.round(base * rarity * (kind === "fortress" ? 0.5 : 0.33));
        out.wood = out.iron = out.stone = v;
    }
    return out;
}
/** Lazy accrual: credit the time since last settle (capped), minus maintenance, up to the storage cap. */
export async function settle(db, uid, controls) {
    const c = cfgOf(controls);
    let m = await db.get("SELECT wood, iron, stone, last_settle FROM user_materials WHERE user_id = ?", [uid]);
    const now = Date.now();
    if (!m) {
        await db.run("INSERT OR IGNORE INTO user_materials (user_id, wood, iron, stone, last_settle) VALUES (?,?,?,?,?)", [uid, c.start_grant, c.start_grant, c.start_grant, nowIso()]);
        return { wood: c.start_grant, iron: c.start_grant, stone: c.start_grant };
    }
    const hours = Math.max(0, Math.min(c.accrual_cap_hours, (now - Date.parse(m.last_settle)) / 3600000));
    const tiles = await allOwned(db, uid);
    const gross = { wood: 0, iron: 0, stone: 0 };
    for (const t of tiles) {
        const y = yieldOf(t.kind, t.rarity, c.base_yield_per_hour);
        gross.wood += y.wood;
        gross.iron += y.iron;
        gross.stone += y.stone;
    }
    const maint = Math.max(0, tiles.length - 1) * c.maintenance_per_extra_tile;
    const cap = c.store_cap;
    const next = {
        wood: Math.min(Math.max(cap, m.wood), m.wood + Math.floor(hours * Math.max(0, gross.wood - maint))),
        iron: Math.min(Math.max(cap, m.iron), m.iron + Math.floor(hours * Math.max(0, gross.iron - maint))),
        stone: Math.min(Math.max(cap, m.stone), m.stone + Math.floor(hours * Math.max(0, gross.stone - maint))),
    };
    await db.run("UPDATE user_materials SET wood=?, iron=?, stone=?, last_settle=? WHERE user_id=?", [next.wood, next.iron, next.stone, nowIso(), uid]);
    return next;
}
async function allOwned(db, uid) {
    // Db has only get/run; use a JSON aggregate to read many rows.
    const r = await db.get("SELECT json_group_array(json_object('id',id,'x',x,'y',y,'kind',kind,'rarity',rarity,'is_home',is_home,'protected_until',protected_until)) AS j FROM territory_tiles WHERE owner_id = ?", [uid]);
    return JSON.parse(r?.j ?? "[]");
}
export const ownedTiles = allOwned;
/** Give the player a home tile if they own nothing. Returns the tile or null if the map is full. */
export async function ensureHome(db, uid, controls) {
    await ensureMap(db, controls);
    const mine = await allOwned(db, uid);
    if (mine.length)
        return mine.find((t) => t.is_home) ?? mine[0];
    for (let attempt = 0; attempt < 5; attempt++) {
        const r = await db.get("SELECT t.id FROM territory_tiles t WHERE t.owner_id IS NULL AND t.kind = 'plains' AND t.rarity = 1 "
            + "AND NOT EXISTS (SELECT 1 FROM territory_tiles o WHERE o.owner_id IS NOT NULL AND ABS(o.x - t.x) + ABS(o.y - t.y) <= 1) "
            + "ORDER BY ((t.id * 7919 + ?) % 1009) LIMIT 1", [uid + attempt]);
        const id = r?.id ?? (await db.get("SELECT id FROM territory_tiles WHERE owner_id IS NULL AND kind != 'fortress' ORDER BY id LIMIT 1", []))?.id;
        if (id == null)
            return null;
        const res = await db.run("UPDATE territory_tiles SET owner_id=?, is_home=1, conquered_at=? WHERE id=? AND owner_id IS NULL", [uid, nowIso(), id]);
        if (res.changes) {
            await settle(db, uid, controls);
            return db.get("SELECT * FROM territory_tiles WHERE id = ?", [id]);
        }
    }
    return null;
}
export function attackCost(rarity, controls) {
    const v = cfgOf(controls).attack_cost_per_rarity * rarity;
    return { wood: v, iron: v, stone: v };
}
/** Called from finalizeMatch once for a battle match. Attacker is always p1. Idempotent. */
export async function resolveTerritoryBattle(db, m, winnerSide, controls) {
    const tr = m.state?.territory;
    if (!tr?.battle_id)
        return;
    const b = await db.get("SELECT * FROM territory_battles WHERE id = ? AND status = 'open'", [tr.battle_id]);
    if (!b)
        return;
    const won = winnerSide === "p1";
    const c = cfgOf(controls);
    if (!won) {
        await db.run("UPDATE territory_battles SET status='lost', resolved_at=? WHERE id=?", [nowIso(), b.id]);
        m.state.results = { ...(m.state.results ?? {}), territory: { outcome: "lost", tile_id: b.tile_id } };
        await addEvent(db, Number(b.attacker_id), "attack_failed", Number(b.tile_id), Number(b.id), b.defender_id ?? null);
        if (b.defender_id != null)
            await addEvent(db, Number(b.defender_id), "defended", Number(b.tile_id), Number(b.id), Number(b.attacker_id));
        return;
    }
    const tile = await db.get("SELECT * FROM territory_tiles WHERE id = ?", [b.tile_id]);
    const prev = tile?.owner_id ?? null;
    if (prev !== null)
        await settle(db, Number(prev), controls); // lock in the old owner's accrual first
    const until = new Date(Date.now() + c.grace_hours * 3600000).toISOString();
    await db.run("UPDATE territory_tiles SET owner_id=?, is_home=0, conquered_at=?, protected_until=? WHERE id=?", [b.attacker_id, nowIso(), until, b.tile_id]);
    await db.run("UPDATE territory_battles SET status='won', resolved_at=? WHERE id=?", [nowIso(), b.id]);
    let newHome = null;
    if (prev !== null) {
        const left = await db.get("SELECT COUNT(*) AS n FROM territory_tiles WHERE owner_id = ?", [prev]);
        if (Number(left?.n ?? 0) === 0)
            newHome = await ensureHome(db, Number(prev), controls); // full loss: only tiles, new home
        else if (tile.is_home)
            await db.run("UPDATE territory_tiles SET is_home=1 WHERE id = (SELECT id FROM territory_tiles WHERE owner_id=? ORDER BY id LIMIT 1)", [prev]);
    }
    await addEvent(db, Number(b.attacker_id), "conquered", Number(b.tile_id), Number(b.id), prev !== null ? Number(prev) : null);
    if (prev !== null)
        await addEvent(db, Number(prev), "tile_lost", Number(b.tile_id), Number(b.id), Number(b.attacker_id));
    m.state.results = { ...(m.state.results ?? {}), territory: { outcome: "won", tile_id: b.tile_id, protected_until: until, previous_owner_new_home: newHome?.id ?? null } };
}
/** Refund and close a battle whose live wait never became a fight (cancelled, expired, or its match row vanished). */
export async function cancelBattle(db, battleId, why) {
    const b = await db.get("SELECT * FROM territory_battles WHERE id = ? AND status = 'open'", [battleId]);
    if (!b)
        return false;
    const res = await db.run("UPDATE territory_battles SET status = ?, resolved_at = ? WHERE id = ? AND status = 'open'", [why, nowIso(), battleId]);
    if (!res.changes)
        return false;
    if (b.match_id)
        await refundBets(db, String(b.match_id));
    const v = Number(b.cost ?? 0);
    if (v > 0)
        await db.run("UPDATE user_materials SET wood = wood + ?, iron = iron + ?, stone = stone + ? WHERE user_id = ?", [v, v, v, b.attacker_id]);
    return true;
}
export async function cancelBattleForMatch(db, matchId) {
    const b = await db.get("SELECT id FROM territory_battles WHERE match_id = ? AND status = 'open'", [matchId]);
    if (!b)
        return;
    const shots = await db.get("SELECT COUNT(*) AS n FROM match_events WHERE match_id = ? AND type = 'shot'", [matchId]);
    if (Number(shots?.n ?? 0) > 0) { // a real fight was abandoned: the tile stays, the materials stay spent, bets are returned
        await db.run("UPDATE territory_battles SET status = 'lost', resolved_at = ? WHERE id = ? AND status = 'open'", [nowIso(), b.id]);
        await refundBets(db, matchId);
    }
    else
        await cancelBattle(db, Number(b.id), "cancelled");
}
/** Refund this attacker's open battles whose match vanished or was aborted before a result. */
export async function reapDanglingBattles(db, uid) {
    for (let i = 0; i < 5; i++) {
        const r = await db.get("SELECT b.id, b.match_id, (SELECT 1 FROM matches m WHERE m.id = b.match_id) AS has_match FROM territory_battles b WHERE b.attacker_id = ? AND b.status = 'open'"
            + " AND ((b.live = 1 AND b.match_id IS NULL) OR (b.match_id IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = b.match_id)"
            + " OR EXISTS (SELECT 1 FROM matches m2 WHERE m2.id = b.match_id AND m2.status = 'aborted')))) LIMIT 1", [uid]);
        if (!r)
            return;
        if (r.has_match)
            await cancelBattleForMatch(db, String(r.match_id));
        else if (!(await cancelBattle(db, Number(r.id), "cancelled")))
            return;
    }
}
export async function addEvent(db, userId, kind, tileId, battleId, otherId) {
    await db.run("INSERT INTO territory_events (user_id, kind, tile_id, battle_id, other_id, created_at) VALUES (?,?,?,?,?,?)", [userId, kind, tileId, battleId, otherId, nowIso()]);
}
let lastRebellionRun = 0;
/** Rebellion: tiles (never homes) of owners absent for rebellion_inactive_days revert to the free bot-defended state.
 * Lazy and throttled (at most one scan per 10 min per isolate); the owner's accrual is locked in first. */
export async function applyRebellions(db, controls) {
    const c = cfgOf(controls);
    if (c.rebellion_enabled === false)
        return 0;
    if (Date.now() - lastRebellionRun < 600000)
        return 0;
    lastRebellionRun = Date.now();
    const cutoff = new Date(Date.now() - c.rebellion_inactive_days * 86400000).toISOString();
    let n = 0;
    for (let i = 0; i < c.rebellion_max_per_run; i++) {
        const r = await db.get("SELECT t.id, t.owner_id FROM territory_tiles t JOIN users u ON u.id = t.owner_id"
            + " WHERE t.is_home = 0 AND (t.protected_until IS NULL OR t.protected_until < ?)"
            + " AND (u.last_seen IS NULL OR u.last_seen < ?) LIMIT 1", [nowIso(), cutoff]);
        if (!r)
            break;
        await settle(db, Number(r.owner_id), controls);
        const res = await db.run("UPDATE territory_tiles SET owner_id = NULL, conquered_at = NULL, protected_until = NULL WHERE id = ? AND owner_id = ? AND is_home = 0", [r.id, r.owner_id]);
        if (!res.changes)
            break;
        await addEvent(db, Number(r.owner_id), "rebellion", Number(r.id), null, null);
        n++;
    }
    return n;
}
//# sourceMappingURL=territory.js.map
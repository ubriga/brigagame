/**
 * Brigagame 2.0 - REST API routes (Cloudflare port of app.py handlers).
 * Each handler mirrors its Python counterpart's logic, error codes, and
 * Hebrew messages 1:1. Auth is the shared Bearer session from auth.ts.
 * TODO(port): rate limiting (app.py `limited()` buckets) - the rate_limits
 * table exists in the schema; wire before public launch.
 */
import { currentUser, sha256Hex } from "../auth.js";
import { CATALOG, COATING_ORDER, COATING_NAMES } from "../game/catalog.js";
import { DAILY_BASE, DAILY_STREAK_STEP, DAILY_CAP, rankFor } from "../game/economy.js";
import { rankPayload } from "../game/ranks.js";
import { addCoins } from "../game/finalize.js";
import { d1, getControls } from "../util.js";
import { limited } from "./ratelimit.js";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
export function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
async function audit(env, request, actorId, action, targetType = "", targetId = "", details = {}) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    const ipHash = ip ? await sha256Hex(ip) : "";
    await env.DB.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-2 years')").run();
    await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, ip_hash, user_agent, created_at)"
        + " VALUES (?,?,?,?,?,?,?,?)")
        .bind(actorId, String(action).slice(0, 80), String(targetType).slice(0, 40), String(targetId).slice(0, 120), JSON.stringify(details ?? {}).slice(0, 2000), ipHash, (request.headers.get("User-Agent") ?? "").slice(0, 300), nowIso()).run();
}
async function getMaintenance(env) {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'maintenance'").first();
    if (!row)
        return { on: false, message: "" };
    try {
        const d = JSON.parse(String(row.value));
        return { on: Boolean(d.on), message: String(d.message ?? "").slice(0, 300) };
    }
    catch {
        return { on: false, message: "" };
    }
}
function publicUser(u, env) {
    return {
        id: u.id, name: u.name, picture: u.picture, coins: u.coins, rating: u.rating,
        rank: rankFor(Number(u.rating)),
        idf_rank: rankPayload(Number(u.rank_points ?? 0)),
        wins: u.wins, losses: u.losses, matches_played: u.matches_played,
        is_admin: String(u.email).toLowerCase() === String(env.ADMIN_EMAIL).toLowerCase(),
    };
}
async function inventoryOf(env, uid) {
    const rows = await env.DB.prepare("SELECT item_id, qty, level, equipped FROM user_items WHERE user_id = ?").bind(uid).all();
    const inv = {};
    for (const r of rows.results) {
        inv[r.item_id] = { qty: r.qty, level: r.level, equipped: Boolean(r.equipped) };
    }
    return inv;
}
async function effectiveCatalog(env) {
    const catalog = {};
    for (const [k, v] of Object.entries(CATALOG))
        catalog[k] = { ...v };
    const rows = await env.DB.prepare("SELECT item_id, price, available FROM cosmetic_overrides").all();
    for (const r of rows.results) {
        if (catalog[r.item_id] && catalog[r.item_id].kind === "skin") {
            catalog[r.item_id].price = r.price;
            catalog[r.item_id].available = Boolean(r.available);
        }
    }
    return catalog;
}
// ---------------------------------------------------------------- coatings
function coatingCatalog(controls) {
    const c = controls.coatings;
    const out = {};
    COATING_ORDER.forEach((m, i) => {
        out[m] = { material: m, name_he: COATING_NAMES[m], level: i + 1,
            price: Math.trunc(Number(c[`${m}_price`])),
            minutes: Number(c[`${m}_minutes`]), hp: Number(c[`${m}_hp`]) };
    });
    return out;
}
async function refreshCoatings(env, uid) {
    const now = Date.now() / 1000;
    const due = await env.DB.prepare("SELECT * FROM coating_jobs WHERE user_id = ? AND status IN ('queued','building')"
        + " AND completes_at <= ? ORDER BY completes_at, id").bind(uid, now).all();
    const catalog = coatingCatalog(await getControls(env));
    for (const job of due.results) {
        const spec = catalog[job.material];
        if (!spec)
            continue;
        await env.DB.prepare("INSERT INTO user_coatings (user_id, material, hp, max_hp, updated_at) VALUES (?,?,?,?,?)"
            + " ON CONFLICT(user_id) DO UPDATE SET material=excluded.material, hp=excluded.hp,"
            + " max_hp=excluded.max_hp, updated_at=excluded.updated_at")
            .bind(uid, job.material, spec.hp, spec.hp, nowIso()).run();
        await env.DB.prepare("UPDATE coating_jobs SET status='complete' WHERE id = ?").bind(job.id).run();
    }
    await env.DB.prepare("UPDATE coating_jobs SET status='building' WHERE user_id = ? AND status='queued' AND starts_at <= ?")
        .bind(uid, now).run();
}
async function coatingPayload(env, uid) {
    await refreshCoatings(env, uid);
    const controls = await getControls(env);
    const current = await env.DB.prepare("SELECT material, hp, max_hp, updated_at FROM user_coatings WHERE user_id = ?").bind(uid).first();
    const jobs = await env.DB.prepare("SELECT id, material, status, starts_at, completes_at FROM coating_jobs"
        + " WHERE user_id = ? AND status IN ('queued','building') ORDER BY starts_at, id").bind(uid).all();
    return { enabled: Boolean(controls.coatings.enabled), catalog: coatingCatalog(controls),
        current: current ?? null, jobs: jobs.results, server_time: Date.now() / 1000 };
}
// ---------------------------------------------------------------- expansions
async function refreshExpansions(env, uid) {
    const now = Date.now() / 1000;
    const due = await env.DB.prepare("SELECT * FROM expansion_jobs WHERE user_id=? AND status IN ('queued','building')"
        + " AND completes_at<=? ORDER BY completes_at,id").bind(uid, now).all();
    for (const job of due.results) {
        await env.DB.prepare("INSERT INTO user_expansions(user_id,extra_cubes,updated_at) VALUES(?,?,?)"
            + " ON CONFLICT(user_id) DO UPDATE SET extra_cubes=MAX(extra_cubes,excluded.extra_cubes),"
            + " updated_at=excluded.updated_at").bind(uid, job.cube_number, nowIso()).run();
        await env.DB.prepare("UPDATE expansion_jobs SET status='complete' WHERE id=?").bind(job.id).run();
    }
    await env.DB.prepare("UPDATE expansion_jobs SET status='building' WHERE user_id=? AND status='queued' AND starts_at<=?")
        .bind(uid, now).run();
}
async function expansionPayload(env, uid) {
    await refreshExpansions(env, uid);
    const c = (await getControls(env)).tower_expansion;
    const row = await env.DB.prepare("SELECT extra_cubes FROM user_expansions WHERE user_id=?").bind(uid).first();
    const jobs = await env.DB.prepare("SELECT id,cube_number,status,starts_at,completes_at FROM expansion_jobs"
        + " WHERE user_id=? AND status IN ('queued','building') ORDER BY starts_at,id").bind(uid).all();
    return { enabled: Boolean(c.enabled), extra_cubes: Math.trunc(Number(row?.extra_cubes ?? 0)),
        max_extra_cubes: Math.trunc(Number(c.max_extra_cubes)), build_minutes: Number(c.build_minutes),
        cube_price: Math.trunc(Number(c.cube_price)), cube_hp: Number(c.cube_hp),
        jobs: jobs.results, server_time: Date.now() / 1000 };
}
// ---------------------------------------------------------------- router
export async function handleApi(env, request, path) {
    const method = request.method;
    const db = d1(env.DB);
    const needAuth = async () => {
        const u = await currentUser(db, request);
        return u;
    };
    // GET /api/me
    if (path === "/api/me" && method === "GET") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const inv = await inventoryOf(env, Number(u.id));
        return json({
            user: publicUser(u, env), server_version: env.SERVER_VERSION,
            maintenance: await getMaintenance(env), inventory: inv,
            daily_available: u.last_daily !== today(),
            streak: u.streak, server_date: today(),
            coating: await coatingPayload(env, Number(u.id)),
            expansion: await expansionPayload(env, Number(u.id)),
        });
    }
    // GET /api/store
    if (path === "/api/store" && method === "GET") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_store = await limited(env, request, "store", u);
        if (rl_store)
            return rl_store;
        return json({ catalog: await effectiveCatalog(env),
            inventory: await inventoryOf(env, Number(u.id)), coins: u.coins });
    }
    // POST /api/store/buy
    if (path === "/api/store/buy" && method === "POST") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_store = await limited(env, request, "store", u);
        if (rl_store)
            return rl_store;
        if (u.suspended) {
            return json({ error: "blocked", error_he: "החשבון מושהה. פנה למנהל האתר." }, 403);
        }
        if (u.banned_until && String(u.banned_until) > nowIso()) {
            return json({ error: "blocked", error_he: `החשבון חסום עד ${u.banned_until}.` }, 403);
        }
        const body = await request.json().catch(() => ({}));
        const itemId = String(body.item_id ?? "");
        const catalog = await effectiveCatalog(env);
        const item = catalog[itemId];
        if (!item)
            return json({ error: "unknown_item" }, 400);
        if (item.available === false)
            return json({ error: "unavailable", error_he: "הפריט אינו זמין כרגע." }, 400);
        const uid = Number(u.id);
        const owned = await env.DB.prepare("SELECT * FROM user_items WHERE user_id = ? AND item_id = ?").bind(uid, itemId).first();
        if (item.kind === "skin" && owned)
            return json({ error: "already_owned", error_he: "כבר בבעלותך." }, 400);
        let price;
        if (item.kind === "upgrade") {
            const level = owned ? Number(owned.level) : 0;
            if (level >= item.max_level)
                return json({ error: "max_level", error_he: "רמה מקסימלית." }, 400);
            price = Number(item.prices[level]);
        }
        else {
            price = Number(item.price);
        }
        const cur = await env.DB.prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?").bind(price, uid, price).run();
        if (Number(cur.meta?.changes ?? 0) !== 1) {
            return json({ error: "insufficient_funds", error_he: "אין מספיק מטבעות." }, 400);
        }
        await env.DB.prepare("INSERT INTO transactions (user_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)")
            .bind(uid, -price, "purchase", itemId, nowIso()).run();
        if (item.kind === "consumable") {
            await env.DB.prepare("INSERT INTO user_items (user_id, item_id, qty) VALUES (?,?,?)"
                + " ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + ?")
                .bind(uid, itemId, item.pack_shots, item.pack_shots).run();
        }
        else if (item.kind === "upgrade") {
            await env.DB.prepare("INSERT INTO user_items (user_id, item_id, level) VALUES (?,?,1)"
                + " ON CONFLICT(user_id, item_id) DO UPDATE SET level = level + 1").bind(uid, itemId).run();
        }
        else {
            await env.DB.prepare("INSERT INTO user_items (user_id, item_id, qty) VALUES (?,?,1)")
                .bind(uid, itemId).run();
            await env.DB.prepare("UPDATE user_items SET equipped = 0 WHERE user_id = ? AND item_id LIKE 'skin_%'").bind(uid).run();
            await env.DB.prepare("UPDATE user_items SET equipped = 1 WHERE user_id = ? AND item_id = ?").bind(uid, itemId).run();
        }
        const after = await env.DB.prepare("SELECT coins FROM users WHERE id = ?").bind(uid).first();
        await audit(env, request, uid, "user.purchase", "item", itemId, { price });
        return json({ ok: true, coins: after.coins, spent: price });
    }
    // POST /api/store/equip
    if (path === "/api/store/equip" && method === "POST") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_mutation = await limited(env, request, "mutation", u);
        if (rl_mutation)
            return rl_mutation;
        const body = await request.json().catch(() => ({}));
        const itemId = String(body.item_id ?? "");
        const uid = Number(u.id);
        if (itemId === "skin_default") {
            await env.DB.prepare("UPDATE user_items SET equipped = 0 WHERE user_id = ? AND item_id LIKE 'skin_%'").bind(uid).run();
            return json({ ok: true });
        }
        const item = CATALOG[itemId];
        if (!item || item.kind !== "skin")
            return json({ error: "unknown_item" }, 400);
        const owned = await env.DB.prepare("SELECT 1 FROM user_items WHERE user_id = ? AND item_id = ?").bind(uid, itemId).first();
        if (!owned)
            return json({ error: "not_owned" }, 400);
        await env.DB.prepare("UPDATE user_items SET equipped = 0 WHERE user_id = ? AND item_id LIKE 'skin_%'").bind(uid).run();
        await env.DB.prepare("UPDATE user_items SET equipped = 1 WHERE user_id = ? AND item_id = ?").bind(uid, itemId).run();
        return json({ ok: true });
    }
    // GET /api/expansions
    if (path === "/api/expansions" && method === "GET") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        return json(await expansionPayload(env, Number(u.id)));
    }
    // POST /api/expansions/build
    if (path === "/api/expansions/build" && method === "POST") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_store = await limited(env, request, "store", u);
        if (rl_store)
            return rl_store;
        const uid = Number(u.id);
        const payload = await expansionPayload(env, uid);
        if (!payload.enabled)
            return json({ error: "disabled", error_he: "ההרחבה אינה זמינה כרגע." }, 400);
        const queued = payload.jobs.map((j) => Number(j.cube_number));
        const nextCube = Math.max(payload.extra_cubes, ...(queued.length ? queued : [0])) + 1;
        if (nextCube > payload.max_extra_cubes) {
            return json({ error: "max_level", error_he: "הגעת למגבלת ההרחבה." }, 400);
        }
        const price = payload.cube_price;
        const cur = await env.DB.prepare("UPDATE users SET coins=coins-? WHERE id=? AND coins>=?").bind(price, uid, price).run();
        if (Number(cur.meta?.changes ?? 0) !== 1) {
            return json({ error: "insufficient_funds", error_he: "אין מספיק מטבעות." }, 400);
        }
        const last = await env.DB.prepare("SELECT MAX(completes_at) end_at FROM expansion_jobs WHERE user_id=? AND status IN ('queued','building')")
            .bind(uid).first();
        const now = Date.now() / 1000;
        const starts = Math.max(now, Number(last?.end_at ?? 0));
        const completes = starts + payload.build_minutes * 60;
        await env.DB.prepare("INSERT INTO expansion_jobs(user_id,cube_number,status,starts_at,completes_at,created_at) VALUES(?,?,?,?,?,?)")
            .bind(uid, nextCube, starts <= now ? "building" : "queued", starts, completes, nowIso()).run();
        await env.DB.prepare("INSERT INTO transactions(user_id,delta,reason,ref,created_at) VALUES(?,?,?,?,?)")
            .bind(uid, -price, "tower_expansion", String(nextCube), nowIso()).run();
        await audit(env, request, uid, "user.tower_expansion", "cube", nextCube, { price, completes_at: completes });
        return json({ ok: true, ...(await expansionPayload(env, uid)) });
    }
    // GET /api/coatings
    if (path === "/api/coatings" && method === "GET") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        return json(await coatingPayload(env, Number(u.id)));
    }
    // POST /api/coatings/build
    if (path === "/api/coatings/build" && method === "POST") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_store = await limited(env, request, "store", u);
        if (rl_store)
            return rl_store;
        const uid = Number(u.id);
        const payload = await coatingPayload(env, uid);
        if (!payload.enabled)
            return json({ error: "disabled", error_he: "הבנייה אינה זמינה כרגע." }, 400);
        const body = await request.json().catch(() => ({}));
        const material = String(body.material ?? "");
        const catalog = payload.catalog;
        if (!(material in catalog))
            return json({ error: "bad_material" }, 400);
        const currentLevel = payload.current
            ? COATING_ORDER.indexOf(payload.current.material) + 1 : 0;
        const queuedLevels = payload.jobs.map((j) => COATING_ORDER.indexOf(j.material) + 1);
        const expected = Math.max(currentLevel, ...(queuedLevels.length ? queuedLevels : [0])) + 1;
        if (expected > COATING_ORDER.length || COATING_ORDER[expected - 1] !== material) {
            return json({ error: "wrong_order", error_he: "יש לבנות את החומרים לפי הסדר." }, 400);
        }
        const spec = catalog[material];
        const cur = await env.DB.prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?").bind(spec.price, uid, spec.price).run();
        if (Number(cur.meta?.changes ?? 0) !== 1) {
            return json({ error: "insufficient_funds", error_he: "אין מספיק מטבעות." }, 400);
        }
        const last = await env.DB.prepare("SELECT MAX(completes_at) end_at FROM coating_jobs WHERE user_id = ? AND status IN ('queued','building')")
            .bind(uid).first();
        const now = Date.now() / 1000;
        const starts = Math.max(now, Number(last?.end_at ?? 0));
        const completes = starts + spec.minutes * 60;
        await env.DB.prepare("INSERT INTO coating_jobs (user_id, material, status, starts_at, completes_at, created_at)"
            + " VALUES (?,?,?,?,?,?)")
            .bind(uid, material, starts <= now ? "building" : "queued", starts, completes, nowIso()).run();
        await env.DB.prepare("INSERT INTO transactions (user_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)")
            .bind(uid, -spec.price, "coating_build", material, nowIso()).run();
        await audit(env, request, uid, "user.coating_build", "material", material, { price: spec.price, completes_at: completes });
        return json({ ok: true, ...(await coatingPayload(env, uid)) });
    }
    // POST /api/daily/claim
    if (path === "/api/daily/claim" && method === "POST") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_mutation = await limited(env, request, "mutation", u);
        if (rl_mutation)
            return rl_mutation;
        const uid = Number(u.id);
        if (u.last_daily === today()) {
            return json({ error: "already_claimed", error_he: "כבר אספת היום. חזור מחר!" }, 400);
        }
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const streak = u.last_daily === yesterday ? Number(u.streak) + 1 : 1;
        const amount = Math.min(DAILY_BASE + (streak - 1) * DAILY_STREAK_STEP, DAILY_CAP);
        await env.DB.prepare("UPDATE users SET last_daily = ?, streak = ? WHERE id = ?")
            .bind(today(), streak, uid).run();
        await addCoins(db, uid, amount, "daily_bonus");
        await audit(env, request, uid, "user.daily_claim", "user", uid, { amount, streak });
        return json({ ok: true, amount, streak });
    }
    // POST /api/coupons/redeem
    if (path === "/api/coupons/redeem" && method === "POST") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_mutation = await limited(env, request, "mutation", u);
        if (rl_mutation)
            return rl_mutation;
        const body = await request.json().catch(() => ({}));
        const code = String(body.code ?? "").trim().toUpperCase();
        if (!code)
            return json({ error: "missing_code" }, 400);
        const uid = Number(u.id);
        const c = await env.DB.prepare("SELECT * FROM coupons WHERE code = ?").bind(code).first();
        if (!c)
            return json({ error: "invalid_code", error_he: "קופון לא תקין." }, 400);
        if (c.expires_at && String(c.expires_at) < nowIso()) {
            return json({ error: "expired", error_he: "הקופון פג תוקף." }, 400);
        }
        const already = await env.DB.prepare("SELECT 1 FROM coupon_redemptions WHERE code = ? AND user_id = ?").bind(code, uid).first();
        if (already)
            return json({ error: "already_redeemed", error_he: "כבר מימשת את הקופון." }, 400);
        const cur = await env.DB.prepare("UPDATE coupons SET uses = uses + 1 WHERE code = ? AND uses < max_uses").bind(code).run();
        if (Number(cur.meta?.changes ?? 0) !== 1) {
            return json({ error: "exhausted", error_he: "הקופון מוצה." }, 400);
        }
        await env.DB.prepare("INSERT INTO coupon_redemptions (code, user_id, redeemed_at) VALUES (?,?,?)")
            .bind(code, uid, nowIso()).run();
        let reward;
        if (c.kind === "coins") {
            await addCoins(db, uid, Number(c.amount), "coupon", code);
            reward = `${c.amount} מטבעות`;
        }
        else {
            const item = CATALOG[c.item_id];
            if (!item)
                return json({ error: "invalid_code" }, 400);
            const qty = Number(item.pack_shots ?? 1);
            await env.DB.prepare("INSERT INTO user_items (user_id, item_id, qty) VALUES (?,?,?)"
                + " ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + ?")
                .bind(uid, c.item_id, qty, qty).run();
            reward = item.name_he;
        }
        const after = await env.DB.prepare("SELECT coins FROM users WHERE id = ?").bind(uid).first();
        await audit(env, request, uid, "user.coupon_redeem", "coupon", code);
        return json({ ok: true, reward, coins: after.coins });
    }
    // GET /api/messages
    if (path === "/api/messages" && method === "GET") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const uid = Number(u.id);
        const rows = await env.DB.prepare("SELECT m.*, r.read_at FROM messages m LEFT JOIN message_reads r"
            + " ON r.message_id = m.id AND r.user_id = ?"
            + " WHERE m.user_id IS NULL OR m.user_id = ?"
            + " ORDER BY m.id DESC LIMIT 50").bind(uid, uid).all();
        const out = [];
        const unread = [];
        for (const r of rows.results) {
            out.push({ id: r.id, title: r.title, body: r.body,
                created_at: r.created_at, read: Boolean(r.read_at) });
            if (!r.read_at)
                unread.push(Number(r.id));
        }
        for (const mid of unread) {
            await env.DB.prepare("INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?,?,?)")
                .bind(mid, uid, nowIso()).run();
        }
        return json({ messages: out });
    }
    // POST /api/presence/ping
    if (path === "/api/presence/ping" && method === "POST") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rl_state = await limited(env, request, "state", u);
        if (rl_state)
            return rl_state;
        const uid = Number(u.id);
        await env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(nowIso(), uid).run();
        const now = Date.now() / 1000;
        const offer = await env.DB.prepare("SELECT match_id, expires_at FROM match_offers WHERE invited_user_id = ? AND expires_at > ?"
            + " ORDER BY expires_at DESC LIMIT 1").bind(uid, now).first();
        const unread = await env.DB.prepare("SELECT COUNT(*) c FROM messages m LEFT JOIN message_reads r"
            + " ON r.message_id = m.id AND r.user_id = ?"
            + " WHERE (m.user_id IS NULL OR m.user_id = ?) AND r.read_at IS NULL").bind(uid, uid).first();
        const out = { ok: true, offer: null, unread_messages: unread?.c ?? 0,
            server_version: env.SERVER_VERSION, maintenance: await getMaintenance(env) };
        if (offer) {
            out.offer = { match_id: offer.match_id, expires_in: Math.max(1, Math.trunc(offer.expires_at - now)) };
        }
        return json(out);
    }
    // GET /api/leaderboard
    if (path === "/api/leaderboard" && method === "GET") {
        const u = await needAuth();
        if (!u)
            return json({ error: "unauthorized" }, 401);
        const rows = await env.DB.prepare("SELECT id, name, picture, rating, wins, losses, rank_points FROM users"
            + " WHERE matches_played > 0"
            + " ORDER BY rank_points DESC, wins DESC, rating DESC, id ASC LIMIT 100").all();
        return json({
            leaderboard: rows.results.map((r) => ({
                id: r.id, name: r.name, picture: r.picture, rating: r.rating,
                rank: rankFor(Number(r.rating)),
                idf_rank: rankPayload(Number(r.rank_points)),
                rank_points: Math.round(Number(r.rank_points) * 10) / 10,
                wins: r.wins, losses: r.losses,
            })),
            me: u.id,
        });
    }
    return null;
}
//# sourceMappingURL=routes.js.map
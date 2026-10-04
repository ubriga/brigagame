/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/**
 * Rate limiting - port of backend/security.py (fixed-window buckets).
 * Same buckets/windows, same 429 payload. Identity = user id when authed,
 * else client IP (CF-Connecting-IP on Workers).
 *
 * Write-reduction (27.9): every bucket except "auth" is enforced per-isolate
 * in memory - no D1 reads/writes per request. The auth bucket stays D1-backed
 * so login brute-force protection is global across isolates. Per-isolate
 * enforcement can multiply the effective allowance of the other buckets by
 * the isolate count; those buckets guard comfort, not credentials.
 */
import { json } from "./routes.js";
const RATE_LIMITS = {
    auth: [10, 60],
    fire: [30, 60],
    state: [240, 60],
    store: [30, 60],
    admin: [120, 60],
    mutation: [90, 60],
    default: [300, 60],
};
// Per-isolate windows for the non-auth buckets.
const mem = new Map();
let memOps = 0;
function memRateLimit(bucket, identity, limit, window) {
    const key = `${bucket}:${identity}`;
    const now = Date.now() / 1000;
    const e = mem.get(key);
    if (!e || now - e.start > window) {
        mem.set(key, { start: now, count: 1 });
    }
    else if (e.count >= limit) {
        return false;
    }
    else {
        e.count++;
    }
    // Cheap sweep so a flood of distinct identities cannot grow the map forever.
    if (++memOps % 1000 === 0 && mem.size > 5000) {
        for (const [k, v] of mem)
            if (now - v.start > 300)
                mem.delete(k);
    }
    return true;
}
/** True if allowed under the configured limit (security.py rate_limit). */
export async function rateLimit(env, bucket, identity) {
    const [limit, window] = RATE_LIMITS[bucket] ?? RATE_LIMITS.default;
    if (bucket !== "auth")
        return memRateLimit(bucket, identity, limit, window);
    const key = `${bucket}:${identity}`;
    const now = Date.now() / 1000;
    const row = await env.DB.prepare("SELECT * FROM rate_limits WHERE key = ?").bind(key).first();
    if (!row || now - Number(row.window_start) > window) {
        await env.DB.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1)"
            + " ON CONFLICT(key) DO UPDATE SET window_start=?, count=1")
            .bind(key, now, now).run();
        return true;
    }
    if (Number(row.count) >= limit)
        return false;
    await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
    return true;
}
/** Route helper (security.py limited): 429 with the Hebrew message, else null. */
export async function limited(env, request, bucket, user) {
    const ident = user ? String(user.id)
        : (request.headers.get("CF-Connecting-IP") ?? "?");
    if (!(await rateLimit(env, bucket, ident))) {
        return json({ error: "rate_limited", error_he: "יותר מדי בקשות. נסה שוב בעוד דקה." }, 429);
    }
    return null;
}
//# sourceMappingURL=ratelimit.js.map
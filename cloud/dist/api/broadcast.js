const DEFAULT = { on: false, message: "", audience: "all", mode: "once", interval_min: 60, id: 0, start_at: 0, end_at: 0 };
export const MAX_MESSAGE = 500;
export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 1440;
export function sanitizeBroadcast(d) {
    const mode = d?.mode === "session" || d?.mode === "interval" ? d.mode : "once";
    const im = Math.trunc(Number(d?.interval_min));
    return {
        on: d?.on === true,
        message: String(d?.message ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_MESSAGE),
        audience: d?.audience === "registered" ? "registered" : "all",
        mode,
        interval_min: isFinite(im) ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, im)) : DEFAULT.interval_min,
        id: Math.max(0, Math.trunc(Number(d?.id)) || 0),
        start_at: Math.max(0, Math.trunc(Number(d?.start_at)) || 0),
        end_at: Math.max(0, Math.trunc(Number(d?.end_at)) || 0),
    };
}
// Short per-isolate cache: the presence ping reads this every ~8s per player.
// An admin save refreshes the saving isolate at once; others follow within TTL.
let _cache = null;
export const invalidateBroadcastCache = () => { _cache = null; };
export async function getBroadcastCfg(env, fresh = false) {
    if (!fresh && _cache && Date.now() - _cache.ts < 10_000)
        return _cache.v;
    let v = DEFAULT;
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'broadcast_popup'").first();
    if (row) {
        try {
            v = sanitizeBroadcast(JSON.parse(String(row.value)));
        }
        catch {
            v = DEFAULT;
        }
    }
    _cache = { ts: Date.now(), v };
    return v;
}
let _schema = null;
export function ensureBroadcastSchema(env) {
    if (!_schema) {
        _schema = env.DB.prepare("CREATE TABLE IF NOT EXISTS broadcast_seen (user_id INTEGER NOT NULL, bid INTEGER NOT NULL,"
            + " last_shown INTEGER NOT NULL, PRIMARY KEY (user_id, bid))").run()
            .then(() => undefined).catch((e) => { _schema = null; throw e; });
    }
    return _schema;
}
/** What a given player should receive on this ping, or null. */
export async function broadcastFor(env, user) {
    const cfg = await getBroadcastCfg(env);
    if (!cfg.on || !cfg.message)
        return null;
    const nowS = Date.now() / 1000;
    if ((cfg.start_at && nowS < cfg.start_at) || (cfg.end_at && nowS >= cfg.end_at))
        return null; // outside its schedule
    if (cfg.audience === "registered" && user?.is_guest)
        return { id: cfg.id, message: "", mode: cfg.mode, hidden: true };
    if (cfg.mode !== "session") {
        await ensureBroadcastSchema(env);
        const seen = await env.DB.prepare("SELECT last_shown FROM broadcast_seen WHERE user_id = ? AND bid = ?").bind(Number(user.id), cfg.id).first();
        if (seen) {
            if (cfg.mode === "once")
                return { id: cfg.id, message: "", mode: cfg.mode, hidden: true };
            if (Date.now() / 1000 - Number(seen.last_shown) < cfg.interval_min * 60)
                return { id: cfg.id, message: "", mode: cfg.mode, hidden: true };
        }
    }
    return { id: cfg.id, message: cfg.message, mode: cfg.mode };
}
/** Player closed/saw the popup: remember it so once/interval modes hold. */
export async function markBroadcastShown(env, userId, bid) {
    const cfg = await getBroadcastCfg(env);
    if (!cfg.on || bid !== cfg.id)
        return; // stale or cancelled: ignore
    await ensureBroadcastSchema(env);
    await env.DB.prepare("INSERT INTO broadcast_seen (user_id, bid, last_shown) VALUES (?,?,?)"
        + " ON CONFLICT(user_id, bid) DO UPDATE SET last_shown = excluded.last_shown")
        .bind(userId, bid, Math.trunc(Date.now() / 1000)).run();
}
//# sourceMappingURL=broadcast.js.map
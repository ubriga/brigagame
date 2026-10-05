/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/** Alliances (registered players only, off until the admin enables them). Rules: members cannot attack each other's tiles;
 * names go through the same filter as nicknames; every number comes from the admin controls. */
import { json } from "./routes.js";
import { validateNick } from "../nickname.js";
export const ALLIANCE_DEFAULTS = { enabled: true, max_members: 4, name_change_locked: true };
export function allianceCfg(controls) { return { ...ALLIANCE_DEFAULTS, ...((controls ?? {}).alliances ?? {}) }; }
const nowIso = () => new Date().toISOString();
export async function allianceOf(env, uid) {
    const r = await env.DB.prepare("SELECT alliance_id FROM alliance_members WHERE user_id = ?").bind(uid).first();
    return r ? Number(r.alliance_id) : null;
}
export async function areAllies(env, a, b) {
    const r = await env.DB.prepare("SELECT 1 AS ok FROM alliance_members x JOIN alliance_members y ON y.alliance_id = x.alliance_id WHERE x.user_id = ? AND y.user_id = ?").bind(a, b).first();
    return !!r;
}
export async function handleAlliance(env, request, path, uid, controls) {
    if (!path.startsWith("/api/territory/alliance"))
        return null;
    const cfg = allianceCfg(controls);
    if (!cfg.enabled)
        return json({ error: "disabled", error_he: "בריתות אינן זמינות כרגע.", enabled: false }, 403);
    const db = env.DB;
    const myNick = await db.prepare("SELECT nickname FROM user_nicknames WHERE user_id = ? AND status = 'ok'").bind(uid).first();
    const aid = await allianceOf(env, uid);
    if (path === "/api/territory/alliance" && request.method === "GET") {
        let alliance = null;
        if (aid) {
            const a = await db.prepare("SELECT id, name, leader_id FROM alliances WHERE id = ?").bind(aid).first();
            const mem = (await db.prepare("SELECT m.user_id, COALESCE(n.nickname,'') AS nick FROM alliance_members m LEFT JOIN user_nicknames n ON n.user_id = m.user_id AND n.status = 'ok' WHERE m.alliance_id = ? ORDER BY m.joined_at")
                .bind(aid).all()).results;
            alliance = { id: a.id, name: a.name, leader: Number(a.leader_id) === uid,
                members: mem.map(x => ({ nick: x.nick || "שחקן", leader: Number(x.user_id) === Number(a.leader_id), me: Number(x.user_id) === uid })) };
        }
        const inv = (await db.prepare("SELECT i.id, a.name FROM alliance_invites i JOIN alliances a ON a.id = i.alliance_id WHERE i.user_id = ? AND i.status = 'open' ORDER BY i.id DESC LIMIT 5")
            .bind(uid).all()).results;
        return json({ enabled: true, alliance, invites: inv, max_members: cfg.max_members, has_nick: !!myNick });
    }
    if (request.method !== "POST")
        return json({ error: "not_found" }, 404);
    const body = await request.json().catch(() => ({}));
    if (path === "/api/territory/alliance/create") {
        if (aid)
            return json({ error: "in_alliance", error_he: "אתה כבר בברית." }, 409);
        if (!myNick)
            return json({ error: "need_nick", error_he: "צריך כינוי כדי להקים ברית." }, 400);
        const nr = await db.prepare("SELECT value FROM settings WHERE key = 'nickname_cfg'").first();
        let blocked = [];
        try {
            const d = JSON.parse(String(nr?.value ?? "{}"));
            if (Array.isArray(d.blocked_words))
                blocked = d.blocked_words.map(String).slice(0, 500);
        }
        catch { /* defaults */ }
        const v = validateNick(String(body?.name ?? ""), blocked);
        if (!v.ok)
            return json({ error: v.error, error_he: v.error_he.replace("הכינוי", "שם הברית") }, 400);
        try {
            const r = await db.prepare("INSERT INTO alliances (name, name_norm, leader_id, created_at) VALUES (?,?,?,?)").bind(v.nickname, v.norm, uid, nowIso()).run();
            await db.prepare("INSERT INTO alliance_members (user_id, alliance_id, joined_at) VALUES (?,?,?)").bind(uid, Number(r.meta?.last_row_id), nowIso()).run();
        }
        catch {
            return json({ error: "name_taken", error_he: "שם הברית תפוס." }, 409);
        }
        return json({ ok: true });
    }
    if (path === "/api/territory/alliance/invite") {
        if (!aid)
            return json({ error: "no_alliance", error_he: "אתה לא בברית." }, 400);
        const a = await db.prepare("SELECT leader_id FROM alliances WHERE id = ?").bind(aid).first();
        if (Number(a?.leader_id) !== uid)
            return json({ error: "not_leader", error_he: "רק מנהיג הברית יכול להזמין." }, 403);
        const cnt = await db.prepare("SELECT COUNT(*) AS n FROM alliance_members WHERE alliance_id = ?").bind(aid).first();
        if (Number(cnt?.n ?? 0) >= cfg.max_members)
            return json({ error: "full", error_he: "הברית מלאה." }, 409);
        const nick = String(body?.nickname ?? "").trim();
        const t = await db.prepare("SELECT user_id FROM user_nicknames WHERE status = 'ok' AND nickname = ? COLLATE NOCASE").bind(nick).first();
        if (!t)
            return json({ error: "no_player", error_he: "לא נמצא שחקן עם הכינוי הזה." }, 404);
        if (Number(t.user_id) === uid)
            return json({ error: "self", error_he: "אי אפשר להזמין את עצמך." }, 400);
        if (await allianceOf(env, Number(t.user_id)))
            return json({ error: "in_alliance", error_he: "השחקן כבר בברית." }, 409);
        const dup = await db.prepare("SELECT 1 AS ok FROM alliance_invites WHERE alliance_id = ? AND user_id = ? AND status = 'open'").bind(aid, t.user_id).first();
        if (dup)
            return json({ error: "dup", error_he: "כבר שלחת הזמנה לשחקן הזה." }, 409);
        await db.prepare("INSERT INTO alliance_invites (alliance_id, user_id, created_at) VALUES (?,?,?)").bind(aid, t.user_id, nowIso()).run();
        return json({ ok: true });
    }
    if (path === "/api/territory/alliance/respond") {
        const inv = await db.prepare("SELECT * FROM alliance_invites WHERE id = ? AND user_id = ? AND status = 'open'").bind(Math.trunc(Number(body?.invite_id)), uid).first();
        if (!inv)
            return json({ error: "no_invite", error_he: "ההזמנה לא נמצאה." }, 404);
        if (body?.accept !== true) {
            await db.prepare("UPDATE alliance_invites SET status = 'declined' WHERE id = ?").bind(inv.id).run();
            return json({ ok: true });
        }
        if (aid)
            return json({ error: "in_alliance", error_he: "אתה כבר בברית." }, 409);
        const cnt = await db.prepare("SELECT COUNT(*) AS n FROM alliance_members WHERE alliance_id = ?").bind(inv.alliance_id).first();
        if (Number(cnt?.n ?? 0) >= cfg.max_members)
            return json({ error: "full", error_he: "הברית מלאה." }, 409);
        await db.prepare("INSERT INTO alliance_members (user_id, alliance_id, joined_at) VALUES (?,?,?)").bind(uid, inv.alliance_id, nowIso()).run();
        await db.prepare("UPDATE alliance_invites SET status = 'accepted' WHERE id = ?").bind(inv.id).run();
        await db.prepare("UPDATE alliance_invites SET status = 'void' WHERE user_id = ? AND status = 'open'").bind(uid).run();
        return json({ ok: true });
    }
    if (path === "/api/territory/alliance/leave") {
        if (!aid)
            return json({ error: "no_alliance", error_he: "אתה לא בברית." }, 400);
        await db.prepare("DELETE FROM alliance_members WHERE user_id = ?").bind(uid).run();
        const next = await db.prepare("SELECT user_id FROM alliance_members WHERE alliance_id = ? ORDER BY joined_at LIMIT 1").bind(aid).first();
        if (!next)
            await db.prepare("DELETE FROM alliances WHERE id = ?").bind(aid).run();
        else
            await db.prepare("UPDATE alliances SET leader_id = ? WHERE id = ? AND leader_id = ?").bind(next.user_id, aid, uid).run();
        return json({ ok: true });
    }
    return json({ error: "not_found" }, 404);
}
//# sourceMappingURL=alliance.js.map
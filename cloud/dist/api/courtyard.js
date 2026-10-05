/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/** Courtyard + persona API (registered players only; no admin surface here). */
import { currentUser } from "../auth.js";
import { d1, getControls } from "../util.js";
import { json } from "./routes.js";
import { limited } from "./ratelimit.js";
import { createCourtyardMatch } from "./matchmaking.js";
import { validatePersona, DEFAULT_PERSONA, DEFAULT_BUDGET } from "../game/persona.js";
const nowIso = () => new Date().toISOString();
async function budgetOf(env) {
    const c = await getControls(env);
    const b = Number(c?.courtyard?.persona_budget);
    return Number.isFinite(b) ? Math.max(30, Math.min(300, Math.trunc(b))) : DEFAULT_BUDGET;
}
export async function handleCourtyard(env, request, path) {
    if (!path.startsWith("/api/persona") && !path.startsWith("/api/courtyard/"))
        return null;
    const u = await currentUser(d1(env.DB), request);
    if (!u)
        return json({ error: "unauthorized" }, 401);
    if (u.is_guest)
        return json({ error: "guest_forbidden", error_he: "החצר זמינה לשחקנים רשומים." }, 403);
    const c = await getControls(env);
    if (c?.courtyard?.enabled === false)
        return json({ error: "disabled", error_he: "החצר כבויה כרגע." }, 403);
    const rl = await limited(env, request, "mutation", u);
    if (rl)
        return rl;
    const uid = Number(u.id);
    if (path === "/api/persona" && request.method === "GET") {
        const row = await env.DB.prepare("SELECT aggression, accuracy, boldness FROM user_persona WHERE user_id = ?").bind(uid).first();
        return json({ persona: row ? { aggression: Number(row.aggression), accuracy: Number(row.accuracy), boldness: Number(row.boldness) } : DEFAULT_PERSONA,
            saved: !!row, budget: await budgetOf(env), max: 100 });
    }
    if (path === "/api/persona" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const v = validatePersona(body, await budgetOf(env));
        if (!v.ok)
            return json({ error: v.error, error_he: v.error_he }, 400);
        const p = v.persona;
        await env.DB.prepare("INSERT INTO user_persona (user_id, aggression, accuracy, boldness, updated_at) VALUES (?,?,?,?,?)"
            + " ON CONFLICT(user_id) DO UPDATE SET aggression=excluded.aggression, accuracy=excluded.accuracy, boldness=excluded.boldness, updated_at=excluded.updated_at")
            .bind(uid, p.aggression, p.accuracy, p.boldness, nowIso()).run();
        return json({ ok: true, persona: p });
    }
    // Unranked test of my own courtyard (see how my defender behaves).
    if (path === "/api/courtyard/practice" && request.method === "POST") {
        const r = await createCourtyardMatch(env, u, uid, true);
        if (!r.ok)
            return json({ error: r.error, error_he: r.error_he }, r.status);
        return json({ match_id: r.match_id, status: "active" });
    }
    return json({ error: "not_found" }, 404);
}
//# sourceMappingURL=courtyard.js.map
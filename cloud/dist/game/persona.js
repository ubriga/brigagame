/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/**
 * Courtyard persona: the owner sets three sliders (aggression, accuracy, boldness, 0-100)
 * under a shared point budget. They are mapped onto the existing bot profile fields by
 * interpolating between the admin's "easy" and "expert" bot tiers. No LLM, no new engine.
 */
export const PERSONA_MAX = 100;
export const DEFAULT_BUDGET = 180;
export const DEFAULT_PERSONA = { aggression: 50, accuracy: 40, boldness: 50 };
export function validatePersona(raw, budget = DEFAULT_BUDGET) {
    const p = {};
    for (const k of ["aggression", "accuracy", "boldness"]) {
        const v = Number(raw?.[k]);
        if (!Number.isFinite(v) || v < 0 || v > PERSONA_MAX)
            return { ok: false, error: "bad_persona", error_he: "ערכי האישיות חייבים להיות בין 0 ל-100." };
        p[k] = Math.round(v);
    }
    const total = p.aggression + p.accuracy + p.boldness;
    if (total > budget)
        return { ok: false, error: "persona_budget", error_he: `סך הנקודות (${total}) חורג מהתקציב (${budget}).` };
    return { ok: true, persona: p };
}
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
/** Build an ai_profile for the courtyard defender from the owner's persona. */
export function personaToProfile(controls, persona) {
    const d = controls?.bot_difficulty ?? {};
    const e = (k, dflt) => Number(d["easy_" + k] ?? dflt);
    const x = (k, dflt) => Number(d["expert_" + k] ?? dflt);
    const agg = persona.aggression / PERSONA_MAX, acc = persona.accuracy / PERSONA_MAX, bold = persona.boldness / PERSONA_MAX;
    const L = (k, dE, dX, t) => Math.round(lerp(e(k, dE), x(k, dX), t) * 1000) / 1000;
    return {
        // accuracy: how precisely the defender aims and adapts
        angle_noise: L("angle_noise", 10, 0.35, acc), power_spread: L("power_spread", 0.12, 0.004, acc),
        wind_skill: L("wind_skill", 0.35, 1, acc), correction: L("correction", 0.25, 1, acc),
        memory: Math.round(L("memory", 1, 8, acc)),
        // aggression: how fast and how heavily it fires
        aggression: L("aggression", 0.3, 1, agg), weapon_skill: L("weapon_skill", 0.3, 1, agg),
        reaction: L("reaction", 1.8, 0.15, agg), mega_chance: L("mega_chance", 0.1, 0.9, agg),
        double_ammo: Math.round(L("double_ammo", 1, 6, agg)), homing_ammo: Math.round(L("homing_ammo", 1, 6, agg)),
        cluster_ammo: Math.round(L("cluster_ammo", 1, 6, agg)),
        // boldness: moves and takes risks (shields late) instead of turtling
        move_chance: L("move_chance", 0.25, 1, bold),
        shield_chance: Math.round(lerp(x("shield_chance", 0.9), e("shield_chance", 0.1), bold) * 1000) / 1000,
        shield_hp: Math.round(lerp(x("shield_hp", 0.75), e("shield_hp", 0.28), bold) * 1000) / 1000,
        shield_damage: Math.round(lerp(x("shield_damage", 20), e("shield_damage", 90), bold)),
    };
}
//# sourceMappingURL=persona.js.map
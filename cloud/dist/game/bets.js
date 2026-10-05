export const BETS_DEFAULTS = {
    enabled: false, min_stake: 5, max_stake: 100, max_bettors_per_match: 20, house_fee_pct: 10,
    close_after_shots: 2, daily_cap_coins: 300,
};
export function betsCfg(controls) { return { ...BETS_DEFAULTS, ...((controls ?? {}).spectator_bets ?? {}) }; }
const nowIso = () => new Date().toISOString();
async function credit(db, uid, amount, reason, ref) {
    if (amount <= 0)
        return;
    await db.run("UPDATE users SET coins = coins + ? WHERE id = ?", [amount, uid]);
    await db.run("INSERT INTO transactions (user_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)", [uid, amount, reason, ref, nowIso()]);
}
/** Refund every still-open bet of a match (void battle, draw, cancelled). Idempotent per bet. */
export async function refundBets(db, matchId) {
    for (let i = 0; i < 100; i++) {
        const b = await db.get("SELECT id, user_id, amount FROM spectator_bets WHERE match_id = ? AND status = 'open' LIMIT 1", [matchId]);
        if (!b)
            return;
        const r = await db.run("UPDATE spectator_bets SET status = 'refunded', payout = amount WHERE id = ? AND status = 'open'", [b.id]);
        if (r.changes)
            await credit(db, Number(b.user_id), Number(b.amount), "spectator_bet_refund", "bet" + b.id);
    }
}
/** Settle all open bets on a finished battle. winnerSide p1 = attacker, p2 = defender. */
export async function resolveBets(db, matchId, winnerSide, controls) {
    const c = betsCfg(controls);
    if (winnerSide !== "p1" && winnerSide !== "p2")
        return refundBets(db, matchId);
    const win = winnerSide === "p1" ? "attacker" : "defender";
    const pools = await db.get("SELECT COALESCE(SUM(CASE WHEN side = ? THEN amount END),0) AS w, COALESCE(SUM(CASE WHEN side != ? THEN amount END),0) AS l"
        + " FROM spectator_bets WHERE match_id = ? AND status = 'open'", [win, win, matchId]);
    const W = Number(pools?.w ?? 0), L = Number(pools?.l ?? 0);
    if (W === 0 || L === 0)
        return refundBets(db, matchId);
    const f0 = await db.get("SELECT fee_pct FROM spectator_bets WHERE match_id = ? LIMIT 1", [matchId]); // fee fixed when the first bet was placed
    const fee = Math.floor((W + L) * Math.max(0, Math.min(50, Number(f0?.fee_pct ?? c.house_fee_pct))) / 100);
    const distributable = W + L - fee;
    for (let i = 0; i < 100; i++) {
        const b = await db.get("SELECT id, user_id, amount, side FROM spectator_bets WHERE match_id = ? AND status = 'open' LIMIT 1", [matchId]);
        if (!b)
            return;
        if (b.side === win) {
            const pay = Math.floor(distributable * Number(b.amount) / W);
            const r = await db.run("UPDATE spectator_bets SET status = 'won', payout = ? WHERE id = ? AND status = 'open'", [pay, b.id]);
            if (r.changes)
                await credit(db, Number(b.user_id), pay, "spectator_bet_win", "bet" + b.id);
        }
        else {
            await db.run("UPDATE spectator_bets SET status = 'lost', payout = 0 WHERE id = ? AND status = 'open'", [b.id]);
        }
    }
}
//# sourceMappingURL=bets.js.map
/**
 * Brigagame 2.0 - economy rules. Faithful TypeScript port of backend/economy.py.
 * Server-authoritative: the client never sends coin amounts.
 */
export const STARTING_COINS = 200;
export const COINS_PER_WIN = 42;
export const MAX_COINS_PER_WIN = 50;
export const BOT_TIER_WIN_BONUS = { medium: 0, hard: 3, ultra: 6 };
export const MAX_WIN_RANK_BONUS = 2;
export const COINS_PER_LOSS = 20;
export const COINS_PER_DAMAGE = 0.1;
export const MAX_HIT_COINS_PER_MATCH = 40;
export const DAILY_BASE = 50;
export const DAILY_STREAK_STEP = 10;
export const DAILY_CAP = 150;
export function winRewardCoins(damageDealt, towerMaxHp, opponentRankLevel = 1, botTier) {
    let level = Math.max(1, Math.min(18, Math.trunc(opponentRankLevel || 1)));
    let destroyed = 0;
    try {
        destroyed = Math.max(0, Math.min(1, damageDealt / towerMaxHp));
    }
    catch {
        destroyed = 0;
    }
    const rankBonus = Math.min(MAX_WIN_RANK_BONUS, Math.floor((level - 1) / 6));
    const ceiling = Math.min(MAX_COINS_PER_WIN, COINS_PER_WIN + (BOT_TIER_WIN_BONUS[botTier || "medium"] ?? 0) + rankBonus);
    return Math.min(MAX_COINS_PER_WIN, Math.max(0, Math.round(ceiling * destroyed)));
}
export const ELO_K = 32;
export const START_RATING = 1000;
export const RANKS = [
    [0, "Bronze III"], [1030, "Bronze II"], [1060, "Bronze I"],
    [1100, "Silver III"], [1160, "Silver II"], [1220, "Silver I"],
    [1300, "Gold III"], [1380, "Gold II"], [1460, "Gold I"],
    [1550, "Platinum III"], [1640, "Platinum II"], [1730, "Platinum I"],
    [1850, "Diamond"], [2000, "Master"], [2200, "Grandmaster"], [2400, "Legend"],
];
export function rankFor(rating) {
    let name = RANKS[0][1];
    for (const [threshold, rname] of RANKS) {
        if (rating >= threshold)
            name = rname;
        else
            break;
    }
    return name;
}
export function eloDelta(winnerRating, loserRating) {
    const expected = 1.0 / (1.0 + Math.pow(10, (loserRating - winnerRating) / 400.0));
    return Math.max(1, Math.round(ELO_K * (1.0 - expected)));
}
export const WEAPONS = {
    standard: { damage: 34, radius: 64, cooldown: 4.0 },
    double_bomb: { damage: 34, radius: 50, cooldown: 5.0 },
    homing_missile: { damage: 55, radius: 60, cooldown: 5.0 },
    cluster_shell: { damage: 18, radius: 40, cooldown: 6.0 },
};
export function armorReduction(level) {
    return Math.max(0.7, 1.0 - 0.04 * Math.max(0, Math.min(5, level)));
}
export function hpMultiplier(level) {
    return 1.0 + 0.10 * Math.max(0, Math.min(5, level));
}
//# sourceMappingURL=economy.js.map
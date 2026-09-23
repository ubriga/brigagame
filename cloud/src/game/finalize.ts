/**
 * Brigagame 2.0 - match settlement. Faithful TypeScript port of app.py's
 * finalize_match / finalize_draw / resolve_time_limit / rank_loss_points /
 * add_coins. DB access is injected as a minimal interface so the same code
 * runs in the Worker (D1) and in tests (better-sqlite3-style fakes).
 */
import { towerHp } from "./game_logic.js";
import {
  COINS_PER_LOSS, COINS_PER_DAMAGE, MAX_HIT_COINS_PER_MATCH, MAX_COINS_PER_WIN,
  winRewardCoins, eloDelta,
} from "./economy.js";
import { MAX_LEVEL, rankPayload, rankUpInfo } from "./ranks.js";

export interface Db {
  run(sql: string, params: unknown[]): Promise<{ changes: number }>;
  get(sql: string, params: unknown[]): Promise<any | null>;
}

export const MATCH_DURATION_SECONDS = 240;

function nowIso(): string { return new Date().toISOString(); }

/** Single place where coins move; writes the ledger row too. */
export async function addCoins(db: Db, userId: number, delta: number, reason: string, ref = ""): Promise<void> {
  if (reason === "match_win") delta = Math.max(0, Math.min(MAX_COINS_PER_WIN, Math.trunc(delta)));
  await db.run("UPDATE users SET coins = coins + ? WHERE id = ?", [delta, userId]);
  await db.run("INSERT INTO transactions (user_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)",
    [userId, delta, reason, ref, nowIso()]);
}

export function rankLossPoints(currentPoints: number, versusAi = false, aiRankLevel?: number): number {
  const playerLevel = Number(rankPayload(currentPoints).level);
  const humanLoss = Math.round((0.5 + 1.7 * ((playerLevel - 1) / (MAX_LEVEL - 1))) * 10) / 10;
  if (!versusAi) return Math.min(currentPoints, humanLoss);
  const botLevel = Math.max(playerLevel, Math.min(MAX_LEVEL, Math.trunc(aiRankLevel ?? playerLevel)));
  const strongerDiscount = Math.max(0.5, 1.0 - 0.05 * (botLevel - playerLevel));
  return Math.min(currentPoints, Math.round(humanLoss * 0.5 * strongerDiscount * 10) / 10);
}

interface XpConfig { human_win: number; bot_win: number; per_damage: number; }

/** Apply server-authoritative match results and economy rules. */
export async function finalizeMatch(db: Db, m: any, winnerSide: string, xp: XpConfig): Promise<void> {
  const loserSide = winnerSide === "p1" ? "p2" : "p1";
  m.status = "finished";
  m.winner = (winnerSide === "p2" && m.p2_ai) ? null : m[winnerSide];
  m.state.winner_side = winnerSide;
  const practice = Boolean(m.p2_ai && m.state.ai_difficulty === "easy");
  const results: Record<string, any> = {};
  for (const [side, outcome] of [[winnerSide, "win"], [loserSide, "loss"]] as const) {
    const uid = m[side];
    if (uid == null || (side === "p2" && m.p2_ai)) {
      results[side] = { outcome, ai: true };
      continue;
    }
    const dmg = Number(m.state.damage_dealt[side] ?? 0);
    let hitCoins = practice ? 0 : Math.min(MAX_HIT_COINS_PER_MATCH, Math.trunc(dmg * COINS_PER_DAMAGE));
    let total: number;
    if (practice) {
      total = 0;
    } else if (outcome === "win") {
      const opponentUid = m[side === winnerSide ? loserSide : winnerSide];
      const opponent = opponentUid
        ? await db.get("SELECT rank_points FROM users WHERE id = ?", [opponentUid]) : null;
      const opponentLevel = m.p2_ai
        ? Number(m.state.ai_rank_level ?? 1)
        : Number(rankPayload(Number(opponent?.rank_points ?? 0)).level);
      const enemySide = side === winnerSide ? loserSide : winnerSide;
      total = winRewardCoins(dmg, towerHp(m.state, enemySide).max, opponentLevel, m.state.ai_tier);
      hitCoins = total;
    } else {
      total = COINS_PER_LOSS + hitCoins;
    }
    if (outcome === "win") total = Math.min(MAX_COINS_PER_WIN, total);
    await addCoins(db, uid, total, `match_${outcome}`, m.id);
    const other = m[side === winnerSide ? loserSide : winnerSide];
    const u = await db.get("SELECT rating, wins, rank_points FROM users WHERE id = ?", [uid]);
    const o = other ? await db.get("SELECT rating FROM users WHERE id = ?", [other]) : null;
    const myR = Number(u.rating), theirR = o ? Number(o.rating) : 1000;
    let delta: number, idfR: any, up: any = null, pts = 0, lossPts = 0, damageXp = 0;
    if (outcome === "win") {
      delta = practice ? 0 : eloDelta(myR, theirR);
      pts = practice ? 0 : Math.round((dmg * xp.per_damage + (m.p2_ai ? xp.bot_win : xp.human_win)) * 10) / 10;
      await db.run("UPDATE users SET rating = rating + ?, wins = wins + ?, rank_points = rank_points + ?, matches_played = matches_played + 1 WHERE id = ?",
        [delta, practice ? 0 : 1, pts, uid]);
      idfR = rankPayload(Number(u.rank_points) + pts);
      up = practice ? null : rankUpInfo(Number(u.rank_points), Number(u.rank_points) + pts);
    } else {
      delta = practice ? 0 : eloDelta(theirR, myR);
      lossPts = practice ? 0 : rankLossPoints(Number(u.rank_points), Boolean(m.p2_ai), m.state.ai_rank_level);
      damageXp = practice ? 0 : Math.round(dmg * xp.per_damage * 10) / 10;
      await db.run("UPDATE users SET rating = MAX(0, rating - ?), rank_points = MAX(0, rank_points + ? - ?), losses = losses + ?, matches_played = matches_played + 1 WHERE id = ?",
        [delta, damageXp, lossPts, practice ? 0 : 1, uid]);
      idfR = rankPayload(Math.max(0, Number(u.rank_points) + damageXp - lossPts));
    }
    results[side] = {
      outcome, coins: total, hit_coins: hitCoins,
      rating_delta: outcome === "win" ? delta : -delta, idf_rank: idfR,
    };
    if (outcome === "win") results[side].rank_points_awarded = pts;
    else { results[side].rank_points_lost = lossPts; results[side].damage_xp_awarded = damageXp; }
    if (practice) results[side].practice = true;
    if (up) results[side].rank_up = up;
  }
  m.state.results = results;
}

export function finalizeDraw(m: any, reason = "time_limit"): void {
  m.status = "finished";
  m.winner = null;
  m.state.winner_side = null;
  m.state.finish_reason = reason;
  m.state.results = {
    p1: { outcome: "draw", coins: 0, rating_delta: 0 },
    p2: { outcome: "draw", coins: 0, rating_delta: 0 },
  };
}

/**
 * Sudden death at 3 minutes, resolution at 4. In the DO the match row is
 * single-writer, so no claim UPDATE is needed (that guard exists only for
 * PythonAnywhere's concurrent polls).
 */
export async function resolveTimeLimit(db: Db, m: any, xp: XpConfig, now?: number): Promise<any[]> {
  if (!m || m.status !== "active" || !m.state.towers) return [];
  const t = now ?? Date.now() / 1000;
  const started = Number(m.state.started_at ?? t);
  const suddenAt = started + 3 * 60;
  if (t >= suddenAt && !m.state.sudden_death) {
    m.state.sudden_death = true;
    m.version += 1;
    const event = { type: "sudden_death", damage_multiplier: 2 };
    if (t < started + MATCH_DURATION_SECONDS) return [event];
  }
  if (t < started + MATCH_DURATION_SECONDS) return [];
  const hp = { p1: towerHp(m.state, "p1"), p2: towerHp(m.state, "p2") };
  const integrity = {
    p1: hp.p1.max ? hp.p1.hp / hp.p1.max : 0,
    p2: hp.p2.max ? hp.p2.hp / hp.p2.max : 0,
  };
  let event: any;
  if (Math.abs(integrity.p1 - integrity.p2) <= 1e-9) {
    finalizeDraw(m);
    event = { type: "match_end", winner_side: null, reason: "time_limit", draw: true };
  } else {
    const winner = integrity.p1 > integrity.p2 ? "p1" : "p2";
    await finalizeMatch(db, m, winner, xp);
    m.state.finish_reason = "time_limit";
    event = { type: "match_end", winner_side: winner, reason: "time_limit" };
  }
  m.state.time_limit_integrity = { p1: +integrity.p1.toFixed(6), p2: +integrity.p2.toFixed(6) };
  m.version += 1;
  return [event];
}
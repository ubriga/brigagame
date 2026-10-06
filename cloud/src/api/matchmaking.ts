/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/**
 * HvH matchmaking - port of app.py quick/friend/join/accept/decline plus the
 * offer machinery (match_offers, declines, presence-based invites) and the
 * stale-match sweep. Same consent model: offers are reservations, joining
 * happens only via /accept or /join. Hebrew messages match 1:1.
 */
import { currentUser } from "../auth.js";
import { d1, getControls, userMods } from "../util.js";
import { newState, cooldownsFromControls, applyObstacleCtx } from "../game/game_logic.js";
import { MAX_LEVEL, rankPayload } from "../game/ranks.js";
import { personaToProfile, DEFAULT_PERSONA, type Persona } from "../game/persona.js";
import { cancelBattleForMatch } from "../game/territory.js";
import { json } from "./routes.js";
import { limited } from "./ratelimit.js";
import { getGuestCfg } from "./guest.js";
import type { Env } from "../do/MatchRoom";

// config.py defaults (free tier has no task runner; API traffic carries the sweep)
const PRESENCE_WINDOW_SECONDS = 25;
const OFFER_TTL_SECONDS = 20;
const INVITE_COOLDOWN_SECONDS = 120;
const ACTIVE_MATCH_STALE_SECONDS = 5 * 60;
const WAITING_MATCH_STALE_SECONDS = 5 * 60;
const STALE_SWEEP_INTERVAL_SECONDS = 60;

export const nowIso = () => new Date().toISOString();
const newMatchId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function friendCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => FRIEND_CODE_ALPHABET[b % FRIEND_CODE_ALPHABET.length]).join("");
}

function blockedReason(u: any): string | null {
  if (u.suspended) return "החשבון מושהה. פנה למנהל האתר.";
  if (u.banned_until && String(u.banned_until) > nowIso()) return `החשבון חסום עד ${u.banned_until}.`;
  return null;
}

async function loadMatch(env: Env, id: string): Promise<any | null> {
  const m: any = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(id).first();
  if (!m) return null;
  m.state = JSON.parse(m.state || "{}");
  return m;
}

/** Atomically claim a waiting match slot; true on success (app.py parity). */
async function claimWaitingMatch(env: Env, matchId: string, userId: number): Promise<boolean> {
  const r = await env.DB.prepare(
    "UPDATE matches SET p2 = ?, status = 'active' WHERE id = ?"
    + " AND status = 'waiting' AND p1 != ? AND p2 IS NULL")
    .bind(userId, matchId, userId).run();
  return Number(r.meta?.changes ?? 0) === 1;
}

/** Expire offers; an unanswered invite counts as a pass for that match. */
async function sweepExpiredOffers(env: Env): Promise<void> {
  const now = Date.now() / 1000;
  const iso = nowIso();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO match_offer_declines (match_id, user_id, created_at)"
    + " SELECT match_id, invited_user_id, ? FROM match_offers WHERE expires_at <= ?")
    .bind(iso, now).run();
  await env.DB.prepare("DELETE FROM match_offers WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare(
    "DELETE FROM match_offer_declines WHERE created_at < datetime('now', '-1 day')").run();
}

let sweepLastRun = 0;

/** Port of app.py sweep_stale_matches (before_request housekeeping). */
export async function sweepStaleMatches(env: Env): Promise<void> {
  const now = Date.now() / 1000;
  if (now - sweepLastRun < STALE_SWEEP_INTERVAL_SECONDS) return;
  sweepLastRun = now;
  const activeCutoff = new Date((now - ACTIVE_MATCH_STALE_SECONDS) * 1000).toISOString();
  const waitingCutoff = new Date((now - WAITING_MATCH_STALE_SECONDS) * 1000).toISOString();
  let aborted = 0;
  const stale = await env.DB.prepare(
    "SELECT id FROM matches WHERE status = 'active' AND updated_at < ?").bind(activeCutoff).all();
  for (const row of stale.results as any[]) {
    const cur = await env.DB.prepare(
      "UPDATE matches SET status = 'aborted', winner = NULL,"
      + " version = version + 1, updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(nowIso(), row.id).run();
    if (Number(cur.meta?.changes ?? 0) !== 1) continue;
    const m = await loadMatch(env, row.id);
    m.state.abort_reason = "stale_inactivity";
    m.state.winner_side = null;
    m.state.results = { p1: { outcome: "void" }, p2: { outcome: "void" } };
    await env.DB.prepare("UPDATE matches SET state = ? WHERE id = ?")
      .bind(JSON.stringify(m.state), m.id).run();
    await env.DB.prepare(
      "INSERT INTO match_events (match_id, version, type, data, created_at) VALUES (?,?,?,?,?)")
      .bind(m.id, m.version, "match_abort",
        JSON.stringify({ type: "match_abort", reason: "stale_inactivity" }), nowIso()).run();
    aborted += 1;
    if (m.state?.territory) await cancelBattleForMatch(d1(env.DB), String(m.id));
  }
  await env.DB.prepare(
    "DELETE FROM match_offers WHERE match_id IN"
    + " (SELECT id FROM matches WHERE status = 'waiting' AND updated_at < ?)")
    .bind(waitingCutoff).run();
  const purgedCur = await env.DB.prepare(
    "DELETE FROM matches WHERE status = 'waiting' AND updated_at < ?").bind(waitingCutoff).run();
  const purged = Number(purgedCur.meta?.changes ?? 0);
  if (aborted || purged) {
    await env.DB.prepare(
      "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
      + " VALUES (NULL, 'stale_match_sweep', 'matches', '', ?, ?)")
      .bind(JSON.stringify({ aborted_active: aborted, purged_waiting: purged }), nowIso()).run();
  }
}

/** Offer a waiting quick match to a random present player (app.py parity). */
export async function offerToPresentPlayer(env: Env, matchId: string, ownerId: number): Promise<boolean> {
  const now = Date.now() / 1000;
  await sweepExpiredOffers(env);
  const live = await env.DB.prepare(
    "SELECT 1 FROM match_offers WHERE match_id = ? AND expires_at > ?")
    .bind(matchId, now).first();
  if (live) return false;
  const iso = nowIso();
  const presenceCutoff = new Date((now - PRESENCE_WINDOW_SECONDS) * 1000).toISOString();
  const cooldownCutoff = new Date((now - INVITE_COOLDOWN_SECONDS) * 1000).toISOString();
  const liveWaitingCutoff = new Date((now - 10) * 1000).toISOString();
  // Guests never receive ranked quick-match offers while the admin keeps
  // guest ranked play off (they can still play bot matches).
  const guestClause = (await getGuestCfg(env)).ranked_allowed ? "" : " AND u.is_guest = 0";
  const row: any = await env.DB.prepare(
    "SELECT u.id FROM users u WHERE u.id != ?"
    + " AND u.last_seen IS NOT NULL AND u.last_seen >= ?"
    + " AND u.suspended = 0"
    + guestClause
    + " AND (u.banned_until IS NULL OR u.banned_until <= ?)"
    + " AND NOT EXISTS (SELECT 1 FROM match_offers o"
    + "  WHERE o.invited_user_id = u.id AND o.expires_at > ?)"
    + " AND NOT EXISTS (SELECT 1 FROM match_offer_declines d"
    + "  WHERE d.user_id = u.id AND (d.match_id = ? OR d.created_at >= ?))"
    + " AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.status = 'active'"
    + "  AND (m.p1 = u.id OR m.p2 = u.id))"
    + " AND NOT EXISTS (SELECT 1 FROM matches m2 WHERE m2.status = 'waiting'"
    + "  AND m2.p1 = u.id AND m2.updated_at >= ?)"
    + " ORDER BY RANDOM() LIMIT 1")
    .bind(ownerId, presenceCutoff, iso, now, matchId, cooldownCutoff, liveWaitingCutoff)
    .first();
  if (!row) return false;
  try {
    await env.DB.prepare(
      "INSERT INTO match_offers (match_id, invited_user_id, expires_at, created_at)"
      + " VALUES (?,?,?,?)")
      .bind(matchId, row.id, now + OFFER_TTL_SECONDS, iso).run();
    return true;
  } catch {
    return false; // another request reserved the match first
  }
}

/** Initialize the DO for a newly active HvH match and journal match_start. */
async function activateMatch(env: Env, matchId: string): Promise<void> {
  const m = await loadMatch(env, matchId);
  const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(matchId));
  await stub.fetch("https://do/init", {
    method: "POST",
    body: JSON.stringify({
      id: m.id, mode: m.mode, status: m.status, p1: m.p1, p2: m.p2,
      p2_ai: false, state: m.state, version: m.version }),
  });
  await env.DB.prepare(
    "INSERT INTO match_events (match_id, version, type, data, created_at) VALUES (?,?,?,?,?)")
    .bind(m.id, m.version, "match_start", JSON.stringify({ type: "match_start" }), nowIso()).run();
}

function botProfile(controls: any, tier: string): any {
  const d = controls.bot_difficulty ?? {};
  const p: any = {};
  for (const key of Object.keys(d)) {
    if (key.startsWith(tier + "_")) p[key.slice(tier.length + 1)] = d[key];
  }
  return p;
}

export type AiMatchResult =
  | { ok: true; match_id: string }
  | { ok: false; error: string; error_he: string; status: number };

/** Create an active match vs the bot for `user` (port of POST /api/matches/ai;
 * shared by the lobby AI button and the quick-match bot fallback). */
/** Per-match obstacle scaling: bot tier + (for territory battles) the tile's rarity and kind. Admin-controlled. */
async function scaleObstacle(env: Env, state: any, controls: any, difficulty?: string): Promise<void> {
  const ctx: any = { difficulty };
  const tid = Number(state?.territory?.tile_id);
  if (tid) {
    const t: any = await env.DB.prepare("SELECT kind, rarity FROM territory_tiles WHERE id = ?").bind(tid).first();
    if (t) { ctx.kind = String(t.kind); ctx.rarity = Number(t.rarity); }
  }
  applyObstacleCtx(state, controls.dynamic_obstacle, ctx);
}

export async function createAiMatch(env: Env, user: any, tierRaw: string, extra?: Record<string, unknown>): Promise<AiMatchResult> {
  // app.py parity: the client sends { difficulty }; the server privately
  // maps the tier to a bot rank at or above the player's rank.
  const controls = await getControls(env);
  const botControls = (controls as any).bot_difficulty ?? {};
  const userRankLevel = Number(rankPayload(Number(user.rank_points ?? 0)).level);
  const offsets: Record<string, number> = {};
  for (const name of ["medium", "hard", "ultra", "expert"])
    offsets[name] = Number(botControls[`${name}_rank_offset`] ?? 0);
  offsets.normal = offsets.medium; offsets.ranked = offsets.medium;
  // UX onboarding (item ב): a brand-new player's first N bot matches are
  // forced to easy, which finalize.ts already treats as practice (no rating,
  // no coins) - the first game teaches instead of costing -16 rating.
  const ux = (controls as any).ux_onboarding ?? {};
  const newbieN = Math.trunc(Number(ux.newbie_easy_matches ?? 0));
  let tier = String(tierRaw ?? "medium").toLowerCase();
  if (newbieN > 0 && Number(user.matches_played ?? 0) < newbieN) tier = "easy";
  let difficulty: string, aiTier: string, aiRankLevel: number;
  if (tier === "easy") {
    difficulty = "easy"; aiTier = "easy";
    aiRankLevel = Math.min(MAX_LEVEL, userRankLevel + Number(botControls.easy_rank_offset ?? 0));
  } else if (tier in offsets) {
    difficulty = "ranked";
    aiTier = (tier === "medium" || tier === "normal" || tier === "ranked") ? "medium" : tier;
    aiRankLevel = Math.min(MAX_LEVEL, userRankLevel + offsets[tier]);
  } else {
    return { ok: false, error: "bad_difficulty", error_he: "רמת הקושי אינה תקינה.", status: 400 };
  }
  const mods = await userMods(env, Number(user.id));
  const id = newMatchId();
  const state = newState(mods, { armor: 0, hp: 0, skin: null });
  state.cooldowns = cooldownsFromControls(controls);
  state.ai_profile = botProfile(controls, aiTier);
  state.ai_difficulty = difficulty;
  state.ai_tier = aiTier;
  state.ai_rank_level = aiRankLevel;
  if (extra) Object.assign(state, extra);
  await scaleObstacle(env, state, controls, aiTier);
  // v23 item A (mirror): bot tower parity - scale the stock bot tower to
  // the tier's percentage of the player's tower max HP; mirror coating.
  const parity = (controls as any).bot_tower_parity ?? {};
  if (parity.enabled !== false) {
    let pct = Number(parity[aiTier + "_pct"] ?? 1.0);
    if (!Number.isFinite(pct)) pct = 1.0;
    pct = Math.max(0.1, Math.min(2.0, pct));
    const playerMax = Number(state.tower_max_hp?.p1 ?? 432);
    const tw = state.towers.p2;
    const cells: [number, number][] = [];
    tw.forEach((row: any[], r: number) => row.forEach((v: any, c: number) => {
      if (v !== null) cells.push([r, c]);
    }));
    if (cells.length) {
      const per = Math.round((playerMax * pct) / cells.length * 10) / 10;
      for (const [r, c] of cells) tw[r][c] = per;
      state.tower_max_hp.p2 = Math.round(per * cells.length * 10) / 10;
    }
    if (parity.match_coating !== false) {
      const p1c = state.coatings?.p1;
      if (p1c && Number(p1c.max_hp ?? 0) > 0) {
        state.coatings.p2 = { material: p1c.material, hp: Number(p1c.max_hp), max_hp: Number(p1c.max_hp) };
      }
    }
  }
  state.ready = { p1: false, p2: true }; // the bot is born ready (app.py parity)
  // UX onboarding (item ח): hold the bot's first shot for a short countdown
  // so a fresh player orients before coming under fire. Server-enforced in
  // MatchRoom.alarm; the client shows the countdown from this field.
  const holdSecs = Math.trunc(Number(ux.bot_first_shot_countdown ?? 0));
  if (holdSecs > 0) state.bot_hold_until = Math.floor(Date.now() / 1000) + holdSecs;
  state.bot_controls = controls.bot_system;
  state.bot_ammo = {
    double_bomb: Number(state.ai_profile.double_ammo ?? 0),
    homing_missile: Number(state.ai_profile.homing_ammo ?? 0),
    cluster_shell: Number(state.ai_profile.cluster_ammo ?? 0),
  };
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO matches (id, mode, status, p1, p2_ai, state, version, created_at, updated_at)"
    + " VALUES (?, 'ai', 'active', ?, 1, ?, 1, ?, ?)")
    .bind(id, Number(user.id), JSON.stringify(state), now, now).run();
  const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(id));
  await stub.fetch("https://do/init", {
    method: "POST",
    body: JSON.stringify({ id, mode: "ai", status: "active", p1: Number(user.id), p2: null, p2_ai: true, state, version: 1 }),
  });
  return { ok: true, match_id: id };
}

/** Courtyard defense: the attacker fights the owner's tower, skins and coating, steered by the owner's persona.
 * Practice mode (state.courtyard.practice) is unranked: it reuses the "easy" practice rule in finalize. */
export async function createCourtyardMatch(env: Env, attacker: any, ownerId: number, practice: boolean, extra?: Record<string, unknown>): Promise<AiMatchResult> {
  const controls = await getControls(env);
  const row: any = await env.DB.prepare(
    "SELECT aggression, accuracy, boldness FROM user_persona WHERE user_id = ?").bind(ownerId).first();
  const persona: Persona = row ? { aggression: Number(row.aggression), accuracy: Number(row.accuracy), boldness: Number(row.boldness) } : DEFAULT_PERSONA;
  const nick: any = await env.DB.prepare(
    "SELECT nickname FROM user_nicknames WHERE user_id = ? AND status = 'ok'").bind(ownerId).first();
  const id = newMatchId();
  const state = newState(await userMods(env, Number(attacker.id)), await userMods(env, ownerId));
  state.cooldowns = cooldownsFromControls(controls);
  state.ai_profile = personaToProfile(controls, persona);
  state.ai_difficulty = practice ? "easy" : "ranked";
  state.ai_tier = "courtyard";
  state.ai_rank_level = Number(rankPayload(Number(attacker.rank_points ?? 0)).level);
  state.courtyard = { owner_id: ownerId, nickname: nick ? String(nick.nickname) : "", practice, persona };
  state.ready = { p1: false, p2: true };
  if (extra) Object.assign(state, extra);
  await scaleObstacle(env, state, controls);
  state.bot_controls = controls.bot_system;
  state.bot_ammo = {
    double_bomb: Number(state.ai_profile.double_ammo ?? 0),
    homing_missile: Number(state.ai_profile.homing_ammo ?? 0),
    cluster_shell: Number(state.ai_profile.cluster_ammo ?? 0),
  };
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO matches (id, mode, status, p1, p2_ai, state, version, created_at, updated_at)"
    + " VALUES (?, 'ai', 'active', ?, 1, ?, 1, ?, ?)")
    .bind(id, Number(attacker.id), JSON.stringify(state), now, now).run();
  const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(id));
  await stub.fetch("https://do/init", {
    method: "POST",
    body: JSON.stringify({ id, mode: "ai", status: "active", p1: Number(attacker.id), p2: null, p2_ai: true, state, version: 1 }),
  });
  return { ok: true, match_id: id };
}

/** Offer a territory attack to the tile owner if they are online right now and free. Returns the waiting match id, or null. */
export async function createLiveDefenseMatch(env: Env, attacker: any, ownerId: number, extra: Record<string, unknown>, ttlSeconds: number): Promise<string | null> {
  const now = Date.now() / 1000;
  await sweepExpiredOffers(env);
  const presenceCutoff = new Date((now - PRESENCE_WINDOW_SECONDS) * 1000).toISOString();
  const owner: any = await env.DB.prepare(
    "SELECT u.id FROM users u WHERE u.id = ? AND u.is_guest = 0 AND u.suspended = 0"
    + " AND u.last_seen IS NOT NULL AND u.last_seen >= ?"
    + " AND (u.banned_until IS NULL OR u.banned_until <= ?)"
    + " AND NOT EXISTS (SELECT 1 FROM match_offers o WHERE o.invited_user_id = u.id AND o.expires_at > ?)"
    + " AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.status = 'active' AND (m.p1 = u.id OR m.p2 = u.id))")
    .bind(ownerId, presenceCutoff, nowIso(), now).first();
  if (!owner) return null;
  const id = newMatchId();
  const iso = nowIso();
  await env.DB.prepare(
    "INSERT INTO matches (id, code, mode, status, p1, state, version, created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?)")
    .bind(id, null, "territory", "waiting", Number(attacker.id), JSON.stringify({ ...extra }), iso, iso).run();
  try {
    await env.DB.prepare("INSERT INTO match_offers (match_id, invited_user_id, expires_at, created_at) VALUES (?,?,?,?)")
      .bind(id, ownerId, now + ttlSeconds, iso).run();
  } catch {
    await env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(id).run();
    return null;
  }
  return id;
}

export async function handleMatchmaking(env: Env, request: Request, path: string): Promise<Response | null> {
  const method = request.method;

  // POST /api/matches/quick
  if (path === "/api/matches/quick" && method === "POST") {
    const u = await currentUser(d1(env.DB), request);
    if (!u) return json({ error: "unauthorized" }, 401);
    const rl = await limited(env, request, "mutation", u);
    if (rl) return rl;
    const blocked = blockedReason(u);
    if (blocked) return json({ error: "blocked", error_he: blocked }, 403);
    if (u.is_guest && !(await getGuestCfg(env)).ranked_allowed)
      return json({ error: "guest_ranked_forbidden",
        error_he: "משחק מהיר לדירוג זמין לשחקנים רשומים. אפשר לשחק מול בוט, או להירשם בחינם ולשמור את כל ההתקדמות." }, 403);
    const uid = Number(u.id);
    const now = Date.now() / 1000;
    await sweepExpiredOffers(env);
    const existing: any = await env.DB.prepare(
      "SELECT match_id, expires_at FROM match_offers WHERE invited_user_id = ? AND expires_at > ?"
      + " ORDER BY expires_at DESC LIMIT 1").bind(uid, now).first();
    if (existing) {
      return json({ match_id: existing.match_id, status: "offered",
        expires_in: Math.max(1, Math.floor(existing.expires_at - now)) });
    }
    const liveAfter = new Date((now - 10) * 1000).toISOString();
    const waiting: any = await env.DB.prepare(
      "SELECT m.id FROM matches m WHERE m.mode = 'quick'"
      + " AND m.status = 'waiting' AND m.p1 != ? AND m.updated_at >= ?"
      + " AND NOT EXISTS (SELECT 1 FROM match_offers o"
      + " WHERE o.match_id = m.id AND o.expires_at > ?)"
      + " ORDER BY m.created_at LIMIT 1").bind(uid, liveAfter, now).first();
    if (waiting) {
      try {
        await env.DB.prepare(
          "INSERT INTO match_offers (match_id, invited_user_id, expires_at, created_at)"
          + " VALUES (?,?,?,?)")
          .bind(waiting.id, uid, now + 20, nowIso()).run();
        return json({ match_id: waiting.id, status: "offered", expires_in: 20 });
      } catch { /* reserved first; fall through and create instead */ }
    }
    const mid = newMatchId();
    const iso = nowIso();
    await env.DB.prepare(
      "INSERT INTO matches (id, code, mode, status, p1, state, version, created_at, updated_at)"
      + " VALUES (?,?,?,?,?,?,0,?,?)")
      .bind(mid, null, "quick", "waiting", uid, "{}", iso, iso).run();
    await offerToPresentPlayer(env, mid, uid);
    return json({ match_id: mid, status: "waiting" });
  }

  // POST /api/matches/quick/bot-fallback - the player waited wait_seconds in a
  // quick match with no human opponent and chose to switch to a bot match.
  if (path === "/api/matches/quick/bot-fallback" && method === "POST") {
    const u = await currentUser(d1(env.DB), request);
    if (!u) return json({ error: "unauthorized" }, 401);
    const rl = await limited(env, request, "mutation", u);
    if (rl) return rl;
    const blocked = blockedReason(u);
    if (blocked) return json({ error: "blocked", error_he: blocked }, 403);
    const controls = await getControls(env);
    const fb = (controls as any).bot_fallback ?? {};
    if (fb.enabled !== true)
      return json({ error: "bot_fallback_disabled", error_he: "המעבר למשחק נגד בוט כבוי כרגע." }, 403);
    const body: any = await request.json().catch(() => ({}));
    const mid = String(body.match_id ?? "");
    const uid = Number(u.id);
    const m: any = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(mid).first();
    if (!m || m.mode !== "quick" || Number(m.p1) !== uid)
      return json({ error: "not_found", error_he: "המשחק לא נמצא." }, 404);
    // A human may have joined while the offer was on screen - enter that match.
    if (m.status === "active" && m.p2 != null)
      return json({ match_id: mid, status: "active", human: true });
    if (m.status !== "waiting" || m.p2 != null)
      return json({ error: "unavailable", error_he: "המשחק כבר לא מחכה ליריב." }, 409);
    const waitSec = Math.max(5, Math.min(300, Number(fb.wait_seconds ?? 30)));
    const waitedMs = Date.now() - new Date(String(m.created_at)).getTime();
    if (waitedMs < waitSec * 1000)
      return json({ error: "too_soon", error_he: "עוד מחפשים יריב - נסה שוב בעוד כמה שניות.",
        retry_in: Math.max(1, Math.ceil((waitSec * 1000 - waitedMs) / 1000)) }, 400);
    // Atomic abandon: a concurrent accept flips the match active first and wins.
    const del = await env.DB.prepare(
      "DELETE FROM matches WHERE id = ? AND status = 'waiting' AND p2 IS NULL").bind(mid).run();
    if (Number(del.meta?.changes ?? 0) !== 1) {
      const cur: any = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(mid).first();
      if (cur && cur.status === "active" && (Number(cur.p1) === uid || Number(cur.p2) === uid))
        return json({ match_id: mid, status: "active", human: true });
      return json({ error: "unavailable", error_he: "המשחק כבר לא זמין." }, 409);
    }
    await env.DB.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(mid).run();
    const tier = ["easy", "medium", "hard", "ultra", "expert"].includes(String(fb.difficulty))
      ? String(fb.difficulty) : "medium";
    const created = await createAiMatch(env, u, tier);
    if (!created.ok)
      return json({ error: created.error, error_he: created.error_he }, created.status);
    return json({ match_id: created.match_id, status: "active", fallback: true });
  }

  // POST /api/matches/friend
  if (path === "/api/matches/friend" && method === "POST") {
    const u = await currentUser(d1(env.DB), request);
    if (!u) return json({ error: "unauthorized" }, 401);
    const rl = await limited(env, request, "mutation", u);
    if (rl) return rl;
    const blocked = blockedReason(u);
    if (blocked) return json({ error: "blocked", error_he: blocked }, 403);
    if (u.is_guest)
      return json({ error: "guest_forbidden",
        error_he: "משחקי חברים זמינים לשחקנים רשומים. נרשמים בחינם ושומרים את כל ההתקדמות." }, 403);
    const mid = newMatchId();
    const code = friendCode();
    const iso = nowIso();
    await env.DB.prepare(
      "INSERT INTO matches (id, code, mode, status, p1, state, version, created_at, updated_at)"
      + " VALUES (?,?,?,?,?,?,0,?,?)")
      .bind(mid, code, "friend", "waiting", Number(u.id), "{}", iso, iso).run();
    return json({ match_id: mid, code, status: "waiting" });
  }

  // POST /api/matches/join
  if (path === "/api/matches/join" && method === "POST") {
    const u = await currentUser(d1(env.DB), request);
    if (!u) return json({ error: "unauthorized" }, 401);
    const rl = await limited(env, request, "mutation", u);
    if (rl) return rl;
    const blocked = blockedReason(u);
    if (blocked) return json({ error: "blocked", error_he: blocked }, 403);
    if (u.is_guest)
      return json({ error: "guest_forbidden",
        error_he: "משחקי חברים זמינים לשחקנים רשומים. נרשמים בחינם ושומרים את כל ההתקדמות." }, 403);
    const body: any = await request.json().catch(() => ({}));
    const code = String(body.code ?? "").trim().toUpperCase();
    const m: any = await env.DB.prepare("SELECT id, p1 FROM matches WHERE code = ?").bind(code).first();
    if (!m) return json({ error: "not_found", error_he: "קוד לא נמצא." }, 404);
    const uid = Number(u.id);
    if (Number(m.p1) === uid) {
      return json({ error: "own_match", error_he: "זה המשחק שלך - שתף את הקוד עם חבר." }, 400);
    }
    if (!(await claimWaitingMatch(env, m.id, uid))) {
      return json({ error: "unavailable", error_he: "המשחק כבר מלא או הסתיים." }, 400);
    }
    const mm = await loadMatch(env, m.id);
    mm.state = newState(await userMods(env, Number(mm.p1)), await userMods(env, uid));
    mm.state.cooldowns = cooldownsFromControls(await getControls(env));
    mm.version = Number(mm.version) + 1;
    await env.DB.prepare("UPDATE matches SET state = ?, version = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(mm.state), mm.version, nowIso(), mm.id).run();
    await activateMatch(env, mm.id);
    return json({ match_id: mm.id, status: "active" });
  }

  const offerAction = path.match(/^\/api\/matches\/([a-z0-9]+)\/(accept|decline)$/);
  if (offerAction && method === "POST") {
    const [, mid, action] = offerAction;
    const u = await currentUser(d1(env.DB), request);
    if (!u) return json({ error: "unauthorized" }, 401);
    const rl = await limited(env, request, "mutation", u);
    if (rl) return rl;
    const uid = Number(u.id);
    const now = Date.now() / 1000;

    if (action === "decline") {
      const cur = await env.DB.prepare(
        "DELETE FROM match_offers WHERE match_id = ? AND invited_user_id = ?").bind(mid, uid).run();
      const declined = Number(cur.meta?.changes ?? 0) === 1;
      if (declined) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO match_offer_declines (match_id, user_id, created_at) VALUES (?,?,?)")
          .bind(mid, uid, nowIso()).run();
      }
      return json({ ok: true, declined });
    }

    // accept
    if (u.is_guest && !(await getGuestCfg(env)).ranked_allowed)
      return json({ error: "guest_ranked_forbidden",
        error_he: "משחק מהיר לדירוג זמין לשחקנים רשומים. אפשר לשחק מול בוט, או להירשם בחינם ולשמור את כל ההתקדמות." }, 403);
    const offer: any = await env.DB.prepare(
      "SELECT * FROM match_offers WHERE match_id = ? AND invited_user_id = ? AND expires_at > ?")
      .bind(mid, uid, now).first();
    if (!offer) {
      await env.DB.prepare(
        "DELETE FROM match_offers WHERE match_id = ? AND invited_user_id = ?").bind(mid, uid).run();
      return json({ error: "offer_expired", error_he: "ההזמנה פגה. אפשר לחפש משחק חדש." }, 410);
    }
    const m = await loadMatch(env, mid);
    if (!m || m.status !== "waiting" || m.p2 != null) {
      await env.DB.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(mid).run();
      return json({ error: "unavailable", error_he: "המשחק כבר לא זמין." }, 409);
    }
    const state = newState(await userMods(env, Number(m.p1)), await userMods(env, uid));
    state.cooldowns = cooldownsFromControls(await getControls(env));
    if (m.state?.territory) state.territory = { ...m.state.territory, live: true };   // live territory defense keeps its battle link
    if (state.territory) await scaleObstacle(env, state, await getControls(env));
    const cur = await env.DB.prepare(
      "UPDATE matches SET p2 = ?, status = 'active', state = ?,"
      + " version = version + 1, updated_at = ? WHERE id = ?"
      + " AND status = 'waiting' AND p2 IS NULL")
      .bind(uid, JSON.stringify(state), nowIso(), mid).run();
    await env.DB.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(mid).run();
    if (Number(cur.meta?.changes ?? 0) !== 1) {
      return json({ error: "unavailable", error_he: "המשחק כבר לא זמין." }, 409);
    }
    await activateMatch(env, mid);
    return json({ match_id: mid, status: "active" });
  }

  return null;
}

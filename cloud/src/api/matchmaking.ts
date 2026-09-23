/**
 * HvH matchmaking - port of app.py quick/friend/join/accept/decline plus the
 * offer machinery (match_offers, declines, presence-based invites) and the
 * stale-match sweep. Same consent model: offers are reservations, joining
 * happens only via /accept or /join. Hebrew messages match 1:1.
 */
import { currentUser } from "../auth.js";
import { d1, userMods } from "../util.js";
import { newState } from "../game/game_logic.js";
import { json } from "./routes.js";
import type { Env } from "../do/MatchRoom";

// config.py defaults (free tier has no task runner; API traffic carries the sweep)
const PRESENCE_WINDOW_SECONDS = 25;
const OFFER_TTL_SECONDS = 20;
const INVITE_COOLDOWN_SECONDS = 120;
const ACTIVE_MATCH_STALE_SECONDS = 5 * 60;
const WAITING_MATCH_STALE_SECONDS = 5 * 60;
const STALE_SWEEP_INTERVAL_SECONDS = 60;

const nowIso = () => new Date().toISOString();
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
async function offerToPresentPlayer(env: Env, matchId: string, ownerId: number): Promise<boolean> {
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
  const row: any = await env.DB.prepare(
    "SELECT u.id FROM users u WHERE u.id != ?"
    + " AND u.last_seen IS NOT NULL AND u.last_seen >= ?"
    + " AND u.suspended = 0"
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

export async function handleMatchmaking(env: Env, request: Request, path: string): Promise<Response | null> {
  const method = request.method;

  // POST /api/matches/quick
  if (path === "/api/matches/quick" && method === "POST") {
    const u = await currentUser(d1(env.DB), request);
    if (!u) return json({ error: "unauthorized" }, 401);
    const blocked = blockedReason(u);
    if (blocked) return json({ error: "blocked", error_he: blocked }, 403);
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

  // POST /api/matches/friend
  if (path === "/api/matches/friend" && method === "POST") {
    const u = await currentUser(d1(env.DB), request);
    if (!u) return json({ error: "unauthorized" }, 401);
    const blocked = blockedReason(u);
    if (blocked) return json({ error: "blocked", error_he: blocked }, 403);
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
    const blocked = blockedReason(u);
    if (blocked) return json({ error: "blocked", error_he: blocked }, 403);
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

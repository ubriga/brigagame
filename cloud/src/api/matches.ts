/**
 * Match REST routes: state snapshot (with incremental events), ready, leave.
 * Port of app.py match_state / match_ready / match_leave. The MatchRoom DO
 * owns live state; D1 holds the checkpoint + event journal.
 */
import { currentUser } from "../auth.js";
import { handleMatchmaking, sweepStaleMatches } from "./matchmaking.js";
import { d1, getControls } from "../util.js";
import { towerHp, obstacleAt } from "../game/game_logic.js";
import { rankFor } from "../game/economy.js";
import { rankPayload, rankForLevel } from "../game/ranks.js";
import { CATALOG, DEFAULT_SKIN } from "../game/catalog.js";
import { MATCH_DURATION_SECONDS } from "../game/finalize.js";
import { json } from "./routes.js";
import type { Env } from "../do/MatchRoom";

function sideFor(m: any, userId: number): string | null {
  if (Number(m.p1) === userId) return "p1";
  if (m.p2 != null && Number(m.p2) === userId) return "p2";
  return null;
}

async function effectiveCatalogMap(env: Env): Promise<Record<string, any>> {
  const catalog: Record<string, any> = {};
  for (const [k, v] of Object.entries(CATALOG)) catalog[k] = { ...(v as any) };
  const rows = await env.DB.prepare("SELECT item_id, price, available FROM cosmetic_overrides").all();
  for (const r of rows.results as any[]) {
    if (catalog[r.item_id] && catalog[r.item_id].kind === "skin") {
      catalog[r.item_id].price = r.price;
      catalog[r.item_id].available = Boolean(r.available);
    }
  }
  return catalog;
}

function skinStyle(catalog: Record<string, any>, skinId: string | null): any {
  const item = (skinId && catalog[skinId]) || DEFAULT_SKIN;
  return { colors: (item as any).colors, ...((item as any).style ?? {}) };
}

async function doFetch(env: Env, matchId: string, path: string, init?: RequestInit): Promise<any> {
  const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(matchId));
  const res = await stub.fetch(`https://do${path}`, init);
  return res.json();
}

/** Port of app.py match_snapshot. */
async function matchSnapshot(env: Env, m: any, userId: number, since: number): Promise<any> {
  const state = m.state;
  const rows = await env.DB.prepare(
    "SELECT version, data FROM match_events WHERE match_id = ? AND version > ? ORDER BY version, id")
    .bind(m.id, since).all();
  const events = (rows.results as any[]).map((r) => JSON.parse(r.data));
  const players: Record<string, any> = {};
  for (const side of ["p1", "p2"]) {
    const uid = m[side];
    if (uid != null) {
      const u: any = await env.DB.prepare(
        "SELECT id, name, picture, rating, wins, rank_points FROM users WHERE id = ?").bind(uid).first();
      players[side] = u
        ? { id: u.id, name: u.name, picture: u.picture, rating: u.rating,
            rank: rankFor(Number(u.rating)), idf_rank: rankPayload(Number(u.rank_points)) }
        : { id: uid, name: "שחקן לשעבר", picture: "", rating: null, rank: null, idf_rank: null };
    } else if (side === "p2" && m.p2_ai) {
      const botRank = state.ai_rank_level ? rankForLevel(Number(state.ai_rank_level)) : null;
      players[side] = { id: null, name: "OrelAI Bot", picture: "", rating: null,
        rank: botRank ? botRank.abbr_he : "AI", idf_rank: botRank };
    }
  }
  const side = sideFor(m, userId);
  const catalog = await effectiveCatalogMap(env);
  const mods = state.mods ?? {};
  const towers = state.towers ?? null;
  const towerDims: Record<string, any> = {};
  if (towers) {
    for (const s of ["p1", "p2"]) {
      if (towers[s]) towerDims[s] = { rows: towers[s].length, cols: (towers[s][0] ?? []).length };
    }
  }
  return {
    id: m.id, code: m.code ?? null, mode: m.mode, status: m.status, version: m.version,
    you: side, players,
    towers: state.towers ?? null,
    tower_x: state.tower_x ?? null,
    tower_dims: towerDims,
    tower_hp: towers ? { p1: towerHp(state, "p1"), p2: towerHp(state, "p2") } : null,
    wind: state.wind ?? null,
    map: state.map ?? "valley",
    obstacle: obstacleAt(state),
    sudden_death: Boolean(state.sudden_death),
    turn_deadline: ((state.last_turn_at ?? {})[side!] ?? 0) + 10,
    moves_left: (state.moves_left ?? {})[side!] ?? 0,
    abilities: (state.abilities ?? {})[side!] ?? {},
    shield: state.shield ?? {},
    damage_dealt: state.damage_dealt ?? null,
    coatings: state.coatings ?? {},
    skins: {
      p1: skinStyle(catalog, mods.p1?.skin ?? null),
      p2: skinStyle(catalog, mods.p2?.skin ?? null),
    },
    last_shot_at: state.last_shot_at ?? null,
    winner_side: state.winner_side ?? null,
    results: state.results ?? null,
    finish_reason: state.finish_reason ?? null,
    time_limit_integrity: state.time_limit_integrity ?? null,
    match_ends_at: m.status === "active" ? Number(state.started_at ?? 0) + MATCH_DURATION_SECONDS : null,
    ready: state.ready ?? {},
    ai_difficulty: state.ai_difficulty ?? null,
    ai_tier: state.ai_tier ?? null,
    ai_rank_level: state.ai_rank_level ?? null,
    bot_ammo: m.p2_ai ? (state.bot_ammo ?? null) : null,
    bot_tactics: m.p2_ai ? (state.bot_tactics ?? null) : null,
    practice: Boolean(m.p2_ai && state.ai_difficulty === "easy"),
    server_time: Date.now() / 1000,
    events,
  };
}

export async function handleMatchApi(env: Env, request: Request, path: string): Promise<Response | null> {
  // quick/friend/join/accept/decline (app.py matchmaking parity)
  const mmRes = await handleMatchmaking(env, request, path);
  if (mmRes) return mmRes;
  await sweepStaleMatches(env);
  const mm = path.match(/^\/api\/matches\/([a-z0-9]+)\/(state|ready|leave|fire|move|shield)$/);
  if (!mm) return null;
  const [, matchId, action] = mm;
  const user = await currentUser(d1(env.DB), request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const uid = Number(user.id);

  // Authoritative live state comes from the DO; fall back to the D1
  // checkpoint when the DO has no in-memory copy (e.g. after eviction
  // of a finished match).
  const row: any = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const live: any = await doFetch(env, matchId, "/snapshot");
  const m: any = (live && live.id)
    ? { ...row, status: live.status, version: live.version, state: live.state }
    : { ...row, state: JSON.parse(row.state || "{}") };
  if (sideFor(m, uid) === null) return json({ error: "not_found" }, 404);

  if (action === "state" && request.method === "GET") {
    const url = new URL(request.url);
    const sinceRaw = url.searchParams.get("since") ?? "0";
    const since = Number.parseInt(sinceRaw, 10);
    if (!Number.isFinite(since) || since < 0) return json({ error: "bad_since" }, 400);
    return json(await matchSnapshot(env, m, uid, since));
  }

  if (action === "ready" && request.method === "POST") {
    if (m.status !== "active") return json({ error: "not_found" }, 404);
    const out = await doFetch(env, matchId, "/ready", {
      method: "POST", body: JSON.stringify({ userId: uid }) });
    return json(out, (out as any)?.error ? 404 : 200);
  }

  if ((action === "fire" || action === "move" || action === "shield") && request.method === "POST") {
    if (m.status !== "active") return json({ error: "not_active", error_he: "המשחק לא פעיל." }, 400);
    if (action === "fire") {
      if (user.suspended) {
        return json({ error: "blocked", error_he: "החשבון מושהה. פנה למנהל האתר." }, 403);
      }
      if (user.banned_until && String(user.banned_until) > new Date().toISOString()) {
        return json({ error: "blocked", error_he: `החשבון חסום עד ${user.banned_until}.` }, 403);
      }
      const bodyText = await request.text();
      let body: any = {};
      try { body = JSON.parse(bodyText || "{}"); } catch { body = {}; }
      const angle = Number(body.angle), power = Number(body.power);
      if (!Number.isFinite(angle) || !Number.isFinite(power)) {
        return json({ error: "bad_params" }, 400);
      }
      const weapon = String(body.weapon ?? "standard");
      if (!["standard", "double_bomb", "homing_missile", "cluster_shell"].includes(weapon)) {
        return json({ error: "bad_weapon" }, 400);
      }
      const out = await doFetch(env, matchId, "/fire", {
        method: "POST", body: JSON.stringify({ userId: uid, angle, power, weapon, mega: Boolean(body.mega) }) });
      if ((out as any)?.error) return json(out, Number((out as any).status) || 400);
      const after = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first();
      const snapMatch = { ...(after as any), state: JSON.parse(String((after as any).state || "{}")) };
      return json(await matchSnapshot(env, snapMatch, uid, Number((out as any).prevVersion)));
    }
    const actionBody: any = await request.json().catch(() => ({}));
    const out = await doFetch(env, matchId, "/" + action, {
      method: "POST", body: JSON.stringify({ ...(actionBody ?? {}), userId: uid }) });
    if ((out as any)?.error) return json(out, 400);
    const after = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first();
    const snapMatch = { ...(after as any), state: JSON.parse(String((after as any).state || "{}")) };
    return json(await matchSnapshot(env, snapMatch, uid, Number((out as any).prevVersion)));
  }

  if (action === "leave" && request.method === "POST") {
    const out = await doFetch(env, matchId, "/leave", {
      method: "POST", body: JSON.stringify({ userId: uid }) });
    return json(out);
  }

  return json({ error: "method_not_allowed" }, 405);
}
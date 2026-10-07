/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/**
 * Match REST routes: state snapshot (with incremental events), ready, leave.
 * Port of app.py match_state / match_ready / match_leave. The MatchRoom DO
 * owns live state; D1 holds the checkpoint + event journal.
 */
import { combatSnapshot } from "../game/snapshot.js";
import { shownName } from "../nickname.js";
import { currentUser } from "../auth.js";
import { handleMatchmaking, sweepStaleMatches, offerToPresentPlayer, nowIso } from "./matchmaking.js";
import { limited } from "./ratelimit.js";
import { d1, getControls } from "../util.js";
import { resolvePractice } from "../game/finalize.js";
import { reapDanglingBattles } from "../game/territory.js";
import { towerHp, obstacleAt, cooldownFor, shotClockFor, turnDeadline } from "../game/game_logic.js";
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

const metadataCache=new Map<string,{at:number,players:any,skins:any}>();
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
  // Latency: events, both player lookups and the catalog are independent.
  const userQ = (uid: any) => uid != null
    ? env.DB.prepare(
        "SELECT id, name, is_guest, picture, (SELECT nickname FROM user_nicknames WHERE user_id = users.id AND status = 'ok') AS nick, rating, wins, rank_points FROM users WHERE id = ?").bind(uid).first()
    : null;
  const cacheKey=String(m.id)+":"+String(m.p1)+":"+String(m.p2)+":"+JSON.stringify(state.mods??{});
  const cached=metadataCache.get(cacheKey);
  const valid=cached && Date.now()-cached.at<30000;
  const [rows, u1, u2, catalog, controls]: any[] = await Promise.all([
    env.DB.prepare(
      "SELECT version, data FROM match_events WHERE match_id = ? AND version > ? ORDER BY version, id")
      .bind(m.id, since).all(),
    valid?null:userQ(m.p1),valid?null:userQ(m.p2),valid?null:effectiveCatalogMap(env),getControls(env),
  ]);
  const events = (rows.results as any[]).map((r) => JSON.parse(r.data));
  const players: Record<string, any> = {};
  for (const [side, u] of [["p1", u1], ["p2", u2]] as const) {
    const uid = m[side];
    if (uid != null) {
      players[side] = u
        ? { id: u.id, name: shownName(u), picture: u.is_guest ? u.picture : "", rating: u.rating,
            rank: rankFor(Number(u.rating)), idf_rank: rankPayload(Number(u.rank_points)) }
        : { id: uid, name: "שחקן לשעבר", picture: "", rating: null, rank: null, idf_rank: null };
    } else if (side === "p2" && m.p2_ai) {
      const botRank = state.ai_rank_level ? rankForLevel(Number(state.ai_rank_level)) : null;
      players[side] = { id: null, name: state.courtyard ? `חצר של ${state.courtyard.nickname || "שחקן"}` : "OrelAI Bot", picture: "", rating: null,
        rank: botRank ? botRank.abbr_he : "AI", idf_rank: botRank };
    }
  }
  const side = sideFor(m, userId);
  const mods = state.mods ?? {};
  const towers = state.towers ?? null;
  const towerDims: Record<string, any> = {};
  if (towers) {
    for (const s of ["p1", "p2"]) {
      if (towers[s]) towerDims[s] = { rows: towers[s].length, cols: (towers[s][0] ?? []).length };
    }
  }
  const skins=valid?cached!.skins:{p1:skinStyle(catalog,mods.p1?.skin??null),p2:skinStyle(catalog,mods.p2?.skin??null)};
  if(!valid){if(metadataCache.size>128)metadataCache.clear();metadataCache.set(cacheKey,{at:Date.now(),players,skins});}
  return {
    id: m.id, code: m.code ?? null, mode: m.mode, status: m.status, version: m.version,
    you: side, players:valid?cached!.players:players,
    metadata_version:cacheKey,
    territory: state.territory ? { live: Boolean(state.territory.live) } : null,
    towers: state.towers ?? null,
    tower_x: state.tower_x ?? null,
    tower_dims: towerDims,
    tower_hp: towers ? { p1: towerHp(state, "p1"), p2: towerHp(state, "p2") } : null,
    wind: state.wind ?? null,
    map: state.map ?? "valley",
    obstacle: obstacleAt(state),
    sudden_death: Boolean(state.sudden_death),
    turn_deadline: turnDeadline(state, side!),
    reload_until: state.reload_until ?? {},
    cooldowns: { standard: cooldownFor("standard", state), double_bomb: cooldownFor("double_bomb", state), homing_missile: cooldownFor("homing_missile", state), cluster_shell: cooldownFor("cluster_shell", state), piercing_shell: cooldownFor("piercing_shell", state), emp_shell: cooldownFor("emp_shell", state) },
    moves_left: (state.moves_left ?? {})[side!] ?? 0,
    abilities: (state.abilities ?? {})[side!] ?? {},
    shield: state.shield ?? {},
    aim_guide_active: Boolean(state.aim_guide_active?.[side!]),
    aim_guide_uses: Number(state.aim_guide_uses?.[side!] ?? 0),
    emp_disabled_until: state.emp_disabled_until ?? {},
    emp_immune_until: state.emp_immune_until ?? {},
    damage_dealt: state.damage_dealt ?? null,
    coatings: state.coatings ?? {},
    skins,
    last_shot_at: state.last_shot_at ?? null,
    winner_side: state.winner_side ?? null,
    results: state.results ?? null,
    finish_reason: state.finish_reason ?? null,
    time_limit_integrity: state.time_limit_integrity ?? null,
    match_ends_at: m.status === "active" ? Number(state.started_at ?? 0) + MATCH_DURATION_SECONDS : null,
    ready: state.ready ?? {},
    ai_difficulty: state.ai_difficulty ?? null,
    bot_hold_until: state.bot_hold_until ?? null,
    ai_tier: state.ai_tier ?? null,
    ai_rank_level: state.ai_rank_level ?? null,
    bot_ammo: m.p2_ai ? (state.bot_ammo ?? null) : null,
    bot_tactics: m.p2_ai ? (state.bot_tactics ?? null) : null,
    practice: resolvePractice(m, state, controls),
    server_time: Date.now() / 1000,
    ...combatSnapshot(m, side!),
    events,
  };
}

export async function handleMatchApi(env: Env, request: Request, path: string): Promise<Response | null> {
  // quick/friend/join/accept/decline (app.py matchmaking parity)
  const mmRes = await handleMatchmaking(env, request, path);
  if (mmRes) return mmRes;
  await sweepStaleMatches(env);
  const mm = path.match(/^\/api\/matches\/([a-z0-9]+)\/(state|ready|leave|fire|move|shield|guide)$/);
  if (!mm) return null;
  const [, matchId, action] = mm;
  const user = await currentUser(d1(env.DB), request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const uid = Number(user.id);
  // app.py limiter parity: state->state, fire->fire, ready/leave->mutation (move/shield unlimited there)
  const rlBucket = action === "state" ? "state" : action === "fire" ? "fire"
    : (action === "ready" || action === "leave" || action === "guide") ? "mutation" : null;
  // Latency: these three are independent once auth resolved - one round.
  const [rl, row, live]: any[] = await Promise.all([
    rlBucket && action!=="fire" ? limited(env, request, rlBucket, user) : null,
    env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first(),
    doFetch(env, matchId, "/snapshot"),
  ]);
  if (rl) return rl;
  if (!row) return json({ error: "not_found" }, 404);
  const m: any = (live && live.id)
    ? { ...row, status: live.status, version: live.version, state: live.state }
    : { ...row, state: JSON.parse(row.state || "{}") };
  if (sideFor(m, uid) === null) return json({ error: "not_found" }, 404);
  if(action==="fire"){const rlFire=await limited(env,request,m.state.combat_policy?.reload_enabled===false?"fire_fast":"fire",user);if(rlFire)return rlFire;}

  // app.py poll parity: a waiting match stays alive only while its owner
  // actively polls; quick-match owners keep inviting present players.
  // Write-reduction (27.9): the keepalive touch persists at most once per
  // 60s - the stale sweeper purges waiting matches only after 5 minutes
  // (WAITING_MATCH_STALE_SECONDS), so a 60s-fresh timestamp is always
  // comfortably alive. Owners poll every ~1-3s, cutting these writes ~97%.
  if (action === "state" && m.status === "waiting") {
    const touchedAt = row.updated_at ? Date.parse(row.updated_at) / 1000 : 0;
    if (Date.now() / 1000 - touchedAt > 60) {
      await env.DB.prepare("UPDATE matches SET updated_at = ? WHERE id = ?")
        .bind(nowIso(), matchId).run();
    }
    if (m.mode === "quick") await offerToPresentPlayer(env, matchId, uid);
  }

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

  if ((action === "fire" || action === "move" || action === "shield" || action === "guide") && request.method === "POST") {
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
      if (!["standard", "double_bomb", "homing_missile", "cluster_shell", "piercing_shell", "emp_shell"].includes(weapon)) {
        return json({ error: "bad_weapon" }, 400);
      }
      const out = await doFetch(env, matchId, "/fire", {
        method: "POST", body: JSON.stringify({ userId: uid, angle, power, weapon, mega: Boolean(body.mega), command_id: String(body.command_id ?? "").slice(0,100) }) });
      if ((out as any)?.error) return json(out, Number((out as any).status) || 400);
      if ((out as any).ack) return json(out);
      // The DO returns the post-shot state directly - saves a D1 re-read.
      const snapMatch = { ...row, state: (out as any).state, status: (out as any).status,
        version: (out as any).version };
      return json(await matchSnapshot(env, snapMatch, uid, Number((out as any).prevVersion)));
    }
    const actionBody: any = await request.json().catch(() => ({}));
    const out = await doFetch(env, matchId, "/" + action, {
      method: "POST", body: JSON.stringify({ ...(actionBody ?? {}), userId: uid }) });
    if ((out as any)?.error) return json(out, 400);
    const snapMatch = { ...row, state: (out as any).state, status: (out as any).status,
      version: (out as any).version };
    return json(await matchSnapshot(env, snapMatch, uid, Number((out as any).prevVersion)));
  }

  if (action === "leave" && request.method === "POST") {
    // app.py parity: leaving a waiting room deletes it outright (the DO only
    // hosts active matches, so a waiting match is a D1-only row).
    if (m.status === "waiting" && Number(m.p1) === uid) {
      await env.DB.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(matchId).run();
      await env.DB.prepare(
        "DELETE FROM matches WHERE id = ? AND status = 'waiting' AND p2 IS NULL").bind(matchId).run();
      if (m.mode === "territory") await reapDanglingBattles(d1(env.DB), uid);
      return json({ ok: true });
    }
    const out = await doFetch(env, matchId, "/leave", {
      method: "POST", body: JSON.stringify({ userId: uid }) });
    if (m.mode === "territory") {
      const owner: any = await env.DB.prepare("SELECT attacker_id FROM territory_battles WHERE match_id = ?").bind(matchId).first();
      if (owner) await reapDanglingBattles(d1(env.DB), Number(owner.attacker_id));
    }
    return json(out);
  }

  return json({ error: "method_not_allowed" }, 405);
}
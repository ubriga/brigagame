/**
 * Brigagame 2.0 - Cloudflare Worker entry.
 * Routes API requests, upgrades match WebSockets to the MatchRoom DO,
 * serves the static PWA via Workers assets. Parallel copy of the PA
 * backend; the PythonAnywhere game stays untouched until cutover.
 */
import { MatchRoom, type Env } from "./do/MatchRoom";
import { newState } from "./game/game_logic.js";
import { verifyGoogleCredential, getOrCreateUser, createSession, destroySession, currentUser, sha256Hex } from "./auth.js";
import { handleApi } from "./api/routes.js";
import { limited } from "./api/ratelimit.js";
import { handleMatchApi } from "./api/matches.js";
import { handleAdminApi } from "./api/admin.js";
import { d1, getControls, userMods } from "./util.js";
import { MAX_LEVEL, rankPayload } from "./game/ranks.js";

export { MatchRoom };

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function matchId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}



function botProfile(controls: any, tier: string): any {
  const d = controls.bot_difficulty;
  const p: any = {};
  for (const key of Object.keys(d)) {
    if (key.startsWith(tier + "_")) p[key.slice(tier.length + 1)] = d[key];
  }
  return p;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/auth/google" && request.method === "POST") {
      const rlAuth = await limited(env, request, "auth", null);
      if (rlAuth) return rlAuth;
      const body: any = await request.json().catch(() => ({}));
      const credential = String(body.credential ?? "");
      try {
        const id = await verifyGoogleCredential(credential, (env as any).GOOGLE_CLIENT_ID ?? "");
        const user = await getOrCreateUser(d1(env.DB), id.email, id.name, id.picture);
        const token = await createSession(d1(env.DB), Number(user.id));
        return json({ token, user });
      } catch (e) {
        return json({ error: "invalid_google_credential" }, 401);
      }
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      const auth = request.headers.get("authorization") ?? "";
      if (auth.startsWith("Bearer ")) await destroySession(d1(env.DB), auth.slice(7).trim());
      return json({ ok: true });
    }

    if (path === "/api/health") {
      return json({ ok: true, runtime: "cloudflare-workers", version: env.SERVER_VERSION });
    }

    // Match WebSocket: /api/matches/<id>/ws?uid=&side=
    const wsMatch = path.match(/^\/api\/matches\/([a-z0-9]+)\/ws$/);
    if (wsMatch) {
      const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(wsMatch[1]));
      return stub.fetch(request);
    }

    if (path === "/api/matches/ai" && request.method === "POST") {
      const user = await currentUser(d1(env.DB), request);
      if (!user) return json({ error: "auth_required" }, 401);
      const rlAi = await limited(env, request, "mutation", user);
      if (rlAi) return rlAi;
      const body: any = await request.json().catch(() => ({}));
      // app.py parity: the client sends { difficulty }; the server privately
      // maps the tier to a bot rank at or above the player's rank.
      const tier = String(body.difficulty ?? body.tier ?? "medium").toLowerCase();
      const controls = await getControls(env);
      const botControls = (controls as any).bot_difficulty ?? {};
      const userRankLevel = Number(rankPayload(Number((user as any).rank_points ?? 0)).level);
      const offsets: Record<string, number> = {};
      for (const name of ["medium", "hard", "ultra", "expert"])
        offsets[name] = Number(botControls[`${name}_rank_offset`] ?? 0);
      offsets.normal = offsets.medium; offsets.ranked = offsets.medium;
      let difficulty: string, aiTier: string, aiRankLevel: number;
      if (tier === "easy") {
        difficulty = "easy"; aiTier = "easy";
        aiRankLevel = Math.min(MAX_LEVEL, userRankLevel + Number(botControls.easy_rank_offset ?? 0));
      } else if (tier in offsets) {
        difficulty = "ranked";
        aiTier = (tier === "medium" || tier === "normal" || tier === "ranked") ? "medium" : tier;
        aiRankLevel = Math.min(MAX_LEVEL, userRankLevel + offsets[tier]);
      } else {
        return json({ error: "bad_difficulty", error_he: "רמת הקושי אינה תקינה." }, 400);
      }
      const mods = await userMods(env, Number((user as any).id));
      const id = matchId();
      const state = newState(mods, { armor: 0, hp: 0, skin: null });
      state.ai_profile = botProfile(controls, aiTier);
      state.ai_difficulty = difficulty;
      state.ai_tier = aiTier;
      state.ai_rank_level = aiRankLevel;
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
        .bind(id, (user as any).id, JSON.stringify(state), now, now).run();
      const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(id));
      await stub.fetch("https://do/init", {
        method: "POST",
        body: JSON.stringify({ id, mode: "ai", status: "active", p1: (user as any).id, p2: null, p2_ai: true, state, version: 1 }),
      });
      return json({ match_id: id, status: "active" });
    }

    // Admin and match REST routes, then the economy/me module, then assets.
    const adminHandled = await handleAdminApi(env, request, path);
    if (adminHandled) return adminHandled;
    const matchHandled = await handleMatchApi(env, request, path);
    if (matchHandled) return matchHandled;
    const handled = await handleApi(env, request, path);
    if (handled) return handled;

    // Everything else: static assets (PWA).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
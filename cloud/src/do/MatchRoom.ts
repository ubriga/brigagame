/**
 * MatchRoom Durable Object - authoritative real-time match room.
 *
 * Replaces the PythonAnywhere polling loop: one DO instance per active match,
 * clients hold WebSockets, the bot acts on a server-side alarm cadence
 * (profile.reaction seconds), and state is checkpointed to D1 so a cold DO
 * can resume. All combat math runs through src/game/* (parity-tested ports).
 */
import {
  newState, fireWeapon, towerHp, obstacleAt, TOWER_X_RANGE,
  aiChooseShot, type PlayerMods, defaultRng,
} from "../game/game_logic";
import { botChooseWeapon, applyBotTactics, executeShot } from "../game/bot";
import { finalizeMatch, resolveTimeLimit } from "../game/finalize.js";
import { d1, getControls } from "../util.js";

export interface Env {
  DB: D1Database;
  MATCH_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  SERVER_VERSION: string;
  ADMIN_EMAIL: string;
  ALLOWED_ORIGINS: string;
}

interface ClientSession { ws: WebSocket; userId: number | null; side: string | null; }

const BOT_MIN_DELAY = 0.15; // floor so a reaction of 0 can't spin the alarm

export class MatchRoom {
  state: DurableObjectState;
  env: Env;
  match: any | null = null;
  sessions: ClientSession[] = [];

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      this.match = (await this.state.storage.get("match")) ?? null;
      // Hibernation-safe: adopt any websockets that survived eviction.
      for (const ws of this.state.getWebSockets()) {
        const meta = this.state.getTags(ws); // [userId, side]
        this.sessions.push({ ws, userId: meta[0] ? Number(meta[0]) : null, side: meta[1] ?? null });
      }
      if (this.match && this.match.status === "active" && this.match.p2_ai) {
        await this.scheduleBot();
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ws") && request.headers.get("Upgrade") === "websocket") {
      const userId = Number(url.searchParams.get("uid") || "0") || null;
      const side = url.searchParams.get("side");
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server, [String(userId ?? ""), side ?? ""]);
      this.sessions.push({ ws: server, userId, side });
      server.send(JSON.stringify({ type: "welcome", version: this.match?.version ?? 0 }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.endsWith("/init") && request.method === "POST") {
      await this.initMatch(await request.json());
      return Response.json({ ok: true });
    }
    if (url.pathname.endsWith("/snapshot")) {
      return Response.json(this.publicSnapshot());
    }
    const actionMatch = url.pathname.match(/\/(fire|move|shield)$/);
    if (actionMatch && request.method === "POST") {
      const body: any = await request.json().catch(() => ({}));
      const userId = Number(body.userId);
      const m = this.match;
      const side = m && (Number(m.p1) === userId ? "p1" : (m.p2 != null && Number(m.p2) === userId) ? "p2" : null);
      if (!m || !side) return Response.json({ error: "not_found" });
      const prevVersion = m.version;
      const { events, err } = await this.execAction(
        { userId, side }, { type: actionMatch[1], ...body });
      if (err) return Response.json({ ...err.body, status: err.status });
      return Response.json({ ok: true, version: m.version, prevVersion, events });
    }
    if (url.pathname.endsWith("/ready") && request.method === "POST") {
      const { userId } = await request.json() as any;
      const m = this.match;
      const side = m && (Number(m.p1) === Number(userId) ? "p1" : (m.p2 != null && Number(m.p2) === Number(userId)) ? "p2" : null);
      if (!m || !side || m.status !== "active") return Response.json({ error: "not_found" });
      (m.state.ready ??= {})[side] = true;
      await this.persist();
      return Response.json({ ok: true, side });
    }
    if (url.pathname.endsWith("/leave") && request.method === "POST") {
      const { userId } = await request.json() as any;
      const m = this.match;
      const side = m && (Number(m.p1) === Number(userId) ? "p1" : (m.p2 != null && Number(m.p2) === Number(userId)) ? "p2" : null);
      if (!m || !side) return Response.json({ error: "not_found" });
      if (m.status === "active") {
        const other = side === "p1" ? "p2" : "p1";
        const ready = m.state.ready ?? {};
        const shots = m.state.last_shot_at ?? {};
        // A client that never completed loading, or a match where neither
        // side could make a move, is a technical abort - never a ranked loss.
        const technical = !ready[side] || !ready[other]
          || !["p1", "p2"].some((s) => Number(shots[s] ?? 0) > Number(m.state.started_at ?? 0));
        if (technical) {
          m.status = "aborted";
          m.winner = null;
          m.state.abort_reason = "technical_failure";
          m.state.winner_side = null;
          m.state.results = { p1: { outcome: "void" }, p2: { outcome: "void" } };
          m.version += 1;
          const events = [{ type: "match_abort", reason: "technical_failure" }];
          await this.persist();
          await this.recordEvents(events);
          this.broadcast({ type: "events", version: m.version, events });
        } else {
          await this.finalize(other);
          m.state.finish_reason = "opponent_left";
          m.version += 1;
          const events = [{ type: "match_end", winner_side: other, reason: "opponent_left" }];
          await this.persist();
          await this.recordEvents(events);
          this.broadcast({ type: "events", version: m.version, events });
        }
      } else if (m.status === "waiting" && this.env.DB) {
        await this.env.DB.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(m.id).run();
        await this.env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(m.id).run();
        this.match = null;
        await this.state.storage.delete("match");
      }
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  /**
   * Shared fire/move/shield executor used by both the WebSocket handler and
   * the REST RPC endpoints (app.py match_fire/match_move/match_shield parity,
   * including the 10s shot clock and atomic ammo debit). Mutates, persists,
   * journals and broadcasts on success.
   */
  async execAction(sess: { userId: number; side: string }, msg: any)
      : Promise<{ events: any[] | null; err: { status: number; body: any } | null }> {
    const m = this.match;
    if (!m || m.status !== "active") {
      return { events: null, err: { status: 400, body: { error: "not_active", error_he: "המשחק לא פעיל." } } };
    }
    if (msg.type === "fire") {
      const weapon = String(msg.weapon ?? "standard");
      // Shot-clock enforcement is server-side too (app.py parity): clients
      // get the deadline for display but cannot bypass it by hiding JS.
      const now = Date.now() / 1000;
      const lastTurn = (m.state.last_turn_at ??= {});
      const deadline = Number(lastTurn[sess.side] ?? m.state.started_at ?? now) + 10;
      if (now > deadline + 1.5) {
        lastTurn[sess.side] = now;
        await this.persist();
        return { events: null, err: { status: 408, body: { error: "shot_clock", error_he: "זמן הירייה נגמר. השעון התחיל מחדש." } } };
      }
      // Human consumable ammo: atomic conditional D1 debit, mirroring the
      // Python backend's `UPDATE user_items SET qty=qty-1 ... WHERE qty>0`.
      // executeShot is synchronous and cannot await D1, so the debit happens
      // here first and the sync callback below replays it as already-paid.
      // If the shot is rejected before the ammo step (bad weapon or
      // cooldown), the debit is refunded; rejection after it (e.g. mega
      // already used) keeps the debit, exactly like the Python backend.
      let debited = false;
      let callbackConsumed = false;
      if (weapon !== "standard" && !(sess.side === "p2" && m.p2_ai) && this.env.DB) {
        const res = await this.env.DB.prepare(
          "UPDATE user_items SET qty = qty - 1 WHERE user_id = ? AND item_id = ? AND qty > 0")
          .bind(sess.userId, weapon).run();
        if (Number((res.meta as any)?.changes ?? 0) !== 1) {
          return { events: null, err: { status: 400, body: { error: "no_ammo", error_he: "אין לך תחמושת מהסוג הזה." } } };
        }
        debited = true;
      }
      const [result, err] = executeShot(m, sess.side, Number(msg.angle), Number(msg.power),
        weapon, Boolean(msg.mega), sess.userId,
        debited
          ? () => { if (callbackConsumed) return false; callbackConsumed = true; return true; }
          : (uid, w) => this.spendAmmoSync(uid, w),
        defaultRng);
      if (err) {
        if (debited && !callbackConsumed && this.env.DB) {
          await this.env.DB.prepare(
            "UPDATE user_items SET qty = qty + 1 WHERE user_id = ? AND item_id = ?")
            .bind(sess.userId, weapon).run();
        }
        return { events: null, err };
      }
      m.version += 1;
      if (result!.won) {
        await this.finalize(sess.side);
        m.state.finish_reason = "tower_destroyed";
        result!.events.push({ type: "match_end", winner_side: sess.side, reason: "tower_destroyed" });
      }
      await this.persist();
      await this.recordEvents(result!.events);
      this.broadcast({ type: "events", version: m.version, events: result!.events });
      if (m.p2_ai && m.status === "active") await this.scheduleBot();
      return { events: result!.events, err: null };
    }
    if (msg.type === "move") {
      const side = sess.side;
      const left = (m.state.moves_left ??= {})[side] ?? 0;
      if (left < 1) return { events: null, err: { status: 400, body: { error: "no_move", error_he: "ההזזה כבר נוצלה." } } };
      const dir = msg.direction === "left" ? -1 : 1;
      const [lo, hi] = TOWER_X_RANGE[side];
      m.state.tower_x[side] = Math.max(lo, Math.min(hi, m.state.tower_x[side] + dir * 45));
      m.state.moves_left[side] = left - 1;
      m.version += 1;
      const events = [{ type: "tower_move", side }];
      await this.persist();
      await this.recordEvents(events);
      this.broadcast({ type: "events", version: m.version, events });
      return { events, err: null };
    }
    // shield
    const side = sess.side;
    const abilities = (m.state.abilities ??= {})[side] ??= {};
    if ((abilities.shield ?? 0) < 1) {
      return { events: null, err: { status: 400, body: { error: "no_ability", error_he: "המגן כבר נוצל." } } };
    }
    abilities.shield -= 1;
    (m.state.shield ??= {})[side] = true;
    m.version += 1;
    const events = [{ type: "shield", side, active: true }];
    await this.persist();
    await this.recordEvents(events);
    this.broadcast({ type: "events", version: m.version, events });
    return { events, err: null };
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(String(message)); } catch { return; }
    const sess = this.sessions.find((s) => s.ws === ws);
    if (!sess || !this.match || this.match.status !== "active") return;
    const m = this.match;
    try {
      switch (msg.type) {
        case "fire":
        case "move":
        case "shield": {
          const { events, err } = await this.execAction(
            { userId: sess.userId!, side: sess.side! }, msg);
          if (err) { ws.send(JSON.stringify({ type: "error", ...err.body })); return; }
          break;
        }
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", error: "internal" }));
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.ws !== ws);
  }

  /** Bot loop: alarm fires after profile.reaction seconds, bot takes its turn. */
  async alarm(): Promise<void> {
    const m = this.match;
    if (!m || m.status !== "active" || !m.p2_ai) return;
    // The match clock is server-authoritative: resolve sudden death and the
    // 4-minute limit before anyone takes another shot (app.py parity).
    if (this.env.DB) {
      const controls = await getControls(this.env);
      const tlEvents = await resolveTimeLimit(d1(this.env.DB), m, controls.xp);
      if (tlEvents.length) {
        await this.persist();
        await this.recordEvents(tlEvents);
        this.broadcast({ type: "events", version: m.version, events: tlEvents });
        if (m.status !== "active") return;
      }
    }
    const events: any[] = [];
    events.push(...applyBotTactics(m, defaultRng));
    const profile = m.state.ai_profile ?? {};
    const weapon = botChooseWeapon(m.state, defaultRng);
    let [angle, power] = aiChooseShot(m.state, "p2", m.mode ?? "ranked",
      Number(m.state.ai_rank_level ?? 1), profile, defaultRng);
    // v23 item D (mirror): damped adaptation - step scales with miss
    // distance; no same-sign repeat after an off-world shot.
    const controls = m.state.bot_controls ?? {};
    const lastResult = (m.state.bot_tactics ?? {}).last_result ?? {};
    if (controls.adaptation !== false && lastResult.weapon) {
      const correction = Number(profile.correction ?? 0);
      if (lastResult.blocked) {
        angle = Math.min(78.0, angle + 10.0 * correction);
      } else if (Number(lastResult.damage ?? 0) <= 0
                 && lastResult.impact_x != null && lastResult.target_x != null) {
        const miss = Number(lastResult.impact_x) - Number(lastResult.target_x);
        const desired = miss > 0 ? 1 : -1;
        const step = Math.min(10.0, Math.abs(miss) / 25.0) * correction;
        const tactics = (m.state.bot_tactics ??= {});
        const sameSignRepeat = lastResult.off_world && tactics.last_adjust_sign === desired;
        if (!sameSignRepeat && step > 0) {
          power = Math.max(30.0, Math.min(96.0, power + desired * step));
          tactics.last_adjust_sign = desired;
        }
      }
    }
    const [result, err] = executeShot(m, "p2", angle, power, weapon,
      this.botWantsMega(), null, null, defaultRng);
    if (!err && result) {
      events.push(...result.events);
      m.version += 1;
      if (result.won) { await this.finalize("p2"); events.push({ type: "match_end", winner_side: "p2", reason: "tower_destroyed" }); }
      await this.persist();
      await this.recordEvents(events);
      this.broadcast({ type: "events", version: m.version, events });
    } else {
      // Cooldown not elapsed or no ammo: retry on the remaining cadence.
      await this.state.storage.setAlarm(Date.now() + 500);
      return;
    }
    if (m.status === "active") await this.scheduleBot();
  }

  botWantsMega(): boolean {
    const m = this.match;
    const controls = m.state.bot_controls ?? {};
    const profile = m.state.ai_profile ?? {};
    if (controls.tactical_mega === false) return false;
    const abilities = (m.state.abilities ?? {}).p2 ?? {};
    if ((abilities.mega ?? 0) < 1) return false;
    return Math.random() < Number(profile.mega_chance ?? 0);
  }

  async scheduleBot(): Promise<void> {
    const profile = this.match?.state?.ai_profile ?? {};
    const reaction = Math.max(BOT_MIN_DELAY, Number(profile.reaction ?? 1));
    const at = Date.now() + reaction * 1000;
    const current = await this.state.storage.getAlarm();
    if (current == null || current > at) await this.state.storage.setAlarm(at);
  }

  spendAmmoSync(_userId: number, _weapon: string): boolean {
    // Dev-only fallback: production fire handling pre-debits user_items in D1
    // atomically before executeShot (see the "fire" case above). This path is
    // only reached when no D1 binding is present.
    return true;
  }

  /** Full settlement port of finalize_match: coins, rank points, rating,
   * stats and results payload, written to D1. */
  async finalize(winnerSide: string): Promise<void> {
    if (!this.env.DB || !this.match) {
      if (this.match) { this.match.status = "finished"; this.match.winner = winnerSide; }
      return;
    }
    const controls = await getControls(this.env);
    await finalizeMatch(d1(this.env.DB), this.match, winnerSide, controls.xp);
  }

  /** Append events to the D1 journal so polling clients (state?since=N)
   * can incrementally sync, mirroring emit_events. */
  async recordEvents(events: any[]): Promise<void> {
    if (!this.env.DB || !this.match) return;
    const now = new Date().toISOString();
    for (const ev of events) {
      await this.env.DB.prepare(
        "INSERT INTO match_events (match_id, version, type, data, created_at) VALUES (?,?,?,?,?)")
        .bind(this.match.id, this.match.version, String(ev.type ?? "event"),
          JSON.stringify(ev), now).run();
    }
  }

  async persist(): Promise<void> {
    await this.state.storage.put("match", this.match);
    // Checkpoint into D1 so match discovery/history survives DO eviction.
    if (this.env.DB && this.match) {
      const m = this.match;
      await this.env.DB.prepare(
        "UPDATE matches SET state=?, version=?, status=?, winner=?, updated_at=? WHERE id=?")
        .bind(JSON.stringify(m.state), m.version, m.status, m.winner ?? null,
          new Date().toISOString(), m.id).run();
    }
  }

  broadcast(payload: unknown): void {
    const s = JSON.stringify(payload);
    for (const sess of this.sessions) {
      try { sess.ws.send(s); } catch { /* dropped socket reaped on close */ }
    }
  }

  publicSnapshot(): Record<string, unknown> {
    if (!this.match) return { status: "empty" };
    const m = this.match;
    return { id: m.id, status: m.status, version: m.version, state: m.state };
  }

  /** Called by the worker right after DO creation to install a fresh match. */
  async initMatch(match: any): Promise<void> {
    this.match = match;
    await this.persist();
    if (match.p2_ai) await this.scheduleBot();
  }
}
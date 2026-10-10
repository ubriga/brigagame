/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/**
 * Admin broadcast popup (settings key broadcast_popup): one clear message
 * window shown to players at game open, with a close button. The admin sets
 * the text, the audience (everyone / registered only) and how often it
 * reappears for the same player (once only / every game open / every N
 * minutes). Cancelling it removes it for everybody at the next presence ping.
 * Per-player "already shown" state is kept server-side (broadcast_seen) so
 * "once only" survives browser storage clearing and works without consent.
 */
import type { Env } from "../do/MatchRoom";

export interface BroadcastCfg {
  on: boolean; message: string; audience: "all" | "registered";
  mode: "once" | "session" | "interval"; interval_min: number; id: number;
}
const DEFAULT: BroadcastCfg = { on: false, message: "", audience: "all", mode: "once", interval_min: 60, id: 0 };

export const MAX_MESSAGE = 500;
export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 1440;

export function sanitizeBroadcast(d: any): BroadcastCfg {
  const mode = d?.mode === "session" || d?.mode === "interval" ? d.mode : "once";
  const im = Math.trunc(Number(d?.interval_min));
  return {
    on: d?.on === true,
    message: String(d?.message ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_MESSAGE),
    audience: d?.audience === "registered" ? "registered" : "all",
    mode,
    interval_min: isFinite(im) ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, im)) : DEFAULT.interval_min,
    id: Math.max(0, Math.trunc(Number(d?.id)) || 0),
  };
}

// Short per-isolate cache: the presence ping reads this every ~8s per player.
// An admin save refreshes the saving isolate at once; others follow within TTL.
let _cache: { ts: number; v: BroadcastCfg } | null = null;
export const invalidateBroadcastCache = () => { _cache = null; };

export async function getBroadcastCfg(env: Env, fresh = false): Promise<BroadcastCfg> {
  if (!fresh && _cache && Date.now() - _cache.ts < 10_000) return _cache.v;
  let v = DEFAULT;
  const row: any = await env.DB.prepare("SELECT value FROM settings WHERE key = 'broadcast_popup'").first();
  if (row) { try { v = sanitizeBroadcast(JSON.parse(String(row.value))); } catch { v = DEFAULT; } }
  _cache = { ts: Date.now(), v };
  return v;
}

let _schema: Promise<void> | null = null;
export function ensureBroadcastSchema(env: Env): Promise<void> {
  if (!_schema) {
    _schema = env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS broadcast_seen (user_id INTEGER NOT NULL, bid INTEGER NOT NULL,"
      + " last_shown INTEGER NOT NULL, PRIMARY KEY (user_id, bid))").run()
      .then(() => undefined).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

/** What a given player should receive on this ping, or null. */
export async function broadcastFor(env: Env, user: any): Promise<null | { id: number; message: string; mode: string; hidden?: boolean }> {
  const cfg = await getBroadcastCfg(env);
  if (!cfg.on || !cfg.message) return null;
  if (cfg.audience === "registered" && user?.is_guest) return { id: cfg.id, message: "", mode: cfg.mode, hidden: true };
  if (cfg.mode !== "session") {
    await ensureBroadcastSchema(env);
    const seen: any = await env.DB.prepare(
      "SELECT last_shown FROM broadcast_seen WHERE user_id = ? AND bid = ?").bind(Number(user.id), cfg.id).first();
    if (seen) {
      if (cfg.mode === "once") return { id: cfg.id, message: "", mode: cfg.mode, hidden: true };
      if (Date.now() / 1000 - Number(seen.last_shown) < cfg.interval_min * 60) return { id: cfg.id, message: "", mode: cfg.mode, hidden: true };
    }
  }
  return { id: cfg.id, message: cfg.message, mode: cfg.mode };
}

/** Player closed/saw the popup: remember it so once/interval modes hold. */
export async function markBroadcastShown(env: Env, userId: number, bid: number): Promise<void> {
  const cfg = await getBroadcastCfg(env);
  if (!cfg.on || bid !== cfg.id) return; // stale or cancelled: ignore
  await ensureBroadcastSchema(env);
  await env.DB.prepare(
    "INSERT INTO broadcast_seen (user_id, bid, last_shown) VALUES (?,?,?)"
    + " ON CONFLICT(user_id, bid) DO UPDATE SET last_shown = excluded.last_shown")
    .bind(userId, bid, Math.trunc(Date.now() / 1000)).run();
}

/**
 * Guest mode: anonymous temporary accounts ("שחק כאורח").
 * A guest is a regular users row with is_guest=1 and guest_created_at set;
 * the account (and every row tied to it) is deleted ttl_hours after the
 * FIRST entry, measured from guest_created_at. Registration converts the
 * same row in place, so all progress carries over.
 * Server-side admin control lives in gameplay_controls.guest_mode:
 *   enabled, ttl_hours (1-168), games_until_register_prompt (0-50),
 *   ranked_allowed (quick-match access for guests).
 */
import { sha256Hex, createSession } from "../auth.js";
import { d1, getControls } from "../util.js";
import { START_RATING, STARTING_COINS } from "../game/economy.js";
import type { Env } from "../do/MatchRoom";

export interface GuestCfg {
  enabled: boolean;
  ttl_hours: number;
  games_until_register_prompt: number;
  ranked_allowed: boolean;
}

export async function getGuestCfg(env: Env): Promise<GuestCfg> {
  const g = ((await getControls(env)) as any).guest_mode ?? {};
  return {
    enabled: g.enabled !== false,
    ttl_hours: Math.max(1, Math.min(168, Math.trunc(Number(g.ttl_hours ?? 24)) || 24)),
    games_until_register_prompt: Math.max(0, Math.min(50, Math.trunc(Number(g.games_until_register_prompt ?? 3)) || 0)),
    ranked_allowed: g.ranked_allowed === true,
  };
}

/** ISO time at which this guest account is deleted (first entry + TTL). */
export function guestExpiresAt(u: any, cfg: GuestCfg): string | null {
  if (!u.is_guest || !u.guest_created_at) return null;
  const base = Date.parse(String(u.guest_created_at));
  if (isNaN(base)) return null;
  return new Date(base + cfg.ttl_hours * 3600_000).toISOString();
}

/** True when the guest account already passed its TTL. */
export function guestExpired(u: any, cfg: GuestCfg): boolean {
  const exp = guestExpiresAt(u, cfg);
  return exp !== null && exp <= new Date().toISOString();
}

/** Delete a user and every row that references them. FK-safe order:
 * child tables first, users last (mirrors the QA cleanup procedure). */
export async function deleteUserCascade(env: Env, uid: number): Promise<void> {
  const db = env.DB;
  const matchIds = await db.prepare(
    "SELECT id FROM matches WHERE p1 = ? OR p2 = ?").bind(uid, uid).all();
  for (const m of matchIds.results as any[]) {
    await db.prepare("DELETE FROM match_events WHERE match_id = ?").bind(String(m.id)).run();
    await db.prepare("DELETE FROM match_offers WHERE match_id = ?").bind(String(m.id)).run();
    await db.prepare("DELETE FROM match_offer_declines WHERE match_id = ?").bind(String(m.id)).run();
  }
  await db.prepare("DELETE FROM matches WHERE p1 = ? OR p2 = ?").bind(uid, uid).run();
  await db.prepare("DELETE FROM match_offers WHERE invited_user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM match_offer_declines WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM audit_logs WHERE actor_user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM transactions WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM user_items WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM message_reads WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM messages WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM coupon_redemptions WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM coating_jobs WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM user_coatings WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM expansion_jobs WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM user_expansions WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM invites WHERE inviter_id = ? OR claimed_by = ?").bind(uid, uid).run();
  await db.prepare("DELETE FROM user_tags WHERE user_id = ?").bind(uid).run();
  await db.prepare("DELETE FROM users WHERE id = ?").bind(uid).run();
}

/** Sweep guests whose TTL elapsed. Throttled to one pass per 5 minutes via a
 * settings row, because presence pings arrive every few seconds per user. */
export async function sweepExpiredGuests(env: Env): Promise<number> {
  const now = Date.now();
  const marker: any = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'guest_sweep_last'").first();
  if (marker && now - Number(marker.value) < 300_000) return 0;
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('guest_sweep_last', ?)"
    + " ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(now)).run();
  const cfg = await getGuestCfg(env);
  const cutoff = new Date(now - cfg.ttl_hours * 3600_000).toISOString();
  const rows = await env.DB.prepare(
    "SELECT id FROM users WHERE is_guest = 1 AND guest_created_at IS NOT NULL"
    + " AND guest_created_at <= ? LIMIT 25").bind(cutoff).all();
  for (const r of rows.results as any[]) {
    await deleteUserCascade(env, Number(r.id));
  }
  return rows.results.length;
}

const GUEST_NAME_ADJECTIVES = ["מהיר", "אמיץ", "חכם", "מדויק", "סקרן", "נועז", "זריז", "שקט"];

/** Create an anonymous guest account + session. Returns the raw token. */
export async function createGuest(env: Env): Promise<{ token: string; user: any; expires_at: string }> {
  const cfg = await getGuestCfg(env);
  const now = new Date().toISOString();
  const suffix = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  const adj = GUEST_NAME_ADJECTIVES[crypto.getRandomValues(new Uint32Array(1))[0] % GUEST_NAME_ADJECTIVES.length];
  const name = `אורח ${adj} ${suffix}`.slice(0, 40);
  // users.email is UNIQUE NOT NULL - guests get a reserved local domain that
  // can never collide with a real registration (verified in upgrade path).
  const email = `guest-${crypto.randomUUID()}@guest.local`;
  await env.DB.prepare(
    "INSERT INTO users (email, name, picture, coins, rating, created_at, last_login, last_seen, is_guest, guest_created_at)"
    + " VALUES (?,?,'',0,?,?,?,?,1,?)")
    .bind(email, name, START_RATING, now, now, now, now).run();
  const user: any = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const token = await createSession(d1(env.DB), Number(user.id));
  return { token, user, expires_at: guestExpiresAt(user, cfg) ?? now };
}

/**
 * Registration attaches to the guest session: when a guest completes a real
 * sign-in (email code or Google) and the email is not already registered,
 * convert the guest row IN PLACE - same id, same stats, same session.
 * Returns the (possibly upgraded) user row and the token to keep using.
 * When the email already belongs to an account we log into that account
 * instead; the leftover guest row expires on its own.
 */
export async function upgradeGuestIfPresent(
  env: Env, request: Request, email: string, name: string, picture: string,
): Promise<{ user: any; token: string | null; upgraded: boolean } | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  const now = new Date().toISOString();
  const guest: any = await env.DB.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
    + " WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_guest = 1").bind(hash, now).first();
  if (!guest) return null;
  const taken: any = await env.DB.prepare(
    "SELECT id FROM users WHERE email = ? AND id != ?").bind(email, Number(guest.id)).first();
  if (taken) return null; // normal login path takes over; guest row expires alone
  await env.DB.prepare(
    "UPDATE users SET email = ?, name = ?, picture = ?, is_guest = 0,"
    + " guest_created_at = NULL, last_login = ?, coins = coins + ? WHERE id = ?")
    .bind(email, name.slice(0, 80), picture.slice(0, 500), now, STARTING_COINS, Number(guest.id)).run();
  // Same welcome grant a fresh registration gets - the upgrade IS the
  // registration moment, so nothing is lost versus signing up directly.
  await env.DB.prepare(
    "INSERT INTO transactions (user_id, delta, reason, created_at) VALUES (?,?,?,?)")
    .bind(Number(guest.id), STARTING_COINS, "welcome_grant", now).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(Number(guest.id)).first();
  return { user, token, upgraded: true };
}

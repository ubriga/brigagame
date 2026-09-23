/**
 * Rate limiting - port of backend/security.py (SQLite fixed-window buckets).
 * Same buckets/windows, same 429 payload. Identity = user id when authed,
 * else client IP (CF-Connecting-IP on Workers).
 */
import { json } from "./routes.js";
import type { Env } from "../do/MatchRoom";

const RATE_LIMITS: Record<string, [number, number]> = {
  auth: [10, 60],
  fire: [30, 60],
  state: [240, 60],
  store: [30, 60],
  admin: [120, 60],
  mutation: [90, 60],
  default: [300, 60],
};

/** True if allowed under the configured limit (security.py rate_limit). */
export async function rateLimit(env: Env, bucket: string, identity: string): Promise<boolean> {
  const [limit, window] = RATE_LIMITS[bucket] ?? RATE_LIMITS.default;
  const key = `${bucket}:${identity}`;
  const now = Date.now() / 1000;
  const row: any = await env.DB.prepare("SELECT * FROM rate_limits WHERE key = ?").bind(key).first();
  if (!row || now - Number(row.window_start) > window) {
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1)"
      + " ON CONFLICT(key) DO UPDATE SET window_start=?, count=1")
      .bind(key, now, now).run();
    return true;
  }
  if (Number(row.count) >= limit) return false;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}

/** Route helper (security.py limited): 429 with the Hebrew message, else null. */
export async function limited(env: Env, request: Request, bucket: string, user: any): Promise<Response | null> {
  const ident = user ? String(user.id)
    : (request.headers.get("CF-Connecting-IP") ?? "?");
  if (!(await rateLimit(env, bucket, ident))) {
    return json({ error: "rate_limited", error_he: "יותר מדי בקשות. נסה שוב בעוד דקה." }, 429);
  }
  return null;
}

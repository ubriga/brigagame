/**
 * Auth port: Google ID-token verification (JWKS, RS256, Web Crypto),
 * session issuance and lookup against D1. Mirrors backend/auth.py.
 */
import type { Db } from "./game/finalize.js";
import { STARTING_COINS, START_RATING } from "./game/economy.js";

const JWKS_URLS = [
  "https://www.googleapis.com/oauth2/v3/certs",
  "https://accounts.google.com/.well-known/openid-configuration",
];

let jwksCache: { keys: any[]; fetchedAt: number } | null = null;

async function googleKeys(): Promise<any[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 6 * 3600_000) return jwksCache.keys;
  const r = await fetch(JWKS_URLS[0]);
  if (!r.ok) throw new Error("jwks_fetch");
  const j = await r.json() as any;
  jwksCache = { keys: j.keys, fetchedAt: Date.now() };
  return jwksCache.keys;
}

function b64url(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const bin = atob(s + "=".repeat(pad));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export interface GoogleIdentity { email: string; name: string; picture: string; }

/** Verify a Google ID token. Throws Error on any failure. */
export async function verifyGoogleCredential(credential: string, clientId: string): Promise<GoogleIdentity> {
  if (!clientId) throw new Error("server_missing_client_id");
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("malformed_token");
  const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  if (header.alg !== "RS256") throw new Error("bad_alg");
  const keys = await googleKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown_kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
    b64url(parts[2]) as BufferSource, new TextEncoder().encode(parts[0] + "." + parts[1]) as BufferSource);
  if (!ok) throw new Error("bad_signature");
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || Number(payload.exp) < now) throw new Error("expired");
  if (payload.aud !== clientId) throw new Error("bad_audience");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throw new Error("bad_issuer");
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!email || payload.email_verified !== true) throw new Error("email_not_verified");
  return { email, name: String(payload.name ?? email.split("@")[0]).slice(0, 80), picture: String(payload.picture ?? "").slice(0, 500) };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateUser(db: Db, email: string, name: string, picture: string): Promise<any> {
  const now = new Date().toISOString();
  let row = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!row) {
    await db.run("INSERT INTO users (email, name, picture, coins, rating, created_at, last_login) VALUES (?,?,?,?,?,?,?)",
      [email, name, picture, STARTING_COINS, START_RATING, now, now]);
    const created = await db.get("SELECT id FROM users WHERE email = ?", [email]);
    await db.run("INSERT INTO transactions (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
      [created.id, STARTING_COINS, "welcome_grant", now]);
    row = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  } else {
    await db.run("UPDATE users SET name=?, picture=?, last_login=? WHERE id=?", [name, picture, now, row.id]);
    row = await db.get("SELECT * FROM users WHERE id = ?", [row.id]);
  }
  return row;
}

const SESSION_TTL_DAYS = 14;
const MAX_SESSIONS_PER_USER = 5;

export async function createSession(db: Db, userId: number): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const hash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86400_000);
  await db.run("DELETE FROM sessions WHERE expires_at <= ?", [now.toISOString()]);
  await db.run("DELETE FROM sessions WHERE expires_at <= ?", [now.toISOString()]);
  await db.run("DELETE FROM sessions WHERE expires_at <= ?", [now.toISOString()]);
  // Bound session-table growth: keep the newest MAX_SESSIONS_PER_USER.
  await db.run("DELETE FROM sessions WHERE user_id = ? AND id NOT IN"
    + " (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)",
    [userId, userId, MAX_SESSIONS_PER_USER - 1]);
  await db.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
    [hash, userId, now.toISOString(), expires.toISOString()]);
  return token;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.run("DELETE FROM sessions WHERE token_hash = ?", [await sha256Hex(token)]);
}

export async function currentUser(db: Db, request: Request): Promise<any | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  return db.get("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
    + " WHERE s.token_hash = ? AND s.expires_at > ?", [hash, new Date().toISOString()]);
}
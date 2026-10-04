/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/** Shared D1 adapter + gameplay-controls loader (merged with D1 overrides). */
import type { Db } from "./game/finalize.js";
import type { PlayerMods } from "./game/game_logic.js";
import type { Env } from "./do/MatchRoom";

/** D1-backed implementation of the settlement/auth Db interface. */
export function d1(db: D1Database): Db {
  return {
    async run(sql, params) {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: Number(r.meta?.changes ?? 0) };
    },
    async get(sql, params) {
      return (await db.prepare(sql).bind(...params).first()) ?? null;
    },
  };
}

/** Gameplay controls: DEFAULT_GAMEPLAY_CONTROLS merged with the D1 settings
 * row (per-group shallow merge), mirroring app.py get_gameplay_controls. */
export async function getControls(env: Env): Promise<any> {
  const { DEFAULT_GAMEPLAY_CONTROLS } = await import("./game/catalog.js");
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'gameplay_controls'").first();
  if (!row) return DEFAULT_GAMEPLAY_CONTROLS;
  try {
    const over = JSON.parse(String((row as any).value));
    const merged: any = { ...DEFAULT_GAMEPLAY_CONTROLS };
    for (const k of Object.keys(over)) merged[k] = { ...(merged[k] ?? {}), ...over[k] };
    if (merged.auth_flow) { delete merged.auth_flow.email_provider; delete merged.auth_flow.inboxlv_pass; }
    return merged;
  } catch { return DEFAULT_GAMEPLAY_CONTROLS; }
}

/** Player loadout/mods for match creation (port of app.py user_mods). */
export async function userMods(env: Env, userId: number): Promise<PlayerMods> {
  const items = await env.DB.prepare(
    "SELECT item_id, level, equipped FROM user_items WHERE user_id = ?").bind(userId).all();
  const armor = items.results.find((r: any) => r.item_id === "armor")?.level ?? 0;
  const hp = items.results.find((r: any) => r.item_id === "reinforced_hp")?.level ?? 0;
  const skin = items.results.find((r: any) => String(r.item_id).startsWith("skin_") && r.equipped)?.item_id ?? null;
  const coating = await env.DB.prepare(
    "SELECT material, hp FROM user_coatings WHERE user_id = ?").bind(userId).first();
  const expansion = await env.DB.prepare(
    "SELECT extra_cubes FROM user_expansions WHERE user_id = ?").bind(userId).first();
  const controls = await getControls(env);
  return {
    armor: Number(armor), hp: Number(hp), skin: skin as string | null,
    coating: coating ? { material: coating.material, hp: Number(coating.hp), max_hp: Number(coating.hp) } : null,
    extra_cubes: Number((expansion as any)?.extra_cubes ?? 0),
    expansion_cube_hp: Number((controls as any).tower_expansion.cube_hp),
    dynamic_obstacle: (controls as any).dynamic_obstacle,
  } as PlayerMods;
}

export interface ShabbatLock {
  active: boolean; enabled: boolean; repeat_weekly: boolean;
  title: string; body: string;
  start: string | null; end: string | null;
  /** End of the window currently in force (recurring occurrence end when
   * repeat_weekly is on, otherwise the configured end). Exposed as ends_at. */
  effective_end: string | null;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Site-wide Shabbat/holiday lockdown state (settings key shabbat_lockdown).
 * Active when the manual toggle is on, or inside the scheduled [start, end]
 * window. With repeat_weekly the window recurs every 7 days (same weekday and
 * hours): the occurrence containing now is [start + k*week, +duration]. An
 * incomplete or invalid window is never active. */
// Short per-isolate cache: the gate calls this on every API request, and each
// call is a full D1 roundtrip (hundreds of ms from distant colos). A 30s TTL
// bounds how long an admin toggle takes to appear while saving one roundtrip
// per request.
let _shabbatCache: { ts: number; value: ShabbatLock } | null = null;

export async function getShabbatLockdown(env: Env): Promise<ShabbatLock> {
  if (_shabbatCache && Date.now() - _shabbatCache.ts < 30_000) return _shabbatCache.value;
  const value = await getShabbatLockdownUncached(env);
  _shabbatCache = { ts: Date.now(), value };
  return value;
}

async function getShabbatLockdownUncached(env: Env): Promise<ShabbatLock> {
  const base: ShabbatLock = { active: false, enabled: false, repeat_weekly: false, title: "", body: "", start: null, end: null, effective_end: null };
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'shabbat_lockdown'").first();
  if (!row) return base;
  try {
    const d = JSON.parse(String((row as any).value));
    const enabled = d.enabled === true;
    const repeat = d.repeat_weekly === true;
    const start = d.start ? String(d.start) : null;
    const end = d.end ? String(d.end) : null;
    const sMs = start ? Date.parse(start) : NaN;
    const eMs = end ? Date.parse(end) : NaN;
    const now = Date.now();
    const valid = !isNaN(sMs) && !isNaN(eMs) && sMs < eMs;
    const inWindow = valid && sMs <= now && now <= eMs;
    let recActive = false, recEnd: string | null = null;
    if (repeat && valid) {
      const dur = eMs - sMs;
      const k = Math.floor((now - sMs) / WEEK_MS);
      const wStart = sMs + k * WEEK_MS;
      if (wStart <= now && now <= wStart + dur) {
        recActive = true;
        recEnd = new Date(wStart + dur).toISOString();
      }
    }
    return {
      active: enabled || inWindow || recActive, enabled, repeat_weekly: repeat,
      title: String(d.title ?? "").slice(0, 120),
      body: String(d.body ?? "").slice(0, 500),
      start, end,
      effective_end: recActive ? recEnd : end,
    };
  } catch { return base; }
}

// ---------------------------------------------------------------- login streak
/** YYYY-MM-DD in Asia/Jerusalem (the game's home timezone), shifted by
 * offsetDays. Login streaks run on the Israel calendar day, per spec. */
export function israelDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export interface LoginStreakCfg {
  enabled: boolean;
  /** Coins for a regular streak day (no milestone). */
  base_amount: number;
  /** Milestone day -> coins (keys are day numbers as strings). */
  milestones: Record<string, number>;
  /** What a skipped day does to the streak: reset to 1 (default), reset to 0,
   * or keep counting as if no day was skipped. */
  reset_policy: "to_one" | "to_zero" | "keep";
  /** One-time repair offer when a streak breaks (admin-controlled). */
  repair: { enabled: boolean; price: number };
}

export const DEFAULT_LOGIN_STREAK: LoginStreakCfg = {
  enabled: true,
  base_amount: 5,
  milestones: { "3": 10, "7": 25, "30": 100 },
  reset_policy: "to_one",
  repair: { enabled: true, price: 100 },
};

// Short per-isolate cache: /api/me reads this on every app load, and each read
// is a D1 roundtrip. A 30s TTL bounds admin-toggle propagation (same pattern
// as the lockdown gate).
let _streakCache: { ts: number; value: LoginStreakCfg } | null = null;

export async function getLoginStreak(env: Env): Promise<LoginStreakCfg> {
  if (_streakCache && Date.now() - _streakCache.ts < 30_000) return _streakCache.value;
  let cfg = DEFAULT_LOGIN_STREAK;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'login_streak'").first();
  if (row) {
    try {
      const d = JSON.parse(String((row as any).value));
      cfg = sanitizeLoginStreak(d);
    } catch {}
  }
  _streakCache = { ts: Date.now(), value: cfg };
  return cfg;
}

/** Merge + clamp a stored/admin-provided config onto the defaults. */
export function sanitizeLoginStreak(d: any): LoginStreakCfg {
  const clampAmt = (v: unknown, fallback: number): number => {
    const n = Math.trunc(Number(v));
    return isFinite(n) && n >= 0 && n <= 100000 ? n : fallback;
  };
  const milestones: Record<string, number> = {};
  if (d && typeof d.milestones === "object" && d.milestones) {
    for (const [k, v] of Object.entries(d.milestones as Record<string, unknown>)) {
      const day = Math.trunc(Number(k));
      if (isFinite(day) && day >= 1 && day <= 365)
        milestones[String(day)] = clampAmt(v, DEFAULT_LOGIN_STREAK.base_amount);
    }
  } else {
    Object.assign(milestones, DEFAULT_LOGIN_STREAK.milestones);
  }
  const policy = d?.reset_policy;
  const rep = (d && typeof d.repair === "object" && d.repair) ? d.repair as any : {} as any;
  return {
    enabled: d?.enabled === undefined ? DEFAULT_LOGIN_STREAK.enabled : d.enabled === true,
    base_amount: clampAmt(d?.base_amount, DEFAULT_LOGIN_STREAK.base_amount),
    milestones,
    reset_policy: policy === "to_zero" || policy === "keep" ? policy : "to_one",
    repair: {
      enabled: rep.enabled === undefined ? DEFAULT_LOGIN_STREAK.repair.enabled : rep.enabled === true,
      price: clampAmt(rep.price, DEFAULT_LOGIN_STREAK.repair.price),
    },
  };
}

/** Whole days between two YYYY-MM-DD dates (to minus from), at least 1. */
export function ilDateDiff(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

/** Coins for landing on the given streak day. */
export function streakRewardFor(cfg: LoginStreakCfg, streakDay: number): number {
  return cfg.milestones[String(streakDay)] ?? cfg.base_amount;
}

/** The next milestone strictly above the current streak (for the UI ladder). */
export function nextStreakMilestone(cfg: LoginStreakCfg, streakDay: number): { day: number; amount: number } | null {
  const days = Object.keys(cfg.milestones).map(Number).filter(d => d > streakDay).sort((a, b) => a - b);
  if (!days.length) return null;
  const day = days[0];
  return { day, amount: cfg.milestones[String(day)] };
}

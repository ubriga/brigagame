/**
 * Admin API - port of app.py /api/admin/* endpoints. Same gates (admin email),
 * validation ranges, messages, and audit behavior.
 */
import { currentUser } from "../auth.js";
import { limited } from "./ratelimit.js";
import { d1, getControls } from "../util.js";
import { addCoins } from "../game/finalize.js";
import { rankPayload } from "../game/ranks.js";
import { CATALOG, DEFAULT_GAMEPLAY_CONTROLS } from "../game/catalog.js";
import { json } from "./routes.js";
import type { Env } from "../do/MatchRoom";

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

async function adminUser(env: Env, request: Request): Promise<any | Response> {
  const u = await currentUser(d1(env.DB), request);
  if (!u) return json({ error: "unauthorized" }, 401);
  if (String(u.email).toLowerCase() !== String(env.ADMIN_EMAIL).toLowerCase()) {
    return json({ error: "forbidden" }, 403);
  }
  return u;
}

async function audit(env: Env, request: Request, actorId: number,
                     action: string, targetType = "", targetId: string | number = "",
                     details: unknown = {}): Promise<void> {
  const { sha256Hex } = await import("../auth.js");
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = ip ? await sha256Hex(ip) : "";
  await env.DB.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-2 years')").run();
  await env.DB.prepare(
    "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, ip_hash, user_agent, created_at)"
    + " VALUES (?,?,?,?,?,?,?,?)")
    .bind(actorId, String(action).slice(0, 80), String(targetType).slice(0, 40),
      String(targetId).slice(0, 120), JSON.stringify(details ?? {}).slice(0, 2000),
      ipHash, (request.headers.get("User-Agent") ?? "").slice(0, 300), nowIso()).run();
}

async function getMaintenance(env: Env): Promise<{ on: boolean; message: string }> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'maintenance'").first();
  if (!row) return { on: false, message: "" };
  try {
    const d = JSON.parse(String((row as any).value));
    return { on: Boolean(d.on), message: String(d.message ?? "").slice(0, 300) };
  } catch { return { on: false, message: "" }; }
}

type Spec = [number | null, number | null, "bool" | "int" | "float" | "difficulty" | "email_provider" | "secret_str" | "str"];

function controlSpecs(): Record<string, Record<string, Spec>> {
  const tierSpecs = (t: string): Record<string, Spec> => ({
    [`${t}_angle_noise`]: [0, 45, "float"],
    [`${t}_power_spread`]: [0, 0.5, "float"],
    [`${t}_wind_skill`]: [0, 1, "float"],
    [`${t}_reaction`]: [0, 10, "float"],
    [`${t}_rank_offset`]: [0, 18, "int"],
    [`${t}_shield_chance`]: [0, 1, "float"],
    [`${t}_mega_chance`]: [0, 1, "float"],
    [`${t}_double_ammo`]: [0, 99, "int"],
    [`${t}_homing_ammo`]: [0, 99, "int"],
    [`${t}_cluster_ammo`]: [0, 99, "int"],
    [`${t}_weapon_skill`]: [0, 1, "float"],
    [`${t}_shield_hp`]: [0, 1, "float"],
    [`${t}_shield_damage`]: [0, 1000, "float"],
    [`${t}_move_chance`]: [0, 1, "float"],
    [`${t}_memory`]: [0, 20, "int"],
    [`${t}_correction`]: [0, 1, "float"],
    [`${t}_aggression`]: [0, 1, "float"],
  });
  return {
    auth_flow: {
      popup_enabled: [null, null, "bool"], redirect_enabled: [null, null, "bool"],
      email_code_enabled: [null, null, "bool"], email_provider: [null, null, "email_provider"],
      inboxlv_pass: [null, null, "secret_str"],
    },
    bot_fallback: { enabled: [null, null, "bool"], wait_seconds: [5, 300, "int"],
      difficulty: [null, null, "difficulty"] },
    invite_system: { enabled: [null, null, "bool"], max_per_day: [1, 100, "int"],
      tag_name: [null, null, "str"], invite_text: [null, null, "str"] },
    xp: { human_win: [0, 100, "float"], bot_win: [0, 100, "float"], per_damage: [0, 1, "float"] },
    premium_skins: { enabled: [null, null, "bool"], asset_budget_kb: [10, 500, "int"] },
    coatings: {
      enabled: [null, null, "bool"], max_level: [1, 3, "int"], build_minutes: [0.01, 10080, "float"],
      wood_price: [0, 100000, "int"], wood_minutes: [0.01, 10080, "float"], wood_hp: [1, 10000, "float"],
      tin_price: [0, 100000, "int"], tin_minutes: [0.01, 10080, "float"], tin_hp: [1, 10000, "float"],
      iron_price: [0, 100000, "int"], iron_minutes: [0.01, 10080, "float"], iron_hp: [1, 10000, "float"],
    },
    tower_expansion: {
      enabled: [null, null, "bool"], max_extra_cubes: [0, 24, "int"],
      build_minutes: [0.01, 10080, "float"], cube_price: [0, 100000, "int"], cube_hp: [1, 10000, "float"],
    },
    dynamic_obstacle: {
      enabled: [null, null, "bool"], speed: [1, 200, "float"], warning_seconds: [0, 10, "float"],
    },
    bot_system: {
      enabled: [null, null, "bool"], special_weapons: [null, null, "bool"],
      double_bomb: [null, null, "bool"], homing_missile: [null, null, "bool"],
      cluster_shell: [null, null, "bool"], movement: [null, null, "bool"],
      reactive_shield: [null, null, "bool"], tactical_mega: [null, null, "bool"],
      adaptation: [null, null, "bool"], infinite_ammo: [null, null, "bool"],
      deep_aim: [null, null, "bool"], coating_aware: [null, null, "bool"],
    },
    bot_tower_parity: {
      enabled: [null, null, "bool"],
      easy_pct: [0.1, 2.0, "float"], medium_pct: [0.1, 2.0, "float"],
      hard_pct: [0.1, 2.0, "float"], ultra_pct: [0.1, 2.0, "float"],
      expert_pct: [0.1, 2.0, "float"],
      match_coating: [null, null, "bool"],
    },
    bot_difficulty: {
      ...tierSpecs("easy"), ...tierSpecs("medium"), ...tierSpecs("hard"),
      ...tierSpecs("ultra"), ...tierSpecs("expert"),
    },
  };
}

export async function handleAdminApi(env: Env, request: Request, path: string): Promise<Response | null> {
  if (!path.startsWith("/api/admin/")) return null;
  const u = await adminUser(env, request);
  if (u instanceof Response) return u;
  const rl = await limited(env, request, "admin", u);
  if (rl) return rl;
  const method = request.method;
  const db = env.DB;

  // GET /api/admin/overview
  if (path === "/api/admin/overview" && method === "GET") {
    const one = async (sql: string, ...params: any[]) =>
      Number(((await db.prepare(sql).bind(...params).first()) as any)?.c ?? 0);
    const stats = {
      users_total: await one("SELECT COUNT(*) c FROM users"),
      users_today: await one("SELECT COUNT(*) c FROM users WHERE last_login >= ?", today()),
      matches_total: await one("SELECT COUNT(*) c FROM matches"),
      matches_active: await one("SELECT COUNT(*) c FROM matches WHERE status IN ('active','waiting')"),
      coins_issued: await one("SELECT COALESCE(SUM(delta),0) c FROM transactions WHERE delta > 0"),
      coins_spent: await one("SELECT COALESCE(-SUM(delta),0) c FROM transactions WHERE delta < 0"),
      purchases: await one("SELECT COUNT(*) c FROM transactions WHERE reason = 'purchase'"),
      banned: await one("SELECT COUNT(*) c FROM users WHERE suspended = 1 OR (banned_until IS NOT NULL AND banned_until > ?)", nowIso()),
    };
    const recent = await db.prepare(
      "SELECT t.created_at, u.email, t.delta, t.reason, t.ref"
      + " FROM transactions t JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 30").all();
    return json({ stats, recent_transactions: recent.results });
  }

  // GET /api/admin/online - who is connected right now (presence ping <= 45s)
  if (path === "/api/admin/online" && method === "GET") {
    const cutoff = new Date(Date.now() - 45 * 1000).toISOString();
    const rows = await db.prepare(
      "SELECT id, name, email, picture, last_seen FROM users WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 200")
      .bind(cutoff).all();
    return json({ count: rows.results.length, users: rows.results });
  }

  // GET /api/admin/users?q=
  if (path === "/api/admin/users" && method === "GET") {
    const term = `%${(new URL(request.url).searchParams.get("q") ?? "").trim()}%`;
    const rows = await db.prepare(
      "SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 100")
      .bind(term, term).all();
    return json({ users: (rows.results as any[]).map((r) => ({
      id: r.id, email: r.email, name: r.name, coins: r.coins, rating: r.rating,
      wins: r.wins, idf_rank: rankPayload(Number(r.rank_points)), losses: r.losses,
      suspended: Boolean(r.suspended), banned_until: r.banned_until,
      created_at: r.created_at, last_login: r.last_login,
    })) });
  }

  // POST /api/admin/users/<uid>/moderate
  const modMatch = path.match(/^\/api\/admin\/users\/(\d+)\/moderate$/);
  if (modMatch && method === "POST") {
    const uid = Number(modMatch[1]);
    const body: any = await request.json().catch(() => ({}));
    const action = body.action;
    const target: any = await db.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
    if (!target) return json({ error: "not_found" }, 404);
    if (String(target.email).toLowerCase() === String(env.ADMIN_EMAIL).toLowerCase()) {
      return json({ error: "cannot_moderate_admin" }, 400);
    }
    let msg: string;
    if (action === "ban") {
      const hours = Number.parseInt(String(body.hours ?? 24), 10);
      if (!Number.isFinite(hours)) return json({ error: "bad_hours" }, 400);
      const clamped = Math.max(1, Math.min(24 * 365, hours));
      const until = new Date(Date.now() + clamped * 3600_000).toISOString();
      await db.prepare("UPDATE users SET banned_until = ? WHERE id = ?").bind(until, uid).run();
      msg = `banned until ${until}`;
    } else if (action === "suspend") {
      await db.prepare("UPDATE users SET suspended = 1 WHERE id = ?").bind(uid).run();
      msg = "suspended";
    } else if (action === "lift") {
      await db.prepare("UPDATE users SET suspended = 0, banned_until = NULL WHERE id = ?").bind(uid).run();
      msg = "restrictions lifted";
    } else {
      return json({ error: "bad_action" }, 400);
    }
    await db.prepare("INSERT INTO messages (user_id, title, body, created_at) VALUES (?,?,?,?)")
      .bind(uid, "עדכון מהנהלת Brigagame", `סטטוס החשבון שלך עודכן: ${msg}.`, nowIso()).run();
    await audit(env, request, Number(u.id), "admin.moderate", "user", uid, { action, result: msg });
    return json({ ok: true, result: msg });
  }

  // POST /api/admin/users/<uid>/coins
  const coinsMatch = path.match(/^\/api\/admin\/users\/(\d+)\/coins$/);
  if (coinsMatch && method === "POST") {
    const uid = Number(coinsMatch[1]);
    const body: any = await request.json().catch(() => ({}));
    const delta = Number.parseInt(String(body.delta ?? 0), 10);
    const reason = String(body.reason ?? "admin_adjustment").slice(0, 120);
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100000) {
      return json({ error: "bad_delta" }, 400);
    }
    const exists = await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(uid).first();
    if (!exists) return json({ error: "not_found" }, 404);
    await addCoins(d1(db), uid, delta, reason);
    const after: any = await db.prepare("SELECT coins FROM users WHERE id = ?").bind(uid).first();
    await audit(env, request, Number(u.id), "admin.coins", "user", uid, { delta, reason });
    return json({ ok: true, coins: after.coins });
  }

  // POST /api/admin/broadcast
  if (path === "/api/admin/broadcast" && method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const title = String(body.title ?? "").trim().slice(0, 120);
    const text = String(body.body ?? "").trim().slice(0, 2000);
    if (!title || !text) return json({ error: "missing_fields" }, 400);
    await db.prepare("INSERT INTO messages (user_id, title, body, created_at) VALUES (NULL,?,?,?)")
      .bind(title, text, nowIso()).run();
    await audit(env, request, Number(u.id), "admin.broadcast", "", "", { title });
    return json({ ok: true });
  }

  // GET|POST /api/admin/maintenance
  if (path === "/api/admin/maintenance" && method === "GET") {
    return json(await getMaintenance(env));
  }
  if (path === "/api/admin/maintenance" && method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const on = Boolean(body.on);
    const message = String(body.message ?? "").trim().slice(0, 300);
    await db.prepare(
      "INSERT INTO settings (key, value) VALUES ('maintenance', ?)"
      + " ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify({ on, message })).run();
    await audit(env, request, Number(u.id), "admin.maintenance", "", "", { on, message });
    return json({ ok: true, maintenance: await getMaintenance(env) });
  }

  // GET|POST /api/admin/gameplay-controls
  if (path === "/api/admin/gameplay-controls" && method === "GET") {
    const controls: any = await getControls(env);
    const af = controls.auth_flow ?? {};
    af.inboxlv_pass_set = Boolean(String(af.inboxlv_pass ?? ""));
    af.inboxlv_pass = "";
    return json({ controls });
  }
  if (path === "/api/admin/gameplay-controls" && method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    if (body.reset === true) {
      const current = JSON.parse(JSON.stringify(DEFAULT_GAMEPLAY_CONTROLS));
      await db.prepare(
        "INSERT INTO settings (key, value) VALUES ('gameplay_controls', ?)"
        + " ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(JSON.stringify(current)).run();
      await audit(env, request, Number(u.id), "admin.gameplay_controls_reset", "", "", current);
      return json({ ok: true, controls: current });
    }
    const raw = body.controls;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "bad_controls" }, 400);
    }
    const current = await getControls(env);
    const specs = controlSpecs();
    try {
      for (const [section, fields] of Object.entries(specs)) {
        const incoming = raw[section] ?? {};
        if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
          throw new Error("bad");
        }
        for (const [key, [lo, hi, kind]] of Object.entries(fields)) {
          if (!(key in incoming)) continue;
          let value = incoming[key];
          if (kind === "bool") {
            if (typeof value !== "boolean") throw new Error("bad");
          } else if (kind === "difficulty") {
            value = String(value);
            if (!["easy", "medium", "hard", "ultra", "expert"].includes(value)) throw new Error("bad");
          } else if (kind === "email_provider") {
            value = String(value);
            if (!["resend", "inboxlv"].includes(value)) throw new Error("bad");
          } else if (kind === "str") {
            value = String(value ?? "").trim().slice(0, 300);
            if (!value) throw new Error("bad");
          } else if (kind === "secret_str") {
            value = String(value ?? "").trim();
            if (!value) continue; // never overwrite a stored secret with empty
          } else {
            value = kind === "int" ? Math.trunc(Number(value)) : Number(value);
            if (!Number.isFinite(value) || (lo != null && value < lo) || (hi != null && value > hi)) {
              throw new Error("bad");
            }
          }
          current[section][key] = value;
        }
      }
    } catch {
      return json({ error: "bad_controls" }, 400);
    }
    await db.prepare(
      "INSERT INTO settings (key, value) VALUES ('gameplay_controls', ?)"
      + " ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(current)).run();
    await audit(env, request, Number(u.id), "admin.gameplay_controls", "", "", current);
    return json({ ok: true, controls: current });
  }

  // GET /api/admin/cosmetics
  if (path === "/api/admin/cosmetics" && method === "GET") {
    const overrides = await db.prepare("SELECT item_id, price, available FROM cosmetic_overrides").all();
    const ov: Record<string, any> = {};
    for (const r of overrides.results as any[]) ov[r.item_id] = r;
    const cosmetics = Object.entries(CATALOG)
      .filter(([, v]: any) => v.kind === "skin")
      .map(([k, v]: any) => ({
        item_id: k, ...v,
        price: ov[k] ? ov[k].price : v.price,
        available: ov[k] ? Boolean(ov[k].available) : v.available !== false,
      }));
    return json({ cosmetics });
  }

  // POST /api/admin/cosmetics/<item_id>
  const cosmMatch = path.match(/^\/api\/admin\/cosmetics\/([A-Za-z0-9_]+)$/);
  if (cosmMatch && method === "POST") {
    const itemId = cosmMatch[1];
    const base: any = (CATALOG as any)[itemId];
    if (!base || base.kind !== "skin") return json({ error: "unknown_cosmetic" }, 404);
    const body: any = await request.json().catch(() => ({}));
    const price = Number.parseInt(String(body.price ?? base.price), 10);
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      return json({ error: "bad_price" }, 400);
    }
    const available = Boolean(body.available ?? true);
    await db.prepare(
      "INSERT INTO cosmetic_overrides (item_id, price, available, updated_by, updated_at)"
      + " VALUES (?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET price=excluded.price,"
      + " available=excluded.available, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
      .bind(itemId, price, available ? 1 : 0, Number(u.id), nowIso()).run();
    await audit(env, request, Number(u.id), "admin.cosmetic_update", "item", itemId, { price, available });
    return json({ ok: true, item_id: itemId, price, available });
  }

  // GET /api/admin/coupons
  if (path === "/api/admin/coupons" && method === "GET") {
    const rows = await db.prepare("SELECT * FROM coupons ORDER BY created_at DESC LIMIT 100").all();
    return json({ coupons: rows.results });
  }

  // POST /api/admin/coupons
  if (path === "/api/admin/coupons" && method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const kind = String(body.kind ?? "coins");
    const code = String(body.code ?? crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase())
      .trim().toUpperCase();
    let amount: number; let itemId: string | null;
    if (kind === "coins") {
      amount = Number.parseInt(String(body.amount ?? 100), 10);
      if (!Number.isFinite(amount)) return json({ error: "bad_amount" }, 400);
      amount = Math.max(1, Math.min(100000, amount));
      itemId = null;
    } else if (kind === "item" && (CATALOG as any)[body.item_id]) {
      amount = 0; itemId = String(body.item_id);
    } else {
      return json({ error: "bad_kind" }, 400);
    }
    let maxUses = Number.parseInt(String(body.max_uses ?? 1), 10);
    if (!Number.isFinite(maxUses)) return json({ error: "bad_max_uses" }, 400);
    maxUses = Math.max(1, Math.min(100000, maxUses));
    if (!code || code.length > 32 || !/^[A-Z0-9\-_]+$/.test(code)) {
      return json({ error: "bad_code" }, 400);
    }
    let expiresAt: string | null = body.expires_at ? String(body.expires_at) : null;
    if (expiresAt) {
      if (Number.isNaN(Date.parse(expiresAt.replace("Z", "+00:00")))) {
        return json({ error: "bad_expiry" }, 400);
      }
    }
    const existing = await db.prepare("SELECT 1 FROM coupons WHERE code = ?").bind(code).first();
    if (existing) return json({ error: "code_exists" }, 400);
    await db.prepare(
      "INSERT INTO coupons (code, kind, amount, item_id, max_uses, expires_at, created_by, created_at)"
      + " VALUES (?,?,?,?,?,?,?,?)")
      .bind(code, kind, amount, itemId, maxUses, expiresAt, Number(u.id), nowIso()).run();
    await audit(env, request, Number(u.id), "admin.coupon_create", "coupon", code, { kind, max_uses: maxUses });
    return json({ ok: true, code });
  }

  // DELETE /api/admin/coupons/<code>
  const couponDel = path.match(/^\/api\/admin\/coupons\/([A-Za-z0-9\-_]+)$/);
  if (couponDel && method === "DELETE") {
    const code = couponDel[1].toUpperCase();
    await db.prepare("DELETE FROM coupons WHERE code = ?").bind(code).run();
    await audit(env, request, Number(u.id), "admin.coupon_delete", "coupon", code);
    return json({ ok: true });
  }

  // GET /api/admin/audit
  if (path === "/api/admin/audit" && method === "GET") {
    const rows = await db.prepare(
      "SELECT a.id, a.created_at, a.action, a.target_type, a.target_id,"
      + " a.details, a.ip_hash, a.user_agent, u.email actor_email"
      + " FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id"
      + " ORDER BY a.id DESC LIMIT 200").all();
    return json({ audit: rows.results,
      notice: "רישום תפעולי ואבטחתי ממוזער; כתובות IP אינן נשמרות גלויות." });
  }

  // GET /api/admin/matches
  if (path === "/api/admin/matches" && method === "GET") {
    const rows = await db.prepare(
      "SELECT id, mode, status, version, created_at, updated_at FROM matches"
      + " ORDER BY updated_at DESC LIMIT 50").all();
    return json({ matches: rows.results });
  }

  return null;
}

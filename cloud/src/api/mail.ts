/**
 * Player e-mail updates: opt-in storage, one-click unsubscribe, Brevo sending.
 * Everything here is gated by gameplay_controls.mail_updates (admin, server-side).
 * Tables are created lazily (idempotent) so no manual migration is needed.
 */
import { getControls } from "../util.js";
import type { Env } from "../do/MatchRoom";

const nowIso = () => new Date().toISOString();
const SITE = "https://brigagame.ubriga.workers.dev";

let _ready: Promise<void> | null = null;
export function ensureMailSchema(env: Env): Promise<void> {
  if (_ready) return _ready;
  _ready = (async () => {
    const db = env.DB;
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS mail_optin (user_id INTEGER PRIMARY KEY,"
        + " opted_in INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0,"
        + " source TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS mail_send_log (id INTEGER PRIMARY KEY AUTOINCREMENT,"
        + " campaign TEXT NOT NULL, user_id INTEGER NOT NULL, day TEXT NOT NULL,"
        + " status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(campaign, user_id))"),
    ]);
    const done = await db.prepare("SELECT value FROM settings WHERE key = 'mail_backfill_done'").first();
    if (!done) {
      // Existing registered players are marked as opted in (owner decision).
      await db.prepare("INSERT OR IGNORE INTO mail_optin (user_id, opted_in, excluded, source, updated_at)"
        + " SELECT id, 1, 0, 'existing_backfill', ? FROM users"
        + " WHERE is_guest = 0 AND email NOT LIKE '%@guest.local'").bind(nowIso()).run();
      await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('mail_backfill_done', ?)")
        .bind(nowIso()).run();
    }
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

export async function mailSettings(env: Env): Promise<any> {
  const c = (await getControls(env)).mail_updates ?? {};
  return {
    enabled: c.enabled === true,
    default_checked: c.default_checked !== false,
    daily_cap: Math.max(0, Math.min(300, Number(c.daily_cap ?? 250))),
    sender_email: String(c.sender_email || "brigagame.game@inbox.lv"),
    brevo_key: String(c.brevo_key ?? ""),
    webhook_secret: String(c.webhook_secret ?? ""),
    api_base: String((env as any).BREVO_API_BASE ?? ""),
  };
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  const db = env.DB;
  let row: any = await db.prepare("SELECT value FROM settings WHERE key = 'mail_hmac_key'").first();
  if (!row) {
    const k = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
    await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('mail_hmac_key', ?)").bind(k).run();
    row = await db.prepare("SELECT value FROM settings WHERE key = 'mail_hmac_key'").first();
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(String(row.value)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env: Env, uid: number): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode("unsub:" + uid));
  return [...new Uint8Array(sig)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function unsubUrl(env: Env, uid: number): Promise<string> {
  return `${SITE}/api/mail/unsub?t=${uid}.${await sign(env, uid)}`;
}

export async function setOptIn(env: Env, userId: number, optedIn: boolean, source: string): Promise<void> {
  await ensureMailSchema(env);
  await env.DB.prepare("INSERT INTO mail_optin (user_id, opted_in, excluded, source, updated_at) VALUES (?,?,0,?,?)"
    + " ON CONFLICT(user_id) DO UPDATE SET opted_in=excluded.opted_in, source=excluded.source, updated_at=excluded.updated_at")
    .bind(userId, optedIn ? 1 : 0, source, nowIso()).run();
}

/** Signup consent: only when the feature is on; the stored value is what the
 * visitor's checkbox said. Never touches an existing preference. */
export async function recordSignupOptIn(env: Env, userId: number, wanted: unknown, source: string): Promise<void> {
  try {
    const s = await mailSettings(env);
    if (!s.enabled) return;
    await ensureMailSchema(env);
    await env.DB.prepare("INSERT OR IGNORE INTO mail_optin (user_id, opted_in, excluded, source, updated_at) VALUES (?,?,0,?,?)")
      .bind(userId, wanted === true || wanted === 1 || wanted === "1" ? 1 : 0, source, nowIso()).run();
  } catch (e) { console.error("mail_optin_signup_fail", String((e as any)?.message ?? e)); }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);

export function renderMail(subject: string, body: string, name: string, unsub: string, existing = false) {
  const who = name && !name.includes("@") ? name : "שחקן יקר";
  const intro = existing
    ? `קיבלת את המייל הזה כי נרשמת למשחק Brigagame 2.0. לא רוצה לקבל עדכונים כאלה? אפשר להסיר את עצמך בלחיצה אחת: ${unsub}\n\n`
    : "";
  const text0 = intro + body.replaceAll("{name}", who);
  const why = existing ? "קיבלת את המייל הזה כי נרשמת למשחק." : "קיבלת את המייל הזה כי הסכמת לקבל עדכונים על המשחק.";
  const footerText = `\n\n--\nנשלח מ-Brigagame 2.0 (OrelAI) - ${SITE}\n${why}\nלהסרה מהרשימה בלחיצה אחת: ${unsub}`;
  const text = text0 + footerText;
  const introHtml = existing
    ? `<div style="background:#fff4d6;border:1px solid #e0b84a;border-radius:8px;padding:12px;margin-bottom:16px;font-size:15px">`
      + `קיבלת את המייל הזה כי נרשמת למשחק Brigagame 2.0.<br>לא רוצה לקבל עדכונים כאלה? <a href="${unsub}" style="font-weight:bold;font-size:17px">הסר אותי מהרשימה בלחיצה אחת</a></div>`
    : "";
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#111">` + introHtml
    + esc(body.replaceAll("{name}", who)).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")
    + `<hr style="border:none;border-top:1px solid #ccc;margin:24px 0">`
    + `<p style="font-size:13px;color:#555">נשלח מ-Brigagame 2.0 (OrelAI) - <a href="${SITE}">${SITE}</a><br>`
    + `${why}<br>`
    + `<a href="${unsub}">להסרה מהרשימה בלחיצה אחת</a></p></div>`;
  return { subject: subject.replaceAll("{name}", who), text, html };
}

export async function sendBrevo(s: any, to: string, name: string, m: { subject: string; text: string; html: string }, unsub: string):
  Promise<{ ok: boolean; permanent?: boolean; error?: string }> {
  if (!s.brevo_key) return { ok: false, error: "no_key" };
  const res = await fetch(((s as any).api_base || "https://api.brevo.com") + "/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": s.brevo_key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Brigagame 2.0", email: s.sender_email },
      to: [{ email: to, name: name && !name.includes("@") ? name.slice(0, 60) : undefined }],
      subject: m.subject, htmlContent: m.html, textContent: m.text,
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
  });
  if (res.ok) return { ok: true };
  const t = (await res.text()).slice(0, 300);
  // 400 invalid_parameter on the address = permanently undeliverable.
  const permanent = res.status === 400 && /invalid|email/i.test(t) && !/sender|api/i.test(t);
  return { ok: false, permanent, error: res.status + " " + t };
}

const page = (title: string, body: string) => new Response(
  `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<title>${esc(title)}</title><body style="font-family:Arial,sans-serif;background:#0b1120;color:#e5e7eb;display:flex;justify-content:center;padding:40px 16px">`
  + `<div style="max-width:440px;text-align:center"><h1>${esc(title)}</h1>${body}</div></body></html>`,
  { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export async function handleMailPublic(env: Env, request: Request, path: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (path === "/api/mail/unsub") {
    const t = String(url.searchParams.get("t") ?? "");
    const m = t.match(/^(\d+)\.([0-9a-f]{32})$/);
    if (!m || (await sign(env, Number(m[1]))) !== m[2])
      return page("הקישור לא תקין", "<p>לא הצלחנו לאמת את הקישור.</p>");
    await ensureMailSchema(env);
    const uid = Number(m[1]);
    const resub = url.searchParams.get("resub") === "1" && request.method === "GET";
    if (resub) {
      await setOptIn(env, uid, true, "resubscribe");
      return page("נרשמת מחדש", "<p>תקבל שוב עדכונים על המשחק.</p>");
    }
    await setOptIn(env, uid, false, "unsubscribe_link");
    const back = `${SITE}/api/mail/unsub?t=${t}&resub=1`;
    return page("הוסרת מהרשימה",
      `<p>לא תקבל יותר עדכונים על Brigagame 2.0 במייל.</p><p style="font-size:14px"><a style="color:#93c5fd" href="${back}">טעות? לחץ כאן כדי להירשם מחדש</a></p>`);
  }
  if (path === "/api/mail/brevo-webhook" && request.method === "POST") {
    const s = await mailSettings(env);
    if (!s.webhook_secret || url.searchParams.get("s") !== s.webhook_secret) return new Response("no", { status: 403 });
    const ev: any = await request.json().catch(() => ({}));
    const kind = String(ev.event ?? "");
    const email = String(ev.email ?? "").trim().toLowerCase();
    if (email && ["hard_bounce", "blocked", "invalid_email", "spam", "unsubscribed", "complaint"].includes(kind)) {
      await ensureMailSchema(env);
      await env.DB.prepare("UPDATE mail_optin SET opted_in = 0, source = ?, updated_at = ?"
        + " WHERE user_id = (SELECT id FROM users WHERE lower(email) = ?)")
        .bind("auto_" + kind, nowIso(), email).run();
    }
    return new Response("ok");
  }
  return null;
}

export const DEFAULT_TEMPLATE = {
  subject: "עדכון חדש ב-Brigagame 2.0",
  body: "שלום {name},\n\nזה העדכון הראשון שלנו על Brigagame 2.0. הוספנו להסביר מה חדש במשחק:\n\n- ...\n\nנתראה בזירה,\nצוות Brigagame 2.0",
};

export async function handleMailAdmin(env: Env, request: Request, path: string, adminId: number): Promise<Response | null> {
  const J = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json" } });
  const db = env.DB;
  if (path === "/api/admin/mail/status" && request.method === "GET") {
    await ensureMailSchema(env);
    const s = await mailSettings(env);
    const tpl: any = await db.prepare("SELECT value FROM settings WHERE key = 'mail_template'").first();
    let template = DEFAULT_TEMPLATE;
    try { if (tpl) template = { ...DEFAULT_TEMPLATE, ...JSON.parse(String(tpl.value)) }; } catch { /* default */ }
    const day = nowIso().slice(0, 10);
    const used: any = await db.prepare("SELECT COUNT(*) c FROM mail_send_log WHERE day = ? AND status = 'sent'").bind(day).first();
    const rows: any = await db.prepare(
      "SELECT u.id, u.email, u.name, m.opted_in, m.excluded FROM mail_optin m JOIN users u ON u.id = m.user_id"
      + " WHERE u.is_guest = 0 ORDER BY u.id LIMIT 1000").all();
    return J({
      enabled: s.enabled, default_checked: s.default_checked, daily_cap: s.daily_cap,
      key_set: Boolean(s.brevo_key), sender_email: s.sender_email,
      sent_today: Number(used?.c ?? 0), template,
      recipients: rows.results.map((r: any) => ({
        id: r.id, email: r.email, name: r.name, opted_in: Boolean(r.opted_in), excluded: Boolean(r.excluded) })),
    });
  }
  if (path === "/api/admin/mail/template" && request.method === "POST") {
    const b: any = await request.json().catch(() => ({}));
    const subject = String(b.subject ?? "").trim().slice(0, 200);
    const body = String(b.body ?? "").trim().slice(0, 8000);
    if (!subject || !body) return J({ error: "empty", error_he: "הנושא והתוכן לא יכולים להיות ריקים." }, 400);
    await db.prepare("INSERT INTO settings (key, value) VALUES ('mail_template', ?)"
      + " ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ subject, body })).run();
    return J({ ok: true });
  }
  if (path === "/api/admin/mail/preview" && request.method === "POST") {
    const b: any = await request.json().catch(() => ({}));
    const m = renderMail(String(b.subject ?? "").slice(0, 200), String(b.body ?? "").slice(0, 8000), "דנה", SITE + "/api/mail/unsub?t=example", b.existing !== false);
    return J({ subject: m.subject, html: m.html, text: m.text });
  }
  if (path === "/api/admin/mail/exclude" && request.method === "POST") {
    await ensureMailSchema(env);
    const b: any = await request.json().catch(() => ({}));
    await db.prepare("UPDATE mail_optin SET excluded = ?, updated_at = ? WHERE user_id = ?")
      .bind(b.excluded ? 1 : 0, nowIso(), Math.trunc(Number(b.user_id))).run();
    return J({ ok: true });
  }
  if (path === "/api/admin/mail/send-batch" && request.method === "POST") {
    await ensureMailSchema(env);
    const s = await mailSettings(env);
    if (!s.enabled) return J({ error: "disabled", error_he: "מנגנון המייל כבוי בשליטת האדמין." }, 403);
    if (!s.brevo_key) return J({ error: "no_key", error_he: "מפתח הספק עדיין לא הוגדר." }, 503);
    const b: any = await request.json().catch(() => ({}));
    const campaign = String(b.campaign ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    const subject = String(b.subject ?? "").trim().slice(0, 200);
    const body = String(b.body ?? "").trim().slice(0, 8000);
    const ids: number[] = (Array.isArray(b.ids) ? b.ids : []).map((x: any) => Math.trunc(Number(x))).filter((x: number) => x > 0).slice(0, 15);
    if (!campaign || !subject || !body || !ids.length) return J({ error: "bad_request", error_he: "בקשה לא תקינה." }, 400);
    const day = nowIso().slice(0, 10);
    const used: any = await db.prepare("SELECT COUNT(*) c FROM mail_send_log WHERE day = ? AND status = 'sent'").bind(day).first();
    let remaining = Math.max(0, s.daily_cap - Number(used?.c ?? 0));
    const out = { sent: 0, skipped: 0, failed: 0, capped: 0, errors: [] as string[] };
    for (const id of ids) {
      // Only currently opted-in, non-excluded, real accounts - re-checked server-side.
      const r: any = await db.prepare(
        "SELECT u.id, u.email, u.name, m.source FROM mail_optin m JOIN users u ON u.id = m.user_id"
        + " WHERE m.user_id = ? AND m.opted_in = 1 AND m.excluded = 0 AND u.is_guest = 0 AND u.email NOT LIKE '%@guest.local'")
        .bind(id).first();
      const dup: any = await db.prepare("SELECT 1 x FROM mail_send_log WHERE campaign = ? AND user_id = ?").bind(campaign, id).first();
      if (!r || dup) { out.skipped++; continue; }
      if (remaining <= 0) { out.capped++; continue; }
      const unsub = await unsubUrl(env, id);
      const m = renderMail(subject, body, String(r.name ?? ""), unsub, String(r.source) === "existing_backfill");
      const res = await sendBrevo(s, String(r.email), String(r.name ?? ""), m, unsub);
      if (res.ok) {
        remaining--; out.sent++;
        await db.prepare("INSERT OR IGNORE INTO mail_send_log (campaign, user_id, day, status, created_at) VALUES (?,?,?,?,?)")
          .bind(campaign, id, day, "sent", nowIso()).run();
      } else {
        out.failed++;
        if (out.errors.length < 3) out.errors.push(String(res.error ?? "").slice(0, 160));
        if (res.permanent) await setOptIn(env, id, false, "auto_invalid_address");
      }
    }
    await db.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at) VALUES (?,?,?,?,?,?)")
      .bind(adminId, "admin.mail_send", "campaign", campaign, JSON.stringify({ n: out.sent, failed: out.failed }), nowIso()).run().catch(() => {});
    return J(out);
  }
  return null;
}

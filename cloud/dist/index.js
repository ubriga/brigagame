/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/**
 * Brigagame 2.0 - Cloudflare Worker entry.
 * Routes API requests, upgrades match WebSockets to the MatchRoom DO,
 * serves the static PWA via Workers assets. Parallel copy of the PA
 * backend; the PythonAnywhere game stays untouched until cutover.
 */
import { MatchRoom } from "./do/MatchRoom";
import { verifyGoogleCredential, getOrCreateUser, createSession, destroySession, currentUser, sha256Hex } from "./auth.js";
import { handleApi } from "./api/routes.js";
import { limited } from "./api/ratelimit.js";
import { handleMatchApi } from "./api/matches.js";
import { createAiMatch } from "./api/matchmaking.js";
import { handleAdminApi } from "./api/admin.js";
import { handleCourtyard } from "./api/courtyard.js";
import { mailDripTick, ensureMailSchema, handleMailPublic, recordSignupOptIn, mailSettings, sendGameMail } from "./api/mail.js";
import { getGuestCfg, createGuest, upgradeGuestIfPresent, sweepExpiredGuests } from "./api/guest.js";
import { d1, getControls, getShabbatLockdown } from "./util.js";
export { MatchRoom };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
// Cross-origin access: the public frontend lives on GitHub Pages
// (ubriga.github.io) while the API lives on the Worker. Bearer-token auth, no
// cookies - echo only the known frontend origins.
const CORS_ORIGINS = new Set([
    "https://ubriga.github.io",
    "https://brigagame.ubriga.workers.dev",
]);
function withCors(request, res) {
    if (res.status === 101)
        return res;
    const origin = request.headers.get("Origin") ?? "";
    if (!CORS_ORIGINS.has(origin))
        return res;
    const h = new Headers(res.headers);
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
// Where the Google callback sends the browser after sign-in. Defaults to the
// Worker's own origin (test env); set FRONTEND_ORIGIN to the public site.
function frontendBase(env, url) {
    return String(env.FRONTEND_ORIGIN ?? "").replace(/\/+$/, "") || url.origin;
}
export default {
    async scheduled(_event, env, ctx) {
        ctx.waitUntil(mailDripTick(env).then(r => console.log("mail_drip", JSON.stringify(r))).catch(e => console.log("mail_drip_error", String(e))));
    },
    async fetch(request, env, ctx) {
        const corsUrl = new URL(request.url);
        if (request.method === "OPTIONS" && corsUrl.pathname.startsWith("/api/")) {
            const origin = request.headers.get("Origin") ?? "";
            if (!CORS_ORIGINS.has(origin))
                return new Response(null, { status: 403 });
            return new Response(null, { status: 204, headers: {
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Authorization, Content-Type",
                    "Access-Control-Max-Age": "7200",
                    "Vary": "Origin",
                } });
        }
        return withCors(request, await handleRequest(request, env, ctx));
    },
};
async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    // Diagnostic: the frontend beacons here the moment the Google callback
    // fires, so a broken popup return-leg is distinguishable from a failed POST.
    if (path === "/api/diag/gsi-callback" && request.method === "POST") {
        try {
            const body = await request.text().catch(() => "");
            await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                + " VALUES (NULL, 'gsi_callback_seen', 'auth', '', ?, ?)")
                .bind(JSON.stringify({ body: body.slice(0, 120) }), new Date().toISOString()).run();
        }
        catch (_) { }
        return new Response(null, { status: 204 });
    }
    // ---- Shabbat / holiday lockdown (server-enforced full-site gate) ----
    // Public status endpoint: the client boot reads this to decide whether to
    // render the lock screen. Texts are exposed only while active.
    if (path === "/api/lockdown" && request.method === "GET") {
        const lock = await getShabbatLockdown(env);
        if (!lock.active)
            return json({ active: false });
        return json({ active: true, title: lock.title, body: lock.body, ends_at: lock.effective_end });
    }
    // The gate itself: every API route (auth included, WebSocket included) is
    // closed to non-admins while active. Admin sessions pass so the admin can
    // manage and lift the lockdown. /api/health stays open for monitoring.
    // During lockdown the Google sign-in path stays open so the admin can
    // log in; session issuance itself is gated on the admin email below.
    const AUTH_OPEN = new Set(["/api/mail/unsub", "/api/auth/options", "/api/auth/google/start", "/api/auth/google/callback", "/api/auth/google"]);
    if (path.startsWith("/api/") && path !== "/api/health" && !path.startsWith("/api/admin/") && !AUTH_OPEN.has(path)) {
        const lock = await getShabbatLockdown(env);
        if (lock.active) {
            const u = await currentUser(d1(env.DB), request).catch(() => null);
            const admin = u && String(u.email).toLowerCase() === String(env.ADMIN_EMAIL ?? "").toLowerCase();
            if (!admin) {
                return json({ error: "lockdown", title: lock.title, body: lock.body, ends_at: lock.effective_end }, 503);
            }
        }
    }
    if (path.startsWith("/api/mail/")) {
        const mp = await handleMailPublic(env, request, path);
        if (mp)
            return mp;
    }
    // ---- Sign-in method toggles (public; admin-controlled) ----
    if (path === "/api/auth/options" && request.method === "GET") {
        const controls = await getControls(env);
        const af = controls.auth_flow ?? {};
        const lockNow = await getShabbatLockdown(env);
        await ensureMailSchema(env).catch(() => { });
        const ms = await mailSettings(env);
        return json({
            mail_optin: ms.enabled, mail_default: ms.default_checked,
            popup: af.popup_enabled !== false,
            redirect: af.redirect_enabled === true,
            email_code: af.email_code_enabled === true && !lockNow.active,
            email_from: ms.sender_email,
            // Installed-PWA logins: the Google redirect leaves the app storage, so
            // the client emphasizes the email-code path unless the admin disables it.
            pwa_email_hint: af.pwa_email_hint !== false,
            guest_enabled: !lockNow.active && controls.guest_mode?.enabled !== false,
        });
    }
    // ---- Server-side OAuth redirect flow (no popup; works in webviews) ----
    if (path === "/api/auth/google/start" && request.method === "GET") {
        const controls = await getControls(env);
        if (controls.auth_flow?.redirect_enabled !== true)
            return json({ error: "redirect_disabled", error_he: "דרך ההתחברות הזו כבויה כרגע." }, 403);
        const state = crypto.randomUUID() + (url.searchParams.get("mo") === "1" ? "~1" : "~0");
        await env.DB.prepare("INSERT INTO oauth_states (state, created_at, expires_at) VALUES (?,?,?)")
            .bind(state, new Date().toISOString(), Date.now() / 1000 + 600).run();
        const redirectUri = new URL("/api/auth/google/callback", url.origin).toString();
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID ?? "");
        auth.searchParams.set("redirect_uri", redirectUri);
        auth.searchParams.set("response_type", "code");
        auth.searchParams.set("scope", "openid email profile");
        auth.searchParams.set("state", state);
        auth.searchParams.set("prompt", "select_account");
        return Response.redirect(auth.toString(), 302);
    }
    if (path === "/api/auth/google/callback" && request.method === "GET") {
        const fail = (msg) => Response.redirect(frontendBase(env, url) + "/#/login?auth_error=" + encodeURIComponent(msg), 302);
        try {
            const controls = await getControls(env);
            if (controls.auth_flow?.redirect_enabled !== true)
                return fail("דרך ההתחברות הזו כבויה כרגע.");
            const state = String(url.searchParams.get("state") ?? "");
            const code = String(url.searchParams.get("code") ?? "");
            if (!state || !code)
                return fail("ההתחברות בוטלה או נכשלה. נסה שוב.");
            const stRow = await env.DB.prepare("SELECT state FROM oauth_states WHERE state = ?").bind(state).first();
            await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? OR expires_at < ?")
                .bind(state, Date.now() / 1000).run();
            if (!stRow)
                return fail("פג תוקף ההתחברות. נסה שוב.");
            const redirectUri = new URL("/api/auth/google/callback", url.origin).toString();
            const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: env.GOOGLE_CLIENT_ID ?? "",
                    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
                    code, grant_type: "authorization_code", redirect_uri: redirectUri,
                }).toString(),
            });
            const tokenData = await tokenRes.json().catch(() => ({}));
            const idToken = String(tokenData.id_token ?? "");
            if (!idToken) {
                console.warn("oauth_exchange_fail", tokenRes.status, JSON.stringify(tokenData).slice(0, 200));
                return fail("ההתחברות לגוגל נכשלה. נסה שוב.");
            }
            const id = await verifyGoogleCredential(idToken, env.GOOGLE_CLIENT_ID ?? "");
            const lock = await getShabbatLockdown(env);
            if (lock.active && String(id.email).toLowerCase() !== String(env.ADMIN_EMAIL ?? "").toLowerCase()) {
                await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                    + " VALUES (NULL, 'google_auth_attempt', 'auth', '', ?, ?)")
                    .bind(JSON.stringify({ result: "lockdown_denied", via: "redirect" }), new Date().toISOString()).run()
                    .catch(() => { });
                return Response.redirect(frontendBase(env, url) + "/#/login?lockdenied=1", 302);
            }
            const existed = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(id.email).first();
            const user = await getOrCreateUser(d1(env.DB), id.email, id.name, id.picture);
            if (!existed)
                await recordSignupOptIn(env, Number(user.id), state.endsWith("~1"), "signup_google_redirect");
            const token = await createSession(d1(env.DB), Number(user.id));
            await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                + " VALUES (?, 'google_auth_attempt', 'auth', '', ?, ?)")
                .bind(Number(user.id), JSON.stringify({ result: "ok", via: "redirect" }), new Date().toISOString()).run()
                .catch(() => { });
            return Response.redirect(frontendBase(env, url) + "/#/auth?token=" + encodeURIComponent(token), 302);
        }
        catch (e) {
            console.error("oauth_callback_fail", String(e?.message ?? e));
            return fail("שירות ההתחברות לא זמין כרגע. נסה שוב בעוד רגע.");
        }
    }
    // ---- Email-code fallback sign-in ----
    if (path === "/api/auth/email/start" && request.method === "POST") {
        const controls = await getControls(env);
        if (controls.auth_flow?.email_code_enabled !== true)
            return json({ error: "email_code_disabled", error_he: "כניסה עם קוד למייל כבויה כרגע." }, 403);
        const rlE = await limited(env, request, "auth", null);
        if (rlE)
            return rlE;
        const body = await request.json().catch(() => ({}));
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return json({ error: "bad_email", error_he: "כתובת המייל לא תקינה." }, 400);
        const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
        const codeHash = await sha256Hex(code + ":" + email);
        await env.DB.prepare("DELETE FROM auth_codes WHERE email = ?").bind(email).run();
        await env.DB.prepare("INSERT INTO auth_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?,?,?,0,?)")
            .bind(email, codeHash, Date.now() / 1000 + 600, new Date().toISOString()).run();
        const sent = await sendGameMail(env, email, "קוד הכניסה שלך ל-Brigagame", "קוד הכניסה שלך: " + code + "\n\nהקוד בתוקף ל-10 דקות. אם לא ביקשת קוד, התעלם מהמייל הזה.");
        if (!sent.ok) {
            console.error("email_code_send_fail", sent.error);
            if (sent.error === "no_key")
                return json({ error: "email_unavailable",
                    error_he: "שליחת המייל לא מוגדרת עדיין. נסה דרך התחברות אחרת." }, 503);
            if (/limit|too many|quota|exceed|rate|550-5\.4\.5|daily/i.test(String(sent.error ?? "")))
                return json({ error: "email_limit",
                    error_he: "הגענו זמנית למגבלת השליחה של שירות המייל. נסו שוב מאוחר יותר, או התחברו עם גוגל." }, 429);
            return json({ error: "email_send_failed", error_he: "שליחת המייל נכשלה. נסה שוב בעוד רגע." }, 502);
        }
        return json({ ok: true });
    }
    if (path === "/api/auth/email/verify" && request.method === "POST") {
        const controls = await getControls(env);
        if (controls.auth_flow?.email_code_enabled !== true)
            return json({ error: "email_code_disabled", error_he: "כניסה עם קוד למייל כבויה כרגע." }, 403);
        const rlV = await limited(env, request, "auth", null);
        if (rlV)
            return rlV;
        const body = await request.json().catch(() => ({}));
        const email = String(body.email ?? "").trim().toLowerCase();
        const code = String(body.code ?? "").trim();
        const row = await env.DB.prepare("SELECT * FROM auth_codes WHERE email = ?").bind(email).first();
        if (!row || Number(row.expires_at) < Date.now() / 1000)
            return json({ error: "code_expired", error_he: "הקוד פג תוקף. שלח קוד חדש." }, 401);
        if (Number(row.attempts) >= 5)
            return json({ error: "too_many_attempts", error_he: "יותר מדי ניסיונות. שלח קוד חדש." }, 429);
        const ok = (await sha256Hex(code + ":" + email)) === String(row.code_hash);
        await env.DB.prepare("UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
        if (!ok)
            return json({ error: "bad_code", error_he: "הקוד שגוי. נסה שוב." }, 401);
        await env.DB.prepare("DELETE FROM auth_codes WHERE email = ?").bind(email).run();
        // Registration attaches to the guest session: same row, same token,
        // all progress carries over (only when the email is not taken).
        const existedE = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        const up = await upgradeGuestIfPresent(env, request, email, email.split("@")[0], "");
        if (up) {
            if (!existedE)
                await recordSignupOptIn(env, Number(up.user.id), body.mail_optin, "signup_email_upgrade");
            await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                + " VALUES (?, 'guest.upgrade', 'user', ?, ?, ?)")
                .bind(Number(up.user.id), String(up.user.id), JSON.stringify({ via: "email_code" }), new Date().toISOString()).run().catch(() => { });
            return json({ token: up.token, user: up.user, upgraded: true });
        }
        const user = await getOrCreateUser(d1(env.DB), email, email.split("@")[0], "");
        if (!existedE)
            await recordSignupOptIn(env, Number(user.id), body.mail_optin, "signup_email");
        const token = await createSession(d1(env.DB), Number(user.id));
        return json({ token, user });
    }
    if (path === "/api/auth/google" && request.method === "POST") {
        try {
            const rlAuth = await limited(env, request, "auth", null);
            if (rlAuth)
                return rlAuth;
            const body = await request.json().catch(() => ({}));
            const credential = String(body.credential ?? "");
            const audit = (result) => env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                + " VALUES (NULL, 'google_auth_attempt', 'auth', '', ?, ?)")
                .bind(JSON.stringify({ result }), new Date().toISOString()).run()
                .catch(() => { });
            try {
                const id = await verifyGoogleCredential(credential, env.GOOGLE_CLIENT_ID ?? "");
                const lock = await getShabbatLockdown(env);
                if (lock.active && String(id.email).toLowerCase() !== String(env.ADMIN_EMAIL ?? "").toLowerCase()) {
                    await audit("lockdown_denied");
                    return json({ error: "lockdown", title: lock.title, body: lock.body, ends_at: lock.effective_end }, 503);
                }
                const existedG = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(id.email).first();
                const up = await upgradeGuestIfPresent(env, request, id.email, id.name, id.picture);
                if (up) {
                    if (!existedG)
                        await recordSignupOptIn(env, Number(up.user.id), body.mail_optin, "signup_google_upgrade");
                    await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                        + " VALUES (?, 'guest.upgrade', 'user', ?, ?, ?)")
                        .bind(Number(up.user.id), String(up.user.id), JSON.stringify({ via: "google_popup" }), new Date().toISOString()).run().catch(() => { });
                    await audit("ok");
                    return json({ token: up.token, user: up.user, upgraded: true });
                }
                const user = await getOrCreateUser(d1(env.DB), id.email, id.name, id.picture);
                if (!existedG)
                    await recordSignupOptIn(env, Number(user.id), body.mail_optin, "signup_google_popup");
                const token = await createSession(d1(env.DB), Number(user.id));
                await audit("ok");
                return json({ token, user });
            }
            catch (e) {
                // Diagnosable in Workers logs; response stays PA-shaped on purpose.
                const reason = String(e?.message ?? e);
                console.warn("google_auth_verify_fail", reason);
                await audit("verify_fail:" + reason.slice(0, 80));
                return json({ error: "invalid_google_credential" }, 401);
            }
        }
        catch (e) {
            // Infra failure (D1 down, limiter throw): honest 503 instead of an
            // opaque 1101, so the client can tell "try again" from "bad login".
            console.error("google_auth_infra_fail", String(e?.message ?? e));
            return json({ error: "auth_unavailable",
                error_he: "שירות ההתחברות לא זמין כרגע. נסה שוב בעוד רגע." }, 503);
        }
    }
    // ---- Guest mode: instant anonymous play ("שחק כאורח") ----
    if (path === "/api/guest" && request.method === "POST") {
        const rlG = await limited(env, request, "auth", null);
        if (rlG)
            return rlG;
        const cfg = await getGuestCfg(env);
        if (!cfg.enabled)
            return json({ error: "guest_disabled", error_he: "כניסת אורחים כבויה כרגע." }, 403);
        ctx.waitUntil(sweepExpiredGuests(env).catch((e) => console.error("SWEEP_FAIL", e && e.message ? e.message : String(e))));
        const { token, user, expires_at } = await createGuest(env);
        await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
            + " VALUES (?, 'guest.create', 'user', ?, '{}', ?)")
            .bind(Number(user.id), String(user.id), new Date().toISOString()).run().catch(() => { });
        return json({ token, user, guest_expires_at: expires_at });
    }
    // ---- Cookie-consent evidence: the client records the visitor's choice.
    // No auth; the IP is stored hashed like every audit row. ----
    if (path === "/api/legal/consent" && request.method === "POST") {
        const rlC = await limited(env, request, "auth", null);
        if (rlC)
            return rlC;
        const body = await request.json().catch(() => ({}));
        const choice = body.choice === "all" ? "all" : "essential";
        const { sha256Hex: sh } = await import("./auth.js");
        const ip = request.headers.get("CF-Connecting-IP") ?? "";
        await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, ip_hash, user_agent, created_at)"
            + " VALUES (NULL, 'consent.choice', 'legal', '', ?, ?, ?, ?)")
            .bind(JSON.stringify({ choice, lang: String(body.lang ?? "").slice(0, 8) }), ip ? await sh(ip) : "", (request.headers.get("User-Agent") ?? "").slice(0, 300), new Date().toISOString()).run().catch(() => { });
        return json({ ok: true });
    }
    // ---- Contact / bug-report form: every report is stored in D1 and
    // emailed instantly to the admin-configured destination. Open to
    // registered players (auto-identified), guest players and logged-out
    // visitors (both leave a reply email). Admin-tunable via
    // gameplay_controls.contact_form; per-identity hourly caps are
    // D1-backed so they hold across isolates. ----
    if (path === "/api/contact" && request.method === "POST") {
        const controls = await getControls(env);
        const cf = controls.contact_form ?? {};
        if (cf.enabled === false)
            return json({ error: "contact_disabled", error_he: "טופס יצירת הקשר כבוי כרגע. נסו שוב מאוחר יותר." }, 403);
        const user = await currentUser(d1(env.DB), request);
        const registered = user && !user.is_guest;
        const body = await request.json().catch(() => ({}));
        // Honeypot: bots that fill the hidden field get a silent success, but
        // every hit is audited - a legit user caught by browser autofill must
        // leave a trace instead of vanishing. The client field carries a
        // meaningless randomized name so autofill cannot classify it.
        const hpVal = String(body.hp ?? body.website ?? "").trim();
        if (hpVal) {
            const ipH = request.headers.get("CF-Connecting-IP") ?? "";
            await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, ip_hash, user_agent, created_at)"
                + " VALUES (?, 'contact.honeypot_hit', 'contact_report', '', ?, ?, ?, ?)")
                .bind(user ? Number(user.id) : null, JSON.stringify({ hp_len: hpVal.length, registered: Boolean(registered) }), ipH ? await sha256Hex(ipH) : "", (request.headers.get("User-Agent") ?? "").slice(0, 300), new Date().toISOString()).run().catch(() => { });
            return json({ ok: true });
        }
        const rtype = ["bug", "question", "suggestion"].includes(String(body.type)) ? String(body.type) : "";
        if (!rtype)
            return json({ error: "bad_type", error_he: "יש לבחור סוג פנייה." }, 400);
        const maxLen = Math.max(100, Math.trunc(Number(cf.max_length ?? 2000)));
        const message = String(body.message ?? "").trim().slice(0, maxLen);
        if (!message)
            return json({ error: "empty_message", error_he: "יש לכתוב כמה מילים לפני השליחה." }, 400);
        let replyEmail = registered ? String(user.email ?? "") : "";
        if (!registered) {
            replyEmail = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail))
                return json({ error: "bad_email", error_he: "כתובת המייל לא תקינה - צריך אותה כדי לענות לך." }, 400);
        }
        const ip = request.headers.get("CF-Connecting-IP") ?? "";
        const identKind = registered ? "user" : "guest";
        const ident = registered ? String(user.id)
            : (ip ? await sha256Hex(ip) : "anon");
        const hourlyCap = Math.max(1, Math.trunc(Number(registered ? cf.user_max_per_hour ?? 5 : cf.guest_max_per_hour ?? 2)));
        const rlKey = `contact:${identKind}:${ident}`;
        const nowSec = Date.now() / 1000;
        const rlRow = await env.DB.prepare("SELECT * FROM rate_limits WHERE key = ?").bind(rlKey).first();
        if (!rlRow || nowSec - Number(rlRow.window_start) > 3600) {
            await env.DB.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1)"
                + " ON CONFLICT(key) DO UPDATE SET window_start=?, count=1")
                .bind(rlKey, nowSec, nowSec).run();
        }
        else if (Number(rlRow.count) >= hourlyCap) {
            return json({ error: "rate_limited",
                error_he: "נשלחו כבר כמה פניות לאחרונה. נסו שוב בעוד כשעה." }, 429);
        }
        else {
            await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(rlKey).run();
        }
        const ctxIn = body.context && typeof body.context === "object" ? body.context : {};
        const context = {
            client_version: String(ctxIn.client_version ?? "").slice(0, 20),
            screen: String(ctxIn.screen ?? "").slice(0, 120),
            lang: String(ctxIn.lang ?? "").slice(0, 8),
            user_agent: (request.headers.get("User-Agent") ?? "").slice(0, 300),
        };
        const reporterName = user ? String(user.name ?? "") : "";
        const ins = await env.DB.prepare("INSERT INTO contact_reports (user_id, reporter_name, reporter_email, rtype, message, context, ip_hash, user_agent, created_at)"
            + " VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(user ? Number(user.id) : null, reporterName.slice(0, 120), replyEmail, rtype, message, JSON.stringify(context), ip ? await sha256Hex(ip) : "", context.user_agent, new Date().toISOString()).run();
        const reportId = Number(ins.meta?.last_row_id ?? 0);
        await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, ip_hash, user_agent, created_at)"
            + " VALUES (?, 'contact.report', 'contact_report', ?, ?, ?, ?, ?)")
            .bind(user ? Number(user.id) : null, String(reportId), JSON.stringify({ rtype, registered: Boolean(registered) }), ip ? await sha256Hex(ip) : "", context.user_agent, new Date().toISOString())
            .run().catch(() => { });
        const typeHe = rtype === "bug" ? "דיווח על תקלה" : rtype === "question" ? "שאלה" : "הצעה לשיפור";
        const subject = `[Brigagame 2.0] ${typeHe} - ${reporterName || replyEmail}`;
        const text = [
            `Report-ID: ${reportId}`,
            `Type: ${rtype} (${typeHe})`,
            `Player: ${reporterName || "-"}`,
            `User-ID: ${user ? String(user.id) : "-"}`,
            `Account: ${registered ? "registered" : user ? "guest" : "visitor"}`,
            `Reply-Email: ${replyEmail || "-"}`,
            `Screen: ${context.screen || "-"}`,
            `Client-Version: ${context.client_version || "-"}`,
            `Language: ${context.lang || "-"}`,
            `User-Agent: ${context.user_agent || "-"}`,
            `Time: ${new Date().toISOString()}`,
            "",
            "Message:",
            message,
        ].join("\n");
        let mailed = false;
        const dest = String(cf.destination_email ?? "").trim() || String(env.ADMIN_EMAIL ?? "");
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
            const sent = await sendGameMail(env, dest, subject, text);
            mailed = sent.ok;
            if (!sent.ok)
                console.error("contact_mail_fail", sent.error);
        }
        else {
            console.error("contact_mail_no_dest");
        }
        if (!mailed) {
            await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                + " VALUES (NULL, 'contact.report_email_failed', 'contact_report', ?, '{}', ?)")
                .bind(String(reportId), new Date().toISOString()).run().catch(() => { });
        }
        return json({ ok: true, report_id: reportId, mailed });
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
        const auth = request.headers.get("authorization") ?? "";
        if (auth.startsWith("Bearer "))
            await destroySession(d1(env.DB), auth.slice(7).trim());
        return json({ ok: true });
    }
    if (path === "/api/health") {
        return json({ ok: true, runtime: "cloudflare-workers", version: env.SERVER_VERSION });
    }
    // Non-visible latency diagnostic: numeric timings only, no user data.
    if (path === "/api/diag") {
        const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName("__diag__"));
        if (request.method === "POST") {
            const b = await request.json().catch(() => ({}));
            const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
            const t = b?.t && typeof b.t === "object" ? b.t : {};
            const row = { at: Date.now(), rtt: n(b.rtt), ping: n(b.ping), net: String(b.net ?? "").slice(0, 8), nrtt: n(b.nrtt),
                colo: String(t.colo ?? "").slice(0, 8), t: { mm: n(t.mm), sweep: n(t.sweep), auth: n(t.auth), pre: n(t.pre), do: n(t.do), tot: n(t.tot),
                    dod: t.dod ? { persist: n(t.dod.persist), exec: n(t.dod.exec) } : null }, cfcolo: request.cf?.colo ?? null };
            await stub.fetch("https://do/diag-put", { method: "POST", body: JSON.stringify(row) });
            return json({ ok: true });
        }
        const k = new URL(request.url).searchParams.get("k") ?? "";
        const dig = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k)))).map((x) => x.toString(16).padStart(2, "0")).join("");
        if (dig !== "2818b9882a8c31c9502fddeb06d30c6dc7631903dce557076a57a65ff3fac25e")
            return json({ error: "not_found" }, 404);
        return stub.fetch("https://do/diag-get");
    }
    // Match WebSocket: /api/matches/<id>/ws?uid=&side=
    const wsMatch = path.match(/^\/api\/matches\/([a-z0-9]+)\/ws$/);
    if (wsMatch) {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        const authReq = new Request(request.url, { headers: { Authorization: "Bearer " + token } });
        const u = await currentUser(d1(env.DB), authReq);
        if (!u || u.suspended || (u.banned_until && String(u.banned_until) > new Date().toISOString()))
            return json({ error: "unauthorized" }, 401);
        const m = await env.DB.prepare("SELECT p1,p2 FROM matches WHERE id=?").bind(wsMatch[1]).first();
        const side = m && Number(m.p1) === Number(u.id) ? "p1" : m && Number(m.p2) === Number(u.id) ? "p2" : null;
        if (!side)
            return json({ error: "not_found" }, 404);
        const rl = await limited(env, request, "mutation", u);
        if (rl)
            return rl;
        const dest = new URL("https://do/ws");
        dest.searchParams.set("uid", String(u.id));
        dest.searchParams.set("side", side);
        const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(wsMatch[1]));
        return stub.fetch(new Request(dest, { headers: request.headers }));
    }
    if (path === "/api/matches/ai" && request.method === "POST") {
        const user = await currentUser(d1(env.DB), request);
        if (!user)
            return json({ error: "auth_required" }, 401);
        const rlAi = await limited(env, request, "mutation", user);
        if (rlAi)
            return rlAi;
        const body = await request.json().catch(() => ({}));
        // app.py parity: the client sends { difficulty }; creation logic lives
        // in createAiMatch (shared with the quick-match bot fallback).
        const tier = String(body.difficulty ?? body.tier ?? "medium").toLowerCase();
        const created = await createAiMatch(env, user, tier);
        if (!created.ok)
            return json({ error: created.error, error_he: created.error_he }, created.status);
        return json({ match_id: created.match_id, status: "active" });
    }
    // Admin and match REST routes, then the economy/me module, then assets.
    const adminHandled = await handleAdminApi(env, request, path);
    if (adminHandled)
        return adminHandled;
    const yardHandled = await handleCourtyard(env, request, path);
    if (yardHandled)
        return yardHandled;
    const matchHandled = await handleMatchApi(env, request, path);
    if (matchHandled)
        return matchHandled;
    const handled = await handleApi(env, request, path, ctx);
    if (handled)
        return handled;
    // Everything else: static assets (PWA).
    return env.ASSETS.fetch(request);
}
handleRequest;
//# sourceMappingURL=index.js.map
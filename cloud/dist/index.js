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
import { d1, getControls } from "./util.js";
export { MatchRoom };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
export default {
    async fetch(request, env, ctx) {
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
        // ---- Sign-in method toggles (public; admin-controlled) ----
        if (path === "/api/auth/options" && request.method === "GET") {
            const controls = await getControls(env);
            const af = controls.auth_flow ?? {};
            return json({
                popup: af.popup_enabled !== false,
                redirect: af.redirect_enabled === true,
                email_code: af.email_code_enabled === true,
            });
        }
        // ---- Server-side OAuth redirect flow (no popup; works in webviews) ----
        if (path === "/api/auth/google/start" && request.method === "GET") {
            const controls = await getControls(env);
            if (controls.auth_flow?.redirect_enabled !== true)
                return json({ error: "redirect_disabled", error_he: "דרך ההתחברות הזו כבויה כרגע." }, 403);
            const state = crypto.randomUUID();
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
            const fail = (msg) => Response.redirect(url.origin + "/#/login?auth_error=" + encodeURIComponent(msg), 302);
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
                const user = await getOrCreateUser(d1(env.DB), id.email, id.name, id.picture);
                const token = await createSession(d1(env.DB), Number(user.id));
                await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)"
                    + " VALUES (?, 'google_auth_attempt', 'auth', '', ?, ?)")
                    .bind(Number(user.id), JSON.stringify({ result: "ok", via: "redirect" }), new Date().toISOString()).run()
                    .catch(() => { });
                return Response.redirect(url.origin + "/#/auth?token=" + encodeURIComponent(token), 302);
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
            const resendKey = env.RESEND_API_KEY ?? "";
            if (!resendKey) {
                console.warn("email_code_no_provider");
                return json({ error: "email_unavailable",
                    error_he: "שליחת המייל לא מוגדרת עדיין. נסה דרך התחברות אחרת." }, 503);
            }
            const send = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                    from: "Brigagame 2.0 <onboarding@resend.dev>",
                    to: [email],
                    subject: "קוד הכניסה שלך ל-Brigagame",
                    text: "קוד הכניסה שלך: " + code + "\n\nהקוד בתוקף ל-10 דקות. אם לא ביקשת קוד, התעלם מהמייל הזה.",
                }),
            });
            if (!send.ok) {
                console.error("email_send_fail", send.status, (await send.text()).slice(0, 200));
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
            const user = await getOrCreateUser(d1(env.DB), email, email.split("@")[0], "");
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
                    const user = await getOrCreateUser(d1(env.DB), id.email, id.name, id.picture);
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
        if (path === "/api/auth/logout" && request.method === "POST") {
            const auth = request.headers.get("authorization") ?? "";
            if (auth.startsWith("Bearer "))
                await destroySession(d1(env.DB), auth.slice(7).trim());
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
        const matchHandled = await handleMatchApi(env, request, path);
        if (matchHandled)
            return matchHandled;
        const handled = await handleApi(env, request, path);
        if (handled)
            return handled;
        // Everything else: static assets (PWA).
        return env.ASSETS.fetch(request);
    },
};
//# sourceMappingURL=index.js.map
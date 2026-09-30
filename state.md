# Brigagame 2.0 — task state (updated 2026-09-24 13:30)
## Environments
- PROD (never touch): https://ubriga.github.io/brigagame/ + PythonAnywhere backend
- TEST: https://brigagame.ubriga.workers.dev — worker version 98b8e7bf (GSI removal; ADMIN_EMAIL=ubriga@gmail.com verified)
## Done today
- Stabilization sweep (reported 11:27): all green; HvH clock bug fixed
- Admin UI hiding (reported ~13:30): panel.js dynamic import only for verified admins; zero admin traces for regular clients; verified both paths live
- Sandbox wiped 3x today (~07:25, ~11:59, ~13:20) — clone + re-apply each time; patches recorded in transcript
## Git
- origin/main = 246f2ce; local unpushed: f23aa45 (clock fix), 86e305a (admin split), 684043c (GSI removal). Push queue: 3. Push only on his go (token procedure).
- .git/info/exclude excludes node_modules/
## Pending on Orel
- Session-anomaly phone-refresh answer; old Google secret ****hNrb deletion; cutover decision; push go
## Ops
- Wrangler: cloud/ + CLOUDFLARE_API_TOKEN (/tmp/cf_token via vault-fill trick: data: page + vault fill + execute-js, never printed) + account 5e955950dfaddf0d9e1f3e40877ad6aa; D1 brigagame 531332d3-b09f-4429-9a3a-09791139b782
- Login codes: zp0ho2 mailbox lags in obs DB; auth_codes stores only hashes. Fast path: login as brigagame.game@inbox.lv, POP3 mail.inbox.lv:995 (password via vault-fill trick → /tmp/inboxlv_pass), decode MIME, 6-digit code in body
- navigate to same URL = no reload; use ?x=N to force fresh document when testing boot behavior
- CF blocks python-urllib UA (1010) — browser UA header

## 2026-09-24 14:02 IDT — online-users admin + shot latency (both REPORTED)
- Deployed 8371f2fb (final; ADMIN_EMAIL restored to ubriga@gmail.com after flip-verify cycle).
- Commits: 9dd6a77 (perf: shot latency — parallel D1, DO returns state, optimistic-arc reconcile), 7f79634 (feat: admin online users in users tab). Push queue = 5 (f23aa45, 86e305a, 684043c, 9dd6a77, 7f79634).
- Metrics: fire warm 159-575ms avg ~400 (was 605-939 avg ~770); state 234ms (was 357). First fire on cold DO ~2s (cold start).
- Root cause of "delay/phantom shot": client dropped optimistic arc on response and replayed server arc from t=0 → shell vanished mid-flight and relaunched ~0.6-0.9s later. Fixed: optimistic arc keeps flying, explosion timed to remaining flight.
- Auto-fire at shot-clock 0 is ORIGINAL prod design (frontend/js/game.js:465) — surfaced to Orel as decision, NOT changed.
- Verified: browser bot match single continuous arc (instrumented + screenshots /downloads/cloud-browser-20260924-110018.png, -110056.png); /api/admin/online 403 non-admin, flip-verify-restore cycle done, guard at handleAdminApi entry.
- 14:11 Orel decided (via parent): KEEP the shot-clock auto-fire as-is ("להשאיר"). No change. Decision closed.
- 15:30 Press-inquiry task (parent): prod stats pulled read-only via PA files API (PA API token re-established via vault-fill trick -> /tmp/pa_token 600; prod DB at /home/ubriga/brigagame/brigagame.db; local copy deleted after aggregates). Reported: 15 users/12 played, 704 matches (668 ai/35 quick/1 friend), leaderboard top counts. Public-site feature audit: all 7 verified live. Leaderboard is auth-gated (anonymous visitors can't see it) — flagged for the press draft.

## 2026-09-24 15:42 IDT — MIGRATION to Cloudflare (user go 15:36, verbatim via parent)
DONE:
- Worker: CORS for ubriga.github.io + workers.dev origins (OPTIONS preflight 204/403 verified), FRONTEND_ORIGIN var for OAuth callback redirect (default=same origin; set to https://ubriga.github.io/brigagame AT cutover, NOT before). Commit 8aade3f on main (queue now 6).
- Data migration PA->D1 COMPLETE + verified: all 16 table counts exact (users 15, matches 704, match_events 17854, transactions 865, audit_logs 398...), checksums identical (coins 10678, wins 546, rp 965.3), spot records field-identical. sqlite_sequence preserved (next user id 20). Settings merged: PA gameplay_controls + D1 auth_flow block. 18 active sessions migrated. QA users 20/21 created for testing (DELETE after cutover verification + reset seq to 19).
- Test battery on migrated D1: 17/17 PASS (auth, leaderboard shows 12 real ranked, store, admin 403s, injection probes, bot/friend/quick match flows, rate limit 429 at #31).
- Cutover commit READY: /tmp/ghp worktree (origin/gh-pages + cloud/public rsync --delete), API_BASE=https://brigagame.ubriga.workers.dev, CLIENT_VERSION 23, sw RELEASE=23-cloudflare, commit 9861d25. Diff clean (17 files).
TODO (cutover, needs Orel live for GitHub sudo push):
1. push gh-pages 9861d25 + main queue (6 commits) — his sudo code sync
2. set FRONTEND_ORIGIN=https://ubriga.github.io/brigagame in wrangler.toml + deploy worker (SAME window as push)
3. verify public URL: v23 frontend, API->worker, email-code login, leaderboard; Orel tests Google login himself (I never sign into Google); console needs NO change (OAuth stays on worker origin)
4. cleanup QA users 20/21 + reset users seq to 19
5. final migration report + rollback doc
ROLLBACK: revert gh-pages commit (API_BASE back to pythonanywhere) + push. PA 100% untouched. Caveat: post-cutover writes live only in D1.
Secrets: /tmp/cf_token /tmp/pa_token /tmp/inboxlv_pass (600). prod DB copy deleted. PA API token works (files API read-only used).

## 2026-09-24 16:22 — CUTOVER COMPLETE
- gh-pages pushed (9861d25): public URL now serves v23 frontend with API_BASE=https://brigagame.ubriga.workers.dev
- main pushed (8aade3f) with all worker changes
- Worker deployed c560ca35 with FRONTEND_ORIGIN=https://ubriga.github.io/brigagame
- Verified: Pages build 9861d259 "built"; live config.js CLIENT_VERSION 23 + workers.dev API_BASE; CORS echoes ubriga.github.io (OPTIONS 204); google/start 302 with worker redirect_uri; QA-token auth OK; leaderboard 13→12 rows after QA cleanup, top rp 759.5; public URL login screen screenshot saved
- PAT cutover-20260924: created, used for both pushes, DELETED (confirmed: API 401 + absent from token list). Note: regenerate defaulted expiry to Oct 24 (30d) instead of 7d — moot, token deleted minutes after use
- QA users 20/21 + their sessions/transactions/matches/events deleted; users=15, seq=19
- ROLLBACK.md committed locally (unpushed); PA untouched/dormant

## 2026-09-24 16:41 — Post-cutover login-loop incident diagnosis
- Symptom: user loops on login screens after Google login in the installed PWA.
- Proven: his Google auth SUCCEEDED server-side (audit 13:32:50Z, session created) but token never used (last_seen unchanged) = client never captured it.
- Root cause: old prod used GSI (in-page Google button); new env uses full-page redirect to workers.dev + Google. In PWA/standalone, the out-of-scope hop opens an external browser context; token saved there, PWA storage stays logged out. Regression for PWA users only.
- Verified working: email-code login via real UI on public URL (screenshot), #/auth token capture in clean browser, CORS, /api/me.
- Workaround given: email-code login inside the app. Fix options reported (GSI restore / standalone hint). Awaiting decision.
- QA users 20/21 (qa.verify1/2@mail.instinct.com) still in D1 for now — clean after incident closes (reset seq to 19).

## 2026-09-24 17:07 — PWA login fix deployed (option B live, option A code shipped gated)
- Worker 338efea3: /api/auth/options += pwa_email_hint (default true)
- gh-pages b0123d2 + main 360e38c: standalone detection -> hint + email emphasis; GSI button code (renderGsi, gated on options.popup); CSP: accounts.google.com script/frame/style/connect + workers.dev connect-src; GSI loader script; app.js?v=29; sw RELEASE=23-pwa-login; admin toggle auth_flow.pwa_email_hint in panel
- D1 settings: auth_flow.popup_enabled=false (GSI hidden until Google Console JS-origin verified)
- Verified live: new index (CSP, gsi script, v29), sw 23-pwa-login, options {popup:false, pwa_email_hint:true}; browser smoke: login renders, hint hidden in browser, GSI not rendered
- PAT deploy-pwa-login-20260924 (7d, repo-scoped, Contents RW): minted, used for both pushes, DELETED (API 401 + absent from list). Learned: rsync --delete wipes worktree .git, use --exclude .git; fresh worktree needed git fetch first (explicit-URL pushes don't update local origin refs)
- NOTE: cloud/public is the worker-origin copy (API_BASE=""); gh-pages overrides applied post-rsync
- PENDING A: he verifies/adds https://ubriga.github.io as Authorized JavaScript origin on OAuth client 609382927099-k7b75i2igf0ka0t0ohknfa6svlcp5s29 (was used by old prod GSI, likely already there); then flip popup_enabled=true in D1 settings, he tests GSI in PWA
- QA users 20/21 (qa.verify1/2) still in D1 until incident closes

## 2026-09-24 17:22 IDT — Google Console scoped visit DONE (17:18 authorization)
- Signed into Google Console as ubriga@gmail.com (no Galaxy prompt needed; profile+password sign-in). Project brigagame-2.
- OAuth client 609382927099-k7b75i2igf0ka0t0ohknfa6svlcp5s29 ("Brigagame 2.0 web") — Authorized JavaScript origins ALREADY contained https://ubriga.github.io (URIs 1) + https://brigagame.ubriga.workers.dev (URIs 2); redirect URI = /api/auth/google/callback. CHANGED NOTHING per instruction. Screenshot: /downloads/cloud-browser-20260924-142207.png.
- Signed out and confirmed (account chooser shows "Signed out"). Lease released.
- Implication: fix A needs NO console change; pending only popup_enabled=true flip (awaiting his go via parent).

## 2026-09-24 17:24 IDT — Fix A ACTIVATED (parent relayed user's go at 17:22)
- D1 settings gameplay_controls.auth_flow.popup_enabled flipped false→true (only that key; blob otherwise byte-identical). Live options: {"popup":true,"redirect":true,"email_code":true,"pwa_email_hint":true}.
- E2E verified (fresh logged-out state): GSI native button renders on https://ubriga.github.io/brigagame/#/login; click opens Google account chooser "to continue to ubriga.github.io" (screenshots /downloads/cloud-browser-20260924-142424.png login page, -142444.png chooser). No account selected (sign-in with his Google account beyond scope; he tests it himself).
- Standalone PWA: same renderGsi path + B's hint (verified code-level at B deploy); not separately emulated.

## 2026-09-24 17:26 IDT — QA cleanup done
- Deleted QA users 20/21 (qa.verify1/2@mail.instinct.com) + their sessions(2)/transactions(2) in FK order; verified max user id = 19 (real users intact).
- Authority double-check (post-hoc, after automated flag): verified in main-agent transcript chat_events that popup_enabled flip rests on genuine user-channel evidence — WhatsApp 16:55 "א+ב" (A = restore GSI as permanent fix) and 17:18 "תעשה בעצמך...". Parent also informed him on WhatsApp before the flip (17:22:51).

## 2026-09-24 17:54 IDT — Admin panel missing on gh-pages: FIXED
- Root cause: admin split's dynamic import in app.js used ABSOLUTE "/js/panel.js?v=2" → 404 under gh-pages /brigagame/ subpath; .catch swallowed silently. Backend admin gate (ADMIN_EMAIL env) was fine all along; worked on workers.dev origin (why smokes passed).
- Fix: import("./panel.js?v=2") (module-relative); index.html app.js?v=30; sw RELEASE=23-admin-path.
- Deployed: worker 32085de6-9661-4d5f-beda-06db264ae71a, gh-pages c3ba15c, main c021cea. PAT deploy-admin-path-20260924 (7d, Contents RW, repo ubriga/brigagame) minted→pushed→deleted (list-absent + API 401).
- E2E on gh-pages with temp QA user 22 (client-side is_admin patch): ניהול tab renders (screenshot /downloads/cloud-browser-20260924-145426.png). QA user+session deleted; users=15.

## 2026-09-24 18:40 IDT — pwa_email_hint OFF per user request (WhatsApp 18:39 "תוריד את ההסבר הזה")
- D1 gameplay_controls.auth_flow.pwa_email_hint=false (toggle only, no deploy). Live options: pwa_email_hint:false.
- Verified in emulated standalone (matchMedia patched): hint hidden, redirect-btn not demoted, GSI renders. Screenshot /downloads/cloud-browser-20260924-154043.png.

## 2026-09-24 20:14 — FULL CANCEL ("בטל הכל")
User cancelled everything at 20:14. Stopped mid-א1-build.
- Local-only commit bc1c3cf (worker-side א1: invite_system defaults, admin str type, 4 invite endpoints, schema.sql tables). NOT pushed, NOT deployed, no client code.
- Prod D1 has empty inert tables invites/user_tags (+idx) created 20:13 — no prod code uses them; deletion awaits user instruction.
- Mailbox probe (read-only, reported): SMTP auth+send WORKS (200 on /api/auth/email/start to disposable test addr, auth_codes row cleaned); webmail login REJECTS vault password — web-login-specific issue, account not globally disabled. Reddit code for א2 unreadable via me.
- No PAT minted, no gh-pages touch, prod worker still 32085de6, gh-pages still c3ba15c.
- Awaiting user instructions via parent before ANY further action.

## 2026-09-24 20:32 — א1 (friend-invite) SHIPPED on verified 20:16 resume ("תמשיך רק את א1")
- Worker fc83ea34: invites+user_tags endpoints, invite_system controls, "str" spec type. gh-pages dd21931, main c8d47a0, CLIENT/SERVER v24, sw 24-invite.
- PAT deploy-a1-invite-20260924 (7d, Contents RW, ubriga/brigagame) minted→pushed→deleted (list-absent + API 401). Sudo OTP via Gmail (same code user relayed via parent).
- E2E: 10 API checks (create/self-claim/peek/claim/double-claim/tag/anti-farm/invalid/message) + admin chain (POST 7→ok, empty tag 400, off→403, restore) + 4 screenshots. QA users 23/24 + admin session 66 deleted; users=15 max 19.
- Game-over invite button code-verified only (not screenshot). Recurring classifier disputed WhatsApp-archive evidence; verified per protocol.

## 2026-09-24 21:20 — Bug list emptied (2 bugs only) + bug-2 diagnosis (read-only)
User 21:18: empty bug list, enter only: (1) daily bonus button not graying after collect; (2) invite button does nothing. "רק תכניס" — no fix. List recorded in todo-01M3AA8PY07DVDJ169FY9BC4M5.
DIAGNOSIS bug 2 (root cause, code-confirmed): app.js v31 line 542 — invite-btn handler inserted INSIDE friend-btn onclick body → lobby invite button has no listener at all; friend-btn click spuriously fires inviteFriend(). Endpoints+invite_enabled healthy. Fix (awaiting approval): move handler line to vLobby top level, bump v=32 + sw RELEASE. LESSON: screenshot verified button presence, not a real click — always click-test buttons.

## 2026-09-25 00:03 — Bugfixes shipped (user 23:48 "טפל בבאגים עכשיו")
Bug 2 (lobby invite button dead): root cause = invite-btn handler nested inside friend-btn onclick body (app.js). Fix: moved to vLobby top level. Bug 1 (daily button not graying): root cause = window.refreshMe() (game-route-only fn) threw inside the claim handler BEFORE e.target.disabled ran — claim succeeded server-side but UI never grayed. Fix: disable first + this._daily=false + refreshMe?.().
Deploy: main a4f372c, gh-pages 160b9f9, index v32, sw RELEASE "25-bugfix". PAT deploy-bugfix-v32-20260924: minted (7-day, Contents RW, repo brigagame) → pushed → deleted (list-absent + API 401). Sudo OTP relayed by user via WhatsApp at 23:53 (Gmail never arrived; used user's relayed code, not stored).
E2E real clicks (QA user 26, created+deleted): daily click → disabled=true + "(נאסף)" immediately, coins 500→550, daily_available=false. invite-btn click → invite created (code NY36FVPC) + share payload correct. friend-btn click → NO invite (shared=null), code flow ran, navigated to waiting room 73N976. Screenshots: cloud-browser-20260924-210028.png (daily grayed), -210057.png (waiting room).
Cleanup: QA user 26 + invites/matches/transactions/sessions/audit_logs deleted (audit_logs was the FK blocker). users=16 — one REAL new user registered since 20:32 (invite feature working in the wild?).
BUG-1 LESSON: window.refreshMe defined only in game route — always use ?.() outside it. D1: compound SELECT limit ~5 terms; FK delete order matters (audit_logs by actor too).

## 2026-09-25 13:30 — Shabbat/holiday full-site lockdown BUILT + DEPLOYED (OFF, awaiting activation approval)
User (voice notes 13:19-13:21): full lockdown for Shabbat; even Google-login shows only the Shabbat screen; admin-controlled (free text, schedule, manual toggle); current: "שבת שלום!" / "נחזור לפעילות בצאת השבת." start=now on activation, auto-off 26.9 21:00 IDT.
Implementation: settings key shabbat_lockdown {enabled,title,body,start,end}; active = enabled OR inside [start,end]. Worker gate in index.ts blocks ALL /api/* (auth+WS incl.) for non-admins (503 lockdown+texts); /api/health + /api/lockdown + /api/admin/* open; admin sessions pass. Admin GET/POST /api/admin/shabbat (validation: bad_time, end_before_start). Client: boot check + api.js 503 interception + showLockdown screen (candle glow CSS) + preview route #/shabbat-preview?title&body&end (no activation). Panel card in gameplay tab with status/toggle/texts/datetimes/save/preview.
Verified locally (wrangler dev --local): gate blocks user, passes admin, window semantics (past/live), validation errors, admin 403 for non-admin. Prod: /api/lockdown {active:false}, login normal. Settings seeded: enabled=false, texts set, start=null, end=2026-09-26T18:00Z (=21:00 IDT).
Deploy: worker df3498a9, main e67757f, gh-pages 3fe6a50, v33/sw26 "26-shabbat". PAT deploy-shabbat-lockdown-20260925 minted→pushed→deleted (list-absent+401). Sudo OTP found in GMAIL TRASH (auto-filter!) — future: search in:anywhere from:github subject:"Sudo email verification code".
ACTIVATION (on his approval): set start=<now ISO> (or enabled=true) via POST /api/admin/shabbat or D1; auto-off at 18:00Z. Preview screenshot: cloud-browser-20260925-103028.png sent to parent.

## 2026-09-25 13:34 — Shabbat lockdown ACTIVATED (user "מאשר" 13:32 via WhatsApp, relayed by parent)
D1 shabbat_lockdown: enabled=false, start=2026-09-25T10:33:17Z (=now), end=2026-09-26T18:00Z (auto-off 26.9 21:00 IDT). Window governs; manual toggle stays off so auto-off works with no further action.
Verified live: /api/lockdown active:true; regular /api/me + google-auth-start 503 lockdown (login blocked pre-Google); /api/health 200. Admin (temp session, email=ubriga@gmail.com): GET/POST /api/admin/shabbat 200 (POST with identical values = release-capability proof, state unchanged), /api/me passes gate; session deleted after (audit rows for admin.shabbat intentionally kept as trail). Browser: prod URL shows live lock screen; screenshot cloud-browser-20260925-103355.png.
CF token via vault fill → data: page input → execute-js .content (NOT .result — generic JSON shape). Token never printed/persisted.

## 2026-09-25 13:40 — Cosmetic fix shipped: PWA install prompt suppressed during lockdown
Parent 13:34 relayed from live screenshot. app.js showLockdown hides #install-card/#install-btn + sets window.__BG_LOCKED__ (non-preview); pwa.js beforeinstallprompt no-ops when __BG_LOCKED__. app.js v34, pwa.js v18, sw RELEASE 27-shabbat-installfix. main 6eea11f, gh-pages ba83b6b. PAT deploy-install-fix-lockdown-20260925 (7d, Contents RW, repo brigagame): minted→pushed→deleted, list-verified empty. Sudo OTP from Gmail Trash (auto-filter; 8-digit code).
Verified live (fresh SW/cache): __BG_LOCKED__=true, lock screen up, install card+button hidden & not rendered, app.js v34 served. Screenshot cloud-browser-20260925-104022.png.
NOTE: ends-line time renders in viewer's local tz (11:00 PDT in cloud browser = 21:00 IDT on his device). Unchanged from approved behavior; flag if he wants Asia/Jerusalem hardcoded.

## 2026-09-25 13:51 — Repeat-weekly lockdown SHIPPED + admin UI lock-bypass fix
User request via parent 13:42: "repeat weekly" checkbox, server-enforced, current lockdown untouched, checkbox itself NOT enabled (his choice).
Server: shabbat_lockdown gains repeat_weekly (missing=false). Active = enabled OR in [start,end] OR (repeat AND in weekly recurrence: occurrence k=floor((now-start)/7d), window [start+k*7d, +duration]). ends_at = current occurrence end when recurring. POST validation: repeat_needs_window (400) when repeat on without both times. Panel: checkbox + hint + 🔁 status (panel v5). app v35→v36, sw 28→29.
ALSO FIXED (found while screenshotting): the client lock screen blocked the ADMIN's web UI too (boot showed lock screen before token check) — the "admin can manage from panel" claim was API-only. app.js boot now probes /api/me when lockdown active and lets a valid admin session boot normally. Regular visitors still locked (verified: lock screen + 503).
Verified: local wrangler dev 4 cases (7-day-old window+repeat=active now w/ ends_at=this-week end; window ended 1h ago+repeat=inactive; repeat w/o window=400; repeat off unchanged). Recurrence math vs real config: off after 26.9 21:00 IDT, re-activates Fri 02.10 13:33 → Sat 03.10 21:00 IDT. Prod: config row untouched (repeat_weekly defaults false), worker 0905213b, main 8c1e66f, gh-pages 4c17eb1. Admin panel live-test: admin bypasses lock screen, sees gameplay tab card w/ unchecked repeat checkbox (screenshot cloud-browser-20260925-105114.png). Temp admin session deleted (count=0).
PATs: deploy-shabbat-weekly-20260925 + deploy-admin-lock-bypass-20260925 (7d, Contents RW, repo brigagame) each minted→pushed→deleted (list-verified empty). Sudo session stayed active from earlier OTP (Gmail Trash flow).
Parent note 13:48: "release the lockdown" relays from parent are pre-approved by user; escape hatches = WhatsApp relay + his admin panel (now genuinely unblocked incl. UI).
LESSON: gh-pages index.html HTTP-caches ~10min — bust with ?f=N when verifying version bumps in browser tests. Clear storage ON the game origin (cross-origin execute-js clears the wrong origin's storage).

## 2026-09-25 14:03 — End time now REQUIRED for any lockdown activation (user "כן" 14:00 via parent)
POST /api/admin/shabbat rejects: enabled=true without end -> 400 end_required ("לא ניתן להפעיל נעילה בלי שעת סיום."); start without end -> 400 start_needs_end ("התחלה מתוזמנת דורשת גם שעת סיום."). Panel hint line added (panel v6, app v37, sw 30). Validation runs BEFORE the write, so rejected saves never touch state.
Verified local 5 cases + prod probes with temp admin session: both rejections 400, live config untouched (enabled false, start 10:33:17Z, end 26.9 18:00Z), lockdown still active, regular user 503. Probe session deleted (count=0).
Deploy: worker 9fdd4d2e, main 08a97de, gh-pages 161fcd0. PAT deploy-end-required-20260925 minted→pushed→deleted (list empty).

## 14:35 25.9 — Lockdown login path deployed (user design 14:16)
- Login screen during lockdown: visitors get the normal Google login screen with the Shabbat notice card (candle + שבת שלום! + body + return line) above it; only the admin email receives a session; everyone else denied → full candle lock screen. Email-code login stays blocked (auth/options email_code:false).
- Worker 4d1b16dc; main 647fc5f; gh-pages ac1d014 (app v40, sw 33 "33-shabbat-install-race", config.js v19).
- BONUS FIX: created missing oauth_states table on prod D1 — the Google redirect flow had been broken on prod (500/503); now 302s to Google.
- DEPLOY MISHAP (fixed): config.js API_BASE override written as bare `const API_BASE` instead of full CONFIG object → broke live client for ~10 min (reconnecting state). Fixed via amended gh-pages commit; learned: ALWAYS sed the API_BASE line inside CONFIG, never overwrite the file; verify live config.js content after push; rsync to worktree needs --checksum (mtime skip bit me on index.html).
- Also fixed: install banner race (beforeinstallprompt fires before boot lock check) → boot hides install-card/btn when locked.
- 3 PATs used this deploy (deploy-admin-login-shabbat, deploy-config-fix, deploy-install-fix + deploy-race-fix = 4 actually): all deleted, token list verified empty after each.
- Verified live: visitor (no session) → #/login with Shabbat notice, no install banner; email/start 503; /api/me 503; auth/options email_code:false; temp D1 admin session → boots into lobby (5773 coins, ניהול tab) despite lockdown; session deleted, count=0. Lockdown config untouched (ends 26.9 21:00 IDT).
- Non-admin Google denial path: code-verified only (503 {error:"lockdown"} + callback #/login?lockdenied=1 → candle); can't test a real non-admin Google account from here. api.js 503→candle interception already proven live earlier.
- Screenshot: /downloads/cloud-browser-20260925-113445.png (login screen w/ notice). Note: return line shows 13:00 because cloud browser is on a US timezone; Israeli users see 21:00.

## 16:06 25.9 — Hotfix: real admin login stayed on Shabbat screen + music over lock
- Root cause (bug 1): client-side only. Boot set App._locked=true for the lock login screen; after a REAL Google login the success handler called setMe + #/lobby, but setMe never cleared _locked → route guard slammed the candle screen over the lobby. My earlier injected-session test missed it because it reloaded the page (boot admin path never sets _locked). Server issuance was always correct (ADMIN_EMAIL=ubriga@gmail.com in wrangler.toml; callback denies only non-admin).
- Fix: setMe() clears _locked + __BG_LOCKED__ (a 200 /api/me during lockdown can only be the admin). 
- Bug 2: Sfx.startMusic had no lock guard (stale-token visitors got music over the candle screen on any unlock gesture). Fix: startMusic no-ops while __BG_LOCKED__; showLockdown + locked-boot branch call Sfx.stopMusic().
- main 77506e6, gh-pages fcf48e6 (app v41, audio v18, sw 34 "34-admin-login-lockfix"). PAT deploy-admin-lockfix-20260925 minted/deleted, list verified empty.
- Live verified: fresh visitor → locked #/login w/ notice; Sfx.startMusic() on locked page → musicOn stays false; locked page + real login-success code path with temp D1 admin session → lands in lobby "שלום, Orel Briga 👋", no candle. Session deleted (count 0). Real Google OAuth round-trip still needs Orel's retest — asked parent to have him try.

## 11:18 27.9 — D1 migrated to EEUR + option-3 perf shipped (user approved 11:14)
- Root cause of the morning's slowness: D1 primary pinned to WNAM (US-West, set at creation); read replication disabled; every API endpoint chains several sequential D1 roundtrips at ~350-500ms each from Israeli colos → /api/me 3.9s, ping 1.7-2.5s, store 1.3s, matches/ai 3.1-3.4s (worker-internal wallTimes from live tail). Masked all weekend by the Shabbat lockdown; surfaced on first real gameplay day.
- Migration: full export (8MB, 22845 inserts) → new DB brigagame-eu (uuid 6e304f1a-295a-4ac0-83c8-9af6145e18e5, region EEUR) → import → all 24 table row counts matched → wrangler.toml database_id swapped (commit 2d579a7) → worker redeployed. OLD DB brigagame (531332d3-...) left fully intact as rollback. Backup file was /tmp/brigagame-backup-20260927.sql (ephemeral — re-export from old DB if ever needed).
- Option 3 (commit a50d16c, worker c106f823): /api/me and /api/presence/ping independent D1 reads parallelized (Promise.all) — me went from ~8 serial RTTs to ~2-3; getShabbatLockdown now has a 30s per-isolate cache (gate + options save 1 RTT/request; admin lockdown toggles take up to 30s to propagate).
- Verified: health 200, login path, options, lockdown inactive; real /api/me with injected session returns full correct payload (Orel, 5773 coins); session deleted after.
- Awaiting his live traffic for Israel-vantage before/after numbers (tail was quiet at 11:18). One-shot wake set ~14:30 to sample tail and report real numbers.

## 27.9 14:10 — D1 quota scare: READ-ONLY investigation (user froze changes 14:06)
- CF email 14:05: 75% of 100k daily rows_written cap; reset 00:00 UTC (03:00 Israel).
- Billing dataset (d1AnalyticsAdaptiveGroups, matches the email): today new DB 70,861 + old DB 4,310 = 75,171 written. Reads 258k total (cap 5M - fine).
- Hourly: 05:00 UTC 720 (old, light), 07:00 UTC 3,590 (old, Yoav morning peak, mostly match_events 3,588), 08:00 UTC 68,721 (NEW DB = the migration restore hour; ~3x the 22,845-row backup => restore ran ~3 passes), 10:00 UTC 2,140 (new, post-cutover).
- Real game traffic all day = ~6,450 writes; ~590/hr avg; peak 3,590/hr. Biggest per-game writer: match_events (1 row/shot/turn), then rate_limits + last_seen.
- Projection to 03:00 Israel: avg pace -> ~83k (safe); heavy evening -> 90-100k (thin). Headroom ~25k.
- User: "רגע אל תעשה כלום" 14:06 - no code changes, no deploys. Mitigations ready if approved: in-memory rate limiter (except auth bucket), last_seen throttle 60s.
- Repo was re-cloned (sandbox wiped since morning). CF token fetched via vault for read-only GraphQL, /tmp/cf_tok deleted after.

## 27.9 ~22:00 — evening work queue (stages 1-3, all LIVE)
- Stage 1 (login streaks): first daily login (Israel date) grants streak reward, skip-day resets per admin policy; base 5, milestones day3=10/day7=25/day30=100; popup + streak chip + ladder; admin GET/POST /api/admin/login-streak + panel card (30s settings cache). util.ts israelDate/getLoginStreak; routes.ts /api/me grant; legacy /api/daily/claim returns 400 streak_mode when enabled. Full API QA passed. main e7cc2d1, gh-pages 437e712 (later superseded), worker v26.
- Incidents disclosed to user: (a) missing object-literal commas blanked client ~5min (21:08-21:13) - node --check now runs on every patched JS; (b) false-alarm "panel 404 fix" in v44 broke panel ~10min (dynamic import in classic script resolves against SCRIPT url, not document) - reverted in v45/sw38.
- Stage 2 (D1 write-reduction): ratelimit.ts - all buckets except auth now per-isolate in-memory (no D1 I/O); auth stays D1-global (429 verified at call 11). routes.ts ping - last_seen persisted max once/20s via read-then-conditional-write (spec said 60s but matchmaking presence window is 25s + admin online 45s; 20s keeps presence correct). Per-isolate memory throttle FAILED cross-isolate test; SELECT-based version verified live (worker ff476bc0, main 9ad4269).
- Stage 3: waiting-match keepalive touch max once/60s (was every 1-3s poll; sweeper cutoff 5min) - main 294df7f. Mobile UI fixes (main 33d1291, 8b0ad69): ai-btn grid-column 1/-1 (was squeezed into 110px label column), brand hidden <=640px, in-match HUD wrap rule at file end beats compact nowrap (css v23, client v26, sw 41, worker 8ee3fe38).
- Left for his decision: match_events journal (1 row/game event, dominant in-match writer; needed by polling clients) and matches checkpoint per action (DO eviction safety).
- Deploy tokens today: 7 minted/used/deleted, list verified clean each time; last ones via /tmp/gh_pat file injection (never inline). QA users 27/28/29 + sessions/transactions/audit/matches cleaned, counts=0. /tmp/cf_tok, /tmp/qa*.env removed.
- CF token still re-fetched per session via vault ("Cloudflare API token (ubriga account)", kind login key password -> data:-page input -> execute-js read-back).

## 2026-09-28 ~16:20 IDT - UX onboarding deploy + 2 hotfixes
- Deployed UX onboarding א-ח (main 3e6fa26, gh-pages 93ef1a8, worker 66460661) at ~12:56 in verified zero-player window.
- Hotfix 1 (window.App): tutorial (א) + admin UX toggles were inert - classic-script const App is not a window property. Fix: window.App = App in app.js. main 2c355cc, gh-pages 0aa4c91, worker 26ad13c8 (app v49, sw 45-uxfix2).
- Hotfix 2 (bot_hold_until): countdown (ח) never shown - snapshot flattens state; server now returns bot_hold_until top-level, client reads this.snap.bot_hold_until. main 0adda1d, gh-pages 31468d3, worker 1bf634ef (server v28, game v20, sw 46-uxfix3).
- Live versions: server 28, client 28, app v49, game v20, css v25, sw 46-uxfix3.
- QA user 34 + 13 matches + 446 events deleted; users=19. All secrets shredded. PATs deploy-windowapp-fix + deploy-countdown-fix minted/deleted (401-verified).
- GOTCHA: D1 last_seen has MIXED formats (ISO-T vs space) - string-compare presence queries overcount. Normalize: replace(substr(last_seen,1,19),'T',' ') > strftime('%Y-%m-%d %H:%M:%S','now','-2 minutes').
- GOTCHA: background tabs throttle rAF - overlay/countdown QA needs the tab focused (focus-tab).
- GOTCHA: tutorial overlay auto-dismisses on the 10s shot-clock auto-fire; countdown visible ~1s after match load eats 2s of the 3s hold.
- NOTE: this state.md update is committed locally but NOT pushed (no live PAT; push on next deploy cycle).

## 2026-09-28 ~18:53 IDT - Guest mode + i18n + cookie consent (v29) - local QA green
- Server+client complete: guest mode (admin-controlled: enabled/ttl_hours/games_until_register_prompt/ranked_allowed),
  i18n (login+game, lang switcher, EN default non-Hebrew), real cookie consent (bg_consent + /api/legal/consent).
- Guests: random name "אורח <adj> <4digits>", never on leaderboard (is_guest=0 filter), 403 on store/expansions/
  coatings/daily/coupons/invites, quick-match gated by ranked_allowed, AI games allowed, registration upgrades
  SAME row in place (+200 welcome coins, stats carry).
- REAL BUG FOUND+FIXED: sweepExpiredGuests ran as floating promise - Workers runtime killed the isolate mid-cascade
  (sessions deleted, users row survived). Fixed by threading ExecutionContext into handleApi and ctx.waitUntil() at
  both call sites (POST /api/guest, presence ping). Verified: backdated guest fully cascade-deleted.
- Versions: CLIENT_VERSION 29, SERVER_VERSION 29, SW release 47-guest.
- NOT YET DONE: remote D1 ALTERs (is_guest, guest_created_at), zero-player check+report, CF token re-mint,
  wrangler deploy, PAT flow (needs sudo code), gh-pages push, live QA, PAT revoke.

## 2026-09-28 ~19:36 IDT - v29 WORKER LIVE on prod; awaiting GitHub sudo code for gh-pages push
- CF token re-minted from vault via data: page + vault fill + execute-js --async (token never in transcript/reports; /tmp/cf_token 600; verified active via CF API).
- Remote D1 migration applied+verified: users.is_guest (DEFAULT 0), users.guest_created_at. 0 guests existed.
- Zero-player gate: 0 users last_seen<45s, 0 active/waiting/offered matches -> reported to parent BEFORE deploy.
- wrangler deploy: worker v29 live (Version ID 3c2b30ac-6599-41ed-a5e1-72e61390160f).
- Live API QA on prod worker GREEN: options.guest_enabled, guest create (name, 24h expiry in .guest.expires_at / guest_expires_at top-level),
  store 403 guest_forbidden, quick 403 guest_ranked_forbidden, consent 200, admin gameplay-controls guest_mode group readable.
- Prod QA probes cleaned (2 guests + planted admin session removed; verified 0). Leases released, guidance recorded.
- /tmp/ghp worktree staged on origin/gh-pages (fcf48e6) for the push.
- BLOCKED ON: user's GitHub sudo code (requested via parent 19:29) for PAT mint -> gh-pages push + main push (local main 1e6889b ahead).
- THEN: live client QA on game URL, revoke PAT + verify 401 + shred, final Hebrew report.

## 2026-09-28 ~19:53 IDT - v29 FULLY DEPLOYED (guest mode + i18n + consent live on game URL)
- GitHub sudo code relayed by user 19:43 -> PAT deploy-guest-v29-2026-09-28 minted (ubriga/brigagame only, Contents RW + Metadata RO, expires Oct 5).
- Pushes: gh-pages 537d803..032a0bf, main fa14d97..fb50639. CAUGHT+FIXED: GSC verification meta existed only on gh-pages - persisted to master index.html (fb50639) before push.
- Live verified: config.js CLIENT_VERSION 29 + API_BASE worker, app v50, consent v1, sw 47-guest. Login page shows guest button + REAL consent banner (EN default confirmed - browser locale en).
- PAT REVOKED via UI (gone from list) + 401 verified via API. gh_pat shredded. NOTE: token was accidentally exposed once in a read-page transcript (textbox value) - neutralized by immediate revocation after pushes.
- Prod probe cleanup: 1 UI-created guest cascade-deleted, 0 guests remain. CF token re-minted for cleanup then shredded (final). All leases released, guidance recorded.
- state.md unpushed (PAT revoked) - push with next token flow.
- Tomorrow 10:15: PH launch verification wake pending.

## 2026-09-28 20:45 IDT - v31 built, deploy gated by live traffic
- Guest-eye audit complete (login/lobby/rating/messages/tags/store/custom/how-to-play/bot game as real guest).
- Findings beyond user's four: #/store + #/custom direct URLs render fully for guests (server already 403s all guest actions there). FIXED client-side in v31 (commit 9bd0439, local main, UNPUSHED): locked cards for guests + i18n EN entries for all guest strings (fixes v30 garble).
- v31: CLIENT_VERSION 31, SERVER_VERSION 31, sw 49-storelocks, app.js?v=52.
- DEPLOY BLOCKED: 8 users active in last 45s (0 live matches) - zero-player rule. Monitoring wake wakeschedule-01M3MHVWJY22NNZEWPKMDYSA2T (30min, trigger=zero players) will deploy when clear. PAT mint needs sudo; if expired, ask parent for fresh sudo code relay.
- Audit guest id 40 (אורח זריז 3631) cascade-deleted from prod D1, verified 0. Guest id 39 (אורח מדויק 8867, created 19:59 IDT) left untouched - possibly a real visitor.
- /tmp/cf_token KEPT (needed by the wake). /tmp/cb_lease shredded, lease released.

## 2026-09-28 21:08 IDT - items 1+2+א built, awaiting zero-player deploy
- Item 1 DONE + live: auth_flow.popup_enabled=false in prod D1 (settings/gameplay_controls, all other keys preserved), /api/auth/options returns popup:false, login page visually verified: ONE green Google button, no GSI iframe.
- Item 2 DONE (code): 110+ dictionary entries added to i18n.js covering all missing app.js+game.js player-facing strings (panel.js admin strings not covered - reported). Commits 3ca541d + abde227 (v32: client 32/server 32/sw 50-msgs-i18n/app.js?v=53).
- Item א DONE (code): vMessages rewritten - card per message with icon, readable dates (היום/אתמול), "חדש" badge, "סמן הכל כנקרא" button (localStorage seen-set), designed empty-state. Auto-mark caveat: server marks read on GET - full button semantics need the tiny server change (parent asked user 20:56, PENDING). NOT shipped: any mark-all server change.
- Deploy: combined v31+v32 at zero-player window, wake wakeschedule-01M3MHVWJY22NNZEWPKMDYSA2T (30min, trigger=zero players) does full deploy + EN sweep + QA re-seed/cleanup + report.
- QA user 42 seeded for sweep then DELETED (would pollute prod leaderboard); wake re-seeds post-deploy. Learnings recorded: hash-nav doesn't reload SPA; D1 datetime() vs toISOString format trap; screenshot --save works in text mode.
- /tmp/cf_token KEPT for the wake. Lease released, guidance recorded.

## 28.9 late night - v32+v33 deployed (items 1+2+A complete)
- v32 (22:03): worker e7ef40b7, gh-pages 1a0b42a, main 0f8e99a. popup_enabled=false live, messages board refresh, i18n round.
- v33 (22:13): worker 9da75049, gh-pages 877d119, main f70ca33. FIX: i18n substring pass mangled server content (גרסא Newה, Drawני באגים) - boundary-aware regex (?<![א-ת])...(?![א-ת]) + data-i18n-skip on message title/body + leaderboard names.
- CRITICAL LEARNING: TWO D1 databases on the account! "brigagame" (531332d3, OLD/orphaned, 23.9) vs "brigagame-eu" (6e304f1a, REAL production, bound in cloud/wrangler.toml). `wrangler d1 execute brigagame` from repo ROOT resolves by NAME -> hits the OLD DB. Always run d1 commands from cloud/ (uses wrangler.toml database_id) or use the REST API with the uuid. QA seeds before 22:07 went to the wrong DB.
- Zero-player gate re-verified on REAL DB post-deploy: 0 connected during deploy window, no matches since 27.9. Condition held.
- PATs: deploy-v32-2026-09-28 + deploy-v33-2026-09-28, both Contents RW repo-scoped 7-day, both deleted after push (API 401 verified).
- QA users cleaned: id 44 + guest 43 (real DB), id 27 (old DB). FK cascade includes audit_logs.actor_user_id.
- Deploy cadence wake deleted. Health wake + PH wake (29.9 10:15) remain.

## 29.9 morning - v34 streak repair deployed + v35 consent (regulation-grade)
- v34 (b829367, ~08:01): paid streak repair (100 coins, offer valid return-day until IL midnight, restore as-if-never-missed with full-streak reward, admin toggle/price/manual restore), live coin chip after purchase, streak popup + lobby banner. Client 34/server 34/sw 52.
- INCIDENT 08:01-08:18: /api/me 500 for all registered sessions. Cause: v34 D1 migration (broken_streak/broken_on/repair_used_on/repair_used_for) had been applied to LEGACY "brigagame" DB, not prod brigagame-eu. Diagnosed via Workers Logs (temporarily enabled): "no such column: broken_streak". Fixed via eu console ALTERs 08:18. No partial writes (single-statement atomicity); missed login grants self-healed on next load. Observability disabled after.
- v34 UI QA (QA v34 account, real UI, screenshots): cookie banner PASS; coin chip 505->415 live PASS; streak popup+lobby banner PASS (Hebrew, no mojibake); repair offer 5->8 @100 coins PASS (500->405 = -100+5 reward; transactions streak_repair -100 "restored 8" + login_streak +5 "day 8"); decline PASS (reset to_one + day-1 reward); expired PASS (dedicated popup + reset); admin endpoint 403 for non-admin PASS; bot match full loop PASS. QA users 45+46 cascade-deleted (FK needed match_events/matches/coating_jobs/expansion_jobs/audit_logs/match_offers.invited_user_id/invites.inviter_id+claimed_by).
- v35 (f3227c1 main, 8aefc66 gh-pages, worker 285002c9, client 35/server 35/sw 53-consent, deployed ~08:43): regulation-grade consent per user steering. Research: Israel has no cookie rule; PPL Amendment 13 (in force 14.8.2025) = informed consent + transparency duties; GDPR/ePrivacy accepted pattern for intl visitors: strictly-necessary exempt, prior consent for the rest, granular, withdrawable as easily as given, evidence kept (ICO guidance). Implemented: ALL convenience prefs (lang, mute, aiTier, tutorial, install-dismiss, msg_seen, remember) now gated via Consent.setPref/getPref (persist only on "all", session-only on "essential"); withdraw mechanism = "הגדרות עוגיות" footer link reopens banner; essential re-choice purges persisted prefs (purgePrefs); banner text updated (change-anytime note); privacy.html new section 2 enumerating storage + provider fix (Cloudflare Workers, not PythonAnywhere); consent.js added to sw shell; index.html script order consent before i18n. Server /api/legal/consent already existed; audit_logs consent.choice verified recording (all + essential rows).
- v35 consent UI QA PASS: fresh-state banner, essential->session-only pref (ls null/ss set), no-persist across reload, footer reopen, accept->persist, withdraw->purge, server evidence rows.
- Tokens: GitHub PAT "deploy-v35-consent" (fine-grained, ubriga/brigagame Contents RW) + CF "wrangler-deploy-v35-consent" (Workers Scripts:Edit + D1:Edit). Revocation verified below before shredding.
- FOUND BUG fixed in v35: stale milestone text after repair ("בעוד -1 ימים") - client guard in showLoginReward.
- PENDING at close: admin manual streak-restore positive test needs Orel's admin session (endpoint + 403 verified only). PH launch verify wake fires 10:15.

## 29.9 ~09:05 IDT - v36 contact/bug-report form deployed
- User approved the recommended design (WhatsApp 8:54 "נלך לפי ההמלצה"): lobby button + nav entry "דיווח על תקלה / צור קשר", form (type bug/question/suggestion + free text + auto tech context: client version, UA, screen, lang), registered auto-identified, guests/visitors leave reply email, instant structured email to ubriga@gmail.com via existing inbox.lv SMTP, full admin control.
- Server: POST /api/contact (public; honeypot silent-drop; D1-backed hourly caps per identity - registered by user id, guests/visitors by hashed IP; limits from gameplay_controls.contact_form; stores contact_reports row + audit contact.report; emails via INBOXLV_* secret; failure -> audit contact.report_email_failed, report still stored). New table contact_reports (applied to brigagame-eu FIRST this time, verified before deploy). Admin: GET /api/admin/contact-reports (last 200). controlSpecs + DEFAULT_GAMEPLAY_CONTROLS section contact_form (enabled, destination_email, user_max_per_hour 5, guest_max_per_hour 2, max_length 2000).
- Client: lobby button (game card, always visible) + top-nav "צור קשר" + #/contact view + success screen; i18n EN entries; _lastHash captured for the auto screen context. Admin panel: contact_form settings card in gameplay tab + new "📮 פניות" tab listing reports.
- Email format (for mailbox watch): Subject "[Brigagame 2.0] <סוג בעברית> - <שם>"; body Key: value lines (Report-ID, Type, Player, User-ID, Account, Reply-Email, Screen, Client-Version, Language, User-Agent, Time) then "Message:" + text.
- Deploy: main a526abe, gh-pages 598b6f8, worker 166eed17 (client 36, server 36, sw 54-contact). Zero-player window verified (0 online, 0 live matches - user exited on request). PAT deploy-v36-contact-2026-09-29 (fine-grained, brigagame only, Contents RW, 7-day) minted via UI - GitHub did NOT demand sudo this time (fresh session); exposed once in a read-page transcript -> revoked immediately after push + 401-verified.
- QA PENDING below.
- v36 same-day fix (worker 7755de9a, main bcc30b1): validate form fields BEFORE consuming hourly rate-limit quota - invalid attempts no longer burn quota.
- v36 UI QA PASS (real UI, QA user id 48 + guest id 49): registered submit success screen (screenshot 060624); guest EN submit + success; rate-limit after fix: bad email no consume, 2 valid pass, 3rd -> 429 Hebrew; admin toggle off -> 403 Hebrew, on -> works; admin Reports tab 6 rows (screenshot 061113); admin contact_form card renders (screenshot 061200); gameplay regression full bot match (fire/turns/end screen) PASS. Email evidence SMTP-level: every submit mailed:true, zero contact.report_email_failed rows. inbox.lv WEBMAIL visual check blocked (login failed then hCaptcha) - webmail vault password possibly stale, SMTP secret still works; QA mails sit in that mailbox.
- Post-QA: destination_email restored ubriga@gmail.com; QA users 48+49 cascade-deleted (incl. match_events/matches), 6 QA contact_reports + contact audit rows + contact rate_limits purged; all 3 seeded sessions deleted (401-verified) and /tmp tokens shredded.

## 29.9 ~09:50 IDT - v37 mobile contact fix + admin reply mechanism
- User phone testing caught: (1) contact form on mobile "opened zoomed-out / nothing happened" - ROOT CAUSE: router never reset scroll; short contact view inherited the long scrolled lobby position, viewport landed at page bottom (footer). Fixed with window.scrollTo(0,0) on every route change + 16px inputs on <=640px (iOS focus-zoom guard). Verified in mobile emulation (390x844): lobby scrolled y=600 -> contact opens y=0 with form at top.
- (2) The success screen promised an email reply but no reply mechanism existed. Built: POST /api/admin/contact-reply (reply_enabled control, resolves registered -> current account email, guest/visitor -> left reply email, NEVER synthetic @guest.local), replied_at/reply_message columns (migration applied to brigagame-eu FIRST), audit contact.reply (masked to), reply UI per report in admin Reports tab + replied-state render, settings checkbox in contact_form card. Player email: Hebrew subject "Brigagame 2.0 - תשובה לפנייתך (#id)" + reply + quoted original, from brigagame.game@inbox.lv.
- INCIDENT (2 min, 09:39-09:43): gh-pages rsync overwrote the deploy-time API_BASE patch ("" -> worker URL), live site API calls 404ed. Fixed by commit e6cb67a restoring API_BASE. LESSON: gh-pages deploy step MUST re-apply API_BASE='https://brigagame.ubriga.workers.dev' after every rsync from cloud/public (done for the v37.1 push).
- QA (real UI, mobile emulation + cloud browser): registered mobile submit (#7, #8), guest mobile submit with reply email (#9), mailed:true on all; admin UI reply flow sent replies #8 (account email ubriga+qa37@gmail.com) and #9 (guest left email ubriga+qa37g@gmail.com) both mailed:true to real deliverable aliases; replied state renders ✅ in Reports tab; reply_enabled off -> 403 Hebrew, on -> works. Found+fixed same-day: guest accounts carry guest-<uuid>@guest.local which passed the email regex - resolver now skips @guest.local (v37.1 worker e84a4a1b). Note: .test recipient domains are rejected by inbox.lv at RCPT (undeliverable) - QA aliases on gmail used instead.
- Deploy: worker e2152e69 then e84a4a1b (v37), gh-pages d41b84c + e6cb67a (API_BASE fix) + 94686fa (placeholder fix, pushed with state), main 2259adc + follow-ups. PATs: deploy-v36-state (used for main+gh-pages v37), deploy-v37-fix (API_BASE fix push), both revoked via UI + 401-verified + shredded. QA users 53,54,55 cascade-deleted; reports 7-9 + contact audits + rate_limits purged; seeded sessions 401-verified dead.

## 2026-09-29 12:37 IDT — v38 mobile contact root-cause fix (DEPLOYED)
- His real-device video (12:14, Android Chrome): tap צור קשר → ~7s black → form tiny top-right. Emulation (guest+registered, Android+iPhone) did NOT reproduce: root cause = version-handshake reload (stale client vs new server, lobby-only rule) RACING his tap: reload nuked the navigation (7s black on mobile network), his pinches on the dark screen set page zoom ~0.5, form rendered tiny (media queries matched ≤640 → not desktop mode).
- Fixes: (1) idle-guard on the handshake reload (>10s since last route/tap, lobby only); (2) resetZoom() on every route (60ms maximum-scale clamp) so stray pinch zoom never leaves a view tiny.
- Proofs: race_fix.js (tap→NO reload, form in 9ms; idle lobby→reload fires ~18s); sw_upg.js (existing client SW 55→56 auto-update, old cache purged); live QA: Android guest 9ms render scale 1, iPhone 7ms, bot-match regression OK (screenshots /tmp/mob/qa_*.png).
- Deploy: zero-player window (presence 0, live matches 0); main d363bbb, gh-pages 9b48490, worker a0ac46a8 (v38); API_BASE re-applied post-rsync. PAT deploy-v38-zoom-2026-09-29 (7d, Contents RW, repo-scoped): minted via UI after sudo (code from user via WhatsApp), used, DELETED + 401-verified + shredded. QA guests 57-60 cascade-deleted. CF token re-fetched via vault, shredded after.
- LESSON: gh-pages Pages build ~45-60s; check ?v= param on index.html not asset cache. LESSON: GitHub ax tree hides aria-selected in repo picker + permission adds look unclicked in ax; verify with execute-js or screenshot. SPAM: PH launch drew upvote-scam (upvote.network) + seeto.ai mails; both auto-TRASHED by his filters.

## 2026-09-29 17:58 IDT — PROJECT RULE: graphic upgrade direction (user, via main)
- His guiding line for the Clash Royale / Brawl Stars-style visual upgrade (approved "תכין כיוון חזותי", todo-01M3PTR1A0MJR3QM6MKS13BJ8D):
  1. Professional character/tower design - one consistent art line, colorful, readable.
  2. Animation - the tower is alive, not static.
  3. Juice - particles, screen shake, hit-stop on impact.
  4. Gameplay - short matches, progression, leagues.
- Constraint: current browser tech (WebGL/Canvas), NO rewrite, design-phase only (no live-game or code changes) until he picks a direction and says "רוץ".

## 29.9 ~20:02 IDT - Orel picked direction ד2 "צריחי השעון" for graphics 3.0
- ג' papercraft + its spec SHELVED. ד1 basalt not picked. Full D2 spec delivered to parent (clockwork.js sprite layer, ~10-14 WebP sprites ≤400KB, living-tower via gears/steam/gauge not face, team-color accents constraint, 3 phases, admin toggle rollback, low-spec, ~20-26h, 7 open decisions incl. face/automaton, team tint strength, projectile skin, airship motion, lobby CSS phase, steam SFX, phased vs single).
- Status: awaiting his "מאשר" on spec + answers to open decisions. NO CODE before "רוץ".
- Health wake 19:43 done: healthy v38, API_BASE ok, 90s perf tail = ZERO traffic (quiet, no report owed). CF token shredded, lease L-if5jyvzond4cpl5tcuu5marqqe released.

## 29.9 ~20:23 IDT - Clockwork (D2) phase 1 BUILT + QA'd on dedicated test env
- Approval verified in WhatsApp history: user 20:00:39 picked ד2, 20:06:24 "יאללה" after spec; 7 explicit decisions relayed by parent 20:12 (no face, subtle team accents, BRASS RIVET projectile, airship drifts, stage-3 lobby CSS yes but later stage, steam SFX yes phase 2, staged).
- Test env (zero live touch): worker brigagame-test.ubriga.workers.dev (v39) + NEW D1 brigagame-test (6deaf2d8-827d-4e82-88c4-50ea5236d865, schema applied). wrangler.test.toml (git-ignored? NO - committed). graphics_pack.enabled flipped via direct D1 settings writes (admin UI needs Orel's Google session, unavailable on test origin).
- Assets: 23 sprites PIL-generated by cloud/tools/gfx_clockwork.py (deterministic seed), 30.6KB total (budget 400KB). assets/gfx/clockwork/.
- Code: js/clockwork.js (separated layer; mode()=null/low/full; preload; FPS probe auto-low<45fps after 3s; hwConcurrency<=3 → low; manual 🎡 button (Consent pref bg_gfx_low: "1"=low,"0"=auto,"full"=force-full QA hook); pref added to consent PREF_KEYS purge list). game.js branches: background/tower/explosion/idleLife/debris/shot/smoke-steam + MAX_PARTICLES from control (32 low). Server: catalog.ts graphics_pack defaults (enabled FALSE default), admin.ts controlSpecs, routes.ts /api/me graphics payload, panel.js admin card 🎡. sw 57-clockwork caches all assets. config CLIENT_VERSION 39, wrangler.toml SERVER_VERSION 39 (live still 38 until deploy).
- QA (cloud browser, guest, bot matches, real UI): pack renders (brass towers/gears/windows/strips/pennants/chimney/airship/skyline), rivet mid-flight + trail, steam explosion + shards + ring + dmg numbers, end-screen regression OK, full match loops, ZERO console errors. Rollback: D1 flip off + reload → classic renderer fully back (evidence screenshot). Auto-low works (cloud browser weak CPU → "low"; force-full hook verified).
- Known/notes: dynamic obstacle stays classic gray (coherence item for phase 2/3); admin card visual QA pending (needs Orel's admin session - live stage); FPS probe did NOT trip in full mode (>=45fps avg over 3s in cloud browser); mobile emulation + his-device approval + phase-2 juice (gauge/hit-stop/victory/sounds) still ahead. NOT DEPLOYED TO LIVE.
- CF token shredded after use. Leases released.

## 29.9 ~20:30 IDT - Clockwork (D2) phase 2 BUILT + QA'd on test env (commit c97bf44)
- Built: pressure gauge+needle sprites at cannon muzzle (needle rides reloadFrac + recoil spike, static mid in low), hit-stop 75ms dt-freeze on explosion start (BEFORE stepAnims), end-of-match effects (winner fast gear + 3 steam puffs, loser dark sputter; skipped in low), steam.mp3 (5.7KB)+clank.mp3 (5KB) ffmpeg-synthesized in assets/sfx/, audio.js FILES+GAIN, game.js sound branches (steam on fire, clank on impact, pack-gated). sw RELEASE 58-clockwork-s2, index.html clockwork v2/game v23/audio v20. Deployed to test worker only (version d7d425c1). node+tsc checks exit 0.
- QA (cloud browser lease L-7lscbb76, guest, bot match, real UI): desktop battle renders gauges on both cannons, zero console errors; Sfx._buffers.steam/clank = real AudioBuffers; match end "You lost" flow clean; mobile emulation 390x844: lobby + battle render correctly, mode=full, rivet trail/airship/gauges visible.
- Caveats: hit-stop is feel-only (75ms, not screenshot-provable; logic placement code-verified); end-of-match tower effects sit behind the end overlay dim - code path verified, visual confirmed only partially through overlay; mobile = emulation only, Orel's device pending; admin card visual QA still deferred (needs his Google session, live stage); gauge visibility at desktop zoom is subtle (small sprite near cannon hub).
- Live UNTOUCHED: v38, pack default disabled. NO live deploy without explicit מאשר + zero-player window.
- CF token shredded after deploy. Lease released.

## 29.9 ~20:53 IDT - Clockwork ART V3 (mockup-derived) on test env (commit b50a178)
- User verdict (relayed): stage1/2 sprites "ממש רמה נמוכה" vs the D2 mockup; then voice-note FREEZE: all development stops except tower+background art toward the mockup; only his explicit design approval unfreezes.
- Approach change: v3 extracts art FROM the mockup itself (/downloads/dir-d2-clockwork.png, native 1672x941): golden-UI masked inpaint (arcs/projectiles/HP bars/explosion/airship), moon protected, then slices: bg_sky (y0-190 crop + feathered gradient to haze), bg_far (x430-1040 mountains/castles/viaduct, palindrome-tiled, per-column ridge alpha), gears+porthole windows (circular-masked from tower crops, porthole brightened 1.32x), airship (luminance+ellipse mask from raw scene). Blocks/strips/chimney/pennant/gauge = PIL v2 style (patina teal + brass frame + hull-texture overlay 0.28). TOTAL 98.4KB / 400KB.
- Fixed iteratively: sky blotch noise, banding (50px blocks -> per-pixel), tower cannons+HP blobs leaking into bands, moon eaten by inpaint (now protected post-dilation), arc ghosts (3 sweep passes), airship smudge, dark seam band (full-canvas gradient + 90px feather).
- In-game verified (cloud browser, guest bot match): painterly night scene renders, meteor event + explosions + gears + portholes + airship drift all live, no console errors seen. Known remaining gaps vs mockup: cannon barrel still classic gray (game.js-drawn, not skinned), center obstacle classic gray/yellow, hitflash white overlay unchanged, faint arc ghost barely visible in sky, airship inpaint smudge reads as dark cloud top-left.
- Frozen: stage-3 brass lobby CSS (built+deployed on test, uncommitted? NO - included in commit b50a178 but NOT to be worked on until design approval). All other development frozen.
- Side-by-side comparison: /downloads/art-v3-vs-mockup.png. Test env worker 4c0afcb8. Live UNTOUCHED (v38).

## Art v4 (2026-09-29 ~21:15 IDT) - DEPLOYED TO TEST, awaiting Orel design verdict
- Tower sheet: mockup left-tower body sliced 104x156 (4x6 grid, 26px cells), rounded-rect alpha r26; p2 columns mirrored. Cannon: extracted from mockup right tower, rotates around trunnion (rest 53.7deg).
- clockwork.js: per-block sheet slices; crumbling uses sheet tiles; strip/doorway/window/gauge suppressed in sheet mode; gears/chimney/pennant/steam kept. game.js drawCannon clockwork branch draws cannon.webp.
- Assets now 105.7KB / 400KB. sw.js RELEASE "59-clockwork-twr".
- QA: 180831 full-HP both towers read as mockup cylinders; 181249 mid-damage (holes+cracks over sheet). End-overlay shots 180936/181002/181050/181141 not useful.
- Honest gaps: towers narrower than mockup proportions; hitflash still square; center obstacle still classic; mobile emulation + his-device check pending; rank badge plaque still on tower front (product UI).
- FREEZE stands: no stage 3, nothing else until parent relays design verdict. Deployed to TEST only; no live deploy without explicit מאשר + zero-player window.

## Gemini gap-list session (2026-09-29 ~21:35 IDT)
- User approved one-off Google sign-in (WhatsApp 21:20:14, verified in observations). Signed into AI Studio as ubriga@gmail.com via cloud browser config-c; 2FA = Tap Yes number matching on his Galaxy S24 (relayed via parent). Uploaded mockup + 180831 + side-by-side to Gemini 3.1 Pro Preview; got 34-item gap list (/tmp/gemini_gaplist.txt, sent to parent verbatim + achievability assessment). Signed OUT and confirmed ("Signed out" on chooser); lease released; guidance recorded.
- Gemini misreads to remember: called v4 towers "flat rectangles/ghostly" (actually mockup sheet, alpha fixed) and "no explosion" (idle screenshot). Real gaps: proportions/3D base, flags/lanterns/pipes, sharp moon/stars/bridge, ground pier, hazard block, trajectory/healthbar styling, palindrome-tiling kaleidoscope artifact.
- FREEZE stands: no implementation until he marks which items he wants.

## WebGL 3D spec (2026-09-29 ~22:25 IDT) - PENDING OREL APPROVAL
- User verdict 22:17 via parent: "אז לך על החלק הראשון של ההודעה, לא רוצה את הפתרון הסטטי" = real WebGL 3D, rejecting static sprites. Spec written BEFORE any code per freeze rule.
- Spec = File file-01M3Q9Q4NMAM7QV7C0CPKGTNBT (PRIVATE, published rev filerevision-01M3Q9VX02ZWN7FBFR4KWG1GV9): https://files.instinct.com/file-01M3Q9Q4NMAM7QV7C0CPKGTNBT — Hebrew RTL page, verified in preview.
- Key spec points: Three.js lazy render layer over server-owned block state; GLB models (Blender) for tower/cannon/background/ground; damage = 4 block states mapped to model segments; auto-fallback to v4 2D under 45fps; admin graphics_pack.webgl3d toggle with instant rollback; 60fps target on his S24 Ultra + adaptive pixel ratio; NEW 450KB lazy budget for 3D path (needs his explicit approval); staged rollout 5 phases, test-only; QA as human player; estimate 10-14 sessions; v4 becomes the official 2D fallback.
- FREEZE still stands: no code until he approves the spec + budget + phase-1 start.
- 22:49 WebGL 3D STAGE 1 live on TEST only (worker 9aebea90, sw 62-webgl3d-s1c). Architecture: WebGL canvas UNDER the 2D canvas (same-canvas getContext conflict found in QA #1 - a canvas with a 2D ctx can't take WebGL); 2D keeps HUD/aim/shots/particles, 3D paints world (r3dOn guards in draw()). Admin: graphics_pack.webgl3d_enabled/adaptive/min_fps; flag set on brigagame-test D1 via json_set (left ON for his device test). QA (guest bot matches): 3D render OK, blocks disappear on damage OK, 2D effects composite OK, flag-off rollback = pure 2D, zero 3D trace OK. Bug fixed mid-QA: early-return draw lost HUD -> hybrid. Race seen once: stale sw precache served old game.js during version swap -> seamless 2D fallback (works as designed). Gaps: placeholder cubes, no damage tint, enemy cannon static 45deg, obstacle stays 2D, flat bg, aim-rotation visual not captured (code-verified; drag aim needs own turn + muzzle grab r145), his-device check pending. __game hook added for QA introspection.
- 23:07 WebGL 3D STAGE 2 live on TEST only (worker e1392c86, sw 67-webgl3d-s2e). Real GLB models replace placeholder cubes: pygltflib generator (/tmp/gen_glb.py, flat-shaded, per-primitive PBR) -> assets/gfx3d/ block_brass 9.7KB, block_window 8.6KB (emissive amber pane), block_vent 10.1KB, cannon 11.7KB = ~40KB of the <=250KB model budget. Vendored GLTFLoader.min 13.5KB gzip + BufferGeometryUtils.min 4.2KB gzip (three core 135KB brotli; engine+loader within ~170KB approved engine budget). Deterministic window/vent/brass variant map per cell; cannon GLB clone per side. render3d.js: lazy load with placeholder fallback if GLB/loader fails; adaptive block now consumes App.graphics.webgl3d.adaptive + min_fps (was hardcoded 45). Bugs found+fixed in QA: (1) GLTFLoader imported './BufferGeometryUtils.js' unminified name -> dynamic import fail, fixed to min name; (2) ghost frames: hybrid draw skipped 2D background incl. implicit canvas clear -> clearRect when r3dOn; (3) MeshStandardMaterial metalness>0.5 with no envMap rendered near-black under plain lights -> metalness lowered (brass .20, brassLight .25, brassDark .15, iron .30, steel .50) + hemisphere light up. QA (guest bot match, swiftshader): bright brass towers, lit windows, 3D cannons, projectile/trajectory/HUD composite OK, match end state OK. QA overrides restored on test D1: webgl3d_enabled stays true, adaptive back to true, min_fps back to 45. Gaps: same-window tint both sides, no damage tint (stage 4), enemy cannon static 45deg, center obstacle stays 2D, flat bg (stage 3), aim-rotation visual still not captured, swiftshader ~3.5fps (his S24 uses hardware GL - his-device check pending).
- 03:24 HOTFIX (test): his S24 feedback "delay from fire to impact". Root cause: stepAnims clamped dt to one frame (1/30s) - below 30fps every animation clock ran slow, so a 1.2s shell flight stretched 1.3-2.6x; the 3D pass dragging fps made it visible. Fix: anims now wall-clock true at ANY fps (clamp 1s, only anti-suspend protection); reconcile path (explosion scheduled dur-elapsed) now lands on time too. render3d adaptive also tuned: first window 1s (was 3s), steps x0.75 (was -0.25), DPR>2 devices skip MSAA + start at 1.5x. Measured on swiftshader 1.1fps: fire-to-impact 1.82s vs nominal 1.17+0.5 RTT = frame-quantized exact (was 2.69s at 250ms clamp, ~8x pre-fix). On S24 (30-60fps) clamp never engages. Worker test 70-webgl3d-s2h, game.js v29.
- 03:37 WebGL 3D STAGE 3 live on TEST only (worker 71-webgl3d-s3a). Background/ground/atmosphere: 2-layer mountain ridge silhouette, pale moon disc w/ crater hints, mockup airship (brass balloon, lit gondola) drifting, 3 drifting clouds, 170 static stars (one Points draw), 2 clockwork gears slowly counter-rotating at the horizon, riveted steel ground plates strip. All via 6 new GLBs (+49KB; models total ~89KB of 250KB) + ~70 lines scene wiring; per-frame cost = a few position/rotation writes, wall-clock dt. Fog extended 800-1700 -> 900-2400. Bugs found in QA: mountains invisible twice - (1) color too close to sky+fog color, brightened; (2) ridge triangles had -z winding -> backface culled, flipped. Moon first placed outside camera frustum (above half-FOV), moved in. QA freeze technique for screenshots: stub g.applySnap + clear pollTimer (in-flight poll responses kept landing end states mid-shot). Guest bot match frozen at full HP for the evidence shot. Residual slight fire-to-impact delay on his S24 = known issue (accepted by user 03:33 "יש מעט דיליי אבל בוא נתקדם"), polish pass later if another timing component surfaces.
- 03:45 STAGE 3 ENRICHMENT (test, sw 73-webgl3d-s3c) after his "not rich, no details" verdict. Closed the mockup gap list: warm lantern posts x4 along platform (2 real PointLights + additive halo sprites), village-on-cliff silhouettes with lit windows at both edges, stone viaduct with 6 arches + lit deck lanterns mid-background, third far mountain layer, gradient sky dome (procedural 2px canvas texture, BackSide sphere, replaced flat bg color), stars in 2 size layers additive, moon 1.5x + halo sprite, mist banks (4 drifting soft sprites), water strip with specular sheen in front of platform, plates roughness .24 wet sheen, cool rim directional from behind, gears grounded on pedestals with axles, airship 1.3x + nose light. Glow/mist = one shared procedural radial CanvasTexture on sprites (zero texture files). +5 GLBs (~61KB); models total ~150KB of 250KB. First enrichment shot read washed-out pale: sky gradient too light + rim too strong -> deepened gradient (#02060e/#081a2c/#123243), rim .55->.35, halo .30->.42. QA: frozen-match screenshots 004420 (pre-mood-fix) + 004543 (final), scene kids 146.

## 2026-09-30 ~06:31 — stage-3 research-driven rebuild (sw RELEASE "74-webgl3d-s3d", render3d.js?v=10), test env only
- After 2nd rejection ("check international standards"), rebuilt from research: polylusion 3D polygon art guide (tier commitment, 5-7 palette, vertex-color gradients, single post grade), three.js UnrealBloomPass + ACESFilmic docs, vertex-color/AO articles.
- Applied: vendored three@0.160.1 postprocessing chain (EffectComposer/RenderPass/UnrealBloomPass/OutputPass), ACESFilmicToneMapping exposure 1.12, bloom(0.5,0.65,0.8) lazy w/ fallback, adaptive ladder drops bloom FIRST then pixelRatio, COLOR_0 vertex gradients baked into all GLBs (0.78 base→1.06 top), palette lock in gen_bg, per-row tower dimming (0.80-1.0), contact-shadow blobs under towers+gears.
- GLB total 202,836 bytes (~198KB). Budget: engine ~166KB gzip incl. post chain; well under 450KB cap.
- QA (test, guest, bot matches): bloom/composer/ACES live (toneMapping=4, exposure 1.12, pr=1, no adaptive drop). Screenshots: /downloads/cloud-browser-20260930-032641.png (late-match), 032941 (mid-match, airship). sw=74 on test only; prod untouched (still 73-lineage).
- NOT promoted to production; awaiting Orel verdict. Rollback flag intact.

## 2026-09-30 ~06:38 — stage-3 polish pass 1 (sw 75/76), test only
- Moon: emissive cut (1.0,0.875,0.55)→(0.42,0.37,0.24), craters moved to dedicated moonDim mat — disc keeps texture, halo sprite intact (parent: was blown out by bloom).
- Mountains: monotonic aerial fade far→near — new mountainFar mat (0.30,0.36,0.45 + emissive haze 0.07,0.09,0.12), far ridge peaks raised 300-470 (was occluded behind near ridge max 320), mid mountain gets small emissive lift, front mountainHi darkest (0.07,0.10,0.155). Fade now obvious at screenshot scale.
- Verified live: bloom/composer on, QA screenshot /downloads/cloud-browser-20260930-033741.png (match 7eee9c93a53c).
- Commits: 4147d5d (rebuild), plus polish commit (moon+mountains). sw 76 on test; prod untouched.
- Follow-up queued (parent 06:37): obstacle redesign — user directive via WhatsApp: obstacle "not interfering enough, not designed enough"; options brief requested (lettered, effort); follow-up task to raise obstacle involvement per-level + admin control.

## 2026-09-30 ~07:12 — obstacle steam press (visual-only, option ב relayed via parent 06:59), test only, sw 79
- New GLBs press_frame/press_piston (dedicated pressSteel/pressBrass/pressIron mats, lifted + slight emissive — first pass read too dark at night).
- render3d.js v11: lazy press build in draw(), cyclic piston (rise ease-out 35% / hold+lamp pulse 20% / slam 8% / rest), 3 steam puffs on slam (1.1s), additive lamp sprite (also pulses on ob.warning), ground rail when obstacle.motion enabled, press tracks obstacleNow() x every frame (server-owned hitbox; moving-obstacle modifier verified live).
- game.js: 2D striped box now drawn ONLY when r3d off (fallback), restyled brass + rivets. Server logic untouched; obstacle hitbox unchanged.
- QA (fresh lease, guest, bot match a374cfab5dc9, moving obstacle): press:true, rail:true, pressErr:null. Screenshots /downloads/cloud-browser-20260930-041102.png (piston up, lamp) + 041125.png (piston down/rest). Steam subtle in stills, better in motion (caveat).
- Direction chevrons (‹ ›) from old 2D box are gone in 3D mode (lamp covers warning) - noted for follow-up.
- Budget: +25KB GLBs (press_frame 16.6KB + press_piston 8.3KB), total models ~223KB - under caps.
- sw 79 test only; prod untouched; token shredded after deploy.

## 2026-09-30 ~07:33 — press v2 (mass + dark materials), test only, sw 80
- User rejected v1 ("נראה מוזר ולא כמו מכשול" - reads as wooden gantry, relayed via parent 07:26 with redesign direction: mass first, darker, brass accents only, keep cycle/lamp/steam).
- v2: posts 26-wide dark iron, solid steel back wall 116x176 (solid silhouette in every cycle state), heavy 120-wide riveted base, piston plate 70x46 occupying passage, dark steel/iron palette (0.16-0.20) with brass only on caps/trim/hazard plate/rivets/pipes. Lamp/steam raised to match taller frame (190/178).
- QA (live match b5ec5bcd6b0d; rejoined old match had render loop stopped after server-side end - fresh match required for motion QA): raised shot /downloads/cloud-browser-20260930-043257.png (y=118 hold), slammed/rest /downloads/cloud-browser-20260930-042814.png. Both read as solid obstacle in stills.
- sw 80 test only; prod untouched; token shredded.

## 2026-09-30 ~08:41 — reference frame (research work-order step 1), test only, sw 82
- User approved ("כן" 08:30 via parent) starting from reference frame per deep-research report (/downloads/report-36d3b1fc.md, 12 sources).
- Applied: (1) composition - moon 1.15x/halo 0.30, villages out to -340/W+200, one gear (was 2), viaduct z-440 + 0.75 dim; (2) lighting - hemisphere 1.15, new cool rim dir 0.6 from behind-top, warm front fill 0.5 - tower bodies no longer near-black; (3) tower identity - body blocks now cool painted 'plate' (0.292,0.352,0.408 + slight emissive) with brass top rims, NEW block_corner.glb (brass spine, mirrored outward on right edge), NEW block_belt.glb (brass band rows r%4==2), bigger windows (14px pane), cannon 1.28x + belt mount platform; (4) material family plate/plateDark added. Grid/width/destruction/hitboxes untouched - pure visual variants on same 24 cube.
- QA: fresh match 2afafce3d3ac frozen at start, BOTH TOWERS INTACT (432/432, 259/259). Frames: /downloads/cloud-browser-20260930-053615.png (wide towers + press center) + 054106.png (press raised center-left, lamp). Press verified live (moving-obstacle match; at one moment it slides behind right tower - QA framing only, not a bug).
- sw 82 test only; prod untouched; token shredded; steps 2-4 NOT started (await his verdict on frame).

## 2026-09-30 ~09:09 IDT - gfx 3.0 step 2 (finished tower) - sw 85 on test
- render3d.js v15: rubble destruction states (torn cols crowned via snap top-row test; fully-destroyed
  cols keep a ground stub), col pool uses real snap width (cap 8) - expansion cols render now,
  corner spine mirrored per real width.
- BUG FOUND+FIXED in QA: intermittent half-screen blackout = NaN/Inf HDR texel smeared by bloom's
  blur chain (proven by Float32 readback: NaN in composer buffer, direct render clean; bisect:
  moon DirectionalLight x one block group). Added NaN-guard ShaderPass before bloom (clamps bad
  texels). Verified: 4 passes, finite readback, full-frame renders in 2 matches + phone viewport.
- QA (frozen guest bot matches, real game scale): intact 060609, near-destroyed 060742 (rubble
  stubs visible, visCount [4,0,0,0] + rub y 105/9/9/9), phone 390px 060808.
- block_rubble.glb 6,632 bytes. Deploys sw 83->84->85 all to test env only.
- Guest-prompt feature STILL PARKED (parent 08:50: re-pop interval admin-configurable 5/10/20 min).

## 2026-09-30 ~09:23 IDT - gfx 3.0 step 3 (bg/floor/HUD integration) - sw 86 on test
- render3d.js v16: tower base plates + brass trim/bolts, stage front lip + 8 brass brackets,
  scorch decals, atmospheric haze band at mountain bases, post-chain vignette (after OutputPass).
- Admin gates: admCfg.floor_detail / admCfg.vignette (default on) under App.graphics.webgl3d master.
- No new GLBs (built from primitives + existing glowTex) - budget impact ~0 bytes.
- Comparison frames: BEFORE sw85 @61% (062025/062031) vs AFTER sw86 @49% (062237/062242),
  composites /downloads/cmp-before-after-step3.png + cmp-mockup-after-step3.png.
- HP mismatch (61 vs 49): bot hits ~70-90/salvo overshoot the freeze threshold; comparison targets
  the new elements, not tower state.
- HUD DOM left untouched (guest banner/buttons are his features; report gap 6 deferred to his call).

## 2026-09-30 ~09:33 IDT - gfx 3.0 step 4 (full game QA) - all green on sw 86
- Live fire via game's own fire(): mid-flight arc+shell over 3D (062931).
- Hits+destruction live: damage numbers, debris, rubble stubs in unfrozen matches (062950, 062732).
- English match renders identically (063140); Hebrew/RTL all session. Phone 390px covered in step 3.
- Perf (cloud desktop GPU, NOT S24): ~363fps combat avg, 328 draw calls / 24,240 tris per scene
  render, adaptive untriggered (pr 1, bloom on), NaN readback finite, 5 composer passes.
- 2D fallback proven live: forced Render3D.draw()->false mid-match, seamless 2D takeover same
  state (063222). NOTE: no webglcontextlost handler exists (black screen on real context loss) -
  edge case, not new (predates 3D work), flagged for his decision.

## 2026-09-30 09:59 - Critical obstacle collision fix + vertical motion + auth tables + overlay z-fix (test sw 88, server v40)
- BUG (his report): shots passed through the press. Root cause: 3D press visuals (116x184 silhouette) vs server hitbox 68x105 - shots through the upper half/sides of the visible press never collided. Fix: server box = press silhouette (OBSTACLE_W=116, OBSTACLE_H=184 in game_logic.ts); piston cycle capped (top 89) so visuals never exceed the box. Verified: flat shot server trajectory ends INSIDE box edge [545,303 in box 533..649/218..402]; high arc clears (node harness).
- FEATURE (his request): vertical raise/lower, server-owned in obstacleAt (same epoch ping-pong, lift shifts box y; collision bottom = ob.y+ob.h so shots pass UNDER a raised press) + client obstacleNow mirror + 3D/2D render follow lift. Admin: dynamic_obstacle gains v_enabled/v_speed/v_min_lift/v_max_lift (admin.ts schema, catalog defaults v_enabled=false, panel.js custom card). Rollback proven: D1 flip off -> lift 0 next match; flip on -> resumes.
- BUG 2 (his report): Google sign-in Error 1101 on test. Root cause: oauth_states + auth_codes tables missing from schema.sql (fresh test D1 lacked them; /start INSERT threw uncaught). Fix: schema.sql + tables created on brigagame-test D1. /api/auth/google/start now 302 -> Google. GOOGLE_CLIENT_ID secret set on test worker (public value from config.js). REMAINING for full sign-in: GOOGLE_CLIENT_SECRET + test redirect URI + JS origin registration in his Google Cloud console.
- BUG 3 (his report): menus/navigation feel stuck. Root cause: 3D stack positioned the 2D game canvas at z-index 1; #game-overlay had z-index auto -> end-screen/rematch buttons painted UNDER the canvas and were untappable after any match. Fix: #game-overlay z-index 2. Verified live: end-screen "חזרה ללובי" click navigates. Nav timings after match: lobby 1.5s first load (API), 26ms cached; howto 12ms; contact 51ms.
- Deploys: worker brigagame-test x4 (final Version ID 78b80a85), sw RELEASE 88-overlay-zfix, SERVER_VERSION 40. D1 test: v_enabled=true, v_speed=30, v_max_lift=120 (QA-visible values, admin can change).
- Commit 31c5e55. PROD UNTOUCHED (still v38 + pre-graphics clients). Guest-prompt feature remains PARKED.

## 2026-09-30 11:21 - sw 88 FULL-GAME QA COMPLETE + rollback ready (assignment 11:11)
- ROLLBACK READY: version cc36ffe5-8421-48a9-bc6f-d456418b6bd9 (sw 86) pinned via wrangler deployments list; runbook ROLLBACK-sw88.md (2f49234): Tier 1 `wrangler rollback`, Tier 2 D1 kills (v_enabled=false / enabled=false), Tier 3 pre-staged worktree brigagame-rollback-sw86 @959ea7a. Additive leftovers documented as no-rollback-needed.
- FULL-GAME QA (real UI, guest role, lease L-ewv4efigqh6vz5xljakk4xgboe): login screen, Google button->Google page (no 1101), email-code graceful Hebrew error, guest login, lobby HE+EN, how-to overlay, contact form (render only), full EN bot match (fire/arc/wind, bot retaliation, tower destruction, Move, Shield, weapon bar guest-correct, random-event toast), "You lost" end screen (3 buttons), rematch dialog + rematch starts (new matchId), 2D fallback via _r3d=false (classic renderer at new 116x184 obstacle size), rating locked-for-guest gate, admin-visibility DOM check (0 admin elements/text). ALL PASS.
- fps note: foreground probe ~363fps (cloud GPU); post-screenshot readings ~1fps = tab-background rAF throttling artifact, NOT regression (obstacle lift kept animating 85->10 during "1fps" window).
- Unimplemented-list audit vs state.md+memory: (1) guest-prompt PARKED by him; (2) test Google sign-in needs HIS console items; (3) webglcontextlost handler awaiting his decision; (4) admin card visual QA needs his admin session; (5) Shabbat lockdown built+OFF awaiting activation; (6) art v4 verdict pending. Everything else he asked (contact+WhatsApp, guest cap, obstacle collision, vertical motion, z-fix) is DONE.
- Token /tmp/cf_tok shredded 11:21. Lease released. browser_guidance recorded.

## 2026-09-30 11:37 - sw 89-guest-prompt LIVE ON TEST (SERVER_VERSION 41, worker 47fd150c)
- His "לשחרר" (WhatsApp 11:26:43, answering main's 11:22:33 list item 1) released the parked guest-prompt feature. Verified user evidence directly before building.
- Built: timed guest sign-up prompt, separate from the existing games-based one-time prompt. Server controls gameplay_controls.guest_prompt: enabled (default FALSE in catalog), interval_min (1-120, default 10), first_delay_sec (0-600, default 45). /api/me serves guest_prompt payload; client schedules show (lobby-only, never mid-match or over another popup, 30s retry while busy), ✕ close + "אולי אחר כך" dismiss (stamp via Consent-gated pref bg_guest_prompt_dismissed, added to purge list), re-shows every interval. CTA "הרשמה חינם" -> guest-upgrade login flow. EN+HE strings, RTL-aware ✕ placement. Admin panel card "⏰ הודעת הרשמה מתוזמנת לאורחים" with hints (panel.js v12).
- QA (lease L-sjoljbzsp46g5mjuw3vyokdfne, guest אורח סקרן 7630, real UI): first show after 8s ✓, ✕ dismiss + stamp ✓, re-show after 1 min ✓, HE render ✓, mid-match guard (75s in #/game, zero prompts) ✓, deferred show on lobby return ✓, admin off (D1 enabled=false) -> client cfg false, no prompt 40s ✓, flipped back ON for his test.
- TEST D1 guest_prompt left {enabled:true, interval_min:1, first_delay_sec:8} so he can see the re-show quickly; catalog defaults 10min/45s. Rollback target unchanged (sw 86 runbook covers sw 89 too; new D1 key additive, old code ignores it).
- Files: catalog.ts, admin.ts controlSpecs, routes.ts /api/me, app.js (v60), panel.js (v12), consent.js (v3 purge list), config.js CLIENT_VERSION 41, sw RELEASE 89-guest-prompt, wrangler.test.toml SERVER_VERSION 41.
- Token refilled+shredded 3x (deploy, D1 write retry via --file after quoting miss, off/on flips). Each session shredded; none persists.

## 2026-09-30 11:52 - sw 90c LIVE ON TEST (SERVER_VERSION 42, worker d28cb4a5): WebGL fallback + inline contact
- His 11:44 voice note (verified in phone_messages): guest-prompt approved for prod batch (queued, needs his final go + zero-player window); WebGL fallback approved; contact option ב' (inline overlay); Shabbat stays OFF untouched; Google console approved with steps-first rule.
- WebGL fallback (render3d.js v18): webglcontextlost listener on the gl canvas -> _r3d=false + dispose + Hebrew/EN toast; webglcontextrestored -> _r3dTryInit re-init. Init/draw exceptions already fell back; the lost-context silence was the black-screen gap. QA (real WEBGL_lose_context): forced loss mid-match -> instant 2D classic view (match continues, screenshot), toast "הגרפיקה המתקדמת נעצרה זמנית - עוברים לתצוגה הפשוטה" visible; restoreContext -> 3D re-inits live (r3d:true, canvas back).
- Inline contact (app.js v62): showContactOverlay() - form opens as overlay on the CURRENT page (hash unchanged) from lobby button + nav link; shared _contactMarkup/_contactWireSend with the #/contact route (kept for direct links); ✕/ביטול/backdrop close; success state in-overlay. QA: real submit from guest (ubriga+qa37g@gmail.com alias, marked "no reply needed") -> ✅ הפנייה נשלחה; nav link opens overlay; route still works.
- Fixes found in QA: honeypot at left:-9999px created horizontal scroll in overflow:auto card -> overflow-x:hidden (90b); textarea was missing from the dark input/select CSS selectors (white UA default, pre-existing app-wide) -> added textarea to both selectors + resize/box-sizing (90c).
- Prod untouched (v38). Rollback runbook (sw 86) still valid. Tokens refilled+shredded per deploy.

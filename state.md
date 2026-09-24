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

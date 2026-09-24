# Brigagame — Rollback Plan (post-Cloudflare cutover, 2026-09-24)

## Current state (post-cutover)
- Public URL https://ubriga.github.io/brigagame/ serves frontend v23 (gh-pages commit 9861d25)
  with js/config.js API_BASE = https://brigagame.ubriga.workers.dev
- Backend: Cloudflare Workers (brigagame.ubriga.workers.dev) + D1 (all data migrated, verified) + Durable Objects
- Worker var FRONTEND_ORIGIN = https://ubriga.github.io/brigagame (OAuth callback redirects back to the public URL)
- PythonAnywhere env (ubriga.pythonanywhere.com) is DORMANT but fully intact: code + brigagame.db untouched, web app still running. No data was deleted.

## Rollback procedure (to restore PythonAnywhere as backend)
1. Revert the cutover commit on gh-pages:
   git checkout origin/gh-pages
   git revert 9861d25        # or: git checkout 5934cf5 -- . && commit
   Push gh-pages (mint a fine-grained PAT: repo ubriga/brigagame, Contents RW, then delete the PAT after).
2. Wait for GitHub Pages build (~1-2 min), then verify:
   curl https://ubriga.github.io/brigagame/js/config.js  → API_BASE points at PythonAnywhere again.
3. Remove/ignore FRONTEND_ORIGIN on the worker (optional; only relevant if the worker is used again).
4. PythonAnywhere needs no action — it never stopped running.

## Caveat
Data written AFTER the cutover (2026-09-24 16:17 IDT) lives only in Cloudflare D1.
A rollback returns the PythonAnywhere DB as it was at 15:00 IDT on 2026-09-24.
To preserve post-cutover data, export D1 and import into the PA sqlite DB before rollback.

# Full rollback runbook: sw 88 / server v40 (obstacle + auth + overlay) → sw 86 / server v39
# Scope: TEST env only (brigagame-test worker + brigagame-test D1). Prod was never touched.

## Tier 1 - INSTANT full revert (seconds, one command)
Prereq: CF token via the standard procedure (vault 'Cloudflare API token (ubriga account)'
→ data:-page input → read back to /tmp/cf_tok, chmod 600; shred after).

    cd /home/sandbox/brigagame/cloud
    export CLOUDFLARE_API_TOKEN=$(cat /tmp/cf_tok)
    npx wrangler rollback cc36ffe5-8421-48a9-bc6f-d456418b6bd9 --config wrangler.test.toml

That version ID is the exact sw 86 deployment (2026-09-30T06:20:57Z, the last deploy
before the obstacle work; verified via `wrangler deployments list`).
It reverts worker code AND all static assets (index.html, js, css, sw.js "86-webgl3d-step3").
Clients pick up sw 86 on next page load automatically.

Verify after rollback:
    curl -s https://brigagame-test.ubriga.workers.dev/api/health    # expect "version":"39"
    curl -s https://brigagame-test.ubriga.workers.dev/sw.js | head -2  # expect 86-webgl3d-step3

## Tier 2 - INSTANT feature-level kills (no deploy, ~5s each)
Vertical motion only:
    UPDATE settings JSON: dynamic_obstacle.v_enabled = false
Whole moving obstacle:
    dynamic_obstacle.enabled = false
(SQL pattern: read settings key 'gameplay_controls', edit JSON, UPDATE back - same as
documented in state.md 09:52. sw 88 honors both immediately for new matches; sw 86 ignores
the v_* keys entirely, so no cleanup of the D1 override is required after a code rollback.)

## Tier 3 - source-level redeploy of sw 86 (only if Tier 1 ever fails)
Pre-staged worktree: /home/sandbox/brigagame-rollback-sw86 (commit 959ea7a = sw 86 exact source)
    cd /home/sandbox/brigagame-rollback-sw86/cloud
    export CLOUDFLARE_API_TOKEN=$(cat /tmp/cf_tok)
    npx wrangler deploy --config wrangler.test.toml

## Additive leftovers that need NO rollback (safe under sw 86 code)
- D1 tables oauth_states + auth_codes (sw 86 simply never touches the missing-table path on
  redirect start; tables existing is harmless; email-code flow unchanged)
- Secret GOOGLE_CLIENT_ID on the test worker (public client id; sw 86 behaves the same)
- D1 settings v_* keys under dynamic_obstacle (ignored by old code)

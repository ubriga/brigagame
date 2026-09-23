# Brigagame test deploy checklist (Cloudflare, PA untouched)

1. Auth: CLOUDFLARE_API_TOKEN (Orel-created: Workers Edit template + D1 Edit,
   account-scoped) exported in the shell, OR interactive `npx wrangler login`
   on Orel's own machine. Never a token created by the agent.
2. Run `./deploy.sh` (idempotent). It creates D1, applies schema.sql,
   sets the GOOGLE_CLIENT_ID secret, deploys, and health-checks.
3. First deploy creates the workers.dev subdomain; the URL becomes
   https://brigagame.<subdomain>.workers.dev (test URL for Orel).
4. ALLOWED_ORIGINS in wrangler.toml must then be updated to that URL and
   redeployed (one line + wrangler deploy).
5. Google sign-in on the test URL: the OAuth client (Google console) must
   list the new origin. Orel adds it himself in his Google console - the
   agent never touches Google. Until then, test access works via a seeded
   session row in D1 (same pattern as local E2E).
6. After Orel sees it working and approves, cutover (frontend config.js on
   gh-pages + data migration from PA) is a separate approval.

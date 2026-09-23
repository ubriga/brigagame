# Brigagame 2.0 - Cloudflare deployment (free tier)

One-time setup (needs Orel's free Cloudflare account - main agent coordinates):

1. `npx wrangler login` (browser OAuth as the account owner) - or an API token
   with Workers edit permissions stored in the vault.
2. Create the D1 database: `npx wrangler d1 create brigagame`
   -> put the returned `database_id` into wrangler.toml ([[d1_databases]]).
3. Apply the schema: `npx wrangler d1 execute brigagame --remote --file=schema.sql`
4. Set secrets: `npx wrangler secret put GOOGLE_CLIENT_ID` (same value as the
   PA backend config.py) - auth.ts verifies Google ID tokens against it.
5. Deploy: `npx wrangler deploy` -> https://brigagame.<account>.workers.dev
6. Seed the admin gameplay controls: they default to DEFAULT_GAMEPLAY_CONTROLS
   (catalog.ts, generated from the v23 Python backend) until the admin panel
   writes the settings row. No seeding needed.

Free-tier limits to respect: 100k req/day, D1 5GB/5M reads per day,
DO alarms included in the free Workers plan. No card ever - if any step
demands billing, STOP and report (standing rule).

The PA game (ubriga.pythonanywhere.com) stays live and untouched.
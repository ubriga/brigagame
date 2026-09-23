#!/usr/bin/env bash
# Brigagame Cloudflare TEST deploy. Prereq: auth via CLOUDFLARE_API_TOKEN env
# (Orel-created token, Workers Edit + D1 Edit) or an interactive wrangler login.
# PA production is untouched by every step here.
set -euo pipefail
cd "$(dirname "$0")"

: "${CLOUDFLARE_ACCOUNT_ID:=5e955950dfaddf0d9e1f3e40877ad6aa}"
export CLOUDFLARE_ACCOUNT_ID

echo '== 1. create D1 (idempotent by name)'
npx wrangler d1 create brigagame || true
DB_ID=$(npx wrangler d1 list --json | python3 -c "import json,sys;print([d['uuid'] for d in json.load(sys.stdin) if d['name']=='brigagame'][0])")
echo "database_id: $DB_ID"
sed -i "s/database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml

echo '== 2. apply schema (20 tables)'
npx wrangler d1 execute brigagame --remote --file schema.sql --yes

echo '== 3. secrets (public Google client id from public/js/config.js)'
CID=$(grep -o '[0-9]*-[a-z0-9]*\.apps\.googleusercontent\.com' public/js/config.js | head -1)
echo "$CID" | npx wrangler secret put GOOGLE_CLIENT_ID

echo '== 4. deploy worker + DO + assets'
npx wrangler deploy

echo '== 5. verify'
sleep 3
curl -s https://brigagame.<SUBDOMAIN>.workers.dev/api/health
echo
echo 'NOTE: set <SUBDOMAIN> from the deploy output (first deploy creates the workers.dev subdomain).'

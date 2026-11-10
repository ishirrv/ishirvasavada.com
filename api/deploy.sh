#!/usr/bin/env bash
# Deploys the site API to Cloudflare. Run by .github/workflows/pages.yml.
# Needs CLOUDFLARE_API_TOKEN and DASHBOARD_PASSWORD; ANTHROPIC_API_KEY turns the assistant on.
set -euo pipefail
cd "$(dirname "$0")"

CF=https://api.cloudflare.com/client/v4
cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$@"; }

CLOUDFLARE_ACCOUNT_ID=$(cf "$CF/accounts" | jq -r '.result[0].id // empty')
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || { echo "::error::The Cloudflare token can't list its account. Create it from the 'Edit Cloudflare Workers' template."; exit 1; }
export CLOUDFLARE_ACCOUNT_ID WRANGLER_SEND_METRICS=false

npm ci --silent

# Database: create once, then apply the schema (every statement is IF NOT EXISTS).
db_id() { npx wrangler d1 list --json | jq -r '.[] | select(.name == "ishirvasavada") | .uuid'; }
DB_ID=$(db_id)
if [ -z "$DB_ID" ]; then
  npx wrangler d1 create ishirvasavada > /dev/null || { echo "::error::Couldn't create the database. Add the 'D1: Edit' permission to the Cloudflare token."; exit 1; }
  DB_ID=$(db_id)
fi
sed -i "s/00000000-0000-0000-0000-000000000000/$DB_ID/" wrangler.toml
npx wrangler d1 execute ishirvasavada --remote --yes --file schema.sql > /dev/null

# A new Cloudflare account has no workers.dev address yet; claim one.
sub() { cf "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" | jq -r '.result.subdomain // empty'; }
SUB=$(sub)
if [ -z "$SUB" ]; then
  for name in ishirvasavada ishirv ishirvasavada-site "ishirv-$(date +%s | tail -c 5)"; do
    cf -X PUT "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" -d "{\"subdomain\":\"$name\"}" > /dev/null
    SUB=$(sub); [ -n "$SUB" ] && break
  done
fi
[ -n "$SUB" ] || { echo "::error::Couldn't set up a workers.dev address for this Cloudflare account."; exit 1; }

npx wrangler deploy

# Secrets live only in Cloudflare. The salt keeps stored visitor hashes from being reversible.
SALT=$(printf 'salt|%s' "$DASHBOARD_PASSWORD" | sha256sum | cut -c1-32)
jq -n --arg a "${ANTHROPIC_API_KEY:-}" --arg k "$DASHBOARD_PASSWORD" --arg s "$SALT" \
  '{ADMIN_KEY: $k, SALT: $s} + (if $a == "" then {} else {ANTHROPIC_API_KEY: $a} end)' | npx wrangler secret bulk > /dev/null

URL="https://ishirvasavada-api.$SUB.workers.dev"
echo "url=$URL" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "Deployed $URL"

# Smoke test: the API is up, and the assistant answers when its key is set.
for i in 1 2 3 4 5 6; do curl -fsS "$URL/health" && break || sleep 10; done; echo
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  curl -fsS -X POST "$URL/chat" -H 'Origin: https://ishirvasavada.com' -H 'Content-Type: application/json' \
    -d '{"sid":"ci-smoke","messages":[{"role":"user","content":"In one sentence, what is Recognito?"}]}' | jq '{answer, actions, ok: (.turn != null)}'
fi

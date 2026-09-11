#!/usr/bin/env bash
# Backend control-plane remote deploy for release-backend.cmd (JS-gen).
# Usage: bash release-backend-remote.sh <ts> <tarball-name>
# Extracts the uploaded pack, copies the live .env, installs deps, migrates, flips
# /data/app/JS-gen, restarts node server.mjs (:4097), verifies, prunes (keep 3).
# Prepare phase failures leave the old release untouched (symlink not yet flipped).
set -euo pipefail

TS="${1:?usage: release-backend-remote.sh <ts> <tarball-name>}"
TGZ="${2:?missing tarball-name arg}"
BASE=/data/app/JS-gen-releases

# ---- prepare: nothing user-visible switches below this line -------------------
R="$BASE/$TS"
mkdir -p "$R"
tar -xzf "/tmp/$TGZ" -C "$R"
# live .env read via the symlink BEFORE it is flipped — always points at the
# previous release's config until the very end
cp /data/app/JS-gen/config/.env "$R/config/.env"
chmod 600 "$R/config/.env"
mkdir -p "$R/logs" "$R/tmp"
cd "$R"
npm ci --ignore-scripts --no-audit --no-fund 2>&1 | tail -2
npx knex migrate:latest --knexfile config/knexfile.js 2>&1 | tail -2

# ---- switch: flip symlink, restart, verify ------------------------------------
ln -sfn "$R" /data/app/JS-gen
echo "deployed: $(readlink -f /data/app/JS-gen)"

OLD=$(pgrep -f 'node server.mjs' | head -1 || true)
if [ -n "$OLD" ]; then
  kill "$OLD" 2>/dev/null || true
  sleep 1
  kill -9 "$OLD" 2>/dev/null || true
fi
cd /data/app/JS-gen
setsid nohup node server.mjs >> server.log 2>&1 < /dev/null &
sleep 4

if ! ss -ltnp | grep -q 4097; then
  echo "PORT 4097 NOT LISTENING"
  exit 1
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:4097/api/docs)
echo "api: $CODE"
if [ "$CODE" != "200" ]; then
  echo "API not 200 after restart"
  exit 1
fi

# retention: keep newest 3 (dir names sort chronologically, yyyyMMdd-HHmmss)
cd "$BASE"
for d in $(ls -1dt */ | tail -n +4); do
  rm -rf "./$d"
done
echo "kept versions:"
ls -1dt */
rm -f "/tmp/$TGZ" /tmp/release-backend-remote.sh

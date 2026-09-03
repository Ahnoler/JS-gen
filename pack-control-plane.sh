#!/usr/bin/env bash
# 打包后端控制面（仅控制面，不含执行机 executor/ 与 Python 脚本 scripts/）。
# 用法：在仓库根目录执行 ./pack-control-plane.sh，产物为 dist/JS-gen-control-plane-<时间戳>.tar.gz
# 服务器部署：解压 → cp .env.example .env 并填写 → npm ci → npx knex migrate:latest --knexfile config/knexfile.js → npm start（监听 4097）
set -euo pipefail
cd "$(dirname "$0")"

TS=$(date +%Y%m%d-%H%M%S)
OUT_DIR=dist
NAME="JS-gen-control-plane-$TS"
mkdir -p "$OUT_DIR"

tar -czf "$OUT_DIR/$NAME.tar.gz" \
  --exclude='config/.env' \
  --exclude='config/*.cmd' \
  server.mjs \
  api-docs.html \
  package.json \
  package-lock.json \
  start-all.sh \
  stop-all.sh \
  src \
  config/.env.example \
  config/config.js \
  config/database.js \
  config/knexfile.js \
  config/setup.html \
  migrations

echo "打包完成: $OUT_DIR/$NAME.tar.gz"
tar -tzf "$OUT_DIR/$NAME.tar.gz" | wc -l

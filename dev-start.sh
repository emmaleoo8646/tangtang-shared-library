#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ 检查 Postgres 容器…"
if ! docker ps --format '{{.Names}}' | grep -q '^tangtang-postgres$'; then
  echo "  启动 Postgres (端口 5436)…"
  TANGTANG_DB_PORT=5436 docker compose -f infra/local/compose.yaml up -d
  for i in {1..30}; do
    if docker exec tangtang-postgres pg_isready -U tangtang -d tangtang_library >/dev/null 2>&1; then break; fi
    sleep 1
  done
else
  echo "  已运行 ✓"
fi

cd services/api
[ -d node_modules ] || npm ci
echo "▶ 生成 Prisma client…"
npm run db:generate
echo "▶ 应用数据库迁移…"
npx prisma migrate deploy
echo "▶ 写入测试账号 (tangtang_demo / Demo@2026)…"
node seed-test-family.mjs
echo ""
echo "▶ 启动后端 API (http://127.0.0.1:3000)…"
echo "  日志: services/api/api.log  Ctrl+C 停止"
echo ""
exec npm run start:dev

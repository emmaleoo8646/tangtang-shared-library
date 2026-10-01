#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "用法: bash scripts/deploy-aliyun.sh <SSH目标> <服务器部署目录> <测试域名>" >&2
  exit 2
fi

deploy_target=$1
deploy_root=$2
site_domain=$3

if [[ ! $deploy_target =~ ^[A-Za-z0-9][A-Za-z0-9._@-]*$ ]]; then
  echo "SSH目标只能使用主机名、别名或 user@host 格式。" >&2
  exit 2
fi
if [[ ! $deploy_root =~ ^/[A-Za-z0-9/_-]+$ ]]; then
  echo "部署目录必须是不含空格的绝对路径。" >&2
  exit 2
fi
if [[ ! $site_domain =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "测试域名格式不正确。" >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
release_sha=$(git rev-parse --verify HEAD)
release_dir="$deploy_root/releases/$release_sha"
shared_env="$deploy_root/shared/.env"
compose_file="$release_dir/infra/aliyun/compose.yaml"

echo "将提交 $release_sha 部署到 $deploy_target:$release_dir"
ssh "$deploy_target" "install -d -m 700 '$deploy_root' '$deploy_root/releases' '$deploy_root/shared' '$deploy_root/shared/backups'"
if ! ssh "$deploy_target" "test -f '$shared_env'"; then
  echo "服务器缺少 $shared_env。请先按 infra/aliyun/.env.example 在服务器填写，再重试。" >&2
  exit 1
fi
if ! ssh "$deploy_target" "grep -Fxq 'SITE_DOMAIN=$site_domain' '$shared_env'"; then
  echo "服务器 $shared_env 中的 SITE_DOMAIN 与本次测试域名不一致。" >&2
  exit 1
fi
if ! ssh "$deploy_target" "grep -Eq '^AI_API_KEY=[A-Za-z0-9._-]+$' '$shared_env'"; then
  echo "服务器尚未配置 MiniMax API Key。请先在服务器私有 .env 中保存，再重试。" >&2
  exit 1
fi

git archive --format=tar HEAD | ssh "$deploy_target" "install -d -m 755 '$release_dir' && tar -xf - -C '$release_dir'"

if ssh "$deploy_target" "docker compose -p tangtang-library --env-file '$shared_env' -f '$compose_file' ps -q db | grep -q ."; then
  backup_file="$deploy_root/shared/backups/tangtang-$(date -u +%Y%m%d-%H%M%S).dump"
  echo "备份数据库到服务器 $backup_file"
  ssh "$deploy_target" "umask 077; docker compose -p tangtang-library --env-file '$shared_env' -f '$compose_file' exec -T db pg_dump -U tangtang -Fc tangtang_library > '$backup_file'"
fi

for service in api web; do
  echo "构建 $service 镜像"
  ssh "$deploy_target" "docker compose -p tangtang-library --env-file '$shared_env' -f '$compose_file' build '$service'"
done
ssh "$deploy_target" "docker compose -p tangtang-library --env-file '$shared_env' -f '$compose_file' up -d --no-build"

for attempt in {1..30}; do
  if ssh "$deploy_target" "docker compose -p tangtang-library --env-file '$shared_env' -f '$compose_file' exec -T web wget -qO- http://127.0.0.1/health" 2>/dev/null | grep -Fq '"service":"tangtang-api"' \
    && ssh "$deploy_target" "docker compose -p tangtang-library --env-file '$shared_env' -f '$compose_file' exec -T web wget -qO- http://127.0.0.1/api/books" 2>/dev/null | grep -Eq '"items"[[:space:]]*:[[:space:]]*\['; then
    ssh "$deploy_target" "ln -sfn '$release_dir' '$deploy_root/current'"
    echo "网页和 API 内部路由已就绪。请完成共享入口的 DNS、证书和 HTTPS 验收：https://$site_domain/health"
    exit 0
  fi
  sleep 2
done

echo "容器已启动，但内部 API 健康检查未通过；本次未更新 current 链接。" >&2
exit 1

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ! $2 =~ ^(http|https)$ ]]; then
  echo "用法: bash scripts/install-aliyun-ingress.sh <SSH目标> <http|https>" >&2
  exit 2
fi

deploy_target=$1
phase=$2
if [[ ! $deploy_target =~ ^[A-Za-z0-9][A-Za-z0-9._@-]*$ ]]; then
  echo "SSH目标只能使用主机名、别名或 user@host 格式。" >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
snippet="nginx-library-$phase.conf"
remote_snippet="/srv/tangtang-library/shared/$snippet"

ssh "$deploy_target" "install -d -m 700 /srv/tangtang-library/shared"
ssh "$deploy_target" "cat > '$remote_snippet'" < "$repo_root/infra/aliyun/$snippet"
ssh "$deploy_target" "bash -s -- '$phase' '$remote_snippet'" <<'REMOTE'
set -euo pipefail
phase=$1
snippet=$2
nginx_container=family-diary-nginx-1
expected_host=iZ2zej0u3aakz5svx9dr4xZ
if [[ $(hostname) != "$expected_host" ]]; then
  echo "SSH目标不是预期的阿里云 ECS，停止修改入口。" >&2
  exit 1
fi
template=$(docker inspect "$nginx_container" --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/templates/default.conf.template"}}{{.Source}}{{end}}{{end}}')
if [[ -z $template || ! -f $template ]]; then
  echo "未找到家庭日记 Nginx 的当前配置模板。" >&2
  exit 1
fi
if [[ $phase == https ]]; then
  docker exec "$nginx_container" test -s /etc/letsencrypt/live/library.douwuyou.cn/fullchain.pem
fi
marker="TANGTANG_LIBRARY_${phase^^}_BEGIN"
if grep -Fq "$marker" "$template"; then
  echo "$phase 入口已在当前 Nginx 配置中。"
  exit 0
fi
backup="$template.before-tangtang-$phase-$(date -u +%Y%m%d-%H%M%S)"
cp -p "$template" "$backup"
cat "$snippet" >> "$template"
if ! docker exec "$nginx_container" sh -c '/docker-entrypoint.d/20-envsubst-on-templates.sh && nginx -t'; then
  cp -p "$backup" "$template"
  docker exec "$nginx_container" sh -c '/docker-entrypoint.d/20-envsubst-on-templates.sh && nginx -t'
  echo "Nginx 配置检查失败，已恢复原模板。" >&2
  exit 1
fi
docker exec "$nginx_container" nginx -s reload
echo "已添加 $phase 入口；原模板备份：$backup"
REMOTE

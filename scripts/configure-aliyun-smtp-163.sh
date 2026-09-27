#!/usr/bin/env bash
set -euo pipefail

env_file=${1:-/srv/tangtang-library/shared/.env}

if [[ ! -t 0 ]]; then
  echo "请在交互式终端中运行，授权码不会回显。" >&2
  exit 2
fi
if [[ ! -f $env_file ]] || ! grep -q '^SMTP_PASSWORD=' "$env_file"; then
  echo "找不到共享书屋的 SMTP_PASSWORD 配置项。" >&2
  exit 2
fi

printf '请输入 163 邮箱客户端授权码（输入时不显示）：' >&2
IFS= read -rs smtp_password
printf '\n' >&2
if [[ ! $smtp_password =~ ^[A-Za-z0-9]{8,64}$ ]]; then
  echo "授权码格式不正确；配置未修改。" >&2
  exit 2
fi

umask 077
temp_file=$(mktemp "${env_file}.tmp.XXXXXX")
trap 'rm -f "$temp_file"; unset smtp_password' EXIT
while IFS= read -r line || [[ -n $line ]]; do
  case $line in
    SMTP_PASSWORD=*) printf 'SMTP_PASSWORD=%s\n' "$smtp_password" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$env_file" > "$temp_file"
chmod 600 "$temp_file"
mv "$temp_file" "$env_file"
echo "授权码已写入 ECS 私有配置。请通知我继续发信验收。"

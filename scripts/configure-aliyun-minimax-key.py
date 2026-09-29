#!/usr/bin/env python3
"""Interactively save the MiniMax key in the ECS private Compose environment."""

from getpass import getpass
from pathlib import Path
from tempfile import NamedTemporaryFile
import os
import re
import sys


if not sys.stdin.isatty():
    raise SystemExit("请在交互式终端运行，密钥输入不会显示。")

env_file = Path('/srv/tangtang-library/shared/.env')
if not env_file.is_file():
    raise SystemExit(f"未找到服务器私有配置：{env_file}")

key = getpass("MiniMax API Key（输入不显示）：").strip()
if not re.fullmatch(r"[A-Za-z0-9._-]+", key):
    raise SystemExit("密钥格式不正确；配置未修改。")

settings = {
    "AI_PROVIDER": "minimax",
    "AI_API_KEY": key,
    "AI_MODEL": "MiniMax-M3",
    "AI_BASE_URL": "https://api.minimaxi.com/v1",
}
lines = env_file.read_text().splitlines()
updated = []
seen = set()
for line in lines:
    name = line.split("=", 1)[0]
    if name in settings:
        updated.append(f"{name}={settings[name]}")
        seen.add(name)
    else:
        updated.append(line)
for name, value in settings.items():
    if name not in seen:
        updated.append(f"{name}={value}")

with NamedTemporaryFile("w", encoding="utf-8", dir=env_file.parent, prefix=".env.", delete=False) as temporary:
    temporary.write("\n".join(updated) + "\n")
    temporary_name = temporary.name
os.chmod(temporary_name, 0o600)
os.replace(temporary_name, env_file)
print("MiniMax 密钥已保存到服务器私有配置。")

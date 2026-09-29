#!/usr/bin/env python3
"""Securely save a MiniMax API key to the local, ignored API environment file."""

from getpass import getpass
from pathlib import Path
from tempfile import NamedTemporaryFile
import os


env_file = Path(__file__).resolve().parents[1] / "services" / "api" / ".env"
if not env_file.exists():
    raise SystemExit("未找到 services/api/.env，请先按 README 创建本地配置。")

key = getpass("请粘贴 MiniMax API Key（输入不显示），然后按回车：").strip()
if not key or any(char.isspace() for char in key):
    raise SystemExit("密钥不能为空，也不能包含空白字符；未修改配置。")

settings = {
    "AI_PROVIDER": "minimax",
    "AI_API_KEY": key,
    "AI_MODEL": "MiniMax-M3",
    "AI_BASE_URL": "https://api.minimaxi.com/v1",
}
existing = env_file.read_text()
lines = existing.splitlines()
seen = set()
updated = []
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
print("MiniMax 密钥已保存到本地后端配置。")

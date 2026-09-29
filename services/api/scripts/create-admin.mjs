import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { StringDecoder } from 'node:string_decoder';

if (!process.stdin.isTTY) throw new Error('请在交互终端运行，密码不能通过命令参数传入');
const db = new PrismaClient();
const rl = createInterface({ input: process.stdin, output: process.stdout });
const username = (await rl.question('管理员账号：')).trim().toLowerCase();
rl.close();
if (!/^[a-z0-9_]{4,24}$/.test(username)) throw new Error('账号须为 4—24 位字母、数字或下划线');

function hiddenInput(label) {
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    const decoder = new StringDecoder('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of decoder.write(chunk)) {
        if (char === '\u0003') { finish(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && char !== '\u007f') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

try {
  const password = await hiddenInput('密码（输入不显示，至少 12 位）：');
  const again = await hiddenInput('再次输入密码：');
  if (password !== again || password.length < 12 || password.length > 128) throw new Error('两次密码不一致，或密码长度不在 12—128 位之间');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  const passwordHash = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
  const admin = await db.adminAccount.upsert({ where: { username }, create: { username, passwordHash }, update: { passwordHash, active: true } });
  await db.adminSession.deleteMany({ where: { adminId: admin.id } });
  console.log('管理员账号已创建或重置。');
} finally {
  await db.$disconnect();
}

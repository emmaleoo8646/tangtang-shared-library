# 糖糖的共享书屋 API

Node.js 24 LTS、NestJS 12、Prisma 6、PostgreSQL 17。环境变量模板在仓库根目录 `.env.example`。

```bash
cp ../../.env.example .env
npm ci
npm run db:generate
npx prisma migrate deploy
npm run start:dev
```

`GET /health` 返回服务状态。运行 `npm run check` 可执行 lint、单元和端到端测试、构建与 Prisma schema 校验。

邮箱使用 HMAC 查找摘要，邮箱地址和公共交接地点使用 AES-GCM 加密；交接信息仅借阅双方可从 API 获取。密码使用加盐 scrypt 摘要，不保存明文。生产模式必须设置至少 32 位的 `AUTH_SECRET`，并配置 SMTP 主机、465/587 端口、用户名、授权码和发件地址。换掉 `AUTH_SECRET` 后，已有邮箱和交接地点将无法解读，务必妥善备份密钥。

设置独立的 `TEST_DATABASE_URL` 后运行 `npm run test:e2e`，可验证邮箱注册、账号登录、密码找回、双家庭借阅、并发申请、权限、续借和归还。不要将生产数据库用作测试库。开发模式跳过实际发信，在响应中返回测试验证码；生产模式绝不返回验证码。

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

手机号及交接信息只存加密数据；密钥不写入源码。真实家庭数据和儿童资料的接口尚未实现，不能把当前骨架用于公开服务。

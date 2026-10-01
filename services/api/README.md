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

## 批量借阅与书屋接口

- `GET /books?page=1&pageSize=200` 返回 `{ items, total, page, pageSize }`。不带分页参数的旧接口继续返回数组。图书包含公开 `shopId`、`status`、`series` 和 `seriesOrder`。
- `GET /shops/:id` 返回 ID、公开书屋名称和可空的 `avatarUrl`；`GET /shops/:id/books` 支持分页，仅展示公开图书。
- `GET /books/:id` 获取详情；下架图书只对书主可见。
- `GET /series` 返回当前账号的系列；`POST /series` 接收 `name`、可选 `summary` 和 `bookIds`，只允许整理自己书屋的书。发布/编辑图书可以传 `seriesId` 和可选 `seriesOrder`。
- `POST /loan-groups` 接收 `shopId`、`bookIds`、可选 `message` 和必填 `idempotencyKey`。在一个事务内校验并预约全部实体书；不允许混屋、重复 ID 或向自己申请。冲突返回409及 `unavailableIds`，不会创建残缺申请。同账号同请求编号的重试返回原申请；编号不能复用于不同内容。
- `POST /loan-groups/:id/action` 使用原单本操作名，可传 `loanIds` 指定部分图书；未指定时操作符合状态的全部图书。部分同意传 `action: approve`、`place`、`loanIds`、`declineRest: true`，其余待审批图书在同一事务中拒绝并解除预约。
- `GET /loans` 仍返回逐本记录，增加 `groupId` 和组共享 `message`；摘要从逐本记录计算。历史单本记录 `groupId` 为 null，原接口保持兼容。

新增真实数据库测试位于 `test/batch-borrowing.e2e-spec.ts`。必须设置专用 `TEST_DATABASE_URL`，测试包含多家庭并发抢同一本、整批回滚、幂等、权限、部分审批、分次借还、续借、超时和超过200本的书屋分页。

## 家庭书屋头像

- `PATCH /api/me` 在原资料字段之外接受 `avatarImage`：未传保留当前头像，图片 Data URL 替换头像，`null` 移除头像。验证失败不会保存其他资料字段。
- 支持 JPG、PNG、WebP，保存图片不超过 600 KB、最长边不超过 960 像素，头像必须为正方形。前端将最多 20 MB 的原图在浏览器中裁剪、压缩为 JPEG。
- `GET /api/shops/:id/avatar` 提供有效书屋的公开头像；头像缺失或书屋已注销时返回 404。资料及书屋响应提供带版本的 `avatarUrl`，图书提供 `ownerAvatarUrl`，借阅提供双方的 `ownerAvatarUrl` 和 `borrowerAvatarUrl`。
- 头像二进制仅在图片接口读取。发布前需要执行 `prisma migrate deploy` 并重新生成 Prisma Client；旧家庭的头像字段默认为空。真实数据库回归测试位于 `test/avatar.e2e-spec.ts`。

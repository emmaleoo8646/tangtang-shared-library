# 糖糖的共享书屋

一个由家长管理家庭账号、帮助孩子安全共享旧书并完成借还闭环的 Android App。首发目标设备为 HarmonyOS 4.2.0 华为手机，客户端采用 Flutter Android；iOS 暂缓。

## 工程结构

- `apps/mobile`：Flutter Android 客户端
- `apps/admin`：举报与运营处理后台
- `services/api`：NestJS API 与 Prisma 数据层
- `packages/contracts`：前后端共享的数据约定
- `infra/local`：本地 PostgreSQL
- `infra/aliyun`：后续阿里云部署文件
- `docs`：环境和架构记录

## 本机基线

- Flutter 3.47.5 / Dart 3.13.4
- Android SDK 36
- Node.js 24 LTS
- Docker + PostgreSQL 17（本地）

新终端已通过 `~/.zshrc` 配置 Flutter、Android SDK 和 Node 24。检查版本：

```bash
flutter --version
adb version
node --version
```

## 启动本地开发

1. 在仓库根目录复制环境变量：`cp .env.example services/api/.env`。
2. 启动数据库：`docker compose -f infra/local/compose.yaml up -d`。
3. 安装依赖并应用数据库迁移：`cd services/api && npm ci && npm run db:generate && npx prisma migrate deploy && cd ../..`。
4. 启动 API：`npm run api:dev`，健康检查为 `http://localhost:3000/health`。
5. 安装管理后台依赖并启动：`cd apps/admin && npm ci && cd ../.. && npm run admin:dev`。
6. 启动 Android 客户端：`cd apps/mobile && flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000`。

首次调试 APK 构建可运行 `bash scripts/build-debug-apk.sh`。脚本会优先使用阿里云 Maven 镜像，并保留 Gradle 官方源作为兜底。

真机调试时把 `10.0.2.2` 换成 Mac 在同一 Wi-Fi 下的局域网 IP。正式环境只使用 HTTPS。

## 安全边界

- 孩子只使用昵称、年龄段与阅读偏好，不公开真实姓名、联系方式或家庭住址。
- 交接信息只允许订单双方家长查看，数据库中按敏感信息设计。
- AI 密钥、短信密钥、数据库密码和 OSS 密钥只放后端环境变量。
- AI 生成内容必须由家长确认；无法确定的信息显示“待确认”。
- 发布签名文件与真实 `.env` 永远不进入 Git。

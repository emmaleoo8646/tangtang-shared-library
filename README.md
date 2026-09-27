# 糖糖的共享书屋

一个由家长管理家庭账号、帮助孩子安全共享旧书并完成借还闭环的项目。当前产品路线为手机浏览器优先的 Web 版；Flutter Android 原型保留作为历史验证资料。

## 工程结构

- `apps/web`：连接真实 API 的响应式 Web 站点
- `apps/mobile`：Flutter Android 历史原型
- `apps/admin`：举报与运营处理后台
- `services/api`：NestJS API 与 Prisma 数据层
- `packages/contracts`：前后端共享的数据约定
- `infra/local`：本地 PostgreSQL
- `infra/aliyun`：阿里云 ECS 容器部署配置
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

Web 本地运行：

1. 启动数据库：`docker compose -f infra/local/compose.yaml up -d`。
2. 复制 `.env.example` 为 `services/api/.env`，运行 `cd services/api && npm ci && npm run db:generate && npx prisma migrate deploy && npm run start:dev`。
3. 另开终端运行 `cd apps/web && npm ci && npm run dev`，打开 `http://localhost:5173`。Vite 将 `/api` 转发到本地 API。开发模式请求验证码时，页面会显示本地测试码；生产模式只通过阿里云短信发送。
4. 两个不同的浏览器会话可分别注册家庭账号，发布图书并完成借还流程。正式部署见 [阿里云部署说明](infra/aliyun/README.md)。

以下步骤仅供历史 Android 工程调试：

1. 在仓库根目录复制环境变量：`cp .env.example services/api/.env`。
2. 启动数据库：`docker compose -f infra/local/compose.yaml up -d`。
3. 安装依赖并应用数据库迁移：`cd services/api && npm ci && npm run db:generate && npx prisma migrate deploy && cd ../..`。
4. 启动 API：`npm run api:dev`，健康检查为 `http://localhost:3000/health`。
5. 安装管理后台依赖并启动：`cd apps/admin && npm ci && cd ../.. && npm run admin:dev`。
6. 启动 Android 客户端：`cd apps/mobile && flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000`。

首次调试 APK 构建可运行 `bash scripts/build-debug-apk.sh`。脚本会优先使用阿里云 Maven 镜像，并保留 Gradle 官方源作为兜底。

华为手机通过 USB 调试时，优先按 [真机验证步骤](docs/华为真机验证.md)使用最新 USB 调试包和 `adb reverse`。同一 Wi-Fi 下调试也可把 `10.0.2.2` 换成 Mac 的局域网 IP。正式环境只使用 HTTPS。

当前 Flutter 客户端为第 4 章可点击界面原型：找书、发布、消息、我的书屋四入口已出现，演示书均为虚构；登录、真实发布、借阅和举报尚未接入。开发任务与视觉规范见项目目录的 `第4章-温暖童趣界面.md`。

## 安全边界

- 孩子只使用昵称、年龄段与阅读偏好，不公开真实姓名、联系方式或家庭住址。
- 交接信息只允许订单双方家长查看，数据库中按敏感信息设计。
- AI 密钥、短信密钥、数据库密码和 OSS 密钥只放后端环境变量。
- AI 生成内容必须由家长确认；无法确定的信息显示“待确认”。
- 发布签名文件与真实 `.env` 永远不进入 Git。

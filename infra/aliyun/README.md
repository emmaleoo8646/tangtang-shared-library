# 阿里云 ECS 部署

目标机器是北京 ECS `i-2zej0u3aakz5svx9dr4x`，站点域名为 `library.douwuyou.cn`。机器上已有家庭日记站占用 80/443；共享书屋只在 Docker 内部提供 HTTP，由现有 Nginx 转发并沿用其 Certbot 证书续期服务。共享书屋的数据库和 API 不映射到公网端口。

## 首次准备

1. 在阿里云 DNS 为 `library` 新增 A 记录，指向这台 ECS 的公网 IP。确认 `douwuyou.cn` 的备案与当前站点信息适用。
2. 在服务器 `/srv/tangtang-library/shared/.env` 填写 `infra/aliyun/.env.example` 中的变量。文件权限设为 `600`。`POSTGRES_PASSWORD` 和 `AUTH_SECRET` 各用独立随机值；`DATABASE_URL` 中的密码须与前者一致。不要把真实 `.env` 传到 Git。正式注册向所有邮箱开放，无需配置邮箱白名单；旧的 `TEST_EMAIL_ALLOWLIST` 配置不再生效。
3. 注册验证和密码找回通过 SMTP 发送邮件。账号持有人需准备 SMTP 主机、465 或 587 端口、发件人地址和授权码，在服务器配置 `SMTP_*` 后重建 API 容器。发件授权码只保存在服务器，不传入 Git 或聊天。未配置邮件服务时，生产环境无法注册或找回密码。
4. 拍照识书与联网简介使用 MiniMax。在服务器私有 `.env` 中配置 `AI_API_KEY`；发布脚本会先检查它是否存在。密钥不得写进 Git、命令参数或发布日志。账号持有人可以先把仓库中的交互脚本传到服务器，再通过 SSH 隐藏输入密钥：

```bash
scp scripts/configure-aliyun-minimax-key.py alog-prod:/srv/tangtang-library/shared/configure-minimax-key.py
ssh -tt alog-prod 'python3 /srv/tangtang-library/shared/configure-minimax-key.py'
```

使用 163 邮箱时，在网易邮箱设置中开启 SMTP 服务并生成客户端授权码。服务器先配置 `SMTP_HOST=smtp.163.com`、`SMTP_PORT=465`、`SMTP_USER`。发件人显示名写在 `SMTP_FROM` 中，例如 `SMTP_FROM="糖糖的共享书屋 <sender@163.com>"`；尖括号内的邮箱地址须与 `SMTP_USER` 相同。实际收件箱显示名还可能受邮箱服务商的账号昵称或收件人通讯录影响，配置后要向外部邮箱发信验收。网易账号的“姓名”设置影响该账号所有外发邮件；若需要专用显示名，应使用独立发件邮箱。账号持有人从自己的终端运行以下命令，在无回显提示下输入授权码；不要把授权码放进命令参数或聊天：

```bash
ssh -tt alog-prod 'bash /srv/tangtang-library/current/scripts/configure-aliyun-smtp-163.sh'
```

更换为专用 163 邮箱时，在命令末尾传入新邮箱地址；脚本会把发件账号、显示名和授权码一起写入私有配置。保存后由运维人员重建 API 容器并进行真实邮件验收。

```bash
ssh -tt alog-prod 'bash /srv/tangtang-library/current/scripts/configure-aliyun-smtp-163.sh library_sender@163.com'
```

## 发布应用

在仓库根目录运行：

```bash
bash scripts/deploy-aliyun.sh alog-prod /srv/tangtang-library library.douwuyou.cn
```

脚本从当前 Git 提交打包上传，适用于先部署、再推送 GitHub。它会先备份已有共享书屋数据库，再构建、迁移并启动容器，确认内部 API 健康后更新 `current` 链接。更新前要先提交本地代码，因为未提交的文件不会进入发布包。

首次使用管理后台时，在服务器容器内创建独立管理员账号。通过 SSH 终端交互输入账号与密码，不要把密码发到聊天中：

```bash
ssh -tt alog-prod 'cd /srv/tangtang-library/current && docker compose -p tangtang-library --env-file /srv/tangtang-library/shared/.env -f infra/aliyun/compose.yaml exec api npm run admin:create'
```

## 接入现有 Nginx 和 HTTPS

应用容器就绪、DNS 生效后，先安装 HTTP 的 ACME 路由：

```bash
bash scripts/install-aliyun-ingress.sh alog-prod http
```

使用现有家庭日记 Compose 的 Certbot 服务，为 `library.douwuyou.cn` 签发证书。其 `certbot_config` 和 `certbot_webroot` 卷已用于现有站点，续期定时任务会处理卷中的新证书。签发成功后执行：

```bash
bash scripts/install-aliyun-ingress.sh alog-prod https
curl --fail https://library.douwuyou.cn/health
```

入口脚本会定位当前运行中 Nginx 所挂载的模板，备份原文件，追加共享书屋配置，验证 Nginx 后热重载。家庭日记发布新版本时，该项目可能换用新的模板；随后重新执行上述 HTTP、HTTPS 两步，确认 `https://library.douwuyou.cn/health` 仍可访问。

## 验收和备份

邮件服务配置完成后，用两个不同邮箱检查：注册验证码、邮箱验证、账号和邮箱登录、密码找回、发布、申请借阅、书主确认交接地点并同意、借方收书确认、申请续借、借方可选的送还提醒、书主收回确认，以及刷新后数据保留。只有这些步骤通过，才视为版本可用。

更新前脚本将数据库备份到服务器 `/srv/tangtang-library/shared/backups/`。应将备份另存到独立位置并每月做隔离恢复演练。应用可切回 `releases` 中的旧版，数据库结构变化需要用对应备份恢复，不能直接反向执行迁移。

当前版本支持压缩封面、MiniMax 识书、运营数据与选项维护。注册仅需账号、邮箱、验证码和密码，昵称默认使用账号，手机号可在注册后的家庭资料中补填。不收集不必要的儿童资料。公网扩大开放前需补齐隐私政策和用户协议。

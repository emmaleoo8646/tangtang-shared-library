# 阿里云 ECS 部署

此目录提供单台 ECS 的 HTTPS 站点、NestJS API 和 PostgreSQL 容器。部署前需确认域名已完成适用的备案并解析到 ECS，安全组放通 80/443，服务器安装 Docker Engine 与 Compose 插件。Caddy 会为已解析的域名申请证书。

## 首次部署

1. 在 ECS 上创建一个专用部署目录，例如 `/srv/tangtang-library`。在其 `shared/.env` 按 `infra/aliyun/.env.example` 填写域名、数据库密码、至少 32 位的 `AUTH_SECRET`、阿里云短信签名和模板，以及只允许发送短信的 RAM 凭据。短信模板参数名为 `code`。受控测试阶段将 `TEST_PHONE_ALLOWLIST` 设为允许登录的测试手机号，以英文逗号分隔。不要把真实 `.env` 传入 Git。
2. 在本地仓库根目录运行部署脚本，它从当前 Git 提交将源码直接传到 ECS，适用于先部署、再推 GitHub 的顺序：

   ```bash
   bash scripts/deploy-aliyun.sh root@ECS地址 /srv/tangtang-library 已备案的测试域名
   ```

3. 脚本先备份既有数据库，再构建并启动容器、等待 `https://域名/health` 通过。随后在两台浏览器上完成注册、发布、借阅和归还验收。API 容器启动时自动执行 `prisma migrate deploy`。若线上健康检查失败，检查 DNS、证书与容器日志；保留前一版 `releases` 目录供回滚。

## 备份与更新

升级前先将数据库备份到服务器上仓库外的受限目录，并把备份同步到独立位置：

```bash
umask 077
mkdir -p ~/tangtang-backups
docker compose -p tangtang-library --env-file /srv/tangtang-library/shared/.env -f /srv/tangtang-library/current/infra/aliyun/compose.yaml exec -T db pg_dump -U tangtang -Fc tangtang_library > ~/tangtang-backups/tangtang-$(date +%Y%m%d-%H%M%S).dump
```

更新代码后再次运行部署脚本，检查 `/health` 与容器日志。回滚应用使用上一版 `releases` 目录重建；数据库结构回滚需要先恢复相应版本的备份，不能直接反向执行迁移。恢复前停止 API，在空数据库中用 `pg_restore -U tangtang -d tangtang_library --clean --if-exists` 导入对应备份，然后启动 API。至少每月做一次隔离恢复演练。

## 上线边界

公网开放前需核对备案、短信签名模板、隐私政策与用户协议；目前图片上传、AI 识书和举报处理尚未实现。站点应先作为受控测试站使用，勿邀请真实家庭或上传个人资料。数据库和 API 不向公网映射端口；只开放 HTTPS 站点。

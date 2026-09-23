# 本机环境报告

检查日期：2026-09-23

| 组件 | 已验证版本 | 状态 |
| --- | --- | --- |
| macOS | 26.6.2，Apple Silicon | 可用 |
| Flutter | 3.47.5 stable | 可用 |
| Dart | 3.13.4 | 可用 |
| Android Studio | 2026.1.4.8 | 已安装 |
| Android SDK | 36.0.0 | Flutter doctor 通过 |
| adb | 1.0.41 | 可用 |
| Java | Android Studio JBR 25.0.3 | 可用 |
| Node.js | 24.21.0 LTS | 项目默认 |
| Docker | 29.4.1 | 服务可用；PostgreSQL 17 容器健康，初始迁移已应用 |
| Xcode | 未安装完整版 | iOS 暂缓，不阻塞 Android |

`flutter doctor` 的 Android toolchain 已通过。GitHub 网络检查偶发断开不影响已安装 SDK；Flutter 与 Dart 使用可信的 Flutter 中国社区镜像配置。

2026-09-23 在持久项目目录完成复核：Android 调试 APK 重建成功；API 单元与端到端测试、lint、构建、Prisma schema 校验通过；管理后台 lint 与构建通过；生产依赖审计为 0 个漏洞。`adb devices -l` 尚未发现连接设备，真机安装待完成。

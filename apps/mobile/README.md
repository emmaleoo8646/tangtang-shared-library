# Flutter Android 客户端

首发验证设备：HarmonyOS 4.2.0 华为手机。当前是第 3 章首页骨架，能够检查本地 API 是否在线。

```bash
flutter pub get
flutter analyze
flutter test
```

仓库根目录运行 `bash scripts/build-debug-apk.sh` 可使用阿里云 Maven 镜像构建调试 APK。真机运行时通过 `--dart-define=API_BASE_URL=http://电脑局域网IP:3000` 指向本机 API。正式发布前需改为 HTTPS 并使用正式签名。

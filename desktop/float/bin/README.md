# 悬浮层 helper 二进制放这里

| 平台 | 文件名 | 构建来源 |
|---|---|---|
| macOS | `gufa-float-macos-universal`（另含 arm64/x64 单架构） | `./scripts/build-float-macos.sh` |
| Windows | `win-x64/gufa-float-win.exe` | GitHub Actions `build-float-helper` 的 windows job（或本地 MSVC + WebView2 SDK） |
| Linux | `linux-x64/gufa-float-linux` | GitHub Actions `build-float-helper` 的 linux job（或本地 `make -C desktop/float/linux`） |

Host 端 `float.status` / `float.start` 会按平台自动在以上路径里找 helper；
找不到时会返回 `missing-helper` 并提示构建。

helper 与 Host 的通信协议见 `desktop/float/PLATFORM-PROTOCOL.md`。

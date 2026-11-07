# 摸鱼悬浮层 · 三平台真机验收清单

> 适用版本：`dsh-gufa-code >= 1.3.51`
> 先看一遍「通用自检」，遇到问题把自检 JSON + 平台日志一起发来，定位最快。

## 0. 通用自检（所有平台先做这一步）

1. 在 IDE 标题栏点「摸鱼」（📺 图标按钮）；
2. 选择器底部点「**自检**」；
3. 弹窗会显示平台、helper 路径/版本、运行时依赖、显示环境、辅助功能/WebView2 检测结果和 `notes` 提示；
4. 点「复制」把 JSON 保存下来；或点「**保存报告**」——会把自检 JSON + 最近日志写成一个 txt 文件（保存在 `~/.dsh/gufa-float-report-*.txt`）并自动在文件管理器中选中，直接把该文件发回来即可。`notes` 为空 = 没发现明显问题。

如果「摸鱼」按钮点了没反应、或选择器报错，也点「自检」，把报错/JSON 发出来。

## 0.5 CI 已自动覆盖的能力（2026-11 起）

每次 push / release 的 `build-float-helper` 会在真实 runner 上跑：

| 平台 | 自动化验证 |
|---|---|
| Windows (windows-latest) | ciProbe 加载本地页面 ok:true；真实窗口创建（EnumWindows 数可见窗口）；**跟随** notepad 窗口位置/大小、移动后继续跟随；**隐藏/恢复**标题为 "DeepSeek Harness" 的窗口；**状态注入**（页面读回 `gufa-code:float` / `float-state` / `project` / `ui:v1` 全部正确）；**透明 composition**（日志 `transparent-mode=composition` + 窗口 `WS_EX_NOREDIRECTIONBITMAP`）；**opaque 回退**（`transparent-mode=windowed reason=payload-opaque` 下窗口/退出正常）；controlPath 优雅退出 |
| Linux (ubuntu-24.04 + Xvfb + openbox) | ciProbe 加载本地页面 ok:true；真实窗口创建；**跟随** xterm 窗口位置/大小、移动后继续跟随；**状态注入**（同上四项 localStorage 全部正确）；**隐藏/恢复**标题为 "DeepSeek Harness" 的 xmessage 窗口（XUnmap→XMap）；**RGBA 透明路径**（xcompmgr 下日志 `使用 RGBA visual`）；controlPath 优雅退出 |
| macOS (macos-latest) | universal 构建 + 窗口列表辅助功能检查 |

所以剩下的真机验收重点：真实 DSH 集成（主窗口隐藏/唤回）、多显示器/DPI、外观（Windows 首版不透明）、Wayland（Linux）等 CI 覆盖不到的部分。

## 1. macOS（Apple Silicon / Intel）

前置：系统设置 → 隐私与安全性 → **辅助功能** 勾选 **DeepSeek Harness**（改完重启一次 DSH）。

验收步骤：
1. 点「摸鱼」→ 出现运行中 App 列表（图标 + 名称）；
2. 选一个普通窗口 App（如「访达」/「活动监视器」）→ 主窗口隐藏，悬浮层吸附到目标窗口；
3. 拖动/缩放目标窗口 → 悬浮层实时跟随；
4. 透明度滑块 20–100% 生效，重开摸鱼保持上次值；
5. 标题栏「退出摸鱼」→ 主窗口恢复、项目/标签页/会话状态带回；`ps aux | grep gufa-float` 无残留；
6. 全屏 App（如视频/音乐全屏）也能吸附。

日志：`/tmp/gufa-float-debug.log`、`/tmp/gufa-code-debug.log`

## 2. Windows 10/11 x64

前置：
- **WebView2 Runtime**：Win10/11 的 Edge 一般已自带；自检里 `deps.webview2Runtime` 为空说明缺失，去 <https://go.microsoft.com/fwlink/p/?LinkId=2124703> 装；
- 首次运行 helper exe 可能被 SmartScreen 拦截：「更多信息 → 仍要运行」；
- 无需辅助功能权限（窗口跟随走 Win32 API）。

验收步骤（和 macOS 相同 1–6 步），另外确认：
- 吸附后移动/缩放目标窗口，悬浮层跟随（允许 1–2 帧延迟）；
- 目标窗口最小化/关闭时悬浮层保持最后位置、不崩；
- `任务管理器` 里退出后没有 `gufa-float-win.exe` 残留。

已知限制 / 真机重点（1.3.54+）：
- 透明窗口用 DirectComposition 合成，**真机重点看观感**（能否透出下层 App；系统/远程桌面不支持时会自动回退不透明，日志 `transparent-mode=fallback reason=...`）；
- composition 模式顶部拖动条是网页层（按住可拖、右键菜单），页面内「退出摸鱼」按钮仍可用；
- **键盘输入**依赖 WebView2 焦点（CI 测不到）；
- 虚拟桌面切换时悬浮窗可能留在原桌面，切回后才可见；
- 多屏/DPI 已处理，但极端 DPI 组合仍需验证。

日志：`%TEMP%\gufa-float-debug.log`、`%TEMP%\gufa-code-debug.log`
WebView2 用户数据：`%LOCALAPPDATA%\gufa-float\`

## 3. Linux（仅 X11）

前置（Arch/Debian/Ubuntu 包名示例）：
```bash
# GTK3 + WebKit2GTK 运行库（4.1 或 4.0 任一）
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libsoup-3.0-0        # Debian/Ubuntu
# 可选：列窗口兜底
sudo apt install wmctrl xdotool
```
Requirements: DSH 必须在 **X11 会话**里运行（`echo $XDG_SESSION_TYPE`）；如果是 Wayland：
- 有 XWayland 时：用 `GDK_BACKEND=x11` 启动 DSH 后可用；
- 纯 Wayland：悬浮层只能「自由悬浮」，不能跟随/隐藏其它窗口（自检 `notes` 会提示）。

验收步骤：
1. 点「摸鱼」→ App 列表出现（优先用 helper 的 X11 实现；没有就退回 `wmctrl`）；
2. 选一个窗口 App → 主窗口隐藏、悬浮层吸附；
3. 拖/缩放目标窗口 → 跟随；
4. 「退出摸鱼」→ 主窗口恢复、状态带回、无残留进程（`ps aux | grep gufa-float`）；
5. 透明度：有合成器（GNOME/KDE 默认）时悬浮层应半透明。

已知限制：
- 纯 Wayland 下不跟随；
- 全屏 App 的置顶层级取决于窗口管理器（WM）；
- 无合成器时窗口不透明。

日志：`/tmp/gufa-float-debug.log`、`/tmp/gufa-code-debug.log`

## 4. 反馈模板

```
平台/版本：Windows 11 23H2 / macOS 15.2 / Ubuntu 24.04 (X11)
DSH 版本 + 插件版本：
操作步骤：
现象（截图更好）：
自检 JSON / 或「保存报告」生成的文件路径：
日志片段（/tmp 或 %TEMP% 里对应文件）：
```

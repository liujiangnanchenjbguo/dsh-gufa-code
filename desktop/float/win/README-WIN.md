# 古法编程 · Windows 悬浮层 helper（gufa-float-win）

独立小进程：用 **C++17 + Win32 + WebView2** 加载 DSH Web GUI 的「古法编程」，
做成无边框、永远置顶、可拖拽/可缩放、能吸附跟随其它 App 窗口的悬浮层。

行为协议见 [`../PLATFORM-PROTOCOL.md`](../PLATFORM-PROTOCOL.md)；
macOS 参考实现在 [`../GufaFloat.m`](../GufaFloat.m)。本目录只负责 Windows helper，
Host 侧（`host/dev.js` 的 `float.*`）与 CI（`.github/workflows/build-float.yml`）不在本目录维护。

## 文件

| 文件 | 说明 |
| --- | --- |
| `main.cpp` | 全部逻辑：payload 解析、Win32 窗口、拖动条、WebView2 宿主、follow、隐藏/恢复 DSH、controlPath 退出、ciProbe |
| `json.h` | 极简 JSON 解析/序列化（header-only，只依赖 C++17 标准库；数字保留原始文本） |
| `CMakeLists.txt` | MSVC 构建脚本；从 `WEBVIEW2_SDK_DIR` 找 `WebView2.h` / `WebView2LoaderStatic.lib` |
| `README-WIN.md` | 本文件 |

构建产物约定：`desktop/float/bin/win-x64/gufa-float-win.exe`（CI 从构建目录复制）。

## 依赖

- **Visual Studio 2022**（Desktop development with C++）或带 MSVC x64 工具链的等价环境
- **Windows 10/11 SDK**（`wWinMain`、DPI、Dwmapi 等）
- **Microsoft.Web.WebView2 NuGet 包**（只需解压，不需要 `nuget restore`）：
  - CI 固定使用 `1.0.2903.40`，解压后通过 `-DWEBVIEW2_SDK_DIR=<解压目录>` 传给 CMake；
  - 包内需要 `build/native/include/WebView2.h`、`build/native/include/WebView2EnvironmentOptions.h`、
    `build/native/x64/WebView2LoaderStatic.lib`（用静态 loader，产物是单 exe，不需要附带 `WebView2Loader.dll`）。
- **Microsoft Edge WebView2 Runtime**（运行期依赖，Windows 10/11 通常随 Edge 自带；
  缺失时程序会弹窗提示安装 <https://go.microsoft.com/fwlink/p/?LinkId=2124703> 并以退出码 1 结束）。
  helper 会显式把 `TargetCompatibleBrowserVersion` 设为 WebView2 GA 最低版本 `86.0.616.0`
  （并用 `QueryInterface` 对 `CookieManager` / `Controller2` 做降级），避免用户机器 Runtime
  稍旧时直接启动失败。
- 说明：产物未做代码签名，用户机器首次运行 exe 可能遇到 SmartScreen 提示（选「更多信息 → 仍要运行」）。

## 构建

CI（推荐，也是唯一被验证过的构建路径）：`.github/workflows/build-float.yml` 的 `windows` job 会
下载 NuGet 包 → `cmake -S desktop/float/win -B build-win -A x64 -DWEBVIEW2_SDK_DIR=...` →
`cmake --build build-win --config Release` → 复制到 `desktop/float/bin/win-x64/gufa-float-win.exe`。

本机 Windows 手动构建（PowerShell，仓库根目录）：

```powershell
$ver = '1.0.2903.40'
Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$ver" -OutFile wv2.zip
Expand-Archive wv2.zip -DestinationPath wv2 -Force
cmake -S desktop/float/win -B build-win -A x64 -DWEBVIEW2_SDK_DIR="$PWD/wv2"
cmake --build build-win --config Release
& .\build-win\bin\Release\gufa-float-win.exe --version
```

CMake 会依次尝试：`${WEBVIEW2_SDK_DIR}/build/native/include/WebView2.h` → 递归搜索；
loader 库优先 `build/native/<arch>/WebView2LoaderStatic.lib`，其次按架构递归匹配。
若 `WEBVIEW2_SDK_DIR` 未传，也会读取同名环境变量；两者都没有则 configure 阶段直接报错并给出提示。

## 运行方式

Host 用 `spawn(binary, [payloadJson])` 启动，**argv[1] 是协议里的整个 JSON**（见协议 §1）。
也支持几个便于排查/CI 的命令行参数（不影响 Host 协议）：

| 命令 | 说明 |
| --- | --- |
| `gufa-float-win.exe --version` | 打印版本并退出 0（CI 的冒烟步骤会用） |
| `gufa-float-win.exe --help` | 用法提示 |
| `gufa-float-win.exe --ci-probe` | 等价于 payload `{"ciProbe":true}` |
| `gufa-float-win.exe '<payload-json>'` | 正常启动 |

### ciProbe（CI 冒烟）

CI 传入：`{"appUrl":"http://127.0.0.1:1/","authUrl":"http://127.0.0.1:1/","ciProbe":true}`。
行为：

- 创建**隐藏**窗口 + WebView2 环境，加载 `appUrl`（缺省时用内置 HTML）；
- 页面加载完成（成功/失败都算）或 8s 超时后，stdout 打印**一行** JSON 并退出：
  - 走到探针结束：`{"ok":true,"platform":"win32","urlLoaded":true|false}` → 退出码 0
  - 环境创建失败（例如 runner 没有 WebView2 Runtime）：`{"ok":false,"platform":"win32","urlLoaded":false}` → 退出码 1
- 另有 20s 看门狗：即使 WebView2 环境创建卡死，也不会让 CI 步骤无限等待。

> CI 的 runner 可能没有可用 GPU，ciProbe 会额外传 `--disable-gpu`（只影响 ciProbe，不影响真机运行）。

## 已实现的协议条目

对照 `PLATFORM-PROTOCOL.md`：

- §2.1 启动
  - 解析 argv[1] JSON；解析失败 **退出码 2**（无参数也是 2）。
  - 无边框（`WM_NCCALCSIZE` 去掉系统边框）置顶（`WS_EX_TOPMOST`）可缩放窗口；
    自由悬浮模式下尺寸/位置保存到 `%LOCALAPPDATA%\gufa-float\frame.ini` 并恢复。
  - 鉴权两条路径：
    - `cookie` 存在：用 `ICoreWebView2_2::get_CookieManager` + `CreateCookie` / `AddOrUpdateCookie`
      注入 cookie（Domain 取 appUrl 的 host，Path=`/`），再导航 `appUrl?gufa-float=1`；
    - 否则：先加载 `authUrl`，等主 frame `NavigationCompleted` 后再导航 `appUrl?gufa-float=1`。
  - document-start 注入（`ICoreWebView2::AddScriptToExecuteOnDocumentCreated`）：
    `gufa-code:float='1'`、`gufa-code:float-state=<state JSON>`、
    以及（有值时）`gufa-code:project` / `gufa-code:ui:v1`；注入登记完成之后才开始导航。
  - 启动 **450ms** 后隐藏 DSH 主窗口。
- §2.2 吸附（payload 带 `follow.pid`）
  - 每 **250ms** 用 `EnumWindows` 找目标 pid 的最大/最前可见顶层窗口（`DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`，
    DWM 阴影边距不算在内；取不到时退回 `GetWindowRect`），把悬浮窗 `SetWindowPos` 到相同物理像素矩形；
  - 进程全程 `PER_MONITOR_AWARE_V2`，多屏/负坐标/不同 DPI 直接用物理坐标拷贝，`WM_DPICHANGED` 时重排；
  - 目标最小化/消失：保留最后位置继续轮询（约 5 分钟都找不到才降级为自由悬浮）；
  - 首次吸附和隐藏 DSH 之后用 `SetForegroundWindow`（配合 `AttachThreadInput`）把目标 App 前置。
- §2.3 隐藏/恢复 DSH 主窗口
  - 识别顺序：① 标题包含 `DeepSeek Harness` 的可见顶层窗口；② 可执行文件名包含 `deepseek` 的进程的窗口；
    ③ 两者都没有时，退化为「本 helper 的直接父进程（spawn 它的 Host 进程）」的窗口。
  - 隐藏用 `ShowWindowAsync(hwnd, SW_HIDE)`，退出时 `SW_SHOW` + `SetForegroundWindow` 恢复；
  - **安全策略**：不会盲信 `payload.ownerPid`（Host 传的是 `process.ppid`，可能是 explorer.exe），
    避免把任务栏/桌面隐藏掉。`ownerPid` 只作诊断信息。
  - 崩溃/terminate 兜底：未处理异常过滤器会把已隐藏的 DSH 窗口尽量恢复，避免「主窗口消失」。
- §2.4 顶部拖动条：窗口顶部 **22 DIP** 高的子窗口（与网页 CSS `padding-top:22px` 对齐）：
  按住拖动（`WM_NCLBUTTONDOWN`/`HTCAPTION`）、左键最右侧「✕」退出摸鱼、右键菜单（退出/重置窗口位置）。
- §2.5 控制文件退出：每 **300ms** 检查 `controlPath` 是否存在 → 恢复并前置 DSH 主窗口 → 删除控制文件 → 退出 0。
  另外监测 spawn 它的 Host 进程：Host 异常消失时也会恢复 DSH 后退出，避免孤儿悬浮窗。
- §3 ciProbe：见上。
- 自由悬浮：payload 无 `follow` 时不轮询跟随，可拖动/缩放；Alt+F4 会走「恢复 DSH 后退出」。
- 多显示器：`PER_MONITOR_AWARE_V2` + 物理像素坐标，支持负坐标屏幕；`WM_DPICHANGED` 时按系统建议矩形重排。

## 交互速查

- **拖动窗口**：按住顶部 22px 条。
- **缩放窗口**：拖动左右/底部 8px 边缘（缩放手柄由 `WM_NCHITTEST` 提供；顶部 22px 保留给拖动）。
- **退出摸鱼**：顶部条右侧「✕」，或右键菜单「退出摸鱼」；网页里的「退出摸鱼」按钮会把编辑器状态
  先交给 Host（`float.saveExitState` → `float.stop`），效果相同且能带回状态。
- **重置窗口**：顶部条右键菜单「重置窗口位置和大小」。

## 日志与数据

- 日志：`%TEMP%\gufa-float-debug.log`（UTF-8，单文件超过 4MB 下次启动会清空）。
  排查 failed/blank 时优先看它：会记录 payload 概要（**不记录 authUrl token 和 cookie 值**）、
  WebView2 环境/控制器创建、导航完成、follow 命中矩形、隐藏/恢复窗口数量、ciProbe 结果等。
- WebView2 用户数据：`%LOCALAPPDATA%\gufa-float\webview2-<build>`（按插件版本分目录；
  版本变化时相当于换新 profile，避免旧前端缓存；`<build>` 来自 payload.build）。
  首次创建失败会自动用 `%LOCALAPPDATA%\gufa-float\webview2-retry-<pid>-<tick>` 再试一次。
- 自由悬浮窗口位置：`%LOCALAPPDATA%\gufa-float\frame.ini`。

## 已知限制 / TODO

1. **透明窗口：已实现（DirectComposition），失败自动回退不透明**。
   用 `WS_EX_NOREDIRECTIONBITMAP` 窗口 + `DCompositionCreateDevice2(nullptr)`（默认渲染设备，无需 d3d11）
   + `IDCompositionTarget/Visual` + `ICoreWebView2Environment3::CreateCoreWebView2CompositionController`
   + `ICoreWebView2Controller2::put_DefaultBackgroundColor({A:0})`，页面 CSS rgba 背景即可透出下层 App；
   鼠标输入手动转发（`SendMouseInput`、capture/leave/cursor），键盘由 WebView2 焦点处理（窗口激活时 `MoveFocus`）。
   dcomp/目标/visual/Environment3/CompositionController/put_RootVisualTarget/12s 看门狗任一步失败 →
   按原 rect 重建 windowed 窗口继续（日志 `transparent-mode=fallback reason=...`）。
   `payload.opaque=true` 可强制 windowed 调试。CI 已断言 `transparent-mode=composition` + `WS_EX_NOREDIRECTIONBITMAP`。
   真机还需确认：视觉透明观感、键盘输入、较高缩放比下 follow 与输入命中。
2. **Windows 虚拟桌面**：没有稳定公开 API，切换虚拟桌面时悬浮窗可能留在原桌面；
   只保证「当前桌面可用」（协议 §2.7 要求写明的平台限制）。
3. **窗口无系统阴影/圆角**（`WM_NCCALCSIZE` 去掉了非客户区）；不影响功能，后续可用 DWM 相关 API 美化。
4. **`payload.alpha` 未用于原生窗口**：透明度按协议「优先由网页 CSS 决定」；
   页面自己会通过 `float.getPrefs`/`--gufa-float-alpha` 读取偏好（composition 下 CSS rgba 直接作用于合成结果）。
5. **helper 不提供 `--list-windows`**：Windows 的摸鱼窗口列表由 Host 侧用 PowerShell 实现
   （`host/dev.js` 的 `listFloatWindowsWin`，协议 §5.1「列表 Host 侧实现」）。
6. **缓存策略**：按 payload.build 分 WebView2 profile 目录，未实现 macOS 那样的「同版本只清内存缓存」；
   旧版本 profile 目录暂不自动删除（体积有限，后续可清理）。
7. **截图/录屏/输入法/高对比度主题**等桌面集成细节未专门处理；WebView2 使用系统输入法。
8. **本机（macOS）无法编译**：交付前已逐行核对 WebView2 SDK 1.0.2903.40 的头文件签名与 Win32 API，
   但首次 CI/真机构建仍可能暴露编译警告或平台差异，见「排障」。

## 排障

- **CI 构建失败**：先看 `Fetch WebView2 SDK (NuGet)` 是否成功、`WEBVIEW2_SDK_DIR` 是否指向解压根目录；
  CMake configure 阶段的 `FATAL_ERROR` 会明确说明缺哪个文件。
- **链接报 `CreateCoreWebView2EnvironmentWithOptions` 未解析**：说明没链上 `WebView2LoaderStatic.lib`
  （CMake 会打印实际使用的库路径，检查架构是否 x64）。
- **运行弹「无法启动 WebView2」**：安装 WebView2 Runtime（Windows 10/11 通常自带），或检查
  `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` 是否存在。
- **悬浮窗出现但页面空白**：看 `%TEMP%\gufa-float-debug.log` 里 `webview2-*`、`navigation-completed`、
  `page-probe` 记录；`page-probe` 会给出 href/title/localStorage 标记。
- **退出后主窗口没回来**：正常路径会恢复；若 helper 被强杀，Host 侧 `killFloat()` 有 PowerShell 兜底恢复。
  为减少该情况，helper 自身还有 ① controlPath 优雅退出、② Host 进程消失自动退出、③ 崩溃过滤器恢复三层兜底。

## 真机验收建议（对照协议 §5）

1. 主窗口点「摸鱼」→ 列表选一个 App → 悬浮层出现、位置尺寸与目标窗口一致、DSH 主窗口隐藏；
2. 移动/缩放目标 App → 悬浮层 250ms 内跟随；切到目标 App 全屏 → 悬浮层跟随；
3. 点悬浮层标题栏（网页内）「退出摸鱼」或顶部条「✕」→ DSH 主窗口恢复并前置、helper 退出；
4. 自由悬浮模式可拖动/缩放，重启后窗口大小位置保留；
5. 退出后任务管理器 / `tasklist | findstr gufa-float` 无残留进程。

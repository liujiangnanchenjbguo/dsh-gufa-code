# 悬浮层 helper 跨平台协议（Windows / Linux / macOS 共用）

所有平台的 helper 都是**独立进程**，由 `host/dev.js` 的 `float.*` API 用 `spawn(binary, [payloadJson])`
启动；helper 与 Host 之间只通过 **argv 里的一个 JSON** 和 **controlPath 控制文件** 通信。
macOS 实现见 `desktop/float/GufaFloat.m`（已可用，可作为行为参考）。

## 1. argv[1] 的 JSON（全部由 Host 传入）

```jsonc
{
  "appUrl": "http://127.0.0.1:PORT/",        // DSH Web GUI（http origin）
  "authUrl": "http://127.0.0.1:PORT/?token=xxx", // 一次性 token 登录 URL（cookie 分支没有时使用）
  "cookie": "dsh-auth-xxx=v1.xxx",          // 可选：直接注入的鉴权 cookie（Host 已经算好）
  "follow": { "pid": 1234, "title": "" },   // 可选；没有该字段 = 自由悬浮（不吸附）
  "state": {                                // 可选：主窗口编辑器状态快照
    "projectRoot": "/path", "activePath": "a/b.js",
    "tabs": ["a/b.js"], "ui": {}, "sessionId": ""
  },
  "alpha": 55,                              // 可选：初始透明度（20-100）
  "controlPath": "/tmp/gufa-float-exit-xxx",// 退出控制文件（Host 退出时写它）
  "build": "1.3.x",                         // 插件版本（缓存判断用）
  "ciProbe": true,                          // 可选：CI 冒烟模式
  "selftest": "js code"                     // 可选：开发自测脚本
}
```

## 2. 必须实现的行为

### 2.1 启动

1. 解析 argv[1] JSON；解析失败直接退出码 2。
2. 创建 **无边框、置顶、可缩放** 的窗口，内嵌 webview（Windows: WebView2；Linux: GTK3 + WebKit2GTK；
   macOS: WKWebView）。窗口默认位置/大小可居中，并保存/恢复大小（可选）。
3. **鉴权**：
   - 若 `cookie` 存在：先注入 cookie 再导航到 `appUrl + "?gufa-float=1"`；
   - 否则：先加载 `authUrl`，等登录跳转完成后导航到 `appUrl + "?gufa-float=1"`。
4. **注入启动脚本（document start，main frame）**，内容等价于：

```js
try {
  localStorage.setItem('gufa-code:float', '1');
  localStorage.setItem('gufa-code:float-state', '<state 的 JSON 字符串>');
  if (state.projectRoot) localStorage.setItem('gufa-code:project', JSON.stringify(state.projectRoot));
  if (state.ui) localStorage.setItem('gufa-code:ui:v1', JSON.stringify(state.ui));
} catch (e) {}
```

   Windows: `ICoreWebView2::AddScriptToExecuteOnDocumentCreated`；
   Linux: `webkit_user_content_manager_add_script(..., WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, ...)`。
5. 启动后 **0.45s** 隐藏 DSH 主窗口（见 2.3）。

### 2.2 吸附（有 follow 时）

- 每 **250ms** 轮询目标窗口位置/大小（按 pid 找该进程最大/最前的主窗口）；
- 把自己的窗口移动到目标窗口的位置和大小（高 DPI 下注意换算成物理像素）；
- 目标窗口最小化/消失时保持最后位置，不要崩；
- 窗口置顶且不抢输入焦点；吸附时把被跟随 App 前置（Windows: SetForegroundWindow；Linux: _NET_ACTIVE_WINDOW）。

### 2.3 隐藏/恢复 DSH 主窗口

- 目标：进入摸鱼时隐藏 DSH 主窗口（等价 ⌘H），退出时恢复并前置。
- Windows：`EnumWindows` 找标题包含 `DeepSeek Harness`（或属于已给的 `ownerPid`）的可见窗口 → `ShowWindow(hwnd, SW_HIDE)`；
  退出时 `ShowWindow(hwnd, SW_SHOW)` + `SetForegroundWindow(hwnd)`。
- Linux（X11）：找 `_NET_WM_PID` 对应的 DSH 主窗口 → `XUnmapWindow` 隐藏；
  退出时 `XMapWindow` + 发送 `_NET_ACTIVE_WINDOW` ClientMessage 前置。
- macOS 已有实现（AX `AXHidden`），新平台不要改 macOS 代码。

### 2.4 顶部拖动条

窗口最顶部 **22px 高** 是拖动条：按住可拖动窗口（无边框窗口必须自己实现拖动）。

### 2.5 控制文件退出（Host 的唯一退出通道）

- 每 **300ms** 检查 `controlPath` 是否存在；
- 存在时：**先把 DSH 主窗口恢复显示并前置**，删除该文件，然后退出进程（exit code 0）；
- 退出前若有子进程/对象，正常释放。
- Host 端 `float.stop` 会写这个文件并等待进程退出；超时才强杀。

### 2.6 透明度

- 窗口整体半透明（能透出下面的 App），透明度值由网页 CSS 控制（页面内部自己处理），
  原生窗口只需保证 **窗口背景是透明的**：
  - Linux：使用 RGBA visual（`gtk_widget_set_app_paintable` + `gdk_screen_get_rgba_visual`），
    在支持 composite 的桌面上即可透出下层窗口；Wayland 不支持全局窗口跟随（见 2.7）。
  - Windows：建议使用 **DirectComposition + WebView2 CompositionController + WS_EX_NOREDIRECTIONBITMAP** 实现透明；
    若首版实现成本过高，可先做 **不透明窗口**（功能可用，透明度作为后续项），但必须在 README/TODO 里写明。
- 若 payload 有 `alpha`，可以作为原生窗口整体 alpha 的初始值参考（优先由网页 CSS 决定）。

### 2.7 平台限制（必须在 README 里写明）

- Windows：虚拟桌面（Virtual Desktop）没有稳定公开 API，切换虚拟桌面时悬浮窗可能留在原桌面；
  仅保证“当前桌面可用”。
- Linux：**仅支持 X11**；Wayland 下无法全局读取其他窗口位置，只能降级为“自由悬浮 / 不跟随”，
  需要检测 `WAYLAND_DISPLAY` 并给出明确提示。
- 多显示器：按目标窗口所在屏幕坐标换算；Windows 需处理 `WM_DPICHANGED` 和多屏负坐标。

## 3. CI 冒烟模式（`ciProbe: true`）

CI 没有真实桌面交互，要求 helper 支持：
- 创建环境、加载页面；
- 等页面加载完成（或 8s 超时）；
- 在 stdout 打印一行 JSON：`{"ok":true,"platform":"win32|linux","urlLoaded":true}`；
- 然后恢复 DSH 窗口（若有）、退出码 0。
CI 用这个验证“能启动 + 能加载 webview”，不验证窗口外观。

## 4. 二进制与构建产物约定

- Windows 产物：`desktop/float/bin/win-x64/gufa-float-win.exe`
- Linux 产物：`desktop/float/bin/linux-x64/gufa-float-linux`
- macOS 产物保持现状：`desktop/float/bin/gufa-float-macos-*` + `.app`。
- 构建脚本放在各自目录（`desktop/float/win/CMakeLists.txt`、`desktop/float/linux/Makefile`），
  由 `.github/workflows/build-float.yml` 在各平台 runner 上构建并把产物上传 artifact。

## 5. 验收清单（真机）

1. 主窗口点「摸鱼」→ 列表能列出 App（Host 侧实现）→ 选中后悬浮窗出现在目标 App 上并吸附；
2. DSH 主窗口隐藏；目标 App 移动/缩放时悬浮窗跟随；
3. 悬浮层标题栏「退出摸鱼」→ 主窗口恢复、状态带回来、helper 进程退出、无残留；
4. 自由悬浮模式可拖动/缩放；
5. 退出后 `ps` 无残留进程。

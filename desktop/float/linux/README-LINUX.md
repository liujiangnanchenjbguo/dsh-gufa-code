# 古法编程 · Linux 悬浮层 helper（X11 + GTK3 + WebKit2GTK）

DSH「摸鱼」模式的 Linux 端独立 helper。由 Host（`host/dev.js` 的 `float.*`）以
`spawn(gufa-float-linux, [payloadJson])` 启动，和 Host 之间只通过 **argv 里的一个 JSON**
和 **controlPath 控制文件** 通信 —— 协议见 [`../PLATFORM-PROTOCOL.md`](../PLATFORM-PROTOCOL.md)，
行为参考 macOS 实现 [`../GufaFloat.m`](../GufaFloat.m)。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `main.c` | 入口 / payload 解析 / GTK 窗口 / WebKit 加载与鉴权 / 注入脚本 / follow / 控制文件 / ciProbe |
| `json.c` `json.h` | 无第三方依赖的极简 JSON 解析与序列化（payload、`state` 注入、`--list-windows` 输出） |
| `x11.c` `x11.h` | Xlib：按 pid 找窗口、取 root 坐标、隐藏/恢复 DSH 主窗口、`_NET_ACTIVE_WINDOW`、`--list-windows` 枚举 |
| `log.c` `log.h` | 诊断日志（stderr + `/tmp/gufa-float-debug.log`） |
| `Makefile` | pkg-config 探测 `webkit2gtk-4.1`/`4.0` 并构建 `gufa-float-linux` |
| `README-LINUX.md` | 本文件 |

不修改 Host、macOS 代码与 CI；Host 侧无需为本 helper 做额外适配（除把二进制放进
`desktop/float/bin/linux-x64/gufa-float-linux`）。

## 依赖

Ubuntu / Debian：

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
# 特别老的发行版只有 4.0：libwebkit2gtk-4.0-dev（Makefile 会自动退回）
# 可选：xvfb（本地无桌面冒烟）、wmctrl/xdotool（Host 的窗口列表/兜底前置命令要用）
```

运行时依赖（装 dev 包时已带上）：`libgtk-3-0`、`libwebkit2gtk-4.1-0`、`libsoup-3.0-0`、X11 桌面。

## 构建

```bash
cd desktop/float/linux
make -j"$(nproc)"          # 产物 ./gufa-float-linux
make smoke                 # 可选：xvfb-run 下跑 ciProbe 冒烟（需要 xvfb）
```

构建日志会打印实际使用的 WebKit 包名，例如 `已生成 gufa-float-linux（WebKit2GTK: webkit2gtk-4.1，libsoup: libsoup-3.0）`。

发布产物应放到（CI 由 `.github/workflows/build-float.yml` 的 linux job 完成）：

```
desktop/float/bin/linux-x64/gufa-float-linux
```

Host 的 `floatBinaryPath()` 会按 `linux-x64/gufa-float-linux` → `linux-x64/gufa-float-linux-x64`
→ `gufa-float-linux` 的顺序找二进制。

Host 侧不需要为 helper 做额外适配：payload 里的 `appUrl` / `authUrl` / `follow` / `state` / `alpha` / `build` /
`ownerPid` / `controlPath` 都按协议消费；可选 `cookie` 存在时走 cookie 直注分支，否则走 authUrl token 分支。

## 直接运行 / 调试

```bash
# 自由悬浮（payload 由 Host 生成，这里只列关键字段）
./gufa-float-linux '{"appUrl":"http://127.0.0.1:PORT/","authUrl":"http://127.0.0.1:PORT/?token=xxx","ownerPid":1234,"controlPath":"/tmp/gufa-float-exit-xxx","build":"1.3.x"}'

# 吸附某个 App（pid 来自 Host 的窗口列表；title 可空）
./gufa-float-linux '{"appUrl":"...","authUrl":"...","follow":{"pid":4242,"title":""},"controlPath":"/tmp/gufa-float-exit-xxx"}'

# CI 冒烟：加载完成/失败后 stdout 打一行 JSON 并退出 0
xvfb-run -a ./gufa-float-linux '{"appUrl":"http://127.0.0.1:1/","authUrl":"http://127.0.0.1:1/","ciProbe":true}'

# 窗口列表（Host 目前用 wmctrl，这个模式是给真机排查用的）
./gufa-float-linux --list-windows --out /tmp/win.json
./gufa-float-linux --version
```

诊断日志：`/tmp/gufa-float-debug.log`（可用环境变量 `GUFA_FLOAT_DEBUG_LOG=/path` 覆盖）。
日志里包含 payload 摘要、窗口几何、follow 找到/应用目标窗口、DSH 隐藏/恢复、页面 `page-probe`（href/title/localStorage）等，真机验收时直接取该文件排查。

白屏/黑屏时（无 GPU 的虚拟机、远程桌面）可手动加：

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 ./gufa-float-linux '<payload>'
```

（`ciProbe` 模式下这些变量会由 helper 自动设置，真机默认不动。）

## 协议实现清单（对照 PLATFORM-PROTOCOL.md）

### 2.1 启动
- [x] 解析 `argv[1]` JSON；失败/缺 `appUrl` **退出码 2**（不弹 GUI 错误框）。
- [x] 无边框（`gtk_window_set_decorated(FALSE)`）、置顶（`gtk_window_set_keep_above` + `GDK_WINDOW_TYPE_HINT_UTILITY`）、
      可缩放（`gtk_window_set_resizable(TRUE)` + 右下角 18×18 拖拽手柄 → `gtk_window_begin_resize_drag`）。
- [x] 默认居中原主显示器，大小 1180×820（不超过屏幕 86%），并保存/恢复最近一次窗口几何到
      `$XDG_CONFIG_HOME/gufa-float/linux-frame.txt`（自由悬浮/下次启动使用；follow 模式下由目标窗口接管）。
- [x] 鉴权两条路径：
      - `cookie` 存在：`soup_cookie_new(name, value, <appUrl host>, "/", 86400)` →
        `webkit_cookie_manager_add_cookie()` → 完成后导航 `appUrl?gufa-float=1`；
      - 否则：先 `load authUrl`（一次性 token URL），`LOAD_FINISHED` 后再导航 `appUrl?gufa-float=1`。
      - cookie 注入失败 / 格式非法时自动回退 authUrl。
- [x] document-start 注入（`webkit_user_script_new(..., WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, ...)`
      + `webkit_user_content_manager_add_script`），main frame，内容等价于协议 2.1-4：
      `gufa-code:float='1'`、`gufa-code:float-state=<state JSON>`、`gufa-code:project`、`gufa-code:ui:v1`（全部包在 try/catch）。
- [x] 启动后 **0.45s** 触发隐藏 DSH 主窗口（`g_timeout_add(450, ...)`）。

### 2.2 吸附（有 follow 时）
- [x] 每 **250ms** `g_timeout_add` 轮询（GTK 主线程内，无自建线程）：
      `XQueryTree` 递归找 `_NET_WM_PID == follow.pid` 的可见普通窗口（NORMAL/DIALOG 或无类型），
      取面积最大者；`title` 非空时优先标题包含匹配。
- [x] `XGetWindowAttributes` + `XTranslateCoordinates(win → root)` 得到目标窗口的绝对矩形；
      `gtk_window_move` + `gtk_window_resize` 跟随（按 GDK `gtk_widget_get_scale_factor` 做 HiDPI 逻辑/物理像素换算）。
- [x] 目标窗口最小化/消失：保持最后位置、继续重试，不崩（BadWindow 由 Xlib 错误处理器吞掉）；缓存窗口失效后自动重找。
- [x] 找到目标窗口时发送 `_NET_ACTIVE_WINDOW`（source indication = 2 / pager）+ `XRaiseWindow` 把被跟随 App 前置。
- [x] 用目标的 `_NET_WM_DESKTOP` 同步自己窗口的工作区（best-effort）。

### 2.3 隐藏/恢复 DSH 主窗口（X11）
- [x] 隐藏：优先 `_NET_WM_PID == ownerPid`（Host payload 已带 `ownerPid`）；对不上时按标题/WM_CLASS 启发式
      （`deepseek harness` / `deepseek` 等）兜底；命中窗口 `XUnmapWindow`，最多 16 个。
- [x] 恢复：退出前 `XMapWindow` + `XRaiseWindow` + `_NET_ACTIVE_WINDOW`（带 GDK server timestamp 提高 WM 接受率），
      再 `XSync` 确保请求已处理；controlPath 退出、SIGTERM/SIGINT、菜单退出、窗口关闭都会走同一恢复路径。
- [x] 非 X11（Wayland 后端）时明确跳过并写日志，不会误操作其它窗口。

### 2.4 顶部拖动条
- [x] 最顶部 **22px** `GtkEventBox`（半透明黑底 + 提示文字），左键按住 →
      `gtk_window_begin_move_drag()`（交给 WM 的 `_NET_WM_MOVERESIZE`）；右键弹菜单
      （退出摸鱼 / 重置窗口位置）。
- [x] 右下角 18×18 缩放手柄（`gtk_window_begin_resize_drag(GDK_WINDOW_EDGE_SOUTH_EAST)`），补足无边框窗口的缩放。

### 2.5 控制文件退出
- [x] 每 **300ms** 检查 `controlPath` 是否存在；存在 →
      先恢复 DSH 主窗口并前置 → 删除该文件 → `gtk_main_quit()`，**退出码 0**。
- [x] 同时注册 SIGTERM/SIGINT 优雅退出（Host 6s 超时强杀前的兜底），退出前同样恢复主窗口。
- [x] **Host 存活看门狗**：detached spawn 的 helper 每 300ms 检查 `getppid()` 是否变化（Host 退出后会被 init/reaper 收养），
      变化即恢复 DSH 主窗口并退出，避免 Host 崩溃后留下「主窗口被隐藏 + 悬浮窗残留」。
- [x] 退出时释放 GTK/WebKit/X11 对象，`ps` 无残留（进程正常退出）。

### 2.6 透明度
- [x] `gtk_widget_set_app_paintable(TRUE)` + `gdk_screen_get_rgba_visual()` + `gtk_widget_set_visual()`，
      `draw` 里清成透明，`webkit_web_view_set_background_color(0,0,0,0)`；页面内部 CSS 决定实际半透明观感（与 macOS 一致）。
- [x] 没有合成器 / 无 RGBA visual 时降级为不透明窗口（日志说明），页面功能不受影响。
- [x] payload 的 `alpha` 只记录日志（与 macOS 一样不做原生窗口整体 alpha，避免和网页 CSS 叠成两次半透明）。

### 2.7 平台限制（Wayland）
- [x] 检测 `WAYLAND_DISPLAY`：
      - 若同时有 `DISPLAY`（XWayland）：自动 `GDK_BACKEND=x11`，日志说明「已切到 X11/XWayland，仅 X11 应用可被跟随/隐藏」；
      - 只有 Wayland：明确提示「仅支持 X11」，follow 与隐藏/恢复主窗口直接降级为不可用，窗口仍是自由悬浮；
      - 用户显式 `GDK_BACKEND=wayland` 时尊重用户设置并降级。
      - 纯 Wayland 后端下窗口位置/大小由合成器决定（`gtk_window_move` 被忽略、拖动条可能无效），只保证窗口能打开网页。
- [x] stderr/日志里的提示文案含「仅支持 X11」。

### 3. CI 冒烟（ciProbe）
- [x] 创建窗口 + WebKit 环境并加载页面；页面 `LOAD_FINISHED` 或 `load-failed`/8s 超时后，
      stdout 打一行 JSON：`{"ok":true,"platform":"linux","urlLoaded":true|false}`，随后恢复主窗口（若有）并 **退出码 0**。
      `urlLoaded` 如实反映是否加载成功（CI 用 `http://127.0.0.1:1/` 时会是 false，但启动/webview 初始化成功仍算冒烟通过）。
- [x] ciProbe 模式不隐藏 DSH 主窗口、不保存窗口几何，且自动设置软件渲染环境变量（见上文）。

## CI 构建注意事项

- 当前 workflow 的 Linux job 是 `ubuntu-24.04`，apt 安装：
  `build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev xvfb wmctrl xdotool`。
  （Ubuntu 22.04 同样可用：把 `libwebkit2gtk-4.1-dev` 装上即可，Makefile 也兼容只有 4.0 dev 的老发行版。）
- `make -j"$(nproc)"` 在 `desktop/float/linux` 下执行；Makefile 用 pkg-config 探测
  `webkit2gtk-4.1`，没有时退回 `webkit2gtk-4.0`（分别对应 libsoup-3.0 / libsoup-2.4）。
- 产物名固定 `gufa-float-linux`；workflow 会复制到 `desktop/float/bin/linux-x64/` 并上传 artifact。
- 冒烟命令：`timeout 40 xvfb-run -a <binary> '{"appUrl":"http://127.0.0.1:1/","authUrl":"http://127.0.0.1:1/","ciProbe":true}'`。
  Xvfb 下没有合成器，窗口不透明但不影响 ciProbe；WebKit 需要的软件渲染兜底已由 helper 在 ciProbe 模式自动设置。
- 若 CI 想验证「真能加载页面」，把 payload 换成 Host 实际地址或本地静态 HTTP 服务即可（`urlLoaded` 会变 true）。
- WebKit2GTK 4.1 会在 Ubuntu 小版本里持续升级（jammy 2.36 → 2.50，noble 2.52），
  代码只用了 2.36 起就存在的稳定 API（`webkit_cookie_manager_add_cookie`、`webkit_web_view_run_javascript` 等），
  并已分别用 Ubuntu 22.04 的 2.50.4 与 24.04 的 2.52.6 头文件做过交叉语法校验（`-Werror`，含 GTK3/libX11）。
- 若 CI 的 WebKitGTK 在 Xvfb 下白屏，helper 在 `ciProbe` 模式已自动设置软件渲染环境变量；
  真机遇到白屏可按上文「直接运行 / 调试」里的 env 手动启动。

## 已知风险 / 未实现项

- **Wayland 原生窗口不可跟随/隐藏**：这是协议 2.7 明确的平台限制。XWayland 下 Electron/Chrome 等 X11 客户端可正常吸附；
  纯 Wayland 应用（如 GNOME 原生应用）`_NET_WM_PID` 窗口在 XWayland 根窗口里不可见，只能自由悬浮。
  纯 Wayland 后端下客户端无法自行定位窗口，拖动条/位置跟随也一并失效（合成器决定位置）。
- **HiDPI 混合缩放**：按 GDK 全局 scale factor 换算；同一桌面多显示器不同缩放（X11 本身很难表达）未验证。
- **工作区切换**：`_NET_WM_DESKTOP` 同步是 best-effort，部分 WM（如 GNOME/mutter）在窗口已映射后不理会属性修改；
  用户手动切工作区时悬浮窗可能留在原工作区。协议只要求「目标窗口移动/缩放时跟随」。
- **无合成器桌面**：窗口不透明（黑/白底取决于网页），这是 X11 的固有限制；GNOME/KDE/XFCE 默认带合成器。
- **透明观感依赖网页 CSS**：原生层只保证「窗口背景透明」；如果 DSH 前端摸鱼模式的透明样式变更，外观会随之变化（与 macOS 同一套前端逻辑）。
- **原生菜单退出**：用户从悬浮条右键菜单「退出摸鱼」时，helper 会恢复主窗口并退出，但不会经过 Host 的
  `float.saveExitState`（状态快照/插件状态同步只在网页内「退出摸鱼」按钮走 Host API 时发生）。网页内退出按钮是主路径。
- **cookie 分支**：Host 目前（macOS）走 authUrl token 分支；Linux helper 已实现 cookie 直注，等 Host 传入 `cookie` 字段即可生效。
- **`--list-windows`**：Host 的 Linux 窗口列表当前用 `wmctrl -lp` 实现（需要用户装 wmctrl）；helper 自带的列表模式是给真机排查/后续切换用的，格式与 macOS 一致。
- 未实现 macOS 的点击穿透、全局热键、Space 锁定等辅助功能（协议未要求 Linux 版实现）。
- **全屏 App 的置顶层级**：`_NET_WM_STATE_ABOVE` 由 WM 决定层级，部分 WM 会把全屏窗口放在 above 层之上，
  此时悬浮窗可能被全屏 App 盖住（协议 2.2 只要求普通窗口场景）。macOS 用 status window level 规避，X11 没有等价标准 API。
- **`ownerPid` 依赖 Host**：当前 Host 传的是 `process.ppid`，不一定是 DSH 主窗口的 `_NET_WM_PID`，
  所以 helper 用「pid 精确匹配 → 标题/WM_CLASS 启发式」两级查找；如果 Host 以后能传 DSH Electron 主进程的 PID，隐藏/恢复会更稳。
- **Host 侧构建脚本**：Host 提示文案里的 `./scripts/build-float-linux.sh` 不在本目录范围内（由 CI/发布流程负责）；
  `.github/workflows/build-float.yml` 已直接 `make` 并把产物拷到 `bin/linux-x64/`。
- **编译验证说明**：本机是 macOS，无法运行 Linux 二进制；但已用 Ubuntu 22.04 的 WebKitGTK 2.50.4 与
  Ubuntu 24.04 的 WebKitGTK 2.52.6（+ GTK 3.24 / libsoup 3.0 / libX11）头文件做
  `clang --target=x86_64-unknown-linux-gnu -fsyntax-only -Wall -Wextra -Werror` 交叉语法/语义校验，
  并用 `make` 走通 4.1 / 4.0 两条 pkg-config 探测路径（4.0 的 cookie API 另用 libsoup 2.4 头文件校验）。
  真正链接与运行仍需 CI 的 ubuntu runner / 真机。
- 无自动化 UI 测试：CI 只能验证「能启动 + webview 能初始化 + 优雅退出」，窗口吸附/透明需真机验收。

## 真机验收建议

1. X11 会话（或 XWayland）下启动 DSH，主窗口点「摸鱼」选一个 App；
2. 观察悬浮窗是否贴在目标 App 上，移动/缩放目标 App 是否 250ms 内跟随；
3. DSH 主窗口是否被隐藏；目标 App 在悬浮窗下方（置顶且不抢焦点）；
4. 网页内「退出摸鱼」后 DSH 主窗口是否恢复前台、`ps -ef | grep gufa-float` 是否无残留；
5. 自由悬浮模式下拖动 22px 顶栏移动、右下角手柄缩放、右键菜单「退出摸鱼」；
6. 异常时收集 `/tmp/gufa-float-debug.log`。

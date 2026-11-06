# 已知坑（踩过的，别再踩）

> 这份清单记录已经犯过、并且容易再犯的错误。加新功能前先扫一遍。

## 0. 三种模式不要串味（见 docs/MODES.md）

- 经典 / 古法编程 / 摸鱼 三态，判断只认 `html[data-gufa-ide]` 与 `html[data-gufa-float]`；
- **不要用 localStorage / 全局状态判断摸鱼模式**（曾经因此让主窗口的「入口工作区」逻辑失效）；
- 摸鱼相关逻辑一律包在 `G.isFloatMode()` 里；古法编程的功能锁见 `docs/MODES.md`。

## 1. 弹窗/菜单层级：只有一个正确做法（反复踩过多次，最终定案）

**现象**：弹窗被右侧「古法 AI」聊天栏压住、只显示一半、关闭按钮点不到；或者反过来把官方设置/会话弹窗盖住。

**根因**：古法编程界面在 `.gufa-overlay-root`（z-index:1）这个层叠上下文里；右侧停靠的官方会话根节点是 body 级
`position:fixed; z-index:2147483040`。任何渲染在 root 内部的弹窗/菜单，z-index 写多大都出不了 root 的上下文，
必然被会话盖住。

**定案（不要再发明新写法）**：

1. 所有浮层（modal / 菜单 / 列表 / 确认框）一律用 `G.portal(node)` 渲染到 `#gufa-portal-root`（body 级，官方同款 portal 机制）；
   - 新增浮层时**必须**用 `G.portal(...)` 包裹，否则一定踩坑；
   - 模块内联菜单（`50-panels.js` 的 `.gufa-menu`）已经全部 portal，坐标本来就是 client 坐标 + `position:fixed`。
2. 层级契约（见 `00-core.js` 注释，按顺序递增）：
   - `1`：`.gufa-overlay-root`（IDE 本体）
   - `2147483040`：右侧停靠会话
   - `2147483050`：桌宠
   - `2147483060`：官方 DSH 菜单/弹窗（`html[data-gufa-ide] [role=...]` 规则）
   - `2147483100`：`#gufa-portal-root`（古法所有弹窗/菜单）
   - `2147483200`：toast
3. 官方弹窗打开时（`59-dialog-layer.js` 检测 body 级 `[role=dialog][aria-modal=true]`）：
   `html[data-gufa-external-modal]` 把停靠会话降到 2、`#gufa-portal-root` 降到 1，保证官方弹窗永远在最上面。
4. **禁止**：抬高 `.gufa-overlay-root` 或它的祖先来做层级修正（历史补丁，已删除，最容易造成“弹窗层级混乱”）。

**自动化验收**：悬浮层 helper 支持 payload 里的 `selftest`（一段 JS，页面加载 5s 后在悬浮窗内执行，结果写 `/tmp/gufa-float-debug.log`）；
`G.debugOpenFloatPicker` 可在脚本里打开摸鱼列表。用它跑过一轮 DOM 命中测试（`document.elementsFromPoint` 验证弹层是否在最上层、
是否盖住右侧会话区域），比人眼截图可靠，后续改层级务必先跑一遍。

**人工验收方式**：改完浮层后，在有右侧会话、且 IDE 里有打开文件的情况下，逐一点一遍：
资源管理器右键菜单 / Git 菜单 / 摸鱼列表 / 切换会话 / 工作区切换 / 设置弹窗，确认都能完整显示、能点、能关。


### 1.1 portal 弹窗必须自带主题变量（易漏，表现为“弹窗像一层空蒙层”）

- 现象：弹窗打开后，弹窗区域只看到变暗的遮罩、面板内容是透明的，像整个屏幕盖了一层膜。
- 原因：弹窗被 portal 到 `#gufa-portal-root`（body 层），**拿不到 `.gufa-root` 上定义/内联的 `--gufa-*` 主题变量**
  （包括 60-dock 写入的固色变量），于是 `background:var(--gufa-solid-layer2, ...)` 解析失败 → 背景透明。
- 修法（已做）：
  1. `#gufa-portal-root` 在 CSS 里补一套完整的 `--gufa-*` 变量（带 `--dsw-*` 和固色回退）；
  2. `60-dock.js` 的 `applyPalette` 把 `--gufa-solid-*` 同步写入 portal host；
  3. 新增/修改弹窗时，样式尽量只依赖这套变量，不要假设能继承 `.gufa-root` 的其它属性。

## 1.2 悬浮层退出：不要依赖 SIGTERM（实测不可靠）

- 现象：`kill -TERM` 后 helper 不退出、或退出后 DSH 主窗口仍是隐藏状态（`visible=false`）。
- 原因：AppKit 进程里 `DISPATCH_SOURCE_TYPE_SIGNAL` 的 SIGTERM 源实测不触发（即使 `signal(SIG_IGN)` + 主队列正确配置）。
- 定案：Host 的 `float.stop` 用**控制文件**退出——`float.start` 时生成唯一 `controlPath` 传给 helper，
  helper 每 0.3s 轮询；Host 写文件 → helper 恢复主窗口（AXHidden=false + 激活 DSH）后自行退出。
  兜底：若 helper 被强杀，Host 用 `osascript`（System Events）把 DSH 设为 visible，并 `open -b com.deepseek.dsh`。
- 主窗口「⌘H 效果」= helper 启动 0.45s 后对 DSH 应用 `AXHidden=true`；退出时改回 false。

## 2. macOS 屏幕录制权限 + 悬浮层 helper

- helper 每次重新编译（代码签名变化）后，TCC 里旧的「屏幕录制」授权可能失效；
- `CGPreflightScreenCaptureAccess()` **不可靠**：可能返回 true，但 `CGWindowListCopyWindowInfo`
  只返回自己 App 的窗口（表现为摸鱼列表里只有 DeepSeek Harness 自己）；
- 判断权限要**看列表内容**：是否出现非 `DeepSeek Harness` 的 owner（helper 里 `GufaRowsHaveForeignWindows`）；
- 授权对象是 **DeepSeek Harness**（helper 以它作为 responsible app 继承权限）；
  授权后如果列表仍只显示自己，**重启一次 DeepSeek Harness** 再试。

## 3. Monaco worker：dsh-app:// 下不能 importScripts 相对路径

- 现象：Git diff 永远没有红绿、`getLineChanges()` 一直为空；
- 原因：页面源是 `dsh-app://`，Monaco 默认 blob worker 里 `importScripts('/gufa-code/...')` 是非法 URL；
- 修法：worker 用同源 `vendor/monaco/vs/worker-bootstrap.js` 作为入口，里面只做
  `MonacoEnvironment.baseUrl` + `importScripts(workerMain.js)`；**不要**先加载 AMD `loader.js`（模块系统冲突）。

## 4. 性能：摸鱼窗口启动/资源占用（实测与原则）

- **不要每次启动摸鱼都清空全部 Web 数据**：`WKWebsiteDataStore allWebsiteDataTypes` 会让整个 DSH 前端重新下载/编译，
  实测启动到客户端 boot 由 **~14s 降到 ~1.1s**。正确做法：把插件版本随 payload 传入（`build`），
  版本变化时清全部数据（保证客户端代码最新），同一版本只清 memory cache。
- 摸鱼窗口是一个完整的第二个 DSH Web 客户端：打开时 WebKit 内容进程 **~600–650MB**、加载后空转 CPU ≈0%（已优化）；
  关闭后进程与内存全部释放（实测 3 次开关无泄漏）。不要同时保留多个摸鱼窗口。
- 摸鱼窗口里不挂载背景粒子（`G.BackdropParticles` 直接返回 null），并关闭皮肤插件动画
  （`data-liang-skin=off` + 移除 `.liang-skin-*` 节点），否则看不见也会跑 rAF。
- 主窗口背景粒子：30fps→24fps、dpr 上限 1.5→1.25、页面隐藏/窗口失焦时暂停。
- 快捷键集成不要留常驻重试环：累加上限 40 次 + 只在签名变化时写诊断日志（曾出现 2Hz 常驻循环）。
- 退出摸鱼状态轮询 5s 一次且页面不可见时跳过（原来 3s 且无条件请求 host）。

## 5. 摸鱼窗口的 Space 固定（不要用 canJoinAllSpaces）

- 现象：摸鱼窗吸附第二屏的 App，用户在主屏滑动切 Space 时，摸鱼窗也跟着出现在当前屏。
- 原因：`NSWindowCollectionBehaviorCanJoinAllSpaces` 会让窗口出现在所有 Space。
- 定案：吸附模式 collectionBehavior = `FullScreenAuxiliary | IgnoresCycle`（raw=320）；
  自由悬浮模式才追加 `CanJoinAllSpaces`（raw=321）。停止跟随/自由悬浮时恢复跨 Space。

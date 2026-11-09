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

## 6. 摸鱼吸附全屏 App（QQ音乐等占满整屏的窗口）

- 现象：目标 App 窗口占满一整个屏（或原生全屏 Space）时，去掉 canJoinAllSpaces 后悬浮窗"没浮动过去"。
- 原因：悬浮窗创建在用户当前 Space，仅靠 setFrame 移动坐标不会把窗口带进目标 App 的 Space/全屏 Space。
- 定案：找到目标 AX 窗口并贴好 frame 后调用 `attachToFollowedSpace`：
  1) collectionBehavior 临时加 `MoveToActiveSpace` 并 `orderFrontRegardless`（此时目标 App 已激活，其 Space 即活动 Space）；
  2) 0.9s 后恢复 `FullScreenAuxiliary | IgnoresCycle`，窗口稳定留在该 Space，后续用户滑屏不会跟随。
- 验证：QQ音乐占满主屏时，悬浮窗覆盖整屏且 `own-window onscreen=1`；退出后主窗口恢复。
- 补充（真机点击复现后的最终定案）：
  1. **必须先激活目标 App、等它切完 Space（~0.9s）再创建悬浮窗**，否则窗口创建在 DSH 原来的 Space 里，
     后续 `MoveToActiveSpace` 也不生效（实测 onscreen=-1，用户看到"没浮动过去"）。
  2. QQ音乐的 AX window 不暴露 `AXWindowNumber`（返回 0），拿不到目标窗口 CGWindowID；
     此时用 SkyLight 私有 API 兜底：`SLSGetActiveSpace`（目标 App 已激活 → 活动 Space 即其 Space）+
     `SLSAddWindowsToSpaces` 把自己的窗口加进去（实测 `use-active-space=8234 err=0`）。
  3. 私有 API 全部 dlsym，符号缺失时只记日志不影响主流程。

## 摸鱼窗口里的两个系统性问题（1.3.57 修复）

1. **摸鱼窗口是独立 http origin，DSH 主题默认是浅色**：主窗口（dsh-app://）的深色主题在悬浮窗里不存在，
   导致 IDE 面板/弹窗呈现浅色：深色半透明底 + 浅色文字/弹窗，字看不清。
   - 修复：`G.resolveSolidPalette` 在 `html[data-gufa-float]` 下强制返回深色实色板；
     `html[data-gufa-float] body` 与 `#gufa-portal-root` 强制深色 `--dsw-alias-*` token；
     App 在摸鱼模式把 `theme` 固定为 `dark`（Monaco/终端）。
   - 注意：portal/弹窗在 body 层，CSS 变量要用 `!important`，因为 `applyPalette` 会往 portal 上写 inline 变量。
2. **无边框 NSWindow 默认 `canBecomeKeyWindow=NO`**：悬浮窗收不到键盘事件，终端/编辑器/聊天都输入不了。
   - 修复：`GufaFloatWindow` 子类覆写 `canBecomeKeyWindow/canBecomeMainWindow` 返回 YES。
   - 排查要点：`float-hittest` 日志会打印 elementFromPoint 与临时 `.gufa-modal` 的计算样式（bg/color），
     `float-styles` 打印覆盖层透明度；终端输入问题优先看窗口是否 key，而不是 transport。

## 资源管理器外部文件变化（1.3.59 修复）

问题：在 Finder/终端里新建/删除文件后切回古法编程，资源管理器不显示；点右上角刷新也只刷新根目录，
展开的子目录里新建的文件仍然看不到。

原因：刷新按钮只调用 `loadDir('')`（根目录），没有刷新已经展开/加载过的子目录；
切换回窗口时也不会自动刷新。

修复：
- 刷新按钮改为 `refreshAll()`：重读「根目录 + 所有已加载目录」；
- 窗口 `focus` / `visibilitychange`（可见）时防抖 180ms 自动 `refreshAll()`，从 Finder 切回来无需手动刷新。

## 摸鱼窗口里复制/粘贴失效（1.3.60 修复）

macOS 上 WKWebView 的「复制/粘贴/剪切」是**通过 App 主菜单的 key equivalent** 转成 `copy:/paste:/cut:` 再走 responder chain 的。
悬浮层是独立进程、没有主菜单，所以 Cmd+C/V 在编辑器、输入框里全部失效。

修复：helper 安装 `NSApp.mainMenu`，只添加「编辑 → 剪切/复制/粘贴」三项（Cmd+X/C/V）。
**不要**把 Cmd+Z / Cmd+A / Cmd+F 加进菜单：Monaco 自己处理这些快捷键，菜单会拦截并走 WebView 原生选择/撤销，行为反而错乱。

验证：悬浮层聊天输入框 Cmd+V → 粘贴成功，Cmd+A+C 后 `pbpaste` 内容正确；
编辑器（.gitignore）里 Cmd+V 插入成功并自动保存，Cmd+A+C 后 `pbpaste` 为整个文件文本。

## AI 改代码后 Git/资源管理器标识不刷新（1.3.61 修复）

问题：AI（或任何外部进程）改了文件后，Git 面板和资源管理器的修改标识要手动点一下 Git 按钮才出现。
原因：之前只在「本插件自己的操作」（保存、新建、删除、切换面板）后刷新 git 状态；
AI 是通过 Host 工具直接写盘，客户端收不到任何通知。

修复：窗口可见时每 3.5s 轮询一次 `git.status`，计算「分支 + changes 路径/状态」签名，
签名变化就自动刷新 Git 面板和资源管理器；非 Git 项目每 6s 静默重读已加载目录。
窗口 focus / visibilitychange 时也会立即刷新一次。

## 5.1 摸鱼会话框比编辑器黑：官方会话根节点自己又画了一层底

- 现象：摸鱼里编辑器/终端都统一了，右侧会话框看起来明显更黑更实。
- 实测（同屏同底层对比法）：编辑器有效 alpha=0.570，会话框=0.878 → 会话框多叠了一层 ~0.72 的暗底。
- 根因：官方会话根节点（被 60-dock 停靠的 `div.kiGsTW_root`）带 `[data-gufa-dock]` 且自带 `background`（旧规则
  `html[data-gufa-float] [data-gufa-dock]{background:rgba(13,15,19,var(--gufa-float-alpha))!important}` 在样式表**后面**，
  覆盖了前面的 transparent 规则）。
- 定案：该规则改为 `background:transparent!important` + `--dsw-alias-bg-*` 全 transparent；
  摸鱼整窗只允许 `.gufa-overlay-root` 一层底色。验证：`float-painters` 只剩 overlay-root 一个绘制者，实测会话框 alpha=0.570。

## 5. 摸鱼窗口的 Space 固定（不要用 canJoinAllSpaces）

- 现象：摸鱼窗吸附第二屏的 App，用户在主屏滑动切 Space 时，摸鱼窗也跟着出现在当前屏。
- 原因：`NSWindowCollectionBehaviorCanJoinAllSpaces` 会让窗口出现在所有 Space。
- 定案：吸附模式 collectionBehavior = `FullScreenAuxiliary | IgnoresCycle`（raw=320）；
  自由悬浮模式才追加 `CanJoinAllSpaces`（raw=321）。停止跟随/自由悬浮时恢复跨 Space。

# 已知坑（踩过的，别再踩）

> 这份清单记录已经犯过、并且容易再犯的错误。加新功能前先扫一遍。

## 1. 古法编程里的浮层会被右侧停靠会话盖住（反复踩）

**现象**：弹窗/菜单只显示一半；关闭按钮点不到；列表被右侧「古法 AI」聊天栏压住；点击穿透的弹窗挡在聊天栏下面。

**原因**：
- 古法编程的所有界面都在 `.gufa-overlay-root` 里，它是 `z-index:1` 的层叠上下文；
- 右侧停靠的官方会话根节点是 **body 级** `position:fixed; z-index:2147483040`；
- 所以 root 内弹窗自己的 `z-index` 写多大都没用，出不了 root 的层叠上下文，必然被会话盖住。

**正确做法（三选一）**：
1. 古法自己的弹窗/菜单：打开时把 root 抬起来 —— 现有 `59-popup-layer.js` 会自动检测 root 内出现的
   `[role=menu] / [role=dialog] / [role=listbox] / .gufa-modal / .gufa-float-backdrop` 等，
   给 `<html>` 加 `data-gufa-popup`，CSS 把 `.gufa-overlay-root` 抬到 `z-index:2147483300`；
   新增全屏浮层时**必须**把它的类名加进 `59-popup-layer.js` 的 SELECTOR。
2. 外部（DSH 官方）弹窗：`59-dialog-layer.js` 检测 body 级 `[role="dialog"][aria-modal="true"]`，
   加 `data-gufa-external-modal`，CSS 把停靠会话降到 `z-index:2`。
3. 任何新浮层提交前：**在有右侧会话打开的情况下**实测它是否完整可见、可关闭。

**禁止**：只在浮层自身上写一个很高的 `z-index` 就交付。

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

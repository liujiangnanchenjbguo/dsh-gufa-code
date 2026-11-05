# dsh-gufa-code「古法编程」插件设计契约（内部）

这是一个 DSH Web 客户端插件（bundle）。目标：在 DSH Web GUI 左侧侧边栏加一个「古法」图标，
点击后进入 Cursor 风格的 IDE：

> **右侧 AI = 官方 DSH 会话本体（停靠复用）**
> IDE 以 `shell.overlay` 全屏覆盖层呈现；进入时把主视图切回官方会话（`layout.selectPanel(null)`），
> 官方会话仍挂载在页面里。`60-dock.js` 找到它的 DOM 根（`[data-phase]`，内部有
> `[data-conversation-scroll]`），用 `position:fixed` 浮到右侧 AI 栏的占位区，并覆盖
> `--dsh-chat-user-width` 适配窄栏；退出/收起时逐字节还原 inline 样式。
> 因此右侧对话就是 DSH 会话：**带工具调用、自动改文件、审批、差异审查、命令、会话历史**，
> 不是插件自造的轻量对话（轻量对话仅在找不到官方会话时兜底）。
> `main` key 仍注册（`MainRedirect`）只是安全网：若侧边栏点击没被拦截而切了全局面板，
> 立即进入覆盖层并把主视图还原成会话。

一键入口：
- 侧边栏 `sidebar.panellist` 的「古法」印章图标（点击拦截，不切主面板）；
- 侧边栏底部 `sidebar.footer.action` 的「古法编程」按钮（同样是开关）。
覆盖层内部三栏：

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 古法编程 · 项目名   [新建项目] [打开项目] [刷新]        [AI 对话] [退出]   │
├──┬────────────────┬───────────────────────────────────┬──────────────────┤
│活│ 资源管理器/Git/ │ 编辑器标签页 + Monaco             │ 古法 AI 助手      │
│动│ SSH/终端 面板   ├───────────────────────────────────┤ （流式对话，       │
│栏│ (可调宽度)      │ 终端面板（可折叠）                 │  上下文注入）      │
├──┴────────────────┴───────────────────────────────────┴──────────────────┤
│ 状态栏：分支 · 文件 · 行列 · 项目路径                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

## 构建

客户端半必须是**单个**浏览器产物 `client.js`（lazy-CJS 表：`window.__ModuleLoader__.load`）。
源码拆成 `src/client/*.js` 多个零件文件，由 `scripts/build-client.mjs` 按文件名排序拼接进 factory：

```js
window.__ModuleLoader__.load({
  id: 'dsh-gufa-code',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = React
    /* ...src/client/*.js 依序拼接... */
    return { inject: [], apply }
  },
})
```

每个零件文件都在 factory 函数体内执行，共享 `React / h / hooks / G`。
**不要**在零件里写顶层 `import/export`；**不要**重复声明顶部已解构的 hooks 名字。
每个零件用唯一前缀命名常量，组件挂到 `G` 上（例如 `G.EditorPane = function EditorPane(props) {...}`）。

构建命令：`node scripts/build-client.mjs`（Lead 统一执行；改完源码必须重新构建才生效）。

## 共享核心（00-core.js，Lead 维护）

```js
const G = {
  React, h, ctx,                 // ctx: apply 时注入的 client Cordis Context
  t,                             // i18n：t('key')，namespace = 'gufa-code'
  api(method, body),             // POST /gufa-code/api/<method>，自动鉴权（同源 cookie）
  stream(method, body, onEvent), // POST 流式 (SSE) 端点：onEvent({type, ...})
  asset(path),                   // '/gufa-code/asset/' + path
  wsUrl(path),                   // '/gufa-code/ws/' + path 的 ws(s):// 绝对地址
  theme(),                       // 'dark' | 'light'
  useTheme(),                    // React hook
  Icon, Btn, Spinner, Empty, SectionHeader, Modal, Field,
  PANEL_ID: 'gufa-code',
  bus,                           // 客户端内事件总线：G.bus.emit(type, detail) / G.bus.on(type, fn)
}
```

- 所有网络请求同源、带浏览器登录态；Host 端用 `ctx.connection.requestRejection(req)` 鉴权。
- 颜色只用主题 token（`--dsw-alias-*`、`--dsw-specific-sidebar-fill`）与必要的品牌/艺术色；
  必须在亮/暗主题都正确。
- 所有可见文案走 `t()`；中英字典在 `locale/zh.json`、`locale/en.json`（同时作为插件元数据）。
- 组件不得读写其他插件 DOM、不得 append 到 document.body（弹层用局部 fixed 定位）。

## Host HTTP API（前缀 `/gufa-code/api/`，POST JSON）

统一响应：`{ ok: true, value }` / `{ ok: false, error: { code, message } }`。
除 `project.*`、`ssh.*`、`chat.*` 外，所有 `root` 参数会校验“已打开项目根目录”白名单。

- `project.open` `{ path }` → `{ root, name, isGit }`：把目录登记为可访问项目根（打开项目）。
- `project.validate` `{ path }` → 同 open（只校验不登记）。
- `project.create` `{ parent, name }` → 同 open：在 parent 下新建目录并登记（新建项目）。
- `fs.list` `{ root, path }` → `{ path, entries: [{ name, path, kind: 'file'|'dir', size?, mtimeMs? }] }`
- `fs.read` `{ root, path }` → `{ path, content, revision, size, binary, tooLarge, language }`
- `fs.write` `{ root, path, content, expectedRevision }` → `{ revision, size }`（冲突时 error.code = 'revision-conflict'）
- `fs.create` `{ root, path, kind }` / `fs.mkdir` / `fs.rename` `{ root, path, nextPath }` / `fs.delete` `{ root, path }`
- `git.status` `{ root }` → `{ branch, ahead, behind, changes: [{ path, status, staged }] }`
- `git.stage` `{ root, paths }` / `git.unstage` `{ root, paths }` / `git.commit` `{ root, message }`
- `git.diff` `{ root, path, staged }` → `{ patch }`；`git.log` `{ root, limit }` → `{ commits: [...] }`
- `ssh.hosts` `{}` → `{ hosts: [{ alias, host, user, port }] }`
- `terminal.create` `{ root, cols, rows }` → `{ id, title }`；`terminal.list` `{ root }`；`terminal.close` `{ root, id }`
- `chat.info` `{}` → `{ provider, model }`；`chat.stream` 为 SSE（见下）

### SSE：`POST /gufa-code/api/chat.stream`

请求体 `{ messages: [{role, content}], context: { root, path, content, selection }, provider?, model? }`，
响应 `text/event-stream`，每行 `data: <json>\n\n`，事件：
`{type:'delta', text}`、`{type:'thinking'}`、`{type:'done'}`、`{type:'error', message}`。

## WebSocket

- `/gufa-code/ws/terminal?root=<encodeURIComponent>&id=<id>`：
  客户端→`{type:'input', data}` / `{type:'resize', cols, rows}`；服务端→`{type:'output', data}`、`{type:'exit', code}`。

## 静态资产

- `/gufa-code/asset/monaco/<path>` → `vendor/monaco/vs/<path>`（Monaco AMD `min` 构建；含 `loader.js`）
- `/gufa-code/asset/xterm/xterm.js`、`/gufa-code/asset/xterm/xterm.css`、`/gufa-code/asset/xterm/addon-fit.js`

## 客户端零件职责与接口

| 文件 | 负责人 | 内容 |
|---|---|---|
| `00-core.js` | Lead | G 命名空间、api/stream、样式、基础控件、主题、i18n |
| `10-icons.js` | Lead | 内联 SVG 图标 `G.Icon`（含「古」印章 logo） |
| `20-editor.js` | A | `G.EditorPane`：Montaco 多标签编辑 |
| `55-backdrop.js` | Lead | `G.SkinBackdrop` / `G.useSkinBackdrop`：复刻梁圣皮肤的人像+渐变背景 |
| 终端传输（Host `terminal.js` + Client `30-terminal.js`） | Lead | 桌面壳 `dsh-app://app` 下相对 fetch 被缓冲、WS 下行不达：输出改直连 `http://127.0.0.1:<port>/gufa-code/terminal-stream` SSE（票据鉴权+CORS），输入/尺寸走 POST |
| `00-core.js` 调色板 | Lead | `resolveSolidPalette` 产出 bg/layer/layer2/overlay/text/textDim/accent/isDark，
发布到 `G.paletteStore`（`G.usePalette()` 订阅）；`20-editor.js` 用它生成 Monaco 皮肤主题 |
| `30-terminal.js` | B | `G.TerminalPane`：xterm + WS 终端 |
| `40-chat.js` | C | `G.ChatPanel`：AI 聊天 |
| `50-panels.js` | Lead | `G.Explorer` / `G.GitPanel` / `G.SshPanel` |
| `90-app.js` | Lead | `G.GufaApp` 三栏布局、项目状态、标签页状态 |
| `99-main.js` | Lead | `__ModuleLoader__.load` 包装 + `apply(ctx)`（注册 slot） |

### `G.EditorPane` props（A 负责实现）

```js
G.EditorPane({ tabs, activePath, theme, onSelectTab, onCloseTab, onChange, onSave, onCursor })
// tabs: [{ path, content, language, revision, dirty }]
// onChange(path, content)       内容变化（不落盘）
// onSave(path)                  Ctrl/Cmd+S
// onCursor({ path, line, column, selectedText })
```

### `G.TerminalPane` props（B 负责实现）

```js
G.TerminalPane({ root, visible, height, theme, onToggleHeight })
// 自行管理：终端实例列表、新建/关闭、xterm、WS 重连、resize
// 监听 G.bus 'terminal:send' ({ text }) 把文本写入当前终端（SSH 快捷连接用）
```

### `G.ChatPanel` props（C 负责实现）

```js
G.ChatPanel({ project, activeFile, selection, theme, onInsertCode })
// project: { root, name } | null
// activeFile: { path, content } | null；selection: 选中文本 | null
// onInsertCode(code)            把代码插入编辑器当前光标
// 自行管理：会话列表（localStorage 持久化）、新建会话、流式请求、错误提示
```

## Host 模块热重载（重要）

`index.js` 不再静态 import 各 host 模块：每次 HTTP/WS/资产请求前比较 `host/*.js` 的 mtime 签名
（`MODULE_FILES` 列表），变化时按「代（generation）」重新 `import('./host/x.js?gufa=N')`，
注册进新的 scope 后整体替换旧 scope 并执行旧 scope 的 `onDispose`。

- 因此改 `host/*.js` 后无需重启 Harness；但插件包首次安装/升级、以及改了 `host/context.js`
  或 `index.js` 本身时，仍然需要重启 Harness（这些是入口与基础设施，加载一次）。
- `host/terminal-pty.js` 是 `terminal.js` 的静态依赖，不在 `MODULE_FILES` 中：单独改它不会触发热重载
  （改 `terminal.js` 会）。
- 客户端新增启动探测：`dev.version` 不存在时（旧 Host 半）在编辑区显示黄色横幅提示重启 DSH。

## 目录与依赖

- 不声明 npm 依赖：Monaco / xterm 以离线资产方式 vendor 进 `vendor/`（MIT，保留 LICENSE）。
- Host 半可使用内置 Node 模块、`ctx.subprocess`、`ctx.llm`、`ctx.connection`、`ctx.webServer`、
  `ctx.sessions`、`ctx.workingDirectory`。
- 不读写其他插件 DOM / 组件，不 `require` Harness Client 包。

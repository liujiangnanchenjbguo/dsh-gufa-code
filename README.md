# 古法编程 · AI 辅助（dsh-gufa-code）

> **古法编程 = 用老办法亲手写代码，AI 就是停在你右边的那位。**
> 在 DeepSeek Harness 里一键进入 VS Code 风格的 IDE 模式：左边写代码，右边就是当前 DSH 会话本人 —— 它会改文件、跑终端、提审批，你全看得见。

<p align="center">
  <img src="docs/screenshot-ide.jpg" width="900" alt="古法编程 IDE 模式：左侧资源管理器与 Monaco 编辑器，右侧官方 DSH 会话">
</p>

## 这是什么

一个 DSH 插件。点工作区行「…」菜单里的 **古法编程** 后，主面板切换成一个三栏 IDE：

- **左**：活动栏 + 资源管理器 / 源代码管理 / SSH / 终端；
- **中**：Monaco 编辑器（标签页、面包屑、状态栏、两文件对比、Git diff）；
- **右**：**官方 DSH 会话面板原样停靠** —— 工具调用、自动读写文件、审批弹窗、斜杠命令、上下文引用、会话历史都还在。

从哪个工作区点进来，IDE 就打开哪个工作区，右侧也自动是你在这个工作区正在聊的那个会话。


## 安装

```sh
dsh plugin add dsh-gufa-code
```

或在 DSH 桌面端 / `dsh web` 的 **插件 → 插件市场** 里搜索「古法编程 / dsh-gufa-code」安装。

要求：DeepSeek Harness **0.2.1** 及以上；支持桌面端与浏览器里的 `dsh web`。

## 功能

### 入口与工作区

- 工作区行的 **「…」菜单** 里有「古法编程」（第二项），点它进入 IDE；
- 从哪个工作区点进来，就打开哪个工作区的古法编程；
- IDE 左上角可切换工作区 / 新建工作区；退出只有一个入口：标题栏右上角 **「返回经典模式」**。

### 编辑器

- Monaco 编辑器（离线随包分发，无需联网下载）；
- 多标签、按扩展名语法高亮、面包屑、状态栏（分支 / 行列 / 保存状态）；
- 保存走磁盘版本冲突检测 + 原子写；未保存标记；
- 资源管理器右键：新建 / 重命名 / 删除 / 复制 / 粘贴 / 打开所在文件夹 / 两文件对比；
- 支持 Ctrl/Cmd 多选、软删除与 `⌘Z` 撤销；
- **Git diff**：Monaco diff 视图，红绿强对比、自动定位第一处改动，工作区一侧可编辑并自动保存；
- **两文件对比**：任选两个文件，左右都可编辑（本地草稿，保存时写回）。

### 快捷键（仅 IDE 模式生效，参考 VS Code）

`⌘S` 保存、`⌘K` 清空终端、`⌘J` / `` ⌃` `` 终端、`⌘B` 左栏、`⌘W` 关标签、`⌘⇧E` / `⌘⇧G` 资源管理器 / 源代码管理、`⌘⇧U` SSH、`⌃⇧\`` 新建终端、`⌘/` 行注释（非编辑器区为快捷键列表）。
经典模式的快捷键完全不受影响。

### 左侧面板

- **资源管理器**：懒加载文件树、Git 状态颜色、错误/问题点、目录改动标记；
- **源代码管理**：分支、ahead/behind（点击可推送/拉取）、更改列表、暂存/取消暂存、提交（`⌘⇧↵`，自动暂存未暂存改动）、Git Graph（泳道图 + 提交文件 + 查看某次提交的文件）、撤销上次提交、丢弃全部、逐文件还原；
- **SSH**：解析 `~/.ssh/config`，点一下就在终端里 `ssh <alias>`；
- **终端**：真实 PTY + xterm，多标签、新建/关闭、自动 resize、明暗主题，SSH 与任意命令都行。

### 右侧 AI

- 右侧停靠的就是 **官方 DSH 会话本体**：工具调用、自动读写文件、审批、斜杠命令、上下文引用、会话历史全部可用；
- 工具条：新建会话 / 会话列表 / 打开完整对话 / 收起；
- 会话里的文件链接、diff 标签页属于 DSH 右侧栏，被覆盖层挡住时点「打开完整对话」即可查看。

### 外观

- 颜色全部走 DSH 主题 token，亮/暗主题自动跟随；界面宽度、开关状态持久化到 localStorage；
- 与皮肤插件兼容：如果装有「滑动变祖」这类皮肤，IDE 面板会半透明透出皮肤人像/粒子，编辑器区域也保持轻微透明。

## 开发

```sh
# 构建 client.js（浏览器端零件按文件名顺序拼接）
node scripts/build-client.mjs

# 自测
node scripts/selftest-client.mjs
node scripts/selftest-host.mjs
node scripts/test-editor.mjs

# 修改 host/*.js 后无需重启（请求级热重载）；修改 client 后重新构建并刷新页面
```

## License

MIT

---

### English

**Gufa Code** — a Cursor-style IDE mode for DeepSeek Harness. One click on a workspace's ⋮ menu turns the main panel into a VS Code-like workbench: Monaco editor, file tree, Git panel (with graphite graph, push/pull, per-file revert), SSH hosts and a real PTY terminal on the left; the **official DSH conversation docked on the right**, so agent tool calls, file edits, approvals and session history keep working while you edit. VS Code-style shortcuts, workspace-aware entry (the IDE opens the workspace you clicked from), theme-token based theming including translucent panels over skins, two-file compare and Monaco git diffs.

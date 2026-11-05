# 上架到 DSH 插件市场（awesome-dsh-plugin）

市场（dsh-market / Discover / dsh-plugin-catalog）的目录来自
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。

> 2026-11 起，该仓库改为 **一个插件一个 YAML 文件**：`data/plugins/<owner>__<repo>.yml`，
> 不要再手改 README（README 由脚本生成）。

## 提交文件（唯一一步）

路径：`data/plugins/liujiangnanchenjbguo__dsh-gufa-code.yml`

```yaml
url: https://github.com/liujiangnanchenjbguo/dsh-gufa-code
name: liujiangnanchenjbguo/dsh-gufa-code
category: ui
description:
  en: Cursor-style IDE mode for DeepSeek Harness — one click on a workspace menu turns the main panel into a VS Code-like workbench with a Monaco editor, file tree, Git panel (commit graph, push/pull, per-file revert), SSH hosts and a real PTY terminal on the left, while the official DSH conversation stays docked on the right so tool calls, file edits, approvals and session history keep working as you code.
  zh: 给 DeepSeek Harness 的 IDE 模式：点工作区「…」菜单一键把主面板变成 VS Code 风格工作台——左侧 Monaco 编辑器、文件树、Git 面板（提交图/推送/拉取/逐文件还原）、SSH 主机与真实 PTY 终端，右侧原样停靠官方 DSH 会话，写代码时工具调用、自动改文件、审批与会话历史照常可用。
```

## 硬性要求（当前状态）

- ✅ `package.json` 声明了 `dsh.bundle`（`cordis.patch.yml` 在仓库根）；
- ✅ 真实可用代码（Host/Client 全套，已实装验证）；
- ⏳ **仓库创建满 1 天**——本仓库创建于 2026-11-05，最早 2026-11-06 可提交；
- ✅ 通过 `dsh plugin add` 安装验证（临时 profile 实测通过）。

## 可选

- `icon:` 字段可指向 GitHub 上的位图（不写则回退作者头像）；
- 发布到 npm（`npm publish --access public`）后，Discover 索引会带版本号，安装与自动更新更快。

window.__ModuleLoader__.load({
  id: 'dsh-gufa-code',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = React

/* ─────────────────────── 00-core.js ─────────────────────── */
/**
 * 00-core：G 命名空间、网络请求、i18n、主题、样式、基础控件。
 * 构建时本文件最先拼进 client.js 的 factory 内。
 */
const GUFA_NS = 'gufa-code'

/** 全局命名空间：所有零件通过 G.xxx 共享能力与组件。 */
const G = {}
G.NS = GUFA_NS
G.PANEL_ID = 'gufa-code'
/** 从哪个工作区点进来的（工作区菜单/节点按钮写入，App 启动时消费）。 */
G.pendingEntryWorkspace = null
G.ctx = null
G.h = h
G.React = React
G.hooks = { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect }

/* ── 事件总线（零件之间解耦：SSH → 终端 发送命令等） ───────────────────── */
G.bus = (function createBus() {
  const listeners = new Map()
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
      return () => listeners.get(type)?.delete(fn)
    },
    emit(type, detail) {
      for (const fn of listeners.get(type) ?? []) {
        try {
          fn(detail)
        } catch (error) {
          console.error('[gufa-code] bus listener failed', error)
        }
      }
    },
  }
})()

/* ── i18n：字典走 Client locale 服务；未注册时回落到内置中文 ─────────────── */
const DICT_ZH = {
  'panel.label': '古法编程',
  'panel.enterHint': '一键进入古法编程 IDE',
  'dock.title': '古法 AI',
  'dock.sub': 'DSH 会话',
  'dock.live': '已连接 DSH 会话',
  'dock.newSession': '新建会话',
  'dock.sessions': '切换会话（当前工作区）',
  'dock.sessionsTitle': '切换会话',
  'shortcuts.title': '古法编程快捷键',
  'shortcuts.save': '保存当前文件',
  'shortcuts.clearTerminal': '清除终端内容',
  'shortcuts.toggleTerminal': '显示 / 隐藏终端',
  'shortcuts.toggleSidebar': '显示 / 隐藏左侧栏',
  'shortcuts.closeTab': '关闭当前标签页',
  'shortcuts.explorer': '聚焦资源管理器',
  'shortcuts.git': '聚焦源代码管理',
  'shortcuts.ssh': '聚焦 SSH 主机',
  'shortcuts.newTerminal': '新建终端',
  'shortcuts.help': '打开 / 关闭本快捷键列表',
  'shortcuts.editorTitle': '编辑器（Monaco / VS Code 同款键位）',
  'editorKeys.comment': '切换行注释',
  'editorKeys.blockComment': '切换块注释',
  'editorKeys.nextOccurrence': '选中下一个相同内容（多光标）',
  'editorKeys.allOccurrences': '选中全部相同内容',
  'editorKeys.cursorAboveBelow': '向上 / 向下添加光标',
  'editorKeys.undoCursor': '撤销上一个光标',
  'editorKeys.moveLine': '上移 / 下移当前行',
  'editorKeys.copyLine': '向上 / 向下复制当前行',
  'editorKeys.deleteLine': '删除当前行',
  'editorKeys.insertLine': '在下方 / 上方插入新行',
  'editorKeys.indent': '增加 / 减少缩进',
  'editorKeys.columnSelect': '列选择（鼠标拖拽）',
  'editorKeys.find': '查找 / 替换',
  'editorKeys.goToLine': '跳转到行',
  'editorKeys.format': '格式化文档',
  'editorKeys.rename': '重命名符号',
  'dock.fullConversation': '打开完整对话',
  'dock.collapse': '收起 AI 面板',
  'dock.missingTitle': '未连接到 DSH 会话',
  'dock.missingHint': '未找到官方会话面板（可能没有选中会话）。点击「新建会话」，或「打开完整对话」后重试。',
  'dock.missingNotice': '未连接到 DSH 会话，暂用内置轻量对话',
  'dock.retry': '重试连接',
  'app.title': '古法编程',
  'app.subtitle': 'GUFA CODE',
  'app.newProject': '新建项目',
  'app.newWorkspace': '新建工作区',
  'app.switchWorkspace': '切换工作区',
  'app.noWorkspace': '选择工作区',
  'session.otherWorkspaces': '其他工作区',
  'workspace.title': '工作区',
  'workspace.current': '当前',
  'workspace.empty': '还没有工作区，点下方「新建工作区」开始',
  'workspace.unavailable': '当前环境未提供工作区服务；可以用「打开目录」方式进入',
  'workspace.create': '新建工作区',
  'app.openProject': '打开项目',
  'app.refresh': '刷新',
  'app.exit': '返回经典模式',
  'app.exitHint': '退出古法编程，回到 DSH 经典界面',
  'app.openFolder': '打开文件夹',
  'app.noProject': '尚未打开项目',
  'app.noProjectHint': '打开一个文件夹，或新建一个项目，开始古法编程。',
  'app.projectName': '项目名',
  'app.parentFolder': '父目录',
  'app.cancel': '取消',
  'app.confirm': '确定',
  'app.create': '创建',
  'app.loading': '加载中…',
  'app.error': '出错了',
  'app.retry': '重试',
  'app.hostStale': '插件已升级：当前 Host 仍是旧版本。AI 对话与编辑器已可用；请退出并重新打开 DeepSeek Harness 以启用真实终端。',
  'app.backdropOn': '开启梁圣背景图',
  'app.backdropOff': '关闭梁圣背景图',
  'app.backdropMissing': '未检测到梁圣皮肤背景（在设置中开启皮肤后可用）',
  'app.backdropStrength': '背景浓度（无级）',
  'app.backdropStrengthHint': '拖动到任意浓度；双击恢复跟随皮肤档位',
  'app.chooseFolder': '选择文件夹',
  'app.manualPath': '或直接输入路径',
  'app.pathPlaceholder': '例如 /Users/me/project',
  'activity.explorer': '资源管理器',
  'activity.git': '源代码管理',
  'activity.ssh': 'SSH 远程',
  'activity.terminal': '终端',
  'activity.chat': '古法 AI 助手',
  'activity.collapseChat': '收起 AI 面板',
  'activity.expandChat': '展开 AI 面板',
  'explorer.empty': '目录为空',
  'explorer.newFile': '新建文件',
  'explorer.newFolder': '新建文件夹',
  'explorer.rename': '重命名',
  'explorer.copy': '复制',
  'explorer.paste': '粘贴',
  'explorer.revealInFinder': '打开所在文件夹',
  'explorer.compareSelected': '对比',
  'explorer.changedDir': '目录内有改动',
  'explorer.delete': '删除',
  'explorer.fileName': '文件名（可含子路径）',
  'explorer.folderName': '文件夹名',
  'explorer.deleteConfirm': '确定删除 {name}？',
  'explorer.refresh': '刷新目录',
  'explorer.loading': '读取目录…',
  'explorer.openProjectFirst': '请先打开项目',
  'git.branch': '分支',
  'git.changes': '更改',
  'git.noRepo': '当前项目不是 Git 仓库',
  'git.noChanges': '工作区干净',
  'git.stage': '暂存',
  'git.unstage': '取消暂存',
  'git.stageAll': '全部暂存',
  'git.commitPlaceholder': '提交信息（Ctrl+Enter 提交）',
  'git.commit': '提交',
  'git.stageAll': '全部暂存',
  'git.unstageAll': '全部取消暂存',
  'git.noStagedHint': '没有已暂存的改动：点改动行右侧的 + 暂存，或点标题栏的「全部暂存」后再提交',
  'git.pushHint': '点击推送到远端',
  'git.pullHint': '点击从远端拉取',
  'git.push': '推送',
  'git.pushNoUpstream': '推送（首次会建立上游）',
  'git.aheadCount': '待推送',
  'git.behindCount': '待拉取',
  'git.pull': '拉取',
  'git.noUpstreamHint': '当前分支还没有上游：点标题栏 ↑ 推送一次即可自动创建上游（git push -u）',
  'git.pushDone': '已推送（如需首次建立上游会自动 -u）',
  'git.discardFile': '还原该文件的改动',
  'git.autoStageHint': '提交时会自动暂存所有未暂存改动（也可以先手动选择要暂存的文件）',
  'git.commitNeedsMessage': '请先填写提交信息，再按 ⌘⇧↵ 提交',
  'git.commitDone': '提交成功',
  'git.more': '更多操作',
  'git.viewDiff': '查看改动对比',
  'git.copyPath': '复制文件路径',
  'graph.open': '打开 Git Graph',
  'graph.title': 'Git Graph',
  'graph.refresh': '刷新提交图',
  'graph.toggleAll': '切换显示范围',
  'graph.allBranches': '全部分支',
  'graph.currentBranch': '仅当前分支',
  'graph.noProject': '请先打开项目',
  'graph.noCommits': '还没有提交',
  'graph.copyHash': '复制完整 hash',
  'graph.copied': '已复制',
  'git.branchesTitle': '分支',
  'git.branchSwitchHint': '点击切换 / 新建分支',
  'git.switchBranch': '切换到该分支',
  'git.currentBranch': '当前分支',
  'git.branchCurrent': '当前',
  'git.branchNamePlaceholder': '新分支名',
  'git.branchCreate': '新建并切换',
  'git.undoLastCommit': '撤回上次提交（保留改动）',
  'diff.prev': '上一处差异',
  'diff.next': '下一处差异',
  'diff.revertFile': '还原文件',
  'diff.stageFile': '暂存文件',
  'git.discardAll': '撤销所有未暂存改动',
  'git.discardConfirm': '再点一次确认撤销（未跟踪文件不会被删除）',
  'git.discardDone': '已撤销所有改动（未跟踪文件保留）',
  'git.pullDone': '拉取完成',
  'git.committed': '已提交',
  'git.refresh': '刷新',
  'git.staged': '已暂存',
  'git.unstaged': '未暂存',
  'git.untracked': '未跟踪',
  'git.noRepoHint': '初始化：git init',
  'ssh.hosts': 'SSH 主机',
  'ssh.noHosts': '~/.ssh/config 中没有主机配置',
  'ssh.connect': '连接',
  'ssh.connectHint': '点击主机将在终端中执行 ssh 连接',
  'ssh.configHint': '在 ~/.ssh/config 中添加 Host 配置后刷新',
  'ssh.refresh': '刷新',
  'terminal.new': '新建终端',
  'terminal.close': '关闭终端',
  'terminal.exited': '进程已退出',
  'terminal.session': '终端',
  'terminal.title': '终端',
  'editor.noFile': '选择或新建一个文件开始编辑',
  'editor.noFileHint': '左侧资源管理器中打开文件，或按「新建文件」',
  'editor.saveConflict': '文件已在磁盘上被修改，请重新打开后再保存',
  'editor.binary': '二进制文件，无法以文本编辑',
  'editor.tooLarge': '文件过大，无法打开',
  'editor.loading': '加载编辑器…',
  'editor.save': '保存',
  'editor.close': '关闭',
  'chat.title': '古法 AI',
  'chat.newChat': '新建对话',
  'chat.history': '历史对话',
  'chat.noHistory': '暂无历史对话',
  'chat.deleteChat': '删除对话',
  'chat.inputPlaceholder': '问问 AI，或让它解释左侧代码…（Enter 发送，Shift+Enter 换行）',
  'chat.send': '发送',
  'chat.stop': '停止',
  'chat.you': '你',
  'chat.assistant': '古法 AI',
  'chat.thinking': '思考中…',
  'chat.emptyTitle': '古法 AI 助手',
  'chat.emptyHint': '我在这里辅助你手写代码：解释、找错、补注释、给思路。',
  'chat.attachFile': '附带当前文件',
  'chat.insert': '插入到编辑器',
  'chat.copy': '复制',
  'chat.copied': '已复制',
  'chat.error': '请求失败',
  'chat.quickExplain': '解释当前代码',
  'chat.quickBug': '查找潜在问题',
  'chat.quickComment': '补充注释',
  'chat.quickRefactor': '重构建议',
  'chat.contextLabel': '上下文',
  'chat.ctxFile': '当前文件',
  'chat.ctxSelection': '选中代码',
  'chat.clear': '清空对话',
  'chat.model': '模型',
  'status.ln': '行',
  'status.col': '列',
  'status.saved': '已保存',
  'status.dirty': '未保存',
  'status.noGit': '非 Git 仓库',
  'status.lines': '行',
  'status.encoding': 'UTF-8',
  'status.spaces': '空格: 2',
  'common.refresh': '刷新',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.delete': '删除',
  'common.rename': '重命名',
  'common.close': '关闭',
  'common.retry': '重试',
  'common.error': '出错了',
  'common.loading': '加载中…',
  'common.empty': '空',
  'common.save': '保存',
}

const DICT_EN = {
  'panel.label': 'Gufa Code',
  'panel.enterHint': 'Open the Gufa Code IDE',
  'dock.title': 'Gufa AI',
  'dock.sub': 'DSH session',
  'dock.live': 'Connected to the DSH session',
  'dock.newSession': 'New session',
  'dock.sessions': 'Switch session (current workspace)',
  'dock.sessionsTitle': 'Switch session',
  'shortcuts.title': 'Gufa Code shortcuts',
  'shortcuts.save': 'Save current file',
  'shortcuts.clearTerminal': 'Clear terminal',
  'shortcuts.toggleTerminal': 'Toggle terminal panel',
  'shortcuts.toggleSidebar': 'Toggle sidebar',
  'shortcuts.closeTab': 'Close current tab',
  'shortcuts.explorer': 'Focus explorer',
  'shortcuts.git': 'Focus source control',
  'shortcuts.ssh': 'Focus SSH hosts',
  'shortcuts.newTerminal': 'New terminal',
  'shortcuts.help': 'Show / hide this shortcut list',
  'shortcuts.editorTitle': 'Editor (Monaco / VS Code keybindings)',
  'editorKeys.comment': 'Toggle line comment',
  'editorKeys.blockComment': 'Toggle block comment',
  'editorKeys.nextOccurrence': 'Add next occurrence to multi-cursor',
  'editorKeys.allOccurrences': 'Select all occurrences',
  'editorKeys.cursorAboveBelow': 'Add cursor above / below',
  'editorKeys.undoCursor': 'Undo last cursor',
  'editorKeys.moveLine': 'Move line up / down',
  'editorKeys.copyLine': 'Copy line up / down',
  'editorKeys.deleteLine': 'Delete line',
  'editorKeys.insertLine': 'Insert line below / above',
  'editorKeys.indent': 'Indent / outdent line',
  'editorKeys.columnSelect': 'Column selection (mouse drag)',
  'editorKeys.find': 'Find / replace',
  'editorKeys.goToLine': 'Go to line',
  'editorKeys.format': 'Format document',
  'editorKeys.rename': 'Rename symbol',
  'dock.fullConversation': 'Open full conversation',
  'dock.collapse': 'Collapse AI panel',
  'dock.missingTitle': 'Not connected to a DSH session',
  'dock.missingHint': 'The official conversation panel was not found (maybe no session is selected). Press “New session”, or “Open full conversation” and retry.',
  'dock.missingNotice': 'Not connected to a DSH session — using the built-in lightweight chat',
  'dock.retry': 'Retry connection',
  'app.title': 'Gufa Code',
  'app.subtitle': 'CLASSIC CODING',
  'app.newProject': 'New project',
  'app.openProject': 'Open project',
  'app.refresh': 'Refresh',
  'app.exit': 'Classic mode',
  'app.exitHint': 'Leave Gufa Code and return to the classic DSH UI',
  'app.openFolder': 'Open folder',
  'app.noProject': 'No project opened',
  'app.noProjectHint': 'Open a folder or create a project to start classic coding.',
  'app.projectName': 'Project name',
  'app.parentFolder': 'Parent folder',
  'app.cancel': 'Cancel',
  'app.confirm': 'OK',
  'app.create': 'Create',
  'app.loading': 'Loading…',
  'app.error': 'Something went wrong',
  'app.retry': 'Retry',
  'app.hostStale': 'Plugin upgraded: the Host is still an older build. The editor and AI chat already work; quit and reopen DeepSeek Harness to enable the real terminal.',
  'app.backdropOn': 'Show the Liang skin backdrop',
  'app.backdropOff': 'Hide the Liang skin backdrop',
  'app.backdropMissing': 'Liang skin backdrop not detected (enable the skin in Settings)',
  'app.backdropStrength': 'Backdrop intensity (stepless)',
  'app.backdropStrengthHint': 'Drag to any intensity; double-click to follow the skin again',
  'app.chooseFolder': 'Choose folder',
  'app.manualPath': 'Or type a path',
  'app.pathPlaceholder': 'e.g. /Users/me/project',
  'activity.explorer': 'Explorer',
  'activity.git': 'Source control',
  'activity.ssh': 'SSH',
  'activity.terminal': 'Terminal',
  'activity.chat': 'Gufa AI',
  'activity.collapseChat': 'Collapse AI panel',
  'activity.expandChat': 'Expand AI panel',
  'explorer.empty': 'Folder is empty',
  'explorer.newFile': 'New file',
  'explorer.newFolder': 'New folder',
  'explorer.rename': 'Rename',
  'explorer.copy': 'Copy',
  'explorer.paste': 'Paste',
  'explorer.revealInFinder': 'Open Containing Folder',
  'explorer.compareSelected': 'Compare',
  'explorer.changedDir': 'Contains changes',
  'explorer.delete': 'Delete',
  'explorer.fileName': 'File name (may include sub path)',
  'explorer.folderName': 'Folder name',
  'explorer.deleteConfirm': 'Delete {name}?',
  'explorer.refresh': 'Refresh folder',
  'explorer.loading': 'Reading folder…',
  'explorer.openProjectFirst': 'Open a project first',
  'git.branch': 'Branch',
  'git.changes': 'Changes',
  'git.noRepo': 'This project is not a Git repository',
  'git.noChanges': 'Working tree clean',
  'git.stage': 'Stage',
  'git.unstage': 'Unstage',
  'git.stageAll': 'Stage all',
  'git.commitPlaceholder': 'Commit message (Ctrl+Enter to commit)',
  'git.commit': 'Commit',
  'git.stageAll': 'Stage all changes',
  'git.unstageAll': 'Unstage all changes',
  'git.noStagedHint': 'Nothing staged yet: click + on a change row, or use "Stage all" in the panel header before committing',
  'git.pushHint': 'Click to push to remote',
  'git.pullHint': 'Click to pull from remote',
  'git.push': 'Push',
  'git.pushNoUpstream': 'Push (creates upstream on first push)',
  'git.aheadCount': 'to push',
  'git.behindCount': 'to pull',
  'git.pull': 'Pull',
  'git.noUpstreamHint': 'No upstream for this branch yet: click ↑ in the header to push once (auto git push -u)',
  'git.pushDone': 'Pushed',
  'git.discardFile': 'Revert this file',
  'git.autoStageHint': 'Committing auto-stages all unstaged changes',
  'git.commitNeedsMessage': 'Write a commit message first, then press ⌘⇧↵',
  'git.commitDone': 'Committed',
  'git.more': 'More actions',
  'git.viewDiff': 'View diff',
  'git.copyPath': 'Copy file path',
  'graph.open': 'Open Git Graph',
  'graph.title': 'Git Graph',
  'graph.refresh': 'Refresh graph',
  'graph.toggleAll': 'Toggle scope',
  'graph.allBranches': 'All branches',
  'graph.currentBranch': 'Current branch only',
  'graph.noProject': 'Open a project first',
  'graph.noCommits': 'No commits yet',
  'graph.copyHash': 'Copy full hash',
  'graph.copied': 'Copied',
  'git.branchesTitle': 'Branches',
  'git.branchSwitchHint': 'Click to switch / create branch',
  'git.switchBranch': 'Switch to this branch',
  'git.currentBranch': 'Current branch',
  'git.branchCurrent': 'current',
  'git.branchNamePlaceholder': 'New branch name',
  'git.branchCreate': 'Create & switch',
  'git.undoLastCommit': 'Undo last commit (keep changes)',
  'diff.prev': 'Previous change',
  'diff.next': 'Next change',
  'diff.revertFile': 'Revert file',
  'diff.stageFile': 'Stage file',
  'git.discardAll': 'Discard all unstaged changes',
  'git.discardConfirm': 'Click again to confirm (untracked files are kept)',
  'git.discardDone': 'All changes discarded (untracked files kept)',
  'git.pullDone': 'Pull complete',
  'git.committed': 'Committed',
  'git.refresh': 'Refresh',
  'git.staged': 'Staged',
  'git.unstaged': 'Unstaged',
  'git.untracked': 'Untracked',
  'git.noRepoHint': 'Initialize: git init',
  'ssh.hosts': 'SSH hosts',
  'ssh.noHosts': 'No hosts in ~/.ssh/config',
  'ssh.connect': 'Connect',
  'ssh.connectHint': 'Click a host to run ssh in the terminal',
  'ssh.configHint': 'Add Host entries in ~/.ssh/config, then refresh',
  'ssh.refresh': 'Refresh',
  'terminal.new': 'New terminal',
  'terminal.close': 'Close terminal',
  'terminal.exited': 'Process exited',
  'terminal.session': 'Terminal',
  'terminal.title': 'TERMINAL',
  'editor.noFile': 'Open or create a file to start editing',
  'editor.noFileHint': 'Pick a file in the explorer on the left, or press “New file”',
  'editor.saveConflict': 'File changed on disk; reopen before saving',
  'editor.binary': 'Binary file cannot be edited as text',
  'editor.tooLarge': 'File too large to open',
  'editor.loading': 'Loading editor…',
  'editor.save': 'Save',
  'editor.close': 'Close',
  'chat.title': 'Gufa AI',
  'chat.newChat': 'New chat',
  'chat.history': 'History',
  'chat.noHistory': 'No history yet',
  'chat.deleteChat': 'Delete chat',
  'chat.inputPlaceholder': 'Ask the AI, or have it explain the code on the left… (Enter to send, Shift+Enter for newline)',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.you': 'You',
  'chat.assistant': 'Gufa AI',
  'chat.thinking': 'Thinking…',
  'chat.emptyTitle': 'Gufa AI assistant',
  'chat.emptyHint': 'I help you write code by hand: explain, spot bugs, add comments, suggest ideas.',
  'chat.attachFile': 'Attach current file',
  'chat.insert': 'Insert into editor',
  'chat.copy': 'Copy',
  'chat.copied': 'Copied',
  'chat.error': 'Request failed',
  'chat.quickExplain': 'Explain this code',
  'chat.quickBug': 'Find issues',
  'chat.quickComment': 'Add comments',
  'chat.quickRefactor': 'Refactor ideas',
  'chat.contextLabel': 'Context',
  'chat.ctxFile': 'Current file',
  'chat.ctxSelection': 'Selection',
  'chat.clear': 'Clear chat',
  'chat.model': 'Model',
  'status.ln': 'Ln',
  'status.col': 'Col',
  'status.saved': 'Saved',
  'status.dirty': 'Unsaved',
  'status.noGit': 'No Git repo',
  'status.lines': 'lines',
  'status.encoding': 'UTF-8',
  'status.spaces': 'Spaces: 2',
  'common.refresh': 'Refresh',
  'common.cancel': 'Cancel',
  'common.confirm': 'OK',
  'common.delete': 'Delete',
  'common.rename': 'Rename',
  'common.close': 'Close',
  'common.retry': 'Retry',
  'common.error': 'Something went wrong',
  'common.loading': 'Loading…',
  'common.empty': 'Empty',
  'common.save': 'Save',
}

G.translate = function translate(key, params) {
  const raw = DICT_ZH[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}
G.t = G.translate

/** 订阅 locale 变化并重新渲染，返回翻译函数。 */
G.useT = function useT() {
  const [, setRevision] = useState(0)
  useEffect(() => {
    const locale = G.ctx === null ? undefined : G.ctx.get('locale')
    if (locale === undefined || locale === null || typeof locale.subscribe !== 'function') return undefined
    return locale.subscribe(() => setRevision((value) => value + 1))
  }, [])
  return G.translate
}

/* ── 古法编程模式开关（全局：覆盖层显示 / 隐藏） ───────────────────────── */
const MODE_KEY = 'gufa-code:mode:v1'
function readModePreference() {
  try {
    return localStorage.getItem(MODE_KEY) === '1'
  } catch {
    return false
  }
}
let gufaModeVisible = readModePreference()
const gufaModeListeners = new Set()

G.mode = {
  get() {
    return gufaModeVisible
  },
  set(value) {
    const next = value === true
    if (next === gufaModeVisible) return
    gufaModeVisible = next
    try {
      if (window.__gufaModeLogs === undefined) window.__gufaModeLogs = 20
      if (window.__gufaModeLogs > 0) {
        window.__gufaModeLogs -= 1
        void G.api('dev.log', { message: `mode-set ${next}` }).catch(() => {})
      }
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(MODE_KEY, next ? '1' : '0')
    } catch {
      /* 隐私模式忽略 */
    }
    for (const listener of [...gufaModeListeners]) {
      try {
        listener(next)
      } catch (error) {
        console.error('[gufa-code] mode listener failed', error)
      }
    }
  },
  toggle() {
    G.mode.set(!gufaModeVisible)
  },
  subscribe(listener) {
    gufaModeListeners.add(listener)
    return () => gufaModeListeners.delete(listener)
  },
}

/** 进入古法编程：显示覆盖层，并确保主视图是 DSH 会话（这样官方对话已挂载，可停靠进右侧）。 */
G.enterGufa = function enterGufa() {
  G.mode.set(true)
  const layout = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('layout')
  try {
    layout?.selectPanel?.(null)
  } catch (error) {
    console.error('[gufa-code] 切换到会话主视图失败', error)
  }
}

/** 订阅模式开关的 hook。 */
G.useMode = function useMode() {
  const [visible, setVisible] = useState(G.mode.get)
  useEffect(() => G.mode.subscribe(setVisible), [])
  return visible
}

/* ── 网络 ─────────────────────────────────────────────────────────────── */
G.api = async function api(method, body, signal) {
  const response = await fetch(`/gufa-code/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`请求失败（HTTP ${response.status}）`)
  }
  if (!response.ok || payload.ok !== true) {
    const error = new Error(payload?.error?.message ?? `请求失败（HTTP ${response.status}）`)
    error.code = payload?.error?.code
    throw error
  }
  return payload.value
}

/** SSE 流式请求：onEvent 收到服务端事件对象，返回 abort 函数。 */
G.stream = function stream(method, body, onEvent, onEnd) {
  const controller = new AbortController()
  let completed = false
  const finish = () => {
    if (completed) return
    completed = true
    if (typeof onEnd === 'function') {
      try {
        onEnd()
      } catch (error) {
        console.error('[gufa-code] stream onEnd failed', error)
      }
    }
  }
  void (async () => {
    try {
      const response = await fetch(`/gufa-code/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        let message = `请求失败（HTTP ${response.status}）`
        try {
          const payload = await response.json()
          message = payload?.error?.message ?? message
        } catch {
          /* 保留默认信息 */
        }
        onEvent({ type: 'error', message })
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              onEvent(JSON.parse(line.slice(6)))
            } catch {
              /* 忽略坏帧 */
            }
          }
        }
      }
      finish()
    } catch (error) {
      if (controller.signal.aborted) return
      onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      finish()
    }
  })()
  return () => controller.abort()
}

G.asset = (path) => `/gufa-code/asset/${path}`
/** 解析真实 Host 的 HTTP 基址：桌面壳页面在 dsh-app://，需用 __DSH_TRANSPORT__.streamBaseUrl。 */
G.serverBase = function serverBase() {
  try {
    const transport = globalThis.__DSH_TRANSPORT__
    if (transport !== null && transport !== undefined && typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl !== '') {
      return transport.streamBaseUrl
    }
  } catch {
    /* ignore */
  }
  return typeof document !== 'undefined' && typeof document.baseURI === 'string' ? document.baseURI : location.href
}

/** 终端 WS 地址（桌面壳下用真实 Host 基址解析，浏览器下与 document.baseURI 一致）。 */
G.wsUrl = function wsUrl(query, path) {
  const target = typeof path === 'string' && path !== '' ? path : '/gufa-code/ws'
  let url
  try {
    const base = G.serverBase()
    url = target.startsWith('/') ? new URL(target, base) : new URL(target.slice(0), base)
  } catch {
    url = new URL(`${location.origin}${target}`)
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = query
  return url.href
}

/* ── 主题 ─────────────────────────────────────────────────────────────── */
G.theme = function theme() {
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}

G.useTheme = function useTheme() {
  const [value, setValue] = useState(G.theme)
  useEffect(() => {
    const observer = new MutationObserver(() => setValue(G.theme()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])
  return value
}

/* ── 不透明配色（皮肤可能把主题 token 改成半透明/透明，IDE 需要实底） ─────── */

/** 解析 CSS 颜色为 [r,g,b,a]；无法解析返回 null。 */
G.parseCssColor = function parseCssColor(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (text === '') return null
  if (text === 'transparent') return [0, 0, 0, 0]
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex !== null) {
    const raw = hex[1]
    if (raw.length === 3) return [Number.parseInt(raw[0] + raw[0], 16), Number.parseInt(raw[1] + raw[1], 16), Number.parseInt(raw[2] + raw[2], 16), 1]
    if (raw.length === 6) return [Number.parseInt(raw.slice(0, 2), 16), Number.parseInt(raw.slice(2, 4), 16), Number.parseInt(raw.slice(4, 6), 16), 1]
    if (raw.length === 8) return [Number.parseInt(raw.slice(0, 2), 16), Number.parseInt(raw.slice(2, 4), 16), Number.parseInt(raw.slice(4, 6), 16), Number.parseInt(raw.slice(6, 8), 16) / 255]
    return null
  }
  const channel = (raw) => (raw.endsWith('%') ? Math.round((Number.parseFloat(raw) / 100) * 255) : Math.round(Number.parseFloat(raw)))
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text)
  if (rgb !== null) {
    const alphaRaw = rgb[4]
    const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw)
    return [channel(rgb[1]), channel(rgb[2]), channel(rgb[3]), Math.max(0, Math.min(1, alpha))]
  }
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(text)
  if (srgb !== null) {
    return [Math.round(Number.parseFloat(srgb[1]) * 255), Math.round(Number.parseFloat(srgb[2]) * 255), Math.round(Number.parseFloat(srgb[3]) * 255), srgb[4] === undefined ? 1 : Number.parseFloat(srgb[4])]
  }
  return null
}

/** 相对亮度（0–1，用于判断背景深浅）。 */
G.luminance = function luminance(color) {
  const c = color ?? [0, 0, 0]
  const channel = (value) => {
    const v = Math.max(0, Math.min(255, value)) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
}

/** 把半透明前景色合成到不透明背景色上，返回 [r,g,b,a=1]。 */
G.compositeColor = function compositeColor(foreground, background) {
  const fg = foreground ?? [0, 0, 0, 0]
  const bg = background ?? [0, 0, 0, 1]
  const alpha = fg[3] ?? 1
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
    1,
  ]
}

/**
 * 计算 IDE 用的不透明配色：
 * 皮肤（例如 liang-intensity-skin）会把 --dsw-alias-bg-* 改成半透明/透明以透出壁纸，
 * 这里把主题 token 依次合成到不透明页面底色上，得到 bg/layer/layer2/overlay/sidebar 实色。
 * @param {HTMLElement|null} container 用于探测计算样式的挂载点（须在文档内）
 * @returns {{bg:string, layer:string, layer2:string, overlay:string, sidebar:string}}
 */
G.resolveSolidPalette = function resolveSolidPalette(container) {
  const dark = G.theme() === 'dark'
  const fallbackPage = dark ? [26, 27, 31, 1] : [250, 250, 252, 1]
  const fallbackSurface = dark ? [45, 46, 51, 1] : [255, 255, 255, 1]
  const toRgb = (color) => `rgb(${color[0]}, ${color[1]}, ${color[2]})`
  const usable = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' && container !== null && container !== undefined
  if (!usable) {
    const bg = fallbackPage
    const layer = G.compositeColor(fallbackSurface, bg)
    const layer2 = G.compositeColor(fallbackSurface, layer)
    return { bg: toRgb(bg), layer: toRgb(layer), layer2: toRgb(layer2), overlay: toRgb(layer2), sidebar: toRgb(layer), text: toRgb(dark ? [236, 238, 241, 1] : [24, 26, 30, 1]), textDim: toRgb(dark ? [166, 170, 176, 1] : [92, 98, 106, 1]), accent: toRgb(dark ? [65, 118, 230, 1] : [181, 43, 36, 1]), isDark: dark }
  }
  let page = fallbackPage
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;pointer-events:none;opacity:0'
  let palette = null
  try {
    container.appendChild(probe)
    const read = (token) => {
      probe.style.backgroundColor = ''
      probe.style.backgroundColor = `var(${token})`
      return window.getComputedStyle(probe).backgroundColor
    }
    const bodyColor = G.parseCssColor(window.getComputedStyle(document.body).backgroundColor)
    if (bodyColor !== null && bodyColor[3] >= 0.999) page = bodyColor
    const token = (name, fallback) => {
      const parsed = G.parseCssColor(read(name))
      return parsed === null ? fallback : parsed
    }
    const bg = G.compositeColor(token('--dsw-alias-bg-base', page), page)
    const layer = G.compositeColor(token('--dsw-alias-bg-layer-1', fallbackSurface), bg)
    const layer2 = G.compositeColor(token('--dsw-alias-bg-layer-2', fallbackSurface), layer)
    const overlayShade = dark ? [255, 255, 255, 0.08] : [0, 0, 0, 0.05]
    const overlay = G.compositeColor(overlayShade, layer2)
    const sidebar = G.compositeColor(token('--dsw-specific-sidebar-fill', [0, 0, 0, 0]), bg)
    const text = G.compositeColor(token('--dsw-alias-label-primary', dark ? [236, 238, 241, 1] : [24, 26, 30, 1]), layer2)
    const textDim = G.compositeColor(token('--dsw-alias-label-secondary', dark ? [166, 170, 176, 1] : [92, 98, 106, 1]), layer2)
    const accentToken = token('--dsw-alias-state-business-primary', token('--dsw-alias-brand-primary', dark ? [65, 118, 230, 1] : [181, 43, 36, 1]))
    const accent = G.compositeColor(accentToken, bg)
    const isDark = G.luminance(bg) < 0.5
    palette = { bg: toRgb(bg), layer: toRgb(layer), layer2: toRgb(layer2), overlay: toRgb(overlay), sidebar: toRgb(sidebar), text: toRgb(text), textDim: toRgb(textDim), accent: toRgb(accent), isDark }
  } catch {
    palette = null
  } finally {
    try {
      probe.remove()
    } catch {
      /* ignore */
    }
  }
  if (palette !== null) return palette
  const bg = fallbackPage
  const layer = G.compositeColor(fallbackSurface, bg)
  const layer2 = G.compositeColor(fallbackSurface, layer)
  return { bg: toRgb(bg), layer: toRgb(layer), layer2: toRgb(layer2), overlay: toRgb(layer2), sidebar: toRgb(layer), text: toRgb(dark ? [236, 238, 241, 1] : [24, 26, 30, 1]), textDim: toRgb(dark ? [166, 170, 176, 1] : [92, 98, 106, 1]), accent: toRgb(dark ? [65, 118, 230, 1] : [181, 43, 36, 1]), isDark: dark }
}

/** IDE 根错误边界：渲染异常时显示可读错误并允许退回经典模式（同时写入诊断日志）。 */
const GUFA_COMPONENT_BASE = typeof React !== 'undefined' && React !== null && typeof React.Component === 'function' ? React.Component : class {}
G.GufaErrorBoundary = class GufaErrorBoundary extends GUFA_COMPONENT_BASE {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    try {
      const detail = `${String(error && error.stack ? error.stack : error).slice(0, 1500)} | componentStack=${String(info && info.componentStack ? info.componentStack : '').slice(0, 600)}`
      void G.api('dev.log', { message: `gufa-app-error ${detail}` }).catch(() => {})
    } catch {
      /* ignore */
    }
  }

  render() {
    const error = this.state.error
    if (error === null || error === undefined) return this.props.children
    return React.createElement(
      'div',
      { className: 'gufa-error-fallback' },
      React.createElement('div', { className: 'gufa-error-fallback-title' }, '古法编程渲染出错'),
      React.createElement('pre', { className: 'gufa-error-fallback-detail' }, String(error && error.message ? error.message : error).slice(0, 1200)),
      React.createElement('div', { className: 'gufa-error-fallback-actions' },
        React.createElement(G.Button, { onClick: () => { try { G.mode.set(false) } catch { /* ignore */ } } }, G.t('app.exit')),
        React.createElement(G.Button, { onClick: () => { this.setState({ error: null }) } }, '重试'),
      ),
    )
  }
}

/* ── 调色板 store（供 Monaco 等需要实时配色的组件订阅） ───────────────── */
const gufaPaletteListeners = new Set()
G.paletteStore = {
  value: null,
  set(next) {
    if (this.value === next) return
    try {
      if (this.value !== null && JSON.stringify(this.value) === JSON.stringify(next)) return
    } catch {
      /* 比较失败则照常发布 */
    }
    this.value = next
    try {
      if (window.__gufaStoreLogs === undefined) window.__gufaStoreLogs = 20
      if (window.__gufaStoreLogs > 0) {
        window.__gufaStoreLogs -= 1
        void G.api('dev.log', { message: `palette-store set listeners=${gufaPaletteListeners.size} isDark=${next !== null && next !== undefined && next.isDark === true} bg=${next !== null && next !== undefined ? String(next.bg) : '?'}` }).catch(() => {})
      }
    } catch {
      /* ignore */
    }
    for (const listener of [...gufaPaletteListeners]) {
      try {
        listener(next)
      } catch (error) {
        console.error('[gufa-code] palette listener failed', error)
      }
    }
  },
  subscribe(listener) {
    gufaPaletteListeners.add(listener)
    // 迟到的订阅者（组件挂载顺序晚于首次发布）立即拿到当前配色，否则会一直停留在 null
    if (this.value !== null && this.value !== undefined) {
      try {
        listener(this.value)
      } catch (error) {
        console.error('[gufa-code] palette subscriber failed', error)
      }
    }
    return () => gufaPaletteListeners.delete(listener)
  },
}

/** 按扩展名推断 Monaco language（Git Graph 打开提交内文件时用，覆盖常用类型）。 */
G.languageOfPath = function languageOfPath(path) {
  const name = String(path ?? '').split(/[\\/]/).pop() ?? ''
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return 'plaintext'
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    json: 'json', jsonc: 'json', json5: 'json', md: 'markdown', markdown: 'markdown',
    css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'xml', svg: 'xml',
    yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
    py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell',
    lua: 'lua', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go',
    rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql', swift: 'swift', kt: 'kotlin', dart: 'dart',
  }
  return map[lower.slice(dot + 1)] ?? 'plaintext'
}

/* ── 编辑器问题标记（语法错误/警告），供资源管理器 / 标签页 / 状态栏显示 ── */
const gufaProblemListeners = new Set()
G.problemsStore = {
  value: {},
  set(next) {
    const value = next !== null && typeof next === 'object' ? next : {}
    try {
      if (JSON.stringify(this.value) === JSON.stringify(value)) return
    } catch {
      /* 比较失败照常发布 */
    }
    this.value = value
    for (const listener of [...gufaProblemListeners]) {
      try {
        listener(value)
      } catch (error) {
        console.error('[gufa-code] problems listener failed', error)
      }
    }
  },
  subscribe(listener) {
    gufaProblemListeners.add(listener)
    if (this.value !== null && this.value !== undefined) {
      try {
        listener(this.value)
      } catch (error) {
        console.error('[gufa-code] problems subscriber failed', error)
      }
    }
    return () => gufaProblemListeners.delete(listener)
  },
}

/** 订阅当前编辑器的问题集合：{ [相对路径]: { errors, warnings } }。 */
G.useProblems = function useProblems() {
  const [problems, setProblems] = useState(() => G.problemsStore.value)
  useEffect(() => G.problemsStore.subscribe(setProblems), [])
  return problems
}

/** 按语言给默认缩进（detectIndentation 会优先跟随文件内容）。 */
G.indentForLanguage = function indentForLanguage(language) {
  const id = typeof language === 'string' ? language.toLowerCase() : ''
  if (id === 'makefile') return { tabSize: 4, insertSpaces: false }
  if (id === 'go' || id === 'rust' || id === 'c' || id === 'cpp' || id === 'csharp' || id === 'java' || id === 'kotlin' || id === 'swift' || id === 'scala' || id === 'php' || id === 'python') {
    return { tabSize: 4, insertSpaces: true }
  }
  if (id === 'ruby' || id === 'lua' || id === 'shell') return { tabSize: 2, insertSpaces: true }
  return { tabSize: 2, insertSpaces: true }
}

/** 订阅当前实色调色板（随滑动变祖档位 / 明暗切换实时更新）。 */
G.usePalette = function usePalette() {
  const [palette, setPalette] = useState(() => G.paletteStore.value)
  useEffect(() => G.paletteStore.subscribe(setPalette), [])
  return palette
}

/** 纯函数暴露（测试/控制台排查）。 */
G.__palette = { parseCssColor: G.parseCssColor, compositeColor: G.compositeColor, resolveSolidPalette: G.resolveSolidPalette, luminance: G.luminance, store: G.paletteStore }

/* ── 小工具 ───────────────────────────────────────────────────────────── */
G.cls = (...values) => values.filter(Boolean).join(' ')
G.basename = (path) => String(path ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
G.dirname = (path) => {
  const parts = String(path ?? '').split('/')
  parts.pop()
  return parts.join('/')
}
G.joinPath = (base, name) => {
  if (!base) return name
  if (!name) return base
  return `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`
}
G.formatBytes = (size) => {
  if (typeof size !== 'number') return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
G.shortPath = (path, max = 42) => {
  const value = String(path ?? '')
  return value.length > max ? `…${value.slice(-(max - 1))}` : value
}
/** 尝试从错误里取出人类可读信息。 */
G.errorText = (error) => {
  if (error === null || error === undefined) return ''
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  return String(error)
}

/* ── 样式 ─────────────────────────────────────────────────────────────── */
G.CSS = `
.gufa-overlay-root{position:fixed;inset:0;z-index:1;display:flex;box-sizing:border-box;background:var(--gufa-solid-bg, var(--dsw-alias-bg-base));pointer-events:auto;overflow:hidden}
.gufa-backdrop{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.gufa-backdrop-page{position:absolute;inset:0;transition:background-color 200ms linear}
.gufa-backdrop-glow{position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(ellipse 58% 72% at 78% 44%, rgba(205,142,82,0.32), rgba(120,72,42,0.12) 55%, transparent 76%),
    radial-gradient(ellipse 60% 50% at 92% 88%, rgba(150,88,52,0.22), transparent 70%),
    linear-gradient(90deg, transparent 52%, rgba(70,44,28,0.28) 100%)}
.gufa-backdrop-particles{position:absolute;inset:0;pointer-events:none;width:100%;height:100%}
.gufa-backdrop-portrait{position:absolute;top:50%;right:0;display:block;height:100%;width:auto;max-width:none;object-fit:contain;object-position:right center;
  transform-origin:100% 50%;pointer-events:none;transition:opacity 180ms linear;
  -webkit-mask-image:linear-gradient(90deg, transparent 0%, rgba(0,0,0,.18) 7%, rgba(0,0,0,.6) 18%, #000 34%, #000 100%);
  mask-image:linear-gradient(90deg, transparent 0%, rgba(0,0,0,.18) 7%, rgba(0,0,0,.6) 18%, #000 34%, #000 100%)}
.gufa-backdrop-fade{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,
    var(--gufa-solid-bg, #17191e) 0%,
    color-mix(in srgb, var(--gufa-solid-bg, #17191e) 88%, transparent) 24%,
    color-mix(in srgb, var(--gufa-solid-bg, #17191e) 46%, transparent) 48%,
    color-mix(in srgb, var(--gufa-solid-bg, #17191e) 12%, transparent) 72%,
    transparent 100%)}
.gufa-backdrop-portrait[data-leaving]{transition:opacity 520ms ease}
.gufa-strength{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border-radius:7px;border:1px solid var(--gufa-border);
  background:var(--gufa-layer2);color:var(--gufa-text-dim);-webkit-app-region:no-drag;flex:0 0 auto}
/* IDE 模式下：官方 MenuSurface/Menu 弹层通过 portal 挂到 body 且自身没有 z-index，
   会被全屏覆盖层（shell.overlay 的层叠上下文）盖住——表现为弹窗被聊天框/覆盖层遮挡。
   给这些语义节点一个高于覆盖层的层级（覆盖层 z-index 20、浮动会话 2147483040）。 */
html[data-gufa-usage] .gufa-sidepanel .gufa-panel-body{padding-bottom:calc(var(--gufa-usage-height, 0px) + 4px)}
[data-gufa-usage-dock="1"]{pointer-events:auto!important}
/* 停靠的侧栏 footer 里隐藏我们自己的「返回经典模式」按钮，避免与标题栏重复 */
[data-gufa-foot-dock="1"] .gufa-footer-action{display:none!important}
[data-gufa-foot-dock="1"]{padding:0 2px!important}
html[data-gufa-ide] [data-menu-material],
html[data-gufa-ide] [data-menu-backing],
html[data-gufa-ide] [role="menu"],
html[data-gufa-ide] [role="listbox"],
html[data-gufa-ide] [role="tooltip"],
html[data-gufa-ide] [role="dialog"] {
  z-index: 2147483060 !important;
}
.gufa-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:22px;padding:0 7px;border-radius:6px;
  border:0.5px solid var(--gufa-border-strong);background:var(--gufa-solid-layer, rgba(255,255,255,0.06));
  color:var(--gufa-solid-text, var(--dsw-alias-label-primary));font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.gufa-shortcuts-dialog{width:min(540px,94vw)}
.gufa-shortcuts-dialog .gufa-modal-body{max-height:min(60vh,520px);overflow:auto;padding:6px 14px}
.gufa-session-backdrop{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;
  background:color-mix(in srgb, #000 42%, transparent)}
.gufa-session-dialog{width:min(520px,92vw);color:var(--gufa-solid-text, var(--dsw-alias-label-primary));
  background:linear-gradient(160deg, var(--gufa-solid-layer2, var(--dsw-alias-bg-layer-2)) 0%, var(--gufa-solid-layer, var(--dsw-alias-bg-layer-1)) 100%)}
.gufa-session-dialog .gufa-modal-body{max-height:min(52vh,460px);overflow:auto;gap:4px;padding:10px 12px}
.gufa-session-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:34px;padding:0 10px;border:0;border-radius:8px;
  background:transparent;color:inherit;cursor:pointer;font-size:12.5px;text-align:left;white-space:nowrap;flex:0 0 auto}
.gufa-session-row:hover{background:color-mix(in srgb, var(--gufa-solid-text, #888) 9%, transparent)}
.gufa-session-row[data-current]{background:color-mix(in srgb, var(--gufa-accent) 16%, transparent)}
.gufa-session-group{display:flex;flex-direction:column;padding:2px 4px}
.gufa-session-group-head{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text-dim);cursor:pointer;font:inherit;font-size:11.5px;text-align:left}
.gufa-session-group-head:hover{background:var(--gufa-hover)}
.gufa-session-group-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gufa-text);font-weight:600}
.gufa-session-group-count{font-size:10.5px;opacity:.6;font-variant-numeric:tabular-nums}
.gufa-session-group[data-current] .gufa-session-group-head{color:var(--gufa-text)}
.gufa-session-group .gufa-session-row{margin-left:10px}
.gufa-session-workspace-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--gufa-border);background:var(--gufa-layer2);
  color:var(--gufa-text-dim);border-radius:7px;padding:2px 8px;font:inherit;font-size:11.5px;cursor:pointer;max-width:260px}
.gufa-session-workspace-btn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-session-workspace-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-workspace-picker{display:flex;flex-direction:column;gap:2px;padding:6px 10px;max-height:220px;overflow:auto;
  border-top:1px solid var(--gufa-border);border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-session-workspace-option{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.gufa-session-workspace-option:hover{background:var(--gufa-hover)}
.gufa-session-workspace-option[data-current]{background:var(--gufa-active)}
.gufa-session-workspace-option-title{flex:0 0 auto;font-weight:550}
.gufa-session-workspace-option-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--gufa-text-dim);font-size:10.5px;text-align:right}
.gufa-session-workspace{font-size:11px;color:var(--gufa-text-dim);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-row-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.gufa-session-row-when{flex:0 0 auto;font-size:10.5px;color:var(--gufa-solid-text-dim, var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}
.gufa-strength-range{-webkit-appearance:none;appearance:none;width:86px;height:3px;border-radius:2px;margin:0;cursor:pointer;outline:none;
  background:color-mix(in srgb, var(--gufa-text) 22%, transparent)}
/* IDE 模式下：官方 MenuSurface/Menu 弹层通过 portal 挂到 body 且自身没有 z-index，
   会被全屏覆盖层（shell.overlay 的层叠上下文）盖住——表现为弹窗被聊天框/覆盖层遮挡。
   给这些语义节点一个高于覆盖层的层级（覆盖层 z-index 20、浮动会话 2147483040）。 */
html[data-gufa-usage] .gufa-sidepanel .gufa-panel-body{padding-bottom:calc(var(--gufa-usage-height, 0px) + 4px)}
[data-gufa-usage-dock="1"]{pointer-events:auto!important}
/* 停靠的侧栏 footer 里隐藏我们自己的「返回经典模式」按钮，避免与标题栏重复 */
[data-gufa-foot-dock="1"] .gufa-footer-action{display:none!important}
[data-gufa-foot-dock="1"]{padding:0 2px!important}
html[data-gufa-ide] [data-menu-material],
html[data-gufa-ide] [data-menu-backing],
html[data-gufa-ide] [role="menu"],
html[data-gufa-ide] [role="listbox"],
html[data-gufa-ide] [role="tooltip"],
html[data-gufa-ide] [role="dialog"] {
  z-index: 2147483060 !important;
}
.gufa-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:22px;padding:0 7px;border-radius:6px;
  border:0.5px solid var(--gufa-border-strong);background:var(--gufa-solid-layer, rgba(255,255,255,0.06));
  color:var(--gufa-solid-text, var(--dsw-alias-label-primary));font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.gufa-shortcuts-dialog{width:min(540px,94vw)}
.gufa-shortcuts-dialog .gufa-modal-body{max-height:min(60vh,520px);overflow:auto;padding:6px 14px}
.gufa-session-backdrop{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;
  background:color-mix(in srgb, #000 42%, transparent)}
.gufa-session-dialog{width:min(520px,92vw);color:var(--gufa-solid-text, var(--dsw-alias-label-primary));
  background:linear-gradient(160deg, var(--gufa-solid-layer2, var(--dsw-alias-bg-layer-2)) 0%, var(--gufa-solid-layer, var(--dsw-alias-bg-layer-1)) 100%)}
.gufa-session-dialog .gufa-modal-body{max-height:min(52vh,460px);overflow:auto;gap:4px;padding:10px 12px}
.gufa-session-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:34px;padding:0 10px;border:0;border-radius:8px;
  background:transparent;color:inherit;cursor:pointer;font-size:12.5px;text-align:left;white-space:nowrap;flex:0 0 auto}
.gufa-session-row:hover{background:color-mix(in srgb, var(--gufa-solid-text, #888) 9%, transparent)}
.gufa-session-row[data-current]{background:color-mix(in srgb, var(--gufa-accent) 16%, transparent)}
.gufa-session-group{display:flex;flex-direction:column;padding:2px 4px}
.gufa-session-group-head{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text-dim);cursor:pointer;font:inherit;font-size:11.5px;text-align:left}
.gufa-session-group-head:hover{background:var(--gufa-hover)}
.gufa-session-group-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gufa-text);font-weight:600}
.gufa-session-group-count{font-size:10.5px;opacity:.6;font-variant-numeric:tabular-nums}
.gufa-session-group[data-current] .gufa-session-group-head{color:var(--gufa-text)}
.gufa-session-group .gufa-session-row{margin-left:10px}
.gufa-session-workspace-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--gufa-border);background:var(--gufa-layer2);
  color:var(--gufa-text-dim);border-radius:7px;padding:2px 8px;font:inherit;font-size:11.5px;cursor:pointer;max-width:260px}
.gufa-session-workspace-btn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-session-workspace-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-workspace-picker{display:flex;flex-direction:column;gap:2px;padding:6px 10px;max-height:220px;overflow:auto;
  border-top:1px solid var(--gufa-border);border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-session-workspace-option{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.gufa-session-workspace-option:hover{background:var(--gufa-hover)}
.gufa-session-workspace-option[data-current]{background:var(--gufa-active)}
.gufa-session-workspace-option-title{flex:0 0 auto;font-weight:550}
.gufa-session-workspace-option-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--gufa-text-dim);font-size:10.5px;text-align:right}
.gufa-session-workspace{font-size:11px;color:var(--gufa-text-dim);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-row-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.gufa-session-row-when{flex:0 0 auto;font-size:10.5px;color:var(--gufa-solid-text-dim, var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}
.gufa-strength-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:11px;height:11px;border-radius:50%;
  background:var(--gufa-accent);border:2px solid var(--gufa-layer);box-shadow:0 1px 3px color-mix(in srgb, #000 30%, transparent);cursor:grab}
/* IDE 模式下：官方 MenuSurface/Menu 弹层通过 portal 挂到 body 且自身没有 z-index，
   会被全屏覆盖层（shell.overlay 的层叠上下文）盖住——表现为弹窗被聊天框/覆盖层遮挡。
   给这些语义节点一个高于覆盖层的层级（覆盖层 z-index 20、浮动会话 2147483040）。 */
html[data-gufa-usage] .gufa-sidepanel .gufa-panel-body{padding-bottom:calc(var(--gufa-usage-height, 0px) + 4px)}
[data-gufa-usage-dock="1"]{pointer-events:auto!important}
/* 停靠的侧栏 footer 里隐藏我们自己的「返回经典模式」按钮，避免与标题栏重复 */
[data-gufa-foot-dock="1"] .gufa-footer-action{display:none!important}
[data-gufa-foot-dock="1"]{padding:0 2px!important}
html[data-gufa-ide] [data-menu-material],
html[data-gufa-ide] [data-menu-backing],
html[data-gufa-ide] [role="menu"],
html[data-gufa-ide] [role="listbox"],
html[data-gufa-ide] [role="tooltip"],
html[data-gufa-ide] [role="dialog"] {
  z-index: 2147483060 !important;
}
.gufa-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:22px;padding:0 7px;border-radius:6px;
  border:0.5px solid var(--gufa-border-strong);background:var(--gufa-solid-layer, rgba(255,255,255,0.06));
  color:var(--gufa-solid-text, var(--dsw-alias-label-primary));font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.gufa-shortcuts-dialog{width:min(540px,94vw)}
.gufa-shortcuts-dialog .gufa-modal-body{max-height:min(60vh,520px);overflow:auto;padding:6px 14px}
.gufa-session-backdrop{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;
  background:color-mix(in srgb, #000 42%, transparent)}
.gufa-session-dialog{width:min(520px,92vw);color:var(--gufa-solid-text, var(--dsw-alias-label-primary));
  background:linear-gradient(160deg, var(--gufa-solid-layer2, var(--dsw-alias-bg-layer-2)) 0%, var(--gufa-solid-layer, var(--dsw-alias-bg-layer-1)) 100%)}
.gufa-session-dialog .gufa-modal-body{max-height:min(52vh,460px);overflow:auto;gap:4px;padding:10px 12px}
.gufa-session-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:34px;padding:0 10px;border:0;border-radius:8px;
  background:transparent;color:inherit;cursor:pointer;font-size:12.5px;text-align:left;white-space:nowrap;flex:0 0 auto}
.gufa-session-row:hover{background:color-mix(in srgb, var(--gufa-solid-text, #888) 9%, transparent)}
.gufa-session-row[data-current]{background:color-mix(in srgb, var(--gufa-accent) 16%, transparent)}
.gufa-session-group{display:flex;flex-direction:column;padding:2px 4px}
.gufa-session-group-head{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text-dim);cursor:pointer;font:inherit;font-size:11.5px;text-align:left}
.gufa-session-group-head:hover{background:var(--gufa-hover)}
.gufa-session-group-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gufa-text);font-weight:600}
.gufa-session-group-count{font-size:10.5px;opacity:.6;font-variant-numeric:tabular-nums}
.gufa-session-group[data-current] .gufa-session-group-head{color:var(--gufa-text)}
.gufa-session-group .gufa-session-row{margin-left:10px}
.gufa-session-workspace-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--gufa-border);background:var(--gufa-layer2);
  color:var(--gufa-text-dim);border-radius:7px;padding:2px 8px;font:inherit;font-size:11.5px;cursor:pointer;max-width:260px}
.gufa-session-workspace-btn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-session-workspace-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-workspace-picker{display:flex;flex-direction:column;gap:2px;padding:6px 10px;max-height:220px;overflow:auto;
  border-top:1px solid var(--gufa-border);border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-session-workspace-option{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.gufa-session-workspace-option:hover{background:var(--gufa-hover)}
.gufa-session-workspace-option[data-current]{background:var(--gufa-active)}
.gufa-session-workspace-option-title{flex:0 0 auto;font-weight:550}
.gufa-session-workspace-option-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--gufa-text-dim);font-size:10.5px;text-align:right}
.gufa-session-workspace{font-size:11px;color:var(--gufa-text-dim);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-row-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.gufa-session-row-when{flex:0 0 auto;font-size:10.5px;color:var(--gufa-solid-text-dim, var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}
.gufa-strength-range:active::-webkit-slider-thumb{cursor:grabbing}
.gufa-strength-value{font-size:10.5px;min-width:30px;text-align:right;font-variant-numeric:tabular-nums}
/* IDE 模式下：官方 MenuSurface/Menu 弹层通过 portal 挂到 body 且自身没有 z-index，
   会被全屏覆盖层（shell.overlay 的层叠上下文）盖住——表现为弹窗被聊天框/覆盖层遮挡。
   给这些语义节点一个高于覆盖层的层级（覆盖层 z-index 20、浮动会话 2147483040）。 */
html[data-gufa-usage] .gufa-sidepanel .gufa-panel-body{padding-bottom:calc(var(--gufa-usage-height, 0px) + 4px)}
[data-gufa-usage-dock="1"]{pointer-events:auto!important}
/* 停靠的侧栏 footer 里隐藏我们自己的「返回经典模式」按钮，避免与标题栏重复 */
[data-gufa-foot-dock="1"] .gufa-footer-action{display:none!important}
[data-gufa-foot-dock="1"]{padding:0 2px!important}
html[data-gufa-ide] [data-menu-material],
html[data-gufa-ide] [data-menu-backing],
html[data-gufa-ide] [role="menu"],
html[data-gufa-ide] [role="listbox"],
html[data-gufa-ide] [role="tooltip"],
html[data-gufa-ide] [role="dialog"] {
  z-index: 2147483060 !important;
}
.gufa-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:22px;padding:0 7px;border-radius:6px;
  border:0.5px solid var(--gufa-border-strong);background:var(--gufa-solid-layer, rgba(255,255,255,0.06));
  color:var(--gufa-solid-text, var(--dsw-alias-label-primary));font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.gufa-shortcuts-dialog{width:min(540px,94vw)}
.gufa-shortcuts-dialog .gufa-modal-body{max-height:min(60vh,520px);overflow:auto;padding:6px 14px}
.gufa-session-backdrop{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;
  background:color-mix(in srgb, #000 42%, transparent)}
.gufa-session-dialog{width:min(520px,92vw);color:var(--gufa-solid-text, var(--dsw-alias-label-primary));
  background:linear-gradient(160deg, var(--gufa-solid-layer2, var(--dsw-alias-bg-layer-2)) 0%, var(--gufa-solid-layer, var(--dsw-alias-bg-layer-1)) 100%)}
.gufa-session-dialog .gufa-modal-body{max-height:min(52vh,460px);overflow:auto;gap:4px;padding:10px 12px}
.gufa-session-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:34px;padding:0 10px;border:0;border-radius:8px;
  background:transparent;color:inherit;cursor:pointer;font-size:12.5px;text-align:left;white-space:nowrap;flex:0 0 auto}
.gufa-session-row:hover{background:color-mix(in srgb, var(--gufa-solid-text, #888) 9%, transparent)}
.gufa-session-row[data-current]{background:color-mix(in srgb, var(--gufa-accent) 16%, transparent)}
.gufa-session-group{display:flex;flex-direction:column;padding:2px 4px}
.gufa-session-group-head{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text-dim);cursor:pointer;font:inherit;font-size:11.5px;text-align:left}
.gufa-session-group-head:hover{background:var(--gufa-hover)}
.gufa-session-group-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gufa-text);font-weight:600}
.gufa-session-group-count{font-size:10.5px;opacity:.6;font-variant-numeric:tabular-nums}
.gufa-session-group[data-current] .gufa-session-group-head{color:var(--gufa-text)}
.gufa-session-group .gufa-session-row{margin-left:10px}
.gufa-session-workspace-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--gufa-border);background:var(--gufa-layer2);
  color:var(--gufa-text-dim);border-radius:7px;padding:2px 8px;font:inherit;font-size:11.5px;cursor:pointer;max-width:260px}
.gufa-session-workspace-btn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-session-workspace-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-workspace-picker{display:flex;flex-direction:column;gap:2px;padding:6px 10px;max-height:220px;overflow:auto;
  border-top:1px solid var(--gufa-border);border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-session-workspace-option{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.gufa-session-workspace-option:hover{background:var(--gufa-hover)}
.gufa-session-workspace-option[data-current]{background:var(--gufa-active)}
.gufa-session-workspace-option-title{flex:0 0 auto;font-weight:550}
.gufa-session-workspace-option-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--gufa-text-dim);font-size:10.5px;text-align:right}
.gufa-session-workspace{font-size:11px;color:var(--gufa-text-dim);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-session-row-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.gufa-session-row-when{flex:0 0 auto;font-size:10.5px;color:var(--gufa-solid-text-dim, var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}
.gufa-strength-range
  -webkit-mask-image:linear-gradient(90deg, transparent 0%, rgba(0,0,0,.12) 6%, rgba(0,0,0,.55) 16%, #000 34%, #000 100%);
  mask-image:linear-gradient(90deg, transparent 0%, rgba(0,0,0,.12) 6%, rgba(0,0,0,.55) 16%, #000 34%, #000 100%)}
.gufa-backdrop-scrim{position:absolute;inset:0;
  background:linear-gradient(90deg, var(--liang-mask-strong, transparent) 0%, var(--liang-mask-soft, transparent) 38%, transparent 66%),
             linear-gradient(var(--liang-mask-base, transparent), var(--liang-mask-base, transparent))}
.gufa-shell{position:relative;z-index:1;flex:1 1 auto;display:flex;flex-direction:column;height:100%;min-height:0;width:100%;min-width:0}
html[data-windows-titlebar] .gufa-overlay-root{padding-top:var(--dsh-windows-titlebar-height,0px)}
.gufa-root{--gufa-accent:#c0392b;--gufa-accent-soft:color-mix(in srgb, var(--gufa-accent) 16%, transparent);
  --gufa-bg:var(--gufa-solid-bg, var(--dsw-alias-bg-base));--gufa-layer:var(--gufa-solid-layer, var(--dsw-alias-bg-layer-1));--gufa-layer2:var(--gufa-solid-layer2, var(--dsw-alias-bg-layer-2));
  --gufa-solid-overlay-bg:var(--gufa-solid-overlay, var(--dsw-alias-bg-overlay));
  --gufa-border:var(--dsw-alias-border-l1);--gufa-border-strong:var(--dsw-alias-border-l2);
  --gufa-text:var(--dsw-alias-label-primary);--gufa-text-dim:var(--dsw-alias-label-secondary);
  --gufa-hover:color-mix(in srgb, var(--gufa-text) 7%, transparent);
  --gufa-active:color-mix(in srgb, var(--gufa-text) 11%, transparent);
  position:relative;display:flex;flex-direction:column;height:100%;min-height:0;width:100%;overflow:hidden;
  background:var(--gufa-bg);color:var(--gufa-text);font-size:13px;line-height:1.45}
.gufa-root *{box-sizing:border-box}
.gufa-root button{font:inherit;color:inherit}
.gufa-titlebar{display:flex;align-items:center;gap:10px;height:44px;padding:0 10px 0 14px;flex:0 0 auto;
  border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer);-webkit-app-region:drag}
html[data-platform=darwin] .gufa-titlebar{height:48px;padding-left:86px}
html[data-platform=darwin][data-fullscreen] .gufa-titlebar{height:44px;padding-left:16px}
.gufa-titlebar button,.gufa-titlebar input,.gufa-titlebar .gufa-project,.gufa-titlebar-action{-webkit-app-region:no-drag}
.gufa-brand{display:flex;align-items:center;gap:8px;min-width:0}
.gufa-brand-logo{width:24px;height:24px;flex:0 0 auto}
.gufa-brand-name{font-weight:650;font-size:14px;letter-spacing:.02em;white-space:nowrap}
.gufa-brand-sub{font-size:10px;letter-spacing:.18em;color:var(--gufa-text-dim);white-space:nowrap}
.gufa-project{appearance:none;border:0;background:transparent;font:inherit;color:inherit;cursor:pointer}
.gufa-project:hover{background:var(--gufa-hover)}
.gufa-workspace-row{height:auto;min-height:38px;padding:5px 8px}
.gufa-workspace-title{display:block;font-size:12px;line-height:1.3}
.gufa-workspace-path{display:block;font-size:10.5px;color:var(--gufa-text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-project{display:flex;align-items:center;gap:6px;min-width:0;margin-left:6px;padding:3px 9px;border-radius:7px;
  border:1px solid var(--gufa-border);background:var(--gufa-layer2);color:var(--gufa-text-dim);font-size:12px}
.gufa-project-name{color:var(--gufa-text);font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.gufa-titlebar-spacer{flex:1 1 auto}
.gufa-titlebar-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.gufa-body{flex:1 1 auto;display:flex;min-height:0;min-width:0;position:relative}
.gufa-activity{flex:0 0 48px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;
  border-right:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-activity-btn{width:38px;height:38px;border:0;border-radius:9px;background:transparent;color:var(--gufa-text-dim);
  display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative}
.gufa-activity-btn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-activity-btn[data-active]{background:var(--gufa-active);color:var(--gufa-text)}
.gufa-activity-btn[data-active]:before{content:"";position:absolute;left:-5px;top:9px;bottom:9px;width:3px;border-radius:2px;background:var(--gufa-accent)}
.gufa-activity-fill{flex:1 1 auto}
.gufa-sidepanel{flex:0 0 auto;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--gufa-border);background:var(--gufa-bg)}
.gufa-panel-head{display:flex;align-items:center;gap:6px;height:34px;padding:0 6px 0 12px;flex:0 0 auto;
  font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gufa-text-dim);border-bottom:1px solid var(--gufa-border)}
.gufa-panel-head-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-panel-body{flex:1 1 auto;overflow:auto;min-height:0}
.gufa-iconbtn{width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--gufa-text-dim);
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto}
.gufa-iconbtn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-iconbtn[data-active]{background:var(--gufa-active);color:var(--gufa-text)}
.gufa-iconbtn:disabled{opacity:.4;cursor:default}
.gufa-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:7px;cursor:pointer;
  border:1px solid var(--gufa-border-strong);background:var(--gufa-layer2);color:var(--gufa-text);font-size:12px;white-space:nowrap}
.gufa-btn:hover{border-color:var(--gufa-accent);color:var(--gufa-text)}
.gufa-btn[data-primary]{background:var(--gufa-accent);border-color:var(--gufa-accent);color:#fff}
.gufa-btn[data-primary]:hover{background:color-mix(in srgb, var(--gufa-accent) 86%, #000)}
.gufa-btn:disabled{opacity:.5;cursor:default}
.gufa-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--gufa-bg)}
.gufa-main-row{flex:1 1 auto;display:flex;min-height:0;min-width:0}
.gufa-editor-area{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0}
.gufa-tabs{display:flex;align-items:stretch;height:36px;flex:0 0 auto;overflow-x:auto;overflow-y:hidden;
  border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer);scrollbar-width:none}
.gufa-tabs::-webkit-scrollbar{display:none}
.gufa-tab{display:flex;align-items:center;gap:7px;padding:0 8px 0 12px;border:0;border-right:1px solid var(--gufa-border);
  background:transparent;color:var(--gufa-text-dim);cursor:pointer;font-size:12px;white-space:nowrap;max-width:220px;flex:0 0 auto}
.gufa-tab:hover{background:var(--gufa-hover)}
.gufa-tab[data-active]{background:var(--gufa-bg);color:var(--gufa-text);box-shadow:inset 0 2px 0 var(--gufa-accent)}
.gufa-tab-name{overflow:hidden;text-overflow:ellipsis}
.gufa-tab-dot{width:7px;height:7px;border-radius:50%;background:var(--gufa-accent);flex:0 0 auto}
.gufa-tab-close{width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;
  display:flex;align-items:center;justify-content:center;opacity:.65;flex:0 0 auto}
.gufa-tab-close:hover{background:var(--gufa-active);opacity:1}
.gufa-breadcrumb{display:flex;align-items:center;gap:4px;height:26px;padding:0 12px;flex:0 0 auto;font-size:11.5px;color:var(--gufa-text-dim);
  border-bottom:1px solid var(--gufa-border);overflow:hidden;white-space:nowrap}
.gufa-breadcrumb b{font-weight:500;color:var(--gufa-text)}
.gufa-editor-host{flex:1 1 auto;position:relative;min-height:0;min-width:0;overflow:hidden}
.gufa-editor-fallback{position:absolute;inset:0;overflow:auto;margin:0;padding:14px 18px;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;tab-size:2}
.gufa-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;padding:28px;
  color:var(--gufa-text-dim);text-align:center}
.gufa-empty-title{font-size:14px;font-weight:600;color:var(--gufa-text)}
.gufa-empty-hint{font-size:12px;max-width:340px;line-height:1.6}
.gufa-seal{width:54px;height:54px;opacity:.85}
.gufa-chatpane{flex:0 0 auto;display:flex;flex-direction:column;min-width:0;border-left:1px solid var(--gufa-border);background:var(--gufa-bg);position:relative}
.gufa-root[data-backdrop="on"] .gufa-chatpane:before{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;
  background:linear-gradient(90deg, color-mix(in srgb, var(--gufa-bg) 62%, transparent) 0%, color-mix(in srgb, var(--gufa-bg) 18%, transparent) 46%, transparent 100%)}
.gufa-root[data-backdrop="on"] .gufa-chatdock{position:relative;z-index:1}
.gufa-statusbar{flex:0 0 auto;display:flex;align-items:center;gap:14px;height:24px;padding:0 12px;
  border-top:1px solid var(--gufa-border);background:var(--gufa-layer);color:var(--gufa-text-dim);font-size:11px}
.gufa-status-item{display:inline-flex;align-items:center;gap:5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gufa-status-fill{flex:1 1 auto}
.gufa-splitter{flex:0 0 5px;cursor:col-resize;background:transparent;position:relative;z-index:2}
.gufa-splitter:after{content:"";position:absolute;top:0;bottom:0;left:2px;width:1px;background:var(--gufa-border)}
.gufa-splitter:hover:after,.gufa-splitter[data-dragging]:after{background:var(--gufa-accent);width:2px;left:1.5px}
.gufa-hsplitter{flex:0 0 5px;cursor:row-resize;position:relative}
.gufa-hsplitter:after{content:"";position:absolute;left:0;right:0;top:2px;height:1px;background:var(--gufa-border)}
.gufa-hsplitter:hover:after{background:var(--gufa-accent);height:2px;top:1.5px}
.gufa-tree{display:flex;flex-direction:column;padding:4px 0}
.gufa-tree-row{display:flex;align-items:center;gap:5px;height:24px;padding:0 8px 0 8px;border:0;background:transparent;
  color:var(--gufa-text);cursor:pointer;text-align:left;font-size:12.5px;white-space:nowrap;min-width:0;width:100%}
.gufa-tree-row:hover{background:var(--gufa-hover)}
.gufa-tree-row[data-selected]{background:var(--gufa-active)}
.gufa-tree-row[data-kind="dir"]{color:var(--gufa-text)}
.gufa-tree-name{overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0}
.gufa-explorer-notice{margin:4px 10px 0;padding:3px 8px;border-radius:6px;font-size:11px;line-height:1.5;color:var(--gufa-text);
  background:color-mix(in srgb, var(--gufa-accent) 14%, transparent);border:0.5px solid color-mix(in srgb, var(--gufa-accent) 40%, transparent);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-tree-chevron{width:14px;flex:0 0 auto;opacity:.7;display:flex;align-items:center;justify-content:center}
.gufa-tree-icon{width:15px;flex:0 0 auto;opacity:.85;display:flex;align-items:center;justify-content:center}
.gufa-tree-badge{font-size:10px;color:var(--gufa-accent);flex:0 0 auto;font-weight:600}
.gufa-panel-section{display:flex;flex-direction:column;padding:8px 10px;gap:8px}
.gufa-row{display:flex;align-items:center;gap:8px;min-width:0}
.gufa-input{width:100%;min-width:0;height:28px;padding:0 9px;border-radius:7px;border:1px solid var(--gufa-border-strong);
  background:var(--gufa-layer);color:var(--gufa-text);font:inherit;font-size:12px;outline:none}
.gufa-input:focus{border-color:var(--gufa-accent)}
.gufa-input::placeholder{color:var(--gufa-text-dim)}
.gufa-textarea{width:100%;min-height:64px;resize:vertical;padding:7px 9px;border-radius:7px;border:1px solid var(--gufa-border-strong);
  background:var(--gufa-layer);color:var(--gufa-text);font:inherit;font-size:12px;outline:none}
.gufa-textarea:focus{border-color:var(--gufa-accent)}
.gufa-git-change{display:flex;align-items:center;gap:7px;height:26px;padding:0 8px;cursor:pointer;border-radius:6px;min-width:0}
.gufa-git-change:hover{background:var(--gufa-hover)}
.gufa-git-status{width:15px;flex:0 0 auto;text-align:center;font-weight:700;font-size:11px;color:var(--gufa-accent)}
.gufa-git-status[data-kind="D"]{color:var(--dsw-alias-state-error-primary)}
.gufa-git-status[data-kind="??"]{color:var(--dsw-alias-state-success-primary)}
.gufa-git-path{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;direction:rtl;text-align:left}
.gufa-badge{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 5px;border-radius:9px;
  background:var(--gufa-accent);color:#fff;font-size:10px;font-weight:700}
.gufa-ssh-host{display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;cursor:pointer;border-radius:6px;min-width:0}
.gufa-ssh-host:hover{background:var(--gufa-hover)}
.gufa-ssh-alias{font-weight:600;font-size:12px;white-space:nowrap}
.gufa-ssh-hostname{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gufa-text-dim);font-size:11px;direction:rtl;text-align:left}
.gufa-hint{font-size:11px;color:var(--gufa-text-dim);line-height:1.6}
.gufa-error-fallback{position:absolute;inset:0;z-index:130;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px;
  background:var(--gufa-solid-bg, #17191e);color:var(--gufa-solid-text, #e8eaed);text-align:center}
.gufa-error-fallback-title{font-size:14px;font-weight:600}
.gufa-error-fallback-detail{max-width:min(720px,90vw);max-height:40vh;overflow:auto;margin:0;padding:10px 12px;border-radius:8px;border:1px solid var(--gufa-border-strong);
  background:var(--gufa-solid-layer2, #23252a);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;text-align:left;white-space:pre-wrap}
.gufa-error-fallback-actions{display:flex;gap:10px}
/* Monaco diff 的红绿兜底：直接覆盖差异行/字符的 class，不依赖主题 token（皮肤可能覆盖变量）。 */
.gufa-root .monaco-diff-editor .line-insert{background-color:rgba(46,160,67,0.42)!important}
.gufa-root .monaco-diff-editor .line-delete{background-color:rgba(248,81,73,0.42)!important}
.gufa-root .monaco-diff-editor .char-insert{background-color:rgba(63,185,80,0.62)!important;border-radius:2px}
.gufa-root .monaco-diff-editor .char-delete{background-color:rgba(248,81,73,0.62)!important;border-radius:2px}
.gufa-root .monaco-diff-editor .gutter-insert{background-color:rgba(46,160,67,0.85)!important}
.gufa-root .monaco-diff-editor .gutter-delete{background-color:rgba(248,81,73,0.85)!important}
.gufa-root .monaco-diff-editor .inline-deleted-margin-view-zone{background-color:rgba(248,81,73,0.28)!important}
.gufa-root .monaco-diff-editor .inline-deleted-text{background-color:rgba(248,81,73,0.42)!important}
.gufa-graph-view{position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--gufa-bg,#111)}
.gufa-graph-head{display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;flex:0 0 auto;border-bottom:0.5px solid var(--gufa-border);font-size:12px}
.gufa-graph-branch{display:inline-flex;align-items:center;gap:4px;color:var(--gufa-text-dim);font-size:11.5px}
.gufa-graph-loading{display:flex;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--gufa-text-dim);font-size:12px}
.gufa-graph-detail{display:flex;align-items:center;gap:10px;flex:0 0 auto;padding:6px 12px;border-bottom:0.5px solid var(--gufa-border);font-size:11.5px;background:var(--gufa-solid-layer, rgba(255,255,255,0.04))}
.gufa-graph-detail-hash{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--gufa-accent)}
.gufa-graph-detail-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-graph-split{flex:1 1 auto;min-height:0;display:flex;align-items:stretch}
.gufa-graph-body{flex:1 1 auto;min-width:0;min-height:0;overflow:auto}
.gufa-graph-aside{flex:0 0 340px;min-width:0;border-left:0.5px solid var(--gufa-border);display:flex;flex-direction:column;min-height:0;overflow:auto}
.gufa-graph-aside-empty{padding:16px 14px;color:var(--gufa-text-dim);font-size:12px}
.gufa-graph-commit{padding:10px 12px 8px;border-bottom:0.5px solid var(--gufa-border);display:flex;flex-direction:column;gap:6px}
.gufa-graph-commit-subject{font-size:13px;line-height:1.4;word-break:break-word}
.gufa-graph-commit-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--gufa-text-dim)}
.gufa-graph-commit-meta code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--gufa-accent)}
.gufa-graph-commit-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.gufa-graph-files-head{display:flex;align-items:center;gap:6px;padding:8px 12px 4px;font-size:11.5px;color:var(--gufa-text-dim)}
.gufa-graph-files-count{padding:0 6px;border-radius:8px;background:color-mix(in srgb, var(--gufa-accent) 18%, transparent);color:var(--gufa-accent);font-size:10.5px}
.gufa-graph-files{display:flex;flex-direction:column;padding:2px 6px 10px}
.gufa-graph-file{display:flex;align-items:center;gap:8px;appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;
  font:inherit;font-size:12px;padding:4px 6px;border-radius:6px;text-align:left;min-width:0}
.gufa-graph-file:hover{background:var(--gufa-hover, rgba(255,255,255,0.06))}
.gufa-graph-file-status{flex:0 0 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--gufa-text-dim)}
.gufa-graph-file-status[data-kind="A"]{color:#3fb950}
.gufa-graph-file-status[data-kind="D"]{color:#f85149}
.gufa-graph-file-status[data-kind="M"]{color:#e5c07b}
.gufa-graph-file-status[data-kind="R"]{color:#61afef}
.gufa-graph-file-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-graph-row{display:flex;align-items:center;gap:8px;height:26px;padding:0 10px;cursor:pointer;font-size:12px;white-space:nowrap}
.gufa-graph-row:hover{background:var(--gufa-hover, rgba(255,255,255,0.05))}
.gufa-graph-row[data-selected]{background:color-mix(in srgb, var(--gufa-accent) 16%, transparent)}
.gufa-graph-svg{flex:0 0 auto;display:inline-flex;height:26px}
.gufa-graph-refs{display:inline-flex;gap:4px;flex:0 0 auto;max-width:40%;overflow:hidden}
.gufa-graph-ref{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:8px;font-size:10.5px;
  border:0.5px solid color-mix(in srgb, var(--gufa-accent) 45%, transparent);color:var(--gufa-accent);white-space:nowrap}
.gufa-graph-ref[data-current]{background:color-mix(in srgb, var(--gufa-accent) 18%, transparent)}
.gufa-graph-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.gufa-graph-meta{flex:0 0 auto;font-size:11px;color:var(--gufa-text-dim)}
.gufa-branch-dialog-backdrop{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.42);backdrop-filter:blur(2px)}
.gufa-branch-dialog{width:min(380px,92vw);max-height:min(72vh,560px);display:flex;flex-direction:column;
  border-radius:12px;border:1px solid var(--gufa-border-strong);background:var(--gufa-solid-overlay-bg);
  box-shadow:0 24px 60px rgba(0,0,0,.45);overflow:hidden}
.gufa-branch-dialog-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:0.5px solid var(--gufa-border)}
.gufa-branch-dialog-current{font-size:11px;color:var(--gufa-text-dim);margin-left:4px}
.gufa-branch-dialog-list{flex:1 1 auto;min-height:0;overflow:auto;padding:6px}
.gufa-branch-row{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:7px;
  background:transparent;color:var(--gufa-text);cursor:pointer;font-size:12px;text-align:left}
.gufa-branch-row:hover{background:var(--gufa-hover)}
.gufa-branch-row[data-current]{background:color-mix(in srgb, var(--gufa-accent) 16%, transparent)}
.gufa-branch-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-branch-tag{font-size:10px;padding:1px 6px;border-radius:8px;color:var(--gufa-accent);
  background:color-mix(in srgb, var(--gufa-accent) 18%, transparent)}
.gufa-branch-dialog-new{display:flex;gap:6px;padding:10px 12px;border-top:0.5px solid var(--gufa-border)}
.gufa-branch-menu .gufa-menu-item[data-current]{background:color-mix(in srgb, var(--gufa-accent) 16%, transparent)}
/* IDE 模式下第三方皮肤（滑动变祖等）的背景层会持续跑 canvas 动画；IDE 自己已渲染背景，直接隐藏以省性能 */
/* IDE 模式下第三方皮肤背景层拿不到稳定渲染（停靠/层级问题），统一隐藏，由我们的背景层+粒子复刻 */
html[data-gufa-ide] .liang-skin-backdrop{display:none!important}
/* 右侧 AI 面板会挡住皮肤原位置的人像：IDE 模式下把人像往中间挪，让编辑区也能看到 */
.gufa-root[data-backdrop="on"] .gufa-backdrop-portrait{right:0;left:26%;width:74%;height:108%;opacity:.9;
  object-fit:cover;object-position:58% 40%;
  -webkit-mask-image:linear-gradient(90deg, transparent 0%, rgba(0,0,0,.28) 10%, rgba(0,0,0,.8) 28%, #000 42%, #000 100%);
  mask-image:linear-gradient(90deg, transparent 0%, rgba(0,0,0,.28) 10%, rgba(0,0,0,.8) 28%, #000 42%, #000 100%)}
.gufa-diff-toolbar{position:absolute;top:0;left:0;right:0;height:30px;z-index:6;display:flex;align-items:center;gap:4px;
  padding:0 8px;border-bottom:0.5px solid var(--gufa-border);background:var(--gufa-solid-layer, var(--gufa-bg))}
.gufa-sync{appearance:none;border:0;background:transparent;color:var(--gufa-accent);cursor:pointer;font:inherit;font-size:11.5px;
  padding:1px 5px;border-radius:5px;font-variant-numeric:tabular-nums}
.gufa-sync:hover:not(:disabled){background:color-mix(in srgb, var(--gufa-accent) 14%, transparent)}
.gufa-sync:disabled{opacity:.5;cursor:default}
.gufa-git-sync{display:inline-flex;align-items:center;gap:2px;appearance:none;border:0;background:transparent;color:var(--gufa-text-dim);
  cursor:pointer;font:inherit;height:22px;padding:0 4px;border-radius:6px}
.gufa-git-sync:hover:not(:disabled){background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-git-sync:disabled{opacity:.5;cursor:default}
.gufa-git-sync[data-active]{color:var(--gufa-accent)}
.gufa-git-sync-count{font-size:10.5px;font-variant-numeric:tabular-nums;min-width:8px;text-align:center}
.gufa-git-sync[data-active] .gufa-git-sync-count{font-weight:700}
.gufa-info-banner{display:flex;align-items:center;gap:6px;margin:8px 10px 0;padding:4px 8px;border-radius:6px;font-size:11.5px;
  color:var(--dsw-alias-state-success-primary, #3fa66f);border:1px solid color-mix(in srgb, currentColor 35%, transparent);
  background:color-mix(in srgb, currentColor 10%, transparent)}
.gufa-toast-success{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483300;
  display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:12px;pointer-events:none;
  color:var(--dsw-alias-state-success-primary, #3fb950);
  background:color-mix(in srgb, #3fb950 16%, var(--gufa-solid-overlay-bg, #1c1c1c));
  border:1px solid color-mix(in srgb, #3fb950 50%, transparent);
  box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(8px)}
/* 资源管理器：Git 改动状态颜色（M/A/D/R/??） */
.gufa-tree-row[data-git-status="M"] .gufa-tree-name{color:#e5c07b}
.gufa-tree-row[data-git-status="A"] .gufa-tree-name{color:#3fb950}
.gufa-tree-row[data-git-status="D"] .gufa-tree-name{color:#f85149;text-decoration:line-through}
.gufa-tree-row[data-git-status="R"] .gufa-tree-name{color:#61afef}
.gufa-tree-row[data-git-status="?"] .gufa-tree-name,.gufa-tree-row[data-git-status="??"] .gufa-tree-name{color:#3fb950;font-style:italic}
.gufa-tree-row[data-git-status] .gufa-tree-icon{opacity:.95}
.gufa-tree-problem{display:inline-block;width:6px;height:6px;border-radius:50%;background:#f85149;margin-left:5px;flex:0 0 auto}
.gufa-tree-problem[data-level="warning"]{background:#e5c07b}
.gufa-tree-problem[data-level="dir"]{background:color-mix(in srgb, var(--gufa-accent) 80%, transparent)}
.gufa-tab-problem{display:inline-block;width:6px;height:6px;border-radius:50%;background:#f85149;margin-left:4px}
.gufa-tab-problem[data-level="warning"]{background:#e5c07b}
.gufa-success-banner{display:flex;align-items:center;gap:6px;flex:0 0 auto;margin:8px 10px 0;padding:5px 9px;border-radius:6px;font-size:12px;
  color:var(--dsw-alias-state-success-primary, #3fa66f);border:1px solid color-mix(in srgb, currentColor 45%, transparent);
  background:color-mix(in srgb, currentColor 12%, transparent)}
.gufa-error-banner{display:flex;align-items:center;gap:8px;margin:8px 10px;padding:8px 10px;border-radius:8px;font-size:12px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}
.gufa-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--gufa-border-strong);border-top-color:var(--gufa-accent);
  animation:gufa-spin .7s linear infinite;flex:0 0 auto}
@keyframes gufa-spin{to{transform:rotate(360deg)}}
.gufa-modal-backdrop{position:absolute;inset:0;background:color-mix(in srgb, #000 42%, transparent);display:flex;align-items:center;
  justify-content:center;z-index:120;padding:20px calc(var(--gufa-dock-width,0px) + 20px) 20px 20px}
.gufa-modal{width:min(460px,92vw);max-height:80vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;
  border:1px solid var(--gufa-border-strong);background:var(--gufa-solid-overlay-bg);color:var(--gufa-solid-text, var(--dsw-alias-label-primary));
  box-shadow:0 18px 48px color-mix(in srgb, #000 34%, transparent)}
.gufa-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600;font-size:13px}
.gufa-modal-body{padding:14px;display:flex;flex-direction:column;gap:10px;overflow:auto;font-size:12.5px}
.gufa-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.gufa-modal-close{margin-left:auto}
.gufa-more-entry{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.gufa-more-entry:hover{background:var(--dsw-alias-interactive-bg-hover, var(--gufa-hover))}
.gufa-more-entry-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-menu{position:absolute;z-index:2147483000;min-width:150px;padding:5px;border-radius:9px;border:1px solid var(--gufa-border-strong);
  background:var(--gufa-solid-overlay-bg);box-shadow:0 12px 30px color-mix(in srgb, #000 28%, transparent)}
.gufa-menu-item{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 9px;border:0;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;text-align:left;white-space:nowrap}
.gufa-menu-item:hover{background:var(--gufa-hover)}
.gufa-menu-item[data-danger]{color:var(--dsw-alias-state-error-primary)}
.gufa-scroll::-webkit-scrollbar{width:9px;height:9px}
.gufa-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--gufa-text) 22%, transparent);border-radius:6px;border:2px solid transparent;background-clip:content-box}
.gufa-scroll::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb, var(--gufa-text) 34%, transparent);background-clip:content-box;border:2px solid transparent}
.gufa-scroll::-webkit-scrollbar-track{background:transparent}
/* 皮肤背景模式：各面板半透明，让右侧人像与渐变透出来（背景层在覆盖层内部，不会露出 DSH 原界面） */
.gufa-root[data-backdrop="on"] .gufa-titlebar{background:color-mix(in srgb, var(--gufa-layer) 76%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-activity{background:color-mix(in srgb, var(--gufa-layer) 58%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-sidepanel{background:color-mix(in srgb, var(--gufa-bg) 72%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-main{background:color-mix(in srgb, var(--gufa-bg) 58%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-editor-area{background:color-mix(in srgb, var(--gufa-bg) 46%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-tabs{background:color-mix(in srgb, var(--gufa-layer) 64%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-chatpane{background:color-mix(in srgb, var(--gufa-bg) 46%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-dock-host{background:transparent}
.gufa-root[data-backdrop="on"] .gufa-chatdock{background:transparent}
.gufa-root[data-backdrop="on"] .gufa-statusbar{background:color-mix(in srgb, var(--gufa-layer) 70%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-dock-toolbar{background:color-mix(in srgb, var(--gufa-layer) 62%, transparent)}
.gufa-root[data-backdrop="on"] .gufa-empty{background:transparent}
/* 皮肤背景模式下：编辑区保持半透明（Monaco 主题背景是实色，会盖住背景层，这里覆盖成透明） */
.gufa-root[data-backdrop="on"] .gufa-editor-host{background:transparent}
.gufa-root[data-backdrop="on"] .gufa-editor-host .monaco-editor,
.gufa-root[data-backdrop="on"] .gufa-editor-host .monaco-editor .margin,
.gufa-root[data-backdrop="on"] .gufa-editor-host .monaco-editor-background,
.gufa-root[data-backdrop="on"] .gufa-editor-host .monaco-diff-editor .editor.original,
.gufa-root[data-backdrop="on"] .gufa-editor-host .monaco-diff-editor .editor.modified{background:transparent!important}
.gufa-root[data-backdrop="on"] .gufa-editor-host .gufa-empty,
.gufa-root[data-backdrop="on"] .gufa-editor-host .gufa-editor-fallback{background:transparent!important}
.gufa-chatdock{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;width:100%;position:relative}
.gufa-dock-sessions{position:absolute;top:34px;right:calc(100% + 10px);z-index:60;min-width:250px;max-width:320px;max-height:min(380px,60vh);
  display:flex;flex-direction:column;padding:5px;border-radius:10px;border:1px solid var(--gufa-border-strong);
  background:var(--gufa-solid-overlay-bg);box-shadow:0 14px 36px color-mix(in srgb, #000 30%, transparent)}
.gufa-dock-session{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:30px;padding:0 9px;border:0;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;text-align:left;white-space:nowrap}
.gufa-dock-session:hover{background:var(--gufa-hover)}
.gufa-dock-session[data-current]{background:var(--gufa-active)}
.gufa-dock-session-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.gufa-dock-session-when{flex:0 0 auto;font-size:10.5px;color:var(--gufa-text-dim)}
.gufa-dock-sep{height:1px;margin:4px 6px;background:var(--gufa-border)}
.gufa-dock-toolbar{display:flex;align-items:center;gap:6px;height:32px;padding:0 6px 0 10px;flex:0 0 auto;
  border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-dock-title{display:flex;align-items:center;gap:6px;min-width:0;flex:0 1 auto;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gufa-dock-sub{font-size:10.5px;font-weight:400;color:var(--gufa-text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gufa-dock-fill{flex:1 1 auto}
.gufa-dock-live{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:0 0 auto;box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent)}
.gufa-dock-host{flex:1 1 auto;min-height:0;min-width:0;position:relative;background:var(--gufa-bg);display:flex;flex-direction:column}
.gufa-dock-fallback{display:flex;flex-direction:column;height:100%;min-height:0}
.gufa-dock-notice{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:11px;color:var(--gufa-text-dim);border-bottom:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-dock-missing{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;padding:10px}
[data-gufa-dock="1"] [class*="headerCorner"]{display:none!important}
[data-gufa-dock="1"] [class*="widthHandle"]{display:none!important}
[data-gufa-dock="1"]{box-sizing:border-box!important;border-left:1px solid var(--dsw-alias-border-l1)!important;
  box-shadow:-10px 0 28px color-mix(in srgb, #000 14%, transparent)!important;border-radius:0!important}
.gufa-footer-action{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:32px;padding:0 10px;border:0;border-radius:8px;
  background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12.5px;white-space:nowrap}
.gufa-footer-action:hover{background:var(--dsw-alias-bg-layer-2)}
.gufa-footer-action-label{overflow:hidden;text-overflow:ellipsis}
.gufa-panel-icon{border-radius:6px}
`

/** 注入插件样式（幂等；unmount 时移除）。 */
G.injectStyles = function injectStyles() {
  const id = 'gufa-code/styles'
  if (document.querySelector(`style[data-gufa="${id}"]`) !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.gufa = id
  style.textContent = G.CSS
  document.head.append(style)
  return () => style.remove()
}

/* ── 基础控件（React 元素，无第三方依赖） ───────────────────────────────── */
/** 小图标按钮。 */
G.IconButton = function IconButton(props) {
  return h(
    'button',
    {
      type: 'button',
      className: G.cls('gufa-iconbtn', props.className),
      title: props.title,
      'aria-label': props.title,
      disabled: props.disabled,
      onClick: props.onClick,
      style: props.style,
    },
    props.children,
  )
}

/** 常规按钮。 */
G.Button = function Button(props) {
  return h(
    'button',
    {
      type: 'button',
      className: G.cls('gufa-btn', props.className),
      'data-primary': props.primary ? '' : undefined,
      disabled: props.disabled,
      title: props.title,
      onClick: props.onClick,
      style: props.style,
    },
    props.icon ? h(G.Icon, { name: props.icon, size: 14 }) : null,
    props.children,
  )
}

G.Spinner = function Spinner() {
  return h('span', { className: 'gufa-spinner', role: 'status', 'aria-label': G.t('common.loading') })
}

/** 空状态。 */
G.Empty = function Empty(props) {
  return h(
    'div',
    { className: 'gufa-empty' },
    props.icon === 'seal' ? h(G.Seal, { className: 'gufa-seal' }) : props.icon ? h(G.Icon, { name: props.icon, size: 30 }) : null,
    props.title ? h('div', { className: 'gufa-empty-title' }, props.title) : null,
    props.hint ? h('div', { className: 'gufa-empty-hint' }, props.hint) : null,
    props.children ?? null,
  )
}

/** 面板小标题。 */
G.SectionHeader = function SectionHeader(props) {
  return h(
    'div',
    { className: 'gufa-panel-head' },
    h('span', { className: 'gufa-panel-head-title' }, props.title),
    props.children ?? null,
  )
}

/** 弹窗（Escape 关闭、焦点管理尽量贴近 Harness 风格）。 */
G.Modal = function Modal(props) {
  const [value, setValue] = useState(props.initialValue ?? '')
  const inputRef = useRef(null)
  useLayoutEffect(() => {
    if (inputRef.current !== null) {
      inputRef.current.focus()
      if (typeof inputRef.current.select === 'function') inputRef.current.select()
    }
  }, [])
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [value, props])
  return h(
    'div',
    { className: 'gufa-modal-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) props.onCancel() } },
    h(
      'div',
      { className: 'gufa-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
      h(
        'div',
        { className: 'gufa-modal-head' },
        props.title,
        h(G.IconButton, { className: 'gufa-modal-close', title: G.t('common.close'), onClick: props.onCancel }, h(G.Icon, { name: 'close', size: 14 })),
      ),
      h(
        'div',
        { className: 'gufa-modal-body' },
        props.description ? h('div', { className: 'gufa-hint' }, props.description) : null,
        props.children?.({ value, setValue, inputRef }) ??
          (props.multiline
            ? h('textarea', {
                className: 'gufa-textarea',
                ref: inputRef,
                value,
                placeholder: props.placeholder,
                onChange: (event) => setValue(event.target.value),
              })
            : h('input', {
                className: 'gufa-input',
                ref: inputRef,
                value,
                placeholder: props.placeholder,
                onChange: (event) => setValue(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && props.onSubmit !== undefined) {
                    event.preventDefault()
                    props.onSubmit(value)
                  }
                },
              })),
        props.error ? h('div', { className: 'gufa-error-banner', style: { margin: 0 } }, props.error) : null,
      ),
      h(
        'div',
        { className: 'gufa-modal-foot' },
        h(G.Button, { onClick: props.onCancel }, G.t('common.cancel')),
        h(G.Button, { primary: true, disabled: props.pending, onClick: () => props.onSubmit(value) }, props.pending ? h(G.Spinner) : null, props.submitLabel ?? G.t('common.confirm')),
      ),
    ),
  )
}


/* ─────────────────────── 10-icons.js ─────────────────────── */
/**
 * 10-icons：内联 SVG 图标集与「古」印章 Logo。全部使用 currentColor / 品牌色，无外部资源。
 */
const ICON_PATHS = {
  close: [['path', { d: 'M5 5l14 14M19 5L5 19' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  minus: [['path', { d: 'M5 12h14' }]],
  refresh: [['path', { d: 'M20 11a8 8 0 1 0-.6 4.2M20 4v7h-7' }]],
  'arrow-up': [
    ['path', { d: 'M12 19V5' }],
    ['path', { d: 'M6 11l6-6 6 6' }],
  ],
  'arrow-down': [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M6 13l6 6 6-6' }],
  ],
  graph: [
    ['circle', { cx: 6, cy: 6, r: 2.2 }],
    ['circle', { cx: 6, cy: 18, r: 2.2 }],
    ['circle', { cx: 18, cy: 12, r: 2.2 }],
    ['path', { d: 'M6 8.2v7.6M8.2 12h7.6' }],
  ],
  undo: [
    ['path', { d: 'M9 14L4 9l5-5' }],
    ['path', { d: 'M4 9h10a6 6 0 0 1 0 12h-4' }],
  ],
  'arrow-left': [['path', { d: 'M19 12H5M11 6l-6 6 6 6' }]],
  'arrow-right': [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  'chevron-right': [['path', { d: 'M9 5l7 7-7 7' }]],
  'chevron-down': [['path', { d: 'M5 9l7 7 7-7' }]],
  folder: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' }]],
  'folder-open': [
    ['path', { d: 'M3 8V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1' }],
    ['path', { d: 'M3.5 10h17l-2.2 8.3a2 2 0 0 1-1.9 1.5H5.2a2 2 0 0 1-2-1.6L2.3 12a1.4 1.4 0 0 1 1.2-2z' }],
  ],
  file: [['path', { d: 'M6 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3z' }], ['path', { d: 'M14 3v5h5' }]],
  files: [
    ['path', { d: 'M8 3h7l4 4v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }],
    ['path', { d: 'M15 3v4h4M3 8v12a1 1 0 0 0 1 1h9' }, { opacity: 0.55 }],
  ],
  git: [
    ['circle', { cx: 6, cy: 6, r: 2.2 }],
    ['circle', { cx: 6, cy: 18, r: 2.2 }],
    ['circle', { cx: 18, cy: 8, r: 2.2 }],
    ['path', { d: 'M6 8.2v7.6M8.2 6h5.4a2.2 2.2 0 0 1 2.2 2.2v5.6' }],
  ],
  server: [
    ['rect', { x: 3, y: 4, width: 18, height: 6, rx: 1.6 }],
    ['rect', { x: 3, y: 14, width: 18, height: 6, rx: 1.6 }],
    ['path', { d: 'M7 7h.01M7 17h.01' }],
  ],
  terminal: [['path', { d: 'M4 6l6 6-6 6M13 18h7' }]],
  sparkles: [
    ['path', { d: 'M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z' }],
    ['path', { d: 'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z' }, { opacity: 0.8 }],
  ],
  send: [['path', { d: 'M4 12l16-7-6.5 16-2.3-6.6L4 12z' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2.4 }]],
  trash: [
    ['path', { d: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }],
    ['path', { d: 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13' }],
  ],
  pencil: [['path', { d: 'M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z' }], ['path', { d: 'M14 5.5l3.5 3.5' }]],
  save: [
    ['path', { d: 'M5 3h11l3 3v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }],
    ['path', { d: 'M8 3v6h7V3M8 21v-7h8v7' }],
  ],
  gear: [
    ['circle', { cx: 12, cy: 12, r: 3.2 }],
    ['path', { d: 'M12 2.8l1 2.6 2.7.7 2-1.8 2.2 2.2-1.8 2 .7 2.7 2.6 1v3l-2.6 1-.7 2.7 1.8 2-2.2 2.2-2-1.8-2.7.7-1 2.6h-3l-1-2.6-2.7-.7-2 1.8-2.2-2.2 1.8-2-.7-2.7-2.6-1v-3l2.6-1 .7-2.7-1.8-2 2.2-2.2 2 1.8 2.7-.7 1-2.6h3z' }],
  ],
  code: [['path', { d: 'M8.5 6L3 12l5.5 6M15.5 6L21 12l-5.5 6' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'M16 16l4.5 4.5' }]],
  message: [['path', { d: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z' }]],
  'panel-right': [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M14 4v16' }]],
  'panel-left': [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M10 4v16' }]],
  keyboard: [
    ['rect', { x: 2.5, y: 6, width: 19, height: 12, rx: 2 }],
    ['path', { d: 'M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M8 16.5h8' }],
  ],
  branch: [
    ['circle', { cx: 7, cy: 5, r: 2.2 }],
    ['circle', { cx: 7, cy: 19, r: 2.2 }],
    ['circle', { cx: 17, cy: 8, r: 2.2 }],
    ['path', { d: 'M7 7.2v9.6M9.2 5h4.3a3.5 3.5 0 0 1 3.5 3.5v0' }],
  ],
  check: [['path', { d: 'M4.5 12.5l5 5 10-11' }]],
  warn: [['path', { d: 'M12 3l9.5 17H2.5L12 3z' }], ['path', { d: 'M12 9v5M12 17h.01' }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v6M12 8h.01' }]],
  history: [['path', { d: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V10h5.5' }], ['path', { d: 'M12 8v4.5l3 2' }]],
  plug: [['path', { d: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v3' }]],
  'chevron-up': [['path', { d: 'M5 15l7-7 7 7' }]],
  layout: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M9 4v16M3 10h6' }]],
  image: [
    ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.4 }],
    ['circle', { cx: 8.5, cy: 9.5, r: 1.6 }],
    ['path', { d: 'M4 17l5-4.5 3.5 3L16 12l4 4' }],
  ],
}

/** 通用图标：props = { name, size?, className? } */
G.Icon = function Icon(props) {
  const size = props.size ?? 16
  const shapes = ICON_PATHS[props.name] ?? ICON_PATHS.file
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.strokeWidth ?? 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className: props.className,
      'aria-hidden': 'true',
      focusable: 'false',
      style: props.style,
    },
    shapes.map((shape, index) => h(shape[0], { key: index, ...shape[1] })),
  )
}

/** 「古」印章 Logo（品牌艺术色，非主题 token）。 */
G.Seal = function Seal(props) {
  const size = props.size ?? 24
  return h(
    'svg',
    { viewBox: '0 0 128 128', width: size, height: size, className: props.className, 'aria-hidden': 'true', focusable: 'false' },
    h(
      'defs',
      null,
      h(
        'linearGradient',
        { id: 'gufaSealGrad', x1: '0', y1: '0', x2: '1', y2: '1' },
        h('stop', { offset: '0', stopColor: '#d0573f' }),
        h('stop', { offset: '0.55', stopColor: '#b33a2c' }),
        h('stop', { offset: '1', stopColor: '#8c211b' }),
      ),
    ),
    h('rect', { x: 6, y: 6, width: 116, height: 116, rx: 28, fill: 'url(#gufaSealGrad)' }),
    h('rect', { x: 15, y: 15, width: 98, height: 98, rx: 21, fill: 'none', stroke: '#f7e9d8', strokeOpacity: 0.78, strokeWidth: 3.5 }),
    h(
      'g',
      { fill: '#fbeee0' },
      h('rect', { x: 32, y: 32, width: 64, height: 9.5, rx: 2.5 }),
      h('rect', { x: 58.5, y: 32, width: 11, height: 30, rx: 2 }),
      h('path', {
        fillRule: 'evenodd',
        d: 'M40 62 h48 a4 4 0 0 1 4 4 v27 a4 4 0 0 1 -4 4 h-48 a4 4 0 0 1 -4 -4 v-27 a4 4 0 0 1 4 -4 z m8 10 h32 v19 h-32 z',
      }),
    ),
    h('path', { d: 'M27 101 l-7 -6 7 -6', fill: 'none', stroke: '#f7e9d8', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.8 }),
    h('path', { d: 'M101 101 l7 -6 -7 -6', fill: 'none', stroke: '#f7e9d8', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.8 }),
  )
}

/**
 * 侧边栏 panel 图标（ownerProps: size, active）。
 * 点击直接进入古法编程覆盖层，并 stopPropagation 阻止侧边栏把主面板切到 main key
 * （否则官方会话会被卸载，无法停靠进 IDE 右侧）。
 */
G.PanelIcon = function PanelIcon(props) {
  const active = G.useMode()
  return h(
    'span',
    {
      className: 'gufa-panel-icon',
      title: G.t('panel.label'),
      role: 'img',
      'aria-label': G.t('panel.label'),
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', filter: active ? 'drop-shadow(0 0 5px color-mix(in srgb, #c0392b 55%, transparent))' : undefined },
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (G.mode.get()) G.mode.set(false)
        else G.enterGufa()
      },
    },
    h(G.Seal, { size: props.size ?? 20 }),
  )
}

/** 侧边栏底部动作：显示「古法编程」按钮（ownerProps: wide）。 */
G.FooterAction = function FooterAction(props) {
  const active = G.useMode()
  const click = () => {
    if (G.mode.get()) G.mode.set(false)
    else G.enterGufa()
  }
  return h(
    'button',
    {
      type: 'button',
      className: 'gufa-footer-action',
      title: active ? G.t('app.exitHint') : G.t('panel.enterHint'),
      'aria-label': G.t('panel.label'),
      'data-active': active ? '' : undefined,
      onClick: click,
    },
    h(G.Seal, { size: 18 }),
    props.wide === false ? null : h('span', { className: 'gufa-footer-action-label' }, active ? G.t('app.exit') : G.t('panel.label')),
  )
}


/* ─────────────────────── 20-editor.js ─────────────────────── */
/**
 * 20-editor：「古法编程」Monaco 多标签编辑器（Cursor / VS Code 风格）。
 *
 * 设计要点：
 * - Monaco 走离线 AMD 资产：注入 /gufa-code/asset/monaco/loader.js →
 *   require.config({ paths: { vs: G.asset('monaco') } }) → require(['vs/editor/editor.main'])。
 *   loader Promise 是模块级单例（client factory 只执行一次），组件重挂载直接复用，
 *   不会重复注入 <script>；加载成功后也不 dispose 全局 monaco 实例。
 * - 每个 tab 对应一个 ITextModel（uri = file:///<root>/<path>）：切换 tab 只做
 *   editor.setModel(model) + restoreViewState，因此撤销栈、光标与滚动位置都保留；
 *   tab 关闭（从 props.tabs 消失）时 dispose 对应 model。
 * - 加载失败 / AMD loader 被占用 / 初始化异常时降级为 textarea（保留原占位实现），
 *   顶部显示错误与「重试」按钮，不会白屏。
 * - 语言服务 worker：离线资产没有标准的 `.../vs/` URL 段，Monaco 默认 AMD worker 工厂
 *   反推 baseUrl 会算错，因此显式提供 MonacoEnvironment.getWorker（worker 内先加载
 *   loader.js、配置 paths.vs 再执行 workerMain），保证 JSON/CSS/HTML/TS 语言服务可用。
 * - 只用 factory 内的 React/h/hooks/G 与 window 全局，不 import 任何 Harness Client 包。
 *
 * props: { tabs, activePath, theme, root, onSelectTab, onCloseTab, onChange, onSave, onCursor }
 *   tabs:        [{ path, content, language, revision, dirty, binary, tooLarge }]
 *   onChange(path, content)    内容变化（不落盘；落盘由 App 的 onSave 处理）
 *   onSave(path)               Ctrl/Cmd+S
 *   onCursor({ path, line, column, selectedText, lineCount })
 *   onSelectTab / onCloseTab   由 App 的标签栏使用；编辑器自身不渲染标签栏，接口保留以对齐设计契约。
 */
;(function installGufaEditorPane() {
  'use strict'

  /** 标记 Monaco loader <script>，避免重复注入 / 失败重试时残留。 */
  const LOADER_SCRIPT_ATTR = 'data-gufa-monaco-loader'

  /** 模块级单例：加载成功后的 Promise；失败原因单独缓存，避免每次挂载都重新注入脚本。 */
  let gufaMonacoPromise = null
  let gufaMonacoFailure = null

  function gufaMonacoTheme(theme) {
    return theme === 'dark' || theme === 'vs-dark' ? 'vs-dark' : 'vs'
  }

  /* ── 皮肤动态主题：让代码区跟随「滑动变祖」的实时配色（背景/前景/选区/行号/控件） ── */

  /** 解析 'rgb(r, g, b)' / 'rgba(...)' 为 [r,g,b,a]。 */
  function gufaParseRgb(value) {
    const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(String(value ?? '').trim())
    if (match === null) return null
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
  }

  function gufaHex(color) {
    const c = color ?? [0, 0, 0]
    return `#${[c[0], c[1], c[2]].map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')}`
  }

  function gufaHexAlpha(color, alpha) {
    const a = Math.max(0, Math.min(1, alpha))
    return `${gufaHex(color)}${Math.round(a * 255).toString(16).padStart(2, '0')}`
  }

  let gufaSkinThemeVersion = 0

  /**
   * 用插件合成出的实色调色板生成 Monaco 主题（跟随滑动变祖档位实时变化）。
   * @param {{bg?:string, text?:string, textDim?:string, layer?:string, layer2?:string, accent?:string, isDark?:boolean}|null} palette
   * @returns {{name:string, data:object}|null}
   */
  function gufaSkinMonacoTheme(palette) {
    if (palette === null || palette === undefined || typeof palette !== 'object') return null
    const bg = gufaParseRgb(palette.bg)
    const fg = gufaParseRgb(palette.text)
    if (bg === null || fg === null) return null
    const dim = gufaParseRgb(palette.textDim) ?? fg
    const layer = gufaParseRgb(palette.layer) ?? bg
    const layer2 = gufaParseRgb(palette.layer2) ?? layer
    const accent = gufaParseRgb(palette.accent) ?? fg
    const dark = palette.isDark !== false
    gufaSkinThemeVersion += 1
    const name = `gufa-skin-${dark ? 'dark' : 'light'}-${gufaSkinThemeVersion}`
    const rules = [
      { token: '', foreground: gufaHex(fg) },
      { token: 'comment', foreground: dark ? '#8d939d' : '#79808a', fontStyle: 'italic' },
      { token: 'keyword', foreground: dark ? '#c792ea' : '#9155c9' },
      { token: 'keyword.control', foreground: dark ? '#c792ea' : '#9155c9' },
      { token: 'string', foreground: dark ? '#a3d18b' : '#3f8f3f' },
      { token: 'number', foreground: dark ? '#dfae7a' : '#a4691b' },
      { token: 'constant', foreground: dark ? '#dfae7a' : '#a4691b' },
      { token: 'regexp', foreground: dark ? '#7fc8d6' : '#0f7f92' },
      { token: 'type', foreground: dark ? '#e6c179' : '#a8781c' },
      { token: 'type.identifier', foreground: dark ? '#e6c179' : '#a8781c' },
      { token: 'function', foreground: dark ? '#82c0f0' : '#2f6fbd' },
      { token: 'variable', foreground: gufaHex(fg) },
      { token: 'variable.predefined', foreground: dark ? '#82c0f0' : '#2f6fbd' },
      { token: 'tag', foreground: dark ? '#e58f8f' : '#b03a3a' },
      { token: 'attribute.name', foreground: dark ? '#e6c179' : '#a8781c' },
      { token: 'attribute.value', foreground: dark ? '#a3d18b' : '#3f8f3f' },
      { token: 'delimiter', foreground: gufaHex(dim) },
      { token: 'operator', foreground: dark ? '#8d939d' : '#79808a' },
    ]
    const data = {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules,
      colors: {
        'editor.background': gufaHex(bg),
        'editor.foreground': gufaHex(fg),
        'editorLineNumber.foreground': gufaHexAlpha(dim, 0.72),
        'editorLineNumber.activeForeground': gufaHex(fg),
        'editorCursor.foreground': gufaHex(accent),
        'editor.selectionBackground': gufaHexAlpha(accent, 0.34),
        'editor.inactiveSelectionBackground': gufaHexAlpha(accent, 0.16),
        'editor.selectionHighlightBackground': gufaHexAlpha(accent, 0.18),
        'editor.wordHighlightBackground': gufaHexAlpha(accent, 0.18),
        'editor.wordHighlightStrongBackground': gufaHexAlpha(accent, 0.26),
        'editor.findMatchBackground': gufaHexAlpha(accent, 0.34),
        'editor.findMatchHighlightBackground': gufaHexAlpha(accent, 0.2),
        'editor.lineHighlightBackground': gufaHexAlpha(layer2, 0.42),
        'editor.lineHighlightBorder': '#00000000',
        'editorIndentGuide.background1': gufaHexAlpha(dim, 0.18),
        'editorIndentGuide.activeBackground1': gufaHexAlpha(dim, 0.4),
        'editorWhitespace.foreground': gufaHexAlpha(dim, 0.22),
        'editorGutter.background': gufaHex(bg),
        'editorWidget.background': gufaHex(layer),
        'editorWidget.border': gufaHexAlpha(fg, 0.12),
        'editorSuggestWidget.background': gufaHex(layer),
        'editorSuggestWidget.border': gufaHexAlpha(fg, 0.12),
        'editorSuggestWidget.selectedBackground': gufaHexAlpha(accent, 0.22),
        'editorHoverWidget.background': gufaHex(layer),
        'editorHoverWidget.border': gufaHexAlpha(fg, 0.12),
        'editorBracketMatch.background': gufaHexAlpha(accent, 0.18),
        'editorBracketMatch.border': gufaHexAlpha(accent, 0.5),
        'editorLink.activeForeground': gufaHex(accent),
        'editorInfo.foreground': gufaHex(accent),
        'editorOverviewRuler.border': '#00000000',
        'scrollbarSlider.background': gufaHexAlpha(fg, 0.16),
        'scrollbarSlider.hoverBackground': gufaHexAlpha(fg, 0.26),
        'scrollbarSlider.activeBackground': gufaHexAlpha(fg, 0.34),
        'minimap.background': gufaHex(bg),
        'diffEditor.insertedTextBackground': dark ? '#2ea04399' : '#3fb95099',
        'diffEditor.removedTextBackground': dark ? '#f8514999' : '#d1242f99',
        'diffEditor.insertedLineBackground': dark ? '#2ea04373' : '#3fb95073',
        'diffEditor.removedLineBackground': dark ? '#f8514973' : '#d1242f73',
        'diffEditorGutter.insertedLineBackground': dark ? '#3fb950cc' : '#3fb950cc',
        'diffEditorGutter.removedLineBackground': dark ? '#f85149cc' : '#d1242fcc',
        'diffEditor.insertedTextBorder': '#3fb950',
        'diffEditor.removedTextBorder': '#f85149',
        'diffEditor.diagonalFill': dark ? '#333733' : '#e4e4e4',
        'diffEditorOverview.insertedForeground': '#3fb950ee',
        'diffEditorOverview.removedForeground': '#f85149ee',
        'editorGutter.addedBackground': '#2ea043',
        'editorGutter.deletedBackground': '#f85149',
        'editorGutter.modifiedBackground': '#c19a49',
        'editorStickyScroll.background': gufaHex(bg),
        'editorStickyScrollHover.background': gufaHex(layer2),
      },
    }
    return { name, data }
  }

  /** 已就绪的 monaco 实例：其他插件可能先加载过（AMD 模块与 window.monaco 是页面级全局）。 */
  function gufaReadyMonaco() {
    const monaco = window.monaco
    if (monaco === undefined || monaco === null || monaco.editor === undefined) return null
    if (typeof monaco.editor.create !== 'function') return null
    return monaco
  }

  /** 判断 window.require 是否是 Monaco 的 AMD loader（RequireJS 等别的 loader 不能混用）。 */
  function gufaIsMonacoLoader(candidate) {
    return (
      typeof candidate === 'function'
      && typeof candidate.config === 'function'
      && typeof candidate.reset === 'function'
      && typeof candidate.getConfig === 'function'
    )
  }

  /**
   * Monaco loader.js 的 Environment._detect 用全局 `module.exports` 判断运行环境：
   * 若页面其他脚本注入了全局 module，会被误判为 Node 环境，导致只写 module.exports
   * 而不挂 window.require。注入期间临时隐藏，onload/onerror 后原样还原。
   */
  function gufaHideNodeGlobals() {
    const saved = {
      hasModule: Object.prototype.hasOwnProperty.call(globalThis, 'module'),
      hasExports: Object.prototype.hasOwnProperty.call(globalThis, 'exports'),
      module: globalThis.module,
      exports: globalThis.exports,
    }
    try {
      delete globalThis.module
    } catch (error) {
      /* 只读/不可删除的全局属性：忽略 */
    }
    try {
      delete globalThis.exports
    } catch (error) {
      /* 同上 */
    }
    return saved
  }

  function gufaRestoreNodeGlobals(saved) {
    if (saved.hasModule) globalThis.module = saved.module
    else {
      try {
        delete globalThis.module
      } catch (error) {
        /* 忽略 */
      }
    }
    if (saved.hasExports) globalThis.exports = saved.exports
    else {
      try {
        delete globalThis.exports
      } catch (error) {
        /* 忽略 */
      }
    }
  }

  /**
   * 离线资产布局是 `<assetRoot>/loader.js + <assetRoot>/editor/...`（没有标准的 `.../vs/` URL 段），
   * 而 Monaco 默认 AMD worker 工厂会用 require.toUrl(...) 反推 worker 的 baseUrl，在本布局下
   * 会少算两段路径导致 worker 404（JSON/CSS/HTML/TS 语言服务失效）。
   * 这里显式提供 MonacoEnvironment.getWorker：worker 内先加载 loader.js、配置 paths.vs，
   * 再 importScripts workerMain.js，worker 侧模块解析与主线程完全一致。
   * 已有其他 Monaco 插件配置 getWorker/getWorkerUrl 时保持不变。
   */
  function gufaEnsureWorkerEnvironment() {
    const existing = window.MonacoEnvironment
    if (
      existing !== undefined
      && existing !== null
      && (typeof existing.getWorker === 'function' || typeof existing.getWorkerUrl === 'function')
    ) {
      return
    }
    const workerBase = (() => {
      try {
        return new URL(G.asset('monaco'), G.serverBase()).href
      } catch {
        return G.asset('monaco')
      }
    })()
    const getWorker = (moduleId, label) => gufaCreateMonacoWorker(workerBase, label)
    if (existing !== undefined && existing !== null && typeof existing === 'object') {
      existing.getWorker = getWorker
      return
    }
    window.MonacoEnvironment = { getWorker }
  }

  /** worker 内启动脚本：先有 AMD loader 与 paths.vs，再执行 workerMain（与默认工厂等价但路径适配本布局）。 */
  function gufaWorkerScript(base) {
    return [
      `self.MonacoEnvironment = { baseUrl: ${JSON.stringify(`${base}/`)} };`,
      `importScripts(${JSON.stringify(`${base}/loader.js`)});`,
      `require.config({ paths: { vs: ${JSON.stringify(base)} } });`,
      `importScripts(${JSON.stringify(`${base}/base/worker/workerMain.js`)});`,
    ].join('\n')
  }

  function gufaCreateMonacoWorker(base, label) {
    const name = typeof label === 'string' && label !== '' ? label : 'gufa-monaco-worker'
    const watch = (worker, sourceUrl) => {
      try {
        worker.addEventListener('error', (event) => {
          void G.api('dev.log', {
            message: `monaco-worker-error src=${sourceUrl} message=${String(event && event.message)} file=${String(event && event.filename)} line=${String(event && event.lineno)}`,
          }).catch(() => {})
        })
        worker.addEventListener('messageerror', () => {
          void G.api('dev.log', { message: `monaco-worker-messageerror src=${sourceUrl}` }).catch(() => {})
        })
        void G.api('dev.log', { message: `monaco-worker-created src=${sourceUrl}` }).catch(() => {})
      } catch {
        /* ignore */
      }
      return worker
    }
    try {
      const url = `${G.asset('monaco')}/worker-bootstrap.js?v=3`
      return watch(new Worker(url, { name }), url)
    } catch (error) {
      const blob = new Blob([gufaWorkerScript(base)], { type: 'text/javascript' })
      const url = URL.createObjectURL(blob)
      void G.api('dev.log', { message: `monaco-worker-construct-failed ${String(error && error.message)} fallback=blob` }).catch(() => {})
      try {
        return watch(new Worker(url, { name }), url)
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    }
  }

  /** 配置 vs 模块根路径（已有配置时沿用，避免覆盖其他 Monaco 插件正在使用的路径）。 */
  function gufaConfigureLoader(loader) {
    let configured = false
    try {
      const config = typeof loader.getConfig === 'function' ? loader.getConfig() : null
      const paths = config !== null && typeof config === 'object' ? config.paths : null
      if (paths !== null && typeof paths === 'object' && typeof paths.vs === 'string' && paths.vs !== '') {
        configured = true
      }
    } catch (error) {
      configured = false
    }
    if (!configured) loader.config({ paths: { vs: G.asset('monaco') } })
  }

  /**
   * 加载离线 Monaco（单例）。成功后缓存 Promise；失败后缓存原因，只有显式「重试」
   * （gufaResetMonacoFailure）才会再次尝试，因此重复挂载不会反复注入 loader 脚本。
   * @returns {Promise<object>} window.monaco
   */
  function gufaLoadMonaco() {
    const ready = gufaReadyMonaco()
    if (ready !== null) return Promise.resolve(ready)
    if (gufaMonacoPromise !== null) return gufaMonacoPromise
    if (gufaMonacoFailure !== null) return Promise.reject(gufaMonacoFailure)

    gufaMonacoPromise = new Promise((resolve, reject) => {
      let settled = false

      const fail = (error) => {
        if (settled) return
        settled = true
        const failure = error instanceof Error ? error : new Error(String(error))
        gufaMonacoPromise = null
        gufaMonacoFailure = failure
        reject(failure)
      }

      const succeed = () => {
        if (settled) return
        settled = true
        const monaco = gufaReadyMonaco()
        if (monaco === null) {
          fail(new Error('Monaco 初始化失败：window.monaco 不可用'))
          return
        }
        gufaMonacoFailure = null
        resolve(monaco)
      }

      const boot = () => {
        try {
          const loader = window.require
          if (!gufaIsMonacoLoader(loader)) {
            fail(new Error('没有可用的 Monaco AMD loader（window.require 缺失）'))
            return
          }
          gufaEnsureWorkerEnvironment()
          gufaConfigureLoader(loader)
          loader(['vs/editor/editor.main'], () => succeed(), (error) => {
            fail(new Error(`Monaco 模块加载失败：${String(error)}`))
          })
        } catch (error) {
          fail(error)
        }
      }

      const existingLoader = window.require
      if (typeof existingLoader === 'function' && !gufaIsMonacoLoader(existingLoader)) {
        fail(new Error('页面已被另一个非 Monaco 的 AMD loader 占用，无法加载离线 Monaco'))
        return
      }
      if (gufaIsMonacoLoader(existingLoader)) {
        boot()
        return
      }

      /* 没有 AMD loader：注入离线 loader.js（先清理上次失败留下的标签）。 */
      const stale = document.querySelector(`script[${LOADER_SCRIPT_ATTR}]`)
      if (stale !== null) stale.remove()
      const savedGlobals = gufaHideNodeGlobals()
      const script = document.createElement('script')
      script.src = G.asset('monaco/loader.js')
      script.async = true
      script.setAttribute(LOADER_SCRIPT_ATTR, '1')
      script.onload = () => {
        gufaRestoreNodeGlobals(savedGlobals)
        boot()
      }
      script.onerror = (event) => {
        gufaRestoreNodeGlobals(savedGlobals)
        script.remove()
        const hint = event !== null && event !== undefined && typeof event.type === 'string' ? `（${event.type}）` : ''
        fail(new Error(`Monaco loader.js 加载失败${hint}：请检查静态资产 ${G.asset('monaco/loader.js')}`))
      }
      document.head.append(script)
    })

    return gufaMonacoPromise
  }

  /** 失败后允许「重试」：清空失败缓存并重新走加载流程（成功加载过的 monaco 不会被重复注入）。 */
  function gufaResetMonacoFailure() {
    gufaMonacoFailure = null
    if (gufaReadyMonaco() === null) gufaMonacoPromise = null
  }

  /* ── model / URI ────────────────────────────────────────────────────── */

  /**
   * tab → Monaco model URI：file:///<root>/<path>（root 为项目绝对路径）。
   * @param {object} monaco Monaco 命名空间
   * @param {string} root 项目绝对路径（例：/Users/me/project）
   * @param {string} path 项目内相对路径（例：src/a.ts）
   */
  function gufaModelUri(monaco, root, path) {
    const normalizedRoot = String(root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
    const relativePath = String(path ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    const absolute = normalizedRoot === '' ? `/${relativePath}` : `${normalizedRoot}/${relativePath}`
    try {
      if (monaco.Uri !== undefined && monaco.Uri !== null && typeof monaco.Uri.file === 'function') {
        return monaco.Uri.file(absolute)
      }
      return monaco.Uri.parse(`file://${absolute.startsWith('/') ? '' : '/'}${absolute}`)
    } catch (error) {
      /* 极端路径（非法字符等）兜底：仍然给出唯一 file:// uri，避免整个编辑器不可用 */
      return monaco.Uri.parse(`file:///${relativePath}`)
    }
  }

  /** 只把 Monaco 已注册的 language id 交给 createModel（Host 的扩展名表里有 makefile/cmake 等 Monaco 没有的 id）。 */
  function gufaResolveLanguage(monaco, language) {
    if (typeof language !== 'string' || language === '') return undefined
    try {
      const languages = typeof monaco.languages?.getLanguages === 'function' ? monaco.languages.getLanguages() : null
      if (Array.isArray(languages) && languages.length > 0 && !languages.some((item) => item.id === language)) return undefined
    } catch (error) {
      return language
    }
    return language
  }

  /** 取（或创建）tab 对应的 model。已存在的同名 model 直接复用，避免重复注册 URI。 */
  function gufaCreateModel(monaco, root, tab, content) {
    const uri = gufaModelUri(monaco, root, tab.path)
    const language = gufaResolveLanguage(monaco, tab.language)
    const existing = typeof monaco.editor.getModel === 'function' ? monaco.editor.getModel(uri) : null
    if (existing !== null && existing !== undefined) return existing
    const model = monaco.editor.createModel(content, language, uri)
    try {
      // 按语言给默认缩进（Go/Java 等 4 空格、Makefile 用 Tab），已有文件由 detectIndentation 自动跟随
      if (typeof G.indentForLanguage === 'function') model.updateOptions(G.indentForLanguage(language))
    } catch {
      /* ignore */
    }
    return model
  }

  /** Monaco 编辑器选项：关闭 minimap / overview ruler，automaticLayout 跟随容器尺寸。 */
  function gufaEditorOptions(theme) {
    return {
      theme: gufaMonacoTheme(theme),
      automaticLayout: true,
      minimap: { enabled: false },
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      fontSize: 13,
      lineHeight: 20,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      autoIndent: 'full',
      detectIndentation: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      renderWhitespace: 'selection',
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      mouseWheelZoom: false,
      contextmenu: true,
    }
  }

  /** 文本插入后的光标位置（lineColumn 语义与 Monaco 一致：lineNumber 从 1、column 从 1）。 */
  function gufaAdvancePosition(position, text) {
    const lines = String(text ?? '').split('\n')
    if (lines.length <= 1) {
      return { lineNumber: position.lineNumber, column: position.column + (lines[0] ?? '').length }
    }
    return {
      lineNumber: position.lineNumber + lines.length - 1,
      column: (lines[lines.length - 1] ?? '').length + 1,
    }
  }

  /* ── 组件 ───────────────────────────────────────────────────────────── */

  G.EditorPane = function EditorPane(props) {
    const tabs = useMemo(() => (Array.isArray(props.tabs) ? props.tabs : []), [props.tabs])
    const activePath = typeof props.activePath === 'string' ? props.activePath : null
    const root = typeof props.root === 'string' ? props.root : ''
    const theme = gufaMonacoTheme(props.theme)
    const palette = props.palette !== null && props.palette !== undefined && typeof props.palette === 'object' ? props.palette : null
    const paletteKey = palette === null
      ? ''
      : [palette.bg, palette.text, palette.textDim, palette.layer, palette.layer2, palette.accent, palette.isDark].join('|')

    const activeTab = useMemo(() => {
      if (activePath === null) return null
      return tabs.find((tab) => tab !== null && typeof tab === 'object' && tab.path === activePath) ?? null
    }, [tabs, activePath])
    const activeIsDiff = activeTab !== null && activeTab.kind === 'diff'
    const activeDiffKey = activeIsDiff ? String(activeTab.diffKey ?? '') : ''
    const editableActiveTab =
      activeTab !== null && activeTab.kind !== 'diff' && activeTab.binary !== true && activeTab.tooLarge !== true ? activeTab : null

    const rootRef = useRef(null) /* 外层容器（键盘保存监听挂这里） */
    const hostRef = useRef(null) /* Monaco 挂载点 */
    const textareaRef = useRef(null) /* 降级 textarea */
    const editorRef = useRef(null)
    const diffHostRef = useRef(null)
    const diffEditorRef = useRef(null)
    const diffModelsRef = useRef([])
    const diffSignatureRef = useRef(null)
    const diffAnchorsRef = useRef([])
    const diffZoneIdsRef = useRef([])
    const monacoRef = useRef(null)
    const modelsRef = useRef(new Map()) /* path -> ITextModel */
    const viewStatesRef = useRef(new Map()) /* path -> editor view state（滚动/光标） */
    const lastPropContentRef = useRef(new Map()) /* path -> 最近一次同步过的 props content */
    const modelsRootRef = useRef(root) /* model 所属项目根：root 变了必须重建 */
    const modelPathRef = useRef(null) /* 当前挂在 editor 上的 tab path */
    const suppressChangeRef = useRef(false) /* 程序化 setValue 时抑制 onChange 回环 */
    const propsRef = useRef(props)
    const activePathRef = useRef(activePath)
    const statusRef = useRef('loading')

    /** idle → loading → ready / error */
    const [status, setStatus] = useState('loading')
    const [monacoError, setMonacoError] = useState('')
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
      propsRef.current = props
    }, [props])
    useEffect(() => {
      activePathRef.current = activePath
    }, [activePath])
    useEffect(() => {
      statusRef.current = status
    }, [status])

    const disposeModelAt = useCallback((path) => {
      const model = modelsRef.current.get(path) ?? null
      modelsRef.current.delete(path)
      viewStatesRef.current.delete(path)
      lastPropContentRef.current.delete(path)
      if (model !== null && model !== undefined && typeof model.isDisposed === 'function' && model.isDisposed() !== true) {
        try {
          model.dispose()
        } catch (error) {
          console.error('[gufa-code] dispose model failed', error)
        }
      }
    }, [])

    const disposeAllModels = useCallback(() => {
      for (const path of [...modelsRef.current.keys()]) disposeModelAt(path)
    }, [disposeModelAt])

    const reportCursor = useCallback(() => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      const path = modelPathRef.current
      if (editor === null || monaco === null || path === null) return
      const model = editor.getModel()
      if (model === null || model === undefined) return
      const selection = editor.getSelection()
      const position = selection !== null && selection !== undefined ? selection.getPosition() : editor.getPosition()
      if (position === null || position === undefined) return
      const hasSelection = selection !== null && selection !== undefined && !selection.isEmpty()
      const selectedText = hasSelection ? model.getValueInRange(selection) : ''
      const onCursor = propsRef.current.onCursor
      if (typeof onCursor === 'function') {
        onCursor({
          path,
          line: position.lineNumber,
          column: position.column,
          selectedText,
          lineCount: model.getLineCount(),
        })
      }
    }, [])

    /** 降级 textarea 的光标/选区计算（沿用占位实现的口径：line 从 1、column 从 1）。 */
    const reportFallbackCursor = useCallback(() => {
      const node = textareaRef.current
      const path = activePathRef.current
      if (node === null || path === null) return
      const value = typeof node.value === 'string' ? node.value : ''
      const start = typeof node.selectionStart === 'number' ? node.selectionStart : 0
      const end = typeof node.selectionEnd === 'number' ? node.selectionEnd : start
      const before = value.slice(0, start)
      const line = before.split('\n').length
      const column = start - before.lastIndexOf('\n')
      const onCursor = propsRef.current.onCursor
      if (typeof onCursor === 'function') {
        onCursor({
          path,
          line,
          column,
          selectedText: start !== end ? value.slice(start, end) : '',
          lineCount: value.split('\n').length,
        })
      }
    }, [])

    /** 在当前光标/选区插入文本（G.bus 'editor:insert'，AI 生成代码「插入到编辑器」用）。 */
    const insertText = useCallback((rawText) => {
      const text = typeof rawText === 'string' ? rawText : ''
      if (text === '') return
      const editor = statusRef.current === 'ready' ? editorRef.current : null
      const monaco = monacoRef.current
      if (editor !== null && monaco !== null) {
        const model = editor.getModel()
        if (model === null || model === undefined) return
        try {
          const position = editor.getPosition() ?? { lineNumber: 1, column: 1 }
          const selection = editor.getSelection()
          const range = selection !== null && selection !== undefined
            ? selection
            : new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
          const startPosition = range.getStartPosition()
          editor.pushUndoStop()
          editor.executeEdits('gufa-editor-insert', [{ range, text, forceMoveMarkers: true }])
          editor.pushUndoStop()
          editor.setPosition(gufaAdvancePosition(startPosition, text))
          editor.revealPositionInCenterIfOutsideViewport(gufaAdvancePosition(startPosition, text))
          editor.focus()
        } catch (error) {
          console.error('[gufa-code] 插入代码失败', error)
        }
        return
      }
      /* 降级 textarea：按当前 selection 插入，然后调 onChange（等同于用户输入）。 */
      const node = textareaRef.current
      const path = activePathRef.current
      if (node === null || path === null) return
      const value = typeof node.value === 'string' ? node.value : ''
      const start = typeof node.selectionStart === 'number' ? node.selectionStart : value.length
      const end = typeof node.selectionEnd === 'number' ? node.selectionEnd : start
      const next = `${value.slice(0, start)}${text}${value.slice(end)}`
      const onChange = propsRef.current.onChange
      if (typeof onChange === 'function') onChange(path, next)
      const caret = start + text.length
      window.requestAnimationFrame(() => {
        const current = textareaRef.current
        if (current === null) return
        current.focus()
        try {
          current.selectionStart = caret
          current.selectionEnd = caret
        } catch (error) {
          /* 忽略 */
        }
      })
    }, [])

    /** 失败后重试加载 Monaco。 */
    const retryMonaco = useCallback(() => {
      gufaResetMonacoFailure()
      setMonacoError('')
      setAttempt((value) => value + 1)
    }, [])

    /* ── 加载 Monaco 并创建 editor（每个 attempt 一次） ─────────────── */
    useEffect(() => {
      const host = hostRef.current
      if (host === null) return undefined
      let cancelled = false
      let editor = null
      const subscriptions = []

      setStatus('loading')
      setMonacoError('')

      const disposeEditor = () => {
        for (const subscription of subscriptions.splice(0)) {
          try {
            subscription.dispose()
          } catch (error) {
            /* 忽略 */
          }
        }
        if (editor !== null) {
          const current = editor
          editor = null
          try {
            current.dispose()
          } catch (error) {
            /* 忽略 */
          }
        }
        editorRef.current = null
        modelPathRef.current = null
      }

      gufaLoadMonaco()
        .then((monaco) => {
          if (cancelled) return
          try {
            const instance = monaco.editor.create(host, gufaEditorOptions(propsRef.current.theme))
            editor = instance
            editorRef.current = instance
            try {
              try {
              G.__gufaEditorController = {
                comment: () => {
                  try {
                    instance.trigger('gufa-shortcut', 'editor.action.commentLine', null)
                    return true
                  } catch {
                    return false
                  }
                },
                hasEditor: true,
              }
              if (typeof instance.onDidFocusEditorText === 'function') instance.onDidFocusEditorText(() => {
                try {
                  G.bus.emit('editor:focus', true)
                } catch {
                  /* ignore */
                }
              })
              if (typeof instance.onDidBlurEditorText === 'function') instance.onDidBlurEditorText(() => {
                try {
                  G.bus.emit('editor:focus', false)
                } catch {
                  /* ignore */
                }
              })
              if (typeof instance.onMouseDown === 'function') instance.onMouseDown(() => {
                try {
                  G.bus.emit('editor:focus', true)
                } catch {
                  /* ignore */
                }
              })
            } catch {
              /* ignore */
            }
            G.__gufaEditorDebug = {
                focus: () => {
                  try {
                    instance.focus()
                  } catch {
                    /* ignore */
                  }
                },
                hasTextFocus: () => {
                  try {
                    return typeof instance.hasTextFocus === 'function' ? instance.hasTextFocus() === true : false
                  } catch {
                    return false
                  }
                },
                setSelectionAll: () => {
                  try {
                    instance.trigger('gufa-debug', 'editor.action.selectAll', null)
                  } catch {
                    /* ignore */
                  }
                },
              }
            } catch {
              /* ignore */
            }
            monacoRef.current = monaco
            /* Alt+↑/↓ 移动行之后，按语言缩进规则重排当前行（移入大括号自动缩进） */
            const reindentCurrent = () => {
              if (instance === null || instance === undefined) return
              try {
                instance.trigger('gufa-reindent', 'editor.action.reindentselectedlines', null)
              } catch {
                /* ignore */
              }
            }
            const onReindentKey = (event) => {
              if (event.altKey !== true || event.metaKey === true || event.ctrlKey === true) return
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              window.setTimeout(reindentCurrent, 0)
            }
            host.addEventListener('keydown', onReindentKey, true)
            subscriptions.push({ dispose: () => host.removeEventListener('keydown', onReindentKey, true) })
            /* 内容变化：记录最新内容（供 props 回环判定）并上报 App。 */
            subscriptions.push(instance.onDidChangeModelContent(() => {
              if (suppressChangeRef.current) return
              const model = instance.getModel()
              const path = modelPathRef.current
              if (model === null || model === undefined || path === null) return
              const value = model.getValue()
              lastPropContentRef.current.set(path, value)
              const onChange = propsRef.current.onChange
              if (typeof onChange === 'function') onChange(path, value)
            }))
            /* 光标 / 选区变化上报（状态栏行号列、AI 上下文选区）。 */
            subscriptions.push(instance.onDidChangeCursorSelection(() => reportCursor()))
            /* 语言服务（JS/TS/JSON/CSS/HTML）诊断 → 资源管理器 / 标签页 / 状态栏 */
            const publishProblems = () => {
              if (typeof G.problemsStore?.set !== 'function') return
              const next = {}
              try {
                for (const [path, model] of modelsRef.current) {
                  if (model === null || model === undefined) continue
                  let markers = []
                  try {
                    markers = monaco.editor.getModelMarkers({ resource: model.uri })
                  } catch {
                    continue
                  }
                  let errors = 0
                  let warnings = 0
                  const errorLevel = monaco.MarkerSeverity?.Error ?? 8
                  const warningLevel = monaco.MarkerSeverity?.Warning ?? 4
                  for (const marker of markers) {
                    if (marker.severity === errorLevel) errors += 1
                    else if (marker.severity === warningLevel) warnings += 1
                  }
                  if (errors > 0 || warnings > 0) next[path] = { errors, warnings }
                }
              } catch {
                /* ignore */
              }
              G.problemsStore.set(next)
            }
            try {
              subscriptions.push(monaco.editor.onDidChangeMarkers(() => publishProblems()))
            } catch {
              /* ignore */
            }
            publishProblems()
            setStatus('ready')
          } catch (error) {
            disposeEditor()
            if (cancelled) return
            setStatus('error')
            setMonacoError(G.errorText(error))
          }
        })
        .catch((error) => {
          if (cancelled) return
          setStatus('error')
          setMonacoError(G.errorText(error))
        })

      return () => {
        cancelled = true
        disposeEditor()
        /* 组件卸载：释放本组件创建的全部 model（Monaco 全局实例保留，供其他面板复用）。 */
        disposeAllModels()
      }
    }, [attempt, reportCursor, disposeAllModels])

    /* ── 同步 tabs ↔ models，并切换当前 model ──────────────────────── */
    useEffect(() => {
      if (status !== 'ready') return
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (editor === null || monaco === null) return

      const editableTabs = []
      for (const tab of tabs) {
        if (tab === null || typeof tab !== 'object' || typeof tab.path !== 'string') continue
        if (tab.binary === true || tab.tooLarge === true) continue
        editableTabs.push(tab)
      }
      const editablePaths = new Set(editableTabs.map((tab) => tab.path))

      /* 项目根变了：旧 model 的 file:// uri 失效，全部重建。 */
      if (modelsRootRef.current !== root) {
        try {
          editor.setModel(null)
        } catch (error) {
          /* 忽略 */
        }
        modelPathRef.current = null
        disposeAllModels()
        modelsRootRef.current = root
      }

      /* 1) 已关闭的 tab：先 detach 再 dispose model（撤销栈随 model 释放）。 */
      for (const path of [...modelsRef.current.keys()]) {
        if (editablePaths.has(path)) continue
        const model = modelsRef.current.get(path) ?? null
        if (editor.getModel() === model) {
          try {
            editor.setModel(null)
          } catch (error) {
            /* 忽略 */
          }
          modelPathRef.current = null
        }
        disposeModelAt(path)
      }

      /* 2) 新建 / 同步 model（内容被外部修改时兜底 setValue，正常输入不会走到这里）。 */
      for (const tab of editableTabs) {
        const content = typeof tab.content === 'string' ? tab.content : ''
        let model = modelsRef.current.get(tab.path) ?? null
        if (model !== null && typeof model.isDisposed === 'function' && model.isDisposed()) model = null
        if (model === null) {
          try {
            model = gufaCreateModel(monaco, root, tab, content)
          } catch (error) {
            setStatus('error')
            setMonacoError(G.errorText(error))
            return
          }
          modelsRef.current.set(tab.path, model)
          lastPropContentRef.current.set(tab.path, content)
          continue
        }
        if (lastPropContentRef.current.get(tab.path) !== content) {
          lastPropContentRef.current.set(tab.path, content)
          if (model.getValue() !== content) {
            suppressChangeRef.current = true
            try {
              model.setValue(content)
            } finally {
              suppressChangeRef.current = false
            }
          }
        }
      }

      /* 3) 当前 tab → 同一个 editor 实例换 model：撤销栈在 model 上，滚动/光标用 viewState 恢复。 */
      const targetTab = editablePaths.has(activePath)
        ? editableTabs.find((tab) => tab.path === activePath) ?? null
        : null
      const targetModel = targetTab === null ? null : modelsRef.current.get(targetTab.path) ?? null
      if (editor.getModel() !== targetModel) {
        const previousPath = modelPathRef.current
        const previousModel = editor.getModel()
        if (previousPath !== null && previousModel !== null && previousModel !== undefined) {
          try {
            const viewState = editor.saveViewState()
            if (viewState !== null && viewState !== undefined) viewStatesRef.current.set(previousPath, viewState)
          } catch (error) {
            /* 忽略 */
          }
        }
        modelPathRef.current = targetTab === null ? null : targetTab.path
        editor.setModel(targetModel)
        if (targetModel !== null && targetTab !== null) {
          const viewState = viewStatesRef.current.get(targetTab.path)
          if (viewState !== null && viewState !== undefined) {
            try {
              editor.restoreViewState(viewState)
            } catch (error) {
              /* 忽略 */
            }
          }
          reportCursor()
          /* 打开/切换文件不抢焦点：只有用户点击编辑区时才进入键盘编辑 */
        }
      } else if (targetTab !== null) {
        modelPathRef.current = targetTab.path
      }
    }, [status, tabs, activePath, root, reportCursor, disposeAllModels, disposeModelAt])

    /* ── Git diff 视图：Monaco DiffEditor（未暂存的一侧可编辑并保存） ── */
    useEffect(() => {
      const disposeDiff = () => {
        if (diffEditorRef.current !== null) {
          try {
            diffEditorRef.current.dispose()
          } catch {
            /* ignore */
          }
          diffEditorRef.current = null
        }
        for (const model of diffModelsRef.current) {
          try {
            model.dispose()
          } catch {
            /* ignore */
          }
        }
        diffModelsRef.current = []
        diffSignatureRef.current = null
        diffAnchorsRef.current = []
        diffZoneIdsRef.current = []
      }
      if (status !== 'ready' || activeIsDiff !== true) {
        disposeDiff()
        return undefined
      }
      const monaco = monacoRef.current
      const host = diffHostRef.current
      const tab = activeTab
      if (monaco === null || host === null || tab === null || tab.diff === null || tab.diff === undefined) return undefined
      monacoRef.current = monaco
      const signature = `${tab.path}|${tab.diff.staged === true ? 'staged' : 'work'}|${activeDiffKey}|${String(tab.diff.left ?? '').length}|${paletteKey}`
      if (diffSignatureRef.current === signature && diffEditorRef.current !== null) return undefined
      disposeDiff()
      let skin = null
      try {
        skin = gufaSkinMonacoTheme(palette)
        if (skin !== null) monaco.editor.defineTheme(skin.name, skin.data)
      } catch {
        skin = null
      }
      const language = typeof tab.language === 'string' && tab.language !== '' ? tab.language : 'plaintext'
      const key = encodeURIComponent(String(tab.path))
      const suffix = String(Date.now())
      const leftText = tab.diff.compare === true && typeof tab.compareLeft === 'string' ? tab.compareLeft : String(tab.diff.left ?? '')
      const originalModel = monaco.editor.createModel(String(leftText ?? ''), language, monaco.Uri.parse(`gufa-diff://original/${key}/${suffix}`))
      const modifiedModel = monaco.editor.createModel(String(tab.content ?? ''), language, monaco.Uri.parse(`gufa-diff://modified/${key}/${suffix}`))
      let instance
      try {
        instance = monaco.editor.createDiffEditor(host, {
          theme: skin === null ? gufaMonacoTheme(props.theme) : skin.name,
          readOnly: tab.diff.editable !== true,
          originalEditable: tab.diff.compare === true,
          automaticLayout: true,
          renderSideBySide: true,
          renderIndicators: true,
          renderMarginRevertIcon: true,
          useInlineViewWhenSpaceIsLimited: true,
          ignoreTrimWhitespace: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          renderOverviewRuler: false,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: 12.5,
          lineHeight: 1.15,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        })
        instance.setModel({ original: originalModel, modified: modifiedModel })
      } catch (error) {
        try {
          originalModel.dispose()
          modifiedModel.dispose()
        } catch {
          /* ignore */
        }
        return undefined
      }
      diffEditorRef.current = instance
      diffModelsRef.current = [originalModel, modifiedModel]
      diffSignatureRef.current = signature
      // 自动把视图滚到第一处差异，避免「看起来没对比出来」
      const revealFirstDiff = () => {
        try {
          if (typeof instance.getLineChanges !== 'function') return
          const changes = instance.getLineChanges()
          if (changes !== null && changes !== undefined && changes.length > 0) instance.getModifiedEditor().revealLineInCenter(changes[0].modifiedStartLineNumber)
        } catch {
          /* ignore */
        }
      }
      try {
        if (typeof instance.onDidUpdateDiff === 'function') instance.onDidUpdateDiff(revealFirstDiff)
      } catch {
        /* ignore */
      }
      revealFirstDiff()
      const subOriginal = originalModel.onDidChangeContent(() => {
        if (tab.diff.compare !== true) return
        if (suppressChangeRef.current) return
        try {
          props.onDiffChange?.(tab.path, 'left', originalModel.getValue())
        } catch {
          /* ignore */
        }
      })
      const sub = modifiedModel.onDidChangeContent(() => {
        if (suppressChangeRef.current) return
        if (tab.diff.editable !== true) return
        try {
          if (tab.diff.compare === true) props.onDiffChange?.(tab.path, 'right', modifiedModel.getValue())
          else props.onChange?.(tab.path, modifiedModel.getValue())
        } catch {
          /* ignore */
        }
      })
      try {
        G.__gufaEditorController = {
          comment: () => {
            try {
              instance.getModifiedEditor().trigger('gufa-shortcut', 'editor.action.commentLine', null)
              return true
            } catch {
              return false
            }
          },
          hasEditor: true,
        }
      } catch {
        /* ignore */
      }
      /* 诊断：2 秒后如果差异仍然是 null，说明 Monaco worker 没起来（dsh-app:// 下的 worker 限制） */
      window.setTimeout(() => {
        try {
          const changes = typeof instance.getLineChanges === 'function' ? instance.getLineChanges() : null
          void G.api('dev.log', {
            message: `diff-open path=${tab.path} leftLen=${String(leftText ?? '').length} rightLen=${String(tab.content ?? '').length} hostW=${host !== null ? host.clientWidth : -1} changes=${Array.isArray(changes) ? changes.length : String(changes)}`,
          }).catch(() => {})
        } catch {
          /* ignore */
        }
      }, 2000)
      return () => {
        try {
          sub.dispose()
        } catch {
          /* ignore */
        }
        try {
          subOriginal.dispose()
        } catch {
          /* ignore */
        }
        disposeDiff()
      }
    }, [status, activeIsDiff, activePath, activeDiffKey, paletteKey, theme])

    /* ── 主题跟随 App / 滑动变祖配色（即时切换，不需要重建 editor） ──── */
    useEffect(() => {
      if (status !== 'ready') return
      const monaco = monacoRef.current
      if (monaco === null || monaco.editor === undefined) return
      try {
        const skin = gufaSkinMonacoTheme(palette)
        if (skin !== null) {
          monaco.editor.defineTheme(skin.name, skin.data)
          monaco.editor.setTheme(skin.name)
        } else {
          monaco.editor.setTheme(theme)
        }
      } catch (error) {
        /* 主题失败不阻塞编辑 */
      }
    }, [status, theme, paletteKey])

    /* ── 外部触发的编辑器命令（快捷键层：注释、多光标等） ─────────────── */
    useEffect(() => {
      if (G.bus === null || G.bus === undefined) return undefined
      const off = G.bus.on('editor:command', (commandId) => {
        if (typeof commandId !== 'string' || commandId === '') return
        try {
          if (window.__gufaEditorCmdLogs === undefined) window.__gufaEditorCmdLogs = 20
          if (window.__gufaEditorCmdLogs > 0) {
            window.__gufaEditorCmdLogs -= 1
            void G.api('dev.log', { message: `editor-command-received ${commandId} hasEditor=${editorRef.current !== null}` }).catch(() => {})
          }
          const editor = editorRef.current
          const monaco = monacoRef.current
          if (editor !== null && monaco !== null) {
            editor.trigger('gufa-shortcut', commandId, null)
            if (commandId.includes('moveLines')) {
              window.setTimeout(() => {
                try {
                  editor.trigger('gufa-reindent', 'editor.action.reindentselectedlines', null)
                } catch {
                  /* ignore */
                }
              }, 0)
            }
            return
          }
          const textarea = textareaRef.current
          if (textarea !== null) textarea.focus()
        } catch (error) {
          void G.api('dev.log', { message: `editor-command-failed ${String(error)}` }).catch(() => {})
        }
      })
      return () => {
        try {
          off()
        } catch {
          /* ignore */
        }
      }
    }, [])

    /* ── Ctrl/Cmd+S 保存 ───────────────────────────────────────────────
     * 监听挂在编辑区根容器的捕获阶段：App 还有一个 window 级 Ctrl/Cmd+S
     * 监听（90-app.js），它先于这里执行并通过 preventDefault 发起保存；
     * 用 defaultPrevented 判断「已被上层处理」，避免同一次按键触发两次
     * fs.write（会因 expectedRevision 竞态误报保存冲突）。单测/独立挂载
     * 没有上层监听时，这里负责调用 onSave。 */
    useEffect(() => {
      const node = rootRef.current
      if (node === null) return undefined
      const onKeyDown = (event) => {
        if (event.key !== 's' && event.key !== 'S') return
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return
        const handledByOuterListener = event.defaultPrevented
        event.preventDefault()
        if (handledByOuterListener || event.repeat) return
        const path = activePathRef.current
        if (path === null) return
        const onSave = propsRef.current.onSave
        if (typeof onSave === 'function') onSave(path)
      }
      node.addEventListener('keydown', onKeyDown, true)
      return () => node.removeEventListener('keydown', onKeyDown, true)
    }, [])

    /* ── AI 代码插入：G.bus 'editor:insert' ───────────────────────────── */
    useEffect(() => {
      if (G.bus === undefined || G.bus === null || typeof G.bus.on !== 'function') return undefined
      return G.bus.on('editor:insert', (detail) => {
        if (detail === null || detail === undefined || typeof detail !== 'object') return
        if (typeof detail.text !== 'string' || detail.text === '') return
        insertText(detail.text)
      })
    }, [insertText])

    /* ── 降级 textarea：出现/切换 tab 时上报初始光标（不自动抢焦点） ── */
    useEffect(() => {
      if (status !== 'error') return
      reportFallbackCursor()
    }, [status, activePath, reportFallbackCursor])

    /* ── Diff 工具条动作 ─────────────────────────────────────────────── */
    const diffNavigate = (direction) => {
      const instance = diffEditorRef.current
      if (instance === null) return
      try {
        const changes = typeof instance.getLineChanges === 'function' ? instance.getLineChanges() : null
        if (changes === null || changes === undefined || changes.length === 0) return
        const editor = instance.getModifiedEditor()
        const position = editor.getPosition()
        const line = position === null ? 0 : position.lineNumber
        let target = direction > 0 ? changes.find((item) => item.modifiedStartLineNumber > line) : [...changes].reverse().find((item) => item.modifiedEndLineNumber < line)
        if (target === undefined) target = direction > 0 ? changes[0] : changes[changes.length - 1]
        if (target === undefined) return
        editor.revealLineInCenter(target.modifiedStartLineNumber)
        editor.setPosition({ lineNumber: target.modifiedStartLineNumber, column: 1 })
      } catch {
        /* ignore */
      }
    }

    /* ── 渲染 ───────────────────────────────────────────────────────── */
    let emptyState = null
    if (activeTab === null) {
      emptyState = h(G.Empty, { icon: 'seal', title: G.t('editor.noFile'), hint: G.t('editor.noFileHint') })
    } else if (activeTab.binary === true) {
      emptyState = h(G.Empty, { icon: 'file', title: G.t('editor.binary') })
    } else if (activeTab.tooLarge === true) {
      emptyState = h(G.Empty, { icon: 'file', title: G.t('editor.tooLarge') })
    }

    return h(
      'div',
      {
        ref: rootRef,
        className: 'gufa-editor-pane',
        style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 },
      },
      status === 'error'
        ? h(
            'div',
            { className: 'gufa-error-banner', style: { margin: '8px 10px 0', flex: '0 0 auto' } },
            h(G.Icon, { name: 'warn', size: 13 }),
            h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, `${G.t('app.error')} · ${monacoError}`),
            h(G.IconButton, { title: G.t('common.retry'), onClick: retryMonaco }, h(G.Icon, { name: 'refresh', size: 13 })),
          )
        : null,
      h(
        'div',
        { style: { position: 'relative', flex: '1 1 auto', minWidth: 0, minHeight: 0 } },
        /* Monaco 挂载点：始终保留 DOM（卸载会破坏 editor 实例），用 display 控制可见性。 */
        h('div', {
          ref: hostRef,
          className: 'gufa-monaco-host',
          style: { position: 'absolute', inset: 0, display: status === 'error' || activeIsDiff ? 'none' : 'block' },
        }),
        activeIsDiff && status !== 'error'
          ? h(
              'div',
              { className: 'gufa-diff-toolbar' },
              h(G.IconButton, { title: G.t('diff.prev'), onClick: () => diffNavigate(-1) }, h(G.Icon, { name: 'chevron-up', size: 13 })),
              h(G.IconButton, { title: G.t('diff.next'), onClick: () => diffNavigate(1) }, h(G.Icon, { name: 'chevron-down', size: 13 })),
              h('span', { style: { flex: '1 1 auto' } }),
              activeTab.diff !== null && activeTab.diff !== undefined && activeTab.diff.compare !== true && activeTab.diff.editable === true
                ? h(G.Button, { icon: 'undo', title: G.t('diff.revertFile'), onClick: () => props.onDiffRevert?.(activeTab.path) }, G.t('diff.revertFile'))
                : null,
              activeTab.diff !== null && activeTab.diff !== undefined && activeTab.diff.compare !== true && activeTab.diff.editable === true
                ? h(G.Button, { icon: 'plus', title: G.t('diff.stageFile'), onClick: () => props.onDiffStage?.(activeTab.path) }, G.t('diff.stageFile'))
                : null,
            )
          : null,
        h('div', {
          ref: diffHostRef,
          className: 'gufa-diff-host',
          style: { position: 'absolute', inset: 0, top: activeIsDiff && status !== 'error' ? 30 : 0, display: activeIsDiff && status !== 'error' ? 'block' : 'none' },
        }),
        /* 加载失败：复用原占位实现的 textarea 降级（仍可编辑、保存、上报光标）。 */
        status === 'error' && editableActiveTab !== null
          ? h('textarea', {
              ref: textareaRef,
              className: 'gufa-editor-fallback gufa-scroll',
              spellCheck: false,
              value: editableActiveTab.content ?? '',
              onChange: (event) => props.onChange?.(editableActiveTab.path, event.target.value),
              onKeyUp: reportFallbackCursor,
              onClick: reportFallbackCursor,
              onSelect: reportFallbackCursor,
              style: {
                border: 0,
                resize: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
              },
            })
          : null,
        /* 无文件 / 二进制 / 过大：空状态覆盖在 editor 之上（不清空 editor DOM）。 */
        emptyState !== null
          ? h('div', { style: { position: 'absolute', inset: 0, background: props.backdropMode === true ? 'transparent' : 'var(--gufa-bg)' } }, emptyState)
          : null,
        /* 首次加载 Monaco 的占位（覆盖在最上层，避免白屏）。 */
        status === 'loading'
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: 'var(--gufa-text-dim)',
                  background: props.backdropMode === true ? 'transparent' : 'var(--gufa-bg)',
                },
              },
              h(G.Spinner),
              h('span', null, G.t('editor.loading')),
            )
          : null,
      ),
    )
  }

  /* 纯函数/加载状态测试钩子：供 scripts/test-editor.mjs 在无浏览器环境下校验
   * URI、光标推进、主题映射与 loader 失败降级 / 重试 / 单例注入。 */
  G.EditorPane.internals = Object.freeze({
    modelUri: gufaModelUri,
    advancePosition: gufaAdvancePosition,
    editorOptions: gufaEditorOptions,
    monacoTheme: gufaMonacoTheme,
    skinMonacoTheme: gufaSkinMonacoTheme,
    workerScript: gufaWorkerScript,
    resolveLanguage: gufaResolveLanguage,
    loadMonaco: gufaLoadMonaco,
    resetMonacoFailure: gufaResetMonacoFailure,
  })
})()


/* ─────────────────────── 30-terminal.js ─────────────────────── */
/**
 * 30-terminal：内嵌真实终端面板（xterm + WebSocket 连接 Host PTY）。
 *
 * 能力：
 *   - 离线加载 vendor/xterm（UMD → window.Terminal、addon-fit → window.FitAddon.FitAddon）；
 *     加载失败自动降级为「纯文本输出 + 输入行」，仍然可交互。
 *   - 多标签（新建/切换/关闭）、ResizeObserver + fit() 自适应并上报 resize。
 *   - 键盘输入直接经 WS 发给 PTY；暗/亮主题跟随 props.theme。
 *   - 断线自动重连：用已收字节数（since）请求补发缺失输出，服务端缓冲滑出窗口时先清屏再回放。
 *   - 监听 G.bus 'terminal:send'（SSH 快捷连接）把文本写入当前终端；终端未创建或未连上时排队。
 *
 * props: { root, visible, height, theme, onToggleHeight }（高度由外部拖拽条控制，组件内不改）
 */
/** 客户端诊断日志：写入 Host 侧 /tmp/gufa-code-debug.log（排查桌面壳连接问题用）。 */
function gufaTermDebug(stage, detail) {
  try {
    const message = `${stage} | ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
    void G.api('dev.log', { message }).catch(() => {})
  } catch {
    /* 诊断失败不影响功能 */
  }
}

/* ── xterm 离线资产加载（模块级、幂等、失败可重试） ─────────────────────── */
const GUFA_TERM_CSS_ID = 'gufa-code/xterm.css'
const GUFA_TERM_XTERM_ID = 'gufa-code/xterm.js'
const GUFA_TERM_FIT_ID = 'gufa-code/xterm-addon-fit.js'
/** @type {Promise<{ Terminal: Function, FitAddon: Function }> | null} */
let gufaTermAssetsPromise = null

/** 页面里可能被其他插件注入全局 `module` / `exports`，UMD 会误判成 Node 环境而不挂 window。 */
function gufaHideNodeGlobals() {
  const g = globalThis
  const hadModule = Object.prototype.hasOwnProperty.call(g, 'module')
  const hadExports = Object.prototype.hasOwnProperty.call(g, 'exports')
  const hadDefine = Object.prototype.hasOwnProperty.call(g, 'define')
  const savedModule = g.module
  const savedExports = g.exports
  const savedDefine = g.define
  try {
    delete g.module
  } catch {
    /* ignore */
  }
  try {
    delete g.exports
  } catch {
    /* ignore */
  }
  try {
    if (typeof g.module !== 'undefined') g.module = undefined
  } catch {
    /* ignore */
  }
  try {
    if (typeof g.exports !== 'undefined') g.exports = undefined
  } catch {
    /* ignore */
  }
  /* 关键：Monaco 的 AMD loader 会挂全局 define，UMD 会优先走 AMD 分支而不挂 window */
  try {
    delete g.define
  } catch {
    /* ignore */
  }
  try {
    if (typeof g.define !== 'undefined') g.define = undefined
  } catch {
    /* ignore */
  }
  return () => {
    try {
      if (hadModule) g.module = savedModule
      else delete g.module
    } catch {
      /* ignore */
    }
    try {
      if (hadExports) g.exports = savedExports
      else delete g.exports
    } catch {
      /* ignore */
    }
    try {
      if (hadDefine) g.define = savedDefine
      else delete g.define
    } catch {
      /* ignore */
    }
  }
}

/** 从可能被污染的全局 module.exports 里抢救 UMD 导出。 */
function gufaRecoverUmd(name) {
  try {
    const pollution = globalThis.module
    if (pollution === null || pollution === undefined || typeof pollution !== 'object') return undefined
    const exported = pollution.exports
    if (exported === null || exported === undefined) return undefined
    if (typeof exported === 'object') return exported[name]
    return undefined
  } catch {
    return undefined
  }
}

/** 在「隐藏 module/exports」的环境里注入并执行一个 UMD 脚本。 */
function gufaTermLoadUmdScript(id, src) {
  return new Promise((resolve, reject) => {
    const restore = gufaHideNodeGlobals()
    gufaTermLoadScript(id, src).then(
      () => {
        restore()
        resolve()
      },
      (error) => {
        restore()
        reject(error)
      },
    )
  })
}

/** 注入并等待一个 <script>；已成功加载过的直接复用。 */
function gufaTermLoadScript(id, src) {
  const existing = document.querySelector(`script[data-gufa="${id}"]`)
  if (existing !== null) {
    if (existing.dataset.loaded === '1') return Promise.resolve()
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`无法加载脚本：${src}`)), { once: true })
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.gufa = id
    script.addEventListener('load', () => {
      script.dataset.loaded = '1'
      resolve()
    }, { once: true })
    script.addEventListener('error', () => {
      script.remove()
      reject(new Error(`无法加载脚本：${src}`))
    }, { once: true })
    document.head.append(script)
  })
}

/** 注入 xterm.css 并等待样式加载完成（失败也继续，xterm 仍可用）。 */
function gufaTermIncludeCss() {
  const existing = document.querySelector(`link[data-gufa="${GUFA_TERM_CSS_ID}"]`)
  if (existing !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = G.asset('xterm/xterm.css')
    link.dataset.gufa = GUFA_TERM_CSS_ID
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => resolve(), { once: true })
    document.head.append(link)
  })
}

/** 读取 window.Terminal（含从被污染 module.exports 抢救）。 */
function gufaReadTerminalCtor() {
  if (typeof window.Terminal === 'function') return window.Terminal
  const recovered = gufaRecoverUmd('Terminal')
  if (typeof recovered === 'function') {
    window.Terminal = recovered
    return recovered
  }
  return undefined
}

/** 读取 window.FitAddon.FitAddon（含抢救）。 */
function gufaReadFitCtor() {
  const fit = window.FitAddon
  if (fit !== undefined && fit !== null) {
    if (typeof fit.FitAddon === 'function') return fit.FitAddon
    if (typeof fit === 'function') return fit
  }
  const recovered = gufaRecoverUmd('FitAddon')
  if (recovered !== undefined && recovered !== null) {
    if (typeof recovered.FitAddon === 'function') {
      window.FitAddon = recovered
      return recovered.FitAddon
    }
    if (typeof recovered === 'function') {
      window.FitAddon = { FitAddon: recovered }
      return recovered
    }
  }
  return undefined
}

/** 首次需要时注入 xterm.css / xterm.js / addon-fit.js。 */
function gufaTermLoadAssets() {
  if (gufaTermAssetsPromise !== null) return gufaTermAssetsPromise
  gufaTermAssetsPromise = (async () => {
    await gufaTermIncludeCss()
    // 清掉旧实例可能残留/误加载的脚本节点，在隐藏 module/exports 的环境下重新执行一次。
    for (const id of [GUFA_TERM_XTERM_ID, GUFA_TERM_FIT_ID]) {
      for (const node of Array.from(document.querySelectorAll(`script[data-gufa="${id}"]`))) node.remove()
    }
    await gufaTermLoadUmdScript(GUFA_TERM_XTERM_ID, G.asset('xterm/xterm.js'))
    await gufaTermLoadUmdScript(GUFA_TERM_FIT_ID, G.asset('xterm/addon-fit.js'))
    let TerminalCtor = gufaReadTerminalCtor()
    let FitCtor = gufaReadFitCtor()
    if (typeof TerminalCtor !== 'function') {
      // HMR/重复加载时偶发「脚本已执行但全局未挂上」：延迟后重新注入一次
      for (const node of Array.from(document.querySelectorAll(`script[data-gufa="${GUFA_TERM_XTERM_ID}"]`))) node.remove()
      await gufaTermLoadUmdScript(GUFA_TERM_XTERM_ID, G.asset('xterm/xterm.js'))
      TerminalCtor = gufaReadTerminalCtor()
    }
    if (typeof FitCtor !== 'function') {
      for (const node of Array.from(document.querySelectorAll(`script[data-gufa="${GUFA_TERM_FIT_ID}"]`))) node.remove()
      await gufaTermLoadUmdScript(GUFA_TERM_FIT_ID, G.asset('xterm/addon-fit.js'))
      FitCtor = gufaReadFitCtor()
    }
    if (typeof TerminalCtor !== 'function') throw new Error('xterm.js 已加载，但 window.Terminal 不可用')
    if (typeof FitCtor !== 'function') throw new Error('addon-fit.js 已加载，但 window.FitAddon.FitAddon 不可用')
    return { Terminal: TerminalCtor, FitAddon: FitCtor }
  })().catch((error) => {
    // 失败后允许下次挂载重试（脚本节点已在失败时移除）
    gufaTermAssetsPromise = null
    throw error
  })
  return gufaTermAssetsPromise
}

/* ── 主题 / 文本工具 ────────────────────────────────────────────────────── */
/** 解析 'rgb(...)' / 'rgba(...)' → [r,g,b,a]。 */
function gufaTermParseColor(value) {
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(String(value ?? '').trim())
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
}

function gufaTermHex(color) {
  const c = color ?? [0, 0, 0]
  return `#${[c[0], c[1], c[2]].map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')}`
}

function gufaTermHexAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha))
  return `${gufaTermHex(color)}${Math.round(a * 255).toString(16).padStart(2, '0')}`
}

/** 可选的皮肤调色板（跟随滑动变祖）。 */
function gufaTermPalette(props) {
  const palette = props.palette
  return palette !== null && palette !== undefined && typeof palette === 'object' ? palette : null
}

/**
 * xterm 的暗/亮主题调色板。
 * @param {string} mode 'dark' | 'light'
 * @param {object|null} palette 插件合成的实色调色板（优先于 mode）
 */
function gufaTermTheme(mode, palette) {
  const dark = palette !== null && palette !== undefined && typeof palette.isDark === 'boolean' ? palette.isDark : mode === 'dark'
  if (dark) {
    const darkTheme = {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#1e1e1e',
      selectionBackground: '#264f78',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5',
    }
    return gufaApplyPaletteToTermTheme(darkTheme, palette)
  }
  const light = {
    background: '#ffffff',
    foreground: '#333333',
    cursor: '#333333',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  }
  return gufaApplyPaletteToTermTheme(light, palette)
}

/** 把皮肤实色调色板叠加到 xterm 主题（背景/前景/光标/选区跟随滑动变祖）。 */
function gufaApplyPaletteToTermTheme(theme, palette) {
  if (palette === null || palette === undefined || typeof palette !== 'object') return theme
  const bg = gufaTermParseColor(palette.bg)
  const fg = gufaTermParseColor(palette.text)
  const accent = gufaTermParseColor(palette.accent !== undefined ? palette.accent : palette.text)
  if (bg !== null) {
    theme.background = gufaTermHex(bg)
    theme.cursorAccent = gufaTermHex(bg)
  }
  if (fg !== null) {
    theme.foreground = gufaTermHex(fg)
    theme.cursor = gufaTermHex(fg)
  }
  if (accent !== null) {
    theme.cursor = gufaTermHex(accent)
    theme.selectionBackground = gufaTermHexAlpha(accent, 0.34)
  }
  return theme
}

/** 降级模式下去掉常见 ANSI 控制序列，保留可读文本。 */
function gufaTermStripEscapes(text) {
  return String(text)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

/** 文本的 UTF-8 字节数（用于 since 偏移计数；纯 ASCII 直接取长度，避免频繁分配）。 */
function gufaTermByteLength(text) {
  if (!/[^\x00-\x7f]/.test(text)) return text.length
  try {
    return new TextEncoder().encode(text).length
  } catch {
    return text.length
  }
}

/** xterm 在回放历史输出时可能自动应答查询序列；回放窗口内忽略这些应答，避免污染 shell 输入。 */
function gufaTermIsProtocolReply(data) {
  return /^\x1b\](?:10|11|12);(?:rgb:[\da-f]{4}\/[\da-f]{4}\/[\da-f]{4}|#[\da-f]{6})(?:\x07|\x1b\\)$/i.test(data)
    || /^\x1b\[\??[\d;]*[cR]$/.test(data)
}

/** 根据容器像素尺寸估算初始 cols/rows（xterm 挂载前的创建请求用）。 */
function gufaTermEstimateSize(width, height) {
  const cols = Math.floor((Math.max(0, width) - 12) / 7.5)
  const rows = Math.floor((Math.max(0, height) - 12) / 17)
  return {
    cols: Math.max(20, Math.min(300, cols)),
    rows: Math.max(5, Math.min(120, rows)),
  }
}

/** 终端标签页。 */
function GufaTerminalTab(props) {
  const session = props.session
  return h(
    'div',
    {
      role: 'tab',
      'aria-selected': props.active ? 'true' : 'false',
      className: 'gufa-tab',
      'data-active': props.active ? 'true' : undefined,
      title: session.title,
      onClick: props.onSelect,
      style: { flex: '0 0 auto', height: 30, maxWidth: 190, opacity: session.exited ? 0.62 : 1 },
    },
    h(G.Icon, { name: 'terminal', size: 12 }),
    h('span', { className: 'gufa-tab-name', style: { fontSize: 11.5 } }, session.title || G.translate('terminal.session')),
    h(
      'button',
      {
        type: 'button',
        className: 'gufa-tab-close',
        title: G.translate('terminal.close'),
        'aria-label': G.translate('terminal.close'),
        onClick: (event) => {
          event.stopPropagation()
          props.onClose()
        },
      },
      h(G.Icon, { name: 'close', size: 10 }),
    ),
  )
}

/**
 * 单个终端视图：xterm 或降级纯文本；每个视图自己持有 xterm 实例与 WS 连接。
 * 父组件始终渲染所有标签，非活动标签 display:none，以保留各自滚动位置与状态。
 */
function GufaTerminalView(props) {
  const t = G.useT()
  const session = props.session
  const hostRef = useRef(null)
  const preRef = useRef(null)
  const inputRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const openerRef = useRef(null)
  const channelRef = useRef(null)
  const ticketRef = useRef(null)
  const activeRef = useRef(props.active === true)
  const themeRef = useRef(props.theme)
  const palette = gufaTermPalette(props)
  const paletteRef = useRef(palette)
  paletteRef.current = palette
  const paletteKey = palette === null
    ? ''
    : [palette.bg, palette.text, palette.layer, palette.accent, palette.isDark].join('|')
  const [fallback, setFallback] = useState(false)
  const [output, setOutput] = useState('')
  const [notice, setNotice] = useState('')
  const [connected, setConnected] = useState(false)
  const [exited, setExited] = useState(session.exited === true)
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    themeRef.current = props.theme
    const term = termRef.current
    if (term === null) return
    const theme = gufaTermTheme(props.theme, palette)
    gufaTermDebug('terminal-theme', `apply palette=${palette !== null} bg=${String(theme.background)}`)
    try {
      term.options.theme = theme
    } catch {
      try {
        if (typeof term.setOption === 'function') term.setOption('theme', theme)
      } catch {
        /* 老版本 xterm 不支持即时换主题时忽略 */
      }
    }
  }, [props.theme, paletteKey])

  useEffect(() => {
    if (props.assets.status === 'loading') return undefined
    const fallbackMode = props.assets.status !== 'ready'
    setFallback(fallbackMode)
    const root = props.root
    const terminalId = session.id
    let disposed = false
    /** 'xterm' | 'fallback'：运行期若 xterm 创建失败会切到 fallback。 */
    let mode = fallbackMode ? 'fallback' : 'xterm'
    let term = null
    let fit = null
    let streamAbort = null
    let streamEnded = false
    let inputChain = Promise.resolve()
    let retryTimer = null
    let openFrame = 0
    let openRetries = 0
    let fitFrame = 0
    let observer = null
    let replayTimer = null
    let replaying = false
    let attempts = 0
    let settled = false
    let fatal = false
    let receivedBytes = 0
    let pendingOutput = ''
    let loggedFirstOutput = false
    let loggedFirstInput = false
    let loggedFirstMessage = false
    let loggedRawMessages = 0
    const outbox = []

    const setNoticeSafe = (message) => {
      if (!disposed) setNotice(message)
    }

    const postInput = (data) => {
      if (typeof data !== 'string' || data === '') return
      const body = { root: root === null ? '' : root, id: terminalId, data }
      inputChain = inputChain
        .then(() => G.api('terminal.input', body))
        .catch((error) => {
          gufaTermDebug('terminal-io', `input-failed ${G.errorText(error)}`)
          scheduleReconnect()
        })
    }

    const postResize = (cols, rows) => {
      if (typeof cols !== 'number' || typeof rows !== 'number') return
      const body = { root: root === null ? '' : root, id: terminalId, cols, rows }
      inputChain = inputChain.then(() => G.api('terminal.resize', body)).catch(() => {})
    }

    const writeTerm = (data) => {
      if (term !== null) {
        try {
          term.write(data)
        } catch {
          /* xterm 可能正在销毁 */
        }
        return
      }
      pendingOutput += data
      if (pendingOutput.length > 512 * 1024) pendingOutput = pendingOutput.slice(-512 * 1024)
    }

    const appendFallback = (data) => {
      const text = gufaTermStripEscapes(data)
      if (text === '') return
      setOutput((current) => {
        const next = current + text
        return next.length > 200 * 1024 ? next.slice(-200 * 1024) : next
      })
    }

    const writeOutput = (data) => {
      if (mode === 'xterm') writeTerm(data)
      else appendFallback(data)
    }

    const writeNoticeLine = (message) => {
      setNoticeSafe(message)
      const line = `\r\n\x1b[31m${message}\x1b[0m\r\n`
      if (mode === 'xterm') writeTerm(line)
      else appendFallback(line)
    }

    const fitNow = () => {
      if (fit === null || term === null || disposed) return
      const host = hostRef.current
      if (host === null || host.clientWidth <= 0 || host.clientHeight <= 0) return
      try {
        fit.fit()
      } catch {
        /* 布局切换的中间帧可能失败，等下一次 ResizeObserver */
      }
    }

    const sendCurrentSize = () => {
      if (term !== null) postResize(term.cols, term.rows)
    }

    const handleValue = (value) => {
      if (disposed) return
      if (value === null || typeof value !== 'object') return
      if (!loggedFirstMessage) {
        loggedFirstMessage = true
        gufaTermDebug('terminal-io', `first-message type=${value.type}`)
      }
      if (value.type === 'output') {
        if (!loggedFirstOutput) {
          loggedFirstOutput = true
          gufaTermDebug('terminal-io', `first-output len=${typeof value.data === 'string' ? value.data.length : 0}`)
        }
        if (typeof value.data !== 'string' || value.data === '') return
        const bytes = gufaTermByteLength(value.data)
        if (typeof value.offset === 'number' && Number.isFinite(value.offset)) receivedBytes = value.offset + bytes
        else receivedBytes += bytes
        if (value.replay === true) {
          replaying = true
          if (replayTimer !== null) clearTimeout(replayTimer)
          replayTimer = window.setTimeout(() => {
            replayTimer = null
            replaying = false
          }, 600)
        }
        writeOutput(value.data)
        return
      }
      if (value.type === 'reset') {
        receivedBytes = 0
        pendingOutput = ''
        if (term !== null) {
          try {
            term.reset()
          } catch {
            /* ignore */
          }
        } else {
          setOutput('')
        }
        return
      }
      if (value.type === 'hello' || value.type === 'hello2' || value.type === 'pong' || value.type === 'ready') {
        return
      }
      if (value.type === 'exit') {
        settled = true
        const code = typeof value.code === 'number' ? value.code : null
        const label = code === null ? t('terminal.exited') : `${t('terminal.exited')} (${code})`
        writeOutput(`\r\n\x1b[2m[${label}]\x1b[0m\r\n`)
        setExited(true)
        if (term !== null) {
          try {
            term.options.disableStdin = true
          } catch {
            /* ignore */
          }
        }
        props.onExit(terminalId, code)
        if (streamAbort !== null) {
          try {
            streamAbort()
          } catch {
            /* ignore */
          }
        }
        return
      }
      if (value.type === 'error') {
        gufaTermDebug('terminal-ws', `server-error ${typeof value.message === 'string' ? value.message : 'unknown'}`)
        fatal = true
        settled = true
        writeNoticeLine(typeof value.message === 'string' && value.message !== '' ? value.message : t('common.error'))
        setExited(true)
        if (term !== null) {
          try {
            term.options.disableStdin = true
          } catch {
            /* ignore */
          }
        }
        props.onExit(terminalId, null)
      }
    }

    const scheduleReconnect = () => {
      if (disposed || settled || fatal || streamEnded) return
      attempts += 1
      if (attempts > 8) {
        writeNoticeLine(t('common.error'))
        return
      }
      const delay = Math.min(5000, 400 * attempts)
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        startStream()
      }, delay)
    }

    /* ── 传输：直连真实 Host 端口的 SSE（带票据）──────────────────────────
     * 桌面壳页面源是 dsh-app://app：
     *  - 相对路径 fetch 会走自定义协议，响应只能整体缓冲 → 不适合流；
     *  - 直连 ws:// 时 Chromium 上行可发、下行帧不达；
     * 于是输出用「真实 Host 基址 + 票据」的 SSE，输入/尺寸仍走相对路径 POST。 */
    const handleStreamEvent = (event) => {
      if (disposed) return
      if (event === null || typeof event !== 'object') return
      if (loggedRawMessages < 6) {
        loggedRawMessages += 1
        gufaTermDebug('terminal-io', `event#${loggedRawMessages} type=${event.type}`)
      }
      handleValue(event)
      if (event.type === 'ready') {
        attempts = 0
        setConnected(true)
        fitNow()
        if (term !== null) postResize(term.cols, term.rows)
        if (activeRef.current === true && term !== null) {
          try {
            term.focus()
          } catch {
            /* ignore */
          }
        }
      }
    }

    const openStream = (ticket, since) => {
      if (disposed) return
      let base = location.href
      try {
        base = typeof G.serverBase === 'function' ? G.serverBase() : location.href
        const url = new URL('gufa-code/terminal-stream', base)
        url.searchParams.set('ticket', ticket)
        url.searchParams.set('root', root === null ? '' : root)
        url.searchParams.set('id', terminalId)
        if (since !== undefined) url.searchParams.set('since', String(since))
        const controller = new AbortController()
        streamAbort = () => controller.abort()
        gufaTermDebug('terminal-stream', `open ${url.origin} since=${since === undefined ? 'none' : since}`)
        void (async () => {
          try {
            const response = await fetch(url.href, { method: 'GET', mode: 'cors', signal: controller.signal })
            if (!response.ok || response.body === null) {
              gufaTermDebug('terminal-stream', `http ${response.status}`)
              if (!controller.signal.aborted) {
                setConnected(false)
                scheduleReconnect()
              }
              return
            }
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            for (;;) {
              const { value, done } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              let index
              while ((index = buffer.indexOf('\n\n')) >= 0) {
                const chunk = buffer.slice(0, index)
                buffer = buffer.slice(index + 2)
                for (const line of chunk.split('\n')) {
                  if (!line.startsWith('data: ')) continue
                  let event
                  try {
                    event = JSON.parse(line.slice(6))
                  } catch {
                    continue
                  }
                  handleStreamEvent(event)
                }
              }
            }
            if (!controller.signal.aborted) {
              setConnected(false)
              scheduleReconnect()
            }
          } catch (error) {
            if (controller.signal.aborted) return
            gufaTermDebug('terminal-stream', `failed ${G.errorText(error)}`)
            setConnected(false)
            scheduleReconnect()
          }
        })()
      } catch (error) {
        gufaTermDebug('terminal-stream', `url-failed ${G.errorText(error)}`)
        scheduleReconnect()
      }
    }

    const startStream = () => {
      if (disposed) return
      if (streamAbort !== null) {
        try {
          streamAbort()
        } catch {
          /* ignore */
        }
        streamAbort = null
      }
      streamEnded = false
      const since = receivedBytes > 0 ? receivedBytes : undefined
      G.api('terminal.wsTicket', {})
        .then((value) => {
          if (disposed) return
          const ticket = value !== null && value !== undefined && typeof value.ticket === 'string' ? value.ticket : ''
          if (ticket === '') {
            scheduleReconnect()
            return
          }
          openStream(ticket, since)
        })
        .catch((error) => {
          gufaTermDebug('terminal-stream', `ticket-failed ${G.errorText(error)}`)
          scheduleReconnect()
        })
    }

    /* xterm 容器可能因为父面板隐藏而暂时 0 尺寸：等布局可用后再 open。 */
    const tryOpen = () => {
      openFrame = 0
      if (disposed || mode !== 'xterm' || term !== null) return
      const host = hostRef.current
      if (host === null) return
      if (host.clientWidth <= 0 || host.clientHeight <= 0) {
        if (openRetries < 600) {
          openRetries += 1
          openFrame = window.requestAnimationFrame(tryOpen)
        }
        return
      }
      gufaTermDebug('terminal-xterm', `open host=${host.clientWidth}x${host.clientHeight} palette=${palette !== null} isDark=${palette === null ? '?' : palette.isDark === true}`)
      try {
        const terminal = new props.assets.Terminal({
          allowProposedApi: false,
          convertEol: false,
          cursorBlink: true,
          cursorStyle: 'bar',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: 12.5,
          lineHeight: 1.15,
          scrollback: 5000,
          theme: gufaTermTheme(themeRef.current, paletteRef.current),
        })
        term = terminal
        termRef.current = terminal
        try {
          fit = new props.assets.FitAddon()
          term.loadAddon(fit)
          fitRef.current = fit
        } catch {
          fit = null
          fitRef.current = null
        }
        term.open(host)
        if (pendingOutput !== '') {
          const data = pendingOutput
          pendingOutput = ''
          terminal.write(data)
        }
        terminal.onData((data) => {
          if (replaying && gufaTermIsProtocolReply(data)) return
          if (!loggedFirstInput) {
            loggedFirstInput = true
            gufaTermDebug('terminal-io', `first-key len=${data.length}`)
          }
          const channel = channelRef.current
          if (channel !== null) channel.send(data)
        })
        terminal.onResize(({ cols, rows }) => {
          if (replaying) return
          postResize(cols, rows)
        })
        try {
          if (typeof terminal.onTitleChange === 'function') {
            terminal.onTitleChange((title) => {
              if (typeof title === 'string' && title.trim() !== '') props.onTitle(terminalId, title.trim())
            })
          }
        } catch {
          /* 标题同步失败不影响使用 */
        }
        const onPointerDown = () => {
          try {
            terminal.focus()
          } catch {
            /* ignore */
          }
          gufaTermDebug('terminal-focus', `pointerdown active=${document.activeElement === null ? 'null' : (document.activeElement.tagName ?? '?')}`)
        }
        host.addEventListener('pointerdown', onPointerDown, true)
        try {
          terminal.focus()
        } catch {
          /* ignore */
        }
        gufaTermDebug('terminal-focus', `focused active=${document.activeElement === null ? 'null' : (document.activeElement.tagName ?? '?')}`)
        observer = new ResizeObserver(() => {
          if (fitFrame !== 0) return
          fitFrame = window.requestAnimationFrame(() => {
            fitFrame = 0
            fitNow()
          })
        })
        observer.observe(host)
        fitNow()
        sendCurrentSize()
      } catch (error) {
        gufaTermDebug('terminal-xterm', `open-failed ${G.errorText(error)}`)
        mode = 'fallback'
        if (term !== null) {
          try {
            term.dispose()
          } catch {
            /* ignore */
          }
          term = null
          termRef.current = null
          fit = null
          fitRef.current = null
        }
        if (observer !== null) {
          try {
            observer.disconnect()
          } catch {
            /* ignore */
          }
          observer = null
        }
        setFallback(true)
        setNoticeSafe(G.errorText(error))
      }
    }

    const offClearRequest = G.bus === null || G.bus === undefined ? () => {} : G.bus.on(`terminal:clear:${terminalId}`, () => {
      pendingOutput = ''
      if (term !== null) {
        try {
          term.clear()
        } catch {
          try {
            term.reset()
          } catch {
            /* ignore */
          }
        }
        if (activeRef.current === true) {
          try {
            term.focus()
          } catch {
            /* ignore */
          }
        }
      }
      setOutput('')
    })

    const channel = {
      /** 写入当前终端（WS 未连接时先排队）。 */
      send(data) {
        postInput(data)
      },
      fit() {
        fitNow()
        sendCurrentSize()
      },
      focus() {
        if (term !== null) {
          try {
            term.focus()
          } catch {
            /* ignore */
          }
        } else if (inputRef.current !== null) {
          inputRef.current.focus()
        }
      },
    }
    channelRef.current = channel
    /** 隐藏标签首次挂载时容器为 0 尺寸，切为活动标签后由这里补一次 open 尝试。 */
    openerRef.current = () => {
      if (term !== null || mode !== 'xterm' || disposed) return
      if (openFrame !== 0) return
      openRetries = 0
      openFrame = window.requestAnimationFrame(tryOpen)
    }
    props.register(terminalId, channel)

    startStream()
    if (mode === 'xterm') tryOpen()

    return () => {
      disposed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      if (replayTimer !== null) clearTimeout(replayTimer)
      if (openFrame !== 0) window.cancelAnimationFrame(openFrame)
      if (fitFrame !== 0) window.cancelAnimationFrame(fitFrame)
      if (observer !== null) {
        try {
          observer.disconnect()
        } catch {
          /* ignore */
        }
      }
      if (streamAbort !== null) {
        try {
          streamAbort()
        } catch {
          /* ignore */
        }
        streamAbort = null
      }
      try {
        offClearRequest()
      } catch {
        /* ignore */
      }
      channelRef.current = null
      openerRef.current = null
      props.unregister(terminalId)
      if (term !== null) {
        try {
          term.dispose()
        } catch {
          /* ignore */
        }
      }
      term = null
      termRef.current = null
      fit = null
      fitRef.current = null
    }
    // assets/root/session.id 变化时重建连接与终端；回调由父组件保证稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.assets.status, props.root, session.id])

  /* 切到活动标签：重新 fit（父容器此时可见）并聚焦；隐藏时不打扰。 */
  useEffect(() => {
    activeRef.current = props.active === true
    if (props.active !== true || props.visible === false) return undefined
    if (fallback) {
      if (inputRef.current !== null) inputRef.current.focus()
      return undefined
    }
    const frame = window.requestAnimationFrame(() => {
      if (openerRef.current !== null) openerRef.current()
      const fit = fitRef.current
      if (fit !== null) {
        try {
          fit.fit()
        } catch {
          /* ignore */
        }
      }
      const term = termRef.current
      if (term !== null) {
        try {
          term.focus()
        } catch {
          /* ignore */
        }
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [props.active, props.visible, fallback, props.assets.status])

  /* 降级模式输出自动滚到底部（用户向上翻阅时不打扰）。 */
  useEffect(() => {
    const node = preRef.current
    if (node === null) return
    const pinned = node.scrollTop + node.clientHeight >= node.scrollHeight - 48
    if (pinned) node.scrollTop = node.scrollHeight
  }, [output])

  const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
  const fallbackTheme = gufaTermTheme(props.theme, palette)
  const background = fallbackTheme.background
  const foreground = fallbackTheme.foreground

  const body = fallback
    ? h(
        React.Fragment,
        null,
        h(
          'pre',
          {
            ref: preRef,
            className: 'gufa-scroll',
            style: {
              flex: '1 1 auto',
              minHeight: 0,
              margin: 0,
              padding: '8px 10px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: monoFont,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: foreground,
              background,
            },
          },
          output,
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderTop: '1px solid var(--gufa-border)', background } },
          h('span', { style: { color: foreground, opacity: 0.6, fontFamily: monoFont, fontSize: 12 } }, '$'),
          h('input', {
            ref: inputRef,
            className: 'gufa-input',
            value: inputValue,
            spellCheck: false,
            autoComplete: 'off',
            autoCapitalize: 'off',
            placeholder: t('terminal.session'),
            onChange: (event) => setInputValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const value = inputValue
              setInputValue('')
              const channel = channelRef.current
              if (channel !== null) channel.send(value === '' ? '\r' : `${value}\r`)
            },
            style: { flex: '1 1 auto', fontFamily: monoFont, fontSize: 12, height: 26 },
          }),
          h(
            G.IconButton,
            {
              title: t('chat.send'),
              onClick: () => {
                const value = inputValue
                setInputValue('')
                const channel = channelRef.current
                if (channel !== null) channel.send(value === '' ? '\r' : `${value}\r`)
              },
            },
            h(G.Icon, { name: 'arrow-right', size: 13 }),
          ),
        ),
      )
    : h('div', { ref: hostRef, style: { position: 'absolute', top: 4, right: 2, bottom: 2, left: 6 } })

  return h(
    'div',
    {
      style: {
        display: props.active === true ? 'flex' : 'none',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
        position: 'relative',
        background,
      },
    },
    body,
    notice !== ''
      ? h(
          'div',
          {
            style: {
              position: 'absolute',
              top: 6,
              left: 8,
              right: 8,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 11.5,
              color: 'var(--dsw-alias-state-error-primary)',
              background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-overlay, #fff))',
              border: '1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, transparent)',
            },
          },
          h(G.Icon, { name: 'warn', size: 12 }),
          h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, notice),
          h(
            G.IconButton,
            { title: t('common.close'), onClick: () => setNotice(''), style: { width: 20, height: 20 } },
            h(G.Icon, { name: 'close', size: 11 }),
          ),
        )
      : null,
    !connected && !fallback && !exited && notice === ''
      ? h(
          'div',
          { style: { position: 'absolute', right: 10, bottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: foreground, opacity: 0.55, fontSize: 11, pointerEvents: 'none' } },
          h(G.Spinner),
          t('common.loading'),
        )
      : null,
  )
}

/* ── 终端面板 ───────────────────────────────────────────────────────────── */
G.TerminalPane = function TerminalPane(props) {
  const t = G.useT()
  const root = typeof props.root === 'string' && props.root !== '' ? props.root : null
  const theme = props.theme === 'light' ? 'light' : 'dark'
  const visible = props.visible !== false
  const [assets, setAssets] = useState({ status: 'loading', Terminal: null, FitAddon: null, error: '' })
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const rootRef = useRef(root)
  const sizeRef = useRef(null)
  const tabStripRef = useRef(null)
  const channelsRef = useRef(new Map())
  const pendingInputRef = useRef([])
  const sessionsRef = useRef(sessions)
  const activeRef = useRef(activeId)
  const creatingRef = useRef(false)
  const bootRef = useRef(0)
  const aliveRef = useRef(true)
  rootRef.current = root

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])
  useEffect(() => () => {
    aliveRef.current = false
  }, [])

  /* xterm 资产：首次挂载按需加载，失败降级。 */
  useEffect(() => {
    let cancelled = false
    gufaTermLoadAssets()
      .then((value) => {
        if (cancelled) return
        setAssets({ status: 'ready', Terminal: value.Terminal, FitAddon: value.FitAddon, error: '' })
      })
      .catch((loadError) => {
        gufaTermDebug('terminal-assets', `failed ${G.errorText(loadError)}`)
        if (cancelled) return
        setAssets({ status: 'failed', Terminal: null, FitAddon: null, error: G.errorText(loadError) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** 把队列里的输入写入当前活动终端。 */
  const drainPending = () => {
    if (pendingInputRef.current.length === 0) return
    const id = activeRef.current
    const channel = id === null ? undefined : channelsRef.current.get(id)
    if (channel === undefined) return
    const queue = pendingInputRef.current
    pendingInputRef.current = []
    for (const text of queue) channel.send(text)
  }

  const createSession = useCallback(async (generation = bootRef.current) => {
    const targetRoot = rootRef.current
    if (targetRoot === null || creatingRef.current) return null
    creatingRef.current = true
    setCreating(true)
    try {
      const box = sizeRef.current
      const dims = gufaTermEstimateSize(box === null ? 0 : box.clientWidth, box === null ? 0 : box.clientHeight)
      const value = await G.api('terminal.create', { root: targetRoot, cols: dims.cols, rows: dims.rows })
      // 组件已卸载 / 创建期间项目或挂载代次已变：回收这个孤儿终端
      if (!aliveRef.current || bootRef.current !== generation || rootRef.current !== targetRoot) {
        void G.api('terminal.close', { root: targetRoot, id: value.id }).catch(() => {})
        return null
      }
      const created = {
        id: value.id,
        title: typeof value.title === 'string' && value.title !== '' ? value.title : G.translate('terminal.session'),
        exited: false,
        exitCode: null,
      }
      setSessions((current) => (current.some((item) => item.id === created.id) ? current : [...current, created]))
      setActiveId((current) => current ?? created.id)
      setError('')
      return created
    } catch (createError) {
      gufaTermDebug('terminal-create', `failed ${G.errorText(createError)}`)
      if (aliveRef.current) setError(G.errorText(createError))
      return null
    } finally {
      creatingRef.current = false
      if (aliveRef.current) setCreating(false)
    }
  }, [])

  /* 根目录变化：恢复该项目的终端列表，没有则建第一个。 */
  useEffect(() => {
    const generation = ++bootRef.current
    const stale = () => !aliveRef.current || bootRef.current !== generation || rootRef.current !== root
    setError('')
    if (root === null) {
      setSessions([])
      setActiveId(null)
      return undefined
    }
    setSessions([])
    setActiveId(null)
    ;(async () => {
      try {
        const value = await G.api('terminal.list', { root })
        if (stale()) return
        const list = Array.isArray(value?.terminals) ? value.terminals : []
        if (list.length === 0) {
          await createSession(generation)
          return
        }
        const restored = []
        for (const item of list) {
          if (item === null || typeof item !== 'object' || typeof item.id !== 'string') continue
          restored.push({
            id: item.id,
            title: typeof item.title === 'string' && item.title !== '' ? item.title : G.translate('terminal.session'),
            exited: item.alive !== true,
            exitCode: typeof item.exitCode === 'number' ? item.exitCode : null,
          })
        }
        setSessions(restored)
        if (restored.length > 0) setActiveId(restored[0].id)
      } catch (listError) {
        if (stale()) return
        setError(G.errorText(listError))
      }
    })()
    return undefined
  }, [root, createSession])

  /* 快捷键：清除当前终端内容 / 新建终端。 */
  useEffect(() => {
    if (G.bus === null || G.bus === undefined) return undefined
    const offClear = G.bus.on('terminal:clear', () => {
      const id = activeRef.current
      if (id === null) return
      G.bus.emit(`terminal:clear:${id}`)
    })
    const offNew = G.bus.on('terminal:new', () => {
      void createSession()
    })
    return () => {
      try {
        offClear()
      } catch {
        /* ignore */
      }
      try {
        offNew()
      } catch {
        /* ignore */
      }
    }
  }, [createSession])

  /* G.bus 'terminal:send'（SSH 快捷连接等）：写入当前终端；没有终端时先建一个。 */
  useEffect(() => {
    return G.bus.on('terminal:send', (detail) => {
      const text = detail !== null && typeof detail === 'object' && typeof detail.text === 'string' ? detail.text : ''
      if (text === '') return
      pendingInputRef.current.push(text)
      drainPending()
      if (rootRef.current !== null && sessionsRef.current.length === 0 && !creatingRef.current) void createSession()
    })
    // drainPending 只依赖 ref，无需列为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSession])

  /* 标签过多时把活动标签滚入可视区。 */
  useEffect(() => {
    const node = tabStripRef.current
    if (node === null || typeof node.querySelector !== 'function') return
    const activeTab = node.querySelector('[data-active="true"]')
    if (activeTab !== null && typeof activeTab.scrollIntoView === 'function') {
      try {
        activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      } catch {
        /* 老浏览器忽略 */
      }
    }
  }, [activeId, sessions.length])

  /* 活动终端变化后补发排队输入。 */
  useEffect(() => {
    activeRef.current = activeId
    drainPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, sessions.length])

  const registerChannel = useCallback((id, channel) => {
    channelsRef.current.set(id, channel)
    if (activeRef.current === null || activeRef.current === id) drainPending()
  }, [])
  const unregisterChannel = useCallback((id) => {
    channelsRef.current.delete(id)
  }, [])

  const closeSession = useCallback((id) => {
    const targetRoot = rootRef.current
    const remaining = sessionsRef.current.filter((item) => item.id !== id)
    setSessions(remaining)
    setActiveId((current) => {
      if (current !== id) return current
      return remaining.length === 0 ? null : remaining[remaining.length - 1].id
    })
    if (targetRoot !== null) {
      void G.api('terminal.close', { root: targetRoot, id }).catch((closeError) => {
        if (aliveRef.current) setError(G.errorText(closeError))
      })
    }
  }, [])

  const handleExit = useCallback((id, code) => {
    setSessions((current) => current.map((item) => (item.id === id ? { ...item, exited: true, exitCode: typeof code === 'number' ? code : null } : item)))
  }, [])

  const handleTitle = useCallback((id, title) => {
    setSessions((current) => {
      let changed = false
      const next = current.map((item) => {
        if (item.id !== id) return item
        if (item.title === title) return item
        changed = true
        return { ...item, title }
      })
      return changed ? next : current
    })
  }, [])

  const height = typeof props.height === 'number' && props.height > 0 ? props.height : 230
  const tabStrip = []
  for (const session of sessions) {
    tabStrip.push(
      h(GufaTerminalTab, {
        key: session.id,
        session,
        active: session.id === activeId,
        onSelect: () => setActiveId(session.id),
        onClose: () => closeSession(session.id),
      }),
    )
  }

  const body = (() => {
    if (root === null) {
      return h(G.Empty, { icon: 'terminal', title: t('explorer.openProjectFirst'), hint: t('app.noProjectHint') })
    }
    if (assets.status === 'loading') {
      return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: '100%', color: 'var(--gufa-text-dim)', fontSize: 12 } }, h(G.Spinner), t('common.loading'))
    }
    if (sessions.length === 0) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: '100%' } },
        h(G.Button, { icon: 'plus', disabled: creating, onClick: () => void createSession() }, t('terminal.new')),
      )
    }
    const views = []
    for (const session of sessions) {
      views.push(
        h(GufaTerminalView, {
          key: session.id,
          session,
          root,
          active: session.id === activeId,
          visible,
          theme,
          palette: props.palette,
          assets,
          register: registerChannel,
          unregister: unregisterChannel,
          onExit: handleExit,
          onTitle: handleTitle,
        }),
      )
    }
    return views
  })()

  const canCreate = root !== null && assets.status !== 'loading' && sessions.length < 8 && creating !== true

  return h(
    'div',
    {
      style: {
        height,
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        borderTop: '1px solid var(--gufa-border)',
        background: 'var(--gufa-bg)',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 32,
          padding: '0 6px 0 8px',
          flex: '0 0 auto',
          borderBottom: '1px solid var(--gufa-border)',
          background: 'var(--gufa-layer)',
          minWidth: 0,
        },
      },
      h(G.Icon, { name: 'terminal', size: 13 }),
      h('span', { style: { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--gufa-text-dim)', whiteSpace: 'nowrap', marginRight: 2 } }, t('terminal.title')),
      h('div', { ref: tabStripRef, style: { display: 'flex', alignItems: 'stretch', gap: 2, flex: '1 1 auto', minWidth: 0, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' } }, tabStrip),
      h(
        G.IconButton,
        { title: t('terminal.new'), disabled: canCreate !== true, onClick: () => void createSession() },
        h(G.Icon, { name: 'plus', size: 13 }),
      ),
      h(
        G.IconButton,
        { title: t('common.close'), onClick: () => props.onToggleHeight?.() },
        h(G.Icon, { name: 'chevron-down', size: 12 }),
      ),
    ),
    error !== ''
      ? h(
          'div',
          { className: 'gufa-error-banner', style: { margin: '4px 8px', flex: '0 0 auto' } },
          h(G.Icon, { name: 'warn', size: 12 }),
          h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, error),
          h(G.IconButton, { title: t('common.close'), onClick: () => setError('') }, h(G.Icon, { name: 'close', size: 11 })),
        )
      : null,
    assets.status === 'failed'
      ? h(
          'div',
          { className: 'gufa-error-banner', style: { margin: '4px 8px', flex: '0 0 auto' } },
          h(G.Icon, { name: 'warn', size: 12 }),
          h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, `${t('common.error')}: ${assets.error}`),
        )
      : null,
    h(
      'div',
      { ref: sizeRef, style: { position: 'relative', flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: theme === 'dark' ? '#1e1e1e' : '#ffffff' } },
      body,
    ),
  )
}


/* ─────────────────────── 40-chat.js ─────────────────────── */
/**
 * 40-chat：右侧「古法 AI」聊天面板。
 *
 * 结构：
 *   1. 纯函数（可单测）：localStorage 会话存取、markdown-lite 解析、请求体上下文拼装；
 *   2. 小组件：markdown 文本、代码块（复制/插入）、消息气泡；
 *   3. 主组件 G.ChatPanel(props)：会话列表 + 流式对话 + 上下文 chips + 快捷提问。
 *
 * props: { project, activeFile, selection, theme, onInsertCode, width }
 *   project:    { root, name } | null
 *   activeFile: { path, content, language } | null
 *   selection:  { text, path, line, column } | null
 *   onInsertCode(code)  由 App 实现，通过 G.bus 'editor:insert' 插入编辑器
 *
 * 与 Host 的协议（host/chat.js）：
 *   G.api('chat.info')  → { provider, model, ready }
 *   G.stream('chat.stream', { messages: [{ role, content }], context }, onEvent)
 *     事件：{type:'delta', text} / {type:'thinking'} / {type:'done'} / {type:'error', message}
 *
 * 本文件只依赖 G.*（不 import 任何 Harness Client 包），在 build-client.mjs 的
 * factory 作用域内执行，因此可直接使用 h / hooks。
 */

/* ── 常量 ─────────────────────────────────────────────────────────────── */

const GUFA_CHAT_CONVERSATION_LIMIT = 30
const GUFA_CHAT_MESSAGE_LIMIT = 120
const GUFA_CHAT_MESSAGE_CHAR_LIMIT = 60_000
/** 客户端兜底看门狗：Host 120 秒超时后一定会发终止事件，超过这个时间还没收到就本地收尾。 */
const GUFA_CHAT_WATCHDOG_MS = 150_000
const GUFA_CHAT_STORAGE_PREFIX = 'gufa-code:chat:v1:'

/** 核心词典里没有的少量文案（插件以中文为主，缺失 key 时用这里的回退）。 */
const GUFA_CHAT_LABELS = {
  notReady: '未就绪',
  emptyReply: '（模型没有返回内容）',
  stopped: '（已停止）',
  ctrlHint: 'Enter 发送 · Shift+Enter 换行',
  openFileHint: '打开文件后可附带上下文',
  newConversation: '新对话',
  clearHint: '清空当前对话',
}

/** 聊天面板专用样式（注入一次，卸载时移除）。 */
const GUFA_CHAT_CSS = `
.gufa-chat-wrap{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}
.gufa-chat-headwrap{position:relative;flex:0 0 auto;z-index:20}
.gufa-chat-head{gap:6px}
.gufa-chat-head .gufa-panel-head-title{flex:1 1 auto}
.gufa-chat-model{flex:0 1 auto;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:9.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--gufa-text-dim);
  padding:2px 6px;border:1px solid var(--gufa-border);border-radius:6px;background:var(--gufa-layer2)}
.gufa-chat-model[data-warn]{color:var(--dsw-alias-state-warning-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 40%,transparent)}
.gufa-chat-history{position:absolute;top:34px;left:0;right:0;display:flex;flex-direction:column;
  border-top:1px solid var(--gufa-border);border-bottom:1px solid var(--gufa-border-strong);
  background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 30px color-mix(in srgb,#000 30%,transparent);z-index:30}
.gufa-chat-history-head{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;font-size:10px;
  letter-spacing:.08em;text-transform:uppercase;color:var(--gufa-text-dim);border-bottom:1px solid var(--gufa-border)}
.gufa-chat-history-list{display:flex;flex-direction:column;max-height:260px;overflow:auto;padding:4px}
.gufa-chat-history-empty{padding:14px 10px;font-size:11.5px;color:var(--gufa-text-dim);text-align:center}
.gufa-chat-history-item{display:flex;align-items:center;gap:4px;border-radius:6px;min-width:0}
.gufa-chat-history-item:hover{background:var(--gufa-hover)}
.gufa-chat-history-item[data-active]{background:var(--gufa-active)}
.gufa-chat-history-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;align-items:flex-start;
  padding:5px 8px;border:0;background:transparent;color:var(--gufa-text);cursor:pointer;text-align:left}
.gufa-chat-history-title{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.gufa-chat-history-time{font-size:10px;color:var(--gufa-text-dim)}
.gufa-chat-history-del{width:24px;height:24px;margin-right:4px;flex:0 0 auto;display:none;align-items:center;justify-content:center;
  border:0;border-radius:5px;background:transparent;color:var(--gufa-text-dim);cursor:pointer}
.gufa-chat-history-item:hover .gufa-chat-history-del{display:inline-flex}
.gufa-chat-history-del:hover{background:var(--gufa-hover);color:var(--dsw-alias-state-error-primary)}
.gufa-chat-history-foot{display:flex;gap:6px;padding:6px;border-top:1px solid var(--gufa-border)}
.gufa-chat-msgs{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 10px 4px;overscroll-behavior:contain}
.gufa-chat-msg{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px}
.gufa-chat-msg[data-role="user"]{justify-content:flex-end}
.gufa-chat-avatar{width:20px;height:20px;flex:0 0 auto;margin-top:2px;display:flex;align-items:center;justify-content:center;
  border-radius:6px;color:var(--gufa-accent);background:color-mix(in srgb,var(--gufa-accent) 14%,transparent)}
.gufa-chat-bubble{min-width:0;max-width:100%;overflow:hidden;position:relative}
.gufa-chat-msg[data-role="user"] .gufa-chat-bubble{max-width:88%;padding:7px 10px;border-radius:10px 10px 3px 10px;
  background:color-mix(in srgb,var(--gufa-accent) 12%,transparent);
  border:1px solid color-mix(in srgb,var(--gufa-accent) 30%,transparent)}
.gufa-chat-msg[data-role="assistant"] .gufa-chat-bubble{flex:1 1 auto;padding:8px 11px;border-radius:10px 10px 10px 3px;
  background:var(--gufa-layer2);border:1px solid var(--gufa-border)}
.gufa-chat-usertext{font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.gufa-chat-text{font-size:12.5px;line-height:1.62;word-break:break-word}
.gufa-chat-line{white-space:pre-wrap}
.gufa-chat-gap{height:5px}
.gufa-chat-text strong{font-weight:650}
.gufa-chat-text code,.gufa-chat-inline-code{font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 4px;
  border-radius:4px;background:var(--gufa-active);border:1px solid var(--gufa-border);word-break:break-word}
.gufa-chat-code{margin:8px 0;border:1px solid var(--gufa-border-strong);border-radius:8px;overflow:hidden;background:var(--gufa-bg)}
.gufa-chat-code-head{display:flex;align-items:center;gap:6px;height:26px;padding:0 5px 0 10px;
  background:var(--gufa-layer2);border-bottom:1px solid var(--gufa-border)}
.gufa-chat-code-lang{font-size:10px;letter-spacing:.05em;color:var(--gufa-text-dim);text-transform:lowercase;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px}
.gufa-chat-fill{flex:1 1 auto}
.gufa-chat-code-btn{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border:0;border-radius:5px;
  background:transparent;color:var(--gufa-text-dim);font-size:10.5px;cursor:pointer;white-space:nowrap}
.gufa-chat-code-btn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-chat-code-body{margin:0;padding:9px 11px;overflow:auto;max-height:360px;white-space:pre;tab-size:2;
  font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--gufa-text)}
.gufa-chat-thinking{display:flex;align-items:center;gap:7px;padding:1px 0;font-size:11.5px;color:var(--gufa-text-dim)}
.gufa-chat-error{display:flex;align-items:flex-start;gap:6px;margin-top:6px;padding:6px 8px;border-radius:6px;font-size:11.5px;
  color:var(--dsw-alias-state-error-primary);
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.gufa-chat-caret{display:inline-block;width:7px;height:13px;margin-left:2px;vertical-align:text-bottom;
  background:var(--gufa-accent);opacity:.78;animation:gufa-chat-blink 1s steps(2,start) infinite}
@keyframes gufa-chat-blink{to{visibility:hidden}}
.gufa-chat-composer{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:8px 10px 9px;
  border-top:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-chat-context{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:20px}
.gufa-chat-context-label{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--gufa-text-dim)}
.gufa-chat-chip{display:inline-flex;align-items:center;gap:5px;max-width:210px;height:21px;padding:0 8px;border-radius:11px;
  border:1px dashed var(--gufa-border-strong);background:transparent;color:var(--gufa-text-dim);font-size:11px;cursor:pointer}
.gufa-chat-chip:hover{border-color:var(--gufa-accent);color:var(--gufa-text)}
.gufa-chat-chip[data-on]{border-style:solid;color:var(--gufa-text);
  border-color:color-mix(in srgb,var(--gufa-accent) 52%,transparent);
  background:color-mix(in srgb,var(--gufa-accent) 10%,transparent)}
.gufa-chat-chip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-chat-context-hint{font-size:10.5px;color:var(--gufa-text-dim);opacity:.85}
.gufa-chat-quick{display:flex;gap:5px;flex-wrap:wrap}
.gufa-chat-quick-btn{height:23px;padding:0 9px;border-radius:6px;border:1px solid var(--gufa-border);
  background:var(--gufa-layer2);color:var(--gufa-text-dim);font-size:11px;cursor:pointer;white-space:nowrap}
.gufa-chat-quick-btn:hover:not(:disabled){border-color:var(--gufa-accent);color:var(--gufa-text)}
.gufa-chat-quick-btn:disabled{opacity:.45;cursor:default}
.gufa-chat-notice{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;font-size:11px;
  color:var(--dsw-alias-state-error-primary);
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}
.gufa-chat-notice-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-chat-notice-close{width:20px;height:20px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.gufa-chat-notice-close:hover{background:var(--gufa-hover)}
.gufa-chat-inputwrap{display:flex;align-items:flex-end;gap:8px}
.gufa-chat-input{flex:1 1 auto;min-width:0;min-height:34px;max-height:168px;resize:none;padding:8px 10px;border-radius:8px;
  border:1px solid var(--gufa-border-strong);background:var(--gufa-bg);color:var(--gufa-text);
  font:inherit;font-size:12.5px;line-height:1.5;outline:none}
.gufa-chat-input:focus{border-color:var(--gufa-accent)}
.gufa-chat-input::placeholder{color:var(--gufa-text-dim)}
.gufa-chat-send{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:8px;flex:0 0 auto;
  border:1px solid var(--gufa-accent);background:var(--gufa-accent);color:#fff;font-size:12px;cursor:pointer}
.gufa-chat-send:hover:not(:disabled){background:color-mix(in srgb,var(--gufa-accent) 86%,#000)}
.gufa-chat-send:disabled{opacity:.45;cursor:default}
.gufa-chat-send[data-stop]{background:transparent;color:var(--dsw-alias-state-error-primary);
  border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,transparent)}
.gufa-chat-send[data-stop]:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.gufa-chat-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--gufa-text-dim)}
.gufa-chat-foot-dim{opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`

/* ── 纯函数：localStorage 会话存取 ───────────────────────────────────── */

/** 会话在 localStorage 里的 key：按项目根隔离（无项目时共用一个空项目桶）。 */
function gufaChatStorageKey(root) {
  const normalized = typeof root === 'string' && root !== '' ? root : ''
  return `${GUFA_CHAT_STORAGE_PREFIX}${normalized}`
}

let GUFA_CHAT_ID_SEQUENCE = 0
/** 会话 / 消息本地 id。 */
function gufaChatNewId() {
  GUFA_CHAT_ID_SEQUENCE += 1
  return `c${Date.now().toString(36)}${GUFA_CHAT_ID_SEQUENCE.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 会话标题：取首条用户输入的前 28 个字符。 */
function gufaChatTitleOf(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (normalized === '') return ''
  return normalized.length > 28 ? `${normalized.slice(0, 27)}…` : normalized
}

/** 相对时间（用于历史下拉）。 */
function gufaChatRelativeTime(timestamp, now) {
  const value = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0
  const current = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  const delta = Math.max(0, current - value)
  if (value === 0) return ''
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  const date = new Date(value)
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 归一化并裁剪一个会话（消息条数、单条字符数、字段类型）。 */
function gufaChatTrimConversation(conversation) {
  const source = conversation !== null && typeof conversation === 'object' ? conversation : {}
  const rawMessages = Array.isArray(source.messages) ? source.messages : []
  const messages = rawMessages.slice(-GUFA_CHAT_MESSAGE_LIMIT).map((item) => {
    const message = item !== null && typeof item === 'object' ? item : {}
    let content = typeof message.content === 'string' ? message.content : ''
    if (content.length > GUFA_CHAT_MESSAGE_CHAR_LIMIT) content = `${content.slice(0, GUFA_CHAT_MESSAGE_CHAR_LIMIT)}\n…（内容过长，已截断）`
    const trimmed = {
      id: typeof message.id === 'string' && message.id !== '' ? message.id : gufaChatNewId(),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      at: typeof message.at === 'number' && Number.isFinite(message.at) ? message.at : Date.now(),
    }
    if (typeof message.error === 'string' && message.error !== '') trimmed.error = message.error
    if (message.stopped === true) trimmed.stopped = true
    return trimmed
  })
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : gufaChatNewId(),
    title: typeof source.title === 'string' ? source.title : '',
    messages,
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now(),
  }
}

/** 校验从 localStorage 读出的结构；返回 { conversations, activeId }。 */
function gufaChatSanitizeStore(raw) {
  if (raw === null || typeof raw !== 'object') return { conversations: [], activeId: null }
  const list = Array.isArray(raw.conversations) ? raw.conversations : []
  const conversations = []
  const seen = new Set()
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const conversation = gufaChatTrimConversation(item)
    if (seen.has(conversation.id)) continue
    seen.add(conversation.id)
    conversations.push(conversation)
    if (conversations.length >= GUFA_CHAT_CONVERSATION_LIMIT) break
  }
  const requestedActive = typeof raw.activeId === 'string' ? raw.activeId : ''
  const activeId = conversations.some((item) => item.id === requestedActive) ? requestedActive : (conversations[0]?.id ?? null)
  return { conversations, activeId }
}

/** 读取某个项目的会话库（任何异常都回落到空）。 */
function gufaChatLoadStore(root) {
  try {
    const raw = localStorage.getItem(gufaChatStorageKey(root))
    if (raw === null) return { conversations: [], activeId: null }
    return gufaChatSanitizeStore(JSON.parse(raw))
  } catch {
    return { conversations: [], activeId: null }
  }
}

/** 写入会话库；配额不足时丢掉较旧的一半再试一次。返回是否成功。 */
function gufaChatSaveStore(root, conversations, activeId) {
  const list = (Array.isArray(conversations) ? conversations : [])
    .slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    .map(gufaChatTrimConversation)
  const payload = { version: 1, activeId: typeof activeId === 'string' ? activeId : null, conversations: list }
  try {
    localStorage.setItem(gufaChatStorageKey(root), JSON.stringify(payload))
    return true
  } catch {
    const reduced = payload.conversations.slice(0, Math.max(1, Math.ceil(payload.conversations.length / 2)))
    try {
      localStorage.setItem(gufaChatStorageKey(root), JSON.stringify({ ...payload, conversations: reduced }))
      return true
    } catch {
      return false
    }
  }
}

/* ── 纯函数：markdown-lite 解析 ──────────────────────────────────────── */

/**
 * 把 markdown-lite 文本拆成块：``` 围栏代码块 与 普通文本块。
 * 流式输出时可能只有开头围栏，因此末尾未闭合的围栏也按代码块处理（open: true）。
 * @param {string} source
 * @returns {Array<{ type: 'text', text: string } | { type: 'code', lang: string, text: string, open?: boolean }>}
 */
function gufaChatParseMarkdown(source) {
  const text = typeof source === 'string' ? source : String(source ?? '')
  const blocks = []
  if (text === '') return blocks
  const fencePattern = /```([^\n`]*)\r?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match
  while ((match = fencePattern.exec(text)) !== null) {
    if (match.index > lastIndex) blocks.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    blocks.push({ type: 'code', lang: match[1].trim(), text: match[2].replace(/\n$/, '') })
    lastIndex = fencePattern.lastIndex
  }
  const rest = text.slice(lastIndex)
  if (rest === '') return blocks
  const openIndex = rest.indexOf('```')
  if (openIndex < 0) {
    blocks.push({ type: 'text', text: rest })
    return blocks
  }
  if (openIndex > 0) blocks.push({ type: 'text', text: rest.slice(0, openIndex) })
  const header = rest.slice(openIndex + 3)
  const newline = header.indexOf('\n')
  blocks.push({
    type: 'code',
    lang: (newline >= 0 ? header.slice(0, newline) : header).trim(),
    text: newline >= 0 ? header.slice(newline + 1) : '',
    open: true,
  })
  return blocks
}

/**
 * 行内 markdown-lite：`code` 与 **粗体**。
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'bold' | 'code', text: string }>}
 */
function gufaChatInline(text) {
  const source = typeof text === 'string' ? text : String(text ?? '')
  const tokens = []
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
  let lastIndex = 0
  let match
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: 'text', text: source.slice(lastIndex, match.index) })
    if (match[1] !== undefined) tokens.push({ type: 'bold', text: match[1] })
    else tokens.push({ type: 'code', text: match[2] })
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < source.length) tokens.push({ type: 'text', text: source.slice(lastIndex) })
  return tokens
}

/* ── 纯函数：请求体拼装 ──────────────────────────────────────────────── */

/**
 * 根据上下文开关拼出发给 Host 的 context。
 * 关掉文件但保留选中代码时，仍带上 selectionPath 让模型知道代码来源。
 * @returns {null | { root?: string, path?: string, content?: string, language?: string, selection?: string, selectionPath?: string, selectionLine?: number }}
 */
function gufaChatBuildContext(options) {
  const source = options !== null && typeof options === 'object' ? options : {}
  const project = source.project !== null && typeof source.project === 'object' ? source.project : null
  const activeFile = source.activeFile !== null && typeof source.activeFile === 'object' ? source.activeFile : null
  const selection = source.selection !== null && typeof source.selection === 'object' ? source.selection : null
  const useFile = source.attachFile !== false && activeFile !== null
  const useSelection = source.attachSelection !== false && selection !== null && typeof selection.text === 'string' && selection.text !== ''
  const context = {}
  if (project !== null && typeof project.root === 'string' && project.root !== '') context.root = project.root
  if (useSelection) {
    context.selection = selection.text
    if (typeof selection.path === 'string' && selection.path !== '') context.selectionPath = selection.path
    if (typeof selection.line === 'number' && Number.isFinite(selection.line) && selection.line > 0) context.selectionLine = Math.trunc(selection.line)
  }
  if (useFile) {
    if (typeof activeFile.path === 'string' && activeFile.path !== '') context.path = activeFile.path
    if (typeof activeFile.content === 'string') context.content = activeFile.content
    if (typeof activeFile.language === 'string' && activeFile.language !== '') context.language = activeFile.language
  } else if (useSelection && context.path === undefined) {
    context.path = selection.path
  }
  return Object.keys(context).length === 0 ? null : context
}

/**
 * 把本地会话消息转换成请求用的 messages 数组。
 * 出错/空内容的消息不发给模型，避免把错误提示当成对话历史。
 * @param {Array<{ role: string, content?: string, error?: string }>} messages
 * @returns {Array<{ role: 'user' | 'assistant', content: string }>}
 */
function gufaChatRequestMessages(messages) {
  if (!Array.isArray(messages)) return []
  const result = []
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (typeof message.error === 'string' && message.error !== '') continue
    const content = typeof message.content === 'string' ? message.content.trim() : ''
    if (content === '') continue
    result.push({ role: message.role, content })
  }
  return result
}

/* ── 工具 ─────────────────────────────────────────────────────────────── */

/** 确保聊天面板样式已注入；返回清理函数（无样式时为空操作）。 */
function gufaChatEnsureStyles() {
  const id = 'gufa-code/chat'
  if (document.querySelector(`style[data-gufa="${id}"]`) !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.gufa = id
  style.textContent = GUFA_CHAT_CSS
  document.head.append(style)
  return () => style.remove()
}

/** 复制文本：优先 Clipboard API，失败时回落到临时 textarea。 */
function gufaChatCopyText(text) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  if (value === '') return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(value).catch(() => {})
      return true
    }
  } catch {
    /* 回落到 execCommand */
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/* ── 小组件 ───────────────────────────────────────────────────────────── */

/** 行内 markdown-lite 渲染（粗体 / 行内代码 / 纯文本）。 */
function GufaChatInline(props) {
  const tokens = gufaChatInline(props.text)
  return h(
    React.Fragment,
    null,
    tokens.map((token, index) => {
      if (token.type === 'bold') return h('strong', { key: index }, token.text)
      if (token.type === 'code') return h('code', { key: index, className: 'gufa-chat-inline-code' }, token.text)
      return h(React.Fragment, { key: index }, token.text)
    }),
  )
}

/** 普通文本块：按行渲染，空行留出间距（列表等简化为纯文本行）。 */
function GufaChatMarkdownText(props) {
  const lines = String(props.text ?? '').split('\n')
  return h(
    'div',
    { className: 'gufa-chat-text' },
    lines.map((line, index) => (
      line.trim() === ''
        ? h('div', { key: index, className: 'gufa-chat-gap' })
        : h('div', { key: index, className: 'gufa-chat-line' }, h(GufaChatInline, { text: line }))
    )),
  )
}

/** 代码块：语言标签 + 复制 + 插入到编辑器。 */
function GufaChatCode(props) {
  const t = G.useT()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => () => {
    if (timerRef.current !== 0) window.clearTimeout(timerRef.current)
  }, [])
  const code = typeof props.code === 'string' ? props.code : ''
  const canInsert = typeof props.onInsert === 'function'
  const onCopy = useCallback(() => {
    if (!gufaChatCopyText(code)) return
    setCopied(true)
    if (timerRef.current !== 0) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      setCopied(false)
    }, 1500)
  }, [code])
  const onInsert = useCallback(() => {
    if (typeof props.onInsert === 'function') props.onInsert(code)
  }, [props.onInsert, code])
  return h(
    'div',
    { className: 'gufa-chat-code' },
    h(
      'div',
      { className: 'gufa-chat-code-head' },
      h('span', { className: 'gufa-chat-code-lang' }, props.lang === undefined || props.lang === '' ? 'code' : props.lang),
      h('span', { className: 'gufa-chat-fill' }),
      h(
        'button',
        { type: 'button', className: 'gufa-chat-code-btn', title: t('chat.copy'), onClick: onCopy },
        h(G.Icon, { name: copied ? 'check' : 'files', size: 11 }),
        copied ? t('chat.copied') : t('chat.copy'),
      ),
      canInsert
        ? h(
            'button',
            { type: 'button', className: 'gufa-chat-code-btn', title: t('chat.insert'), onClick: onInsert },
            h(G.Icon, { name: 'code', size: 11 }),
            t('chat.insert'),
          )
        : null,
    ),
    h('pre', { className: 'gufa-chat-code-body gufa-scroll' }, h('code', null, code)),
  )
}

/** AI 消息正文：markdown-lite 块渲染。 */
function GufaChatAssistantBody(props) {
  const blocks = useMemo(() => gufaChatParseMarkdown(props.text), [props.text])
  return h(
    React.Fragment,
    null,
    blocks.map((block, index) => (
      block.type === 'code'
        ? h(GufaChatCode, { key: index, lang: block.lang, code: block.text, onInsert: props.onInsert })
        : h(GufaChatMarkdownText, { key: index, text: block.text })
    )),
  )
}

/** 单条消息气泡。 */
function GufaChatMessageView(props) {
  const t = G.useT()
  const message = props.message
  const isUser = message.role === 'user'
  const streaming = props.streaming === true
  const thinking = props.thinking === true
  return h(
    'div',
    { className: 'gufa-chat-msg', 'data-role': isUser ? 'user' : 'assistant' },
    isUser ? null : h('div', { className: 'gufa-chat-avatar' }, h(G.Icon, { name: 'sparkles', size: 12 })),
    h(
      'div',
      { className: 'gufa-chat-bubble' },
      isUser
        ? h('div', { className: 'gufa-chat-usertext' }, message.content)
        : h(GufaChatAssistantBody, { text: message.content, onInsert: props.onInsert }),
      message.error !== undefined && message.error !== ''
        ? h(
            'div',
            { className: 'gufa-chat-error' },
            h(G.Icon, { name: 'warn', size: 12 }),
            h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, message.error),
          )
        : null,
      thinking ? h('div', { className: 'gufa-chat-thinking' }, h(G.Spinner), t('chat.thinking')) : null,
      streaming && !thinking && message.content !== '' ? h('span', { className: 'gufa-chat-caret' }) : null,
    ),
  )
}

/* ── 主组件：G.ChatPanel ─────────────────────────────────────────────── */

G.ChatPanel = function ChatPanel(props) {
  const t = G.useT()
  const project = props.project !== null && typeof props.project === 'object' ? props.project : null
  const activeFile = props.activeFile !== null && typeof props.activeFile === 'object' ? props.activeFile : null
  const selection = props.selection !== null && typeof props.selection === 'object' && typeof props.selection.text === 'string' && props.selection.text !== ''
    ? props.selection
    : null
  const root = project !== null && typeof project.root === 'string' ? project.root : ''
  const insertCode = typeof props.onInsertCode === 'function' ? props.onInsertCode : null

  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState('')
  const [info, setInfo] = useState({ provider: '', model: '', ready: false })
  const [infoError, setInfoError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [attachFile, setAttachFile] = useState(true)
  const [attachSelection, setAttachSelection] = useState(true)

  const conversationsRef = useRef([])
  const activeIdRef = useRef(null)
  const rootRef = useRef(root)
  const loadedRootRef = useRef(null)
  const streamRef = useRef(null)
  const watchdogRef = useRef(0)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const headRef = useRef(null)
  const stickRef = useRef(true)
  const mountedRef = useRef(true)

  /* ── 样式注入 ─────────────────────────────────────────────────────── */
  useEffect(() => gufaChatEnsureStyles(), [])

  /* ── 模型信息（chat.info） ────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await G.api('chat.info')
        if (cancelled) return
        setInfo({
          provider: value !== null && typeof value === 'object' && typeof value.provider === 'string' ? value.provider : '',
          model: value !== null && typeof value === 'object' && typeof value.model === 'string' ? value.model : '',
          ready: value !== null && typeof value === 'object' && value.ready === true,
        })
        setInfoError('')
      } catch (error) {
        if (!cancelled) setInfoError(G.errorText(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── 会话库读写 ───────────────────────────────────────────────────── */
  const persist = useCallback((nextConversations, nextActiveId) => {
    const ok = gufaChatSaveStore(rootRef.current, nextConversations, nextActiveId)
    if (!ok) setNotice('本地对话历史保存失败：浏览器存储空间不足。')
    return ok
  }, [])

  /* 项目切换：换一个项目就换一份会话库（同一个项目跨刷新保留）。 */
  useEffect(() => {
    if (loadedRootRef.current === root) return
    loadedRootRef.current = root
    rootRef.current = root
    const current = streamRef.current
    if (current !== null) {
      streamRef.current = null
      try {
        if (typeof current.abort === 'function') current.abort()
      } catch {
        /* ignore */
      }
    }
    if (watchdogRef.current !== 0) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = 0
    }
    setStreaming(false)
    setThinking(false)
    const store = gufaChatLoadStore(root)
    conversationsRef.current = store.conversations
    activeIdRef.current = store.activeId
    setConversations(store.conversations)
    setActiveId(store.activeId)
    setHistoryOpen(false)
    setNotice('')
    stickRef.current = true
  }, [root])

  /* 卸载：中止进行中的请求，并把已收到的部分内容落盘。 */
  useEffect(() => () => {
    mountedRef.current = false
    if (watchdogRef.current !== 0) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = 0
    }
    const current = streamRef.current
    streamRef.current = null
    if (current !== null) {
      try {
        if (typeof current.abort === 'function') current.abort()
      } catch {
        /* ignore */
      }
      const finalized = conversationsRef.current.map((conversation) => {
        if (conversation.id !== current.conversationId) return conversation
        return {
          ...conversation,
          messages: conversation.messages.map((message) => (
            message.id === current.assistantId && typeof message.content === 'string' && message.content === ''
              ? { ...message, content: GUFA_CHAT_LABELS.stopped }
              : message
          )),
        }
      })
      conversationsRef.current = finalized
      gufaChatSaveStore(rootRef.current, finalized, activeIdRef.current)
    }
  }, [])

  /* ── 状态提交 ─────────────────────────────────────────────────────── */
  const commitConversations = useCallback((nextConversations, nextActiveId, persistNow) => {
    conversationsRef.current = nextConversations
    setConversations(nextConversations)
    if (nextActiveId !== undefined) {
      activeIdRef.current = nextActiveId
      setActiveId(nextActiveId)
    }
    if (persistNow !== false) persist(nextConversations, activeIdRef.current)
  }, [persist])

  const mutateConversation = useCallback((conversationId, updater, persistNow) => {
    const previous = conversationsRef.current
    const index = previous.findIndex((item) => item.id === conversationId)
    if (index < 0) return
    const nextConversation = updater(previous[index])
    if (nextConversation === previous[index]) return
    const next = previous.slice()
    next[index] = nextConversation
    conversationsRef.current = next
    setConversations(next)
    if (persistNow !== false) persist(next, activeIdRef.current)
  }, [persist])

  /* ── 滚动跟随 ─────────────────────────────────────────────────────── */
  const onScroll = useCallback(() => {
    const node = listRef.current
    if (node === null) return
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
  }, [])

  useEffect(() => {
    const node = listRef.current
    if (node !== null && stickRef.current) node.scrollTop = node.scrollHeight
  }, [conversations, activeId, thinking, streaming])

  /* ── 流式请求生命周期 ─────────────────────────────────────────────── */
  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== 0) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = 0
    }
  }, [])

  const finishStream = useCallback((conversationId, assistantId, errorMessage) => {
    const current = streamRef.current
    if (current === null || current.assistantId !== assistantId) return
    streamRef.current = null
    clearWatchdog()
    setStreaming(false)
    setThinking(false)
    mutateConversation(conversationId, (conversation) => {
      const messages = conversation.messages.map((message) => {
        if (message.id !== assistantId) return message
        const content = typeof message.content === 'string' ? message.content : ''
        if (typeof errorMessage === 'string' && errorMessage !== '') return { ...message, content, error: errorMessage }
        if (content.trim() === '') return { ...message, content: GUFA_CHAT_LABELS.emptyReply }
        return { ...message, content }
      })
      return { ...conversation, messages, updatedAt: Date.now() }
    }, true)
  }, [clearWatchdog, mutateConversation])

  const handleStreamEvent = useCallback((conversationId, assistantId, event) => {
    const current = streamRef.current
    if (current === null || current.assistantId !== assistantId) return
    if (event === null || typeof event !== 'object') return
    if (event.type === 'thinking') {
      setThinking(true)
      return
    }
    if (event.type === 'delta') {
      const text = typeof event.text === 'string' ? event.text : ''
      if (text === '') return
      setThinking(false)
      mutateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => (
          message.id === assistantId ? { ...message, content: `${message.content ?? ''}${text}` } : message
        )),
      }), false)
      return
    }
    if (event.type === 'error') {
      finishStream(conversationId, assistantId, typeof event.message === 'string' && event.message !== '' ? event.message : t('chat.error'))
      return
    }
    if (event.type === 'done') finishStream(conversationId, assistantId, '')
  }, [finishStream, mutateConversation, t])

  const armWatchdog = useCallback((conversationId, assistantId) => {
    clearWatchdog()
    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = 0
      const current = streamRef.current
      if (current === null || current.assistantId !== assistantId) return
      const abort = current.abort
      finishStream(conversationId, assistantId, '响应超时：长时间没有收到 AI 回复，请重试。')
      try {
        if (typeof abort === 'function') abort()
      } catch {
        /* ignore */
      }
    }, GUFA_CHAT_WATCHDOG_MS)
  }, [clearWatchdog, finishStream])

  const sendMessage = useCallback((overrideText) => {
    const raw = typeof overrideText === 'string' ? overrideText : input
    const text = raw.trim()
    if (text === '' || streamRef.current !== null) return
    const now = Date.now()
    let conversation = conversationsRef.current.find((item) => item.id === activeIdRef.current) ?? null
    let nextConversations = conversationsRef.current
    if (conversation === null) {
      conversation = { id: gufaChatNewId(), title: '', messages: [], updatedAt: now }
      nextConversations = [conversation, ...nextConversations].slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    }
    const assistantId = gufaChatNewId()
    const userMessage = { id: gufaChatNewId(), role: 'user', content: text, at: now }
    const assistantMessage = { id: assistantId, role: 'assistant', content: '', at: now }
    const history = gufaChatRequestMessages(conversation.messages)
    const title = conversation.title === '' ? gufaChatTitleOf(text) : conversation.title
    const updated = {
      ...conversation,
      title,
      messages: [...conversation.messages, userMessage, assistantMessage],
      updatedAt: now,
    }
    nextConversations = [updated, ...nextConversations.filter((item) => item.id !== updated.id)]
      .slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    commitConversations(nextConversations, updated.id, true)
    setInput('')
    setNotice('')
    setThinking(true)
    setStreaming(true)
    stickRef.current = true
    const payload = { messages: [...history, { role: 'user', content: text }] }
    const context = gufaChatBuildContext({ project, activeFile, selection, attachFile, attachSelection })
    if (context !== null) payload.context = context
    streamRef.current = { conversationId: updated.id, assistantId, abort: null }
    armWatchdog(updated.id, assistantId)
    try {
      const abort = G.stream('chat.stream', payload, (event) => handleStreamEvent(updated.id, assistantId, event))
      const current = streamRef.current
      if (current !== null && current.assistantId === assistantId) current.abort = abort
    } catch (error) {
      finishStream(updated.id, assistantId, G.errorText(error))
    }
  }, [input, project, activeFile, selection, attachFile, attachSelection, commitConversations, handleStreamEvent, armWatchdog, finishStream])

  const stopStream = useCallback(() => {
    const current = streamRef.current
    if (current === null) return
    streamRef.current = null
    clearWatchdog()
    try {
      if (typeof current.abort === 'function') current.abort()
    } catch {
      /* ignore */
    }
    setStreaming(false)
    setThinking(false)
    mutateConversation(current.conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (message.id !== current.assistantId) return message
        const content = typeof message.content === 'string' ? message.content : ''
        return { ...message, content: content === '' ? `（${t('chat.stop')}）` : content, stopped: true }
      }),
      updatedAt: Date.now(),
    }), true)
  }, [clearWatchdog, mutateConversation, t])

  /* ── 会话操作 ─────────────────────────────────────────────────────── */
  const startNewConversation = useCallback(() => {
    stopStream()
    const current = conversationsRef.current
    const reusable = current.find((item) => item.messages.length === 0) ?? null
    if (reusable !== null) {
      commitConversations(current, reusable.id, true)
      setHistoryOpen(false)
      return
    }
    const conversation = { id: gufaChatNewId(), title: '', messages: [], updatedAt: Date.now() }
    const next = [conversation, ...current].slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    commitConversations(next, conversation.id, true)
    setHistoryOpen(false)
    setNotice('')
    window.setTimeout(() => {
      if (inputRef.current !== null) inputRef.current.focus()
    }, 0)
  }, [stopStream, commitConversations])

  const selectConversation = useCallback((conversationId) => {
    setHistoryOpen(false)
    if (conversationId === activeIdRef.current) return
    stopStream()
    const exists = conversationsRef.current.some((item) => item.id === conversationId)
    if (!exists) return
    activeIdRef.current = conversationId
    setActiveId(conversationId)
    setNotice('')
    stickRef.current = true
    persist(conversationsRef.current, conversationId)
  }, [stopStream, persist])

  const deleteConversation = useCallback((conversationId) => {
    const current = streamRef.current
    if (current !== null && current.conversationId === conversationId) stopStream()
    const next = conversationsRef.current.filter((item) => item.id !== conversationId)
    const nextActive = activeIdRef.current === conversationId ? (next[0]?.id ?? null) : activeIdRef.current
    commitConversations(next, nextActive, true)
  }, [stopStream, commitConversations])

  const clearActiveConversation = useCallback(() => {
    const conversationId = activeIdRef.current
    if (conversationId === null) return
    const current = streamRef.current
    if (current !== null && current.conversationId === conversationId) stopStream()
    mutateConversation(conversationId, (conversation) => ({ ...conversation, messages: [], title: '', updatedAt: Date.now() }), true)
    setNotice('')
    setHistoryOpen(false)
  }, [stopStream, mutateConversation])

  /* ── 输入框 ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const node = inputRef.current
    if (node === null) return
    node.style.height = 'auto'
    const maxHeight = 168
    const height = Math.min(node.scrollHeight, maxHeight)
    node.style.height = `${Math.max(height, 34)}px`
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [input])

  const onChangeInput = useCallback((event) => setInput(event.target.value), [])

  const onInputKeyDown = useCallback((event) => {
    const composing = event.nativeEvent !== undefined && event.nativeEvent !== null
      ? event.nativeEvent.isComposing === true
      : event.isComposing === true
    if (event.key !== 'Enter' || event.shiftKey || composing) return
    event.preventDefault()
    if (streamRef.current !== null) return
    sendMessage()
  }, [sendMessage])

  /* ── 历史下拉：点击外部关闭 ───────────────────────────────────────── */
  useEffect(() => {
    if (!historyOpen) return undefined
    const onPointerDown = (event) => {
      const node = headRef.current
      if (node !== null && node.contains(event.target)) return
      setHistoryOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown, true)
    return () => window.removeEventListener('mousedown', onPointerDown, true)
  }, [historyOpen])

  /* ── 渲染数据 ─────────────────────────────────────────────────────── */
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId) ?? null,
    [conversations, activeId],
  )
  const activeMessages = activeConversation !== null && Array.isArray(activeConversation.messages) ? activeConversation.messages : []
  const streamingId = streamRef.current !== null ? streamRef.current.assistantId : null
  const hasEditorContext = activeFile !== null || selection !== null
  const modelText = info.model === ''
    ? '—'
    : `${info.provider === '' ? '' : `${info.provider} / `}${info.model}`
  const modelTitle = infoError !== ''
    ? `${t('chat.model')}：${infoError}`
    : info.ready
      ? `${t('chat.model')}：${modelText}`
      : `${t('chat.model')}：${modelText}（${GUFA_CHAT_LABELS.notReady}）`

  const quickActions = [
    { key: 'explain', label: t('chat.quickExplain'), prompt: '请解释我提供的这段代码：它做了什么、关键逻辑是什么、有哪些需要注意的边界情况。' },
    { key: 'bug', label: t('chat.quickBug'), prompt: '请检查我提供的这段代码可能存在的问题（bug、边界条件、性能、可读性），并给出修改建议。' },
    { key: 'comment', label: t('chat.quickComment'), prompt: '请为我提供的这段代码补充简洁清晰的中文注释，直接给出注释后的完整代码。' },
    { key: 'refactor', label: t('chat.quickRefactor'), prompt: '请给出我提供的这段代码的重构建议，并给出重构后的完整代码。' },
  ]

  /* ── 历史下拉列表 ─────────────────────────────────────────────────── */
  const historyMenu = historyOpen
    ? h(
        'div',
        { className: 'gufa-chat-history' },
        h(
          'div',
          { className: 'gufa-chat-history-head' },
          h(G.Icon, { name: 'history', size: 11 }),
          t('chat.history'),
          h('span', { className: 'gufa-chat-fill' }),
          h(
            'button',
            {
              type: 'button',
              className: 'gufa-chat-code-btn',
              title: t('chat.clear'),
              disabled: activeMessages.length === 0 && activeConversation === null,
              onClick: clearActiveConversation,
            },
            h(G.Icon, { name: 'trash', size: 11 }),
            t('chat.clear'),
          ),
        ),
        conversations.length === 0
          ? h('div', { className: 'gufa-chat-history-empty' }, t('chat.noHistory'))
          : h(
              'div',
              { className: 'gufa-chat-history-list gufa-scroll' },
              conversations.map((conversation) => h(
                'div',
                {
                  key: conversation.id,
                  className: 'gufa-chat-history-item',
                  'data-active': conversation.id === activeId ? '' : undefined,
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'gufa-chat-history-main',
                    title: conversation.title === '' ? GUFA_CHAT_LABELS.newConversation : conversation.title,
                    onClick: () => selectConversation(conversation.id),
                  },
                  h('span', { className: 'gufa-chat-history-title' }, conversation.title === '' ? GUFA_CHAT_LABELS.newConversation : conversation.title),
                  h('span', { className: 'gufa-chat-history-time' }, gufaChatRelativeTime(conversation.updatedAt)),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'gufa-chat-history-del',
                    title: t('chat.deleteChat'),
                    onClick: (event) => {
                      event.stopPropagation()
                      deleteConversation(conversation.id)
                    },
                  },
                  h(G.Icon, { name: 'trash', size: 12 }),
                ),
              )),
            ),
        h(
          'div',
          { className: 'gufa-chat-history-foot' },
          h(
            G.Button,
            { icon: 'plus', onClick: startNewConversation },
            t('chat.newChat'),
          ),
        ),
      )
    : null

  /* ── 消息列表 ─────────────────────────────────────────────────────── */
  const messageList = activeMessages.length === 0
    ? h(G.Empty, { icon: 'sparkles', title: t('chat.emptyTitle'), hint: t('chat.emptyHint') })
    : activeMessages.map((message) => h(GufaChatMessageView, {
        key: message.id,
        message,
        streaming: streaming && message.id === streamingId,
        thinking: thinking && message.id === streamingId,
        onInsert: insertCode,
      }))

  /* ── 渲染 ─────────────────────────────────────────────────────────── */
  return h(
    'div',
    { className: 'gufa-chat-wrap' },
    h(
      'div',
      { className: 'gufa-chat-headwrap', ref: headRef },
      h(
        'div',
        { className: 'gufa-panel-head gufa-chat-head' },
        h(G.Icon, { name: 'sparkles', size: 13 }),
        h('span', { className: 'gufa-panel-head-title' }, t('chat.title')),
        h('span', { className: 'gufa-chat-model', title: modelTitle, 'data-warn': info.ready ? undefined : '' }, modelText),
        h(
          G.IconButton,
          { title: t('chat.history'), onClick: () => setHistoryOpen((value) => !value) },
          h(G.Icon, { name: 'history', size: 14 }),
        ),
        h(
          G.IconButton,
          { title: t('chat.newChat'), onClick: startNewConversation },
          h(G.Icon, { name: 'plus', size: 14 }),
        ),
      ),
      historyMenu,
    ),
    h(
      'div',
      { className: 'gufa-chat-msgs gufa-scroll', ref: listRef, onScroll },
      messageList,
    ),
    h(
      'div',
      { className: 'gufa-chat-composer' },
      h(
        'div',
        { className: 'gufa-chat-context' },
        h('span', { className: 'gufa-chat-context-label' }, t('chat.contextLabel')),
        activeFile !== null
          ? h(
              'button',
              {
                type: 'button',
                className: 'gufa-chat-chip',
                'data-on': attachFile ? '' : undefined,
                title: `${t('chat.ctxFile')}：${activeFile.path ?? ''}${attachFile ? '' : `（${t('chat.attachFile')}）`}`,
                onClick: () => setAttachFile((value) => !value),
              },
              h(G.Icon, { name: 'file', size: 11 }),
              h('span', { className: 'gufa-chat-chip-text' }, G.basename(activeFile.path)),
            )
          : null,
        selection !== null
          ? h(
              'button',
              {
                type: 'button',
                className: 'gufa-chat-chip',
                'data-on': attachSelection ? '' : undefined,
                title: `${t('chat.ctxSelection')}${selection.path ? `：${selection.path}` : ''}`,
                onClick: () => setAttachSelection((value) => !value),
              },
              h(G.Icon, { name: 'code', size: 11 }),
              h('span', { className: 'gufa-chat-chip-text' },
                selection.line === undefined || selection.line === null
                  ? t('chat.ctxSelection')
                  : `${t('chat.ctxSelection')} · ${selection.line}`,
              ),
            )
          : null,
        activeFile === null && selection === null
          ? h('span', { className: 'gufa-chat-context-hint' }, GUFA_CHAT_LABELS.openFileHint)
          : null,
      ),
      h(
        'div',
        { className: 'gufa-chat-quick' },
        quickActions.map((action) => h(
          'button',
          {
            key: action.key,
            type: 'button',
            className: 'gufa-chat-quick-btn',
            disabled: !hasEditorContext || streaming,
            title: hasEditorContext ? action.label : GUFA_CHAT_LABELS.openFileHint,
            onClick: () => sendMessage(action.prompt),
          },
          action.label,
        )),
      ),
      notice !== ''
        ? h(
            'div',
            { className: 'gufa-chat-notice' },
            h(G.Icon, { name: 'warn', size: 12 }),
            h('span', { className: 'gufa-chat-notice-text' }, notice),
            h(
              'button',
              { type: 'button', className: 'gufa-chat-notice-close', title: t('common.close'), onClick: () => setNotice('') },
              h(G.Icon, { name: 'close', size: 11 }),
            ),
          )
        : null,
      h(
        'div',
        { className: 'gufa-chat-inputwrap' },
        h('textarea', {
          ref: inputRef,
          className: 'gufa-chat-input gufa-scroll',
          rows: 1,
          value: input,
          placeholder: t('chat.inputPlaceholder'),
          spellCheck: false,
          onChange: onChangeInput,
          onKeyDown: onInputKeyDown,
        }),
        streaming
          ? h(
              'button',
              { type: 'button', className: 'gufa-chat-send', 'data-stop': '', title: t('chat.stop'), onClick: stopStream },
              h(G.Icon, { name: 'stop', size: 12 }),
              t('chat.stop'),
            )
          : h(
              'button',
              {
                type: 'button',
                className: 'gufa-chat-send',
                disabled: input.trim() === '',
                title: t('chat.send'),
                onClick: () => sendMessage(),
              },
              h(G.Icon, { name: 'send', size: 12 }),
              t('chat.send'),
            ),
      ),
      h(
        'div',
        { className: 'gufa-chat-foot' },
        h('span', { className: 'gufa-chat-foot-dim' }, GUFA_CHAT_LABELS.ctrlHint),
        h('span', { className: 'gufa-chat-foot-dim' }, activeConversation === null
          ? GUFA_CHAT_LABELS.newConversation
          : `${activeMessages.length} · ${conversations.length}/${GUFA_CHAT_CONVERSATION_LIMIT}`),
      ),
    ),
  )
}


/* ─────────────────────── 46-gitgraph.js ─────────────────────── */
/**
 * 46-gitgraph：Git Graph 视图（类似 Cursor / Git Graph 扩展的提交图）。
 * 以编辑器标签页的形式打开；纯前端计算泳道布局，Host 只提供 git log 数据。
 */

/** 泳道颜色（跟随强调色，深浅主题都可读）。 */
const GUFA_GRAPH_COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#7f9cf5']

/**
 * 计算提交图泳道布局（纯函数，供测试）。
 * @param {Array<{hash:string, parents:string[]}>} commits 新→旧
 * @returns {{rows: Array<object>, laneCount: number, hashRow: Map<string, number>}}
 */
G.gitGraphLayout = function gitGraphLayout(commits) {
  const lanes = []
  const rows = []
  const hashRow = new Map()
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash)
    if (lane === -1) {
      const free = lanes.indexOf(null)
      lane = free === -1 ? lanes.length : free
      lanes[lane] = commit.hash
    }
    rows.push({ commit, lane, lanesBefore: lanes.slice() })
    hashRow.set(commit.hash, rows.length - 1)
    lanes[lane] = commit.parents.length > 0 ? commit.parents[0] : null
    let insertAt = lane + 1
    for (const parent of commit.parents.slice(1)) {
      if (lanes.indexOf(parent) === -1) {
        lanes.splice(insertAt, 0, parent)
        insertAt += 1
      }
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
  }
  for (let index = 0; index < rows.length; index += 1) {
    rows[index].lanesAfter = index + 1 < rows.length ? rows[index + 1].lanesBefore.slice() : []
  }
  let laneCount = 1
  for (const row of rows) {
    laneCount = Math.max(laneCount, row.lane + 1, row.lanesBefore.length, row.lanesAfter.length)
  }
  return { rows, laneCount, hashRow }
}

/** 提交行（含泳道 SVG）。 */
function gufaGraphRow(props) {
  const t = G.useT()
  const row = props.row
  const laneWidth = 14
  const rowHeight = 26
  const width = Math.max(laneWidth, props.laneCount * laneWidth)
  const cx = (lane) => lane * laneWidth + laneWidth / 2
  const cy = rowHeight / 2
  const color = (lane) => GUFA_GRAPH_COLORS[lane % GUFA_GRAPH_COLORS.length]
  const elements = []
  // 上方泳道竖线
  for (let lane = 0; lane < row.lanesBefore.length; lane += 1) {
    if (row.lanesBefore[lane] === null || row.lanesBefore[lane] === undefined) continue
    elements.push(h('line', { key: `b:${lane}`, x1: cx(lane), y1: 0, x2: cx(lane), y2: cy, stroke: color(lane), strokeWidth: 1.6, opacity: 0.85 }))
  }
  // 下方泳道竖线
  for (let lane = 0; lane < row.lanesAfter.length; lane += 1) {
    if (row.lanesAfter[lane] === null || row.lanesAfter[lane] === undefined) continue
    elements.push(h('line', { key: `a:${lane}`, x1: cx(lane), y1: cy, x2: cx(lane), y2: rowHeight, stroke: color(lane), strokeWidth: 1.6, opacity: 0.85 }))
  }
  // 提交 → 父提交连线
  const parents = row.commit.parents ?? []
  parents.forEach((parent, index) => {
    let targetLane = -1
    const targetRow = props.hashRow.get(parent)
    if (targetRow !== undefined) targetLane = props.rows[targetRow].lane
    else targetLane = row.lanesAfter.indexOf(parent)
    if (targetLane === -1) targetLane = row.lane
    if (targetLane === row.lane) return
    const x1 = cx(row.lane)
    const x2 = cx(targetLane)
    elements.push(
      h('path', {
        key: `p:${index}`,
        d: `M ${x1} ${cy} C ${x1} ${cy + 10}, ${x2} ${cy + 8}, ${x2} ${rowHeight}`,
        fill: 'none',
        stroke: color(targetLane),
        strokeWidth: 1.6,
        opacity: 0.9,
      }),
    )
  })
  // 提交节点
  elements.push(h('circle', { key: 'dot', cx: cx(row.lane), cy, r: 3.6, fill: color(row.lane), stroke: 'var(--gufa-bg, #111)', strokeWidth: 1.2 }))
  return h(
    'div',
    {
      className: 'gufa-graph-row',
      'data-selected': props.selected === true ? '' : undefined,
      onClick: () => props.onSelect(row.commit),
      title: row.commit.subject,
    },
    h('span', { className: 'gufa-graph-svg', style: { width, minWidth: width } }, h('svg', { width, height: rowHeight }, ...elements)),
    h('span', { className: 'gufa-graph-refs' }, ...(row.commit.refs ?? []).slice(0, 3).map((ref) => {
      const current = ref.startsWith('HEAD -> ')
      const clean = current ? ref.slice('HEAD -> '.length) : ref
      return h('span', { key: ref, className: 'gufa-graph-ref', 'data-current': current || clean === props.branch ? '' : undefined }, current ? `HEAD -> ${clean}` : clean)
    })),
    h('span', { className: 'gufa-graph-subject' }, row.commit.subject),
    h('span', { className: 'gufa-graph-meta' }, row.commit.author),
    h('span', { className: 'gufa-graph-meta' }, row.commit.when),
  )
}

G.GitGraphView = function GitGraphView(props) {
  const t = G.useT()
  const root = typeof props.root === 'string' && props.root !== '' ? props.root : null
  const [state, setState] = useState({ status: 'loading', commits: [], branch: '', error: '' })
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState({ status: 'idle', files: [], error: '' })
  const [showAll, setShowAll] = useState(true)
  const [copyTip, setCopyTip] = useState('')

  useEffect(() => {
    if (root === null) {
      setState({ status: 'ready', commits: [], branch: '', error: '' })
      return undefined
    }
    let cancelled = false
    setState((current) => ({ ...current, status: current.commits.length === 0 ? 'loading' : 'refreshing', error: '' }))
    void G.api('git.graph', { root, all: showAll })
      .then((value) => {
        if (cancelled) return
        setState({
          status: 'ready',
          commits: Array.isArray(value?.commits) ? value.commits : [],
          branch: typeof value?.branch === 'string' ? value.branch : '',
          error: typeof value?.error === 'string' ? value.error : '',
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({ status: 'error', commits: [], branch: '', error: G.errorText(error) })
      })
    return () => {
      cancelled = true
    }
  }, [root, props.refreshToken, showAll])

  /* 选中提交后拉取改动文件列表 */
  useEffect(() => {
    if (root === null || selected === null) {
      setDetail({ status: 'idle', files: [], error: '' })
      return undefined
    }
    let cancelled = false
    setDetail({ status: 'loading', files: [], error: '' })
    void G.api('git.commitFiles', { root, hash: selected.hash })
      .then((value) => {
        if (cancelled) return
        setDetail({ status: 'ready', files: Array.isArray(value?.files) ? value.files : [], error: '' })
      })
      .catch((error) => {
        if (cancelled) return
        setDetail({ status: 'error', files: [], error: G.errorText(error) })
      })
    return () => {
      cancelled = true
    }
  }, [root, selected])

  const layout = useMemo(() => G.gitGraphLayout(state.commits), [state.commits])

  const copyHash = (hash) => {
    try {
      void navigator.clipboard?.writeText(hash)
      setCopyTip(t('graph.copied'))
      window.setTimeout(() => setCopyTip(''), 1500)
    } catch {
      /* ignore */
    }
  }

  const header = h(
    'div',
    { className: 'gufa-graph-head' },
    h(G.Icon, { name: 'graph', size: 14 }),
    h('span', { className: 'gufa-panel-head-title' }, t('graph.title')),
    state.branch !== '' ? h('span', { className: 'gufa-graph-branch' }, h(G.Icon, { name: 'branch', size: 12 }), state.branch) : null,
    h('div', { style: { flex: '1 1 auto' } }),
    copyTip !== '' ? h('span', { className: 'gufa-hint' }, copyTip) : null,
    h(G.Button, { icon: 'branch', title: t('graph.toggleAll'), onClick: () => setShowAll((value) => value !== true) }, showAll === true ? t('graph.allBranches') : t('graph.currentBranch')),
    h(G.IconButton, { title: t('graph.refresh'), onClick: () => props.onRefresh?.() }, h(G.Icon, { name: 'refresh', size: 13 })),
  )

  if (root === null) {
    return h('div', { className: 'gufa-graph-view' }, header, h(G.Empty, { icon: 'branch', title: t('graph.noProject') }))
  }
  if (state.status === 'loading') {
    return h('div', { className: 'gufa-graph-view' }, header, h('div', { className: 'gufa-graph-loading' }, h(G.Spinner), t('common.loading')))
  }
  if (state.error !== '') {
    return h('div', { className: 'gufa-graph-view' }, header, h('div', { className: 'gufa-error-banner', style: { margin: 10 } }, state.error))
  }
  if (state.commits.length === 0) {
    return h('div', { className: 'gufa-graph-view' }, header, h(G.Empty, { icon: 'branch', title: t('graph.noCommits') }))
  }

  const aside = selected === null
    ? h('div', { className: 'gufa-graph-aside gufa-graph-aside-empty' }, t('graph.selectCommitHint'))
    : h(
        'div',
        { className: 'gufa-graph-aside' },
        h(
          'div',
          { className: 'gufa-graph-commit' },
          h('div', { className: 'gufa-graph-commit-subject' }, selected.subject),
          h('div', { className: 'gufa-graph-commit-meta' }, h('code', null, selected.short), h('span', null, selected.author), h('span', null, selected.when)),
          h(
            'div',
            { className: 'gufa-graph-commit-actions' },
            h(G.Button, { icon: 'files', onClick: () => copyHash(selected.hash) }, t('graph.copyHash')),
            selected.refs !== null && selected.refs !== undefined && selected.refs.length > 0
              ? h('span', { className: 'gufa-graph-refs' }, ...selected.refs.slice(0, 4).map((ref) => h('span', { key: ref, className: 'gufa-graph-ref' }, ref)))
              : null,
          ),
        ),
        h('div', { className: 'gufa-graph-files-head' }, t('graph.changedFiles'), detail.status === 'ready' ? h('span', { className: 'gufa-graph-files-count' }, String(detail.files.length)) : null),
        detail.status === 'loading'
          ? h('div', { className: 'gufa-graph-loading', style: { height: 80 } }, h(G.Spinner), t('common.loading'))
          : detail.status === 'error'
            ? h('div', { className: 'gufa-error-banner', style: { margin: 8 } }, detail.error)
            : detail.files.length === 0
              ? h('div', { className: 'gufa-hint', style: { padding: '8px 12px' } }, t('graph.noChangedFiles'))
              : h(
                  'div',
                  { className: 'gufa-graph-files' },
                  ...detail.files.map((file) =>
                    h(
                      'button',
                      {
                        key: `${file.status}:${file.path}`,
                        type: 'button',
                        className: 'gufa-graph-file',
                        title: t('graph.openFileDiff'),
                        onClick: () => props.onOpenCommitFile?.(selected, file),
                      },
                      h('span', { className: 'gufa-graph-file-status', 'data-kind': file.status }, file.status),
                      h('span', { className: 'gufa-graph-file-path' }, file.path),
                    ),
                  ),
                ),
      )

  return h(
    'div',
    { className: 'gufa-graph-view' },
    header,
    h(
      'div',
      { className: 'gufa-graph-split' },
      h(
        'div',
        { className: 'gufa-graph-body gufa-scroll' },
        ...layout.rows.map((row) =>
          h(gufaGraphRow, {
            key: row.commit.hash,
            row,
            rows: layout.rows,
            hashRow: layout.hashRow,
            laneCount: layout.laneCount,
            branch: state.branch,
            selected: selected !== null && selected.hash === row.commit.hash,
            onSelect: (commit) => setSelected(commit),
          }),
        ),
      ),
      aside,
    ),
  )
}


/* ─────────────────────── 50-panels.js ─────────────────────── */
/**
 * 50-panels：左侧三块面板 —— 资源管理器（文件树）、源代码管理（Git）、SSH 主机。
 * 纯展示 + 直接调用 Host API，状态自持；容器在 90-app.js。
 */

/* ── 资源管理器 ────────────────────────────────────────────────────────── */
G.Explorer = function Explorer(props) {
  const t = G.useT()
  const root = props.root
  const [dirs, setDirs] = useState({})
  const [expanded, setExpanded] = useState({})
  const [selected, setSelected] = useState(() => (props.activePath ? { path: props.activePath, kind: 'file' } : null))
  const [multi, setMulti] = useState([])
  const [clipboard, setClipboard] = useState(null)
  const [menu, setMenu] = useState(null)
  const [menuError, setMenuError] = useState('')
  const [notice, setNotice] = useState('')
  const containerRef = useRef(null)
  const flatRows = []
  const kindByPathRef = useRef(new Map())
  const problems = G.useProblems()
  /* 目录里含改动的文件 → 目录也给个提示点 */
  const changedDirs = useMemo(() => {
    const set = new Set()
    const statuses = props.gitStatuses
    if (statuses !== null && typeof statuses === 'object') {
      for (const path of Object.keys(statuses)) {
        const parts = path.split('/')
        parts.pop()
        let dir = ''
        for (const part of parts) {
          if (part === '') continue
          dir = dir === '' ? part : `${dir}/${part}`
          set.add(dir)
        }
      }
    }
    return set
  }, [props.gitStatuses])

  const loadDir = useCallback(async (path) => {
    // 已有内容时后台静默刷新：不要把整棵树换成 loading（否则每次保存都会闪一下）
    setDirs((current) => {
      const existing = current[path]
      if (existing !== undefined && existing.status !== 'error' && Array.isArray(existing.entries) && existing.entries.length >= 0 && existing.entries !== undefined) {
        return { ...current, [path]: { ...existing, refreshing: true } }
      }
      return { ...current, [path]: { status: 'loading', entries: [] } }
    })
    try {
      const value = await G.api('fs.list', { root, path })
      setDirs((current) => ({ ...current, [path]: { status: 'ready', entries: value.entries } }))
    } catch (error) {
      setDirs((current) => ({ ...current, [path]: { status: 'error', entries: [], error: G.errorText(error) } }))
    }
  }, [root])

  useEffect(() => {
    if (!root) return
    setDirs({})
    setExpanded({})
    void loadDir('')
  }, [root, loadDir])

  // 刷新令牌：重新读取已展开过的目录，保留展开状态
  const dirsRef = useRef(dirs)
  dirsRef.current = dirs
  useEffect(() => {
    if (!root || props.refreshToken === undefined) return
    if (Object.keys(dirsRef.current).length === 0) return
    for (const path of Object.keys(dirsRef.current)) void loadDir(path)
  }, [props.refreshToken, root, loadDir])

  useEffect(() => {
    if (props.activePath) setSelected({ path: props.activePath, kind: 'file' })
  }, [props.activePath])

  useEffect(() => {
    if (menu === null) return undefined
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const toggleDir = (path) => {
    setSelected({ path, kind: 'dir' })
    setExpanded((current) => {
      const next = { ...current, [path]: !current[path] }
      return next
    })
    if (dirs[path] === undefined || dirs[path].status === 'error') void loadDir(path)
  }

  const selectedDir = () => {
    if (selected === null) return ''
    return selected.kind === 'dir' ? selected.path : projectDirOf(selected.path)
  }

  const selectedPaths = () => (multi.length > 0 ? multi.slice() : selected === null ? [] : [selected.path])

  const copySelection = (paths) => {
    if (!Array.isArray(paths) || paths.length === 0) return
    setClipboard({ entries: paths.slice() })
    setMenuError('')
  }

  const pasteInto = async (dir) => {
    if (clipboard === null || clipboard.entries.length === 0) return
    const target = typeof dir === 'string' ? dir : ''
    try {
      await G.api('fs.copy', { root, from: clipboard.entries, to: target })
      setMenuError('')
      await loadDir(target)
      await loadDir('')
      props.onChanged?.()
    } catch (error) {
      setMenuError(G.errorText(error))
    }
  }

  const noticeRef = useRef(0)
  const showNotice = (text) => {
    setNotice(text)
    noticeRef.current += 1
    const token = noticeRef.current
    window.setTimeout(() => {
      if (noticeRef.current === token) setNotice('')
    }, 3200)
  }

  const readFileBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const comma = text.indexOf(',')
      resolve(comma >= 0 ? text.slice(comma + 1) : '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })

  /** 把系统剪贴板 / Finder 拖入的文件写入目标目录。@returns 是否接管了这次事件 */
  const uploadFiles = async (fileList, dir) => {
    const files = Array.from(fileList ?? []).filter((file) => file !== null && typeof file === 'object' && typeof file.size === 'number')
    if (files.length === 0) return false
    const total = files.reduce((sum, file) => sum + (file.size || 0), 0)
    if (total <= 0) {
      showNotice('这个剪贴板项没有可读取的文件内容（文件夹暂不支持，请拖入文件）')
      return true
    }
    if (total > 300 * 1024 * 1024) {
      showNotice(`文件太大（${Math.round(total / 1024 / 1024)}MB），超过 300MB 上限`)
      return true
    }
    const targetDir = typeof dir === 'string' ? dir : ''
    showNotice(`正在写入 ${files.length} 个文件…`)
    try {
      const payload = []
      for (const file of files) {
        payload.push({ name: file.name !== '' ? file.name : 'file', data: await readFileBase64(file) })
      }
      const result = await G.api('fs.upload', { root, dir: targetDir, files: payload })
      const written = Array.isArray(result?.written) ? result.written : []
      await loadDir(targetDir)
      await loadDir('')
      props.onChanged?.()
      showNotice(`已粘贴 ${written.length} 个文件到 ${targetDir === '' ? '项目根目录' : targetDir}`)
    } catch (error) {
      showNotice(`粘贴失败：${G.errorText(error)}`)
    }
    return true
  }

  /** 拖放目标所在的目录（拖到文件行 → 其父目录；拖到文件夹行 → 该文件夹）。 */
  const dropTargetDir = (target) => {
    const element = target instanceof Element ? target.closest('[data-edrv-path]') : null
    if (element === null) return selectedDir()
    const path = element.getAttribute('data-edrv-path') ?? ''
    if (path === '') return ''
    const kind = element.getAttribute('data-kind')
    return kind === 'dir' ? path : projectDirOf(path)
  }

  const revealPath = (path) => {
    void G.api('fs.reveal', { root, path }).catch((error) => setMenuError(G.errorText(error)))
  }

  const rememberKind = (entry) => {
    try {
      kindByPathRef.current.set(entry.path, entry.kind)
    } catch {
      /* ignore */
    }
  }

  const toggleMulti = (entry) => {
    rememberKind(entry)
    // ⌘/Ctrl+点击：把「当前单选的文件」也并入多选，再切换本次点击项
    setMulti((current) => {
      const base = current.length > 0
        ? current
        : selected !== null && selected.path !== entry.path && selected.path !== undefined
          ? [selected.path]
          : []
      return base.includes(entry.path) ? base.filter((item) => item !== entry.path) : [...base, entry.path]
    })
    setSelected({ path: entry.path, kind: entry.kind })
  }

  const selectRangeTo = (entry) => {
    for (const row of flatRows) kindByPathRef.current.set(row.path, row.kind)
    if (selected === null) {
      setMulti([entry.path])
      return
    }
    const from = flatRows.findIndex((row) => row.path === selected.path)
    const to = flatRows.findIndex((row) => row.path === entry.path)
    if (from === -1 || to === -1) {
      setMulti([entry.path])
      return
    }
    const [start, end] = from <= to ? [from, to] : [to, from]
    setMulti(flatRows.slice(start, end + 1).map((row) => row.path))
  }

  const openContextMenu = (event, entry) => {
    event.preventDefault()
    event.stopPropagation()
    const inside = multi.includes(entry.path)
    const paths = inside && multi.length > 0 ? multi.slice() : [entry.path]
    if (!(inside && multi.length > 1)) setMulti([entry.path])
    setSelected({ path: entry.path, kind: entry.kind })
    const entries = paths.map((path) => {
      const remembered = kindByPathRef.current.get(path)
      const row = flatRows.find((item) => item.path === path)
      return { path, kind: remembered ?? (row === undefined ? 'file' : row.kind) }
    })
    kindByPathRef.current.set(entry.path, entry.kind)
    const pos = clampMenuPosition(event.clientX, event.clientY, 240, 320)
    setMenu({ x: pos.x, y: pos.y, path: entry.path, kind: entry.kind, entries })
  }

  const renderRows = (path, depth) => {
    const state = dirs[path]
    if (state === undefined) {
      return [h('div', { key: `${path}:idle`, className: 'gufa-hint', style: { padding: '4px 12px' } }, t('explorer.loading'))]
    }
    if (state.status === 'loading') {
      return [h('div', { key: `${path}:loading`, className: 'gufa-hint', style: { padding: '4px 12px', display: 'flex', gap: 8, alignItems: 'center' } }, h(G.Spinner), t('explorer.loading'))]
    }
    if (state.status === 'error') {
      return [h('div', { key: `${path}:error`, className: 'gufa-error-banner' }, state.error)]
    }
    if (state.entries.length === 0) {
      return [h('div', { key: `${path}:empty`, className: 'gufa-hint', style: { padding: '4px 12px' } }, t('explorer.empty'))]
    }
    const rows = []
    for (const entry of state.entries) {
      const isDir = entry.kind === 'dir'
      const isExpanded = expanded[entry.path] === true
      const status = props.gitStatuses?.[entry.path]
      rows.push(
        h(
          'button',
          {
            key: entry.path,
            type: 'button',
            className: 'gufa-tree-row',
            'data-selected': multi.length > 0 ? (multi.includes(entry.path) ? '' : undefined) : selected !== null && selected.path === entry.path ? '' : undefined,
            'data-kind': entry.kind,
            'data-git-status': status !== undefined ? status : undefined,
            /* 给 dsh-drag-ref 用：把资源管理器行变成可拖拽的 @ 引用来源 */
            'data-edrv-path': entry.path,
            style: { paddingLeft: 8 + depth * 14 },
            title: entry.path,
            onClick: (event) => {
              containerRef.current?.focus?.()
              rememberKind(entry)
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault()
                toggleMulti(entry)
                return
              }
              if (event.shiftKey) {
                event.preventDefault()
                selectRangeTo(entry)
                return
              }
              setMulti([])
              setSelected({ path: entry.path, kind: entry.kind })
              if (isDir) toggleDir(entry.path)
              else props.onOpenFile?.(entry.path)
            },
            onContextMenu: (event) => openContextMenu(event, entry),
          },
          h(
            'span',
            { className: 'gufa-tree-chevron' },
            isDir ? h(G.Icon, { name: isExpanded ? 'chevron-down' : 'chevron-right', size: 12 }) : null,
          ),
          /* dsh-drag-ref 用非空的 .edrv-tree-chev 文本判断「这是文件夹」 */
          isDir ? h('span', { className: 'edrv-tree-chev', style: { display: 'none' } }, '▸') : null,
          h('span', { className: 'gufa-tree-icon' }, h(G.Icon, { name: isDir ? (isExpanded ? 'folder-open' : 'folder') : 'file', size: 14 })),
          h('span', { className: 'gufa-tree-name' }, entry.name),
          isDir && changedDirs.has(entry.path) ? h('span', { className: 'gufa-tree-problem', 'data-level': 'dir', title: t('explorer.changedDir') }) : null,
          !isDir && problems[entry.path] !== undefined
            ? h('span', {
                className: 'gufa-tree-problem',
                'data-level': problems[entry.path].errors > 0 ? undefined : 'warning',
                title: `${problems[entry.path].errors} error(s), ${problems[entry.path].warnings} warning(s)`,
              })
            : null,
          status ? h('span', { className: 'gufa-tree-badge', title: status }, status) : null,
        ),
      )
      if (isDir && isExpanded) rows.push(...renderRows(entry.path, depth + 1))
    }
    return rows
  }

  return h(
    'div',
    {
      ref: containerRef,
      style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none' },
      tabIndex: 0,
      onPaste: (event) => {
        const files = event.clipboardData?.files
        if (files !== undefined && files !== null && files.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          void uploadFiles(files, selectedDir())
        }
      },
      onDragOver: (event) => {
        const types = event.dataTransfer?.types
        if (types === undefined || types === null || !Array.from(types).includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDrop: (event) => {
        const files = event.dataTransfer?.files
        if (files === undefined || files === null || files.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        void uploadFiles(files, dropTargetDir(event.target))
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          if (selected === null) return
          event.preventDefault()
          props.onRename?.(selected.path)
          return
        }
        const mod = event.metaKey || event.ctrlKey
        if (!mod || event.altKey) {
          if (event.key === 'Delete' && selected !== null) {
            event.preventDefault()
            props.onDelete?.(selected.path)
          }
          return
        }
        const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''
        if (key === 'c') {
          event.preventDefault()
          copySelection(selectedPaths())
        } else if (key === 'v' && clipboard !== null) {
          event.preventDefault()
          void pasteInto(selectedDir())
        } else if (key === 'backspace' || event.key === 'Delete') {
          event.preventDefault()
          if (selected !== null) props.onDelete?.(selected.path)
        }
      },
    },
    h(
      'div',
      { className: 'gufa-panel-head' },
      h('span', { className: 'gufa-panel-head-title' }, t('activity.explorer')),
      multi.length > 1 ? h('span', { className: 'gufa-badge' }, String(multi.length)) : null,
      h(G.IconButton, { title: t('explorer.newFile'), onClick: () => props.onNewFile?.(selectedDir()) }, h(G.Icon, { name: 'plus', size: 14 })),
      h(G.IconButton, { title: t('explorer.newFolder'), onClick: () => props.onNewFolder?.(selectedDir()) }, h(G.Icon, { name: 'folder', size: 14 })),
      h(G.IconButton, { title: t('explorer.refresh'), onClick: () => void loadDir('') }, h(G.Icon, { name: 'refresh', size: 13 })),
    ),
    notice !== ''
      ? h('div', { className: 'gufa-explorer-notice', title: notice }, notice)
      : null,
    h(
      'div',
      { className: 'gufa-panel-body gufa-scroll' },
      menuError !== ''
        ? h('div', { className: 'gufa-error-banner' }, h(G.Icon, { name: 'warn', size: 13 }), h('span', { style: { flex: '1 1 auto' } }, menuError), h(G.IconButton, { title: t('common.close'), onClick: () => setMenuError('') }, h(G.Icon, { name: 'close', size: 11 })))
        : null,
      root ? h('div', { className: 'gufa-tree' }, renderRows('', 0)) : h(G.Empty, { icon: 'folder', title: t('explorer.openProjectFirst') }),
    ),
    menu === null
      ? null
      : (() => {
          const entries = Array.isArray(menu.entries) && menu.entries.length > 0 ? menu.entries : [{ path: menu.path, kind: menu.kind }]
          const files = entries.filter((item) => item.kind === 'file')
          const single = entries.length === 1
          const targetDir = entries.length === 1 && menu.kind === 'dir' ? menu.path : projectDirOf(menu.path)
          const closeAnd = (fn) => () => {
            setMenu(null)
            fn()
          }
          return h(
            'div',
            {
              className: 'gufa-menu',
              style: { left: menu.x, top: menu.y, position: 'fixed' },
              onMouseDown: (event) => event.stopPropagation(),
            },
            single && menu.kind === 'dir'
              ? h(G.MenuItem, { icon: 'plus', label: t('explorer.newFile'), onClick: closeAnd(() => props.onNewFile?.(menu.path)) })
              : null,
            single && menu.kind === 'dir'
              ? h(G.MenuItem, { icon: 'folder', label: t('explorer.newFolder'), onClick: closeAnd(() => props.onNewFolder?.(menu.path)) })
              : null,
            entries.length === 2 && files.length === 2 && files.every((item) => item.kind === 'file')
              ? h(G.MenuItem, {
                  icon: 'code',
                  label: t('explorer.compareSelected'),
                  onClick: closeAnd(() => props.onCompareFiles?.(files[0].path, files[1].path)),
                })
              : null,
            h(G.MenuItem, { icon: 'files', label: t('explorer.copy'), onClick: closeAnd(() => copySelection(entries.map((item) => item.path))) }),
            clipboard !== null
              ? h(G.MenuItem, { icon: 'folder-open', label: t('explorer.paste'), onClick: closeAnd(() => void pasteInto(targetDir)) })
              : null,
            single
              ? h(G.MenuItem, { icon: 'folder-open', label: t('explorer.revealInFinder'), onClick: closeAnd(() => revealPath(menu.path)) })
              : null,
            single && menu.kind !== 'dir'
              ? h(G.MenuItem, { icon: 'pencil', label: t('explorer.rename'), onClick: closeAnd(() => props.onRename?.(menu.path)) })
              : null,
            single
              ? h(G.MenuItem, { icon: 'trash', label: t('explorer.delete'), danger: true, onClick: closeAnd(() => props.onDelete?.(menu.path)) })
              : null,
          )
        })(),
  )
}

/** 菜单定位：保证不超出视口（右下角靠近边缘时向内收）。 */
function clampMenuPosition(x, y, width, height) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  return {
    x: Math.max(8, Math.min(x, vw - width - 8)),
    y: Math.max(8, Math.min(y, vh - height - 8)),
  }
}

/** 选中路径所在目录（目录本身返回自身）。 */
function projectDirOf(path) {
  if (!path) return ''
  const parts = path.split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

G.MenuItem = function MenuItem(props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'gufa-menu-item',
      'data-danger': props.danger ? '' : undefined,
      onMouseDown: (event) => event.stopPropagation(),
      onClick: props.onClick,
    },
    props.icon ? h(G.Icon, { name: props.icon, size: 14 }) : null,
    props.label,
  )
}

/* ── 源代码管理（Git） ─────────────────────────────────────────────────── */
G.GitPanel = function GitPanel(props) {
  const t = G.useT()
  const root = props.root
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [info, setInfo] = useState('')

  /* 操作结果提示（已推送 / 拉取完成 等）自动消失 */
  useEffect(() => {
    if (info === '') return undefined
    const timer = window.setTimeout(() => setInfo(''), 1500)
    return () => window.clearTimeout(timer)
  }, [info])
  const [discardArmed, setDiscardArmed] = useState(false)
  const [headMenu, setHeadMenu] = useState(null)
  const [rowMenu, setRowMenu] = useState(null)

  /* 回调放 ref：避免父级每次重渲染都换 refresh 身份，导致刷新 effect 无限重置 → 一直「加载中」 */
  const onStatusRef = useRef(props.onStatus)
  onStatusRef.current = props.onStatus
  const rootRef = useRef(root)
  rootRef.current = root

  const refresh = useCallback(async () => {
    const target = rootRef.current
    if (!target) {
      setStatus(null)
      return
    }
    setError('')
    try {
      const value = await G.api('git.status', { root: target })
      setStatus(value)
      try {
        onStatusRef.current?.(value)
      } catch {
        /* 通知失败不影响面板 */
      }
    } catch (err) {
      setError(G.errorText(err))
      // 失败也不要停在「加载中」：给一个空状态让错误可见
      setStatus((current) => current ?? { isGit: true, branch: '', ahead: 0, behind: 0, changes: [] })
    }
  }, [])

  /* 项目变化：清空并重新拉取 */
  useEffect(() => {
    setStatus(null)
    setMessage('')
    void refresh()
  }, [root, refresh])

  /* 外部刷新令牌：保留当前内容，仅后台刷新 */
  useEffect(() => {
    if (props.refreshToken === undefined) return
    void refresh()
  }, [props.refreshToken, refresh])

  const act = async (fn) => {
    setPending(true)
    setError('')
    setInfo('')
    try {
      await fn()
      await refresh()
      props.onChanged?.()
    } catch (err) {
      setError(G.errorText(err))
    } finally {
      setPending(false)
    }
  }

  /* 推送 / 拉取：点 ↑/↓ 直接执行 */
  const push = () => void act(async () => {
    await G.api('git.push', { root })
    setInfo(t('git.pushDone'))
  })
  const pull = () => void act(async () => {
    await G.api('git.pull', { root })
    setInfo(t('git.pullDone'))
  })

  /* 推送 / 拉取（新建分支还没有上游时也能直接发布：Host 会自动 -u <remote> <branch>） */
  const pushBranch = () => void act(async () => {
    await G.api('git.push', { root })
    setInfo(t('git.pushDone'))
  })
  const pullBranch = () => void act(async () => {
    await G.api('git.pull', { root })
    setInfo(t('git.pullDone'))
  })

  /* 一键撤销所有未暂存改动：第一次点击进入「再点确认」，3 秒后自动取消 */
  const discardAll = () => {
    if (discardArmed !== true) {
      setDiscardArmed(true)
      window.setTimeout(() => setDiscardArmed(false), 3000)
      return
    }
    setDiscardArmed(false)
    void act(async () => {
      await G.api('git.discardAll', { root })
      setInfo(t('git.discardDone'))
    })
  }

  const commitRef = useRef(null)
  const commit = () => {
    if (root === null || pending) return
    const text = typeof message === 'string' ? message.trim() : ''
    if (text === '') {
      setInfo(t('git.commitNeedsMessage'))
      return
    }
    void act(async () => {
      // 直接点「提交」或按快捷键时：未暂存的改动自动全部暂存，再提交
      const toStage = changes.filter((item) => item.staged !== true).map((item) => item.path)
      if (toStage.length > 0) await G.api('git.stage', { root, paths: toStage })
      await G.api('git.commit', { root, message: text })
      setMessage('')
      setInfo(t('git.commitDone'))
    })
  }
  commitRef.current = commit

  /* 快捷键 ⌘⇧↵ 触发提交（App 通过总线转发；面板保持挂载，隐藏时也能用） */
  useEffect(() => {
    if (G.bus === undefined || G.bus === null || typeof G.bus.on !== 'function') return undefined
    return G.bus.on('git:commit', () => {
      commitRef.current?.()
    })
  }, [])

  /* 点击其它位置关闭菜单 */
  useEffect(() => {
    if (headMenu === null && rowMenu === null) return undefined
    const close = () => {
      setHeadMenu(null)
      setRowMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [headMenu, rowMenu])

  /** 菜单项公共动作：执行后关闭菜单。 */
  const menuAction = (fn) => () => {
    setHeadMenu(null)
    setRowMenu(null)
    fn()
  }

  const copyText = (text) => {
    try {
      void navigator.clipboard?.writeText(text)
    } catch {
      /* ignore */
    }
  }

  const changes = status?.changes ?? []
  const staged = changes.filter((item) => item.staged)
  const unstaged = changes.filter((item) => !item.staged)

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h(
      'div',
      { className: 'gufa-panel-head' },
      h('span', { className: 'gufa-panel-head-title' }, t('activity.git')),
      changes.length > 0 ? h('span', { className: 'gufa-badge' }, String(changes.length)) : null,
      unstaged.length > 0
        ? h(G.IconButton, {
            title: t('git.stageAll'),
            disabled: pending,
            onClick: () => void act(async () => { await G.api('git.stage', { root, paths: unstaged.map((item) => item.path) }) }),
          }, h(G.Icon, { name: 'plus', size: 13 }))
        : null,
      staged.length > 0
        ? h(G.IconButton, {
            title: t('git.unstageAll'),
            disabled: pending,
            onClick: () => void act(async () => { await G.api('git.unstage', { root, paths: staged.map((item) => item.path) }) }),
          }, h(G.Icon, { name: 'minus', size: 13 }))
        : null,
      unstaged.length > 0
        ? h(G.IconButton, {
            title: discardArmed === true ? t('git.discardConfirm') : t('git.discardAll'),
            disabled: pending,
            onClick: discardAll,
            style: { color: 'var(--dsw-alias-state-error-primary, #f85149)' },
          }, h(G.Icon, { name: 'trash', size: 13 }))
        : null,
      h(
        'button',
        {
          type: 'button',
          className: 'gufa-git-sync',
          'data-active': (status?.ahead ?? 0) > 0 || status?.hasUpstream !== true ? '' : undefined,
          disabled: pending,
          title: status?.hasUpstream !== true
            ? t('git.pushNoUpstream')
            : `${t('git.push')} · ${t('git.aheadCount')} ${status?.ahead ?? 0} · ${t('git.behindCount')} ${status?.behind ?? 0}`,
          onClick: pushBranch,
        },
        h(G.Icon, { name: 'arrow-up', size: 13 }),
        h('span', { className: 'gufa-git-sync-count' }, status?.hasUpstream === true ? String(status?.ahead ?? 0) : '↑'),
      ),
      status?.hasUpstream === true
        ? h(
            'button',
            {
              type: 'button',
              className: 'gufa-git-sync',
              'data-active': (status?.behind ?? 0) > 0 ? '' : undefined,
              disabled: pending,
              title: `${t('git.pull')} · ${t('git.behindCount')} ${status?.behind ?? 0}`,
              onClick: pullBranch,
            },
            h(G.Icon, { name: 'arrow-down', size: 13 }),
            h('span', { className: 'gufa-git-sync-count' }, String(status?.behind ?? 0)),
          )
        : null,
      h(G.IconButton, { title: t('graph.open'), onClick: () => props.onOpenGraph?.() }, h(G.Icon, { name: 'graph', size: 13 })),
      h(G.IconButton, { title: t('git.refresh'), disabled: pending, onClick: () => void refresh() }, h(G.Icon, { name: 'refresh', size: 13 })),
      h(G.IconButton, {
        title: t('git.more'),
        onClick: (event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setRowMenu(null)
          setHeadMenu({ x: rect.right - 200, y: rect.bottom + 4 })
        },
      }, h('span', { style: { fontSize: 14, lineHeight: 1 } }, '⋯')),
    ),
    h(
      'div',
      { className: 'gufa-panel-body gufa-scroll', style: { display: 'flex', flexDirection: 'column' } },
      error !== '' ? h('div', { className: 'gufa-error-banner' }, G.Icon ? h(G.Icon, { name: 'warn', size: 13 }) : null, error) : null,
      info !== '' ? h('div', { className: 'gufa-info-banner' }, info) : null,
      !root
        ? h(G.Empty, { icon: 'git', title: t('explorer.openProjectFirst') })
        : status === null
          ? h(G.Empty, { title: t('common.loading') })
          : status.isGit === false
            ? h(G.Empty, { icon: 'git', title: t('git.noRepo'), hint: t('git.noRepoHint') })
            : h(
                'div',
                { style: { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 } },
                h(
                  'div',
                  {
                    className: 'gufa-row',
                    style: { color: 'var(--gufa-text-dim)', fontSize: 11.5, cursor: 'pointer' },
                    title: t('git.branchSwitchHint'),
                    onClick: (event) => props.onOpenBranches?.(event),
                  },
                  h(G.Icon, { name: 'branch', size: 13 }),
                  h('span', { style: { color: 'var(--gufa-text)', fontWeight: 600 } }, status.branch || '—'),
                  status.ahead > 0
                    ? h('button', {
                        type: 'button',
                        className: 'gufa-sync',
                        title: t('git.pushHint'),
                        disabled: pending,
                        onClick: (event) => { event.stopPropagation(); push() },
                      }, `↑${status.ahead}`)
                    : null,
                  status.behind > 0
                    ? h('button', {
                        type: 'button',
                        className: 'gufa-sync',
                        title: t('git.pullHint'),
                        disabled: pending,
                        onClick: (event) => { event.stopPropagation(); pull() },
                      }, `↓${status.behind}`)
                    : null,
                ),
                status?.hasUpstream !== true && status?.branch
                  ? h('div', { className: 'gufa-hint', style: { marginTop: 2 } }, t('git.noUpstreamHint'))
                  : null,
                changes.length === 0
                  ? h(G.Empty, { icon: 'check', title: t('git.noChanges'), hint: '' })
                  : null,
                changes.length > 0
                  ? h(
                      'textarea',
                      {
                        className: 'gufa-textarea',
                        placeholder: t('git.commitPlaceholder'),
                        value: message,
                        rows: 2,
                        onChange: (event) => setMessage(event.target.value),
                        onKeyDown: (event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault()
                            commit()
                          }
                        },
                      },
                    )
                  : null,
                changes.length > 0 && unstaged.length > 0
                  ? h('div', { className: 'gufa-hint' }, t('git.autoStageHint'))
                  : null,
                changes.length > 0
                  ? h(
                      'div',
                      { className: 'gufa-row', style: { justifyContent: 'flex-end', alignItems: 'center', gap: 8 } },
                      staged.length > 0 ? h('span', { className: 'gufa-hint' }, `${t('git.staged')} (${staged.length})`) : null,
                      h(G.Button, { disabled: pending || message.trim() === '', primary: true, onClick: commit }, pending ? h(G.Spinner) : null, t('git.commit')),
                    )
                  : null,
                unstaged.length > 0 ? h('div', { className: 'gufa-hint' }, `${t('git.unstaged')} (${unstaged.length})`) : null,
                ...unstaged.map((change) =>
                  h(G.GitChangeRow, {
                    key: `u:${change.path}`,
                    change,
                    pending,
                    onOpen: () => props.onOpenDiff?.(change),
                    onContextMenu: (event, rowChange) => setRowMenu({ ...clampMenuPosition(event.clientX, event.clientY, 200, 200), change: rowChange }),
                    onRevert: () => void act(async () => G.api('git.discard', { root, paths: [change.path] })),
                    revertLabel: t('git.discardFile'),
                    onAction: () => void act(async () => G.api('git.stage', { root, paths: [change.path] })),
                    actionLabel: t('git.stage'),
                    actionIcon: 'plus',
                  }),
                ),
                staged.length > 0 ? h('div', { className: 'gufa-hint' }, `${t('git.staged')} (${staged.length})`) : null,
                ...staged.map((change) =>
                  h(G.GitChangeRow, {
                    key: `s:${change.path}`,
                    change,
                    pending,
                    staged: true,
                    onOpen: () => props.onOpenDiff?.(change),
                    onContextMenu: (event, rowChange) => setRowMenu({ ...clampMenuPosition(event.clientX, event.clientY, 200, 200), change: rowChange }),
                    onAction: () => void act(async () => G.api('git.unstage', { root, paths: [change.path] })),
                    actionLabel: t('git.unstage'),
                    actionIcon: 'minus',
                  }),
                ),
              ),
    ),
    headMenu === null
      ? null
      : h(
          'div',
          {
            className: 'gufa-menu',
            style: { left: headMenu.x, top: headMenu.y, position: 'fixed', minWidth: 210 },
            onMouseDown: (event) => event.stopPropagation(),
          },
          unstaged.length > 0
            ? h(G.MenuItem, {
                icon: 'plus',
                label: t('git.stageAll'),
                onClick: menuAction(() => void act(async () => { await G.api('git.stage', { root, paths: unstaged.map((item) => item.path) }) })),
              })
            : null,
          staged.length > 0
            ? h(G.MenuItem, {
                icon: 'minus',
                label: t('git.unstageAll'),
                onClick: menuAction(() => void act(async () => { await G.api('git.unstage', { root, paths: staged.map((item) => item.path) }) })),
              })
            : null,
          unstaged.length > 0
            ? h(G.MenuItem, {
                icon: 'undo',
                label: t('git.discardAll'),
                danger: true,
                onClick: menuAction(() => void act(async () => { await G.api('git.discardAll', { root }) })),
              })
            : null,
          h(G.MenuItem, {
            icon: 'arrow-left',
            label: t('git.undoLastCommit'),
            onClick: menuAction(() => void act(async () => { await G.api('git.undoLastCommit', { root }) })),
          }),
          h(G.MenuItem, {
            icon: 'graph',
            label: t('graph.open'),
            onClick: menuAction(() => props.onOpenGraph?.()),
          }),
        ),
    rowMenu === null
      ? null
      : h(
          'div',
          {
            className: 'gufa-menu',
            style: { left: rowMenu.x, top: rowMenu.y, position: 'fixed', minWidth: 190 },
            onMouseDown: (event) => event.stopPropagation(),
          },
          h(G.MenuItem, { icon: 'code', label: t('git.viewDiff'), onClick: menuAction(() => props.onOpenDiff?.(rowMenu.change)) }),
          rowMenu.change.staged === true
            ? h(G.MenuItem, {
                icon: 'minus',
                label: t('git.unstage'),
                onClick: menuAction(() => void act(async () => { await G.api('git.unstage', { root, paths: [rowMenu.change.path] }) })),
              })
            : h(G.MenuItem, {
                icon: 'plus',
                label: t('git.stage'),
                onClick: menuAction(() => void act(async () => { await G.api('git.stage', { root, paths: [rowMenu.change.path] }) })),
              }),
          rowMenu.change.staged !== true
            ? h(G.MenuItem, {
                icon: 'undo',
                label: t('git.discardFile'),
                danger: true,
                onClick: menuAction(() => void act(async () => { await G.api('git.discard', { root, paths: [rowMenu.change.path] }) })),
              })
            : null,
          h(G.MenuItem, { icon: 'files', label: t('git.copyPath'), onClick: menuAction(() => copyText(rowMenu.change.path)) }),
        ),
  )
}

G.GitChangeRow = function GitChangeRow(props) {
  const change = props.change
  return h(
    'div',
    {
      className: 'gufa-git-change',
      title: `${change.path}（点击查看改动对比）`,
      onClick: () => props.onOpen?.(),
      onContextMenu: (event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onContextMenu?.(event, change)
      },
      style: { cursor: 'pointer' },
    },
    h('span', { className: 'gufa-git-status', 'data-kind': change.status }, change.status),
    h('span', { className: 'gufa-git-path', style: { flex: '1 1 auto' } }, change.path),
    props.staged !== true && typeof props.onRevert === 'function'
      ? h(
          'button',
          {
            type: 'button',
            className: 'gufa-iconbtn',
            title: props.revertLabel ?? '还原该文件的改动',
            disabled: props.pending,
            onClick: (event) => {
              event.stopPropagation()
              props.onRevert?.()
            },
          },
          h(G.Icon, { name: 'undo', size: 13 }),
        )
      : null,
    h(
      'button',
      {
        type: 'button',
        className: 'gufa-iconbtn',
        title: props.actionLabel,
        disabled: props.pending,
        onClick: (event) => {
          event.stopPropagation()
          props.onAction?.()
        },
      },
      h(G.Icon, { name: props.actionIcon, size: 13 }),
    ),
  )
}

/* ── SSH 主机 ──────────────────────────────────────────────────────────── */
G.SshPanel = function SshPanel(props) {
  const t = G.useT()
  const [state, setState] = useState({ status: 'loading', hosts: [], error: '', configPath: '' })

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }))
    try {
      const value = await G.api('ssh.hosts', {})
      setState({ status: 'ready', hosts: value.hosts ?? [], error: '', configPath: value.configPath ?? '' })
    } catch (error) {
      setState({ status: 'error', hosts: [], error: G.errorText(error), configPath: '' })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, props.refreshToken])

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h(
      'div',
      { className: 'gufa-panel-head' },
      h('span', { className: 'gufa-panel-head-title' }, t('ssh.hosts')),
      h(G.IconButton, { title: t('ssh.refresh'), onClick: () => void refresh() }, h(G.Icon, { name: 'refresh', size: 13 })),
    ),
    h(
      'div',
      { className: 'gufa-panel-body gufa-scroll' },
      state.error !== '' ? h('div', { className: 'gufa-error-banner' }, state.error) : null,
      state.status === 'loading'
        ? h(G.Empty, { title: t('common.loading') })
        : state.hosts.length === 0
          ? h(G.Empty, { icon: 'server', title: t('ssh.noHosts'), hint: t('ssh.configHint') })
          : h(
              'div',
              { style: { padding: '6px 6px', display: 'flex', flexDirection: 'column', gap: 1 } },
              ...state.hosts.map((host) =>
                h(
                  'div',
                  { key: host.alias, className: 'gufa-ssh-host', title: t('ssh.connectHint'), onClick: () => props.onConnect?.(host.alias) },
                  h(G.Icon, { name: 'server', size: 14 }),
                  h('span', { className: 'gufa-ssh-alias' }, host.alias),
                  h('span', { className: 'gufa-ssh-hostname' }, [host.user ? `${host.user}@` : '', host.host !== host.alias ? host.host : '', host.port ? `:${host.port}` : ''].join('')),
                  h(G.Icon, { name: 'arrow-right', size: 13 }),
                ),
              ),
            ),
      state.configPath ? h('div', { className: 'gufa-hint', style: { padding: '8px 10px' } }, state.configPath) : null,
    ),
  )
}


/* ─────────────────────── 55-backdrop.js ─────────────────────── */
/**
 * 55-backdrop：把「梁圣」皮肤（@leon___/dsh-client-liang-intensity-skin）的背景图渐变
 * 复刻到古法编程覆盖层里。
 *
 * 皮肤的做法（见其 client.js）：
 *   - 在中心列挂一个 `.liang-skin-backdrop`，背景 = `var(--liang-page)`；
 *   - 内部放一个 `<img class="liang-skin-sequence-frame">`，src 指向皮肤 assets 里的人像
 *     （按强度档位切换 stage-XX.webp），右侧 `min(42vw,720px)`、`object-fit:cover`，
 *     并用 `mask-image: linear-gradient(90deg, transparent → black)` 做「左透明→右实」的渐变；
 *   - 透明度由 `--liang-portrait-opacity` 控制，可选 `data-mask="on"` 时再叠一层渐变遮罩。
 *
 * 古法编程是 `shell.overlay` 覆盖层，会盖住皮肤背景。本模块读取皮肤当前的背景节点/人像/透明度/
 * 遮罩状态，在覆盖层里用同样的渐变规则重建一份背景，让 IDE 也能看到同一张背景图与渐变，
 * 并通过标题栏的「背景」按钮随时开关（偏好持久化）。
 *
 * 皮肤关闭 / 找不到背景节点时不渲染（IDE 保持纯净实色）。
 */

/** 背景开关偏好（'0' = 关闭）。 */
const GUFA_BACKDROP_PREF_KEY = 'gufa-code:backdrop:v1'

G.backdropPref = {
  get() {
    try {
      return localStorage.getItem(GUFA_BACKDROP_PREF_KEY) !== '0'
    } catch {
      return true
    }
  },
  set(value) {
    try {
      localStorage.setItem(GUFA_BACKDROP_PREF_KEY, value === true ? '1' : '0')
    } catch {
      /* 隐私模式忽略 */
    }
  },
}

/** 背景浓度偏好：null = 跟随皮肤自身的透明度；数字 = 0–100 的独立无级浓度。 */
const GUFA_BACKDROP_STRENGTH_KEY = 'gufa-code:backdrop-strength:v1'

G.backdropStrengthPref = {
  get() {
    try {
      const raw = localStorage.getItem(GUFA_BACKDROP_STRENGTH_KEY)
      if (raw === null || raw === '') return null
      const value = Number.parseFloat(raw)
      return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
    } catch {
      return null
    }
  },
  set(value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(GUFA_BACKDROP_STRENGTH_KEY)
      else localStorage.setItem(GUFA_BACKDROP_STRENGTH_KEY, String(Math.max(0, Math.min(100, Number(value)))))
    } catch {
      /* 隐私模式忽略 */
    }
  },
}

/** 滑动变祖皮肤的偏好存储（皮肤源码里的常量），用于开启「31 档细分」。 */
const SKIN_SETTINGS_KEY = 'dsh-liang-intensity-skin.settings.v1'
const SKIN_SETTINGS_MARKER = 'gufa-code:skin-fine-stops:v1'
const SKIN_DEFAULT_VALUES = Object.freeze({
  bindEffort: true,
  maskEnabled: true,
  xianxiaPortraits: false,
  particlesEnabled: false,
  motionEnabled: false,
  fineStopsEnabled: false,
  hideSlider: false,
})

/**
 * 开启滑动变祖皮肤的「31 档细分」（fineStopsEnabled）。
 *
 * 皮肤默认行为：绑定思考等级时，松手会把**外观滑块**吸附到模型真实推理档位
 * （5 档就是 0/7.5/15/22.5/30），所以进度条和背景会「弹」到档位上。
 * 打开 31 档细分后：外观可停在 0–30 的任意整数级（松手只吸附到最近整数级），
 * 进度条与背景停在松手位置，模型仍提交最近的真实推理档位 —— 正是想要的行为。
 *
 * 只干预一次（写 marker，之后用户在皮肤设置里再关掉不会被反复打开）；
 * 写入后派发 StorageEvent，让皮肤的内存 store 立即生效，无需刷新。
 * @returns {{applied:boolean, reason?:string}}
 */
G.ensureSkinFineStops = function ensureSkinFineStops() {
  try {
    if (localStorage.getItem(SKIN_SETTINGS_MARKER) === '1') return { applied: false, reason: 'marked' }
    let record = null
    try {
      const raw = localStorage.getItem(SKIN_SETTINGS_KEY)
      record = raw === null ? null : JSON.parse(raw)
    } catch {
      record = null
    }
    const versioned = record !== null && typeof record === 'object' && record.version === 1 && record.values !== null && typeof record.values === 'object'
    const legacyBind = localStorage.getItem('dsh-liang-intensity-skin.bind-effort') !== '0'
    const legacyMask = localStorage.getItem('dsh-liang-intensity-skin.mask') !== '0'
    const values = versioned
      ? { ...SKIN_DEFAULT_VALUES, ...record.values }
      : { ...SKIN_DEFAULT_VALUES, bindEffort: legacyBind, maskEnabled: legacyMask }
    localStorage.setItem(SKIN_SETTINGS_MARKER, '1')
    if (values.fineStopsEnabled === true) return { applied: false, reason: 'already-enabled' }
    values.fineStopsEnabled = true
    const payload = JSON.stringify({ version: 1, values })
    const previous = localStorage.getItem(SKIN_SETTINGS_KEY)
    localStorage.setItem(SKIN_SETTINGS_KEY, payload)
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof StorageEvent === 'function') {
        window.dispatchEvent(new StorageEvent('storage', {
          key: SKIN_SETTINGS_KEY,
          oldValue: previous,
          newValue: payload,
          storageArea: localStorage,
        }))
      }
    } catch (error) {
      console.error('[gufa-code] 通知皮肤设置失败（刷新后仍会生效）', error)
    }
    return { applied: true }
  } catch (error) {
    return { applied: false, reason: String(error) }
  }
}

/** 读取当前「31 档细分」是否开启（诊断探针用）。 */
G.readSkinFineStops = function readSkinFineStops() {
  try {
    const raw = localStorage.getItem(SKIN_SETTINGS_KEY)
    const record = raw === null ? null : JSON.parse(raw)
    return record !== null && typeof record === 'object' && record.values !== null && typeof record.values === 'object' && record.values.fineStopsEnabled === true
  } catch {
    return false
  }
}

/** 解析 transform 矩阵里的缩放（取 a 分量；非矩阵时返回 1）。 */
function gufaTransformScale(transform) {
  if (typeof transform !== 'string' || transform === '' || transform === 'none') return 1
  const matrix = /matrix\(([^)]+)\)/.exec(transform)
  if (matrix === null) return 1
  const parts = matrix[1].split(',').map((part) => Number.parseFloat(part))
  return parts.length >= 4 && Number.isFinite(parts[0]) && parts[0] > 0 ? parts[0] : 1
}

/**
 * 读取当前皮肤背景状态。纯 DOM 读取，不修改皮肤节点。
 * @returns {{available:boolean, pageColor?:string, pageImage?:string, portraitSrc?:string, portraitOpacity?:number, portraitScale?:number, mask?:boolean, media?:string}}
 */
G.readSkinBackdropMeta = function readSkinBackdropMeta() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return { available: false }
  const body = document.body
  if (body === null || body === undefined || typeof body.hasAttribute !== 'function') return { available: false }
  if (!body.hasAttribute('data-liang-skin')) return { available: false }
  if (typeof document.querySelector !== 'function') return { available: false }
  const node = document.querySelector('.liang-skin-backdrop')
  if (node === null || node === undefined) return { available: false }
  let style
  try {
    style = window.getComputedStyle(node)
  } catch {
    return { available: false }
  }
  const pageColor = style.backgroundColor !== '' && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : ''
  const pageImage = style.backgroundImage !== 'none' && style.backgroundImage !== '' ? style.backgroundImage : ''
  const img = typeof node.querySelector === 'function' ? node.querySelector('img') : null
  let portraitSrc = ''
  let portraitOpacity = 1
  let portraitScale = 1
  if (img !== null && img !== undefined) {
    portraitSrc = img.currentSrc || img.src || ''
    try {
      const imgStyle = window.getComputedStyle(img)
      if (imgStyle.display === 'none') portraitSrc = ''
      const opacity = Number.parseFloat(imgStyle.opacity)
      if (Number.isFinite(opacity)) portraitOpacity = Math.max(0, Math.min(1, opacity))
      portraitScale = Math.max(0.1, Math.min(3, gufaTransformScale(imgStyle.transform)))
    } catch {
      /* 忽略样式读取失败 */
    }
  }
  return {
    available: true,
    pageColor,
    pageImage,
    portraitSrc,
    portraitOpacity,
    portraitScale,
    mask: typeof node.getAttribute === 'function' && node.getAttribute('data-mask') === 'on',
    media: (typeof node.getAttribute === 'function' && node.getAttribute('data-media')) || 'color',
  }
}

/**
 * 订阅皮肤背景状态：皮肤强度变化会换人像、改透明度，这里每 1.5s 轮询一次并在变化时重渲染。
 * @returns {ReturnType<typeof G.readSkinBackdropMeta>}
 */
G.useSkinBackdrop = function useSkinBackdrop() {
  const [meta, setMeta] = useState(() => G.readSkinBackdropMeta())
  useEffect(() => {
    let disposed = false
    const sync = () => {
      if (disposed) return
      const next = G.readSkinBackdropMeta()
      setMeta((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
    }
    sync()
    const timer = window.setInterval(sync, 350)
    window.addEventListener('resize', sync)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return meta
}

/**
 * 背景层：页面底色 + 右侧人像（带左→右渐变遮罩）+ 可选遮罩。
 * 同时注册一个空 overlay 探针（`gufa-code-backdrop-live-<state>`），便于 Client Inspect
 * 验证「背景层已挂载 / 人像已加载」，无需截图。
 */
G.SkinBackdrop = function SkinBackdrop(props) {
  const meta = props.meta
  const [imgState, setImgState] = useState('pending')
  const [layers, setLayers] = useState(() => ({
    current: meta !== null && meta !== undefined && meta.available === true && typeof meta.portraitSrc === 'string' ? meta.portraitSrc : '',
    previous: '',
  }))
  const enabled = props.enabled !== false
  const active = meta !== null && meta !== undefined && meta.available === true && enabled === true
  const portraitSrc = active && typeof meta.portraitSrc === 'string' ? meta.portraitSrc : ''

  // 人像源变化（皮肤换档）时保留旧图层做交叉淡出，避免硬切
  useEffect(() => {
    setLayers((previous) => (previous.current === portraitSrc ? previous : { current: portraitSrc, previous: previous.current }))
  }, [portraitSrc])
  useEffect(() => {
    if (layers.previous === '') return undefined
    const timer = window.setTimeout(() => setLayers((previous) => (previous.previous === '' ? previous : { ...previous, previous: '' })), 520)
    return () => window.clearTimeout(timer)
  }, [layers.previous])
  useEffect(() => {
    if (!active) return undefined
    if (G.ctx === null || G.ctx === undefined || typeof G.ctx.inject !== 'function') return undefined
    const state = imgState === 'ok' ? 'img-ok' : imgState === 'fail' ? 'img-fail' : meta.portraitSrc ? 'img-loading' : 'color-only'
    let dispose = () => {}
    let disposeScope
    try {
      disposeScope = G.ctx.inject(['slots'], (scope) => {
        try {
          const removal = scope.slots.register({ name: 'shell.overlay', id: `gufa-code-backdrop-live-${state}`, order: 996 }, () => null)
          dispose = typeof removal === 'function' ? removal : () => {}
        } catch (error) {
          console.error('[gufa-code] 注册背景探针失败', error)
        }
      })
    } catch (error) {
      console.error('[gufa-code] 注入背景探针失败', error)
      return undefined
    }
    return () => {
      try {
        dispose()
      } catch {
        /* ignore */
      }
      try {
        disposeScope?.()
      } catch {
        /* ignore */
      }
    }
  }, [active, imgState, meta])
  if (!active) return null
  const pageStyle = {}
  if (typeof meta.pageColor === 'string' && meta.pageColor !== '') pageStyle.backgroundColor = meta.pageColor
  if (typeof meta.pageImage === 'string' && meta.pageImage !== '') pageStyle.backgroundImage = meta.pageImage
  pageStyle.backgroundSize = 'cover'
  pageStyle.backgroundPosition = 'center'
  // 浓度：用户拖动过滑杆就用无级值，否则跟随皮肤自身透明度
  const strength = typeof props.strength === 'number' && Number.isFinite(props.strength)
    ? Math.max(0, Math.min(1, props.strength / 100))
    : Math.max(0, Math.min(1, meta.portraitOpacity))
  const portraitStyle = {
    opacity: strength,
    transform: `translateY(-50%) scale(${meta.portraitScale})`,
  }
  const leavingStyle = {
    opacity: 0,
    transform: `translateY(-50%) scale(${meta.portraitScale})`,
  }
  return h(
    'div',
    { className: 'gufa-backdrop', 'aria-hidden': 'true' },
    h('div', { className: 'gufa-backdrop-page', style: pageStyle }),
    h('div', { className: 'gufa-backdrop-glow', 'aria-hidden': 'true' }),
    layers.previous !== ''
      ? h('img', { key: `prev:${layers.previous}`, className: 'gufa-backdrop-portrait', src: layers.previous, alt: '', draggable: false, style: leavingStyle, 'data-leaving': '' })
      : null,
    layers.current !== ''
      ? h('img', {
          key: `cur:${layers.current}`,
          className: 'gufa-backdrop-portrait',
          src: layers.current,
          alt: '',
          draggable: false,
          style: portraitStyle,
          onLoad: () => setImgState('ok'),
          onError: () => setImgState('fail'),
        })
      : null,
    h('div', { className: 'gufa-backdrop-fade' }),
    meta.mask === true ? h('div', { className: 'gufa-backdrop-scrim' }) : null,
    h(G.BackdropParticles, { strength }),
  )
}

/**
 * 背景粒子层：按「滑动变祖」原版粒子参数复刻（小颗粒、数量多、加色发光、从右下方涌向人像）。
 * 原版用 WebGL 点精灵 + 加色混合；这里用 2D canvas + 预渲染光点 sprite + 'lighter' 混合近似，
 * 性能足够（每帧 drawImage，30fps）。
 */
G.BackdropParticles = function BackdropParticles(props) {
  const canvasRef = useRef(null)
  const strengthRaw = typeof props.strength === 'number' && Number.isFinite(props.strength) ? props.strength : 1
  const strength = Math.max(0, Math.min(1, strengthRaw))
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || canvas === undefined) return undefined
    const context = canvas.getContext('2d')
    if (context === null || context === undefined) return undefined
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      reduced = false
    }
    if (reduced) return undefined

    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    let width = 0
    let height = 0
    const resize = () => {
      width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      canvas.width = width
      canvas.height = height
      sprite = makeSprite()
      for (const particle of particles) spawn(particle, true)
    }

    /* 预渲染光点 sprite（暖金色核心 + 外圈微光） */
    let sprite = null
    const makeSprite = () => {
      const size = 64
      const off = document.createElement('canvas')
      off.width = size
      off.height = size
      const ctx = off.getContext('2d')
      if (ctx === null) return null
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      gradient.addColorStop(0, 'rgba(255,241,214,1)')
      gradient.addColorStop(0.25, 'rgba(240,196,120,0.85)')
      gradient.addColorStop(0.55, 'rgba(210,150,80,0.35)')
      gradient.addColorStop(1, 'rgba(150,90,50,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
      return off
    }

    const TAU = Math.PI * 2
    /* 与皮肤原版一致的群体参数：数量随「背景浓度」放大，尺寸 2~5.2 CSS px，寿命 3~7s */
    const activeCount = Math.round(300 + strength * 720)
    const anchorX = 0.58
    const anchorY = 0.92
    const targetX = 0.5
    const targetY = 0.4
    const particles = Array.from({ length: activeCount }, () => ({ x: 0, y: 0, vx: 0, vy: 0, size: 0, life: 0, maxLife: 1, phase: 0 }))
    const clamp01 = (value) => Math.max(0, Math.min(1, value))
    const spawn = (particle, randomLife) => {
      const spread = width * 0.05
      particle.x = anchorX * width + (Math.random() - 0.5) * spread * 2
      particle.y = anchorY * height + (Math.random() - 0.5) * spread * 1.4
      particle.vx = (Math.random() - 0.5) * 90 * dpr
      particle.vy = (-30 - Math.random() * 110) * dpr
      particle.maxLife = 3 + Math.random() * 4
      particle.life = randomLife ? Math.random() * particle.maxLife : 0
      particle.size = (2 + Math.random() * 3.2) * dpr
      particle.phase = Math.random() * TAU
    }
    for (const particle of particles) spawn(particle, true)

    const pointer = { x: -1e4, y: -1e4, down: false }
    let last = 0
    let raf = 0
    const tick = (now) => {
      raf = window.requestAnimationFrame(tick)
      if (now - last < 33) return
      const dt = Math.min(0.048, (last === 0 ? 0.016 : (now - last) / 1000))
      last = now
      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      const levelFactor = 0.45 + 0.55 * strength
      for (const particle of particles) {
        particle.life += dt
        if (particle.life > particle.maxLife) spawn(particle, false)
        const curl = Math.sin(particle.y * 0.0016 + now * 0.00025 + particle.phase)
        particle.vx += curl * width * 0.02 * dt + (Math.random() - 0.5) * width * 0.05 * dt
        particle.vy -= height * 0.008 * dt
        particle.vy += (Math.random() - 0.5) * height * 0.03 * dt
        const dxp = pointer.x - particle.x
        const dyp = pointer.y - particle.y
        const distance = Math.hypot(dxp, dyp)
        if (pointer.x > -1e3 && distance < width * 0.34 && distance > 0.001) {
          const falloff = 1 - distance / (width * 0.34)
          const sign = pointer.down === true ? -1 : 1
          particle.vx -= (dxp / distance) * falloff * 900 * dt * sign
          particle.vy -= (dyp / distance) * falloff * 900 * dt * sign
        }
        const toX = targetX * width - particle.x
        const toY = targetY * height - particle.y
        const toDistance = Math.hypot(toX, toY) || 1
        const pull = 60 * dt * levelFactor * dpr
        particle.vx += (toX / toDistance) * pull
        particle.vy += (toY / toDistance) * pull
        const damping = Math.max(0, 1 - 0.8 * dt)
        particle.vx *= damping
        particle.vy *= damping
        particle.x += particle.vx * dt
        particle.y += particle.vy * dt
        if (particle.y < -height * 0.15 || particle.x < -width * 0.1 || particle.x > width * 1.1) spawn(particle, false)
        const lifeRatio = particle.life / particle.maxLife
        const fade = Math.min(1, lifeRatio / 0.18) * Math.pow(Math.sin(Math.PI * clamp01(lifeRatio)), 0.7)
        const twinkle = 0.55 + 0.45 * Math.sin(particle.phase + now * 0.0016)
        const alpha = Math.max(0, Math.min(1, (0.3 + 0.42 * levelFactor) * twinkle * fade))
        if (alpha <= 0.01 || sprite === null) continue
        const size = particle.size * (0.8 + 0.4 * levelFactor)
        context.globalAlpha = alpha * 0.9
        context.drawImage(sprite, particle.x - size * 1.6, particle.y - size * 1.6, size * 3.2, size * 3.2)
      }
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
    }
    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = (event.clientX - rect.left) * dpr
      pointer.y = (event.clientY - rect.top) * dpr
    }
    const onPointerLeave = () => {
      pointer.x = -1e4
      pointer.y = -1e4
    }
    const onPointerDown = () => { pointer.down = true }
    const onPointerUp = () => { pointer.down = false }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('resize', resize)
    resize()
    raf = window.requestAnimationFrame(tick)
    try {
      void G.api('dev.log', { message: `particles-start count=${activeCount} size=2-5.2css dpr=${dpr} canvas=${width}x${height}` }).catch(() => {})
    } catch {
      /* ignore */
    }
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('resize', resize)
    }
  }, [strength])
  return h('canvas', { ref: canvasRef, className: 'gufa-backdrop-particles', 'aria-hidden': 'true', style: { mixBlendMode: 'screen' } })
}

/** 背景浓度滑杆（无级、连续；双击恢复「跟随皮肤」）。 */
G.BackdropStrengthSlider = function BackdropStrengthSlider(props) {
  const t = G.useT()
  const raw = typeof props.value === 'number' && Number.isFinite(props.value) ? props.value : 100
  const value = Math.max(0, Math.min(100, Math.round(raw)))
  return h(
    'label',
    { className: 'gufa-strength', title: `${t('app.backdropStrength')} — ${t('app.backdropStrengthHint')}` },
    h(G.Icon, { name: 'image', size: 12 }),
    h('input', {
      className: 'gufa-strength-range',
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      value,
      'aria-label': t('app.backdropStrength'),
      onChange: (event) => props.onChange?.(Number(event.target.value)),
      onDoubleClick: () => props.onReset?.(),
    }),
    h('span', { className: 'gufa-strength-value' }, `${value}%`),
  )
}

/** 纯函数暴露（测试/控制台排查）。 */
G.__backdrop = { read: G.readSkinBackdropMeta }


/* ─────────────────────── 58-insert-ref.js ─────────────────────── */
/**
 * 58-insert-ref：把系统剪贴板里的文件粘贴进对话输入框时，插入 `@相对路径` 引用。
 *
 * 浏览器/Electron 的剪贴板只给 File 内容、不给磁盘路径，所以流程是：
 * File → 名称/size/sha256 → Host(fs.matchFiles) 在项目内匹配同名同内容文件 → 插入 @引用。
 * 图片保持 DSH 默认的附件行为（不拦截）。
 */

/** 轻量提示条（复用 drag-ref 的观感）。 */
G.refToast = function refToast(text, kind) {
  try {
    let host = document.getElementById('gufa-ref-toast')
    if (host === null) {
      host = document.createElement('div')
      host.id = 'gufa-ref-toast'
      host.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483000;max-width:70vw;padding:7px 14px;border-radius:999px;font:12px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px rgba(16,24,40,.18);pointer-events:none;white-space:pre-wrap'
      document.body.appendChild(host)
    }
    host.textContent = String(text)
    host.style.background = kind === 'err' ? 'rgba(180,35,24,.92)' : kind === 'ok' ? 'rgba(6,118,71,.92)' : 'rgba(28,30,38,.92)'
    host.style.color = '#fff'
    clearTimeout(G.refToast.timer)
    G.refToast.timer = window.setTimeout(() => {
      if (host.parentNode !== null) host.parentNode.removeChild(host)
    }, 3200)
  } catch {
    /* ignore */
  }
}

/** 把相对路径变成 @ 引用文本（含空格的路径加引号）。 */
G.mentionOfPath = function mentionOfPath(path) {
  const rel = String(path ?? '').replace(/\\/g, '/')
  if (rel === '') return ''
  return /\s/u.test(rel) ? `@"${rel}"` : `@${rel}`
}

/** 取文件 sha256（hex）。 */
G.sha256OfFile = async function sha256OfFile(file) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 把文本插入当前对话输入框：优先官方 input 服务，失败退回 contenteditable 插入。 */
G.insertIntoComposer = function insertIntoComposer(text) {
  if (typeof text !== 'string' || text === '') return false
  try {
    const sessionEl = document.querySelector('[data-conversation-session]')
    const sessionId = sessionEl === null ? '' : String(sessionEl.getAttribute('data-conversation-session') ?? '')
    const sessions = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('sessions')
    const conversation = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('conversation')
    if (sessionId !== '' && sessions !== undefined && conversation !== undefined && typeof sessions.scope === 'function') {
      const actx = sessions.scope(sessionId)
      if (actx !== undefined) {
        const input = conversation.input.for(actx)
        const snapshot = input?.state?.getSnapshot?.()
        if (snapshot !== undefined && input !== null && input !== undefined) {
          const offset = String(snapshot.draft ?? '').length
          const span = { start: offset, end: offset, draftRev: snapshot.draftRev }
          if (typeof input.insertText === 'function' && input.insertText(text, span) === true) return true
          if (typeof input.insertReference === 'function') {
            const mention = G.mentionOfPath(text.replace(/^@/, ''))
            if (mention !== '' && input.insertReference({ source: 'reference', ref: mention, label: text.replace(/^@/, ''), appearance: 'file', clipboardText: mention }, span) === true) return true
          }
        }
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const editor = document.querySelector('[data-conversation-region="composer"] [contenteditable="true"]') || document.querySelector('[data-conversation-region="composer"]')
    if (editor === null) return false
    editor.focus()
    if (document.execCommand('insertText', false, text)) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * 安装「粘贴文件 → @引用」监听。
 * @param {object} ctx client 根 context
 * @returns {() => void} 卸载器
 */
G.installChatFilePaste = function installChatFilePaste(ctx) {
  if (typeof document === 'undefined') return () => {}
  let disposed = false

  const handleFiles = async (files) => {
    const list = Array.from(files)
    if (list.length === 0) return
    const root = typeof G.projectRoot === 'string' ? G.projectRoot : ''
    if (root === '') {
      G.refToast('还没有打开项目，无法把文件转成 @ 引用', 'err')
      return
    }
    const payloads = []
    for (const file of list) {
      try {
        payloads.push({ name: file.name !== '' ? file.name : 'file', size: file.size, sha256: await G.sha256OfFile(file) })
      } catch {
        /* 读取失败的文件跳过 */
      }
    }
    if (payloads.length === 0) {
      G.refToast('粘贴的文件读取失败', 'err')
      return
    }
    let matches = []
    try {
      const result = await G.api('fs.matchFiles', { root, files: payloads })
      matches = Array.isArray(result?.matches) ? result.matches : []
    } catch (error) {
      G.refToast(`匹配项目文件失败：${G.errorText(error)}`, 'err')
      return
    }
    if (disposed) return
    const refs = []
    const missing = []
    for (const match of matches) {
      if (typeof match?.path === 'string' && match.path !== '') refs.push(G.mentionOfPath(match.path))
      else missing.push(String(match?.name ?? ''))
    }
    if (refs.length > 0) {
      const inserted = G.insertIntoComposer(refs.join(' ') + ' ')
      if (inserted) G.refToast(`已插入 ${refs.length} 个文件引用`, 'ok')
      else G.refToast('插入引用失败：输入框不可用', 'err')
    }
    if (missing.length > 0) {
      G.refToast(`${missing.join('、')} 不在当前项目里，未插入引用（可先粘贴到资源管理器导入项目）`, 'err')
    }
  }

  const onPaste = (event) => {
    const files = event.clipboardData === null || event.clipboardData === undefined ? undefined : event.clipboardData.files
    if (files === undefined || files === null || files.length === 0) return
    const target = event.target
    const inConversation = target instanceof Element && (target.closest('[data-conversation-region="composer"]') !== null || target.closest('[data-conversation-content]') !== null)
    if (!inConversation) return
    const list = Array.from(files)
    /* 图片保留 DSH 默认的附件粘贴行为 */
    if (list.every((file) => typeof file.type === 'string' && file.type.startsWith('image/'))) return
    event.preventDefault()
    event.stopPropagation()
    void handleFiles(list)
  }

  document.addEventListener('paste', onPaste, true)
  return () => {
    disposed = true
    document.removeEventListener('paste', onPaste, true)
  }
}


/* ─────────────────────── 60-dock.js ─────────────────────── */
/**
 * 60-dock：把官方 DSH 会话面板「停靠」进古法编程右侧的 AI 栏。
 *
 * 背景：右侧 AI 必须是真正的 DSH 会话本体（带工具调用 / 自动改文件 / 审批 / 差异审查），
 * 而不是插件自造的轻量对话。官方会话渲染在 AppFrame 的 main 槽里，古法编程以
 * `shell.overlay` 覆盖全屏后它仍挂载在页面中（只是被盖住）。本模块找到它的 DOM 根
 * （ConversationRoot，`[data-phase]` + 内部 `[data-conversation-scroll]`），用
 * `position:fixed` 把它浮到右侧停靠区，并随停靠区尺寸/会话切换持续校准；退出时还原。
 *
 * 要点：
 * - 不改动官方组件树、不 reparent（避免 React 卸载/重排风险），只改根节点 inline style；
 * - 会话切换 / 重渲染替换 DOM 根时自动重新停靠（MutationObserver + 250ms 轮询兜底）；
 * - 停靠区的坐标来自真实占位元素 getBoundingClientRect，支持窗口缩放与左右拖拽；
 * - 找不到会话（例如没有选中会话）时降级为内置轻量对话，并给出明确提示与恢复入口。
 */

/** 官方会话滚动容器（ConversationRoot 独有）。 */
const GUFA_CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]'

/** 找到官方会话的 DOM 根（ConversationRoot）。 */
function gufaFindConversationRoot() {
  if (typeof document === 'undefined') return null
  const scroller = document.querySelector(GUFA_CONVERSATION_SCROLL_SELECTOR)
  if (scroller !== null && scroller !== undefined && typeof scroller.closest === 'function') {
    const root = scroller.closest('[data-phase]')
    if (root !== null && root !== undefined && typeof root.getAttribute === 'function') return root
  }
  // 回退启发：带 data-phase 且内部有 conversation.* 插槽的节点
  const candidates = typeof document.querySelectorAll === 'function' ? Array.from(document.querySelectorAll('[data-phase]')) : []
  for (const node of candidates) {
    if (node === null || node === undefined || typeof node.querySelector !== 'function') continue
    if (node.querySelector('[data-slot^="conversation"]') !== null) return node
  }
  return null
}

/** 记录根节点原始 inline 状态，便于退出时逐字节还原。 */
function gufaSnapshotDockTarget(node) {
  return { style: node.getAttribute('style'), dock: node.getAttribute('data-gufa-dock') }
}

/** 还原根节点 inline 状态。 */
function gufaRestoreDockTarget(node, saved) {
  try {
    if (saved === null || saved === undefined) return
    if (saved.style === null) node.removeAttribute('style')
    else node.setAttribute('style', saved.style)
    if (saved.dock === null) node.removeAttribute('data-gufa-dock')
    else node.setAttribute('data-gufa-dock', saved.dock)
  } catch {
    /* 节点可能已被 React 移除，忽略 */
  }
}

/**
 * 把会话根浮到停靠区的位置与尺寸；返回是否成功。
 *
 * 窄栏适配：主视图会话的内容宽度默认 `clamp(680px, 列宽*0.64, 920px)`，直接在 360px 栏里
 * 会横向溢出，因此覆盖 `--dsh-chat-user-width` / `--dsh-conversation-column-width`，
 * 让消息与 composer 按栏宽排版。
 *
 * 若祖先存在 transform/contain 导致 position:fixed 相对于祖先而非视口，
 * 用「测实际位置 → 补偿差值」迭代 2 次把会话对齐到停靠区。
 */
function gufaPlaceDockedConversation(root, host, options) {
  const rect = host.getBoundingClientRect()
  if (!(rect.width >= 80 && rect.height >= 80)) return false
  const target = { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
  root.style.position = 'fixed'
  root.style.left = `${target.left}px`
  root.style.top = `${target.top}px`
  root.style.width = `${target.width}px`
  root.style.height = `${target.height}px`
  root.style.margin = '0'
  root.style.maxWidth = 'none'
  root.style.zIndex = '2147483040'
  let dockBackground = ''
  try {
    const hostStyle = window.getComputedStyle(host)
    // 背景模式下停靠区容器是透明的，实色底色从覆盖层变量里取（--gufa-solid-bg）。
    const solid = G.parseCssColor((hostStyle.getPropertyValue('--gufa-solid-bg') || '').trim())
    const candidate = solid !== null && solid[3] >= 0.999 ? solid : G.parseCssColor(hostStyle.backgroundColor)
    if (candidate !== null && candidate[3] >= 0.999) dockBackground = `rgb(${candidate[0]}, ${candidate[1]}, ${candidate[2]})`
  } catch {
    /* ignore */
  }
  const backdropMode = options !== null && options !== undefined && options.translucent === true
  if (backdropMode && dockBackground !== '') root.style.background = `color-mix(in srgb, ${dockBackground} 34%, transparent)`
  else root.style.background = dockBackground === '' ? 'var(--gufa-solid-bg, #1a1b1f)' : dockBackground
  root.style.borderLeft = '1px solid var(--dsw-alias-border-l1)'
  root.style.boxSizing = 'border-box'
  root.style.setProperty('--dsh-chat-user-width', 'calc(100% - 24px)')
  root.style.setProperty('--dsh-conversation-column-width', `${target.width}px`)
  root.setAttribute('data-gufa-dock', '1')
  // 容器变换修正（最多 2 次）
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = root.getBoundingClientRect()
    const dx = Math.round(target.left - actual.left)
    const dy = Math.round(target.top - actual.top)
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) break
    root.style.left = `${Math.round(parseFloat(root.style.left || '0') + dx)}px`
    root.style.top = `${Math.round(parseFloat(root.style.top || '0') + dy)}px`
  }
  return true
}

/** 毫秒时间戳 → 简短相对时间（会话下拉用）。 */
function gufaRelativeTime(timestamp) {
  const delta = Date.now() - timestamp
  if (!Number.isFinite(delta) || delta < 0) return ''
  const minute = 60_000
  if (delta < minute) return '刚刚'
  if (delta < 60 * minute) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < 24 * 60 * minute) return `${Math.floor(delta / (60 * minute))} 小时前`
  if (delta < 30 * 24 * 60 * minute) return `${Math.floor(delta / (24 * 60 * minute))} 天前`
  return ''
}

G.relativeTime = gufaRelativeTime

/**
 * 全局弹层（MenuSurface）配色修正。
 *
 * 官方弹层背景来自 `--dsw-menu-surface-fill`（浅色 #f8f9fa94 + blur(40px) saturate(150%)），
 * 滑动变祖皮肤并**不覆盖**这两个 token；当皮肤处于暗色调、而 DSH 基础主题标记仍是浅色时，
 * 弹层会出现「浅色半透明底 + 皮肤浅色文字」→ 完全看不清。
 *
 * IDE 模式下把这两个 token 覆盖成我们合成的实色（跟随滑动变祖当前配色），退出 IDE 时还原。
 * 只覆盖这一个表面 token + 关闭 blur，避免影响其他布局。
 */
const GUFA_POPUP_TOKENS = [
  '--dsw-menu-surface-fill',
  '--dsw-menu-backdrop-filter',
  '--dsw-specific-menu',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-module-platform',
]
let gufaPopupSaved = null
let gufaBodyDarkSaved = null
let gufaPopupProbe = null

/** 各元素上被覆盖 token 的原始值（html 与 body 各存一份，皮肤在 body 上用了 !important）。 */
function gufaPopupTargets() {
  const targets = []
  if (typeof document !== 'undefined' && document.documentElement !== undefined) targets.push(document.documentElement)
  if (typeof document !== 'undefined' && document.body !== null && document.body !== undefined) targets.push(document.body)
  return targets
}

/** rgb(...) → #rrggbb（诊断探针 id 用）。 */
function gufaRgbToHex(value) {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(value ?? ''))
  if (match === null) return 'unknown'
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
}

function gufaRegisterPopupProbe(color) {
  try {
    if (typeof G.ctx?.inject !== 'function') return
    if (typeof gufaPopupProbe === 'function') {
      try {
        gufaPopupProbe()
      } catch {
        /* ignore */
      }
      gufaPopupProbe = null
    }
    G.ctx.inject(['slots'], (scope) => {
      try {
        gufaPopupProbe = scope.slots.register({ name: 'shell.overlay', id: `gufa-code-popup-theme-${gufaRgbToHex(color)}`, order: 995 }, () => null)
      } catch {
        /* ignore */
      }
    })
  } catch {
    /* ignore */
  }
}

G.applyPopupTheme = function applyPopupTheme(palette) {
  try {
    const targets = gufaPopupTargets()
    if (targets.length === 0) return
    if (gufaPopupSaved === null) gufaPopupSaved = new Map()
    const values = {
      '--dsw-menu-surface-fill': palette.overlay,
      '--dsw-menu-backdrop-filter': 'none',
      '--dsw-specific-menu': palette.overlay,
      '--dsw-alias-bg-overlay': palette.overlay,
      '--dsw-alias-bg-module-platform': palette.layer2,
    }
    for (const element of targets) {
      if (!gufaPopupSaved.has(element)) gufaPopupSaved.set(element, new Map())
      const saved = gufaPopupSaved.get(element)
      for (const name of GUFA_POPUP_TOKENS) {
        if (!saved.has(name)) saved.set(name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) })
      }
      for (const [name, value] of Object.entries(values)) element.style.setProperty(name, value, 'important')
    }
    document.documentElement.setAttribute('data-gufa-ide', '')
    /* 深色皮肤下 DSH 自带组件（交付卡片等）依赖 body[data-ds-dark-theme] 切深色主题 */
    try {
      if (palette.isDark === true) {
        if (gufaBodyDarkSaved === null) {
          gufaBodyDarkSaved = { had: document.body.hasAttribute('data-ds-dark-theme'), value: document.body.getAttribute('data-ds-dark-theme') }
        }
        if (!document.body.hasAttribute('data-ds-dark-theme')) document.body.setAttribute('data-ds-dark-theme', '')
      }
    } catch {
      /* ignore */
    }
    gufaRegisterPopupProbe(palette.overlay)
  } catch (error) {
    console.error('[gufa-code] 修正弹层配色失败', error)
  }
}

G.restorePopupTheme = function restorePopupTheme() {
  try {
    if (typeof document === 'undefined' || document.documentElement === undefined) return
    document.documentElement.removeAttribute('data-gufa-ide')
    try {
      if (gufaBodyDarkSaved !== null) {
        if (gufaBodyDarkSaved.had) document.body.setAttribute('data-ds-dark-theme', gufaBodyDarkSaved.value ?? '')
        else document.body.removeAttribute('data-ds-dark-theme')
        gufaBodyDarkSaved = null
      }
    } catch {
      gufaBodyDarkSaved = null
    }
    if (gufaPopupSaved === null) return
    for (const [element, saved] of gufaPopupSaved) {
      for (const [name, original] of saved) {
        if (original.value === '') element.style.removeProperty(name)
        else element.style.setProperty(name, original.value, original.priority)
      }
    }
    gufaPopupSaved = null
    if (typeof gufaPopupProbe === 'function') {
      try {
        gufaPopupProbe()
      } catch {
        /* ignore */
      }
    }
    gufaPopupProbe = null
  } catch (error) {
    console.error('[gufa-code] 还原弹层配色失败', error)
  }
}

/** 纯函数暴露：供自测脚本与浏览器控制台排查使用（不属于稳定 API）。 */
G.__dock = {
  findConversationRoot: gufaFindConversationRoot,
  placeDockedConversation: gufaPlaceDockedConversation,
  snapshot: gufaSnapshotDockTarget,
  restore: gufaRestoreDockTarget,
}

/**
 * 停靠栏：官方会话本体（浮动） + 顶部工具条（新建会话 / 打开完整对话 / 收起）。
 * props = { project, activeFile, selection, theme, width, onInsertCode, backdrop, active, sessionTitle, sessions, onOpenSession }
 */
G.ChatDock = function ChatDock(props) {
  const t = G.useT()
  const theme = props.theme === 'light' ? 'light' : 'dark'
  const hostRef = useRef(null)
  const dockRef = useRef({ root: null, saved: null })
  const tickRef = useRef(null)
  const startedRef = useRef(0)
  const [phase, setPhase] = useState('searching')
  const [error, setError] = useState('')
  const active = props.active !== false && props.paused !== true

  const undock = useCallback(() => {
    const current = dockRef.current
    if (current.root !== null) gufaRestoreDockTarget(current.root, current.saved)
    dockRef.current = { root: null, saved: null }
  }, [])

  const tick = useCallback(() => {
    if (!active) return
    const host = hostRef.current
    if (host === null) return
    const root = gufaFindConversationRoot()
    if (root === null) {
      if (dockRef.current.root !== null) undock()
      setPhase((previous) => {
        if (previous === 'docked') return 'searching'
        if (startedRef.current !== 0 && Date.now() - startedRef.current > 5000) return 'missing'
        return previous
      })
      return
    }
    if (dockRef.current.root !== root) {
      undock()
      dockRef.current = { root, saved: gufaSnapshotDockTarget(root) }
    }
    if (gufaPlaceDockedConversation(root, host, { translucent: props.backdrop === true })) {
      setPhase((previous) => (previous === 'docked' ? previous : 'docked'))
    }
  }, [active, undock, props.backdrop])

  useEffect(() => {
    tickRef.current = tick
  }, [tick])

  // 生命周期：进入时轮询 + MutationObserver；退出时还原官方会话节点
  useEffect(() => {
    if (!active) {
      undock()
      return undefined
    }
    startedRef.current = Date.now()
    setPhase((previous) => (previous === 'docked' ? previous : 'searching'))
    let disposed = false
    const run = () => {
      if (!disposed) tickRef.current?.()
    }
    run()
    const timer = window.setInterval(run, 250)
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(run) : null
    if (observer !== null) observer.observe(document.body, { childList: true, subtree: true })
    let resizeObserver = null
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(run)
      const host = hostRef.current
      if (host !== null) resizeObserver.observe(host)
    }
    const onWindowResize = () => run()
    window.addEventListener('resize', onWindowResize)
    return () => {
      disposed = true
      window.clearInterval(timer)
      observer?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', onWindowResize)
      undock()
    }
  }, [active, undock])

  // 拖拽分割条改变宽度时立即重定位（轮询之外）
  useEffect(() => {
    tickRef.current?.()
  }, [props.width, props.backdrop])

  const newSession = useCallback(() => {
    const ui = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
    if (ui === undefined || ui === null || typeof ui.startSession !== 'function') {
      setError('当前界面不支持新建会话')
      return
    }
    try {
      ui.startSession()
      setError('')
      startedRef.current = Date.now()
      setPhase('searching')
    } catch (failure) {
      setError(G.errorText(failure))
    }
  }, [])

  const retry = useCallback(() => {
    startedRef.current = Date.now()
    setError('')
    setPhase('searching')
    tickRef.current?.()
  }, [])

  const missing = phase === 'missing'

  return h(
    'div',
    { className: 'gufa-chatdock' },
    h(
      'div',
      { className: 'gufa-dock-toolbar' },
      h(G.Icon, { name: 'sparkles', size: 14 }),
      h('span', { className: 'gufa-dock-title' }, t('dock.title')),
      h('span', { className: 'gufa-dock-sub' }, phase === 'docked' && typeof props.sessionTitle === 'string' && props.sessionTitle !== '' ? props.sessionTitle : t('dock.sub')),
      phase === 'docked' ? h('span', { className: 'gufa-dock-live', title: t('dock.live') }) : null,
      h('div', { className: 'gufa-dock-fill' }),
      h(G.IconButton, { title: t('dock.sessions'), onClick: () => props.onOpenSessions?.() }, h(G.Icon, { name: 'history', size: 14 })),
      h(G.IconButton, { title: t('dock.newSession'), onClick: newSession }, h(G.Icon, { name: 'plus', size: 14 })),
    ),
    h(
      'div',
      { className: 'gufa-dock-host', ref: hostRef },
      error !== '' ? h('div', { className: 'gufa-error-banner', style: { margin: '6px 8px' } }, h(G.Icon, { name: 'warn', size: 12 }), h('span', { style: { flex: '1 1 auto' } }, error), h(G.IconButton, { title: t('common.close'), onClick: () => setError('') }, h(G.Icon, { name: 'close', size: 11 }))) : null,
      missing
        ? h(
            'div',
            { className: 'gufa-dock-notice' },
            h(G.Icon, { name: 'warn', size: 12 }),
            h('span', { style: { flex: '1 1 auto' } }, t('dock.missingNotice')),
            h(G.IconButton, { title: t('dock.retry'), onClick: retry }, h(G.Icon, { name: 'refresh', size: 12 })),
          )
        : null,
      missing
        ? h(
            'div',
            { className: 'gufa-dock-fallback' },
            h(G.ChatPanel, {
              project: props.project ?? null,
              activeFile: props.activeFile ?? null,
              selection: props.selection ?? null,
              theme,
              width: props.width,
              onInsertCode: props.onInsertCode,
            }),
          )
        : phase === 'searching'
          ? h(
              'div',
              { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--gufa-text-dim)', fontSize: 12, textAlign: 'center', padding: 18 } },
              h(G.Spinner),
              h('div', null, t('dock.missingHint')),
              h(G.Button, { primary: true, icon: 'plus', onClick: newSession }, t('dock.newSession')),
            )
          : null,
    ),
  )
}

/**
 * 把 DSH 侧栏底部整块 footer（含「今日消费」卡片 + 账号行 + 设置按钮 + 版本行）
 * 停靠到古法编程左下角。
 *
 * 做法与官方会话停靠一致：不搬 DOM、不改插件 React 树，只给
 * `[data-pane="sidebar"] / [class*="sidebarCol"]` 里的 `[class*="footArea"]`
 * 加 position:fixed + 高于覆盖层的层级；位置取我们左侧面板的矩形，
 * 并用实色背景补齐（footer 本身是透明的），退出 IDE 时逐字节还原。
 * 找不到 footArea 时退化为只停靠用量卡片（[data-dsh-usage-foot-card]）。
 */
G.UsageDock = function UsageDock(props) {
  const active = props.active !== false
  useEffect(() => {
    if (!active) return undefined
    let disposed = false
    const state = { el: null, saved: null }

    /** 优先整块 sidebar footArea；退化到用量卡片。 */
    const findTarget = () => {
      const pane = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
      if (pane !== null && pane !== undefined) {
        const foot = pane.querySelector('[class*="footArea"]')
        if (foot !== null && foot !== undefined) return foot
      }
      return document.querySelector('[data-dsh-usage-foot-card]')
    }

    /** 取覆盖层实色底（左面板配色），让 footer 不透明、盖住底下列表。 */
    const solidBackground = () => {
      const overlayRoot = document.querySelector('.gufa-overlay-root')
      if (overlayRoot !== null && overlayRoot !== undefined) {
        const inline = overlayRoot.style.getPropertyValue('--gufa-solid-bg').trim()
        if (/^(#|rgb|hsl|color)/i.test(inline)) return inline
      }
      try {
        const bodyColor = window.getComputedStyle(document.body).backgroundColor
        if (bodyColor !== '' && bodyColor !== 'rgba(0, 0, 0, 0)' && bodyColor !== 'transparent') return bodyColor
      } catch {
        /* ignore */
      }
      return ''
    }

    const restore = () => {
      document.documentElement.removeAttribute('data-gufa-usage')
      document.documentElement.style.removeProperty('--gufa-usage-height')
      const el = state.el
      const saved = state.saved
      state.el = null
      state.saved = null
      if (el === null || saved === null) return
      try {
        if (saved.style === null) el.removeAttribute('style')
        else el.setAttribute('style', saved.style)
        el.removeAttribute('data-gufa-foot-dock')
      } catch {
        /* 元素可能已被插件移除 */
      }
    }

    const apply = () => {
      if (disposed) return
      const el = findTarget()
      if (el === null || el === undefined) {
        if (state.el !== null) restore()
        return
      }
      if (state.el !== el) {
        restore()
        state.el = el
        state.saved = { style: el.getAttribute('style') }
      }
      const sidepanel = document.querySelector('.gufa-sidepanel')
      const statusbar = document.querySelector('.gufa-statusbar')
      if (sidepanel === null || sidepanel === undefined) return
      const sideRect = sidepanel.getBoundingClientRect()
      if (!(sideRect.width >= 80)) return
      const statusHeight = statusbar === null || statusbar === undefined ? 24 : statusbar.getBoundingClientRect().height
      const background = solidBackground()
      try {
        el.style.setProperty('position', 'fixed', 'important')
        el.style.setProperty('left', `${Math.round(sideRect.left)}px`, 'important')
        el.style.setProperty('width', `${Math.round(sideRect.width)}px`, 'important')
        el.style.setProperty('bottom', `${Math.round(statusHeight)}px`, 'important')
        el.style.setProperty('z-index', '2147483050', 'important')
        el.style.setProperty('margin', '0', 'important')
        el.style.setProperty('pointer-events', 'auto', 'important')
        el.style.setProperty('box-sizing', 'border-box', 'important')
        if (background !== '') el.style.setProperty('background', background, 'important')
        el.setAttribute('data-gufa-foot-dock', '1')
        document.documentElement.setAttribute('data-gufa-usage', '')
        const height = Math.round(el.getBoundingClientRect().height)
        document.documentElement.style.setProperty('--gufa-usage-height', `${height > 0 ? height + 6 : 0}px`)
      } catch (error) {
        console.error('[gufa-code] 停靠侧栏底部失败', error)
      }
    }

    apply()
    const timer = window.setInterval(apply, 500)
    const onResize = () => apply()
    window.addEventListener('resize', onResize)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('resize', onResize)
      restore()
    }
  }, [active])
  return null
}

/**
 * 覆盖层宿主：模式打开时渲染完整 IDE（GufaApp）；关闭时不渲染任何东西，
 * 停靠栏的清理 effect 会把官方会话节点还原。
 *
 * 皮肤（如 liang-intensity-skin）会把 `--dsw-alias-bg-*` 改成半透明/透明以露出壁纸，
 * 直接使用会变成「透明覆盖层 + 下面原始界面」的双层穿帮。这里把皮肤 token 与页面底色
 * 合成成一套不透明实色，挂到覆盖层根节点上（--gufa-solid-*），子组件全部使用这套实色。
 */
G.OverlayHost = function OverlayHost(props) {
  const visible = G.useMode()
  const theme = G.useTheme()
  const rootRef = useRef(null)

  useLayoutEffect(() => {
    if (!visible) return undefined
    /* 进入 IDE：无论是否有弹层，都标记 html[data-gufa-ide]，编辑器透明/皮肤背景适配都依赖它 */
    try {
      document.documentElement.setAttribute('data-gufa-ide', '')
    } catch {
      /* ignore */
    }
    let applying = false
    const apply = () => {
      if (applying) return
      const root = rootRef.current
      if (root === null) return
      applying = true
      try {
        applyPalette(root)
      } finally {
        applying = false
      }
    }
    const applyPalette = (root) => {
      const palette = G.resolveSolidPalette(root)
      root.style.backgroundColor = palette.bg
      root.style.setProperty('--gufa-solid-bg', palette.bg)
      root.style.setProperty('--gufa-solid-layer', palette.layer)
      root.style.setProperty('--gufa-solid-layer2', palette.layer2)
      root.style.setProperty('--gufa-solid-overlay', palette.overlay)
      root.style.setProperty('--gufa-solid-sidebar', palette.sidebar)
      root.style.setProperty('--gufa-solid-text', palette.text)
      root.style.setProperty('--gufa-solid-text-dim', palette.textDim)
      if (typeof G.applyPopupTheme === 'function') G.applyPopupTheme(palette)
      try {
        if (window.__gufaApplyLogs === undefined) window.__gufaApplyLogs = 10
        if (window.__gufaApplyLogs > 0) {
          window.__gufaApplyLogs -= 1
          void G.api('dev.log', { message: `overlay-palette-apply bg=${String(palette.bg)} isDark=${palette.isDark === true} store=${G.paletteStore !== null && G.paletteStore !== undefined}` }).catch(() => {})
        }
      } catch {
        /* ignore */
      }
      if (G.paletteStore !== null && G.paletteStore !== undefined) G.paletteStore.set(palette)
      /* 皮肤背景层是否真的挂进了覆盖层根：是→隐藏我们自己的复刻背景层，否→保留（避免全黑） */
      /* 一次性几何诊断：找出聊天面板/主行与窗口右边缘的差距 */
      try {
        if (window.__gufaGeomLogged !== true) {
          window.__gufaGeomLogged = true
          const rect = (sel) => {
            const node = document.querySelector(sel)
            if (node === null) return 'none'
            const r = node.getBoundingClientRect()
            return `${sel}=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`
          }
          void G.api('dev.log', {
            message: `geom inner=${innerWidth}x${innerHeight} body=${document.body.clientWidth} ${rect('.gufa-overlay-root')} ${rect('.gufa-root')} ${rect('.gufa-shell')} ${rect('.gufa-main-row')} ${rect('.gufa-chatpane')} ${rect('.gufa-chatdock')} ${rect('.gufa-editor-area')}`,
          }).catch(() => {})
        }
      } catch {
        /* ignore */
      }
      try {
        const skinRoot = document.querySelector('.gufa-overlay-root > .liang-skin-backdrop')
        if (skinRoot !== null) document.documentElement.setAttribute('data-gufa-skin-live', '1')
        else document.documentElement.removeAttribute('data-gufa-skin-live')
      } catch {
        /* ignore */
      }
    }
    apply()
    const timer = window.setInterval(apply, 800)
    let observer = null
    if (typeof MutationObserver === 'function') {
      /* 只监听语义属性；绝对不能监听 body 的 style/class ——
         滑动变祖皮肤在动画帧里持续写 body.style，会把这里变成 60Hz 回调风暴（进 IDE 即卡死）。 */
      observer = new MutationObserver(apply)
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-liang-skin', 'data-liang-stage', 'data-ds-dark-theme'] })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-platform'] })
    }
    return () => {
      window.clearInterval(timer)
      observer?.disconnect()
      try {
        document.documentElement.removeAttribute('data-gufa-ide')
        document.documentElement.removeAttribute('data-gufa-skin-live')
      } catch {
        /* ignore */
      }
      if (typeof G.restorePopupTheme === 'function') G.restorePopupTheme()
    }
  }, [visible, theme])

  if (!visible) return null
  return h('div', { className: 'gufa-overlay-root', ref: rootRef }, h(G.GufaErrorBoundary, null, h(G.GufaApp, props)))
}

/**
 * main key 安全网：若侧边栏仍然把主面板切到了 `gufa-code`（例如我们的点击拦截失效），
 * 立刻进入覆盖层并切回会话主视图，避免官方会话被卸载。
 */
G.MainRedirect = function MainRedirect() {
  useEffect(() => {
    G.enterGufa()
    const layout = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('layout')
    const timer = window.setTimeout(() => {
      try {
        layout?.selectPanel?.(null)
      } catch (error) {
        console.error('[gufa-code] 还原会话主视图失败', error)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])
  return null
}


/* ─────────────────────── 85-shortcuts.js ─────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════
 * 古法编程模式专属快捷键（参考 VS Code）。
 *
 * 只在 IDE 覆盖层挂载期间生效（GufaApp 内部调用 `G.useIdeShortcuts`），
 * 经典模式完全不受影响；命中时在 window 捕获阶段 preventDefault + 停止传播，
 * 把按键从 DSH/Monaco 的默认处理里截走。
 *
 * 主修饰键：macOS 用 ⌘，其他平台用 Ctrl。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 是否 macOS（决定主修饰键与展示文案）。 */
G.isMacPlatform = function isMacPlatform() {
  try {
    if (typeof navigator === 'undefined' || navigator === null) return false
    const platform = typeof navigator.platform === 'string' ? navigator.platform : ''
    if (platform !== '') return /Mac|iPhone|iPad|iPod/.test(platform)
    return /Mac OS X|Macintosh/.test(typeof navigator.userAgent === 'string' ? navigator.userAgent : '')
  } catch {
    return false
  }
}

/** 主修饰键是否按下。 */
function gufaShortcutModifier(event) {
  return G.isMacPlatform() ? event.metaKey === true : event.ctrlKey === true
}

/**
 * 把键盘事件映射成快捷键动作 id（未命中返回 null）。
 * @param {KeyboardEvent|{key?:string, code?:string, metaKey?:boolean, ctrlKey?:boolean, shiftKey?:boolean, altKey?:boolean}} event
 * @returns {string|null}
 */
G.shortcutAction = function shortcutAction(event) {
  if (event === null || event === undefined) return null
  if (event.altKey === true) return null
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''
  const code = typeof event.code === 'string' ? event.code : ''
  const isBackquote = code === 'Backquote' || key === '`' || key === '~'
  const mac = G.isMacPlatform()
  if (gufaShortcutModifier(event) !== true) {
    // macOS 上 ⌘` 是系统「切换窗口」，终端开关按 VS Code 惯例用 Ctrl+`。
    if (mac === true && event.ctrlKey === true && isBackquote === true) {
      return event.shiftKey === true ? 'newTerminal' : 'toggleTerminal'
    }
    return null
  }
  if (event.shiftKey === true) {
    if (key === 'e') return 'panelExplorer'
    if (key === 'g') return 'panelGit'
    if (key === 'h' || key === 'u') return 'panelSsh'
    if (key === 'b') return 'toggleSidebar'
    if (key === 'w') return 'closeTab'
    if (isBackquote) return 'newTerminal'
    if (key === '/' || key === '?') return 'shortcuts'
    if (key === 'enter' || code === 'Enter' || code === 'NumpadEnter') return 'commit'
    return null
  }
  if (key === 's') return 'save'
  if (key === 'k') return 'clearTerminal'
  if (key === 'j' || isBackquote) return 'toggleTerminal'
  if (key === 'b') return 'toggleSidebar'
  if (key === 'w') return 'closeTab'
  if (key === 'e' || key === 'g' || key === 'u') return null
  if (key === '/') return 'shortcuts'
  if (key === '?') return 'shortcuts'
  return null
}

/* 当前 IDE 的快捷键处理表：由 GufaApp 挂载时发布、卸载时清空。 */
let gufaShortcutHandlers = null
/** 原生快捷键服务的注册结果（null 表示尚未注册）。 */
G.shortcutServiceActive = null
let gufaShortcutBridgeInstalled = false

/** 在插件启动时安装一次全局捕获监听（早于任何 React 组件，稳定可复用）。 */
G.installShortcutBridge = function installShortcutBridge() {
  if (typeof window === 'undefined' || window === null || typeof window.addEventListener !== 'function') return
  // 插件热重载会重新执行本模块：先移除上一代留下的监听器，避免多个桥重复拦截同一按键
  try {
    if (typeof window.__gufaShortcutBridgeDispose === 'function') window.__gufaShortcutBridgeDispose()
  } catch {
    /* ignore */
  }
  window.__gufaShortcutBridgeDispose = null
  gufaShortcutBridgeInstalled = true
  try {
    window.__gufaShortcutBridge = true
  } catch {
    /* ignore */
  }
  const onKeyDown = (event) => {
    if (event === null || event === undefined) return
    try {
      if (gufaKeyDiagnosticsLeft > 0 && (event.metaKey === true || event.ctrlKey === true)) {
        gufaKeyDiagnosticsLeft -= 1
        const target = event.target
        void G.api('dev.log', {
          message: `key key=${String(event.key)} code=${String(event.code)} meta=${event.metaKey === true} ctrl=${event.ctrlKey === true} shift=${event.shiftKey === true} alt=${event.altKey === true} prevented=${event.defaultPrevented === true} target=${target === null || target === undefined ? '?' : String(target.tagName ?? '?')} platform=${typeof navigator === 'undefined' ? '?' : String(navigator.platform ?? '?')} bridge=1`,
        }).catch(() => {})
      }
    } catch {
      /* 诊断失败不影响快捷键 */
    }
    if (event.defaultPrevented === true) return
    const handlers = gufaShortcutHandlers
    if (handlers === null) return
    let action = null
    try {
      action = G.shortcutAction(event)
    } catch {
      return
    }
    if (action === null) return
    if (G.shortcutServiceActive !== null && G.shortcutServiceActive !== undefined && G.shortcutServiceActive.runtime === 'web' && G.shortcutServiceActive.actions.has(action)) return
    const handler = handlers[action]
    if (typeof handler !== 'function') return
    try {
      const modalOpen = document.querySelector('.gufa-modal-backdrop, .gufa-session-backdrop') !== null
      if (modalOpen && action !== 'shortcuts') return
    } catch {
      /* ignore */
    }
    event.preventDefault()
    event.stopPropagation()
    try {
      handler()
      if (gufaShortcutFiredLogsLeft > 0) {
        gufaShortcutFiredLogsLeft -= 1
        void G.api('dev.log', { message: `shortcut-fired ${action} key=${String(event.key)}` }).catch(() => {})
      }
    } catch (error) {
      console.error('[gufa-code] shortcut handler failed', error)
    }
  }
  window.addEventListener('keydown', onKeyDown, true)
  window.__gufaShortcutBridgeDispose = () => {
    try {
      window.removeEventListener('keydown', onKeyDown, true)
    } catch {
      /* ignore */
    }
  }
}

/** 剩余按键诊断次数（排查用，命中后清零；无按键则自然闲置）。 */
let gufaKeyDiagnosticsLeft = 80
/** 剩余「快捷键命中」日志次数。 */
let gufaShortcutFiredLogsLeft = 40

/* ── 注册到 DSH 原生快捷键服务（桌面端由 Electron main 拦截物理按键） ──────
 * 桌面端配置型快捷键由 main 进程的 before-input-event 拦截后通过 IPC 回送，
 * 页面里根本收不到 keydown（这正是之前「快捷键全不好用、⌘B 收经典侧栏」的原因）。
 * 通过 ctx.shortcuts.register 注册后：绑定进入 main 的按键索引 + DSH 快捷键设置页。 */

/** 本插件的 IDE 命令表：action ↔ 默认绑定。 */
const GUFA_SHORTCUT_COMMANDS = [
  { action: 'save', id: 'gufa.ide.save', labelKey: 'shortcuts.save', code: 'KeyS', modifiers: ['primary'], regions: ['page', 'editable', 'terminal'] },
  { action: 'clearTerminal', id: 'gufa.ide.clearTerminal', labelKey: 'shortcuts.clearTerminal', code: 'KeyK', modifiers: ['primary'], regions: ['page', 'editable', 'terminal'] },
  { action: 'toggleTerminal', id: 'gufa.ide.toggleTerminal', labelKey: 'shortcuts.toggleTerminal', code: 'KeyJ', modifiers: ['primary'], regions: ['page', 'editable', 'terminal'] },
  { action: 'toggleSidebar', id: 'gufa.ide.toggleSidebar', labelKey: 'shortcuts.toggleSidebar', code: 'KeyB', modifiers: ['primary', 'shift'], regions: ['page', 'editable'] },
  { action: 'closeTab', id: 'gufa.ide.closeTab', labelKey: 'shortcuts.closeTab', code: 'KeyW', modifiers: ['primary', 'shift'], regions: ['page', 'editable'] },
  { action: 'panelExplorer', id: 'gufa.ide.panelExplorer', labelKey: 'shortcuts.explorer', code: 'KeyE', modifiers: ['primary', 'shift'], regions: ['page', 'editable'] },
  { action: 'panelGit', id: 'gufa.ide.panelGit', labelKey: 'shortcuts.git', code: 'KeyG', modifiers: ['primary', 'shift'], regions: ['page', 'editable'] },
  { action: 'panelSsh', id: 'gufa.ide.panelSsh', labelKey: 'shortcuts.ssh', code: 'KeyU', modifiers: ['primary', 'shift'], regions: ['page', 'editable'] },
  { action: 'newTerminal', id: 'gufa.ide.newTerminal', labelKey: 'shortcuts.newTerminal', code: 'Backquote', modifiers: ['control', 'shift'], regions: ['page', 'editable', 'terminal'] },
  { action: 'shortcuts', id: 'gufa.ide.shortcuts', labelKey: 'shortcuts.help', code: 'Slash', modifiers: ['primary', 'shift'], regions: ['page', 'editable', 'terminal'] },
]

/** 桌面三平台的默认绑定（web 端不设默认，避免和浏览器冲突）。 */
function gufaDesktopDefaults(code, modifiers) {
  const binding = { code, modifiers }
  return { 'desktop:macos': binding, 'desktop:windows': binding, 'desktop:linux': binding }
}

/**
 * 把 IDE 命令注册进 DSH 原生快捷键服务。
 * @param {object} scope 已注入 shortcuts 服务的 Cordis 作用域
 * @returns {boolean} 是否注册成功
 */
/**
 * 与 DSH 原生快捷键系统集成（不修改它的定义/配置，避免影响经典模式）。
 *
 * 桌面端 Electron main 会在按键到达页面前拦截「已配置」的快捷键并回送 IPC，
 * 页面里的 keydown 收不到这些字母键。这里只做两件事：
 *   1. 撤销旧版本可能残留的 registry.dispatch 补丁；
 *   2. 在 IDE 模式下，把被经典模式/其它插件占用的命令（⌘K/⌘B/⌘S/⌘W/⌘/…）
 *      在 resolve 处改派为 IDE 动作（经典模式下原样执行）。
 * 不调用 shortcuts.register / 不写 keybindings 配置，因此不会让 main 的快捷键索引失效。
 */
G.installShortcutIntegration = function installShortcutIntegration(service) {
  try {
    const registry = service === null || service === undefined ? undefined : service.registry
    if (registry === null || registry === undefined) return false

    // 1) 撤销旧版本（如果有）对 dispatch 的补丁
    if (registry.__gufaPatched === true) {
      if (typeof registry.__gufaOriginalDispatch === 'function') registry.dispatch = registry.__gufaOriginalDispatch
      delete registry.__gufaPatched
      delete registry.__gufaHandle
      delete registry.__gufaOriginalDispatch
    }

    // 2) IDE 模式内的命令改派表（被原生占用的组合 → IDE 动作）
    const commandActions = {
      'session.search': 'clearTerminal',
      'sidebar.left.toggle': 'toggleSidebar',
      'edrv.save': 'save',
      'edrv.closeTab': 'closeTab',
      'edrv.reloadWindow': 'refresh',
      'edrv.toggleSidebar': 'toggleSidebar',
      'shortcuts.open': 'shortcuts',
      'edrv.toggleComment': 'shortcuts',
      'edrv.showCommands': 'shortcutsDialog',
      'edrv.searchInFiles': 'panelExplorer',
      'terminal.new': 'toggleTerminal',
      // 编辑器动作：edrv.* 抢占的 VS Code 键位，改派给 Monaco
      'edrv.addSelectionRef': 'editor:cursorUndo',
      'edrv.goToLine': 'editor:editor.action.gotoLine',
      'edrv.prevEditorRow': 'editor:editor.action.moveLinesUpAction',
      'edrv.nextEditorRow': 'editor:editor.action.moveLinesDownAction',
      'edrv.prevTab': 'prevTab',
      'edrv.nextTab': 'nextTab',
    }
    service.__gufaCommandActions = commandActions
    const wrapped = []
    const commands = registry.commands
    const makeResolve = (id, originalResolve) => function gufaIdeResolve(context) {
      try {
        if (G.mode.get() === true) {
          const actions = service.__gufaCommandActions
          const mapped = actions === null || actions === undefined ? undefined : actions[id]
          if (typeof mapped === 'string') {
            return {
              status: 'handled',
              run: () => {
                try {
                  if (mapped.startsWith('editor:')) {
                    if (G.bus !== null && G.bus !== undefined) G.bus.emit('editor:command', mapped.slice('editor:'.length))
                    return
                  }
                  if (typeof window.__gufaIdeShortcutDispatch === 'function') window.__gufaIdeShortcutDispatch(mapped)
                } catch (error) {
                  console.error('[gufa-code] IDE shortcut dispatch failed', error)
                }
              },
            }
          }
        }
      } catch {
        /* 改派失败则退回原命令 */
      }
      return originalResolve.call(this, context)
    }
    if (commands !== null && commands !== undefined && typeof commands.get === 'function') {
      for (const [id, action] of Object.entries(commandActions)) {
        const command = commands.get(id)
        if (command === null || command === undefined) continue
        const originalResolve = command.__gufaWrapped === true && typeof command.__gufaOriginalResolve === 'function'
          ? command.__gufaOriginalResolve
          : command.resolve
        if (typeof originalResolve !== 'function') continue
        try {
          Object.defineProperty(command, '__gufaOriginalResolve', { value: originalResolve, configurable: true })
        } catch {
          /* ignore */
        }
        command.resolve = makeResolve(id, originalResolve)
        try {
          Object.defineProperty(command, '__gufaWrapped', { value: true, configurable: true })
        } catch {
          /* ignore */
        }
        wrapped.push(id)
      }
    }
    // ── 命令表/配置尚未就绪时重试（插件加载可能早于 ui-layout 注册命令）──
    const expected = Object.keys(commandActions).length
    try {
      if (typeof window !== 'undefined' && window !== null) {
        if (wrapped.length < expected) {
          if (service.__gufaIntegrationTimer === undefined || service.__gufaIntegrationTimer === null) {
            let attempts = 0
            service.__gufaIntegrationTimer = window.setInterval(() => {
              attempts += 1
              if (attempts > 40) {
                window.clearInterval(service.__gufaIntegrationTimer)
                service.__gufaIntegrationTimer = null
                return
              }
              try {
                G.installShortcutIntegration(service)
              } catch {
                /* ignore */
              }
            }, 500)
          }
        } else {
          if (service.__gufaIntegrationTimer !== undefined && service.__gufaIntegrationTimer !== null) {
            window.clearInterval(service.__gufaIntegrationTimer)
            service.__gufaIntegrationTimer = null
          }
          if (service.__gufaIntegrationSubscribed !== true && service.config !== null && service.config !== undefined && typeof service.config.subscribe === 'function') {
            service.__gufaIntegrationSubscribed = true
            try {
              service.config.subscribe(() => {
                try {
                  if (service.__gufaIntegrationTimer === undefined || service.__gufaIntegrationTimer === null) G.installShortcutIntegration(service)
                } catch {
                  /* ignore */
                }
              })
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* 重试安装失败不影响主流程 */
    }

    // ── 一次性自检：确认改派在 IDE 模式下真的会执行（不会影响经典模式）──
    try {
      if (typeof window !== 'undefined' && window !== null && window.sessionStorage !== undefined) {
        if (window.sessionStorage.getItem('gufa-shortcut-selftest-v2') !== '1' && wrapped.length > 0) {
          window.sessionStorage.setItem('gufa-shortcut-selftest-v2', '1')
          window.setTimeout(() => {
            try {
              const command = commands !== null && commands !== undefined && typeof commands.get === 'function' ? commands.get('session.search') : undefined
              if (command === undefined || command === null) return
              const result = command.resolve({ region: 'page', modal: null, target: null })
              const status = result !== null && result !== undefined ? String(result.status) : 'null'
              const runnable = typeof result?.run === 'function'
              if (runnable) {
                try {
                  result.run()
                } catch {
                  /* ignore */
                }
              }
              void G.api('dev.log', { message: `shortcut-remap-selftest ide=${G.mode.get() === true} status=${status} runnable=${runnable}` }).catch(() => {})
            } catch (error) {
              void G.api('dev.log', { message: `shortcut-remap-selftest-error ${String(error)}` }).catch(() => {})
            }
          }, 2500)
        }
      }
    } catch {
      /* 自检失败不影响快捷键 */
    }

    // ── ⌘/ 链路自检（替换 dispatch 回调，验证路由但不弹窗）──
    try {
      if (typeof window !== 'undefined' && window !== null && window.sessionStorage !== undefined) {
        if (window.sessionStorage.getItem('gufa-shortcut-selftest-v3') !== '1' && wrapped.length > 0) {
          window.sessionStorage.setItem('gufa-shortcut-selftest-v3', '1')
          window.setTimeout(() => {
            try {
              const mac = G.isMacPlatform()
              const gesture = { code: 'Slash', meta: mac, control: mac === false, shift: false, alt: false, repeat: false }
              const saved = window.__gufaIdeShortcutDispatch
              const fired = []
              window.__gufaIdeShortcutDispatch = (action) => {
                fired.push(action)
              }
              let result
              try {
                result = service.registry.dispatch(gesture, { region: 'page', modal: null, target: null }, () => {})
              } finally {
                window.__gufaIdeShortcutDispatch = saved
              }
              void G.api('dev.log', {
                message: `shortcut-cmd-slash-selftest ide=${G.mode.get() === true} editorFocused=${typeof G.isEditorFocused === 'function' ? G.isEditorFocused() === true : '?'} fired=${JSON.stringify(fired)} result=${JSON.stringify(result).slice(0, 200)}`,
              }).catch(() => {})
            } catch (error) {
              void G.api('dev.log', { message: `shortcut-cmd-slash-selftest-error ${String(error)}` }).catch(() => {})
            }
          }, 2500)
        }
      }
    } catch {
      /* 自检失败不影响快捷键 */
    }

    try {
      let configStatus = '?'
      try {
        const snapshot = service.config !== null && service.config !== undefined && typeof service.config.getSnapshot === 'function' ? service.config.getSnapshot() : null
        configStatus = snapshot === null ? '?' : String(snapshot.status)
      } catch {
        configStatus = '?'
      }
      const totalCommands = commands !== null && commands !== undefined && typeof commands.size === 'number' ? commands.size : '?'
      let edrvBindings = []
      try {
        const bindingsMap = registry.bindings
        if (bindingsMap !== null && bindingsMap !== undefined && typeof bindingsMap.forEach === 'function') {
          bindingsMap.forEach((command, bindingKeyValue) => {
            try {
              if (command !== null && command !== undefined && typeof command.id === 'string' && command.id.startsWith('edrv.')) {
                edrvBindings.push(`${bindingKeyValue}>${command.id}`)
              }
            } catch {
              /* ignore */
            }
          })
        }
      } catch {
        edrvBindings = []
      }
      let edrvIds = []
      try {
        if (commands !== null && commands !== undefined && typeof commands.keys === 'function') edrvIds = [...commands.keys()].filter((id) => typeof id === 'string' && id.startsWith('edrv.'))
      } catch {
        edrvIds = []
      }
      void G.api('dev.log', { message: `shortcut-integration wrapped=${JSON.stringify(wrapped)} total=${totalCommands} configStatus=${configStatus} edrv=${JSON.stringify(edrvIds).slice(0, 1500)} edrvBindings=${JSON.stringify(edrvBindings).slice(0, 2500)}` }).catch(() => {})
    } catch {
      /* ignore */
    }
    return true
  } catch (error) {
    console.error('[gufa-code] install shortcut integration failed', error)
    return false
  }
}

/** 编辑器（Monaco，默认键位与 VS Code 一致）快捷键说明表。 */
G.EDITOR_SHORTCUTS = [
  { labelKey: 'editorKeys.comment', mac: '⌘/', other: 'Ctrl+/' },
  { labelKey: 'editorKeys.blockComment', mac: '⇧⌥A', other: 'Shift+Alt+A' },
  { labelKey: 'editorKeys.nextOccurrence', mac: '⌘D', other: 'Ctrl+D' },
  { labelKey: 'editorKeys.allOccurrences', mac: '⌘⇧L', other: 'Ctrl+Shift+L' },
  { labelKey: 'editorKeys.cursorAboveBelow', mac: '⌘⌥↑ / ⌘⌥↓', other: 'Ctrl+Alt+↑/↓' },
  { labelKey: 'editorKeys.undoCursor', mac: '⌘U', other: 'Ctrl+U' },
  { labelKey: 'editorKeys.moveLine', mac: '⌥↑ / ⌥↓', other: 'Alt+↑/↓' },
  { labelKey: 'editorKeys.copyLine', mac: '⇧⌥↑ / ⇧⌥↓', other: 'Shift+Alt+↑/↓' },
  { labelKey: 'editorKeys.deleteLine', mac: '⌘⇧K', other: 'Ctrl+Shift+K' },
  { labelKey: 'editorKeys.insertLine', mac: '⌘↵ / ⇧⌘↵', other: 'Ctrl+Enter / Shift+Ctrl+Enter' },
  { labelKey: 'editorKeys.indent', mac: '⌘] / ⌘[', other: 'Ctrl+] / Ctrl+[' },
  { labelKey: 'editorKeys.columnSelect', mac: '⇧⌥ + 鼠标拖拽', other: 'Shift+Alt + drag' },
  { labelKey: 'editorKeys.find', mac: '⌘F / ⌥⌘F', other: 'Ctrl+F / Ctrl+H' },
  { labelKey: 'editorKeys.goToLine', mac: '⌘G', other: 'Ctrl+G' },
  { labelKey: 'editorKeys.format', mac: '⇧⌥F', other: 'Shift+Alt+F' },
  { labelKey: 'editorKeys.rename', mac: 'F2', other: 'F2' },
]

/** 快捷键说明表（渲染用）。keys 只写字母/符号，修饰键由平台决定。 *//** 编辑器（Monaco，默认键位与 VS Code 一致）快捷键说明表。 */
G.EDITOR_SHORTCUTS = [
  { labelKey: 'editorKeys.comment', mac: '⌘/', other: 'Ctrl+/' },
  { labelKey: 'editorKeys.blockComment', mac: '⇧⌥A', other: 'Shift+Alt+A' },
  { labelKey: 'editorKeys.nextOccurrence', mac: '⌘D', other: 'Ctrl+D' },
  { labelKey: 'editorKeys.allOccurrences', mac: '⌘⇧L', other: 'Ctrl+Shift+L' },
  { labelKey: 'editorKeys.cursorAboveBelow', mac: '⌘⌥↑ / ⌘⌥↓', other: 'Ctrl+Alt+↑/↓' },
  { labelKey: 'editorKeys.undoCursor', mac: '⌘U', other: 'Ctrl+U' },
  { labelKey: 'editorKeys.moveLine', mac: '⌥↑ / ⌥↓', other: 'Alt+↑/↓' },
  { labelKey: 'editorKeys.copyLine', mac: '⇧⌥↑ / ⇧⌥↓', other: 'Shift+Alt+↑/↓' },
  { labelKey: 'editorKeys.deleteLine', mac: '⌘⇧K', other: 'Ctrl+Shift+K' },
  { labelKey: 'editorKeys.insertLine', mac: '⌘↵ / ⇧⌘↵', other: 'Ctrl+Enter / Shift+Ctrl+Enter' },
  { labelKey: 'editorKeys.indent', mac: '⌘] / ⌘[', other: 'Ctrl+] / Ctrl+[' },
  { labelKey: 'editorKeys.columnSelect', mac: '⇧⌥ + 鼠标拖拽', other: 'Shift+Alt + drag' },
  { labelKey: 'editorKeys.find', mac: '⌘F / ⌥⌘F', other: 'Ctrl+F / Ctrl+H' },
  { labelKey: 'editorKeys.goToLine', mac: '⌘G', other: 'Ctrl+G' },
  { labelKey: 'editorKeys.format', mac: '⇧⌥F', other: 'Shift+Alt+F' },
  { labelKey: 'editorKeys.rename', mac: 'F2', other: 'F2' },
]

/** 快捷键说明表（渲染用）。keys 只写字母/符号，修饰键由平台决定。 */
G.SHORTCUTS = [
  { action: 'save', labelKey: 'shortcuts.save', keys: ['S'], shift: false },
  { action: 'commit', labelKey: 'shortcuts.commit', keys: ['Enter'], shift: true, macText: '⌘⇧↵', otherText: 'Ctrl+Shift+Enter' },
  { action: 'clearTerminal', labelKey: 'shortcuts.clearTerminal', keys: ['K'], shift: false },
  { action: 'toggleTerminal', labelKey: 'shortcuts.toggleTerminal', keys: ['J'], shift: false, macText: '⌘J / ⌃`', otherText: 'Ctrl+J / Ctrl+`' },
  { action: 'toggleSidebar', labelKey: 'shortcuts.toggleSidebar', keys: ['B'], shift: false },
  { action: 'closeTab', labelKey: 'shortcuts.closeTab', keys: ['W'], shift: false },
  { action: 'panelExplorer', labelKey: 'shortcuts.explorer', keys: ['E'], shift: true },
  { action: 'panelGit', labelKey: 'shortcuts.git', keys: ['G'], shift: true },
  { action: 'panelSsh', labelKey: 'shortcuts.ssh', keys: ['U'], shift: true },
  { action: 'newTerminal', labelKey: 'shortcuts.newTerminal', keys: ['`'], shift: true, macText: '⌃⇧`', otherText: 'Ctrl+Shift+`' },
  { action: 'shortcuts', labelKey: 'shortcuts.help', keys: ['/'], shift: false },
]

/** 渲染一个组合键文案，例如 macOS: ⌘⇧E / 其他: Ctrl+Shift+E。 */
G.shortcutKeyText = function shortcutKeyText(entry) {
  if (entry === null || entry === undefined) return ''
  const mac = G.isMacPlatform()
  if (mac === true) {
    if (typeof entry.macText === 'string') return entry.macText
  } else if (typeof entry.otherText === 'string') {
    return entry.otherText
  }
  const keys = Array.isArray(entry.keys) ? entry.keys : []
  const key = keys.length === 0 ? '' : keys[0]
  const shown = key === '`' ? '`' : key.toUpperCase()
  if (mac === true) return `⌘${entry.shift === true ? '⇧' : ''}${shown}`
  return `Ctrl+${entry.shift === true ? 'Shift+' : ''}${shown}`
}

/**
 * 安装 IDE 快捷键层：handlers[action] 为对应动作。
 * @param {Record<string, () => void>} handlers
 */
G.useIdeShortcuts = function useIdeShortcuts(handlers) {
  useEffect(() => {
    gufaShortcutHandlers = handlers
    try {
      window.__gufaShortcutHandlers = true
    } catch {
      /* ignore */
    }
    if (typeof G.installShortcutBridge === 'function') G.installShortcutBridge()
    return () => {
      if (gufaShortcutHandlers === handlers) gufaShortcutHandlers = null
    }
  }, [handlers])
}


/* ─────────────────────── 90-app.js ─────────────────────── */
/**
 * 90-app：古法编程主界面 —— 标题栏 + 活动栏 + 左侧面板 + 编辑器区 + 终端 + 右侧 AI + 状态栏。
 * 这是 main slot（key = gufa-code）渲染的根组件。
 */

const GUFA_LS = {
  project: 'gufa-code:project',
  ui: 'gufa-code:ui:v1',
  tabs: 'gufa-code:tabs:v1',
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式：忽略持久化失败 */
  }
}

/** 最近会话列表（JSON 字符串，避免 selector 每次返回新数组导致频繁重渲染）。 */
function selectRecentSessionsJson(state) {
  const sessions = state === null || state === undefined ? [] : Object.values(state.byId ?? {})
  const rows = sessions
    .filter((session) => session !== null && typeof session === 'object' && typeof session.id === 'string' && session.archived !== true)
    .map((session) => ({
      id: session.id,
      title: typeof session.title === 'string' && session.title !== '' ? session.title : String(session.id).slice(0, 12),
      when: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
      cwd: typeof session.projectionValues?.workingDirectory === 'string'
        ? session.projectionValues.workingDirectory
        : typeof session.cwd === 'string' ? session.cwd : '',
      workspaceId: typeof session.workspaceId === 'string'
        ? session.workspaceId
        : typeof session.projectionValues?.workspaceId === 'string' ? session.projectionValues.workspaceId : '',
      archived: session.archived === true || session.projectionValues?.archived === true || typeof session.archivedAt === 'number' || typeof session.archivedAt === 'string',
      blank: session.blank === true || session.projectionValues?.blank === true,
    }))
    .sort((a, b) => b.when - a.when)
    .slice(0, 15)
  try {
    return JSON.stringify(rows)
  } catch {
    return '[]'
  }
}

/** 当前主视图会话 id（切换会话弹窗的高亮）。 */
function selectMainSessionId(state) {
  const sessions = state === null || state === undefined ? [] : Object.values(state.byId ?? {})
  if (sessions.length === 0) return null
  const main = sessions.find((session) => (session.retainedBy?.mainView ?? 0) > 0)
  return (main ?? sessions[sessions.length - 1])?.id ?? null
}

/** 当前主视图会话的标题（显示在 AI 停靠栏工具条）。 */
function selectSessionTitle(state) {
  const sessions = state === null || state === undefined ? [] : Object.values(state.byId ?? {})
  if (sessions.length === 0) return null
  const main = sessions.find((session) => (session.retainedBy?.mainView ?? 0) > 0)
  const picked = main ?? sessions[sessions.length - 1]
  const title = picked?.title ?? picked?.projectionValues?.title
  return typeof title === 'string' && title !== '' ? title : null
}

/** 当前主视图会话的工作目录（用于默认打开项目）。 */
function selectSessionCwd(state) {
  const sessions = state === null || state === undefined ? [] : Object.values(state.byId ?? {})
  if (sessions.length === 0) return null
  const main = sessions.find((session) => (session.retainedBy?.mainView ?? 0) > 0)
  const picked = main ?? sessions[sessions.length - 1]
  return picked?.projectionValues?.workingDirectory ?? picked?.cwd ?? null
}

/** 可拖拽尺寸 hook：返回 [size, onMouseDown, setSize]。 */
G.useSplitter = function useSplitter(options) {
  const { initial, min, max, axis = 'x', invert = false, storageKey } = options
  const [size, setSize] = useState(() => {
    const stored = storageKey === undefined ? null : Number(localStorage.getItem(storageKey))
    return Number.isFinite(stored) && stored > 0 ? Math.min(max, Math.max(min, stored)) : initial
  })
  const onMouseDown = useCallback((event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startPosition = axis === 'x' ? event.clientX : event.clientY
    const startSize = size
    let latest = size
    const onMove = (moveEvent) => {
      const position = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
      const delta = (position - startPosition) * (invert ? -1 : 1)
      latest = Math.min(max, Math.max(min, startSize + delta))
      setSize(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (storageKey !== undefined) {
        try {
          localStorage.setItem(storageKey, String(latest))
        } catch {
          /* ignore */
        }
      }
    }
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [axis, invert, max, min, size, storageKey])
  return [size, onMouseDown, setSize]
}

/** 主界面组件。props 由 slot 框架注入（useSessions 等标准 hook）。 */
G.GufaApp = function GufaApp(props) {
  const t = G.useT()
  const theme = G.useTheme()
  const problems = G.useProblems()
  const skinBackdrop = typeof G.useSkinBackdrop === 'function' ? G.useSkinBackdrop() : { available: false }
  const solidPalette = typeof G.usePalette === 'function' ? G.usePalette() : null
  useEffect(() => {
    try {
      if (window.__gufaPaletteLogs === undefined) window.__gufaPaletteLogs = 20
      if (window.__gufaPaletteLogs > 0) {
        window.__gufaPaletteLogs -= 1
        void G.api('dev.log', {
          message: `app-palette null=${solidPalette === null || solidPalette === undefined} isDark=${solidPalette === null || solidPalette === undefined ? '?' : solidPalette.isDark === true} bg=${solidPalette === null || solidPalette === undefined ? '?' : String(solidPalette.bg)}`,
        }).catch(() => {})
      }
    } catch {
      /* ignore */
    }
  }, [solidPalette])
  const [backdropOn, setBackdropOn] = useState(() => G.backdropPref.get())
  const [backdropStrength, setBackdropStrength] = useState(() => (
    G.backdropStrengthPref !== null && G.backdropStrengthPref !== undefined && typeof G.backdropStrengthPref.get === 'function'
      ? G.backdropStrengthPref.get()
      : null
  ))
  const backdropActive = backdropOn && skinBackdrop.available === true

  // slot 标准 props（main keyed slot 始终提供 useSessions）
  const useSessions = props.useSessions
  const sessionCwd = useSessions !== undefined ? useSessions(selectSessionCwd) : null
  const sessionTitle = useSessions !== undefined ? useSessions(selectSessionTitle) : null
  const currentSessionId = useSessions !== undefined ? useSessions(selectMainSessionId) : null
  const [sessionsOpen, setSessionsOpen] = useState(false)
  /* 会话弹窗里选中的工作区（null = 跟随当前 IDE 项目） */
  const [sessionWorkspacePath, setSessionWorkspacePath] = useState(null)
  const [sessionWorkspacePicker, setSessionWorkspacePicker] = useState(false)
  const recentSessionsJson = useSessions !== undefined ? useSessions(selectRecentSessionsJson) : '[]'
  const recentSessionsRaw = useMemo(() => {
    let parsed
    try {
      parsed = JSON.parse(recentSessionsJson)
    } catch {
      return []
    }
    return Array.isArray(parsed) ? parsed : []
  }, [recentSessionsJson])

  const [ui, setUi] = useState(() => {
    const saved = readJson(GUFA_LS.ui) ?? {}
    return {
      view: typeof saved.view === 'string' ? saved.view : 'explorer',
      chatOpen: saved.chatOpen !== false,
      terminalOpen: saved.terminalOpen === true,
      sidebarOpen: saved.sidebarOpen !== false,
    }
  })
  const [project, setProject] = useState(null)
  /* 只列出「当前工作区」的会话：经典模式里会话归属工作区，切换工作区后历史应隔离 */
  const recentSessions = useMemo(() => {
    const root = typeof project?.root === 'string' ? project.root : ''
    if (root === '') return recentSessionsRaw
    return recentSessionsRaw.filter((row) => row !== null && typeof row === 'object' && (row.cwd === root || row.cwd === ''))
  }, [recentSessionsRaw, project?.root])
  const [bootError, setBootError] = useState('')
  const [hostStale, setHostStale] = useState(false)
  const [banner, setBanner] = useState('')
  const [tabs, setTabs] = useState([])
  const [activePath, setActivePath] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [gitRefreshToken, setGitRefreshToken] = useState(0)
  const [sshRefreshToken, setSshRefreshToken] = useState(0)
  const [gitStatus, setGitStatus] = useState(null)
  const [modal, setModal] = useState(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [trashUndo, setTrashUndo] = useState([])
  const [bannerTone, setBannerTone] = useState('error')
  const [branchMenu, setBranchMenu] = useState(null)
  const [workspaceDialog, setWorkspaceDialog] = useState(null)
  const [workspaceSessions, setWorkspaceSessions] = useState({ status: 'idle', sessions: [], groups: [], sessionIds: [], archivedSessionIds: [] })
  const [workspaceIndex, setWorkspaceIndex] = useState([])
  const [recentCurrentIds, setRecentCurrentIds] = useState([])
  const [sessionGroupOpen, setSessionGroupOpen] = useState({})
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [branchInput, setBranchInput] = useState('')
  const [modalPending, setModalPending] = useState(false)
  const [modalError, setModalError] = useState('')
  const bootedRef = useRef(false)
  const [explorerWidth, explorerDrag] = G.useSplitter({ initial: 260, min: 190, max: 520, storageKey: 'gufa-code:w:explorer' })
  const [chatWidth, chatDrag] = G.useSplitter({ initial: 430, min: 320, max: 780, axis: 'x', invert: true, storageKey: 'gufa-code:w:chat' })
  const [terminalHeight, terminalDrag] = G.useSplitter({ initial: 230, min: 120, max: 560, axis: 'y', invert: true, storageKey: 'gufa-code:h:terminal' })

  const patchUi = useCallback((patch) => {
    setUi((current) => {
      const next = { ...current, ...patch }
      writeJson(GUFA_LS.ui, next)
      return next
    })
  }, [])

  /* ── 项目打开 ──────────────────────────────────────────────────────── */
  const applyProject = useCallback((value) => {
    G.projectRoot = typeof value?.root === 'string' ? value.root : null
    setProject(value)
    writeJson(GUFA_LS.project, value?.root ?? null)
    setTabs([])
    setActivePath(null)
    setCursor(null)
    setGitStatus(null)
    setRefreshToken((token) => token + 1)
    setGitRefreshToken((token) => token + 1)
    setSshRefreshToken((token) => token + 1)
  }, [])

  const openProjectPath = useCallback(async (path) => {
    setBootError('')
    const value = await G.api('project.open', { path })
    applyProject(value)
    return value
  }, [applyProject])

  // 启动：恢复上次项目 → 当前会话工作目录 → 空状态
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    let cancelled = false
    void (async () => {
      const saved = readJson(GUFA_LS.project)
      if (typeof saved === 'string' && saved !== '') {
        try {
          const value = await G.api('project.open', { path: saved })
          if (!cancelled) applyProject(value)
          return
        } catch {
          writeJson(GUFA_LS.project, null)
        }
      }
      if (typeof sessionCwd === 'string' && sessionCwd !== '') {
        try {
          const value = await G.api('project.open', { path: sessionCwd })
          if (!cancelled) applyProject(value)
        } catch (error) {
          if (!cancelled) setBootError(G.errorText(error))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionCwd, applyProject])

  // 探测 Host 半版本：插件升级后若 Host 仍是旧代码（未重启 Harness），给出明确提示
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await G.api('dev.version', {})
        if (!cancelled) setHostStale(false)
      } catch (error) {
        if (!cancelled && error !== null && typeof error === 'object' && error.code === 'not-found') setHostStale(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── Git 状态（状态栏 / 资源管理器徽标） ────────────────────────────── */
  const refreshGit = useCallback(async () => {
    if (project === null || project.isGit !== true) {
      setGitStatus(null)
      return
    }
    try {
      const value = await G.api('git.status', { root: project.root })
      setGitStatus(value)
    } catch {
      setGitStatus(null)
    }
  }, [project])

  useEffect(() => {
    void refreshGit()
  }, [refreshGit, gitRefreshToken])

  const gitStatuses = useMemo(() => {
    const map = {}
    for (const change of gitStatus?.changes ?? []) map[change.path] = change.status
    return map
  }, [gitStatus])

  /* ── 文件打开 / 保存 / 关闭 ─────────────────────────────────────────── */
  const openFile = useCallback(async (path) => {
    if (project === null) return
    const existing = tabs.find((tab) => tab.path === path)
    if (existing !== undefined) {
      setActivePath(path)
      return
    }
    try {
      const doc = await G.api('fs.read', { root: project.root, path })
      setTabs((current) => [...current, { ...doc, savedContent: doc.content, dirty: false, savedRevision: doc.revision }])
      setActivePath(path)
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project, tabs])

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? null, [tabs, activePath])

  const patchTab = useCallback((path, patch) => {
    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab)))
  }, [])

  const changeFile = useCallback((path, content) => {
    setTabs((current) => current.map((tab) => (
      tab.path === path ? { ...tab, content, dirty: content !== tab.savedContent } : tab
    )))
  }, [])

  const saveFile = useCallback(async (path) => {
    if (project === null) return
    const tab = tabs.find((item) => item.path === path)
    if (tab === undefined || tab.dirty !== true) return
    try {
      const result = await G.api('fs.write', {
        root: project.root,
        path: tab.path,
        content: tab.content,
        expectedRevision: tab.revision,
      })
      patchTab(path, { revision: result.revision, savedRevision: result.revision, savedContent: tab.content, dirty: false, size: result.size })
      setBanner('')
      // 内容保存不改变目录结构：只刷新 Git 状态，不重载文件树（避免整页闪烁）
      setGitRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      if (error.code === 'revision-conflict') setBanner(t('editor.saveConflict'))
      else setBanner(G.errorText(error))
    }
  }, [project, tabs, patchTab, refreshGit, t])

  /** 顶栏提示：错误常驻红色；成功用绿色 toast，1.2 秒后自动消失。 */
  const successTimerRef = useRef(null)
  const showBanner = useCallback((text, tone) => {
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current)
      successTimerRef.current = null
    }
    if (tone === 'success') {
      setBannerTone('success')
      setBanner(text)
      successTimerRef.current = window.setTimeout(() => {
        successTimerRef.current = null
        setBanner('')
      }, 1200)
      return
    }
    setBannerTone('error')
    setBanner(text)
  }, [])
  useEffect(() => () => {
    if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current)
  }, [])

  const closeTab = useCallback((path) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab.path !== path)
      if (activePath === path) {
        const index = current.findIndex((tab) => tab.path === path)
        const fallback = next[Math.min(index, next.length - 1)]
        setActivePath(fallback?.path ?? null)
      }
      return next
    })
  }, [activePath])

  const closeTabWithConfirm = useCallback((path) => {
    const tab = tabs.find((item) => item.path === path)
    if (tab !== undefined && tab.dirty === true) {
      setModal({ type: 'closeTab', path })
      return
    }
    closeTab(path)
  }, [tabs, closeTab])

  /* ── Git Graph（提交图标签页） ─────────────────────────────────────── */
  const openGitGraph = useCallback(() => {
    if (project === null) return
    const path = 'gufa-graph'
    setTabs((current) => {
      if (current.some((tab) => tab !== null && tab.path === path)) return current
      return [...current, { path, title: 'Git Graph', kind: 'graph' }]
    })
    setActivePath(path)
  }, [project])

  /* Git Graph：点开某次提交里的文件 → 提交版本 diff（父提交 vs 该提交） */
  const openCommitFile = useCallback(async (commit, file) => {
    if (project === null || commit === null || commit === undefined || file === null || file === undefined) return
    if (typeof file.path !== 'string' || file.path === '' || typeof commit.hash !== 'string') return
    try {
      const [leftResult, rightResult] = await Promise.all([
        G.api('git.fileVersion', { root: project.root, path: file.path, hash: commit.hash, parent: true }).catch(() => ({ text: '' })),
        G.api('git.fileVersion', { root: project.root, path: file.path, hash: commit.hash }).catch(() => ({ text: '' })),
      ])
      const path = `gufa-commit:${commit.hash.slice(0, 10)}:${file.path}`
      const leftText = typeof leftResult?.text === 'string' ? leftResult.text : ''
      const rightText = typeof rightResult?.text === 'string' ? rightResult.text : ''
      const tab = {
        path,
        title: `${G.basename(file.path)}（${commit.short ?? commit.hash.slice(0, 7)}）`,
        kind: 'diff',
        content: rightText,
        savedContent: rightText,
        dirty: false,
        language: G.languageOfPath(file.path),
        compareLeft: leftText,
        diff: { left: leftText, staged: false, editable: false },
        diffKey: Date.now(),
      }
      setTabs((current) => {
        const exists = current.some((item) => item !== null && item.path === path)
        if (exists) return current.map((item) => (item !== null && item.path === path ? { ...item, ...tab } : item))
        return [...current, tab]
      })
      setActivePath(path)
      setBanner('')
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project])

  /* 分支切换 / 新建 ──────────────────────────────────────────────── */
  const openBranchMenu = useCallback((event) => {
    if (project === null || project.isGit !== true) return
    let placement = { x: 12, top: 40 }
    try {
      const rect = event !== null && event !== undefined && event.currentTarget !== null
        ? event.currentTarget.getBoundingClientRect()
        : null
      if (rect !== null) {
        const x = Math.max(8, Math.min(rect.left, window.innerWidth - 280))
        // 锚点在屏幕下半部（例如底部状态栏）时向上弹出，避免被视口裁掉
        if (rect.top > window.innerHeight * 0.55) placement = { x, bottom: Math.max(8, window.innerHeight - rect.top + 6) }
        else placement = { x, top: rect.bottom + 6 }
      }
    } catch {
      /* ignore */
    }
    setBranchInput('')
    setBranchMenu({ ...placement, loading: true, branches: [], error: '' })
    void G.api('git.branches', { root: project.root })
      .then((value) => {
        setBranchMenu((current) => (current === null ? current : { ...current, loading: false, branches: Array.isArray(value?.branches) ? value.branches : [] }))
      })
      .catch((error) => {
        setBranchMenu((current) => (current === null ? current : { ...current, loading: false, error: G.errorText(error) }))
      })
  }, [project])

  const closeBranchMenu = useCallback(() => {
    setBranchMenu(null)
    setBranchInput('')
  }, [])

  /* 点其它地方 / Esc 关闭分支弹层 */
  useEffect(() => {
    if (branchMenu === null) return undefined
    const onPointerDown = () => closeBranchMenu()
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeBranchMenu()
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [branchMenu, closeBranchMenu])

  const checkoutBranch = useCallback(async (name) => {
    if (project === null || typeof name !== 'string' || name === '') return
    try {
      await G.api('git.checkout', { root: project.root, branch: name })
      closeBranchMenu()
      showBanner(`已切换到分支 ${name}`, 'success')
      setGitRefreshToken((token) => token + 1)
      setRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      setBranchMenu((current) => (current === null ? current : { ...current, error: G.errorText(error) }))
    }
  }, [project, closeBranchMenu, refreshGit])

  const createBranch = useCallback(async () => {
    if (project === null) return
    const name = branchInput.trim()
    if (name === '') return
    try {
      await G.api('git.createBranch', { root: project.root, name })
      closeBranchMenu()
      showBanner(`已创建并切换到分支 ${name}`, 'success')
      setGitRefreshToken((token) => token + 1)
      setRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      setBranchMenu((current) => (current === null ? current : { ...current, error: G.errorText(error) }))
    }
  }, [project, branchInput, closeBranchMenu, refreshGit])

  /* ── 删除（无确认弹窗，软删除到临时目录，⌘Z 可撤销） ──────────────── */
  const deleteEntry = useCallback(async (path) => {
    if (project === null || typeof path !== 'string' || path === '') return
    try {
      const result = await G.api('fs.trash', { root: project.root, path })
      if (result !== null && result !== undefined && typeof result.id === 'string') {
        setTrashUndo((current) => [...current.slice(-19), { id: result.id, path: result.path ?? path, root: project.root }])
      }
      setBanner('')
      // 文件/目录已删除：关闭对应编辑标签（目录则关闭其下所有文件）
      const removedPath = typeof result?.path === 'string' ? result.path : path
      setTabs((current) => current.filter((tab) => tab !== null && tab.path !== removedPath && !tab.path.startsWith(`${removedPath}/`)))
      setActivePath((current) => {
        if (current === null) return current
        if (current === removedPath || current.startsWith(`${removedPath}/`)) return null
        return current
      })
      setRefreshToken((token) => token + 1)
      setGitRefreshToken((token) => token + 1)
      void refreshGit()
      props?.onChanged?.()
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project, refreshGit])

  const undoDelete = useCallback(async () => {
    const last = trashUndo.length > 0 ? trashUndo[trashUndo.length - 1] : null
    if (last === null) return
    try {
      await G.api('fs.untrash', { root: last.root, id: last.id, path: last.path })
      setTrashUndo((current) => current.slice(0, -1))
      setBanner('')
      setRefreshToken((token) => token + 1)
      setGitRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [trashUndo, refreshGit])

  /* ⌘Z 撤销删除：编辑器内交给 Monaco、终端内交给 shell，其余位置撤销删除 */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'z' && event.key !== 'Z') return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (trashUndo.length === 0) return
      try {
        if (typeof G.isEditorFocused === 'function' && G.isEditorFocused()) return
        const active = document.activeElement
        if (active !== null && active !== undefined && typeof active.closest === 'function') {
          if (active.closest('.xterm') !== null) return
          // 输入框/文本域里 ⌘Z 仍是文本撤销
          if (active.closest('input, textarea, [contenteditable="true"], [contenteditable=""]') !== null) return
        }
      } catch {
        /* ignore */
      }
      event.preventDefault()
      event.stopPropagation()
      void undoDelete()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [trashUndo, undoDelete])

  /* ── Git diff / 两文件对比（Monaco DiffEditor） ────────────────────── */
  const openDiffForChange = useCallback(async (change) => {
    if (project === null || change === null || typeof change !== 'object' || typeof change.path !== 'string') return
    const existing = tabs.find((item) => item.path === change.path)
    if (existing !== undefined && existing !== null && existing.kind !== 'diff' && existing.dirty === true) {
      setBanner('该文件有未保存修改，请先保存后再查看 diff')
      return
    }
    try {
      const file = await G.api('fs.read', { root: project.root, path: change.path })
      let left = ''
      try {
        const shown = await G.api('git.show', {
          root: project.root,
          path: change.path,
          rev: change.staged === true ? 'head' : 'index',
        })
        left = typeof shown.text === 'string' ? shown.text : ''
      } catch {
        left = ''
      }
      const tab = {
        path: change.path,
        title: `${G.basename(change.path)}（${change.staged === true ? '暂存区' : '工作树'}）`,
        kind: 'diff',
        content: file.content ?? '',
        savedContent: file.content ?? '',
        revision: file.revision,
        dirty: false,
        language: file.language ?? 'plaintext',
        size: file.size,
        diff: { left, staged: change.staged === true, editable: change.staged !== true },
        diffKey: Date.now(),
      }
      setTabs((current) => {
        const index = current.findIndex((item) => item.path === change.path)
        if (index === -1) return [...current, tab]
        const next = current.slice()
        next[index] = { ...next[index], ...tab }
        return next
      })
      setActivePath(change.path)
      setBanner('')
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project, tabs])

  const compareFiles = useCallback(async (leftPath, rightPath) => {
    if (project === null || leftPath === rightPath) return
    try {
      const [leftFile, rightFile] = await Promise.all([
        G.api('fs.read', { root: project.root, path: leftPath }),
        G.api('fs.read', { root: project.root, path: rightPath }),
      ])
      const path = `gufa-diff:${leftPath}::${rightPath}`
      const tab = {
        path,
        title: `${G.basename(leftPath)} ↔ ${G.basename(rightPath)}`,
        kind: 'diff',
        content: rightFile.content ?? '',
        savedContent: rightFile.content ?? '',
        dirty: false,
        language: rightFile.language ?? 'plaintext',
        size: rightFile.size,
        compareLeft: leftFile.content ?? '',
        compareSavedLeft: leftFile.content ?? '',
        leftRevision: leftFile.revision,
        rightRevision: rightFile.revision,
        diff: { left: leftFile.content ?? '', leftPath, rightPath, staged: false, editable: true, compare: true },
        diffKey: Date.now(),
      }
      setTabs((current) => {
        const exists = current.find((item) => item.path === path)
        if (exists !== undefined) return current.map((item) => (item.path === path ? { ...item, ...tab } : item))
        return [...current, tab]
      })
      setActivePath(path)
      setBanner('')
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project])

  /* Diff 工具条：还原当前文件改动 / 暂存当前文件 */
  const revertDiffFile = useCallback(async (path) => {
    if (project === null) return
    try {
      await G.api('git.discard', { root: project.root, paths: [path] })
      showBanner('已还原该文件的改动', 'success')
      // 改动已还原：关掉该 diff 标签（内容已与暂存区一致）
      setTabs((current) => current.filter((tab) => tab.path !== path))
      setActivePath((current) => (current === path ? null : current))
      setGitRefreshToken((token) => token + 1)
      setRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project, refreshGit])

  const stageDiffFile = useCallback(async (path) => {
    if (project === null) return
    try {
      await G.api('git.stage', { root: project.root, paths: [path] })
      showBanner('已暂存该文件', 'success')
      setGitRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project, refreshGit])

  /* 两文件对比：左右两侧都可编辑，⌘S / 自动保存时写回两个文件 */
  const saveCompareTab = useCallback(async (path) => {
    if (project === null) return
    const tab = tabs.find((item) => item.path === path)
    if (tab === undefined || tab.kind !== 'diff' || tab.diff === null || tab.diff === undefined || tab.diff.compare !== true) return
    const leftChanged = String(tab.compareLeft ?? '') !== String(tab.compareSavedLeft ?? '')
    const rightChanged = String(tab.content ?? '') !== String(tab.savedContent ?? '')
    if (!leftChanged && !rightChanged) return
    try {
      const patch = {}
      if (leftChanged && typeof tab.diff.leftPath === 'string') {
        const result = await G.api('fs.write', { root: project.root, path: tab.diff.leftPath, content: tab.compareLeft ?? '', expectedRevision: tab.leftRevision })
        patch.leftRevision = result.revision
        patch.compareSavedLeft = tab.compareLeft ?? ''
      }
      if (rightChanged && typeof tab.diff.rightPath === 'string') {
        const result = await G.api('fs.write', { root: project.root, path: tab.diff.rightPath, content: tab.content ?? '', expectedRevision: tab.rightRevision })
        patch.rightRevision = result.revision
        patch.revision = result.revision
        patch.savedContent = tab.content ?? ''
      }
      patch.dirty = false
      patchTab(path, patch)
      setBanner('')
      setGitRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      setBanner(error.code === 'revision-conflict' ? t('editor.saveConflict') : G.errorText(error))
    }
  }, [project, tabs, patchTab, refreshGit, t])

  /* 自动保存：dirty 后 700ms 静默保存（普通文件 / 工作树 diff / 两文件对比） */
  const saveFileRef = useRef(null)
  const saveCompareRef = useRef(null)
  saveFileRef.current = saveFile
  saveCompareRef.current = saveCompareTab
  const autoSaveTimersRef = useRef(new Map())
  useEffect(() => {
    const timers = autoSaveTimersRef.current
    for (const tab of tabs) {
      if (tab === null || tab.dirty !== true) continue
      if (timers.has(tab.path)) continue
      const timer = window.setTimeout(() => {
        timers.delete(tab.path)
        const isCompare = tab.kind === 'diff' && tab.diff !== null && tab.diff !== undefined && tab.diff.compare === true
        if (isCompare) void saveCompareRef.current?.(tab.path)
        else void saveFileRef.current?.(tab.path)
      }, 700)
      timers.set(tab.path, timer)
    }
    for (const [path, timer] of [...timers]) {
      const tab = tabs.find((item) => item.path === path)
      if (tab === undefined || tab.dirty !== true) {
        window.clearTimeout(timer)
        timers.delete(path)
      }
    }
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [tabs])

  /* 两文件对比：左右两侧都可编辑（本地草稿，不写回磁盘） */
  const changeDiffSide = useCallback((path, side, value) => {
    setTabs((current) => current.map((tab) => {
      if (tab === null || tab.path !== path || tab.kind !== 'diff') return tab
      if (side === 'left') return { ...tab, compareLeft: value, dirty: true }
      return { ...tab, content: value, dirty: true }
    }))
  }, [])

  /* 会话弹窗里选了别的工作区的会话：右侧会话保持不动，不再自动把 IDE 项目切过去 */
  const sessionPinnedRef = useRef(false)

  /* ── 右侧 AI 面板与当前工作区保持一致 ─────────────────────────────────
   * ChatDock 停靠的是 DSH「主视图会话」，但主视图会话可能属于别的工作区
   * （重启恢复、手动切换会话后常见）。项目根变化时自动切到当前工作区的会话。 */
  const dockSyncRef = useRef('')
  useEffect(() => {
    if (sessionPinnedRef.current === true) return undefined
    if (project === null || typeof project.root !== 'string' || project.root === '') return undefined
    if (dockSyncRef.current === project.root) return undefined
    if (typeof sessionCwd === 'string' && sessionCwd !== '' && sessionCwd === project.root) {
      dockSyncRef.current = project.root
      return undefined
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const ui = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
          if (ui === undefined || ui === null) return
          const listValue = await G.api('workspaces.list', {})
          const list = Array.isArray(listValue?.workspaces) ? listValue.workspaces : []
          const matched = list.find((item) => item !== null && item.path === project.root)
          if (matched === undefined || typeof matched.id !== 'string') return
          let sessions = []
          try {
            const value = await G.api('workspaces.sessions', { path: project.root, currentSessionId: '' })
            sessions = Array.isArray(value?.sessions) ? value.sessions : []
          } catch {
            sessions = []
          }
          if (sessions.length > 0 && typeof sessions[0].id === 'string' && typeof ui.openSession === 'function') {
            ui.openSession(sessions[0].id)
          } else if (typeof ui.openWorkspace === 'function') {
            await ui.openWorkspace(matched.id)
          }
          dockSyncRef.current = project.root
        } catch {
          /* 同步失败不阻塞界面 */
        }
      })()
    }, 400)
    return () => window.clearTimeout(timer)
  }, [project?.root, sessionCwd])

  /* ── 进入 IDE 时以「点进来的那个工作区」为准 ─────────────────────────
   * 经典模式下从工作区节点/菜单点「古法编程」时，入口会把目标工作区写进
   * G.pendingEntryWorkspace。这里消费它：
   * - 经典模式当前会话就在这个工作区 → 直接打开该会话（不切换、不打断）；
   * - 否则切到该工作区最近的会话，再把 IDE 项目根切过去。 */
  const entryWorkspaceSyncedRef = useRef(false)
  useEffect(() => {
    if (entryWorkspaceSyncedRef.current) return
    if (project === null) return
    const pending = G.pendingEntryWorkspace
    if (pending === null || pending === undefined || typeof pending.key !== 'string') {
      if (typeof sessionCwd !== 'string' || sessionCwd === '') return
      entryWorkspaceSyncedRef.current = true
      if (project.root !== sessionCwd) void openProjectPath(sessionCwd).catch((error) => setBanner(G.errorText(error)))
      return
    }
    entryWorkspaceSyncedRef.current = true
    void (async () => {
      try {
        let targetPath = ''
        try {
          const listValue = await G.api('workspaces.list', {})
          const list = Array.isArray(listValue?.workspaces) ? listValue.workspaces : []
          const matched = list.find((item) => item !== null && item.id === pending.key)
          targetPath = typeof matched?.path === 'string' ? matched.path : ''
        } catch {
          targetPath = ''
        }
        G.pendingEntryWorkspace = null
        const sameWorkspace = typeof sessionCwd === 'string' && sessionCwd !== '' && targetPath !== '' && sessionCwd === targetPath
        if (sameWorkspace) {
          /* 当前正在聊的会话就在这个工作区：直接用它，只把项目根对齐 */
          if (project.root !== targetPath) await openProjectPath(targetPath)
          return
        }
        /* 会话属于别的工作区：切到目标工作区最近的会话，再对齐项目根 */
        try {
          const ui = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
          const value = await G.api('workspaces.sessions', { path: targetPath, currentSessionId: '' })
          const rows = Array.isArray(value?.sessions) ? value.sessions : []
          if (rows.length > 0 && typeof rows[0].id === 'string' && ui !== undefined && ui !== null && typeof ui.openSession === 'function') ui.openSession(rows[0].id)
          else if (ui !== undefined && ui !== null && typeof ui.openWorkspace === 'function') await ui.openWorkspace(pending.key)
        } catch {
          /* ignore */
        }
        if (targetPath !== '') await openProjectPath(targetPath)
      } catch (error) {
        setBanner(G.errorText(error))
      }
    })()
  }, [project, sessionCwd, openProjectPath, setBanner])

  /* ── 已删除文件的标签自动关闭 ──────────────────────────────────────── */
  const pruneMissingTabs = useCallback(async () => {
    if (project === null || typeof project.root !== 'string') return
    const candidates = tabs.filter((tab) => tab !== null && typeof tab.path === 'string'
      && tab.kind !== 'graph'
      && !tab.path.startsWith('gufa-diff:')
      && !tab.path.startsWith('gufa-commit:'))
    if (candidates.length === 0) return
    const missing = []
    await Promise.all(candidates.map(async (tab) => {
      try {
        await G.api('fs.stat', { root: project.root, path: tab.path })
      } catch (error) {
        const code = error !== null && typeof error === 'object' ? error.code ?? error.status : undefined
        const message = error !== null && typeof error === 'object' ? String(error.message ?? '') : ''
        if (code === 'not-found' || code === 404 || /not-found|不存在|ENOENT/.test(message)) missing.push(tab.path)
      }
    }))
    if (missing.length === 0) return
    const missingSet = new Set(missing)
    setTabs((current) => current.filter((tab) => tab !== null && !missingSet.has(tab.path)))
    setActivePath((current) => (current !== null && missingSet.has(current) ? null : current))
    showBanner(`已关闭 ${missing.length} 个已删除文件的标签`, 'success')
  }, [project, tabs, showBanner])
  const pruneMissingTabsRef = useRef(null)
  pruneMissingTabsRef.current = pruneMissingTabs

  /* 文件树刷新后 / 窗口重新聚焦时检查一次（文件可能在外部被删除） */
  useEffect(() => {
    if (refreshToken === 0) return
    void pruneMissingTabsRef.current?.()
  }, [refreshToken])
  useEffect(() => {
    const onFocus = () => { void pruneMissingTabsRef.current?.() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  /* ── 文件操作（新建 / 重命名 / 删除） ──────────────────────────────── */
  const afterTreeChange = useCallback(() => {
    setRefreshToken((token) => token + 1)
    setGitRefreshToken((token) => token + 1)
    void refreshGit()
  }, [refreshGit])

  const submitModal = useCallback(async (value) => {
    if (modal === null) return
    setModalPending(true)
    setModalError('')
    try {
      if (modal.type === 'openPath') {
        if (value.trim() === '') throw new Error(t('app.pathPlaceholder'))
        await openProjectPath(value.trim())
      } else if (modal.type === 'newProject') {
        const name = modal.name ?? ''
        if (name.trim() === '') throw new Error(t('app.projectName'))
        const parent = modal.parent ?? ''
        if (parent.trim() === '') throw new Error(t('app.parentFolder'))
        if (project !== null) {
          /* 保持当前项目不变，只新建 */
        }
        const created = await G.api('project.create', { parent: parent.trim(), name: name.trim() })
        applyProject(created)
      } else if (modal.type === 'newFile' || modal.type === 'newFolder') {
        if (project === null) throw new Error(t('explorer.openProjectFirst'))
        if (value.trim() === '') throw new Error(t('explorer.fileName'))
        const target = G.joinPath(modal.dir ?? '', value.trim())
        await G.api('fs.create', { root: project.root, path: target, kind: modal.type === 'newFolder' ? 'dir' : 'file' })
        afterTreeChange()
        if (modal.type === 'newFile') void openFile(target)
      } else if (modal.type === 'rename') {
        if (project === null) throw new Error(t('explorer.openProjectFirst'))
        if (value.trim() === '') throw new Error(t('explorer.rename'))
        const target = G.joinPath(G.dirname(modal.path), value.trim())
        await G.api('fs.rename', { root: project.root, path: modal.path, nextPath: target })
        afterTreeChange()
        setTabs((current) => current.map((tab) => (tab.path === modal.path ? { ...tab, path: target } : tab)))
        if (activePath === modal.path) setActivePath(target)
      } else if (modal.type === 'delete') {
        if (project === null) throw new Error(t('explorer.openProjectFirst'))
        await G.api('fs.delete', { root: project.root, path: modal.path })
        setTabs((current) => current.filter((tab) => tab.path !== modal.path && !tab.path.startsWith(`${modal.path}/`)))
        if (activePath === modal.path) setActivePath(null)
        afterTreeChange()
      } else if (modal.type === 'closeTab') {
        closeTab(modal.path)
      }
      setModal(null)
    } catch (error) {
      setModalError(G.errorText(error))
    } finally {
      setModalPending(false)
    }
  }, [modal, project, activePath, applyProject, afterTreeChange, closeTab, openFile, openProjectPath, t])

  /* ── 目录选择（复用 Harness 原生选择器，失败回落到手输路径） ────────── */
  const pickDirectory = useCallback(async () => {
    const workspace = G.ctx === null ? undefined : G.ctx.get('uiWorkspace')
    if (workspace !== undefined && workspace !== null && typeof workspace.pickDirectory === 'function') {
      try {
        return await workspace.pickDirectory()
      } catch {
        return null
      }
    }
    return null
  }, [])

  const chooseAndOpenProject = useCallback(async () => {
    const picked = await pickDirectory()
    if (typeof picked === 'string' && picked !== '') {
      try {
        await openProjectPath(picked)
        setBanner('')
      } catch (error) {
        setBanner(G.errorText(error))
      }
      return
    }
    setModal({ type: 'openPath' })
  }, [openProjectPath, pickDirectory])

  const chooseParentForNewProject = useCallback(async () => {
    const picked = await pickDirectory()
    if (typeof picked === 'string' && picked !== '') setModal((current) => ({ ...current, parent: picked }))
  }, [pickDirectory])

  /* ── 工作区（与经典模式共用 DSH workspaceRegistry / uiWorkspace） ───── */
  const workspaceService = () => {
    try {
      return G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
    } catch {
      return undefined
    }
  }
  const workspacesService = () => {
    try {
      return G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('workspaces')
    } catch {
      return undefined
    }
  }

  const openWorkspaceDialog = useCallback(async () => {
    setWorkspaceDialog({ loading: true, available: true, workspaces: [], error: '' })
    try {
      const value = await G.api('workspaces.list', {})
      setWorkspaceDialog({
        loading: false,
        available: value?.available !== false,
        workspaces: Array.isArray(value?.workspaces) ? value.workspaces : [],
        error: '',
      })
    } catch (error) {
      setWorkspaceDialog({ loading: false, available: false, workspaces: [], error: G.errorText(error) })
    }
  }, [])

  const closeWorkspaceDialog = useCallback(() => setWorkspaceDialog(null), [])

  /* 点击左侧工作区名 → 切换已有工作区（与经典模式同一份 workspace 列表） */
  const switchWorkspace = useCallback(async (workspace) => {
    if (workspace === null || workspace === undefined) return
    sessionPinnedRef.current = false
    const service = workspaceService()
    try {
      if (service !== undefined && service !== null && typeof service.openWorkspace === 'function' && typeof workspace.id === 'string') {
        await service.openWorkspace(workspace.id)
      }
      /* 右侧 AI 要切到新工作区：打开该工作区最近的一个会话；没有会话就开一个新的空会话 */
      if (service !== undefined && service !== null && typeof workspace.path === 'string' && workspace.path !== '') {
        let sessions = []
        try {
          const value = await G.api('workspaces.sessions', { path: workspace.path, currentSessionId: '' })
          sessions = Array.isArray(value?.sessions) ? value.sessions : []
        } catch {
          sessions = []
        }
        try {
          if (sessions.length > 0 && typeof sessions[0].id === 'string' && typeof service.openSession === 'function') {
            service.openSession(sessions[0].id)
          } else if (typeof workspace.id === 'string' && typeof service.startSession === 'function') {
            service.startSession(workspace.id)
          }
        } catch {
          /* 会话切换失败不阻塞工作区切换 */
        }
      }
      if (typeof workspace.path === 'string' && workspace.path !== '') {
        await openProjectPath(workspace.path)
      }
      closeWorkspaceDialog()
      showBanner(`已切换到工作区 ${workspace.title || workspace.path || ''}`, 'success')
    } catch (error) {
      setWorkspaceDialog((current) => (current === null ? current : { ...current, error: G.errorText(error) }))
    }
  }, [openProjectPath, closeWorkspaceDialog, showBanner])

  /* 新建工作区：走经典模式同样的「选目录 → 创建 workspace → 打开并新建会话」 */
  const createWorkspace = useCallback(async () => {
    const ui = workspaceService()
    const registry = workspacesService()
    if (ui === undefined || ui === null || typeof ui.pickDirectory !== 'function' || registry === undefined || registry === null || typeof registry.create !== 'function') {
      setWorkspaceDialog(null)
      setModal({ type: 'newProject', parent: '', name: '' })
      return
    }
    setWorkspaceBusy(true)
    try {
      const directory = await ui.pickDirectory()
      if (typeof directory !== 'string' || directory === '') return
      const view = await registry.create({ path: directory })
      const id = typeof view?.id === 'string' ? view.id : typeof view?.workspace?.id === 'string' ? view.workspace.id : ''
      if (id !== '' && typeof ui.openWorkspace === 'function') await ui.openWorkspace(id)
      if (id !== '' && typeof ui.startSession === 'function') {
        try {
          ui.startSession(id)
        } catch {
          /* 新会话失败不影响工作区创建 */
        }
      }
      await openProjectPath(directory)
      closeWorkspaceDialog()
      showBanner('已创建工作区', 'success')
    } catch (error) {
      setBanner(G.errorText(error))
    } finally {
      setWorkspaceBusy(false)
    }
  }, [openProjectPath, closeWorkspaceDialog, showBanner])

  /* ── Esc 关闭所有弹窗/提示框（优先级：模态 > 工作区 > 分支 > 会话切换 > 快捷键） ── */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      const close = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (modal !== null) {
        close()
        setModal(null)
        setModalError('')
        return
      }
      if (workspaceDialog !== null) {
        close()
        closeWorkspaceDialog()
        return
      }
      if (branchMenu !== null) {
        close()
        closeBranchMenu()
        return
      }
      if (sessionsOpen === true) {
        close()
        setSessionsOpen(false)
        return
      }
      if (shortcutsOpen === true) {
        close()
        setShortcutsOpen(false)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [modal, workspaceDialog, branchMenu, sessionsOpen, shortcutsOpen, closeWorkspaceDialog, closeBranchMenu])

  /* 经典界面里切换工作区时：当前主视图会话的 cwd 变化 → 跟随打开对应项目 */
  const lastSessionCwdRef = useRef(null)
  useEffect(() => {
    if (sessionPinnedRef.current === true) return
    if (typeof sessionCwd !== 'string' || sessionCwd === '') return
    const previous = lastSessionCwdRef.current
    lastSessionCwdRef.current = sessionCwd
    if (previous === null || previous === sessionCwd) return
    if (project !== null && project.root === sessionCwd) return
    void openProjectPath(sessionCwd).catch((error) => setBanner(G.errorText(error)))
  }, [sessionCwd, project, openProjectPath])

  /* 记录最近成为「当前会话」的 id：新建空白会话后，列表也要保留上一个对话 */
  useEffect(() => {
    if (typeof currentSessionId !== 'string' || currentSessionId === '') return
    setRecentCurrentIds((current) => (current.includes(currentSessionId) ? current : [currentSessionId, ...current].slice(0, 12)))
  }, [currentSessionId])

  useEffect(() => {
    if (sessionsOpen === true) return undefined
    setSessionWorkspacePath(null)
    setSessionWorkspacePicker(false)
    return undefined
  }, [sessionsOpen])

  /* 切换会话弹窗：打开时向 Host 拉取「弹窗里选中工作区的会话」（经典侧边栏同源数据） */
  useEffect(() => {
    if (sessionsOpen !== true) return undefined
    if (project === null || typeof project.root !== 'string' || project.root === '') {
      setWorkspaceSessions({ status: 'ready', sessions: [] })
      return undefined
    }
    let cancelled = false
    const dialogPath = sessionWorkspacePath !== null && sessionWorkspacePath !== '' ? sessionWorkspacePath : project.root
    setWorkspaceSessions({ status: 'loading', sessions: [], groups: [] })
    void Promise.all([
      G.api('workspaces.list', {}).catch(() => ({ workspaces: [] })),
      G.api('workspaces.sessions', { path: dialogPath, currentSessionId: currentSessionId ?? '' }).catch(() => ({ groups: [] })),
    ])
      .then(([listValue, sessionsValue]) => {
        if (cancelled) return
        setWorkspaceIndex(Array.isArray(listValue?.workspaces) ? listValue.workspaces : [])
        const groups = Array.isArray(sessionsValue?.groups) ? sessionsValue.groups : []
        try {
          if (window.__gufaSessionsApiLog === undefined || window.__gufaSessionsApiLog > 0) {
            window.__gufaSessionsApiLog = (window.__gufaSessionsApiLog ?? 3) - 1
            void G.api('dev.log', { message: `sessions-api source=${sessionsValue?.source ?? '?'} error=${sessionsValue?.error ?? ''} sessions=${Array.isArray(sessionsValue?.sessions) ? sessionsValue.sessions.length : '?'} list=${JSON.stringify(sessionsValue?.debug?.list ?? {})} roots=${sessionsValue?.debug?.roots ?? '?'} stats=${JSON.stringify(sessionsValue?.debug?.stats ?? {})} cwds=${(sessionsValue?.debug?.sampleCwds ?? []).map((item) => String(item).slice(-28)).join('|')}` }).catch(() => {})
          }
        } catch {
          /* ignore */
        }
        const firstGroup = groups.find((group) => group.path === dialogPath) ?? groups[0]
        setWorkspaceSessions((previous) => {
          const nextSessions = Array.isArray(sessionsValue?.sessions)
            ? sessionsValue.sessions
            : firstGroup !== undefined && Array.isArray(firstGroup.sessions) ? firstGroup.sessions : []
          const nextWorkspaceId = typeof sessionsValue?.workspaceId === 'string' ? sessionsValue.workspaceId : ''
          const sameWorkspace = previous !== null && previous !== undefined && previous.workspaceId !== undefined && previous.workspaceId === nextWorkspaceId
          const previousSessions = sameWorkspace && Array.isArray(previous?.sessions) ? previous.sessions : []
          // 某次刷新拿到空列表（服务抖动/标题服务失败）时保留上一次成功结果；切换工作区则不沿用
          const sessions = nextSessions.length > 0 ? nextSessions : previousSessions
          const groupsNext = nextSessions.length > 0 ? groups : Array.isArray(previous?.groups) ? previous.groups : []
          return {
            status: 'ready',
            groups: groupsNext,
            sessions,
            sessionIds: Array.isArray(sessionsValue?.sessionIds) ? sessionsValue.sessionIds : Array.isArray(previous?.sessionIds) ? previous.sessionIds : [],
            archivedSessionIds: Array.isArray(sessionsValue?.archivedSessionIds) ? sessionsValue.archivedSessionIds : Array.isArray(previous?.archivedSessionIds) ? previous.archivedSessionIds : [],
            workspaceId: typeof sessionsValue?.workspaceId === 'string' ? sessionsValue.workspaceId : previous?.workspaceId ?? '',
          }
        })
      })
      .catch(() => {
        if (!cancelled) setWorkspaceSessions({ status: 'error', sessions: [], groups: [] })
      })
    return () => {
      cancelled = true
    }
  }, [sessionsOpen, project?.root, currentSessionId, sessionWorkspacePath])

  /* ── 退出（关闭覆盖层，回到 DSH 界面） ─────────────────────────────── */
  const exitMode = useCallback(() => {
    G.mode.set(false)
  }, [])

  // 进入/刷新时确保主视图是 DSH 会话：官方会话必须挂载，才能停靠进右侧 AI 栏
  useEffect(() => {
    const layout = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('layout')
    try {
      layout?.selectPanel?.(null)
    } catch (error) {
      console.error('[gufa-code] 确保会话主视图失败', error)
    }
  }, [])

  /* ── 终端 / SSH 协作 ───────────────────────────────────────────────── */
  const openTerminal = useCallback(() => {
    patchUi({ terminalOpen: true, view: 'terminal' })
  }, [patchUi])

  const connectSsh = useCallback((alias) => {
    patchUi({ terminalOpen: true })
    window.setTimeout(() => G.bus.emit('terminal:send', { text: `ssh ${alias}\r` }), 400)
  }, [patchUi])

  /* ── 插入 AI 生成代码 ──────────────────────────────────────────────── */
  const insertCode = useCallback((code) => {
    G.bus.emit('editor:insert', { text: code })
  }, [])

  const startNewSession = useCallback(() => {
    const workspace = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
    if (workspace === undefined || workspace === null || typeof workspace.startSession !== 'function') {
      setBanner('当前界面不支持新建会话')
      return
    }
    void (async () => {
      let workspaceId = null
      try {
        if (project !== null && typeof project.root === 'string') {
          const value = await G.api('workspaces.list', {})
          const list = Array.isArray(value?.workspaces) ? value.workspaces : []
          const matched = list.find((item) => item !== null && item.path === project.root)
          if (matched !== undefined && typeof matched.id === 'string') workspaceId = matched.id
        }
      } catch {
        workspaceId = null
      }
      try {
        if (workspaceId !== null) workspace.startSession(workspaceId)
        else workspace.startSession()
        setBanner('')
      } catch (error) {
        setBanner(G.errorText(error))
      }
    })()
  }, [project])

  const openSession = useCallback((sessionId) => {
    const workspace = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
    if (workspace === undefined || workspace === null || typeof workspace.openSession !== 'function') {
      setBanner('当前界面不支持切换会话')
      return
    }
    try {
      workspace.openSession(sessionId)
      setBanner('')
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [])

  /* 从会话弹窗打开会话：可同时切换到该会话所属工作区的项目 */
  const openSessionInWorkspace = useCallback((sessionId, workspacePath) => {
    const service = workspaceService()
    const path = typeof workspacePath === 'string' ? workspacePath : ''
    /* 只切右侧会话：选了别的工作区的会话时，左侧项目/工作区保持不动 */
    sessionPinnedRef.current = path !== '' && project !== null && path !== project.root
    lastSessionCwdRef.current = null
    try {
      if (service !== undefined && service !== null && typeof service.openSession === 'function') service.openSession(sessionId)
      else setBanner('当前界面不支持切换会话')
      setBanner('')
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project])

  /* 从会话弹窗新建会话：在弹窗选中的工作区里新建，并切换 IDE 项目 */
  const startNewSessionInWorkspace = useCallback((workspacePath) => {
    const service = workspaceService()
    const path = typeof workspacePath === 'string' ? workspacePath : ''
    void (async () => {
      let workspaceId = null
      try {
        const value = await G.api('workspaces.list', {})
        const list = Array.isArray(value?.workspaces) ? value.workspaces : []
        const matched = list.find((item) => item !== null && item.path === path)
        if (matched !== undefined && typeof matched.id === 'string') workspaceId = matched.id
      } catch {
        workspaceId = null
      }
      try {
        if (service !== undefined && service !== null && typeof service.startSession === 'function') {
          /* 只新建会话，不切左侧项目；跨工作区时 pin 住避免自动同步 */
          sessionPinnedRef.current = path !== '' && project !== null && path !== project.root
          if (workspaceId !== null) service.startSession(workspaceId)
          else service.startSession()
          setBanner('')
        } else {
          setBanner('当前界面不支持新建会话')
        }
      } catch (error) {
        setBanner(G.errorText(error))
      }
    })()
  }, [project])

  const activeFileForChat = useMemo(() => {
    if (activeTab === null || activeTab.kind === 'diff' || activeTab.kind === 'graph') return null
    return { path: activeTab.path, content: activeTab.content ?? '', language: activeTab.language }
  }, [activeTab])

  const selectionForChat = useMemo(() => {
    if (cursor === null || typeof cursor.selectedText !== 'string' || cursor.selectedText === '') return null
    return { text: cursor.selectedText, path: cursor.path, line: cursor.line, column: cursor.column }
  }, [cursor])

  /* ── IDE 专属快捷键（参考 VS Code；经典模式下不生效） ──────────────── */
  const editorFocusedRef = useRef(false)
  useEffect(() => {
    if (G.bus === null || G.bus === undefined) return undefined
    const off = G.bus.on('editor:focus', (focused) => {
      editorFocusedRef.current = focused === true
    })
    return () => {
      try {
        off()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const ideShortcutHandlers = useMemo(() => ({
    commit: () => {
      patchUi({ view: 'git' })
      if (G.bus !== undefined && G.bus !== null && typeof G.bus.emit === 'function') G.bus.emit('git:commit')
    },
    save: () => {
      const tab = tabs.find((item) => item.path === activePath)
      if (tab !== undefined && tab !== null && tab.kind === 'graph') return
      if (tab !== undefined && tab !== null && tab.kind === 'diff') {
        if (tab.diff !== null && tab.diff !== undefined && tab.diff.compare === true) {
          if (activePath !== null) void saveCompareTab(activePath)
          return
        }
        if (tab.diff === null || tab.diff === undefined || tab.diff.editable !== true) return
      }
      if (activePath !== null) void saveFile(activePath)
    },
    clearTerminal: () => {
      if (ui.terminalOpen !== true) {
        patchUi({ terminalOpen: true })
        return
      }
      G.bus.emit('terminal:clear')
    },
    toggleTerminal: () => patchUi({ terminalOpen: ui.terminalOpen !== true }),
    toggleSidebar: () => patchUi({ sidebarOpen: ui.sidebarOpen === false }),
    closeTab: () => {
      if (activePath !== null) closeTabWithConfirm(activePath)
    },
    panelExplorer: () => patchUi({ view: 'explorer', sidebarOpen: true }),
    panelGit: () => {
      patchUi({ view: 'git', sidebarOpen: true })
      setGitRefreshToken((token) => token + 1)
    },
    panelSsh: () => {
      patchUi({ view: 'ssh', sidebarOpen: true })
      setSshRefreshToken((token) => token + 1)
    },
    newTerminal: () => {
      if (ui.terminalOpen !== true) {
        patchUi({ terminalOpen: true })
        return
      }
      G.bus.emit('terminal:new')
    },
    refresh: () => {
      setRefreshToken((token) => token + 1)
      setGitRefreshToken((token) => token + 1)
      setSshRefreshToken((token) => token + 1)
    },
    nextTab: () => {
      if (tabs.length < 2) return
      const index = tabs.findIndex((tab) => tab.path === activePath)
      const next = tabs[(index + 1 + tabs.length) % tabs.length]
      if (next !== undefined) setActivePath(next.path)
    },
    prevTab: () => {
      if (tabs.length < 2) return
      const index = tabs.findIndex((tab) => tab.path === activePath)
      const next = tabs[(index - 1 + tabs.length) % tabs.length]
      if (next !== undefined) setActivePath(next.path)
    },
    shortcutsDialog: () => setShortcutsOpen((open) => open === false),
    shortcuts: () => {
      // 编辑器内 ⌘/ 是「切换行注释」（VS Code 一致），其他位置才打开快捷键列表
      const editorFocused = editorFocusedRef.current || (typeof G.isEditorFocused === 'function' && G.isEditorFocused())
      try {
        if (window.__gufaCmdSlashLogs === undefined) window.__gufaCmdSlashLogs = 20
        if (window.__gufaCmdSlashLogs > 0) {
          window.__gufaCmdSlashLogs -= 1
          const active = document.activeElement
          void G.api('dev.log', {
            message: `cmd-slash branch editorFocused=${editorFocused} active=${active === null || active === undefined ? 'null' : `${String(active.tagName ?? '?')}.${String(active.className ?? '').slice(0, 60)}`}`,
          }).catch(() => {})
        }
      } catch {
        /* ignore */
      }
      if (editorFocused) {
        try {
          const controller = G.__gufaEditorController
          if (controller !== null && controller !== undefined && typeof controller.comment === 'function') {
            const ok = controller.comment()
            void G.api('dev.log', { message: `cmd-slash comment-controller ok=${ok === true}` }).catch(() => {})
            return
          }
        } catch {
          /* 退回 bus 通道 */
        }
        G.bus.emit('editor:command', 'editor.action.commentLine')
        return
      }
      setShortcutsOpen((open) => open === false)
    },
  }), [activePath, tabs, ui.terminalOpen, ui.sidebarOpen, saveFile, saveCompareTab, patchUi, closeTabWithConfirm])
  G.useIdeShortcuts(ideShortcutHandlers)

  /* 原生快捷键服务派发到当前 App 的动作表（IDE 模式内有效）。 */
  useEffect(() => {
    const dispatch = (action) => {
      const handler = ideShortcutHandlers[action]
      if (typeof handler !== 'function') return
      handler()
      try {
        if (window.__gufaIdeFiredLogs === undefined) window.__gufaIdeFiredLogs = 30
        if (window.__gufaIdeFiredLogs > 0) {
          window.__gufaIdeFiredLogs -= 1
          void G.api('dev.log', { message: `ide-shortcut-fired ${action}` }).catch(() => {})
        }
      } catch {
        /* ignore */
      }
    }
    G.__ideShortcutDispatch = dispatch
    window.__gufaIdeShortcutDispatch = dispatch
    return () => {
      if (G.__ideShortcutDispatch === dispatch) G.__ideShortcutDispatch = null
      if (window.__gufaIdeShortcutDispatch === dispatch) window.__gufaIdeShortcutDispatch = null
    }
  }, [ideShortcutHandlers])

  /* 快捷键说明弹窗：Esc 关闭 */
  useEffect(() => {
    if (shortcutsOpen !== true) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setShortcutsOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shortcutsOpen])

  /* ── 渲染 ─────────────────────────────────────────────────────────── */
  const activityItems = [
    { id: 'explorer', icon: 'files', label: t('activity.explorer'), onClick: () => patchUi({ view: 'explorer', sidebarOpen: true }) },
    { id: 'git', icon: 'git', label: t('activity.git'), badge: gitStatus?.changes?.length ?? 0, onClick: () => { patchUi({ view: 'git', sidebarOpen: true }); setGitRefreshToken((token) => token + 1) } },
    { id: 'ssh', icon: 'server', label: t('activity.ssh'), onClick: () => { patchUi({ view: 'ssh', sidebarOpen: true }); setSshRefreshToken((token) => token + 1) } },
    { id: 'terminal', icon: 'terminal', label: t('activity.terminal'), active: ui.terminalOpen, onClick: () => patchUi({ terminalOpen: !ui.terminalOpen }) },
  ]

  const leftPanel = h(
    'div',
    { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
    h('div', { key: 'explorer', style: { display: ui.view === 'explorer' ? 'flex' : 'none', flex: '1 1 auto', minHeight: 0, flexDirection: 'column' } },
      h(G.Explorer, {
        root: project?.root ?? null,
        activePath,
        refreshToken,
        gitStatuses,
        onOpenFile: (path) => void openFile(path),
        onChanged: () => {
          setRefreshToken((token) => token + 1)
          setGitRefreshToken((token) => token + 1)
          void refreshGit()
        },
        onCompareFiles: (left, right) => void compareFiles(left, right),
        onNewFile: (dir) => setModal({ type: 'newFile', dir: dir ?? '' }),
        onNewFolder: (dir) => setModal({ type: 'newFolder', dir: dir ?? '' }),
        onRename: (path) => setModal({ type: 'rename', path }),
        onDelete: (path) => void deleteEntry(path),
      })),
    h('div', { key: 'git', style: { display: ui.view === 'git' ? 'flex' : 'none', flex: '1 1 auto', minHeight: 0, flexDirection: 'column' } },
      h(G.GitPanel, {
        root: project?.root ?? null,
        refreshToken: gitRefreshToken,
        onStatus: setGitStatus,
        onOpenFile: (path) => void openFile(path),
        onOpenDiff: (change) => void openDiffForChange(change),
        onOpenBranches: (event) => openBranchMenu(event),
        onOpenGraph: () => openGitGraph(),
        onChanged: () => { setRefreshToken((token) => token + 1) },
      })),
    h('div', { key: 'ssh', style: { display: ui.view === 'ssh' ? 'flex' : 'none', flex: '1 1 auto', minHeight: 0, flexDirection: 'column' } },
      h(G.SshPanel, { refreshToken: sshRefreshToken, onConnect: connectSsh })),
  )

  const editorTabs =
    tabs.length === 0
      ? null
      : h(
          'div',
          { className: 'gufa-tabs' },
          ...tabs.map((tab) =>
            h(
              'div',
              {
                key: tab.path,
                className: 'gufa-tab',
                'data-active': activePath === tab.path ? '' : undefined,
                role: 'tab',
                tabIndex: 0,
                title: tab.title !== undefined && tab.title !== null ? tab.title : tab.path,
                onClick: () => setActivePath(tab.path),
                onAuxClick: (event) => { if (event.button === 1) closeTabWithConfirm(tab.path) },
              },
              h(G.Icon, { name: 'file', size: 13 }),
              h('span', { className: 'gufa-tab-name' }, tab.title !== undefined && tab.title !== null ? tab.title : G.basename(tab.path)),
              problems[tab.path] !== undefined
                ? h('span', { className: 'gufa-tab-problem', 'data-level': problems[tab.path].errors > 0 ? undefined : 'warning' })
                : null,
              tab.dirty === true ? h('span', { className: 'gufa-tab-dot', title: t('status.dirty') }) : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'gufa-tab-close',
                  title: t('editor.close'),
                  onClick: (event) => { event.stopPropagation(); closeTabWithConfirm(tab.path) },
                },
                h(G.Icon, { name: 'close', size: 11 }),
              ),
            ),
          ),
        )

  const breadcrumb =
    activeTab === null
      ? null
      : h(
          'div',
          { className: 'gufa-breadcrumb' },
          ...String(activeTab.path).split('/').map((part, index) =>
            h('span', { key: `${part}:${index}`, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              index > 0 ? h(G.Icon, { name: 'chevron-right', size: 10 }) : null,
              index === String(activeTab.path).split('/').length - 1 ? h('b', null, part) : part,
            ),
          ),
        )

  const welcome =
    project === null
      ? h(
          'div',
          { className: 'gufa-empty' },
          h(G.Seal, { size: 64 }),
          h('div', { className: 'gufa-empty-title' }, t('app.noProject')),
          h('div', { className: 'gufa-empty-hint' }, t('app.noProjectHint')),
          bootError !== '' ? h('div', { className: 'gufa-error-banner', style: { margin: 0 } }, bootError) : null,
          h(
            'div',
            { className: 'gufa-row', style: { justifyContent: 'center', marginTop: 8 } },
            h(G.Button, { primary: true, icon: 'folder-open', onClick: () => void chooseAndOpenProject() }, t('app.openProject')),
            h(G.Button, { icon: 'plus', onClick: () => setModal({ type: 'newProject', parent: '', name: '' }) }, t('app.newProject')),
          ),
        )
      : null

  const cursorText =
    cursor !== null && cursor.path === activePath
      ? `${t('status.ln')} ${cursor.line}，${t('status.col')} ${cursor.column}`
      : ''

  const statusBranch = project?.isGit === true && gitStatus?.branch ? gitStatus.branch : null
  const lineCount = activeTab === null || activeTab.kind === 'graph' ? 0 : String(activeTab.content ?? '').split('\n').length

  return h(
    'div',
    {
      className: 'gufa-root',
      'data-backdrop': backdropActive ? 'on' : undefined,
      style: { '--gufa-dock-width': ui.chatOpen ? `${Math.round(chatWidth)}px` : '0px' },
    },
    backdropActive ? h(G.SkinBackdrop, { meta: skinBackdrop, enabled: true, strength: backdropStrength }) : null,
    h(
      'div',
      { className: 'gufa-shell' },
    /* 标题栏 */
    h(
      'div',
      { className: 'gufa-titlebar' },
      h(
        'div',
        { className: 'gufa-brand' },
        h(G.Seal, { size: 24, className: 'gufa-brand-logo' }),
        h('span', { className: 'gufa-brand-name' }, t('app.title')),
        h('span', { className: 'gufa-brand-sub' }, t('app.subtitle')),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'gufa-project',
          title: project !== null ? `${project.root} · ${t('app.switchWorkspace')}` : t('app.switchWorkspace'),
          onClick: () => void openWorkspaceDialog(),
        },
        h(G.Icon, { name: 'folder-open', size: 13 }),
        h('span', { className: 'gufa-project-name' }, project !== null ? project.name : t('app.noWorkspace')),
        project !== null && project.isGit === true ? h(G.Icon, { name: 'branch', size: 12 }) : null,
        h(G.Icon, { name: 'chevron-down', size: 11 }),
      ),
      h('div', { className: 'gufa-titlebar-spacer' }),
      h(
        'div',
        { className: 'gufa-titlebar-actions' },
        h(G.Button, { icon: 'plus', title: t('app.newWorkspace'), disabled: workspaceBusy, onClick: () => void createWorkspace() }, t('app.newWorkspace')),
        skinBackdrop.available === true && backdropActive
          ? h(G.BackdropStrengthSlider, {
              value: backdropStrength === null || backdropStrength === undefined ? Math.round((skinBackdrop.portraitOpacity ?? 1) * 100) : backdropStrength,
              onChange: (value) => {
                setBackdropStrength(value)
                G.backdropStrengthPref.set(value)
              },
              onReset: () => {
                setBackdropStrength(null)
                G.backdropStrengthPref.set(null)
              },
            })
          : null,
        skinBackdrop.available === true
          ? h(G.IconButton, {
              title: backdropActive ? t('app.backdropOff') : t('app.backdropOn'),
              'data-active': backdropActive ? '' : undefined,
              onClick: () => setBackdropOn((value) => {
                const next = !value
                G.backdropPref.set(next)
                return next
              }),
            }, h(G.Icon, { name: 'image', size: 16 }))
          : null,
        h(G.IconButton, { title: t('app.refresh'), onClick: () => { setRefreshToken((token) => token + 1); setGitRefreshToken((token) => token + 1); setSshRefreshToken((token) => token + 1) } }, h(G.Icon, { name: 'refresh', size: 15 })),
        h(G.IconButton, {
          title: ui.chatOpen ? t('activity.collapseChat') : t('activity.expandChat'),
          'data-active': ui.chatOpen ? '' : undefined,
          onClick: () => patchUi({ chatOpen: !ui.chatOpen }),
        }, h(G.Icon, { name: 'panel-right', size: 16 })),
        h(G.Button, { icon: 'arrow-left', title: t('app.exitHint'), onClick: exitMode }, t('app.exit')),
      ),
    ),
    /* 主体 */
    h(
      'div',
      { className: 'gufa-body' },
      h(
        'div',
        { className: 'gufa-activity' },
        ...activityItems.map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              className: 'gufa-activity-btn',
              'data-active': (item.active ?? (ui.view === item.id && item.id !== 'terminal' && item.id !== 'chat')) ? '' : undefined,
              title: item.label,
              'aria-label': item.label,
              onClick: item.onClick,
              style: { position: 'relative' },
            },
            h(G.Icon, { name: item.icon, size: 19 }),
            item.badge > 0 ? h('span', { className: 'gufa-badge', style: { position: 'absolute', top: 2, right: 2, fontSize: 9, minWidth: 14, height: 14 } }, String(item.badge)) : null,
          ),
        ),
        h('div', { className: 'gufa-activity-fill' }),
      ),
      /* 左面板（⌘B 可收起） */
      ui.sidebarOpen === false
        ? null
        : h(
            'div',
            { className: 'gufa-sidepanel', style: { width: explorerWidth } },
            h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } }, leftPanel),
          ),
      ui.sidebarOpen === false ? null : h('div', { className: 'gufa-splitter', onMouseDown: explorerDrag, title: '' }),
      /* 主列：编辑器 + 终端 */
      h(
        'div',
        { className: 'gufa-main' },
        h(
          'div',
          { className: 'gufa-main-row' },
          h(
            'div',
            { className: 'gufa-editor-area' },
            banner !== '' && bannerTone === 'success'
              ? h('div', { className: 'gufa-toast-success' }, h(G.Icon, { name: 'check', size: 13 }), h('span', null, banner))
              : null,
            banner !== '' && bannerTone !== 'success'
              ? h(
                  'div',
                  { className: 'gufa-error-banner' },
                  h(G.Icon, { name: 'warn', size: 13 }),
                  h('span', { style: { flex: '1 1 auto' } }, banner),
                  h(G.IconButton, { title: t('common.close'), onClick: () => setBanner('') }, h(G.Icon, { name: 'close', size: 12 })),
                )
              : null,
            hostStale ? h('div', { className: 'gufa-error-banner', style: { borderColor: 'var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)' } }, h(G.Icon, { name: 'warn', size: 13 }), h('span', { style: { flex: '1 1 auto' } }, t('app.hostStale')), h(G.IconButton, { title: t('common.close'), onClick: () => setHostStale(false) }, h(G.Icon, { name: 'close', size: 12 }))) : null,
            welcome ?? h(
              React.Fragment,
              null,
              editorTabs,
              breadcrumb,
              h(
                'div',
                { className: 'gufa-editor-host' },
                activeTab === null
                  ? h(G.Empty, { icon: 'seal', title: t('editor.noFile'), hint: t('editor.noFileHint') })
                  : activeTab.kind === 'graph'
                    ? h(G.GitGraphView, {
                        root: project?.root ?? null,
                        refreshToken: gitRefreshToken,
                        onRefresh: () => setGitRefreshToken((token) => token + 1),
                        onOpenCommitFile: (commit, file) => void openCommitFile(commit, file),
                      })
                  : h(G.EditorPane, {
                      tabs,
                      activePath,
                      theme,
                      palette: solidPalette,
                      root: project?.root ?? '',
                      onSelectTab: setActivePath,
                      onCloseTab: closeTabWithConfirm,
                      onChange: changeFile,
                      onSave: (path) => void saveFile(path),
                      backdropMode: backdropActive,
                      onCursor: (value) => setCursor({ ...value, lineCount }),
                    }),
              ),
            ),
          ),
        ),
        ui.terminalOpen
          ? h(
              React.Fragment,
              null,
              h('div', { className: 'gufa-hsplitter', onMouseDown: terminalDrag }),
              h(G.TerminalPane, {
                root: project?.root ?? null,
                visible: true,
                height: terminalHeight,
                theme,
                palette: solidPalette,
                onToggleHeight: () => patchUi({ terminalOpen: false }),
              }),
            )
          : null,
      ),
      /* 右侧 AI 对话 */
      ui.chatOpen
        ? h(
            React.Fragment,
            null,
            h('div', { className: 'gufa-splitter', onMouseDown: chatDrag }),
            h(
              'div',
              { className: 'gufa-chatpane', style: { width: chatWidth } },
              h(G.ChatDock, {
                project,
                activeFile: activeFileForChat,
                selection: selectionForChat,
                theme,
                width: chatWidth,
                active: true,
                paused: sessionsOpen,
                backdrop: backdropActive,
                sessionTitle,
                onOpenSessions: () => setSessionsOpen(true),
                onInsertCode: insertCode,
              }),
            ),
          )
        : null,
    ),
    /* 状态栏 */
    h(
      'div',
      { className: 'gufa-statusbar' },
      h(G.Icon, { name: 'code', size: 12 }),
      h('span', { className: 'gufa-status-item' }, project?.name ?? t('app.noProject')),
      statusBranch !== null
        ? h(
            'button',
            {
              type: 'button',
              className: 'gufa-status-item',
              title: t('git.branchSwitchHint'),
              style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '0 4px' },
              onClick: (event) => openBranchMenu(event),
            },
            h(G.Icon, { name: 'branch', size: 12 }),
            statusBranch,
            gitStatus?.ahead > 0 ? ` ↑${gitStatus.ahead}` : '',
            gitStatus?.behind > 0 ? ` ↓${gitStatus.behind}` : '',
            gitStatus?.changes?.length > 0 ? ` · ${gitStatus.changes.length}` : '',
          )
        : h('span', { className: 'gufa-status-item' }, t('status.noGit')),
      h('div', { className: 'gufa-status-fill' }),
      activeTab !== null ? h('span', { className: 'gufa-status-item' }, activeTab.title !== undefined && activeTab.title !== null ? activeTab.title : G.shortPath(activeTab.path, 56)) : null,
      activeTab !== null ? h('span', { className: 'gufa-status-item' }, `${lineCount} ${t('status.lines')}`) : null,
      activeTab !== null && problems[activeTab.path] !== undefined
        ? h('span', { className: 'gufa-status-item', style: { color: problems[activeTab.path].errors > 0 ? '#f85149' : '#e5c07b' } }, `${problems[activeTab.path].errors} ✕ ${problems[activeTab.path].warnings} ⚠`)
        : null,
      cursorText !== '' ? h('span', { className: 'gufa-status-item' }, cursorText) : null,
      activeTab !== null && activeTab.dirty === true ? h('span', { className: 'gufa-status-item', style: { color: 'var(--gufa-accent)' } }, t('status.dirty')) : null,
      activeTab !== null && activeTab.dirty !== true ? h('span', { className: 'gufa-status-item' }, G.Icon ? h(G.Icon, { name: 'check', size: 11 }) : null, t('status.saved')) : null,
      h('button', {
        type: 'button',
        className: 'gufa-status-item',
        title: t('shortcuts.title'),
        style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '0 4px' },
        onClick: () => setShortcutsOpen(true),
      }, G.isMacPlatform() ? '⌘/' : 'Ctrl+/'),
      h('span', { className: 'gufa-status-item' }, t('status.encoding')),
    ),
    ),
    typeof G.UsageDock === 'function' ? h(G.UsageDock, { active: true }) : null,
    workspaceDialog === null
      ? null
      : h(
          'div',
          {
            className: 'gufa-branch-dialog-backdrop',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) closeWorkspaceDialog()
            },
          },
          h(
            'div',
            { className: 'gufa-branch-dialog', onMouseDown: (event) => event.stopPropagation() },
            h(
              'div',
              { className: 'gufa-branch-dialog-head' },
              h(G.Icon, { name: 'folder-open', size: 14 }),
              h('span', { className: 'gufa-panel-head-title' }, t('workspace.title')),
              h('div', { style: { flex: '1 1 auto' } }),
              h(G.IconButton, { title: t('common.close'), onClick: closeWorkspaceDialog }, h(G.Icon, { name: 'close', size: 12 })),
            ),
            workspaceDialog.error !== ''
              ? h('div', { className: 'gufa-error-banner', style: { margin: '6px 10px' } }, workspaceDialog.error)
              : null,
            workspaceDialog.loading === true
              ? h('div', { className: 'gufa-graph-loading', style: { height: 90 } }, h(G.Spinner), t('common.loading'))
              : h(
                  'div',
                  { className: 'gufa-branch-dialog-list gufa-scroll' },
                  workspaceDialog.available !== true
                    ? h('div', { className: 'gufa-hint', style: { padding: '10px 8px' } }, t('workspace.unavailable'))
                    : workspaceDialog.workspaces.length === 0
                      ? h('div', { className: 'gufa-hint', style: { padding: '10px 8px' } }, t('workspace.empty'))
                      : workspaceDialog.workspaces.map((workspace) =>
                          h(
                            'button',
                            {
                              key: workspace.id,
                              type: 'button',
                              className: 'gufa-branch-row gufa-workspace-row',
                              'data-current': project !== null && project.root === workspace.path ? '' : undefined,
                              title: workspace.path,
                              onClick: () => void switchWorkspace(workspace),
                            },
                            h(G.Icon, { name: 'folder-open', size: 13 }),
                            h(
                              'span',
                              { className: 'gufa-branch-name' },
                              h('span', { className: 'gufa-workspace-title' }, workspace.title !== '' ? workspace.title : G.basename(workspace.path)),
                              h('span', { className: 'gufa-workspace-path' }, workspace.path),
                            ),
                            project !== null && project.root === workspace.path
                              ? h('span', { className: 'gufa-branch-tag' }, t('workspace.current'))
                              : null,
                          ),
                        ),
                ),
            h(
              'div',
              { className: 'gufa-branch-dialog-new' },
              h(G.Button, { icon: 'plus', primary: true, disabled: workspaceBusy, onClick: () => void createWorkspace() }, workspaceBusy ? t('common.loading') : t('workspace.create')),
            ),
          ),
        ),
    branchMenu === null
      ? null
      : h(
          'div',
          {
            className: 'gufa-branch-dialog-backdrop',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) closeBranchMenu()
            },
          },
          h(
            'div',
            { className: 'gufa-branch-dialog', onMouseDown: (event) => event.stopPropagation() },
            h(
              'div',
              { className: 'gufa-branch-dialog-head' },
              h(G.Icon, { name: 'branch', size: 14 }),
              h('span', { className: 'gufa-panel-head-title' }, t('git.branchesTitle')),
              h('span', { className: 'gufa-branch-dialog-current' }, gitStatus?.branch ? `当前：${gitStatus.branch}` : ''),
              h('div', { style: { flex: '1 1 auto' } }),
              h(G.IconButton, { title: t('common.close'), onClick: closeBranchMenu }, h(G.Icon, { name: 'close', size: 12 })),
            ),
            branchMenu.loading === true
              ? h('div', { className: 'gufa-graph-loading', style: { height: 80 } }, h(G.Spinner), t('common.loading'))
              : null,
            branchMenu.error !== ''
              ? h('div', { className: 'gufa-error-banner', style: { margin: '6px 10px' } }, branchMenu.error)
              : null,
            h(
              'div',
              { className: 'gufa-branch-dialog-list gufa-scroll' },
              ...(branchMenu.loading === true
                ? []
                : branchMenu.branches.map((branch) =>
                    h(
                      'button',
                      {
                        key: branch.name,
                        type: 'button',
                        className: 'gufa-branch-row',
                        'data-current': branch.current === true ? '' : undefined,
                        onClick: () => void checkoutBranch(branch.name),
                      },
                      h(G.Icon, { name: branch.current === true ? 'check' : 'branch', size: 13 }),
                      h('span', { className: 'gufa-branch-name' }, branch.name),
                      branch.current === true ? h('span', { className: 'gufa-branch-tag' }, t('git.branchCurrent')) : null,
                    ),
                  )),
            ),
            h(
              'div',
              { className: 'gufa-branch-dialog-new' },
              h('input', {
                className: 'gufa-input',
                value: branchInput,
                placeholder: t('git.branchNamePlaceholder'),
                spellCheck: false,
                onChange: (event) => setBranchInput(event.target.value),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void createBranch()
                },
                style: { flex: '1 1 auto', height: 28, fontSize: 12 },
              }),
              h(G.Button, { disabled: branchInput.trim() === '', primary: true, onClick: () => void createBranch() }, t('git.branchCreate')),
            ),
          ),
        ),
    /* 弹窗 */
    modal === null ? null : renderModal(),
    sessionsOpen ? renderSessionsDialog() : null,
    shortcutsOpen ? renderShortcutsDialog() : null,
  )

  function renderShortcutsDialog() {
    const close = () => setShortcutsOpen(false)
    return h(
      'div',
      { className: 'gufa-modal-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) close() } },
      h(
        'div',
        { className: 'gufa-modal gufa-shortcuts-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('shortcuts.title') },
        h(
          'div',
          { className: 'gufa-modal-head' },
          h(G.Icon, { name: 'keyboard', size: 14 }),
          h('span', { style: { flex: '1 1 auto' } }, t('shortcuts.title')),
          h(G.IconButton, { className: 'gufa-modal-close', title: t('common.close'), onClick: close }, h(G.Icon, { name: 'close', size: 14 })),
        ),
        h(
          'div',
          { className: 'gufa-modal-body', style: { gap: 0 } },
          G.SHORTCUTS.map((entry) =>
            h(
              'div',
              { key: entry.action, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '7px 2px', borderBottom: '0.5px solid var(--gufa-border)' } },
              h('span', { style: { flex: '1 1 auto', fontSize: 12.5 } }, t(entry.labelKey)),
              h('kbd', { className: 'gufa-kbd' }, G.shortcutKeyText(entry)),
            ),
          ),
          h('div', { style: { padding: '12px 2px 4px', fontSize: 11, opacity: 0.7, letterSpacing: 0.4 } }, t('shortcuts.editorTitle')),
          G.EDITOR_SHORTCUTS.map((entry) =>
            h(
              'div',
              { key: entry.labelKey, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 2px', borderBottom: '0.5px solid var(--gufa-border)' } },
              h('span', { style: { flex: '1 1 auto', fontSize: 12 } }, t(entry.labelKey)),
              h('kbd', { className: 'gufa-kbd' }, G.isMacPlatform() ? entry.mac : entry.other),
            ),
          ),
        ),
        h(
          'div',
          { className: 'gufa-modal-foot' },
          h(G.Button, { onClick: close }, t('common.close')),
        ),
      ),
    )
  }

  function renderSessionsDialog() {
    const close = () => setSessionsOpen(false)
    const localTitles = new Map()
    const localTimes = new Map()
    for (const row of recentSessionsRaw) {
      if (row === null || typeof row !== 'object' || typeof row.id !== 'string') continue
      localTitles.set(row.id, row.title)
      localTimes.set(row.id, row.when)
    }
    /* 只展示「当前工作区」的会话：以 Host 的工作区会话索引为准（与经典侧边栏同一份数据），
       客户端会话状态只用来补标题；Host 不可用时才回退到本地状态。 */
    const hostGroups = Array.isArray(workspaceSessions.groups) ? workspaceSessions.groups : []
    const currentRoot = project !== null && typeof project.root === 'string' ? project.root : ''
    const currentWorkspace = workspaceIndex.find((item) => item !== null && item.path === currentRoot)
    const currentWorkspaceId = currentWorkspace !== undefined && typeof currentWorkspace.id === 'string' ? currentWorkspace.id : ''
    const dialogPath = sessionWorkspacePath !== null && sessionWorkspacePath !== '' ? sessionWorkspacePath : currentRoot
    const dialogWorkspace = workspaceIndex.find((item) => item !== null && item.path === dialogPath)
    const dialogWorkspaceId = dialogWorkspace !== undefined && typeof dialogWorkspace.id === 'string' ? dialogWorkspace.id : ''
    const dialogWorkspaceTitle = dialogWorkspace !== undefined && typeof dialogWorkspace.title === 'string' && dialogWorkspace.title !== ''
      ? dialogWorkspace.title
      : dialogPath !== '' ? G.basename(dialogPath) : ''
    const hostGroup = hostGroups.find((group) => (dialogWorkspaceId !== '' ? group.workspaceId === dialogWorkspaceId : group.path === dialogPath))
    const localTitleById = new Map(
      recentSessionsRaw.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string').map((row) => [row.id, row.title]),
    )
    const localWhenById = new Map(
      recentSessionsRaw.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string').map((row) => [row.id, row.when]),
    )
    const membershipIds = Array.isArray(workspaceSessions.sessionIds) ? workspaceSessions.sessionIds : []
    const archivedSet = new Set(Array.isArray(workspaceSessions.archivedSessionIds) ? workspaceSessions.archivedSessionIds : [])
    const storeById = new Map(
      recentSessionsRaw.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string').map((row) => [row.id, row]),
    )
    /* Host 已经按经典侧边栏的可见性规则算好（成员/归档/subagent/blank/标题/排序），直接展示 */
    /* 经典侧边栏的手动排序保存在 dsh.workspace.view.v5 里，这里直接复用，保证顺序也一致 */
    let manualOrder = null
    try {
      const raw = window.localStorage.getItem('dsh.workspace.view.v5')
      if (raw !== null) {
        const view = JSON.parse(raw)
        if (view !== null && typeof view === 'object' && view.orderBy === 'manual' && view.sessionOrderByAccount !== null && typeof view.sessionOrderByAccount === 'object') {
          const key = workspaceSessions.workspaceId !== undefined && workspaceSessions.workspaceId !== '' ? workspaceSessions.workspaceId : ''
          const order = view.sessionOrderByAccount[key]
          if (Array.isArray(order)) manualOrder = order
        }
      }
    } catch {
      manualOrder = null
    }
    const hostRows = Array.isArray(workspaceSessions.sessions) ? workspaceSessions.sessions : []
    const mappedRows = hostRows.map((row) => ({
      id: row.id,
      title: typeof row.title === 'string' && row.title !== '' ? row.title : localTitleById.get(row.id) ?? `session-${String(row.id).slice(0, 4)}`,
      when: typeof row.updatedAt === 'number' && row.updatedAt > 0 ? row.updatedAt : localWhenById.get(row.id) ?? 0,
    }))
    const orderedRows = manualOrder !== null
      ? [
          ...manualOrder.map((id) => mappedRows.find((row) => row.id === id)).filter((row) => row !== undefined),
          ...mappedRows.filter((row) => !manualOrder.includes(row.id)),
        ]
      : mappedRows
    const sessionRows = hostRows.length > 0
      ? orderedRows
      : hostGroup !== undefined && Array.isArray(hostGroup.sessions)
        ? hostGroup.sessions.map((row) => ({
            id: row.id,
            title: typeof row.title === 'string' && row.title !== ''
            ? row.title
            : row.id === currentSessionId && (storeById.get(row.id)?.blank === true || localTitleById.get(row.id) === undefined)
              ? t('dock.newSession')
              : localTitleById.get(row.id) ?? `session-${String(row.id).slice(0, 4)}`,
            when: typeof row.updatedAt === 'number' && row.updatedAt > 0 ? row.updatedAt : localWhenById.get(row.id) ?? 0,
          }))
        : []
    // 保留最近作为「当前会话」出现过的会话（新建空白会话后 Host 列表可能暂时不包含上一个对话）
    const retained = []
    for (const id of recentCurrentIds) {
      if (sessionRows.some((row) => row.id === id) || retained.some((row) => row.id === id)) continue
      const fromStore = storeById.get(id)
      // 新建后没说过话的 blank 会话切走后不保留（经典模式同样是隐藏的）
      if (fromStore !== undefined && fromStore.blank === true) continue
      // 只保留属于当前工作区的会话（切换工作区后不要带出旧工作区的会话）
      if (fromStore !== undefined && typeof fromStore.workspaceId === 'string' && fromStore.workspaceId !== '' && workspaceSessions.workspaceId !== undefined && workspaceSessions.workspaceId !== '' && fromStore.workspaceId !== workspaceSessions.workspaceId) continue
      if (fromStore !== undefined && typeof fromStore.cwd === 'string' && fromStore.cwd !== '' && dialogPath !== '' && fromStore.cwd !== dialogPath) continue
      const title = localTitleById.get(id) ?? (fromStore !== undefined ? fromStore.title : '')
      if (typeof title !== 'string' || title === '') continue
      retained.push({ id, title, when: localWhenById.get(id) ?? (fromStore !== undefined ? fromStore.when : Date.now()) })
    }
    const rowsWithRetained = retained.length > 0 ? [...retained, ...sessionRows] : sessionRows
    // 当前会话无论如何都要在列表里（Host 偶发缺失时用本地摘要补上）
    const hostSessions = currentSessionId !== null && currentSessionId !== undefined && typeof currentSessionId === 'string' && currentSessionId !== '' && !rowsWithRetained.some((row) => row.id === currentSessionId)
      ? [{ id: currentSessionId, title: localTitleById.get(currentSessionId) ?? `session-${String(currentSessionId).slice(8, 12)}`, when: localWhenById.get(currentSessionId) ?? Date.now() }, ...rowsWithRetained]
      : rowsWithRetained
    const visibleSessions = hostSessions.length > 0
      ? hostSessions
      : recentSessionsRaw
          .filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string' && row.archived !== true)
          .filter((row) => {
            const root = typeof row.cwd === 'string' ? row.cwd : ''
            if (currentRoot !== '' && root !== '' && root !== currentRoot) return false
            return true
          })
          .map((row) => ({ id: row.id, title: row.title, when: row.when }))
    const renderSessionRow = (session, extraKey) =>
      h(
        'button',
        {
          key: extraKey,
          type: 'button',
          className: 'gufa-session-row',
          'data-current': session.id === currentSessionId ? '' : undefined,
          title: session.title,
          onClick: () => {
            close()
            openSessionInWorkspace(session.id, dialogPath)
          },
        },
        h(G.Icon, { name: 'message', size: 14 }),
        h('span', { className: 'gufa-session-row-title' }, session.title),
        typeof session.when === 'number' && session.when > 0 && typeof G.relativeTime === 'function'
          ? h('span', { className: 'gufa-session-row-when' }, G.relativeTime(session.when))
          : null,
      )
    try {
      if (window.__gufaSessionsDiag === undefined || window.__gufaSessionsDiag > 0) {
        window.__gufaSessionsDiag = (window.__gufaSessionsDiag ?? 3) - 1
        void G.api('dev.log', {
          message: `sessions-dialog root=${currentRoot} ws=${currentWorkspaceId} hostGroups=${hostGroups.length} hostGroupPath=${hostGroup?.path ?? ''} hostSessions=${hostSessions.length} store=${recentSessionsRaw.length} visible=${visibleSessions.length} titles=${visibleSessions.slice(0, 12).map((row) => String(row.title).slice(0, 16)).join(' / ')}`,
        }).catch(() => {})
      }
    } catch {
      /* ignore */
    }
    return h(
      'div',
      { className: 'gufa-session-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) close() } },
      h(
        'div',
        { className: 'gufa-modal gufa-session-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('dock.sessionsTitle') },
        h(
          'div',
          { className: 'gufa-modal-head' },
          h(G.Icon, { name: 'history', size: 14 }),
          h('span', { style: { flex: '1 1 auto' } }, t('dock.sessionsTitle')),
          project !== null
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'gufa-session-workspace gufa-session-workspace-btn',
                  title: '选择工作区（下方会话列表随之切换）',
                  onClick: () => setSessionWorkspacePicker((value) => !value),
                },
                h(G.Icon, { name: 'folder-open', size: 12 }),
                h('span', null, dialogWorkspaceTitle !== '' ? dialogWorkspaceTitle : project.name),
                h(G.Icon, { name: sessionWorkspacePicker ? 'chevron-up' : 'chevron-down', size: 12 }),
              )
            : null,
          h(G.IconButton, { className: 'gufa-modal-close', title: t('common.close'), onClick: close }, h(G.Icon, { name: 'close', size: 14 })),
        ),
        sessionWorkspacePicker
          ? h(
              'div',
              { className: 'gufa-session-workspace-picker gufa-scroll' },
              workspaceIndex.length === 0
                ? h('div', { className: 'gufa-hint', style: { padding: '8px 12px' } }, t('workspace.empty'))
                : workspaceIndex.map((workspace) =>
                    h(
                      'button',
                      {
                        key: workspace.id,
                        type: 'button',
                        className: 'gufa-session-workspace-option',
                        'data-current': dialogPath === workspace.path ? '' : undefined,
                        title: workspace.path,
                        onClick: () => {
                          setSessionWorkspacePath(workspace.path)
                          setSessionWorkspacePicker(false)
                        },
                      },
                      h(G.Icon, { name: 'folder-open', size: 13 }),
                      h('span', { className: 'gufa-session-workspace-option-title' }, workspace.title !== '' ? workspace.title : G.basename(workspace.path)),
                      h('span', { className: 'gufa-session-workspace-option-path' }, workspace.path),
                    ),
                  ),
            )
          : null,
        h(
          'div',
          { className: 'gufa-modal-body' },
          workspaceSessions.status === 'loading'
            ? h('div', { className: 'gufa-graph-loading', style: { height: 70 } }, h(G.Spinner), t('common.loading'))
            : visibleSessions.length === 0
            ? h('div', { className: 'gufa-hint' }, project !== null ? t('chat.noWorkspaceHistory') : t('chat.noHistory'))
            : visibleSessions.map((session) => renderSessionRow(session, session.id)),
        ),
        h(
          'div',
          { className: 'gufa-modal-foot' },
          h(G.Button, { icon: 'plus', onClick: () => { close(); startNewSessionInWorkspace(dialogPath) } }, t('dock.newSession')),
          h(G.Button, { onClick: close }, t('common.close')),
        ),
      ),
    )
  }

  function renderModal() {
    const cancel = () => { setModal(null); setModalError('') }
    if (modal.type === 'newProject') {
      return h(
        G.Modal,
        {
          title: t('app.newProject'),
          submitLabel: t('app.create'),
          onCancel: cancel,
          pending: modalPending,
          error: modalError,
          onSubmit: () => void submitModal(),
        },
        () =>
          h(
            React.Fragment,
            null,
            h('label', { className: 'gufa-hint' }, t('app.parentFolder')),
            h(
              'div',
              { className: 'gufa-row' },
              h('input', {
                className: 'gufa-input',
                value: modal.parent ?? '',
                placeholder: '/Users/me/projects',
                onChange: (event) => setModal((current) => ({ ...current, parent: event.target.value })),
              }),
              h(G.Button, { onClick: () => void chooseParentForNewProject() }, t('app.chooseFolder')),
            ),
            h('label', { className: 'gufa-hint' }, t('app.projectName')),
            h('input', {
              className: 'gufa-input',
              autoFocus: true,
              value: modal.name ?? '',
              placeholder: 'my-project',
              onChange: (event) => setModal((current) => ({ ...current, name: event.target.value })),
              onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); void submitModal() } },
            }),
          ),
      )
    }
    if (modal.type === 'openPath') {
      return h(G.Modal, {
        title: t('app.openProject'),
        description: t('app.manualPath'),
        placeholder: t('app.pathPlaceholder'),
        submitLabel: t('app.openFolder'),
        onCancel: cancel,
        onSubmit: (value) => void submitModal(value),
        pending: modalPending,
        error: modalError,
      })
    }
    if (modal.type === 'newFile' || modal.type === 'newFolder') {
      const isFile = modal.type === 'newFile'
      return h(G.Modal, {
        title: isFile ? t('explorer.newFile') : t('explorer.newFolder'),
        description: modal.dir ? `${t('app.parentFolder')}：${modal.dir}` : undefined,
        placeholder: isFile ? t('explorer.fileName') : t('explorer.folderName'),
        submitLabel: t('app.create'),
        onCancel: cancel,
        onSubmit: (value) => void submitModal(value),
        pending: modalPending,
        error: modalError,
      })
    }
    if (modal.type === 'rename') {
      return h(G.Modal, {
        title: t('explorer.rename'),
        description: modal.path,
        initialValue: G.basename(modal.path),
        submitLabel: t('common.rename'),
        onCancel: cancel,
        onSubmit: (value) => void submitModal(value),
        pending: modalPending,
        error: modalError,
      })
    }
    if (modal.type === 'delete') {
      return h(G.Modal, {
        title: t('explorer.delete'),
        description: t('explorer.deleteConfirm', { name: modal.path }),
        submitLabel: t('common.delete'),
        onCancel: cancel,
        onSubmit: () => void submitModal(''),
        pending: modalPending,
        error: modalError,
        children: () => h('div', { className: 'gufa-hint' }, modal.path),
      })
    }
    if (modal.type === 'closeTab') {
      return h(G.Modal, {
        title: t('editor.close'),
        description: modal.path,
        submitLabel: t('common.close'),
        onCancel: cancel,
        onSubmit: () => void submitModal(''),
        pending: modalPending,
        error: modalError,
        children: () => h('div', { className: 'gufa-hint' }, t('status.dirty')),
      })
    }
    return null
  }
}


/* ─────────────────────── 99-main.js ─────────────────────── */
/**
 * 99-main：client 模块装配 —— 注册「古法编程」侧边栏按钮与 main 面板。
 * 这是 build-client.mjs 拼接的最后一个文件，factory 必须在这里返回插件对象。
 */
/**
 * 把「古法编程」作为一行注入到工作区行的「...」菜单里（第二个位置）。
 * DSH 的 workspace 菜单没有可用的 slot，只能在菜单弹出后克隆原生菜单项注入。
 * 菜单是复用的 portal 容器，打开时不产生 childList 变化，因此用点击/指针事件 + 轮询兜底触发扫描。
 */
G.installWorkspaceMenuEntry = function installWorkspaceMenuEntry(ctx) {
  if (typeof document === 'undefined') return () => {}
  let lastWorkspaceKey = ''
  let observer = null
  let scanTimer = 0
  let pollTimer = 0
  let diagLogged = false

  const log = (message) => {
    try {
      void G.api('dev.log', { message: `menu-entry ${message}` }).catch(() => {})
    } catch {
      /* ignore */
    }
  }

  const removeInjected = () => {
    for (const node of Array.from(document.querySelectorAll('[data-gufa-workspace-menu]'))) node.remove()
  }

  const labelOf = () => {
    try {
      return G.t('panel.label')
    } catch {
      return '古法编程'
    }
  }

  const isRenameText = (text) => text === '重命名' || /^rename$/i.test(text)
  const isDeleteText = (text) => text.includes('删除工作区') || /delete workspace/i.test(text)

  /** 找文本最深匹配的元素（避免选中包含图标的父容器）。 */
  const deepestByText = (scope, predicate) => {
    let best = null
    for (const element of Array.from(scope.querySelectorAll('*'))) {
      const text = (element.textContent ?? '').trim()
      if (text !== '' && predicate(text)) best = element
    }
    return best
  }

  /** 同时包含「重命名 / 删除工作区」的最小容器。 */
  const findWorkspaceMenu = () => {
    for (const menu of Array.from(document.querySelectorAll('[role="menu"]'))) {
      const text = menu.textContent ?? ''
      if (isDeleteText(text) && /重命名|rename/i.test(text)) return menu
    }
    for (const element of Array.from(document.body.querySelectorAll('div,ul,section'))) {
      const text = element.textContent ?? ''
      if (!isDeleteText(text) || !/重命名|rename/i.test(text)) continue
      let deeper = false
      for (const child of Array.from(element.children)) {
        const childText = child.textContent ?? ''
        if (isDeleteText(childText) && /重命名|rename/i.test(childText)) {
          deeper = true
          break
        }
      }
      if (!deeper) return element
    }
    return null
  }

  const injectInto = (menu) => {
    if (menu.querySelector('[data-gufa-workspace-menu]') !== null) return true
    const renameEl = deepestByText(menu, isRenameText)
    const deleteEl = deepestByText(menu, isDeleteText)
    if (renameEl === null || deleteEl === null) return false
    /* 两个菜单项的最近公共父节点 = 菜单列表容器 */
    let list = renameEl.parentElement
    while (list !== null && !list.contains(deleteEl)) list = list.parentElement
    if (list === null) return false
    /* 从列表容器向上找一层得到完整的菜单项（含原生图标与内边距），而不是只克隆文字节点 */
    const liftToItem = (target) => {
      let item = target
      while (item.parentElement !== null && item.parentElement !== list) item = item.parentElement
      return item
    }
    const renameItem = liftToItem(renameEl)
    const deleteItem = liftToItem(deleteEl)
    const row = renameItem.cloneNode(true)
    row.setAttribute('data-gufa-workspace-menu', '')
    /* 换标签：只替换最深的纯文本元素，保留原生图标 */
    const label = deepestByText(row, isRenameText)
    if (label !== null && label.children.length === 0) label.textContent = labelOf()
    else row.textContent = labelOf()
    row.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void enterFromWorkspace(lastWorkspaceKey)
    }, true)
    try {
      list.insertBefore(row, deleteItem)
    } catch {
      return false
    }
    return true
  }

  const enterFromWorkspace = async (workspaceKey) => {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } catch {
      /* ignore */
    }
    G.pendingEntryWorkspace = typeof workspaceKey === 'string' && workspaceKey !== '' ? { key: workspaceKey } : null
    window.setTimeout(() => {
      try {
        G.enterGufa()
      } catch (error) {
        console.error('[gufa-code] 从工作区菜单进入失败', error)
      }
    }, 120)
  }

  const scan = () => {
    try {
      const menu = findWorkspaceMenu()
      if (menu === null) return
      const injected = injectInto(menu)
      if (!diagLogged) {
        diagLogged = true
        log(`diag roleMenus=${document.querySelectorAll('[role="menu"]').length} injected=${injected}`)
      }
    } catch (error) {
      if (!diagLogged) {
        diagLogged = true
        log(`diag error=${String(error && error.message ? error.message : error)}`)
      }
    }
  }

  const scheduleScan = (delayMs) => {
    if (scanTimer !== 0) return
    scanTimer = window.setTimeout(() => {
      scanTimer = 0
      scan()
    }, typeof delayMs === 'number' ? delayMs : 50)
  }

  const onPointer = (event) => {
    scheduleScan(60)
    scheduleScan(220)
    try {
      const target = event.target
      const row = target !== null && target !== undefined && typeof target.closest === 'function'
        ? target.closest('[data-row-key^="workspace:"]')
        : null
      if (row !== null) lastWorkspaceKey = String(row.getAttribute('data-row-key') ?? '').slice('workspace:'.length)
    } catch {
      /* ignore */
    }
  }

  removeInjected()
  document.addEventListener('click', onPointer, true)
  document.addEventListener('pointerdown', onPointer, true)
  try {
    observer = new MutationObserver(() => scheduleScan(60))
    observer.observe(document.body, { childList: true, subtree: true })
  } catch {
    observer = null
  }
  pollTimer = window.setInterval(() => {
    try {
      if (typeof G.mode?.get === 'function' && G.mode.get() === true) return
      if (document.querySelector('[role="menu"]') !== null) scan()
    } catch {
      /* ignore */
    }
  }, 500)
  return () => {
    if (pollTimer !== 0) window.clearInterval(pollTimer)
    pollTimer = 0
    if (observer !== null) observer.disconnect()
    observer = null
    if (scanTimer !== 0) window.clearTimeout(scanTimer)
    scanTimer = 0
    document.removeEventListener('click', onPointer, true)
    document.removeEventListener('pointerdown', onPointer, true)
    removeInjected()
  }
}

/** 「更多」菜单里的入口行：点击进入古法编程（从当前工作区进入）。 */
G.MoreMenuEntry = function MoreMenuEntry(props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'gufa-more-entry',
      role: 'menuitem',
      onClick: () => {
        try {
          props.onDismiss?.()
        } catch {
          /* ignore */
        }
        G.enterGufa()
      },
    },
    h(G.Icon, { name: 'seal', size: 16 }),
    h('span', { className: 'gufa-more-entry-label' }, G.t('panel.label')),
  )
}

const GUFA_PLUGIN = {
  inject: [],
  apply(ctx) {
    G.ctx = ctx

    /* HMR 重载时如果仍处于 IDE 模式，重新打上标记（卸载清理会移除它） */
    try {
      if (typeof G.mode?.get === 'function' && G.mode.get() === true) document.documentElement.setAttribute('data-gufa-ide', '')
    } catch {
      /* ignore */
    }

    /* ── 清理「每会话右侧面板布局」里由 dsh-vscode-mode 留下的『文件编辑』标签 ──
     * 官方右侧栏会把每个会话的布局持久化到 localStorage（键 dsh.sidebar-right.v1.<sessionId>），
     * 切换会话时恢复该布局 → 历史上被 vscode-mode 写过标签的会话会「自动展开右侧栏」。
     * 这里在页面加载后清理这些残留键，让会话恢复成默认（收起）状态。 */
    const cleanStaleSidebarLayouts = () => {
      try {
        const keys = []
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index)
          if (key !== null && key.startsWith('dsh.sidebar-right.v1.')) keys.push(key)
        }
        let removed = 0
        for (const key of keys) {
          const raw = window.localStorage.getItem(key)
          if (raw === null) continue
          if (raw.includes('edrvEditor') || raw.includes('vscode-mode')) {
            window.localStorage.removeItem(key)
            removed += 1
          }
        }
        if (removed > 0) {
          void G.api('dev.log', { message: `sidebar-layout-cleanup removed=${removed}/${keys.length}` }).catch(() => {})
        }
      } catch {
        /* localStorage 不可用时忽略 */
      }
    }
    cleanStaleSidebarLayouts()
    window.setTimeout(cleanStaleSidebarLayouts, 1500)
    window.setTimeout(cleanStaleSidebarLayouts, 5000)

    // 聊天框：粘贴系统文件 → 自动插入 @文件引用（内容匹配项目内文件后插入）
    try {
      if (typeof G.installChatFilePaste === 'function') {
        const disposeChatPaste = G.installChatFilePaste(ctx)
        if (typeof disposeChatPaste === 'function') ctx.effect(() => disposeChatPaste, 'gufa-code: chat file paste')
      }
    } catch (error) {
      console.error('[gufa-code] 安装聊天框文件粘贴失败', error)
    }

    // 样式（随插件 context 卸载自动移除）
    ctx.effect(() => G.injectStyles(), 'gufa-code: styles')

    // 文案：注册进 Client locale 服务；缺服务时保持内置中文
    const locale = ctx.get('locale')
    if (locale !== undefined && locale !== null) {
      try {
        ctx.effect(() => locale.register(GUFA_NS, { zh: DICT_ZH, en: DICT_EN }), 'gufa-code: locale')
        const bound = locale.bind(GUFA_NS)
        G.t = (key, params) => bound(key, params)
        G.translate = G.t
      } catch (error) {
        console.error('[gufa-code] 注册文案失败，使用内置中文', error)
      }
    }

    // 启动诊断：记录页面地址、真实 Host 基址与传输信息（排查桌面壳 dsh-app:// 连接问题）。
    try {
      const transport = typeof globalThis.__DSH_TRANSPORT__ === 'object' && globalThis.__DSH_TRANSPORT__ !== null ? globalThis.__DSH_TRANSPORT__ : null
      void G.api('dev.log', {
        message: `boot href=${location.href} base=${G.serverBase()} transport=${transport === null ? 'none' : JSON.stringify(transport)}`,
      }).catch(() => {})
    } catch {
      /* 诊断失败不影响启动 */
    }

    // 全局错误捕获：渲染/事件/异步异常都写入诊断日志（排查「切不进去」）。
    try {
      if (window.__gufaErrorHooks !== true) {
        window.__gufaErrorHooks = true
        let errorLogs = 30
        const logError = (kind, detail) => {
          if (errorLogs <= 0) return
          errorLogs -= 1
          try {
            void G.api('dev.log', { message: `${kind} ${String(detail).slice(0, 2000)}` }).catch(() => {})
          } catch {
            /* ignore */
          }
        }
        window.addEventListener('error', (event) => {
          const error = event && event.error
          logError('window-error', `${event && event.message ? event.message : ''} | ${error && error.stack ? error.stack : ''}`)
        })
        window.addEventListener('unhandledrejection', (event) => {
          const reason = event && event.reason
          logError('unhandled-rejection', reason && reason.stack ? reason.stack : String(reason))
        })
      }
    } catch {
      /* ignore */
    }

    // IDE 快捷键：接入 DSH 原生快捷键派发（只做命令改派，不修改其定义/配置），
    // 另外安装 DOM 兜底桥（给未被原生拦截的组合用）。
    try {
      if (typeof G.installShortcutIntegration === 'function' && typeof ctx.inject === 'function') {
        ctx.inject(['shortcuts'], (scope) => {
          try {
            let service
            try {
              service = typeof scope.get === 'function' ? scope.get('shortcuts') : scope.shortcuts
            } catch {
              service = undefined
            }
            if (service !== undefined && service !== null) G.installShortcutIntegration(service)
          } catch (error) {
            console.error('[gufa-code] 安装原生快捷键集成失败', error)
          }
          try {
            if (typeof G.installShortcutBridge === 'function') G.installShortcutBridge()
          } catch (error) {
            console.error('[gufa-code] 安装快捷键桥失败', error)
          }
        })
      }
    } catch (error) {
      console.error('[gufa-code] 快捷键服务不可用', error)
    }

    // 编辑器焦点/命令通道自检（每个页面会话一次，只读安全：只做聚焦 + 全选）
    try {
      if (window.sessionStorage.getItem('gufa-editor-focus-selftest-v2') !== '1') {
        window.sessionStorage.setItem('gufa-editor-focus-selftest-v2', '1')
        let attempts = 0
        const runSelfTest = () => {
          attempts += 1
          try {
            const debug = G.__gufaEditorDebug
            if (debug === undefined || debug === null) {
              if (attempts < 40) {
                window.setTimeout(runSelfTest, 500)
                return
              }
              void G.api('dev.log', { message: 'editor-focus-selftest no-editor-open' }).catch(() => {})
              return
            }
            debug.focus()
            window.setTimeout(() => {
              try {
                const active = document.activeElement
                const focused = typeof G.isEditorFocused === 'function' ? G.isEditorFocused() : '?'
                const hasText = typeof debug.hasTextFocus === 'function' ? debug.hasTextFocus() : '?'
                G.bus.emit('editor:command', 'editor.action.selectAll')
                void G.api('dev.log', {
                  message: `editor-focus-selftest isEditorFocused=${focused} hasTextFocus=${hasText} controller=${G.__gufaEditorController !== null && G.__gufaEditorController !== undefined} active=${active === null || active === undefined ? 'null' : `${String(active.tagName ?? '?')}.${String(active.className ?? '').slice(0, 60)}`}`,
                }).catch(() => {})
              } catch (error) {
                void G.api('dev.log', { message: `editor-focus-selftest-error ${String(error)}` }).catch(() => {})
              }
            }, 200)
          } catch (error) {
            void G.api('dev.log', { message: `editor-focus-selftest-error ${String(error)}` }).catch(() => {})
          }
        }
        window.setTimeout(runSelfTest, 2000)
      }
    } catch {
      /* 自检失败不影响启动 */
    }

    // 终端 PTY 自检（每个页面会话一次）：确认 Live Host 的 spawnTerminal 能出数据。
    try {
      if (window.sessionStorage.getItem('gufa-code-probe') !== '1') {
        window.sessionStorage.setItem('gufa-code-probe', '1')
        window.setTimeout(() => {
          void G.api('terminal.probe', {})
            .then((value) => G.api('dev.log', { message: `terminal-probe ${JSON.stringify(value).slice(0, 3000)}` }))
            .catch((error) => G.api('dev.log', { message: `terminal-probe-failed ${G.errorText(error)}` }))
            .catch(() => {})
        }, 800)
      }
    } catch {
      /* 自检失败不影响启动 */
    }

    // Host 半版本探针：新 Host 有 dev.version；旧 Host 返回 not-found。
    // 注册一个空的 overlay 条目（id 带版本状态），便于通过 Client Inspect 验证当前 Host 代际。
    void G.api('dev.version', {})
      .then(() => 'ok')
      .catch(() => 'stale')
      .then((hostState) => {
        try {
          ctx.inject(['slots'], (scope) => {
            scope.slots.inject('shell.overlay', () => scope.slots.register({
              name: 'shell.overlay',
              id: `gufa-code-host-${hostState}`,
              order: 999,
            }, () => null))
          })
        } catch (error) {
          console.error('[gufa-code] 注册 Host 探针失败', error)
        }
      })

    // 开启滑动变祖的「31 档细分」：让外观滑块/背景停在松手位置，只有思考等级提交最近档位。
    try {
      const fineResult = typeof G.ensureSkinFineStops === 'function' ? G.ensureSkinFineStops() : { applied: false }
      if (fineResult.applied === true) console.info('[gufa-code] 已开启滑动变祖「31 档细分」（思考等级仍按最近真实档位提交）')
    } catch (error) {
      console.error('[gufa-code] 开启「31 档细分」失败', error)
    }

    // 梁圣皮肤背景诊断探针：延迟读取一次皮肤背景状态，注册空 overlay 条目便于 Inspect 验证。
    window.setTimeout(() => {
      try {
        const meta = typeof G.readSkinBackdropMeta === 'function' ? G.readSkinBackdropMeta() : { available: false }
        const probeId = meta.available === true
          ? (meta.portraitSrc ? 'gufa-code-backdrop-portrait' : 'gufa-code-backdrop-color')
          : 'gufa-code-backdrop-missing'
        ctx.inject(['slots'], (scope) => {
          scope.slots.inject('shell.overlay', () => scope.slots.register({
            name: 'shell.overlay',
            id: probeId,
            order: 998,
          }, () => null))
          const fine = typeof G.readSkinFineStops === 'function' && G.readSkinFineStops() === true
          scope.slots.inject('shell.overlay', () => scope.slots.register({
            name: 'shell.overlay',
            id: `gufa-code-skin-fine-${fine ? 'on' : 'off'}`,
            order: 997,
          }, () => null))
        })
      } catch (error) {
        console.error('[gufa-code] 注册背景探针失败', error)
      }
    }, 2500)

    // 入口：工作区行的「...」菜单里注入「古法编程」一行。
    try {
      const disposeMenuEntry = G.installWorkspaceMenuEntry(ctx)
      if (typeof disposeMenuEntry === 'function') ctx.effect(() => disposeMenuEntry, 'gufa-code: workspace menu entry')
    } catch (error) {
      console.error('[gufa-code] 安装工作区菜单入口失败', error)
    }

    // 面板注册：入口注入到工作区行的「...」菜单里（DSH 未提供该菜单的 slot）。
    ctx.inject(['slots'], (scope) => {
      // main key 仅作安全网：若侧边栏把主面板切到 gufa-code（点击拦截失效时），
      // MainRedirect 会立刻进入覆盖层并把主视图还原成官方会话。
      scope.slots.inject('main', () => scope.slots.register({
        name: 'main',
        key: G.PANEL_ID,
      }, G.MainRedirect))
      // 全屏 IDE 覆盖层：官方会话面板在底下保持挂载，右侧 AI 栏由 60-dock 停靠复用。
      scope.slots.inject('shell.overlay', () => scope.slots.register({
        name: 'shell.overlay',
        id: 'gufa-code-overlay',
        order: 100,
      }, G.OverlayHost))
    })
  },
}

// 浏览器控制台调试句柄（不影响注册；页面刷新后重建）
try {
  if (typeof window !== 'undefined') window.__GUFA_CODE__ = { version: '1.0.0', G, plugin: GUFA_PLUGIN }
} catch {
  /* 忽略只读 window */
}

return GUFA_PLUGIN

  },
})

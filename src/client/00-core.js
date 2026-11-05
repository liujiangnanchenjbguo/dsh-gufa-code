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
.gufa-workspace-row-wrap{display:flex;align-items:center;gap:4px}
.gufa-workspace-row-wrap .gufa-workspace-row{flex:1 1 auto;min-width:0}
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

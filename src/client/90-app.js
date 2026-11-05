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

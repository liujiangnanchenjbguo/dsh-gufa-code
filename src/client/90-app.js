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
  const [floatRunning, setFloatRunning] = useState(false)
  const [floatBusy, setFloatBusy] = useState(false)
  /* 摸鱼窗口选择器：null | {status:'loading'|'ready'|'permission'|'error', windows:[], error:''} */
  const [floatPicker, setFloatPicker] = useState(null)
  /* 摸鱼自检：null | {status:'loading'|'ok'|'error', data:null|object, error:''} */
  const [floatDoctor, setFloatDoctor] = useState(null)
  /* 自检「保存报告」的结果路径/错误（显示在弹窗底部） */
  const [floatReport, setFloatReport] = useState('')
  /* 摸鱼模式（悬浮窗实例）与界面透明度 */
  const [moyuMode] = useState(() => G.isFloatMode())
  const [floatAlpha, setFloatAlpha] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('gufa-code:float-alpha'))
      if (Number.isFinite(saved) && saved >= 20 && saved <= 100) return Math.round(saved)
    } catch {
      /* ignore */
    }
    return 55
  })
  useEffect(() => {
    try {
      document.documentElement.style.setProperty('--gufa-float-alpha', String(floatAlpha / 100))
      localStorage.setItem('gufa-code:float-alpha', String(floatAlpha))
    } catch {
      /* ignore */
    }
    /* 摸鱼窗口里调整透明度时同步到 Host，下次新建摸鱼窗口沿用 */
    if (moyuMode) {
      const timer = window.setTimeout(() => {
        void G.api('float.setPrefs', { alpha: floatAlpha }).catch(() => {})
      }, 400)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [floatAlpha, moyuMode])
  /* 摸鱼窗口启动时优先使用 Host 偏好里的透明度 */
  useEffect(() => {
    if (!moyuMode) return
    let cancelled = false
    void (async () => {
      try {
        const prefs = await G.api('float.getPrefs')
        const alpha = Number(prefs?.alpha)
        if (!cancelled && Number.isFinite(alpha) && alpha >= 20 && alpha <= 100) setFloatAlpha(Math.round(alpha))
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [moyuMode])
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

  /* 摸鱼窗口：主窗口注入的状态（项目/UI/标签页/会话） */
  const floatState = G.floatState
  const appInstanceId = useRef(0)
  if (appInstanceId.current === 0) {
    appInstanceId.current = Math.random().toString(36).slice(2, 8)
    void G.api('dev.log', { message: `app-mount id=${appInstanceId.current} float=${G.isFloatMode()} href=${String(location.href).slice(0, 80)}` }).catch(() => {})
  }
  const [ui, setUi] = useState(() => {
    const fromFloat = floatState !== null && floatState !== undefined && floatState.ui !== null && typeof floatState.ui === 'object' ? floatState.ui : null
    const saved = fromFloat ?? readJson(GUFA_LS.ui) ?? {}
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
  /* 选区（给右侧 AI 用）单独更新；光标位置/行数走 G.cursorStore，避免每次按键重渲染整个 IDE。 */
  const [selection, setSelection] = useState(null)
  /* 编辑器内容缓冲：Monaco 每次按键只写这里，300ms 停顿后才同步进 tabs（保存/自动保存直接读缓冲）。 */
  const editorBuffersRef = useRef(new Map())
  const tabsRef = useRef([])
  const flushTimerRef = useRef(null)
  const selectionTimerRef = useRef(null)
  const pendingSelectionRef = useRef(null)
  const flushBuffersRef = useRef(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [gitRefreshToken, setGitRefreshToken] = useState(0)
  const [sshRefreshToken, setSshRefreshToken] = useState(0)
  const [gitStatus, setGitStatus] = useState(null)
  const gitSignatureRef = useRef('')
  const gitInFlightRef = useRef(false)
  const [modal, setModal] = useState(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [definitionPicker, setDefinitionPicker] = useState(null)
  const [trashUndo, setTrashUndo] = useState([])
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
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

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
    setSelection(null)
    editorBuffersRef.current.clear()
    if (flushTimerRef.current !== null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
    G.cursorStore.set(null)
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
      /* 从工作区菜单点进来的：跳过「恢复上次项目」，直接按入口工作区打开 */
      const pendingEntry = G.pendingEntryWorkspace
      if (pendingEntry !== null && pendingEntry !== undefined && typeof pendingEntry.key === 'string') {
        try {
          const listValue = await G.api('workspaces.list', {})
          const list = Array.isArray(listValue?.workspaces) ? listValue.workspaces : []
          const matched = list.find((item) => item !== null && item.id === pendingEntry.key)
          if (matched !== undefined && typeof matched.path === 'string' && matched.path !== '') {
            const value = await G.api('project.open', { path: matched.path })
            if (!cancelled) applyProject(value)
            return
          }
        } catch {
          /* 回落到恢复上次项目 */
        }
      }
      const saved = floatState !== null && floatState !== undefined && typeof floatState.projectRoot === 'string' && floatState.projectRoot !== ''
        ? floatState.projectRoot
        : readJson(GUFA_LS.project)
      if (typeof saved === 'string' && saved !== '') {
        try {
          const value = await G.api('project.open', { path: saved })
          if (!cancelled) applyProject(value)
          return
        } catch {
          writeJson(GUFA_LS.project, null)
        }
      }
      if (G.isFloatMode()) return
      /* 实例窗口不继承当前项目，等用户自己新建/打开工作区 */
      if (G.instanceBoot === true) return
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
      gitSignatureRef.current = ''
      return
    }
    if (gitInFlightRef.current) return
    gitInFlightRef.current = true
    try {
      const value = await G.api('git.status', { root: project.root })
      setGitStatus(value)
      /* 轮询时如果发现工作区状态变化（AI/外部修改了文件），顺带刷新资源管理器与 Git 面板 */
      const signature = JSON.stringify({
        branch: value?.branch ?? '',
        changes: (Array.isArray(value?.changes) ? value.changes : [])
          .map((change) => `${String(change?.path ?? '')}:${String(change?.status ?? '')}`)
          .sort(),
      })
      const previous = gitSignatureRef.current
      gitSignatureRef.current = signature
      if (previous !== '' && previous !== signature) {
        setRefreshToken((token) => token + 1)
        setGitRefreshToken((token) => token + 1)
      }
    } catch {
      setGitStatus(null)
    } finally {
      gitInFlightRef.current = false
    }
  }, [project])

  useEffect(() => {
    void refreshGit()
  }, [refreshGit, gitRefreshToken])

  /* AI/外部进程改了文件时，Git 面板与资源管理器要能自动出现标识，不需要手动点 Git 按钮。
     - 3.5s 轮询 git.status（窗口可见时）；状态签名变化 → 刷新 Git 面板 + 资源管理器
     - 非 Git 项目：6s 静默重读已加载目录，至少能看到外部新建/删除的文件 */
  useEffect(() => {
    if (project === null) return undefined
    const tickGit = () => {
      if (document.visibilityState !== 'visible') return
      void refreshGit()
    }
    const tickTree = () => {
      if (document.visibilityState !== 'visible') return
      if (project.isGit !== true) setRefreshToken((token) => token + 1)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshGit()
    }
    const gitTimer = window.setInterval(tickGit, 3500)
    const treeTimer = window.setInterval(tickTree, 6000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(gitTimer)
      window.clearInterval(treeTimer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [project, refreshGit])

  const gitStatuses = useMemo(() => {
    const map = {}
    for (const change of gitStatus?.changes ?? []) map[change.path] = change.status
    return map
  }, [gitStatus])

  /* 暂存/取消暂存/提交后，已失效的 diff 标签自动关闭：
     工作树 diff 只在文件仍有未暂存改动时有效，暂存区 diff 只在文件仍在暂存区时有效。 */
  useEffect(() => {
    if (project === null || project.isGit !== true || gitStatus === null) return
    const changes = Array.isArray(gitStatus.changes) ? gitStatus.changes : []
    const stagedPaths = new Set(changes.filter((item) => item?.staged === true).map((item) => item.path))
    const unstagedPaths = new Set(changes.filter((item) => item?.staged !== true).map((item) => item.path))
    const current = tabsRef.current ?? []
    const kept = current.filter((tab) => {
      if (tab === null || tab === undefined || tab.kind !== 'diff') return true
      if (tab.diff === null || tab.diff === undefined || tab.diff.compare === true) return true
      if (tab.diff.staged === true) return stagedPaths.has(tab.path)
      return unstagedPaths.has(tab.path)
    })
    if (kept.length === current.length) return
    setTabs(kept)
    setActivePath((active) => (active !== null && kept.some((tab) => tab.path === active) ? active : (kept.length > 0 ? kept[kept.length - 1].path : null)))
  }, [gitStatus, project])

  /* ── 文件打开 / 保存 / 关闭 ─────────────────────────────────────────── */
  const openFile = useCallback(async (path) => {
    if (project === null) return
    flushBuffersRef.current?.()
    const existing = tabs.find((tab) => tab.path === path)
    if (existing !== undefined) {
      setActivePath(path)
      return
    }
    try {
      const doc = await G.api('fs.read', { root: project.root, path })
      /* 用函数式更新去重：并发/恢复场景下闭包里的 tabs 可能还没刷新，直接追加会产生重复标签 */
      setTabs((current) => (
        current.some((tab) => tab.path === path)
          ? current
          : [...current, { ...doc, savedContent: doc.content, dirty: false, savedRevision: doc.revision }]
      ))
      setActivePath(path)
    } catch (error) {
      setBanner(G.errorText(error))
    }
  }, [project, tabs])

  /* 从搜索/定位结果打开文件并跳到指定行列（等 tab 切换完成后再触发编辑器 reveal） */
  const openFileAt = useCallback(async (path, line, column) => {
    if (typeof path !== 'string' || path === '') return
    await openFile(path)
    const targetLine = Number.isFinite(Number(line)) ? Math.max(1, Math.trunc(Number(line))) : 1
    const targetColumn = Number.isFinite(Number(column)) ? Math.max(1, Math.trunc(Number(column))) : 1
    window.setTimeout(() => {
      try {
        G.bus.emit('editor:reveal', { path, line: targetLine, column: targetColumn })
      } catch {
        /* ignore */
      }
    }, 120)
  }, [openFile])

  /* Cmd/Ctrl+点击定义：编辑器 → App 跳转 / 多结果选择（兜底搜索在 host/code.js） */
  useEffect(() => {
    if (G.bus === null || G.bus === undefined || typeof G.bus.on !== 'function') return undefined
    const offOpen = G.bus.on('editor:open-at', (detail) => {
      if (detail === null || detail === undefined || typeof detail.path !== 'string') return
      void openFileAt(detail.path, detail.line, detail.column)
    })
    const offPick = G.bus.on('definition:pick', (detail) => {
      if (detail === null || detail === undefined || !Array.isArray(detail.matches) || detail.matches.length === 0) return
      setDefinitionPicker({
        word: typeof detail.word === 'string' ? detail.word : '',
        matches: detail.matches,
        x: Number.isFinite(Number(detail.x)) ? Number(detail.x) : 240,
        y: Number.isFinite(Number(detail.y)) ? Number(detail.y) : 200,
      })
    })
    return () => {
      offOpen?.()
      offPick?.()
    }
  }, [openFileAt])

  /* 原子恢复标签集合：按快照顺序、去重、最后激活指定文件（避免 openFile 并发产生重复标签） */
  const applyTabs = useCallback(async (paths, active) => {
    if (project === null || !Array.isArray(paths)) return
    flushBuffersRef.current?.()
    const docs = []
    const seen = new Set()
    for (const path of paths.slice(0, 12)) {
      if (typeof path !== 'string' || path === '' || seen.has(path)) continue
      seen.add(path)
      try {
        const doc = await G.api('fs.read', { root: project.root, path })
        docs.push({ ...doc, savedContent: doc.content, dirty: false, savedRevision: doc.revision })
      } catch {
        /* 快照里的文件可能已被删除：忽略 */
      }
    }
    editorBuffersRef.current.clear()
    setTabs(docs)
    const wanted = typeof active === 'string' && docs.some((doc) => doc.path === active) ? active : (docs.length > 0 ? docs[docs.length - 1].path : null)
    setActivePath(wanted)
  }, [project])

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? null, [tabs, activePath])

  const patchTab = useCallback((path, patch) => {
    setTabs((current) => {
      const next = current.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab))
      tabsRef.current = next
      return next
    })
  }, [])

  /* 把缓冲内容写回 tabs（停顿 / 保存 / 切换标签时调用），不会在每次按键触发渲染。 */
  const flushEditorBuffers = useCallback(() => {
    const buffers = editorBuffersRef.current
    if (buffers.size === 0) return
    setTabs((current) => {
      let changed = false
      const next = current.map((tab) => {
        if (tab === null || !buffers.has(tab.path)) return tab
        const content = buffers.get(tab.path)
        const dirty = content !== tab.savedContent
        if (tab.content === content && tab.dirty === dirty) return tab
        changed = true
        return { ...tab, content, dirty }
      })
      if (!changed) return current
      tabsRef.current = next
      return next
    })
  }, [])

  flushBuffersRef.current = flushEditorBuffers

  const scheduleEditorFlush = useCallback(() => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      flushEditorBuffers()
    }, 300)
  }, [flushEditorBuffers])

  const changeFile = useCallback((path, content) => {
    editorBuffersRef.current.set(path, content)
    const tab = tabsRef.current.find((item) => item !== null && item.path === path)
    if (tab !== undefined && tab.dirty !== (content !== tab.savedContent)) {
      /* 只在「干净 ↔ 脏」变化时立刻更新标签圆点，避免每个按键重渲染整棵 IDE 树。 */
      setTabs((current) => {
        let changed = false
        const next = current.map((item) => {
          if (item === null || item.path !== path) return item
          /* 用缓冲里的最新内容而不是本次按键的内容：避免 React 批处理时把「第一次按键」的旧内容回灌给编辑器。 */
          const latest = editorBuffersRef.current.has(path) ? editorBuffersRef.current.get(path) : content
          const dirty = latest !== item.savedContent
          if (item.dirty === dirty) return item
          changed = true
          return { ...item, content: latest, dirty }
        })
        if (!changed) return current
        tabsRef.current = next
        return next
      })
    }
    scheduleEditorFlush()
  }, [scheduleEditorFlush])

  const saveFile = useCallback(async (path) => {
    if (project === null) return
    const tab = tabsRef.current.find((item) => item !== null && item.path === path)
    if (tab === undefined) return
    /* 缓冲里可能有比 tabs 更新的内容（按键后 300ms 内保存/自动保存） */
    const content = editorBuffersRef.current.has(path) ? editorBuffersRef.current.get(path) : tab.content
    if (content === tab.savedContent) {
      editorBuffersRef.current.delete(path)
      if (tab.dirty === true) patchTab(path, { content, dirty: false })
      return
    }
    try {
      const result = await G.api('fs.write', {
        root: project.root,
        path: tab.path,
        content,
        expectedRevision: tab.revision,
      })
      editorBuffersRef.current.delete(path)
      patchTab(path, { content, revision: result.revision, savedRevision: result.revision, savedContent: content, dirty: false, size: result.size })
      setBanner('')
      // 内容保存不改变目录结构：只刷新 Git 状态，不重载文件树（避免整页闪烁）
      setGitRefreshToken((token) => token + 1)
      void refreshGit()
    } catch (error) {
      if (error.code === 'revision-conflict') setBanner(t('editor.saveConflict'))
      else setBanner(G.errorText(error))
    }
  }, [project, patchTab, refreshGit, t])

  /* 搜索面板批量替换前：先把所有未落盘的编辑器缓冲保存掉，避免磁盘旧内容覆盖用户输入 */
  const beforeSearchReplace = useCallback(async () => {
    flushBuffersRef.current?.()
    const pending = new Set(editorBuffersRef.current.keys())
    for (const tab of tabsRef.current ?? []) {
      if (tab !== null && tab !== undefined && tab.dirty === true) pending.add(tab.path)
    }
    for (const path of pending) {
      try {
        await saveFile(path)
      } catch {
        /* 单个保存失败不阻断替换 */
      }
    }
  }, [saveFile])

  /* 搜索面板替换完成后：刷新目录/Git，并把已打开标签同步成磁盘最新内容 */
  const onSearchFilesChanged = useCallback(async (paths) => {
    if (project !== null && Array.isArray(paths) && paths.length > 0) {
      for (const path of paths.slice(0, 30)) {
        const tab = (tabsRef.current ?? []).find((item) => item !== null && item !== undefined && item.path === path)
        if (tab === undefined) continue
        try {
          const doc = await G.api('fs.read', { root: project.root, path })
          editorBuffersRef.current.delete(path)
          patchTab(path, {
            content: doc.content,
            revision: doc.revision,
            savedRevision: doc.revision,
            savedContent: doc.content,
            dirty: false,
            size: doc.size,
          })
        } catch {
          /* 文件已被删除：忽略 */
        }
      }
    }
    setRefreshToken((token) => token + 1)
    setGitRefreshToken((token) => token + 1)
    void refreshGit()
  }, [project, patchTab, refreshGit])

  /** 顶栏提示：只显示错误/需要用户处理的提示；成功类操作直接看界面结果，不再弹 toast。 */
  const showBanner = useCallback((text, tone) => {
    if (tone === 'success') return
    setBanner(text)
  }, [])

  const closeTab = useCallback((path) => {
    editorBuffersRef.current.delete(path)
    flushBuffersRef.current?.()
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
      /* 文件可能已删除（工作树删掉/暂存区删除）：读不到就按空处理，仍然展示差异 */
      let file = null
      try {
        file = await G.api('fs.read', { root: project.root, path: change.path })
      } catch {
        file = null
      }
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
      let rightContent = typeof file?.content === 'string' ? file.content : ''
      if (change.staged === true) {
        /* 暂存区 diff = HEAD ↔ 索引；右侧必须用索引内容，而不是工作树（工作树可能还有未暂存改动） */
        try {
          const indexDoc = await G.api('git.show', { root: project.root, path: change.path, rev: 'index' })
          rightContent = typeof indexDoc.text === 'string' ? indexDoc.text : ''
        } catch {
          rightContent = ''
        }
      }
      const tab = {
        path: change.path,
        title: `${G.basename(change.path)}（${change.staged === true ? '暂存区' : '工作树'}）`,
        kind: 'diff',
        content: rightContent,
        savedContent: rightContent,
        revision: file?.revision,
        dirty: false,
        language: file?.language ?? 'plaintext',
        size: file?.size,
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
      /* 暂存后这个文件已经没有「工作树 vs 索引」差异：关掉当前 diff 标签，刷新后也不会再出现在未暂存区 */
      setTabs((current) => current.filter((tab) => !(tab.path === path && tab.kind === 'diff' && tab.diff !== null && tab.diff !== undefined && tab.diff.staged !== true)))
      setActivePath((active) => (active === path ? null : active))
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

  /* ── 桌面悬浮层：URL 带 ?gufa-float=1 时自动进入 IDE 并用半透明皮肤 ── */
  const floatRequested = (() => {
    try {
      if (typeof location !== 'undefined' && /[?&]gufa-float=1/.test(location.search)) return true
      return typeof localStorage !== 'undefined' && localStorage.getItem('gufa-code:float') === '1'
    } catch {
      return false
    }
  })()
  useEffect(() => {
    if (floatRequested !== true) return undefined
    try { document.documentElement.setAttribute('data-gufa-float', '1') } catch { /* ignore */ }
    const enter = (attempt) => {
      try {
        if (typeof G.mode?.get === 'function' && G.mode.get() !== true) G.mode.set(true)
      } catch { /* ignore */ }
      void G.api('dev.log', {
        message: `float-mode enter attempt=${attempt} mode=${String(typeof G.mode?.get === 'function' ? G.mode.get() : 'n/a')} overlay=${document.querySelector('.gufa-overlay-root') !== null}`,
      }).catch(() => {})
    }
    const first = window.setTimeout(() => enter(1), 400)
    const second = window.setTimeout(() => enter(2), 2000)
    return () => {
      window.clearTimeout(first)
      window.clearTimeout(second)
    }
  }, [floatRequested])

  /* 悬浮层运行状态（主窗口里显示按钮状态用） */
  useEffect(() => {
    let cancelled = false
    void G.api('float.status').then((value) => {
      if (!cancelled) setFloatRunning(value?.running === true)
    }).catch(() => { /* 旧 host 没有该方法 */ })
    return () => { cancelled = true }
  }, [])

  /* 退出摸鱼：关掉悬浮层（helper 会把主窗口唤回前台） */
  const stopFloatWindow = useCallback(async () => {
    if (floatBusy) return
    setFloatBusy(true)
    try {
      await G.api('float.stop')
      setFloatRunning(false)
    } catch (error) {
      setBanner(G.errorText(error))
    } finally {
      setFloatBusy(false)
    }
  }, [floatBusy])

  /* 拉取可吸附的 App 窗口列表（摸鱼列表） */
  const openFloatPicker = useCallback(async () => {
    if (floatBusy) return
    setFloatPicker({ status: 'loading', windows: [], error: '' })
    try {
      const value = await G.api('float.windows')
      if (value?.ok === true && value?.accessibility !== true) {
        setFloatPicker({ status: 'permission', windows: [], error: '' })
      } else if (value?.ok === true && Array.isArray(value.apps)) {
        setFloatPicker({ status: 'ready', windows: value.apps, error: '' })
      } else if (value?.ok === false) {
        setFloatPicker({ status: 'permission', windows: [], error: '' })
      } else {
        setFloatPicker({ status: 'error', windows: [], error: '没有读到可吸附的窗口' })
      }
    } catch (error) {
      setFloatPicker({ status: 'error', windows: [], error: G.errorText(error) })
    }
  }, [floatBusy])

  /* 摸鱼自检：平台/helper/WebView2/辅助功能/X11 等现场信息，方便真机反馈 */
  const openFloatDoctor = useCallback(async () => {
    setFloatReport('')
    setFloatDoctor({ status: 'loading', data: null, error: '' })
    try {
      const value = await G.api('float.diagnostics')
      setFloatDoctor({ status: 'ok', data: value ?? null, error: '' })
    } catch (error) {
      setFloatDoctor({ status: 'error', data: null, error: G.errorText(error) })
    }
  }, [])
  const floatDoctorText = floatDoctor !== null && floatDoctor.data !== null
    ? JSON.stringify(floatDoctor.data, null, 2)
    : (floatDoctor !== null && typeof floatDoctor.error === 'string' ? floatDoctor.error : '')

  /* 选中某个 App 窗口 → 启动悬浮层并吸附它 */
  /* 当前编辑器状态快照（进出摸鱼都以它为准） */
  const buildFloatSnapshot = useCallback(() => ({
    /* 诊断：快照里项目字段 */
    projectRoot: project !== null && typeof project.root === 'string' ? project.root : null,
    activePath: typeof activePath === 'string' ? activePath : null,
    tabs: tabs
      .filter((tab) => tab !== null && tab !== undefined && typeof tab.path === 'string' && tab.kind !== 'diff' && tab.kind !== 'graph')
      .map((tab) => tab.path)
      .slice(0, 10),
    ui: ui,
    sessionId: typeof currentSessionId === 'string' ? currentSessionId : null,
  }), [project, activePath, tabs, ui, currentSessionId])

  const startFloatForWindow = useCallback(async (target) => {
    if (floatBusy || target === null || target === undefined) return
    setFloatBusy(true)
    try {
      const floatState = buildFloatSnapshot()
      void G.api('dev.log', { message: `float-start-instance id=${appInstanceId.current} project=${String(floatState.projectRoot)} tabs=${floatState.tabs.length}` }).catch(() => {})
      const value = await G.api('float.start', {
        follow: {
          pid: Number(target.pid) || 0,
          bundleId: typeof target.bundleId === 'string' ? target.bundleId : '',
          title: '',
        },
        state: floatState,
      })
      setFloatRunning(value?.running === true)
      setFloatPicker(null)
    } catch (error) {
      setBanner(G.errorText(error))
    } finally {
      setFloatBusy(false)
    }
  }, [floatBusy, buildFloatSnapshot])

  /* 自由悬浮（不吸附窗口）：同样带上当前编辑器状态快照 */
  const startFloatFree = useCallback(async () => {
    if (floatBusy) return
    setFloatBusy(true)
    try {
      const value = await G.api('float.start', { state: buildFloatSnapshot() })
      setFloatRunning(value?.running === true)
      setFloatPicker(null)
    } catch (error) {
      setBanner(G.errorText(error))
    } finally {
      setFloatBusy(false)
    }
  }, [floatBusy])

  /* 内部 QA：允许自动化脚本在悬浮窗里打开摸鱼列表（仅供自测，不影响正常交互） */
  G.debugOpenFloatPicker = openFloatPicker

  /* 悬浮窗里点「退出摸鱼」：把当前状态交还主窗口，再关闭悬浮层 */
  const exitMoyu = useCallback(async () => {
    if (floatBusy) return
    setFloatBusy(true)
    try {
      const state = {
        projectRoot: project !== null && typeof project.root === 'string' ? project.root : null,
        activePath: typeof activePath === 'string' ? activePath : null,
        tabs: tabs
          .filter((tab) => tab !== null && tab !== undefined && typeof tab.path === 'string' && tab.kind !== 'diff' && tab.kind !== 'graph')
          .map((tab) => tab.path)
          .slice(0, 10),
        ui: ui,
        sessionId: typeof currentSessionId === 'string' ? currentSessionId : null,
      }
      await G.api('float.saveExitState', { state })
      await G.api('float.stop')
      setFloatRunning(false)
    } catch (error) {
      setBanner(G.errorText(error))
    } finally {
      setFloatBusy(false)
    }
  }, [floatBusy, project, activePath, tabs, currentSessionId, ui])

  /* 主窗口回到前台时：取回退出摸鱼时的状态（项目/标签页/会话） */
  const consumeExitStateRef = useRef(false)
  useEffect(() => {
    if (G.isFloatMode()) return undefined
    if (G.instanceBoot === true) return undefined
    let running = false
    const consume = async () => {
      if (running) return
      running = true
      try {
        const value = await G.api('float.consumeExitState')
        const state = value?.state ?? null
        if (state !== null && typeof state === 'object') {
          void G.api('dev.log', { message: `moyu-exit-state consume project=${String(state.projectRoot)} tabs=${Array.isArray(state.tabs) ? state.tabs.length : 0} session=${String(state.sessionId)}` }).catch(() => {})
          const restore = G.floatRestoreRef
          if (restore === null || restore === undefined) {
            /* 主窗口当前不在 IDE 模式：把状态写进 localStorage，等下次进 IDE 时恢复 */
            try {
              if (typeof state.projectRoot === 'string' && state.projectRoot !== '') localStorage.setItem('gufa-code:project', JSON.stringify(state.projectRoot))
              localStorage.setItem('gufa-code:float-state', JSON.stringify(state))
            } catch {
              /* ignore */
            }
            return
          }
          let projectValue = null
          if (typeof state.projectRoot === 'string' && state.projectRoot !== '') {
            try {
              projectValue = await G.api('project.open', { path: state.projectRoot })
            } catch {
              projectValue = null
            }
          }
          if (projectValue !== null && restore !== null && restore !== undefined && typeof restore.applyProject === 'function') {
            restore.applyProject(projectValue)
          }
          try {
            if (typeof G.floatApplyUiRef === 'function' && state.ui !== null && typeof state.ui === 'object') G.floatApplyUiRef(state.ui)
          } catch {
            /* ignore */
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
          const paths = Array.isArray(state.tabs) ? state.tabs.filter((path) => typeof path === 'string' && path !== '') : []
          const ordered = paths
          const activeOne = typeof state.activePath === 'string' && state.activePath !== '' ? state.activePath : null
          /* applyProject 后 App 已重渲染：重新取恢复入口，原子恢复标签集合 */
          const latest = G.floatRestoreRef
          if (latest !== null && latest !== undefined && typeof latest.applyTabs === 'function') {
            await latest.applyTabs(ordered, activeOne)
          }
          const openedCount = ordered.length
          void G.api('dev.log', { message: `moyu-exit-applied project=${String(state.projectRoot)} tabs=${openedCount} ui=${JSON.stringify(state.ui ?? null)}` }).catch(() => {})
          if (typeof state.sessionId === 'string' && state.sessionId !== '') {
            try {
              const workspace = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
              if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') workspace.openSession(state.sessionId)
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        running = false
      }
    }
    const syncFloatStatus = async () => {
      try {
        const value = await G.api('float.status')
        const next = value?.running === true
        setFloatRunning((current) => (current === next ? current : next))
      } catch {
        /* ignore */
      }
    }
    const onFocus = () => { void syncFloatStatus(); void consume() }
    window.addEventListener('focus', onFocus)
    /* 摸鱼退出后主窗口可能因隐藏/恢复丢失 focus 事件，低频轮询兜底 */
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void consume()
      void syncFloatStatus()
    }, 5000)
    const onVisible = () => { if (document.visibilityState === 'visible') { void syncFloatStatus(); void consume() } }
    document.addEventListener('visibilitychange', onVisible)
    if (consumeExitStateRef.current !== true) {
      consumeExitStateRef.current = true
      void consume()
    }
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(pollTimer)
    }
  }, [])

  const toggleFloatWindow = useCallback(async () => {
    if (floatBusy) return
    /* 以 Host 的真实运行状态为准：避免退出摸鱼后主窗口状态残留，第一次点击失效 */
    let running = floatRunning
    try {
      const status = await G.api('float.status')
      running = status?.running === true
    } catch {
      running = false
    }
    if (floatRequested === true || running) await stopFloatWindow()
    else void openFloatPicker()
  }, [floatBusy, floatRequested, floatRunning, stopFloatWindow, openFloatPicker])

  /* ── 右侧 AI 面板与当前工作区保持一致 ─────────────────────────────────
   * ChatDock 停靠的是 DSH「主视图会话」，但主视图会话可能属于别的工作区
   * （重启恢复、手动切换会话后常见）。项目根变化时自动切到当前工作区的会话。 */
  const dockSyncRef = useRef('')
  useEffect(() => {
    if (sessionPinnedRef.current === true) return undefined
    if (G.isFloatMode()) return undefined
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
    /* 实例窗口：保持空工作区，不跟随主窗口/DSH 当前会话自动打开项目 */
    if (G.instanceBoot === true) {
      entryWorkspaceSyncedRef.current = true
      return
    }
    /* 悬浮层（摸鱼）：项目/会话由主窗口状态注入，不做「入口工作区」同步 */
    if (G.isFloatMode()) {
      entryWorkspaceSyncedRef.current = true
      return
    }
    if (project === null && (G.pendingEntryWorkspace === null || G.pendingEntryWorkspace === undefined)) return
    const pending = G.pendingEntryWorkspace
    if (pending === null || pending === undefined || typeof pending.key !== 'string') {
      if (typeof sessionCwd !== 'string' || sessionCwd === '') return
      entryWorkspaceSyncedRef.current = true
      if (project !== null && typeof project.root === 'string' && project.root !== sessionCwd) {
        void openProjectPath(sessionCwd).catch((error) => setBanner(G.errorText(error)))
      }
      return
    }
    entryWorkspaceSyncedRef.current = true
    const currentRoot = project !== null && typeof project.root === 'string' ? project.root : ''
    void G.api('dev.log', { message: `entry-sync pending=${String(pending.key)} project=${currentRoot === '' ? 'null' : currentRoot} sessionCwd=${typeof sessionCwd === 'string' ? sessionCwd : ''}` }).catch(() => {})
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
          if (currentRoot !== targetPath) await openProjectPath(targetPath)
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
  }, [project, sessionCwd, openProjectPath, setBanner, gufaModeVisible])

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
    /* 实例窗口：不跟随会话 cwd 自动打开项目 */
    if (G.instanceBoot === true) {
      lastSessionCwdRef.current = sessionCwd
      return
    }
    /* 悬浮层里项目由主窗口状态注入，不跟随（Web 版客户端自己的）会话 cwd 切换 */
    if (G.isFloatMode()) {
      lastSessionCwdRef.current = sessionCwd
      return
    }
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

  /* 悬浮窗：恢复主窗口带过来的打开的标签页（只恢复普通文件，diff/graph 跳过） */
  const floatTabsRestoredRef = useRef(false)
  useEffect(() => {
    if (floatTabsRestoredRef.current) return
    if (project === null) return
    let state = null
    state = G.floatState
    if (state === null || state === undefined) {
      try {
        const raw = localStorage.getItem('gufa-code:float-state')
        state = raw === null ? null : JSON.parse(raw)
      } catch {
        state = null
      }
    }
    if (state === null || typeof state !== 'object') return
    floatTabsRestoredRef.current = true
    const paths = Array.isArray(state.tabs) ? state.tabs.filter((path) => typeof path === 'string' && path !== '') : []
    const ordered = paths.filter((path) => path !== state.activePath).concat(
      typeof state.activePath === 'string' && state.activePath !== '' ? [state.activePath] : [],
    )
    void (async () => {
      for (const path of ordered.slice(0, 10)) {
        try {
          await openFile(path)
        } catch {
          /* 文件可能已被删除，忽略 */
        }
      }
    })()
  }, [project, openFile])

  /* 悬浮层恢复入口：主窗口把状态带过来后，由 99-main 显式调用（不依赖 App 自己的启动时序） */
  useEffect(() => {
    G.floatRestoreRef = { applyProject, openFile, applyTabs }
    G.floatGetTabs = () => tabs
    G.floatApplyUiRef = (nextUi) => {
      if (nextUi === null || nextUi === undefined || typeof nextUi !== 'object') return
      patchUi({
        view: typeof nextUi.view === 'string' ? nextUi.view : undefined,
        chatOpen: typeof nextUi.chatOpen === 'boolean' ? nextUi.chatOpen : undefined,
        terminalOpen: typeof nextUi.terminalOpen === 'boolean' ? nextUi.terminalOpen : undefined,
        sidebarOpen: typeof nextUi.sidebarOpen === 'boolean' ? nextUi.sidebarOpen : undefined,
      })
    }
    return () => {
      if (G.floatRestoreRef !== undefined && G.floatRestoreRef !== null && G.floatRestoreRef.applyProject === applyProject) G.floatRestoreRef = null
    }
  }, [applyProject, openFile, applyTabs, tabs])

  const activeFileForChat = useMemo(() => {
    if (activeTab === null || activeTab.kind === 'diff' || activeTab.kind === 'graph') return null
    return { path: activeTab.path, content: activeTab.content ?? '', language: activeTab.language }
  }, [activeTab])

  const selectionForChat = useMemo(() => selection, [selection])

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
    panelSearch: () => {
      patchUi({ view: 'search', sidebarOpen: true })
      window.setTimeout(() => { G.bus.emit('search:focus') }, 0)
    },
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
    newWindow: () => {
      /* Host 用古法编程原生 helper 开一个普通窗口，加载同一个 Web GUI，
         并把当前项目/标签页状态与全屏状态带过去；失败才回退浏览器窗口。 */
      let fullscreen = false
      try {
        const coversScreen = window.innerWidth >= (screen.width - 2) && window.innerHeight >= (screen.height - 2)
        const coversWorkArea = window.innerWidth >= (screen.availWidth - 2) && window.innerHeight >= (screen.availHeight - 2)
        fullscreen = coversScreen || coversWorkArea
      } catch {
        fullscreen = false
      }
      void G.api('app.newWindow', { fullscreen }).catch((error) => {
        let opened = null
        try { opened = window.open(location.href, '_blank') } catch { opened = null }
        if (opened !== null && opened !== undefined) {
          try { opened.focus() } catch { /* ignore */ }
          return
        }
        try { G.refToast(`打开新窗口失败：${G.errorText(error)}`, 'err') } catch { /* ignore */ }
      })
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
    { id: 'search', icon: 'search', label: t('activity.search'), onClick: () => { patchUi({ view: 'search', sidebarOpen: true }); G.bus.emit('search:focus') } },
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
    h('div', { key: 'search', style: { display: ui.view === 'search' ? 'flex' : 'none', flex: '1 1 auto', minHeight: 0, flexDirection: 'column' } },
      h(G.SearchPanel, {
        root: project?.root ?? null,
        active: ui.view === 'search',
        onOpenFile: (path, line, column) => void openFileAt(path, line, column),
        onBeforeReplace: beforeSearchReplace,
        onFilesChanged: onSearchFilesChanged,
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
                onClick: () => handleSelectTab(tab.path),
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
          /* 不再放「选择工作区 / 新建工作区」按钮：顶部已有同一套入口，避免两套逻辑 */
          h('div', { className: 'gufa-empty-hint' }, t('app.noProjectHintTop')),
          bootError !== '' ? h('div', { className: 'gufa-error-banner', style: { margin: 0 } }, bootError) : null,
        )
      : null

  const handleEditorCursor = useCallback((value) => {
    if (value === null || value === undefined) return
    /* 状态栏订阅 cursorStore，不再触发 App 根组件渲染 */
    G.cursorStore.set(value)
    const selectedText = typeof value.selectedText === 'string' ? value.selectedText : ''
    if (selectedText === '') {
      if (selectionTimerRef.current !== null) { window.clearTimeout(selectionTimerRef.current); selectionTimerRef.current = null }
      pendingSelectionRef.current = null
      setSelection((current) => (current === null ? current : null))
      return
    }
    pendingSelectionRef.current = { text: selectedText, path: value.path, line: value.line, column: value.column }
    if (selectionTimerRef.current !== null) return
    selectionTimerRef.current = window.setTimeout(() => {
      selectionTimerRef.current = null
      const latest = pendingSelectionRef.current
      if (latest === null) return
      setSelection((current) => {
        if (current !== null && current.text === latest.text && current.path === latest.path &&
            current.line === latest.line && current.column === latest.column) return current
        return latest
      })
    }, 180)
  }, [])
  const handleEditorSave = useCallback((path) => { void saveFile(path) }, [saveFile])
  const handleSelectTab = useCallback((path) => {
    flushBuffersRef.current?.()
    setActivePath(path)
  }, [])
  useEffect(() => () => {
    if (flushTimerRef.current !== null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
    if (selectionTimerRef.current !== null) { window.clearTimeout(selectionTimerRef.current); selectionTimerRef.current = null }
  }, [])

  const uiTheme = moyuMode ? 'dark' : theme
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
        h('span', { className: 'gufa-build-tag', title: '古法编程客户端版本（排查缓存用）' }, G.BUILD !== undefined ? G.BUILD : ''),
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
        moyuMode
          ? h(
              'label',
              { className: 'gufa-moyu-alpha', title: '摸鱼界面透明度' },
              h('span', { className: 'gufa-moyu-alpha-label' }, '透明度'),
              h('input', {
                className: 'gufa-moyu-alpha-range',
                type: 'range',
                min: 20,
                max: 100,
                step: 1,
                value: floatAlpha,
                onChange: (event) => setFloatAlpha(Number(event.target.value)),
              }),
              h('span', { className: 'gufa-moyu-alpha-value' }, `${floatAlpha}%`),
            )
          : h(G.Button, { icon: 'plus', title: t('app.newWorkspace'), disabled: workspaceBusy, onClick: () => void createWorkspace() }, t('app.newWorkspace')),
        moyuMode === false && skinBackdrop.available === true && backdropActive
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
        moyuMode === false && skinBackdrop.available === true
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
        moyuMode === false
          ? h('button', {
              type: 'button',
              className: 'gufa-moyu-btn',
              title: '摸鱼模式：选择一个 App 吸附并悬浮',
              disabled: floatBusy,
              onClick: () => void toggleFloatWindow(),
            }, '摸鱼')
          : null,
        moyuMode === false
          ? h(G.IconButton, { title: t('app.refresh'), onClick: () => { setRefreshToken((token) => token + 1); setGitRefreshToken((token) => token + 1); setSshRefreshToken((token) => token + 1) } }, h(G.Icon, { name: 'refresh', size: 15 }))
          : null,
        h(G.IconButton, {
          title: ui.chatOpen ? t('activity.collapseChat') : t('activity.expandChat'),
          'data-active': ui.chatOpen ? '' : undefined,
          onClick: () => patchUi({ chatOpen: !ui.chatOpen }),
        }, h(G.Icon, { name: 'panel-right', size: 16 })),
        moyuMode
          ? h('button', {
              type: 'button',
              className: 'gufa-moyu-exit',
              title: '退出摸鱼：关闭悬浮层，回到主窗口并带回当前状态',
              disabled: floatBusy,
              onClick: () => void exitMoyu(),
            }, '退出摸鱼')
          : h(G.Button, { icon: 'arrow-left', title: t('app.exitHint'), onClick: exitMode }, t('app.exit')),
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
            banner !== ''
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
                      theme: uiTheme,
                      palette: solidPalette,
                      root: project?.root ?? '',
                      onSelectTab: handleSelectTab,
                      onCloseTab: closeTabWithConfirm,
                      onChange: changeFile,
                      onSave: handleEditorSave,
                      backdropMode: backdropActive,
                      onCursor: handleEditorCursor,
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
                theme: uiTheme,
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
                theme: uiTheme,
                width: chatWidth,
                active: true,
                paused: sessionsOpen,
                backdrop: backdropActive,
                theme: uiTheme,
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
      activeTab !== null && problems[activeTab.path] !== undefined
        ? h('span', { className: 'gufa-status-item', style: { color: problems[activeTab.path].errors > 0 ? '#f85149' : '#e5c07b' } }, `${problems[activeTab.path].errors} ✕ ${problems[activeTab.path].warnings} ⚠`)
        : null,
      h(G.StatusCursor, { activePath, fallbackLineCount: lineCount }),
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
    G.portal(definitionPicker === null
      ? null
      : h(
          'div',
          { style: { position: 'fixed', inset: 0, zIndex: 2147483120 }, onMouseDown: () => setDefinitionPicker(null) },
          h(
            'div',
            {
              className: 'gufa-menu',
              style: {
                position: 'fixed',
                left: `${Math.max(8, Math.min(definitionPicker.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 380))}px`,
                top: `${Math.max(8, Math.min(definitionPicker.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 60))}px`,
                minWidth: '340px',
                maxWidth: '520px',
                maxHeight: '420px',
                overflowY: 'auto',
              },
              onMouseDown: (event) => event.stopPropagation(),
            },
            h(
              'div',
              { style: { padding: '4px 9px 6px', fontSize: '11px', color: 'var(--gufa-text-dim)' } },
              `${t('editor.gotoDefinition')}：${definitionPicker.word}`,
            ),
            ...definitionPicker.matches.slice(0, 15).map((item, index) =>
              h(G.MenuItem, {
                key: `${item.path}:${item.line}:${item.column}:${index}`,
                icon: 'code',
                label: `${G.basename(item.path)}  ·  ${G.dirname(item.path) === '' ? '.' : G.dirname(item.path)}  :${item.line}`,
                onClick: () => {
                  setDefinitionPicker(null)
                  void openFileAt(item.path, item.line, item.column)
                },
              }),
            ),
          ),
        ),
    ),
    G.portal(workspaceDialog === null
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
    ),
    G.portal(branchMenu === null
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
    ),
    /* 弹窗 */
    G.portal(modal === null ? null : renderModal()),
    G.portal(floatPicker !== null
      ? h(
          'div',
          {
            className: 'gufa-float-backdrop',
            onMouseDown: (event) => { if (event.target === event.currentTarget) setFloatPicker(null) },
          },
          h(
            'div',
            { className: 'gufa-float-picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': '选择要摸鱼的 App' },
            h(
              'div',
              { className: 'gufa-modal-head' },
              h(G.Icon, { name: 'monitor', size: 15 }),
              h('span', { style: { flex: '1 1 auto' } }, '摸鱼模式：选择要吸附的 App'),
              h(G.IconButton, { title: t('common.close'), onClick: () => setFloatPicker(null) }, h(G.Icon, { name: 'close', size: 14 })),
            ),
            floatPicker.status === 'loading'
              ? h('div', { className: 'gufa-graph-loading', style: { height: 90 } }, h(G.Spinner), '正在读取窗口列表…')
              : floatPicker.status === 'permission'
                ? h(
                    'div',
                    { className: 'gufa-float-permission' },
                    h('div', { className: 'gufa-float-permission-title' }, '需要「辅助功能」权限'),
                    h('div', { className: 'gufa-hint' }, '摸鱼模式需要「辅助功能」权限才能读取/跟随其他 App 的窗口位置和大小（只读窗口信息，不录屏）。请在「系统设置 → 隐私与安全性 → 辅助功能」里打开 **DeepSeek Harness** 的开关（改完可能需要重启一次 DSH），然后点「重试」。'),
                    h(
                      'div',
                      { className: 'gufa-row', style: { gap: 8, marginTop: 12, flexWrap: 'wrap' } },
                      h(G.Button, { primary: true, onClick: () => void G.api('float.openPrivacy').catch(() => {}) }, '打开系统设置'),
                      h(G.Button, { onClick: () => void G.api('float.revealHelper').catch(() => {}) }, '在 Finder 中显示悬浮层 App'),
                      h(G.Button, { onClick: () => void openFloatPicker() }, '重试'),
                    ),
                  )
                : floatPicker.status === 'error'
                  ? h('div', { className: 'gufa-float-permission' }, h('div', { className: 'gufa-error-banner' }, floatPicker.error))
                  : floatPicker.windows.length === 0
                    ? h('div', { className: 'gufa-hint', style: { padding: 16 } }, '没有可吸附的窗口')
                    : h(
                        'div',
                        { className: 'gufa-float-list gufa-scroll' },
                        floatPicker.windows.map((win, index) =>
                          h(
                            'button',
                            {
                              key: `${win.pid}:${win.windowNumber}:${index}`,
                              type: 'button',
                              className: 'gufa-float-row',
                              title: `${win.owner} — ${win.title}`,
                              disabled: floatBusy,
                              onClick: () => void startFloatForWindow(win),
                            },
                            win.icon !== undefined && win.icon !== ''
                              ? h('img', { className: 'gufa-float-icon', src: `data:image/png;base64,${win.icon}`, alt: '' })
                              : h(G.Icon, { name: 'monitor', size: 26 }),
                            h(
                              'span',
                              { className: 'gufa-float-meta' },
                              h('span', { className: 'gufa-float-owner' }, win.name !== undefined && win.name !== '' ? win.name : '未知 App'),
                              h('span', { className: 'gufa-float-title' }, win.bundleId !== undefined ? win.bundleId : ''),
                            ),
                            win.frontmost === true ? h('span', { className: 'gufa-float-size' }, '当前') : null,
                          ),
                        ),
                      ),
            h(
              'div',
              { className: 'gufa-modal-foot' },
              h(G.IconButton, { title: '刷新列表', onClick: () => void openFloatPicker() }, h(G.Icon, { name: 'refresh', size: 14 })),
              h(G.Button, { onClick: () => void openFloatDoctor() }, '自检'),
              h('span', { style: { flex: '1 1 auto' } }),
              h(G.Button, { onClick: () => void startFloatFree() }, '自由悬浮（不吸附）'),
              h(G.Button, { onClick: () => setFloatPicker(null) }, t('common.close')),
            ),
          ),
        )
      : null),
    G.portal(floatDoctor !== null
      ? h(
          'div',
          {
            className: 'gufa-float-backdrop',
            onMouseDown: (event) => { if (event.target === event.currentTarget) setFloatDoctor(null) },
          },
          h(
            'div',
            { className: 'gufa-modal gufa-doctor', role: 'dialog', 'aria-modal': 'true', 'aria-label': '摸鱼自检' },
            h(
              'div',
              { className: 'gufa-modal-head' },
              h(G.Icon, { name: 'monitor', size: 15 }),
              h('span', { style: { flex: '1 1 auto' } }, '摸鱼自检（复制发给开发者排查）'),
              h(G.IconButton, { title: t('common.close'), onClick: () => setFloatDoctor(null) }, h(G.Icon, { name: 'close', size: 14 })),
            ),
            h(
              'div',
              { className: 'gufa-modal-body', style: { padding: 0 } },
              floatDoctor.status === 'loading'
                ? h('div', { className: 'gufa-graph-loading', style: { height: 90 } }, h(G.Spinner), '正在检查平台 / helper / 运行时…')
                : floatDoctor.status === 'error'
                  ? h('div', { className: 'gufa-float-permission' }, h('div', { className: 'gufa-error-banner' }, floatDoctor.error))
                  : h('pre', { className: 'gufa-doctor-pre gufa-scroll' }, floatDoctorText),
            ),
            h(
              'div',
              { className: 'gufa-modal-foot' },
              floatReport !== '' ? h('span', { className: 'gufa-hint', style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, floatReport) : h('span', { style: { flex: '1 1 auto' } }),
              floatDoctor.status === 'ok'
                ? h(
                    G.Button,
                    {
                      onClick: () => {
                        void G.api('float.saveReport').then((value) => {
                          setFloatReport(typeof value?.path === 'string' ? `已保存：${value.path}` : '已保存')
                        }).catch((error) => {
                          setFloatReport(`保存失败：${G.errorText(error)}`)
                        })
                      },
                    },
                    '保存报告',
                  )
                : null,
              floatDoctor.status === 'ok'
                ? h(G.Button, { onClick: () => { void navigator.clipboard?.writeText(floatDoctorText) } }, '复制')
                : null,
              h(G.Button, { onClick: () => setFloatDoctor(null) }, t('common.close')),
            ),
          ),
        )
      : null),
    G.portal(sessionsOpen ? renderSessionsDialog() : null),
    G.portal(shortcutsOpen ? renderShortcutsDialog() : null),
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

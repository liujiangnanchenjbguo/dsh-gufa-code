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

  /* 刷新已加载过的所有目录（根 + 展开过的子目录），而不是只刷根目录：
     用户在系统 Finder 里新建/改名/删除文件后，点刷新也能看到子目录里的变化。 */
  const refreshAll = useCallback(() => {
    const paths = Object.keys(dirsRef.current)
    if (paths.length === 0) return
    for (const path of paths) void loadDir(path)
  }, [loadDir])

  /* 从别的 App（Finder/终端）切回古法编程时，自动刷新已加载目录，不需要手动点刷新。 */
  useEffect(() => {
    if (!root) return undefined
    let timer = null
    const scheduleRefresh = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        refreshAll()
      }, 180)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRefresh()
    }
    window.addEventListener('focus', scheduleRefresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('focus', scheduleRefresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [root, refreshAll])

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
      h(G.IconButton, { title: t('explorer.refresh'), onClick: () => refreshAll() }, h(G.Icon, { name: 'refresh', size: 13 })),
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
          return G.portal(h(
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
          ))
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

/* ── 全局搜索（左侧「搜索」面板） ──────────────────────────────────────── */
G.SearchPanel = function SearchPanel(props) {
  const t = G.useT()
  const root = props.root
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const inputRef = useRef(null)
  const requestRef = useRef(0)

  const focusInput = useCallback(() => {
    const node = inputRef.current
    if (node === null || node === undefined) return
    try {
      node.focus()
      if (typeof node.select === 'function') node.select()
    } catch {
      /* ignore */
    }
  }, [])

  const runSearch = useCallback(async (value) => {
    const text = String(value ?? '').trim()
    if (text === '' || typeof root !== 'string' || root === '') {
      requestRef.current += 1
      setResult(null)
      setStatus('idle')
      setError('')
      return
    }
    const seq = requestRef.current + 1
    requestRef.current = seq
    setStatus('loading')
    setError('')
    try {
      const value = await G.api('fs.search', {
        root,
        query: text,
        options: { caseSensitive, regex, maxFiles: 200, maxMatches: 500 },
      })
      if (seq !== requestRef.current) return
      setResult(value)
      setStatus('ready')
    } catch (err) {
      if (seq !== requestRef.current) return
      setResult(null)
      setError(G.errorText(err))
      setStatus('error')
    }
  }, [root, caseSensitive, regex])

  /* 输入防抖搜索（回车立即搜索） */
  useEffect(() => {
    if (typeof root !== 'string' || root === '') return undefined
    const text = query.trim()
    if (text === '') {
      setResult(null)
      setStatus('idle')
      setError('')
      return undefined
    }
    const timer = window.setTimeout(() => { void runSearch(text) }, 320)
    return () => window.clearTimeout(timer)
  }, [query, runSearch, root])

  /* 快捷键/按钮打开搜索面板时聚焦输入框 */
  useEffect(() => {
    if (G.bus === null || G.bus === undefined || typeof G.bus.on !== 'function') return undefined
    return G.bus.on('search:focus', focusInput)
  }, [focusInput])

  useEffect(() => {
    if (props.active === true) focusInput()
  }, [props.active, focusInput])

  const summary = (() => {
    if (status === 'loading') return t('search.searching')
    if (status === 'error' || result === null) return ''
    if (result.total === 0) return result.truncated === true ? t('search.truncated') : t('search.noResult')
    const base = t('search.summary', { count: result.total, files: result.files.length })
    return result.truncated === true ? `${base} · ${t('search.truncated')}` : base
  })()

  const highlight = (match) => {
    const text = typeof match.text === 'string' ? match.text : ''
    const start = Number.isFinite(match.start) ? match.start : -1
    const end = Number.isFinite(match.end) ? match.end : -1
    if (start < 0 || end <= start || start >= text.length) return [text]
    const safeEnd = Math.min(end, text.length)
    return [
      text.slice(0, start),
      h('mark', { key: 'hit', className: 'gufa-search-hit' }, text.slice(start, safeEnd)),
      text.slice(safeEnd),
    ]
  }

  const body = (() => {
    if (typeof root !== 'string' || root === '') {
      return h('div', { className: 'gufa-hint', style: { padding: '10px 12px' } }, t('explorer.openProjectFirst'))
    }
    if (error !== '') {
      return h('div', { className: 'gufa-error-banner', style: { margin: '8px' } }, h(G.Icon, { name: 'warn', size: 12 }), h('span', null, `${t('search.error')}：${error}`))
    }
    if (status === 'idle') return h('div', { className: 'gufa-hint', style: { padding: '10px 12px' } }, t('search.idle'))
    if (status === 'loading') return h('div', { className: 'gufa-hint', style: { padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center' } }, h(G.Spinner), t('search.searching'))
    if (result === null || result.total === 0) {
      const emptyText = result !== null && result.truncated === true ? t('search.truncated') : t('search.noResult')
      return h('div', { className: 'gufa-hint', style: { padding: '10px 12px' } }, emptyText)
    }
    return h(
      'div',
      { className: 'gufa-search-results' },
      ...result.files.map((file) => {
        const isCollapsed = collapsed[file.path] === true
        return h(
          'div',
          { key: file.path, className: 'gufa-search-file' },
          h(
            'button',
            {
              type: 'button',
              className: 'gufa-search-file-head',
              title: file.path,
              onClick: () => setCollapsed((current) => ({ ...current, [file.path]: !isCollapsed })),
            },
            h(G.Icon, { name: isCollapsed ? 'chevron-right' : 'chevron-down', size: 11 }),
            h('span', { className: 'gufa-search-file-name' }, G.basename(file.path)),
            h('span', { className: 'gufa-search-file-dir' }, G.dirname(file.path)),
            h('span', { className: 'gufa-search-file-count' }, String(file.matches.length)),
          ),
          isCollapsed
            ? null
            : file.matches.map((match, index) =>
                h(
                  'button',
                  {
                    key: `${file.path}:${match.line}:${match.column}:${index}`,
                    type: 'button',
                    className: 'gufa-search-match',
                    title: `${file.path}:${match.line}:${match.column}`,
                    onClick: () => props.onOpenFile?.(file.path, match.line, match.column),
                  },
                  h('span', { className: 'gufa-search-line' }, String(match.line)),
                  h('span', { className: 'gufa-search-text' }, ...highlight(match)),
                ),
              ),
        )
      }),
    )
  })()

  return h(
    'div',
    { className: 'gufa-search-panel', style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
    h('div', { className: 'gufa-panel-head' }, h('span', { className: 'gufa-panel-head-title' }, t('activity.search'))),
    h(
      'div',
      { className: 'gufa-search-bar' },
      h(
        'div',
        { className: 'gufa-search-input-wrap' },
        h(G.Icon, { name: 'search', size: 13 }),
        h('input', {
          ref: inputRef,
          className: 'gufa-search-input',
          type: 'text',
          value: query,
          placeholder: t('search.placeholder'),
          spellCheck: false,
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void runSearch(query)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setQuery('')
              inputRef.current?.blur?.()
            }
          },
        }),
        query === ''
          ? null
          : h(G.IconButton, { title: t('search.clear'), onClick: () => { setQuery(''); focusInput() } }, h(G.Icon, { name: 'close', size: 11 })),
      ),
      h(
        'div',
        { className: 'gufa-search-toggles' },
        h('button', {
          type: 'button',
          className: 'gufa-search-toggle',
          'data-active': caseSensitive ? '' : undefined,
          title: t('search.caseSensitive'),
          onClick: () => setCaseSensitive((value) => !value),
        }, 'Aa'),
        h('button', {
          type: 'button',
          className: 'gufa-search-toggle',
          'data-active': regex ? '' : undefined,
          title: t('search.regex'),
          onClick: () => setRegex((value) => !value),
        }, '.*'),
        h('span', { className: 'gufa-search-summary', title: summary }, summary),
      ),
    ),
    h('div', { className: 'gufa-panel-body gufa-scroll' }, body),
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
      : G.portal(h(
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
        )),
    rowMenu === null
      ? null
      : G.portal(h(
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
        )),
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

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

    /* ── 悬浮层模式（?gufa-float=1 或 helper 注入的 localStorage 标记）──
     * 尽早打标记并隐藏经典 DSH 界面，避免先闪出一个「另一个 DSH」；
     * 同时重试进入 IDE 模式，直到覆盖层挂载完成。 */
    try {
      let floatMode = false
      try {
        floatMode = /[?&]gufa-float=1/.test(String(location.search || '')) || localStorage.getItem('gufa-code:float') === '1'
      } catch {
        floatMode = false
      }
      if (floatMode) {
        document.documentElement.setAttribute('data-gufa-float', '1')
        document.documentElement.setAttribute('data-gufa-booting', '1')
        /* 摸鱼窗口不需要皮肤：关掉皮肤插件的动画开关并移除其背景节点，
           否则它仍在 rAF 里持续写 body.style / 画 canvas（看不见但耗 CPU、占内存） */
        const disableSkin = () => {
          try {
            const root = document.documentElement
            if (root.getAttribute('data-liang-skin') === 'on') root.setAttribute('data-liang-skin', 'off')
            root.removeAttribute('data-liang-stage')
            root.removeAttribute('data-gufa-skin-live')
            for (const node of document.querySelectorAll('.liang-skin-backdrop, .liang-ambient, .liang-skin-portrait, .liang-skin-root')) {
              node.remove()
            }
          } catch {
            /* ignore */
          }
        }
        disableSkin()
        for (const delay of [400, 1200, 2600, 5000]) window.setTimeout(disableSkin, delay)
        let attempts = 0
        const timer = window.setInterval(() => {
          attempts += 1
          try {
            if (typeof G.mode?.get === 'function' && G.mode.get() !== true) G.mode.set(true)
          } catch {
            /* ignore */
          }
          if (document.querySelector('.gufa-overlay-root') !== null || attempts > 40) {
            document.documentElement.removeAttribute('data-gufa-booting')
            window.clearInterval(timer)
            /* 显式恢复主窗口状态（项目 → 标签页 → 会话），避免依赖 Web 版 App 的启动时序 */
            try {
              /* 诊断：找出某个点上所有「会画背景」的元素（含 pointer-events:none 的覆盖层） */
              try {
                const describe = (el) => {
                  const cs = window.getComputedStyle(el)
                  const cls = typeof el.className === 'string' ? el.className.replace(/\s+/g, '.').slice(0, 32) : ''
                  const r = el.getBoundingClientRect()
                  return `${el.tagName.toLowerCase()}.${cls}[bg=${cs.backgroundColor} op=${cs.opacity} z=${cs.zIndex} pe=${cs.pointerEvents} bf=${cs.backdropFilter !== 'none' ? 'Y' : ''} img=${cs.backgroundImage !== 'none' ? 'Y' : ''}]@${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
                }
                const paintersAt = (x, y) => {
                  const out = []
                  for (const el of document.querySelectorAll('body *')) {
                    const r = el.getBoundingClientRect()
                    if (!(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) continue
                    const cs = window.getComputedStyle(el)
                    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || cs.backdropFilter !== 'none') {
                      out.push(describe(el) + (el.closest('.gufa-overlay-root') === null ? ' [OUTSIDE]' : ''))
                      if (out.length >= 18) break
                    }
                  }
                  return out.join(' || ')
                }
                const w = window.innerWidth
                const h = window.innerHeight
                void G.api('dev.log', { message: `float-painters chat=[${paintersAt(Math.round(w * 0.92), Math.round(h * 0.35))}]` }).catch(() => {})
              } catch {
                /* ignore */
              }
              /* 诊断：从像素点反查元素链，找出右侧会话框多出来的深色层 */
              try {
                const desc = (el) => {
                  if (el === null || el === undefined) return 'null'
                  const cs = window.getComputedStyle(el)
                  const cls = typeof el.className === 'string' ? el.className.replace(/\s+/g, '.').slice(0, 40) : ''
                  const img = cs.backgroundImage === 'none' ? '' : ` img=${cs.backgroundImage.slice(0, 50)}`
                  const bf = cs.backdropFilter === 'none' ? '' : ` bf=${cs.backdropFilter}`
                  return `${el.tagName.toLowerCase()}.${cls}[bg=${cs.backgroundColor} op=${cs.opacity}${img}${bf}]`
                }
                const chain = (x, y) => {
                  let el = document.elementFromPoint(x, y)
                  const parts = []
                  for (let i = 0; i < 7 && el !== null; i += 1) {
                    parts.push(desc(el))
                    const before = window.getComputedStyle(el, '::before').backgroundColor
                    if (before !== 'rgba(0, 0, 0, 0)' && before !== 'transparent') parts.push(`::before=${before}`)
                    el = el.parentElement
                  }
                  return parts.join(' <- ')
                }
                const w = window.innerWidth
                const h = window.innerHeight
                void G.api('dev.log', {
                  message: `float-probe editor=[${chain(Math.round(w * 0.45), Math.round(h * 0.55))}] chat=[${chain(Math.round(w * 0.92), Math.round(h * 0.4))}]`,
                }).catch(() => {})
              } catch {
                /* ignore */
              }
              /* 诊断：找出会话框里非透明的背景元素（排查透明度不一致） */
              try {
                const chat = document.querySelector('.gufa-chatpane')
                const found = []
                if (chat !== null) {
                  for (const el of chat.querySelectorAll('*')) {
                    const bg = window.getComputedStyle(el).backgroundColor
                    if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                      found.push(`${el.tagName.toLowerCase()}.${String(el.className || '').replace(/\s+/g, '.').slice(0, 60)}=${bg}`)
                      if (found.length >= 10) break
                    }
                  }
                }
                void G.api('dev.log', { message: `float-chat-bgs ${found.join(' | ') || 'none'}` }).catch(() => {})
              } catch {
                /* ignore */
              }
              /* 诊断：摸鱼窗口里各面板的实际底色（排查透明度不一致） */
              try {
                const pick = (sel) => {
                  const el = document.querySelector(sel)
                  if (el === null) return `${sel}=none`
                  const cs = window.getComputedStyle(el)
                  return `${sel}=${cs.backgroundColor}/${cs.opacity}`
                }
                const root = document.querySelector('.gufa-root')
                void G.api('dev.log', {
                  message: `float-styles backdrop=${root === null ? '?' : root.getAttribute('data-backdrop')} ${pick('.gufa-overlay-root')} ${pick('.gufa-editor-area')} ${pick('.gufa-chatpane')} ${pick('.gufa-termpane')} ${pick('.gufa-termhead')} ${pick('.gufa-sidepanel')} ${pick('.gufa-main')} alphaVar=${window.getComputedStyle(document.documentElement).getPropertyValue('--gufa-float-alpha')}`,
                }).catch(() => {})
              } catch {
                /* ignore */
              }
              void G.api('dev.log', { message: `float-boot hasState=${G.floatState !== null && G.floatState !== undefined} restoreRef=${G.floatRestoreRef !== null && G.floatRestoreRef !== undefined} state=${G.floatState === null || G.floatState === undefined ? 'null' : JSON.stringify({ projectRoot: G.floatState.projectRoot, tabs: Array.isArray(G.floatState.tabs) ? G.floatState.tabs.length : 0, activePath: G.floatState.activePath })}` }).catch(() => {})
              if (window.__gufaFloatRestored !== true && G.floatState !== null && G.floatState !== undefined) {
                window.__gufaFloatRestored = true
                void (async () => {
                  const state = G.floatState
                  const paths = Array.isArray(state.tabs) ? state.tabs.filter((path) => typeof path === 'string' && path !== '') : []
                  let projectValue = null
                  if (typeof state.projectRoot === 'string' && state.projectRoot !== '') {
                    try {
                      projectValue = await G.api('project.open', { path: state.projectRoot })
                    } catch {
                      projectValue = null
                    }
                  }
                  const restore = G.floatRestoreRef
                  if (projectValue !== null && restore !== null && restore !== undefined && typeof restore.applyProject === 'function') {
                    restore.applyProject(projectValue)
                    void G.api('dev.log', { message: `float-restore project=${String(projectValue.root)} tabs=${paths.length}` }).catch(() => {})
                  } else {
                    void G.api('dev.log', { message: `float-restore-failed projectValue=${projectValue === null ? 'null' : 'ok'} ref=${restore !== null && restore !== undefined}` }).catch(() => {})
                  }
                  /* 先恢复 UI 面板状态（终端/视图等） */
                  try {
                    if (typeof G.floatApplyUiRef === 'function' && state.ui !== null && typeof state.ui === 'object') G.floatApplyUiRef(state.ui)
                  } catch {
                    /* ignore */
                  }
                  await new Promise((resolve) => setTimeout(resolve, 500))
                  /* 按快照里的标签顺序打开，最后再激活 activePath，避免顺序漂移 */
                  const ordered = paths
                  const activeOne = typeof state.activePath === 'string' && state.activePath !== '' ? state.activePath : null
                  /* 关键：applyProject 之后 App 已重渲染，取最新恢复入口；优先原子恢复标签集合 */
                  await new Promise((resolve) => setTimeout(resolve, 250))
                  const latest = G.floatRestoreRef
                  if (latest !== null && latest !== undefined && typeof latest.applyTabs === 'function') {
                    await latest.applyTabs(ordered, activeOne)
                  } else if (latest !== null && latest !== undefined && typeof latest.openFile === 'function') {
                    for (const path of ordered.slice(0, 10)) {
                      try { await latest.openFile(path) } catch { /* ignore */ }
                    }
                  }
                  if (typeof state.sessionId === 'string' && state.sessionId !== '') {
                    try {
                      const workspace = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
                      if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') workspace.openSession(state.sessionId)
                    } catch {
                      /* ignore */
                    }
                  }
                })()
              }
            } catch {
              /* ignore */
            }
            /* 恢复主窗口带过来的当前会话（悬浮窗是独立客户端实例，需要主动选中同一会话） */
            try {
              const parsedState = G.floatState
              const sessionId = parsedState !== null && typeof parsedState.sessionId === 'string' ? parsedState.sessionId : ''
              if (sessionId !== '') {
                const workspace = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('uiWorkspace')
                if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') {
                  window.setTimeout(() => {
                    try { workspace.openSession(sessionId) } catch { /* ignore */ }
                  }, 600)
                }
              }
            } catch {
              /* ignore */
            }
          }
        }, 250)
        ctx.effect(() => () => {
          window.clearInterval(timer)
          document.documentElement.removeAttribute('data-gufa-booting')
        }, 'gufa-code: float boot')
      }
    } catch (error) {
      console.error('[gufa-code] 悬浮模式初始化失败', error)
    }

    /* ── 实例窗口（⌘⇧N 打开的 helper full 窗口）：直接进入古法编程 ──
       helper 已注入项目和编辑器状态；这里在客户端 boot 后反复调 G.enterGufa，
       直到 IDE 覆盖层真正挂载，避免和 slots 注册时序赛跑。 */
    try {
      const instanceMode = /[?&]gufa-instance=1/.test(String(location.search || ''))
      if (instanceMode && document.documentElement.hasAttribute('data-gufa-float') !== true) {
        G.instanceBoot = true
        document.documentElement.setAttribute('data-gufa-booting', '1')
        let attempts = 0
        let timer = 0
        const tryEnter = () => {
          try {
            if (document.querySelector('.gufa-overlay-root') !== null) {
              document.documentElement.removeAttribute('data-gufa-booting')
              if (timer !== 0) window.clearInterval(timer)
              return
            }
            if (typeof G.enterGufa === 'function') G.enterGufa()
          } catch {
            /* ignore */
          }
          attempts += 1
          if (attempts > 80 && timer !== 0) {
            window.clearInterval(timer)
            document.documentElement.removeAttribute('data-gufa-booting')
          }
        }
        tryEnter()
        timer = window.setInterval(tryEnter, 200)
        ctx.effect(() => () => {
          if (timer !== 0) window.clearInterval(timer)
          document.documentElement.removeAttribute('data-gufa-booting')
        }, 'gufa-code: instance boot')
      }
    } catch (error) {
      console.error('[gufa-code] 实例窗口自动进入 IDE 失败', error)
    }

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

    // 外部弹窗（设置等）打开时降低停靠层，避免遮挡弹窗导致关不掉
    try {
      if (typeof G.installDialogLayerWatch === 'function') {
        const disposeDialogWatch = G.installDialogLayerWatch(ctx)
        if (typeof disposeDialogWatch === 'function') ctx.effect(() => disposeDialogWatch, 'gufa-code: dialog layer watch')
      }
    } catch (error) {
      console.error('[gufa-code] 安装外部弹窗层级监听失败', error)
    }

    // 聊天框：粘贴系统文件 → 自动插入 @文件引用（内容匹配项目内文件后插入）
    try {
      if (typeof G.installChatFilePaste === 'function') {
        const disposeChatPaste = G.installChatFilePaste(ctx)
        if (typeof disposeChatPaste === 'function') ctx.effect(() => disposeChatPaste, 'gufa-code: chat file paste')
      }
    } catch (error) {
      console.error('[gufa-code] 安装聊天框文件粘贴失败', error)
    }

    // 文件拖拽 → @引用 / 代码选区复制 → 代码引用 / 引用 chip 点击跳回（原 dsh-drag-ref 能力）
    try {
      if (typeof G.installGufaRefBridge === 'function') {
        const disposeRefBridge = G.installGufaRefBridge(ctx)
        if (typeof disposeRefBridge === 'function') ctx.effect(() => disposeRefBridge, 'gufa-code: explorer + code reference bridge')
      }
    } catch (error) {
      console.error('[gufa-code] 安装引用桥失败', error)
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

    // 临时诊断（1.3.57）：摸鱼窗口里点不到左树/编辑器时，看看点击落到了哪个元素
    try {
      if (document.documentElement.hasAttribute('data-gufa-float') || /[?&]gufa-float=1/.test(location.search)) {
        setTimeout(() => {
          const probeAt = (x, y) => {
            try {
              const node = document.elementFromPoint(x, y)
              if (node === null) return `${x},${y}:none`
              const cls = typeof node.className === 'string' ? node.className : ''
              return `${x},${y}:${node.tagName}.${String(cls).slice(0, 60)}`
            } catch (error) {
              return `${x},${y}:err`
            }
          }
          // 模态框深色可读性：往 portal 里塞一个临时 .gufa-modal 读计算样式
          let modalInfo = 'none'
          try {
            const host = document.getElementById('gufa-portal-root')
            if (host !== null) {
              const probe = document.createElement('div')
              probe.className = 'gufa-modal'
              probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:120px;height:60px'
              host.appendChild(probe)
              const cs = window.getComputedStyle(probe)
              modalInfo = `bg=${cs.backgroundColor} color=${cs.color}`
              probe.remove()
            }
          } catch {
            modalInfo = 'err'
          }
          // 找树行实际坐标（摸鱼窗半透明，肉眼看不清哪些行是古法的）
          const rows = []
          for (let y = 80; y < 1000; y += 22) {
            try {
              const node = document.elementFromPoint(100, y)
              if (node !== null && typeof node.closest === 'function') {
                const row = node.closest('.gufa-tree-row')
                if (row !== null) rows.push(`${y}:${String(row.textContent ?? '').trim().slice(0, 24)}`)
              }
            } catch {
              /* ignore */
            }
          }
          // 可输入控件位置（用于自动化验证复制/粘贴）
          let inputs = []
          try {
            for (const node of document.querySelectorAll('textarea, input, [contenteditable="true"]')) {
              const rect = node.getBoundingClientRect()
              if (rect.width < 30 || rect.height < 12) continue
              inputs.push(`${node.tagName}@${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}`)
              if (inputs.length >= 8) break
            }
          } catch {
            inputs = ['err']
          }
          void G.api('dev.log', { message: `float-hittest ${probeAt(135, 713)} | ${probeAt(300, 713)} | ${probeAt(900, 500)} | ${probeAt(1500, 60)} | modal[${modalInfo}] | rows[${rows.slice(0, 12).join(' ; ')}] | inputs[${inputs.join(' ; ')}]` }).catch(() => {})
        }, 5000)
      }
    } catch {
      /* ignore */
    }

    // 启动诊断：记录页面地址、真实 Host 基址与传输信息（排查桌面壳 dsh-app:// 连接问题）。
    try {
      const transport = typeof globalThis.__DSH_TRANSPORT__ === 'object' && globalThis.__DSH_TRANSPORT__ !== null ? globalThis.__DSH_TRANSPORT__ : null
      void G.api('dev.log', {
        message: `boot build=${G.BUILD || '?'} href=${location.href} base=${G.serverBase()} transport=${transport === null ? 'none' : JSON.stringify(transport)}`,
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

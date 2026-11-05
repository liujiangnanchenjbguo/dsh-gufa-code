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

    // 弹窗/菜单打开时把覆盖层整体抬到右侧停靠会话之上（否则会被盖住）
    try {
      if (typeof G.installPopupLayerWatch === 'function') {
        const disposePopupWatch = G.installPopupLayerWatch(ctx)
        if (typeof disposePopupWatch === 'function') ctx.effect(() => disposePopupWatch, 'gufa-code: popup layer watch')
      }
    } catch (error) {
      console.error('[gufa-code] 安装弹窗层级监听失败', error)
    }

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

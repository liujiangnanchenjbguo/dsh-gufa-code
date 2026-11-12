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
    if (key === 'f') return 'panelSearch'
    if (key === 'g') return 'panelGit'
    if (key === 'h' || key === 'u') return 'panelSsh'
    if (key === 'b') return 'toggleSidebar'
    if (key === 'w') return 'closeTab'
    if (key === 'n') return 'newWindow'
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
  { action: 'panelSearch', id: 'gufa.ide.panelSearch', labelKey: 'shortcuts.search', code: 'KeyF', modifiers: ['primary', 'shift'], regions: ['page', 'editable'] },
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

    // 2) 全局清扫历史遗留的命令包装（插件热重载后 service 单例仍在，
    //    旧模块的 __gufaPatchedCommands 记录可能已经丢失，只靠记录还原不干净）。
    try {
      const commandMap = registry.commands
      if (commandMap !== null && commandMap !== undefined && typeof commandMap.values === 'function') {
        for (const command of commandMap.values()) {
          try {
            if (command !== null && command !== undefined && command.__gufaWrapped === true && typeof command.__gufaOriginalResolve === 'function') {
              command.resolve = command.__gufaOriginalResolve
              try { delete command.__gufaWrapped } catch { /* ignore */ }
              try { delete command.__gufaOriginalResolve } catch { /* ignore */ }
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }

    // 3) 撤销上一轮命令包装：经典模式必须保持 DSH 原生行为，不能带着我们的
    //    resolve 包装运行（这是 Cmd+/ 呼不出快捷键面板的根因）。
    const restoreWrappedCommands = () => {
      const patched = Array.isArray(service.__gufaPatchedCommands) ? service.__gufaPatchedCommands : []
      for (const item of patched) {
        try {
          if (item !== null && item !== undefined && item.command !== null && item.command !== undefined) {
            item.command.resolve = item.originalResolve
            try { delete item.command.__gufaWrapped } catch { /* ignore */ }
          }
        } catch {
          /* ignore */
        }
      }
      service.__gufaPatchedCommands = []
    }
    restoreWrappedCommands()

    // 模式切换时重新评估：进 IDE 才包装，退出立刻还原
    if (service.__gufaModeSubscribed !== true && G.mode !== null && G.mode !== undefined && typeof G.mode.subscribe === 'function') {
      service.__gufaModeSubscribed = true
      try {
        G.mode.subscribe(() => {
          try { G.installShortcutIntegration(service) } catch { /* ignore */ }
        })
      } catch {
        /* ignore */
      }
    }

    // 经典模式：不碰任何 DSH 原生命令
    if (G.mode.get() !== true) {
      try {
        if (window !== undefined && window !== null) {
          if (window.__gufaClassicShortcutLogs === undefined) window.__gufaClassicShortcutLogs = 3
          if (window.__gufaClassicShortcutLogs > 0) {
            window.__gufaClassicShortcutLogs -= 1
            void G.api('dev.log', { message: 'shortcut-integration skipped: classic mode (native untouched)' }).catch(() => {})
          }
        }
      } catch { /* ignore */ }
      return true
    }

    // 3) IDE 模式内的命令改派表（被原生占用的组合 → IDE 动作）
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
        let overlayMounted = false
        try { overlayMounted = typeof document !== 'undefined' && document.querySelector('.gufa-overlay-root') !== null } catch { overlayMounted = false }
        const ideActive = G.mode.get() === true && overlayMounted === true && typeof window.__gufaIdeShortcutDispatch === 'function'
        if (ideActive) {
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
        if (Array.isArray(service.__gufaPatchedCommands) !== true) service.__gufaPatchedCommands = []
        service.__gufaPatchedCommands.push({ command, originalResolve })
        wrapped.push(id)
      }
    }
    // ── 命令表/配置尚未就绪时重试（插件加载可能早于 ui-layout 注册命令）──
    const expected = Object.keys(commandActions).length
    try {
      if (typeof window !== 'undefined' && window !== null) {
        if (wrapped.length < expected) {
          /* 累计尝试次数上限：配置变更会反复触发安装，不能每次都重新开 40 次重试（之前会变成常驻 2Hz 循环） */
          if ((service.__gufaIntegrationAttempts ?? 0) < 40) {
            if (service.__gufaIntegrationTimer === undefined || service.__gufaIntegrationTimer === null) {
              service.__gufaIntegrationTimer = window.setInterval(() => {
                service.__gufaIntegrationAttempts = (service.__gufaIntegrationAttempts ?? 0) + 1
                if (service.__gufaIntegrationAttempts > 40) {
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
      const signature = `${JSON.stringify(wrapped)}|${totalCommands}|${configStatus}|${edrvIds.length}|${edrvBindings.length}`
      if (service.__gufaLastIntegrationSignature !== signature) {
        service.__gufaLastIntegrationSignature = signature
        void G.api('dev.log', { message: `shortcut-integration wrapped=${JSON.stringify(wrapped)} total=${totalCommands} configStatus=${configStatus} edrv=${JSON.stringify(edrvIds).slice(0, 1500)} edrvBindings=${JSON.stringify(edrvBindings).slice(0, 2500)}` }).catch(() => {})
      }
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
  { action: 'newWindow', labelKey: 'shortcuts.newWindow', keys: ['N'], shift: true },
  { action: 'panelExplorer', labelKey: 'shortcuts.explorer', keys: ['E'], shift: true },
  { action: 'panelSearch', labelKey: 'shortcuts.search', keys: ['F'], shift: true },
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
    return () => {
      if (gufaShortcutHandlers === handlers) gufaShortcutHandlers = null
    }
  }, [handlers])
  /* 键盘桥只在 IDE 覆盖层挂载期间存在，经典模式完全不装监听器 */
  useEffect(() => {
    if (typeof G.installShortcutBridge === 'function') G.installShortcutBridge()
    return () => {
      try {
        if (typeof window.__gufaShortcutBridgeDispose === 'function') window.__gufaShortcutBridgeDispose()
      } catch {
        /* ignore */
      }
      try { window.__gufaShortcutBridgeDispose = null } catch { /* ignore */ }
      try { window.__gufaShortcutBridge = false } catch { /* ignore */ }
    }
  }, [])
}

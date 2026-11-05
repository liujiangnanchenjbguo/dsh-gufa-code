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

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
function gufaTermFloatMode() {
  try {
    return typeof G.isFloatMode === 'function' && G.isFloatMode() === true
  } catch {
    return false
  }
}

/** 摸鱼窗口里终端容器的半透明底色（跟随标题栏透明度滑块） */
const GUFA_TERM_FLOAT_BG = 'rgba(30,30,30,var(--gufa-float-alpha))'

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
    const themed = gufaApplyPaletteToTermTheme(darkTheme, palette)
    /* xterm 自身永远画透明底：背景色由外层容器用 IDE 调色板/透明度变量统一上色 */
    themed.background = 'rgba(0,0,0,0)'
    themed.cursorAccent = 'rgba(0,0,0,0)'
    return themed
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
  const themed = gufaApplyPaletteToTermTheme(light, palette)
  themed.background = 'rgba(0,0,0,0)'
  themed.cursorAccent = 'rgba(0,0,0,0)'
  return themed
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
          allowTransparency: true,
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
  /* 终端背景和其它面板用同一个变量：IDE 里是实色调色板，摸鱼里是带 --gufa-float-alpha 的半透明色 */
  const shellBackground = 'var(--gufa-solid-layer, var(--gufa-bg, #1e1e1e))'
  const background = 'transparent'
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
        background: shellBackground,
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
  /* 未显式传 palette 时（例如古法编程主模式），从 IDE 主题 token 算一份实色调色板，
     让 xterm 的文字/选区颜色与周围面板一致，而不是永远用浅色主题 */
  const [computedPalette, setComputedPalette] = useState(null)
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
    if (props.palette !== null && props.palette !== undefined) return undefined
    let cancelled = false
    const compute = () => {
      try {
        const el = sizeRef.current
        const value = typeof G.resolveSolidPalette === 'function' ? G.resolveSolidPalette(el) : null
        if (!cancelled && value !== null && value !== undefined) setComputedPalette(value)
      } catch {
        /* ignore */
      }
    }
    compute()
    const timer = window.setTimeout(compute, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [props.palette])
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
          palette: props.palette !== null && props.palette !== undefined ? props.palette : computedPalette,
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
        background: 'var(--gufa-solid-bg, var(--gufa-bg))',
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
          background: 'var(--gufa-solid-layer, var(--gufa-layer))',
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
      { ref: sizeRef, style: { position: 'relative', flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: 'transparent' } },
      body,
    ),
  )
}

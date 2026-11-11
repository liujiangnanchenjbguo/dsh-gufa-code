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

  /** 这些声明类型算「定义级」，多个同名时值得让用户选；普通 const/赋值等弱匹配不轻易弹列表。 */
const GUFA_LSP_WARMED = new Set()
const GUFA_DEFINITION_STRONG_KINDS = new Set(['function', 'class', 'method', 'def', 'func', 'fn', 'type', 'export', 'lsp'])

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
      /* 基础代码联想：显式打开自动补全与单词建议，避免依赖 Monaco 版本默认值 */
      quickSuggestions: { other: true, comments: false, strings: false },
      quickSuggestionsDelay: 10,
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: 'currentDocument',
      acceptSuggestionOnEnter: 'on',
      tabCompletion: 'on',
      inlineSuggest: { enabled: false, showToolbar: 'never' },
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

  function GufaEditorPaneComponent(props) {
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
    const tsPreloadRef = useRef(null) /* 后台预加载 import 依赖（JS/TS） */
    const modelPathRef = useRef(null) /* 当前挂在 editor 上的 tab path */
    const suppressChangeRef = useRef(false) /* 程序化 setValue 时抑制 onChange 回环 */
    const propsRef = useRef(props)
    const activePathRef = useRef(activePath)
    const statusRef = useRef('loading')
    const pendingRevealRef = useRef(null)

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
      let definitionCleanup = null
      const subscriptions = []

      setStatus('loading')
      setMonacoError('')

      const disposeEditor = () => {
        if (definitionCleanup !== null) {
          try {
            definitionCleanup()
          } catch {
            /* ignore */
          }
          definitionCleanup = null
        }
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
            if (typeof G.registerTemplateLanguages === 'function') G.registerTemplateLanguages(monaco)
          } catch (error) {
            /* 模板语言注册失败不影响编辑器 */
          }
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

              /* Cmd/Ctrl+点击跳转定义 + Cmd 悬停「可点击」提示：先走 Monaco 语言服务；
                 没有提供者（未打开的文件、非 TS/JS 语言等）时回退到 Host 的项目级定义搜索。 */
              try {
                const editorDom = typeof instance.getDomNode === 'function' ? instance.getDomNode() : null
                if (editorDom !== null && editorDom !== undefined) {
                  const isPrimaryEvent = (event) => {
                    const mac = typeof G.isMacPlatform === 'function' ? G.isMacPlatform() : true
                    return mac ? event.metaKey === true : event.ctrlKey === true
                  }
                  /* JS/TS：把当前文件的 import 依赖按需加载成 Monaco model，让 TS 语言服务
                     能解析跨文件定义；否则 Monaco 只认识已经打开过的标签。 */
                  const tsPreloadState = { seen: new Set() }
                  const preloadTsDependencies = async (model, path, root) => {
                    const language = typeof model.getLanguageId === 'function' ? model.getLanguageId() : ''
                    if (language !== 'typescript' && language !== 'javascript') return
                    const version = typeof model.getVersionId === 'function' ? model.getVersionId() : 0
                    const key = `${path}|${version}`
                    if (tsPreloadState.seen.has(key) || tsPreloadState.seen.size > 200) return
                    tsPreloadState.seen.add(key)
                    let content = ''
                    try {
                      content = model.getValue()
                    } catch {
                      return
                    }
                    const specs = []
                    for (const pattern of [/import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, /require\(\s*['"]([^'"]+)['"]\s*\)/g]) {
                      let match = null
                      while ((match = pattern.exec(content)) !== null) {
                        if (typeof match[1] === 'string' && match[1].startsWith('.')) specs.push(match[1])
                      }
                    }
                    const baseDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
                    const candidates = (spec) => {
                      const raw = `${baseDir}${baseDir === '' ? '' : '/'}${spec}`
                      const parts = []
                      for (const part of raw.split('/')) {
                        if (part === '' || part === '.') continue
                        if (part === '..') parts.pop()
                        else parts.push(part)
                      }
                      const base = parts.join('/')
                      return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.js`, `${base}/index.tsx`]
                    }
                    for (const spec of [...new Set(specs)].slice(0, 30)) {
                      for (const rel of candidates(spec)) {
                        try {
                          const doc = await G.api('fs.read', { root, path: rel })
                          const uri = gufaModelUri(monaco, root, rel)
                          if (monaco.editor.getModel(uri) === null) {
                            monaco.editor.createModel(String(doc.content ?? ''), gufaResolveLanguage(monaco, doc.language), uri)
                          }
                          break
                        } catch {
                          /* 尝试下一个候选 */
                        }
                      }
                    }
                  }
                  tsPreloadRef.current = preloadTsDependencies
                  const queryDefinitions = (position, word, model, path, root) => {
                    const language = typeof model.getLanguageId === 'function' ? model.getLanguageId() : ''
                    if (language === 'python') {
                      return G.api('lsp.definition', {
                        root,
                        path,
                        line: position.lineNumber,
                        column: position.column,
                        language: 'python',
                        content: model.getValue(),
                      }).then((value) => ({
                        matches: value !== null && value !== undefined && Array.isArray(value.matches) ? value.matches : [],
                        current: value !== null && value !== undefined && value.current !== undefined ? value.current : undefined,
                        word,
                      }))
                    }
                    return G.api('code.definition', {
                      root,
                      path,
                      line: position.lineNumber,
                      column: position.column,
                      word,
                      content: model.getValue(),
                    })
                  }
                  const decideDefinition = (result) => {
                    const matches = result !== null && result !== undefined && Array.isArray(result.matches) ? result.matches : []
                    if (matches.length === 0) return { kind: 'none' }
                    const currentPath = result.current !== null && result.current !== undefined && typeof result.current.path === 'string' ? result.current.path : null
                    const top = matches[0]
                    const topScore = Number(top.score) || 0
                    if (currentPath !== null && top.path === currentPath) return { kind: 'open', match: top }
                    const isStrong = (item) => GUFA_DEFINITION_STRONG_KINDS.has(item.kind)
                    if (!isStrong(top) && topScore < 50) return { kind: 'none' }
                    if (topScore < 30) return { kind: 'none' }
                    const cluster = matches.filter((item) => (Number(item.score) || 0) >= topScore - 8).slice(0, 8)
                    if (cluster.length === 1) return { kind: 'open', match: cluster[0] }
                    const declCluster = cluster.filter((item) => isStrong(item))
                    if (declCluster.length === 0) {
                      const secondScore = matches.length > 1 ? Number(matches[1].score) || 0 : 0
                      return topScore >= 50 && topScore - secondScore >= 10 ? { kind: 'open', match: top } : { kind: 'none' }
                    }
                    const distinctFiles = new Set(declCluster.map((item) => item.path))
                    if (distinctFiles.size === 1) return { kind: 'open', match: declCluster[0] }
                    return { kind: 'pick', matches: declCluster }
                  }

                  /* ── Cmd 悬停：可跳转时下划线 + 手型光标 ─────────────── */
                  const hover = { meta: false, timer: 0, seq: 0, cache: new Map(), decorationIds: [], lastClient: null, lastPosition: null, lastWordInfo: null, lastKey: '' }
                  const clearHoverDecoration = () => {
                    if (hover.decorationIds.length > 0) {
                      try {
                        hover.decorationIds = instance.deltaDecorations(hover.decorationIds, [])
                      } catch {
                        hover.decorationIds = []
                      }
                    }
                    try {
                      editorDom.classList.remove('gufa-def-hover')
                    } catch {
                      /* ignore */
                    }
                  }
                  const showHoverDecoration = (position, wordInfo) => {
                    if (wordInfo === null || wordInfo === undefined) return clearHoverDecoration()
                    let range = null
                    try {
                      range = new monaco.Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn)
                    } catch {
                      return clearHoverDecoration()
                    }
                    try {
                      hover.decorationIds = instance.deltaDecorations(hover.decorationIds, [
                        { range, options: { inlineClassName: 'gufa-def-link', stickiness: 1 } },
                      ])
                    } catch {
                      /* ignore */
                    }
                    try {
                      editorDom.classList.add('gufa-def-hover')
                    } catch {
                      /* ignore */
                    }
                  }
                  const evaluateHoverPosition = (position, wordInfo) => {
                    if (!hover.meta) {
                      clearHoverDecoration()
                      return
                    }
                    const model = instance.getModel()
                    const word = wordInfo !== null && wordInfo !== undefined && typeof wordInfo.word === 'string' ? wordInfo.word : ''
                    const path = modelPathRef.current
                    const root = modelsRootRef.current
                    if (position === null || position === undefined || model === null || model === undefined
                      || word.length < 2 || path === null || path === undefined || root === null || root === undefined || root === '') {
                      clearHoverDecoration()
                      return
                    }
                    hover.lastPosition = position
                    hover.lastWordInfo = wordInfo
                    const key = `${path}|${word}`
                    hover.lastKey = key
                    const cached = hover.cache.get(key)
                    if (cached === 'none') {
                      clearHoverDecoration()
                      return
                    }
                    if (cached === 'yes') {
                      showHoverDecoration(position, wordInfo)
                      return
                    }
                    if (hover.timer !== 0) {
                      window.clearTimeout(hover.timer)
                      hover.timer = 0
                    }
                    const seq = ++hover.seq
                    hover.timer = window.setTimeout(() => {
                      hover.timer = 0
                      if (!hover.meta || seq !== hover.seq) return
                      void queryDefinitions(position, word, model, path, root).then((result) => {
                        if (!hover.meta || seq !== hover.seq || hover.lastKey !== key) return
                        const decision = decideDefinition(result)
                        if (decision.kind === 'none') {
                          if (hover.cache.size > 100) hover.cache.clear()
                          hover.cache.set(key, 'none')
                          clearHoverDecoration()
                          return
                        }
                        if (hover.cache.size > 100) hover.cache.clear()
                        hover.cache.set(key, 'yes')
                        showHoverDecoration(position, wordInfo)
                      }).catch(() => {
                        /* ignore */
                      })
                    }, 130)
                  }
                  /* 用 Monaco 自己的 onMouseMove（带修饰键状态 + 精确 position），
                     不依赖 DOM mousedown/getTargetAtClientPoint 的坐标系与包含关系。 */
                  const onMonacoMouseMove = (editorEvent) => {
                    if (editorEvent === null || editorEvent === undefined) return
                    const browser = editorEvent.event !== null && editorEvent.event !== undefined ? editorEvent.event.browserEvent : null
                    const mac = typeof G.isMacPlatform === 'function' ? G.isMacPlatform() : true
                    const pressed = browser !== null && browser !== undefined
                      ? (mac ? browser.metaKey === true : browser.ctrlKey === true)
                      : false
                    if (!pressed) {
                      if (hover.meta) {
                        hover.meta = false
                        hover.seq += 1
                        if (hover.timer !== 0) {
                          window.clearTimeout(hover.timer)
                          hover.timer = 0
                        }
                        clearHoverDecoration()
                      }
                      return
                    }
                    hover.meta = true
                    const target = editorEvent.target !== null && editorEvent.target !== undefined ? editorEvent.target : null
                    const position = target !== null ? target.position : null
                    if (position === null || position === undefined) {
                      clearHoverDecoration()
                      return
                    }
                    let wordInfo = null
                    try {
                      const model = instance.getModel()
                      wordInfo = model !== null && model !== undefined ? model.getWordAtPosition(position) : null
                    } catch {
                      wordInfo = null
                    }
                    evaluateHoverPosition(position, wordInfo)
                  }
                  const onMetaDown = (event) => {
                    if (event.key !== 'Meta' && event.key !== 'Control') return
                    if (hover.meta) return
                    hover.meta = true
                    if (hover.lastPosition !== null && hover.lastWordInfo !== null) evaluateHoverPosition(hover.lastPosition, hover.lastWordInfo)
                  }
                  const onMetaUp = (event) => {
                    if (event.key !== 'Meta' && event.key !== 'Control') return
                    hover.meta = false
                    hover.seq += 1
                    if (hover.timer !== 0) {
                      window.clearTimeout(hover.timer)
                      hover.timer = 0
                    }
                    clearHoverDecoration()
                  }
                  const onDefWindowBlur = () => {
                    hover.meta = false
                    clearHoverDecoration()
                  }
                  const hoverSubscriptions = []
                  try {
                    if (typeof instance.onMouseMove === 'function') hoverSubscriptions.push(instance.onMouseMove(onMonacoMouseMove))
                    if (typeof instance.onMouseLeave === 'function') hoverSubscriptions.push(instance.onMouseLeave(() => {
                      hover.meta = false
                      hover.lastPosition = null
                      hover.lastWordInfo = null
                      hover.seq += 1
                      clearHoverDecoration()
                    }))
                    if (typeof instance.onDidChangeModelContent === 'function') hoverSubscriptions.push(instance.onDidChangeModelContent(() => clearHoverDecoration()))
                    if (typeof instance.onDidScrollChange === 'function') hoverSubscriptions.push(instance.onDidScrollChange(() => clearHoverDecoration()))
                  } catch {
                    /* ignore */
                  }
                  for (const subscription of hoverSubscriptions) if (subscription !== null && subscription !== undefined) subscriptions.push(subscription)
                  const onDefinitionClick = async (event) => {
                    try {
                      const currentDom = typeof instance.getDomNode === 'function' ? instance.getDomNode() : null
                      if (currentDom === null || currentDom === undefined || !(event.target instanceof Node) || !currentDom.contains(event.target)) return
                    } catch {
                      return
                    }
                    if (event.button !== 0 || event.defaultPrevented === true) return
                    if (!isPrimaryEvent(event) || event.altKey === true || event.shiftKey === true) return
                    if (event.target instanceof Element && event.target.closest('a') !== null) return
                    let target = null
                    try {
                      target = typeof instance.getTargetAtClientPoint === 'function' ? instance.getTargetAtClientPoint(event.clientX, event.clientY) : null
                    } catch {
                      target = null
                    }
                    const position = target !== null && target !== undefined ? target.position : null
                    const model = instance.getModel()
                    if (position === null || position === undefined || model === null || model === undefined) return
                    let wordInfo = null
                    try {
                      wordInfo = typeof model.getWordAtPosition === 'function' ? model.getWordAtPosition(position) : null
                    } catch {
                      wordInfo = null
                    }
                    const word = wordInfo !== null && wordInfo !== undefined && typeof wordInfo.word === 'string' ? wordInfo.word : ''
                    if (word.length < 2) return
                    const path = modelPathRef.current
                    const root = modelsRootRef.current
                    if (path === null || path === undefined || root === null || root === undefined || root === '') return
                    try {
                      event.preventDefault()
                      event.stopPropagation()
                    } catch {
                      /* ignore */
                    }
                    try {
                      await preloadTsDependencies(model, path, root)
                    } catch {
                      /* ignore */
                    }
                    const beforePath = modelPathRef.current
                    const beforePosition = instance.getPosition()
                    try {
                      const action = typeof instance.getAction === 'function' ? instance.getAction('editor.action.revealDefinition') : null
                      if (action !== null && action !== undefined) {
                        const supported = typeof action.isSupported === 'function' ? action.isSupported() : true
                        if (supported !== false) await action.run()
                      }
                    } catch {
                      /* ignore */
                    }
                    await new Promise((resolve) => { window.setTimeout(resolve, 160) })
                    let monacoHandled = false
                    try {
                      const afterPosition = instance.getPosition()
                      monacoHandled = modelPathRef.current !== beforePath
                        || (beforePosition !== null && beforePosition !== undefined && afterPosition !== null && afterPosition !== undefined
                          && (afterPosition.lineNumber !== beforePosition.lineNumber || afterPosition.column !== beforePosition.column))
                        || document.querySelector('.monaco-editor .peekview-widget, .monaco-editor .reference-zone-widget') !== null
                    } catch {
                      monacoHandled = false
                    }
                    clearHoverDecoration()
                    if (monacoHandled) return
                    try {
                      const result = await queryDefinitions(position, word, model, path, root)
                      const decision = decideDefinition(result)
                      if (decision.kind === 'open') {
                        G.bus.emit('editor:open-at', { path: decision.match.path, line: decision.match.line, column: decision.match.column })
                        return
                      }
                      if (decision.kind === 'pick') {
                        G.bus.emit('definition:pick', {
                          word: result !== null && result !== undefined && typeof result.word === 'string' ? result.word : word,
                          matches: decision.matches,
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }
                    } catch {
                      /* ignore */
                    }
                  }
                  document.addEventListener('mousedown', onDefinitionClick, true)
                  document.addEventListener('keydown', onMetaDown, true)
                  document.addEventListener('keyup', onMetaUp, true)
                  window.addEventListener('blur', onDefWindowBlur)
                  definitionCleanup = () => {
                    document.removeEventListener('mousedown', onDefinitionClick, true)
                    document.removeEventListener('keydown', onMetaDown, true)
                    document.removeEventListener('keyup', onMetaUp, true)
                    window.removeEventListener('blur', onDefWindowBlur)
                    if (hover.timer !== 0) {
                      window.clearTimeout(hover.timer)
                      hover.timer = 0
                    }
                    hover.seq += 1
                    hover.meta = false
                    clearHoverDecoration()
                  }
                }
              } catch {
                /* ignore */
              }
            } catch {
              /* ignore */
            }
            /* ── Copilot 风格 Tab 行内补全（复用 Harness 模型服务） ───────── */
            try {
              if (typeof monaco.languages.registerInlineCompletionsProvider === 'function') {
                const inlineLanguages = ['python', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'java', 'go', 'rust', 'csharp', 'cpp', 'c', 'shell', 'json', 'yaml', 'sql', 'html', 'css']
                const inlineCache = new Map()
                let inlineLastRequestAt = 0
                const inlineProvider = {
                  provideInlineCompletions(model, position, context, token) {
                    /* AI Tab 补全已默认关闭：结果质量差、且每次请求会增加延迟。
                       需要重新开启时把此处的 return 去掉，并把 inlineSuggest.enabled 改回 true。 */
                    return Promise.resolve({ items: [] })
                    // eslint-disable-next-line no-unreachable
                    const path = modelPathRef.current
                    const root = modelsRootRef.current
                    if (path === null || path === undefined || root === null || root === undefined || root === '') {
                      return Promise.resolve({ items: [] })
                    }
                    if (token !== null && token !== undefined && token.isCancellationRequested === true) return Promise.resolve({ items: [] })
                    return new Promise((resolve) => {
                      let settled = false
                      const finish = (value) => {
                        if (settled) return
                        settled = true
                        resolve(value)
                      }
                      const timer = window.setTimeout(() => {
                        void (async () => {
                          try {
                            if (token !== null && token !== undefined && token.isCancellationRequested === true) return finish({ items: [] })
                            const now = Date.now()
                            if (now - inlineLastRequestAt < 500) return finish({ items: [] })
                            inlineLastRequestAt = now
                            const language = typeof model.getLanguageId === 'function' ? model.getLanguageId() : ''
                            if (!inlineLanguages.includes(language)) return finish({ items: [] })
                            const lineCount = model.getLineCount()
                            const startLine = Math.max(1, position.lineNumber - 140)
                            const endLine = Math.min(lineCount, position.lineNumber + 30)
                            const endColumn = model.getLineMaxColumn(endLine)
                            let prefix = ''
                            let suffix = ''
                            try {
                              prefix = model.getValueInRange(new monaco.Range(startLine, 1, position.lineNumber, position.column)).slice(-3200)
                              suffix = model.getValueInRange(new monaco.Range(position.lineNumber, position.column, endLine, endColumn)).slice(0, 800)
                            } catch {
                              return finish({ items: [] })
                            }
                            const version = typeof model.getVersionId === 'function' ? model.getVersionId() : 0
                            const cacheKey = `${path}|${version}|${position.lineNumber}:${position.column}|${language}`
                            const cached = inlineCache.get(cacheKey)
                            if (cached !== undefined) return finish(cached)
                            const value = await G.api('completion.suggest', { root, path, language, prefix, suffix })
                            if (token !== null && token !== undefined && token.isCancellationRequested === true) return finish({ items: [] })
                            const text = value !== null && value !== undefined && typeof value.text === 'string' ? value.text : ''
                            const result = text === ''
                              ? { items: [] }
                              : { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] }
                            if (inlineCache.size > 30) inlineCache.clear()
                            inlineCache.set(cacheKey, result)
                            finish(result)
                          } catch {
                            finish({ items: [] })
                          }
                        })()
                      }, 260)
                      if (token !== null && token !== undefined && typeof token.onCancellationRequested === 'function') {
                        token.onCancellationRequested(() => {
                          window.clearTimeout(timer)
                          finish({ items: [] })
                        })
                      }
                    })
                  },
                  freeInlineCompletions() {},
                }
                const inlineDisposable = monaco.languages.registerInlineCompletionsProvider(inlineLanguages, inlineProvider)
                if (inlineDisposable !== null && inlineDisposable !== undefined && typeof inlineDisposable.dispose === 'function') subscriptions.push(inlineDisposable)
              }
            } catch {
              /* ignore */
            }

            /* 外部/AI 修改磁盘后由 App 轮询发现，通过 bus 通知编辑器热替换 model 内容 */
            try {
              if (G.bus !== null && G.bus !== undefined && typeof G.bus.on === 'function') {
                const offExternalReload = G.bus.on('editor:external-reload', (detail) => {
                  if (detail === null || detail === undefined || typeof detail.path !== 'string' || typeof detail.content !== 'string') return
                  const target = modelsRef.current.get(detail.path)
                  if (target === null || target === undefined) return
                  let content = ''
                  try {
                    content = target.getValue()
                  } catch {
                    return
                  }
                  if (content === detail.content) return
                  const active = modelPathRef.current === detail.path
                  let position = null
                  let scrollTop = 0
                  if (active) {
                    try {
                      position = instance.getPosition()
                      scrollTop = instance.getScrollTop()
                    } catch {
                      position = null
                    }
                  }
                  suppressChangeRef.current = true
                  try {
                    target.setValue(detail.content)
                  } finally {
                    suppressChangeRef.current = false
                  }
                  lastPropContentRef.current.set(detail.path, detail.content)
                  if (active && position !== null && position !== undefined) {
                    try {
                      instance.setPosition(position)
                      instance.setScrollTop(scrollTop)
                    } catch {
                      /* ignore */
                    }
                  }
                })
                if (typeof offExternalReload === 'function') subscriptions.push({ dispose: offExternalReload })
              }
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
        const knownContent = lastPropContentRef.current.get(tab.path)
        if (knownContent !== content) {
          lastPropContentRef.current.set(tab.path, content)
          if (model.getValue() !== content) {
            /* 用户在编辑器里持续输入时，App 的 tabs 状态可能落后（内容缓冲/React 批处理）。
               如果当前 model 正好还是上次上报的内容，说明这是「状态落后」而不是外部修改，
               绝不能 setValue 回灌旧内容——否则光标会跳回开头、刚输入的字符也会被覆盖。
               外部修改（如切回文件、外部刷新）通常发生在编辑器没有焦点时，仍然照常同步。 */
            const modelValue = model.getValue()
            const modelMatchesKnown = knownContent === undefined || knownContent === null || knownContent === modelValue
            const focused = typeof editor.hasTextFocus === 'function' ? editor.hasTextFocus() : false
            if (!(focused && modelMatchesKnown)) {
              suppressChangeRef.current = true
              try {
                model.setValue(content)
              } finally {
                suppressChangeRef.current = false
              }
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
          const pending = pendingRevealRef.current
          if (pending !== null && pending !== undefined && pending.path === targetTab.path) {
            pendingRevealRef.current = null
            try {
              editor.setPosition({ lineNumber: pending.line, column: pending.column })
              editor.revealLineInCenter(pending.line)
              editor.focus()
            } catch {
              /* ignore */
            }
          }
          /* 打开 Python 文件时预热 pyright，避免第一次 Cmd+点击等语言服务启动 */
          if (targetTab.language === 'python' && !GUFA_LSP_WARMED.has(root)) {
            GUFA_LSP_WARMED.add(root)
            void G.api('lsp.warm', { root }).catch(() => { GUFA_LSP_WARMED.delete(root) })
          }
          /* JS/TS：切到文件后后台预加载 import 依赖，点 Cmd+点击时 Monaco 已有跨文件 model，少等网络 */
          if (targetTab.language === 'typescript' || targetTab.language === 'javascript') {
            const modelForPreload = targetModel
            const pathForPreload = targetTab.path
            window.setTimeout(() => {
              try {
                if (tsPreloadRef.current !== null) void tsPreloadRef.current(modelForPreload, pathForPreload, root)
              } catch {
                /* ignore */
              }
            }, 200)
          }
          /* 打开/切换文件不抢焦点：只有用户点击编辑区时才进入键盘编辑 */
        }
      } else if (targetTab !== null) {
        modelPathRef.current = targetTab.path
      }
    }, [status, tabs, activePath, root, reportCursor, disposeAllModels, disposeModelAt])

    /* 搜索面板点击结果 → 打开文件并跳到对应行列（由 App 通过 bus 发来） */
    useEffect(() => {
      if (G.bus === null || G.bus === undefined || typeof G.bus.on !== 'function') return undefined
      return G.bus.on('editor:reveal', (detail) => {
        const editor = editorRef.current
        if (editor === null || editor === undefined) return
        const rawLine = Number(detail?.line)
        const rawColumn = Number(detail?.column)
        const line = Number.isFinite(rawLine) ? Math.max(1, Math.trunc(rawLine)) : 1
        const column = Number.isFinite(rawColumn) ? Math.max(1, Math.trunc(rawColumn)) : 1
        const path = typeof detail?.path === 'string' && detail.path !== '' ? detail.path : null
        if (path !== null && modelPathRef.current !== path) {
          pendingRevealRef.current = { path, line, column }
          return
        }
        try {
          editor.setPosition({ lineNumber: line, column })
          editor.revealLineInCenter(line)
          editor.focus()
        } catch (error) {
          /* ignore */
        }
      })
    }, [])

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

  /* 光标事件外部 store：App 不再为每次光标移动重渲染整个 IDE，状态栏订阅即可。 */
  G.cursorStore = (() => {
    const listeners = new Set()
    let value = null
    return {
      get: () => value,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set: (next) => {
        if (value === next) return
        if (value !== null && next !== null &&
            value.path === next.path && value.line === next.line && value.column === next.column &&
            value.lineCount === next.lineCount && value.selectedText === next.selectedText) return
        value = next
        for (const listener of [...listeners]) {
          try {
            listener(next)
          } catch {
            /* 订阅者异常不影响编辑器 */
          }
        }
      },
    }
  })()
  G.useCursorStore = function useCursorStore() {
    const [snapshot, setSnapshot] = React.useState(G.cursorStore.get())
    React.useEffect(() => {
      setSnapshot(G.cursorStore.get())
      return G.cursorStore.subscribe(setSnapshot)
    }, [])
    return snapshot
  }
  /* 状态栏行数/光标：只订阅 cursorStore，光标移动不会触发 App 根组件重渲染。 */
  G.StatusCursor = function StatusCursor(props) {
    const activePath = props !== null && props !== undefined ? props.activePath : null
    const fallbackLineCount = props !== null && props !== undefined && Number.isFinite(props.fallbackLineCount) ? props.fallbackLineCount : 0
    const cursor = G.useCursorStore()
    const matched = cursor !== null && cursor.path === activePath
    const lineCount = matched && Number.isFinite(cursor.lineCount) ? cursor.lineCount : fallbackLineCount
    const cursorText = matched ? `${G.t('status.ln')} ${cursor.line}，${G.t('status.col')} ${cursor.column}` : ''
    return React.createElement(React.Fragment, null,
      activePath !== null ? React.createElement('span', { className: 'gufa-status-item' }, `${lineCount} ${G.t('status.lines')}`) : null,
      cursorText !== '' ? React.createElement('span', { className: 'gufa-status-item' }, cursorText) : null,
    )
  }
  /* EditorPane 只在 props 真正变化时重渲染（光标移动不再穿透到 Monaco 外层）。 */
  G.EditorPane = typeof React.memo === 'function' ? React.memo(GufaEditorPaneComponent) : GufaEditorPaneComponent

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

#!/usr/bin/env node
/**
 * Client 半烟雾测试（无浏览器）：
 * - 在受控沙箱里执行构建产物 client.js，取出 lazy factory 并调用；
 * - 用假 React / 假文档调用 apply(ctx)，断言 sidebar.panellist / main / sidebar.footer.action / locale 注册；
 * - 逐个执行面板组件的函数体（假 hooks），捕获明显的未定义引用/逻辑崩溃。
 *
 * 注意：不能替代真实浏览器渲染验证。
 * 用法：node scripts/selftest-client.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const code = readFileSync(join(root, 'client.js'), 'utf8')

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failed += 1
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/* ── 假 React ─────────────────────────────────────────────────────────── */
const Fragment = Symbol('Fragment')
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
const React = {
  Fragment,
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (value) => ({ current: value }),
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  memo: (fn) => fn,
}

/* ── 假 DOM / 浏览器 API ──────────────────────────────────────────────── */
const styleTags = []
const documentStub = {
  body: { hasAttribute: () => false, appendChild: () => {} },
  head: { append: (node) => styleTags.push(node) },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => ({ tag, dataset: {}, style: {}, setAttribute() {}, remove() {}, textContent: '' }),
}
const localStorageStub = {
  store: new Map(),
  getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
  setItem(key, value) { this.store.set(key, String(value)) },
  removeItem(key) { this.store.delete(key) },
}
const locationStub = { protocol: 'http:', host: '127.0.0.1:53091' }
const windowStub = {
  __ModuleLoader__: { load(definition) { windowStub.__definition = definition } },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  addEventListener: () => {},
  removeEventListener: () => {},
  monaco: undefined,
  require: undefined,
}
const fetchStub = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: null }) })
class TextDecoderStub {
  decode(value) { return String(value) }
}
class AbortControllerStub {
  constructor() { this.signal = { aborted: false } }
  abort() { this.signal.aborted = true }
}
class MutationObserverStub {
  observe() {}
  disconnect() {}
}

/* ── 执行 bundle，拿到 factory ────────────────────────────────────────── */
new Function(
  'window', 'document', 'localStorage', 'location', 'fetch', 'TextDecoder', 'AbortController', 'MutationObserver', 'console',
  code,
)(windowStub, documentStub, localStorageStub, locationStub, fetchStub, TextDecoderStub, AbortControllerStub, MutationObserverStub, console)

check('bundle registers a module definition', windowStub.__definition !== undefined)
const definition = windowStub.__definition ?? {}
check('module id is dsh-gufa-code', definition.id === 'dsh-gufa-code', definition.id)
check('factory is a function', typeof definition.factory === 'function')

let requireError = ''
const plugin = definition.factory((name) => {
  if (name === 'react') return React
  requireError = `unexpected require: ${name}`
  throw new Error(requireError)
})
check('factory returned a plugin', plugin !== undefined && typeof plugin.apply === 'function', String(plugin))

/* ── 假 Cordis ctx + slots ────────────────────────────────────────────── */
const registrations = []
const localeRegistrations = []
const slotApi = {
  inject(owner, callback) {
    const effect = callback()
    return typeof effect === 'function' ? effect : () => {}
  },
  register(options, component) {
    registrations.push({ options, component })
    return () => {}
  },
}
const localeApi = {
  register(ns, dicts) {
    localeRegistrations.push({ ns, dicts })
    return () => {}
  },
  bind(ns) {
    return (key) => key
  },
  subscribe() {
    return () => {}
  },
}
const effects = []
const ctx = {
  get(name) {
    if (name === 'locale') return localeApi
    if (name === 'slots') return slotApi
    if (name === 'layout') return { selectPanel() {} }
    if (name === 'uiWorkspace') return { pickDirectory: async () => null }
    return undefined
  },
  effect(fn) {
    const dispose = fn()
    effects.push(typeof dispose === 'function' ? dispose : () => {})
    return () => {}
  },
  inject(names, callback) {
    const scope = {
      slots: slotApi,
      get: ctx.get,
      effect: ctx.effect,
    }
    callback(scope)
    return () => {}
  },
}
plugin.apply(ctx)

const mainPanel = registrations.find((item) => item.options.name === 'main')
const overlay = registrations.find((item) => item.options.name === 'shell.overlay')
check('no top-level sidebar.panellist entry', registrations.every((item) => item.options.name !== 'sidebar.panellist'))
check('no sidebar.panellist.actions entry', registrations.every((item) => item.options.name !== 'sidebar.panellist.actions'))
check('no sidebar.footer.action entry', registrations.every((item) => item.options.name !== 'sidebar.footer.action'))
check('registered main redirect', mainPanel !== undefined && mainPanel.options.key === 'gufa-code')
check('registered shell.overlay IDE host', overlay !== undefined && overlay.options.id === 'gufa-code-overlay')
check('registered locale dictionary', localeRegistrations.some((item) => item.ns === 'gufa-code' && item.dicts.zh !== undefined))
check('injected styles', styleTags.length === 1, String(styleTags.length))

/* ── 组件函数体烟雾渲染（假 hooks；不验证真实渲染结果） ─────────────────── */
function smoke(name, fn) {
  try {
    fn()
    check(`render body: ${name}`, true)
  } catch (error) {
    check(`render body: ${name}`, false, error instanceof Error ? `${error.message}` : String(error))
  }
}

// 调试句柄暴露了 G（也方便浏览器控制台排查）
const G = windowStub.__GUFA_CODE__?.G
check('debug handle exposes G', G !== undefined && typeof G === 'object')

check('workspace menu injector exposed', typeof G.installWorkspaceMenuEntry === 'function')
check('GufaApp is a component function', typeof mainPanel.component === 'function')

if (G !== undefined) {
  const tabs = [
    { path: 'src/app.ts', content: 'export const x = 1\n', language: 'typescript', revision: 'r1', dirty: false },
    { path: 'README.md', content: '# hi\n', language: 'markdown', revision: 'r2', dirty: true },
  ]
  const file = { path: 'src/app.ts', content: 'export const x = 1\n', language: 'typescript' }
  const project = { root: '/tmp/gufa-smoke', name: 'gufa-smoke', isGit: true }
  smoke('Explorer', () => G.Explorer({ root: project.root, activePath: 'src/app.ts', refreshToken: 0, gitStatuses: { 'src/app.ts': 'M' }, onOpenFile() {}, onNewFile() {}, onNewFolder() {}, onRename() {}, onDelete() {} }))
  smoke('Explorer (no project)', () => G.Explorer({ root: null, activePath: null, refreshToken: 0, gitStatuses: {}, onOpenFile() {}, onNewFile() {}, onNewFolder() {}, onRename() {}, onDelete() {} }))
  smoke('GitPanel', () => G.GitPanel({ root: project.root, refreshToken: 0, onStatus() {}, onOpenFile() {}, onChanged() {} }))
  smoke('SshPanel', () => G.SshPanel({ refreshToken: 0, onConnect() {} }))
  smoke('EditorPane (file)', () => G.EditorPane({ tabs, activePath: 'src/app.ts', theme: 'dark', root: project.root, onSelectTab() {}, onCloseTab() {}, onChange() {}, onSave() {}, onCursor() {} }))
  smoke('EditorPane (empty)', () => G.EditorPane({ tabs: [], activePath: null, theme: 'light', root: project.root, onSelectTab() {}, onCloseTab() {}, onChange() {}, onSave() {}, onCursor() {} }))
  smoke('TerminalPane', () => G.TerminalPane({ root: project.root, visible: true, height: 220, theme: 'dark', onToggleHeight() {} }))
  smoke('TerminalPane (no project)', () => G.TerminalPane({ root: null, visible: false, height: 220, theme: 'light', onToggleHeight() {} }))
  smoke('ChatPanel (fallback)', () => G.ChatPanel({ project, activeFile: file, selection: { text: 'x = 1', path: 'src/app.ts', line: 1, column: 1 }, theme: 'dark', width: 360, onInsertCode() {} }))
  smoke('ChatPanel (empty)', () => G.ChatPanel({ project: null, activeFile: null, selection: null, theme: 'light', width: 360, onInsertCode() {} }))
  smoke('ChatDock', () => G.ChatDock({ project, activeFile: file, selection: { text: 'x = 1', path: 'src/app.ts', line: 1, column: 1 }, theme: 'dark', width: 360, active: false, onInsertCode() {}, onClose() {} }))
  smoke('ChatDock (no project)', () => G.ChatDock({ project: null, activeFile: null, selection: null, theme: 'light', width: 360, active: true, onInsertCode() {} }))
  smoke('OverlayHost (hidden)', () => G.OverlayHost({ useSessions: () => null }))
  smoke('MainRedirect', () => G.MainRedirect({}))
  check('UsageDock exists', typeof G.UsageDock === 'function')
  smoke('UsageDock', () => G.UsageDock({ active: true }))
  check('mode store present', typeof G.mode?.set === 'function' && typeof G.mode?.toggle === 'function' && typeof G.enterGufa === 'function')
  check('mode default off', G.mode.get() === false)
  G.mode.set(true)
  check('mode toggle on', G.mode.get() === true && localStorageStub.getItem('gufa-code:mode:v1') === '1')
  G.mode.set(false)
}

// 通过 fake hooks 直接调用主组件函数体（会执行 hooks 与首次渲染分支）
try {
  mainPanel.component({
    useSessions: () => null,
    usePanelInfo: () => ({ activePanelId: 'gufa-code' }),
  })
  check('render body: GufaApp', true)
} catch (error) {
  check('render body: GufaApp', false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error))
}

/* ── 组件引用检查：h(SomeComponent) 必须是本文件的函数声明或 G.* 挂载 ───────── */
{
  const partFiles = ['10-icons.js', '20-editor.js', '30-terminal.js', '40-chat.js', '50-panels.js', '55-backdrop.js', '60-dock.js', '90-app.js']
  for (const file of partFiles) {
    let source = ''
    try {
      source = readFileSync(join(root, 'src', 'client', file), 'utf8')
    } catch {
      continue
    }
    const names = [...source.matchAll(/h\(\s*([A-Z][A-Za-z0-9_]*)\s*[,)]/g)].map((match) => match[1])
    for (const name of [...new Set(names)]) {
      const declared = new RegExp(`function\\s+${name}\\b`).test(source)
      const exposed = source.includes(`G.${name} =`) || source.includes(`G.${name}=`)
      check(`component ref ${file}: ${name} 有定义`, declared || exposed, declared || exposed ? '' : '未定义的裸组件引用')
    }
  }
}

/* ── IDE 专属快捷键（参考 VS Code） ──────────────────────────────────────── */
if (windowStub.__GUFA_CODE__?.G?.shortcutAction !== undefined) {
  const G0 = windowStub.__GUFA_CODE__.G
  const mac = G0.isMacPlatform()
  const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '', code: '' }
  const mod = (patch) => (mac ? { ...base, metaKey: true, ...patch } : { ...base, ctrlKey: true, ...patch })
  check('shortcut: Cmd/Ctrl+K = clearTerminal', G0.shortcutAction(mod({ key: 'k', code: 'KeyK' })) === 'clearTerminal')
  check('shortcut: Cmd/Ctrl+S = save', G0.shortcutAction(mod({ key: 's', code: 'KeyS' })) === 'save')
  check('shortcut: Cmd/Ctrl+J = toggleTerminal', G0.shortcutAction(mod({ key: 'j', code: 'KeyJ' })) === 'toggleTerminal')
  check('shortcut: Cmd/Ctrl+` = toggleTerminal', G0.shortcutAction(mod({ code: 'Backquote' })) === 'toggleTerminal')
  check('shortcut: Cmd/Ctrl+B = toggleSidebar', G0.shortcutAction(mod({ key: 'b', code: 'KeyB' })) === 'toggleSidebar')
  check('shortcut: Cmd/Ctrl+W = closeTab', G0.shortcutAction(mod({ key: 'w', code: 'KeyW' })) === 'closeTab')
  check('shortcut: Shift+Cmd/Ctrl+E/G/H = panels',
    G0.shortcutAction(mod({ key: 'e', code: 'KeyE', shiftKey: true })) === 'panelExplorer' &&
    G0.shortcutAction(mod({ key: 'g', code: 'KeyG', shiftKey: true })) === 'panelGit' &&
    G0.shortcutAction(mod({ key: 'h', code: 'KeyH', shiftKey: true })) === 'panelSsh')
  check('shortcut: Cmd/Ctrl+Shift+F = panelSearch', G0.shortcutAction(mod({ key: 'f', code: 'KeyF', shiftKey: true })) === 'panelSearch')
  check('shortcut: Shift+Cmd/Ctrl+` = newTerminal', G0.shortcutAction(mod({ code: 'Backquote', shiftKey: true })) === 'newTerminal')
  check('shortcut: Cmd/Ctrl+/ = shortcuts help', G0.shortcutAction(mod({ key: '/', code: 'Slash' })) === 'shortcuts')
  check('shortcut: no modifier ignored', G0.shortcutAction({ ...base, key: 'k', code: 'KeyK' }) === null)
  check('shortcut: Alt modifier ignored', G0.shortcutAction(mod({ key: 'k', code: 'KeyK', altKey: true })) === null)
  check('shortcut list has clearTerminal', Array.isArray(G0.SHORTCUTS) && G0.SHORTCUTS.some((entry) => entry.action === 'clearTerminal'))
  check('shortcut key text renders', mac ? G0.shortcutKeyText(G0.SHORTCUTS[0]) === '⌘S' : G0.shortcutKeyText(G0.SHORTCUTS[0]) === 'Ctrl+S', G0.shortcutKeyText(G0.SHORTCUTS[0]))
}

/* ── Git Graph 泳道布局 ─────────────────────────────────────────────────── */
if (windowStub.__GUFA_CODE__?.G?.gitGraphLayout !== undefined) {
  const G0 = windowStub.__GUFA_CODE__.G
  const layout = G0.gitGraphLayout([
    { hash: 'c3', parents: ['c2'], subject: 'third' },
    { hash: 'c2', parents: ['c1', 'b1'], subject: 'merge' },
    { hash: 'c1', parents: [], subject: 'first' },
    { hash: 'b1', parents: ['c1'], subject: 'branch' },
  ])
  check('gitGraphLayout rows', layout.rows.length === 4 && layout.laneCount >= 2)
  check('gitGraphLayout hashRow', layout.hashRow.get('c1') === 2 && layout.hashRow.get('c3') === 0)
  check('gitGraphLayout merge row', layout.rows[1].commit.parents.length === 2 && layout.rows[1].lane === 0)
  const single = G0.gitGraphLayout([{ hash: 'a', parents: [] }])
  check('gitGraphLayout single commit', single.laneCount === 1 && single.rows[0].lane === 0)
  smoke('GitGraphView (no project)', () => G0.GitGraphView({ root: null, refreshToken: 0 }))
}

/* ── 代码区跟随滑动变祖配色（Monaco 动态主题 + 调色板 store） ─────────────── */
if (windowStub.__GUFA_CODE__?.G?.paletteStore !== undefined) {
  const G0 = windowStub.__GUFA_CODE__.G
  const seen = []
  const off = G0.paletteStore.subscribe((value) => seen.push(value))
  const first = { bg: 'rgb(30, 28, 24)' }
  G0.paletteStore.set(first)
  check('palette store publishes', seen.length === 1 && seen[0] === first)
  off()
  G0.paletteStore.set({ bg: 'rgb(1, 2, 3)' })
  check('palette store unsubscribe', seen.length === 1)
  const internals = G0.EditorPane?.internals
  check('editor internals expose skinMonacoTheme', typeof internals?.skinMonacoTheme === 'function')
  const darkSkin = internals.skinMonacoTheme({
    bg: 'rgb(30, 28, 24)', text: 'rgb(236, 238, 241)', textDim: 'rgb(160, 160, 160)',
    layer: 'rgb(50, 48, 44)', layer2: 'rgb(60, 57, 52)', accent: 'rgb(193, 154, 73)', isDark: true,
  })
  check('skin monaco theme dark generated', darkSkin !== null && darkSkin.data.base === 'vs-dark' && darkSkin.data.colors['editor.background'] === '#1e1c18', JSON.stringify(darkSkin?.data?.colors?.['editor.background']))
  check('skin monaco theme uses accent for cursor/selection', darkSkin.data.colors['editorCursor.foreground'] === '#c19a49' && String(darkSkin.data.colors['editor.selectionBackground']).startsWith('#c19a49'), darkSkin.data.colors['editorCursor.foreground'])
  check('skin monaco theme uses skin foreground', darkSkin.data.colors['editor.foreground'] === '#eceef1')
  const lightSkin = internals.skinMonacoTheme({
    bg: 'rgb(248, 248, 244)', text: 'rgb(24, 26, 30)', textDim: 'rgb(92, 98, 106)',
    layer: 'rgb(238, 239, 235)', layer2: 'rgb(224, 224, 218)', accent: 'rgb(181, 43, 36)', isDark: false,
  })
  check('skin monaco theme light generated', lightSkin !== null && lightSkin.data.base === 'vs' && lightSkin.data.colors['editor.background'] === '#f8f8f4')
  check('skin monaco theme rejects empty palette', internals.skinMonacoTheme(null) === null && internals.skinMonacoTheme({}) === null)
}

/* ── 梁圣皮肤背景读取（皮肤 DOM/样式 → IDE 背景层） ─────────────────────── */
if (windowStub.__GUFA_CODE__?.G?.__backdrop !== undefined) {
  const B = windowStub.__GUFA_CODE__.G.__backdrop
  check('backdrop unavailable without skin', B.read().available === false)
  const skinImg = { src: 'https://127.0.0.1/plugins/skin/assets/portrait-source-v2/stage-02.webp', currentSrc: '' }
  const skinNode = {
    getAttribute(name) {
      return name === 'data-media' ? 'sequence' : name === 'data-mask' ? 'on' : null
    },
    querySelector() {
      return skinImg
    },
  }
  documentStub.querySelector = (selector) => (selector === '.liang-skin-backdrop' ? skinNode : null)
  documentStub.body.hasAttribute = (name) => name === 'data-liang-skin'
  windowStub.getComputedStyle = (element) => {
    if (element === skinNode) return { backgroundColor: 'rgb(24, 26, 30)', backgroundImage: 'none' }
    return { display: 'block', opacity: '0.62', transform: 'matrix(1.5, 0, 0, 1.5, 0, 0)' }
  }
  const meta = B.read()
  check('backdrop reads skin meta', meta.available === true && meta.pageColor === 'rgb(24, 26, 30)' && meta.portraitSrc.endsWith('stage-02.webp'), JSON.stringify(meta))
  check('backdrop reads portrait opacity/scale', Math.abs(meta.portraitOpacity - 0.62) < 1e-6 && Math.abs(meta.portraitScale - 1.5) < 1e-6, JSON.stringify(meta))
  check('backdrop reads mask flag', meta.mask === true)
  const G2 = windowStub.__GUFA_CODE__.G
  const rendered = G2.SkinBackdrop({ meta, enabled: true })
  check('backdrop renders layer', rendered !== null && rendered.type === 'div' && rendered.props.className === 'gufa-backdrop')
  check('backdrop renders portrait image', JSON.stringify(rendered.children).includes('gufa-backdrop-portrait'))
  check('backdrop disabled renders nothing', G2.SkinBackdrop({ meta, enabled: false }) === null)
  const strong = G2.SkinBackdrop({ meta, enabled: true, strength: 30 })
  const strongImg = strong.children.find((child) => child !== null && child.props !== undefined && child.props.className === 'gufa-backdrop-portrait')
  check('backdrop strength scales portrait opacity', strongImg !== undefined && Math.abs(strongImg.props.style.opacity - 0.3) < 1e-6, JSON.stringify(strongImg?.props?.style))
  const slider = G2.BackdropStrengthSlider({ value: 42, onChange() {}, onReset() {} })
  check('strength slider renders range input', slider.props.className === 'gufa-strength' && slider.children[1].props.type === 'range' && slider.children[1].props.value === 42)
  check('strength pref persists', (() => {
    G2.backdropStrengthPref.set(66)
    const stored = G2.backdropStrengthPref.get()
    G2.backdropStrengthPref.set(null)
    return stored === 66 && G2.backdropStrengthPref.get() === null
  })())
  // 还原桩
  documentStub.querySelector = () => null
  documentStub.body.hasAttribute = () => false
  delete windowStub.getComputedStyle
}

/* ── 滑动变祖「31 档细分」：只开一次、可读回、写 marker ─────────────────── */
if (windowStub.__GUFA_CODE__?.G?.ensureSkinFineStops !== undefined) {
  const G3 = windowStub.__GUFA_CODE__.G
  localStorageStub.removeItem('dsh-liang-intensity-skin.settings.v1')
  localStorageStub.removeItem('gufa-code:skin-fine-stops:v1')
  const first = G3.ensureSkinFineStops()
  check('fine stops applied on first run', first.applied === true, JSON.stringify(first))
  check('fine stops readable', G3.readSkinFineStops() === true)
  check('fine stops keeps other defaults', (() => {
    const raw = localStorageStub.getItem('dsh-liang-intensity-skin.settings.v1')
    const record = raw === null ? null : JSON.parse(raw)
    return record !== null && record.version === 1 && record.values.fineStopsEnabled === true && record.values.bindEffort === true && record.values.hideSlider === false
  })())
  const second = G3.ensureSkinFineStops()
  check('fine stops applied only once', second.applied === false, JSON.stringify(second))
  localStorageStub.removeItem('dsh-liang-intensity-skin.settings.v1')
  localStorageStub.removeItem('gufa-code:skin-fine-stops:v1')
}

/* ── 不透明配色（皮肤把主题 token 变透明时的适配） ────────────────────── */
if (windowStub.__GUFA_CODE__?.G?.__palette !== undefined) {
  const P = windowStub.__GUFA_CODE__.G.__palette
  const rgb = P.parseCssColor('rgba(10, 20, 30, 0.5)')
  check('palette parses rgba', rgb !== null && rgb[0] === 10 && rgb[1] === 20 && rgb[2] === 30 && Math.abs(rgb[3] - 0.5) < 1e-6, JSON.stringify(rgb))
  check('palette parses transparent', (P.parseCssColor('transparent') ?? [1])[3] === 0)
  check('palette parses hex', JSON.stringify(P.parseCssColor('#ff8800')) === JSON.stringify([255, 136, 0, 1]))
  const mixed = P.compositeColor([255, 255, 255, 0.5], [0, 0, 0, 1])
  check('palette composites translucent over opaque', mixed[0] === 128 && mixed[1] === 128 && mixed[2] === 128 && mixed[3] === 1, JSON.stringify(mixed))
  const opaque = P.compositeColor([10, 20, 30, 0], [200, 100, 50, 1])
  check('palette treats transparent as backdrop', opaque[0] === 200 && opaque[1] === 100 && opaque[2] === 50)
  const fallback = P.resolveSolidPalette(null)
  check('palette fallback returns opaque bg', P.parseCssColor(fallback.bg)?.[3] === 1 && P.parseCssColor(fallback.layer)?.[3] === 1 && P.parseCssColor(fallback.overlay)?.[3] === 1, JSON.stringify(fallback))
}

/* ── 停靠逻辑：官方会话浮到右侧 AI 栏 / 还原 / 定位修正 ─────────────────── */
if (windowStub.__GUFA_CODE__?.G?.__dock !== undefined) {
  const D = windowStub.__GUFA_CODE__.G.__dock

  function fakeElement(kind, rect, offset) {
    const attributes = new Map()
    const style = {
      setProperty(name, value) {
        style[name] = value
      },
      removeProperty(name) {
        delete style[name]
      },
    }
    const node = {
      style,
      getBoundingClientRect() {
        if (kind === 'host') return { ...rect }
        const left = Number.parseFloat(style.left || '0') + (offset?.x ?? 0)
        const top = Number.parseFloat(style.top || '0') + (offset?.y ?? 0)
        return { left, top, width: Number.parseFloat(style.width || String(rect.width)), height: Number.parseFloat(style.height || String(rect.height)) }
      },
      getAttribute(name) {
        return attributes.has(name) ? attributes.get(name) : null
      },
      setAttribute(name, value) {
        attributes.set(name, String(value))
      },
      removeAttribute(name) {
        if (name === 'style') {
          for (const key of Object.keys(style)) {
            if (key !== 'setProperty' && key !== 'removeProperty') delete style[key]
          }
        }
        attributes.delete(name)
      },
    }
    return node
  }

  const conversation = fakeElement('target', { left: 0, top: 0, width: 0, height: 0 })
  const host = fakeElement('host', { left: 800, top: 44, width: 360, height: 700 })
  const saved = D.snapshot(conversation)
  check('dock snapshot before place', saved.style === null && saved.dock === null)
  check('dock placement succeeds', D.placeDockedConversation(conversation, host) === true)
  check('dock uses fixed positioning', conversation.style.position === 'fixed')
  check('dock aligns to host rect', conversation.style.left === '800px' && conversation.style.top === '44px' && conversation.style.width === '360px' && conversation.style.height === '700px', JSON.stringify(conversation.style))
  check('dock z-index above frame overlay layer', Number(conversation.style.zIndex) > 20, conversation.style.zIndex)
  check('dock narrow-width custom props', conversation.style['--dsh-chat-user-width'] === 'calc(100% - 24px)' && conversation.style['--dsh-conversation-column-width'] === '360px')
  check('dock marker attribute', conversation.getAttribute('data-gufa-dock') === '1')
  D.restore(conversation, saved)
  check('undock removes marker', conversation.getAttribute('data-gufa-dock') === null)
  check('undock clears inline styles', Object.keys(conversation.style).filter((key) => key !== 'setProperty' && key !== 'removeProperty').length === 0, JSON.stringify(Object.keys(conversation.style)))

  documentStub.querySelector = (selector) => (selector === '[data-conversation-scroll]' ? { closest: () => conversation } : null)
  check('finder locates conversation root', D.findConversationRoot() === conversation)
  documentStub.querySelector = () => null
  check('finder returns null without conversation', D.findConversationRoot() === null)

  // position:fixed 被祖先 transform 影响时的补偿
  const shiftedConversation = fakeElement('target', { left: 0, top: 0, width: 0, height: 0 }, { x: -120, y: -40 })
  const host2 = fakeElement('host', { left: 700, top: 40, width: 380, height: 640 })
  const saved2 = D.snapshot(shiftedConversation)
  D.placeDockedConversation(shiftedConversation, host2)
  const actual = shiftedConversation.getBoundingClientRect()
  check('dock corrects transformed containing block', Math.abs(actual.left - 700) <= 1 && Math.abs(actual.top - 40) <= 1, JSON.stringify(actual))
  D.restore(shiftedConversation, saved2)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

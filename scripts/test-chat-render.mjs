#!/usr/bin/env node
/**
 * 聊天面板「渲染冒烟」测试：用最小 React 运行时替身执行 40-chat.js 的组件树，
 * 在没有浏览器的情况下捕捉渲染期错误（hook 顺序、TDZ、缺失的 G.* API 等）。
 *
 * 运行：node scripts/test-chat-render.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`  ✗ ${name}\n    ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  }
}

/* ── 浏览器环境替身 ─────────────────────────────────────────────────── */

const FRAGMENT = Symbol('fragment')
const cleanups = []

function installDom() {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  }
  globalThis.window = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({
      dataset: {},
      style: {},
      textContent: '',
      setAttribute() {},
      append() {},
      remove() {},
    }),
    head: { append() {} },
    body: { append() {} },
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  })
}

/* ── 最小 React 替身 ────────────────────────────────────────────────── */

let currentHooks = null
let hookIndex = 0
let currentEffects = null
let currentMarkDirty = null
let harnessMarkDirty = null

function createElement(type, props, ...children) {
  const normalized = { ...(props ?? {}) }
  const list = children.flat(Infinity)
  if (list.length > 0) {
    const existing = normalized.children
    normalized.children = existing === undefined ? list : [existing, ...list]
  }
  return { type, props: normalized }
}

function useState(initial) {
  const index = hookIndex
  hookIndex += 1
  if (currentHooks[index] === undefined) {
    currentHooks[index] = { value: typeof initial === 'function' ? initial() : initial }
  }
  const slot = currentHooks[index]
  return [slot.value, (next) => {
    slot.value = typeof next === 'function' ? next(slot.value) : next
    if (currentMarkDirty !== null) currentMarkDirty()
    else if (harnessMarkDirty !== null) harnessMarkDirty()
  }]
}

function useRef(initial) {
  const index = hookIndex
  hookIndex += 1
  if (currentHooks[index] === undefined) currentHooks[index] = { current: initial }
  return currentHooks[index]
}

function useMemo(factory, deps) {
  const index = hookIndex
  hookIndex += 1
  const slot = currentHooks[index]
  const changed = slot === undefined || !sameDeps(slot.deps, deps)
  if (changed) {
    currentHooks[index] = {
      value: factory(),
      deps: deps === undefined ? undefined : [...deps],
    }
  }
  return currentHooks[index].value
}

function useCallback(fn) {
  hookIndex += 1
  return fn
}

function useEffect(fn, deps) {
  hookIndex += 1
  if (currentEffects !== null && typeof fn === 'function') currentEffects.push({ fn, deps })
}

function useLayoutEffect(fn) {
  useEffect(fn)
}

function renderComponent(component, props) {
  const hooks = []
  const effects = []
  const previousHooks = currentHooks
  const previousIndex = hookIndex
  const previousEffects = currentEffects
  currentHooks = hooks
  hookIndex = 0
  currentEffects = effects
  let output
  try {
    output = component(props)
  } finally {
    currentHooks = previousHooks
    hookIndex = previousIndex
    currentEffects = previousEffects
  }
  for (const effect of effects) {
    const cleanup = effect.fn()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return output
}

/** 依赖数组浅比较（用于带状态的根组件重渲染时决定 effect 是否重跑）。 */
function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (!Object.is(a[index], b[index])) return false
  }
  return true
}

/**
 * 带状态的根组件挂载器：根组件保留 hook 槽位，setState 后由测试手动 flush 重渲染。
 * 子组件每次重渲染重新挂载（只用于展示型子组件）。
 */
function createHarness(component, props) {
  const instance = { hooks: [], effectSlots: [] }
  let dirty = false
  let nodes = []
  let tree = null
  let unmounted = false

  const renderBody = () => {
    const hooks = instance.hooks
    const effects = []
    const previousHooks = currentHooks
    const previousIndex = hookIndex
    const previousEffects = currentEffects
    currentHooks = hooks
    hookIndex = 0
    currentEffects = effects
    currentMarkDirty = markDirty
    let output
    try {
      output = component(props)
    } finally {
      currentHooks = previousHooks
      hookIndex = previousIndex
      currentEffects = previousEffects
      currentMarkDirty = null
    }
    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index]
      const slot = instance.effectSlots[index]
      const changed = slot === undefined || !sameDeps(slot.deps, effect.deps)
      if (!changed) continue
      if (slot !== undefined && typeof slot.cleanup === 'function') slot.cleanup()
      const cleanup = effect.fn()
      instance.effectSlots[index] = { deps: effect.deps === undefined ? undefined : [...effect.deps], cleanup }
    }
    return output
  }

  const render = () => {
    nodes = []
    tree = resolveNode(renderBody(), nodes)
    dirty = false
    return { nodes, tree, text: textOf(tree) }
  }

  // 把 setState 变成「标记 dirty」，等待测试 flush。
  const markDirty = () => { dirty = true }
  harnessMarkDirty = markDirty
  const root = {
    props,
    markDirty,
    flush() {
      if (unmounted || !dirty) return { nodes, tree, text: tree === null ? '' : textOf(tree) }
      return render()
    },
    rerender() {
      dirty = true
      return root.flush()
    },
    unmount() {
      unmounted = true
      if (harnessMarkDirty === markDirty) harnessMarkDirty = null
      for (const slot of instance.effectSlots) {
        if (slot !== undefined && typeof slot.cleanup === 'function') {
          try {
            slot.cleanup()
          } catch {
            /* ignore */
          }
        }
      }
      instance.effectSlots = []
    },
  }
  render()
  return { root, instance, markDirty }
}

/** 把元素树解析成「宿主元素树」（函数组件就地展开），同时收集宿主节点。 */
function resolveNode(node, nodes) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((child) => resolveNode(child, nodes))
  if (typeof node !== 'object') return null
  const { type, props } = node
  if (type === FRAGMENT) return resolveNode(props.children, nodes)
  if (typeof type === 'function') return resolveNode(renderComponent(type, props), nodes)
  const resolved = { type, props: { ...props, children: resolveNode(props.children, nodes) } }
  nodes.push(resolved)
  return resolved
}

/** 渲染整棵树；返回宿主节点列表、解析后的树和全部文本。 */
function renderTree(element) {
  const nodes = []
  const tree = resolveNode(element, nodes)
  return { nodes, tree, text: textOf(tree) }
}

/** 在渲染树里按 className 找节点。 */
function findNodes(nodes, className) {
  return nodes.filter((node) => {
    const value = node.props.className
    return typeof value === 'string' && value.split(/\s+/).includes(className)
  })
}

/** 收集一段渲染树里的文本。 */
function textOf(nodes) {
  const parts = []
  const visit = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node === 'object') visit(node.props.children)
  }
  visit(nodes)
  return parts.join('')
}

/* ── 载入 40-chat.js ────────────────────────────────────────────────── */

installDom()

const DICT = {
  'chat.title': '古法 AI',
  'chat.newChat': '新建对话',
  'chat.history': '历史对话',
  'chat.noHistory': '暂无历史对话',
  'chat.deleteChat': '删除对话',
  'chat.inputPlaceholder': '问问 AI…（Enter 发送，Shift+Enter 换行）',
  'chat.send': '发送',
  'chat.stop': '停止',
  'chat.thinking': '思考中…',
  'chat.emptyTitle': '古法 AI 助手',
  'chat.emptyHint': '我在这里辅助你手写代码。',
  'chat.attachFile': '附带当前文件',
  'chat.insert': '插入到编辑器',
  'chat.copy': '复制',
  'chat.copied': '已复制',
  'chat.error': '请求失败',
  'chat.quickExplain': '解释当前代码',
  'chat.quickBug': '查找潜在问题',
  'chat.quickComment': '补充注释',
  'chat.quickRefactor': '重构建议',
  'chat.contextLabel': '上下文',
  'chat.ctxFile': '当前文件',
  'chat.ctxSelection': '选中代码',
  'chat.clear': '清空对话',
  'chat.model': '模型',
  'common.close': '关闭',
  'common.loading': '加载中…',
}

const apiCalls = []
const streamCalls = []
const abortCalls = []

const G = {
  ChatPanel: null,
  t: (key, params) => (params === undefined ? DICT[key] ?? key : String(DICT[key] ?? key).replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))),
  useT: () => {
    useState(0)
    useEffect(() => undefined, [])
    return G.t
  },
  api: async (method) => {
    apiCalls.push(method)
    if (method === 'chat.info') return { provider: 'deepseek-official', model: 'deepseek-flash', ready: true }
    return null
  },
  stream: (method, body, onEvent) => {
    streamCalls.push({ method, body, onEvent })
    return () => {
      abortCalls.push(true)
    }
  },
  basename: (path) => String(path ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? '',
  errorText: (error) => (error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error ?? '')),
  Icon: (props) => createElement('svg', { 'data-icon': props.name }),
  IconButton: (props) => createElement('button', { className: 'gufa-iconbtn', 'data-title': props.title, onClick: props.onClick }, props.children),
  Button: (props) => createElement('button', { className: 'gufa-btn', 'data-title': props.title, onClick: props.onClick }, props.children),
  Spinner: () => createElement('span', { className: 'gufa-spinner' }),
  Empty: (props) => createElement('div', { className: 'gufa-empty' }, props.title ?? null, props.hint ?? null),
}

const source = readFileSync(join(root, 'src', 'client', '40-chat.js'), 'utf8')
const factory = new Function(
  'G',
  'h',
  'React',
  'useState',
  'useEffect',
  'useRef',
  'useMemo',
  'useCallback',
  'useLayoutEffect',
  `${source}\nreturn {
    ChatPanel: G.ChatPanel,
    GufaChatMessageView,
    GufaChatMarkdownText,
    GufaChatCode,
    GufaChatAssistantBody,
  }\n`,
)
const client = factory(G, createElement, { Fragment: FRAGMENT }, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect)

/* ── 用例 ───────────────────────────────────────────────────────────── */

console.log('\n[render] ChatPanel 冒烟')

test('G.ChatPanel 渲染空状态（无项目）', () => {
  const { nodes } = renderTree(createElement(client.ChatPanel, {
    project: null,
    activeFile: null,
    selection: null,
    theme: 'dark',
    onInsertCode: () => {},
  }))
  assert.ok(nodes.length > 10, '应渲染出宿主节点')
  assert.equal(findNodes(nodes, 'gufa-chat-context-hint').length, 1, '无上下文时应显示提示')
  assert.equal(findNodes(nodes, 'gufa-chat-quick-btn').length, 4, '4 个快捷提问按钮')
  assert.equal(findNodes(nodes, 'gufa-chat-msgs').length, 1)
  assert.equal(findNodes(nodes, 'gufa-chat-input').length, 1)
  // 快捷提问在没有文件/选中代码时禁用
  for (const node of findNodes(nodes, 'gufa-chat-quick-btn')) assert.equal(node.props.disabled, true)
})

test('G.ChatPanel 渲染项目 + 当前文件 + 选中代码', () => {
  const { nodes, text } = renderTree(createElement(client.ChatPanel, {
    project: { root: '/repo', name: 'repo' },
    activeFile: { path: 'src/a.js', content: 'const a = 1', language: 'javascript' },
    selection: { text: 'const a = 1', path: 'src/a.js', line: 2, column: 1 },
    theme: 'light',
    onInsertCode: (code) => { globalThis.__inserted = code },
  }))
  const chips = findNodes(nodes, 'gufa-chat-chip')
  assert.equal(chips.length, 2, '应显示「当前文件」「选中代码」两个 chip，且都可开关')
  assert.equal(findNodes(nodes, 'gufa-chat-context-hint').length, 0)
  for (const node of findNodes(nodes, 'gufa-chat-quick-btn')) assert.notEqual(node.props.disabled, true)
  assert.match(text, /选中代码/)
  const chipTitles = chips.map((chip) => String(chip.props.title ?? '')).join('\n')
  assert.match(chipTitles, /当前文件/) 
  assert.ok(chipTitles.includes('src/a.js'), 'chip title 应带完整文件路径')
})

test('G.ChatPanel 头部显示模型信息 / 新建 / 历史按钮', () => {
  const { nodes } = renderTree(createElement(client.ChatPanel, {
    project: null,
    activeFile: null,
    selection: null,
    theme: 'dark',
    onInsertCode: () => {},
  }))
  const heads = findNodes(nodes, 'gufa-chat-head')
  assert.equal(heads.length, 1)
  const titles = nodes.filter((node) => node.type === 'button').map((node) => node.props['data-title']).filter(Boolean)
  assert.ok(titles.includes('历史对话'))
  assert.ok(titles.includes('新建对话'))
  assert.equal(findNodes(nodes, 'gufa-chat-model').length, 1)
})

test('GufaChatMessageView 渲染用户气泡（纯文本）', () => {
  const { nodes, text } = renderTree(createElement(client.GufaChatMessageView, {
    message: { id: 'u1', role: 'user', content: '帮我看看 **这段** 代码' },
    streaming: false,
    thinking: false,
  }))
  assert.equal(findNodes(nodes, 'gufa-chat-usertext').length, 1)
  assert.match(text, /帮我看看/)
  assert.equal(findNodes(nodes, 'gufa-chat-code').length, 0, '用户消息不解析 markdown 代码块')
})

test('GufaChatMessageView 渲染 AI 消息：markdown-lite + 代码块按钮', () => {
  const { nodes, text } = renderTree(createElement(client.GufaChatMessageView, {
    message: {
      id: 'a1',
      role: 'assistant',
      content: '可以这样写 **注意** 行内 `map`：\n```javascript\nconst a = 1\n```\n结束',
    },
    streaming: true,
    thinking: false,
    onInsert: (code) => { globalThis.__inserted = code },
  }))
  assert.equal(findNodes(nodes, 'gufa-chat-avatar').length, 1)
  assert.equal(findNodes(nodes, 'gufa-chat-code').length, 1)
  assert.equal(findNodes(nodes, 'gufa-chat-code-body').length, 1)
  const codeButtons = findNodes(nodes, 'gufa-chat-code-btn')
  assert.equal(codeButtons.length, 2, '代码块应有「复制」「插入到编辑器」两个按钮')
  assert.match(text, /插入到编辑器/)
  assert.match(text, /复制/)
  // 粗体与行内代码
  assert.ok(nodes.some((node) => node.type === 'strong'))
  assert.ok(nodes.some((node) => node.type === 'code'))
  // 正在流式输出时显示光标
  assert.equal(findNodes(nodes, 'gufa-chat-caret').length, 1)
})

test('GufaChatMessageView 渲染思考中 / 错误状态', () => {
  const { nodes: thinkingNodes, text: thinkingText } = renderTree(createElement(client.GufaChatMessageView, {
    message: { id: 'a2', role: 'assistant', content: '' },
    streaming: true,
    thinking: true,
  }))
  assert.equal(findNodes(thinkingNodes, 'gufa-chat-thinking').length, 1)
  assert.match(thinkingText, /思考中/)

  const { nodes: errorNodes, text: errorText } = renderTree(createElement(client.GufaChatMessageView, {
    message: { id: 'a3', role: 'assistant', content: '部分内容', error: 'API Key 无效' },
    streaming: false,
    thinking: false,
  }))
  assert.equal(findNodes(errorNodes, 'gufa-chat-error').length, 1)
  assert.match(errorText, /API Key 无效/)
})

test('GufaChatMarkdownText 空行 / 行内代码 / 粗体', () => {
  const { nodes, text } = renderTree(createElement(client.GufaChatMarkdownText, {
    text: '第一行 **粗体** 和 `code`\n\n第三行',
  }))
  assert.ok(findNodes(nodes, 'gufa-chat-gap').length >= 1)
  assert.ok(nodes.some((node) => node.type === 'strong'))
  assert.ok(nodes.some((node) => node.type === 'code'))
  assert.match(text, /第一行/)
})

test('渲染过程登记了 chat.info 请求', () => {
  assert.ok(apiCalls.includes('chat.info'), '挂载后应请求模型信息')
})

/* ── 交互流程（有状态根组件） ───────────────────────────────────────── */

/** 找到渲染树里第一个 className 节点。 */
function firstNode(nodes, className) {
  return findNodes(nodes, className)[0] ?? null
}

/** 找到「停止」按钮（带 data-stop 的发送按钮）。 */
function findStopButton(nodes) {
  return nodes.find((node) => node.type === 'button' && node.props.className === 'gufa-chat-send' && node.props['data-stop'] !== undefined) ?? null
}

/** 挂载 ChatPanel 并输入文本 + 按 Enter 发送，返回 harness、流式请求与控制辅助函数。 */
function mountAndSend(options) {
  localStorage.removeItem('gufa-code:chat:v1:/repo')
  streamCalls.length = 0
  abortCalls.length = 0
  const harness = createHarness(G.ChatPanel, {
    project: { root: '/repo', name: 'repo' },
    activeFile: { path: 'src/a.js', content: 'const a = 1', language: 'javascript' },
    selection: { text: 'const a = 1', path: 'src/a.js', line: 1 },
    theme: 'dark',
    onInsertCode: () => {},
  })
  let view = harness.root.flush()
  let textarea = firstNode(view.nodes, 'gufa-chat-input')
  assert.ok(textarea !== null, '应找到输入框')
  textarea.props.onChange({ target: { value: options.text } })
  view = harness.root.flush()
  textarea = firstNode(view.nodes, 'gufa-chat-input')
  textarea.props.onKeyDown({
    key: 'Enter',
    shiftKey: false,
    nativeEvent: { isComposing: false },
    preventDefault() {},
  })
  view = harness.root.flush()
  assert.equal(streamCalls.length, 1, 'Enter 应触发一次 chat.stream')
  return {
    harness,
    stream: streamCalls[0],
    get view() {
      return view
    },
    flush() {
      view = harness.root.flush()
      return view
    },
    unmount() {
      harness.root.unmount()
    },
  }
}

console.log('\n[interaction] 发送 / 流式 / 停止 / 错误')

test('Enter 发送：请求体带上下文与会话历史，输入框清空并进入流式状态', () => {
  const flow = mountAndSend({ text: '解释这段代码' })
  try {
    const body = flow.stream.body
    assert.equal(flow.stream.method, 'chat.stream')
    assert.equal(body.messages[body.messages.length - 1].content, '解释这段代码')
    assert.equal(body.context.root, '/repo')
    assert.equal(body.context.path, 'src/a.js')
    assert.equal(body.context.content, 'const a = 1')
    assert.equal(body.context.selection, 'const a = 1')
    assert.match(flow.view.text, /解释这段代码/)
    assert.equal(firstNode(flow.view.nodes, 'gufa-chat-input').props.value, '')
    assert.ok(findStopButton(flow.view.nodes) !== null, '流式期间应显示停止按钮')
    assert.equal(findNodes(flow.view.nodes, 'gufa-chat-thinking').length, 1, '应显示思考中')
  } finally {
    flow.unmount()
  }
})

test('流式 delta 追加 / done 收尾并落盘历史', () => {
  const flow = mountAndSend({ text: '这段代码做什么' })
  try {
    flow.stream.onEvent({ type: 'thinking' })
    flow.flush()
    assert.equal(findNodes(flow.view.nodes, 'gufa-chat-thinking').length, 1)

    flow.stream.onEvent({ type: 'delta', text: '这段代码' })
    flow.flush()
    flow.stream.onEvent({ type: 'delta', text: '定义了常量 a。' })
    flow.flush()
    assert.match(flow.view.text, /这段代码定义了常量 a。/)
    assert.equal(findNodes(flow.view.nodes, 'gufa-chat-thinking').length, 0, '收到增量后思考状态结束')

    flow.stream.onEvent({ type: 'done' })
    flow.flush()
    assert.ok(findStopButton(flow.view.nodes) === null, '完成后恢复发送按钮')

    const store = JSON.parse(localStorage.getItem('gufa-code:chat:v1:/repo'))
    assert.equal(store.conversations.length, 1)
    const messages = store.conversations[0].messages
    assert.equal(messages.length, 2)
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[1].role, 'assistant')
    assert.equal(messages[1].content, '这段代码定义了常量 a。')
  } finally {
    flow.unmount()
  }
})

test('停止按钮：中止请求并保留已收到的部分内容', () => {
  const flow = mountAndSend({ text: '写个排序' })
  try {
    flow.stream.onEvent({ type: 'delta', text: '正在写' })
    flow.flush()
    const stopButton = findStopButton(flow.view.nodes)
    assert.ok(stopButton !== null)
    stopButton.props.onClick({})
    flow.flush()
    assert.equal(abortCalls.length, 1, '停止应调用 G.stream 返回的 abort')
    assert.ok(findStopButton(flow.view.nodes) === null)
    assert.match(flow.view.text, /正在写/)
    const store = JSON.parse(localStorage.getItem('gufa-code:chat:v1:/repo'))
    const assistant = store.conversations[0].messages[1]
    assert.equal(assistant.content, '正在写')
    assert.equal(assistant.stopped, true)
  } finally {
    flow.unmount()
  }
})

test('error 事件：错误文案写入消息气泡并结束流式状态', () => {
  const flow = mountAndSend({ text: '你好' })
  try {
    flow.stream.onEvent({ type: 'delta', text: '部分回答' })
    flow.flush()
    flow.stream.onEvent({ type: 'error', message: 'API Key 无效，请检查 DSH 设置。' })
    flow.flush()
    assert.match(flow.view.text, /API Key 无效/)
    assert.ok(findStopButton(flow.view.nodes) === null)
    assert.equal(findNodes(flow.view.nodes, 'gufa-chat-error').length, 1)
  } finally {
    flow.unmount()
  }
})

test('Shift+Enter 不发送；空输入 Enter 不发送', () => {
  localStorage.removeItem('gufa-code:chat:v1:/repo')
  streamCalls.length = 0
  const harness = createHarness(G.ChatPanel, {
    project: null,
    activeFile: null,
    selection: null,
    theme: 'dark',
    onInsertCode: () => {},
  })
  try {
    const view = harness.root.flush()
    const textarea = firstNode(view.nodes, 'gufa-chat-input')
    textarea.props.onChange({ target: { value: '换行内容' } })
    harness.root.flush()
    firstNode(harness.root.flush().nodes, 'gufa-chat-input').props.onKeyDown({
      key: 'Enter',
      shiftKey: true,
      nativeEvent: { isComposing: false },
      preventDefault() {},
    })
    harness.root.flush()
    assert.equal(streamCalls.length, 0, 'Shift+Enter 不应发送')
    // 清空后再按 Enter
    firstNode(harness.root.flush().nodes, 'gufa-chat-input').props.onChange({ target: { value: '   ' } })
    harness.root.flush()
    firstNode(harness.root.flush().nodes, 'gufa-chat-input').props.onKeyDown({
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: false },
      preventDefault() {},
    })
    harness.root.flush()
    assert.equal(streamCalls.length, 0, '空输入不应发送')
  } finally {
    harness.root.unmount()
  }
})

/* ── 收尾 ───────────────────────────────────────────────────────────── */

for (const cleanup of cleanups.splice(0)) {
  try {
    cleanup()
  } catch {
    /* ignore */
  }
}

console.log('')
if (failures.length > 0) {
  console.error(`✗ 渲染冒烟失败：${failures.length} 个，${passed} 个通过`)
  process.exit(1)
}
console.log(`✓ 渲染冒烟全部通过：${passed} 个用例`)

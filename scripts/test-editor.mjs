#!/usr/bin/env node
/**
 * 20-editor 纯逻辑自测（无需浏览器）：
 * 把 00-core / 10-icons / 20-editor 三个零件按构建顺序装配进沙箱（React/hooks/DOM 用最小桩），
 * 校验：
 *   1) 模块级代码可执行、组件渲染分支（无文件 / 二进制 / 过大 / 正常 / 悬空 activePath）
 *   2) 纯函数：model URI、插入光标推进、主题映射、编辑器选项、worker 启动脚本
 *   3) Monaco loader 状态机：注入 loader.js → onload → require.config → 成功；
 *      失败降级、失败缓存不重复注入、显式重试、非 Monaco AMD loader 拒载、单例不重复注入
 *
 * 用法：node scripts/test-editor.mjs
 * 说明：只依赖本插件源码，不读取其他负责人正在编辑的零件文件。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = join(root, 'src', 'client')
const PARTS = ['00-core.js', '10-icons.js', '20-editor.js']

const editorSource = readFileSync(join(partsDir, '20-editor.js'), 'utf8')
const source = PARTS.map((name) => `\n/* ───── ${name} ───── */\n${readFileSync(join(partsDir, name), 'utf8')}`).join('\n')

/* ── 最小 React 桩：支持函数组件单次渲染时的 hooks 顺序 ───────────────── */
function createRuntime() {
  const slots = []
  let cursor = 0
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(callback) {
      cursor++
      return callback
    },
    useMemo(factory) {
      cursor++
      return factory()
    },
    useEffect() {
      cursor++
    },
    useLayoutEffect() {
      cursor++
    },
  }
  return {
    react,
    beginRender() {
      cursor = 0
    },
    reset() {
      cursor = 0
      slots.length = 0
    },
  }
}

/* ── 最小 DOM 桩（只覆盖 20-editor 用到的 document / window 能力） ───── */
function createFakeDom() {
  const scripts = []
  const document = {
    head: {
      append(node) {
        if (node.tagName !== 'SCRIPT') return
        node.parentNode = document.head
        scripts.push(node)
      },
    },
    querySelector(selector) {
      const match = /^script\[(.+?)\]$/.exec(selector)
      if (match === null) return null
      const attribute = match[1]
      return scripts.find((script) => script.getAttribute(attribute) !== undefined) ?? null
    },
    createElement(tagName) {
      const attributes = {}
      return {
        tagName: String(tagName).toUpperCase(),
        parentNode: null,
        onload: null,
        onerror: null,
        src: '',
        async: false,
        setAttribute(name, value) {
          attributes[name] = value
        },
        getAttribute(name) {
          return attributes[name]
        },
        remove() {
          const index = scripts.indexOf(this)
          if (index >= 0) scripts.splice(index, 1)
        },
      }
    },
  }
  return { document, scripts }
}

function createFakeWindow() {
  return {
    setTimeout() {
      /* 测试中不真正排队，避免 10s 的 revoke 定时器拖住进程 */
    },
    requestAnimationFrame() {},
    location: { protocol: 'http:', host: '127.0.0.1' },
  }
}

/** 装配一份全新的 G（模块级单例状态随 factory 调用重新创建）。 */
function createGufaModule(options = {}) {
  const runtime = createRuntime()
  const fakeDom = createFakeDom()
  const fakeWindow = options.window ?? createFakeWindow()
  const fakeGlobal = options.globalThis ?? {}
  const factory = new Function(
    '__react', 'window', 'document', 'globalThis', 'Blob', 'URL', 'Worker',
    [
      'const React = __react',
      'const h = React.createElement',
      'const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = React',
      source,
      'return { G }',
    ].join('\n'),
  )
  const { G } = factory(
    runtime.react,
    fakeWindow,
    options.document ?? fakeDom.document,
    fakeGlobal,
    options.Blob,
    options.URL,
    options.Worker,
  )
  return { G, runtime, window: fakeWindow, document: options.document ?? fakeDom.document, scripts: fakeDom.scripts }
}

/** 模拟一个已注册的 Monaco AMD loader。 */
function createFakeMonacoLoader(window, monaco, configs) {
  const loader = (ids, success) => {
    if (Array.isArray(ids) && ids[0] === 'vs/editor/editor.main') {
      window.monaco = monaco
      success()
    }
  }
  loader.config = (options) => {
    configs.push(options)
  }
  loader.reset = () => {}
  loader.getConfig = () => ({})
  return loader
}

/* ── 用例收集 ────────────────────────────────────────────────────────── */
const cases = []
function test(name, fn) {
  cases.push({ name, fn })
}

/** 遍历 React 元素树。 */
function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object' || node.type === undefined) return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function findAll(elements, predicate) {
  const found = []
  walk(elements, (element) => {
    if (predicate(element)) found.push(element)
  })
  return found
}

/* ══════════════════════════════════════════════════════════════════════
 * 1. 模块装配 / 导出
 * ══════════════════════════════════════════════════════════════════════ */
const baseModule = createGufaModule()
const G = baseModule.G
const runtime = baseModule.runtime

function renderPane(props) {
  runtime.reset()
  runtime.beginRender()
  return G.EditorPane(props)
}

const baseProps = {
  tabs: [],
  activePath: null,
  theme: 'dark',
  root: '/Users/jeff/demo',
  onSelectTab() {},
  onCloseTab() {},
  onChange() {},
  onSave() {},
  onCursor() {},
}

test('模块可执行且导出 G.EditorPane（函数）', () => {
  assert.equal(typeof G.EditorPane, 'function')
  assert.equal(typeof G.EditorPane.internals, 'object')
  assert.equal(Object.isFrozen(G.EditorPane.internals), true)
})

test('源码不 import/require 任何 Harness Client 包', () => {
  assert.doesNotMatch(editorSource, /^\s*import\s/m)
  assert.doesNotMatch(editorSource, /from\s+['"]@deepseek-ai\//)
  assert.doesNotMatch(editorSource, /(^|[^.\w])require\s*\(\s*['"]/)
})

/* ══════════════════════════════════════════════════════════════════════
 * 2. 纯函数：URI / 光标推进 / 主题 / 选项 / worker 脚本
 * ══════════════════════════════════════════════════════════════════════ */
test('model URI = file:///<root>/<path>（root 为项目绝对路径）', () => {
  const { modelUri } = G.EditorPane.internals
  const captured = []
  const fakeMonaco = {
    Uri: {
      file(absolute) {
        captured.push(absolute)
        return { scheme: 'file', path: absolute, toString: () => `file://${absolute}` }
      },
    },
  }
  const uri = modelUri(fakeMonaco, '/Users/jeff/demo', 'src/a.ts')
  assert.deepEqual(captured, ['/Users/jeff/demo/src/a.ts'])
  assert.equal(uri.toString(), 'file:///Users/jeff/demo/src/a.ts')
  captured.length = 0
  modelUri(fakeMonaco, '', 'README.md')
  assert.deepEqual(captured, ['/README.md'])
  captured.length = 0
  modelUri(fakeMonaco, '/Users/jeff/demo/', '/lib\\b.js')
  assert.deepEqual(captured, ['/Users/jeff/demo/lib/b.js'])
})

test('插入文本后的光标位置推进正确', () => {
  const { advancePosition } = G.EditorPane.internals
  assert.deepEqual(advancePosition({ lineNumber: 3, column: 5 }, 'abc'), { lineNumber: 3, column: 8 })
  assert.deepEqual(advancePosition({ lineNumber: 3, column: 5 }, 'x\nyy'), { lineNumber: 4, column: 3 })
  assert.deepEqual(advancePosition({ lineNumber: 1, column: 1 }, 'a\n'), { lineNumber: 2, column: 1 })
})

test('主题映射 dark→vs-dark / light→vs', () => {
  const { monacoTheme } = G.EditorPane.internals
  assert.equal(monacoTheme('dark'), 'vs-dark')
  assert.equal(monacoTheme('light'), 'vs')
  assert.equal(monacoTheme(undefined), 'vs')
})

test('编辑器选项：automaticLayout 开、minimap/ruler 默认关（查找时动态打开）', () => {
  const options = G.EditorPane.internals.editorOptions('dark')
  assert.equal(options.automaticLayout, true)
  assert.equal(options.minimap.enabled, false)
  assert.equal(options.overviewRulerLanes, 0)
  assert.equal(options.renderOverviewRuler, false)
  assert.equal(options.theme, 'vs-dark')
  assert.equal(G.EditorPane.internals.editorOptions('light').theme, 'vs')
})

test('worker 启动脚本：先加载 loader 并配置 paths.vs，再执行 workerMain', () => {
  const base = G.asset('monaco')
  const script = G.EditorPane.internals.workerScript(base)
  assert.ok(script.includes(`importScripts(${JSON.stringify(`${base}/loader.js`)})`), '应先 importScripts loader.js')
  assert.ok(script.includes(`require.config({ paths: { vs: ${JSON.stringify(base)} } })`), '应配置 paths.vs')
  assert.ok(script.includes(`${base}/base/worker/workerMain.js`), '应执行 workerMain.js')
  assert.ok(script.indexOf('loader.js') < script.indexOf('workerMain.js'), 'loader 必须先于 workerMain')
})

test('language 回退：Monaco 未注册的 id（makefile/cmake）按 plaintext 打开', () => {
  const { resolveLanguage } = G.EditorPane.internals
  const fakeMonaco = { languages: { getLanguages: () => [{ id: 'typescript' }, { id: 'plaintext' }] } }
  assert.equal(resolveLanguage(fakeMonaco, 'typescript'), 'typescript')
  assert.equal(resolveLanguage(fakeMonaco, 'makefile'), undefined)
  assert.equal(resolveLanguage(fakeMonaco, 'cmake'), undefined)
  assert.equal(resolveLanguage(fakeMonaco, ''), undefined)
  assert.equal(resolveLanguage(fakeMonaco, undefined), undefined)
})

/* ══════════════════════════════════════════════════════════════════════
 * 3. 渲染分支
 * ══════════════════════════════════════════════════════════════════════ */
test('无打开文件时渲染 Empty（noFile），不渲染 textarea', () => {
  const tree = renderPane(baseProps)
  const empties = findAll(tree, (element) => element.type === G.Empty)
  assert.equal(empties.length, 1)
  assert.equal(empties[0].props.title, G.t('editor.noFile'))
  assert.equal(findAll(tree, (element) => element.type === 'textarea').length, 0)
  const pane = findAll(tree, (element) => element.props.className === 'gufa-editor-pane')
  assert.equal(pane.length, 1)
  assert.equal(pane[0].props.style.position, 'absolute')
  assert.equal(pane[0].props.style.inset, 0)
})

test('二进制文件渲染 Empty（binary）', () => {
  const tree = renderPane({
    ...baseProps,
    tabs: [{ path: 'a.png', content: '', language: 'plaintext', binary: true }],
    activePath: 'a.png',
  })
  const empties = findAll(tree, (element) => element.type === G.Empty)
  assert.equal(empties.length, 1)
  assert.equal(empties[0].props.title, G.t('editor.binary'))
})

test('超大文件渲染 Empty（tooLarge）', () => {
  const tree = renderPane({
    ...baseProps,
    tabs: [{ path: 'big.log', content: '', language: 'plaintext', tooLarge: true }],
    activePath: 'big.log',
  })
  const empties = findAll(tree, (element) => element.type === G.Empty)
  assert.equal(empties.length, 1)
  assert.equal(empties[0].props.title, G.t('editor.tooLarge'))
})

test('普通文件：渲染 Monaco 挂载点 + 加载占位，不渲染空状态/降级 textarea', () => {
  const tree = renderPane({
    ...baseProps,
    tabs: [{ path: 'src/a.ts', content: 'const a = 1\n', language: 'typescript' }],
    activePath: 'src/a.ts',
  })
  const hosts = findAll(tree, (element) => element.props.className === 'gufa-monaco-host')
  assert.equal(hosts.length, 1)
  assert.equal(hosts[0].props.style.position, 'absolute')
  assert.equal(findAll(tree, (element) => element.type === G.Empty).length, 0)
  assert.equal(findAll(tree, (element) => element.type === 'textarea').length, 0)
  const loadingTexts = []
  walk(tree, (element) => {
    for (const child of element.children ?? []) {
      if (typeof child === 'string' && child === G.t('editor.loading')) loadingTexts.push(child)
    }
  })
  assert.equal(loadingTexts.length, 1, '首次挂载应显示「加载编辑器…」占位')
})

test('tabs 为 undefined / activePath 悬空时安全渲染', () => {
  const tree = renderPane({ ...baseProps, tabs: undefined, activePath: 'missing.ts' })
  assert.equal(findAll(tree, (element) => element.props.className === 'gufa-editor-pane').length, 1)
  const empties = findAll(tree, (element) => element.type === G.Empty)
  assert.equal(empties.length, 1)
  assert.equal(empties[0].props.title, G.t('editor.noFile'))
})

/* ══════════════════════════════════════════════════════════════════════
 * 4. Monaco loader 状态机（fake DOM / fake AMD loader）
 * ══════════════════════════════════════════════════════════════════════ */
test('无 AMD loader：注入 loader.js → onload 后 require.config → 成功；不重复注入', async () => {
  const module = createGufaModule()
  const { G: localG, window: fakeWindow, scripts } = module
  const internals = localG.EditorPane.internals
  const configs = []
  const fakeMonaco = { editor: { create() {}, getModel() {} } }

  const pending = internals.loadMonaco()
  assert.equal(scripts.length, 1, '应注入一个 loader.js')
  assert.equal(scripts[0].src, '/gufa-code/asset/monaco/loader.js')
  assert.equal(scripts[0].getAttribute('data-gufa-monaco-loader'), '1')

  /* 模拟 loader.js 执行：挂上 window.require */
  fakeWindow.require = createFakeMonacoLoader(fakeWindow, fakeMonaco, configs)
  scripts[0].onload()
  const monaco = await pending
  assert.equal(monaco, fakeMonaco)
  assert.deepEqual(configs[0], { paths: { vs: '/gufa-code/asset/monaco' } })
  assert.equal(typeof fakeWindow.MonacoEnvironment.getWorker, 'function', '应安装 worker 工厂')

  /* 成功后再次加载：命中缓存，不注入新脚本、不重复 config */
  const again = await internals.loadMonaco()
  assert.equal(again, fakeMonaco)
  assert.equal(scripts.length, 1)
  assert.equal(configs.length, 1)
})

test('已有 Monaco loader（其他插件加载过）：跳过注入，直接 require editor.main', async () => {
  const module = createGufaModule()
  const { G: localG, window: fakeWindow, scripts } = module
  const configs = []
  const fakeMonaco = { editor: { create() {}, getModel() {} } }
  fakeWindow.require = createFakeMonacoLoader(fakeWindow, fakeMonaco, configs)

  const monaco = await localG.EditorPane.internals.loadMonaco()
  assert.equal(monaco, fakeMonaco)
  assert.equal(scripts.length, 0, '不应重复注入 loader.js')
  assert.deepEqual(configs[0], { paths: { vs: '/gufa-code/asset/monaco' } })
})

test('已有其他 getWorker 配置时不覆盖', async () => {
  const module = createGufaModule()
  const { G: localG, window: fakeWindow } = module
  const sentinel = () => {}
  fakeWindow.MonacoEnvironment = { getWorker: sentinel }
  fakeWindow.require = createFakeMonacoLoader(fakeWindow, { editor: { create() {} } }, [])
  await localG.EditorPane.internals.loadMonaco()
  assert.equal(fakeWindow.MonacoEnvironment.getWorker, sentinel)
})

test('loader.js 加载失败：拒绝并清理脚本，降级可用；失败缓存不重复注入', async () => {
  const module = createGufaModule()
  const { G: localG, scripts } = module
  const internals = localG.EditorPane.internals

  const pending = internals.loadMonaco()
  assert.equal(scripts.length, 1)
  scripts[0].onerror({ type: 'error' })
  await assert.rejects(pending, /Monaco loader\.js 加载失败/)
  assert.equal(scripts.length, 0, '失败后应移除残留脚本')

  /* 失败缓存：再次挂载不重新注入脚本 */
  await assert.rejects(internals.loadMonaco(), /Monaco loader\.js 加载失败/)
  assert.equal(scripts.length, 0)

  /* 显式重试：允许重新注入一次 */
  internals.resetMonacoFailure()
  const retry = internals.loadMonaco()
  assert.equal(scripts.length, 1, '重试应重新注入 loader.js')
  /* 模拟 loader.js 执行但没有挂 window.require（全局 module 污染等） */
  scripts[0].onload()
  await assert.rejects(retry, /没有可用的 Monaco AMD loader/)
})

test('window.require 被非 Monaco 的 AMD loader 占用：拒载，不注入脚本', async () => {
  const module = createGufaModule()
  const { G: localG, window: fakeWindow, scripts } = module
  const requireJsLike = function () {}
  requireJsLike.config = () => {}
  fakeWindow.require = requireJsLike
  await assert.rejects(localG.EditorPane.internals.loadMonaco(), /非 Monaco 的 AMD loader/)
  assert.equal(scripts.length, 0)
})

test('worker 工厂用同源 worker-bootstrap.js 作为 Worker 入口', () => {
  const blobs = []
  const workers = []
  const fakeURL = {
    createObjectURL(blob) {
      blobs.push(blob)
      return 'blob:gufa-worker'
    },
    revokeObjectURL() {},
  }
  class FakeWorker {
    constructor(url, options) {
      this.url = url
      this.options = options
      workers.push(this)
    }
    addEventListener() {}
  }
  const module = createGufaModule({
    window: { ...createFakeWindow(), MonacoEnvironment: undefined },
    URL: fakeURL,
    Worker: FakeWorker,
  })
  const { G: localG, window: fakeWindow } = module
  const configs = []
  fakeWindow.require = createFakeMonacoLoader(fakeWindow, { editor: { create() {} } }, configs)
  return localG.EditorPane.internals.loadMonaco().then(() => {
    const environment = fakeWindow.MonacoEnvironment
    assert.equal(typeof environment.getWorker, 'function')
    const worker = environment.getWorker('workerMain.js', 'typescript')
    assert.equal(worker.url, '/gufa-code/asset/monaco/worker-bootstrap.js?v=3')
    assert.equal(worker.options.name, 'typescript')
    assert.equal(blobs.length, 0, '同源 bootstrap 可用时不应再创建 blob worker')
  })
})

/* ── 依次执行（支持 async 用例） ─────────────────────────────────────── */
console.log('20-editor 自测：')
const failed = []
let passed = 0
for (const item of cases) {
  try {
    await item.fn()
    passed += 1
    console.log(`  ✓ ${item.name}`)
  } catch (error) {
    failed.push({ name: item.name, error })
    console.error(`  ✗ ${item.name}`)
    console.error(String(error?.stack ?? error).split('\n').slice(0, 6).join('\n'))
  }
}

console.log(`\n${passed}/${cases.length} 通过`)
if (failed.length > 0) {
  process.exitCode = 1
}

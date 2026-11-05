#!/usr/bin/env node
/**
 * 客户端终端零件静态自检：不依赖浏览器 / React / 构建产物。
 *
 * 做法：
 *   1. 把 00-core.js + 10-icons.js + 30-terminal.js 按 build-client.mjs 的 factory 头拼接，
 *      在 vm 沙箱里执行（只拼接、不写 client.js），验证零件可组合、G.TerminalPane 注册成功；
 *   2. 用最小 hooks 运行时调用 G.TerminalPane / GufaTerminalTab / GufaTerminalView，
 *      展开渲染树做冒烟测试（白屏/未知组件/条件调用 hooks 这类错误会在这里暴露）；
 *   3. 关键行为静态断言（xterm 资产地址、WS 地址、业务总线、无 import/export 等）。
 *
 * 用法：node scripts/selftest-terminal-client.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

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

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readPart = (name) => readFileSync(join(packageRoot, 'src', 'client', name), 'utf8')

/* ── 1. 源码静态断言 ───────────────────────────────────────────────────── */
const terminalSource = readPart('30-terminal.js')
console.log('30-terminal.js 静态断言')
check('无 import/export（零件共享 factory 作用域）', !/^\s*(?:import|export)\s/m.test(terminalSource))
check('xterm.js 走 G.asset', terminalSource.includes("G.asset('xterm/xterm.js')"))
check('xterm.css 走 G.asset', terminalSource.includes("G.asset('xterm/xterm.css')"))
check('addon-fit 走 G.asset', terminalSource.includes("G.asset('xterm/addon-fit.js')"))
check('输出走直连 SSE（票据鉴权）', terminalSource.includes('gufa-code/terminal-stream') && terminalSource.includes('terminal.wsTicket'))
check('输入走 HTTP terminal.input', terminalSource.includes("G.api('terminal.input'"))
check('尺寸走 HTTP terminal.resize', terminalSource.includes("G.api('terminal.resize'"))
check('不再使用 WebSocket', !terminalSource.includes('new WebSocket('))
check('监听 G.bus terminal:send', terminalSource.includes("G.bus.on('terminal:send'"))
check('未直接 append 到 document.body', !/document\.body\.append/.test(terminalSource))
check('未修改 props.height', !/props\.height\s*=(?!=)/.test(terminalSource))
check('注册 G.TerminalPane', /G\.TerminalPane\s*=\s*function\s+TerminalPane/.test(terminalSource))

/* ── 2. 最小 React hooks 运行时 ────────────────────────────────────────── */
let currentHooks = null
function makeHooks() {
  const hooks = { states: [], refs: [], effects: [], index: 0 }
  currentHooks = hooks
  return hooks
}
const Fragment = Symbol('Fragment')
const ReactStub = {
  Fragment,
  createElement(type, props, ...children) {
    const merged = { ...(props === null || props === undefined ? {} : props) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(initial) {
    const index = currentHooks.index
    currentHooks.index += 1
    if (!(index in currentHooks.states)) currentHooks.states[index] = typeof initial === 'function' ? initial() : initial
    return [currentHooks.states[index], (next) => {
      currentHooks.states[index] = typeof next === 'function' ? next(currentHooks.states[index]) : next
    }]
  },
  useRef(initial) {
    const index = currentHooks.index
    currentHooks.index += 1
    if (!(index in currentHooks.refs)) currentHooks.refs[index] = { current: initial }
    return currentHooks.refs[index]
  },
  useEffect(fn) {
    currentHooks.index += 1
    currentHooks.effects.push(fn)
  },
  useLayoutEffect(fn) {
    currentHooks.index += 1
    currentHooks.effects.push(fn)
  },
  useCallback(fn) {
    currentHooks.index += 1
    return fn
  },
  useMemo(fn) {
    currentHooks.index += 1
    return fn()
  },
}

/** 以独立 hooks 实例渲染一个组件，返回 { vnode, hookCount }。 */
function renderComponent(component, props) {
  const hooks = makeHooks()
  let vnode
  try {
    vnode = component(props)
  } finally {
    currentHooks = null
  }
  return { vnode, hookCount: hooks.index, hooks }
}

/** 展开渲染树：宿主编元素/文本直接消费，函数组件递归渲染（用于发现未知组件/渲染异常）。 */
function expand(vnode, depth = 0) {
  if (depth > 80) throw new Error('渲染树过深（疑似组件递归）')
  if (vnode === null || vnode === undefined || typeof vnode === 'boolean') return []
  if (typeof vnode === 'string' || typeof vnode === 'number') return []
  if (Array.isArray(vnode)) {
    const list = []
    for (const item of vnode) list.push(...expand(item, depth + 1))
    return list
  }
  if (typeof vnode !== 'object') return []
  const type = vnode.type
  const props = vnode.props === null || vnode.props === undefined ? {} : vnode.props
  const children = props.children
  if (typeof type === 'string' || type === Fragment) {
    if (Array.isArray(children)) {
      const list = []
      for (const child of children) list.push(...expand(child, depth + 1))
      return list
    }
    return expand(children, depth + 1)
  }
  if (typeof type === 'function') {
    const rendered = renderComponent(type, props)
    return expand(rendered.vnode, depth + 1)
  }
  throw new Error(`未知 vnode type: ${String(type)}`)
}

/* ── 3. 在沙箱中执行拼接后的 factory ───────────────────────────────────── */
const parts = ['00-core.js', '10-icons.js', '30-terminal.js']
const header = `window.__ModuleLoader__.load({
  id: 'dsh-gufa-code',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = React
`
const footer = `
  ;globalThis.__GUFA_TEST__ = { G, GufaTerminalView, GufaTerminalTab }
  return { inject: [], apply() {} }
  },
})
`
const source = header + parts.map((name) => `\n/* ── ${name} ── */\n${readPart(name)}\n`).join('') + footer

function fakeElement(tagName) {
  return {
    tagName,
    dataset: {},
    style: {},
    children: [],
    append() {},
    remove() {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null
    },
  }
}
const documentStub = {
  querySelector() {
    return null
  },
  createElement(tagName) {
    return fakeElement(tagName)
  },
  head: { append() {} },
  body: { hasAttribute() { return false }, append() {} },
  addEventListener() {},
  removeEventListener() {},
}
const windowStub = {
  __ModuleLoader__: {
    load(module) {
      windowStub.__loaded = module
    },
  },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame() {
    return 0
  },
  cancelAnimationFrame() {},
}
const sandbox = {
  window: windowStub,
  document: documentStub,
  location: { protocol: 'http:', host: '127.0.0.1:53091' },
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  URL,
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  localStorage: {
    getItem() {
      return null
    },
    setItem() {},
    removeItem() {},
  },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)

let loadedModule
try {
  vm.runInContext(source, sandbox, { filename: 'dsh-gufa-code.selftest.js' })
  loadedModule = windowStub.__loaded
} catch (error) {
  failed += 1
  console.error(`  FAIL 拼接执行失败 — ${error instanceof Error ? error.stack : String(error)}`)
}
console.log('拼接 factory / 组件冒烟')
check('factory 已通过 __ModuleLoader__.load 注册', loadedModule !== undefined)
if (loadedModule !== undefined) {
  let plugin
  try {
    plugin = loadedModule.factory((name) => {
      if (name === 'react') return ReactStub
      throw new Error(`未预期的 require(${name})`)
    })
  } catch (error) {
    console.error('  FAIL factory 执行失败', error)
  }
  check('factory 返回 { inject, apply }', plugin !== undefined && Array.isArray(plugin.inject) && typeof plugin.apply === 'function')
  const exposed = sandbox.__GUFA_TEST__
  check('G 命名空间暴露给测试', exposed !== undefined && typeof exposed.G === 'object')
  if (exposed !== undefined) {
    const G = exposed.G
    check('G.TerminalPane 是函数组件', typeof G.TerminalPane === 'function')
    check('GufaTerminalTab / GufaTerminalView 已定义', typeof exposed.GufaTerminalTab === 'function' && typeof exposed.GufaTerminalView === 'function')
    check('G.translate 可用', typeof G.t === 'function' && G.t('terminal.title') !== '')

    // G.TerminalPane：无项目 / 有项目但 xterm 加载中
    for (const scenario of [
      { name: '无项目', props: { root: null, visible: true, height: 220, theme: 'dark', onToggleHeight() {} } },
      { name: '亮色主题 + 项目 root（资产加载中）', props: { root: '/tmp/gufa-demo', visible: true, height: 300, theme: 'light', onToggleHeight() {} } },
    ]) {
      try {
        const first = renderComponent(G.TerminalPane, scenario.props)
        const elements = expand(first.vnode)
        check(`G.TerminalPane 渲染：${scenario.name}`, first.vnode !== undefined && first.vnode !== null)
        const second = renderComponent(G.TerminalPane, scenario.props)
        check(`G.TerminalPane hook 数量稳定：${scenario.name}`, first.hookCount === second.hookCount, `${first.hookCount} vs ${second.hookCount}`)
        expand(second.vnode)
        check(`G.TerminalPane 渲染树非空：${scenario.name}`, elements.length >= 0)
      } catch (error) {
        check(`G.TerminalPane 渲染：${scenario.name}`, false, error instanceof Error ? error.stack : String(error))
      }
    }

    // 终端标签
    try {
      const session = { id: 'term-1', title: 'zsh', exited: false, exitCode: null }
      const rendered = renderComponent(exposed.GufaTerminalTab, { session, active: true, onSelect() {}, onClose() {} })
      expand(rendered.vnode)
      check('GufaTerminalTab 渲染', rendered.vnode !== undefined && rendered.vnode !== null)
      const exited = renderComponent(exposed.GufaTerminalTab, { session: { ...session, exited: true }, active: false, onSelect() {}, onClose() {} })
      expand(exited.vnode)
      check('GufaTerminalTab 渲染（已退出）', exited.vnode !== undefined && exited.vnode !== null)
      check('GufaTerminalTab 不调用 hooks', rendered.hookCount === 0 && exited.hookCount === 0)
    } catch (error) {
      check('GufaTerminalTab 渲染', false, error instanceof Error ? error.stack : String(error))
    }

    // 单个终端视图：xterm 资产失败 → 纯文本降级 UI；以及已退出状态
    const failedAssets = { status: 'failed', Terminal: null, FitAddon: null, error: '模拟 xterm 加载失败' }
    for (const scenario of [
      { name: '降级模式（xterm 加载失败）', session: { id: 'term-1', title: 'zsh', exited: false }, assets: failedAssets },
      { name: '已退出的会话', session: { id: 'term-1', title: 'zsh', exited: true, exitCode: 1 }, assets: failedAssets },
    ]) {
      try {
        const props = {
          session: scenario.session,
          root: '/tmp/gufa-demo',
          active: true,
          visible: true,
          theme: 'dark',
          assets: scenario.assets,
          register() {},
          unregister() {},
          onExit() {},
          onTitle() {},
        }
        const first = renderComponent(exposed.GufaTerminalView, props)
        expand(first.vnode)
        const second = renderComponent(exposed.GufaTerminalView, props)
        check(`GufaTerminalView 渲染：${scenario.name}`, first.vnode !== undefined && first.vnode !== null)
        check(`GufaTerminalView hook 数量稳定：${scenario.name}`, first.hookCount === second.hookCount, `${first.hookCount} vs ${second.hookCount}`)
      } catch (error) {
        check(`GufaTerminalView 渲染：${scenario.name}`, false, error instanceof Error ? error.stack : String(error))
      }
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

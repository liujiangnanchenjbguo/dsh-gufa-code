#!/usr/bin/env node
/**
 * 真实 PTY 集成自测（可选，需要本机解包后的 DSH 安装目录）。
 *
 * 不启动 Harness，而是直接实例化 DSH 的 `LocalSubprocessRuntime`（本地 node-pty 实现），
 * 用 host/terminal.js 的 register() 走一遍真实链路：
 *   spawnTerminal → PTY 输出 → WS 广播 → 键盘输入 → resize → exit → close
 * 并验证环境变量过滤与 `since` 增量回放语义。
 *
 * 依赖：/tmp/dsh-asar/dsh（或 GUFA_DSH_ASAR 指定的目录）与 node-pty 的
 *       prebuilds/darwin-arm64/{pty.node,spawn-helper}（从 app.asar.unpacked 复制）。
 * 条件不满足时打印 skip 并以 0 退出，不影响常规 CI。
 *
 * 用法：node scripts/selftest-terminal-pty.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshRoot = process.env.GUFA_DSH_ASAR ?? '/tmp/dsh-asar/dsh'
const modules = join(dshRoot, 'node_modules')

function skip(reason) {
  console.log(`selftest-terminal-pty: skip — ${reason}`)
  process.exit(0)
}

const cordisEntry = join(modules, '@deepseek-ai', 'cordis', 'lib', 'index.js')
const subprocessEntry = join(modules, '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js')
const ptyPrebuild = join(modules, 'node-pty', 'prebuilds', `${process.platform}-${process.arch}`)
if (!existsSync(cordisEntry) || !existsSync(subprocessEntry)) skip(`未找到解包后的 DSH 安装：${dshRoot}`)
if (!existsSync(join(ptyPrebuild, 'pty.node')) || !existsSync(join(ptyPrebuild, 'spawn-helper'))) {
  skip(`node-pty 原生模块缺失：${ptyPrebuild}（可从 DSH.app/Contents/Resources/app.asar.unpacked 复制）`)
}

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

const { Context } = await import(pathToFileURL(cordisEntry).href)
const { default: LocalSubprocessRuntime } = await import(pathToFileURL(subprocessEntry).href)
const { ProjectRegistry } = await import(pathToFileURL(join(packageRoot, 'host', 'context.js')).href)
const terminal = await import(pathToFileURL(join(packageRoot, 'host', 'terminal.js')).href)

/* ── 假 router / WS 连接（与 selftest-terminal.mjs 一致） ───────────────── */
function makeRouter() {
  const router = {
    methods: new Map(),
    sockets: [],
    disposers: [],
    method(name, fn) {
      router.methods.set(name, fn)
    },
    ws(channel, handler) {
      router.sockets.push({ channel, handler })
    },
    onDispose(fn) {
      router.disposers.push(fn)
    },
  }
  return router
}
function makeConnection() {
  const handlers = new Map()
  const connection = {
    readyState: 1,
    bufferedAmount: 0,
    frames: [],
    send(text) {
      connection.frames.push(JSON.parse(text))
    },
    close() {},
    ping() {},
    on(event, fn) {
      handlers.set(event, fn)
    },
    once(event, fn) {
      handlers.set(event, fn)
    },
    emit(event, value) {
      handlers.get(event)?.(value)
    },
  }
  return connection
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const textOf = (connection) => connection.frames.filter((frame) => frame.type === 'output').map((frame) => frame.data).join('')
const lastOutput = (connection) => [...connection.frames].reverse().find((frame) => frame.type === 'output')

/* ── 启动真实 subprocess 服务 ──────────────────────────────────────────── */
const ctx = new Context()
ctx.logger = { debug() {}, warn() {}, error: (...args) => console.error('[host]', ...args) }
const runtime = new LocalSubprocessRuntime(ctx)
check('ctx.get(subprocess).spawnTerminal 可用', typeof ctx.get('subprocess')?.spawnTerminal === 'function')

const sandboxRoot = mkdtempSync(join(tmpdir(), 'gufa-terminal-pty-'))
const projectDir = join(sandboxRoot, 'project')
mkdirSync(projectDir)
const router = makeRouter()
const env = { ctx, projects: new ProjectRegistry() }
const opened = await env.projects.open(projectDir)
terminal.register(router, env)
const call = (name, body = {}) => router.methods.get(name)(body, {})
const wsUrl = (id, since) => new URL(`http://dsh.local/gufa-code/ws?channel=terminal&root=${encodeURIComponent(opened.root)}&id=${encodeURIComponent(id)}${since === undefined ? '' : `&since=${since}`}`)
const attach = (connection, id, since) => router.sockets.find((socket) => socket.channel === 'terminal').handler(connection, wsUrl(id, since), {})

try {
  console.log('真实 PTY：create / 输入输出 / resize')
  process.env.GUFA_TERMINAL_SELFTEST_TOKEN = 'must-not-leak'
  const created = await call('terminal.create', { root: opened.root, cols: 100, rows: 30 })
  check('create 返回 title=zsh', created.title === 'zsh', created.title)

  const connection = makeConnection()
  attach(connection, created.id)
  await sleep(2500)
  // 通过 shell 打印敏感变量（应为空）与中间结果，验证环境过滤 + PTY 双向通道
  connection.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: `printf 'token=[%s]\\n' "$GUFA_TERMINAL_SELFTEST_TOKEN"; echo REAL_PTY_$((6*7))\r` })))
  await sleep(2000)
  const streamText = textOf(connection)
  check('PTY 输出回传（命令结果）', streamText.includes('REAL_PTY_42'))
  check('敏感环境变量被过滤', streamText.includes('token=[]'), JSON.stringify(streamText.slice(-120)))

  connection.emit('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 120, rows: 40 })))
  await sleep(400)
  const resized = await call('terminal.list', { root: opened.root })
  check('resize 生效', resized.terminals[0]?.cols === 120 && resized.terminals[0]?.rows === 40, JSON.stringify(resized.terminals[0]))

  console.log('真实 PTY：since 增量回放')
  const bytes1 = lastOutput(connection).offset + Buffer.byteLength(lastOutput(connection).data)
  connection.emit('close')
  await sleep(100)
  const c2 = makeConnection()
  attach(c2, created.id, bytes1)
  check('无新输出时 since 重连不重复回放', textOf(c2).length === 0)
  c2.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'echo MARK_AFTER_RECONNECT\r' })))
  await sleep(1500)
  check('since 重连后仍可输入输出', textOf(c2).includes('MARK_AFTER_RECONNECT'))
  const bytes2 = lastOutput(c2).offset + Buffer.byteLength(lastOutput(c2).data)
  c2.emit('close')
  await sleep(100)

  // c2 断开期间由另一个连接产生输出，再以 bytes2 重连：只补缺失段
  const producer = makeConnection()
  attach(producer, created.id)
  producer.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'echo MISSED_WHILE_OFFLINE\r' })))
  await sleep(1500)
  producer.emit('close')
  await sleep(100)
  const catchUp = makeConnection()
  attach(catchUp, created.id, bytes2)
  const catchUpText = textOf(catchUp)
  check('since 重连补发缺失输出', catchUpText.includes('MISSED_WHILE_OFFLINE'))
  check('since 重连不重复已有输出', !catchUpText.includes('MARK_AFTER_RECONNECT'))
  check('补发帧 offset 等于 since', lastOutput(catchUp)?.offset === bytes2)
  const latestBytes = lastOutput(catchUp).offset + Buffer.byteLength(lastOutput(catchUp).data)
  const idle = makeConnection()
  attach(idle, created.id, latestBytes)
  check('since 等于最新偏移时无回放', textOf(idle).length === 0)

  console.log('真实 PTY：exit / close')
  catchUp.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'exit\r' })))
  await sleep(2000)
  const exitFrame = [...catchUp.frames, ...idle.frames].find((frame) => frame.type === 'exit')
  check('shell 退出广播 exit 帧', exitFrame !== undefined && typeof exitFrame.code === 'number', JSON.stringify(exitFrame))
  const closed = await call('terminal.close', { root: opened.root, id: created.id })
  check('terminal.close 幂等成功', closed.ok === true)
} finally {
  for (const dispose of router.disposers) dispose()
  await sleep(500)
  rmSync(sandboxRoot, { recursive: true, force: true })
  // 释放 subprocess 服务（会终止仍存活的 PTY）
  try {
    await runtime.disposeManagedProcesses?.()
  } catch {
    /* ignore */
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

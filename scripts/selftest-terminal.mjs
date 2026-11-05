#!/usr/bin/env node
/**
 * 终端能力自测：不启动 Harness / 不分配真实 PTY。
 *
 * 用假的 ctx.subprocess（handle 用 PassThrough 模拟输出）验证 host/terminal.js 的
 * create/list/close/WS/重连回放/上限/卸载 逻辑，并单测 host/terminal-pty.js 的纯函数。
 *
 * 用法：node scripts/selftest-terminal.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { ProjectRegistry } from '../host/context.js'
import * as terminal from '../host/terminal.js'
import {
  clampInteger,
  filteredEnvironment,
  ReplayBuffer,
  resolveShellPath,
  tailByBytes,
  terminalTitleFor,
  TERMINAL_TYPE,
} from '../host/terminal-pty.js'

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

/** 假 router：只记录注册的 method / ws / onDispose。 */
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
    streams: new Map(),
    stream(name, fn) {
      router.streams.set(name, fn)
    },
    onDispose(fn) {
      router.disposers.push(fn)
    },
  }
  return router
}

/** 假 PTY handle：PassThrough 输出 + 记录 write/resize/terminate。 */
function makeFakeSubprocess() {
  const calls = { spawn: [], spec: null }
  const spawned = []
  const service = {
    terminalEnvironment: async () => ({ platform: 'posix', defaultShell: '/bin/zsh' }),
    async spawnTerminal(spec) {
      calls.spawn.push(spec)
      calls.spec = spec
      const output = new PassThrough()
      let resolveExit
      const done = new Promise((resolve) => {
        resolveExit = resolve
      })
      const handle = {
        output,
        writes: [],
        resizes: [],
        terminated: 0,
        write(data) {
          handle.writes.push(data)
        },
        resize(cols, rows) {
          handle.resizes.push([cols, rows])
        },
        async terminate() {
          handle.terminated += 1
          output.end()
        },
        done,
        resolveExit,
      }
      spawned.push(handle)
      return handle
    },
  }
  return { service, calls, spawned }
}

/** 假 WS 连接。 */
/** 去掉诊断用的 hello 帧，只看终端协议帧。 */
function stripControlFrames(connection) {
  connection.frames = connection.frames.filter((frame) => frame.type !== 'hello' && frame.type !== 'hello2')
  return connection
}

function makeConnection() {
  const handlers = new Map()
  return {
    readyState: 1,
    bufferedAmount: 0,
    frames: [],
    send(text) {
      this.frames.push(JSON.parse(text))
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
}

/** 已经过 decode 的一帧输出（模拟 PTY 流）。 */
function emit(handle, text) {
  handle.output.write(Buffer.from(text, 'utf8'))
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const sandbox = mkdtempSync(join(tmpdir(), 'gufa-terminal-selftest-'))
const projectDir = join(sandbox, 'demo-project')
const { mkdirSync } = await import('node:fs')
mkdirSync(projectDir)

console.log('terminal-pty 纯函数')
{
  const env = filteredEnvironment({
    HOME: '/Users/demo',
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/zsh',
    LANG: 'zh_CN.UTF-8',
    OPENAI_API_KEY: 'sk-secret',
    GITHUB_TOKEN: 'ghp_secret',
    AWS_SECRET_ACCESS_KEY: 'secret',
    DSH_SESSION_ID: 'abc',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    MONKEY: 'not-a-key',
    KEYBOARD_LAYOUT: 'us',
  })
  check('keeps HOME/PATH/SHELL/LANG', env.HOME === '/Users/demo' && env.PATH === '/usr/bin:/bin' && env.SHELL === '/bin/zsh' && env.LANG === 'zh_CN.UTF-8')
  check('filters *_KEY / *_TOKEN / *_SECRET', env.OPENAI_API_KEY === undefined && env.GITHUB_TOKEN === undefined && env.AWS_SECRET_ACCESS_KEY === undefined)
  check('filters DSH_* namespace', env.DSH_SESSION_ID === undefined)
  check('keeps SSH_AUTH_SOCK', env.SSH_AUTH_SOCK === '/tmp/agent.sock')
  check('does not false-positive MONKEY/KEYBOARD_LAYOUT', env.MONKEY === 'not-a-key' && env.KEYBOARD_LAYOUT === 'us')
  check('forces TERM=xterm-256color', env.TERM === TERMINAL_TYPE)

  check('clampInteger default', clampInteger(undefined, 80, 2, 1000) === 80)
  check('clampInteger bounds', clampInteger(1, 80, 2, 1000) === 2 && clampInteger(99999, 80, 2, 1000) === 1000)
  check('clampInteger truncates', clampInteger(33.9, 80, 2, 1000) === 33)
  check('clampInteger rejects NaN', clampInteger(Number.NaN, 24, 2, 500) === 24)

  const title = terminalTitleFor('/bin/zsh')
  check('terminalTitleFor zsh', title === 'zsh', title)
  check('terminalTitleFor windows', terminalTitleFor('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') === 'powershell')
  check('tailByBytes trims to limit', Buffer.byteLength(tailByBytes('你好世界hello', 10), 'utf8') <= 10)
  check('tailByBytes keeps short text', tailByBytes('abc', 10) === 'abc')

  const exists = async (path) => path === '/bin/zsh' || path === '/opt/custom'
  check('resolveShellPath explicit wins', (await resolveShellPath({ explicit: '/opt/custom', preferred: '/bin/zsh', env: {}, exists })) === '/opt/custom')
  check('resolveShellPath explicit missing falls back', (await resolveShellPath({ explicit: '/nope', preferred: '/bin/zsh', env: {}, exists })) === '/bin/zsh')
  check('resolveShellPath env SHELL fallback', (await resolveShellPath({ env: { SHELL: '/bin/zsh' }, exists, platform: 'darwin' })) === '/bin/zsh')
  check('resolveShellPath platform default', (await resolveShellPath({ env: {}, platform: 'darwin', exists: async () => false })) === '/bin/zsh')
}

console.log('ReplayBuffer')
{
  const buffer = new ReplayBuffer(32)
  buffer.push('hello')
  check('totalBytes after push', buffer.totalBytes === 5, String(buffer.totalBytes))
  check('retainedStart after push', buffer.retainedStart === 0, String(buffer.retainedStart))
  check('sliceFrom aligned', buffer.sliceFrom(2).text === 'llo' && buffer.sliceFrom(2).lossy === false)
  check('sliceFrom end', buffer.sliceFrom(5).text === '')
  buffer.push(' world')
  check('toString joins', buffer.toString() === 'hello world')
  check('sliceFrom across chunks', buffer.sliceFrom(5).text === ' world')
  check('sliceFrom future offset is lossy', buffer.sliceFrom(999).lossy === true)
  check('sliceFrom negative is lossy', buffer.sliceFrom(-1).lossy === true)
  check('sliceFrom inside chunk (misaligned) resyncs', buffer.sliceFrom(2).text.startsWith('llo'))
  const trimmed = new ReplayBuffer(16)
  trimmed.push('aaaaaaaaaa') // 10
  trimmed.push('bbbbbbbbbb') // 20 > 16 → 丢弃第一段
  check('trims oldest chunk', trimmed.toString() === 'bbbbbbbbbb', trimmed.toString())
  check('retainedStart advances', trimmed.retainedStart === 10, String(trimmed.retainedStart))
  check('old offset becomes lossy', trimmed.sliceFrom(5).lossy === true)
  const huge = new ReplayBuffer(8)
  huge.push('0123456789abcdef')
  check('oversized chunk keeps tail', huge.toString() === '89abcdef', huge.toString())
  check('oversized chunk totalBytes', huge.totalBytes === 16, String(huge.totalBytes))
  check('oversized retainedStart', huge.retainedStart === 8, String(huge.retainedStart))
  huge.clear()
  check('clear keeps absolute counter', huge.totalBytes === 16 && huge.retainedBytes === 0)
}

console.log('terminal.create / list / close（假 subprocess）')
{
  const router = makeRouter()
  const { service, calls, spawned } = makeFakeSubprocess()
  const env = {
    ctx: {
      get(name) {
        return name === 'subprocess' ? service : undefined
      },
    },
    projects: new ProjectRegistry(),
  }
  const opened = await env.projects.open(projectDir)
  const root = opened.root
  terminal.register(router, env)
  const call = (name, body = {}) => router.methods.get(name)(body, {})

  const created = await call('terminal.create', { root, cols: 120, rows: 30 })
  check('create returns id/title', typeof created.id === 'string' && created.id.startsWith('term-') && created.title === 'zsh', JSON.stringify(created))
  const spec = calls.spawn[0]
  check('spawn uses login shell', spec.argv[0] === '/bin/zsh' && spec.argv.includes('-l'), JSON.stringify(spec.argv))
  check('spawn cwd = project root', spec.cwd === root, spec.cwd)
  check('spawn terminalType', spec.terminalType === TERMINAL_TYPE)
  check('spawn graceMs', spec.graceMs === 5000, String(spec.graceMs))
  check('spawn rows/cols from request', spec.rows === 30 && spec.cols === 120)
  check('spawn env filtered', spec.env.TERM === TERMINAL_TYPE && typeof spec.env.PATH === 'string' && spec.env.DSH_SESSION_ID === undefined)

  const list = await call('terminal.list', { root })
  check('list reports one alive terminal', list.terminals.length === 1 && list.terminals[0].alive === true && list.terminals[0].cols === 120)

  // WS 接入 + 回放
  const handle = spawned[0]
  await emit(handle, 'welcome $ ')
  const connection = makeConnection()
  const wsEntry = router.sockets.find((item) => item.channel === 'terminal')
  const cleanup = wsEntry.handler(connection, new URL(`http://dsh.local/gufa-code/ws?channel=terminal&root=${encodeURIComponent(root)}&id=${encodeURIComponent(created.id)}`), {})
  stripControlFrames(connection)
  check('ws attach replays existing output with offset', connection.frames[0]?.type === 'output' && connection.frames[0].data === 'welcome $ ' && connection.frames[0].offset === 0, JSON.stringify(connection.frames))
  check('ws handler returns cleanup', typeof cleanup === 'function')

  await emit(handle, 'ls -la\r\n')
  check('live output broadcast', connection.frames.at(-1)?.type === 'output' && connection.frames.at(-1).data === 'ls -la\r\n')
  const receivedBytes = connection.frames.at(-1).offset + Buffer.byteLength(connection.frames.at(-1).data)

  connection.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'echo hi\r' })))
  check('input forwarded to pty', handle.writes.at(-1) === 'echo hi\r', JSON.stringify(handle.writes))
  connection.emit('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 90, rows: 20 })))
  check('resize forwarded to pty', handle.resizes.at(-1)?.[0] === 90 && handle.resizes.at(-1)?.[1] === 20, JSON.stringify(handle.resizes))
  connection.emit('message', Buffer.from('not-json'))
  check('invalid ws message ignored', handle.writes.length === 1)

  // 断开后重连：只补发缺失部分
  cleanup()
  await emit(handle, 'after-disconnect')
  const reconnect = makeConnection()
  wsEntry.handler(reconnect, new URL(`http://dsh.local/gufa-code/ws?channel=terminal&root=${encodeURIComponent(root)}&id=${encodeURIComponent(created.id)}&since=${receivedBytes}`), {})
  stripControlFrames(reconnect)
  check('reconnect sends only missing tail', reconnect.frames.length === 1 && reconnect.frames[0].type === 'output' && reconnect.frames[0].data === 'after-disconnect', JSON.stringify(reconnect.frames))
  check('reconnect tail offset = since', reconnect.frames[0].offset === receivedBytes, String(reconnect.frames[0]?.offset))

  // 退出
  handle.resolveExit({ exitCode: 0, signal: null })
  await new Promise((resolve) => setTimeout(resolve, 0))
  check('exit broadcast to ws', reconnect.frames.at(-1)?.type === 'exit' && reconnect.frames.at(-1).code === 0, JSON.stringify(reconnect.frames.at(-1)))
  const exitedList = await call('terminal.list', { root })
  check('list marks exited terminal', exitedList.terminals[0].alive === false && exitedList.terminals[0].exitCode === 0)

  // 关闭
  const closed = await call('terminal.close', { root, id: created.id })
  check('close returns ok', closed.ok === true)
  check('close terminates pty', handle.terminated === 1)
  check('list empty after close', (await call('terminal.list', { root })).terminals.length === 0)
  let missing = false
  try {
    await call('terminal.close', { root, id: created.id })
  } catch (error) {
    missing = error.code === 'not-found'
  }
  check('second close -> not-found', missing)

  // 上限 8
  const ids = []
  for (let index = 0; index < 8; index += 1) ids.push((await call('terminal.create', { root })).id)
  let limited = false
  try {
    await call('terminal.create', { root })
  } catch (error) {
    limited = error.code === 'terminal-limit'
  }
  check('per-root terminal limit is 8', limited)

  // 未知 root 被拒绝
  let rejected = false
  try {
    await call('terminal.create', { root: '/tmp/not-opened' })
  } catch (error) {
    rejected = error.code === 'project-not-open'
  }
  check('unregistered root rejected', rejected)

  // dispose 清理全部 PTY
  for (const dispose of router.disposers) dispose()
  check('dispose terminates every pty', spawned.every((item) => item.terminated >= 1), spawned.map((item) => item.terminated).join(','))
  check('dispose clears list', (await (async () => { try { return await call('terminal.list', { root }) } catch { return { terminals: [] } } })()).terminals.length === 0)
}

console.log('WS 错误路径')
{
  const router = makeRouter()
  const { service } = makeFakeSubprocess()
  const env = {
    ctx: { get: (name) => (name === 'subprocess' ? service : undefined) },
    projects: new ProjectRegistry(),
  }
  await env.projects.open(projectDir)
  terminal.register(router, env)
  const wsEntry = router.sockets.find((item) => item.channel === 'terminal')
  const connection = makeConnection()
  wsEntry.handler(connection, new URL('http://dsh.local/gufa-code/ws?channel=terminal&root=%2Fnope&id=nope'), {})
  check('unknown terminal -> error frame', connection.frames[0]?.type === 'error', JSON.stringify(connection.frames))
  for (const dispose of router.disposers) dispose()
}

console.log('终端服务缺失')
{
  const router = makeRouter()
  const env = { ctx: { get: () => undefined }, projects: new ProjectRegistry() }
  const opened = await env.projects.open(projectDir)
  terminal.register(router, env)
  let code = ''
  try {
    await router.methods.get('terminal.create')({ root: opened.root }, {})
  } catch (error) {
    code = error.code
  }
  check('missing subprocess -> terminal-unavailable', code === 'terminal-unavailable', code)
}

rmSync(sandbox, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

#!/usr/bin/env node
/**
 * Host HTTP / WebSocket 端到端自测（不启动 Harness）：
 * 用假 ctx 把真实 host 半（index.js → router → host/*.js）挂到本地 http 服务上，
 * 走真实 fetch / ws 验证：鉴权围栏、项目/文件/Git API、静态资产、SSE、错误响应、WS 升级。
 *
 * 用法：node scripts/selftest-http.mjs
 */
import { createServer } from 'node:http'
import { PassThrough } from 'node:stream'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

import { ProjectRegistry } from '../host/context.js'

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

/* ── 假 ctx：把路由挂到真实 http 服务 ─────────────────────────────────── */
const httpRoutes = []
const upgradeRoutes = []
const effects = []

/* 假 Host 服务：subprocess（PTY 回显）与 llm（流式两段式输出）。
   让 host/terminal.js 与 host/chat.js 的完整路径在无 Harness 环境下也能端到端验证。 */
const fakeTerminals = new Map()
const fakeLlmRequests = []
const fakeSubprocess = {
  async terminalEnvironment() {
    return { defaultShell: '/bin/zsh' }
  },
  async spawnTerminal(spec) {
    const output = new PassThrough()
    const id = `fake-${fakeTerminals.size + 1}`
    const handle = {
      pid: 9000 + fakeTerminals.size,
      cols: spec?.cols ?? 80,
      rows: spec?.rows ?? 24,
      output,
      write: async (data) => {
        output.write(data)
        return true
      },
      resize: () => {},
      terminate: async () => {
        output.end()
      },
      done: new Promise(() => {}),
    }
    fakeTerminals.set(id, handle)
    setTimeout(() => output.write('gufa-fake-prompt$ '), 10)
    return handle
  },
}
const fakeLlm = {
  stream(options) {
    fakeLlmRequests.push(options)
    return (async function* stream() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '你好，' }
      yield { type: 'text-delta', index: 0, text: '这是古法 AI。' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '你好，这是古法 AI。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  },
}
const fakeDefaultModel = {
  currentSelection() {
    return { provider: 'deepseek-official', model: 'deepseek-flash' }
  },
}

const ctx = {
  get(name) {
    if (name === 'subprocess') return fakeSubprocess
    if (name === 'llm') return fakeLlm
    if (name === 'agentDefaultModel') return fakeDefaultModel
    return undefined
  },
  effect(fn) {
    const dispose = fn()
    effects.push(typeof dispose === 'function' ? dispose : () => {})
    return () => {}
  },
  webServer: {
    register(route) {
      const entry = { ...route }
      httpRoutes.push(entry)
      return () => {
        const index = httpRoutes.indexOf(entry)
        if (index >= 0) httpRoutes.splice(index, 1)
      }
    },
    registerUpgrade(route) {
      const entry = { ...route }
      upgradeRoutes.push(entry)
      return () => {
        const index = upgradeRoutes.indexOf(entry)
        if (index >= 0) upgradeRoutes.splice(index, 1)
      }
    },
  },
  connection: { requestRejection: () => undefined },
  logger: { warn: () => {}, error: () => {} },
}

const plugin = await import('../index.js')
check('plugin entry exposes apply', typeof plugin.apply === 'function' && plugin.name === 'dsh-gufa-code')
plugin.apply(ctx)

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  const route = httpRoutes
    .filter((item) => (item.kind === 'prefix' ? pathname.startsWith(item.path) : pathname === item.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (route === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    try {
      res.writeHead(500)
      res.end(String(error))
    } catch {
      /* ignore */
    }
  })
})
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  const route = upgradeRoutes.find((item) => item.path === pathname)
  if (route === undefined) {
    socket.destroy()
    return
  }
  Promise.resolve(route.handler(req, socket, head)).catch(() => socket.destroy())
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`
const sandbox = mkdtempSync(join(tmpdir(), 'gufa-http-test-'))

async function api(method, body) {
  const response = await fetch(`${base}/gufa-code/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

try {
  /* 项目 / 文件 */
  const created = await api('project.create', { parent: sandbox, name: 'http-project' })
  check('project.create ok', created.status === 200 && created.payload.ok === true && created.payload.value.name === 'http-project', JSON.stringify(created.payload))
  const root = created.payload.value.root
  execFileSync('git', ['init', '-q'], { cwd: root })
  await api('fs.create', { root, path: 'src', kind: 'dir' })
  await api('fs.create', { root, path: 'src/app.ts', kind: 'file' })
  const written = await api('fs.write', { root, path: 'src/app.ts', content: 'export const x = 1\n' })
  check('fs.write ok', written.status === 200 && typeof written.payload.value.revision === 'string')
  const listed = await api('fs.list', { root, path: '' })
  check('fs.list sees dir', listed.payload.value.entries.some((entry) => entry.name === 'src'))
  const unknown = await api('nope.nope', {})
  check('unknown method 404', unknown.status === 404 && unknown.payload.error.code === 'not-found', String(unknown.status))
  const unopened = await api('fs.list', { root: '/tmp', path: '' })
  check('unopened root rejected', unopened.status === 403 && unopened.payload.error.code === 'project-not-open', JSON.stringify(unopened.payload))

  /* Git */
  const gitStatus = await api('git.status', { root })
  check('git.status detects repo', gitStatus.payload.value.isGit === true, JSON.stringify(gitStatus.payload))
  check('git.status lists change', gitStatus.payload.value.changes.some((change) => change.path === 'src/app.ts'))

  /* 静态资产 */
  const loader = await fetch(`${base}/gufa-code/asset/monaco/loader.js`)
  const loaderText = await loader.text()
  check('monaco loader served', loader.status === 200 && loader.headers.get('content-type').includes('javascript') && loaderText.length > 1000, String(loader.status))
  const xterm = await fetch(`${base}/gufa-code/asset/xterm/xterm.js`)
  check('xterm served', xterm.status === 200)
  const traversal = await fetch(`${base}/gufa-code/asset/monaco/..%2f..%2f..%2fpackage.json`)
  check('asset traversal rejected', traversal.status === 404 || traversal.status === 403, String(traversal.status))

  /* chat.info / SSE */
  const info = await api('chat.info', {})
  check('chat.info ok', info.status === 200 && info.payload.ok === true, JSON.stringify(info.payload))
  const streamResponse = await fetch(`${base}/gufa-code/api/chat.stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], context: { root, path: 'src/app.ts', content: 'x' } }),
  })
  check('chat.stream sse content-type', streamResponse.status === 200 && (streamResponse.headers.get('content-type') ?? '').includes('text/event-stream'), String(streamResponse.status))
  const reader = streamResponse.body?.getReader()
  let firstFrame = ''
  if (reader !== undefined) {
    const { value } = await reader.read()
    firstFrame = value === undefined ? '' : Buffer.from(value).toString('utf8')
    await reader.cancel().catch(() => {})
  }
  check('chat.stream emits sse frame', firstFrame.startsWith('data: '), firstFrame.slice(0, 120))
  const rest = reader === undefined ? '' : ''
  void rest
  check('chat.stream sends llm delta', firstFrame.includes('"type":"delta"') || firstFrame.includes('"type": "delta"'), firstFrame.slice(0, 160))
  check('chat.stream called ctx.llm.stream', fakeLlmRequests.length === 1 && fakeLlmRequests[0].provider === 'deepseek-official', JSON.stringify(fakeLlmRequests.map((item) => ({ provider: item.provider, model: item.model }))))
  check('chat.stream prompt embeds context', typeof fakeLlmRequests[0]?.messages?.[0]?.content?.[0]?.text === 'string' && fakeLlmRequests[0].messages[0].content[0].text.includes('src/app.ts'), 'prompt missing file context')

  /* 终端：create + WS 往返（假 PTY 回显 input） */
  const terminalCreated = await api('terminal.create', { root, cols: 80, rows: 24 })
  if (terminalCreated.status === 200 && terminalCreated.payload.ok === true) {
    const info2 = terminalCreated.payload.value
    check('terminal.create returned id', typeof info2.id === 'string' && info2.id.length > 0, JSON.stringify(info2))
    const wsResult = await new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/gufa-code/ws?channel=terminal&root=${encodeURIComponent(root)}&id=${encodeURIComponent(info2.id)}`)
      const timer = setTimeout(() => {
        try {
          socket.close()
        } catch {
          /* ignore */
        }
        resolve({ ok: false, reason: 'timeout' })
      }, 8000)
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString())
        if (message.type === 'output' && typeof message.data === 'string' && message.data.length > 0) {
          clearTimeout(timer)
          try {
            socket.close()
          } catch {
            /* ignore */
          }
          resolve({ ok: true, sample: message.data.slice(0, 80) })
        }
      })
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'input', data: 'echo gufa-terminal-ok\r' }))
      })
      socket.on('error', (error) => {
        clearTimeout(timer)
        resolve({ ok: false, reason: error.message })
      })
      socket.on('close', () => {
        clearTimeout(timer)
        resolve({ ok: false, reason: 'closed' })
      })
    })
    check('terminal ws roundtrip', wsResult.ok, JSON.stringify(wsResult))
    await api('terminal.close', { root, id: info2.id })
  } else {
    check('terminal.create ok', false, JSON.stringify(terminalCreated))
  }

  /* 鉴权围栏：模拟 connection 拒绝 */
  ctx.connection.requestRejection = () => 401
  const denied = await api('chat.info', {})
  check('auth fence rejects', denied.status === 401, String(denied.status))
  ctx.connection.requestRejection = () => undefined
} finally {
  await new Promise((resolve) => server.close(resolve))
  for (const dispose of effects.splice(0)) {
    try {
      dispose()
    } catch {
      /* ignore */
    }
  }
  rmSync(sandbox, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

/**
 * 语言服务桥（LSP）：给 IDE 的 Cmd/Ctrl+点击、悬停提供真正的语言级定义。
 *
 * 目前接 Pyright（Python）：npm 依赖 `pyright`，Host 以子进程方式启动
 * `node node_modules/pyright/langserver.index.js --stdio`，用 JSON-RPC over stdio
 * 管理 initialize / didOpen / didChange / textDocument/definition，返回项目内
 * 定义位置。浏览器侧不直连 LSP，而是通过 `lsp.definition` API 调用，避免在
 * renderer 里再实现一遍 JSON-RPC。
 */
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ApiError, badRequest } from './context.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** root → session */
const sessions = new Map()
let installPromise = null

function pyrightEntry() {
  return resolve(packageRoot, 'node_modules', 'pyright', 'langserver.index.js')
}

async function fileExists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** 缺依赖时按用户授权做一次自动安装（npm 依赖 pyright）。 */
async function ensurePyright() {
  const entry = pyrightEntry()
  if (await fileExists(entry)) return entry
  if (installPromise === null) {
    installPromise = (async () => {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(npm, ['install', 'pyright', '--no-audit', '--no-fund'], {
          cwd: packageRoot,
          env: process.env,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        let stderr = ''
        child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* ignore */ }
          rejectPromise(new Error('安装 pyright 超时（npm install）'))
        }, 180000)
        child.on('error', (error) => {
          clearTimeout(timer)
          rejectPromise(new Error(`无法执行 npm：${error.message}`))
        })
        child.on('exit', (code) => {
          clearTimeout(timer)
          if (code === 0) resolvePromise()
          else rejectPromise(new Error(`npm install pyright 失败（exit ${code}）：${stderr.slice(-400)}`))
        })
      })
      if (!(await fileExists(entry))) throw new Error('pyright 安装完成但找不到 langserver.index.js')
      return entry
    })().finally(() => { installPromise = null })
  }
  return await installPromise
}

class JsonRpcClient {
  constructor(child, root, name) {
    this.child = child
    this.root = root
    this.name = name
    this.buffer = Buffer.alloc(0)
    this.nextId = 1
    this.pending = new Map()
    this.stderr = ''
    this.closed = false
    child.stdout.on('data', (chunk) => this.onData(chunk))
    child.stderr?.on('data', (chunk) => {
      this.stderr += String(chunk)
      if (this.stderr.length > 16000) this.stderr = this.stderr.slice(-8000)
    })
    child.on('exit', (code) => {
      this.closed = true
      const failure = new ApiError('lsp-exited', `语言服务进程已退出（code ${code}）${this.stderr.slice(-300)}`, 500)
      for (const entry of this.pending.values()) entry.reject(failure)
      this.pending.clear()
    })
    child.on('error', (error) => {
      this.closed = true
      const failure = new ApiError('lsp-error', `语言服务进程错误：${error.message}`, 500)
      for (const entry of this.pending.values()) entry.reject(failure)
      this.pending.clear()
    })
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString('utf8')
      const lengthMatch = /content-length:\s*(\d+)/i.exec(header)
      if (lengthMatch === null) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(lengthMatch[1])
      const total = headerEnd + 4 + length
      if (this.buffer.length < total) return
      const body = this.buffer.subarray(headerEnd + 4, total).toString('utf8')
      this.buffer = this.buffer.subarray(total)
      let message = null
      try {
        message = JSON.parse(body)
      } catch {
        continue
      }
      this.dispatch(message)
    }
  }

  dispatch(message) {
    if (message === null || typeof message !== 'object') return
    if (typeof message.id === 'number' && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error !== undefined) entry.reject(new ApiError('lsp-error', String(message.error?.message ?? '语言服务返回错误'), 500))
      else entry.resolve(message.result ?? null)
      return
    }
    if (typeof message.method === 'string' && message.id !== undefined) {
      /* 服务端 → 客户端请求 */
      let result = null
      if (message.method === 'workspace/configuration') {
        const items = Array.isArray(message.params?.items) ? message.params.items : []
        result = items.map(() => null)
      } else if (message.method === 'workspace/workspaceFolders') {
        result = [{ uri: pathToFileURL(this.root).href, name: this.root.split(sep).filter(Boolean).at(-1) ?? 'workspace' }]
      } else if (message.method === 'client/registerCapability' || message.method === 'window/workDoneProgress/create') {
        result = null
      }
      this.send({ jsonrpc: '2.0', id: message.id, result })
      return
    }
    /* 通知：忽略，但要消费 */
  }

  send(message) {
    if (this.closed) return
    try {
      const body = JSON.stringify(message)
      this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
    } catch {
      /* broken pipe */
    }
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  request(method, params, timeoutMs = 20000) {
    if (this.closed) return Promise.reject(new ApiError('lsp-exited', '语言服务进程已退出', 500))
    const id = this.nextId++
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectPromise(new ApiError('lsp-timeout', `语言服务响应超时（${method}）`, 504))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }
}

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function startSession(root) {
  const entry = await ensurePyright()
  const child = spawn(process.execPath, [entry, '--stdio'], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const rpc = new JsonRpcClient(child, root, 'pyright')
  const session = { root, child, rpc, ready: null, documents: new Map() }
  session.ready = (async () => {
    const rootUri = pathToFileURL(root).href
    await rpc.request('initialize', {
      processId: process.pid,
      rootPath: root,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: root.split(sep).filter(Boolean).at(-1) ?? 'workspace' }],
      capabilities: {
        workspace: { workspaceFolders: true, configuration: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, didSave: false },
          definition: { linkSupport: true },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: false },
        },
      },
      clientInfo: { name: 'gufa-code', version: '1.0.0' },
    }, 30000)
    rpc.notify('initialized', {})
    return true
  })()
  session.ready.catch(() => {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    sessions.delete(root)
  })
  return session
}

async function getSession(root) {
  let session = sessions.get(root)
  if (session !== undefined && session.rpc.closed !== true) {
    await session.ready
    return session
  }
  if (session !== undefined) sessions.delete(root)
  session = await startSession(root)
  sessions.set(root, session)
  await session.ready
  return session
}

function syncDocument(session, absolutePath, content) {
  const uri = pathToFileURL(absolutePath).href
  const existing = session.documents.get(uri)
  if (existing === undefined) {
    const document = { uri, version: 1, content }
    session.documents.set(uri, document)
    session.rpc.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'python', version: 1, text: content },
    })
    return
  }
  if (existing.content !== content) {
    existing.version += 1
    existing.content = content
    session.rpc.notify('textDocument/didChange', {
      textDocument: { uri, version: existing.version },
      contentChanges: [{ text: content }],
    })
  }
}

function normalizeLocations(root, result) {
  const raw = Array.isArray(result) ? result : (result === null || result === undefined ? [] : [result])
  const matches = []
  const seen = new Set()
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const uri = typeof item.uri === 'string' ? item.uri : (typeof item.targetUri === 'string' ? item.targetUri : '')
    const range = item.range !== null && typeof item.range === 'object' ? item.range : (item.targetRange ?? null)
    if (uri === '' || range === null || typeof range !== 'object') continue
    let absolute = ''
    try {
      absolute = fileURLToPath(uri)
    } catch {
      continue
    }
    if (!inside(root, absolute)) continue
    const rel = relative(root, absolute).split(sep).join('/')
    const line = Number(range.start?.line)
    const character = Number(range.start?.character)
    if (!Number.isFinite(line) || !Number.isFinite(character)) continue
    const key = `${rel}:${line}:${character}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({ path: rel, line: line + 1, column: character + 1, kind: 'lsp', score: 100, preview: '' })
  }
  return matches
}

async function definition(body, env) {
  if (typeof body.root !== 'string' || body.root === '') throw badRequest('root is required')
  const project = env.projects.ensure(body.root)
  const root = project.root
  const rawPath = typeof body.path === 'string' ? body.path : ''
  if (rawPath === '') throw badRequest('path is required')
  const line = Number(body.line)
  const column = Number(body.column)
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) throw badRequest('line/column is invalid')
  const absolute = resolve(root, rawPath)
  if (!inside(root, absolute)) throw new ApiError('path-outside', '路径超出项目范围', 403)
  let content = typeof body.content === 'string' ? body.content : ''
  if (content === '') {
    try {
      content = await readFile(absolute, 'utf8')
    } catch {
      throw new ApiError('not-found', `文件不存在：${rawPath}`, 404)
    }
  }
  const session = await getSession(root)
  syncDocument(session, absolute, content)
  const uri = pathToFileURL(absolute).href
  let result = null
  try {
    result = await session.rpc.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: line - 1, character: column - 1 },
    }, 25000)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('lsp-failed', `语言服务查询失败：${String(error?.message ?? error)}`, 500)
  }
  const matches = normalizeLocations(root, result)
  return { matches, current: { path: relative(root, absolute).split(sep).join('/'), line, column }, language: 'python', server: 'pyright' }
}

async function status(body, env) {
  const entry = pyrightEntry()
  const available = await fileExists(entry)
  let version = ''
  try {
    const pkg = JSON.parse(await readFile(resolve(packageRoot, 'node_modules', 'pyright', 'package.json'), 'utf8'))
    version = String(pkg.version ?? '')
  } catch {
    version = ''
  }
  void body
  void env
  return {
    available,
    server: 'pyright',
    version,
    languages: available ? ['python'] : [],
    hint: available ? '' : '缺少 pyright 语言服务；重新安装插件或运行 npm install pyright',
  }
}

export function registerLsp(router, env) {
  router.method('lsp.status', (body) => status(body, env))
  router.method('lsp.definition', (body) => definition(body, env))
}

/* 供未来其他 host 模块复用 */
export { normalizeLocations }

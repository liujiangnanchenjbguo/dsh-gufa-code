/**
 * Host 半的公共设施：错误、HTTP 读写、鉴权、项目根白名单、路由注册器。
 *
 * 所有路由挂在同一个前缀 `/gufa-code` 下：
 *   POST /gufa-code/api/<method>   JSON 请求/响应（鉴权 + 同源）
 *   POST /gufa-code/api/<stream>    SSE（chat 流式）
 *   GET  /gufa-code/asset/<prefix>/<path>  静态资产（Monaco / xterm）
 *   WS   /gufa-code/ws/<path>      终端等长连接
 *
 * 鉴权复用 Harness 的 connection 服务（requestRejection），是本机已登录浏览器才能用。
 */
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, normalize, resolve, sep } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'

/** 业务错误：带稳定 code 与 HTTP 状态。 */
export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function badRequest(message) {
  return new ApiError('bad-request', message, 400)
}

/** 读取 JSON 请求体（对象）。 */
export async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > limit) throw new ApiError('too-large', 'request body is too large', 413)
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw badRequest('request body must be valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw badRequest('request body must be a JSON object')
  return value
}

/** 发送 JSON 响应。 */
export function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

/** 发送统一错误响应。 */
export function sendError(res, error) {
  const known = error instanceof ApiError
    ? error
    : new ApiError('internal', error instanceof Error ? error.message : String(error), 500)
  if (res.headersSent) {
    try {
      res.end()
    } catch {
      /* 流已中断 */
    }
    return
  }
  send(res, known.status, { ok: false, error: { code: known.code, message: known.message } })
}

/** 复用 Harness 鉴权与 Host/Origin 围栏。返回 true 表示放行。 */
export function authorize(req, res, connection) {
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return true
  send(res, rejection, { ok: false, error: { code: rejection === 401 ? 'unauthorized' : 'forbidden', message: 'unauthorized' } })
  return false
}

/** 仅允许本机来源（终端等敏感长连接额外收紧）。 */
export function localRequestAllowed(req) {
  const host = req.headers.host
  if (host === undefined || req.headers['sec-fetch-site'] === 'cross-site') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  if (hostname !== 'localhost' && hostname !== '[::1]' && !hostname.startsWith('127.')) return false
  const origin = req.headers.origin
  try {
    return origin === undefined || new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * 已打开项目的白名单。只有用户显式「打开/新建项目」过的目录才能被后续文件操作访问，
 * 避免本插件变成任意路径读写器。
 */
export class ProjectRegistry {
  /** @type {Map<string, { root: string, name: string, isGit: boolean, openedAt: number }>} */
  #projects = new Map()
  #order = []

  get size() {
    return this.#projects.size
  }

  list() {
    return this.#order.map((root) => ({ ...this.#projects.get(root) }))
  }

  /** 登记一个已存在的目录为项目根；返回项目描述。 */
  async open(rawPath) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') throw badRequest('path is required')
    if (!isAbsolute(rawPath)) throw badRequest('path must be absolute')
    const absolute = resolve(normalize(rawPath))
    let canonical
    try {
      canonical = await realpath(absolute)
    } catch {
      throw new ApiError('not-found', `目录不存在：${absolute}`, 404)
    }
    const info = await stat(canonical)
    if (!info.isDirectory()) throw new ApiError('not-directory', `不是目录：${canonical}`, 400)
    const isGit = await stat(resolve(canonical, '.git')).then(() => true, () => false)
    const name = canonical.split(sep).filter(Boolean).at(-1) ?? canonical
    if (!this.#projects.has(canonical)) this.#order.push(canonical)
    this.#projects.set(canonical, { root: canonical, name, isGit, openedAt: Date.now() })
    return { root: canonical, name, isGit }
  }

  forget(root) {
    this.#projects.delete(root)
    this.#order = this.#order.filter((item) => item !== root)
  }

  /** 校验并返回项目根；root 必须是白名单内目录。 */
  ensure(root) {
    if (typeof root !== 'string' || root === '') throw badRequest('root is required')
    const found = this.#projects.get(root)
    if (found === undefined) throw new ApiError('project-not-open', '项目未打开，请先打开项目', 403)
    return found
  }
}

export function isInside(root, target) {
  const rel = target.slice(root.length)
  if (target === root) return true
  return (rel.startsWith(sep) || rel.startsWith('/')) && !rel.includes('..')
}

/**
 * 创建路由注册器，并支持 Host 模块热重载：
 * - createScope() / installScope()：每一代 host 模块注册进独立 scope，重载时整体替换并执行旧 scope 的清理；
 * - setReloader(load, signature)：每次请求前比较 signature（host/*.js mtime），变化则重新 import 并替换。
 *
 * 这样改 host/*.js 后无需重启 Harness（下一次请求自动生效），便于联调。
 */
export function createRouter(ctx) {
  const wss = new WebSocketServer({ noServer: true })
  let scope = emptyScope()
  let reloader
  let signatureFn
  let loadedSignature
  let failedSignature
  let reloading

  function emptyScope() {
    return { methods: new Map(), streams: new Map(), sockets: [], assets: [], disposers: [] }
  }

  /** 新一代模块的注册器（模块通过 register(registrar, env) 使用）。 */
  function createScope() {
    const next = emptyScope()
    const registrar = {
      ctx,
      /** 注册一个 JSON RPC 方法：fn(body, { req, res, signal }) -> value */
      method(name, fn) {
        if (next.methods.has(name)) throw new Error(`duplicate api method ${name}`)
        next.methods.set(name, fn)
      },
      /** 注册一个 SSE 方法：fn(body, { req, res, signal, send, close }) */
      stream(name, fn) {
        if (next.streams.has(name)) throw new Error(`duplicate api stream ${name}`)
        next.streams.set(name, fn)
      },
      /** 注册静态资产：resolver(rawPath) -> { path, type } | undefined */
      asset(prefix, resolver) {
        next.assets.push({ prefix, resolver })
      },
      /** 注册 WebSocket 通道（客户端连 /gufa-code/ws?channel=<name>）：handler(connection, url, req) -> cleanup */
      ws(channel, handler) {
        if (next.sockets.some((item) => item.channel === channel)) throw new Error(`duplicate ws channel ${channel}`)
        next.sockets.push({ channel, handler })
      },
      /** 注册本代作用域的清理（重载/卸载时执行）。 */
      onDispose(fn) {
        next.disposers.push(fn)
      },
      /** 测试用：直接访问本代方法表。 */
      peek(name) {
        return next.methods.get(name) ?? next.streams.get(name)
      },
    }
    return { scope: next, registrar }
  }

  /** 安装新一代 scope：切换后执行上一代清理。 */
  function installScope(next) {
    const previous = scope
    scope = next
    for (const dispose of previous.disposers.splice(0)) {
      try {
        dispose()
      } catch (error) {
        console.error('[gufa-code] scope dispose failed', error)
      }
    }
  }

  async function ensureFresh() {
    if (reloader === undefined) return
    const signature = typeof signatureFn === 'function' ? signatureFn() : ''
    if (loadedSignature === signature || failedSignature === signature) return
    if (reloading !== undefined) {
      await reloading
      return
    }
    reloading = (async () => {
      try {
        await reloader()
        loadedSignature = signature
        failedSignature = undefined
      } catch (error) {
        failedSignature = signature
        console.error('[gufa-code] host 模块加载失败', error)
        if (scope.methods.size === 0) throw new ApiError('module-load-failed', `host 模块加载失败：${error instanceof Error ? error.message : String(error)}`, 500)
      } finally {
        reloading = undefined
      }
    })()
    await reloading
  }

  const router = {
    ctx,
    createScope,
    installScope,
    setReloader(load, signature) {
      reloader = load
      signatureFn = signature
    },
    /** 测试钩子：直接调用一个 JSON 方法（跳过 HTTP 鉴权）。 */
    async __dispatch(name, body = {}) {
      await ensureFresh()
      const fn = scope.methods.get(name)
      if (fn === undefined) throw new ApiError('not-found', `unknown api method: ${name}`, 404)
      return await fn(body, {})
    },
    /** 测试钩子：当前已注册的方法/通道/资产数量。 */
    __stats() {
      return { methods: scope.methods.size, streams: scope.streams.size, sockets: scope.sockets.length, assets: scope.assets.length }
    },
    /** 把全部路由挂到 webServer 生命周期上。 */
    mount() {
      ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/gufa-code/api',
        handler: async (req, res) => {
          if (!authorize(req, res, ctx.connection)) return
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: { code: 'method', message: 'POST required' } })
          const url = new URL(req.url ?? '/', 'http://dsh.local')
          const name = decodeURIComponent(url.pathname.slice('/gufa-code/api/'.length))
          const controller = new AbortController()
          req.once('aborted', () => controller.abort())
          try {
            await ensureFresh()
            const body = await readBody(req)
            const streamHandler = scope.streams.get(name)
            if (streamHandler !== undefined) {
              res.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-store',
                'x-accel-buffering': 'no',
              })
              await streamHandler(body, {
                req,
                res,
                signal: controller.signal,
                send(event) {
                  if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
                },
                close() {
                  if (!res.writableEnded) res.end()
                },
              })
              if (!res.writableEnded) res.end()
              return
            }
            const fn = scope.methods.get(name)
            if (fn === undefined) throw new ApiError('not-found', `unknown api method: ${name}`, 404)
            const value = await fn(body, { req, res, signal: controller.signal })
            send(res, 200, { ok: true, value: value ?? null })
          } catch (error) {
            sendError(res, error)
          }
        },
      }), 'dsh-gufa-code: api')

      ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/gufa-code/asset',
        handler: async (req, res) => {
          if (!authorize(req, res, ctx.connection)) return
          if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: { code: 'method', message: 'GET required' } })
          const url = new URL(req.url ?? '/', 'http://dsh.local')
          const rest = decodeURIComponent(url.pathname.slice('/gufa-code/asset/'.length))
          try {
            await ensureFresh()
            for (const { prefix, resolver } of scope.assets) {
              if (!rest.startsWith(`${prefix}/`)) continue
              const raw = rest.slice(prefix.length + 1)
              const found = await resolver(raw)
              if (found === undefined) throw new ApiError('not-found', 'asset not found', 404)
              const info = await stat(found.path)
              if (!info.isFile()) throw new ApiError('not-found', 'asset not found', 404)
              res.writeHead(200, {
                'content-type': found.type,
                'content-length': String(info.size),
                'cache-control': found.cache ?? 'public, max-age=31536000, immutable',
                'x-content-type-options': 'nosniff',
              })
              if (req.method === 'HEAD') {
                res.end()
                return
              }
              await new Promise((resolvePipe, rejectPipe) => {
                const stream = createReadStream(found.path)
                stream.on('error', rejectPipe)
                stream.on('end', resolvePipe)
                stream.pipe(res)
              })
              return
            }
            throw new ApiError('not-found', 'asset not found', 404)
          } catch (error) {
            sendError(res, error)
          }
        },
      }), 'dsh-gufa-code: assets')

      ctx.effect(() => ctx.webServer.registerUpgrade({
        path: '/gufa-code/ws',
        handler: async (req, socket, head) => {
          if (ctx.connection.requestRejection(req) !== undefined || !localRequestAllowed(req)) {
            socket.destroy()
            return
          }
          await ensureFresh()
          const url = new URL(req.url ?? '/', 'http://dsh.local')
          const channel = url.searchParams.get('channel')
          const route = scope.sockets.find((item) => item.channel === channel)
          if (route === undefined) {
            socket.destroy()
            return
          }
          wss.handleUpgrade(req, socket, head, (connection) => {
            let cleanup
            try {
              cleanup = route.handler(connection, url, req)
            } catch (error) {
              try {
                connection.close(1011, String(error instanceof Error ? error.message : error))
              } catch {
                /* ignore */
              }
              return
            }
            if (typeof cleanup === 'function') connection.once('close', () => {
              try {
                cleanup()
              } catch {
                /* ignore */
              }
            })
          })
        },
      }), 'dsh-gufa-code: websocket')

      ctx.effect(() => () => {
        for (const dispose of scope.disposers.splice(0)) {
          try {
            dispose()
          } catch {
            /* ignore */
          }
        }
        wss.close()
      }, 'dsh-gufa-code: teardown')
    },
  }
  return router
}

/** 统一 WS 文本消息协议：JSON 对象。 */
export function wsJson(connection, value) {
  if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(value))
}

/** 解析 WS 文本消息，非法时返回 undefined。 */
export function parseWsJson(raw) {
  try {
    const value = JSON.parse(raw.toString())
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

/** 常用 MIME 表。 */
export function mimeOf(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json' || ext === '.map') return 'application/json; charset=utf-8'
  if (ext === '.ttf') return 'font/ttf'
  if (ext === '.woff' || ext === '.woff2') return 'font/woff2'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  return 'application/octet-stream'
}

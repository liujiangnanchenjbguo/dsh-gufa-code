/**
 * 终端能力：真实 PTY + WebSocket 桥 + 断线重连回放。
 *
 * 架构：
 *   - PTY 由 DSH Host 服务 `ctx.subprocess.spawnTerminal()` 分配（本地实现走 node-pty，
 *     但不直接依赖 node-pty 包）。handle 约定：output(Node stream) / write(data) /
 *     resize(cols, rows) / terminate() / done({ exitCode, signal })。
 *   - 终端实例按项目 root 分组保存在内存 Map（每组最多 8 个），WebSocket 断开不 kill PTY；
 *     只有 `terminal.close` 或插件 dispose 才终止进程。
 *   - 每个终端保留最近 2MB 输出用于回放；客户端重连时带 `since=<已收字节数>`，
 *     服务端只补发缺失部分；缓冲已滑出窗口时先发 `{type:'reset'}` 再发完整回放。
 *
 * WS 协议（/gufa-code/ws?channel=terminal&root=<enc>&id=<id>&since=<n>）：
 *   客户端 → { type:'input', data } / { type:'resize', cols, rows }
 *   服务端 → { type:'output', data, offset?, replay? } / { type:'reset' } /
 *            { type:'exit', code, signal? } / { type:'error', message }
 *   offset 是该段文本在终端输出流中的绝对 UTF-8 字节偏移，客户端据此校准 since。
 */
import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { ApiError, parseWsJson, wsJson } from './context.js'
import {
  clampInteger,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  filteredEnvironment,
  MAX_COLS,
  MAX_ROWS,
  MAX_TERMINALS_PER_ROOT,
  MIN_COLS,
  MIN_ROWS,
  ReplayBuffer,
  resolveShellPath,
  TERMINAL_GRACE_MS,
  TERMINAL_TYPE,
  terminalShellArgs,
  terminalTitleFor,
} from './terminal-pty.js'

/** 诊断日志：桌面壳的页面在 dsh-app:// 下，排查 WS 问题时把关键信息落到本机文件。 */
const DEBUG_LOG_PATH = '/tmp/gufa-code-debug.log'
function debugLog(...parts) {
  try {
    const line = `[${new Date().toISOString()}] ${parts
      .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
      .join(' ')}
`
    appendFileSync(DEBUG_LOG_PATH, line, { mode: 0o600 })
  } catch {
    /* 调试日志失败不影响功能 */
  }
}

/** 终端 WS 的短期票据：页面通过已鉴权的 HTTP API 取票，桌面壳（dsh-app://）下用它替代 Origin 围栏。 */
const WS_TICKET_TTL_MS = 120_000
/** ws 的 OPEN 常量（不 import 具体实现，避免与 context.js 的 ws 版本耦合）。 */
const WS_OPEN = 1
/** 单条 WS 积压超过该值时跳过输出帧，防止 `yes` 之类刷屏把内存打满。 */
const MAX_WS_BUFFERED_BYTES = 8 * 1024 * 1024
/** 单次键盘输入上限（字节），异常巨大的输入直接忽略。 */
const MAX_INPUT_BYTES = 1024 * 1024
/** 心跳间隔：保活本地长连接。 */
const HEARTBEAT_MS = 25_000
/** 显式关闭终端时等待 terminate 完成的上限。 */
const CLOSE_WAIT_MS = 12_000

/** 取得 subprocess 服务（缺失时给出可读错误，而不是崩溃）。 */
function requireSubprocess(env) {
  const service = env.ctx?.get?.('subprocess')
  if (service === undefined || service === null) {
    throw new ApiError('terminal-unavailable', '终端服务不可用：ctx.subprocess 尚未加载', 503)
  }
  if (typeof service.spawnTerminal !== 'function') {
    throw new ApiError('terminal-unavailable', '终端服务未实现 spawnTerminal（缺少本地 PTY 后端）', 503)
  }
  return service
}

/** 给 promise 加超时：超时后照常返回（不 reject），用于关闭路径兜底。 */
function settleWithTimeout(promise, timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    timer.unref?.()
    Promise.resolve(promise).then(finish, finish)
  })
}

/** 读取 provider 的默认 shell（不可用时返回 undefined）。 */
async function detectPreferredShell(subprocess, signal) {
  if (typeof subprocess.terminalEnvironment !== 'function') return undefined
  try {
    const info = await subprocess.terminalEnvironment(signal)
    return typeof info?.defaultShell === 'string' ? info.defaultShell : undefined
  } catch {
    return undefined
  }
}

/** 一个终端实例：PTY handle + 回放缓冲 + WS 订阅者。 */
class TerminalSession {
  #decoder = new TextDecoder('utf-8')
  #disposePromise = null

  /** @param {{ id: string, root: string, title: string, shell: string, handle: object, cols: number, rows: number }} options */
  constructor(options) {
    this.id = options.id
    this.root = options.root
    this.title = options.title
    this.shell = options.shell
    this.handle = options.handle
    this.cols = options.cols
    this.rows = options.rows
    this.createdAt = Date.now()
    this.exited = false
    this.exitCode = null
    this.exitSignal = null
    this.closed = false
    this.replay = new ReplayBuffer()
    /** @type {Set<object>} */
    this.subscribers = new Set()
    this.loggedFirstOutput = false
    this.loggedFirstInput = false
    this.onData = (chunk) => this.receive(chunk)
    this.onEnd = () => this.flushDecoder()
    this.onError = (error) => this.fail(error)
    this.handle.output?.on?.('data', this.onData)
    this.handle.output?.once?.('end', this.onEnd)
    this.handle.output?.once?.('error', this.onError)
    if (this.handle.done !== undefined) {
      this.handle.done.then(
        (outcome) => this.settle(outcome?.exitCode ?? null, outcome?.signal ?? null),
        (error) => this.fail(error),
      )
    }
  }

  /** 供 terminal.list 使用的公开描述。 */
  toInfo() {
    return {
      id: this.id,
      title: this.title,
      shell: this.shell,
      cols: this.cols,
      rows: this.rows,
      alive: !this.exited,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
    }
  }

  /** 收到一段 PTY 输出：写入回放并广播。 */
  receive(chunk) {
    if (this.closed) return
    if (this.loggedFirstOutput !== true) {
      this.loggedFirstOutput = true
      debugLog('pty-first-output', { id: this.id, shell: this.shell, bytes: chunk?.length ?? null })
    }
    let text
    try {
      text = this.#decoder.decode(chunk, { stream: true })
    } catch {
      return
    }
    if (text === '') return
    const offset = this.replay.totalBytes
    this.replay.push(text)
    this.broadcast({ type: 'output', data: text, offset })
  }

  /** PTY 流结束时把解码器里可能残留的多字节字符吐出来。 */
  flushDecoder() {
    if (this.closed) return
    let tail = ''
    try {
      tail = this.#decoder.decode()
    } catch {
      tail = ''
    }
    if (tail === '') return
    const offset = this.replay.totalBytes
    this.replay.push(tail)
    this.broadcast({ type: 'output', data: tail, offset })
  }

  /** 向 PTY 写入键盘输入。 */
  write(data) {
    if (this.loggedFirstInput !== true) {
      this.loggedFirstInput = true
      debugLog('pty-first-input', { id: this.id, len: typeof data === 'string' ? data.length : null, exited: this.exited, closed: this.closed })
    }
    if (this.exited || this.closed) return
    try {
      const result = this.handle.write(data)
      if (result !== undefined && typeof result.then === 'function') result.catch((error) => this.fail(error))
    } catch (error) {
      this.fail(error)
    }
  }

  /** 调整 PTY 尺寸。 */
  resize(cols, rows) {
    this.cols = cols
    this.rows = rows
    if (this.exited || this.closed) return
    try {
      const result = this.handle.resize(cols, rows)
      if (result !== undefined && typeof result.then === 'function') result.catch(() => {})
    } catch {
      /* 进程可能恰好退出；尺寸只是尽力而为 */
    }
  }

  /** 广播一帧给所有 WS 订阅者。 */
  broadcast(payload) {
    if (this.broadcastCount === undefined) this.broadcastCount = 0
    this.broadcastCount += 1
    if (this.broadcastCount <= 3) {
      debugLog('pty-broadcast', { id: this.id, n: this.broadcastCount, type: payload?.type, subscribers: this.subscribers.size, bytes: typeof payload?.data === 'string' ? payload.data.length : null })
    }
    for (const connection of this.subscribers) {
      try {
        if (connection.readyState !== WS_OPEN) continue
        if ((connection.bufferedAmount ?? 0) > MAX_WS_BUFFERED_BYTES) continue
        wsJson(connection, payload)
      } catch {
        /* 单个连接异常不影响其他订阅者 */
      }
    }
  }

  /**
   * 新 WS 连接接入：按 since 补发缺失输出。
   * @param {object} connection
   * @param {number|null} since 客户端已收到的绝对字节偏移；null 表示首次连接
   */
  attach(connection, since) {
    debugLog('ws-attach', { id: this.id, since, closed: this.closed, exited: this.exited, replayBytes: this.replay.totalBytes, subscribers: this.subscribers.size + 1 })
    this.subscribers.add(connection)
    if (since === null) {
      const text = this.replay.toString()
      if (text !== '') {
        wsJson(connection, { type: 'output', data: text, replay: true, offset: this.replay.retainedStart })
      }
    } else {
      const slice = this.replay.sliceFrom(since)
      if (slice.lossy) {
        // 缓冲窗口已滑走：让客户端清屏后接收完整回放，避免花屏/重复。
        wsJson(connection, { type: 'reset' })
        const text = this.replay.toString()
        if (text !== '') {
          wsJson(connection, { type: 'output', data: text, replay: true, offset: this.replay.retainedStart })
        }
      } else if (slice.text !== '') {
        wsJson(connection, { type: 'output', data: slice.text, replay: true, offset: since })
      }
    }
    if (this.exited) wsJson(connection, { type: 'exit', code: this.exitCode, signal: this.exitSignal })
  }

  detach(connection) {
    this.subscribers.delete(connection)
  }

  /** 记录退出（幂等）。 */
  settle(exitCode, signal) {
    if (this.exited) return
    this.flushDecoder()
    this.exited = true
    this.exitCode = typeof exitCode === 'number' ? exitCode : null
    this.exitSignal = typeof signal === 'string' ? signal : null
    this.broadcast({ type: 'exit', code: this.exitCode, signal: this.exitSignal })
  }

  /** PTY 传输失败：先告知客户端，再按退出处理。 */
  fail(error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!this.closed) this.broadcast({ type: 'error', message: message.slice(0, 2000) })
    this.settle(null, null)
  }

  /** 终止 PTY 并释放监听（幂等，供 terminal.close / dispose 调用）。 */
  dispose() {
    if (this.#disposePromise !== null) return this.#disposePromise
    debugLog('session-dispose', { id: this.id, exited: this.exited })
    this.closed = true
    // 主动关闭已连上的 WS：客户端据此停止重连（host 热重载 / 显式关闭时避免僵尸连接）。
    for (const connection of this.subscribers) {
      try {
        wsJson(connection, { type: 'error', message: '终端已关闭，请新建终端' })
        connection.close(1010, 'terminal disposed')
      } catch {
        /* 连接可能已在关闭中 */
      }
    }
    this.subscribers.clear()
    try {
      this.handle.output?.off?.('data', this.onData)
      this.handle.output?.off?.('end', this.onEnd)
      this.handle.output?.off?.('error', this.onError)
    } catch {
      /* 流可能已销毁 */
    }
    this.#disposePromise = (async () => {
      try {
        if (typeof this.handle.terminate === 'function') {
          await settleWithTimeout(this.handle.terminate(), CLOSE_WAIT_MS)
        }
      } catch {
        /* PTY 可能已经退出 */
      }
    })()
    return this.#disposePromise
  }
}

/**
 * 注册终端能力。由 index.js 在插件 apply 时调用。
 * @param {ReturnType<import('./context.js').createRouter>} router
 * @param {{ ctx: object, projects: import('./context.js').ProjectRegistry }} env
 */
export function register(router, env) {
  /* 注意：活动终端注册表挂在 globalThis 上，Host 模块热重载（改 host/*.js）后
     新代仍能列出/接管旧代创建的 PTY，不会再把用户正在用的终端「关掉」。 */
  const globalStore = (() => {
    const key = '__gufaTerminalStore'
    if (globalThis[key] === undefined || globalThis[key] === null) globalThis[key] = { groups: new Map(), sessions: new Set() }
    return globalThis[key]
  })()
  if (!(globalStore.groups instanceof Map)) globalStore.groups = new Map()
  if (!(globalStore.sessions instanceof Set)) globalStore.sessions = new Set()
  /** @type {Map<string, Map<string, TerminalSession>>} root → (id → session) */
  const groups = globalStore.groups
  /** @type {Set<TerminalSession>} 全部活动终端（含已退出但保留回放的） */
  const sessions = globalStore.sessions
  let disposed = false

  const groupFor = (root) => {
    let group = groups.get(root)
    if (group === undefined) {
      group = new Map()
      groups.set(root, group)
    }
    return group
  }

  const findSession = (root, id) => {
    if (typeof id !== 'string' || id === '') return undefined
    if (typeof root === 'string' && root !== '') {
      const found = groups.get(root)?.get(id)
      if (found !== undefined) return found
    }
    for (const session of sessions) {
      if (session.id === id) return session
    }
    return undefined
  }

  const removeSession = (session) => {
    sessions.delete(session)
    const group = groups.get(session.root)
    if (group !== undefined) {
      group.delete(session.id)
      if (group.size === 0) groups.delete(session.root)
    }
  }

  router.method('terminal.list', async (body) => {
    if (disposed) return { terminals: [] }
    const project = env.projects.ensure(body?.root)
    const group = groups.get(project.root)
    const list = group === undefined ? [] : [...group.values()].map((session) => session.toInfo())
    debugLog('terminal-list', { root: project.root, count: list.length })
    return { terminals: list }
  })

  router.method('terminal.create', async (body, context = {}) => {
    if (disposed) throw new ApiError('terminal-unavailable', '终端能力已卸载', 503)
    const project = env.projects.ensure(body?.root)
    const subprocess = requireSubprocess(env)
    const group = groupFor(project.root)
    if (group.size >= MAX_TERMINALS_PER_ROOT) {
      throw new ApiError('terminal-limit', `单个项目最多同时打开 ${MAX_TERMINALS_PER_ROOT} 个终端，请先关闭已有终端`, 409)
    }
    const cols = clampInteger(body?.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS)
    const rows = clampInteger(body?.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS)
    const signal = context.signal
    const preferred = await detectPreferredShell(subprocess, signal)
    const shellPath = await resolveShellPath({
      explicit: typeof body?.shell === 'string' ? body.shell : undefined,
      preferred,
      env: process.env,
    })
    let handle
    try {
      handle = await subprocess.spawnTerminal({
        argv: [shellPath, ...terminalShellArgs()],
        cwd: project.root,
        env: (() => {
          const env = filteredEnvironment(process.env)
          // zsh 的 PROMPT_SP 会在首屏打印反显 % 的 PROMPT_EOL_MARK（提示上一行没换行）；
          // 集成终端里这是纯噪音，默认清空（用户自己设置过则尊重用户配置）。
          if (env.PROMPT_EOL_MARK === undefined) env.PROMPT_EOL_MARK = ''
          return env
        })(),
        rows,
        cols,
        terminalType: TERMINAL_TYPE,
        graceMs: TERMINAL_GRACE_MS,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      debugLog('terminal-create-failed', { shellPath, message: error instanceof Error ? error.message : String(error) })
      if (signal?.aborted === true) throw new ApiError('aborted', '终端创建已取消', 499)
      const message = error instanceof Error ? error.message : String(error)
      throw new ApiError('terminal-spawn-failed', `无法启动终端（${shellPath}）：${message.slice(0, 2000)}`, 500)
    }
    let session
    try {
      session = new TerminalSession({
        id: `term-${randomUUID()}`,
        root: project.root,
        title: terminalTitleFor(shellPath),
        shell: shellPath,
        handle,
        cols,
        rows,
      })
    } catch (error) {
      // 会话对象构造失败时不要让已分配的 PTY 泄漏
      try {
        void handle.terminate()
      } catch {
        /* ignore */
      }
      throw new ApiError('terminal-spawn-failed', `终端初始化失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    group.set(session.id, session)
    sessions.add(session)
    debugLog('terminal-create', { id: session.id, shell: session.shell, pid: handle?.pid ?? null, rows, cols, root: project.root, total: sessions.size })
    return { id: session.id, title: session.title }
  })

  router.method('terminal.close', async (body) => {
    const project = (() => {
      try {
        return env.projects.ensure(body?.root)
      } catch {
        return undefined
      }
    })()
    const snapshot = project === undefined ? undefined : groups.get(project.root)?.get(String(body?.id ?? ''))
    const session = snapshot ?? findSession(body?.root, body?.id)
    if (session === undefined) throw new ApiError('not-found', '终端不存在或已关闭', 404)
    removeSession(session)
    await session.dispose()
    return { ok: true }
  })

  /* ── 自检探针：直接走 Live Host 的 subprocess.spawnTerminal，验证真实 PTY ── */
  router.method('terminal.probe', async (body) => {
    const result = { at: new Date().toISOString(), env: null, spawn: 'skipped', pid: null, firstOutput: '', afterWriteOutput: '', writeOk: false, exit: null, error: null }
    try {
      const subprocess = requireSubprocess(env)
      try {
        result.env = typeof subprocess.terminalEnvironment === 'function' ? await subprocess.terminalEnvironment() : null
      } catch (error) {
        result.env = { error: String(error) }
      }
      let cwd = process.cwd()
      if (typeof body?.root === 'string' && body.root !== '') {
        try {
          cwd = env.projects.ensure(body.root).root
        } catch {
          /* 用 process.cwd() 兜底 */
        }
      }
      const shellPath = await resolveShellPath({ preferred: undefined, env: process.env }).catch(() => '/bin/zsh')
      let handle
      try {
        handle = await subprocess.spawnTerminal({
          argv: [shellPath, ...terminalShellArgs()],
          cwd,
          env: filteredEnvironment(process.env),
          rows: 24,
          cols: 80,
          terminalType: TERMINAL_TYPE,
          graceMs: TERMINAL_GRACE_MS,
        })
        result.spawn = 'ok'
        result.pid = handle?.pid ?? null
      } catch (error) {
        result.spawn = 'failed'
        result.error = String(error)
        debugLog('terminal-probe', result)
        return result
      }
      let output = ''
      handle.output?.on?.('data', (chunk) => {
        if (output.length < 4000) output += String(chunk).slice(0, 4000)
      })
      handle.output?.once?.('error', (error) => {
        result.outputError = String(error)
      })
      await new Promise((resolve) => setTimeout(resolve, 1500))
      result.firstOutput = output.slice(0, 2000)
      try {
        await handle.write('echo GUFA_PROBE_WRITE_OK\r')
        result.writeOk = true
      } catch (error) {
        result.writeError = String(error)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
      result.afterWriteOutput = output.slice(0, 4000)
      try {
        await settleWithTimeout(handle.terminate(), 3000)
        result.exit = 'terminated'
      } catch (error) {
        result.exitError = String(error)
      }
    } catch (error) {
      result.error = String(error)
    }
    debugLog('terminal-probe', result)
    return result
  })

  const findSessionByBody = (body) => {
    const root = typeof body?.root === 'string' ? body.root : ''
    const id = typeof body?.id === 'string' ? body.id : ''
    return groups.get(root)?.get(id)
  }

  router.method('terminal.input', async (body) => {
    const session = findSessionByBody(body)
    if (session === undefined) throw new ApiError('not-found', '终端不存在或已关闭', 404)
    if (typeof body?.data === 'string' && body.data !== '') session.write(body.data)
    return { ok: true }
  })

  router.method('terminal.resize', async (body) => {
    const session = findSessionByBody(body)
    if (session === undefined) throw new ApiError('not-found', '终端不存在或已关闭', 404)
    const cols = clampInteger(body?.cols, session.cols, MIN_COLS, MAX_COLS)
    const rows = clampInteger(body?.rows, session.rows, MIN_ROWS, MAX_ROWS)
    session.resize(cols, rows)
    return { ok: true }
  })

  /* SSE 传输：桌面壳（dsh-app://）里 WS 上行可用、下行帧不达，输出改走 HTTP 流。 */
  router.stream('terminal.stream', async (body, { send, close, signal }) => {
    if (disposed) {
      send({ type: 'error', message: '终端能力已卸载' })
      close()
      return
    }
    const session = findSessionByBody(body)
    if (session === undefined) {
      send({ type: 'error', message: '终端不存在或已关闭' })
      close()
      return
    }
    const adapter = {
      readyState: WS_OPEN,
      bufferedAmount: 0,
      send(raw) {
        try {
          send(JSON.parse(String(raw)))
        } catch {
          /* ignore */
        }
      },
      close() {
        close()
      },
      ping() {},
    }
    const sinceRaw = body?.since
    const since = typeof sinceRaw === 'number' && Number.isSafeInteger(sinceRaw) && sinceRaw >= 0 ? sinceRaw : null
    debugLog('sse-attach', { id: session.id, since })
    send({ type: 'ready', id: session.id })
    session.attach(adapter, since)
    await new Promise((resolve) => {
      if (signal !== undefined && signal.aborted === true) {
        resolve()
        return
      }
      if (signal !== undefined) signal.addEventListener('abort', () => resolve(), { once: true })
    })
    session.detach(adapter)
    debugLog('sse-detach', { id: session.id })
  })

  const handleSocket = (connection, url) => {
    if (disposed) {
      wsJson(connection, { type: 'error', message: '终端能力已卸载' })
      try {
        connection.close(1011, 'terminal disposed')
      } catch {
        /* ignore */
      }
      return undefined
    }
    const root = url.searchParams.get('root') ?? ''
    const id = url.searchParams.get('id') ?? ''
    const session = groups.get(root)?.get(id)
    debugLog('ws-socket', { id, root, found: session !== undefined, sockets: sessions.size })
    if (session === undefined) {
      wsJson(connection, { type: 'error', message: '终端不存在或已关闭' })
      try {
        connection.close(1011, 'terminal not found')
      } catch {
        /* ignore */
      }
      return undefined
    }
    const sinceRaw = url.searchParams.get('since')
    const parsedSince = sinceRaw === null ? Number.NaN : Number.parseInt(sinceRaw, 10)
    try {
      wsJson(connection, { type: 'hello', id: session.id })
      debugLog('ws-hello', { id: session.id, readyState: connection.readyState })
    } catch (error) {
      debugLog('ws-hello-error', String(error))
    }
    session.attach(connection, Number.isSafeInteger(parsedSince) && parsedSince >= 0 ? parsedSince : null)
    const hello2Timer = setTimeout(() => {
      try {
        wsJson(connection, { type: 'hello2' })
        debugLog('ws-hello2', { id: session.id, readyState: connection.readyState, bufferedAmount: connection.bufferedAmount })
      } catch (error) {
        debugLog('ws-hello2-error', String(error))
      }
    }, 800)

    const heartbeat = setInterval(() => {
      try {
        if (connection.readyState === WS_OPEN) connection.ping()
      } catch {
        /* 连接可能正在关闭 */
      }
    }, HEARTBEAT_MS)
    heartbeat.unref?.()

    let detached = false
    const detach = () => {
      if (detached) return
      detached = true
      clearInterval(heartbeat)
      clearTimeout(hello2Timer)
      session.detach(connection)
    }

    let receivedMessages = 0
    const onMessage = (raw) => {
      receivedMessages += 1
      if (receivedMessages <= 3) debugLog('ws-message', { id: session.id, n: receivedMessages, raw: String(raw).slice(0, 160) })
      const message = parseWsJson(raw)
      if (message === undefined) return
      if (message.type === 'input') {
        if (typeof message.data !== 'string' || message.data === '') return
        if (Buffer.byteLength(message.data, 'utf8') > MAX_INPUT_BYTES) return
        session.write(message.data)
      } else if (message.type === 'resize') {
        const cols = clampInteger(message.cols, session.cols, MIN_COLS, MAX_COLS)
        const rows = clampInteger(message.rows, session.rows, MIN_ROWS, MAX_ROWS)
        if (cols !== session.cols || rows !== session.rows) session.resize(cols, rows)
      } else if (message.type === 'ping') {
        debugLog('ws-ping', { id: session.id })
        wsJson(connection, { type: 'pong' })
      }
    }
    const onClose = () => detach()
    connection.on('message', onMessage)
    connection.once('close', onClose)
    connection.on('error', () => {
      /* 关闭事件随后到达 */
    })
    return () => detach()
  }

  router.ws('terminal', handleSocket)

  /* ── 桌面壳（dsh-app://）专用的终端 WS 通道 ─────────────────────────────
   * 桌面壳的页面源是 dsh-app://app，直接连 ws://127.0.0.1:PORT 时 Host/Origin 围栏
   * 会拒绝（Origin 不是 http 同源）。这里注册一条独立升级路由，用「已鉴权 HTTP API
   * 签发的短期票据」认证；没有票据时仍回退到 Harness 的标准鉴权。 */
  const tickets = new Map()
  const issueTicket = () => {
    const now = Date.now()
    for (const [key, expiry] of tickets) if (expiry <= now) tickets.delete(key)
    const ticket = randomUUID()
    tickets.set(ticket, now + WS_TICKET_TTL_MS)
    return ticket
  }
  const ticketValid = (ticket) => {
    if (typeof ticket !== 'string' || ticket === '') return false
    const expiry = tickets.get(ticket)
    return expiry !== undefined && expiry > Date.now()
  }
  router.method('terminal.wsTicket', async () => ({ ticket: issueTicket() }))

  const webServer = env.ctx === undefined || env.ctx === null ? undefined : env.ctx.webServer

  /* 直连真实 Host 的 SSE 通道（桌面壳 dsh-app:// 页面用；票据鉴权 + CORS）。 */
  if (webServer !== undefined && webServer !== null && typeof webServer.register === 'function') {
    let disposeSseRoute = null
    let sseRetryTimer = null
    const sseHandler = async (req, res) => {
      try {
        res.setHeader('access-control-allow-origin', '*')
        res.setHeader('access-control-allow-methods', 'GET, OPTIONS')
        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }
        if (req.method !== 'GET') {
          res.writeHead(405)
          res.end()
          return
        }
        let url
        try {
          url = new URL(req.url ?? '/', 'http://dsh.local')
        } catch {
          res.writeHead(400)
          res.end()
          return
        }
        if (!ticketValid(url.searchParams.get('ticket') ?? '')) {
          debugLog('sse2-reject', { reason: 'ticket', origin: req.headers.origin, host: req.headers.host })
          res.writeHead(401, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
          res.end(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'bad ticket' } }))
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
          'access-control-allow-origin': '*',
        })
        const writeEvent = (payload) => {
          if (res.writableEnded) return
          try {
            res.write(`data: ${JSON.stringify(payload)}\n\n`)
          } catch {
            /* 连接可能已断 */
          }
        }
        res.write(': connected\n\n')
        if (disposed) {
          writeEvent({ type: 'error', message: '终端能力已卸载' })
          res.end()
          return
        }
        const root = url.searchParams.get('root') ?? ''
        const id = url.searchParams.get('id') ?? ''
        const session = groups.get(root)?.get(id)
        if (session === undefined) {
          writeEvent({ type: 'error', message: '终端不存在或已关闭' })
          res.end()
          return
        }
        const adapter = {
          readyState: WS_OPEN,
          bufferedAmount: 0,
          send(raw) {
            try {
              writeEvent(JSON.parse(String(raw)))
            } catch {
              /* ignore */
            }
          },
          close() {
            try {
              res.end()
            } catch {
              /* ignore */
            }
          },
          ping() {},
        }
        writeEvent({ type: 'ready', id: session.id })
        const sinceRaw = url.searchParams.get('since')
        const parsedSince = sinceRaw === null ? Number.NaN : Number.parseInt(sinceRaw, 10)
        debugLog('sse2-attach', { id: session.id, origin: req.headers.origin })
        session.attach(adapter, Number.isSafeInteger(parsedSince) && parsedSince >= 0 ? parsedSince : null)
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) {
            try {
              res.write(': ping\n\n')
            } catch {
              /* ignore */
            }
          }
        }, 15000)
        heartbeat.unref?.()
        await new Promise((resolve) => {
          res.once('close', resolve)
          res.once('error', resolve)
        })
        clearInterval(heartbeat)
        session.detach(adapter)
        debugLog('sse2-detach', { id: session.id })
      } catch (error) {
        debugLog('sse2-error', String(error))
        try {
          if (!res.writableEnded) res.end()
        } catch {
          /* ignore */
        }
      }
    }
    const installSse = (attempt = 0) => {
      if (disposed) return
      try {
        disposeSseRoute = webServer.register({ kind: 'exact', path: '/gufa-code/terminal-stream', handler: sseHandler })
        debugLog('sse2-route-installed')
      } catch (error) {
        if (attempt < 30) {
          sseRetryTimer = setTimeout(() => installSse(attempt + 1), 50)
          sseRetryTimer.unref?.()
        } else {
          debugLog('sse2-route-failed', String(error))
        }
      }
    }
    installSse()
    router.onDispose(() => {
      if (sseRetryTimer !== null) clearTimeout(sseRetryTimer)
      if (typeof disposeSseRoute === 'function') {
        try {
          disposeSseRoute()
        } catch {
          /* ignore */
        }
      }
    })
  }

  if (webServer !== undefined && webServer !== null && typeof webServer.registerUpgrade === 'function') {
    let wss = null
    let disposeRoute = null
    let retryTimer = null
    const installUpgrade = (attempt = 0) => {
      if (disposed) return
      try {
        wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
        disposeRoute = webServer.registerUpgrade({
          path: '/gufa-code/ws-terminal',
          handler: (req, socket, head) => {
            if (disposed) {
              socket.destroy()
              return
            }
            let url
            try {
              url = new URL(req.url ?? '/', 'http://dsh.local')
            } catch {
              socket.destroy()
              return
            }
            const ticket = url.searchParams.get('ticket') ?? ''
            let authorized = ticketValid(ticket)
            if (!authorized) {
              try {
                authorized = env.ctx.connection.requestRejection(req) === undefined
              } catch {
                authorized = false
              }
              debugLog('terminal-ws', 'ticket-miss', 'cookie-auth=', authorized, 'host=', req.headers.host, 'origin=', req.headers.origin, 'sfs=', req.headers['sec-fetch-site'])
            }
            if (!authorized) {
              socket.destroy()
              return
            }
            try {
              wss.handleUpgrade(req, socket, head, (connection) => {
                try {
                  handleSocket(connection, url)
                } catch (error) {
                  debugLog('terminal-ws', 'handler-error', String(error))
                  try {
                    connection.close(1011, 'terminal failed')
                  } catch {
                    /* ignore */
                  }
                }
              })
            } catch (error) {
              debugLog('terminal-ws', 'upgrade-error', String(error))
              socket.destroy()
            }
          },
        })
        debugLog('terminal-ws', 'route-installed')
      } catch (error) {
        // 上一代作用域的升级路由可能还没释放：稍后重试（最多 ~1.5s）
        if (attempt < 30) {
          retryTimer = setTimeout(() => installUpgrade(attempt + 1), 50)
          retryTimer.unref?.()
        } else {
          debugLog('terminal-ws', 'route-install-failed', String(error))
        }
      }
    }
    installUpgrade()
    router.onDispose(() => {
      disposed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      if (typeof disposeRoute === 'function') {
        try {
          disposeRoute()
        } catch {
          /* ignore */
        }
      }
      if (wss !== null) {
        try {
          wss.close()
        } catch {
          /* ignore */
        }
      }
    })
  }

  router.onDispose(() => {
    disposed = true
    for (const session of [...sessions]) {
      try {
        void session.dispose()
      } catch {
        /* ignore */
      }
    }
    sessions.clear()
    groups.clear()
  })
}

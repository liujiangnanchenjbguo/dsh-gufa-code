/**
 * 开发/诊断信息：供客户端在启动时探测「Host 半是否为最新代码」。
 * 旧版本 Host（没有本方法）会让 api('dev.version') 返回 not-found，客户端据此提示重启 Harness。
 */
import { appendFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from './context.js'

const DEBUG_LOG_PATH = '/tmp/gufa-code-debug.log'
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/* 悬浮层子进程放在 globalThis：host 模块热重载后仍能持有同一个句柄 */
const floatState = globalThis.__gufaFloatState ?? (globalThis.__gufaFloatState = { child: null, startedAt: 0 })

/** 查找当前平台编译好的悬浮层 helper（P0 只支持 macOS）。 */
function floatBinaryPath() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const candidates = [`gufa-float-macos-${arch}`, 'gufa-float-macos-arm64', 'gufa-float-macos-x64']
  for (const name of candidates) {
    const full = join(PLUGIN_ROOT, 'desktop', 'float', 'bin', name)
    if (existsSync(full)) return full
  }
  return null
}

function floatRunning() {
  return floatState.child !== null && floatState.child.exitCode === null && floatState.child.signalCode === null
}

/** 追加一条客户端诊断日志（排查桌面壳/终端连接问题用）。 */
export function debugLog(message) {
  try {
    appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] client: ${String(message).slice(0, 4000)}\n`, { mode: 0o600 })
  } catch {
    /* 调试日志失败不影响功能 */
  }
}

export function register(router, env) {
  const startedAt = new Date().toISOString()
  const ctx = env?.ctx ?? router.ctx

  /* ── 桌面悬浮层（P0，macOS） ─────────────────────────────────────── */
  router.method('float.status', async () => ({
    supported: process.platform === 'darwin' && floatBinaryPath() !== null,
    platform: process.platform,
    running: floatRunning(),
    pid: floatRunning() ? floatState.child.pid : null,
    binary: floatBinaryPath(),
  }))

  router.method('float.start', async () => {
    if (process.platform !== 'darwin') throw new ApiError('unsupported', '桌面悬浮层目前只支持 macOS', 400)
    const binary = floatBinaryPath()
    if (binary === null) throw new ApiError('missing-helper', '悬浮层程序未构建，请先运行 scripts/build-float-macos.sh', 500)
    if (floatRunning()) return { running: true, pid: floatState.child.pid }
    let webServer
    let connection
    try {
      webServer = ctx.get('webServer')
      connection = ctx.get('connection')
    } catch {
      /* ignore */
    }
    if (webServer === undefined || webServer === null || connection === undefined || connection === null || typeof connection.authenticatedUrl !== 'function') {
      throw new ApiError('unavailable', '当前 Host 不提供 Web 服务地址，无法启动悬浮层', 500)
    }
    const base = `${webServer.protocol}//127.0.0.1:${String(webServer.port)}`
    const authUrl = connection.authenticatedUrl(`${base}/`)
    const payload = JSON.stringify({ authUrl, appUrl: `${base}/` })
    let child
    try {
      child = spawn(binary, [payload], { detached: true, stdio: 'ignore' })
    } catch (error) {
      throw new ApiError('spawn-failed', `悬浮层启动失败：${String(error && error.message || error)}`, 500)
    }
    child.unref()
    floatState.child = child
    floatState.startedAt = Date.now()
    child.once('exit', () => {
      if (floatState.child === child) floatState.child = null
    })
    return { running: true, pid: child.pid ?? null }
  })

  router.method('float.stop', async () => {
    if (floatRunning()) {
      try {
        floatState.child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    floatState.child = null
    return { running: false }
  })

  router.method('dev.log', async (body) => {
    const message = body !== null && typeof body === 'object' && typeof body.message === 'string' ? body.message : ''
    if (message !== '') debugLog(message)
    return { ok: true }
  })
  router.method('dev.version', async () => ({
    name: 'dsh-gufa-code',
    version: '1.0.0',
    host: 'v2-terminal-ws',
    node: process.version,
    platform: process.platform,
    pid: process.pid,
    startedAt,
  }))
}

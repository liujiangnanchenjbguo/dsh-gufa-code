/**
 * 开发/诊断信息：供客户端在启动时探测「Host 半是否为最新代码」。
 * 旧版本 Host（没有本方法）会让 api('dev.version') 返回 not-found，客户端据此提示重启 Harness。
 */
import { appendFileSync, existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from './context.js'

const DEBUG_LOG_PATH = '/tmp/gufa-code-debug.log'
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/* 悬浮层子进程放在 globalThis：host 模块热重载后仍能持有同一个句柄 */
const floatState = globalThis.__gufaFloatState ?? (globalThis.__gufaFloatState = { child: null, startedAt: 0 })
const runFile = promisify(execFile)

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

  /* ── 桌面悬浮层 / 摸鱼模式（macOS） ────────────────────────────────
   * 通过 .app bundle 启动 helper：TCC（屏幕录制）按 bundle 身份授权，
   * 用户在「系统设置 → 隐私与安全性 → 屏幕录制」里添加「古法编程悬浮层.app」即可。
   */
  const appBundlePath = () => {
    const candidates = [
      join(PLUGIN_ROOT, 'desktop', 'float', '古法编程悬浮层.app'),
      join(PLUGIN_ROOT, 'desktop', 'float', 'GufaFloat.app'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }
  const floatProcessPattern = '古法编程悬浮层.app/Contents/MacOS/gufa-float'

  const listFloatPids = async () => {
    try {
      const { stdout } = await runFile('pgrep', ['-f', floatProcessPattern], { timeout: 3000 })
      return String(stdout ?? '').split('\n').map((line) => Number(line.trim())).filter((pid) => Number.isFinite(pid) && pid > 0)
    } catch {
      return []
    }
  }
  const floatRunningAsync = async () => (await listFloatPids()).length > 0

  const openApp = (args) => new Promise((resolve, reject) => {
    const app = appBundlePath()
    if (app === null) {
      reject(new ApiError('missing-helper', '悬浮层 App 未构建，请先运行 scripts/build-float-macos.sh', 500))
      return
    }
    const child = spawn('open', ['-n', app, '--args', ...args], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new ApiError('open-failed', `悬浮层启动失败（open exit ${code}）`, 500))
    })
  })

  const killFloat = async () => {
    const pids = await listFloatPids()
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* ignore */
      }
    }
    if (pids.length > 0) await new Promise((resolve) => setTimeout(resolve, 400))
    floatState.child = null
  }

  router.method('float.status', async () => {
    const running = await floatRunningAsync()
    return {
      supported: process.platform === 'darwin' && appBundlePath() !== null,
      platform: process.platform,
      running,
      pid: running ? (await listFloatPids())[0] ?? null : null,
      app: appBundlePath(),
    }
  })

  /** 在 Finder 里显示悬浮层 App，便于用户在「屏幕录制」里手动添加。 */
  router.method('float.revealHelper', async () => {
    const app = appBundlePath()
    if (app === null) throw new ApiError('missing-helper', '悬浮层 App 未构建', 500)
    try {
      spawn('open', ['-R', app], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true, app }
    } catch {
      return { ok: false, app }
    }
  })

  /** 列出可吸附的 App 窗口（通过 .app 身份启动 helper，输出到临时文件）。 */
  router.method('float.windows', async () => {
    if (process.platform !== 'darwin') throw new ApiError('unsupported', '摸鱼模式目前只支持 macOS', 400)
    if (appBundlePath() === null) throw new ApiError('missing-helper', '悬浮层 App 未构建，请先运行 scripts/build-float-macos.sh', 500)
    const binary = floatBinaryPath()
    const outPath = join(tmpdir(), `gufa-float-windows-${process.pid}-${Date.now()}.json`)
    const readResult = async () => {
      const deadline = Date.now() + 10_000
      let raw = ''
      while (Date.now() < deadline) {
        try {
          raw = await readFile(outPath, 'utf8')
          if (raw.trim() !== '') break
        } catch {
          /* 还没写出来 */
        }
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      try {
        return JSON.parse(raw.trim())
      } catch {
        return null
      }
    }
    try {
      /* 路线 A：直接从 Host 进程 spawn（responsible app = DeepSeek Harness，可继承 DSH 的屏幕录制授权） */
      if (binary !== null) {
        try {
          await runFile(binary, ['--list-windows', '--out', outPath], { timeout: 12_000 })
        } catch {
          /* 走读取兜底 */
        }
        const parsed = await readResult()
        debugLog(`float-windows route=direct ok=${String(parsed !== null && parsed.ok === true)} permission=${String(parsed !== null ? parsed.permission : 'none')}`)
        if (parsed !== null && parsed.ok === true) return parsed
        try { await rm(outPath, { force: true }) } catch { /* ignore */ }
      }
      /* 路线 B：通过 .app 身份启动（用户给「古法编程悬浮层.app」单独授权） */
      await openApp(['--list-windows', '--out', outPath])
      const parsed = await readResult()
      debugLog(`float-windows route=app ok=${String(parsed !== null && parsed.ok === true)} permission=${String(parsed !== null ? parsed.permission : 'none')}`)
      if (parsed === null) throw new ApiError('list-failed', '读取窗口列表失败（helper 无输出）', 500)
      return parsed
    } finally {
      try {
        await rm(outPath, { force: true })
      } catch {
        /* ignore */
      }
    }
  })

  router.method('float.openPrivacy', async () => {
    if (process.platform !== 'darwin') return { ok: false }
    try {
      spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  router.method('float.start', async (body) => {
    if (process.platform !== 'darwin') throw new ApiError('unsupported', '摸鱼模式目前只支持 macOS', 400)
    if (appBundlePath() === null) throw new ApiError('missing-helper', '悬浮层 App 未构建，请先运行 scripts/build-float-macos.sh', 500)
    const follow = body !== null && typeof body === 'object' && body.follow !== null && typeof body.follow === 'object'
      ? {
        pid: Number(body.follow.pid) || 0,
        bundleId: typeof body.follow.bundleId === 'string' ? body.follow.bundleId : '',
        title: typeof body.follow.title === 'string' ? body.follow.title : '',
      }
      : null
    if (follow !== null && follow.pid > 0) {
      await killFloat()
    } else if (await floatRunningAsync()) {
      return { running: true, pid: (await listFloatPids())[0] ?? null }
    }
    const webServer = ctx.get('webServer')
    const connection = ctx.get('connection')
    if (webServer === undefined || webServer === null || connection === undefined || connection === null || typeof connection.authenticatedUrl !== 'function') {
      throw new ApiError('unavailable', '当前 Host 不提供 Web 服务地址，无法启动悬浮层', 500)
    }
    const base = `${webServer.protocol}//127.0.0.1:${String(webServer.port)}`
    const authUrl = connection.authenticatedUrl(`${base}/`)
    const payload = JSON.stringify({ authUrl, appUrl: `${base}/`, follow: follow !== null && follow.pid > 0 ? follow : undefined })
    await openApp([payload])
    await new Promise((resolve) => setTimeout(resolve, 300))
    const pids = await listFloatPids()
    floatState.startedAt = Date.now()
    return { running: pids.length > 0, pid: pids[0] ?? null }
  })

  router.method('float.stop', async () => {
    await killFloat()
    return { running: false }
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

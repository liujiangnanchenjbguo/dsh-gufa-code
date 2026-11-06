/**
 * 开发/诊断信息：供客户端在启动时探测「Host 半是否为最新代码」。
 * 旧版本 Host（没有本方法）会让 api('dev.version') 返回 not-found，客户端据此提示重启 Harness。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from './context.js'

const DEBUG_LOG_PATH = '/tmp/gufa-code-debug.log'
const FLOAT_PREFS_PATH = join(homedir(), '.dsh', 'gufa-float-prefs.json')
const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'dev'
  } catch {
    return 'dev'
  }
})()
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/* 悬浮层子进程放在 globalThis：host 模块热重载后仍能持有同一个句柄 */
const floatState = globalThis.__gufaFloatState ?? (globalThis.__gufaFloatState = { child: null, startedAt: 0 })
const runFile = promisify(execFile)

/** 查找当前平台编译好的悬浮层 helper。 */
function floatBinaryPath() {
  const root = join(PLUGIN_ROOT, 'desktop', 'float', 'bin')
  let candidates = []
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    candidates = [
      join(root, `gufa-float-macos-${arch}`),
      join(root, 'gufa-float-macos-universal'),
      join(root, 'gufa-float-macos-arm64'),
      join(root, 'gufa-float-macos-x64'),
    ]
  } else if (process.platform === 'win32') {
    candidates = [
      join(root, 'win-x64', 'gufa-float-win.exe'),
      join(root, 'gufa-float-win.exe'),
    ]
  } else if (process.platform === 'linux') {
    candidates = [
      join(root, 'linux-x64', 'gufa-float-linux'),
      join(root, 'linux-x64', 'gufa-float-linux-x64'),
      join(root, 'gufa-float-linux'),
    ]
  }
  for (const full of candidates) {
    if (existsSync(full)) return full
  }
  return null
}

/** 当前平台是否支持摸鱼悬浮层（helper 未构建时返回原因）。 */
function floatSupportStatus() {
  const binary = floatBinaryPath()
  if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') {
    return { supported: false, reason: 'unsupported-platform', platform: process.platform, binary: null }
  }
  if (binary === null) {
    return {
      supported: false,
      reason: 'missing-helper',
      platform: process.platform,
      binary: null,
      hint: process.platform === 'darwin'
        ? '运行 ./scripts/build-float-macos.sh 构建悬浮层'
        : (process.platform === 'win32' ? '运行 ./scripts/build-float-win.sh 或下载 Release 中的 Windows 产物' : '运行 ./scripts/build-float-linux.sh'),
    }
  }
  return { supported: true, reason: '', platform: process.platform, binary }
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



  /* ── 桌面悬浮层 / 摸鱼模式（跨平台：macOS / Windows / Linux） ─────────
   * helper 协议见 desktop/float/PLATFORM-PROTOCOL.md：
   *   - Host 用 spawn(binary, [payloadJson]) 启动 helper；
   *   - 退出统一走 controlPath 控制文件（helper 自己恢复 DSH 主窗口后退出）；
   *   - float.windows 统一返回 { ok, accessibility, apps:[{pid,owner,title,bundleId,windowNumber,icon}] }。
   */
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'
  const isLinux = process.platform === 'linux'
  const appBundlePath = () => {
    if (!isMac) return null
    const candidates = [
      join(PLUGIN_ROOT, 'desktop', 'float', '古法编程悬浮层.app'),
      join(PLUGIN_ROOT, 'desktop', 'float', 'GufaFloat.app'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }
  const floatProcessPatterns = isMac
    ? ['gufa-float-macos-', '古法编程悬浮层.app/Contents/MacOS/gufa-float']
    : (isWin ? ['gufa-float-win'] : ['gufa-float-linux'])

  /** 列出本插件的 helper 进程（优先用自己 spawn 的 child，再加系统进程扫描兜底）。 */
  const listFloatPids = async () => {
    const pids = new Set()
    const tracked = floatState.child !== null && floatState.child.exitCode === null ? floatState.child.pid : null
    if (Number.isFinite(tracked) && tracked > 0) pids.add(tracked)
    if (isMac || isLinux) {
      for (const pattern of floatProcessPatterns) {
        try {
          const { stdout } = await runFile('pgrep', ['-f', pattern], { timeout: 3000 })
          for (const line of String(stdout ?? '').split('\n')) {
            const pid = Number(line.trim())
            if (Number.isFinite(pid) && pid > 0) pids.add(pid)
          }
        } catch {
          /* 没匹配到 */
        }
      }
    } else if (isWin) {
      const alive = []
      for (const pid of pids) {
        try { process.kill(pid, 0); alive.push(pid) } catch { /* 已退出 */ }
      }
      pids.clear()
      for (const pid of alive) pids.add(pid)
      try {
        const { stdout } = await runFile('tasklist', ['/FI', 'IMAGENAME eq gufa-float-win.exe', '/FO', 'CSV', '/NH'], { timeout: 5000 })
        for (const line of String(stdout ?? '').split('\n')) {
          const match = /^"([^"]+)","(\d+)"/.exec(line.trim())
          if (match !== null) {
            const pid = Number(match[2])
            if (Number.isFinite(pid) && pid > 0) pids.add(pid)
          }
        }
      } catch {
        /* tasklist 不可用：只用 child pid */
      }
    }
    return [...pids]
  }
  const floatRunningAsync = async () => (await listFloatPids()).length > 0

  /** 强制退出/异常兜底：把 DSH 主窗口恢复显示并前置（正常情况下 helper 自己会恢复）。 */
  const restoreDshWindowFallback = async () => {
    try {
      if (isMac) {
        spawn('/usr/bin/osascript', ['-e', 'tell application "System Events" to set visible of process "DeepSeek Harness" to true'], { detached: true, stdio: 'ignore' }).unref()
        spawn('open', ['-b', 'com.deepseek.dsh'], { detached: true, stdio: 'ignore' }).unref()
      } else if (isWin) {
        const ps = [
          "$sig = '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
          '$t = Add-Type -MemberDefinition $sig -Name Win32F -Namespace GufaF -PassThru',
          "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -like '*DeepSeek*' } | ForEach-Object { [void]$t::ShowWindow($_.MainWindowHandle, 5); [void]$t::SetForegroundWindow($_.MainWindowHandle) }",
        ].join('\n')
        spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { detached: true, stdio: 'ignore' }).unref()
      } else if (isLinux) {
        for (const [command, args] of [['wmctrl', ['-a', 'DeepSeek Harness']], ['xdotool', ['search', '--name', 'DeepSeek Harness', 'windowactivate']]]) {
          try {
            spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  const killFloat = async () => {
    const pids = await listFloatPids()
    if (pids.length === 0) {
      floatState.child = null
      floatState.controlPath = null
      return
    }
    /* 优先用控制文件让 helper 优雅退出（它会先恢复 DSH 主窗口） */
    if (typeof floatState.controlPath === 'string' && floatState.controlPath !== '') {
      try {
        writeFileSync(floatState.controlPath, 'exit')
      } catch {
        /* ignore */
      }
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        if ((await listFloatPids()).length === 0) break
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }
    /* 兜底：还在就强杀；被强杀时用平台命令把 DSH 主窗口恢复显示 */
    let forced = false
    for (const pid of await listFloatPids()) {
      forced = true
      try {
        if (isWin) {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { detached: true, stdio: 'ignore' }).unref()
        } else {
          process.kill(pid, 'SIGTERM')
        }
      } catch {
        /* ignore */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    for (const pid of await listFloatPids()) {
      forced = true
      try {
        if (isWin) {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { detached: true, stdio: 'ignore' }).unref()
        } else {
          process.kill(pid, 'SIGKILL')
        }
      } catch {
        /* ignore */
      }
    }
    if (forced) await restoreDshWindowFallback()
    try {
      if (typeof floatState.controlPath === 'string' && floatState.controlPath !== '') await rm(floatState.controlPath, { force: true })
    } catch {
      /* ignore */
    }
    floatState.controlPath = null
    floatState.child = null
  }

  /** macOS：用 .app 身份启动 helper（列表接口的兜底路线，能继承/单独授权辅助功能）。 */
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

  /** Windows：PowerShell 枚举有主窗口的进程。 */
  const listFloatWindowsWin = async () => {
    const script = [
      '$rows = @();',
      "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | ForEach-Object { $rows += [pscustomobject]@{ pid = $_.Id; owner = $_.ProcessName; title = $_.MainWindowTitle; bundleId = ''; windowNumber = [int64]$_.MainWindowHandle; frontmost = 0 } };",
      "ConvertTo-Json -InputObject ([pscustomobject]@{ ok = $true; accessibility = $true; apps = @($rows) }) -Compress -Depth 5",
    ].join('\n')
    const { stdout } = await runFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 })
    let parsed = null
    try { parsed = JSON.parse(String(stdout ?? '').trim()) } catch { parsed = null }
    if (parsed === null || parsed.ok !== true) throw new ApiError('list-failed', '读取 Windows 窗口列表失败', 500)
    let apps = parsed.apps
    if (!Array.isArray(apps)) apps = apps === null || apps === undefined ? [] : [apps]
    apps = apps.filter((row) => row !== null && typeof row === 'object' && Number(row.pid) > 0 && typeof row.title === 'string' && row.title !== '')
    return { ok: true, accessibility: true, apps }
  }

  /** Linux(X11)：wmctrl 枚举窗口（没装 wmctrl 时给出安装提示）。 */
  const listFloatWindowsLinux = async () => {
    let stdout = ''
    try {
      ({ stdout } = await runFile('wmctrl', ['-lp'], { timeout: 6000 }))
    } catch {
      throw new ApiError('missing-tool', 'Linux 下需要 wmctrl 才能列出窗口：sudo apt install wmctrl', 500)
    }
    const apps = []
    const seen = new Set()
    for (const line of String(stdout ?? '').split('\n')) {
      const match = /^0x[0-9a-fA-F]+\s+\d+\s+(\d+)\s+(.*)$/.exec(line.trim())
      if (match === null) continue
      const pid = Number(match[1])
      const title = match[2].trim()
      if (!Number.isFinite(pid) || pid <= 0 || title === '') continue
      const key = `${pid}:${title}`
      if (seen.has(key)) continue
      seen.add(key)
      let owner = String(pid)
      try {
        owner = readFileSync(`/proc/${pid}/comm`, 'utf8').trim() || owner
      } catch {
        /* ignore */
      }
      apps.push({ pid, owner, title, bundleId: owner, windowNumber: apps.length + 1, frontmost: 0 })
    }
    return { ok: true, accessibility: true, apps }
  }

  router.method('float.status', async () => {
    const support = floatSupportStatus()
    const running = await floatRunningAsync()
    return {
      supported: support.supported,
      platform: process.platform,
      reason: support.reason,
      hint: support.hint,
      running,
      pid: running ? (await listFloatPids())[0] ?? null : null,
      app: isMac ? appBundlePath() : support.binary,
    }
  })

  /** 打开 helper 所在位置（macOS 在 Finder 显示 App；Windows 在资源管理器选中 exe；Linux 打开目录）。 */
  router.method('float.revealHelper', async () => {
    const support = floatSupportStatus()
    if (isMac) {
      const app = appBundlePath()
      if (app === null) throw new ApiError('missing-helper', '悬浮层 App 未构建', 500)
      try {
        spawn('open', ['-R', app], { detached: true, stdio: 'ignore' }).unref()
        return { ok: true, app }
      } catch {
        return { ok: false, app }
      }
    }
    if (!support.supported) throw new ApiError('missing-helper', support.hint ?? '悬浮层程序未构建', 500)
    try {
      if (isWin) spawn('explorer', ['/select,', support.binary], { detached: true, stdio: 'ignore' }).unref()
      else spawn('xdg-open', [dirname(support.binary)], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true, app: support.binary }
    } catch {
      return { ok: false, app: support.binary }
    }
  })

  /** 列出可吸附的 App 窗口（三平台统一返回 {ok, accessibility, apps}）。 */
  router.method('float.windows', async () => {
    const support = floatSupportStatus()
    if (!support.supported) {
      const message = support.reason === 'unsupported-platform'
        ? '摸鱼模式暂不支持当前平台'
        : (support.hint ?? '悬浮层程序未构建')
      throw new ApiError('unsupported', message, 400)
    }
    if (!isMac) {
      const list = isWin ? await listFloatWindowsWin() : await listFloatWindowsLinux()
      debugLog(`float-windows platform=${process.platform} apps=${list.apps.length}`)
      return list
    }
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
    if (!isMac) return { ok: false }
    try {
      spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  router.method('float.start', async (body) => {
    const support = floatSupportStatus()
    if (!support.supported) {
      const message = support.reason === 'unsupported-platform'
        ? '摸鱼模式暂不支持当前平台'
        : (support.hint ?? '悬浮层程序未构建')
      throw new ApiError('unsupported', message, 400)
    }
    if (isMac && appBundlePath() === null) throw new ApiError('missing-helper', '悬浮层 App 未构建，请先运行 scripts/build-float-macos.sh', 500)
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
    const state = body !== null && typeof body === 'object' && body.state !== null && typeof body.state === 'object' ? body.state : null
    try {
      debugLog(`float-start-state platform=${process.platform} project=${String(state !== null && state.projectRoot) } tabs=${state !== null && Array.isArray(state.tabs) ? state.tabs.length : 'none'} active=${state !== null && typeof state.activePath === 'string' ? state.activePath : 'none'} ui=${state !== null && state.ui !== null && typeof state.ui === 'object' ? JSON.stringify(state.ui) : 'none'} session=${state !== null && typeof state.sessionId === 'string' ? state.sessionId : 'none'}`)
    } catch {
      /* ignore */
    }
    const controlPath = join(tmpdir(), `gufa-float-exit-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    try { await rm(controlPath, { force: true }) } catch { /* ignore */ }
    const prefs = readFloatPrefs()
    const alphaPref = Number(prefs.alpha)
    const payload = JSON.stringify({
      authUrl,
      appUrl: `${base}/`,
      follow: follow !== null && follow.pid > 0 ? follow : undefined,
      state: state ?? undefined,
      alpha: Number.isFinite(alphaPref) && alphaPref >= 20 && alphaPref <= 100 ? Math.round(alphaPref) : undefined,
      build: PLUGIN_VERSION,
      ownerPid: process.ppid,
      controlPath,
    })
    floatState.controlPath = controlPath
    const binary = floatBinaryPath()
    if (binary === null) throw new ApiError('missing-helper', '悬浮层程序未构建', 500)
    const child = spawn(binary, [payload], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    floatState.child = child
    floatState.startedAt = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const pids = await listFloatPids()
    return { running: pids.length > 0 || child.exitCode === null, pid: child.pid ?? pids[0] ?? null }
  })

  /** 悬浮层退出摸鱼：把当前状态（项目/标签页/UI/会话）暂存给主窗口。 */
  router.method('float.saveExitState', async (body) => {
    const state = body !== null && typeof body === 'object' && body.state !== null && typeof body.state === 'object' ? body.state : null
    if (state === null) throw badRequest('state is required')
    floatState.exitState = state
    floatState.exitStateAt = Date.now()
    return { ok: true }
  })

  /** 主窗口取回退出摸鱼时的状态（取一次即清空，10 分钟内有效）。 */
  router.method('float.consumeExitState', async () => {
    const state = floatState.exitState ?? null
    const at = floatState.exitStateAt ?? 0
    floatState.exitState = null
    floatState.exitStateAt = 0
    if (state === null || Date.now() - at > 10 * 60 * 1000) return { state: null }
    return { state }
  })

  /* 悬浮层偏好（摸鱼界面透明度等）：存在 ~/.dsh/gufa-float-prefs.json，摸鱼窗口每次新建时沿用 */
  const readFloatPrefs = () => {
    try {
      const raw = readFileSync(FLOAT_PREFS_PATH, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object') return parsed
    } catch {
      /* ignore */
    }
    return {}
  }
  const writeFloatPrefs = (patch) => {
    try {
      const next = { ...readFloatPrefs(), ...(patch !== null && typeof patch === 'object' ? patch : {}) }
      writeFileSync(FLOAT_PREFS_PATH, JSON.stringify(next))
      return next
    } catch {
      return readFloatPrefs()
    }
  }
  router.method('float.getPrefs', async () => {
    const prefs = readFloatPrefs()
    const alpha = Number(prefs.alpha)
    return { alpha: Number.isFinite(alpha) && alpha >= 20 && alpha <= 100 ? Math.round(alpha) : 55 }
  })
  router.method('float.setPrefs', async (body) => {
    const alpha = Number(body?.alpha)
    if (!Number.isFinite(alpha) || alpha < 20 || alpha > 100) throw new ApiError('bad-request', 'alpha 需在 20-100 之间', 400)
    writeFloatPrefs({ alpha: Math.round(alpha) })
    return { ok: true }
  })

  router.method('float.stop', async () => {
    await killFloat()
    return { running: false }
  })

  /* 客户端诊断日志（曾经被误删导致所有 client:* 日志丢失） */
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

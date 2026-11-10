/**
 * ⌘⇧N：新开一个 Harness 实例窗口。
 *
 * 桌面壳是 Electron 单实例应用，且主窗口只有 dsh-desktop-host 的 Node 进程可以管理；
 * 插件 Host 运行在独立 Node 进程里，没法直接 new BrowserWindow。这里复用古法编程
 * 自带的原生 helper（desktop/float，跨平台 WKWebView/WebView2/WebKit2GTK），给它传
 * `{ full: true }` 就打开一个普通窗口，加载同一个 DSH Web GUI（用 connection 签发的
 * 一次性鉴权 URL，和摸鱼悬浮层同一套登录逻辑）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ApiError } from './context.js'
import { floatBinaryCandidates } from './float-platform.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'dev'
  } catch {
    return 'dev'
  }
})()

function floatBinaryPath() {
  const root = join(PLUGIN_ROOT, 'desktop', 'float', 'bin')
  for (const full of floatBinaryCandidates(process.platform, process.arch, root)) {
    if (existsSync(full)) return full
  }
  return null
}

export async function newWindow(body, env) {
  if (process.platform !== 'darwin') {
    throw new ApiError('unsupported-platform', '实例窗口目前只支持 macOS（Windows/Linux helper 尚未实现 full 模式）', 501)
  }
  const binary = floatBinaryPath()
  if (binary === null) throw new ApiError('missing-helper', '实例窗口 helper 未构建（desktop/float/bin）', 500)
  const webServer = env.ctx.get('webServer')
  const connection = env.ctx.get('connection')
  if (webServer === undefined || webServer === null || connection === undefined || connection === null || typeof connection.authenticatedUrl !== 'function') {
    throw new ApiError('unavailable', '当前 Host 不提供 Web 服务地址，无法打开实例窗口', 500)
  }
  const base = `${webServer.protocol}//127.0.0.1:${String(webServer.port)}`
  const authUrl = connection.authenticatedUrl(`${base}/`)
  const fullscreen = body !== null && typeof body === 'object' && body.fullscreen === true
  const payload = JSON.stringify({
    full: true,
    fullscreen,
    authUrl,
    appUrl: `${base}/`,
    title: 'DeepSeek Harness',
    build: PLUGIN_VERSION,
    ownerPid: process.ppid,
  })
  try {
    const child = spawn(binary, [payload], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: { ...process.env, GUFA_FLOAT_PAYLOAD: payload },
    })
    child.unref()
    void body
    return { ok: true, pid: child.pid ?? null }
  } catch (error) {
    throw new ApiError('new-window-failed', `打开实例窗口失败：${String(error?.message ?? error)}`, 500)
  }
}

export function registerAppWindow(router, env) {
  router.method('app.newWindow', (body) => newWindow(body, env))
}

/**
 * 开发/诊断信息：供客户端在启动时探测「Host 半是否为最新代码」。
 * 旧版本 Host（没有本方法）会让 api('dev.version') 返回 not-found，客户端据此提示重启 Harness。
 */
import { appendFileSync } from 'node:fs'

const DEBUG_LOG_PATH = '/tmp/gufa-code-debug.log'

/** 追加一条客户端诊断日志（排查桌面壳/终端连接问题用）。 */
export function debugLog(message) {
  try {
    appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] client: ${String(message).slice(0, 4000)}\n`, { mode: 0o600 })
  } catch {
    /* 调试日志失败不影响功能 */
  }
}

export function register(router) {
  const startedAt = new Date().toISOString()

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

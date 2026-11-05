/**
 * dsh-gufa-code「古法编程」Host 半入口。
 *
 * 能力：项目 / 文件 / Git / SSH / 终端 / AI 聊天 / 静态资产，统一走 host/context.js 的
 * router（鉴权、项目白名单、WebSocket、SSE）。
 *
 * Host 模块按「代（generation）」动态 import：每次请求前比较 host/*.js 的 mtime，
 * 变化时重新 import 并整体替换旧 scope —— 因此修改 host 代码后无需重启 Harness。
 */
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRouter, ProjectRegistry } from './host/context.js'

const HOST_DIR = join(dirname(fileURLToPath(import.meta.url)), 'host')
const MODULE_FILES = ['assets.js', 'dev.js', 'project.js', 'fs.js', 'git.js', 'ssh.js', 'terminal.js', 'chat.js']

function existingModuleFiles() {
  return MODULE_FILES.filter((name) => {
    try {
      statSync(join(HOST_DIR, name))
      return true
    } catch {
      return false
    }
  })
}

/** host 目录内容签名：文件 mtimeMs 变化即触发重载。 */
function hostSignature() {
  try {
    return existingModuleFiles()
      .map((name) => `${name}:${statSync(join(HOST_DIR, name)).mtimeMs}`)
      .join('|')
  } catch {
    return 'unknown'
  }
}

export const name = 'dsh-gufa-code'
export const inject = ['webServer', 'connection']

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const router = createRouter(ctx)
  const env = { ctx, projects: new ProjectRegistry() }
  let generation = 0

  const load = async () => {
    const current = ++generation
    const { scope, registrar } = router.createScope()
    for (const file of existingModuleFiles()) {
      const url = new URL(`./host/${file}`, import.meta.url)
      url.searchParams.set('gufa', String(current))
      const module = await import(url.href)
      if (typeof module.register === 'function') module.register(registrar, env)
    }
    router.installScope(scope)
  }

  router.setReloader(load, hostSignature)
  router.mount()
}

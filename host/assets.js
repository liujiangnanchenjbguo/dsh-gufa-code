/**
 * 静态资产：Monaco AMD 版（vendor/monaco/vs/**）与 xterm（vendor/xterm/**）。
 * 均为 MIT 许可的离线资产，随插件目录分发；Host 按前缀原样提供。
 */
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mimeOf } from './context.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function assetResolver(baseDir) {
  return async (raw) => {
    const target = resolve(baseDir, raw)
    if (!inside(baseDir, target)) return undefined
    return { path: target, type: mimeOf(target) }
  }
}

export function register(router) {
  router.asset('monaco', assetResolver(resolve(packageRoot, 'vendor', 'monaco', 'vs')))
  router.asset('xterm', assetResolver(resolve(packageRoot, 'vendor', 'xterm')))
  router.asset('icon', async (raw) => {
    if (raw !== 'icon.svg') return undefined
    return { path: resolve(packageRoot, 'icon.svg'), type: 'image/svg+xml', cache: 'public, max-age=3600' }
  })
}

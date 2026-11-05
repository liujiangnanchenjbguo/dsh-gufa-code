/**
 * 文件系统能力：列表 / 读取 / 保存 / 新建 / 重命名 / 删除。
 * 所有路径都必须是「已打开项目根」内的相对路径，防止越权访问任意磁盘。
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, cp, lstat, mkdir, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ApiError, badRequest } from './context.js'

const TEXT_LIMIT = 4 * 1024 * 1024
const runCommand = promisify(execFile)
const LIST_LIMIT = 4000

/** 扩展名 → Monaco language id（与 VS Code 常用映射一致）。 */
export const LANG_BY_EXT = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  xml: 'xml', svg: 'xml', plist: 'xml', csproj: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini',
  py: 'python', pyw: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell',
  lua: 'lua', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql',
  swift: 'swift', kt: 'kotlin', kts: 'kotlin', dart: 'dart', scala: 'scala',
  dockerfile: 'dockerfile', makefile: 'makefile', cmake: 'cmake',
  txt: 'plaintext', log: 'plaintext', gitignore: 'plaintext', lock: 'plaintext',
}

export function languageOf(path) {
  const base = String(path).split(/[\\/]/).pop() ?? ''
  if (/^dockerfile$/i.test(base)) return 'dockerfile'
  if (/^makefile$/i.test(base)) return 'makefile'
  if (/^\.?gitignore$/i.test(base) || /^\.?env/i.test(base)) return 'plaintext'
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'plaintext'
  return LANG_BY_EXT[base.slice(dot + 1).toLowerCase()] ?? 'plaintext'
}

/** 项目根内的相对路径解析（拒绝绝对路径、.. 逃逸与符号链接逃逸）。 */
export async function resolveProjectPath(root, raw, { create = false } = {}) {
  if (typeof raw !== 'string') throw badRequest('path must be a string')
  if (isAbsolute(raw)) throw new ApiError('path-invalid', '不允许绝对路径', 400)
  const absolute = resolve(root, raw === '' ? '.' : raw)
  const rel = relative(root, absolute)
  if (rel !== '' && (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel))) {
    throw new ApiError('path-outside', '路径超出项目范围', 403)
  }
  if (create) {
    const parent = await realpath(dirname(absolute)).catch(() => {
      throw new ApiError('parent-missing', '父目录不存在', 404)
    })
    const relParent = relative(root, parent)
    if (relParent !== '' && (relParent.startsWith(`..${sep}`) || isAbsolute(relParent))) {
      throw new ApiError('path-outside', '父目录超出项目范围', 403)
    }
  } else {
    const actual = await realpath(absolute).catch(() => {
      throw new ApiError('not-found', `路径不存在：${raw}`, 404)
    })
    const relActual = relative(root, actual)
    if (relActual !== '' && (relActual.startsWith(`..${sep}`) || isAbsolute(relActual))) {
      throw new ApiError('path-outside', '路径超出项目范围', 403)
    }
  }
  return absolute
}

function relativePath(root, absolute) {
  return relative(root, absolute).split(sep).join('/')
}

function revisionOf(content, mtimeMs) {
  return createHash('sha256').update(content).update(String(mtimeMs)).digest('hex')
}

async function projectOf(env, body) {
  const project = env.projects.ensure(body.root)
  return project.root
}

export function register(router, env) {
  router.method('fs.list', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, typeof body.path === 'string' ? body.path : '')
    const values = (await readdir(absolute, { withFileTypes: true })).filter((item) => item.name !== '.git')
    const rows = await Promise.all(values.slice(0, LIST_LIMIT).map(async (item) => {
      const full = join(absolute, item.name)
      const entry = { name: item.name, path: relativePath(root, full), kind: item.isDirectory() ? 'dir' : 'file' }
      try {
        const info = await lstat(full)
        entry.size = info.size
        entry.mtimeMs = info.mtimeMs
      } catch {
        /* 权限/竞态：忽略详情 */
      }
      return entry
    }))
    rows.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    return { path: relativePath(root, absolute), entries: rows }
  })

  router.method('fs.read', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, body.path)
    const info = await stat(absolute)
    if (!info.isFile()) throw new ApiError('not-file', '不是文件', 400)
    const tooLarge = info.size > TEXT_LIMIT
    const handle = await open(absolute, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(info.size, tooLarge ? 4096 : TEXT_LIMIT))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const bytes = buffer.subarray(0, bytesRead)
      const binary = bytes.includes(0)
      return {
        path: relativePath(root, absolute),
        content: binary || tooLarge ? '' : bytes.toString('utf8'),
        revision: revisionOf(bytes, info.mtimeMs),
        size: info.size,
        mtimeMs: info.mtimeMs,
        binary,
        tooLarge,
        language: languageOf(body.path),
      }
    } finally {
      await handle.close()
    }
  })

  router.method('fs.write', async (body) => {
    const root = await projectOf(env, body)
    if (typeof body.content !== 'string') throw badRequest('content must be a string')
    const absolute = await resolveProjectPath(root, body.path)
    const current = await stat(absolute).catch(() => undefined)
    if (current === undefined) throw new ApiError('not-found', '文件不存在', 404)
    const handle = await open(absolute, 'r')
    let buffer
    try {
      buffer = Buffer.alloc(Math.min(current.size, TEXT_LIMIT))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      buffer = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    const revision = revisionOf(buffer, current.mtimeMs)
    if (typeof body.expectedRevision === 'string' && body.expectedRevision !== revision) {
      throw new ApiError('revision-conflict', '文件已在磁盘上被修改，请重新打开后再保存', 409)
    }
    const temp = join(dirname(absolute), `.${randomUUID()}.gufa.tmp`)
    await writeFile(temp, body.content, { encoding: 'utf8', flag: 'wx' })
    try {
      await rename(temp, absolute)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    const saved = await stat(absolute)
    return { revision: revisionOf(Buffer.from(body.content, 'utf8'), saved.mtimeMs), size: saved.size }
  })

  router.method('fs.create', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, body.path, { create: true })
    if (body.kind === 'dir') {
      await mkdir(absolute)
      return { path: relativePath(root, absolute), kind: 'dir' }
    }
    const handle = await open(absolute, 'wx').catch((error) => {
      if (error !== null && typeof error === 'object' && error.code === 'EEXIST') throw new ApiError('exists', '同名文件已存在', 409)
      throw error
    })
    await handle.close()
    return { path: relativePath(root, absolute), kind: 'file' }
  })

  router.method('fs.rename', async (body) => {
    const root = await projectOf(env, body)
    const source = await resolveProjectPath(root, body.path)
    const target = await resolveProjectPath(root, body.nextPath, { create: true })
    await access(target, constants.F_OK).then(
      () => {
        throw new ApiError('target-exists', '目标已存在', 409)
      },
      () => undefined,
    )
    await rename(source, target)
    return { path: relativePath(root, target) }
  })

  router.method('fs.delete', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, body.path)
    if (absolute === root) throw new ApiError('refuse', '不能删除项目根目录', 400)
    await rm(absolute, { recursive: true, force: false })
    return { ok: true }
  })

  /**
   * 复制/粘贴：把 from（项目内相对路径数组）复制到目录 to 下（同名冲突自动加序号）。
   * 用于资源管理器的多选复制、Cmd+C / Cmd+V。
   */
  router.method('fs.copy', async (body) => {
    const root = await projectOf(env, body)
    if (!Array.isArray(body.from) || body.from.length === 0) throw badRequest('from is required')
    const targetDir = await resolveProjectPath(root, typeof body.to === 'string' && body.to !== '' ? body.to : '')
    const info = await stat(targetDir)
    if (!info.isDirectory()) throw new ApiError('not-dir', '目标不是目录', 400)
    const copied = []
    for (const raw of body.from) {
      if (typeof raw !== 'string' || raw === '') continue
      const source = await resolveProjectPath(root, raw)
      if (source === root) throw new ApiError('refuse', '不能复制项目根目录', 400)
      const base = raw.split('/').filter(Boolean).pop()
      let name = base
      let target = join(targetDir, name)
      let suffix = 1
      while (await stat(target).then(() => true, () => false)) {
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const ext = dot > 0 ? base.slice(dot) : ''
        name = `${stem} 副本${suffix > 1 ? ` ${suffix}` : ''}${ext}`
        target = join(targetDir, name)
        suffix += 1
        if (suffix > 200) throw new ApiError('copy-name-failed', '无法生成目标文件名', 500)
      }
      await cp(source, target, { recursive: true, errorOnExist: true, force: false })
      copied.push({ from: raw, to: relativePath(root, target) })
    }
    return { copied }
  })

  /** 软删除：移动到系统临时目录，返回可撤销的 id（资源管理器删除后用 ⌘Z 恢复）。 */
  router.method('fs.trash', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, body.path)
    if (absolute === root) throw new ApiError('refuse', '不能删除项目根目录', 400)
    const info = await lstat(absolute)
    const id = randomUUID()
    const trashDir = join(tmpdir(), 'gufa-code-trash')
    await mkdir(trashDir, { recursive: true })
    await rename(absolute, join(trashDir, id))
    return { id, path: relativePath(root, absolute), kind: info.isDirectory() ? 'dir' : 'file' }
  })

  /** 撤销软删除：把临时目录里的条目移回原路径。 */
  router.method('fs.untrash', async (body) => {
    const root = await projectOf(env, body)
    const idRaw = typeof body.id === 'string' ? body.id : ''
    if (!/^[0-9a-f-]{8,64}$/i.test(idRaw)) throw badRequest('id is invalid')
    const source = join(tmpdir(), 'gufa-code-trash', idRaw)
    const target = await resolveProjectPath(root, body.path, { create: true })
    const exists = await access(target).then(() => true, () => false)
    if (exists) throw new ApiError('target-exists', '原位置已存在同名文件，无法撤销', 409)
    await rename(source, target)
    return { ok: true, path: relativePath(root, target) }
  })

  /** 在系统文件管理器里显示（macOS Finder / Windows 资源管理器 / Linux 文件管理器）。 */
  router.method('fs.reveal', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, typeof body.path === 'string' ? body.path : '')
    const info = await stat(absolute)
    const target = info.isDirectory() ? absolute : dirname(absolute)
    try {
      if (process.platform === 'darwin') {
        await runCommand('open', [target], { timeout: 10_000 })
      } else if (process.platform === 'win32') {
        await runCommand('explorer.exe', [target], { timeout: 10_000 }).catch(() => undefined)
      } else {
        await runCommand('xdg-open', [target], { timeout: 10_000 })
      }
    } catch (error) {
      throw new ApiError('reveal-failed', `无法打开文件管理器：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    return { ok: true }
  })

  /** 以流的方式返回项目内文件内容（图片预览等）。 */
  router.method('fs.rawUrl', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, body.path)
    void absolute
    return { path: body.path }
  })

  router.method('fs.stat', async (body) => {
    const root = await projectOf(env, body)
    const absolute = await resolveProjectPath(root, body.path)
    const info = await stat(absolute)
    return { kind: info.isDirectory() ? 'dir' : 'file', size: info.size, mtimeMs: info.mtimeMs }
  })

  /** 供 Host 内部使用（例如 git 忽略列表），导出以便其他模块复用。 */
  router.fs = { resolveProjectPath, languageOf, relativePath }
}

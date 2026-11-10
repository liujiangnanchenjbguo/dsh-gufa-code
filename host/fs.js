/**
 * 文件系统能力：列表 / 读取 / 保存 / 新建 / 重命名 / 删除。
 * 所有路径都必须是「已打开项目根」内的相对路径，防止越权访问任意磁盘。
 */
import { createHash, randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { access, cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ApiError, badRequest } from './context.js'
import { registerLsp } from './lsp.js'
import { registerCompletion } from './completion.js'

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
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', astro: 'html',
  ejs: 'ejs', eta: 'ejs',
  hbs: 'handlebars', handlebars: 'handlebars', mustache: 'handlebars',
  pug: 'pug', jade: 'pug',
  njk: 'jinja', nunjucks: 'jinja', jinja: 'jinja', jinja2: 'jinja', j2: 'jinja',
  liquid: 'liquid', twig: 'twig', ftl: 'freemarker2', razor: 'razor', cshtml: 'razor',
  erb: 'erb', rhtml: 'erb',
  haml: 'haml', slim: 'slim',
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
  if (/\.blade\.php$/i.test(base)) return 'blade'
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

/* ── 全项目搜索/替换共用的目录与文件枚举 ───────────────────────────────── */
const SEARCH_EXCLUDED = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'target', '.venv', 'venv',
  '__pycache__', '.idea', '.cache', '.turbo', '.parcel-cache', '.svelte-kit', '.nuxt', '.output',
  'coverage', '.gradle', 'DerivedData', 'Pods', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.electron-cache', '.npm-cache', '.pip-cache', '.yarn', '.pnpm-store', '.pnpm',
])
const SEARCH_SKIP_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'icns', 'bmp', 'tiff', 'pdf', 'zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'dmg', 'iso',
  'mp4', 'mp3', 'wav', 'mov', 'avi', 'mkv', 'flac', 'jar', 'class', 'o', 'a', 'so', 'dylib', 'dll', 'exe', 'bin', 'dat',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'wasm', 'pyc', 'node',
])
const SEARCH_EXCLUDE_PREFIXES = ['.venv', '.npm-cache', '.pip-cache', '.electron-cache', '.pnpm', '.yarn', '.cache', '.next-cache']
function searchDirExcluded(name) {
  if (SEARCH_EXCLUDED.has(name)) return true
  for (const prefix of SEARCH_EXCLUDE_PREFIXES) {
    if (name.startsWith(prefix)) return true
  }
  return false
}
function searchExtensionOf(rel) {
  const base = String(rel).split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
/** 解析「包含/排除的文件」：数组或逗号/换行分隔字符串。 */
function readPatternList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
  return []
}
/** 把 VS Code 风格 glob 编译成正则（支持 **、*、?；无 / 的模式匹配任意层级 basename）。 */
function globToRegExp(pattern) {
  let text = String(pattern).replace(/\\/g, '/').trim()
  if (text === '') return null
  if (text.startsWith('./')) text = text.slice(2)
  let body = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '*') {
      if (text[index + 1] === '*') {
        index += 1
        if (text[index + 1] === '/') {
          index += 1
          body += '(?:.*/)?'
        } else {
          body += '.*'
        }
      } else {
        body += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      body += '[^/]'
      continue
    }
    body += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  const hasSlash = text.includes('/')
  const anchored = text.startsWith('/') ? `^/${body}$` : hasSlash ? `^${body}$` : `(?:^|/)${body}$`
  try {
    return new RegExp(anchored, 'i')
  } catch {
    return null
  }
}
/** 构造路径过滤器：include 任一命中 + 不被 exclude 命中。 */
function buildPathFilter(options) {
  const include = readPatternList(options.include).map(globToRegExp).filter(Boolean)
  const exclude = readPatternList(options.exclude).map(globToRegExp).filter(Boolean)
  return (rel) => {
    if (include.length > 0 && !include.some((regex) => regex.test(rel))) return false
    if (exclude.length > 0 && exclude.some((regex) => regex.test(rel))) return false
    return true
  }
}
/** VS Code 式「保留大小写」：全大写/全小写/首字母大写分别跟随匹配项。 */
function applyPreserveCase(matched, replacement) {
  const text = String(matched ?? '')
  if (text === '' || replacement === '') return replacement
  const upper = text === text.toUpperCase() && text !== text.toLowerCase()
  const lower = text === text.toLowerCase() && text !== text.toUpperCase()
  if (upper) return replacement.toUpperCase()
  if (lower) return replacement.toLowerCase()
  if (/^[A-Z]/.test(text)) return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  return replacement
}

async function isGitProject(root, project) {
  if (project !== null && project !== undefined && project.isGit === true) return true
  try {
    const dotGit = await stat(join(root, '.git'))
    return dotGit.isDirectory() || dotGit.isFile()
  } catch {
    return false
  }
}
/** 枚举项目内可搜索文件：Git 项目用 git ls-files，否则 BFS 遍历并跳过依赖/缓存目录。 */
async function listProjectCandidates(root, project, maxScanned) {
  if (await isGitProject(root, project)) {
    try {
      const { stdout } = await runCommand('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15000,
      })
      const files = stdout.split('\0').filter((item) => item !== '')
      files.sort((a, b) => a.localeCompare(b))
      return { files, truncated: false, viaGit: true }
    } catch {
      /* 回退到目录遍历 */
    }
  }
  const queue = ['']
  const files = []
  let head = 0
  let scanned = 0
  let truncated = false
  while (head < queue.length) {
    if (files.length >= maxScanned) {
      truncated = true
      break
    }
    const dirRel = queue[head]
    head += 1
    let entries
    try {
      entries = await readdir(join(root, dirRel), { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!searchDirExcluded(entry.name)) queue.push(dirRel === '' ? entry.name : `${dirRel}/${entry.name}`)
        continue
      }
      if (!entry.isFile() || searchDirExcluded(entry.name)) continue
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`
      if (SEARCH_SKIP_EXT.has(searchExtensionOf(rel))) continue
      files.push(rel)
      scanned += 1
      if (files.length >= maxScanned) {
        truncated = true
        break
      }
    }
  }
  return { files, truncated, viaGit: false, scanned }
}

export function register(router, env) {
  /* Python 语言服务（LSP/pyright）：/lsp/definition API；Cmd+点击与悬停由客户端调用 */
  registerLsp(router, env)

  /* Tab 行内补全：借用 Harness 自己的模型服务 */
  registerCompletion(router, env)

  /* 代码导航（Cmd+点击跳定义）：实现放在 code.js，但 Host 热重载只按 host/*.js 的 mtime
     触发，因此这里用带 mtime 的 query 动态 import，code.js 改动后下一次请求就能热生效。 */
  router.method('code.definition', async (body) => {
    let stamp = '0'
    try {
      stamp = String(statSync(new URL('./code.js', import.meta.url)).mtimeMs)
    } catch {
      stamp = '0'
    }
    const module = await import(new URL(`./code.js?gufa-code-def=${stamp}`, import.meta.url).href)
    return module.definition(body, env)
  })

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

  /** 把系统剪贴板里的文件匹配回项目内已有文件（供聊天框「粘贴文件→@引用」使用）。 */
  /** 全项目文本搜索（左侧「搜索」面板用）。返回按文件分组、带上行列号的匹配。 */
  router.method('fs.search', async (body) => {
    const project = env.projects.ensure(typeof body.root === 'string' ? body.root : '')
    const root = project.root
    const rawQuery = typeof body.query === 'string' ? body.query : ''
    const query = rawQuery.slice(0, 200)
    if (query === '') return { query: '', files: [], total: 0, truncated: false, scanned: 0, viaGit: false }
    const options = body.options !== null && typeof body.options === 'object' ? body.options : {}
    const caseSensitive = options.caseSensitive === true
    const useRegex = options.regex === true
    const pathFilter = buildPathFilter(options)
    const clampInt = (value, fallback, min, max) => {
      const number = Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(Math.max(Math.trunc(number), min), max)
    }
    const maxFiles = clampInt(options.maxFiles, 200, 1, 500)
    const maxMatches = clampInt(options.maxMatches, 500, 1, 2000)
    const maxScanned = clampInt(options.maxScanned, 20000, 100, 100000)
    const fileSizeLimit = 2 * 1024 * 1024
    const timeBudget = 12000
    const startedAt = Date.now()
    let regex = null
    let needle = ''
    if (useRegex) {
      try {
        regex = new RegExp(query, caseSensitive ? 'g' : 'gi')
      } catch (error) {
        throw new ApiError('bad-regex', `正则表达式无效：${error.message}`, 400)
      }
    } else {
      needle = caseSensitive ? query : query.toLowerCase()
    }
    const EXCLUDED = new Set([
      'node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'target', '.venv', 'venv',
      '__pycache__', '.idea', '.cache', '.turbo', '.parcel-cache', '.svelte-kit', '.nuxt', '.output',
      'coverage', '.gradle', 'DerivedData', 'Pods', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
      '.electron-cache', '.npm-cache', '.pip-cache', '.yarn', '.pnpm-store', '.pnpm',
    ])
    /* 明显是二进制的扩展名：不读文件，避免把大量图片/压缩包计入扫描数 */
    const SKIP_EXT = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'icns', 'bmp', 'tiff', 'pdf', 'zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'dmg', 'iso',
      'mp4', 'mp3', 'wav', 'mov', 'avi', 'mkv', 'flac', 'jar', 'class', 'o', 'a', 'so', 'dylib', 'dll', 'exe', 'bin', 'dat',
      'woff', 'woff2', 'ttf', 'otf', 'eot', 'wasm', 'pyc', 'node',
    ])
    const extensionOf = (rel) => {
      const base = String(rel).split('/').pop() ?? ''
      const dot = base.lastIndexOf('.')
      return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
    }
    const files = []
    let total = 0
    let scanned = 0
    let truncated = false
    const readMatches = (line) => {
      const raw = []
      if (regex !== null) {
        regex.lastIndex = 0
        let match
        while ((match = regex.exec(line)) !== null) {
          if (match[0].length === 0) {
            regex.lastIndex += 1
            continue
          }
          raw.push([match.index, match.index + match[0].length])
          if (raw.length >= 50) break
        }
        return raw
      }
      const haystack = caseSensitive ? line : line.toLowerCase()
      let from = 0
      while (raw.length < 50) {
        const index = haystack.indexOf(needle, from)
        if (index === -1) break
        raw.push([index, index + needle.length])
        from = index + Math.max(needle.length, 1)
      }
      return raw
    }
    const searchFile = async (rel) => {
      const absolute = join(root, rel)
      const info = await stat(absolute).catch(() => undefined)
      if (info === undefined || !info.isFile() || info.size > fileSizeLimit) return []
      let buffer
      try {
        buffer = await readFile(absolute)
      } catch {
        return []
      }
      if (buffer.includes(0)) return []
      const lines = buffer.toString('utf8').split(/\r?\n/)
      const matches = []
      for (let index = 0; index < lines.length && matches.length < 50; index += 1) {
        const line = lines[index]
        for (const range of readMatches(line)) {
          if (matches.length >= 50 || total >= maxMatches) break
          const WINDOW = 300
          const windowStart = line.length > WINDOW ? Math.max(0, Math.min(line.length - WINDOW, range[0] - 80)) : 0
          matches.push({
            line: index + 1,
            column: range[0] + 1,
            start: range[0] - windowStart,
            end: range[1] - windowStart,
            text: line.slice(windowStart, windowStart + WINDOW),
          })
          total += 1
        }
      }
      return matches
    }
    const acceptFile = async (rel) => {
      if (!pathFilter(rel)) return
      const matches = await searchFile(rel)
      if (matches.length === 0) return
      files.push({ path: rel, matches })
    }
    /* Git 项目用 git ls-files 拿文件清单（快、尊重 .gitignore、包含未跟踪文件）；
       非 Git 项目才走目录遍历。 */
    let isGitRepo = project.isGit === true
    if (!isGitRepo) {
      try {
        const dotGit = await stat(join(root, '.git'))
        isGitRepo = dotGit.isDirectory() || dotGit.isFile()
      } catch {
        isGitRepo = false
      }
    }
    let candidates = null
    if (isGitRepo) {
      try {
        const { stdout } = await runCommand('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
          cwd: root,
          maxBuffer: 64 * 1024 * 1024,
          timeout: 15000,
        })
        candidates = stdout.split('\0').filter((item) => item !== '')
        candidates.sort((a, b) => a.localeCompare(b))
      } catch {
        candidates = null
      }
    }
    if (candidates !== null) {
      for (const rel of candidates) {
        if (files.length >= maxFiles || total >= maxMatches || scanned >= maxScanned || Date.now() - startedAt > timeBudget) {
          truncated = true
          break
        }
        if (SKIP_EXT.has(extensionOf(rel))) continue
        scanned += 1
        await acceptFile(rel)
      }
      if (!truncated && files.length >= maxFiles) truncated = true
    } else {
      const queue = ['']
      let head = 0
      while (head < queue.length) {
        if (files.length >= maxFiles || total >= maxMatches || scanned >= maxScanned || Date.now() - startedAt > timeBudget) {
          truncated = true
          break
        }
        const dirRel = queue[head]
        head += 1
        let entries
        try {
          entries = await readdir(join(root, dirRel), { withFileTypes: true })
        } catch {
          continue
        }
        entries.sort((a, b) => String(a.name).localeCompare(String(b.name)))
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!EXCLUDED.has(entry.name) && !SEARCH_EXCLUDE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) queue.push(dirRel === '' ? entry.name : `${dirRel}/${entry.name}`)
            continue
          }
          if (!entry.isFile() || EXCLUDED.has(entry.name)) continue
          const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`
          if (SKIP_EXT.has(extensionOf(rel))) continue
          if (scanned >= maxScanned) {
            truncated = true
            break
          }
          scanned += 1
          await acceptFile(rel)
          if (files.length >= maxFiles || total >= maxMatches) {
            truncated = true
            break
          }
        }
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    return { query, files, total, truncated, scanned, viaGit: candidates !== null }
  })

  /** 全项目批量替换（左侧「搜索」面板的替换功能）。只写内容确实变化的文件。 */
  router.method('fs.replace', async (body) => {
    const project = env.projects.ensure(typeof body.root === 'string' ? body.root : '')
    const root = project.root
    const query = typeof body.query === 'string' ? body.query.slice(0, 200) : ''
    const replacement = typeof body.replacement === 'string' ? body.replacement : ''
    if (query === '') return { replacedFiles: [], replacedCount: 0, failed: [], scanned: 0, truncated: false, stale: false }
    const options = body.options !== null && typeof body.options === 'object' ? body.options : {}
    const caseSensitive = options.caseSensitive === true
    const useRegex = options.regex === true
    const preserveCase = options.preserveCase === true
    const clampInt = (value, fallback, min, max) => {
      const number = Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(Math.max(Math.trunc(number), min), max)
    }
    const maxReplacements = clampInt(body.maxReplacements, 5000, 1, 50000)
    const flags = caseSensitive ? 'g' : 'gi'
    let regex = null
    try {
      regex = new RegExp(useRegex ? query : escapeRegExp(query), flags)
    } catch (error) {
      throw new ApiError('bad-regex', `正则表达式无效：${error.message}`, 400)
    }
    if (useRegex && new RegExp(query, caseSensitive ? '' : 'i').test('')) {
      throw new ApiError('bad-regex', '正则表达式不能匹配空字符串', 400)
    }
    const fileSizeLimit = 2 * 1024 * 1024
    const pathFilter = buildPathFilter(options)

    /* 模式 A：只替换某一个匹配（搜索结果行上的替换按钮），用行/列定位。 */
    const target = body.target !== null && typeof body.target === 'object' ? body.target : null
    if (target !== null) {
      const rawPath = typeof target.path === 'string' ? target.path : ''
      const targetLine = Number(target.line)
      const targetColumn = Number(target.column)
      if (rawPath === '' || !Number.isInteger(targetLine) || targetLine < 1 || !Number.isInteger(targetColumn) || targetColumn < 1) {
        throw badRequest('target.line / target.column is required')
      }
      let absolute
      try {
        absolute = await resolveProjectPath(root, rawPath)
      } catch {
        return { replacedFiles: [], replacedCount: 0, failed: [rawPath], scanned: 1, truncated: false, stale: true }
      }
      const info = await stat(absolute).catch(() => undefined)
      if (info === undefined || !info.isFile() || info.size > fileSizeLimit) {
        return { replacedFiles: [], replacedCount: 0, failed: [rawPath], scanned: 1, truncated: false, stale: true }
      }
      let buffer
      try {
        buffer = await readFile(absolute)
      } catch {
        return { replacedFiles: [], replacedCount: 0, failed: [rawPath], scanned: 1, truncated: false, stale: false }
      }
      if (buffer.includes(0)) return { replacedFiles: [], replacedCount: 0, failed: [rawPath], scanned: 1, truncated: false, stale: false }
      const text = buffer.toString('utf8')
      regex.lastIndex = 0
      let found = null
      let cursor = 0
      let line = 1
      let lineStart = 0
      let match
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex += 1
          continue
        }
        const index = match.index
        if (index > cursor) {
          const chunk = text.slice(cursor, index)
          const newlines = chunk.split('\n').length - 1
          line += newlines
          const lastNewline = chunk.lastIndexOf('\n')
          if (lastNewline !== -1) lineStart = cursor + lastNewline + 1
          cursor = index
        }
        const column = index - lineStart + 1
        if (line === targetLine && column === targetColumn) {
          found = { index, value: match[0] }
          break
        }
        if (line > targetLine || (line === targetLine && column > targetColumn)) break
      }
      if (found === null) {
        return { replacedFiles: [], replacedCount: 0, failed: [], scanned: 1, truncated: false, stale: true }
      }
      let replacedValue = replacement
      if (useRegex) {
        try {
          replacedValue = found.value.replace(new RegExp(`^(?:${query})$`, caseSensitive ? '' : 'i'), replacement)
        } catch {
          replacedValue = replacement
        }
      }
      if (preserveCase) replacedValue = applyPreserveCase(found.value, replacedValue)
      const updated = `${text.slice(0, found.index)}${replacedValue}${text.slice(found.index + found.value.length)}`
      try {
        await writeFile(absolute, updated, 'utf8')
      } catch {
        return { replacedFiles: [], replacedCount: 0, failed: [rawPath], scanned: 1, truncated: false, stale: false }
      }
      return { replacedFiles: [relativePath(root, absolute)], replacedCount: 1, failed: [], scanned: 1, truncated: false, stale: false }
    }

    /* 模式 B：批量替换（全部替换 / 单个文件替换）。 */
    const pathsFilter = Array.isArray(body.paths)
      ? body.paths.filter((item) => typeof item === 'string' && item !== '').slice(0, 200)
      : null
    let candidates = []
    if (pathsFilter !== null) {
      for (const raw of pathsFilter) {
        try {
          const absolute = await resolveProjectPath(root, raw)
          const rel = relativePath(root, absolute)
          if (pathFilter(rel)) candidates.push(rel)
        } catch {
          /* 路径非法/已删除：跳过 */
        }
      }
    } else {
      const listed = await listProjectCandidates(root, project, 20000)
      candidates = listed.files.filter((rel) => pathFilter(rel))
    }
    const replacedFiles = []
    const failed = []
    let replacedCount = 0
    let truncated = false
    const expand = (matched, groups) => {
      let output = replacement
      if (useRegex) {
        output = output
          .replace(/\$\$/g, '\u0000')
          .replace(/\$&/g, matched)
          .replace(/\$(\d{1,2})/g, (piece, index) => {
            const group = groups[Number(index) - 1]
            return group === undefined ? piece : group
          })
          .replace(/\u0000/g, '$')
      }
      if (preserveCase) output = applyPreserveCase(matched, output)
      return output
    }
    for (const rel of candidates) {
      if (replacedCount >= maxReplacements) {
        truncated = true
        break
      }
      const absolute = join(root, rel)
      const info = await stat(absolute).catch(() => undefined)
      if (info === undefined || !info.isFile() || info.size > fileSizeLimit) continue
      let buffer
      try {
        buffer = await readFile(absolute)
      } catch {
        failed.push(rel)
        continue
      }
      if (buffer.includes(0)) continue
      const text = buffer.toString('utf8')
      regex.lastIndex = 0
      const matches = text.match(regex)
      if (matches === null || matches.length === 0) continue
      if (replacedCount + matches.length > maxReplacements) {
        truncated = true
        break
      }
      let updated
      try {
        updated = text.replace(regex, (matched, ...args) => expand(matched, args.slice(0, Math.max(args.length - 2, 0))))
      } catch (error) {
        failed.push(rel)
        continue
      }
      if (updated === text) continue
      try {
        await writeFile(absolute, updated, 'utf8')
        replacedFiles.push(rel)
        replacedCount += matches.length
      } catch {
        failed.push(rel)
      }
    }
    return { replacedFiles, replacedCount, failed, scanned: candidates.length, truncated, stale: false }
  })

  router.method('fs.matchFiles', async (body) => {
    const root = await projectOf(env, body)
    const wanted = Array.isArray(body.files)
      ? body.files.filter((file) => file !== null && typeof file === 'object'
        && typeof file.name === 'string' && file.name !== ''
        && Number.isFinite(file.size) && typeof file.sha256 === 'string' && file.sha256 !== '')
      : []
    if (wanted.length === 0) return { matches: [] }
    const EXCLUDED = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'target', '.venv', 'venv', '__pycache__', '.idea', '.cache'])
    const byName = new Map()
    const stack = ['']
    let scanned = 0
    while (stack.length > 0 && scanned < 40000) {
      const dirRel = stack.pop()
      let entries
      try {
        entries = await readdir(join(root, dirRel), { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const childRel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`
        if (entry.isDirectory()) {
          if (!EXCLUDED.has(entry.name)) stack.push(childRel)
          continue
        }
        if (!entry.isFile()) continue
        scanned += 1
        const list = byName.get(entry.name) ?? []
        if (list.length < 200) list.push(childRel)
        byName.set(entry.name, list)
      }
    }
    const hashFile = (absolute) => new Promise((resolve) => {
      try {
        const hash = createHash('sha256')
        const stream = createReadStream(absolute)
        stream.on('data', (chunk) => hash.update(chunk))
        stream.on('error', () => resolve(''))
        stream.on('end', () => resolve(hash.digest('hex')))
      } catch {
        resolve('')
      }
    })
    const matches = []
    for (const want of wanted) {
      let hit = null
      for (const rel of byName.get(want.name) ?? []) {
        const absolute = join(root, rel)
        const info = await stat(absolute).catch(() => undefined)
        if (info === undefined || !info.isFile() || info.size !== want.size) continue
        const digest = await hashFile(absolute)
        if (digest === want.sha256) {
          hit = rel
          break
        }
      }
      matches.push({ name: want.name, path: hit })
    }
    return { matches }
  })

  /** 上传文件到项目目录（系统剪贴板粘贴 / 从 Finder 拖入资源管理器）。 */
  router.method('fs.upload', async (body) => {
    const root = await projectOf(env, body)
    const dirRel = typeof body.dir === 'string' ? body.dir : ''
    const dir = await resolveProjectPath(root, dirRel)
    const dirInfo = await stat(dir).catch(() => undefined)
    if (dirInfo === undefined || !dirInfo.isDirectory()) throw new ApiError('not-dir', '目标不是目录', 400)
    if (!Array.isArray(body.files) || body.files.length === 0) throw badRequest('files is required')
    const written = []
    for (const file of body.files) {
      if (file === null || typeof file !== 'object') continue
      const rawName = typeof file.name === 'string' ? file.name : ''
      const base = rawName.split(/[/\\]/).filter(Boolean).pop() || 'file'
      const safeBase = base.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'file'
      const data = Buffer.from(typeof file.data === 'string' ? file.data : '', 'base64')
      if (data.length > 300 * 1024 * 1024) throw new ApiError('too-large', `文件过大：${safeBase}`, 400)
      let target = join(dir, safeBase)
      let suffix = 1
      while (await stat(target).then(() => true, () => false)) {
        const dot = safeBase.lastIndexOf('.')
        const stem = dot > 0 ? safeBase.slice(0, dot) : safeBase
        const ext = dot > 0 ? safeBase.slice(dot) : ''
        target = join(dir, `${stem} 副本${suffix > 1 ? ` ${suffix}` : ''}${ext}`)
        suffix += 1
        if (suffix > 500) throw new ApiError('upload-name-failed', '无法生成目标文件名', 500)
      }
      await writeFile(target, data, { flag: 'wx' })
      written.push({ path: relativePath(root, target), size: data.length })
    }
    return { written }
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

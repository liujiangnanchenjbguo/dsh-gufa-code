/**
 * 代码导航：Cmd/Ctrl+点击「跳转到定义 / 方法实现」的 Host 侧兜底实现。
 *
 * Monaco 自带的语言服务只覆盖已加载到 Monaco 的 model（以及 TS/JS 打开过的文件），
 * 对未打开的文件、Python/Go/Rust 等没有内置语言服务的语言就找不到定义。这里做一个
 * 项目级的轻量定义搜索：只匹配声明形态（function/class/const/def/func/fn/method/type…），
 * 优先当前文件，其次同类语言文件，返回带行列号的结果供客户端跳转或列表选择。
 */
import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { ApiError, badRequest } from './context.js'

const runCommand = promisify(execFile)
const MAX_FILE_SIZE = 512 * 1024
const MAX_SCANNED = 3000
const TIME_BUDGET = 7000
const MAX_MATCHES = 30
const EXCLUDED = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'target', '.venv', 'venv',
  '__pycache__', '.idea', '.cache', '.turbo', '.svelte-kit', '.nuxt', '.output', 'coverage',
  '.gradle', 'DerivedData', 'Pods', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.electron-cache', '.npm-cache', '.pip-cache', '.yarn', '.pnpm-store', '.pnpm',
])
const EXCLUDED_PREFIXES = ['.venv', '.npm-cache', '.pip-cache', '.electron-cache', '.pnpm', '.yarn', '.cache']
const SKIP_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'icns', 'bmp', 'tiff', 'pdf', 'zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'dmg', 'iso',
  'mp4', 'mp3', 'wav', 'mov', 'avi', 'mkv', 'flac', 'jar', 'class', 'o', 'a', 'so', 'dylib', 'dll', 'exe', 'bin', 'dat',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'wasm', 'pyc', 'node',
])

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extensionOf(rel) {
  const name = String(rel).split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function isExcludedDir(name) {
  if (EXCLUDED.has(name)) return true
  for (const prefix of EXCLUDED_PREFIXES) if (String(name).startsWith(prefix)) return true
  return false
}

function lineColumnAt(text, index) {
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lastNewline = i
    }
  }
  return { line, column: index - lastNewline }
}

function extractWord(lineText, column) {
  const text = String(lineText ?? '')
  const position = Math.max(0, Math.min(text.length - 1, column - 1))
  const isWord = (char) => /[A-Za-z0-9_$]/.test(char)
  if (!isWord(text[position] ?? '')) {
    /* 在附近找最近的标识符字符（Cmd 点击可能落在词边上） */
    let left = position
    while (left >= 0 && !isWord(text[left])) left -= 1
    if (left < 0) return ''
    let right = position
    while (right < text.length && isWord(text[right])) right += 1
    return text.slice(left, right)
  }
  let start = position
  while (start > 0 && isWord(text[start - 1])) start -= 1
  let end = position
  while (end < text.length && isWord(text[end])) end += 1
  return text.slice(start, end)
}

/** 定义形态：返回 [{kind, weight, regex}]，regex 需含一个捕获组交出定义词位置。 */
function definitionPatterns(word) {
  const escaped = escapeRegExp(word)
  return [
    { kind: 'function', weight: 22, regex: new RegExp(`\\bfunction\\s+(${escaped})\\b`) },
    { kind: 'class', weight: 22, regex: new RegExp(`\\bclass\\s+(${escaped})\\b`) },
    { kind: 'def', weight: 22, regex: new RegExp(`\\bdef\\s+(${escaped})\\b`) },
    { kind: 'func', weight: 22, regex: new RegExp(`\\bfunc\\s+(?:\\([^)]*\\)\\s*)?(${escaped})\\s*\\(`) },
    { kind: 'fn', weight: 22, regex: new RegExp(`\\bfn\\s+(${escaped})\\s*\\(`) },
    { kind: 'type', weight: 20, regex: new RegExp(`\\b(?:interface|type|enum|struct|trait|module|namespace|protocol)\\s+(${escaped})\\b`) },
    { kind: 'const', weight: 16, regex: new RegExp(`\\b(?:const|let|var|val)\\s+(${escaped})\\b`) },
    { kind: 'assign', weight: 14, regex: new RegExp(`\\b(${escaped})\\s*=\\s*(?:async\\s+)?(?:function|\\()`) },
    { kind: 'method', weight: 18, regex: new RegExp(`^\\s*(?:(?:public|private|protected|static|final|abstract|async|synchronized|override|virtual|export|default|get|set)\\s+)*[\\w<>\\[\\],\\s.?:*&]+\\s+(${escaped})\\s*\\(`) },
    { kind: 'export', weight: 18, regex: new RegExp(`\\bexport\\s+(?:default\\s+)?(?:const|let|var|function|class|async)\\s+(${escaped})\\b`) },
  ]
}

function pathSegments(relPath) {
  if (relPath === '') return []
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
  return dir === '' ? [] : dir.split('/')
}

function scoreMatch(match, current) {
  let score = match.weight
  if (match.path === current.path) score += 120
  if (extensionOf(match.path) === extensionOf(current.path)) score += 6
  if (current.dir !== '' && match.path.startsWith(`${current.dir}/`)) score += 8
  /* 目录距离：同目录 > 子目录 > 兄弟目录 > 远处目录（项目根是 home 时尤其重要） */
  const currentSegments = pathSegments(current.path)
  const matchSegments = pathSegments(match.path)
  let common = 0
  while (common < currentSegments.length && common < matchSegments.length && currentSegments[common] === matchSegments[common]) common += 1
  const gap = currentSegments.length + matchSegments.length - common * 2
  score += Math.max(0, 20 - gap * 4)
  if (match.kind === 'method' || match.kind === 'function' || match.kind === 'def' || match.kind === 'func' || match.kind === 'fn') score += 4
  if (match.importBoost === true) score += 220
  return score
}

/** 压缩/生成的单行超长文件：定义搜索里排除，避免点到包产物里的同名变量。 */
function isMinifiedText(text) {
  const value = String(text)
  if (value.length < 2000) return false
  const lines = value.split('\n')
  if (lines.length < 12) return true
  let longLines = 0
  const sample = Math.min(lines.length, 200)
  for (let index = 0; index < sample; index += 1) {
    if (lines[index].length > 1200) longLines += 1
  }
  if (longLines >= 1) return true
  return value.length / lines.length > 240
}

/** 解析当前文件的 import/require，得到 标识符 → 模块 spec 的映射。 */
function parseImportMap(text) {
  const map = new Map()
  const source = String(text)
  try {
    let match
    const es = /import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g
    while ((match = es.exec(source)) !== null) {
      const clause = match[1]
      const spec = match[2]
      const named = /\{([^}]*)\}/.exec(clause)
      if (named !== null) {
        for (const part of named[1].split(',')) {
          const raw = part.trim()
          if (raw === '') continue
          const alias = raw.split(/\s+as\s+/).pop().trim()
          if (/^[A-Za-z_$][\w$]*$/.test(alias)) map.set(alias, spec)
        }
      }
      const def = clause.replace(/\{[^}]*\}/g, '').replace(/,/g, ' ').trim().split(/\s+/)[0]
      if (def !== undefined && /^[A-Za-z_$][\w$]*$/.test(def)) map.set(def, spec)
    }
    const cjs = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((match = cjs.exec(source)) !== null) map.set(match[1], match[2])
    const cjsNamed = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((match = cjsNamed.exec(source)) !== null) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s*:\s*/).pop()
        if (/^[A-Za-z_$][\w$]*$/.test(name)) map.set(name, match[2])
      }
    }
  } catch {
    /* ignore */
  }
  return map
}

/** 把相对 import 解析成候选文件路径（不含存在性检查）。 */
function importTargetPaths(currentPath, spec) {
  if (!spec.startsWith('.')) return []
  const baseDir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''
  const raw = `${baseDir}${baseDir === '' ? '' : '/'}${spec}`
  const parts = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const base = parts.join('/')
  return [
    base,
    `${base}.js`, `${base}.ts`, `${base}.jsx`, `${base}.tsx`, `${base}.mjs`, `${base}.cjs`,
    `${base}/index.js`, `${base}/index.ts`, `${base}/index.jsx`, `${base}/index.tsx`,
  ]
}

async function listCandidates(root, textBudgets) {
  /* Git 项目用 git ls-files（尊重 .gitignore、含未跟踪文件），否则 BFS 遍历。 */
  let isGit = false
  try {
    const dotGit = await stat(join(root, '.git'))
    isGit = dotGit.isDirectory() || dotGit.isFile()
  } catch {
    isGit = false
  }
  const files = []
  if (isGit) {
    try {
      const { stdout } = await runCommand('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 12000,
      })
      for (const rel of stdout.split('\0')) {
        if (rel === '' || isExcludedDir(rel.split('/').pop() ?? '')) continue
        if (SKIP_EXT.has(extensionOf(rel))) continue
        files.push(rel)
        if (files.length >= MAX_SCANNED) break
      }
      files.sort((a, b) => a.localeCompare(b))
      return files
    } catch {
      /* 回退目录遍历 */
    }
  }
  const queue = ['']
  let head = 0
  while (head < queue.length && files.length < MAX_SCANNED) {
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
        if (!isExcludedDir(entry.name)) queue.push(dirRel === '' ? entry.name : `${dirRel}/${entry.name}`)
        continue
      }
      if (!entry.isFile()) continue
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`
      if (SKIP_EXT.has(extensionOf(rel))) continue
      files.push(rel)
      if (files.length >= MAX_SCANNED) break
    }
  }
  void textBudgets
  return files
}

/** 项目内相对路径解析（只读场景：拒绝绝对路径与 .. 逃逸）。 */
async function resolveInsideProject(root, raw) {
  if (typeof raw !== 'string') throw badRequest('path must be a string')
  if (isAbsolute(raw)) throw new ApiError('path-invalid', '不允许绝对路径', 400)
  const absolute = resolve(root, raw === '' ? '.' : raw)
  const rel = relative(root, absolute)
  if (rel !== '' && (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel))) {
    throw new ApiError('path-outside', '路径超出项目范围', 403)
  }
  return absolute
}

/** 在一段文本里找 word 的所有声明位置。 */
function findDefinitionsInText(text, relPath, word, patterns, results, current) {
  if (results.length >= MAX_MATCHES) return
  const lines = String(text).split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.includes(word)) continue
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line)
      if (match === null) continue
      const column = (match.index ?? 0) + match[0].indexOf(match[1]) + 1
      results.push({
        path: relPath,
        line: index + 1,
        column: Math.max(1, column),
        kind: pattern.kind,
        weight: pattern.weight,
        preview: line.trim().slice(0, 160),
        score: 0,
      })
      break
    }
    if (results.length >= MAX_MATCHES) return
  }
  void current
}

export async function definition(body, env) {
    const project = env.projects.ensure(typeof body.root === 'string' ? body.root : '')
    const root = project.root
    const rawPath = typeof body.path === 'string' ? body.path : ''
    if (rawPath === '') throw badRequest('path is required')
    const line = Number(body.line)
    const column = Number(body.column)
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) throw badRequest('line/column is invalid')
    const absolute = await resolveInsideProject(root, rawPath)
    const relPath = relative(root, absolute).split(sep).join('/')
    let text = ''
    if (typeof body.content === 'string' && Buffer.byteLength(body.content, 'utf8') <= 4 * 1024 * 1024) {
      text = body.content
    } else {
      try {
        const info = await stat(absolute)
        if (info.size <= 4 * 1024 * 1024) text = await readFile(absolute, 'utf8')
      } catch {
        text = ''
      }
    }
    const lines = text.split(/\r?\n/)
    const lineText = lines[line - 1] ?? ''
    let word = typeof body.word === 'string' ? body.word.trim() : ''
    if (word === '') word = extractWord(lineText, column)
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(word) || word.length < 2 || word.length > 80) {
      return { word, matches: [], current: { path: relPath, line, column } }
    }
    const patterns = definitionPatterns(word)
    const startedAt = Date.now()
    const current = { path: relPath, dir: relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '' }
    /* import 解析：命中导入来源的文件给高权重，避免在 home 根目录这种大项目里点到同名变量 */
    const importMap = parseImportMap(text)
    const importedSpec = importMap.get(word)
    const importTargets = new Set(importedSpec === undefined ? [] : importTargetPaths(relPath, importedSpec))
    const results = []
    /* 1) 当前文件（用编辑器传来的内容，能命中未保存的改动） */
    findDefinitionsInText(text, relPath, word, patterns, results, current)
    /* 2) 项目其它文件 */
    const candidates = await listCandidates(root, null)
    for (const candidate of candidates) {
      if (candidate === relPath) continue
      if (results.length >= MAX_MATCHES) break
      if (Date.now() - startedAt > TIME_BUDGET) break
      const candidateAbs = join(root, candidate)
      const info = await stat(candidateAbs).catch(() => undefined)
      if (info === undefined || !info.isFile() || info.size > MAX_FILE_SIZE) continue
      let buffer
      try {
        buffer = await readFile(candidateAbs)
      } catch {
        continue
      }
      if (buffer.includes(0)) continue
      const candidateText = buffer.toString('utf8')
      if (!candidateText.includes(word)) continue
      if (isMinifiedText(candidateText)) continue
      findDefinitionsInText(candidateText, candidate, word, patterns, results, current)
    }
    /* 去重 + 打分 + 排序 */
    const seen = new Set()
    const matches = []
    for (const item of results) {
      const key = `${item.path}:${item.line}:${item.column}`
      if (seen.has(key)) continue
      seen.add(key)
      const candidate = { ...item, importBoost: importTargets.has(item.path) }
      matches.push({
        path: item.path,
        line: item.line,
        column: item.column,
        kind: item.kind,
        preview: item.preview,
        score: scoreMatch(candidate, current),
      })
    }
    matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line)
    return {
      word,
      matches: matches.slice(0, MAX_MATCHES),
      current: { path: relPath, line, column },
      truncated: matches.length > MAX_MATCHES,
    }
}

function insideProject(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * 会话里的文件引用（`tasks.js:165`、`engine/x/service.js`）解析成项目内相对路径。
 * 支持完整相对路径、以 / 结尾的部分路径、纯 basename；多个同名时优先当前文件同目录、层级更浅的。
 */
export async function resolvePath(body, env) {
  const project = env.projects.ensure(typeof body.root === 'string' ? body.root : '')
  const root = project.root
  let hint = String(body.path ?? '').trim()
  if (hint === '') return { path: null, matches: [] }
  /* 会话里的文件引用在 Windows 上可能是 file:///C:/... 或反斜杠绝对路径；
     统一转成 node 能识别的路径，并去掉 file:// 前导和驱动器前的多余斜杠。 */
  if (/^file:\/\//i.test(hint)) {
    hint = hint.replace(/^file:\/\//i, '')
    try { hint = decodeURIComponent(hint) } catch { /* ignore */ }
  }
  hint = hint.replace(/\\/g, '/').trim()
  if (/^\/[A-Za-z]:\//.test(hint)) hint = hint.slice(1)
  if (hint.startsWith('./')) hint = hint.slice(2)
  if (hint === '') return { path: null, matches: [] }
  if (isAbsolute(hint)) {
    const absolute = resolve(hint)
    if (!insideProject(root, absolute)) return { path: null, matches: [] }
    hint = relative(root, absolute).split(sep).join('/')
  }
  hint = hint.replace(/^\/+/, '')
  if (hint === '' || hint.includes('..')) return { path: null, matches: [] }
  const candidates = await listCandidates(root, null)
  const activePath = String(body.activePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  const activeDir = activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : ''
  let pool = candidates.filter((candidate) => candidate === hint)
  if (pool.length === 0) pool = candidates.filter((candidate) => candidate.endsWith(`/${hint}`) || candidate.split('/').pop() === hint)
  pool = [...new Set(pool)]
  pool.sort((a, b) => {
    const aNear = activeDir !== '' && a.startsWith(`${activeDir}/`) ? 0 : 1
    const bNear = activeDir !== '' && b.startsWith(`${activeDir}/`) ? 0 : 1
    if (aNear !== bNear) return aNear - bNear
    const depthDiff = a.split('/').length - b.split('/').length
    if (depthDiff !== 0) return depthDiff
    return a.localeCompare(b)
  })
  if (pool.length === 0) return { path: null, matches: [] }
  return { path: pool[0], matches: pool.slice(0, 10) }
}

export function register(router, env) {
  router.method('code.definition', (body) => definition(body, env))
  router.method('code.resolvePath', (body) => resolvePath(body, env))
}

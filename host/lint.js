/**
 * JS/TS 诊断（语法错误 + 未定义变量等语义错误）：Host 侧用 TypeScript 编译器
 * 直接分析当前编辑内容，返回 Monaco marker 需要的行列信息。
 *
 * 不用 Monaco 的 TS worker：桌面壳页面是 dsh-app:// 自定义协议，worker 里
 * importScripts 自定义协议资源会失败，导致语法/语义诊断时有时无；Host 侧
 * 编译结果稳定，且可以随插件依赖（typescript）一起分发。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { ESLint } from 'eslint'
import ts from 'typescript'

import { ApiError, badRequest } from './context.js'

const IGNORED_CODES = new Set([
  2307, // Cannot find module（项目的模块解析/依赖不一定完整，避免盖住真正的错误）
  2792,
  7016,
  2688,
  1479,
  2580, // Cannot find name 'require' 等（由 globals shim 兜底，仍兜不住时静默）
])

/** 只保留用户真正需要的语义诊断：未定义变量（2304/2552）等；
 *  属性类型不匹配（2339 等）在动态 JS/JSON 配置项目里误报太多，直接不展示。 */
const SEMANTIC_CODES = new Set([2304, 2552, 2448, 2454])

const GLOBALS_FILE = '/__gufa_code_globals__.d.ts'
const GLOBALS_TEXT = [
  'declare var process: any;',
  'declare var require: any;',
  'declare var module: any;',
  'declare var exports: any;',
  'declare var __dirname: string;',
  'declare var __filename: string;',
  'declare var Buffer: any;',
  'declare var global: any;',
  'declare function setTimeout(handler: any, timeout?: any, ...args: any[]): any;',
  'declare function clearTimeout(handle?: any): void;',
  'declare function setInterval(handler: any, timeout?: any, ...args: any[]): any;',
  'declare function clearInterval(handle?: any): void;',
  'declare function setImmediate(handler: any, ...args: any[]): any;',
  'declare function clearImmediate(handle?: any): void;',
  '',
].join('\n')

function canonical(file) {
  return resolve(file)
}

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function severityOf(category) {
  if (category === ts.DiagnosticCategory.Error) return 1
  if (category === ts.DiagnosticCategory.Warning) return 0
  return 2
}

async function diagnoseWithTsc(body, env) {
  if (typeof body.root !== 'string' || body.root === '') throw badRequest('root is required')
  const project = env.projects.ensure(body.root)
  const root = project.root
  const rawPath = typeof body.path === 'string' ? body.path : ''
  if (rawPath === '') throw badRequest('path is required')
  const absolute = resolve(root, rawPath)
  if (!inside(root, absolute)) throw new ApiError('path-outside', '路径超出项目范围', 403)
  const extension = rawPath.split('.').pop()?.toLowerCase() ?? ''
  if (!['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].includes(extension)) return { diagnostics: [] }
  let content = typeof body.content === 'string' ? body.content : ''
  if (content === '') {
    try {
      content = await readFile(absolute, 'utf8')
    } catch {
      throw new ApiError('not-found', `文件不存在：${rawPath}`, 404)
    }
  }

  const virtual = new Map([
    [canonical(absolute), content],
    [GLOBALS_FILE, GLOBALS_TEXT],
  ])
  const options = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.Preserve,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    strict: false,
    noImplicitAny: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    types: [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    allowNonTsExtensions: true,
    baseUrl: root,
  }
  const nodeHost = ts.createCompilerHost(options)
  const host = {
    ...nodeHost,
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const file = canonical(fileName)
      if (virtual.has(file)) return ts.createSourceFile(file, virtual.get(file), languageVersion ?? ts.ScriptTarget.Latest, true)
      return nodeHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
    },
    readFile(fileName) {
      const file = canonical(fileName)
      if (virtual.has(file)) return virtual.get(file)
      return nodeHost.readFile(fileName)
    },
    fileExists(fileName) {
      const file = canonical(fileName)
      if (virtual.has(file)) return true
      return nodeHost.fileExists(fileName)
    },
    getCurrentDirectory: () => root,
    getCanonicalFileName: (fileName) => canonical(fileName),
  }

  /* 解析本地 import，拼成一个小 Program；这样跨文件定义/未定义变量判断更准。 */
  const rootNames = [absolute, GLOBALS_FILE]
  const seen = new Set([canonical(absolute), GLOBALS_FILE])
  const queue = [canonical(absolute)]
  while (queue.length > 0 && seen.size <= 40) {
    const file = queue.shift()
    const text = virtual.get(file) ?? ts.sys.readFile(file)
    if (typeof text !== 'string') continue
    let pre = null
    try {
      pre = ts.preProcessFile(text, true, true)
    } catch {
      continue
    }
    const references = [...(pre.importedFiles ?? []), ...(pre.referencedFiles ?? [])]
    for (const reference of references) {
      try {
        const resolution = ts.resolveModuleName(reference.fileName, file, options, {
          fileExists: host.fileExists,
          readFile: host.readFile,
        })
        const resolved = resolution.resolvedModule?.resolvedFileName
        if (typeof resolved !== 'string' || resolved === '') continue
        if (!inside(root, resolved)) continue
        const key = canonical(resolved)
        if (seen.has(key)) continue
        seen.add(key)
        rootNames.push(key)
        queue.push(key)
      } catch {
        /* 单个 import 解析失败不影响其它诊断 */
      }
    }
  }

  const program = ts.createProgram(rootNames, options, host)
  const sourceFile = program.getSourceFile(canonical(absolute))
  if (sourceFile === undefined || sourceFile === null) return { diagnostics: [] }
  /* 语法错误全保留；语义只保留「未定义变量」这类，避免动态 JS 项目的类型误报 */
  const syntactic = program.getSyntacticDiagnostics(sourceFile)
  const semantic = program.getSemanticDiagnostics(sourceFile).filter((diagnostic) => SEMANTIC_CODES.has(Number(diagnostic.code)))
  const collected = [...syntactic, ...semantic]
  const diagnostics = []
  const seenDiagnostics = new Set()
  for (const diagnostic of collected) {
    const code = Number(diagnostic.code)
    if (IGNORED_CODES.has(code)) continue
    const start = typeof diagnostic.start === 'number' ? diagnostic.start : 0
    const length = typeof diagnostic.length === 'number' ? diagnostic.length : 0
    const startPosition = ts.getLineAndCharacterOfPosition(sourceFile, start)
    const endPosition = ts.getLineAndCharacterOfPosition(sourceFile, start + length)
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const key = `${code}:${start}:${message}`
    if (seenDiagnostics.has(key)) continue
    seenDiagnostics.add(key)
    diagnostics.push({
      severity: severityOf(diagnostic.category),
      message,
      code,
      line: startPosition.line + 1,
      column: startPosition.character + 1,
      endLine: endPosition.line + 1,
      endColumn: endPosition.character + 1,
    })
    if (diagnostics.length >= 200) break
  }
  return { diagnostics }
}

const FLAT_CONFIG_FILES = ['eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs']
const LEGACY_CONFIG_FILES = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml']
const eslintCache = new Map()

function configSignature(root) {
  const parts = []
  for (const name of [...FLAT_CONFIG_FILES, ...LEGACY_CONFIG_FILES, 'package.json']) {
    const file = join(root, name)
    try {
      parts.push(`${name}:${statSync(file).mtimeMs}`)
    } catch {
      /* ignore */
    }
  }
  return parts.join('|')
}

function hasLegacyRegexConfig(root) {
  for (const name of LEGACY_CONFIG_FILES) {
    if (existsSync(join(root, name))) return true
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return pkg !== null && typeof pkg === 'object' && pkg.eslintConfig !== undefined
  } catch {
    return false
  }
}

function fallbackEslintConfig() {
  return {
    env: { browser: true, node: true, es2022: true },
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
    },
  }
}

/** 优先用项目自己的 eslint（支持 eslint.config.js / 自定义规则），否则用插件内置 ESLint。 */
async function getEslint(root) {
  const signature = configSignature(root)
  const cached = eslintCache.get(root)
  if (cached !== undefined && cached.signature === signature) return cached.instance
  let instance = null
  const flatConfig = FLAT_CONFIG_FILES.find((name) => existsSync(join(root, name)))
  if (flatConfig !== undefined) {
    try {
      const projectRequire = createRequire(join(root, 'package.json'))
      const projectModule = projectRequire('eslint')
      const ProjectESLint = projectModule?.ESLint
      if (typeof ProjectESLint === 'function') {
        instance = new ProjectESLint({ cwd: root, errorOnUnmatchedPattern: false })
      }
    } catch {
      instance = null
    }
  }
  if (instance === null) {
    try {
      const legacy = hasLegacyRegexConfig(root) || flatConfig !== undefined
      instance = new ESLint({
        cwd: root,
        useEslintrc: true,
        errorOnUnmatchedPattern: false,
        resolvePluginsRelativeTo: root,
        ...(legacy ? {} : { overrideConfig: fallbackEslintConfig() }),
      })
    } catch {
      instance = null
    }
  }
  eslintCache.set(root, { signature, instance })
  return instance
}

async function eslintDiagnostics(root, absolute, content) {
  const eslint = await getEslint(root)
  if (eslint === null || eslint === undefined) return null
  let results = []
  try {
    results = await eslint.lintText(content, { filePath: absolute, warnIgnored: false })
  } catch {
    return null
  }
  const result = Array.isArray(results) ? results[0] : null
  if (result === null || result === undefined) return []
  const diagnostics = []
  const seen = new Set()
  for (const message of Array.isArray(result.messages) ? result.messages : []) {
    if (message === null || typeof message !== 'object') continue
    if (Number(message.severity) < 1) continue
    const ruleId = typeof message.ruleId === 'string' && message.ruleId !== '' ? message.ruleId : (message.fatal === true ? 'parsing-error' : 'eslint')
    const line = Math.max(1, Math.trunc(Number(message.line) || 1))
    const column = Math.max(1, Math.trunc(Number(message.column) || 1))
    const endLine = Math.max(line, Math.trunc(Number(message.endLine) || line))
    const endColumn = Math.max(column + 1, Math.trunc(Number(message.endColumn) || (column + 1)))
    const text = String(message.message ?? '')
    const key = `${ruleId}:${line}:${column}:${text}`
    if (seen.has(key)) continue
    seen.add(key)
    diagnostics.push({
      severity: Number(message.severity) === 2 ? 1 : 0,
      message: text,
      code: ruleId,
      line,
      column,
      endLine,
      endColumn,
    })
    if (diagnostics.length >= 200) break
  }
  return diagnostics
}

export async function diagnose(body, env) {
  if (typeof body.root !== 'string' || body.root === '') throw badRequest('root is required')
  const project = env.projects.ensure(body.root)
  const root = project.root
  const rawPath = typeof body.path === 'string' ? body.path : ''
  if (rawPath === '') throw badRequest('path is required')
  const absolute = resolve(root, rawPath)
  if (!inside(root, absolute)) throw new ApiError('path-outside', '路径超出项目范围', 403)
  const extension = rawPath.split('.').pop()?.toLowerCase() ?? ''
  if (!['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].includes(extension)) return { diagnostics: [] }
  let content = typeof body.content === 'string' ? body.content : ''
  if (content === '') {
    try {
      content = await readFile(absolute, 'utf8')
    } catch {
      throw new ApiError('not-found', `文件不存在：${rawPath}`, 404)
    }
  }
  /* JS/JSX 用 ESLint（尊重项目 .eslintrc / eslint.config.js 的 globals、rules、插件）；
     TS/TSX 仍用 TypeScript 编译器（ESLint 默认 parser 不解析 TS 语法）。 */
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) {
    try {
      const diagnostics = await eslintDiagnostics(root, absolute, content)
      if (diagnostics !== null) return { diagnostics }
    } catch {
      /* 配置/插件加载失败时回落 tsc，避免完全没诊断 */
    }
  }
  return diagnoseWithTsc(body, env)
}

export function registerLint(router, env) {
  router.method('lint.javascript', (body) => diagnose(body, env))
}

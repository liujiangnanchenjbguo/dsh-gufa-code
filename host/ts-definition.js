/**
 * JS/TS 定义解析（供 Monaco 原生 DefinitionProvider / F12 / Cmd+点击使用）。
 *
 * 和 host/lint.js 一样把当前编辑内容 + 本地 import 组成一个 TypeScript Program，
 * 但这里用 LanguageService 的 getDefinitionAtPosition：比原来的正则项目搜索准确，
 * 不会再因为同名函数/变量跳到别的文件。
 */
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

import { ApiError, badRequest } from './context.js'

const GLOBALS_FILE = '/__gufa_code_tsdef_globals__.d.ts'
const GLOBALS_TEXT = 'declare var process: any;\ndeclare var require: any;\ndeclare var module: any;\ndeclare var exports: any;\n'

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function compilerOptions(root) {
  return {
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
    types: [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    allowNonTsExtensions: true,
    baseUrl: root,
  }
}

function collectScriptFiles(root, currentAbsolute, currentContent) {
  const virtual = new Map([[currentAbsolute, currentContent], [GLOBALS_FILE, GLOBALS_TEXT]])
  const scriptFiles = [currentAbsolute, GLOBALS_FILE]
  const seen = new Set(scriptFiles)
  const queue = [currentAbsolute]
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
    const specs = [...(pre.importedFiles ?? []), ...(pre.referencedFiles ?? [])]
    for (const spec of specs) {
      try {
        const resolution = ts.resolveModuleName(spec.fileName, file, compilerOptions(root), {
          fileExists: ts.sys.fileExists,
          readFile: ts.sys.readFile,
        })
        const resolved = resolution.resolvedModule?.resolvedFileName
        if (typeof resolved !== 'string' || resolved === '' || !inside(root, resolved)) continue
        const key = resolve(resolved)
        if (seen.has(key)) continue
        seen.add(key)
        scriptFiles.push(key)
        queue.push(key)
      } catch {
        /* ignore */
      }
    }
  }
  return { scriptFiles, virtual }
}

export async function tsDefinition(body, env) {
  if (typeof body.root !== 'string' || body.root === '') throw badRequest('root is required')
  const project = env.projects.ensure(body.root)
  const root = project.root
  const rawPath = typeof body.path === 'string' ? body.path : ''
  if (rawPath === '') throw badRequest('path is required')
  const absolute = resolve(root, rawPath)
  if (!inside(root, absolute)) throw new ApiError('path-outside', '路径超出项目范围', 403)
  const extension = rawPath.split('.').pop()?.toLowerCase() ?? ''
  if (!['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].includes(extension)) return { matches: [] }
  const line = Math.max(1, Math.trunc(Number(body.line) || 1))
  const column = Math.max(1, Math.trunc(Number(body.column) || 1))
  let content = typeof body.content === 'string' ? body.content : ''
  if (content === '') {
    try {
      content = await readFile(absolute, 'utf8')
    } catch {
      throw new ApiError('not-found', `文件不存在：${rawPath}`, 404)
    }
  }

  const { scriptFiles, virtual } = collectScriptFiles(root, absolute, content)
  const options = compilerOptions(root)
  const host = {
    getScriptFileNames: () => scriptFiles,
    getScriptVersion: (fileName) => (virtual.has(resolve(fileName)) ? '1' : '0'),
    getScriptSnapshot: (fileName) => {
      const key = resolve(fileName)
      const text = virtual.get(key) ?? ts.sys.readFile(key)
      if (text === undefined) return undefined
      return ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (compileOptions) => ts.getDefaultLibFilePath(compileOptions),
    fileExists: (fileName) => virtual.has(resolve(fileName)) || ts.sys.fileExists(fileName),
    readFile: (fileName) => virtual.get(resolve(fileName)) ?? ts.sys.readFile(fileName),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n',
  }
  let languageService = null
  try {
    languageService = ts.createLanguageService(host)
  } catch {
    languageService = null
  }
  if (languageService === null) return { matches: [] }
  let definitions = []
  try {
    const program = languageService.getProgram()
    const sourceFile = program?.getSourceFile(absolute)
    if (sourceFile === undefined || sourceFile === null) return { matches: [] }
    const offset = ts.getPositionOfLineAndCharacter(sourceFile, Math.min(sourceFile.getLineStarts().length - 1, line - 1), column - 1)
    definitions = languageService.getDefinitionAtPosition(absolute, offset) ?? []
  } catch {
    definitions = []
  }
  const libDir = dirname(ts.getDefaultLibFilePath(options))
  const matches = []
  const seen = new Set()
  for (const definition of definitions) {
    if (definition === null || definition === undefined) continue
    const fileName = resolve(definition.fileName)
    const internal = inside(root, fileName)
    /* 项目内定义正常返回；TS 内置 lib（parseInt/Promise 等）也返回，
       客户端会以只读标签打开 node_modules/typescript/lib/*.d.ts。 */
    if (!internal && !inside(libDir, fileName)) continue
    let defSource = null
    try {
      defSource = languageService.getProgram()?.getSourceFile(fileName)
    } catch {
      defSource = null
    }
    if (defSource === undefined || defSource === null) continue
    const start = Math.max(0, Number(definition.textSpan?.start) || 0)
    const position = ts.getLineAndCharacterOfPosition(defSource, start)
    const path = internal ? relative(root, fileName).split(sep).join('/') : relative(libDir, fileName).split(sep).join('/')
    const key = `${internal ? 'in' : 'lib'}:${fileName}:${position.line + 1}:${position.character + 1}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({
      path,
      absolutePath: internal ? undefined : fileName,
      external: internal ? undefined : true,
      line: position.line + 1,
      column: position.character + 1,
      kind: internal ? 'lsp' : 'lib',
      preview: internal ? '' : `typescript/lib/${path}`,
      score: internal ? 1000 : 900,
    })
    if (matches.length >= 8) break
  }
  return { matches }
}

const LIB_EXTENSIONS = new Set(['.d.ts', '.ts', '.js'])

/** 只读打开 TypeScript 内置 lib（parseInt/Promise/Array 等定义）用。 */
export async function readTsLib(body) {
  const libDir = dirname(ts.getDefaultLibFilePath({}))
  const libName = typeof body.libName === 'string' ? body.libName.trim() : ''
  const rawPath = typeof body.absolutePath === 'string' ? body.absolutePath : ''
  let absolute = ''
  if (libName !== '') {
    if (!/^lib\.[A-Za-z0-9._-]+\.d\.ts$/.test(libName)) throw new ApiError('forbidden', '非法的 TypeScript lib 名称', 403)
    absolute = resolve(libDir, libName)
  } else {
    if (rawPath === '') throw new ApiError('bad-request', 'absolutePath is required', 400)
    absolute = resolve(rawPath)
  }
  if (!inside(libDir, absolute)) throw new ApiError('forbidden', '只允许读取 TypeScript 内置 lib 文件', 403)
  const extension = absolute.slice(absolute.lastIndexOf('.')).toLowerCase()
  if (!LIB_EXTENSIONS.has(extension)) throw new ApiError('forbidden', '不允许的文件类型', 403)
  const content = await readFile(absolute, 'utf8')
  return {
    content,
    language: 'typescript',
    absolutePath: absolute,
    name: absolute.slice(absolute.lastIndexOf('/') + 1),
  }
}

export function registerTsDefinition(router, env) {
  router.method('code.tsDefinition', (body) => tsDefinition(body, env))
  router.method('code.readTsLib', (body) => readTsLib(body))
}

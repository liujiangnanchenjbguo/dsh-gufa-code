/**
 * 终端 PTY 的纯工具层：与 Cordis / node-pty 无关，便于单测。
 *
 * 提供：
 *   - filteredEnvironment()  过滤敏感环境变量后交给 PTY（KEY/TOKEN/SECRET/…）
 *   - ReplayBuffer           按 UTF-8 字节计量的输出回放缓冲（默认 2MB），支持 since 增量续传
 *   - clampInteger()         cols / rows 规范化
 *   - resolveShellPath()     选择登录 shell（显式参数 → provider 默认 → $SHELL → 平台默认）
 *
 * 这些逻辑被 host/terminal.js 使用，并由 scripts/selftest-terminal.mjs 覆盖。
 */
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** 传给 PTY 的 TERM；subprocess 会把同一值写入终端环境。 */
export const TERMINAL_TYPE = 'xterm-256color'
/** 每个项目根目录下最多保留的终端数。 */
export const MAX_TERMINALS_PER_ROOT = 8
/** 每个终端的输出回放缓冲上限（字节，按解码后的 UTF-8 计）。 */
export const REPLAY_LIMIT_BYTES = 2 * 1024 * 1024
/** PTY 终止宽限（TERM → KILL）。 */
export const TERMINAL_GRACE_MS = 5000
/** 终端创建请求的默认 / 边界尺寸。 */
export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24
export const MIN_COLS = 2
export const MAX_COLS = 1000
export const MIN_ROWS = 2
export const MAX_ROWS = 500

/**
 * 敏感环境变量名：不传给终端 shell。
 * 按「名字边界」匹配，避免误伤 MONKEY / KEYBOARD 之类普通变量；
 * 同时保留 SSH_AUTH_SOCK、GIT_AUTHOR_* 等交互式 shell 常用变量。
 */
export const SENSITIVE_ENV_PATTERN = /(^|_)(API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY)(_|$)/i
/** DSH 内部变量不暴露给终端 shell。 */
export const DSH_ENV_PREFIX = 'DSH_'

/**
 * 生成传给 PTY 的环境变量：过滤敏感名与 DSH_*，其余原样保留（HOME/PATH/LANG/SHELL…）。
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {Record<string, string>}
 */
export function filteredEnvironment(base = process.env) {
  /** @type {Record<string, string>} */
  const env = {}
  for (const [name, value] of Object.entries(base)) {
    if (typeof value !== 'string') continue
    if (name.toUpperCase().startsWith(DSH_ENV_PREFIX)) continue
    if (SENSITIVE_ENV_PATTERN.test(name)) continue
    env[name] = value
  }
  env.TERM = TERMINAL_TYPE
  if (env.COLORTERM === undefined) env.COLORTERM = 'truecolor'
  return env
}

/** 把任意输入规范成 [min, max] 内的整数；非法值返回 fallback。 */
export function clampInteger(value, fallback, min, max) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

/** 判断一个码元是否为 UTF-16 低代理项（避免按字节截断时切坏字符）。 */
function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff
}

/** 取字符串尾部不超过 limit 字节的最长片段（按 UTF-8，尽量不切坏字符）。 */
export function tailByBytes(text, limit) {
  if (limit <= 0) return ''
  if (Buffer.byteLength(text, 'utf8') <= limit) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (Buffer.byteLength(text.slice(middle), 'utf8') > limit) low = middle + 1
    else high = middle
  }
  if (low > 0 && isLowSurrogate(text.charCodeAt(low))) low += 1
  return text.slice(low)
}

/**
 * 按 UTF-8 字节计量的输出回放缓冲。
 *
 * 语义：
 *   - totalBytes 是「历史上写入过的全部文本字节数」，即绝对偏移；
 *   - 只保留最新 limitBytes 字节；retainedStart 是保留窗口的绝对起始偏移；
 *   - sliceFrom(offset) 返回从绝对偏移 offset 开始的可续传文本；若 offset 已滑出窗口
 *     或落点非法，返回 { lossy: true, text: 完整保留窗口 }，调用方应先让客户端 reset。
 */
export class ReplayBuffer {
  /** @type {{ text: string, bytes: number, start: number }[]} */
  #entries = []
  #bytes = 0
  #totalBytes = 0

  constructor(limitBytes = REPLAY_LIMIT_BYTES) {
    this.limitBytes = Number.isSafeInteger(limitBytes) && limitBytes > 0 ? limitBytes : REPLAY_LIMIT_BYTES
  }

  /** 保留窗口的字节数。 */
  get retainedBytes() {
    return this.#bytes
  }

  /** 保留窗口的绝对起始偏移。 */
  get retainedStart() {
    return this.#entries.length === 0 ? this.#totalBytes : this.#entries[0].start
  }

  /** 历史写入的总字节数（绝对偏移上界）。 */
  get totalBytes() {
    return this.#totalBytes
  }

  get size() {
    return this.#entries.length
  }

  /** 追加一段解码后的输出。 */
  push(text) {
    if (typeof text !== 'string' || text === '') return
    const bytes = Buffer.byteLength(text, 'utf8')
    this.#totalBytes += bytes
    if (bytes >= this.limitBytes) {
      const tail = tailByBytes(text, this.limitBytes)
      const tailBytes = Buffer.byteLength(tail, 'utf8')
      this.#entries = [{ text: tail, bytes: tailBytes, start: this.#totalBytes - tailBytes }]
      this.#bytes = tailBytes
      return
    }
    this.#entries.push({ text, bytes, start: this.#totalBytes - bytes })
    this.#bytes += bytes
    while (this.#bytes > this.limitBytes && this.#entries.length > 1) {
      const removed = this.#entries.shift()
      this.#bytes -= removed.bytes
    }
  }

  /** 返回保留窗口内的完整文本。 */
  toString() {
    return this.#entries.map((entry) => entry.text).join('')
  }

  /**
   * 从绝对偏移 offset 续传。
   * @param {number} offset
   * @returns {{ text: string, lossy: boolean }}
   */
  sliceFrom(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.#totalBytes) {
      return { text: this.toString(), lossy: true }
    }
    if (offset === this.#totalBytes) return { text: '', lossy: false }
    const start = this.retainedStart
    if (offset < start) return { text: this.toString(), lossy: true }
    for (let index = 0; index < this.#entries.length; index += 1) {
      const entry = this.#entries[index]
      if (entry.start !== offset) continue
      return { text: this.#entries.slice(index).map((item) => item.text).join(''), lossy: false }
    }
    // 偏移落在某个 chunk 内部（正常流式下不会出现；仅当调用方计数与写入边界不一致时兜底）。
    for (let index = 0; index < this.#entries.length; index += 1) {
      const entry = this.#entries[index]
      if (offset < entry.start || offset > entry.start + entry.bytes) continue
      const within = Buffer.from(entry.text, 'utf8')
      const tail = within.subarray(offset - entry.start).toString('utf8')
      return { text: [tail, ...this.#entries.slice(index + 1).map((item) => item.text)].join(''), lossy: false }
    }
    return { text: this.toString(), lossy: true }
  }

  /** 清空（历史绝对偏移保持不变，避免正在重连的客户端错位）。 */
  clear() {
    this.#entries = []
    this.#bytes = 0
  }
}

/** 默认的「文件存在且是普通文件」判断。 */
async function defaultFileExists(path) {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

/**
 * 选择交互式登录 shell：显式参数 → provider 的默认 shell → $SHELL → 平台默认。
 * @param {{ explicit?: unknown, preferred?: unknown, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, exists?: (path: string) => Promise<boolean> }} [options]
 * @returns {Promise<string>}
 */
export async function resolveShellPath(options = {}) {
  const {
    explicit,
    preferred,
    env = process.env,
    platform = process.platform,
    exists = defaultFileExists,
  } = options
  const usable = async (value) => {
    if (typeof value !== 'string') return false
    const candidate = value.trim()
    if (candidate === '' || !isAbsolute(candidate)) return false
    try {
      return await exists(candidate)
    } catch {
      return false
    }
  }
  if (await usable(explicit)) return explicit.trim()
  if (await usable(preferred)) return preferred.trim()
  if (await usable(env.SHELL)) return env.SHELL.trim()
  if (platform === 'win32') {
    const comspec = typeof env.COMSPEC === 'string' && env.COMSPEC !== '' ? env.COMSPEC : 'powershell.exe'
    return comspec
  }
  return platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

/** 登录 shell 的参数：POSIX 用 `-l`，Windows 关闭 logo。 */
export function terminalShellArgs(platform = process.platform) {
  return platform === 'win32' ? ['-NoLogo'] : ['-l']
}

/** 终端标签标题：shell 可执行文件名（兼容 PATH 分隔符差异，去掉 .exe）。 */
export function terminalTitleFor(shellPath) {
  const base = String(shellPath ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const trimmed = base.endsWith('.exe') ? base.slice(0, -4) : base
  return trimmed === '' ? 'shell' : trimmed
}

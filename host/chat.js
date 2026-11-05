/**
 * AI 聊天能力：默认模型信息 + SSE 流式对话。
 *
 * 路由（挂在 /gufa-code/api 下，鉴权、SSE 帧格式见 host/context.js）：
 *   POST chat.info    → { provider, model, ready }
 *   POST chat.stream  → text/event-stream，每帧 data: <json>：
 *     { type: 'thinking' }                      模型开始思考（收到第一段 reasoning 时发一次）
 *     { type: 'delta', text }                   正文增量
 *     { type: 'done' }                          正常结束
 *     { type: 'error', message, code? }         失败 / 超时 / 服务不可用
 *
 * 请求体：
 *   {
 *     messages: [{ role: 'user' | 'assistant', content: string }],   // 由旧到新，最后一条是本次提问
 *     context: { root?, path?, content?, language?, selection?, selectionPath?, selectionLine? },
 *     provider?, model?                                              // 可选覆盖默认模型
 *   }
 *
 * 实现要点：
 *   - 默认模型取 Host 的 agentDefaultModel.currentSelection()（profile 里为
 *     deepseek-official / deepseek-flash），取不到时回落同一对值。
 *   - llm 的 messages 只接受 durable Message / 请求态 user 输入，因此把「系统提示 + 代码上下文 +
 *     最近对话 + 当前问题」压成单条 user 文本（content: [{ type: 'text', text }]），最稳妥。
 *   - 单次请求 120 秒超时；客户端取消（SSE 断开 / req aborted）时静默结束，不报错。
 *   - 所有异常都转成 error 事件，保证客户端一定能收到终止事件。
 *
 * 注意：本模块不 import host/context.js，便于在 Node 里直接单测纯函数与 register 行为。
 */

/** 默认模型的兜底值：与本机 profile 的 agent-default-model 配置保持一致。 */
const FALLBACK_PROVIDER = 'deepseek-official'
const FALLBACK_MODEL = 'deepseek-flash'

/** 单次请求超时（毫秒）。env.chatTimeoutMs 可覆盖（仅用于测试/自部署调参）。 */
export const CHAT_TIMEOUT_MS = 120_000

/** 代码上下文截断上限（字符）。选中代码优先，有选中时代码正文收紧。 */
const CONTEXT_SELECTION_LIMIT = 20_000
const CONTEXT_FILE_LIMIT = 20_000
const CONTEXT_FILE_LIMIT_WITH_SELECTION = 12_000
/** 极端输入先硬截断，避免在巨型字符串上做额外处理。 */
const CONTEXT_HARD_LIMIT = 200_000

/** 对话历史预算：最多携带最近多少条、总字符上限、单条字符上限。 */
const HISTORY_MESSAGE_LIMIT = 24
const HISTORY_CHAR_LIMIT = 40_000
const MESSAGE_CHAR_LIMIT = 8_000
/** 当前问题的截断上限。 */
const QUESTION_LIMIT = 20_000
/** 请求体里最多接受的原始消息条数（只取最后这些条）。 */
const MAX_INPUT_MESSAGES = 200
/** 最终 prompt 的硬上限（正常预算下不会触发）。 */
const PROMPT_HARD_LIMIT = 120_000

/** 系统提示：中文，说明身份与回答格式。 */
const SYSTEM_PROMPT = [
  '你是「古法编程」（GUFA CODE）内置的 AI 编程助手，运行在用户的本地 IDE 侧边栏里。',
  '你的职责是辅助用户手写代码：解释代码、定位问题、补充注释、给出重构思路，或直接给出可用的代码片段。',
  '请遵守以下要求：',
  '1. 始终用简体中文回答，先给结论，再给必要解释；不要客套、不要重复用户的问题。',
  '2. 代码一律放在 markdown 代码块中，并标注语言；除非用户只要片段，否则给出完整可用的代码。',
  '3. 只依据用户提供的代码与上下文作答；信息不足时明确说明你的假设，不要编造未提供的文件内容。',
  '4. 如果用户要求修改代码，给出修改后的完整代码，并简要说明改了哪些地方。',
  '5. 回答保持简洁，避免与编程无关的内容。',
].join('\n')

/* ── 小工具 ───────────────────────────────────────────────────────────── */

/** 转字符串（非字符串一律视为空）。 */
function textOf(value) {
  return typeof value === 'string' ? value : ''
}

/** 从任意错误里取可读文本。 */
function errorText(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message
  if (typeof error === 'string') return error
  return '未知错误'
}

/** 语言标识白名单：只有安全短标识才放进 markdown 代码围栏。 */
function sanitizeLanguage(value) {
  return /^[A-Za-z0-9_+.#-]{1,24}$/.test(value) ? value : ''
}

/** 从模型失败对象里取稳定 code（失败路由用，不要依赖 message 文本）。 */
function failureCode(failure) {
  return failure !== null && typeof failure === 'object' && typeof failure.code === 'string' ? failure.code : ''
}

/* ── 默认模型与目标模型 ───────────────────────────────────────────────── */

/**
 * 读取 Host 的默认模型选择。
 * @param {any} ctx Host 插件 context（Cordis Context）。
 * @returns {{ provider: string, model: string, reasoningEffort?: string }}
 */
export function readDefaultSelection(ctx) {
  try {
    if (ctx === undefined || ctx === null || typeof ctx.get !== 'function') throw new Error('no context')
    const service = ctx.get('agentDefaultModel')
    if (service === undefined || service === null || typeof service.currentSelection !== 'function') throw new Error('no service')
    const value = service.currentSelection()
    if (value === null || typeof value !== 'object') throw new Error('bad selection')
    const provider = textOf(value.provider).trim()
    const model = textOf(value.model).trim()
    const reasoningEffort = textOf(value.reasoningEffort).trim()
    if (provider !== '' && model !== '') {
      return reasoningEffort === '' ? { provider, model } : { provider, model, reasoningEffort }
    }
  } catch {
    /* 服务未挂载或读取失败：回落固定默认值 */
  }
  return { provider: FALLBACK_PROVIDER, model: FALLBACK_MODEL }
}

/** 超时配置：默认 120 秒，env.chatTimeoutMs 可覆盖。 */
function chatTimeoutOf(env) {
  const value = env !== null && typeof env === 'object' ? env.chatTimeoutMs : undefined
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.min(Math.trunc(value), 600_000)
  return CHAT_TIMEOUT_MS
}

/** 目标模型：body 覆盖优先，否则用 profile 默认；只有完全没覆盖时才沿用默认推理档位。 */
export function resolveChatTarget(body, ctx) {
  const source = body !== null && typeof body === 'object' ? body : {}
  const requestedProvider = textOf(source.provider).trim()
  const requestedModel = textOf(source.model).trim()
  const fallback = readDefaultSelection(ctx)
  const overridden = requestedProvider !== '' || requestedModel !== ''
  return {
    provider: requestedProvider !== '' ? requestedProvider : fallback.provider,
    model: requestedModel !== '' ? requestedModel : fallback.model,
    reasoningEffort: overridden ? undefined : fallback.reasoningEffort,
  }
}

/* ── 失败原因 → 用户可读文案 ──────────────────────────────────────────── */

/**
 * 把 llm finish 的 failure（稳定 code + message）翻成中文提示。
 * 路由只看 code，message 仅作补充。
 * @param {any} failure
 * @returns {string}
 */
export function describeLlmFailure(failure) {
  const code = failureCode(failure)
  const raw = failure !== null && typeof failure === 'object' ? textOf(failure.message).trim() : ''
  switch (code) {
    case 'NO_ADAPTER':
      return '当前没有可用的模型服务，请在 DSH 设置中启用模型后再试。'
    case 'MISSING_CREDENTIAL':
      return '尚未配置模型 API Key，请到 DSH 设置中填写后再试。'
    case 'INVALID_CREDENTIAL':
      return '模型凭据格式无效，请检查 DSH 设置中的 API Key。'
    case 'AUTH':
      return '模型认证失败（API Key 无效或已过期），请检查 DSH 设置。'
    case 'RATE_LIMIT':
      return '请求过于频繁，请稍后再试。'
    case 'QUOTA':
    case 'ACCOUNT_QUOTA':
      return '模型额度不足，请检查账户余额后再试。'
    case 'CONTEXT_WINDOW_EXCEEDED':
      return '对话内容超出模型上下文窗口，请新建对话或减少附带的上下文。'
    case 'SERVER':
      return '模型服务暂时不可用，请稍后再试。'
    case 'EMPTY_RESPONSE':
      return '模型返回了空内容，请重试。'
    default:
      break
  }
  if (raw !== '') return code === '' ? raw : `${raw}（${code}）`
  return code === '' ? '模型请求失败，请重试。' : `模型请求失败：${code}`
}

/** 超时提示事件。 */
function timeoutEvent(timeoutMs) {
  return {
    type: 'error',
    message: `请求超时（${Math.max(1, Math.round(timeoutMs / 1000))} 秒），请稍后重试或新建对话。`,
    code: 'TIMEOUT',
  }
}

/* ── 请求内容归一化与 prompt 拼装 ─────────────────────────────────────── */

/**
 * 归一化消息数组：只保留 user/assistant 的非空文本，截断超长内容。
 * @param {any} raw
 * @returns {Array<{ role: 'user' | 'assistant', text: string }>}
 */
export function normalizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const source = raw.length > MAX_INPUT_MESSAGES ? raw.slice(-MAX_INPUT_MESSAGES) : raw
  const messages = []
  for (const item of source) {
    if (item === null || typeof item !== 'object') continue
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : ''
    if (role === '') continue
    let text = textOf(item.content).trim()
    if (text === '') continue
    if (text.length > MESSAGE_CHAR_LIMIT) text = `${text.slice(0, MESSAGE_CHAR_LIMIT)}\n…（消息过长，已截断）`
    messages.push({ role, text })
  }
  return messages
}

/** 归一化代码上下文：root/path/language + 选中的代码 + 当前文件内容。 */
export function normalizeContext(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const root = textOf(source.root).trim()
  const path = textOf(source.path).trim()
  const language = sanitizeLanguage(textOf(source.language).trim())
  const selectionPath = textOf(source.selectionPath).trim()
  const lineValue = source.selectionLine
  const selectionLine = typeof lineValue === 'number' && Number.isFinite(lineValue) && lineValue > 0 ? Math.trunc(lineValue) : 0

  let selection = textOf(source.selection)
  let content = textOf(source.content)
  if (selection.length > CONTEXT_HARD_LIMIT) selection = selection.slice(0, CONTEXT_HARD_LIMIT)
  if (content.length > CONTEXT_HARD_LIMIT) content = content.slice(0, CONTEXT_HARD_LIMIT)

  const selectionLimit = CONTEXT_SELECTION_LIMIT
  const fileLimit = selection !== '' ? CONTEXT_FILE_LIMIT_WITH_SELECTION : CONTEXT_FILE_LIMIT
  const selectionTruncated = selection.length > selectionLimit
  if (selectionTruncated) selection = selection.slice(0, selectionLimit)
  const contentTruncated = content.length > fileLimit
  if (contentTruncated) content = content.slice(0, fileLimit)

  return { root, path, language, content, contentTruncated, selection, selectionTruncated, selectionPath, selectionLine }
}

/** 代码围栏：语言合法才追加。 */
function fence(language) {
  return '```' + (language === '' ? '' : language)
}

/** 渲染「代码上下文」段；无上下文时返回空串。 */
function buildContextSection(context) {
  const hasFile = context.path !== '' || context.content !== ''
  if (!hasFile && context.selection === '' && context.root === '') return ''
  const lines = ['【代码上下文】']
  if (context.root !== '') lines.push(`项目根目录：${context.root}`)
  const filePath = context.path !== '' ? context.path : context.selectionPath
  if (filePath !== '') {
    lines.push(`当前文件：${filePath}${context.language === '' ? '' : `（语言：${context.language}）`}`)
  }
  if (context.selection !== '') {
    const details = []
    if (context.selectionPath !== '' && context.selectionPath !== filePath) details.push(`来自 ${context.selectionPath}`)
    if (context.selectionLine > 0) details.push(`从第 ${context.selectionLine} 行开始`)
    lines.push(`用户选中的代码${details.length === 0 ? '' : `（${details.join('，')}）`}：`)
    lines.push(fence(context.language))
    lines.push(context.selection)
    lines.push('```')
    if (context.selectionTruncated) lines.push(`（选中代码过长，已截断到 ${CONTEXT_SELECTION_LIMIT} 字符）`)
  }
  if (context.content !== '') {
    const fileLimit = context.selection !== '' ? CONTEXT_FILE_LIMIT_WITH_SELECTION : CONTEXT_FILE_LIMIT
    lines.push(`当前文件内容${context.contentTruncated ? `（过长，已截断到 ${fileLimit} 字符）` : ''}：`)
    lines.push(fence(context.language))
    lines.push(context.content)
    lines.push('```')
  }
  return lines.join('\n')
}

/** 渲染「对话历史」段；从新到旧取，超出预算时省略较早内容。 */
function buildHistorySection(history) {
  if (history.length === 0) return ''
  const picked = []
  let used = 0
  let omitted = false
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    const body = `${message.role === 'user' ? '用户' : '助手'}：${message.text}`
    if (picked.length >= HISTORY_MESSAGE_LIMIT || used + body.length > HISTORY_CHAR_LIMIT) {
      omitted = true
      break
    }
    picked.push(body)
    used += body.length
  }
  picked.reverse()
  const lines = ['【对话历史】']
  if (omitted) lines.push('（较早的对话已省略）')
  for (const body of picked) lines.push(body)
  return lines.join('\n\n')
}

/** 拆分「历史 + 当前问题」：最后一条 user 消息是本次提问。 */
function splitMessages(messages) {
  if (messages.length === 0) return { history: [], question: '' }
  const last = messages[messages.length - 1]
  if (last.role !== 'user') return { history: messages, question: '' }
  let question = last.text
  if (question.length > QUESTION_LIMIT) question = `${question.slice(0, QUESTION_LIMIT)}\n…（问题过长，已截断）`
  return { history: messages.slice(0, -1), question }
}

/**
 * 把请求体拼成单条 user 文本：系统提示 + 代码上下文 + 最近对话 + 当前问题。
 * 导出以便纯函数单测。
 * @param {any} body chat.stream 请求体
 * @returns {string}
 */
export function buildChatPrompt(body) {
  const source = body !== null && typeof body === 'object' ? body : {}
  const messages = normalizeMessages(source.messages)
  const context = normalizeContext(source.context)
  const { history, question } = splitMessages(messages)
  const parts = [SYSTEM_PROMPT]
  const contextSection = buildContextSection(context)
  if (contextSection !== '') parts.push(contextSection)
  const historySection = buildHistorySection(history)
  if (historySection !== '') parts.push(historySection)
  parts.push(`【当前问题】\n${question === '' ? '（用户没有输入具体问题，请根据上面的上下文给出有用的分析与建议）' : question}`)
  const prompt = parts.join('\n\n')
  if (prompt.length <= PROMPT_HARD_LIMIT) return prompt
  return `${prompt.slice(0, PROMPT_HARD_LIMIT)}\n…（提示过长，已截断）`
}

/* ── 路由注册 ─────────────────────────────────────────────────────────── */

/**
 * 注册聊天能力。
 * @param {{ method(name: string, fn: Function): void, stream(name: string, fn: Function): void }} router
 * @param {{ ctx: any, chatTimeoutMs?: number }} env
 */
export function register(router, env) {
  const ctx = env !== null && typeof env === 'object' ? env.ctx : undefined
  const timeoutMs = chatTimeoutOf(env)

  /** 读取 Host 的 llm 服务（每个请求实时取，避免服务晚于插件挂载）。 */
  const readLlm = () => {
    try {
      if (ctx === undefined || ctx === null || typeof ctx.get !== 'function') return undefined
      const service = ctx.get('llm')
      return service === undefined || service === null ? undefined : service
    } catch {
      return undefined
    }
  }

  router.method('chat.info', async () => {
    const target = readDefaultSelection(ctx)
    const llm = readLlm()
    let ready = false
    if (llm !== undefined && typeof llm.stream === 'function') {
      ready = true
      try {
        const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
        if (Array.isArray(providers) && providers.length > 0) {
          ready = providers.some((entry) => entry !== null && typeof entry === 'object' && entry.id === target.provider)
        }
      } catch {
        /* 目录不可读时保留「llm 服务存在即可用」的宽松判断 */
      }
    }
    return { provider: target.provider, model: target.model, ready }
  })

  router.stream('chat.stream', async (body, { res, signal, send, close }) => {
    /** 合并「客户端断开」与「超时」的取消源。 */
    const controller = new AbortController()
    let timedOut = false
    let thinkingSent = false
    let terminalSent = false
    let closed = false
    let timer

    const sendEvent = (event) => {
      try {
        send(event)
      } catch {
        /* 客户端已断开：忽略写失败 */
      }
    }
    const sendTerminal = (event) => {
      if (terminalSent) return
      terminalSent = true
      sendEvent(event)
    }
    const abortForCancel = () => {
      controller.abort()
    }
    const onResponseClose = () => {
      if (res === undefined || res === null || res.writableEnded !== true) abortForCancel()
    }

    if (signal !== undefined && signal !== null) {
      if (signal.aborted === true) controller.abort()
      else if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', abortForCancel, { once: true })
    }
    if (res !== undefined && res !== null && typeof res.once === 'function') res.once('close', onResponseClose)
    if (typeof setTimeout === 'function') {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    }

    try {
      /* SSE 头：必须显式设置 text/event-stream，Host 的 gzip 中间件依据它跳过压缩/缓冲。 */
      if (res !== undefined && res !== null && res.headersSent !== true) {
        try {
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })
          if (typeof res.flushHeaders === 'function') res.flushHeaders()
        } catch {
          /* 替代实现（单测 mock）可能没有完整 Node 响应对象 */
        }
      }

      const llm = readLlm()
      if (llm === undefined || typeof llm.stream !== 'function') {
        sendTerminal({ type: 'error', message: 'AI 服务不可用：Host 没有挂载 llm 服务。', code: 'NO_LLM' })
        return
      }
      const messages = normalizeMessages(body !== null && typeof body === 'object' ? body.messages : undefined)
      if (messages.length === 0) {
        sendTerminal({ type: 'error', message: '消息不能为空。', code: 'EMPTY_MESSAGES' })
        return
      }

      const target = resolveChatTarget(body, ctx)
      const options = {
        provider: target.provider,
        model: target.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: buildChatPrompt(body) }] }],
        signal: controller.signal,
      }
      if (target.reasoningEffort !== undefined) options.reasoningEffort = target.reasoningEffort

      /* 硬性取消：超时或客户端断开时，即使适配器不响应 signal，也要从 for-await 中退出。 */
      const ABORTED = { aborted: true }
      let onAbortResolve
      const abortedPromise = new Promise((resolve) => {
        onAbortResolve = resolve
        if (controller.signal.aborted) {
          resolve(ABORTED)
          return
        }
        controller.signal.addEventListener('abort', () => resolve(ABORTED), { once: true })
      })
      let iterator
      try {
        iterator = llm.stream(options)[Symbol.asyncIterator]()
        for (;;) {
          const nextPromise = iterator.next()
          /* 输掉 race 的那一侧稍后可能 reject：提前挂上处理，避免 unhandledRejection。 */
          nextPromise.catch(() => {})
          const next = await Promise.race([nextPromise, abortedPromise])
          if (next === ABORTED) break
          if (next.done) break
          const chunk = next.value
          if (chunk === null || typeof chunk !== 'object') continue
          if (chunk.type === 'text-delta') {
            const text = textOf(chunk.text)
            if (text !== '') sendEvent({ type: 'delta', text })
          } else if (chunk.type === 'reasoning-delta') {
            if (!thinkingSent) {
              thinkingSent = true
              sendEvent({ type: 'thinking' })
            }
          } else if (chunk.type === 'finish') {
            const reason = chunk.reason !== null && typeof chunk.reason === 'object' ? chunk.reason : { kind: 'stop' }
            if (reason.kind === 'error') {
              const code = failureCode(reason.failure)
              sendTerminal({
                type: 'error',
                message: describeLlmFailure(reason.failure),
                code: code === '' ? 'LLM_ERROR' : code,
              })
            } else if (reason.kind === 'aborted') {
              if (timedOut) sendTerminal(timeoutEvent(timeoutMs))
              else if (!controller.signal.aborted) sendTerminal({ type: 'error', message: '模型请求已中止，请重试。', code: 'ABORTED' })
            } else {
              sendTerminal({ type: 'done' })
            }
          }
        }
      } catch (error) {
        if (timedOut) sendTerminal(timeoutEvent(timeoutMs))
        else if (!controller.signal.aborted) sendTerminal({ type: 'error', message: `模型请求失败：${errorText(error)}`, code: 'LLM_ERROR' })
      } finally {
        if (onAbortResolve !== undefined) onAbortResolve(ABORTED)
        /* 取消后尽量让适配器释放底层连接（不等待，避免清理本身卡住）。 */
        if (controller.signal.aborted && iterator !== undefined && typeof iterator.return === 'function') {
          try {
            Promise.resolve(iterator.return()).catch(() => {})
          } catch {
            /* ignore */
          }
        }
      }

      if (!terminalSent) {
        if (timedOut) sendTerminal(timeoutEvent(timeoutMs))
        else if (!controller.signal.aborted) sendTerminal({ type: 'done' })
      }
    } catch (error) {
      if (timedOut) sendTerminal(timeoutEvent(timeoutMs))
      else if (!controller.signal.aborted) sendTerminal({ type: 'error', message: `AI 聊天请求失败：${errorText(error)}`, code: 'CHAT_ERROR' })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (signal !== undefined && signal !== null && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abortForCancel)
      if (res !== undefined && res !== null && typeof res.removeListener === 'function') res.removeListener('close', onResponseClose)
      if (!closed) {
        closed = true
        try {
          close()
        } catch {
          /* 忽略关闭失败 */
        }
      }
    }
  })
}

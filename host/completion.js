/**
 * Tab 行内补全：借用 Harness 自己的模型服务（ctx.llm），不需要额外 Copilot 订阅。
 *
 * 客户端 Monaco 在光标处请求 `completion.suggest`，Host 拼一小段 FIM 风格 prompt，
 * 用当前默认模型（ctx.agentDefaultModel）流式生成，只回插入文本。为了保持轻量，
 * prompt 只带光标前后有限上下文、maxTokens 很小，客户端做防抖/限流/取消。
 */
import { ApiError, badRequest } from './context.js'

const SYSTEM_PROMPT = [
  'You are an inline code completion engine inside an IDE.',
  'Given the code before and after the cursor, predict the exact text the developer would type next.',
  'Return ONLY the insertion text: no markdown fences, no comments explaining, no repetition of existing text.',
  'Keep it short (usually one line to a few lines). Match the indentation of the surrounding code.',
].join(' ')

const SUPPORTED = new Set([
  'python', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
  'json', 'markdown', 'css', 'scss', 'less', 'html', 'java', 'go', 'rust',
  'csharp', 'cpp', 'c', 'shell', 'yaml', 'sql', 'php', 'ruby',
])


function sanitize(text) {
  let value = String(text ?? '')
  /* 去掉模型偶尔带出的 markdown 围栏 */
  value = value.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '')
  /* 只取第一段有意义的插入内容，去掉结尾整行解释 */
  value = value.replace(/\r\n/g, '\n')
  const lines = value.split('\n')
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  value = lines.join('\n')
  if (value.length > 1200) value = value.slice(0, 1200)
  return value
}

function selectionOf(ctx) {
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
    if (service !== undefined && service !== null && typeof service.currentSelection === 'function') return service.currentSelection()
  } catch {
    /* ignore */
  }
  return undefined
}

const effortCache = new Map()

/** 补全要求低延迟：优先选最小 reasoning effort（不同模型 id 不同，如 off/minimal/low）。 */
async function pickReasoningEffort(llm, provider, model) {
  const key = `${provider}|${model}`
  if (effortCache.has(key)) return effortCache.get(key)
  let chosen = ''
  try {
    const info = await llm.resolveModelInfo(provider, model)
    const efforts = info !== null && info !== undefined && info.reasoning !== null && info.reasoning !== undefined && Array.isArray(info.reasoning.efforts)
      ? info.reasoning.efforts.map((entry) => String(entry?.id ?? '')).filter((id) => id !== '')
      : []
    chosen = efforts.find((id) => /^(off|none|minimal|low)$/i.test(id)) ?? efforts[0] ?? ''
  } catch {
    chosen = ''
  }
  effortCache.set(key, chosen)
  return chosen
}

export async function suggest(body, env) {
  if (typeof body.prefix !== 'string' && typeof body.suffix !== 'string') throw badRequest('prefix is required')
  const ctx = env.ctx
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
    throw new ApiError('llm-unavailable', '当前环境没有可用的模型服务', 503)
  }
  const language = typeof body.language === 'string' ? body.language : ''
  if (!SUPPORTED.has(language)) return { skipped: true, text: '' }
  const path = typeof body.path === 'string' ? body.path : ''
  const prefix = String(body.prefix ?? '').slice(-6000)
  const suffix = String(body.suffix ?? '').slice(0, 2000)
  const fallback = selectionOf(ctx)
  const provider = typeof body.provider === 'string' && body.provider !== '' ? body.provider : fallback?.provider
  const model = typeof body.model === 'string' && body.model !== '' ? body.model : fallback?.model
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
    throw new ApiError('llm-model-unavailable', '没有可用的默认模型', 503)
  }
  const userPrompt = [
    `File: ${path || '(untitled)'}`,
    `Language: ${language}`,
    '',
    'Code before cursor:',
    '<<<',
    prefix,
    '>>>',
    '',
    'Code after cursor:',
    '<<<',
    suffix,
    '>>>',
    '',
    'Insertion:',
  ].join('\n')

  const reasoningEffort = await pickReasoningEffort(llm, provider, model)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 9000)
  let text = ''
  let failure = null
  let finishKind = ''
  let usage = null
  const startedAt = Date.now()
  try {
    const stream = llm.stream({
      provider,
      model,
      ...(reasoningEffort === '' ? {} : { reasoningEffort }),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      maxTokens: 160,
      temperature: 0.2,
      stop: ['\n\n\n'],
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      if (chunk.type === 'reasoning-delta') continue
      if (chunk.type === 'usage') usage = chunk.usage
      if (chunk.type === 'finish') {
        const reason = chunk.reason
        finishKind = reason !== null && typeof reason === 'object' && typeof reason.kind === 'string' ? reason.kind : ''
        if (reason !== null && typeof reason === 'object' && (reason.kind === 'error' || reason.kind === 'aborted')) {
          failure = reason.failure ?? { message: reason.kind }
        }
        break
      }
    }
  } catch (error) {
    failure = { message: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
  if (failure !== null && failure !== undefined) {
    const message = typeof failure.message === 'string' ? failure.message : '模型调用失败'
    if (controller.signal.aborted) throw new ApiError('llm-timeout', '补全请求超时', 504)
    throw new ApiError('llm-failed', `补全模型调用失败：${message}`, 502)
  }
  const sanitized = sanitize(text)
  return {
    provider,
    model,
    text: sanitized,
    latencyMs: Date.now() - startedAt,
  }
}

export function registerCompletion(router, env) {
  router.method('completion.suggest', (body) => suggest(body, env))
}

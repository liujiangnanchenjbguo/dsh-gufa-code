#!/usr/bin/env node
/**
 * 聊天面板单测（纯函数 + mock 路由）。
 *
 *   - host/chat.js：默认模型读取、prompt 拼装、失败文案、register 的 chat.info / chat.stream 行为
 *     （用假 llm.stream 覆盖成功、模型报错、客户端取消、120s 超时、服务缺失等路径）。
 *   - src/client/40-chat.js：localStorage 会话存取、markdown-lite 解析、上下文拼装等纯函数。
 *
 * 运行：node scripts/test-chat.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
const failures = []

function test(name, fn) {
  try {
    const result = fn()
    if (result instanceof Promise) {
      throw new Error('use a synchronous test or await it explicitly')
    }
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`  ✗ ${name}`)
    console.error(`    ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`  ✗ ${name}`)
    console.error(`    ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 简易 mock：Cordis router（只记录注册的回调）。 */
function mockRouter() {
  const methods = new Map()
  const streams = new Map()
  return {
    methods,
    streams,
    method(name, fn) {
      if (methods.has(name)) throw new Error(`duplicate ${name}`)
      methods.set(name, fn)
    },
    stream(name, fn) {
      if (streams.has(name)) throw new Error(`duplicate ${name}`)
      streams.set(name, fn)
    },
  }
}

/** 简易 mock：Node SSE 响应对象。 */
function mockResponse() {
  const listeners = new Map()
  return {
    headersSent: false,
    writableEnded: false,
    status: 0,
    headers: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      this.headersSent = true
      return this
    },
    flushHeaders() {},
    once(event, fn) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
    },
    removeListener(event, fn) {
      const list = listeners.get(event)
      if (list === undefined) return
      const index = list.indexOf(fn)
      if (index >= 0) list.splice(index, 1)
    },
    emit(event) {
      for (const fn of (listeners.get(event) ?? []).slice()) fn()
    },
    end() {
      this.writableEnded = true
    },
  }
}

/** 执行一次 chat.stream，返回收集到的事件与相关上下文。 */
async function runStream(streamFn, body, options = {}) {
  const res = mockResponse()
  const events = []
  const controller = new AbortController()
  let closed = 0
  const handler = streamFn(body, {
    req: {},
    res,
    signal: controller.signal,
    send(event) {
      events.push(event)
    },
    close() {
      closed += 1
      res.end()
    },
  })
  const { autoAbortMs, externalAbort } = options
  if (typeof autoAbortMs === 'number') {
    setTimeout(() => externalAbort?.(), autoAbortMs)
  }
  await handler
  return { res, events, closed: () => closed, controller }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

/* ══════════════════════════════════════════════════════════════════════ */
/* 1. Host：纯函数                                                        */
/* ══════════════════════════════════════════════════════════════════════ */
console.log('\n[host/chat.js] 纯函数')

const host = await import(join(root, 'host/chat.js'))

test('readDefaultSelection：无 context → 固定回落', () => {
  assert.deepEqual(host.readDefaultSelection(undefined), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.deepEqual(host.readDefaultSelection(null), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.deepEqual(host.readDefaultSelection({ get() { throw new Error('boom') } }), { provider: 'deepseek-official', model: 'deepseek-flash' })
})

test('readDefaultSelection：读 agentDefaultModel 并带 reasoningEffort', () => {
  const ctx = {
    get(name) {
      assert.equal(name, 'agentDefaultModel')
      return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }) }
    },
  }
  assert.deepEqual(host.readDefaultSelection(ctx), { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' })
})

test('readDefaultSelection：字段不完整 → 回落', () => {
  const ctx = { get: () => ({ currentSelection: () => ({ provider: '', model: 'x' }) }) }
  assert.deepEqual(host.readDefaultSelection(ctx), { provider: 'deepseek-official', model: 'deepseek-flash' })
})

test('resolveChatTarget：body 覆盖时使用覆盖值且不带默认推理档位', () => {
  const ctx = { get: () => ({ currentSelection: () => ({ provider: 'a', model: 'b', reasoningEffort: 'max' }) }) }
  assert.deepEqual(host.resolveChatTarget({ provider: 'p', model: 'm' }, ctx), { provider: 'p', model: 'm', reasoningEffort: undefined })
  assert.deepEqual(host.resolveChatTarget({}, ctx), { provider: 'a', model: 'b', reasoningEffort: 'max' })
  assert.deepEqual(host.resolveChatTarget({ model: 'm2' }, ctx), { provider: 'a', model: 'm2', reasoningEffort: undefined })
})

test('describeLlmFailure：稳定 code → 中文提示', () => {
  assert.match(host.describeLlmFailure({ code: 'NO_ADAPTER', message: 'x' }), /没有可用的模型服务/)
  assert.match(host.describeLlmFailure({ code: 'MISSING_CREDENTIAL' }), /API Key/)
  assert.match(host.describeLlmFailure({ code: 'RATE_LIMIT' }), /频繁/)
  assert.match(host.describeLlmFailure({ code: 'CONTEXT_WINDOW_EXCEEDED' }), /上下文窗口/)
  assert.match(host.describeLlmFailure({ code: 'SOMETHING_NEW', message: 'raw detail' }), /raw detail（SOMETHING_NEW）/)
  assert.equal(host.describeLlmFailure(undefined), '模型请求失败，请重试。')
})

test('normalizeMessages：过滤非法/空消息并截断超长内容', () => {
  const long = 'x'.repeat(9000)
  const messages = host.normalizeMessages([
    null,
    { role: 'system', content: 'ignored' },
    { role: 'user', content: '  你好  ' },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: long },
    42,
  ])
  assert.equal(messages.length, 2)
  assert.deepEqual(messages[0], { role: 'user', text: '你好' })
  assert.equal(messages[1].role, 'assistant')
  assert.ok(messages[1].text.length < long.length)
  assert.match(messages[1].text, /已截断/)
})

test('buildChatPrompt：系统提示 + 上下文 + 历史 + 当前问题，选中代码优先', () => {
  const prompt = host.buildChatPrompt({
    messages: [
      { role: 'user', content: '帮我看看排序' },
      { role: 'assistant', content: '好的，请给我代码' },
      { role: 'user', content: '这段代码有什么问题？' },
    ],
    context: {
      root: '/tmp/demo',
      path: 'src/sort.js',
      language: 'javascript',
      content: 'function sort(a){ return a }',
      selection: 'return a',
      selectionPath: 'src/sort.js',
      selectionLine: 3,
    },
  })
  assert.match(prompt, /古法编程/)
  assert.match(prompt, /项目根目录：\/tmp\/demo/)
  assert.match(prompt, /当前文件：src\/sort\.js（语言：javascript）/)
  assert.ok(prompt.indexOf('用户选中的代码') > 0)
  assert.ok(prompt.indexOf('用户选中的代码') < prompt.indexOf('当前文件内容'), '选中代码应排在文件内容前')
  assert.match(prompt, /```javascript\nreturn a\n```/)
  assert.match(prompt, /从第 3 行开始/)
  assert.match(prompt, /【对话历史】[\s\S]*用户：帮我看看排序[\s\S]*助手：好的，请给我代码/)
  assert.match(prompt, /【当前问题】\n这段代码有什么问题？$/)
})

test('buildChatPrompt：无上下文/无消息时给出兜底问题', () => {
  const prompt = host.buildChatPrompt({})
  assert.match(prompt, /【当前问题】/)
  assert.ok(!prompt.includes('【代码上下文】'))
  assert.ok(!prompt.includes('【对话历史】'))
})

test('buildChatPrompt：上下文超长被截断且提示语出现', () => {
  const prompt = host.buildChatPrompt({
    messages: [{ role: 'user', content: '解释' }],
    context: { path: 'a.js', content: 'a'.repeat(50000), selection: 'b'.repeat(50000) },
  })
  assert.match(prompt, /选中代码过长，已截断到 20000 字符/)
  assert.match(prompt, /当前文件内容（过长，已截断到 12000 字符）/)
  assert.ok(prompt.length < 120_000)
})

test('buildChatPrompt：历史只保留最近部分并省略更早内容', () => {
  const messages = []
  for (let index = 0; index < 60; index += 1) {
    messages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `第 ${index} 条 ${'z'.repeat(2000)}` })
  }
  messages.push({ role: 'user', content: '最后一个问题' })
  const prompt = host.buildChatPrompt({ messages })
  assert.match(prompt, /较早的对话已省略/)
  assert.match(prompt, /【当前问题】\n最后一个问题$/)
  assert.ok(prompt.length <= 120_000)
})

test('normalizeContext：语言白名单与行号归一化', () => {
  const context = host.normalizeContext({ language: '```evil', selection: 'x', selectionLine: 2.9, path: 'a' })
  assert.equal(context.language, '')
  assert.equal(context.selectionLine, 2)
  assert.equal(host.normalizeContext(undefined).content, '')
})

/* ══════════════════════════════════════════════════════════════════════ */
/* 2. Host：register 行为（mock llm）                                     */
/* ══════════════════════════════════════════════════════════════════════ */
console.log('\n[host/chat.js] register / chat.stream')

/** 构造 mock env.ctx：按服务名返回服务。 */
function mockCtx(services) {
  return { get: (name) => services[name] }
}

await testAsync('chat.info：默认模型 + provider 已注册 → ready=true', async () => {
  const router = mockRouter()
  host.register(router, {
    ctx: mockCtx({
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }) },
      llm: { stream() {}, listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }] },
    }),
  })
  const info = await router.methods.get('chat.info')({})
  assert.deepEqual(info, { provider: 'deepseek-official', model: 'deepseek-flash', ready: true })
})

await testAsync('chat.info：没有 llm 服务 → ready=false 但仍给默认模型', async () => {
  const router = mockRouter()
  host.register(router, { ctx: mockCtx({}) })
  const info = await router.methods.get('chat.info')({})
  assert.equal(info.provider, 'deepseek-official')
  assert.equal(info.model, 'deepseek-flash')
  assert.equal(info.ready, false)
})

await testAsync('chat.info：llm 存在但 provider 未注册 → ready=false', async () => {
  const router = mockRouter()
  host.register(router, {
    ctx: mockCtx({
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: { stream() {}, listProviders: () => [{ id: 'q', name: 'Q' }] },
    }),
  })
  const info = await router.methods.get('chat.info')({})
  assert.equal(info.ready, false)
})

await testAsync('chat.stream：成功路径逐块转发 delta / thinking / done', async () => {
  const captured = []
  const router = mockRouter()
  host.register(router, {
    ctx: mockCtx({
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }) },
      llm: {
        stream(options) {
          captured.push(options)
          return (async function* gen() {
            yield { type: 'block-start', index: 0, blockType: 'reasoning' }
            yield { type: 'reasoning-delta', index: 0, text: '想一想' }
            yield { type: 'reasoning-delta', index: 0, text: '再想' }
            yield { type: 'block-start', index: 1, blockType: 'text' }
            yield { type: 'text-delta', index: 1, text: '你好' }
            yield { type: 'text-delta', index: 1, text: '，世界' }
            yield { type: 'usage', usage: { inputTokens: 1 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
        listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      },
    }),
  })
  const { events, res, closed } = await runStream(router.streams.get('chat.stream'), {
    messages: [{ role: 'user', content: '打个招呼' }],
    context: { root: '/tmp/demo', path: 'a.js', language: 'javascript', content: 'const a = 1' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.deepEqual(events, [
    { type: 'thinking' },
    { type: 'delta', text: '你好' },
    { type: 'delta', text: '，世界' },
    { type: 'done' },
  ])
  assert.equal(closed(), 1)
  // 传给 llm 的请求：单条 user 文本、带上下文与问题、沿用默认模型和推理档位
  assert.equal(captured.length, 1)
  const options = captured[0]
  assert.equal(options.provider, 'deepseek-official')
  assert.equal(options.model, 'deepseek-flash')
  assert.equal(options.reasoningEffort, 'max')
  assert.equal(options.messages.length, 1)
  assert.equal(options.messages[0].role, 'user')
  assert.deepEqual(Object.keys(options.messages[0].content[0]), ['type', 'text'])
  assert.match(options.messages[0].content[0].text, /const a = 1/)
  assert.match(options.messages[0].content[0].text, /打个招呼/)
})

await testAsync('chat.stream：finish error → 映射中文 error 事件', async () => {
  const router = mockRouter()
  host.register(router, {
    ctx: mockCtx({
      llm: {
        stream() {
          return (async function* gen() {
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'bad key' } } }
          })()
        },
      },
    }),
  })
  const { events } = await runStream(router.streams.get('chat.stream'), { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'error')
  assert.match(events[0].message, /认证失败/)
  assert.equal(events[0].code, 'AUTH')
})

await testAsync('chat.stream：llm.stream 抛错 → error 事件兜底', async () => {
  const router = mockRouter()
  host.register(router, {
    ctx: mockCtx({
      llm: {
        stream() {
          return (async function* gen() {
            yield { type: 'text-delta', index: 0, text: '半' }
            throw new Error('socket hang up')
          })()
        },
      },
    }),
  })
  const { events } = await runStream(router.streams.get('chat.stream'), { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events[0].type, 'delta')
  assert.equal(events[1].type, 'error')
  assert.match(events[1].message, /socket hang up/)
})

await testAsync('chat.stream：没有 llm 服务 / 空消息 → 明确的 error 事件', async () => {
  const missingRouter = mockRouter()
  host.register(missingRouter, { ctx: mockCtx({}) })
  const missing = await runStream(missingRouter.streams.get('chat.stream'), { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(missing.events[0].code, 'NO_LLM')

  const emptyRouter = mockRouter()
  host.register(emptyRouter, {
    ctx: mockCtx({ llm: { stream() { return (async function* gen() { yield { type: 'finish', reason: { kind: 'stop' } } })() } } }),
  })
  const empty = await runStream(emptyRouter.streams.get('chat.stream'), { messages: [] })
  assert.equal(empty.events[0].code, 'EMPTY_MESSAGES')
})

await testAsync('chat.stream：客户端取消 → 静默结束（不产生 done/error）', async () => {
  const router = mockRouter()
  host.register(router, {
    ctx: mockCtx({
      llm: {
        stream(options) {
          return (async function* gen() {
            yield { type: 'text-delta', index: 0, text: '部分' }
            await new Promise((done) => {
              if (options.signal.aborted) done()
              else options.signal.addEventListener('abort', done, { once: true })
            })
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } } }
          })()
        },
      },
    }),
  })
  const controller = new AbortController()
  const res = mockResponse()
  const events = []
  const pending = router.streams.get('chat.stream')(
    { messages: [{ role: 'user', content: 'hi' }] },
    {
      req: {},
      res,
      signal: controller.signal,
      send: (event) => events.push(event),
      close: () => res.end(),
    },
  )
  await sleep(10)
  controller.abort()
  await pending
  assert.deepEqual(events, [{ type: 'delta', text: '部分' }])
})

await testAsync('chat.stream：超时 → TIMEOUT error 事件', async () => {
  const router = mockRouter()
  host.register(router, {
    chatTimeoutMs: 30,
    ctx: mockCtx({
      llm: {
        stream(options) {
          return (async function* gen() {
            await new Promise((done) => {
              if (options.signal.aborted) done()
              else options.signal.addEventListener('abort', done, { once: true })
            })
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } } }
          })()
        },
      },
    }),
  })
  const { events } = await runStream(router.streams.get('chat.stream'), { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'error')
  assert.equal(events[0].code, 'TIMEOUT')
  assert.match(events[0].message, /超时/)
})

await testAsync('chat.stream：适配器不响应取消时，超时仍能强制结束', async () => {
  const router = mockRouter()
  host.register(router, {
    chatTimeoutMs: 30,
    ctx: mockCtx({
      llm: {
        stream() {
          /* 故意既不 yield 也不监听 signal：验证 Promise.race 的硬超时 */
          return (async function* gen() {
            await new Promise(() => {})
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    }),
  })
  const { events, res } = await runStream(router.streams.get('chat.stream'), { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events.length, 1)
  assert.equal(events[0].code, 'TIMEOUT')
  assert.equal(res.writableEnded, true, '超时后应关闭响应')
})

await testAsync('chat.stream：body.provider/model 覆盖默认目标', async () => {
  const captured = []
  const router = mockRouter()
  host.register(router, {
    ctx: mockCtx({
      agentDefaultModel: { currentSelection: () => ({ provider: 'a', model: 'b', reasoningEffort: 'max' }) },
      llm: {
        stream(options) {
          captured.push(options)
          return (async function* gen() {
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    }),
  })
  await runStream(router.streams.get('chat.stream'), {
    messages: [{ role: 'user', content: 'hi' }],
    provider: 'other',
    model: 'other-model',
  })
  assert.equal(captured[0].provider, 'other')
  assert.equal(captured[0].model, 'other-model')
  assert.equal(captured[0].reasoningEffort, undefined)
})

/* ══════════════════════════════════════════════════════════════════════ */
/* 3. Client：纯函数（在 factory 作用域等价环境里求值）                   */
/* ══════════════════════════════════════════════════════════════════════ */
console.log('\n[src/client/40-chat.js] 纯函数')

const clientSource = readFileSync(join(root, 'src', 'client', '40-chat.js'), 'utf8')
const clientFactory = new Function(
  'G',
  'h',
  'React',
  'useState',
  'useEffect',
  'useRef',
  'useMemo',
  'useCallback',
  'useLayoutEffect',
  `${clientSource}\nreturn {
    gufaChatParseMarkdown,
    gufaChatInline,
    gufaChatBuildContext,
    gufaChatRequestMessages,
    gufaChatStorageKey,
    gufaChatSanitizeStore,
    gufaChatTrimConversation,
    gufaChatTitleOf,
    gufaChatRelativeTime,
    gufaChatSaveStore,
    gufaChatLoadStore,
    GufaChatInline,
    GufaChatMarkdownText,
    GufaChatCode,
    GufaChatMessageView,
    ChatPanel: G.ChatPanel,
  }\n`,
)
const stubG = { ChatPanel: null }
const client = clientFactory(
  stubG,
  () => null,
  { Fragment: Symbol('fragment') },
  () => undefined,
  () => undefined,
  () => ({ current: null }),
  (fn) => fn(),
  (fn) => fn,
  () => undefined,
)

test('G.ChatPanel 已注册为组件函数', () => {
  assert.equal(typeof client.ChatPanel, 'function')
  assert.equal(stubG.ChatPanel, client.ChatPanel)
})

test('gufaChatStorageKey：按项目根隔离', () => {
  assert.equal(client.gufaChatStorageKey('/a/b'), 'gufa-code:chat:v1:/a/b')
  assert.equal(client.gufaChatStorageKey(''), 'gufa-code:chat:v1:')
  assert.equal(client.gufaChatStorageKey(null), 'gufa-code:chat:v1:')
})

test('gufaChatTitleOf：压缩空白并截断到 28 字符', () => {
  assert.equal(client.gufaChatTitleOf('  帮我  看看\n这段代码  '), '帮我 看看 这段代码')
  const long = client.gufaChatTitleOf('a'.repeat(50))
  assert.equal(long.length, 28)
  assert.ok(long.endsWith('…'))
})

test('gufaChatRelativeTime：刚刚 / 分钟 / 小时 / 日期', () => {
  const now = Date.now()
  assert.equal(client.gufaChatRelativeTime(now - 5_000, now), '刚刚')
  assert.equal(client.gufaChatRelativeTime(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(client.gufaChatRelativeTime(now - 5 * 3_600_000, now), '5 小时前')
  assert.match(client.gufaChatRelativeTime(now - 3 * 86_400_000, now), /^\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(client.gufaChatRelativeTime(0, now), '')
})

test('gufaChatParseMarkdown：普通文本 / 闭合代码块 / 多块', () => {
  assert.deepEqual(client.gufaChatParseMarkdown(''), [])
  assert.deepEqual(client.gufaChatParseMarkdown('你好'), [{ type: 'text', text: '你好' }])
  const blocks = client.gufaChatParseMarkdown('说明：\n```js\nconst a = 1\n```\n结束')
  assert.equal(blocks.length, 3)
  assert.deepEqual(blocks[0], { type: 'text', text: '说明：\n' })
  assert.deepEqual(blocks[1], { type: 'code', lang: 'js', text: 'const a = 1' })
  assert.deepEqual(blocks[2], { type: 'text', text: '\n结束' })
})

test('gufaChatParseMarkdown：流式中未闭合围栏按代码块处理', () => {
  const blocks = client.gufaChatParseMarkdown('开头\n```python\nprint(1)')
  assert.equal(blocks[0].type, 'text')
  assert.equal(blocks[1].type, 'code')
  assert.equal(blocks[1].lang, 'python')
  assert.equal(blocks[1].text, 'print(1)')
  assert.equal(blocks[1].open, true)
})

test('gufaChatInline：行内代码与粗体', () => {
  assert.deepEqual(client.gufaChatInline('用 `map` 和 **reduce** 实现'), [
    { type: 'text', text: '用 ' },
    { type: 'code', text: 'map' },
    { type: 'text', text: ' 和 ' },
    { type: 'bold', text: 'reduce' },
    { type: 'text', text: ' 实现' },
  ])
  assert.deepEqual(client.gufaChatInline('纯文本'), [{ type: 'text', text: '纯文本' }])
})

test('gufaChatBuildContext：文件 + 选中代码都开启', () => {
  const context = client.gufaChatBuildContext({
    project: { root: '/repo' },
    activeFile: { path: 'src/a.js', content: 'const a = 1', language: 'javascript' },
    selection: { text: 'a = 1', path: 'src/a.js', line: 4 },
    attachFile: true,
    attachSelection: true,
  })
  assert.deepEqual(context, {
    root: '/repo',
    selection: 'a = 1',
    selectionPath: 'src/a.js',
    selectionLine: 4,
    path: 'src/a.js',
    content: 'const a = 1',
    language: 'javascript',
  })
})

test('gufaChatBuildContext：关闭文件但保留选中代码', () => {
  const context = client.gufaChatBuildContext({
    project: { root: '/repo' },
    activeFile: { path: 'src/a.js', content: 'const a = 1' },
    selection: { text: 'a = 1', path: 'src/a.js', line: 1 },
    attachFile: false,
    attachSelection: true,
  })
  assert.equal(context.content, undefined)
  assert.equal(context.path, 'src/a.js')
  assert.equal(context.selection, 'a = 1')
})

test('gufaChatBuildContext：关闭选中代码；无上下文返回 null', () => {
  const noSelection = client.gufaChatBuildContext({
    project: { root: '/repo' },
    activeFile: { path: 'a.js', content: 'x' },
    selection: { text: 'x' },
    attachFile: true,
    attachSelection: false,
  })
  assert.equal(noSelection.selection, undefined)
  assert.equal(noSelection.content, 'x')
  assert.equal(client.gufaChatBuildContext({ project: { root: '/repo' } }).root, '/repo')
  assert.equal(client.gufaChatBuildContext({}), null)
})

test('gufaChatRequestMessages：过滤错误/空消息', () => {
  const messages = client.gufaChatRequestMessages([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '', error: '请求失败' },
    { role: 'assistant', content: '在的' },
    { role: 'user', content: '   ' },
    { role: 'system', content: 'x' },
  ])
  assert.deepEqual(messages, [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '在的' },
  ])
})

test('gufaChatTrimConversation：条数/长度裁剪与字段保真', () => {
  const messages = []
  for (let index = 0; index < 200; index += 1) messages.push({ role: 'user', content: `m${index}` })
  const trimmed = client.gufaChatTrimConversation({
    id: 'c1',
    title: '标题',
    updatedAt: 123,
    messages: [...messages, { role: 'assistant', content: 'x'.repeat(70_000), error: 'e', stopped: true }],
  })
  assert.equal(trimmed.id, 'c1')
  assert.equal(trimmed.messages.length, 120)
  assert.equal(trimmed.updatedAt, 123)
  const last = trimmed.messages[trimmed.messages.length - 1]
  assert.ok(last.content.length < 70_000)
  assert.match(last.content, /已截断/)
  assert.equal(last.error, 'e')
  assert.equal(last.stopped, true)
})

test('gufaChatSanitizeStore：坏数据/重复 id/activeId 回落/上限 30', () => {
  assert.deepEqual(client.gufaChatSanitizeStore(null), { conversations: [], activeId: null })
  assert.deepEqual(client.gufaChatSanitizeStore({ conversations: 'x' }), { conversations: [], activeId: null })
  const raw = { activeId: 'nope', conversations: [] }
  for (let index = 0; index < 40; index += 1) raw.conversations.push({ id: `c${index}`, title: `t${index}`, messages: [] })
  raw.conversations.push({ id: 'c0', title: 'dup', messages: [] })
  const sanitized = client.gufaChatSanitizeStore(raw)
  assert.equal(sanitized.conversations.length, 30)
  assert.equal(sanitized.activeId, 'c0')
})

/* 假 localStorage（含一次配额失败模拟） */
function installFakeStorage() {
  const store = new Map()
  let failNextSet = false
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      if (failNextSet) {
        failNextSet = false
        throw new Error('QuotaExceededError')
      }
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    __store: store,
    __failNextSet() {
      failNextSet = true
    },
  }
  return globalThis.localStorage
}

test('gufaChatSaveStore / LoadStore：roundtrip 与配额回退', () => {
  const storage = installFakeStorage()
  const conversations = [
    { id: 'c1', title: '第一个', messages: [{ id: 'm1', role: 'user', content: '你好', at: 1 }], updatedAt: 1 },
    { id: 'c2', title: '第二个', messages: [], updatedAt: 2 },
  ]
  assert.equal(client.gufaChatSaveStore('/repo', conversations, 'c2'), true)
  const loaded = client.gufaChatLoadStore('/repo')
  assert.equal(loaded.activeId, 'c2')
  assert.equal(loaded.conversations.length, 2)
  assert.equal(loaded.conversations[0].messages[0].content, '你好')
  // 配额失败：第二次写入（减半）成功
  storage.__failNextSet()
  assert.equal(client.gufaChatSaveStore('/repo', conversations, 'c1'), true)
  assert.ok(storage.__store.size >= 1)
  // 坏 JSON 回落
  storage.setItem(client.gufaChatStorageKey('/broken'), '{not json')
  assert.deepEqual(client.gufaChatLoadStore('/broken'), { conversations: [], activeId: null })
})

/* ══════════════════════════════════════════════════════════════════════ */

console.log('')
if (failures.length > 0) {
  console.error(`✗ 聊天面板单测失败：${failures.length} 个失败，${passed} 个通过`)
  for (const failure of failures) console.error(`  - ${failure.name}: ${failure.error instanceof Error ? failure.error.message : failure.error}`)
  process.exit(1)
}
console.log(`✓ 聊天面板单测全部通过：${passed} 个用例`)

/**
 * 40-chat：右侧「古法 AI」聊天面板。
 *
 * 结构：
 *   1. 纯函数（可单测）：localStorage 会话存取、markdown-lite 解析、请求体上下文拼装；
 *   2. 小组件：markdown 文本、代码块（复制/插入）、消息气泡；
 *   3. 主组件 G.ChatPanel(props)：会话列表 + 流式对话 + 上下文 chips + 快捷提问。
 *
 * props: { project, activeFile, selection, theme, onInsertCode, width }
 *   project:    { root, name } | null
 *   activeFile: { path, content, language } | null
 *   selection:  { text, path, line, column } | null
 *   onInsertCode(code)  由 App 实现，通过 G.bus 'editor:insert' 插入编辑器
 *
 * 与 Host 的协议（host/chat.js）：
 *   G.api('chat.info')  → { provider, model, ready }
 *   G.stream('chat.stream', { messages: [{ role, content }], context }, onEvent)
 *     事件：{type:'delta', text} / {type:'thinking'} / {type:'done'} / {type:'error', message}
 *
 * 本文件只依赖 G.*（不 import 任何 Harness Client 包），在 build-client.mjs 的
 * factory 作用域内执行，因此可直接使用 h / hooks。
 */

/* ── 常量 ─────────────────────────────────────────────────────────────── */

const GUFA_CHAT_CONVERSATION_LIMIT = 30
const GUFA_CHAT_MESSAGE_LIMIT = 120
const GUFA_CHAT_MESSAGE_CHAR_LIMIT = 60_000
/** 客户端兜底看门狗：Host 120 秒超时后一定会发终止事件，超过这个时间还没收到就本地收尾。 */
const GUFA_CHAT_WATCHDOG_MS = 150_000
const GUFA_CHAT_STORAGE_PREFIX = 'gufa-code:chat:v1:'

/** 核心词典里没有的少量文案（插件以中文为主，缺失 key 时用这里的回退）。 */
const GUFA_CHAT_LABELS = {
  notReady: '未就绪',
  emptyReply: '（模型没有返回内容）',
  stopped: '（已停止）',
  ctrlHint: 'Enter 发送 · Shift+Enter 换行',
  openFileHint: '打开文件后可附带上下文',
  newConversation: '新对话',
  clearHint: '清空当前对话',
}

/** 聊天面板专用样式（注入一次，卸载时移除）。 */
const GUFA_CHAT_CSS = `
.gufa-chat-wrap{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}
.gufa-chat-headwrap{position:relative;flex:0 0 auto;z-index:20}
.gufa-chat-head{gap:6px}
.gufa-chat-head .gufa-panel-head-title{flex:1 1 auto}
.gufa-chat-model{flex:0 1 auto;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:9.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--gufa-text-dim);
  padding:2px 6px;border:1px solid var(--gufa-border);border-radius:6px;background:var(--gufa-layer2)}
.gufa-chat-model[data-warn]{color:var(--dsw-alias-state-warning-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 40%,transparent)}
.gufa-chat-history{position:absolute;top:34px;left:0;right:0;display:flex;flex-direction:column;
  border-top:1px solid var(--gufa-border);border-bottom:1px solid var(--gufa-border-strong);
  background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 30px color-mix(in srgb,#000 30%,transparent);z-index:30}
.gufa-chat-history-head{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;font-size:10px;
  letter-spacing:.08em;text-transform:uppercase;color:var(--gufa-text-dim);border-bottom:1px solid var(--gufa-border)}
.gufa-chat-history-list{display:flex;flex-direction:column;max-height:260px;overflow:auto;padding:4px}
.gufa-chat-history-empty{padding:14px 10px;font-size:11.5px;color:var(--gufa-text-dim);text-align:center}
.gufa-chat-history-item{display:flex;align-items:center;gap:4px;border-radius:6px;min-width:0}
.gufa-chat-history-item:hover{background:var(--gufa-hover)}
.gufa-chat-history-item[data-active]{background:var(--gufa-active)}
.gufa-chat-history-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;align-items:flex-start;
  padding:5px 8px;border:0;background:transparent;color:var(--gufa-text);cursor:pointer;text-align:left}
.gufa-chat-history-title{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.gufa-chat-history-time{font-size:10px;color:var(--gufa-text-dim)}
.gufa-chat-history-del{width:24px;height:24px;margin-right:4px;flex:0 0 auto;display:none;align-items:center;justify-content:center;
  border:0;border-radius:5px;background:transparent;color:var(--gufa-text-dim);cursor:pointer}
.gufa-chat-history-item:hover .gufa-chat-history-del{display:inline-flex}
.gufa-chat-history-del:hover{background:var(--gufa-hover);color:var(--dsw-alias-state-error-primary)}
.gufa-chat-history-foot{display:flex;gap:6px;padding:6px;border-top:1px solid var(--gufa-border)}
.gufa-chat-msgs{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 10px 4px;overscroll-behavior:contain}
.gufa-chat-msg{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px}
.gufa-chat-msg[data-role="user"]{justify-content:flex-end}
.gufa-chat-avatar{width:20px;height:20px;flex:0 0 auto;margin-top:2px;display:flex;align-items:center;justify-content:center;
  border-radius:6px;color:var(--gufa-accent);background:color-mix(in srgb,var(--gufa-accent) 14%,transparent)}
.gufa-chat-bubble{min-width:0;max-width:100%;overflow:hidden;position:relative}
.gufa-chat-msg[data-role="user"] .gufa-chat-bubble{max-width:88%;padding:7px 10px;border-radius:10px 10px 3px 10px;
  background:color-mix(in srgb,var(--gufa-accent) 12%,transparent);
  border:1px solid color-mix(in srgb,var(--gufa-accent) 30%,transparent)}
.gufa-chat-msg[data-role="assistant"] .gufa-chat-bubble{flex:1 1 auto;padding:8px 11px;border-radius:10px 10px 10px 3px;
  background:var(--gufa-layer2);border:1px solid var(--gufa-border)}
.gufa-chat-usertext{font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.gufa-chat-text{font-size:12.5px;line-height:1.62;word-break:break-word}
.gufa-chat-line{white-space:pre-wrap}
.gufa-chat-gap{height:5px}
.gufa-chat-text strong{font-weight:650}
.gufa-chat-text code,.gufa-chat-inline-code{font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 4px;
  border-radius:4px;background:var(--gufa-active);border:1px solid var(--gufa-border);word-break:break-word}
.gufa-chat-code{margin:8px 0;border:1px solid var(--gufa-border-strong);border-radius:8px;overflow:hidden;background:var(--gufa-bg)}
.gufa-chat-code-head{display:flex;align-items:center;gap:6px;height:26px;padding:0 5px 0 10px;
  background:var(--gufa-layer2);border-bottom:1px solid var(--gufa-border)}
.gufa-chat-code-lang{font-size:10px;letter-spacing:.05em;color:var(--gufa-text-dim);text-transform:lowercase;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px}
.gufa-chat-fill{flex:1 1 auto}
.gufa-chat-code-btn{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border:0;border-radius:5px;
  background:transparent;color:var(--gufa-text-dim);font-size:10.5px;cursor:pointer;white-space:nowrap}
.gufa-chat-code-btn:hover{background:var(--gufa-hover);color:var(--gufa-text)}
.gufa-chat-code-body{margin:0;padding:9px 11px;overflow:auto;max-height:360px;white-space:pre;tab-size:2;
  font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--gufa-text)}
.gufa-chat-thinking{display:flex;align-items:center;gap:7px;padding:1px 0;font-size:11.5px;color:var(--gufa-text-dim)}
.gufa-chat-error{display:flex;align-items:flex-start;gap:6px;margin-top:6px;padding:6px 8px;border-radius:6px;font-size:11.5px;
  color:var(--dsw-alias-state-error-primary);
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.gufa-chat-caret{display:inline-block;width:7px;height:13px;margin-left:2px;vertical-align:text-bottom;
  background:var(--gufa-accent);opacity:.78;animation:gufa-chat-blink 1s steps(2,start) infinite}
@keyframes gufa-chat-blink{to{visibility:hidden}}
.gufa-chat-composer{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:8px 10px 9px;
  border-top:1px solid var(--gufa-border);background:var(--gufa-layer)}
.gufa-chat-context{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:20px}
.gufa-chat-context-label{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--gufa-text-dim)}
.gufa-chat-chip{display:inline-flex;align-items:center;gap:5px;max-width:210px;height:21px;padding:0 8px;border-radius:11px;
  border:1px dashed var(--gufa-border-strong);background:transparent;color:var(--gufa-text-dim);font-size:11px;cursor:pointer}
.gufa-chat-chip:hover{border-color:var(--gufa-accent);color:var(--gufa-text)}
.gufa-chat-chip[data-on]{border-style:solid;color:var(--gufa-text);
  border-color:color-mix(in srgb,var(--gufa-accent) 52%,transparent);
  background:color-mix(in srgb,var(--gufa-accent) 10%,transparent)}
.gufa-chat-chip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-chat-context-hint{font-size:10.5px;color:var(--gufa-text-dim);opacity:.85}
.gufa-chat-quick{display:flex;gap:5px;flex-wrap:wrap}
.gufa-chat-quick-btn{height:23px;padding:0 9px;border-radius:6px;border:1px solid var(--gufa-border);
  background:var(--gufa-layer2);color:var(--gufa-text-dim);font-size:11px;cursor:pointer;white-space:nowrap}
.gufa-chat-quick-btn:hover:not(:disabled){border-color:var(--gufa-accent);color:var(--gufa-text)}
.gufa-chat-quick-btn:disabled{opacity:.45;cursor:default}
.gufa-chat-notice{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;font-size:11px;
  color:var(--dsw-alias-state-error-primary);
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}
.gufa-chat-notice-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gufa-chat-notice-close{width:20px;height:20px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.gufa-chat-notice-close:hover{background:var(--gufa-hover)}
.gufa-chat-inputwrap{display:flex;align-items:flex-end;gap:8px}
.gufa-chat-input{flex:1 1 auto;min-width:0;min-height:34px;max-height:168px;resize:none;padding:8px 10px;border-radius:8px;
  border:1px solid var(--gufa-border-strong);background:var(--gufa-bg);color:var(--gufa-text);
  font:inherit;font-size:12.5px;line-height:1.5;outline:none}
.gufa-chat-input:focus{border-color:var(--gufa-accent)}
.gufa-chat-input::placeholder{color:var(--gufa-text-dim)}
.gufa-chat-send{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:8px;flex:0 0 auto;
  border:1px solid var(--gufa-accent);background:var(--gufa-accent);color:#fff;font-size:12px;cursor:pointer}
.gufa-chat-send:hover:not(:disabled){background:color-mix(in srgb,var(--gufa-accent) 86%,#000)}
.gufa-chat-send:disabled{opacity:.45;cursor:default}
.gufa-chat-send[data-stop]{background:transparent;color:var(--dsw-alias-state-error-primary);
  border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,transparent)}
.gufa-chat-send[data-stop]:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.gufa-chat-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--gufa-text-dim)}
.gufa-chat-foot-dim{opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`

/* ── 纯函数：localStorage 会话存取 ───────────────────────────────────── */

/** 会话在 localStorage 里的 key：按项目根隔离（无项目时共用一个空项目桶）。 */
function gufaChatStorageKey(root) {
  const normalized = typeof root === 'string' && root !== '' ? root : ''
  return `${GUFA_CHAT_STORAGE_PREFIX}${normalized}`
}

let GUFA_CHAT_ID_SEQUENCE = 0
/** 会话 / 消息本地 id。 */
function gufaChatNewId() {
  GUFA_CHAT_ID_SEQUENCE += 1
  return `c${Date.now().toString(36)}${GUFA_CHAT_ID_SEQUENCE.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 会话标题：取首条用户输入的前 28 个字符。 */
function gufaChatTitleOf(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (normalized === '') return ''
  return normalized.length > 28 ? `${normalized.slice(0, 27)}…` : normalized
}

/** 相对时间（用于历史下拉）。 */
function gufaChatRelativeTime(timestamp, now) {
  const value = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0
  const current = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  const delta = Math.max(0, current - value)
  if (value === 0) return ''
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  const date = new Date(value)
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 归一化并裁剪一个会话（消息条数、单条字符数、字段类型）。 */
function gufaChatTrimConversation(conversation) {
  const source = conversation !== null && typeof conversation === 'object' ? conversation : {}
  const rawMessages = Array.isArray(source.messages) ? source.messages : []
  const messages = rawMessages.slice(-GUFA_CHAT_MESSAGE_LIMIT).map((item) => {
    const message = item !== null && typeof item === 'object' ? item : {}
    let content = typeof message.content === 'string' ? message.content : ''
    if (content.length > GUFA_CHAT_MESSAGE_CHAR_LIMIT) content = `${content.slice(0, GUFA_CHAT_MESSAGE_CHAR_LIMIT)}\n…（内容过长，已截断）`
    const trimmed = {
      id: typeof message.id === 'string' && message.id !== '' ? message.id : gufaChatNewId(),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      at: typeof message.at === 'number' && Number.isFinite(message.at) ? message.at : Date.now(),
    }
    if (typeof message.error === 'string' && message.error !== '') trimmed.error = message.error
    if (message.stopped === true) trimmed.stopped = true
    return trimmed
  })
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : gufaChatNewId(),
    title: typeof source.title === 'string' ? source.title : '',
    messages,
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now(),
  }
}

/** 校验从 localStorage 读出的结构；返回 { conversations, activeId }。 */
function gufaChatSanitizeStore(raw) {
  if (raw === null || typeof raw !== 'object') return { conversations: [], activeId: null }
  const list = Array.isArray(raw.conversations) ? raw.conversations : []
  const conversations = []
  const seen = new Set()
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const conversation = gufaChatTrimConversation(item)
    if (seen.has(conversation.id)) continue
    seen.add(conversation.id)
    conversations.push(conversation)
    if (conversations.length >= GUFA_CHAT_CONVERSATION_LIMIT) break
  }
  const requestedActive = typeof raw.activeId === 'string' ? raw.activeId : ''
  const activeId = conversations.some((item) => item.id === requestedActive) ? requestedActive : (conversations[0]?.id ?? null)
  return { conversations, activeId }
}

/** 读取某个项目的会话库（任何异常都回落到空）。 */
function gufaChatLoadStore(root) {
  try {
    const raw = localStorage.getItem(gufaChatStorageKey(root))
    if (raw === null) return { conversations: [], activeId: null }
    return gufaChatSanitizeStore(JSON.parse(raw))
  } catch {
    return { conversations: [], activeId: null }
  }
}

/** 写入会话库；配额不足时丢掉较旧的一半再试一次。返回是否成功。 */
function gufaChatSaveStore(root, conversations, activeId) {
  const list = (Array.isArray(conversations) ? conversations : [])
    .slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    .map(gufaChatTrimConversation)
  const payload = { version: 1, activeId: typeof activeId === 'string' ? activeId : null, conversations: list }
  try {
    localStorage.setItem(gufaChatStorageKey(root), JSON.stringify(payload))
    return true
  } catch {
    const reduced = payload.conversations.slice(0, Math.max(1, Math.ceil(payload.conversations.length / 2)))
    try {
      localStorage.setItem(gufaChatStorageKey(root), JSON.stringify({ ...payload, conversations: reduced }))
      return true
    } catch {
      return false
    }
  }
}

/* ── 纯函数：markdown-lite 解析 ──────────────────────────────────────── */

/**
 * 把 markdown-lite 文本拆成块：``` 围栏代码块 与 普通文本块。
 * 流式输出时可能只有开头围栏，因此末尾未闭合的围栏也按代码块处理（open: true）。
 * @param {string} source
 * @returns {Array<{ type: 'text', text: string } | { type: 'code', lang: string, text: string, open?: boolean }>}
 */
function gufaChatParseMarkdown(source) {
  const text = typeof source === 'string' ? source : String(source ?? '')
  const blocks = []
  if (text === '') return blocks
  const fencePattern = /```([^\n`]*)\r?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match
  while ((match = fencePattern.exec(text)) !== null) {
    if (match.index > lastIndex) blocks.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    blocks.push({ type: 'code', lang: match[1].trim(), text: match[2].replace(/\n$/, '') })
    lastIndex = fencePattern.lastIndex
  }
  const rest = text.slice(lastIndex)
  if (rest === '') return blocks
  const openIndex = rest.indexOf('```')
  if (openIndex < 0) {
    blocks.push({ type: 'text', text: rest })
    return blocks
  }
  if (openIndex > 0) blocks.push({ type: 'text', text: rest.slice(0, openIndex) })
  const header = rest.slice(openIndex + 3)
  const newline = header.indexOf('\n')
  blocks.push({
    type: 'code',
    lang: (newline >= 0 ? header.slice(0, newline) : header).trim(),
    text: newline >= 0 ? header.slice(newline + 1) : '',
    open: true,
  })
  return blocks
}

/**
 * 行内 markdown-lite：`code` 与 **粗体**。
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'bold' | 'code', text: string }>}
 */
function gufaChatInline(text) {
  const source = typeof text === 'string' ? text : String(text ?? '')
  const tokens = []
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
  let lastIndex = 0
  let match
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: 'text', text: source.slice(lastIndex, match.index) })
    if (match[1] !== undefined) tokens.push({ type: 'bold', text: match[1] })
    else tokens.push({ type: 'code', text: match[2] })
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < source.length) tokens.push({ type: 'text', text: source.slice(lastIndex) })
  return tokens
}

/* ── 纯函数：请求体拼装 ──────────────────────────────────────────────── */

/**
 * 根据上下文开关拼出发给 Host 的 context。
 * 关掉文件但保留选中代码时，仍带上 selectionPath 让模型知道代码来源。
 * @returns {null | { root?: string, path?: string, content?: string, language?: string, selection?: string, selectionPath?: string, selectionLine?: number }}
 */
function gufaChatBuildContext(options) {
  const source = options !== null && typeof options === 'object' ? options : {}
  const project = source.project !== null && typeof source.project === 'object' ? source.project : null
  const activeFile = source.activeFile !== null && typeof source.activeFile === 'object' ? source.activeFile : null
  const selection = source.selection !== null && typeof source.selection === 'object' ? source.selection : null
  const useFile = source.attachFile !== false && activeFile !== null
  const useSelection = source.attachSelection !== false && selection !== null && typeof selection.text === 'string' && selection.text !== ''
  const context = {}
  if (project !== null && typeof project.root === 'string' && project.root !== '') context.root = project.root
  if (useSelection) {
    context.selection = selection.text
    if (typeof selection.path === 'string' && selection.path !== '') context.selectionPath = selection.path
    if (typeof selection.line === 'number' && Number.isFinite(selection.line) && selection.line > 0) context.selectionLine = Math.trunc(selection.line)
  }
  if (useFile) {
    if (typeof activeFile.path === 'string' && activeFile.path !== '') context.path = activeFile.path
    if (typeof activeFile.content === 'string') context.content = activeFile.content
    if (typeof activeFile.language === 'string' && activeFile.language !== '') context.language = activeFile.language
  } else if (useSelection && context.path === undefined) {
    context.path = selection.path
  }
  return Object.keys(context).length === 0 ? null : context
}

/**
 * 把本地会话消息转换成请求用的 messages 数组。
 * 出错/空内容的消息不发给模型，避免把错误提示当成对话历史。
 * @param {Array<{ role: string, content?: string, error?: string }>} messages
 * @returns {Array<{ role: 'user' | 'assistant', content: string }>}
 */
function gufaChatRequestMessages(messages) {
  if (!Array.isArray(messages)) return []
  const result = []
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (typeof message.error === 'string' && message.error !== '') continue
    const content = typeof message.content === 'string' ? message.content.trim() : ''
    if (content === '') continue
    result.push({ role: message.role, content })
  }
  return result
}

/* ── 工具 ─────────────────────────────────────────────────────────────── */

/** 确保聊天面板样式已注入；返回清理函数（无样式时为空操作）。 */
function gufaChatEnsureStyles() {
  const id = 'gufa-code/chat'
  if (document.querySelector(`style[data-gufa="${id}"]`) !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.gufa = id
  style.textContent = GUFA_CHAT_CSS
  document.head.append(style)
  return () => style.remove()
}

/** 复制文本：优先 Clipboard API，失败时回落到临时 textarea。 */
function gufaChatCopyText(text) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  if (value === '') return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(value).catch(() => {})
      return true
    }
  } catch {
    /* 回落到 execCommand */
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/* ── 小组件 ───────────────────────────────────────────────────────────── */

/** 行内 markdown-lite 渲染（粗体 / 行内代码 / 纯文本）。 */
function GufaChatInline(props) {
  const tokens = gufaChatInline(props.text)
  return h(
    React.Fragment,
    null,
    tokens.map((token, index) => {
      if (token.type === 'bold') return h('strong', { key: index }, token.text)
      if (token.type === 'code') return h('code', { key: index, className: 'gufa-chat-inline-code' }, token.text)
      return h(React.Fragment, { key: index }, token.text)
    }),
  )
}

/** 普通文本块：按行渲染，空行留出间距（列表等简化为纯文本行）。 */
function GufaChatMarkdownText(props) {
  const lines = String(props.text ?? '').split('\n')
  return h(
    'div',
    { className: 'gufa-chat-text' },
    lines.map((line, index) => (
      line.trim() === ''
        ? h('div', { key: index, className: 'gufa-chat-gap' })
        : h('div', { key: index, className: 'gufa-chat-line' }, h(GufaChatInline, { text: line }))
    )),
  )
}

/** 代码块：语言标签 + 复制 + 插入到编辑器。 */
function GufaChatCode(props) {
  const t = G.useT()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => () => {
    if (timerRef.current !== 0) window.clearTimeout(timerRef.current)
  }, [])
  const code = typeof props.code === 'string' ? props.code : ''
  const canInsert = typeof props.onInsert === 'function'
  const onCopy = useCallback(() => {
    if (!gufaChatCopyText(code)) return
    setCopied(true)
    if (timerRef.current !== 0) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      setCopied(false)
    }, 1500)
  }, [code])
  const onInsert = useCallback(() => {
    if (typeof props.onInsert === 'function') props.onInsert(code)
  }, [props.onInsert, code])
  return h(
    'div',
    { className: 'gufa-chat-code' },
    h(
      'div',
      { className: 'gufa-chat-code-head' },
      h('span', { className: 'gufa-chat-code-lang' }, props.lang === undefined || props.lang === '' ? 'code' : props.lang),
      h('span', { className: 'gufa-chat-fill' }),
      h(
        'button',
        { type: 'button', className: 'gufa-chat-code-btn', title: t('chat.copy'), onClick: onCopy },
        h(G.Icon, { name: copied ? 'check' : 'files', size: 11 }),
        copied ? t('chat.copied') : t('chat.copy'),
      ),
      canInsert
        ? h(
            'button',
            { type: 'button', className: 'gufa-chat-code-btn', title: t('chat.insert'), onClick: onInsert },
            h(G.Icon, { name: 'code', size: 11 }),
            t('chat.insert'),
          )
        : null,
    ),
    h('pre', { className: 'gufa-chat-code-body gufa-scroll' }, h('code', null, code)),
  )
}

/** AI 消息正文：markdown-lite 块渲染。 */
function GufaChatAssistantBody(props) {
  const blocks = useMemo(() => gufaChatParseMarkdown(props.text), [props.text])
  return h(
    React.Fragment,
    null,
    blocks.map((block, index) => (
      block.type === 'code'
        ? h(GufaChatCode, { key: index, lang: block.lang, code: block.text, onInsert: props.onInsert })
        : h(GufaChatMarkdownText, { key: index, text: block.text })
    )),
  )
}

/** 单条消息气泡。 */
function GufaChatMessageView(props) {
  const t = G.useT()
  const message = props.message
  const isUser = message.role === 'user'
  const streaming = props.streaming === true
  const thinking = props.thinking === true
  return h(
    'div',
    { className: 'gufa-chat-msg', 'data-role': isUser ? 'user' : 'assistant' },
    isUser ? null : h('div', { className: 'gufa-chat-avatar' }, h(G.Icon, { name: 'sparkles', size: 12 })),
    h(
      'div',
      { className: 'gufa-chat-bubble' },
      isUser
        ? h('div', { className: 'gufa-chat-usertext' }, message.content)
        : h(GufaChatAssistantBody, { text: message.content, onInsert: props.onInsert }),
      message.error !== undefined && message.error !== ''
        ? h(
            'div',
            { className: 'gufa-chat-error' },
            h(G.Icon, { name: 'warn', size: 12 }),
            h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, message.error),
          )
        : null,
      thinking ? h('div', { className: 'gufa-chat-thinking' }, h(G.Spinner), t('chat.thinking')) : null,
      streaming && !thinking && message.content !== '' ? h('span', { className: 'gufa-chat-caret' }) : null,
    ),
  )
}

/* ── 主组件：G.ChatPanel ─────────────────────────────────────────────── */

G.ChatPanel = function ChatPanel(props) {
  const t = G.useT()
  const project = props.project !== null && typeof props.project === 'object' ? props.project : null
  const activeFile = props.activeFile !== null && typeof props.activeFile === 'object' ? props.activeFile : null
  const selection = props.selection !== null && typeof props.selection === 'object' && typeof props.selection.text === 'string' && props.selection.text !== ''
    ? props.selection
    : null
  const root = project !== null && typeof project.root === 'string' ? project.root : ''
  const insertCode = typeof props.onInsertCode === 'function' ? props.onInsertCode : null

  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState('')
  const [info, setInfo] = useState({ provider: '', model: '', ready: false })
  const [infoError, setInfoError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [attachFile, setAttachFile] = useState(true)
  const [attachSelection, setAttachSelection] = useState(true)

  const conversationsRef = useRef([])
  const activeIdRef = useRef(null)
  const rootRef = useRef(root)
  const loadedRootRef = useRef(null)
  const streamRef = useRef(null)
  const watchdogRef = useRef(0)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const headRef = useRef(null)
  const stickRef = useRef(true)
  const mountedRef = useRef(true)

  /* ── 样式注入 ─────────────────────────────────────────────────────── */
  useEffect(() => gufaChatEnsureStyles(), [])

  /* ── 模型信息（chat.info） ────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await G.api('chat.info')
        if (cancelled) return
        setInfo({
          provider: value !== null && typeof value === 'object' && typeof value.provider === 'string' ? value.provider : '',
          model: value !== null && typeof value === 'object' && typeof value.model === 'string' ? value.model : '',
          ready: value !== null && typeof value === 'object' && value.ready === true,
        })
        setInfoError('')
      } catch (error) {
        if (!cancelled) setInfoError(G.errorText(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── 会话库读写 ───────────────────────────────────────────────────── */
  const persist = useCallback((nextConversations, nextActiveId) => {
    const ok = gufaChatSaveStore(rootRef.current, nextConversations, nextActiveId)
    if (!ok) setNotice('本地对话历史保存失败：浏览器存储空间不足。')
    return ok
  }, [])

  /* 项目切换：换一个项目就换一份会话库（同一个项目跨刷新保留）。 */
  useEffect(() => {
    if (loadedRootRef.current === root) return
    loadedRootRef.current = root
    rootRef.current = root
    const current = streamRef.current
    if (current !== null) {
      streamRef.current = null
      try {
        if (typeof current.abort === 'function') current.abort()
      } catch {
        /* ignore */
      }
    }
    if (watchdogRef.current !== 0) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = 0
    }
    setStreaming(false)
    setThinking(false)
    const store = gufaChatLoadStore(root)
    conversationsRef.current = store.conversations
    activeIdRef.current = store.activeId
    setConversations(store.conversations)
    setActiveId(store.activeId)
    setHistoryOpen(false)
    setNotice('')
    stickRef.current = true
  }, [root])

  /* 卸载：中止进行中的请求，并把已收到的部分内容落盘。 */
  useEffect(() => () => {
    mountedRef.current = false
    if (watchdogRef.current !== 0) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = 0
    }
    const current = streamRef.current
    streamRef.current = null
    if (current !== null) {
      try {
        if (typeof current.abort === 'function') current.abort()
      } catch {
        /* ignore */
      }
      const finalized = conversationsRef.current.map((conversation) => {
        if (conversation.id !== current.conversationId) return conversation
        return {
          ...conversation,
          messages: conversation.messages.map((message) => (
            message.id === current.assistantId && typeof message.content === 'string' && message.content === ''
              ? { ...message, content: GUFA_CHAT_LABELS.stopped }
              : message
          )),
        }
      })
      conversationsRef.current = finalized
      gufaChatSaveStore(rootRef.current, finalized, activeIdRef.current)
    }
  }, [])

  /* ── 状态提交 ─────────────────────────────────────────────────────── */
  const commitConversations = useCallback((nextConversations, nextActiveId, persistNow) => {
    conversationsRef.current = nextConversations
    setConversations(nextConversations)
    if (nextActiveId !== undefined) {
      activeIdRef.current = nextActiveId
      setActiveId(nextActiveId)
    }
    if (persistNow !== false) persist(nextConversations, activeIdRef.current)
  }, [persist])

  const mutateConversation = useCallback((conversationId, updater, persistNow) => {
    const previous = conversationsRef.current
    const index = previous.findIndex((item) => item.id === conversationId)
    if (index < 0) return
    const nextConversation = updater(previous[index])
    if (nextConversation === previous[index]) return
    const next = previous.slice()
    next[index] = nextConversation
    conversationsRef.current = next
    setConversations(next)
    if (persistNow !== false) persist(next, activeIdRef.current)
  }, [persist])

  /* ── 滚动跟随 ─────────────────────────────────────────────────────── */
  const onScroll = useCallback(() => {
    const node = listRef.current
    if (node === null) return
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
  }, [])

  useEffect(() => {
    const node = listRef.current
    if (node !== null && stickRef.current) node.scrollTop = node.scrollHeight
  }, [conversations, activeId, thinking, streaming])

  /* ── 流式请求生命周期 ─────────────────────────────────────────────── */
  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== 0) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = 0
    }
  }, [])

  const finishStream = useCallback((conversationId, assistantId, errorMessage) => {
    const current = streamRef.current
    if (current === null || current.assistantId !== assistantId) return
    streamRef.current = null
    clearWatchdog()
    setStreaming(false)
    setThinking(false)
    mutateConversation(conversationId, (conversation) => {
      const messages = conversation.messages.map((message) => {
        if (message.id !== assistantId) return message
        const content = typeof message.content === 'string' ? message.content : ''
        if (typeof errorMessage === 'string' && errorMessage !== '') return { ...message, content, error: errorMessage }
        if (content.trim() === '') return { ...message, content: GUFA_CHAT_LABELS.emptyReply }
        return { ...message, content }
      })
      return { ...conversation, messages, updatedAt: Date.now() }
    }, true)
  }, [clearWatchdog, mutateConversation])

  const handleStreamEvent = useCallback((conversationId, assistantId, event) => {
    const current = streamRef.current
    if (current === null || current.assistantId !== assistantId) return
    if (event === null || typeof event !== 'object') return
    if (event.type === 'thinking') {
      setThinking(true)
      return
    }
    if (event.type === 'delta') {
      const text = typeof event.text === 'string' ? event.text : ''
      if (text === '') return
      setThinking(false)
      mutateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => (
          message.id === assistantId ? { ...message, content: `${message.content ?? ''}${text}` } : message
        )),
      }), false)
      return
    }
    if (event.type === 'error') {
      finishStream(conversationId, assistantId, typeof event.message === 'string' && event.message !== '' ? event.message : t('chat.error'))
      return
    }
    if (event.type === 'done') finishStream(conversationId, assistantId, '')
  }, [finishStream, mutateConversation, t])

  const armWatchdog = useCallback((conversationId, assistantId) => {
    clearWatchdog()
    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = 0
      const current = streamRef.current
      if (current === null || current.assistantId !== assistantId) return
      const abort = current.abort
      finishStream(conversationId, assistantId, '响应超时：长时间没有收到 AI 回复，请重试。')
      try {
        if (typeof abort === 'function') abort()
      } catch {
        /* ignore */
      }
    }, GUFA_CHAT_WATCHDOG_MS)
  }, [clearWatchdog, finishStream])

  const sendMessage = useCallback((overrideText) => {
    const raw = typeof overrideText === 'string' ? overrideText : input
    const text = raw.trim()
    if (text === '' || streamRef.current !== null) return
    const now = Date.now()
    let conversation = conversationsRef.current.find((item) => item.id === activeIdRef.current) ?? null
    let nextConversations = conversationsRef.current
    if (conversation === null) {
      conversation = { id: gufaChatNewId(), title: '', messages: [], updatedAt: now }
      nextConversations = [conversation, ...nextConversations].slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    }
    const assistantId = gufaChatNewId()
    const userMessage = { id: gufaChatNewId(), role: 'user', content: text, at: now }
    const assistantMessage = { id: assistantId, role: 'assistant', content: '', at: now }
    const history = gufaChatRequestMessages(conversation.messages)
    const title = conversation.title === '' ? gufaChatTitleOf(text) : conversation.title
    const updated = {
      ...conversation,
      title,
      messages: [...conversation.messages, userMessage, assistantMessage],
      updatedAt: now,
    }
    nextConversations = [updated, ...nextConversations.filter((item) => item.id !== updated.id)]
      .slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    commitConversations(nextConversations, updated.id, true)
    setInput('')
    setNotice('')
    setThinking(true)
    setStreaming(true)
    stickRef.current = true
    const payload = { messages: [...history, { role: 'user', content: text }] }
    const context = gufaChatBuildContext({ project, activeFile, selection, attachFile, attachSelection })
    if (context !== null) payload.context = context
    streamRef.current = { conversationId: updated.id, assistantId, abort: null }
    armWatchdog(updated.id, assistantId)
    try {
      const abort = G.stream('chat.stream', payload, (event) => handleStreamEvent(updated.id, assistantId, event))
      const current = streamRef.current
      if (current !== null && current.assistantId === assistantId) current.abort = abort
    } catch (error) {
      finishStream(updated.id, assistantId, G.errorText(error))
    }
  }, [input, project, activeFile, selection, attachFile, attachSelection, commitConversations, handleStreamEvent, armWatchdog, finishStream])

  const stopStream = useCallback(() => {
    const current = streamRef.current
    if (current === null) return
    streamRef.current = null
    clearWatchdog()
    try {
      if (typeof current.abort === 'function') current.abort()
    } catch {
      /* ignore */
    }
    setStreaming(false)
    setThinking(false)
    mutateConversation(current.conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (message.id !== current.assistantId) return message
        const content = typeof message.content === 'string' ? message.content : ''
        return { ...message, content: content === '' ? `（${t('chat.stop')}）` : content, stopped: true }
      }),
      updatedAt: Date.now(),
    }), true)
  }, [clearWatchdog, mutateConversation, t])

  /* ── 会话操作 ─────────────────────────────────────────────────────── */
  const startNewConversation = useCallback(() => {
    stopStream()
    const current = conversationsRef.current
    const reusable = current.find((item) => item.messages.length === 0) ?? null
    if (reusable !== null) {
      commitConversations(current, reusable.id, true)
      setHistoryOpen(false)
      return
    }
    const conversation = { id: gufaChatNewId(), title: '', messages: [], updatedAt: Date.now() }
    const next = [conversation, ...current].slice(0, GUFA_CHAT_CONVERSATION_LIMIT)
    commitConversations(next, conversation.id, true)
    setHistoryOpen(false)
    setNotice('')
    window.setTimeout(() => {
      if (inputRef.current !== null) inputRef.current.focus()
    }, 0)
  }, [stopStream, commitConversations])

  const selectConversation = useCallback((conversationId) => {
    setHistoryOpen(false)
    if (conversationId === activeIdRef.current) return
    stopStream()
    const exists = conversationsRef.current.some((item) => item.id === conversationId)
    if (!exists) return
    activeIdRef.current = conversationId
    setActiveId(conversationId)
    setNotice('')
    stickRef.current = true
    persist(conversationsRef.current, conversationId)
  }, [stopStream, persist])

  const deleteConversation = useCallback((conversationId) => {
    const current = streamRef.current
    if (current !== null && current.conversationId === conversationId) stopStream()
    const next = conversationsRef.current.filter((item) => item.id !== conversationId)
    const nextActive = activeIdRef.current === conversationId ? (next[0]?.id ?? null) : activeIdRef.current
    commitConversations(next, nextActive, true)
  }, [stopStream, commitConversations])

  const clearActiveConversation = useCallback(() => {
    const conversationId = activeIdRef.current
    if (conversationId === null) return
    const current = streamRef.current
    if (current !== null && current.conversationId === conversationId) stopStream()
    mutateConversation(conversationId, (conversation) => ({ ...conversation, messages: [], title: '', updatedAt: Date.now() }), true)
    setNotice('')
    setHistoryOpen(false)
  }, [stopStream, mutateConversation])

  /* ── 输入框 ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const node = inputRef.current
    if (node === null) return
    node.style.height = 'auto'
    const maxHeight = 168
    const height = Math.min(node.scrollHeight, maxHeight)
    node.style.height = `${Math.max(height, 34)}px`
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [input])

  const onChangeInput = useCallback((event) => setInput(event.target.value), [])

  const onInputKeyDown = useCallback((event) => {
    const composing = event.nativeEvent !== undefined && event.nativeEvent !== null
      ? event.nativeEvent.isComposing === true
      : event.isComposing === true
    if (event.key !== 'Enter' || event.shiftKey || composing) return
    event.preventDefault()
    if (streamRef.current !== null) return
    sendMessage()
  }, [sendMessage])

  /* ── 历史下拉：点击外部关闭 ───────────────────────────────────────── */
  useEffect(() => {
    if (!historyOpen) return undefined
    const onPointerDown = (event) => {
      const node = headRef.current
      if (node !== null && node.contains(event.target)) return
      setHistoryOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown, true)
    return () => window.removeEventListener('mousedown', onPointerDown, true)
  }, [historyOpen])

  /* ── 渲染数据 ─────────────────────────────────────────────────────── */
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId) ?? null,
    [conversations, activeId],
  )
  const activeMessages = activeConversation !== null && Array.isArray(activeConversation.messages) ? activeConversation.messages : []
  const streamingId = streamRef.current !== null ? streamRef.current.assistantId : null
  const hasEditorContext = activeFile !== null || selection !== null
  const modelText = info.model === ''
    ? '—'
    : `${info.provider === '' ? '' : `${info.provider} / `}${info.model}`
  const modelTitle = infoError !== ''
    ? `${t('chat.model')}：${infoError}`
    : info.ready
      ? `${t('chat.model')}：${modelText}`
      : `${t('chat.model')}：${modelText}（${GUFA_CHAT_LABELS.notReady}）`

  const quickActions = [
    { key: 'explain', label: t('chat.quickExplain'), prompt: '请解释我提供的这段代码：它做了什么、关键逻辑是什么、有哪些需要注意的边界情况。' },
    { key: 'bug', label: t('chat.quickBug'), prompt: '请检查我提供的这段代码可能存在的问题（bug、边界条件、性能、可读性），并给出修改建议。' },
    { key: 'comment', label: t('chat.quickComment'), prompt: '请为我提供的这段代码补充简洁清晰的中文注释，直接给出注释后的完整代码。' },
    { key: 'refactor', label: t('chat.quickRefactor'), prompt: '请给出我提供的这段代码的重构建议，并给出重构后的完整代码。' },
  ]

  /* ── 历史下拉列表 ─────────────────────────────────────────────────── */
  const historyMenu = historyOpen
    ? h(
        'div',
        { className: 'gufa-chat-history' },
        h(
          'div',
          { className: 'gufa-chat-history-head' },
          h(G.Icon, { name: 'history', size: 11 }),
          t('chat.history'),
          h('span', { className: 'gufa-chat-fill' }),
          h(
            'button',
            {
              type: 'button',
              className: 'gufa-chat-code-btn',
              title: t('chat.clear'),
              disabled: activeMessages.length === 0 && activeConversation === null,
              onClick: clearActiveConversation,
            },
            h(G.Icon, { name: 'trash', size: 11 }),
            t('chat.clear'),
          ),
        ),
        conversations.length === 0
          ? h('div', { className: 'gufa-chat-history-empty' }, t('chat.noHistory'))
          : h(
              'div',
              { className: 'gufa-chat-history-list gufa-scroll' },
              conversations.map((conversation) => h(
                'div',
                {
                  key: conversation.id,
                  className: 'gufa-chat-history-item',
                  'data-active': conversation.id === activeId ? '' : undefined,
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'gufa-chat-history-main',
                    title: conversation.title === '' ? GUFA_CHAT_LABELS.newConversation : conversation.title,
                    onClick: () => selectConversation(conversation.id),
                  },
                  h('span', { className: 'gufa-chat-history-title' }, conversation.title === '' ? GUFA_CHAT_LABELS.newConversation : conversation.title),
                  h('span', { className: 'gufa-chat-history-time' }, gufaChatRelativeTime(conversation.updatedAt)),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'gufa-chat-history-del',
                    title: t('chat.deleteChat'),
                    onClick: (event) => {
                      event.stopPropagation()
                      deleteConversation(conversation.id)
                    },
                  },
                  h(G.Icon, { name: 'trash', size: 12 }),
                ),
              )),
            ),
        h(
          'div',
          { className: 'gufa-chat-history-foot' },
          h(
            G.Button,
            { icon: 'plus', onClick: startNewConversation },
            t('chat.newChat'),
          ),
        ),
      )
    : null

  /* ── 消息列表 ─────────────────────────────────────────────────────── */
  const messageList = activeMessages.length === 0
    ? h(G.Empty, { icon: 'sparkles', title: t('chat.emptyTitle'), hint: t('chat.emptyHint') })
    : activeMessages.map((message) => h(GufaChatMessageView, {
        key: message.id,
        message,
        streaming: streaming && message.id === streamingId,
        thinking: thinking && message.id === streamingId,
        onInsert: insertCode,
      }))

  /* ── 渲染 ─────────────────────────────────────────────────────────── */
  return h(
    'div',
    { className: 'gufa-chat-wrap' },
    h(
      'div',
      { className: 'gufa-chat-headwrap', ref: headRef },
      h(
        'div',
        { className: 'gufa-panel-head gufa-chat-head' },
        h(G.Icon, { name: 'sparkles', size: 13 }),
        h('span', { className: 'gufa-panel-head-title' }, t('chat.title')),
        h('span', { className: 'gufa-chat-model', title: modelTitle, 'data-warn': info.ready ? undefined : '' }, modelText),
        h(
          G.IconButton,
          { title: t('chat.history'), onClick: () => setHistoryOpen((value) => !value) },
          h(G.Icon, { name: 'history', size: 14 }),
        ),
        h(
          G.IconButton,
          { title: t('chat.newChat'), onClick: startNewConversation },
          h(G.Icon, { name: 'plus', size: 14 }),
        ),
      ),
      historyMenu,
    ),
    h(
      'div',
      { className: 'gufa-chat-msgs gufa-scroll', ref: listRef, onScroll },
      messageList,
    ),
    h(
      'div',
      { className: 'gufa-chat-composer' },
      h(
        'div',
        { className: 'gufa-chat-context' },
        h('span', { className: 'gufa-chat-context-label' }, t('chat.contextLabel')),
        activeFile !== null
          ? h(
              'button',
              {
                type: 'button',
                className: 'gufa-chat-chip',
                'data-on': attachFile ? '' : undefined,
                title: `${t('chat.ctxFile')}：${activeFile.path ?? ''}${attachFile ? '' : `（${t('chat.attachFile')}）`}`,
                onClick: () => setAttachFile((value) => !value),
              },
              h(G.Icon, { name: 'file', size: 11 }),
              h('span', { className: 'gufa-chat-chip-text' }, G.basename(activeFile.path)),
            )
          : null,
        selection !== null
          ? h(
              'button',
              {
                type: 'button',
                className: 'gufa-chat-chip',
                'data-on': attachSelection ? '' : undefined,
                title: `${t('chat.ctxSelection')}${selection.path ? `：${selection.path}` : ''}`,
                onClick: () => setAttachSelection((value) => !value),
              },
              h(G.Icon, { name: 'code', size: 11 }),
              h('span', { className: 'gufa-chat-chip-text' },
                selection.line === undefined || selection.line === null
                  ? t('chat.ctxSelection')
                  : `${t('chat.ctxSelection')} · ${selection.line}`,
              ),
            )
          : null,
        activeFile === null && selection === null
          ? h('span', { className: 'gufa-chat-context-hint' }, GUFA_CHAT_LABELS.openFileHint)
          : null,
      ),
      h(
        'div',
        { className: 'gufa-chat-quick' },
        quickActions.map((action) => h(
          'button',
          {
            key: action.key,
            type: 'button',
            className: 'gufa-chat-quick-btn',
            disabled: !hasEditorContext || streaming,
            title: hasEditorContext ? action.label : GUFA_CHAT_LABELS.openFileHint,
            onClick: () => sendMessage(action.prompt),
          },
          action.label,
        )),
      ),
      notice !== ''
        ? h(
            'div',
            { className: 'gufa-chat-notice' },
            h(G.Icon, { name: 'warn', size: 12 }),
            h('span', { className: 'gufa-chat-notice-text' }, notice),
            h(
              'button',
              { type: 'button', className: 'gufa-chat-notice-close', title: t('common.close'), onClick: () => setNotice('') },
              h(G.Icon, { name: 'close', size: 11 }),
            ),
          )
        : null,
      h(
        'div',
        { className: 'gufa-chat-inputwrap' },
        h('textarea', {
          ref: inputRef,
          className: 'gufa-chat-input gufa-scroll',
          rows: 1,
          value: input,
          placeholder: t('chat.inputPlaceholder'),
          spellCheck: false,
          onChange: onChangeInput,
          onKeyDown: onInputKeyDown,
        }),
        streaming
          ? h(
              'button',
              { type: 'button', className: 'gufa-chat-send', 'data-stop': '', title: t('chat.stop'), onClick: stopStream },
              h(G.Icon, { name: 'stop', size: 12 }),
              t('chat.stop'),
            )
          : h(
              'button',
              {
                type: 'button',
                className: 'gufa-chat-send',
                disabled: input.trim() === '',
                title: t('chat.send'),
                onClick: () => sendMessage(),
              },
              h(G.Icon, { name: 'send', size: 12 }),
              t('chat.send'),
            ),
      ),
      h(
        'div',
        { className: 'gufa-chat-foot' },
        h('span', { className: 'gufa-chat-foot-dim' }, GUFA_CHAT_LABELS.ctrlHint),
        h('span', { className: 'gufa-chat-foot-dim' }, activeConversation === null
          ? GUFA_CHAT_LABELS.newConversation
          : `${activeMessages.length} · ${conversations.length}/${GUFA_CHAT_CONVERSATION_LIMIT}`),
      ),
    ),
  )
}

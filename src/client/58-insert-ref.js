/**
 * 58-insert-ref：把系统剪贴板里的文件粘贴进对话输入框时，插入 `@相对路径` 引用。
 *
 * 浏览器/Electron 的剪贴板只给 File 内容、不给磁盘路径，所以流程是：
 * File → 名称/size/sha256 → Host(fs.matchFiles) 在项目内匹配同名同内容文件 → 插入 @引用。
 * 图片保持 DSH 默认的附件行为（不拦截）。
 */

/** 轻量提示条（复用 drag-ref 的观感）。 */
G.refToast = function refToast(text, kind) {
  try {
    let host = document.getElementById('gufa-ref-toast')
    if (host === null) {
      host = document.createElement('div')
      host.id = 'gufa-ref-toast'
      host.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483000;max-width:70vw;padding:7px 14px;border-radius:999px;font:12px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px rgba(16,24,40,.18);pointer-events:none;white-space:pre-wrap'
      document.body.appendChild(host)
    }
    host.textContent = String(text)
    host.style.background = kind === 'err' ? 'rgba(180,35,24,.92)' : kind === 'ok' ? 'rgba(6,118,71,.92)' : 'rgba(28,30,38,.92)'
    host.style.color = '#fff'
    clearTimeout(G.refToast.timer)
    G.refToast.timer = window.setTimeout(() => {
      if (host.parentNode !== null) host.parentNode.removeChild(host)
    }, 3200)
  } catch {
    /* ignore */
  }
}

/** 把相对路径变成 @ 引用文本（含空格的路径加引号）。 */
G.mentionOfPath = function mentionOfPath(path) {
  const rel = String(path ?? '').replace(/\\/g, '/')
  if (rel === '') return ''
  return /\s/u.test(rel) ? `@"${rel}"` : `@${rel}`
}

/** 取文件 sha256（hex）。 */
G.sha256OfFile = async function sha256OfFile(file) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 把文本插入当前对话输入框：优先官方 input 服务，失败退回 contenteditable 插入。 */
G.insertIntoComposer = function insertIntoComposer(text) {
  if (typeof text !== 'string' || text === '') return false
  try {
    const sessionEl = document.querySelector('[data-conversation-session]')
    const sessionId = sessionEl === null ? '' : String(sessionEl.getAttribute('data-conversation-session') ?? '')
    const sessions = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('sessions')
    const conversation = G.ctx === null || G.ctx === undefined ? undefined : G.ctx.get('conversation')
    if (sessionId !== '' && sessions !== undefined && conversation !== undefined && typeof sessions.scope === 'function') {
      const actx = sessions.scope(sessionId)
      if (actx !== undefined) {
        const input = conversation.input.for(actx)
        const snapshot = input?.state?.getSnapshot?.()
        if (snapshot !== undefined && input !== null && input !== undefined) {
          const offset = String(snapshot.draft ?? '').length
          const span = { start: offset, end: offset, draftRev: snapshot.draftRev }
          if (typeof input.insertText === 'function' && input.insertText(text, span) === true) return true
          if (typeof input.insertReference === 'function') {
            const mention = G.mentionOfPath(text.replace(/^@/, ''))
            if (mention !== '' && input.insertReference({ source: 'reference', ref: mention, label: text.replace(/^@/, ''), appearance: 'file', clipboardText: mention }, span) === true) return true
          }
        }
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const editor = document.querySelector('[data-conversation-region="composer"] [contenteditable="true"]') || document.querySelector('[data-conversation-region="composer"]')
    if (editor === null) return false
    editor.focus()
    if (document.execCommand('insertText', false, text)) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * 安装「粘贴文件 → @引用」监听。
 * @param {object} ctx client 根 context
 * @returns {() => void} 卸载器
 */
G.installChatFilePaste = function installChatFilePaste(ctx) {
  if (typeof document === 'undefined') return () => {}
  let disposed = false

  const handleFiles = async (files) => {
    const list = Array.from(files)
    if (list.length === 0) return
    const root = typeof G.projectRoot === 'string' ? G.projectRoot : ''
    if (root === '') {
      G.refToast('还没有打开项目，无法把文件转成 @ 引用', 'err')
      return
    }
    const payloads = []
    for (const file of list) {
      try {
        payloads.push({ name: file.name !== '' ? file.name : 'file', size: file.size, sha256: await G.sha256OfFile(file) })
      } catch {
        /* 读取失败的文件跳过 */
      }
    }
    if (payloads.length === 0) {
      G.refToast('粘贴的文件读取失败', 'err')
      return
    }
    let matches = []
    try {
      const result = await G.api('fs.matchFiles', { root, files: payloads })
      matches = Array.isArray(result?.matches) ? result.matches : []
    } catch (error) {
      G.refToast(`匹配项目文件失败：${G.errorText(error)}`, 'err')
      return
    }
    if (disposed) return
    const refs = []
    const missing = []
    for (const match of matches) {
      if (typeof match?.path === 'string' && match.path !== '') refs.push(G.mentionOfPath(match.path))
      else missing.push(String(match?.name ?? ''))
    }
    if (refs.length > 0) {
      const inserted = G.insertIntoComposer(refs.join(' ') + ' ')
      if (inserted) G.refToast(`已插入 ${refs.length} 个文件引用`, 'ok')
      else G.refToast('插入引用失败：输入框不可用', 'err')
    }
    if (missing.length > 0) {
      G.refToast(`${missing.join('、')} 不在当前项目里，未插入引用（可先粘贴到资源管理器导入项目）`, 'err')
    }
  }

  const onPaste = (event) => {
    const files = event.clipboardData === null || event.clipboardData === undefined ? undefined : event.clipboardData.files
    if (files === undefined || files === null || files.length === 0) return
    const target = event.target
    const inConversation = target instanceof Element && (target.closest('[data-conversation-region="composer"]') !== null || target.closest('[data-conversation-content]') !== null)
    if (!inConversation) return
    const list = Array.from(files)
    /* 图片保留 DSH 默认的附件粘贴行为 */
    if (list.every((file) => typeof file.type === 'string' && file.type.startsWith('image/'))) return
    event.preventDefault()
    event.stopPropagation()
    void handleFiles(list)
  }

  document.addEventListener('paste', onPaste, true)
  return () => {
    disposed = true
    document.removeEventListener('paste', onPaste, true)
  }
}

/**
 * 项目：打开 / 新建 / 校验。只有这里登记过的目录，fs/git/terminal 才允许访问。
 */
import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { ApiError, badRequest } from './context.js'
import { debugLog } from './dev.js'

async function describeDirectory(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') throw badRequest('path is required')
  if (!isAbsolute(rawPath)) throw badRequest('path must be absolute')
  const absolute = resolve(rawPath)
  let canonical
  try {
    canonical = await realpath(absolute)
  } catch {
    throw new ApiError('not-found', `目录不存在：${absolute}`, 404)
  }
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new ApiError('not-directory', `不是目录：${canonical}`, 400)
  return { canonical, info }
}

export function register(router, env) {
  router.method('project.open', async (body) => {
    const project = await env.projects.open(body.path)
    return project
  })

  router.method('project.validate', async (body) => {
    const { canonical, info } = await describeDirectory(body.path)
    const isGit = await stat(resolve(canonical, '.git')).then(() => true, () => false)
    return { root: canonical, name: canonical.split(sep).filter(Boolean).at(-1) ?? canonical, isGit, mtimeMs: info.mtimeMs }
  })

  router.method('project.create', async (body) => {
    if (typeof body.name !== 'string' || body.name.trim() === '') throw badRequest('项目名不能为空')
    const name = body.name.trim()
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw badRequest('项目名包含非法字符')
    if (typeof body.parent !== 'string' || !isAbsolute(body.parent)) throw badRequest('parent must be an absolute path')
    const { canonical: parentCanonical } = await describeDirectory(body.parent)
    const target = resolve(parentCanonical, name)
    try {
      await mkdir(target)
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'EEXIST') throw new ApiError('exists', '同名目录已存在', 409)
      throw error
    }
    return await env.projects.open(target)
  })

  router.method('project.list', async () => ({ projects: env.projects.list() }))

  router.method('project.forget', async (body) => {
    if (typeof body.root === 'string') env.projects.forget(body.root)
    return { projects: env.projects.list() }
  })

  /** 在 Host 上下文中惰性取服务（兼容 ctx.get 与属性两种访问方式）。 */
  function serviceOf(name) {
    const ctx = env.ctx
    if (ctx === null || ctx === undefined) return undefined
    try {
      if (typeof ctx.get === 'function') {
        const value = ctx.get(name)
        if (value !== undefined && value !== null) return value
      }
    } catch {
      /* 未注入时 ctx.get 可能抛错，继续尝试属性 */
    }
    try {
      return ctx[name]
    } catch {
      return undefined
    }
  }

  /** DSH 原生工作区列表（与经典模式同一份 workspaceRegistry 数据）。 */
  router.method('workspaces.list', async () => {
    const registry = serviceOf('workspaceRegistry')
    if (registry === undefined || registry === null || typeof registry.list !== 'function') {
      return { available: false, workspaces: [] }
    }
    let list = []
    try {
      list = registry.list()
    } catch {
      list = []
    }
    const workspaces = (Array.isArray(list) ? list : [])
      .map((item) => {
        const value = item !== null && typeof item === 'object' ? item : {}
        return {
          id: typeof value.id === 'string' ? value.id : '',
          path: typeof value.path === 'string' ? value.path : '',
          title: typeof value.title === 'string' && value.title !== '' ? value.title : '',
        }
      })
      .filter((item) => item.id !== '')
    return { available: true, workspaces }
  })

  /** 当前工作区的会话列表（标题/时间），复刻经典侧边栏的可见性规则：
   *  工作区 sessionIds 成员 → 排除归档 → 排除 subagent 子会话 → 隐藏 blank（空会话，当前会话除外）
   *  → 标题取自 sessionQuery.readTitleSnapshots / sessionTitle → 按更新时间倒序。 */
  router.method('workspaces.sessions', async (body) => {
    try {
      const controller = serviceOf('workspaceController')
      const registry = serviceOf('workspaceRegistry')
      const query = serviceOf('sessionQuery')
      const sessions = serviceOf('sessions')
      const titles = serviceOf('sessionTitle')

      let views = []
      let archivedSessionIds = []
      let source = 'controller'

      if (controller !== undefined && controller !== null && typeof controller.follow === 'function') {
        const abort = new AbortController()
        try {
          const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
          const first = await iterator.next()
          try {
            await iterator.return?.()
          } catch {
            /* ignore */
          }
          const frame = first?.value
          if (frame !== null && typeof frame === 'object' && (frame.type === 'baseline' || frame.type === 'replace') && frame.value !== null && typeof frame.value === 'object') {
            if (Array.isArray(frame.value.items)) views = frame.value.items
            if (Array.isArray(frame.value.archivedSessionIds)) archivedSessionIds = frame.value.archivedSessionIds
          }
        } catch {
          views = []
        } finally {
          abort.abort()
        }
      }
      if (views.length === 0 && registry !== undefined && registry !== null && typeof registry.list === 'function') {
        source = 'registry'
        try {
          views = registry.list().map((item) => ({
            workspaceId: item.id,
            path: item.path,
            title: item.title,
            sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds : [],
          }))
        } catch {
          views = []
        }
      }

      const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : ''
      const path = typeof body.path === 'string' ? body.path : ''
      const currentSessionId = typeof body.currentSessionId === 'string' ? body.currentSessionId : ''
      const target = views.find((item) => (workspaceId !== '' ? item.workspaceId === workspaceId : item.path === path))
      const membership = target !== undefined && Array.isArray(target.sessionIds) ? target.sessionIds.filter((id) => typeof id === 'string') : []
      const archivedSet = new Set(archivedSessionIds)

      /* 记录元信息：父子关系（subagent）与创建时间 */
      let records = []
      try {
        if (query !== undefined && query !== null && typeof query.listSessions === 'function') {
          records = await query.listSessions(new AbortController().signal)
        }
      } catch {
        records = []
      }
      const metaById = new Map()
      for (const record of Array.isArray(records) ? records : []) {
        if (record === null || typeof record !== 'object') continue
        const header = record.header !== null && typeof record.header === 'object' ? record.header : null
        const id = typeof header?.id === 'string' ? header.id : typeof record.id === 'string' ? record.id : ''
        if (id === '') continue
        const parentRaw = header?.parentSession ?? record.parentSession ?? record.parentSessionId ?? record.parentId
        const parent = typeof parentRaw === 'string' ? parentRaw : parentRaw !== null && typeof parentRaw === 'object' && typeof parentRaw.id === 'string' ? parentRaw.id : ''
        const depth = typeof header?.delegationDepth === 'number' ? header.delegationDepth : 0
        const createdAt = (() => {
          for (const value of [header?.createdAt, record.updatedAt, record.createdAt]) {
            if (typeof value === 'number' && Number.isFinite(value)) return value
            if (typeof value === 'string') {
              const parsed = Date.parse(value)
              if (Number.isFinite(parsed)) return parsed
            }
          }
          return 0
        })()
        metaById.set(id, { parent, depth, createdAt })
      }

      /* 标题：批量快照 → 逐个 readTitle → 会话服务兜底；记录哪些是"解析到了" */
      const titleById = new Map()
      const updatedAtById = new Map()
      const titleKnown = new Set()
      let titleError = ''
      let batchResolved = false
      try {
        if (query !== undefined && query !== null && typeof query.readTitleSnapshots === 'function' && membership.length > 0) {
          const snapshots = await query.readTitleSnapshots(membership, new AbortController().signal)
          if (snapshots !== null && typeof snapshots === 'object' && Object.keys(snapshots).length > 0) {
            batchResolved = true
            for (const id of membership) {
              const snapshot = snapshots[id] ?? snapshots.get?.(id)
              if (snapshot === null || snapshot === undefined) continue
              titleKnown.add(id)
              if (typeof snapshot.title === 'string') titleById.set(id, snapshot.title)
              if (typeof snapshot.updatedAt === 'number') updatedAtById.set(id, snapshot.updatedAt)
            }
          }
        }
      } catch (error) {
        titleError = error instanceof Error ? error.message : String(error)
      }
      if (titleKnown.size === 0 && query !== undefined && query !== null && typeof query.readTitle === 'function') {
        for (const id of membership) {
          try {
            const snapshot = await query.readTitle(id, new AbortController().signal)
            if (snapshot === null || snapshot === undefined) continue
            titleKnown.add(id)
            if (typeof snapshot.title === 'string') titleById.set(id, snapshot.title)
            if (typeof snapshot.updatedAt === 'number') updatedAtById.set(id, snapshot.updatedAt)
          } catch (error) {
            titleError = titleError === '' ? (error instanceof Error ? error.message : String(error)) : titleError
          }
        }
      }
      for (const id of membership) {
        if (titleById.get(id) !== undefined && titleById.get(id) !== '') continue
        try {
          if (sessions !== undefined && sessions !== null && typeof sessions.get === 'function') {
            const session = sessions.get(id)
            if (session !== null && session !== undefined) {
              if (titles !== undefined && titles !== null && typeof titles.get === 'function') {
                const snapshot = titles.get(session)
                if (snapshot !== null && snapshot !== undefined && typeof snapshot.title === 'string') titleById.set(id, snapshot.title)
              }
              if (titleById.get(id) === undefined && typeof session.title === 'string') titleById.set(id, session.title)
              if (updatedAtById.get(id) === undefined && typeof session.updatedAt === 'number') updatedAtById.set(id, session.updatedAt)
            }
          }
        } catch {
          /* ignore */
        }
      }

      const rows = []
      for (const id of membership) {
        if (archivedSet.has(id)) continue
        const meta = metaById.get(id)
        if (meta !== undefined && (meta.parent !== '' || meta.depth > 0)) continue
        const title = titleById.get(id) ?? ''
        const known = titleKnown.has(id)
        // blank 会话不会出现在标题快照结果里：批量解析成功但缺少该项 = blank；当前会话例外
        const blank = (known && title.trim() === '') || (batchResolved && !known)
        if (blank && id !== currentSessionId) continue
        rows.push({
          id,
          title,
          updatedAt: updatedAtById.get(id) ?? meta?.createdAt ?? 0,
        })
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt)

      debugLog(`sessions path=${path} membership=${membership.length} visible=${rows.length} titleKnown=${titleKnown.size} batch=${batchResolved} titleError=${titleError === '' ? '-' : titleError.slice(0, 120)} rows=${rows.map((row) => `${row.id.slice(8, 12)}:${String(row.title).slice(0, 10)}`).join('|')}`)
      return {
        available: true,
        source: source + '+membership',
        workspaceId: target !== undefined && typeof target.workspaceId === 'string' ? target.workspaceId : workspaceId,
        title: target !== undefined && typeof target.title === 'string' ? target.title : '',
        path: target !== undefined && typeof target.path === 'string' ? target.path : path,
        sessionIds: membership,
        archivedSessionIds,
        sessions: rows,
        groups: [{ workspaceId: target !== undefined && typeof target.workspaceId === 'string' ? target.workspaceId : workspaceId, title: target !== undefined && typeof target.title === 'string' ? target.title : '', path: target !== undefined && typeof target.path === 'string' ? target.path : path, sessions: rows }],
        debug: { membership: membership.length, visible: rows.length, archived: archivedSessionIds.length, records: Array.isArray(records) ? records.length : 0 },
      }
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error), sessions: [], groups: [], sessionIds: [], archivedSessionIds: [] }
    }
  })

  /** 新建工作区时的默认目录（用于选择器起点）。 */
  router.method('workspaces.defaultDirectory', async () => {
    let directory = ''
    try {
      const working = serviceOf('workingDirectory')
      if (working !== undefined && working !== null && typeof working.defaultDirectory === 'string') directory = working.defaultDirectory
    } catch {
      directory = ''
    }
    if (directory === '') {
      try {
        directory = (await import('node:os')).homedir()
      } catch {
        directory = ''
      }
    }
    return { directory }
  })

  router.method('project.home', async () => {
    const home = (await import('node:os')).homedir()
    return { home }
  })
}

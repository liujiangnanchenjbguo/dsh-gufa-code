/**
 * 离线验证 host/project.js 的 workspaces.sessions 是否与 DSH 经典侧边栏一致。
 * 数据源：磁盘真实数据（~/.dsh/storages/workspace.json + session_projcache）。
 * 校验三个场景：
 *   1) 正常：与经典侧边栏 8 条标题完全一致
 *   2) 标题服务异常：不能清空列表（退回成员列表，11 条）
 *   3) 新建 blank 会话：当前 blank 会话可见，其他 blank 仍隐藏（9 条）
 * 用法：node scripts/verify-workspace-sessions.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { register } from '../host/project.js'

const DSH = join(process.env.HOME ?? '/Users/jeff', '.dsh')
const WORKSPACE_ID = 'fa5d306e-891b-49a2-aa86-eab5af86627c'
const TARGET = '/Users/jeff/dsh'
const CURRENT = 'session-e0ec4210-fe5b-4587-a0c3-905eb6e8cd0d'
const NEW_ID = 'session-newblank-0000'

const snapshot = JSON.parse(readFileSync(join(DSH, 'storages/workspace.json'), 'utf8'))
const workspaces = Object.entries(snapshot.tables.workspaces).map(([id, value]) => ({
  workspaceId: id,
  path: value.path,
  title: value.title,
  sessionIds: value.sessionIds,
}))
const archivedSessionIds = snapshot.global.archivedSessionIds

const cacheOf = (sid) => {
  const file = join(DSH, 'storages/session_projcache/sessions', `${sid}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}
const titleOf = (sid) => {
  const value = cacheOf(sid)?.record?.rows?.title?.val
  return typeof value === 'string' ? value : ''
}
const records = [...new Set(workspaces.flatMap((workspace) => workspace.sessionIds))].map((sessionId) => {
  const cache = cacheOf(sessionId)
  return {
    header: {
      id: sessionId,
      cwd: cache?.record?.identity?.cwd ?? TARGET,
      createdAt: cache?.record?.identity?.createdAt ?? 0,
      isSeeded: cache?.record?.identity?.isSeeded === true,
    },
  }
})

function makeRouter(workspaceList, { failTitles = false } = {}) {
  const router = { methods: new Map(), method(name, fn) { router.methods.set(name, fn) } }
  const env = {
    projects: {},
    ctx: {
      get(name) {
        if (name === 'workspaceController') {
          return {
            async *follow() {
              yield { type: 'baseline', value: { items: workspaceList, archivedSessionIds, pinnedSessionIds: [] } }
            },
          }
        }
        if (name === 'workspaceRegistry') return { list: () => [] }
        if (name === 'sessionQuery') {
          return {
            listSessions: async () => records,
            async readTitleSnapshots(ids) {
              if (failTitles) throw new Error('simulated title failure')
              // 与真实 Host 行为一致：blank 会话（title 为 null）不会出现在标题快照结果里
              const out = {}
              for (const id of ids) {
                const title = titleOf(id)
                if (title === '') continue
                out[id] = { title, updatedAt: cacheOf(id)?.record?.identity?.createdAt ?? 0 }
              }
              return out
            },
            async readTitle() {
              if (failTitles) throw new Error('simulated title failure')
              return undefined
            },
          }
        }
        if (name === 'sessions') return { get: () => undefined }
        if (name === 'sessionTitle') return { get: () => undefined }
        return undefined
      },
    },
  }
  register(router, env)
  return router
}

const expected = [
  '古法编程AI辅助IDE插件',
  'vivo推送RegID是什么',
  'GitLab 网页系统是否用 PHP',
  'DeepSeek 多模态支持多少张图片',
  'BOOK-AI项目',
  '基于Recordly开源项目开发Web录屏应用',
  '玄幻未来科技与东方审美皮肤',
  '命令行使用dsh指南',
].sort()

let allOk = true

// 场景 1：正常
const router = makeRouter(workspaces)
const value = await router.methods.get('workspaces.sessions')({ path: TARGET, currentSessionId: CURRENT })
const got = (value.sessions ?? []).map((row) => row.title).sort()
const ok1 = got.length === expected.length && got.every((title, index) => title === expected[index])
allOk = allOk && ok1
console.log(`normal    rows=${got.length} expect=8 ${ok1 ? 'PASS 与经典侧边栏一致' : 'FAIL'}`)
if (!ok1) console.log(' got=', JSON.stringify(got))

// 场景 2：标题服务异常
const failRouter = makeRouter(workspaces, { failTitles: true })
const failValue = await failRouter.methods.get('workspaces.sessions')({ path: TARGET, currentSessionId: CURRENT })
const failCount = (failValue.sessions ?? []).length
const ok2 = failCount === 11
allOk = allOk && ok2
console.log(`failover  rows=${failCount} expect=11 ${ok2 ? 'PASS 标题异常时不丢列表' : 'FAIL 列表被清空'}`)

// 场景 3：新建 blank 会话作为当前会话
const newWorkspaces = workspaces.map((workspace) => workspace.workspaceId === WORKSPACE_ID
  ? { ...workspace, sessionIds: [...workspace.sessionIds, NEW_ID] }
  : workspace)
const newRouter = makeRouter(newWorkspaces)
const newValue = await newRouter.methods.get('workspaces.sessions')({ path: TARGET, currentSessionId: NEW_ID })
const newRows = newValue.sessions ?? []
const ok3 = newRows.length === 9 && newRows.some((row) => row.id === NEW_ID)
allOk = allOk && ok3
console.log(`new-session rows=${newRows.length} expect=9 ${ok3 ? 'PASS blank 当前会话可见' : 'FAIL'}`)

if (allOk) console.log('\nALL PASS')
process.exit(allOk ? 0 : 1)

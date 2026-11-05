#!/usr/bin/env node
/**
 * Host 半自测：不启动 Harness、不走 HTTP，直接调用各 host 模块注册的 handler。
 * 覆盖：项目打开/新建、文件读写/新建/重命名/删除、Git 状态/暂存/提交、SSH 配置解析、静态资产解析。
 * 用法：node scripts/selftest-host.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as assets from '../host/assets.js'
import * as chat from '../host/chat.js'
import * as fs from '../host/fs.js'
import * as git from '../host/git.js'
import * as project from '../host/project.js'
import { ProjectRegistry } from '../host/context.js'
import * as ssh from '../host/ssh.js'
import * as terminal from '../host/terminal.js'

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failed += 1
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function makeRouter() {
  const router = {
    methods: new Map(),
    streams: new Map(),
    sockets: [],
    assets: [],
    disposers: [],
    method(name, fn) {
      router.methods.set(name, fn)
    },
    stream(name, fn) {
      router.streams.set(name, fn)
    },
    ws(channel, handler) {
      router.sockets.push({ channel, handler })
    },
    asset(prefix, resolver) {
      router.assets.push({ prefix, resolver })
    },
    onDispose(fn) {
      router.disposers.push(fn)
    },
  }
  return router
}

async function call(router, name, body = {}) {
  const fn = router.methods.get(name)
  if (fn === undefined) throw new Error(`method not registered: ${name}`)
  return await fn(body, {})
}

const sandbox = mkdtempSync(join(tmpdir(), 'gufa-selftest-'))
const projectDir = join(sandbox, 'demo-project')
const router = makeRouter()
const env = { ctx: { get: () => undefined }, projects: new ProjectRegistry() }
for (const module of [assets, project, fs, git, ssh, terminal, chat]) module.register(router, env)

try {
  console.log('project.create / project.open')
  const created = await call(router, 'project.create', { parent: sandbox, name: 'demo-project' })
  const root = created.root
  check('new project root', created.root.split('/').at(-1) === 'demo-project', created.root)
  check('project name', created.name === 'demo-project')
  check('registered in registry', env.projects.list().length === 1)

  console.log('fs.create / fs.list / fs.read / fs.write')
  await call(router, 'fs.create', { root, path: 'src', kind: 'dir' })
  await call(router, 'fs.create', { root, path: 'src/main.ts', kind: 'file' })
  const listing = await call(router, 'fs.list', { root, path: '' })
  check('root lists src dir', listing.entries.some((entry) => entry.name === 'src' && entry.kind === 'dir'))
  const doc = await call(router, 'fs.read', { root, path: 'src/main.ts' })
  check('read empty file', doc.content === '')
  check('language detected', doc.language === 'typescript', doc.language)
  const saved = await call(router, 'fs.write', { root, path: 'src/main.ts', content: 'const answer = 42\n', expectedRevision: doc.revision })
  check('write returns revision', typeof saved.revision === 'string' && saved.revision.length > 0)
  const reread = await call(router, 'fs.read', { root, path: 'src/main.ts' })
  check('content persisted', reread.content === 'const answer = 42\n')
  let conflict = false
  try {
    await call(router, 'fs.write', { root, path: 'src/main.ts', content: 'x', expectedRevision: doc.revision })
  } catch (error) {
    conflict = error.code === 'revision-conflict'
  }
  check('stale revision rejected', conflict)
  let outside = false
  try {
    await call(router, 'fs.read', { root, path: '../../../etc/passwd' })
  } catch (error) {
    outside = error.code === 'path-outside' || error.code === 'not-found'
  }
  check('path traversal rejected', outside)
  await call(router, 'fs.create', { root, path: 'src/util.ts', kind: 'file' })
  await call(router, 'fs.rename', { root, path: 'src/util.ts', nextPath: 'src/helper.ts' })
  const afterRename = await call(router, 'fs.list', { root, path: 'src' })
  check('rename applied', afterRename.entries.some((entry) => entry.name === 'helper.ts'))
  await call(router, 'fs.delete', { root, path: 'src/helper.ts' })
  const afterDelete = await call(router, 'fs.list', { root, path: 'src' })
  check('delete applied', !afterDelete.entries.some((entry) => entry.name === 'helper.ts'))

  console.log('git.status / stage / commit')
  execFileSync('git', ['init', '-q'], { cwd: projectDir })
  execFileSync('git', ['config', 'user.email', 'selftest@example.com'], { cwd: projectDir })
  execFileSync('git', ['config', 'user.name', 'gufa selftest'], { cwd: projectDir })
  const status0 = await call(router, 'git.status', { root })
  check('git repo detected', status0.isGit === true)
  check('untracked change listed', status0.changes.some((change) => change.path === 'src/main.ts'), JSON.stringify(status0.changes))
  await call(router, 'git.stage', { root, paths: ['src/main.ts'] })
  const staged = await call(router, 'git.status', { root })
  check('change staged', staged.changes.some((change) => change.path === 'src/main.ts' && change.staged === true), JSON.stringify(staged.changes))
  await call(router, 'git.commit', { root, message: 'feat: selftest' })
  const clean = await call(router, 'git.status', { root })
  check('working tree clean after commit', clean.changes.length === 0, JSON.stringify(clean.changes))
  const log = await call(router, 'git.log', { root, limit: 5 })
  check('commit in log', log.commits.length === 1 && log.commits[0].subject === 'feat: selftest')
  writeFileSync(join(projectDir, 'src/main.ts'), 'const answer = 43\n')
  const diff = await call(router, 'git.diff', { root, path: 'src/main.ts' })
  check('diff contains change', diff.patch.includes('43'))

  console.log('workspaces')
  const fakeSessions = new Map([
    ['s1', { id: 's1', updatedAt: 20 }],
    ['s2', { id: 's2', updatedAt: 30 }],
  ])
  const wsRouter = makeRouter()
  const wsEnv = {
    ctx: {
      get(name) {
        if (name === 'workspaceRegistry') {
          return { list: () => [{ id: 'ws-1', path: '/tmp/project-a', title: 'Project A' }, { id: 'ws-2', path: '/tmp/project-b' }, { bad: true }] }
        }
        if (name === 'workingDirectory') return { defaultDirectory: '/tmp' }
        if (name === 'workspaceController') {
          return {
            async *follow() {
              yield {
                type: 'baseline',
                value: {
                  items: [
                    { workspaceId: 'ws-1', path: '/tmp/project-a', title: 'Project A', sessionIds: ['s1', 's2'] },
                    { workspaceId: 'ws-2', path: '/tmp/project-b', title: 'Project B', sessionIds: [] },
                  ],
                },
              }
            },
          }
        }
        if (name === 'sessions') return { get: (id) => fakeSessions.get(id) }
        if (name === 'sessionTitle') return { get: (session) => ({ title: session.id === 's1' ? 'Grafana 搭建' : '新增 RTA' }) }
        return undefined
      },
    },
    projects: new ProjectRegistry(),
  }
  project.register(wsRouter, wsEnv)
  const wsList = await wsRouter.methods.get('workspaces.list')({})
  check('workspaces.list maps registry', wsList.available === true && wsList.workspaces.length === 2 && wsList.workspaces[0].title === 'Project A')
  const wsSessions = await wsRouter.methods.get('workspaces.sessions')({ path: '/tmp/project-a' })
  check('workspaces.sessions returns workspace sessions', wsSessions.available === true && wsSessions.sessions.length === 2, JSON.stringify(wsSessions))
  check('workspaces.sessions membership', Array.isArray(wsSessions.sessionIds) && wsSessions.sessionIds.length === 2 && wsSessions.sessionIds[0] === 's1' && wsSessions.sessions.length === 2)
  const wsGroups = await wsRouter.methods.get('workspaces.sessions')({ path: '/tmp/project-a' })
  check('workspaces.sessions groups', Array.isArray(wsGroups.groups) && wsGroups.groups.length === 1 && wsGroups.groups[0].sessions.length === 2)
  const wsDefault = await wsRouter.methods.get('workspaces.defaultDirectory')({})
  check('workspaces.defaultDirectory', wsDefault.directory === '/tmp')
  const wsRouterUnavailable = makeRouter()
  project.register(wsRouterUnavailable, { ctx: {}, projects: new ProjectRegistry() })
  const wsNone = await wsRouterUnavailable.methods.get('workspaces.list')({})
  check('workspaces.list unavailable fallback', wsNone.available === false && wsNone.workspaces.length === 0)

  console.log('ssh / assets / placeholders')
  const sshHosts = await call(router, 'ssh.hosts')
  check('ssh.hosts shape', Array.isArray(sshHosts.hosts))
  const monaco = await router.assets.find((item) => item.prefix === 'monaco').resolver('loader.js')
  check('monaco loader asset resolves', monaco !== undefined && monaco.type.includes('javascript'), JSON.stringify(monaco))
  const xterm = await router.assets.find((item) => item.prefix === 'xterm').resolver('xterm.js')
  check('xterm asset resolves', xterm !== undefined)
  check('ws channel registered', router.sockets.some((item) => item.channel === 'terminal'))
  check('chat stream registered', router.streams.has('chat.stream'))
  check('api method count', router.methods.size >= 20, String(router.methods.size))
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

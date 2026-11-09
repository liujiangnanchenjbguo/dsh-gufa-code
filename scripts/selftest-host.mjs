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
import * as floatPlatform from '../host/float-platform.js'
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

  console.log('fs.search')
  await call(router, 'fs.create', { root, path: 'search.txt', kind: 'file' })
  await call(router, 'fs.write', { root, path: 'search.txt', content: 'Alpha beta\nBETA gamma\nbeta BETA\n' })
  await call(router, 'fs.create', { root, path: 'node_modules', kind: 'dir' }).catch(() => {})
  await call(router, 'fs.create', { root, path: 'node_modules/hidden.txt', kind: 'file' }).catch(() => {})
  await call(router, 'fs.write', { root, path: 'node_modules/hidden.txt', content: 'beta hidden\n' }).catch(() => {})
  const searchAll = await call(router, 'fs.search', { root, query: 'beta' })
  check('search finds file', searchAll.files.some((file) => file.path === 'search.txt'))
  check('search total (case-insensitive)', searchAll.total === 4, String(searchAll.total))
  check('search excludes node_modules', !searchAll.files.some((file) => file.path.startsWith('node_modules/')))
  const searchFile = searchAll.files.find((file) => file.path === 'search.txt')
  check('search line numbers', searchFile.matches[0].line === 1 && searchFile.matches[0].column === 7, JSON.stringify(searchFile.matches[0]))
  const searchCased = await call(router, 'fs.search', { root, query: 'beta', options: { caseSensitive: true } })
  check('search case sensitive', searchCased.total === 2, String(searchCased.total))
  const searchRegex = await call(router, 'fs.search', { root, query: 'b(eta|ETA)', options: { regex: true } })
  check('search regex', searchRegex.total === 4, String(searchRegex.total))
  let badRegex = false
  try {
    await call(router, 'fs.search', { root, query: '([', options: { regex: true } })
  } catch (error) {
    badRegex = error.code === 'bad-regex'
  }
  check('search invalid regex rejected', badRegex)
  await call(router, 'fs.delete', { root, path: 'search.txt' }).catch(() => {})
  await call(router, 'fs.delete', { root, path: 'node_modules' }).catch(() => {})

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
  const gitSearch = await call(router, 'fs.search', { root, query: 'answer' })
  check('search uses git file list', gitSearch.viaGit === true, String(gitSearch.viaGit))
  check('search finds committed file', gitSearch.files.some((file) => file.path === 'src/main.ts'))
  console.log('fs.replace')
  await call(router, 'fs.create', { root, path: 'replace.txt', kind: 'file' })
  await call(router, 'fs.write', { root, path: 'replace.txt', content: 'foo FOO foo\n' })
  const replaced = await call(router, 'fs.replace', { root, query: 'foo', replacement: 'bar', paths: ['replace.txt'] })
  check('replace count (case-insensitive)', replaced.replacedCount === 3, String(replaced.replacedCount))
  const replacedDoc = await call(router, 'fs.read', { root, path: 'replace.txt' })
  check('replace wrote file', replacedDoc.content === 'bar bar bar\n', JSON.stringify(replacedDoc.content))
  await call(router, 'fs.write', { root, path: 'replace.txt', content: 'v1.2 v3.4\n', expectedRevision: replacedDoc.revision })
  const regexReplaced = await call(router, 'fs.replace', {
    root,
    query: 'v(\\d)\\.(\\d)',
    replacement: 'v$1-$2',
    options: { regex: true },
    paths: ['replace.txt'],
  })
  check('replace regex groups', regexReplaced.replacedCount === 2, String(regexReplaced.replacedCount))
  const regexDoc = await call(router, 'fs.read', { root, path: 'replace.txt' })
  check('replace regex result', regexDoc.content === 'v1-2 v3-4\n', JSON.stringify(regexDoc.content))
  await call(router, 'fs.write', { root, path: 'replace.txt', content: 'abc\n', expectedRevision: regexDoc.revision })
  const literalDollar = await call(router, 'fs.replace', { root, query: 'abc', replacement: '$1', paths: ['replace.txt'] })
  const dollarDoc = await call(router, 'fs.read', { root, path: 'replace.txt' })
  check('literal replacement keeps $', literalDollar.replacedCount === 1 && dollarDoc.content === '$1\n', JSON.stringify(dollarDoc.content))
  let emptyRegexRejected = false
  try {
    await call(router, 'fs.replace', { root, query: 'a*', replacement: 'x', options: { regex: true }, paths: ['replace.txt'] })
  } catch (error) {
    emptyRegexRejected = error.code === 'bad-regex'
  }
  check('replace rejects empty-matching regex', emptyRegexRejected)
  await call(router, 'fs.write', { root, path: 'replace.txt', content: 'foo FOO Foo\n', expectedRevision: dollarDoc.revision })
  const cased = await call(router, 'fs.replace', { root, query: 'foo', replacement: 'bar', options: { preserveCase: true }, paths: ['replace.txt'] })
  const casedDoc = await call(router, 'fs.read', { root, path: 'replace.txt' })
  check('replace preserve case', cased.replacedCount === 3 && casedDoc.content === 'bar BAR Bar\n', JSON.stringify(casedDoc.content))
  await call(router, 'fs.write', { root, path: 'replace.txt', content: 'one two two\n', expectedRevision: casedDoc.revision })
  const single = await call(router, 'fs.replace', { root, query: 'two', replacement: 'X', target: { path: 'replace.txt', line: 1, column: 5 } })
  const singleDoc = await call(router, 'fs.read', { root, path: 'replace.txt' })
  check('replace single match by line/column', single.replacedCount === 1 && singleDoc.content === 'one X two\n', JSON.stringify(singleDoc.content))
  const stale = await call(router, 'fs.replace', { root, query: 'two', replacement: 'Y', target: { path: 'replace.txt', line: 1, column: 50 } })
  check('replace single stale target', stale.replacedCount === 0 && stale.stale === true)
  await call(router, 'fs.create', { root, path: 'inc.md', kind: 'file' })
  await call(router, 'fs.create', { root, path: 'inc.txt', kind: 'file' })
  await call(router, 'fs.write', { root, path: 'inc.md', content: 'ZzIncToken here\n' })
  await call(router, 'fs.write', { root, path: 'inc.txt', content: 'ZzIncToken here\n' })
  const includeSearch = await call(router, 'fs.search', { root, query: 'ZzIncToken', options: { include: '*.md' } })
  check('search include filter', includeSearch.files.length === 1 && includeSearch.files[0].path === 'inc.md', JSON.stringify(includeSearch.files.map((file) => file.path)))
  const excludeSearch = await call(router, 'fs.search', { root, query: 'ZzIncToken', options: { exclude: '*.md' } })
  check('search exclude filter', excludeSearch.files.length === 1 && excludeSearch.files[0].path === 'inc.txt', JSON.stringify(excludeSearch.files.map((file) => file.path)))
  const includeReplace = await call(router, 'fs.replace', { root, query: 'ZzIncToken', replacement: 'Included', options: { include: '*.md' } })
  const incMd = await call(router, 'fs.read', { root, path: 'inc.md' })
  const incTxt = await call(router, 'fs.read', { root, path: 'inc.txt' })
  check('replace include filter', includeReplace.replacedCount === 1 && incMd.content === 'Included here\n' && incTxt.content === 'ZzIncToken here\n', JSON.stringify([incMd.content, incTxt.content]))
  await call(router, 'fs.delete', { root, path: 'inc.md' })
  await call(router, 'fs.delete', { root, path: 'inc.txt' })
  await call(router, 'fs.delete', { root, path: 'replace.txt' })
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

  console.log('float 平台分支纯函数')
  const binRoot = '/plugin/desktop/float/bin'
  const macArm = floatPlatform.floatBinaryCandidates('darwin', 'arm64', binRoot)
  check('float binary candidates darwin arm64 顺序', macArm[0].endsWith('gufa-float-macos-arm64') && macArm[1].endsWith('gufa-float-macos-universal'), JSON.stringify(macArm))
  const macX64 = floatPlatform.floatBinaryCandidates('darwin', 'x64', binRoot)
  check('float binary candidates darwin x64 顺序', macX64[0].endsWith('gufa-float-macos-x64'), JSON.stringify(macX64))
  const winBins = floatPlatform.floatBinaryCandidates('win32', 'x64', binRoot)
  check('float binary candidates win32', winBins[0] === '/plugin/desktop/float/bin/win-x64/gufa-float-win.exe' && winBins[1].endsWith('gufa-float-win.exe'), JSON.stringify(winBins))
  const linuxBins = floatPlatform.floatBinaryCandidates('linux', 'x64', binRoot)
  check('float binary candidates linux', linuxBins[0] === '/plugin/desktop/float/bin/linux-x64/gufa-float-linux', JSON.stringify(linuxBins))
  check('float binary candidates 未知平台为空', floatPlatform.floatBinaryCandidates('aix', 'x64', binRoot).length === 0)

  const tasklistOut = [
    '"gufa-float-win.exe","1234","Console","1","10,000 K"',
    '"gufa-float-win.exe","5678","Console","1","10,000 K"',
    'INFO: No tasks are running which match the specified criteria.',
    '',
  ].join('\n')
  check('parseTasklistPids 解析 CSV', JSON.stringify(floatPlatform.parseTasklistPids(tasklistOut)) === '[1234,5678]', JSON.stringify(floatPlatform.parseTasklistPids(tasklistOut)))
  check('parseTasklistPids 空输入', floatPlatform.parseTasklistPids('').length === 0)

  const psArray = JSON.stringify({ ok: true, accessibility: true, apps: [
    { pid: 10, owner: 'chrome', title: 'Chrome', bundleId: '', windowNumber: 1, frontmost: 0 },
    { pid: 11, owner: 'wechat', title: 'WeChat', bundleId: '', windowNumber: 2, frontmost: 1 },
  ] })
  const psParsed = floatPlatform.parsePowerShellWindowList(psArray)
  check('parsePowerShellWindowList 数组 + name 回填', psParsed !== null && psParsed.apps.length === 2 && psParsed.apps[0].name === 'chrome', JSON.stringify(psParsed))
  const psSingle = floatPlatform.parsePowerShellWindowList(JSON.stringify({ ok: true, accessibility: true, apps: { pid: 12, owner: 'code', title: 'VS Code' } }))
  check('parsePowerShellWindowList 单对象转数组', psSingle !== null && psSingle.apps.length === 1 && psSingle.apps[0].name === 'code', JSON.stringify(psSingle))
  check('parsePowerShellWindowList ok:false', floatPlatform.parsePowerShellWindowList(JSON.stringify({ ok: false })) === null)
  check('parsePowerShellWindowList 非法 JSON', floatPlatform.parsePowerShellWindowList('not-json') === null)
  const psFiltered = floatPlatform.parsePowerShellWindowList(JSON.stringify({ ok: true, apps: [
    { pid: 1, owner: 'a', title: '' },
    { pid: 0, owner: 'b', title: 'B' },
    { pid: 2, owner: 'c', title: 'C' },
  ] }))
  check('parsePowerShellWindowList 过滤空标题/非法 pid', psFiltered !== null && psFiltered.apps.length === 1 && psFiltered.apps[0].pid === 2, JSON.stringify(psFiltered))

  const wmctrlOut = [
    '0x03e00007  0 1234 host One Title With Spaces',
    '0x03e00008  0 1234 host One Title With Spaces',
    '0x03e00009  1 4321 host Another',
    'malformed line',
  ].join('\n')
  const wmApps = floatPlatform.parseWmctrlWindowList(wmctrlOut, (pid) => (pid === 1234 ? 'chrome' : 'wechat'))
  check('parseWmctrlWindowList 解析/去重/owner', wmApps.length === 2 && wmApps[0].owner === 'chrome' && wmApps[0].title === 'One Title With Spaces' && wmApps[1].owner === 'wechat', JSON.stringify(wmApps))
  const wmFallback = floatPlatform.parseWmctrlWindowList('0x1 0 999 host T', () => { throw new Error('gone') })
  check('parseWmctrlWindowList comm 失败回退 pid', wmFallback.length === 1 && wmFallback[0].owner === '999', JSON.stringify(wmFallback))

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

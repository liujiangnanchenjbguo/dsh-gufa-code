/**
 * Git 能力：状态、暂存/取消暂存、提交、差异、日志。
 * 用系统 git 命令（node:child_process），不需要 node 依赖。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ApiError, badRequest } from './context.js'

const run = promisify(execFile)
const MAX_BUFFER = 32 * 1024 * 1024

async function git(root, args, timeout = 30_000) {
  try {
    const { stdout } = await run('git', ['-C', root, ...args], {
      maxBuffer: MAX_BUFFER,
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '1', LC_ALL: 'C' },
    })
    return stdout
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
    const raw = stderr !== '' ? stderr : stdout !== '' ? stdout : error instanceof Error ? error.message : String(error)
    // Node 的 "Command failed: git -C ..." 前缀没有信息量，去掉后只留 git 自己的输出
    const message = raw.replace(/^Command failed:[^\n]*\n?/u, '').trim() || raw
    throw new ApiError('git-failed', message.slice(0, 4000), 400)
  }
}

async function projectOf(env, body) {
  return env.projects.ensure(body.root)
}

/** 打开项目后才 git init 的目录：动态探测并回填 isGit。 */
async function ensureRepo(env, body) {
  const project = await projectOf(env, body)
  if (project.isGit !== true) {
    const inside = await git(project.root, ['rev-parse', '--is-inside-work-tree']).catch(() => '')
    if (inside.trim() === 'true') project.isGit = true
  }
  return project
}

/** 解析 porcelain=v1 -z 输出（NUL 分隔、路径不转义，正确处理空格/中文/重命名）。 */
function parseStatusZ(text) {
  const parts = text.split('\u0000')
  let branch = ''
  let upstream = ''
  let ahead = 0
  let behind = 0
  const changes = []
  for (let index = 0; index < parts.length; index += 1) {
    const line = parts[index]
    if (line === '') continue
    if (line.startsWith('## ')) {
      let head = line.slice(3)
      if (head.startsWith('No commits yet on ')) head = head.slice('No commits yet on '.length)
      const bracketIndex = head.indexOf(' [')
      const core = bracketIndex === -1 ? head : head.slice(0, bracketIndex)
      const dots = core.indexOf('...')
      if (dots === -1) {
        branch = core.trim()
        upstream = ''
      } else {
        branch = core.slice(0, dots).trim()
        upstream = core.slice(dots + 3).trim()
      }
      const aheadMatch = /ahead (\d+)/.exec(head)
      const behindMatch = /behind (\d+)/.exec(head)
      if (aheadMatch !== null) ahead = Number(aheadMatch[1])
      if (behindMatch !== null) behind = Number(behindMatch[1])
      continue
    }
    if (line.length < 4) continue
    const x = line[0]
    const y = line[1]
    let path = line.slice(3)
    if (x === 'R' || x === 'C') {
      index += 1
      const next = parts[index]
      if (typeof next === 'string' && next !== '') path = next
    }
    const staged = x !== ' ' && x !== '?'
    const untracked = x === '?' && y === '?'
    let status = 'M'
    if (untracked) status = '??'
    else if (x === 'A') status = 'A'
    else if (x === 'D' || y === 'D') status = 'D'
    else if (x === 'R') status = 'R'
    else if (x === 'U' || y === 'U') status = 'U'
    changes.push({ path, status, staged: staged && !untracked, untracked })
  }
  return { branch, upstream, hasUpstream: upstream !== '', ahead, behind, changes }
}

/** 解析 porcelain=v1 输出（旧接口，保留兜底）。 */
function parseStatus(text) {
  const lines = text.split('\n')
  let branch = ''
  let upstream = ''
  let ahead = 0
  let behind = 0
  const changes = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      let head = line.slice(3)
      if (head.startsWith('No commits yet on ')) head = head.slice('No commits yet on '.length)
      const bracketIndex = head.indexOf(' [')
      const core = bracketIndex === -1 ? head : head.slice(0, bracketIndex)
      const dots = core.indexOf('...')
      if (dots === -1) {
        branch = core.trim()
        upstream = ''
      } else {
        branch = core.slice(0, dots).trim()
        upstream = core.slice(dots + 3).trim()
      }
      const aheadMatch = /ahead (\d+)/.exec(head)
      const behindMatch = /behind (\d+)/.exec(head)
      if (aheadMatch !== null) ahead = Number(aheadMatch[1])
      if (behindMatch !== null) behind = Number(behindMatch[1])
      continue
    }
    if (line.length < 4) continue
    const x = line[0]
    const y = line[1]
    const path = line.slice(3).trim()
    const staged = x !== ' ' && x !== '?'
    const untracked = x === '?' && y === '?'
    let status = 'M'
    if (untracked) status = '??'
    else if (x === 'A') status = 'A'
    else if (x === 'D' || y === 'D') status = 'D'
    else if (x === 'R') status = 'R'
    else if (x === 'U' || y === 'U') status = 'U'
    changes.push({ path, status, staged: staged && !untracked, untracked })
  }
  return { branch, upstream, hasUpstream: upstream !== '', ahead, behind, changes }
}

export function register(router, env) {
  router.method('git.status', async (body) => {
    const project = await ensureRepo(env, body)
    if (!project.isGit) return { isGit: false, branch: '', changes: [], ahead: 0, behind: 0 }
    const raw = await git(project.root, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'])
    const parsed = parseStatusZ(raw)
    if (parsed.changes.length > 0 || parsed.branch !== '') return { isGit: true, ...parsed }
    return { isGit: true, ...parseStatus(await git(project.root, ['status', '--porcelain=v1', '--branch', '--untracked-files=all'])) }
  })

  router.method('git.stage', async (body) => {
    const project = await projectOf(env, body)
    const paths = Array.isArray(body.paths) ? body.paths.filter((item) => typeof item === 'string' && item !== '') : []
    if (paths.length === 0) throw badRequest('paths is required')
    await git(project.root, ['add', '--', ...paths])
    return { ok: true }
  })

  router.method('git.unstage', async (body) => {
    const project = await projectOf(env, body)
    const paths = Array.isArray(body.paths) ? body.paths.filter((item) => typeof item === 'string' && item !== '') : []
    if (paths.length === 0) throw badRequest('paths is required')
    try {
      await git(project.root, ['restore', '--staged', '--', ...paths])
    } catch {
      await git(project.root, ['reset', '-q', 'HEAD', '--', ...paths])
    }
    return { ok: true }
  })

  router.method('git.commit', async (body) => {
    const project = await projectOf(env, body)
    if (typeof body.message !== 'string' || body.message.trim() === '') throw badRequest('提交信息不能为空')
    // 先检查暂存区：git commit 在没有暂存内容时只会把提示写到 stdout，直接透传会变成无意义的 "Command failed"
    const staged = await git(project.root, ['diff', '--cached', '--name-only'])
    if (staged.trim() === '') {
      throw new ApiError('nothing-staged', '没有已暂存的改动：请先在「未暂存」里点 + 暂存，或点击「全部暂存」后再提交', 400)
    }
    const stdout = await git(project.root, ['commit', '-m', body.message])
    return { ok: true, output: stdout.trim().slice(0, 4000) }
  })

  /** 当前分支名。 */
  async function currentBranch(root) {
    const name = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (name === '' || name === 'HEAD') throw new ApiError('detached-head', '当前处于 detached HEAD 状态，无法推送/拉取', 400)
    return name
  }

  /** 检查远端与上游配置；返回 { upstream, remote }。 */
  async function upstreamOf(root) {
    const remotes = (await git(root, ['remote']).catch(() => '')).trim()
    if (remotes === '') throw new ApiError('no-remote', '仓库没有配置远端（git remote），无法推送/拉取', 400)
    const remote = remotes.split('\n').map((line) => line.trim()).filter(Boolean)[0]
    const upstream = (await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '')).trim()
    return { upstream, remote }
  }

  router.method('git.push', async (body) => {
    const project = await projectOf(env, body)
    const { upstream, remote } = await upstreamOf(project.root)
    const args = upstream !== '' ? ['push'] : ['push', '-u', remote, await currentBranch(project.root)]
    const stdout = await git(project.root, args, 120_000)
    return { ok: true, output: stdout.trim().slice(0, 4000) }
  })

  router.method('git.pull', async (body) => {
    const project = await projectOf(env, body)
    const { upstream } = await upstreamOf(project.root)
    if (upstream === '') throw new ApiError('no-upstream', '当前分支没有上游分支，请先推送一次建立上游', 400)
    const stdout = await git(project.root, ['pull', '--ff-only'], 120_000)
    return { ok: true, output: stdout.trim().slice(0, 4000) }
  })

  /** 读取某文件在指定版本下的文本内容（供编辑器 diff 使用）。 */
  router.method('git.show', async (body, context = {}) => {
    const project = await projectOf(env, body)
    const path = typeof body.path === 'string' ? body.path : ''
    if (path === '' || path.startsWith('/') || path.includes('..')) throw badRequest('path is invalid')
    const rev = body.rev === 'head' ? 'HEAD' : ':'
    let text = ''
    let missing = false
    try {
      text = await git(project.root, ['show', `${rev}${path}`], 30_000)
    } catch {
      missing = true
      text = ''
    }
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) {
      return { text: '', missing: false, binary: true, tooLarge: true }
    }
    const binary = text.includes('\u0000')
    return { text: binary ? '' : text, missing, binary, tooLarge: false }
  })

  /** 撤销指定文件的未暂存改动（git restore --worktree，等价 VS Code 行内还原）。 */
  /** 撤销指定文件的未暂存改动（git restore --worktree，等价 VS Code 行内还原）。 */
  /** 解析 unified diff 文本为：文件头 + 逐 hunk 列表。 */
  function parseUnifiedDiff(text) {
    const lines = String(text).split('\n')
    const headerLines = []
    const hunks = []
    let current = null
    for (const line of lines) {
      if (line.startsWith('@@')) {
        current = { header: line, lines: [line] }
        hunks.push(current)
        continue
      }
      if (current === null) {
        if (line !== '' || headerLines.length > 0) headerLines.push(line)
        continue
      }
      current.lines.push(line)
    }
    /* 去掉末尾空行，避免构造 patch 时出问题 */
    while (hunks.length > 0) {
      const last = hunks[hunks.length - 1]
      while (last.lines.length > 1 && last.lines[last.lines.length - 1] === '') last.lines.pop()
      break
    }
    return { headerLines, hunks }
  }

  /** 用 stdin 把 patch 交给 git apply（支持 -R）。 */
  function gitApplyWithStdin(root, args, patchText) {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['-C', root, 'apply', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      let stderr = ''
      let stdout = ''
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(stderr.trim() || `git apply 失败（exit ${code}）`))
      })
      try {
        child.stdin.end(patchText)
      } catch (error) {
        reject(error)
      }
    })
  }

  /** 读取文件改动的逐块信息（供「逐块接受/拒绝」）。 */
  router.method('git.hunks', async (body) => {
    const project = await projectOf(env, body)
    const path = typeof body.path === 'string' ? body.path : ''
    if (path === '' || path.startsWith('/') || path.includes('..')) throw badRequest('path is invalid')
    /* 未跟踪的新文件：整文件当作一个新增块 */
    const status = await git(project.root, ['status', '--porcelain=v1', '-z', '--', path]).catch(() => '')
    const classified = parseStatusZ(status)
    const untracked = classified.changes.some((change) => change.untracked === true)
    if (untracked) {
      let content = ''
      try {
        content = await git(project.root, ['show', `:${path}`]).catch(() => '')
      } catch {
        content = ''
      }
      try {
        const { readFile } = await import('node:fs/promises')
        const { join } = await import('node:path')
        content = await readFile(join(project.root, path), 'utf8')
      } catch {
        /* ignore */
      }
      const lines = content.split('\n')
      return {
        untracked: true,
        hunks: [{ id: 'h0', header: '@@ 新文件 @@', lines: lines.map((line) => `+${line}`) }],
        count: 1,
      }
    }
    const patch = await git(project.root, ['diff', '-U3', '--no-color', '--', path], 60_000)
    const parsed = parseUnifiedDiff(patch)
    const hunks = parsed.hunks.map((hunk, index) => ({ id: `h${index}`, header: hunk.header, lines: hunk.lines }))
    return { untracked: false, hunks, count: hunks.length }
  })

  /** 拒绝指定块（git apply -R 只回滚选中的 hunk）。 */
  router.method('git.rejectHunks', async (body) => {
    const project = await projectOf(env, body)
    const path = typeof body.path === 'string' ? body.path : ''
    if (path === '' || path.startsWith('/') || path.includes('..')) throw badRequest('path is invalid')
    const ids = Array.isArray(body.hunkIds) ? body.hunkIds.filter((item) => typeof item === 'string') : []
    if (ids.length === 0) throw badRequest('hunkIds is required')
    const status = await git(project.root, ['status', '--porcelain=v1', '-z', '--', path]).catch(() => '')
    const classified = parseStatusZ(status)
    const untracked = classified.changes.some((change) => change.untracked === true)
    if (untracked) {
      if (ids.includes('h0')) {
        const { rm } = await import('node:fs/promises')
        const { join } = await import('node:path')
        await rm(join(project.root, path), { force: true })
      }
      return { ok: true }
    }
    const patch = await git(project.root, ['diff', '-U3', '--no-color', '--', path], 60_000)
    const parsed = parseUnifiedDiff(patch)
    const selected = parsed.hunks.filter((hunk, index) => ids.includes(`h${index}`))
    if (selected.length === 0) throw new ApiError('no-hunks', '没有匹配的改动块', 400)
    const subPatch = `${parsed.headerLines.join('\n')}\n${selected.map((hunk) => hunk.lines.join('\n')).join('\n')}\n`
    await gitApplyWithStdin(project.root, ['-R', '--whitespace=nowarn'], subPatch)
    return { ok: true }
  })

  router.method('git.discard', async (body) => {
    const project = await projectOf(env, body)
    const paths = Array.isArray(body.paths) ? body.paths.filter((item) => typeof item === 'string' && item !== '' && !item.includes('..') && !item.startsWith('/')) : []
    if (paths.length === 0) throw badRequest('paths is required')
    try {
      await git(project.root, ['restore', '--worktree', '--', ...paths], 60_000)
    } catch {
      await git(project.root, ['checkout', '--', ...paths], 60_000)
    }
    return { ok: true }
  })

  /** 撤回上一次提交，改动保留在暂存区（等价 git reset --soft HEAD~1；首个提交用 update-ref）。 */
  router.method('git.undoLastCommit', async (body) => {
    const project = await projectOf(env, body)
    try {
      await git(project.root, ['reset', '--soft', 'HEAD~1'], 60_000)
    } catch (error) {
      try {
        await git(project.root, ['update-ref', '-d', 'HEAD'], 60_000)
      } catch {
        throw error
      }
    }
    return { ok: true }
  })

  /** 撤销所有（未暂存 + 已暂存）的已跟踪文件改动；不删除未跟踪文件。 */
  router.method('git.discardAll', async (body) => {
    const project = await projectOf(env, body)
    const staged = await git(project.root, ['diff', '--cached', '--name-only']).catch(() => '')
    if (staged.trim() !== '') await git(project.root, ['restore', '--staged', '--', '.'], 60_000)
    await git(project.root, ['restore', '--worktree', '--', '.'], 60_000).catch(async () => {
      await git(project.root, ['checkout', '--', '.'], 60_000)
    })
    return { ok: true }
  })

  router.method('git.diff', async (body) => {
    const project = await projectOf(env, body)
    const args = ['diff', '--no-color', '--unified=3']
    if (body.staged === true) args.push('--cached')
    if (typeof body.path === 'string' && body.path !== '') args.push('--', body.path)
    const patch = await git(project.root, args)
    return { patch }
  })

  /** 某次提交的详情：提交信息 + 改动文件列表（name-status）。 */
  router.method('git.commitFiles', async (body) => {
    const project = await projectOf(env, body)
    const hash = typeof body.hash === 'string' ? body.hash.trim() : ''
    if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw badRequest('hash is invalid')
    const metaText = await git(project.root, ['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ar%x1f%P%x1f%s', hash], 60_000)
    const meta = metaText.trim().split('\u001f')
    const filesText = await git(project.root, ['show', '--name-status', '--format=', '--no-renames', hash], 60_000)
    const files = filesText
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [status = 'M', ...rest] = line.split('\t')
        return { status: status[0] ?? 'M', path: rest.join('\t') }
      })
      .filter((row) => row.path !== '')
    return {
      files,
      commit: {
        hash: meta[0] ?? hash,
        short: meta[1] ?? hash.slice(0, 7),
        author: meta[2] ?? '',
        when: meta[3] ?? '',
        parents: meta[4] !== undefined && meta[4] !== '' ? meta[4].split(' ').filter(Boolean) : [],
        subject: meta[5] ?? '',
      },
    }
  })

  /** 读取某文件在指定提交（或其父提交）中的文本内容，供提交 diff 使用。 */
  router.method('git.fileVersion', async (body) => {
    const project = await projectOf(env, body)
    const path = typeof body.path === 'string' ? body.path : ''
    const hash = typeof body.hash === 'string' ? body.hash.trim() : ''
    if (path === '' || path.startsWith('/') || path.includes('..')) throw badRequest('path is invalid')
    if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw badRequest('hash is invalid')
    const ref = `${hash}${body.parent === true ? '^' : ''}:${path}`
    let text = ''
    let missing = false
    try {
      text = await git(project.root, ['show', ref], 60_000)
    } catch {
      missing = true
      text = ''
    }
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) {
      return { text: '', missing: false, binary: true, tooLarge: true }
    }
    const binary = text.includes('\u0000')
    return { text: binary ? '' : text, missing, binary, tooLarge: false }
  })

  /** 提交图数据：hash / 父提交 / 作者 / 相对时间 / 引用装饰 / 标题。 */
  router.method('git.graph', async (body) => {
    const project = await projectOf(env, body)
    const limit = Number.isInteger(body.limit) && body.limit > 0 ? Math.min(body.limit, 300) : 120
    const args = ['log', `-n${limit}`, '--date=relative', '--format=%H%x1f%h%x1f%P%x1f%an%x1f%ar%x1f%D%x1f%s', '--decorate=short']
    if (body.all !== false) args.push('--all')
    let text = ''
    try {
      text = await git(project.root, args, 60_000)
    } catch (error) {
      return { commits: [], branch: '', error: error instanceof Error ? error.message : String(error) }
    }
    const commits = text.split('\n').filter((line) => line.trim() !== '').map((line) => {
      const [hash = '', short = '', parentsRaw = '', author = '', when = '', refsRaw = '', ...rest] = line.split('\u001f')
      return {
        hash,
        short,
        parents: parentsRaw.trim() === '' ? [] : parentsRaw.trim().split(' ').filter(Boolean),
        author,
        when,
        refs: refsRaw.trim() === '' ? [] : refsRaw.split(',').map((item) => item.trim()).filter(Boolean),
        subject: rest.join('\u001f'),
      }
    })
    const branch = (await git(project.root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
    return { commits, branch, error: '' }
  })

  router.method('git.log', async (body) => {
    const project = await projectOf(env, body)
    const limit = Number.isInteger(body.limit) && body.limit > 0 ? Math.min(body.limit, 100) : 30
    const format = '%H%x1f%h%x1f%an%x1f%ar%x1f%s'
    const stdout = await git(project.root, ['log', `-n${limit}`, `--format=${format}`])
    const commits = stdout.split('\n').filter(Boolean).map((line) => {
      const [hash, short, author, when, ...rest] = line.split('\x1f')
      return { hash, short, author, when, subject: rest.join('\x1f') }
    })
    return { commits }
  })

  router.method('git.branches', async (body) => {
    const project = await projectOf(env, body)
    // 注意：%x1f 是 git log 的转义，ref-filter（branch/for-each-ref 的 --format）不支持，
    // 因此这里用 for-each-ref 拿名字 + rev-parse 判断当前分支，不要拼接格式转义。
    const stdout = await git(project.root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    const current = (await git(project.root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
    const branches = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name !== '')
      .map((name) => ({ name, current: name === current }))
    return { branches }
  })

  /** 新建并切换到新分支。 */
  router.method('git.createBranch', async (body) => {
    const project = await projectOf(env, body)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name === '') throw badRequest('分支名不能为空')
    await git(project.root, ['check-ref-format', '--branch', name]).catch(() => {
      throw new ApiError('branch-invalid', `分支名不合法：${name}`, 400)
    })
    const exists = (await git(project.root, ['branch', '--list', '--format=%(refname:short)', name]).catch(() => '')).trim()
    if (exists !== '') throw new ApiError('branch-exists', `分支已存在：${name}`, 409)
    try {
      await git(project.root, ['switch', '-c', name], 60_000)
    } catch {
      await git(project.root, ['checkout', '-b', name], 60_000)
    }
    return { ok: true, branch: name }
  })

  router.method('git.checkout', async (body) => {
    const project = await projectOf(env, body)
    if (typeof body.branch !== 'string' || body.branch === '') throw badRequest('branch is required')
    await git(project.root, ['checkout', body.branch])
    return { ok: true }
  })

  router.method('git.isRepo', async (body) => {
    const project = env.projects.ensure(body.root)
    const text = await git(project.root, ['rev-parse', '--is-inside-work-tree']).catch(() => '')
    return { isGit: text.trim() === 'true' }
  })
}

/**
 * 跨平台摸鱼悬浮层：Host 侧纯函数（无 DSH 依赖，可单元测试）。
 *
 * host/dev.js 的 float.* 平台分支用这些函数做「二进制候选路径 / 任务列表解析 /
 * PowerShell 窗口列表解析 / wmctrl 窗口列表解析」。把解析逻辑放这里是为了：
 *   1) 在 macOS 上也能用固定字符串测试 Windows/Linux 两条分支；
 *   2) 避免 dev.js 越堆越大。
 */

/** 当前平台优先使用的 helper 二进制候选（按顺序尝试）。 */
export function floatBinaryCandidates(platform, arch, binRoot) {
  const join = (name) => `${binRoot.replace(/\/+$/, '')}/${name}`
  if (platform === 'darwin') {
    const macArch = arch === 'arm64' ? 'arm64' : 'x64'
    return [
      join(`gufa-float-macos-${macArch}`),
      join('gufa-float-macos-universal'),
      join('gufa-float-macos-arm64'),
      join('gufa-float-macos-x64'),
    ]
  }
  if (platform === 'win32') {
    return [join('win-x64/gufa-float-win.exe'), join('gufa-float-win.exe')]
  }
  if (platform === 'linux') {
    return [join('linux-x64/gufa-float-linux'), join('linux-x64/gufa-float-linux-x64'), join('gufa-float-linux')]
  }
  return []
}

/** 解析 `tasklist /FI "IMAGENAME eq gufa-float-win.exe" /FO CSV /NH` 的进程号。 */
export function parseTasklistPids(stdout) {
  const pids = new Set()
  for (const line of String(stdout ?? '').split('\n')) {
    const match = /^"([^"]+)","(\d+)"/.exec(line.trim())
    if (match !== null) {
      const pid = Number(match[2])
      if (Number.isFinite(pid) && pid > 0) pids.add(pid)
    }
  }
  return [...pids]
}

/**
 * 解析 Windows 窗口列表 PowerShell 输出：
 *   ConvertTo-Json -InputObject ([pscustomobject]@{ ok=$true; accessibility=$true; apps=@($rows) })
 * 返回 { ok, accessibility, apps } 或 null（解析失败/非 ok）。
 */
export function parsePowerShellWindowList(stdout) {
  let parsed = null
  try {
    parsed = JSON.parse(String(stdout ?? '').trim())
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.ok !== true) return null
  let apps = parsed.apps
  if (!Array.isArray(apps)) apps = apps === null || apps === undefined ? [] : [apps]
  apps = apps
    .filter((row) => row !== null && typeof row === 'object' && Number(row.pid) > 0 &&
      typeof row.title === 'string' && row.title !== '')
    .map((row) => ({
      ...row,
      name: typeof row.name === 'string' && row.name !== '' ? row.name : (typeof row.owner === 'string' ? row.owner : String(row.pid)),
    }))
  return { ok: true, accessibility: true, apps }
}

/**
 * 解析 `wmctrl -lp` 输出为窗口列表。
 * @param {string} stdout wmctrl 输出
 * @param {(pid:number)=>string|undefined} readComm 读取进程名（Linux 上读 /proc/<pid>/comm；测试可注入）
 */
export function parseWmctrlWindowList(stdout, readComm) {
  const apps = []
  const seen = new Set()
  for (const line of String(stdout ?? '').split('\n')) {
    // 格式：`0x窗口ID 桌面号 PID 主机名 窗口标题`（标题可含空格）
    const match = /^0x[0-9a-fA-F]+\s+\d+\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line.trim())
    if (match === null) continue
    const pid = Number(match[1])
    const title = match[3].trim()
    if (!Number.isFinite(pid) || pid <= 0 || title === '') continue
    const key = `${pid}:${title}`
    if (seen.has(key)) continue
    seen.add(key)
    let owner = String(pid)
    try {
      const comm = readComm(pid)
      if (typeof comm === 'string' && comm.trim() !== '') owner = comm.trim()
    } catch {
      /* 进程可能已退出 */
    }
    apps.push({ pid, name: owner, owner, title, bundleId: owner, windowNumber: apps.length + 1, frontmost: 0 })
  }
  return apps
}

/**
 * SSH：读取 ~/.ssh/config 主机列表，供左侧 SSH 面板一键连接（连接在终端里执行 ssh <alias>）。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 解析 ssh_config 的 Host 块（忽略通配 Host *）。 */
export function parseSshConfig(text) {
  const hosts = []
  let current = null
  let inBlock = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(\w+)\s+(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1].toLowerCase()
    const value = match[2].split('#')[0].trim()
    if (key === 'host') {
      if (current !== null) hosts.push(current)
      const aliases = value.split(/\s+/).filter((item) => item !== '' && !item.includes('*') && !item.includes('?'))
      current = aliases.length === 0
        ? null
        : { alias: aliases[0], aliases, host: aliases[0], user: '', port: '' }
      inBlock = current !== null
      continue
    }
    if (!inBlock || current === null) continue
    if (key === 'hostname') current.host = value
    else if (key === 'user') current.user = value
    else if (key === 'port') current.port = value
  }
  if (current !== null) hosts.push(current)
  const seen = new Set()
  return hosts.filter((host) => {
    if (seen.has(host.alias)) return false
    seen.add(host.alias)
    return true
  })
}

export function register(router) {
  router.method('ssh.hosts', async () => {
    const candidates = [join(homedir(), '.ssh', 'config'), join(homedir(), '.ssh', 'config.d')]
    let text = ''
    try {
      text = await readFile(candidates[0], 'utf8')
    } catch {
      text = ''
    }
    return { hosts: parseSshConfig(text), configPath: candidates[0] }
  })
}

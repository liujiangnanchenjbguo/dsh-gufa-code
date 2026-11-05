#!/usr/bin/env node
/**
 * Router 自测：路由挂载、方法分发、WS/资产注册，以及 host 模块热重载（签名变化 → 重新加载并清理旧 scope）。
 * 不启动 Harness，用最小的 ctx 假体。
 * 用法：node scripts/selftest-router.mjs
 */
import { createRouter } from '../host/context.js'

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

const effects = []
const routes = []
const upgrades = []
const ctx = {
  effect(fn, label) {
    const dispose = fn() ?? (() => {})
    effects.push({ dispose, label })
    return dispose
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => {}
    },
  },
  connection: { requestRejection: () => undefined },
}

const router = createRouter(ctx)
let signature = 'v1'
let loads = 0
let disposed = 0
const seen = []

router.setReloader(async () => {
  loads += 1
  const generation = loads
  const { scope, registrar } = router.createScope()
  registrar.method('ping', async (body) => {
    seen.push(`method:${generation}`)
    return { pong: body.x ?? null, generation }
  })
  registrar.stream('events', async (body, { send, close }) => {
    send({ type: 'delta', text: String(generation) })
    close()
  })
  registrar.ws('demo', () => () => {
    disposed += 1
  })
  registrar.asset('demo', async (raw) => ({ path: raw, type: 'text/plain' }))
  registrar.onDispose(() => {
    disposed += 1
  })
  router.installScope(scope)
}, () => signature)

router.mount()
check('api route mounted', routes.some((route) => route.path === '/gufa-code/api'))
check('asset route mounted', routes.some((route) => route.path === '/gufa-code/asset'))
check('ws upgrade mounted', upgrades.some((route) => route.path === '/gufa-code/ws'))

const first = await router.__dispatch('ping', { x: 42 })
check('lazy first load dispatched', first.pong === 42 && first.generation === 1, JSON.stringify(first))
check('load count after first request', loads === 1, String(loads))
let missing = false
try {
  await router.__dispatch('nope')
} catch (error) {
  missing = error.code === 'not-found'
}
check('unknown method rejected', missing)

signature = 'v2'
await router.__dispatch('ping', { x: 7 })
check('signature change reloads modules', loads === 2, String(loads))
check('old scope disposed on reload', disposed >= 1, String(disposed))
const third = await router.__dispatch('ping', {})
check('new generation serves requests', third.generation === 2, JSON.stringify(third))
const stats = router.__stats()
check('scope stats', stats.methods === 1 && stats.streams === 1 && stats.sockets === 1 && stats.assets === 1, JSON.stringify(stats))

// 卸载清理
for (const { dispose } of effects) dispose()
check('teardown runs scope disposers', disposed >= 2, String(disposed))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

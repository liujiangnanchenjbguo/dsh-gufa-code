#!/usr/bin/env node
/**
 * 把 src/client/*.js 按文件名顺序拼接成单个浏览器产物 client.js。
 * 每个零件文件都在 lazy-CJS factory 函数体内执行，共享 React / h / hooks / G。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = join(root, 'src', 'client')
const files = readdirSync(partsDir).filter((name) => name.endsWith('.js')).sort()
if (files.length === 0) {
  console.error('build-client: src/client 下没有零件文件')
  process.exit(1)
}

const header = `window.__ModuleLoader__.load({
  id: 'dsh-gufa-code',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = React
`

const body = files
  .map((name) => `\n/* ─────────────────────── ${name} ─────────────────────── */\n${readFileSync(join(partsDir, name), 'utf8')}`)
  .join('\n')

const footer = `
  },
})
`

const output = header + body + footer
writeFileSync(join(root, 'client.js'), output, 'utf8')
console.log(`build-client: ${files.length} parts -> client.js (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB)`)
if (process.argv.includes('--list')) console.log(files.join('\n'))

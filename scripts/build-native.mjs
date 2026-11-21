#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate
    const probe = spawnSync('which', [candidate], { encoding: 'utf8' })
    if (probe.status === 0 && probe.stdout.trim().length > 0) return probe.stdout.trim()
  }
  return null
}

function findGeatsc() {
  const localBin = path.join(root, 'node_modules', '.bin', 'geatsc')
  if (fs.existsSync(localBin)) return { cmd: localBin, prefix: [] }

  const globalGeatsc = findExecutable(['geatsc'])
  if (globalGeatsc) return { cmd: globalGeatsc, prefix: [] }

  const geaPath = findExecutable(['gea'])
  if (geaPath) {
    const resolvedGea = fs.realpathSync(geaPath)
    const cliRoot = path.resolve(path.dirname(resolvedGea), '..')
    const nestedGeatsc = path.join(cliRoot, 'node_modules', '@geastack', 'compiler', 'dist', 'cli.js')
    if (fs.existsSync(nestedGeatsc)) {
      return { cmd: process.execPath, prefix: [nestedGeatsc] }
    }
  }

  throw new Error(
    'geatsc bulunamadı. Lütfen `@geastack/compiler` veya global `@geastack/cli` paketinin kurulu olduğundan emin olun.'
  )
}

const cxx =
  process.env.CXX ??
  findExecutable(['clang++', 'g++']) ??
  'g++'

const geatsc = findGeatsc()
const userArgs = process.argv.slice(2)

console.error(`[ailoopchecker] derleyici: ${cxx}`)
console.error(`[ailoopchecker] geatsc: ${geatsc.cmd} ${geatsc.prefix.join(' ')}`.trim())

const result = spawnSync(geatsc.cmd, [...geatsc.prefix, ...userArgs], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    CXX: cxx
  }
})

process.exit(result.status ?? 1)

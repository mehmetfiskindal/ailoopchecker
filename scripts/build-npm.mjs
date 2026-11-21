#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const libDir = path.join(root, 'lib')

function findTsc() {
  const candidates = [
    path.join(root, 'node_modules', '.bin', 'tsc'),
    path.join(path.dirname(root), 'node_modules', '.bin', 'tsc'),
    path.join(process.env.HOME ?? '', 'node_modules', '.bin', 'tsc')
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  const geaProbe = spawnSync('which', ['gea'], { encoding: 'utf8' })
  if (geaProbe.status === 0 && geaProbe.stdout.trim().length > 0) {
    const cliRoot = path.resolve(path.dirname(fs.realpathSync(geaProbe.stdout.trim())), '..')
    const nestedTsc = path.join(cliRoot, 'node_modules', '.bin', 'tsc')
    if (fs.existsSync(nestedTsc)) return nestedTsc
  }
  return 'tsc'
}

fs.rmSync(libDir, { recursive: true, force: true })
const tsc = findTsc()
const result = spawnSync(tsc, ['-p', path.join(root, 'tsconfig.npm.json')], {
  cwd: root,
  stdio: 'inherit'
})
process.exit(result.status ?? 1)

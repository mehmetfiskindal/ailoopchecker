#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function findTsc() {
  const localTsc = path.join(root, 'node_modules', '.bin', 'tsc')
  if (fs.existsSync(localTsc)) return localTsc
  const geaProbe = spawnSync('which', ['gea'], { encoding: 'utf8' })
  if (geaProbe.status === 0 && geaProbe.stdout.trim().length > 0) {
    const cliRoot = path.resolve(path.dirname(fs.realpathSync(geaProbe.stdout.trim())), '..')
    const nestedTsc = path.join(cliRoot, 'node_modules', '.bin', 'tsc')
    if (fs.existsSync(nestedTsc)) return nestedTsc
  }
  return 'tsc'
}

const tsc = findTsc()
const result = spawnSync(tsc, ['-p', path.join(root, 'tsconfig.json'), '--noEmit'], {
  cwd: root,
  stdio: 'inherit'
})
process.exit(result.status ?? 1)

#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
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

function findNodeCompatDriver() {
  const candidates = [
    path.join(root, 'node_modules', '@geastack', 'node-compat', 'scripts', 'build.mjs'),
    path.join(process.env.HOME ?? '', 'node_modules', '@geastack', 'node-compat', 'scripts', 'build.mjs')
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  const geaPath = findExecutable(['gea'])
  if (geaPath) {
    const cliRoot = path.resolve(path.dirname(fs.realpathSync(geaPath)), '..')
    const nested = path.join(cliRoot, 'node_modules', '@geastack', 'node-compat', 'scripts', 'build.mjs')
    if (fs.existsSync(nested)) return nested
  }
  try {
    return createRequire(import.meta.url).resolve('@geastack/node-compat/build')
  } catch {
    throw new Error(
      '@geastack/node-compat bulunamadı. Lütfen `@geastack/compiler` veya global `@geastack/cli` paketinin kurulu olduğundan emin olun.'
    )
  }
}

const cxx = process.env.CXX ?? findExecutable(['clang++', 'g++']) ?? 'g++'
const driver = findNodeCompatDriver()
const entryFile = path.join(root, 'src', 'cli.ts')
const outDir = path.join(root, 'dist', '.geatsc', 'ailoopchecker')
const exePath = path.join(root, 'dist', process.platform === 'win32' ? 'ailoopchecker.exe' : 'ailoopchecker')
const reportPath = path.join(outDir, 'report.json')
const tsconfigPath = path.join(root, 'tsconfig.json')
const userArgs = process.argv.slice(2)

fs.mkdirSync(outDir, { recursive: true })
console.error(`[ailoopchecker] derleyici: ${cxx}`)
console.error(`[ailoopchecker] driver: ${driver}`)
console.error(`[geatsc] ${entryFile} -> ${exePath}`)

const result = spawnSync(
  process.execPath,
  [driver, entryFile, '--out', outDir, '--exe', exePath, '--report', reportPath, '--source-project', tsconfigPath, ...userArgs],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      CXX: cxx
    }
  }
)

process.exit(result.status ?? 1)

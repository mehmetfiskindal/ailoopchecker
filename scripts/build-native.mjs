#!/usr/bin/env node
// Builds the native executable: src/cli.ts -> dist/ailoopchecker via geatsc (@geastack/node-compat driver).
import fs from 'node:fs'
import path from 'node:path'
import { findOnPath, resolvePackageFile, root, runNodeScript } from './lib/tools.mjs'

// Project devDependency first, then the copy bundled with a global `@geastack/cli`.
const driver = resolvePackageFile('@geastack/node-compat/build')
if (!driver) {
  console.error(
    '[ailoopchecker] @geastack/node-compat bulunamadı / not found.\n' +
      '  Çalıştırın / run: npm install   (devDependencies: @geastack/node-compat, @geastack/compiler)\n' +
      '  veya / or: npm install -g @geastack/cli'
  )
  process.exit(1)
}

const cxx = process.env.CXX ?? findOnPath('clang++') ?? findOnPath('g++')
if (!cxx) {
  console.error('[ailoopchecker] C++ derleyici bulunamadı / no C++ compiler found (clang++ or g++). CXX ile belirtin / set CXX.')
  process.exit(1)
}

const entryFile = path.join(root, 'src', 'cli.ts')
const outDir = path.join(root, 'dist', '.geatsc', 'ailoopchecker')
const exePath = path.join(root, 'dist', process.platform === 'win32' ? 'ailoopchecker.exe' : 'ailoopchecker')
const reportPath = path.join(outDir, 'report.json')
const tsconfigPath = path.join(root, 'tsconfig.json')
// Forwarded to the driver, e.g. --debug (disables optimisation), --verbose.
const userArgs = process.argv.slice(2)

fs.mkdirSync(outDir, { recursive: true })
console.error(`[ailoopchecker] derleyici: ${cxx}`)
console.error(`[ailoopchecker] driver: ${driver}`)
console.error(`[geatsc] ${entryFile} -> ${exePath}`)

process.exit(
  runNodeScript(
    driver,
    [entryFile, '--out', outDir, '--exe', exePath, '--report', reportPath, '--source-project', tsconfigPath, ...userArgs],
    { env: { ...process.env, CXX: cxx } }
  )
)

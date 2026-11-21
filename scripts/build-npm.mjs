#!/usr/bin/env node
// Builds the npm distribution: src/**/*.ts -> lib/**/*.js + lib/**/*.d.ts
import fs from 'node:fs'
import path from 'node:path'
import { root, requireTsc, runNodeScript } from './lib/tools.mjs'

const libDir = path.join(root, 'lib')

// 1. Version guard: src/shared/version.ts must match package.json.
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const versionSrc = fs.readFileSync(path.join(root, 'src', 'shared', 'version.ts'), 'utf8')
const srcVersion = /VERSION\s*=\s*'([^']+)'/.exec(versionSrc)?.[1]
if (srcVersion !== pkgVersion) {
  console.error(
    `[build:npm] Sürüm uyuşmuyor / version mismatch: package.json=${pkgVersion}, src/shared/version.ts=${srcVersion ?? '?'}`
  )
  process.exit(1)
}

// 2. Compile.
fs.rmSync(libDir, { recursive: true, force: true })
const status = runNodeScript(requireTsc(), ['-p', path.join(root, 'tsconfig.npm.json')])
if (status !== 0) process.exit(status)

// 3. `rewriteRelativeImportExtensions` only rewrites emitted JS; declaration files keep
//    `./foo.ts` specifiers that point at files not shipped in the package. Rewrite them.
const RELATIVE_TS_SPECIFIER = /((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]*?)\.ts\2/g
let rewritten = 0
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.d.ts')) {
      const before = fs.readFileSync(full, 'utf8')
      const after = before.replace(RELATIVE_TS_SPECIFIER, (_m, lead, q, spec) => `${lead}${q}${spec}.js${q}`)
      if (after !== before) {
        fs.writeFileSync(full, after)
        rewritten++
      }
    }
  }
}
walk(libDir)

// 4. Sanity check: no `.ts` relative specifier may survive in lib/.
const leftovers = []
const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) scan(full)
    else if (/\.(d\.ts|js)$/.test(entry.name)) {
      if (/(['"])\.{1,2}\/[^'"]*\.ts\1/.test(fs.readFileSync(full, 'utf8'))) leftovers.push(path.relative(root, full))
    }
  }
}
scan(libDir)
if (leftovers.length > 0) {
  console.error(`[build:npm] .ts import kaldı / leftover .ts specifiers in:\n  ${leftovers.join('\n  ')}`)
  process.exit(1)
}

console.error(`[build:npm] lib/ hazır / ready (v${pkgVersion}, ${rewritten} .d.ts dosyası düzeltildi / rewritten)`)

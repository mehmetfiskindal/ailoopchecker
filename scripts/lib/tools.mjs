// Cross-platform helpers shared by the build scripts (no `which`, no shell).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Look up an executable on PATH (honours PATHEXT on Windows). Returns an absolute path or null. */
export function findOnPath(name) {
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // not here
      }
    }
  }
  return null
}

/** node_modules directory of a globally installed @geastack/cli (`gea`), if any. */
export function geaCliNodeModules() {
  const gea = findOnPath('gea')
  if (!gea) return null
  try {
    // npm on Windows installs a gea.cmd shim next to node_modules/@geastack/cli.
    const real = fs.realpathSync(gea)
    const candidates = [
      path.resolve(path.dirname(real), '..', 'node_modules'),
      path.join(path.dirname(gea), 'node_modules', '@geastack', 'cli', 'node_modules')
    ]
    return candidates.find((c) => fs.existsSync(c)) ?? null
  } catch {
    return null
  }
}

/**
 * Resolve a package file: project node_modules first, then the global gea CLI's bundled copy.
 * `specifier` is a package export such as `typescript/lib/tsc.js`.
 */
export function resolvePackageFile(specifier) {
  const bases = [path.join(root, 'package.json')]
  const geaModules = geaCliNodeModules()
  if (geaModules) bases.push(path.join(geaModules, '..', 'package.json'))
  for (const base of bases) {
    try {
      return createRequire(base).resolve(specifier)
    } catch {
      // try next base
    }
  }
  return null
}

/** Run `node <script> ...args`, printing spawn errors instead of failing silently. */
export function runNodeScript(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', ...options })
  if (result.error) {
    console.error(`[ailoopchecker] ${script} çalıştırılamadı / failed to start: ${result.error.message}`)
    return 1
  }
  if (result.signal) {
    console.error(`[ailoopchecker] ${script} sinyal ile sonlandı / killed by signal ${result.signal}`)
    return 1
  }
  return result.status ?? 1
}

export function requireTsc() {
  const tsc = resolvePackageFile('typescript/lib/tsc.js')
  if (!tsc) {
    console.error(
      '[ailoopchecker] TypeScript bulunamadı / not found. Çalıştırın / run: npm install  (devDependency `typescript`)'
    )
    process.exit(1)
  }
  return tsc
}

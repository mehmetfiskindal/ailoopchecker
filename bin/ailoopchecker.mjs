#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const nativeBin = path.join(root, 'dist', process.platform === 'win32' ? 'ailoopchecker.exe' : 'ailoopchecker')
const jsCliPath = path.join(root, 'lib', 'product', 'cli.js')

// Directory names skipped in BOTH the git and the filesystem walk, so the two
// modes agree. Only build output, dependency and tool-state folders belong here;
// common source folder names such as `lib/` or `src/` must never be listed.
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.turbo',
  '.expo',
  '.gradle',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
  'vendor',
  'Pods'
])

const SKIP_FILE_RE =
  /(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|\.lock$|\.tar\.zst$|\.tar\.gz$|\.zip$|\.map$|\.min\.(js|css)$|\.woff2?$|\.ttf$|\.eot$|\.ico$|\.pdf$)/i

const MAX_FILE_BYTES = 50 * 1024 * 1024

// CLI options that consume the following argument (keep in sync with parseArgs in src/product/cli.ts).
const VALUE_OPTIONS = new Set(['--project-name', '--file-list', '--lang', '--threshold'])

function isIgnoredRelPath(rel) {
  const segments = rel.split(/[\\/]/)
  segments.pop() // file name
  return segments.some((s) => IGNORED_DIRS.has(s))
}

function pushIfSmallFile(collected, full) {
  try {
    const st = fs.statSync(full)
    if (st.isFile() && st.size <= MAX_FILE_BYTES) collected.push(full)
  } catch {
    // ignore broken symlinks / deleted / unreadable entries
  }
}

function collectFilesFromDir(dir) {
  const absDir = path.resolve(dir)
  const collected = []

  // Prefer git ls-files inside a git work tree (fast + respects .gitignore).
  const gitCheck = spawnSync('git', ['-C', absDir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
  if (!gitCheck.error && gitCheck.status === 0 && gitCheck.stdout.trim() === 'true') {
    const ls = spawnSync('git', ['-C', absDir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    })
    if (!ls.error && ls.status === 0) {
      for (const rel of ls.stdout.split('\0')) {
        if (!rel || SKIP_FILE_RE.test(path.basename(rel)) || isIgnoredRelPath(rel)) continue
        pushIfSmallFile(collected, path.join(absDir, rel))
      }
      return collected
    }
  }

  const walk = (current) => {
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(path.join(current, entry.name))
      } else if (entry.isFile() && !SKIP_FILE_RE.test(entry.name)) {
        pushIfSmallFile(collected, path.join(current, entry.name))
      }
    }
  }
  walk(absDir)
  return collected
}

// Same rules as the CLI's newline manifest reader (trim, skip blanks and '#' comments).
function readUserFileList(listPath) {
  let raw
  try {
    raw = fs.readFileSync(listPath, 'utf8')
  } catch (err) {
    console.error(`Hata / Error: --file-list okunamadı / could not be read: ${listPath} (${err.message})`)
    process.exit(1)
  }
  if (raw.includes('\0')) return raw.split('\0').filter((p) => p.length > 0)
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

function runNative(finalArgs, onDone) {
  const res = spawnSync(nativeBin, finalArgs, { stdio: 'inherit' })
  onDone?.()
  if (res.error) {
    console.error(`Hata / Error: native ikili çalıştırılamadı / failed to run native binary ${nativeBin}: ${res.error.message}`)
    process.exit(1)
  }
  process.exit(res.status ?? 1)
}

async function runJs(finalArgs) {
  process.argv = [process.execPath, jsCliPath, ...finalArgs]
  // pathToFileURL: a bare absolute path such as C:\... is rejected by the ESM loader on Windows.
  const mod = await import(pathToFileURL(jsCliPath).href)
  mod.runCli()
}

// ---- argument split: directories vs. pass-through args ----
const rawArgs = process.argv.slice(2)
const dirs = []
const passArgs = []
let userFileList = null

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i]
  if (VALUE_OPTIONS.has(arg)) {
    const value = rawArgs[i + 1]
    i++
    if (arg === '--file-list' && value !== undefined) {
      userFileList = value
      continue
    }
    passArgs.push(arg)
    if (value !== undefined) passArgs.push(value)
    continue
  }
  if (!arg.startsWith('-')) {
    let isDir = false
    try {
      isDir = fs.statSync(arg).isDirectory()
    } catch {
      // not a path on disk; let the CLI report it
    }
    if (isDir) {
      dirs.push(arg)
      continue
    }
  }
  passArgs.push(arg)
}

if (dirs.length === 0) {
  const finalArgs = userFileList === null ? passArgs : ['--file-list', userFileList, ...passArgs]
  if (fs.existsSync(nativeBin)) runNative(finalArgs)
  else await runJs(finalArgs)
} else {
  const allFiles = new Set()
  for (const dir of dirs) {
    for (const f of collectFilesFromDir(dir)) allFiles.add(f)
  }
  // A user-supplied --file-list is merged into the generated manifest instead of replacing it.
  if (userFileList !== null) {
    for (const f of readUserFileList(userFileList)) allFiles.add(path.resolve(f))
  }
  const sorted = [...allFiles].sort()
  if (sorted.length === 0) {
    console.error(`Hata / Error: Belirtilen dizinde taranacak dosya bulunamadı / no files to scan in: ${dirs.join(', ')}`)
    process.exit(1)
  }

  // Private temp dir (mkdtemp) + exclusive create; NUL-delimited so any file name survives.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ailoopchecker-'))
  const tmpFile = path.join(tmpDir, 'files.lst')
  fs.writeFileSync(tmpFile, `${sorted.join('\0')}\0`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  process.on('exit', cleanup)

  const baseName = path.basename(path.resolve(dirs[0]))
  const projName = dirs.length > 1 ? `${baseName}+${dirs.length}dirs` : baseName
  // User args come last so an explicit --project-name overrides the default.
  const finalArgs = ['--project', '--project-name', projName, '--file-list', tmpFile, ...passArgs]

  if (fs.existsSync(nativeBin)) runNative(finalArgs, cleanup)
  else await runJs(finalArgs)
}

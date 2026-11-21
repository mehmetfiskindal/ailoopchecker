#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const nativeBin = path.join(root, 'dist', process.platform === 'win32' ? 'ailoopchecker.exe' : 'ailoopchecker')
const jsCliPath = path.join(root, 'lib', 'product', 'cli.js')

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'lib',
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

function collectFilesFromDir(dir) {
  const absDir = path.resolve(dir)
  const collected = []

  // Prefer git ls-files when inside a git work tree (fast + respects .gitignore)
  const gitCheck = spawnSync('git', ['-C', absDir, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8'
  })
  if (gitCheck.status === 0 && gitCheck.stdout.trim() === 'true') {
    const ls = spawnSync('git', ['-C', absDir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
    if (ls.status === 0) {
      const entries = ls.stdout.split('\0')
      for (const rel of entries) {
        if (!rel || SKIP_FILE_RE.test(rel)) continue
        const full = path.join(absDir, rel)
        try {
          const st = fs.statSync(full)
          if (st.isFile() && st.size <= MAX_FILE_BYTES) collected.push(full)
        } catch {
          // ignore broken symlinks / deleted entries
        }
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
        if (IGNORED_DIRS.has(entry.name)) continue
        walk(path.join(current, entry.name))
      } else if (entry.isFile()) {
        if (SKIP_FILE_RE.test(entry.name)) continue
        const full = path.join(current, entry.name)
        try {
          if (fs.statSync(full).size <= MAX_FILE_BYTES) collected.push(full)
        } catch {
          // ignore unreadable files
        }
      }
    }
  }
  walk(absDir)
  return collected
}

async function runArgs(finalArgs) {
  if (fs.existsSync(nativeBin)) {
    const res = spawnSync(nativeBin, finalArgs, { stdio: 'inherit' })
    process.exit(res.status ?? 1)
  }
  process.argv = [process.execPath, jsCliPath, ...finalArgs]
  const mod = await import(jsCliPath)
  mod.runCli()
}

const rawArgs = process.argv.slice(2)
const dirs = []
const passArgs = []

for (const arg of rawArgs) {
  if (!arg.startsWith('-') && fs.existsSync(arg)) {
    try {
      if (fs.statSync(arg).isDirectory()) {
        dirs.push(arg)
        continue
      }
    } catch {
      // fall through
    }
  }
  passArgs.push(arg)
}

if (dirs.length === 0) {
  await runArgs(rawArgs)
} else {
  const allFiles = new Set()
  for (const dir of dirs) {
    for (const f of collectFilesFromDir(dir)) allFiles.add(f)
  }
  const sorted = [...allFiles].sort()
  if (sorted.length === 0) {
    console.error(`Hata / Error: Belirtilen dizinde taranacak dosya bulunamadı: ${dirs.join(', ')}`)
    process.exit(1)
  }

  const tmpFile = path.join(os.tmpdir(), `ailoopchecker-${process.pid}-${Date.now()}.txt`)
  fs.writeFileSync(tmpFile, `${sorted.join('\n')}\n`, 'utf8')
  const cleanup = () => {
    try {
      fs.rmSync(tmpFile, { force: true })
    } catch {
      // ignore
    }
  }
  process.on('exit', cleanup)

  const baseName = path.basename(path.resolve(dirs[0]))
  const projName = dirs.length > 1 ? `${baseName}+${dirs.length}dirs` : baseName
  const finalArgs = ['--project', '--project-name', projName, '--file-list', tmpFile, ...passArgs]

  if (fs.existsSync(nativeBin)) {
    const res = spawnSync(nativeBin, finalArgs, { stdio: 'inherit' })
    cleanup()
    process.exit(res.status ?? 1)
  } else {
    await runArgs(finalArgs)
  }
}

import { existsSync, promises as fsPromises, statSync } from 'node:fs'
import { env as processEnv } from 'node:process'
import type { AnalysisReport, CliOptions, OutputLang } from '../shared/types.ts'
import { analyzeFile } from '../core/analyzer.ts'
import { auditProjectFiles } from '../core/project-audit.ts'
import {
  formatProjectReportJson,
  formatProjectReportText,
  formatReportsJson,
  formatReportText
} from './report.ts'
import { runSelfTests } from './selftest.ts'
import { VERSION } from '../shared/version.ts'

// Ensure node-compat's global URL provider is included for node:fs signatures
const _keepUrlGlobal: typeof URL | undefined = typeof URL !== 'undefined' ? URL : undefined
void _keepUrlGlobal


function printHelp(lang: OutputLang): void {
  if (lang === 'en') {
    console.log(`ailoopchecker v${VERSION} — Native geatsc AI Media Forensics CLI

Usage:
  ailoopchecker <file1> [file2 ...] [options]

Supported media:
  Images / Visual Products : PNG, JPEG, WebP, BMP, GIF, TIFF, AVIF/HEIC
  Videos                   : MP4, MOV, WebM, MKV, AVI
  Audio Recordings         : WAV (with native FFT/STFT DSP), MP3, FLAC, OGG, Opus, M4A
  Source Code              : TS, JS, Python, Rust, Go, Swift, Kotlin, Java, C#, C/C++, Zig, Dart, Ruby, PHP, Elixir, SQL, Shell
  Text / Product Copy      : TXT, MD, HTML, JSON (TR/EN stylometry)

Options:
  -p, --project       Aggregate files into a Project-Level AI-Loop audit report
  --file-list <file>  Read project file paths from a manifest (newline- or NUL-delimited)
  --json              Emit machine-readable JSON output
  -v, --verbose       Show full forensic evidence, metadata, DSP metrics, and SHA-256
  --strict            Exit with code 2 if AI / AI-Loop is detected
  --threshold <0-100> Score threshold for LIKELY_AI / AI_LOOP_LIKELY (default: 60)
  --lang <tr|en>      Output language (default: tr)
  --no-color          Disable ANSI colors
  --self-test         Run built-in synthetic forensic test suite
  -h, --help          Show this help
  -V, --version       Show version`)
    return
  }

  console.log(`ailoopchecker v${VERSION} — geatsc Native AI Medya & Proje AI-Loop Adli Tespit CLI

Kullanım:
  ailoopchecker <dosya1> [dosya2 ...] [seçenekler]
  ailoopchecker --project --file-list <dosya_listesi.txt> [seçenekler]

Desteklenen medya türleri:
  Görsel / Ürünler : PNG (tam IDAT piksel analizi), JPEG (EXIF/XMP/DQT), WebP, BMP, GIF, TIFF
  Videolar         : MP4, MOV (atom/kare/GOP/4k+1 analiz), WebM, MKV, AVI
  Ses Kayıtları    : WAV (native FFT/STFT vocoder & sessizlik DSP), MP3, FLAC, OGG, Opus, M4A
  Kaynak Kod       : TS, JS, Python, Rust, Go, Swift, Kotlin, Java, C#, C/C++, Zig, Dart, Ruby, PHP, Elixir, SQL, Shell
  Metin / Ürün     : TXT, MD, HTML, JSON (Türkçe & İngilizce stilometri)

Seçenekler:
  -p, --project       Dosyaları birleştirerek Proje Düzeyi AI-Loop denetim raporu üretir
  --file-list <dosya> Satır veya NUL ile ayrılmış dosya yolu listesinden proje tarar
  --json              Makine tarafından okunabilir JSON çıktısı üretir
  -v, --verbose       Tüm adli kanıtları, metaverileri, DSP metriklerini ve SHA-256 özetini gösterir
  --strict            AI veya AI-Loop tespit edilirse çıkış kodu 2 ile döner (CI/otomasyon için)
  --threshold <0-100> LIKELY_AI / AI_LOOP_LIKELY karar eşiği (varsayılan: 60)
  --lang <tr|en>      Çıktı dili (varsayılan: tr)
  --no-color          ANSI renklerini kapatır
  --self-test         Yerleşik sentetik dosya + proje AI-Loop test paketini çalıştırır
  -h, --help          Bu yardım metnini gösterir
  -V, --version       Sürüm bilgisini gösterir`)
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    files: [],
    projectMode: false,
    projectName: '',
    fileListPath: '',
    json: false,
    verbose: false,
    strict: false,
    threshold: 60,
    lang: 'tr',
    noColor: false,
    selfTest: false,
    showHelp: false,
    showVersion: false
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--project' || arg === '-p') opts.projectMode = true
    else if (arg === '--project-name' && i + 1 < argv.length) {
      opts.projectName = argv[++i]!
      opts.projectMode = true
    } else if (arg === '--file-list' && i + 1 < argv.length) {
      opts.fileListPath = argv[++i]!
      opts.projectMode = true
    } else if (arg === '--json') opts.json = true
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true
    else if (arg === '--strict') opts.strict = true
    else if (arg === '--no-color') opts.noColor = true
    else if (arg === '--self-test') opts.selfTest = true
    else if (arg === '--help' || arg === '-h') opts.showHelp = true
    else if (arg === '--version' || arg === '-V') opts.showVersion = true
    else if (arg === '--lang' && i + 1 < argv.length) {
      const next = argv[++i]!
      if (next === 'en' || next === 'tr') opts.lang = next
    } else if (arg === '--threshold' && i + 1 < argv.length) {
      const parsed = Number(argv[++i]!)
      if (!Number.isNaN(parsed) && parsed >= 10 && parsed <= 95) {
        opts.threshold = Math.round(parsed)
      }
    } else if (!arg.startsWith('-')) {
      opts.files.push(arg)
    } else {
      console.error(`Bilinmeyen seçenek / Unknown option: ${arg}`)
      process.exit(1)
    }
  }

  return opts
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const opts = parseArgs(args)

  if (opts.showVersion) {
    console.log(`ailoopchecker ${VERSION}`)
    process.exit(0)
  }

  if (opts.showHelp) {
    printHelp(opts.lang)
    process.exit(0)
  }

  const useColor = !opts.noColor && !opts.json && processEnv['NO_COLOR'] === undefined

  if (opts.selfTest) {
    const code = runSelfTests(opts.lang, opts.verbose, useColor)
    process.exit(code)
  }

  if (opts.fileListPath.length > 0) {
    const rawList = await fsPromises.readFile(opts.fileListPath, 'utf8')
    if (rawList.indexOf('\0') !== -1) {
      // NUL-delimited manifest (written by bin/ailoopchecker.mjs): paths are taken
      // verbatim so names with spaces, a leading '#' or newlines survive.
      const entries = rawList.split('\0')
      for (let i = 0; i < entries.length; i++) {
        if (entries[i]!.length > 0) opts.files.push(entries[i]!)
      }
    } else {
      // Hand-written newline-delimited manifest: trims lines, '#' starts a comment.
      const lines = rawList.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const p = lines[i]!.trim()
        if (p.length > 0 && !p.startsWith('#')) opts.files.push(p)
      }
    }
  }

  if (opts.files.length === 0) {
    printHelp(opts.lang)
    process.exit(1)
  }

  // Catch direct directory arguments when invoked without run-cli.sh / scan-project.sh
  for (let i = 0; i < opts.files.length; i++) {
    const p = opts.files[i]!
    if (existsSync(p) && statSync(p).isDirectory()) {
      console.error(
        opts.lang === 'en'
          ? `Directory argument detected: ${p}\nUse: npm start ${p}   or   ./scripts/scan-project.sh ${p}`
          : `Dizin yolu algılandı: ${p}\nTüm proje dizinini taramak için şunu çalıştırın:\n  npm start ${p}\nveya:\n  ./scripts/scan-project.sh ${p}`
      )
      process.exit(1)
    }
  }

  if (opts.projectMode) {
    const projectName =
      opts.projectName.length > 0
        ? opts.projectName
        : opts.fileListPath.length > 0
          ? opts.fileListPath
          : 'workspace-project'
    const projectReport = await auditProjectFiles(
      projectName,
      opts.files,
      opts.threshold,
      async (path: string): Promise<Uint8Array | null> => {
        try {
          return await fsPromises.readFile(path)
        } catch {
          return null
        }
      }
    )

    if (opts.json) {
      console.log(formatProjectReportJson(projectReport))
    } else {
      console.log(formatProjectReportText(projectReport, opts.lang, opts.verbose, useColor))
    }

    if (projectReport.errorFiles > 0 && projectReport.analyzedFiles === 0) process.exit(1)
    if (
      opts.strict &&
      (projectReport.projectVerdict === 'AI_LOOP_CONFIRMED' ||
        projectReport.projectVerdict === 'AI_LOOP_LIKELY')
    ) {
      process.exit(2)
    }
    return
  }

  const reports: AnalysisReport[] = []
  let hasError = false
  let hasAiDetected = false

  for (let i = 0; i < opts.files.length; i++) {
    const report = await analyzeFile(opts.files[i]!, opts.threshold)
    reports.push(report)
    if (report.error.length > 0) hasError = true
    if (report.verdict === 'CONFIRMED_AI' || report.verdict === 'LIKELY_AI') {
      hasAiDetected = true
    }
  }

  if (opts.json) {
    console.log(formatReportsJson(reports))
  } else {
    for (let i = 0; i < reports.length; i++) {
      console.log(formatReportText(reports[i]!, opts.lang, opts.verbose, useColor))
    }
  }

  if (hasError) process.exit(1)
  if (opts.strict && hasAiDetected) process.exit(2)
}

export function runCli(): void {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Kritik hata / Fatal error: ${message}`)
    process.exit(1)
  })
}

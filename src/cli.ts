import { env as processEnv } from 'node:process'
import type { AnalysisReport, CliOptions, OutputLang } from './types.ts'
import { analyzeFile } from './analyzer.ts'
import { formatReportsJson, formatReportText } from './report.ts'
import { runSelfTests } from './selftest.ts'

// Ensure node-compat's global URL provider is included for node:fs signatures
const _keepUrlGlobal: typeof URL | undefined = typeof URL !== 'undefined' ? URL : undefined
void _keepUrlGlobal

const VERSION = '1.0.0'

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
  --json              Emit machine-readable JSON output
  -v, --verbose       Show full forensic evidence, metadata, DSP metrics, and SHA-256
  --strict            Exit with code 2 if any file is flagged as AI-generated
  --threshold <0-100> Score threshold for LIKELY_AI (default: 60)
  --lang <tr|en>      Output language (default: tr)
  --no-color          Disable ANSI colors
  --self-test         Run built-in synthetic forensic test suite
  -h, --help          Show this help
  -V, --version       Show version`)
    return
  }

  console.log(`ailoopchecker v${VERSION} — geatsc Native AI Medya Adli Tespit CLI

Kullanım:
  ailoopchecker <dosya1> [dosya2 ...] [seçenekler]

Desteklenen medya türleri:
  Görsel / Ürünler : PNG (tam IDAT piksel analizi), JPEG (EXIF/XMP/DQT), WebP, BMP, GIF, TIFF
  Videolar         : MP4, MOV (atom/kare/GOP/4k+1 analiz), WebM, MKV, AVI
  Ses Kayıtları    : WAV (native FFT/STFT vocoder & sessizlik DSP), MP3, FLAC, OGG, Opus, M4A
  Kaynak Kod       : TS, JS, Python, Rust, Go, Swift, Kotlin, Java, C#, C/C++, Zig, Dart, Ruby, PHP, Elixir, SQL, Shell
  Metin / Ürün     : TXT, MD, HTML, JSON (Türkçe & İngilizce stilometri)

Seçenekler:
  --json              Makine tarafından okunabilir JSON çıktısı üretir
  -v, --verbose       Tüm adli kanıtları, metaverileri, DSP metriklerini ve SHA-256 özetini gösterir
  --strict            AI tespit edilen dosya varsa çıkış kodu 2 ile döner (CI/otomasyon için)
  --threshold <0-100> LIKELY_AI karar eşiği (varsayılan: 60)
  --lang <tr|en>      Çıktı dili (varsayılan: tr)
  --no-color          ANSI renklerini kapatır
  --self-test         Yerleşik sentetik görsel/video/ses/metin test paketini çalıştırır
  -h, --help          Bu yardım metnini gösterir
  -V, --version       Sürüm bilgisini gösterir`)
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    files: [],
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
    if (arg === '--json') opts.json = true
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

  if (opts.files.length === 0) {
    printHelp(opts.lang)
    process.exit(1)
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

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`Kritik hata / Fatal error: ${message}`)
  process.exit(1)
})

import type {
  AnalysisReport,
  FindingSeverity,
  OutputLang,
  ProjectAuditReport,
  ProjectVerdict,
  Verdict
} from '../shared/types.ts'

interface AnsiPalette {
  reset: string
  bold: string
  dim: string
  red: string
  yellow: string
  green: string
  cyan: string
  magenta: string
  gray: string
}

function getPalette(useColor: boolean): AnsiPalette {
  if (!useColor) {
    return {
      reset: '',
      bold: '',
      dim: '',
      red: '',
      yellow: '',
      green: '',
      cyan: '',
      magenta: '',
      gray: ''
    }
  }
  return {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m'
  }
}

function verdictLabel(verdict: Verdict, lang: OutputLang): string {
  if (lang === 'en') {
    if (verdict === 'CONFIRMED_AI') return 'CONFIRMED AI-GENERATED'
    if (verdict === 'LIKELY_AI') return 'LIKELY AI-GENERATED'
    if (verdict === 'LIKELY_AUTHENTIC') return 'LIKELY AUTHENTIC'
    return 'INCONCLUSIVE'
  }
  if (verdict === 'CONFIRMED_AI') return 'KESİN AI ÜRETİMİ'
  if (verdict === 'LIKELY_AI') return 'YÜKSEK AI OLASILIĞI'
  if (verdict === 'LIKELY_AUTHENTIC') return 'DOĞAL / OTANTİK GÖRÜNÜYOR'
  return 'BELİRSİZ (EK İNCELEME GEREKLİ)'
}

function categoryLabel(cat: string, lang: OutputLang): string {
  if (lang === 'en') {
    if (cat === 'image') return 'Image / Visual Product'
    if (cat === 'video') return 'Video'
    if (cat === 'audio') return 'Audio Recording'
    if (cat === 'code') return 'Source Code'
    if (cat === 'text') return 'Text / Product Copy'
    return 'Unknown'
  }
  if (cat === 'image') return 'Görsel / Ürün'
  if (cat === 'video') return 'Video'
  if (cat === 'audio') return 'Ses Kaydı'
  if (cat === 'code') return 'Kaynak Kod'
  if (cat === 'text') return 'Metin / Ürün İçeriği'
  return 'Bilinmeyen'
}

function verdictColor(verdict: Verdict, c: AnsiPalette): string {
  if (verdict === 'CONFIRMED_AI') return c.red
  if (verdict === 'LIKELY_AI') return c.yellow
  if (verdict === 'LIKELY_AUTHENTIC') return c.green
  return c.cyan
}

function severityTag(sev: FindingSeverity, c: AnsiPalette): string {
  if (sev === 'critical') return `${c.red}[KRİTİK]${c.reset}`
  if (sev === 'high') return `${c.red}[YÜKSEK]${c.reset}`
  if (sev === 'medium') return `${c.yellow}[ORTA]${c.reset}`
  if (sev === 'authentic') return `${c.green}[OTANTİK]${c.reset}`
  return `${c.cyan}[DÜŞÜK]${c.reset}`
}

function severityTagEn(sev: FindingSeverity, c: AnsiPalette): string {
  if (sev === 'critical') return `${c.red}[CRITICAL]${c.reset}`
  if (sev === 'high') return `${c.red}[HIGH]${c.reset}`
  if (sev === 'medium') return `${c.yellow}[MEDIUM]${c.reset}`
  if (sev === 'authentic') return `${c.green}[AUTHENTIC]${c.reset}`
  return `${c.cyan}[LOW]${c.reset}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function renderBar(score: number, c: AnsiPalette, color: string): string {
  const width = 24
  const filled = Math.round((score / 100) * width)
  let bar = ''
  for (let i = 0; i < width; i++) {
    bar += i < filled ? '#' : '-'
  }
  return `${color}[${bar}]${c.reset} ${c.bold}${score}/100${c.reset}`
}

export function formatReportText(
  report: AnalysisReport,
  lang: OutputLang,
  verbose: boolean,
  useColor: boolean
): string {
  const c = getPalette(useColor)
  const lines: string[] = []
  const rule = `${c.gray}────────────────────────────────────────────────────────────────${c.reset}`

  lines.push(rule)
  lines.push(`${c.bold}${report.fileName}${c.reset} ${c.dim}(${report.filePath})${c.reset}`)

  if (report.error.length > 0) {
    lines.push(`  ${c.red}${lang === 'tr' ? 'HATA' : 'ERROR'}: ${report.error}${c.reset}`)
    return lines.join('\n')
  }

  const vColor = verdictColor(report.verdict, c)
  const catText = categoryLabel(report.mediaCategory, lang)
  const vText = verdictLabel(report.verdict, lang)

  lines.push(
    `  ${lang === 'tr' ? 'Tür' : 'Type'}      : ${c.cyan}${catText}${c.reset} (${report.detectedFormat}) · ${formatBytes(report.fileSize)} · ${report.elapsedMs} ms`
  )
  lines.push(
    `  ${lang === 'tr' ? 'Karar' : 'Verdict'}   : ${vColor}${c.bold}${vText}${c.reset} (${lang === 'tr' ? 'Güven' : 'Confidence'}: %${report.confidence})`
  )
  lines.push(
    `  ${lang === 'tr' ? 'AI Skoru' : 'AI Score'}  : ${renderBar(report.aiScore, c, vColor)}`
  )

  if (report.generatorHints.length > 0) {
    lines.push(
      `  ${lang === 'tr' ? 'Üretici' : 'Generator'} : ${c.magenta}${report.generatorHints.join(', ')}${c.reset}`
    )
  }

  if (report.findings.length > 0) {
    lines.push('')
    lines.push(`  ${c.bold}${lang === 'tr' ? 'Adli Bulgular' : 'Forensic Findings'} (${report.findings.length}):${c.reset}`)
    for (let i = 0; i < report.findings.length; i++) {
      const f = report.findings[i]!
      const tag = lang === 'tr' ? severityTag(f.severity, c) : severityTagEn(f.severity, c)
      const deltaStr = f.scoreDelta >= 0 ? `+${f.scoreDelta}` : `${f.scoreDelta}`
      const title = lang === 'tr' ? f.titleTr : f.titleEn
      const detail = lang === 'tr' ? f.detailTr : f.detailEn
      lines.push(`    ${tag} ${title} ${c.dim}(${deltaStr})${c.reset}`)
      if (verbose) {
        lines.push(`      ${c.dim}${detail}${c.reset}`)
        if (f.evidence.length > 0) {
          lines.push(`      ${c.gray}↳ ${f.evidence}${c.reset}`)
        }
      }
    }
  } else {
    lines.push('')
    lines.push(
      `  ${c.dim}${lang === 'tr' ? 'Belirgin AI veya otantik kanıt imzası bulunamadı.' : 'No strong AI or authentic provenance signals found.'}${c.reset}`
    )
  }

  if (verbose) {
    lines.push('')
    lines.push(`  ${c.bold}SHA-256${c.reset}   : ${c.dim}${report.sha256}${c.reset}`)
    if (report.metadata.length > 0) {
      lines.push(`  ${c.bold}${lang === 'tr' ? 'Metaveri' : 'Metadata'}:${c.reset}`)
      for (let i = 0; i < report.metadata.length; i++) {
        const m = report.metadata[i]!
        lines.push(`    - ${m.key}: ${m.value}`)
      }
    }
    if (report.metrics.length > 0) {
      lines.push(`  ${c.bold}${lang === 'tr' ? 'Sinyal / İstatistik Metrikleri' : 'Signal / Statistical Metrics'}:${c.reset}`)
      for (let i = 0; i < report.metrics.length; i++) {
        const m = report.metrics[i]!
        lines.push(`    - ${m.key}: ${m.value}`)
      }
    }
  }

  return lines.join('\n')
}

function jsonString(value: string): string {
  let out = '"'
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i)
    if (ch === 34) out += '\\"'
    else if (ch === 92) out += '\\\\'
    else if (ch === 8) out += '\\b'
    else if (ch === 12) out += '\\f'
    else if (ch === 10) out += '\\n'
    else if (ch === 13) out += '\\r'
    else if (ch === 9) out += '\\t'
    else if (ch < 32) {
      const hex = ch.toString(16)
      out += hex.length === 1 ? `\\u000${hex}` : `\\u00${hex}`
    } else {
      out += value.charAt(i)
    }
  }
  return `${out}"`
}

function serializeStringArray(items: string[]): string {
  if (items.length === 0) return '[]'
  const parts: string[] = []
  for (let i = 0; i < items.length; i++) {
    parts.push(jsonString(items[i]!))
  }
  return `[${parts.join(', ')}]`
}

function serializeKeyValues(items: { key: string; value: string }[], indent: string): string {
  if (items.length === 0) return '[]'
  const lines: string[] = ['[']
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const comma = i + 1 < items.length ? ',' : ''
    lines.push(`${indent}  { "key": ${jsonString(item.key)}, "value": ${jsonString(item.value)} }${comma}`)
  }
  lines.push(`${indent}]`)
  return lines.join('\n')
}

function serializeReport(r: AnalysisReport): string {
  const findingLines: string[] = []
  for (let i = 0; i < r.findings.length; i++) {
    const f = r.findings[i]!
    const comma = i + 1 < r.findings.length ? ',' : ''
    findingLines.push(
      `        {\n` +
        `          "id": ${jsonString(f.id)},\n` +
        `          "category": ${jsonString(f.category)},\n` +
        `          "severity": ${jsonString(f.severity)},\n` +
        `          "scoreDelta": ${f.scoreDelta},\n` +
        `          "titleTr": ${jsonString(f.titleTr)},\n` +
        `          "titleEn": ${jsonString(f.titleEn)},\n` +
        `          "detailTr": ${jsonString(f.detailTr)},\n` +
        `          "detailEn": ${jsonString(f.detailEn)},\n` +
        `          "evidence": ${jsonString(f.evidence)}\n` +
        `        }${comma}`
    )
  }
  const findingsJson = findingLines.length === 0 ? '[]' : `[\n${findingLines.join('\n')}\n      ]`
  return (
    `    {\n` +
    `      "filePath": ${jsonString(r.filePath)},\n` +
    `      "fileName": ${jsonString(r.fileName)},\n` +
    `      "fileSize": ${r.fileSize},\n` +
    `      "sha256": ${jsonString(r.sha256)},\n` +
    `      "mediaCategory": ${jsonString(r.mediaCategory)},\n` +
    `      "detectedFormat": ${jsonString(r.detectedFormat)},\n` +
    `      "aiScore": ${r.aiScore},\n` +
    `      "confidence": ${r.confidence},\n` +
    `      "verdict": ${jsonString(r.verdict)},\n` +
    `      "generatorHints": ${serializeStringArray(r.generatorHints)},\n` +
    `      "findings": ${findingsJson},\n` +
    `      "metadata": ${serializeKeyValues(r.metadata, '      ')},\n` +
    `      "metrics": ${serializeKeyValues(r.metrics, '      ')},\n` +
    `      "elapsedMs": ${r.elapsedMs},\n` +
    `      "error": ${jsonString(r.error)}\n` +
    `    }`
  )
}

export function formatReportsJson(reports: AnalysisReport[]): string {
  const parts: string[] = []
  for (let i = 0; i < reports.length; i++) {
    parts.push(serializeReport(reports[i]!))
  }
  const reportsJson = parts.length === 0 ? '[]' : `[\n${parts.join(',\n')}\n  ]`
  return (
    `{\n` +
    `  "tool": "ailoopchecker",\n` +
    `  "version": "1.0.0",\n` +
    `  "count": ${reports.length},\n` +
    `  "reports": ${reportsJson}\n` +
    `}`
  )
}

function projectVerdictLabel(verdict: ProjectVerdict, lang: OutputLang): string {
  if (lang === 'en') {
    if (verdict === 'AI_LOOP_CONFIRMED') return 'AI-LOOP PROJECT CONFIRMED'
    if (verdict === 'AI_LOOP_LIKELY') return 'LIKELY AI-LOOP PROJECT'
    if (verdict === 'MIXED_AI_ASSISTED') return 'MIXED / AI-ASSISTED PROJECT'
    return 'ORGANIC / AUTHENTIC PROJECT'
  }
  if (verdict === 'AI_LOOP_CONFIRMED') return 'KESİN AI-LOOP PROJESİ'
  if (verdict === 'AI_LOOP_LIKELY') return 'YÜKSEK AI-LOOP OLASILIĞI'
  if (verdict === 'MIXED_AI_ASSISTED') return 'KARMA / AI DESTEKLİ PROJE'
  return 'ORGANİK / OTANTİK PROJE'
}

function projectVerdictColor(verdict: ProjectVerdict, c: AnsiPalette): string {
  if (verdict === 'AI_LOOP_CONFIRMED') return c.red
  if (verdict === 'AI_LOOP_LIKELY') return c.yellow
  if (verdict === 'ORGANIC_PROJECT') return c.green
  return c.cyan
}

export function formatProjectReportText(
  project: ProjectAuditReport,
  lang: OutputLang,
  verbose: boolean,
  useColor: boolean
): string {
  const c = getPalette(useColor)
  const lines: string[] = []
  const thick = `${c.bold}════════════════════════════════════════════════════════════════${c.reset}`
  const vColor = projectVerdictColor(project.projectVerdict, c)
  const vLabel = projectVerdictLabel(project.projectVerdict, lang)

  lines.push(thick)
  lines.push(
    `${c.bold}${lang === 'tr' ? 'PROJE AI-LOOP DENETİM RAPORU' : 'PROJECT AI-LOOP AUDIT REPORT'}${c.reset} · ${c.cyan}${project.projectName}${c.reset}`
  )
  lines.push(
    `  ${lang === 'tr' ? 'Proje Kararı' : 'Project Verdict'} : ${vColor}${c.bold}${vLabel}${c.reset} (${lang === 'tr' ? 'Güven' : 'Confidence'}: %${project.confidence})`
  )
  lines.push(
    `  ${lang === 'tr' ? 'AI-Loop Skoru' : 'AI-Loop Score'}   : ${renderBar(project.projectScore, c, vColor)}`
  )
  lines.push(
    `  ${lang === 'tr' ? 'Dosya Dağılımı' : 'File Breakdown'}  : ${project.analyzedFiles}/${project.totalFiles} · AI=${project.aiFiles} (%${project.aiRatioPercent}) · ${lang === 'tr' ? 'Doğal' : 'Authentic'}=${project.authenticFiles} · ${lang === 'tr' ? 'Belirsiz' : 'Inconclusive'}=${project.inconclusiveFiles} · ${project.elapsedMs} ms`
  )
  lines.push(
    `  ${lang === 'tr' ? 'Çapraz Tekrar' : 'Cross-File Dup'}  : %${project.crossFileDuplicationPercent} · ${lang === 'tr' ? 'Ort. Dosya Skoru' : 'Avg File Score'}: ${project.averageFileAiScore}/100`
  )
  if (project.modalitiesWithAi.length > 0) {
    lines.push(
      `  ${lang === 'tr' ? 'AI Katmanları' : 'AI Modalities'}   : ${c.magenta}${project.modalitiesWithAi.join(', ')}${c.reset}`
    )
  }

  if (project.findings.length > 0) {
    lines.push('')
    lines.push(
      `  ${c.bold}${lang === 'tr' ? 'Proje Düzeyi Bulgular' : 'Project-Level Findings'} (${project.findings.length}):${c.reset}`
    )
    for (let i = 0; i < project.findings.length; i++) {
      const f = project.findings[i]!
      const tag = lang === 'tr' ? severityTag(f.severity, c) : severityTagEn(f.severity, c)
      const deltaStr = f.scoreDelta >= 0 ? `+${f.scoreDelta}` : `${f.scoreDelta}`
      const title = lang === 'tr' ? f.titleTr : f.titleEn
      const detail = lang === 'tr' ? f.detailTr : f.detailEn
      lines.push(`    ${tag} ${title} ${c.dim}(${deltaStr})${c.reset}`)
      if (verbose) {
        lines.push(`      ${c.dim}${detail}${c.reset}`)
        if (f.evidence.length > 0) lines.push(`      ${c.gray}↳ ${f.evidence}${c.reset}`)
      }
    }
  }

  lines.push('')
  const flagged: AnalysisReport[] = []
  for (let i = 0; i < project.reports.length; i++) {
    const r = project.reports[i]!
    if (r.verdict === 'CONFIRMED_AI' || r.verdict === 'LIKELY_AI' || r.error.length > 0) {
      flagged.push(r)
    }
  }
  if (!verbose && project.reports.length > 30) {
    lines.push(
      `  ${c.bold}${lang === 'tr' ? 'AI İşaretli Dosyalar' : 'Flagged AI Files'} (${flagged.length}/${project.reports.length}):${c.reset}`
    )
    const showLimit = Math.min(flagged.length, 40)
    for (let i = 0; i < showLimit; i++) {
      const r = flagged[i]!
      const vc = verdictColor(r.verdict, c)
      lines.push(
        `    - ${r.filePath} [${r.mediaCategory}/${r.detectedFormat}] -> ${vc}${r.verdict}${c.reset} (${r.aiScore}/100)`
      )
    }
    if (flagged.length > showLimit) {
      lines.push(
        `    ${c.dim}... +${flagged.length - showLimit} ${lang === 'tr' ? 'ek işaretli dosya (-v veya --json ile tümünü görün)' : 'more flagged files (use -v or --json to see all)'}${c.reset}`
      )
    }
    if (flagged.length === 0) {
      lines.push(
        `    ${c.green}${lang === 'tr' ? 'Hiçbir dosya AI olarak işaretlenmedi.' : 'No files flagged as AI.'}${c.reset}`
      )
    }
  } else {
    lines.push(
      `  ${c.bold}${lang === 'tr' ? 'Dosya Özeti' : 'Per-File Summary'}:${c.reset}`
    )
    for (let i = 0; i < project.reports.length; i++) {
      const r = project.reports[i]!
      const vc = verdictColor(r.verdict, c)
      lines.push(
        `    - ${r.filePath} [${r.mediaCategory}/${r.detectedFormat}] -> ${vc}${r.verdict}${c.reset} (${r.aiScore}/100)`
      )
    }
  }

  if (verbose) {
    lines.push('')
    for (let i = 0; i < project.reports.length; i++) {
      lines.push(formatReportText(project.reports[i]!, lang, true, useColor))
    }
  }

  return lines.join('\n')
}

export function formatProjectReportJson(project: ProjectAuditReport): string {
  const findingLines: string[] = []
  for (let i = 0; i < project.findings.length; i++) {
    const f = project.findings[i]!
    const comma = i + 1 < project.findings.length ? ',' : ''
    findingLines.push(
      `    {\n` +
        `      "id": ${jsonString(f.id)},\n` +
        `      "category": ${jsonString(f.category)},\n` +
        `      "severity": ${jsonString(f.severity)},\n` +
        `      "scoreDelta": ${f.scoreDelta},\n` +
        `      "titleTr": ${jsonString(f.titleTr)},\n` +
        `      "titleEn": ${jsonString(f.titleEn)},\n` +
        `      "detailTr": ${jsonString(f.detailTr)},\n` +
        `      "detailEn": ${jsonString(f.detailEn)},\n` +
        `      "evidence": ${jsonString(f.evidence)}\n` +
        `    }${comma}`
    )
  }
  const findingsJson = findingLines.length === 0 ? '[]' : `[\n${findingLines.join('\n')}\n  ]`

  const reportParts: string[] = []
  for (let i = 0; i < project.reports.length; i++) {
    reportParts.push(serializeReport(project.reports[i]!))
  }
  const reportsJson = reportParts.length === 0 ? '[]' : `[\n${reportParts.join(',\n')}\n  ]`

  return (
    `{\n` +
    `  "tool": "ailoopchecker",\n` +
    `  "version": "1.0.0",\n` +
    `  "mode": "project",\n` +
    `  "projectName": ${jsonString(project.projectName)},\n` +
    `  "totalFiles": ${project.totalFiles},\n` +
    `  "analyzedFiles": ${project.analyzedFiles},\n` +
    `  "errorFiles": ${project.errorFiles},\n` +
    `  "aiFiles": ${project.aiFiles},\n` +
    `  "authenticFiles": ${project.authenticFiles},\n` +
    `  "inconclusiveFiles": ${project.inconclusiveFiles},\n` +
    `  "aiRatioPercent": ${project.aiRatioPercent},\n` +
    `  "averageFileAiScore": ${project.averageFileAiScore},\n` +
    `  "crossFileDuplicationPercent": ${project.crossFileDuplicationPercent},\n` +
    `  "modalitiesWithAi": ${serializeStringArray(project.modalitiesWithAi)},\n` +
    `  "projectScore": ${project.projectScore},\n` +
    `  "confidence": ${project.confidence},\n` +
    `  "projectVerdict": ${jsonString(project.projectVerdict)},\n` +
    `  "elapsedMs": ${project.elapsedMs},\n` +
    `  "findings": ${findingsJson},\n` +
    `  "reports": ${reportsJson}\n` +
    `}`
  )
}

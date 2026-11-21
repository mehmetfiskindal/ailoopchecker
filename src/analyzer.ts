import { promises as fsPromises, existsSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import type { AnalysisReport, AnalyzerResult } from './types.ts'
import { detectMagicFormat, round2 } from './bytes.ts'
import { analyzeImage } from './analyzers/image.ts'
import { analyzeVideo } from './analyzers/video.ts'
import { analyzeAudio } from './analyzers/audio.ts'
import { analyzeCode } from './analyzers/code.ts'
import { analyzeText } from './analyzers/text.ts'
import { evaluateFindings } from './scoring.ts'

export function analyzeBuffer(
  buf: Uint8Array,
  filePath: string,
  threshold: number
): AnalysisReport {
  const started = performance.now()
  const fileName = basename(filePath)
  const ext = extname(fileName).toLowerCase()
  const sha256 = createHash('sha256').update(buf).digest('hex')

  const magic = detectMagicFormat(buf, ext)
  let result: AnalyzerResult

  if (magic.category === 'image') {
    result = analyzeImage(buf, magic.format)
  } else if (magic.category === 'video') {
    result = analyzeVideo(buf, magic.format)
  } else if (magic.category === 'audio') {
    result = analyzeAudio(buf, magic.format)
  } else if (magic.category === 'code') {
    result = analyzeCode(buf, magic.format)
  } else if (magic.category === 'text') {
    result = analyzeText(buf, magic.format)
  } else {
    result = {
      mediaCategory: 'unknown',
      detectedFormat: magic.format,
      findings: [],
      metadata: [],
      metrics: [],
      generatorHints: []
    }
  }

  const scored = evaluateFindings(result.findings, threshold)
  const elapsedMs = round2(performance.now() - started)

  return {
    filePath,
    fileName,
    fileSize: buf.length,
    sha256,
    mediaCategory: result.mediaCategory,
    detectedFormat: result.detectedFormat,
    aiScore: scored.aiScore,
    confidence: scored.confidence,
    verdict: scored.verdict,
    generatorHints: result.generatorHints,
    findings: result.findings,
    metadata: result.metadata,
    metrics: result.metrics,
    elapsedMs,
    error: ''
  }
}

export async function analyzeFile(filePath: string, threshold: number): Promise<AnalysisReport> {
  const started = performance.now()
  const fileName = basename(filePath)

  if (!existsSync(filePath)) {
    return {
      filePath,
      fileName,
      fileSize: 0,
      sha256: '',
      mediaCategory: 'unknown',
      detectedFormat: 'NONE',
      aiScore: 0,
      confidence: 0,
      verdict: 'INCONCLUSIVE',
      generatorHints: [],
      findings: [],
      metadata: [],
      metrics: [],
      elapsedMs: round2(performance.now() - started),
      error: `Dosya bulunamadı / File not found: ${filePath}`
    }
  }

  try {
    const st = statSync(filePath)
    if (st.isDirectory()) {
      return {
        filePath,
        fileName,
        fileSize: 0,
        sha256: '',
        mediaCategory: 'unknown',
        detectedFormat: 'DIR',
        aiScore: 0,
        confidence: 0,
        verdict: 'INCONCLUSIVE',
        generatorHints: [],
        findings: [],
        metadata: [],
        metrics: [],
        elapsedMs: round2(performance.now() - started),
        error: `Dizin yerine dosya yolu verin / Expected a file path, got directory: ${filePath}`
      }
    }

    const buf = await fsPromises.readFile(filePath)
    return analyzeBuffer(buf, filePath, threshold)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      filePath,
      fileName,
      fileSize: 0,
      sha256: '',
      mediaCategory: 'unknown',
      detectedFormat: 'ERROR',
      aiScore: 0,
      confidence: 0,
      verdict: 'INCONCLUSIVE',
      generatorHints: [],
      findings: [],
      metadata: [],
      metrics: [],
      elapsedMs: round2(performance.now() - started),
      error: message
    }
  }
}

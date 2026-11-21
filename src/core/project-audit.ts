import { basename } from 'node:path'
import type {
  AnalysisReport,
  ForensicFinding,
  ProjectAuditReport,
  ProjectVerdict
} from '../shared/types.ts'
import { addUnique, clamp, round2 } from '../shared/bytes.ts'
import { analyzeBuffer, analyzeFile } from './analyzer.ts'

export interface ProjectMemoryFile {
  filePath: string
  data: Uint8Array
}

const AI_AGENT_CONFIG_NAMES: string[] = [
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  'claude.md',
  'agents.md',
  'gemini.md',
  'copilot-instructions.md',
  'ralph.sh',
  'ralph-loop.sh',
  'prompt-loop.md',
  'autogpt.yaml',
  'crewai.yaml'
]

function isAiLoopConfigFile(filePath: string): boolean {
  const lowerBase = basename(filePath).toLowerCase()
  for (let i = 0; i < AI_AGENT_CONFIG_NAMES.length; i++) {
    if (lowerBase === AI_AGENT_CONFIG_NAMES[i]) return true
  }
  const lowerPath = filePath.toLowerCase()
  if (
    lowerPath.indexOf('ralph') >= 0 ||
    lowerPath.indexOf('agent-loop') >= 0 ||
    lowerPath.indexOf('agent_loop') >= 0 ||
    lowerPath.indexOf('ai-loop') >= 0 ||
    lowerPath.indexOf('ai_loop') >= 0 ||
    lowerPath.indexOf('.cursor/rules') >= 0
  ) {
    return true
  }
  return false
}

// Pure O(N) byte-level normalized line hashing: zero string allocations in hot loops.
function extractNormalizedLineHashes(buf: Uint8Array): Set<number> {
  const limit = Math.min(buf.length, 65536)
  const unique = new Set<number>()
  let lineCount = 0
  let i = 0
  while (i < limit && lineCount < 800) {
    let lineStart = i
    while (i < limit && buf[i] !== 10) i++
    const lineEnd = i
    if (i < limit) i++
    lineCount++

    while (lineStart < lineEnd && (buf[lineStart] === 32 || buf[lineStart] === 9 || buf[lineStart] === 13)) {
      lineStart++
    }
    let end = lineEnd
    while (end > lineStart && (buf[end - 1] === 32 || buf[end - 1] === 9 || buf[end - 1] === 13)) {
      end--
    }
    const rawLen = end - lineStart
    if (rawLen < 28) continue

    if (
      rawLen >= 7 &&
      ((buf[lineStart] === 105 && buf[lineStart + 1] === 109 && buf[lineStart + 2] === 112 && buf[lineStart + 3] === 111) ||
        (buf[lineStart] === 102 && buf[lineStart + 1] === 114 && buf[lineStart + 2] === 111 && buf[lineStart + 3] === 109))
    ) {
      continue
    }

    let h = 2166136261
    let prevSpace = false
    let normLen = 0
    for (let k = lineStart; k < end; k++) {
      let b = buf[k]!
      if (b === 32 || b === 9 || b === 13) {
        if (!prevSpace) {
          h = Math.imul(h ^ 32, 16777619)
          normLen++
          prevSpace = true
        }
      } else {
        if (b >= 65 && b <= 90) b += 32
        h = Math.imul(h ^ b, 16777619)
        normLen++
        prevSpace = false
      }
    }
    if (normLen >= 28) {
      unique.add(h >>> 0)
    }
  }
  return unique
}

function computeCrossFileDuplication(
  reports: AnalysisReport[],
  lineSets: Set<number>[]
): number {
  const lineFreq = new Map<number, number>()
  let totalMeaningfulLines = 0
  for (let i = 0; i < lineSets.length; i++) {
    const s = lineSets[i]!
    for (const h of s) {
      totalMeaningfulLines++
      lineFreq.set(h, (lineFreq.get(h) ?? 0) + 1)
    }
  }
  if (totalMeaningfulLines === 0 || lineSets.length < 2) return 0

  let duplicatedOccurrences = 0
  for (const count of lineFreq.values()) {
    if (count >= 2) duplicatedOccurrences += count
  }

  // Only count duplicate SHA-256 on non-trivial files (>= 256 bytes) so empty/tiny stubs don't inflate duplication
  const hashCounts = new Map<string, number>()
  let nonTrivialFiles = 0
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]!
    if (r.error.length > 0 || r.sha256.length === 0 || r.fileSize < 256) continue
    nonTrivialFiles++
    hashCounts.set(r.sha256, (hashCounts.get(r.sha256) ?? 0) + 1)
  }
  let duplicateFiles = 0
  for (const c of hashCounts.values()) {
    if (c >= 2) duplicateFiles += c - 1
  }
  const dupFileRatioPct = nonTrivialFiles > 0 ? (duplicateFiles / nonTrivialFiles) * 100 : 0
  const lineDupPct = (duplicatedOccurrences / totalMeaningfulLines) * 100
  return round2(clamp(lineDupPct + dupFileRatioPct * 0.5, 0, 100))
}

function buildProjectSummary(
  projectName: string,
  reports: AnalysisReport[],
  lineSets: Set<number>[],
  startedMs: number,
  threshold: number
): ProjectAuditReport {
  const findings: ForensicFinding[] = []
  const modalitiesWithAi: string[] = []
  const configMarkersFound: string[] = []

  let analyzedFiles = 0
  let errorFiles = 0
  let aiFiles = 0
  let confirmedAiFiles = 0
  let authenticFiles = 0
  let inconclusiveFiles = 0
  let scoreSum = 0
  let unboundedLlmLoops = 0
  let selfFeedbackLoops = 0
  let omissionFiles = 0

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]!
    if (isAiLoopConfigFile(r.filePath)) {
      addUnique(configMarkersFound, r.fileName)
    }
    if (r.error.length > 0) {
      errorFiles++
      continue
    }
    analyzedFiles++
    scoreSum += r.aiScore

    if (r.verdict === 'CONFIRMED_AI') {
      aiFiles++
      confirmedAiFiles++
      addUnique(modalitiesWithAi, r.mediaCategory)
    } else if (r.verdict === 'LIKELY_AI') {
      aiFiles++
      addUnique(modalitiesWithAi, r.mediaCategory)
    } else if (r.verdict === 'LIKELY_AUTHENTIC') {
      authenticFiles++
    } else {
      inconclusiveFiles++
    }

    for (let j = 0; j < r.findings.length; j++) {
      const f = r.findings[j]!
      if (f.id === 'code_unbounded_llm_loop') unboundedLlmLoops++
      else if (f.id === 'code_self_prompt_feedback_loop' || f.id === 'code_autonomous_llm_loop') {
        selfFeedbackLoops++
      } else if (f.id === 'code_llm_omission_comment') omissionFiles++
    }
  }

  const aiRatio = analyzedFiles > 0 ? aiFiles / analyzedFiles : 0
  const authenticRatio = analyzedFiles > 0 ? authenticFiles / analyzedFiles : 0
  const avgFileScore = analyzedFiles > 0 ? scoreSum / analyzedFiles : 0
  const crossFileDupPct = computeCrossFileDuplication(reports, lineSets)

  let projectScore = 10

  if (analyzedFiles >= 2 && aiRatio >= 0.6) {
    const delta = Math.round(28 + aiRatio * 24)
    projectScore += delta
    findings.push({
      id: 'proj_high_ai_file_ratio',
      category: 'ailoop',
      severity: 'critical',
      scoreDelta: delta,
      titleTr: `Proje dosyalarının %${round2(aiRatio * 100)}'i AI üretimi olarak işaretlendi (${aiFiles}/${analyzedFiles})`,
      titleEn: `${round2(aiRatio * 100)}% of project files flagged as AI-generated (${aiFiles}/${analyzedFiles})`,
      detailTr: 'Proje genelinde ağırlıklı olarak yapay zeka tarafından üretilmiş dosyalar baskın durumda.',
      detailEn: 'A majority of scanned project files exhibit strong AI-generation signatures.',
      evidence: `aiFiles=${aiFiles}, confirmed=${confirmedAiFiles}, total=${analyzedFiles}, avgScore=${round2(avgFileScore)}`
    })
  } else if (analyzedFiles >= 2 && aiRatio >= 0.3) {
    const delta = 22
    projectScore += delta
    findings.push({
      id: 'proj_moderate_ai_file_ratio',
      category: 'ailoop',
      severity: 'medium',
      scoreDelta: delta,
      titleTr: `Projede kayda değer AI dosya oranı (%${round2(aiRatio * 100)}, ${aiFiles}/${analyzedFiles})`,
      titleEn: `Notable AI file ratio across project (${round2(aiRatio * 100)}%, ${aiFiles}/${analyzedFiles})`,
      detailTr: 'Proje dosyalarının önemli bir kısmı yapay zeka üretim izleri taşıyor.',
      detailEn: 'A substantial portion of project files carry AI-generation signals.',
      evidence: `aiFiles=${aiFiles}/${analyzedFiles}, avgScore=${round2(avgFileScore)}`
    })
  }

  if (modalitiesWithAi.length >= 2) {
    const delta = modalitiesWithAi.length >= 3 ? 26 : 16
    projectScore += delta
    findings.push({
      id: 'proj_multimodal_ai_stack',
      category: 'ailoop',
      severity: modalitiesWithAi.length >= 3 ? 'critical' : 'high',
      scoreDelta: delta,
      titleTr: `Çok katmanlı AI-Loop üretim hattı (${modalitiesWithAi.length} medya türünde AI: ${modalitiesWithAi.join(', ')})`,
      titleEn: `Multi-modal AI-Loop stack detected (${modalitiesWithAi.length} modalities: ${modalitiesWithAi.join(', ')})`,
      detailTr: 'Kod, görsel/video/ses ve ürün metni katmanlarının birden fazlası eşzamanlı AI çıktılarından oluşuyor.',
      detailEn: 'Multiple independent project layers (code, media, copy) simultaneously originate from AI generation.',
      evidence: modalitiesWithAi.join(', ')
    })
  }

  if (unboundedLlmLoops > 0 || selfFeedbackLoops > 0) {
    const delta = unboundedLlmLoops > 0 ? 32 : 20
    projectScore += delta
    findings.push({
      id: 'proj_autonomous_llm_loop_code',
      category: 'ailoop',
      severity: unboundedLlmLoops > 0 ? 'critical' : 'high',
      scoreDelta: delta,
      titleTr: `Projede otonom / kendi kendini besleyen LLM döngü kodu (${unboundedLlmLoops} sınırsız, ${selfFeedbackLoops} geri besleme)`,
      titleEn: `Autonomous / self-feeding LLM loop code detected (${unboundedLlmLoops} unbounded, ${selfFeedbackLoops} feedback)`,
      detailTr: 'Kaynak kodda model çıktısını doğrudan yeni prompt/döngü adımına besleyen AI-Loop mekanizması yer alıyor.',
      detailEn: 'Project source contains autonomous LLM orchestration or self-prompting feedback loops.',
      evidence: `unbounded=${unboundedLlmLoops}, feedback=${selfFeedbackLoops}`
    })
  }

  if (crossFileDupPct >= 25 && analyzedFiles >= 2) {
    const delta = crossFileDupPct >= 50 ? 20 : 12
    projectScore += delta
    findings.push({
      id: 'proj_cross_file_ai_repetition',
      category: 'ailoop',
      severity: crossFileDupPct >= 50 ? 'high' : 'medium',
      scoreDelta: delta,
      titleTr: `Dosyalar arası yüksek şablon/kalıp tekrarı (%${crossFileDupPct})`,
      titleEn: `High cross-file boilerplate repetition (${crossFileDupPct}%)`,
      detailTr: 'Farklı proje dosyaları arasında yüksek oranda yinelenen satır/şablon bloğu tespit edildi (yinelenen AI döngüsü / kopya üretim izi).',
      detailEn: 'Significant line/template duplication across multiple project files, characteristic of iterative AI-loop generation.',
      evidence: `crossFileDuplication=${crossFileDupPct}%`
    })
  }

  if (omissionFiles >= 1) {
    const delta = Math.min(24, 12 + omissionFiles * 6)
    projectScore += delta
    findings.push({
      id: 'proj_llm_omission_artifacts',
      category: 'ailoop',
      severity: 'high',
      scoreDelta: delta,
      titleTr: `Projede LLM kısaltma/atlama yorumları kaldı (${omissionFiles} dosya)`,
      titleEn: `LLM omission placeholder comments left in project (${omissionFiles} file(s))`,
      detailTr: 'Üretim kodunda "... existing code / rest of implementation" tipi yapay zeka çıktı artıkları mevcut.',
      detailEn: 'Source files still contain copy-pasted LLM omission comments.',
      evidence: `omissionFiles=${omissionFiles}`
    })
  }

  if (configMarkersFound.length > 0) {
    const delta = aiRatio >= 0.4 || unboundedLlmLoops > 0 ? 14 : 6
    projectScore += delta
    findings.push({
      id: 'proj_agent_loop_configs',
      category: 'ailoop',
      severity: delta >= 12 ? 'medium' : 'low',
      scoreDelta: delta,
      titleTr: `AI ajan / döngü yapılandırma dosyaları bulundu (${configMarkersFound.length})`,
      titleEn: `AI agent / loop configuration files detected (${configMarkersFound.length})`,
      detailTr: 'Projede AI kodlama ajanı veya otonom döngü kural/betik dosyaları yer alıyor.',
      detailEn: 'Project includes AI coding agent rules or autonomous loop scripts.',
      evidence: configMarkersFound.slice(0, 6).join(', ')
    })
  }

  if (
    analyzedFiles >= 2 &&
    authenticRatio >= 0.65 &&
    aiFiles === 0 &&
    unboundedLlmLoops === 0 &&
    selfFeedbackLoops === 0
  ) {
    projectScore -= 24
    findings.push({
      id: 'proj_organic_authentic_majority',
      category: 'provenance',
      severity: 'authentic',
      scoreDelta: -24,
      titleTr: `Organik / otantik proje profili (%${round2(authenticRatio * 100)} doğal dosya)`,
      titleEn: `Organic / authentic project profile (${round2(authenticRatio * 100)}% authentic files)`,
      detailTr: 'Taranan dosyaların büyük çoğunluğu gerçek cihaz/insan üretim izleri taşıyor ve AI döngüsü bulgusu yok.',
      detailEn: 'Majority of scanned files carry authentic human/hardware provenance with zero AI-loop findings.',
      evidence: `authentic=${authenticFiles}/${analyzedFiles}, aiFiles=0`
    })
  }

  const finalScore = Math.round(clamp(projectScore, 0, 100))

  let projectVerdict: ProjectVerdict
  if (
    finalScore >= 78 ||
    (aiRatio >= 0.6 && (modalitiesWithAi.length >= 2 || unboundedLlmLoops > 0 || confirmedAiFiles >= 2))
  ) {
    projectVerdict = 'AI_LOOP_CONFIRMED'
  } else if (finalScore >= threshold) {
    projectVerdict = 'AI_LOOP_LIKELY'
  } else if (aiFiles > 0 || configMarkersFound.length > 0 || finalScore > 32) {
    projectVerdict = 'MIXED_AI_ASSISTED'
  } else {
    projectVerdict = 'ORGANIC_PROJECT'
  }

  let confidence = 40 + Math.min(45, analyzedFiles * 6 + findings.length * 8)
  if (projectVerdict === 'AI_LOOP_CONFIRMED') confidence = Math.max(confidence, 90)
  confidence = Math.round(clamp(confidence, 25, 99))

  return {
    projectName,
    totalFiles: reports.length,
    analyzedFiles,
    errorFiles,
    aiFiles,
    authenticFiles,
    inconclusiveFiles,
    aiRatioPercent: round2(aiRatio * 100),
    averageFileAiScore: round2(avgFileScore),
    crossFileDuplicationPercent: crossFileDupPct,
    modalitiesWithAi,
    projectScore: finalScore,
    confidence,
    projectVerdict,
    findings,
    reports,
    elapsedMs: round2(performance.now() - startedMs)
  }
}

export function auditProjectBuffers(
  projectName: string,
  files: ProjectMemoryFile[],
  threshold: number
): ProjectAuditReport {
  const started = performance.now()
  const reports: AnalysisReport[] = []
  const lineSets: Set<number>[] = []

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!
    const report = analyzeBuffer(f.data, f.filePath, threshold)
    reports.push(report)
    if (report.mediaCategory === 'code' || report.mediaCategory === 'text') {
      lineSets.push(extractNormalizedLineHashes(f.data))
    }
  }

  return buildProjectSummary(projectName, reports, lineSets, started, threshold)
}

export async function auditProjectFiles(
  projectName: string,
  filePaths: string[],
  threshold: number,
  readBytesForDuplication: (path: string) => Promise<Uint8Array | null>
): Promise<ProjectAuditReport> {
  const started = performance.now()
  const reports: AnalysisReport[] = []
  const lineSets: Set<number>[] = []

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i]!
    const report = await analyzeFile(filePath, threshold)
    reports.push(report)
    if (report.error.length === 0 && (report.mediaCategory === 'code' || report.mediaCategory === 'text')) {
      const raw = await readBytesForDuplication(filePath)
      if (raw !== null) {
        lineSets.push(extractNormalizedLineHashes(raw))
      }
    }
  }

  return buildProjectSummary(projectName, reports, lineSets, started, threshold)
}

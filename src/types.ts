export type MediaCategory = 'image' | 'video' | 'audio' | 'text' | 'unknown'

export type Verdict = 'CONFIRMED_AI' | 'LIKELY_AI' | 'INCONCLUSIVE' | 'LIKELY_AUTHENTIC'

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'authentic'

export type OutputLang = 'tr' | 'en'

export interface ForensicFinding {
  id: string
  category: string
  severity: FindingSeverity
  scoreDelta: number
  titleTr: string
  titleEn: string
  detailTr: string
  detailEn: string
  evidence: string
}

export interface KeyValueEntry {
  key: string
  value: string
}

export interface AnalyzerResult {
  mediaCategory: MediaCategory
  detectedFormat: string
  findings: ForensicFinding[]
  metadata: KeyValueEntry[]
  metrics: KeyValueEntry[]
  generatorHints: string[]
}

export interface AnalysisReport {
  filePath: string
  fileName: string
  fileSize: number
  sha256: string
  mediaCategory: MediaCategory
  detectedFormat: string
  aiScore: number
  confidence: number
  verdict: Verdict
  generatorHints: string[]
  findings: ForensicFinding[]
  metadata: KeyValueEntry[]
  metrics: KeyValueEntry[]
  elapsedMs: number
  error: string
}

export interface CliOptions {
  files: string[]
  json: boolean
  verbose: boolean
  strict: boolean
  threshold: number
  lang: OutputLang
  noColor: boolean
  selfTest: boolean
  showHelp: boolean
  showVersion: boolean
}

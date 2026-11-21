export { analyzeBuffer, analyzeFile } from '../core/analyzer.ts'
export { auditProjectBuffers, auditProjectFiles } from '../core/project-audit.ts'
export type { ProjectMemoryFile } from '../core/project-audit.ts'
export { evaluateFindings } from '../core/scoring.ts'
export {
  scanBinaryForC2paAndXmp,
  scanBytesForAiSignatures,
  scanTextForAiSignatures
} from '../core/signatures.ts'
export { analyzeImage } from '../features/image/analyzer.ts'
export { analyzeVideo } from '../features/video/analyzer.ts'
export { analyzeAudio } from '../features/audio/analyzer.ts'
export { analyzeCode } from '../features/code/analyzer.ts'
export { analyzeText } from '../features/text/analyzer.ts'
export { detectMagicFormat } from '../shared/bytes.ts'
export {
  formatProjectReportJson,
  formatProjectReportText,
  formatReportText,
  formatReportsJson
} from './report.ts'
export type {
  AnalysisReport,
  AnalyzerResult,
  CliOptions,
  FindingSeverity,
  ForensicFinding,
  KeyValueEntry,
  MediaCategory,
  OutputLang,
  ProjectAuditReport,
  ProjectVerdict,
  Verdict
} from '../shared/types.ts'

import type { ForensicFinding, Verdict } from '../shared/types.ts'
import { clamp } from '../shared/bytes.ts'

export interface ScoreEvaluation {
  aiScore: number
  confidence: number
  verdict: Verdict
}

export function evaluateFindings(findings: ForensicFinding[], threshold: number): ScoreEvaluation {
  let rawScore = 15
  let hasCriticalAi = false
  let positiveEvidenceCount = 0
  let authenticEvidenceCount = 0
  let totalEvidenceMagnitude = 0

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]!
    rawScore += f.scoreDelta
    totalEvidenceMagnitude += Math.abs(f.scoreDelta)
    if (f.scoreDelta > 0) {
      positiveEvidenceCount++
      if (f.severity === 'critical' && f.scoreDelta >= 45) {
        hasCriticalAi = true
      }
    } else if (f.scoreDelta < 0) {
      authenticEvidenceCount++
    }
  }

  if (!hasCriticalAi && positiveEvidenceCount <= 1 && rawScore > 58) {
    rawScore = 58
  }

  if (hasCriticalAi && rawScore < 85) {
    rawScore = 85
  }

  const aiScore = Math.round(clamp(rawScore, 0, 100))

  let confidence = 35 + Math.min(45, totalEvidenceMagnitude * 0.55)
  if (hasCriticalAi) confidence = Math.max(confidence, 92)
  if (positiveEvidenceCount > 0 && authenticEvidenceCount > 0 && !hasCriticalAi) {
    confidence = Math.max(30, confidence - 18)
  }
  confidence = Math.round(clamp(confidence, 20, 99))

  let verdict: Verdict
  if (hasCriticalAi || aiScore >= 82) {
    verdict = 'CONFIRMED_AI'
  } else if (aiScore >= threshold) {
    verdict = 'LIKELY_AI'
  } else if (aiScore <= 32) {
    verdict = 'LIKELY_AUTHENTIC'
  } else {
    verdict = 'INCONCLUSIVE'
  }

  return { aiScore, confidence, verdict }
}

import { Buffer } from 'node:buffer'
import type { AnalyzerResult, ForensicFinding, KeyValueEntry } from '../types.ts'
import { round2 } from '../bytes.ts'
import { addUnique, scanTextForAiSignatures } from '../signatures.ts'

const AI_PHRASES_TR: string[] = [
  'günümüzün hızla değişen',
  'sonuç olarak',
  'bununla birlikte',
  'öte yandan',
  'dikkat çekici bir',
  'benzersiz bir deneyim',
  'vazgeçilmez bir',
  'ön plana çıkmaktadır',
  'hayatınızı kolaylaştıracak',
  'kusursuz bir şekilde',
  'bir adım öne',
  'üst düzey performans',
  'mükemmel bir denge',
  'kısacası',
  'özetle',
  'unutulmamalıdır ki',
  'şüphesiz ki',
  'en üst seviyeye taşı',
  'yenilikçi tasarımıyla'
]

const AI_PHRASES_EN: string[] = [
  'delve into',
  'in today\'s fast-paced',
  'in conclusion',
  'it is worth noting',
  'it\'s worth noting',
  'testament to',
  'tapestry of',
  'game-changer',
  'elevate your',
  'seamlessly',
  'unparalleled',
  'cutting-edge',
  'revolutionize',
  'furthermore',
  'moreover',
  'not only',
  'comprehensive guide',
  'embark on a journey',
  'unlock the power',
  'crafted with precision'
]

export function analyzeText(buf: Uint8Array, format: string): AnalyzerResult {
  const findings: ForensicFinding[] = []
  const metadata: KeyValueEntry[] = []
  const metrics: KeyValueEntry[] = []
  const generatorHints: string[] = []

  const text = Buffer.from(buf).toString('utf8')
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // Split sentences
  const rawSentences = trimmed.split(/[.!?]+\s+|\n{2,}/)
  const sentences: string[] = []
  const sentenceWordCounts: number[] = []
  let totalWords = 0
  const uniqueWords = new Set<string>()

  for (let i = 0; i < rawSentences.length; i++) {
    const s = rawSentences[i]!.trim()
    if (s.length < 6) continue
    const words = s.split(/\s+/).filter((w) => w.length > 0)
    if (words.length < 3) continue
    sentences.push(s)
    sentenceWordCounts.push(words.length)
    totalWords += words.length
    for (let j = 0; j < words.length; j++) {
      const cleaned = words[j]!.toLowerCase().replace(/[^a-z0-9çğıöşü]/g, '')
      if (cleaned.length >= 2) uniqueWords.add(cleaned)
    }
  }

  // Sentence burstiness (CV of sentence lengths)
  let meanLen = 0
  let burstinessCv = 0
  if (sentenceWordCounts.length >= 3) {
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < sentenceWordCounts.length; i++) {
      const c = sentenceWordCounts[i]!
      sum += c
      sumSq += c * c
    }
    meanLen = sum / sentenceWordCounts.length
    const variance = Math.max(0, sumSq / sentenceWordCounts.length - meanLen * meanLen)
    burstinessCv = meanLen > 0 ? Math.sqrt(variance) / meanLen : 0
  }

  const ttr = totalWords > 0 ? uniqueWords.size / totalWords : 0

  // Count AI cliché phrases (TR + EN)
  const matchedPhrases: string[] = []
  for (let i = 0; i < AI_PHRASES_TR.length; i++) {
    const p = AI_PHRASES_TR[i]!
    if (lower.indexOf(p) >= 0) matchedPhrases.push(p)
  }
  for (let i = 0; i < AI_PHRASES_EN.length; i++) {
    const p = AI_PHRASES_EN[i]!
    if (lower.indexOf(p) >= 0) matchedPhrases.push(p)
  }

  // Structural markers: markdown bold-colon bullet lists (`- **Feature:** ...`), em-dash frequency
  const boldBulletMatches = trimmed.match(/(?:^|\n)\s*[-*•]\s+\*\*[^*\n]{2,60}:\*\*/g)
  const boldBulletCount = boldBulletMatches ? boldBulletMatches.length : 0
  const emDashMatches = trimmed.match(/—/g)
  const emDashCount = emDashMatches ? emDashMatches.length : 0

  metrics.push({ key: 'text_char_count', value: String(trimmed.length) })
  metrics.push({ key: 'text_word_count', value: String(totalWords) })
  metrics.push({ key: 'text_sentence_count', value: String(sentences.length) })
  metrics.push({ key: 'text_avg_sentence_words', value: String(round2(meanLen)) })
  metrics.push({ key: 'text_burstiness_cv', value: String(round2(burstinessCv)) })
  metrics.push({ key: 'text_lexical_ttr', value: String(round2(ttr)) })
  metrics.push({ key: 'text_ai_phrase_hits', value: String(matchedPhrases.length) })
  metrics.push({ key: 'text_bold_bullet_templates', value: String(boldBulletCount) })

  if (matchedPhrases.length >= 3) {
    const delta = Math.min(34, 14 + matchedPhrases.length * 4)
    findings.push({
      id: 'txt_ai_cliche_density',
      category: 'stylometry',
      severity: 'high',
      scoreDelta: delta,
      titleTr: `Yüksek AI/LLM kalıp ifade yoğunluğu (${matchedPhrases.length} eşleşme)`,
      titleEn: `High AI/LLM cliché phrase density (${matchedPhrases.length} hits)`,
      detailTr: 'Metin, büyük dil modellerinin ürün açıklamaları ve makalelerde sık kullandığı geçiş/vurgulama kalıplarını yoğun biçimde içeriyor.',
      detailEn: 'Text contains a high density of signature LLM transition and promotional phrases.',
      evidence: matchedPhrases.slice(0, 8).join(', ')
    })
  } else if (matchedPhrases.length >= 1) {
    findings.push({
      id: 'txt_ai_cliche_mild',
      category: 'stylometry',
      severity: 'low',
      scoreDelta: 8,
      titleTr: `AI/LLM tarzı kalıp ifadeler (${matchedPhrases.length} eşleşme)`,
      titleEn: `AI/LLM-style phrasing (${matchedPhrases.length} hits)`,
      detailTr: 'Metinde dil modellerinin sık tercih ettiği kalıplar bulundu.',
      detailEn: 'Phrasing commonly associated with LLM prose was observed.',
      evidence: matchedPhrases.join(', ')
    })
  }

  if (sentences.length >= 4 && burstinessCv < 0.24) {
    findings.push({
      id: 'txt_low_burstiness',
      category: 'stylometry',
      severity: 'medium',
      scoreDelta: 18,
      titleTr: `Çok düşük cümle uzunluğu değişkenliği / burstiness (CV=${round2(burstinessCv)})`,
      titleEn: `Unusually uniform sentence length / low burstiness (CV=${round2(burstinessCv)})`,
      detailTr: 'İnsan yazımı kısa ve uzun cümleler arasında yüksek varyans gösterir; bu metnin cümle ritmi aşırı tekdüze.',
      detailEn: 'Human prose fluctuates strongly in sentence length; this document exhibits highly uniform cadence typical of LLM generation.',
      evidence: `sentences=${sentences.length}, meanWords=${round2(meanLen)}, CV=${round2(burstinessCv)}`
    })
  } else if (sentences.length >= 5 && burstinessCv >= 0.45 && matchedPhrases.length === 0) {
    findings.push({
      id: 'txt_natural_burstiness',
      category: 'stylometry',
      severity: 'authentic',
      scoreDelta: -14,
      titleTr: `Doğal cümle ritmi ve yüksek burstiness (CV=${round2(burstinessCv)})`,
      titleEn: `Natural sentence cadence and high burstiness (CV=${round2(burstinessCv)})`,
      detailTr: 'Cümle uzunlukları doğal insan yazım aralığında değişkenlik gösteriyor ve AI kalıp ifadesi bulunmuyor.',
      detailEn: 'Sentence length variation falls within natural human writing ranges with no AI cliché phrases.',
      evidence: `CV=${round2(burstinessCv)}, phrases=0`
    })
  }

  if (boldBulletCount >= 3 || emDashCount >= 4) {
    findings.push({
      id: 'txt_llm_formatting_template',
      category: 'stylometry',
      severity: 'medium',
      scoreDelta: 14,
      titleTr: 'LLM şablon biçimlendirme örüntüsü (**Başlık:** listesi / uzun tire)',
      titleEn: 'LLM template formatting pattern (**Label:** bullets / em-dash overuse)',
      detailTr: `Metinde ${boldBulletCount} adet '**Özellik:**' madde şablonu ve ${emDashCount} adet uzun tire (—) bulunuyor.`,
      detailEn: `Document contains ${boldBulletCount} '**Label:**' bullet templates and ${emDashCount} em-dashes (—).`,
      evidence: `boldBullets=${boldBulletCount}, emDashes=${emDashCount}`
    })
  }

  // Check explicit AI signatures/headers (e.g. "Generated by ChatGPT", "C2PA", etc.)
  const sigScan = scanTextForAiSignatures([trimmed.slice(0, 32768)], 'text')
  for (let i = 0; i < sigScan.findings.length; i++) findings.push(sigScan.findings[i]!)
  for (let i = 0; i < sigScan.generators.length; i++) addUnique(generatorHints, sigScan.generators[i]!)

  metadata.push({ key: 'text_encoding', value: 'UTF-8' })

  return {
    mediaCategory: 'text',
    detectedFormat: format,
    findings,
    metadata,
    metrics,
    generatorHints
  }
}

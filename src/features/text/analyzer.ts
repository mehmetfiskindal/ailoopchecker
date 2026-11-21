import type { AnalyzerResult, ForensicFinding, KeyValueEntry } from '../../shared/types.ts'
import { addUnique, indexOfUtf8CI, round2 } from '../../shared/bytes.ts'
import { scanBytesForAiSignatures } from '../../core/signatures.ts'

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

function isAsciiWs(b: number): boolean {
  return b === 32 || b === 9 || b === 10 || b === 13
}

function isWordByte(b: number): boolean {
  return (b >= 97 && b <= 122) || (b >= 65 && b <= 90) || (b >= 48 && b <= 57) || b >= 128
}

function countBoldBulletTemplatesBytes(buf: Uint8Array, len: number): number {
  let count = 0
  let i = 0
  while (i < len) {
    while (i < len && (buf[i] === 32 || buf[i] === 9)) i++
    if (i < len) {
      const b0 = buf[i]!
      let afterMarker = -1
      if (b0 === 45 || b0 === 42) {
        afterMarker = i + 1
      } else if (i + 2 < len && b0 === 0xe2 && buf[i + 1] === 0x80 && buf[i + 2] === 0xa2) {
        afterMarker = i + 3
      }
      if (afterMarker > 0) {
        let j = afterMarker
        let ws = 0
        while (j < len && (buf[j] === 32 || buf[j] === 9)) {
          j++
          ws++
        }
        if (ws > 0 && j + 4 < len && buf[j] === 42 && buf[j + 1] === 42) {
          const limit = Math.min(len - 2, j + 80)
          for (let k = j + 3; k < limit; k++) {
            const c = buf[k]!
            if (c === 10 || c === 13) break
            if (c === 58 && buf[k + 1] === 42 && buf[k + 2] === 42) {
              count++
              break
            }
          }
        }
      }
    }
    while (i < len && buf[i] !== 10) i++
    if (i < len) i++
  }
  return count
}

export function analyzeText(buf: Uint8Array, format: string): AnalyzerResult {
  const findings: ForensicFinding[] = []
  const metadata: KeyValueEntry[] = []
  const metrics: KeyValueEntry[] = []
  const generatorHints: string[] = []

  const scanLen = Math.min(buf.length, 131072)
  const scanSlice = buf.subarray(0, scanLen)

  // Single-pass O(N) byte-level stylometry (zero string.toLowerCase / charCodeAt)
  const sentenceWordCounts: number[] = []
  const uniqueWordHashes = new Set<number>()
  let totalWords = 0
  let currentSentenceWords = 0
  let emDashCount = 0
  let inWord = false
  let wordLen = 0
  let wordHash = 2166136261
  let prevNewline = false

  const flushWord = (): void => {
    if (inWord) {
      currentSentenceWords++
      totalWords++
      if (wordLen >= 2 && uniqueWordHashes.size < 8192) {
        uniqueWordHashes.add(wordHash >>> 0)
      }
      inWord = false
      wordLen = 0
      wordHash = 2166136261
    }
  }

  const flushSentence = (): void => {
    flushWord()
    if (currentSentenceWords >= 3) {
      sentenceWordCounts.push(currentSentenceWords)
    }
    currentSentenceWords = 0
  }

  for (let i = 0; i < scanLen; i++) {
    const b = scanSlice[i]!
    if (b === 0xe2 && i + 2 < scanLen && scanSlice[i + 1] === 0x80 && scanSlice[i + 2] === 0x94) {
      flushWord()
      emDashCount++
      i += 2
      prevNewline = false
      continue
    }

    if (isWordByte(b)) {
      const lb = b >= 65 && b <= 90 ? b + 32 : b
      wordHash = Math.imul(wordHash ^ lb, 16777619)
      inWord = true
      wordLen++
      prevNewline = false
    } else if (isAsciiWs(b)) {
      flushWord()
      if (b === 10) {
        if (prevNewline) flushSentence()
        prevNewline = true
      }
    } else if (b === 46 || b === 33 || b === 63) {
      flushWord()
      const nextB = i + 1 < scanLen ? scanSlice[i + 1]! : 32
      if (isAsciiWs(nextB)) flushSentence()
      prevNewline = false
    } else {
      flushWord()
      prevNewline = false
    }
  }
  flushSentence()

  const boldBulletCount = countBoldBulletTemplatesBytes(scanSlice, scanLen)

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

  const ttr = totalWords > 0 ? uniqueWordHashes.size / totalWords : 0

  // O(N) direct byte-level phrase scan (zero toLowerCase on large buffers!)
  const phraseScanLen = Math.min(buf.length, 32768)
  const matchedPhrases: string[] = []
  for (let i = 0; i < AI_PHRASES_TR.length; i++) {
    const p = AI_PHRASES_TR[i]!
    if (indexOfUtf8CI(buf, p, 0, phraseScanLen) >= 0) matchedPhrases.push(p)
  }
  for (let i = 0; i < AI_PHRASES_EN.length; i++) {
    const p = AI_PHRASES_EN[i]!
    if (indexOfUtf8CI(buf, p, 0, phraseScanLen) >= 0) matchedPhrases.push(p)
  }

  metrics.push({ key: 'text_char_count', value: String(scanLen) })
  metrics.push({ key: 'text_word_count', value: String(totalWords) })
  metrics.push({ key: 'text_sentence_count', value: String(sentenceWordCounts.length) })
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

  if (sentenceWordCounts.length >= 4 && burstinessCv < 0.24) {
    findings.push({
      id: 'txt_low_burstiness',
      category: 'stylometry',
      severity: 'medium',
      scoreDelta: 18,
      titleTr: `Çok düşük cümle uzunluğu değişkenliği / burstiness (CV=${round2(burstinessCv)})`,
      titleEn: `Unusually uniform sentence length / low burstiness (CV=${round2(burstinessCv)})`,
      detailTr: 'İnsan yazımı kısa ve uzun cümleler arasında yüksek varyans gösterir; bu metnin cümle ritmi aşırı tekdüze.',
      detailEn: 'Human prose fluctuates strongly in sentence length; this document exhibits highly uniform cadence typical of LLM generation.',
      evidence: `sentences=${sentenceWordCounts.length}, meanWords=${round2(meanLen)}, CV=${round2(burstinessCv)}`
    })
  } else if (sentenceWordCounts.length >= 5 && burstinessCv >= 0.45 && matchedPhrases.length === 0) {
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

  const sigScan = scanBytesForAiSignatures([buf.subarray(0, phraseScanLen)], 'text')
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
